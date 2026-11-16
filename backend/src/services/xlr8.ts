// XLR8 ticket workflow: stage chain, acceptance, review, final approval. Shared by the website routes
// (routes/xlr8.ts) and the assistant. Moved from routes/xlr8.ts; behaviour unchanged except that every
// action checks who may perform it here (managers act only within their pod scope — see canManageTask).
import { Knex } from 'knex';
import { getDB, createNotification } from '../db';
import { stageChecklistItems, refreshChecklistCounts, uncheckedItems, uncheckedError } from '../utils/checklist';
import { Actor, ServiceError, canSeeTask, canManageTask } from './access';

type Db = Knex | any;
type Result = { ok: true; next?: string; [k: string]: unknown };

// MySQL returns JSON columns as already-parsed objects; SQLite returns strings
export function pj(v: any, fallback: any) { if (!v) return fallback; if (typeof v === 'string') return JSON.parse(v); return v; }

export function parseTicketType(row: any) {
  return { ...row, stages: pj(row.stages, []), final_approval: pj(row.final_approval, {}), checklist: pj(row.checklist, []) };
}

// Stages without an explicit type are backward-compat employee stages
export function stageType(stage: any): 'employee' | 'manager' | 'admin' {
  if (stage?.reviewer === true) return 'manager';
  if (stage?.type === 'admin') return 'admin';
  return 'employee';
}

function scheduleTask(id: number, db: Db) { import('./scheduler').then(({ scheduleTaskUsers }) => scheduleTaskUsers(id, db)).catch(() => {}); }
function scheduleOne(userId: number, db: Db) { import('./scheduler').then(({ scheduleUser }) => scheduleUser(userId, db)).catch(() => {}); }

async function loadType(db: Db, ticket: any) {
  const tt = await db('xlr8_ticket_types').where({ id: ticket.ticket_type_id }).first();
  return { stages: pj(tt?.stages, []) as any[], finalApproval: pj(tt?.final_approval, {}) };
}

async function requireManage(db: Db, actor: Actor, taskId: number | string) {
  if (!(await canManageTask(db, actor, taskId))) throw new ServiceError(403, 'Not your pod — this ticket belongs to another pod manager');
}

async function fullySkippedIdxs(db: Db, task_id: number): Promise<Set<number>> {
  const rows = await db('task_assignees').where({ task_id }).select('stage_idx', 'skipped');
  const byIdx = new Map<number, boolean>();
  for (const r of rows) {
    const idx = Number(r.stage_idx);
    byIdx.set(idx, (byIdx.get(idx) ?? true) && !!r.skipped);
  }
  return new Set([...byIdx.entries()].filter(([, v]) => v).map(([k]) => k));
}

async function returnableStages(db: Db, ticket: any, stages: any[]) {
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

// The person who should work a stage: not skipped, not declined, and a real user
export function pickStageRow<T extends { user_id: number | null; skipped?: any; acceptance_status?: string | null }>(rows: T[]): T | undefined {
  return rows.find(r => r.user_id != null && !r.skipped && r.acceptance_status !== 'declined');
}

const ONE_PER_STAGE = 'Only one person can be assigned to each stage';
const tooManyPerStage = (sas: any[]) => Array.isArray(sas) && sas.some((sa: any) => Array.isArray(sa?.user_ids) && new Set(sa.user_ids.map(Number)).size > 1);

// Send a ticket back to an earlier work stage (manager decline, admin decline, client rejection share this)
async function sendBack(db: Db, ticket: any, stages: any[], requested: any): Promise<{ targetIdx: number; assigneeId: number | null } | null> {
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
    xlr8_status: assigneeId ? 'in_progress' : 'needs_reassignment', xlr8_stage_idx: targetIdx,
    xlr8_assignee_id: assigneeId, assigned_to: assigneeId, status: assigneeId ? 'in_progress' : 'todo',
  });
  // Target stage: they already accepted it once, no re-accept needed
  if (assigneeId) await db('task_assignees').where({ task_id: ticket.id, user_id: assigneeId, stage_idx: targetIdx }).update({ acceptance_status: 'accepted' });
  // Hide future-stage pre-assignment prompts until the task reaches those stages again
  await db('task_assignees').where({ task_id: ticket.id }).where('stage_idx', '>', targetIdx).whereIn('acceptance_status', ['pending']).update({ acceptance_status: 'pre_pending' });
  await refreshChecklistCounts(db, ticket.id);
  scheduleTask(ticket.id, db);
  return { targetIdx, assigneeId };
}

async function pickedReturnIdx(db: Db, ticket: any, stages: any[], requested: any): Promise<number | null> {
  if (requested === undefined || requested === null || requested === '') return null;
  const idx = Number(requested);
  const allowed = await returnableStages(db, ticket, stages);
  return allowed.some((s) => s.idx === idx) ? idx : -1;
}

export async function appendLog(task_id: number, actor: { id: number; name?: string } | null, action: string, from_state: string | null, to_state: string | null, comment?: string, stages?: { from: number; to: number }) {
  await getDB()('xlr8_ticket_log').insert({
    from_stage_idx: stages?.from ?? null, to_stage_idx: stages?.to ?? null,
    task_id, actor_id: actor?.id ?? null, actor_name: actor?.name ?? 'System',
    action, from_state, to_state, comment: comment || null, created_at: new Date(),
  });
}

// Who should hear about a ticket's project: admins, managers of the project's pod, and managers on the project
export async function projectManagers(db: Db, projectId: number): Promise<{ id: number }[]> {
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
export const awaitingPodApproval = (t: { crosspod_pods?: string | null }) => !!t.crosspod_pods;
export const AWAITING_APPROVAL = 'This task is waiting for the pod managers to approve it — you can accept and start once they have';
export const reasonPods = (reasons: ApprovalReason[]) => [...new Set(reasons.map((r) => r.pod))];

// Why a new task needs a pod manager's sign-off, one line per cause, tagged with the pod that must approve it:
// another pod's project, another pod's employee assigned, or custom stages built by an employee.
export async function approvalReasons(
  db: Db, actor: { id: number; role: string },
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
      out.push({ pod: u.pod, text: `${me.name} (${podLabel(me.pod)}) assigned your ${podLabel(u.pod)} member ${u.name}${where.length ? ` to ${where.join(', ')}` : ' to this ticket'}` });
    }
  }
  if (customStageCount && actor.role === 'employee') {
    out.push({ pod: me.pod, text: `${me.name} built custom stages (${customStageCount} stage${customStageCount === 1 ? '' : 's'}) instead of using a ticket type` });
  }
  // Cross-pod work needs both sides: the creator's own pod manager signs off too (a manager creating it counts as that sign-off)
  if (actor.role === 'employee' && out.some((r) => r.pod !== me.pod) && !out.some((r) => r.pod === me.pod)) {
    const others = [...new Set(out.filter((r) => r.pod !== me.pod).map((r) => podLabel(r.pod)))].join(', ');
    out.push({ pod: me.pod, text: `${me.name} from your pod is creating cross-pod work involving ${others}` });
  }
  return out;
}

