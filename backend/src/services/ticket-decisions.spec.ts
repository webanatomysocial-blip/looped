/// <reference types="node" />
// Tests for XLR8 decisions not yet covered: stage decline, final admin decisions, client decisions,
// close without client sign-off, and custom approval-flow review. Real schema, routers and JWTs.
process.env.SQLITE_FILE = ':memory:';
process.env.JWT_SECRET = 'test-secret';
delete process.env.NODE_ENV;

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import { AddressInfo } from 'net';
import { initDB, getDB } from '../db';
import xlr8Routes from '../routes/xlr8';
import approvalRoutes from '../routes/approvals';
import { listenLocal } from '../testServer';

let base = '';
let server: any;
const U: Record<string, any> = {};
let P = 0, TT_STAGE = 0, TT_ADMIN = 0, TT_TWO = 0;

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

async function newTicket(ttId: number, stages: { idx: number; who: string }[]) {
  const sa = stages.filter((s) => s.who !== 'none').map((s) => ({ stage_idx: s.idx, user_ids: [U[s.who].id] }));
  const r = await expectStatus('mgr1', 'POST', '/api/xlr8/tickets', 201, { title: 'Decision test', project_id: P, ticket_type_id: ttId, stage_assignments: sa });
  return r.body.id as number;
}

before(async () => {
  await initDB();
  const db = getDB();
  const cat = async (name: string) => (await db('employee_categories').where({ name }).first()).id;
  const uiux = await cat('UI/UX Designer');
  const seo = await cat('SEO Specialist');
  const mk = async (key: string, role: string, pod: string | null, client_company_id: number | null = null) => {
    const [id] = await db('users').insert({ name: key, email: `${key}@d.test`, password_hash: 'x', role, pod, client_company_id });
    U[key] = { id, role, pod, name: key, email: `${key}@d.test` };
  };
  const [coA] = await db('client_companies').insert({ name: 'Decision Co' });
  const [coB] = await db('client_companies').insert({ name: 'Other Co' });
  await mk('admin', 'admin', null);
  await mk('mgr1', 'manager', 'pod1');
  await mk('mgr2', 'manager', 'pod2');
  await mk('emp1', 'employee', 'pod1');
  await mk('emp2', 'employee', 'pod1');
  await mk('emp3', 'employee', 'pod1');
  await mk('cliA', 'client', null, coA);
  await mk('cliB', 'client', null, coB);
  await db('user_categories').insert([{ user_id: U.emp1.id, category_id: uiux }, { user_id: U.emp2.id, category_id: uiux }, { user_id: U.emp3.id, category_id: seo }]);

  P = (await db('projects').insert({ name: 'Decisions', pod: 'pod1', client_company_id: coA, created_by: U.admin.id, status: 'active', manager_status: 'accepted', service_type: 'per_project' }))[0];
  await db('project_members').insert([U.mgr1, U.emp1, U.emp2, U.emp3, U.cliA].map((u) => ({ project_id: P, user_id: u.id })));

  const tt = (name: string, stages: any[], fa: any) => db('xlr8_ticket_types').insert({ name, stages: JSON.stringify(stages), final_approval: JSON.stringify(fa), checklist: '[]' }).then((r: any) => r[0]);
  TT_STAGE = await tt('One stage, client optional', [{ category_id: uiux, category_name: 'UI/UX Designer' }], { adminRequired: true, adminSkippable: true, clientOptional: true });
  TT_ADMIN = TT_STAGE; // same shape: final admin, then client
  TT_TWO = await tt('Two stages', [{ category_id: uiux, category_name: 'UI/UX Designer' }, { category_id: seo, category_name: 'SEO Specialist' }], { adminRequired: false, adminSkippable: true, clientOptional: false });

  const app = express();
  app.use(express.json());
  app.use('/api/xlr8', xlr8Routes);
  app.use('/api/approvals', approvalRoutes);
  server = await listenLocal(app);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise((r) => setTimeout(r, 200));
  server?.close();
  await getDB().destroy();
});

