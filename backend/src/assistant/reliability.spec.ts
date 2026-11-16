/// <reference types="node" />
// Reliability: per-employee limit enforced by the database, lease renewal, restart recovery, expiry, configuration
// warnings, and the first-login password change. Runs on SQLite (in memory) and on MySQL when the harness is enabled.
process.env.SQLITE_FILE = ':memory:';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'reliability-test-secret';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import express from 'express';
import bcrypt from 'bcryptjs';
import { initDB, getDB } from '../db';
import { claimNext, expireDue, recoverInterrupted } from './queue';
import { HandlerRegistry, runNext, ActionHandler } from './executor';
import { recoverOnStartup } from './worker';
import { loadAssistantConfig, AssistantConfigError } from './config';
import { authenticate } from '../middleware/auth';
import authRouter from '../routes/auth';

const db = () => getDB();
const NOW = () => Date.now();
const U: Record<string, number> = {};
let seq = 0;
// A fresh employee for each test, so one test's running request never affects another
const fresh = async (label: string) => (await db()('users').insert({ name: `U ${label} ${++seq}`, email: `u${seq}@rel.test`, password_hash: await bcrypt.hash('x', 4), role: 'employee' }))[0];

async function makeRequest(userId: number, status: 'QUEUED' | 'PROCESSING' = 'QUEUED', extra: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date();
  await db()('assistant_requests').insert({
    id, conversation_key: `simulator:c-${userId}:${userId}`, channel: 'simulator', conversation_id: `c-${userId}`, loop_user_id: userId,
    origin_message_id: `m-${id}`, intent: 'CREATE_TASK', data: JSON.stringify({ raw: { title: 'x' }, resolved: {} }), ambiguous: '[]',
    status, asked_field: null, ask_count: 0, confidence: 0.9, ai_meta: null, version: 0, created_at: now, updated_at: now,
    queue_expires_at: new Date(Date.now() + 3600_000), next_attempt_at: null, ...extra,
  });
  return id;
}

const okHandler = (intent: string, idempotent: boolean, calls: string[], delayMs = 0): ActionHandler => ({
  intent, idempotent, validate: () => [],
  execute: async (input) => { calls.push(input.requestId); if (delayMs) await new Promise((r) => setTimeout(r, delayMs)); return { summary: 'done' }; },
});
const registryWith = (h: ActionHandler) => { const r = new HandlerRegistry(); r.register(h); return r; };
const runDeps = (registry: HandlerRegistry, leaseSeconds = 60) => ({
  db: db(), registry, workerId: 'w-test', maxAttempts: 3, leaseSeconds, stillVerified: async () => true, enabled: true,
});
const processingCount = async (userId: number) =>
  Number((await db()('assistant_requests').where({ loop_user_id: userId, status: 'PROCESSING' }).count('* as n').first() as any).n);

before(async () => {
  await initDB();
  const d = db();
  for (const k of ['a', 'b', 'c', 'd', 'e', 'f']) {
    U[k] = (await d('users').insert({ name: `User ${k}`, email: `${k}@rel.test`, password_hash: await bcrypt.hash('Old-password-123', 4), role: 'employee' }))[0];
  }
});
after(async () => { await db().destroy(); });

// ── Per-employee limit, enforced by the database ──

test('one employee, many simultaneous claims: exactly one request runs, and the database refuses a second', async () => {
  const a = await fresh('a');
  for (let i = 0; i < 4; i++) await makeRequest(a);
  const claims = await Promise.all([1, 2, 3, 4].map(() => claimNext(db(), { workerId: 'w', nowMs: NOW(), leaseSeconds: 60 })));
  assert.equal(claims.filter(Boolean).length, 1, 'only one claim succeeds');
  assert.equal(await processingCount(a), 1);
  const other = await db()('assistant_requests').where({ loop_user_id: a, status: 'QUEUED' }).first('id');
  await assert.rejects(db()('assistant_requests').where({ id: other.id }).update({ status: 'PROCESSING' }), (e: any) => /UNIQUE/i.test(String(e.message)), 'database refuses it directly');
});

test('different employees proceed independently', async () => {
  const b = await fresh('b'), c = await fresh('c');
  await makeRequest(b); await makeRequest(c); await makeRequest(c);
  const claims = await Promise.all([1, 2, 3].map(() => claimNext(db(), { workerId: 'w', nowMs: NOW(), leaseSeconds: 60 })));
  const users = claims.filter(Boolean).map((c2) => c2!.loop_user_id);
  assert.equal(users.filter((u) => u === b).length, 1);
  assert.equal(users.filter((u) => u === c).length, 1, 'one per employee even with two waiting');
  assert.equal(new Set(users).size, users.length);
});

