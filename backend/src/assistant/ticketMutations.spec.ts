/// <reference types="node" />
// Phase 5 step 3: every approved mutation rechecks identity and permission, changes data and its audit row together,
// is idempotent per request, sends nothing on rollback, and answers group channels with the fixed template.
process.env.SQLITE_FILE = ':memory:';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { initDB, getDB, inTransaction, createNotification } from '../db';
import { ServiceError } from '../services/access';
import { createTask } from '../services/tasks';
import {
  MUTATION_OPERATIONS, runMutation, createOp, assignOp, priorityOp, detailsOp, commentAddOp, commentEditOp,
  commentDeleteOp, acceptOp, decideOp, replyForMutation, replyForError,
} from './ticketMutations';
import { GROUP_REPLY } from './engine';

const U: Record<string, any> = {};
let P1 = 0;
let P2 = 0;
const db = () => getDB();
const count = async (table: string, where: object = {}) => Number(((await db()(table).where(where).count('* as n').first()) as any).n);
const rid = (k: string) => ({ requestId: randomUUID(), loopUserId: U[k].id });
const expectStatus = (p: Promise<unknown>, statuses: number[]) =>
  assert.rejects(p, (e: any) => e instanceof ServiceError && statuses.includes(e.status), `expected ${statuses.join('/')}`);

async function ticket(k: string, title: string, extra: Record<string, unknown> = {}) {
  const out = await createOp(db(), rid(k), { title, project_id: P1, working_person_id: U.emp1.id, task_manager_id: U.mgr1.id, priority: 'medium', ...extra });
  return out.taskId;
}
const row = (id: number) => db()('tasks').where({ id }).first();

before(async () => {
  await initDB();
  const d = db();
  for (const [k, role, pod] of [['admin', 'admin', null], ['mgr1', 'manager', 'pod1'], ['mgr2', 'manager', 'pod2'], ['emp1', 'employee', 'pod1'], ['emp2', 'employee', 'pod1'], ['out', 'employee', 'pod2']] as const) {
    const [id] = await d('users').insert({ name: k, email: `${k}@m.test`, password_hash: 'x', role, pod });
    U[k] = { id, role };
    await d('assistant_identities').insert({
      user_id: id, channel: 'simulator', external_sender_id: `sim-${k}`, status: 'active',
      active_sender_key: `simulator:sim-${k}`, active_user_key: `u${id}`, linked_via: 'admin', verified_at: new Date(),
    });
  }
  P1 = (await d('projects').insert({ name: 'P1', pod: 'pod1', created_by: U.admin.id, status: 'active', manager_status: 'accepted' }))[0];
  P2 = (await d('projects').insert({ name: 'P2', pod: 'pod2', created_by: U.admin.id, status: 'active', manager_status: 'accepted' }))[0];
  await d('project_members').insert([
    { project_id: P1, user_id: U.emp1.id }, { project_id: P1, user_id: U.emp2.id }, { project_id: P1, user_id: U.mgr1.id },
    { project_id: P2, user_id: U.mgr2.id }, { project_id: P2, user_id: U.out.id },
  ]);
});
after(async () => { await db().destroy(); });

test('decline is not an operation and cannot be run', async () => {
  assert.ok(!(MUTATION_OPERATIONS as readonly string[]).includes('decline'));
  await expectStatus(runMutation(db(), { ...rid('emp1'), operation: 'decline' as any }, async () => { throw new Error('never'); }), [400]);
});

test('create: a manager creates a ticket and its audit row is written with it', async () => {
  const r = rid('mgr1');
  const out = await createOp(db(), r, { title: 'Audited one', project_id: P1, working_person_id: U.emp1.id, priority: 'medium' });
  assert.equal(out.status, 'done');
  const audit = await db()('assistant_ticket_audit').where({ request_id: r.requestId, operation: 'create' }).first();
  assert.equal(audit.task_id, out.taskId);
  assert.equal(audit.before_json, null);
  assert.equal(JSON.parse(audit.after_json).title, 'Audited one');
});

test('create: a retry with the same request is a duplicate and creates nothing', async () => {
  const r = rid('mgr1');
  const first = await createOp(db(), r, { title: 'Retry me', project_id: P1, priority: 'low' });
  const before = await count('tasks', { project_id: P1 });
  const again = await createOp(db(), r, { title: 'Retry me', project_id: P1, priority: 'low' });
  assert.equal(again.status, 'duplicate');
  assert.equal(again.taskId, first.taskId);
  assert.equal(await count('tasks', { project_id: P1 }), before, 'no second ticket');
});

