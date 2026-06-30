import { Router, Response } from 'express';
import { getDB, createNotification } from '../db';
import { authenticate, requireRoles, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate);

// GET tasks (filtered by role)
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const { role, id: userId } = req.user!;
    const { project_id } = req.query;

    let query = db('tasks as t')
      .join('projects as p', 't.project_id', 'p.id')
      .leftJoin('users as a', 't.assigned_to', 'a.id')
      .leftJoin('users as cr', 't.created_by', 'cr.id')
      .leftJoin('client_companies as c', 'p.client_company_id', 'c.id')
      .select(
        't.*',
        'p.name as project_name',
        'c.name as client_name',
        'a.name as assigned_name',
        'a.avatar_color as assigned_color',
        'cr.name as created_by_name'
      );

    if (project_id) query = query.where('t.project_id', project_id);

    if (role === 'employee') {
      query = query.whereRaw(
        '(t.assigned_to = ? OR t.created_by = ? OR t.id IN (SELECT task_id FROM task_assignees WHERE user_id = ?))',
        [userId, userId, userId]
      );
    } else if (role === 'client') {
      query = query
        .join('project_members as pm', 'p.id', 'pm.project_id')
        .where('pm.user_id', userId);
    }

    const tasks = await query.orderBy('t.created_at', 'desc');

    // Attach all assignees per task
    const taskIds = tasks.map((t: any) => t.id);
    const assigneeRows = taskIds.length
      ? await db('task_assignees as ta')
          .join('users as u', 'ta.user_id', 'u.id')
          .whereIn('ta.task_id', taskIds)
          .select('ta.task_id', 'u.id as user_id', 'u.name', 'u.avatar_color')
      : [];

    const result = tasks.map((t: any) => ({
      ...t,
      assignees: assigneeRows.filter((a: any) => a.task_id === t.id),
    }));

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET single task with checklist
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const task = await db('tasks as t')
      .join('projects as p', 't.project_id', 'p.id')
      .leftJoin('users as a', 't.assigned_to', 'a.id')
      .leftJoin('client_companies as c', 'p.client_company_id', 'c.id')
      .where('t.id', req.params.id)
      .select('t.*', 'p.name as project_name', 'c.name as client_name', 'a.name as assigned_name', 'a.avatar_color as assigned_color')
      .first();
    if (!task) { res.status(404).json({ error: 'Not found' }); return; }

    const checklist = await db('task_checklist').where({ task_id: req.params.id });
    res.json({ ...task, checklist });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST create task (admin, manager, employee)
router.post('/', requireRoles('admin', 'manager', 'employee'), async (req: AuthRequest, res: Response) => {
  const { title, description, project_id, assignee_ids, due_date, checklist } = req.body;
  if (!title || !project_id) { res.status(400).json({ error: 'Title and project required' }); return; }
  try {
    const db = getDB();
    const checklistItems: string[] = checklist || [];
    const ids: number[] = Array.isArray(assignee_ids) ? assignee_ids : (assignee_ids ? [Number(assignee_ids)] : []);

    const [id] = await db('tasks').insert({
      title, description: description || null,
      project_id, assigned_to: ids[0] || null,
      created_by: req.user!.id,
      due_date: due_date || null,
      status: 'todo',
      checklist_total: checklistItems.length,
      checklist_done: 0,
    });

    if (ids.length) {
      await db('task_assignees').insert(ids.map((uid) => ({ task_id: id, user_id: uid })));
    }

    if (checklistItems.length) {
      await db('task_checklist').insert(checklistItems.map((text) => ({ task_id: id, text, completed: false })));
    }

    // Notify all assigned users
    if (ids.length) {
      const project = await db('projects').where({ id: project_id }).first();
      for (const uid of ids) {
        if (uid !== req.user!.id) {
          await createNotification(uid, `You have been assigned task "${title}" in ${project?.name || 'a project'}`, 'task');
        }
      }
    }

    res.status(201).json({ id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT update task
router.put('/:id', requireRoles('admin', 'manager', 'employee'), async (req: AuthRequest, res: Response) => {
  const { title, description, assignee_ids, due_date, status } = req.body;
  try {
    const db = getDB();
    const updates: any = {};
    if (title) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (due_date !== undefined) updates.due_date = due_date;
    if (status) updates.status = status;

    if (assignee_ids !== undefined) {
      const ids: number[] = Array.isArray(assignee_ids) ? assignee_ids : (assignee_ids ? [Number(assignee_ids)] : []);
      updates.assigned_to = ids[0] || null;
      await db('task_assignees').where({ task_id: req.params.id }).delete();
      if (ids.length) {
        await db('task_assignees').insert(ids.map((uid) => ({ task_id: req.params.id, user_id: uid })));
      }
    }

    if (Object.keys(updates).length) {
      await db('tasks').where({ id: req.params.id }).update(updates);
    }

    // Sync task status changes to approvals if they exist
    if (status === 'completed') {
      const approval = await db('approvals').where({ task_id: req.params.id }).whereNotIn('status', ['approved', 'rejected']).first();
      if (approval) {
        await db('approvals').where({ id: approval.id }).update({
          status: 'approved',
          final_approved_by: req.user!.id,
          final_approved_at: new Date(),
        });
      }
    } else if (status === 'in_review') {
      const approval = await db('approvals').where({ task_id: req.params.id, status: 'work_in_progress' }).first();
      if (approval) {
        await db('approvals').where({ id: approval.id }).update({
          status: 'pending_review',
          work_submitted_at: new Date(),
        });
      }
    }

    res.json({ message: 'Updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT update checklist item
router.put('/:taskId/checklist/:itemId', async (req: AuthRequest, res: Response) => {
  const { completed } = req.body;
  try {
    const db = getDB();
    await db('task_checklist').where({ id: req.params.itemId, task_id: req.params.taskId }).update({ completed });
    const total = await db('task_checklist').where({ task_id: req.params.taskId }).count('* as count').first();
    const done = await db('task_checklist').where({ task_id: req.params.taskId, completed: true }).count('* as count').first();
    await db('tasks').where({ id: req.params.taskId }).update({
      checklist_total: (total as any).count,
      checklist_done: (done as any).count,
    });
    res.json({ message: 'Updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE task (admin + manager)
router.delete('/:id', requireRoles('admin', 'manager'), async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    await db('task_checklist').where({ task_id: req.params.id }).delete();
    await db('tasks').where({ id: req.params.id }).delete();
    res.json({ message: 'Deleted' });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
