/// <reference types="node" />
// Acceptance gate and acceptance reminders. In-memory database, real services, mock WhatsApp sender (nothing is sent).
process.env.SQLITE_FILE = ':memory:';
process.env.WHATSAPP_NOTIFICATION_GROUP_JID = '120363412745413406@g.us';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDB, getDB } from '../db';
import { createTask, updateTask } from './tasks';
import { acceptTask, timerAction } from './taskWorkflow';
import { enqueueAcceptanceReminders, processOutbox, acceptanceReminderMinutes, buildReminderText } from './assignmentNotices';

const db = () => getDB();
const U: Record<string, number> = {};
const mgr = () => ({ id: U.mgr, role: 'manager', name: 'Mia' });
const emp = (k: string) => ({ id: U[k], role: 'employee', name: k });
const ago = (min: number) => new Date(Date.now() - min * 60_000);
const sender = (connected = true) => {
  const sent: { jid: string; text: string; mentions: string[] }[] = [];
  return { sent, isConnected: () => connected, sendGroup: async (jid: string, text: string, mentions: string[]) => { sent.push({ jid, text, mentions }); return true; } };
};
const assignee = (taskId: number, userKey: string) => db()('task_assignees').where({ task_id: taskId, user_id: U[userKey] }).first();

before(async () => {
  await initDB();
  const d = db();
  U.mgr = (await d('users').insert({ name: 'Mia', email: 'mia@acc.test', password_hash: 'x', role: 'manager', pod: 'pod1' }))[0];
  U.nit = (await d('users').insert({ name: 'Nitish', email: 'nit@acc.test', password_hash: 'x', role: 'employee', pod: 'pod1' }))[0];
  U.dhanush = (await d('users').insert({ name: 'Dhanush', email: 'dh@acc.test', password_hash: 'x', role: 'employee', pod: 'pod1' }))[0];
  U.ravi = (await d('users').insert({ name: 'Ravi', email: 'ravi@acc.test', password_hash: 'x', role: 'employee', pod: 'pod1' }))[0];
  await d('assistant_identities').insert({ user_id: U.nit, channel: 'whatsapp', external_sender_id: '+919391283396', status: 'active', active_sender_key: 'whatsapp:+919391283396', active_user_key: `${U.nit}:whatsapp`, linked_via: 'admin', verified_at: new Date() });
  U.P = (await d('projects').insert({ name: 'Acceptance project', pod: 'pod1', created_by: U.mgr, status: 'active', manager_status: 'accepted' }))[0];
  await d('project_members').insert([U.mgr, U.nit, U.dhanush, U.ravi].map((u) => ({ project_id: U.P, user_id: u })));
});
after(async () => { await db().destroy(); });

async function twoAssigneeTask(title: string) {
  const r = await createTask(db(), mgr() as any, { title, project_id: U.P, working_person_id: U.nit, task_manager_id: U.mgr, priority: 'medium' });
  await updateTask(db(), mgr() as any, r.id, { assignee_ids: [U.nit, U.dhanush] });
  return r.id;
}

// ── 1. Acceptance gate ──

test('gate: a task cannot start while a required assignee has not accepted, and the refusal names them', async () => {
  const id = await twoAssigneeTask('Gate: two assignees');
  await assert.rejects(timerAction(db(), emp('nit') as any, id, { action: 'start' }), (e: any) => {
    assert.equal(e.status, 409);
    assert.match(e.message, /Still waiting for: Nitish \(pending\), Dhanush \(pending\)/);
    return true;
  });
  assert.equal((await db()('task_sessions').where({ task_id: id }).count({ n: '*' }).first() as any).n, 0, 'no session started');
});

test('gate: once every required assignee accepts, the task can start', async () => {
  const id = await twoAssigneeTask('Gate: accept then start');
  await acceptTask(db(), emp('nit') as any, id, { action: 'accept' });
  await assert.rejects(timerAction(db(), emp('nit') as any, id, { action: 'start' }), /Dhanush \(pending\)/);
  await acceptTask(db(), emp('dhanush') as any, id, { action: 'accept' });
  await timerAction(db(), emp('nit') as any, id, { action: 'start' });
  assert.equal((await db()('task_sessions').where({ task_id: id, user_id: U.nit }).count({ n: '*' }).first() as any).n, 1);
});

test('gate: a declined assignee still blocks the start, and the refusal says declined', async () => {
  const id = await twoAssigneeTask('Gate: declined');
  await acceptTask(db(), emp('nit') as any, id, { action: 'accept' });
  await acceptTask(db(), emp('dhanush') as any, id, { action: 'decline' });
  await assert.rejects(timerAction(db(), emp('nit') as any, id, { action: 'start' }), /Dhanush \(declined\)/);
});

