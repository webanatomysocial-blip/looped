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
// Group rows only; each linked person also gets a private copy ("dm:" rows), checked in their own test
const outboxRows = async () => db()('whatsapp_outbox').whereNot('event_key', 'like', 'dm:%').orderBy('id');
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
  assert.match(payload.text, /Please review the task and accept it in Loop/);
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
  await processOutbox(d, ok, new Date(), 1000);
  assert.equal((await d('whatsapp_outbox').where({ event_key: 'assign:send:ok' }).first()).status, 'sent');
  assert.ok(ok.sent.every((m) => m.jid === '120363000000000001@g.us' || /@(s\.whatsapp\.net|lid)$/.test(m.jid)), 'the configured group or a linked person only');
  await queueAssignmentNotice(d, { taskId: 1, kind: 'assigned', employeeIds: [U.nit], eventKey: 'assign:send:fail' });
  const bad = fakeSender(true, false);
  let t = new Date();
  for (let i = 0; i < NOTICE_MAX_ATTEMPTS; i++) { t = new Date(t.getTime() + 120_000); await processOutbox(d, bad, t, 1000); }
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
    await d('task_assignees').insert({ task_id: id, user_id: U.nit, assignee_role: 'employee', acceptance_status: 'pending', stage_idx: 0, est_hours: 1, skipped: 0 });
    return Number(id);
  };
  const now = new Date();
  const fresh = await mk('Pearl Redesign', new Date(now.getTime() - 5 * 60_000));
  const old = await mk('Old ticket', new Date(now.getTime() - 30 * 3600_000));
  await enqueueTicketNotices(d, now, 1);
  const rows = await d('whatsapp_outbox').whereIn('task_id', [fresh, old]);
  assert.deepEqual(rows.map((r: any) => r.event_key.split(':').slice(0, 2).join(':')).sort(), ['dm:tassign', 'tassign:' + fresh, 'tremind2:' + fresh], 'group card, private copy, and (at 5 min with a 1-min threshold) the second private reminder');
  assert.ok(rows.every((r: any) => Number(r.task_id) === fresh));
  const group = JSON.parse(rows.find((r: any) => r.event_key.startsWith('tassign:')).payload);
  assert.match(group.text, /New ticket created[\s\S]*Pearl Redesign/);
  assert.ok(!group.to, 'the ticket card goes to the group');
  assert.equal(JSON.parse(rows.find((r: any) => r.kind === 'reminder').payload).to, '919391283396@s.whatsapp.net', 'reminders are private');
  await enqueueTicketNotices(d, now, 1);
  assert.equal((await d('whatsapp_outbox').whereIn('task_id', [fresh, old])).length, 3, 'never queued twice');
  // Accepted before the reminder went out: the reminder is dropped
  await d('task_assignees').where({ task_id: fresh, user_id: U.nit }).update({ acceptance_status: 'accepted' });
  const sent: string[] = [];
  await processOutbox(d, { isConnected: () => true, sendGroup: async (_j: string, t: string) => { sent.push(t); return true; } }, now, 1000);
  assert.ok(sent.some((t) => /New ticket created/.test(t)));
  assert.ok(!sent.some((t) => /Reminder: acceptance pending/.test(t)), 'no reminder after accepting');
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
  assert.equal(f['Assigned to'], 'Pardu, Mia Manager', 'the task manager is listed too');
  assert.match(f.Priority, /^High$/);
  assert.equal(f.Status, 'Waiting for Pardu to accept');
  assert.equal(f.Status, 'Waiting for Pardu to accept', 'same wording as the Loop app');
  assert.match(p.caption, /^📌 \*New task assigned\*\n\n👥 @/);
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
    await d('task_assignees').insert({ task_id: id, user_id: U.nit, assignee_role: 'employee', acceptance_status: 'pending', stage_idx: 0, est_hours: 1, skipped: 0 });
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
    assert.deepEqual((await d('whatsapp_outbox').where({ task_id: after })).map((r: any) => r.kind).sort(), ['assigned', 'assigned', 'reminder']);
  } finally { await d('assistant_settings').whereIn('name', ['notices_since', 'followups_since']).del(); }
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
  assert.deepEqual(rows.map((r: any) => r.event_key.split(':').slice(0, 3).join(':')), [`overtime:${over}:1`], 'only the one over its estimate, once');
  assert.equal(JSON.parse(rows[0].payload).to, '919391283396@s.whatsapp.net', 'sent privately to the person on the stage');
  const p = JSON.parse(rows[0].payload);
  const f = Object.fromEntries(p.card.fields.map((x: any) => [x.label, x.value]));
  assert.equal(f.Estimated, '1h 00m');
  assert.equal(f.Logged, '1h 02m');
  assert.match(f['Over by'], /^2m \d\ds$/);
  assert.equal(f.Stage, 'Stage 2 · Web Developer');
  assert.equal(f['Assigned to'], 'Nitish');
  assert.equal(f.Status, 'Working');
  assert.match(p.caption, /^⏱️ \*Over the estimated time\*\n\n👉 /);
  // Went over before the start point: not announced
  await d('assistant_settings').insert({ name: 'notices_since', value: String(now), updated_at: new Date() });
  try {
    const old = await mk('Over before deploy', 1, 90);
    await enqueueOvertimeAlerts(d, new Date(now));
    assert.equal((await d('whatsapp_outbox').where({ task_id: old })).length, 0);
  } finally { await d('assistant_settings').whereIn('name', ['notices_since', 'followups_since']).del(); }
});

