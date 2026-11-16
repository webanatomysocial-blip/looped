import { isDuplicateKeyError } from '../services/ticketAudit';
// Queue: claiming work, expiring stale requests and recovering interrupted runs.
// Claims are state transitions, so two workers can never take the same request.
import { Knex } from 'knex';
import { transition, StateConflict } from './requestStore';

export interface ClaimOptions { workerId: string; nowMs: number; leaseSeconds: number; maxPerUser?: number }
export interface ClaimedRequest { id: string; loop_user_id: number; intent: string; attempts: number; data: string }

// One claim: the highest-priority, oldest QUEUED request whose employee has nothing already processing.
// Other employees' requests are never held up by one employee's work.
export async function claimNext(db: Knex, o: ClaimOptions): Promise<ClaimedRequest | null> {
  for (let tries = 0; tries < 5; tries++) {
    const busyUsers = db('assistant_requests').where({ status: 'PROCESSING' }).select('loop_user_id');
    const candidate = await db('assistant_requests')
      .where({ status: 'QUEUED' })
      .where((q) => q.whereNull('next_attempt_at').orWhere('next_attempt_at', '<=', new Date(o.nowMs)))
      .where((q) => q.whereNull('queue_expires_at').orWhere('queue_expires_at', '>', new Date(o.nowMs)))
      .whereNotIn('loop_user_id', busyUsers)
      .orderBy('priority', 'asc').orderBy('created_at', 'asc').orderBy('id', 'asc')
      .first('id', 'loop_user_id', 'intent', 'execution_attempts', 'data');
    if (!candidate) return null;
    try {
      await transition(db, candidate.id, 'PROCESSING', {
        event: 'processing_started', loopUserId: candidate.loop_user_id, expectFrom: ['QUEUED'],
        detail: `worker ${o.workerId}`,
        patch: { locked_by: o.workerId, locked_until: new Date(o.nowMs + o.leaseSeconds * 1000) },
      }, o.nowMs);
      return { id: candidate.id, loop_user_id: candidate.loop_user_id, intent: candidate.intent, attempts: Number(candidate.execution_attempts), data: candidate.data };
    } catch (e) {
      if (isDuplicateKeyError(e)) continue;                   // this employee already has one running (database rule)
      if (!(e instanceof StateConflict)) throw e; // another worker won this one; try the next
    }
  }
  return null;
}

// Requests whose time window has passed are expired, never executed.
export async function expireDue(db: Knex, nowMs: number, contextTtlSeconds: number): Promise<number> {
  const now = new Date(nowMs);
  const cutoff = new Date(nowMs - contextTtlSeconds * 1000);
  const groups: { status: string; where: (q: Knex.QueryBuilder) => void }[] = [
    { status: 'READY_FOR_CONFIRMATION', where: (q) => q.where('confirmation_expires_at', '<', now) },
    { status: 'NEEDS_CLARIFICATION', where: (q) => q.where('updated_at', '<', cutoff) },
    { status: 'QUEUED', where: (q) => q.where('queue_expires_at', '<', now) },
  ];
  let n = 0;
  for (const g of groups) {
    const rows = await db('assistant_requests').where({ status: g.status }).where(g.where).select('id', 'loop_user_id', 'conversation_key');
    for (const r of rows) {
      try {
        await transition(db, r.id, 'EXPIRED', { event: 'expired', loopUserId: r.loop_user_id, conversationKey: r.conversation_key, expectFrom: [g.status as any], detail: 'time window passed' }, nowMs);
        n++;
      } catch (e) { if (!(e instanceof StateConflict)) throw e; }
    }
  }
  return n;
}

// Work left PROCESSING by a crashed worker. Retried only when the handler is safe to repeat (idempotent by key);
// otherwise it is marked FAILED for review, so no business action can run twice unnoticed.
export async function recoverInterrupted(db: Knex, nowMs: number, canRetry: (intent: string) => boolean, maxAttempts: number): Promise<{ requeued: number; failed: number }> {
  const stale = await db('assistant_requests').where({ status: 'PROCESSING' }).where('locked_until', '<', new Date(nowMs))
    .select('id', 'loop_user_id', 'conversation_key', 'intent', 'execution_attempts');
  let requeued = 0, failed = 0;
  for (const r of stale) {
    await db('assistant_executions').where({ request_id: r.id, status: 'running' }).update({ status: 'interrupted', finished_at: new Date(nowMs), error: 'worker stopped before finishing' });
    const retry = canRetry(r.intent) && Number(r.execution_attempts) < maxAttempts;
    try {
      await transition(db, r.id, retry ? 'QUEUED' : 'FAILED', {
        event: retry ? 'recovered' : 'failed', loopUserId: r.loop_user_id, conversationKey: r.conversation_key, expectFrom: ['PROCESSING'],
        detail: retry ? 'interrupted run requeued' : 'interrupted run needs review',
        patch: { locked_by: null, locked_until: null, failure_kind: retry ? null : 'interrupted', next_attempt_at: retry ? new Date(nowMs - 1000) : null }   // MySQL stores whole seconds (rounded): one second back keeps it claimable at once,
      }, nowMs);
      retry ? requeued++ : failed++;
    } catch (e) { if (!(e instanceof StateConflict)) throw e; }
  }
  return { requeued, failed };
}