test('gate: a skipped assignee is not required', async () => {
  const id = await twoAssigneeTask('Gate: skipped');
  await acceptTask(db(), emp('nit') as any, id, { action: 'accept' });
  await db()('task_assignees').where({ task_id: id, user_id: U.dhanush }).update({ skipped: 1 });
  await timerAction(db(), emp('nit') as any, id, { action: 'start' });
  assert.equal((await db()('task_sessions').where({ task_id: id }).count({ n: '*' }).first() as any).n, 1);
});

test('gate: a manager cannot start the task before the assignees accept either', async () => {
  const id = await twoAssigneeTask('Gate: manager premature');
  await assert.rejects(timerAction(db(), mgr() as any, id, { action: 'start' }), /can't start until every assignee accepts/);
});

// ── 2. Acceptance reminders ──

test('reminders: private reminder at 1x and 2x the threshold, then one group escalation; each once and never late', async () => {
  const id = await twoAssigneeTask('Reminder: timing');
  const nowRow = await assignee(id, 'nit');
  assert.ok(nowRow.assigned_at, 'assignment time recorded');
  const set = (m: number) => db()('task_assignees').where({ task_id: id }).update({ assigned_at: ago(m) });
  const keys = async () => (await db()('whatsapp_outbox').where({ task_id: id }).whereIn('kind', ['reminder', 'escalation']).orderBy('id').select('event_key', 'kind')).map((r: any) => `${r.kind}:${r.event_key.split(':')[0]}`);
  await set(0.5);
  assert.equal(await enqueueAcceptanceReminders(db(), new Date(), 1), 0, 'half a minute is too early');
  await set(1.5);
  assert.equal(await enqueueAcceptanceReminders(db(), new Date(), 1), 1, 'first private reminder, only for the linked assignee');
  assert.equal(await enqueueAcceptanceReminders(db(), new Date(), 1), 0, 'a second pass (or a restart) queues nothing new');
  await set(5);
  assert.equal(await enqueueAcceptanceReminders(db(), new Date(), 1), 1, 'second private reminder');
  await set(13);
  assert.equal(await enqueueAcceptanceReminders(db(), new Date(), 1), 1, 'one group escalation for the task');
  assert.equal(await enqueueAcceptanceReminders(db(), new Date(), 1), 0);
  assert.deepEqual(await keys(), ['reminder:remind', 'reminder:remind2', 'escalation:escalate']);
});

test('reminders: a step that was missed is skipped, not sent late (no burst after downtime)', async () => {
  const id = await twoAssigneeTask('Reminder: missed');
  await db()('task_assignees').where({ task_id: id }).update({ assigned_at: ago(90) });
  assert.equal(await enqueueAcceptanceReminders(db(), new Date(), 1), 0);
});

test('reminders: private reminders go only to linked assignees, with no tag and no phone number in the text', async () => {
  const id = await twoAssigneeTask('Reminder: mention');
  await db()('task_assignees').where({ task_id: id }).update({ assigned_at: ago(1.5) });
  await enqueueAcceptanceReminders(db(), new Date(), 1);
  const rows = (await db()('whatsapp_outbox').where({ kind: 'reminder', task_id: id })).map((r: any) => JSON.parse(r.payload));
  assert.equal(rows.length, 1, 'Dhanush has no linked WhatsApp, so no private reminder');
  assert.equal(rows[0].to, '919391283396@s.whatsapp.net');
  assert.match(rows[0].text, /Hi Nitish, this task is waiting for your acceptance/);
  assert.deepEqual(rows[0].mentions, []);
  assert.ok(!/9391283396/.test(rows[0].text + rows[0].caption));
});

test('reminders: the reminder goes to the person\'s private chat, never the group', async () => {
  const id = await twoAssigneeTask('Reminder: verify send');
  await db()('task_assignees').where({ task_id: id, user_id: U.nit }).update({ assigned_at: ago(1.5) });
  await db()('task_assignees').where({ task_id: id, user_id: U.dhanush }).update({ assigned_at: ago(0) });
  await enqueueAcceptanceReminders(db(), new Date(), 1);
  const s = sender(true);
  await processOutbox(db(), s, new Date(), 1000);
  const row = await db()('whatsapp_outbox').where({ kind: 'reminder', task_id: id }).first();
  assert.equal(row.status, 'sent');
  assert.equal(JSON.parse(row.payload).card.fields.find((x: any) => x.label === 'Title').value, 'Reminder: verify send', 'task details are in the picture');
  const mine = s.sent.find((m) => /Reminder: acceptance pending/.test(m.text));
  assert.ok(mine);
  assert.equal(mine.jid, '919391283396@s.whatsapp.net', 'private chat');
  assert.match(mine.text, /Hi Nitish/);
});

test('escalation: names in the group only the people still not accepted, with their manager tagged', async () => {
  const id = await twoAssigneeTask('Reminder: escalate');
  await db()('task_assignees').where({ task_id: id }).update({ assigned_at: ago(13) });
  await db()('assistant_identities').insert({ user_id: U.mgr, channel: 'whatsapp', external_sender_id: 'lid:555000111', status: 'active', active_sender_key: 'whatsapp:lid:555000111', active_user_key: `${U.mgr}:whatsapp`, linked_via: 'admin', verified_at: new Date() });
  await enqueueAcceptanceReminders(db(), new Date(), 1);
  await acceptTask(db(), emp('dhanush') as any, id, { action: 'accept' });
  const s = sender(true);
  await processOutbox(db(), s, new Date(), 1000);
  const m = s.sent.find((x) => /Acceptance overdue/.test(x.text));
  assert.ok(m);
  assert.equal(m.jid, '120363412745413406@g.us');
  assert.match(m.text, /Not accepted:\* @Nitish/);
  assert.ok(!/Dhanush/.test(m.text), 'an assignee who accepted meanwhile is left out');
  assert.match(m.text, /Please follow up:\* @555000111/, 'the task manager is tagged');
  assert.ok(!/Admin User/.test(m.text), 'admins are not tagged for acceptance follow-up');
  assert.ok(m.mentions.includes('555000111@lid') && m.mentions.includes('919391283396@s.whatsapp.net'));
  await acceptTask(db(), emp('nit') as any, id, { action: 'accept' }).catch(() => undefined);
});

test('reminders: an assignee who accepts before the reminder is sent gets no reminder', async () => {
  const id = await twoAssigneeTask('Reminder: accepted first');
  await db()('task_assignees').where({ task_id: id }).update({ assigned_at: ago(3) });
  await enqueueAcceptanceReminders(db(), new Date(), 1);
  await acceptTask(db(), emp('nit') as any, id, { action: 'accept' });
  const s = sender(true);
  await processOutbox(db(), s, new Date(), 1000);
  assert.ok(!s.sent.some((m) => /Acceptance reminder[\s\S]*@Nitish/.test(m.text) && /\*Task:\* Reminder: accepted first/.test(m.text)), 'no reminder for an accepted assignee');
  const row = await db()('whatsapp_outbox').where({ kind: 'reminder', task_id: id }).whereRaw("payload LIKE '%Nitish%'").first();
  assert.equal(row.status, 'cancelled');
});

test('reminders: disconnected WhatsApp sends nothing and leaves the reminder waiting', async () => {
  const id = await twoAssigneeTask('Reminder: offline');
  await db()('task_assignees').where({ task_id: id }).update({ assigned_at: ago(3) });
  await enqueueAcceptanceReminders(db(), new Date(), 1);
  const s = sender(false);
  const res = await processOutbox(db(), s);
  assert.equal(s.sent.length, 0);
  assert.ok(res.waiting >= 1);
});

test('reminders: the threshold is configurable, default five minutes', () => {
  const saved = process.env.ACCEPTANCE_REMINDER_MINUTES;
  try {
    delete process.env.ACCEPTANCE_REMINDER_MINUTES;
    assert.equal(acceptanceReminderMinutes(), 5);
    process.env.ACCEPTANCE_REMINDER_MINUTES = '3';
    assert.equal(acceptanceReminderMinutes(), 3);
    process.env.ACCEPTANCE_REMINDER_MINUTES = '0';
    assert.equal(acceptanceReminderMinutes(), 5, 'an invalid value falls back to the default');
  } finally {
    if (saved === undefined) delete process.env.ACCEPTANCE_REMINDER_MINUTES; else process.env.ACCEPTANCE_REMINDER_MINUTES = saved;
  }
});

test('reminders: reminder text names the task, the project and the next action, and has no phone number', () => {
  const { text, mentions } = buildReminderText({ title: 'Logo pack', project: 'Brand', person: { name: 'Nitish Vetcha', mention: '919391283396@s.whatsapp.net' } });
  assert.match(text, /⏰ \*Reminder: acceptance pending\*\n\nHi Nitish, this task is waiting for your acceptance/);
  assert.match(text, /\*Title:\* Logo pack/);
  assert.ok(!/9391283396/.test(text));
  assert.equal(mentions.length, 0, 'a private message needs no tag');
  const second = buildReminderText({ title: 'Logo pack', project: 'Brand', person: { name: 'Nitish', mention: null }, n: 2, ticket: true });
  assert.match(second.text, /Second reminder[\s\S]*this ticket is still waiting for you[\s\S]*your manager will be informed/);
});
