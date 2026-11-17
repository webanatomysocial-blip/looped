// WhatsApp group notices for task assignments. Loop is the source of truth; WhatsApp is only a notification channel.
// A notice is queued in the outbox after the assignment commits, and a worker sends it to the one configured group.
// Nothing here changes an assignment. A failure to queue or send never rolls back or blocks the assignment.
import { Knex } from 'knex';
import { getDB } from '../db';
import { compose, heading, field, bold, clean, italic, priority, dateTime, plural, ICON } from './waMessage';

export const NOTICE_MAX_ATTEMPTS = 5;
const NOTICE_TTL_HOURS = 2;          // a notice that could not be sent within 2 hours is dropped, not sent late
const REPORT_TTL_MINUTES = 30;       // a daily report is only useful near its time
const REMINDER_LOOKBACK_HOURS = 24;  // reminders only for assignments made in the last day, never for old backlogs
const toMs = (v: unknown) => (typeof v === 'string' && !/[TZ+]/.test(v) ? Date.parse(v.replace(' ', 'T') + 'Z') : new Date(v as any).getTime());

// The destination group, from configuration only. Anything else is refused.
export const GROUP_JID = /^\d{10,20}(-\d{1,10})?@g\.us$/;
// A group chosen in the dashboard (saved in the database) takes priority over the server setting.
let chosenGroup: string | null = null;
export function setChosenNotificationGroup(jid: string | null): void { chosenGroup = jid && GROUP_JID.test(jid) ? jid : null; }
export function notificationGroupJid(env: NodeJS.ProcessEnv = process.env): string | null {
  if (chosenGroup) return chosenGroup;
  const v = (env.WHATSAPP_NOTIFICATION_GROUP_JID || '').trim();
  return GROUP_JID.test(v) ? v : null;
}

// The text WhatsApp needs for a real tag: "@" plus the id part of the JID. WhatsApp shows it as the person's name and
// notifies them. Writing "@Name" instead only shows plain text and nobody is notified.
// Only internal WhatsApp ids (@lid) are written into the text. A phone-number JID would put the full phone number in the
// message, which is never allowed, so those people are shown as "@Name" (the mention is still attached to the message).
export const mentionTag = (jid: string, name: string) => (String(jid).endsWith('@lid') ? `@${String(jid).split('@')[0]}` : `@${clean(name, 40)}`);

// Participant JID from a verified identity mapping only. Never built from a name, and never from a number that is not linked.
export function jidForIdentity(externalSenderId: string): string | null {
  if (/^\+\d{8,15}$/.test(externalSenderId)) return `${externalSenderId.slice(1)}@s.whatsapp.net`;
  if (/^lid:\d{1,20}$/.test(externalSenderId)) return `${externalSenderId.slice(4)}@lid`;
  return null;
}

export async function ensureOutboxSchema(db: Knex): Promise<void> {
  if (await db.schema.hasTable('whatsapp_outbox')) return;
  await db.schema.createTable('whatsapp_outbox', (t) => {
    t.increments('id').primary();
    t.string('event_key', 120).notNullable().unique();   // one row per assignment event: duplicates are refused
    t.string('kind', 20).notNullable();                    // assigned | reassigned | reminder
    t.integer('task_id').notNullable();
    t.text('payload').notNullable();                       // the message text and the verified participant JIDs
    t.string('status', 12).notNullable().defaultTo('pending');   // pending | sent | failed | cancelled
    t.integer('attempts').notNullable().defaultTo(0);
    t.timestamp('next_attempt_at').notNullable();
    t.string('last_error', 60).nullable();                 // a fixed code only, never a provider message
    t.timestamp('created_at').defaultTo(db.fn.now());
    t.timestamp('sent_at').nullable();
    t.index(['status', 'next_attempt_at']);
  });
}

// Pure text builder. Linked employees appear as @name with a real mention; unlinked employees appear as plain names.
const names = (people: { name: string; mention: string | null }[]) => people.map((p) => (p.mention ? mentionTag(p.mention, p.name) : clean(p.name, 40))).join(', ') || '—';
const mentionsOf = (people: { mention: string | null }[]) => people.map((p) => p.mention).filter((m): m is string => !!m);

