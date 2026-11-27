// Task business logic shared by the website routes and the assistant. Moved from routes/tasks.ts unchanged
// apart from the access checks and errors-as-exceptions.
import { Knex } from 'knex';
import { createNotification, getDB, inTransaction, onCommit, isMySQLClient } from '../db';
import { noticeAfterCommit } from './assignmentNotices';
import { randomUUID } from 'crypto';
import { approvalReasons, reasonPods, holdForCrossPod, notifyAdminCrossPod, discardRejected, creditRequester, startIfAccepted, waitingOn } from './xlr8';
import { Actor, ServiceError, STAFF, applyDraftScope, clientTaskScope, applyEmployeeTaskListScope, assertCanSeeTask, assertCanManageTask, clientListScope } from './access';


function scheduleLater(taskId: number) {
  onCommit(async () => { const { scheduleTaskUsers } = await import('./scheduler'); await scheduleTaskUsers(taskId, getDB()); }).catch(() => {});
}

// Session belongs to this stage row (untagged sessions = plain tasks, match any row)
export const sameStage = (j: any) => j.on('ts.stage_idx', 'ta.stage_idx').orOnNull('ts.stage_idx');

// Pause any active timer sessions for a user and write time_logs
export async function pauseActiveSession(db: any, userId: number): Promise<void> {
  const now = new Date();
  const open = await db('task_sessions').where({ user_id: userId }).whereNull('ended_at').select('*');
  for (const s of open) {
    await db('task_sessions').where({ id: s.id }).update({ ended_at: now });
    const startMs = isNaN(Number(s.started_at)) ? new Date(s.started_at).getTime() : Number(s.started_at);
    const hrs = (now.getTime() - startMs) / 3600000;
    if (hrs >= 0.001) {
      const taskRow = await db('tasks').where({ id: s.task_id }).select('project_id').first();
      const userRec = await db('users').where({ id: userId }).select('monthly_salary').first();
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const hourlyRate = userRec?.monthly_salary ? Number(userRec.monthly_salary) / daysInMonth / 7 : null;
      if (taskRow) {
        await db('time_logs').insert({
          task_id: s.task_id, project_id: taskRow.project_id, user_id: userId, log_date: s.session_date,
          hours: Math.round(hrs * 1000) / 1000, notes: 'Auto-paused — urgent/high priority task assigned',
          task_session_id: s.id, hourly_rate: hourlyRate,
        });
      }
    }
  }
}

// ── List ──

