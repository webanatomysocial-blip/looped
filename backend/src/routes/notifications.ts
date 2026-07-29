import { Router, Response } from 'express';
import { getDB } from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate);

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const rows = await db('notifications as n')
      .leftJoin('projects as p', 'n.project_id', 'p.id')
      .where({ 'n.user_id': req.user!.id })
      .orderBy('n.created_at', 'desc')
      .limit(100)
      .select('n.*', 'p.name as project_name');

    // Infer project for old notifications that predate the project_id column
    const needsInference = rows.some((n: any) => !n.project_id);
    if (needsInference) {
      const approvals = await db('approvals as ap')
        .join('projects as p', 'ap.project_id', 'p.id')
        .select('ap.title', 'ap.project_id', 'p.name as project_name');

      for (const n of rows) {
        if (!n.project_id) {
          const match = approvals.find((a: any) => n.message.includes(`"${a.title}"`));
          if (match) {
            n.project_id = match.project_id;
            n.project_name = match.project_name;
          }
        }
      }
    }

    res.json(rows);
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
