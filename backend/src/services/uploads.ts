/// <reference types="node" />
// Uploaded files: safe names, signed links, and how /uploads is served.
// Files are only reachable with a link the API signed while answering a request it had already permission-checked
// (chat, deliverables, contact-form files, the asset library). Avatars are the one public exception (shown on the
// public share pages). Every upload is served sandboxed, so an uploaded page can never run as Loop.
import crypto from 'crypto';
import path from 'path';
import type { Request, Response, NextFunction } from 'express';

// Extensions kept as they are; anything else (HTML, SVG, JS, XML…) is stored as .bin and can only be downloaded
const SAFE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.csv', '.txt',
  '.zip', '.mp4', '.mov', '.webm', '.m4a', '.mp3', '.wav', '.ai', '.psd', '.eps', '.fig', '.sketch', '.rtf', '.odt', '.ods', '.key', '.pages', '.numbers']);
export const safeExt = (original: string) => { const e = path.extname(original || '').toLowerCase(); return SAFE_EXT.has(e) ? e : '.bin'; };
/** A random, unguessable name keeping only a permitted extension. */
export const uploadName = (original: string, prefix = '') => `${prefix}${crypto.randomUUID()}${safeExt(original)}`;
/** multer diskStorage filename callback using uploadName. */
export const multerName = (prefix = '') => (_req: unknown, file: { originalname: string }, cb: (e: Error | null, name: string) => void) => cb(null, uploadName(file.originalname, prefix));

const secret = () => process.env.JWT_SECRET || '';
const PUBLIC = /^\/uploads\/avatar-[\w.-]+$/;   // avatars only: explicit, limited public exception
const WINDOW = 12 * 3600;   // links last 12-24 h; the end is rounded so the same file keeps the same link (cacheable)
const sig = (p: string, exp: number) => crypto.createHmac('sha256', secret()).update(`upload:${p}:${exp}`).digest('base64url');

/** Signs an /uploads path. Anything that isn't an /uploads path is returned unchanged. */
export function signUpload(url: string, now = Date.now()): string {
  if (typeof url !== 'string' || !url.startsWith('/uploads/') || url.includes('?') || PUBLIC.test(url) || !secret()) return url;
  const exp = (Math.floor(now / 1000 / WINDOW) + 2) * WINDOW;
  return `${url}?e=${exp}&s=${sig(url, exp)}`;
}
export function uploadAllowed(p: string, e: unknown, s: unknown, now = Date.now()): boolean {
  if (PUBLIC.test(p)) return true;
  const exp = Number(e);
  if (!secret() || !(exp > now / 1000) || typeof s !== 'string') return false;
  const want = sig(p, exp);
  return s.length === want.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(want));
}

// Rewrites every /uploads/… string in an API answer into a signed link. The answer was already permission-checked
// by its route, so the link carries exactly that permission.
export function signDeep<T>(v: T, depth = 0): T {
  if (depth > 12 || v == null) return v;
  if (typeof v === 'string') return signUpload(v) as any;
  if (Array.isArray(v)) return v.map((x) => signDeep(x, depth + 1)) as any;
  if (typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v)) {
    const out: any = {};
    for (const [k, x] of Object.entries(v as any)) out[k] = signDeep(x, depth + 1);
    return out;
  }
  return v;
}
export function signUploadLinks(_req: Request, res: Response, next: NextFunction) {
  const json = res.json.bind(res);
  res.json = (body: any) => json(signDeep(body));
  next();
}

// Inline only for types a browser shows without running code; everything else downloads
const INLINE = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.mp4', '.webm', '.mov', '.m4a', '.mp3', '.wav']);
export function guardUploads(req: Request, res: Response, next: NextFunction) {
  const p = `/uploads${decodeURIComponent(req.path)}`;
  if (p.includes('..') || !uploadAllowed(p, req.query.e, req.query.s)) { res.status(403).json({ error: 'This link has expired. Please open the file again from Loop.' }); return; }
  res.setHeader('Content-Security-Policy', 'sandbox');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  if (!INLINE.has(path.extname(p).toLowerCase())) res.setHeader('Content-Disposition', 'attachment');
  next();
}
