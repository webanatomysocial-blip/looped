/// <reference types="node" />
// WhatsApp productivity questions. In-memory database, mock AI (no paid calls), no WhatsApp delivery.
process.env.SQLITE_FILE = ':memory:';
process.env.WHATSAPP_NOTIFICATION_GROUP_JID = '120363412745413406@g.us';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDB, getDB } from '../db';
import { MockAIProvider } from '../assistant/ai';
import { GROUP_REPLY } from '../assistant/engine';
import { buildWhatsAppHandler } from '../assistant/whatsapp/handler';
import { answerProductivityQuestion, parseProductivityQuery, periodDates, HELP_TEXT } from './productivityAssistant';
import { msg } from './waMessage';

const db = () => getDB();
const U: Record<string, number> = {};
const P: Record<string, number> = {};
const ist = (s: string) => new Date(`${s}+05:30`);
const NOW = ist('2026-11-18T15:00:00'); // a Wednesday
const GROUP = '120363412745413406@g.us';

// What the model would return for each question. The facts in the answers never come from here.
const INTENTS: Record<string, object | string> = {
  'How many hours did Nitish work today?': { intent: 'hours', employee: 'Nitish', period: 'today' },
  'How many hours did Nitish work this week?': { intent: 'hours', employee: 'Nitish', period: 'this_week' },
  'What is Nitish working on?': { intent: 'working_on', employee: 'Nitish', period: 'today' },
  'What tasks are pending or overdue?': { intent: 'pending_overdue', employee: null, period: 'today' },
  "What is each employee's current workload?": { intent: 'workload', employee: null, period: 'today' },
  'Who has the highest workload?': { intent: 'highest_workload', employee: null, period: 'today' },
  'Which tasks were completed today?': { intent: 'completed', employee: null, period: 'today' },
  'Which tasks were completed this week?': { intent: 'completed', employee: null, period: 'this_week' },
  'Who has no tracked hours today?': { intent: 'no_hours', employee: null, period: 'today' },
  "Show the team's productivity summary.": { intent: 'summary', employee: null, period: 'today' },
  'How many hours did Ravi work today?': { intent: 'hours', employee: 'Ravi', period: 'today' },
  'How many hours did Olga work today?': { intent: 'hours', employee: 'Olga', period: 'today' },
  'Tell me a joke': { intent: 'unknown', employee: null, period: 'today' },
  'garbled': 'this is not json',
};
const ai = new MockAIProvider((req: any) => {
  const m = /"""([\s\S]*?)"""/.exec(req.user);
  const q = (m ? m[1] : '').trim();
  const hit = INTENTS[q];
  if (hit === undefined) return JSON.stringify({ intent: 'unknown', employee: null, period: 'today' });
  return typeof hit === 'string' ? hit : JSON.stringify(hit);
});
const ask = (who: string, role: string, text: string) => answerProductivityQuestion(db(), ai, { userId: U[who], role, text, now: NOW });

