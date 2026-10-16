import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import { sendEmail } from '../services/emailService';
import { getDB } from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';

async function getUserCategories(userId: number): Promise<{ id: number; name: string }[]> {
  const db = getDB();
  const rows = await db('user_categories as uc')
    .join('employee_categories as ec', 'uc.category_id', 'ec.id')
    .where('uc.user_id', userId)
    .select('ec.id', 'ec.name');
  return rows.map((r: any) => ({ id: r.id, name: r.name }));
}

const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later' },
});

const router = Router();

router.post('/login', loginLimiter, async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password required' });
    return;
  }
  try {
    const db = getDB();
    const user = await db('users').whereRaw('LOWER(email) = ?', [email.toLowerCase()]).first();
    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    const secret = process.env.JWT_SECRET;
    if (!secret) { res.status(500).json({ error: 'Server misconfiguration' }); return; }
    const token = jwt.sign(
      { id: user.id, role: user.role, email: user.email, name: user.name, pod: user.pod ?? null },
      secret,
      { algorithm: 'HS256', expiresIn: '7d' }
    );
    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, avatar_color: user.avatar_color, avatar_url: user.avatar_url ?? null, pod: user.pod ?? null },
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Forgot / reset password ────────────────────────────────────────────────
const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many reset requests, please try again later' },
});
const RESET_TTL_MS = 60 * 60 * 1000; // links work for 1 hour
const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

// Always answers the same way, so it can't be used to discover which emails have accounts
router.post('/forgot-password', resetLimiter, async (req: Request, res: Response) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const generic = { message: 'If an account exists for that email, a reset link has been sent.' };
  if (!email) { res.status(400).json({ error: 'Email required' }); return; }
  try {
    const db = getDB();
    const user = await db('users').whereRaw('LOWER(email) = ?', [email]).first();
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      // Only the newest link works
      await db('password_resets').where({ user_id: user.id }).whereNull('used_at').update({ used_at: new Date() });
      await db('password_resets').insert({ user_id: user.id, token_hash: hashToken(token), expires_at: new Date(Date.now() + RESET_TTL_MS) });
      const base = (process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`).split(',')[0].trim().replace(/\/$/, '');
      const link = `${base}/reset-password?token=${token}`;
      try {
        await sendEmail({
          to: [{ email: user.email, name: user.name }],
          subject: 'Reset your password',
          body: `Hi ${user.name},\n\nWe received a request to reset your password. Open this link to choose a new one:\n\n${link}\n\nThe link works once and expires in 1 hour. If you didn't ask for this, you can ignore this email — your password stays the same.`,
        });
      } catch (e: any) {
        console.error('Password reset email failed:', e?.message);
      }
    }
    res.json(generic);
  } catch (err) {
    console.error('forgot-password error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/reset-password', resetLimiter, async (req: Request, res: Response) => {
  const token = String(req.body?.token || '');
  const password = String(req.body?.password || '');
  if (!token) { res.status(400).json({ error: 'Reset link is missing its token' }); return; }
  if (password.length < 8) { res.status(400).json({ error: 'Password must be at least 8 characters' }); return; }
  try {
    const db = getDB();
    const row = await db('password_resets').where({ token_hash: hashToken(token) }).first();
    if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) {
      res.status(400).json({ error: 'This reset link is invalid or has expired. Request a new one.' }); return;
    }
    const password_hash = await bcrypt.hash(password, 10);
    await db('users').where({ id: row.user_id }).update({ password_hash });
    await db('password_resets').where({ id: row.id }).update({ used_at: new Date() });
    res.json({ message: 'Password updated. You can now sign in.' });
  } catch (err) {
    console.error('reset-password error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const user = await db('users').where({ id: req.user!.id }).first();
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    const categories = await getUserCategories(user.id);
    const pageRows = await db('user_page_permissions').where({ user_id: user.id }).select('page_slug');
    const page_permissions = pageRows.length ? pageRows.map((r: any) => r.page_slug) : null;
    res.json({ id: user.id, name: user.name, email: user.email, role: user.role, avatar_color: user.avatar_color, avatar_url: user.avatar_url ?? null, pod: user.pod ?? null, categories, page_permissions });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
