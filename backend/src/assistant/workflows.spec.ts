/// <reference types="node" />
// Phase 5 step 5: complete employee workflows through the real intake (duplicate check, identity, engine), the
// confirmation, the executor and the database. Isolated in-memory database only.
process.env.SQLITE_FILE = ':memory:';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initDB, getDB } from '../db';
import { MockAIProvider } from './ai';
import { RequestEngine, GROUP_REPLY, SELF_QUESTION } from './engine';
import { SUSPENDED_TASK_INTENTS, ticketRegistry, stillVerified } from './actions';
import { runNext, RunOutcome } from './executor';
import { processMessage } from './pipeline';
import { DbRequestStore, DbAuditLog } from './conversationStore';
import { DbIdentityResolver, SimulatorIdentityResolver, ChannelIdentityResolver } from './identityStore';
import { recoverInterrupted, expireDue } from './queue';
import { searchTickets, viewTicket, listMyTasks } from '../services/ticketReads';
import { getTask, listTasks } from '../services/tasks';
import { createOp } from './ticketMutations';

const db = () => getDB();
const U: Record<string, any> = {};
const base = { confidence: 0.95, ambiguous: [], is_correction: false, cancel: false, answers_pending: false };
const t = (intent: string, fields: Record<string, string>, answers_pending = false) => ({ ...base, intent, fields, answers_pending });
const table: Record<string, any> = {
  'create a ticket called Clarify me': t('CREATE_TASK', { title: 'Clarify me' }),
  'create a ticket called Mine': t('CREATE_TASK', { title: 'Mine' }),
  'create a ticket called Listed': t('CREATE_TASK', { title: 'Listed' }),
  'create a ticket called Scoped': t('CREATE_TASK', { title: 'Scoped' }),
  'create a ticket called Iso1': t('CREATE_TASK', { title: 'Iso1' }),
  'create a ticket called Iso2': t('CREATE_TASK', { title: 'Iso2' }),
  'Sam': t('CREATE_TASK', { employee: 'Sam' }, true),
  'Website redesign': t('CREATE_TASK', { project: 'Website redesign' }, true),
  'none': t('CREATE_TASK', { deadline: 'none' }, true),
  'create a ticket called Hero for Sam in Website redesign, no deadline': t('CREATE_TASK', { title: 'Hero', employee: 'Sam', project: 'Website redesign', deadline: 'none' }),
  'create a ticket called Pod move for Ola in Website redesign, no deadline': t('CREATE_TASK', { title: 'Pod move', employee: 'Ola', project: 'Website redesign', deadline: 'none' }),
  'create a ticket called Client try for Sam in Website redesign, no deadline': t('CREATE_TASK', { title: 'Client try', employee: 'Sam', project: 'Website redesign', deadline: 'none' }),
  'create a ticket called Cancel me for Sam in Website redesign, no deadline': t('CREATE_TASK', { title: 'Cancel me', employee: 'Sam', project: 'Website redesign', deadline: 'none' }),
  'create a ticket called Expire me for Sam in Website redesign, no deadline': t('CREATE_TASK', { title: 'Expire me', employee: 'Sam', project: 'Website redesign', deadline: 'none' }),
  'create a ticket called Pending for Sam in Website redesign, no deadline': t('CREATE_TASK', { title: 'Pending', employee: 'Sam', project: 'Website redesign', deadline: 'none' }),
  'create a ticket called Audit me for Sam in Website redesign, no deadline': t('CREATE_TASK', { title: 'Audit me', employee: 'Sam', project: 'Website redesign', deadline: 'none' }),
  'create a ticket called Notify me for Sam in Website redesign, no deadline': t('CREATE_TASK', { title: 'Notify me', employee: 'Sam', project: 'Website redesign', deadline: 'none' }),
  'assign the Pod move ticket to Ola': t('ASSIGN_TASK', { task_ref: 'Pod move', employee: 'Ola' }),
  'approve the Pod move ticket': t('APPROVE_TASK', { task_ref: 'Pod move' }),
  'assign the Hero ticket to Ola': t('ASSIGN_TASK', { task_ref: 'Hero', employee: 'Ola' }),
  'assign the Hero ticket to Hal': t('ASSIGN_TASK', { task_ref: 'Hero', employee: 'Hal' }),
  'assign the Notify me ticket to Lee': t('ASSIGN_TASK', { task_ref: 'Notify me', employee: 'Lee' }),
  'assign the Cancel me ticket to Lee': t('ASSIGN_TASK', { task_ref: 'Cancel me', employee: 'Lee' }),
  'search for Hero': t('SEARCH_TICKETS', { query: 'Hero' }),
  'show details of Hero': t('VIEW_TASK_DETAILS', { task_ref: 'Hero' }),
  'show details of Secret': t('VIEW_TASK_DETAILS', { task_ref: 'Secret' }),
  'show details of Nothing like this': t('VIEW_TASK_DETAILS', { task_ref: 'Nothing like this' }),
  'make the Hero ticket urgent': t('UPDATE_TASK', { task_ref: 'Hero', priority: 'urgent' }),
  'add a comment on the Hero ticket saying looks good': t('ADD_COMMENT', { task_ref: 'Hero', comment: 'looks good' }),
  'accept the Hero ticket': t('ACCEPT_TASK', { task_ref: 'Hero' }),
  'assign the XLR8 ticket to Lee': t('ASSIGN_TASK', { task_ref: 'Stage ticket', employee: 'Lee' }),
  'assign the Hero ticket to Lee': t('ASSIGN_TASK', { task_ref: 'Hero', employee: 'Lee' }),
};
// Rule-based understanding for the phrasings the workflows use, so each message needs no single entry
const rules: [RegExp, (m: RegExpExecArray) => any][] = [
  [/^create a ticket called (.+?) for (\w+) in Website redesign, no deadline$/, (m) => t('CREATE_TASK', { title: m[1], employee: m[2], project: 'Website redesign', deadline: 'none' })],
  [/^assign the (.+?) ticket to (\w+)$/, (m) => t('ASSIGN_TASK', { task_ref: m[1], employee: m[2] })],
  [/^approve the (.+?) ticket$/, (m) => t('APPROVE_TASK', { task_ref: m[1] })],
  [/^reject the (.+?) ticket because (.+)$/, (m) => t('REJECT_TASK', { task_ref: m[1], comment: m[2] })],
  [/^make the (.+?) ticket urgent$/, (m) => t('UPDATE_TASK', { task_ref: m[1], priority: 'urgent' })],
];
(table as any)['show my tasks'] = { ...base, intent: 'VIEW_MY_TASKS', confidence: 0.95 };
const ai = new MockAIProvider((req: any) => {
  const m = /"""([\s\S]*?)"""/.exec(req.user);
  const text = (m ? m[1] : '').trim();
  if (table[text]) return JSON.stringify(table[text]);
  for (const [re, make] of rules) { const hit = re.exec(text); if (hit) return JSON.stringify(make(hit)); }
  return JSON.stringify({ ...base, intent: 'UNKNOWN', confidence: 0 });
});

