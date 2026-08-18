import { Router, Response } from 'express';
import { authenticate as authMiddleware, AuthRequest } from '../middleware/auth';
import { getDB } from '../db';
import { createNotification } from '../db';

const router = Router();
router.use(authMiddleware);

function requireAdmin(req: AuthRequest, res: Response): boolean {
  if (req.user!.role !== 'admin') { res.status(403).json({ error: 'Admin only' }); return false; }
  return true;
}

function parseTicketType(row: any) {
  return {
    ...row,
    stages: JSON.parse(row.stages || '[]'),
    final_approval: JSON.parse(row.final_approval || '{}'),
  };
}

async function appendLog(task_id: number, actor: { id: number; name: string } | null, action: string, from_state: string | null, to_state: string | null, comment?: string) {
  await getDB()('xlr8_ticket_log').insert({
    task_id,
    actor_id: actor?.id ?? null,
    actor_name: actor?.name ?? 'System',
    action,
    from_state,
    to_state,
    comment: comment || null,
    created_at: new Date(),
  });
}

// ── Ticket Types CRUD (admin only) ──────────────────────────────────────────

router.get('/ticket-types', async (_req: AuthRequest, res: Response) => {
  const rows = await getDB()('xlr8_ticket_types').orderBy('name');
  res.json(rows.map(parseTicketType));
});

router.post('/ticket-types', async (req: AuthRequest, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const { name, stages, final_approval } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: 'Name required' }); return; }
  const [id] = await getDB()('xlr8_ticket_types').insert({
    name: name.trim(),
    stages: JSON.stringify(stages || []),
    final_approval: JSON.stringify(final_approval || { adminRequired: true, adminSkippable: true, clientOptional: true }),
  });
  res.status(201).json({ id });
});

router.put('/ticket-types/:id', async (req: AuthRequest, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const { name, stages, final_approval } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: 'Name required' }); return; }
  await getDB()('xlr8_ticket_types').where({ id: req.params.id }).update({
    name: name.trim(),
    stages: JSON.stringify(stages || []),
    final_approval: JSON.stringify(final_approval || {}),
  });
  res.json({ ok: true });
});

router.delete('/ticket-types/:id', async (req: AuthRequest, res: Response) => {
  if (!requireAdmin(req, res)) return;
  await getDB()('xlr8_ticket_types').where({ id: req.params.id }).delete();
  res.json({ ok: true });
});

// ── Tickets (XLR8 tasks with workflow) ─────────────────────────────────────

// List XLR8 tickets for a project
router.get('/tickets', async (req: AuthRequest, res: Response) => {
  const { project_id } = req.query as { project_id?: string };
  const db = getDB();
  let q = db('tasks as t')
    .join('projects as p', 'p.id', 't.project_id')
    .leftJoin('users as creator', 'creator.id', 't.created_by')
    .leftJoin('users as assignee', 'assignee.id', 't.xlr8_assignee_id')
    .leftJoin('xlr8_ticket_types as tt', 'tt.id', 't.ticket_type_id')
    .whereNotNull('t.ticket_type_id')
    .select(
      't.id', 't.title', 't.description', 't.status', 't.xlr8_status', 't.xlr8_stage_idx',
      't.ticket_type_id', 't.created_at', 't.project_id', 't.xlr8_assignee_id',
      'p.name as project_name',
      'creator.id as creator_id', 'creator.name as creator_name',
      'assignee.name as assignee_name', 'assignee.avatar_color as assignee_color',
      'tt.name as ticket_type_name', 'tt.stages', 'tt.final_approval',
    );
  if (project_id) q = q.where('t.project_id', project_id);
  const rows = await q.orderBy('t.created_at', 'desc');
  res.json(rows.map((r: any) => ({
    ...r,
    stages: JSON.parse(r.stages || '[]'),
    final_approval: JSON.parse(r.final_approval || '{}'),
  })));
});

