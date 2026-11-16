/// <reference types="node" />
// Transactions and post-commit work: a committed change sends its notifications; a rolled-back change sends none;
// a notification failure never fails a saved ticket; a website create is unchanged apart from its safety.
process.env.SQLITE_FILE = ':memory:';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDB, getDB, inTransaction, createNotification } from '../db';
import { createTask } from './tasks';
import { isDuplicateKeyError } from './ticketAudit';

const U: Record<string, any> = {};
let P1 = 0;
const actorOf = (k: string) => ({ id: U[k].id, role: U[k].role, name: k });
const count = async (table: string, where: object = {}) => Number(((await getDB()(table).where(where).count('* as n').first()) as any).n);
const body = (title: string) => ({ title, project_id: P1, working_person_id: U.emp1.id, task_manager_id: U.mgr1.id, priority: 'medium' });

before(async () => {
  await initDB();
  const db = getDB();
  for (const [k, role] of [['admin', 'admin'], ['mgr1', 'manager'], ['emp1', 'employee']] as const) {
    const [id] = await db('users').insert({ name: k, email: `${k}@tx.test`, password_hash: 'x', role, pod: role === 'admin' ? null : 'pod1' });
    U[k] = { id, role };
  }
  P1 = (await db('projects').insert({ name: 'P1', pod: 'pod1', created_by: U.admin.id, status: 'active', manager_status: 'accepted' }))[0];
  await db('project_members').insert([{ project_id: P1, user_id: U.emp1.id }, { project_id: P1, user_id: U.mgr1.id }]);
});
after(async () => { await getDB().destroy(); });

test('a committed website create sends its assignment notification after commit', async () => {
  const before = await count('notifications', { user_id: U.emp1.id });
  const r = await createTask(getDB(), actorOf('mgr1'), body('Website one'));
  assert.ok(r.id > 0);
  assert.equal(await count('notifications', { user_id: U.emp1.id }), before + 1);
});

test('a notification failure does not fail a saved ticket', async () => {
  const db = getDB();
  await db.schema.renameTable('notifications', 'notifications_off');
  try {
    const r = await createTask(db, actorOf('mgr1'), body('Notify broken'));
    assert.ok(r.id > 0);
    assert.equal(await count('tasks', { title: 'Notify broken' }), 1);
  } finally {
    await db.schema.renameTable('notifications_off', 'notifications');
  }
});

test('a rolled-back transaction sends no queued notification', async () => {
  const db = getDB();
  await assert.rejects(inTransaction(db, async () => {
    await createNotification(U.emp1.id, 'MARKER-ROLLED-BACK');
    throw new Error('boom');
  }), /boom/);
  assert.equal(await count('notifications', { message: 'MARKER-ROLLED-BACK' }), 0);
});

test('a committed transaction sends its queued notification after commit', async () => {
  const db = getDB();
  await inTransaction(db, async (trx) => {
    await createNotification(U.emp1.id, 'MARKER-COMMITTED');
    // Read through the transaction: the global connection would wait on this transaction (SQLite has one connection)
    const inside = Number((await trx('notifications').where({ message: 'MARKER-COMMITTED' }).count('* as n').first() as any).n);
    assert.equal(inside, 0, 'not sent while the transaction is open');
  });
  assert.equal(await count('notifications', { message: 'MARKER-COMMITTED' }), 1);
});

test('edit and create: a pod manager rebuilds a pending cross-pod request; the original is removed and the requester keeps it, in one transaction', async () => {
  const db = getDB();
  const [p2] = await db('projects').insert({ name: 'P2 rebuild', pod: 'pod2', created_by: U.admin.id, status: 'active', manager_status: 'accepted' });
  const [mgr2Id] = await db('users').insert({ name: 'mgr2', email: 'mgr2@tx.test', password_hash: 'x', role: 'manager', pod: 'pod2' });
  const mgr2 = { id: mgr2Id };
  await db('project_members').insert({ project_id: p2, user_id: mgr2.id });
  const first = await createTask(db, actorOf('emp1'), { title: 'Original request', project_id: p2, working_person_id: U.emp1.id });
  const before = await db('tasks').where({ id: first.id }).first();
  assert.equal(before.status, 'pending_approval');
  const rebuilt = await createTask(db, { id: mgr2.id, role: 'manager', name: 'mgr2' }, { title: 'Rebuilt request', project_id: p2, working_person_id: U.emp1.id, replaces_id: first.id });
  assert.equal(await count('tasks', { id: first.id }), 0, 'original removed');
  assert.equal((await db('tasks').where({ id: rebuilt.id }).first()).created_by, U.emp1.id, 'requester credited');
  assert.equal(await count('notifications', { user_id: U.emp1.id, message: 'mgr2 edited and created your request "Original request"' }), 1, 'requester told');
});

test('a cross-pod create completes on the same connection and holds the ticket for approval', async () => {
  const db = getDB();
  const [p2] = await db('projects').insert({ name: 'P2', pod: 'pod2', created_by: U.admin.id, status: 'active', manager_status: 'accepted' });
  const r = await createTask(db, actorOf('mgr1'), { title: 'Cross pod', project_id: p2, working_person_id: U.emp1.id, task_manager_id: U.mgr1.id, priority: 'medium' });
  const t = await db('tasks').where({ id: r.id }).first();
  console.log('CROSSPOD', JSON.stringify({ pending: r.crosspod_pending, status: t.status, pods: t.crosspod_pods }));
  assert.ok(r.crosspod_pending?.length, 'the other pod must approve');
  assert.equal(t.status, 'pending_approval');
  assert.ok(t.crosspod_pods);
});

test('a second audit row for the same request and operation is refused by the unique index', async () => {
  const db = getDB();
  const row = { request_id: 'dup-req', execution_id: null, loop_user_id: 1, task_id: 1, operation: 'create', before_json: null, after_json: null, created_at: new Date() };
  await db('assistant_ticket_audit').insert(row);
  await assert.rejects(db('assistant_ticket_audit').insert(row), (e: any) => isDuplicateKeyError(e));
});
