import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { getDB } from '../db';
import type { Knex } from 'knex';
import { DAY_CAP, loadItems, planSlots, scheduleUser, itemKey, nextDay, isWeekend, skipToWorkday, WorkItem, Slot } from '../services/scheduler';

const router = Router();
router.use(authenticate);

// List recurring tasks (own + assigned to my team for managers/admins)
router.get('/recurring', async (req: AuthRequest, res: Response) => {
  const db = getDB();
  const user = req.user!;
  let query = db('recurring_tasks as rt')
    .join('users as u', 'rt.assigned_to', 'u.id')
    .leftJoin('users as c', 'rt.created_by', 'c.id')
    .leftJoin('projects as p', 'rt.project_id', 'p.id')
    .select(
      'rt.*',
      'u.name as assigned_to_name', 'u.avatar_color as assigned_to_color',
      'c.name as created_by_name',
      'p.name as project_name'
    );

  // Calendar shows only your own recurring tickets — even ones you created for someone else
  query = query.where('rt.assigned_to', user.id);

  const rows = await query.orderBy('rt.created_at', 'desc');
  res.json(rows.map(r => ({ ...r, recurrence_days: r.recurrence_days ? (typeof r.recurrence_days === 'string' ? JSON.parse(r.recurrence_days) : r.recurrence_days) : [] })));
});

router.post('/recurring', async (req: AuthRequest, res: Response) => {
  const db = getDB();
  const user = req.user!;
  const { title, description, doc_link, assigned_to, project_id, recurrence_type, recurrence_days, day_of_month, start_date, end_date, estimated_hours, priority } = req.body;
  if (!title || !recurrence_type || !start_date) { res.status(400).json({ error: 'title, recurrence_type, start_date required' }); return; }

  const canAssign = user.role === 'admin' || user.role === 'manager';
  const assignee = canAssign && assigned_to ? Number(assigned_to) : user.id;

  const [id] = await db('recurring_tasks').insert({
    title,
    description: description || null,
    doc_link: doc_link || null,
    assigned_to: assignee,
    created_by: user.id,
    project_id: project_id || null,
    recurrence_type,
    recurrence_days: recurrence_days ? JSON.stringify(recurrence_days) : null,
    day_of_month: day_of_month || null,
    start_date,
    end_date: end_date || null,
    estimated_hours: estimated_hours || 1,
    priority: priority || 'medium',
  });

  // Create the next occurrence now so it shows up straight away; the daily scheduler adds the rest
  const days = recurrence_days ? (Array.isArray(recurrence_days) ? recurrence_days : JSON.parse(recurrence_days)) : [];
  const endLimit = end_date ? new Date(end_date + 'T00:00:00') : null;
  for (let i = 0; i < 30; i++) {
    const d = new Date(start_date + 'T00:00:00');
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    if (endLimit && d > endLimit) break;
    let occurs = false;
    if (recurrence_type === 'daily') occurs = true;
    else if (recurrence_type === 'weekly') occurs = days.includes(d.getDay());
    else if (recurrence_type === 'monthly') occurs = day_of_month ? d.getDate() === Number(day_of_month) : d.getDate() === 1;
    if (!occurs) continue;
    const exists = await db('tasks').where('recurring_task_id', id).where('recurrence_date', dateStr).first();
    if (exists) continue;
    await db('tasks').insert({
      title,
      description: description || '',
      project_id: project_id || null,
      assigned_to: assignee,
      created_by: user.id,
      status: 'todo',
      priority: priority || 'medium',
      estimated_hours: estimated_hours || 1,
      due_date: dateStr,
      recurring_task_id: id,
      recurrence_date: dateStr,
    });
    break;
  }

  res.json({ id });
});

router.put('/recurring/:id', async (req: AuthRequest, res: Response) => {
  const db = getDB();
  const user = req.user!;
  const rt = await db('recurring_tasks').where('id', req.params.id).first();
  if (!rt) { res.status(404).json({ error: 'Not found' }); return; }
  if (rt.created_by !== user.id && user.role !== 'admin') { res.status(403).json({ error: 'Forbidden' }); return; }

  const { title, description, doc_link, assigned_to, project_id, recurrence_type, recurrence_days, day_of_month, start_date, end_date, estimated_hours, priority, active } = req.body;
  await db('recurring_tasks').where('id', req.params.id).update({
    title: title ?? rt.title,
    description: description ?? rt.description,
    doc_link: doc_link !== undefined ? doc_link : rt.doc_link,
    assigned_to: assigned_to ?? rt.assigned_to,
    project_id: project_id !== undefined ? project_id : rt.project_id,
    recurrence_type: recurrence_type ?? rt.recurrence_type,
    recurrence_days: recurrence_days !== undefined ? JSON.stringify(recurrence_days) : rt.recurrence_days,
    day_of_month: day_of_month ?? rt.day_of_month,
    start_date: start_date ?? rt.start_date,
    end_date: end_date !== undefined ? end_date : rt.end_date,
    estimated_hours: estimated_hours ?? rt.estimated_hours,
    priority: priority ?? rt.priority,
    active: active !== undefined ? active : rt.active,
  });
  res.json({ ok: true });
});

router.delete('/recurring/:id', async (req: AuthRequest, res: Response) => {
  const db = getDB();
  const user = req.user!;
  const rt = await db('recurring_tasks').where('id', req.params.id).first();
  if (!rt) { res.status(404).json({ error: 'Not found' }); return; }
  if (rt.created_by !== user.id && !['admin', 'manager'].includes(user.role)) {
    res.status(403).json({ error: 'Only the person who set this up, or a manager, can stop it' });
    return;
  }
  const tasks = await db('tasks').where('recurring_task_id', req.params.id).select('id');
  const taskIds = tasks.map((t: any) => t.id);
  if (taskIds.length) {
    const logged = await db('time_logs').whereIn('task_id', taskIds).pluck('task_id');
    const loggedSet = new Set(logged.map(Number));
    const toDelete = taskIds.filter((tid: number) => !loggedSet.has(tid));
    if (toDelete.length) {
      await db('task_sessions').whereIn('task_id', toDelete).delete().catch(() => {});
      await db('task_assignees').whereIn('task_id', toDelete).delete().catch(() => {});
      await db('task_checklist').whereIn('task_id', toDelete).delete().catch(() => {});
      await db('task_comments').whereIn('task_id', toDelete).delete().catch(() => {});
      await db('tasks').whereIn('id', toDelete).delete();
    }
    const toDetach = taskIds.filter((tid: number) => loggedSet.has(tid));
    if (toDetach.length) {
      await db('tasks').whereIn('id', toDetach).update({ recurring_task_id: null });
    }
  }
  await db('recurring_tasks').where('id', req.params.id).delete();
  res.json({ ok: true });
});

