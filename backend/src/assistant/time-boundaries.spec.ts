/// <reference types="node" />
// Time tracking and financial boundaries. Ticket operations that stop or pause a running timer use the existing
// services and the same transaction. Nothing financial reaches the assistant's replies, reads or audit rows.
process.env.SQLITE_FILE = ':memory:';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { initDB, getDB } from '../db';
import { createTask } from '../services/tasks';
import { assignOp, replyForMutation, replyForError, MutationOutcome } from './ticketMutations';
import { viewTicket, searchTickets } from '../services/ticketReads';
import { GROUP_REPLY } from './engine';
import { ServiceError } from '../services/access';

const U: Record<string, any> = {};
const A = (k: string) => ({ id: U[k].id, role: U[k].role, name: k, pod: U[k].pod });
let P1 = 0;
const db = () => getDB();
const HOUR = 3600000;
const rid = () => ({ requestId: randomUUID(), loopUserId: U.mgr1.id });
const count = async (table: string, where: object = {}) => Number(((await db()(table).where(where).count('* as n').first()) as any).n);
const sumHours = async (where: object) => Number(((await db()('time_logs').where(where).sum('hours as h').first()) as any).h ?? 0);

async function openSession(userId: number, taskId: number, hoursAgo: number) {
  await db()('task_sessions').insert({ task_id: taskId, user_id: userId, started_at: Date.now() - hoursAgo * HOUR, ended_at: null, session_date: new Date().toISOString().slice(0, 10), stage_idx: null });
}
// A high-priority ticket with no assignee yet: giving it to someone is what pauses that person's running timers
async function ticket(title: string) {
  return (await createTask(db(), A('admin'), { title, project_id: P1, priority: 'high' })).id;
}
async function ownTicket(title: string) {
  return (await createTask(db(), A('admin'), { title, project_id: P1, working_person_id: U.emp1.id, priority: 'medium' })).id;
}

before(async () => {
  await initDB();
  const d = db();
  for (const [k, role, pod, salary] of [
    ['admin', 'admin', null, null], ['mgr1', 'manager', 'pod1', null], ['emp1', 'employee', 'pod1', null],
    ['emp1b', 'employee', 'pod1', 70000], ['emp2', 'employee', 'pod2', null],
  ] as const) {
    const [id] = await d('users').insert({ name: k, email: `${k}@tb.test`, password_hash: 'x', role, pod, monthly_salary: salary });
    U[k] = { id, role, pod };
  }
  await d('assistant_identities').insert({ user_id: U.mgr1.id, channel: 'simulator', external_sender_id: 'sim-mgr1', status: 'active', active_sender_key: 'simulator:sim-mgr1', active_user_key: `u${U.mgr1.id}`, linked_via: 'admin', verified_at: new Date() });
  P1 = (await d('projects').insert({ name: 'P1', pod: 'pod1', created_by: U.admin.id, status: 'active', manager_status: 'accepted' }))[0];
  await d('project_members').insert([{ project_id: P1, user_id: U.emp1.id }, { project_id: P1, user_id: U.emp1b.id }, { project_id: P1, user_id: U.mgr1.id }]);
});
after(async () => { await db().destroy(); });

test('1. a running session stopped by a ticket change records the elapsed time, and the pay rate from the existing formula', async () => {
  const running = await ownTicket('Running A');
  const next = await ticket('High priority A');
  await openSession(U.emp1b.id, running, 2);
  const out = await assignOp(db(), rid(), next, { working_person_id: U.emp1b.id });
  assert.equal(out.status, 'done');
  assert.equal(await count('task_sessions', { task_id: running, ended_at: null }), 0, 'session stopped');
  const log = await db()('time_logs').where({ task_id: running, user_id: U.emp1b.id }).first();
  assert.ok(log, 'time logged');
  assert.ok(Math.abs(Number(log.hours) - 2) < 0.05, `about 2 hours, got ${log.hours}`);
  const days = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  assert.ok(Math.abs(Number(log.hourly_rate) - 70000 / days / 7) < 0.01, 'rate uses the existing formula');
});

