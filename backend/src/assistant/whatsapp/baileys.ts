// The real WhatsApp connection (Baileys). Loaded only when WhatsApp is enabled. Session files are kept private.
import fs from 'fs';
import path from 'path';
import type { SocketFactory } from './adapter';
import { applyRestrictiveUmask, enforceSessionPermissions } from './session-perms';

// Session files hold keys: after every save they are owner-only, and so is the folder
// Every save is followed by a permission pass over the folder (new files included)
export function secureSessionSaver(sessionDir: string, saveCreds: () => Promise<void> | void) {
  return async () => {
    await saveCreds();
    enforceSessionPermissions(sessionDir);
  };
}

export const baileysSocketFactory: SocketFactory = async (sessionDir) => {
  const baileys: any = await import('@whiskeysockets/baileys');
  const pino: any = (await import('pino')).default;
  applyRestrictiveUmask();                       // before the library creates any session file
  fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
  enforceSessionPermissions(sessionDir);          // existing files too, contents untouched
  const { state, saveCreds } = await baileys.useMultiFileAuthState(sessionDir);
  const make = baileys.default ?? baileys.makeWASocket;
  const socket = make({
    auth: state,
    version: await currentWaVersion(baileys),
    logger: pino({ level: 'silent' }),          // no library logging: it can include message content
    printQRInTerminal: false,                    // pairing codes go to the private file only
    browser: ['Loop Assistant', 'Desktop', '1.0'],
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });
  return { socket, saveCreds: secureSessionSaver(sessionDir, saveCreds) };
};

// The live setup: the login is kept in the database (encrypted), so deploys cannot wipe it and every copy shares it.
// An existing file session is imported once, so a working pairing is not lost.
export const databaseSocketFactory = (db: import('knex').Knex): SocketFactory => async (sessionDir) => {
  const baileys: any = await import('@whiskeysockets/baileys');
  const pino: any = (await import('pino')).default;
  const { useDatabaseAuthState, importFileSession } = await import('./dbAuthState');
  const imported = await importFileSession(db, sessionDir).catch(() => 0);
  if (imported) console.log(`[whatsapp] moved the saved WhatsApp login into the database (${imported} items)`);
  const { state, saveCreds } = await useDatabaseAuthState(db, baileys);
  const make = baileys.default ?? baileys.makeWASocket;
  const socket = make({
    auth: state,
    version: await currentWaVersion(baileys),
    logger: pino({ level: 'silent' }),          // no library logging: it can include message content
    printQRInTerminal: false,
    browser: ['Loop Assistant', 'Desktop', '1.0'],
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });
  return { socket, saveCreds };
};

// WhatsApp refuses an outdated web version: the phone says "Couldn't log in" and the server keeps reconnecting (405).
// Ask WhatsApp for the current version on each connect; fall back to the library's own if that check fails.
async function currentWaVersion(baileys: any): Promise<number[] | undefined> {
  try { const r = await baileys.fetchLatestWaWebVersion({ timeout: 10_000 }); return r?.version; } catch { return undefined; }
}