// Admins skip cross-pod approval, but the other pod's manager should still hear that their
// people were put on another pod's project. FYI only — the task is not held.
export async function notifyAdminCrossPod(
  db: Db, actor: { id: number; name?: string; role: string },
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

export async function holdForCrossPod(db: Db, task: { id: number; title: string; project_id: number; isTicket: boolean; customStages?: boolean }, reasons: ApprovalReason[], actor: { id: number; name?: string }) {
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
export async function discardRejected(db: Db, replacesId: any, user: { id: number; role: string }): Promise<any | null> {
  if (!replacesId) return null;
  let old = await db('tasks').where({ id: replacesId, created_by: user.id, status: 'draft' }).first();
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
    // Only tables that may be absent on some installs are skipped; any other failure must stop the change
    if (await db.schema.hasTable(t)) await db(t).where({ task_id: old.id }).delete();
  }
  await db('tasks').where({ id: old.id }).delete();
  await dropCustomTypeIfUnused(db, old.ticket_type_id);
  return old;
}

// A custom stage set lives only as long as a ticket uses it
export async function dropCustomTypeIfUnused(db: Db, typeId: number | null | undefined) {
  if (!typeId) return;
  const t = await db('xlr8_ticket_types').where({ id: typeId }).first();
  if (!t?.is_custom) return;
  const used = await db('tasks').where({ ticket_type_id: typeId }).first();
  if (!used) await db('xlr8_ticket_types').where({ id: typeId }).delete();
}

// After a manager rebuilds someone's request, keep the original requester as creator and tell them
export async function creditRequester(db: Db, newId: number, old: any, actor: { id: number; name?: string }) {
  if (!old || old.created_by === actor.id) return;
  await db('tasks').where({ id: newId }).update({ created_by: old.created_by });
  await createNotification(old.created_by, `${actor.name} edited and created your request "${old.title}"`, 'task', old.project_id);
}

// If the ticket sits on a stage where everyone is skipped, move it forward with the normal stage logic
// (which keeps skipping, auto-starts pre-accepted people, and opens approvals). Returns true if it moved.
export async function skipPastSkippedStage(db: Db, id: number, actor: any): Promise<boolean> {
  const ticket = await db('tasks').where({ id }).first();
  if (!ticket?.ticket_type_id || ticket.crosspod_pods || ['completed', 'draft', 'pending_approval'].includes(ticket.xlr8_status)) return false;
  const { stages, finalApproval } = await loadType(db, ticket);
  const idx = ticket.xlr8_stage_idx ?? 0;
  if (idx >= stages.length || !(await fullySkippedIdxs(db, id)).has(idx)) return false;
  await advanceToStage(db, ticket, stages, finalApproval, idx, actor, ticket.xlr8_status);
  return true;
}

// A transition interrupted by a crash leaves the ticket as claimed:<status>. The server is a single process,
// so at startup nothing is still running: put each such ticket back to the status it was in, so the step can be retried.
export async function recoverInterruptedTransitions(db: Db): Promise<number> {
  const rows = await db('tasks').where('xlr8_status', 'like', 'claimed:%').select('id', 'xlr8_status');
  for (const r of rows) await db('tasks').where({ id: r.id, xlr8_status: r.xlr8_status }).update({ xlr8_status: String(r.xlr8_status).slice('claimed:'.length) });
  return rows.length;
}

// One-off repair at startup for tickets created before leading skipped stages were handled
export async function repairSkippedStageTickets(db: Db): Promise<void> {
  const rows = await db('tasks').whereNotNull('ticket_type_id').whereNull('crosspod_pods')
    .whereNotIn('xlr8_status', ['completed', 'draft', 'pending_approval']).select('id', 'created_by');
  for (const { id, created_by } of rows) {
    try { if (await skipPastSkippedStage(db, id, { id: created_by, name: 'System' })) console.log(`[xlr8] ticket ${id}: moved past skipped stage(s)`); }
    catch (e: any) { console.error(`[xlr8] ticket ${id}: skip repair failed`, e?.message); }
  }
}

// Work can't begin until everyone doing work on this and later (non-skipped) stages has accepted.
// Admins only give final approval and are never asked to accept. "pre_pending" = parked during rework, not a blocker.
export async function waitingOn(db: Db, ticketId: number, fromIdx: number): Promise<string[]> {
  return db('task_assignees as ta').join('users as u', 'u.id', 'ta.user_id')
    .where('ta.task_id', ticketId).where('ta.stage_idx', '>=', fromIdx)
    .where('ta.assignee_role', 'employee')
    .whereNot('u.role', 'admin')
    .where((q: any) => q.whereNull('ta.skipped').orWhere('ta.skipped', 0))
    .where((q: any) => q.whereNull('ta.acceptance_status').orWhereNotIn('ta.acceptance_status', ['accepted', 'pre_pending']))
    .distinct('u.name').pluck('u.name');
}

// Accepting a ticket covers every work stage this person has on it (someone can be on two stages)
export async function acceptAllMyStages(db: Db, ticketId: number, userId: number): Promise<void> {
  await db('task_assignees').where({ task_id: ticketId, user_id: userId, assignee_role: 'employee' })
    .where((q: any) => q.whereNull('skipped').orWhere('skipped', 0))
    .where((q: any) => q.whereNull('acceptance_status').orWhere('acceptance_status', 'pending'))
    .update({ acceptance_status: 'accepted' });
}

export async function startIfAccepted(db: Db, id: number, actor: any): Promise<void> {
  const t = await db('tasks').where({ id, xlr8_status: 'pending_assignee' }).whereNull('crosspod_pods').first();
  if (!t) return;
  if ((await waitingOn(db, id, t.xlr8_stage_idx ?? 0)).length) return;
  const row = pickStageRow(await db('task_assignees').where({ task_id: id, stage_idx: t.xlr8_stage_idx ?? 0, assignee_role: 'employee' }));
  if (row?.acceptance_status !== 'accepted') return;
  // Guarded by the status so two simultaneous acceptances can't both start it
  const n = await db('tasks').where({ id, xlr8_status: 'pending_assignee' }).update({ xlr8_status: 'in_progress', status: 'in_progress', xlr8_assignee_id: row.user_id, assigned_to: row.user_id });
  if (!n) return;
  await appendLog(id, actor, 'employee_accepted', 'pending_assignee', 'in_progress', 'Everyone accepted — started');
  if (row.user_id !== actor?.id) await createNotification(row.user_id!, `Everyone has accepted "${t.title}" — you can start working`, 'task', t.project_id);
  scheduleOne(row.user_id!, db);
}

export async function activateTicket(db: Db, id: number, actor: { id: number; name?: string }) {
  const task = await db('tasks').where({ id }).first();
  const { stages } = await loadType(db, task);
  const firstStage = stages[0];
  const { title, project_id } = task;
  const fType = firstStage ? stageType(firstStage) : null;
  const first0 = await db('task_assignees').where({ task_id: id, stage_idx: 0 }).whereNotNull('user_id').where((q: any) => q.whereNull('skipped').orWhere('skipped', 0)).orderBy('id').first();
  const preId0 = first0?.user_id ?? null;

  if ((await fullySkippedIdxs(db, id)).has(0)) {
    await appendLog(id, actor, 'created', null, task.xlr8_status);
    await skipPastSkippedStage(db, id, actor);
  } else if (fType === 'employee' && preId0) {
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
    if (m.id !== task.created_by) await createNotification(m.id, `New ticket "${title}" created — ${stageName}`, 'task', project_id);
  }

  await startIfAccepted(db, id, actor);

  // Notify ALL pre-assigned employee stage members to pre-accept their future stage
  const allStageEmployees = await db('task_assignees')
    .where({ task_id: id, assignee_role: 'employee' }).whereNotNull('user_id')
    .where((q: any) => q.whereNull('skipped').orWhere('skipped', 0))
    .select('user_id', 'stage_idx');
  for (const sa of allStageEmployees) {
    await createNotification(sa.user_id, `You've been pre-assigned to stage ${(sa.stage_idx ?? 0) + 1} of "${title}" — please accept or decline`, 'task', project_id);
  }
  scheduleTask(id, db);
}

// ── Ticket types (admin) ────────────────────────────────────────────────────

export async function listTicketTypes(db: Db) {
  // Custom stage sets belong to a single ticket and are never offered as templates
  const rows = await db('xlr8_ticket_types').where((q: any) => q.whereNull('is_custom').orWhere('is_custom', false)).orderBy('name');
  return rows.map(parseTicketType);
}

// Duplicate protection: atomically move the ticket out of fromStatus before running a transition, so a
// repeated request (double click, retried message) finds nothing to do. Restores fromStatus if it fails.
async function claimed<T>(db: Db, id: number, fromStatus: string, alreadyMsg: string, run: () => Promise<T>): Promise<T> {
  const n = await db('tasks').where({ id, xlr8_status: fromStatus }).update({ xlr8_status: 'claimed:' + fromStatus });
  if (!n) throw new ServiceError(409, alreadyMsg);
  try { return await run(); }
  catch (e) { await db('tasks').where({ id, xlr8_status: 'claimed:' + fromStatus }).update({ xlr8_status: fromStatus }).catch(() => {}); throw e; }
}

function adminOnly(actor: Actor) { if (actor.role !== 'admin') throw new ServiceError(403, 'Admin only'); }

export async function saveTicketType(db: Db, actor: Actor, id: number | null, body: any) {
  adminOnly(actor);
  const { name, stages, final_approval, checklist } = body ?? {};
  if (!name?.trim()) throw new ServiceError(400, 'Name required');
  if (id == null) {
    const [newId] = await db('xlr8_ticket_types').insert({
      name: name.trim(), stages: JSON.stringify(stages || []),
      final_approval: JSON.stringify(final_approval || { adminRequired: true, adminSkippable: true, clientOptional: true }),
      checklist: JSON.stringify(checklist || []),
    });
    return { id: newId };
  }
  await db('xlr8_ticket_types').where({ id }).update({
    name: name.trim(), stages: JSON.stringify(stages || []), final_approval: JSON.stringify(final_approval || {}), checklist: JSON.stringify(checklist || []),
  });
  return { ok: true };
}

export async function deleteTicketType(db: Db, actor: Actor, id: number | string) {
  adminOnly(actor);
  await db('xlr8_ticket_types').where({ id }).delete();
}

// ── Tickets: read ───────────────────────────────────────────────────────────

export async function listTickets(db: Db, actor: Actor, filters: { project_id?: any } = {}) {
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
  if (filters.project_id) q = q.where('t.project_id', filters.project_id);
  if (actor.role === 'manager') {
    // Pod scoping: managers only see their pod's projects
    const mgr = await db('users').where({ id: actor.id }).select('pod').first();
    if (mgr?.pod) q = q.where('p.pod', mgr.pod);
  } else if (actor.role === 'employee') {
    // Only tickets they raised or actually work on (skipped stages and declined tickets don't count)
    const uid = actor.id;
    q = q.where((w: any) => w.where('t.created_by', uid).orWhereIn('t.id',
      db('task_assignees').where('user_id', uid)
        .where((x: any) => x.whereNull('skipped').orWhere('skipped', 0))
        .where((x: any) => x.whereNull('acceptance_status').orWhere('acceptance_status', '!=', 'declined'))
        .select('task_id')));
  } else if (actor.role === 'client') {
    const me = await db('users').where({ id: actor.id }).select('client_company_id').first();
    q = q.where('p.client_company_id', me?.client_company_id ?? -1);
  }
  const rows = await q.orderBy('t.created_at', 'desc');
  return rows.map((r: any) => ({ ...r, stages: pj(r.stages, []), final_approval: pj(r.final_approval, {}) }));
}

export async function getTicket(db: Db, actor: Actor, id: number | string) {
  const ticket = await db('tasks as t')
    .leftJoin('users as creator', 'creator.id', 't.created_by')
    .leftJoin('users as assignee', 'assignee.id', 't.xlr8_assignee_id')
    .leftJoin('xlr8_ticket_types as tt', 'tt.id', 't.ticket_type_id')
    .where('t.id', id).whereNotNull('t.ticket_type_id')
    .select(
      't.*',
      'creator.name as creator_name', 'creator.avatar_color as creator_color',
      'assignee.name as assignee_name', 'assignee.avatar_color as assignee_color', 'assignee.avatar_url as assignee_avatar_url', 'assignee.role as assignee_role',
      'tt.name as ticket_type_name', 'tt.stages', 'tt.final_approval',
    )
    .first();
  if (!ticket || !(await canSeeTask(db, actor, ticket.id))) throw new ServiceError(404, 'Ticket not found');
  if (actor.role === 'employee' && ticket.created_by !== actor.id && !(await db('task_assignees').where({ task_id: ticket.id, user_id: actor.id }).where((x: any) => x.whereNull('skipped').orWhere('skipped', 0)).where((x: any) => x.whereNull('acceptance_status').orWhere('acceptance_status', '!=', 'declined')).first())) {
    throw new ServiceError(404, 'Ticket not found');
  }
  const log = await db('xlr8_ticket_log').where({ task_id: id }).orderBy('created_at', 'asc');
  return { ...ticket, stages: pj(ticket.stages, []), final_approval: pj(ticket.final_approval, {}), log };
}

export async function getTicketLog(db: Db, actor: Actor, id: number | string) {
  if (!(await canSeeTask(db, actor, id))) throw new ServiceError(404, 'Ticket not found');
  return db('xlr8_ticket_log').where({ task_id: id }).orderBy('created_at', 'asc');
}

export async function getReturnStages(db: Db, actor: Actor, id: number | string) {
  const ticket = await db('tasks').where({ id }).first();
  if (!ticket || !(await canSeeTask(db, actor, id))) throw new ServiceError(404, 'Ticket not found');
  if (!['admin', 'manager'].includes(actor.role) && ticket.xlr8_assignee_id !== actor.id) throw new ServiceError(403, 'Not authorized');
  const { stages } = await loadType(db, ticket);
  return returnableStages(db, ticket, stages);
}

// ── Tickets: create ─────────────────────────────────────────────────────────

export async function createTicket(db: Db, actor: Actor, body: any): Promise<Record<string, unknown>> {
  if (!['admin', 'manager', 'employee'].includes(actor.role)) throw new ServiceError(403, 'Insufficient permissions');
  const { title, description, project_id, due_date, stage_assignments, draft, priority, custom_stages } = body ?? {};
  let { ticket_type_id } = body ?? {};
  // stage_assignments: [{ stage_idx, user_ids: number[], est_hours?: number }]
  if (!title?.trim() || !project_id) throw new ServiceError(400, 'title and project_id required');
  if (!draft && !ticket_type_id && !custom_stages) throw new ServiceError(400, 'ticket_type_id required');
  if (tooManyPerStage(stage_assignments)) throw new ServiceError(400, ONE_PER_STAGE);
  const isDraft = !!draft;
  const project = await db('projects').where({ id: project_id }).first();
  if (!project) throw new ServiceError(400, 'Project not found');

  // Stages built in the form for this ticket only: stored as a hidden, single-use stage set
  if (custom_stages) {
    const cs = custom_stages;
    if (!Array.isArray(cs.stages) || cs.stages.length === 0) throw new ServiceError(400, 'Add at least one custom stage');
    [ticket_type_id] = await db('xlr8_ticket_types').insert({
      name: String(cs.name || 'Custom stages').trim().slice(0, 120),
      stages: JSON.stringify(cs.stages.map((st: any) => st?.type === 'admin'
        ? { type: 'admin', ...(Array.isArray(st.checklist) ? { checklist: st.checklist } : {}) }
        : { type: 'employee', category_id: Number(st.category_id), category_name: String(st.category_name || ''), ...(st.reviewer ? { reviewer: true } : {}), ...(Array.isArray(st.checklist) ? { checklist: st.checklist } : {}) })),
      final_approval: JSON.stringify({ adminRequired: true, adminSkippable: true, clientOptional: true, ...(cs.final_approval || {}) }),
      checklist: JSON.stringify([]),
      is_custom: true,
      created_by: actor.id,
    });
  }

  if (isDraft) {
    const [id] = await db('tasks').insert({
      title: title.trim(), description: description || null, project_id, created_by: actor.id,
      due_date: due_date || null, status: 'draft', ticket_type_id: ticket_type_id || null,
      xlr8_stage_idx: 0, xlr8_status: 'draft', priority: priority || 'medium', draft_form: body.draft_form || null,
    });
    await discardRejected(db, body.replaces_id, actor);
    await appendLog(id, actor, 'created', null, 'draft');
    return { id };
  }

  const ticketType = await db('xlr8_ticket_types').where({ id: ticket_type_id }).first();
  if (!ticketType) throw new ServiceError(400, 'Ticket type not found');
  const stages: any[] = pj(ticketType.stages, []);

  // Each stage gets its own checklist (form edits, else the type's stage defaults; skipped stages/checklists get none).
  // An old shared type checklist still applies to the whole task (stage_idx null).
  const saByIdx = new Map<number, any>((Array.isArray(stage_assignments) ? stage_assignments : []).map((sa: any) => [Number(sa.stage_idx), sa]));
  const checklistRows: { text: string; completed: number; stage_idx: number | null }[] = [];
  stages.forEach((st: any, i: number) => { for (const text of stageChecklistItems(st, saByIdx.get(i))) checklistRows.push({ text, completed: 0, stage_idx: i }); });
  for (const i of pj(ticketType.checklist, []).filter((i: any) => i.text?.trim())) checklistRows.push({ text: i.text.trim(), completed: i.checked ? 1 : 0, stage_idx: null });

  const [id] = await db('tasks').insert({
    title: title.trim(), description: description || null, project_id, created_by: actor.id, due_date: due_date || null,
    status: actor.role === 'employee' ? 'pending_approval' : 'todo',
    ticket_type_id, xlr8_stage_idx: 0,
    xlr8_status: actor.role === 'employee' ? 'pending_approval' : 'pending_manager',
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
      if (skipped) {
        rows.push({ task_id: id, user_id: null, assignee_role: sType, acceptance_status: 'pending', stage_idx: sa.stage_idx, est_hours: 0, skipped: 1, is_reviewer: isReviewer });
      } else if (sa.user_ids.length > 0) {
        for (const uid of sa.user_ids) rows.push({ task_id: id, user_id: uid, assignee_role: sType, acceptance_status: 'pending', stage_idx: sa.stage_idx, est_hours: estH, skipped: 0, is_reviewer: isReviewer });
      } else if (estH) {
        // No user yet (review stage with no pre-assignment)
        rows.push({ task_id: id, user_id: null, assignee_role: sType, acceptance_status: 'pending', stage_idx: sa.stage_idx, est_hours: estH, skipped: 0, is_reviewer: isReviewer });
      }
    }
    if (rows.length > 0) await db('task_assignees').insert(rows);
    const totalHours = stage_assignments.reduce((sum: number, sa: any) => sum + (sa.est_hours || 0), 0);
    if (totalHours > 0) await db('tasks').where({ id }).update({ estimated_hours: totalHours });
  }

  const replaced = await discardRejected(db, body.replaces_id, actor);
  await creditRequester(db, id, replaced, actor);

  const assignments = Array.isArray(stage_assignments)
    ? stage_assignments.filter((sa: any) => !sa.skipped).flatMap((sa: any) => (Array.isArray(sa.user_ids) ? sa.user_ids : [])
        .map((uid: number) => ({ user_id: Number(uid), stage_idx: Number(sa.stage_idx), stage_name: stages[sa.stage_idx]?.category_name })))
    : [];
  const customStages = !!ticketType.is_custom;
  const reasons = await approvalReasons(db, actor, project, assignments, customStages ? stages.length : 0);
  const pods = reasonPods(reasons);
  if (pods.length) {
    await holdForCrossPod(db, { id, title: title.trim(), project_id, isTicket: true, customStages }, reasons, actor);
    return { id, crosspod_pending: pods, custom_stages: customStages };
  }

  if (actor.role === 'employee') {
    // Employee requests wait for a manager's approval before anyone is asked to accept or start
    await appendLog(id, actor, 'created', null, 'pending_approval', 'Waiting for manager approval');
    for (const m of await projectManagers(db, project_id)) await createNotification(m.id, `Approval needed for "${title.trim()}" from ${actor.name}`, 'approval', project_id);
    return { id, pending_approval: true };
  }
  await activateTicket(db, id, actor);
  await notifyAdminCrossPod(db, actor, { title: title.trim(), project_id }, project, assignments);
  return { id };
}

// ── Tickets: manager assignment ─────────────────────────────────────────────

export async function updateStageAssignments(db: Db, actor: Actor, id: number | string, body: any): Promise<Result> {
  if (!['admin', 'manager'].includes(actor.role)) throw new ServiceError(403, 'Manager only');
  const { stage_assignments } = body ?? {};
  if (!Array.isArray(stage_assignments)) throw new ServiceError(400, 'stage_assignments required');
  const ticket = await db('tasks').where({ id }).first();
  if (!ticket) throw new ServiceError(404, 'Ticket not found');
  await requireManage(db, actor, ticket.id);
  const { stages } = await loadType(db, ticket);
  if (tooManyPerStage(stage_assignments)) throw new ServiceError(400, ONE_PER_STAGE);

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
    if (keep.skipped) {
      rows.push({ task_id: ticket.id, user_id: null, assignee_role: sType, acceptance_status: 'pending', stage_idx: sa.stage_idx, est_hours: 0, ...keep });
    } else if (sa.user_ids.length > 0) {
      for (const uid of sa.user_ids) {
        const prev = prevByKey.get(`${sa.stage_idx}:${uid}`);
        // Re-picking someone who declined this stage asks them again
        const status = !prev?.acceptance_status || prev.acceptance_status === 'declined' ? 'pending' : prev.acceptance_status;
        rows.push({ task_id: ticket.id, user_id: uid, assignee_role: sType, acceptance_status: status, stage_idx: sa.stage_idx, est_hours: estH, schedule_anchor: prev?.schedule_anchor ?? null, ...keep });
      }
    } else if (estH) {
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
      await appendLog(ticket.id, actor, 'assigned', ticket.xlr8_status, accepted ? 'in_progress' : 'pending_assignee', `Stage ${currentStageIdx + 1} reassigned`);
    }
  }

  // Notify people newly put on a stage, and anyone re-asked after declining it
  for (const r of rows.filter(r => r.user_id && !r.skipped && (!prevByKey.has(`${r.stage_idx}:${r.user_id}`) || prevByKey.get(`${r.stage_idx}:${r.user_id}`)?.acceptance_status === 'declined'))) {
    await createNotification(r.user_id, `You've been assigned to stage ${(r.stage_idx ?? 0) + 1} of "${ticket.title}" — please accept or decline`, 'task', ticket.project_id);
  }

  await skipPastSkippedStage(db, ticket.id, actor);
  await startIfAccepted(db, ticket.id, actor);
  scheduleTask(ticket.id, db);
  return { ok: true };
}

