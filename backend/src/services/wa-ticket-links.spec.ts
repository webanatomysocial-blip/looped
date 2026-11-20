/// <reference types="node" />
// WhatsApp ticket notices: the task's share link on the card, everyone still to accept named in the status, and
// private cross-pod approval requests/reminders to the managers who still have to approve. Nothing is sent: rows are
// only queued in the outbox and checked.
process.env.SQLITE_FILE = ':memory:';
process.env.WHATSAPP_NOTIFICATION_GROUP_JID = '120363000000000001@g.us';
process.env.FRONTEND_URL = 'https://loooped.in';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDB, getDB } from '../db';
import { buildAssignmentText, shareLink, enqueueTicketNotices, enqueueCrossPodApprovals, crossPodStep, processOutbox } from './assignmentNotices';

const U: Record<string, number> = {};
const db = () => getDB();
const rows = (kind: string) => db()('whatsapp_outbox').where({ kind }).orderBy('id');
before(async () => {
  await initDB(); const d = db();
  const user = async (name: string, role: string, pod: string, lid?: string) => {
    const [id] = await d('users').insert({ name, email: `${name}@wa.test`, password_hash: 'x', role, pod });
    if (lid) await d('assistant_identities').insert({ user_id: id, channel: 'whatsapp', external_sender_id: `lid:${lid}`, status: 'active', active_sender_key: `whatsapp:lid:${lid}`, active_user_key: `${id}:whatsapp`, linked_via: 'manual_lid', verified_at: new Date() });
    return id;
  };
  U.abhi = await user('Abhilash', 'employee', 'pod1', '1111111111');
  U.nitish = await user('Nitish', 'employee', 'pod1', '2222222222');
  U.udaya = await user('Udaya', 'manager', 'pod1', '3333333333');
  U.mgr2 = await user('Pod2Manager', 'manager', 'pod2', '4444444444');
  U.P = (await d('projects').insert({ name: 'Fullscan', pod: 'pod1', created_by: U.udaya, status: 'active', manager_status: 'accepted' }))[0];
  U.T = (await d('xlr8_ticket_types').insert({ name: 'Audit', stages: JSON.stringify([{ category_name: 'Dev' }, { category_name: 'QA' }, { type: 'manager' }]) }))[0];
});
after(() => db().destroy());

test('the card and each private copy carry the task share link; the same link every time', async () => {
  const [id] = await db()('tasks').insert({ title: 'Share me', project_id: U.P, created_by: U.udaya, status: 'todo' });
  const a = await shareLink(db(), id); const b = await shareLink(db(), id);
  assert.match(a!, /^https:\/\/loooped\.in\/share\/task\/[0-9a-f]{64}$/); assert.equal(a, b, 'made once, reused');
  const built = buildAssignmentText({ kind: 'assigned', title: 'T', project: 'P', priority: null, due: null, people: [], ticket: true, link: a });
  assert.ok(built.caption.includes(a!) && built.text.includes(a!));
});

