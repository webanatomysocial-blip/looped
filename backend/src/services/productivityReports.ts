// Scheduled productivity reports for the WhatsApp group. Loop is the source of truth; the reports only read from it.
// Each report is queued once per IST day in the durable outbox, and sent by the same worker as the other notices.
import { Knex } from 'knex';
import { Card } from './reportCard';
import { notificationGroupJid, deadlineInstant, dueLabel, jidForIdentity, mentionTag } from './assignmentNotices';
import { compose, heading, bold, clean, italic, bullet, capped, priority, ICON } from './waMessage';

const TZ = 'Asia/Kolkata';
const DAY_MS = 86_400_000;
export const MORNING_MINUTE = 9 * 60;   // 09:00 IST
export const EVENING_MINUTE = 18 * 60;  // 18:00 IST
export const REPORT_WINDOW_MINUTES = 30; // a report is sent only within 30 minutes of its time

// Date, weekday and time of an instant in Asia/Kolkata
export function istParts(now: Date): { date: string; weekday: string; minutes: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday: String(parts.weekday), minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

export function isWeekday(weekday: string): boolean { return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekday); }
export function istDayStart(date: string): number { return Date.parse(`${date}T00:00:00+05:30`); }
export function previousIstDate(date: string): string { return istParts(new Date(istDayStart(date) - DAY_MS / 2)).date; }
// The working day before an IST date: Monday → Friday, Tuesday–Friday → the day before. Never a Saturday or Sunday.
export function previousWorkingDate(date: string): string {
  let d = previousIstDate(date);
  while (!isWeekday(istParts(new Date(istDayStart(d) + DAY_MS / 2)).weekday)) d = previousIstDate(d);
  return d;
}

const toMs = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v.getTime();
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  const p = Date.parse(String(v).includes('T') || String(v).includes('Z') ? String(v) : `${String(v).replace(' ', 'T')}Z`);
  return Number.isFinite(p) ? p : null;
};

const dayLabel = (date: string) => new Intl.DateTimeFormat('en-IN', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(istDayStart(date) + DAY_MS / 2));

export function formatHours(ms: number): string {
  const totalMin = Math.round(ms / 60_000);
  return `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`;
}

// Actual tracked time for each employee on one IST day.
// Timer sessions are counted by how much of each session falls inside the day (a running session counts up to now).
// Session-linked time logs are not added again: they are the same work as the session. Manual time logs (no session)
// are added by their log date. hasRecords is false when nothing was recorded at all, so "no time recorded" is not shown as 0h.
// projectIds, when given, limits the time to work on tasks in those projects (a manager's scope). Null means all projects.
export async function trackedTime(db: Knex, userIds: number[], date: string, nowMs: number, projectIds: number[] | null = null): Promise<Map<number, { ms: number; hasRecords: boolean }>> {
  const out = new Map<number, { ms: number; hasRecords: boolean }>(userIds.map((id) => [id, { ms: 0, hasRecords: false }]));
  if (!userIds.length) return out;
  const dayStart = istDayStart(date);
  const dayEnd = dayStart + DAY_MS;
  // session_date is a UTC date, so look one day either side and then clip exactly to the IST day
  const lo = istParts(new Date(dayStart - DAY_MS)).date;
  const hi = istParts(new Date(dayEnd + DAY_MS)).date;
  const sessionQuery = db('task_sessions as s').whereIn('s.user_id', userIds)
    .where((q: any) => q.whereBetween('s.session_date', [lo, hi]).orWhereNull('s.ended_at'));
  if (projectIds) sessionQuery.join('tasks as st', 'st.id', 's.task_id').whereIn('st.project_id', projectIds);
  const sessions = await sessionQuery.select('s.user_id', 's.started_at', 's.ended_at');
  for (const s of sessions) {
    const start = toMs(s.started_at);
    if (start === null) continue;
    const end = toMs(s.ended_at) ?? nowMs;
    const overlap = Math.min(end, dayEnd, nowMs) - Math.max(start, dayStart);
    if (overlap <= 0) continue;
    const e = out.get(Number(s.user_id))!;
    e.ms += overlap; e.hasRecords = true;
  }
  const manualQuery = db('time_logs').whereIn('user_id', userIds).whereNull('task_session_id').where('log_date', date);
  if (projectIds) manualQuery.whereIn('project_id', projectIds);
  const manual = await manualQuery.select('user_id', 'hours');
  for (const m of manual) {
    const e = out.get(Number(m.user_id))!;
    e.ms += Number(m.hours || 0) * 3_600_000; e.hasRecords = true;
  }
  return out;
}