// Manager: start assignment — only valid when current stage is employee type
export async function startAssignment(db: Db, actor: Actor, id: number | string): Promise<Record<string, unknown>> {
  const ticket = await db('tasks').where({ id, xlr8_status: 'pending_manager' }).first();
  if (!ticket) throw new ServiceError(404, 'Ticket not found or not pending assignment');
  if (!['admin', 'manager'].includes(actor.role)) throw new ServiceError(403, 'Manager only');
  await requireManage(db, actor, ticket.id);
  const { stages } = await loadType(db, ticket);
  const currentStage = stages[ticket.xlr8_stage_idx ?? 0];
  if (currentStage && stageType(currentStage) === 'manager') throw new ServiceError(400, 'Ticket is in manager review mode — use the review route');

  // Clear stale assignee if present (happens after employee decline)
  if (ticket.xlr8_assignee_id) {
    await db('tasks').where({ id: ticket.id }).update({ xlr8_assignee_id: null, assigned_to: null });
    ticket.xlr8_assignee_id = null;
  }
  const stage = currentStage;
  if (!stage) throw new ServiceError(400, 'No stage defined for this ticket type');

  const preAssigned = await db('task_assignees as ta')
    .join('users as u', 'u.id', 'ta.user_id')
    .where({ 'ta.task_id': ticket.id, 'ta.stage_idx': ticket.xlr8_stage_idx ?? 0, 'ta.assignee_role': 'employee' })
    .andWhere((q: any) => q.whereNot('ta.acceptance_status', 'declined').orWhereNull('ta.acceptance_status'))
    .andWhere((q: any) => q.whereNull('ta.skipped').orWhere('ta.skipped', 0))
    .select('u.id', 'u.name', 'u.avatar_color', 'u.avatar_url');
  if (preAssigned.length === 1) {
    await assignToEmployee(db, ticket, preAssigned[0], actor, stage, 'auto');
    return { auto_assigned: true, assignee: preAssigned[0] };
  }
  if (preAssigned.length > 1) return { auto_assigned: false, eligible: preAssigned };

  const me = await db('users').where({ id: actor.id }).select('pod', 'role').first();
  let eligibleQuery = db('users as u')
    .join('user_categories as uc', 'uc.user_id', 'u.id')
    .join('employee_categories as ec', 'ec.id', 'uc.category_id')
    .where('ec.name', stage.category_name).where('u.role', 'employee');
  if (me?.pod) eligibleQuery = eligibleQuery.where('u.pod', me.pod);
  const eligible = await eligibleQuery.select('u.id', 'u.name', 'u.avatar_color', 'u.avatar_url');
  if (eligible.length === 0) throw new ServiceError(400, `No employees found in category "${stage.category_name}". Please assign someone to this category first.`);
  if (eligible.length === 1) {
    await assignToEmployee(db, ticket, eligible[0], actor, stage, 'auto');
    return { auto_assigned: true, assignee: eligible[0] };
  }
  return { auto_assigned: false, eligible };
}

