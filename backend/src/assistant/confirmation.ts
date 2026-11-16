// Explicit confirmation. A confirmation names one request, comes from the employee who made it, and is never guessed.
import crypto from 'crypto';
import { Knex } from 'knex';
import { transition, StateConflict, logEvent } from './requestStore';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
export const CONFIRM_WORDS = /^\s*(yes|yes please|yep|confirm|ok|okay|go ahead|do it)\s*[.!]?\s*$/i;
const CONFIRM_CODE = /^\s*confirm\s+([A-Za-z2-9]{5})\s*[.!]?\s*$/i;
const CANCEL_CODE = /^\s*cancel\s+([A-Za-z2-9]{5})\s*[.!]?\s*$/i;

export function newCode(): string {
  let c = '';
  for (let i = 0; i < 5; i++) c += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return c;
}

// Called when a request first becomes ready: gives it a code and an expiry window.
export async function assignConfirmation(db: Knex, requestId: string, ttlSeconds: number, nowMs: number): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode();
    try {
      await db('assistant_requests').where({ id: requestId }).update({
        confirm_code: code,
        confirmation_expires_at: new Date(nowMs + ttlSeconds * 1000),
      });
      return code;
    } catch (e: any) {
      if (!/unique|duplicate|constraint/i.test(String(e?.message))) throw e;
    }
  }
  throw new Error('could not allocate a confirmation code');
}

export type ConfirmOutcome =
  | { kind: 'confirmed'; requestId: string; code: string }
  | { kind: 'cancelled'; requestId: string }
  | { kind: 'ambiguous'; codes: string[] }
  | { kind: 'invalid' }
  | { kind: 'already'; detail: string }
  | { kind: 'none' };

// Turns an employee's message into a confirmation action, or returns { kind: 'none' } if it isn't one.
export async function handleConfirmationText(
  db: Knex, loopUserId: number, conversationKey: string, text: string, nowMs: number, queueExpirySeconds: number,
): Promise<ConfirmOutcome> {
  const code = CONFIRM_CODE.exec(text)?.[1]?.toUpperCase();
  const cancelCode = CANCEL_CODE.exec(text)?.[1]?.toUpperCase();
  const plain = CONFIRM_WORDS.test(text);
  if (!code && !cancelCode && !plain) return { kind: 'none' };

  // Expired confirmations never count
  await db('assistant_requests').where({ status: 'READY_FOR_CONFIRMATION', loop_user_id: loopUserId })
    .where('confirmation_expires_at', '<', new Date(nowMs)).update({ status: 'EXPIRED', updated_at: new Date(nowMs) });

  const ready = await db('assistant_requests').where({ loop_user_id: loopUserId, status: 'READY_FOR_CONFIRMATION' })
    .orderBy('created_at', 'asc').select('id', 'confirm_code', 'conversation_key');

  if (code || cancelCode) {
    const target = code ?? cancelCode!;
    // Another employee's code looks exactly like an unknown one: no hint that it exists
    const row = ready.find((r: any) => String(r.confirm_code).toUpperCase() === target);
    if (!row) return { kind: 'invalid' };
    if (cancelCode) {
      try {
        await transition(db, row.id, 'CANCELLED', { event: 'cancelled', loopUserId, conversationKey, detail: 'cancelled by employee' }, nowMs);
      } catch (e) {
        if (e instanceof StateConflict) return { kind: 'already', detail: e.message };
        throw e;
      }
      return { kind: 'cancelled', requestId: row.id };
    }
    return confirmRequest(db, row.id, loopUserId, row.confirm_code, nowMs, queueExpirySeconds);
  }

  // A plain "yes" only works when there is exactly one request waiting for confirmation
  // All of this employee's waiting requests count, in any group: several pending means no plain yes
  const pool = ready;
  if (pool.length === 0) return { kind: 'none' };
  if (pool.length > 1) return { kind: 'ambiguous', codes: pool.map((r: any) => String(r.confirm_code)) };
  return confirmRequest(db, pool[0].id, loopUserId, pool[0].confirm_code, nowMs, queueExpirySeconds);
}

// Confirmed → queued in one transaction. A second confirmation finds the request already moved and does nothing.
export async function confirmRequest(db: Knex, requestId: string, loopUserId: number, code: string, nowMs: number, queueExpirySeconds: number): Promise<ConfirmOutcome> {
  try {
    await db.transaction(async (trx) => {
      const row = await trx('assistant_requests').where({ id: requestId, loop_user_id: loopUserId }).first();
      if (!row) throw new StateConflict(requestId, 'not found');
      await transition(trx as any, requestId, 'CONFIRMED', {
        event: 'confirmed', loopUserId, conversationKey: row.conversation_key, detail: 'confirmed by employee',
        expectFrom: ['READY_FOR_CONFIRMATION'], patch: { confirmed_by: loopUserId, confirmed_at: new Date(nowMs) },
      }, nowMs, trx);
      await transition(trx as any, requestId, 'QUEUED', {
        event: 'queued', loopUserId, conversationKey: row.conversation_key, detail: 'queued for execution',
        expectFrom: ['CONFIRMED'], patch: { queue_expires_at: new Date(nowMs + queueExpirySeconds * 1000), priority: priorityFor(row.intent) },
      }, nowMs, trx);
    });
    return { kind: 'confirmed', requestId, code };
  } catch (e) {
    if (e instanceof StateConflict) return { kind: 'already', detail: e.message };
    throw e;
  }
}

// Queue priority is about processing order only; it is not the Loop task priority
const PRIORITY: Record<string, number> = { APPROVE_TASK: 50, REJECT_TASK: 50, APPROVE_REVIEW: 50, REJECT_REVIEW: 50 };
export const priorityFor = (intent: string) => PRIORITY[intent] ?? 100;

export { logEvent };
