// Phase 3 storage: assistant request records, conversation history and inbound-message dedupe.
// Every query is keyed by conversation_key (channel + group + verified employee), so one employee never sees another's context.
import crypto from 'crypto';
import { Knex } from 'knex';
import { RequestStore, AuditLog } from './pipeline';
import { AssistantRequest, AuditEvent } from './types';

export async function ensureConversationSchema(db: Knex): Promise<void> {
  if (!(await db.schema.hasTable('assistant_seen_messages'))) {
    await db.schema.createTable('assistant_seen_messages', (t) => {
      t.increments('id').primary();
      t.string('channel', 20).notNullable();
      t.string('message_id', 128).notNullable();
      t.timestamp('created_at').defaultTo(db.fn.now());
      t.unique(['channel', 'message_id']);
    });
  }
  if (!(await db.schema.hasTable('assistant_requests'))) {
    await db.schema.createTable('assistant_requests', (t) => {
      t.string('id', 36).primary();
      t.string('conversation_key', 200).notNullable();
      t.integer('loop_user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
      t.string('channel', 20).notNullable();
      t.string('conversation_id', 200).notNullable();
      t.string('origin_message_id', 128).nullable();
      t.string('intent', 40).notNullable();
      t.text('data').notNullable();              // JSON: { raw, resolved }
      t.text('ambiguous').nullable();            // JSON array of field names
      t.string('status', 20).notNullable();      // awaiting_info | ready | cancelled | expired | failed
      t.string('asked_field', 40).nullable();
      t.integer('ask_count').notNullable().defaultTo(0);
      t.float('confidence').nullable();
      t.text('ai_meta').nullable();              // JSON: provider, model, token usage
      t.string('error', 200).nullable();
      t.timestamp('created_at').defaultTo(db.fn.now());
      t.timestamp('updated_at').defaultTo(db.fn.now());
      t.index(['conversation_key', 'status']);
    });
  }
  if (!(await db.schema.hasTable('assistant_conversation_log'))) {
    await db.schema.createTable('assistant_conversation_log', (t) => {
      t.increments('id').primary();
      t.string('conversation_key', 200).notNullable();
      t.string('role', 10).notNullable();        // employee | assistant
      t.text('text').notNullable();
      t.string('request_id', 36).nullable();
      t.timestamp('created_at').defaultTo(db.fn.now());
      t.index(['conversation_key']);
    });
  }
}

// Phase 1 RequestStore, backed by the database. Only dedupe is persisted here; request state goes through ConversationStore.
export class DbRequestStore implements RequestStore {
  constructor(private readonly db: Knex) {}
  async claimMessage(channel: string, messageId: string): Promise<boolean> {
    try {
      await this.db('assistant_seen_messages').insert({ channel, message_id: messageId });
      return true;
    } catch (e: any) {
      if (/unique|duplicate|constraint/i.test(String(e?.message))) return false;
      throw e;
    }
  }
  async save(_req: AssistantRequest): Promise<void> { /* Phase 3 engine persists its own records */ }
}

export class DbAuditLog implements AuditLog {
  constructor(private readonly db: Knex) {}
  async append(_e: AuditEvent): Promise<void> { /* request-level audit is recorded with the request row */ }
}

export interface RequestRow {
  id: string; conversation_key: string; loop_user_id: number; channel: string; conversation_id: string;
  origin_message_id: string | null; intent: string; data: { raw: Record<string, string>; resolved: Record<string, any> };
  ambiguous: string[]; status: string; asked_field: string | null; ask_count: number; confidence: number | null;
  ai_meta: any; error: string | null; created_at: string; updated_at: string;
}

const parse = (v: any, fallback: any) => { if (v == null) return fallback; if (typeof v === 'string') { try { return JSON.parse(v); } catch { return fallback; } } return v; };
const toRow = (r: any): RequestRow => ({
  ...r, data: parse(r.data, { raw: {}, resolved: {} }), ambiguous: parse(r.ambiguous, []), ai_meta: parse(r.ai_meta, null),
});

export class ConversationStore {
  constructor(private readonly db: Knex) {}

  // Marks requests whose window has passed as expired; only the employee's own rows are touched
  async expireStale(conversationKey: string, ttlSeconds: number, nowMs: number): Promise<number> {
    const cutoff = new Date(nowMs - ttlSeconds * 1000);
    return this.db('assistant_requests')
      .where({ conversation_key: conversationKey, status: 'NEEDS_CLARIFICATION' })
      .where('updated_at', '<', cutoff)
      .update({ status: 'EXPIRED', updated_at: new Date(nowMs) });
  }

  async openRequests(conversationKey: string): Promise<RequestRow[]> {
    const rows = await this.db('assistant_requests').where({ conversation_key: conversationKey, status: 'NEEDS_CLARIFICATION' }).orderBy('created_at', 'desc');
    return rows.map(toRow);
  }

  async create(row: Omit<RequestRow, 'created_at' | 'updated_at'>, nowMs: number): Promise<void> {
    await this.db('assistant_requests').insert({
      ...row, data: JSON.stringify(row.data), ambiguous: JSON.stringify(row.ambiguous), ai_meta: row.ai_meta ? JSON.stringify(row.ai_meta) : null,
      created_at: new Date(nowMs), updated_at: new Date(nowMs),
    });
  }

  async update(id: string, patch: Partial<Pick<RequestRow, 'data' | 'ambiguous' | 'status' | 'asked_field' | 'ask_count' | 'error' | 'intent' | 'ai_meta'>>, nowMs: number): Promise<void> {
    const out: any = { ...patch, updated_at: new Date(nowMs) };
    if (patch.data) out.data = JSON.stringify(patch.data);
    if (patch.ambiguous) out.ambiguous = JSON.stringify(patch.ambiguous);
    if (patch.ai_meta) out.ai_meta = JSON.stringify(patch.ai_meta);
    await this.db('assistant_requests').where({ id }).update(out);
  }

  async logTurn(conversationKey: string, role: 'employee' | 'assistant', text: string, requestId: string | null, nowMs: number): Promise<number> {
    const [id] = await this.db('assistant_conversation_log').insert({ conversation_key: conversationKey, role, text: text.slice(0, 4000), request_id: requestId, created_at: new Date(nowMs) });
    return Number(typeof id === 'object' ? (id as any).id : id);
  }

  // Exact link from an employee message to the request it produced
  async linkTurn(turnId: number, requestId: string): Promise<void> {
    await this.db('assistant_conversation_log').where({ id: turnId, request_id: null }).update({ request_id: requestId });
  }

  async history(conversationKey: string, limit = 50): Promise<{ role: string; text: string; created_at: string }[]> {
    return this.db('assistant_conversation_log').where({ conversation_key: conversationKey }).orderBy('id', 'desc').limit(limit).select('role', 'text', 'created_at');
  }
}

export const newRequestId = () => crypto.randomUUID();
