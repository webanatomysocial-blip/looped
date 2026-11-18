/// <reference types="node" />
// Scheduled productivity reports and tracked hours. In-memory database, mock WhatsApp sender (nothing is sent).
process.env.SQLITE_FILE = ':memory:';
process.env.WHATSAPP_NOTIFICATION_GROUP_JID = '120363412745413406@g.us';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDB, getDB } from '../db';
import { processOutbox } from './assignmentNotices';
import {
  istParts, isWeekday, previousIstDate, previousWorkingDate, trackedTime, formatHours, buildMorningReport, buildEveningReport, enqueueScheduledReports,
} from './productivityReports';

const db = () => getDB();
const U: Record<string, number> = {};
const T: Record<string, number> = {};
const ist = (s: string) => new Date(`${s}+05:30`);     // e.g. ist('2026-11-16T09:00:00')
const MON = '2026-11-16';                              // a Monday
const H = 3_600_000;

before(async () => {
  await initDB();
  const d = db();
  U.mgr = (await d('users').insert({ name: 'Mia', email: 'mia@rep.test', password_hash: 'x', role: 'manager', pod: 'pod1' }))[0];
  U.nit = (await d('users').insert({ name: 'Nitish', email: 'nit@rep.test', password_hash: 'x', role: 'employee', pod: 'pod1' }))[0];
  U.ravi = (await d('users').insert({ name: 'Ravi', email: 'ravi@rep.test', password_hash: 'x', role: 'employee', pod: 'pod1' }))[0];
  U.P = (await d('projects').insert({ name: 'WebAnatomy', pod: 'pod1', created_by: U.mgr, status: 'active', manager_status: 'accepted' }))[0];
  const task = async (key: string, f: Record<string, unknown>, assignedAt: Date) => {
    const [id] = await d('tasks').insert({ project_id: U.P, created_by: U.mgr, status: 'pending', priority: 'medium', ...f });
    T[key] = Number(id);
    await d('task_assignees').insert({ task_id: id, user_id: U.nit, assignee_role: 'employee', acceptance_status: 'accepted', assigned_at: assignedAt });
  };
  await task('overdue', { title: 'Overdue banner', priority: 'high', due_date: '2026-11-15', due_time: '17:00' }, ist('2026-11-14T10:00:00'));
  await task('pending', { title: 'Pending logo', due_date: '2026-11-20', due_time: '12:00' }, ist('2026-11-15T10:00:00'));
  await task('doneFriday', { title: 'Done Friday', status: 'completed', completed_at: ist('2026-11-13T15:00:00') }, ist('2026-11-14T10:00:00'));
  await task('newToday', { title: 'New today' }, ist('2026-11-16T10:00:00'));
  await task('doneToday', { title: 'Done today', status: 'completed', completed_at: ist('2026-11-16T14:00:00') }, ist('2026-11-14T10:00:00'));
  await task('cancelled', { title: 'Cancelled one', status: 'cancelled' }, ist('2026-11-14T10:00:00'));

  // Nitish's time on Monday: 1h closed session (with its own session-linked log), 0.5h manual entry,
  // 0.5h of a session that crossed midnight, and a running session that started 30 minutes before 18:00
  const [sA] = await d('task_sessions').insert({ task_id: T.pending, user_id: U.nit, started_at: ist('2026-11-16T10:00:00'), ended_at: ist('2026-11-16T11:00:00'), session_date: '2026-11-16' });
  await d('time_logs').insert({ task_id: T.pending, project_id: U.P, user_id: U.nit, task_session_id: sA, log_date: '2026-11-16', hours: 1 });
  await d('time_logs').insert({ task_id: T.pending, project_id: U.P, user_id: U.nit, task_session_id: null, log_date: MON, hours: 0.5, notes: 'manual' });
  await d('task_sessions').insert({ task_id: T.pending, user_id: U.nit, started_at: ist('2026-11-15T23:30:00'), ended_at: ist('2026-11-16T00:30:00'), session_date: '2026-11-15' });
  await d('task_sessions').insert({ task_id: T.pending, user_id: U.nit, started_at: ist('2026-11-16T17:30:00'), ended_at: null, session_date: '2026-11-16' });
});
after(async () => { await db().destroy(); });

