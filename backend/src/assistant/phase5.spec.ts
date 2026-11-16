/// <reference types="node" />
// Phase 5 (read-only part): assistant lookups use Loop's own visibility; group replies carry no ticket details.
process.env.SQLITE_FILE = ':memory:';
delete process.env.NODE_ENV;
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDB, getDB } from '../db';
import { MockAIProvider } from './ai';
import { RequestEngine, GROUP_REPLY } from './engine';
import { searchTickets, viewTicket, listMyTasks } from '../services/ticketReads';
import { IncomingMessage } from './types';

const U: Record<string, any> = {};
const base = { intent: 'UNKNOWN', confidence: 0.95, fields: {}, ambiguous: [], is_correction: false, cancel: false, answers_pending: false };
const table: Record<string, any> = {
  'homepage': { ...base, intent: 'SEARCH_TICKETS', fields: { query: 'homepage' } },
  'details of homepage redesign': { ...base, intent: 'VIEW_TASK_DETAILS', fields: { task_ref: 'Homepage redesign' } },
  'details of homepage': { ...base, intent: 'VIEW_TASK_DETAILS', fields: { task_ref: 'homepage' } },
  'details of nothing here': { ...base, intent: 'VIEW_TASK_DETAILS', fields: { task_ref: 'nothing here' } },
  'search': { ...base, intent: 'SEARCH_TICKETS', fields: {}, answers_pending: false },
  'pod two': { ...base, intent: 'SEARCH_TICKETS', fields: { query: 'pod two' } },
  'create a ticket': { ...base, intent: 'CREATE_TASK', fields: { title: 'x', employee: 'Priya', project: 'P1', deadline: 'none' } },
  'the query is pod two': { ...base, intent: 'SEARCH_TICKETS', answers_pending: true, fields: { query: 'pod two' } },
};
const mock = new MockAIProvider((req: any) => {
  const m = /"""([\s\S]*?)"""/.exec(req.user);
  const hit = table[(m ? m[1] : '').trim()];
  return JSON.stringify(hit ?? { ...base });
});

function engine(exposed: string[] | undefined = ['SEARCH_TICKETS', 'VIEW_TASK_DETAILS']) {
  const db = getDB();
  return new RequestEngine({
    db, ai: mock, timezone: 'UTC', contextTtlSeconds: 1800,
    exposedIntents: exposed,
    reader: {
      search: (actor, text) => searchTickets(db, actor as any, text) as any,
      view: (actor, id) => viewTicket(db, actor as any, id) as any,
      mine: (actor) => listMyTasks(db, actor as any) as any,
    },
  });
}
const m = (text: string, channel = 'simulator'): IncomingMessage => ({ channel, senderId: 'x', conversationId: 'c', messageId: 'id' + Math.random(), text, timestamp: new Date().toISOString() } as any);
const who = (k: string) => ({ id: U[k].id, role: U[k].role });

before(async () => {
  await initDB();
  const db = getDB();
  const mk = async (k: string, role: string, pod: string | null) => { const [id] = await db('users').insert({ name: k, email: `${k}@p5.test`, password_hash: 'x', role, pod }); U[k] = { id, role, pod, name: k }; };
  await mk('admin', 'admin', null);
  await mk('mgr1', 'manager', 'pod1');
  await mk('emp1', 'employee', 'pod1');
  await mk('emp2', 'employee', 'pod1');
  const P1 = (await db('projects').insert({ name: 'P1', pod: 'pod1', created_by: U.admin.id, status: 'active', manager_status: 'accepted' }))[0];
  await db('project_members').insert([{ project_id: P1, user_id: U.emp1.id }, { project_id: P1, user_id: U.mgr1.id }]);
  const T1 = (await db('tasks').insert({ title: 'Homepage redesign', project_id: P1, created_by: U.mgr1.id, assigned_to: U.emp1.id, status: 'todo', priority: 'high' }))[0];
  await db('task_assignees').insert({ task_id: T1, user_id: U.emp1.id, assignee_role: 'employee', acceptance_status: 'accepted' });
  await db('tasks').insert({ title: 'Homepage copy (other)', project_id: P1, created_by: U.mgr1.id, status: 'todo', priority: 'low' });
});
after(async () => { await getDB().destroy(); });