test('each linked assignee also gets a private copy of the assignment, addressed to them', async () => {
  const d = db();
  const r: any = await createTask(d, actor('mgr', 'manager'), { title: 'Private copy', project_id: U.P, working_person_id: U.nit, task_manager_id: U.mgr, priority: 'high', due_date: '2026-11-21', due_time: '17:30' });
  const rows = await d('whatsapp_outbox').where({ task_id: Number(r?.id ?? r) }).where('event_key', 'like', 'dm:%');
  assert.equal(rows.length, 1);
  const p = JSON.parse(rows[0].payload);
  assert.equal(p.to, '919391283396@s.whatsapp.net');
  assert.match(p.text, /You have a new task[\s\S]*Hi Nitish, please review the task and accept it in Loop/);
  const f = Object.fromEntries(p.card.fields.map((x: any) => [x.label, x.value]));
  assert.equal(f.Deadline, '21 Nov, 5:30 pm (IST)');
  assert.equal(f.Priority, 'High');
  assert.deepEqual(p.mentions, []);
  assert.ok(!/9391283396/.test(p.text + p.caption));
});

test('dashboard samples: every message type from real data; group ones to the group, private ones only to the requester, tagged like the real ones', async () => {
  const { queueSamples } = await import('./assignmentNotices');
  const d = db();
  const out = await queueSamples(d, U.nit, new Date());
  assert.ok(out.group >= 3 && out.private === 4);
  const rows = (await d('whatsapp_outbox').where({ kind: 'sample' })).map((r: any) => JSON.parse(r.payload));
  assert.ok(rows.every((p: any) => /^🧪 _Sample preview_\n\n/.test(p.caption)));
  const card = rows.find((p: any) => !p.to && /New task assigned|New ticket created/.test(p.caption));
  assert.ok(card.mentions.length > 0 && /@/.test(card.caption), 'linked people are really tagged, as in the live message');
  assert.ok(rows.filter((p: any) => p.to).every((p: any) => p.to === '919391283396@s.whatsapp.net'));
  assert.ok(rows.some((p: any) => /POD 1 · Good morning/.test(p.caption)) && rows.some((p: any) => /Acceptance overdue/.test(p.caption)) && rows.some((p: any) => /Second reminder/.test(p.text)));
});

test('multi-stage tickets: everyone still pending on the stage is reminded together, and all are named in one escalation', async () => {
  const d = db();
  const type = (await d('xlr8_ticket_types').insert({ name: 'Team type', stages: JSON.stringify([{ category_name: 'Dev' }, { category_name: 'QA' }]) }).catch(() => [1]))[0];
  const at = new Date(Date.now() - 6 * 60_000);
  const [id] = await d('tasks').insert({ title: 'Team ticket', project_id: U.P, created_by: U.mgr, priority: 'high', status: 'todo', ticket_type_id: type, xlr8_status: 'pending_assignee', xlr8_stage_idx: 0, xlr8_assignee_id: U.nit, assigned_to: U.nit });
  await d('xlr8_ticket_log').insert({ task_id: id, actor_id: U.mgr, actor_name: 'Mia', action: 'assigned', from_state: null, to_state: 'pending_assignee', created_at: at });
  // Stage 1: Nitish and Pardu; stage 2: Ghost. All pending.
  for (const [u, st] of [[U.nit, 0], [U.pardu, 0], [U.ghost, 1]]) await d('task_assignees').insert({ task_id: id, user_id: u, assignee_role: 'employee', acceptance_status: 'pending', stage_idx: st, est_hours: 1, skipped: 0 });
  await enqueueTicketNotices(d, new Date(at.getTime() + 6 * 60_000), 5);   // 6 min: first reminder
  const r1 = (await d('whatsapp_outbox').where({ task_id: id, kind: 'reminder' })).map((r: any) => JSON.parse(r.payload).to).sort();
  assert.deepEqual(r1, ['4455667788@lid', '919391283396@s.whatsapp.net'], 'both linked people at the same time (Ghost has no WhatsApp linked)');
  await d('task_assignees').where({ task_id: id, user_id: U.pardu }).update({ acceptance_status: 'accepted' });
  await enqueueTicketNotices(d, new Date(at.getTime() + 13 * 60_000), 5);   // 13 min: escalation
  const esc = JSON.parse((await d('whatsapp_outbox').where({ task_id: id, kind: 'escalation' }).first()).payload);
  assert.deepEqual(esc.people.map((p: any) => p.name).sort(), ['Ghost Person', 'Nitish'], 'everyone still pending, on any later stage too; Pardu accepted');
});

