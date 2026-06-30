import { Router, Response } from 'express';
import { getDB } from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate);

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const notifications = await db('notifications')
      .where({ user_id: req.user!.id })
      .orderBy('created_at', 'desc')
      .limit(50);
    res.json(notifications);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/unread-count', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const result = await db('notifications').where({ user_id: req.user!.id, read: false }).count('* as count').first();
    res.json({ count: (result as any).count });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id/read', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    await db('notifications').where({ id: req.params.id, user_id: req.user!.id }).update({ read: true });
    res.json({ message: 'Marked as read' });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/mark-all-read', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    await db('notifications').where({ user_id: req.user!.id }).update({ read: true });
    res.json({ message: 'All marked as read' });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
