// Phase 3 request engine. Turns a verified employee's message into a clarified, validated request.
// It asks questions, remembers context per employee and channel, and never executes Loop actions.
import { Knex } from 'knex';
import { AIProvider, AIError, UsageRecorder, describeAIFailure } from './ai';
import { IncomingMessage } from './types';
import {
  TicketIntent, FieldKey, REQUIRED, QUESTIONS, MIN_CONFIDENCE, Understanding,
  parseUnderstanding, promptFor, resolveDeadline, resolvePriority,
} from './understanding';
import { ConversationStore, RequestRow, newRequestId } from './conversationStore';
import { conversationKey } from './types';
import { transition } from './requestStore';
import { assignConfirmation, handleConfirmationText } from './confirmation';
import { projectScope, Actor, STAFF } from '../services/access';
import { pm, tidy, bullet, clean, plural, HELP_ENABLED } from '../services/waMessage';

// Lookups that change nothing: answered directly, never queued
export const READ_INTENTS = new Set(['SEARCH_TICKETS', 'VIEW_TASK_DETAILS', 'VIEW_MY_TASKS']);
// Intents that act on one existing ticket: the reference is resolved to exactly one visible ticket before confirmation
export const TASK_REF_INTENTS = new Set(['ASSIGN_TASK', 'UPDATE_TASK', 'ADD_COMMENT', 'ACCEPT_TASK', 'APPROVE_TASK', 'REJECT_TASK']);
// Only these channels show ticket details. Everything else (groups) gets fixed, detail-free replies.
export const PRIVATE_CHANNELS = ['simulator'];
// A message is private when its channel is private, or when it is a WhatsApp one-to-one chat (isGroup explicitly false)
export function isPrivateChat(msg: { channel: string; isGroup?: boolean }): boolean {
  return PRIVATE_CHANNELS.includes(msg.channel) || (msg.channel === 'whatsapp' && msg.isGroup === false);
}
export const GROUP_REPLY = '👋 *Loop assistant*\n\nI couldn\'t match you to a Loop account. Ask an admin to link your number in the AI Assistant dashboard.';

export interface TicketReader {
  search(actor: Actor, text: string): Promise<{ total: number; items: { id: number; title: string; status: string; priority: string; due_date: string | null }[] }>;
  view(actor: Actor, id: number): Promise<{ id: number; title: string; status: string; priority: string; due_date: string | null; assignee: string | null; checklist_done: number; checklist_total: number }>;
  mine(actor: Actor): Promise<{ total: number; items: { id: number; title: string; status: string; priority: string; due_date: string | null; project: string | null; assignee: string | null }[] }>;
}

export interface EngineDeps {
  reader?: TicketReader;
  exposedIntents?: readonly string[];
  db: Knex;
  ai: AIProvider;
  usage?: UsageRecorder;
  timezone: string;
  contextTtlSeconds: number;
  confirmationTtlSeconds?: number;
  queueExpirySeconds?: number;
  // Whether confirmed requests actually run (the executor's switch). Decides what the employee is told.
  executionEnabled?: boolean;
  now?: () => number;
}

export interface EngineResult {
  reply: string;
  requestId: string | null;
  status: 'question' | 'cancelled' | 'ready' | 'not_understood' | 'ambiguous_request' | 'error' | 'confirmed' | 'confirmation_refused' | 'answered' | 'not_available';
}

const CANCEL = /^\s*(cancel|never ?mind|forget it|stop)\b/i;
const GREETING = /^(hi+|hello|hey|good (morning|afternoon|evening))[\s!.,]*$/i;
const HELP_CMD = /^(help|menu|what can you do|options)[\s?!.]*$/i;
const START_OVER = /^start over[\s!.]*$/i;
// "none", "null" and similar mean no value. Only a deadline can legitimately be "none" (no deadline).
export const NONE_WORDS = /^(none|null|undefined|unknown|unspecified|not specified|n\/?a|nil|-+)$/i;
const CORRECTION = /^\s*(actually|change|instead|make it|no,|not )/i;
// A clearly different request must reach this confidence before the employee is asked to switch
const SWITCH_CONFIDENCE = 0.8;
// Answers to "Should I assign this task to you?": the number or the word
const SELF_YES = /^\s*(1|yes|y|yeah|yep|yup|sure|ok|okay|me|myself)[\s.!]*$/i;
const SELF_NO = /^\s*(2|no|n|nope|nah)[\s.!]*$/i;

function questionFor(row: RequestRow): string {
  return row.asked_field ? QUESTIONS[row.asked_field as FieldKey] : "Reply CONFIRM with the code, or CANCEL to drop it.";
}

