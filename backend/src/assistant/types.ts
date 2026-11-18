// Channel-independent contracts for the Loop AI assistant. No channel or AI-provider code may live here.

export type Channel = 'simulator' | 'whatsapp';
export const CHANNELS: readonly Channel[] = ['simulator', 'whatsapp'];

export interface Attachment {
  kind: 'image' | 'document' | 'audio' | 'video' | 'other';
  mimeType?: string;
  fileName?: string;
  sizeBytes?: number;
  providerRef?: string; // channel-specific handle; never fetched by the core
}

export interface IncomingMessage {
  channel: Channel;
  senderId: string;        // channel-native sender identity, as asserted by the adapter (NOT a Loop user id)
  conversationId: string;  // group / chat id on that channel
  messageId: string;       // channel message id, used for duplicate protection
  text: string;
  replyToMessageId?: string;
  timestamp: string;       // ISO 8601
  // WhatsApp only: true for a group chat. Missing means a group (fails closed). Simulator ignores it.
  isGroup?: boolean;
  // WhatsApp groups: the numbers mentioned in the message (used for the mention-only rule)
  mentioned?: string[];
  // WhatsApp only: for a sender known by its internal id (lid), the phone number WhatsApp's own server reported with the
  // message (participant_pn / sender_pn), as "+digits". Never taken from the message text.
  senderPhoneId?: string;
  attachments?: Attachment[];
}

export interface OutgoingResponse {
  channel: Channel;
  conversationId: string;
  replyToMessageId?: string;
  text: string;
  // WhatsApp mentions (JIDs of linked people named in the text), so they are notified
  mentions?: string[];
  // A table drawn as an image; the text is sent as its caption
  card?: import('../services/reportCard').Card;
  requestId?: string;
  awaitingConfirmation?: boolean;
}

export const MAX_TEXT_LENGTH = 4000;

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const nonEmpty = (v: unknown) => typeof v === 'string' && v.trim().length > 0;

export function validateIncomingMessage(input: unknown): ValidationResult<IncomingMessage> {
  const errors: string[] = [];
  const m = input as Record<string, unknown> | null;
  if (!m || typeof m !== 'object') return { ok: false, errors: ['message must be an object'] };
  if (!CHANNELS.includes(m.channel as Channel)) errors.push('channel is invalid');
  for (const k of ['senderId', 'conversationId', 'messageId'] as const) if (!nonEmpty(m[k])) errors.push(`${k} is required`);
  if (typeof m.text !== 'string') errors.push('text must be a string');
  else if (m.text.length > MAX_TEXT_LENGTH) errors.push(`text exceeds ${MAX_TEXT_LENGTH} characters`);
  if (m.replyToMessageId !== undefined && !nonEmpty(m.replyToMessageId)) errors.push('replyToMessageId must be a non-empty string');
  if (m.isGroup !== undefined && typeof m.isGroup !== 'boolean') errors.push('isGroup must be true or false');
  if (!nonEmpty(m.timestamp) || Number.isNaN(Date.parse(m.timestamp as string))) errors.push('timestamp must be ISO 8601');
  if (m.attachments !== undefined) {
    if (!Array.isArray(m.attachments)) errors.push('attachments must be an array');
    else if (m.attachments.some((a: any) => !a || !['image', 'document', 'audio', 'video', 'other'].includes(a.kind))) errors.push('attachment kind is invalid');
  }
  if (typeof m.text === 'string' && !m.text.trim() && !(Array.isArray(m.attachments) && m.attachments.length)) errors.push('message has no text or attachments');
  return errors.length ? { ok: false, errors } : { ok: true, value: m as unknown as IncomingMessage };
}

export function validateOutgoingResponse(input: unknown): ValidationResult<OutgoingResponse> {
  const errors: string[] = [];
  const r = input as Record<string, unknown> | null;
  if (!r || typeof r !== 'object') return { ok: false, errors: ['response must be an object'] };
  if (!CHANNELS.includes(r.channel as Channel)) errors.push('channel is invalid');
  if (!nonEmpty(r.conversationId)) errors.push('conversationId is required');
  if (!nonEmpty(r.text)) errors.push('text is required');
  else if ((r.text as string).length > MAX_TEXT_LENGTH) errors.push(`text exceeds ${MAX_TEXT_LENGTH} characters`);
  return errors.length ? { ok: false, errors } : { ok: true, value: r as unknown as OutgoingResponse };
}

// ── Request / conversation data model (persisted in Phase 4; contracts only now) ──

export type RequestStatus =
  | 'received' | 'identity_failed' | 'identity_ignored' | 'understanding' | 'needs_info' | 'awaiting_confirmation'
  | 'queued' | 'executing' | 'completed' | 'failed' | 'rejected' | 'cancelled';
export type ConfirmationStatus = 'not_required' | 'pending' | 'confirmed' | 'declined' | 'expired';
// Assistant queue priority — deliberately unrelated to a Loop task's `priority` column.
export type RequestPriority = 'interactive' | 'normal' | 'background';

export interface Entities { [key: string]: string | number | boolean | null | string[] }

export interface ActionStep {
  stepId: string;
  action: string;          // e.g. 'tasks.create' — mapped to an existing Loop API in Phase 3+
  params: Entities;
  status: 'pending' | 'succeeded' | 'failed' | 'skipped';
  result?: unknown;
  error?: string;
}

export interface AssistantRequest {
  requestId: string;
  conversationKey: string; // see conversationKey(); scopes context to ONE employee
  loopUserId: number;
  channel: Channel;
  conversationId: string;
  messageId: string;
  intent?: string;
  entities: Entities;
  priority: RequestPriority;
  status: RequestStatus;
  confirmation: ConfirmationStatus;
  steps: ActionStep[];     // one request may fan out into several backend actions
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEvent {
  requestId: string;
  at: string;
  stage: string;
  detail?: string;
}

// Context is per (channel, group, employee): two people in the same WhatsApp group never share state.
export function conversationKey(channel: Channel, conversationId: string, loopUserId: number): string {
  return `${channel}:${conversationId}:${loopUserId}`;
}
