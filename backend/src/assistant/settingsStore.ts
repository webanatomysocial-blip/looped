// Assistant settings saved from the dashboard, so the live server can be configured without editing files on it.
// Secrets (the AI key) are encrypted with AES-256-GCM using a key derived from the server's JWT_SECRET, and are never
// returned to the browser or written to a log.
import crypto from 'crypto';
import { Knex } from 'knex';

const AI_KEY = 'ai_api_key';

export async function ensureSettingsSchema(db: Knex): Promise<void> {
  if (await db.schema.hasTable('assistant_settings')) return;
  await db.schema.createTable('assistant_settings', (t) => {
    t.string('name', 60).primary();
    t.text('value').notNullable();          // encrypted: iv.tag.ciphertext (base64)
    t.integer('updated_by').nullable();
    t.timestamp('updated_at').nullable();
  });
}

function cipherKey(): Buffer {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set, so settings cannot be stored securely');
  return crypto.createHash('sha256').update(`loop-assistant-settings:${secret}`).digest();
}

export function encryptSetting(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', cipherKey(), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

export function decryptSetting(stored: string): string | null {
  try {
    const [iv, tag, data] = stored.split('.').map((p) => Buffer.from(p, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', cipherKey(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(data), d.final()]).toString('utf8');
  } catch {
    return null;   // a changed JWT_SECRET or a damaged value: treated as not set
  }
}

// Plausible API key only: no spaces, a sensible length. The provider itself is the final check.
export function validAiKey(v: unknown): string | null {
  const k = typeof v === 'string' ? v.trim() : '';
  return /^[A-Za-z0-9_\-.]{20,300}$/.test(k) ? k : null;
}

export async function saveAiKey(db: Knex, key: string, actorId: number, now: Date = new Date()): Promise<void> {
  const value = encryptSetting(key);
  const row = { value, updated_by: actorId, updated_at: now };
  if (await db('assistant_settings').where({ name: AI_KEY }).first('name')) await db('assistant_settings').where({ name: AI_KEY }).update(row);
  else await db('assistant_settings').insert({ name: AI_KEY, ...row });
  await db('assistant_admin_audit').insert({ actor_id: actorId, action: 'ai_key_saved', target: 'assistant', detail: 'AI key saved from the dashboard (not shown)', created_at: now });
}

export async function loadAiKey(db: Knex): Promise<string | null> {
  const row = await db('assistant_settings').where({ name: AI_KEY }).first('value').catch(() => null);
  return row ? decryptSetting(String(row.value)) : null;
}