export function buildAssignmentText(args: {
  kind: 'assigned' | 'reassigned'; title: string; project: string; priority: string | null; due: string | null;
  people: { name: string; mention: string | null }[];
}): { text: string; mentions: string[] } {
  const text = compose(
    args.kind === 'reassigned' ? heading(ICON.reassigned, 'Task reassigned') : heading(ICON.task, 'New task assigned'),
    [
      field('Task', clean(args.title)),
      field('Project', clean(args.project)),
      field('Assigned to', names(args.people)),
      args.priority ? field('Priority', priority(args.priority)) : '',
      args.due ? field('Deadline', `${args.due} (IST)`) : '',
      field('Status', `${ICON.pending} Awaiting acceptance`),
    ],
    '👉 Please review and accept your assignment in Loop.',
  );
  return { text, mentions: mentionsOf(args.people) };
}

// Queues one notice for one assignment event. Returns 'duplicate' if this event was already queued.
export async function queueAssignmentNotice(db: Knex, args: {
  taskId: number; kind: 'assigned' | 'reassigned'; employeeIds: number[]; eventKey: string; now?: Date;
}): Promise<'queued' | 'duplicate' | 'disabled' | 'no_assignee'> {
  if (!notificationGroupJid()) return 'disabled';
  const employeeIds = [...new Set(args.employeeIds.map(Number).filter((n) => n > 0))];
  if (!employeeIds.length) return 'no_assignee';
  if (await db('whatsapp_outbox').where({ event_key: args.eventKey }).first('id')) return 'duplicate';
  const task = await db('tasks as t').leftJoin('projects as p', 'p.id', 't.project_id')
    .where('t.id', args.taskId).select('t.title', 't.priority', 't.due_date', 't.due_time', 'p.name as project_name').first();
  if (!task) return 'no_assignee';
  const users = await db('users').whereIn('id', employeeIds).select('id', 'name');
  const byId = new Map(users.map((u: any) => [Number(u.id), String(u.name)]));
  const identities = await db('assistant_identities').whereIn('user_id', employeeIds)
    .where({ status: 'active', channel: 'whatsapp' }).select('user_id', 'external_sender_id');
  const jidByUser = new Map<number, string>();
  for (const i of identities) {
    const jid = jidForIdentity(String(i.external_sender_id));
    if (jid) jidByUser.set(Number(i.user_id), jid);
  }
  const people = employeeIds.map((id) => ({ name: byId.get(id) ?? 'Employee', mention: jidByUser.get(id) ?? null }));
  const { text, mentions } = buildAssignmentText({
    kind: args.kind, title: String(task.title), project: String(task.project_name || 'a project'),
    priority: task.priority ?? null, due: dueLabel(task.due_date, task.due_time), people,
  });
  const now = args.now ?? new Date();
  try {
    await db('whatsapp_outbox').insert({
      event_key: args.eventKey, kind: args.kind, task_id: args.taskId,
      payload: JSON.stringify({ text, mentions }), status: 'pending', attempts: 0, next_attempt_at: now,
    });
  } catch (err: any) {
    // A concurrent duplicate hits the unique key: that is the same event, so it is not queued twice
    if (/unique|duplicate/i.test(String(err?.message))) return 'duplicate';
    throw err;
  }
  return 'queued';
}

// "20 Nov, 5:00 pm" in IST, or the plain date when it can't be read
function dueLabel(dueDate: unknown, dueTime: unknown): string | null {
  if (!dueDate) return null;
  const ms = deadlineInstant(String(dueDate), dueTime ? String(dueTime).slice(0, 5) : null);
  return ms === null ? String(dueDate).slice(0, 10) : dateTime(ms);
}

// Used by the assignment code after commit. Any failure is logged without detail and never reaches the caller.
export async function noticeAfterCommit(args: { taskId: number; kind: 'assigned' | 'reassigned'; employeeIds: number[]; eventKey: string }): Promise<void> {
  try { await queueAssignmentNotice(getDB(), args); }
  catch { console.error('[whatsapp-notice] could not queue an assignment notice'); }
}

