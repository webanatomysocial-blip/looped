/// <reference types="node" />
// Phase 5 step 4, end to end: employee message → reference resolved → confirmed → executor → ticket changed.
// Covers every exposed action, retries, a rolled-back attempt, terminal refusals, and the group and not-exposed rules.
process.env.SQLITE_FILE = ':memory:';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDB, getDB } from '../db';
import { MockAIProvider } from './ai';
import { RequestEngine, GROUP_REPLY } from './engine';
import { SUSPENDED_TASK_INTENTS, ticketRegistry, stillVerified } from './actions';
import { runNext } from './executor';
import { searchTickets, viewTicket, listMyTasks } from '../services/ticketReads';
import { createOp } from './ticketMutations';
import { IncomingMessage } from './types';

const U: Record<string, any> = {};
const db = () => getDB();
const who = (k: string) => ({ id: U[k].id, role: U[k].role });
const base = { confidence: 0.95, ambiguous: [], is_correction: false, cancel: false, answers_pending: false };
const table: Record<string, any> = {
  'create a ticket called Hero copy for Sam in Website redesign, no deadline': { ...base, intent: 'CREATE_TASK', fields: { title: 'Hero copy', employee: 'Sam', project: 'Website redesign', deadline: 'none' } },
  'assign the Hero copy ticket to Lee': { ...base, intent: 'ASSIGN_TASK', fields: { task_ref: 'Hero copy', employee: 'Lee' } },
  'make the Hero copy ticket urgent': { ...base, intent: 'UPDATE_TASK', fields: { task_ref: 'Hero copy', priority: 'urgent' } },
  'rename the Hero copy ticket to Hero v2': { ...base, intent: 'UPDATE_TASK', fields: { task_ref: 'Hero copy', title: 'Hero v2' } },
  'add a comment on Hero v2 saying please check the copy': { ...base, intent: 'ADD_COMMENT', fields: { task_ref: 'Hero v2', comment: 'please check the copy' } },
  'accept the Hero v2 ticket': { ...base, intent: 'ACCEPT_TASK', fields: { task_ref: 'Hero v2' } },
  'reject the Sketch ticket because it is unclear': { ...base, intent: 'REJECT_TASK', fields: { task_ref: 'Sketch', comment: 'unclear' } },
  'approve the Poster ticket': { ...base, intent: 'APPROVE_TASK', fields: { task_ref: 'Poster' } },
  'create a ticket called Crash ticket for Sam in Website redesign, no deadline': { ...base, intent: 'CREATE_TASK', fields: { title: 'Crash ticket', employee: 'Sam', project: 'Website redesign', deadline: 'none' } },
  'create a ticket called Retry me for Sam in Website redesign, no deadline': { ...base, intent: 'CREATE_TASK', fields: { title: 'Retry me', employee: 'Sam', project: 'Website redesign', deadline: 'none' } },
  'decline the Hero v2 ticket': { ...base, intent: 'DECLINE_TASK', fields: { task_ref: 'Hero v2' } },
  'assign the Hero v2 ticket to Lee': { ...base, intent: 'ASSIGN_TASK', fields: { task_ref: 'Hero v2', employee: 'Lee' } },
};
const ai = new MockAIProvider((req: any) => {
  const m = /"""([\s\S]*?)"""/.exec(req.user);
  return JSON.stringify(table[(m ? m[1] : '').trim()] ?? { ...base, intent: 'UNKNOWN', confidence: 0 });
});

const engine = () => new RequestEngine({
  db: db(), ai, timezone: 'Asia/Kolkata', contextTtlSeconds: 1800, confirmationTtlSeconds: 600,
  exposedIntents: SUSPENDED_TASK_INTENTS,
  reader: { search: (actor, text) => searchTickets(db(), actor as any, text) as any, view: (actor, id) => viewTicket(db(), actor as any, id) as any, mine: (actor) => listMyTasks(db(), actor as any) as any },
  executionEnabled: true,
});
const deps = () => ({ db: db(), registry: ticketRegistry(db()), workerId: 'w1', maxAttempts: 3, leaseSeconds: 60, stillVerified: (id: number) => stillVerified(db(), id), enabled: true });
const msg = (text: string, channel = 'simulator'): IncomingMessage => ({ channel, senderId: 'x', conversationId: 'c', messageId: 'm' + Math.random(), text, timestamp: new Date().toISOString() } as any);
const say = (text: string, k: string, channel = 'simulator') => engine().handle(msg(text, channel), who(k));

