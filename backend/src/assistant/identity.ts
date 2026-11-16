// External sender → verified Loop employee. The ONLY input is the adapter-asserted (channel, senderId) pair;
// message text, display names and AI output are never consulted.
import { Channel } from './types';

export type IdentityResult =
  | { status: 'verified'; loopUserId: number; role: string }
  | { status: 'unknown' }      // no verified mapping for this sender
  | { status: 'disabled' };    // mapping exists but is revoked / user deactivated

export interface IdentityResolver {
  resolve(channel: Channel, senderId: string): Promise<IdentityResult>;
}

// Phase 1 default: nobody is verified. Phase 2 replaces this with a table-backed resolver.
export class DenyAllIdentityResolver implements IdentityResolver {
  async resolve(): Promise<IdentityResult> { return { status: 'unknown' }; }
}

// Test/simulator helper: an explicit, pre-verified allow-list keyed by channel+senderId.
export class StaticIdentityResolver implements IdentityResolver {
  constructor(private readonly map: Record<string, { loopUserId: number; role: string }>) {}
  async resolve(channel: Channel, senderId: string): Promise<IdentityResult> {
    const hit = this.map[`${channel}:${senderId}`];
    return hit ? { status: 'verified', ...hit } : { status: 'unknown' };
  }
}