export interface GroupSender { isConnected(): boolean; sendGroup(jid: string, text: string, mentions: string[]): Promise<boolean> }

// Sends pending notices. Skips everything while WhatsApp is not connected: rows wait in the outbox.
export async function processOutbox(db: Knex, sender: GroupSender, now: Date = new Date(), batch = 10): Promise<{ sent: number; failed: number; waiting: number }> {
  const jid = notificationGroupJid();
  if (!jid || !sender.isConnected()) return { sent: 0, failed: 0, waiting: await db('whatsapp_outbox').where({ status: 'pending' }).count({ n: '*' }).first().then((r: any) => Number(r.n)) };
  const due = await db('whatsapp_outbox').where({ status: 'pending' }).where('next_attempt_at', '<=', now).orderBy('id').limit(batch);
  let sent = 0; let failed = 0;
  for (const row of due) {
    const ttlMs = String(row.kind).startsWith('report_') ? REPORT_TTL_MINUTES * 60_000 : NOTICE_TTL_HOURS * 3600_000;
    const expired = now.getTime() - toMs(row.created_at) > ttlMs;
    if (expired) { await db('whatsapp_outbox').where({ id: row.id }).update({ status: 'failed', last_error: 'expired' }); failed++; continue; }
    const payload = JSON.parse(String(row.payload));
    if (row.kind === 'deadline') {
      // A deadline alert is not sent once the task is finished or cancelled
      const t = await db('tasks').where({ id: payload.taskId }).first('status');
      if (!t || t.status === 'completed' || t.status === 'cancelled') { await db('whatsapp_outbox').where({ id: row.id }).update({ status: 'cancelled', last_error: 'no_longer_needed' }); continue; }
    }
    if (row.kind === 'reminder') {
      // A reminder is sent only while the assignee still has not accepted
      const a = await db('task_assignees').where({ id: payload.assignmentId }).first('acceptance_status', 'skipped');
      const stillNeeded = !!a && a.acceptance_status !== 'accepted' && !Number(a.skipped);
      if (!stillNeeded) { await db('whatsapp_outbox').where({ id: row.id }).update({ status: 'cancelled', last_error: 'no_longer_needed' }); continue; }
    }
    let ok = false;
    try { ok = await sender.sendGroup(jid, String(payload.text), (payload.mentions ?? []).map(String)); } catch { ok = false; }
    if (ok) {
      await db('whatsapp_outbox').where({ id: row.id }).update({ status: 'sent', sent_at: now, attempts: row.attempts + 1, last_error: null });
      sent++;
    } else {
      const attempts = row.attempts + 1;
      const giveUp = attempts >= NOTICE_MAX_ATTEMPTS;
      await db('whatsapp_outbox').where({ id: row.id }).update({
        attempts, status: giveUp ? 'failed' : 'pending', last_error: 'send_failed',
        next_attempt_at: new Date(now.getTime() + Math.min(60, 2 ** attempts) * 1000),
      });
      if (giveUp) failed++;
    }
  }
  const waiting = await db('whatsapp_outbox').where({ status: 'pending' }).count({ n: '*' }).first().then((r: any) => Number(r.n));
  return { sent, failed, waiting };
}

// ── Acceptance reminders ──
// Threshold in minutes, from configuration. Default 1. Changeable later without code changes.
export function acceptanceReminderMinutes(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.ACCEPTANCE_REMINDER_MINUTES ?? 1);
  return Number.isFinite(n) && n >= 1 && n <= 1440 ? n : 1;
}

export function buildReminderText(args: { title: string; project: string; person: { name: string; mention: string | null } }): { text: string; mentions: string[] } {
  const who = args.person.mention ? mentionTag(args.person.mention, args.person.name) : clean(args.person.name, 40);
  const text = compose(
    heading(ICON.reminder, 'Acceptance reminder'),
    `${who}, please review and accept your assignment in Loop.`,
    [field('Task', clean(args.title)), field('Project', clean(args.project)), field('Status', `${ICON.pending} Awaiting acceptance`)],
    italic("The task can't start until you accept it."),
  );
  return { text, mentions: args.person.mention ? [args.person.mention] : [] };
}