test('create: an employee creates a ticket that waits for approval', async () => {
  const out = await createOp(db(), rid('emp1'), { title: 'Employee idea', project_id: P1 });
  assert.equal((await row(out.taskId)).status, 'pending_approval');
});

test('identity: a revoked link stops every mutation at once', async () => {
  const [id] = await db()('users').insert({ name: 'gone', email: 'gone@m.test', password_hash: 'x', role: 'manager', pod: 'pod1' });
  await db()('assistant_identities').insert({ user_id: id, channel: 'simulator', external_sender_id: 'sim-gone', status: 'revoked', active_sender_key: null, active_user_key: null, linked_via: 'admin', verified_at: new Date() });
  const before = await count('tasks', { project_id: P1 });
  await expectStatus(createOp(db(), { requestId: randomUUID(), loopUserId: id }, { title: 'Nope', project_id: P1 }), [403]);
  assert.equal(await count('tasks', { project_id: P1 }), before);
});

test('priority: a manager changes it and the change is audited; an employee cannot', async () => {
  const id = await ticket('mgr1', 'Priority target');
  const r = rid('mgr1');
  const ok = await priorityOp(db(), r, id, { priority: 'urgent' });
  assert.equal(ok.status, 'done');
  assert.equal((await row(id)).priority, 'urgent');
  const audit = await db()('assistant_ticket_audit').where({ request_id: r.requestId, operation: 'priority' }).first();
  assert.deepEqual([JSON.parse(audit.before_json).priority, JSON.parse(audit.after_json).priority], ['medium', 'urgent']);
  const e = rid('emp1');
  await expectStatus(priorityOp(db(), e, id, { priority: 'low' }), [403, 404]);
  assert.equal((await row(id)).priority, 'urgent');
  assert.equal(await count('assistant_ticket_audit', { request_id: e.requestId }), 0);
});

test('priority: an unknown value is refused', async () => {
  const id = await ticket('mgr1', 'Bad priority');
  await expectStatus(priorityOp(db(), rid('mgr1'), id, { priority: 'extreme' }), [400]);
});

test('details: only title, description and due date change; empty or invalid input is refused', async () => {
  const id = await ticket('mgr1', 'Old title');
  await detailsOp(db(), rid('mgr1'), id, { title: 'New title', description: 'Details', due_date: '2026-12-01', status: 'completed' });
  const t = await row(id);
  assert.equal(t.title, 'New title');
  assert.equal(t.description, 'Details');
  assert.equal(String(t.due_date).slice(0, 10), '2026-12-01');
  assert.notEqual(t.status, 'completed', 'status is not reachable through details');
  await expectStatus(detailsOp(db(), rid('mgr1'), id, { status: 'completed' }), [400]);
  await expectStatus(detailsOp(db(), rid('mgr1'), id, { due_date: '01/12/2026' }), [400]);
  await expectStatus(detailsOp(db(), rid('mgr1'), id, { title: '   ' }), [400]);
  await expectStatus(detailsOp(db(), rid('emp1'), id, { title: 'Employee edit' }), [403, 404]);
});

test('assign: a manager reassigns; the manager on the ticket is kept; the new assignee is notified after commit', async () => {
  const id = await ticket('mgr1', 'Assign target');
  const before = await count('notifications', { user_id: U.emp2.id });
  await assignOp(db(), rid('mgr1'), id, { working_person_id: U.emp2.id });
  assert.equal((await row(id)).assigned_to, U.emp2.id);
  const mgr = await db()('task_assignees').where({ task_id: id, assignee_role: 'manager' }).first();
  assert.equal(mgr?.user_id, U.mgr1.id, 'manager assignee kept');
  assert.equal(await count('notifications', { user_id: U.emp2.id }), before + 1);
});

test('assign: an employee cannot assign, and a manager outside the pod cannot reassign', async () => {
  const id = await ticket('mgr1', 'Assign guarded');
  await expectStatus(assignOp(db(), rid('emp1'), id, { working_person_id: U.emp2.id }), [403, 404]);
  await expectStatus(assignOp(db(), rid('mgr2'), id, { working_person_id: U.emp2.id }), [403, 404]);
  assert.equal((await row(id)).assigned_to, U.emp1.id);
});

