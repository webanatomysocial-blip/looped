import { Router, Response } from 'express';
import { getDB } from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate);

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const { project_id } = req.query;
    let query = db('messages as m')
      .join('users as u', 'm.sender_id', 'u.id')
      .leftJoin('projects as p', 'm.project_id', 'p.id')
      .select('m.*', 'u.name as sender_name', 'u.avatar_color as sender_color', 'u.role as sender_role', 'p.name as project_name')
      .orderBy('m.created_at', 'asc');
    if (project_id) query = query.where('m.project_id', project_id);
    const messages = await query;
    res.json(messages);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', async (req: AuthRequest, res: Response) => {
  const { message, project_id } = req.body;
  if (!message) { res.status(400).json({ error: 'Message required' }); return; }
  try {
    const db = getDB();
    const [id] = await db('messages').insert({
      sender_id: req.user!.id,
      project_id: project_id || null,
      message,
    });
    res.status(201).json({ id });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