// Calendar events for a month: tasks with due_date + recurring instances
router.get('/events', async (req: AuthRequest, res: Response) => {
  try {
  const db = getDB();
  const user = req.user!;
  const { month } = req.query as { month?: string }; // YYYY-MM
  if (!month) { res.status(400).json({ error: 'month required (YYYY-MM)' }); return; }

  const [year, mon] = month.split('-').map(Number);
  const start = `${month}-01`;
  const lastDay = new Date(year, mon, 0).getDate();
  const end = `${year}-${String(mon).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  let tasks: any[];

  // Everyone (admins and managers too) sees only their own schedule — task_schedule_slots,
  // same as the weekly view. Only clients get the project-wide due-date view below.
  if (user.role !== 'client') {
    const slotRows = await db('task_schedule_slots as s')
      .join('tasks as t', 's.task_id', 't.id')
      .leftJoin('users as a', 't.assigned_to', 'a.id')
      .leftJoin('projects as p', 't.project_id', 'p.id')
      .where('s.user_id', user.id)
      .whereBetween('s.slot_date', [start, end])
      .select('t.id', 't.title', 't.due_date', 't.status', 't.priority', 't.estimated_hours',
        't.recurring_task_id', 't.recurrence_date',
        'a.name as assigned_to_name', 'a.avatar_color', 'p.name as project_name',
        's.slot_date as event_date',
        db.raw("'task' as event_type"));
    const scheduledIds = new Set(slotRows.map((r: any) => r.id));
    const futureRows = await db('task_assignees as ta')
      .join('tasks as t', 'ta.task_id', 't.id')
      .leftJoin('users as a', 't.assigned_to', 'a.id')
      .leftJoin('projects as p', 't.project_id', 'p.id')
      .where('ta.user_id', user.id)
      .where('ta.acceptance_status', 'accepted')
      .whereNotNull('ta.stage_idx')
      .whereRaw('ta.stage_idx > t.xlr8_stage_idx')
      .whereNotIn('t.status', ['completed', 'draft'])
      .whereNotNull('t.due_date')
      .whereBetween('t.due_date', [start, end])
      .select('t.id', 't.title', 't.due_date as event_date', 't.status', 't.priority', 't.estimated_hours',
        't.recurring_task_id', 't.recurrence_date',
        'a.name as assigned_to_name', 'a.avatar_color', 'p.name as project_name',
        db.raw("'task' as event_type"), db.raw('1 as is_placeholder'));
    // Also fetch completed tasks (slots deleted by scheduler) via due_date or session date
    const completedRows = await db('tasks as t')
      .join('task_assignees as ta', 'ta.task_id', 't.id')
      .leftJoin('projects as p', 't.project_id', 'p.id')
      .where('ta.user_id', user.id)
      .where('t.status', 'completed')
      .whereNotNull('t.due_date')
      .whereBetween('t.due_date', [start, end])
      .select('t.id', 't.title', 't.due_date as event_date', 't.status', 't.priority', 't.estimated_hours',
        't.recurring_task_id', 't.recurrence_date',
        'p.name as project_name',
        db.raw("'task' as event_type"));
    const completedIds = new Set(completedRows.map((r: any) => r.id));

    tasks = [
      ...slotRows.map((t: any) => ({ ...t, date: t.event_date })),
      ...futureRows.filter((t: any) => !scheduledIds.has(t.id)).map((t: any) => ({ ...t, date: t.event_date })),
      ...completedRows.filter((t: any) => !scheduledIds.has(t.id)).map((t: any) => ({ ...t, date: t.event_date })),
    ];
  } else {
    // Admins/managers: show all tasks by due_date, but only XLR8 tasks where all employee-stage assignees have accepted
    let taskQuery = db('tasks as t')
      .leftJoin('users as a', 't.assigned_to', 'a.id')
      .leftJoin('projects as p', 't.project_id', 'p.id')
      .whereNotNull('t.due_date')
      .whereBetween('t.due_date', [start, end])
      .whereRaw(`(t.ticket_type_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM task_assignees ta2
        WHERE ta2.task_id = t.id AND ta2.stage_idx IS NOT NULL
          AND ta2.assignee_role NOT IN ('admin','client')
          AND (ta2.acceptance_status IS NULL OR ta2.acceptance_status != 'accepted')
      ))`)
      .select('t.id', 't.title', 't.due_date as event_date', 't.status', 't.priority', 't.estimated_hours',
        't.recurring_task_id', 't.recurrence_date',
        'a.name as assigned_to_name', 'a.avatar_color', 'p.name as project_name',
        db.raw("'task' as event_type"));
    if (user.role === 'client') {
      taskQuery = taskQuery.whereIn('t.project_id', db('projects').where('client_id', user.id).select('id'));
    }
    const rawTasks = await taskQuery;
    tasks = rawTasks.map((t: any) => ({ ...t, date: t.event_date || null }));
  }

  // Recurring task instances for this month (generated virtually — no DB row needed for display)
  let rtQuery = db('recurring_tasks as rt')
    .join('users as u', 'rt.assigned_to', 'u.id')
    .leftJoin('projects as p', 'rt.project_id', 'p.id')
    .where('rt.active', true)
    .where('rt.start_date', '<=', end)
    .where(function () {
      this.whereNull('rt.end_date').orWhere('rt.end_date', '>=', start);
    })
    .select('rt.*', 'u.name as assigned_to_name', 'u.avatar_color', 'p.name as project_name');

  rtQuery = rtQuery.where('rt.assigned_to', user.id);

  const recurringTemplates = await rtQuery;

  // Expand recurring templates into daily occurrences for this month
  const recurringEvents: any[] = [];
  const daysInMonth = new Date(year, mon, 0).getDate();

  for (const rt of recurringTemplates) {
    const days = rt.recurrence_days ? (typeof rt.recurrence_days === 'string' ? JSON.parse(rt.recurrence_days) : rt.recurrence_days) : [];
    for (let d = 1; d <= daysInMonth; d++) {
      // Build dateStr from parts to avoid UTC timezone shift from toISOString()
      const dateStr = `${year}-${String(mon).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (dateStr < rt.start_date) continue;
      if (rt.end_date && dateStr > rt.end_date) continue;

      const dayOfWeek = new Date(year, mon - 1, d).getDay(); // local day, correct since date is constructed from local parts
      let occurs = false;
      if (rt.recurrence_type === 'daily') {
        occurs = true;
      } else if (rt.recurrence_type === 'weekly') {
        occurs = days.includes(dayOfWeek);
      } else if (rt.recurrence_type === 'monthly') {
        occurs = rt.day_of_month ? d === rt.day_of_month : d === 1;
      }

      if (!occurs) continue;

      // Check if a real task instance already exists for this date
      const instance = await db('tasks')
        .where('recurring_task_id', rt.id)
        .where('recurrence_date', dateStr)
        .select('id', 'status')
        .first();

      recurringEvents.push({
        id: `rt_${rt.id}_${dateStr}`,
        recurring_task_id: rt.id,
        title: rt.title,
        date: dateStr,
        status: instance?.status || 'recurring',
        priority: rt.priority,
        estimated_hours: rt.estimated_hours,
        assigned_to_name: rt.assigned_to_name,
        avatar_color: rt.avatar_color,
        project_name: rt.project_name,
        task_instance_id: instance?.id || null,
        event_type: 'recurring',
        description: rt.description || null,
        doc_link: rt.doc_link || null,
      });
    }
  }

  res.json({ tasks, recurring: recurringEvents });
  } catch (err: any) {
    console.error('Calendar events error:', err?.message || err);
    res.status(500).json({ error: err?.message || 'Internal server error' });
  }
});

