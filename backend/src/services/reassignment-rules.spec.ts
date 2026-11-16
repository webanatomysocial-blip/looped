/// <reference types="node" />
// Reassignment approval rules, held-ticket timers, multi-pod decisions, and the client ticket list.
process.env.SQLITE_FILE = ':memory:';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDB, getDB } from '../db';
import { ServiceError } from './access';
import { createTask, updateTask, listTasks } from './tasks';
import { managerApproveTask } from './taskWorkflow';
import { timerAction, acceptTask } from './taskWorkflow';

const U: Record<string, any> = {};
const A = (k: string) => ({ id: U[k].id, role: U[k].role, name: k, pod: U[k].pod });
const P: Record<string, number> = {};
const db = () => getDB();
const row = (id: number) => db()('tasks').where({ id }).first();
const count = async (table: string, where: object = {}) => Number(((await db()(table).where(where).count('* as n').first()) as any).n);
const notifs = (userId: number, like: string) => db()('notifications').where({ user_id: userId }).andWhere('message', 'like', like).count('* as n').first().then((r: any) => Number(r.n));
const sorted = (v: unknown) => JSON.parse(String(v)).slice().sort();
const expectStatus = (p: Promise<unknown>, statuses: number[]) =>
  assert.rejects(p, (e: any) => e instanceof ServiceError && statuses.includes(e.status), `expected ${statuses.join('/')}`);

// Created by admin: admins are exempt from approval, so the ticket starts without a hold
async function makeTicket(project: string, worker: string, title: string) {
  const r = await createTask(db(), A('admin'), { title, project_id: P[project], working_person_id: U[worker].id, priority: 'medium' });
  return r.id;
}

before(async () => {
  await initDB();
  const d = db();
  for (const [k, role, pod] of [
    ['admin', 'admin', null], ['mgr1', 'manager', 'pod1'], ['mgr2', 'manager', 'pod2'], ['mgr3', 'manager', 'pod3'],
    ['emp1', 'employee', 'pod1'], ['emp1b', 'employee', 'pod1'], ['emp2', 'employee', 'pod2'], ['emp2b', 'employee', 'pod2'],
    ['client1', 'client', null],
  ] as const) {
    const [id] = await d('users').insert({ name: k, email: `${k}@rr.test`, password_hash: 'x', role, pod });
    U[k] = { id, role, pod };
  }
  for (const [name, pod] of [['P1', 'pod1'], ['P2', 'pod2'], ['P3', 'pod3']]) {
    P[name] = (await d('projects').insert({ name, pod, created_by: U.admin.id, status: 'active', manager_status: 'accepted' }))[0];
  }
  const members: [string, string][] = [
    ['P1', 'mgr1'], ['P1', 'emp1'], ['P1', 'emp1b'], ['P1', 'client1'],
    ['P2', 'mgr1'], ['P2', 'mgr2'], ['P2', 'emp2'], ['P2', 'emp2b'],
    ['P3', 'mgr1'], ['P3', 'mgr3'], ['P3', 'emp1'], ['P3', 'emp2'],
  ];
  await d('project_members').insert(members.map(([p, u]) => ({ project_id: P[p], user_id: U[u].id })));
});
after(async () => { await db().destroy(); });

// ── Item 6: the same approval rule as creation ──

test('same-pod assignee on another pod\'s project is held, exactly as creating it would be', async () => {
  const id = await makeTicket('P2', 'emp2', 'Other project, own pod person');
  await updateTask(db(), A('mgr1'), id, { working_person_id: U.emp1.id });
  const held = sorted((await row(id)).crosspod_pods);
  const created = await createTask(db(), A('mgr1'), { title: 'Creation check A', project_id: P.P2, working_person_id: U.emp1.id, priority: 'medium' });
  assert.deepEqual(held, sorted((await row(created.id)).crosspod_pods ?? JSON.stringify(created.crosspod_pending)));
  assert.deepEqual(held, ['pod2']);
});

test('cross-pod assignee on own project is held, exactly as creating it would be', async () => {
  const id = await makeTicket('P1', 'emp1', 'Own project, other pod person');
  await updateTask(db(), A('mgr1'), id, { working_person_id: U.emp2.id });
  const created = await createTask(db(), A('mgr1'), { title: 'Creation check B', project_id: P.P1, working_person_id: U.emp2.id, priority: 'medium' });
  assert.deepEqual(sorted((await row(id)).crosspod_pods), sorted(JSON.stringify(created.crosspod_pending)));
  assert.deepEqual(sorted((await row(id)).crosspod_pods), ['pod2']);
});

