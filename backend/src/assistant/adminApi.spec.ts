/// <reference types="node" />
// Phase 4.5 admin API tests: real router, real database (in-memory), real tokens. Admin-only, masked, audited.
process.env.JWT_SECRET = 'test-secret';
process.env.SQLITE_FILE = ':memory:';
delete process.env.NODE_ENV;

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import { Knex } from 'knex';
import { initDB, getDB } from '../db';
import { AddressInfo } from 'net';
import { createAssistantAdminRouter, maskPhone, maskText } from './adminApi';
import { HandlerRegistry, ActionHandler } from './executor';
import { loadAssistantConfig } from './config';

let db: Knex;
let server: any;
let base = '';
const U: Record<string, any> = {};
const registry = new HandlerRegistry();

const NOW = Date.parse('2026-11-12T10:00:00Z');
const isoAt = (ms: number) => new Date(ms);

async function call(who: string | null, method: string, url: string, body?: any) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (who) {
    const u = U[who];
    headers.Authorization = 'Bearer ' + jwt.sign({ id: u.id, role: u.role, email: u.email, name: u.name }, 'test-secret', { algorithm: 'HS256' });
  }
  const r = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, body: json, raw: text };
}

let seq = 0;
async function request(over: any) {
  seq++;
  const id = `req-${seq}`;
  await db('assistant_requests').insert({
    id, conversation_key: over.key ?? 'simulator:g1:1', loop_user_id: over.user, channel: 'simulator', conversation_id: over.conv ?? 'g1',
    origin_message_id: 'm' + seq, intent: over.intent ?? 'CREATE_TASK', data: JSON.stringify(over.data ?? { raw: { title: 'Homepage' }, resolved: {} }),
    status: over.status, ask_count: 0, version: 0, priority: over.priority ?? 100, failure_kind: over.failure ?? null, error: over.error ?? null,
    execution_attempts: over.attempts ?? 0, confidence: 0.9,
    created_at: isoAt(over.at ?? NOW), updated_at: isoAt(over.at ?? NOW), confirm_code: over.code ?? null,
  });
  return id;
}

