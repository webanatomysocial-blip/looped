// Phase 4.5: admin-only API for the AI Assistant Control Centre. Reads come from the assistant tables; the only
// writes are retry (executor-approved) and identity revocation (Phase 2 service). Every write is audited.
import { Router, Response, NextFunction } from 'express';
import { Knex } from 'knex';
import { authenticate, requireRoles, AuthRequest } from '../middleware/auth';
import { HandlerRegistry } from './executor';
import { transition, StateConflict } from './requestStore';
import { setIdentityStatus, IdentityError, STAFF_ROLES } from './identityStore';
import { PendingError, listPendingSenders, approvePendingSender, dismissPendingSender } from './pendingSenders';
import { AssistantConfig } from './config';
import { STATES } from './lifecycle';
import { usageSummary } from './aiUsage';
import { saveAiKey, validAiKey, saveNotificationGroup } from './settingsStore';
import { listEmployeeLinking, linkEmployees, saveEmployeePhone, directLinkEmployee } from './employeeLinking';
import { notificationGroupJid, setChosenNotificationGroup, GROUP_JID, queueAssignmentNotice } from '../services/assignmentNotices';

export const maskPhone = (e164: string | null | undefined) => (e164 ? `${e164.slice(0, 3)} •••• ${e164.slice(-4)}` : '');
// Phone numbers inside free text (messages, errors) are masked too
// Confirmation codes (CONFIRM / CANCEL <code>) are hidden too: they are the employee's approval handle
export const maskText = (t: string | null | undefined) => (t ?? '').replace(/\b(CONFIRM|CANCEL)\s+[A-Za-z2-9]{5}\b/gi, (_m, w) => `${w} •••••`).replace(/\+?\d{8,15}/g, (m) => maskPhone(m.startsWith('+') ? m : '+' + m));

const parse = (v: any, fb: any) => { if (v == null) return fb; if (typeof v === 'string') { try { return JSON.parse(v); } catch { return fb; } } return v; };
const toDate = (s: unknown) => { const d = typeof s === 'string' ? new Date(s) : null; return d && !Number.isNaN(d.getTime()) ? d : null; };
const clampInt = (v: unknown, dflt: number, max: number) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? Math.min(n, max) : dflt; };

// Baileys refreshes the code about every 20 seconds; after a minute without a new one it is treated as expired on screen
const QR_LIFETIME_MS = 60_000;
// SVG image of the pairing code, made on the server. Needs the "qrcode" package; without it the page says so.
async function renderQrSvg(qr: string): Promise<string | null> {
  let lib: any;
  try { lib = require('qrcode'); } catch { return null; }
  const svg: string = await lib.toString(qr, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, width: 264 });
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

export interface AdminApiDeps {
  getDB: () => Knex;
  registry: HandlerRegistry;
  // The live configuration (a function, so a key saved from the dashboard is reflected without a restart)
  config: AssistantConfig | null | (() => AssistantConfig | null);
  setup?: () => { problems: string[]; whatsappProblems?: string[]; nodeEnv: string; settingsFileLoaded: boolean };
  whatsappStart?: () => Promise<{ ok: boolean; problems: string[] }>;
  onAiKeySaved?: (key: string) => Promise<{ running: boolean; problems: string[] }>;
  now?: () => number;
  whatsappStatus?: () => unknown | Promise<unknown>;
  whatsappGroups?: () => Promise<{ name: string; jid: string }[]>;
  whatsappPairing?: () => { qr: string; issuedAt: string } | null | Promise<{ qr: string; issuedAt: string } | null>;
  whatsappNewPairing?: () => boolean;
  renderQr?: (qr: string) => Promise<string | null>;
}

