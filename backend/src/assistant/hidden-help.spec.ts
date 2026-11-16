/// <reference types="node" />
// HELP/MENU with ASSISTANT_TASK_OPS_ENABLED unset: the generated reply must advertise no suspended task operation.
delete process.env.ASSISTANT_TASK_OPS_ENABLED;
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import knex, { Knex } from 'knex';
import { MockAIProvider } from './ai';
import { RequestEngine } from './engine';
import { ensureConversationSchema } from './conversationStore';
import { ensureQueueSchema } from './queueSchema';
import { EXPOSED_INTENTS, SUSPENDED_TASK_INTENTS, TASK_OPS_ENABLED } from './actions';
import { IncomingMessage } from './types';

let db: Knex;
beforeEach(async () => {
  db = knex({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  await db.schema.createTable('users', (t) => { t.increments('id'); t.string('name'); t.string('role'); t.string('pod'); t.integer('client_company_id'); });
  await db.schema.createTable('projects', (t) => { t.increments('id'); t.string('name'); t.string('pod'); t.integer('client_company_id'); t.integer('created_by'); });
  await db.schema.createTable('project_members', (t) => { t.integer('project_id'); t.integer('user_id'); });
  await ensureConversationSchema(db);
  await ensureQueueSchema(db);
  await db('users').insert({ id: 1, name: 'Nitish', role: 'employee', pod: 'pod1' });
});
afterEach(async () => { await db.destroy(); });

// Every phrase a user would see for these operations, in any casing
// Operations advertised as WhatsApp commands: a list item or a "type <operation>" instruction. Explaining that tasks are managed in Loop is allowed.
const FORBIDDEN = /•\s*(create|show my|search|ticket details|show details|assign|reassign|priority|comment|accept|approve|reject|decline)|type (create|show|search|assign|reassign|priority|comment|accept|approve|reject|decline)/i;

const helpFor = async (role: string) => {
  const e = new RequestEngine({ db, ai: new MockAIProvider(), timezone: 'Asia/Kolkata', contextTtlSeconds: 1800, now: () => Date.parse('2026-11-16T10:00:00Z'), exposedIntents: EXPOSED_INTENTS });
  const msg: IncomingMessage = { channel: 'simulator', senderId: 'loop-user:1', conversationId: 'chat-1', messageId: 'help-' + role, text: 'Help', timestamp: new Date().toISOString() } as IncomingMessage;
  return (await e.handle(msg, { id: 1, role })).reply;
};

test('the switch is unset, so no task operation is exposed', () => {
  assert.equal(TASK_OPS_ENABLED, false);
  assert.equal(EXPOSED_INTENTS.length, 0);
});

test('HELP is hidden: whatever a Help request returns for an employee, it advertises no suspended operation', async () => {
  const reply = await helpFor('employee');
  assert.doesNotMatch(reply, /What I can help with/, 'the help list is not shown');
  assert.doesNotMatch(reply, FORBIDDEN, reply);
});

test('HELP for a manager and an admin also advertises none of the suspended operations', async () => {
  for (const role of ['manager', 'admin']) {
    const reply = await helpFor(role);
    assert.doesNotMatch(reply, FORBIDDEN, `${role}: ${reply}`);
  }
});

test('the operations are preserved in code, only hidden from WhatsApp', () => {
  assert.ok(SUSPENDED_TASK_INTENTS.includes('CREATE_TASK'));
  assert.ok(SUSPENDED_TASK_INTENTS.includes('VIEW_MY_TASKS'));
  assert.ok(SUSPENDED_TASK_INTENTS.includes('REJECT_TASK'));
});

// ── Private-chat presentation: the same shared formatter as the group messages ──
const cls = (intent: string) => JSON.stringify({ intent, confidence: 0.9, fields: {}, ambiguous: [], is_correction: false, cancel: false, answers_pending: false });
const say = async (text: string, ai = new MockAIProvider(cls('UNKNOWN'))) => {
  const e = new RequestEngine({ db, ai, timezone: 'Asia/Kolkata', contextTtlSeconds: 1800, now: () => Date.parse('2026-11-16T10:00:00Z'), exposedIntents: EXPOSED_INTENTS });
  const msg = { channel: 'simulator', senderId: 'loop-user:1', conversationId: 'chat-1', messageId: `m-${Math.random()}`, text, timestamp: new Date().toISOString() } as IncomingMessage;
  return { r: await e.handle(msg, { id: 1, role: 'employee' }), ai };
};
const looksClean = (t: string) => {
  assert.ok(!/\n\s*\n\s*\n/.test(t) && t === t.trim(), `tidy spacing:\n${t}`);
  for (const line of t.split('\n')) assert.equal((line.match(/\*/g) ?? []).length % 2, 0, `balanced bold: ${line}`);
  assert.ok(!/[{}]|undefined|null/.test(t), `no raw data:\n${t}`);
};

test('private greeting: headed welcome, no AI call', async () => {
  const { r, ai } = await say('hi');
  assert.equal(r.reply, "👋 *Welcome to Loop*\n\nHi! I'm your Loop assistant. How can I help you today?");
  assert.equal(ai.calls.length, 0);
});

test('private help is hidden: "help" gets no help list and goes to the normal classifier', async () => {
  const { r, ai } = await say('help');
  assert.doesNotMatch(r.reply, /What I can help with|HELP|Say hi to get a welcome/);
  assert.equal(ai.calls.length, 1);
  looksClean(r.reply);
});

test("private fallback: \"didn't quite catch that\" is headed, uses one classification call as before", async () => {
  const { r, ai } = await say('blorp zzz');
  assert.equal(r.status, 'not_understood');
  assert.equal(r.reply, "❓ *I didn't quite catch that*\n\nPlease rephrase your request, or ask about your tasks in Loop.");
  assert.equal(ai.calls.length, 1, 'no extra AI calls');
});

test('private: suspended operations get the formatted unavailable reply and nothing is queued', async () => {
  const { r } = await say('create a task for the logo', new MockAIProvider(JSON.stringify({ intent: 'CREATE_TASK', confidence: 0.95, fields: { title: 'Logo' }, ambiguous: [], is_correction: false, cancel: false, answers_pending: false })));
  assert.equal(r.status, 'not_available');
  assert.match(r.reply, /^🔒 \*Not available on WhatsApp\*\n\nTask management is handled in the Loop app/);
  assert.equal((await db('assistant_requests').whereNotIn('status', ['CANCELLED']).count({ n: '*' }).first() as any).n, 0);
  looksClean(r.reply);
});

test('private: cancel with nothing open, and an invalid confirmation code', async () => {
  assert.equal((await say('cancel')).r.reply, 'ℹ️ There is nothing to cancel.');
  const bad = (await say('CONFIRM ZZZZ99')).r.reply;
  looksClean(bad);
  assert.match(bad, /^(ℹ️ |❓ \*)/, "a short formatted reply either way");
});
