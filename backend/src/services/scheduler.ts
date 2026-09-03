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
    } catch (err) { console.error('[scheduler] Recurring task error:', err); }
  });
  console.log('[scheduler] Recurring task scheduler started (daily 00:05)');
}

// ── Phase 2: Work scheduling algorithm ───────────────────────────────────────

const DAY_CAP = 7;
const PRIO: Record<string, number> = { urgent: 1, high: 2, medium: 3, low: 4 };

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function nextDay(s: string): string {
  const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + 1); return localDate(d);
}
function isWeekend(s: string): boolean {
  const dow = new Date(s + 'T00:00:00').getDay(); return dow === 0 || dow === 6;
}
function skipToWorkday(s: string): string {
  while (isWeekend(s)) s = nextDay(s); return s;
}

interface WorkItem {
  task_id: number;
  user_id: number;
  stage_idx: number | null;
  hours: number;
  due_date: string;
  priority: string;
  earliest: string; // earliest slot date
}

export async function scheduleUser(userId: number, db: Knex): Promise<void> {
  const today = localDate(new Date());

  // 1. Wipe future slots for this user
  await db('task_schedule_slots').where({ user_id: userId }).where('slot_date', '>=', today).delete();

  // 2. Fetch tasks this user is assigned to (active, has due_date and est hours)
  const taskRows = await db('tasks as t')
    .whereNotIn('t.status', ['completed', 'draft'])
    .whereNotNull('t.due_date')
    .where('t.due_date', '>=', today)
    .where(function (this: any) {
      this.where('t.assigned_to', userId)
        .orWhereIn('t.id', db('task_assignees').where('user_id', userId).select('task_id'));
    })
    .select('t.id as task_id', 't.priority', 't.due_date', 't.estimated_hours', 't.ticket_type_id', 't.xlr8_stage_idx');

  if (!taskRows.length) return;

  // 3. Fetch per-stage assignments for XLR8 tasks
  const stageRows = await db('task_assignees')
    .where('user_id', userId)
    .whereIn('task_id', taskRows.map((t: any) => t.task_id))
    .whereNotNull('stage_idx')
    .select('task_id', 'stage_idx', 'est_hours', 'acceptance_status');

  // For non-XLR8 tasks, only schedule if the user has accepted
  const nonXlr8AcceptedIds = new Set<number>(
    (await db('task_assignees')
      .where({ user_id: userId, acceptance_status: 'accepted' })
      .whereIn('task_id', taskRows.filter((t: any) => !t.ticket_type_id).map((t: any) => t.task_id))
      .select('task_id')
    ).map((r: any) => Number(r.task_id))
  );

  // 4. Build work items (deduplicated)
  const seen = new Set<string>();
  const items: WorkItem[] = [];

  for (const t of taskRows) {
    const isXlr8 = !!t.ticket_type_id;
    if (isXlr8) {
      // Only schedule the CURRENT active stage for this user.
      // Future stages are scheduled when the ticket advances to that stage.
      const currentStageIdx = t.xlr8_stage_idx ?? 0;
      const sr = stageRows.find((r: any) => r.task_id === t.task_id && r.stage_idx === currentStageIdx);
      if (!sr) continue; // this user is not on the current active stage
      if (sr.acceptance_status !== 'accepted') continue; // user hasn't accepted yet

      const hrs = Number(sr.est_hours) || 1;
      const key = `${t.task_id}-${currentStageIdx}`;
      if (seen.has(key)) { continue; }
      seen.add(key);

      let earliest = today;
      if (currentStageIdx > 0) {
        const prev = await db('task_schedule_slots')
          .where({ task_id: t.task_id })
          .where('stage_idx', currentStageIdx - 1)
          .max('slot_date as last_date')
          .first() as any;
        if (prev?.last_date) {
          const after = nextDay(String(prev.last_date));
          if (after > earliest) earliest = after;
        }
      }

      items.push({ task_id: t.task_id, user_id: userId, stage_idx: currentStageIdx, hours: hrs, due_date: t.due_date, priority: t.priority || 'medium', earliest });
    } else {
      if (!nonXlr8AcceptedIds.has(Number(t.task_id))) continue; // user hasn't accepted
      const key = `${t.task_id}-null`;
      if (seen.has(key)) continue;
      seen.add(key);
      const hrs = Number(t.estimated_hours) ?? 0;
      if (!hrs) continue;
      items.push({ task_id: t.task_id, user_id: userId, stage_idx: null, hours: hrs, due_date: t.due_date, priority: t.priority || 'medium', earliest: today });
    }
  }

  // 5. Sort: priority asc, then due_date asc
  items.sort((a, b) => {
    const pd = (PRIO[a.priority] || 3) - (PRIO[b.priority] || 3);
    if (pd !== 0) return pd;
    return a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0;
  });

  // 6. Fill days greedily
  const dayUsed = new Map<string, number>();
  const toInsert: { task_id: number; user_id: number; stage_idx: number | null; slot_date: string; hours: number }[] = [];

  for (const item of items) {
    let rem = round2(item.hours);
    let date = skipToWorkday(item.earliest);

    // If due date is already past, place on today so the task still shows
    const effectiveDue = item.due_date < today ? today : item.due_date;

    while (rem > 0.01) {
      if (isWeekend(date)) { date = nextDay(date); continue; }
      if (date > effectiveDue) break; // can't push past deadline

      const used = dayUsed.get(date) || 0;
      // On the due date, allow overcap so remaining hours are never silently dropped
      const avail = date === effectiveDue ? rem : round2(DAY_CAP - used);
      if (avail <= 0.01) { date = nextDay(date); continue; }

      const hrs = round2(Math.min(rem, avail));
      toInsert.push({ task_id: item.task_id, user_id: userId, stage_idx: item.stage_idx, slot_date: date, hours: hrs });
      dayUsed.set(date, used + hrs);
      rem = round2(rem - hrs);
      if (rem > 0.01) date = nextDay(date);
    }
  }

  if (toInsert.length) await db('task_schedule_slots').insert(toInsert);
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
