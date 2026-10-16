import { Router, Response } from 'express';
import { authenticate as authMiddleware, AuthRequest } from '../middleware/auth';
import { getDB } from '../db';
import { stageChecklistItems, refreshChecklistCounts, uncheckedItems, uncheckedError } from '../utils/checklist';
import { createNotification } from '../db';

const router = Router();
router.use(authMiddleware);

function requireAdmin(req: AuthRequest, res: Response): boolean {
  if (req.user!.role !== 'admin') { res.status(403).json({ error: 'Admin only' }); return false; }
  return true;
}

// MySQL returns JSON columns as already-parsed objects; SQLite returns strings
function pj(v: any, fallback: any) { if (!v) return fallback; if (typeof v === 'string') return JSON.parse(v); return v; }

function parseTicketType(row: any) {
  return {
    ...row,
    stages: pj(row.stages, []),
    final_approval: pj(row.final_approval, {}),
    checklist: pj(row.checklist, []),
  };
}

// Stages without an explicit type are backward-compat employee stages
function stageType(stage: any): 'employee' | 'manager' | 'admin' {
  if (stage?.reviewer === true) return 'manager';
  if (stage?.type === 'admin') return 'admin';
  return 'employee';
}

async function fullySkippedIdxs(db: any, task_id: number): Promise<Set<number>> {
  const rows = await db('task_assignees').where({ task_id }).select('stage_idx', 'skipped');
  const byIdx = new Map<number, boolean>();
  for (const r of rows) {
    const idx = Number(r.stage_idx);
    byIdx.set(idx, (byIdx.get(idx) ?? true) && !!r.skipped);
  }
  return new Set([...byIdx.entries()].filter(([, v]) => v).map(([k]) => k));
}

async function returnableStages(db: any, ticket: any, stages: any[]) {
  const currentIdx = ticket.xlr8_stage_idx ?? 0;
  const skipped = await fullySkippedIdxs(db, ticket.id);
  const rows = await db('task_assignees as ta').leftJoin('users as u', 'u.id', 'ta.user_id')
    .where('ta.task_id', ticket.id).where('ta.assignee_role', 'employee').whereNotNull('ta.user_id')
    .andWhere((q: any) => q.whereNull('ta.skipped').orWhere('ta.skipped', 0))
    .select('ta.stage_idx', 'u.name');
  const out: { idx: number; name: string; assignee: string | null }[] = [];
  for (let i = 0; i < currentIdx; i++) {
    if (stageType(stages[i]) !== 'employee' || skipped.has(i)) continue;
    const names = rows.filter((r: any) => Number(r.stage_idx) === i).map((r: any) => r.name);
    out.push({ idx: i, name: stages[i]?.category_name || `Stage ${i + 1}`, assignee: names.join(', ') || null });
  }
  return out;
}

// Manager/admin picked a stage to send work back to; null = default (nearest previous employee stage)
// The person who should work a stage: not skipped, not declined, and a real user
export function pickStageRow<T extends { user_id: number | null; skipped?: any; acceptance_status?: string | null }>(rows: T[]): T | undefined {
  return rows.find(r => r.user_id != null && !r.skipped && r.acceptance_status !== 'declined');
}

const ONE_PER_STAGE = 'Only one person can be assigned to each stage';
const tooManyPerStage = (sas: any[]) => Array.isArray(sas) && sas.some((sa: any) => Array.isArray(sa?.user_ids) && new Set(sa.user_ids.map(Number)).size > 1);

// Send a ticket back to an earlier work stage (manager decline, admin decline, client rejection share this)
async function sendBack(db: any, ticket: any, stages: any[], requested: any): Promise<{ targetIdx: number; assigneeId: number | null } | null> {
  const currentStageIdx = ticket.xlr8_stage_idx ?? 0;
  const picked = await pickedReturnIdx(db, ticket, stages, requested);
  if (picked === -1) return null;
  const skippedStageIdxs = await fullySkippedIdxs(db, ticket.id);
  let prevEmpIdx = Math.min(currentStageIdx, stages.length) - 1;
  while (prevEmpIdx >= 0 && (stageType(stages[prevEmpIdx]) !== 'employee' || skippedStageIdxs.has(prevEmpIdx))) prevEmpIdx--;
  const targetIdx = picked ?? (prevEmpIdx >= 0 ? prevEmpIdx : 0);
  const rows = await db('task_assignees').where({ task_id: ticket.id, stage_idx: targetIdx, assignee_role: 'employee' });
  // Fall back to the current assignee if the stage row had no user (someone accepted an unassigned stage)
  const assigneeId = pickStageRow(rows)?.user_id ?? (targetIdx === currentStageIdx - 1 ? ticket.xlr8_assignee_id : null) ?? null;

  await db('task_sessions').where({ task_id: ticket.id }).whereNull('ended_at').update({ ended_at: new Date() });
  await db('tasks').where({ id: ticket.id }).update({
    xlr8_status: assigneeId ? 'in_progress' : 'pending_manager', xlr8_stage_idx: targetIdx,
    xlr8_assignee_id: assigneeId, assigned_to: assigneeId, status: assigneeId ? 'in_progress' : 'todo',
  });
  // Target stage: they already accepted it once, no re-accept needed
  if (assigneeId) await db('task_assignees').where({ task_id: ticket.id, user_id: assigneeId, stage_idx: targetIdx }).update({ acceptance_status: 'accepted' });
  // Hide future-stage pre-assignment prompts until the task reaches those stages again
  await db('task_assignees').where({ task_id: ticket.id }).where('stage_idx', '>', targetIdx).whereIn('acceptance_status', ['pending']).update({ acceptance_status: 'pre_pending' });
  await refreshChecklistCounts(db, ticket.id);
  import('../services/scheduler').then(({ scheduleTaskUsers }) => scheduleTaskUsers(ticket.id, db)).catch(() => {});
  return { targetIdx, assigneeId };
}

async function pickedReturnIdx(db: any, ticket: any, stages: any[], requested: any): Promise<number | null> {
  if (requested === undefined || requested === null || requested === '') return null;
  const idx = Number(requested);
  const allowed = await returnableStages(db, ticket, stages);
  return allowed.some((s) => s.idx === idx) ? idx : -1;
}

