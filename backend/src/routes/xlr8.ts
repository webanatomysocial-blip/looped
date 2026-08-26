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
    checklist: JSON.parse(row.checklist || '[]'),
  };
}

// Stages without an explicit type are backward-compat employee stages
function stageType(stage: any): 'employee' | 'manager' {
  return stage?.type === 'manager' ? 'manager' : 'employee';
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
  const { name, stages, final_approval, checklist } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: 'Name required' }); return; }
  const [id] = await getDB()('xlr8_ticket_types').insert({
    name: name.trim(),
    stages: JSON.stringify(stages || []),
    final_approval: JSON.stringify(final_approval || { adminRequired: true, adminSkippable: true, clientOptional: true }),
    checklist: JSON.stringify(checklist || []),
  });
  res.status(201).json({ id });
});

router.put('/ticket-types/:id', async (req: AuthRequest, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const { name, stages, final_approval, checklist } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: 'Name required' }); return; }
  await getDB()('xlr8_ticket_types').where({ id: req.params.id }).update({
    name: name.trim(),
    stages: JSON.stringify(stages || []),
    final_approval: JSON.stringify(final_approval || {}),
    checklist: JSON.stringify(checklist || []),
  });
  res.json({ ok: true });
});

router.delete('/ticket-types/:id', async (req: AuthRequest, res: Response) => {
  if (!requireAdmin(req, res)) return;
  await getDB()('xlr8_ticket_types').where({ id: req.params.id }).delete();
  res.json({ ok: true });
});

// ── Tickets (XLR8 tasks with workflow) ─────────────────────────────────────

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
  // Pod scoping: managers only see their pod's projects
  if (req.user!.role === 'manager') {
    const mgr = await db('users').where({ id: req.user!.id }).select('pod').first();
    if (mgr?.pod) q = q.where('p.pod', mgr.pod);
  }
  const rows = await q.orderBy('t.created_at', 'desc');
  res.json(rows.map((r: any) => ({
    ...r,
    stages: JSON.parse(r.stages || '[]'),
    final_approval: JSON.parse(r.final_approval || '{}'),
  })));
});

router.post('/tickets', async (req: AuthRequest, res: Response) => {
  const { title, description, project_id, ticket_type_id, due_date, stage_assignments } = req.body;
  // stage_assignments: [{ stage_idx, user_ids: number[], est_hours?: number }]
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

  const defaultChecklist: any[] = JSON.parse(ticketType.checklist || '[]').filter((i: any) => i.text);
  const checklistDone = defaultChecklist.filter((i: any) => i.checked).length;

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
    checklist_total: defaultChecklist.length,
    checklist_done: checklistDone,
  });

  if (defaultChecklist.length > 0) {
    await db('task_checklist').insert(defaultChecklist.map((i: any) => ({
      task_id: id, text: i.text, completed: i.checked ? 1 : 0,
    })));
  }

  // Store pre-assigned employees per stage
  if (Array.isArray(stage_assignments) && stage_assignments.length > 0) {
    const rows: any[] = [];
    for (const sa of stage_assignments) {
      if (!Array.isArray(sa.user_ids)) continue;
      for (const uid of sa.user_ids) {
        rows.push({ task_id: id, user_id: uid, assignee_role: 'employee', acceptance_status: 'pending', stage_idx: sa.stage_idx });
      }
    }
    if (rows.length > 0) await db('task_assignees').insert(rows);

    // Set estimated_hours to sum of all stage est_hours
    const totalHours = stage_assignments.reduce((sum: number, sa: any) => sum + (sa.est_hours || 0), 0);
    if (totalHours > 0) await db('tasks').where({ id }).update({ estimated_hours: totalHours });

    // Auto-advance: if stage 0 is an employee stage with a pre-assigned user, skip pending_manager
    if (firstStage && stageType(firstStage) === 'employee') {
      const stage0 = stage_assignments.find((sa: any) => sa.stage_idx === 0);
      if (stage0 && Array.isArray(stage0.user_ids) && stage0.user_ids.length > 0) {
        const assigneeId = stage0.user_ids[0];
        await db('tasks').where({ id }).update({
          xlr8_status: 'pending_assignee',
          xlr8_assignee_id: assigneeId,
          assigned_to: assigneeId,
        });
        await appendLog(id, req.user!, 'created', null, 'pending_assignee');
      } else {
        await appendLog(id, req.user!, 'created', null, 'pending_manager');
      }
    } else {
      await appendLog(id, req.user!, 'created', null, 'pending_manager');
    }
  } else {
    await appendLog(id, req.user!, 'created', null, 'pending_manager');
  }

  const stageName = firstStage && stageType(firstStage) === 'employee' ? firstStage.category_name : 'worker';
  const managers = await db('users').whereIn('role', ['manager', 'admin']).select('id');
  for (const m of managers) {
    if (m.id !== req.user!.id) {
      await createNotification(m.id, `New ticket "${title}" needs a ${stageName} assigned`, 'task', project_id);
    }
  }

  res.status(201).json({ id });
});

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

