/// <reference types="node" />
// Phase 4 tests: lifecycle, transactions, confirmation, queue, execution, recovery, expiry and audit.
// Deterministic: mock AI, mock action handlers, in-memory SQLite. No Loop task or ticket is changed.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import knex, { Knex } from 'knex';
import { canTransition, assertTransition, InvalidTransition, isTerminal, LEGACY_STATUS } from './lifecycle';
import { transition, StateConflict } from './requestStore';
import { ensureConversationSchema } from './conversationStore';
import { ensureQueueSchema } from './queueSchema';
import { MockAIProvider } from './ai';
import { RequestEngine } from './engine';
import { handleConfirmationText, confirmRequest, assignConfirmation } from './confirmation';
import { claimNext, expireDue, recoverInterrupted } from './queue';
import { HandlerRegistry, runNext, TransientActionError, TerminalActionError, safeError, ActionHandler } from './executor';
import { loadAssistantConfig } from './config';
import { IncomingMessage } from './types';

const NOW = Date.parse('2026-11-12T10:00:00Z');
let db: Knex;
let ids: Record<string, number>;
let clock: number;

beforeEach(async () => {
  clock = NOW;
  db = knex({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  await db.schema.createTable('users', (t) => { t.increments('id'); t.string('name'); t.string('role'); t.string('pod'); t.integer('client_company_id'); });
  await db.schema.createTable('projects', (t) => { t.increments('id'); t.string('name'); t.string('pod'); t.integer('client_company_id'); t.integer('created_by'); });
  await db.schema.createTable('project_members', (t) => { t.integer('project_id'); t.integer('user_id'); });
  await ensureConversationSchema(db);
  await ensureQueueSchema(db);
  ids = {};
  for (const [k, name] of [['priya', 'Priya'], ['sam', 'Sam'], ['lee', 'Lee']] as const) {
    ids[k] = (await db('users').insert({ name, role: 'employee', pod: 'pod1' }))[0];
  }
  ids.web = (await db('projects').insert({ name: 'Website redesign', pod: 'pod1', created_by: ids.priya }))[0];
  await db('project_members').insert([ids.priya, ids.sam, ids.lee].map((u) => ({ project_id: ids.web, user_id: u })));
});
afterEach(async () => { await db.destroy(); });

const reqOf = (over: any = {}) => ({
  channel: 'simulator', senderId: 'loop-user:1', conversationId: 'group-1', messageId: 'm-' + Math.random(),
  text: '', timestamp: new Date(NOW).toISOString(), ...over,
}) as IncomingMessage;

// Creates a request that is READY_FOR_CONFIRMATION through the real engine, and returns its code
async function readyRequest(who: string, title = 'Redesign the homepage', intent = 'CREATE_TASK', conv = 'group-1') {
  const ai = new MockAIProvider(() => JSON.stringify({ intent, confidence: 0.95, fields: { title, task_ref: title, employee: who === 'priya' ? 'Priya' : 'Sam', project: 'Website redesign', deadline: 'none' }, ambiguous: [], is_correction: false, cancel: false, answers_pending: false }));
  const e = new RequestEngine({ db, ai, timezone: 'UTC', contextTtlSeconds: 1800, confirmationTtlSeconds: 600, queueExpirySeconds: 900, now: () => clock });
  const r = await e.handle(reqOf({ text: 'Create a task', conversationId: conv }), { id: ids[who], role: 'employee' });
  assert.equal(r.status, 'ready', r.reply);
  const row = await db('assistant_requests').where({ id: r.requestId }).first();
  return { id: r.requestId as string, code: row.confirm_code as string, loopUserId: ids[who], conv };
}

const state = async (id: string) => (await db('assistant_requests').where({ id }).first()).status;
const events = async (id: string) => db('assistant_request_events').where({ request_id: id }).orderBy('id').select('event', 'from_state', 'to_state');

// ── Lifecycle ──
test('lifecycle: allowed transitions pass; the rest are refused; terminal states lead nowhere', () => {
  assert.ok(canTransition('READY_FOR_CONFIRMATION', 'CONFIRMED'));
  assert.ok(canTransition('PROCESSING', 'QUEUED'), 'retry path');
  assert.equal(canTransition('EXPIRED', 'QUEUED'), false, 'expired cannot be executed');
  assert.equal(canTransition('CANCELLED', 'QUEUED'), false, 'cancelled cannot be executed');
  assert.equal(canTransition('READY_FOR_CONFIRMATION', 'PROCESSING'), false, 'no processing without confirmation');
  assert.equal(canTransition('COMPLETED', 'PROCESSING'), false, 'no processing twice');
  assert.throws(() => assertTransition('QUEUED', 'COMPLETED'), InvalidTransition);
  for (const s of ['COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED', 'REJECTED']) assert.equal(isTerminal(s), true);
  assert.equal(LEGACY_STATUS.awaiting_info, 'NEEDS_CLARIFICATION');
});

test('transition: stale expectations and invalid moves are refused inside the database', async () => {
  const r = await readyRequest('priya');
  // stale expectation: refused before any change
  await assert.rejects(transition(db, r.id, 'CONFIRMED', { event: 'x', expectFrom: ['QUEUED'] }, clock), StateConflict);
  // lifecycle violation: refused even when the expectation matches
  await assert.rejects(transition(db, r.id, 'PROCESSING', { event: 'x', expectFrom: ['READY_FOR_CONFIRMATION'] }, clock), InvalidTransition);
  assert.equal(await state(r.id), 'READY_FOR_CONFIRMATION');
});

// ── Confirmation ──
test('"CONFIRM <code>" confirms exactly that request and queues it; the audit trail records who and when', async () => {
  const r = await readyRequest('priya');
  const out = await handleConfirmationText(db, r.loopUserId, `simulator:${r.conv}:${r.loopUserId}`, `CONFIRM ${r.code}`, clock, 900);
  assert.equal(out.kind, 'confirmed');
  assert.equal(await state(r.id), 'QUEUED');
  const row = await db('assistant_requests').where({ id: r.id }).first();
  assert.equal(Number(row.confirmed_by), r.loopUserId);
  assert.ok(row.confirmed_at && row.queue_expires_at);
  const ev = (await events(r.id)).map((e: any) => e.event);
  assert.ok(ev.includes('confirmed') && ev.includes('queued'));
});

test('a plain "yes" works only when exactly one request awaits confirmation', async () => {
  const a = await readyRequest('priya', 'First task');
  const key = `simulator:group-1:${a.loopUserId}`;
  const b = await readyRequest('priya', 'Second task', 'CREATE_TASK', 'group-2');
  const amb = await handleConfirmationText(db, a.loopUserId, key, 'yes', clock, 900);
  assert.equal(amb.kind, 'ambiguous');
  assert.equal(await state(a.id), 'READY_FOR_CONFIRMATION', 'nothing confirmed by a vague yes');
  const exact = await handleConfirmationText(db, a.loopUserId, key, `confirm ${a.code}`, clock, 900);
  assert.equal(exact.kind, 'confirmed');
  assert.equal(await state(b.id), 'READY_FOR_CONFIRMATION', 'a confirmation never confirms another request');
});

test('a plain "yes" with no pending request is not a confirmation', async () => {
  assert.equal((await handleConfirmationText(db, ids.priya, 'simulator:g:1', 'yes', clock, 900)).kind, 'none');
});

test('duplicate confirmations do not queue twice', async () => {
  const r = await readyRequest('priya');
  const key = `simulator:group-1:${r.loopUserId}`;
  assert.equal((await handleConfirmationText(db, r.loopUserId, key, `CONFIRM ${r.code}`, clock, 900)).kind, 'confirmed');
  assert.equal((await handleConfirmationText(db, r.loopUserId, key, `CONFIRM ${r.code}`, clock, 900)).kind, 'invalid');
  const queued = await db('assistant_request_events').where({ request_id: r.id, event: 'queued' });
  assert.equal(queued.length, 1);
  assert.equal(await state(r.id), 'QUEUED');
});

test("another employee's code is refused without revealing that it exists; their request is untouched", async () => {
  const r = await readyRequest('priya');
  const other = await handleConfirmationText(db, ids.sam, `simulator:group-1:${ids.sam}`, `CONFIRM ${r.code}`, clock, 900);
  assert.equal(other.kind, 'invalid');
  assert.equal(await state(r.id), 'READY_FOR_CONFIRMATION');
  const unknown = await handleConfirmationText(db, ids.sam, `simulator:group-1:${ids.sam}`, 'CONFIRM ZZZZZ', clock, 900);
  assert.equal(unknown.kind, 'invalid', 'same answer for unknown and foreign codes');
});

test('cancelling before execution works; a cancelled request cannot be confirmed afterwards', async () => {
  const r = await readyRequest('priya');
  const key = `simulator:group-1:${r.loopUserId}`;
  assert.equal((await handleConfirmationText(db, r.loopUserId, key, `CANCEL ${r.code}`, clock, 900)).kind, 'cancelled');
  assert.equal(await state(r.id), 'CANCELLED');
  assert.equal((await handleConfirmationText(db, r.loopUserId, key, `CONFIRM ${r.code}`, clock, 900)).kind, 'invalid');
});

test('confirmation expires after its window', async () => {
  const r = await readyRequest('priya');
  clock = NOW + 601 * 1000;
  const key = `simulator:group-1:${r.loopUserId}`;
  assert.equal((await handleConfirmationText(db, r.loopUserId, key, `CONFIRM ${r.code}`, clock, 900)).kind, 'invalid');
  assert.equal(await state(r.id), 'EXPIRED');
});

test('the engine refuses to confirm through the wrong employee (identity isolation)', async () => {
  const r = await readyRequest('priya');
  assert.equal(await state(r.id), 'READY_FOR_CONFIRMATION');
  const confirmed = await confirmRequest(db, r.id, ids.sam, r.code, clock, 900);
  assert.equal(confirmed.kind, 'already', 'not found for another employee');
  assert.equal(await state(r.id), 'READY_FOR_CONFIRMATION');
});

// ── Queue ──
async function queueFor(who: string, title: string, intent = 'CREATE_TASK') {
  clock += 1000; // distinct creation times keep the queue order deterministic
  const r = await readyRequest(who, title, intent, 'group-' + title);
  await handleConfirmationText(db, r.loopUserId, `simulator:group-${title}:${r.loopUserId}`, `CONFIRM ${r.code}`, clock, 900);
  return r;
}

test('queue order: priority first, then oldest; approvals are processed before creations', async () => {
  const create = await queueFor('priya', 'Create one');
  clock += 1000;
  const approve = await queueFor('sam', 'Approve it', 'APPROVE_TASK');
  const first = await claimNext(db, { workerId: 'w1', nowMs: clock, leaseSeconds: 60 });
  assert.equal(first!.id, approve.id, 'approval (priority 50) before creation (100)');
  const second = await claimNext(db, { workerId: 'w1', nowMs: clock, leaseSeconds: 60 });
  assert.equal(second!.id, create.id);
});

test('one employee with work in progress does not block another employee', async () => {
  const p1 = await queueFor('priya', 'P one');
  await queueFor('priya', 'P two');
  const s1 = await queueFor('sam', 'S one');
  const a = await claimNext(db, { workerId: 'w1', nowMs: clock, leaseSeconds: 60 });
  assert.equal(a!.id, p1.id);
  const b = await claimNext(db, { workerId: 'w2', nowMs: clock, leaseSeconds: 60 });
  assert.equal(b!.id, s1.id, 'Sam is served while Priya is busy; Priya\'s second request waits');
});

test('concurrent claims never receive the same request', async () => {
  const reqs = [await queueFor('priya', 'A'), await queueFor('sam', 'B'), await queueFor('lee', 'C')];
  const claims = await Promise.all([1, 2, 3, 4].map((i) => claimNext(db, { workerId: 'w' + i, nowMs: clock, leaseSeconds: 60 })));
  const got = claims.filter(Boolean).map((c) => c!.id);
  assert.equal(new Set(got).size, got.length, 'no request claimed twice');
  assert.ok(got.length <= reqs.length);
});

test('expired requests are never claimed or executed', async () => {
  const r = await queueFor('priya', 'Too late');
  clock += 3600 * 1000;
  assert.equal(await expireDue(db, clock, 1800), 1);
  assert.equal(await state(r.id), 'EXPIRED');
  assert.equal(await claimNext(db, { workerId: 'w', nowMs: clock, leaseSeconds: 60 }), null);
});

// ── Execution ──
function registry(opts: { idempotent?: boolean; fail?: (n: number) => Error | null; validate?: (d: any) => string[]; calls?: any[] } = {}) {
  const calls = opts.calls ?? [];
  let n = 0;
  const reg = new HandlerRegistry();
  reg.register({
    intent: 'CREATE_TASK',
    idempotent: opts.idempotent ?? true,
    validate: opts.validate ?? (() => []),
    execute: async (input) => { n++; calls.push(input); const f = opts.fail?.(n); if (f) throw f; return { summary: 'created (mock)' }; },
  } as ActionHandler);
  return { reg, calls };
}
const deps = (reg: HandlerRegistry, verified = true, maxAttempts = 3) => ({
  db, registry: reg, workerId: 'w1', maxAttempts, leaseSeconds: 60, now: () => clock, stillVerified: async () => verified, enabled: true,
});

test('a confirmed request runs once through the mock handler and completes with an execution record', async () => {
  await queueFor('priya', 'Run me');
  const { reg, calls } = registry();
  const out = await runNext(deps(reg));
  assert.equal(out.outcome, 'completed');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].loopUserId, ids.priya);
  const row = await db('assistant_requests').where({ id: out.requestId }).first();
  assert.equal(row.status, 'COMPLETED');
  assert.equal(row.result_summary, 'created (mock)');
  const ex = await db('assistant_executions').where({ request_id: out.requestId });
  assert.equal(ex.length, 1);
  assert.equal(ex[0].status, 'succeeded');
  assert.equal(await runNext(deps(reg)).then((o) => o.outcome), 'idle', 'nothing runs again');
});

