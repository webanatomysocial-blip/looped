/// <reference types="node" />
// Tests for the checklist, deliverable and approval extractions. Real schema, real routers, real JWTs.
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
import approvalRoutes from '../routes/approvals';
import { isSafeLink } from './deliverables';
import { apiLimiter, writeLimiter } from '../middleware/rateLimits';
import { authenticate, AuthRequest } from '../middleware/auth';
import { listenLocal } from '../testServer';

let base = '';
let server: any;
const U: Record<string, any> = {};
let P1 = 0, T = 0, A = 0, A2 = 0, ITEM = 0;

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
  const mk = async (key: string, role: string, pod: string | null) => {
    const [id] = await db('users').insert({ name: key, email: `${key}@x.test`, password_hash: 'x', role, pod });
    U[key] = { id, role, pod, name: key, email: `${key}@x.test` };
  };
  await mk('mgr1', 'manager', 'pod1');
  await mk('mgr2', 'manager', 'pod2');
  await mk('emp1', 'employee', 'pod1');
  await mk('emp3', 'employee', 'pod1');
  P1 = (await db('projects').insert({ name: 'Ext', pod: 'pod1', created_by: U.mgr1.id, status: 'active', manager_status: 'accepted', service_type: 'per_project' }))[0];
  await db('project_members').insert([U.mgr1, U.emp1, U.emp3].map((u) => ({ project_id: P1, user_id: u.id })));

  T = (await db('tasks').insert({ title: 'Checklist task', project_id: P1, created_by: U.mgr1.id, assigned_to: U.emp1.id, status: 'todo', priority: 'medium', checklist_total: 2, checklist_done: 0 }))[0];
  await db('task_assignees').insert({ task_id: T, user_id: U.emp1.id, assignee_role: 'employee', acceptance_status: 'accepted' });
  const items = await db('task_checklist').insert([{ task_id: T, text: 'Draft', completed: 0 }, { task_id: T, text: 'Review', completed: 0 }]);
  ITEM = items[0];

  // Approval awaiting a manager (pod1 task), and one in progress for its assignee to submit
  const t2 = (await db('tasks').insert({ title: 'Reviewed', project_id: P1, created_by: U.emp1.id, assigned_to: U.emp1.id, status: 'in_review', priority: 'medium' }))[0];
  A = (await db('approvals').insert({ task_id: t2, title: 'Reviewed', project_id: P1, submitted_by: U.emp1.id, status: 'pending_manager', workflow_type: 'employee' }))[0];
  const t3 = (await db('tasks').insert({ title: 'Working', project_id: P1, created_by: U.mgr1.id, assigned_to: U.emp1.id, status: 'in_progress', priority: 'medium' }))[0];
  await db('task_assignees').insert({ task_id: t3, user_id: U.emp1.id, assignee_role: 'employee', acceptance_status: 'accepted' });
  A2 = (await db('approvals').insert({ task_id: t3, title: 'Working', project_id: P1, submitted_by: U.emp1.id, status: 'work_in_progress', workflow_type: 'employee' }))[0];
  T = T; // checklist task id kept in T

  const app = express();
  app.use(express.json());
  app.use('/api/tasks', taskRoutes);
  app.use('/api/approvals', approvalRoutes);
  server = await listenLocal(app);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

after(async () => {
  await new Promise((r) => setTimeout(r, 200));
  server?.close();
  await getDB().destroy();
});

// ── Checklist ──
test('checklist: assignee ticks an item and the counts update; outsiders are refused', async () => {
  await expectStatus('emp3', 'PUT', `/tasks/${T}/checklist/${ITEM}`, 404, { completed: true });
  const r = await expectStatus('emp1', 'PUT', `/tasks/${T}/checklist/${ITEM}`, 200, { completed: true });
  assert.deepEqual(r.body, { message: 'Updated' });
  const t = await getDB()('tasks').where({ id: T }).first();
  assert.equal(Number(t.checklist_done), 1);
  assert.equal(Number(t.checklist_total), 2);
  await expectStatus('mgr2', 'PUT', `/tasks/${T}/checklist/${ITEM}`, 200, { completed: false }); // managers may tick any visible item, as before
  await expectStatus('mgr1', 'PUT', `/tasks/${T}/checklist/${ITEM}`, 200, { completed: false });
});