// ── Stage decline ──
test('stage decline: pre-decline records the reason once; the declined person cannot accept; the next person can be assigned', async () => {
  const id = await newTicket(TT_TWO, [{ idx: 0, who: 'emp1' }, { idx: 1, who: 'emp3' }]);
  await expectStatus('emp2', 'POST', `/api/xlr8/tickets/${id}/stage-pre-decline`, 404, { comment: 'not mine' });
  await expectStatus('emp1', 'POST', `/api/xlr8/tickets/${id}/stage-pre-decline`, 200, { comment: 'Busy this week' });
  const rows = await getDB()('task_assignees').where({ task_id: id, stage_idx: 0 });
  assert.equal(rows[0].acceptance_status, 'declined');
  const log = await getDB()('xlr8_ticket_log').where({ task_id: id, action: 'stage_pre_declined' });
  assert.equal(log.length, 1);
  assert.equal(log[0].comment, 'Busy this week');
  await expectStatus('emp1', 'POST', `/api/xlr8/tickets/${id}/stage-pre-decline`, 404, { comment: 'again' });
  await expectStatus('emp1', 'POST', `/api/xlr8/tickets/${id}/stage-pre-accept`, 404, {});
  // manager reassigns the stage to emp2
  await expectStatus('mgr1', 'PUT', `/api/xlr8/tickets/${id}/stage-assignments`, 200, { stage_assignments: [{ stage_idx: 0, user_ids: [U.emp2.id] }, { stage_idx: 1, user_ids: [U.emp3.id] }] });
  await expectStatus('emp2', 'POST', `/api/xlr8/tickets/${id}/employee-accept`, 200);
  // stage 2 person must accept too before work starts (same rule as the website)
  await expectStatus('emp3', 'POST', `/api/xlr8/tickets/${id}/stage-pre-accept`, 200, {});
  assert.equal((await ticket(id)).xlr8_status, 'in_progress');
});

test('stage decline during pending assignment: the assignee declines once; the ticket waits for reassignment', async () => {
  const id = await newTicket(TT_STAGE, [{ idx: 0, who: 'emp1' }]);
  await expectStatus('emp2', 'POST', `/api/xlr8/tickets/${id}/employee-decline`, 404, { comment: 'x' });
  await expectStatus('emp1', 'POST', `/api/xlr8/tickets/${id}/employee-decline`, 200, { comment: 'Cannot take it' });
  let t = await ticket(id);
  assert.equal(t.xlr8_status, 'needs_reassignment');
  assert.equal(t.xlr8_assignee_id, null);
  await expectStatus('emp1', 'POST', `/api/xlr8/tickets/${id}/employee-decline`, 404, { comment: 'again' });
  // non-manager cannot reassign; manager can
  await expectStatus('emp2', 'POST', `/api/xlr8/tickets/${id}/assign`, 403, { assignee_id: U.emp2.id });
  await expectStatus('mgr1', 'POST', `/api/xlr8/tickets/${id}/assign`, 200, { assignee_id: U.emp2.id });
  t = await ticket(id);
  assert.equal(t.xlr8_status, 'pending_assignee');
  assert.equal(Number(t.xlr8_assignee_id), U.emp2.id);
  await expectStatus('emp2', 'POST', `/api/xlr8/tickets/${id}/employee-accept`, 200);
  assert.equal((await ticket(id)).xlr8_status, 'in_progress');
});

// ── Final admin decisions and client decisions ──
async function toAdminReview() {
  const id = await newTicket(TT_ADMIN, [{ idx: 0, who: 'emp1' }]);
  await expectStatus('emp1', 'POST', `/api/xlr8/tickets/${id}/employee-accept`, 200);
  await expectStatus('emp1', 'POST', `/api/xlr8/tickets/${id}/done`, 200);
  assert.equal((await ticket(id)).xlr8_status, 'pending_admin');
  return id;
}