export async function assignTicket(db: Db, actor: Actor, id: number | string, body: any): Promise<Result> {
  const { assignee_id } = body ?? {};
  if (!assignee_id) throw new ServiceError(400, 'assignee_id required');
  if (!['admin', 'manager'].includes(actor.role)) throw new ServiceError(403, 'Manager only');
  const ticket = await db('tasks').where({ id }).whereIn('xlr8_status', ['pending_manager', 'needs_reassignment']).first();
  if (!ticket) throw new ServiceError(404, 'Ticket not found or not pending assignment');
  await requireManage(db, actor, ticket.id);
  const { stages } = await loadType(db, ticket);
  const stage = stages[ticket.xlr8_stage_idx ?? 0];
  const assignee = await db('users').where({ id: assignee_id }).first();
  if (!assignee) throw new ServiceError(404, 'User not found');
  await assignToEmployee(db, ticket, assignee, actor, stage, 'manual');
  return { ok: true };
}

async function assignToEmployee(db: Db, ticket: any, assignee: any, actor: any, stage: any, mode: 'auto' | 'manual') {
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
  await db('tasks').where({ id: ticket.id }).update({ xlr8_status: 'pending_assignee', xlr8_assignee_id: assignee.id, assigned_to: assignee.id });
  await appendLog(ticket.id, actor, 'assigned', ticket.xlr8_status, 'pending_assignee',
    `${mode === 'auto' ? 'Auto-assigned' : 'Assigned'} to ${assignee.name} (${stage?.category_name || 'unknown role'})`);
  await createNotification(assignee.id, `Ticket "${ticket.title}" has been assigned to you`, 'task', ticket.project_id);
  if (ticket.created_by !== actor.id) {
    await createNotification(ticket.created_by, `Your ticket "${ticket.title}" was accepted and assigned to ${assignee.name}`, 'task', ticket.project_id);
  }
  await startIfAccepted(db, ticket.id, actor);
}