test('deploy over the earlier version: events it already sent are not sent again in any new form', async () => {
  const { earlierKeys } = await import('./assignmentNotices');
  assert.deepEqual(earlierKeys('overdue:9:1700:919391283396').exact, ['overdue:9', 'overdue:9:1700']);
  assert.deepEqual(earlierKeys('overdue:9:1700:group').exact, ['overdue:9', 'overdue:9:1700']);
  assert.deepEqual(earlierKeys('overtime:10:1:9193').exact, ['overtime:10', 'overtime:10:1']);
  assert.deepEqual(earlierKeys('dm:tassign:5:1700:7').like, ['tassign:5:%:1700']);
  assert.deepEqual(earlierKeys('tremind:5:1700:7').exact, ['tremind:5:7:1700']);
  // A ticket the earlier version announced and reminded: the new version adds nothing for it
  const d = db();
  const type = (await d('xlr8_ticket_types').insert({ name: 'Deploy type', stages: JSON.stringify([{ category_name: 'Dev' }]) }).catch(() => [1]))[0];
  const at = new Date(Date.now() - 6 * 60_000);
  const [id] = await d('tasks').insert({ title: 'Already announced', project_id: U.P, created_by: U.mgr, priority: 'high', status: 'todo', ticket_type_id: type, xlr8_status: 'pending_assignee', xlr8_stage_idx: 0, xlr8_assignee_id: U.nit, assigned_to: U.nit });
  await d('xlr8_ticket_log').insert({ task_id: id, actor_id: U.mgr, actor_name: 'Mia', action: 'assigned', from_state: null, to_state: 'pending_assignee', created_at: at });
  await d('task_assignees').insert({ task_id: id, user_id: U.nit, assignee_role: 'employee', acceptance_status: 'pending', stage_idx: 0, est_hours: 1, skipped: 0 });
  const since = new Date(at).getTime();
  for (const k of [`tassign:${id}:${U.nit}:${since}`, `tremind:${id}:${U.nit}:${since}`]) await d('whatsapp_outbox').insert({ event_key: k, kind: 'assigned', task_id: id, payload: '{}', status: 'sent', attempts: 1, next_attempt_at: new Date() });
  await enqueueTicketNotices(d, new Date(), 5);
  assert.equal((await d('whatsapp_outbox').where({ task_id: id })).length, 2, 'no new card, private copy or reminder');
});

test('deploy: the new follow-ups (second reminder, escalation) only for assignments after this version first started', async () => {
  const { enqueueAcceptanceReminders } = await import('./assignmentNotices');
  const d = db();
  const now = Date.now();
  const r: any = await createTask(d, actor('mgr', 'manager'), { title: 'Assigned before deploy', project_id: U.P, working_person_id: U.nit, task_manager_id: U.mgr, priority: 'medium' });
  const id = Number(r?.id ?? r);
  await d('task_assignees').where({ task_id: id }).update({ assigned_at: new Date(now - 15 * 60_000) });
  await d('assistant_settings').whereIn('name', ['notices_since', 'followups_since']).del();
  await d('assistant_settings').insert({ name: 'notices_since', value: String(now - 3600_000), updated_at: new Date() });
  try {
    await markNoticesStart(d, new Date(now - 60_000));    // this version first started a minute ago
    await enqueueAcceptanceReminders(d, new Date(now), 5);
    assert.equal((await d('whatsapp_outbox').where({ task_id: id }).whereIn('kind', ['reminder', 'escalation'])).length, 0, 'no escalation burst at deploy');
    assert.equal(Number((await d('assistant_settings').where({ name: 'notices_since' }).first()).value), now - 3600_000, 'the original start point is not moved');
  } finally { await d('assistant_settings').whereIn('name', ['notices_since', 'followups_since']).del(); }
});

test('the assignment card names who created it', () => {
  const b = buildAssignmentText({ kind: 'assigned', title: 'T', project: 'P', priority: null, due: null, people: [], ticket: true, createdBy: 'Asha' });
  assert.match(b.text, /\*Created by:\* Asha/);
  assert.ok(JSON.stringify(b.card).includes('Asha'));
});