export async function appendLog(task_id: number, actor: { id: number; name: string } | null, action: string, from_state: string | null, to_state: string | null, comment?: string, stages?: { from: number; to: number }) {
  await getDB()('xlr8_ticket_log').insert({
    from_stage_idx: stages?.from ?? null,
    to_stage_idx: stages?.to ?? null,
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

// Who should hear about a ticket's project: admins, managers of the project's pod, and managers on the project
export async function projectManagers(db: any, projectId: number): Promise<{ id: number }[]> {
  const project = await db('projects').where({ id: projectId }).select('pod').first();
  return db('users')
    .where('role', 'admin')
    .orWhere(function (this: any) {
      this.where('role', 'manager').andWhere(function (this: any) {
        if (project?.pod) this.where('pod', project.pod); else this.whereRaw('1 = 1');
        this.orWhereExists(function (this: any) { this.from('project_members as pm').whereRaw('pm.user_id = users.id').where('pm.project_id', projectId); });
      });
    })
    .select('id');
}

// ── Cross-pod approval ──────────────────────────────────────────────────────

export type ApprovalReason = { pod: string; text: string };
const podLabel = (p: string) => (p === 'pod1' ? 'Pod 1' : p === 'pod2' ? 'Pod 2' : p);
export const reasonPods = (reasons: ApprovalReason[]) => [...new Set(reasons.map((r) => r.pod))];

// Why a new task needs a pod manager's sign-off, one line per cause, tagged with the pod that must approve it:
// another pod's project, another pod's employee assigned, or custom stages built by an employee.
export async function approvalReasons(
  db: any, actor: { id: number; role: string },
  project: { name?: string; pod?: string | null },
  assignments: { user_id: number; stage_idx?: number | null; stage_name?: string }[],
  customStageCount = 0,
): Promise<ApprovalReason[]> {
  if (actor.role === 'admin') return [];
  const me = await db('users').where({ id: actor.id }).select('pod', 'name').first();
  if (!me?.pod) return [];
  const out: ApprovalReason[] = [];
  if (project.pod && project.pod !== me.pod) {
    out.push({ pod: project.pod, text: `${me.name} (${podLabel(me.pod)}) is creating this in ${project.name || 'a project'}, which is a ${podLabel(project.pod)} project` });
  }
  const ids = [...new Set(assignments.map((a) => a.user_id).filter(Boolean))];
  if (ids.length) {
    const users = await db('users').whereIn('id', ids).whereIn('role', ['employee', 'manager']).whereNotNull('pod').select('id', 'name', 'pod');
    for (const u of users) {
      if (u.pod === me.pod) continue;
      const where = assignments.filter((a) => a.user_id === u.id && a.stage_idx != null)
        .map((a) => `stage ${Number(a.stage_idx) + 1}${a.stage_name ? ` (${a.stage_name})` : ''}`);
      out.push({ pod: u.pod, text: `${me.name} (${podLabel(me.pod)}) assigned your ${podLabel(u.pod)} member ${u.name}${where.length ? ` to ${where.join(', ')}` : ' to this task'}` });
    }
  }
  if (customStageCount && actor.role === 'employee') {
    out.push({ pod: me.pod, text: `${me.name} built custom stages (${customStageCount} stage${customStageCount === 1 ? '' : 's'}) instead of using a ticket type` });
  }
  return out;
}

// Admins skip cross-pod approval, but the other pod's manager should still hear that their
// people were put on another pod's project. FYI only — the task is not held.
export async function notifyAdminCrossPod(
  db: any, actor: { id: number; name: string; role: string },
  task: { title: string; project_id: number },
  project: { name?: string; pod?: string | null },
  assignments: { user_id: number; stage_idx?: number | null; stage_name?: string }[],
) {
  if (actor.role !== 'admin' || !project.pod) return;
  const ids = [...new Set(assignments.map((a) => a.user_id).filter(Boolean))];
  if (!ids.length) return;
  const users = await db('users').whereIn('id', ids).whereIn('role', ['employee', 'manager']).whereNotNull('pod').whereNot('pod', project.pod).select('id', 'name', 'pod');
  const byPod: Record<string, string[]> = {};
  for (const u of users) {
    const where = assignments.filter((a) => a.user_id === u.id && a.stage_idx != null)
      .map((a) => `stage ${Number(a.stage_idx) + 1}${a.stage_name ? ` (${a.stage_name})` : ''}`);
    (byPod[u.pod] ||= []).push(`${u.name}${where.length ? ` to ${where.join(', ')}` : ''}`);
  }
  for (const [pod, people] of Object.entries(byPod)) {
    const mgrs = await db('users').where({ role: 'manager', pod }).select('id');
    const msg = `${actor.name} (admin) assigned your ${podLabel(pod)} ${people.length === 1 ? 'member' : 'members'} ${people.join('; ')} on "${task.title}" in ${project.name || 'a project'} (${podLabel(project.pod)})`;
    for (const m of mgrs) await createNotification(m.id, msg, 'task', task.project_id);
  }
}

export async function holdForCrossPod(db: any, task: { id: number; title: string; project_id: number; isTicket: boolean; customStages?: boolean }, reasons: ApprovalReason[], actor: { id: number; name: string }) {
  const pods = reasonPods(reasons);
  await db('tasks').where({ id: task.id }).update({
    status: 'pending_approval', crosspod_pods: JSON.stringify(pods), crosspod_reasons: JSON.stringify(reasons), crosspod_note: null,
    ...(task.isTicket ? { xlr8_status: 'pending_crosspod' } : {}),
  });
  if (task.isTicket) await appendLog(task.id, actor, 'crosspod_requested', null, 'pending_crosspod', `Needs approval from ${pods.join(', ')} manager${task.customStages ? ' (custom stages)' : ''}`);
  // Each manager is told exactly which of the reasons concern their pod
  const mgrs = await db('users').where('role', 'manager').whereIn('pod', pods).select('id', 'pod');
  for (const m of mgrs) {
    const mine = reasons.filter((r) => r.pod === m.pod).map((r) => r.text).join('; ');
    await createNotification(m.id, `Approval needed for "${task.title}": ${mine}`, 'approval', task.project_id);
  }
}

// Resubmitting a rejected cross-pod task creates a fresh one; drop the rejected original.
export async function discardRejected(db: any, replacesId: any, user: { id: number; role: string }): Promise<any | null> {
  if (!replacesId) return null;
  let old = await db('tasks').where({ id: replacesId, created_by: user.id, status: 'draft' }).whereNotNull('crosspod_note').first();
  if (!old && ['manager', 'admin'].includes(user.role)) {
    // "Edit & create": the approving manager rebuilds a pending request
    const pending = await db('tasks').where({ id: replacesId, status: 'pending_approval' }).whereNotNull('crosspod_pods').first();
    if (pending) {
      const me = await db('users').where({ id: user.id }).select('pod').first();
      const pods: string[] = JSON.parse(pending.crosspod_pods);
      if (user.role === 'admin' || pods.includes(me?.pod)) old = pending;
    }
  }
  if (!old) return null;
  await db('approval_steps').whereIn('approval_id', db('approvals').where({ task_id: old.id }).select('id')).delete();
  for (const t of ['approvals', 'task_assignees', 'task_checklist', 'task_approval_flow', 'xlr8_ticket_log', 'task_comments', 'task_stage_comments', 'task_deliverables', 'task_schedule_slots', 'task_share_tokens']) {
    await db(t).where({ task_id: old.id }).delete().catch(() => {});
  }
  await db('tasks').where({ id: old.id }).delete();
  await dropCustomTypeIfUnused(db, old.ticket_type_id);
  return old;
}

// A custom stage set lives only as long as a ticket uses it
export async function dropCustomTypeIfUnused(db: any, typeId: number | null | undefined) {
  if (!typeId) return;
  const t = await db('xlr8_ticket_types').where({ id: typeId }).first();
  if (!t?.is_custom) return;
  const used = await db('tasks').where({ ticket_type_id: typeId }).first();
  if (!used) await db('xlr8_ticket_types').where({ id: typeId }).delete();
}

// After a manager rebuilds someone's request, keep the original requester as creator and tell them
export async function creditRequester(db: any, newId: number, old: any, actor: { id: number; name: string }) {
  if (!old || old.created_by === actor.id) return;
  await db('tasks').where({ id: newId }).update({ created_by: old.created_by });
  await createNotification(old.created_by, `${actor.name} edited and created your request "${old.title}"`, 'task', old.project_id);
}

// Starts a created (or cross-pod-approved) ticket on its first stage and sends the usual notifications.
export async function activateTicket(db: any, id: number, actor: { id: number; name: string }) {
  const task = await db('tasks').where({ id }).first();
  const ticketType = await db('xlr8_ticket_types').where({ id: task.ticket_type_id }).first();
  const stages: any[] = pj(ticketType?.stages, []);
  const firstStage = stages[0];
  const { title, project_id } = task;
  const fType = firstStage ? stageType(firstStage) : null;
  const first0 = await db('task_assignees').where({ task_id: id, stage_idx: 0 }).whereNotNull('user_id').orderBy('id').first();
  const preId0 = first0?.user_id ?? null;

  if (fType === 'employee' && preId0) {
    await db('tasks').where({ id }).update({ xlr8_status: 'pending_assignee', xlr8_assignee_id: preId0, assigned_to: preId0 });
    await appendLog(id, actor, 'created', null, 'pending_assignee');
  } else if (fType === 'manager') {
    await db('tasks').where({ id }).update({ xlr8_status: 'pending_manager', xlr8_assignee_id: preId0, status: 'in_review' });
    await appendLog(id, actor, 'created', null, 'pending_manager');
    await db('approvals').insert({ task_id: id, title, project_id, submitted_by: task.created_by, status: 'pending_manager', workflow_type: 'xlr8' });
  } else if (fType === 'admin') {
    await db('tasks').where({ id }).update({ xlr8_status: 'pending_admin', xlr8_assignee_id: preId0, status: 'in_review' });
    await appendLog(id, actor, 'created', null, 'pending_admin');
    await db('approvals').insert({ task_id: id, title, project_id, submitted_by: task.created_by, status: 'pending_admin', workflow_type: 'xlr8' });
  } else {
    await appendLog(id, actor, 'created', null, 'pending_manager');
  }

  const stageName = fType === 'employee' ? (firstStage?.category_name || 'worker') : fType === 'manager' ? 'Manager Review' : fType === 'admin' ? 'Admin Review' : 'worker';
  const project = await db('projects').where({ id: project_id }).select('pod').first();
  const projectPod = project?.pod;
  const managers = await db('users')
    .whereIn('role', ['manager', 'admin'])
    .where(function (this: any) {
      // Pod managers only see their pod's notifications; admins always get notified
      this.where('role', 'admin').orWhere(function (this: any) {
        this.where('role', 'manager');
        if (projectPod) this.where('pod', projectPod);
      });
    })
    .select('id');
  for (const m of managers) {
    if (m.id !== task.created_by) {
      await createNotification(m.id, `New ticket "${title}" created — ${stageName}`, 'task', project_id);
    }
  }

  // Notify ALL pre-assigned employee stage members to pre-accept their future stage
  const allStageEmployees = await db('task_assignees')
    .where({ task_id: id, assignee_role: 'employee' })
    .whereNotNull('user_id')
    .select('user_id', 'stage_idx');
  for (const sa of allStageEmployees) {
    await createNotification(sa.user_id, `You've been pre-assigned to stage ${(sa.stage_idx ?? 0) + 1} of "${title}" — please accept or decline`, 'task', project_id);
  }

  import('../services/scheduler').then(({ scheduleTaskUsers }) => scheduleTaskUsers(id, db)).catch(() => {});
}

// ── Ticket Types CRUD (admin only) ──────────────────────────────────────────

router.get('/ticket-types', async (_req: AuthRequest, res: Response) => {
  // Custom stage sets belong to a single ticket and are never offered as templates
  const rows = await getDB()('xlr8_ticket_types').where((q: any) => q.whereNull('is_custom').orWhere('is_custom', false)).orderBy('name');
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
      'assignee.name as assignee_name', 'assignee.avatar_color as assignee_color', 'assignee.avatar_url as assignee_avatar_url', 'assignee.role as assignee_role',
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
    stages: pj(r.stages, []),
    final_approval: pj(r.final_approval, {}),
  })));
});