// ── Timezone and weekdays ──

test('timezone: instants are read in Asia/Kolkata, including across the UTC date line', () => {
  assert.deepEqual(istParts(ist('2026-11-16T09:00:00')), { date: '2026-11-16', weekday: 'Mon', minutes: 540 });
  assert.equal(istParts(new Date('2026-11-15T19:00:00Z')).date, '2026-11-16', '00:30 IST is already Monday');
  assert.equal(previousIstDate('2026-11-16'), '2026-11-15');
  assert.ok(isWeekday('Mon') && isWeekday('Fri'));
  assert.ok(!isWeekday('Sat') && !isWeekday('Sun'));
});

test('scheduling: nothing on a weekend or before 09:00; the morning report at 09:00 once; the evening report at 18:00 once', async () => {
  assert.deepEqual(await enqueueScheduledReports(db(), ist('2026-11-14T09:30:00')), [], 'Saturday: no report');
  assert.deepEqual(await enqueueScheduledReports(db(), ist('2026-11-15T18:30:00')), [], 'Sunday: no report');
  assert.deepEqual(await enqueueScheduledReports(db(), ist('2026-11-16T08:59:00')), [], 'before 09:00: nothing');
  assert.deepEqual(await enqueueScheduledReports(db(), ist('2026-11-16T09:00:00')), ['report_morning:pod1:2026-11-16']);
  assert.deepEqual(await enqueueScheduledReports(db(), ist('2026-11-16T09:05:00')), [], 'a second pass queues nothing');
  assert.deepEqual(await enqueueScheduledReports(db(), ist('2026-11-16T17:59:00')), []);
  assert.deepEqual(await enqueueScheduledReports(db(), ist('2026-11-16T18:00:00')), ['report_evening:pod1:2026-11-16']);
  assert.deepEqual(await enqueueScheduledReports(db(), ist('2026-11-16T18:30:00')), [], 'and only once');
});

test('restart and late start: a scheduler that comes up after 18:00 sends only the evening report, and never repeats it', async () => {
  assert.deepEqual(await enqueueScheduledReports(db(), ist('2026-11-17T18:20:00')), ['report_evening:pod1:2026-11-17'], 'the stale morning report is skipped');
  // A restart: the outbox is the only record, so nothing is queued twice
  assert.deepEqual(await enqueueScheduledReports(db(), ist('2026-11-17T18:21:00')), []);
  const rows = await db()('whatsapp_outbox').where('event_key', 'like', 'report_%:2026-11-17');
  assert.equal(rows.length, 1, 'one per pod; an empty "No pod" report is not sent');
});

// ── Report contents ──

test('morning report: pending, overdue and completed work per employee; completed work is never pending', async () => {
  const text = await buildMorningReport(db(), ist('2026-11-16T09:00:00'));
  assert.match(text, /Good morning! Pending work from Fri, 13 Nov/);
  assert.match(text, /\*Nitish\* — 2 pending, 1 overdue, 1 completed Fri, 13 Nov – Sun, 15 Nov/);
  assert.match(text, /⚠️ Overdue: Overdue banner \(WebAnatomy, High, due 15 Nov, 5:00 pm \(IST\)\)/);
  assert.match(text, /Pending: Pending logo \(WebAnatomy, Medium, due 20 Nov, 12:00 pm \(IST\)\)/);
  assert.match(text, /✅ Completed: Done Friday/);
  assert.match(text, /Pending: Done today/, 'completed at 14:00 today, so still outstanding at 09:00');
  assert.ok(!/✅ Completed: Done today/.test(text), 'completed today is not part of Friday');
  assert.ok(!/New today/.test(text), 'assigned today is not carried forward');
  assert.ok(!/Cancelled one/.test(text), 'cancelled work is left out');
  assert.match(text, /No pending work from Fri, 13 Nov: .*Ravi/);
});