// Queues one reminder per pending assignment. The key is the assignment row and the time it was assigned, so a restart
// or a retry can never queue the same reminder twice, while a later reassignment gets its own.
export async function enqueueAcceptanceReminders(db: Knex, now: Date = new Date(), minutes = acceptanceReminderMinutes()): Promise<number> {
  if (!notificationGroupJid()) return 0;
  const cutoff = new Date(now.getTime() - minutes * 60_000);
  const rows = await db('task_assignees as ta').join('tasks as t', 't.id', 'ta.task_id')
    .whereIn('ta.assignee_role', ['employee', 'manager'])   // managers get reminders too; accepted ones are excluded below
    .whereNotNull('ta.assigned_at').where('ta.assigned_at', '<=', cutoff)
    .where('ta.assigned_at', '>=', new Date(now.getTime() - REMINDER_LOOKBACK_HOURS * 3600_000))
    .where((q: any) => q.whereNull('ta.skipped').orWhere('ta.skipped', 0))
    .where((q: any) => q.whereNull('ta.acceptance_status').orWhere('ta.acceptance_status', 'pending'))
    .whereNull('t.ticket_type_id')
    .whereNotIn('t.status', ['completed', 'cancelled'])
    .select('ta.id', 'ta.user_id', 'ta.assigned_at', 't.id as task_id', 't.title', 't.project_id');
  let queued = 0;
  for (const r of rows) {
    const eventKey = `remind:${r.id}:${new Date(r.assigned_at).getTime()}`;
    if (await db('whatsapp_outbox').where({ event_key: eventKey }).first('id')) continue;
    const proj = await db('projects').where({ id: r.project_id }).first('name');
    const user = await db('users').where({ id: r.user_id }).first('name');
    const identity = await db('assistant_identities').where({ user_id: r.user_id, status: 'active', channel: 'whatsapp' }).first('external_sender_id');
    const mention = identity ? jidForIdentity(String(identity.external_sender_id)) : null;
    const { text, mentions } = buildReminderText({ title: String(r.title), project: String(proj?.name || 'a project'), person: { name: String(user?.name || 'Employee'), mention } });
    try {
      await db('whatsapp_outbox').insert({
        event_key: eventKey, kind: 'reminder', task_id: Number(r.task_id),
        payload: JSON.stringify({ text, mentions, assignmentId: Number(r.id) }), status: 'pending', attempts: 0, next_attempt_at: now,
      });
      queued++;
    } catch (err: any) {
      if (!/unique|duplicate/i.test(String(err?.message))) throw err;
    }
  }
  return queued;
}

// ── Deadline approaching alerts ──
// Asia/Kolkata has no daylight saving, so a fixed +05:30 offset gives the exact deadline instant.
export const DEADLINE_TZ_OFFSET = '+05:30';

// Share of the allotted duration that must remain before the alert is sent. Default 12%, configurable 1–50.
export function deadlineAlertPercent(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.DEADLINE_ALERT_PERCENT ?? 12);
  return Number.isFinite(n) && n >= 1 && n <= 50 ? n : 12;
}

