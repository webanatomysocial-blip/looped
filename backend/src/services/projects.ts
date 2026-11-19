// Project business logic shared by the website routes and the assistant. Moved from routes/projects.ts.
import { Knex } from 'knex';
import { createNotification } from '../db';
import { Actor, ServiceError, projectScope, assertCanSeeProject, canManageProject, stripFinancials } from './access';

export async function listProjects(db: Knex, actor: Actor, opts: { scope?: string } = {}) {
  const { role } = actor;
  let query = db('projects as p')
    .leftJoin('client_companies as c', 'p.client_company_id', 'c.id')
    .leftJoin('users as u', 'p.created_by', 'u.id')
    .select('p.*', 'c.name as client_name', 'u.name as created_by_name');

  // scope=all: task-creation picker lists every project; other-pod choices go through cross-pod approval
  const allScope = opts.scope === 'all' && role !== 'client';
  if (!allScope) query = (await projectScope(db, actor))(query);

  const projects = await query.orderBy('p.created_at', 'desc');
  const projectIds = projects.map((p: any) => p.id);
  const members = projectIds.length
    ? await db('project_members as pm').join('users as u', 'pm.user_id', 'u.id').whereIn('pm.project_id', projectIds)
        .select('pm.project_id', 'u.id as user_id', 'u.name', 'u.avatar_color', 'u.avatar_url', 'u.role', 'u.pod')
    : [];

  // The task-form picker only needs identity + pod + members; never expose other pods' hours or spend
  if (allScope) {
    return projects.map((p: any) => ({
      id: p.id, name: p.name, pod: p.pod, client_company_id: p.client_company_id, client_name: p.client_name,
      members: members.filter((m: any) => m.project_id === p.id),
    }));
  }

  // Aggregate total hours_logged per project from time_logs (with hourly_rate or user salary for cost)
  const hoursAgg = projectIds.length
    ? await db('time_logs as tl').join('users as u', 'tl.user_id', 'u.id').whereIn('tl.project_id', projectIds)
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
    if (rate != null) spendMap[h.project_id] = (spendMap[h.project_id] || 0) + Number(h.hours) * rate;
  }

  // Add live hours from currently-running task_sessions (not yet paused/done)
  const nowMs = Date.now();
  const liveSessions = projectIds.length
    ? await db('task_sessions as ts').join('tasks as t', 'ts.task_id', 't.id').join('users as u', 'ts.user_id', 'u.id')
        .whereIn('t.project_id', projectIds).whereNull('ts.ended_at')
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
      liveSpendMap[ls.project_id] = (liveSpendMap[ls.project_id] || 0) + liveH * (Number(ls.monthly_salary) / daysInM / 7);
    }
  }

  // For XLR8: compute cycle start in JS (avoids MySQL vs SQLite dialect issues)
  const now = new Date();
  const xlr8Ids = projects.filter((p: any) => p.service_type === 'xlr8').map((p: any) => p.id);
  const xlr8Logs = xlr8Ids.length ? await db('time_logs').whereIn('project_id', xlr8Ids).select('project_id', 'log_date', 'hours') : [];
  const cycleMap: Record<number, number> = {};
  for (const p of projects) {
    if (p.service_type !== 'xlr8') continue;
    const startDay = p.billing_cycle_start_day || 1;
    const cycleStart = now.getDate() >= startDay
      ? new Date(now.getFullYear(), now.getMonth(), startDay)
      : new Date(now.getFullYear(), now.getMonth() - 1, startDay);
    const cycleStartStr = cycleStart.toISOString().slice(0, 10);
    cycleMap[p.id] = xlr8Logs.filter((l: any) => l.project_id === p.id && l.log_date >= cycleStartStr).reduce((sum: number, l: any) => sum + Number(l.hours), 0);
  }

  return projects.map((p: any) => {
    const liveH = Math.round((liveHoursMap[p.id] || 0) * 100) / 100;
    const hoursLogged = Math.round(((hoursMap[p.id] ?? 0) + liveH) * 100) / 100;
    const hoursThisCycle = p.service_type === 'xlr8' ? (Math.round(((cycleMap[p.id] ?? 0) + liveH) * 100) / 100) : null;
    let budgetPct = 0;
    if (p.service_type === 'xlr8' && p.monthly_hours_bucket) budgetPct = Math.round(((hoursThisCycle ?? 0) / p.monthly_hours_bucket) * 100);
    else if (p.service_type !== 'xlr8' && p.budgeted_hours) budgetPct = Math.round((hoursLogged / p.budgeted_hours) * 100);

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

    return stripFinancials({
      ...p,
      members: members.filter((m: any) => m.project_id === p.id),
      hours_logged: hoursLogged, hours_this_cycle: hoursThisCycle, budget_pct: budgetPct,
      working_budget, total_spend, amount_remaining, budget_used_pct, health_flag,
    }, actor);
  });
}