// ── Deliverables ──
test('deliverable links: web links accepted, script links refused; only the uploader or a manager may remove', async () => {
  assert.equal(isSafeLink('https://example.com/a'), true);
  assert.equal(isSafeLink('javascript:alert(1)'), false);
  assert.equal(isSafeLink('data:text/html,hi'), false);
  assert.equal(isSafeLink('not a url'), false);
  await expectStatus('emp1', 'POST', `/tasks/${T}/deliverables/link`, 400, { url: 'javascript:alert(document.cookie)' });
  const ok = await expectStatus('emp1', 'POST', `/tasks/${T}/deliverables/link`, 200, { url: 'https://example.com/doc', name: 'Doc' });
  assert.equal(ok.body.type, 'link');
  await expectStatus('emp3', 'POST', `/tasks/${T}/deliverables/link`, 404, { url: 'https://example.com' });
  await expectStatus('emp3', 'DELETE', `/tasks/${T}/deliverables/${ok.body.id}`, 404);
  await expectStatus('emp3', 'GET', `/tasks/${T}/deliverables`, 404);
  const list = await expectStatus('emp1', 'GET', `/tasks/${T}/deliverables`, 200);
  assert.ok(list.body.some((d: any) => d.id === ok.body.id));
  await expectStatus('emp1', 'DELETE', `/tasks/${T}/deliverables/${ok.body.id}`, 200);
});

// ── Approvals ──
test('approval review: wrong pod refused; right manager gets the same response as before; then the outcome is stored', async () => {
  await expectStatus('mgr2', 'PUT', `/approvals/${A}`, 403, { action: 'approve' });
  const r = await expectStatus('mgr1', 'PUT', `/approvals/${A}`, 200, { action: 'approve' });
  assert.deepEqual(r.body, { message: 'Updated', status: 'pending_admin' });
  const row = await getDB()('approvals').where({ id: A }).first();
  assert.equal(row.status, 'pending_admin');
});

test('approval review: rejection needs a reason and sends the work back', async () => {
  await expectStatus('mgr1', 'PUT', `/approvals/${A}`, 400, { action: 'reject' });
  const rej = await expectStatus('mgr1', 'PUT', `/approvals/${A}`, 400, { action: 'reject', notes: '   ' });
  assert.ok(rej);
});

test('approval complete: only the people working on it may submit; success returns the same message', async () => {
  await expectStatus('emp3', 'POST', `/approvals/${A2}/complete`, 403);
  const r = await expectStatus('emp1', 'POST', `/approvals/${A2}/complete`, 200);
  assert.deepEqual(r.body, { message: 'Moved to pending_review' });
  await expectStatus('emp1', 'POST', `/approvals/${A2}/complete`, 400);
});

// ── Rate limits: normal use is not blocked; read-receipt pings do not use the write budget ──
test('rate limits: read-receipt pings never block; real writes are capped per session; other sessions are unaffected', async () => {
  const rl = express();
  rl.use(express.json());
  rl.use('/api', authenticate, apiLimiter, writeLimiter);
  rl.post('/api/messages/mark-read', (_req: any, res: any) => { res.json({ ok: true }); });
  rl.post('/api/tasks/x/comments', (_req: any, res: any) => { res.json({ ok: true }); });
  rl.get('/api/tasks', (_req: any, res: any) => { res.json([]); });
  const srv = await listenLocal(rl);
  const b = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const mint = (u: any) => jwt.sign({ id: u.id, role: u.role, email: u.email, name: u.name }, 'test-secret', { algorithm: 'HS256' });
  const empTok = mint(U.emp1), otherTok = mint(U.emp3);
  const tok = (u: any) => (u === U.emp3 ? otherTok : empTok);
  const emp = { ...U.emp1 };
  const send = (method: string, url: string, t: string) => fetch(b + url, { method, headers: { Authorization: 'Bearer ' + t } }).then((r) => r.status);
  try {
    for (let i = 0; i < 320; i++) assert.equal(await send('POST', '/api/messages/mark-read', tok(emp)), 200, 'mark-read ping ' + i);
    for (let i = 0; i < 300; i++) assert.equal(await send('POST', '/api/tasks/x/comments', tok(emp)), 200, 'write ' + i);
    assert.equal(await send('POST', '/api/tasks/x/comments', tok(emp)), 429, 'the 301st real write is limited');
    assert.equal(await send('GET', '/api/tasks', tok(emp)), 200, 'reads still work after the write cap');
    assert.equal(await send('POST', '/api/tasks/x/comments', tok(U.emp3)), 200, 'another employee has their own budget');
  } finally { srv.close(); }
});
