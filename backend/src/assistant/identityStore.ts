// Verified external-sender ↔ Loop-user mappings.
// Ownership proof (no outbound OTP delivery exists in Loop): a logged-in user generates a one-time code bound to
// a declared number; the code is only accepted when it ARRIVES FROM that number on that channel.
import crypto from 'crypto';
import { Knex } from 'knex';
import { Channel } from './types';
import { IdentityResolver, IdentityResult } from './identity';

export const LINKABLE_CHANNELS: Channel[] = ['whatsapp'];
export const STAFF_ROLES = ['admin', 'manager', 'employee'];
export const CODE_TTL_MS = 15 * 60 * 1000;
export const MAX_CODE_ATTEMPTS = 5;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

export type IdentityStatus = 'active' | 'inactive' | 'revoked';

export async function ensureAssistantSchema(db: Knex): Promise<void> {
  if (!(await db.schema.hasTable('assistant_identities'))) {
    await db.schema.createTable('assistant_identities', (t) => {
      t.increments('id').primary();
      t.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
      t.string('channel', 20).notNullable();
      t.string('external_sender_id', 64).notNullable(); // normalised, e.g. +919876543210
      t.string('status', 10).notNullable().defaultTo('active');
      // Set only while active, NULL otherwise: UNIQUE on these gives "one active mapping" on both MySQL and SQLite
      t.string('active_sender_key', 100).nullable().unique();
      t.string('active_user_key', 50).nullable().unique();
      t.string('linked_via', 10).notNullable();          // self | admin
      t.integer('initiated_by').nullable();
      t.timestamp('verified_at').notNullable();
      t.timestamp('status_changed_at').nullable();
      t.integer('status_changed_by').nullable();
      t.string('status_reason', 200).nullable();
      t.timestamp('created_at').defaultTo(db.fn.now());
      t.index(['user_id']);
      t.index(['channel', 'external_sender_id']);
    });
  }
  if (!(await db.schema.hasTable('assistant_link_codes'))) {
    await db.schema.createTable('assistant_link_codes', (t) => {
      t.increments('id').primary();
      t.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
      t.string('channel', 20).notNullable();
      t.string('external_sender_id', 64).notNullable();   // the only sender allowed to redeem it
      t.string('code_hash', 64).notNullable();
      t.integer('attempts').notNullable().defaultTo(0);
      t.timestamp('expires_at').notNullable();
      t.timestamp('used_at').nullable();
      t.string('linked_via', 10).notNullable();
      t.integer('created_by').notNullable();
      t.timestamp('created_at').defaultTo(db.fn.now());
      t.index(['channel', 'external_sender_id']);
    });
  }
}

// ── Sender identifiers ──

const E164 = /^\+[1-9]\d{7,14}$/;

// Number typed by a person: must carry its country code.
export function normalizePhoneInput(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().replace(/[\s\-().]/g, '').replace(/^00/, '+');
  return E164.test(s) ? s : null;
}

// Identifier reported by a channel provider. Groups, broadcast lists and opaque ids (e.g. WhatsApp @lid) are not people.
export function normalizeSenderId(channel: Channel, raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const s = raw.trim();
  if (channel === 'whatsapp') {
    const m = /^\+?(\d{8,15})(?:@(s\.whatsapp\.net|c\.us))?$/.exec(s);
    if (!m) return null;
    const e = `+${m[1]}`;
    return E164.test(e) ? e : null;
  }
  if (channel === 'simulator') return /^loop-user:\d+$/.test(s) ? s : null;
  return null;
}

// ── Link codes ──

const hash = (code: string) => crypto.createHash('sha256').update(code).digest('hex');

function generateCode(): string {
  let c = '';
  for (let i = 0; i < 8; i++) c += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}

// "LINK ABCD-EFGH", "link abcdefgh" → "ABCD-EFGH"
export function extractLinkCode(text: string): string | null {
  const m = /^\s*link\s+([A-Za-z2-9]{4})-?([A-Za-z2-9]{4})\s*$/i.exec(text);
  return m ? `${m[1]}-${m[2]}`.toUpperCase() : null;
}

export class IdentityError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'IdentityError'; }
}

export async function createLinkCode(db: Knex, args: {
  userId: number; channel: Channel; phone: string; createdBy: number; via: 'self' | 'admin'; now?: Date;
}): Promise<{ code: string; expiresAt: Date; externalSenderId: string }> {
  if (!LINKABLE_CHANNELS.includes(args.channel)) throw new IdentityError('channel_not_linkable', `Channel "${args.channel}" cannot be linked`);
  const sender = normalizePhoneInput(args.phone);
  if (!sender) throw new IdentityError('invalid_phone', 'Enter the number with its country code, e.g. +919876543210');
  const user = await db('users').where({ id: args.userId }).select('id', 'role').first();
  if (!user || !STAFF_ROLES.includes(user.role)) throw new IdentityError('user_not_eligible', 'Only Loop staff accounts can be linked');
  const taken = await db('assistant_identities').where({ active_sender_key: `${args.channel}:${sender}` }).whereNot({ user_id: args.userId }).first();
  if (taken) throw new IdentityError('sender_taken', 'This number is already linked to another Loop account');

  const now = args.now ?? new Date();
  const code = generateCode();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS);
  await db.transaction(async (trx) => {
    // Only the newest code per user+channel works
    await trx('assistant_link_codes').where({ user_id: args.userId, channel: args.channel }).whereNull('used_at').update({ used_at: now });
    await trx('assistant_link_codes').insert({
      user_id: args.userId, channel: args.channel, external_sender_id: sender, code_hash: hash(code),
      expires_at: expiresAt, linked_via: args.via, created_by: args.createdBy,
    });
  });
  return { code, expiresAt, externalSenderId: sender };
}

