import { enforceSessionPermissions } from './session-perms';
import { renderCard } from '../../services/reportCard';
// WhatsApp connection adapter. Owns the socket: pairing, reconnection, incoming and outgoing text, status and shutdown.
// It turns a WhatsApp message into an IncomingMessage and hands it to the assistant. It never trusts a display name,
// and it never logs QR codes, session data or message text.
import type { IncomingMessage, OutgoingResponse } from '../types';
import type { WhatsAppConfig } from './config';

export interface SocketLike {
  ev: { on(event: string, fn: (...args: any[]) => void): unknown };
  sendMessage(jid: string, content: { text: string; mentions?: string[] } | { image: Buffer; caption: string; mentions?: string[] }): Promise<unknown>;
  groupFetchAllParticipating?(): Promise<Record<string, { id?: string; subject?: string }>>;
  groupMetadata?(jid: string): Promise<{ participants?: { id?: string; jid?: string; lid?: string }[] }>;
  end(error?: unknown): void;
  user?: { id?: string };
}
export interface SocketHandle { socket: SocketLike; saveCreds: () => Promise<void> | void }
export type SocketFactory = (sessionDir: string) => Promise<SocketHandle>;

export type WaState = 'stopped' | 'starting' | 'awaiting_qr' | 'connected' | 'reconnecting' | 'logged_out';
export interface WaStatus {
  enabled: boolean; state: WaState; account: string | null; lastConnectedAt: string | null;
  lastDisconnectedAt: string | null; reconnectAttempts: number; qrPending: boolean;
}

export interface AdapterDeps {
  config: WhatsAppConfig;
  makeSocket: SocketFactory;
  handle: (msg: IncomingMessage) => Promise<OutgoingResponse | null>;
  writeQr?: (qr: string) => void;                     // stores the pairing code privately; never logged
  clearQr?: () => void;                               // removes the private pairing file once the phone is paired
  // Moves an invalid session folder aside (kept, not deleted) and returns where it went. Tests can replace it.
  archiveSession?: (dir: string) => string | Promise<string>;
  log?: (level: 'info' | 'warn' | 'error', message: string) => void;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => unknown;
  unschedule?: (handle: unknown) => void;
  noReconnect?: boolean;                              // tests only
  // Permission pass for the session folder: at start, and on a timer while running (session-perms.ts)
  enforce?: (dir: string) => unknown;
  sweepMs?: number;
  // What happened to each incoming message (for the dashboard's activity list). Never receives message text.
  onEvent?: (e: import('./activity').WaEvent) => void;
}

const LOGGED_OUT = 401;                                // Baileys DisconnectReason.loggedOut
const MAX_PAIRING_ROUNDS = 3;                          // stop rather than loop if the phone keeps refusing

// Moves the session folder to a sibling folder named with a timestamp, keeping its owner-only permissions
export function defaultArchive(dir: string): string {
  const fs = require('fs') as typeof import('fs');
  const target = `${dir}-invalid-${new Date().toISOString().replace(/[:.]/g, '-')}-${(require('crypto') as typeof import('crypto')).randomBytes(3).toString('hex')}`;
  fs.renameSync(dir, target);
  fs.chmodSync(target, 0o700);
  return target;
}

// Never let a number or secret reach a log line
export const safeMessage = (e: unknown) => String((e as Error)?.message ?? 'unknown error').replace(/\+?\d{8,}/g, '[number]').slice(0, 160);
export const maskNumber = (digits: string) => `+${digits.slice(0, 2)} •••• ${digits.slice(-4)}`;

const defaultLog = (level: 'info' | 'warn' | 'error', message: string) => {
  (level === 'error' ? console.error : console.log)(`[whatsapp] ${message}`);
};