const engine = () => new RequestEngine({
  db: db(), ai, timezone: 'Asia/Kolkata', contextTtlSeconds: 1800, confirmationTtlSeconds: 600,
  exposedIntents: SUSPENDED_TASK_INTENTS, executionEnabled: true,
  reader: { search: (actor, text) => searchTickets(db(), actor as any, text) as any, view: (actor, id) => viewTicket(db(), actor as any, id) as any, mine: (actor) => listMyTasks(db(), actor as any) as any },
});
const deps = (enabled = true) => ({ db: db(), registry: ticketRegistry(db()), workerId: 'w1', maxAttempts: 3, leaseSeconds: 60, stillVerified: (id: number) => stillVerified(db(), id), enabled });
let seq = 0;
// Simulator senders are server-set "loop-user:<id>"; WhatsApp senders are phone numbers mapped to an identity.
const WHATSAPP = { mgr1: '+919000000001' };
const senderOf = (channel: string, key: string) => channel === 'whatsapp' ? (WHATSAPP as any)[key.replace('sim-', '')] : `loop-user:${U[key.replace('sim-', '')].id}`;
// The real intake: duplicate check, identity from the sender, then the engine
const intake = (text: string, key: string, channel = 'simulator', messageId?: string) => processMessage({
  channel: channel as any, senderId: senderOf(channel, key), conversationId: `chat-${key}`, messageId: messageId ?? `msg-${++seq}-${Math.random()}`, text, timestamp: new Date().toISOString(),
}, { identity: new ChannelIdentityResolver({ simulator: new SimulatorIdentityResolver(db()), whatsapp: new DbIdentityResolver(db()) }), classifier: undefined as any, store: new DbRequestStore(db()), audit: new DbAuditLog(db()), engine: engine() as any });
const replyOf = async (text: string, sender: string, channel = 'simulator') => {
  const out: any = await intake(text, sender, channel);
  return out.response ? out.response : out;
};
const confirmCode = (reply: string) => /CONFIRM (\w+)/.exec(reply)![1];
async function ask(text: string, sender: string) {
  const r: any = await intake(text, sender);
  const reply = r.response?.text ?? r.response?.reply ?? JSON.stringify(r);
  return { r, reply };
}
const countOf = async (q: any) => Number((await q.count('* as n').first() as any).n);
const ticketCount = (title: string) => countOf(db()('tasks').where({ title }));
const ticketRow = (title: string) => db()('tasks').where({ title }).first();
const requests = () => countOf(db()('assistant_requests'));
const stateOf = async (id: string) => (await db()('assistant_requests').where({ id }).first('status')).status;