test('the key follows the state: cleared when a request leaves PROCESSING, so the employee can run the next one', async () => {
  const d = await fresh('d');
  await makeRequest(d);
  await makeRequest(d);
  const c1 = await claimNext(db(), { workerId: 'w', nowMs: NOW(), leaseSeconds: 60 });
  assert.equal(c1?.loop_user_id, d);
  await db()('assistant_requests').where({ id: c1!.id }).update({ status: 'COMPLETED' });
  const c2 = await claimNext(db(), { workerId: 'w', nowMs: NOW(), leaseSeconds: 60 });
  assert.equal(c2?.loop_user_id, d, 'second request runs once the first has ended');
});

// ── Lease renewal and recovery ──

test('lease renewal: a healthy run that outlives its lease keeps the claim and is not recovered', async () => {
  const id = await makeRequest(await fresh('e'));
  const calls: string[] = [];
  const reg = registryWith(okHandler('CREATE_TASK', true, calls, 1800));
  const run = runNext({ ...runDeps(reg, 1) });
  await new Promise((r) => setTimeout(r, 1300));
  const mid = await db()('assistant_requests').where({ id }).first('locked_until', 'status');
  assert.equal(mid.status, 'PROCESSING');
  assert.ok(new Date(mid.locked_until).getTime() > Date.now() - 200, 'lease was renewed while running');
  const recovered = await recoverInterrupted(db(), Date.now(), () => true, 3);
  assert.equal(recovered.requeued + recovered.failed, 0, 'a healthy run is never taken over');
  assert.equal((await run).outcome, 'completed');
  assert.equal(calls.length, 1);
});

test('restart recovery: an interrupted idempotent request is queued once more and runs once', async () => {
  const f = await fresh('f');
  const id = await makeRequest(f, 'QUEUED');
  await db()('assistant_requests').where({ id }).update({ status: 'PROCESSING', locked_by: 'dead-worker', locked_until: new Date(Date.now() - 60_000), execution_attempts: 1 });
  await db()('assistant_executions').insert({ id: randomUUID(), request_id: id, attempt: 1, idempotency_key: `assistant-request-${id}`, status: 'running', started_at: new Date() });
  const calls: string[] = [];
  const reg = registryWith(okHandler('CREATE_TASK', true, calls));
  const r = await recoverOnStartup({ db: db(), registry: reg, stillVerified: async () => true, settings: { workerId: 'w', maxAttempts: 3, leaseSeconds: 60, contextTtlSeconds: 1800, executionEnabled: true }, log: () => {} });
  assert.equal(r.requeued, 1);
  assert.equal((await runNext(runDeps(reg))).outcome, 'completed');
  assert.equal(calls.filter((c) => c === id).length, 1, 'ran exactly once');
  const again = await recoverOnStartup({ db: db(), registry: reg, stillVerified: async () => true, settings: { workerId: 'w', maxAttempts: 3, leaseSeconds: 60, contextTtlSeconds: 1800, executionEnabled: true }, log: () => {} });
  assert.equal(again.requeued + again.failed, 0, 'a second restart changes nothing');
});

test('restart recovery: an interrupted request whose operation is not safe to repeat is marked FAILED and never executed', async () => {
  const id = await makeRequest(await fresh('g'), 'QUEUED');
  await db()('assistant_requests').where({ id }).update({ status: 'PROCESSING', locked_until: new Date(Date.now() - 60_000) });
  const calls: string[] = [];
  const reg = registryWith(okHandler('CREATE_TASK', false, calls));
  const r = await recoverOnStartup({ db: db(), registry: reg, stillVerified: async () => true, settings: { workerId: 'w', maxAttempts: 3, leaseSeconds: 60, contextTtlSeconds: 1800, executionEnabled: true }, log: () => {} });
  assert.equal(r.failed, 1);
  assert.equal((await db()('assistant_requests').where({ id }).first('status')).status, 'FAILED');
  assert.equal(calls.includes(id), false, 'never executed');
});