export async function listTasks(db: Knex, actor: Actor, filters: { project_id?: any; pod?: any; title?: string; assigned_to?: number } = {}) {
  const { role, id: userId } = actor;
  const { project_id, pod } = filters;

  let query = db('tasks as t')
    .leftJoin('projects as p', 't.project_id', 'p.id')
    .leftJoin('users as a', 't.assigned_to', 'a.id')
    .leftJoin('users as cr', 't.created_by', 'cr.id')
    .leftJoin('users as xa', 't.xlr8_assignee_id', 'xa.id')
    .leftJoin('client_companies as c', 'p.client_company_id', 'c.id')
    .select('t.*', 'p.name as project_name', 'c.name as client_name', 'a.name as assigned_name', 'a.avatar_color as assigned_color',
      'cr.name as created_by_name', 'xa.name as xlr8_assignee_name', 'xa.role as xlr8_assignee_role');

  if (project_id) query = query.where('t.project_id', project_id);
  if (filters.assigned_to) query = query.where('t.assigned_to', filters.assigned_to);
  if (filters.title?.trim()) {
    // Title search runs inside the same visibility-scoped query as the list
    // '!' is the escape character: backslashes are read differently by MySQL and SQLite
    const term = filters.title.trim().toLowerCase().replace(/[!%_]/g, (c) => '!' + c).slice(0, 80);
    query = query.whereRaw("LOWER(t.title) LIKE ? ESCAPE '!'", [`%${term}%`]);
  }

  if (pod && (role === 'admin' || role === 'manager')) {
    // Filter tasks to this pod: project belongs to pod, OR employee from this pod is assigned,
    // OR the task has no pod assignment at all (visible in all pod tabs to prevent tasks being hidden).
    query = query.where(function (this: any) {
      this.where('p.pod', pod as string)
        .orWhere('t.created_by', userId)
        .orWhere('t.xlr8_assignee_id', userId)
        .orWhereIn('t.id', function (this: any) { this.select('task_id').from('task_assignees').where('user_id', userId); })
        .orWhereIn('t.id', function (this: any) {
          this.select('ta.task_id').from('task_assignees as ta').join('users as u', 'ta.user_id', 'u.id')
            .where('u.pod', pod as string).whereIn('ta.assignee_role', ['employee']);
        })
        .orWhere(function (this: any) {
          this.whereNull('p.pod').whereNotIn('t.id', function (this: any) {
            this.select('ta.task_id').from('task_assignees as ta').join('users as u', 'ta.user_id', 'u.id')
              .whereNotNull('u.pod').whereIn('ta.assignee_role', ['employee']);
          });
        });
    });
  }

  query = applyDraftScope(query, actor);
  if (role === 'employee') {
    query = applyEmployeeTaskListScope(query, actor);
  } else if (role === 'admin' || role === 'manager') {
    // Admins and managers see everyone's work, recurring copies included
  } else if (role === 'client') {
    // Same rule as opening a single ticket (access.clientListScope)
    query = (await clientListScope(db, actor))(query);
  } else {
    return [];
  }

  const tasks = await query.orderBy('t.created_at', 'desc');
  const taskIds = tasks.map((t: any) => Number(t.id));

  const assigneeRows = taskIds.length
    ? await db('task_assignees as ta')
        .join('users as u', 'ta.user_id', 'u.id')
        .leftJoin(
          db('user_categories as uc').join('employee_categories as ec', 'uc.category_id', 'ec.id')
            .select('uc.user_id', db.raw('MIN(ec.name) as designation')).groupBy('uc.user_id').as('uc_agg'),
          'uc_agg.user_id', 'u.id'
        )
        .whereIn('ta.task_id', taskIds)
        .select('ta.task_id', 'u.id as user_id', 'u.name', 'u.avatar_color', 'u.avatar_url', 'u.role', 'ta.acceptance_status', 'ta.assignee_role', 'ta.stage_idx', 'ta.est_hours', 'uc_agg.designation')
    : [];

  // Timer state: active sessions for current user today + all active runners per task
  const today = new Date().toISOString().slice(0, 10);
  const activeSessionIds = taskIds.length
    ? await db('task_sessions').whereIn('task_id', taskIds).where({ user_id: userId, session_date: today }).whereNull('ended_at').pluck('task_id')
    : [];
  const activeRunnerRows = taskIds.length
    ? await db('task_sessions').whereIn('task_id', taskIds).where({ session_date: today }).whereNull('ended_at').select('task_id', 'user_id')
    : [];

  // In rework only while the latest review was a rejection (a resubmission opens a newer approval)
  const rejectedSet = new Set<number>();
  if (taskIds.length) {
    const latest = new Map<number, string>();
    for (const r of await db('approvals').whereIn('task_id', taskIds).orderBy('id').select('task_id', 'status')) latest.set(Number(r.task_id), r.status);
    for (const [tid, st] of latest) if (st === 'rejected') rejectedSet.add(tid);
  }
  const activeTimerSet = new Set<number>((activeSessionIds as any[]).map(Number));

  // Tickets being reworked: the latest step was a rejection and it hasn't been resubmitted yet
  const ticketIds = tasks.filter((t: any) => t.ticket_type_id && t.status !== 'completed').map((t: any) => Number(t.id));
  const reworkSet = new Set<number>();
  if (ticketIds.length) {
    const steps = await db('xlr8_ticket_log')
      .whereIn('task_id', ticketIds)
      .whereIn('action', ['manager_declined', 'admin_declined', 'work_done', 'next_stage', 'sent_to_admin', 'manager_approved', 'admin_approved', 'completed'])
      .orderBy('created_at', 'desc').orderBy('id', 'desc')
      .select('task_id', 'action');
    const seen = new Set<number>();
    for (const r of steps) {
      const id = Number(r.task_id);
      if (seen.has(id)) continue;
      seen.add(id);
      if (r.action === 'manager_declined' || r.action === 'admin_declined') reworkSet.add(id);
    }
  }

  // Tickets waiting for acceptance: who still has to accept (empty = everyone has, start it now)
  const waitingMap = new Map<number, string[]>();
  for (const t of tasks.filter((x: any) => x.ticket_type_id && x.xlr8_status === 'pending_assignee' && !x.crosspod_pods)) {
    const w = await waitingOn(db, t.id, t.xlr8_stage_idx ?? 0);
    if (!w.length) {
      await startIfAccepted(db, t.id, actor as any);
      const now = await db('tasks').where({ id: t.id }).select('xlr8_status', 'status').first();
      if (now?.xlr8_status === 'in_progress') { t.xlr8_status = now.xlr8_status; t.status = now.status; continue; }
    }
    waitingMap.set(Number(t.id), w);
  }

  return tasks.map((t: any) => {
    const tid = Number(t.id);
    return {
      ...t,
      assignees: assigneeRows.filter((a: any) => Number(a.task_id) === tid),
      my_acceptance_status: assigneeRows.find((a: any) => Number(a.task_id) === tid && Number(a.user_id) === userId)?.acceptance_status ?? null,
      timer_running: activeTimerSet.has(tid),
      active_runner_ids: activeRunnerRows.filter((r: any) => Number(r.task_id) === tid).map((r: any) => Number(r.user_id)),
      has_rejected_approval: !t.ticket_type_id && rejectedSet.has(tid),
      in_rework: reworkSet.has(tid),
      waiting_on: waitingMap.get(tid),
    };
  });
}

