/// <reference types="node" />
// Ticket acceptance by people on later stages: the ticket waits for them, so they must be able to accept it.
process.env.SQLITE_FILE = ':memory:';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDB, getDB } from '../db';
import { acceptCurrentStage, getTicket } from './xlr8';
const db = () => getDB(); const U: any = {};
before(async () => {
  await initDB(); const d = db();
  for (const k of ['a', 'c']) U[k] = (await d('users').insert({ name: k, email: `${k}@xa.t`, password_hash: 'x', role: 'employee', pod: 'pod1' }))[0];
  U.m = (await d('users').insert({ name: 'm', email: 'm@xa.t', password_hash: 'x', role: 'manager', pod: 'pod1' }))[0];
  U.P = (await d('projects').insert({ name: 'P', pod: 'pod1', created_by: U.m, status: 'active', manager_status: 'accepted' }))[0];
  for (const u of [U.a, U.c, U.m]) await d('project_members').insert({ project_id: U.P, user_id: u });
  U.T = (await d('xlr8_ticket_types').insert({ name: 'T', stages: JSON.stringify([{ category_name: 'Dev' }, { category_name: 'QA' }]) }))[0];
});
after(() => db().destroy());
const who = (k: string) => ({ id: U[k], role: 'employee', name: k } as any);

test('a later-stage member can accept from the ticket (was "Ticket not found"); the ticket starts once everyone accepted', async () => {
  const [id] = await db()('tasks').insert({ title: 't', project_id: U.P, created_by: U.m, status: 'todo', priority: 'high', ticket_type_id: U.T, xlr8_status: 'pending_assignee', xlr8_stage_idx: 0, xlr8_assignee_id: U.a, assigned_to: U.a });
  for (const [u, s] of [[U.a, 0], [U.c, 1]]) await db()('task_assignees').insert({ task_id: id, user_id: u, assignee_role: 'employee', acceptance_status: 'pending', stage_idx: s, skipped: 0 });
  assert.equal((await getTicket(db(), who('c'), id) as any).my_acceptance_pending, true, 'the page shows them the Accept button');
  const r: any = await acceptCurrentStage(db(), who('c'), id);
  assert.deepEqual(r.waiting_on, ['a']);
  assert.equal((await db()('tasks').where({ id }).first()).xlr8_assignee_id, U.a, 'the current stage holder is unchanged');
  await assert.rejects(acceptCurrentStage(db(), who('c'), id), /already accepted/);
  await acceptCurrentStage(db(), who('a'), id);
  assert.equal((await db()('tasks').where({ id }).first()).xlr8_status, 'in_progress');
  assert.equal((await getTicket(db(), who('c'), id) as any).my_acceptance_pending, false);
});

test('a manager on a review stage can accept it (the button used to do nothing); it never holds up the start', async () => {
  const [id] = await db()('tasks').insert({ title: 'r', project_id: U.P, created_by: U.m, status: 'todo', priority: 'high', ticket_type_id: U.T, xlr8_status: 'pending_assignee', xlr8_stage_idx: 0, xlr8_assignee_id: U.a, assigned_to: U.a });
  await db()('task_assignees').insert({ task_id: id, user_id: U.a, assignee_role: 'employee', acceptance_status: 'pending', stage_idx: 0, skipped: 0 });
  await db()('task_assignees').insert({ task_id: id, user_id: U.m, assignee_role: 'manager', acceptance_status: 'pending', stage_idx: 1, skipped: 0 });
  const mgr = { id: U.m, role: 'manager', name: 'm' } as any;
  assert.equal((await getTicket(db(), mgr, id) as any).my_acceptance_pending, true);
  await acceptCurrentStage(db(), mgr, id);
  assert.equal((await db()('task_assignees').where({ task_id: id, user_id: U.m }).first()).acceptance_status, 'accepted');
  assert.equal((await getTicket(db(), mgr, id) as any).my_acceptance_pending, false, 'the Accept button goes away');
  await assert.rejects(acceptCurrentStage(db(), mgr, id), /already accepted/);
  await acceptCurrentStage(db(), who('a'), id);
  assert.equal((await db()('tasks').where({ id }).first()).xlr8_status, 'in_progress');
});
