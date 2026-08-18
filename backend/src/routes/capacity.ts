import { Router, Response } from 'express';
import { getDB } from '../db';
import { authenticate, requireRoles, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate);

// GET /api/capacity/daily — current user's daily capacity summary
router.get('/daily', async (req: AuthRequest, res: Response) => {
  const db = getDB();
  const userId = req.user!.id;
  const today = new Date().toISOString().slice(0, 10);
  const now = Date.now();

  try {
    // Close stale open sessions from previous days
    await db('task_sessions')
      .where('user_id', userId)
      .whereNull('ended_at')
      .where('session_date', '<', today)
      .update({ ended_at: db.raw('started_at') });

    // Close open sessions for tasks that are in_review or completed — timer must not run during review
    // Exclude XLR8 tickets (ticket_type_id IS NOT NULL) — they manage their own status lifecycle
    const inReviewTaskIds = await db('task_sessions as ts')
      .join('tasks as t', 'ts.task_id', 't.id')
      .where('ts.user_id', userId)
      .whereNull('ts.ended_at')
      .whereIn('t.status', ['in_review', 'completed'])
      .whereNull('t.ticket_type_id')
      .pluck('ts.task_id');
    if (inReviewTaskIds.length) {
      await db('task_sessions')
        .where('user_id', userId)
        .whereNull('ended_at')
        .whereIn('task_id', inReviewTaskIds)
        .update({ ended_at: new Date() });
    }

    // All sessions today for this user
    const sessions = await db('task_sessions')
      .where({ user_id: userId, session_date: today })
      .select('*');

    let trackedSeconds = 0;
    let activeTaskId: number | null = null;
    let activeSessionStart: string | null = null;

    for (const s of sessions) {
      const start = new Date(s.started_at).getTime();
      const end = s.ended_at ? new Date(s.ended_at).getTime() : now;
      trackedSeconds += (end - start) / 1000;
      if (!s.ended_at) {
        activeTaskId = s.task_id;
        activeSessionStart = s.started_at;
      }
    }

    // Tasks where this user is an employee (not just manager oversight)
    const assignedTasks = await db('tasks as t')
      .join('task_assignees as ta', 'ta.task_id', 't.id')
      .leftJoin('projects as p', 't.project_id', 'p.id')
      .where('ta.user_id', userId)
      .where(function () {
        this.whereNot('ta.acceptance_status', 'declined').orWhereNull('ta.acceptance_status');
      })
      .where(function () {
        this.whereIn('ta.assignee_role', ['employee']).orWhereNull('ta.assignee_role');
      })
      .whereNotIn('t.status', ['completed'])
      .select(
        't.id', 't.title', 't.status', 't.due_date', 't.due_time', 't.estimated_hours',
        'p.name as project_name',
        'ta.acceptance_status', 'ta.assignee_role', 't.ticket_type_id'
      );

    // XLR8 tickets assigned to this user via xlr8_assignee_id
    const xlr8Tasks = await db('tasks as t')
      .leftJoin('projects as p', 't.project_id', 'p.id')
      .where('t.xlr8_assignee_id', userId)
      .whereIn('t.xlr8_status', ['pending_assignee', 'in_progress'])
      .whereNotIn('t.status', ['completed'])
      .select(
        't.id', 't.title', 't.status', 't.due_date', 't.due_time', 't.estimated_hours',
        'p.name as project_name', 't.ticket_type_id',
        db.raw("CASE WHEN t.xlr8_status = 'pending_assignee' THEN 'pending' ELSE 'accepted' END as acceptance_status"),
        db.raw("'employee' as assignee_role")
      );

    // Merge XLR8 tickets (avoid duplicates if somehow in both)
    const xlr8Ids = new Set(xlr8Tasks.map((t: any) => t.id));
    const mergedAssigned = [...assignedTasks.filter((t: any) => !xlr8Ids.has(t.id)), ...xlr8Tasks];

    // Also include tasks this user reviewed today (session exists but not assigned)
    const assignedTaskIds = mergedAssigned.map((t: any) => t.id);
    const reviewSessions = await db('task_sessions as ts')
      .join('tasks as t', 'ts.task_id', 't.id')
      .leftJoin('projects as p', 't.project_id', 'p.id')
      .where('ts.user_id', userId)
      .where('ts.session_date', today)
      .whereNotIn('ts.task_id', assignedTaskIds.length ? assignedTaskIds : [0])
      .whereNotIn('t.status', ['completed'])
      .select(
        't.id', 't.title', 't.status', 't.due_date', 't.due_time', 't.estimated_hours',
        'p.name as project_name',
        db.raw('NULL as acceptance_status'),
        db.raw("'review' as assignee_role")
      )
      .groupBy('t.id');

    const allTasks = [...mergedAssigned, ...reviewSessions];
    const taskIds = allTasks.map((t: any) => t.id);

    const taskSessions = taskIds.length
      ? await db('task_sessions')
          .whereIn('task_id', taskIds)
          .where({ user_id: userId, session_date: today })
          .select('*')
      : [];

    const rejectedSet = new Set<number>(
      assignedTaskIds.length
        ? (await db('approvals').whereIn('task_id', assignedTaskIds).where('status', 'rejected').select('task_id'))
            .map((r: any) => Number(r.task_id))
        : []
    );

    const tasks = allTasks.map((task: any) => {
      const ts = taskSessions.filter((s: any) => s.task_id === task.id);
      let taskSeconds = 0;
      let timerRunning = false;

      for (const s of ts) {
        const start = new Date(s.started_at).getTime();
        const end = s.ended_at ? new Date(s.ended_at).getTime() : now;
        taskSeconds += (end - start) / 1000;
        if (!s.ended_at) timerRunning = true;
      }

      return { ...task, tracked_seconds_today: taskSeconds, timer_running: timerRunning, has_rejected_approval: rejectedSet.has(Number(task.id)) };
    });

    res.json({
      tracked_seconds: Math.round(trackedSeconds),
      capacity_seconds: 7 * 3600,
      active_task_id: activeTaskId,
      active_session_start: activeSessionStart,
      tasks,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/capacity/check/:userId — check a user's assigned-hours load (for capacity warnings)
router.get('/check/:userId', async (req: AuthRequest, res: Response) => {
  const db = getDB();
  const targetUserId = Number(req.params.userId);

  try {
    const row = await db('tasks as t')
      .join('task_assignees as ta', 'ta.task_id', 't.id')
      .where('ta.user_id', targetUserId)
      .whereNotIn('ta.acceptance_status', ['declined'])
      .whereNotIn('t.status', ['completed', 'in_review'])
      .whereNotNull('t.estimated_hours')
      .sum('t.estimated_hours as total')
      .first();

    const estimatedHours = Number(row?.total ?? 0);

    res.json({
      user_id: targetUserId,
      estimated_hours_assigned: estimatedHours,
      capacity_hours: 7,
      remaining_hours: Math.max(0, 7 - estimatedHours),
      over_capacity: estimatedHours >= 7,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/capacity/team — all employees' daily capacity (manager/admin only)
router.get('/team', requireRoles('admin', 'manager'), async (req: AuthRequest, res: Response) => {
  const db = getDB();
  const today = (req.query.date as string) || new Date().toISOString().slice(0, 10);
  const now = Date.now();

  try {
    let empQuery = db('users')
      .whereIn('role', ['employee', 'manager'])
      .orderBy('name')
      .select('id', 'name', 'avatar_color', 'role', 'pod');

    if (req.user!.role === 'manager') {
      // Look up the manager's own pod and filter to that pod only
      const mgr = await db('users').where({ id: req.user!.id }).select('pod').first();
      if (mgr?.pod) empQuery = empQuery.where('pod', mgr.pod);
    } else if (req.query.pod) {
      // Admin can pass ?pod=pod1 or ?pod=pod2 to filter
      empQuery = empQuery.where('pod', req.query.pod as string);
    }

    const employees = await empQuery;

    const employeeIds = employees.map((e: any) => e.id);
    if (!employeeIds.length) { res.json([]); return; }

    const allSessions = await db('task_sessions')
      .whereIn('user_id', employeeIds)
      .where({ session_date: today })
      .select('*');

    const isOverdue = req.query.overdue === 'true';

    let taskQuery = db('tasks as t')
      .join('task_assignees as ta', 'ta.task_id', 't.id')
      .leftJoin('projects as p', 't.project_id', 'p.id')
      .whereIn('ta.user_id', employeeIds)
      .whereNotIn('ta.acceptance_status', ['declined'])
      .where(function () {
        this.whereIn('ta.assignee_role', ['employee']).orWhereNull('ta.assignee_role');
      })
      .whereNotIn('t.status', ['completed']);

    if (isOverdue) {
      taskQuery = taskQuery.where('t.due_date', '<', today).whereNotNull('t.due_date');
    } else {
      taskQuery = taskQuery.where('t.due_date', today);
    }

    const regularTasks = await taskQuery.select(
        't.id', 't.title', 't.status', 't.due_date', 't.due_time', 't.estimated_hours',
        'p.name as project_name',
        'ta.user_id as assignee_user_id',
        'ta.acceptance_status', 'ta.assignee_role'
      );

    // XLR8 tickets assigned via xlr8_assignee_id — always show regardless of due date
    const xlr8TeamTasks = await db('tasks as t')
      .leftJoin('projects as p', 't.project_id', 'p.id')
      .whereIn('t.xlr8_assignee_id', employeeIds)
      .whereIn('t.xlr8_status', ['pending_assignee', 'in_progress'])
      .select(
        't.id', 't.title', 't.status', 't.due_date', 't.due_time', 't.estimated_hours',
        'p.name as project_name',
        't.xlr8_assignee_id as assignee_user_id',
        db.raw("CASE WHEN t.xlr8_status = 'pending_assignee' THEN 'pending' ELSE 'accepted' END as acceptance_status"),
        db.raw("'employee' as assignee_role")
      );

    // Merge, avoiding duplicates
    const regularIds = new Set(regularTasks.map((t: any) => `${t.id}-${t.assignee_user_id}`));
    const allAssignedTasks = [
      ...regularTasks,
      ...xlr8TeamTasks.filter((t: any) => !regularIds.has(`${t.id}-${t.assignee_user_id}`)),
    ];

    // Also include tasks that managers/employees timed today but aren't formally assigned to
    // (e.g. a manager reviewing a pending_manager XLR8 ticket)
    const sessionTaskIds = [...new Set(allSessions.map((s: any) => s.task_id))];
    const assignedTaskIds = new Set(allAssignedTasks.map((t: any) => `${t.id}-${t.assignee_user_id ?? 0}`));
    const extraSessionTasks = sessionTaskIds.length
      ? await db('tasks as t')
          .leftJoin('projects as p', 't.project_id', 'p.id')
          .whereIn('t.id', sessionTaskIds)
          .whereNotIn('t.status', ['completed'])
          .select('t.id', 't.title', 't.status', 't.due_date', 't.due_time', 't.estimated_hours', 'p.name as project_name')
      : [];

    // For each session, attach the task to the user who timed it (if not already in their task list)
    const extraTasks: any[] = [];
    for (const s of allSessions) {
      const task = extraSessionTasks.find((t: any) => t.id === s.task_id);
      if (!task) continue;
      const key = `${task.id}-${s.user_id}`;
      if (!assignedTaskIds.has(key)) {
        assignedTaskIds.add(key);
        extraTasks.push({ ...task, assignee_user_id: s.user_id, acceptance_status: 'accepted', assignee_role: 'manager' });
      }
    }
    const mergedTasks = [...allAssignedTasks, ...extraTasks];

    const allTaskIds = [...new Set(mergedTasks.map((t: any) => t.id))];
    const allTaskSessions = allTaskIds.length
      ? await db('task_sessions')
          .whereIn('task_id', allTaskIds)
          .where({ session_date: today })
          .select('*')
      : [];

    const result = employees.map((emp: any) => {
      const userSessions = allSessions.filter((s: any) => s.user_id === emp.id);
      let trackedSeconds = 0;
      let activeTaskId: number | null = null;

      for (const s of userSessions) {
        const start = new Date(s.started_at).getTime();
        const end = s.ended_at ? new Date(s.ended_at).getTime() : now;
        trackedSeconds += (end - start) / 1000;
        if (!s.ended_at) activeTaskId = s.task_id;
      }

      const userTasks = mergedTasks.filter((t: any) => t.assignee_user_id === emp.id);
      const activeTask = activeTaskId ? userTasks.find((t: any) => t.id === activeTaskId) : null;

      const tasks = userTasks.map((task: any) => {
        const ts = allTaskSessions.filter((s: any) => s.task_id === task.id && s.user_id === emp.id);
        let taskSeconds = 0;
        let timerRunning = false;
        for (const s of ts) {
          const start = new Date(s.started_at).getTime();
          const end = s.ended_at ? new Date(s.ended_at).getTime() : now;
          taskSeconds += (end - start) / 1000;
          if (!s.ended_at) timerRunning = true;
        }
        return { ...task, tracked_seconds_today: Math.round(taskSeconds), timer_running: timerRunning };
      });

      return {
        user_id: emp.id,
        name: emp.name,
        avatar_color: emp.avatar_color,
        role: emp.role,
        pod: emp.pod ?? null,
        tracked_seconds: Math.round(trackedSeconds),
        capacity_seconds: 7 * 3600,
        active_task_id: activeTaskId,
        active_task_title: activeTask?.title ?? null,
        tasks,
      };
    });

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