// Manager: start assignment — only valid when current stage is employee type
router.post('/tickets/:id/accept', async (req: AuthRequest, res: Response) => {
  const db = getDB();
  const ticket = await db('tasks').where({ id: req.params.id, xlr8_status: 'pending_manager' }).first();
  if (!ticket) { res.status(404).json({ error: 'Ticket not found or not pending assignment' }); return; }
  if (!['admin', 'manager'].includes(req.user!.role)) { res.status(403).json({ error: 'Manager only' }); return; }

  const ticketType = await db('xlr8_ticket_types').where({ id: ticket.ticket_type_id }).first();
  const stages: any[] = JSON.parse(ticketType?.stages || '[]');
  const currentStage = stages[ticket.xlr8_stage_idx ?? 0];

  // Reject if current stage is a manager-review stage (not assignment mode)
  if (currentStage && stageType(currentStage) === 'manager') {
    res.status(400).json({ error: 'Ticket is in manager review mode — use the review route' }); return;
  }

  // Clear stale assignee if present (happens after employee decline)
  if (ticket.xlr8_assignee_id) {
    await db('tasks').where({ id: ticket.id }).update({ xlr8_assignee_id: null, assigned_to: null });
    ticket.xlr8_assignee_id = null;
  }

  const stage = currentStage;
  if (!stage) { res.status(400).json({ error: 'No stage defined for this ticket type' }); return; }

  // Check for pre-assigned employee(s) for this stage
  const preAssigned = await db('task_assignees as ta')
    .join('users as u', 'u.id', 'ta.user_id')
    .where({ 'ta.task_id': ticket.id, 'ta.stage_idx': ticket.xlr8_stage_idx ?? 0, 'ta.assignee_role': 'employee' })
    .select('u.id', 'u.name', 'u.avatar_color');

  if (preAssigned.length === 1) {
    await assignToEmployee(db, ticket, preAssigned[0], req.user!, stage, 'auto');
    res.json({ auto_assigned: true, assignee: preAssigned[0] });
    return;
  }
  if (preAssigned.length > 1) {
    res.json({ auto_assigned: false, eligible: preAssigned });
    return;
  }

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
    await assignToEmployee(db, ticket, eligible[0], req.user!, stage, 'auto');
    res.json({ auto_assigned: true, assignee: eligible[0] });
  } else {
    res.json({ auto_assigned: false, eligible });
  }
});

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
  if (ticket.created_by !== actor.id) {
    await createNotification(ticket.created_by, `Your ticket "${ticket.title}" was accepted and assigned to ${assignee.name}`, 'task', ticket.project_id);
  }
}

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

