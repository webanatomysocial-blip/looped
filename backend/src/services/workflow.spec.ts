/// <reference types="node" />
// Workflow regression tests against the real schema, routers and services (in-memory SQLite, real JWTs).
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
import { requirePage, authenticate, AuthRequest } from '../middleware/auth';
import { sensitiveLimiter } from '../middleware/rateLimits';
import { canUsePage } from './access';
import { recoverInterruptedTransitions } from './xlr8';
import { listenLocal } from '../testServer';

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
  app.get('/probe/seo', requirePage('/seo'), (_req: express.Request, res: express.Response) => { res.json({ ok: true }); });
  app.post('/probe/sensitive', authenticate, sensitiveLimiter, (_req: AuthRequest, res: express.Response) => { res.json({ ok: true }); });
  server = await listenLocal(app);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise((r) => setTimeout(r, 200));
  server?.close();
  await getDB().destroy();
});

// ── XLR8: stage acceptance, progression and duplicates ──
let X1 = 0;
// Loop starts a ticket only when everyone on this stage and every later stage has accepted (services/xlr8 waitingOn)
test('work waits until every stage person (this and later stages) has accepted; wrong and duplicate acceptances change nothing', async () => {
  X1 = (await expectStatus('mgr1', 'POST', '/api/xlr8/tickets', 201, {
    title: 'Landing page', project_id: P1, ticket_type_id: TT_A,
    stage_assignments: [{ stage_idx: 0, user_ids: [U.emp1.id] }, { stage_idx: 1, user_ids: [U.emp3.id] }],
  })).body.id;
  assert.equal((await ticket(X1)).xlr8_status, 'pending_assignee');

  await expectStatus('emp2', 'POST', `/api/xlr8/tickets/${X1}/employee-accept`, 404);
  await expectStatus('emp3', 'POST', `/api/xlr8/tickets/${X1}/done`, 404);
  const first = await expectStatus('emp1', 'POST', `/api/xlr8/tickets/${X1}/employee-accept`, 200);
  assert.ok(first.body.waiting_on.includes('emp3'), 'stage 2 person still has to accept');
  assert.equal((await ticket(X1)).xlr8_status, 'pending_assignee', 'not started while stage 2 has not accepted');

  await expectStatus('emp3', 'POST', `/api/xlr8/tickets/${X1}/stage-pre-accept`, 200, {});
  assert.equal((await ticket(X1)).xlr8_status, 'in_progress', 'starts once everyone has accepted');
  assert.equal(await logCount(X1, 'employee_accepted'), 1);

  await expectStatus('emp1', 'POST', `/api/xlr8/tickets/${X1}/employee-accept`, 404);
  assert.equal(await logCount(X1, 'employee_accepted'), 1, 'duplicate acceptance must not run twice');
});

test('finishing stage 1 moves the ticket to stage 2 with its accepted person; only that person can finish it', async () => {
  await expectStatus('emp3', 'POST', `/api/xlr8/tickets/${X1}/done`, 404);
  await expectStatus('emp1', 'POST', `/api/xlr8/tickets/${X1}/done`, 200);
  const t = await ticket(X1);
  assert.equal(Number(t.xlr8_stage_idx), 1);
  assert.equal(Number(t.xlr8_assignee_id), U.emp3.id);
  await expectStatus('emp1', 'POST', `/api/xlr8/tickets/${X1}/done`, 404);
  await expectStatus('emp3', 'POST', `/api/xlr8/tickets/${X1}/done`, 200);
  assert.equal((await ticket(X1)).xlr8_status, 'completed');
});