test('transient failures are retried with the same idempotency key, then the request is failed when attempts run out', async () => {
  const r = await queueFor('priya', 'Flaky');
  const calls: any[] = [];
  const { reg } = registry({ idempotent: true, fail: () => new TransientActionError('upstream busy'), calls });
  let last: any;
  for (let i = 0; i < 3; i++) {
    last = await runNext(deps(reg, true, 3));
    clock += 3 * 60 * 1000; // past any backoff
  }
  assert.equal(last.outcome, 'failed');
  assert.equal(await state(r.id), 'FAILED');
  assert.equal((await db('assistant_requests').where({ id: r.id }).first()).failure_kind, 'retries_exhausted');
  assert.equal(calls.length, 3);
  assert.equal(new Set(calls.map((c) => c.idempotencyKey)).size, 1, 'retries reuse one idempotency key');
  assert.equal((await db('assistant_executions').where({ request_id: r.id })).length, 3, 'every attempt is recorded');
});

test('a transient failure schedules a retry that is not picked up before its time', async () => {
  const r = await queueFor('priya', 'Backoff');
  const { reg } = registry({ fail: () => new TransientActionError('busy') });
  assert.equal((await runNext(deps(reg))).outcome, 'retry_scheduled');
  assert.equal(await state(r.id), 'QUEUED');
  assert.equal(await claimNext(db, { workerId: 'w', nowMs: clock, leaseSeconds: 60 }), null, 'not yet due');
  clock += 10 * 60 * 1000;
  assert.ok(await claimNext(db, { workerId: 'w', nowMs: clock, leaseSeconds: 60 }));
});