test('private channel: a search shows only the tickets this employee can see', async () => {
  const r = await engine().handle(m('homepage'), who('emp1'));
  assert.equal(r.status, 'answered');
  assert.match(r.reply, /📋 \*1 ticket\*/, 'employees see only tickets they are involved in, not the unassigned one');
  const mgr = await engine().handle(m('homepage'), who('mgr1'));
  assert.match(mgr.reply, /2 tickets/, 'a manager sees both pod tickets');
  const other = await engine().handle(m('homepage', 'simulator'), who('emp2'));
  assert.equal(other.reply, 'ℹ️ No tickets match that in what you can see.');
});

test('group channel: replies are the fixed template, with no titles, counts or ids', async () => {
  for (const text of ['homepage', 'details of homepage redesign']) {
    const r = await engine().handle(m(text, 'whatsapp'), who('emp1'));
    assert.equal(r.reply, GROUP_REPLY, text);
    assert.ok(!/Homepage|#\d|\b\d+ tickets?\b/.test(r.reply));
  }
});

test('group channel: an empty or unknown lookup gets the same template (no existence hint)', async () => {
  const unknown = await engine().handle(m('details of nothing here', 'whatsapp'), who('emp1'));
  const known = await engine().handle(m('details of homepage redesign', 'whatsapp'), who('emp2'));
  assert.equal(unknown.reply, GROUP_REPLY);
  assert.equal(known.reply, GROUP_REPLY);
});

test('private channel: viewing one visible ticket shows its details; an ambiguous reference asks which one', async () => {
  const one = await engine().handle(m('details of homepage redesign'), who('emp1'));
  assert.match(one.reply, /Homepage redesign: to do|Homepage redesign/);
  assert.match(one.reply, /Checklist 0\/0/);
  const many = await engine().handle(m('details of homepage'), who('mgr1'));
  assert.match(many.reply, /More than one ticket matches/);
  const none = await engine().handle(m('details of nothing here'), who('emp1'));
  assert.equal(none.reply, "ℹ️ I couldn't find a ticket like that that you can see.");
});

test('an unexposed intent is refused plainly and nothing is queued', async () => {
  const db = getDB();
  const before = await db('assistant_requests').count('* as n').first();
  const r = await engine(['SEARCH_TICKETS']).handle(m('create a ticket'), who('emp1'));
  assert.equal(r.status, 'not_available');
  const after = await db('assistant_requests').count('* as n').first();
  assert.equal(Number((after as any).n), Number((before as any).n), 'no request created');
});

test('a search without text asks what to search for, then answers in the same conversation', async () => {
  const e = engine();
  const q = await e.handle(m('search'), who('emp1'));
  assert.equal(q.status, 'question');
  assert.match(q.reply, /What should I search for/);
  const a = await e.handle(m('the query is pod two'), who('emp1'));
  assert.equal(a.status, 'answered');
  assert.match(a.reply, /No tickets match|tickets?:/);
});

test('reader failures never leak internal detail', async () => {
  const broken = new RequestEngine({ db: getDB(), ai: mock, timezone: 'UTC', contextTtlSeconds: 1800, exposedIntents: ['SEARCH_TICKETS'],
    reader: { search: async () => { throw new Error('SQLITE boom on tasks'); }, view: async () => { throw new Error('x'); }, mine: async () => ({ total: 0, items: [] }) } });
  const r = await broken.handle(m('homepage'), who('emp1'));
  assert.equal(r.status, 'answered');
  assert.ok(!/SQLITE|boom/.test(r.reply));
});