test('final admin: only admins decide; approve moves to the client; a repeat is refused', async () => {
  const id = await toAdminReview();
  await expectStatus('mgr1', 'POST', `/api/xlr8/tickets/${id}/admin-approve`, 403, {});
  await expectStatus('cliA', 'POST', `/api/xlr8/tickets/${id}/admin-approve`, 403, {});
  const ok = await expectStatus('admin', 'POST', `/api/xlr8/tickets/${id}/admin-approve`, 200, { comment: 'Looks good' });
  assert.deepEqual(ok.body, { ok: true, next: 'pending_client' });
  assert.equal((await ticket(id)).xlr8_status, 'pending_client');
  await expectStatus('admin', 'POST', `/api/xlr8/tickets/${id}/admin-approve`, 404, {});
});

test('final admin decline sends the work back to the stage person and records it', async () => {
  const id = await toAdminReview();
  await expectStatus('mgr1', 'POST', `/api/xlr8/tickets/${id}/admin-decline`, 403, { comment: 'x' });
  await expectStatus('admin', 'POST', `/api/xlr8/tickets/${id}/admin-decline`, 200, { comment: 'Redo the header' });
  const t = await ticket(id);
  assert.equal(t.xlr8_status, 'in_progress');
  assert.equal(Number(t.xlr8_assignee_id), U.emp1.id);
  assert.equal((await getDB()('xlr8_ticket_log').where({ task_id: id, action: 'admin_declined' })).length, 1);
});

test('final admin can send straight to the client; the client approves and the ticket completes', async () => {
  const id = await toAdminReview();
  await expectStatus('admin', 'POST', `/api/xlr8/tickets/${id}/admin-send-client`, 200, { comment: 'Please check' });
  assert.equal((await ticket(id)).xlr8_status, 'pending_client');
  await expectStatus('admin', 'POST', `/api/xlr8/tickets/${id}/admin-send-client`, 404, {});
  await expectStatus('mgr1', 'POST', `/api/xlr8/tickets/${id}/client-approve`, 403, {});
  await expectStatus('cliB', 'POST', `/api/xlr8/tickets/${id}/client-approve`, 403, {});
  await expectStatus('cliA', 'POST', `/api/xlr8/tickets/${id}/client-approve`, 200, {});
  assert.equal((await ticket(id)).xlr8_status, 'completed');
  await expectStatus('cliA', 'POST', `/api/xlr8/tickets/${id}/client-approve`, 404, {});
});

test('admin can skip the client and complete directly', async () => {
  const id = await toAdminReview();
  await expectStatus('admin', 'POST', `/api/xlr8/tickets/${id}/admin-approve`, 200, { skip_client: true });
  assert.equal((await ticket(id)).xlr8_status, 'completed');
});

test('client rejection sends the work back with the client comment; only the project client may reject', async () => {
  const id = await toAdminReview();
  await expectStatus('admin', 'POST', `/api/xlr8/tickets/${id}/admin-approve`, 200, {});
  await expectStatus('mgr1', 'POST', `/api/xlr8/tickets/${id}/client-reject`, 403, { comment: 'x' });
  await expectStatus('cliB', 'POST', `/api/xlr8/tickets/${id}/client-reject`, 403, { comment: 'x' });
  await expectStatus('cliA', 'POST', `/api/xlr8/tickets/${id}/client-reject`, 200, { comment: 'Logo too small' });
  const t = await ticket(id);
  assert.equal(t.xlr8_status, 'in_progress');
  assert.equal(Number(t.xlr8_assignee_id), U.emp1.id);
  const ap = await getDB()('approvals').where({ task_id: id }).orderBy('id', 'desc').first();
  assert.equal(ap.status, 'revision_requested');
});