// Create a ticket (XLR8 project task)
router.post('/tickets', async (req: AuthRequest, res: Response) => {
  const { title, description, project_id, ticket_type_id, due_date } = req.body;
  if (!title?.trim() || !project_id || !ticket_type_id) {
    res.status(400).json({ error: 'title, project_id, ticket_type_id required' }); return;
  }
  const db = getDB();
  const project = await db('projects').where({ id: project_id, service_type: 'xlr8' }).first();
  if (!project) { res.status(400).json({ error: 'Project is not an XLR8 project' }); return; }

  const ticketType = await db('xlr8_ticket_types').where({ id: ticket_type_id }).first();
  if (!ticketType) { res.status(400).json({ error: 'Ticket type not found' }); return; }

  const stages: any[] = JSON.parse(ticketType.stages || '[]');
  const firstStage = stages[0];

  const [id] = await db('tasks').insert({
    title: title.trim(),
    description: description || null,
    project_id,
    created_by: req.user!.id,
    due_date: due_date || null,
    status: 'todo',
    ticket_type_id,
    xlr8_stage_idx: 0,
    xlr8_status: 'pending_manager',
    checklist_total: 0,
    checklist_done: 0,
  });

  await appendLog(id, req.user!, 'created', null, 'pending_manager');

  // Notify managers to assign a worker for stage 1
  const managers = await db('users').whereIn('role', ['manager', 'admin']).select('id');
  for (const m of managers) {
    if (m.id !== req.user!.id) {
      await createNotification(m.id, `New ticket "${title}" needs a ${firstStage?.category_name ?? 'worker'} assigned`, 'task', project_id);
    }
  }

  res.status(201).json({ id });
});

// Get ticket detail + log
router.get('/tickets/:id', async (req: AuthRequest, res: Response) => {
  const db = getDB();
  const ticket = await db('tasks as t')
    .leftJoin('users as creator', 'creator.id', 't.created_by')
    .leftJoin('users as assignee', 'assignee.id', 't.xlr8_assignee_id')
    .leftJoin('xlr8_ticket_types as tt', 'tt.id', 't.ticket_type_id')
    .where('t.id', req.params.id)
    .whereNotNull('t.ticket_type_id')
    .select(
      't.*',
      'creator.name as creator_name', 'creator.avatar_color as creator_color',
      'assignee.name as assignee_name', 'assignee.avatar_color as assignee_color',
      'tt.name as ticket_type_name', 'tt.stages', 'tt.final_approval',
    )
    .first();
  if (!ticket) { res.status(404).json({ error: 'Ticket not found' }); return; }
  const log = await db('xlr8_ticket_log').where({ task_id: req.params.id }).orderBy('created_at', 'asc');
  res.json({
    ...ticket,
    stages: JSON.parse(ticket.stages || '[]'),
    final_approval: JSON.parse(ticket.final_approval || '{}'),
    log,
  });
});

// Manager: accept ticket → query assignees for stage category, auto-assign or return list
router.post('/tickets/:id/accept', async (req: AuthRequest, res: Response) => {
  const db = getDB();
  // Only accept when no assignee yet (not a work-done review)
  const ticket = await db('tasks').where({ id: req.params.id, xlr8_status: 'pending_manager' }).whereNull('xlr8_assignee_id').first();
  if (!ticket) { res.status(404).json({ error: 'Ticket not found or not pending assignment' }); return; }
  if (!['admin', 'manager'].includes(req.user!.role)) { res.status(403).json({ error: 'Manager only' }); return; }

  const ticketType = await db('xlr8_ticket_types').where({ id: ticket.ticket_type_id }).first();
  const stages: any[] = JSON.parse(ticketType?.stages || '[]');
  const stage = stages[ticket.xlr8_stage_idx ?? 0];
  if (!stage) { res.status(400).json({ error: 'No stage defined for this ticket type' }); return; }

  // Find eligible employees in this category, filtered to manager's pod
  const actor = await db('users').where({ id: req.user!.id }).select('pod', 'role').first();
  let eligibleQuery = db('users as u')
    .join('user_categories as uc', 'uc.user_id', 'u.id')
    .join('employee_categories as ec', 'ec.id', 'uc.category_id')
    .where('ec.name', stage.category_name)
    .where('u.role', 'employee');
  if (actor?.pod) eligibleQuery = eligibleQuery.where('u.pod', actor.pod);
  const eligible = await eligibleQuery.select('u.id', 'u.name', 'u.avatar_color');

  if (eligible.length === 0) {
    res.status(400).json({ error: `No employees found in category "${stage.category_name}". Please assign someone to this category first.` });
    return;
  }

  if (eligible.length === 1) {
    // Auto-assign
    await assignToEmployee(db, ticket, eligible[0], req.user!, stage, 'auto');
    res.json({ auto_assigned: true, assignee: eligible[0] });
  } else {
    // Return list for manager to pick
    res.json({ auto_assigned: false, eligible });
  }
});

