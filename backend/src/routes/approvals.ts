import { Router, Response } from 'express';
import { getDB, createNotification } from '../db';
import { authenticate, requireRoles, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate);

// Approval status flow:
// pending_manager → pending_admin → pending_client → work_in_progress → pending_review → approved
//                                                                                       → revision_requested (→ pending_review again)
// At any early stage: → rejected

async function notifyManagers(db: any, message: string) {
  const managers = await db('users').where({ role: 'manager' });
  for (const m of managers) await createNotification(m.id, message, 'approval');
}

async function notifyAdmins(db: any, message: string) {
  const admins = await db('users').where({ role: 'admin' });
  for (const a of admins) await createNotification(a.id, message, 'approval');
}

async function notifyProjectClients(db: any, projectId: number, message: string) {
  const clients = await db('project_members as pm')
    .join('users as u', 'pm.user_id', 'u.id')
    .where('pm.project_id', projectId)
    .where('u.role', 'client')
    .select('u.id');
  for (const c of clients) await createNotification(c.id, message, 'approval');
}

// GET approvals — filtered by role
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const { role, id: userId } = req.user!;

    let query = db('approvals as ap')
      .join('tasks as t', 'ap.task_id', 't.id')
      .join('projects as p', 'ap.project_id', 'p.id')
      .leftJoin('client_companies as c', 'p.client_company_id', 'c.id')
      .leftJoin('users as sub', 'ap.submitted_by', 'sub.id')
      .select(
        'ap.*',
        't.title as task_title',
        'p.name as project_name',
        'c.name as client_name',
        'sub.name as submitted_by_name',
        'sub.avatar_color as submitted_by_color'
      );

    if (role === 'manager') {
      // Managers see: items pending their review OR pending final review OR completed items for their projects
      query = query.whereIn('ap.status', ['pending_manager', 'pending_review', 'approved', 'revision_requested']);
    } else if (role === 'admin') {
      query = query.whereIn('ap.status', ['pending_admin', 'pending_review', 'approved', 'revision_requested']);
    } else if (role === 'client') {
      query = query
        .join('project_members as pm', 'p.id', 'pm.project_id')
        .where('pm.user_id', userId)
        .whereIn('ap.status', ['pending_client', 'pending_review', 'approved', 'revision_requested']);
    } else if (role === 'employee') {
      query = query.where('ap.submitted_by', userId);
    }

    const approvals = await query.orderBy('ap.created_at', 'desc');
    res.json(approvals);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST submit task for approval (employee / manager / admin)
