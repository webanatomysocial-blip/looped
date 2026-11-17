// Admin-side view and actions for employee WhatsApp linking. It reuses the existing identity tables only.
//
// What counts as proof that a WhatsApp account belongs to an employee (unchanged):
//   • a link code that arrived FROM that WhatsApp number (verifyLinkCode), or
//   • an internal @lid sender an admin verified in person (approvePendingSender).
// Loop stores no phone numbers for employees, and selecting an employee is not proof. So "Link" here never creates a
// mapping by itself: it uses an existing verified mapping when there is one, and otherwise reports that an identity
// mapping is required. Every attempt is written to the admin audit history.
import { Knex } from 'knex';
import { STAFF_ROLES, MAX_CODE_ATTEMPTS, normalizePhoneInput, IdentityError } from './identityStore';

// Mobile numbers the admin enters for each employee. This is only a record for the admin to match people against.
// It never links anyone: a WhatsApp account is linked only when it proves itself through the existing link code.
export async function ensureEmployeePhoneSchema(db: Knex): Promise<void> {
  if (await db.schema.hasTable('assistant_employee_phones')) return;
  await db.schema.createTable('assistant_employee_phones', (t) => {
    t.integer('user_id').unsigned().primary();
    t.string('phone', 20).notNullable();
    t.integer('updated_by').nullable();
    t.timestamp('updated_at').nullable();
  });
}

// Admin direct link: the number the admin entered becomes the employee's active WhatsApp identity. The admin's confirmation
// and note are the proof, and both are written to the audit history. Any earlier active link for this employee is retired.
export async function directLinkEmployee(db: Knex, args: { userId: number; phone: unknown; actorId: number; note: unknown; confirmed: unknown; now?: Date }): Promise<{ masked: string }> {
  if (args.confirmed !== true) throw new IdentityError('confirmation_required', 'Confirm that this is the employee\'s WhatsApp number');
  const note = String(args.note ?? '').trim();
  if (note.length < 10 || note.length > 200) throw new IdentityError('note_required', 'Write a note of 10 to 200 characters');
  const phone = normalizePhoneInput(args.phone);
  if (!phone) throw new IdentityError('invalid_phone', 'Enter the number with its country code, e.g. +919876543210');
  const user = await db('users').where({ id: args.userId }).first('id', 'role');
  if (!user || !STAFF_ROLES.includes(user.role)) throw new IdentityError('not_found', 'Staff member not found');
  const now = args.now ?? new Date();
  const senderKey = `whatsapp:${phone}`;
  try {
    await db.transaction(async (trx) => {
      const holder = await trx('assistant_identities').where({ active_sender_key: senderKey }).first('user_id');
      if (holder && Number(holder.user_id) !== args.userId) throw new IdentityError('conflict', 'This number is already linked to another employee');
      await trx('assistant_identities').where({ user_id: args.userId, channel: 'whatsapp' }).whereIn('status', ['active', 'inactive'])
        .update({ status: 'revoked', active_sender_key: null, active_user_key: null, status_changed_at: now, status_changed_by: args.actorId, status_reason: 'replaced by admin direct link' });
      await trx('assistant_identities').insert({
        user_id: args.userId, channel: 'whatsapp', external_sender_id: phone, status: 'active',
        active_sender_key: senderKey, active_user_key: `${args.userId}:whatsapp`, linked_via: 'admin', initiated_by: args.actorId, verified_at: now,
      });
      await trx('assistant_admin_audit').insert({ actor_id: args.actorId, action: 'employee_direct_linked', target: `user:${args.userId}`, detail: `${maskSender(phone)} linked by admin: ${note}`.slice(0, 300), created_at: now });
    });
  } catch (e: any) {
    if (e instanceof IdentityError) throw e;
    if (/unique|duplicate/i.test(String(e?.message))) throw new IdentityError('conflict', 'This number is already linked to another employee');
    throw e;
  }
  await saveEmployeePhone(db, { userId: args.userId, phone, actorId: args.actorId, now });
  return { masked: maskSender(phone)! };
}

// Saving the admin's number links the employee directly: the number entered by the admin is the employee's WhatsApp.
// Audited as an admin entry. Any earlier number for the employee is replaced.
export async function saveEmployeePhone(db: Knex, args: { userId: number; phone: unknown; actorId: number; now?: Date }): Promise<{ masked: string }> {
  return directLinkEmployee(db, { ...args, note: 'Number entered by administrator in the dashboard', confirmed: true });
}

export type LinkStatus = 'linked' | 'pending' | 'failed' | 'mapping_required';
export interface LinkRow {
  user_id: number; name: string; role: string; status: LinkStatus;
  number: string | null; declared_number: string | null; detail: string; updated_at: string | null;
}
const iso = (v: any) => (v ? new Date(v).toISOString() : null);
// "+91 •••• 1234" for phone links, "WhatsApp ID …1234" for internal ids. Never the full value.
export const maskSender = (s: string | null | undefined) => {
  if (!s) return null;
  if (s.startsWith('lid:')) return `WhatsApp ID …${s.slice(-4)}`;
  return `${s.slice(0, 3)} •••• ${s.slice(-4)}`;
};

