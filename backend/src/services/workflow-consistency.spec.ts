/// <reference types="node" />
// Client ticket visibility matches the client's ticket list; a held ticket (creation or reassignment) cannot be finished.
process.env.SQLITE_FILE = ':memory:';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDB, getDB } from '../db';
import { ServiceError } from './access';
import { createTask, updateTask, listTasks, getTask } from './tasks';
import { timerAction, acceptTask } from './taskWorkflow';

const U: Record<string, any> = {};
const A = (k: string) => ({ id: U[k].id, role: U[k].role, name: k, pod: U[k].pod });
const P: Record<string, number> = {};
const db = () => getDB();
const expect404 = (p: Promise<unknown>) => assert.rejects(p, (e: any) => e instanceof ServiceError && e.status === 404);
const expectStatus = (p: Promise<unknown>, statuses: number[]) =>
  assert.rejects(p, (e: any) => e instanceof ServiceError && statuses.includes(e.status), `expected ${statuses.join('/')}`);

async function ticket(project: string, worker: string, title: string, by = 'admin') {
  const r = await createTask(db(), A(by), { title, project_id: P[project], working_person_id: U[worker].id, priority: 'medium' });
  return r.id;
}

before(async () => {
  await initDB();
  const d = db();
  const [coX] = await d('client_companies').insert({ name: 'Company X' });
  const [coZ] = await d('client_companies').insert({ name: 'Company Z' });
  for (const [k, role, pod, company] of [
    ['admin', 'admin', null, null], ['mgr1', 'manager', 'pod1', null], ['mgr2', 'manager', 'pod2', null],
    ['emp1', 'employee', 'pod1', null], ['emp2', 'employee', 'pod2', null], ['emp3', 'employee', 'pod1', null],
    ['clientX', 'client', null, coX], ['clientUnrelated', 'client', null, coZ],
  ] as const) {
    const [id] = await d('users').insert({ name: k, email: `${k}@wc.test`, password_hash: 'x', role, pod, client_company_id: company });
    U[k] = { id, role, pod };
  }
  // PX: belongs to clientX's company. PY: clientX is a direct member (other company). PZ: belongs to another company.
  P.PX = (await d('projects').insert({ name: 'PX', pod: 'pod1', created_by: U.admin.id, status: 'active', manager_status: 'accepted', client_company_id: coX }))[0];
  P.PY = (await d('projects').insert({ name: 'PY', pod: 'pod1', created_by: U.admin.id, status: 'active', manager_status: 'accepted', client_company_id: coZ }))[0];
  P.PZ = (await d('projects').insert({ name: 'PZ', pod: 'pod1', created_by: U.admin.id, status: 'active', manager_status: 'accepted', client_company_id: coZ }))[0];
  await d('project_members').insert([
    { project_id: P.PY, user_id: U.clientX.id }, { project_id: P.PX, user_id: U.emp1.id }, { project_id: P.PZ, user_id: U.emp1.id },
    { project_id: P.PX, user_id: U.mgr1.id }, { project_id: P.PY, user_id: U.mgr1.id }, { project_id: P.PZ, user_id: U.mgr1.id },
    { project_id: P.PZ, user_id: U.emp3.id },
  ]);
});
after(async () => { await db().destroy(); });

// ── Item 1: client visibility ──

test('a client can open a ticket of their company project, as the list shows it', async () => {
  const id = await ticket('PX', 'emp1', 'Company ticket');
  assert.ok((await listTasks(db(), A('clientX'), {})).some((t: any) => t.id === id), 'in the list');
  const one = await getTask(db(), A('clientX'), id);
  assert.equal(one.id, id);
});

test('a client can open a ticket of a project they are a direct member of, as the list shows it', async () => {
  const id = await ticket('PY', 'emp1', 'Member ticket');
  assert.ok((await listTasks(db(), A('clientX'), {})).some((t: any) => t.id === id));
  assert.equal((await getTask(db(), A('clientX'), id)).id, id);
});

test('a client can open a stage-pending ticket that the list shows (same rule for list and detail)', async () => {
  const id = await ticket('PX', 'emp1', 'Stage pending for client');
  await db()('tasks').where({ id }).update({ ticket_type_id: 1 });
  await db()('task_assignees').insert({ task_id: id, user_id: U.emp1.id, assignee_role: 'employee', acceptance_status: 'pending', stage_idx: 0 });
  assert.ok((await listTasks(db(), A('clientX'), {})).some((t: any) => t.id === id));
  assert.equal((await getTask(db(), A('clientX'), id)).id, id);
});

test('an unrelated client sees neither the list entry nor the ticket', async () => {
  const id = await ticket('PX', 'emp1', 'Not for unrelated');
  assert.ok(!(await listTasks(db(), A('clientUnrelated'), {})).some((t: any) => t.id === id));
  await expect404(getTask(db(), A('clientUnrelated'), id));
});

test('an employee who is not on the ticket cannot open it by id; an assignee still can', async () => {
  const id = await ticket('PZ', 'emp1', 'Employee scope');
  await expect404(getTask(db(), A('emp3'), id));
  assert.equal((await getTask(db(), A('emp1'), id)).id, id);
});

test('a manager of the pod still opens any ticket, and a client still cannot open a draft they did not create', async () => {
  const id = await ticket('PX', 'emp1', 'Manager scope');
  assert.equal((await getTask(db(), A('mgr1'), id)).id, id);
  const [draft] = await db()('tasks').insert({ title: 'Draft hidden', project_id: P.PX, created_by: U.admin.id, status: 'draft', priority: 'medium' });
  await expect404(getTask(db(), A('clientX'), draft));
});

// ── Item 2: finishing a ticket that is waiting for a cross-pod approval ──

test('a held creation ticket cannot be finished, but can be paused', async () => {
  // mgr1 (pod1) creates on a pod2 project with a pod2 person: held for pod2
  const r = await createTask(db(), A('mgr1'), { title: 'Held creation', project_id: P.PX, working_person_id: U.emp2.id, priority: 'medium' });
  assert.ok(r.crosspod_pending?.length, 'held for approval');
  await expectStatus(timerAction(db(), A('mgr1'), r.id, { action: 'done' }), [409]);
  await expectStatus(timerAction(db(), A('mgr1'), r.id, { action: 'start' }), [409]);
  await timerAction(db(), A('mgr1'), r.id, { action: 'pause' }); // allowed
  assert.equal((await db()('tasks').where({ id: r.id }).first()).status, 'pending_approval');
});

test('a held reassignment ticket cannot be finished, but can be paused', async () => {
  const id = await ticket('PX', 'emp1', 'Held reassignment');
  await updateTask(db(), A('mgr1'), id, { working_person_id: U.emp2.id });
  await expectStatus(timerAction(db(), A('mgr1'), id, { action: 'done' }), [409]);
  await timerAction(db(), A('mgr1'), id, { action: 'pause' });
});

test('a normal ticket (no pending approval) can still be started, paused and finished', async () => {
  const id = await ticket('PX', 'emp1', 'Normal ticket');
  await acceptTask(db(), A('emp1'), id, { action: 'accept' }).catch(() => undefined); // required assignee accepts first
  await timerAction(db(), A('emp1'), id, { action: 'start' });
  await timerAction(db(), A('emp1'), id, { action: 'pause' });
  await acceptTask(db(), A('emp1'), id, { action: 'accept' }).catch(() => undefined); // required assignee accepts first
  await timerAction(db(), A('emp1'), id, { action: 'start' });
  await timerAction(db(), A('emp1'), id, { action: 'done' });
  assert.equal((await db()('tasks').where({ id }).first()).status, 'in_review');
});