const PAGE = 10;
const MAX_CHOICES = 50;
export const SELF_QUESTION = "Should I assign this task to you?\n\n1. Yes\n2. No";
const SHOW_PROJECTS = /\b(show|list|display|see|view)\b.*\bprojects?\b/i;
const MORE = /^(more|next)[\s.!]*$/i;
// Names compare equal when dashes, underscores and spacing differ ("TEST - Home" matches "TEST — Home")
const norm = (s: string) => s.toLowerCase().replace(/[-–—_]+/g, " ").replace(/\s+/g, " ").trim();

export function projectMenu(list: { id: number; name: string }[], page: number): string {
  if (!list.length) return "You have no projects you can use for tasks right now. Reply CANCEL to drop this request.";
  const start = page * PAGE;
  const lines = list.slice(start, start + PAGE).map((p, i) => `${start + i + 1}. ${p.name}`).join("\n");
  const more = start + PAGE < list.length ? "\nReply MORE to see more projects." : "";
  return `Which project should this task belong to?\n${lines}${more}\nReply with the number or project name.`;
}

export function commandOf(text: string): 'GREETING' | 'HELP' | 'START_OVER' | null {
  if (GREETING.test(text)) return 'GREETING';
  if (HELP_ENABLED && HELP_CMD.test(text)) return 'HELP';
  if (START_OVER.test(text)) return 'START_OVER';
  return null;
}

const MENU: Record<string, { line: string; roles?: string[] }> = {
  VIEW_MY_TASKS: { line: 'Show my tasks' },
  SEARCH_TICKETS: { line: 'Search tickets: "search for <words>"' },
  VIEW_TASK_DETAILS: { line: 'Ticket details: "show details of <task>"' },
  CREATE_TASK: { line: 'Create a task: "create a task"' },
  ASSIGN_TASK: { line: 'Assign a task: "assign <task> to <name>"', roles: ['manager', 'admin'] },
  ADD_COMMENT: { line: 'Add a comment: "comment on <task>: <text>"' },
  ACCEPT_TASK: { line: 'Accept a task: "accept <task>"' },
  APPROVE_TASK: { line: 'Approve a task: "approve <task>"', roles: ['manager', 'admin'] },
  REJECT_TASK: { line: 'Reject a task: "reject <task>"', roles: ['manager', 'admin'] },
};

function draftLine(open: RequestRow[]): string {
  const r = open[0];
  if (!r) return '';
  const q = r.asked_field ? QUESTIONS[r.asked_field as FieldKey] : 'Reply CONFIRM with the code, or CANCEL to drop it.';
  return pm.draft(q);
}

export function helpFor(role: string, open: RequestRow[], exposed: readonly string[]): string {
  const lines = Object.entries(MENU)
    .filter(([intent, m]) => exposed.includes(intent) && (!m.roles || m.roles.includes(role)))
    .map(([, m]) => bullet(m.line));
  const available = lines.length ? lines : [bullet('Say hi to get a welcome'), bullet('Type CANCEL to drop a request you started')];
  return pm.help(available, draftLine(open));
}

export function greetingFor(open: RequestRow[], name = ''): string {
  return pm.greeting(draftLine(open), name);
}

// A plain reply to an open question answers that question. Corrections and blanks fall through or re-ask.
export function directAnswer(row: RequestRow, text: string): Understanding | null {
  const field = row.asked_field as FieldKey;
  const value = text.trim();
  if (CORRECTION.test(value)) return null;
  const base: Understanding = { intent: row.intent as TicketIntent, confidence: 1, fields: {}, ambiguous: [], is_correction: false, cancel: false, answers_pending: true };
  if (!value || (NONE_WORDS.test(value) && field !== 'deadline')) return base;
  const choices = (row.data.resolved?.choices?.[field] ?? null) as { id: number; name: string }[] | null;
  if (choices && /^\d+$/.test(value)) {
    const c = choices[Number(value) - 1];
    return c ? { ...base, fields: { [field]: c.name }, selected: { field, id: c.id } } : base;
  }
  return { ...base, fields: { [field]: value } };
}

// Staff only: a name can match a person who is not on Loop at all
export async function findStaffByName(db: Knex, name: string): Promise<{ id: number; name: string }[]> {
  const q = name.trim().toLowerCase();
  if (!q) return [];
  const rows = await db('users').whereIn('role', STAFF).select('id', 'name');
  const exact = rows.filter((r: any) => String(r.name).trim().toLowerCase() === q);
  if (exact.length) return exact;
  return rows.filter((r: any) => String(r.name).trim().toLowerCase().split(/\s+/)[0] === q);
}

