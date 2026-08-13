import { Router, Response } from 'express';
import { authenticate as authMiddleware, AuthRequest } from '../middleware/auth';
import { getDB } from '../db';

const router = Router();
router.use(authMiddleware);

const ALLOWED_KEYS = [
  'recaptcha_site_key',
  'recaptcha_secret_key',
  'recaptcha_v3_site_key',
  'recaptcha_v3_secret_key',
  'serper_api_key',
];

router.get('/', async (req: AuthRequest, res: Response) => {
  if (req.user!.role !== 'admin') { res.status(403).json({ error: 'Forbidden' }); return; }
  const rows = await getDB()('app_settings').whereIn('key', ALLOWED_KEYS);
  const result: Record<string, string> = {};
  rows.forEach((r: any) => { result[r.key] = r.value ?? ''; });
  res.json(result);
});

router.put('/', async (req: AuthRequest, res: Response) => {
  if (req.user!.role !== 'admin') { res.status(403).json({ error: 'Forbidden' }); return; }
  const db = getDB();
  const updates: Record<string, string> = req.body;
  for (const [key, value] of Object.entries(updates)) {
    if (!ALLOWED_KEYS.includes(key)) continue;
    const exists = await db('app_settings').where({ key }).first();
    if (exists) {
      await db('app_settings').where({ key }).update({ value, updated_at: new Date() });
    } else {
      await db('app_settings').insert({ key, value });
    }
  }
  res.json({ ok: true });
});

export default router;
