import { Router, Response } from 'express';
import { getDB, createNotification } from '../db';
import { authenticate, requireRoles, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate);

// GET tasks (filtered by role)
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const { role, id: userId } = req.user!;
    const { project_id, pod } = req.query;

    let query = db('tasks as t')
      .join('projects as p', 't.project_id', 'p.id')
      .leftJoin('users as a', 't.assigned_to', 'a.id')
      .leftJoin('users as cr', 't.created_by', 'cr.id')
      .leftJoin('users as xa', 't.xlr8_assignee_id', 'xa.id')
      .leftJoin('client_companies as c', 'p.client_company_id', 'c.id')
      .select(
        't.*',
        'p.name as project_name',
        'c.name as client_name',
        'a.name as assigned_name',
        'a.avatar_color as assigned_color',
        'cr.name as created_by_name',
        'xa.name as xlr8_assignee_name'
      );

    if (project_id) query = query.where('t.project_id', project_id);

    if (pod && (role === 'admin' || role === 'manager')) {
      // Filter tasks to this pod: either the project belongs to this pod, or an employee from this pod is assigned
      query = query.where(function (this: any) {
        this.where('p.pod', pod as string)
          .orWhereIn('t.id', function (this: any) {
            this.select('ta.task_id')
              .from('task_assignees as ta')
              .join('users as u', 'ta.user_id', 'u.id')
              .where('u.pod', pod as string)
              .whereIn('ta.assignee_role', ['employee']);
          });
      });
    }

    if (role === 'employee') {
      query = query.whereRaw(
        '(t.assigned_to = ? OR t.created_by = ? OR t.id IN (SELECT task_id FROM task_assignees WHERE user_id = ?) OR t.id IN (SELECT task_id FROM xlr8_ticket_log WHERE actor_id = ?))',
        [userId, userId, userId, userId]
      );
    } else if (role === 'client') {
      query = query
        .join('project_members as pm', 'p.id', 'pm.project_id')
        .where('pm.user_id', userId);
    }

    const tasks = await query.orderBy('t.created_at', 'desc');

    // Normalise all task IDs to numbers once
    const taskIds = tasks.map((t: any) => Number(t.id));

    const assigneeRows = taskIds.length
      ? await db('task_assignees as ta')
          .join('users as u', 'ta.user_id', 'u.id')
          .whereIn('ta.task_id', taskIds)
          .select('ta.task_id', 'u.id as user_id', 'u.name', 'u.avatar_color', 'u.role', 'ta.acceptance_status', 'ta.assignee_role', 'ta.stage_idx', 'ta.est_hours')
      : [];

    // Timer state: active sessions for current user today + all active runners per task
    const today = new Date().toISOString().slice(0, 10);
    const activeSessionIds = taskIds.length
      ? await db('task_sessions')
          .whereIn('task_id', taskIds)
          .where({ user_id: userId, session_date: today })
          .whereNull('ended_at')
          .pluck('task_id')
      : [];

    const activeRunnerRows = taskIds.length
      ? await db('task_sessions')
          .whereIn('task_id', taskIds)
          .where({ session_date: today })
          .whereNull('ended_at')
          .select('task_id', 'user_id')
      : [];

    // Rejected approvals per task — use a Set for reliable number comparison
    const rejectedSet = new Set<number>(
      taskIds.length
        ? (await db('approvals').whereIn('task_id', taskIds).where('status', 'rejected').select('task_id'))
            .map((r: any) => Number(r.task_id))
        : []
    );
    const activeTimerSet = new Set<number>((activeSessionIds as any[]).map(Number));

    const result = tasks.map((t: any) => {
      const tid = Number(t.id);
      return {
        ...t,
        assignees: assigneeRows.filter((a: any) => Number(a.task_id) === tid),
        my_acceptance_status: assigneeRows.find((a: any) => Number(a.task_id) === tid && Number(a.user_id) === userId)?.acceptance_status ?? null,
        timer_running: activeTimerSet.has(tid),
        active_runner_ids: activeRunnerRows.filter((r: any) => Number(r.task_id) === tid).map((r: any) => Number(r.user_id)),
        has_rejected_approval: rejectedSet.has(tid),
      };
    });

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET approval flow for a task
router.get('/:id/approval-flow', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const flow = await db('task_approval_flow as f')
      .join('users as u', 'f.user_id', 'u.id')
      .where('f.task_id', req.params.id)
      .orderBy('f.position')
      .select('u.id', 'u.name', 'u.role', 'u.avatar_color', 'f.position');
    res.json(flow);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET single task with checklist
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const task = await db('tasks as t')
      .join('projects as p', 't.project_id', 'p.id')
      .leftJoin('users as a', 't.assigned_to', 'a.id')
      .leftJoin('client_companies as c', 'p.client_company_id', 'c.id')
      .where('t.id', req.params.id)
      .select('t.*', 'p.name as project_name', 'c.name as client_name', 'a.name as assigned_name', 'a.avatar_color as assigned_color')
      .first();
    if (!task) { res.status(404).json({ error: 'Not found' }); return; }

    const checklist = await db('task_checklist').where({ task_id: req.params.id });
    const stageAssignees = await db('task_assignees as ta')
      .leftJoin('users as u', 'u.id', 'ta.user_id')
      .where({ 'ta.task_id': req.params.id })
      .select('ta.stage_idx', 'ta.user_id', 'ta.assignee_role', 'ta.est_hours', 'u.name as user_name', 'u.avatar_color');
    let xlr8_stages = null;
    if (task.ticket_type_id) {
      const tt = await db('xlr8_ticket_types').where({ id: task.ticket_type_id }).first();
      if (tt) xlr8_stages = JSON.parse(tt.stages || '[]');
    }
    res.json({ ...task, checklist, stage_assignees: stageAssignees, xlr8_stages });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST create task (admin, manager, employee)
router.post('/', requireRoles('admin', 'manager', 'employee'), async (req: AuthRequest, res: Response) => {
  const { title, description, project_id, working_person_id, task_manager_id, due_date, due_time, checklist, estimated_hours, approval_flow, draft } = req.body;
  if (!title || !project_id) { res.status(400).json({ error: 'Title and project required' }); return; }
  const isDraft = !!draft;
  try {
    const db = getDB();
    // Accept either string[] (legacy) or {text,checked}[] (new)
    type RawItem = string | { text: string; checked?: boolean };
    const rawItems: RawItem[] = checklist || [];
    const checklistItems = rawItems.map((r) =>
      typeof r === 'string' ? { text: r, checked: false } : { text: r.text, checked: !!r.checked }
    );

    const workerId  = working_person_id  ? Number(working_person_id)  : null;
    const managerId = task_manager_id    ? Number(task_manager_id)    : null;

    const [id] = await db('tasks').insert({
      title, description: description || null,
      project_id, assigned_to: workerId,
      created_by: req.user!.id,
      due_date: due_date ? String(due_date).slice(0, 10) : null,
      due_time: due_time || null,
      status: isDraft ? 'draft' : 'todo',
      checklist_total: checklistItems.filter(i => i.text).length,
      checklist_done: 0,
      estimated_hours: estimated_hours ? Number(estimated_hours) : null,
    });

    // Insert assignees (no alternate role — only employee + manager)
    const assigneeInserts: any[] = [];
    if (workerId)  assigneeInserts.push({ task_id: id, user_id: workerId,  assignee_role: 'employee', acceptance_status: 'pending' });
    if (managerId) assigneeInserts.push({ task_id: id, user_id: managerId, assignee_role: 'manager',  acceptance_status: 'accepted' });
    if (assigneeInserts.length) await db('task_assignees').insert(assigneeInserts);

    const validItems = checklistItems.filter(i => i.text);
    if (validItems.length) {
      await db('task_checklist').insert(validItems.map((i) => ({ task_id: id, text: i.text, completed: i.checked ? 1 : 0 })));
      const doneCount = validItems.filter(i => i.checked).length;
      await db('tasks').where({ id }).update({ checklist_total: validItems.length, checklist_done: doneCount });
    }

    // Save custom approval flow if provided
    const flowUsers: number[] = Array.isArray(approval_flow) ? approval_flow.filter(Boolean) : [];
    if (flowUsers.length) {
      await db('task_approval_flow').insert(
        flowUsers.map((userId, position) => ({ task_id: id, user_id: userId, position }))
      );
    }

    // Notify assigned employee + check capacity warnings (skip for drafts)
    const warnings: string[] = [];
    if (isDraft) { res.status(201).json({ id, warnings }); return; }
    const project = await db('projects').where({ id: project_id }).first();
    if (workerId && workerId !== req.user!.id) {
      await createNotification(workerId, `You have been assigned task "${title}" in ${project?.name || 'a project'}`, 'task', project_id);
    }
    if (workerId && estimated_hours) {
      const row = await db('tasks as t')
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
        const assignee = await db('users').where({ id: workerId }).first();
        warnings.push(`${assignee?.name || 'Assignee'} is over capacity (${totalHours.toFixed(1)} hrs assigned, 7 hr daily limit)`);
      }
    }
    if (managerId && managerId !== req.user!.id) {
      await createNotification(managerId, `You are managing task "${title}" in ${project?.name || 'a project'}`, 'task', project_id);
    }

    res.status(201).json({ id, warnings });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT update task
router.put('/:id', requireRoles('admin', 'manager', 'employee'), async (req: AuthRequest, res: Response) => {
  const { title, description, assignee_ids, due_date, due_time, estimated_hours, status, working_person_id, task_manager_id } = req.body;
  try {
    const db = getDB();
    const updates: any = {};
    if (title) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (due_date !== undefined) updates.due_date = due_date ? String(due_date).slice(0, 10) : null;
    if (due_time !== undefined) updates.due_time = due_time;
    if (estimated_hours !== undefined) updates.estimated_hours = estimated_hours !== null ? Number(estimated_hours) : null;
    const VALID_STATUSES = ['draft', 'todo', 'in_progress', 'in_review', 'overdue', 'completed'];
    if (status !== undefined) {
      if (!VALID_STATUSES.includes(status)) { res.status(400).json({ error: 'Invalid status' }); return; }
      updates.status = status;
    }

    // Role-based assignee update (from edit drawer)
    if (working_person_id !== undefined || task_manager_id !== undefined) {
      const workerId  = working_person_id ? Number(working_person_id) : null;
      const managerId = task_manager_id   ? Number(task_manager_id)   : null;
      updates.assigned_to = workerId;
      const prevAssignees = await db('task_assignees').where({ task_id: req.params.id }).select('user_id', 'assignee_role', 'acceptance_status');
      const prevWorker  = prevAssignees.find((a: any) => a.assignee_role === 'employee');
      const prevManager = prevAssignees.find((a: any) => a.assignee_role === 'manager');
      await db('task_assignees').where({ task_id: req.params.id }).delete();
      const inserts: any[] = [];
      if (workerId) {
        const sameWorker = prevWorker && Number(prevWorker.user_id) === workerId;
        inserts.push({ task_id: req.params.id, user_id: workerId, assignee_role: 'employee', acceptance_status: sameWorker ? prevWorker.acceptance_status : 'pending' });
      }
      if (managerId) inserts.push({ task_id: req.params.id, user_id: managerId, assignee_role: 'manager', acceptance_status: 'accepted' });
      if (inserts.length) await db('task_assignees').insert(inserts);
      const taskRow = await db('tasks').where({ id: req.params.id }).select('title', 'project_id').first();
      const proj = taskRow ? await db('projects').where({ id: taskRow.project_id }).select('name').first() : null;
      const projName = proj?.name || 'a project';
      if (workerId && workerId !== req.user!.id && workerId !== Number(prevWorker?.user_id)) {
        await createNotification(workerId, `You have been assigned task "${taskRow?.title}" in ${projName}`, 'task', taskRow?.project_id);
      }
      if (managerId && managerId !== req.user!.id && managerId !== Number(prevManager?.user_id)) {
        await createNotification(managerId, `You are managing task "${taskRow?.title}" in ${projName}`, 'task', taskRow?.project_id);
      }
    } else if (assignee_ids !== undefined) {
      const ids: number[] = Array.isArray(assignee_ids) ? assignee_ids : (assignee_ids ? [Number(assignee_ids)] : []);
      updates.assigned_to = ids[0] || null;
      await db('task_assignees').where({ task_id: req.params.id }).delete();
      if (ids.length) {
        await db('task_assignees').insert(ids.map((uid) => ({ task_id: req.params.id, user_id: uid })));
      }
    }

    if (Object.keys(updates).length) {
      await db('tasks').where({ id: req.params.id }).update(updates);
    }

    // Close any open timer sessions when task moves to in_review or completed
    if (status === 'in_review' || status === 'completed') {
      const closeNow = new Date();
      const closeToday = closeNow.toISOString().slice(0, 10);
      const openSessions = await db('task_sessions')
        .where({ task_id: req.params.id }).whereNull('ended_at').select('*');
      if (openSessions.length) {
        await db('task_sessions')
          .where({ task_id: req.params.id }).whereNull('ended_at')
          .update({ ended_at: closeNow });
        const taskRow = await db('tasks').where({ id: req.params.id }).select('project_id').first();
        if (taskRow) {
          const daysInCloseMonth = new Date(closeNow.getFullYear(), closeNow.getMonth() + 1, 0).getDate();
          for (const s of openSessions) {
            const startMs = typeof s.started_at === 'number'
              ? s.started_at : isNaN(Number(s.started_at))
              ? new Date(s.started_at).getTime() : Number(s.started_at);
            const hours = Math.round((closeNow.getTime() - startMs) / 36000) / 100;
            if (hours >= 0.01) {
              const userRec = await db('users').where({ id: s.user_id }).select('monthly_salary').first();
              const hourlyRate = userRec?.monthly_salary ? Number(userRec.monthly_salary) / daysInCloseMonth / 7 : null;
              await db('time_logs').insert({
                task_id: Number(req.params.id),
                project_id: taskRow.project_id,
                user_id: s.user_id,
                task_session_id: s.id,
                log_date: closeToday,
                hours,
                hourly_rate: hourlyRate,
              });
            }
          }
        }
      }
    }

    // Sync task status changes to approvals if they exist
    if (status === 'completed') {
      const approval = await db('approvals').where({ task_id: req.params.id }).whereNotIn('status', ['approved', 'rejected']).first();
      if (approval) {
        await db('approvals').where({ id: approval.id }).update({
          status: 'approved',
          final_approved_by: req.user!.id,
          final_approved_at: new Date(),
        });
      }
    } else if (status === 'in_review') {
      const approval = await db('approvals').where({ task_id: req.params.id, status: 'work_in_progress' }).first();
      if (approval) {
        await db('approvals').where({ id: approval.id }).update({
          status: 'pending_review',
          work_submitted_at: new Date(),
        });
      }
    }

    res.json({ message: 'Updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT update checklist item
router.put('/:taskId/checklist/:itemId', async (req: AuthRequest, res: Response) => {
  const { completed } = req.body;
  try {
    const db = getDB();
    await db('task_checklist').where({ id: req.params.itemId, task_id: req.params.taskId }).update({ completed });
    const total = await db('task_checklist').where({ task_id: req.params.taskId }).count('* as count').first();
    const done = await db('task_checklist').where({ task_id: req.params.taskId, completed: true }).count('* as count').first();
    await db('tasks').where({ id: req.params.taskId }).update({
      checklist_total: (total as any).count,
      checklist_done: (done as any).count,
    });
    res.json({ message: 'Updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE task (admin + manager)
router.delete('/:id', requireRoles('admin', 'manager'), async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const tid = req.params.id;
    await db('approval_steps').whereIn('approval_id', db('approvals').where({ task_id: tid }).select('id')).delete();
    await db('approvals').where({ task_id: tid }).delete();
    await db('time_logs').where({ task_id: tid }).delete();
    await db('task_sessions').where({ task_id: tid }).delete();
    await db('task_assignees').where({ task_id: tid }).delete();
    await db('task_checklist').where({ task_id: tid }).delete();
    await db('tasks').where({ id: tid }).delete();
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('Delete task error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST accept or decline task assignment
router.post('/:id/accept', async (req: AuthRequest, res: Response) => {
  const { action } = req.body; // 'accept' | 'decline'
  if (!['accept', 'decline'].includes(action)) {
    res.status(400).json({ error: 'Invalid action' }); return;
  }
  try {
    const db = getDB();
    const userId = req.user!.id;
    const row = await db('task_assignees').where({ task_id: req.params.id, user_id: userId }).first();
    if (!row) { res.status(403).json({ error: 'Not assigned to this task' }); return; }

    await db('task_assignees')
      .where({ task_id: req.params.id, user_id: userId })
      .update({ acceptance_status: action === 'accept' ? 'accepted' : 'declined' });

    const task = await db('tasks').where({ id: req.params.id }).first();
    if (task && task.created_by !== userId) {
      const me = await db('users').where({ id: userId }).first();
      await createNotification(
        task.created_by,
        `${me?.name} ${action === 'accept' ? 'accepted' : 'declined'} the task "${task.title}"`,
        'task',
        task.project_id
      );
    }
    res.json({ message: 'Updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST timer actions: start | pause | done
router.post('/:id/timer', async (req: AuthRequest, res: Response) => {
  const { action } = req.body; // 'start' | 'pause' | 'done'
  if (!['start', 'pause', 'done'].includes(action)) {
    res.status(400).json({ error: 'Invalid action' }); return;
  }
  try {
    const db = getDB();
    const userId = req.user!.id;
    const taskId = Number(req.params.id);
    const now = new Date();
    const today = now.toISOString().slice(0, 10);

    if (action === 'start') {
      // Pause any other running sessions for this user first, and write time_logs for them
      const otherOpen = await db('task_sessions')
        .where({ user_id: userId })
        .whereNull('ended_at')
        .whereNot('task_id', taskId)
        .select('*');
      for (const s of otherOpen) {
        await db('task_sessions').where({ id: s.id }).update({ ended_at: now });
        const startMs = isNaN(Number(s.started_at)) ? new Date(s.started_at).getTime() : Number(s.started_at);
        const hrs = (now.getTime() - startMs) / 3600000;
        if (hrs >= 0.001) {
          const otherTask = await db('tasks').where({ id: s.task_id }).select('project_id').first();
          const userRec = await db('users').where({ id: userId }).select('monthly_salary').first();
          const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
          const hourlyRate = userRec?.monthly_salary ? Number(userRec.monthly_salary) / daysInMonth / 7 : null;
          if (otherTask) {
            await db('time_logs').insert({
              task_id: s.task_id,
              project_id: otherTask.project_id,
              user_id: userId,
              log_date: s.session_date,
              hours: Math.round(hrs * 1000) / 1000,
              notes: 'Auto-paused when another task was started',
              task_session_id: s.id,
              hourly_rate: hourlyRate,
            });
          }
        }
      }

      // Insert new session
      await db('task_sessions').insert({
        task_id: taskId,
        user_id: userId,
        started_at: now,
        ended_at: null,
        session_date: today,
      });

      // Don't touch status if task is already in_review (reviewer timing their review)
      const currentTask = await db('tasks').where({ id: taskId }).select('status').first();
      if (currentTask?.status !== 'in_review') {
        await db('tasks').where({ id: taskId }).update({ status: 'in_progress' });
      }

    } else if (action === 'pause') {
      const pauseSession = await db('task_sessions')
        .where({ task_id: taskId, user_id: userId }).whereNull('ended_at').first();
      await db('task_sessions')
        .where({ task_id: taskId, user_id: userId }).whereNull('ended_at').update({ ended_at: now });
      if (pauseSession) {
        const pauseHours = (now.getTime() - new Date(pauseSession.started_at).getTime()) / 3600000;
        if (pauseHours >= 0.01) {
          const pauseTask = await db('tasks').where({ id: taskId }).select('project_id').first();
          if (pauseTask) {
            const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
            const userRec = await db('users').where({ id: userId }).select('monthly_salary').first();
            const hourlyRate = userRec?.monthly_salary ? Number(userRec.monthly_salary) / daysInMonth / 7 : null;
            await db('time_logs').insert({
              task_id: taskId, project_id: pauseTask.project_id, user_id: userId,
              task_session_id: pauseSession.id,
              log_date: today, hours: Math.round(pauseHours * 100) / 100,
              hourly_rate: hourlyRate,
            });
          }
        }
      }

    } else if (action === 'done') {
      // End the active session and write time_log
      const doneSession = await db('task_sessions')
        .where({ task_id: taskId, user_id: userId }).whereNull('ended_at').first();
      await db('task_sessions')
        .where({ task_id: taskId, user_id: userId }).whereNull('ended_at').update({ ended_at: now });
      if (doneSession) {
        const doneHours = (now.getTime() - new Date(doneSession.started_at).getTime()) / 3600000;
        if (doneHours >= 0.01) {
          const doneTask = await db('tasks').where({ id: taskId }).select('project_id').first();
          if (doneTask) {
            const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
            const userRec = await db('users').where({ id: userId }).select('monthly_salary').first();
            const hourlyRate = userRec?.monthly_salary ? Number(userRec.monthly_salary) / daysInMonth / 7 : null;
            await db('time_logs').insert({
              task_id: taskId, project_id: doneTask.project_id, user_id: userId,
              task_session_id: doneSession.id,
              log_date: today, hours: Math.round(doneHours * 100) / 100,
              hourly_rate: hourlyRate,
            });
          }
        }
      }

      const task = await db('tasks').where({ id: taskId }).first();

      // XLR8 tickets manage their own status and approval via /api/xlr8/tickets/:id/done
      if (task?.ticket_type_id) { res.json({ message: 'Session closed' }); return; }

      await db('tasks').where({ id: taskId }).update({ status: 'in_review' });

      // Auto-submit for approval if no active approval exists
      const existingApproval = await db('approvals')
        .where({ task_id: taskId })
        .whereNotIn('status', ['approved', 'rejected'])
        .first();

      if (!existingApproval && task) {
        // Check for a custom approval flow on this task
        const customFlow = await db('task_approval_flow')
          .where({ task_id: taskId })
          .orderBy('position')
          .select('user_id', 'position');

        if (customFlow.length > 0) {
          // ── Custom sequential flow ──────────────────────────────
          await db('approvals').insert({
            task_id: taskId,
            title: task.title,
            project_id: task.project_id,
            submitted_by: userId,
            status: 'pending_custom',
            workflow_type: 'custom',
            current_step: 0,
          });
          const firstApprover = customFlow[0];
          if (firstApprover.user_id !== userId) {
            await createNotification(firstApprover.user_id, `"${task.title}" is waiting for your approval`, 'approval', task.project_id);
          }
        } else {
          // ── Legacy role-based flow ──────────────────────────────
          const userRole = req.user!.role;

          const clientCount = await db('project_members as pm')
            .join('users as u', 'pm.user_id', 'u.id')
            .where('pm.project_id', task.project_id)
            .where('u.role', 'client')
            .count('u.id as cnt')
            .first();
          const hasClient = Number(clientCount?.cnt ?? 0) > 0;

          let workflowType: string;
          if (userRole === 'employee') workflowType = 'employee';
          else if (userRole === 'manager') workflowType = 'manager';
          else workflowType = hasClient ? 'admin_with_client' : 'admin_no_client';

          const FIRST_STAGE: Record<string, { status: string; role: string } | null> = {
            employee:          { status: 'pending_manager', role: 'manager' },
            manager:           { status: 'pending_admin',   role: 'admin'   },
            admin_with_client: { status: 'pending_client',  role: 'client'  },
            admin_no_client:   null,
          };

          const firstStage = FIRST_STAGE[workflowType];

          if (firstStage) {
            await db('approvals').insert({
              task_id: taskId,
              title: task.title,
              project_id: task.project_id,
              submitted_by: userId,
              status: firstStage.status,
              workflow_type: workflowType,
            });

            if (firstStage.role === 'manager') {
              const managers = await db('users as u')
                .join('project_members as pm', function (this: any) {
                  this.on('pm.user_id', 'u.id').andOn('pm.project_id', db.raw('?', [task.project_id]));
                })
                .where('u.role', 'manager')
                .select('u.id');
              for (const m of managers) {
                if (m.id !== userId)
                  await createNotification(m.id, `"${task.title}" is ready for your review`, 'approval', task.project_id);
              }
            } else if (firstStage.role === 'admin') {
              const admins = await db('users as u')
                .join('project_members as pm', function (this: any) {
                  this.on('pm.user_id', 'u.id').andOn('pm.project_id', db.raw('?', [task.project_id]));
                })
                .where('u.role', 'admin')
                .select('u.id');
              for (const a of admins) {
                if (a.id !== userId)
                  await createNotification(a.id, `"${task.title}" is ready for your review`, 'approval', task.project_id);
              }
            } else if (firstStage.role === 'client') {
              const clients = await db('project_members as pm')
                .join('users as u', 'pm.user_id', 'u.id')
                .where('pm.project_id', task.project_id)
                .where('u.role', 'client')
                .select('u.id');
              for (const c of clients)
                await createNotification(c.id, `"${task.title}" is ready for your review`, 'approval', task.project_id);
            }
          } else {
            await db('tasks').where({ id: taskId }).update({ status: 'completed' });
          }
        }
      }

      // Notify task creator
      if (task && task.created_by !== userId) {
        const me = await db('users').where({ id: userId }).first();
        await createNotification(
          task.created_by,
          `${me?.name} marked "${task.title}" ready for review`,
          'task',
          task.project_id
        );
      }
    }

    res.json({ message: 'OK' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
