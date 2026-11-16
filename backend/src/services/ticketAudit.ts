// Audit rows for ticket changes made through the assistant. Written in the same transaction as the change,
// so a ticket change and its audit row either both exist or neither does. The unique (request_id, operation)
// index makes a retried execution fail instead of repeating the change.
import { Knex } from 'knex';

export interface AssistantMeta {
  requestId: string;
  executionId?: string | null;
}

export interface TicketAuditEntry {
  requestId: string;
  executionId: string | null;
  loopUserId: number;
  taskId: number;
  operation: string;
  before: unknown;
  after: unknown;
}

export async function writeTicketAudit(trx: Knex | Knex.Transaction, e: TicketAuditEntry): Promise<void> {
  await trx('assistant_ticket_audit').insert({
    request_id: e.requestId,
    execution_id: e.executionId,
    loop_user_id: e.loopUserId,
    task_id: e.taskId,
    operation: e.operation,
    before_json: e.before == null ? null : JSON.stringify(e.before),
    after_json: e.after == null ? null : JSON.stringify(e.after),
    created_at: new Date(),
  });
}

export async function findTicketAudit(db: Knex, requestId: string, operation: string): Promise<{ task_id: number } | undefined> {
  return db('assistant_ticket_audit').where({ request_id: requestId, operation }).first('task_id');
}

// SQLite and MySQL both report a unique-index clash with these codes or messages
export function isDuplicateKeyError(err: any): boolean {
  return err?.code === 'SQLITE_CONSTRAINT_UNIQUE' || err?.code === 'ER_DUP_ENTRY' || /UNIQUE constraint failed/.test(String(err?.message ?? ''));
}
