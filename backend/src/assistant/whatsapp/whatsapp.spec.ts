/// <reference types="node" />
// WhatsApp channel, tested against a fake connection and the real assistant pipeline, identity checks and ticket
// services on an in-memory database. No real WhatsApp account is used.
process.env.SQLITE_FILE = ':memory:';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'wa-test-secret';
// These tests exercise the preserved task operations through the real WhatsApp path. Production keeps them hidden.
process.env.ASSISTANT_TASK_OPS_ENABLED = 'true';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { initDB, getDB } from '../../db';
import { MockAIProvider } from '../ai';
import { WhatsAppAdapter, toIncoming, maskNumber, SocketHandle } from './adapter';
import { loadWhatsAppConfig, WhatsAppConfigError } from './config';
import { buildWhatsAppHandler } from './handler';
import { GROUP_REPLY } from '../engine';
import { ticketRegistry, stillVerified } from '../actions';
import { runNext } from '../executor';

const db = () => getDB();
const base = { confidence: 0.95, ambiguous: [], is_correction: false, cancel: false, answers_pending: false };
const ai = new MockAIProvider((req: any) => {
  const m = /"""([\s\S]*?)"""/.exec(req.user);
  const text = (m ? m[1] : '').trim();
  const c = /^create a ticket called (.+?) for (.+?) in Website redesign, no deadline$/.exec(text);
  if (c) return JSON.stringify({ ...base, intent: 'CREATE_TASK', fields: { title: c[1], employee: c[2], project: 'Website redesign', deadline: 'none' } });
  const sr = /^search for (.+)$/.exec(text); if (sr) return JSON.stringify({ ...base, intent: 'SEARCH_TICKETS', fields: { query: sr[1] } });
  const vd = /^show details of (.+?)( ticket)?$/.exec(text); if (vd) return JSON.stringify({ ...base, intent: 'VIEW_TASK_DETAILS', fields: { task_ref: vd[1] } });
  const ap = /^approve the (.+?) ticket$/.exec(text); if (ap) return JSON.stringify({ ...base, intent: 'APPROVE_TASK', fields: { task_ref: ap[1] } });
  return JSON.stringify({ ...base, intent: 'UNKNOWN', confidence: 0 });
});

// A fake WhatsApp connection: records what the adapter sends and lets the test emit events
class FakeSocket {
  handlers: Record<string, ((...a: any[]) => void)[]> = {};
  sent: { jid: string; text: string }[] = [];
  ended = false;
  user = { id: '919000000099:3@s.whatsapp.net' };
  ev = { on: (event: string, fn: (...a: any[]) => void) => { (this.handlers[event] ||= []).push(fn); } };
  async sendMessage(jid: string, content: { text: string }) { this.sent.push({ jid, text: content.text }); return {}; }
  end() { this.ended = true; }
  emit(event: string, payload: any) { for (const fn of this.handlers[event] ?? []) fn(payload); }
}

const EMPLOYEE_PHONE = '919000000001';   // Sam (active)
const OTHER_PHONE = '919000000002';      // Lee (active)
const REVOKED_PHONE = '919000000003';    // revoked link
const CLIENT_PHONE = '919000000004';     // client with an active link
const STRANGER_PHONE = '919000000005';   // no link at all
const CHAT = (phone: string) => `${phone}@s.whatsapp.net`;
const msg = (id: string, jid: string, text: string, extra: Record<string, unknown> = {}) => ({
  key: { id, remoteJid: jid, fromMe: false }, message: { conversation: text }, messageTimestamp: Math.floor(Date.now() / 1000), ...extra,
});
const waitFor = async (cond: () => boolean, ms = 3000) => { const t0 = Date.now(); while (!cond() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 15)); };

let sock: FakeSocket;
let qrWritten: string[] = [];
let logs: string[] = [];
let scheduled: { fn: () => void; ms: number }[] = [];
const U: Record<string, number> = {};

function makeAdapter(withQr = true) {
  sock = new FakeSocket();
  const handle = buildWhatsAppHandler(db(), {
    ai, timezone: 'Asia/Kolkata', contextTtlSeconds: 1800, confirmationTtlSeconds: 600, queueExpirySeconds: 900, executionEnabled: true,
  });
  return new WhatsAppAdapter({
    config: { enabled: true, sessionDir: '/tmp/wa-test-session-not-used', qrFile: null },
    makeSocket: async () => ({ socket: sock, saveCreds: () => {} } as SocketHandle),
    handle,
    writeQr: withQr ? (qr: string) => { qrWritten.push(qr); } : undefined,
    log: (level, m) => { logs.push(`${level}: ${m}`); },
    schedule: (fn, ms) => { scheduled.push({ fn, ms }); return scheduled.length; },
    unschedule: () => {},
  });
}
const linkWhatsApp = async (userId: number, phone: string, status: 'active' | 'revoked' = 'active') => {
  await db()('assistant_identities').insert({
    user_id: userId, channel: 'whatsapp', external_sender_id: `+${phone}`, status,
    active_sender_key: status === 'active' ? `whatsapp:+${phone}` : null, active_user_key: status === 'active' ? `w${userId}` : null,
    linked_via: 'admin', verified_at: new Date(),
  });
};

