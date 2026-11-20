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
import { openTasksCard } from '../../services/productivityReports';
import { msg as waMsg } from '../../services/waMessage';

export interface WhatsAppHandlerOptions {
  ai: AIProvider;
  timezone: string;
  contextTtlSeconds: number;
  confirmationTtlSeconds: number;
  queueExpirySeconds: number;
  executionEnabled: boolean;
}

// Per-person question limit, in memory: only the one process that owns WhatsApp handles messages.
// shortcut: resets on restart, move to the database if several copies ever answer messages.
// "share the open tasks", "open tickets", "pending tasks of the team", "all tasks"…
export const OPEN_TASKS = /\b(open|pending|all|team'?s?|everyone'?s?)\s+(tasks?|tickets?|work)\b|\b(tasks?|tickets?)\s+of\s+(all|everyone|the team|team|employees)\b/i;

export function queryLimiter(limit = Number(process.env.WHATSAPP_QUERY_LIMIT) || 5, windowMin = Number(process.env.WHATSAPP_QUERY_WINDOW_MINUTES) || 10) {
  const seen = new Map<string, { times: number[]; warned: boolean }>();
  return {
    // null: allowed. A number: minutes left, tell them once. 'silent': already told, say nothing.
    hit(key: string, now: number): number | 'silent' | null {
      const e = seen.get(key) ?? { times: [], warned: false };
      e.times = e.times.filter((t) => now - t < windowMin * 60_000);
      if (!e.times.length) e.warned = false;
      seen.set(key, e);
      if (e.times.length < limit) { e.times.push(now); return null; }
      if (e.warned) return 'silent';
      e.warned = true;
      return Math.max(1, Math.ceil((e.times[0] + windowMin * 60_000 - now) / 60_000));
    },
  };
}

// Candidates confirm their WhatsApp number after the video interview and get updates from this number. Replies here
// aren't read, so they are pointed to email: once per number every 6 hours (no reply loops). Matched by the phone
// number WhatsApp reports for the sender (or the chat), against numbers candidates confirmed. Anyone else: unchanged.
export const CANDIDATE_EMAIL = 'webanatomysocial@gmail.com';
const CANDIDATE_QUIET_MS = 6 * 3600_000;
const candidateTold = new Map<string, number>();
export async function candidateReply(db: Knex, msg: { senderId: string; senderPhoneId?: string; conversationId: string }, now: number): Promise<string | null | undefined> {
  const nums = [msg.senderId, msg.senderPhoneId, msg.conversationId]
    .map((v) => String(v ?? '')).filter((v) => v.startsWith('+') || /@s\.whatsapp\.net$/.test(v))
    .map((v) => v.replace(/@.*$/, '').replace(/\D/g, '')).filter((d) => d.length >= 11 && d.length <= 15);
  if (!nums.length) return undefined;
  const app = await db('rec_applications').whereIn('whatsapp', [...new Set(nums)]).whereNotNull('whatsapp_confirmed_at').orderBy('id', 'desc').first('ref', 'name', 'whatsapp').catch(() => null);
  if (!app) return undefined;   // not a candidate: the usual handling (unknown senders stay silent)
  const last = candidateTold.get(String(app.whatsapp));
  if (last && now - last < CANDIDATE_QUIET_MS) return null;   // told recently: say nothing
  candidateTold.set(String(app.whatsapp), now);
  const first = String(app.name ?? '').trim().split(/\s+/)[0];
  return `Hi${first ? ` ${first}` : ''}! This WhatsApp number only sends updates about your application, so messages here aren't read.\n\nFor any questions, please email us at ${CANDIDATE_EMAIL} and mention your reference number ${app.ref}.\n\nThank you!`;
}

export function buildWhatsAppHandler(db: Knex, o: WhatsAppHandlerOptions) {
  const limiter = queryLimiter();
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
      // Managers and admins can ask for everyone's open tasks in the group: the answer is one picture of all employees
      const asked = msg.text.replace(/@\S+/g, ' ').trim();
      if ((groupWho.role === 'manager' || groupWho.role === 'admin') && OPEN_TASKS.test(asked)) {
        const { card, caption } = await openTasksCard(db);
        return { channel: 'whatsapp' as Channel, conversationId: msg.conversationId, text: caption, caption, card };
      }
      const user = await db('users').where({ id: groupWho.loopUserId }).first('name').catch(() => null);
      const greet = /^(hi+|hello|hey|good (morning|afternoon|evening))[\s!.,]*$/i.test(msg.text.replace(/@\S+/g, ' ').trim());
      return { channel: 'whatsapp' as Channel, conversationId: msg.conversationId, text: waMsg.askInPrivate(String(user?.name ?? ''), greet) };
    }
    // Private chat. Managers and admins can also ask about their team (hours, workload, summary); their own tasks,
    // task details and search go to the personal assistant like everyone else's.
    const who = await identity.resolve(msg.channel, msg.senderId);
    // A job candidate (not Loop staff) replying to their application updates: one pointer to email, then quiet for a while
    if (who.status !== 'verified') {
      const reply = await candidateReply(db, msg, Date.now());
      if (reply !== undefined) return reply ? { channel: 'whatsapp' as Channel, conversationId: msg.conversationId, text: reply } : null;
    }
    // Employees: a limited number of questions per window, then one cool-down note and silence until it ends.
    // Only incoming questions count; reminders and alerts go through the outbox and are never limited.
    if (who.status === 'verified' && who.role === 'employee') {
      const wait = limiter.hit(String(who.loopUserId), Date.now());
      if (wait === 'silent') return null;
      if (wait) return { channel: 'whatsapp' as Channel, conversationId: msg.conversationId, text: waMsg.coolDown(wait) };
    }
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
