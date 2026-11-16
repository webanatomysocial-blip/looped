/// <reference types="node" />
// Reassignment rules for plain tickets: same-pod changes apply at once; a cross-pod assignee holds the ticket for the
// other pod's manager, and only that decision applies or drops the change. Rollback, audit and notification timing
// are checked against the real database.
process.env.SQLITE_FILE = ':memory:';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { initDB, getDB } from '../db';
import { ServiceError } from './access';
import { createTask, updateTask } from './tasks';
import { managerApproveTask } from './taskWorkflow';
import { assignOp, replyForMutation } from '../assistant/ticketMutations';

const U: Record<string, any> = {};
const A = (k: string) => ({ id: U[k].id, role: U[k].role, name: k, pod: U[k].pod });
let P1 = 0;
const db = () => getDB();
const row = (id: number) => db()('tasks').where({ id }).first();
const count = async (table: string, where: object = {}) => Number(((await db()(table).where(where).count('* as n').first()) as any).n);
const notifs = (userId: number, like: string) => count('notifications', { user_id: userId }).then(() =>
  db()('notifications').where({ user_id: userId }).andWhere('message', 'like', like).count('* as n').first().then((r: any) => Number(r.n)));
const expectStatus = (p: Promise<unknown>, statuses: number[]) =>
  assert.rejects(p, (e: any) => e instanceof ServiceError && statuses.includes(e.status), `expected ${statuses.join('/')}`);

async function makeTicket(title: string) {
  const r = await createTask(db(), A('mgr1'), { title, project_id: P1, working_person_id: U.emp1.id, task_manager_id: U.mgr1.id, priority: 'medium' });
  return r.id;
}

before(async () => {
  await initDB();
  const d = db();
  for (const [k, role, pod] of [['admin', 'admin', null], ['mgr1', 'manager', 'pod1'], ['mgr2', 'manager', 'pod2'], ['emp1', 'employee', 'pod1'], ['emp1b', 'employee', 'pod1'], ['emp2', 'employee', 'pod2']] as const) {
    const [id] = await d('users').insert({ name: k, email: `${k}@r.test`, password_hash: 'x', role, pod });
    U[k] = { id, role, pod };
  }
  await d('assistant_identities').insert({ user_id: U.mgr1.id, channel: 'simulator', external_sender_id: 'sim-mgr1', status: 'active', active_sender_key: 'simulator:sim-mgr1', active_user_key: `u${U.mgr1.id}`, linked_via: 'admin', verified_at: new Date() });
  P1 = (await d('projects').insert({ name: 'P1', pod: 'pod1', created_by: U.admin.id, status: 'active', manager_status: 'accepted' }))[0];
  await d('project_members').insert([{ project_id: P1, user_id: U.emp1.id }, { project_id: P1, user_id: U.emp1b.id }, { project_id: P1, user_id: U.mgr1.id }]);
});
after(async () => { await db().destroy(); });

test('same-pod reassignment applies at once: no hold, manager kept, new assignee notified after commit', async () => {
  const id = await makeTicket('Same pod');
  const before = await count('notifications', { user_id: U.emp1b.id });
  await updateTask(db(), A('mgr1'), id, { working_person_id: U.emp1b.id, task_manager_id: U.mgr1.id });
  const t = await row(id);
  assert.equal(t.assigned_to, U.emp1b.id);
  assert.equal(t.status, 'todo');
  assert.equal(t.crosspod_pods, null);
  assert.equal(t.pending_assign, null);
  const mgr = await db()('task_assignees').where({ task_id: id, assignee_role: 'manager' }).first();
  assert.equal(mgr?.user_id, U.mgr1.id, 'manager assignee kept');
  assert.equal(await count('notifications', { user_id: U.emp1b.id }), before + 1);
});

test('cross-pod reassignment is held: the assignee stays, the ticket waits, the pod and reason are recorded, the other pod is told', async () => {
  const id = await makeTicket('Cross pod hold');
  await updateTask(db(), A('mgr1'), id, { working_person_id: U.emp2.id, task_manager_id: U.mgr1.id });
  const t = await row(id);
  assert.equal(t.assigned_to, U.emp1.id, 'assignee unchanged while held');
  assert.equal(t.status, 'pending_approval');
  assert.deepEqual(JSON.parse(t.crosspod_pods), ['pod2']);
  assert.ok(JSON.parse(t.crosspod_reasons).length >= 1, 'reason recorded');
  assert.equal(JSON.parse(t.pending_assign).working_person_id, U.emp2.id);
  assert.equal(t.pending_prev_status, 'todo');
  const emp = await db()('task_assignees').where({ task_id: id, assignee_role: 'employee' }).first();
  assert.equal(emp.user_id, U.emp1.id);
  assert.equal(await notifs(U.mgr2.id, 'Approval needed for "Cross pod hold"%'), 1, 'pod 2 manager told after commit');
});