test('terminal failures stop at once; unknown errors are terminal for handlers that are not idempotent', async () => {
  const a = await queueFor('priya', 'Bad input');
  const { reg } = registry({ fail: () => new TerminalActionError('project archived') });
  assert.equal((await runNext(deps(reg))).outcome, 'failed');
  assert.equal((await db('assistant_requests').where({ id: a.id }).first()).failure_kind, 'terminal');
  const b = await queueFor('sam', 'Unknown error, not idempotent');
  const { reg: reg2 } = registry({ idempotent: false, fail: () => new Error('socket reset') });
  assert.equal((await runNext(deps(reg2))).outcome, 'failed');
  assert.equal(await state(b.id), 'FAILED');
});

test('invalid requests and missing handlers fail without calling anything', async () => {
  const r = await queueFor('priya', 'Invalid');
  const { reg, calls } = registry({ validate: () => ['title missing'] });
  assert.equal((await runNext(deps(reg))).outcome, 'failed');
  assert.equal(calls.length, 0);
  assert.equal((await db('assistant_requests').where({ id: r.id }).first()).failure_kind, 'invalid_request');
  const s = await queueFor('sam', 'No handler');
  assert.equal((await runNext(deps(new HandlerRegistry()))).outcome, 'failed');
  assert.equal((await db('assistant_requests').where({ id: s.id }).first()).failure_kind, 'no_handler');
});

