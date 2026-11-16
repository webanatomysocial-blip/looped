// Phase 5 step 4: the approved ticket actions, connected to the executor. Each handler only translates a confirmed
// request into one approved mutation (ticketMutations). Nothing here decides permissions: the Loop services do.
import { Knex } from 'knex';
import { ActionHandler, ActionInput, HandlerRegistry, TerminalActionError } from './executor';
import { createOp, assignOp, priorityOp, detailsOp, commentAddOp, acceptOp, decideOp, loadAssistantActor, MutationOutcome, MutationRequest } from './ticketMutations';
import { ServiceError } from '../services/access';

// The only intents the assistant may act on. Decline, XLR8 and comment edit/delete are deliberately absent.
// Task operations for WhatsApp are suspended (monitoring phase). The implementation below is kept, not deleted.
// Set ASSISTANT_TASK_OPS_ENABLED=true to expose them again.
export const SUSPENDED_TASK_INTENTS = [
  'CREATE_TASK', 'ASSIGN_TASK', 'UPDATE_TASK', 'ADD_COMMENT', 'ACCEPT_TASK', 'APPROVE_TASK', 'REJECT_TASK',
  'SEARCH_TICKETS', 'VIEW_TASK_DETAILS', 'VIEW_MY_TASKS',
] as const;
export const TASK_OPS_ENABLED = process.env.ASSISTANT_TASK_OPS_ENABLED === 'true';
// What WhatsApp may do: nothing task-related while the monitoring phase is active
export const EXPOSED_INTENTS: readonly string[] = TASK_OPS_ENABLED ? SUSPENDED_TASK_INTENTS : [];

// Intents that act on one existing ticket: the engine resolves the reference to exactly one visible ticket first
export const TASK_REF_INTENTS = new Set(['ASSIGN_TASK', 'UPDATE_TASK', 'ADD_COMMENT', 'ACCEPT_TASK', 'APPROVE_TASK', 'REJECT_TASK']);

// Shape of a stored request: raw text the employee gave, and what the engine resolved it to
export interface StoredData { raw: Record<string, string>; resolved: Record<string, any> }

const summaryOf = (out: MutationOutcome, what: string) =>
  out.status === 'duplicate' ? `${what}: already done` : `${what}${out.result?.awaiting_approval ? ': sent for approval' : ''}`;

// Loop's own refusals (not your pod, not found, not allowed) end the request. Anything else is retried, which is
// safe: the mutation layer refuses to repeat a change already made under this request id.
async function run(input: ActionInput, what: string, op: (req: Omit<MutationRequest, 'operation'>) => Promise<MutationOutcome>) {
  try {
    const out = await op({ requestId: input.requestId, executionId: input.executionId, loopUserId: input.loopUserId });
    return { summary: summaryOf(out, what).slice(0, 200) };
  } catch (e) {
    if (e instanceof ServiceError) throw new TerminalActionError(e.message);
    throw e;
  }
}

const need = (cond: unknown, msg: string, problems: string[]) => { if (!cond) problems.push(msg); };

export function ticketHandlers(db: Knex): ActionHandler[] {
  const handler = (intent: string, validate: (d: StoredData) => string[], execute: (input: ActionInput, d: StoredData) => Promise<{ summary: string }>): ActionHandler =>
    ({ intent, idempotent: true, validate: (data: any) => validate(data as StoredData), execute: (input: ActionInput) => execute(input, input.data as StoredData) });

  return [
    handler('CREATE_TASK',
      (d) => { const p: string[] = []; need(d.raw?.title, 'A title is needed.', p); need(d.resolved?.project_id, 'A project is needed.', p); need(d.resolved?.employee_id, 'Who should it be assigned to?', p); return p; },
      (input, d) => run(input, 'Ticket created', (req) => createOp(db, req, {
        title: d.raw.title, description: d.raw.description || null, project_id: d.resolved.project_id,
        working_person_id: d.resolved.employee_id, due_date: d.resolved.deadline ?? null, priority: d.resolved.priority ?? 'medium',
      }))),
    handler('ASSIGN_TASK',
      (d) => { const p: string[] = []; need(d.resolved?.task_id, 'Which ticket?', p); need(d.resolved?.employee_id, 'Who should it be assigned to?', p); return p; },
      (input, d) => run(input, 'Ticket assigned', (req) => assignOp(db, req, d.resolved.task_id, { working_person_id: d.resolved.employee_id }))),
    handler('UPDATE_TASK',
      (d) => {
        const p: string[] = []; need(d.resolved?.task_id, 'Which ticket?', p);
        const priority = !!d.resolved?.priority, details = !!(d.raw?.title || d.raw?.description || d.raw?.deadline);
        if (priority && details) p.push('Change the priority and the details in separate requests.');
        if (!priority && !details) p.push('What should change on the ticket?');
        return p;
      },
      (input, d) => d.resolved.priority
        ? run(input, 'Priority updated', (req) => priorityOp(db, req, d.resolved.task_id, { priority: d.resolved.priority }))
        : run(input, 'Ticket updated', (req) => detailsOp(db, req, d.resolved.task_id, {
            title: d.raw.title, description: d.raw.description, due_date: d.resolved.deadline,
          }))),
    handler('ADD_COMMENT',
      (d) => { const p: string[] = []; need(d.resolved?.task_id, 'Which ticket?', p); need(d.raw?.comment, 'What should the comment say?', p); return p; },
      (input, d) => run(input, 'Comment added', (req) => commentAddOp(db, req, d.resolved.task_id, { comment: d.raw.comment }))),
    handler('ACCEPT_TASK',
      (d) => { const p: string[] = []; need(d.resolved?.task_id, 'Which ticket?', p); return p; },
      (input, d) => run(input, 'Accepted', (req) => acceptOp(db, req, d.resolved.task_id))),
    handler('APPROVE_TASK',
      (d) => { const p: string[] = []; need(d.resolved?.task_id, 'Which ticket?', p); return p; },
      (input, d) => run(input, 'Approved', (req) => decideOp(db, req, d.resolved.task_id, 'approve', {}))),
    handler('REJECT_TASK',
      (d) => { const p: string[] = []; need(d.resolved?.task_id, 'Which ticket?', p); return p; },
      (input, d) => run(input, 'Sent back for changes', (req) => decideOp(db, req, d.resolved.task_id, 'reject', { comment: d.raw?.comment }))),
  ];
}

// The registry the executor runs. Registering a handler does not run it: execution stays behind its own switch.
export function ticketRegistry(db: Knex): HandlerRegistry {
  const r = new HandlerRegistry();
  for (const h of ticketHandlers(db)) r.register(h);
  return r;
}

// Re-checked before every action: the link must still be active
export async function stillVerified(db: Knex, loopUserId: number): Promise<boolean> {
  try { await loadAssistantActor(db, loopUserId); return true; } catch { return false; }
}
