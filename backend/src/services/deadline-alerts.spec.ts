/// <reference types="node" />
// Deadline approaching alerts. In-memory database, real services, mock WhatsApp sender (nothing is sent).
process.env.SQLITE_FILE = ':memory:';
process.env.WHATSAPP_NOTIFICATION_GROUP_JID = '120363412745413406@g.us';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDB, getDB } from '../db';
import {
  enqueueDeadlineAlerts, processOutbox, deadlineAlertPercent, deadlineInstant, deadlineAlertDue, buildDeadlineText,
} from './assignmentNotices';

const db = () => getDB();
const U: Record<string, number> = {};
const DUE = '2030-11-20';   // fixed and in the future: a date that passes makes old rows look unexpired
const DEADLINE_MS = Date.UTC(2030, 10, 20, 4, 30); // 10:00 Asia/Kolkata
const MIN = 60_000;
const sender = () => {
  const sent: { jid: string; text: string; mentions: string[] }[] = [];
  return { sent, isConnected: () => true, sendGroup: async (jid: string, text: string, mentions: string[]) => { sent.push({ jid, text, mentions }); return true; } };
};

before(async () => {
  await initDB();
  const d = db();
  U.mgr = (await d('users').insert({ name: 'Mia', email: 'mia@dl.test', password_hash: 'x', role: 'manager', pod: 'pod1' }))[0];
  U.nit = (await d('users').insert({ name: 'Nitish', email: 'nit@dl.test', password_hash: 'x', role: 'employee', pod: 'pod1' }))[0];
  U.ravi = (await d('users').insert({ name: 'Ravi', email: 'ravi@dl.test', password_hash: 'x', role: 'employee', pod: 'pod1' }))[0];
  U.gone = (await d('users').insert({ name: 'Declined Dev', email: 'gone@dl.test', password_hash: 'x', role: 'employee', pod: 'pod1' }))[0];
  await d('assistant_identities').insert({ user_id: U.nit, channel: 'whatsapp', external_sender_id: '+919391283396', status: 'active', active_sender_key: 'whatsapp:+919391283396', active_user_key: `${U.nit}:whatsapp`, linked_via: 'admin', verified_at: new Date() });
  U.P = (await d('projects').insert({ name: 'Deadline project', pod: 'pod1', created_by: U.mgr, status: 'active', manager_status: 'accepted' }))[0];
});
after(async () => { await db().destroy(); });

// A regular task due 2030-11-20 10:00 IST with one employee assignee unless told otherwise
async function task(opts: { title: string; hours?: number; due_time?: string | null; status?: string; assignees?: { key: string; acceptance?: string }[] }) {
  const d = db();
  const [id] = await d('tasks').insert({
    title: opts.title, project_id: U.P, created_by: U.mgr, status: opts.status ?? 'pending', priority: 'medium',
    due_date: DUE, due_time: opts.due_time === undefined ? '10:00' : opts.due_time, estimated_hours: opts.hours ?? 1,
  });
  for (const a of opts.assignees ?? [{ key: 'nit' }]) {
    await d('task_assignees').insert({ task_id: id, user_id: U[a.key], assignee_role: 'employee', acceptance_status: a.acceptance ?? 'pending', assigned_at: new Date() });
  }
  return Number(id);
}
const alertsFor = async (taskId: number) => db()('whatsapp_outbox').where({ kind: 'deadline', task_id: taskId });

// ── Threshold and timing ──

test('threshold: 12% by default, configurable, invalid values fall back to 12', () => {
  const saved = process.env.DEADLINE_ALERT_PERCENT;
  try {
    delete process.env.DEADLINE_ALERT_PERCENT;
    assert.equal(deadlineAlertPercent(), 12);
    process.env.DEADLINE_ALERT_PERCENT = '15';
    assert.equal(deadlineAlertPercent(), 15);
    process.env.DEADLINE_ALERT_PERCENT = '0';
    assert.equal(deadlineAlertPercent(), 12);
  } finally {
    if (saved === undefined) delete process.env.DEADLINE_ALERT_PERCENT; else process.env.DEADLINE_ALERT_PERCENT = saved;
  }
});