before(async () => {
  await initDB();
  const d = db();
  U.mgr = (await d('users').insert({ name: 'Mia Manager', email: 'mia@wa.test', password_hash: 'x', role: 'manager', pod: 'pod1' }))[0];
  U.sam = (await d('users').insert({ name: 'Sam Employee', email: 'sam@wa.test', password_hash: 'x', role: 'employee', pod: 'pod1' }))[0];
  U.lee = (await d('users').insert({ name: 'Lee Employee', email: 'lee@wa.test', password_hash: 'x', role: 'employee', pod: 'pod1' }))[0];
  U.rev = (await d('users').insert({ name: 'Rex Revoked', email: 'rex@wa.test', password_hash: 'x', role: 'employee', pod: 'pod1' }))[0];
  U.cli = (await d('users').insert({ name: 'Cora Client', email: 'cora@wa.test', password_hash: 'x', role: 'client' }))[0];
  U.P = (await d('projects').insert({ name: 'Website redesign', pod: 'pod1', created_by: U.mgr, status: 'active', manager_status: 'accepted' }))[0];
  await d('project_members').insert([U.mgr, U.sam, U.lee].map((u) => ({ project_id: U.P, user_id: u })));
  await linkWhatsApp(U.mgr, '919000000010');
  await linkWhatsApp(U.sam, EMPLOYEE_PHONE);
  await linkWhatsApp(U.lee, OTHER_PHONE);
  await linkWhatsApp(U.rev, REVOKED_PHONE, 'revoked');
  await linkWhatsApp(U.cli, CLIENT_PHONE);
});
after(async () => { await db().destroy(); });

// ── Configuration ──

test('configuration: off by default; enabling needs a session folder outside the project', () => {
  assert.equal(loadWhatsAppConfig({}).enabled, false);
  assert.throws(() => loadWhatsAppConfig({ ASSISTANT_WHATSAPP_ENABLED: 'true' }), (e: any) => e instanceof WhatsAppConfigError && e.problems.some((p: string) => /SESSION_DIR is required/.test(p)));
  assert.throws(() => loadWhatsAppConfig({ ASSISTANT_WHATSAPP_ENABLED: 'true', ASSISTANT_WHATSAPP_SESSION_DIR: 'relative/dir' }), /absolute/);
  assert.throws(() => loadWhatsAppConfig({ ASSISTANT_WHATSAPP_ENABLED: 'true', ASSISTANT_WHATSAPP_SESSION_DIR: path.join(process.cwd(), 'sessions') }), /outside the backend code folder/);
  const ok = loadWhatsAppConfig({ ASSISTANT_WHATSAPP_ENABLED: 'true', ASSISTANT_WHATSAPP_SESSION_DIR: '/var/lib/loop-whatsapp-session' });
  assert.equal(ok.enabled, true);
});

// ── Parsing incoming messages ──

test('parsing: groups are marked; display names, own messages, broadcasts and non-text are ignored; internal ids are kept as internal ids', () => {
  const priv = toIncoming(msg('a1', CHAT(EMPLOYEE_PHONE), 'hi', { pushName: 'Mia Manager' }));
  assert.equal(priv?.senderId, `+${EMPLOYEE_PHONE}`, 'the number is the identity, not the name');
  assert.equal(priv?.isGroup, false);
  assert.equal(toIncoming({ ...msg('a2', CHAT(EMPLOYEE_PHONE), 'hi'), key: { id: 'a2', remoteJid: CHAT(EMPLOYEE_PHONE), fromMe: true } }), null);
  assert.equal(toIncoming(msg('a3', 'status@broadcast', 'hi')), null);
  assert.equal(toIncoming({ key: { id: 'a4', remoteJid: CHAT(EMPLOYEE_PHONE) }, message: { imageMessage: {} } }), null);
  const grp = toIncoming({ key: { id: 'g1', remoteJid: '120363000000000000@g.us', participant: `${EMPLOYEE_PHONE}@s.whatsapp.net` }, message: { conversation: 'hi' } });
  assert.equal(grp?.isGroup, true);
  assert.equal(grp?.senderId, `+${EMPLOYEE_PHONE}`, 'the sender in a group is the participant');
  assert.match(toIncoming(msg('l1', '123456789012345@lid', 'hi'))!.senderId, /^lid:/, 'a private internal id is kept as lid:<id>');
  assert.equal(maskNumber('919812345678'), '+91 •••• 5678', 'masked for display');
});

// ── Connection lifecycle ──

test('QR pairing: the pairing code goes only to the private file, is never logged, and is not in the status', async () => {
  const consoleBefore = console.log; const captured: string[] = []; console.log = (...a: any[]) => { captured.push(a.join(' ')); };
  try {
    const adapter = makeAdapter(true);
    await adapter.start();
    sock.emit('connection.update', { qr: 'PAIRING-SECRET-XYZ-123' });
    assert.equal(adapter.status().state, 'awaiting_qr');
    assert.equal(adapter.status().qrPending, true);
    assert.deepEqual(qrWritten, ['PAIRING-SECRET-XYZ-123'], 'written to the private file');
    assert.ok(!JSON.stringify(adapter.status()).includes('PAIRING-SECRET'), 'not in the status');
    assert.ok(!logs.join('\n').includes('PAIRING-SECRET'), 'not in the adapter log');
    assert.ok(!captured.join('\n').includes('PAIRING-SECRET'), 'not on the console');
    sock.emit('connection.update', { connection: 'open' });
    assert.equal(adapter.status().state, 'connected');
    assert.equal(adapter.status().qrPending, false);
    assert.equal(adapter.status().account, '+91 •••• 0099', 'the account is shown masked');
    assert.ok(!JSON.stringify(adapter.status()).includes('919000000099'), 'the full number is never shown');
    await adapter.stop();
  } finally { console.log = consoleBefore; }
});

