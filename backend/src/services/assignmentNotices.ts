// WhatsApp group notices for task assignments. Loop is the source of truth; WhatsApp is only a notification channel.
// A notice is queued in the outbox after the assignment commits, and a worker sends it to the one configured group.
// Nothing here changes an assignment. A failure to queue or send never rolls back or blocks the assignment.
import { Knex } from 'knex';
import { renderCard, Card } from './reportCard';
import { loadNotificationGroup } from '../assistant/settingsStore';
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
// The group chosen on the dashboard is read from the database, not only at startup: several copies of the server run,
// and the one sending WhatsApp messages may have started before the group was chosen
export async function refreshNotificationGroup(db: Knex): Promise<void> {
  const jid = await loadNotificationGroup(db).catch(() => undefined);
  if (jid !== undefined) setChosenNotificationGroup(jid);
}
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
// A one-task detail card and its short caption (heading, tags, what to do). The full text stays as the fallback.
const plain = (v: string) => v.replace(/[*_~]/g, '').replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').trim();   // no emoji: the card font has none
const tone = (p: string | null): 'bad' | 'warn' | undefined => (/urgent|high|critical/i.test(String(p)) ? 'bad' : /medium/i.test(String(p)) ? 'warn' : undefined);
function detailCard(head: string, title: string, fields: { label: string; value: string | null; tone?: 'good' | 'warn' | 'bad' }[], tags: string, action: string) {
  const card: Card = { title, subtitle: plain(head), columns: [], rows: [], fields: fields.filter((f) => f.value).map((f) => ({ ...f, value: plain(String(f.value)) })) };
  return { card, caption: `${head}${tags ? ` · ${tags}` : ''}\n${action}` };
}
const plainNames = (people: { name: string }[]) => people.map((p) => clean(p.name, 40)).join(', ') || '—';
const mentionsOf = (people: { mention: string | null }[]) => people.map((p) => p.mention).filter((m): m is string => !!m);

export function buildAssignmentText(args: {
  kind: 'assigned' | 'reassigned'; title: string; project: string; priority: string | null; due: string | null;
  people: { name: string; mention: string | null }[]; status?: string | null;
}): { text: string; mentions: string[]; card: Card; caption: string } {
  const status = args.status || null;   // from the saved task only; left out when unknown
  const head = args.kind === 'reassigned' ? heading(ICON.reassigned, 'Task reassigned') : heading(ICON.task, 'New task assigned');
  const pic = detailCard(head, clean(args.title, 60), [
    { label: 'Project', value: args.project ? clean(args.project) : null }, { label: 'Assigned to', value: plainNames(args.people) },
    { label: 'Priority', value: args.priority ? priority(args.priority) : null, tone: tone(args.priority) },
    { label: 'Deadline', value: args.due }, { label: 'Status', value: status, tone: 'warn' },
  ], names(args.people), '👉 Please review and accept your assignment in Loop.');
  const text = compose(
    head,
    [
      field('Task', clean(args.title)),
      args.project ? field('Project', clean(args.project)) : '',
      field('Assigned to', names(args.people)),
      args.priority ? field('Priority', priority(args.priority)) : '',
      args.due ? field('Deadline', args.due) : '',
      status ? field('Status', `${ICON.pending} ${status}`) : '',
    ],
    '👉 Please review and accept your assignment in Loop.',
  );
  return { text, mentions: mentionsOf(args.people), ...pic };
}