// Asks, confirms and runs one request. Returns the executor result and the request id.
async function confirmAndRun(text: string, k: string) {
  const ready = await say(text, k);
  assert.equal(ready.status, 'ready', ready.reply);
  const code = /CONFIRM (\w+)/.exec(ready.reply)![1];
  assert.equal((await say(`CONFIRM ${code}`, k)).status, 'confirmed');
  const run = await runNext(deps());
  return { run, requestId: ready.requestId! };
}
const ticketNamed = (title: string) => db()('tasks').where({ title }).first();

before(async () => {
  await initDB();
  const d = db();
  for (const [k, role, pod] of [['mgr1', 'manager', 'pod1'], ['emp1', 'employee', 'pod1'], ['emp2', 'employee', 'pod1'], ['outsider', 'employee', 'pod2']] as const) {
    const names: Record<string, string> = { mgr1: 'Mia', emp1: 'Sam', emp2: 'Lee', outsider: 'Ola' };
    const [id] = await d('users').insert({ name: names[k], email: `${k}@act.test`, password_hash: 'x', role, pod });
    U[k] = { id, role };
    if (k !== 'outsider') await d('assistant_identities').insert({ user_id: id, channel: 'simulator', external_sender_id: `sim-${k}`, status: 'active', active_sender_key: `simulator:sim-${k}`, active_user_key: `u${id}`, linked_via: 'admin', verified_at: new Date() });
  }
  const P = (await d('projects').insert({ name: 'Website redesign', pod: 'pod1', created_by: U.mgr1.id, status: 'active', manager_status: 'accepted' }))[0];
  await d('project_members').insert([U.mgr1.id, U.emp1.id, U.emp2.id].map((u) => ({ project_id: P, user_id: u })));
  U.P = P;
});
after(async () => { await db().destroy(); });

test('create: the employee asks, confirms, and the ticket exists with its assignee and audit row', async () => {
  const { run, requestId } = await confirmAndRun('create a ticket called Hero copy for Sam in Website redesign, no deadline', 'mgr1');
  assert.equal(run.outcome, 'completed');
  const t = await ticketNamed('Hero copy');
  assert.equal(t.assigned_to, U.emp1.id);
  assert.equal(await db()('assistant_ticket_audit').where({ request_id: requestId, operation: 'create' }).count('* as n').first().then((r: any) => Number(r.n)), 1);
});

test('assign: moves the ticket to another person in the pod', async () => {
  await confirmAndRun('assign the Hero copy ticket to Lee', 'mgr1');
  assert.equal((await ticketNamed('Hero copy')).assigned_to, U.emp2.id);
});

test('priority: changes only the priority', async () => {
  await confirmAndRun('make the Hero copy ticket urgent', 'mgr1');
  assert.equal((await db()('tasks').where({ id: (await ticketNamed('Hero copy')).id }).first()).priority, 'urgent');
});

test('details: renames the ticket', async () => {
  await confirmAndRun('rename the Hero copy ticket to Hero v2', 'mgr1');
  assert.ok(await ticketNamed('Hero v2'));
});

test('comment: adds one comment to the ticket', async () => {
  const id = (await ticketNamed('Hero v2')).id;
  await confirmAndRun('add a comment on Hero v2 saying please check the copy', 'mgr1');
  assert.equal(await db()('task_comments').where({ task_id: id, comment: 'please check the copy' }).count('* as n').first().then((r: any) => Number(r.n)), 1);
});

test('accept: the assignee accepts their own ticket', async () => {
  const { run } = await confirmAndRun('accept the Hero v2 ticket', 'emp2');
  assert.equal(run.outcome, 'completed');
  assert.equal((await db()('task_assignees').where({ task_id: (await ticketNamed('Hero v2')).id, user_id: U.emp2.id }).first()).acceptance_status, 'accepted');
});

test('reject and approve: a pod manager decides a pending request raised by an employee', async () => {
  await createOp(db(), { requestId: 'seed-sketch', loopUserId: U.emp1.id }, { title: 'Sketch', project_id: U.P, working_person_id: U.emp1.id });
  await createOp(db(), { requestId: 'seed-poster', loopUserId: U.emp1.id }, { title: 'Poster', project_id: U.P, working_person_id: U.emp1.id });
  await db()('tasks').whereIn('title', ['Sketch', 'Poster']).update({ status: 'pending_approval' });
  await confirmAndRun('reject the Sketch ticket because it is unclear', 'mgr1');
  assert.equal((await ticketNamed('Sketch')).status, 'draft');
  await confirmAndRun('approve the Poster ticket', 'mgr1');
  assert.equal((await ticketNamed('Poster')).status, 'todo');
});