// Generate today's recurring task instances (called by scheduler, also callable manually)
router.post('/recurring/generate', async (req: AuthRequest, res: Response) => {
  if (req.user!.role !== 'admin') { res.status(403).json({ error: 'Forbidden' }); return; }
  const count = await generateTodayInstances();
  res.json({ generated: count });
});

export async function generateTodayInstances(): Promise<number> {
  const db = getDB();
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const dayOfWeek = today.getDay(); // 0=Sun, local time
  const dayOfMonth = today.getDate();

  const templates = await db('recurring_tasks').where('active', true)
    .where('start_date', '<=', dateStr)
    .where(function () {
      this.whereNull('end_date').orWhere('end_date', '>=', dateStr);
    });

  let count = 0;
  for (const rt of templates) {
    const days = rt.recurrence_days ? (typeof rt.recurrence_days === 'string' ? JSON.parse(rt.recurrence_days) : rt.recurrence_days) : [];
    let occurs = false;
    if (rt.recurrence_type === 'daily') occurs = true;
    else if (rt.recurrence_type === 'weekly') occurs = days.includes(dayOfWeek);
    else if (rt.recurrence_type === 'monthly') occurs = rt.day_of_month ? dayOfMonth === rt.day_of_month : dayOfMonth === 1;

    if (!occurs) continue;

    const exists = await db('tasks').where('recurring_task_id', rt.id).where('recurrence_date', dateStr).first();
    if (exists) continue;

    await db('tasks').insert({
      title: rt.title,
      description: rt.description || '',
      project_id: rt.project_id || null,
      assigned_to: rt.assigned_to,
      created_by: rt.created_by,
      status: 'todo',
      priority: rt.priority || 'medium',
      estimated_hours: rt.estimated_hours || 1,
      due_date: dateStr,
      recurring_task_id: rt.id,
      recurrence_date: dateStr,
    });
    count++;
  }
  return count;
}