test('evening report: assigned, completed, pending, overdue, workload and actual tracked hours per employee', async () => {
  const text = await buildEveningReport(db(), ist('2026-11-16T18:00:00'));
  assert.match(text, /Day-end report — Mon, 16 Nov/);
  assert.match(text, /\*Nitish\* — tracked 2h 30m/);
  assert.match(text, /Assigned today 1 · Completed 1 · Pending 2 · Overdue 1 · Workload 3 open/);
  assert.match(text, /✅ Completed: Done today/);
  assert.match(text, /\*Ravi\* — no time recorded/, 'no records is not shown as zero hours');
  assert.match(text, /not from estimates/);
});

// ── Tracked hours ──

test('tracked hours: sessions clipped to the IST day, manual entries added, session logs not counted twice', async () => {
  const t = await trackedTime(db(), [U.nit, U.ravi], MON, ist('2026-11-16T18:00:00').getTime());
  // 1h closed session + 0.5h manual + 0.5h of the midnight-crossing session + 0.5h running session
  assert.equal(t.get(U.nit)!.ms, 2.5 * H);
  assert.equal(t.get(U.nit)!.hasRecords, true);
  assert.equal(t.get(U.ravi)!.ms, 0);
  assert.equal(t.get(U.ravi)!.hasRecords, false, 'missing records are distinct from zero hours');
  assert.equal(formatHours(2.5 * H), '2h 30m');
});

test('tracked hours: the previous day gets only its own share of a session that crossed midnight', async () => {
  const t = await trackedTime(db(), [U.nit], '2026-11-15', ist('2026-11-16T18:00:00').getTime());
  assert.equal(t.get(U.nit)!.ms, 0.5 * H, '23:30–00:00 only');
});

// ── Delivery ──

test('failed delivery: a report is not marked sent when sending fails, and is retried until it succeeds', async () => {
  const at = ist('2026-11-18T09:10:00');
  assert.deepEqual(await enqueueScheduledReports(db(), at), ['report_morning:pod1:2026-11-18']);
  await db()('whatsapp_outbox').where({ event_key: 'report_morning:pod1:2026-11-18' }).update({ created_at: at });
  const failing = { sent: [] as string[], isConnected: () => true, sendGroup: async () => false };
  await processOutbox(db(), failing, at, 1000);
  let row = await db()('whatsapp_outbox').where({ event_key: 'report_morning:pod1:2026-11-18' }).first();
  assert.equal(row.status, 'pending', 'not marked delivered');
  assert.equal(row.attempts, 1);
  assert.equal(row.last_error, 'send_failed');
  const sent: { jid: string; text: string }[] = [];
  const ok = { isConnected: () => true, sendGroup: async (jid: string, text: string) => { sent.push({ jid, text }); return true; } };
  await processOutbox(db(), ok, new Date(at.getTime() + 5 * 60_000), 1000);
  row = await db()('whatsapp_outbox').where({ event_key: 'report_morning:pod1:2026-11-18' }).first();
  assert.equal(row.status, 'sent');
  const report = sent.find((s) => /Good morning/.test(s.text));
  assert.ok(report, 'the report was delivered on retry');
  assert.equal(report.jid, '120363412745413406@g.us', 'only the configured group');
});

test('report card: sent as a PNG with a short caption; full text if the image cannot be drawn', async () => {
  const at = ist('2026-11-20T18:05:00');
  await enqueueScheduledReports(db(), at);
  await db()('whatsapp_outbox').where({ event_key: 'report_evening:pod1:2026-11-20' }).update({ created_at: at });
  const sent: { text: string; image?: Buffer }[] = [];
  await processOutbox(db(), { isConnected: () => true, sendGroup: async (_j: string, text: string, _m: string[], image?: Buffer) => { sent.push({ text, image }); return true; } }, at, 1000);
  const r = sent.find((s) => /Day-end report/.test(s.text))!;
  assert.ok(r.image && r.image.subarray(1, 4).toString() === 'PNG', 'a PNG image');
  assert.ok(r.text.split('\n').length <= 3, 'caption is at most 3 lines');
  assert.match(r.text, /done · .* pending · .* overdue/);
  // A damaged card falls back to the full text report
  await db()('whatsapp_outbox').where({ event_key: 'report_evening:pod1:2026-11-20' }).update({ status: 'pending', payload: JSON.stringify({ text: 'FULL TEXT', caption: 'c', card: { bad: true }, mentions: [] }) });
  sent.length = 0;
  await processOutbox(db(), { isConnected: () => true, sendGroup: async (_j: string, text: string, _m: string[], image?: Buffer) => { sent.push({ text, image }); return true; } }, at, 1000);
  assert.deepEqual(sent, [{ text: 'FULL TEXT', image: undefined }]);
});