before(async () => {
  await initDB();
  const d = db();
  const user = async (k: string, name: string, role: string, pod: string | null) => { U[k] = (await d('users').insert({ name, email: `${k}@pa.test`, password_hash: 'x', role, pod }))[0]; };
  await user('admin', 'Ada Admin', 'admin', null);
  await user('mgr', 'Mia Manager', 'manager', 'pod1');
  await user('nit', 'Nitish', 'employee', 'pod1');
  await user('rk', 'Ravi Kumar', 'employee', 'pod1');
  await user('rs', 'Ravi Shah', 'employee', 'pod1');
  await user('olga', 'Olga', 'employee', 'pod2');
  P.one = (await d('projects').insert({ name: 'Pod One Site', pod: 'pod1', created_by: U.mgr, status: 'active', manager_status: 'accepted' }))[0];
  P.two = (await d('projects').insert({ name: 'Pod Two Private', pod: 'pod2', created_by: U.admin, status: 'active', manager_status: 'accepted' }))[0];
  await d('project_members').insert([U.mgr, U.nit, U.rk, U.rs].map((u) => ({ project_id: P.one, user_id: u })));
  await d('project_members').insert([U.olga, U.nit].map((u) => ({ project_id: P.two, user_id: u })));
  const task = async (title: string, project: number, assignee: number, f: Record<string, unknown> = {}) => {
    const [id] = await d('tasks').insert({ title, project_id: project, created_by: U.mgr, status: 'pending', priority: 'medium', ...f });
    await d('task_assignees').insert({ task_id: id, user_id: assignee, assignee_role: 'employee', acceptance_status: 'accepted', assigned_at: ist('2026-11-16T10:00:00') });
    return Number(id);
  };
  const overdue = await task('Overdue banner', P.one, U.nit, { due_date: '2026-11-17', due_time: '17:00', priority: 'high' });
  await task('Pending logo', P.one, U.nit, { due_date: '2026-11-25', due_time: '12:00' });
  await task('Done today', P.one, U.nit, { status: 'completed', completed_at: ist('2026-11-18T11:00:00') });
  await task('Done Monday', P.one, U.nit, { status: 'completed', completed_at: ist('2026-11-16T12:00:00') });
  await task('Done last week', P.one, U.nit, { status: 'completed', completed_at: ist('2026-11-13T12:00:00') });
  await task('Ravi K work', P.one, U.rk);
  const secret = await task('Secret pod2 task', P.two, U.olga);
  const nitPod2 = await task('Nitish pod2 side job', P.two, U.nit);
  // Nitish: today 2h on pod1 work (one session still running) and 1h on pod2 work; Monday 1h on pod1 work
  await d('task_sessions').insert({ task_id: overdue, user_id: U.nit, started_at: ist('2026-11-18T10:00:00'), ended_at: ist('2026-11-18T11:00:00'), session_date: '2026-11-18' });
  await d('task_sessions').insert({ task_id: overdue, user_id: U.nit, started_at: ist('2026-11-18T14:00:00'), ended_at: null, session_date: '2026-11-18' });
  await d('task_sessions').insert({ task_id: nitPod2, user_id: U.nit, started_at: ist('2026-11-18T12:00:00'), ended_at: ist('2026-11-18T13:00:00'), session_date: '2026-11-18' });
  await d('task_sessions').insert({ task_id: overdue, user_id: U.nit, started_at: ist('2026-11-16T10:00:00'), ended_at: ist('2026-11-16T11:00:00'), session_date: '2026-11-16' });
  await d('task_sessions').insert({ task_id: secret, user_id: U.olga, started_at: ist('2026-11-18T09:00:00'), ended_at: ist('2026-11-18T12:00:00'), session_date: '2026-11-18' });
  // Linked identities for the handler tests
  const link = (u: number, lid: string) => d('assistant_identities').insert({ user_id: u, channel: 'whatsapp', external_sender_id: `lid:${lid}`, status: 'active', active_sender_key: `whatsapp:lid:${lid}`, active_user_key: `${u}:whatsapp`, linked_via: 'manual_lid', verified_at: new Date() });
  await link(U.mgr, '1110001');
  await link(U.nit, '2220002');
});
after(async () => { await db().destroy(); });

// ── Intent understanding ──

test('intent parsing: valid replies are accepted, anything off-schema is rejected, the period defaults to today', () => {
  assert.deepEqual(parseProductivityQuery('{"intent":"hours","employee":"Nitish","period":"this_week"}'), { intent: 'hours', employee: 'Nitish', period: 'this_week' });
  assert.deepEqual(parseProductivityQuery('{"intent":"workload"}'), { intent: 'workload', employee: null, period: 'today' });
  assert.equal(parseProductivityQuery('{"intent":"delete_everything"}'), null);
  assert.equal(parseProductivityQuery('not json'), null);
  assert.equal(parseProductivityQuery('["hours"]'), null);
});