// Projects the employee can already see (same scope as the Projects page)
export async function findVisibleProjects(db: Knex, actor: Actor, name: string): Promise<{ id: number; name: string }[]> {
  const q = name.trim().toLowerCase();
  if (!q) return [];
  const scope = await projectScope(db, actor);
  return scope(db('projects as p').select('p.id', 'p.name')
    .whereRaw('LOWER(p.name) LIKE ?', [`%${q}%`])) as any;
}

function hasValue(data: RequestRow['data'], f: FieldKey): boolean {
  const r = data.resolved;
  switch (f) {
    case 'employee': return r.employee_id != null;
    case 'project': return r.project_id != null;
    case 'deadline': return 'deadline' in r;      // null is a valid explicit answer ("none")
    case 'priority': return r.priority != null;
    default: return !!data.raw[f];
  }
}

function summary(row: RequestRow): string {
  const r = row.data.raw;
  const parts = [
    r.title && `"${r.title}"`,
    r.project && `in ${r.project}`,
    r.employee && `for ${r.employee}`,
    row.data.resolved.deadline ? `due ${row.data.resolved.deadline}` : row.data.resolved.deadline === null ? 'no deadline' : '',
  ].filter(Boolean);
  return parts.join(' ');
}

export class RequestEngine {
  private readonly store: ConversationStore;
  constructor(private readonly d: EngineDeps) { this.store = new ConversationStore(d.db); }

  // Group-safe unless the channel is private. Errors and empty results use the same fixed wording.
  private async lookup(intent: string, data: { raw: Record<string, string> }, actor: Actor, priv: boolean): Promise<string> {
    if (!priv) return GROUP_REPLY;
    const reader = this.d.reader!;
    try {
      if (intent === 'VIEW_MY_TASKS') {
        const r = await reader.mine(actor);
        if (!r.total) return pm.info('You have no open tasks in Loop.');
        const lines = r.items.map((t) => bullet(`#${t.id} ${clean(t.title)} — ${t.status.replace(/_/g, ' ')}, ${t.priority}${t.due_date ? ', due ' + t.due_date : ''}`));
        return pm.list(`You have ${plural(r.total, 'open task')}`, lines, r.total > r.items.length ? '…and more in Loop.' : '');
      }
      if (intent === 'SEARCH_TICKETS') {
        const r = await reader.search(actor, data.raw.query ?? '');
        if (!r.total) return pm.info('No tickets match that in what you can see.');
        const lines = r.items.map((t) => bullet(`#${t.id} ${clean(t.title)} — ${t.status.replace(/_/g, ' ')}, ${t.priority}${t.due_date ? ', due ' + t.due_date : ''}`));
        return pm.list(plural(r.total, 'ticket'), lines, r.total > r.items.length ? 'Narrow the search to see the rest.' : '');
      }
      // VIEW_TASK_DETAILS: find by the reference, then show it only when it is exactly one visible ticket
      const r = await reader.search(actor, data.raw.task_ref ?? '');
      if (r.total === 0) return pm.info('I couldn\'t find a ticket like that that you can see.');
      if (r.total > 1) return `More than one ticket matches. Which one? ${r.items.slice(0, 5).map((t) => `#${t.id} ${t.title}`).join('; ')}`;
      const v = await reader.view(actor, r.items[0].id);
      return `#${v.id} ${v.title}: ${v.status.replace(/_/g, ' ')}, priority ${v.priority}${v.due_date ? ', due ' + v.due_date : ''}${v.assignee ? ', assigned to ' + v.assignee : ''}. Checklist ${v.checklist_done}/${v.checklist_total}.`;
    } catch {
      return pm.lookupError();
    }
  }

  // Saves a change to the open draft's resolved data (persisted, so it survives a restart)
  private async patchResolved(row: RequestRow, mutate: (resolved: any) => void, nowMs: number): Promise<void> {
    const resolved: any = { ...row.data.resolved };
    mutate(resolved);
    await this.store.update(row.id, { data: { raw: row.data.raw, resolved } } as any, nowMs);
  }

  // Projects the employee may use for tasks: the same access scope as the Projects page
  private async visibleProjects(actor: Actor): Promise<{ id: number; name: string }[]> {
    const scope = await projectScope(this.d.db, actor);
    const rows: any[] = await scope(this.d.db('projects as p').select('p.id', 'p.name').orderBy('p.name'));
    return rows.slice(0, MAX_CHOICES).map((r) => ({ id: Number(r.id), name: String(r.name) }));
  }

