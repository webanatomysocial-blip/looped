/// <reference types="node" />
// Control Centre dashboard: AI usage accounting, employee linking status and the admin-only endpoints.
// Real router and in-memory database; a mock provider (no paid calls); nothing is sent to WhatsApp.
process.env.JWT_SECRET = 'test-secret';
process.env.SQLITE_FILE = ':memory:';
process.env.WHATSAPP_NOTIFICATION_GROUP_JID = '120363412745413406@g.us';
delete process.env.NODE_ENV;
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import { AddressInfo } from 'net';
import { initDB, getDB } from '../db';
import { createAssistantAdminRouter } from './adminApi';
import { HandlerRegistry } from './executor';
import { RecordingAIProvider, usageSummary } from './aiUsage';
import { listEmployeeLinking, linkEmployees } from './employeeLinking';
import { AIError, AIProvider } from './ai';
import { createLinkCode, verifyLinkCode } from './identityStore';

const db = () => getDB();
const U: Record<string, { id: number; role: string; name: string }> = {};
const ist = (s: string) => new Date(`${s}+05:30`);
let server: any; let base = '';

async function call(who: string | null, method: string, url: string, body?: any) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (who) headers.Authorization = 'Bearer ' + jwt.sign({ id: U[who].id, role: U[who].role, email: `${who}@d.test`, name: U[who].name }, 'test-secret', { algorithm: 'HS256' });
  const r = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}

// A provider that returns scripted usage, like the OpenAI usage fields
const scripted = (replies: ({ id?: string; input: number; output: number } | Error)[]): AIProvider => {
  let i = 0;
  return { name: 'openai', complete: async () => { const r = replies[i++]; if (r instanceof Error) throw r; return { id: r.id, text: '{}', model: 'gpt-5.4-nano', usage: { inputTokens: r.input, outputTokens: r.output } }; } };
};