// ── Single task ──

export async function getTask(db: Knex, actor: Actor, taskId: number | string) {
  await assertCanSeeTask(db, actor, taskId);
  const task = await db('tasks as t')
    .leftJoin('projects as p', 't.project_id', 'p.id')
    .leftJoin('users as a', 't.assigned_to', 'a.id')
    .leftJoin('users as cr', 't.created_by', 'cr.id')
    .leftJoin('client_companies as c', 'p.client_company_id', 'c.id')
    .where('t.id', taskId)
    .select('t.*', 'p.name as project_name', 'c.name as client_name', 'a.name as assigned_name', 'a.avatar_color as assigned_color', 'cr.name as created_by_name')
    .first();
  if (!task) throw new ServiceError(404, 'Not found');

  const checklist = await db('task_checklist').where({ task_id: taskId }).orderByRaw('COALESCE(stage_idx, -1)').orderBy('id');
  const stageAssignees = await db('task_assignees as ta')
    .leftJoin('users as u', 'u.id', 'ta.user_id')
    .leftJoin(db('task_sessions').where('ended_at', null).select('user_id', 'task_id', 'stage_idx').as('ts'), function (this: any) {
      this.on('ts.user_id', 'ta.user_id').on('ts.task_id', 'ta.task_id').on(sameStage);
    })
    .where({ 'ta.task_id': taskId })
    .select('ta.stage_idx', 'ta.user_id', 'ta.assignee_role', 'ta.acceptance_status', 'ta.est_hours', 'ta.skipped', 'ta.is_reviewer', 'u.name as user_name', 'u.avatar_color', 'u.avatar_url', db.raw('CASE WHEN ts.user_id IS NOT NULL THEN 1 ELSE 0 END as is_active'));
  // Tracked seconds per stage (derived from started_at/ended_at in task_sessions)
  const isProd = isMySQLClient();
  const secSQL = isProd
    ? "COALESCE(SUM(TIMESTAMPDIFF(SECOND, ts.started_at, COALESCE(ts.ended_at, NOW()))), 0) as tracked_seconds"
    : "COALESCE(SUM(CAST((COALESCE(ts.ended_at, strftime('%s','now') * 1000) - ts.started_at) / 1000 AS INTEGER)), 0) as tracked_seconds";
  const stageTracked = await db('task_assignees as ta')
    .leftJoin('task_sessions as ts', function (this: any) { this.on('ts.task_id', 'ta.task_id').on('ts.user_id', 'ta.user_id').on(sameStage); })
    .where({ 'ta.task_id': taskId })
    .whereNotNull('ta.stage_idx')
    .groupBy('ta.stage_idx')
    .select('ta.stage_idx', db.raw(secSQL));
  let xlr8_stages = null;
  let xlr8_final_approval: any = null;
  if (task.ticket_type_id) {
    const tt = await db('xlr8_ticket_types').where({ id: task.ticket_type_id }).first();
    if (tt) {
      xlr8_stages = typeof tt.stages === 'string' ? JSON.parse(tt.stages || '[]') : (tt.stages ?? []);
      xlr8_final_approval = typeof tt.final_approval === 'string' ? JSON.parse(tt.final_approval || '{}') : (tt.final_approval ?? {});
    }
  }
  const stageName = (i: number) => { const st = (xlr8_stages as any[] | null)?.[i]; return st?.type === 'admin' ? 'Admin review' : st?.category_name || `Stage ${i + 1}`; };
  const labelled = checklist.map((c: any) => ({ ...c, stage_name: c.stage_idx == null ? null : stageName(Number(c.stage_idx)) }));
  return { ...task, checklist: labelled, stage_assignees: stageAssignees, stage_tracked: stageTracked, xlr8_stages, xlr8_final_approval };
}