before(async () => {
  await initDB();
  db = getDB();
  const mk = async (k: string, name: string, role: string) => { const [id] = await db('users').insert({ name, role, email: `${k}@a.test`, password_hash: 'x' }); U[k] = { id, role, email: `${k}@a.test`, name }; };
  await mk('admin', 'Asha Admin', 'admin');
  await mk('mgr', 'Mona Manager', 'manager');
  await mk('priya', 'Priya Rao', 'employee');
  await mk('sam', 'Sam Lee', 'employee');
  await mk('rahul1', 'Rahul Mehta', 'employee');
  await mk('rahul2', 'Rahul Sharma', 'employee');

  // Priya: a verified WhatsApp number (stored as a sender id; the admin view must mask it)
  await db('assistant_identities').insert({ user_id: U.priya.id, channel: 'whatsapp', external_sender_id: '+919876543210', status: 'active', active_sender_key: 'whatsapp:+919876543210', active_user_key: `${U.priya.id}:whatsapp`, linked_via: 'self', verified_at: isoAt(NOW) });

  await request({ user: U.priya.id, status: 'READY_FOR_CONFIRMATION', key: `simulator:g1:${U.priya.id}`, code: 'ABCDE', at: NOW });
  await request({ user: U.priya.id, status: 'NEEDS_CLARIFICATION', key: `simulator:g1:${U.priya.id}`, at: NOW + 60000 });
  await request({ user: U.priya.id, status: 'COMPLETED', key: `simulator:g1:${U.priya.id}`, at: NOW - 3600000 });
  await request({ user: U.sam.id, status: 'QUEUED', key: `simulator:g2:${U.sam.id}`, conv: 'g2', priority: 50, intent: 'APPROVE_TASK', at: NOW + 120000 });
  const failedRetryable = await request({ user: U.sam.id, status: 'FAILED', failure: 'retries_exhausted', attempts: 3, key: `simulator:g2:${U.sam.id}`, conv: 'g2', error: 'upstream busy for +919811112222', at: NOW + 180000 });
  await request({ user: U.sam.id, status: 'FAILED', failure: 'terminal', attempts: 1, key: `simulator:g2:${U.sam.id}`, conv: 'g2', intent: 'APPROVE_TASK', error: 'project archived', at: NOW + 240000 });
  for (let i = 1; i <= 3; i++) await db('assistant_executions').insert({ id: 'ex-' + i, request_id: failedRetryable, attempt: i, idempotency_key: 'k', status: 'failed_transient', error: 'busy', started_at: isoAt(NOW), finished_at: isoAt(NOW) });

  // Conversation turns: Priya's message contains a phone number; Sam's must never appear in Priya's view
  await db('assistant_conversation_log').insert([
    { conversation_key: `simulator:g1:${U.priya.id}`, role: 'employee', text: 'Create a task, call me on +919876543210', request_id: 'req-1', created_at: isoAt(NOW) },
    { conversation_key: `simulator:g1:${U.priya.id}`, role: 'assistant', text: 'What is the title?', request_id: 'req-1', created_at: isoAt(NOW + 1000) },
    { conversation_key: `simulator:g2:${U.sam.id}`, role: 'employee', text: 'secret sam message', created_at: isoAt(NOW) },
  ]);
  await db('assistant_request_events').insert([
    { request_id: 'req-1', conversation_key: 'simulator:g1:1', loop_user_id: U.priya.id, event: 'confirmed', from_state: 'READY_FOR_CONFIRMATION', to_state: 'CONFIRMED', detail: 'by employee', created_at: isoAt(NOW) },
  ]);

  registry.register({ intent: 'CREATE_TASK', idempotent: true, validate: () => [], execute: async () => ({ summary: 'mock' }) } as ActionHandler);
  const config = loadAssistantConfig({ OPENAI_API_KEY: 'sk-live-secret-value', ASSISTANT_AI_PROVIDER: 'openai' });
  const app = express();
  app.use(express.json());
  app.use('/api/assistant-admin', createAssistantAdminRouter({ getDB: () => db, registry, config, now: () => NOW + 300000 }));
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/assistant-admin`;
});
after(async () => { server?.close(); await db.destroy(); });

// ── Access control ──
test('every endpoint refuses anonymous callers and employees; managers get the dashboard (QR pairing is tested separately)', async () => {
  const paths: [string, string][] = [['GET', '/dashboard'], ['GET', '/queue'], ['GET', '/requests'], ['GET', '/requests/req-1'], ['GET', '/identities'], ['GET', '/failures'], ['GET', '/audit'], ['GET', '/config'], ['POST', '/failures/req-5/retry'], ['POST', '/identities/1/revoke']];
  for (const [m, p] of paths) {
    assert.equal((await call(null, m, p)).status, 401, 'anonymous ' + p);
    assert.equal((await call('priya', m, p)).status, 403, 'employee ' + p);
    // Managers can read the dashboard; the POST actions below run for real, so they are checked for employees only
    if (m === 'GET') assert.equal((await call('mgr', m, p)).status, 200, 'manager ' + p);
  }
});

test('the admin audit and request events cannot be edited or deleted through this interface', async () => {
  assert.equal((await call('admin', 'PUT', '/audit/1', {})).status, 404);
  assert.equal((await call('admin', 'DELETE', '/audit/1')).status, 404);
});

// ── Dashboard: counts come from the database ──
test('dashboard counts match the database rows exactly', async () => {
  const dash = (await call('admin', 'GET', '/dashboard')).body;
  const rows = await db('assistant_requests').select('status').count('* as n').groupBy('status');
  const byStatus = Object.fromEntries(rows.map((r: any) => [r.status, Number(r.n)]));
  assert.equal(dash.total, Object.values(byStatus).reduce((a: number, b: any) => a + b, 0));
  assert.equal(dash.cards.awaiting_confirmation, byStatus.READY_FOR_CONFIRMATION);
  assert.equal(dash.cards.awaiting_clarification, byStatus.NEEDS_CLARIFICATION);
  assert.equal(dash.cards.failed, byStatus.FAILED);
  assert.equal(dash.cards.completed, byStatus.COMPLETED);
});

test('dashboard date filter narrows the counts', async () => {
  const all = (await call('admin', 'GET', '/dashboard')).body.total;
  const recent = (await call('admin', 'GET', `/dashboard?from=${encodeURIComponent(new Date(NOW).toISOString())}`)).body.total;
  assert.ok(recent < all, 'older requests are excluded');
});

// ── Lists, search and filters ──
test('request list: status and intent filters, employee search and pagination', async () => {
  const failed = (await call('admin', 'GET', '/requests?status=FAILED')).body;
  assert.equal(failed.total, 2);
  assert.ok(failed.items.every((i: any) => i.status === 'FAILED'));
  const approvals = (await call('admin', 'GET', '/requests?intent=APPROVE_TASK')).body;
  assert.ok(approvals.items.every((i: any) => i.intent === 'APPROVE_TASK'));
  const sam = (await call('admin', 'GET', '/requests?q=sam')).body;
  assert.ok(sam.items.length >= 3 && sam.items.every((i: any) => i.employee === 'Sam Lee'));
  const page = (await call('admin', 'GET', '/requests?limit=2&page=2')).body;
  assert.equal(page.items.length, 2);
  assert.equal(page.total, (await call('admin', 'GET', '/requests')).body.total);
});

test('queue shows only requests waiting or running, highest priority first', async () => {
  const q = (await call('admin', 'GET', '/queue')).body;
  assert.ok(q.every((i: any) => ['READY_FOR_CONFIRMATION', 'CONFIRMED', 'QUEUED', 'PROCESSING'].includes(i.status)));
  assert.equal(q[0].intent, 'APPROVE_TASK', 'priority 50 comes first');
});

// ── Request detail: message, entities, timeline, masking ──
test('request detail shows the timeline, attempts and retry status, with phone numbers masked', async () => {
  const d = (await call('admin', 'GET', '/requests/req-1')).body;
  assert.equal(d.status, 'READY_FOR_CONFIRMATION');
  assert.equal(d.extracted.title, 'Homepage');
  assert.ok(d.timeline.some((t: any) => t.event === 'confirmed'));
  assert.ok(d.conversation.some((t: any) => t.text.includes('+91 •••• 3210')), 'number masked in the message');
  assert.ok(!JSON.stringify(d).includes('9876543210'), 'full number never returned');
  assert.equal(d.confirmation.status, 'awaiting');
  assert.ok(!JSON.stringify(d).includes('ABCDE'), 'confirmation codes are not shown to administrators');
  assert.equal((await call('admin', 'GET', '/requests/does-not-exist')).status, 404);
});

test('the failure reason in request detail is masked too', async () => {
  const d = (await call('admin', 'GET', '/requests/req-5')).body;
  assert.ok(d.failure && d.failure.last_error.includes('+91 •••• 2222'));
  assert.ok(!JSON.stringify(d).includes('9811112222'));
});

test('retry eligibility is shown with its reason', async () => {
  const retryable = (await call('admin', 'GET', '/requests/req-5')).body;
  assert.equal(retryable.retry.eligible, true);
  const terminal = (await call('admin', 'GET', '/requests/req-6')).body;
  assert.equal(terminal.retry.eligible, false);
  assert.match(terminal.retry.reason, /cannot be fixed|not safe|terminal/);
});

// ── Conversations and WhatsApp activity are not served to anyone ──
test('conversation and WhatsApp activity endpoints are gone', async () => {
  for (const p of ['/conversations', `/conversations/messages?key=${encodeURIComponent(`simulator:g1:${U.priya.id}`)}`, '/whatsapp/activity']) {
    const res = await call('admin', 'GET', p);
    assert.equal(res.status, 404, p);
    assert.ok(!JSON.stringify(res.body ?? '').includes('secret sam message'));
  }
});

// ── Identities: masked, no secrets, revocable ──
test('identity list masks the number and exposes no codes or secrets', async () => {
  const list = (await call('admin', 'GET', '/identities')).body;
  const mine = list.find((i: any) => i.employee === 'Priya Rao');
  assert.equal(mine.number, maskPhone('+919876543210'));
  assert.equal(mine.status, 'active');
  const raw = JSON.stringify(list);
  assert.ok(!raw.includes('9876543210') && !raw.includes('active_sender_key') && !raw.includes('code_hash'));
});

test('revoking an identity: a manager can do it like an admin; it takes effect and is audited', async () => {
  const id = (await db('assistant_identities').where({ user_id: U.priya.id }).first()).id;
  assert.equal((await call('priya', 'POST', `/identities/${id}/revoke`)).status, 403, 'employees cannot');
  assert.equal((await call('mgr', 'POST', `/identities/${id}/revoke`)).status, 200, 'managers can');
  const row = await db('assistant_identities').where({ id }).first();
  assert.equal(row.status, 'revoked');
  assert.equal(row.active_sender_key, null, 'a revoked number stops resolving');
  const audit = (await call('admin', 'GET', '/audit?source=admin')).body.items;
  assert.ok(audit.some((a: any) => a.action === 'identity_revoked' && a.actor === 'Mona Manager'));
  assert.equal((await call('admin', 'POST', `/identities/${id}/revoke`)).status, 409, 'already revoked');
});

// ── Failures and safe retry ──
test('retry runs only when the executor allows it; a terminal failure cannot be retried', async () => {
  assert.equal((await call('priya', 'POST', '/failures/req-5/retry')).status, 403);
  assert.equal((await call('admin', 'POST', '/failures/req-6/retry')).status, 409);
  assert.equal((await db('assistant_requests').where({ id: 'req-6' }).first()).status, 'FAILED');
  const ok = await call('admin', 'POST', '/failures/req-5/retry');
  assert.equal(ok.status, 200);
  assert.equal((await db('assistant_requests').where({ id: 'req-5' }).first()).status, 'QUEUED');
  const audit = (await call('admin', 'GET', '/audit?source=admin')).body.items;
  assert.ok(audit.some((a: any) => a.action === 'request_retry' && a.target === 'req-5'));
  const timeline = (await db('assistant_request_events').where({ request_id: 'req-5', event: 'admin_retry' })).length;
  assert.equal(timeline, 1);
  assert.equal((await call('admin', 'POST', '/failures/req-5/retry')).status, 409, 'no duplicate retry');
});

test('a failure with no registered handler cannot be retried', async () => {
  const id = await request({ user: U.sam.id, status: 'FAILED', failure: 'retries_exhausted', attempts: 3, intent: 'ASSIGN_TASK', key: `simulator:g2:${U.sam.id}`, conv: 'g2', at: NOW });
  assert.equal((await call('admin', 'POST', `/failures/${id}/retry`)).status, 409);
});

test('failures list shows the reason with no phone numbers, and whether retry is allowed', async () => {
  const list = (await call('admin', 'GET', '/failures')).body;
  assert.ok(list.length >= 1);
  assert.ok(!JSON.stringify(list).includes('9811112222'));
  assert.ok(list.every((f: any) => typeof f.retry_eligible === 'boolean'));
});

// ── Configuration: read-only, no secrets, no live calls ──
test('configuration shows provider, model and timezone, never the key', async () => {
  const c = (await call('admin', 'GET', '/config')).body;
  assert.equal(c.provider, 'openai');
  assert.equal(c.model, 'gpt-5.4-nano');
  assert.equal(c.timezone, 'Asia/Kolkata');
  assert.equal(c.execution_enabled, false);
  assert.equal(c.api_key_configured, true);
  assert.ok(!(await call('admin', 'GET', '/config')).raw.includes('sk-live-secret-value'));
  assert.equal(c.worker_running, false);
});

// ── Audit trail: searchable, read-only ──
test('audit: request events are searchable and the admin trail is readable', async () => {
  const ev = (await call('admin', 'GET', '/audit?event=confirmed')).body.items;
  assert.ok(ev.length >= 1 && ev.every((e: any) => e.event === 'confirmed'));
  assert.ok(!JSON.stringify(ev).includes('9876543210'));
});

// ── Masking helpers ──
test('confirmation codes are hidden in any text shown to administrators', () => {
  assert.equal(maskText('Reply CONFIRM ABCDE to proceed'), 'Reply CONFIRM ••••• to proceed');
  assert.equal(maskText('or CANCEL ABCDE.'), 'or CANCEL •••••.');
});

test('masking helpers hide all but the last four digits', () => {
  assert.equal(maskPhone('+919876543210'), '+91 •••• 3210');
  assert.equal(maskText('call +919876543210 now'), 'call +91 •••• 3210 now');
  assert.equal(maskPhone(null), '');
});
