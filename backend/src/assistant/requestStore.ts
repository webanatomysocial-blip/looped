// The only way a request changes state. Each change is one transaction: checked against the lifecycle,
// a conditional update (status and version must still match what was read), and an audit event.
import { Knex } from 'knex';
import { assertTransition, RequestState } from './lifecycle';

export class StateConflict extends Error {
  constructor(public readonly requestId: string, message = 'Request changed since it was read') {
    super(message);
    this.name = 'StateConflict';
  }
}

export interface EventInfo {
  event: string;
  loopUserId?: number | null;
  conversationKey?: string;
  executionId?: string | null;
  detail?: string | null;
}

// Arrays and objects (ambiguous, data, ai_meta) are stored as JSON text, as every other write path does
function jsonFields(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) out[k] = v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v;
  return out;
}

export async function logEvent(trx: Knex | Knex.Transaction, requestId: string, info: EventInfo & { from?: string | null; to?: string | null }, nowMs: number) {
  await trx('assistant_request_events').insert({
    request_id: requestId,
    conversation_key: info.conversationKey ?? '',
    loop_user_id: info.loopUserId ?? null,
    event: info.event,
    from_state: info.from ?? null,
    to_state: info.to ?? null,
    execution_id: info.executionId ?? null,
    detail: info.detail ? String(info.detail).slice(0, 300) : null,
    created_at: new Date(nowMs),
  });
}

// Moves a request to a new state inside the caller's transaction (or its own).
export async function transition(
  db: Knex,
  requestId: string,
  to: RequestState,
  info: EventInfo & { patch?: Record<string, unknown>; expectFrom?: RequestState[] },
  nowMs: number,
  trx?: Knex.Transaction,
): Promise<{ from: string }> {
  const run = async (t: Knex.Transaction) => {
    const row = await t('assistant_requests').where({ id: requestId }).first();
    if (!row) throw new StateConflict(requestId, 'Request not found');
    if (info.expectFrom && !info.expectFrom.includes(row.status)) throw new StateConflict(requestId, `Request is ${row.status}`);
    assertTransition(row.status, to);
    const updated = await t('assistant_requests')
      .where({ id: requestId, status: row.status, version: row.version })
      .update({ ...jsonFields(info.patch ?? {}), status: to, version: Number(row.version) + 1, updated_at: new Date(nowMs) });
    if (!updated) throw new StateConflict(requestId);
    await logEvent(t, requestId, { ...info, from: row.status, to, loopUserId: info.loopUserId ?? row.loop_user_id, conversationKey: info.conversationKey ?? row.conversation_key }, nowMs);
    return { from: row.status as string };
  };
  return trx ? run(trx) : db.transaction(run);
}
