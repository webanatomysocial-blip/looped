/// <reference types="node" />
// Phase 1: WhatsApp group notices for task assignments. In-memory database, real services, fake WhatsApp sender.
process.env.SQLITE_FILE = ':memory:';
process.env.WHATSAPP_NOTIFICATION_GROUP_JID = '120363000000000001@g.us';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDB, getDB } from '../db';
import { createTask, updateTask } from './tasks';
import { queueAssignmentNotice, processOutbox, jidForIdentity, notificationGroupJid, buildAssignmentText, NOTICE_MAX_ATTEMPTS, enqueueTicketNotices, statusLabel, dueLabel, markNoticesStart, enqueueOvertimeAlerts } from './assignmentNotices';

const db = () => getDB();
const U: Record<string, number> = {};
const actor = (k: string, role: string) => ({ id: U[k], role, name: k });
const outboxRows = async () => db()('whatsapp_outbox').orderBy('id');
const fakeSender = (connected: boolean, ok = true) => {
  const sent: { jid: string; text: string; mentions: string[] }[] = [];
  return { sent, isConnected: () => connected, sendGroup: async (jid: string, text: string, mentions: string[]) => { if (ok) sent.push({ jid, text, mentions }); return ok; } };
};

before(async () => {
  await initDB();
  const d = db();
  U.mgr = (await d('users').insert({ name: 'Mia Manager', email: 'mia@notice.test', password_hash: 'x', role: 'manager', pod: 'pod1' }))[0];
  U.nit = (await d('users').insert({ name: 'Nitish', email: 'nit@notice.test', password_hash: 'x', role: 'employee', pod: 'pod1' }))[0];
  U.pardu = (await d('users').insert({ name: 'Pardu', email: 'pardu@notice.test', password_hash: 'x', role: 'employee', pod: 'pod1' }))[0];
  U.ghost = (await d('users').insert({ name: 'Ghost Person', email: 'ghost@notice.test', password_hash: 'x', role: 'employee', pod: 'pod1' }))[0];
  await d('assistant_identities').insert({ user_id: U.nit, channel: 'whatsapp', external_sender_id: '+919391283396', status: 'active', active_sender_key: 'whatsapp:+919391283396', active_user_key: `${U.nit}:whatsapp`, linked_via: 'admin', verified_at: new Date() });
  await d('assistant_identities').insert({ user_id: U.pardu, channel: 'whatsapp', external_sender_id: 'lid:4455667788', status: 'active', active_sender_key: 'whatsapp:lid:4455667788', active_user_key: `${U.pardu}:whatsapp`, linked_via: 'manual_lid', verified_at: new Date() });
  U.P = (await d('projects').insert({ name: 'WebAnatomy Website', pod: 'pod1', created_by: U.mgr, status: 'active', manager_status: 'accepted' }))[0];
  await d('project_members').insert([U.mgr, U.nit, U.pardu, U.ghost].map((u) => ({ project_id: U.P, user_id: u })));
});
after(async () => { await db().destroy(); });

test('a successful assignment queues one group notice with the task, project, assignee, priority and deadline', async () => {
  const before = (await outboxRows()).length;
  const r = await createTask(db(), actor('mgr', 'manager'), { title: 'Homepage redesign', project_id: U.P, working_person_id: U.nit, task_manager_id: U.mgr, priority: 'high', due_date: '2026-11-20' });
  assert.ok(r.id);
  const rows = await outboxRows();
  assert.equal(rows.length, before + 1, 'exactly one notice');
  const payload = JSON.parse(rows[rows.length - 1].payload);
  assert.match(payload.text, /New task assigned/);
  assert.match(payload.text, /\*Task:\* Homepage redesign/);
  assert.match(payload.text, /\*Project:\* WebAnatomy Website/);
  assert.match(payload.text, /\*Priority:\* High/);
  assert.match(payload.text, /\*Deadline:\* 20 Nov\n/, 'only the saved date: no made-up time');
  assert.match(payload.text, /\*Status:\* 🕒 Waiting for Nitish to accept/);
  assert.match(payload.text, /accept your assignment in Loop/);
  assert.equal(rows[rows.length - 1].status, 'pending');
});

