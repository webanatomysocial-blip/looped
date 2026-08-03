import { Router, Response } from 'express';
import { getDB, createNotification } from '../db';
import { authenticate, requireRoles, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate);

// GET all projects (filtered by role)
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const { role, id: userId } = req.user!;

    let query = db('projects as p')
      .leftJoin('client_companies as c', 'p.client_company_id', 'c.id')
      .leftJoin('users as u', 'p.created_by', 'u.id')
      .select('p.*', 'c.name as client_name', 'u.name as created_by_name');

    if (role === 'client') {
      query = query
        .join('project_members as pm', 'p.id', 'pm.project_id')
        .where('pm.user_id', userId);
    } else if (role === 'employee') {
      query = query
        .join('project_members as pm', 'p.id', 'pm.project_id')
        .where('pm.user_id', userId);
    }

    const projects = await query.orderBy('p.created_at', 'desc');

    const projectIds = projects.map((p: any) => p.id);
    const members = projectIds.length
      ? await db('project_members as pm')
          .join('users as u', 'pm.user_id', 'u.id')
          .whereIn('pm.project_id', projectIds)
          .select('pm.project_id', 'u.id as user_id', 'u.name', 'u.avatar_color', 'u.role')
      : [];

    // Aggregate total hours_logged per project from time_logs (with hourly_rate or user salary for cost)
    const hoursAgg = projectIds.length
      ? await db('time_logs as tl')
          .join('users as u', 'tl.user_id', 'u.id')
          .whereIn('tl.project_id', projectIds)
          .select('tl.project_id', 'tl.hours', 'tl.hourly_rate', 'tl.log_date', 'u.monthly_salary')
      : [];
    const hoursMap: Record<number, number> = {};
    const spendMap: Record<number, number> = {};
    for (const h of hoursAgg) {
      hoursMap[h.project_id] = (hoursMap[h.project_id] || 0) + (Number(h.hours) || 0);
      let rate = h.hourly_rate != null ? Number(h.hourly_rate) : null;
      if (rate == null && h.monthly_salary != null) {
        const logDateObj = h.log_date ? new Date(h.log_date) : new Date();
        const daysInMonth = new Date(logDateObj.getFullYear(), logDateObj.getMonth() + 1, 0).getDate();
        rate = Number(h.monthly_salary) / daysInMonth / 7;
      }
      if (rate != null) {
        spendMap[h.project_id] = (spendMap[h.project_id] || 0) + Number(h.hours) * rate;
      }
    }

    // Add live hours from currently-running task_sessions (not yet paused/done)
    const nowMs = Date.now();
    const liveSessions = projectIds.length
      ? await db('task_sessions as ts')
          .join('tasks as t', 'ts.task_id', 't.id')
          .join('users as u', 'ts.user_id', 'u.id')
          .whereIn('t.project_id', projectIds)
          .whereNull('ts.ended_at')
          .select('t.project_id', 'ts.started_at', 'ts.user_id', 'u.monthly_salary')
      : [];
    const liveHoursMap: Record<number, number> = {};
    const liveSpendMap: Record<number, number> = {};
    const nowDate = new Date();
    for (const ls of liveSessions) {
      const liveH = (nowMs - Number(ls.started_at)) / 3600000;
      liveHoursMap[ls.project_id] = (liveHoursMap[ls.project_id] || 0) + liveH;
      if (ls.monthly_salary) {
        const daysInM = new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 0).getDate();
        const liveRate = Number(ls.monthly_salary) / daysInM / 7;
        liveSpendMap[ls.project_id] = (liveSpendMap[ls.project_id] || 0) + liveH * liveRate;
      }
    }

    // For XLR8: compute cycle start in JS (avoids MySQL vs SQLite dialect issues)
    const now = new Date();
    const xlr8Ids = projects.filter((p: any) => p.service_type === 'xlr8').map((p: any) => p.id);
    const xlr8Logs = xlr8Ids.length
      ? await db('time_logs').whereIn('project_id', xlr8Ids).select('project_id', 'log_date', 'hours')
      : [];
    const cycleMap: Record<number, number> = {};
    for (const p of projects) {
      if (p.service_type !== 'xlr8') continue;
      const startDay = p.billing_cycle_start_day || 1;
      const cycleStart = now.getDate() >= startDay
        ? new Date(now.getFullYear(), now.getMonth(), startDay)
        : new Date(now.getFullYear(), now.getMonth() - 1, startDay);
      const cycleStartStr = cycleStart.toISOString().slice(0, 10);
      cycleMap[p.id] = xlr8Logs
        .filter((l: any) => l.project_id === p.id && l.log_date >= cycleStartStr)
        .reduce((sum: number, l: any) => sum + Number(l.hours), 0);
    }

    const result = projects.map((p: any) => {
      const liveH = Math.round((liveHoursMap[p.id] || 0) * 100) / 100;
      const hoursLogged = Math.round(((hoursMap[p.id] ?? 0) + liveH) * 100) / 100;
      const hoursThisCycle = p.service_type === 'xlr8' ? (Math.round(((cycleMap[p.id] ?? 0) + liveH) * 100) / 100) : null;
      let budgetPct = 0;
      if (p.service_type === 'xlr8' && p.monthly_hours_bucket) {
        budgetPct = Math.round(((hoursThisCycle ?? 0) / p.monthly_hours_bucket) * 100);
      } else if (p.service_type !== 'xlr8' && p.budgeted_hours) {
        budgetPct = Math.round((hoursLogged / p.budgeted_hours) * 100);
      }

      // Per-project salary-based cost analytics
      let working_budget: number | null = null;
      let total_spend: number | null = null;
      let amount_remaining: number | null = null;
      let budget_used_pct: number | null = null;
      let health_flag: string | null = null;
      if (p.service_type === 'per_project' && p.budget_amount != null) {
        const cutoff = Number(p.budget_cutoff_pct) || 0;
        working_budget = Math.round(Number(p.budget_amount) * (1 - cutoff / 100) * 100) / 100;
        const committed = Math.round(((spendMap[p.id] || 0) + (liveSpendMap[p.id] || 0)) * 100) / 100;
        total_spend = committed;
        amount_remaining = Math.max(0, Math.round((working_budget - committed) * 100) / 100);
        budget_used_pct = working_budget > 0 ? Math.round((committed / working_budget) * 100) : 0;
        const remainingPct = working_budget > 0 ? ((working_budget - committed) / working_budget) * 100 : 0;
        health_flag = remainingPct > 40 ? 'green' : remainingPct > 20 ? 'amber' : 'red';
      }

      return {
        ...p,
        members: members.filter((m: any) => m.project_id === p.id),
        hours_logged: hoursLogged,
        hours_this_cycle: hoursThisCycle,
        budget_pct: budgetPct,
        working_budget,
        total_spend,
        amount_remaining,
        budget_used_pct,
        health_flag,
      };
    });

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET single project
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const project = await db('projects as p')
      .leftJoin('client_companies as c', 'p.client_company_id', 'c.id')
      .where('p.id', req.params.id)
      .select('p.*', 'c.name as client_name')
      .first();
    if (!project) { res.status(404).json({ error: 'Not found' }); return; }

    const members = await db('project_members as pm')
      .join('users as u', 'pm.user_id', 'u.id')
      .where('pm.project_id', req.params.id)
      .select('u.id', 'u.name', 'u.avatar_color', 'u.role');

    res.json({ ...project, members });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST create project (admin only) — sends to pod manager for acceptance
