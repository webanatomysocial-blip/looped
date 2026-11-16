// Assistant ticket mutations (Phase 5, step 3). Every approved operation goes through runMutation, which:
//   1. rechecks the employee's identity (active link) and their user row, every time;
//   2. calls the existing Loop service, which makes the permission decision (the assistant decides nothing);
//   3. writes the change and its audit row in one transaction, so neither exists without the other;
//   4. returns "duplicate" instead of repeating a change this request already made.
// Notifications and scheduling run only after commit (db/index.ts inTransaction).
// Decline is deliberately absent: it stays hidden until it is tested and approved.
import { Knex } from 'knex';
import { inTransaction } from '../db';
import { Actor, ServiceError, assertCanSeeTask } from '../services/access';
import { createTask, updateTask } from '../services/tasks';
import { addComment, updateComment, deleteComment } from '../services/comments';
import { acceptTask, managerApproveTask } from '../services/taskWorkflow';
import { writeTicketAudit, findTicketAudit, isDuplicateKeyError } from '../services/ticketAudit';
import { GROUP_REPLY } from './engine';

export const MUTATION_OPERATIONS = [
  'create', 'assign', 'priority', 'details', 'comment_add', 'comment_edit', 'comment_delete', 'accept', 'approve', 'reject',
] as const;
export type MutationOperation = typeof MUTATION_OPERATIONS[number];

export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

export interface MutationRequest {
  requestId: string;
  executionId?: string | null;
  loopUserId: number;
  operation: MutationOperation;
}

export interface MutationOutcome {
  status: 'done' | 'duplicate';
  operation: MutationOperation;
  taskId: number;
  result?: Record<string, unknown>;
}

interface Performed {
  taskId: number;
  before: unknown;
  after: unknown;
  result?: Record<string, unknown>;
}

// The identity is rechecked on every mutation, not trusted from intake: a revoked link stops working at once
export async function loadAssistantActor(db: Knex | Knex.Transaction, loopUserId: number): Promise<Actor> {
  const user = await db('users').where({ id: loopUserId }).first('id', 'name', 'role', 'pod', 'email');
  const identity = await db('assistant_identities').where({ user_id: loopUserId, status: 'active' }).first('id');
  if (!user || !identity) throw new ServiceError(403, 'Not allowed');
  return { id: Number(user.id), role: user.role, name: user.name, email: user.email, pod: user.pod };
}

export async function runMutation(
  db: Knex,
  req: MutationRequest,
  perform: (trx: Knex.Transaction, actor: Actor) => Promise<Performed>,
): Promise<MutationOutcome> {
  if (!(MUTATION_OPERATIONS as readonly string[]).includes(req.operation)) throw new ServiceError(400, 'Unsupported operation');
  const attempt = () => inTransaction(db, async (trx): Promise<MutationOutcome> => {
    const actor = await loadAssistantActor(trx, req.loopUserId);
    const prior = await findTicketAudit(trx, req.requestId, req.operation);
    if (prior) return { status: 'duplicate', operation: req.operation, taskId: prior.task_id };
    const out = await perform(trx, actor);
    await writeTicketAudit(trx, {
      requestId: req.requestId, executionId: req.executionId ?? null, loopUserId: actor.id,
      taskId: out.taskId, operation: req.operation, before: out.before, after: out.after,
    });
    return { status: 'done', operation: req.operation, taskId: out.taskId, result: out.result };
  });
  try {
    return await attempt();
  } catch (err) {
    // Two attempts raced: the unique (request, operation) index refused the second. The first one stands.
    if (isDuplicateKeyError(err)) {
      const prior = await findTicketAudit(db, req.requestId, req.operation);
      if (prior) return { status: 'duplicate', operation: req.operation, taskId: prior.task_id };
    }
    throw err;
  }
}

// ── Operations ── each one checks visibility first (404 for tickets the actor cannot see), then calls the service

const WORKFLOW_UNSUPPORTED = 'Tickets with workflow stages are not supported here yet';

async function plainTicket(trx: Knex.Transaction, taskId: number) {
  const t = await trx('tasks').where({ id: taskId }).first();
  if (!t) throw new ServiceError(404, 'Not found');
  if (t.ticket_type_id) throw new ServiceError(409, WORKFLOW_UNSUPPORTED);
  return t;
}

const asId = (v: unknown, name: string): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ServiceError(400, `${name} required`);
  return n;
};