test('a new ticket names everyone still to accept, managers on a review stage included, and shows its creator and link', async () => {
  const [id] = await db()('tasks').insert({ title: 'Fullscan Audit issues resolving', project_id: U.P, created_by: U.udaya, status: 'todo', priority: 'medium', ticket_type_id: U.T, xlr8_status: 'pending_assignee', xlr8_stage_idx: 0, xlr8_assignee_id: U.abhi, assigned_to: U.abhi });
  await db()('task_assignees').insert([
    { task_id: id, user_id: U.abhi, assignee_role: 'employee', acceptance_status: 'pending', stage_idx: 0, skipped: 0 },
    { task_id: id, user_id: U.nitish, assignee_role: 'employee', acceptance_status: 'pending', stage_idx: 1, skipped: 0 },
    { task_id: id, user_id: U.udaya, assignee_role: 'manager', acceptance_status: 'pending', stage_idx: 2, skipped: 0 },
  ]);
  await db()('xlr8_ticket_log').insert({ task_id: id, action: 'assigned', to_state: 'pending_assignee', actor_name: 'System', created_at: new Date() });
  await enqueueTicketNotices(db(), new Date());
  const card = (await db()('whatsapp_outbox').where({ task_id: id, kind: 'assigned' }).whereNot('event_key', 'like', 'dm:%').first());
  const p = JSON.parse(card.payload);
  const status = p.card.fields.find((f: any) => f.label === 'Status').value;
  for (const n of ['Abhilash', 'Nitish', 'Udaya']) assert.ok(status.includes(n), `status names ${n}: ${status}`);
  assert.equal(p.card.fields.find((f: any) => f.label === 'Created by').value, 'Udaya');
  assert.match(p.caption, /🔗 https:\/\/loooped\.in\/share\/task\//);
  // Once someone accepts, the next card would no longer name them (the rule reads Loop's rows)
  await db()('task_assignees').where({ task_id: id, user_id: U.nitish }).update({ acceptance_status: 'accepted' });
});

test('cross-pod approval: the waiting pod\'s manager is messaged privately, reminded, and nothing more once approved', async () => {
  const t0 = new Date();
  const [id] = await db()('tasks').insert({ title: 'Cross work', project_id: U.P, created_by: U.abhi, status: 'pending_approval', crosspod_pods: JSON.stringify(['pod2']), crosspod_reasons: JSON.stringify([{ pod: 'pod2', text: 'Abhilash assigned your pod member to Fullscan' }]), created_at: t0 });
  assert.equal(await enqueueCrossPodApprovals(db(), new Date(t0.getTime() + 60_000)), 1, 'the request, at once');
  assert.equal(await enqueueCrossPodApprovals(db(), new Date(t0.getTime() + 120_000)), 0, 'not twice');
  assert.equal(await enqueueCrossPodApprovals(db(), new Date(t0.getTime() + 31 * 60_000)), 1, 'reminder at 30 minutes');
  const sent = await rows('approval');
  assert.equal(sent.length, 2);
  const first = JSON.parse(sent[0].payload);
  assert.equal(first.to, '3333333333@lid'.replace('3333333333', '4444444444'), 'privately, to the pod 2 manager only');
  assert.match(first.text, /waiting for your approval/); assert.match(first.text, /assigned your pod member/);
  assert.match(first.caption, /🔗 https:\/\/loooped\.in\/share\/task\//);
  // Approved: pending reminders are dropped instead of sent
  await db()('tasks').where({ id }).update({ status: 'todo', crosspod_pods: null });
  await db()('whatsapp_outbox').where({ kind: 'approval' }).update({ status: 'pending', next_attempt_at: new Date(0) });
  const sentTo: string[] = [];
  await processOutbox(db(), { isConnected: () => true, sendGroup: async (to: string) => { sentTo.push(to); return true; } } as any, new Date(t0.getTime() + 32 * 60_000));
  assert.ok(!sentTo.includes('4444444444@lid'), 'nothing sent to the manager after approval');
  assert.equal((await rows('approval')).every((r: any) => r.status === 'cancelled'), true);
});

test('reminder timing: at once, 30 min, 2 h, then daily for 3 days; a step missed by over an hour is skipped', () => {
  const m = (x: number) => x * 60_000;
  assert.equal(crossPodStep(0, m(5)), 0); assert.equal(crossPodStep(0, m(45)), 1); assert.equal(crossPodStep(0, m(130)), 2);
  assert.equal(crossPodStep(0, m(200)), null, 'between steps: nothing');
  assert.equal(crossPodStep(0, m(1450)), 3); assert.equal(crossPodStep(0, m(4330)), 5);
  assert.equal(crossPodStep(0, m(6000)), null, 'after 3 days: no more');
});

// ── "Your turn" when a ticket reaches the next person ──
import { enqueueTurnMessages } from './assignmentNotices';
test('the next person is told privately: their turn, a review, or changes with the reason; not for a stage still to be accepted', async () => {
  const d = db();
  const mk = async (title: string, status: string, holder: number) => (await d('tasks').insert({ title, project_id: U.P, created_by: U.udaya, status: 'in_progress', ticket_type_id: U.T, xlr8_status: status, xlr8_stage_idx: 1, xlr8_assignee_id: holder, assigned_to: holder }))[0];
  const log = (task: number, action: string, to: string, comment: string) => d('xlr8_ticket_log').insert({ task_id: task, action, to_state: to, comment, actor_name: 'X', created_at: new Date() });
  const work = await mk('Turn work', 'in_progress', U.nitish); await log(work, 'next_stage', 'in_progress', 'Stage 2: QA');
  const review = await mk('Turn review', 'pending_manager', U.udaya); await log(review, 'next_stage', 'pending_manager', 'Stage 3: Manager Review');
  const back = await mk('Turn back', 'in_progress', U.abhi); await log(back, 'manager_declined', 'in_progress', 'Fix the header spacing');
  const waiting = await mk('Turn waits', 'pending_assignee', U.nitish); await log(waiting, 'next_stage', 'pending_assignee', 'Stage 2: QA');
  assert.equal(await enqueueTurnMessages(d, new Date()), 3);
  assert.equal(await enqueueTurnMessages(d, new Date()), 0, 'once per hand-over');
  const byTask = async (id: number) => JSON.parse((await d('whatsapp_outbox').where({ kind: 'turn', task_id: id }).first()).payload);
  const w = await byTask(work); assert.match(w.text, /it's your turn on this ticket/i); assert.equal(w.to, '2222222222@lid'); assert.match(w.text, /Your stage:\*? QA/);
  assert.match(w.caption, /🔗 https:\/\/loooped\.in\/share\/task\//);
  assert.match((await byTask(review)).text, /ready for your review/);
  const b = await byTask(back); assert.match(b.text, /come back to you for changes/); assert.match(b.text, /Fix the header spacing/); assert.equal(b.to, '1111111111@lid');
  assert.equal(await d('whatsapp_outbox').where({ kind: 'turn', task_id: waiting }).first(), undefined, 'acceptance messages cover that one');
  // Moved on before sending: dropped
  await d('tasks').where({ id: work }).update({ xlr8_status: 'pending_manager', xlr8_assignee_id: U.udaya });
  await d('whatsapp_outbox').where({ kind: 'turn' }).update({ status: 'pending', next_attempt_at: new Date(0) });
  const sentTo: string[] = [];
  await processOutbox(d, { isConnected: () => true, sendGroup: async (to: string) => { sentTo.push(to); return true; } } as any, new Date(), 100);
  assert.equal((await d('whatsapp_outbox').where({ kind: 'turn', task_id: work }).first()).status, 'cancelled');
  assert.ok(sentTo.includes('1111111111@lid') && sentTo.includes('3333333333@lid'));
});

// ── Follow-up when a manager hasn't accepted; project as the card heading ──
import { buildEscalationText, enqueueAcceptanceReminders } from './assignmentNotices';
test('the card heading is the project; the ticket name moves into the rows', () => {
  const b = buildEscalationText({ title: 'website speed issue and Zapier subscription', project: 'Fullscan', minutes: 12, ticket: true, people: [{ name: 'Udaya', mention: null }], managers: [] });
  assert.equal(b.card.title, 'Fullscan');
  assert.deepEqual(b.card.fields![0], { label: 'Title', value: 'website speed issue and Zapier subscription' });
  assert.ok(!b.card.fields!.some((f: any) => f.label === 'Project'));
});

test('a manager who has not accepted is never asked to follow up on themselves: the admins of their pod are', async () => {
  const d = db();
  const [podAdmin] = await d('users').insert({ name: 'Pod1Admin', email: 'pa@wa.test', password_hash: 'x', role: 'admin', pod: 'pod1' });
  await d('assistant_identities').insert({ user_id: podAdmin, channel: 'whatsapp', external_sender_id: 'lid:5555555555', status: 'active', active_sender_key: 'whatsapp:lid:5555555555', active_user_key: `${podAdmin}:whatsapp`, linked_via: 'manual_lid', verified_at: new Date() });
  const [other] = await d('users').insert({ name: 'OtherAdmin', email: 'oa@wa.test', password_hash: 'x', role: 'admin', pod: 'pod2' });
  void other;
  const t0 = new Date(Date.now() - 13 * 60_000);
  const [id] = await d('tasks').insert({ title: 'Manager must accept', project_id: U.P, created_by: U.abhi, status: 'todo', created_at: t0 });
  await d('task_assignees').insert({ task_id: id, user_id: U.udaya, assignee_role: 'manager', acceptance_status: 'pending', assigned_at: t0 });
  await enqueueAcceptanceReminders(d, new Date());
  const esc = await d('whatsapp_outbox').where({ kind: 'escalation', task_id: id }).first();
  assert.ok(esc, 'escalated at 12 minutes');
  const p = JSON.parse(esc.payload);
  assert.match(p.caption, /Please follow up:\* @/);
  assert.ok(!/follow up:\*[^\n]*Udaya/.test(p.caption), 'Udaya is not asked to follow up on herself');
  assert.ok(p.mentions.includes('5555555555@lid'), 'the pod admin is tagged');
  assert.ok(!p.text.includes('OtherAdmin'), 'not the other pod\'s admin');
});