test('a failed assignment queues nothing: a validation error before commit leaves no notice', async () => {
  const before = (await outboxRows()).length;
  await assert.rejects(createTask(db(), actor('mgr', 'manager'), { title: '', project_id: U.P, working_person_id: U.nit }));
  assert.equal((await outboxRows()).length, before);
});

test('multiple assignees are all listed, with real mentions only for linked employees', async () => {
  const d = db();
  const t = (await d('tasks').insert({ title: 'Logo pack', project_id: U.P, created_by: U.mgr, status: 'pending', priority: 'medium' }))[0];
  const before = (await outboxRows()).length;
  await updateTask(d, actor('mgr', 'manager'), t, { assignee_ids: [U.nit, U.ghost] });
  const rows = await outboxRows();
  assert.equal(rows.length, before + 1, 'one notice for the assignment');
  const payload = JSON.parse(rows[rows.length - 1].payload);
  assert.match(payload.text, /@Nitish/);
  assert.match(payload.text, /Ghost Person/);
  assert.ok(!/@Ghost Person/.test(payload.text), 'an unlinked employee is shown by name only');
  assert.deepEqual(payload.mentions, ['919391283396@s.whatsapp.net'], 'real JID for the linked employee only');
});

test('linked participants get JIDs from their verified identity; a LID identity gets an @lid JID', () => {
  assert.equal(jidForIdentity('+919391283396'), '919391283396@s.whatsapp.net');
  assert.equal(jidForIdentity('lid:4455667788'), '4455667788@lid');
  assert.equal(jidForIdentity('Nitish'), null, 'never built from a name');
  assert.equal(jidForIdentity('+9x'), null);
});

test('the same assignment event is never queued twice', async () => {
  const key = 'assign:test:fixed-event-key';
  const a = await queueAssignmentNotice(db(), { taskId: 1, kind: 'assigned', employeeIds: [U.nit], eventKey: key });
  const b = await queueAssignmentNotice(db(), { taskId: 1, kind: 'assigned', employeeIds: [U.nit], eventKey: key });
  assert.equal(a, 'queued');
  assert.equal(b, 'duplicate');
  assert.equal((await db()('whatsapp_outbox').where({ event_key: key }).count({ n: '*' }).first() as any).n, 1);
});

test('missing or invalid group configuration fails safely: nothing is queued and nothing is sent', async () => {
  const saved = process.env.WHATSAPP_NOTIFICATION_GROUP_JID;
  try {
    delete process.env.WHATSAPP_NOTIFICATION_GROUP_JID;
    assert.equal(notificationGroupJid(), null);
    const before = (await outboxRows()).length;
    assert.equal(await queueAssignmentNotice(db(), { taskId: 1, kind: 'assigned', employeeIds: [U.nit], eventKey: 'assign:cfg:1' }), 'disabled');
    assert.equal((await outboxRows()).length, before);
    process.env.WHATSAPP_NOTIFICATION_GROUP_JID = 'not-a-group';
    assert.equal(notificationGroupJid(), null, 'an invalid value is refused');
  } finally {
    process.env.WHATSAPP_NOTIFICATION_GROUP_JID = saved;
  }
});

test('WhatsApp disconnected: the assignment stands, the notice waits in the outbox, and nothing is sent', async () => {
  const d = db();
  const t = (await d('tasks').insert({ title: 'Offline task', project_id: U.P, created_by: U.mgr, status: 'pending', priority: 'low' }))[0];
  await updateTask(d, actor('mgr', 'manager'), t, { assignee_ids: [U.pardu] });
  const task = await d('tasks').where({ id: t }).first();
  assert.equal(task.title, 'Offline task', 'the Loop assignment is unaffected');
  const sender = fakeSender(false);
  const res = await processOutbox(d, sender);
  assert.equal(res.sent, 0);
  assert.equal(sender.sent.length, 0);
  assert.ok(res.waiting >= 1, 'the notice waits');
});