export interface TaskLine { id: number; title: string; project: string; priority: string | null; deadlineMs: number | null; dueText: string | null; open: boolean; overdue: boolean; completedMs: number | null; assignedMs: number | null }

// Every employee and the tasks they are actively assigned to (employee role, not skipped, not declined; never cancelled tasks).
// projectIds and employeeIds, when given, limit the result to a requester's scope. Null means everything.
// nowMs is the moment the tasks are judged at: a task completed after it still counts as open, and overdue means its
// deadline had passed by then. Reports pass their scheduled time, so a late run sees the same picture as an on-time one.
export async function employeeTasks(db: Knex, nowMs: number, projectIds: number[] | null = null, employeeIds: number[] | null = null): Promise<{ employees: { id: number; name: string }[]; tasks: Map<number, TaskLine[]> }> {
  const empQuery = db('users').where({ role: 'employee' }).orderBy('name');
  if (employeeIds) empQuery.whereIn('id', employeeIds);
  const employees = (await empQuery.select('id', 'name')).map((u: any) => ({ id: Number(u.id), name: String(u.name) }));
  const rowsQuery = db('task_assignees as ta').join('tasks as t', 't.id', 'ta.task_id').leftJoin('projects as p', 'p.id', 't.project_id');
  if (projectIds) rowsQuery.whereIn('t.project_id', projectIds);
  const rows = await rowsQuery
    .where('ta.assignee_role', 'employee')
    .where((q: any) => q.whereNull('ta.skipped').orWhere('ta.skipped', 0))
    .where((q: any) => q.whereNull('ta.acceptance_status').orWhereNot('ta.acceptance_status', 'declined'))
    .whereNot('t.status', 'cancelled')
    .select('ta.user_id', 'ta.assigned_at', 't.id', 't.title', 't.priority', 't.status', 't.due_date', 't.due_time', 't.completed_at', 'p.name as project_name');
  const tasks = new Map<number, TaskLine[]>();
  for (const r of rows) {
    const deadlineMs = r.due_date ? deadlineInstant(String(r.due_date), r.due_time ?? null) : null;
    const completedMs = toMs(r.completed_at);
    const open = r.status !== 'completed' || (completedMs !== null && completedMs > nowMs);
    const line: TaskLine = {
      id: Number(r.id), title: String(r.title), project: String(r.project_name || 'No project'), priority: r.priority ?? null,
      deadlineMs, dueText: dueLabel(r.due_date, r.due_time), open, overdue: open && deadlineMs !== null && deadlineMs < nowMs,
      completedMs, assignedMs: toMs(r.assigned_at),
    };
    const list = tasks.get(Number(r.user_id)) ?? [];
    if (list.some((t) => t.id === line.id)) continue;   // a multi-stage task is listed once per person
    list.push(line);
    tasks.set(Number(r.user_id), list);
  }
  return { employees, tasks };
}

const describe = (t: TaskLine) => `${clean(t.title)} (${clean(t.project, 40)}, ${priority(t.priority)}, ${t.dueText ? `due ${t.dueText}` : 'no deadline'})`;
const listed = (items: string[]) => capped(items).map((l) => bullet(l, 1));
const inDay = (ms: number | null, date: string) => ms !== null && ms >= istDayStart(date) && ms < istDayStart(date) + DAY_MS;

