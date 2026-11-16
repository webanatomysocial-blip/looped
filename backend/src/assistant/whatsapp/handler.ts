// Turns a WhatsApp message into the assistant's answer. Private chats go through the existing pipeline (identity,
// dedupe, engine, confirmation, queue). Group chats get the fixed reply and nothing is read or changed.
import { Knex } from 'knex';
import { IncomingMessage, OutgoingResponse, Channel } from '../types';
import { processMessage } from '../pipeline';
import { DbRequestStore, DbAuditLog } from '../conversationStore';
import { DbIdentityResolver, createLinkHandler } from '../identityStore';
import { RequestEngine, GROUP_REPLY } from '../engine';
import { recordPendingSender } from '../pendingSenders';
import { EXPOSED_INTENTS } from '../actions';
import { searchTickets, viewTicket, listMyTasks } from '../../services/ticketReads';
import type { AIProvider } from '../ai';
import { answerForGroup } from '../../services/productivityAssistant';
import { notificationGroupJid } from '../../services/assignmentNotices';
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
    if (msg.isGroup !== false) {
      // Groups: only linked Loop staff get the group reply. Anyone else gets nothing at all.
      const groupWho = await identity.resolve(msg.channel, msg.senderId);
      if (groupWho.status !== 'verified') return null;
      // Productivity questions: only in the configured group, only for verified managers and admins. Authority comes from
      // the verified identity's Loop role, never from a name or a mention in the message.
      if (msg.conversationId === notificationGroupJid() && (groupWho.role === 'manager' || groupWho.role === 'admin')) {
        const answer = await answerForGroup(db, o.ai, { userId: groupWho.loopUserId, role: groupWho.role, text: msg.text })
          .catch(() => ({ text: waMsg.error(), mentions: [] as string[] }));
        return { channel: 'whatsapp' as Channel, conversationId: msg.conversationId, text: answer.text, mentions: answer.mentions };
      }
      return { channel: 'whatsapp' as Channel, conversationId: msg.conversationId, text: GROUP_REPLY };
    }
    if (msg.senderId.startsWith('lid:')) await recordPendingSender(db, msg.senderId).catch(() => undefined);
    const out: any = await processMessage(msg, {
      identity, classifier: undefined as any, store: new DbRequestStore(db), audit: new DbAuditLog(db), engine: engine as any, linker,
    });
    return out.kind === 'responded' ? out.response : null;
  };
}