export type VerifyResult =
  | { ok: true; userId: number; identityId: number; replaced: boolean }
  | { ok: false; reason: 'invalid_sender' | 'no_pending_code' | 'wrong_code' | 'too_many_attempts' | 'sender_taken' | 'user_not_eligible' };

// Called with the CHANNEL-reported sender. The code in the text is a secret, never an identity claim.
export async function verifyLinkCode(db: Knex, args: { channel: Channel; rawSenderId: string; code: string; now?: Date }): Promise<VerifyResult> {
  const sender = normalizeSenderId(args.channel, args.rawSenderId);
  if (!sender || !LINKABLE_CHANNELS.includes(args.channel)) return { ok: false, reason: 'invalid_sender' };
  const now = args.now ?? new Date();

  const pending = await db('assistant_link_codes')
    .where({ channel: args.channel, external_sender_id: sender }).whereNull('used_at').where('expires_at', '>', now)
    .orderBy('id', 'desc').first();
  if (!pending) return { ok: false, reason: 'no_pending_code' };

  const a = Buffer.from(hash(args.code.toUpperCase()));
  const b = Buffer.from(String(pending.code_hash));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    const attempts = Number(pending.attempts) + 1;
    await db('assistant_link_codes').where({ id: pending.id }).update({ attempts, ...(attempts >= MAX_CODE_ATTEMPTS ? { used_at: now } : {}) });
    return { ok: false, reason: attempts >= MAX_CODE_ATTEMPTS ? 'too_many_attempts' : 'wrong_code' };
  }

  try {
    return await db.transaction(async (trx) => {
      // Claim the code atomically so a replayed message can't redeem it twice
      const claimed = await trx('assistant_link_codes').where({ id: pending.id }).whereNull('used_at').update({ used_at: now });
      if (!claimed) return { ok: false, reason: 'no_pending_code' } as VerifyResult;
      const user = await trx('users').where({ id: pending.user_id }).select('role').first();
      if (!user || !STAFF_ROLES.includes(user.role)) return { ok: false, reason: 'user_not_eligible' } as VerifyResult;
      const senderKey = `${args.channel}:${sender}`;
      const holder = await trx('assistant_identities').where({ active_sender_key: senderKey }).first();
      if (holder && Number(holder.user_id) !== Number(pending.user_id)) return { ok: false, reason: 'sender_taken' } as VerifyResult;

      // Number change / re-verification: any previous mapping for this user+channel is retired
      const replaced = await trx('assistant_identities')
        .where({ user_id: pending.user_id, channel: args.channel }).whereIn('status', ['active', 'inactive'])
        .update({ status: 'revoked', active_sender_key: null, active_user_key: null, status_changed_at: now, status_changed_by: pending.user_id, status_reason: 'replaced by new verification' });
      const [id] = await trx('assistant_identities').insert({
        user_id: pending.user_id, channel: args.channel, external_sender_id: sender, status: 'active',
        active_sender_key: senderKey, active_user_key: `${pending.user_id}:${args.channel}`,
        linked_via: pending.linked_via, initiated_by: pending.created_by, verified_at: now,
      });
      return { ok: true, userId: Number(pending.user_id), identityId: Number(typeof id === 'object' ? (id as any).id : id), replaced: replaced > 0 } as VerifyResult;
    });
  } catch (e: any) {
    if (/unique|duplicate/i.test(String(e?.message))) return { ok: false, reason: 'sender_taken' };
    throw e;
  }
}

// Pipeline hook for unverified senders. Never says which account a code belongs to.
export function createLinkHandler(db: Knex) {
  return async (msg: { channel: Channel; senderId: string; text: string }): Promise<string | null> => {
    const code = extractLinkCode(msg.text);
    if (!code) return null;
    const r = await verifyLinkCode(db, { channel: msg.channel, rawSenderId: msg.senderId, code });
    if (r.ok) {
      try {
        await db('notifications').insert({ user_id: r.userId, type: 'info', message: `A ${msg.channel} number ending ${msg.senderId.slice(-4)} was linked to your Loop account. If this wasn't you, revoke it in Settings.` });
      } catch { /* a notification must never fail the link */ }
      return 'Linked. You can now use the Loop assistant from this number.';
    }
    if (r.reason === 'too_many_attempts') return 'Too many wrong codes. Generate a new code in Loop.';
    return "That code didn't work. Check it, or generate a new one in Loop.";
  };
}