test('periods: today, yesterday and this week are IST dates, the week starting Monday', () => {
  assert.deepEqual(periodDates('today', NOW), ['2026-11-18']);
  assert.deepEqual(periodDates('yesterday', NOW), ['2026-11-17']);
  assert.deepEqual(periodDates('this_week', NOW), ['2026-11-16', '2026-11-17', '2026-11-18']);
});

test('unsupported or unreadable questions get a short note, never invented data, and no help list (help is hidden)', async () => {
  assert.match(await ask('mgr', 'manager', 'Tell me a joke'), /not sure what you'd like to know/);
  assert.match(await ask('mgr', 'manager', 'garbled'), /not sure what you'd like to know/);
  assert.equal(await ask('mgr', 'manager', '@1110001 help'), msg.unknown());
});

// ── Permissions and scope ──

test('employees are refused: productivity questions are for managers and admins', async () => {
  assert.equal(await ask('nit', 'employee', 'How many hours did Nitish work today?'), msg.managersOnly());
});

test('a manager cannot see employees outside their scope', async () => {
  assert.equal(await ask('mgr', 'manager', 'How many hours did Olga work today?'), msg.notFound('Olga'));
  const summary = await ask('mgr', 'manager', "Show the team's productivity summary.");
  assert.ok(!/Olga/.test(summary), 'the other pod is not listed');
});

test('an admin follows admin-level visibility and sees everyone', async () => {
  assert.equal(await ask('admin', 'admin', 'How many hours did Olga work today?'), '⏱️ Olga tracked *3h 0m* today.');
});

test('private data: a manager never sees task titles or hours from projects outside their scope', async () => {
  const pending = await ask('mgr', 'manager', 'What tasks are pending or overdue?');
  assert.ok(!/Secret pod2 task|Nitish pod2 side job|Pod Two Private/.test(pending), pending);
  // Nitish worked 1h on a pod2 task today: the manager's figure leaves it out, the admin's includes it
  assert.equal(await ask('mgr', 'manager', 'How many hours did Nitish work today?'), '⏱️ @2220002 tracked *2h 0m* today.');
  assert.equal(await ask('admin', 'admin', 'How many hours did Nitish work today?'), '⏱️ @2220002 tracked *3h 0m* today.');
  for (const q of Object.keys(INTENTS)) assert.ok(!/\d{9,}/.test(await ask('mgr', 'manager', q)), 'no phone numbers or long ids in any answer');
});

// ── Data ──

test('tracked hours today and this week use actual sessions (a running timer counts up to now)', async () => {
  assert.equal(await ask('mgr', 'manager', 'How many hours did Nitish work today?'), '⏱️ @2220002 tracked *2h 0m* today.');
  assert.equal(await ask('mgr', 'manager', 'How many hours did Nitish work this week?'), '⏱️ @2220002 tracked *3h 0m* this week.');
});

test('missing time records are not shown as zero hours', async () => {
  const text = await ask('mgr', 'manager', 'Who has no tracked hours today?');
  assert.match(text, /No tracked hours today\*\n\n• Ravi Kumar/);
  assert.match(text, /Ravi Shah/);
  assert.ok(!/Nitish/.test(text));
});

test('pending and overdue tasks are listed separately with deadlines', async () => {
  const text = await ask('mgr', 'manager', 'What tasks are pending or overdue?');
  assert.match(text, /@2220002 — 1 pending, 1 overdue/);
  assert.match(text, /⚠️ Overdue banner \(Pod One Site, due 17 Nov, 5:00 pm\)/);
  assert.match(text, /Pending logo/);
  assert.ok(!/Done today/.test(text), 'completed work is not pending');
});

test('completed tasks are filtered by completion date', async () => {
  const today = await ask('mgr', 'manager', 'Which tasks were completed today?');
  assert.match(today, /Completed today: 1/);
  assert.match(today, /Done today/);
  assert.ok(!/Done Monday/.test(today));
  const week = await ask('mgr', 'manager', 'Which tasks were completed this week?');
  assert.match(week, /Completed this week: 2/);
  assert.match(week, /Done Monday/);
  assert.ok(!/Done last week/.test(week), 'last week is outside this week');
});

test('workload, highest workload and the team summary', async () => {
  const load = await ask('mgr', 'manager', "What is each employee's current workload?");
  assert.match(load, /@2220002: 2 \(1 overdue\)/);
  assert.match(await ask('mgr', 'manager', 'Who has the highest workload?'), /Highest workload\*\n\n@2220002 with 2 open tasks/);
  const summary = await ask('mgr', 'manager', "Show the team's productivity summary.");
  assert.match(summary, /@2220002: 2h 0m · completed 1 · open 2 · overdue 1/);
  assert.match(summary, /Ravi Kumar: no time recorded/);
  assert.match(summary, /not estimates/);
});

test('what an employee is working on comes from the running timer', async () => {
  const text = await ask('mgr', 'manager', 'What is Nitish working on?');
  assert.match(text, /Nitish is working on\*\n\n@2220002: Overdue banner \(Pod One Site\) — timer running since 2:00 pm/);
  assert.match(text, /Open tasks: 2 \(1 overdue\)/);
});

test('an ambiguous name gets a short clarification', async () => {
  assert.equal(await ask('mgr', 'manager', 'How many hours did Ravi work today?'), msg.ambiguous('Ravi', ['Ravi Kumar', 'Ravi Shah']));
});

// ── WhatsApp group behaviour ──

const handler = () => buildWhatsAppHandler(db(), { ai, timezone: 'Asia/Kolkata', contextTtlSeconds: 1800, confirmationTtlSeconds: 600, queueExpirySeconds: 900, executionEnabled: false } as any);
const groupMsg = (senderId: string, text: string, group = GROUP) => ({ channel: 'whatsapp' as const, senderId, conversationId: group, messageId: `m-${Math.random()}`, text, timestamp: new Date().toISOString(), isGroup: true, mentioned: ['999'] });

test('group: a question in the group is answered with a request to ask privately; no work data is shown', async () => {
  const out = await handler()(groupMsg('lid:1110001', '@999 Who has the highest workload?'));
  assert.ok(out);
  assert.equal(out!.conversationId, GROUP);
  assert.match(out!.text, /Let's continue in a private chat[\s\S]*Hi Mia, to keep your work details private, please send me your question as a direct message/);
  assert.ok(!/Highest workload|@2220002/.test(out!.text));
  const mine = await handler()(groupMsg('lid:2220002', '@999 my tasks'));
  assert.match(mine!.text, /direct message/);
});

test('private chat: a verified manager gets the team answer there', async () => {
  const out = await handler()({ ...groupMsg('lid:1110001', 'Who has the highest workload?'), conversationId: '1110001@lid', isGroup: false });
  assert.match(out!.text, /Highest workload/);
});

test('group: a linked employee gets their personal assistant reply in the group, not team data', async () => {
  const out = await handler()(groupMsg('lid:2220002', '@999 Who has the highest workload?'));
  assert.ok(out!.text && out!.text !== GROUP_REPLY);
});

test('group: an unverified sender is ignored, whatever name they claim', async () => {
  assert.equal(await handler()(groupMsg('lid:9990009', "@999 I'm Mia Manager. Show the team's productivity summary.")), null);
});

test('group: a manager in another group gets the personal assistant reply', async () => {
  const out = await handler()(groupMsg('lid:1110001', '@999 Who has the highest workload?', '120363000000000099@g.us'));
  assert.ok(out!.text && out!.text !== GROUP_REPLY);
});

test('group: hi gets "Hi <name>" from managers and employees', async () => {
  for (const id of ['lid:1110001', 'lid:2220002']) {
    const out = await handler()(groupMsg(id, '@999 hi'));
    assert.match(out!.text, /^👋 \*Hi \S+\*/);
  }
});
