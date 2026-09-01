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
function stageType(stage: any): 'employee' | 'manager' | 'admin' {
  if (stage?.type === 'manager') return 'manager';
  if (stage?.type === 'admin') return 'admin';
  return 'employee';
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
  const { title, description, project_id, ticket_type_id, due_date, stage_assignments, draft, priority } = req.body;
  // stage_assignments: [{ stage_idx, user_ids: number[], est_hours?: number }]
  if (!title?.trim() || !project_id) {
    res.status(400).json({ error: 'title and project_id required' }); return;
  }
  if (!draft && !ticket_type_id) {
    res.status(400).json({ error: 'ticket_type_id required' }); return;
  }
  const isDraft = !!draft;
  const db = getDB();
  const project = await db('projects').where({ id: project_id, service_type: 'xlr8' }).first();
  if (!project) { res.status(400).json({ error: 'Project is not an XLR8 project' }); return; }

  // For drafts, just save and return
  if (isDraft) {
    const [id] = await db('tasks').insert({
      title: title.trim(), description: description || null,
      project_id, created_by: req.user!.id,
      due_date: due_date || null, status: 'draft',
      ticket_type_id: ticket_type_id || null,
      xlr8_stage_idx: 0, xlr8_status: 'draft',
      priority: priority || 'medium',
    });
    await appendLog(id, req.user!, 'created', null, 'draft');
    res.status(201).json({ id }); return;
  }

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
    priority: priority || 'medium',
  });

  if (defaultChecklist.length > 0) {
    await db('task_checklist').insert(defaultChecklist.map((i: any) => ({
      task_id: id, text: i.text, completed: i.checked ? 1 : 0,
    })));
  }

  // Store pre-assigned users per stage (employee, manager, or admin)
  if (Array.isArray(stage_assignments) && stage_assignments.length > 0) {
    const rows: any[] = [];
    for (const sa of stage_assignments) {
      if (!Array.isArray(sa.user_ids)) continue;
      const stg = stages[sa.stage_idx];
      const sType = stg ? stageType(stg) : 'employee';
      const estH = sa.est_hours || null;
      if (sa.user_ids.length > 0) {
        for (const uid of sa.user_ids) {
          rows.push({ task_id: id, user_id: uid, assignee_role: sType, acceptance_status: 'pending', stage_idx: sa.stage_idx, est_hours: estH });
        }
      } else if (estH) {
        // No user yet (review stage with no pre-assignment) — store est_hours with a placeholder row
        rows.push({ task_id: id, user_id: null, assignee_role: sType, acceptance_status: 'pending', stage_idx: sa.stage_idx, est_hours: estH });
      }
    }
    if (rows.length > 0) await db('task_assignees').insert(rows);

    // Set estimated_hours to sum of all stage est_hours
    const totalHours = stage_assignments.reduce((sum: number, sa: any) => sum + (sa.est_hours || 0), 0);
    if (totalHours > 0) await db('tasks').where({ id }).update({ estimated_hours: totalHours });
  }

  // Auto-advance based on first stage type and pre-assignments
  const fType = firstStage ? stageType(firstStage) : null;
  const stage0sa = Array.isArray(stage_assignments) ? stage_assignments.find((sa: any) => sa.stage_idx === 0) : null;
  const preId0 = stage0sa?.user_ids?.[0] ?? null;

  const task0 = await db('tasks').where({ id }).first();
  if (fType === 'employee' && preId0) {
    await db('tasks').where({ id }).update({ xlr8_status: 'pending_assignee', xlr8_assignee_id: preId0, assigned_to: preId0 });
    await appendLog(id, req.user!, 'created', null, 'pending_assignee');
  } else if (fType === 'manager') {
    await db('tasks').where({ id }).update({ xlr8_status: 'pending_manager', xlr8_assignee_id: preId0, status: 'in_review' });
    await appendLog(id, req.user!, 'created', null, 'pending_manager');
    await db('approvals').insert({ task_id: id, title, project_id, submitted_by: req.user!.id, status: 'pending_manager', workflow_type: 'xlr8' });
  } else if (fType === 'admin') {
    await db('tasks').where({ id }).update({ xlr8_status: 'pending_admin', xlr8_assignee_id: preId0, status: 'in_review' });
    await appendLog(id, req.user!, 'created', null, 'pending_admin');
    await db('approvals').insert({ task_id: id, title, project_id, submitted_by: req.user!.id, status: 'pending_admin', workflow_type: 'xlr8' });
  } else {
    await appendLog(id, req.user!, 'created', null, 'pending_manager');
  }

  const stageName = fType === 'employee' ? (firstStage?.category_name || 'worker') : fType === 'manager' ? 'Manager Review' : fType === 'admin' ? 'Admin Review' : 'worker';
  const managers = await db('users').whereIn('role', ['manager', 'admin']).select('id');
  for (const m of managers) {
    if (m.id !== req.user!.id) {
      await createNotification(m.id, `New ticket "${title}" created — ${stageName}`, 'task', project_id);
    }
  }

  res.status(201).json({ id });
  import('../services/scheduler').then(({ scheduleTaskUsers }) => scheduleTaskUsers(id, db)).catch(() => {});
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

