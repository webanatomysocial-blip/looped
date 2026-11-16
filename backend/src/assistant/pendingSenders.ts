// Manual linking of WhatsApp internal ids (@lid). Baileys does not give a phone number for these, so an admin links one
// to a Loop user only after confirming in person. Nothing maps an id to a number or an employee automatically.
import { Knex } from 'knex';
import { STAFF_ROLES } from './identityStore';

export const PENDING_TTL_DAYS = 30;
const DAY = 86_400_000;
const LID_ID = /^[0-9A-Za-z_.-]{1,64}$/;

export class PendingError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'PendingError'; }
}

// Stored form of a private-chat internal id as the assistant sees it: "lid:<id>"
export const isLidSender = (s: string) => /^lid:[0-9A-Za-z_.-]{1,64}$/.test(s);

export async function ensurePendingSchema(db: Knex): Promise<void> {
  if (await db.schema.hasTable('assistant_pending_senders')) return;
  await db.schema.createTable('assistant_pending_senders', (t) => {
    t.increments('id').primary();
    t.string('channel', 20).notNullable();
    t.string('sender_id', 64).notNullable();          // the internal id, server-side only; never logged or shown in full
    t.string('last4', 4).notNullable();
    t.timestamp('first_seen').notNullable();
    t.timestamp('last_seen').notNullable();
    t.integer('message_count').notNullable().defaultTo(0);
    t.string('status', 20).notNullable().defaultTo('pending');   // pending | linked | dismissed | expired
    t.integer('linked_user_id').unsigned().nullable();
    t.integer('decided_by').unsigned().nullable();
    t.timestamp('decided_at').nullable();
    t.string('decision_note', 200).nullable();
    t.unique(['channel', 'sender_id']);
    t.index(['status']);
  });
}

const ageDays = (first: Date, now: Date) => (now.getTime() - new Date(first).getTime()) / DAY;

// Called for each private message from an unknown internal id. Records it as pending; creates no request and no identity.
export async function recordPendingSender(db: Knex, senderId: string, now = new Date()): Promise<'recorded' | 'skipped'> {
  if (!isLidSender(senderId)) return 'skipped';
  const id = senderId.slice(4);
  // Any existing link, active or not, means this id is known: a revoked link stays blocked and is not re-recorded
  if (await db('assistant_identities').where({ channel: 'whatsapp', external_sender_id: senderId }).first('id')) return 'skipped';
  const row = await db('assistant_pending_senders').where({ channel: 'whatsapp', sender_id: id }).first();
  if (!row) {
    await db('assistant_pending_senders').insert({ channel: 'whatsapp', sender_id: id, last4: id.slice(-4), first_seen: now, last_seen: now, message_count: 1, status: 'pending' });
    return 'recorded';
  }
  if (row.status === 'pending' && ageDays(row.first_seen, now) >= PENDING_TTL_DAYS) {
    await db('assistant_pending_senders').where({ id: row.id }).update({ status: 'expired' });
    return 'skipped';
  }
  if (row.status !== 'pending') return 'skipped';   // dismissed, expired or linked: a new message does not revive it
  await db('assistant_pending_senders').where({ id: row.id }).update({ last_seen: now, message_count: Number(row.message_count) + 1 });
  return 'recorded';
}

// Pending records for the admin screen. Only the last four characters are returned, never the full id.
export async function listPendingSenders(db: Knex, now = new Date()) {
  await db('assistant_pending_senders').where({ status: 'pending' })
    .where('first_seen', '<=', new Date(now.getTime() - PENDING_TTL_DAYS * DAY)).update({ status: 'expired' });
  const rows = await db('assistant_pending_senders').where({ status: 'pending' }).orderBy('last_seen', 'desc')
    .select('id', 'last4', 'first_seen', 'last_seen', 'message_count', 'first_seen');
  return rows.map((r: any) => ({
    id: r.id, last4: r.last4, first_seen: r.first_seen, last_seen: r.last_seen, message_count: Number(r.message_count),
    days_left: Math.max(0, Math.ceil(PENDING_TTL_DAYS - ageDays(r.first_seen, now))),
  }));
}