// Manager: assign a specific employee (after seeing the list)
router.post('/tickets/:id/assign', async (req: AuthRequest, res: Response) => {
  const { assignee_id } = req.body;
  if (!assignee_id) { res.status(400).json({ error: 'assignee_id required' }); return; }
  if (!['admin', 'manager'].includes(req.user!.role)) { res.status(403).json({ error: 'Manager only' }); return; }

  const db = getDB();
  const ticket = await db('tasks').where({ id: req.params.id, xlr8_status: 'pending_manager' }).whereNull('xlr8_assignee_id').first();
  if (!ticket) { res.status(404).json({ error: 'Ticket not found or not pending assignment' }); return; }

  const ticketType = await db('xlr8_ticket_types').where({ id: ticket.ticket_type_id }).first();
  const stages: any[] = JSON.parse(ticketType?.stages || '[]');
  const stage = stages[ticket.xlr8_stage_idx ?? 0];

  const assignee = await db('users').where({ id: assignee_id }).first();
  if (!assignee) { res.status(404).json({ error: 'User not found' }); return; }

  await assignToEmployee(db, ticket, assignee, req.user!, stage, 'manual');
  res.json({ ok: true });
});

async function assignToEmployee(db: any, ticket: any, assignee: any, actor: any, stage: any, mode: 'auto' | 'manual') {
  await db('tasks').where({ id: ticket.id }).update({
    xlr8_status: 'pending_assignee',
    xlr8_assignee_id: assignee.id,
    assigned_to: assignee.id,
  });
  await appendLog(ticket.id, actor, 'assigned', 'pending_manager', 'pending_assignee',
    `${mode === 'auto' ? 'Auto-assigned' : 'Assigned'} to ${assignee.name} (${stage?.category_name || 'unknown role'})`);
  await createNotification(assignee.id, `Ticket "${ticket.title}" has been assigned to you`, 'task', ticket.project_id);
  // notify requester
  if (ticket.created_by !== actor.id) {
    await createNotification(ticket.created_by, `Your ticket "${ticket.title}" was accepted and assigned to ${assignee.name}`, 'task', ticket.project_id);
  }
}

// Assignee: accept the assignment (or self-assign if no assignee yet)
router.post('/tickets/:id/employee-accept', async (req: AuthRequest, res: Response) => {
  if (req.user!.role !== 'employee') { res.status(403).json({ error: 'Employees only' }); return; }
  const db = getDB();
  const ticket = await db('tasks')
    .where({ id: req.params.id, xlr8_status: 'pending_assignee' })
    .where(function () { this.where('xlr8_assignee_id', req.user!.id).orWhereNull('xlr8_assignee_id'); })
    .first();
  if (!ticket) { res.status(404).json({ error: 'Ticket not found or not available' }); return; }

  await db('tasks').where({ id: ticket.id }).update({ xlr8_status: 'in_progress', status: 'in_progress', xlr8_assignee_id: req.user!.id, assigned_to: req.user!.id });
  await appendLog(ticket.id, req.user!, 'employee_accepted', 'pending_assignee', 'in_progress');
  if (ticket.created_by !== req.user!.id) {
    await createNotification(ticket.created_by, `${req.user!.name} accepted your ticket "${ticket.title}" and has started working`, 'task', ticket.project_id);
  }
  res.json({ ok: true });
});