router.post('/tickets', async (req: AuthRequest, res: Response) => {
  try {
  const { title, description, project_id, due_date, stage_assignments, draft, priority, custom_stages } = req.body;
  let { ticket_type_id } = req.body;
  // stage_assignments: [{ stage_idx, user_ids: number[], est_hours?: number }]
  if (!title?.trim() || !project_id) {
    res.status(400).json({ error: 'title and project_id required' }); return;
  }
  if (!draft && !ticket_type_id && !custom_stages) {
    res.status(400).json({ error: 'ticket_type_id required' }); return;
  }
  if (tooManyPerStage(stage_assignments)) { res.status(400).json({ error: ONE_PER_STAGE }); return; }
  const isDraft = !!draft;
  const db = getDB();
  const project = await db('projects').where({ id: project_id }).first();
  if (!project) { res.status(400).json({ error: 'Project not found' }); return; }

  // Stages built in the form for this ticket only: stored as a hidden, single-use stage set
  if (custom_stages) {
    const cs = custom_stages;
    if (!Array.isArray(cs.stages) || cs.stages.length === 0) { res.status(400).json({ error: 'Add at least one custom stage' }); return; }
    [ticket_type_id] = await db('xlr8_ticket_types').insert({
      name: String(cs.name || 'Custom stages').trim().slice(0, 120),
      stages: JSON.stringify(cs.stages.map((st: any) => st?.type === 'admin'
        ? { type: 'admin', ...(Array.isArray(st.checklist) ? { checklist: st.checklist } : {}) }
        : { type: 'employee', category_id: Number(st.category_id), category_name: String(st.category_name || ''), ...(st.reviewer ? { reviewer: true } : {}), ...(Array.isArray(st.checklist) ? { checklist: st.checklist } : {}) })),
      final_approval: JSON.stringify({ adminRequired: true, adminSkippable: true, clientOptional: true, ...(cs.final_approval || {}) }),
      checklist: JSON.stringify([]),
      is_custom: true,
      created_by: req.user!.id,
    });
  }

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

  const stages: any[] = pj(ticketType.stages, []);
  const firstStage = stages[0];

  // Each stage gets its own checklist (form edits, else the type's stage defaults; skipped stages/checklists get none).
  // An old shared type checklist still applies to the whole task (stage_idx null).
  const saByIdx = new Map<number, any>((Array.isArray(stage_assignments) ? stage_assignments : []).map((sa: any) => [Number(sa.stage_idx), sa]));
  const checklistRows: { text: string; completed: number; stage_idx: number | null }[] = [];
  stages.forEach((st: any, i: number) => { for (const text of stageChecklistItems(st, saByIdx.get(i))) checklistRows.push({ text, completed: 0, stage_idx: i }); });
  for (const i of pj(ticketType.checklist, []).filter((i: any) => i.text?.trim())) checklistRows.push({ text: i.text.trim(), completed: i.checked ? 1 : 0, stage_idx: null });

  const [id] = await db('tasks').insert({
    title: title.trim(),
    description: description || null,
    project_id,
    created_by: req.user!.id,
    due_date: due_date || null,
    status: req.user!.role === 'employee' ? 'pending_approval' : 'todo',
    ticket_type_id,
    xlr8_stage_idx: 0,
    xlr8_status: req.user!.role === 'employee' ? 'pending_approval' : 'pending_manager',
    priority: priority || 'medium',
  });

  if (checklistRows.length > 0) await db('task_checklist').insert(checklistRows.map(r => ({ task_id: id, ...r })));
  await refreshChecklistCounts(db, id);

  // Store pre-assigned users per stage (employee, manager, or admin)
  if (Array.isArray(stage_assignments) && stage_assignments.length > 0) {
    const rows: any[] = [];
    for (const sa of stage_assignments) {
      if (!Array.isArray(sa.user_ids)) continue;
      const stg = stages[sa.stage_idx];
      const sType = stg ? stageType(stg) : 'employee';
      const estH = sa.est_hours || null;
      const skipped = sa.skipped ? 1 : 0;
      const isReviewer = sa.is_reviewer ? 1 : 0;
      if (sa.user_ids.length > 0) {
        for (const uid of sa.user_ids) {
          rows.push({ task_id: id, user_id: uid, assignee_role: sType, acceptance_status: 'pending', stage_idx: sa.stage_idx, est_hours: estH, skipped, is_reviewer: isReviewer });
        }
      } else if (estH || skipped) {
        // No user yet (review stage with no pre-assignment, or skipped stage) — store with placeholder row
        rows.push({ task_id: id, user_id: null, assignee_role: sType, acceptance_status: 'pending', stage_idx: sa.stage_idx, est_hours: estH, skipped, is_reviewer: isReviewer });
      }
    }
    if (rows.length > 0) await db('task_assignees').insert(rows);

    // Set estimated_hours to sum of all stage est_hours
    const totalHours = stage_assignments.reduce((sum: number, sa: any) => sum + (sa.est_hours || 0), 0);
    if (totalHours > 0) await db('tasks').where({ id }).update({ estimated_hours: totalHours });
  }

  const replaced = await discardRejected(db, req.body.replaces_id, req.user!);
  await creditRequester(db, id, replaced, req.user!);

  const assignments = Array.isArray(stage_assignments)
    ? stage_assignments.filter((sa: any) => !sa.skipped).flatMap((sa: any) => (Array.isArray(sa.user_ids) ? sa.user_ids : [])
        .map((uid: number) => ({ user_id: Number(uid), stage_idx: Number(sa.stage_idx), stage_name: stages[sa.stage_idx]?.category_name })))
    : [];
  const customStages = !!ticketType.is_custom;
  const reasons = await approvalReasons(db, req.user!, project, assignments, customStages ? stages.length : 0);
  const pods = reasonPods(reasons);
  if (pods.length) {
    await holdForCrossPod(db, { id, title: title.trim(), project_id, isTicket: true, customStages }, reasons, req.user!);
    res.status(201).json({ id, crosspod_pending: pods, custom_stages: customStages }); return;
  }

  await activateTicket(db, id, req.user!);
  await notifyAdminCrossPod(db, req.user!, { title: title.trim(), project_id }, project, assignments);
  res.status(201).json({ id });
  } catch (e: any) {
    console.error('POST /xlr8/tickets error:', e?.message, e?.stack);
    res.status(500).json({ error: e?.message || 'Server error' });
  }
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
      'assignee.name as assignee_name', 'assignee.avatar_color as assignee_color', 'assignee.avatar_url as assignee_avatar_url', 'assignee.role as assignee_role',
      'tt.name as ticket_type_name', 'tt.stages', 'tt.final_approval',
    )
    .first();
  if (!ticket) { res.status(404).json({ error: 'Ticket not found' }); return; }
  const log = await db('xlr8_ticket_log').where({ task_id: req.params.id }).orderBy('created_at', 'asc');
  res.json({
    ...ticket,
    stages: pj(ticket.stages, []),
    final_approval: pj(ticket.final_approval, {}),
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
  const stages: any[] = pj(ticketType?.stages, []);

  if (tooManyPerStage(stage_assignments)) { res.status(400).json({ error: ONE_PER_STAGE }); return; }

  // Replace assignees, but keep what people already did: acceptance, skip/reviewer flags, hand-placed calendar day
  const currentStageIdx = ticket.xlr8_stage_idx ?? 0;
  const existingRows = await db('task_assignees').where({ task_id: ticket.id });
  const prevByKey = new Map<string, any>(existingRows.map((r: any) => [`${r.stage_idx}:${r.user_id}`, r]));
  const prevByStage = new Map<number, any>();
  for (const r of existingRows) if (!prevByStage.has(r.stage_idx)) prevByStage.set(r.stage_idx, r);
  const rows: any[] = [];
  for (const sa of stage_assignments) {
    if (!Array.isArray(sa.user_ids)) continue;
    const stg = stages[sa.stage_idx];
    const sType = stg ? stageType(stg) : 'employee';
    const estH = sa.est_hours || null;
    const flags = prevByStage.get(sa.stage_idx);
    const keep = { skipped: sa.skipped ?? flags?.skipped ?? 0, is_reviewer: sa.is_reviewer ?? flags?.is_reviewer ?? 0 };
    if (sa.user_ids.length > 0) {
      for (const uid of sa.user_ids) {
        const prev = prevByKey.get(`${sa.stage_idx}:${uid}`);
        // Re-picking someone who declined this stage asks them again
        const status = !prev?.acceptance_status || prev.acceptance_status === 'declined' ? 'pending' : prev.acceptance_status;
        rows.push({ task_id: ticket.id, user_id: uid, assignee_role: sType, acceptance_status: status, stage_idx: sa.stage_idx, est_hours: estH, schedule_anchor: prev?.schedule_anchor ?? null, ...keep });
      }
    } else if (estH || keep.skipped) {
      rows.push({ task_id: ticket.id, user_id: null, assignee_role: sType, acceptance_status: 'pending', stage_idx: sa.stage_idx, est_hours: estH, ...keep });
    }
  }
  await db.transaction(async (trx: any) => {
    await trx('task_assignees').where({ task_id: ticket.id }).delete();
    if (rows.length > 0) await trx('task_assignees').insert(rows);
  });
  const totalHours = stage_assignments.reduce((sum: number, sa: any) => sum + (sa.est_hours || 0), 0);
  if (totalHours > 0) await db('tasks').where({ id: ticket.id }).update({ estimated_hours: totalHours });

  // Someone else now owns the stage being worked on: hand it to them
  const curStage = stages[currentStageIdx];
  if (curStage && stageType(curStage) === 'employee' && ['pending_assignee', 'in_progress', 'needs_reassignment', 'pending_manager'].includes(ticket.xlr8_status)) {
    const cur = pickStageRow(rows.filter(r => r.stage_idx === currentStageIdx));
    const inReview = ticket.xlr8_status === 'pending_manager' && !!ticket.xlr8_assignee_id;
    if (cur && cur.user_id !== ticket.xlr8_assignee_id && !inReview) {
      const accepted = cur.acceptance_status === 'accepted';
      await db('task_sessions').where({ task_id: ticket.id }).whereNull('ended_at').update({ ended_at: new Date() });
      await db('tasks').where({ id: ticket.id }).update({ xlr8_assignee_id: cur.user_id, assigned_to: cur.user_id, xlr8_status: accepted ? 'in_progress' : 'pending_assignee', status: accepted ? 'in_progress' : 'todo' });
      await appendLog(ticket.id, req.user!, 'assigned', ticket.xlr8_status, accepted ? 'in_progress' : 'pending_assignee', `Stage ${currentStageIdx + 1} reassigned`);
    }
  }

  // Notify people newly put on a stage, and anyone re-asked after declining it
  for (const r of rows.filter(r => r.user_id && (!prevByKey.has(`${r.stage_idx}:${r.user_id}`) || prevByKey.get(`${r.stage_idx}:${r.user_id}`)?.acceptance_status === 'declined'))) {
    await createNotification(r.user_id, `You've been assigned to stage ${(r.stage_idx ?? 0) + 1} of "${ticket.title}" — please accept or decline`, 'task', ticket.project_id);
  }

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
  const stages: any[] = pj(ticketType?.stages, []);
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
    .andWhere((q: any) => q.whereNot('ta.acceptance_status', 'declined').orWhereNull('ta.acceptance_status'))
    .andWhere((q: any) => q.whereNull('ta.skipped').orWhere('ta.skipped', 0))
    .select('u.id', 'u.name', 'u.avatar_color', 'u.avatar_url');

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
  const eligible = await eligibleQuery.select('u.id', 'u.name', 'u.avatar_color', 'u.avatar_url');

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
  const ticket = await db('tasks').where({ id: req.params.id }).whereIn('xlr8_status', ['pending_manager', 'needs_reassignment']).first();
  if (!ticket) { res.status(404).json({ error: 'Ticket not found or not pending assignment' }); return; }

  const ticketType = await db('xlr8_ticket_types').where({ id: ticket.ticket_type_id }).first();
  const stages: any[] = pj(ticketType?.stages, []);
  const stage = stages[ticket.xlr8_stage_idx ?? 0];

  const assignee = await db('users').where({ id: assignee_id }).first();
  if (!assignee) { res.status(404).json({ error: 'User not found' }); return; }

  await assignToEmployee(db, ticket, assignee, req.user!, stage, 'manual');
  res.json({ ok: true });
});

async function assignToEmployee(db: any, ticket: any, assignee: any, actor: any, stage: any, mode: 'auto' | 'manual') {
  // The stage now belongs to this person: one row per stage, replacing whoever declined or the empty placeholder
  const stageIdx = ticket.xlr8_stage_idx ?? 0;
  const existing = await db('task_assignees').where({ task_id: ticket.id, stage_idx: stageIdx }).first();
  if (existing) {
    await db('task_assignees').where({ task_id: ticket.id, stage_idx: stageIdx }).whereNot({ id: existing.id }).delete();
    if (existing.user_id !== assignee.id || existing.acceptance_status === 'declined') {
      await db('task_assignees').where({ id: existing.id }).update({ user_id: assignee.id, acceptance_status: 'pending', schedule_anchor: null });
    }
  } else {
    await db('task_assignees').insert({ task_id: ticket.id, user_id: assignee.id, stage_idx: stageIdx, assignee_role: stage ? stageType(stage) : 'employee', acceptance_status: 'pending' });
  }
  await db('tasks').where({ id: ticket.id }).update({
    xlr8_status: 'pending_assignee',
    xlr8_assignee_id: assignee.id,
    assigned_to: assignee.id,
  });
  await appendLog(ticket.id, actor, 'assigned', ticket.xlr8_status, 'pending_assignee',
    `${mode === 'auto' ? 'Auto-assigned' : 'Assigned'} to ${assignee.name} (${stage?.category_name || 'unknown role'})`);
  await createNotification(assignee.id, `Ticket "${ticket.title}" has been assigned to you`, 'task', ticket.project_id);
  if (ticket.created_by !== actor.id) {
    await createNotification(ticket.created_by, `Your ticket "${ticket.title}" was accepted and assigned to ${assignee.name}`, 'task', ticket.project_id);
  }
}

// Pre-accept a future stage assignment (before it becomes the active stage)
router.post('/tickets/:id/stage-pre-accept', async (req: AuthRequest, res: Response) => {
  if (!['employee', 'manager'].includes(req.user!.role)) { res.status(403).json({ error: 'Not authorized' }); return; }
  const db = getDB();
  const open = () => db('task_assignees')
    .where({ task_id: req.params.id, user_id: req.user!.id }).whereIn('assignee_role', ['employee', 'manager'])
    .andWhere((q: any) => q.whereIn('acceptance_status', ['pending', 'pre_pending']).orWhereNull('acceptance_status'));
  // One stage at a time: the one asked for, else this person's earliest open stage
  const target = req.body?.stage_idx != null ? Number(req.body.stage_idx) : (await open().orderBy('stage_idx').first())?.stage_idx;
  const updated = target === undefined ? 0 : await (target == null ? open().whereNull('stage_idx') : open().where('stage_idx', target)).update({ acceptance_status: 'accepted' });
  if (!updated) { res.status(404).json({ error: 'No pending assignment found' }); return; }
  const ticket = await db('tasks').where({ id: req.params.id }).first();
  if (ticket) {
    // Accepting your own current stage starts the work, same as employee-accept
    const ownsCurrentStage = ticket.xlr8_status === 'pending_assignee' && await db('task_assignees')
      .where({ task_id: ticket.id, stage_idx: ticket.xlr8_stage_idx ?? 0, user_id: req.user!.id }).first();
    if (ownsCurrentStage) {
      await db('tasks').where({ id: ticket.id }).update({ xlr8_status: 'in_progress', status: 'in_progress', xlr8_assignee_id: req.user!.id, assigned_to: req.user!.id });
      await appendLog(ticket.id, req.user!, 'employee_accepted', 'pending_assignee', 'in_progress');
      import('../services/scheduler').then(({ scheduleUser }) => scheduleUser(req.user!.id, db)).catch(() => {});
    } else {
      await appendLog(ticket.id, req.user!, 'stage_pre_accepted', null, null, `Pre-accepted future stage assignment`);
    }
    // If all employee stages are now accepted and ticket is pending_assignee, notify managers
    const pending = await db('task_assignees')
      .where({ task_id: ticket.id, assignee_role: 'employee' })
      .whereNotNull('user_id')
      .whereNotIn('acceptance_status', ['accepted'])
      .count('* as n').first();
    if (Number((pending as any)?.n) === 0) {
      const managers = await projectManagers(db, ticket.project_id);
      for (const m of managers) await createNotification(m.id, `All members accepted "${ticket.title}" — work can now begin`, 'task', ticket.project_id);
    }
  }
  res.json({ ok: true });
});

// Pre-decline a future stage assignment
router.post('/tickets/:id/stage-pre-decline', async (req: AuthRequest, res: Response) => {
  if (!['employee', 'manager'].includes(req.user!.role)) { res.status(403).json({ error: 'Not authorized' }); return; }
  const db = getDB();
  const mine = () => db('task_assignees').where({ task_id: req.params.id, user_id: req.user!.id }).whereIn('assignee_role', ['employee', 'manager']);
  // A specific stage, or else every stage of mine on this ticket still waiting for my answer
  // (declining "the task" once covers all of them, so it doesn't come back for the next stage)
  let targets: (number | null)[];
  if (req.body?.stage_idx != null) targets = [Number(req.body.stage_idx)];
  else {
    const open = await mine().where((q: any) => q.where('acceptance_status', 'pending').orWhereNull('acceptance_status')).orderBy('stage_idx').select('stage_idx');
    targets = open.length ? open.map((r: any) => r.stage_idx)
      : [(await mine().where((q: any) => q.whereNot('acceptance_status', 'declined').orWhereNull('acceptance_status')).orderBy('stage_idx').first())?.stage_idx].filter((x) => x !== undefined);
  }
  let updated = 0;
  for (const t of targets) updated += await (t == null ? mine().whereNull('stage_idx') : mine().where('stage_idx', t)).update({ acceptance_status: 'declined' });
  if (!updated) { res.status(404).json({ error: 'No assignment found' }); return; }
  const ticket = await db('tasks').where({ id: req.params.id }).first();
  if (ticket) {
    // One log row per declined stage, tagged with the stage, so the manager sees each reason once
    for (const t of targets) await appendLog(ticket.id, req.user!, 'stage_pre_declined', null, null, req.body.comment || null, t == null ? undefined : { from: t, to: t });
    const managers = await projectManagers(db, ticket.project_id);
    for (const m of managers) await createNotification(m.id, `${req.user!.name} declined a stage in "${ticket.title}" — reassignment needed`, 'task', ticket.project_id);
  }
  res.json({ ok: true });
});

router.post('/tickets/:id/employee-accept', async (req: AuthRequest, res: Response) => {
  if (!['employee', 'manager'].includes(req.user!.role)) { res.status(403).json({ error: 'Not authorized' }); return; }
  const db = getDB();
  const ticket = await db('tasks')
    .where({ id: req.params.id, xlr8_status: 'pending_assignee' })
    .where(function () { this.where('xlr8_assignee_id', req.user!.id).orWhereNull('xlr8_assignee_id'); })
    .first();
  if (!ticket) { res.status(404).json({ error: 'Ticket not found or not available' }); return; }
  // Verify the caller is actually assigned to this stage — prevents any employee from grabbing an unassigned ticket
  const stageAssignment = await db('task_assignees').where({ task_id: ticket.id, stage_idx: ticket.xlr8_stage_idx ?? 0, user_id: req.user!.id }).first();
  if (!stageAssignment && ticket.xlr8_assignee_id !== null) { res.status(403).json({ error: 'You are not assigned to this ticket' }); return; }
  if (!stageAssignment) {
    // Null-assignee stage: verify caller appears in task_assignees for this task at all, or project membership
    const anyAssignment = await db('task_assignees').where({ task_id: ticket.id, user_id: req.user!.id }).first();
    const isMember = await db('project_members').where({ project_id: ticket.project_id, user_id: req.user!.id }).first();
    if (!anyAssignment && !isMember) { res.status(403).json({ error: 'You are not assigned to this ticket' }); return; }
  }

  await db('tasks').where({ id: ticket.id }).update({ xlr8_status: 'in_progress', status: 'in_progress', xlr8_assignee_id: req.user!.id, assigned_to: req.user!.id });
  // Update task_assignees for this stage: set user_id (fills null placeholder) + accepted
  const stageIdx = ticket.xlr8_stage_idx ?? 0;
  const updated = await db('task_assignees')
    .where({ task_id: ticket.id, stage_idx: stageIdx })
    .where(function () { this.where('user_id', req.user!.id).orWhereNull('user_id'); })
    .update({ user_id: req.user!.id, acceptance_status: 'accepted' });
  if (!updated) {
    await db('task_assignees').insert({ task_id: ticket.id, user_id: req.user!.id, stage_idx: stageIdx, assignee_role: 'employee', acceptance_status: 'accepted' });
  }
  await appendLog(ticket.id, req.user!, 'employee_accepted', 'pending_assignee', 'in_progress');
  if (ticket.created_by !== req.user!.id) {
    await createNotification(ticket.created_by, `${req.user!.name} accepted your ticket "${ticket.title}" and has started working`, 'task', ticket.project_id);
  }
  res.json({ ok: true });
  import('../services/scheduler').then(({ scheduleUser }) => scheduleUser(req.user!.id, db)).catch(() => {});
});

router.post('/tickets/:id/employee-decline', async (req: AuthRequest, res: Response) => {
  const db = getDB();
  const ticket = await db('tasks').where({ id: req.params.id, xlr8_status: 'pending_assignee', xlr8_assignee_id: req.user!.id }).first();
  if (!ticket) { res.status(404).json({ error: 'Ticket not found or not assigned to you' }); return; }

  // Set to needs_reassignment — keeps it out of manager approval queue but visible in declined-stages alert
  await db('tasks').where({ id: ticket.id }).update({ xlr8_status: 'needs_reassignment', xlr8_assignee_id: null, assigned_to: null, status: 'todo' });
  await db('task_assignees').where({ task_id: ticket.id, user_id: req.user!.id, stage_idx: ticket.xlr8_stage_idx ?? 0 }).update({ acceptance_status: 'declined' });
  // Close any open approval record so it doesn't appear in the manager's approval queue
  await db('approvals').where({ task_id: ticket.id }).whereNotIn('status', ['approved', 'rejected']).update({ status: 'work_in_progress' });
  await appendLog(ticket.id, req.user!, 'employee_declined', 'pending_assignee', 'needs_reassignment', req.body.comment || null);

  const managers = await projectManagers(db, ticket.project_id);
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
  const open = await uncheckedItems(db, ticket.id);
  if (open.length) { res.status(400).json({ error: uncheckedError(open), unchecked: open }); return; }

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
  const stages: any[] = pj(ticketType?.stages, []);
  const finalApproval = pj(ticketType?.final_approval, {});
  const currentIdx = ticket.xlr8_stage_idx ?? 0;

  await appendLog(ticket.id, req.user!, 'work_done', 'in_progress', null);
  await advanceToStage(db, ticket, stages, finalApproval, currentIdx + 1, req.user!, 'in_progress', res);
});

// Manager: approve or decline after work done (or at an explicit manager stage)
router.post('/tickets/:id/review', async (req: AuthRequest, res: Response) => {
  const { action, comment } = req.body;
  if (!['approve', 'decline'].includes(action)) { res.status(400).json({ error: 'action must be approve or decline' }); return; }
  const db = getDB();
  // Allow review when: assignee_id is set (employee just finished) OR current stage is manager type
  const ticket = await db('tasks').where({ id: req.params.id, xlr8_status: 'pending_manager' }).first();
  if (!ticket) { res.status(404).json({ error: 'Ticket not found or not pending manager review' }); return; }

  // Allow admin/manager always; allow employee only if they are the pre-assigned reviewer for this stage
  const isReviewerEmployee = req.user!.role === 'employee' && ticket.xlr8_assignee_id === req.user!.id;
  if (!['admin', 'manager'].includes(req.user!.role) && !isReviewerEmployee) { res.status(403).json({ error: 'Not authorized to review this ticket' }); return; }
  // An employee reviewer stage is that employee's call; managers wait for it (admins can still override)
  if (req.user!.role === 'manager' && ticket.xlr8_assignee_id && ticket.xlr8_assignee_id !== req.user!.id) {
    const reviewer = await db('users').where({ id: ticket.xlr8_assignee_id }).select('name', 'role').first();
    if (reviewer?.role === 'employee') { res.status(403).json({ error: `Waiting for ${reviewer.name} to review this stage` }); return; }
  }

  const ticketType = await db('xlr8_ticket_types').where({ id: ticket.ticket_type_id }).first();
  const stages: any[] = pj(ticketType?.stages, []);
  const finalApproval = pj(ticketType?.final_approval, {});
  const currentStageIdx = ticket.xlr8_stage_idx ?? 0;
  const currentStage = stages[currentStageIdx];

  // Must be in review mode: assignee set (work done) OR current stage is manager type
  const inReviewMode = !!ticket.xlr8_assignee_id || (currentStage && stageType(currentStage) === 'manager');
  if (!inReviewMode) {
    res.status(400).json({ error: 'Ticket is in assignment mode, not review mode' }); return;
  }

  if (action === 'decline') {
    await db('task_sessions').where({ task_id: ticket.id }).whereNull('ended_at').update({ ended_at: new Date() });
    // Mark approval as rejected so it leaves the manager's pending queue
    await db('approvals').where({ task_id: ticket.id }).whereNotIn('status', ['approved', 'rejected']).update({ status: 'rejected' });

    const back = await sendBack(db, ticket, stages, req.body.target_stage_idx);
    if (!back) { res.status(400).json({ error: 'Invalid stage to send back to' }); return; }
    const { targetIdx, assigneeId: prevAssigneeId } = back;
    await appendLog(ticket.id, req.user!, 'manager_declined', 'pending_manager', 'in_progress', comment, { from: currentStageIdx, to: targetIdx });
    if (prevAssigneeId) {
      await createNotification(prevAssigneeId, `Ticket "${ticket.title}" was declined — please redo and resubmit${comment ? ': ' + comment : ''}`, 'task', ticket.project_id);
    }
    const admins = await db('users').where({ role: 'admin' }).select('id');
    for (const a of admins) await createNotification(a.id, `${req.user!.name} rejected ticket "${ticket.title}"${comment ? ': ' + comment : ''}`, 'task', ticket.project_id);
    res.json({ ok: true }); return;
  }

  const openReview = await uncheckedItems(db, ticket.id);
  if (openReview.length) { res.status(400).json({ error: uncheckedError(openReview), unchecked: openReview }); return; }
  await db('task_sessions').where({ task_id: ticket.id }).whereNull('ended_at').update({ ended_at: new Date() });

  await appendLog(ticket.id, req.user!, 'manager_approved', 'pending_manager', null, comment);
  const skipAdmin = !!req.body.skip_admin && currentStageIdx + 1 >= stages.length && finalApproval.adminRequired;
  if (skipAdmin) await appendLog(ticket.id, req.user!, 'admin_skipped', 'pending_manager', null);
  await advanceToStage(db, ticket, stages, skipAdmin ? { ...finalApproval, adminRequired: false } : finalApproval, currentStageIdx + 1, req.user!, 'pending_manager', res);
});

router.post('/tickets/:id/admin-approve', async (req: AuthRequest, res: Response) => {
  if (req.user!.role !== 'admin') { res.status(403).json({ error: 'Admin only' }); return; }
  const db = getDB();
  const ticket = await db('tasks').where({ id: req.params.id, xlr8_status: 'pending_admin' }).first();
  if (!ticket) { res.status(404).json({ error: 'Ticket not pending admin approval' }); return; }
  const ticketType = await db('xlr8_ticket_types').where({ id: ticket.ticket_type_id }).first();
  const stages: any[] = pj(ticketType?.stages, []);
  const finalApproval = pj(ticketType?.final_approval, {});
  const currentStageIdx = ticket.xlr8_stage_idx ?? 0;
  const currentStage = stages[currentStageIdx];

  const openAdmin = currentStage && stageType(currentStage) === 'admin' ? await uncheckedItems(db, ticket.id) : [];
  if (openAdmin.length) { res.status(400).json({ error: uncheckedError(openAdmin), unchecked: openAdmin }); return; }
  await appendLog(ticket.id, req.user!, 'admin_approved', 'pending_admin', null, req.body.comment);

  // If we're at an explicit admin stage (mid-flow), advance to next stage
  if (currentStage && stageType(currentStage) === 'admin') {
    await advanceToStage(db, ticket, stages, finalApproval, currentStageIdx + 1, req.user!, 'pending_admin', res);
    return;
  }

  // Final admin approval
  const approval = await db('approvals').where({ task_id: ticket.id }).whereNotIn('status', ['rejected']).first();
  // Admin chose "Skip Client" — complete now instead of sending for client review
  const skipClient = req.body.skip_client === true;
  if (skipClient) await appendLog(ticket.id, req.user!, 'admin_skip_client', 'pending_admin', 'completed', req.body.comment);
  if (finalApproval.clientOptional && !skipClient) {
    await db('tasks').where({ id: ticket.id }).update({ xlr8_status: 'pending_client' });
    if (approval) await db('approvals').where({ id: approval.id }).update({ status: 'pending_client', workflow_type: 'xlr8', admin_approved_by: req.user!.id, admin_approved_at: new Date() });
    const clientUsers = await db('users as u')
      .join('projects as p', 'p.client_company_id', 'u.client_company_id')
      .where('p.id', ticket.project_id).where('u.role', 'client').select('u.id');
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

router.post('/tickets/:id/admin-decline', async (req: AuthRequest, res: Response) => {
  if (req.user!.role !== 'admin') { res.status(403).json({ error: 'Admin only' }); return; }
  const db = getDB();
  const ticket = await db('tasks').where({ id: req.params.id, xlr8_status: 'pending_admin' }).first();
  if (!ticket) { res.status(404).json({ error: 'Ticket not pending admin approval' }); return; }

  const ticketType = await db('xlr8_ticket_types').where({ id: ticket.ticket_type_id }).first();
  const stages: any[] = pj(ticketType?.stages, []);
  const currentStageIdx = ticket.xlr8_stage_idx ?? 0;

  await db('approvals').where({ task_id: ticket.id }).whereNotIn('status', ['approved', 'rejected']).update({ status: 'rejected' });
  const back = await sendBack(db, ticket, stages, req.body.target_stage_idx);
  if (!back) { res.status(400).json({ error: 'Invalid stage to send back to' }); return; }
  const { targetIdx, assigneeId: prevAssigneeId } = back;
  await appendLog(ticket.id, req.user!, 'admin_declined', 'pending_admin', 'in_progress', req.body.comment, { from: currentStageIdx, to: targetIdx });

  if (prevAssigneeId) {
    await createNotification(prevAssigneeId, `Ticket "${ticket.title}" was declined by admin — please redo your work`, 'task', ticket.project_id);
  } else {
    const managers = await projectManagers(db, ticket.project_id);
    for (const m of managers) {
      if (m.id !== req.user!.id) await createNotification(m.id, `Ticket "${ticket.title}" was declined by admin — please reassign stage ${targetIdx + 1}`, 'task', ticket.project_id);
    }
  }
  res.json({ ok: true });
});

router.post('/tickets/:id/admin-send-client', async (req: AuthRequest, res: Response) => {
  if (req.user!.role !== 'admin') { res.status(403).json({ error: 'Admin only' }); return; }
  const db = getDB();
  const ticket = await db('tasks').where({ id: req.params.id, xlr8_status: 'pending_admin' }).first();
  if (!ticket) { res.status(404).json({ error: 'Ticket not pending admin approval' }); return; }
  await db('tasks').where({ id: ticket.id }).update({ xlr8_status: 'pending_client', assigned_to: null, xlr8_assignee_id: null });
  const approval = await db('approvals').where({ task_id: ticket.id }).whereNotIn('status', ['rejected']).first();
  if (approval) await db('approvals').where({ id: approval.id }).update({ status: 'pending_client', workflow_type: 'xlr8', admin_approved_by: req.user!.id, admin_approved_at: new Date() });
  else await db('approvals').insert({ task_id: ticket.id, title: ticket.title, project_id: ticket.project_id, submitted_by: ticket.created_by, status: 'pending_client', workflow_type: 'xlr8' });
  await appendLog(ticket.id, req.user!, 'sent_to_client', 'pending_admin', 'pending_client', req.body.comment);
  const clients = await db('users as u')
    .join('projects as p', 'p.client_company_id', 'u.client_company_id')
    .where('p.id', ticket.project_id).where('u.role', 'client').select('u.id');
  for (const c of clients) await createNotification(c.id, `Ticket "${ticket.title}" is ready for your review`, 'task', ticket.project_id);
  res.json({ ok: true, next: 'pending_client' });
});

router.post('/tickets/:id/client-reject', async (req: AuthRequest, res: Response) => {
  if (req.user!.role !== 'client') { res.status(403).json({ error: 'Client only' }); return; }
  const db = getDB();
  const ticket = await db('tasks').where({ id: req.params.id, xlr8_status: 'pending_client' }).first();
  if (!ticket) { res.status(404).json({ error: 'Ticket not pending client approval' }); return; }
  const project = await db('projects as p')
    .leftJoin('users as u', 'u.client_company_id', 'p.client_company_id')
    .where('p.id', ticket.project_id).where('u.id', req.user!.id).first();
  if (!project) { res.status(403).json({ error: 'Not authorized for this project' }); return; }
  const ticketType = await db('xlr8_ticket_types').where({ id: ticket.ticket_type_id }).first();
  const back = await sendBack(db, ticket, pj(ticketType?.stages, []), undefined);
  const approval = await db('approvals').where({ task_id: ticket.id }).whereNotIn('status', ['rejected']).first();
  if (approval) await db('approvals').where({ id: approval.id }).update({ status: 'revision_requested', workflow_type: 'xlr8' });
  await appendLog(ticket.id, req.user!, 'client_declined', 'pending_client', back?.assigneeId ? 'in_progress' : 'pending_manager', req.body.comment, back ? { from: ticket.xlr8_stage_idx ?? 0, to: back.targetIdx } : undefined);
  if (back?.assigneeId) await createNotification(back.assigneeId, `The client asked for changes on "${ticket.title}"${req.body.comment ? ': ' + req.body.comment : ''}`, 'task', ticket.project_id);
  const admins = await db('users').where({ role: 'admin' }).select('id');
  for (const a of admins) await createNotification(a.id, `Client rejected ticket "${ticket.title}" — revision needed`, 'task', ticket.project_id);
  res.json({ ok: true, next: 'revision_requested' });
});

// Manager/admin closes a ticket waiting on the client without client sign-off
router.post('/tickets/:id/close', async (req: AuthRequest, res: Response) => {
  if (!['admin', 'manager'].includes(req.user!.role)) { res.status(403).json({ error: 'Not authorized' }); return; }
  try {
    const db = getDB();
    const ticket = await db('tasks').where({ id: req.params.id }).first();
    if (!ticket) { res.status(404).json({ error: 'Ticket not found' }); return; }
    if (ticket.xlr8_status !== 'pending_client') { res.status(400).json({ error: `Ticket is not waiting on the client (current state: ${ticket.xlr8_status})` }); return; }
    await completeTicket(db, ticket, req.user!);
    const approval = await db('approvals').where({ task_id: ticket.id }).whereNotIn('status', ['rejected']).first();
    if (approval) await db('approvals').where({ id: approval.id }).update({ status: 'approved', workflow_type: 'xlr8', final_approved_at: new Date() });
    await appendLog(ticket.id, req.user!, 'closed_without_client', 'pending_client', 'completed', req.body?.comment).catch(() => {});
    res.json({ ok: true });
  } catch (e: any) {
    console.error('Close ticket error:', e);
    res.status(500).json({ error: `Close failed: ${e?.message || 'server error'}` });
  }
});

router.post('/tickets/:id/client-approve', async (req: AuthRequest, res: Response) => {
  if (req.user!.role !== 'client') { res.status(403).json({ error: 'Client only' }); return; }
  const db = getDB();
  const ticket = await db('tasks').where({ id: req.params.id, xlr8_status: 'pending_client' }).first();
  if (!ticket) { res.status(404).json({ error: 'Ticket not pending client approval' }); return; }
  // Verify caller belongs to the project's client company
  const project = await db('projects as p')
    .leftJoin('users as u', 'u.client_company_id', 'p.client_company_id')
    .where('p.id', ticket.project_id).where('u.id', req.user!.id).first();
  if (!project) { res.status(403).json({ error: 'Not authorized for this project' }); return; }
  await appendLog(ticket.id, req.user!, 'client_approved', 'pending_client', 'completed');
  await completeTicket(db, ticket, req.user!);
  const approval = await db('approvals').where({ task_id: ticket.id }).whereNotIn('status', ['rejected']).first();
  if (approval) await db('approvals').where({ id: approval.id }).update({ status: 'approved', workflow_type: 'xlr8', final_approved_at: new Date() });
  res.json({ ok: true });
});

router.get('/tickets/:id/return-stages', async (req: AuthRequest, res: Response) => {
  const db = getDB();
  const ticket = await db('tasks').where({ id: req.params.id }).first();
  if (!ticket) { res.status(404).json({ error: 'Ticket not found' }); return; }
  if (!['admin', 'manager'].includes(req.user!.role) && ticket.xlr8_assignee_id !== req.user!.id) { res.status(403).json({ error: 'Not authorized' }); return; }
  const ticketType = await db('xlr8_ticket_types').where({ id: ticket.ticket_type_id }).first();
  res.json(await returnableStages(db, ticket, pj(ticketType?.stages, [])));
});

router.get('/tickets/:id/log', async (req: AuthRequest, res: Response) => {
  const log = await getDB()('xlr8_ticket_log')
    .where({ task_id: req.params.id })
    .orderBy('created_at', 'asc');
  res.json(log);
});

// Routes ticket to the stage at targetIdx, or to final approval if past all stages
export async function advanceToStage(
  db: any, ticket: any, stages: any[], finalApproval: any,
  targetIdx: number, actor: any, fromState: string, res: Response
) {
  // Checklist badge follows the stage (runs after this function's own task update)
  res.once('finish', () => { refreshChecklistCounts(getDB(), ticket.id).catch(() => {}); });
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
      const clients = await db('users as u')
        .join('projects as p', 'p.client_company_id', 'u.client_company_id')
        .where('p.id', ticket.project_id).where('u.role', 'client').select('u.id');
      for (const c of clients) await createNotification(c.id, `Ticket "${ticket.title}" is ready for your review`, 'task', ticket.project_id);
      res.json({ ok: true, next: 'pending_client' }); return;
    }
    const approval2 = await db('approvals').where({ task_id: ticket.id }).whereNotIn('status', ['approved', 'rejected']).first();
    await completeTicket(db, ticket, actor);
    if (approval2) await db('approvals').where({ id: approval2.id }).update({ status: 'approved', workflow_type: 'xlr8', final_approved_at: new Date() });
    res.json({ ok: true, next: 'completed' }); return;
  }

  // Restore pre_pending → pending for this stage (task has now reached it after a prior rejection backward)
  await db('task_assignees').where({ task_id: ticket.id, stage_idx: targetIdx, acceptance_status: 'pre_pending' }).update({ acceptance_status: 'pending' });

  // Skip only when every assignee row for this stage is marked skipped (no real active person)
  const stageRows = await db('task_assignees').where({ task_id: ticket.id, stage_idx: targetIdx });
  const allSkipped = stageRows.length > 0 && stageRows.every((r: any) => r.skipped);
  if (allSkipped) {
    await appendLog(ticket.id, actor, 'next_stage', fromState, 'skipped', `Stage ${targetIdx + 1} skipped`);
    return advanceToStage(db, ticket, stages, finalApproval, targetIdx + 1, actor, fromState, res);
  }

  const nextStage = stages[targetIdx];
  const nType = stageType(nextStage);

  if (nType === 'employee') {
    const pre = pickStageRow(await db('task_assignees').where({ task_id: ticket.id, stage_idx: targetIdx, assignee_role: 'employee' }));
    // Clear the approval record — work is in progress, not in review
    const empAp = await db('approvals').where({ task_id: ticket.id }).whereNotIn('status', ['approved', 'rejected']).first();
    if (empAp) await db('approvals').where({ id: empAp.id }).update({ status: 'work_in_progress', workflow_type: 'xlr8' });
    if (pre) {
      const alreadyAccepted = pre.acceptance_status === 'accepted';
      const nextXlr8Status = alreadyAccepted ? 'in_progress' : 'pending_assignee';
      const nextTaskStatus = alreadyAccepted ? 'in_progress' : 'todo';
      await db('tasks').where({ id: ticket.id }).update({ xlr8_status: nextXlr8Status, xlr8_stage_idx: targetIdx, xlr8_assignee_id: pre.user_id, assigned_to: pre.user_id, status: nextTaskStatus });
      await appendLog(ticket.id, actor, 'next_stage', fromState, nextXlr8Status, `Stage ${targetIdx + 1}: ${nextStage.category_name}`);
      // Back here because a later decline sent the ticket to an earlier stage?
      const decline = await db('xlr8_ticket_log')
        .where({ task_id: ticket.id }).whereIn('action', ['manager_declined', 'admin_declined'])
        .orderBy('created_at', 'desc').first();
      const isRework = decline && decline.to_stage_idx != null && decline.from_stage_idx != null &&
        targetIdx > decline.to_stage_idx && targetIdx <= decline.from_stage_idx;
      const notifMsg = isRework
        ? `Ticket "${ticket.title}" is back with you for rework — ${decline.actor_name} sent it back${decline.comment ? `: "${decline.comment}"` : ''}`
        : alreadyAccepted
          ? `It's your turn on ticket "${ticket.title}" — Stage ${targetIdx + 1} is now active`
          : `Ticket "${ticket.title}" has been assigned to you`;
      await createNotification(pre.user_id!, notifMsg, 'task', ticket.project_id);
      // Reschedule the new stage assignee
      import('../services/scheduler').then(({ scheduleUser }) => scheduleUser(pre.user_id!, db)).catch(() => {});
      res.json({ ok: true, next: 'pending_assignee' });
    } else {
      await db('tasks').where({ id: ticket.id }).update({ xlr8_status: 'pending_manager', xlr8_stage_idx: targetIdx, xlr8_assignee_id: null, assigned_to: null, status: 'todo' });
      await appendLog(ticket.id, actor, 'next_stage', fromState, 'pending_manager', `Stage ${targetIdx + 1}: ${nextStage.category_name}`);
      const managers = await projectManagers(db, ticket.project_id);
      for (const m of managers) await createNotification(m.id, `Ticket "${ticket.title}" — assign a ${nextStage.category_name} for stage ${targetIdx + 1}`, 'task', ticket.project_id);
      res.json({ ok: true, next: 'pending_manager' });
    }
    return;
  }

  if (nType === 'manager') {
    const pre = pickStageRow(await db('task_assignees').where({ task_id: ticket.id, stage_idx: targetIdx }));
    const mgr = pre?.user_id || null;
    await db('tasks').where({ id: ticket.id }).update({ xlr8_status: 'pending_manager', xlr8_stage_idx: targetIdx, xlr8_assignee_id: mgr, assigned_to: mgr, status: 'in_review' });
    await appendLog(ticket.id, actor, 'next_stage', fromState, 'pending_manager', `Stage ${targetIdx + 1}: Manager Review`);
    const existingMgr = await db('approvals').where({ task_id: ticket.id }).whereNotIn('status', ['approved', 'rejected']).first();
    if (existingMgr) await db('approvals').where({ id: existingMgr.id }).update({ status: 'pending_manager', workflow_type: 'xlr8' });
    else await db('approvals').insert({ task_id: ticket.id, title: ticket.title, project_id: ticket.project_id, submitted_by: actor.id, status: 'pending_manager', workflow_type: 'xlr8' });
    if (mgr) {
      await createNotification(mgr, `Ticket "${ticket.title}" is ready for your review`, 'approval', ticket.project_id);
    } else {
      const managers = await projectManagers(db, ticket.project_id);
      for (const m of managers) await createNotification(m.id, `Ticket "${ticket.title}" ready for manager review`, 'approval', ticket.project_id);
    }
    res.json({ ok: true, next: 'pending_manager' }); return;
  }

  // admin stage
  const pre = pickStageRow(await db('task_assignees').where({ task_id: ticket.id, stage_idx: targetIdx }));
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
