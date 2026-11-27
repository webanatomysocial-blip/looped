/// <reference types="node" />
// Recurring tasks end to end through the real routes: create, show, edit, stop, delete, daily copies.
process.env.JWT_SECRET = 'test-secret';
process.env.SQLITE_FILE = ':memory:';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import { AddressInfo } from 'net';
import { initDB, getDB } from '../db';
import { listenLocal } from '../testServer';
import calendarRouter, { generateTodayInstances } from './calendar';
import tasksRouter from './tasks';

const U: any = {}; let server: any; let base = '';
const db = () => getDB();
const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
async function call(who: string, method: string, url: string, body?: any) {
  const u = U[who];
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + jwt.sign({ id: u.id, role: u.role, email: u.email, name: u.name }, 'test-secret', { algorithm: 'HS256' }) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const copies = (rid: number) => db()('tasks').where({ recurring_task_id: rid }).orderBy('id');
const listIds = async (who: string) => ((await call(who, 'GET', '/tasks')).body as any[]).map((t) => Number(t.id));

before(async () => {
  await initDB();
  for (const [k, role, pod] of [['emp', 'employee', 'pod1'], ['emp2', 'employee', 'pod1'], ['mgr', 'manager', 'pod1'], ['adm', 'admin', null]] as any) {
    const [id] = await db()('users').insert({ name: k, email: `${k}@rc.t`, password_hash: 'x', role, pod });
    U[k] = { id: Number(id), role, email: `${k}@rc.t`, name: k };
  }
  const app = express(); app.use(express.json());
  app.use('/calendar', calendarRouter); app.use('/tasks', tasksRouter);
  server = await listenLocal(app); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => { server?.close(); await db().destroy(); });

test('employee creates their own daily task: today\'s copy, dated today (not yesterday), already accepted, shown to them and to admins/managers', async () => {
  const r = await call('emp', 'POST', '/calendar/recurring', { title: 'Daily outreach', recurrence_type: 'daily', start_date: today });
  assert.equal(r.status, 200);
  const c = await copies(r.body.id);
  assert.equal(c.length, 1);
  assert.equal(c[0].recurrence_date, today, 'first copy is dated today');
  assert.equal(c[0].project_id, null);
  assert.equal((await db()('task_assignees').where({ task_id: c[0].id }).first()).acceptance_status, 'accepted');
  for (const who of ['emp', 'mgr', 'adm']) assert.ok((await listIds(who)).includes(Number(c[0].id)), `${who} sees it`);
  assert.ok(!(await listIds('emp2')).includes(Number(c[0].id)), 'another employee does not');
  assert.equal(await generateTodayInstances(), 0, 'the nightly job does not add a second copy for today');
  assert.equal((await copies(r.body.id)).length, 1);
});

test('manager assigns a recurring task: the employee must accept it and sees it', async () => {
  const r = await call('mgr', 'POST', '/calendar/recurring', { title: 'Weekly report', recurrence_type: 'daily', start_date: today, assigned_to: U.emp2.id });
  const [c] = await copies(r.body.id);
  assert.equal(Number(c.assigned_to), U.emp2.id);
  assert.equal((await db()('task_assignees').where({ task_id: c.id }).first()).acceptance_status, 'pending');
  assert.ok((await listIds('emp2')).includes(Number(c.id)));
});

test('edit: today\'s untouched copy follows (title, assignee); a manager may edit; another employee may not', async () => {
  const r = await call('mgr', 'POST', '/calendar/recurring', { title: 'Old title', recurrence_type: 'daily', start_date: today, assigned_to: U.emp.id });
  assert.equal((await call('emp2', 'PUT', `/calendar/recurring/${r.body.id}`, { title: 'x' })).status, 403);
  assert.equal((await call('mgr', 'PUT', `/calendar/recurring/${r.body.id}`, { title: 'New title', assigned_to: U.emp2.id })).status, 200);
  const [c] = await copies(r.body.id);
  assert.equal(c.title, 'New title');
  assert.equal(Number(c.assigned_to), U.emp2.id);
  const rows = await db()('task_assignees').where({ task_id: c.id });
  assert.deepEqual(rows.map((x: any) => Number(x.user_id)), [U.emp2.id], 'the assignee row moved too');
  assert.ok((await listIds('emp2')).includes(Number(c.id)));
  assert.ok(!(await listIds('emp')).includes(Number(c.id)));
});

test('edit does not touch a copy someone already started', async () => {
  const r = await call('emp', 'POST', '/calendar/recurring', { title: 'Keep me', recurrence_type: 'daily', start_date: today });
  const [c] = await copies(r.body.id);
  await db()('tasks').where({ id: c.id }).update({ status: 'in_progress' });
  await call('emp', 'PUT', `/calendar/recurring/${r.body.id}`, { title: 'Changed' });
  assert.equal((await db()('tasks').where({ id: c.id }).first()).title, 'Keep me');
});

test('paused templates make no new copies; delete removes unstarted copies and keeps ones with time logged', async () => {
  const r = await call('emp', 'POST', '/calendar/recurring', { title: 'To stop', recurrence_type: 'daily', start_date: today });
  const [c] = await copies(r.body.id);
  await db()('tasks').where({ id: c.id }).delete();
  await call('emp', 'PUT', `/calendar/recurring/${r.body.id}`, { active: false });
  await generateTodayInstances();
  assert.equal((await copies(r.body.id)).length, 0, 'paused: nothing generated');

  const r2 = await call('emp', 'POST', '/calendar/recurring', { title: 'Delete me', recurrence_type: 'daily', start_date: today });
  const [c2] = await copies(r2.body.id);
  assert.equal((await call('emp2', 'DELETE', `/calendar/recurring/${r2.body.id}`)).status, 403);
  assert.equal((await call('emp', 'DELETE', `/calendar/recurring/${r2.body.id}`)).status, 200);
  assert.equal(await db()('tasks').where({ id: c2.id }).first(), undefined);
  assert.equal((await db()('task_assignees').where({ task_id: c2.id })).length, 0);

  const r3 = await call('emp', 'POST', '/calendar/recurring', { title: 'Logged', recurrence_type: 'daily', start_date: today });
  const [c3] = await copies(r3.body.id);
  // Time logged on a task with no project must be allowed (it used to fail on live)
  await db()('time_logs').insert({ task_id: c3.id, project_id: null, user_id: U.emp.id, log_date: today, hours: 0.5 });
  assert.equal((await call('mgr', 'DELETE', `/calendar/recurring/${r3.body.id}`)).status, 200, 'a manager can stop it');
  const kept = await db()('tasks').where({ id: c3.id }).first();
  assert.ok(kept, 'work with time logged is kept');
  assert.equal(kept.recurring_task_id, null);
  assert.ok((await listIds('emp')).includes(Number(c3.id)), 'and still listed for the employee');
});

test('the edit form can load a recurring task for its creator, managers and admins only', async () => {
  const r = await call('emp', 'POST', '/calendar/recurring', { title: 'Open me', recurrence_type: 'weekly', recurrence_days: [1, 3], start_date: today });
  for (const who of ['emp', 'mgr', 'adm']) {
    const g = await call(who, 'GET', `/calendar/recurring/${r.body.id}`);
    assert.equal(g.status, 200, who);
    assert.deepEqual(g.body.recurrence_days, [1, 3]);
  }
  assert.equal((await call('emp2', 'GET', `/calendar/recurring/${r.body.id}`)).status, 403);
  assert.equal((await call('mgr', 'GET', '/calendar/recurring/99999')).status, 404);
});

test('the recurring list: employees see their own, managers their pod\'s employees too, admins everyone\'s', async () => {
  const [other] = await db()('users').insert({ name: 'far', email: 'far@rc.t', password_hash: 'x', role: 'employee', pod: 'pod2' });
  const mine = (await call('emp', 'POST', '/calendar/recurring', { title: 'Pod1 work', recurrence_type: 'daily', start_date: today })).body.id;
  const far = (await call('adm', 'POST', '/calendar/recurring', { title: 'Pod2 work', recurrence_type: 'daily', start_date: today, assigned_to: Number(other) })).body.id;
  const ids = async (who: string) => ((await call(who, 'GET', '/calendar/recurring')).body as any[]).map((r) => Number(r.id));
  assert.ok((await ids('emp')).includes(mine));
  assert.ok(!(await ids('emp2')).includes(mine), 'not another employee\'s');
  assert.ok((await ids('mgr')).includes(mine), 'manager sees their pod employee\'s');
  assert.ok(!(await ids('mgr')).includes(far), 'but not another pod\'s');
  assert.ok((await ids('adm')).includes(mine) && (await ids('adm')).includes(far));
});