// The deadline instant from the stored date and time, in Asia/Kolkata. With no time set, the end of that day is used.
export function deadlineInstant(dueDate: string, dueTime: string | null): number | null {
  const d = String(dueDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const t = dueTime && /^\d{2}:\d{2}$/.test(String(dueTime)) ? String(dueTime) : '23:59';
  const ms = Date.parse(`${d}T${t}:00${DEADLINE_TZ_OFFSET}`);
  return Number.isFinite(ms) ? ms : null;
}

// True only in the window (0, threshold]: before the deadline, with no more than the threshold share of the allotted time left.
export function deadlineAlertDue(args: { deadlineMs: number; estimatedHours: number; nowMs: number; percent: number }): boolean {
  const allottedMs = args.estimatedHours * 3_600_000;
  if (!(allottedMs > 0)) return false;
  const remaining = args.deadlineMs - args.nowMs;
  return remaining > 0 && remaining <= (allottedMs * args.percent) / 100;
}

export function buildDeadlineText(args: {
  title: string; project: string; dueLabel: string; minutesLeft: number;
  people: { name: string; mention: string | null }[];
}): { text: string; mentions: string[] } {
  const left = args.minutesLeft >= 120 ? `about ${plural(Math.round(args.minutesLeft / 60), 'hour')}` : `about ${plural(args.minutesLeft, 'minute')}`;
  const text = compose(
    heading(ICON.deadline, 'Deadline approaching'),
    `${bold(left)} left on this task.`,
    [field('Task', clean(args.title)), field('Project', clean(args.project)), field('Due', `${args.dueLabel} (IST)`), field('Assigned to', names(args.people))],
    '👉 Please wrap up or update the task in Loop.',
  );
  return { text, mentions: mentionsOf(args.people) };
}

// Queues one alert per task deadline. The key is the task and its exact deadline instant, so the alert is never
// repeated across passes, retries or restarts. A later change to the deadline is a new deadline and gets its own alert.
export async function enqueueDeadlineAlerts(db: Knex, now: Date = new Date(), percent = deadlineAlertPercent()): Promise<number> {
  if (!notificationGroupJid()) return 0;
  const tasks = await db('tasks as t').leftJoin('projects as p', 'p.id', 't.project_id')
    .whereNotNull('t.due_date').whereNotNull('t.estimated_hours').where('t.estimated_hours', '>', 0)
    .whereNull('t.ticket_type_id')
    .whereNotIn('t.status', ['completed', 'cancelled', 'draft', 'pending_approval'])
    .where((q: any) => q.whereNull('t.pending_assign').orWhere('t.pending_assign', 0))
    .select('t.id', 't.title', 't.due_date', 't.due_time', 't.estimated_hours', 'p.name as project_name');
  let queued = 0;
  for (const t of tasks) {
    const deadlineMs = deadlineInstant(String(t.due_date), t.due_time ?? null);
    if (deadlineMs === null) continue;
    if (!deadlineAlertDue({ deadlineMs, estimatedHours: Number(t.estimated_hours), nowMs: now.getTime(), percent })) continue;
    const eventKey = `deadline:${t.id}:${deadlineMs}`;
    if (await db('whatsapp_outbox').where({ event_key: eventKey }).first('id')) continue;
    const people = await db('task_assignees as ta').join('users as u', 'u.id', 'ta.user_id')
      .where('ta.task_id', t.id).where('ta.assignee_role', 'employee')
      .where((q: any) => q.whereNull('ta.skipped').orWhere('ta.skipped', 0))
      .where((q: any) => q.whereNull('ta.acceptance_status').orWhereNot('ta.acceptance_status', 'declined'))
      .select('ta.user_id', 'u.name');
    if (!people.length) continue;
    const identities = await db('assistant_identities').whereIn('user_id', people.map((p: any) => p.user_id))
      .where({ status: 'active', channel: 'whatsapp' }).select('user_id', 'external_sender_id');
    const jidBy = new Map<number, string>();
    for (const i of identities) { const jid = jidForIdentity(String(i.external_sender_id)); if (jid) jidBy.set(Number(i.user_id), jid); }
    const due = dateTime(deadlineMs);
    const minutesLeft = Math.max(1, Math.ceil((deadlineMs - now.getTime()) / 60_000));
    const { text, mentions } = buildDeadlineText({
      title: String(t.title), project: String(t.project_name || 'a project'), dueLabel: due, minutesLeft,
      people: people.map((p: any) => ({ name: String(p.name), mention: jidBy.get(Number(p.user_id)) ?? null })),
    });
    try {
      await db('whatsapp_outbox').insert({
        event_key: eventKey, kind: 'deadline', task_id: Number(t.id),
        payload: JSON.stringify({ text, mentions, taskId: Number(t.id) }), status: 'pending', attempts: 0, next_attempt_at: now,
      });
      queued++;
    } catch (err: any) {
      if (!/unique|duplicate/i.test(String(err?.message))) throw err;
    }
  }
  return queued;
}