// ── Create ──

// Creates a plain ticket. Every change to business data (the ticket, its assignees, checklist, approval flow, the
// requester credit, the cross-pod hold, the replaced draft, and the assistant audit row) runs in one transaction.
// Notifications and scheduling are queued until commit, so a failure anywhere rolls the whole create back and a
// rolled-back create sends nothing. Pass a transaction as db to join an outer transaction (the assistant does).
export async function createTask(db: Knex, actor: Actor, body: any): Promise<{ id: number; warnings: string[]; crosspod_pending?: string[] }> {
  if (!STAFF.includes(actor.role)) throw new ServiceError(403, 'Insufficient permissions');
  const { title, description, project_id, working_person_id, task_manager_id, due_date, due_time, checklist, estimated_hours, priority, approval_flow, draft } = body ?? {};
  if (!title || !project_id) throw new ServiceError(400, 'Title and project required');
  const isDraft = !!draft;

  // Accept either string[] (legacy) or {text,checked}[] (new)
  type RawItem = string | { text: string; checked?: boolean };
  const rawItems: RawItem[] = checklist || [];
  const checklistItems = rawItems.map((r) => typeof r === 'string' ? { text: r, checked: false } : { text: r.text, checked: !!r.checked });

  const workerId  = working_person_id ? Number(working_person_id) : null;
  const managerId = task_manager_id   ? Number(task_manager_id)   : null;
  // Decided up front so a task held for approval doesn't pause anyone's timer
  const projectRow = await db('projects').where({ id: project_id }).select('pod', 'name').first();
  const reasons = isDraft ? [] : await approvalReasons(db, actor as any, projectRow ?? {}, workerId ? [{ user_id: workerId }] : []);
  const pods = reasonPods(reasons);

  return inTransaction(db, async (trx) => {
    const inserted = await trx('tasks').insert({
      title, description: description || null,
      project_id, assigned_to: workerId,
      created_by: actor.id,
      due_date: due_date ? String(due_date).slice(0, 10) : null,
      due_time: due_time || null,
      status: isDraft ? 'draft' : (actor.role === 'employee' ? 'pending_approval' : 'todo'),
      checklist_total: checklistItems.filter(i => i.text).length,
      checklist_done: 0,
      estimated_hours: estimated_hours ? Number(estimated_hours) : null,
      priority: priority || 'medium',
    });
    const newId = inserted[0];

    // Insert assignees (no alternate role — only employee + manager)
    const assigneeInserts: any[] = [];
    if (workerId)  assigneeInserts.push({ task_id: newId, user_id: workerId,  assignee_role: 'employee', acceptance_status: 'pending', assigned_at: new Date() });
    if (managerId) assigneeInserts.push({ task_id: newId, user_id: managerId, assignee_role: 'manager',  acceptance_status: 'accepted' });
    if (assigneeInserts.length) await trx('task_assignees').insert(assigneeInserts);

    const validItems = checklistItems.filter(i => i.text);
    if (validItems.length) {
      await trx('task_checklist').insert(validItems.map((i) => ({ task_id: newId, text: i.text, completed: i.checked ? 1 : 0 })));
      const doneCount = validItems.filter(i => i.checked).length;
      await trx('tasks').where({ id: newId }).update({ checklist_total: validItems.length, checklist_done: doneCount });
    }

    // Save custom approval flow if provided
    const flowUsers: number[] = Array.isArray(approval_flow) ? approval_flow.filter(Boolean) : [];
    if (flowUsers.length) {
      await trx('task_approval_flow').insert(flowUsers.map((userId, position) => ({ task_id: newId, user_id: userId, position })));
    }

    // Auto-pause active session if high/urgent priority (inside transaction so pause + insert are atomic)
    if (workerId && !pods.length && ['high', 'urgent'].includes(priority || 'medium')) {
      await pauseActiveSession(trx, workerId);
    }

    if (isDraft) {
      if (body.draft_form) await trx('tasks').where({ id: newId }).update({ draft_form: body.draft_form });
      await discardRejected(trx, body.replaces_id, actor as any);
      return { id: newId, warnings: [] as string[] };
    }

    // Business data: a failure here must roll the ticket back, not leave a live ticket behind
    const replaced = await discardRejected(trx, body.replaces_id, actor as any);
    await creditRequester(trx, newId, replaced, actor as any);
    if (pods.length) {
      await holdForCrossPod(trx, { id: newId, title, project_id, isTicket: false }, reasons, actor as any);
      return { id: newId, warnings: [] as string[], crosspod_pending: pods };
    }

    // Notifications (queued until commit)
    const warnings: string[] = [];
    const project = projectRow ?? null;
    const effectivePriority = priority || 'medium';
    if (workerId && ['high', 'urgent'].includes(effectivePriority)) {
      if (workerId !== actor.id) {
        await createNotification(workerId, `${effectivePriority === 'urgent' ? 'Urgent' : 'High priority'} ticket "${title}" assigned — your active ticket was paused`, 'task', project_id);
      }
    } else if (workerId && workerId !== actor.id) {
      await createNotification(workerId, `You have been assigned ticket "${title}" in ${project?.name || 'a project'}`, 'task', project_id);
    }
    // WhatsApp group notice: queued now, sent only after the ticket commits
    if (workerId) await onCommit(() => noticeAfterCommit({ taskId: Number(newId), kind: 'assigned', employeeIds: [workerId], eventKey: `assign:${newId}:${randomUUID()}` }));
    if (workerId && estimated_hours) {
      const row = await trx('tasks as t')
        .join('task_assignees as ta', 'ta.task_id', 't.id')
        .where('ta.user_id', workerId)
        .whereIn('ta.assignee_role', ['employee'])
        .whereNotIn('ta.acceptance_status', ['declined'])
        .whereNotIn('t.status', ['completed'])
        .whereNotNull('t.estimated_hours')
        .sum('t.estimated_hours as total')
        .first();
      const totalHours = Number(row?.total ?? 0);
      if (totalHours > 7) {
        const assignee = await trx('users').where({ id: workerId }).first();
        warnings.push(`${assignee?.name || 'Assignee'} is over capacity (${totalHours.toFixed(1)} hrs assigned, 7 hr daily limit)`);
      }
    }
    if (managerId && managerId !== actor.id) {
      await createNotification(managerId, `You are managing ticket "${title}" in ${project?.name || 'a project'}`, 'task', project_id);
    }
    if (workerId) await notifyAdminCrossPod(trx, actor as any, { title, project_id }, projectRow ?? {}, [{ user_id: workerId }]);

    scheduleLater(newId);
    return { id: newId, warnings };
  });
}