test('timing: a one-hour task alerts at about seven minutes left, exactly at the threshold, and not before', () => {
  const args = { deadlineMs: DEADLINE_MS, estimatedHours: 1, percent: 12 };
  assert.equal(deadlineAlertDue({ ...args, nowMs: DEADLINE_MS - 8 * MIN }), false, 'eight minutes left: too early');
  assert.equal(deadlineAlertDue({ ...args, nowMs: DEADLINE_MS - 7.2 * MIN }), true, 'exactly 12% left: alert');
  assert.equal(deadlineAlertDue({ ...args, nowMs: DEADLINE_MS - 7 * MIN }), true, 'seven minutes left: alert');
  assert.equal(deadlineAlertDue({ ...args, nowMs: DEADLINE_MS }), false, 'at the deadline: not an approaching alert');
  assert.equal(deadlineAlertDue({ ...args, nowMs: DEADLINE_MS + MIN }), false, 'overdue: no approaching alert');
});

test('threshold calculation scales with the allotted duration', () => {
  // A two-hour task: 12% is 14.4 minutes
  assert.equal(deadlineAlertDue({ deadlineMs: DEADLINE_MS, estimatedHours: 2, nowMs: DEADLINE_MS - 14 * MIN, percent: 12 }), true);
  assert.equal(deadlineAlertDue({ deadlineMs: DEADLINE_MS, estimatedHours: 2, nowMs: DEADLINE_MS - 15 * MIN, percent: 12 }), false);
  assert.equal(deadlineAlertDue({ deadlineMs: DEADLINE_MS, estimatedHours: 0, nowMs: DEADLINE_MS - 1 * MIN, percent: 12 }), false, 'no allotted duration: never alerts');
});

test('timezone: the stored date and time are read as Asia/Kolkata, and a missing time means end of day', () => {
  assert.equal(deadlineInstant('2030-11-20', '10:00'), DEADLINE_MS);
  assert.equal(deadlineInstant('2030-11-20', null), Date.parse('2030-11-20T23:59:00+05:30'));
  assert.equal(deadlineInstant('not-a-date', '10:00'), null);
});

test('timing in the live pass: the alert is queued only inside the window', async () => {
  const id = await task({ title: 'Window task', hours: 1 });
  assert.equal(await enqueueDeadlineAlerts(db(), new Date(DEADLINE_MS - 8 * MIN), 12), 0, 'eight minutes left: nothing yet');
  assert.equal(await enqueueDeadlineAlerts(db(), new Date(DEADLINE_MS - 7 * MIN), 12), 1, 'seven minutes left: one alert');
  assert.equal((await alertsFor(id)).length, 1);
});

// ── Eligibility ──

test('completed and cancelled tasks are never alerted', async () => {
  const done = await task({ title: 'Done task', status: 'completed' });
  const cancelled = await task({ title: 'Cancelled task', status: 'cancelled' });
  await enqueueDeadlineAlerts(db(), new Date(DEADLINE_MS - 5 * MIN), 12);
  assert.equal((await alertsFor(done)).length, 0);
  assert.equal((await alertsFor(cancelled)).length, 0);
});

test('an overdue task gets no "approaching" alert, and exactly one "crossed" alert however often the pass runs', async () => {
  const id = await task({ title: 'Overdue task' });
  await enqueueDeadlineAlerts(db(), new Date(DEADLINE_MS + 30 * MIN), 12);
  await enqueueDeadlineAlerts(db(), new Date(DEADLINE_MS + 60 * MIN), 12);
  const rows = await alertsFor(id);
  assert.deepEqual(rows.map((r: any) => r.event_key.endsWith(':group') ? 'group' : 'private').sort(), ['group', 'private'], 'one private alert and one group follow-up, once');
  assert.ok(rows.every((r: any) => /^overdue:/.test(r.event_key)));
});

