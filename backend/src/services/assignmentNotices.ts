// WhatsApp group notices for task assignments. Loop is the source of truth; WhatsApp is only a notification channel.
// A notice is queued in the outbox after the assignment commits, and a worker sends it to the one configured group.
// Nothing here changes an assignment. A failure to queue or send never rolls back or blocks the assignment.
import { recordEscalation } from './escalations';
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
// A tag in the text. A hidden-id (@lid) person: "@<id>". A person linked by phone number: "@Name"; the WhatsApp sender
// swaps it for their id in that group (that is what makes WhatsApp notify them). No phone number is ever shown.
export const mentionTag = (jid: string, name: string) => (String(jid).endsWith('@lid') ? `@${String(jid).split('@')[0]}` : `@${clean(name, 40)}`);
// Who "@Name" in the text is. The WhatsApp sender uses it to tag a person linked by phone number by their id in the group.
export interface Tag { jid: string; name: string }

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
  // The project is the card's heading; the task or ticket name sits first in the rows, where the project was
  const project = fields.find((f) => f.label === 'Project' && f.value);
  if (project) { fields = fields.map((f) => (f === project ? { label: 'Title', value: title } : f)); title = clean(String(project.value), 60); }
  const card: Card = { title, subtitle: plain(head), columns: [], rows: [], fields: fields.filter((f) => f.value).map((f) => ({ ...f, value: plain(String(f.value)) })) };
  // Heading, then who, then what to do: each on its own line with a gap, so it reads cleanly under the picture
  return { card, caption: [head, tags.includes('@') ? `👥 ${tags}` : '', action].filter(Boolean).join('\n\n') };
}
const plainNames = (people: { name: string }[]) => people.map((p) => clean(p.name, 40)).join(', ') || '—';
const tagsOf = (people: { name: string; mention: string | null }[]): Tag[] => people.filter((p) => p.mention).map((p) => ({ jid: p.mention!, name: clean(p.name, 40) }));
const mentionsOf = (people: { mention: string | null }[]) => people.map((p) => p.mention).filter((m): m is string => !!m);

export function buildAssignmentText(args: {
  kind: 'assigned' | 'reassigned'; title: string; project: string; priority: string | null; due: string | null;
  people: { name: string; mention: string | null }[]; status?: string | null; ticket?: boolean; createdBy?: string | null; link?: string | null;
}): { text: string; mentions: string[]; tags: Tag[]; card: Card; caption: string } {
  const status = args.status || null;   // from the saved task only; left out when unknown
  const what = args.ticket ? 'ticket' : 'task';
  const open = args.link ? `\n\n🔗 ${args.link}` : '';
  const head = args.kind === 'reassigned' ? heading(ICON.reassigned, `${args.ticket ? 'Ticket' : 'Task'} reassigned`) : heading(ICON.task, args.ticket ? 'New ticket created' : 'New task assigned');
  const pic = detailCard(head, clean(args.title, 60), [
    { label: 'Project', value: args.project ? clean(args.project) : null },
    { label: 'Created by', value: args.createdBy ? clean(args.createdBy, 40) : null }, { label: 'Assigned to', value: plainNames(args.people) },
    { label: 'Priority', value: args.priority ? priority(args.priority) : null, tone: tone(args.priority) },
    { label: 'Deadline', value: args.due }, { label: 'Status', value: status, tone: 'warn' },
  ], names(args.people), `👉 Please review the ${what} and accept it in Loop.${open}`);
  const text = compose(
    head,
    [
      field('Task', clean(args.title)),
      args.project ? field('Project', clean(args.project)) : '',
      args.createdBy ? field('Created by', clean(args.createdBy, 40)) : '',
      field('Assigned to', names(args.people)),
      args.priority ? field('Priority', priority(args.priority)) : '',
      args.due ? field('Deadline', args.due) : '',
      status ? field('Status', `${ICON.pending} ${status}`) : '',
    ],
    `👉 Please review the ${what} and accept it in Loop.${open}`,
  );
  return { text, mentions: mentionsOf(args.people), tags: tagsOf(args.people), ...pic };
}

// The personal copy of an assignment, sent to one person's private chat: the same card, addressed to them
export function buildDirectAssignment(args: {
  kind: 'assigned' | 'reassigned'; title: string; project: string; priority: string | null; due: string | null;
  name: string; status?: string | null; ticket?: boolean; link?: string | null;
}): { text: string; mentions: string[]; tags: Tag[]; card: Card; caption: string } {
  const what = args.ticket ? 'ticket' : 'task';
  const open = args.link ? `\n\n🔗 ${args.link}` : '';
  const head = heading(args.kind === 'reassigned' ? ICON.reassigned : ICON.task, args.kind === 'reassigned' ? `A ${what} has been reassigned to you` : `You have a new ${what}`);
  const pic = detailCard(head, clean(args.title, 60), [
    { label: 'Project', value: args.project ? clean(args.project) : null },
    { label: 'Priority', value: args.priority ? priority(args.priority) : null, tone: tone(args.priority) },
    { label: 'Deadline', value: args.due }, { label: 'Status', value: args.status || null, tone: 'warn' },
  ], '', `Hi ${firstName(args.name)}, please review the ${what} and accept it in Loop.${open}`);
  const text = compose(
    head,
    `Hi ${firstName(args.name)}, please review the ${what} and accept it in Loop.${open}`,
    [field('Title', clean(args.title)), args.project ? field('Project', clean(args.project)) : '', args.priority ? field('Priority', priority(args.priority)) : '', args.due ? field('Deadline', args.due) : ''],
  );
  return { text, mentions: [], tags: [], ...pic };
}
const firstName = (n: string) => clean(n, 40).split(' ')[0] || clean(n, 40);
// A private chat with one linked person (never a group, never built from anything but a verified identity)
export const DM_JID = /^\d{5,20}@(s\.whatsapp\.net|lid)$/;
// Keys the earlier version used for the same event. The earlier version had one group alert per task (no person in
// the key) and ticket keys with the stage holder in the middle. An event it already sent is never sent again after a
// deploy, in any new form (private copy, group follow-up, per-person reminder).
export function earlierKeys(key: string): { exact: string[]; like: string[] } {
  const p = key.split(':');
  const exact: string[] = [];
  const like: string[] = [];
  // deadline:T:MS:x, overdue:T:MS:x / :group, overtime:T(:STAGE):x → the shorter key without the person
  if (['deadline', 'overdue', 'overtime'].includes(p[0])) for (let n = 2; n < p.length; n++) exact.push(p.slice(0, n).join(':'));
  // Tickets: tassign:T:S (and its private copy dm:tassign:T:S:U) → tassign:T:<holder>:S; tremind:T:S:U → tremind:T:U:S
  const t = p[0] === 'dm' ? p.slice(1) : p;
  if (t[0] === 'tassign' && t.length >= 3) like.push(`tassign:${t[1]}:%:${t[2]}`);
  if (t[0] === 'tremind' && t.length === 4) exact.push(`tremind:${t[1]}:${t[3]}:${t[2]}`);
  return { exact, like };
}
async function insertRow(db: Knex, row: { event_key: string; kind: string; task_id: number; payload: object; now: Date }): Promise<boolean> {
  row = { ...row, event_key: row.event_key.slice(0, 120) };
  if (await db('whatsapp_outbox').where({ event_key: row.event_key }).first('id')) return false;
  const old = earlierKeys(row.event_key);
  if (old.exact.length && await db('whatsapp_outbox').whereIn('event_key', old.exact).first('id')) return false;
  for (const l of old.like) if (await db('whatsapp_outbox').where('event_key', 'like', l).whereNot('event_key', 'like', 'dm:%').first('id')) return false;
  try {
    await db('whatsapp_outbox').insert({ event_key: row.event_key, kind: row.kind, task_id: row.task_id, payload: JSON.stringify(row.payload), status: 'pending', attempts: 0, next_attempt_at: row.now });
    return true;
  } catch (err: any) { if (/unique|duplicate/i.test(String(err?.message))) return false; throw err; }
}