// Assignee: decline the assignment → back to manager to reassign
router.post('/tickets/:id/employee-decline', async (req: AuthRequest, res: Response) => {
  const db = getDB();
  const ticket = await db('tasks').where({ id: req.params.id, xlr8_status: 'pending_assignee', xlr8_assignee_id: req.user!.id }).first();
  if (!ticket) { res.status(404).json({ error: 'Ticket not found or not assigned to you' }); return; }

  await db('tasks').where({ id: ticket.id }).update({ xlr8_status: 'pending_manager', xlr8_assignee_id: null, assigned_to: null, status: 'todo' });
  await appendLog(ticket.id, req.user!, 'employee_declined', 'pending_assignee', 'pending_manager', req.body.comment || null);

  const managers = await db('users').where({ role: 'manager' }).orWhere({ role: 'admin' }).select('id');
  for (const m of managers) {
    await createNotification(m.id, `${req.user!.name} declined ticket "${ticket.title}" — please reassign`, 'task', ticket.project_id);
  }
  res.json({ ok: true });
});

// Assignee: mark work done → close timer, log time, back to manager for review, submit to Approvals
router.post('/tickets/:id/done', async (req: AuthRequest, res: Response) => {
  const db = getDB();
  const userId = req.user!.id;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  const ticket = await db('tasks').where({ id: req.params.id, xlr8_status: 'in_progress', xlr8_assignee_id: userId }).first();
  if (!ticket) { res.status(404).json({ error: 'Ticket not found or not in progress by you' }); return; }

  // Close open timer session and log time
  const openSession = await db('task_sessions').where({ task_id: ticket.id, user_id: userId }).whereNull('ended_at').first();
  if (openSession) {
    await db('task_sessions').where({ id: openSession.id }).update({ ended_at: now });
    const hrs = (now.getTime() - new Date(openSession.started_at).getTime()) / 3600000;
    if (hrs >= 0.001) {
      const userRec = await db('users').where({ id: userId }).select('monthly_salary').first();
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const hourlyRate = userRec?.monthly_salary ? Number(userRec.monthly_salary) / daysInMonth / 7 : null;
      await db('time_logs').insert({
        task_id: ticket.id, project_id: ticket.project_id, user_id: userId,
        task_session_id: openSession.id,
        log_date: today, hours: Math.round(hrs * 100) / 100,
        hourly_rate: hourlyRate,
      });
    }
  }

  await db('tasks').where({ id: ticket.id }).update({ xlr8_status: 'pending_manager', status: 'in_review' });
  await appendLog(ticket.id, req.user!, 'work_done', 'in_progress', 'pending_manager');

  // Create/update approval record for visibility in Approvals page
  const existingApproval = await db('approvals').where({ task_id: ticket.id }).whereNotIn('status', ['approved', 'rejected']).first();
  if (!existingApproval) {
    await db('approvals').insert({
      task_id: ticket.id,
      title: ticket.title,
      project_id: ticket.project_id,
      submitted_by: userId,
      status: 'pending_manager',
      workflow_type: 'xlr8',
    });
    const managers = await db('users').where({ role: 'manager' }).orWhere({ role: 'admin' }).select('id');
    for (const m of managers) {
      if (m.id !== userId) {
        await createNotification(m.id, `Ticket "${ticket.title}" is ready for your review`, 'approval', ticket.project_id);
      }
    }
  } else {
    // Ensure workflow_type is always xlr8 and status is pending_manager (covers stale 'employee' records)
    await db('approvals').where({ id: existingApproval.id }).update({ status: 'pending_manager', workflow_type: 'xlr8' });
  }

  res.json({ ok: true });
});

