import cron from 'node-cron';
import { Knex } from 'knex';
import { getDB } from '../db';
import { sendEmail } from './emailService';

export function startEmailScheduler(): void {
  cron.schedule('* * * * *', async () => {
    try {
      const db = getDB();
      const now = new Date();
      const due = await db('emails').where('status', 'scheduled').where('scheduled_at', '<=', now).select('*');
      for (const email of due) {
        const recipients = await db('email_recipients').where('email_id', email.id).select('email', 'name');
        if (!recipients.length) { await db('emails').where('id', email.id).update({ status: 'failed', error_message: 'No recipients found', sent_at: now }); continue; }
        try {
          const sender = await db('users').where('id', email.created_by).first();
          await sendEmail({ to: recipients, subject: email.subject, body: email.body, fromName: sender?.name });
          await db('emails').where('id', email.id).update({ status: 'sent', sent_at: new Date() });
        } catch (err: any) {
          await db('emails').where('id', email.id).update({ status: 'failed', error_message: err.message, sent_at: new Date() });
        }
      }
    } catch (err) { console.error('[scheduler] Email cron error:', err); }
  });
  console.log('[scheduler] Email scheduler started');
}

export function startRecurringTaskScheduler(): void {
  cron.schedule('5 0 * * *', async () => {
    try {
      const { generateTodayInstances } = await import('../routes/calendar');
      const count = await generateTodayInstances();
      console.log(`[scheduler] Generated ${count} recurring task instances`);
    } catch (err) { console.error('[scheduler] Recurring ticket error:', err); }
  });
  console.log('[scheduler] Recurring task scheduler started (daily 00:05)');
}

// ── Phase 2: Work scheduling algorithm ───────────────────────────────────────

// Working hours per person per day (time actually available for work, breaks excluded)
export const DAY_CAP = Number(process.env.WORK_DAY_HOURS) || 7;
const PRIO: Record<string, number> = { urgent: 1, high: 2, medium: 3, low: 4 };

export function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function nextDay(s: string): string {
  const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + 1); return localDate(d);
}
export function isWeekend(s: string): boolean {
  const dow = new Date(s + 'T00:00:00').getDay(); return dow === 0 || dow === 6;
}
export function skipToWorkday(s: string): string {
  while (isWeekend(s)) s = nextDay(s); return s;
}

export interface WorkItem {
  task_id: number;
  user_id: number;
  stage_idx: number | null;
  hours: number;
  due_date: string;
  priority: string;
  earliest: string;       // earliest slot date (day after the previous stage's last block)
  anchor: string | null;  // day the person chose by hand; null = scheduler decides
}
export interface Slot { task_id: number; user_id: number; stage_idx: number | null; slot_date: string; hours: number; is_manual: boolean }

export const itemKey = (i: { task_id: number; stage_idx: number | null }) => `${i.task_id}|${i.stage_idx ?? ''}`;

// Everything this person has to do from today: only the CURRENT stage of a ticket, and only once they've accepted it
export async function loadItems(userId: number, db: Knex, today: string): Promise<WorkItem[]> {
  const taskRows = await db('tasks as t')
    .whereNotIn('t.status', ['completed', 'draft'])
    .whereNotNull('t.due_date')
    .where('t.due_date', '>=', today)
    .where(function (this: any) {
      this.where('t.assigned_to', userId)
        .orWhereIn('t.id', db('task_assignees').where('user_id', userId).select('task_id'));
    })
    .select('t.id as task_id', 't.priority', 't.due_date', 't.estimated_hours', 't.ticket_type_id', 't.xlr8_stage_idx');
  if (!taskRows.length) return [];

  const asg = await db('task_assignees')
    .where({ user_id: userId, acceptance_status: 'accepted' })
    .where((q: any) => q.whereNull('skipped').orWhere('skipped', 0))
    .whereIn('task_id', taskRows.map((t: any) => t.task_id))
    .select('task_id', 'stage_idx', 'est_hours', 'schedule_anchor');

  const seen = new Set<string>();
  const items: WorkItem[] = [];
  for (const t of taskRows) {
    const due = String(t.due_date).slice(0, 10);
    if (t.ticket_type_id) {
      const cur = t.xlr8_stage_idx ?? 0;
      const sr = asg.find((r: any) => r.task_id === t.task_id && r.stage_idx === cur);
      if (!sr || seen.has(`${t.task_id}-${cur}`)) continue;
      seen.add(`${t.task_id}-${cur}`);
      let earliest = today;
      if (cur > 0) {
        const prev = await db('task_schedule_slots').where({ task_id: t.task_id }).where('stage_idx', cur - 1).max('slot_date as last_date').first() as any;
        if (prev?.last_date) { const after = nextDay(String(prev.last_date).slice(0, 10)); if (after > earliest) earliest = after; }
      }
      items.push({ task_id: t.task_id, user_id: userId, stage_idx: cur, hours: Number(sr.est_hours) || 1, due_date: due, priority: t.priority || 'medium', earliest, anchor: sr.schedule_anchor || null });
    } else {
      const sr = asg.find((r: any) => r.task_id === t.task_id);
      const hrs = Number(t.estimated_hours) || 0;
      if (!sr || !hrs || seen.has(`${t.task_id}-null`)) continue;
      seen.add(`${t.task_id}-null`);
      items.push({ task_id: t.task_id, user_id: userId, stage_idx: null, hours: hrs, due_date: due, priority: t.priority || 'medium', earliest: today, anchor: sr.schedule_anchor || null });
    }
  }
  return items;
}

