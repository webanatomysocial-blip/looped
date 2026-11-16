// Retention for conversation text only. Deletes old employee/assistant messages from conversations that have no open request.
// Requests, executions, events, ticket audit, admin audit and identity records are never touched here.
import { Knex } from 'knex';

export const CONTEXT_RETENTION_DAYS = 30;

export async function purgeExpiredContext(db: Knex, nowMs: number, days = CONTEXT_RETENTION_DAYS): Promise<number> {
  const cutoff = new Date(nowMs - days * 24 * 60 * 60 * 1000);
  const openConversations = db('assistant_requests').where('status', 'NEEDS_CLARIFICATION').select('conversation_key');
  return db('assistant_conversation_log')
    .where('created_at', '<', cutoff)
    .whereNotIn('conversation_key', openConversations)
    .del();
}