test('disconnect and reconnect: a dropped connection is retried with a delay; a phone-ended session is not retried', async () => {
  scheduled = [];
  const adapter = makeAdapter(true);
  await adapter.start();
  sock.emit('connection.update', { connection: 'open' });
  sock.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 500 } } } });
  assert.equal(adapter.status().state, 'reconnecting');
  assert.equal(scheduled.length, 1, 'one retry scheduled');
  assert.ok(scheduled[0].ms >= 1000, 'with a delay');
  await adapter.stop();
  assert.equal(sock.ended, true, 'the socket is closed on stop');
  assert.equal(adapter.status().state, 'stopped');

  scheduled = [];
  const loggedOut = makeAdapter(true);
  await loggedOut.start();
  sock.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 } } } });
  assert.equal(loggedOut.status().state, 'logged_out');
  assert.equal(scheduled.length, 0, 'no automatic retry after the phone ends the session');
  await loggedOut.stop();
});

// ── Messages through the assistant ──

test('an active employee gets the assistant reply in their own chat; the confirmation creates the ticket once', async () => {
  const adapter = makeAdapter(false);
  await adapter.start();
  sock.sent = [];
  sock.emit('messages.upsert', { type: 'notify', messages: [msg('w-create-1', CHAT(EMPLOYEE_PHONE), 'create a ticket called WA Hero for Sam Employee in Website redesign, no deadline')] });
  await waitFor(() => sock.sent.length === 1);
  assert.equal(sock.sent[0].jid, CHAT(EMPLOYEE_PHONE), 'reply goes to the same chat');
  const code = /CONFIRM (\w+)/.exec(sock.sent[0].text)?.[1];
  assert.ok(code, 'asks for explicit confirmation');
  sock.emit('messages.upsert', { type: 'notify', messages: [msg('w-confirm-1', CHAT(EMPLOYEE_PHONE), `CONFIRM ${code}`)] });
  await waitFor(() => sock.sent.length === 2);
  assert.match(sock.sent[1].text, /Confirmed/);
  assert.equal(await db()('tasks').where({ title: 'WA Hero' }).count('* as n').first().then((r: any) => 0 + Number(r.n)), 0, 'nothing changes before the worker runs');
  assert.equal((await runNext({ db: db(), registry: ticketRegistry(db()), workerId: 'wa', maxAttempts: 3, leaseSeconds: 60, stillVerified: (id: number) => stillVerified(db(), id), enabled: true })).outcome, 'completed');
  assert.equal(await db()('tasks').where({ title: 'WA Hero' }).count('* as n').first().then((r: any) => Number(r.n)), 1);
  await adapter.stop();
});

test('identity: revoked, unlinked, client and display-name-only senders get silence: no reply, no request, no task', async () => {
  const adapter = makeAdapter(false);
  await adapter.start();
  const before = Number((await db()('assistant_requests').count('* as n').first() as any).n);
  const senders = [REVOKED_PHONE, STRANGER_PHONE, CLIENT_PHONE];
  for (const [i, phone] of senders.entries()) {
    sock.emit('messages.upsert', { type: 'notify', messages: [msg('silent-' + i, CHAT(phone), 'create a ticket called Blocked for Sam Employee in Website redesign, no deadline', { pushName: 'Someone' })] });
  }
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(sock.sent.length, 0, 'no WhatsApp reply of any kind to an unverified sender');
  assert.equal(Number((await db()('assistant_requests').count('* as n').first() as any).n), before, 'nothing saved');
  assert.equal(await db()('tasks').where({ title: 'Blocked' }).count('* as n').first().then((r: any) => Number(r.n)), 0);
  await adapter.stop();
});

test('duplicate delivery: the same WhatsApp message twice gets one reply and saves one request', async () => {
  const adapter = makeAdapter(false);
  await adapter.start();
  sock.sent = [];
  const before = Number((await db()('assistant_requests').count('* as n').first() as any).n);
  const same = msg('w-dup-1', CHAT(EMPLOYEE_PHONE), 'create a ticket called Dup WA for Sam Employee in Website redesign, no deadline');
  sock.emit('messages.upsert', { type: 'notify', messages: [same] });
  sock.emit('messages.upsert', { type: 'notify', messages: [same] });
  await waitFor(() => sock.sent.length >= 1);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(sock.sent.length, 1, 'one reply');
  assert.equal(Number((await db()('assistant_requests').count('* as n').first() as any).n), before + 1, 'one request');
  await adapter.stop();
});

test('several employees at the same time: each gets their own reply in their own chat', async () => {
  const adapter = makeAdapter(false);
  await adapter.start();
  sock.sent = [];
  sock.emit('messages.upsert', { type: 'notify', messages: [
    msg('c-1', CHAT(EMPLOYEE_PHONE), 'create a ticket called Parallel A for Sam Employee in Website redesign, no deadline'),
    msg('c-2', CHAT(OTHER_PHONE), 'create a ticket called Parallel B for Lee Employee in Website redesign, no deadline'),
    msg('c-3', CHAT(REVOKED_PHONE), 'hello'),
  ] });
  await waitFor(() => sock.sent.length === 3);
  const byJid = new Map(sock.sent.map((s) => [s.jid, s.text]));
  assert.match(byJid.get(CHAT(EMPLOYEE_PHONE)) ?? '', /Please confirm/);
  assert.match(byJid.get(CHAT(OTHER_PHONE)) ?? '', /Please confirm/);
  assert.equal(byJid.get(CHAT(REVOKED_PHONE)), undefined, 'a revoked number gets no reply');
  assert.ok(!(byJid.get(CHAT(EMPLOYEE_PHONE)) ?? '').includes('Parallel B'), 'no cross-talk');
  await adapter.stop();
});

// ── Groups ──

const GROUP = '120363000000000001@g.us';
const groupMsg = (id: string, text: string, mention: boolean) => ({
  key: { id, remoteJid: GROUP, participant: `${EMPLOYEE_PHONE}@s.whatsapp.net`, fromMe: false },
  message: mention
    ? { extendedTextMessage: { text, contextInfo: { mentionedJid: ['919000000099@s.whatsapp.net'] } } }
    : { conversation: text },
  messageTimestamp: Math.floor(Date.now() / 1000),
});