// Weekly view — uses scheduled slots (Phase 2)
router.get('/week', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const user = req.user!;
    const { start } = req.query as { start?: string };
    if (!start) { res.status(400).json({ error: 'start required (YYYY-MM-DD)' }); return; }

    const localDate = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };
    const monday = new Date(start + 'T00:00:00');
    const days: string[] = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(monday); d.setDate(monday.getDate() + i); days.push(localDate(d));
    }
    const [weekStart, weekEnd] = [days[0], days[4]];

    const isProd = process.env.NODE_ENV === 'production';
    const trackedSubSQL = isProd
      ? `(SELECT COALESCE(SUM(TIMESTAMPDIFF(SECOND, ts.started_at, COALESCE(ts.ended_at, NOW()))), 0) FROM task_sessions ts WHERE ts.task_id = t.id)`
      : `(SELECT COALESCE(SUM(CAST((COALESCE(ts.ended_at, strftime('%s','now') * 1000) - ts.started_at) / 1000 AS INTEGER)), 0) FROM task_sessions ts WHERE ts.task_id = t.id)`;

    // Phase 2: personal schedule slots (all roles)
    const slotRowsRaw = await db('task_schedule_slots as s')
      .join('tasks as t', 's.task_id', 't.id')
      .leftJoin('projects as p', 't.project_id', 'p.id')
      .where('s.user_id', user.id)
      .whereBetween('s.slot_date', [weekStart, weekEnd])
      .select(
        't.id', 't.title', 't.due_date', 't.status', 't.priority',
        't.estimated_hours', 't.ticket_type_id', 't.xlr8_stage_idx', 't.xlr8_status',
        'p.name as project_name',
        's.id as slot_id', 's.slot_date', 's.hours as slot_hours', 's.stage_idx as scheduled_stage', 's.custom_start_hour', 's.is_manual',
        db.raw(`${trackedSubSQL} as tracked_seconds`),
        db.raw(`(SELECT est_hours FROM task_assignees WHERE task_id = s.task_id AND user_id = ? AND stage_idx = s.stage_idx LIMIT 1) as user_est_hours`, [user.id])
      )
      .orderByRaw("CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END");
    let slotRows: any[] = slotRowsRaw;

    // Admin/manager see only their own calendar (no overview of other people's tickets)
    if (user.role === 'admin' || user.role === 'manager') {
      // Trigger scheduler for admin/manager so their personally assigned tasks get real slots
      if (slotRowsRaw.length === 0) {
        import('../services/scheduler').then(({ scheduleUser }) => scheduleUser(user.id, db)).catch(() => {});
      }
    }

    // Recurring instances for the week (always due_date based — no scheduling needed)
    let recurringQuery = db('recurring_tasks as rt')
      .leftJoin('projects as p', 'rt.project_id', 'p.id')
      .leftJoin('users as u', 'rt.assigned_to', 'u.id')
      .where('rt.active', true)
      .where('rt.start_date', '<=', weekEnd)
      .where(function () { this.whereNull('rt.end_date').orWhere('rt.end_date', '>=', weekStart); })
      .select('rt.*', 'p.name as project_name', 'u.name as assigned_to_name');
    recurringQuery = recurringQuery.where('rt.assigned_to', user.id);
    const recurringTemplates = await recurringQuery;

    // Load per-day start-hour overrides for recurring tasks this week
    const recurringIds = recurringTemplates.map((rt: any) => rt.id);
    const recurOverrides: Record<string, number> = {};
    if (recurringIds.length) {
      const overrideRows = await db('recurring_task_overrides')
        .whereIn('recurring_task_id', recurringIds)
        .where('user_id', user.id)
        .whereBetween('date', [weekStart, weekEnd])
        .select('recurring_task_id', 'date', 'custom_start_hour');
      for (const o of overrideRows) recurOverrides[`${o.recurring_task_id}_${o.date}`] = o.custom_start_hour;
    }

    const recurring: any[] = [];
    for (const rt of recurringTemplates) {
      const isOwn = rt.assigned_to === user.id;
      const rdaysList = rt.recurrence_days ? (typeof rt.recurrence_days === 'string' ? JSON.parse(rt.recurrence_days) : rt.recurrence_days) : [];
      for (const dateStr of days) {
        const dow = new Date(dateStr + 'T00:00:00').getDay();
        let occurs = false;
        if (rt.recurrence_type === 'daily') occurs = true;
        else if (rt.recurrence_type === 'weekly') occurs = rdaysList.includes(dow);
        else if (rt.recurrence_type === 'monthly') { const d = parseInt(dateStr.slice(8)); occurs = rt.day_of_month ? d === rt.day_of_month : d === 1; }
        if (!occurs || dateStr < rt.start_date || (rt.end_date && dateStr > rt.end_date)) continue;
        const customStartHour = recurOverrides[`${rt.id}_${dateStr}`] ?? null;
        recurring.push({ id: `rt_${rt.id}_${dateStr}`, recurring_task_id: rt.id, title: rt.title, due_date: dateStr, slot_date: dateStr, status: 'recurring', priority: rt.priority, estimated_hours: rt.estimated_hours, slot_hours: rt.estimated_hours, project_name: rt.project_name, assigned_to_name: rt.assigned_to_name, event_type: 'recurring', tracked_seconds: 0, is_overview: !isOwn, description: rt.description || null, doc_link: rt.doc_link || null, custom_start_hour: customStartHour });
      }
    }

    // Future-stage placeholder: tasks assigned to this user at a stage not yet active,
    // shown on their due_date so the user can see upcoming work before it's their turn.
    const scheduledTaskIds = new Set(slotRows.map((r: any) => r.id));
    const futureStageRows = (user.role === 'admin' || user.role === 'manager') ? [] : await db('task_assignees as ta')
      .join('tasks as t', 'ta.task_id', 't.id')
      .leftJoin('projects as p', 't.project_id', 'p.id')
      .where('ta.user_id', user.id)
      .where('ta.acceptance_status', 'accepted')
      .whereNotNull('ta.stage_idx')
      .whereRaw('ta.stage_idx > t.xlr8_stage_idx')
      .whereNotIn('t.status', ['completed', 'draft'])
      .whereNotNull('t.due_date')
      .whereBetween('t.due_date', [weekStart, weekEnd])
      .select('t.id', 't.title', 't.due_date', 't.status', 't.priority',
        't.estimated_hours', 't.ticket_type_id', 't.xlr8_stage_idx', 't.xlr8_status',
        'p.name as project_name', 'ta.est_hours as user_est_hours', 'ta.stage_idx as scheduled_stage',
        db.raw('0 as tracked_seconds'));

    // For employees: if no slots exist this week, trigger scheduler then re-fetch
    if (user.role !== 'admin' && user.role !== 'manager' && slotRowsRaw.length === 0) {
      try {
        
        const { scheduleUser } = await import('../services/scheduler');
        await scheduleUser(user.id, db);
        const refetched = await db('task_schedule_slots as s')
          .join('tasks as t', 's.task_id', 't.id')
          .leftJoin('projects as p', 't.project_id', 'p.id')
          .where('s.user_id', user.id)
          .whereBetween('s.slot_date', [weekStart, weekEnd])
          .select(
            't.id', 't.title', 't.due_date', 't.status', 't.priority',
            't.estimated_hours', 't.ticket_type_id', 't.xlr8_stage_idx', 't.xlr8_status',
            'p.name as project_name',
            's.id as slot_id', 's.slot_date', 's.hours as slot_hours', 's.stage_idx as scheduled_stage', 's.custom_start_hour', 's.is_manual',
            db.raw(`${trackedSubSQL} as tracked_seconds`),
            db.raw(`(SELECT est_hours FROM task_assignees WHERE task_id = s.task_id AND user_id = ? AND stage_idx = s.stage_idx LIMIT 1) as user_est_hours`, [user.id])
          );
        slotRows = refetched;
      } catch {}
    }

    // For employees: completed tasks lose their slots — fetch them by due_date
    const slottedTaskIds = new Set(slotRows.map((r: any) => r.id));
    if (user.role !== 'admin' && user.role !== 'manager') {
      const completedEmployee = await db('tasks as t')
        .join('task_assignees as ta', 'ta.task_id', 't.id')
        .leftJoin('projects as p', 't.project_id', 'p.id')
        .where('ta.user_id', user.id)
        .where('t.status', 'completed')
        .whereNotNull('t.due_date')
        .whereBetween('t.due_date', [weekStart, weekEnd])
        .select('t.id', 't.title', 't.due_date', 't.status', 't.priority',
          't.estimated_hours', 't.ticket_type_id', 't.xlr8_stage_idx', 't.xlr8_status',
          'p.name as project_name', db.raw('0 as tracked_seconds'), db.raw('0 as slot_hours'));
      for (const t of completedEmployee) {
        if (!slottedTaskIds.has(t.id)) slotRows = [...slotRows, { ...t, slot_date: t.due_date }];
      }
    }

    const byDay: Record<string, any[]> = {};
    for (const d of days) byDay[d] = [];
    for (const t of slotRows) byDay[t.slot_date]?.push({ ...t, event_type: 'task' });
    for (const r of recurring) byDay[r.slot_date]?.push(r);
    // Add future-stage placeholders on due_date (skip if already has a slot this week)
    for (const t of futureStageRows) {
      if (scheduledTaskIds.has(t.id)) continue;
      const hrs = Number(t.user_est_hours) || 1;
      byDay[t.due_date]?.push({ ...t, slot_date: t.due_date, slot_hours: hrs, event_type: 'task', is_placeholder: true });
    }

    // Deadline health + stage names for the work this user has scheduled
    const health: Record<number, Health> = {};
    const ids = [...new Set(slotRows.filter((r: any) => r.slot_id != null).map((r: any) => Number(r.id)))];
    if (ids.length) {
      const work = await remainingWork(db, ids);
      const slots = await db('task_schedule_slots').whereIn('task_id', ids).where('slot_date', '>=', todayStr()).orderBy('slot_date').select('task_id', 'stage_idx', 'slot_date', 'hours');
      for (const id of ids) {
        const w = work[id];
        if (!w) continue;
        const mine = slots.filter((x: any) => x.task_id === id && (x.stage_idx ?? null) === w.cur).map((x: any) => ({ slot_date: String(x.slot_date).slice(0, 10), hours: Number(x.hours) }));
        const { chain, ...h } = chainHealth({ due: w.due, today: todayStr(), nowH: nowHour(), cap: DAY_CAP, stages: w.stages, stageName: w.cur == null ? w.title : w.stageNames[w.cur] || 'This stage', mine, downstream: w.cur == null ? [] : await downstreamFor(db, id, w, todayStr()) });
        health[id] = h;
      }
      for (const d of days) byDay[d] = byDay[d].map((r: any) => {
        const names = work[r.id]?.stageNames;
        if (!names || r.scheduled_stage == null) return r;
        return { ...r, stage_name: names[r.scheduled_stage] || null, blocking_stage_name: r.scheduled_stage > (r.xlr8_stage_idx ?? 0) ? names[r.xlr8_stage_idx ?? 0] || null : null };
      });
    }

    res.json({ days, byDay, health, cap: DAY_CAP, workStart: WORK_START_H, workEnd: WORK_END_H });
  } catch (e: any) {
    console.error('week error:', e?.message);
    res.status(500).json({ error: e?.message || 'Server error' });
  }
});

