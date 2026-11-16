// Execution manager. Runs one claimed request through a registered action handler and records every attempt.
// Phase 4 registers no real handlers: Loop services are connected in Phase 5. Tests use mock handlers.
import crypto from 'crypto';
import { Knex } from 'knex';
import { transition, StateConflict } from './requestStore';
import { claimNext } from './queue';

export class TransientActionError extends Error { constructor(message: string) { super(message); this.name = 'TransientActionError'; } }
export class TerminalActionError extends Error { constructor(message: string) { super(message); this.name = 'TerminalActionError'; } }

export interface ActionInput { requestId: string; executionId: string; idempotencyKey: string; attempt: number; loopUserId: number; data: any }
export interface ActionHandler {
  intent: string;
  // Safe to run again with the same idempotency key (the business system must de-duplicate on it)
  idempotent: boolean;
  validate(data: any): string[];
  execute(input: ActionInput): Promise<{ summary: string }>;
}

export class HandlerRegistry {
  private readonly handlers = new Map<string, ActionHandler>();
  register(h: ActionHandler) { this.handlers.set(h.intent, h); }
  get(intent: string) { return this.handlers.get(intent); }
  canRetry(intent: string) { return this.handlers.get(intent)?.idempotent === true; }
  get size() { return this.handlers.size; }
}

// Error text stored in the database must never carry credentials or long payloads
export function safeError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  // Driver and SQL detail is for the server log, not the stored message an admin reads
  if (/SQLITE_|SQLITE|ER_[A-Z_]+|insert into|select .* from|update `|delete from|\bstack\b/i.test(raw)) return 'Internal error (details withheld)';
  return raw.replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 300);
}

export interface ExecutorDeps {
  db: Knex;
  registry: HandlerRegistry;
  workerId: string;
  maxAttempts: number;
  leaseSeconds: number;
  now?: () => number;
  // Re-checks that the employee is still verified (Phase 2) before a business action runs
  stillVerified: (loopUserId: number) => Promise<boolean>;
  // The execution switch (ASSISTANT_EXECUTION_ENABLED). Off: nothing is claimed, nothing runs, nothing changes.
  enabled?: boolean;
}

export type RunOutcome = 'idle' | 'completed' | 'retry_scheduled' | 'failed';

export async function runNext(d: ExecutorDeps): Promise<{ outcome: RunOutcome; requestId?: string }> {
  if (d.enabled !== true) return { outcome: 'idle' };
  const nowMs = d.now ? d.now() : Date.now();
  const claim = await claimNext(d.db, { workerId: d.workerId, nowMs, leaseSeconds: d.leaseSeconds });
  if (!claim) return { outcome: 'idle' };
  const id = claim.id;
  const row = await d.db('assistant_requests').where({ id }).first('conversation_key');
  const ctx = { loop_user_id: claim.loop_user_id, conversation_key: row.conversation_key };
  const fail = async (kind: string, detail: string) => {
    await transition(d.db, id, 'FAILED', { event: 'failed', ...ctx, expectFrom: ['PROCESSING'], detail, patch: { failure_kind: kind, locked_by: null, locked_until: null } }, nowMs);
    return { outcome: 'failed' as const, requestId: id };
  };

  if (!(await d.stillVerified(claim.loop_user_id))) return fail('identity', 'employee no longer verified');
  const handler = d.registry.get(claim.intent);
  if (!handler) return fail('no_handler', `no handler for ${claim.intent}`);
  let data: any;
  try { data = JSON.parse(claim.data || '{}'); } catch { return fail('invalid_request', 'stored request data unreadable'); }
  const problems = handler.validate(data);
  if (problems.length) return fail('invalid_request', problems.join('; '));

  const attempt = claim.attempts + 1;
  const executionId = crypto.randomUUID();
  const idempotencyKey = `assistant-request-${id}`;   // stable across retries of the same request
  await d.db('assistant_executions').insert({ id: executionId, request_id: id, attempt, idempotency_key: idempotencyKey, status: 'running', started_at: new Date(nowMs) });
  await d.db('assistant_requests').where({ id }).update({ execution_attempts: attempt });

  // Lease renewal: while this worker is still running the request, its claim is extended. A worker that stops
  // loses the lease and the request is recovered; a slow but healthy run is never taken over.
  const renew = setInterval(() => {
    const until = new Date((d.now ? d.now() : Date.now()) + d.leaseSeconds * 1000);
    d.db('assistant_requests').where({ id, status: 'PROCESSING', locked_by: d.workerId }).update({ locked_until: until }).catch(() => {});
  }, Math.max(500, (d.leaseSeconds * 1000) / 3));
  renew.unref?.();
  try {
    const result = await handler.execute({ requestId: id, executionId, idempotencyKey, attempt, loopUserId: claim.loop_user_id, data });
    clearInterval(renew);
    await d.db('assistant_executions').where({ id: executionId }).update({ status: 'succeeded', finished_at: new Date(nowMs) });
    await transition(d.db, id, 'COMPLETED', { event: 'completed', ...ctx, executionId, expectFrom: ['PROCESSING'], detail: result.summary.slice(0, 200), patch: { result_summary: result.summary.slice(0, 500), locked_by: null, locked_until: null } }, nowMs);
    return { outcome: 'completed', requestId: id };
  } catch (e) {
    clearInterval(renew);
    const transient = e instanceof TransientActionError || (!(e instanceof TerminalActionError) && handler.idempotent);
    await d.db('assistant_executions').where({ id: executionId }).update({ status: transient ? 'failed_transient' : 'failed_terminal', error: safeError(e), finished_at: new Date(nowMs) });
    if (transient && attempt < d.maxAttempts) {
      const backoff = Math.min(60, 2 ** attempt) * 1000;
      await transition(d.db, id, 'QUEUED', {
        event: 'retry_scheduled', ...ctx, executionId, expectFrom: ['PROCESSING'], detail: `attempt ${attempt} failed: ${safeError(e)}`,
        patch: { next_attempt_at: new Date(nowMs + backoff), locked_by: null, locked_until: null, failure_kind: 'transient' },
      }, nowMs);
      return { outcome: 'retry_scheduled', requestId: id };
    }
    await transition(d.db, id, 'FAILED', {
      event: 'failed', ...ctx, executionId, expectFrom: ['PROCESSING'], detail: safeError(e),
      patch: { failure_kind: transient ? 'retries_exhausted' : 'terminal', locked_by: null, locked_until: null },
    }, nowMs);
    return { outcome: 'failed', requestId: id };
  }
}

export { StateConflict };