// ── Update ──

const VALID_STATUSES = ['draft', 'todo', 'pending_approval', 'in_progress', 'in_review', 'overdue', 'completed'];
const ADMIN_MANAGER_ONLY_STATUSES = ['completed', 'overdue'];

// Website: only admins and managers have the task edit form. Employees change tasks through accept/decline,
// the timer, checklist, comments and attachments only (S6). Managers edit within their pod scope.
// One transaction: a cross-pod reassignment hold, the other edits and the audit row succeed or fail together.
export async function updateTask(conn: Knex, actor: Actor, taskId: number | string, body: any): Promise<void> {
  return inTransaction(conn, (db) => updateTaskInTx(db, actor, taskId, body));
}

async function updateTaskInTx(db: Knex, actor: Actor, taskId: number | string, body: any): Promise<void> {
  if (actor.role === 'employee') throw new ServiceError(403, 'Employees cannot edit tickets — use accept, timer, checklist or comments');
  if (!STAFF.includes(actor.role)) throw new ServiceError(403, 'Insufficient permissions');
  await assertCanManageTask(db, actor, taskId);
  const { title, description, assignee_ids, due_date, due_time, estimated_hours, status, working_person_id, task_manager_id, priority } = body ?? {};
  const updates: any = {};
  if (title) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (due_date !== undefined) updates.due_date = due_date ? String(due_date).slice(0, 10) : null;
  if (due_time !== undefined) updates.due_time = due_time;
  if (estimated_hours !== undefined) updates.estimated_hours = estimated_hours !== null ? Number(estimated_hours) : null;
  if (priority !== undefined) updates.priority = priority;
  if (status !== undefined) {
    if (!VALID_STATUSES.includes(status)) throw new ServiceError(400, 'Invalid status');
    if (actor.role === 'employee' && ADMIN_MANAGER_ONLY_STATUSES.includes(status)) throw new ServiceError(403, 'Employees cannot set this status directly');
    updates.status = status;
    if (status === 'completed') updates.completed_at = new Date();
  }

  // Employees can only update tasks they are assigned to
  if (actor.role === 'employee') {
    const assigned = await db('task_assignees').where({ task_id: taskId, user_id: actor.id }).first();
    if (!assigned) throw new ServiceError(403, 'Not assigned to this ticket');
  }

  // A ticket waiting on a cross-pod reassignment keeps its status until the other pod decides
  const holding = await db('tasks').where({ id: taskId }).first('pending_assign');
  if (holding?.pending_assign && status !== undefined) throw new ServiceError(409, 'Status cannot change while a reassignment waits for approval');

  // Role-based assignee update (from edit drawer) — skip for XLR8 tickets; stage assignments are managed via PUT /stage-assignments
  const taskForCheck = await db('tasks').where({ id: taskId }).select('ticket_type_id').first();
  if (!taskForCheck?.ticket_type_id && (working_person_id !== undefined || task_manager_id !== undefined)) {
    const workerId  = working_person_id ? Number(working_person_id) : null;
    const managerId = task_manager_id   ? Number(task_manager_id)   : null;
    const current = await db('task_assignees').where({ task_id: taskId }).select('user_id', 'assignee_role');
    const curWorker = current.find((r: any) => r.assignee_role === 'employee')?.user_id ?? null;
    const workerChanged = !!workerId && Number(workerId) !== Number(curWorker);
    const reasons = workerChanged ? await reassignmentReasons(db, actor, taskId, workerId as number) : [];
    if (reasons.length) {
      // Cross-pod reassignment: the assignees stay as they are until the other pod's manager decides
      await holdReassignment(db, actor, taskId, { working_person_id: workerId, task_manager_id: managerId }, reasons);
    } else {
      await applyAssignees(db, actor, taskId, workerId, managerId, priority);
    }
  } else if (!taskForCheck?.ticket_type_id && assignee_ids !== undefined) {
    const ids: number[] = Array.isArray(assignee_ids) ? assignee_ids : (assignee_ids ? [Number(assignee_ids)] : []);
    updates.assigned_to = ids[0] || null;
    const prevEmployees = (await db('task_assignees').where({ task_id: taskId, assignee_role: 'employee' }).select('user_id')).map((r: any) => Number(r.user_id)).sort().join(',');
    await db('task_assignees').where({ task_id: taskId }).delete();
    if (ids.length) {
      await db('task_assignees').insert(ids.map((uid) => ({ task_id: taskId, user_id: uid, assignee_role: 'employee', acceptance_status: 'pending', assigned_at: new Date() })));
    }
    // WhatsApp group notice when the set of employees changed, queued after commit
    const nowEmployees = [...new Set(ids.map(Number))].sort().join(',');
    if (ids.length && nowEmployees !== prevEmployees) {
      await onCommit(() => noticeAfterCommit({ taskId: Number(taskId), kind: prevEmployees ? 'reassigned' : 'assigned', employeeIds: ids, eventKey: `${prevEmployees ? 'reassign' : 'assign'}:${taskId}:${randomUUID()}` }));
    }
  }

  if (Object.keys(updates).length) await db('tasks').where({ id: taskId }).update(updates);

  // Close any open timer sessions when task moves to in_review or completed
  if (status === 'in_review' || status === 'completed') {
    const closeNow = new Date();
    const closeToday = closeNow.toISOString().slice(0, 10);
    const openSessions = await db('task_sessions').where({ task_id: taskId }).whereNull('ended_at').select('*');
    if (openSessions.length) {
      await db('task_sessions').where({ task_id: taskId }).whereNull('ended_at').update({ ended_at: closeNow });
      const taskRow = await db('tasks').where({ id: taskId }).select('project_id').first();
      if (taskRow) {
        const daysInCloseMonth = new Date(closeNow.getFullYear(), closeNow.getMonth() + 1, 0).getDate();
        for (const s of openSessions) {
          const startMs = typeof s.started_at === 'number' ? s.started_at : isNaN(Number(s.started_at)) ? new Date(s.started_at).getTime() : Number(s.started_at);
          const hours = Math.round((closeNow.getTime() - startMs) / 36000) / 100;
          if (hours >= 0.01) {
            const userRec = await db('users').where({ id: s.user_id }).select('monthly_salary').first();
            const hourlyRate = userRec?.monthly_salary ? Number(userRec.monthly_salary) / daysInCloseMonth / 7 : null;
            await db('time_logs').insert({
              task_id: Number(taskId), project_id: taskRow.project_id, user_id: s.user_id, task_session_id: s.id,
              log_date: closeToday, hours, hourly_rate: hourlyRate,
            });
          }
        }
      }
    }
  }

  // Sync task status changes to approvals if they exist
  if (status === 'completed') {
    const approval = await db('approvals').where({ task_id: taskId }).whereNotIn('status', ['approved', 'rejected']).first();
    if (approval) {
      await db('approvals').where({ id: approval.id }).update({ status: 'approved', final_approved_by: actor.id, final_approved_at: new Date() });
    }
  } else if (status === 'in_review') {
    const approval = await db('approvals').where({ task_id: taskId, status: 'work_in_progress' }).first();
    if (approval) {
      await db('approvals').where({ id: approval.id }).update({ status: 'pending_review', work_submitted_at: new Date() });
    }
  }

  scheduleLater(Number(taskId));
}

