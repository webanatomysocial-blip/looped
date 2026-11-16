// Background worker for the assistant: startup recovery, expiry, and (only when execution is enabled) the executor loop.
// Recovery never repeats an operation whose outcome is uncertain: an interrupted run is retried only when its handler
// is idempotent (every ticket change is recorded under its request id, so a repeat is refused as "already done").
import { Knex } from 'knex';
import { purgeExpiredContext } from './retention';
import { expireDue, recoverInterrupted } from './queue';
import { runNext, HandlerRegistry, safeError } from './executor';

export interface WorkerSettings {
  workerId: string;
  maxAttempts: number;
  leaseSeconds: number;
  contextTtlSeconds: number;
  executionEnabled: boolean;
}

export interface WorkerDeps {
  db: Knex;
  registry: HandlerRegistry;
  stillVerified: (loopUserId: number) => Promise<boolean>;
  settings: WorkerSettings;
  now?: () => number;
  log?: (level: 'info' | 'warn' | 'error', message: string) => void;
}

const defaultLog = (level: 'info' | 'warn' | 'error', message: string) => {
  (level === 'error' ? console.error : console.log)(`[assistant-worker] ${message}`);
};

// Runs once when the server starts: finishes what a stopped worker left behind.
export async function recoverOnStartup(d: WorkerDeps): Promise<{ expired: number; requeued: number; failed: number }> {
  const log = d.log ?? defaultLog;
  const now = d.now ? d.now() : Date.now();
  const expired = await expireDue(d.db, now, d.settings.contextTtlSeconds);
  const r = await recoverInterrupted(d.db, now, (intent) => d.registry.canRetry(intent), d.settings.maxAttempts);
  if (expired) log('info', `expired ${expired} request(s) past their time window (never executed)`);
  if (r.requeued) log('warn', `recovered ${r.requeued} interrupted request(s): safe to repeat, queued once more`);
  if (r.failed) log('error', `${r.failed} interrupted request(s) need review: not safe to repeat, marked FAILED`);
  return { expired, requeued: r.requeued, failed: r.failed };
}

// Runs in the background. Expiry always runs; execution runs only when the execution switch is on.
export function startWorker(d: WorkerDeps, intervalMs = 5000): { stop: () => void; tick: () => Promise<void> } {
  const log = d.log ?? defaultLog;
  let busy = false;
  let stopped = false;
  const tick = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      const now = d.now ? d.now() : Date.now();
      await expireDue(d.db, now, d.settings.contextTtlSeconds);
      if (d.settings.executionEnabled) {
        for (let i = 0; i < 20; i++) {
          const r = await runNext({
            db: d.db, registry: d.registry, workerId: d.settings.workerId, maxAttempts: d.settings.maxAttempts,
            leaseSeconds: d.settings.leaseSeconds, now: d.now, stillVerified: d.stillVerified, enabled: true,
          });
          if (r.outcome === 'idle') break;
          if (r.outcome === 'failed') log('error', `request ${r.requestId} failed (refused or retries used up); see the Failures tab`);
          if (r.outcome === 'retry_scheduled') log('warn', `request ${r.requestId} will be retried`);
        }
      }
    } catch (e) {
      log('error', `worker pass failed: ${safeError(e)}`);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => { void tick(); }, intervalMs);
  timer.unref?.();
  // Conversation text retention, hourly. A failure is logged and never stops the worker.
  const retention = setInterval(() => { purgeExpiredContext(d.db, Date.now()).catch(() => log("warn", "retention: purge failed")); }, 60 * 60 * 1000);
  retention.unref?.();
  return { stop: () => { stopped = true; clearInterval(timer); clearInterval(retention); }, tick };
}