router.post('/', requireRoles('admin', 'manager', 'employee'), async (req: AuthRequest, res: Response) => {
  const { task_id, title } = req.body;
  if (!task_id || !title) { res.status(400).json({ error: 'task_id and title required' }); return; }
  try {
    const db = getDB();
    const task = await db('tasks').where({ id: task_id }).first();
    if (!task) { res.status(404).json({ error: 'Task not found' }); return; }

    // Allow resubmission after revision_requested, otherwise block duplicates
    const existing = await db('approvals').where({ task_id })
      .whereNotIn('status', ['approved', 'rejected', 'revision_requested']).first();
    if (existing) { res.status(409).json({ error: 'Approval already pending for this task' }); return; }

    // If re-submitting after revision, update existing record
    const revisionRecord = await db('approvals').where({ task_id, status: 'revision_requested' }).first();
    if (revisionRecord) {
      await db('approvals').where({ id: revisionRecord.id }).update({
        status: 'pending_review',
        work_submitted_at: new Date(),
        revision_notes: null,
      });
      await db('tasks').where({ id: task_id }).update({ status: 'in_review' });
      await notifyManagers(db, `"${title}" has been revised and resubmitted for review`);
      await notifyAdmins(db, `"${title}" has been revised and resubmitted for review`);
      res.json({ id: revisionRecord.id, resubmitted: true });
      return;
    }

    const [id] = await db('approvals').insert({
      task_id, title, project_id: task.project_id,
      submitted_by: req.user!.id, status: 'pending_manager',
    });
    await db('tasks').where({ id: task_id }).update({ status: 'in_review' });
    await notifyManagers(db, `New approval request: "${title}" is awaiting your review`);

    res.status(201).json({ id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT review an approval
router.put('/:id', async (req: AuthRequest, res: Response) => {
  const { action, notes } = req.body; // action: 'approve' | 'reject' | 'request_revision'
  const { role, id: userId } = req.user!;
  try {
    const db = getDB();
    const approval = await db('approvals').where({ id: req.params.id }).first();
    if (!approval) { res.status(404).json({ error: 'Not found' }); return; }

    const updates: any = {};

    // MANAGER: reviews initial request
    if (role === 'manager' && approval.status === 'pending_manager') {
      if (action === 'approve') {
        updates.status = 'pending_admin';
        updates.manager_approved_by = userId;
        updates.manager_approved_at = new Date();
        updates.manager_notes = notes || null;
        await notifyAdmins(db, `"${approval.title}" passed manager review — awaiting your approval`);
      } else if (action === 'reject') {
        updates.status = 'rejected';
        updates.rejected_by = userId;
        updates.rejected_at = new Date();
        updates.rejection_notes = notes || null;
        await db('tasks').where({ id: approval.task_id }).update({ status: 'todo' });
        await createNotification(approval.submitted_by, `Your request "${approval.title}" was rejected by manager${notes ? ': ' + notes : ''}`, 'approval');
      }

    // ADMIN: reviews after manager approval → sends to client
    } else if (role === 'admin' && approval.status === 'pending_admin') {
      if (action === 'approve') {
        updates.status = 'pending_client';
        updates.admin_approved_by = userId;
        updates.admin_approved_at = new Date();
        updates.admin_notes = notes || null;
        await notifyProjectClients(db, approval.project_id, `"${approval.title}" has been approved by admin and is awaiting your review`);
      } else if (action === 'reject') {
        updates.status = 'rejected';
        updates.rejected_by = userId;
        updates.rejected_at = new Date();
        updates.rejection_notes = notes || null;
        await db('tasks').where({ id: approval.task_id }).update({ status: 'todo' });
        await createNotification(approval.submitted_by, `Your request "${approval.title}" was rejected by admin${notes ? ': ' + notes : ''}`, 'approval');
      }

    // CLIENT: reviews after admin approval → green-lights the employee to start work
    } else if (role === 'client' && approval.status === 'pending_client') {
      const isMember = await db('project_members')
        .where({ project_id: approval.project_id, user_id: userId }).first();
      if (!isMember) { res.status(403).json({ error: 'Not authorized' }); return; }

      if (action === 'approve') {
        updates.status = 'work_in_progress';
        await db('tasks').where({ id: approval.task_id }).update({ status: 'in_progress' });
        await createNotification(
          approval.submitted_by,
          `Your request "${approval.title}" was approved by the client. You can now start working on it.`,
          'approval'
        );
        await notifyManagers(db, `Client approved "${approval.title}" — work has started`);
        await notifyAdmins(db, `Client approved "${approval.title}" — work has started`);
      } else if (action === 'reject') {
        updates.status = 'rejected';
        updates.rejected_by = userId;
        updates.rejected_at = new Date();
        updates.rejection_notes = notes || null;
        await db('tasks').where({ id: approval.task_id }).update({ status: 'todo' });
        await createNotification(approval.submitted_by, `Your request "${approval.title}" was rejected by client${notes ? ': ' + notes : ''}`, 'approval');
      }

    // MANAGER / ADMIN / CLIENT: reviews completed work
    } else if (approval.status === 'pending_review') {
      const canReview =
        role === 'manager' ||
        role === 'admin' ||
        (role === 'client' && await db('project_members').where({ project_id: approval.project_id, user_id: userId }).first());

      if (!canReview) { res.status(403).json({ error: 'Not authorized' }); return; }

      if (action === 'approve') {
        updates.status = 'approved';
        updates.final_approved_by = userId;
        updates.final_approved_at = new Date();
        updates.final_notes = notes || null;
        await db('tasks').where({ id: approval.task_id }).update({ status: 'completed' });
        await createNotification(approval.submitted_by, `Your work on "${approval.title}" has been approved!`, 'approval');
      } else if (action === 'request_revision') {
        updates.status = 'revision_requested';
        updates.revision_notes = notes || null;
        await db('tasks').where({ id: approval.task_id }).update({ status: 'in_progress' });
        await createNotification(
          approval.submitted_by,
          `Revision requested on "${approval.title}"${notes ? ': ' + notes : ''}`,
          'approval'
        );
      }

    } else {
      res.status(403).json({ error: 'Not authorized for this action at current stage' }); return;
    }

    if (!Object.keys(updates).length) {
      res.status(400).json({ error: 'Invalid action for current status' }); return;
    }

    await db('approvals').where({ id: req.params.id }).update(updates);
    res.json({ message: 'Updated', status: updates.status });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST mark task complete → move approval to pending_review
// Called when employee sets task status to 'completed'
router.post('/:id/complete', requireRoles('employee', 'manager', 'admin'), async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const approval = await db('approvals').where({ id: req.params.id }).first();
    if (!approval) { res.status(404).json({ error: 'Not found' }); return; }
    if (approval.status !== 'work_in_progress') {
      res.status(400).json({ error: 'Task is not in work_in_progress stage' }); return;
    }

    await db('approvals').where({ id: req.params.id }).update({
      status: 'pending_review',
      work_submitted_at: new Date(),
    });
    await db('tasks').where({ id: approval.task_id }).update({ status: 'in_review' });

    await notifyManagers(db, `"${approval.title}" has been completed and is awaiting your review`);
    await notifyAdmins(db, `"${approval.title}" has been completed and is awaiting your review`);
    await notifyProjectClients(db, approval.project_id, `Work on "${approval.title}" is ready for your review`);

    res.json({ message: 'Moved to pending_review' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
