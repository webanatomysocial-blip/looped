// Admin-side view and actions for employee WhatsApp linking. It reuses the existing identity tables only.
//
// What counts as proof that a WhatsApp account belongs to an employee (unchanged):
//   • a link code that arrived FROM that WhatsApp number (verifyLinkCode), or
//   • an internal @lid sender an admin verified in person (approvePendingSender).
// Loop stores no phone numbers for employees, and selecting an employee is not proof. So "Link" here never creates a
// mapping by itself: it uses an existing verified mapping when there is one, and otherwise reports that an identity
// mapping is required. Every attempt is written to the admin audit history.
import { Knex } from 'knex';
import { STAFF_ROLES, MAX_CODE_ATTEMPTS } from './identityStore';

export type LinkStatus = 'linked' | 'pending' | 'failed' | 'mapping_required';
export interface LinkRow {
  user_id: number; name: string; role: string; status: LinkStatus;
  number: string | null; detail: string; updated_at: string | null;
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
  const idents = await db('assistant_identities').where({ channel: 'whatsapp' }).orderBy('id', 'desc')
    .select('user_id', 'external_sender_id', 'status', 'verified_at', 'status_changed_at');
  const codes = await db('assistant_link_codes').where({ channel: 'whatsapp' }).orderBy('id', 'desc')
    .select('user_id', 'external_sender_id', 'attempts', 'expires_at', 'used_at', 'created_at');
  const out: LinkRow[] = [];
  for (const u of users) {
    const id = Number(u.id);
    const active = idents.find((i: any) => Number(i.user_id) === id && i.status === 'active');
    const base = { user_id: id, name: String(u.name), role: String(u.role) };
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

export type LinkOutcome = 'already_linked' | 'mapping_required' | 'pending' | 'not_eligible';
export const OUTCOME_TEXT: Record<LinkOutcome, string> = {
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
  const results = [];
  for (const id of ids) {
    const row = rows.find((r) => r.user_id === id);
    const outcome: LinkOutcome = !row ? 'not_eligible' : row.status === 'linked' ? 'already_linked' : row.status === 'pending' ? 'pending' : 'mapping_required';
    const name = row?.name ?? String(users.find((u: any) => Number(u.id) === id)?.name ?? 'Unknown');
    await db('assistant_admin_audit').insert({ actor_id: args.actorId, action: 'link_requested', target: `user:${id}`, detail: `result: ${outcome}`, created_at: now });
    results.push({ user_id: id, name, outcome, message: OUTCOME_TEXT[outcome] });
  }
  return results;
}