test('expiry: a request past its queue window is expired and never executed', async () => {
  const id = await makeRequest(await fresh('h'), 'QUEUED', { queue_expires_at: new Date(Date.now() - 1000) });
  const n = await expireDue(db(), Date.now(), 1800);
  assert.ok(n >= 1);
  assert.equal((await db()('assistant_requests').where({ id }).first('status')).status, 'EXPIRED');
  const calls: string[] = [];
  assert.equal((await runNext(runDeps(registryWith(okHandler('CREATE_TASK', true, calls))))).outcome, 'idle');
  assert.equal(calls.includes(id), false);
});

// ── Configuration validation ──

test('invalid settings are reported by name and never reveal a secret value', () => {
  const env = { ASSISTANT_AI_TIMEOUT_MS: 'soon', ASSISTANT_AI_PROVIDER: 'openai', ASSISTANT_AI_API_KEY: 'sk-SECRET-VALUE-123' } as any;
  try { loadAssistantConfig(env); assert.fail('should have thrown'); } catch (e: any) {
    assert.ok(e instanceof AssistantConfigError);
    assert.ok(e.problems.some((p: string) => p.includes('ASSISTANT_AI_TIMEOUT_MS')));
    assert.ok(!String(e.message).includes('sk-SECRET-VALUE-123'), 'key never appears in the error');
    assert.ok(!e.problems.join(' ').includes('sk-SECRET-VALUE-123'));
  }
});

// ── First-login password change ──

test('a user who must change their password is refused everywhere except the change itself', async () => {
  const id = (await db()('users').insert({ name: 'Must Change', email: 'must@rel.test', password_hash: await bcrypt.hash('Temp-password-1', 4), role: 'employee', must_change_password: true }))[0];
  const token = require('jsonwebtoken').sign({ id, role: 'employee', email: 'must@rel.test', name: 'Must Change', pod: null, tv: 0 }, process.env.JWT_SECRET!, { algorithm: 'HS256' });
  const app = express();
  app.use(express.json());
  app.get('/api/probe', authenticate, (_req, res) => res.json({ ok: true }));
  app.post('/api/auth/change-password', authenticate, (_req, res) => res.json({ reached: true }));
  app.get('/api/auth/me', authenticate, (_req, res) => res.json({ reached: true }));
  const srv = app.listen(0);
  const port = (srv.address() as any).port;
  try {
    const blocked = await fetch(`http://127.0.0.1:${port}/api/probe`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(blocked.status, 403);
    assert.equal((await blocked.json()).code, 'PASSWORD_CHANGE_REQUIRED');
    const allowed = await fetch(`http://127.0.0.1:${port}/api/auth/change-password`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    assert.equal(allowed.status, 200);
  } finally { srv.close(); }
});

test('changing the password: needs the current one, enforces length, ends other sessions, and then the new password works', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  const srv = app.listen(0);
  const base = `http://127.0.0.1:${(srv.address() as any).port}/api/auth`;
  const post = (path: string, body: unknown, token?: string) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  try {
    const login = await post('/login', { email: 'must@rel.test', password: 'Temp-password-1' });
    const session = await login.json();
    assert.equal(session.must_change_password, true, 'login says a change is needed');
    const wrong = await post('/change-password', { current_password: 'nope', new_password: 'Brand-new-pass-1' }, session.token);
    assert.equal(wrong.status, 400, 'a wrong current password is not a lost session (401 would sign the user out)');
    const short = await post('/change-password', { current_password: 'Temp-password-1', new_password: 'short' }, session.token);
    assert.equal(short.status, 400);
    const ok = await post('/change-password', { current_password: 'Temp-password-1', new_password: 'Brand-new-pass-1' }, session.token);
    assert.equal(ok.status, 200);
    const fresh = (await ok.json()).token;
    const row = await db()('users').where({ email: 'must@rel.test' }).first();
    assert.equal(Boolean(row.must_change_password), false);
    const old = await post('/login', { email: 'must@rel.test', password: 'Temp-password-1' });
    assert.equal(old.status, 401, 'old password no longer works');
    const check = await fetch(`http://127.0.0.1:${(srv.address() as any).port}/api/auth/me`, { headers: { Authorization: `Bearer ${session.token}` } });
    assert.equal(check.status, 401, 'the session from before the change has ended');
    const now = await post('/login', { email: 'must@rel.test', password: 'Brand-new-pass-1' });
    assert.equal(now.status, 200);
    assert.equal((await now.json()).must_change_password, false);
    void fresh;
  } finally { srv.close(); }
});
