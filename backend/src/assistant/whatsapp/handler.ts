// Turns a WhatsApp message into the assistant's answer. Private chats go through the existing pipeline (identity,
// dedupe, engine, confirmation, queue). Group chats get a short note to ask in a private chat; nothing is read or changed.
import { Knex } from 'knex';
import { IncomingMessage, OutgoingResponse, Channel } from '../types';
import { processMessage } from '../pipeline';
import { DbRequestStore, DbAuditLog } from '../conversationStore';
import { DbIdentityResolver, createLinkHandler } from '../identityStore';
import { RequestEngine } from '../engine';
import { recordPendingSender } from '../pendingSenders';
import { EXPOSED_INTENTS } from '../actions';
import { searchTickets, viewTicket, listMyTasks } from '../../services/ticketReads';
import type { AIProvider } from '../ai';
import { answerForGroup } from '../../services/productivityAssistant';
import { msg as waMsg } from '../../services/waMessage';

export interface WhatsAppHandlerOptions {
  ai: AIProvider;
  timezone: string;
  contextTtlSeconds: number;
  confirmationTtlSeconds: number;
  queueExpirySeconds: number;
  executionEnabled: boolean;
}

export function buildWhatsAppHandler(db: Knex, o: WhatsAppHandlerOptions) {
  const engine = new RequestEngine({
    db, ai: o.ai, timezone: o.timezone, contextTtlSeconds: o.contextTtlSeconds,
    confirmationTtlSeconds: o.confirmationTtlSeconds, queueExpirySeconds: o.queueExpirySeconds,
    exposedIntents: EXPOSED_INTENTS, executionEnabled: o.executionEnabled,
    reader: {
      search: (actor, text) => searchTickets(db, actor as any, text) as any,
      view: (actor, id) => viewTicket(db, actor as any, id) as any,
      mine: (actor) => listMyTasks(db, actor as any) as any,
    },
  });
  const identity = new DbIdentityResolver(db);
  // A private message that is a link code (LINK <code>) is verified here; anything else goes on to the assistant
  const linker = createLinkHandler(db);
  return async (msg: IncomingMessage): Promise<OutgoingResponse | null> => {
    if (msg.channel !== 'whatsapp') return null;
    // A person linked by phone number writes from an internal WhatsApp id: when that id is not linked, use the phone
    // number WhatsApp's server reported with the message, if that number is linked
    if (msg.senderPhoneId && msg.senderId !== msg.senderPhoneId) {
      const byId = await identity.resolve(msg.channel, msg.senderId);
      if (byId.status !== 'verified' && (await identity.resolve(msg.channel, msg.senderPhoneId)).status === 'verified') {
        msg = { ...msg, senderId: msg.senderPhoneId };
      }
    }
    if (msg.isGroup !== false) {
      // Groups: only linked Loop staff get a reply. Anyone else gets nothing at all.
      const groupWho = await identity.resolve(msg.channel, msg.senderId);
      if (groupWho.status !== 'verified') return null;
      // The group is for reports, new tickets and escalations. Questions are answered in a private chat, so one
      // person's tasks are never shown to everyone.
      const user = await db('users').where({ id: groupWho.loopUserId }).first('name').catch(() => null);
      const greet = /^(hi+|hello|hey|good (morning|afternoon|evening))[\s!.,]*$/i.test(msg.text.replace(/@\S+/g, ' ').trim());
      return { channel: 'whatsapp' as Channel, conversationId: msg.conversationId, text: waMsg.askInPrivate(String(user?.name ?? ''), greet) };
    }
    // Private chat. Managers and admins can also ask about their team (hours, workload, summary); their own tasks,
    // task details and search go to the personal assistant like everyone else's.
    const who = await identity.resolve(msg.channel, msg.senderId);
    const personal = /\b(my|mine|me|i)\b|\bdetails?\b|^find\b|^(hi+|hello|hey|help|menu|good (morning|afternoon|evening))\b|^link\b/i;
    if (who.status === 'verified' && (who.role === 'manager' || who.role === 'admin') && !personal.test(msg.text.trim())) {
      const answer = await answerForGroup(db, o.ai, { userId: who.loopUserId, role: who.role, text: msg.text }).catch(() => null);
      if (answer && answer.text !== waMsg.unknown()) return { channel: 'whatsapp' as Channel, conversationId: msg.conversationId, text: answer.text, mentions: [], tags: [] };
    }
    if (msg.senderId.startsWith('lid:')) await recordPendingSender(db, msg.senderId).catch(() => undefined);
    const out: any = await processMessage(msg, {
      identity, classifier: undefined as any, store: new DbRequestStore(db), audit: new DbAuditLog(db), engine: engine as any, linker,
    });
    return out.kind === 'responded' ? out.response : null;
  };
}
