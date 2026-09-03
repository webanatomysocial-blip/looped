import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { getDB } from '../db';

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

  if (user.role === 'admin') {
    // admin sees all
  } else if (user.role === 'manager') {
    const mgr = await db('users').where({ id: user.id }).select('pod').first();
    if (mgr?.pod) {
      query = query.where('u.pod', mgr.pod);
    }
  } else {
    query = query.where('rt.assigned_to', user.id);
  }

  const rows = await query.orderBy('rt.created_at', 'desc');
  res.json(rows.map(r => ({ ...r, recurrence_days: r.recurrence_days ? (typeof r.recurrence_days === 'string' ? JSON.parse(r.recurrence_days) : r.recurrence_days) : [] })));
});

router.post('/recurring', async (req: AuthRequest, res: Response) => {
  const db = getDB();
  const user = req.user!;
  const { title, description, assigned_to, project_id, recurrence_type, recurrence_days, day_of_month, start_date, end_date, estimated_hours, priority } = req.body;
  if (!title || !recurrence_type || !start_date) { res.status(400).json({ error: 'title, recurrence_type, start_date required' }); return; }

  const canAssign = user.role === 'admin' || user.role === 'manager';
  const assignee = canAssign && assigned_to ? Number(assigned_to) : user.id;

  const [id] = await db('recurring_tasks').insert({
    title,
    description: description || null,
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
  res.json({ id });
});

router.put('/recurring/:id', async (req: AuthRequest, res: Response) => {
  const db = getDB();
  const user = req.user!;
  const rt = await db('recurring_tasks').where('id', req.params.id).first();
  if (!rt) { res.status(404).json({ error: 'Not found' }); return; }
  if (rt.created_by !== user.id && user.role !== 'admin') { res.status(403).json({ error: 'Forbidden' }); return; }

  const { title, description, assigned_to, project_id, recurrence_type, recurrence_days, day_of_month, start_date, end_date, estimated_hours, priority, active } = req.body;
  await db('recurring_tasks').where('id', req.params.id).update({
    title: title ?? rt.title,
    description: description ?? rt.description,
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
  if (rt.created_by !== user.id && user.role !== 'admin') { res.status(403).json({ error: 'Forbidden' }); return; }
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

  // For employees: use task_schedule_slots so monthly view is consistent with weekly view
  if (user.role !== 'admin' && user.role !== 'manager' && user.role !== 'client') {
    const slotRows = await db('task_schedule_slots as s')
      .join('tasks as t', 's.task_id', 't.id')
      .leftJoin('users as a', 't.assigned_to', 'a.id')
      .leftJoin('projects as p', 't.project_id', 'p.id')
      .where('s.user_id', user.id)
      .whereBetween('s.slot_date', [start, end])
      .whereNot('t.status', 'completed')
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
    tasks = [
      ...slotRows.map((t: any) => ({ ...t, date: t.event_date })),
      ...futureRows.filter((t: any) => !scheduledIds.has(t.id)).map((t: any) => ({ ...t, date: t.event_date })),
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

  if (user.role !== 'admin' && user.role !== 'manager') {
    rtQuery = rtQuery.where('rt.assigned_to', user.id);
  }

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

    // Phase 2: pull from schedule slots (employees) or due_date (admin/manager)
    let slotRows: any[] = [];
    if (user.role === 'admin' || user.role === 'manager') {
      // Admin/manager have no schedule slots — show all accepted tasks by due_date
      const adminTasks = await db('tasks as t')
        .leftJoin('projects as p', 't.project_id', 'p.id')
        .whereNotNull('t.due_date')
        .whereBetween('t.due_date', [weekStart, weekEnd])
        .whereNotIn('t.status', ['completed', 'draft'])
        .whereRaw(`NOT EXISTS (
          SELECT 1 FROM task_assignees ta2
          WHERE ta2.task_id = t.id
            AND (ta2.assignee_role IS NULL OR ta2.assignee_role NOT IN ('admin','client'))
            AND (ta2.acceptance_status IS NULL OR ta2.acceptance_status != 'accepted')
        )`)
        .select(
          't.id', 't.title', 't.due_date', 't.status', 't.priority',
          't.estimated_hours', 't.ticket_type_id', 't.xlr8_stage_idx', 't.xlr8_status',
          'p.name as project_name',
          db.raw(`${trackedSubSQL} as tracked_seconds`)
        )
        .orderByRaw("CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END");
      // Map to slot shape: place each task on its due_date
      slotRows = adminTasks.map((t: any) => ({
        ...t,
        slot_date: t.due_date,
        slot_hours: t.estimated_hours || 0,
        scheduled_stage: null,
        user_est_hours: t.estimated_hours || 0,
      }));
    } else {
    const slotRowsRaw = await db('task_schedule_slots as s')
      .join('tasks as t', 's.task_id', 't.id')
      .leftJoin('projects as p', 't.project_id', 'p.id')
      .where('s.user_id', user.id)
      .whereBetween('s.slot_date', [weekStart, weekEnd])
      .whereNot('t.status', 'completed')
      .select(
        't.id', 't.title', 't.due_date', 't.status', 't.priority',
        't.estimated_hours', 't.ticket_type_id', 't.xlr8_stage_idx', 't.xlr8_status',
        'p.name as project_name',
        's.slot_date', 's.hours as slot_hours', 's.stage_idx as scheduled_stage',
        db.raw(`${trackedSubSQL} as tracked_seconds`),
        db.raw(`(SELECT est_hours FROM task_assignees WHERE task_id = s.task_id AND user_id = ? AND stage_idx = s.stage_idx LIMIT 1) as user_est_hours`, [user.id])
      )
      .orderByRaw("CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END");
    slotRows = slotRowsRaw;
    }

    // Recurring instances for the week (always due_date based — no scheduling needed)
    const recurringTemplates = await db('recurring_tasks as rt')
      .leftJoin('projects as p', 'rt.project_id', 'p.id')
      .where('rt.active', true)
      .where('rt.assigned_to', user.id)
      .where('rt.start_date', '<=', weekEnd)
      .where(function () { this.whereNull('rt.end_date').orWhere('rt.end_date', '>=', weekStart); })
      .select('rt.*', 'p.name as project_name');

    const recurring: any[] = [];
    for (const rt of recurringTemplates) {
      const rdaysList = rt.recurrence_days ? (typeof rt.recurrence_days === 'string' ? JSON.parse(rt.recurrence_days) : rt.recurrence_days) : [];
      for (const dateStr of days) {
        const dow = new Date(dateStr + 'T00:00:00').getDay();
        let occurs = false;
        if (rt.recurrence_type === 'daily') occurs = true;
        else if (rt.recurrence_type === 'weekly') occurs = rdaysList.includes(dow);
        else if (rt.recurrence_type === 'monthly') { const d = parseInt(dateStr.slice(8)); occurs = rt.day_of_month ? d === rt.day_of_month : d === 1; }
        if (!occurs || dateStr < rt.start_date || (rt.end_date && dateStr > rt.end_date)) continue;
        recurring.push({ id: `rt_${rt.id}_${dateStr}`, title: rt.title, due_date: dateStr, slot_date: dateStr, status: 'recurring', priority: rt.priority, estimated_hours: rt.estimated_hours, slot_hours: rt.estimated_hours, project_name: rt.project_name, event_type: 'recurring', tracked_seconds: 0 });
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

    res.json({ days, byDay });
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

export default router;
