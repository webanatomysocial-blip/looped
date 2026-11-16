// Request-processing pipeline. Every stage is an injected interface, so channels, AI providers, storage and
// execution can each be swapped without touching this file.
//
// Stages: 1 receive → 2 identity → 3 conversation → 4 intent → 5 entities → 6 validate → 7 permissions
//         → 8 prepare → 9 confirm → 10 execute (existing Loop APIs only) → 11 record → 12 respond
// Phase 1 implements 1–4 and 11–12. Stages 5–10 are interfaces only and are never reached.
import { randomUUID } from 'crypto';
import { IdentityResolver } from './identity';
import { IntentClassifier, Intent, AIError } from './ai';
import {
  ActionStep, AssistantRequest, AuditEvent, Entities, IncomingMessage, OutgoingResponse,
  conversationKey, validateIncomingMessage,
} from './types';

export interface RequestStore {
  // Must be atomic on (channel, messageId): returns false if this message was already seen.
  claimMessage(channel: string, messageId: string): Promise<boolean>;
  save(req: AssistantRequest): Promise<void>;
}

export interface AuditLog { append(e: AuditEvent): Promise<void> }

// Phase 3+: decide using the Loop user's real role/scope, never the AI's claims.
export interface PermissionChecker {
  check(loopUserId: number, intent: Intent, entities: Entities): Promise<{ allowed: boolean; reason?: string }>;
}

// Phase 3+: each action calls an existing Loop service/route handler as the verified user.
export interface ActionExecutor {
  execute(loopUserId: number, step: ActionStep): Promise<ActionStep>;
}

export class InMemoryRequestStore implements RequestStore {
  private seen = new Set<string>();
  readonly requests = new Map<string, AssistantRequest>();
  async claimMessage(channel: string, messageId: string) {
    const k = `${channel}:${messageId}`;
    if (this.seen.has(k)) return false;
    this.seen.add(k);
    return true;
  }
  async save(req: AssistantRequest) { this.requests.set(req.requestId, structuredClone(req)); }
}

export class InMemoryAuditLog implements AuditLog {
  readonly events: AuditEvent[] = [];
  async append(e: AuditEvent) { this.events.push(e); }
}

// Handles "LINK <code>" from not-yet-verified senders. Returns reply text, or null if the message isn't a link attempt.
export type LinkHandler = (msg: IncomingMessage) => Promise<string | null>;

export interface PipelineDeps {
  identity: IdentityResolver;
  classifier: IntentClassifier;
  store: RequestStore;
  audit: AuditLog;
  linker?: LinkHandler;
  // Phase 3: when present, verified messages go through the request engine instead of the Phase 1 intent stub
  engine?: { handle(msg: IncomingMessage, who: { id: number; role: string }): Promise<{ reply: string; requestId: string | null; status: string }> };
}

export type PipelineOutcome =
  | { kind: 'invalid'; errors: string[] }
  | { kind: 'duplicate' }
  | { kind: 'responded'; request?: AssistantRequest; response: OutgoingResponse }
  | { kind: 'ignored' };

const reply = (m: IncomingMessage, text: string, requestId?: string): OutgoingResponse =>
  ({ channel: m.channel, conversationId: m.conversationId, replyToMessageId: m.messageId, text, requestId });

export async function processMessage(raw: unknown, deps: PipelineDeps): Promise<PipelineOutcome> {
  // 1. Receive
  const v = validateIncomingMessage(raw);
  if (!v.ok) return { kind: 'invalid', errors: v.errors };
  const msg = v.value;
  if (!(await deps.store.claimMessage(msg.channel, msg.messageId))) return { kind: 'duplicate' };

  const requestId = randomUUID();
  const audit = (stage: string, detail?: string) => deps.audit.append({ requestId, at: new Date().toISOString(), stage, detail });
  await audit('received', `${msg.channel}:${msg.conversationId}:${msg.messageId}`);

  // 2. Identity — from (channel, senderId) only
  const who = await deps.identity.resolve(msg.channel, msg.senderId);
  if (who.status !== 'verified') {
    // Unknown, unlinked, pending, revoked, expired, deleted or inactive: silence. No reply, no AI call, no request or draft.
    // A LINK code is still verified, silently. The result shows only in Loop and in the admin view.
    if (deps.linker) await deps.linker(msg).catch(() => null);
    await audit('identity_ignored', who.status);
    return { kind: 'ignored' };
  }

  if (deps.engine) {
    const r = await deps.engine.handle(msg, { id: who.loopUserId, role: who.role });
    await audit('engine', r.status);
    return { kind: 'responded', response: reply(msg, r.reply, r.requestId ?? requestId) };
  }

  // 3. Conversation — context is scoped to this employee within this group
  const now = new Date().toISOString();
  const request: AssistantRequest = {
    requestId,
    conversationKey: conversationKey(msg.channel, msg.conversationId, who.loopUserId),
    loopUserId: who.loopUserId,
    channel: msg.channel,
    conversationId: msg.conversationId,
    messageId: msg.messageId,
    entities: {},
    priority: 'interactive',
    status: 'understanding',
    confirmation: 'not_required',
    steps: [],
    createdAt: now,
    updatedAt: now,
  };
  await deps.store.save(request);

  // 4. Intent
  try {
    const r = await deps.classifier.classify(msg.text);
    request.intent = r.intent;
    request.entities = r.entities;
    await audit('intent', `${r.intent} (${r.confidence})`);
  } catch (e) {
    request.status = 'failed';
    request.error = e instanceof AIError ? `${e.code}: ${e.message}` : 'unexpected error';
    request.updatedAt = new Date().toISOString();
    await deps.store.save(request);
    await audit('failed', request.error);
    return { kind: 'responded', request, response: reply(msg, "Sorry, I couldn't follow that. Please try again in a moment.", requestId) };
  }

  // 5–10 are not available in Phase 1: stop here without touching any Loop data.
  request.status = 'rejected';
  request.error = 'actions_not_enabled';
  request.updatedAt = new Date().toISOString();
  await deps.store.save(request);
  await audit('stopped', 'actions_not_enabled');
  return { kind: 'responded', request, response: reply(msg, "Got it. I can't act on that yet.", requestId) };
}