// Retry is offered only when the executor's own rules say it is safe
export async function retryEligibility(db: Knex, registry: HandlerRegistry, row: any): Promise<{ eligible: boolean; reason: string }> {
  if (row.status !== 'FAILED') return { eligible: false, reason: 'not failed' };
  if (row.failure_kind !== 'retries_exhausted') return { eligible: false, reason: 'terminal failure: a retry would not change the outcome' };
  if (row.failure_kind === 'identity' || row.failure_kind === 'invalid_request' || row.failure_kind === 'no_handler') return { eligible: false, reason: 'failure cannot be fixed by retrying' };
  if (!registry.canRetry(row.intent)) return { eligible: false, reason: 'the action is not safe to repeat' };
  const done = await db('assistant_executions').where({ request_id: row.id, status: 'succeeded' }).first('id');
  if (done) return { eligible: false, reason: 'an attempt already succeeded' };
  return { eligible: true, reason: 'safe to retry' };
}

async function audit(db: Knex, actorId: number, action: string, target: string, detail: string, nowMs: number) {
  await db('assistant_admin_audit').insert({ actor_id: actorId, action, target: target.slice(0, 80), detail: detail.slice(0, 300), created_at: new Date(nowMs) });
}

export function createAssistantAdminRouter(d: AdminApiDeps): Router {
  const r = Router();
  const cfg = (): AssistantConfig | null => (typeof d.config === 'function' ? d.config() : d.config);
  const now = () => (d.now ? d.now() : Date.now());
  let groupNameCache: { jid: string; name: string; at: number } | null = null;
  // Every route in this router is admin-only, checked on the server
  // Admins and managers: the whole dashboard, including linking numbers and WhatsApp pairing
  r.use(authenticate, requireRoles('admin', 'manager'));
  // Dashboard data changes with every action: never let a browser or proxy serve an old copy
  r.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const wrap = (fn: (req: AuthRequest, res: Response) => Promise<unknown>) => async (req: AuthRequest, res: Response, _n: NextFunction) => {
    try { const out = await fn(req, res); if (!res.headersSent) res.json(out); }
    catch (e: any) {
      if (e instanceof StateConflict) return res.status(409).json({ error: 'This request changed while you were looking at it. Refresh and try again.' });
      if (e instanceof IdentityError) return res.status(e.code === 'not_found' ? 404 : 409).json({ error: e.message });
      if (e instanceof PendingError) {
        const status = e.code === 'not_found' ? 404 : e.code === 'expired' ? 410 : ['not_pending', 'sender_taken', 'user_has_active_link'].includes(e.code) ? 409 : 400;
        return res.status(status).json({ error: e.message });
      }
      console.error('[assistant-admin]', e?.message);
      res.status(500).json({ error: 'Server error' });
    }
  };

  // ── Dashboard ──
  r.get('/dashboard', wrap(async (req) => {
    const db = d.getDB();
    const from = toDate(req.query.from), to = toDate(req.query.to);
    const q = db('assistant_requests');
    if (from) q.where('created_at', '>=', from);
    if (to) q.where('created_at', '<=', to);
    const rows = await q.select('status').count('* as n').groupBy('status');
    const counts: Record<string, number> = Object.fromEntries(STATES.map((s) => [s, 0]));
    let total = 0;
    for (const row of rows) { counts[row.status] = Number(row.n); total += Number(row.n); }
    return {
      total,
      cards: {
        awaiting_clarification: counts.NEEDS_CLARIFICATION,
        awaiting_confirmation: counts.READY_FOR_CONFIRMATION,
        queued: counts.QUEUED + counts.CONFIRMED,
        processing: counts.PROCESSING,
        completed: counts.COMPLETED,
        failed: counts.FAILED,
        cancelled_or_expired: counts.CANCELLED + counts.EXPIRED,
      },
      by_status: counts,
    };
  }));

  // ── Overview: WhatsApp, linking, AI usage and recent activity in one read. No AI calls, no secrets. ──
  r.get('/overview', wrap(async () => {
    const db = d.getDB();
    const nowDate = new Date(now());
    const linking = await listEmployeeLinking(db, nowDate);
    const count = (s: string) => linking.filter((l) => l.status === s).length;
    const pendingSenders = Number((await db('assistant_pending_senders').where({ status: 'pending' }).count({ n: '*' }).first() as any)?.n ?? 0);
    const usage = await usageSummary(db, nowDate, 14);
    const totalRequests = Number((await db('assistant_requests').count({ n: '*' }).first() as any)?.n ?? 0);
    const wa: any = (await d.whatsappStatus?.()) ?? { enabled: false, state: 'stopped' };
    const jid = notificationGroupJid();
    // The group name needs a query to WhatsApp's servers: cached for 10 minutes so dashboard refreshes don't repeat it
    let groupName: string | null = groupNameCache && groupNameCache.jid === jid && now() - groupNameCache.at < 600_000 ? groupNameCache.name : null;
    if (jid && groupName === null && d.whatsappGroups) {
      try { groupName = (await d.whatsappGroups()).find((g) => g.jid === jid)?.name ?? null; } catch { groupName = null; }
      if (groupName) groupNameCache = { jid, name: groupName, at: now() };
    }
    const recentRequests = await db('assistant_requests as ar').leftJoin('users as u', 'u.id', 'ar.loop_user_id')
      .select('ar.id', 'ar.intent', 'ar.status', 'ar.created_at', 'u.name as employee').orderBy('ar.created_at', 'desc').limit(5);
    const recentLinking = await db('assistant_admin_audit as a').leftJoin('users as u', 'u.id', 'a.actor_id')
      .whereIn('a.action', ['link_requested', 'identity_revoked', 'pending_sender_approved', 'pending_sender_dismissed'])
      .select('a.id', 'a.action', 'a.target', 'a.detail', 'a.created_at', 'u.name as actor').orderBy('a.id', 'desc').limit(5);
    // Notification kinds and delivery state only; message text stays in the outbox
    const recentNotices = await db('whatsapp_outbox').select('id', 'kind', 'status', 'attempts', 'created_at', 'sent_at').orderBy('id', 'desc').limit(5);
    const recentFailures = await db('assistant_requests as ar').leftJoin('users as u', 'u.id', 'ar.loop_user_id').where('ar.status', 'FAILED')
      .select('ar.id', 'ar.intent', 'ar.failure_kind', 'ar.updated_at', 'u.name as employee').orderBy('ar.updated_at', 'desc').limit(5);
    return {
      whatsapp: {
        state: wa.state ?? 'stopped', enabled: !!wa.enabled, account: wa.account ? maskText(String(wa.account)) : null,
        last_connected_at: wa.lastConnectedAt ?? null, group_configured: !!jid, group_name: groupName,
      },
      linking: { total: linking.length, linked: count('linked'), unlinked: linking.length - count('linked'), pending: count('pending') + pendingSenders, failed: count('failed') },
      requests: { total: totalRequests },
      usage,
      model: cfg()?.ai.model ?? null,
      recent: {
        requests: recentRequests,
        linking: recentLinking.map((x: any) => ({ ...x, detail: maskText(x.detail) })),
        notifications: recentNotices,
        failures: recentFailures,
      },
    };
  }));

  r.get('/usage', wrap(async (req) => ({ ...(await usageSummary(d.getDB(), new Date(now()), clampInt(req.query.days, 30, 90))), model: cfg()?.ai.model ?? null })));

  // ── Employee WhatsApp linking (existing identity system; selecting someone is never proof) ──
  r.get('/linking', wrap(async () => listEmployeeLinking(d.getDB(), new Date(now()))));
  // Saving a mobile number links the employee's WhatsApp to it directly (audited)
  r.put('/linking/:userId/phone', wrap(async (req) => {
    const id = Number(req.params.userId);
    if (!Number.isInteger(id)) throw new IdentityError('not_found', 'Staff member not found');
    return { ok: true, ...(await saveEmployeePhone(d.getDB(), { userId: id, phone: req.body?.phone, actorId: req.user!.id, now: new Date(now()) })) };
  }));
  // Link the employee's WhatsApp to the number entered (audited)
  r.post('/linking/:userId/direct-link', wrap(async (req) => {
    const id = Number(req.params.userId);
    if (!Number.isInteger(id)) throw new IdentityError('not_found', 'Staff member not found');
    return { ok: true, ...(await directLinkEmployee(d.getDB(), { userId: id, phone: req.body?.phone, actorId: req.user!.id, note: req.body?.note, confirmed: req.body?.confirmed, now: new Date(now()) })) };
  }));
  r.post('/linking/link', wrap(async (req, res) => {
    const ids = Array.isArray(req.body?.user_ids) ? req.body.user_ids : [];
    if (!ids.length) return res.status(400).json({ error: 'Select at least one employee' }) as any;
      return { results: await linkEmployees(d.getDB(), { userIds: ids, actorId: req.user!.id, now: new Date(now()), canDirectLink: true }) };
  }));

  // ── Live queue: what is waiting or running now ──
  r.get('/queue', wrap(async () => {
    const db = d.getDB();
    const rows = await db('assistant_requests as ar').leftJoin('users as u', 'u.id', 'ar.loop_user_id')
      .whereIn('ar.status', ['READY_FOR_CONFIRMATION', 'CONFIRMED', 'QUEUED', 'PROCESSING'])
      .select('ar.id', 'ar.intent', 'ar.status', 'ar.priority', 'ar.created_at', 'ar.updated_at', 'ar.execution_attempts', 'ar.next_attempt_at', 'ar.locked_by', 'u.name as employee')
      .orderBy('ar.priority', 'asc').orderBy('ar.created_at', 'asc').limit(200);
    return rows.map((r: any) => ({ ...r, id: r.id, confirmation: r.status === 'READY_FOR_CONFIRMATION' ? 'awaiting' : r.status === 'CONFIRMED' || r.status === 'QUEUED' || r.status === 'PROCESSING' ? 'confirmed' : null }));
  }));

  // ── Requests: searchable, filterable history ──
  r.get('/requests', wrap(async (req) => {
    const db = d.getDB();
    const page = clampInt(req.query.page, 1, 10000), limit = clampInt(req.query.limit, 25, 100);
    const q = db('assistant_requests as ar').leftJoin('users as u', 'u.id', 'ar.loop_user_id');
    if (typeof req.query.status === 'string' && (STATES as readonly string[]).includes(req.query.status)) q.where('ar.status', req.query.status);
    if (typeof req.query.intent === 'string' && req.query.intent) q.where('ar.intent', req.query.intent.slice(0, 40));
    const from = toDate(req.query.from), to = toDate(req.query.to);
    if (from) q.where('ar.created_at', '>=', from);
    if (to) q.where('ar.created_at', '<=', to);
    if (typeof req.query.q === 'string' && req.query.q.trim()) {
      const term = `%${req.query.q.trim().toLowerCase().slice(0, 60)}%`;
      q.where((w) => w.whereRaw('LOWER(u.name) LIKE ?', [term]).orWhereRaw('LOWER(ar.intent) LIKE ?', [term]).orWhereRaw('LOWER(ar.id) LIKE ?', [term]).orWhereRaw('LOWER(COALESCE(ar.failure_kind, \'\')) LIKE ?', [term]));
    }
    const total = Number((await q.clone().count('ar.id as n').first() as any).n);
    const rows = await q.clone().select('ar.id', 'ar.intent', 'ar.status', 'ar.priority', 'ar.created_at', 'ar.updated_at', 'ar.failure_kind', 'ar.execution_attempts', 'u.name as employee', 'ar.channel')
      .orderBy('ar.created_at', 'desc').limit(limit).offset((page - 1) * limit);
    return { total, page, limit, items: rows };
  }));

  // ── One request: message, entities, clarifications, confirmations, queue, attempts, timeline ──
  r.get('/requests/:id', wrap(async (req, res) => {
    const db = d.getDB();
    const row = await db('assistant_requests as ar').leftJoin('users as u', 'u.id', 'ar.loop_user_id')
      .where('ar.id', req.params.id).first('ar.*', 'u.name as employee');
    if (!row) return res.status(404).json({ error: 'Request not found' }) as any;
    const events = await db('assistant_request_events').where({ request_id: row.id }).orderBy('id', 'asc')
      .select('event', 'from_state', 'to_state', 'execution_id', 'detail', 'created_at');
    const attempts = await db('assistant_executions').where({ request_id: row.id }).orderBy('attempt', 'asc')
      .select('attempt', 'status', 'error', 'started_at', 'finished_at');
    // The employee's own words: the conversation turns around this request (the request row does not store the raw text)
    // Exact link: messages recorded against this request (older messages without a link are not guessed at)
    const turns = await db('assistant_conversation_log').where({ request_id: row.id })
      .orderBy('id', 'asc').select('role', 'text', 'created_at');
    const eligibility = await retryEligibility(db, d.registry, row);
    const data = parse(row.data, { raw: {}, resolved: {} });
    return {
      id: row.id, status: row.status, intent: row.intent, channel: row.channel, employee: row.employee,
      priority: row.priority, confidence: row.confidence, created_at: row.created_at, updated_at: row.updated_at,
      extracted: { ...data.raw, ...(data.resolved.deadline !== undefined ? { deadline_resolved: data.resolved.deadline } : {}) },
      ambiguous: parse(row.ambiguous, []),
      ai: parse(row.ai_meta, null),
      confirmation: { status: row.confirmed_at ? 'confirmed' : row.status === 'READY_FOR_CONFIRMATION' ? 'awaiting' : null, confirmed_at: row.confirmed_at, expires_at: row.confirmation_expires_at },
      failure: row.status === 'FAILED' ? { kind: row.failure_kind, last_error: maskText(row.error) } : null,
      attempts, retry: eligibility,
      timeline: events.map((e: any) => ({ ...e, detail: maskText(e.detail) })),
      conversation: turns.map((t: any) => ({ role: t.role, text: maskText(t.text), at: t.created_at })),
    } as any;
  }));

  // ── Identities: masked, no secrets ──
  r.get('/identities', wrap(async () => {
    const db = d.getDB();
    const rows = await db('assistant_identities as ai').join('users as u', 'u.id', 'ai.user_id')
      .select('ai.id', 'ai.user_id', 'u.name as employee', 'u.role', 'ai.channel', 'ai.external_sender_id', 'ai.status', 'ai.verified_at', 'ai.status_changed_at')
      .orderBy('ai.id', 'desc').limit(500);
    // Last activity = the employee's own latest message (keys end with the employee id), else their latest request
    const msgs = await db('assistant_conversation_log').where({ role: 'employee' }).select('conversation_key').max('created_at as last').groupBy('conversation_key');
    const lastBy = new Map<number, any>();
    for (const m of msgs) {
      const uid = Number(String(m.conversation_key).split(':').pop());
      if (!Number.isInteger(uid)) continue;
      if (!lastBy.has(uid) || new Date(m.last) > new Date(lastBy.get(uid))) lastBy.set(uid, m.last);
    }
    return rows.map((r: any) => ({
      id: r.id, employee: r.employee, role: r.role, channel: r.channel,
      // Phone numbers are masked; in-app (simulator) links carry no number at all, so no internal id is shown
      number: r.channel === 'simulator' ? null : maskPhone(r.external_sender_id), status: r.status,
      linked_at: r.verified_at, status_changed_at: r.status_changed_at, last_activity: lastBy.get(Number(r.user_id)) ?? null,
    }));
  }));

  r.post('/identities/:id/revoke', wrap(async (req) => {
    const db = d.getDB();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new IdentityError('not_found', 'Mapping not found');
    await db.transaction(async (trx) => {
      await setIdentityStatus(trx as any, { identityId: id, status: 'revoked', actorId: req.user!.id, reason: 'revoked by administrator' });
      await audit(trx as any, req.user!.id, 'identity_revoked', `identity:${id}`, 'connection revoked', now());
    });
    return { ok: true };
  }));

  // Conversations and recent WhatsApp activity are not served: they expose who said what to the bot

  // ── Failures ──
  r.get('/failures', wrap(async () => {
    const db = d.getDB();
    const rows = await db('assistant_requests as ar').leftJoin('users as u', 'u.id', 'ar.loop_user_id')
      .where('ar.status', 'FAILED').select('ar.*', 'u.name as employee').orderBy('ar.updated_at', 'desc').limit(200);
    const out = [];
    for (const row of rows) {
      const last = await db('assistant_executions').where({ request_id: row.id }).orderBy('attempt', 'desc').first('attempt', 'status', 'error', 'finished_at');
      const eligibility = await retryEligibility(db, d.registry, row);
      out.push({
        id: row.id, employee: row.employee, intent: row.intent, failure_kind: row.failure_kind,
        reason: maskText(row.error ?? last?.error ?? ''), attempts: Number(row.execution_attempts),
        last_attempt: last ? { attempt: last.attempt, status: last.status, at: last.finished_at } : null,
        retry_eligible: eligibility.eligible, retry_reason: eligibility.reason, updated_at: row.updated_at,
      });
    }
    return out;
  }));

  // Retry: only what the executor allows; the same request, the same idempotency key, one new attempt
  r.post('/failures/:id/retry', wrap(async (req, res) => {
    const db = d.getDB();
    const row = await db('assistant_requests').where({ id: req.params.id }).first();
    if (!row) return res.status(404).json({ error: 'Request not found' }) as any;
    const eligibility = await retryEligibility(db, d.registry, row);
    if (!eligibility.eligible) return res.status(409).json({ error: `Retry not allowed: ${eligibility.reason}` }) as any;
    await db.transaction(async (trx) => {
      await transition(db, row.id, 'QUEUED', {
        event: 'admin_retry', loopUserId: row.loop_user_id, conversationKey: row.conversation_key, expectFrom: ['FAILED'],
        detail: `retry requested by administrator ${req.user!.id}`,
        patch: { failure_kind: null, next_attempt_at: new Date(now()), execution_attempts: 0, locked_by: null, locked_until: null },
      }, now(), trx);
      await audit(trx as any, req.user!.id, 'request_retry', row.id, `intent ${row.intent}`, now());
    });
    return { ok: true };
  }));

  // ── Admin audit (read-only) ──
  r.get('/audit', wrap(async (req) => {
    const db = d.getDB();
    const source = req.query.source === 'admin' ? 'admin' : 'request';
    const page = clampInt(req.query.page, 1, 10000), limit = clampInt(req.query.limit, 50, 200);
    const term = typeof req.query.q === 'string' && req.query.q.trim() ? `%${req.query.q.trim().toLowerCase().slice(0, 60)}%` : null;
    if (source === 'admin') {
      const q = db('assistant_admin_audit as a').leftJoin('users as u', 'u.id', 'a.actor_id').select('a.id', 'a.action', 'a.target', 'a.detail', 'a.created_at', 'u.name as actor');
      if (term) q.whereRaw('LOWER(a.action) LIKE ? OR LOWER(COALESCE(a.target, \'\')) LIKE ?', [term, term]);
      return { source, items: await q.orderBy('a.id', 'desc').limit(limit).offset((page - 1) * limit) };
    }
    const q = db('assistant_request_events as e').leftJoin('users as u', 'u.id', 'e.loop_user_id')
      .select('e.id', 'e.request_id', 'e.event', 'e.from_state', 'e.to_state', 'e.execution_id', 'e.detail', 'e.created_at', 'u.name as employee');
    if (term) q.whereRaw('LOWER(e.event) LIKE ? OR LOWER(e.request_id) LIKE ?', [term, term]);
    if (typeof req.query.event === 'string' && req.query.event) q.where('e.event', req.query.event.slice(0, 40));
    const items = (await q.orderBy('e.id', 'desc').limit(limit).offset((page - 1) * limit)).map((e: any) => ({ ...e, detail: maskText(e.detail) }));
    return { source, items };
  }));

  // ── Configuration (read-only; never shows secrets, never calls the provider) ──
  // Manual linking of WhatsApp internal ids (pendingSenders.ts). Full ids are never returned to the screen.
  r.get('/pending-senders', wrap(async () => listPendingSenders(d.getDB())));
  r.get('/staff-users', wrap(async () => d.getDB()('users').whereIn('role', STAFF_ROLES).select(['id', 'name', 'role']).orderBy('name')));
  r.post('/pending-senders/:id/approve', wrap(async (req) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new PendingError('not_found', 'Pending sender not found');
    const out = await approvePendingSender(d.getDB(), {
      pendingId: id, userId: Number(req.body?.user_id), actorId: req.user!.id,
      inPersonVerified: req.body?.in_person_verified === true, note: String(req.body?.note ?? ''),
    });
    return { ok: true, ...out };
  }));
  r.post('/pending-senders/:id/dismiss', wrap(async (req) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new PendingError('not_found', 'Pending sender not found');
    await dismissPendingSender(d.getDB(), { pendingId: id, actorId: req.user!.id, note: String(req.body?.note ?? '') });
    return { ok: true };
  }));

  // WhatsApp connection state only: no session data, no pairing code, no paths
  r.get('/whatsapp', wrap(async () => (await d.whatsappStatus?.()) ?? { enabled: false, state: 'stopped' }));
  // Read-only: group names and JIDs the connected account is in. Nothing is sent, joined or changed.
  // ── Pairing: the QR the existing connection is waiting for, to admins only. Never logged, never cached. ──
  r.get('/whatsapp/pairing', wrap(async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    const st: any = (await d.whatsappStatus?.()) ?? { enabled: false, state: 'stopped' };
    const code = st.state === 'awaiting_qr' ? (await d.whatsappPairing?.()) ?? null : null;
    let image: string | null = null;
    if (code) image = await (d.renderQr ?? renderQrSvg)(code.qr).catch(() => null);
    return {
      state: st.state, enabled: !!st.enabled, account: st.account ?? null, last_connected_at: st.lastConnectedAt ?? null,
      reconnect_attempts: st.reconnectAttempts ?? 0,
      qr: code ? { image, issued_at: code.issuedAt, expires_at: new Date(Date.parse(code.issuedAt) + QR_LIFETIME_MS).toISOString(), render: image ? 'ok' : 'unavailable' } : null,
      can_request_new: st.state === 'logged_out',
      // Why WhatsApp is not running, in plain words (no secrets, no paths), and whether it can be started from here
      problems: st.state === 'stopped' ? [...new Set([...(d.setup?.().problems ?? []), ...(d.setup?.().whatsappProblems ?? [])])] : [],
      can_start: st.state === 'stopped' && !!d.whatsappStart,
      group_jid: notificationGroupJid(),
    };
  }));
  r.post('/whatsapp/start', wrap(async (req, res) => {
    if (!d.whatsappStart) return res.status(409).json({ error: 'WhatsApp cannot be started on this server' }) as any;
    const out = await d.whatsappStart();
    await audit(d.getDB(), req.user!.id, 'whatsapp_start_requested', 'whatsapp', out.ok ? 'started' : `not started: ${out.problems.join('; ')}`, now());
    return out;
  }));
  r.post('/whatsapp/pairing/refresh', wrap(async (req, res) => {
    const st: any = (await d.whatsappStatus?.()) ?? { state: 'stopped' };
    if (st.state !== 'logged_out' || !d.whatsappNewPairing?.()) return res.status(409).json({ error: 'A new code is not needed: the connection issues codes by itself while it is waiting for pairing.' }) as any;
    await audit(d.getDB(), req.user!.id, 'whatsapp_pairing_requested', 'whatsapp', 'new pairing round requested', now());
    return { ok: true };
  }));

  // Choose the group the assistant works in: only a group the company WhatsApp is a member of. Takes effect at once.
  r.post('/whatsapp/group', wrap(async (req, res) => {
    const jid = typeof req.body?.jid === 'string' ? req.body.jid.trim() : '';
    if (!GROUP_JID.test(jid)) return res.status(400).json({ error: 'Choose a group from the list' }) as any;
    if (!d.whatsappGroups) return res.status(409).json({ error: 'WhatsApp is not running on this server' }) as any;
    const groups = await d.whatsappGroups().catch(() => []);
    const group = groups.find((g) => g.jid === jid);
    if (!group) return res.status(409).json({ error: 'The company WhatsApp is not a member of that group. Connect WhatsApp and add it to the group first.' }) as any;
    await saveNotificationGroup(d.getDB(), jid, group.name, req.user!.id, new Date(now()));
    setChosenNotificationGroup(jid);
    groupNameCache = { jid, name: group.name, at: now() };
    return { ok: true, name: group.name };
  }));

  // One sample "New task assigned" card in the group, built from the latest real assigned task, so the design and data
  // can be checked. Sent by the WhatsApp worker within seconds, like any notice. Recorded in the audit history.
  r.post('/whatsapp/sample', wrap(async (req, res) => {
    const db = d.getDB();
    if (!notificationGroupJid()) return res.status(409).json({ error: 'Choose a group first' }) as any;
    const t = await db('tasks').whereNotNull('assigned_to').whereNotIn('status', ['completed', 'cancelled']).orderBy('id', 'desc').first('id', 'title', 'assigned_to');
    if (!t) return res.status(409).json({ error: 'No assigned task to use as a sample' }) as any;
    await queueAssignmentNotice(db, { taskId: Number(t.id), kind: 'assigned', employeeIds: [Number(t.assigned_to)], eventKey: `sample:${t.id}:${now()}` });
    await db('assistant_admin_audit').insert({ actor_id: req.user!.id, action: 'whatsapp_sample_sent', target: 'whatsapp', detail: `sample card for task #${t.id}`, created_at: new Date(now()) });
    return { ok: true, task: String(t.title) };
  }));

  // What the bot did with the latest incoming WhatsApp messages (no message text)

  r.get('/whatsapp/groups', wrap(async () => d.whatsappGroups ? await d.whatsappGroups() : []));

  // Save the AI key from the dashboard: stored encrypted, never shown again; the assistant and WhatsApp start straight away
  r.post('/config/ai-key', wrap(async (req, res) => {
    const key = validAiKey(req.body?.key);
    if (!key) return res.status(400).json({ error: 'Paste the full API key (it has no spaces)' }) as any;
    await saveAiKey(d.getDB(), key, req.user!.id, new Date(now()));
    const out = d.onAiKeySaved ? await d.onAiKeySaved(key) : { running: false, problems: [] };
    return { ok: true, ...out };
  }));

  r.get('/config', wrap(async () => {
    const c = cfg();
    return {
      provider: c?.ai.provider ?? 'none',
      model: c?.ai.model ?? null,
      timezone: c?.timezone ?? null,
      assistant_enabled: c?.enabled ?? false,
      simulator_enabled: c?.simulatorEnabled ?? false,
      queue: { max_attempts: c?.queue.maxAttempts ?? null, lease_seconds: c?.queue.leaseSeconds ?? null, expiry_seconds: c?.queue.queueExpirySeconds ?? null },
      execution_enabled: c?.queue.executionEnabled ?? false,
      worker_running: false,
      registered_actions: d.registry.size,
      provider_connectivity: 'not checked (no paid calls are made to populate this page)',
      api_key_configured: !!c?.ai.apiKey,
      // What is missing on the server, in plain words (no secrets)
      problems: d.setup?.().problems ?? [],
      node_env: d.setup?.().nodeEnv ?? null,
      settings_file_loaded: d.setup?.().settingsFileLoaded ?? null,
      whatsapp_state: ((await d.whatsappStatus?.()) as any)?.state ?? 'stopped',
    };
  }));

  return r;
}
