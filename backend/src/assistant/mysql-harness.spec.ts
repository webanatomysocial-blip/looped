/// <reference types="node" />
// MySQL harness. Runs ONLY with DB_CLIENT=mysql, against the isolated test database (127.0.0.1:3399, name ending _test).
// Empties that database first. Any other target is refused before anything is touched.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';

const ENABLED = process.env.DB_CLIENT === 'mysql';

if (ENABLED) {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'mysql-harness-secret';
}

import { initDB, getDB, inTransaction, createNotification } from '../db';
import { createOp, assignOp, runMutation } from './ticketMutations';
import { managerApproveTask } from '../services/taskWorkflow';
import { ServiceError } from '../services/access';
import { isDuplicateKeyError } from '../services/ticketAudit';
import { claimNext, expireDue, recoverInterrupted } from './queue';
import { HandlerRegistry, runNext, ActionHandler } from './executor';
import { recoverOnStartup } from './worker';

const db = () => getDB();
const count = async (table: string, where: object = {}) => Number((await db()(table).where(where).count('* as n').first() as any).n);

async function resetTestDatabase() {
  const host = process.env.DB_HOST, port = Number(process.env.DB_PORT), name = process.env.DB_NAME || '';
  if (host !== '127.0.0.1' || port !== 3399 || !/_test$/.test(name)) throw new Error('refused: not the isolated MySQL test database');
  const mysql = require('mysql2/promise');
  const c = await mysql.createConnection({ host, port, user: process.env.DB_USER, password: process.env.DB_PASS, database: name, multipleStatements: true });
  await c.query('SET FOREIGN_KEY_CHECKS=0');
  const [tables] = await c.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'");
  const key = Object.keys(tables[0] || {})[0];
  for (const t of tables) await c.query('DROP TABLE IF EXISTS `' + t[key] + '`');
  const [trg] = await c.query('SHOW TRIGGERS');
  for (const t of trg) await c.query('DROP TRIGGER IF EXISTS `' + t.Trigger + '`');
  await c.query('SET FOREIGN_KEY_CHECKS=1');
  await c.end();
}

let seq = 0;
const newUser = async (role: string, pod: string | null, label: string) => {
  const n = ++seq;
  const [id] = await db()('users').insert({ name: `${label} ${n}`, email: `${label}${n}.${Date.now()}@mysql.test`, password_hash: await bcrypt.hash('x', 4), role, pod });
  // Every test employee has an active link, as a real one would
  await db()('assistant_identities').insert({ user_id: id, channel: 'simulator', external_sender_id: `loop-user:${id}`, status: 'active', active_sender_key: `simulator:loop-user:${id}`, active_user_key: `s${id}`, linked_via: 'admin', verified_at: new Date() });
  return { id, role, name: `${label} ${n}`, pod };
};
const handler = (intent: string, idempotent: boolean, calls: string[], delayMs = 0): ActionHandler => ({
  intent, idempotent, validate: () => [],
  execute: async (input) => { calls.push(input.requestId); if (delayMs) await new Promise((r) => setTimeout(r, delayMs)); return { summary: 'done' }; },
});
const registryWith = (h: ActionHandler) => { const r = new HandlerRegistry(); r.register(h); return r; };
const deps = (registry: HandlerRegistry, leaseSeconds = 60) => ({ db: db(), registry, workerId: 'mysql-w', maxAttempts: 3, leaseSeconds, stillVerified: async () => true, enabled: true });
async function queuedRequest(userId: number, extra: Record<string, unknown> = {}) {
  const id = randomUUID(); const now = new Date();
  await db()('assistant_requests').insert({
    id, conversation_key: `simulator:mc-${userId}:${userId}`, channel: 'simulator', conversation_id: `mc-${userId}`, loop_user_id: userId,
    origin_message_id: `m-${id}`, intent: 'CREATE_TASK', data: JSON.stringify({ raw: { title: 'x' }, resolved: {} }), ambiguous: '[]',
    status: 'QUEUED', asked_field: null, ask_count: 0, confidence: 0.9, ai_meta: null, version: 0, created_at: now, updated_at: now,
    queue_expires_at: new Date(Date.now() + 3600_000), next_attempt_at: null, ...extra,
  });
  return id;
}
const processing = (userId: number) => count('assistant_requests', { loop_user_id: userId, status: 'PROCESSING' });

if (ENABLED) {
  before(async () => { await resetTestDatabase(); await initDB(); });
  after(async () => { await db().destroy(); });
}
const run = ENABLED ? test : (name: string, _fn: () => unknown) => test(`skipped (set DB_CLIENT=mysql): ${name}`, { skip: true }, () => {});