// Lay work onto days. Hand-placed work goes first, from the day the person chose; everything else fills the gaps
// by priority then due date. Pure: the real scheduler and the drag preview both use it.
export function planSlots(items: WorkItem[], today: string, cap = DAY_CAP): Slot[] {
  const order = [...items].sort((a, b) => {
    if (!!a.anchor !== !!b.anchor) return a.anchor ? -1 : 1;
    if (a.anchor && b.anchor && a.anchor !== b.anchor) return a.anchor < b.anchor ? -1 : 1;
    const pd = (PRIO[a.priority] || 3) - (PRIO[b.priority] || 3);
    if (pd !== 0) return pd;
    return a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0;
  });
  const dayUsed = new Map<string, number>();
  const out: Slot[] = [];
  for (const item of order) {
    let rem = round2(item.hours);
    const start = [today, item.earliest, item.anchor || ''].reduce((a, b) => (b > a ? b : a));
    let date = skipToWorkday(start);
    // The last allowed day takes whatever is left so hours are never silently dropped
    const lastDay = [today, item.due_date, date].reduce((a, b) => (b > a ? b : a));
    for (let guard = 0; rem > 0.01 && guard < 400; guard++) {
      if (isWeekend(date)) { date = nextDay(date); continue; }
      const used = dayUsed.get(date) || 0;
      const avail = date >= lastDay ? rem : round2(cap - used);
      if (avail <= 0.01) { date = nextDay(date); continue; }
      const hrs = round2(Math.min(rem, avail));
      out.push({ task_id: item.task_id, user_id: item.user_id, stage_idx: item.stage_idx, slot_date: date, hours: hrs, is_manual: !!item.anchor });
      dayUsed.set(date, used + hrs);
      rem = round2(rem - hrs);
      if (rem > 0.01) date = nextDay(date);
    }
  }
  return out;
}

export async function scheduleUser(userId: number, db: Knex): Promise<void> {
  const today = localDate(new Date());
  const items = await loadItems(userId, db, today);
  // Keep times of day people dragged blocks to, as long as the block is still on that day
  const pins = new Map<string, number>();
  for (const r of await db('task_schedule_slots').where({ user_id: userId }).where('slot_date', '>=', today).whereNotNull('custom_start_hour').select('task_id', 'stage_idx', 'slot_date', 'custom_start_hour')) {
    pins.set(`${itemKey(r)}|${String(r.slot_date).slice(0, 10)}`, r.custom_start_hour);
  }
  const slots = planSlots(items, today).map(s => ({ ...s, custom_start_hour: pins.get(`${itemKey(s)}|${s.slot_date}`) ?? null }));
  await db.transaction(async (trx) => {
    await trx('task_schedule_slots').where({ user_id: userId }).where('slot_date', '>=', today).delete();
    if (slots.length) await trx('task_schedule_slots').insert(slots);
  });
}

// Trigger scheduling for all users assigned to a task
export async function scheduleTaskUsers(taskId: number, db: Knex): Promise<void> {
  const task = await db('tasks').where('id', taskId).select('assigned_to').first();
  const userIds = new Set<number>();
  if (task?.assigned_to) userIds.add(task.assigned_to);

  const assignees = await db('task_assignees').where('task_id', taskId).select('user_id');
  for (const a of assignees) userIds.add(a.user_id);

  for (const uid of userIds) await scheduleUser(uid, db);
}

function round2(n: number) { return Math.round(n * 100) / 100; }
