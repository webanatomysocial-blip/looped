import { waitingOn, startIfAccepted } from './xlr8';
import { Router, Response } from 'express';
import { getDB } from '../db';
import { authenticate, requireRoles, AuthRequest } from '../middleware/auth';

const router = Router();

// Of these tasks, the ones a manager actually works on: assigned/created by them, a project they're a member of,
// a project in their pod, or a task with someone from their pod assigned.
async function managerTaskIds(db: any, userId: number, taskIds: number[]): Promise<Set<number>> {
  if (!taskIds.length) return new Set();
  const me = await db('users').where({ id: userId }).select('pod').first();
  const pod = me?.pod ?? null;
  const rows = await db('tasks as t')
    .leftJoin('projects as p', 'p.id', 't.project_id')
    .whereIn('t.id', taskIds)
    .where(function (this: any) {
      this.where('t.xlr8_assignee_id', userId)
        .orWhere('t.created_by', userId)
        .orWhereExists(function (this: any) { this.from('task_assignees as ta').whereRaw('ta.task_id = t.id').where('ta.user_id', userId); })
        .orWhereExists(function (this: any) { this.from('project_members as pm').whereRaw('pm.project_id = t.project_id').where('pm.user_id', userId); });
      if (pod) {
        this.orWhere('p.pod', pod)
          .orWhereExists(function (this: any) {
            this.from('task_assignees as ta2').join('users as u2', 'u2.id', 'ta2.user_id')
              .whereRaw('ta2.task_id = t.id').where('u2.pod', pod);
          });
      }
    })
    .pluck('t.id');
  return new Set(rows.map(Number));
}

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
      .where((q: any) => q.whereNull('ta.skipped').orWhere('ta.skipped', 0))
      .whereNull('t.ticket_type_id')
      .whereNull('t.recurring_task_id')
      .whereNull('t.crosspod_pods').whereNull('t.crosspod_note')
      .where(function () {
        this.whereNot('ta.acceptance_status', 'declined').orWhereNull('ta.acceptance_status');
      })
      .where(function () {
        this.whereIn('ta.assignee_role', ['employee']).orWhereNull('ta.assignee_role');
      })
      .whereNotIn('t.status', ['completed', 'draft'])
      // Unapproved requests: only the person who raised them can already work on them
      .where(function () { this.whereNot('t.status', 'pending_approval').orWhere('t.created_by', userId); })
      .select(
        't.id', 't.title', 't.status', 't.due_date', 't.due_time', 't.estimated_hours', 't.priority',
        'p.name as project_name',
        'ta.acceptance_status', 'ta.assignee_role', 't.ticket_type_id'
      );

    // XLR8 tickets assigned to this user via xlr8_assignee_id (current stage)
    const xlr8Tasks = await db('tasks as t')
      .leftJoin('projects as p', 't.project_id', 'p.id')
      .leftJoin('task_assignees as ta_est', function () {
        this.on('ta_est.task_id', 't.id').on('ta_est.stage_idx', 't.xlr8_stage_idx');
      })
      .where('t.xlr8_assignee_id', userId)
      .whereIn('t.xlr8_status', ['pending_assignee', 'in_progress', 'pending_manager', 'pending_admin'])
      .whereNotIn('t.status', ['completed', 'draft'])
      .select(
        't.id', 't.title', 't.status', 't.due_date', 't.due_time', 't.estimated_hours',
        'p.name as project_name', 't.ticket_type_id', 't.xlr8_stage_idx', 't.xlr8_status', 't.xlr8_assignee_id',
        db.raw("CASE WHEN t.xlr8_status = 'pending_assignee' THEN 'pending' WHEN t.xlr8_status IN ('pending_manager','pending_admin') THEN 'review' ELSE 'accepted' END as acceptance_status"),
        db.raw("'employee' as assignee_role"),
        db.raw('MIN(ta_est.est_hours) as stage_est_hours')
      )
      .groupBy('t.id');

    // Current-stage person who already accepted, waiting for the rest of the ticket's people
    for (const t of xlr8Tasks as any[]) {
      if (t.xlr8_status !== 'pending_assignee') continue;
      const mine = await db('task_assignees').where({ task_id: t.id, stage_idx: t.xlr8_stage_idx ?? 0, user_id: userId }).first();
      if (mine?.acceptance_status !== 'accepted') continue;
      const waiting = await waitingOn(db, t.id, t.xlr8_stage_idx ?? 0);
      if (waiting.length) { t.waiting_on = waiting; continue; }
      // Everyone has accepted but the start was missed — start it now and show it as accepted
      await startIfAccepted(db, t.id, req.user!);
      const now = await db('tasks').where({ id: t.id }).select('xlr8_status', 'status').first();
      if (now?.xlr8_status === 'in_progress') Object.assign(t, { xlr8_status: 'in_progress', status: now.status, acceptance_status: 'accepted' });
    }

    // For admin/manager: also include pending_admin/pending_manager XLR8 tasks needing their review (where xlr8_assignee_id may be null)
    let pendingReviewForRole: any[] = (req.user!.role === 'admin' || req.user!.role === 'manager') ? await db('tasks as t')
      .leftJoin('projects as p', 't.project_id', 'p.id')
      .leftJoin('users as xa', 'xa.id', 't.xlr8_assignee_id')
      .where('t.xlr8_status', req.user!.role === 'admin' ? 'pending_admin' : 'pending_manager')
      // Stages reviewed by an employee belong to that employee, not the manager queue
      .where((q: any) => q.whereNull('xa.role').orWhereNot('xa.role', 'employee'))
      .whereNotIn('t.status', ['completed'])
      .whereNotNull('t.ticket_type_id')
      .select(
        't.id', 't.title', 't.status', 't.due_date', 't.due_time', 't.estimated_hours',
        'p.name as project_name', 't.ticket_type_id', 't.xlr8_stage_idx', 't.xlr8_status', 't.xlr8_assignee_id',
        db.raw("'review' as acceptance_status"),
        db.raw("'employee' as assignee_role"),
        db.raw('NULL as stage_est_hours')
      ) : [];

    if (req.user!.role === 'manager' && (pendingReviewForRole as any[]).length) {
      const mine = await managerTaskIds(db, userId, (pendingReviewForRole as any[]).map((t: any) => Number(t.id)));
      pendingReviewForRole = (pendingReviewForRole as any[]).filter((t: any) => mine.has(Number(t.id)));
    }

    // XLR8 future-stage assignments waiting for this user's acceptance
    const xlr8Ids = new Set(xlr8Tasks.map((t: any) => t.id));
    const reviewRoleIds = new Set((pendingReviewForRole as any[]).map((t: any) => t.id));
    // Only show pending-acceptance for employee/manager roles, not admin/client
    const pendingStageRows = req.user!.role === 'admin' || req.user!.role === 'client' ? [] : await db('task_assignees as ta')
      .join('tasks as t', 't.id', 'ta.task_id')
      .leftJoin('projects as p', 't.project_id', 'p.id')
      .where('ta.user_id', userId)
      .where('ta.acceptance_status', 'pending')
      .where((q: any) => q.whereNull('ta.skipped').orWhere('ta.skipped', 0))
      // Review stages are only asked when work reaches them
      .whereNotIn('ta.assignee_role', ['admin', 'client', 'manager'])
      .whereNotNull('ta.stage_idx')
      .whereNotNull('t.ticket_type_id')
      .whereNotIn('t.status', ['completed', 'draft', 'pending_approval'])
      .whereNull('t.crosspod_pods')
      .whereNotIn('ta.task_id', [...xlr8Ids, ...reviewRoleIds].length ? [...xlr8Ids, ...reviewRoleIds] : [0])
      .where(function () {
        // Future stages: always show pre-assignment prompt
        this.whereRaw('ta.stage_idx > t.xlr8_stage_idx')
          // Current stage: only show if task is still pending assignment (not already in_progress after rejection)
          .orWhere(function () {
            this.whereRaw('ta.stage_idx = t.xlr8_stage_idx').where('t.xlr8_status', 'pending_assignee');
          });
      })
      .select(
        't.id', 't.title', 't.status', 't.due_date', 't.due_time', 't.estimated_hours',
        'p.name as project_name', 't.ticket_type_id', 't.xlr8_stage_idx', 't.xlr8_status', 't.xlr8_assignee_id',
        db.raw("'pending' as acceptance_status"),
        db.raw("'employee' as assignee_role"),
        'ta.est_hours as stage_est_hours', 'ta.stage_idx as my_stage_idx',
        db.raw('CASE WHEN ta.stage_idx > t.xlr8_stage_idx THEN 1 ELSE 0 END as future_stage')
      );

    // XLR8 future stages this user already accepted — show as upcoming so they don't vanish after accepting
    const pendingStageIds = new Set((pendingStageRows as any[]).map((r: any) => r.id));
    const upcomingStageRows = req.user!.role === 'admin' || req.user!.role === 'client' ? [] : await db('task_assignees as ta')
      .join('tasks as t', 't.id', 'ta.task_id')
      .leftJoin('projects as p', 't.project_id', 'p.id')
      .where('ta.user_id', userId)
      .where('ta.acceptance_status', 'accepted')
      .whereNotIn('ta.assignee_role', ['admin', 'client'])
      .andWhere((q: any) => q.whereNull('ta.skipped').orWhere('ta.skipped', 0))
      .whereNotNull('t.ticket_type_id')
      .whereNotIn('t.status', ['completed', 'draft', 'pending_approval'])
      .whereNull('t.crosspod_pods')
      .whereNotIn('t.xlr8_status', ['completed'])
      .whereRaw('ta.stage_idx > t.xlr8_stage_idx')
      .whereNotIn('ta.task_id', [...xlr8Ids, ...reviewRoleIds, ...pendingStageIds].length ? [...xlr8Ids, ...reviewRoleIds, ...pendingStageIds] : [0])
      .select(
        't.id', 't.title', 't.status', 't.due_date', 't.due_time', 't.estimated_hours',
        'p.name as project_name', 't.ticket_type_id', 't.xlr8_stage_idx', 't.xlr8_status', 't.xlr8_assignee_id',
        db.raw("'upcoming' as acceptance_status"),
        db.raw("'employee' as assignee_role"),
        'ta.est_hours as stage_est_hours', 'ta.stage_idx as my_stage_idx'
      );
    const upcomingDeduped = Object.values(
      (upcomingStageRows as any[]).reduce((acc: any, row: any) => {
        if (!acc[row.id] || row.my_stage_idx < acc[row.id].my_stage_idx) acc[row.id] = row;
        return acc;
      }, {})
    );

    // Deduplicate pendingStageRows by task id (a user may have multiple stage rows)
    const pendingStageDeduped = Object.values(
      (pendingStageRows as any[]).reduce((acc: any, row: any) => {
        if (!acc[row.id] || row.my_stage_idx < acc[row.id].my_stage_idx) acc[row.id] = row;
        return acc;
      }, {})
    );

    // Merge XLR8 tickets (avoid duplicates)
    const pendingIds = new Set(pendingStageDeduped.map((t: any) => (t as any).id));
    const mergedAssigned = [
      ...assignedTasks.filter((t: any) => !xlr8Ids.has(t.id) && !pendingIds.has(t.id) && !reviewRoleIds.has(t.id)),
      ...xlr8Tasks,
      ...pendingStageDeduped,
      ...upcomingDeduped,
      ...(pendingReviewForRole as any[]).filter((t: any) => !xlr8Ids.has(t.id)),
    ];

    // Also include tasks this user reviewed today (session exists but not assigned)
    const assignedTaskIds = mergedAssigned.map((t: any) => t.id);
    const reviewSessions = await db('task_sessions as ts')
      .join('tasks as t', 'ts.task_id', 't.id')
      .leftJoin('projects as p', 't.project_id', 'p.id')
      .where('ts.user_id', userId)
      .where('ts.session_date', today)
      .whereNotIn('ts.task_id', assignedTaskIds.length ? assignedTaskIds : [0])
      .whereNotIn('ts.task_id', xlr8Ids.size ? [...xlr8Ids] : [0])
      .whereNotIn('t.status', ['completed'])
      .where(function () {
        this.whereNull('t.ticket_type_id').orWhere(function () {
          this.whereIn('t.xlr8_status', ['pending_assignee', 'in_progress'])
            // exclude XLR8 tasks where this user's stage is already past (they already did their work)
            .whereNotExists(function () {
              this.from('task_assignees as ta2')
                .whereRaw('ta2.task_id = ts.task_id')
                .where('ta2.user_id', userId)
                .whereNotNull('ta2.stage_idx')
                .whereRaw('ta2.stage_idx < t.xlr8_stage_idx');
            });
        });
      })
      .select(
        't.id', 't.title', 't.status', 't.due_date', 't.due_time', 't.estimated_hours',
        'p.name as project_name',
        db.raw('NULL as acceptance_status'),
        db.raw("'review' as assignee_role")
      )
      .groupBy('t.id');

    // Completed tasks due today or worked on today (for progress %)
    const completedToday = await db('tasks as t')
      .leftJoin('projects as p', 't.project_id', 'p.id')
      .where('t.status', 'completed')
      .where(function () {
        this.where('t.due_date', today)
          .orWhereExists(function () {
            this.from('task_sessions as ts')
              .whereRaw('ts.task_id = t.id')
              .where({ 'ts.user_id': userId, 'ts.session_date': today });
          })
          .orWhereExists(function () {
            this.from('task_assignees as ta')
              .whereRaw('ta.task_id = t.id')
              .where('ta.user_id', userId);
          });
      })
      .select('t.id', 't.title', 't.status', 't.due_date', 't.ticket_type_id', 'p.name as project_name')
      .then((rows: any[]) => rows.map((r: any) => ({ ...r, tracked_seconds_today: 0, timer_running: false, acceptance_status: 'accepted' })));

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

    // Fetch latest rejection comment for XLR8 tasks sent back for rework (pending_assignee or in_progress after a decline)
    const reworkCandidateIds = allTasks.filter((t: any) => t.ticket_type_id && ['pending_assignee', 'in_progress'].includes(t.xlr8_status)).map((t: any) => t.id);
    const rejectionLogs: Record<number, { actor: string; comment: string; to_stage: string | null }> = {};
    if (reworkCandidateIds.length) {
      const logs = await db('xlr8_ticket_log as l')
        .join('users as u', 'l.actor_id', 'u.id')
        .whereIn('l.task_id', reworkCandidateIds)
        .whereIn('l.action', ['manager_declined', 'admin_declined'])
        .orderBy('l.created_at', 'desc')
        .select('l.task_id', 'l.comment', 'u.name as actor', 'l.created_at', 'l.from_stage_idx', 'l.to_stage_idx');
      // Only attach rejection_log if the decline happened AFTER the last approval/start
      // so we don't show stale rejections for tasks that have since progressed
      const lastProgressLogs = await db('xlr8_ticket_log as l')
        .whereIn('l.task_id', reworkCandidateIds)
        .whereIn('l.action', ['manager_approved', 'admin_approved', 'next_stage', 'employee_accepted'])
        .orderBy('l.created_at', 'desc')
        .select('l.task_id', 'l.created_at');
      const lastProgressAt: Record<number, number> = {};
      for (const r of lastProgressLogs) {
        if (!lastProgressAt[r.task_id]) lastProgressAt[r.task_id] = new Date(r.created_at).getTime();
      }
      // This user's own work on each task — once they redo their stage, the rejection is handled
      const myWorkLogs = await db('xlr8_ticket_log')
        .whereIn('task_id', reworkCandidateIds)
        .where('actor_id', userId)
        .whereIn('action', ['work_done', 'employee_accepted'])
        .select('task_id', 'created_at');
      const myLastWorkAt: Record<number, number> = {};
      for (const r of myWorkLogs) {
        const at = new Date(r.created_at).getTime();
        if (at > (myLastWorkAt[r.task_id] ?? 0)) myLastWorkAt[r.task_id] = at;
      }
      // Starting a timer on the rework also counts as having picked it up
      for (const sRow of await db('task_sessions').whereIn('task_id', reworkCandidateIds).where('user_id', userId).select('task_id', 'started_at')) {
        const at = typeof sRow.started_at === 'number' || /^\d+$/.test(String(sRow.started_at)) ? Number(sRow.started_at) : new Date(sRow.started_at).getTime();
        if (at > (myLastWorkAt[sRow.task_id] ?? 0)) myLastWorkAt[sRow.task_id] = at;
      }
      const taskById = new Map<number, any>(allTasks.map((t: any) => [t.id, t]));
      // Name of the stage each decline sent the ticket back to, e.g. "Stage 1 (UI/UX Designer)"
      const typeIds = [...new Set(allTasks.map((t: any) => t.ticket_type_id).filter(Boolean))];
      const stagesByType: Record<number, any[]> = {};
      for (const tt of typeIds.length ? await db('xlr8_ticket_types').whereIn('id', typeIds).select('id', 'stages') : []) {
        try { stagesByType[tt.id] = typeof tt.stages === 'string' ? JSON.parse(tt.stages) : (tt.stages || []); } catch { stagesByType[tt.id] = []; }
      }
      const stageLabel = (typeId: number, idx: number | null) => {
        if (idx == null) return null;
        const st = stagesByType[typeId]?.[idx];
        const name = st?.type === 'admin' ? 'Admin Review' : st?.category_name || (st?.reviewer ? 'Manager Review' : null);
        return name ? `Stage ${idx + 1} (${name})` : `Stage ${idx + 1}`;
      };
      const seen = new Set<number>();
      for (const row of logs) {
        if (seen.has(row.task_id)) continue;
        seen.add(row.task_id); // only the latest decline counts
        const declineAt = new Date(row.created_at ?? 0).getTime();
        const progressAt = lastProgressAt[row.task_id] ?? 0;
        // Later stages that the decline sent back past also have to redo their work,
        // so their assignee sees why the task is back until they submit again
        const t = taskById.get(row.task_id);
        const cur = t?.xlr8_stage_idx;
        const redoneDownstream = t?.xlr8_assignee_id === userId && cur != null &&
          row.to_stage_idx != null && row.from_stage_idx != null &&
          cur > row.to_stage_idx && cur <= row.from_stage_idx &&
          (myLastWorkAt[row.task_id] ?? 0) < declineAt;
        const pickedUp = (myLastWorkAt[row.task_id] ?? 0) > declineAt;
        if ((declineAt > progressAt || redoneDownstream) && !pickedUp) rejectionLogs[row.task_id] = { actor: row.actor, comment: row.comment, to_stage: stageLabel(t?.ticket_type_id, row.to_stage_idx) };
      }
    }

    // Fetch who last approved (advanced stage) for in_progress XLR8 tasks — used for "stage active" banner
    const inProgressXlr8Ids = allTasks.filter((t: any) => t.xlr8_status === 'in_progress' && t.ticket_type_id).map((t: any) => t.id);
    const stageApprovedBy: Record<number, string> = {};
    if (inProgressXlr8Ids.length) {
      const approvals = await db('xlr8_ticket_log as l')
        .join('users as u', 'l.actor_id', 'u.id')
        .whereIn('l.task_id', inProgressXlr8Ids)
        .whereIn('l.action', ['manager_approved', 'admin_approved', 'next_stage', 'employee_accepted'])
        .orderBy('l.created_at', 'desc')
        .select('l.task_id', 'u.name as actor', 'l.action');
      for (const row of approvals) {
        if (!stageApprovedBy[row.task_id]) stageApprovedBy[row.task_id] = row.actor;
      }
    }

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

      return { ...task, tracked_seconds_today: taskSeconds, timer_running: timerRunning, has_rejected_approval: rejectedSet.has(Number(task.id)), rejection_log: task.acceptance_status === 'upcoming' ? null : (rejectionLogs[task.id] ?? null), stage_approved_by: stageApprovedBy[task.id] ?? null };
    });

    // Merge completed tasks (dedup by id)
    const activeIds = new Set(tasks.map((t: any) => t.id));
    const completedMerged = completedToday.filter((t: any) => !activeIds.has(t.id));

    // For managers/admins: also fetch tasks pending their approval
    let pendingApprovalTasks: any[] = [];
    if (req.user!.role === 'admin' || req.user!.role === 'manager') {
      const myPod = (await db('users').where({ id: userId }).select('pod').first())?.pod;
      pendingApprovalTasks = await db('tasks as t')
        .join('projects as p', 't.project_id', 'p.id')
        .where('t.status', 'pending_approval')
        .leftJoin('users as cr', 't.created_by', 'cr.id')
        .select('t.id', 't.title', 't.status', 't.due_date', 't.due_time', 't.estimated_hours', 't.priority', 't.ticket_type_id', 'p.name as project_name', 't.crosspod_pods', 't.crosspod_reasons', 'cr.name as created_by_name')
        .then((rows: any[]) => rows.filter((r: any) => {
          // Cross-pod requests only go to the manager of the pod being borrowed from
          if (!r.crosspod_pods || req.user!.role === 'admin') return true;
          return (JSON.parse(r.crosspod_pods) as string[]).includes(myPod);
        }))
        .then((rows: any[]) => rows.map((r: any) => ({ ...r, tracked_seconds_today: 0, timer_running: false, acceptance_status: null, rejection_log: null })));
      if (req.user!.role === 'manager') {
        // Cross-pod / custom-stage requests are routed by pod above; everything else only if the manager works on it
        const mine = await managerTaskIds(db, userId, pendingApprovalTasks.filter((t: any) => !t.crosspod_pods).map((t: any) => Number(t.id)));
        pendingApprovalTasks = pendingApprovalTasks.filter((t: any) => t.crosspod_pods || mine.has(Number(t.id)));
      }
    }

    // Ensure today's recurring instances exist (lazy generation)
    const { generateTodayInstances } = await import('./calendar');
    await generateTodayInstances().catch(() => {});

    // Today's recurring task instances for this user
    const recurringRaw = await db('tasks as t')
      .whereNotNull('t.recurring_task_id')
      .where(function () { this.where('t.assigned_to', userId).orWhere('t.created_by', userId); })
      .where(function () { this.where('t.recurrence_date', today).orWhere('t.due_date', today); })
      .whereNot('t.status', 'completed')
      .select('t.id', 't.title', 't.estimated_hours', 't.recurring_task_id', 't.created_by');

      
    const recIds = recurringRaw.map((r: any) => r.id);
    const recSessions = recIds.length
      ? await db('task_sessions').whereIn('task_id', recIds).where({ user_id: userId, session_date: today }).select('*')
      : [];

    const recurringTasks = recurringRaw.map((r: any) => {
      const ts = recSessions.filter((s: any) => s.task_id === r.id);
      let secs = 0; let running = false;
      for (const s of ts) {
        secs += (s.ended_at ? new Date(s.ended_at).getTime() : now) - new Date(s.started_at).getTime();
        if (!s.ended_at) running = true;
      }
      return { id: r.id, title: r.title, estimated_hours: Number(r.estimated_hours) || 0, tracked_seconds_today: Math.round(secs / 1000), timer_running: running };
    });

    res.json({
      tracked_seconds: Math.round(trackedSeconds),
      capacity_seconds: 7 * 3600,
      active_task_id: activeTaskId,
      active_session_start: activeSessionStart,
      tasks: [...tasks, ...completedMerged, ...pendingApprovalTasks.filter((t: any) => !activeIds.has(t.id))],
      recurringTasks,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/capacity/check/:userId — check a user's assigned-hours load (for capacity warnings)
// ?due_date=YYYY-MM-DD  only count tasks due on or before that date (+ undated tasks).
// Without it, defaults to today so future tasks don't inflate the load.
router.get('/check/:userId', async (req: AuthRequest, res: Response) => {
  const db = getDB();
  const targetUserId = Number(req.params.userId);
  const checkDate = (req.query.due_date as string) || new Date().toISOString().slice(0, 10);

  try {
    const row = await db('tasks as t')
      .join('task_assignees as ta', 'ta.task_id', 't.id')
      .where('ta.user_id', targetUserId)
      .whereNotIn('ta.acceptance_status', ['declined'])
      .whereNotIn('t.status', ['completed', 'in_review'])
      .whereNotNull('t.estimated_hours')
      .where(function () {
        // Only count tasks due on/before the check date, or tasks with no due date
        this.whereNull('t.due_date').orWhere('t.due_date', '<=', checkDate);
      })
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

// GET /api/capacity/declined-stages — tasks with declined stage assignees (admin/manager only)
router.get('/declined-stages', requireRoles('admin', 'manager'), async (req: AuthRequest, res: Response) => {
  const db = getDB();
  try {
    const rows = await db('task_assignees as ta')
      .join('tasks as t', 't.id', 'ta.task_id')
      .join('users as u', 'u.id', 'ta.user_id')
      .where('ta.acceptance_status', 'declined')
      .whereNotNull('ta.user_id')
      .whereNotIn('t.status', ['completed'])
      .select(
        't.id as task_id', 't.title', 't.project_id', 't.xlr8_status',
        'ta.stage_idx', 'ta.assignee_role', 'ta.user_id',
        'u.name as declined_by', 'u.avatar_color',
      );
    // Reason: this stage's own decline if tagged, else the person's latest decline on the ticket
    const logs = rows.length ? await db('xlr8_ticket_log')
      .whereIn('task_id', [...new Set(rows.map((r: any) => r.task_id))])
      .whereIn('action', ['stage_pre_declined', 'employee_declined'])
      .orderBy('created_at', 'desc').orderBy('id', 'desc')
      .select('task_id', 'actor_id', 'to_stage_idx', 'comment') : [];
    // One row per declined stage
    const seen = new Set<string>();
    const declined: any[] = [];
    for (const r of rows) {
      const key = `${r.task_id}:${r.stage_idx}:${r.user_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const mineLogs = logs.filter((l: any) => l.task_id === r.task_id && l.actor_id === r.user_id);
      const log = mineLogs.find((l: any) => l.to_stage_idx != null && Number(l.to_stage_idx) === Number(r.stage_idx)) ?? mineLogs[0];
      declined.push({ ...r, reason: log?.comment ?? null });
    }
    if (req.user!.role === 'manager') {
      const mine = await managerTaskIds(db, req.user!.id, [...new Set<number>(declined.map((d: any) => Number(d.task_id)))]);
      res.json(declined.filter((d: any) => mine.has(Number(d.task_id)))); return;
    }
    res.json(declined);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/capacity/team — all employees' daily capacity (manager/admin only)
// ── Per-person stats over a period: capacity, reworks, escalations, assigned, pending ──
const toMs = (v: any): number => {
  if (v == null || v === '') return NaN;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number' || /^\d{10,}$/.test(String(v))) return Number(v);
  const s = String(v);
  return Date.parse(/^\d{4}-\d{2}-\d{2} \d/.test(s) ? s.replace(' ', 'T') + 'Z' : s);
};
const ymdOf = (v: any) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10));
const isYmd = (v: any) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
function workingDays(from: string, to: string): number {
  let n = 0;
  for (let d = new Date(from + 'T00:00:00Z'); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    const w = d.getUTCDay(); if (w !== 0 && w !== 6) n++;
  }
  return n;
}

router.get('/team-stats', requireRoles('admin', 'manager'), async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const today = new Date().toISOString().slice(0, 10);
    const from = isYmd(req.query.from) ? String(req.query.from) : today;
    const to = isYmd(req.query.to) ? String(req.query.to) : today;
    if (to < from) { res.status(400).json({ error: 'The end date is before the start date' }); return; }
    const fromMs = Date.parse(from + 'T00:00:00Z'), toMs_ = Date.parse(to + 'T23:59:59.999Z');
    const inRange = (v: any) => { const m = toMs(v); return m >= fromMs && m <= toMs_; };

    let empQ = db('users').whereIn('role', ['employee', 'manager']).orderBy('name').select('id', 'name', 'avatar_color', 'avatar_url', 'role', 'pod');
    if (req.user!.role === 'manager') {
      const mgr = await db('users').where({ id: req.user!.id }).select('pod').first();
      if (mgr?.pod) empQ = empQ.where('pod', mgr.pod);
    } else if (req.query.pod) empQ = empQ.where('pod', String(req.query.pod));
    const emps = await empQ;
    const ids = emps.map((e: any) => e.id);
    if (!ids.length) { res.json({ from, to, members: [] }); return; }

    const dayCap = Number(process.env.WORK_DAY_HOURS) || 7;
    const lastCounted = to > today ? today : to;
    const availableHours = lastCounted < from ? 0 : workingDays(from, lastCounted) * dayCap;

    // Logged time
    const sessions = await db('task_sessions as s').leftJoin('tasks as t', 't.id', 's.task_id').leftJoin('projects as p', 'p.id', 't.project_id')
      .whereIn('s.user_id', ids).where('s.session_date', '>=', from).where('s.session_date', '<=', to)
      .select('s.user_id', 's.task_id', 's.session_date', 's.started_at', 's.ended_at', 't.title', 'p.name as project_name');
    const now = Date.now();

    // Assignments (employee/manager work, not skipped or declined)
    const rows = await db('task_assignees as ta').join('tasks as t', 't.id', 'ta.task_id').leftJoin('projects as p', 'p.id', 't.project_id')
      .whereIn('ta.user_id', ids).whereIn('ta.assignee_role', ['employee', 'manager'])
      .where((q: any) => q.whereNull('ta.skipped').orWhere('ta.skipped', 0))
      .where((q: any) => q.whereNull('ta.acceptance_status').orWhereNot('ta.acceptance_status', 'declined'))
      .whereNotIn('t.status', ['draft'])
      .select('ta.user_id', 'ta.stage_idx', 'ta.acceptance_status', 'ta.est_hours', 't.estimated_hours', 't.id', 't.title', 't.status', 't.created_at', 't.due_date', 't.due_time',
        't.ticket_type_id', 't.xlr8_stage_idx', 't.xlr8_status', 't.xlr8_assignee_id', 't.assigned_to', 'p.name as project_name');

    const typeIds = [...new Set(rows.filter((r: any) => r.ticket_type_id).map((r: any) => r.ticket_type_id))];
    const stageNames = new Map<number, string[]>();
    for (const tt of typeIds.length ? await db('xlr8_ticket_types').whereIn('id', typeIds).select('id', 'stages') : []) {
      let st: any[] = []; try { st = typeof tt.stages === 'string' ? JSON.parse(tt.stages) : (tt.stages || []); } catch { /* bad json */ }
      stageNames.set(tt.id, st.map((x: any, i: number) => x?.category_name || `Stage ${i + 1}`));
    }
    const stageName = (r: any, idx: any) => (r.ticket_type_id && idx != null ? stageNames.get(r.ticket_type_id)?.[Number(idx)] : null) || null;
    const brief = (r: any, extra: Record<string, any> = {}): any => ({ id: r.id, title: r.title, project_name: r.project_name, due_date: r.due_date ? ymdOf(r.due_date) : null, status: r.xlr8_status || r.status, ...extra });

    // Is this person's part still to do?
    const partOpen = (r: any) => {
      if (r.status === 'completed' || r.xlr8_status === 'completed') return false;
      if (!r.ticket_type_id) return !['in_review'].includes(r.status);
      const cur = r.xlr8_stage_idx ?? 0, mine = Number(r.stage_idx ?? 0);
      if (mine > cur) return true;
      if (mine < cur) return false;
      return ['pending_assignee', 'in_progress', 'pending_manager', 'pending_admin', 'needs_reassignment'].includes(r.xlr8_status);
    };

    // Reworks: work sent back to this person's stage (tickets) or rejected (plain tasks)
    const declines = await db('xlr8_ticket_log as l').join('tasks as t', 't.id', 'l.task_id').leftJoin('projects as p', 'p.id', 't.project_id')
      .whereIn('l.action', ['manager_declined', 'admin_declined']).whereNotNull('l.to_stage_idx')
      .select('l.task_id', 'l.to_stage_idx', 'l.actor_name', 'l.comment', 'l.created_at', 't.id', 't.title', 't.status', 't.xlr8_status', 't.due_date', 't.ticket_type_id', 'p.name as project_name');
    const stageOwners = await db('task_assignees').whereIn('task_id', [...new Set(declines.map((d: any) => d.task_id))].concat([0]))
      .whereIn('user_id', ids).where('assignee_role', 'employee').select('task_id', 'stage_idx', 'user_id');
    const rejections = await db('approvals as a').join('tasks as t', 't.id', 'a.task_id').leftJoin('projects as p', 'p.id', 't.project_id')
      .whereNull('t.ticket_type_id').whereNotNull('a.rejected_at').whereIn('t.assigned_to', ids)
      .select('a.rejected_at', 'a.rejection_notes', 'a.rejected_by', 't.id', 't.title', 't.status', 't.due_date', 't.assigned_to', 'p.name as project_name');

    // Escalations: due in the period and missed — still with them and overdue, or their part submitted late
    const dueEnd = (r: any) => Date.parse(`${ymdOf(r.due_date)}T${r.due_time ? String(r.due_time).slice(0, 5) : '23:59'}:59Z`);
    const doneLogs = await db('xlr8_ticket_log').where('action', 'work_done').whereIn('actor_id', ids).select('task_id', 'actor_id', 'created_at');
    const submitted = await db('approvals').whereNotNull('work_submitted_at').select('task_id', 'work_submitted_at');
    // All-time time per person per ticket, to compare against their estimate
    const allSess = await db('task_sessions').whereIn('user_id', ids).whereIn('task_id', [...new Set(rows.map((r: any) => r.id))].concat([0]))
      .select('user_id', 'task_id', 'started_at', 'ended_at', 'session_date');
    const spent = (uid: number, tid: number) => allSess.filter((x: any) => x.user_id === uid && x.task_id === tid)
      .reduce((a: number, x: any) => { const v = ((x.ended_at ? toMs(x.ended_at) : now) - toMs(x.started_at)) / 1000; return a + (Number.isFinite(v) && v > 0 ? v : 0); }, 0);
    const workedInPeriod = (uid: number, tid: number) => allSess.some((x: any) => x.user_id === uid && x.task_id === tid && ymdOf(x.session_date) >= from && ymdOf(x.session_date) <= to);

    const members = emps.map((e: any) => {
      const mySessions = sessions.filter((s: any) => s.user_id === e.id);
      const byTask = new Map<number, any>(), byDay = new Map<string, number>();
      let loggedSec = 0;
      for (const s of mySessions) {
        const sec = Math.max(0, ((s.ended_at ? toMs(s.ended_at) : now) - toMs(s.started_at)) / 1000);
        if (!Number.isFinite(sec)) continue;
        loggedSec += sec;
        const day = ymdOf(s.session_date); byDay.set(day, (byDay.get(day) || 0) + sec);
        const k = byTask.get(s.task_id) || { id: s.task_id, title: s.title, project_name: s.project_name, seconds: 0 };
        k.seconds += sec; byTask.set(s.task_id, k);
      }

      const mine = rows.filter((r: any) => r.user_id === e.id);
      const assignedMap = new Map<number, any>();
      for (const r of mine) if (inRange(r.created_at) && !assignedMap.has(r.id)) assignedMap.set(r.id, r);
      const assigned = [...assignedMap.values()].map((r) => brief(r, { stage: stageName(r, r.stage_idx) }));
      const pending = [...assignedMap.values()].filter((r) => mine.some((m: any) => m.id === r.id && partOpen(m)))
        .map((r) => brief(r, { stage: stageName(r, mine.find((m: any) => m.id === r.id && partOpen(m))?.stage_idx), accepted: mine.some((m: any) => m.id === r.id && m.acceptance_status === 'accepted') }));

      const reworks = [
        ...declines.filter((d: any) => inRange(d.created_at) && stageOwners.some((o: any) => o.task_id === d.task_id && o.user_id === e.id && Number(o.stage_idx) === Number(d.to_stage_idx)))
          .map((d: any) => brief(d, { at: toMs(d.created_at), by: d.actor_name, reason: d.comment || null, stage: stageName(d, d.to_stage_idx) })),
        ...rejections.filter((a: any) => a.assigned_to === e.id && inRange(a.rejected_at))
          .map((a: any) => brief(a, { at: toMs(a.rejected_at), by: null, reason: a.rejection_notes || null, stage: null })),
      ].sort((a, b) => b.at - a.at);

      const escMap = new Map<string, any>();
      // Over estimate: their time on their part went past its estimate, and they worked on it in this period
      for (const r of mine) {
        const est = Number(r.ticket_type_id ? r.est_hours : (r.est_hours ?? r.estimated_hours));
        if (!(est > 0) || escMap.has(`${r.id}-over`) || !workedInPeriod(e.id, r.id)) continue;
        const over = spent(e.id, r.id) - est * 3600;
        if (over > 0) escMap.set(`${r.id}-over`, brief(r, { kind: 'overtime', over_seconds: Math.round(over), estimate_seconds: Math.round(est * 3600), stage: stageName(r, r.stage_idx) }));
      }
      for (const r of mine) {
        if (!r.due_date || escMap.has(`${r.id}-due`)) continue;
        const due = ymdOf(r.due_date);
        if (due < from || due > to) continue;
        const end = dueEnd(r);
        const holding = r.ticket_type_id ? r.xlr8_assignee_id === e.id && ['pending_assignee', 'in_progress'].includes(r.xlr8_status) && Number(r.stage_idx) === (r.xlr8_stage_idx ?? 0)
          : r.assigned_to === e.id && !['completed', 'in_review'].includes(r.status);
        if (holding && now > end) { escMap.set(`${r.id}-due`, brief(r, { kind: 'overdue', days_late: Math.floor((now - end) / 86400000) + 1, stage: stageName(r, r.stage_idx) })); continue; }
        const doneAt = r.ticket_type_id
          ? Math.min(...doneLogs.filter((l: any) => l.task_id === r.id && l.actor_id === e.id).map((l: any) => toMs(l.created_at)).filter((m: number) => m > 0), Infinity)
          : (r.assigned_to === e.id ? Math.min(...submitted.filter((a: any) => a.task_id === r.id).map((a: any) => toMs(a.work_submitted_at)).filter((m: number) => m > 0), Infinity) : Infinity);
        if (Number.isFinite(doneAt) && doneAt > end) escMap.set(`${r.id}-due`, brief(r, { kind: 'late', days_late: Math.ceil((doneAt - end) / 86400000), stage: stageName(r, r.stage_idx) }));
      }

      return {
        user_id: e.id, name: e.name, avatar_color: e.avatar_color, avatar_url: e.avatar_url, role: e.role, pod: e.pod ?? null,
        capacity: {
          logged_seconds: Math.round(loggedSec), available_hours: availableHours,
          by_day: [...byDay.entries()].sort().map(([date, sec]) => ({ date, seconds: Math.round(sec) })),
          by_task: [...byTask.values()].sort((a, b) => b.seconds - a.seconds).map((t) => ({ ...t, seconds: Math.round(t.seconds) })),
        },
        reworks, escalations: [...escMap.values()], assigned, pending,
      };
    });
    res.json({ from, to, available_hours: availableHours, members });
  } catch (err) { console.error('team-stats', err); res.status(500).json({ error: 'Server error' }); }
});

router.get('/team', requireRoles('admin', 'manager'), async (req: AuthRequest, res: Response) => {
  const db = getDB();
  const today = (req.query.date as string) || new Date().toISOString().slice(0, 10);
  const now = Date.now();

  try {
    let empQuery = db('users')
      .whereIn('role', ['employee', 'manager'])
      .orderBy('name')
      .select('id', 'name', 'avatar_color', 'avatar_url', 'role', 'pod');

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
      .leftJoin('task_assignees as ta_est', function () {
        this.on('ta_est.task_id', 't.id').on('ta_est.stage_idx', 't.xlr8_stage_idx');
      })
      .whereIn('t.xlr8_assignee_id', employeeIds)
      .whereIn('t.xlr8_status', ['pending_assignee', 'in_progress'])
      .select(
        't.id', 't.title', 't.status', 't.due_date', 't.due_time', 't.estimated_hours',
        'p.name as project_name', 't.xlr8_stage_idx',
        't.xlr8_assignee_id as assignee_user_id',
        db.raw("CASE WHEN t.xlr8_status = 'pending_assignee' THEN 'pending' ELSE 'accepted' END as acceptance_status"),
        db.raw("'employee' as assignee_role"),
        db.raw('MIN(ta_est.est_hours) as stage_est_hours')
      )
      .groupBy('t.id');

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