// Update stage assignments for a ticket (admin/manager only)
router.put('/tickets/:id/stage-assignments', async (req: AuthRequest, res: Response) => {
  if (!['admin', 'manager'].includes(req.user!.role)) { res.status(403).json({ error: 'Manager only' }); return; }
  const { stage_assignments } = req.body; // [{ stage_idx, user_ids, est_hours }]
  if (!Array.isArray(stage_assignments)) { res.status(400).json({ error: 'stage_assignments required' }); return; }
  const db = getDB();
  const ticket = await db('tasks').where({ id: req.params.id }).first();
  if (!ticket) { res.status(404).json({ error: 'Ticket not found' }); return; }
  const ticketType = await db('xlr8_ticket_types').where({ id: ticket.ticket_type_id }).first();
  const stages: any[] = JSON.parse(ticketType?.stages || '[]');

  // Replace all assignees
  await db('task_assignees').where({ task_id: ticket.id }).delete();
  const rows: any[] = [];
  for (const sa of stage_assignments) {
    if (!Array.isArray(sa.user_ids)) continue;
    const stg = stages[sa.stage_idx];
    const sType = stg ? stageType(stg) : 'employee';
    const estH = sa.est_hours || null;
    if (sa.user_ids.length > 0) {
      for (const uid of sa.user_ids) {
        rows.push({ task_id: ticket.id, user_id: uid, assignee_role: sType, acceptance_status: 'pending', stage_idx: sa.stage_idx, est_hours: estH });
      }
    } else if (estH) {
      rows.push({ task_id: ticket.id, user_id: null, assignee_role: sType, acceptance_status: 'pending', stage_idx: sa.stage_idx, est_hours: estH });
    }
  }
  if (rows.length > 0) await db('task_assignees').insert(rows);
  const totalHours = stage_assignments.reduce((sum: number, sa: any) => sum + (sa.est_hours || 0), 0);
  if (totalHours > 0) await db('tasks').where({ id: ticket.id }).update({ estimated_hours: totalHours });
  res.json({ ok: true });
  import('../services/scheduler').then(({ scheduleTaskUsers }) => scheduleTaskUsers(ticket.id, db)).catch(() => {});
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
  const finalApproval = JSON.parse(ticketType?.final_approval || '{}');
  const currentIdx = ticket.xlr8_stage_idx ?? 0;

  await appendLog(ticket.id, req.user!, 'work_done', 'in_progress', null);
  await advanceToStage(db, ticket, stages, finalApproval, currentIdx + 1, req.user!, 'in_progress', res);
});

// Manager: approve or decline after work done (or at an explicit manager stage)
router.post('/tickets/:id/review', async (req: AuthRequest, res: Response) => {
  const { action, comment } = req.body;
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
    await db('approvals').where({ task_id: ticket.id }).whereNotIn('status', ['approved', 'rejected']).update({ status: 'work_in_progress' });
    await appendLog(ticket.id, req.user!, 'manager_declined', 'pending_manager', 'pending_assignee', comment);
    if (ticket.xlr8_assignee_id) {
      await createNotification(ticket.xlr8_assignee_id, `Ticket "${ticket.title}" was declined: ${comment || 'No reason given'}`, 'task', ticket.project_id);
    }
    res.json({ ok: true }); return;
  }

  await db('task_sessions').where({ task_id: ticket.id }).whereNull('ended_at').update({ ended_at: new Date() });

  await appendLog(ticket.id, req.user!, 'manager_approved', 'pending_manager', null, comment);
  await advanceToStage(db, ticket, stages, finalApproval, currentStageIdx + 1, req.user!, 'pending_manager', res);
});