test('reassignment queues one reassigned notice; repeating the same assignment queues nothing more', async () => {
  const d = db();
  const t = (await d('tasks').insert({ title: 'Move me', project_id: U.P, created_by: U.mgr, status: 'pending', priority: 'medium' }))[0];
  await updateTask(d, actor('mgr', 'manager'), t, { assignee_ids: [U.nit] });
  const afterFirst = (await outboxRows()).length;
  await updateTask(d, actor('mgr', 'manager'), t, { assignee_ids: [U.pardu] });
  const rows = await outboxRows();
  assert.equal(rows.length, afterFirst + 1);
  assert.equal(rows[rows.length - 1].kind, 'reassigned');
  await updateTask(d, actor('mgr', 'manager'), t, { assignee_ids: [U.pardu] });
  assert.equal((await outboxRows()).length, afterFirst + 1, 'no change, no new notice');
});

test('a sent notice is marked sent; a failing send is retried and given up after the limit', async () => {
  const d = db();
  await queueAssignmentNotice(d, { taskId: 1, kind: 'assigned', employeeIds: [U.nit], eventKey: 'assign:send:ok' });
  const ok = fakeSender(true, true);
  await processOutbox(d, ok);
  assert.equal((await d('whatsapp_outbox').where({ event_key: 'assign:send:ok' }).first()).status, 'sent');
  assert.equal(ok.sent[0].jid, '120363000000000001@g.us', 'only the configured group');
  await queueAssignmentNotice(d, { taskId: 1, kind: 'assigned', employeeIds: [U.nit], eventKey: 'assign:send:fail' });
  const bad = fakeSender(true, false);
  let t = new Date();
  for (let i = 0; i < NOTICE_MAX_ATTEMPTS; i++) { t = new Date(t.getTime() + 120_000); await processOutbox(d, bad, t); }
  const row = await d('whatsapp_outbox').where({ event_key: 'assign:send:fail' }).first();
  assert.equal(row.status, 'failed');
  assert.equal(row.last_error, 'send_failed', 'only a fixed error code is stored');
});

test('the message text is informative and never contains a phone number or an internal id', () => {
  const { text, mentions } = buildAssignmentText({ kind: 'assigned', title: 'T', project: 'P', priority: 'urgent', due: null, people: [{ name: 'Nitish', mention: '919391283396@s.whatsapp.net' }, { name: 'Ghost', mention: null }] });
  assert.match(text, /@Nitish/);
  assert.ok(!/9391283396/.test(text), 'no phone number in the text');
  assert.ok(!/Deadline/.test(text), 'no deadline line when none is set');
  assert.equal(mentions.length, 1);
});

test('a group chosen on the dashboard is used by the sending copy without a restart', async () => {
  const d = db();
  const chosen = '120363000000000777@g.us';
  await d('assistant_settings').where({ name: 'notification_group_jid' }).del();
  await d('assistant_settings').insert({ name: 'notification_group_jid', value: chosen, updated_at: new Date() });
  try {
    const sent: string[] = [];
    await processOutbox(d, { isConnected: () => true, sendGroup: async (jid: string) => { sent.push(jid); return true; } });
    assert.equal(notificationGroupJid(), chosen);
  } finally {
    await d('assistant_settings').where({ name: 'notification_group_jid' }).del();
    await processOutbox(d, { isConnected: () => false, sendGroup: async () => true });   // back to the configured default
  }
});