test('groups: silent unless the company account is mentioned; a mention gets one generic reply, nothing is saved or changed', async () => {
  const adapter = makeAdapter(false);
  await adapter.start();
  sock.sent = [];
  const before = Number((await db()('assistant_requests').count('* as n').first() as any).n);
  sock.emit('messages.upsert', { type: 'notify', messages: [groupMsg('grp-quiet', 'create a ticket called Group WA for Sam Employee in Website redesign, no deadline', false)] });
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(sock.sent.length, 0, 'no reply to an unrelated group message');
  sock.emit('messages.upsert', { type: 'notify', messages: [groupMsg('grp-mention', 'create a ticket called Group WA for Sam Employee in Website redesign, no deadline', true)] });
  await waitFor(() => sock.sent.length === 1);
  assert.equal(sock.sent[0].jid, GROUP);
  assert.equal(sock.sent[0].text, GROUP_REPLY, 'the fixed generic reply only');
  assert.ok(!/Group WA|Sam|Website redesign|\d/.test(sock.sent[0].text), 'no ticket details, names or numbers');
  assert.equal(Number((await db()('assistant_requests').count('* as n').first() as any).n), before, 'nothing saved');
  assert.equal(await db()('tasks').where({ title: 'Group WA' }).count('* as n').first().then((r: any) => Number(r.n)), 0, 'no ticket change');
  await adapter.stop();
});

test('groups: every mention is answered straight away; none is held back by a timer', async () => {
  const adapter = makeAdapter(false);
  await adapter.start();
  sock.sent = [];
  for (let i = 0; i < 4; i++) sock.emit('messages.upsert', { type: 'notify', messages: [groupMsg(`grp-rl-${i}`, 'hello again', true)] });
  await waitFor(() => sock.sent.length >= 4);
  assert.equal(sock.sent.length, 4, 'four mentions, four replies');
  await adapter.stop();
});

test('session files: owner-only after every save, and the folder is owner-only too', async () => {
  const fs = require('fs'); const os = require('os'); const path = require('path');
  const { secureSessionSaver } = require('./baileys');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-perm-'));
  try {
    fs.writeFileSync(path.join(dir, 'creds.json'), '{}', { mode: 0o644 });
    fs.chmodSync(dir, 0o755);
    await secureSessionSaver(dir, async () => { fs.writeFileSync(path.join(dir, 'keys.json'), '{}', { mode: 0o644 }); })();
    assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
    for (const f of fs.readdirSync(dir)) assert.equal(fs.statSync(path.join(dir, f)).mode & 0o777, 0o600, f);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('linking from WhatsApp: an unlinked number sends its code, is linked, and its next message is answered', async () => {
  const adapter = makeAdapter(false);
  await adapter.start();
  const { createLinkCode } = require('../identityStore');
  const NEW_PHONE = '919000000020';
  const user = (await db()('users').insert({ name: 'Nia New', email: 'nia@wa.test', password_hash: 'x', role: 'employee', pod: 'pod1' }))[0];
  await db()('project_members').insert({ project_id: U.P, user_id: user });
  const { code } = await createLinkCode(db(), { userId: user, channel: 'whatsapp', phone: '+' + NEW_PHONE, createdBy: U.mgr, via: 'admin' });
  sock.sent = [];
  sock.emit('messages.upsert', { type: 'notify', messages: [msg('link-1', CHAT(NEW_PHONE), 'LINK ' + code)] });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(sock.sent.length, 0, 'the LINK is verified silently: no reply');
  sock.emit('messages.upsert', { type: 'notify', messages: [msg('link-2', CHAT(NEW_PHONE), 'search for Hero')] });
  await waitFor(() => sock.sent.length === 1);
  assert.doesNotMatch(sock.sent[0].text, /isn't linked/, 'the linked number is now verified');
  await adapter.stop();
});

// ── Shutdown ──

test('graceful shutdown: the socket closes, nothing is sent afterwards, and no reconnect is scheduled', async () => {
  scheduled = [];
  const adapter = makeAdapter(false);
  await adapter.start();
  sock.sent = [];
  await adapter.stop();
  assert.equal(sock.ended, true);
  sock.emit('messages.upsert', { type: 'notify', messages: [msg('after-stop', CHAT(OTHER_PHONE), 'hello')] });
  sock.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 500 } } } });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(sock.sent.length, 0);
  assert.equal(scheduled.length, 0);
  assert.equal(adapter.status().state, 'stopped');
});

test('the admin status exposes connection state only', () => {
  const adapter = makeAdapter(false);
  assert.deepEqual(Object.keys(adapter.status()).sort(), ['account', 'enabled', 'lastConnectedAt', 'lastDisconnectedAt', 'qrPending', 'reconnectAttempts', 'state']);
});

// ── More operations through the chat ──