router.post('/tickets/:id/admin-approve', async (req: AuthRequest, res: Response) => {
  if (req.user!.role !== 'admin') { res.status(403).json({ error: 'Admin only' }); return; }
  const db = getDB();
  const ticket = await db('tasks').where({ id: req.params.id, xlr8_status: 'pending_admin' }).first();
  if (!ticket) { res.status(404).json({ error: 'Ticket not pending admin approval' }); return; }
  const ticketType = await db('xlr8_ticket_types').where({ id: ticket.ticket_type_id }).first();
  const stages: any[] = JSON.parse(ticketType?.stages || '[]');
  const finalApproval = ticketType?.final_approval ? JSON.parse(ticketType.final_approval) : {};
  const currentStageIdx = ticket.xlr8_stage_idx ?? 0;
  const currentStage = stages[currentStageIdx];

  await appendLog(ticket.id, req.user!, 'admin_approved', 'pending_admin', null, req.body.comment);

  // If we're at an explicit admin stage (mid-flow), advance to next stage
  if (currentStage && stageType(currentStage) === 'admin') {
    await advanceToStage(db, ticket, stages, finalApproval, currentStageIdx + 1, req.user!, 'pending_admin', res);
    return;
  }

  // Final admin approval
  const approval = await db('approvals').where({ task_id: ticket.id }).whereNotIn('status', ['rejected']).first();
  if (finalApproval.clientOptional) {
    await db('tasks').where({ id: ticket.id }).update({ xlr8_status: 'pending_client' });
    if (approval) await db('approvals').where({ id: approval.id }).update({ status: 'pending_client', workflow_type: 'xlr8', admin_approved_by: req.user!.id, admin_approved_at: new Date() });
    const clientUsers = await db('users').where({ role: 'client' }).select('id');
    for (const c of clientUsers) {
      await createNotification(c.id, `Ticket "${ticket.title}" is ready for your review`, 'task', ticket.project_id);
    }
    res.json({ ok: true, next: 'pending_client' });
  } else {
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

// Routes ticket to the stage at targetIdx, or to final approval if past all stages
async function advanceToStage(
  db: any, ticket: any, stages: any[], finalApproval: any,
  targetIdx: number, actor: any, fromState: string, res: Response
) {
  if (targetIdx >= stages.length) {
    // All stages done — run final approval
    const approval = await db('approvals').where({ task_id: ticket.id }).whereNotIn('status', ['approved', 'rejected']).first();
    if (finalApproval.adminRequired) {
      await db('tasks').where({ id: ticket.id }).update({ xlr8_status: 'pending_admin', xlr8_stage_idx: targetIdx, xlr8_assignee_id: null, assigned_to: null, status: 'in_review' });
      if (approval) await db('approvals').where({ id: approval.id }).update({ status: 'pending_admin', workflow_type: 'xlr8' });
      else await db('approvals').insert({ task_id: ticket.id, title: ticket.title, project_id: ticket.project_id, submitted_by: actor.id, status: 'pending_admin', workflow_type: 'xlr8' });
      await appendLog(ticket.id, actor, 'sent_to_admin', fromState, 'pending_admin');
      const admins = await db('users').where({ role: 'admin' }).select('id');
      for (const a of admins) await createNotification(a.id, `Ticket "${ticket.title}" needs your final approval`, 'task', ticket.project_id);
      res.json({ ok: true, next: 'pending_admin' }); return;
    }
    if (finalApproval.clientOptional) {
      await db('tasks').where({ id: ticket.id }).update({ xlr8_status: 'pending_client', xlr8_stage_idx: targetIdx, xlr8_assignee_id: null, assigned_to: null });
      if (approval) await db('approvals').where({ id: approval.id }).update({ status: 'pending_client', workflow_type: 'xlr8' });
      else await db('approvals').insert({ task_id: ticket.id, title: ticket.title, project_id: ticket.project_id, submitted_by: actor.id, status: 'pending_client', workflow_type: 'xlr8' });
      await appendLog(ticket.id, actor, 'sent_to_client', fromState, 'pending_client');
      const clients = await db('users').where({ role: 'client' }).select('id');
      for (const c of clients) await createNotification(c.id, `Ticket "${ticket.title}" is ready for your review`, 'task', ticket.project_id);
      res.json({ ok: true, next: 'pending_client' }); return;
    }
    const approval2 = await db('approvals').where({ task_id: ticket.id }).whereNotIn('status', ['approved', 'rejected']).first();
    await completeTicket(db, ticket, actor);
    if (approval2) await db('approvals').where({ id: approval2.id }).update({ status: 'approved', workflow_type: 'xlr8', final_approved_at: new Date() });
    res.json({ ok: true, next: 'completed' }); return;
  }

  const nextStage = stages[targetIdx];
  const nType = stageType(nextStage);

  if (nType === 'employee') {
    const pre = await db('task_assignees').where({ task_id: ticket.id, stage_idx: targetIdx, assignee_role: 'employee' }).first();
    // Clear the approval record — work is in progress, not in review
    const empAp = await db('approvals').where({ task_id: ticket.id }).whereNotIn('status', ['approved', 'rejected']).first();
    if (empAp) await db('approvals').where({ id: empAp.id }).update({ status: 'work_in_progress', workflow_type: 'xlr8' });
    if (pre) {
      await db('tasks').where({ id: ticket.id }).update({ xlr8_status: 'pending_assignee', xlr8_stage_idx: targetIdx, xlr8_assignee_id: pre.user_id, assigned_to: pre.user_id, status: 'todo' });
      await appendLog(ticket.id, actor, 'next_stage', fromState, 'pending_assignee', `Stage ${targetIdx + 1}: ${nextStage.category_name}`);
      await createNotification(pre.user_id, `Ticket "${ticket.title}" has been assigned to you`, 'task', ticket.project_id);
      // Reschedule the new stage assignee
      import('../services/scheduler').then(({ scheduleUser }) => scheduleUser(pre.user_id, db)).catch(() => {});
      res.json({ ok: true, next: 'pending_assignee' });
    } else {
      await db('tasks').where({ id: ticket.id }).update({ xlr8_status: 'pending_manager', xlr8_stage_idx: targetIdx, xlr8_assignee_id: null, assigned_to: null, status: 'todo' });
      await appendLog(ticket.id, actor, 'next_stage', fromState, 'pending_manager', `Stage ${targetIdx + 1}: ${nextStage.category_name}`);
      const managers = await db('users').whereIn('role', ['manager', 'admin']).select('id');
      for (const m of managers) await createNotification(m.id, `Ticket "${ticket.title}" — assign a ${nextStage.category_name} for stage ${targetIdx + 1}`, 'task', ticket.project_id);
      res.json({ ok: true, next: 'pending_manager' });
    }
    return;
  }

  if (nType === 'manager') {
    const pre = await db('task_assignees').where({ task_id: ticket.id, stage_idx: targetIdx }).first();
    const mgr = pre?.user_id || null;
    await db('tasks').where({ id: ticket.id }).update({ xlr8_status: 'pending_manager', xlr8_stage_idx: targetIdx, xlr8_assignee_id: mgr, assigned_to: mgr, status: 'in_review' });
    await appendLog(ticket.id, actor, 'next_stage', fromState, 'pending_manager', `Stage ${targetIdx + 1}: Manager Review`);
    const existingMgr = await db('approvals').where({ task_id: ticket.id }).whereNotIn('status', ['approved', 'rejected']).first();
    if (existingMgr) await db('approvals').where({ id: existingMgr.id }).update({ status: 'pending_manager', workflow_type: 'xlr8' });
    else await db('approvals').insert({ task_id: ticket.id, title: ticket.title, project_id: ticket.project_id, submitted_by: actor.id, status: 'pending_manager', workflow_type: 'xlr8' });
    if (mgr) {
      await createNotification(mgr, `Ticket "${ticket.title}" is ready for your review`, 'approval', ticket.project_id);
    } else {
      const managers = await db('users').whereIn('role', ['manager', 'admin']).select('id');
      for (const m of managers) await createNotification(m.id, `Ticket "${ticket.title}" ready for manager review`, 'approval', ticket.project_id);
    }
    res.json({ ok: true, next: 'pending_manager' }); return;
  }

  // admin stage
  const pre = await db('task_assignees').where({ task_id: ticket.id, stage_idx: targetIdx }).first();
  const adm = pre?.user_id || null;
  await db('tasks').where({ id: ticket.id }).update({ xlr8_status: 'pending_admin', xlr8_stage_idx: targetIdx, xlr8_assignee_id: adm, assigned_to: adm, status: 'in_review' });
  await appendLog(ticket.id, actor, 'next_stage', fromState, 'pending_admin', `Stage ${targetIdx + 1}: Admin Review`);
  const existingAdm = await db('approvals').where({ task_id: ticket.id }).whereNotIn('status', ['approved', 'rejected']).first();
  if (existingAdm) await db('approvals').where({ id: existingAdm.id }).update({ status: 'pending_admin', workflow_type: 'xlr8' });
  else await db('approvals').insert({ task_id: ticket.id, title: ticket.title, project_id: ticket.project_id, submitted_by: actor.id, status: 'pending_admin', workflow_type: 'xlr8' });
  if (adm) {
    await createNotification(adm, `Ticket "${ticket.title}" is ready for your admin review`, 'approval', ticket.project_id);
  } else {
    const admins = await db('users').where({ role: 'admin' }).select('id');
    for (const a of admins) await createNotification(a.id, `Ticket "${ticket.title}" ready for admin review`, 'approval', ticket.project_id);
  }
  res.json({ ok: true, next: 'pending_admin' });
}

async function completeTicket(db: any, ticket: any, actor: any) {
  await db('tasks').where({ id: ticket.id }).update({ xlr8_status: 'completed', status: 'completed' });
  await appendLog(ticket.id, actor, 'completed', ticket.xlr8_status, 'completed');
  if (ticket.created_by !== actor.id) {
    await createNotification(ticket.created_by, `Ticket "${ticket.title}" has been completed`, 'task', ticket.project_id);
  }
}

export default router;
