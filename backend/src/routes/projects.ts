import { Router, Response } from 'express';
import { getDB, createNotification } from '../db';
import { authenticate, requireRoles, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate);

// GET all projects (filtered by role)
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const { role, id: userId } = req.user!;

    let query = db('projects as p')
      .leftJoin('client_companies as c', 'p.client_company_id', 'c.id')
      .leftJoin('users as u', 'p.created_by', 'u.id')
      .select('p.*', 'c.name as client_name', 'u.name as created_by_name');

    if (role === 'client') {
      query = query
        .join('project_members as pm', 'p.id', 'pm.project_id')
        .where('pm.user_id', userId);
    } else if (role === 'employee') {
      query = query
        .join('project_members as pm', 'p.id', 'pm.project_id')
        .where('pm.user_id', userId);
    }

    const projects = await query.orderBy('p.created_at', 'desc');

    // Get member counts and members per project
    const projectIds = projects.map((p: any) => p.id);
    const members = projectIds.length
      ? await db('project_members as pm')
          .join('users as u', 'pm.user_id', 'u.id')
          .whereIn('pm.project_id', projectIds)
          .select('pm.project_id', 'u.id as user_id', 'u.name', 'u.avatar_color', 'u.role')
      : [];

    const result = projects.map((p: any) => ({
      ...p,
      members: members.filter((m: any) => m.project_id === p.id),
    }));

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET single project
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const project = await db('projects as p')
      .leftJoin('client_companies as c', 'p.client_company_id', 'c.id')
      .where('p.id', req.params.id)
      .select('p.*', 'c.name as client_name')
      .first();
    if (!project) { res.status(404).json({ error: 'Not found' }); return; }

    const members = await db('project_members as pm')
      .join('users as u', 'pm.user_id', 'u.id')
      .where('pm.project_id', req.params.id)
      .select('u.id', 'u.name', 'u.avatar_color', 'u.role');

    res.json({ ...project, members });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST create project (admin + manager)
router.post('/', requireRoles('admin', 'manager'), async (req: AuthRequest, res: Response) => {
  const { name, client_company_id, due_date, member_ids } = req.body;
  if (!name) { res.status(400).json({ error: 'Name required' }); return; }
  try {
    const db = getDB();
    const [id] = await db('projects').insert({
      name, client_company_id: client_company_id || null,
      due_date: due_date || null, status: 'active', created_by: req.user!.id,
    });

    // Add creator as member
    const memberSet = new Set<number>([req.user!.id]);
    if (member_ids) (member_ids as number[]).forEach((mid) => memberSet.add(mid));
    const memberRows = [...memberSet].map((uid) => ({ project_id: id, user_id: uid }));
    await db('project_members').insert(memberRows);

    // Notify all members
    for (const uid of memberSet) {
      if (uid !== req.user!.id) {
        await createNotification(uid, `You were added to project "${name}"`, 'project');
      }
    }

    res.status(201).json({ id, name, status: 'active' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT update project (admin + manager)
router.put('/:id', requireRoles('admin', 'manager'), async (req: AuthRequest, res: Response) => {
  const { name, status, due_date, client_company_id, member_ids } = req.body;
  try {
    const db = getDB();
    const updates: any = {};
    if (name) updates.name = name;
    if (status) updates.status = status;
    if (due_date !== undefined) updates.due_date = due_date;
    if (client_company_id !== undefined) updates.client_company_id = client_company_id;
    await db('projects').where({ id: req.params.id }).update(updates);

    if (member_ids) {
      await db('project_members').where({ project_id: req.params.id }).delete();
      const rows = (member_ids as number[]).map((uid) => ({ project_id: Number(req.params.id), user_id: uid }));
      if (rows.length) await db('project_members').insert(rows);
    }

    res.json({ message: 'Updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE project (admin only)
router.delete('/:id', requireRoles('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const pid = req.params.id;

    // Clean up tasks and their dependents
    const taskIds: number[] = (await db('tasks').where({ project_id: pid }).select('id')).map((t: any) => t.id);
    if (taskIds.length) {
      await db('task_assignees').whereIn('task_id', taskIds).delete();
      await db('task_checklist').whereIn('task_id', taskIds).delete();
      await db('approvals').whereIn('task_id', taskIds).delete();
      await db('tasks').whereIn('id', taskIds).delete();
    }

    // Clean up remaining project-level data
    await db('approvals').where({ project_id: pid }).delete();
    await db('assets').where({ project_id: pid }).update({ project_id: null });
    await db('messages').where({ project_id: pid }).delete();
    await db('project_members').where({ project_id: pid }).delete();
    await db('projects').where({ id: pid }).delete();

    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('Delete project error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