test('search and view work in a private chat, and show only what the employee can see', async () => {
  const adapter = makeAdapter(false);
  await adapter.start();
  sock.sent = [];
  sock.emit('messages.upsert', { type: 'notify', messages: [msg('s-1', CHAT(EMPLOYEE_PHONE), 'search for Hero')] });
  await waitFor(() => sock.sent.length === 1);
  assert.match(sock.sent[0].text, /ticket/i);
  sock.sent = [];
  sock.emit('messages.upsert', { type: 'notify', messages: [msg('s-2', CHAT(EMPLOYEE_PHONE), 'show details of Nothing like this ticket')] });
  await waitFor(() => sock.sent.length === 1);
  assert.match(sock.sent[0].text, /couldn't find|more than one/i);
  await adapter.stop();
});

test('a manager approves a pending request from the chat; an employee is refused the same decision', async () => {
  const adapter = makeAdapter(false);
  await adapter.start();
  const { createOp } = require('../ticketMutations');
  const raised = await createOp(db(), { requestId: 'wa-pending-1', loopUserId: U.sam }, { title: 'WA Pending', project_id: U.P, working_person_id: U.sam });
  await db()('tasks').where({ id: raised.taskId }).update({ status: 'pending_approval' });
  // The employee tries first
  sock.sent = [];
  sock.emit('messages.upsert', { type: 'notify', messages: [msg('ap-e', CHAT(EMPLOYEE_PHONE), 'approve the WA Pending ticket')] });
  await waitFor(() => sock.sent.length === 1);
  const code1 = /CONFIRM (\w+)/.exec(sock.sent[0].text)?.[1];
  sock.emit('messages.upsert', { type: 'notify', messages: [msg('ap-e2', CHAT(EMPLOYEE_PHONE), `CONFIRM ${code1}`)] });
  await waitFor(() => sock.sent.length === 2);
  await runNext({ db: db(), registry: ticketRegistry(db()), workerId: 'wa', maxAttempts: 3, leaseSeconds: 60, stillVerified: (id: number) => stillVerified(db(), id), enabled: true });
  assert.equal((await db()('tasks').where({ id: raised.taskId }).first()).status, 'pending_approval', 'the employee cannot approve');
  // The manager approves
  sock.sent = [];
  const MGR_PHONE = '919000000010';
  sock.emit('messages.upsert', { type: 'notify', messages: [msg('ap-m', CHAT(MGR_PHONE), 'approve the WA Pending ticket')] });
  await waitFor(() => sock.sent.length === 1);
  const code2 = /CONFIRM (\w+)/.exec(sock.sent[0].text)?.[1];
  sock.emit('messages.upsert', { type: 'notify', messages: [msg('ap-m2', CHAT(MGR_PHONE), `CONFIRM ${code2}`)] });
  await waitFor(() => sock.sent.length === 2);
  await runNext({ db: db(), registry: ticketRegistry(db()), workerId: 'wa', maxAttempts: 3, leaseSeconds: 60, stillVerified: (id: number) => stillVerified(db(), id), enabled: true });
  assert.equal((await db()('tasks').where({ id: raised.taskId }).first()).status, 'todo', 'the manager approved it');
  await adapter.stop();
});

test('restart: the same session folder is reused, so the adapter reconnects without pairing again', async () => {
  const made: string[] = [];
  const first = new WhatsAppAdapter({
    config: { enabled: true, sessionDir: '/tmp/wa-session-restart-test', qrFile: null },
    makeSocket: async (dir) => { made.push(dir); return { socket: sock, saveCreds: () => {} } as SocketHandle; },
    handle: async () => null, log: () => {}, noReconnect: true,
  });
  await first.start();
  sock.emit('connection.update', { connection: 'open' });
  assert.equal(first.status().state, 'connected');
  await first.stop();
  const second = new WhatsAppAdapter({
    config: { enabled: true, sessionDir: '/tmp/wa-session-restart-test', qrFile: null },
    makeSocket: async (dir) => { made.push(dir); return { socket: sock, saveCreds: () => {} } as SocketHandle; },
    handle: async () => null, log: () => {}, noReconnect: true,
  });
  await second.start();
  assert.deepEqual(made, ['/tmp/wa-session-restart-test', '/tmp/wa-session-restart-test'], 'same session folder both times');
  await second.stop();
});

test('session saves run one at a time, and stop() waits for a pending save before closing', async () => {
  let active = 0;
  let maxActive = 0;
  let finished = 0;
  const slowSave = async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise<void>((r) => setTimeout(r, 40));
    active--;
    finished++;
  };
  const adapter = new WhatsAppAdapter({
    config: { enabled: true, sessionDir: '/tmp/wa-save-chain-test', qrFile: null },
    makeSocket: async () => ({ socket: sock, saveCreds: slowSave } as SocketHandle),
    handle: async () => null, log: () => {}, noReconnect: true,
  });
  await adapter.start();
  sock.emit('creds.update', {});
  sock.emit('creds.update', {});
  sock.emit('creds.update', {});
  await adapter.stop();
  assert.equal(finished, 3, 'every queued save finished before stop returned');
  assert.equal(maxActive, 1, 'saves never overlapped, so an older save cannot finish last');
});