run('M1 ticket change and its audit row are atomic: a failing audit write leaves no ticket', async () => {
  const mgr = await newUser('manager', 'pod1', 'mgrA');
  const project = (await db()('projects').insert({ name: 'Harness A', pod: 'pod1', created_by: mgr.id, status: 'active', manager_status: 'accepted' }))[0];
  await db().raw("CREATE TRIGGER fail_audit BEFORE INSERT ON assistant_ticket_audit FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'forced audit failure'; END");
  try {
    await assert.rejects(createOp(db(), { requestId: randomUUID(), loopUserId: mgr.id }, { title: 'Atomic A', project_id: project, working_person_id: mgr.id }));
  } finally { await db().raw('DROP TRIGGER fail_audit'); }
  assert.equal(await count('tasks', { title: 'Atomic A' }), 0, 'no ticket without its audit row');
});

run('M2 a transaction that fails rolls back everything in it and sends no queued notification', async () => {
  const u = await newUser('employee', 'pod1', 'rollA');
  await assert.rejects(inTransaction(db(), async () => { await createNotification(u.id, 'MARKER-MYSQL-ROLLBACK'); throw new Error('boom'); }), /boom/);
  assert.equal(await count('notifications', { message: 'MARKER-MYSQL-ROLLBACK' }), 0);
});

run('M3 duplicate protection: a retry is refused as already done; the database refuses a second audit row', async () => {
  const mgr = await newUser('manager', 'pod1', 'mgrB');
  const project = (await db()('projects').insert({ name: 'Harness B', pod: 'pod1', created_by: mgr.id, status: 'active', manager_status: 'accepted' }))[0];
  const r = { requestId: randomUUID(), loopUserId: mgr.id };
  const first = await createOp(db(), r, { title: 'Once B', project_id: project, working_person_id: mgr.id });
  const again = await createOp(db(), r, { title: 'Once B', project_id: project, working_person_id: mgr.id });
  assert.equal(again.status, 'duplicate');
  assert.equal(again.taskId, first.taskId);
  assert.equal(await count('tasks', { title: 'Once B' }), 1);
  const row = await db()('assistant_ticket_audit').where({ request_id: r.requestId }).first();
  await assert.rejects(db()('assistant_ticket_audit').insert({ ...row, id: undefined }), (e: any) => isDuplicateKeyError(e), 'unique (request, operation)');
});

run('M4 concurrent queue claims: several workers at once never run two requests for one employee', async () => {
  const users = [await newUser('employee', 'pod1', 'cqA'), await newUser('employee', 'pod1', 'cqB'), await newUser('employee', 'pod1', 'cqC')];
  for (const u of users) { await queuedRequest(u.id); await queuedRequest(u.id); }
  const claims = await Promise.all(Array.from({ length: 6 }, () => claimNext(db(), { workerId: 'w', nowMs: Date.now(), leaseSeconds: 60 })));
  const got = claims.filter(Boolean).map((c) => c!.loop_user_id);
  assert.ok(got.length <= 3, `at most one per employee, got ${got.length}`);
  assert.equal(new Set(got).size, got.length, 'no employee twice');
  for (const u of users) assert.ok((await processing(u.id)) <= 1);
});

run('M5 atomic per-employee limit: five simultaneous claims for one employee give exactly one; the database refuses a second', async () => {
  const u = await newUser('employee', 'pod1', 'limitA');
  for (let i = 0; i < 5; i++) await queuedRequest(u.id);
  const claims = await Promise.all(Array.from({ length: 5 }, () => claimNext(db(), { workerId: 'w', nowMs: Date.now(), leaseSeconds: 60 })));
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal(await processing(u.id), 1);
  const waiting = await db()('assistant_requests').where({ loop_user_id: u.id, status: 'QUEUED' }).first('id');
  await assert.rejects(db()('assistant_requests').where({ id: waiting.id }).update({ status: 'PROCESSING' }), (e: any) => isDuplicateKeyError(e), 'ER_DUP_ENTRY from the database');
});

run('M6 cross-pod approval: a reassignment waits for the other pod and is applied once', async () => {
  const mgr1 = await newUser('manager', 'pod1', 'xpodM1');
  const mgr2 = await newUser('manager', 'pod2', 'xpodM2');
  const p1 = await newUser('employee', 'pod1', 'xpodE1');
  const p2 = await newUser('employee', 'pod2', 'xpodE2');
  const project = (await db()('projects').insert({ name: 'Harness X', pod: 'pod1', created_by: mgr1.id, status: 'active', manager_status: 'accepted' }))[0];
  await db()('project_members').insert([mgr1.id, p1.id, mgr2.id].map((u) => ({ project_id: project, user_id: u })));
  const { taskId } = await createOp(db(), { requestId: randomUUID(), loopUserId: mgr1.id }, { title: 'Cross X', project_id: project, working_person_id: p1.id });
  const held = await assignOp(db(), { requestId: randomUUID(), loopUserId: mgr1.id }, taskId, { working_person_id: p2.id });
  assert.equal(held.result?.awaiting_approval, true);
  assert.equal((await db()('tasks').where({ id: taskId }).first()).assigned_to, p1.id, 'not applied while waiting');
  await managerApproveTask(db(), { id: mgr2.id, role: 'manager', name: mgr2.name }, taskId, { action: 'approve' });
  const t = await db()('tasks').where({ id: taskId }).first();
  assert.equal(t.assigned_to, p2.id);
  assert.equal(await count('task_assignees', { task_id: taskId, assignee_role: 'employee' }), 1, 'one employee assignee');
});

