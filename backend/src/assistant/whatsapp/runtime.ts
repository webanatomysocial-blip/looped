// Starts the WhatsApp adapter once, keeps the single instance for status reads, and stops it cleanly on shutdown.
import fs from 'fs';
import { Knex } from 'knex';
import type { AIProvider } from '../ai';
import { WhatsAppAdapter, WaStatus, AdapterDeps, safeMessage } from './adapter';
import { WhatsAppConfig } from './config';
import { databaseSocketFactory } from './baileys';
import { archiveDatabaseLogin } from './dbAuthState';
import { processOutbox, enqueueAcceptanceReminders, enqueueDeadlineAlerts } from '../../services/assignmentNotices';
import { enqueueScheduledReports } from '../../services/productivityReports';
import { buildWhatsAppHandler, WhatsAppHandlerOptions } from './handler';
import { claimOwner, releaseOwner, publishState, readState } from './shared';
import { recordWaEvent } from './activity';

let current: WhatsAppAdapter | null = null;          // set only in the copy that owns the connection
let standby: ReturnType<typeof setInterval> | null = null;   // set in copies waiting to take over
let sharedDb: Knex | null = null;
let groupsCache: { at: number; groups: { name: string; jid: string }[] } | null = null;

// True when this copy has started WhatsApp (as the owner, or waiting to take over)
export function startedHere(): boolean { return !!current || !!standby; }

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

// What the admin page may show: connection state only. Never the session or the file paths. A copy that does not own the
// connection reads what the owner published, so every copy shows the same status.
export async function listWhatsAppGroups(): Promise<{ name: string; jid: string }[]> {
  if (current) return current.listGroups();
  return sharedDb ? ((await readState(sharedDb).catch(() => null))?.groups ?? []) : [];
}

export async function getPairingCode(): Promise<{ qr: string; issuedAt: string } | null> {
  if (current) return current.pairingCode();
  return sharedDb ? ((await readState(sharedDb).catch(() => null))?.qr ?? null) : null;
}
export function requestNewPairing(): boolean {
  return current ? current.requestNewPairing() : false;
}

export async function getWhatsAppStatus(): Promise<WaStatus> {
  if (current) return current.status();
  const shared = sharedDb ? await readState(sharedDb).catch(() => null) : null;
  if (shared?.status) return shared.status as unknown as WaStatus;
  // Waiting to take over (e.g. just after a deploy): show it as reconnecting, not as lost
  return standby ? { ...stopped, enabled: true, state: 'reconnecting' } : stopped;
}

export async function startWhatsApp(
  db: Knex, options: WhatsAppHandlerOptions, config: WhatsAppConfig, extra: Partial<AdapterDeps> = {},
): Promise<WhatsAppAdapter | null> {
  if (current || standby) return current;
  sharedDb = db;
  if (await claimOwner(db).catch(() => false)) return own(db, options, config, extra);
  waitToTakeOver(db, options, config, extra);
  return null;
}

// Another copy owns the connection: check every 20 seconds and take over (same saved login, no new QR) if it stopped
function waitToTakeOver(db: Knex, options: WhatsAppHandlerOptions, config: WhatsAppConfig, extra: Partial<AdapterDeps>): void {
  if (standby) return;
  console.log('[whatsapp] another copy of the server owns the WhatsApp connection; this copy is on standby');
  standby = setInterval(() => {
    claimOwner(db).then(async (won) => {
      if (!won || !standby) return;
      clearInterval(standby); standby = null;
      await own(db, options, config, extra).catch((e) => console.error('[whatsapp] take-over failed:', safeMessage(e)));
    }).catch(() => undefined);
  }, 10_000);
  standby.unref?.();
}

export function keepAwakeUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.NODE_ENV !== 'production') return null;
  const url = (env.FRONTEND_URL || '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^\s/]+/.test(url) ? url : null;
}

let shutdownHooked = false;
async function own(db: Knex, options: WhatsAppHandlerOptions, config: WhatsAppConfig, extra: Partial<AdapterDeps>): Promise<WhatsAppAdapter> {
  console.log('[whatsapp] this copy owns the WhatsApp connection');
  // The pairing code is written only to the private file, with owner-only permissions
  const writeQr = config.qrFile ? (qr: string) => writeQrPayload(config.qrFile!, qr) : undefined;
  const clearQr = config.qrFile ? () => fs.rmSync(config.qrFile!, { force: true }) : undefined;
  const adapter = new WhatsAppAdapter({
    config, makeSocket: databaseSocketFactory(db), handle: buildWhatsAppHandler(db, options), writeQr, clearQr,
    // The login lives in the database: when WhatsApp ends it, it is moved aside there (kept, not deleted)
    archiveSession: () => archiveDatabaseLogin(db),
    onEvent: (e) => { recordWaEvent(db, e).catch(() => undefined); },
    ...extra,
  });
  current = adapter;
  await adapter.start();
  // Assignment notices: sent from the outbox to the configured group only, while connected (owner only, so never twice)
  const outbox = setInterval(() => {
    enqueueAcceptanceReminders(db)
      .then(() => enqueueDeadlineAlerts(db))
      .then(() => enqueueScheduledReports(db))
      .catch(() => console.error('[whatsapp-notice] reminder queue pass failed'))
      .finally(() => { processOutbox(db, adapter).catch(() => console.error('[whatsapp-notice] outbox pass failed')); });
  }, 10_000);
  outbox.unref?.();
  // Every 10 seconds: keep ownership and publish the status (and QR) for the other copies' dashboards
  const publish = async () => {
    if (adapter.status().state === 'connected' && (!groupsCache || Date.now() - groupsCache.at > 600_000)) {
      groupsCache = { at: Date.now(), groups: await adapter.listGroups().catch(() => groupsCache?.groups ?? []) };
    }
    await publishState(db, { status: adapter.status() as any, qr: adapter.pairingCode(), groups: groupsCache?.groups ?? null });
  };
  await publish().catch(() => undefined);
  // Hosting such as cPanel puts an app to sleep when the site has no visitors, which would drop WhatsApp and miss the
  // daily reports. A visit to our own health page every 4 minutes keeps it awake. Live server only; harmless elsewhere.
  const site = keepAwakeUrl();
  const awake = site ? setInterval(() => { fetch(`${site}/health`, { signal: AbortSignal.timeout(10_000) }).catch(() => undefined); }, 240_000) : null;
  awake?.unref?.();
  const tick = setInterval(() => {
    claimOwner(db).then(async (still) => {
      if (still) { await publish(); return; }
      // Another copy took over (this one was paused too long): step down so there is only one connection
      clearInterval(tick); clearInterval(outbox); if (awake) clearInterval(awake);
      if (current === adapter) current = null;
      await adapter.stop().catch(() => undefined);
      console.warn('[whatsapp] another copy took over the WhatsApp connection; this copy stepped down');
      waitToTakeOver(db, options, config, extra);
    }).catch(() => undefined);
  }, 10_000);
  tick.unref?.();
  if (!shutdownHooked) {
    shutdownHooked = true;
    const shutdown = () => {
      const a = current;
      Promise.resolve(a ? a.stop() : undefined).catch((e) => console.error('[whatsapp] stop failed:', safeMessage(e)))
        .then(() => releaseOwner(db)).finally(() => process.exit(0));
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  }
  return adapter;
}