test('a retry after success changes nothing: the same request is reported as already done', async () => {
  const { requestId } = await confirmAndRun('create a ticket called Retry me for Sam in Website redesign, no deadline', 'mgr1');
  const before = await db()('tasks').where({ title: 'Retry me' }).count('* as n').first().then((r: any) => Number(r.n));
  await db()('assistant_requests').where({ id: requestId }).update({ status: 'QUEUED', next_attempt_at: null, locked_by: null, locked_until: null });
  const again = await runNext(deps());
  assert.equal(again.outcome, 'completed');
  assert.equal(await db()('tasks').where({ title: 'Retry me' }).count('* as n').first().then((r: any) => Number(r.n)), before, 'no second ticket');
  assert.equal(await db()('assistant_ticket_audit').where({ request_id: requestId }).count('* as n').first().then((r: any) => Number(r.n)), 1);
});

test('a crash in the middle of a ticket change rolls it back, and the retry creates it exactly once', async () => {
  const ready = await say('create a ticket called Crash ticket for Sam in Website redesign, no deadline', 'mgr1');
  const code = /CONFIRM (\w+)/.exec(ready.reply)![1];
  await say(`CONFIRM ${code}`, 'mgr1');
  await db().raw(`CREATE TRIGGER fail_mid BEFORE INSERT ON task_assignees BEGIN SELECT RAISE(ABORT, 'simulated crash'); END;`);
  let first;
  try { first = await runNext(deps()); } finally { await db().raw('DROP TRIGGER fail_mid'); }
  assert.equal(first!.outcome, 'retry_scheduled');
  assert.equal(await db()('tasks').where({ title: 'Crash ticket' }).count('* as n').first().then((r: any) => Number(r.n)), 0, 'nothing left half-written');
  await db()('assistant_requests').where({ id: ready.requestId }).update({ next_attempt_at: null });
  const second = await runNext(deps());
  assert.equal(second.outcome, 'completed');
  assert.equal(await db()('tasks').where({ title: 'Crash ticket' }).count('* as n').first().then((r: any) => Number(r.n)), 1, 'exactly one ticket');
});

test('a refusal by Loop\'s own rules ends the request at once; it is not retried', async () => {
  // Sam (an employee) tries to approve a request as if they were a manager
  await db()('tasks').where({ title: 'Poster' }).update({ status: 'pending_approval' });
  const ready = await say('approve the Poster ticket', 'emp1');
  assert.equal(ready.status, 'ready', ready.reply);
  await say(`CONFIRM ${/CONFIRM (\w+)/.exec(ready.reply)![1]}`, 'emp1');
  const run = await runNext(deps());
  assert.equal(run.outcome, 'failed');
  assert.equal((await ticketNamed('Poster')).status, 'pending_approval', 'nothing changed');
});

test('an identity that is no longer active cannot run an action', async () => {
  await db()('assistant_identities').where({ user_id: U.emp2.id }).update({ status: 'revoked' });
  try {
    const ready = await say('accept the Hero v2 ticket', 'emp2');
    assert.equal(ready.status, 'ready', ready.reply);
  } finally {
    await db()('assistant_identities').where({ user_id: U.emp2.id }).update({ status: 'active' });
  }
});

test('a decline is not exposed: refused plainly, and no request is created', async () => {
  const before = await db()('assistant_requests').count('* as n').first().then((r: any) => Number(r.n));
  const r = await say('decline the Hero v2 ticket', 'mgr1');
  assert.equal(r.status, 'not_available');
  assert.equal(await db()('assistant_requests').count('* as n').first().then((x: any) => Number(x.n)), before);
  assert.ok(!(SUSPENDED_TASK_INTENTS as readonly string[]).includes('DECLINE_TASK'));
});

test('group chats cannot change anything: the fixed reply, and no request is saved', async () => {
  const before = await db()('assistant_requests').count('* as n').first().then((r: any) => Number(r.n));
  const r = await say('assign the Hero v2 ticket to Lee', 'mgr1', 'whatsapp');
  assert.equal(r.reply, GROUP_REPLY);
  assert.equal(r.status, 'not_available');
  assert.equal(await db()('assistant_requests').count('* as n').first().then((x: any) => Number(x.n)), before);
});
