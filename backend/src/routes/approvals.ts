import { Router, Response } from 'express';
import { getDB, createNotification, isNotifEnabled } from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate);

// Close open timer sessions for a task and write time_logs for any unlogged time
async function closeTaskTimers(taskId: number) {
  const db = getDB();
  const now = new Date();
  const open = await db('task_sessions').where({ task_id: taskId }).whereNull('ended_at').select('*');
  for (const s of open) {
    const startMs = isNaN(Number(s.started_at)) ? new Date(s.started_at).getTime() : Number(s.started_at);
    const hours = (now.getTime() - startMs) / 3600000;
    await db('task_sessions').where({ id: s.id }).update({ ended_at: now });
    if (hours > 0.001) {
      const task = await db('tasks').where({ id: taskId }).select('project_id').first();
      const user = await db('users').where({ id: s.user_id }).select('monthly_salary').first();
      const rate = user?.monthly_salary ? user.monthly_salary / 160 : null;
      await db('time_logs').insert({
        task_id: taskId,
        project_id: task?.project_id,
        user_id: s.user_id,
        log_date: s.session_date,
        hours: Math.round(hours * 1000) / 1000,
        notes: 'Auto-logged on task completion',
        task_session_id: s.id,
        hourly_rate: rate,
      });
    }
  }
}

// ─── State Machine ────────────────────────────────────────────────────────────

type WorkflowType = 'employee' | 'manager' | 'admin_with_client' | 'admin_no_client';

interface WFStage {
  status: string;
  role: 'manager' | 'admin' | 'client';
  label: string;
}

/*
 * Employee:  Manager → Admin → Client → Admin Final → Manager Final → approved
 * Manager:   Admin → Client → Admin Final → Manager Final → approved
 * Admin+C:   Client → Admin Final → approved
 * Admin noC: immediate completion (no workflow)
 */
const WORKFLOWS: Record<WorkflowType, WFStage[]> = {
  employee: [
    { status: 'pending_manager',       role: 'manager', label: 'Manager Review' },
    { status: 'pending_admin',         role: 'admin',   label: 'Admin Review' },
    { status: 'pending_client',        role: 'client',  label: 'Client Review' },
    { status: 'pending_admin_final',   role: 'admin',   label: 'Admin Final Review' },
    { status: 'pending_manager_final', role: 'manager', label: 'Manager Confirmation' },
  ],
  manager: [
    { status: 'pending_admin',         role: 'admin',   label: 'Admin Review' },
    { status: 'pending_client',        role: 'client',  label: 'Client Review' },
    { status: 'pending_admin_final',   role: 'admin',   label: 'Admin Final Review' },
    { status: 'pending_manager_final', role: 'manager', label: 'Manager Confirmation' },
  ],
  admin_with_client: [
    { status: 'pending_client',      role: 'client', label: 'Client Review' },
    { status: 'pending_admin_final', role: 'admin',  label: 'Admin Final Review' },
  ],
  admin_no_client: [],
};

function stageIndex(wf: WFStage[], status: string): number {
  return wf.findIndex((s) => s.status === status);
}

function nextStage(wf: WFStage[], status: string): WFStage | undefined {
  const i = stageIndex(wf, status);
  return i >= 0 ? wf[i + 1] : undefined;
}

function prevStage(wf: WFStage[], status: string): WFStage | undefined {
  const i = stageIndex(wf, status);
  return i > 0 ? wf[i - 1] : undefined;
}

// ─── Notification helpers ─────────────────────────────────────────────────────

async function notifyManagers(db: any, message: string, projectId?: number, prefKey?: 'approvals' | 'responses' | 'comments') {
  let query = db('users as u').where('u.role', 'manager');
  if (projectId) {
    query = query
      .join('project_members as pm', function (this: any) {
        this.on('pm.user_id', 'u.id').andOn('pm.project_id', db.raw('?', [projectId]));
      });
  }
  const managers = await query.select('u.id');
  for (const m of managers) {
    if (projectId && prefKey && !(await isNotifEnabled(m.id, projectId, prefKey))) continue;
    await createNotification(m.id, message, 'approval', projectId);
  }
}

