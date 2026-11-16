/// <reference types="node" />
// Retention: old conversation text is deleted; open conversations and every audit record are kept.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import knex from 'knex';
import { ensureConversationSchema } from './conversationStore';
import { ensureQueueSchema } from './queueSchema';
import { purgeExpiredContext, CONTEXT_RETENTION_DAYS } from './retention';

const NOW = Date.parse('2026-11-13T06:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

async function setup() {
  const db = knex({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  await db.schema.createTable('users', (t) => { t.increments('id'); t.string('name'); });
  await db.schema.createTable('tasks', (t) => { t.increments('id'); t.string('title'); });
  await ensureConversationSchema(db);
  await ensureQueueSchema(db);
  await db('users').insert({ id: 1, name: 'Nitish' });
  return db;
}
const turn = (db: any, key: string, daysAgo: number, text = 'hello') =>
  db('assistant_conversation_log').insert({ conversation_key: key, role: 'employee', text, request_id: null, created_at: new Date(NOW - daysAgo * DAY) });
const request = (db: any, id: string, key: string, status: string) =>
  db('assistant_requests').insert({
    id, conversation_key: key, loop_user_id: 1, channel: 'simulator', conversation_id: 'c', origin_message_id: 'm-' + id,
    intent: 'CREATE_TASK', data: '{}', status, ask_count: 0, created_at: new Date(NOW - 40 * DAY), updated_at: new Date(NOW - 40 * DAY),
  });

test('retention is 30 days', () => { assert.equal(CONTEXT_RETENTION_DAYS, 30); });

test('old messages of closed conversations are deleted; recent messages are kept', async () => {
  const db = await setup();
  try {
  await turn(db, 'conv-old', 31); await turn(db, 'conv-old', 45);
  await turn(db, 'conv-recent', 29);
  const removed = await purgeExpiredContext(db, NOW);
  assert.equal(removed, 2);
  assert.equal((await db('assistant_conversation_log').where({ conversation_key: 'conv-recent' })).length, 1);
  assert.equal((await db('assistant_conversation_log').where({ conversation_key: 'conv-old' })).length, 0);
  } finally { await db.destroy(); }
});

test('an open conversation is never purged, however old its messages', async () => {
  const db = await setup();
  try {
  await request(db, 'r-open', 'conv-open', 'NEEDS_CLARIFICATION');
  await turn(db, 'conv-open', 60);
  assert.equal(await purgeExpiredContext(db, NOW), 0);
  assert.equal((await db('assistant_conversation_log').where({ conversation_key: 'conv-open' })).length, 1);
  } finally { await db.destroy(); }
});

test('audit, execution and identity history survive the purge; so do request rows', async () => {
  const db = await setup();
  try {
  await request(db, 'r-old', 'conv-old', 'EXPIRED');
  await turn(db, 'conv-old', 90);
  await db('assistant_request_events').insert({ request_id: 'r-old', conversation_key: 'conv-old', loop_user_id: 1, event: 'expired', created_at: new Date(NOW - 90 * DAY) });
  await db('assistant_executions').insert({ id: 'e1', request_id: 'r-old', attempt: 1, idempotency_key: 'k1', status: 'succeeded', started_at: new Date(NOW - 90 * DAY) });
  await db('assistant_ticket_audit').insert({ request_id: 'r-old', loop_user_id: 1, task_id: 5, operation: 'create', created_at: new Date(NOW - 90 * DAY) });
  await db('assistant_admin_audit').insert({ actor_id: 1, action: 'identity_linked_manual', target: 'x', created_at: new Date(NOW - 90 * DAY) });
  await purgeExpiredContext(db, NOW);
  for (const table of ['assistant_requests', 'assistant_request_events', 'assistant_executions', 'assistant_ticket_audit', 'assistant_admin_audit']) {
    assert.equal((await db(table).count({ n: '*' }).first() as any).n, 1, table + ' kept');
  }
  assert.equal((await db('assistant_conversation_log').count({ n: '*' }).first() as any).n, 0, 'only the text is removed');
  } finally { await db.destroy(); }
});