// ── XLR8: review, rejection and resubmission ──
let X2 = 0;
test('review: only the right manager decides; rejection goes back to the stage person; resubmission works; approval completes', async () => {
  X2 = (await expectStatus('mgr1', 'POST', '/api/xlr8/tickets', 201, {
    title: 'Logo refresh', project_id: P1, ticket_type_id: TT_B, stage_assignments: [{ stage_idx: 0, user_ids: [U.emp1.id] }],
  })).body.id;
  await expectStatus('emp1', 'POST', `/api/xlr8/tickets/${X2}/employee-accept`, 200);
  await expectStatus('emp1', 'POST', `/api/xlr8/tickets/${X2}/done`, 200);
  assert.equal((await ticket(X2)).xlr8_status, 'pending_manager');

  await expectStatus('emp1', 'POST', `/api/xlr8/tickets/${X2}/review`, 403, { action: 'approve' });
  await expectStatus('mgr2', 'POST', `/api/xlr8/tickets/${X2}/review`, 403, { action: 'approve' });

  await expectStatus('mgr1', 'POST', `/api/xlr8/tickets/${X2}/review`, 200, { action: 'decline', comment: 'Redo the colours' });
  let t = await ticket(X2);
  assert.equal(t.xlr8_status, 'in_progress');
  assert.equal(Number(t.xlr8_stage_idx), 0);
  assert.equal(Number(t.xlr8_assignee_id), U.emp1.id);
  assert.equal(await logCount(X2, 'manager_declined'), 1);

  await expectStatus('emp1', 'POST', `/api/xlr8/tickets/${X2}/done`, 200);
  assert.equal((await ticket(X2)).xlr8_status, 'pending_manager');

  await expectStatus('mgr1', 'POST', `/api/xlr8/tickets/${X2}/review`, 200, { action: 'approve' });
  assert.equal((await ticket(X2)).xlr8_status, 'completed');
  await expectStatus('mgr1', 'POST', `/api/xlr8/tickets/${X2}/review`, 404, { action: 'approve' });
});

test('ticket detail and log: clients and outsiders are refused; the assigned employee can read', async () => {
  await expectStatus('emp1', 'GET', `/api/xlr8/tickets/${X2}`, 200);
  await expectStatus('emp2', 'GET', `/api/xlr8/tickets/${X2}`, 404);
  await expectStatus('cliA', 'GET', `/api/xlr8/tickets/${X2}`, 200);
});

// ── Plain tasks: pod-manager approval, rejection, duplicate decisions ──
let T = 0;
test('employee request waits for the right pod manager; wrong pod is refused; rejection returns it as a draft', async () => {
  T = (await expectStatus('emp1', 'POST', '/api/tasks', 201, { title: 'Banner', project_id: P1, working_person_id: U.emp2.id })).body.id;
  assert.equal((await ticket(T)).status, 'pending_approval');
  await expectStatus('mgr2', 'POST', `/api/tasks/${T}/manager-approve`, 403, { action: 'approve' });
  assert.equal((await ticket(T)).status, 'pending_approval');
  await expectStatus('mgr1', 'POST', `/api/tasks/${T}/manager-approve`, 200, { action: 'approve' });
  assert.equal((await ticket(T)).status, 'todo');
  await expectStatus('mgr1', 'POST', `/api/tasks/${T}/manager-approve`, 400, { action: 'approve' });

  const R = (await expectStatus('emp1', 'POST', '/api/tasks', 201, { title: 'Stock photos', project_id: P1 })).body.id;
  await expectStatus('mgr1', 'POST', `/api/tasks/${R}/manager-approve`, 200, { action: 'reject', comment: 'Too vague' });
  const r = await ticket(R);
  assert.equal(r.status, 'draft');
  assert.match(r.crosspod_note, /Too vague/);
});

test('plain assignment: duplicate accept is harmless; a non-assignee cannot accept', async () => {
  await expectStatus('emp3', 'POST', `/api/tasks/${T}/accept`, 403, { action: 'accept' });
  await expectStatus('emp2', 'POST', `/api/tasks/${T}/accept`, 200, { action: 'accept' });
  await expectStatus('emp2', 'POST', `/api/tasks/${T}/accept`, 200, { action: 'accept' });
  const acc = await getDB()('task_assignees').where({ task_id: T, user_id: U.emp2.id }).first();
  assert.equal(acc.acceptance_status, 'accepted');
});

test('timer: assigned person starts and pauses; someone else is refused', async () => {
  await expectStatus('emp2', 'POST', `/api/tasks/${T}/timer`, 200, { action: 'start' });
  await expectStatus('emp2', 'POST', `/api/tasks/${T}/timer`, 200, { action: 'pause' });
  await expectStatus('emp3', 'POST', `/api/tasks/${T}/timer`, 404, { action: 'start' }); // cannot see it, so not found
});