// Manager: approve or decline after work done
router.post('/tickets/:id/review', async (req: AuthRequest, res: Response) => {
  const { action, comment, skip_admin } = req.body; // action: 'approve' | 'decline'
  if (!['approve', 'decline'].includes(action)) { res.status(400).json({ error: 'action must be approve or decline' }); return; }
  if (!['admin', 'manager'].includes(req.user!.role)) { res.status(403).json({ error: 'Manager only' }); return; }

  const db = getDB();
  const ticket = await db('tasks').where({ id: req.params.id, xlr8_status: 'pending_manager' }).whereNotNull('xlr8_assignee_id').first();
  if (!ticket) { res.status(404).json({ error: 'Ticket not found or not pending manager review' }); return; }

  const ticketType = await db('xlr8_ticket_types').where({ id: ticket.ticket_type_id }).first();
  const stages: any[] = JSON.parse(ticketType?.stages || '[]');
  const finalApproval = JSON.parse(ticketType?.final_approval || '{}');
  const currentStageIdx = ticket.xlr8_stage_idx ?? 0;

  if (action === 'decline') {
    await db('task_sessions').where({ task_id: ticket.id }).whereNull('ended_at').update({ ended_at: new Date() });
    await db('tasks').where({ id: ticket.id }).update({ xlr8_status: 'pending_assignee', status: 'in_progress' });
    await appendLog(ticket.id, req.user!, 'manager_declined', 'pending_manager', 'pending_assignee', comment);
    if (ticket.xlr8_assignee_id) {
      await createNotification(ticket.xlr8_assignee_id, `Ticket "${ticket.title}" was declined: ${comment || 'No reason given'}`, 'task', ticket.project_id);
    }
    res.json({ ok: true }); return;
  }

  // Close any open review timer for this manager before advancing
  await db('task_sessions').where({ task_id: ticket.id }).whereNull('ended_at').update({ ended_at: new Date() });

  // Approve — advance to next stage or final
  const nextStageIdx = currentStageIdx + 1;
  await appendLog(ticket.id, req.user!, 'manager_approved', 'pending_manager', null, comment);

  if (nextStageIdx < stages.length) {
    // More stages remain — go back to manager to assign the next stage worker
    const nextStage = stages[nextStageIdx];
    await db('tasks').where({ id: ticket.id }).update({
      xlr8_status: 'pending_manager',
      xlr8_stage_idx: nextStageIdx,
      xlr8_assignee_id: null,
      assigned_to: null,
      status: 'todo',
    });
    // Move approval to work_in_progress so it's not shown as reviewable
    const interApproval = await db('approvals').where({ task_id: ticket.id }).whereNotIn('status', ['approved', 'rejected']).first();
    if (interApproval) await db('approvals').where({ id: interApproval.id }).update({ status: 'work_in_progress', workflow_type: 'xlr8' });
    await appendLog(ticket.id, req.user!, 'next_stage', 'pending_manager', 'pending_manager', `Stage ${nextStageIdx + 1}: ${nextStage?.category_name}`);
    const managers = await db('users').whereIn('role', ['manager', 'admin']).select('id');
    for (const m of managers) {
      await createNotification(m.id, `Ticket "${ticket.title}" stage approved — assign a ${nextStage?.category_name} for stage ${nextStageIdx + 1}`, 'task', ticket.project_id);
    }
    res.json({ ok: true, next: 'pending_manager', stage: nextStage }); return;
  }

  // All stages done — final approval
  const approval = await db('approvals').where({ task_id: ticket.id }).whereNotIn('status', ['approved', 'rejected']).first();

  if (finalApproval.adminRequired && !skip_admin) {
    await db('tasks').where({ id: ticket.id }).update({ xlr8_status: 'pending_admin' });
    if (approval) await db('approvals').where({ id: approval.id }).update({ status: 'pending_admin', workflow_type: 'xlr8' });
    await appendLog(ticket.id, req.user!, 'sent_to_admin', 'pending_manager', 'pending_admin');
    const admins = await db('users').where({ role: 'admin' }).select('id');
    for (const a of admins) {
      await createNotification(a.id, `Ticket "${ticket.title}" needs your final approval`, 'task', ticket.project_id);
    }
    res.json({ ok: true, next: 'pending_admin' }); return;
  }

  if (finalApproval.clientOptional && (skip_admin || !finalApproval.adminRequired)) {
    await db('tasks').where({ id: ticket.id }).update({ xlr8_status: 'pending_client' });
    if (approval) await db('approvals').where({ id: approval.id }).update({ status: 'pending_client', workflow_type: 'xlr8' });
    await appendLog(ticket.id, req.user!, 'admin_skipped', 'pending_manager', 'pending_client', 'Admin skipped by manager');
    const clientUsers = await db('users').where({ role: 'client' }).select('id');
    for (const c of clientUsers) {
      await createNotification(c.id, `Ticket "${ticket.title}" is ready for your review`, 'task', ticket.project_id);
    }
    res.json({ ok: true, next: 'pending_client' }); return;
  }

  // No admin, no client — complete
  await completeTicket(db, ticket, req.user!);
  if (approval) await db('approvals').where({ id: approval.id }).update({ status: 'approved', workflow_type: 'xlr8', final_approved_at: new Date() });
  res.json({ ok: true, next: 'completed' });
});