test('a held ticket refuses a second cross-pod reassignment and any status change', async () => {
  const id = await makeTicket('Already held');
  await updateTask(db(), A('mgr1'), id, { working_person_id: U.emp2.id });
  await expectStatus(updateTask(db(), A('mgr1'), id, { working_person_id: U.emp2.id }), [409]);
  const other = await makeTicket('Status held');
  await updateTask(db(), A('mgr1'), other, { working_person_id: U.emp2.id });
  await expectStatus(updateTask(db(), A('mgr1'), other, { status: 'in_progress' }), [409]);
  assert.equal((await row(other)).status, 'pending_approval');
});

test('approval by the other pod applies the reassignment, restores the status, and tells the requester', async () => {
  const id = await makeTicket('Approve me');
  await updateTask(db(), A('mgr1'), id, { working_person_id: U.emp2.id });
  await managerApproveTask(db(), A('mgr2'), id, { action: 'approve' });
  const t = await row(id);
  assert.equal(t.assigned_to, U.emp2.id);
  assert.equal(t.status, 'todo');
  assert.equal(t.pending_assign, null);
  assert.equal(t.crosspod_pods, null);
  const emp = await db()('task_assignees').where({ task_id: id, assignee_role: 'employee' }).first();
  assert.equal(emp.user_id, U.emp2.id);
  assert.equal(await notifs(U.emp2.id, 'You have been assigned ticket "Approve me"%'), 1, 'new assignee told on approval');
  assert.equal(await notifs(U.mgr1.id, 'mgr2 approved the reassignment of "Approve me"%'), 1, 'requester told on approval');
});

test('rejection leaves the ticket as it was, restores the status, and tells the requester', async () => {
  const id = await makeTicket('Reject me');
  await updateTask(db(), A('mgr1'), id, { working_person_id: U.emp2.id });
  await managerApproveTask(db(), A('mgr2'), id, { action: 'reject', comment: 'Not this sprint' });
  const t = await row(id);
  assert.equal(t.assigned_to, U.emp1.id, 'original assignee kept');
  assert.equal(t.status, 'todo');
  assert.equal(t.pending_assign, null);
  assert.equal(t.crosspod_pods, null);
  assert.equal(await notifs(U.mgr1.id, 'mgr2 did not approve the reassignment of "Reject me"%'), 1);
});

test('only a manager of a waiting pod can decide; the requesting pod cannot approve its own reassignment', async () => {
  const id = await makeTicket('Not yours');
  await updateTask(db(), A('mgr1'), id, { working_person_id: U.emp2.id });
  await expectStatus(managerApproveTask(db(), A('mgr1'), id, { action: 'approve' }), [403]);
  assert.equal((await row(id)).status, 'pending_approval');
  assert.equal((await row(id)).assigned_to, U.emp1.id);
});

test('rollback: if the hold cannot be written, the reassignment, the other edits and the notifications are all dropped', async () => {
  const id = await makeTicket('Hold fails');
  await db().raw(`CREATE TRIGGER fail_hold BEFORE UPDATE OF pending_assign ON tasks WHEN NEW.pending_assign IS NOT NULL BEGIN SELECT RAISE(ABORT, 'forced hold failure'); END;`);
  try {
    await assert.rejects(updateTask(db(), A('mgr1'), id, { working_person_id: U.emp2.id, title: 'Renamed while failing' }), /forced hold failure/);
  } finally {
    await db().raw('DROP TRIGGER fail_hold');
  }
  const t = await row(id);
  assert.equal(t.title, 'Hold fails', 'other edit rolled back');
  assert.equal(t.assigned_to, U.emp1.id, 'assignee unchanged');
  assert.equal(t.status, 'todo', 'status unchanged');
  assert.equal(t.pending_assign, null);
  assert.equal(await notifs(U.mgr2.id, 'Approval needed for "Hold fails"%'), 0, 'no hold notification for a rolled-back hold');
});

test('audit and duplicate retry: the assist assign records before and after, and a retry does not hold twice', async () => {
  const id = await makeTicket('Audited assign');
  const req = { requestId: randomUUID(), loopUserId: U.mgr1.id, operation: 'assign' as const };
  const first = await assignOp(db(), { requestId: req.requestId, loopUserId: req.loopUserId }, id, { working_person_id: U.emp2.id });
  assert.equal(first.status, 'done');
  assert.equal(first.result?.awaiting_approval, true);
  const audit = await db()('assistant_ticket_audit').where({ request_id: req.requestId, operation: 'assign' }).first();
  assert.equal(JSON.parse(audit.before_json).assigned_to, U.emp1.id);
  assert.equal(JSON.parse(audit.after_json).status, 'pending_approval');
  assert.equal(JSON.parse(audit.after_json).assigned_to, U.emp1.id, 'audit shows the assignee did not change yet');
  const again = await assignOp(db(), { requestId: req.requestId, loopUserId: req.loopUserId }, id, { working_person_id: U.emp2.id });
  assert.equal(again.status, 'duplicate');
  assert.equal(await notifs(U.mgr2.id, 'Approval needed for "Audited assign"%'), 1, 'one hold, one notification');
});

test('a held reassignment is reported as sent for approval, not as assigned', () => {
  const held = { status: 'done' as const, operation: 'assign' as const, taskId: 1, result: { awaiting_approval: true } };
  assert.equal(replyForMutation(held, true), 'Sent to the other pod for approval.');
});
