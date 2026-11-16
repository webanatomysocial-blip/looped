/// <reference types="node" />
// WhatsApp message presentation. In-memory database, an AI that must not be called, nothing is sent.
process.env.SQLITE_FILE = ':memory:';
process.env.WHATSAPP_NOTIFICATION_GROUP_JID = '120363412745413406@g.us';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDB, getDB } from '../db';
import { compose, clean, bold, capped, msg, QUICK_REPLIES, QUICK_REPLY_LINE } from './waMessage';
import { buildAssignmentText, buildReminderText, buildDeadlineText, processOutbox } from './assignmentNotices';
import { buildMorningReport, buildEveningReport } from './productivityReports';
import { answerProductivityQuestion, HELP_TEXT } from './productivityAssistant';
import { GROUP_REPLY } from '../assistant/engine';

const db = () => getDB();
const U: Record<string, number> = {};
const ist = (s: string) => new Date(`${s}+05:30`);
const NOW = ist('2026-11-18T15:00:00');
const noAI = { complete: async () => { throw new Error('the model must not be called for a quick reply'); } } as any;
const echoAI = (json: object) => ({ complete: async () => ({ text: JSON.stringify(json) }) }) as any;

// Every message must look like a message: no JSON, no internal ids, no stacked blank lines, no stray markup
function looksClean(text: string) {
  assert.ok(!/\n\s*\n\s*\n/.test(text), `no stacked blank lines:\n${text}`);
  assert.ok(!/[{}[\]]|"\w+":|undefined|null|NaN|\[object/.test(text), `no raw data:\n${text}`);
  assert.ok(!/\b\d{9,}\b|@s\.whatsapp\.net|@lid|@g\.us/.test(text), `no ids or phone numbers:\n${text}`);
  assert.ok(text === text.trim(), 'no leading or trailing blank space');
  for (const line of text.split('\n')) assert.equal((line.match(/\*/g) ?? []).length % 2, 0, `balanced bold on: ${line}`);
}

before(async () => {
  await initDB();
  const d = db();
  const user = async (k: string, name: string, role: string, pod: string | null) => { U[k] = (await d('users').insert({ name, email: `${k}@wm.test`, password_hash: 'x', role, pod }))[0]; };
  await user('mgr', 'Mia Manager', 'manager', 'pod1');
  await user('nit', 'Nitish', 'employee', 'pod1');
  await user('long', 'Venkata Subrahmanya Lakshmi Narasimha Chakravarthy *Star* _Dev_', 'employee', 'pod1');
  await user('olga', 'Olga', 'employee', 'pod2');
  const P1 = (await d('projects').insert({ name: 'Pod One <Site> & "Co"', pod: 'pod1', created_by: U.mgr, status: 'active', manager_status: 'accepted' }))[0];
  const P2 = (await d('projects').insert({ name: 'Pod Two Private', pod: 'pod2', created_by: U.mgr, status: 'active', manager_status: 'accepted' }))[0];
  await d('project_members').insert([U.mgr, U.nit, U.long].map((u) => ({ project_id: P1, user_id: u })));
  const task = async (title: string, project: number, who: number, f: Record<string, unknown> = {}) => {
    const [id] = await d('tasks').insert({ title, project_id: project, created_by: U.mgr, status: 'pending', priority: 'medium', ...f });
    await d('task_assignees').insert({ task_id: id, user_id: who, assignee_role: 'employee', acceptance_status: 'accepted', assigned_at: ist('2026-11-16T10:00:00') });
  };
  // Twelve open tasks for one person, with every status mixed in
  for (let i = 1; i <= 12; i++) await task(`Banner *v${i}*\nsecond line`, P1, U.nit, { due_date: i <= 3 ? '2026-11-17' : '2026-11-30', due_time: '17:00' });
  await task('Shipped', P1, U.nit, { status: 'completed', completed_at: ist('2026-11-18T11:00:00') });
  await task('Secret pod2 task', P2, U.olga);
  await d('task_sessions').insert({ task_id: 1, user_id: U.nit, started_at: ist('2026-11-18T10:00:00'), ended_at: ist('2026-11-18T11:30:00'), session_date: '2026-11-18' });
});
after(async () => { await db().destroy(); });

// ── Building blocks ──

test('helpers: one blank line between blocks, empty blocks dropped, long lists capped', () => {
  assert.equal(compose('A', '', null, ['B', '', 'C'], false, 'D'), 'A\n\nB\nC\n\nD');
  assert.deepEqual(capped(['1', '2', '3', '4', '5', '6', '7']), ['1', '2', '3', '4', '5', '…and 2 more']);
  assert.equal(clean('a\nb\t\u0007c   d'), 'a b c d');
  assert.equal(clean('x'.repeat(200)).length, 80);
  assert.equal(bold('Star *power*'), '*Star power*', 'asterisks inside bold are removed so the bold is not broken');
});

// ── Every category ──

test('assignment notice: heading first, labelled fields, status, mention, one call to action', () => {
  const { text, mentions } = buildAssignmentText({ kind: 'assigned', title: 'Logo *pack*\nv2', project: 'Brand', priority: 'high', due: '20 Nov, 5:00 pm', people: [{ name: 'Nitish', mention: '919000000001@s.whatsapp.net' }, { name: 'Ravi', mention: null }] });
  assert.match(text, /^📌 \*New task assigned\*\n\n/);
  assert.match(text, /\*Task:\* Logo pack v2/);
  assert.match(text, /\*Assigned to:\* @Nitish, Ravi/);
  assert.match(text, /\*Priority:\* High/);
  assert.match(text, /\*Deadline:\* 20 Nov, 5:00 pm \(IST\)/);
  assert.match(text, /\*Status:\* 🕒 Awaiting acceptance/);
  assert.deepEqual(mentions, ['919000000001@s.whatsapp.net']);
  assert.match(buildAssignmentText({ kind: 'reassigned', title: 'T', project: 'P', priority: null, due: null, people: [] }).text, /^🔄 \*Task reassigned\*[\s\S]*\*Assigned to:\* —/);
});

test('reminder and deadline alert use the same layout', () => {
  const r = buildReminderText({ title: 'Logo', project: 'Brand', person: { name: 'Nitish', mention: null } });
  assert.match(r.text, /^⏰ \*Acceptance reminder\*\n\nNitish, please review/);
  assert.match(r.text, /_The task can't start until you accept it._$/);
  const d = buildDeadlineText({ title: 'Logo', project: 'Brand', dueLabel: '20 Nov, 5:00 pm', minutesLeft: 1, people: [{ name: 'Nitish', mention: null }] });
  assert.match(d.text, /^⏳ \*Deadline approaching\*\n\n\*about 1 minute\* left/);
  assert.match(buildDeadlineText({ title: 'L', project: 'B', dueLabel: 'x', minutesLeft: 180, people: [] }).text, /about 3 hours/);
  for (const t of [r.text, d.text]) looksClean(t);
});

test('reports: bold heading, as-of line, capped task lists, italic footnote', async () => {
  const morning = await buildMorningReport(db(), ist('2026-11-18T09:00:00'));
  assert.match(morning, /^☀️ \*Good morning! Pending work from Tue, 17 Nov\*\n_As of 9:00 am IST · \d+ employees_/);
  assert.match(morning, /\*Nitish\* — 10 pending, 3 overdue/);
  assert.match(morning, /…and 5 more/, 'ten pending items are capped at five');
  const evening = await buildEveningReport(db(), ist('2026-11-18T18:00:00'));
  assert.match(evening, /^🌇 \*Day-end report — Wed, 18 Nov\*/);
  assert.match(evening, /\*Nitish\* — tracked 1h 30m/);
  assert.match(evening, /_Hours come from Loop time tracking/);
  for (const t of [morning, evening]) looksClean(t);
});

test('special characters and long names are cleaned without breaking bold', async () => {
  const text = await buildEveningReport(db(), ist('2026-11-18T18:00:00'));
  assert.match(text, /\*Venkata Subrahmanya Lakshmi Narasimha C…\*/, 'long name cut to a readable length');
  assert.match(text, /Banner v1 second line/, 'line breaks flattened, asterisks that would toggle bold removed');
  looksClean(text);
});

test('help, group reply and standard short replies', () => {
  assert.match(HELP_TEXT, /^💡 \*What I can tell you\*/);
  assert.match(QUICK_REPLY_LINE, /_Quick replies \(mention me\): pending · workload · summary · completed · hours_$/);
  assert.doesNotMatch(QUICK_REPLY_LINE, /help/);
  assert.match(GROUP_REPLY, /^👋 \*Loop assistant\*\n\n/);
  assert.match(msg.error(), /^⚠️ \*Something went wrong\*/);
  assert.match(msg.managersOnly(), /^🔒 \*Not available\*/);
  assert.match(msg.ambiguous('Ravi', ['Ravi Kumar', 'Ravi Shah']), /^❓ \*Which Ravi\?\*\n\n• Ravi Kumar\n• Ravi Shah\n\n_Reply with the full name._$/);
  for (const t of [HELP_TEXT, GROUP_REPLY, msg.error(), msg.managersOnly(), msg.notFound('X'), msg.empty('A', 'B')]) looksClean(t);
});

// ── Answers: content, empty results, interaction ──

test('every answer type is cleanly formatted', async () => {
  const intents = ['working_on', 'hours', 'pending_overdue', 'workload', 'completed', 'highest_workload', 'no_hours', 'summary'];
  for (const intent of intents) {
    const text = await answerProductivityQuestion(db(), echoAI({ intent, employee: intent === 'working_on' ? 'Nitish' : null, period: 'today' }), { userId: U.mgr, role: 'manager', text: 'q', now: NOW });
    assert.match(text, /^\S+ \*[^*]+\*|^⏱️ /, `${intent} starts with a heading:\n${text}`);
    looksClean(text);
  }
});

test('empty results get a short headed message, not a blank list', async () => {
  const text = await answerProductivityQuestion(db(), echoAI({ intent: 'completed', employee: null, period: 'yesterday' }), { userId: U.mgr, role: 'manager', text: 'q', now: NOW });
  assert.equal(text, 'ℹ️ *Completed yesterday*\n\nNo tasks completed yesterday.');
});

test('quick replies: a single word answers without the model, inside the same scope', async () => {
  assert.deepEqual(Object.keys(QUICK_REPLIES).sort(), ['completed', 'hours', 'no hours', 'overdue', 'pending', 'summary', 'top', 'workload']);
  const pending = await answerProductivityQuestion(db(), noAI, { userId: U.mgr, role: 'manager', text: '@1234 pending', now: NOW });
  assert.match(pending, /^📋 \*Pending and overdue tasks\*/);
  assert.ok(!/Secret pod2 task|Olga/.test(pending), 'scope is unchanged for quick replies');
  assert.match(await answerProductivityQuestion(db(), noAI, { userId: U.mgr, role: 'manager', text: 'Summary!', now: NOW }), /^📈 \*Team summary today\*/);
  // A quick reply never bypasses the role check
  assert.equal(await answerProductivityQuestion(db(), noAI, { userId: U.nit, role: 'employee', text: 'summary', now: NOW }), msg.managersOnly());
  // Anything that is not a quick reply still goes to the model
  assert.equal(await answerProductivityQuestion(db(), noAI, { userId: U.mgr, role: 'manager', text: 'pending tasks for the logo please', now: NOW }), msg.error());
});

test('unsupported clients: everything is plain text with mentions; no buttons, lists or templates are sent', async () => {
  const sent: { jid: string; text: string; mentions: string[] }[] = [];
  const sender = { isConnected: () => true, sendGroup: async (jid: string, text: string, mentions: string[]) => { sent.push({ jid, text, mentions }); return true; } };
  await db()('whatsapp_outbox').insert({ event_key: 'wm:1', kind: 'assigned', task_id: 1, payload: JSON.stringify(buildAssignmentText({ kind: 'assigned', title: 'T', project: 'P', priority: null, due: null, people: [] })), status: 'pending', attempts: 0, next_attempt_at: NOW, created_at: NOW });
  await processOutbox(db(), sender, NOW, 1000);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].jid, '120363412745413406@g.us');
  assert.equal(typeof sent[0].text, 'string');
  assert.ok(!/buttons|listMessage|templateMessage|nativeFlow/i.test(JSON.stringify(sent)));
});
