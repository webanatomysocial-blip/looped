// One WhatsApp connection across all copies of the server.
// Hosting such as cPanel can run several copies of the app and put them to sleep. Each copy would otherwise run its own
// WhatsApp connection with the same login (they push each other off) and show its own status (the dashboard flips).
// The copies agree through the database: one owns the connection and refreshes a heartbeat; if it stops, another takes
// over with the same saved login. The owner publishes its status (and the pairing QR when one is needed) so every copy
// shows the same panel. Everything is stored in assistant_settings; the published state is encrypted.
import os from 'os';
import crypto from 'crypto';
import { Knex } from 'knex';
import { encryptSetting, decryptSetting } from '../settingsStore';

const OWNER = 'wa_owner';
const STATE = 'wa_state';
export const OWNER_STALE_MS = 45_000;      // an owner that has not refreshed for this long is gone
export const INSTANCE_ID = `${os.hostname()}:${process.pid}:${crypto.randomBytes(3).toString('hex')}`;

// After a deploy or restart the old copy is gone at once, but its heartbeat still looks fresh for a while. If the owner
// ran on this same machine and its process no longer exists, take over immediately instead of waiting.
export function ownerProcessGone(ownerId: string | undefined, host: string = os.hostname()): boolean {
  const [ownerHost, pidText] = String(ownerId ?? '').split(':');
  const pid = Number(pidText);
  if (ownerHost !== host || !Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try { process.kill(pid, 0); return false; }            // still running (or not ours to signal)
  catch (e: any) { return e?.code === 'ESRCH'; }          // no such process: the old copy is gone
}

const readRow = (db: Knex, name: string) => db('assistant_settings').where({ name }).first('value').catch(() => null);

// Become (or stay) the owner. Compare-and-swap on the stored value, so two copies can never both win.
export async function claimOwner(db: Knex, id: string = INSTANCE_ID, now: number = Date.now()): Promise<boolean> {
  const next = JSON.stringify({ id, at: now });
  const row = await readRow(db, OWNER);
  if (!row) {
    try { await db('assistant_settings').insert({ name: OWNER, value: next, updated_at: new Date(now) }); return true; }
    catch { return false; }   // another copy inserted it first
  }
  let cur: { id?: string; at?: number } = {};
  try { cur = JSON.parse(String(row.value)); } catch { /* damaged: treat as stale */ }
  if (cur.id !== id && now - Number(cur.at ?? 0) < OWNER_STALE_MS && !ownerProcessGone(cur.id)) return false;
  const changed = await db('assistant_settings').where({ name: OWNER, value: String(row.value) }).update({ value: next, updated_at: new Date(now) });
  return changed === 1;
}

export async function releaseOwner(db: Knex, id: string = INSTANCE_ID): Promise<void> {
  const row = await readRow(db, OWNER);
  if (!row) return;
  try { if (JSON.parse(String(row.value)).id !== id) return; } catch { return; }
  await db('assistant_settings').where({ name: OWNER, value: String(row.value) }).del().catch(() => undefined);
}

export interface SharedState {
  status: Record<string, unknown>;
  qr: { qr: string; issuedAt: string } | null;
  groups: { name: string; jid: string }[] | null;
  at: number;
}

export async function publishState(db: Knex, state: Omit<SharedState, 'at'>, now: number = Date.now()): Promise<void> {
  const value = encryptSetting(JSON.stringify({ ...state, at: now }));
  const row = { value, updated_at: new Date(now) };
  if (await readRow(db, STATE)) await db('assistant_settings').where({ name: STATE }).update(row);
  else await db('assistant_settings').insert({ name: STATE, ...row }).catch(() => db('assistant_settings').where({ name: STATE }).update(row));
}

// The owner's last published state; null when nobody has published recently (no copy owns the connection)
export async function readState(db: Knex, now: number = Date.now()): Promise<SharedState | null> {
  const row = await readRow(db, STATE);
  if (!row) return null;
  const plain = decryptSetting(String(row.value));
  if (!plain) return null;
  try {
    const s = JSON.parse(plain) as SharedState;
    return now - Number(s.at) < OWNER_STALE_MS ? s : null;
  } catch { return null; }
}