export async function getProject(db: Knex, actor: Actor, projectId: number | string) {
  await assertCanSeeProject(db, actor, projectId);
  const project = await db('projects as p').leftJoin('client_companies as c', 'p.client_company_id', 'c.id')
    .where('p.id', projectId).select('p.*', 'c.name as client_name').first();
  if (!project) throw new ServiceError(404, 'Not found');
  const members = await db('project_members as pm').join('users as u', 'pm.user_id', 'u.id')
    .where('pm.project_id', projectId).select('u.id', 'u.name', 'u.avatar_color', 'u.avatar_url', 'u.role');
  return stripFinancials({ ...project, members }, actor);
}

// Admins and managers create projects; a manager's own pod needs no acceptance — they are its manager
export async function createProject(db: Knex, actor: Actor, body: any) {
  if (!['admin', 'manager'].includes(actor.role)) throw new ServiceError(403, 'Insufficient permissions');
  const { pod, name, client_company_id, start_date, due_date, briefing_doc, project_drive_doc, description, is_adhoc,
          service_type, budget_amount, budget_cutoff_pct, budgeted_hours, monthly_hours_bucket, billing_cycle_start_day } = body ?? {};
  if (!name) throw new ServiceError(400, 'Name required');
  const me = actor.role === 'manager' ? await db('users').where({ id: actor.id }).select('pod').first() : null;
  const isMgr = !!me && !!me.pod && me.pod === pod;
  if (!pod) throw new ServiceError(400, 'Pod required');
  if (!['pod1', 'pod2'].includes(pod)) throw new ServiceError(400, 'Invalid pod');
  const svcType = service_type || 'per_project';
  const [id] = await db('projects').insert({
    name, client_company_id: client_company_id || null,
    start_date: start_date ? String(start_date).slice(0, 10) : null,
    due_date: due_date ? String(due_date).slice(0, 10) : null,
    status: isMgr ? 'active' : 'on_hold', manager_status: isMgr ? 'accepted' : 'pending_manager',
    pod, briefing_doc: briefing_doc || null, project_drive_doc: project_drive_doc || null, description: description || null,
    created_by: actor.id,
    is_adhoc: !!is_adhoc,
    service_type: svcType,
    budget_amount: budget_amount != null ? Number(budget_amount) : null,
    budget_cutoff_pct: budget_cutoff_pct != null ? Number(budget_cutoff_pct) : null,
    budgeted_hours: svcType === 'per_project' && budgeted_hours != null ? Number(budgeted_hours) : null,
    monthly_hours_bucket: svcType === 'xlr8' && monthly_hours_bucket != null ? Number(monthly_hours_bucket) : null,
    billing_cycle_start_day: svcType === 'xlr8' ? (Number(billing_cycle_start_day) || 1) : null,
  });

  // The creator is always a member
  await db('project_members').insert({ project_id: id, user_id: actor.id });

  if (isMgr) {
    for (const a of await db('users').where({ role: 'admin' }).select('id')) {
      await createNotification(a.id, `${actor.name || 'A manager'} created project "${name}" (${pod === 'pod1' ? 'Pod 1' : 'Pod 2'})`, 'project');
    }
    return { id, name, status: 'active', manager_status: 'accepted' };
  }

  // Admin-created: the pod manager accepts it and picks the team
  const podManager = await db('users').where({ role: 'manager', pod }).first();
  if (podManager) await createNotification(podManager.id, `New project "${name}" is waiting for your acceptance`, 'project');
  return { id, name, status: 'on_hold', manager_status: 'pending_manager' };
}

