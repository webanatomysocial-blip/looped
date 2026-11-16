// Starts the WhatsApp adapter once, keeps the single instance for status reads, and stops it cleanly on shutdown.
import fs from 'fs';
import { Knex } from 'knex';
import type { AIProvider } from '../ai';
import { WhatsAppAdapter, WaStatus, AdapterDeps, safeMessage } from './adapter';
import { WhatsAppConfig } from './config';
import { baileysSocketFactory } from './baileys';
import { processOutbox, enqueueAcceptanceReminders, enqueueDeadlineAlerts } from '../../services/assignmentNotices';
import { enqueueScheduledReports } from '../../services/productivityReports';
import { buildWhatsAppHandler, WhatsAppHandlerOptions } from './handler';

let current: WhatsAppAdapter | null = null;

// Writes the pairing payload exactly as Baileys produced it: no added newline (a stray byte makes the code invalid).
// Owner-only permissions. Each refresh replaces the previous code.
export function writeQrPayload(file: string, qr: string): void {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, qr, { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
}

const stopped: WaStatus = {
  enabled: false, state: 'stopped', account: null, lastConnectedAt: null, lastDisconnectedAt: null, reconnectAttempts: 0, qrPending: false,
};

// What the admin page may show: connection state only. Never the session, the pairing code or the file paths.
export async function listWhatsAppGroups(): Promise<{ name: string; jid: string }[]> {
  return current ? current.listGroups() : [];
}

export function getPairingCode(): { qr: string; issuedAt: string } | null {
  return current ? current.pairingCode() : null;
}
export function requestNewPairing(): boolean {
  return current ? current.requestNewPairing() : false;
}

export function getWhatsAppStatus(): WaStatus {
  return current ? current.status() : stopped;
}

export async function startWhatsApp(
  db: Knex, options: WhatsAppHandlerOptions, config: WhatsAppConfig, extra: Partial<AdapterDeps> = {},
): Promise<WhatsAppAdapter> {
  if (current) return current;
  // The pairing code is written only to the private file, with owner-only permissions
  const writeQr = config.qrFile ? (qr: string) => writeQrPayload(config.qrFile!, qr) : undefined;
  const clearQr = config.qrFile ? () => fs.rmSync(config.qrFile!, { force: true }) : undefined;
  const adapter = new WhatsAppAdapter({
    config, makeSocket: baileysSocketFactory, handle: buildWhatsAppHandler(db, options), writeQr, clearQr, ...extra,
  });
  current = adapter;
  await adapter.start();
  // Assignment notices: sent from the outbox to the configured group only, while connected
  const outbox = setInterval(() => {
    enqueueAcceptanceReminders(db)
      .then(() => enqueueDeadlineAlerts(db))
      .then(() => enqueueScheduledReports(db))
      .catch(() => console.error('[whatsapp-notice] reminder queue pass failed'))
      .finally(() => { processOutbox(db, adapter).catch(() => console.error('[whatsapp-notice] outbox pass failed')); });
  }, 10_000);
  outbox.unref?.();
  const shutdown = () => { adapter.stop().catch((e) => console.error('[whatsapp] stop failed:', safeMessage(e))).finally(() => process.exit(0)); };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  return adapter;
}