// ── QR pairing after the phone ends the session ──
test('a session ended by the phone: the old files are kept aside, a new QR is issued, and pairing completes', async () => {
  const os = require('os') as typeof import('os');
  const fsx = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const root = fsx.mkdtempSync(path.join(os.tmpdir(), 'wa-pair-'));
  const sessionDir = path.join(root, 'session');
  fsx.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
  fsx.writeFileSync(path.join(sessionDir, 'creds.json'), '{"old":true}', { mode: 0o600 });
  const sockets: FakeSocket[] = [];
  const written: string[] = [];
  let cleared = 0;
  const logs: string[] = [];
  const adapter = new WhatsAppAdapter({
    config: { enabled: true, sessionDir, qrFile: null },
    makeSocket: async () => { fsx.mkdirSync(sessionDir, { recursive: true, mode: 0o700 }); const s = new FakeSocket(); sockets.push(s); return { socket: s, saveCreds: () => {} } as SocketHandle; },
    handle: async () => null,
    writeQr: (qr: string) => { written.push(qr); },
    clearQr: () => { cleared++; },
    log: (level, m) => { logs.push(`${level}: ${m}`); },
    noReconnect: true,
  });
  await adapter.start();
  // 1. The phone ends the session (401)
  sockets[0].emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 } } } });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(sockets.length, 2, 'a fresh socket is opened for pairing');
  const kept = fsx.readdirSync(root).filter((n: string) => n.startsWith('session-invalid-'));
  assert.equal(kept.length, 1, 'the old session is kept, not deleted');
  assert.equal(fsx.statSync(path.join(root, kept[0])).mode & 0o777, 0o700);
  assert.equal(fsx.readFileSync(path.join(root, kept[0], 'creds.json'), 'utf8'), '{"old":true}');
  // 2. A pairing code arrives: it is written privately, and the state says so
  sockets[1].emit('connection.update', { qr: 'PAIRING-PAYLOAD-1' });
  assert.equal(adapter.status().state, 'awaiting_qr');
  assert.equal(adapter.status().qrPending, true);
  assert.deepEqual(written, ['PAIRING-PAYLOAD-1']);
  // 3. A refreshed code replaces the previous one
  sockets[1].emit('connection.update', { qr: 'PAIRING-PAYLOAD-2' });
  assert.deepEqual(written, ['PAIRING-PAYLOAD-1', 'PAIRING-PAYLOAD-2']);
  // 4. The phone scans it: connected, and the QR file is removed
  sockets[1].emit('connection.update', { connection: 'open' });
  assert.equal(adapter.status().state, 'connected');
  assert.equal(adapter.status().qrPending, false);
  assert.equal(cleared, 1);
  // Logs never carry the payload
  assert.ok(logs.every((l) => !/PAIRING-PAYLOAD/.test(l)), 'no QR payload in logs');
  await adapter.stop();
  fsx.rmSync(root, { recursive: true, force: true });
});

test('repeated refusals stop pairing instead of looping forever', async () => {
  const os = require('os') as typeof import('os');
  const fsx = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const root = fsx.mkdtempSync(path.join(os.tmpdir(), 'wa-pair-loop-'));
  const sessionDir = path.join(root, 'session');
  fsx.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
  const sockets: FakeSocket[] = [];
  const adapter = new WhatsAppAdapter({
    config: { enabled: true, sessionDir, qrFile: null },
    makeSocket: async () => { fsx.mkdirSync(sessionDir, { recursive: true, mode: 0o700 }); const s = new FakeSocket(); sockets.push(s); return { socket: s, saveCreds: () => {} } as SocketHandle; },
    handle: async () => null, log: () => {}, noReconnect: true,
  });
  await adapter.start();
  for (let i = 0; i < 6; i++) {
    sockets[sockets.length - 1].emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 } } } });
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(sockets.length, 4, 'start plus three pairing rounds, then it stops');
  assert.equal(adapter.status().state, 'logged_out');
  await adapter.stop();
  fsx.rmSync(root, { recursive: true, force: true });
});

// ── Group mentions and group LINK messages ──
test('group: a mention of the company account by its @lid id gets the group reply, and a mention of an employee does not', async () => {
  const adapter = makeAdapter(false);
  (sock as any).user = { id: '919000000099:3@s.whatsapp.net', lid: '555000111:4@lid' };
  const linkedUser = (await db()('users').insert({ name: 'Group Linked', email: 'group-linked@wa.test', password_hash: 'x', role: 'employee', pod: 'pod1' }))[0];
  await db()('assistant_identities').insert({ user_id: linkedUser, channel: 'whatsapp', external_sender_id: 'lid:777000222', status: 'active', active_sender_key: 'whatsapp:lid:777000222', active_user_key: `${linkedUser}:whatsapp`, linked_via: 'manual_lid', initiated_by: U.mgr, verified_at: new Date() });
  await adapter.start();
  const grp = (mentioned: string[], id: string) => ({ key: { id, remoteJid: '120363000000000001@g.us', fromMe: false, participant: '777000222@lid' }, message: { extendedTextMessage: { text: 'hello @agency', contextInfo: { mentionedJid: mentioned } } }, messageTimestamp: Math.floor(Date.now() / 1000) });
  sock.sent = [];
  sock.emit('messages.upsert', { type: 'notify', messages: [grp(['555000111@lid'], 'g-own-lid')] });
  await waitFor(() => sock.sent.length === 1);
  assert.equal(sock.sent[0].text.length > 0, true, 'the company @lid mention is recognised');
  sock.sent = [];
  sock.emit('messages.upsert', { type: 'notify', messages: [grp(['888000333@lid'], 'g-employee')] });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(sock.sent.length, 0, 'mentioning an employee is not a mention of the company account');
  await adapter.stop();
});

test('group: an unlinked person who mentions the company account gets no reply at all', async () => {
  const adapter = makeAdapter(false);
  (sock as any).user = { id: '919000000099:3@s.whatsapp.net', lid: '555000111:4@lid' };
  await adapter.start();
  sock.sent = [];
  sock.emit('messages.upsert', { type: 'notify', messages: [{ key: { id: 'g-unlinked', remoteJid: '120363000000000001@g.us', fromMe: false, participant: '666000777@lid' }, message: { extendedTextMessage: { text: 'hello @agency', contextInfo: { mentionedJid: ['555000111@lid'] } } }, messageTimestamp: Math.floor(Date.now() / 1000) }] });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(sock.sent.length, 0, 'an unlinked sender is never answered, even in a group');
  await adapter.stop();
});