// Employee: mark work done
router.post('/tickets/:id/done', async (req: AuthRequest, res: Response) => {
  const db = getDB();
  const userId = req.user!.id;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  const ticket = await db('tasks').where({ id: req.params.id, xlr8_status: 'in_progress', xlr8_assignee_id: userId }).first();
  if (!ticket) { res.status(404).json({ error: 'Ticket not found or not in progress by you' }); return; }

  // Close open timer and log time
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

  const ticketType = await db('xlr8_ticket_types').where({ id: ticket.ticket_type_id }).first();
  const stages: any[] = JSON.parse(ticketType?.stages || '[]');
  const currentIdx = ticket.xlr8_stage_idx ?? 0;
  const nextIdx = currentIdx + 1;
  const nextStage = stages[nextIdx];

  await appendLog(ticket.id, req.user!, 'work_done', 'in_progress', 'pending_manager');

  if (nextStage && stageType(nextStage) === 'employee') {
    // Next is an employee stage — skip manager review, go straight to assign mode
    await db('tasks').where({ id: ticket.id }).update({
      xlr8_status: 'pending_manager',
      xlr8_stage_idx: nextIdx,
      xlr8_assignee_id: null,
      assigned_to: null,
      status: 'todo',
    });
    // Create/update approval as work_in_progress so employee can see it but manager doesn't get a review action
    const approval = await db('approvals').where({ task_id: ticket.id }).whereNotIn('status', ['approved', 'rejected']).first();
    if (!approval) {
      await db('approvals').insert({
        task_id: ticket.id, title: ticket.title, project_id: ticket.project_id,
        submitted_by: userId, status: 'work_in_progress', workflow_type: 'xlr8',
      });
    } else {
      await db('approvals').where({ id: approval.id }).update({ status: 'work_in_progress', workflow_type: 'xlr8' });
    }
    const managers = await db('users').whereIn('role', ['manager', 'admin']).select('id');
    for (const m of managers) {
      await createNotification(m.id, `Ticket "${ticket.title}" stage done — assign a ${nextStage.category_name} for the next stage`, 'task', ticket.project_id);
    }
  } else {
    // Next is a manager stage OR no more stages — pending_manager for review
    const newIdx = (nextStage && stageType(nextStage) === 'manager') ? nextIdx : currentIdx;
    await db('tasks').where({ id: ticket.id }).update({ xlr8_status: 'pending_manager', xlr8_stage_idx: newIdx, status: 'in_review' });

    // Create/update approval record for Approvals page
    const existingApproval = await db('approvals').where({ task_id: ticket.id }).whereNotIn('status', ['approved', 'rejected']).first();
    if (!existingApproval) {
      await db('approvals').insert({
        task_id: ticket.id, title: ticket.title, project_id: ticket.project_id,
        submitted_by: userId, status: 'pending_manager', workflow_type: 'xlr8',
      });
    } else {
      await db('approvals').where({ id: existingApproval.id }).update({ status: 'pending_manager', workflow_type: 'xlr8' });
    }
    const managers = await db('users').whereIn('role', ['manager', 'admin']).select('id');
    for (const m of managers) {
      if (m.id !== userId) {
        await createNotification(m.id, `Ticket "${ticket.title}" is ready for your review`, 'approval', ticket.project_id);
      }
    }
  }

  res.json({ ok: true });
});

