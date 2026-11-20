/// <reference types="node" />
// Route-level regression tests: real schema (initDB on in-memory SQLite), real routers, real JWTs.
// Each role is checked against each resource boundary; existing website workflows must keep working.
process.env.SQLITE_FILE = ':memory:';
process.env.JWT_SECRET = 'test-secret';
delete process.env.NODE_ENV;

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import express from 'express';
import jwt from 'jsonwebtoken';
import { AddressInfo } from 'net';
import { initDB, getDB } from '../db';
import taskRoutes from '../routes/tasks';
import projectRoutes from '../routes/projects';
import xlr8Routes from '../routes/xlr8';
import capacityRoutes from '../routes/capacity';
import { listenLocal } from '../testServer';
import { guardUploads, signUploadLinks } from './uploads';

let base = '';
let server: any;
const U: Record<string, any> = {};
let P1 = 0, P2 = 0, PENDING2 = 0, T1 = 0, T2 = 0, DRAFT = 0;

async function call(who: string, method: string, url: string, body?: any) {
  const u = U[who];
  const token = jwt.sign({ id: u.id, role: u.role, email: u.email, name: u.name, pod: u.pod ?? null }, 'test-secret', { algorithm: 'HS256' });
  const res = await fetch(base + url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, body: json };
}
const expectStatus = async (who: string, method: string, url: string, want: number, body?: any) => {
  const r = await call(who, method, url, body);
  assert.equal(r.status, want, `${who} ${method} ${url} → ${r.status} ${JSON.stringify(r.body)}`);
  return r;
};