test('group: a LINK code posted in a group is not processed, and the sender is not recorded as a pending sender', async () => {
  const adapter = makeAdapter(false);
  await adapter.start();
  const before = Number((await db()('assistant_pending_senders').count('* as n').first() as any).n);
  const grp = { key: { id: 'g-link', remoteJid: '120363000000000001@g.us', fromMe: false, participant: '999000444@lid' }, message: { conversation: 'LINK 123456' }, messageTimestamp: Math.floor(Date.now() / 1000) };
  sock.sent = [];
  sock.emit('messages.upsert', { type: 'notify', messages: [grp] });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(sock.sent.length, 0, 'an unmentioned group message gets no reply');
  assert.equal(Number((await db()('assistant_pending_senders').count('* as n').first() as any).n), before, 'group senders are not registered for identity linking');
  await adapter.stop();
});

// ── Admin QR pairing (Control Centre) ──

test('pairing code for the admin page: only while waiting for a QR, cleared once connected or closed, never logged', async () => {
  logs = [];
  const adapter = makeAdapter(true);
  await adapter.start();
  assert.equal(adapter.pairingCode(), null, 'no code before WhatsApp asks for one');
  sock.emit('connection.update', { qr: 'ADMIN-PAGE-QR-1' });
  assert.equal(adapter.pairingCode()?.qr, 'ADMIN-PAGE-QR-1');
  sock.emit('connection.update', { qr: 'ADMIN-PAGE-QR-2' });
  assert.equal(adapter.pairingCode()?.qr, 'ADMIN-PAGE-QR-2', 'Baileys refreshes the code; the page gets the newest one');
  sock.emit('connection.update', { connection: 'open' });
  assert.equal(adapter.pairingCode(), null, 'gone once connected');
  sock.emit('connection.update', { qr: 'ADMIN-PAGE-QR-3' });
  sock.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 408 } } } });
  assert.equal(adapter.pairingCode(), null, 'an expired code is not served');
  assert.ok(!logs.join('\n').includes('ADMIN-PAGE-QR'), 'never logged');
  await adapter.stop();
});

test('new pairing round: refused while connected or waiting; allowed only after pairing stopped, on the same adapter', async () => {
  const adapter = makeAdapter(true);
  let sockets = 0;
  (adapter as any).d.makeSocket = async () => { sockets++; sock = new FakeSocket(); return { socket: sock, saveCreds: () => {} } as SocketHandle; };
  await adapter.start();
  assert.equal(sockets, 1);
  sock.emit('connection.update', { connection: 'open' });
  assert.equal(adapter.requestNewPairing(), false, 'connected: nothing to do');
  sock.emit('connection.update', { qr: 'X' });
  assert.equal(adapter.requestNewPairing(), false, 'waiting: Baileys issues codes by itself');
  sock.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 } } } });
  assert.equal(adapter.status().state, 'logged_out');
  assert.equal(adapter.requestNewPairing(), true);
  await waitFor(() => sockets === 2);
  assert.equal(sockets, 2, 'one new connection on the same adapter and session folder; no second adapter');
  await adapter.stop();
});

test('config: a session folder written as ~/folder is the home folder of the server user, and is accepted', () => {
  const os = require('os');
  const c = loadWhatsAppConfig({ ASSISTANT_WHATSAPP_ENABLED: 'true', ASSISTANT_WHATSAPP_SESSION_DIR: '~/.loop-whatsapp-session' } as any);
  assert.equal(c.sessionDir, path.join(os.homedir(), '.loop-whatsapp-session'));
});

test('production settings: compiled into the code, applied only in production, never override the server, hold no secrets', () => {
  const { applyProductionDefaults, PRODUCTION_DEFAULTS } = require('../productionDefaults');
  const dev: any = { NODE_ENV: 'development' };
  assert.equal(applyProductionDefaults(dev), false);
  assert.equal(dev.ASSISTANT_WHATSAPP_ENABLED, undefined, 'local development is untouched');
  const prod: any = { NODE_ENV: 'production', ASSISTANT_TIMEZONE: 'Europe/London' };
  assert.equal(applyProductionDefaults(prod), true);
  assert.equal(prod.ASSISTANT_OPENAI_MODEL, 'gpt-5.4-nano');
  assert.equal(prod.ASSISTANT_EXECUTION_ENABLED, 'false');
  assert.equal(prod.WHATSAPP_NOTIFICATION_GROUP_JID, '120363412745413406@g.us');
  assert.equal(prod.ASSISTANT_TIMEZONE, 'Europe/London', 'a value the server set itself wins');
  const keys = Object.keys(PRODUCTION_DEFAULTS).join(' ');
  assert.ok(!/API_KEY|SECRET|PASS|TASK_OPS/.test(keys), 'no secrets, and task operations stay off');
  const c = loadWhatsAppConfig(prod);
  assert.equal(c.enabled, true, 'the WhatsApp settings are valid as shipped');
});

test('config: on hosting where the repository is the home folder (cPanel), a session folder beside the code is accepted; inside the code it is not', () => {
  const backend = path.resolve(__dirname, '../../..');
  const beside = path.join(path.dirname(backend), '.loop-whatsapp-session');
  assert.equal(loadWhatsAppConfig({ ASSISTANT_WHATSAPP_ENABLED: 'true', ASSISTANT_WHATSAPP_SESSION_DIR: beside } as any).sessionDir, beside);
  assert.throws(() => loadWhatsAppConfig({ ASSISTANT_WHATSAPP_ENABLED: 'true', ASSISTANT_WHATSAPP_SESSION_DIR: path.join(backend, 'dist', 'session') } as any), /outside the backend code folder/);
});

// ── People linked by phone number, writing in a group from an internal WhatsApp id ──

