/// <reference types="node" />
process.env.SQLITE_FILE = ':memory:';
delete process.env.NODE_ENV;
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDB, getDB } from '../db';
import { searchTickets, viewTicket } from './ticketReads';
import { listTasks } from './tasks';
import { ServiceError } from './access';

const U: Record<string, any> = {};
let T1 = 0, T2 = 0, DRAFT = 0;

before(async () => {
  await initDB();
  const db = getDB();
  const mk = async (k: string, role: string, pod: string | null, co: number | null = null) => {
    const [id] = await db('users').insert({ name: k, email: `${k}@r.test`, password_hash: 'x', role, pod, client_company_id: co });
    U[k] = { id, role, pod, name: k };
  };
  const [coA] = await db('client_companies').insert({ name: 'Co A' });
  await mk('admin', 'admin', null);
  await mk('mgr1', 'manager', 'pod1');
  await mk('mgr2', 'manager', 'pod2');
  await mk('emp1', 'employee', 'pod1');
  await mk('emp2', 'employee', 'pod1');
  await mk('cliA', 'client', null, coA);
  const P1 = (await db('projects').insert({ name: 'P1', pod: 'pod1', client_company_id: coA, created_by: U.admin.id, status: 'active', manager_status: 'accepted' }))[0];
  const P2 = (await db('projects').insert({ name: 'P2', pod: 'pod2', created_by: U.admin.id, status: 'active', manager_status: 'accepted' }))[0];
  await db('project_members').insert([{ project_id: P1, user_id: U.mgr1.id }, { project_id: P1, user_id: U.emp1.id }, { project_id: P1, user_id: U.cliA.id }, { project_id: P2, user_id: U.mgr2.id }]);
  T1 = (await db('tasks').insert({ title: 'Homepage redesign', project_id: P1, created_by: U.mgr1.id, assigned_to: U.emp1.id, status: 'todo', priority: 'high', estimated_hours: 3 }))[0];
  await db('task_assignees').insert({ task_id: T1, user_id: U.emp1.id, assignee_role: 'employee', acceptance_status: 'accepted' });
  await db('task_checklist').insert([{ task_id: T1, text: 'a', completed: 1 }, { task_id: T1, text: 'b', completed: 0 }]);
  T2 = (await db('tasks').insert({ title: 'Homepage pod two', project_id: P2, created_by: U.mgr2.id, status: 'todo', priority: 'low' }))[0];
  DRAFT = (await db('tasks').insert({ title: 'Homepage draft', project_id: P1, created_by: U.emp1.id, status: 'draft', priority: 'low' }))[0];
});
after(async () => { await getDB().destroy(); });

const titles = async (who: string, text: string) => (await searchTickets(getDB(), U[who], text)).items.map((i) => i.title).sort();

test('search returns exactly what each role can already list', async () => {
  assert.deepEqual(await titles('emp1', 'homepage'), ['Homepage draft', 'Homepage redesign']);
  assert.deepEqual(await titles('emp2', 'homepage'), [], 'unrelated employee sees nothing');
  assert.deepEqual(await titles('cliA', 'homepage'), ['Homepage redesign'], 'client sees their company project only');
  // manager visibility is unchanged: all tickets are listable by managers today
  // drafts belong to their creator only (existing rule), so the manager does not see emp1's draft
  assert.deepEqual(await titles('mgr1', 'homepage'), ['Homepage pod two', 'Homepage redesign']);
});

test('search agrees with the ordinary list for every role', async () => {
  for (const who of ['emp1', 'emp2', 'cliA', 'mgr1', 'admin']) {
    const fromList = (await listTasks(getDB(), U[who], {})).filter((r: any) => /homepage/i.test(r.title)).map((r: any) => r.title).sort();
    assert.deepEqual(await titles(who, 'homepage'), fromList, who);
  }
});

test('search text is literal: wildcards do not match everything', async () => {
  assert.deepEqual(await titles('mgr1', '%'), []);
  assert.deepEqual(await titles('mgr1', '_'), []);
  assert.deepEqual(await titles('admin', ''), [], 'empty search returns nothing');
});

test('search results are capped and carry only summary fields', async () => {
  const db = getDB();
  for (let i = 0; i < 12; i++) await db('tasks').insert({ title: 'Bulk item ' + i, project_id: (await db('tasks').where({ id: T1 }).first()).project_id, created_by: U.mgr1.id, status: 'todo', priority: 'low' });
  const r = await searchTickets(db, U.admin, 'bulk');
  assert.equal(r.total, 12);
  assert.equal(r.items.length, 10);
  assert.deepEqual(Object.keys(r.items[0]).sort(), ['assignee', 'due_date', 'id', 'priority', 'project', 'status', 'title']);
});

test('view: the assignee sees detail; an unrelated employee gets not-found, not a reason', async () => {
  const d = await viewTicket(getDB(), U.emp1, T1);
  assert.equal(d.title, 'Homepage redesign');
  assert.equal(d.checklist_done, 1);
  assert.equal(d.checklist_total, 2);
  await assert.rejects(viewTicket(getDB(), U.emp2, T1), (e: any) => e instanceof ServiceError && e.status === 404);
  await assert.rejects(viewTicket(getDB(), U.cliA, T2), (e: any) => e instanceof ServiceError && e.status === 404);
});