// ── Tickets: stage people accept / decline ──────────────────────────────────

// Accept a stage of mine before (or when) it becomes active. Accepting again is a no-op error, never a second run.
export async function preAcceptStage(db: Db, actor: Actor, id: number | string, body: any): Promise<Result> {
  if (!['employee', 'manager'].includes(actor.role)) throw new ServiceError(403, 'Not authorized');
  const open = () => db('task_assignees')
    .where({ task_id: id, user_id: actor.id }).whereIn('assignee_role', ['employee', 'manager'])
    .andWhere((q: any) => q.whereIn('acceptance_status', ['pending', 'pre_pending']).orWhereNull('acceptance_status'))
    .andWhere((q: any) => q.whereNull('skipped').orWhere('skipped', 0));
  // One stage at a time: the one asked for, else this person's earliest open stage
  const target = body?.stage_idx != null ? Number(body.stage_idx) : (await open().orderBy('stage_idx').first())?.stage_idx;
  const held = await db('tasks').where({ id }).first();
  if (held && awaitingPodApproval(held)) throw new ServiceError(409, AWAITING_APPROVAL);
  if (held && ['pending_approval', 'draft'].includes(held.status)) throw new ServiceError(409, 'This ticket is waiting for a manager to approve it — you can accept once it is approved');
  const updated = target === undefined ? 0 : await (target == null ? open().whereNull('stage_idx') : open().where('stage_idx', target)).update({ acceptance_status: 'accepted' });
  if (!updated) throw new ServiceError(404, 'No pending assignment found');
  await acceptAllMyStages(db, Number(id), actor.id);
  const ticket = await db('tasks').where({ id }).first();
  if (ticket) {
    // Accepting your own current stage starts the work, same as employee-accept
    const ownsCurrentStage = ticket.xlr8_status === 'pending_assignee' && await db('task_assignees')
      .where({ task_id: ticket.id, stage_idx: ticket.xlr8_stage_idx ?? 0, user_id: actor.id }).first();
    await appendLog(ticket.id, actor, 'stage_pre_accepted', null, null, ownsCurrentStage ? 'Accepted current stage' : 'Pre-accepted future stage assignment');
    await startIfAccepted(db, ticket.id, actor);
    if (!(await waitingOn(db, ticket.id, ticket.xlr8_stage_idx ?? 0)).length) {
      const managers = await projectManagers(db, ticket.project_id);
      for (const m of managers) await createNotification(m.id, `All members accepted "${ticket.title}" — work can now begin`, 'task', ticket.project_id);
    }
  }
  return { ok: true };
}

export async function preDeclineStage(db: Db, actor: Actor, id: number | string, body: any): Promise<Result> {
  if (!['employee', 'manager'].includes(actor.role)) throw new ServiceError(403, 'Not authorized');
  const mine = () => db('task_assignees').where({ task_id: id, user_id: actor.id }).whereIn('assignee_role', ['employee', 'manager']);
  // A specific stage, or else every stage of mine on this ticket still waiting for my answer
  // (declining "the task" once covers all of them, so it doesn't come back for the next stage)
  let targets: (number | null)[];
  if (body?.stage_idx != null) targets = [Number(body.stage_idx)];
  else {
    const open = await mine().where((q: any) => q.where('acceptance_status', 'pending').orWhereNull('acceptance_status')).orderBy('stage_idx').select('stage_idx');
    targets = open.length ? open.map((r: any) => r.stage_idx)
      : [(await mine().where((q: any) => q.whereNot('acceptance_status', 'declined').orWhereNull('acceptance_status')).orderBy('stage_idx').first())?.stage_idx].filter((x) => x !== undefined);
  }
  let updated = 0;
  for (const t of targets) updated += await (t == null ? mine().whereNull('stage_idx') : mine().where('stage_idx', t)).update({ acceptance_status: 'declined' });
  if (!updated) throw new ServiceError(404, 'No assignment found');
  const ticket = await db('tasks').where({ id }).first();
  if (ticket) {
    // One log row per declined stage, tagged with the stage, so the manager sees each reason once
    for (const t of targets) await appendLog(ticket.id, actor, 'stage_pre_declined', null, null, body?.comment || null, t == null ? undefined : { from: t, to: t });
    const managers = await projectManagers(db, ticket.project_id);
    for (const m of managers) await createNotification(m.id, `${actor.name} declined a stage in "${ticket.title}" — reassignment needed`, 'task', ticket.project_id);
  }
  return { ok: true };
}

export async function acceptCurrentStage(db: Db, actor: Actor, id: number | string): Promise<Result> {
  if (!['employee', 'manager'].includes(actor.role)) throw new ServiceError(403, 'Not authorized');
  const ticket = await db('tasks')
    .where({ id, xlr8_status: 'pending_assignee' })
    .where(function (this: any) { this.where('xlr8_assignee_id', actor.id).orWhereNull('xlr8_assignee_id'); })
    .first();
  if (!ticket) throw new ServiceError(404, 'Ticket not found or not available');
  // Verify the caller is actually assigned to this stage — prevents any employee from grabbing an unassigned ticket
  const stageAssignment = await db('task_assignees').where({ task_id: ticket.id, stage_idx: ticket.xlr8_stage_idx ?? 0, user_id: actor.id }).first();
  if (!stageAssignment && ticket.xlr8_assignee_id !== null) throw new ServiceError(403, 'You are not assigned to this ticket');
  if (stageAssignment?.acceptance_status === 'accepted') throw new ServiceError(409, 'You have already accepted this stage');
  if (!stageAssignment) {
    // Null-assignee stage: verify caller appears in task_assignees for this task at all, or project membership
    const anyAssignment = await db('task_assignees').where({ task_id: ticket.id, user_id: actor.id }).first();
    const isMember = await db('project_members').where({ project_id: ticket.project_id, user_id: actor.id }).first();
    if (!anyAssignment && !isMember) throw new ServiceError(403, 'You are not assigned to this ticket');
  }

  await db('tasks').where({ id: ticket.id }).update({ xlr8_assignee_id: actor.id, assigned_to: actor.id });
  // Update task_assignees for this stage: set user_id (fills null placeholder) + accepted
  const stageIdx = ticket.xlr8_stage_idx ?? 0;
  const updated = await db('task_assignees')
    .where({ task_id: ticket.id, stage_idx: stageIdx })
    .where(function (this: any) { this.where('user_id', actor.id).orWhereNull('user_id'); })
    .update({ user_id: actor.id, acceptance_status: 'accepted' });
  if (!updated) {
    await db('task_assignees').insert({ task_id: ticket.id, user_id: actor.id, stage_idx: stageIdx, assignee_role: 'employee', acceptance_status: 'accepted' });
  }
  await acceptAllMyStages(db, ticket.id, actor.id);
  await startIfAccepted(db, ticket.id, actor);
  const waiting = await waitingOn(db, ticket.id, stageIdx);
  if (waiting.length) await appendLog(ticket.id, actor, 'stage_pre_accepted', null, null, `Accepted — waiting on ${waiting.join(', ')}`);
  if (ticket.created_by !== actor.id) {
    await createNotification(ticket.created_by, waiting.length
      ? `${actor.name} accepted "${ticket.title}" — still waiting on ${waiting.join(', ')}`
      : `${actor.name} accepted your ticket "${ticket.title}" and can start working`, 'task', ticket.project_id);
  }
  scheduleOne(actor.id, db);
  return { ok: true, waiting_on: waiting };
}