router.post('/', requireRoles('admin'), async (req: AuthRequest, res: Response) => {
  const { name, client_company_id, start_date, due_date, pod, briefing_doc, project_drive_doc,
          service_type, budget_amount, budget_cutoff_pct, budgeted_hours, monthly_hours_bucket, billing_cycle_start_day } = req.body;
  if (!name) { res.status(400).json({ error: 'Name required' }); return; }
  if (!pod) { res.status(400).json({ error: 'Pod required' }); return; }
  if (!briefing_doc) { res.status(400).json({ error: 'Briefing doc is required' }); return; }
  try {
    const db = getDB();
    const svcType = service_type || 'per_project';
    const [id] = await db('projects').insert({
      name, client_company_id: client_company_id || null,
      start_date: start_date ? String(start_date).slice(0, 10) : null,
      due_date: due_date ? String(due_date).slice(0, 10) : null,
      status: 'on_hold', manager_status: 'pending_manager',
      pod, briefing_doc, project_drive_doc: project_drive_doc || null,
      created_by: req.user!.id,
      service_type: svcType,
      budget_amount: budget_amount != null ? Number(budget_amount) : null,
      budget_cutoff_pct: budget_cutoff_pct != null ? Number(budget_cutoff_pct) : null,
      budgeted_hours: svcType === 'per_project' && budgeted_hours != null ? Number(budgeted_hours) : null,
      monthly_hours_bucket: svcType === 'xlr8' && monthly_hours_bucket != null ? Number(monthly_hours_bucket) : null,
      billing_cycle_start_day: svcType === 'xlr8' ? (Number(billing_cycle_start_day) || 1) : null,
    });

    // Always add admin as member
    await db('project_members').insert({ project_id: id, user_id: req.user!.id });

    // Notify pod manager
    const podManager = await db('users').where({ role: 'manager', pod }).first();
    if (podManager) {
      await createNotification(podManager.id, `New project "${name}" is waiting for your acceptance`, 'project');
    }

    res.status(201).json({ id, name, status: 'on_hold', manager_status: 'pending_manager' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST manager accepts or declines a project
router.post('/:id/manager-response', requireRoles('manager'), async (req: AuthRequest, res: Response) => {
  const { action, member_ids } = req.body; // action: 'accept' | 'decline'
  if (!['accept', 'decline'].includes(action)) { res.status(400).json({ error: 'action must be accept or decline' }); return; }
  try {
    const db = getDB();
    const project = await db('projects').where({ id: req.params.id }).first();
    if (!project) { res.status(404).json({ error: 'Not found' }); return; }
    if (project.manager_status !== 'pending_manager') { res.status(400).json({ error: 'Project not pending manager acceptance' }); return; }

    if (action === 'decline') {
      await db('projects').where({ id: req.params.id }).update({ manager_status: 'declined', status: 'on_hold' });
      // Notify admin who created it
      await createNotification(project.created_by, `Manager declined project "${project.name}" — please review and resubmit`, 'project');
      res.json({ message: 'Declined' });
      return;
    }

    // Accept: set active, add manager + selected employees as members
    await db('projects').where({ id: req.params.id }).update({ manager_status: 'accepted', status: 'active' });

    const memberSet = new Set<number>();
    // Keep existing members (admin was added on create)
    const existing = await db('project_members').where({ project_id: req.params.id }).select('user_id');
    existing.forEach((m: any) => memberSet.add(Number(m.user_id)));
    // Add manager
    memberSet.add(req.user!.id);
    // Add selected employees
    if (member_ids) (member_ids as number[]).forEach((mid: number) => memberSet.add(mid));

    // Sync members
    await db('project_members').where({ project_id: req.params.id }).delete();
    await db('project_members').insert([...memberSet].map((uid) => ({ project_id: Number(req.params.id), user_id: uid })));

    // Notify each new employee
    for (const uid of memberSet) {
      if (uid !== req.user!.id && uid !== project.created_by) {
        await createNotification(uid, `You were added to project "${project.name}"`, 'project');
      }
    }
    // Notify admin
    await createNotification(project.created_by, `Manager accepted project "${project.name}" — it is now active`, 'project');

    res.json({ message: 'Accepted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT update project (admin + manager)
router.put('/:id', requireRoles('admin', 'manager'), async (req: AuthRequest, res: Response) => {
  const { name, status, start_date, due_date, client_company_id, member_ids,
          service_type, budget_amount, budget_cutoff_pct, budgeted_hours, monthly_hours_bucket, billing_cycle_start_day } = req.body;
  try {
    const db = getDB();
    const updates: any = {};
    if (name) updates.name = name;
    if (status) updates.status = status;
    if (start_date !== undefined) updates.start_date = start_date ? String(start_date).slice(0, 10) : null;
    if (due_date !== undefined) updates.due_date = due_date ? String(due_date).slice(0, 10) : null;
    if (client_company_id !== undefined) updates.client_company_id = client_company_id;
    if (service_type) {
      const svcType = service_type;
      updates.service_type = svcType;
      updates.budget_amount = budget_amount != null ? Number(budget_amount) : null;
      updates.budget_cutoff_pct = budget_cutoff_pct != null ? Number(budget_cutoff_pct) : null;
      updates.budgeted_hours = svcType === 'per_project' && budgeted_hours != null ? Number(budgeted_hours) : null;
      updates.monthly_hours_bucket = svcType === 'xlr8' && monthly_hours_bucket != null ? Number(monthly_hours_bucket) : null;
      updates.billing_cycle_start_day = svcType === 'xlr8' ? (Number(billing_cycle_start_day) || 1) : null;
    }
    await db('projects').where({ id: req.params.id }).update(updates);

    if (member_ids) {
      await db('project_members').where({ project_id: req.params.id }).delete();
      const rows = (member_ids as number[]).map((uid) => ({ project_id: Number(req.params.id), user_id: uid }));
      if (rows.length) await db('project_members').insert(rows);
    }

    res.json({ message: 'Updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE project (admin only)
router.delete('/:id', requireRoles('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const pid = req.params.id;

    const taskIds: number[] = (await db('tasks').where({ project_id: pid }).select('id')).map((t: any) => t.id);
    if (taskIds.length) {
      const approvalIds: number[] = (await db('approvals').whereIn('task_id', taskIds).select('id')).map((a: any) => a.id);
      if (approvalIds.length) await db('approval_steps').whereIn('approval_id', approvalIds).delete();
      await db('task_sessions').whereIn('task_id', taskIds).delete();
      await db('task_assignees').whereIn('task_id', taskIds).delete();
      await db('task_checklist').whereIn('task_id', taskIds).delete();
      await db('approvals').whereIn('task_id', taskIds).delete();
      await db('time_logs').whereIn('task_id', taskIds).delete();
      await db('tasks').whereIn('id', taskIds).delete();
    }

    await db('time_logs').where({ project_id: pid }).delete();
    const projApprovalIds: number[] = (await db('approvals').where({ project_id: pid }).select('id')).map((a: any) => a.id);
    if (projApprovalIds.length) await db('approval_steps').whereIn('approval_id', projApprovalIds).delete();
    await db('approvals').where({ project_id: pid }).delete();
    await db('assets').where({ project_id: pid }).update({ project_id: null });
    await db('messages').where({ project_id: pid }).delete();
    await db('project_members').where({ project_id: pid }).delete();
    await db('projects').where({ id: pid }).delete();

    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('Delete project error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
