// The WhatsApp login (Baileys credentials and signal keys) stored in the database instead of files.
// On hosting where deploys replace the app folder (cPanel), session files were wiped on every deploy and WhatsApp had
// to be paired again. The database is never touched by a deploy and is shared by every copy of the server.
// Every value is encrypted (AES-256-GCM, key derived from JWT_SECRET) and never leaves the server.
import fs from 'fs';
import path from 'path';
import { Knex } from 'knex';
import { encryptSetting, decryptSetting } from '../settingsStore';

const T = 'assistant_wa_auth';

export async function ensureWaAuthSchema(db: Knex): Promise<void> {
  if (await db.schema.hasTable(T)) return;
  await db.schema.createTable(T, (t) => {
    t.string('auth_key', 255).primary();
    t.text('value', 'longtext').notNullable();
    t.timestamp('updated_at').nullable();
  });
}

async function write(db: Knex, key: string, plainJson: string): Promise<void> {
  const row = { value: encryptSetting(plainJson), updated_at: new Date() };
  const changed = await db(T).where({ auth_key: key }).update(row);
  if (changed) return;
  try { await db(T).insert({ auth_key: key, ...row }); }
  catch { await db(T).where({ auth_key: key }).update(row); }   // inserted meanwhile by a parallel write
}

async function read(db: Knex, key: string): Promise<string | null> {
  const row = await db(T).where({ auth_key: key }).first('value');
  return row ? decryptSetting(String(row.value)) : null;
}

export async function hasDatabaseLogin(db: Knex): Promise<boolean> {
  return !!(await db(T).where({ auth_key: 'creds' }).first('auth_key').catch(() => null));
}

// One-time move of an existing file session into the database, so a working pairing is kept. The files are left as they are.
export async function importFileSession(db: Knex, folder: string | null): Promise<number> {
  if (!folder || (await hasDatabaseLogin(db))) return 0;
  let files: string[] = [];
  try { files = fs.readdirSync(folder).filter((f) => f.endsWith('.json')); } catch { return 0; }
  if (!files.includes('creds.json')) return 0;
  let n = 0;
  for (const f of files) {
    // useMultiFileAuthState names: creds.json, <type>-<id>.json with "/" stored as "__" and ":" as "-"
    const key = f === 'creds.json' ? 'creds' : f.slice(0, -5);
    try { await write(db, key, fs.readFileSync(path.join(folder, f), 'utf8')); n++; } catch { /* skip an unreadable file */ }
  }
  return n;
}

// Moves the current login aside (kept, not deleted) after WhatsApp ended it, so the next connection starts a new pairing
export async function archiveDatabaseLogin(db: Knex, now: Date = new Date()): Promise<string> {
  const tag = `archived-${now.toISOString().replace(/[:.]/g, '-')}:`;
  const rows = await db(T).whereNot('auth_key', 'like', 'archived-%').select('auth_key');
  for (const r of rows) await db(T).where({ auth_key: r.auth_key }).update({ auth_key: (tag + r.auth_key).slice(0, 255) }).catch(() => db(T).where({ auth_key: r.auth_key }).del());
  return tag.slice(0, -1);
}

// Same shape as Baileys' useMultiFileAuthState, backed by the database
export async function useDatabaseAuthState(db: Knex, baileys: any) {
  const { BufferJSON, initAuthCreds, proto } = baileys;
  const fixKey = (k: string) => k.replace(/\//g, '__').replace(/:/g, '-');   // same names as the file store
  const readData = async (key: string) => { const plain = await read(db, fixKey(key)); return plain ? JSON.parse(plain, BufferJSON.reviver) : null; };
  const writeData = (key: string, data: unknown) => write(db, fixKey(key), JSON.stringify(data, BufferJSON.replacer));
  const removeData = (key: string) => db(T).where({ auth_key: fixKey(key) }).del();
  const creds = (await readData('creds')) || initAuthCreds();
  return {
    state: {
      creds,
      keys: {
        get: async (type: string, ids: string[]) => {
          const data: Record<string, unknown> = {};
          await Promise.all(ids.map(async (id) => {
            let value = await readData(`${type}-${id}`);
            if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
            data[id] = value;
          }));
          return data;
        },
        set: async (data: Record<string, Record<string, unknown>>) => {
          const tasks: Promise<unknown>[] = [];
          for (const category of Object.keys(data)) {
            for (const id of Object.keys(data[category])) {
              const value = data[category][id];
              tasks.push(value ? writeData(`${category}-${id}`, value) : removeData(`${category}-${id}`));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => writeData('creds', creds),
  };
}