before(async () => {
  await initDB();
  const db = getDB();
  const mk = async (key: string, role: string, pod: string | null, client_company_id: number | null = null) => {
    const [id] = await db('users').insert({ name: key, email: `${key}@t.test`, password_hash: 'x', role, pod, client_company_id });
    U[key] = { id, role, pod, name: key, email: `${key}@t.test` };
  };
  const [coA] = await db('client_companies').insert({ name: 'Company A' });
  const [coB] = await db('client_companies').insert({ name: 'Company B' });
  await mk('admin', 'admin', null);
  await mk('mgr1', 'manager', 'pod1');
  await mk('mgr2', 'manager', 'pod2');
  await mk('emp1', 'employee', 'pod1');   // member of P1, assigned to T1
  await mk('emp2', 'employee', 'pod1');   // unrelated
  await mk('cliA', 'client', null, coA);
  await mk('cliB', 'client', null, coB);

  const proj = async (name: string, pod: string, co: number, extra: any = {}) =>
    (await db('projects').insert({ name, pod, client_company_id: co, created_by: U.admin.id, status: 'active', manager_status: 'accepted', service_type: 'per_project', budget_amount: 100000, budget_cutoff_pct: 10, ...extra }))[0];
  P1 = await proj('Alpha', 'pod1', coA);
  P2 = await proj('Beta', 'pod2', coB);
  PENDING2 = await proj('Gamma', 'pod2', coB, { status: 'on_hold', manager_status: 'pending_manager' });
  await db('project_members').insert([{ project_id: P1, user_id: U.mgr1.id }, { project_id: P1, user_id: U.emp1.id }, { project_id: P2, user_id: U.mgr2.id }]);

  const task = async (title: string, project_id: number, created_by: number, extra: any = {}) =>
    (await db('tasks').insert({ title, project_id, created_by, status: 'todo', priority: 'medium', ...extra }))[0];
  T1 = await task('Homepage redesign', P1, U.mgr1.id, { assigned_to: U.emp1.id });
  await db('task_assignees').insert({ task_id: T1, user_id: U.emp1.id, assignee_role: 'employee', acceptance_status: 'accepted' });
  T2 = await task('Beta audit', P2, U.mgr2.id);
  DRAFT = await task('My draft', P1, U.emp1.id, { status: 'draft' });

  const app = express();
  app.use(express.json());
  app.use('/api', signUploadLinks);
  app.use('/uploads', guardUploads, express.static(path.join(__dirname, '../../uploads')));
  app.use('/api/tasks', taskRoutes);
  app.use('/api/projects', projectRoutes);
  app.use('/api/xlr8', xlr8Routes);
  app.use('/api/capacity', capacityRoutes);
  server = await listenLocal(app);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

after(async () => {
  await new Promise((r) => setTimeout(r, 200)); // let fire-and-forget scheduler work settle
  server?.close();
  await getDB().destroy();
});

// ── Task reads (S1) ──
test('task detail: who can open T1 (pod1 project, company A, emp1 assigned)', async () => {
  for (const who of ['admin', 'mgr1', 'mgr2', 'emp1', 'cliA']) await expectStatus(who, 'GET', `/tasks/${T1}`, 200);
  for (const who of ['emp2', 'cliB']) await expectStatus(who, 'GET', `/tasks/${T1}`, 404);
});

test('task sub-resources follow the same rule', async () => {
  for (const sub of ['comments', 'deliverables', 'mentionable', 'approval-flow']) {
    await expectStatus('emp1', 'GET', `/tasks/${T1}/${sub}`, 200);
    await expectStatus('emp2', 'GET', `/tasks/${T1}/${sub}`, 404);
    await expectStatus('cliB', 'GET', `/tasks/${T1}/${sub}`, 404);
  }
  await expectStatus('emp1', 'GET', `/xlr8/tickets/${T1}/log`, 200);
  await expectStatus('cliB', 'GET', `/xlr8/tickets/${T1}/log`, 404);
});

test("drafts are visible only to their creator", async () => {
  await expectStatus('emp1', 'GET', `/tasks/${DRAFT}`, 200);
  for (const who of ['admin', 'mgr1', 'emp2']) await expectStatus(who, 'GET', `/tasks/${DRAFT}`, 404);
});

// ── Task writes (S2, S3) ──
test('comments, links and share links need access to the task', async () => {
  await expectStatus('emp1', 'POST', `/tasks/${T1}/comments`, 201, { comment: 'Started' });
  await expectStatus('cliA', 'POST', `/tasks/${T1}/comments`, 201, { comment: 'Looks good' });
  await expectStatus('emp2', 'POST', `/tasks/${T1}/comments`, 404, { comment: 'x' });
  await expectStatus('emp1', 'POST', `/tasks/${T1}/deliverables/link`, 200, { url: 'https://example.com/a' });
  await expectStatus('emp2', 'POST', `/tasks/${T1}/deliverables/link`, 404, { url: 'https://example.com/b' });
  await expectStatus('emp1', 'POST', `/tasks/${T1}/share-token`, 200);
  await expectStatus('emp2', 'POST', `/tasks/${T1}/share-token`, 404);
  await expectStatus('cliB', 'POST', `/tasks/${T1}/share-token`, 404);
});

test('a blocked upload never writes the file to disk', async () => {
  const dir = path.join(__dirname, '../../uploads/deliverables');
  const before = fs.existsSync(dir) ? fs.readdirSync(dir).length : 0;
  const u = U.emp2;
  const token = jwt.sign({ id: u.id, role: u.role, email: u.email, name: u.name }, 'test-secret', { algorithm: 'HS256' });
  const fd = new FormData(); fd.append('file', new Blob(['secret']), 'x.txt');
  const res = await fetch(`${base}/tasks/${T1}/deliverables/file`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
  assert.equal(res.status, 404);
  assert.equal(fs.existsSync(dir) ? fs.readdirSync(dir).length : 0, before);
});

test('a deliverable file opens only through the link its task gives to people allowed to see it', async () => {
  const u = U.emp1;
  const token = jwt.sign({ id: u.id, role: u.role, email: u.email, name: u.name }, 'test-secret', { algorithm: 'HS256' });
  const fd = new FormData(); fd.append('file', new Blob(['<script>steal()</script>']), 'notes.html');
  const up = await fetch(`${base}/tasks/${T1}/deliverables/file`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
  assert.equal(up.status, 200);
  const list = (await expectStatus('emp1', 'GET', `/tasks/${T1}/deliverables`, 200)).body;
  const d = list.find((x: any) => x.name === 'notes.html');
  assert.match(d.url, /^\/uploads\/deliverables\/[0-9a-f-]{36}\.bin\?e=\d+&s=/, 'random name, stored as a download, signed link');
  const root = base.replace(/\/api$/, '');
  const ok = await fetch(root + d.url);
  assert.equal(ok.status, 200); assert.equal(ok.headers.get('content-security-policy'), 'sandbox');
  assert.equal((await fetch(root + d.url.split('?')[0])).status, 403, 'the bare address is refused');
  await expectStatus('emp2', 'GET', `/tasks/${T1}/deliverables`, 404);   // so emp2 never receives a link
  fs.rmSync(path.join(__dirname, '../..', d.url.split('?')[0]), { force: true });
});

// ── Projects (S4, S5) ──
test('project detail: visibility and budget fields by role', async () => {
  for (const who of ['admin', 'mgr1']) assert.equal((await expectStatus(who, 'GET', `/projects/${P1}`, 200)).body.budget_amount, 100000);
  for (const who of ['emp1', 'cliA']) {
    const r = await expectStatus(who, 'GET', `/projects/${P1}`, 200);
    assert.equal(r.body.name, 'Alpha');
    assert.ok(!('budget_amount' in r.body) && !('budget_cutoff_pct' in r.body), `${who} must not see budget`);
  }
  for (const who of ['mgr2', 'emp2', 'cliB']) await expectStatus(who, 'GET', `/projects/${P1}`, 404);
  await expectStatus('emp2', 'GET', `/projects/${P1}/members`, 404);
  await expectStatus('emp1', 'GET', `/projects/${P1}/members`, 200);
});

test('project list keeps its scope; money only for admins and managers', async () => {
  const names = async (who: string) => (await expectStatus(who, 'GET', '/projects', 200)).body;
  const e1 = await names('emp1');
  assert.deepEqual(e1.map((p: any) => p.name), ['Alpha']);
  assert.ok(!('working_budget' in e1[0]) && !('total_spend' in e1[0]) && !('budget_amount' in e1[0]));
  assert.ok('hours_logged' in e1[0], 'operational hours stay visible');
  const ca = await names('cliA');
  assert.deepEqual(ca.map((p: any) => p.name), ['Alpha']);
  assert.ok(!('amount_remaining' in ca[0]));
  const m1 = await names('mgr1');
  assert.deepEqual(m1.map((p: any) => p.name), ['Alpha']);
  assert.equal(m1[0].working_budget, 90000);
  assert.equal((await names('admin')).length, 3);
  // Task-form picker (scope=all) is unchanged: every project, no money
  const all = (await expectStatus('emp1', 'GET', '/projects?scope=all', 200)).body;
  assert.equal(all.length, 3);
  assert.ok(!('budget_amount' in all[0]));
});

test("managers can't edit, delete or accept another pod's projects", async () => {
  await expectStatus('mgr2', 'PUT', `/projects/${P1}`, 404, { name: 'Hijacked' });
  await expectStatus('mgr1', 'DELETE', `/projects/${P2}`, 404);
  await expectStatus('mgr1', 'POST', `/projects/${PENDING2}/manager-response`, 404, { action: 'accept' });
  await expectStatus('emp1', 'PUT', `/projects/${P1}`, 403, { name: 'x' });
  assert.equal((await getDB()('projects').where({ id: P1 }).first()).name, 'Alpha');
});

// ── Existing website workflows still work ──
test('manager edits own-pod project; pod manager accepts a pending project', async () => {
  await expectStatus('mgr1', 'PUT', `/projects/${P1}`, 200, { description: 'Updated brief' });
  await expectStatus('mgr2', 'POST', `/projects/${PENDING2}/manager-response`, 200, { action: 'accept', member_ids: [] });
  await expectStatus('admin', 'PUT', `/projects/${P2}`, 200, { description: 'Admin note' });
});

test('employee raises a task request; manager approves it; employee sees it', async () => {
  const created = await expectStatus('emp1', 'POST', '/tasks', 201, { title: 'New banner', project_id: P1, working_person_id: U.emp1.id, estimated_hours: 2 });
  const row = await getDB()('tasks').where({ id: created.body.id }).first();
  assert.equal(row.status, 'pending_approval');
  await expectStatus('mgr1', 'POST', `/tasks/${created.body.id}/manager-approve`, 200, { action: 'approve' });
  assert.equal((await getDB()('tasks').where({ id: created.body.id }).first()).status, 'todo');
  const list = (await expectStatus('emp1', 'GET', '/tasks', 200)).body.map((t: any) => t.id);
  assert.ok(list.includes(created.body.id) && list.includes(T1) && !list.includes(T2));
});

test('S6: employees cannot edit a task through the API; managers edit their pod only; admins edit any', async () => {
  await expectStatus('emp1', 'PUT', `/tasks/${T1}`, 403, { description: 'Employee note' });
  await expectStatus('emp2', 'PUT', `/tasks/${T1}`, 403, { description: 'nope' });
  await expectStatus('mgr1', 'PUT', `/tasks/${T1}`, 200, { due_date: '2026-12-01' });
  await expectStatus('mgr2', 'PUT', `/tasks/${T1}`, 403, { title: 'Hijack' });
  await expectStatus('admin', 'PUT', `/tasks/${T1}`, 200, { priority: 'high' });
  await expectStatus('cliA', 'PUT', `/tasks/${T1}`, 403, { title: 'x' });
});

test('manager field locks on projects: unchanged values pass, field changes are refused, admins and managers stay on the team', async () => {
  await expectStatus('mgr1', 'PUT', `/projects/${P1}`, 200, { name: 'Alpha', is_adhoc: false, description: 'Brief v2', member_ids: [U.mgr1.id, U.emp1.id] });
  await expectStatus('mgr1', 'PUT', `/projects/${P1}`, 403, { name: 'Renamed' });
  await expectStatus('mgr1', 'PUT', `/projects/${P1}`, 403, { is_adhoc: true });
  // Leaving a manager off the list no longer refuses the save: managers already on the project just stay
  await expectStatus('mgr1', 'PUT', `/projects/${P1}`, 200, { member_ids: [U.emp1.id] });
  assert.ok(await getDB()('project_members').where({ project_id: P1, user_id: U.mgr1.id }).first());
  await expectStatus('mgr1', 'PUT', `/projects/${P1}`, 200, { member_ids: [U.mgr1.id, U.emp1.id, U.emp2.id] });
  await expectStatus('admin', 'PUT', `/projects/${P1}`, 200, { name: 'Alpha', is_adhoc: true, member_ids: [U.emp1.id] });
  await getDB()('projects').where({ id: P1 }).update({ is_adhoc: false });
});

test('assigned employee runs the timer; client list scope unchanged', async () => {
  await expectStatus('emp1', 'POST', `/tasks/${T1}/timer`, 200, { action: 'start' });
  await expectStatus('emp1', 'POST', `/tasks/${T1}/timer`, 200, { action: 'pause' });
  const cl = (await expectStatus('cliA', 'GET', '/tasks', 200)).body.map((t: any) => t.id);
  assert.ok(cl.includes(T1) && !cl.includes(T2));
  assert.deepEqual((await expectStatus('cliB', 'GET', '/tasks', 200)).body.map((t: any) => t.id), [T2]);
});

// ── Capacity (S8: intended for staff; clients excluded) ──
test('capacity check: any staff member (task form), never clients', async () => {
  await expectStatus('emp2', 'GET', `/capacity/check/${U.emp1.id}`, 200);
  await expectStatus('cliA', 'GET', `/capacity/check/${U.emp1.id}`, 403);
});

// ── Deleted tickets ──
test("managers restore only their own or their pod's deleted tickets", async () => {
  const id = (await getDB()('tasks').insert({ title: 'Temp', project_id: P1, created_by: U.mgr1.id, status: 'todo', priority: 'medium' }))[0];
  await expectStatus('mgr1', 'DELETE', `/tasks/${id}`, 200);
  const row = await getDB()('deleted_tasks').where({ task_id: id }).first();
  await expectStatus('mgr2', 'POST', `/tasks/deleted/${row.id}/restore`, 404);
  await expectStatus('mgr1', 'POST', `/tasks/deleted/${row.id}/restore`, 200);
});