test('disconnected WhatsApp: the report waits and nothing is sent', async () => {
  const at = ist('2026-11-19T18:05:00');
  await enqueueScheduledReports(db(), at);
  const offline = { sent: [] as string[], isConnected: () => false, sendGroup: async () => true };
  const res = await processOutbox(db(), offline, at, 1000);
  assert.equal(res.sent, 0);
  const row = await db()('whatsapp_outbox').where({ event_key: 'report_evening:pod1:2026-11-19' }).first();
  assert.equal(row.status, 'pending');
});

test('no group configured: no report is queued', async () => {
  const saved = process.env.WHATSAPP_NOTIFICATION_GROUP_JID;
  try {
    delete process.env.WHATSAPP_NOTIFICATION_GROUP_JID;
    assert.deepEqual(await enqueueScheduledReports(db(), ist('2026-11-20T09:30:00')), []);
  } finally {
    process.env.WHATSAPP_NOTIFICATION_GROUP_JID = saved;
  }
});

// ── Working-day reporting period ──

test('reporting day: Monday → Friday, Tuesday–Friday → the previous weekday, never a weekend', () => {
  assert.equal(previousWorkingDate('2026-11-16'), '2026-11-13', 'Monday reports Friday');
  assert.equal(previousWorkingDate('2026-11-17'), '2026-11-16', 'Tuesday reports Monday');
  assert.equal(previousWorkingDate('2026-11-18'), '2026-11-17');
  assert.equal(previousWorkingDate('2026-11-19'), '2026-11-18');
  assert.equal(previousWorkingDate('2026-11-20'), '2026-11-19', 'Friday reports Thursday');
  assert.equal(previousWorkingDate('2026-11-22'), '2026-11-20', 'even from a Sunday, the answer is a weekday');
});

test('weekends: no morning or evening report on Saturday or Sunday at any time', async () => {
  for (const at of ['2026-11-21T09:00:00', '2026-11-21T18:00:00', '2026-11-22T09:00:00', '2026-11-22T23:00:00']) {
    assert.deepEqual(await enqueueScheduledReports(db(), ist(at)), [], at);
  }
});

test('Monday evening reports Monday activity only', async () => {
  const text = await buildEveningReport(db(), ist('2026-11-16T18:00:00'));
  assert.match(text, /Mon, 16 Nov/);
  assert.match(text, /✅ Completed: Done today/);
  assert.ok(!/Done Friday/.test(text), "Friday's completions belong to Friday");
});

test('delayed execution: a late run produces the same report for the intended date', async () => {
  assert.equal(await buildMorningReport(db(), ist('2026-11-16T11:45:00')), await buildMorningReport(db(), ist('2026-11-16T09:00:00')));
  assert.equal(await buildEveningReport(db(), ist('2026-11-16T21:30:00')), await buildEveningReport(db(), ist('2026-11-16T18:00:00')));
  // A morning report is never sent hours late (e.g. when WhatsApp connects in the afternoon) …
  assert.deepEqual(await enqueueScheduledReports(db(), ist('2026-11-19T17:30:00')), [], 'too late: skipped, not sent');
  assert.deepEqual(await enqueueScheduledReports(db(), ist('2026-11-19T09:31:00')), [], 'the window closes after 30 minutes');
  // … but a pass a few minutes after 09:00 still sends it, with Thursday's key and Wednesday's work
  assert.deepEqual(await enqueueScheduledReports(db(), ist('2026-11-19T09:20:00')), ['report_morning:pod1:2026-11-19']);
  const row = await db()('whatsapp_outbox').where({ event_key: 'report_morning:pod1:2026-11-19' }).first();
  assert.match(JSON.parse(row.payload).text, /Pending work from Wed, 18 Nov/);
});

