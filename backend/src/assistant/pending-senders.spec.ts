/// <reference types="node" />
// Manual @lid linking: pending records, expiry, approval rules, uniqueness, revocation, dismissal, and no automatic mapping.
process.env.SQLITE_FILE = ':memory:';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'pending-test-secret';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import { initDB, getDB } from '../db';
import { DbIdentityResolver, setIdentityStatus } from './identityStore';
import { recordPendingSender, approvePendingSender, dismissPendingSender, listPendingSenders, PendingError } from './pendingSenders';
import { createAssistantAdminRouter } from './adminApi';
import { listenLocal } from '../testServer';

const db = () => getDB();
const DAY = 86_400_000;
const U: Record<string, any> = {};
const ids = { nitish: '912345678901234567', other: '555000111222333444' };
let pendingNitish = 0;

const pendingRow = (lid: string) => db()('assistant_pending_senders').where({ channel: 'whatsapp', sender_id: lid }).first();
const count = async (table: string, where: object = {}) => Number((await db()(table).where(where).count('* as n').first() as any).n);

before(async () => {
  await initDB();
  const d = db();
  U.admin = (await d('users').insert({ name: 'Admin Ada', email: 'ada@pend.test', password_hash: 'x', role: 'admin', token_version: 0 }))[0];
  U.emp = (await d('users').insert({ name: 'Nitish', email: 'nitish@pend.test', password_hash: 'x', role: 'employee', token_version: 0 }))[0];
  U.emp2 = (await d('users').insert({ name: 'Second Person', email: 'second@pend.test', password_hash: 'x', role: 'employee', token_version: 0 }))[0];
  U.client = (await d('users').insert({ name: 'Client Corp', email: 'client@pend.test', password_hash: 'x', role: 'client', token_version: 0 }))[0];
});
after(async () => { await db().destroy(); });

const NOTE = 'Verified in person at the office on the company phone';

test('an unknown private internal id is recorded as pending: no request, no identity, and the count goes up', async () => {
  const reqBefore = await count('assistant_requests');
  assert.equal(await recordPendingSender(db(), `lid:${ids.nitish}`), 'recorded');
  assert.equal(await recordPendingSender(db(), `lid:${ids.nitish}`), 'recorded');
  const row = await pendingRow(ids.nitish);
  assert.equal(row.status, 'pending');
  assert.equal(Number(row.message_count), 2);
  assert.equal(row.last4, ids.nitish.slice(-4), 'only the last four are kept for display');
  assert.equal(await count('assistant_identities', { external_sender_id: `lid:${ids.nitish}` }), 0);
  assert.equal(await count('assistant_requests'), reqBefore);
  pendingNitish = row.id;
});

test('the admin list shows only the last four characters, never the full id', async () => {
  const list = await listPendingSenders(db());
  const item = list.find((x: any) => x.id === pendingNitish);
  assert.ok(item);
  assert.equal(item.last4, ids.nitish.slice(-4));
  assert.ok(!JSON.stringify(list).includes(ids.nitish), 'full id not in the list');
  assert.ok(item.days_left > 29);
});

test('a pending id is never matched to a person until approved: it is still blocked', async () => {
  const r = await new DbIdentityResolver(db()).resolve('whatsapp', `lid:${ids.nitish}`);
  assert.equal(r.status, 'unknown');
});

test('approval needs in-person confirmation and a real audit note', async () => {
  await assert.rejects(approvePendingSender(db(), { pendingId: pendingNitish, userId: U.emp, actorId: U.admin, inPersonVerified: false, note: NOTE }), (e: any) => e.code === 'verification_required');
  await assert.rejects(approvePendingSender(db(), { pendingId: pendingNitish, userId: U.emp, actorId: U.admin, inPersonVerified: true, note: 'ok' }), (e: any) => e.code === 'note_required');
});

test('approval links exactly this id to the chosen user, marks it linked, and writes an audit row without the full id', async () => {
  await approvePendingSender(db(), { pendingId: pendingNitish, userId: U.emp, actorId: U.admin, inPersonVerified: true, note: NOTE });
  const link = await db()('assistant_identities').where({ external_sender_id: `lid:${ids.nitish}` }).first();
  assert.equal(link.user_id, U.emp);
  assert.equal(link.status, 'active');
  assert.equal(link.linked_via, 'manual_lid');
  assert.equal((await pendingRow(ids.nitish)).status, 'linked');
  const audit = await db()('assistant_admin_audit').where({ action: 'identity_linked_manual' }).first();
  assert.equal(audit.actor_id, U.admin);
  assert.ok(!String(audit.detail).includes(ids.nitish) && !String(audit.target).includes(ids.nitish), 'no full id in the audit');
});

test('the approved identity is accepted; any other internal id is still unknown', async () => {
  const r = await new DbIdentityResolver(db()).resolve('whatsapp', `lid:${ids.nitish}`);
  assert.equal(r.status, 'verified');
  assert.equal((r as any).loopUserId, U.emp);
  assert.equal((await new DbIdentityResolver(db()).resolve('whatsapp', `lid:${ids.other}`)).status, 'unknown');
});

