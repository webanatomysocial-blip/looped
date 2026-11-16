import { Router, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { getDB } from '../db';
import { authenticate, requireRoles, AuthRequest } from '../middleware/auth';
import { loadAssistantConfig } from './config';
import { createLinkCode, listIdentities, setIdentityStatus, IdentityError, IdentityStatus } from './identityStore';
import { Channel } from './types';

const router = Router();

// Off unless ASSISTANT_ENABLED=true: behaves as if the routes don't exist
router.use((_req, res, next: NextFunction) => {
  try { if (loadAssistantConfig().enabled) return next(); } catch { /* invalid config = off */ }
  res.status(404).json({ error: 'Not found' });
});
router.use(authenticate);

const codeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many link codes requested, try again later' } });

function fail(res: Response, e: unknown) {
  if (e instanceof IdentityError) {
    res.status(e.code === 'not_found' ? 404 : e.code === 'sender_taken' || e.code === 'conflict' ? 409 : 400).json({ error: e.message, code: e.code });
    return;
  }
  console.error('[assistant] identity error:', e);
  res.status(500).json({ error: 'Server error' });
}

// ── Self-service ──

router.get('/identity/me', async (req: AuthRequest, res: Response) => {
  try { res.json(await listIdentities(getDB(), { userId: req.user!.id })); } catch (e) { fail(res, e); }
});

// Re-entering the password stops a hijacked session from quietly attaching an attacker's phone
router.post('/identity/me/link-code', codeLimiter, async (req: AuthRequest, res: Response) => {
  const { channel, phone, current_password } = req.body ?? {};
  if (!current_password) { res.status(400).json({ error: 'current_password required' }); return; }
  try {
    const db = getDB();
    const u = await db('users').where({ id: req.user!.id }).select('password_hash').first();
    if (!u || !(await bcrypt.compare(String(current_password), u.password_hash))) { res.status(403).json({ error: 'Password is incorrect' }); return; }
    const r = await createLinkCode(db, { userId: req.user!.id, channel: channel as Channel, phone, createdBy: req.user!.id, via: 'self' });
    res.status(201).json({ code: r.code, expires_at: r.expiresAt, number: r.externalSenderId, instructions: `Send "LINK ${r.code}" to the Loop assistant from ${r.externalSenderId}.` });
  } catch (e) { fail(res, e); }
});

const selfStatus = (status: IdentityStatus) => async (req: AuthRequest, res: Response) => {
  try {
    await setIdentityStatus(getDB(), { identityId: Number(req.params.id), status, actorId: req.user!.id, onlyForUserId: req.user!.id, reason: 'by owner' });
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
};
router.post('/identity/me/:id/deactivate', selfStatus('inactive'));
router.post('/identity/me/:id/activate', selfStatus('active'));
router.delete('/identity/me/:id', selfStatus('revoked'));

// ── Admin-assisted ──
// Admins can start a link for someone and revoke any mapping, but the code must still be sent FROM the number.

router.get('/identity', requireRoles('admin'), async (_req: AuthRequest, res: Response) => {
  try { res.json(await listIdentities(getDB())); } catch (e) { fail(res, e); }
});

router.post('/identity/link-code', requireRoles('admin'), codeLimiter, async (req: AuthRequest, res: Response) => {
  const { user_id, channel, phone } = req.body ?? {};
  try {
    const r = await createLinkCode(getDB(), { userId: Number(user_id), channel, phone, createdBy: req.user!.id, via: 'admin' });
    res.status(201).json({ code: r.code, expires_at: r.expiresAt, number: r.externalSenderId });
  } catch (e) { fail(res, e); }
});

const adminStatus = (status: IdentityStatus) => async (req: AuthRequest, res: Response) => {
  try {
    await setIdentityStatus(getDB(), { identityId: Number(req.params.id), status, actorId: req.user!.id, reason: req.body?.reason || 'by admin' });
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
};
router.post('/identity/:id/deactivate', requireRoles('admin'), adminStatus('inactive'));
router.post('/identity/:id/activate', requireRoles('admin'), adminStatus('active'));
router.post('/identity/:id/revoke', requireRoles('admin'), adminStatus('revoked'));

export default router;