test('classification at 09:00: past deadline is overdue, later deadline is pending, completed is completed', async () => {
  const d = db();
  const [kiran] = await d('users').insert({ name: 'Kiran', email: 'kiran@rep.test', password_hash: 'x', role: 'employee', pod: 'pod1' });
  const add = async (title: string, f: Record<string, unknown>) => {
    const [id] = await d('tasks').insert({ title, project_id: U.P, created_by: U.mgr, status: 'pending', priority: 'medium', ...f });
    await d('task_assignees').insert({ task_id: id, user_id: kiran, assignee_role: 'employee', acceptance_status: 'accepted', assigned_at: ist('2026-11-12T10:00:00') });
  };
  await add('K due Fri', { due_date: '2026-11-13', due_time: '17:00' });
  await add('K due Mon 10am', { due_date: '2026-11-16', due_time: '10:00' });
  await add('K done Fri', { status: 'completed', completed_at: ist('2026-11-13T16:00:00') });
  await add('K done Sat', { status: 'completed', completed_at: ist('2026-11-14T12:00:00') });
  const text = await buildMorningReport(d, ist('2026-11-16T11:45:00'));
  assert.match(text, /\*Kiran\* — 1 pending, 1 overdue, 2 completed Fri, 13 Nov – Sun, 15 Nov/);
  assert.match(text, /⚠️ Overdue: K due Fri/);
  assert.match(text, /Pending: K due Mon 10am/, 'not yet overdue at 09:00, even though the run was at 11:45');
  assert.match(text, /✅ Completed: K done Fri/);
  assert.match(text, /✅ Completed: K done Sat/, 'weekend completions are reported on Monday');
  const tue = await buildMorningReport(d, ist('2026-11-17T09:00:00'));
  assert.ok(!/K done Sat|K done Fri/.test(tue), 'Tuesday reports Monday only');
  assert.match(tue, /completed on Mon, 16 Nov/);
});

test('evening "Assigned today" counts only assignments made by 18:00, even on a late run', async () => {
  const d = db();
  const [asha] = await d('users').insert({ name: 'Asha', email: 'asha@rep.test', password_hash: 'x', role: 'employee', pod: 'pod1' });
  for (const [title, at] of [['A at 17:59', '2026-11-20T17:59:00'], ['A at 18:00', '2026-11-20T18:00:00'], ['A at 19:30', '2026-11-20T19:30:00']]) {
    const [id] = await d('tasks').insert({ title, project_id: U.P, created_by: U.mgr, status: 'pending', priority: 'medium' });
    await d('task_assignees').insert({ task_id: id, user_id: asha, assignee_role: 'employee', acceptance_status: 'accepted', assigned_at: ist(at) });
  }
  const text = await buildEveningReport(d, ist('2026-11-20T21:00:00'));
  assert.match(text, /\*Asha\* — no time recorded\n  Assigned today 2 ·/);
});

test('no flood on reconnect: a report waiting more than 30 minutes is dropped, not sent late', async () => {
  const at = ist('2026-11-23T09:00:00');   // a Monday
  assert.deepEqual(await enqueueScheduledReports(db(), at), ['report_morning:pod1:2026-11-23']);
  await db()('whatsapp_outbox').where({ event_key: 'report_morning:pod1:2026-11-23' }).update({ created_at: at });
  const sent: string[] = [];
  const sender = { isConnected: () => true, sendGroup: async (_j: string, t: string) => { sent.push(t); return true; } };
  await processOutbox(db(), sender, ist('2026-11-23T15:30:00'), 1000);   // WhatsApp only connects in the afternoon
  assert.equal(sent.filter((t) => /Good morning/.test(t)).length, 0, 'the morning report is not sent in the afternoon');
  const row = await db()('whatsapp_outbox').where({ event_key: 'report_morning:pod1:2026-11-23' }).first();
  assert.equal(row.status, 'failed');
  assert.equal(row.last_error, 'expired');
});