export async function approvePendingSender(db: Knex, args: {
  pendingId: number; userId: number; actorId: number; inPersonVerified: boolean; note: string; now?: Date;
}): Promise<{ identityId: number }> {
  const now = args.now ?? new Date();
  if (args.inPersonVerified !== true) throw new PendingError('verification_required', 'Confirm that you verified this employee in person');
  const note = String(args.note ?? '').trim();
  if (note.length < 10 || note.length > 200) throw new PendingError('note_required', 'Write an audit note of 10 to 200 characters');
  const row = await db('assistant_pending_senders').where({ id: args.pendingId }).first();
  if (!row) throw new PendingError('not_found', 'Pending sender not found');
  if (row.status === 'pending' && ageDays(row.first_seen, now) >= PENDING_TTL_DAYS) {
    await db('assistant_pending_senders').where({ id: row.id }).update({ status: 'expired' });
    throw new PendingError('expired', 'This pending sender has expired. The employee must send a new message to be listed again.');
  }
  if (row.status === 'expired') throw new PendingError('expired', 'This pending sender has expired');
  if (row.status !== 'pending') throw new PendingError('not_pending', 'This sender has already been decided');
  const user = await db('users').where({ id: args.userId }).first(['id', 'role']);
  if (!user || !STAFF_ROLES.includes(user.role)) throw new PendingError('user_not_eligible', 'Only staff accounts can be linked');
  const sender = `lid:${row.sender_id}`;
  if (await db('assistant_identities').where({ channel: 'whatsapp', external_sender_id: sender }).first('id')) {
    throw new PendingError('sender_taken', 'This WhatsApp identity is already linked to a Loop account');
  }
  if (await db('assistant_identities').where({ user_id: user.id, channel: 'whatsapp', status: 'active' }).first('id')) {
    throw new PendingError('user_has_active_link', 'This person already has an active WhatsApp link. Revoke it first.');
  }
  return db.transaction(async (trx) => {
    const [identityId] = await trx('assistant_identities').insert({
      user_id: user.id, channel: 'whatsapp', external_sender_id: sender, status: 'active',
      active_sender_key: `whatsapp:${sender}`, active_user_key: `${user.id}:whatsapp`,
      linked_via: 'manual_lid', initiated_by: args.actorId, verified_at: now,
      status_changed_at: now, status_changed_by: args.actorId, status_reason: note.slice(0, 200),
    });
    await trx('assistant_pending_senders').where({ id: row.id }).update({ status: 'linked', linked_user_id: user.id, decided_by: args.actorId, decided_at: now, decision_note: note.slice(0, 200) });
    await trx('assistant_admin_audit').insert({ actor_id: args.actorId, action: 'identity_linked_manual', target: `pending:${row.id}`, detail: `user:${user.id} ${note.slice(0, 180)}`, created_at: now });
    return { identityId: Number(identityId) };
  });
}

export async function dismissPendingSender(db: Knex, args: { pendingId: number; actorId: number; note?: string; now?: Date }): Promise<void> {
  const now = args.now ?? new Date();
  const row = await db('assistant_pending_senders').where({ id: args.pendingId }).first();
  if (!row) throw new PendingError('not_found', 'Pending sender not found');
  if (row.status !== 'pending') throw new PendingError('not_pending', 'This sender has already been decided');
  await db.transaction(async (trx) => {
    await trx('assistant_pending_senders').where({ id: row.id }).update({ status: 'dismissed', decided_by: args.actorId, decided_at: now, decision_note: String(args.note ?? '').slice(0, 200) || null });
    await trx('assistant_admin_audit').insert({ actor_id: args.actorId, action: 'pending_sender_dismissed', target: `pending:${row.id}`, detail: null, created_at: now });
  });
}