test('same-pod assignee on own project is not held', async () => {
  const id = await makeTicket('P1', 'emp1', 'Own project, own pod');
  await updateTask(db(), A('mgr1'), id, { working_person_id: U.emp1b.id });
  const t = await row(id);
  assert.equal(t.assigned_to, U.emp1b.id);
  assert.equal(t.crosspod_pods, null);
  assert.equal(t.status, 'todo');
  const created = await createTask(db(), A('mgr1'), { title: 'Creation check C', project_id: P.P1, working_person_id: U.emp1b.id, priority: 'medium' });
  assert.equal(created.crosspod_pending, undefined);
});

test('an admin reassignment is exempt, as admin creation is', async () => {
  const id = await makeTicket('P1', 'emp1', 'Admin moves it');
  await updateTask(db(), A('admin'), id, { working_person_id: U.emp2.id });
  assert.equal((await row(id)).assigned_to, U.emp2.id);
  assert.equal((await row(id)).crosspod_pods, null);
});

// ── Item 4: timers on a ticket waiting for a reassignment decision ──

test('a held ticket: the old assignee cannot start, resume or finish; pausing still works; the running clock is stopped', async () => {
  const id = await makeTicket('P1', 'emp1', 'Timer on hold');
  await acceptTask(db(), A('emp1'), id, { action: 'accept' }).catch(() => undefined); // required assignee accepts first
  await timerAction(db(), A('emp1'), id, { action: 'start' });
  assert.equal(await count('task_sessions', { task_id: id, user_id: U.emp1.id, ended_at: null }), 1);
  await updateTask(db(), A('mgr1'), id, { working_person_id: U.emp2.id });
  assert.equal(await count('task_sessions', { task_id: id, ended_at: null }), 0, 'running clock stopped by the hold');
  // The old assignee cannot see a ticket that is awaiting approval (existing rule), so they are refused outright
  await expectStatus(timerAction(db(), A('emp1'), id, { action: 'start' }), [404, 409]);
  await expectStatus(timerAction(db(), A('emp1'), id, { action: 'done' }), [404, 409]);
  // The guard itself, shown with a user who can see the ticket: a manager cannot start or finish it either
  await expectStatus(timerAction(db(), A('mgr1'), id, { action: 'start' }), [409]);
  await expectStatus(timerAction(db(), A('mgr1'), id, { action: 'done' }), [409]);
  // emp2 is only pending on the ticket, so the ticket is not visible to them yet (404)
  await expectStatus(timerAction(db(), A('emp2'), id, { action: 'start' }), [404, 409]);
  // Pausing is still allowed (it only stops a clock): the manager can do it; the clock was already stopped by the hold
  await timerAction(db(), A('mgr1'), id, { action: 'pause' });
  assert.equal(await count('task_sessions', { task_id: id, ended_at: null }), 0);
  assert.equal((await row(id)).status, 'pending_approval', 'status not overwritten by a timer');
});

test('normal timer behaviour is unchanged on a ticket that is not held', async () => {
  const id = await makeTicket('P1', 'emp1', 'Timer normal');
  await acceptTask(db(), A('emp1'), id, { action: 'accept' }).catch(() => undefined); // required assignee accepts first
  await timerAction(db(), A('emp1'), id, { action: 'start' });
  assert.equal(await count('task_sessions', { task_id: id, user_id: U.emp1.id, ended_at: null }), 1);
  await timerAction(db(), A('emp1'), id, { action: 'pause' });
  await acceptTask(db(), A('emp1'), id, { action: 'accept' }).catch(() => undefined); // required assignee accepts first
  await timerAction(db(), A('emp1'), id, { action: 'start' });
  await timerAction(db(), A('emp1'), id, { action: 'done' });
  assert.equal((await row(id)).status, 'in_review');
});

// ── Item 5: several pods must approve; the change applies once, after the last one ──

async function multiPodHold(title: string) {
  const id = await makeTicket('P3', 'emp1', title);
  await updateTask(db(), A('mgr1'), id, { working_person_id: U.emp2.id });
  return id;
}

test('multi-pod: the pods waiting are recorded, and only those managers can decide', async () => {
  const id = await multiPodHold('Multi pod A');
  assert.deepEqual(sorted((await row(id)).crosspod_pods), ['pod2', 'pod3']);
  await expectStatus(managerApproveTask(db(), A('mgr1'), id, { action: 'approve' }), [403]);
});

test('multi-pod: one approval does not activate the reassignment while another pod is still pending', async () => {
  const id = await multiPodHold('Multi pod B');
  const before = await count('notifications', { user_id: U.mgr1.id });
  await managerApproveTask(db(), A('mgr3'), id, { action: 'approve' });
  const t = await row(id);
  assert.deepEqual(JSON.parse(t.crosspod_pods), ['pod2'], 'only the still-pending pod remains');
  assert.equal(t.assigned_to, U.emp1.id, 'assignee not yet changed');
  assert.ok(t.pending_assign, 'still held');
  assert.equal(await count('notifications', { user_id: U.mgr1.id }), before, 'requester not told of an approval that did not apply');
  await expectStatus(managerApproveTask(db(), A('mgr3'), id, { action: 'approve' }), [403]);
});

