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
  res.json(rows.map(r => ({ ...r, recurrence_days: r.recurrence_days ? JSON.parse(r.recurrence_days) : [] })));
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
  const db = getDB();
  const user = req.user!;
  const { month } = req.query as { month?: string }; // YYYY-MM
  if (!month) { res.status(400).json({ error: 'month required (YYYY-MM)' }); return; }

  const [year, mon] = month.split('-').map(Number);
  const start = `${month}-01`;
  const lastDay = new Date(year, mon, 0).getDate();
  const end = `${year}-${String(mon).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  // Regular tasks with due_date in this month
  let taskQuery = db('tasks as t')
    .leftJoin('users as a', 't.assigned_to', 'a.id')
    .leftJoin('projects as p', 't.project_id', 'p.id')
    .whereNotNull('t.due_date')
    .whereBetween('t.due_date', [start, end])
    .select('t.id', 't.title', 't.due_date as event_date', 't.status', 't.priority', 't.estimated_hours',
      't.recurring_task_id', 't.recurrence_date',
      'a.name as assigned_to_name', 'a.avatar_color', 'p.name as project_name',
      db.raw("'task' as event_type"));

  if (user.role === 'client') {
    taskQuery = taskQuery.whereIn('t.project_id',
      db('projects').where('client_id', user.id).select('id')
    );
  } else if (user.role !== 'admin' && user.role !== 'manager') {
    taskQuery = taskQuery.where(function (this: any) {
      this.where('t.assigned_to', user.id)
        .orWhereIn('t.id', db('task_assignees').where('user_id', user.id).select('task_id'));
    });
  }

  const rawTasks = await taskQuery;
  const tasks = rawTasks.map((t: any) => ({ ...t, date: t.event_date || null }));

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
    const days = rt.recurrence_days ? JSON.parse(rt.recurrence_days) : [];
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
    const days = rt.recurrence_days ? JSON.parse(rt.recurrence_days) : [];
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

export default router;