// Trigger scheduler for the current user (or all if admin)
router.post('/schedule', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const { scheduleUser, scheduleTaskUsers } = await import('../services/scheduler');
    const { all } = req.body || {};
    if (all && req.user!.role === 'admin') {
      const users = await db('users').whereIn('role', ['admin', 'manager', 'employee']).select('id');
      for (const u of users) await scheduleUser(u.id, db);
      res.json({ ok: true, users: users.length });
    } else {
      await scheduleUser(req.user!.id, db);
      res.json({ ok: true });
    }
  } catch (e: any) {
    console.error('schedule error:', e?.message);
    res.status(500).json({ error: e?.message || 'Server error' });
  }
});

// PATCH /calendar/recurring/:id/time — pin a recurring instance to a start hour for one specific day
router.patch('/recurring/:id/time', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const { start_hour, date } = req.body;
    if (typeof start_hour !== 'number' || !date) { res.status(400).json({ error: 'start_hour and date required' }); return; }
    const rt = await db('recurring_tasks').where({ id: req.params.id, assigned_to: req.user!.id }).first();
    if (!rt) { res.status(404).json({ error: 'Not found' }); return; }
    await db('recurring_task_overrides')
      .insert({ recurring_task_id: Number(req.params.id), user_id: req.user!.id, date, custom_start_hour: start_hour })
      .onConflict(['recurring_task_id', 'user_id', 'date'])
      .merge({ custom_start_hour: start_hour });
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e?.message || 'Server error' }); }
});

export const WORK_START_H = Number(process.env.WORK_START_HOUR) || 9;
export const WORK_END_H = Number(process.env.WORK_END_HOUR) || 18;
const todayStr = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; };
const nowHour = () => { const n = new Date(); return n.getHours() + n.getMinutes() / 60; };

type Remaining = { due: string; cur: number | null; title: string; stageNames: string[]; stages: { idx: number | null; name: string; hours: number; userIds: number[] }[] };

// Work still left on each task: the current stage (minus time logged) and every later stage that isn't skipped.
// ponytail: timer sessions aren't stage-tagged, so time the current stage's people logged on earlier stages counts here too;
// when sessions get a stage_idx, filter by it in doneH and nothing else changes.
export async function remainingWork(db: Knex, ids: number[]): Promise<Record<number, Remaining>> {
  const [taskRows, asg, sessions] = await Promise.all([
    db('tasks as t').leftJoin('xlr8_ticket_types as tt', 't.ticket_type_id', 'tt.id').whereIn('t.id', ids)
      .select('t.id', 't.title', 't.due_date', 't.estimated_hours', 't.ticket_type_id', 't.xlr8_stage_idx', 'tt.stages'),
    db('task_assignees').whereIn('task_id', ids).whereNotNull('stage_idx').select('task_id', 'user_id', 'stage_idx', 'est_hours', 'skipped'),
    db('task_sessions').whereIn('task_id', ids).select('task_id', 'user_id', 'started_at', 'ended_at'),
  ]);
  const doneH = (taskId: number, users?: Set<number>) => sessions
    .filter((s: any) => s.task_id === taskId && (!users || users.has(s.user_id)))
    .reduce((h: number, s: any) => h + ((s.ended_at ? new Date(s.ended_at).getTime() : Date.now()) - new Date(s.started_at).getTime()) / 3600000, 0);
  const out: Record<number, Remaining> = {};
  for (const t of taskRows) {
    let names: string[] = [];
    try { names = (JSON.parse(t.stages || '[]') as any[]).map((s, i) => s.category_name || s.name || `Stage ${i + 1}`); } catch {}
    const due = String(t.due_date).slice(0, 10);
    if (!t.ticket_type_id) {
      out[t.id] = { due, cur: null, title: t.title, stageNames: names, stages: [{ idx: null, name: t.title, hours: Math.max(0, (Number(t.estimated_hours) || 0) - doneH(t.id)), userIds: [] }] };
      continue;
    }
    const cur = t.xlr8_stage_idx ?? 0;
    const byStage = new Map<number, any[]>();
    for (const a of asg) if (a.task_id === t.id && a.stage_idx >= cur && !a.skipped) byStage.set(a.stage_idx, [...(byStage.get(a.stage_idx) || []), a]);
    out[t.id] = { due, cur, title: t.title, stageNames: names, stages: [...byStage.entries()].sort((a, b) => a[0] - b[0]).map(([idx, rows]) => {
      const est = Math.max(...rows.map(r => Number(r.est_hours) || 0));
      const users = rows.map(r => r.user_id);
      return { idx, name: names[idx] || `Stage ${idx + 1}`, hours: Math.max(0, est - (idx === cur ? doneH(t.id, new Set(users)) : 0)), userIds: users };
    }) };
  }
  return out;
}