  // Saves or clears the pending switch question on the open draft (persisted, so it survives a restart)
  private async setPending(row: RequestRow, pending: object | null, nowMs: number): Promise<void> {
    const resolved: any = { ...row.data.resolved };
    if (pending) resolved.pending_choice = pending; else delete resolved.pending_choice;
    await this.store.update(row.id, { data: { raw: row.data.raw, resolved } } as any, nowMs);
  }

  async handle(msg: IncomingMessage, who: { id: number; role: string }): Promise<EngineResult> {
    const nowMs = this.d.now ? this.d.now() : Date.now();
    const key = conversationKey(msg.channel, msg.conversationId, who.id);
    const actor = { id: who.id, role: who.role } as Actor;
    const text = msg.text.trim();

    await this.store.expireStale(key, this.d.contextTtlSeconds, nowMs);
    const employeeTurn = await this.store.logTurn(key, 'employee', text, null, nowMs);
    const open = await this.store.openRequests(key);

    const reply = async (r: EngineResult) => {
      if (r.requestId) await this.store.linkTurn(employeeTurn, r.requestId);
      r = { ...r, reply: tidy(r.reply) };
      await this.store.logTurn(key, 'assistant', r.reply, r.requestId, nowMs);
      return r;
    };
    // A confirmation for an operation that is not exposed is refused before anything is queued
    const confCode = /^\s*confirm\s+([A-Za-z0-9]{4,12})\s*$/i.exec(text);
    if (confCode && this.d.exposedIntents) {
      const pendingRow = await this.d.db('assistant_requests').where({ confirm_code: confCode[1].toUpperCase() }).first('intent');
      if (pendingRow && !(this.d.exposedIntents as readonly string[]).includes(pendingRow.intent)) {
        return reply({ reply: pm.unavailable(), requestId: null, status: 'not_available' });
      }
    }
    const conf = await handleConfirmationText(this.d.db, who.id, key, text, nowMs, this.d.queueExpirySeconds ?? 900);
    if (conf.kind !== 'none') {
      const replies: Record<string, { reply: string; status: EngineResult['status']; requestId: string | null }> = {
        confirmed: { reply: this.d.executionEnabled ? 'Confirmed. Your request is queued.' : 'Confirmed. Your request is queued. Nothing has been changed in Loop yet, because execution is not enabled.', status: 'confirmed', requestId: (conf as any).requestId ?? null },
        cancelled: { reply: pm.cancelled(), status: 'cancelled', requestId: (conf as any).requestId ?? null },
        invalid: { reply: pm.info("That confirmation code isn't valid."), status: 'confirmation_refused', requestId: null },
        already: { reply: pm.info('That request has already been handled.'), status: 'confirmation_refused', requestId: (conf as any).requestId ?? null },
        ambiguous: { reply: `You have more than one request waiting for confirmation. Reply CONFIRM with the code of the one you mean: ${(conf as any).codes?.join(', ')}.`, status: 'confirmation_refused', requestId: null },
      };
      return reply(replies[conf.kind]);
    }


    if (CANCEL.test(text)) {
      if (!open.length) return reply({ reply: pm.info('There is nothing to cancel.'), requestId: null, status: 'not_understood' });
      const target = open[0];
      await transition(this.d.db, target.id, 'CANCELLED', { event: 'cancelled', loopUserId: who.id, conversationKey: key, detail: 'cancelled by employee', expectFrom: ['NEEDS_CLARIFICATION'] }, nowMs);
      return reply({ reply: pm.cancelled(`${target.intent.replace(/_/g, ' ').toLowerCase()}${summary(target) ? ' (' + summary(target) + ')' : ''}`), requestId: target.id, status: 'cancelled' });
    }

    // Commands are answered before the model and never change an open draft (START OVER is the only one that does)
    const cmd = commandOf(text);
    if (cmd === 'START_OVER') {
      for (const r of open) await transition(this.d.db, r.id, 'CANCELLED', { event: 'cancelled', loopUserId: who.id, conversationKey: key, detail: 'start over', expectFrom: ['NEEDS_CLARIFICATION'] }, nowMs).catch(() => {});
      return reply({ reply: `${pm.cancelled('your current request')}\n\nWhat would you like to do next?`, requestId: null, status: 'cancelled' });
    }
    if (cmd === 'GREETING') return reply({ reply: greetingFor(open, String((await this.d.db('users').where({ id: who.id }).first('name').catch(() => null))?.name ?? '')), requestId: open[0]?.id ?? null, status: 'answered' });
    if (cmd === 'HELP') return reply({ reply: helpFor(who.role, open, (this.d.exposedIntents ?? []) as readonly string[]), requestId: open[0]?.id ?? null, status: 'answered' });

    // "Show the projects here": a request to display projects, never a project name. The draft is kept.
    if (SHOW_PROJECTS.test(text) && text.length <= 80) {
      const list = await this.visibleProjects(actor);
      if (open[0]) await this.patchResolved(open[0], (r) => { r.choices = { ...(r.choices ?? {}), project: list }; r.project_page = 0; }, nowMs);
      return reply({ reply: projectMenu(list, 0), requestId: open[0]?.id ?? null, status: 'answered' });
    }
    if (MORE.test(text) && open[0]?.asked_field === 'project' && open[0].data.resolved?.choices?.project) {
      const row = open[0];
      const list = row.data.resolved.choices.project as { id: number; name: string }[];
      const page = Math.min(Number(row.data.resolved.project_page ?? 0) + 1, Math.max(0, Math.ceil(list.length / PAGE) - 1));
      await this.patchResolved(row, (r) => { r.project_page = page; }, nowMs);
      return reply({ reply: projectMenu(list, page), requestId: row.id, status: 'question' });
    }

    // Several open drafts (only possible from older data): the employee picks one by number. The others are then closed.
    if (open.length > 1) {
      const picked = /^\d+$/.test(text) ? open[Number(text) - 1] : undefined;
      if (picked) {
        for (const r of open) if (r.id !== picked.id) await transition(this.d.db, r.id, 'CANCELLED', { event: 'cancelled', loopUserId: who.id, conversationKey: key, detail: 'closed: employee chose another request', expectFrom: ['NEEDS_CLARIFICATION'] }, nowMs).catch(() => {});
        const q = picked.asked_field ? QUESTIONS[picked.asked_field as FieldKey] : 'Reply CONFIRM with the code, or CANCEL to drop it.';
        return reply({ reply: `Continuing your ${picked.intent.replace(/_/g, ' ').toLowerCase()} request. ${q}`, requestId: picked.id, status: 'question' });
      }
      const list = open.map((r, i) => `${i + 1}) ${r.intent.replace(/_/g, ' ').toLowerCase()}${summary(r) ? ': ' + summary(r) : ''}`).join('; ');
      return reply({ reply: `Which request is this for? ${list}. Reply with the number.`, requestId: null, status: 'ambiguous_request' });
    }
    const focus = open[0] ?? null;

    // A pending "continue or switch?" question is answered only by its two saved options
    const pending = focus?.data.resolved?.pending_choice as ({ kind: 'switch'; text: string; intent: string } | { kind: 'self' }) | undefined;
    // "Should I assign this task to you?" Yes resolves the linked employee by user ID. No asks who it is for.
    let forced: Understanding | null = null;
    if (focus && pending?.kind === 'self') {
      const answer = SELF_YES.test(text) ? '1' : SELF_NO.test(text) ? '2' : text;
      if (answer === '1') {
        const me = await this.d.db('users').where({ id: who.id }).select('name').first();
        forced = { intent: focus.intent as TicketIntent, confidence: 1, fields: { employee: String(me?.name ?? '') }, ambiguous: [], is_correction: false, cancel: false, answers_pending: true, selected: { field: 'employee', id: who.id } };
      } else if (answer === '2') {
        await this.patchResolved(focus, (r) => { delete r.pending_choice; r.self_declined = true; }, nowMs);
        return reply({ reply: QUESTIONS.employee, requestId: focus.id, status: 'question' });
      } else {
        await this.setPending(focus, null, nowMs); // any other reply is answered as the question it is
      }
    }
    if (focus && pending?.kind === 'switch') {
      const oldName = focus.intent.replace(/_/g, ' ').toLowerCase();
      const newName = pending.intent.replace(/_/g, ' ').toLowerCase();
      if (text === '1') {
        await this.setPending(focus, null, nowMs);
        return reply({ reply: `Okay, continuing your ${oldName} request. ${questionFor(focus)}`, requestId: focus.id, status: 'question' });
      }
      if (text === '2') {
        await transition(this.d.db, focus.id, 'CANCELLED', { event: 'cancelled', loopUserId: who.id, conversationKey: key, detail: 'switched to another request', expectFrom: ['NEEDS_CLARIFICATION'] }, nowMs);
        return this.handle({ ...msg, text: pending.text }, who);
      }
      return reply({ reply: `Please reply 1 to continue your ${oldName} request, or 2 to cancel it and ${newName} instead.`, requestId: focus.id, status: 'question' });
    }

    let u: Understanding;
    let usage = { inputTokens: 0, outputTokens: 0 };
    if (forced) u = forced;
    else try {
      const p = promptFor({ message: text, intent: focus?.intent as TicketIntent | undefined, fields: focus?.data.raw, asked: (focus?.asked_field as FieldKey) ?? null, nowIso: new Date(nowMs).toISOString(), tz: this.d.timezone });
      const aiReq = { system: p.system, user: p.user, jsonOnly: true, maxOutputTokens: 400, feature: focus?.asked_field ? 'clarification' : 'intent_classification' };
      // One retry for rate limits and transient provider errors. Timeouts are not retried, so a reply stays within one timeout.
      let out;
      try { out = await this.d.ai.complete(aiReq); }
      catch (e) {
        if (!(e instanceof AIError && e.retryable && (e.code === 'rate_limited' || e.code === 'provider_error'))) throw e;
        out = await this.d.ai.complete(aiReq);
      }
      usage = out.usage;
      this.d.usage?.record(this.d.ai.name, out.model, out.usage);
      u = parseUnderstanding(out.text);
    } catch (e) {
      // Provider failures and invalid model output never change request state
      if (!(e instanceof AIError) && !(e instanceof Error)) throw e;
      // Category only, so a failure is diagnosable without logging message text, keys or sender details
      console.error(`[assistant] AI call failed: ${describeAIFailure(e)}`);
      return reply({ reply: pm.error(), requestId: focus?.id ?? null, status: 'error' });
    }
    // While a question is open: a clearly different supported request asks the employee to choose, and is never used as a field value
    if (focus?.asked_field && u.intent !== focus.intent && u.intent !== 'UNKNOWN' && u.confidence >= SWITCH_CONFIDENCE && !u.is_correction && ((this.d.exposedIntents ?? []) as readonly string[]).includes(u.intent)) {
      await this.setPending(focus, { kind: 'switch', text, intent: u.intent }, nowMs);
      const oldName = focus.intent.replace(/_/g, ' ').toLowerCase();
      const newName = u.intent.replace(/_/g, ' ').toLowerCase();
      return reply({ reply: `You have an open ${oldName} request. Reply 1 to continue it, or 2 to cancel it and ${newName} instead.`, requestId: focus.id, status: 'question' });
    }
    // Otherwise a plain reply answers the field that was asked, validated for that field
    if (focus?.asked_field && !forced) {
      const direct = directAnswer(focus, text);
      if (direct) u = direct;
    }
    const meta = { provider: this.d.ai.name, model: 'configured', input_tokens: usage.inputTokens, output_tokens: usage.outputTokens };

    if (u.cancel && focus) {
      await transition(this.d.db, focus.id, 'CANCELLED', { event: 'cancelled', loopUserId: who.id, conversationKey: key, detail: 'cancelled by employee', expectFrom: ['NEEDS_CLARIFICATION'] }, nowMs);
      return reply({ reply: pm.cancelled(), requestId: focus.id, status: 'cancelled' });
    }


    // A reply to the open question usually carries values but no intent of its own; it continues the request
    const answering = !!focus && u.answers_pending && Object.keys(u.fields).length > 0;
    if (!answering && (u.intent === 'UNKNOWN' || u.confidence < MIN_CONFIDENCE)) {
      if (focus) {
        const q = QUESTIONS[focus.asked_field as FieldKey] ?? 'Could you rephrase that?';
        return reply({ reply: `Sorry, I didn't quite understand. ${q}`, requestId: focus.id, status: 'question' });
      }
      return reply({ reply: pm.notUnderstood(), requestId: null, status: 'not_understood' });
    }

    // Does this message continue the open request, or start a different one?
    // While a draft is open, the employee's message continues it. A new request needs the draft closed first (CANCEL or START OVER).
    const continues = !!focus;
    const base: RequestRow = continues ? focus! : ({
      id: newRequestId(), conversation_key: key, loop_user_id: who.id, channel: msg.channel, conversation_id: msg.conversationId,
      origin_message_id: msg.messageId, intent: u.intent, data: { raw: {}, resolved: {} }, ambiguous: [], status: 'NEEDS_CLARIFICATION',
      asked_field: null, ask_count: 0, confidence: u.confidence, ai_meta: meta, error: null, created_at: '', updated_at: '',
    } as RequestRow);
    const intent = continues ? (focus!.intent as TicketIntent) : u.intent;
    if (intent === 'UNKNOWN') return reply({ reply: pm.notUnderstood(), requestId: null, status: 'not_understood' });

    // Merge: a newly stated value replaces the old one (this is how corrections work)
    const raw = { ...base.data.raw };
    const resolved: any = { ...base.data.resolved };
    delete resolved.pending_choice; // the question is answered, so it is no longer pending
    for (const [f, v] of Object.entries(u.fields)) {
      if (typeof v !== 'string' || (NONE_WORDS.test(v.trim()) && f !== 'deadline')) { delete raw[f]; continue; }
      raw[f] = v as string;
      if (f === 'employee' || f === 'project' || f === 'deadline' || f === 'priority') delete resolved[f === 'employee' ? 'employee_id' : f === 'project' ? 'project_id' : f];
      if (resolved.choices) delete resolved.choices[f];
    }
    // A numbered choice the employee picked is saved directly, not looked up again
    if (u.selected) resolved[u.selected.field === 'employee' ? 'employee_id' : 'project_id'] = u.selected.id;
    // Changes to Loop are made from private channels only. A group gets the fixed reply: nothing is read, saved or queued.
    if (!isPrivateChat(msg) && !READ_INTENTS.has(intent)) {
      return reply({ reply: GROUP_REPLY, requestId: null, status: 'not_available' });
    }
    const problems: string[] = [];
    let projectMulti = false;
    // A numbered project pick is valid only for projects this employee can use right now
    if (u.selected?.field === 'project' && resolved.project_id === u.selected.id) {
      const vis = await this.visibleProjects(actor);
      if (!vis.some((p) => p.id === u.selected!.id)) { delete resolved.project_id; delete raw.project; problems.push("That project isn't available to you. Choose from the list."); }
    }

    // A ticket reference must name exactly one ticket the employee can see
    if (raw.task_ref && resolved.task_id == null && TASK_REF_INTENTS.has(intent) && this.d.reader) {
      const found = await this.d.reader.search(actor, raw.task_ref);
      if (found.total === 1) { resolved.task_id = found.items[0].id; raw.task_ref = found.items[0].title; }
      else if (found.total > 1) { delete raw.task_ref; problems.push(`More than one ticket matches "${u.fields.task_ref}". Which one? ${found.items.slice(0, 5).map((t) => `#${t.id} ${t.title}`).join('; ')}`); }
      else { delete raw.task_ref; problems.push(`I couldn't find a ticket like "${u.fields.task_ref}" that you can see. Which one do you mean?`); }
    }

    if (raw.employee && resolved.employee_id == null) {
      const matches = await findStaffByName(this.d.db, raw.employee);
      if (matches.length === 1) { resolved.employee_id = matches[0].id; raw.employee = matches[0].name; }
      else if (matches.length > 1) {
        delete raw.employee;
        resolved.choices = { ...(resolved.choices ?? {}), employee: matches.map((m: any) => ({ id: m.id, name: m.name })) };
        problems.push(`There are ${matches.length} people called ${u.fields.employee}. Which one? ${matches.map((m: any, i: number) => `${i + 1}) ${m.name}`).join(' ')}. Reply with the number.`);
      }
      else { delete raw.employee; problems.push(`I couldn't find anyone called ${u.fields.employee}. Who should it be assigned to?`); }
    }
    if (raw.project && resolved.project_id == null) {
      // Only projects this employee can see, matched exactly first, then by containing the name
      const vis = await this.visibleProjects(actor);
      const q = norm(String(u.fields.project ?? raw.project));
      let matches = vis.filter((p) => norm(p.name) === q);
      if (!matches.length) matches = vis.filter((p) => norm(p.name).includes(q));
      if (matches.length === 1) { resolved.project_id = matches[0].id; raw.project = matches[0].name; }
      else if (matches.length > 1) {
        delete raw.project;
        resolved.choices = { ...(resolved.choices ?? {}), project: matches };
        projectMulti = true;
        problems.push(`More than one project matches "${u.fields.project}". Which one? ${matches.map((m, i) => `${i + 1}) ${m.name}`).join(' ')}. Reply with the number.`);
      } else {
        delete raw.project;
        problems.push(`I couldn't find a project called "${u.fields.project}" that you can see.`);
      }
    }
    if (raw.deadline && !('deadline' in resolved)) {
      const d = resolveDeadline(raw.deadline, nowMs, this.d.timezone);
      if (d.ok) resolved.deadline = d.value; else { delete raw.deadline; problems.push("I couldn't read that date. What is the deadline? (say \"none\" if there is none)"); }
    }
    if (raw.priority && resolved.priority == null) {
      const p = resolvePriority(raw.priority);
      if (p) resolved.priority = p; else { delete raw.priority; problems.push('Priority must be low, medium, high or urgent.'); }
    }

    const data = { raw, resolved };
    const missing = REQUIRED[intent].filter((f) => !hasValue(data, f));
    const next: FieldKey | null = missing[0] ?? null;

    if (u.ambiguous.length && !problems.length && missing.length === 0) {
      problems.push(`Could you be more specific about "${raw[u.ambiguous[0]] ?? u.ambiguous[0]}"?`);
    }

    // Intents not yet exposed to the assistant are refused plainly, never queued
    if (this.d.exposedIntents && !this.d.exposedIntents.includes(intent)) {
      if (focus) await transition(this.d.db, focus.id, 'CANCELLED', { event: 'cancelled', loopUserId: who.id, conversationKey: key, expectFrom: ['NEEDS_CLARIFICATION'], detail: 'intent not available in the assistant' }, nowMs).catch(() => {});
      return reply({ reply: pm.unavailable(), requestId: null, status: 'not_available' });
    }

    // Read-only lookups: answered now from the same visibility rules Loop uses
    if (!next && !problems.length && READ_INTENTS.has(intent) && this.d.reader) {
      if (focus) await transition(this.d.db, focus.id, 'CANCELLED', { event: 'cancelled', loopUserId: who.id, conversationKey: key, expectFrom: ['NEEDS_CLARIFICATION'], detail: 'answered as a lookup' }, nowMs).catch(() => {});
      const priv = isPrivateChat(msg);
      const answer = await this.lookup(intent, data, actor, priv);
      return reply({ reply: answer, requestId: null, status: 'answered' });
    }

    if (next || problems.length) {
      const field = next ?? (u.ambiguous[0] as FieldKey) ?? 'title';
      const sameAsBefore = base.asked_field === field && !problems.length;
      const askCount = sameAsBefore ? base.ask_count + 1 : 1;
      let question: string;
      if (problems.length) question = problems.join(' ');
      else if (askCount >= 3) question = `I still need this to continue. ${QUESTIONS[field]} Or say "cancel" to drop the request.`;
      else if (askCount === 2) question = `Sorry, I still need this: ${QUESTIONS[field]}`;
      else question = QUESTIONS[field];

      // Projects: a numbered list of the projects this employee may use, saved against this question
      if (field === 'project' && !projectMulti) {
        const list = await this.visibleProjects(actor);
        resolved.choices = { ...(resolved.choices ?? {}), project: list };
        resolved.project_page = 0;
        question = (problems.length ? problems.join(' ') + ' ' : '') + projectMenu(list, 0);
      }
      // A new create-task request starts by asking whether to assign it to the employee
      if (field === 'employee' && intent === 'CREATE_TASK' && !problems.length && !raw.employee && resolved.employee_id == null && !resolved.self_declined) {
        resolved.pending_choice = { kind: 'self' };
        question = SELF_QUESTION;
      }

      const patch = { data, ambiguous: u.ambiguous, status: 'NEEDS_CLARIFICATION' as const, asked_field: field, ask_count: askCount, intent, ai_meta: meta };
      if (continues) await this.store.update(base.id, patch, nowMs);
      else await this.store.create({ ...base, ...patch }, nowMs);
      return reply({ reply: question, requestId: base.id, status: 'question' });
    }

    // Everything required is present: ask for explicit confirmation before anything can run
    const finalPatch = { data, ambiguous: [], status: 'READY_FOR_CONFIRMATION' as const, asked_field: null, ask_count: 0, intent, ai_meta: meta };
    if (continues) {
      await transition(this.d.db, base.id, 'READY_FOR_CONFIRMATION', { event: 'understood', loopUserId: who.id, conversationKey: key, expectFrom: ['NEEDS_CLARIFICATION'], patch: { data, ambiguous: [], asked_field: null, ask_count: 0, intent, ai_meta: meta } }, nowMs);
    } else {
      await this.store.create({ ...base, ...finalPatch }, nowMs);
    }
    const row = { ...base, ...finalPatch } as RequestRow;
    const code = await assignConfirmation(this.d.db, base.id, this.d.confirmationTtlSeconds ?? 600, nowMs);
    return reply({
      reply: `Please confirm: ${intent.replace(/_/g, ' ').toLowerCase()} ${summary(row)}. Reply CONFIRM ${code} to proceed, or CANCEL ${code} to drop it. Nothing changes until you confirm.`,
      requestId: base.id, status: 'ready',
    });
  }
}
