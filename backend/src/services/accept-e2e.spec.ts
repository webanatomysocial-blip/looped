/// <reference types="node" />
// End to end: an employee opens a task or ticket, sees Accept, accepts, and can start. Real routes and schema, routers and services (in-memory SQLite, real JWTs).
process.env.SQLITE_FILE = ':memory:';
process.env.JWT_SECRET = 'test-secret';
delete process.env.NODE_ENV;

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import { AddressInfo } from 'net';
import { initDB, getDB } from '../db';
import taskRoutes from '../routes/tasks';
import xlr8Routes from '../routes/xlr8';
import capacityRoutes from '../routes/capacity';
import { requirePage, authenticate, AuthRequest } from '../middleware/auth';
import { sensitiveLimiter } from '../middleware/rateLimits';
import { canUsePage } from './access';
import { recoverInterruptedTransitions } from './xlr8';

let base = '';
let server: any;
const U: Record<string, any> = {};
let P1 = 0, TT_A = 0, TT_B = 0;

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
const ticket = (id: number) => getDB()('tasks').where({ id }).first();
const logCount = async (id: number, action: string) => Number((await getDB()('xlr8_ticket_log').where({ task_id: id, action }).count('* as n').first() as any).n);

before(async () => {
  await initDB();
  const db = getDB();
  const cat = async (name: string) => (await db('employee_categories').where({ name }).first()).id;
  const uiux = await cat('UI/UX Designer');
  const seo = await cat('SEO Specialist');
  const mk = async (key: string, role: string, pod: string | null, client_company_id: number | null = null) => {
    const [id] = await db('users').insert({ name: key, email: `${key}@w.test`, password_hash: 'x', role, pod, client_company_id });
    U[key] = { id, role, pod, name: key, email: `${key}@w.test` };
  };
  const [coA] = await db('client_companies').insert({ name: 'Co A' });
  await mk('admin', 'admin', null);
  await mk('mgr1', 'manager', 'pod1');
  await mk('mgr2', 'manager', 'pod2');
  await mk('emp1', 'employee', 'pod1');
  await mk('emp2', 'employee', 'pod1');
  await mk('emp3', 'employee', 'pod1');
  await mk('cliA', 'client', null, coA);
  await db('user_categories').insert([{ user_id: U.emp1.id, category_id: uiux }, { user_id: U.emp2.id, category_id: uiux }, { user_id: U.emp3.id, category_id: seo }]);

  P1 = (await db('projects').insert({ name: 'Alpha', pod: 'pod1', client_company_id: coA, created_by: U.admin.id, status: 'active', manager_status: 'accepted', service_type: 'per_project' }))[0];
  await db('project_members').insert([U.mgr1, U.emp1, U.emp2, U.emp3, U.cliA].map((u) => ({ project_id: P1, user_id: u.id })));

  TT_A = (await db('xlr8_ticket_types').insert({
    name: 'Two stages', stages: JSON.stringify([{ category_id: uiux, category_name: 'UI/UX Designer' }, { category_id: seo, category_name: 'SEO Specialist' }]),
    final_approval: JSON.stringify({ adminRequired: false, adminSkippable: true, clientOptional: false }), checklist: '[]',
  }))[0];
  TT_B = (await db('xlr8_ticket_types').insert({
    name: 'Work then review', stages: JSON.stringify([{ category_id: uiux, category_name: 'UI/UX Designer' }, { type: 'employee', reviewer: true }]),
    final_approval: JSON.stringify({ adminRequired: false, adminSkippable: true, clientOptional: false }), checklist: '[]',
  }))[0];

  const app = express();
  app.use(express.json());
  app.use('/api/tasks', taskRoutes);
  app.use('/api/xlr8', xlr8Routes);
  app.use('/api/capacity', authenticate, capacityRoutes);
  app.get('/probe/seo', requirePage('/seo'), (_req: express.Request, res: express.Response) => { res.json({ ok: true }); });
  app.post('/probe/sensitive', authenticate, sensitiveLimiter, (_req: AuthRequest, res: express.Response) => { res.json({ ok: true }); });
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise((r) => setTimeout(r, 200));
  server?.close();
  await getDB().destroy();
});


// What the task panel shows: an Accept button when the viewer has a stage or assignment still pending (TaskViewDrawer)
const showsAccept = async (who: string, id: number) => {
  const t = (await expectStatus(who, 'GET', `/api/tasks/${id}`, 200)).body;
  return (t.stage_assignees ?? []).some((a: any) => a.user_id === U[who].id && !Number(a.skipped) && (a.acceptance_status === 'pending' || a.acceptance_status == null));
};
// What the panel's Accept button calls
const pressAccept = async (who: string, id: number) => {
  const t = (await call(who, 'GET', `/api/tasks/${id}`)).body;
  if (!t.ticket_type_id) return expectStatus(who, 'POST', `/api/tasks/${id}/accept`, 200, { action: 'accept' });
  return expectStatus(who, 'POST', t.xlr8_status === 'pending_assignee' ? `/api/xlr8/tickets/${id}/employee-accept` : `/api/xlr8/tickets/${id}/stage-pre-accept`, 200, {});
};

test('plain task: the employee sees Accept on Home and in the task panel, accepts, and it no longer asks', async () => {
  const id = (await expectStatus('mgr1', 'POST', '/api/tasks', 201, { title: 'E2E plain', project_id: P1, working_person_id: U.emp1.id, task_manager_id: U.mgr1.id, priority: 'high' })).body.id;
  const home = (await expectStatus('emp1', 'GET', '/api/capacity/daily', 200)).body;
  assert.equal(home.tasks.find((t: any) => t.id === id)?.acceptance_status, 'pending', 'Home shows it in "waiting for your acceptance"');
  assert.equal(await showsAccept('emp1', id), true);
  await pressAccept('emp1', id);
  assert.equal(await showsAccept('emp1', id), false);
  await expectStatus('emp1', 'POST', `/api/tasks/${id}/timer`, 200, { action: 'start' });
});

test('ticket: the current-stage and later-stage employees both see Accept, both can accept, then work starts', async () => {
  const id = (await expectStatus('mgr1', 'POST', '/api/xlr8/tickets', 201, { title: 'E2E ticket', project_id: P1, ticket_type_id: TT_A, stage_assignments: [{ stage_idx: 0, user_ids: [U.emp2.id] }, { stage_idx: 1, user_ids: [U.emp3.id] }] })).body.id;
  assert.equal((await ticket(id)).xlr8_status, 'pending_assignee');
  assert.equal(await showsAccept('emp2', id), true, 'current stage');
  assert.equal(await showsAccept('emp3', id), true, 'later stage (the ticket waits for them too)');
  await expectStatus('emp1', 'GET', `/api/tasks/${id}`, 404);   // not on the ticket: can't open it at all
  await pressAccept('emp3', id);                       // before: "Ticket not found or not available"
  assert.equal(await showsAccept('emp3', id), false);
  assert.equal((await ticket(id)).xlr8_status, 'pending_assignee', 'still waiting for the current stage');
  await pressAccept('emp2', id);
  assert.equal((await ticket(id)).xlr8_status, 'in_progress', 'everyone accepted: work starts');
  await expectStatus('emp2', 'POST', `/api/tasks/${id}/timer`, 200, { action: 'start' });
});