before(async () => {
  await initDB();
  const mk = async (k: string, name: string, role: string) => { const [id] = await db()('users').insert({ name, role, email: `${k}@d.test`, password_hash: 'x' }); U[k] = { id: Number(id), role, name }; };
  await mk('admin', 'Asha Admin', 'admin');
  await mk('mgr', 'Mona Manager', 'manager');
  await mk('linked', 'Lina Linked', 'employee');
  await mk('pending', 'Pavan Pending', 'employee');
  await mk('failed', 'Farah Failed', 'employee');
  await mk('none', 'Nora None', 'employee');
  await mk('client', 'Cleo Client', 'client');
  await db()('assistant_identities').insert({ user_id: U.linked.id, channel: 'whatsapp', external_sender_id: 'lid:123456789', status: 'active', active_sender_key: 'whatsapp:lid:123456789', active_user_key: `${U.linked.id}:whatsapp`, linked_via: 'manual_lid', verified_at: new Date() });
  await createLinkCode(db(), { userId: U.pending.id, channel: 'whatsapp', phone: '+919000000002', createdBy: U.pending.id, via: 'self' });
  await createLinkCode(db(), { userId: U.failed.id, channel: 'whatsapp', phone: '+919000000003', createdBy: U.failed.id, via: 'self', now: new Date(Date.now() - 3_600_000) });
  const app = express(); app.use(express.json());
  app.use('/api/assistant-admin', createAssistantAdminRouter({ getDB, registry: new HandlerRegistry(), config: { ai: { provider: 'openai', model: 'gpt-5.4-nano' } } as any, whatsappStatus: () => ({ enabled: true, state: 'connected', account: '+91 •••• 1111' }), whatsappGroups: async () => [{ name: 'Loop Testing', jid: '120363412745413406@g.us' }] }));
  server = app.listen(0); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => { server?.closeAllConnections?.(); server?.close(); await db().destroy(); });

// ── AI usage ──

test('usage: actual input/output tokens are stored with their total, model and feature', async () => {
  const p = new RecordingAIProvider(scripted([{ id: 'resp_1', input: 120, output: 30 }]), getDB, () => ist('2026-11-16T10:00:00'));
  await p.complete({ system: 's', user: 'u', feature: 'group_question' });
  const row = await db()('assistant_ai_usage').where({ response_id: 'resp_1' }).first();
  assert.equal(row.input_tokens, 120); assert.equal(row.output_tokens, 30); assert.equal(row.total_tokens, 150);
  assert.equal(row.model, 'gpt-5.4-nano'); assert.equal(row.feature, 'group_question'); assert.ok(row.success);
});

test('usage: the same response is never counted twice; a retry after a failure is its own billed call', async () => {
  const p = new RecordingAIProvider(scripted([{ id: 'resp_1', input: 999, output: 999 }, new AIError('rate_limited', 'x', true), { id: 'resp_2', input: 50, output: 10 }]), getDB, () => ist('2026-11-16T11:00:00'));
  await p.complete({ system: 's', user: 'u' });                                 // replayed id: refused
  await assert.rejects(p.complete({ system: 's', user: 'u', feature: 'intent_classification' }));
  await p.complete({ system: 's', user: 'u', feature: 'intent_classification' });
  assert.equal((await db()('assistant_ai_usage').where({ response_id: 'resp_1' })).length, 1);
  const failed = await db()('assistant_ai_usage').where({ success: false }).first();
  assert.equal(failed.total_tokens, 0, 'a failed call reports no usage, so none is counted');
  assert.equal(failed.error_code, 'rate_limited');
  assert.equal(failed.feature, 'intent_classification');
  assert.equal((await db()('assistant_ai_usage').where({ response_id: 'resp_2' }).first()).total_tokens, 60);
  assert.equal((await db()('assistant_ai_usage').where({ response_id: 'resp_1' }).first()).total_tokens, 150, 'the first record is unchanged');
});

test('usage: an unknown feature is grouped as other; a recording failure never breaks the answer', async () => {
  const p = new RecordingAIProvider(scripted([{ input: 1, output: 1 }]), () => { throw new Error('db down'); });
  assert.equal((await p.complete({ system: 's', user: 'u', feature: 'made_up' })).text, '{}');
});

test('usage aggregation: today, last 7 days, this month and all time in IST; persisted rows are read back after a restart', async () => {
  await db()('assistant_ai_usage').insert([
    { provider: 'openai', model: 'gpt-5.4-nano', feature: 'clarification', input_tokens: 10, output_tokens: 5, total_tokens: 15, success: true, created_at: ist('2026-11-01T09:00:00') },
    { provider: 'openai', model: 'gpt-5.4-nano', feature: 'other', input_tokens: 100, output_tokens: 100, total_tokens: 200, success: true, created_at: ist('2026-10-31T23:30:00') },
    { provider: 'openai', model: 'gpt-5.4-nano', feature: 'group_question', input_tokens: 7, output_tokens: 3, total_tokens: 10, success: true, created_at: ist('2026-11-16T00:10:00') },
  ]);
  // A "restart": nothing is kept in memory, the summary is computed from the stored rows only
  const s = await usageSummary(db(), ist('2026-11-16T18:00:00'), 30);
  assert.equal(s.periods.today.total, 150 + 60 + 10, 'today: the three calls on 16 Nov IST');
  assert.equal(s.periods.today.failed, 1);
  assert.equal(s.periods.last_7_days.total, 220);
  assert.equal(s.periods.this_month.total, 235, '1 Nov counts; 31 Oct 23:30 IST is last month');
  assert.equal(s.periods.all_time.total, 435);
  assert.equal(s.totals.input, 120 + 50 + 10 + 100 + 7);
  assert.equal(s.totals.average_per_request, Math.round(s.totals.total / (s.totals.requests - s.totals.failed)));
  assert.equal(s.daily.length, 30);
  assert.equal(s.daily[s.daily.length - 1].date, '2026-11-16');
  assert.equal(s.daily.find((d) => d.date === '2026-11-01')!.total, 15);
  assert.equal(s.by_feature.find((f) => f.feature === 'group_question')!.total, 160);
  assert.equal(s.tracking_since, ist('2026-10-31T23:30:00').toISOString(), 'tracking starts at the first stored record');
  assert.deepEqual(s.models, ['gpt-5.4-nano']);
});

test('usage with no records: zeros and no tracking date, never invented history', async () => {
  const k = (await import('knex')).default({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  const { ensureUsageSchema } = await import('./aiUsage');
  await ensureUsageSchema(k);
  const empty = await usageSummary(k);
  await k.destroy();
  assert.equal(empty.tracking_since, null);
  assert.equal(empty.totals.total, 0);
});

// ── Employee linking ──

test('linking status: linked, pending, failed and identity mapping required; clients are not listed', async () => {
  const rows = await listEmployeeLinking(db());
  const by = (k: string) => rows.find((r) => r.user_id === U[k].id)!;
  assert.equal(by('linked').status, 'linked');
  assert.equal(by('linked').number, 'WhatsApp ID …6789', 'masked, never the full id');
  assert.equal(by('pending').status, 'pending');
  assert.equal(by('pending').number, '+91 •••• 0002');
  assert.equal(by('failed').status, 'failed');
  assert.equal(by('failed').detail, 'Verification expired');
  assert.equal(by('none').status, 'mapping_required');
  assert.ok(!rows.some((r) => r.user_id === U.client.id));
});

test('link selected: one or many employees; nothing is linked without a verified identity; every attempt is audited', async () => {
  const before = await db()('assistant_identities').count({ n: '*' }).first() as any;
  const res = await linkEmployees(db(), { userIds: [U.none.id, U.linked.id, U.pending.id, U.none.id, U.client.id], actorId: U.admin.id });
  assert.deepEqual(res.map((r) => r.outcome), ['mapping_required', 'already_linked', 'pending', 'not_eligible'], 'duplicates removed');
  const after = await db()('assistant_identities').count({ n: '*' }).first() as any;
  assert.equal(Number(after.n), Number(before.n), 'selecting an employee never creates an identity');
  const audit = await db()('assistant_admin_audit').where({ action: 'link_requested' });
  assert.equal(audit.length, 4);
  assert.ok(audit.some((a: any) => a.target === `user:${U.none.id}` && /mapping_required/.test(a.detail)));
});

test('failed linking and retry: a new code after expiry is pending again; a verified code turns it linked', async () => {
  const { code } = await createLinkCode(db(), { userId: U.failed.id, channel: 'whatsapp', phone: '+919000000003', createdBy: U.failed.id, via: 'self' });
  assert.equal((await listEmployeeLinking(db())).find((r) => r.user_id === U.failed.id)!.status, 'pending');
  const v = await verifyLinkCode(db(), { channel: 'whatsapp', rawSenderId: '919000000003@s.whatsapp.net', code });
  assert.ok(v.ok);
  assert.equal((await listEmployeeLinking(db())).find((r) => r.user_id === U.failed.id)!.status, 'linked');
});

test('five wrong codes: failed with the reason', async () => {
  await createLinkCode(db(), { userId: U.none.id, channel: 'whatsapp', phone: '+919000000009', createdBy: U.none.id, via: 'self' });
  for (let i = 0; i < 5; i++) await verifyLinkCode(db(), { channel: 'whatsapp', rawSenderId: '919000000009@s.whatsapp.net', code: 'AAAA-AAAA' });
  const row = (await listEmployeeLinking(db())).find((r) => r.user_id === U.none.id)!;
  assert.equal(row.status, 'failed'); assert.equal(row.detail, 'Too many wrong codes');
});

// ── Endpoints and permissions ──

test('permissions: only admins reach the dashboard, usage and linking endpoints', async () => {
  for (const url of ['/api/assistant-admin/overview', '/api/assistant-admin/usage', '/api/assistant-admin/linking']) {
    assert.equal((await call(null, 'GET', url)).status, 401);
    assert.equal((await call('mgr', 'GET', url)).status, 403);
    assert.equal((await call('linked', 'GET', url)).status, 403);
    assert.equal((await call('admin', 'GET', url)).status, 200);
  }
  assert.equal((await call('linked', 'POST', '/api/assistant-admin/linking/link', { user_ids: [U.none.id] })).status, 403);
  assert.equal((await call('admin', 'POST', '/api/assistant-admin/linking/link', { user_ids: [] })).status, 400);
  const ok = await call('admin', 'POST', '/api/assistant-admin/linking/link', { user_ids: [U.mgr.id] });
  assert.equal(ok.body.results[0].outcome, 'mapping_required');
});

test('overview: WhatsApp, linking counts, usage and recent activity; no secrets or full numbers', async () => {
  await db()('whatsapp_outbox').insert({ event_key: 'ov:1', kind: 'assigned', task_id: 1, payload: JSON.stringify({ text: 'SECRET TEXT', mentions: ['919999999999@s.whatsapp.net'] }), status: 'sent', attempts: 1, next_attempt_at: new Date() });
  const { body } = await call('admin', 'GET', '/api/assistant-admin/overview');
  assert.equal(body.whatsapp.state, 'connected');
  assert.equal(body.whatsapp.group_name, 'Loop Testing');
  assert.equal(body.model, 'gpt-5.4-nano');
  assert.equal(body.linking.linked, 2);
  assert.equal(body.linking.unlinked, body.linking.total - 2, "seeded demo staff are counted too");
  assert.ok(body.usage.totals.total > 0);
  assert.equal(body.recent.notifications[0].kind, 'assigned');
  const raw = JSON.stringify(body);
  assert.ok(!/SECRET TEXT|919999999999|120363412745413406|123456789|apiKey|api_key/.test(raw), 'no message text, numbers, group id or keys');
});

// ── QR pairing endpoints ──

test('pairing endpoint: admins only, never cached, QR image only while the connection waits for one; new rounds only when stopped', async () => {
  const wa: any = { enabled: true, state: 'awaiting_qr', account: null };
  const app = express(); app.use(express.json());
  let newRounds = 0;
  app.use('/api/assistant-admin', createAssistantAdminRouter({
    getDB, registry: new HandlerRegistry(), config: null, whatsappStatus: () => wa,
    whatsappPairing: () => (wa.state === 'awaiting_qr' ? { qr: 'SECRET-QR-PAYLOAD', issuedAt: new Date().toISOString() } : null),
    whatsappNewPairing: () => { newRounds++; return true; },
    renderQr: async (qr) => `data:image/svg+xml;base64,${Buffer.from(`<svg>${qr.length}</svg>`).toString('base64')}`,
  }));
  const s2 = app.listen(0); const b2 = `http://127.0.0.1:${(s2.address() as AddressInfo).port}`;
  const tok = (k: string) => 'Bearer ' + jwt.sign({ id: U[k].id, role: U[k].role, email: `${k}@d.test`, name: U[k].name }, 'test-secret', { algorithm: 'HS256' });
  const get = (k: string | null) => fetch(`${b2}/api/assistant-admin/whatsapp/pairing`, { headers: k ? { Authorization: tok(k) } : {} });
  const post = (k: string) => fetch(`${b2}/api/assistant-admin/whatsapp/pairing/refresh`, { method: 'POST', headers: { Authorization: tok(k) } });
  try {
    assert.equal((await get(null)).status, 401);
    assert.equal((await get('mgr')).status, 403);
    assert.equal((await get('linked')).status, 403);
    assert.equal((await post('linked')).status, 403, 'an employee cannot start pairing');
    const r = await get('admin');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const body: any = await r.json();
    assert.equal(body.state, 'awaiting_qr');
    assert.equal(body.qr.render, 'ok');
    assert.match(body.qr.image, /^data:image\/svg\+xml;base64,/);
    assert.ok(!JSON.stringify(body).includes('SECRET-QR-PAYLOAD'), 'only the image is sent, never the raw payload');
    assert.ok(Date.parse(body.qr.expires_at) > Date.parse(body.qr.issued_at));
    assert.equal(body.can_request_new, false);
    assert.equal((await post('admin')).status, 409, 'no new round while a code is being issued');
    wa.state = 'connected';
    assert.equal(((await (await get('admin')).json()) as any).qr, null, 'no code once connected');
    assert.equal((await post('admin')).status, 409);
    wa.state = 'logged_out';
    assert.equal(((await (await get('admin')).json()) as any).can_request_new, true);
    assert.equal((await post('admin')).status, 200);
    assert.equal(newRounds, 1);
    assert.ok(await db()('assistant_admin_audit').where({ action: 'whatsapp_pairing_requested' }).first());
  } finally { s2.closeAllConnections?.(); s2.close(); }
});

test('pairing endpoint without the qrcode package: says the image is unavailable instead of sending the payload', async () => {
  const app = express(); app.use(express.json());
  app.use('/api/assistant-admin', createAssistantAdminRouter({ getDB, registry: new HandlerRegistry(), config: null, whatsappStatus: () => ({ enabled: true, state: 'awaiting_qr' }), whatsappPairing: () => ({ qr: 'RAW', issuedAt: new Date().toISOString() }), renderQr: async () => null }));
  const s2 = app.listen(0);
  try {
    const r = await fetch(`http://127.0.0.1:${(s2.address() as AddressInfo).port}/api/assistant-admin/whatsapp/pairing`, { headers: { Authorization: 'Bearer ' + jwt.sign({ id: U.admin.id, role: 'admin', email: 'admin@d.test', name: 'A' }, 'test-secret', { algorithm: 'HS256' }) } });
    const body: any = await r.json();
    assert.equal(body.qr.render, 'unavailable');
    assert.equal(body.qr.image, null);
    assert.ok(!JSON.stringify(body).includes('RAW'));
  } finally { s2.closeAllConnections?.(); s2.close(); }
});