test('multi-pod: approval by every waiting pod applies the new assignee exactly once', async () => {
  const id = await multiPodHold('Multi pod C');
  await managerApproveTask(db(), A('mgr3'), id, { action: 'approve' });
  await managerApproveTask(db(), A('mgr2'), id, { action: 'approve' });
  const t = await row(id);
  assert.equal(t.assigned_to, U.emp2.id);
  assert.equal(t.status, 'todo');
  assert.equal(t.pending_assign, null);
  assert.equal(await count('task_assignees', { task_id: id, assignee_role: 'employee' }), 1, 'one employee assignee');
  assert.equal(await notifs(U.emp2.id, 'You have been assigned ticket "Multi pod C"%'), 1);
  assert.equal(await notifs(U.admin.id, 'mgr2 approved the reassignment of "Multi pod C"%'), 1, 'requester (the creator, admin) told once');
  // A repeated approval finds nothing pending and does nothing
  await expectStatus(managerApproveTask(db(), A('mgr2'), id, { action: 'approve' }), [400]);
  assert.equal(await count('task_assignees', { task_id: id, assignee_role: 'employee' }), 1);
});

test('multi-pod: a rejection by any waiting pod prevents the reassignment', async () => {
  const id = await multiPodHold('Multi pod D');
  await managerApproveTask(db(), A('mgr3'), id, { action: 'approve' });
  await managerApproveTask(db(), A('mgr2'), id, { action: 'reject', comment: 'No' });
  const t = await row(id);
  assert.equal(t.assigned_to, U.emp1.id);
  assert.equal(t.pending_assign, null);
  assert.equal(t.status, 'todo');
  await expectStatus(managerApproveTask(db(), A('mgr2'), id, { action: 'approve' }), [400]);
  assert.equal(await count('task_assignees', { task_id: id, user_id: U.emp2.id }), 0);
});

test('multi-pod: a rejection by the first pod stops it at once', async () => {
  const id = await multiPodHold('Multi pod E');
  await managerApproveTask(db(), A('mgr3'), id, { action: 'reject', comment: 'No' });
  assert.equal((await row(id)).assigned_to, U.emp1.id);
  assert.equal((await row(id)).pending_assign, null);
});

test('multi-pod: a failure while applying the last approval rolls back the decision and tells nobody; the hold survives', async () => {
  const id = await multiPodHold('Multi pod F');
  await managerApproveTask(db(), A('mgr3'), id, { action: 'approve' });
  await db().raw(`CREATE TRIGGER fail_apply BEFORE INSERT ON task_assignees WHEN NEW.assignee_role = 'employee' AND NEW.acceptance_status = 'pending' BEGIN SELECT RAISE(ABORT, 'forced apply failure'); END;`);
  try {
    await assert.rejects(managerApproveTask(db(), A('mgr2'), id, { action: 'approve' }), /forced apply failure/);
  } finally {
    await db().raw('DROP TRIGGER fail_apply');
  }
  const t = await row(id);
  assert.equal(t.assigned_to, U.emp1.id);
  assert.deepEqual(JSON.parse(t.crosspod_pods), ['pod2'], 'pod 2 still waiting');
  assert.ok(t.pending_assign, 'hold survives');
  assert.equal(await notifs(U.emp2.id, 'You have been assigned ticket "Multi pod F"%'), 0, 'no notification for a rolled-back approval');
  // And the decision can still be made once the failure is gone
  await managerApproveTask(db(), A('mgr2'), id, { action: 'approve' });
  assert.equal((await row(id)).assigned_to, U.emp2.id);
});

// ── Item 3: the client list is the committed route's rule again ──

test('client list: a client sees the tickets of their projects, as the committed route showed them', async () => {
  const plain = await makeTicket('P1', 'emp1', 'Client sees plain');
  const [stagey] = await db()('tasks').insert({ title: 'Client sees stage pending', project_id: P.P1, created_by: U.admin.id, assigned_to: U.emp1.id, status: 'todo', priority: 'medium', ticket_type_id: 1 });
  await db()('task_assignees').insert({ task_id: stagey, user_id: U.emp1.id, assignee_role: 'employee', acceptance_status: 'pending', stage_idx: 0 });
  const list = (await listTasks(db(), A('client1'), {})).map((t: any) => t.id);
  assert.ok(list.includes(plain));
  assert.ok(list.includes(stagey), 'shown even before the stage person accepts');
  const outside = await listTasks(db(), A('client1'), { project_id: P.P2 });
  assert.equal(outside.length, 0, 'other projects stay hidden');
});