// Queues one notice for one assignment event. Returns 'duplicate' if this event was already queued.
export async function queueAssignmentNotice(db: Knex, args: {
  taskId: number; kind: 'assigned' | 'reassigned'; employeeIds: number[]; eventKey: string; now?: Date;
}): Promise<'queued' | 'duplicate' | 'disabled' | 'no_assignee'> {
  await refreshNotificationGroup(db);
  if (!notificationGroupJid()) return 'disabled';
  const employeeIds = [...new Set(args.employeeIds.map(Number).filter((n) => n > 0))];
  if (!employeeIds.length) return 'no_assignee';
  if (await db('whatsapp_outbox').where({ event_key: args.eventKey }).first('id')) return 'duplicate';
  const task = await db('tasks as t').leftJoin('projects as p', 'p.id', 't.project_id')
    .where('t.id', args.taskId).select('t.title', 't.priority', 't.due_date', 't.due_time', 't.status', 't.ticket_type_id', 't.xlr8_status', 'p.name as project_name').first();
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
  const people = employeeIds.filter((id) => byId.has(id)).map((id) => ({ name: byId.get(id)!, mention: jidByUser.get(id) ?? null }));
  if (!people.length) return 'no_assignee';
  const built = buildAssignmentText({
    kind: args.kind, title: String(task.title), project: task.project_name ? String(task.project_name) : '',
    priority: task.priority ?? null, due: dueLabel(task.due_date, task.due_time), people,
    status: statusLabel(task, people.map((p) => p.name)),
  });
  const now = args.now ?? new Date();
  try {
    await db('whatsapp_outbox').insert({
      event_key: args.eventKey, kind: args.kind, task_id: args.taskId,
      payload: JSON.stringify(built), status: 'pending', attempts: 0, next_attempt_at: now,
    });
  } catch (err: any) {
    // A concurrent duplicate hits the unique key: that is the same event, so it is not queued twice
    if (/unique|duplicate/i.test(String(err?.message))) return 'duplicate';
    throw err;
  }
  return 'queued';
}

// The status as the Loop app shows it (same labels), from the saved task: never a fixed text
const TASK_STATUS: Record<string, string> = { todo: 'Waiting', in_progress: 'Working', in_review: 'Submitted', on_hold: 'On hold', completed: 'Approved', draft: 'Draft', overdue: 'Delayed', pending_approval: 'Pending Approval', changes_requested: 'Changes requested' };
const TICKET_STATUS: Record<string, string> = { pending_manager: 'Needs Manager', pending_assignee: 'Waiting', in_progress: 'Working', pending_admin: 'Admin Review', pending_client: 'Client Review', completed: 'Approved', pending_crosspod: 'Awaiting Approval', needs_reassignment: 'Needs Reassignment', pending_approval: 'Pending Approval' };
export function statusLabel(t: { status?: string | null; ticket_type_id?: unknown; xlr8_status?: string | null }, names: string[]): string {
  const raw = t.ticket_type_id ? String(t.xlr8_status ?? '') : String(t.status ?? '');
  const label = (t.ticket_type_id ? TICKET_STATUS : TASK_STATUS)[raw] ?? raw.replace(/_/g, ' ');
  return label === 'Waiting' && names.length ? `Waiting for ${names.join(', ')} to accept` : label;
}

// "21 Nov, 5:30 pm (IST)" when a time is saved, "21 Nov" when only a date is: never a made-up time
export function dueLabel(dueDate: unknown, dueTime: unknown): string | null {
  if (!dueDate) return null;
  const time = dueTime ? String(dueTime).slice(0, 5) : null;
  const ms = deadlineInstant(String(dueDate), time);
  if (ms === null) return String(dueDate).slice(0, 10);
  const label = dateTime(ms);
  return time && /^\d{2}:\d{2}$/.test(time) ? `${label} (IST)` : label.split(',')[0];
}

// Used by the assignment code after commit. Any failure is logged without detail and never reaches the caller.
export async function noticeAfterCommit(args: { taskId: number; kind: 'assigned' | 'reassigned'; employeeIds: number[]; eventKey: string }): Promise<void> {
  try { await queueAssignmentNotice(getDB(), args); }
  catch { console.error('[whatsapp-notice] could not queue an assignment notice'); }
}

export interface GroupSender { isConnected(): boolean; sendGroup(jid: string, text: string, mentions: string[], image?: Buffer): Promise<boolean> }