export async function listEmployeeLinking(db: Knex, now: Date = new Date()): Promise<LinkRow[]> {
  const users = await db('users').whereIn('role', STAFF_ROLES).select('id', 'name', 'role').orderBy('name');
  const declared = new Map<number, string>((await db('assistant_employee_phones').select('user_id', 'phone').catch(() => [])).map((r: any) => [Number(r.user_id), String(r.phone)]));
  const idents = await db('assistant_identities').where({ channel: 'whatsapp' }).orderBy('id', 'desc')
    .select('user_id', 'external_sender_id', 'status', 'verified_at', 'status_changed_at');
  const codes = await db('assistant_link_codes').where({ channel: 'whatsapp' }).orderBy('id', 'desc')
    .select('user_id', 'external_sender_id', 'attempts', 'expires_at', 'used_at', 'created_at');
  const out: LinkRow[] = [];
  for (const u of users) {
    const id = Number(u.id);
    const active = idents.find((i: any) => Number(i.user_id) === id && i.status === 'active');
    const base = { user_id: id, name: String(u.name), role: String(u.role), declared_number: declared.has(id) ? maskSender(declared.get(id)) : null };
    if (active) {
      out.push({ ...base, status: 'linked', number: maskSender(active.external_sender_id), detail: 'Verified WhatsApp identity', updated_at: iso(active.status_changed_at ?? active.verified_at) });
      continue;
    }
    const code = codes.find((c: any) => Number(c.user_id) === id);
    if (code && !code.used_at && new Date(code.expires_at).getTime() > now.getTime()) {
      out.push({ ...base, status: 'pending', number: maskSender(code.external_sender_id), detail: 'Waiting for the employee to verify from WhatsApp', updated_at: iso(code.created_at) });
      continue;
    }
    if (code && (Number(code.attempts) >= MAX_CODE_ATTEMPTS || (!code.used_at && new Date(code.expires_at).getTime() <= now.getTime()))) {
      out.push({ ...base, status: 'failed', number: maskSender(code.external_sender_id), detail: Number(code.attempts) >= MAX_CODE_ATTEMPTS ? 'Too many wrong codes' : 'Verification expired', updated_at: iso(code.expires_at) });
      continue;
    }
    const revoked = idents.find((i: any) => Number(i.user_id) === id);
    out.push({ ...base, status: 'mapping_required', number: null, detail: revoked ? 'Previous link revoked; identity mapping required' : 'Identity mapping required', updated_at: iso(revoked?.status_changed_at) });
  }
  return out;
}

export type LinkOutcome = 'linked' | 'already_linked' | 'mapping_required' | 'pending' | 'not_eligible';
export const OUTCOME_TEXT: Record<LinkOutcome, string> = {
  linked: 'Linked to the saved mobile number.',
  already_linked: 'Already linked to a verified WhatsApp identity.',
  pending: 'A verification is already in progress.',
  mapping_required: 'No verified WhatsApp identity exists for this employee. Identity mapping required.',
  not_eligible: 'Only Loop staff accounts can be linked.',
};

// Admin "Link selected": checks each employee against the trusted sources and records the result. Never links on its own.
export async function linkEmployees(db: Knex, args: { userIds: number[]; actorId: number; now?: Date }): Promise<{ user_id: number; name: string; outcome: LinkOutcome; message: string }[]> {
  const now = args.now ?? new Date();
  const ids = [...new Set(args.userIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 200);
  const rows = await listEmployeeLinking(db, now);
  const users = await db('users').whereIn('id', ids).select('id', 'name');
  const saved = new Map<number, string>((await db('assistant_employee_phones').whereIn('user_id', ids).select('user_id', 'phone')).map((r: any) => [Number(r.user_id), String(r.phone)]));
  const results = [];
  for (const id of ids) {
    const row = rows.find((r) => r.user_id === id);
    // A saved number is linked directly, as an admin entry; without one, the existing checks apply
    if (row && row.status !== 'linked' && saved.has(id)) {
      try {
        await directLinkEmployee(db, { userId: id, phone: saved.get(id), actorId: args.actorId, note: 'Linked by administrator from the saved number', confirmed: true, now });
        results.push({ user_id: id, name: row.name, outcome: 'linked' as LinkOutcome, message: OUTCOME_TEXT.linked });
        continue;
      } catch (e: any) {
        results.push({ user_id: id, name: row.name, outcome: 'mapping_required' as LinkOutcome, message: String(e?.message ?? 'Could not link') });
        continue;
      }
    }
    const outcome: LinkOutcome = !row ? 'not_eligible' : row.status === 'linked' ? 'already_linked' : row.status === 'pending' ? 'pending' : 'mapping_required';
    const name = row?.name ?? String(users.find((u: any) => Number(u.id) === id)?.name ?? 'Unknown');
    await db('assistant_admin_audit').insert({ actor_id: args.actorId, action: 'link_requested', target: `user:${id}`, detail: `result: ${outcome}`, created_at: now });
    results.push({ user_id: id, name, outcome, message: OUTCOME_TEXT[outcome] });
  }
  return results;
}
