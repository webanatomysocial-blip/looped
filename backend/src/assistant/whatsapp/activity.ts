// What the bot did with each incoming WhatsApp message, for the dashboard: replied, or why it stayed silent.
// No message text is ever stored. Senders are shown by their Loop name when linked, otherwise by the last 4 characters.
import { Knex } from 'knex';
import { DbIdentityResolver } from '../identityStore';
import { notificationGroupJid } from '../../services/assignmentNotices';

export type WaOutcome = 'replied' | 'not_mentioned' | 'not_recognised' | 'could_not_decrypt' | 'not_text' | 'send_failed';
export interface WaEvent {
  chat: 'group' | 'private';
  outcome: WaOutcome;
  senderId?: string;          // lid:<id>, +<phone> or opaque:<id>
  senderPhoneId?: string;     // the phone number WhatsApp reported, if any
  conversationId?: string;
}

const KEEP = 300;

export async function ensureWaActivitySchema(db: Knex): Promise<void> {
  if (await db.schema.hasTable('assistant_wa_events')) return;
  await db.schema.createTable('assistant_wa_events', (t) => {
    t.increments('id').primary();
    t.timestamp('created_at').notNullable();
    t.string('chat', 10).notNullable();          // group | private
    t.string('place', 20).notNullable();         // configured group | other group | private chat
    t.string('sender', 80).notNullable();        // Loop name when linked, otherwise "…1234"
    t.boolean('linked').notNullable().defaultTo(false);
    t.boolean('phone_hidden').notNullable().defaultTo(false);
    t.string('outcome', 30).notNullable();
    t.index(['created_at']);
  });
}

const last4 = (id?: string) => (id ? `…${id.replace(/\D/g, '').slice(-4) || id.slice(-4)}` : 'unknown');

export async function recordWaEvent(db: Knex, e: WaEvent, now: Date = new Date()): Promise<void> {
  const identity = new DbIdentityResolver(db);
  let name: string | null = null;
  for (const id of [e.senderId, e.senderPhoneId]) {
    if (!id || name) continue;
    const who = await identity.resolve('whatsapp', id).catch(() => null);
    if (who?.status === 'verified') name = String((await db('users').where({ id: who.loopUserId }).first('name'))?.name ?? 'Linked user');
  }
  const place = e.chat === 'private' ? 'private chat' : e.conversationId && e.conversationId === notificationGroupJid() ? 'configured group' : 'other group';
  const [id] = await db('assistant_wa_events').insert({
    created_at: now, chat: e.chat, place, sender: name ?? last4(e.senderId), linked: !!name,
    phone_hidden: !!e.senderId?.startsWith('lid:') && !e.senderPhoneId, outcome: e.outcome,
  });
  const newest = Number(typeof id === 'object' ? (id as any).id : id);
  if (Number.isFinite(newest) && newest > KEEP) await db('assistant_wa_events').where('id', '<=', newest - KEEP).del();
}

export async function listWaEvents(db: Knex, limit = 30) {
  return db('assistant_wa_events').orderBy('id', 'desc').limit(limit)
    .select('id', 'created_at', 'chat', 'place', 'sender', 'linked', 'phone_hidden', 'outcome');
}