test('2. a cross-pod approval hold stops the running session and records the elapsed time', async () => {
  const id = await ownTicket('Hold stops clock');
  await openSession(U.emp1.id, id, 1);
  const out = await assignOp(db(), rid(), id, { working_person_id: U.emp2.id });
  assert.equal(out.result?.awaiting_approval, true);
  assert.equal(await count('task_sessions', { task_id: id, ended_at: null }), 0, 'clock stopped by the hold');
  const log = await db()('time_logs').where({ task_id: id, user_id: U.emp1.id }).first();
  assert.ok(log && Math.abs(Number(log.hours) - 1) < 0.05, 'elapsed time recorded');
  assert.match(log.notes, /reassignment approval/);
});

test('3. a retry of the same request creates no duplicate time log and adds no duplicate duration', async () => {
  const running = await ownTicket('Retry running');
  const next = await ticket('Retry high');
  await openSession(U.emp1b.id, running, 1);
  const r = rid();
  await assignOp(db(), r, next, { working_person_id: U.emp1b.id });
  const logsBefore = await count('time_logs', { task_id: running });
  const hoursBefore = await sumHours({ task_id: running });
  const again = await assignOp(db(), r, next, { working_person_id: U.emp1b.id });
  assert.equal(again.status, 'duplicate');
  assert.equal(await count('time_logs', { task_id: running }), logsBefore);
  assert.equal(await sumHours({ task_id: running }), hoursBefore);
});

test('4. a failed ticket operation leaves no partial time change: the session keeps running and nothing is logged', async () => {
  const running = await ownTicket('Rollback running');
  const next = await ticket('Rollback high');
  await openSession(U.emp1b.id, running, 1);
  const r = rid();
  await db().raw(`CREATE TRIGGER fail_time BEFORE INSERT ON time_logs BEGIN SELECT RAISE(ABORT, 'forced time failure'); END;`);
  try {
    await assert.rejects(assignOp(db(), r, next, { working_person_id: U.emp1b.id }), /forced time failure/);
  } finally {
    await db().raw('DROP TRIGGER fail_time');
  }
  assert.equal(await count('task_sessions', { task_id: running, ended_at: null }), 1, 'session still running');
  assert.equal(await count('time_logs', { task_id: running }), 0);
  assert.equal((await db()('tasks').where({ id: next }).first()).assigned_to, null, 'assignee unchanged (still unassigned)');
  assert.equal(await count('assistant_ticket_audit', { request_id: r.requestId }), 0, 'no audit row');
});

test('5. group replies never carry time, pay or financial information', () => {
  const outcomes: MutationOutcome[] = [
    { status: 'done', operation: 'assign', taskId: 1, result: { awaiting_approval: true } },
    { status: 'done', operation: 'priority', taskId: 1 },
    { status: 'duplicate', operation: 'accept', taskId: 1 },
  ];
  const money = /\d|₹|\$|hour|rate|salary|pay|cost|invoice|budget|payroll|tracked|minute/i;
  for (const o of outcomes) assert.equal(replyForMutation(o, false), GROUP_REPLY);
  for (const e of [new ServiceError(403, 'Not allowed'), new Error('hourly_rate 500')]) {
    const reply = replyForError(e, false);
    assert.equal(reply, GROUP_REPLY);
    assert.ok(!money.test(reply));
  }
  assert.ok(!money.test(GROUP_REPLY));
});

test('boundary: assistant reads and audit rows hold only approved ticket fields', async () => {
  const id = await ownTicket('Boundary check');
  await openSession(U.emp1.id, id, 1);
  const detail = await viewTicket(db(), A('mgr1'), id);
  const found = await searchTickets(db(), A('mgr1'), 'Boundary check');
  const banned = /rate|salary|hour|pay|cost|invoice|budget|payroll|tracked|time/i;
  const allowed = ['id', 'title', 'status', 'priority', 'due_date', 'project', 'assignee', 'description', 'estimated_hours', 'checklist_done', 'checklist_total'];
  assert.deepEqual(Object.keys(detail).sort(), allowed.sort());
  for (const item of found.items) for (const k of Object.keys(item)) assert.ok(!banned.test(k), `search key ${k}`);
  const audit = await db()('assistant_ticket_audit').select('after_json', 'before_json');
  for (const row of audit) for (const json of [row.after_json, row.before_json]) if (json) assert.ok(!banned.test(json), `audit leaks: ${json}`);
});