test('a task with no allotted duration, or no deadline date, is not alerted', async () => {
  const noHours = await task({ title: 'No hours', hours: 0 });
  const d = db();
  const [noDate] = await d('tasks').insert({ title: 'No date', project_id: U.P, created_by: U.mgr, status: 'pending', priority: 'medium', estimated_hours: 1 });
  await d('task_assignees').insert({ task_id: noDate, user_id: U.nit, assignee_role: 'employee', acceptance_status: 'pending', assigned_at: new Date() });
  await enqueueDeadlineAlerts(db(), new Date(DEADLINE_MS - 5 * MIN), 12);
  assert.equal((await alertsFor(noHours)).length, 0);
  assert.equal((await alertsFor(Number(noDate))).length, 0);
});

// ── Mentions and content ──

test('the alert goes privately to each linked assignee (no tag needed); unlinked and declined assignees get nothing', async () => {
  const id = await task({ title: 'Mentions task', assignees: [{ key: 'nit' }, { key: 'ravi' }, { key: 'gone', acceptance: 'declined' }] });
  await enqueueDeadlineAlerts(db(), new Date(DEADLINE_MS - 5 * MIN), 12);
  const rows = await alertsFor(id);
  assert.equal(rows.length, 1, 'only Nitish is linked');
  const p = JSON.parse(rows[0].payload);
  assert.equal(p.to, '919391283396@s.whatsapp.net');
  assert.match(p.text, /Deadline approaching/);
  assert.match(p.text, /\*Task:\* Mentions task/);
  assert.match(p.text, /\*Due:\* .*\(IST\)/);
  assert.ok(!/Ravi|Declined Dev|@/.test(p.text), 'only about the recipient, no tags');
  assert.deepEqual(p.mentions, []);
});

test('the alert text has no phone number and states the time left', () => {
  const { text, mentions } = buildDeadlineText({ title: 'T', project: 'P', dueLabel: '20 Nov, 10:00 am', minutesLeft: 7, people: [{ name: 'Nitish', mention: '919391283396@s.whatsapp.net' }] });
  assert.match(text, /about 7 minutes/);
  assert.ok(!/9391283396/.test(text));
  assert.equal(mentions.length, 1);
});

// ── Duplicates and restarts ──

test('duplicate prevention: repeated passes and a restart queue one alert per task deadline', async () => {
  const id = await task({ title: 'Once only' });
  await enqueueDeadlineAlerts(db(), new Date(DEADLINE_MS - 6 * MIN), 12);
  await enqueueDeadlineAlerts(db(), new Date(DEADLINE_MS - 5 * MIN), 12);
  // Restart: a new process has no memory, and the database is the only record
  await enqueueDeadlineAlerts(db(), new Date(DEADLINE_MS - 4 * MIN), 12);
  assert.equal((await alertsFor(id)).length, 1);
});

test('a changed deadline is a new deadline and may be alerted again', async () => {
  const id = await task({ title: 'Moved deadline' });
  await enqueueDeadlineAlerts(db(), new Date(DEADLINE_MS - 5 * MIN), 12);
  await db()('tasks').where({ id }).update({ due_time: '12:00' });
  const newDeadline = Date.UTC(2030, 10, 20, 6, 30);
  await enqueueDeadlineAlerts(db(), new Date(newDeadline - 5 * MIN), 12);
  assert.deepEqual((await alertsFor(id)).map((r: any) => r.event_key.split(':').slice(0, 3).join(':')), [`deadline:${id}:${DEADLINE_MS}`, `deadline:${id}:${newDeadline}`], 'an alert for the new deadline; the old one is not "crossed" because it was moved');
});

// ── Sending ──