// 09:00 report: the previous working day (Friday on a Monday) and all work still outstanding from it or earlier, by
// employee. Everything is judged at 09:00 of the report date, whenever the report actually runs.
export async function buildMorningReport(db: Knex, now: Date): Promise<string> { return (await morningReport(db, now)).text; }
export async function morningReport(db: Knex, now: Date, pod: Pod | null = null): Promise<ReportOut> {
  const today = istParts(now).date;
  const workday = previousWorkingDate(today);
  const asOf = istDayStart(today) + MORNING_MINUTE * 60_000;
  const { employees, tasks } = await employeeTasks(db, asOf, null, pod ? pod.ids : null);
  const tag = pod ? `${pod.label} · ` : '';
  const completedWhen = previousIstDate(today) === workday ? `on ${dayLabel(workday)}` : `${dayLabel(workday)} – ${dayLabel(previousIstDate(today))}`;
  const blocks: string[][] = [];
  const clear: string[] = [];
  const rows: Card['rows'] = [];
  for (const e of employees) {
    const mine = tasks.get(e.id) ?? [];
    // Carried forward: open at 09:00 and assigned before today began (or with no assignment time recorded)
    const carried = mine.filter((t) => t.open && (t.assignedMs === null || t.assignedMs < istDayStart(today)));
    const overdue = carried.filter((t) => t.overdue);
    const pending = carried.filter((t) => !t.overdue);
    // Completed from the start of the previous working day until today began: on a Monday that is Friday to Sunday
    const completed = mine.filter((t) => !t.open && t.completedMs !== null && t.completedMs >= istDayStart(workday) && t.completedMs < istDayStart(today));
    rows.push({ name: clean(e.name, 40), values: [completed.length, pending.length, overdue.length] });
    if (!carried.length && !completed.length) { clear.push(clean(e.name, 40)); continue; }
    blocks.push([
      `${bold(e.name, 40)} — ${pending.length} pending, ${overdue.length} overdue, ${completed.length} completed ${completedWhen}`,
      ...listed(overdue.map((t) => `${ICON.overdue} Overdue: ${describe(t)}`)),
      ...listed(pending.map((t) => `${ICON.pending} Pending: ${describe(t)}`)),
      ...listed(completed.map((t) => `${ICON.completed} Completed: ${clean(t.title)}`)),
    ]);
  }
  const text = compose(
    [heading(ICON.morning, `Good morning! Pending work from ${dayLabel(workday)}`), italic(`As of 9:00 am IST · ${employees.length} employee${employees.length === 1 ? '' : 's'}`)],
    ...blocks,
    clear.length ? `${ICON.completed} No pending work from ${dayLabel(workday)}: ${clear.join(', ')}` : '',
    employees.length ? '' : 'No employees found in Loop.',
  );
  const card: Card = { title: `${tag}Good morning · ${dayLabel(today)}`, subtitle: `Work from ${dayLabel(workday)} · as of 9:00 am IST`,
    columns: [{ label: 'Done', tone: 'good' }, { label: 'Pending', tone: 'warn' }, { label: 'Overdue', tone: 'bad' }], rows: sortRows(rows) };
  return { text, card, caption: caption(ICON.morning, `${tag}Good morning · ${dayLabel(today)}`, rows) };
}