// Admin: approve final
router.post('/tickets/:id/admin-approve', async (req: AuthRequest, res: Response) => {
  if (req.user!.role !== 'admin') { res.status(403).json({ error: 'Admin only' }); return; }
  const db = getDB();
  const ticket = await db('tasks').where({ id: req.params.id, xlr8_status: 'pending_admin' }).first();
  if (!ticket) { res.status(404).json({ error: 'Ticket not pending admin approval' }); return; }
  await appendLog(ticket.id, req.user!, 'admin_approved', 'pending_admin', 'completed', req.body.comment);
  await completeTicket(db, ticket, req.user!);
  const approval = await db('approvals').where({ task_id: ticket.id }).whereNotIn('status', ['rejected']).first();
  if (approval) await db('approvals').where({ id: approval.id }).update({ status: 'approved', workflow_type: 'xlr8', final_approved_at: new Date(), admin_approved_by: req.user!.id, admin_approved_at: new Date() });
  res.json({ ok: true });
});

// Client: approve (optional)
router.post('/tickets/:id/client-approve', async (req: AuthRequest, res: Response) => {
  const db = getDB();
  const ticket = await db('tasks').where({ id: req.params.id, xlr8_status: 'pending_client' }).first();
  if (!ticket) { res.status(404).json({ error: 'Ticket not pending client approval' }); return; }
  await appendLog(ticket.id, req.user!, 'client_approved', 'pending_client', 'completed');
  await completeTicket(db, ticket, req.user!);
  const approval = await db('approvals').where({ task_id: ticket.id }).whereNotIn('status', ['rejected']).first();
  if (approval) await db('approvals').where({ id: approval.id }).update({ status: 'approved', workflow_type: 'xlr8', final_approved_at: new Date() });
  res.json({ ok: true });
});

// Get audit log for a ticket
router.get('/tickets/:id/log', async (req: AuthRequest, res: Response) => {
  const log = await getDB()('xlr8_ticket_log')
    .where({ task_id: req.params.id })
    .orderBy('created_at', 'asc');
  res.json(log);
});

async function completeTicket(db: any, ticket: any, actor: any) {
  await db('tasks').where({ id: ticket.id }).update({ xlr8_status: 'completed', status: 'completed' });
  await appendLog(ticket.id, actor, 'completed', ticket.xlr8_status, 'completed');
  if (ticket.created_by !== actor.id) {
    await createNotification(ticket.created_by, `Ticket "${ticket.title}" has been completed`, 'task', ticket.project_id);
  }
}

export default router;
