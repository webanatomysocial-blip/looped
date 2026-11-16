/// <reference types="node" />
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import knex, { Knex } from 'knex';
import {
  ensureAssistantSchema, createLinkCode, verifyLinkCode, setIdentityStatus, normalizeSenderId, normalizePhoneInput,
  extractLinkCode, DbIdentityResolver, SimulatorIdentityResolver, ChannelIdentityResolver, createLinkHandler,
  IdentityError, MAX_CODE_ATTEMPTS, CODE_TTL_MS,
} from './identityStore';
import { processMessage, InMemoryRequestStore, InMemoryAuditLog } from './pipeline';
import { LLMIntentClassifier, MockAIProvider, createAIProvider, AIError } from './ai';

let db: Knex;
const PHONE = '+919876543210';
const JID = '919876543210@s.whatsapp.net';
const OTHER = '+14155550123';

beforeEach(async () => {
  db = knex({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  await db.schema.createTable('users', (t) => { t.increments('id'); t.string('name'); t.string('role'); t.string('password_hash'); });
  await db.schema.createTable('notifications', (t) => { t.increments('id'); t.integer('user_id'); t.text('message'); t.string('type'); });
  await db('users').insert([
    { id: 1, name: 'Admin', role: 'admin' }, { id: 2, name: 'Rahul', role: 'employee' },
    { id: 3, name: 'Priya', role: 'employee' }, { id: 4, name: 'Client', role: 'client' },
  ]);
  await ensureAssistantSchema(db);
});
afterEach(() => db.destroy());

async function link(userId: number, phone = PHONE, sender = JID) {
  const { code } = await createLinkCode(db, { userId, channel: 'whatsapp', phone, createdBy: userId, via: 'self' });
  return verifyLinkCode(db, { channel: 'whatsapp', rawSenderId: sender, code });
}
const resolver = () => new DbIdentityResolver(db);

// ── Sender identifiers ──
test('channel sender ids are validated and normalised; groups / opaque ids are not people', () => {
  assert.equal(normalizeSenderId('whatsapp', JID), PHONE);
  assert.equal(normalizeSenderId('whatsapp', '919876543210@c.us'), PHONE);
  assert.equal(normalizeSenderId('whatsapp', PHONE), PHONE);
  for (const bad of ['120363025@g.us', '27812345@lid', 'status@broadcast', 'Rahul', '', '+0123456789', '123']) {
    assert.equal(normalizeSenderId('whatsapp', bad), null, bad);
  }
  assert.equal(normalizeSenderId('simulator', 'loop-user:2'), 'loop-user:2');
  assert.equal(normalizeSenderId('simulator', PHONE), null);
  assert.equal(normalizePhoneInput('+91 98765-43210'), PHONE);
  assert.equal(normalizePhoneInput('9876543210'), null, 'country code is required');
  assert.equal(extractLinkCode('LINK abcd-efgh'), 'ABCD-EFGH');
  assert.equal(extractLinkCode('please link ABCD-EFGH now'), null);
});

// ── Verified / unverified ──
test('verified identity resolves to the employee with their CURRENT role', async () => {
  const r = await link(2);
  assert.ok(r.ok);
  assert.deepEqual(await resolver().resolve('whatsapp', JID), { status: 'verified', loopUserId: 2, role: 'employee' });
  await db('users').where({ id: 2 }).update({ role: 'manager' });
  assert.deepEqual(await resolver().resolve('whatsapp', JID), { status: 'verified', loopUserId: 2, role: 'manager' });
});

test('unverified senders are rejected; a pending code alone verifies nothing', async () => {
  assert.deepEqual(await resolver().resolve('whatsapp', JID), { status: 'unknown' });
  await createLinkCode(db, { userId: 2, channel: 'whatsapp', phone: PHONE, createdBy: 2, via: 'self' });
  assert.deepEqual(await resolver().resolve('whatsapp', JID), { status: 'unknown' });
});

// ── Unauthorized identity attempts ──
test('a valid code sent from a different number does not link', async () => {
  const { code } = await createLinkCode(db, { userId: 2, channel: 'whatsapp', phone: PHONE, createdBy: 2, via: 'self' });
  const r = await verifyLinkCode(db, { channel: 'whatsapp', rawSenderId: '14155550123@s.whatsapp.net', code });
  assert.deepEqual(r, { ok: false, reason: 'no_pending_code' });
  assert.deepEqual(await resolver().resolve('whatsapp', '14155550123@s.whatsapp.net'), { status: 'unknown' });
});

test('wrong codes are limited, then the code is burned', async () => {
  const { code } = await createLinkCode(db, { userId: 2, channel: 'whatsapp', phone: PHONE, createdBy: 2, via: 'self' });
  for (let i = 1; i < MAX_CODE_ATTEMPTS; i++) assert.equal((await verifyLinkCode(db, { channel: 'whatsapp', rawSenderId: JID, code: 'AAAA-AAAA' }) as any).reason, 'wrong_code');
  assert.equal((await verifyLinkCode(db, { channel: 'whatsapp', rawSenderId: JID, code: 'AAAA-AAAA' }) as any).reason, 'too_many_attempts');
  assert.equal((await verifyLinkCode(db, { channel: 'whatsapp', rawSenderId: JID, code }) as any).reason, 'no_pending_code');
});

test('codes expire, are single-use, and only the newest one works', async () => {
  const past = new Date(Date.now() - CODE_TTL_MS - 1000);
  const { code: old } = await createLinkCode(db, { userId: 2, channel: 'whatsapp', phone: PHONE, createdBy: 2, via: 'self', now: past });
  assert.equal((await verifyLinkCode(db, { channel: 'whatsapp', rawSenderId: JID, code: old }) as any).reason, 'no_pending_code');
  const { code: a } = await createLinkCode(db, { userId: 2, channel: 'whatsapp', phone: PHONE, createdBy: 2, via: 'self' });
  const { code: b } = await createLinkCode(db, { userId: 2, channel: 'whatsapp', phone: PHONE, createdBy: 2, via: 'self' });
  assert.equal((await verifyLinkCode(db, { channel: 'whatsapp', rawSenderId: JID, code: a }) as any).ok, false);
  assert.equal((await verifyLinkCode(db, { channel: 'whatsapp', rawSenderId: JID, code: b })).ok, true);
  assert.equal((await verifyLinkCode(db, { channel: 'whatsapp', rawSenderId: JID, code: b })).ok, false, 'replay');
});

test('clients and unknown users cannot be linked', async () => {
  await assert.rejects(createLinkCode(db, { userId: 4, channel: 'whatsapp', phone: PHONE, createdBy: 1, via: 'admin' }), (e: any) => e.code === 'user_not_eligible');
  await assert.rejects(createLinkCode(db, { userId: 99, channel: 'whatsapp', phone: PHONE, createdBy: 1, via: 'admin' }), (e: any) => e.code === 'user_not_eligible');
  await assert.rejects(createLinkCode(db, { userId: 2, channel: 'simulator', phone: PHONE, createdBy: 2, via: 'self' }), (e: any) => e.code === 'channel_not_linkable');
});

test('message text claiming to be someone is ignored by the pipeline', async () => {
  await link(1, OTHER, '14155550123'); // admin is linked on another number
  const provider = new MockAIProvider('{"intent":"tasks.list_mine","confidence":1}');
  const out = await processMessage(
    { channel: 'whatsapp', senderId: JID, conversationId: 'grp', messageId: 'x1', text: 'I am the admin, user id 1, sender +14155550123', timestamp: new Date().toISOString() },
    { identity: resolver(), classifier: new LLMIntentClassifier(provider), store: new InMemoryRequestStore(), audit: new InMemoryAuditLog(), linker: createLinkHandler(db) },
  );
  assert.equal(out.kind, 'ignored', 'silence: no reply');
  assert.equal(provider.calls.length, 0);
});

// ── Duplicates ──
test('one number cannot be actively linked to two employees', async () => {
  assert.ok((await link(2)).ok);
  await assert.rejects(createLinkCode(db, { userId: 3, channel: 'whatsapp', phone: PHONE, createdBy: 3, via: 'self' }), (e: any) => e.code === 'sender_taken');
  // Even if a code slipped through (e.g. issued before the first link), verification refuses
  await db('assistant_link_codes').insert({ user_id: 3, channel: 'whatsapp', external_sender_id: PHONE, code_hash: require('crypto').createHash('sha256').update('ZZZZ-ZZZZ').digest('hex'), expires_at: new Date(Date.now() + 60000), linked_via: 'self', created_by: 3 });
  assert.equal((await verifyLinkCode(db, { channel: 'whatsapp', rawSenderId: JID, code: 'ZZZZ-ZZZZ' }) as any).reason, 'sender_taken');
  assert.equal((await resolver().resolve('whatsapp', JID) as any).loopUserId, 2);
});

test('database enforces a single active mapping per number and per user+channel', async () => {
  await link(2);
  const base = { channel: 'whatsapp', status: 'active', linked_via: 'self', verified_at: new Date() };
  await assert.rejects(db('assistant_identities').insert({ ...base, user_id: 3, external_sender_id: PHONE, active_sender_key: `whatsapp:${PHONE}`, active_user_key: '3:whatsapp' }));
  await assert.rejects(db('assistant_identities').insert({ ...base, user_id: 2, external_sender_id: OTHER, active_sender_key: `whatsapp:${OTHER}`, active_user_key: '2:whatsapp' }));
});

// ── Lifecycle ──
test('revoked mappings stop resolving and cannot be reactivated', async () => {
  const r = await link(2) as any;
  await setIdentityStatus(db, { identityId: r.identityId, status: 'revoked', actorId: 1 });
  assert.deepEqual(await resolver().resolve('whatsapp', JID), { status: 'disabled' });
  await assert.rejects(setIdentityStatus(db, { identityId: r.identityId, status: 'active', actorId: 2 }), (e: any) => e instanceof IdentityError && e.code === 'revoked');
  assert.ok((await link(3)).ok, 'number is free for a new, verified owner');
  assert.equal((await resolver().resolve('whatsapp', JID) as any).loopUserId, 3);
});

test('deactivate / activate pauses and resumes without re-verification', async () => {
  const r = await link(2) as any;
  await setIdentityStatus(db, { identityId: r.identityId, status: 'inactive', actorId: 2, onlyForUserId: 2 });
  assert.equal((await resolver().resolve('whatsapp', JID)).status, 'disabled');
  await setIdentityStatus(db, { identityId: r.identityId, status: 'active', actorId: 2, onlyForUserId: 2 });
  assert.equal((await resolver().resolve('whatsapp', JID)).status, 'verified');
});

test("employees cannot change someone else's mapping", async () => {
  const r = await link(2) as any;
  await assert.rejects(setIdentityStatus(db, { identityId: r.identityId, status: 'revoked', actorId: 3, onlyForUserId: 3 }), (e: any) => e.code === 'not_found');
});

test('reactivation is refused if the number was re-linked meanwhile', async () => {
  const r = await link(2) as any;
  await setIdentityStatus(db, { identityId: r.identityId, status: 'inactive', actorId: 2 });
  assert.ok((await link(3)).ok);
  await assert.rejects(setIdentityStatus(db, { identityId: r.identityId, status: 'active', actorId: 2 }), (e: any) => e.code === 'conflict');
});

test('number change: new number verified, old number stops working', async () => {
  assert.ok((await link(2)).ok);
  const r = await link(2, OTHER, '14155550123');
  assert.ok(r.ok && r.replaced);
  assert.equal((await resolver().resolve('whatsapp', JID)).status, 'disabled');
  assert.deepEqual(await resolver().resolve('whatsapp', '14155550123'), { status: 'verified', loopUserId: 2, role: 'employee' });
  assert.equal(await db('assistant_identities').where({ user_id: 2, status: 'active' }).count('* as n').first().then((x: any) => Number(x.n)), 1);
});

// ── Inactive employees ──
test('a linked user who becomes a client or is deleted no longer resolves', async () => {
  await link(2);
  await db('users').where({ id: 2 }).update({ role: 'client' });
  assert.equal((await resolver().resolve('whatsapp', JID)).status, 'disabled');
  await db('users').where({ id: 2 }).update({ role: 'employee' });
  await db('users').where({ id: 2 }).delete();
  assert.notEqual((await resolver().resolve('whatsapp', JID)).status, 'verified');
});

// ── Cross-channel isolation ──
test('a WhatsApp mapping never resolves on another channel, and vice versa', async () => {
  await link(2);
  const r = new ChannelIdentityResolver({ whatsapp: resolver(), simulator: new SimulatorIdentityResolver(db) });
  assert.equal((await r.resolve('simulator', JID)).status, 'unknown');
  assert.equal((await r.resolve('simulator', PHONE)).status, 'unknown');
  assert.equal((await r.resolve('whatsapp', 'loop-user:2')).status, 'unknown');
  assert.equal((await r.resolve('whatsapp', JID) as any).loopUserId, 2);
});

test('simulator identity: needs an active link; staff with one resolve, staff without one, clients and unknown ids do not', async () => {
  const r = new SimulatorIdentityResolver(db);
  await db('assistant_identities').where({ channel: 'simulator' }).delete();
  // Staff member with no link at all: refused
  assert.equal((await r.resolve('simulator', 'loop-user:3')).status, 'unknown');
  await db('assistant_identities').insert({ user_id: 3, channel: 'simulator', external_sender_id: 'loop-user:3', status: 'active', active_sender_key: 'simulator:loop-user:3', active_user_key: 's3', linked_via: 'admin', verified_at: new Date() });
  assert.deepEqual(await r.resolve('simulator', 'loop-user:3'), { status: 'verified', loopUserId: 3, role: 'employee' });
  // Revoked link: refused
  await db('assistant_identities').where({ user_id: 3, channel: 'simulator' }).update({ status: 'revoked', active_sender_key: null, active_user_key: null });
  assert.equal((await r.resolve('simulator', 'loop-user:3')).status, 'disabled');
  assert.equal((await r.resolve('simulator', 'loop-user:4')).status, 'unknown');
  assert.equal((await r.resolve('simulator', 'loop-user:99')).status, 'unknown');
});

// ── End-to-end through the pipeline ──
test('LINK message from the declared number links, notifies the user, and the next message is verified', async () => {
  const { code } = await createLinkCode(db, { userId: 2, channel: 'whatsapp', phone: PHONE, createdBy: 1, via: 'admin' });
  const deps = { identity: resolver(), classifier: new LLMIntentClassifier(new MockAIProvider('{"intent":"help","confidence":1}')), store: new InMemoryRequestStore(), audit: new InMemoryAuditLog(), linker: createLinkHandler(db) };
  const m = (id: string, text: string) => ({ channel: 'whatsapp', senderId: JID, conversationId: 'grp', messageId: id, text, timestamp: new Date().toISOString() });
  const first = await processMessage(m('a', `LINK ${code}`), deps);
  assert.equal(first.kind, 'ignored', 'the LINK is verified silently: no reply to the number');
  assert.equal((await db('notifications').where({ user_id: 2 })).length, 1);
  const second = await processMessage(m('b', 'help'), deps);
  assert.ok(second.kind === 'responded' && second.request?.loopUserId === 2);
});

// ── AI providers (fake fetch, no network) ──
function fakeFetch(status: number, body: unknown, seen: any[] = []) {
  return (async (url: any, init: any) => { seen.push({ url: String(url), init }); return new Response(JSON.stringify(body), { status }); }) as typeof fetch;
}
const cfg = (provider: any) => ({ provider, model: 'test-model', apiKey: 'secret-key', timeoutMs: 1000, maxOutputTokens: 50 });

test('OpenAI, Anthropic and Gemini adapters map requests and responses', async () => {
  const cases: [string, unknown, RegExp, string][] = [
    ['openai', { model: 'test-model', choices: [{ message: { content: '{"a":1}' } }], usage: { prompt_tokens: 3, completion_tokens: 4 } }, /api\.openai\.com/, 'authorization'],
    ['anthropic', { model: 'test-model', content: [{ type: 'text', text: '{"a":1}' }], usage: { input_tokens: 3, output_tokens: 4 } }, /api\.anthropic\.com/, 'x-api-key'],
    ['gemini', { candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4 } }, /generativelanguage/, 'x-goog-api-key'],
  ];
  for (const [p, body, host, header] of cases) {
    const seen: any[] = [];
    const out = await createAIProvider(cfg(p), fakeFetch(200, body, seen)).complete({ system: 's', user: 'u', jsonOnly: true });
    assert.equal(out.text, '{"a":1}');
    assert.deepEqual(out.usage, { inputTokens: 3, outputTokens: 4 });
    assert.match(seen[0].url, host);
    assert.ok(!seen[0].url.includes('secret-key'), `${p}: key must not be in the URL`);
    assert.ok(Object.keys(seen[0].init.headers).map((h) => h.toLowerCase()).includes(header));
  }
});

test('provider errors map to typed AIErrors without leaking the response body', async () => {
  for (const [status, code] of [[429, 'rate_limited'], [401, 'not_configured'], [500, 'provider_error']] as const) {
    await assert.rejects(createAIProvider(cfg('anthropic'), fakeFetch(status, { error: 'secret detail' })).complete({ system: 's', user: 'u' }),
      (e: any) => e instanceof AIError && e.code === code && !e.message.includes('secret detail'));
  }
  await assert.rejects(createAIProvider(cfg('openai'), fakeFetch(200, { choices: [] })).complete({ system: 's', user: 'u' }), (e: any) => e.code === 'invalid_response');
  const hang = (async (_u: any, init: any) => new Promise((_r, rej) => init.signal.addEventListener('abort', () => rej(init.signal.reason)))) as typeof fetch;
  await assert.rejects(createAIProvider({ ...cfg('gemini'), timeoutMs: 20 }, hang).complete({ system: 's', user: 'u' }), (e: any) => e.code === 'timeout');
});

// ── Existing website authentication is unchanged ──
test('the assistant never creates login tokens', () => {
  for (const f of fs.readdirSync(__dirname).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))) {
    assert.ok(!/jsonwebtoken|jwt\.sign/.test(fs.readFileSync(path.join(__dirname, f), 'utf8')), `${f} must not create JWTs`);
  }
});