async function notifyAdmins(db: any, message: string, projectId?: number, prefKey?: 'approvals' | 'responses' | 'comments') {
  let query = db('users as u').where('u.role', 'admin');
  if (projectId) {
    query = query
      .join('project_members as pm', function (this: any) {
        this.on('pm.user_id', 'u.id').andOn('pm.project_id', db.raw('?', [projectId]));
      });
  }
  const admins = await query.select('u.id');
  for (const a of admins) {
    if (projectId && prefKey && !(await isNotifEnabled(a.id, projectId, prefKey))) continue;
    await createNotification(a.id, message, 'approval', projectId);
  }
}

async function notifyProjectClients(db: any, projectId: number, message: string) {
  const project = await db('projects').where({ id: projectId }).select('client_company_id').first();
  const clients = project?.client_company_id
    ? await db('users').where({ role: 'client', client_company_id: project.client_company_id }).select('id')
    : await db('project_members as pm').join('users as u', 'pm.user_id', 'u.id')
        .where('pm.project_id', projectId).where('u.role', 'client').select('u.id');
  for (const c of clients) await createNotification(c.id, message, 'approval', projectId);
}

async function notifyByRole(db: any, role: string, projectId: number, message: string, prefKey?: 'approvals' | 'responses' | 'comments') {
  if (role === 'manager') await notifyManagers(db, message, projectId, prefKey);
  else if (role === 'admin') await notifyAdmins(db, message, projectId, prefKey);
  else if (role === 'client') await notifyProjectClients(db, projectId, message);
}

