import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
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
    const user = await db('users').where({ email }).first();
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
      user: { id: user.id, name: user.name, email: user.email, role: user.role, avatar_color: user.avatar_color, pod: user.pod ?? null },
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const user = await db('users').where({ id: req.user!.id }).first();
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    const categories = await getUserCategories(user.id);
    res.json({ id: user.id, name: user.name, email: user.email, role: user.role, avatar_color: user.avatar_color, pod: user.pod ?? null, categories });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
