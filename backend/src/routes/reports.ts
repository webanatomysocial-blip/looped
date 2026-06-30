import { Router, Response } from 'express';
import { getDB } from '../db';
import { authenticate, requireRoles, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate);
router.use(requireRoles('admin', 'manager'));

router.get('/summary', async (_req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const [totalProjects] = await db('projects').count('* as count');
    const [activeProjects] = await db('projects').where({ status: 'active' }).count('* as count');
    const [totalTasks] = await db('tasks').count('* as count');
    const [completedTasks] = await db('tasks').where({ status: 'completed' }).count('* as count');
    const [pendingApprovals] = await db('approvals').whereNotIn('status', ['approved']).count('* as count');
    const [totalUsers] = await db('users').count('* as count');

    res.json({
      total_projects: (totalProjects as any).count,
      active_projects: (activeProjects as any).count,
      total_tasks: (totalTasks as any).count,
      completed_tasks: (completedTasks as any).count,
      pending_approvals: (pendingApprovals as any).count,
      total_users: (totalUsers as any).count,
    });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/tasks-by-status', async (_req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const data = await db('tasks').select('status').count('* as count').groupBy('status');
    res.json(data);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/projects-by-client', async (_req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const data = await db('projects as p')
      .leftJoin('client_companies as c', 'p.client_company_id', 'c.id')
      .select('c.name as client', db.raw('COUNT(p.id) as count'))
      .groupBy('c.id', 'c.name');
    res.json(data);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
