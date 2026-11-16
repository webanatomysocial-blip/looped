import { getDB, createNotification, isNotifEnabled } from '../db';
import { ServiceError, canManageTask } from './access';


// Close open timer sessions for a task and write time_logs for any unlogged time
export async function closeTaskTimers(taskId: number) {
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
      const now2 = new Date(); const daysInMonth = new Date(now2.getFullYear(), now2.getMonth() + 1, 0).getDate();
      const rate = user?.monthly_salary ? user.monthly_salary / daysInMonth / 7 : null;
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

export type WorkflowType = 'employee' | 'manager' | 'admin_with_client' | 'admin_no_client';

export interface WFStage {
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
export const WORKFLOWS: Record<WorkflowType, WFStage[]> = {
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

// Client Review only applies when the project has a client login (by company or as a member)
async function projectHasClient(db: any, projectId: number): Promise<boolean> {
  const p = await db('projects').where({ id: projectId }).select('client_company_id').first();
  const byCompany = p?.client_company_id && await db('users').where({ role: 'client', client_company_id: p.client_company_id }).first();
  const byMember = await db('project_members as pm').join('users as u', 'u.id', 'pm.user_id').where('pm.project_id', projectId).where('u.role', 'client').first();
  return !!(byCompany || byMember);
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

export async function notifyByRole(db: any, role: string, projectId: number, message: string, prefKey?: 'approvals' | 'responses' | 'comments') {
  if (role === 'manager') await notifyManagers(db, message, projectId, prefKey);
  else if (role === 'admin') await notifyAdmins(db, message, projectId, prefKey);
  else if (role === 'client') await notifyProjectClients(db, projectId, message);
}


// Collects the outcome the route would have sent: a status+error becomes a ServiceError, a success becomes the result
class Outcome {
  result: any = undefined;
  status(code: number) { return { json: (body: any) => { throw new ServiceError(code, body?.error ?? 'Error', body ?? {}); } }; }
  json(body: any) { this.result = body; }
}

// ─── Legacy review (old workflow statuses) ────────────────────────────────────

async function handleLegacyReview(
  db: any, res: Outcome, approval: any,
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
      await db('tasks').where({ id: approval.task_id }).update({ status: 'completed', completed_at: new Date() });
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


// ─── PUT review ───────────────────────────────────────────────────────────────

export async function reviewApproval(actor: { id: number; role: string; name?: string }, approvalId: number | string, body: any): Promise<any> {
  const res = new Outcome() as any;
  const { action, notes } = body ?? {};
  const { role, id: userId, name: actorName } = actor;

    const db = getDB();
    const approval = await db('approvals').where({ id: approvalId }).first();
    if (!approval) { res.status(404).json({ error: 'Not found' }); return; }

    // Managers decide only on tasks within their pod scope (same rule as the Tasks page)
    if (role === 'manager' && !(await canManageTask(db, actor, approval.task_id))) { res.status(403).json({ error: 'Not your pod — this approval belongs to another pod manager' }); return; }

    // XLR8 approvals are managed exclusively via /api/xlr8/tickets/:id/* routes
    if (approval.workflow_type === 'xlr8') {
      res.status(400).json({ error: 'XLR8 approvals must be actioned via the Tickets page workflow buttons' });
      return;
    }

    // Route legacy approvals through the old handler
    const isLegacy = !approval.workflow_type ||
      ['work_in_progress', 'pending_review', 'revision_requested'].includes(approval.status);
    if (isLegacy) {
      await handleLegacyReview(db, res, approval, action, notes, userId, role as string);
      return res.result;
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
      // Only an open request can be decided; a finished or rejected one must not run its steps again
      if (approval.status !== 'pending_custom') { res.status(400).json({ error: 'Approval is not in a reviewable state' }); return; }
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
          await db('tasks').where({ id: approval.task_id }).update({ status: 'completed', completed_at: new Date() });
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
      return res.result;
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

    const noClient = !(await projectHasClient(db, approval.project_id));
    if (action === 'approve') {
      let next = nextStage(workflow, approval.status);
      while (next && noClient && next.role === 'client') next = nextStage(workflow, next.status);
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
        await db('tasks').where({ id: approval.task_id }).update({ status: 'completed', completed_at: new Date() });
        await closeTaskTimers(approval.task_id);
        await notifySubmitter(`Your work "${approval.title}" has been fully approved! ✓`);
      }

    } else {
      // action === 'reject'
      // A rejection at any review step sends the work back to the person who did it (same as tickets)
      {
        updates.status = 'rejected';
        updates.rejected_by = userId;
        updates.rejected_at = new Date();
        updates.rejection_notes = notes;
        await db('tasks').where({ id: approval.task_id }).update({
          status: 'todo',
          ...(approval.workflow_type === 'xlr8' ? { xlr8_status: 'in_progress' } : {}),
        });
        await closeTaskTimers(approval.task_id);
        await notifySubmitter(`"${approval.title}" was rejected at ${currentStage.label}: ${notes}`);
      }
    }

    await db('approvals').where({ id: approvalId }).update(updates);

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
  return res.result;
}


// ─── POST mark complete (legacy work_in_progress) ────────────────────────────

export async function completeWork(actor: { id: number; role: string; name?: string }, approvalId: number | string): Promise<any> {
  const res = new Outcome() as any;
    const db = getDB();
    const approval = await db('approvals').where({ id: approvalId }).first();
    if (!approval) { res.status(404).json({ error: 'Not found' }); return; }
    if (approval.status !== 'work_in_progress') {
      res.status(400).json({ error: 'Not in work_in_progress stage' }); return;
    }
    // Only the people doing the work (or a manager/admin) can submit it
    if (!['admin', 'manager'].includes(actor.role)) {
      const t = await db('tasks').where({ id: approval.task_id }).select('assigned_to').first();
      const onIt = t?.assigned_to === actor.id || await db('task_assignees').where({ task_id: approval.task_id, user_id: actor.id }).whereNot('acceptance_status', 'declined').first();
      if (!onIt) { res.status(403).json({ error: 'Only the people working on this can submit it' }); return; }
    }
    await db('approvals').where({ id: approvalId }).update({
      status: 'pending_review',
      work_submitted_at: new Date(),
    });
    await db('tasks').where({ id: approval.task_id }).update({ status: 'in_review' });
    await notifyManagers(db, `"${approval.title}" is ready for review`, approval.project_id);
    await notifyAdmins(db, `"${approval.title}" is ready for review`, approval.project_id);
    res.json({ message: 'Moved to pending_review' });
  return res.result;
}


