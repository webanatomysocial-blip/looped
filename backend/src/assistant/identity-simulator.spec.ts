/// <reference types="node" />
// Simulator intake checks the employee's active link before anything is saved. Refused senders get the same plain
// reply, and no assistant request is created.
process.env.SQLITE_FILE = ':memory:';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDB, getDB } from '../db';
import { MockAIProvider } from './ai';
import { RequestEngine } from './engine';
import { SUSPENDED_TASK_INTENTS } from './actions';
import { processMessage } from './pipeline';
import { DbRequestStore, DbAuditLog } from './conversationStore';
import { ChannelIdentityResolver, DbIdentityResolver, SimulatorIdentityResolver } from './identityStore';
import { searchTickets, viewTicket, listMyTasks } from '../services/ticketReads';

const db = () => getDB();
const base = { confidence: 0.95, ambiguous: [], is_correction: false, cancel: false, answers_pending: false };
const ai = new MockAIProvider(() => JSON.stringify({ ...base, intent: 'SEARCH_TICKETS', fields: { query: 'Anything' } }));
const engine = () => new RequestEngine({
  db: db(), ai, timezone: 'Asia/Kolkata', contextTtlSeconds: 1800, exposedIntents: SUSPENDED_TASK_INTENTS,
  reader: { search: (a, t) => searchTickets(db(), a as any, t) as any, view: (a, id) => viewTicket(db(), a as any, id) as any, mine: (a) => listMyTasks(db(), a as any) as any },
});
const identity = () => new ChannelIdentityResolver({ simulator: new SimulatorIdentityResolver(db()), whatsapp: new DbIdentityResolver(db()) });
const U: Record<string, number> = {};
const requests = async () => Number((await db()('assistant_requests').count('* as n').first() as any).n);
const send = (senderId: string) => processMessage({
  channel: 'simulator', senderId, conversationId: 'c1', messageId: `m-${Math.random()}`, text: 'search for anything', timestamp: new Date().toISOString(),
}, { identity: identity(), classifier: undefined as any, store: new DbRequestStore(db()), audit: new DbAuditLog(db()), engine: engine() as any });

before(async () => {
  await initDB();
  const d = db();
  for (const [k, role] of [['active', 'employee'], ['revoked', 'employee'], ['unlinked', 'employee'], ['client', 'client'], ['gone', 'employee']] as const) {
    U[k] = (await d('users').insert({ name: `Person ${k} <private@mail.test>`, email: `${k}@sim.test`, password_hash: 'x', role }))[0];
  }
  for (const [k, status] of [['active', 'active'], ['revoked', 'revoked'], ['client', 'active']] as const) {
    await d('assistant_identities').insert({ user_id: U[k], channel: 'simulator', external_sender_id: `loop-user:${U[k]}`, status, active_sender_key: status === 'active' ? `simulator:loop-user:${U[k]}` : null, active_user_key: status === 'active' ? `s${U[k]}` : null, linked_via: 'admin', verified_at: new Date() });
  }
  await d('users').where({ id: U.gone }).delete();   // deleted: the row is gone, the link went with it (cascade)
});
after(async () => { await db().destroy(); });

test('an active employee with an active link is accepted and gets an answer', async () => {
  const before = await requests();
  const out: any = await send(`loop-user:${U.active}`);
  assert.doesNotMatch(out.response.text, /isn't linked/, 'not refused');
  assert.equal(await requests(), before, 'a search is a read: it creates no request');
});

test('a revoked link is refused before any request is created', async () => {
  const before = await requests();
  const out: any = await send(`loop-user:${U.revoked}`);
  assert.equal(out.kind, 'ignored', 'silence: no reply to an unverified sender'); assert.equal(out.response, undefined);
  assert.equal(await requests(), before);
});

test('a deleted employee is refused before any request is created', async () => {
  const before = await requests();
  const out: any = await send(`loop-user:${U.gone}`);
  assert.equal(out.kind, 'ignored', 'silence: no reply to an unverified sender'); assert.equal(out.response, undefined);
  assert.equal(await requests(), before);
});

test('an unlinked employee (no identity link) is refused before any request is created', async () => {
  const before = await requests();
  const out: any = await send(`loop-user:${U.unlinked}`);
  assert.equal(out.kind, 'ignored', 'silence: no reply to an unverified sender'); assert.equal(out.response, undefined);
  assert.equal(await requests(), before);
});

test('a client is refused even with an active link', async () => {
  const before = await requests();
  const out: any = await send(`loop-user:${U.client}`);
  assert.equal(out.kind, 'ignored', 'silence: no reply to an unverified sender'); assert.equal(out.response, undefined);
  assert.equal(await requests(), before);
});

test('the refusal reveals nothing about the account: same wording for every refused case, no name or email', async () => {
  const outs = [await send(`loop-user:${U.revoked}`), await send(`loop-user:${U.gone}`), await send(`loop-user:${U.unlinked}`)];
  for (const o of outs) { assert.equal((o as any).kind, 'ignored', 'no reply of any kind'); assert.equal((o as any).response, undefined); }
});
