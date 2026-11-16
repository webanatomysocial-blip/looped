import crypto from 'crypto';
import { Request } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

// Per signed-in session (hash of the bearer token), else per IP. Behind a proxy or office NAT many people
// share one IP, so counting authenticated traffic by IP would throttle the whole team together.
function sessionKey(req: Request): string {
  const token = req.headers.authorization?.split(' ')[1];
  if (token) return 't:' + crypto.createHash('sha256').update(token).digest('hex').slice(0, 32);
  return 'ip:' + ipKeyGenerator(req.ip || '');
}

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Read-receipt pings the Messages page sends every 4 s: idempotent, not user changes, so they must not use up the write budget
const NOT_COUNTED_AS_WRITE = ['/api/messages/mark-read', '/api/notifications/mark-all-read'];
const base = { standardHeaders: true, legacyHeaders: false, keyGenerator: sessionKey } as const;

// The busiest page polls about every 4–10 s and a page load fires ~20–30 requests, so normal use with
// several tabs stays well under these.
export const LIMITS = {
  api: { windowMs: 5 * 60 * 1000, limit: 1500 },
  writes: { windowMs: 5 * 60 * 1000, limit: 300 },
  sensitive: { windowMs: 15 * 60 * 1000, limit: 30 },
  publicLinks: { windowMs: 5 * 60 * 1000, limit: 300 },
};

export const apiLimiter = rateLimit({ ...base, ...LIMITS.api, message: { error: 'Too many requests — please slow down' } });
export const writeLimiter = rateLimit({ ...base, ...LIMITS.writes, skip: (req) => !WRITE.has(req.method) || NOT_COUNTED_AS_WRITE.some((p) => req.originalUrl.startsWith(p)), message: { error: 'Too many changes in a short time — please wait a moment' } });
// Account and permission changes
export const sensitiveLimiter = rateLimit({ ...base, ...LIMITS.sensitive, skip: (req) => !WRITE.has(req.method), message: { error: 'Too many account changes — try again later' } });
// Unauthenticated share links (task / SEO / ads reports)
export const publicLinkLimiter = rateLimit({ ...base, ...LIMITS.publicLinks, message: { error: 'Too many requests' } });
