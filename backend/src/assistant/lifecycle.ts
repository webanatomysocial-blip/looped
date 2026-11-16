// Phase 4 request lifecycle. Every state change in the system is checked against this table.
export const STATES = [
  'RECEIVED', 'UNDERSTOOD', 'NEEDS_CLARIFICATION', 'READY_FOR_CONFIRMATION', 'CONFIRMED', 'QUEUED',
  'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED', 'REJECTED',
] as const;
export type RequestState = typeof STATES[number];

const TRANSITIONS: Record<RequestState, RequestState[]> = {
  RECEIVED: ['UNDERSTOOD', 'NEEDS_CLARIFICATION', 'REJECTED'],
  UNDERSTOOD: ['NEEDS_CLARIFICATION', 'READY_FOR_CONFIRMATION', 'REJECTED'],
  NEEDS_CLARIFICATION: ['NEEDS_CLARIFICATION', 'READY_FOR_CONFIRMATION', 'CANCELLED', 'EXPIRED'],
  READY_FOR_CONFIRMATION: ['CONFIRMED', 'CANCELLED', 'EXPIRED', 'NEEDS_CLARIFICATION'],
  CONFIRMED: ['QUEUED', 'CANCELLED'],
  QUEUED: ['PROCESSING', 'CANCELLED', 'EXPIRED'],
  PROCESSING: ['COMPLETED', 'FAILED', 'QUEUED'],   // QUEUED = scheduled retry or recovered
  FAILED: ['QUEUED'],                             // admin retry, only when the executor confirms it is safe
  COMPLETED: [], CANCELLED: [], EXPIRED: [], REJECTED: [],
};

export const TERMINAL: readonly RequestState[] = ['COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED', 'REJECTED'];
export const OPEN_FOR_CLARIFICATION: readonly RequestState[] = ['NEEDS_CLARIFICATION'];
export const PENDING_CONFIRMATION: readonly RequestState[] = ['READY_FOR_CONFIRMATION'];

export class InvalidTransition extends Error {
  constructor(public readonly from: string, public readonly to: string) {
    super(`Invalid request transition ${from} -> ${to}`);
    this.name = 'InvalidTransition';
  }
}

export function canTransition(from: string, to: string): boolean {
  return (TRANSITIONS as Record<string, string[]>)[from]?.includes(to) ?? false;
}

export function assertTransition(from: string, to: string): void {
  if (!canTransition(from, to)) throw new InvalidTransition(from, to);
}

export const isTerminal = (s: string) => (TERMINAL as readonly string[]).includes(s);

// Phase 3 wrote lowercase statuses; this maps them onto the lifecycle once, at startup.
export const LEGACY_STATUS: Record<string, RequestState> = {
  awaiting_info: 'NEEDS_CLARIFICATION',
  ready: 'READY_FOR_CONFIRMATION',
  cancelled: 'CANCELLED',
  expired: 'EXPIRED',
  failed: 'FAILED',
};