before(async () => {
  await initDB();
  const d = db();
  const people: [string, string, string, string | null, number | null][] = [
    ['mgr1', 'Mia', 'manager', 'pod1', null], ['emp1', 'Sam', 'employee', 'pod1', null], ['emp2', 'Lee', 'employee', 'pod1', null],
    ['mgr2', 'Hal', 'manager', 'pod2', null], ['emp3', 'Ola', 'employee', 'pod2', null], ['admin', 'Ada', 'admin', null, null],
    ['client', 'Cora', 'client', null, null], ['outsider', 'Ned', 'employee', 'pod2', null], ['revoked', 'Rex', 'employee', 'pod1', null],
  ];
  for (const [k, name, role, pod] of people) {
    const [id] = await d('users').insert({ name, email: `${k}@wf.test`, password_hash: 'x', role, pod, client_company_id: role === 'client' ? 1 : null });
    U[k] = { id, role, name, sender: `sim-${k}` };
    if (k !== 'outsider') await d('assistant_identities').insert({ user_id: id, channel: 'simulator', external_sender_id: `sim-${k}`, status: k === 'revoked' ? 'revoked' : 'active', active_sender_key: k === 'revoked' ? null : `simulator:sim-${k}`, active_user_key: k === 'revoked' ? null : `u${id}`, linked_via: 'admin', verified_at: new Date() });
  }
  await d('client_companies').insert({ id: 1, name: 'Acme' }).catch(() => {});
  await d('assistant_identities').insert({ user_id: U.mgr1.id, channel: 'whatsapp', external_sender_id: WHATSAPP.mgr1, status: 'active', active_sender_key: `whatsapp:${WHATSAPP.mgr1}`, active_user_key: `w${U.mgr1.id}`, linked_via: 'admin', verified_at: new Date() });
  U.P = (await d('projects').insert({ name: 'Website redesign', pod: 'pod1', created_by: U.mgr1.id, status: 'active', manager_status: 'accepted', client_company_id: 1 }))[0];
  await d('project_members').insert([U.mgr1.id, U.emp1.id, U.emp2.id, U.client.id].map((u) => ({ project_id: U.P, user_id: u })));
  await d('project_members').insert([U.mgr2.id, U.emp3.id, U.revoked.id].map((u) => ({ project_id: U.P, user_id: u })));
});
after(async () => { await db().destroy(); });

// Each test starts with no open drafts left by an earlier test. Only assistant request rows are changed; nothing is deleted.
beforeEach(async () => {
  await db()('assistant_requests').whereIn('status', ['NEEDS_CLARIFICATION', 'READY_FOR_CONFIRMATION']).update({ status: 'CANCELLED', updated_at: new Date() });
});

// ── 1. Complete employee workflows ──

test('1.1 create: a complete request ends as one ticket with its assignee and audit row', async () => {
  const { reply } = await ask('create a ticket called Hero for Sam in Website redesign, no deadline', 'sim-mgr1');
  assert.match(reply, /Please confirm/);
  assert.ok(((await intake(`CONFIRM ${confirmCode(reply)}`, 'sim-mgr1')) as any).response.text.length > 0);
  assert.equal((await runNext(deps())).outcome, 'completed');
  const row = await ticketRow('Hero');
  assert.equal(row.assigned_to, U.emp1.id);
  assert.equal(await countOf(db()('assistant_ticket_audit').where({ task_id: row.id, operation: 'create' })), 1);
  // The website's own view of the ticket
  assert.equal((await getTask(db(), { id: U.mgr1.id, role: 'manager', name: 'Mia' } as any, row.id)).title, 'Hero');
});