// The task's share page (the same link Loop's Share button gives), so people can open it straight from WhatsApp.
// Made once per task and reused; none when the site address isn't configured.
export async function shareLink(db: Knex, taskId: number): Promise<string | null> {
  const site = String(process.env.FRONTEND_URL || process.env.PUBLIC_APP_URL || '').split(',')[0].trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(site)) return null;
  let row = await db('task_share_tokens').where({ task_id: taskId }).first('token').catch(() => null);
  if (!row) {
    const token = (await import('crypto')).randomBytes(32).toString('hex');
    await db('task_share_tokens').insert({ task_id: taskId, token }).catch(() => undefined);
    row = await db('task_share_tokens').where({ task_id: taskId }).first('token').catch(() => null);   // a parallel insert wins: same link
  }
  return row?.token ? `${site}/share/task/${row.token}` : null;
}

// Queues one notice for one assignment event. Returns 'duplicate' if this event was already queued.
export async function queueAssignmentNotice(db: Knex, args: {
  taskId: number; kind: 'assigned' | 'reassigned'; employeeIds: number[]; eventKey: string; now?: Date;
}): Promise<'queued' | 'duplicate' | 'disabled' | 'no_assignee'> {
  await refreshNotificationGroup(db);
  if (!notificationGroupJid()) return 'disabled';
  const assigned = [...new Set(args.employeeIds.map(Number).filter((n) => n > 0))];
  if (!assigned.length) return 'no_assignee';
  // Managers on the task are involved too: listed, tagged and asked to accept like the employees
  const employeeIds = [...new Set([...assigned, ...(await involvedManagers(db, args.taskId))])];
  if (await db('whatsapp_outbox').where({ event_key: args.eventKey }).first('id')) return 'duplicate';
  const task = await db('tasks as t').leftJoin('projects as p', 'p.id', 't.project_id')
    .leftJoin('users as cb', 'cb.id', 't.created_by')
    .where('t.id', args.taskId).select('t.title', 't.priority', 't.due_date', 't.due_time', 't.status', 't.ticket_type_id', 't.xlr8_status', 'p.name as project_name', 'cb.name as created_by_name').first();
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
  const common = { kind: args.kind, title: String(task.title), project: task.project_name ? String(task.project_name) : '',
    priority: task.priority ?? null, due: dueLabel(task.due_date, task.due_time), ticket: !!task.ticket_type_id, createdBy: task.created_by_name ?? null,
    link: await shareLink(db, args.taskId) };
  // "Waiting for … to accept" names only the people who have not accepted yet (from Loop)
  const accepted = new Set((await db('task_assignees').where({ task_id: args.taskId, acceptance_status: 'accepted' }).select('user_id')).map((r: any) => Number(r.user_id)));
  const waiting = employeeIds.filter((id) => byId.has(id) && !accepted.has(id)).map((id) => byId.get(id)!);
  const built = buildAssignmentText({ ...common, people, status: statusLabel(task, waiting) });
  const now = args.now ?? new Date();
  // Each linked person also gets their own copy in a private chat
  for (const p of people) {
    if (!p.mention) continue;
    await insertRow(db, { event_key: `dm:${args.eventKey}:${p.mention.split('@')[0].slice(-12)}`, kind: args.kind, task_id: args.taskId, now,
      payload: { ...buildDirectAssignment({ ...common, name: p.name, status: statusLabel(task, []) }), to: p.mention } });
  }
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
// Managers on a task (any stage), not skipped or declined
async function involvedManagers(db: Knex, taskId: number): Promise<number[]> {
  return (await db('task_assignees').where({ task_id: taskId, assignee_role: 'manager' }).whereNotNull('user_id')
    .where((q: any) => q.whereNull('skipped').orWhere('skipped', 0))
    .where((q: any) => q.whereNull('acceptance_status').orWhereNot('acceptance_status', 'declined'))
    .select('user_id')).map((r: any) => Number(r.user_id));
}

export async function noticeAfterCommit(args: { taskId: number; kind: 'assigned' | 'reassigned'; employeeIds: number[]; eventKey: string }): Promise<void> {
  try { await queueAssignmentNotice(getDB(), args); }
  catch { console.error('[whatsapp-notice] could not queue an assignment notice'); }
}

export interface GroupSender { isConnected(): boolean; sendGroup(jid: string, text: string, mentions: string[], image?: Buffer, tags?: Tag[]): Promise<boolean> }

// Sends pending notices. Skips everything while WhatsApp is not connected: rows wait in the outbox.
export async function processOutbox(db: Knex, sender: GroupSender, now: Date = new Date(), batch = 10): Promise<{ sent: number; failed: number; waiting: number }> {
  await refreshNotificationGroup(db);
  const jid = notificationGroupJid();
  if (!sender.isConnected()) return { sent: 0, failed: 0, waiting: await db('whatsapp_outbox').where({ status: 'pending' }).count({ n: '*' }).first().then((r: any) => Number(r.n)) };
  const due = await db('whatsapp_outbox').where({ status: 'pending' }).where('next_attempt_at', '<=', now).orderBy('id').limit(batch);
  let sent = 0; let failed = 0;
  for (const row of due) {
    const ttlMs = String(row.kind).startsWith('report_') ? REPORT_TTL_MINUTES * 60_000 : NOTICE_TTL_HOURS * 3600_000;
    const expired = now.getTime() - toMs(row.created_at) > ttlMs;
    if (expired) { await db('whatsapp_outbox').where({ id: row.id }).update({ status: 'failed', last_error: 'expired' }); failed++; continue; }
    const payload = JSON.parse(String(row.payload));
    // Where it goes: a person's private chat (only a verified identity's JID), or the configured group
    const dest = payload.to ? (DM_JID.test(String(payload.to)) ? String(payload.to) : null) : jid;
    if (!dest) {
      if (payload.to) { await db('whatsapp_outbox').where({ id: row.id }).update({ status: 'failed', last_error: 'bad_destination' }); failed++; }
      continue;   // no group chosen yet: a group notice waits
    }
    if (row.kind === 'interview' && payload.iv) {
      // Before the interview: only while that slot still stands. After it: only while feedback is still missing.
      const s = await db('rec_schedules').where({ id: payload.iv.scheduleId }).first('status', 'date', 'start_time', 'interviewers');
      const a = s ? await db('rec_schedules as s').join('rec_applications as a', 'a.id', 's.application_id').where('s.id', payload.iv.scheduleId).first('a.status') : null;
      const slotOk = !!s && deadlineInstant(String(s.date).slice(0, 10), s.start_time) === payload.iv.startMs && (payload.iv.after ? ['scheduled', 'completed'] : ['scheduled']).includes(s.status)
        && !['selected', 'rejected', 'withdrawn'].includes(a?.status);
      const missing = slotOk ? await stillNeeded(db, payload.iv.scheduleId, payload.iv.userIds, !!payload.iv.after) : [];
      if (!slotOk || !missing.length) { await db('whatsapp_outbox').where({ id: row.id }).update({ status: 'cancelled', last_error: 'no_longer_needed' }); continue; }
    }
    if (row.kind === 'escalation') {
      // Only the people who still have not accepted are named; nobody left means nothing is sent
      const still: any[] = [];
      for (const p of payload.people ?? []) if (await stillWaiting(db, p)) still.push(p);
      if (!still.length) { await db('whatsapp_outbox').where({ id: row.id }).update({ status: 'cancelled', last_error: 'no_longer_needed' }); continue; }
      Object.assign(payload, buildEscalationText({ ...payload.args, people: still }));
    }
    if (row.kind === 'deadline') {
      // A deadline alert is not sent once the task is finished or cancelled
      const t = await db('tasks').where({ id: payload.taskId }).first('status');
      if (!t || t.status === 'completed' || t.status === 'cancelled') { await db('whatsapp_outbox').where({ id: row.id }).update({ status: 'cancelled', last_error: 'no_longer_needed' }); continue; }
    }
    if (row.kind === 'turn') {
      // Only while the ticket is still with that person at that step
      const t = await db('tasks').where({ id: payload.turnTaskId }).first('xlr8_status', 'xlr8_assignee_id');
      if (!t || t.xlr8_status !== payload.turnState || Number(t.xlr8_assignee_id) !== Number(payload.turnUser)) { await db('whatsapp_outbox').where({ id: row.id }).update({ status: 'cancelled', last_error: 'no_longer_needed' }); continue; }
    }
    if (row.kind === 'approval') {
      // Sent only while the work still waits for this manager's pod
      const t = await db('tasks').where({ id: payload.approvalTaskId }).first('status', 'crosspod_pods');
      let pods: string[] = []; try { pods = JSON.parse(t?.crosspod_pods ?? '[]') ?? []; } catch { pods = []; }
      if (!t || t.status !== 'pending_approval' || !pods.includes(payload.pod)) { await db('whatsapp_outbox').where({ id: row.id }).update({ status: 'cancelled', last_error: 'no_longer_needed' }); continue; }
    }
    if (row.kind === 'reminder' && payload.ticketId) {
      // A ticket reminder is sent only while the same person still has not accepted the stage
      if (!(await stillWaiting(db, payload))) { await db('whatsapp_outbox').where({ id: row.id }).update({ status: 'cancelled', last_error: 'no_longer_needed' }); continue; }
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
    try { ok = await sender.sendGroup(dest, text, (payload.mentions ?? []).map(String), image, Array.isArray(payload.tags) ? payload.tags : []); } catch { ok = false; }
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

// ── Acceptance follow-up ──
// After an assignment: a private reminder at 5 minutes and another at 10, then at 12 minutes the people who still have
// not accepted are named in the group with their manager and the admins. Each step is sent once, and only while it is
// still on time (a step that was missed, e.g. while WhatsApp was down, is skipped rather than sent late).
export function acceptanceReminderMinutes(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.ACCEPTANCE_REMINDER_MINUTES ?? 5);
  return Number.isFinite(n) && n >= 1 && n <= 1440 ? n : 5;
}
export function acceptanceEscalateMinutes(env: NodeJS.ProcessEnv = process.env, first = acceptanceReminderMinutes(env)): number {
  const n = Number(env.ACCEPTANCE_ESCALATE_MINUTES ?? 12);
  return Number.isFinite(n) && n > first * 2 && n <= 2880 ? n : first * 2 + 2;
}
const STEP_GRACE_MINUTES = 60;   // an escalation more than an hour late is not sent

// Which follow-up steps are due now for something waiting since `sinceMs`
export function followUpSteps(sinceMs: number, nowMs: number, first = acceptanceReminderMinutes()): ('remind1' | 'remind2' | 'escalate')[] {
  const m = (nowMs - sinceMs) / 60_000;
  const esc = acceptanceEscalateMinutes(process.env, first);
  const out: ('remind1' | 'remind2' | 'escalate')[] = [];
  if (m >= first && m < first * 2) out.push('remind1');
  if (m >= first * 2 && m < esc) out.push('remind2');
  if (m >= esc && m < esc + STEP_GRACE_MINUTES) out.push('escalate');
  return out;
}

export function buildReminderText(args: { title: string; project: string; person: { name: string; mention: string | null }; n?: number; ticket?: boolean; due?: string | null }): { text: string; mentions: string[]; tags: Tag[]; card: Card; caption: string } {
  const what = args.ticket ? 'ticket' : 'task';
  const second = (args.n ?? 1) >= 2;
  const head = heading(ICON.reminder, second ? 'Second reminder: acceptance pending' : 'Reminder: acceptance pending');
  const ask = second
    ? `Hi ${firstName(args.person.name)}, this ${what} is still waiting for you. If it is not accepted in the next few minutes, your manager will be informed.`
    : `Hi ${firstName(args.person.name)}, this ${what} is waiting for your acceptance. Please review it and accept it in Loop.`;
  const pic = detailCard(head, clean(args.title, 60), [
    { label: 'Project', value: args.project ? clean(args.project) : null }, { label: 'Deadline', value: args.due ?? null },
    { label: 'Status', value: 'Waiting for your acceptance', tone: 'warn' },
  ], '', ask);
  const text = compose(head, ask, [field('Title', clean(args.title)), args.project ? field('Project', clean(args.project)) : '', args.due ? field('Deadline', args.due) : '']);
  return { text, mentions: [], tags: [], ...pic };
}

export function buildEscalationText(args: {
  title: string; project: string; minutes: number; ticket?: boolean;
  people: { name: string; mention: string | null }[]; managers: { name: string; mention: string | null }[];
}): { text: string; mentions: string[]; tags: Tag[]; card: Card; caption: string } {
  const what = args.ticket ? 'ticket' : 'task';
  const head = heading('🚩', 'Acceptance overdue');
  // Private reminders reach only people whose WhatsApp is linked in Loop: say what actually happened
  const reminded = args.people.every((p) => p.mention);
  // Acceptance follow-up is the managers' job: admins are not tagged here
  const leads = args.managers.filter((p, i, a) => a.findIndex((q) => q.name === p.name) === i);
  const pic = detailCard(head, clean(args.title, 60), [
    { label: 'Project', value: args.project ? clean(args.project) : null },
    { label: 'Not accepted', value: plainNames(args.people), tone: 'bad' },
    { label: 'Waiting for', value: `${plural(args.minutes, 'minute')}`, tone: 'warn' },
    { label: 'Reminders', value: reminded ? '2 sent in private chat' : 'Not sent: WhatsApp not linked in Loop' },
  ], '', [`❗ *Not accepted:* ${names(args.people)}`, leads.length ? `👉 *Please follow up:* ${names(leads)}` : ''].filter(Boolean).join('\n'));
  const text = compose(
    head,
    `${names(args.people)} ${args.people.length === 1 ? 'has' : 'have'} not accepted this ${what} after ${plural(args.minutes, 'minute')}${reminded ? ' and two private reminders' : ''}.`,
    [field('Title', clean(args.title)), args.project ? field('Project', clean(args.project)) : ''],
    leads.length ? `👉 ${names(leads)}, please follow up.` : '',
  );
  const all = [...args.people, ...leads];
  return { text, mentions: mentionsOf(all), tags: tagsOf(all), ...pic };
}

// A name and a verified WhatsApp JID (if linked) for each user
async function peopleFor(db: Knex, userIds: number[]): Promise<Map<number, { name: string; mention: string | null }>> {
  const ids = [...new Set(userIds.map(Number).filter((n) => n > 0))];
  const out = new Map<number, { name: string; mention: string | null }>();
  if (!ids.length) return out;
  const users = await db('users').whereIn('id', ids).select('id', 'name');
  const identities = await db('assistant_identities').whereIn('user_id', ids).where({ status: 'active', channel: 'whatsapp' }).select('user_id', 'external_sender_id');
  const jid = new Map<number, string>();
  for (const i of identities) { const j = jidForIdentity(String(i.external_sender_id)); if (j) jid.set(Number(i.user_id), j); }
  for (const u of users) if (u.name) out.set(Number(u.id), { name: String(u.name), mention: jid.get(Number(u.id)) ?? null });
  return out;
}

// Who to inform: the managers on the task, or else the managers of the people's pods; and the admins
async function leadsFor(db: Knex, taskId: number, userIds: number[]) {
  let mgrIds = (await db('task_assignees').where({ task_id: taskId, assignee_role: 'manager' }).whereNotNull('user_id').select('user_id')).map((r: any) => Number(r.user_id));
  if (!mgrIds.length) {
    const pods = (await db('users').whereIn('id', userIds).whereNotNull('pod').select('pod')).map((r: any) => r.pod);
    if (pods.length) mgrIds = (await db('users').where({ role: 'manager' }).whereIn('pod', pods).select('id')).map((r: any) => Number(r.id));
  }
  // Nobody follows up on themselves: a manager who hasn't accepted is followed up by the admins of their pod
  // (all admins when their pod has none)
  mgrIds = mgrIds.filter((id) => !userIds.includes(id));
  const selfMgrs = await db('users').whereIn('id', userIds).where({ role: 'manager' }).select('pod');
  if (selfMgrs.length) {
    const pods = selfMgrs.map((m: any) => m.pod).filter(Boolean);
    let podAdmins = pods.length ? (await db('users').where({ role: 'admin' }).whereIn('pod', pods).select('id')).map((r: any) => Number(r.id)) : [];
    if (!podAdmins.length) podAdmins = (await db('users').where({ role: 'admin' }).select('id')).map((r: any) => Number(r.id));
    mgrIds = [...new Set([...mgrIds, ...podAdmins])];
  }
  const adminIds = (await db('users').where({ role: 'admin' }).select('id')).map((r: any) => Number(r.id));
  const ppl = await peopleFor(db, [...mgrIds, ...adminIds]);
  const pick = (ids: number[]) => ids.filter((i) => ppl.has(i)).map((i) => ppl.get(i)!);
  return { managers: pick(mgrIds), admins: pick(adminIds.filter((i) => !mgrIds.includes(i))) };
}

// Still waiting: a task assignment not yet accepted, or a ticket stage still with the same person
// Who a ticket is still waiting on: the same rule Loop uses to start it (waitingOn in xlr8.ts): everyone doing work
// on the current and later stages who has not accepted. All of them are reminded together, not stage by stage.
async function ticketPending(db: Knex, ticketId: number, fromIdx: number): Promise<number[]> {
  return (await db('task_assignees as ta').join('users as u', 'u.id', 'ta.user_id')
    .where('ta.task_id', ticketId).where('ta.stage_idx', '>=', fromIdx).where('ta.assignee_role', 'employee').whereNot('u.role', 'admin')
    .where((q: any) => q.whereNull('ta.skipped').orWhere('ta.skipped', 0))
    .where((q: any) => q.whereNull('ta.acceptance_status').orWhereNotIn('ta.acceptance_status', ['accepted', 'pre_pending']))
    .distinct('ta.user_id').pluck('ta.user_id')).map(Number);
}

async function stillWaiting(db: Knex, p: { assignmentId?: number; ticketId?: number; assigneeId?: number; userId?: number }): Promise<boolean> {
  if (p.ticketId) {
    const t = await db('tasks').where({ id: p.ticketId }).first('xlr8_status', 'xlr8_assignee_id', 'xlr8_stage_idx');
    if (!t || t.xlr8_status !== 'pending_assignee') return false;
    if (!p.userId) return Number(t.xlr8_assignee_id) === Number(p.assigneeId);   // rows queued before this change
    return (await ticketPending(db, Number(p.ticketId), Number(t.xlr8_stage_idx ?? 0))).includes(Number(p.userId));
  }
  const a = await db('task_assignees').where({ id: p.assignmentId }).first('acceptance_status', 'skipped');
  return !!a && a.acceptance_status !== 'accepted' && a.acceptance_status !== 'declined' && !Number(a.skipped);
}

// Queues one reminder per pending assignment. The key is the assignment row and the time it was assigned, so a restart
// or a retry can never queue the same reminder twice, while a later reassignment gets its own.
// ── Start point ──
// Messages are only for things that happen after the WhatsApp notices were first switched on. The moment is saved once
// (the first start of this version) and never moved, so a deploy neither replays old work nor drops new work.
const SINCE = 'notices_since';
// The private reminders and the 12-minute escalation came later, with their own start point (set once, when this
// version first starts): a deploy never sends them for assignments the earlier version already handled.
const FOLLOWUP_SINCE = 'followups_since';
// Private cross-pod approval reminders to managers came later still: their own start point, so a deploy doesn't
// suddenly message managers about requests that were already waiting before it
const CROSSPOD_SINCE = 'crosspod_since';
// "Your turn" messages when a ticket moves on: their own start point too (no messages about earlier hand-overs)
const TURN_SINCE = 'turn_since';
export async function markNoticesStart(db: Knex, now: Date = new Date()): Promise<void> {
  for (const name of [SINCE, FOLLOWUP_SINCE, CROSSPOD_SINCE, TURN_SINCE]) {
    if (await db('assistant_settings').where({ name }).first('name').catch(() => null)) continue;
    await db('assistant_settings').insert({ name, value: String(now.getTime()), updated_at: now }).catch(() => undefined);
  }
}
async function settingMs(db: Knex, name: string): Promise<number> {
  const row = await db('assistant_settings').where({ name }).first('value').catch(() => null);
  const ms = Number(row?.value);
  return Number.isFinite(ms) ? ms : 0;   // not set (tests, or before the first start): no cut-off
}
export const noticesSince = (db: Knex) => settingMs(db, SINCE);
export const followUpsSince = (db: Knex) => settingMs(db, FOLLOWUP_SINCE);

export async function enqueueAcceptanceReminders(db: Knex, now: Date = new Date(), minutes = acceptanceReminderMinutes()): Promise<number> {
  if (!notificationGroupJid()) return 0;
  const start = await noticesSince(db);
  const nowMs = now.getTime();
  const rows = await db('task_assignees as ta').join('tasks as t', 't.id', 'ta.task_id').leftJoin('projects as p', 'p.id', 't.project_id')
    .whereIn('ta.assignee_role', ['employee', 'manager'])   // managers get reminders too; accepted ones are excluded below
    .whereNotNull('ta.assigned_at').where('ta.assigned_at', '<=', new Date(nowMs - minutes * 60_000))
    .where('ta.assigned_at', '>=', new Date(Math.max(start, nowMs - REMINDER_LOOKBACK_HOURS * 3600_000)))
    .where((q: any) => q.whereNull('ta.skipped').orWhere('ta.skipped', 0))
    .where((q: any) => q.whereNull('ta.acceptance_status').orWhere('ta.acceptance_status', 'pending'))
    .whereNull('t.ticket_type_id')
    .whereNotIn('t.status', ['completed', 'cancelled'])
    .select('ta.id', 'ta.user_id', 'ta.assigned_at', 't.id as task_id', 't.title', 't.due_date', 't.due_time', 'p.name as project_name');
  const ppl = await peopleFor(db, rows.map((r: any) => r.user_id));
  const followStart = await followUpsSince(db);
  let queued = 0;
  const escalate = new Map<number, { rows: any[] }>();
  for (const r of rows) {
    const person = ppl.get(Number(r.user_id));
    if (!person) continue;
    const since = toMs(r.assigned_at);
    const steps = since >= followStart ? followUpSteps(since, nowMs, minutes) : [];
    const project = r.project_name ? String(r.project_name) : '';
    for (const step of steps) {
      if (step === 'escalate') { const e = escalate.get(Number(r.task_id)) ?? { rows: [] }; e.rows.push({ ...r, person, since }); escalate.set(Number(r.task_id), e); continue; }
      if (!person.mention) continue;   // a private reminder needs a linked WhatsApp account
      const n = step === 'remind1' ? 1 : 2;
      const built = buildReminderText({ title: String(r.title), project, person, n, due: dueLabel(r.due_date, r.due_time) });
      if (await insertRow(db, { event_key: `${n === 1 ? 'remind' : 'remind2'}:${r.id}:${new Date(r.assigned_at).getTime()}`, kind: 'reminder', task_id: Number(r.task_id), now,
        payload: { ...built, assignmentId: Number(r.id), to: person.mention } })) queued++;
    }
  }
  // One group message per task, naming everyone on it who has not accepted
  for (const [taskId, e] of escalate) {
    const key = `escalate:${taskId}:${e.rows.map((r) => r.id).sort((x, y) => x - y).join('.')}`;
    if (await db('whatsapp_outbox').where({ event_key: key.slice(0, 120) }).first('id')) continue;
    const { managers } = await leadsFor(db, taskId, e.rows.map((r) => Number(r.user_id)));
    const r0 = e.rows[0];
    const args = { title: String(r0.title), project: r0.project_name ? String(r0.project_name) : '', minutes: acceptanceEscalateMinutes(process.env, minutes), managers };
    const people = e.rows.map((r) => ({ ...r.person, assignmentId: Number(r.id) }));
    if (await insertRow(db, { event_key: key, kind: 'escalation', task_id: taskId, now, payload: { ...buildEscalationText({ ...args, people }), args, people } })) {
      queued++;
      await recordEscalation(db, { userIds: e.rows.map((r) => Number(r.user_id)), taskId, kind: 'acceptance', reason: 'Did not accept the task in time', eventKey: key });
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
}): { text: string; mentions: string[]; tags: Tag[]; card: Card; caption: string } {
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
  return { text, mentions: mentionsOf(args.people), tags: tagsOf(args.people), ...pic };
}

// Delayed work is followed up in three steps: 1 deadline crossed, 2 warning, 3 escalation
export const OVERDUE_STEPS = [
  { level: 1, afterMin: 0, key: 'overdue' },
  { level: 2, afterMin: 4 * 60, key: 'overdue2' },
  { level: 3, afterMin: 24 * 60, key: 'overdue3' },
] as const;
export function buildOverdueText(args: {
  title: string; project: string; dueLabel: string; minutesLate: number; status: string | null;
  people: { name: string; mention: string | null }[];
  leads?: { name: string; mention: string | null }[];   // group follow-up: managers and admins to tag
  level?: 1 | 2 | 3;
}): { text: string; mentions: string[]; tags: Tag[]; card: Card; caption: string } {
  const level = args.level ?? 1;
  const leads = (args.leads ?? []).filter((p, i, a) => a.findIndex((q) => q.name === p.name) === i);
  const late = args.minutesLate >= 120 ? `about ${plural(Math.round(args.minutesLate / 60), 'hour')}` : plural(args.minutesLate, 'minute');
  const who = names(args.people);
  const copy = {
    1: { icon: '🚨', title: 'Deadline crossed',
      line: `This task is ${bold(late)} past its deadline.`,
      ask: '👉 Please finish it and submit it, or update the deadline in Loop with a reason.' },
    2: { icon: '⚠️', title: 'Warning: task still delayed',
      line: `Second reminder: this task is now ${bold(late)} late and still not closed.`,
      ask: `👉 ${who}, please complete and close it today. If it is blocked, say why in Loop and agree a new deadline with your manager.` },
    3: { icon: '🔴', title: 'Escalation: delayed task',
      line: `Escalated: this task is ${bold(late)} late after two reminders and is still with ${who}.`,
      ask: `👉 ${who}, please reply with an update and close it now.` },
  }[level];
  const followUp = leads.length ? `\n👀 *Please follow up:* ${names(leads)}` : '';
  const head = heading(copy.icon, copy.title);
  const pic = detailCard(head, clean(args.title, 60), [
    { label: 'Overdue by', value: late, tone: 'bad' }, { label: 'Was due', value: args.dueLabel },
    { label: 'Project', value: args.project ? clean(args.project) : null }, { label: level === 3 ? 'Ticket is with' : 'Assigned to', value: plainNames(args.people) },
    { label: 'Status', value: args.status, tone: 'warn' },
    { label: 'Reminder', value: `${level} of 3`, tone: level === 1 ? 'warn' : 'bad' },
  ], who, copy.ask + followUp);
  const text = compose(
    head,
    copy.line,
    [field('Task', clean(args.title)), args.project ? field('Project', clean(args.project)) : '', field('Was due', args.dueLabel), field(level === 3 ? 'Ticket is with' : 'Assigned to', who), args.status ? field('Status', args.status) : ''],
    copy.ask + followUp,
  );
  const all = [...args.people, ...leads];
  return { text, mentions: mentionsOf(all), tags: tagsOf(all), ...pic };
}

const OVERDUE_LOOKBACK_HOURS = 24;   // a step that fell due longer ago than this (e.g. while WhatsApp was down) is not sent late

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
    // Only the latest step reached is sent (after an outage nobody gets steps 1-3 at once)
    const lateMin = (nowMs - deadlineMs) / 60_000;
    const step = deadlineMs <= nowMs && deadlineMs >= start ? [...OVERDUE_STEPS].reverse().find((st) => lateMin >= st.afterMin) : undefined;
    const crossed = !!step && lateMin - step.afterMin <= OVERDUE_LOOKBACK_HOURS * 60;
    if (!approaching && !crossed) continue;
    const eventKey = crossed ? `${step!.key}:${t.id}:${deadlineMs}` : `deadline:${t.id}:${deadlineMs}`;
    // A multi-stage ticket: the person holding the current stage
    const people = t.ticket_type_id
      ? (t.xlr8_assignee_id ? await db('users').where({ id: t.xlr8_assignee_id }).select('id as user_id', 'name') : [])
      : await db('task_assignees as ta').join('users as u', 'u.id', 'ta.user_id')
      .where('ta.task_id', t.id).whereIn('ta.assignee_role', ['employee', 'manager'])
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
    // Sent privately to each person on it (alerts are personal; the group only gets reports, new tickets and escalations)
    for (const p of list) {
      if (!p.mention) continue;
      const me = [{ name: p.name, mention: null }];
      const built = crossed
        ? buildOverdueText({ title: String(t.title), project, dueLabel: due, minutesLate: Math.max(1, Math.floor((nowMs - deadlineMs) / 60_000)), status: statusLabel(t, []) || null, people: me, level: step!.level })
        : buildDeadlineText({ title: String(t.title), project, dueLabel: due, minutesLeft: Math.max(1, Math.ceil((deadlineMs - nowMs) / 60_000)), people: me });
      if (await insertRow(db, { event_key: `${eventKey}:${p.mention.split('@')[0].slice(-12)}`, kind: 'deadline', task_id: Number(t.id), now, payload: { ...built, taskId: Number(t.id), to: p.mention } })) queued++;
    }
    // A crossed deadline is also posted in the group, tagging the people on it, their managers and the admins
    if (crossed) {
      const { managers, admins } = await leadsFor(db, Number(t.id), people.map((p: any) => Number(p.user_id)));
      const built = buildOverdueText({ title: String(t.title), project, dueLabel: due, minutesLate: Math.max(1, Math.floor((nowMs - deadlineMs) / 60_000)), status: statusLabel(t, []) || null, people: list, leads: [...managers, ...admins], level: step!.level });
      if (await insertRow(db, { event_key: `${eventKey}:group`, kind: 'deadline', task_id: Number(t.id), now, payload: { ...built, taskId: Number(t.id) } })) {
        queued++;
        if (step!.level === 3) await recordEscalation(db, { userIds: people.map((p: any) => Number(p.user_id)), taskId: Number(t.id), kind: 'delayed', reason: `Still not closed about ${Math.round((nowMs - deadlineMs) / 3_600_000)} hours after the deadline (due ${due})`, eventKey: `${eventKey}:group` });
      }
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
  const nowMs = now.getTime();
  const waiting = await db('tasks as t').leftJoin('projects as p', 'p.id', 't.project_id')
    // in_progress too: a ticket whose people had all accepted (e.g. the creator works on it) starts at once and still needs announcing
    .whereNotNull('t.ticket_type_id').whereIn('t.xlr8_status', ['pending_assignee', 'in_progress']).whereNotNull('t.xlr8_assignee_id')
    .whereNotIn('t.status', ['completed', 'cancelled'])
    .leftJoin('users as cb', 'cb.id', 't.created_by')
    .select('t.id', 't.title', 't.priority', 't.due_date', 't.due_time', 't.xlr8_assignee_id', 't.status', 't.xlr8_status', 't.ticket_type_id', 't.xlr8_stage_idx', 'p.name as project_name', 'cb.name as created_by_name');
  let queued = 0;
  for (const t of waiting) {
    // When it started waiting for this person: the latest hand-over in the ticket log
    const log = await db('xlr8_ticket_log').where({ task_id: t.id, to_state: 'pending_assignee' }).orderBy('id', 'desc').first('created_at').catch(() => null);
    const since = log?.created_at ? toMs(log.created_at) : NaN;
    if (!Number.isFinite(since) || since < start || nowMs - since > REMINDER_LOOKBACK_HOURS * 3600_000) continue;
    const pendingIds = await ticketPending(db, Number(t.id), Number(t.xlr8_stage_idx ?? 0));
    const ppl = await peopleFor(db, [Number(t.xlr8_assignee_id), ...pendingIds]);
    const person = ppl.get(Number(t.xlr8_assignee_id));
    if (!person) continue;
    const pending = pendingIds.filter((id) => ppl.has(id)).map((id) => ({ id, ...ppl.get(id)! }));
    const project = t.project_name ? String(t.project_name) : '';
    const due = dueLabel(t.due_date, t.due_time);
    const base = `${t.id}:${since}`;
    if (nowMs - since <= TICKET_NOTICE_HOURS * 3600_000) {
      const common = { kind: 'assigned' as const, title: String(t.title), project, priority: t.priority ?? null, due, ticket: true, createdBy: t.created_by_name ?? null, link: await shareLink(db, Number(t.id)) };
      // Everyone on the ticket's stages (employees and managers) is tagged; the current stage holder first
      const others = (await db('task_assignees').where({ task_id: t.id }).whereNotNull('user_id').where((q: any) => q.whereNull('skipped').orWhere('skipped', 0)).select('user_id'))
        .map((r: any) => Number(r.user_id)).filter((id: number) => id !== Number(t.xlr8_assignee_id));
      const otherPpl = await peopleFor(db, others);
      const everyone = [person, ...[...new Set(others)].filter((id) => otherPpl.has(id)).map((id) => otherPpl.get(id)!)];
      // The status names everyone on the card who still has to accept, managers on a review stage included
      // (only the work stages hold the ticket's start, but every listed person is asked to accept)
      const unaccepted = new Set((await db('task_assignees as ta').join('users as u', 'u.id', 'ta.user_id').where('ta.task_id', t.id).whereNot('u.role', 'admin')
        .where((q: any) => q.whereNull('ta.skipped').orWhere('ta.skipped', 0))
        .where((q: any) => q.whereNull('ta.acceptance_status').orWhereIn('ta.acceptance_status', ['pending']))
        .distinct('ta.user_id').pluck('ta.user_id')).map(Number));
      const allIds = [Number(t.xlr8_assignee_id), ...[...new Set(others)].filter((id) => otherPpl.has(id))];
      const waitingNames = allIds.filter((id) => unaccepted.has(id)).map((id) => (id === Number(t.xlr8_assignee_id) ? person : otherPpl.get(id)!).name);
      if (await insertRow(db, { event_key: `tassign:${base}`, kind: 'assigned', task_id: Number(t.id), now,
        payload: buildAssignmentText({ ...common, people: everyone, status: statusLabel(t, waitingNames) }) })) queued++;
      for (const p of pending) if (p.mention && await insertRow(db, { event_key: `dm:tassign:${base}:${p.id}`, kind: 'assigned', task_id: Number(t.id), now,
        payload: { ...buildDirectAssignment({ ...common, name: p.name, status: 'Waiting for your acceptance' }), to: p.mention } })) queued++;
    }
    // Every step goes to everyone still pending at the same time
    for (const step of since >= (await followUpsSince(db)) ? followUpSteps(since, nowMs, minutes) : []) {
      if (!pending.length) break;
      if (step === 'escalate') {
        const { managers } = await leadsFor(db, Number(t.id), pending.map((p) => p.id));
        const args = { title: String(t.title), project, minutes: acceptanceEscalateMinutes(process.env, minutes), managers, ticket: true };
        const people = pending.map((p) => ({ name: p.name, mention: p.mention, ticketId: Number(t.id), userId: p.id }));
        if (await insertRow(db, { event_key: `tescalate:${base}`, kind: 'escalation', task_id: Number(t.id), now, payload: { ...buildEscalationText({ ...args, people }), args, people } })) {
          queued++;
          await recordEscalation(db, { userIds: pending.map((p) => p.id), taskId: Number(t.id), kind: 'acceptance', reason: 'Did not accept the ticket in time', eventKey: `tescalate:${base}` });
        }
        continue;
      }
      const n = step === 'remind1' ? 1 : 2;
      for (const p of pending) {
        if (!p.mention) continue;
        if (await insertRow(db, { event_key: `${n === 1 ? 'tremind' : 'tremind2'}:${base}:${p.id}`, kind: 'reminder', task_id: Number(t.id), now,
          payload: { ...buildReminderText({ title: String(t.title), project, person: p, n, ticket: true, due }), ticketId: Number(t.id), userId: p.id, to: p.mention } })) queued++;
      }
    }
  }
  return queued;
}

// ── Cross-pod approval: private requests and reminders to the managers who still have to approve ──
// Work that involves another pod waits for that pod's manager (crosspod_pods lists the pods still to approve; a pod
// leaves the list when its manager approves). Each of those managers gets a private message when it is requested, then
// reminders at 30 minutes and 2 hours, then once a day for 3 days, while it still waits for their pod.
// A step missed by more than an hour (e.g. WhatsApp was down) is skipped, not sent late.
export const CROSSPOD_STEPS_MIN = [0, 30, 120, 1440, 2880, 4320];
export function crossPodStep(sinceMs: number, nowMs: number): number | null {
  const mins = (nowMs - sinceMs) / 60_000;
  if (mins < 0) return null;
  let i = -1; for (let k = 0; k < CROSSPOD_STEPS_MIN.length; k++) if (CROSSPOD_STEPS_MIN[k] <= mins) i = k;
  return i >= 0 && mins - CROSSPOD_STEPS_MIN[i] <= 60 ? i : null;
}
export function buildApprovalRequest(args: { title: string; project: string; name: string; reasons: string[]; step: number; ticket?: boolean; link?: string | null; due?: string | null }) {
  const what = args.ticket ? 'ticket' : 'task';
  const head = args.step === 0 ? heading(ICON.lock, 'Approval needed: cross-pod work') : heading(ICON.reminder, 'Reminder: approval still needed');
  const ask = `Hi ${firstName(args.name)}, this ${what} involves your pod and is waiting for your approval. It can't start until you approve it in Loop (Approvals).`
    + (args.link ? `\n\n🔗 ${args.link}` : '');
  const pic = detailCard(head, clean(args.title, 60), [
    { label: 'Project', value: args.project ? clean(args.project) : null },
    { label: 'Why', value: args.reasons.length ? clean(args.reasons.join('; '), 160) : null },
    { label: 'Deadline', value: args.due ?? null },
    { label: 'Status', value: 'Waiting for your approval', tone: 'warn' },
  ], '', ask);
  const text = compose(head, ask, [field('Title', clean(args.title)), args.project ? field('Project', clean(args.project)) : '', args.reasons.length ? field('Why', clean(args.reasons.join('; '), 300)) : '']);
  return { text, mentions: [] as string[], tags: [] as Tag[], ...pic };
}
export async function enqueueCrossPodApprovals(db: Knex, now: Date = new Date()): Promise<number> {
  const start = await settingMs(db, CROSSPOD_SINCE);
  const nowMs = now.getTime();
  const held = await db('tasks as t').leftJoin('projects as p', 'p.id', 't.project_id')
    .where('t.status', 'pending_approval').whereNotNull('t.crosspod_pods')
    .select('t.id', 't.title', 't.created_at', 't.due_date', 't.due_time', 't.ticket_type_id', 't.crosspod_pods', 't.crosspod_reasons', 'p.name as project_name');
  let queued = 0;
  for (const t of held) {
    // When approval was asked for: the ticket's "requested" log entry, else when the task was created
    const log = t.ticket_type_id ? await db('xlr8_ticket_log').where({ task_id: t.id, action: 'crosspod_requested' }).orderBy('id', 'desc').first('created_at').catch(() => null) : null;
    const since = toMs(log?.created_at ?? t.created_at);
    if (!Number.isFinite(since) || since < start) continue;
    const step = crossPodStep(since, nowMs);
    if (step === null) continue;
    const pods: string[] = (() => { try { return JSON.parse(t.crosspod_pods) ?? []; } catch { return []; } })();
    const reasons: { pod: string; text: string }[] = (() => { try { return JSON.parse(t.crosspod_reasons) ?? []; } catch { return []; } })();
    if (!pods.length) continue;
    const mgrs = await db('users').where({ role: 'manager' }).whereIn('pod', pods).select('id', 'pod');
    const ppl = await peopleFor(db, mgrs.map((m: any) => Number(m.id)));
    const link = await shareLink(db, Number(t.id));
    for (const m of mgrs) {
      const who = ppl.get(Number(m.id));
      if (!who?.mention) continue;   // only managers with a verified WhatsApp link get a private message
      const payload = buildApprovalRequest({ title: String(t.title), project: t.project_name ? String(t.project_name) : '', name: who.name, step, ticket: !!t.ticket_type_id, link,
        reasons: reasons.filter((r) => r.pod === m.pod).map((r) => String(r.text)), due: dueLabel(t.due_date, t.due_time) });
      if (await insertRow(db, { event_key: `xpod:${t.id}:${since}:${step}:${m.id}`, kind: 'approval', task_id: Number(t.id), now,
        payload: { ...payload, to: who.mention, approvalTaskId: Number(t.id), pod: m.pod } })) queued++;
    }
  }
  return queued;
}

// ── Your turn: a ticket reaching the next person ──
// When a ticket moves to a stage whose person already accepted (work starts straight away), to a manager's review, or
// back to someone for rework, that person gets a private message. A stage still waiting for acceptance is not handled
// here: the acceptance messages and reminders above cover it. One message per hand-over, only while it is recent.
const TURN_FRESH_MIN = 60;
export function buildTurnText(args: { title: string; project: string; name: string; kind: 'work' | 'review' | 'rework'; stage?: string | null; reason?: string | null; link?: string | null; due?: string | null }) {
  const head = args.kind === 'review' ? heading(ICON.task, 'Ready for your review') : args.kind === 'rework' ? heading(ICON.reassigned, 'Back with you for changes') : heading(ICON.running, "It's your turn");
  const ask = (args.kind === 'review' ? `Hi ${firstName(args.name)}, this ticket is ready for your review. Please review it in Loop.`
    : args.kind === 'rework' ? `Hi ${firstName(args.name)}, this ticket has come back to you for changes. Please pick it up in Loop.`
    : `Hi ${firstName(args.name)}, the previous stage is done and it's your turn on this ticket now. Please start working on it in Loop.`)
    + (args.link ? `\n\n🔗 ${args.link}` : '');
  const pic = detailCard(head, clean(args.title, 60), [
    { label: 'Project', value: args.project ? clean(args.project) : null },
    { label: 'Your stage', value: args.stage ? clean(args.stage, 60) : null },
    { label: 'Feedback', value: args.reason ? clean(args.reason, 160) : null, tone: 'warn' },
    { label: 'Deadline', value: args.due ?? null },
  ], '', ask);
  const text = compose(head, ask, [field('Title', clean(args.title)), args.project ? field('Project', clean(args.project)) : '', args.stage ? field('Your stage', clean(args.stage, 60)) : '', args.reason ? field('Feedback', clean(args.reason, 300)) : '']);
  return { text, mentions: [] as string[], tags: [] as Tag[], ...pic };
}
export async function enqueueTurnMessages(db: Knex, now: Date = new Date()): Promise<number> {
  const start = await settingMs(db, TURN_SINCE);
  const since = new Date(Math.max(start, now.getTime() - TURN_FRESH_MIN * 60_000));
  // Moves forward (next_stage) and sends back for changes (a manager's or admin's decline, with its reason)
  const moves = await db('xlr8_ticket_log').whereIn('action', ['next_stage', 'manager_declined', 'admin_declined']).whereIn('to_state', ['in_progress', 'pending_manager']).where('created_at', '>=', since)
    .select('id', 'task_id', 'action', 'to_state', 'comment', 'created_at').catch(() => [] as any[]);
  let queued = 0;
  for (const mv of moves) {
    if (toMs(mv.created_at) < start) continue;
    const t = await db('tasks as t').leftJoin('projects as p', 'p.id', 't.project_id').where('t.id', mv.task_id)
      .first('t.id', 't.title', 't.xlr8_status', 't.xlr8_assignee_id', 't.due_date', 't.due_time', 'p.name as project_name');
    // Still where this move put it, with a person named for it (a review nobody is assigned to stays in Loop's notifications)
    if (!t || t.xlr8_status !== mv.to_state || !t.xlr8_assignee_id) continue;
    const sentBack = mv.action !== 'next_stage';
    const kind: 'work' | 'review' | 'rework' = sentBack ? 'rework' : mv.to_state === 'pending_manager' ? 'review' : 'work';
    const who = (await peopleFor(db, [Number(t.xlr8_assignee_id)])).get(Number(t.xlr8_assignee_id));
    if (!who?.mention) continue;
    const stage = sentBack ? null : String(mv.comment ?? '').replace(/^Stage \d+:\s*/, '') || null;
    const payload = buildTurnText({ title: String(t.title), project: t.project_name ? String(t.project_name) : '', name: who.name, kind, stage, reason: sentBack ? mv.comment ?? null : null,
      link: await shareLink(db, Number(t.id)), due: dueLabel(t.due_date, t.due_time) });
    if (await insertRow(db, { event_key: `turn:${mv.id}`, kind: 'turn', task_id: Number(t.id), now,
      payload: { ...payload, to: who.mention, turnTaskId: Number(t.id), turnState: mv.to_state, turnUser: Number(t.xlr8_assignee_id) } })) queued++;
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
}): { text: string; mentions: string[]; tags: Tag[]; card: Card; caption: string } {
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
  return { text, mentions: mentionsOf(args.people), tags: tagsOf(args.people), ...pic };
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
      .modify((q: any) => { if (stageIdx !== null) q.where('stage_idx', stageIdx); else q.whereIn('assignee_role', ['employee', 'manager']); })
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
    for (const p of people) {
      if (!p.mention) continue;
      const built = buildOvertimeText({ title: String(t.title), project: t.project_name ? String(t.project_name) : '', stage: stageName,
        estSec: Math.round(estSec), loggedSec: Math.round(loggedSec), status: statusLabel(t, []) || null, people: [{ name: p.name, mention: null }] });
      if (await insertRow(db, { event_key: `${eventKey}:${p.mention.split('@')[0].slice(-12)}`, kind: 'deadline', task_id: Number(t.id), now, payload: { ...built, taskId: Number(t.id), to: p.mention } })) queued++;
    }
  }
  return queued;
}

// ── Dashboard samples ──
// One of every message, built from real Loop data, so an admin can see the look. Group samples tag people exactly
// like the real ones; private samples go only to the admin who asked, never to an employee.
export async function queueSamples(db: Knex, adminUserId: number, now: Date = new Date()): Promise<{ group: number; private: number; task: string }> {
  const { employeePods, morningReport, withPodManagers } = await import('./productivityReports');
  const t = await db('tasks as t').leftJoin('projects as p', 'p.id', 't.project_id').whereNotNull('t.assigned_to').whereNotIn('t.status', ['completed', 'cancelled'])
    .leftJoin('users as cb', 'cb.id', 't.created_by')
    .orderBy('t.id', 'desc').first('t.id', 't.title', 't.priority', 't.due_date', 't.due_time', 't.status', 't.ticket_type_id', 't.xlr8_status', 't.assigned_to', 'p.name as project_name', 'cb.name as created_by_name');
  if (!t) throw new Error('no_task');
  const ppl = await peopleFor(db, [Number(t.assigned_to), adminUserId]);
  const who = ppl.get(Number(t.assigned_to)) ?? { name: '', mention: null };
  const me = ppl.get(adminUserId);
  const { managers } = await leadsFor(db, Number(t.id), [Number(t.assigned_to)]);
  const common = { kind: 'assigned' as const, title: String(t.title), project: t.project_name ? String(t.project_name) : '', priority: t.priority ?? null, due: dueLabel(t.due_date, t.due_time), ticket: !!t.ticket_type_id, createdBy: t.created_by_name ?? null, link: await shareLink(db, Number(t.id)) };
  const label = (b: any) => ({ ...b, caption: `🧪 _Sample preview_\n\n${b.caption}`, text: `🧪 _Sample preview_\n\n${b.text}` });
  const group: object[] = [];
  for (const pod of await employeePods(db)) group.push(label(await withPodManagers(db, pod, await morningReport(db, now, pod))));
  group.push(label(buildAssignmentText({ ...common, people: [who], status: statusLabel(t, [who.name]) })));
  group.push(label(buildEscalationText({ title: common.title, project: common.project, minutes: acceptanceEscalateMinutes(), ticket: common.ticket, people: [who], managers })));
  const dm: object[] = [];
  if (me?.mention) {
    const mine = { name: me.name, mention: null };
    dm.push(buildDirectAssignment({ ...common, name: me.name, status: statusLabel(t, []) }));
    dm.push(buildReminderText({ title: common.title, project: common.project, person: mine, n: 1, ticket: common.ticket, due: common.due }));
    dm.push(buildReminderText({ title: common.title, project: common.project, person: mine, n: 2, ticket: common.ticket, due: common.due }));
    dm.push(buildDeadlineText({ title: common.title, project: common.project, dueLabel: common.due ?? '—', minutesLeft: 30, people: [mine] }));
  }
  const stamp = now.getTime();
  let n = 0;
  for (const p of group) await insertRow(db, { event_key: `sample:g${n++}:${stamp}`, kind: 'sample', task_id: Number(t.id), now, payload: p });
  for (const p of dm) await insertRow(db, { event_key: `sample:d${n++}:${stamp}`, kind: 'sample', task_id: Number(t.id), now, payload: { ...label(p), to: me!.mention } });
  return { group: group.length, private: dm.length, task: String(t.title) };
}


// ── Final interviews: private WhatsApp messages to the interviewers ──
// Assigned → 1 hour before → 5 minutes before → (no feedback) 1 hour after the end → (still none) 30 minutes later,
// tagged in the group. Everything before the group step is private. A step missed by more than its window is not sent late.
export const INTERVIEW_STEPS_MIN = { before60: -60, before5: -5, after60: 60, group: 90 } as const;
const IV_WINDOW_MIN = 30;
const ivPeople = (s: any): number[] => { try { return (JSON.parse(s.interviewers || '[]') as any[]).map((p) => Number(p.id)).filter(Boolean); } catch { return []; } };
// Who still needs a reminder for this interview's current time. Nobody, if someone reported that the interview didn't
// happen (candidate didn't come, postponed, ...); not a person who reported a personal problem, was taken off the
// interview, or (after it) already sent feedback. Reports about an earlier time don't count.
const WHOLE_INTERVIEW_ISSUES = ['no_show', 'candidate_late', 'technical', 'postponed'];
async function stillNeeded(db: Knex, scheduleId: number, userIds: number[], after: boolean): Promise<number[]> {
  const s = await db('rec_schedules').where({ id: scheduleId }).first('date', 'start_time', 'interviewers');
  if (!s) return [];
  const slot = `${String(s.date).slice(0, 10)} ${s.start_time}`;
  const issues = await db('rec_interview_issues').where({ schedule_id: scheduleId, slot }).select('user_id', 'reason');
  if (issues.some((i: any) => WHOLE_INTERVIEW_ISSUES.includes(i.reason))) return [];
  const onIt = new Set(ivPeople(s));
  const skip = new Set(issues.map((i: any) => Number(i.user_id)));
  if (after) for (const u of await db('rec_interview_feedback').where({ schedule_id: scheduleId }).whereIn('user_id', userIds).pluck('user_id')) skip.add(Number(u));
  return userIds.filter((u) => onIt.has(Number(u)) && !skip.has(Number(u)));
}
export function buildInterviewText(kind: 'assigned' | 'before60' | 'before5' | 'after60' | 'group', a: {
  candidate: string; job: string; ref: string; when: string; type: string; place: string; link: string; people?: { name: string; mention: string | null }[];
}) {
  const where = a.type === 'online' ? field('Meeting link', a.place) : field('Venue', clean(a.place, 200));
  const facts = [field('Candidate', clean(a.candidate)), field('Role', clean(a.job)), field('When', a.when), field('Type', a.type === 'online' ? 'Online' : 'Walk-in'), where];
  const open = `👉 Open it in Loop (resume and evaluation): ${a.link}`;
  const copy = {
    assigned: [heading('🎙️', 'You are taking an interview'), `You've been assigned to the final interview of ${bold(a.candidate)}.`, `${open}\nAfter the interview, rate the candidate and recommend approve or reject there.`],
    before60: [heading(ICON.reminder, 'Interview in 1 hour'), `Your interview with ${bold(a.candidate)} starts in about an hour. Have a look at the resume before you start.`, open],
    before5: [heading(ICON.reminder, 'Interview in 5 minutes'), `Your interview with ${bold(a.candidate)} starts in 5 minutes.`, a.type === 'online' ? `👉 Join: ${a.place}\n📄 Resume and evaluation in Loop: ${a.link}` : open],
    after60: [heading('📝', 'Interview feedback pending'), `The interview with ${bold(a.candidate)} ended an hour ago and your evaluation is still missing.`, `👉 Please rate the candidate and recommend approve or reject now: ${a.link}`],
    group: [heading('⚠️', 'Interview feedback overdue'), `The final interview of ${bold(a.candidate)} (${clean(a.ref)}) ended and no evaluation has been sent yet by: ${names(a.people ?? [])}.`, `👉 Please submit it in Loop → My Interviews: ${a.link}`],
  }[kind];
  const text = compose(copy[0], copy[1], facts, copy[2]);
  const people = a.people ?? [];
  return { text, mentions: mentionsOf(people), tags: tagsOf(people) };
}
export async function enqueueInterviewNotices(db: Knex, now: Date = new Date()): Promise<number> {
  if (!notificationGroupJid()) return 0;
  if (!(await db.schema.hasTable('rec_interview_feedback'))) return 0;
  const nowMs = now.getTime();
  const site = (process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || 'https://looped.in').replace(/\/$/, '');
  const rows = await db('rec_schedules as s').join('rec_applications as a', 'a.id', 's.application_id').leftJoin('rec_jobs as j', 'j.id', 'a.job_id')
    .whereIn('s.status', ['scheduled', 'completed']).whereNotIn('a.status', ['selected', 'rejected', 'withdrawn'])
    .where('s.date', '>=', new Date(nowMs - 3 * 86_400_000).toISOString().slice(0, 10))
    .select('s.*', 'a.name as candidate', 'a.ref', 'j.title as job');
  let queued = 0;
  for (const s of rows) {
    const ids = ivPeople(s);
    if (!ids.length) continue;
    const date = String(s.date).slice(0, 10);
    const startMs = deadlineInstant(date, s.start_time), endMs = deadlineInstant(date, s.end_time);
    if (startMs === null || endMs === null) continue;
    const ppl = await peopleFor(db, ids);
    const base = { candidate: String(s.candidate), job: String(s.job ?? ''), ref: String(s.ref), when: `${dateTime(startMs)} (IST)`, type: s.type,
      place: s.type === 'online' ? String(s.meeting_url ?? '') : `${s.location ?? ''} ${s.address ?? ''}`.trim(), link: `${site}/my-interviews#iv-${s.id}` };
    const due = (offsetMin: number, from: number) => { const at = from + offsetMin * 60_000; return nowMs >= at && nowMs - at <= IV_WINDOW_MIN * 60_000; };
    const key = (step: string, uid?: number) => `iv:${step}:${s.id}:${startMs}${uid ? `:${uid}` : ''}`;
    const dm = async (step: 'assigned' | 'before60' | 'before5' | 'after60', uid: number, after = false) => {
      const p = ppl.get(uid);
      if (!p?.mention) return;
      if (await insertRow(db, { event_key: key(step, uid), kind: 'interview', task_id: 0, now,
        payload: { ...buildInterviewText(step, base), to: p.mention, iv: { scheduleId: Number(s.id), startMs, userIds: [uid], after } } })) queued++;
    };
    const upcoming = s.status === 'scheduled' && startMs > nowMs;
    const before = new Set(await stillNeeded(db, Number(s.id), ids, false));
    for (const uid of ids) {
      if (!before.has(uid)) continue;
      if (upcoming && nowMs - toMs(s.updated_at ?? s.created_at) <= 24 * 3600_000) await dm('assigned', uid);
      if (s.status === 'scheduled' && due(INTERVIEW_STEPS_MIN.before60, startMs) && startMs > nowMs) await dm('before60', uid);
      if (s.status === 'scheduled' && due(INTERVIEW_STEPS_MIN.before5, startMs) && startMs > nowMs) await dm('before5', uid);
    }
    if (nowMs < endMs) continue;
    const missing = await stillNeeded(db, Number(s.id), ids, true);
    if (!missing.length) continue;
    if (due(INTERVIEW_STEPS_MIN.after60, endMs)) for (const uid of missing) await dm('after60', uid, true);
    if (due(INTERVIEW_STEPS_MIN.group, endMs)) {
      const people = missing.filter((u) => ppl.has(u)).map((u) => ppl.get(u)!);
      if (people.length && await insertRow(db, { event_key: key('group'), kind: 'interview', task_id: 0, now,
        payload: { ...buildInterviewText('group', { ...base, people }), iv: { scheduleId: Number(s.id), startMs, userIds: missing, after: true } } })) queued++;
    }
  }
  return queued;
}
