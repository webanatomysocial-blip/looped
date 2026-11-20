/// <reference types="node" />
// Safari on iPhone records MP4 whose video frames are each stamped 1/600 s long, so a 30-second part plays in about
// 2 seconds ("fast-forwarded"). Knowing how long the part really ran, this spreads that time evenly over the frames.
// Only the duration numbers are rewritten (on a copy: see recordingMedia), same size, no re-encoding.

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'mvex', 'moof', 'traf']);
type Box = { type: string; start: number; body: number; end: number };
function boxes(b: Buffer, start: number, end: number, out: Box[] = []): Box[] {
  for (let p = start; p + 8 <= end;) {
    let size = b.readUInt32BE(p); let head = 8;
    if (size === 1) { if (p + 16 > end) break; size = Number(b.readBigUInt64BE(p + 8)); head = 16; }
    if (size === 0) size = end - p;
    if (size < head || p + size > end) break;
    const box = { type: b.toString('latin1', p + 4, p + 8), start: p, body: p + head, end: p + size };
    out.push(box);
    if (CONTAINERS.has(box.type)) boxes(b, box.body, box.end, out);
    p += size;
  }
  return out;
}

/** Rewrites the video frame durations so the video lasts `realMs`. Returns how many frames were fixed (0: left as is). */
export function fixVideoTiming(b: Buffer, realMs: number): number {
  if (!(realMs > 0) || b.toString('latin1', 4, 8) !== 'ftyp') return 0;
  const all = boxes(b, 0, b.length);
  // The video track: its id (tkhd) and timescale (mdhd), from the trak whose handler is "vide"
  let videoId = -1; let timescale = 0;
  for (const trak of all.filter((x) => x.type === 'trak')) {
    const inside = all.filter((x) => x.start > trak.start && x.end <= trak.end);
    const hdlr = inside.find((x) => x.type === 'hdlr'); const tkhd = inside.find((x) => x.type === 'tkhd'); const mdhd = inside.find((x) => x.type === 'mdhd');
    if (!hdlr || !tkhd || !mdhd || b.toString('latin1', hdlr.body + 8, hdlr.body + 12) !== 'vide') continue;
    videoId = b.readUInt32BE(tkhd.body + (b[tkhd.body] === 1 ? 20 : 12));
    timescale = b.readUInt32BE(mdhd.body + (b[mdhd.body] === 1 ? 20 : 12));
  }
  if (videoId < 0 || !timescale) return 0;
  // Each frame's duration lives either in its own field (trun) or in its fragment's shared default (tfhd), which
  // covers every frame of that fragment without its own field. The iPhone mixes both, so both are rewritten.
  const own: number[] = []; const shared = new Map<number, number>();   // default field position -> frames using it
  let track = -1; let def = -1;
  for (const x of all) {
    if (x.type === 'tfhd') {
      track = b.readUInt32BE(x.body + 4); const flags = b.readUInt32BE(x.body) & 0xffffff;
      def = flags & 8 ? x.body + 8 + (flags & 1 ? 8 : 0) + (flags & 2 ? 4 : 0) : -1;
    }
    if (x.type !== 'trun' || track !== videoId) continue;
    const flags = b.readUInt32BE(x.body) & 0xffffff; const n = b.readUInt32BE(x.body + 4);
    if (!(flags & 0x100)) {
      if (def < 0) return 0;   // the length comes from somewhere this does not handle: leave the file alone
      shared.set(def, (shared.get(def) ?? 0) + n); continue;
    }
    let q = x.body + 8 + (flags & 1 ? 4 : 0) + (flags & 4 ? 4 : 0);
    const step = 4 * (1 + (flags & 0x200 ? 1 : 0) + (flags & 0x400 ? 1 : 0) + (flags & 0x800 ? 1 : 0));
    for (let i = 0; i < n && q + 4 <= x.end; i++, q += step) own.push(q);
  }
  const frames = own.length + [...shared.values()].reduce((a, n) => a + n, 0);
  if (!frames) return 0;
  const total = own.reduce((t, q) => t + b.readUInt32BE(q), 0) + [...shared].reduce((t, [q, n]) => t + b.readUInt32BE(q) * n, 0);
  const want = Math.round((realMs / 1000) * timescale);
  if (Math.abs(total - want) <= want * 0.2) return 0;   // already about right: a healthy file is never touched
  // Spread the real length evenly; the remainder goes one tick at a time to frames with their own field
  const base = Math.max(1, Math.floor(want / frames)); let extra = want - base * frames;
  for (const q of shared.keys()) b.writeUInt32BE(base, q);
  for (const q of own) { b.writeUInt32BE(base + (extra > 0 ? 1 : 0), q); if (extra > 0) extra--; }
  return frames;
}

/** The real type of a recording from its first bytes (the browser does not always say). */
export const sniffVideo = (b: Buffer): string | null =>
  b.length >= 8 && b.toString('latin1', 4, 8) === 'ftyp' ? 'video/mp4' : b.length >= 4 && b.readUInt32BE(0) === 0x1a45dfa3 ? 'video/webm' : null;