test('comments: the assignee adds, edits and deletes their own; others are refused; a retry is a duplicate', async () => {
  const id = await ticket('mgr1', 'Comment target');
  const added = rid('emp1');
  const c = await commentAddOp(db(), added, id, { comment: 'First note' });
  const commentId = (await db()('assistant_ticket_audit').where({ request_id: added.requestId, operation: 'comment_add' }).first()).after_json;
  const cid = JSON.parse(commentId).comment_id;
  assert.equal(c.status, 'done');
  assert.equal((await commentAddOp(db(), added, id, { comment: 'First note' })).status, 'duplicate');
  assert.equal(await count('task_comments', { task_id: id }), 1, 'the retry added no second comment');
  await commentEditOp(db(), rid('emp1'), id, { comment_id: cid, comment: 'Edited note' });
  assert.equal((await db()('task_comments').where({ id: cid }).first()).comment, 'Edited note');
  await expectStatus(commentEditOp(db(), rid('mgr1'), id, { comment_id: cid, comment: 'Manager edit' }), [403]);
  await expectStatus(commentAddOp(db(), rid('emp2'), id, { comment: 'Not mine to add' }), [404]);
  await commentDeleteOp(db(), rid('emp1'), id, { comment_id: cid });
  assert.equal(await count('task_comments', { id: cid }), 0);
});

test('accept: the assignee accepts; someone not assigned cannot; a retry is a duplicate', async () => {
  const id = await ticket('mgr1', 'Accept target');
  const r = rid('emp1');
  const ok = await acceptOp(db(), r, id);
  assert.equal(ok.status, 'done');
  assert.equal((await db()('task_assignees').where({ task_id: id, user_id: U.emp1.id }).first()).acceptance_status, 'accepted');
  assert.equal((await acceptOp(db(), r, id)).status, 'duplicate');
  await expectStatus(acceptOp(db(), rid('emp2'), id), [403, 404]);
});

test('approve and reject: a manager decides a pending request; an employee cannot; a retry is a duplicate', async () => {
  const pending = (await createOp(db(), rid('emp1'), { title: 'Pending A', project_id: P1 })).taskId;
  await expectStatus(decideOp(db(), rid('emp1'), pending, 'approve', {}), [403, 404]);
  const rej = rid('mgr1');
  const rejected = await decideOp(db(), rej, pending, 'reject', { comment: 'Needs detail' });
  assert.equal(rejected.status, 'done');
  assert.equal((await row(pending)).status, 'draft');
  assert.equal((await decideOp(db(), rej, pending, 'reject', {})).status, 'duplicate');

  const other = (await createOp(db(), rid('emp1'), { title: 'Pending B', project_id: P1 })).taskId;
  await decideOp(db(), rid('mgr1'), other, 'approve', {});
  assert.equal((await row(other)).status, 'todo');
});

test('atomicity: a failure after the change rolls back the change, its audit row and its notifications', async () => {
  const d = db();
  const r = rid('mgr1');
  await expectStatus(runMutation(d, { ...r, operation: 'create' }, async (trx) => {
    await createTask(trx, { id: U.mgr1.id, role: 'manager', name: 'mgr1' }, { title: 'ROLLED-TICKET', project_id: P1, working_person_id: U.emp1.id, priority: 'medium' });
    await createNotification(U.emp1.id, 'MARKER-ROLLED-MUTATION');
    throw new ServiceError(500, 'forced failure');
  }), [500]);
  assert.equal(await count('tasks', { title: 'ROLLED-TICKET' }), 0);
  assert.equal(await count('assistant_ticket_audit', { request_id: r.requestId }), 0);
  assert.equal(await count('notifications', { message: 'MARKER-ROLLED-MUTATION' }), 0);
});

test('group channels: every reply is the fixed template; private replies are short and fixed', async () => {
  const outcome = { status: 'done' as const, operation: 'assign' as const, taskId: 9 };
  assert.equal(replyForMutation(outcome, false), GROUP_REPLY);
  assert.equal(replyForError(new ServiceError(404, 'Not found'), false), GROUP_REPLY);
  assert.equal(replyForError(new Error('db exploded with SQLITE detail'), true), 'Something went wrong. Please try again.');
  assert.equal(replyForMutation(outcome, true), 'Ticket assigned.');
  assert.equal(replyForMutation({ ...outcome, status: 'duplicate' }, true), 'That was already done.');
  assert.ok(!/Title|#\d|\d+ tickets?/.test(replyForMutation(outcome, false)));
});