// Manager: approve or decline after work done (or at an explicit manager stage)
router.post('/tickets/:id/review', async (req: AuthRequest, res: Response) => {
  const { action, comment, skip_admin } = req.body;
  if (!['approve', 'decline'].includes(action)) { res.status(400).json({ error: 'action must be approve or decline' }); return; }
  if (!['admin', 'manager'].includes(req.user!.role)) { res.status(403).json({ error: 'Manager only' }); return; }

  const db = getDB();
  // Allow review when: assignee_id is set (employee just finished) OR current stage is manager type
  const ticket = await db('tasks').where({ id: req.params.id, xlr8_status: 'pending_manager' }).first();
  if (!ticket) { res.status(404).json({ error: 'Ticket not found or not pending manager review' }); return; }

  const ticketType = await db('xlr8_ticket_types').where({ id: ticket.ticket_type_id }).first();
  const stages: any[] = JSON.parse(ticketType?.stages || '[]');
  const finalApproval = JSON.parse(ticketType?.final_approval || '{}');
  const currentStageIdx = ticket.xlr8_stage_idx ?? 0;
  const currentStage = stages[currentStageIdx];

  // Must be in review mode: assignee set (work done) OR current stage is manager type
  const inReviewMode = !!ticket.xlr8_assignee_id || (currentStage && stageType(currentStage) === 'manager');
  if (!inReviewMode) {
    res.status(400).json({ error: 'Ticket is in assignment mode, not review mode' }); return;
  }

  if (action === 'decline') {
    await db('task_sessions').where({ task_id: ticket.id }).whereNull('ended_at').update({ ended_at: new Date() });
    await db('tasks').where({ id: ticket.id }).update({ xlr8_status: 'pending_assignee', status: 'in_progress' });
    await appendLog(ticket.id, req.user!, 'manager_declined', 'pending_manager', 'pending_assignee', comment);
    if (ticket.xlr8_assignee_id) {
      await createNotification(ticket.xlr8_assignee_id, `Ticket "${ticket.title}" was declined: ${comment || 'No reason given'}`, 'task', ticket.project_id);
    }
    res.json({ ok: true }); return;
  }

  await db('task_sessions').where({ task_id: ticket.id }).whereNull('ended_at').update({ ended_at: new Date() });

  const nextStageIdx = currentStageIdx + 1;
  const nextStage = stages[nextStageIdx];

  await appendLog(ticket.id, req.user!, 'manager_approved', 'pending_manager', null, comment);

  if (nextStage) {
    // More stages remain — advance to next stage
    await db('tasks').where({ id: ticket.id }).update({
      xlr8_status: 'pending_manager',
      xlr8_stage_idx: nextStageIdx,
      xlr8_assignee_id: null,
      assigned_to: null,
      status: 'todo',
    });
    const interApproval = await db('approvals').where({ task_id: ticket.id }).whereNotIn('status', ['approved', 'rejected']).first();
    if (interApproval) await db('approvals').where({ id: interApproval.id }).update({ status: 'work_in_progress', workflow_type: 'xlr8' });

    const stageName = stageType(nextStage) === 'employee' ? nextStage.category_name : 'Manager Review';
    await appendLog(ticket.id, req.user!, 'next_stage', 'pending_manager', 'pending_manager', `Stage ${nextStageIdx + 1}: ${stageName}`);
    const managers = await db('users').whereIn('role', ['manager', 'admin']).select('id');
    for (const m of managers) {
      const msg = stageType(nextStage) === 'employee'
        ? `Ticket "${ticket.title}" approved — assign a ${nextStage.category_name} for stage ${nextStageIdx + 1}`
        : `Ticket "${ticket.title}" approved — manager review required for stage ${nextStageIdx + 1}`;
      await createNotification(m.id, msg, 'task', ticket.project_id);
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

  await completeTicket(db, ticket, req.user!);
  if (approval) await db('approvals').where({ id: approval.id }).update({ status: 'approved', workflow_type: 'xlr8', final_approved_at: new Date() });
  res.json({ ok: true, next: 'completed' });
});

router.post('/tickets/:id/admin-approve', async (req: AuthRequest, res: Response) => {
  if (req.user!.role !== 'admin') { res.status(403).json({ error: 'Admin only' }); return; }
  const db = getDB();
  const ticket = await db('tasks').where({ id: req.params.id, xlr8_status: 'pending_admin' }).first();
  if (!ticket) { res.status(404).json({ error: 'Ticket not pending admin approval' }); return; }
  const ticketType = await db('xlr8_ticket_types').where({ id: ticket.ticket_type_id }).first();
  const finalApproval = ticketType?.final_approval ? JSON.parse(ticketType.final_approval) : {};
  const approval = await db('approvals').where({ task_id: ticket.id }).whereNotIn('status', ['rejected']).first();
  if (finalApproval.clientOptional) {
    await appendLog(ticket.id, req.user!, 'admin_approved', 'pending_admin', 'pending_client', req.body.comment);
    await db('tasks').where({ id: ticket.id }).update({ xlr8_status: 'pending_client' });
    if (approval) await db('approvals').where({ id: approval.id }).update({ status: 'pending_client', workflow_type: 'xlr8', admin_approved_by: req.user!.id, admin_approved_at: new Date() });
    const clientUsers = await db('users').where({ role: 'client' }).select('id');
    for (const c of clientUsers) {
      await createNotification(c.id, `Ticket "${ticket.title}" is ready for your review`, 'task', ticket.project_id);
    }
    res.json({ ok: true, next: 'pending_client' });
  } else {
    await appendLog(ticket.id, req.user!, 'admin_approved', 'pending_admin', 'completed', req.body.comment);
    await completeTicket(db, ticket, req.user!);
    if (approval) await db('approvals').where({ id: approval.id }).update({ status: 'approved', workflow_type: 'xlr8', final_approved_at: new Date(), admin_approved_by: req.user!.id, admin_approved_at: new Date() });
    res.json({ ok: true, next: 'completed' });
  }
});

router.post('/tickets/:id/admin-send-client', async (req: AuthRequest, res: Response) => {
  if (req.user!.role !== 'admin') { res.status(403).json({ error: 'Admin only' }); return; }
  const db = getDB();
  const ticket = await db('tasks').where({ id: req.params.id, xlr8_status: 'pending_admin' }).first();
  if (!ticket) { res.status(404).json({ error: 'Ticket not pending admin approval' }); return; }
  await appendLog(ticket.id, req.user!, 'admin_skip_client', 'pending_admin', 'completed', req.body.comment);
  await completeTicket(db, ticket, req.user!);
  const approval = await db('approvals').where({ task_id: ticket.id }).whereNotIn('status', ['rejected']).first();
  if (approval) await db('approvals').where({ id: approval.id }).update({ status: 'approved', workflow_type: 'xlr8', final_approved_at: new Date(), admin_approved_by: req.user!.id, admin_approved_at: new Date() });
  res.json({ ok: true });
});

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