test('1.2 create with missing details: self question, assignee, project, then confirm and run (no deadline question)', async () => {
  const q1 = (await ask('create a ticket called Clarify me', 'sim-mgr1')).reply;
  assert.equal(q1, SELF_QUESTION, 'asks whether to assign it to the current employee first');
  const q2 = (await ask('2', 'sim-mgr1')).reply;
  assert.equal(q2, 'Who should this task be assigned to?', 'No: asks who it is for');
  const q3 = (await ask('Sam', 'sim-mgr1')).reply;
  assert.match(q3, /^Which project should this task belong to\?/, 'then the authorised project list');
  assert.match(q3, /1\. Website redesign/);
  const ready = (await ask('1', 'sim-mgr1')).reply;
  assert.match(ready, /Please confirm/, 'straight to the summary');
  assert.ok(!/deadline/i.test(ready), 'the deadline is never asked');
  await intake(`CONFIRM ${confirmCode(ready)}`, 'sim-mgr1');
  assert.equal((await runNext(deps())).outcome, 'completed');
  assert.equal(await ticketCount('Clarify me'), 1);
  assert.equal((await ticketRow('Clarify me')).assigned_to, U.emp1.id);
});

test('1.2b "Yes" assigns the linked employee by user id, then the project list is offered', async () => {
  const q1 = (await ask('create a ticket called Mine', 'sim-mgr1')).reply;
  assert.equal(q1, SELF_QUESTION);
  const q2 = (await ask('1', 'sim-mgr1')).reply;
  assert.match(q2, /^Which project should this task belong to\?/);
  const ready = (await ask('Website redesign', 'sim-mgr1')).reply;
  assert.match(ready, /Please confirm/);
  await intake(`CONFIRM ${confirmCode(ready)}`, 'sim-mgr1');
  assert.equal((await runNext(deps())).outcome, 'completed');
  assert.equal((await ticketRow('Mine')).assigned_to, U.mgr1.id, 'the linked user id, not a name lookup');
});