test('an employee whose verification has lapsed is not acted for', async () => {
  const r = await queueFor('priya', 'Revoked');
  const { reg, calls } = registry();
  assert.equal((await runNext(deps(reg, false))).outcome, 'failed');
  assert.equal(calls.length, 0);
  assert.equal((await db('assistant_requests').where({ id: r.id }).first()).failure_kind, 'identity');
});

// ── Recovery ──
test('work interrupted by a crash is retried only when the handler is idempotent; otherwise it needs review', async () => {
  const a = await queueFor('priya', 'Crash safe');
  const b = await queueFor('sam', 'Crash unsafe', 'APPROVE_TASK');
  const first = await claimNext(db, { workerId: 'dead-worker', nowMs: clock, leaseSeconds: 60 });
  const second = await claimNext(db, { workerId: 'dead-worker', nowMs: clock, leaseSeconds: 60 });
  assert.deepEqual([first!.id, second!.id].sort(), [a.id, b.id].sort());
  clock += 5 * 60 * 1000; // leases expired: the worker died
  // a is a CREATE (retry-safe in this test); b is an APPROVE (not safe to repeat)
  const res = await recoverInterrupted(db, clock, (intent) => intent === 'CREATE_TASK', 3);
  assert.equal(res.requeued, 1);
  assert.equal(res.failed, 1);
  assert.equal(await state(a.id), 'QUEUED');
  assert.equal(await state(b.id), 'FAILED');
});