test('each task is listed once per person, even when a multi-stage task assigns them twice', async () => {
  const d = db();
  const [uid] = await d('users').insert({ name: 'Bhagya', email: 'bhagya@rep.test', password_hash: 'x', role: 'employee', pod: 'pod1' });
  const [tid] = await d('tasks').insert({ title: 'ZE 2nd Video', project_id: U.P, created_by: U.mgr, status: 'pending', priority: 'medium', due_date: '2026-11-10', due_time: '23:59' });
  for (const stage of [0, 1]) await d('task_assignees').insert({ task_id: tid, user_id: uid, assignee_role: 'employee', acceptance_status: 'accepted', assigned_at: ist('2026-11-09T10:00:00'), stage_idx: stage });
  const text = await buildMorningReport(d, ist('2026-11-24T09:00:00'));
  assert.equal((text.match(/ZE 2nd Video/g) ?? []).length, 1);
  assert.match(text, /\*Bhagya\* — 0 pending, 1 overdue/);
});

test('reminders: only for assignments from the last day, so connecting never reminds people about weeks-old work', async () => {
  const { enqueueAcceptanceReminders } = await import('./assignmentNotices');
  const d = db();
  const now = ist('2026-11-25T15:00:00');
  const [oldTask] = await d('tasks').insert({ title: 'Old unaccepted', project_id: U.P, created_by: U.mgr, status: 'pending', priority: 'medium' });
  await d('task_assignees').insert({ task_id: oldTask, user_id: U.ravi, assignee_role: 'employee', acceptance_status: 'pending', assigned_at: ist('2026-11-01T10:00:00') });
  const [newTask] = await d('tasks').insert({ title: 'New unaccepted', project_id: U.P, created_by: U.mgr, status: 'pending', priority: 'medium' });
  await d('task_assignees').insert({ task_id: newTask, user_id: U.ravi, assignee_role: 'employee', acceptance_status: 'pending', assigned_at: ist('2026-11-25T14:45:00') });
  await enqueueAcceptanceReminders(d, now, 1);
  const rows = await d('whatsapp_outbox').whereIn('kind', ['reminder', 'escalation']).whereIn('task_id', [oldTask, newTask]).select('task_id');
  assert.deepEqual(rows.map((r: any) => Number(r.task_id)), [Number(newTask)]);
});

test('pods: one report per pod, each with only its own members and their numbers, titled with the pod', async () => {
  const { employeePods, morningReport } = await import('./productivityReports');
  const d = db();
  const [zara] = await d('users').insert({ name: 'Zara Pod2', email: 'zara@rep.test', password_hash: 'x', role: 'employee', pod: 'pod2' });
  const [tid] = await d('tasks').insert({ title: 'Pod2 overdue', project_id: U.P, created_by: U.mgr, status: 'pending', priority: 'medium', due_date: '2026-11-10', due_time: '10:00' });
  await d('task_assignees').insert({ task_id: tid, user_id: zara, assignee_role: 'employee', acceptance_status: 'accepted', assigned_at: ist('2026-11-09T10:00:00') });
  const pods = await employeePods(d);
  const p1 = pods.find((p) => p.key === 'pod1')!, p2 = pods.find((p) => p.key === 'pod2')!;
  assert.equal(p1.label, 'POD 1');
  assert.ok(p1.ids.includes(U.nit) && !p1.ids.includes(Number(zara)));
  assert.deepEqual(p2.ids, [Number(zara)]);
  const r1 = await morningReport(d, ist('2026-11-26T09:00:00'), p1);
  const r2 = await morningReport(d, ist('2026-11-26T09:00:00'), p2);
  assert.match(r1.card.title, /^POD 1 · Good morning/);
  assert.match(r2.card.title, /^POD 2 · Good morning/);
  assert.deepEqual(r2.card.rows.map((r) => [r.name, ...r.values]), [['Zara Pod2', 0, 0, 1]], 'pod 2 sees only its member and her real counts');
  assert.ok(!r1.card.rows.some((r) => r.name === 'Zara Pod2'));
  assert.match(r2.caption, /POD 2 · Good morning[\s\S]*1 overdue/);
  await d('users').where({ id: zara }).del();
  await d('task_assignees').where({ task_id: tid }).del();
});