// 18:00 report: the working day's activity, workload and actual tracked hours, by employee, judged at 18:00 of that day
export async function buildEveningReport(db: Knex, now: Date): Promise<string> { return (await eveningReport(db, now)).text; }
export async function eveningReport(db: Knex, now: Date, pod: Pod | null = null): Promise<ReportOut> {
  const today = istParts(now).date;
  const asOf = istDayStart(today) + EVENING_MINUTE * 60_000;
  const { employees, tasks } = await employeeTasks(db, asOf, null, pod ? pod.ids : null);
  const tag = pod ? `${pod.label} · ` : '';
  const hours = await trackedTime(db, employees.map((e) => e.id), today, asOf);
  const blocks: string[][] = [];
  const rows: Card['rows'] = [];
  for (const e of employees) {
    const mine = tasks.get(e.id) ?? [];
    const assignedToday = mine.filter((t) => inDay(t.assignedMs, today) && t.assignedMs! <= asOf);
    const completedToday = mine.filter((t) => !t.open && inDay(t.completedMs, today));
    const open = mine.filter((t) => t.open);
    const overdue = open.filter((t) => t.overdue);
    const pending = open.filter((t) => !t.overdue);
    const h = hours.get(e.id)!;
    const time = h.hasRecords ? `tracked ${formatHours(h.ms)}` : 'no time recorded';
    rows.push({ name: clean(e.name, 40), note: h.hasRecords ? `${formatHours(h.ms)} tracked` : 'no time recorded', values: [assignedToday.length, completedToday.length, pending.length, overdue.length] });
    blocks.push([
      `${bold(e.name, 40)} — ${time}`,
      `  Assigned today ${assignedToday.length} · Completed ${completedToday.length} · Pending ${pending.length} · Overdue ${overdue.length} · Workload ${open.length} open`,
      ...listed(overdue.map((t) => `${ICON.overdue} Overdue: ${describe(t)}`)),
      ...listed(completedToday.map((t) => `${ICON.completed} Completed: ${clean(t.title)}`)),
    ]);
  }
  const text = compose(
    [heading(ICON.evening, `Day-end report — ${dayLabel(today)}`), italic(`As of 6:00 pm IST · ${employees.length} employee${employees.length === 1 ? '' : 's'}`)],
    ...blocks,
    employees.length ? '' : 'No employees found in Loop.',
    italic('Hours come from Loop time tracking (timer sessions and manual entries), not from estimates.'),
  );
  const card: Card = { title: `${tag}Day-end report · ${dayLabel(today)}`, subtitle: 'As of 6:00 pm IST', footer: 'Hours come from Loop time tracking (timers and manual entries).',
    columns: [{ label: 'Assigned' }, { label: 'Done', tone: 'good' }, { label: 'Pending', tone: 'warn' }, { label: 'Overdue', tone: 'bad' }], rows: sortRows(rows) };
  return { text, card, caption: caption(ICON.evening, `${tag}Day-end report · ${dayLabel(today)}`, rows) };
}

// A pod and its employees, from users.pod in Loop. Employees with no pod get their own report so nobody is left out.
export interface Pod { key: string; label: string; ids: number[] }
export async function employeePods(db: Knex): Promise<Pod[]> {
  const rows = await db('users').where({ role: 'employee' }).select('id', 'pod');
  const by = new Map<string, number[]>();
  for (const r of rows) { const k = r.pod ? String(r.pod).trim().toLowerCase() : ''; by.set(k, [...(by.get(k) ?? []), Number(r.id)]); }
  const label = (k: string) => (k ? k.replace(/^pod\s*/i, 'POD ').toUpperCase().replace(/^POD (\S)/, 'POD $1') : 'No pod');
  return [...by].sort(([a], [b]) => (a ? 0 : 1) - (b ? 0 : 1) || a.localeCompare(b, undefined, { numeric: true }))
    .map(([k, ids]) => ({ key: k || 'none', label: label(k), ids }));
}

// A pod report with the pod's managers tagged under it, so it reaches the people responsible for that pod
export async function withPodManagers(db: Knex, pod: Pod, r: ReportOut) {
  const mgr = await podManagers(db, pod);
  const line = mgr.length ? `👥 ${mgr.map((m) => (m.jid ? mentionTag(m.jid, m.name) : clean(m.name, 40))).join(', ')}` : '';
  return {
    text: [r.text, line].filter(Boolean).join('\n\n'), caption: [r.caption, line].filter(Boolean).join('\n\n'), card: r.card,
    mentions: mgr.map((m) => m.jid).filter((j): j is string => !!j),
    tags: mgr.filter((m) => m.jid).map((m) => ({ jid: m.jid!, name: clean(m.name, 40) })),
  };
}

// Managers whose pod is this pod, with their verified WhatsApp JID when linked (none for the "No pod" report)
async function podManagers(db: Knex, pod: Pod): Promise<{ name: string; jid: string | null }[]> {
  if (pod.key === 'none') return [];
  const users = await db('users').where({ role: 'manager' }).whereRaw('LOWER(TRIM(pod)) = ?', [pod.key]).orderBy('name').select('id', 'name');
  if (!users.length) return [];
  const ids = await db('assistant_identities').whereIn('user_id', users.map((u: any) => u.id)).where({ status: 'active', channel: 'whatsapp' }).select('user_id', 'external_sender_id');
  const jid = new Map(ids.map((i: any) => [Number(i.user_id), jidForIdentity(String(i.external_sender_id))]));
  return users.map((u: any) => ({ name: String(u.name), jid: jid.get(Number(u.id)) ?? null }));
}

