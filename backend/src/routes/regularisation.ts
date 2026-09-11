import { Router, Response } from 'express';
import { getDB, createNotification } from '../db';
import { authenticate, AuthRequest, requireRoles } from '../middleware/auth';

const router = Router();
router.use(authenticate);

// Ensure table exists (in case migration ran before the fix)
async function ensureTable() {
  const db = getDB();
  const exists = await db.schema.hasTable('regularisation_requests');
  if (!exists) {
    await db.schema.createTable('regularisation_requests', (t) => {
      t.increments('id').primary();
      t.integer('task_id').notNullable().references('id').inTable('tasks').onDelete('CASCADE');
      t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
      t.text('reason').nullable();
      t.string('status').notNullable().defaultTo('pending');
      t.float('new_est_hours').nullable();
      t.integer('reviewed_by').nullable();
      t.timestamp('reviewed_at').nullable();
      t.timestamps(true, true);
    });
  }
}

// POST — employee requests regularisation for an overdue task
router.post('/', async (req: AuthRequest, res: Response) => {
  const { task_id, reason } = req.body;
  if (!task_id) { res.status(400).json({ error: 'task_id required' }); return; }
  try {
    await ensureTable();
    const db = getDB();
    const userId = req.user!.id;

    // Must be assigned to this task (via task_assignees OR xlr8_assignee_id)
    const assigned = await db('task_assignees').where({ task_id, user_id: userId }).first();
    const xlr8Assigned = await db('tasks').where({ id: task_id, xlr8_assignee_id: userId }).first();
    if (!assigned && !xlr8Assigned) { res.status(403).json({ error: 'Not assigned to this task' }); return; }

    // No duplicate pending request
    const existing = await db('regularisation_requests').where({ task_id, user_id: userId, status: 'pending' }).first();
    if (existing) { res.status(409).json({ error: 'A pending request already exists for this task' }); return; }

    const [id] = await db('regularisation_requests').insert({ task_id, user_id: userId, reason: reason || null });

    const task = await db('tasks as t').join('projects as p', 't.project_id', 'p.id').where('t.id', task_id).select('t.title', 'p.name as project_name', 'p.pod').first();
    const requester = await db('users').where({ id: userId }).select('name').first();

    // Notify all admins
    const admins = await db('users').where({ role: 'admin' }).select('id');
    for (const a of admins) {
      await createNotification(a.id, `⏱ Regularisation request: "${task?.title}" by ${requester?.name}`, 'task', null);
    }

    // Notify pod manager if task's project has a pod
    if (task?.pod) {
      const podManagers = await db('users').where({ role: 'manager', pod: task.pod }).select('id');
      for (const m of podManagers) {
        await createNotification(m.id, `⏱ Regularisation request: "${task?.title}" by ${requester?.name}`, 'task', null);
      }
    }

    res.status(201).json({ id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET — admin/manager lists all requests
router.get('/', requireRoles('admin', 'manager'), async (req: AuthRequest, res: Response) => {
  try {
    await ensureTable();
    const db = getDB();
    const rows = await db('regularisation_requests as r')
      .join('tasks as t', 'r.task_id', 't.id')
      .join('projects as p', 't.project_id', 'p.id')
      .join('users as u', 'r.user_id', 'u.id')
      .leftJoin('users as rv', 'r.reviewed_by', 'rv.id')
      .select(
        'r.id', 'r.status', 'r.reason', 'r.new_est_hours', 'r.created_at', 'r.reviewed_at',
        't.id as task_id', 't.title as task_title', 't.estimated_hours',
        'p.name as project_name', 'p.pod',
        'u.id as user_id', 'u.name as user_name',
        'rv.name as reviewed_by_name'
      )
      .orderBy('r.created_at', 'desc');

    // Attach tracked seconds for each task+user
    const result = await Promise.all(rows.map(async (r: any) => {
      const sessions = await db('task_sessions').where({ task_id: r.task_id, user_id: r.user_id }).select('started_at', 'ended_at');
      const now = Date.now();
      let trackedMs = 0;
      for (const s of sessions) {
        const start = isNaN(Number(s.started_at)) ? new Date(s.started_at).getTime() : Number(s.started_at);
        const end = s.ended_at ? (isNaN(Number(s.ended_at)) ? new Date(s.ended_at).getTime() : Number(s.ended_at)) : now;
        trackedMs += Math.max(0, end - start);
      }
      return { ...r, tracked_hours: Math.round((trackedMs / 3600000) * 1000) / 1000 };
    }));

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT — admin/manager approves or rejects
router.put('/:id', requireRoles('admin', 'manager'), async (req: AuthRequest, res: Response) => {
  await ensureTable();
  const { action, new_est_hours } = req.body; // action: 'approve' | 'reject'
  if (!['approve', 'reject'].includes(action)) { res.status(400).json({ error: 'action must be approve or reject' }); return; }
  try {
    const db = getDB();
    const request = await db('regularisation_requests').where({ id: req.params.id }).first();
    if (!request) { res.status(404).json({ error: 'Not found' }); return; }
    if (request.status !== 'pending') { res.status(409).json({ error: 'Already reviewed' }); return; }

    const now = new Date();
    await db('regularisation_requests').where({ id: req.params.id }).update({
      status: action === 'approve' ? 'approved' : 'rejected',
      new_est_hours: action === 'approve' ? Number(new_est_hours) : null,
      reviewed_by: req.user!.id,
      reviewed_at: now,
    });

    if (action === 'approve' && new_est_hours) {
      await db('tasks').where({ id: request.task_id }).update({ estimated_hours: Number(new_est_hours) });
    }

    const task = await db('tasks').where({ id: request.task_id }).select('title', 'project_id').first();
    const msg = action === 'approve'
      ? `✅ Your regularisation request for "${task?.title}" was approved — est. time updated`
      : `❌ Your regularisation request for "${task?.title}" was rejected`;
    await createNotification(request.user_id, msg, 'task', task?.project_id);

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
