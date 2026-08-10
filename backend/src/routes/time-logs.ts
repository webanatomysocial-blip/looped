import { Router, Response } from 'express';
import { getDB } from '../db';
import { authenticate, requireRoles, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate);

// GET /time-logs/project/:id — per-project hours: total + by user + by task
router.get('/project/:id', requireRoles('admin', 'manager'), async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const projectId = Number(req.params.id);
    const { from, to } = req.query as Record<string, string>;

    let query = db('time_logs as tl')
      .join('users as u', 'tl.user_id', 'u.id')
      .join('tasks as t', 'tl.task_id', 't.id')
      .where('tl.project_id', projectId);
    if (from) query = query.where('tl.log_date', '>=', from);
    if (to)   query = query.where('tl.log_date', '<=', to);

    const rows = await query.select(
      'tl.id', 'tl.task_id', 't.title as task_title',
      'tl.user_id', 'u.name as user_name', 'u.avatar_color as user_color', 'u.monthly_salary',
      'tl.log_date', 'tl.hours', 'tl.hourly_rate', 'tl.notes', 'tl.created_at',
    ).orderBy('tl.log_date', 'desc');

    const byUser: Record<number, any> = {};
    const byTask: Record<number, any> = {};
    let totalHours = 0;
    let totalSpend = 0;
    for (const r of rows) {
      totalHours += Number(r.hours);
      let rate = r.hourly_rate != null ? Number(r.hourly_rate) : null;
      if (rate == null && r.monthly_salary != null) {
        const logDateObj = r.log_date ? new Date(r.log_date) : new Date();
        const daysInMonth = new Date(logDateObj.getFullYear(), logDateObj.getMonth() + 1, 0).getDate();
        rate = Number(r.monthly_salary) / daysInMonth / 7;
      }
      const cost = rate != null ? Number(r.hours) * rate : 0;
      totalSpend += cost;

      if (!byUser[r.user_id]) byUser[r.user_id] = { user_id: r.user_id, user_name: r.user_name, user_color: r.user_color, total_hours: 0, total_cost: 0 };
      byUser[r.user_id].total_hours += Number(r.hours);
      byUser[r.user_id].total_cost += cost;

      if (!byTask[r.task_id]) byTask[r.task_id] = { task_id: r.task_id, task_title: r.task_title, total_hours: 0, total_cost: 0 };
      byTask[r.task_id].total_hours += Number(r.hours);
      byTask[r.task_id].total_cost += cost;
    }

    res.json({
      total_hours: Math.round(totalHours * 100) / 100,
      total_spend: Math.round(totalSpend * 100) / 100,
      by_user: Object.values(byUser).map(u => ({ ...u, total_hours: Math.round(u.total_hours * 100) / 100, total_cost: Math.round(u.total_cost * 100) / 100 })),
      by_task: Object.values(byTask).map(t => ({ ...t, total_hours: Math.round(t.total_hours * 100) / 100, total_cost: Math.round(t.total_cost * 100) / 100 })),
      logs: rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /time-logs/user/:id — per-employee hours by project x task, filterable by date range
router.get('/user/:id', requireRoles('admin', 'manager'), async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const userId = Number(req.params.id);
    const { from, to } = req.query as Record<string, string>;

    let query = db('time_logs as tl')
      .join('tasks as t', 'tl.task_id', 't.id')
      .join('projects as p', 'tl.project_id', 'p.id')
      .where('tl.user_id', userId);
    if (from) query = query.where('tl.log_date', '>=', from);
    if (to)   query = query.where('tl.log_date', '<=', to);

    const rows = await query.select(
      'tl.id', 'tl.task_id', 't.title as task_title',
      'tl.project_id', 'p.name as project_name',
      'tl.log_date', 'tl.hours', 'tl.notes', 'tl.created_at',
    ).orderBy('tl.log_date', 'desc');

    const byProject: Record<number, any> = {};
    let totalHours = 0;
    for (const r of rows) {
      totalHours += Number(r.hours);
      if (!byProject[r.project_id]) byProject[r.project_id] = { project_id: r.project_id, project_name: r.project_name, total_hours: 0, tasks: {} };
      byProject[r.project_id].total_hours += Number(r.hours);
      if (!byProject[r.project_id].tasks[r.task_id]) byProject[r.project_id].tasks[r.task_id] = { task_id: r.task_id, task_title: r.task_title, total_hours: 0 };
      byProject[r.project_id].tasks[r.task_id].total_hours += Number(r.hours);
    }

    const result = Object.values(byProject).map((p: any) => ({
      ...p,
      total_hours: Math.round(p.total_hours * 100) / 100,
      tasks: Object.values(p.tasks).map((t: any) => ({ ...t, total_hours: Math.round(t.total_hours * 100) / 100 })),
    }));

    res.json({ total_hours: Math.round(totalHours * 100) / 100, by_project: result, logs: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /time-logs/xlr8/:projectId — live bucket usage for current billing cycle
router.get('/xlr8/:projectId', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const { role, id: userId } = req.user!;
    const projectId = Number(req.params.projectId);

    const project = await db('projects as p')
      .leftJoin('client_companies as c', 'p.client_company_id', 'c.id')
      .where('p.id', projectId)
      .select('p.*', 'c.name as client_name')
      .first();

    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
    if (project.service_type !== 'xlr8') { res.status(400).json({ error: 'Not an XLR8 project' }); return; }

    if (role === 'client') {
      const clientUser = await db('users').where({ id: userId }).select('client_company_id').first();
      if (!clientUser?.client_company_id || clientUser.client_company_id !== project.client_company_id) {
        res.status(403).json({ error: 'Forbidden' }); return;
      }
    }

    const startDay = project.billing_cycle_start_day || 1;
    const now = new Date();
    const cycleStart = now.getDate() >= startDay
      ? new Date(now.getFullYear(), now.getMonth(), startDay)
      : new Date(now.getFullYear(), now.getMonth() - 1, startDay);
    const cycleEnd = new Date(cycleStart.getFullYear(), cycleStart.getMonth() + 1, startDay - 1);
    const cycleStartStr = cycleStart.toISOString().slice(0, 10);
    const cycleEndStr   = cycleEnd.toISOString().slice(0, 10);

    const logs = await db('time_logs as tl')
      .join('users as u', 'tl.user_id', 'u.id')
      .join('tasks as t', 'tl.task_id', 't.id')
      .where('tl.project_id', projectId)
      .where('tl.log_date', '>=', cycleStartStr)
      .select('tl.*', 'u.name as user_name', 'u.avatar_color as user_color', 't.title as task_title')
      .orderBy('tl.log_date', 'desc');

    // Include all task sessions (running + paused) not yet converted to time_logs
    const allSessions = await db('task_sessions as ts')
      .join('tasks as t', 'ts.task_id', 't.id')
      .join('users as u', 'ts.user_id', 'u.id')
      .where('t.project_id', projectId)
      .where('ts.session_date', '>=', cycleStartStr)
      .select('ts.id', 'ts.task_id', 'ts.started_at', 'ts.ended_at', 'ts.user_id', 'ts.session_date', 't.title as task_title', 'u.name as user_name', 'u.avatar_color as user_color');
    const nowMs = Date.now();

    // Only count session hours for tasks that don't already have time_log entries (avoid double-counting)
    const loggedTaskIds = new Set(logs.map((l: any) => l.task_id));
    const sessionHours = allSessions
      .filter((s: any) => !loggedTaskIds.has(s.task_id))
      .reduce((sum: number, s: any) => {
        const end = s.ended_at ? Number(new Date(s.ended_at)) : nowMs;
        return sum + (end - Number(new Date(s.started_at))) / 3600000;
      }, 0);

    // Build session-based pseudo log entries for display
    const sessionLogs = allSessions
      .filter((s: any) => !loggedTaskIds.has(s.task_id))
      .map((s: any) => {
        const end = s.ended_at ? Number(new Date(s.ended_at)) : nowMs;
        const hrs = Math.round(((end - Number(new Date(s.started_at))) / 3600000) * 100) / 100;
        return { id: `session_${s.id}`, log_date: s.session_date, user_id: s.user_id, user_name: s.user_name, user_color: s.user_color, task_title: s.task_title, hours: hrs, notes: s.ended_at ? null : '(timer running)' };
      });

    const hoursUsed = logs.reduce((s: number, l: any) => s + Number(l.hours), 0) + sessionHours;
    const bucket = Number(project.monthly_hours_bucket) || 0;
    const budgetAmount = Number(project.budget_amount) || 0;
    const ratePerHour = bucket > 0 && budgetAmount > 0 ? budgetAmount / bucket : 0;
    const pct = bucket > 0 ? Math.round((hoursUsed / bucket) * 100) : 0;

    res.json({
      project_id: projectId,
      project_name: project.name,
      client_name: project.client_name,
      monthly_hours_bucket: bucket,
      budget_amount: budgetAmount,
      rate_per_hour: Math.round(ratePerHour * 100) / 100,
      hours_used: Math.round(hoursUsed * 100) / 100,
      hours_remaining: Math.max(0, Math.round((bucket - hoursUsed) * 100) / 100),
      amount_spent: Math.round(hoursUsed * ratePerHour * 100) / 100,
      amount_remaining: Math.max(0, Math.round((budgetAmount - hoursUsed * ratePerHour) * 100) / 100),
      usage_pct: pct,
      warning: pct >= 80,
      cycle_start: cycleStartStr,
      cycle_end: cycleEndStr,
      logs: [...logs, ...sessionLogs].sort((a: any, b: any) => b.log_date.localeCompare(a.log_date)),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /time-logs — manual entry (admin/manager only)
router.post('/', requireRoles('admin', 'manager'), async (req: AuthRequest, res: Response) => {
  const { task_id, user_id, log_date, hours, notes, hourly_rate } = req.body;
  if (!task_id || !user_id || !log_date || !hours) {
    res.status(400).json({ error: 'task_id, user_id, log_date, hours are required' }); return;
  }
  try {
    const db = getDB();
    const task = await db('tasks').where({ id: task_id }).select('project_id').first();
    if (!task) { res.status(404).json({ error: 'Task not found' }); return; }

    let rate = hourly_rate != null ? Number(hourly_rate) : null;
    if (rate == null) {
      const userRec = await db('users').where({ id: user_id }).select('monthly_salary').first();
      if (userRec?.monthly_salary) {
        const logDateObj = new Date(log_date);
        const daysInMonth = new Date(logDateObj.getFullYear(), logDateObj.getMonth() + 1, 0).getDate();
        rate = Number(userRec.monthly_salary) / daysInMonth / 7;
      }
    }

    const [id] = await db('time_logs').insert({
      task_id, project_id: task.project_id, user_id, log_date,
      hours: Math.round(Number(hours) * 100) / 100,
      hourly_rate: rate,
      notes: notes || null,
    });
    res.status(201).json({ id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /time-logs/:id (admin/manager only)
router.delete('/:id', requireRoles('admin', 'manager'), async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    await db('time_logs').where({ id: req.params.id }).delete();
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
