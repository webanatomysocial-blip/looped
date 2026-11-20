/// <reference types="node" />
// Interview recordings after upload: rebuild each part from its chunks, put the separately recorded sound (Apple
// devices) into the video, join the parts in order, then measure the result's real audio and video tracks.
// Nothing is re-encoded (stream copy only), and the uploaded originals are never changed or deleted here.
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fixVideoTiming } from './mp4Timing';

// Bundled with the app (npm ffmpeg-static), so no system install is needed; FFMPEG_PATH overrides it
const ffmpegBin = (): string | null => {
  const p = process.env.FFMPEG_PATH || (() => { try { return require('ffmpeg-static') as string; } catch { return null; } })();
  return p && fs.existsSync(p) ? p : null;
};
export const mediaToolsAvailable = () => !!ffmpegBin();

const run = (args: string[]) => new Promise<{ code: number; err: string }>((resolve) => {
  const bin = ffmpegBin(); if (!bin) return resolve({ code: -1, err: 'ffmpeg missing' });
  execFile(bin, ['-hide_banner', '-nostdin', ...args], { maxBuffer: 32 * 1024 * 1024, timeout: 10 * 60_000 }, (e, _out, err) => resolve({ code: e ? (typeof (e as any).code === 'number' ? (e as any).code : 1) : 0, err: String(err) }));
});

export type Track = { codec: string; seconds: number; start: number };
export type Probe = { valid: boolean; video: Track | null; audio: Track | null; error?: string };

// Track lengths come from reading every packet of the track (not the header, which browsers often leave empty)
async function trackSeconds(file: string, sel: 'v' | 'a'): Promise<number> {
  const r = await run(['-i', file, '-map', `0:${sel}:0`, '-c', 'copy', '-f', 'null', '-']);
  const times = [...r.err.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  if (!times.length) return 0;
  const [, h, m, s] = times[times.length - 1];
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}
export async function probe(file: string): Promise<Probe> {
  if (!fs.existsSync(file)) return { valid: false, video: null, audio: null, error: 'file missing' };
  const info = await run(['-i', file]);   // exits non-zero by design (no output named); the stream list is in stderr
  if (/Invalid data found|could not find codec|moov atom not found|EBML header parsing failed/i.test(info.err)) return { valid: false, video: null, audio: null, error: 'not a readable recording' };
  const start = Number(/start: (-?\d+(?:\.\d+)?)/.exec(info.err)?.[1] ?? 0);
  const vc = /Stream #0:\d+.*?: Video: (\w+)/.exec(info.err)?.[1]; const ac = /Stream #0:\d+.*?: Audio: (\w+)/.exec(info.err)?.[1];
  // A full read of the file: it must decode cleanly as a container to count as playable
  const check = await run(['-v', 'error', '-i', file, '-map', '0', '-c', 'copy', '-f', 'null', '-']);
  const valid = check.code === 0 && !!(vc || ac);
  return {
    valid,
    video: vc ? { codec: vc, seconds: await trackSeconds(file, 'v'), start } : null,
    audio: ac ? { codec: ac, seconds: await trackSeconds(file, 'a'), start } : null,
    ...(valid ? {} : { error: 'the recording could not be read through' }),
  };
}

export type PartIn = { n: number; video: string; mime: string; ms?: number; audio?: string | null; audioOffsetMs?: number };
export type PartOut = { n: number; file: string | null; probe: Probe; expected: number | null; problems: string[] };

const extFor = (mime: string) => (mime === 'video/mp4' ? 'mp4' : 'webm');

/** One playable file per part: timing repaired on a copy when needed, separate sound put in, stream-copied. */
export async function buildPart(p: PartIn, workDir: string): Promise<PartOut> {
  const problems: string[] = [];
  const expected = p.ms ? p.ms / 1000 : null;
  let video = p.video;
  if (p.mime === 'video/mp4' && p.ms) {
    // iPhone stamps frames far too short: fix a copy, never the uploaded original
    const b = fs.readFileSync(p.video);
    if (fixVideoTiming(b, p.ms)) { video = path.join(workDir, `part-${p.n}-timed.mp4`); fs.writeFileSync(video, b); }
  }
  const out = path.join(workDir, `part-${p.n}.${extFor(p.mime)}`);
  const args = ['-y', '-i', video];
  if (p.audio) args.push(...(p.audioOffsetMs ? ['-itsoffset', String(p.audioOffsetMs / 1000)] : []), '-i', p.audio);
  args.push('-map', '0:v:0?', '-map', p.audio ? '1:a:0?' : '0:a:0?', '-c', 'copy');
  if (p.mime === 'video/mp4') args.push('-movflags', '+faststart');
  args.push(out);
  const r = await run(args);
  if (r.code !== 0 || !fs.existsSync(out)) return { n: p.n, file: null, probe: { valid: false, video: null, audio: null, error: 'part could not be rebuilt' }, expected, problems: [`part ${p.n + 1}: could not be rebuilt`] };
  const pr = await probe(out);
  if (!pr.valid) problems.push(`part ${p.n + 1}: not playable`);
  if (!pr.video) problems.push(`part ${p.n + 1}: no video`);
  if (!pr.audio) problems.push(`part ${p.n + 1}: no sound`);
  return { n: p.n, file: out, probe: pr, expected, problems };
}

/** Joins parts in order into one file (stream copy). Null when the parts can't be joined without re-encoding. */
export async function joinParts(parts: PartOut[], workDir: string): Promise<string | null> {
  const files = parts.map((p) => p.file).filter((f): f is string => !!f);
  if (!files.length) return null;
  const ext = path.extname(files[0]);
  if (files.some((f) => path.extname(f) !== ext)) return null;   // a format change mid-interview: parts stay separate
  const out = path.join(workDir, `final${ext}`);
  if (files.length === 1) { fs.copyFileSync(files[0], out); return out; }
  const list = path.join(workDir, 'parts.txt');
  fs.writeFileSync(list, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
  const r = await run(['-y', '-f', 'concat', '-safe', '0', '-i', list, '-map', '0', '-c', 'copy', ...(ext === '.mp4' ? ['-movflags', '+faststart'] : []), out]);
  return r.code === 0 && fs.existsSync(out) ? out : null;
}

// How close is close enough: browsers start and stop each track a fraction of a second apart
export const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(1.5, b * 0.1);