// Sends pending notices. Skips everything while WhatsApp is not connected: rows wait in the outbox.
export async function processOutbox(db: Knex, sender: GroupSender, now: Date = new Date(), batch = 10): Promise<{ sent: number; failed: number; waiting: number }> {
  await refreshNotificationGroup(db);
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
    if (row.kind === 'reminder' && payload.ticketId) {
      // A ticket reminder is sent only while the same person still has not accepted the stage
      const t = await db('tasks').where({ id: payload.ticketId }).first('xlr8_status', 'xlr8_assignee_id');
      if (!t || t.xlr8_status !== 'pending_assignee' || Number(t.xlr8_assignee_id) !== Number(payload.assigneeId)) { await db('whatsapp_outbox').where({ id: row.id }).update({ status: 'cancelled', last_error: 'no_longer_needed' }); continue; }
    } else if (row.kind === 'reminder') {
      // A reminder is sent only while the assignee still has not accepted
      const a = await db('task_assignees').where({ id: payload.assignmentId }).first('acceptance_status', 'skipped');
      const stillNeeded = !!a && a.acceptance_status !== 'accepted' && !Number(a.skipped);
      if (!stillNeeded) { await db('whatsapp_outbox').where({ id: row.id }).update({ status: 'cancelled', last_error: 'no_longer_needed' }); continue; }
    }
    let ok = false;
    // A report with a card goes as an image with a short caption; if the image cannot be drawn, the full text is sent
    let image: Buffer | undefined;
    if (payload.card) try { image = renderCard(payload.card); } catch { image = undefined; }
    const text = image ? String(payload.caption) : String(payload.text);
    try { ok = await sender.sendGroup(jid, text, (payload.mentions ?? []).map(String), image); } catch { ok = false; }
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

export function buildReminderText(args: { title: string; project: string; person: { name: string; mention: string | null } }): { text: string; mentions: string[]; card: Card; caption: string } {
  const who = args.person.mention ? mentionTag(args.person.mention, args.person.name) : clean(args.person.name, 40);
  const pic = detailCard(heading(ICON.reminder, 'Acceptance reminder'), clean(args.title, 60), [
    { label: 'Project', value: args.project ? clean(args.project) : null }, { label: 'Assigned to', value: clean(args.person.name, 40) }, { label: 'Status', value: `Waiting for ${clean(args.person.name, 40)} to accept`, tone: 'warn' },
  ], who, "👉 Please accept it in Loop. The task can't start until you do.");
  const text = compose(
    heading(ICON.reminder, 'Acceptance reminder'),
    `${who}, please review and accept your assignment in Loop.`,
    [field('Task', clean(args.title)), args.project ? field('Project', clean(args.project)) : '', field('Status', `${ICON.pending} Waiting for ${clean(args.person.name, 40)} to accept`)],
    italic("The task can't start until you accept it."),
  );
  return { text, mentions: args.person.mention ? [args.person.mention] : [], ...pic };
}

// Queues one reminder per pending assignment. The key is the assignment row and the time it was assigned, so a restart
// or a retry can never queue the same reminder twice, while a later reassignment gets its own.
// ── Start point ──
// Messages are only for things that happen after the WhatsApp notices were first switched on. The moment is saved once
// (the first start of this version) and never moved, so a deploy neither replays old work nor drops new work.
const SINCE = 'notices_since';
export async function markNoticesStart(db: Knex, now: Date = new Date()): Promise<void> {
  if (await db('assistant_settings').where({ name: SINCE }).first('name').catch(() => null)) return;
  await db('assistant_settings').insert({ name: SINCE, value: String(now.getTime()), updated_at: now }).catch(() => undefined);
}
export async function noticesSince(db: Knex): Promise<number> {
  const row = await db('assistant_settings').where({ name: SINCE }).first('value').catch(() => null);
  const ms = Number(row?.value);
  return Number.isFinite(ms) ? ms : 0;   // not set (tests, or before the first start): no cut-off
}

export async function enqueueAcceptanceReminders(db: Knex, now: Date = new Date(), minutes = acceptanceReminderMinutes()): Promise<number> {
  if (!notificationGroupJid()) return 0;
  const cutoff = new Date(now.getTime() - minutes * 60_000);
  const start = await noticesSince(db);
  const rows = await db('task_assignees as ta').join('tasks as t', 't.id', 'ta.task_id')
    .whereIn('ta.assignee_role', ['employee', 'manager'])   // managers get reminders too; accepted ones are excluded below
    .whereNotNull('ta.assigned_at').where('ta.assigned_at', '<=', cutoff)
    .where('ta.assigned_at', '>=', new Date(Math.max(start, now.getTime() - REMINDER_LOOKBACK_HOURS * 3600_000)))
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
    if (!user?.name) continue;
    const built = buildReminderText({ title: String(r.title), project: proj?.name ? String(proj.name) : '', person: { name: String(user?.name ?? ''), mention } });
    try {
      await db('whatsapp_outbox').insert({
        event_key: eventKey, kind: 'reminder', task_id: Number(r.task_id),
        payload: JSON.stringify({ ...built, assignmentId: Number(r.id) }), status: 'pending', attempts: 0, next_attempt_at: now,
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
}): { text: string; mentions: string[]; card: Card; caption: string } {
  const left = args.minutesLeft >= 120 ? `about ${plural(Math.round(args.minutesLeft / 60), 'hour')}` : `about ${plural(args.minutesLeft, 'minute')}`;
  const pic = detailCard(heading(ICON.deadline, 'Deadline approaching'), clean(args.title, 60), [
    { label: 'Time left', value: left, tone: 'bad' }, { label: 'Due', value: args.dueLabel },
    { label: 'Project', value: args.project ? clean(args.project) : null }, { label: 'Assigned to', value: plainNames(args.people) },
  ], names(args.people), '👉 Please wrap up or update the task in Loop.');
  const text = compose(
    heading(ICON.deadline, 'Deadline approaching'),
    `${bold(left)} left on this task.`,
    [field('Task', clean(args.title)), args.project ? field('Project', clean(args.project)) : '', field('Due', args.dueLabel), field('Assigned to', names(args.people))],
    '👉 Please wrap up or update the task in Loop.',
  );
  return { text, mentions: mentionsOf(args.people), ...pic };
}

export function buildOverdueText(args: {
  title: string; project: string; dueLabel: string; minutesLate: number; status: string | null;
  people: { name: string; mention: string | null }[];
}): { text: string; mentions: string[]; card: Card; caption: string } {
  const late = args.minutesLate >= 120 ? `about ${plural(Math.round(args.minutesLate / 60), 'hour')}` : plural(args.minutesLate, 'minute');
  const head = heading('🚨', 'Deadline crossed');
  const pic = detailCard(head, clean(args.title, 60), [
    { label: 'Overdue by', value: late, tone: 'bad' }, { label: 'Was due', value: args.dueLabel },
    { label: 'Project', value: args.project ? clean(args.project) : null }, { label: 'Assigned to', value: plainNames(args.people) },
    { label: 'Status', value: args.status, tone: 'warn' },
  ], names(args.people), '👉 Please finish it or update the deadline in Loop.');
  const text = compose(
    head,
    `This task is ${bold(late)} past its deadline.`,
    [field('Task', clean(args.title)), args.project ? field('Project', clean(args.project)) : '', field('Was due', args.dueLabel), field('Assigned to', names(args.people)), args.status ? field('Status', args.status) : ''],
    '👉 Please finish it or update the deadline in Loop.',
  );
  return { text, mentions: mentionsOf(args.people), ...pic };
}

const OVERDUE_LOOKBACK_HOURS = 24;   // a deadline crossed longer ago than this (e.g. while WhatsApp was down) is not announced late

// Queues, per task deadline, one "approaching" alert and one "crossed" alert. Each key is the task and its exact deadline
// instant, so neither repeats across passes, retries or restarts; a changed deadline is a new deadline with its own alerts.
export async function enqueueDeadlineAlerts(db: Knex, now: Date = new Date(), percent = deadlineAlertPercent()): Promise<number> {
  if (!notificationGroupJid()) return 0;
  const start = await noticesSince(db);
  const nowMs = now.getTime();
  const tasks = await db('tasks as t').leftJoin('projects as p', 'p.id', 't.project_id')
    .whereNotNull('t.due_date')
    .whereNotIn('t.status', ['completed', 'cancelled', 'draft', 'pending_approval'])
    .where((q: any) => q.whereNull('t.pending_assign').orWhere('t.pending_assign', 0))
    .select('t.id', 't.title', 't.due_date', 't.due_time', 't.estimated_hours', 't.status', 't.xlr8_status', 'p.name as project_name', 't.ticket_type_id', 't.xlr8_assignee_id');
  let queued = 0;
  for (const t of tasks) {
    const deadlineMs = deadlineInstant(String(t.due_date), t.due_time ?? null);
    if (deadlineMs === null) continue;
    const est = Number(t.estimated_hours) || 0;
    // Approaching: only when an estimate exists, and only if it fell due after the start point
    const approaching = est > 0 && deadlineAlertDue({ deadlineMs, estimatedHours: est, nowMs, percent })
      && deadlineMs - (est * 3_600_000 * percent) / 100 >= start;
    // Crossed: the deadline passed after the start point, recently, and the task is still open
    const crossed = deadlineMs <= nowMs && deadlineMs >= start && nowMs - deadlineMs <= OVERDUE_LOOKBACK_HOURS * 3600_000;
    if (!approaching && !crossed) continue;
    const eventKey = crossed ? `overdue:${t.id}:${deadlineMs}` : `deadline:${t.id}:${deadlineMs}`;
    if (await db('whatsapp_outbox').where({ event_key: eventKey }).first('id')) continue;
    // A multi-stage ticket: the person holding the current stage
    const people = t.ticket_type_id
      ? (t.xlr8_assignee_id ? await db('users').where({ id: t.xlr8_assignee_id }).select('id as user_id', 'name') : [])
      : await db('task_assignees as ta').join('users as u', 'u.id', 'ta.user_id')
      .where('ta.task_id', t.id).where('ta.assignee_role', 'employee')
      .where((q: any) => q.whereNull('ta.skipped').orWhere('ta.skipped', 0))
      .where((q: any) => q.whereNull('ta.acceptance_status').orWhereNot('ta.acceptance_status', 'declined'))
      .select('ta.user_id', 'u.name');
    if (!people.length) continue;
    const identities = await db('assistant_identities').whereIn('user_id', people.map((p: any) => p.user_id))
      .where({ status: 'active', channel: 'whatsapp' }).select('user_id', 'external_sender_id');
    const jidBy = new Map<number, string>();
    for (const i of identities) { const jid = jidForIdentity(String(i.external_sender_id)); if (jid) jidBy.set(Number(i.user_id), jid); }
    const list = people.map((p: any) => ({ name: String(p.name), mention: jidBy.get(Number(p.user_id)) ?? null }));
    const due = dueLabel(t.due_date, t.due_time) ?? dateTime(deadlineMs);
    const project = t.project_name ? String(t.project_name) : '';
    const built = crossed
      ? buildOverdueText({ title: String(t.title), project, dueLabel: due, minutesLate: Math.max(1, Math.floor((nowMs - deadlineMs) / 60_000)), status: statusLabel(t, list.map((p) => p.name)) || null, people: list })
      : buildDeadlineText({ title: String(t.title), project, dueLabel: due, minutesLeft: Math.max(1, Math.ceil((deadlineMs - nowMs) / 60_000)), people: list });
    try {
      await db('whatsapp_outbox').insert({
        event_key: eventKey, kind: 'deadline', task_id: Number(t.id),
        payload: JSON.stringify({ ...built, taskId: Number(t.id) }), status: 'pending', attempts: 0, next_attempt_at: now,
      });
      queued++;
    } catch (err: any) {
      if (!/unique|duplicate/i.test(String(err?.message))) throw err;
    }
  }
  return queued;
}

// ── Multi-stage (XLR8) tickets ──
// Their stages are handed out by the ticket workflow, not by the task assignment code, so they are found here: a ticket
// waiting for its current stage holder to accept gets the "assigned" notice, then one acceptance reminder.
const TICKET_NOTICE_HOURS = 2;   // a waiting ticket older than this gets no "assigned" notice (no flood after a deploy)
export async function enqueueTicketNotices(db: Knex, now: Date = new Date(), minutes = acceptanceReminderMinutes()): Promise<number> {
  if (!notificationGroupJid()) return 0;
  const start = await noticesSince(db);
  const waiting = await db('tasks as t').leftJoin('projects as p', 'p.id', 't.project_id')
    .whereNotNull('t.ticket_type_id').where('t.xlr8_status', 'pending_assignee').whereNotNull('t.xlr8_assignee_id')
    .whereNotIn('t.status', ['completed', 'cancelled'])
    .select('t.id', 't.title', 't.priority', 't.due_date', 't.due_time', 't.xlr8_assignee_id', 't.status', 't.xlr8_status', 't.ticket_type_id', 'p.name as project_name');
  let queued = 0;
  for (const t of waiting) {
    // When it started waiting for this person: the latest hand-over in the ticket log
    const log = await db('xlr8_ticket_log').where({ task_id: t.id, to_state: 'pending_assignee' }).orderBy('id', 'desc').first('created_at').catch(() => null);
    const since = log?.created_at ? toMs(log.created_at) : NaN;
    if (!Number.isFinite(since) || since < start || now.getTime() - since > REMINDER_LOOKBACK_HOURS * 3600_000) continue;
    const user = await db('users').where({ id: t.xlr8_assignee_id }).first('name');
    const identity = await db('assistant_identities').where({ user_id: t.xlr8_assignee_id, status: 'active', channel: 'whatsapp' }).first('external_sender_id');
    if (!user?.name) continue;
    const person = { name: String(user.name), mention: identity ? jidForIdentity(String(identity.external_sender_id)) : null };
    const project = t.project_name ? String(t.project_name) : '';
    const due: { kind: string; key: string; build: () => object; extra: object }[] = [];
    if (now.getTime() - since <= TICKET_NOTICE_HOURS * 3600_000) due.push({ kind: 'assigned', key: `tassign:${t.id}:${t.xlr8_assignee_id}:${since}`, extra: {},
      build: () => buildAssignmentText({ kind: 'assigned', title: String(t.title), project, priority: t.priority ?? null, due: dueLabel(t.due_date, t.due_time), people: [person], status: statusLabel(t, [person.name]) }) });
    if (now.getTime() - since >= minutes * 60_000) due.push({ kind: 'reminder', key: `tremind:${t.id}:${t.xlr8_assignee_id}:${since}`, extra: { ticketId: Number(t.id), assigneeId: Number(t.xlr8_assignee_id) },
      build: () => buildReminderText({ title: String(t.title), project, person }) });
    for (const d of due) {
      if (await db('whatsapp_outbox').where({ event_key: d.key }).first('id')) continue;
      const built = d.build();
      try {
        await db('whatsapp_outbox').insert({ event_key: d.key, kind: d.kind, task_id: Number(t.id), payload: JSON.stringify({ ...built, ...d.extra }), status: 'pending', attempts: 0, next_attempt_at: now });
        queued++;
      } catch (err: any) { if (!/unique|duplicate/i.test(String(err?.message))) throw err; }
    }
  }
  return queued;
}

// ── Over the estimated time ──
// Same numbers the Loop app shows ("+01:31 over"): timer time on the stage (ticket) or task, by its assignees, against
// the estimate. One alert per stage (ticket) or per task, once the logged time passes the estimate after the start point.
const dur = (sec: number) => { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60); return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(Math.floor(sec % 60)).padStart(2, '0')}s`; };

export function buildOvertimeText(args: {
  title: string; project: string; stage: string | null; estSec: number; loggedSec: number; status: string | null;
  people: { name: string; mention: string | null }[];
}): { text: string; mentions: string[]; card: Card; caption: string } {
  const head = heading('⏱️', 'Over the estimated time');
  const over = dur(args.loggedSec - args.estSec);
  const pic = detailCard(head, clean(args.title, 60), [
    { label: 'Over by', value: over, tone: 'bad' }, { label: 'Estimated', value: dur(args.estSec) }, { label: 'Logged', value: dur(args.loggedSec) },
    { label: 'Stage', value: args.stage }, { label: 'Project', value: args.project ? clean(args.project) : null },
    { label: 'Assigned to', value: plainNames(args.people) }, { label: 'Status', value: args.status, tone: 'warn' },
  ], names(args.people), '👉 Please wrap up, or update the estimate in Loop.');
  const text = compose(
    head,
    `${bold(over)} over the estimated time.`,
    [field('Task', clean(args.title)), args.stage ? field('Stage', args.stage) : '', args.project ? field('Project', clean(args.project)) : '',
      field('Estimated', dur(args.estSec)), field('Logged', dur(args.loggedSec)), field('Assigned to', names(args.people)), args.status ? field('Status', args.status) : ''],
    '👉 Please wrap up, or update the estimate in Loop.',
  );
  return { text, mentions: mentionsOf(args.people), ...pic };
}

export async function enqueueOvertimeAlerts(db: Knex, now: Date = new Date()): Promise<number> {
  if (!notificationGroupJid()) return 0;
  const start = await noticesSince(db);
  const nowMs = now.getTime();
  const tasks = await db('tasks as t').leftJoin('projects as p', 'p.id', 't.project_id')
    .whereNotIn('t.status', ['completed', 'cancelled', 'draft', 'pending_approval'])
    // Time only goes over while a timer runs: only tasks with a running timer (or one stopped in the last few minutes)
    .whereIn('t.id', db('task_sessions').where((q: any) => q.whereNull('ended_at').orWhere('ended_at', '>=', new Date(nowMs - 5 * 60_000))).select('task_id'))
    .select('t.id', 't.title', 't.status', 't.xlr8_status', 't.ticket_type_id', 't.xlr8_stage_idx', 't.estimated_hours', 'p.name as project_name');
  let queued = 0;
  for (const t of tasks) {
    const stageIdx = t.ticket_type_id ? Number(t.xlr8_stage_idx ?? 0) : null;
    // Who is on it and the estimate: the current stage's assignees (ticket) or the task's assignees and estimate (task)
    const rows = await db('task_assignees').where({ task_id: t.id }).whereNotNull('user_id')
      .where((q: any) => q.whereNull('skipped').orWhere('skipped', 0))
      .modify((q: any) => { if (stageIdx !== null) q.where('stage_idx', stageIdx); else q.where('assignee_role', 'employee'); })
      .select('user_id', 'est_hours');
    if (!rows.length) continue;
    const estSec = stageIdx !== null ? rows.reduce((n: number, r: any) => n + (Number(r.est_hours) || 0) * 3600, 0) : (Number(t.estimated_hours) || 0) * 3600;
    if (!(estSec > 0)) continue;
    const userIds = rows.map((r: any) => Number(r.user_id));
    const sessions = await db('task_sessions').where({ task_id: t.id }).whereIn('user_id', userIds)
      .modify((q: any) => { if (stageIdx !== null) q.where((w: any) => w.where('stage_idx', stageIdx).orWhereNull('stage_idx')); })
      .select('started_at', 'ended_at');
    let loggedSec = 0;
    for (const x of sessions) {
      const a = toMs(x.started_at), b = x.ended_at ? toMs(x.ended_at) : nowMs;
      if (Number.isFinite(a) && Number.isFinite(b) && b > a) loggedSec += (b - a) / 1000;
    }
    if (loggedSec <= estSec) continue;
    // The moment it went over; only announced if that was after the start point
    if (nowMs - (loggedSec - estSec) * 1000 < start) continue;
    const eventKey = stageIdx !== null ? `overtime:${t.id}:${stageIdx}` : `overtime:${t.id}`;
    if (await db('whatsapp_outbox').where({ event_key: eventKey }).first('id')) continue;
    const users = await db('users').whereIn('id', userIds).select('id', 'name');
    const identities = await db('assistant_identities').whereIn('user_id', userIds).where({ status: 'active', channel: 'whatsapp' }).select('user_id', 'external_sender_id');
    const jidBy = new Map<number, string>();
    for (const i of identities) { const jid = jidForIdentity(String(i.external_sender_id)); if (jid) jidBy.set(Number(i.user_id), jid); }
    const people = users.map((u: any) => ({ name: String(u.name), mention: jidBy.get(Number(u.id)) ?? null }));
    let stageName: string | null = null;
    if (stageIdx !== null) {
      const tt = await db('xlr8_ticket_types').where({ id: t.ticket_type_id }).first('stages').catch(() => null);
      const st = (() => { try { return (typeof tt?.stages === 'string' ? JSON.parse(tt.stages) : tt?.stages ?? [])[stageIdx]; } catch { return null; } })();
      stageName = st ? `Stage ${stageIdx + 1} · ${st.type === 'admin' ? 'Admin Review' : st.type === 'manager' ? 'Manager Review' : st.category_name ?? ''}`.replace(/ · $/, '') : `Stage ${stageIdx + 1}`;
    }
    const built = buildOvertimeText({ title: String(t.title), project: t.project_name ? String(t.project_name) : '', stage: stageName,
      estSec: Math.round(estSec), loggedSec: Math.round(loggedSec), status: statusLabel(t, people.map((p) => p.name)) || null, people });
    try {
      await db('whatsapp_outbox').insert({ event_key: eventKey, kind: 'deadline', task_id: Number(t.id),
        payload: JSON.stringify({ ...built, taskId: Number(t.id) }), status: 'pending', attempts: 0, next_attempt_at: now });
      queued++;
    } catch (err: any) { if (!/unique|duplicate/i.test(String(err?.message))) throw err; }
  }
  return queued;
}