// ── Lifecycle ──

export async function setIdentityStatus(db: Knex, args: {
  identityId: number; status: IdentityStatus; actorId: number; reason?: string; onlyForUserId?: number; now?: Date;
}): Promise<void> {
  const row = await db('assistant_identities').where({ id: args.identityId }).first();
  if (!row || (args.onlyForUserId !== undefined && Number(row.user_id) !== args.onlyForUserId)) throw new IdentityError('not_found', 'Mapping not found');
  if (row.status === 'revoked') throw new IdentityError('revoked', 'A revoked mapping cannot be changed; verify the number again');
  const active = args.status === 'active';
  try {
    await db('assistant_identities').where({ id: row.id }).update({
      status: args.status,
      active_sender_key: active ? `${row.channel}:${row.external_sender_id}` : null,
      active_user_key: active ? `${row.user_id}:${row.channel}` : null,
      status_changed_at: args.now ?? new Date(), status_changed_by: args.actorId, status_reason: args.reason?.slice(0, 200) ?? null,
    });
  } catch (e: any) {
    if (/unique|duplicate/i.test(String(e?.message))) throw new IdentityError('conflict', 'Another active mapping already uses this number or account');
    throw e;
  }
}

export function listIdentities(db: Knex, filter: { userId?: number } = {}) {
  const q = db('assistant_identities as ai').join('users as u', 'u.id', 'ai.user_id')
    .select('ai.id', 'ai.user_id', 'u.name as user_name', 'ai.channel', 'ai.external_sender_id', 'ai.status', 'ai.linked_via',
      'ai.verified_at', 'ai.status_changed_at', 'ai.status_reason')
    .orderBy('ai.id', 'desc');
  return filter.userId !== undefined ? q.where('ai.user_id', filter.userId) : q;
}

// ── Resolvers ──

// Looks the user up on EVERY message: a deleted user, or one no longer staff, stops resolving immediately.
// Returns the user's CURRENT role; the mapping itself carries no permissions.
export class DbIdentityResolver implements IdentityResolver {
  constructor(private readonly db: Knex) {}
  async resolve(channel: Channel, senderId: string): Promise<IdentityResult> {
    // A WhatsApp internal id (lid:<id>) matches only an exact stored link; phone numbers use the normal normaliser
    const internal = channel === 'whatsapp' && /^lid:[0-9A-Za-z_.-]{1,64}$/.test(String(senderId)) ? String(senderId) : null;
    const sender = internal ?? normalizeSenderId(channel, senderId);
    if (!sender || !LINKABLE_CHANNELS.includes(channel)) return { status: 'unknown' };
    const row = await this.db('assistant_identities as ai').leftJoin('users as u', 'u.id', 'ai.user_id')
      .where({ 'ai.active_sender_key': `${channel}:${sender}`, 'ai.status': 'active' })
      .select('ai.user_id', 'u.id as uid', 'u.role').first();
    if (!row) {
      const known = await this.db('assistant_identities').where({ channel, external_sender_id: sender }).first();
      return known ? { status: 'disabled' } : { status: 'unknown' };
    }
    if (!row.uid || !STAFF_ROLES.includes(row.role)) return { status: 'disabled' };
    return { status: 'verified', loopUserId: Number(row.uid), role: row.role };
  }
}

// Simulator senders are "loop-user:<id>", set server-side from the authenticated session (never from user input).
export class SimulatorIdentityResolver implements IdentityResolver {
  constructor(private readonly db: Knex) {}
  async resolve(channel: Channel, senderId: string): Promise<IdentityResult> {
    if (channel !== 'simulator') return { status: 'unknown' };
    const s = normalizeSenderId('simulator', senderId);
    if (!s) return { status: 'unknown' };
    // Deleted employee: no user row. Unlinked: no simulator identity at all. Revoked or disabled: a link exists but is not active.
    const u = await this.db('users').where({ id: Number(s.split(':')[1]) }).select('id', 'role').first();
    if (!u) return { status: 'unknown' };
    const link = await this.db('assistant_identities').where({ user_id: u.id, channel: 'simulator' }).select('status');
    if (link.length === 0) return { status: 'unknown' };
    if (!link.some((l: any) => l.status === 'active')) return { status: 'disabled' };
    return STAFF_ROLES.includes(u.role) ? { status: 'verified', loopUserId: Number(u.id), role: u.role } : { status: 'disabled' };
  }
}

// Dispatches by channel so an identity on one channel can never resolve on another.
export class ChannelIdentityResolver implements IdentityResolver {
  constructor(private readonly byChannel: Partial<Record<Channel, IdentityResolver>>) {}
  resolve(channel: Channel, senderId: string): Promise<IdentityResult> {
    const r = this.byChannel[channel];
    return r ? r.resolve(channel, senderId) : Promise.resolve({ status: 'unknown' });
  }
}
