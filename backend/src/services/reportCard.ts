// Draws a report as a PNG table card. Made on the server from report numbers: no AI, no browser, no network.
import path from 'path';
import { Resvg } from '@resvg/resvg-js';

export interface CardColumn { label: string; tone?: 'good' | 'warn' | 'bad' }
export interface Card { title: string; subtitle: string; columns: CardColumn[]; rows: { name: string; note?: string; values: (number | string)[] }[]; footer?: string }

const FONT_DIR = path.join(path.dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf');
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const TONE = { good: '#15803d', warn: '#b45309', bad: '#dc2626' };

export function cardSvg(c: Card): string {
  const W = 1000, PAD = 40, ROW = 56, HEAD = 150, NAME_W = 330;
  const colW = (W - PAD * 2 - NAME_W) / c.columns.length;
  const H = HEAD + 50 + c.rows.length * ROW + (c.footer ? 70 : 30);
  const x = (i: number) => PAD + NAME_W + colW * i + colW / 2;
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="DejaVu Sans">`,
    `<rect width="${W}" height="${H}" fill="#ffffff"/>`,
    `<rect width="${W}" height="${HEAD}" fill="#1e293b"/>`,
    `<text x="${PAD}" y="70" font-size="34" font-weight="bold" fill="#ffffff">${esc(cut(c.title, 48))}</text>`,
    `<text x="${PAD}" y="112" font-size="20" fill="#cbd5e1">${esc(cut(c.subtitle, 80))}</text>`,
    `<text x="${PAD}" y="${HEAD + 34}" font-size="17" font-weight="bold" fill="#64748b">EMPLOYEE</text>`,
    ...c.columns.map((col, i) => `<text x="${x(i)}" y="${HEAD + 34}" font-size="17" font-weight="bold" fill="#64748b" text-anchor="middle">${esc(col.label.toUpperCase())}</text>`),
  ];
  c.rows.forEach((r, n) => {
    const top = HEAD + 50 + n * ROW;
    if (n % 2 === 0) out.push(`<rect x="0" y="${top}" width="${W}" height="${ROW}" fill="#f1f5f9"/>`);
    const mid = top + ROW / 2 + 7;
    out.push(`<text x="${PAD}" y="${r.note ? mid - 8 : mid}" font-size="21" font-weight="bold" fill="#0f172a">${esc(cut(r.name, 24))}</text>`);
    if (r.note) out.push(`<text x="${PAD}" y="${mid + 14}" font-size="15" fill="#64748b">${esc(cut(r.note, 34))}</text>`);
    r.values.forEach((v, i) => {
      const tone = c.columns[i].tone;
      const color = v === 0 ? '#cbd5e1' : tone && typeof v === 'number' ? TONE[tone] : '#334155';   // zeros fade so problems stand out
      out.push(`<text x="${x(i)}" y="${mid}" font-size="22" font-weight="${color === '#334155' ? 'normal' : 'bold'}" fill="${color}" text-anchor="middle">${esc(String(v))}</text>`);
    });
  });
  if (c.footer) out.push(`<text x="${PAD}" y="${H - 30}" font-size="15" fill="#94a3b8">${esc(cut(c.footer, 110))}</text>`);
  out.push('</svg>');
  return out.join('');
}

export function renderCard(c: Card): Buffer {
  return new Resvg(cardSvg(c), {
    font: { fontFiles: [path.join(FONT_DIR, 'DejaVuSans.ttf'), path.join(FONT_DIR, 'DejaVuSans-Bold.ttf')], loadSystemFonts: false, defaultFontFamily: 'DejaVu Sans' },
  }).render().asPng();
}
