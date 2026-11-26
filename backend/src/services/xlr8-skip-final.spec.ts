/// <reference types="node" />
// The ticket creator can leave out the final admin approval and/or the client review for one ticket.
process.env.SQLITE_FILE = ':memory:';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDB, getDB } from '../db';
import { createTicket, acceptCurrentStage, markStageDone, adminApproveTicket, getTicket } from './xlr8';
const db = () => getDB(); const U: any = {};
before(async () => {
  await initDB(); const d = db();
  U.a = (await d('users').insert({ name: 'a', email: 'a@sf.t', password_hash: 'x', role: 'employee', pod: 'pod1' }))[0];
  U.m = (await d('users').insert({ name: 'm', email: 'm@sf.t', password_hash: 'x', role: 'manager', pod: 'pod1' }))[0];
  U.ad = (await d('users').insert({ name: 'ad', email: 'ad@sf.t', password_hash: 'x', role: 'admin' }))[0];
  U.P = (await d('projects').insert({ name: 'P', pod: 'pod1', created_by: U.m, status: 'active', manager_status: 'accepted' }))[0];
  for (const u of [U.a, U.m]) await d('project_members').insert({ project_id: U.P, user_id: u });
  U.T = (await d('xlr8_ticket_types').insert({ name: 'T', stages: JSON.stringify([{ type: 'employee', category_name: 'Dev' }]), final_approval: JSON.stringify({ adminRequired: true, adminSkippable: true, clientOptional: true }) }))[0];
  U.Locked = (await d('xlr8_ticket_types').insert({ name: 'L', stages: JSON.stringify([{ type: 'employee', category_name: 'Dev' }]), final_approval: JSON.stringify({ adminRequired: true, adminSkippable: false, clientOptional: true }) }))[0];
});
after(() => db().destroy());
const mgr = () => ({ id: U.m, role: 'manager', name: 'm' } as any);
const emp = () => ({ id: U.a, role: 'employee', name: 'a' } as any);
const adm = () => ({ id: U.ad, role: 'admin', name: 'ad' } as any);

async function runToEnd(type: number, flags: any) {
  const r: any = await createTicket(db(), mgr(), { title: 'x', project_id: U.P, ticket_type_id: type, stage_assignments: [{ stage_idx: 0, user_ids: [U.a], est_hours: 1 }], ...flags });
  await acceptCurrentStage(db(), emp(), r.id);
  await markStageDone(db(), emp(), r.id);
  return r.id as number;
}
const status = async (id: number) => (await db()('tasks').where({ id }).first()).xlr8_status;

test('no skips: admin approval, then client review', async () => {
  const id = await runToEnd(U.T, {});
  assert.equal(await status(id), 'pending_admin');
  await adminApproveTicket(db(), adm(), id, {});
  assert.equal(await status(id), 'pending_client');
});

test('skip admin: goes straight to the client', async () => {
  const id = await runToEnd(U.T, { skip_admin: true });
  assert.equal(await status(id), 'pending_client');
  const fa = (await getTicket(db(), mgr(), id) as any).final_approval;
  assert.equal(fa.adminRequired, false, 'the stage flow shows no admin step');
});

test('skip client: admin approval completes the ticket', async () => {
  const id = await runToEnd(U.T, { skip_client: true });
  assert.equal(await status(id), 'pending_admin');
  await adminApproveTicket(db(), adm(), id, {});
  assert.equal(await status(id), 'completed');
});

test('skip both: done as soon as the work is finished', async () => {
  const id = await runToEnd(U.T, { skip_admin: true, skip_client: true });
  assert.equal(await status(id), 'completed');
});

test('skip admin works for any ticket type, and for a ticket an employee creates', async () => {
  const id = await runToEnd(U.Locked, { skip_admin: true });
  assert.equal(await status(id), 'pending_client');
  const r: any = await createTicket(db(), emp(), { title: 'e', project_id: U.P, ticket_type_id: U.T, stage_assignments: [{ stage_idx: 0, user_ids: [U.a], est_hours: 1 }], skip_admin: true, skip_client: true });
  const t = await db()('tasks').where({ id: r.id }).first();
  assert.equal(Number(t.skip_admin) + Number(t.skip_client), 2, 'the employee\'s choices are saved');
});

test('the type itself is not changed for other tickets', async () => {
  const tt = await db()('xlr8_ticket_types').where({ id: U.T }).first();
  assert.equal(JSON.parse(tt.final_approval).adminRequired, true);
});

test('an existing ticket (e.g. waiting for manager approval) can be switched to skip, then it skips', async () => {
  const { setFinalSkips } = await import('./xlr8');
  const r: any = await createTicket(db(), emp(), { title: 'old', project_id: U.P, ticket_type_id: U.T, stage_assignments: [{ stage_idx: 0, user_ids: [U.a], est_hours: 1 }] });
  const other = (await db()('users').insert({ name: 'o', email: 'o@sf.t', password_hash: 'x', role: 'employee', pod: 'pod1' }))[0];
  await assert.rejects(setFinalSkips(db(), { id: other, role: 'employee' } as any, r.id, { skip_admin: true }), /Only the creator/);
  await setFinalSkips(db(), emp(), r.id, { skip_admin: true });
  await setFinalSkips(db(), mgr(), r.id, { skip_client: true });
  // Manager approval starts it; the creator's own stage is already accepted
  await db()('tasks').where({ id: r.id }).update({ xlr8_status: 'in_progress', status: 'in_progress', xlr8_assignee_id: U.a, assigned_to: U.a });
  await markStageDone(db(), emp(), r.id);
  assert.equal(await status(r.id), 'completed');
  await assert.rejects(setFinalSkips(db(), mgr(), r.id, { skip_admin: false }), /already reached/);
});