export async function declineCurrentStage(db: Db, actor: Actor, id: number | string, body: any): Promise<Result> {
  // Guarded update: only the current assignee, only while it is waiting for them
  const ticket = await db('tasks').where({ id, xlr8_status: 'pending_assignee', xlr8_assignee_id: actor.id }).first();
  if (!ticket) throw new ServiceError(404, 'Ticket not found or not assigned to you');
  // Set to needs_reassignment — keeps it out of manager approval queue but visible in declined-stages alert
  await db('tasks').where({ id: ticket.id }).update({ xlr8_status: 'needs_reassignment', xlr8_assignee_id: null, assigned_to: null, status: 'todo' });
  await db('task_assignees').where({ task_id: ticket.id, user_id: actor.id, stage_idx: ticket.xlr8_stage_idx ?? 0 }).update({ acceptance_status: 'declined' });
  // Close any open approval record so it doesn't appear in the manager's approval queue
  await db('approvals').where({ task_id: ticket.id }).whereNotIn('status', ['approved', 'rejected']).update({ status: 'work_in_progress' });
  await appendLog(ticket.id, actor, 'employee_declined', 'pending_assignee', 'needs_reassignment', body?.comment || null);
  for (const m of await projectManagers(db, ticket.project_id)) {
    await createNotification(m.id, `${actor.name} declined ticket "${ticket.title}" — please reassign`, 'task', ticket.project_id);
  }
  return { ok: true };
}

// ── Tickets: work done, reviews, final approval ─────────────────────────────

// Stage person finishes their stage: closes their timer, then the ticket moves to the next stage / review
export async function markStageDone(db: Db, actor: Actor, id: number | string): Promise<Result> {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const ticket = await db('tasks').where({ id, xlr8_status: 'in_progress', xlr8_assignee_id: actor.id }).first();
  if (!ticket) throw new ServiceError(404, 'Ticket not found or not in progress by you');
  const open = await uncheckedItems(db, ticket.id);
  if (open.length) throw new ServiceError(400, uncheckedError(open), { unchecked: open });

  // Close open timer and log time
  const openSession = await db('task_sessions').where({ task_id: ticket.id, user_id: actor.id }).whereNull('ended_at').first();
  if (openSession) {
    await db('task_sessions').where({ id: openSession.id }).update({ ended_at: now });
    const hrs = (now.getTime() - new Date(openSession.started_at).getTime()) / 3600000;
    if (hrs >= 0.001) {
      const userRec = await db('users').where({ id: actor.id }).select('monthly_salary').first();
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const hourlyRate = userRec?.monthly_salary ? Number(userRec.monthly_salary) / daysInMonth / 7 : null;
      await db('time_logs').insert({
        task_id: ticket.id, project_id: ticket.project_id, user_id: actor.id, task_session_id: openSession.id,
        log_date: today, hours: Math.round(hrs * 100) / 100, hourly_rate: hourlyRate,
      });
    }
  }
  const { stages, finalApproval } = await loadType(db, ticket);
  return claimed(db, ticket.id, 'in_progress', 'This stage was already submitted', async () => {
    await appendLog(ticket.id, actor, 'work_done', 'in_progress', null);
    return advanceToStage(db, ticket, stages, finalApproval, (ticket.xlr8_stage_idx ?? 0) + 1, actor, 'in_progress');
  });
}

// Manager review (or an employee who is the designated reviewer of this stage): approve → next stage; decline → send back
export async function reviewTicket(db: Db, actor: Actor, id: number | string, body: any): Promise<Result> {
  const { action, comment } = body ?? {};
  if (!['approve', 'decline'].includes(action)) throw new ServiceError(400, 'action must be approve or decline');
  const ticket = await db('tasks').where({ id, xlr8_status: 'pending_manager' }).first();
  if (!ticket) throw new ServiceError(404, 'Ticket not found or not pending manager review');

  // Admins and managers review; an employee only when they are the pre-assigned reviewer for this stage
  const isDesignatedReviewer = ticket.xlr8_assignee_id === actor.id;
  const isReviewerEmployee = actor.role === 'employee' && isDesignatedReviewer;
  if (!['admin', 'manager'].includes(actor.role) && !isReviewerEmployee) throw new ServiceError(403, 'Not authorized to review this ticket');
  if (actor.role === 'manager' && !isDesignatedReviewer) await requireManage(db, actor, ticket.id);
  // An employee reviewer stage is that employee's call; managers wait for it (admins can still override)
  if (actor.role === 'manager' && ticket.xlr8_assignee_id && ticket.xlr8_assignee_id !== actor.id) {
    const reviewer = await db('users').where({ id: ticket.xlr8_assignee_id }).select('name', 'role').first();
    if (reviewer?.role === 'employee') throw new ServiceError(403, `Waiting for ${reviewer.name} to review this stage`);
  }

  const { stages, finalApproval } = await loadType(db, ticket);
  const currentStageIdx = ticket.xlr8_stage_idx ?? 0;
  const currentStage = stages[currentStageIdx];
  // Must be in review mode: assignee set (work done) OR current stage is manager type
  const inReviewMode = !!ticket.xlr8_assignee_id || (currentStage && stageType(currentStage) === 'manager');
  if (!inReviewMode) throw new ServiceError(400, 'Ticket is in assignment mode, not review mode');

  if (action === 'decline') {
    await db('task_sessions').where({ task_id: ticket.id }).whereNull('ended_at').update({ ended_at: new Date() });
    // Mark approval as rejected so it leaves the manager's pending queue
    await db('approvals').where({ task_id: ticket.id }).whereNotIn('status', ['approved', 'rejected']).update({ status: 'rejected' });
    const back = await sendBack(db, ticket, stages, body.target_stage_idx);
    if (!back) throw new ServiceError(400, 'Invalid stage to send back to');
    const { targetIdx, assigneeId: prevAssigneeId } = back;
    await appendLog(ticket.id, actor, 'manager_declined', 'pending_manager', 'in_progress', comment, { from: currentStageIdx, to: targetIdx });
    if (prevAssigneeId) {
      await createNotification(prevAssigneeId, `Ticket "${ticket.title}" was declined — please redo and resubmit${comment ? ': ' + comment : ''}`, 'task', ticket.project_id);
    }
    for (const a of await db('users').where({ role: 'admin' }).select('id')) await createNotification(a.id, `${actor.name} rejected ticket "${ticket.title}"${comment ? ': ' + comment : ''}`, 'task', ticket.project_id);
    return { ok: true };
  }

  const openReview = await uncheckedItems(db, ticket.id);
  if (openReview.length) throw new ServiceError(400, uncheckedError(openReview), { unchecked: openReview });
  await db('task_sessions').where({ task_id: ticket.id }).whereNull('ended_at').update({ ended_at: new Date() });
  return claimed(db, ticket.id, 'pending_manager', 'This review was already handled', async () => {
    await appendLog(ticket.id, actor, 'manager_approved', 'pending_manager', null, comment);
    const skipAdmin = !!body.skip_admin && currentStageIdx + 1 >= stages.length && finalApproval.adminRequired;
    if (skipAdmin) await appendLog(ticket.id, actor, 'admin_skipped', 'pending_manager', null);
    return advanceToStage(db, ticket, stages, skipAdmin ? { ...finalApproval, adminRequired: false } : finalApproval, currentStageIdx + 1, actor, 'pending_manager');
  });
}