test('toIncoming: keeps the phone number WhatsApp reports for an internal-id sender (group and private)', () => {
  const g = toIncoming({ key: { id: 'p1', remoteJid: GROUP, participant: '111222333444555@lid', participantPn: `${EMPLOYEE_PHONE}@s.whatsapp.net`, fromMe: false }, message: { conversation: 'hi' }, messageTimestamp: 1 })!;
  assert.equal(g.senderId, 'lid:111222333444555');
  assert.equal(g.senderPhoneId, `+${EMPLOYEE_PHONE}`);
  const p = toIncoming({ key: { id: 'p2', remoteJid: '111222333444555@lid', senderPn: `${EMPLOYEE_PHONE}@s.whatsapp.net`, fromMe: false }, message: { conversation: 'hi' }, messageTimestamp: 1 })!;
  assert.equal(p.senderPhoneId, `+${EMPLOYEE_PHONE}`);
  const none = toIncoming({ key: { id: 'p3', remoteJid: GROUP, participant: '111222333444555@lid', fromMe: false }, message: { conversation: 'hi' }, messageTimestamp: 1 })!;
  assert.equal(none.senderPhoneId, undefined, 'no number reported: nothing is guessed');
});

test('groups: someone linked by phone number is recognised when they write from an internal id; a stranger stays silent', async () => {
  const adapter = makeAdapter(false);
  await adapter.start();
  sock.sent = [];
  const fromLid = (id: string, pn?: string) => ({
    key: { id, remoteJid: GROUP, participant: '777888999000111@lid', ...(pn ? { participantPn: pn } : {}), fromMe: false },
    message: { extendedTextMessage: { text: 'hi', contextInfo: { mentionedJid: ['919000000099@s.whatsapp.net'] } } },
    messageTimestamp: Math.floor(Date.now() / 1000),
  });
  // Sam is linked by phone number; WhatsApp reports that number with the group message
  sock.emit('messages.upsert', { type: 'notify', messages: [fromLid('lid-linked-1', `${EMPLOYEE_PHONE}@s.whatsapp.net`)] });
  await waitFor(() => sock.sent.length >= 1);
  assert.equal(sock.sent.length, 1, 'answered');
  // A number that is not linked, and a message with no number at all: no reply
  sock.emit('messages.upsert', { type: 'notify', messages: [fromLid('lid-stranger-1', `${STRANGER_PHONE}@s.whatsapp.net`)] });
  sock.emit('messages.upsert', { type: 'notify', messages: [fromLid('lid-nonumber-1')] });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(sock.sent.length, 1, 'strangers stay silent');
  await adapter.stop();
});

// ── One connection across copies of the server (cPanel and similar hosting run several) ──

test('ownership: only one copy owns the WhatsApp connection; another takes over only when the owner goes quiet', async () => {
  const { claimOwner, releaseOwner, OWNER_STALE_MS } = require('./shared');
  await db()('assistant_settings').where({ name: 'wa_owner' }).del();
  const t = 1_800_000_000_000;
  assert.equal(await claimOwner(db(), 'copy-A', t), true, 'the first copy becomes the owner');
  assert.equal(await claimOwner(db(), 'copy-B', t + 1000), false, 'a second copy waits');
  assert.equal(await claimOwner(db(), 'copy-A', t + 10_000), true, 'the owner keeps it by refreshing');
  assert.equal(await claimOwner(db(), 'copy-B', t + 20_000), false, 'still fresh: no take-over');
  assert.equal(await claimOwner(db(), 'copy-B', t + 10_000 + OWNER_STALE_MS + 1), true, 'the owner went quiet: take-over');
  assert.equal(await claimOwner(db(), 'copy-A', t + 10_000 + OWNER_STALE_MS + 2), false, 'the old owner must step down');
  await releaseOwner(db(), 'copy-A');
  assert.equal(await claimOwner(db(), 'copy-C', t + 10_000 + OWNER_STALE_MS + 3), false, 'releasing as a non-owner changes nothing');
  await releaseOwner(db(), 'copy-B');
  assert.equal(await claimOwner(db(), 'copy-C', t + 10_000 + OWNER_STALE_MS + 4), true, 'after the owner releases, another copy can own it');
  await db()('assistant_settings').where({ name: 'wa_owner' }).del();
});

test('shared status: every copy reads what the owner published, encrypted at rest; nothing when the owner is gone', async () => {
  const { publishState, readState, OWNER_STALE_MS } = require('./shared');
  const t = 1_800_000_000_000;
  await publishState(db(), { status: { state: 'awaiting_qr', enabled: true }, qr: { qr: 'QR-SECRET-PAYLOAD', issuedAt: new Date(t).toISOString() }, groups: [{ name: 'Loop Testing', jid: '120363412745413406@g.us' }] }, t);
  const raw = await db()('assistant_settings').where({ name: 'wa_state' }).first('value');
  assert.ok(!String(raw.value).includes('QR-SECRET-PAYLOAD'), 'the QR is encrypted in the database');
  const s = await readState(db(), t + 5000);
  assert.equal(s.status.state, 'awaiting_qr');
  assert.equal(s.qr.qr, 'QR-SECRET-PAYLOAD');
  assert.equal(s.groups[0].name, 'Loop Testing');
  assert.equal(await readState(db(), t + OWNER_STALE_MS + 1), null, 'a status nobody refreshed is not shown as live');
});

test('keep-awake: only on the live server, only with a proper site address', () => {
  const { keepAwakeUrl } = require('./runtime');
  assert.equal(keepAwakeUrl({ NODE_ENV: 'development', FRONTEND_URL: 'https://example.com' } as any), null, 'never locally');
  assert.equal(keepAwakeUrl({ NODE_ENV: 'production', FRONTEND_URL: 'https://example.com/' } as any), 'https://example.com');
  assert.equal(keepAwakeUrl({ NODE_ENV: 'production', FRONTEND_URL: '' } as any), null);
  assert.equal(keepAwakeUrl({ NODE_ENV: 'production', FRONTEND_URL: 'not a url' } as any), null);
});
