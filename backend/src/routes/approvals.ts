import { Router, Response } from 'express';
import { getDB } from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';
import { sendServiceError } from '../services/access';
import { WORKFLOWS, closeTaskTimers, notifyByRole, WorkflowType, reviewApproval, completeWork } from '../services/approvals';

const router = Router();
router.use(authenticate);

// ─── GET approvals ────────────────────────────────────────────────────────────

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const { role, id: userId } = req.user!;

    // Auto-repair: create missing approval records for XLR8 tasks already in a pending state
    const orphaned = await db('tasks as t')
      .whereNotNull('t.xlr8_status')
      .whereIn('t.xlr8_status', ['pending_manager', 'pending_admin', 'pending_client'])
      .whereNotExists(function () {
        this.from('approvals as ap').whereRaw('ap.task_id = t.id');
      })
      .select('t.id', 't.title', 't.project_id', 't.created_by', 't.xlr8_status');
    for (const t of orphaned) {
      await db('approvals')
        .insert({ task_id: t.id, title: t.title, project_id: t.project_id, submitted_by: t.created_by, status: t.xlr8_status, workflow_type: 'xlr8' });
    }

    let query = db('approvals as ap')
      .join('tasks as t', 'ap.task_id', 't.id')
      .join('projects as p', 'ap.project_id', 'p.id')
      .leftJoin('client_companies as c', 'p.client_company_id', 'c.id')
      .leftJoin('users as sub', 'ap.submitted_by', 'sub.id')
      .leftJoin(
        db('task_assignees').where('assignee_role', 'employee').groupBy('task_id').select('task_id', db.raw('MIN(user_id) as user_id')).as('emp_ta'),
        'emp_ta.task_id', 'ap.task_id'
      )
      .leftJoin('users as worker', 'worker.id', 'emp_ta.user_id')
      .leftJoin('users as xa', 'xa.id', 't.xlr8_assignee_id')
      .leftJoin('xlr8_ticket_types as xtt', 'xtt.id', 't.ticket_type_id')
      .select(
        'ap.*',
        't.title as task_title',
        't.xlr8_stage_idx', 't.xlr8_status', 't.xlr8_assignee_id', 'xa.role as xlr8_assignee_role',
        'p.name as project_name',
        'c.name as client_name',
        'sub.name as submitted_by_name',
        'sub.avatar_color as submitted_by_color',
        'sub.avatar_url as submitted_by_avatar_url',
        'worker.name as worker_name',
        'worker.avatar_color as worker_avatar_color',
        'worker.avatar_url as worker_avatar_url',
        'xtt.stages as xlr8_stages_raw',
        'xtt.final_approval as xlr8_final_approval_raw',
        'xtt.name as xlr8_ticket_type_name'
      );

    if (role === 'admin') {
      if (req.query.pod) {
        // Filter by pod but always include projects with no pod set
        query = query.where(function () {
          this.where('p.pod', req.query.pod as string).orWhereNull('p.pod');
        });
      }
    } else if (role === 'manager') {
      const mgr = await db('users').where({ id: userId }).select('pod').first();
      if (mgr?.pod) {
        // Show approvals for this pod's projects, custom flows, OR projects with no pod assigned
        query = query.where(function () {
          this.where('p.pod', mgr.pod)
            .orWhereNull('p.pod')
            .orWhereRaw(`(ap.workflow_type = 'custom' AND EXISTS (
              SELECT 1 FROM task_approval_flow taf
              WHERE taf.task_id = ap.task_id AND taf.user_id = ?
            ))`, [userId]);
        });
      }
    } else if (role === 'client') {
      const clientUser = await db('users').where({ id: userId }).select('client_company_id').first();
      if (clientUser?.client_company_id) {
        query = query.where('p.client_company_id', clientUser.client_company_id);
      } else {
        query = query
          .join('project_members as pm', 'p.id', 'pm.project_id')
          .where('pm.user_id', userId);
      }
    } else if (role === 'employee') {
      // Employee sees: own submissions + custom-flow + XLR8 tickets they ever acted on (log history)
      // + XLR8 reviewer stages currently assigned to them (reviewer:true stages behave like manager review)
      query = query.where(function () {
        this.where('ap.submitted_by', userId)
          .orWhereRaw(`(ap.workflow_type = 'custom' AND EXISTS (
            SELECT 1 FROM task_approval_flow taf
            WHERE taf.task_id = ap.task_id AND taf.user_id = ?
          ))`, [userId])
          .orWhereRaw(`(ap.workflow_type = 'xlr8' AND EXISTS (
            SELECT 1 FROM xlr8_ticket_log log WHERE log.task_id = ap.task_id AND log.actor_id = ?
          ))`, [userId])
          // Ticket waiting in review with this employee as the reviewer (works on SQLite and MySQL)
          .orWhereRaw(`(ap.workflow_type = 'xlr8' AND t.xlr8_assignee_id = ? AND t.xlr8_status = 'pending_manager')`, [userId]);
      });
    }

    // One task's approval (task drawer) — same visibility rules as the full list
    if (req.query.task_id) query = query.where('ap.task_id', Number(req.query.task_id));

    // XLR8 tickets get a new approval row on every resubmission; show one card per ticket
    // (its stage flow already lists every rejection), keeping the latest row
    const seenXlr8 = new Set<number>();
    const approvals = (await query.orderBy('ap.created_at', 'desc').orderBy('ap.id', 'desc')).filter((a: any) => {
      if (a.workflow_type !== 'xlr8') return true;
      if (seenXlr8.has(a.task_id)) return false;
      seenXlr8.add(a.task_id);
      return true;
    });

    // Attach the approval flow chain for custom-workflow approvals
    const customIds = approvals.filter((a: any) => a.workflow_type === 'custom').map((a: any) => a.task_id);
    let flowMap: Record<number, any[]> = {};
    if (customIds.length) {
      const flowRows = await db('task_approval_flow as f')
        .join('users as u', 'f.user_id', 'u.id')
        .whereIn('f.task_id', customIds)
        .orderBy('f.task_id').orderBy('f.position')
        .select('f.task_id', 'f.position', 'u.id as user_id', 'u.name', 'u.role', 'u.avatar_color', 'u.avatar_url');
      for (const r of flowRows) {
        if (!flowMap[r.task_id]) flowMap[r.task_id] = [];
        flowMap[r.task_id].push(r);
      }
    }
    const baseResult = approvals.map((a: any) => {
      const { xlr8_stages_raw, xlr8_final_approval_raw, ...rest } = a;
      return {
        ...rest,
        flow_chain: flowMap[a.task_id] ?? null,
        xlr8_stages: xlr8_stages_raw ? (typeof xlr8_stages_raw === 'string' ? JSON.parse(xlr8_stages_raw) : xlr8_stages_raw) : null,
        xlr8_final_approval: xlr8_final_approval_raw ? (typeof xlr8_final_approval_raw === 'string' ? JSON.parse(xlr8_final_approval_raw) : xlr8_final_approval_raw) : null,
      };
    });

    // Close any stale open sessions from previous days for this user
    const today = new Date().toISOString().slice(0, 10);
    await db('task_sessions')
      .where('user_id', userId)
      .whereNull('ended_at')
      .where('session_date', '<', today)
      .update({ ended_at: db.raw('started_at') }); // zero-duration, avoids inflating logs
    const taskIds = baseResult.map((a: any) => a.task_id);
    const timerMap: Record<number, { seconds: number; running: boolean }> = {};
    if (taskIds.length) {
      const sessions = await db('task_sessions')
        .whereIn('task_id', taskIds)
        .where('user_id', userId)
        .where('session_date', today)
        .select('task_id', 'started_at', 'ended_at');
      for (const s of sessions) {
        const tid = Number(s.task_id);
        if (!timerMap[tid]) timerMap[tid] = { seconds: 0, running: false };
        const end = s.ended_at ? new Date(s.ended_at) : new Date();
        timerMap[tid].seconds += (end.getTime() - new Date(s.started_at).getTime()) / 1000;
        if (!s.ended_at) timerMap[tid].running = true;
      }
    }
    const result = baseResult.map((a: any) => ({
      ...a,
      timer_running: timerMap[a.task_id]?.running ?? false,
      tracked_seconds_today: Math.round(timerMap[a.task_id]?.seconds ?? 0),
    }));

    // One row per task: its latest review round (earlier rounds of a resubmitted task are history)
    const latestId = new Map<number, number>();
    for (const a of result as any[]) if (!latestId.has(a.task_id) || a.id > latestId.get(a.task_id)!) latestId.set(a.task_id, a.id);
    res.json((result as any[]).filter((a) => a.task_id == null || latestId.get(a.task_id) === a.id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GET step history for one approval ───────────────────────────────────────

router.get('/:id/steps', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const steps = await db('approval_steps')
      .where({ approval_id: req.params.id })
      .orderBy('acted_at', 'asc');

    // For XLR8 approvals, synthesize start-time entries from xlr8_ticket_log
    const approval = await db('approvals').where({ id: req.params.id }).select('workflow_type', 'task_id', 'created_at').first();
    if (approval?.workflow_type === 'xlr8') {
      const logs = await db('xlr8_ticket_log')
        .where({ task_id: approval.task_id })
        .orderBy('created_at', 'asc');

      // Stage 0 starts at ticket creation
      steps.push({
        id: 'xlr8_start_0',
        approval_id: Number(req.params.id),
        actor_name: '',
        actor_role: 'system',
        action: 'approve',
        stage_key: 'stage_start_0',
        comments: null,
        acted_at: approval.created_at,
      });

      // Include decline/rejection events in the history
      const DECLINE_ACTIONS: Record<string, string> = {
        admin_declined: 'Admin returned to employee',
        manager_declined: 'Manager returned to employee',
        employee_declined: 'Employee declined',
      };
      for (const log of logs) {
        if (DECLINE_ACTIONS[log.action]) {
          steps.push({
            id: `xlr8_decline_${log.id}`,
            approval_id: Number(req.params.id),
            actor_name: log.actor_name,
            actor_role: log.actor_role ?? 'system',
            action: 'reject',
            stage_key: `decline_${log.id}`,
            comments: log.comment || DECLINE_ACTIONS[log.action],
            acted_at: log.created_at,
          });
        }
      }

      // Each next_stage log entry marks the start of targetIdx stage
      // Comment format: "Stage X: ..." where X is 1-based target index
      for (const log of logs) {
        if (log.action !== 'next_stage') continue;
        const match = (log.comment ?? '').match(/^Stage (\d+):/);
        if (!match) continue;
        const targetIdx = Number(match[1]) - 1; // 0-based
        const comment = log.comment ?? '';
        let prefix = 'work';
        if (comment.includes('Manager Review')) prefix = 'mgr';
        else if (comment.includes('Admin Review')) prefix = 'adm';
        const stage_key = `stage_start_${targetIdx}_${prefix}`;
        if (!steps.find((s: any) => s.stage_key === stage_key)) {
          steps.push({
            id: `xlr8_ns_${log.id}`,
            approval_id: Number(req.params.id),
            actor_name: log.actor_name,
            actor_role: 'system',
            action: 'approve',
            stage_key: `stage_start_${targetIdx}`,
            comments: log.comment || null,
            acted_at: log.created_at,
          });
        }
      }
    }

    res.json(steps);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST submit for approval ─────────────────────────────────────────────────

router.post('/', async (req: AuthRequest, res: Response) => {
  const { task_id, title } = req.body;
  const { role, id: userId } = req.user!;
  if (!task_id || !title) { res.status(400).json({ error: 'task_id and title required' }); return; }

  try {
    const db = getDB();
    const task = await db('tasks').where({ id: task_id }).first();
    if (!task) { res.status(404).json({ error: 'Ticket not found' }); return; }

    // Block duplicate active approvals
    const existing = await db('approvals').where({ task_id })
      .whereNotIn('status', ['approved', 'rejected']).first();
    if (existing) { res.status(409).json({ error: 'Approval already pending for this ticket' }); return; }

    // Determine workflow type from submitter role + whether project has clients
    const projectClients = await db('project_members as pm')
      .join('users as u', 'pm.user_id', 'u.id')
      .where('pm.project_id', task.project_id)
      .where('u.role', 'client')
      .select('u.id');
    const hasClient = projectClients.length > 0;

    let workflowType: WorkflowType;
    if (role === 'employee') workflowType = 'employee';
    else if (role === 'manager') workflowType = 'manager';
    else workflowType = hasClient ? 'admin_with_client' : 'admin_no_client';

    // Admin submitting a task with no clients → immediate completion
    if (workflowType === 'admin_no_client') {
      await db('tasks').where({ id: task_id }).update({ status: 'completed', completed_at: new Date() });
      await closeTaskTimers(task_id);
      res.status(201).json({ id: null, workflow_type: workflowType, immediate: true });
      return;
    }

    const workflow = WORKFLOWS[workflowType];
    const firstStage = workflow[0];

    // Resubmission after rejection: reopen the rejected record
    const rejectedRecord = await db('approvals')
      .where({ task_id, status: 'rejected' }).orderBy('created_at', 'desc').first();
    if (rejectedRecord) {
      await db('approvals').where({ id: rejectedRecord.id }).update({
        status: firstStage.status,
        workflow_type: workflowType,
        rejected_by: null,
        rejected_at: null,
        rejection_notes: null,
      });
      await db('tasks').where({ id: task_id }).update({ status: 'in_review' });
      await closeTaskTimers(task_id);
      await notifyByRole(db, firstStage.role, task.project_id, `"${title}" has been resubmitted for review`);
      res.json({ id: rejectedRecord.id, resubmitted: true });
      return;
    }

    const [id] = await db('approvals').insert({
      task_id,
      title,
      project_id: task.project_id,
      submitted_by: userId,
      status: firstStage.status,
      workflow_type: workflowType,
    });

    await db('tasks').where({ id: task_id }).update({ status: 'in_review' });
    await closeTaskTimers(task_id);
    await notifyByRole(db, firstStage.role, task.project_id,
      `New approval request: "${title}" is awaiting your review`);

    res.status(201).json({ id, workflow_type: workflowType });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});


// ─── PUT review ───────────────────────────────────────────────────────────────

router.put('/:id', async (req: AuthRequest, res: Response) => {
  try { res.json(await reviewApproval(req.user!, req.params.id as string, req.body)); }
  catch (err) { sendServiceError(res, err, 'approvals.review'); }
});

// ─── POST mark complete (legacy work_in_progress) ────────────────────────────

router.post('/:id/complete', async (req: AuthRequest, res: Response) => {
  try { res.json(await completeWork(req.user!, req.params.id as string)); }
  catch (err) { sendServiceError(res, err, 'approvals.complete'); }
});

export default router;