export async function adminApproveTicket(db: Db, actor: Actor, id: number | string, body: any): Promise<Result> {
  adminOnly(actor);
  const ticket = await db('tasks').where({ id, xlr8_status: 'pending_admin' }).first();
  if (!ticket) throw new ServiceError(404, 'Ticket not pending admin approval');
  const { stages, finalApproval } = await loadType(db, ticket);
  const currentStageIdx = ticket.xlr8_stage_idx ?? 0;
  const currentStage = stages[currentStageIdx];

  const openAdmin = currentStage && stageType(currentStage) === 'admin' ? await uncheckedItems(db, ticket.id) : [];
  if (openAdmin.length) throw new ServiceError(400, uncheckedError(openAdmin), { unchecked: openAdmin });
  return claimed(db, ticket.id, 'pending_admin', 'This approval was already handled', async (): Promise<Result> => {
  await appendLog(ticket.id, actor, 'admin_approved', 'pending_admin', null, body?.comment);

  // If we're at an explicit admin stage (mid-flow), advance to next stage
  if (currentStage && stageType(currentStage) === 'admin') {
    return advanceToStage(db, ticket, stages, finalApproval, currentStageIdx + 1, actor, 'pending_admin');
  }

  // Final admin approval
  const approval = await db('approvals').where({ task_id: ticket.id }).whereNotIn('status', ['rejected']).first();
  // Admin chose "Skip Client" — complete now instead of sending for client review
  const skipClient = body?.skip_client === true;
  if (skipClient) await appendLog(ticket.id, actor, 'admin_skip_client', 'pending_admin', 'completed', body?.comment);
  if (finalApproval.clientOptional && !skipClient) {
    await db('tasks').where({ id: ticket.id }).update({ xlr8_status: 'pending_client' });
    if (approval) await db('approvals').where({ id: approval.id }).update({ status: 'pending_client', workflow_type: 'xlr8', admin_approved_by: actor.id, admin_approved_at: new Date() });
    const clientUsers = await db('users as u').join('projects as p', 'p.client_company_id', 'u.client_company_id')
      .where('p.id', ticket.project_id).where('u.role', 'client').select('u.id');
    for (const c of clientUsers) await createNotification(c.id, `Ticket "${ticket.title}" is ready for your review`, 'task', ticket.project_id);
    return { ok: true, next: 'pending_client' };
  }
  await completeTicket(db, ticket, actor);
  if (approval) await db('approvals').where({ id: approval.id }).update({ status: 'approved', workflow_type: 'xlr8', final_approved_at: new Date(), admin_approved_by: actor.id, admin_approved_at: new Date() });
  return { ok: true, next: 'completed' };
  });
}

export async function adminDeclineTicket(db: Db, actor: Actor, id: number | string, body: any): Promise<Result> {
  adminOnly(actor);
  const ticket = await db('tasks').where({ id, xlr8_status: 'pending_admin' }).first();
  if (!ticket) throw new ServiceError(404, 'Ticket not pending admin approval');
  const { stages } = await loadType(db, ticket);
  const currentStageIdx = ticket.xlr8_stage_idx ?? 0;

  await db('approvals').where({ task_id: ticket.id }).whereNotIn('status', ['approved', 'rejected']).update({ status: 'rejected' });
  const back = await sendBack(db, ticket, stages, body?.target_stage_idx);
  if (!back) throw new ServiceError(400, 'Invalid stage to send back to');
  const { targetIdx, assigneeId: prevAssigneeId } = back;
  await appendLog(ticket.id, actor, 'admin_declined', 'pending_admin', 'in_progress', body?.comment, { from: currentStageIdx, to: targetIdx });
  if (prevAssigneeId) {
    await createNotification(prevAssigneeId, `Ticket "${ticket.title}" was declined by admin — please redo your work`, 'task', ticket.project_id);
  } else {
    for (const m of await projectManagers(db, ticket.project_id)) {
      if (m.id !== actor.id) await createNotification(m.id, `Ticket "${ticket.title}" was declined by admin — please reassign stage ${targetIdx + 1}`, 'task', ticket.project_id);
    }
  }
  return { ok: true };
}

export async function adminSendToClient(db: Db, actor: Actor, id: number | string, body: any): Promise<Result> {
  adminOnly(actor);
  const ticket = await db('tasks').where({ id, xlr8_status: 'pending_admin' }).first();
  if (!ticket) throw new ServiceError(404, 'Ticket not pending admin approval');
  await db('tasks').where({ id: ticket.id }).update({ xlr8_status: 'pending_client', assigned_to: null, xlr8_assignee_id: null });
  const approval = await db('approvals').where({ task_id: ticket.id }).whereNotIn('status', ['rejected']).first();
  if (approval) await db('approvals').where({ id: approval.id }).update({ status: 'pending_client', workflow_type: 'xlr8', admin_approved_by: actor.id, admin_approved_at: new Date() });
  else await db('approvals').insert({ task_id: ticket.id, title: ticket.title, project_id: ticket.project_id, submitted_by: ticket.created_by, status: 'pending_client', workflow_type: 'xlr8' });
  await appendLog(ticket.id, actor, 'sent_to_client', 'pending_admin', 'pending_client', body?.comment);
  const clients = await db('users as u').join('projects as p', 'p.client_company_id', 'u.client_company_id')
    .where('p.id', ticket.project_id).where('u.role', 'client').select('u.id');
  for (const c of clients) await createNotification(c.id, `Ticket "${ticket.title}" is ready for your review`, 'task', ticket.project_id);
  return { ok: true, next: 'pending_client' };
}

async function clientOfProject(db: Db, actor: Actor, projectId: number) {
  if (actor.role !== 'client') throw new ServiceError(403, 'Client only');
  const project = await db('projects as p').leftJoin('users as u', 'u.client_company_id', 'p.client_company_id')
    .where('p.id', projectId).where('u.id', actor.id).first();
  if (!project) throw new ServiceError(403, 'Not authorized for this project');
}

export async function clientRejectTicket(db: Db, actor: Actor, id: number | string, body: any): Promise<Result> {
  if (actor.role !== 'client') throw new ServiceError(403, 'Client only');
  const ticket = await db('tasks').where({ id, xlr8_status: 'pending_client' }).first();
  if (!ticket) throw new ServiceError(404, 'Ticket not pending client approval');
  await clientOfProject(db, actor, ticket.project_id);
  const { stages } = await loadType(db, ticket);
  const back = await sendBack(db, ticket, stages, undefined);
  const approval = await db('approvals').where({ task_id: ticket.id }).whereNotIn('status', ['rejected']).first();
  if (approval) await db('approvals').where({ id: approval.id }).update({ status: 'revision_requested', workflow_type: 'xlr8' });
  await appendLog(ticket.id, actor, 'client_declined', 'pending_client', back?.assigneeId ? 'in_progress' : 'pending_manager', body?.comment, back ? { from: ticket.xlr8_stage_idx ?? 0, to: back.targetIdx } : undefined);
  if (back?.assigneeId) await createNotification(back.assigneeId, `The client asked for changes on "${ticket.title}"${body?.comment ? ': ' + body.comment : ''}`, 'task', ticket.project_id);
  for (const a of await db('users').where({ role: 'admin' }).select('id')) await createNotification(a.id, `Client rejected ticket "${ticket.title}" — revision needed`, 'task', ticket.project_id);
  return { ok: true, next: 'revision_requested' };
}