test('the alert is sent to the person\'s private chat; a task completed before sending is not sent', async () => {
  const live = await task({ title: 'Sent task' });
  const done = await task({ title: 'Finished in time' });
  await enqueueDeadlineAlerts(db(), new Date(DEADLINE_MS - 5 * MIN), 12);
  await db()('tasks').where({ id: done }).update({ status: 'completed' });
  // The test clock is days ahead of the real one: align the queued rows' creation time with it, as in production
  await db()('whatsapp_outbox').whereIn('task_id', [live, done]).update({ created_at: new Date(DEADLINE_MS - 5 * MIN) });
  const s = sender();
  await processOutbox(db(), s, new Date(DEADLINE_MS - 4 * MIN), 1000);
  assert.equal(JSON.parse((await alertsFor(live))[0].payload).card.title, 'Sent task', 'task details are in the picture');
  const mine = s.sent.find((m) => /Deadline approaching/.test(m.text));
  assert.ok(mine, 'the live task alert was sent');
  assert.equal(mine.jid, '919391283396@s.whatsapp.net', 'private chat of the linked assignee');
  assert.equal(s.sent.filter((m) => /Deadline approaching/.test(m.text)).length, 1, 'no alert for a task finished before sending');
  const cancelled = await alertsFor(done);
  assert.equal(cancelled[0].status, 'cancelled');
  assert.ok((await alertsFor(live))[0].status === 'sent');
});

test('no group configured: nothing is queued', async () => {
  const saved = process.env.WHATSAPP_NOTIFICATION_GROUP_JID;
  try {
    delete process.env.WHATSAPP_NOTIFICATION_GROUP_JID;
    const id = await task({ title: 'No group' });
    assert.equal(await enqueueDeadlineAlerts(db(), new Date(DEADLINE_MS - 5 * MIN), 12), 0);
    assert.equal((await alertsFor(id)).length, 0);
  } finally {
    process.env.WHATSAPP_NOTIFICATION_GROUP_JID = saved;
  }
});

test('deadline crossed: one alert once the deadline passes on an open task; none if finished, none twice, none for deadlines long gone', async () => {
  const open = await task({ title: 'Crossed open', hours: 2 });
  const done = await task({ title: 'Crossed but done', hours: 2, status: 'completed' });
  const noEstimate = await task({ title: 'Crossed no estimate', hours: 0 });
  const at = new Date(DEADLINE_MS + 25 * MIN);
  await enqueueDeadlineAlerts(db(), at, 12);
  await enqueueDeadlineAlerts(db(), at, 12);
  const rows = await db()('whatsapp_outbox').where('event_key', 'like', 'overdue:%').whereNot('event_key', 'like', '%:group').whereIn('task_id', [open, done, noEstimate]);
  const group = JSON.parse((await db()('whatsapp_outbox').where({ event_key: `overdue:${open}:${DEADLINE_MS}:group` }).first()).payload);
  assert.ok(!group.to, 'the follow-up goes to the group');
  assert.match(group.caption, /🚨 \*Deadline crossed\*\n\n👥 @Nitish[\s\S]*Please follow up:\* .*Mia/, 'people on it tagged, managers (and admins) asked to follow up');
  assert.deepEqual(rows.map((r: any) => Number(r.task_id)).sort(), [open, noEstimate].sort(), 'open tasks only, once each, estimate not needed');
  const p = JSON.parse(rows.find((r: any) => Number(r.task_id) === open).payload);
  const f = Object.fromEntries(p.card.fields.map((x: any) => [x.label, x.value]));
  assert.equal(f['Overdue by'], '25 minutes');
  assert.equal(f['Was due'], '20 Nov, 10:00 am (IST)');
  assert.match(p.caption, /^🚨 \*Deadline crossed\*\n\n👉 /);
  const late = await task({ title: 'Crossed long ago', hours: 2 });
  await enqueueDeadlineAlerts(db(), new Date(DEADLINE_MS + 30 * 3600_000), 12);
  assert.equal((await db()('whatsapp_outbox').where('event_key', 'like', `overdue:${late}:${DEADLINE_MS}%`)).length, 0, 'not announced a day late');
});