export async function createOp(db: Knex, req: Omit<MutationRequest, 'operation'>, body: any): Promise<MutationOutcome> {
  return runMutation(db, { ...req, operation: 'create' }, async (trx, actor) => {
    // Only the plain-ticket fields reach the service; anything else in the body is ignored
    const input = {
      title: body?.title, description: body?.description, project_id: body?.project_id,
      working_person_id: body?.working_person_id, task_manager_id: body?.task_manager_id,
      due_date: body?.due_date, priority: body?.priority,
    };
    const r = await createTask(trx, actor, input);
    const row = await trx('tasks').where({ id: r.id }).first('title', 'project_id', 'assigned_to', 'status', 'priority');
    return { taskId: r.id, before: null, after: row, result: { crosspod_pending: r.crosspod_pending ?? null } };
  });
}

export async function assignOp(db: Knex, req: Omit<MutationRequest, 'operation'>, taskId: number, body: any): Promise<MutationOutcome> {
  return runMutation(db, { ...req, operation: 'assign' }, async (trx, actor) => {
    await assertCanSeeTask(trx, actor, taskId);
    const t = await plainTicket(trx, taskId);
    const workerId = asId(body?.working_person_id, 'Assignee');
    const worker = await trx('users').where({ id: workerId }).first('role');
    if (!worker || !['employee', 'manager'].includes(worker.role)) throw new ServiceError(400, 'Assignee not found');
    // Keep the existing manager: updateTask rebuilds all assignees from what it is given
    const mgr = await trx('task_assignees').where({ task_id: taskId, assignee_role: 'manager' }).first('user_id');
    await updateTask(trx, actor, taskId, { working_person_id: workerId, task_manager_id: mgr?.user_id ?? null });
    const after = await trx('tasks').where({ id: taskId }).first('assigned_to', 'status', 'pending_assign', 'crosspod_pods');
    const held = !!after?.pending_assign;
    return {
      taskId, before: { assigned_to: t.assigned_to, status: t.status },
      after: { assigned_to: after?.assigned_to ?? null, status: after?.status ?? null },
      result: { awaiting_approval: held, crosspod_pending: held ? JSON.parse(after.crosspod_pods) : null },
    };
  });
}

export async function priorityOp(db: Knex, req: Omit<MutationRequest, 'operation'>, taskId: number, body: any): Promise<MutationOutcome> {
  return runMutation(db, { ...req, operation: 'priority' }, async (trx, actor) => {
    await assertCanSeeTask(trx, actor, taskId);
    const t = await plainTicket(trx, taskId);
    const priority = String(body?.priority ?? '').trim().toLowerCase();
    if (!(PRIORITIES as readonly string[]).includes(priority)) throw new ServiceError(400, 'Priority must be low, medium, high or urgent');
    await updateTask(trx, actor, taskId, { priority });
    return { taskId, before: { priority: t.priority }, after: { priority } };
  });
}

// Only these detail fields can be changed by the assistant. Status, assignees and everything else are not reachable.
export async function detailsOp(db: Knex, req: Omit<MutationRequest, 'operation'>, taskId: number, body: any): Promise<MutationOutcome> {
  return runMutation(db, { ...req, operation: 'details' }, async (trx, actor) => {
    await assertCanSeeTask(trx, actor, taskId);
    const t = await plainTicket(trx, taskId);
    const patch: Record<string, unknown> = {};
    if (body?.title !== undefined) {
      const title = String(body.title).trim();
      if (!title || title.length > 200) throw new ServiceError(400, 'Title must be 1 to 200 characters');
      patch.title = title;
    }
    if (body?.description !== undefined) {
      const description = String(body.description ?? '');
      if (description.length > 2000) throw new ServiceError(400, 'Description is too long');
      patch.description = description;
    }
    if (body?.due_date !== undefined) {
      const due = body.due_date === null || body.due_date === '' ? null : String(body.due_date);
      if (due !== null && !/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new ServiceError(400, 'Due date must be YYYY-MM-DD');
      patch.due_date = due;
    }
    if (!Object.keys(patch).length) throw new ServiceError(400, 'Nothing to change');
    const pick = (k: string) => (t as any)[k] ?? null;
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, pick(k)]));
    await updateTask(trx, actor, taskId, patch);
    const row = await trx('tasks').where({ id: taskId }).first(Object.keys(patch));
    return { taskId, before, after: row };
  });
}