export async function clientApproveTicket(db: Db, actor: Actor, id: number | string): Promise<Result> {
  if (actor.role !== 'client') throw new ServiceError(403, 'Client only');
  const ticket = await db('tasks').where({ id, xlr8_status: 'pending_client' }).first();
  if (!ticket) throw new ServiceError(404, 'Ticket not pending client approval');
  await clientOfProject(db, actor, ticket.project_id);
  await appendLog(ticket.id, actor, 'client_approved', 'pending_client', 'completed');
  await completeTicket(db, ticket, actor);
  const approval = await db('approvals').where({ task_id: ticket.id }).whereNotIn('status', ['rejected']).first();
  if (approval) await db('approvals').where({ id: approval.id }).update({ status: 'approved', workflow_type: 'xlr8', final_approved_at: new Date() });
  return { ok: true };
}

// Manager/admin closes a ticket waiting on the client without client sign-off
export async function closeTicket(db: Db, actor: Actor, id: number | string, body: any): Promise<Result> {
  if (!['admin', 'manager'].includes(actor.role)) throw new ServiceError(403, 'Not authorized');
  const ticket = await db('tasks').where({ id }).first();
  if (!ticket) throw new ServiceError(404, 'Ticket not found');
  await requireManage(db, actor, ticket.id);
  if (ticket.xlr8_status !== 'pending_client') throw new ServiceError(400, `Ticket is not waiting on the client (current state: ${ticket.xlr8_status})`);
  await completeTicket(db, ticket, actor);
  const approval = await db('approvals').where({ task_id: ticket.id }).whereNotIn('status', ['rejected']).first();
  if (approval) await db('approvals').where({ id: approval.id }).update({ status: 'approved', workflow_type: 'xlr8', final_approved_at: new Date() });
  await appendLog(ticket.id, actor, 'closed_without_client', 'pending_client', 'completed', body?.comment).catch(() => {});
  return { ok: true };
}

// ── Stage progression ───────────────────────────────────────────────────────

// Moves the ticket to the stage at targetIdx, or to final approval if past all stages
export async function advanceToStage(db: Db, ticket: any, stages: any[], finalApproval: any, targetIdx: number, actor: any, fromState: string): Promise<Result> {
  const result = await advance(db, ticket, stages, finalApproval, targetIdx, actor, fromState);
  // Checklist badge follows the stage
  await refreshChecklistCounts(db, ticket.id).catch(() => {});
  return result;
}

async function advance(db: Db, ticket: any, stages: any[], finalApproval: any, targetIdx: number, actor: any, fromState: string): Promise<Result> {
  if (targetIdx >= stages.length) {
    // All stages done — run final approval
    const approval = await db('approvals').where({ task_id: ticket.id }).whereNotIn('status', ['approved', 'rejected']).first();
    if (finalApproval.adminRequired) {
      await db('tasks').where({ id: ticket.id }).update({ xlr8_status: 'pending_admin', xlr8_stage_idx: targetIdx, xlr8_assignee_id: null, assigned_to: null, status: 'in_review' });
      if (approval) await db('approvals').where({ id: approval.id }).update({ status: 'pending_admin', workflow_type: 'xlr8' });
      else await db('approvals').insert({ task_id: ticket.id, title: ticket.title, project_id: ticket.project_id, submitted_by: actor.id, status: 'pending_admin', workflow_type: 'xlr8' });
      await appendLog(ticket.id, actor, 'sent_to_admin', fromState, 'pending_admin');
      for (const a of await db('users').where({ role: 'admin' }).select('id')) await createNotification(a.id, `Ticket "${ticket.title}" needs your final approval`, 'task', ticket.project_id);
      scheduleTask(ticket.id, db);
      return { ok: true, next: 'pending_admin' };
    }
    if (finalApproval.clientOptional) {
      await db('tasks').where({ id: ticket.id }).update({ xlr8_status: 'pending_client', xlr8_stage_idx: targetIdx, xlr8_assignee_id: null, assigned_to: null });
      if (approval) await db('approvals').where({ id: approval.id }).update({ status: 'pending_client', workflow_type: 'xlr8' });
      else await db('approvals').insert({ task_id: ticket.id, title: ticket.title, project_id: ticket.project_id, submitted_by: actor.id, status: 'pending_client', workflow_type: 'xlr8' });
      await appendLog(ticket.id, actor, 'sent_to_client', fromState, 'pending_client');
      const clients = await db('users as u').join('projects as p', 'p.client_company_id', 'u.client_company_id')
        .where('p.id', ticket.project_id).where('u.role', 'client').select('u.id');
      for (const c of clients) await createNotification(c.id, `Ticket "${ticket.title}" is ready for your review`, 'task', ticket.project_id);
      scheduleTask(ticket.id, db);
      return { ok: true, next: 'pending_client' };
    }
    const approval2 = await db('approvals').where({ task_id: ticket.id }).whereNotIn('status', ['approved', 'rejected']).first();
    await completeTicket(db, ticket, actor);
    if (approval2) await db('approvals').where({ id: approval2.id }).update({ status: 'approved', workflow_type: 'xlr8', final_approved_at: new Date() });
    return { ok: true, next: 'completed' };
  }

  // Restore pre_pending → pending for this stage (task has now reached it after a prior rejection backward)
  await db('task_assignees').where({ task_id: ticket.id, stage_idx: targetIdx, acceptance_status: 'pre_pending' }).update({ acceptance_status: 'pending' });

  // Skip only when every assignee row for this stage is marked skipped (no real active person)
  const stageRows = await db('task_assignees').where({ task_id: ticket.id, stage_idx: targetIdx });
  if (stageRows.length > 0 && stageRows.every((r: any) => r.skipped)) {
    await appendLog(ticket.id, actor, 'next_stage', fromState, 'skipped', `Stage ${targetIdx + 1} skipped`);
    return advance(db, ticket, stages, finalApproval, targetIdx + 1, actor, fromState);
  }

  const nextStage = stages[targetIdx];
  const nType = stageType(nextStage);

  if (nType === 'employee') {
    const pre = pickStageRow(await db('task_assignees').where({ task_id: ticket.id, stage_idx: targetIdx, assignee_role: 'employee' }));
    // Clear the approval record — work is in progress, not in review
    const empAp = await db('approvals').where({ task_id: ticket.id }).whereNotIn('status', ['approved', 'rejected']).first();
    if (empAp) await db('approvals').where({ id: empAp.id }).update({ status: 'work_in_progress', workflow_type: 'xlr8' });
    if (pre) {
      const alreadyAccepted = pre.acceptance_status === 'accepted' && !(await waitingOn(db, ticket.id, targetIdx)).length;
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
      scheduleTask(ticket.id, db);
      return { ok: true, next: 'pending_assignee' };
    }
    await db('tasks').where({ id: ticket.id }).update({ xlr8_status: 'pending_manager', xlr8_stage_idx: targetIdx, xlr8_assignee_id: null, assigned_to: null, status: 'todo' });
    await appendLog(ticket.id, actor, 'next_stage', fromState, 'pending_manager', `Stage ${targetIdx + 1}: ${nextStage.category_name}`);
    for (const m of await projectManagers(db, ticket.project_id)) await createNotification(m.id, `Ticket "${ticket.title}" — assign a ${nextStage.category_name} for stage ${targetIdx + 1}`, 'task', ticket.project_id);
    scheduleTask(ticket.id, db);
    return { ok: true, next: 'pending_manager' };
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
      for (const m of await projectManagers(db, ticket.project_id)) await createNotification(m.id, `Ticket "${ticket.title}" ready for manager review`, 'approval', ticket.project_id);
    }
    scheduleTask(ticket.id, db);
    return { ok: true, next: 'pending_manager' };
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
    for (const a of await db('users').where({ role: 'admin' }).select('id')) await createNotification(a.id, `Ticket "${ticket.title}" ready for admin review`, 'approval', ticket.project_id);
  }
  scheduleTask(ticket.id, db);
  return { ok: true, next: 'pending_admin' };
}

async function completeTicket(db: Db, ticket: any, actor: any) {
  await db('tasks').where({ id: ticket.id }).update({ xlr8_status: 'completed', status: 'completed', completed_at: new Date() });
  await appendLog(ticket.id, actor, 'completed', ticket.xlr8_status, 'completed');
  scheduleTask(ticket.id, db);
  if (ticket.created_by !== actor.id) await createNotification(ticket.created_by, `Ticket "${ticket.title}" has been completed`, 'task', ticket.project_id);
}
