// Shared WhatsApp message presentation: every automated or AI-assisted group message is built from these pieces, so they
// all look the same. Plain text with WhatsApp formatting only (bold, italics, bullets).
//
// Interactive messages: Baileys 6.7.24 can build buttons, lists and templates, but WhatsApp no longer renders them for
// accounts that are not on the official Business API (they arrive blank or as "unsupported message"). Polls render, but
// reading votes needs per-poll secrets kept and decrypted. So the interaction is text quick replies (QUICK_REPLIES),
// each mapped to an existing, permission-checked answer. ponytail: add native polls if votes ever need to drive actions.

const TZ = 'Asia/Kolkata';
const MAX_TEXT = 80;
export const MAX_ITEMS = 5;

// Help is hidden from WhatsApp for now. Set to true to bring back the HELP command and its mentions.
export const HELP_ENABLED = false;

export const ICON = {
  pending: '🕒', overdue: '⚠️', completed: '✅', accepted: '👍', declined: '❌', running: '▶️',
  task: '📌', reassigned: '🔄', reminder: '⏰', deadline: '⏳', morning: '☀️', evening: '🌇',
  hours: '⏱️', workload: '📊', summary: '📈', list: '📋', top: '🔝', help: '💡', info: 'ℹ️', error: '⚠️', lock: '🔒', question: '❓',
} as const;

// One line of user data: no line breaks or control characters, no asterisks (they would toggle bold), collapsed spaces,
// cut to a readable length
export function clean(v: unknown, max = MAX_TEXT): string {
  const s = String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\*/g, '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}
export const bold = (v: unknown, max = MAX_TEXT) => `*${clean(v, max)}*`;
export const italic = (v: unknown) => `_${clean(v, 300).replace(/_/g, ' ')}_`;
export const heading = (icon: string, title: string) => `${icon} ${bold(title)}`;
export const field = (label: string, value: string) => `${bold(`${label}:`)} ${value}`;
export const bullet = (text: string, level = 0) => `${'   '.repeat(level)}• ${text}`;

// A list capped at max items, with "…and N more" instead of a wall of lines
export function capped(lines: string[], max = MAX_ITEMS): string[] {
  return lines.length > max ? [...lines.slice(0, max), `…and ${lines.length - max} more`] : lines;
}

// Blocks separated by exactly one blank line. Empty blocks are dropped, so there are never stacked blank lines.
export function compose(...blocks: (string | string[] | null | undefined | false)[]): string {
  return blocks
    .map((b) => (Array.isArray(b) ? b.filter((l) => l !== '' && l != null).join('\n') : (b || '')))
    .map((b) => b.trim())
    .filter(Boolean)
    .join('\n\n');
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const priority = (p: string | null | undefined) => (p ? `${p.charAt(0).toUpperCase()}${p.slice(1).toLowerCase()}` : 'No priority');

const fmt = (opts: Intl.DateTimeFormatOptions) => (ms: number) => new Intl.DateTimeFormat('en-IN', { timeZone: TZ, ...opts }).format(new Date(ms));
export const dateTime = fmt({ day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
export const timeOnly = fmt({ hour: 'numeric', minute: '2-digit', hour12: true });
export const dayLabel = fmt({ weekday: 'short', day: 'numeric', month: 'short' });

// Quick replies: short words a manager or admin can send with the bot mention. Each maps to an existing answer.
export const QUICK_REPLIES: Record<string, 'pending_overdue' | 'workload' | 'summary' | 'completed' | 'hours' | 'no_hours' | 'highest_workload'> = {
  pending: 'pending_overdue', overdue: 'pending_overdue', workload: 'workload', summary: 'summary',
  completed: 'completed', hours: 'hours', 'no hours': 'no_hours', top: 'highest_workload',
};
export const QUICK_REPLY_LINE = italic('Quick replies (mention me): pending · workload · summary · completed · hours');

// The standard short replies
export const msg = {
  error: () => compose(heading(ICON.error, 'Something went wrong'), "I couldn't look that up right now. Please try again in a moment."),
  unknown: () => compose(heading(ICON.question, "I'm not sure what you'd like to know"), 'Try asking about tasks, hours, workload or the team summary.'),
  managersOnly: () => compose(heading(ICON.lock, 'Not available'), 'Productivity questions are available to managers and admins only.'),
  notFound: (name: string) => compose(heading(ICON.info, 'No match'), `I couldn't find anyone called ${bold(name)} in your team.`),
  ambiguous: (name: string, options: string[]) => compose(heading(ICON.question, `Which ${clean(name)}?`), capped(options.map((o) => bullet(clean(o)))), italic('Reply with the full name.')),
  empty: (title: string, text: string) => compose(heading(ICON.info, title), text),
};

// Private-chat replies to linked users (the conversation engine). Same building blocks as the group messages.
export const pm = {
  greeting: (draft = '') => compose(heading('👋', 'Welcome to Loop'), "Hi! I'm your Loop assistant. How can I help you today?", draft),
  help: (lines: string[], draft = '') => compose(
    heading(ICON.help, 'What I can help with'), lines,
    'Task management is handled in the Loop app, where you can create, view, assign and manage your tasks.',
    italic('Productivity notifications and reminders are coming to WhatsApp soon.'), draft,
  ),
  draft: (question: string) => compose(heading(ICON.list, 'You still have an open request'), clean(question, 300), italic('Reply to continue, or CANCEL to drop it.')),
  notUnderstood: () => compose(heading(ICON.question, "I didn't quite catch that"), 'Please rephrase your request, or ask about your tasks in Loop.'),
  unavailable: () => compose(
    heading(ICON.lock, 'Not available on WhatsApp'),
    'Task management is handled in the Loop app. You can create, view, assign and manage your tasks there.',
    italic("We're bringing productivity notifications and reminders to WhatsApp soon."),
  ),
  error: () => compose(heading(ICON.error, 'Something went wrong'), 'Please try again in a few minutes.'),
  lookupError: () => compose(heading(ICON.error, "Couldn't look that up"), 'Please try again in a moment.'),
  cancelled: (what = '') => `${ICON.declined} ${bold('Cancelled')}${what ? ` — ${clean(what, 120)}` : ''}`,
  info: (text: string) => `${ICON.info} ${text}`,
  list: (title: string, lines: string[], footer = '') => compose(heading(ICON.list, title), lines, footer ? italic(footer) : ''),
};
// Final tidy for any private reply: no stacked blank lines, no stray spacing
export const tidy = (text: string) => String(text).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