// Website: a manager editing a project has these fields read-only (Projects.tsx readOnly/disabled), and may
// change the team: employees and managers can be added; admins and managers already on it stay.
const MANAGER_LOCKED = ['name', 'is_adhoc', 'client_company_id'];
const FIELD_LABEL: Record<string, string> = { name: 'name', is_adhoc: 'ad-hoc setting', client_company_id: 'client' };
export async function updateProject(db: Knex, actor: Actor, projectId: number | string, body: any): Promise<void> {
  if (!(await canManageProject(db, actor, projectId))) throw new ServiceError(404, 'Not found');
  const { name, status, start_date, due_date, client_company_id, member_ids, description, is_adhoc,
          briefing_doc, project_drive_doc,
          service_type, budget_amount, budget_cutoff_pct, budgeted_hours, monthly_hours_bucket, billing_cycle_start_day } = body ?? {};
  let members: number[] | undefined = member_ids;
  if (actor.role === 'manager') {
    const cur = await db('projects').where({ id: projectId }).first();
    const next: Record<string, any> = { name, is_adhoc: is_adhoc === undefined ? undefined : !!is_adhoc, client_company_id: client_company_id === undefined ? undefined : (client_company_id || null) };
    for (const f of MANAGER_LOCKED) {
      if (next[f] === undefined) continue;
      const before = f === 'is_adhoc' ? !!cur[f] : (cur[f] ?? null);
      const after = f === 'client_company_id' ? (next[f] == null ? null : Number(next[f])) : next[f];
      if (String(before ?? '') !== String(after ?? '')) throw new ServiceError(403, `Managers cannot change the project ${FIELD_LABEL[f]}`);
    }
    if (member_ids) {
      const currentIds = (await db('project_members').where({ project_id: projectId }).select('user_id')).map((r: any) => Number(r.user_id));
      const roles = new Map<number, string>((await db('users').whereIn('id', [...new Set([...currentIds, ...member_ids.map(Number)])]).select('id', 'role')).map((u: any) => [Number(u.id), u.role]));
      // A manager edits the team: admins and managers already on it always stay, and they can add employees and managers.
      // Admins they didn't add are left out rather than refusing the whole save.
      const incoming = new Set((member_ids as number[]).map(Number).filter((uid) => currentIds.includes(uid) || ['employee', 'manager'].includes(roles.get(uid) ?? '')));
      for (const uid of currentIds) if (roles.get(uid) !== 'employee') incoming.add(uid);
      members = [...incoming];
    }
  }
  const updates: any = {};
  if (name) updates.name = name;
  if (status) updates.status = status;
  if (start_date !== undefined) updates.start_date = start_date ? String(start_date).slice(0, 10) : null;
  if (due_date !== undefined) updates.due_date = due_date ? String(due_date).slice(0, 10) : null;
  if (client_company_id !== undefined) updates.client_company_id = client_company_id;
  if (description !== undefined) updates.description = description || null;
  if (is_adhoc !== undefined) updates.is_adhoc = !!is_adhoc;
  if (briefing_doc !== undefined) updates.briefing_doc = briefing_doc || null;
  if (project_drive_doc !== undefined) updates.project_drive_doc = project_drive_doc || null;
  if (service_type) {
    updates.service_type = service_type;
    updates.budget_amount = budget_amount != null ? Number(budget_amount) : null;
    updates.budget_cutoff_pct = budget_cutoff_pct != null ? Number(budget_cutoff_pct) : null;
    updates.budgeted_hours = service_type === 'per_project' && budgeted_hours != null ? Number(budgeted_hours) : null;
    updates.monthly_hours_bucket = service_type === 'xlr8' && monthly_hours_bucket != null ? Number(monthly_hours_bucket) : null;
    updates.billing_cycle_start_day = service_type === 'xlr8' ? (Number(billing_cycle_start_day) || 1) : null;
  }
  if (Object.keys(updates).length) await db('projects').where({ id: projectId }).update(updates);

  if (members) {
    await db('project_members').where({ project_id: projectId }).delete();
    const rows = members.map((uid) => ({ project_id: Number(projectId), user_id: uid }));
    if (rows.length) await db('project_members').insert(rows);
  }
}

export async function deleteProject(db: Knex, actor: Actor, projectId: number | string): Promise<void> {
  if (!(await canManageProject(db, actor, projectId))) throw new ServiceError(404, 'Not found');
  const taskIds: number[] = (await db('tasks').where({ project_id: projectId }).select('id')).map((t: any) => t.id);
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
  await db('time_logs').where({ project_id: projectId }).delete();
  const projApprovalIds: number[] = (await db('approvals').where({ project_id: projectId }).select('id')).map((a: any) => a.id);
  if (projApprovalIds.length) await db('approval_steps').whereIn('approval_id', projApprovalIds).delete();
  await db('approvals').where({ project_id: projectId }).delete();
  await db('assets').where({ project_id: projectId }).update({ project_id: null });
  await db('messages').where({ project_id: projectId }).delete();
  await db('notifications').where({ project_id: projectId }).delete();
  await db('project_members').where({ project_id: projectId }).delete();
  await db('projects').where({ id: projectId }).delete();
}