test('2.8 projects: a number picks from the saved list; "Show the projects here" keeps the draft; an unknown name lists the choices', async () => {
  await ask('create a ticket called Listed', 'sim-mgr1');
  await ask('2', 'sim-mgr1');
  const list = (await ask('Sam', 'sim-mgr1')).reply;
  assert.match(list, /1\. Website redesign/);
  const shown = (await ask('Show the projects here', 'sim-mgr1')).reply;
  assert.match(shown, /1\. Website redesign/);
  assert.match(shown, /Which project should this task belong to\?/);
  assert.equal(await countOf(db()('assistant_requests').where({ status: 'NEEDS_CLARIFICATION' })), 1, 'the draft is kept');
  const bad = (await ask('Nowhere', 'sim-mgr1')).reply;
  assert.match(bad, /couldn't find a project called "Nowhere"/);
  assert.match(bad, /1\. Website redesign/, 'valid choices are shown');
  const ready = (await ask('1', 'sim-mgr1')).reply;
  assert.match(ready, /Please confirm/);
});

test('2.9 projects an employee is not a member of are never offered, and cannot be typed in', async () => {
  await db()('projects').insert({ name: 'Other pod2 project', pod: 'pod2', created_by: U.mgr2.id, status: 'active' });
  const q1 = (await ask('create a ticket called Scoped', 'sim-emp2')).reply;
  assert.equal(q1, SELF_QUESTION);
  const list = (await ask('1', 'sim-emp2')).reply;
  assert.match(list, /1\. Website redesign/);
  assert.ok(!/Other pod2 project/.test(list), 'not in the list');
  const typed = (await ask('Other pod2', 'sim-emp2')).reply;
  assert.match(typed, /couldn't find a project called "Other pod2"/);
  assert.ok(!/Other pod2 project/.test(typed), 'not offered after a typed name either');
  assert.equal(await ticketCount('Scoped'), 0, 'no task is created');
});

test('2.10 two employees mid-draft stay separate: one reply never answers the other\'s question', async () => {
  await ask('create a ticket called Iso1', 'sim-mgr1');
  await ask('create a ticket called Iso2', 'sim-emp1');
  const emp = (await ask('1', 'sim-emp1')).reply;
  assert.match(emp, /^Which project should this task belong to\?/, 'Sam answered Sam\'s own question (the title was already given)');
  assert.match(emp, /1\. Website redesign/);
  const mgr = (await ask('2', 'sim-mgr1')).reply;
  assert.equal(mgr, 'Who should this task be assigned to?', 'Mia\'s own question is still waiting');
});

test('1.3 priority, 1.4 details, 1.5 assign: each changes exactly what was asked', async () => {
  for (const text of ['make the Hero ticket urgent']) {
    const { reply } = await ask(text, 'sim-mgr1');
    await intake(`CONFIRM ${confirmCode(reply)}`, 'sim-mgr1');
    assert.equal((await runNext(deps())).outcome, 'completed');
  }
  assert.equal((await ticketRow('Hero')).priority, 'urgent');
  const pod = await ask('create a ticket called Pod move for Ola in Website redesign, no deadline', 'sim-mgr1');
  await intake(`CONFIRM ${confirmCode(pod.reply)}`, 'sim-mgr1');
  await runNext(deps());
  const { reply } = await ask('assign the Pod move ticket to Ola', 'sim-mgr1');
  await intake(`CONFIRM ${confirmCode(reply)}`, 'sim-mgr1');
  assert.equal((await runNext(deps())).outcome, 'completed');
  assert.equal((await ticketRow('Pod move')).assigned_to, U.emp3.id, 'Ola is in pod 2, so this went to approval');
});

test('1.6 cross-pod creation waits: a pod 2 person on a pod 1 request is held until pod 2 approves through the assistant', async () => {
  const held = await ticketRow('Pod move');
  assert.equal(held.status, 'pending_approval', 'held');
  assert.deepEqual(JSON.parse(held.crosspod_pods), ['pod2'], 'pod 2 must approve');
  const { reply } = await ask('approve the Pod move ticket', 'sim-mgr2');
  await intake(`CONFIRM ${confirmCode(reply)}`, 'sim-mgr2');
  assert.equal((await runNext(deps())).outcome, 'completed');
  const after = await ticketRow('Pod move');
  assert.equal(after.assigned_to, U.emp3.id);
  assert.equal(after.pending_assign, null);
  assert.equal(after.status, 'todo');
});

test('1.6b cross-pod reassignment waits: the reassignment is held and applies only after the other pod approves', async () => {
  const { reply: c } = await ask('create a ticket called Reassign me for Sam in Website redesign, no deadline', 'sim-mgr1');
  await intake(`CONFIRM ${confirmCode(c)}`, 'sim-mgr1');
  assert.equal((await runNext(deps())).outcome, 'completed');
  const { reply: a } = await ask('assign the Reassign me ticket to Ola', 'sim-mgr1');
  await intake(`CONFIRM ${confirmCode(a)}`, 'sim-mgr1');
  assert.equal((await runNext(deps())).outcome, 'completed');
  const held = await ticketRow('Reassign me');
  assert.equal(held.assigned_to, U.emp1.id, 'assignee unchanged while held');
  assert.deepEqual(JSON.parse(held.crosspod_pods), ['pod2']);
  const { reply: ap } = await ask('approve the Reassign me ticket', 'sim-mgr2');
  await intake(`CONFIRM ${confirmCode(ap)}`, 'sim-mgr2');
  assert.equal((await runNext(deps())).outcome, 'completed');
  assert.equal((await ticketRow('Reassign me')).assigned_to, U.emp3.id, 'applied once pod 2 approved');
});

test('1.7 comment, 1.8 accept by the assignee, 1.9 manager decision on a pending request', async () => {
  const { reply: c } = await ask('add a comment on the Hero ticket saying looks good', 'sim-mgr1');
  await intake(`CONFIRM ${confirmCode(c)}`, 'sim-mgr1');
  assert.equal((await runNext(deps())).outcome, 'completed');
  assert.equal(await countOf(db()('task_comments').where({ comment: 'looks good' })), 1);
  // Sam is the assignee of Hero
  const { reply: a } = await ask('accept the Hero ticket', 'sim-emp1');
  await intake(`CONFIRM ${confirmCode(a)}`, 'sim-emp1');
  assert.equal((await runNext(deps())).outcome, 'completed');
  assert.equal((await db()('task_assignees').where({ task_id: (await ticketRow('Hero')).id, user_id: U.emp1.id }).first()).acceptance_status, 'accepted');
  // An employee raises a request; the manager rejects it
  await createOp(db(), { requestId: 'wf-pending', loopUserId: U.emp1.id }, { title: 'Pending', project_id: U.P, working_person_id: U.emp1.id });
  await db()('tasks').where({ title: 'Pending' }).update({ status: 'pending_approval' });
  const { reply: rj } = await ask('reject the Pending ticket because it needs more detail', 'sim-mgr1');
  await intake(`CONFIRM ${confirmCode(rj)}`, 'sim-mgr1');
  assert.equal((await runNext(deps())).outcome, 'completed');
  assert.equal((await ticketRow('Pending')).status, 'draft');
});

test('1.10 search and view: only what the employee can see, in the same words Loop uses', async () => {
  const found = await ask('search for Hero', 'sim-mgr1');
  assert.match(found.reply, /Hero/);
  const mine = await ask('show details of Hero', 'sim-emp1');
  assert.match(mine.reply, /Hero/);
  assert.equal(await requests(), await requests(), 'lookups create no request');
});

test('1.11 my tasks reads the real database: only my open tickets, and the same answer through the assistant', async () => {
  const mine = await listMyTasks(db(), { id: U.emp1.id, role: 'employee', name: U.emp1.name } as any);
  assert.ok(mine.items.some((i) => i.title === 'Hero'), 'Hero is assigned to emp1');
  assert.ok(mine.items.every((i) => i.assignee === U.emp1.name), 'no ticket assigned to someone else');
  assert.ok(mine.items.every((i) => i.status !== 'completed'), 'completed tickets are not listed');
  const direct = await db()('tasks').where({ assigned_to: U.emp1.id }).whereNot({ status: 'completed' }).count({ n: '*' }).first() as any;
  assert.ok(mine.total <= Number(direct.n), 'never more than the employee owns');
  const reply = await ask('show my tasks', 'sim-emp1');
  assert.match(reply.reply, /open task/);
  assert.match(reply.reply, /Hero/);
  const other = await ask('show my tasks', 'sim-emp2');
  assert.ok(!/Hero/.test(other.reply), 'another employee does not see Hero');
});

// ── 2. Security and permissions ──

test('2.1 an employee cannot run a manager-only decision on a request they raised, and the request ends refused', async () => {
  await createOp(db(), { requestId: 'wf-sam-own', loopUserId: U.emp1.id }, { title: 'Manager only', project_id: U.P, working_person_id: U.emp1.id });
  await db()('tasks').where({ title: 'Manager only' }).update({ status: 'pending_approval' });
  const { reply } = await ask('approve the Manager only ticket', 'sim-emp1');
  await intake(`CONFIRM ${confirmCode(reply)}`, 'sim-emp1');
  assert.equal((await runNext(deps())).outcome, 'failed');
  assert.equal((await ticketRow('Manager only')).status, 'pending_approval');
});

test('2.1b an employee who cannot see a ticket is told it cannot be found, not shown it', async () => {
  const r = await ask('approve the Pod move ticket', 'sim-emp2');
  assert.equal(r.r.status ?? r.r.response?.status ?? 'question', 'question');
  assert.match(r.reply, /couldn't find a ticket like/);
  // The reply repeats the employee's own words, but says nothing about the ticket itself
  assert.ok(!/Ola|pending|todo|Lee|Sam/.test(r.reply), r.reply);
});

test('2.2 a client cannot use the assistant at all: not a staff identity, so nothing is saved', async () => {
  const before = await requests();
  const out: any = await intake('create a ticket called Client try for Sam in Website redesign, no deadline', 'sim-client');
  assert.equal(out.kind, 'ignored', 'silence: no reply to a client'); assert.equal(out.response, undefined);
  assert.equal(await requests(), before);
  assert.equal(await ticketCount('Client try'), 0);
});

test('2.3 a revoked identity is refused at intake: no request, no change', async () => {
  const before = await requests();
  const out: any = await intake('create a ticket called Ghost for Sam in Website redesign, no deadline', 'sim-revoked');
  assert.equal(out.kind, 'ignored', 'silence: no reply'); assert.equal(out.response, undefined);
  assert.equal(await requests(), before);
  assert.equal(await ticketCount('Ghost'), 0);
});

test('2.4 a ticket reference the employee cannot see gets the same answer as one that does not exist', async () => {
  // Ned (pod 2, not on the project) asks about Hero, which exists, and about a name that does not exist
  const exists = await ask('show details of Hero', 'sim-outsider');
  const missing = await ask('show details of Nothing like this', 'sim-outsider');
  assert.equal(exists.reply.replace(/Hero/g, 'X'), missing.reply.replace(/Nothing like this/g, 'X'));
  assert.ok(!/Hero|urgent|Sam/.test(exists.reply), `no details leak: ${exists.reply}`);
});

test('2.5 an XLR8 ticket is excluded: the assistant refuses to change it', async () => {
  const [stage] = await db()('tasks').insert({ title: 'Stage ticket', project_id: U.P, created_by: U.mgr1.id, status: 'todo', priority: 'medium', ticket_type_id: 1 });
  const { reply } = await ask('assign the XLR8 ticket to Lee', 'sim-mgr1');
  await intake(`CONFIRM ${confirmCode(reply)}`, 'sim-mgr1');
  assert.equal((await runNext(deps())).outcome, 'failed');
  assert.equal((await db()('tasks').where({ id: stage }).first()).assigned_to, null, 'unchanged');
});

test('2.6 group chats cannot create or change tickets, and get only the fixed reply', async () => {
  const before = await requests();
  const out: any = await intake('create a ticket called Group try for Sam in Website redesign, no deadline', 'sim-mgr1', 'whatsapp');
  assert.equal(out.response.text, GROUP_REPLY);
  assert.equal(await requests(), before);
  assert.equal(await ticketCount('Group try'), 0);
});

test('2.7 the website shows an employee only their tickets, and a manager the pod\'s', async () => {
  const emp = await listTasks(db(), { id: U.emp2.id, role: 'employee' } as any, {});
  assert.ok(!emp.some((x: any) => x.title === 'Hero'), 'Lee is not on Hero');
  const mgr = await listTasks(db(), { id: U.mgr1.id, role: 'manager' } as any, {});
  assert.ok(mgr.some((x: any) => x.title === 'Hero'));
});

// ── 3. Failure and retry ──

test('3.1 a duplicate incoming message is recognised and creates nothing', async () => {
  const id = 'dup-message-1';
  const first: any = await intake('create a ticket called Dup for Sam in Website redesign, no deadline', 'sim-mgr1', 'simulator', id);
  const again: any = await intake('create a ticket called Dup for Sam in Website redesign, no deadline', 'sim-mgr1', 'simulator', id);
  assert.equal(again.kind, 'duplicate');
  assert.ok(first.kind !== 'duplicate');
  assert.equal(await countOf(db()('assistant_requests').where({ origin_message_id: id })), 1);
});

test('3.2 a duplicate confirmation runs the change once', async () => {
  const { reply } = await ask('create a ticket called Twice for Sam in Website redesign, no deadline', 'sim-mgr1');
  const code = confirmCode(reply);
  await intake(`CONFIRM ${code}`, 'sim-mgr1');
  const second: any = await intake(`CONFIRM ${code}`, 'sim-mgr1');
  assert.ok(!/Confirmed/.test(second.response?.text ?? ''), 'second confirmation is not accepted');
  await runNext(deps()); await runNext(deps());
  assert.equal(await ticketCount('Twice'), 1);
});

test('3.3 concurrent execution attempts claim the request once', async () => {
  const { reply } = await ask('create a ticket called Race for Sam in Website redesign, no deadline', 'sim-mgr1');
  await intake(`CONFIRM ${confirmCode(reply)}`, 'sim-mgr1');
  const results = await Promise.all([runNext(deps()), runNext(deps())]);
  assert.equal(results.filter((r) => r.outcome === 'completed').length, 1);
  assert.equal(await ticketCount('Race'), 1);
});

test('3.4 worker interruption: a request left mid-run is recovered and finishes once', async () => {
  const { reply } = await ask('create a ticket called Interrupted for Sam in Website redesign, no deadline', 'sim-mgr1');
  const code = confirmCode(reply);
  await intake(`CONFIRM ${code}`, 'sim-mgr1');
  const req = await db()('assistant_requests').where({ status: 'QUEUED' }).first('id');
  await db()('assistant_requests').where({ id: req.id }).update({ status: 'PROCESSING', locked_by: 'dead-worker', locked_until: new Date(Date.now() - 60_000) });
  await recoverInterrupted(db(), Date.now(), (i) => ticketRegistry(db()).canRetry(i), 3);
  assert.equal((await runNext(deps())).outcome, 'completed');
  assert.equal(await ticketCount('Interrupted'), 1);
});

test('3.5 recovery after a committed change finds it done and does not repeat it', async () => {
  const id = (await db()('assistant_requests').where({ status: 'COMPLETED' }).orderBy('created_at', 'desc').first('id')).id;
  const before = await ticketCount('Hero');
  await db()('assistant_requests').where({ id }).update({ status: 'QUEUED', next_attempt_at: null, locked_by: null, locked_until: null });
  await runNext(deps());
  assert.equal(await ticketCount('Hero'), before);
});

test('3.6 an expired request is never executed', async () => {
  const { reply } = await ask('create a ticket called Expire me for Sam in Website redesign, no deadline', 'sim-mgr1');
  await intake(`CONFIRM ${confirmCode(reply)}`, 'sim-mgr1');
  await db()('assistant_requests').where({ status: 'QUEUED' }).update({ queue_expires_at: new Date(Date.now() - 1000) });
  await expireDue(db(), Date.now() + 10_000_000, 60);
  assert.equal((await runNext(deps())).outcome, 'idle');
  assert.equal(await ticketCount('Expire me'), 0);
});

test('3.7 a cancelled request is never executed', async () => {
  const { reply } = await ask('create a ticket called Cancel me for Sam in Website redesign, no deadline', 'sim-mgr1');
  const cancelled: any = await intake(`CANCEL ${confirmCode(reply)}`, 'sim-mgr1');
  assert.match(cancelled.response.text, /Cancelled/);
  assert.equal((await runNext(deps())).outcome, 'idle');
  assert.equal(await ticketCount('Cancel me'), 0);
});

test('3.8 a notification failure does not fail a change: the assignment is kept', async () => {
  const { reply } = await ask('create a ticket called Notify me for Sam in Website redesign, no deadline', 'sim-mgr1');
  await intake(`CONFIRM ${confirmCode(reply)}`, 'sim-mgr1');
  await runNext(deps());
  await db().schema.renameTable('notifications', 'notifications_off');
  try {
    const { reply: a } = await ask('assign the Notify me ticket to Lee', 'sim-mgr1');
    await intake(`CONFIRM ${confirmCode(a)}`, 'sim-mgr1');
    assert.equal((await runNext(deps())).outcome, 'completed');
  } finally {
    await db().schema.renameTable('notifications_off', 'notifications');
  }
  assert.equal((await ticketRow('Notify me')).assigned_to, U.emp2.id);
});

test('3.9 an audit-write failure rolls the change back: no ticket, and the request is retried, not left half-done', async () => {
  const { reply } = await ask('create a ticket called Audit me for Sam in Website redesign, no deadline', 'sim-mgr1');
  const req = await requestFor(reply);
  await intake(`CONFIRM ${confirmCode(reply)}`, 'sim-mgr1');
  await db().raw(`CREATE TRIGGER fail_audit BEFORE INSERT ON assistant_ticket_audit BEGIN SELECT RAISE(ABORT, 'audit down'); END;`);
  let outcome: RunOutcome | undefined;
  try { outcome = (await runNext(deps())).outcome; } finally { await db().raw('DROP TRIGGER fail_audit'); }
  assert.equal(outcome, 'retry_scheduled');
  assert.equal(await ticketCount('Audit me'), 0, 'no ticket without its audit row');
  await db()('assistant_requests').where({ id: req }).update({ next_attempt_at: null });
  assert.equal((await runNext(deps())).outcome, 'completed');
  assert.equal(await ticketCount('Audit me'), 1);
  assert.equal(await countOf(db()('assistant_ticket_audit').where({ request_id: req })), 1);
});

async function requestFor(reply: string): Promise<string> {
  const row = await db()('assistant_requests').where({ status: 'READY_FOR_CONFIRMATION' }).orderBy('created_at', 'desc').first('id');
  return row.id;
}

// ── 5. Operational controls ──

test('5.1 with execution disabled, nothing is claimed, nothing runs, and no change is made', async () => {
  const { reply } = await ask('create a ticket called Off switch for Sam in Website redesign, no deadline', 'sim-mgr1');
  await intake(`CONFIRM ${confirmCode(reply)}`, 'sim-mgr1');
  assert.equal((await runNext(deps(false))).outcome, 'idle');
  assert.equal(await ticketCount('Off switch'), 0);
  assert.equal(await countOf(db()('assistant_requests').where({ status: 'QUEUED' })), 1, 'the request waits, untouched');
  assert.equal((await runNext(deps(true))).outcome, 'completed', 'and runs once execution is turned on');
});

test('5.2 nothing financial is in the assistant\'s replies, requests or audit rows', async () => {
  const money = /salary|hourly|payroll|invoice|budget|hourly_rate/i;
  const rows = await db()('assistant_requests').select('data', 'result_summary');
  for (const r of rows) assert.ok(!money.test(JSON.stringify(r)), 'request data is clean');
  const audit = await db()('assistant_ticket_audit').select('before_json', 'after_json');
  for (const r of audit) assert.ok(!money.test(JSON.stringify(r)), 'audit is clean');
});

test('5.3 stored failure text is short and carries no SQL or stack trace', async () => {
  const failed = await db()('assistant_executions').whereNotNull('error').select('error');
  for (const f of failed) {
    assert.ok(f.error.length <= 300);
    assert.ok(!/SELECT|INSERT|stack|at Object|SQLITE/i.test(f.error), `leak: ${f.error}`);
  }
});