// Sets the plain-ticket assignees and their notifications. Used by an edit and by approval of a cross-pod
// reassignment, so both follow the same rules.
export async function applyAssignees(db: Knex, actor: { id: number }, taskId: number | string, workerId: number | null, managerId: number | null, priority?: string): Promise<void> {
  await db('tasks').where({ id: taskId }).update({ assigned_to: workerId });
  const prevAssignees = await db('task_assignees').where({ task_id: taskId }).select('user_id', 'assignee_role', 'acceptance_status', 'assigned_at');
  const prevWorker  = prevAssignees.find((a: any) => a.assignee_role === 'employee');
  const prevManager = prevAssignees.find((a: any) => a.assignee_role === 'manager');
  await db('task_assignees').where({ task_id: taskId }).delete();
  const inserts: any[] = [];
  if (workerId) {
    const sameWorker = prevWorker && Number(prevWorker.user_id) === workerId;
    inserts.push({ task_id: taskId, user_id: workerId, assignee_role: 'employee', acceptance_status: sameWorker ? prevWorker.acceptance_status : 'pending', assigned_at: sameWorker && prevWorker.assigned_at ? prevWorker.assigned_at : new Date() });
  }
  if (managerId) inserts.push({ task_id: taskId, user_id: managerId, assignee_role: 'manager', acceptance_status: 'accepted' });
  if (inserts.length) await db('task_assignees').insert(inserts);
  const taskRow = await db('tasks').where({ id: taskId }).select('title', 'project_id').first();
  const proj = taskRow ? await db('projects').where({ id: taskRow.project_id }).select('name').first() : null;
  const projName = proj?.name || 'a project';
  if (workerId && workerId !== Number(prevWorker?.user_id)) {
    // WhatsApp group notice for the new or changed worker, queued after commit
    await onCommit(() => noticeAfterCommit({ taskId: Number(taskId), kind: prevWorker ? 'reassigned' : 'assigned', employeeIds: [workerId], eventKey: `${prevWorker ? 'reassign' : 'assign'}:${taskId}:${randomUUID()}` }));
  }
  if (workerId) {
    const isNewWorker = workerId !== Number(prevWorker?.user_id);
    // Get effective priority (from body or existing task)
    const effectivePriority = priority || (await db('tasks').where({ id: taskId }).select('priority').first())?.priority;
    if (['high', 'urgent'].includes(effectivePriority)) {
      // Always pause active session for high/urgent — regardless of who is creating/re-assigning
      await pauseActiveSession(db, workerId);
      if (workerId !== actor.id || isNewWorker) {
        await createNotification(workerId, `${effectivePriority === 'urgent' ? 'Urgent' : 'High priority'} ticket "${taskRow?.title}" assigned — your active ticket was paused`, 'task', taskRow?.project_id);
      }
    } else if (isNewWorker && workerId !== actor.id) {
      await createNotification(workerId, `You have been assigned ticket "${taskRow?.title}" in ${projName}`, 'task', taskRow?.project_id);
    }
  }
  if (managerId && managerId !== actor.id && managerId !== Number(prevManager?.user_id)) {
    await createNotification(managerId, `You are managing ticket "${taskRow?.title}" in ${projName}`, 'task', taskRow?.project_id);
  }
}