test('uniqueness: a person cannot gain a second active link, and the database refuses a duplicate identity', async () => {
  await recordPendingSender(db(), `lid:${ids.other}`);
  const other = (await pendingRow(ids.other)).id;
  await assert.rejects(approvePendingSender(db(), { pendingId: other, userId: U.emp, actorId: U.admin, inPersonVerified: true, note: NOTE }), (e: any) => e.code === 'user_has_active_link');
  assert.equal((await pendingRow(ids.other)).status, 'pending', 'a refused approval changes nothing');
  await assert.rejects(db()('assistant_identities').insert({
    user_id: U.emp2, channel: 'whatsapp', external_sender_id: `lid:${ids.nitish}`, status: 'active',
    active_sender_key: `whatsapp:lid:${ids.nitish}`, active_user_key: `${U.emp2}:whatsapp`, linked_via: 'manual_lid', verified_at: new Date(),
  }), 'the same identity cannot be active for a second person');
});

test('revocation blocks the identity at once; the same id does not come back as pending', async () => {
  const link = await db()('assistant_identities').where({ external_sender_id: `lid:${ids.nitish}` }).first();
  await setIdentityStatus(db(), { identityId: link.id, status: 'revoked', actorId: U.admin, reason: 'test revocation' });
  assert.equal((await new DbIdentityResolver(db()).resolve('whatsapp', `lid:${ids.nitish}`)).status, 'disabled');
  assert.equal(await recordPendingSender(db(), `lid:${ids.nitish}`), 'skipped', 'a known identity is not recorded again');
});

test('dismissed and expired records stay blocked and are not revived by new messages', async () => {
  const lid = '777888999000111222';
  await recordPendingSender(db(), `lid:${lid}`);
  const row = await pendingRow(lid);
  await dismissPendingSender(db(), { pendingId: row.id, actorId: U.admin, note: 'not the right person' });
  assert.equal(await recordPendingSender(db(), `lid:${lid}`), 'skipped');
  await assert.rejects(approvePendingSender(db(), { pendingId: row.id, userId: U.emp2, actorId: U.admin, inPersonVerified: true, note: NOTE }), (e: any) => e.code === 'not_pending');

  const old = '333444555666777888';
  await db()('assistant_pending_senders').insert({ channel: 'whatsapp', sender_id: old, last4: old.slice(-4), first_seen: new Date(Date.now() - 31 * DAY), last_seen: new Date(), message_count: 1, status: 'pending' });
  const oldRow = await pendingRow(old);
  await assert.rejects(approvePendingSender(db(), { pendingId: oldRow.id, userId: U.emp2, actorId: U.admin, inPersonVerified: true, note: NOTE }), (e: any) => e.code === 'expired');
  assert.equal((await pendingRow(old)).status, 'expired');
  assert.equal(await recordPendingSender(db(), `lid:${old}`), 'skipped', 'expired stays blocked');
  assert.equal((await new DbIdentityResolver(db()).resolve('whatsapp', `lid:${old}`)).status, 'unknown');
});

test('a client cannot be linked through this route', async () => {
  const lid = '121212121212121212';
  await recordPendingSender(db(), `lid:${lid}`);
  const row = await pendingRow(lid);
  await assert.rejects(approvePendingSender(db(), { pendingId: row.id, userId: U.client, actorId: U.admin, inPersonVerified: true, note: NOTE }), (e: any) => e.code === 'user_not_eligible');
});

test('phone-number identities are unaffected by the internal-id rule', async () => {
  assert.equal((await new DbIdentityResolver(db()).resolve('whatsapp', '+919000000777')).status, 'unknown', 'no link for this number, as before');
});

// ── Authorisation on the admin endpoints ──

const token = (id: number, role: string) => jwt.sign({ id, role, email: 'x', name: 'x', pod: null, tv: 0 }, process.env.JWT_SECRET!, { algorithm: 'HS256' });

test('the admin endpoints are admin-only and do not reveal full ids', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/assistant-admin', createAssistantAdminRouter({ getDB, registry: { canRetry: () => false, get: () => undefined, size: 0 } as any, config: null as any }));
  const srv = await listenLocal(app);
  const base = `http://127.0.0.1:${(srv.address() as any).port}/api/assistant-admin`;
  try {
    assert.equal((await fetch(`${base}/pending-senders`)).status, 401, 'no login');
    assert.equal((await fetch(`${base}/pending-senders`, { headers: { Authorization: `Bearer ${token(U.emp, 'employee')}` } })).status, 403, 'employee refused');
    const ok = await fetch(`${base}/pending-senders`, { headers: { Authorization: `Bearer ${token(U.admin, 'admin')}` } });
    assert.equal(ok.status, 200);
    assert.ok(!(await ok.text()).includes(ids.other), 'no full id in the response');
    const bad = await fetch(`${base}/pending-senders/999999/approve`, { method: 'POST', headers: { Authorization: `Bearer ${token(U.admin, 'admin')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: U.emp2, in_person_verified: true, note: NOTE }) });
    assert.equal(bad.status, 404, 'manipulated id is not found');
  } finally { srv.close(); }
});