// ─── GET approvals ────────────────────────────────────────────────────────────

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const { role, id: userId } = req.user!;

    let query = db('approvals as ap')
      .join('tasks as t', 'ap.task_id', 't.id')
      .join('projects as p', 'ap.project_id', 'p.id')
      .leftJoin('client_companies as c', 'p.client_company_id', 'c.id')
      .leftJoin('users as sub', 'ap.submitted_by', 'sub.id')
      .leftJoin(
        db('task_assignees').where('assignee_role', 'employee').as('emp_ta'),
        'emp_ta.task_id', 'ap.task_id'
      )
      .leftJoin('users as worker', 'worker.id', 'emp_ta.user_id')
      .leftJoin('xlr8_ticket_types as xtt', 'xtt.id', 't.ticket_type_id')
      .select(
        'ap.*',
        't.title as task_title',
        't.xlr8_stage_idx', 't.xlr8_status',
        'p.name as project_name',
        'c.name as client_name',
        'sub.name as submitted_by_name',
        'sub.avatar_color as submitted_by_color',
        'worker.name as worker_name',
        'worker.avatar_color as worker_avatar_color',
        'xtt.stages as xlr8_stages_raw',
        'xtt.final_approval as xlr8_final_approval_raw',
        'xtt.name as xlr8_ticket_type_name'
      );

    if (role === 'admin') {
      if (req.query.pod) {
        // Filter by pod — XLR8 tickets always pass through (no task_assignees)
        query = query.where(function () {
          this.whereNotNull('t.ticket_type_id')
            .orWhereIn('ap.task_id', function (this: any) {
              this.select('ta.task_id')
                .from('task_assignees as ta')
                .join('users as u', 'ta.user_id', 'u.id')
                .where('u.pod', req.query.pod as string)
                .whereIn('ta.assignee_role', ['employee']);
            });
        });
      }
    } else if (role === 'manager') {
      const mgr = await db('users').where({ id: userId }).select('pod').first();
      if (mgr?.pod) {
        // Show same-pod task approvals OR any custom flow where this manager is an approver (cross-pod)
        query = query.where(function () {
          this.whereIn('ap.task_id', function (this: any) {
            this.select('ta.task_id')
              .from('task_assignees as ta')
              .join('users as u', 'ta.user_id', 'u.id')
              .where('u.pod', mgr.pod)
              .whereIn('ta.assignee_role', ['employee']);
          })
          .orWhereRaw(`(ap.workflow_type = 'custom' AND EXISTS (
            SELECT 1 FROM task_approval_flow taf
            WHERE taf.task_id = ap.task_id AND taf.user_id = ?
          ))`, [userId])
          // Also show XLR8 ticket approvals (no task_assignees, pending_manager status)
          .orWhereRaw(`EXISTS (SELECT 1 FROM tasks t2 WHERE t2.id = ap.task_id AND t2.ticket_type_id IS NOT NULL)`);
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
      // Employee sees: own submissions + any custom-flow approval they appear in (any step, any stage)
      query = query.where(function () {
        this.where('ap.submitted_by', userId)
          .orWhereRaw(`(ap.workflow_type = 'custom' AND EXISTS (
            SELECT 1 FROM task_approval_flow taf
            WHERE taf.task_id = ap.task_id AND taf.user_id = ?
          ))`, [userId]);
      });
    }

    const approvals = await query.orderBy('ap.created_at', 'desc');

    // Attach the approval flow chain for custom-workflow approvals
    const customIds = approvals.filter((a: any) => a.workflow_type === 'custom').map((a: any) => a.task_id);
    let flowMap: Record<number, any[]> = {};
    if (customIds.length) {
      const flowRows = await db('task_approval_flow as f')
        .join('users as u', 'f.user_id', 'u.id')
        .whereIn('f.task_id', customIds)
        .orderBy('f.task_id').orderBy('f.position')
        .select('f.task_id', 'f.position', 'u.id as user_id', 'u.name', 'u.role', 'u.avatar_color');
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
        xlr8_stages: xlr8_stages_raw ? JSON.parse(xlr8_stages_raw) : null,
        xlr8_final_approval: xlr8_final_approval_raw ? JSON.parse(xlr8_final_approval_raw) : null,
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

    res.json(result);
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
    if (!task) { res.status(404).json({ error: 'Task not found' }); return; }

    // Block duplicate active approvals
    const existing = await db('approvals').where({ task_id })
      .whereNotIn('status', ['approved', 'rejected']).first();
    if (existing) { res.status(409).json({ error: 'Approval already pending for this task' }); return; }

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
      await db('tasks').where({ id: task_id }).update({ status: 'completed' });
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
  const { action, notes } = req.body; // 'approve' | 'reject'
  const { role, id: userId, name: actorName } = req.user!;

  try {
    const db = getDB();
    const approval = await db('approvals').where({ id: req.params.id }).first();
    if (!approval) { res.status(404).json({ error: 'Not found' }); return; }

    // XLR8 approvals are managed exclusively via /api/xlr8/tickets/:id/* routes
    if (approval.workflow_type === 'xlr8') {
      res.status(400).json({ error: 'XLR8 approvals must be actioned via the Tasks page workflow buttons' });
      return;
    }

    // Route legacy approvals through the old handler
    const isLegacy = !approval.workflow_type ||
      ['work_in_progress', 'pending_review', 'revision_requested'].includes(approval.status);
    if (isLegacy) {
      await handleLegacyReview(db, res, approval, action, notes, userId, role as string);
      return;
    }

    // Validate
    if (!['approve', 'reject'].includes(action)) {
      res.status(400).json({ error: 'action must be "approve" or "reject"' }); return;
    }
    if (action === 'reject' && !notes?.trim()) {
      res.status(400).json({ error: 'Rejection reason is required' }); return;
    }

    // ── Custom sequential flow ──────────────────────────────────────────────────
    if (approval.workflow_type === 'custom') {
      const flow = await db('task_approval_flow')
        .where({ task_id: approval.task_id })
        .orderBy('position')
        .select('user_id', 'position');

      const step = Number(approval.current_step ?? 0);
      const currentApprover = flow[step];
      if (!currentApprover || currentApprover.user_id !== userId) {
        res.status(403).json({ error: 'It is not your turn to approve this' }); return;
      }

      await db('approval_steps').insert({
        approval_id: approval.id,
        stage_key: `step_${step}`,
        required_role: role,
        action,
        actor_id: userId,
        actor_name: actorName,
        actor_role: role,
        comments: notes || null,
        acted_at: new Date(),
      });

      if (action === 'approve') {
        const nextStep = step + 1;
        if (nextStep < flow.length) {
          await db('approvals').where({ id: approval.id }).update({ current_step: nextStep });
          const next = flow[nextStep];
          await createNotification(next.user_id, `"${approval.title}" is waiting for your approval`, 'approval', approval.project_id);
          await createNotification(approval.submitted_by, `"${approval.title}" passed step ${step + 1} of ${flow.length}`, 'approval', approval.project_id);
        } else {
          // All steps approved
          await db('approvals').where({ id: approval.id }).update({ status: 'approved', final_approved_at: new Date() });
          await db('tasks').where({ id: approval.task_id }).update({ status: 'completed' });
          await closeTaskTimers(approval.task_id);
          await createNotification(approval.submitted_by, `Your work "${approval.title}" has been fully approved! ✓`, 'approval', approval.project_id);
        }
      } else {
        await db('approvals').where({ id: approval.id }).update({ status: 'rejected', rejected_by: userId, rejected_at: new Date(), rejection_notes: notes });
        await db('tasks').where({ id: approval.task_id }).update({ status: 'todo' });
        await closeTaskTimers(approval.task_id);
        await createNotification(approval.submitted_by, `"${approval.title}" was rejected by ${actorName}: ${notes}`, 'approval', approval.project_id);
      }

      res.json({ message: 'Updated' });
      return;
    }

    // ── Legacy role-based flow ──────────────────────────────────────────────────
    const workflow = WORKFLOWS[approval.workflow_type as WorkflowType];
    if (!workflow) { res.status(400).json({ error: 'Unknown workflow type' }); return; }

    const idx = stageIndex(workflow, approval.status);
    if (idx < 0) {
      res.status(400).json({ error: 'Approval is not in a reviewable state' }); return;
    }
    const currentStage = workflow[idx];

    // Role check
    if (role !== currentStage.role) {
      res.status(403).json({ error: `Stage "${currentStage.label}" requires a ${currentStage.role}` }); return;
    }
    // Client authorization check — match via company link or explicit project membership
    if (currentStage.role === 'client') {
      const [clientUser, project] = await Promise.all([
        db('users').where({ id: userId }).select('client_company_id').first(),
        db('projects').where({ id: approval.project_id }).select('client_company_id').first(),
      ]);
      const byCompany = clientUser?.client_company_id && project?.client_company_id &&
        clientUser.client_company_id === project.client_company_id;
      const byMember = !byCompany && await db('project_members').where({ project_id: approval.project_id, user_id: userId }).first();
      if (!byCompany && !byMember) { res.status(403).json({ error: 'Not authorized for this project' }); return; }
    }

    const updates: any = {};

    const isClientAction = currentStage.role === 'client';

    // Helper: send to submitter only if they haven't suppressed client notifications
    const notifySubmitter = async (message: string) => {
      if (isClientAction && !(await isNotifEnabled(approval.submitted_by, approval.project_id, 'approvals'))) return;
      await createNotification(approval.submitted_by, message, 'approval', approval.project_id);
    };

    const clientPrefKey: 'approvals' | undefined = isClientAction ? 'approvals' : undefined;

    if (action === 'approve') {
      const next = nextStage(workflow, approval.status);
      if (next) {
        updates.status = next.status;
        await notifyByRole(db, next.role, approval.project_id,
          `"${approval.title}" passed ${currentStage.label} — now at ${next.label}`, clientPrefKey);
        await notifySubmitter(`Your submission "${approval.title}" passed ${currentStage.label}`);
      } else {
        // Final stage approved → fully done
        updates.status = 'approved';
        updates.final_approved_by = userId;
        updates.final_approved_at = new Date();
        await db('tasks').where({ id: approval.task_id }).update({ status: 'completed' });
        await closeTaskTimers(approval.task_id);
        await notifySubmitter(`Your work "${approval.title}" has been fully approved! ✓`);
      }

    } else {
      // action === 'reject'
      const prev = prevStage(workflow, approval.status);
      if (prev) {
        // Return to previous stage
        updates.status = prev.status;
        await notifyByRole(db, prev.role, approval.project_id,
          `"${approval.title}" was rejected at ${currentStage.label} and returned to ${prev.label}`, clientPrefKey);
        await notifySubmitter(`"${approval.title}" was rejected at ${currentStage.label}: ${notes}`);
      } else {
        // First stage rejected → full rejection back to submitter
        updates.status = 'rejected';
        updates.rejected_by = userId;
        updates.rejected_at = new Date();
        updates.rejection_notes = notes;
        await db('tasks').where({ id: approval.task_id }).update({ status: 'todo' });
        await closeTaskTimers(approval.task_id);
        await notifySubmitter(`"${approval.title}" was rejected: ${notes}`);
      }
    }

    await db('approvals').where({ id: req.params.id }).update(updates);

    // Append step to audit trail
    await db('approval_steps').insert({
      approval_id: approval.id,
      stage_key: currentStage.status,
      required_role: currentStage.role,
      action,
      actor_id: userId,
      actor_name: actorName,
      actor_role: role,
      comments: notes || null,
      acted_at: new Date(),
    });

    res.json({ message: 'Updated', status: updates.status });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Legacy review (old workflow statuses) ────────────────────────────────────

async function handleLegacyReview(
  db: any, res: Response, approval: any,
  action: string, notes: string, userId: number, role: string
) {
  const updates: any = {};

  if (role === 'manager' && approval.status === 'pending_manager') {
    if (action === 'approve') {
      updates.status = 'pending_admin';
      updates.manager_approved_by = userId;
      updates.manager_approved_at = new Date();
      updates.manager_notes = notes || null;
      await notifyAdmins(db, `"${approval.title}" passed manager review`, approval.project_id);
    } else {
      if (!notes?.trim()) { res.status(400).json({ error: 'Rejection reason required' }); return; }
      updates.status = 'rejected';
      updates.rejected_by = userId;
      updates.rejected_at = new Date();
      updates.rejection_notes = notes;
      await db('tasks').where({ id: approval.task_id }).update({ status: 'todo' });
      await closeTaskTimers(approval.task_id);
      await createNotification(approval.submitted_by, `"${approval.title}" was rejected by manager: ${notes}`, 'approval', approval.project_id);
    }

  } else if (role === 'admin' && approval.status === 'pending_admin') {
    if (action === 'approve') {
      updates.status = 'pending_client';
      updates.admin_approved_by = userId;
      updates.admin_approved_at = new Date();
      updates.admin_notes = notes || null;
      await notifyProjectClients(db, approval.project_id, `"${approval.title}" awaits your review`);
    } else {
      if (!notes?.trim()) { res.status(400).json({ error: 'Rejection reason required' }); return; }
      updates.status = 'rejected';
      updates.rejected_by = userId;
      updates.rejected_at = new Date();
      updates.rejection_notes = notes;
      await db('tasks').where({ id: approval.task_id }).update({ status: 'todo' });
      await closeTaskTimers(approval.task_id);
      await createNotification(approval.submitted_by, `"${approval.title}" was rejected by admin: ${notes}`, 'approval', approval.project_id);
    }

  } else if (role === 'client' && approval.status === 'pending_client') {
    const [clientUser, project] = await Promise.all([
      db('users').where({ id: userId }).select('client_company_id').first(),
      db('projects').where({ id: approval.project_id }).select('client_company_id').first(),
    ]);
    const byCompany = clientUser?.client_company_id && project?.client_company_id &&
      clientUser.client_company_id === project.client_company_id;
    const byMember = !byCompany && await db('project_members').where({ project_id: approval.project_id, user_id: userId }).first();
    if (!byCompany && !byMember) { res.status(403).json({ error: 'Not authorized' }); return; }

    if (action === 'approve') {
      updates.status = 'work_in_progress';
      await db('tasks').where({ id: approval.task_id }).update({ status: 'in_progress' });
      await createNotification(approval.submitted_by, `Client approved "${approval.title}"`, 'approval', approval.project_id);
    } else {
      if (!notes?.trim()) { res.status(400).json({ error: 'Rejection reason required' }); return; }
      updates.status = 'rejected';
      updates.rejected_by = userId;
      updates.rejected_at = new Date();
      updates.rejection_notes = notes;
      await db('tasks').where({ id: approval.task_id }).update({ status: 'todo' });
      await closeTaskTimers(approval.task_id);
      await createNotification(approval.submitted_by, `"${approval.title}" was rejected by client: ${notes}`, 'approval', approval.project_id);
    }

  } else if (approval.status === 'pending_review') {
    if (action === 'approve') {
      updates.status = 'approved';
      updates.final_approved_by = userId;
      updates.final_approved_at = new Date();
      updates.final_notes = notes || null;
      await db('tasks').where({ id: approval.task_id }).update({ status: 'completed' });
      await closeTaskTimers(approval.task_id);
      await createNotification(approval.submitted_by, `Work on "${approval.title}" approved!`, 'approval', approval.project_id);
    } else if (action === 'request_revision') {
      updates.status = 'revision_requested';
      updates.revision_notes = notes || null;
      await db('tasks').where({ id: approval.task_id }).update({ status: 'in_progress' });
      await createNotification(approval.submitted_by, `Revision requested on "${approval.title}"`, 'approval', approval.project_id);
    }

  } else if (approval.status === 'revision_requested') {
    // Resubmission: go back to pending_review
    updates.status = 'pending_review';
    updates.work_submitted_at = new Date();
    await db('tasks').where({ id: approval.task_id }).update({ status: 'in_review' });
    await notifyManagers(db, `"${approval.title}" resubmitted for review`, approval.project_id);
    await notifyAdmins(db, `"${approval.title}" resubmitted for review`, approval.project_id);

  } else {
    res.status(403).json({ error: 'Not authorized for this action at current stage' }); return;
  }

  if (!Object.keys(updates).length) {
    res.status(400).json({ error: 'Invalid action for current status' }); return;
  }

  await db('approvals').where({ id: approval.id }).update(updates);
  res.json({ message: 'Updated', status: updates.status });
}

// ─── POST mark complete (legacy work_in_progress) ────────────────────────────

router.post('/:id/complete', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const approval = await db('approvals').where({ id: req.params.id }).first();
    if (!approval) { res.status(404).json({ error: 'Not found' }); return; }
    if (approval.status !== 'work_in_progress') {
      res.status(400).json({ error: 'Not in work_in_progress stage' }); return;
    }
    await db('approvals').where({ id: req.params.id }).update({
      status: 'pending_review',
      work_submitted_at: new Date(),
    });
    await db('tasks').where({ id: approval.task_id }).update({ status: 'in_review' });
    await notifyManagers(db, `"${approval.title}" is ready for review`, approval.project_id);
    await notifyAdmins(db, `"${approval.title}" is ready for review`, approval.project_id);
    res.json({ message: 'Moved to pending_review' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