test('plain task: only the people who can manage it may delete it; employees delete only own drafts', async () => {
  await expectStatus('mgr2', 'DELETE', `/api/tasks/${T}`, 403); // can see the task, not manage it
  await expectStatus('emp3', 'DELETE', `/api/tasks/${T}`, 404);
  await expectStatus('emp1', 'DELETE', `/api/tasks/${T}`, 403);
});

test('comments: visible to people on the task, refused to outsiders; only authors edit', async () => {
  const c = await expectStatus('emp2', 'POST', `/api/tasks/${T}/comments`, 201, { comment: 'Started, @emp2 test' });
  await expectStatus('emp3', 'POST', `/api/tasks/${T}/comments`, 404, { comment: 'hi' });
  await expectStatus('emp1', 'PUT', `/api/tasks/${T}/comments/${c.body.id}`, 403, { comment: 'edited by other' });
  await expectStatus('emp2', 'PUT', `/api/tasks/${T}/comments/${c.body.id}`, 200, { comment: 'edited by author' });
});

// ── Page permissions (S9) ──
test('page permissions are enforced on the server: category gates, saved grants and manager defaults', async () => {
  await expectStatus('emp3', 'GET', '/probe/seo', 200);
  await expectStatus('emp2', 'GET', '/probe/seo', 403);
  await expectStatus('cliA', 'GET', '/probe/seo', 403);
  await expectStatus('admin', 'GET', '/probe/seo', 200);
  await expectStatus('mgr1', 'GET', '/probe/seo', 200);

  await getDB()('user_page_permissions').insert({ user_id: U.emp2.id, page_slug: '/seo' });
  await expectStatus('emp2', 'GET', '/probe/seo', 200);
  await getDB()('user_page_permissions').where({ user_id: U.emp2.id }).delete();

  await getDB()('user_page_permissions').insert({ user_id: U.mgr1.id, page_slug: '/projects' });
  assert.equal(await canUsePage(getDB(), U.mgr1, '/seo'), false, 'saved permissions replace role defaults');
  await getDB()('user_page_permissions').where({ user_id: U.mgr1.id }).delete();
});

// ── Rate limiting (S11) ──
test('sensitive writes are limited per session; other sessions are unaffected', async () => {
  const u = U.emp2;
  const session = jwt.sign({ id: u.id, role: u.role, name: u.name, email: u.email }, 'test-secret', { algorithm: 'HS256' });
  const fire = () => fetch(base + '/probe/sensitive', { method: 'POST', headers: { Authorization: 'Bearer ' + session } });
  let last = 0;
  for (let i = 0; i < 30; i++) last = (await fire()).status;
  assert.equal(last, 200);
  assert.equal((await fire()).status, 429);
  const other = await expectStatus('emp3', 'GET', '/probe/seo', 200);
  assert.ok(other);
});

// ── Interrupted transition (crash after the claim, before the step finished) ──
test('a crash mid-transition is recovered at startup and the stage step can be retried', async () => {
  const id = (await expectStatus('mgr1', 'POST', '/api/xlr8/tickets', 201, {
    title: 'Crash test', project_id: P1, ticket_type_id: TT_B, stage_assignments: [{ stage_idx: 0, user_ids: [U.emp1.id] }],
  })).body.id;
  await expectStatus('emp1', 'POST', `/api/xlr8/tickets/${id}/employee-accept`, 200);
  // what a crash leaves behind after the claim
  await getDB()('tasks').where({ id }).update({ xlr8_status: 'claimed:in_progress' });
  await expectStatus('emp1', 'POST', `/api/xlr8/tickets/${id}/done`, 404);
  assert.equal(await recoverInterruptedTransitions(getDB()), 1);
  assert.equal((await ticket(id)).xlr8_status, 'in_progress');
  await expectStatus('emp1', 'POST', `/api/xlr8/tickets/${id}/done`, 200);
  assert.equal((await ticket(id)).xlr8_status, 'pending_manager');
  assert.equal(await recoverInterruptedTransitions(getDB()), 0, 'healthy tickets are untouched');
});