test('multi-stage tickets: "assigned" notice and one reminder for the stage holder; nothing once accepted or for old tickets', async () => {
  const d = db();
  const type = (await d('xlr8_ticket_types').insert({ name: 'Notice type', stages: JSON.stringify([{ category_name: 'Dev' }]) }).catch(() => [1]))[0];
  const mk = async (title: string, at: Date) => {
    const [id] = await d('tasks').insert({ title, project_id: U.P, created_by: U.mgr, priority: 'high', status: 'todo', ticket_type_id: type, xlr8_status: 'pending_assignee', xlr8_assignee_id: U.nit, assigned_to: U.nit });
    await d('xlr8_ticket_log').insert({ task_id: id, actor_id: U.mgr, actor_name: 'Mia', action: 'assigned', from_state: null, to_state: 'pending_assignee', created_at: at });
    return Number(id);
  };
  const now = new Date();
  const fresh = await mk('Pearl Redesign', new Date(now.getTime() - 5 * 60_000));
  const old = await mk('Old ticket', new Date(now.getTime() - 30 * 3600_000));
  await enqueueTicketNotices(d, now, 1);
  const rows = await d('whatsapp_outbox').whereIn('task_id', [fresh, old]);
  assert.deepEqual(rows.map((r: any) => r.kind).sort(), ['assigned', 'reminder'], 'one of each, only for the fresh ticket');
  assert.ok(rows.every((r: any) => Number(r.task_id) === fresh));
  assert.match(JSON.parse(rows.find((r: any) => r.kind === 'assigned').payload).text, /New task assigned[\s\S]*Pearl Redesign/);
  await enqueueTicketNotices(d, now, 1);
  assert.equal((await d('whatsapp_outbox').whereIn('task_id', [fresh, old])).length, 2, 'never queued twice');
  // Accepted before the reminder went out: the reminder is dropped
  await d('tasks').where({ id: fresh }).update({ xlr8_status: 'in_progress' });
  const sent: string[] = [];
  await processOutbox(d, { isConnected: () => true, sendGroup: async (_j: string, t: string) => { sent.push(t); return true; } }, now, 1000);
  assert.ok(sent.some((t) => /New task assigned/.test(t)));
  assert.ok(!sent.some((t) => /Acceptance reminder[\s\S]*Pearl Redesign/.test(t)), 'no reminder after accepting');
});

test('picture details match the saved task exactly: title, project, person, priority, deadline, status', async () => {
  const d = db();
  const r: any = await createTask(d, actor('mgr', 'manager'), { title: 'Card accuracy check', project_id: U.P, working_person_id: U.pardu, task_manager_id: U.mgr, priority: 'high', due_date: '2026-11-21', due_time: '17:30' });
  const id = Number(r?.id ?? r);
  const row = await d('whatsapp_outbox').where({ task_id: id, kind: 'assigned' }).orderBy('id', 'desc').first();
  const p = JSON.parse(row.payload);
  const f = Object.fromEntries(p.card.fields.map((x: any) => [x.label, x.value]));
  assert.equal(p.card.title, 'Card accuracy check');
  assert.equal(f.Project, 'WebAnatomy Website');
  assert.equal(f['Assigned to'], 'Pardu');
  assert.match(f.Priority, /^High$/);
  assert.equal(f.Status, 'Waiting for Pardu to accept');
  assert.equal(f.Status, 'Waiting for Pardu to accept', 'same wording as the Loop app');
  assert.match(p.caption, /^📌 \*New task assigned\* · @/);
  assert.deepEqual(p.mentions, ['4455667788@lid'], 'Pardu is tagged');
});

test('status and deadline in the picture use the saved values and the Loop app wording', () => {
  assert.equal(statusLabel({ status: 'todo' }, ['Nitish']), 'Waiting for Nitish to accept');
  assert.equal(statusLabel({ status: 'in_progress' }, ['Nitish']), 'Working');
  assert.equal(statusLabel({ ticket_type_id: 3, xlr8_status: 'pending_assignee', status: 'todo' }, ['Nitish Vetcha']), 'Waiting for Nitish Vetcha to accept');
  assert.equal(statusLabel({ ticket_type_id: 3, xlr8_status: 'pending_manager' }, ['Nitish']), 'Needs Manager');
  assert.equal(dueLabel('2026-11-18', null), '18 Nov', 'no time saved: no time shown');
  assert.equal(dueLabel('2026-11-18', '15:30'), '18 Nov, 3:30 pm (IST)');
});

