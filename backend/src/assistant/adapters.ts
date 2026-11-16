// Communication adapters translate a channel's native payloads to/from the standard contracts.
// The core engine only ever sees IncomingMessage / OutgoingResponse.
import { Channel, IncomingMessage, OutgoingResponse, validateIncomingMessage, validateOutgoingResponse } from './types';

export interface ChannelAdapter {
  readonly channel: Channel;
  // Returns null for payloads that are not addressed to the assistant (e.g. group chatter without a mention).
  toIncoming(raw: unknown): IncomingMessage | null;
  send(response: OutgoingResponse): Promise<void>;
}

export class AdapterError extends Error {
  constructor(message: string, public readonly errors: string[] = []) { super(message); this.name = 'AdapterError'; }
}

// In-process simulator for development. The simulator's sender is the logged-in Loop user, supplied by the
// server route from req.user — never from the request body (wired up in a later phase).
export class SimulatorAdapter implements ChannelAdapter {
  readonly channel = 'simulator' as const;
  readonly outbox: OutgoingResponse[] = [];

  toIncoming(raw: unknown): IncomingMessage {
    const r = (raw ?? {}) as Record<string, any>;
    const msg = {
      channel: this.channel,
      senderId: r.senderId,
      conversationId: r.conversationId,
      messageId: r.messageId,
      text: r.text,
      replyToMessageId: r.replyToMessageId,
      timestamp: r.timestamp ?? new Date().toISOString(),
      attachments: r.attachments,
    };
    const v = validateIncomingMessage(msg);
    if (!v.ok) throw new AdapterError('Invalid simulator message', v.errors);
    return v.value;
  }

  async send(response: OutgoingResponse): Promise<void> {
    const v = validateOutgoingResponse(response);
    if (!v.ok) throw new AdapterError('Invalid outgoing response', v.errors);
    if (v.value.channel !== this.channel) throw new AdapterError(`Simulator cannot send on channel "${v.value.channel}"`);
    this.outbox.push(v.value);
  }
}