// The question creation asks: approvalReasons with the project and the working person. Using the same call means a
// reassignment cannot avoid an approval that creating the ticket for this project and person would have needed.
async function reassignmentReasons(db: Knex, actor: Actor, taskId: number | string, workerId: number) {
  const t = await db('tasks').where({ id: taskId }).first('project_id');
  const projectRow = t ? await db('projects').where({ id: t.project_id }).select('pod', 'name').first() : null;
  return approvalReasons(db, actor as any, projectRow ?? {}, [{ user_id: workerId }]);
}

// Stops running timers on a ticket that is now held, and logs the time they had run
async function stopRunningSessions(db: Knex, taskId: number | string, now: Date): Promise<void> {
  const open = await db('task_sessions').where({ task_id: taskId }).whereNull('ended_at').select('*');
  if (!open.length) return;
  const task = await db('tasks').where({ id: taskId }).first('project_id');
  for (const sess of open) {
    await db('task_sessions').where({ id: sess.id }).update({ ended_at: now });
    const startMs = isNaN(Number(sess.started_at)) ? new Date(sess.started_at).getTime() : Number(sess.started_at);
    const hours = (now.getTime() - startMs) / 3600000;
    if (hours >= 0.01 && task) {
      const user = await db('users').where({ id: sess.user_id }).select('monthly_salary').first();
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const hourlyRate = user?.monthly_salary ? Number(user.monthly_salary) / daysInMonth / 7 : null;
      await db('time_logs').insert({
        task_id: taskId, project_id: task.project_id, user_id: sess.user_id, task_session_id: sess.id, log_date: sess.session_date,
        hours: Math.round(hours * 100) / 100, notes: 'Stopped when the ticket was sent for a reassignment approval', hourly_rate: hourlyRate,
      });
    }
  }
}

// Holds a cross-pod reassignment: the ticket waits for the other pod's manager, with the requested assignees and
// the status to restore stored on it. Uses the same hold and notifications as a cross-pod creation.
async function holdReassignment(db: Knex, actor: Actor, taskId: number | string, pending: { working_person_id: number | null; task_manager_id: number | null }, reasons: any[]): Promise<void> {
  const t = await db('tasks').where({ id: taskId }).first('status', 'title', 'project_id');
  if (!t) throw new ServiceError(404, 'Not found');
  if (t.status === 'pending_approval') throw new ServiceError(409, 'This ticket is already waiting for approval');
  if (t.status === 'draft') throw new ServiceError(409, 'A draft can go to another pod once it is submitted');
  await stopRunningSessions(db, taskId, new Date());
  await db('tasks').where({ id: taskId }).update({ pending_assign: JSON.stringify(pending), pending_prev_status: t.status });
  await holdForCrossPod(db, { id: Number(taskId), title: t.title, project_id: t.project_id, isTicket: false }, reasons, actor as any);
}