// Working hours left from now through the due date (weekdays only; today counts from the current time)
export function workHoursUntil(due: string, today: string, nowH: number, cap: number): number {
  let total = 0;
  const d = new Date(today + 'T00:00:00');
  for (let s = today; s <= due; d.setDate(d.getDate() + 1), s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`) {
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue;
    total += s === today ? Math.max(0, Math.min(cap, WORK_END_H - Math.max(nowH, WORK_START_H))) : cap;
  }
  return Math.round(total * 100) / 100;
}

const fmtH = (h: number) => { const m = Math.round(Math.abs(h) * 60); return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`; };
const listNames = (n: string[]) => n.length <= 1 ? n.join('') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;

export type Health = { state: 'ok' | 'risk' | 'impossible' | 'overdue'; required: number; available: number; buffer: number; what: string; why: string; fix: string };

// Can the remaining work (this stage + every later stage, done one after another) still fit before the due date?
export function taskHealth(o: { due: string; today: string; nowH: number; cap: number; stages: { name: string; hours: number }[]; start?: string }): Health {
  const required = Math.round(o.stages.reduce((s, x) => s + x.hours, 0) * 100) / 100;
  const names = listNames(o.stages.filter(s => s.hours > 0).map(s => s.name));
  if (o.due < o.today) {
    const days = Math.round((new Date(o.today).getTime() - new Date(o.due).getTime()) / 86400000);
    return { state: 'overdue', required, available: 0, buffer: -required, what: `Overdue by ${days} day${days === 1 ? '' : 's'}`, why: `${fmtH(required)} of work is still left${names ? ` (${names})` : ''}.`, fix: 'Agree a new due date with the manager, or reassign the remaining stages.' };
  }
  const from = o.start && o.start > o.today ? o.start : o.today;
  const available = workHoursUntil(o.due, from, from === o.today ? o.nowH : 0, o.cap);
  const buffer = Math.round((available - required) * 100) / 100;
  if (buffer < 0) return { state: 'impossible', required, available, buffer, what: "Won't finish by the due date", why: `${names || 'This work'} still need${o.stages.length > 1 ? '' : 's'} ${fmtH(required)}, but only ${fmtH(available)} of working time is left. Short by ${fmtH(-buffer)}.`, fix: 'Extend the due date, reduce the estimate, or add another person to a stage.' };
  if (buffer < 2) return { state: 'risk', required, available, buffer, what: 'No room for delays', why: `Only ${fmtH(buffer)} spare before the due date${names ? ` once ${names} ${o.stages.length > 1 ? 'are' : 'is'} done` : ''}.`, fix: "Start this as early as possible and don't push it back." };
  return { state: 'ok', required, available, buffer, what: 'On track', why: `${fmtH(buffer)} spare before the due date.`, fix: '' };
}

// ─── Moving work between days ────────────────────────────────────────────────
export type MoveChange = { label: string; from: string; to: string };
export type MoveIssue = { tone: 'warn' | 'bad'; what: string; why: string; fix: string };
export type MovePreview = { tone: 'ok' | 'warn' | 'bad'; allowed: boolean; headline: string; moved?: MoveChange; issues: MoveIssue[]; changes: MoveChange[]; buffer: number | null; deadlineBefore?: { state: Health['state']; buffer: number }; deadlineAfter?: { state: Health['state']; buffer: number } };
export type Downstream = { name: string; userName: string; hours: number; busy: Record<string, number> };

// "Wed 14-10-2026" — weekday plus DD-MM-YYYY, same date format as the rest of the app
const dayLabel = (d: string) => {
  const [y, m, day] = d.split('-');
  return `${new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short' })} ${day}-${m}-${y}`;
};
const span = (a: string, b: string) => a === b ? dayLabel(a) : `${dayLabel(a)} – ${dayLabel(b)}`;
const blocksText = (slots: Slot[]) => slots.length ? slots.map(x => `${dayLabel(x.slot_date)} ${fmtH(x.hours)}`).join(', ') : 'not scheduled';

// Where later stages would land: each starts the day after the previous one ends (same rule the scheduler uses
// when a ticket advances), using its assignee's free time.
export function projectChain(start: string, stages: Downstream[], cap: number) {
  let d = skipToWorkday(start);
  const out: { name: string; userName: string; first: string; last: string; days: { date: string; hours: number }[] }[] = [];
  for (const st of stages) {
    if (st.hours <= 0.01) continue;
    let rem = st.hours, first: string | null = null, last = d;
    const days: { date: string; hours: number }[] = [];
    for (let g = 0; rem > 0.01 && g < 400; g++) {
      if (isWeekend(d)) { d = nextDay(d); continue; }
      const avail = Math.max(0, cap - (st.busy[d] || 0));
      if (avail > 0.01) { const h = Math.min(rem, avail); first ??= d; last = d; rem -= h; days.push({ date: d, hours: h }); }
      if (rem > 0.01) d = nextDay(d);
    }
    out.push({ name: st.name, userName: st.userName, first: first ?? d, last, days });
    d = nextDay(last);
  }
  return out;
}

// Deadline answer used everywhere (deadline bar, block dots, drag preview, confirm dialog). With later stages it follows
// the real scheduling rule — each stage starts the working day after the previous one ends — rather than just adding hours.
export function chainHealth(o: { due: string; today: string; nowH: number; cap: number; stages: { name: string; hours: number }[]; stageName: string; mine: { slot_date: string; hours: number }[]; downstream: Downstream[] }) {
  const base = taskHealth({ due: o.due, today: o.today, nowH: o.nowH, cap: o.cap, stages: o.stages, start: o.mine[0]?.slot_date });
  if (base.state === 'overdue' || !o.downstream.length || !o.mine.length) return { ...base, chain: [] as ReturnType<typeof projectChain> };
  const myEnd = o.mine[o.mine.length - 1].slot_date;
  const chain = projectChain(nextDay(myEnd), o.downstream, o.cap);
  const end = chain[chain.length - 1]?.last ?? myEnd;
  const steps = `${o.stageName} would finish ${dayLabel(myEnd)}. Each stage starts on the next working day after the one before it, so ` +
    chain.map((c, i) => `${c.name} would ${i ? 'then ' : ''}${c.first === c.last ? `be on ${dayLabel(c.first)}` : `run ${span(c.first, c.last)}`}`).join(', ') + '.';
  const late = chain.flatMap(c => c.days).filter(x => x.date > o.due).reduce((h, x) => h + x.hours, 0);
  if (late > 0.01) {
    const free = projectChain(nextDay(myEnd), o.downstream.map(d => ({ ...d, busy: {} })), o.cap);
    const busyNote = (free[free.length - 1]?.last ?? end) <= o.due ? ' The people on those stages also have other work booked, which pushes it later.' : '';
    const lateNames = listNames(chain.filter(c => c.last > o.due).map(c => c.name));
    return { ...base, state: 'impossible' as const, buffer: -late, what: `This pushes ${lateNames} past the deadline`, why: `${steps} The task is due ${dayLabel(o.due)}, so ${fmtH(late)} of work would land after it.${busyNote}`, fix: 'Pick an earlier day, or ask for a later due date.', chain };
  }
  const buffer = Math.round((workHoursUntil(o.due, nextDay(end), 0, o.cap) * (end < o.due ? 1 : 0) + Math.max(0, o.cap - (chain[chain.length - 1]?.days.slice(-1)[0]?.hours ?? 0))) * 100) / 100;
  const tight = buffer < 2;
  return { ...base, state: tight ? 'risk' as const : 'ok' as const, buffer, what: tight ? 'No room for delays' : 'On track', why: `${steps} That leaves ${fmtH(buffer)} spare before the ${dayLabel(o.due)} due date.`, fix: tight ? "Don't push this back any further." : '', chain };
}

// Simulate starting one piece of work on `day`. Nothing is saved: it re-plans with the new anchor and compares.
export function evaluateMove(o: { items: WorkItem[]; key: string; day: string; today: string; nowH: number; cap: number; work: Remaining; titles: Record<number, string>; downstream: Downstream[] }): MovePreview {
  const item = o.items.find(i => itemKey(i) === o.key)!;
  const stageName = item.stage_idx == null ? o.work.title : o.work.stageNames[item.stage_idx] || 'This stage';
  const hard = (what: string, why: string, fix: string): MovePreview => ({ tone: 'bad', allowed: false, headline: what, issues: [{ tone: 'bad', what, why, fix }], changes: [], buffer: null });
  if (o.day < o.today) return hard('That day has passed', "Work can't be planned in the past.", 'Pick today or a later day.');
  if (isWeekend(o.day)) return hard('Weekends are not working days', 'Nothing is scheduled on Saturdays or Sundays.', 'Pick a weekday.');
  if (o.day < item.earliest) return hard(`${stageName} can't start before ${dayLabel(item.earliest)}`, 'The previous stage is still scheduled until the day before.', `Pick ${dayLabel(item.earliest)} or later.`);

  const before = planSlots(o.items, o.today, o.cap);
  const after = planSlots(o.items.map(i => itemKey(i) === o.key ? { ...i, anchor: o.day } : i), o.today, o.cap);
  const mineB = before.filter(x => itemKey(x) === o.key), mineA = after.filter(x => itemKey(x) === o.key);
  const issues: MoveIssue[] = [], changes: MoveChange[] = [];

  if (mineA[0] && mineA[0].slot_date !== o.day) issues.push({ tone: 'bad', what: `${dayLabel(o.day)} is already full`, why: `Work you placed by hand fills ${dayLabel(o.day)}, so this would only start on ${dayLabel(mineA[0].slot_date)}.`, fix: 'Pick another day, or move that work first.' });
  if (blocksText(mineB) !== blocksText(mineA)) changes.push({ label: `${stageName} (you)`, from: blocksText(mineB), to: blocksText(mineA) });

  // Capacity: only days this move makes heavier
  const load = (slots: Slot[]) => slots.reduce((m, x) => m.set(x.slot_date, (m.get(x.slot_date) || 0) + x.hours), new Map<string, number>());
  const lb = load(before), la = load(after);
  for (const [d, h] of la) if (h > o.cap + 0.01 && h > (lb.get(d) || 0) + 0.01) {
    issues.push({ tone: 'bad', what: `You'd be over capacity on ${dayLabel(d)} by ${fmtH(h - o.cap)}`, why: `${dayLabel(d)} would have ${fmtH(h)} of work; a working day has ${fmtH(o.cap)}.`, fix: 'Pick a day with free time, or move other work off that day.' });
  }

  // Other work the scheduler would shift to make room — shown, never silently applied
  const pushed: string[] = [];
  for (const other of o.items) {
    const k = itemKey(other);
    if (k === o.key) continue;
    const b = before.filter(x => itemKey(x) === k), a = after.filter(x => itemKey(x) === k);
    if (!a.length || blocksText(a) === blocksText(b)) continue;
    const title = o.titles[other.task_id] || 'Another task';
    changes.push({ label: title, from: b.length ? span(b[0].slot_date, b[b.length - 1].slot_date) : 'not scheduled', to: span(a[0].slot_date, a[a.length - 1].slot_date) });
    if (a[a.length - 1].slot_date > other.due_date) issues.push({ tone: 'bad', what: `"${title}" would miss its due date`, why: `It gets pushed to ${dayLabel(a[a.length - 1].slot_date)}, after its due date (${dayLabel(other.due_date)}).`, fix: 'Pick another day so it keeps its time.' });
    else pushed.push(title);
  }
  if (pushed.length) issues.push({ tone: 'warn', what: `Shifts ${pushed.length} other task${pushed.length > 1 ? 's' : ''} to make room`, why: `${listNames(pushed.map(t => `"${t}"`))} still finish${pushed.length > 1 ? '' : 'es'} on time.`, fix: 'Undo puts everything back.' });

  // Deadline + later stages: same engine as the "Deadlines this week" bar
  const common = { due: o.work.due, today: o.today, nowH: o.nowH, cap: o.cap, stages: o.work.stages, stageName, downstream: o.downstream };
  const hb = chainHealth({ ...common, mine: mineB }), ha = chainHealth({ ...common, mine: mineA });
  if (ha.state === 'impossible' || ha.state === 'overdue') issues.push({ tone: 'bad', what: ha.what, why: ha.why, fix: ha.fix });
  else if (ha.state === 'risk') issues.push({ tone: 'warn', what: ha.what, why: ha.why, fix: ha.fix });
  let moved = 0;
  ha.chain.forEach((st, i) => {
    const b = hb.chain[i];
    const from = b ? span(b.first, b.last) : '—', to = span(st.first, st.last);
    if (from !== to) { moved++; changes.push({ label: `${st.name} (${st.userName})`, from, to }); }
  });
  if (moved && ha.state !== 'impossible' && ha.state !== 'overdue') issues.push({ tone: 'warn', what: `Also moves ${moved} later stage${moved > 1 ? 's' : ''}`, why: ha.why, fix: '' });

  const bad = issues.filter(i => i.tone === 'bad');
  const tone = bad.length ? 'bad' : issues.length ? 'warn' : 'ok';
  const headline = tone === 'ok' ? `Safe to move to ${dayLabel(o.day)}` : tone === 'warn' ? `This will affect other work` : bad.length > 1 ? `This move creates ${bad.length} problems` : bad[0].what;
  const dl = (h: Health) => ({ state: h.state, buffer: h.buffer });
  return { tone, allowed: true, headline, moved: { label: stageName, from: blocksText(mineB), to: blocksText(mineA) }, issues, changes: changes.filter(c => !c.label.endsWith('(you)')), buffer: ha.buffer, deadlineBefore: dl(hb), deadlineAfter: dl(ha) };
}

async function downstreamFor(db: Knex, taskId: number, work: Remaining, today: string): Promise<Downstream[]> {
  const out: Downstream[] = [];
  for (const st of work.stages.slice(1)) {
    const uid = st.userIds[0];
    if (!uid) continue;
    const [u, rows] = await Promise.all([
      db('users').where({ id: uid }).select('name').first(),
      db('task_schedule_slots').where({ user_id: uid }).whereNot({ task_id: taskId }).where('slot_date', '>=', today).select('slot_date', 'hours'),
    ]);
    const busy: Record<string, number> = {};
    for (const r of rows) { const d = String(r.slot_date).slice(0, 10); busy[d] = (busy[d] || 0) + Number(r.hours); }
    out.push({ name: st.name, userName: u?.name?.split(' ')[0] || 'someone', hours: st.hours, busy });
  }
  return out;
}

async function moveContext(db: Knex, userId: number, taskId: number, stage: number | null) {
  const today = todayStr();
  const items = await loadItems(userId, db, today);
  const key = itemKey({ task_id: taskId, stage_idx: stage });
  if (!items.some(i => itemKey(i) === key)) return null;
  const work = (await remainingWork(db, [taskId]))[taskId];
  const titleRows = await db('tasks').whereIn('id', items.map(i => i.task_id)).select('id', 'title');
  const titles = Object.fromEntries(titleRows.map((r: any) => [r.id, r.title]));
  const downstream = await downstreamFor(db, taskId, work, today);
  return { today, items, key, work, titles, downstream };
}

const parseStage = (v: any) => (v === '' || v == null || v === 'null' ? null : Number(v));

// GET /calendar/move-options?task_id=&stage=&days=2026-10-12,2026-10-13 — what would happen for each candidate day
router.get('/move-options', async (req: AuthRequest, res: Response) => {
  try {
    const taskId = Number(req.query.task_id);
    const days = String(req.query.days || '').split(',').filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0, 14);
    const ctx = await moveContext(getDB(), req.user!.id, taskId, parseStage(req.query.stage));
    if (!ctx) { res.status(409).json({ error: "This work can't be moved right now — it isn't your current stage, or you haven't accepted it yet." }); return; }
    const out: Record<string, MovePreview> = {};
    for (const day of days) out[day] = evaluateMove({ ...ctx, day, nowH: nowHour(), cap: DAY_CAP });
    res.json(out);
  } catch (e: any) { res.status(500).json({ error: e?.message || 'Server error' }); }
});