// A WhatsApp message to an IncomingMessage. Groups are marked; display names are ignored.
export function toIncoming(m: any): IncomingMessage | null {
  const key = m?.key;
  if (!key || key.fromMe) return null;
  const chat: string | undefined = key.remoteJid;
  if (!chat || chat === 'status@broadcast' || chat.endsWith('@broadcast') || chat.endsWith('@newsletter')) return null;
  // Disappearing-message, view-once and edited messages wrap the real message one level down
  const w = m.message ?? {};
  const msgBody = w.ephemeralMessage?.message ?? w.viewOnceMessage?.message ?? w.viewOnceMessageV2?.message ?? w.editedMessage?.message ?? w;
  m = { ...m, message: msgBody };
  const text = m.message?.conversation ?? m.message?.extendedTextMessage?.text;
  if (typeof text !== 'string' || !text.trim()) return null;   // only text is supported
  const isGroup = chat.endsWith('@g.us');
  const mentioned: string[] = (m.message?.extendedTextMessage?.contextInfo?.mentionedJid ?? []).map((j: string) => String(j).split('@')[0].split(':')[0]);
  const sender: string | undefined = isGroup ? key.participant : chat;
  if (!sender) return null;
  const user = String(sender).split('@')[0].split(':')[0];
  // Only a real phone-number id is a phone number. Internal ids (@lid) look numeric but are not numbers: keep them
  // opaque, so the identity check refuses them rather than matching a link by accident.
  const isPhoneId = !String(sender).endsWith('@lid') && /^\d{8,15}$/.test(user);
  // A LID identifies the same account in a private chat and in a group, so both are matched the same way
  const isPrivateLid = String(sender).endsWith('@lid');
  const senderId = isPhoneId ? `+${user}` : isPrivateLid ? `lid:${user}` : `opaque:${user}`;
  // WhatsApp also reports the phone number of an internal-id sender when it is visible (groups: participantPn, private
  // chats: senderPn). It comes from WhatsApp's server, so a person linked by phone number can be recognised in groups.
  const pn = isGroup ? key.participantPn : key.senderPn;
  const pnUser = typeof pn === 'string' && /@s\.whatsapp\.net$/.test(pn) ? pn.split('@')[0].split(':')[0] : '';
  const senderPhoneId = isPrivateLid && /^\d{8,15}$/.test(pnUser) ? `+${pnUser}` : undefined;
  const seconds = Number(m.messageTimestamp);
  const timestamp = Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : new Date().toISOString();
  return { channel: 'whatsapp', senderId, conversationId: chat, messageId: String(key.id), text, timestamp, isGroup, mentioned, ...(senderPhoneId ? { senderPhoneId } : {}) };
}

const SAVE_FLUSH_MS = 5000;

export class WhatsAppAdapter {
  private socket: SocketLike | null = null;
  private state: WaState = 'stopped';
  private account: string | null = null;
  private lastConnectedAt: string | null = null;
  private lastDisconnectedAt: string | null = null;
  private attempts = 0;
  private timer: unknown = null;
  private stopping = false;
  private saveChain: Promise<void> = Promise.resolve();
  private qrPending = false;
  // The latest pairing code, in memory only, for the admin page. Never logged, never written anywhere else by this field.
  private qr: { value: string; issuedAt: number } | null = null;
  private pairingRounds = 0;
  private chains = new Map<string, Promise<void>>();

  constructor(private readonly d: AdapterDeps) {}

  private log(level: 'info' | 'warn' | 'error', message: string) { (this.d.log ?? defaultLog)(level, message); }
  private now() { return this.d.now ? this.d.now() : Date.now(); }

  private sweep: ReturnType<typeof setInterval> | null = null;

  async start(): Promise<void> {
    if (!this.d.config.enabled || !this.d.config.sessionDir) { this.state = 'stopped'; return; }
    this.stopping = false;
    const enforce = this.d.enforce ?? enforceSessionPermissions;
    enforce(this.d.config.sessionDir);
    this.sweep = setInterval(() => { try { enforce(this.d.config.sessionDir!); } catch { /* next pass retries */ } }, this.d.sweepMs ?? 5000);
    this.sweep.unref?.();
    await this.connect();
  }