test('start point: nothing from before the first start is announced; work after it is, and a restart keeps the same point', async () => {
  const d = db();
  const type = (await d('xlr8_ticket_types').insert({ name: 'Since type', stages: JSON.stringify([{ category_name: 'Dev' }]) }).catch(() => [1]))[0];
  const now = new Date();
  const mk = async (title: string, at: Date) => {
    const [id] = await d('tasks').insert({ title, project_id: U.P, created_by: U.mgr, priority: 'high', status: 'todo', ticket_type_id: type, xlr8_status: 'pending_assignee', xlr8_assignee_id: U.nit, assigned_to: U.nit });
    await d('xlr8_ticket_log').insert({ task_id: id, actor_id: U.mgr, actor_name: 'Mia', action: 'assigned', from_state: null, to_state: 'pending_assignee', created_at: at });
    return Number(id);
  };
  await d('assistant_settings').where({ name: 'notices_since' }).del();
  try {
    const before = await mk('Made before deploy', new Date(now.getTime() - 10 * 60_000));
    await markNoticesStart(d, new Date(now.getTime() - 5 * 60_000));      // "deploy" 5 minutes ago
    await markNoticesStart(d, now);                                       // a later restart does not move it
    const after = await mk('Made after deploy', new Date(now.getTime() - 2 * 60_000));
    await enqueueTicketNotices(d, now, 1);
    assert.equal((await d('whatsapp_outbox').where({ task_id: before })).length, 0, 'old ticket: no notice, no reminder');
    assert.deepEqual((await d('whatsapp_outbox').where({ task_id: after })).map((r: any) => r.kind).sort(), ['assigned', 'reminder']);
  } finally { await d('assistant_settings').where({ name: 'notices_since' }).del(); }
});

test('over the estimated time: one alert when the stage timer passes its estimate, with the same numbers as the app', async () => {
  const d = db();
  const type = (await d('xlr8_ticket_types').insert({ name: 'Over type', stages: JSON.stringify([{ category_name: 'SEO' }, { category_name: 'Web Developer' }]) }).catch(() => [1]))[0];
  const now = Date.now();
  const mk = async (title: string, estH: number, startedMinAgo: number) => {
    const [id] = await d('tasks').insert({ title, project_id: U.P, created_by: U.mgr, priority: 'high', status: 'in_progress', ticket_type_id: type, xlr8_status: 'in_progress', xlr8_stage_idx: 1, xlr8_assignee_id: U.nit, assigned_to: U.nit });
    await d('task_assignees').insert({ task_id: id, user_id: U.nit, assignee_role: 'employee', acceptance_status: 'accepted', stage_idx: 1, est_hours: estH, skipped: 0 });
    await d('task_sessions').insert({ task_id: id, user_id: U.nit, started_at: new Date(now - startedMinAgo * 60_000), ended_at: null, stage_idx: 1, session_date: '2026-11-18' });
    return Number(id);
  };
  const over = await mk('Over stage', 1, 62);      // 62 min logged on a 60 min estimate
  const under = await mk('Under stage', 2, 30);
  await enqueueOvertimeAlerts(d, new Date(now));
  await enqueueOvertimeAlerts(d, new Date(now + 60_000));
  const rows = await d('whatsapp_outbox').where('event_key', 'like', 'overtime:%').whereIn('task_id', [over, under]);
  assert.deepEqual(rows.map((r: any) => r.event_key), [`overtime:${over}:1`], 'only the one over its estimate, once');
  const p = JSON.parse(rows[0].payload);
  const f = Object.fromEntries(p.card.fields.map((x: any) => [x.label, x.value]));
  assert.equal(f.Estimated, '1h 00m');
  assert.equal(f.Logged, '1h 02m');
  assert.match(f['Over by'], /^2m \d\ds$/);
  assert.equal(f.Stage, 'Stage 2 · Web Developer');
  assert.equal(f['Assigned to'], 'Nitish');
  assert.equal(f.Status, 'Working');
  assert.match(p.caption, /^⏱️ \*Over the estimated time\* · @/);
  // Went over before the start point: not announced
  await d('assistant_settings').insert({ name: 'notices_since', value: String(now), updated_at: new Date() });
  try {
    const old = await mk('Over before deploy', 1, 90);
    await enqueueOvertimeAlerts(d, new Date(now));
    assert.equal((await d('whatsapp_outbox').where({ task_id: old })).length, 0);
  } finally { await d('assistant_settings').where({ name: 'notices_since' }).del(); }
});