test('close without client sign-off: manager closes a ticket waiting on the client; others cannot; only pending-client tickets close', async () => {
  const id = await toAdminReview();
  await expectStatus('admin', 'POST', `/api/xlr8/tickets/${id}/admin-approve`, 200, {});
  await expectStatus('emp1', 'POST', `/api/xlr8/tickets/${id}/close`, 403, {});
  await expectStatus('cliA', 'POST', `/api/xlr8/tickets/${id}/close`, 403, {});
  await expectStatus('mgr2', 'POST', `/api/xlr8/tickets/${id}/close`, 403, {});
  await expectStatus('mgr1', 'POST', `/api/xlr8/tickets/${id}/close`, 200, { comment: 'Client unavailable' });
  assert.equal((await ticket(id)).xlr8_status, 'completed');
  await expectStatus('mgr1', 'POST', `/api/xlr8/tickets/${id}/close`, 400, {});
});

// ── Custom approval-flow review ──
let CA = 0;
test('custom approval flow: only the current approver acts; approvals move step by step; the last approval completes the task', async () => {
  const db = getDB();
  const task = (await db('tasks').insert({ title: 'Custom review', project_id: P, created_by: U.emp1.id, assigned_to: U.emp1.id, status: 'in_review', priority: 'medium' }))[0];
  await db('task_approval_flow').insert([{ task_id: task, user_id: U.mgr1.id, position: 0 }, { task_id: task, user_id: U.admin.id, position: 1 }]);
  CA = (await db('approvals').insert({ task_id: task, title: 'Custom review', project_id: P, submitted_by: U.emp1.id, status: 'pending_custom', workflow_type: 'custom', current_step: 0 }))[0];

  await expectStatus('emp1', 'PUT', `/api/approvals/${CA}`, 403, { action: 'approve' });
  await expectStatus('admin', 'PUT', `/api/approvals/${CA}`, 403, { action: 'approve' });
  const first = await expectStatus('mgr1', 'PUT', `/api/approvals/${CA}`, 200, { action: 'approve' });
  assert.deepEqual(first.body, { message: 'Updated' });
  assert.equal((await db('approvals').where({ id: CA }).first()).current_step, 1);
  await expectStatus('mgr1', 'PUT', `/api/approvals/${CA}`, 403, { action: 'approve' });
  await expectStatus('admin', 'PUT', `/api/approvals/${CA}`, 200, { action: 'approve' });
  const done = await db('approvals').where({ id: CA }).first();
  assert.equal(done.status, 'approved');
  assert.equal((await db('tasks').where({ id: task }).first()).status, 'completed');
  await expectStatus('admin', 'PUT', `/api/approvals/${CA}`, 400, { action: 'approve' });
});

test('custom approval flow: rejection needs a reason, then returns the task to the creator', async () => {
  const db = getDB();
  const task = (await db('tasks').insert({ title: 'Custom reject', project_id: P, created_by: U.emp1.id, assigned_to: U.emp1.id, status: 'in_review', priority: 'medium' }))[0];
  await db('task_approval_flow').insert([{ task_id: task, user_id: U.mgr1.id, position: 0 }]);
  const ap = (await db('approvals').insert({ task_id: task, title: 'Custom reject', project_id: P, submitted_by: U.emp1.id, status: 'pending_custom', workflow_type: 'custom', current_step: 0 }))[0];
  await expectStatus('mgr1', 'PUT', `/api/approvals/${ap}`, 400, { action: 'reject' });
  await expectStatus('mgr1', 'PUT', `/api/approvals/${ap}`, 200, { action: 'reject', notes: 'Needs more detail' });
  const row = await db('approvals').where({ id: ap }).first();
  assert.equal(row.status, 'rejected');
  assert.equal(row.rejection_notes, 'Needs more detail');
  assert.equal((await db('tasks').where({ id: task }).first()).status, 'todo');
  await expectStatus('mgr1', 'PUT', `/api/approvals/${ap}`, 400, { action: 'approve' });
});