// POST /calendar/move { task_id, stage, date } — start this work on `date` (null = let the scheduler decide again)
router.post('/move', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const userId = req.user!.id;
    const taskId = Number(req.body.task_id);
    const stage = parseStage(req.body.stage);
    const date: string | null = req.body.date || null;
    const ctx = await moveContext(db, userId, taskId, stage);
    if (!ctx) { res.status(409).json({ error: "This work can't be moved right now — it isn't your current stage, or you haven't accepted it yet." }); return; }
    if (date) {
      const p = evaluateMove({ ...ctx, day: date, nowH: nowHour(), cap: DAY_CAP });
      if (!p.allowed) { res.status(409).json({ error: `${p.headline}. ${p.issues[0]?.fix || ''}`.trim() }); return; }
    }
    const q = db('task_assignees').where({ task_id: taskId, user_id: userId });
    const scoped = stage == null ? q.whereNull('stage_idx') : q.where('stage_idx', stage);
    const prev = await scoped.clone().first();
    const slotQ = () => { const q2 = db('task_schedule_slots').where({ task_id: taskId, user_id: userId }); return stage == null ? q2.whereNull('stage_idx') : q2.where('stage_idx', stage); };
    // Times of day on the current blocks, so Undo can put the schedule back exactly
    const previousTimes = Object.fromEntries((await slotQ().whereNotNull('custom_start_hour').select('slot_date', 'custom_start_hour')).map((r: any) => [String(r.slot_date).slice(0, 10), r.custom_start_hour]));
    await scoped.clone().update({ schedule_anchor: date });
    await scheduleUser(userId, db);
    const times = req.body.times && typeof req.body.times === 'object' ? req.body.times : {};
    for (const [d, h] of Object.entries(times)) if (/^\d{4}-\d{2}-\d{2}$/.test(d) && typeof h === 'number' && h >= 0 && h < 24) await slotQ().where('slot_date', d).update({ custom_start_hour: h });
    res.json({ ok: true, previous: prev?.schedule_anchor || null, previousTimes });
  } catch (e: any) { res.status(500).json({ error: e?.message || 'Server error' }); }
});