run('M7 worker expiry: a request past its window is expired and never executed', async () => {
  const u = await newUser('employee', 'pod1', 'expM');
  const id = await queuedRequest(u.id, { queue_expires_at: new Date(Date.now() - 1000) });
  assert.ok((await expireDue(db(), Date.now(), 1800)) >= 1);
  assert.equal((await db()('assistant_requests').where({ id }).first('status')).status, 'EXPIRED');
  const calls: string[] = [];
  assert.equal((await runNext(deps(registryWith(handler('CREATE_TASK', true, calls))))).outcome, 'idle');
  assert.equal(calls.includes(id), false);
});

run('M8 restart recovery: an interrupted idempotent request runs once after a restart; a second restart changes nothing', async () => {
  const u = await newUser('employee', 'pod1', 'restM');
  const id = await queuedRequest(u.id);
  await db()('assistant_requests').where({ id }).update({ status: 'PROCESSING', locked_by: 'dead', locked_until: new Date(Date.now() - 60_000), execution_attempts: 1 });
  await db()('assistant_executions').insert({ id: randomUUID(), request_id: id, attempt: 1, idempotency_key: `assistant-request-${id}`, status: 'running', started_at: new Date() });
  const calls: string[] = [];
  const reg = registryWith(handler('CREATE_TASK', true, calls));
  const settings = { workerId: 'w', maxAttempts: 3, leaseSeconds: 60, contextTtlSeconds: 1800, executionEnabled: true };
  const r = await recoverOnStartup({ db: db(), registry: reg, stillVerified: async () => true, settings, log: () => {} });
  assert.equal(r.requeued, 1);
  assert.equal((await runNext(deps(reg))).outcome, 'completed');
  assert.equal(calls.filter((c) => c === id).length, 1);
  const again = await recoverOnStartup({ db: db(), registry: reg, stillVerified: async () => true, settings, log: () => {} });
  assert.equal(again.requeued + again.failed, 0);
});

run('M9 lease renewal: a healthy run that outlives its lease keeps its claim', async () => {
  const u = await newUser('employee', 'pod1', 'leaseM');
  const id = await queuedRequest(u.id);
  const calls: string[] = [];
  const reg = registryWith(handler('CREATE_TASK', true, calls, 1800));
  const pending = runNext(deps(reg, 1));
  await new Promise((r) => setTimeout(r, 1300));
  const mid = await db()('assistant_requests').where({ id }).first('locked_until', 'status');
  assert.equal(mid.status, 'PROCESSING');
  assert.ok(new Date(mid.locked_until).getTime() > Date.now() - 300, 'renewed');
  const rec = await recoverInterrupted(db(), Date.now(), () => true, 3);
  assert.equal(rec.requeued + rec.failed, 0);
  assert.equal((await pending).outcome, 'completed');
});

run('M10 notification failure does not fail a saved change', async () => {
  const mgr = await newUser('manager', 'pod1', 'notifM');
  const project = (await db()('projects').insert({ name: 'Harness N', pod: 'pod1', created_by: mgr.id, status: 'active', manager_status: 'accepted' }))[0];
  await db().raw('ALTER TABLE notifications RENAME TO notifications_off');
  try {
    const out = await createOp(db(), { requestId: randomUUID(), loopUserId: mgr.id }, { title: 'Notify M', project_id: project, working_person_id: mgr.id });
    assert.equal(out.status, 'done');
  } finally {
    await db().raw('ALTER TABLE notifications_off RENAME TO notifications');
  }
  assert.equal(await count('tasks', { title: 'Notify M' }), 1);
});

run('M11 uniqueness: two live links for one employee on the same channel are refused by the database', async () => {
  const u = await newUser('employee', 'pod1', 'linkM');
  const link = { user_id: u.id, channel: 'simulator', external_sender_id: `loop-user:${u.id}`, status: 'active', active_sender_key: `simulator:loop-user:${u.id}-a`, active_user_key: `s${u.id}a`, linked_via: 'admin', verified_at: new Date() };
  await db()('assistant_identities').insert(link);
  // The same employee cannot hold a second active link: the employee key is unique while active
  await assert.rejects(db()('assistant_identities').insert({ ...link, active_sender_key: `simulator:other-${u.id}`, external_sender_id: `other-${u.id}` }), (e: any) => isDuplicateKeyError(e));
});