test('recovery does not duplicate a business action: an interrupted run is never executed twice silently', async () => {
  const r = await queueFor('priya', 'Once only');
  await claimNext(db, { workerId: 'dead', nowMs: clock, leaseSeconds: 60 });
  clock += 5 * 60 * 1000;
  await recoverInterrupted(db, clock, () => false, 3);
  assert.equal(await state(r.id), 'FAILED');
  assert.equal((await db('assistant_requests').where({ id: r.id }).first()).failure_kind, 'interrupted');
});

// ── Expiry of clarifications and confirmations ──
test('clarifications and confirmations past their window expire', async () => {
  const r = await readyRequest('priya');
  clock = NOW + 3600 * 1000;
  assert.ok((await expireDue(db, clock, 1800)) >= 1);
  assert.equal(await state(r.id), 'EXPIRED');
});

// ── Audit trail and secrets ──
test('every transition is in the audit trail with previous and new states, and nothing secret is stored', async () => {
  const r = await queueFor('priya', 'Audited');
  const { reg } = registry();
  await runNext(deps(reg));
  const seq = (await events(r.id)).map((e: any) => `${e.from_state ?? '-'}>${e.to_state ?? e.event}`);
  assert.ok(seq.some((s) => s.includes('READY_FOR_CONFIRMATION>CONFIRMED')));
  assert.ok(seq.some((s) => s.includes('PROCESSING')));
  assert.ok(seq.some((s) => s.includes('COMPLETED')));
  const rows = await db('assistant_request_events').where({ request_id: r.id });
  for (const row of rows) assert.ok(!/sk-|Bearer /.test(String(row.detail ?? '')));
});

test('error text is redacted before it is stored', () => {
  assert.equal(safeError(new Error('auth failed for sk-abc123XYZ')).includes('sk-abc123XYZ'), false);
  assert.equal(safeError(new Error('Bearer eyJhbGciOi.secret')).includes('eyJhbGciOi'), false);
  assert.ok(safeError(new Error('x'.repeat(1000))).length <= 300);
});

// ── Database behaviour ──
test('a database failure inside a confirmation rolls it back: the request stays ready', async () => {
  const r = await readyRequest('priya');
  await db.schema.renameTable('assistant_request_events', 'tmp_events_off');
  try {
    await assert.rejects(confirmRequest(db, r.id, r.loopUserId, r.code, clock, 900));
  } finally {
    await db.schema.renameTable('tmp_events_off', 'assistant_request_events');
  }
  assert.equal(await state(r.id), 'READY_FOR_CONFIRMATION', 'no half-confirmed request');
});

test('legacy Phase 3 statuses are migrated once and the migration can run again safely', async () => {
  const id = 'legacy-1';
  await db('assistant_requests').insert({ id, conversation_key: 'k', loop_user_id: ids.priya, channel: 'simulator', conversation_id: 'g', intent: 'CREATE_TASK', data: '{"raw":{},"resolved":{}}', status: 'awaiting_info', ask_count: 0, created_at: new Date(NOW), updated_at: new Date(NOW) });
  await ensureQueueSchema(db);
  assert.equal(await state(id), 'NEEDS_CLARIFICATION');
  await ensureQueueSchema(db);
  assert.equal(await state(id), 'NEEDS_CLARIFICATION');
});

test('execution is off by default and the settings are read from the environment', () => {
  const c = loadAssistantConfig({});
  assert.equal(c.queue.executionEnabled, false);
  assert.equal(c.queue.maxAttempts, 3);
  const e = loadAssistantConfig({ ASSISTANT_EXECUTION_ENABLED: 'true', ASSISTANT_QUEUE_MAX_ATTEMPTS: '5' });
  assert.equal(e.queue.executionEnabled, true);
  assert.equal(e.queue.maxAttempts, 5);
});

test('an assigned confirmation code is unique per request', async () => {
  const a = await readyRequest('priya', 'One');
  const b = await readyRequest('sam', 'Two', 'CREATE_TASK', 'group-x');
  assert.notEqual(a.code, b.code);
  await assert.rejects(db('assistant_requests').where({ id: b.id }).update({ confirm_code: a.code }));
});