// Why a calendar block can't be moved (null = it can). Mirrored in Calendar.tsx so the UI locks the same blocks.
export function slotDragBlock(o: { slotDate: string; slotStage: number | null; isTicket: boolean; ticketStage: number | null | undefined; earliestOpen: string | null; today: string }): string | null {
  if (o.slotDate < o.today) return "Past days can't be rescheduled";
  if (o.isTicket && o.slotStage != null && o.slotStage > (o.ticketStage ?? 0)) return 'Earlier stages of this ticket aren\'t finished yet';
  if (o.earliestOpen && o.slotDate > o.earliestOpen) return 'Only the next upcoming block of this task can be moved; later blocks follow it';
  return null;
}

// PATCH /calendar/slot/:slotId/time — pin a slot to a specific start hour (drag-to-reposition)
router.patch('/slot/:slotId/time', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const slotId = Number(req.params.slotId);
    const { start_hour } = req.body;
    if (typeof start_hour !== 'number') { res.status(400).json({ error: 'start_hour required' }); return; }
    // Verify ownership
    const slot = await db('task_schedule_slots').where({ id: slotId, user_id: req.user!.id }).first();
    if (!slot) { res.status(404).json({ error: 'Slot not found' }); return; }
    const task = await db('tasks').where({ id: slot.task_id }).select('ticket_type_id', 'xlr8_stage_idx').first();
    const n = new Date();
    const today = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
    const earliest = await db('task_schedule_slots')
      .where({ task_id: slot.task_id, user_id: req.user!.id })
      .where((q: any) => slot.stage_idx == null ? q.whereNull('stage_idx') : q.where('stage_idx', slot.stage_idx))
      .where('slot_date', '>=', today).min('slot_date as d').first();
    const blocked = slotDragBlock({ slotDate: String(slot.slot_date).slice(0, 10), slotStage: slot.stage_idx, isTicket: !!task?.ticket_type_id, ticketStage: task?.xlr8_stage_idx, earliestOpen: earliest?.d ? String(earliest.d).slice(0, 10) : null, today });
    if (blocked) { res.status(409).json({ error: blocked }); return; }
    const hrs = Number(slot.hours) || 0;
    await db('task_schedule_slots').where({ id: slotId }).update({ custom_start_hour: Math.max(0, Math.min(24 - hrs, start_hour)) });
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e?.message || 'Server error' }); }
});

export default router;