  private async connect(): Promise<void> {
    if (this.stopping) return;
    this.state = 'starting';
    try {
      const { socket, saveCreds } = await this.d.makeSocket(this.d.config.sessionDir!);
      this.socket = socket;
      // Saves run one after another, so an older save can never finish after a newer one and leave stale keys on disk
      socket.ev.on('creds.update', () => {
        this.saveChain = this.saveChain
          .then(() => Promise.resolve(saveCreds()))
          .catch(() => this.log('error', 'could not save the WhatsApp session'));
      });
      socket.ev.on('connection.update', (u: any) => this.onConnection(u));
      socket.ev.on('messages.upsert', (payload: any) => this.onMessages(payload));
    } catch (e) {
      this.log('error', `WhatsApp could not start: ${safeMessage(e)}`);
      this.scheduleReconnect();
    }
  }

  private onConnection(u: any) {
    if (this.stopping) return;
    if (u.qr) {
      this.qrPending = true;
      this.state = 'awaiting_qr';
      this.qr = { value: String(u.qr), issuedAt: this.now() };
      if (this.d.writeQr) { this.d.writeQr(String(u.qr)); this.log('info', 'a pairing code is ready in the private QR file: scan it from the company phone'); }
      else this.log('warn', 'a pairing code is ready but no private QR file is configured (ASSISTANT_WHATSAPP_QR_FILE)');
    }
    if (u.connection === 'open') {
      this.state = 'connected';
      this.qrPending = false;
      this.qr = null;
      this.attempts = 0;
      this.pairingRounds = 0;
      this.d.clearQr?.();
      this.lastConnectedAt = new Date(this.now()).toISOString();
      const id = this.socket?.user?.id;
      this.account = id ? maskNumber(String(id).split('@')[0].split(':')[0]) : null;
      this.log('info', 'WhatsApp connected');
    }
    if (u.connection === 'close') {
      this.qr = null;
      this.lastDisconnectedAt = new Date(this.now()).toISOString();
      const code = u.lastDisconnect?.error?.output?.statusCode;
      if (code === LOGGED_OUT || code === 403) {   // 403: WhatsApp refused this login
        this.account = null;
        this.socket = null;
        this.qrPending = false;
        this.pairingRounds++;
        if (this.pairingRounds > MAX_PAIRING_ROUNDS) {
          this.state = 'logged_out';
          this.log('error', 'the phone ended the WhatsApp session again and again: pairing stopped; restart the instance to try once more');
          return;
        }
        // The phone ended the session. Keep the old files aside, then start a clean connection so Baileys issues a new QR.
        this.log('warn', 'the phone ended the WhatsApp session: the old login is deleted and a new pairing code is being requested');
        this.state = 'starting';
        Promise.resolve()
          .then(() => (this.d.archiveSession ?? defaultArchive)(this.d.config.sessionDir!))
          .then((archived) => {
            this.log('info', `old session removed (${String(archived).split('/').pop()})`);
            if (!this.stopping) void this.connect();
          })
          .catch(() => {
            this.state = 'logged_out';
            this.log('error', 'the old session could not be moved aside; pairing stopped (check the session storage)');
          });
        return;
      }
      this.state = 'reconnecting';
      this.log('warn', `WhatsApp connection closed (code ${code ?? 'unknown'}); reconnecting`);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.stopping || this.d.noReconnect) return;
    this.attempts++;
    const delay = Math.min(60_000, 1000 * 2 ** Math.min(this.attempts, 6));
    const schedule = this.d.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms).unref?.());
    this.timer = schedule(() => { this.timer = null; void this.connect(); }, delay);
  }

  private onMessages(payload: any) {
    if (this.stopping || payload?.type !== 'notify') return;
    for (const raw of payload.messages ?? []) {
      this.logSenderType(raw);
      const msg = toIncoming(raw);
      if (!msg) { this.noteSkipped(raw); continue; }
      // One chain per chat: messages in a chat are handled in order; different chats run at the same time
      const chat = msg.conversationId;
      const prev = this.chains.get(chat) ?? Promise.resolve();
      const next: Promise<void> = prev.then(() => this.process(msg)).catch(() => {});
      this.chains.set(chat, next);
      void next.then(() => { if (this.chains.get(chat) === next) this.chains.delete(chat); });
    }
  }

  // Group policy: silent unless the company account is mentioned
  private groupAllowed(msg: IncomingMessage): boolean {
    if (!msg.isGroup) return true;
    // The company account can be mentioned by its phone id or by its @lid id; both are its own ids, nothing is inferred
    // Right after pairing socket.user may not carry the hidden id yet; the saved login (creds.me) does
    const self = (this.socket as any)?.user ?? {};
    const me = (this.socket as any)?.authState?.creds?.me ?? {};
    const own = [self.id, self.lid, me.id, me.lid].filter(Boolean).map((id: string) => String(id).split('@')[0].split(':')[0]);
    const matched = (msg.mentioned ?? []).some((m) => own.includes(m));
    // Diagnostic: counts only, never the text or any identifier
    this.log('info', `group message: mentions=${(msg.mentioned ?? []).length} company_matched=${matched} identities_known=${own.length}`);
    // Every mention is handled straight away: no request is held back or dropped by a timer
    return !!own.length && matched;
  }

  // Diagnostic only: the identifier type and the last four characters. Never the text, never a full number.
  private logSenderType(raw: any) {
    const key = raw?.key;
    if (!key?.remoteJid || key.fromMe) return;
    const jid = String(key.participant ?? key.remoteJid);
    const user = jid.split('@')[0].split(':')[0];
    const server = jid.split('@')[1] ?? 'none';
    const type = server === 'lid' ? 'lid' : server === 's.whatsapp.net' ? 'phone' : server;
    const chat = String(key.remoteJid).endsWith('@g.us') ? 'group' : 'private';
    this.log('info', `sender identifier: type=${type} last4=${user.slice(-4)} chat=${chat} hasParticipant=${Boolean(key.participant)} hasPhone=${Boolean(key.participantPn ?? key.senderPn)}`);
  }

  private note(msg: IncomingMessage, outcome: import('./activity').WaOutcome) {
    try { this.d.onEvent?.({ chat: msg.isGroup ? 'group' : 'private', outcome, senderId: msg.senderId, senderPhoneId: msg.senderPhoneId, conversationId: msg.conversationId }); } catch { /* never affects replies */ }
  }

  // A message the bot cannot use: one it could not decrypt yet, or one that is not text (photo, sticker, voice note)
  private noteSkipped(raw: any) {
    const key = raw?.key;
    const chat: string = String(key?.remoteJid ?? '');
    if (!key || key.fromMe || !chat || chat.endsWith('@broadcast') || chat.endsWith('@newsletter')) return;
    const isGroup = chat.endsWith('@g.us');
    const sender = String((isGroup ? key.participant : chat) ?? '');
    const user = sender.split('@')[0].split(':')[0];
    const senderId = sender.endsWith('@lid') ? `lid:${user}` : /^\d{8,15}$/.test(user) ? `+${user}` : `opaque:${user}`;
    const undecryptable = raw?.messageStubType === 2 || (!raw?.message && Array.isArray(raw?.messageStubParameters));
    try { this.d.onEvent?.({ chat: isGroup ? 'group' : 'private', outcome: undecryptable ? 'could_not_decrypt' : 'not_text', senderId, conversationId: chat }); } catch { /* ignore */ }
  }

  // Hidden id -> phone number, from the group's member list (WhatsApp's server sends both for every member). Used when a
  // message arrives without the sender's phone number, so people linked by phone number are still recognised.
  private memberPhones = new Map<string, { at: number; map: Map<string, string> }>();
  private async phoneForMember(groupJid: string, lidUser: string): Promise<string | undefined> {
    if (!this.socket?.groupMetadata) return undefined;
    const cached = this.memberPhones.get(groupJid);
    if (cached?.map.has(lidUser)) return cached.map.get(lidUser);        // a member's id-to-number pairing does not change
    if (cached && this.now() - cached.at < 60_000) return undefined;     // refreshed a moment ago: not found, don't ask again
    try {
      const meta = await this.socket.groupMetadata(groupJid);
      const map = new Map<string, string>();
      for (const p of meta?.participants ?? []) {
        const lid = String(p.lid ?? (String(p.id ?? '').endsWith('@lid') ? p.id : '')).split('@')[0].split(':')[0];
        const pn = String(p.jid ?? '').endsWith('@s.whatsapp.net') ? String(p.jid).split('@')[0].split(':')[0] : '';
        if (lid && /^\d{8,15}$/.test(pn)) map.set(lid, `+${pn}`);
      }
      this.memberPhones.set(groupJid, { at: this.now(), map });
      return map.get(lidUser);
    } catch { return cached?.map.get(lidUser); }
  }

  private async process(msg: IncomingMessage) {
    if (!this.groupAllowed(msg)) { if (msg.isGroup) this.note(msg, 'not_mentioned'); return; }
    if (msg.isGroup && !msg.senderPhoneId && msg.senderId.startsWith('lid:')) {
      const pn = await this.phoneForMember(msg.conversationId, msg.senderId.slice(4));
      if (pn) msg = { ...msg, senderPhoneId: pn };
    }
    try {
      const reply = await this.d.handle(msg);
      if (!reply || !reply.text || this.stopping || !this.socket) { this.note(msg, 'not_recognised'); return; }
      const mentions = reply.mentions?.length ? { mentions: reply.mentions } : {};
      let image: Buffer | undefined;
      if (reply.card) try { image = renderCard(reply.card); } catch { image = undefined; }   // text alone if the picture fails
      await this.socket.sendMessage(msg.conversationId, image ? { image, caption: `📋 *${reply.card!.title}*`, ...mentions } : { text: reply.text, ...mentions });
      this.note(msg, 'replied');
    } catch (e) {
      this.log('error', `a reply could not be sent: ${safeMessage(e)}`);
      this.note(msg, 'send_failed');
    }
  }

  // The current pairing code, only while the existing connection is actually waiting for one
  pairingCode(): { qr: string; issuedAt: string } | null {
    return this.state === 'awaiting_qr' && this.qr ? { qr: this.qr.value, issuedAt: new Date(this.qr.issuedAt).toISOString() } : null;
  }

  // A new pairing round, only after pairing stopped (the phone refused several codes). Reuses this adapter and its
  // session folder; nothing is cleared. Returns false in every other state, where Baileys issues codes by itself.
  requestNewPairing(): boolean {
    if (this.state !== 'logged_out' || this.stopping) return false;
    this.pairingRounds = 0;
    this.log('info', 'a new pairing round was requested by an administrator');
    void this.connect();
    return true;
  }

  isConnected(): boolean { return this.state === 'connected' && !!this.socket; }

  // Names and JIDs of the groups this account is in. Read-only.
  async listGroups(): Promise<{ name: string; jid: string }[]> {
    if (!this.isConnected() || !this.socket?.groupFetchAllParticipating) return [];
    const all = await this.socket.groupFetchAllParticipating();
    return Object.values(all).map((g) => ({ name: String(g.subject ?? ''), jid: String(g.id ?? '') })).filter((g) => g.jid.endsWith('@g.us'));
  }

  // Group notices only. The caller validates the destination; nothing here sends to any other chat.
  async sendGroup(jid: string, text: string, mentions: string[], image?: Buffer): Promise<boolean> {
    if (!this.isConnected() || !this.socket) return false;
    await this.socket.sendMessage(jid, image ? { image, caption: text, mentions } : { text, mentions });
    return true;
  }

  status(): WaStatus {
    return {
      enabled: this.d.config.enabled, state: this.state, account: this.account,
      lastConnectedAt: this.lastConnectedAt, lastDisconnectedAt: this.lastDisconnectedAt,
      reconnectAttempts: this.attempts, qrPending: this.qrPending,
    };
  }

  async stop(): Promise<void> {
    this.stopping = true;
    // Let queued session saves finish before the socket closes, but never wait forever
    await Promise.race([
      this.saveChain,
      new Promise<void>((resolve) => { const t = setTimeout(resolve, SAVE_FLUSH_MS); t.unref?.(); }),
    ]);
    if (this.sweep) { clearInterval(this.sweep); this.sweep = null; }
    if (this.timer) { (this.d.unschedule ?? clearTimeout)(this.timer as any); this.timer = null; }
    try { this.socket?.end(undefined); } catch { /* already closed */ }
    this.socket = null;
    this.state = 'stopped';
    this.qrPending = false;
    this.log('info', 'WhatsApp stopped');
  }
}
