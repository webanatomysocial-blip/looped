import { Router, Response } from 'express';
import { getDB } from '../db';
import { authenticate, requireRoles, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate);

// GET all categories (any authenticated user can read)
router.get('/', async (_req: AuthRequest, res: Response) => {
  try {
    const categories = await getDB()('employee_categories').select('*').orderBy('name');
    res.json(categories);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST create new category (admin only)
router.post('/', requireRoles('admin'), async (req: AuthRequest, res: Response) => {
  const { name } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: 'Name required' }); return; }
  try {
    const db = getDB();
    const exists = await db('employee_categories').where({ name: name.trim() }).first();
    if (exists) { res.status(409).json({ error: 'Category already exists' }); return; }
    const [id] = await db('employee_categories').insert({ name: name.trim() });
    res.status(201).json({ id, name: name.trim() });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT rename category (admin only)
router.put('/:id', requireRoles('admin'), async (req: AuthRequest, res: Response) => {
  const { name } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: 'Name required' }); return; }
  try {
    await getDB()('employee_categories').where({ id: req.params.id }).update({ name: name.trim() });
    res.json({ message: 'Updated' });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE category (admin only)
router.delete('/:id', requireRoles('admin'), async (req: AuthRequest, res: Response) => {
  try {
    await getDB()('employee_categories').where({ id: req.params.id }).delete();
    res.json({ message: 'Deleted' });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
