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
    logger: pino({ level: 'silent' }),          // no library logging: it can include message content
    printQRInTerminal: false,                    // pairing codes go to the private file only
    browser: ['Loop Assistant', 'Desktop', '1.0'],
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });
  return { socket, saveCreds: secureSessionSaver(sessionDir, saveCreds) };
};