export async function commentAddOp(db: Knex, req: Omit<MutationRequest, 'operation'>, taskId: number, body: any): Promise<MutationOutcome> {
  return runMutation(db, { ...req, operation: 'comment_add' }, async (trx, actor) => {
    await assertCanSeeTask(trx, actor, taskId);
    const row = await addComment(trx, actor, taskId, { comment: body?.comment });
    return { taskId, before: null, after: { comment_id: row.id, comment: row.comment }, result: { comment_id: row.id } };
  });
}

export async function commentEditOp(db: Knex, req: Omit<MutationRequest, 'operation'>, taskId: number, body: any): Promise<MutationOutcome> {
  return runMutation(db, { ...req, operation: 'comment_edit' }, async (trx, actor) => {
    await assertCanSeeTask(trx, actor, taskId);
    const commentId = asId(body?.comment_id, 'Comment');
    const before = await trx('task_comments').where({ id: commentId, task_id: taskId }).first('id', 'comment', 'user_id');
    if (!before) throw new ServiceError(404, 'Not found');
    await updateComment(trx, actor, taskId, commentId, { comment: body?.comment });
    return { taskId, before: { comment: before.comment }, after: { comment: String(body?.comment ?? '').trim() }, result: { comment_id: commentId } };
  });
}

export async function commentDeleteOp(db: Knex, req: Omit<MutationRequest, 'operation'>, taskId: number, body: any): Promise<MutationOutcome> {
  return runMutation(db, { ...req, operation: 'comment_delete' }, async (trx, actor) => {
    await assertCanSeeTask(trx, actor, taskId);
    const commentId = asId(body?.comment_id, 'Comment');
    const before = await trx('task_comments').where({ id: commentId, task_id: taskId }).first('id', 'comment');
    if (!before) throw new ServiceError(404, 'Not found');
    await deleteComment(trx, actor, taskId, commentId);
    return { taskId, before: { comment: before.comment }, after: null, result: { comment_id: commentId } };
  });
}

export async function acceptOp(db: Knex, req: Omit<MutationRequest, 'operation'>, taskId: number): Promise<MutationOutcome> {
  return runMutation(db, { ...req, operation: 'accept' }, async (trx, actor) => {
    await assertCanSeeTask(trx, actor, taskId);
    const before = await trx('task_assignees').where({ task_id: taskId, user_id: actor.id }).first('acceptance_status');
    const r = await acceptTask(trx, actor, taskId, { action: 'accept' });
    const after = await trx('task_assignees').where({ task_id: taskId, user_id: actor.id }).first('acceptance_status');
    return { taskId, before: { acceptance_status: before?.acceptance_status ?? null }, after: { acceptance_status: after?.acceptance_status ?? null }, result: { already: !!(r as any).already } };
  });
}

// Approve or reject a pending request. The service applies the cross-pod rules and the manager's scope.
export async function decideOp(db: Knex, req: Omit<MutationRequest, 'operation'>, taskId: number, decision: 'approve' | 'reject', body: any): Promise<MutationOutcome> {
  return runMutation(db, { ...req, operation: decision }, async (trx, actor) => {
    await assertCanSeeTask(trx, actor, taskId);
    const t = await plainTicket(trx, taskId);
    const r = await managerApproveTask(trx, actor, taskId, { action: decision, comment: body?.comment });
    const after = await trx('tasks').where({ id: taskId }).first('status');
    return { taskId, before: { status: t.status }, after: { status: after?.status ?? null }, result: { status: (r as any).status ?? null } };
  });
}

// ── Group-safe replies ──
// Private channels get a short fixed confirmation. Group channels get the same fixed template for everything,
// so nothing about a ticket (title, id, counts, existence) is said in a group.

const DONE_TEXT: Record<MutationOperation, string> = {
  create: 'Ticket created.', assign: 'Ticket assigned.', priority: 'Priority updated.', details: 'Ticket updated.',
  comment_add: 'Comment added.', comment_edit: 'Comment updated.', comment_delete: 'Comment deleted.',
  accept: 'Accepted.', approve: 'Approved.', reject: 'Sent back for changes.',
};

export function replyForMutation(outcome: MutationOutcome, privateChannel: boolean): string {
  if (!privateChannel) return GROUP_REPLY;
  if (outcome.status === 'duplicate') return 'That was already done.';
  if (outcome.result?.awaiting_approval) return 'Sent to the other pod for approval.';
  return DONE_TEXT[outcome.operation];
}

export function replyForError(err: unknown, privateChannel: boolean): string {
  if (!privateChannel) return GROUP_REPLY;
  if (err instanceof ServiceError) return err.message;
  return 'Something went wrong. Please try again.';
}
