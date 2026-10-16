// One date format across the app: DD-MM-YYYY (and DD-MM-YYYY, h:mm AM when a time is shown).

// Accepts Date, epoch ms, 'YYYY-MM-DD' (a calendar day — local), 'YYYY-MM-DD HH:MM:SS' (server UTC) or ISO.
export function toDate(v: any): Date | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = String(v);
  let d: Date;
  if (/^\d+$/.test(s)) d = new Date(Number(s));
  else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const [y, m, day] = s.split('-').map(Number); d = new Date(y, m - 1, day); }
  else d = new Date(s.includes('T') || s.includes('Z') || s.includes('+') ? s : s.replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? null : d;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function fmtDate(v: any, fallback = '—'): string {
  const d = toDate(v);
  return d ? `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}` : fallback;
}

export function fmtTime(v: any): string {
  const d = toDate(v);
  if (!d) return '';
  const h = d.getHours();
  return `${h % 12 || 12}:${pad(d.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
}

export function fmtDateTime(v: any, fallback = '—'): string {
  const d = toDate(v);
  return d ? `${fmtDate(d)}, ${fmtTime(d)}` : fallback;
}