export interface ReportOut { text: string; card: Card; caption: string }
// Most overdue first, then most pending: the people who need attention are at the top
const sortRows = (rows: Card['rows']) => [...rows].sort((a, b) => Number(b.values.at(-1)) - Number(a.values.at(-1)) || Number(b.values.at(-2)) - Number(a.values.at(-2)));
// The short message that goes with the image: totals, the top finisher and who needs help
function caption(icon: string, title: string, rows: Card['rows']): string {
  const sum = (i: number) => rows.reduce((n, r) => n + Number(r.values.at(i)), 0);
  const top = [...rows].sort((a, b) => Number(b.values.at(-3)) - Number(a.values.at(-3)))[0];
  const help = rows.filter((r) => Number(r.values.at(-1)) > 0).sort((a, b) => Number(b.values.at(-1)) - Number(a.values.at(-1)))[0];
  const lines = [`${icon} *${title}*`, `${ICON.completed} ${sum(-3)} done · ${ICON.pending} ${sum(-2)} pending · ${ICON.overdue} ${sum(-1)} overdue`];
  const who = [top && Number(top.values.at(-3)) > 0 ? `Top: ${top.name} (${top.values.at(-3)} done)` : '', help ? `Needs help: ${help.name} (${help.values.at(-1)} overdue)` : ''].filter(Boolean);
  if (who.length) lines.push(who.join(' · '));
  return lines.join('\n');
}

// Queues the day's reports once each, Monday to Friday, in IST. The outbox key (kind and IST date) makes a retry or a
// restart a no-op. A morning report not queued by 18:00 is skipped as stale; the evening report covers the day.
export async function enqueueScheduledReports(db: Knex, now: Date = new Date()): Promise<string[]> {
  if (!notificationGroupJid()) return [];
  const { date, weekday, minutes } = istParts(now);
  if (!isWeekday(weekday)) return [];
  const due: { kind: 'report_morning' | 'report_evening'; build: (pod: Pod) => Promise<ReportOut> }[] = [];
  // Only near the scheduled time: a report that could not go out on time is skipped, never sent hours late
  if (minutes >= MORNING_MINUTE && minutes < MORNING_MINUTE + REPORT_WINDOW_MINUTES) due.push({ kind: 'report_morning', build: (pod) => morningReport(db, now, pod) });
  if (minutes >= EVENING_MINUTE && minutes < EVENING_MINUTE + REPORT_WINDOW_MINUTES) due.push({ kind: 'report_evening', build: (pod) => eveningReport(db, now, pod) });
  const queued: string[] = [];
  const pods = due.length ? await employeePods(db) : [];
  for (const d of due) for (const pod of pods) {
    // One report per pod, each with only its own members and their numbers
    const eventKey = `${d.kind}:${pod.key}:${date}`;
    // The earlier version sent one report for everyone (key without the pod): a deploy during the report window
    // must not send that day's report again per pod
    if (await db('whatsapp_outbox').whereIn('event_key', [eventKey, `${d.kind}:${date}`]).first('id')) continue;
    const built = await d.build(pod);
    const { card } = built;
    // People with no pod set get a report only when there is something to report, not an empty card twice a day
    if (pod.key === 'none' && card.rows.every((r) => r.values.every((v) => !Number(v)))) continue;
    try {
      await db('whatsapp_outbox').insert({
        event_key: eventKey, kind: d.kind, task_id: 0, payload: JSON.stringify(await withPodManagers(db, pod, built)),
        status: 'pending', attempts: 0, next_attempt_at: now,
      });
      queued.push(eventKey);
    } catch (err: any) {
      if (!/unique|duplicate/i.test(String(err?.message))) throw err;
    }
  }
  return queued;
}
