import { Router, Response } from 'express';
import { getDB, createNotification, isMySQLClient } from '../db';
import { authenticate, requireRoles, AuthRequest } from '../middleware/auth';
import { refreshChecklistCounts, uncheckedItems, uncheckedError } from '../utils/checklist';
import { ensureTrashTable, snapshotTicket, restoreTicket } from '../services/ticketTrash';
import { appendLog, approvalReasons, reasonPods, holdForCrossPod, notifyAdminCrossPod, discardRejected, creditRequester, activateTicket, dropCustomTypeIfUnused, awaitingPodApproval, AWAITING_APPROVAL, startIfAccepted, waitingOn, ticketFinalApproval } from '../services/xlr8';
import { multerName } from '../services/uploads';

import { listTasks, getTask, createTask, updateTask, sameStage } from '../services/tasks';
import { deleteTask, managerApproveTask, acceptTask, timerAction } from '../services/taskWorkflow';
import { setChecklistItem } from '../services/checklist';
import { listDeliverables, addDeliverableLink, addDeliverableFile, deleteDeliverable, labelDeliverables } from '../services/deliverables';
import { listComments, addComment, updateComment, deleteComment, mentionable } from '../services/comments';
import { assertCanSeeTask, sendServiceError } from '../services/access';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const deliverableUploadDir = path.join(__dirname, '../../uploads/deliverables');
if (!fs.existsSync(deliverableUploadDir)) fs.mkdirSync(deliverableUploadDir, { recursive: true });
const deliverableUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, deliverableUploadDir),
    filename: multerName(),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const router = Router();
router.use(authenticate);

// 404 unless the caller can open this task (same rule the website applies to the task drawer)
const seeTask = (param = 'id') => async (req: AuthRequest, res: Response, next: () => void) => {
  try { await assertCanSeeTask(getDB(), req.user!, req.params[param] as string); next(); }
  catch (err) { sendServiceError(res, err, 'tasks.access'); }
};

// GET tasks (filtered by role)
router.get('/', async (req: AuthRequest, res: Response) => {
  try { res.json(await listTasks(getDB(), req.user!, { project_id: req.query.project_id, pod: req.query.pod })); }
  catch (err) { sendServiceError(res, err, 'tasks.list'); }
});

// GET approval flow for a task
router.get('/:id/approval-flow', seeTask(), async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const flow = await db('task_approval_flow as f')
      .join('users as u', 'f.user_id', 'u.id')
      .where('f.task_id', req.params.id)
      .orderBy('f.position')
      .select('u.id', 'u.name', 'u.role', 'u.avatar_color', 'f.position');
    res.json(flow);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET single task with checklist
// ── Deleted tab ──────────────────────────────────────────────────────────────
// Admins see every deleted ticket; managers see their pod's projects and ones they deleted
router.get('/deleted', requireRoles('admin', 'manager'), async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    await ensureTrashTable(db);
    let q = db('deleted_tasks as d')
      .leftJoin('projects as p', 'p.id', 'd.project_id')
      .leftJoin('users as u', 'u.id', 'd.deleted_by')
      .select('d.id', 'd.task_id', 'd.title', 'd.project_id', 'd.deleted_at', 'p.name as project_name', 'p.pod', 'u.name as deleted_by_name')
      .orderBy('d.deleted_at', 'desc');
    if (req.user!.role === 'manager') {
      const me = await db('users').where({ id: req.user!.id }).select('pod').first();
      q = q.where(function (this: any) { this.where('d.deleted_by', req.user!.id); if (me?.pod) this.orWhere('p.pod', me.pod); });
    }
    res.json(await q);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.post('/deleted/:id/restore', requireRoles('admin', 'manager'), async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    await ensureTrashTable(db);
    const row = await db('deleted_tasks').where({ id: req.params.id }).first();
    if (!row) { res.status(404).json({ error: 'Not in Deleted' }); return; }
    // Managers restore only what their Deleted tab shows: their own deletions or their pod's projects
    if (req.user!.role === 'manager' && Number(row.deleted_by) !== req.user!.id) {
      const me = await db('users').where({ id: req.user!.id }).select('pod').first();
      const proj = row.project_id ? await db('projects').where({ id: row.project_id }).select('pod').first() : null;
      if (!me?.pod || proj?.pod !== me.pod) { res.status(404).json({ error: 'Not in Deleted' }); return; }
    }
    const snap = JSON.parse(row.snapshot);
    if (snap.task.project_id && !(await db('projects').where({ id: snap.task.project_id }).first())) {
      res.status(400).json({ error: "Its project no longer exists, so this ticket can't be restored" }); return;
    }
    await restoreTicket(db, snap);
    await db('deleted_tasks').where({ id: row.id }).delete();
    res.json({ message: 'Restored', task_id: snap.task.id });
    // Put restored work back on people's calendars
    const ids = new Set<number>([snap.task.assigned_to, ...(snap.rows?.task_assignees || []).map((a: any) => a.user_id)].filter(Boolean));
    const { scheduleUser } = await import('../services/scheduler');
    for (const uid of ids) await scheduleUser(uid, db).catch(() => {});
  } catch (err: any) {
    console.error('Restore ticket error:', err);
    res.status(500).json({ error: err?.message?.includes('already exists') ? err.message : 'Could not restore this ticket' });
  }
});

router.delete('/deleted/:id', requireRoles('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    await ensureTrashTable(db);
    await db('deleted_tasks').where({ id: req.params.id }).delete();
    res.json({ message: 'Deleted forever' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try { res.json(await getTask(getDB(), req.user!, req.params.id as string)); }
  catch (err) { sendServiceError(res, err, 'tasks.get'); }
});

// POST create task (admin, manager, employee)
router.post('/', requireRoles('admin', 'manager', 'employee'), async (req: AuthRequest, res: Response) => {
  try { res.status(201).json(await createTask(getDB(), req.user!, req.body)); }
  catch (err) { sendServiceError(res, err, 'tasks.create'); }
});

// PUT update task
router.put('/:id', requireRoles('admin', 'manager', 'employee'), async (req: AuthRequest, res: Response) => {
  try { await updateTask(getDB(), req.user!, req.params.id as string, req.body); res.json({ message: 'Updated' }); }
  catch (err) { sendServiceError(res, err, 'tasks.update'); }
});

// PUT update checklist item — a stage's items are ticked by that stage's person (or a manager/admin)
router.put('/:taskId/checklist/:itemId', async (req: AuthRequest, res: Response) => {
  try { await setChecklistItem(getDB(), req.user!, Number(req.params.taskId), req.params.itemId as string, !!req.body.completed); res.json({ message: 'Updated' }); }
  catch (err) { sendServiceError(res, err, 'tasks.checklist'); }
});

// DELETE task — admins and managers (their pod's tasks); employees only their own drafts
router.delete('/:id', requireRoles('admin', 'manager', 'employee'), async (req: AuthRequest, res: Response) => {
  try { await deleteTask(getDB(), req.user!, req.params.id as string); res.json({ message: 'Deleted' }); }
  catch (err) { sendServiceError(res, err, 'tasks.delete'); }
});

// POST manager approves or rejects a pending_approval task
router.post('/:id/manager-approve', requireRoles('admin', 'manager'), async (req: AuthRequest, res: Response) => {
  try { res.json(await managerApproveTask(getDB(), req.user!, req.params.id as string, req.body)); }
  catch (err) { sendServiceError(res, err, 'tasks.approve'); }
});

// POST accept or decline task assignment
router.post('/:id/accept', async (req: AuthRequest, res: Response) => {
  try { res.json(await acceptTask(getDB(), req.user!, req.params.id as string, req.body)); }
  catch (err) { sendServiceError(res, err, 'tasks.accept'); }
});

// POST timer actions: start | pause | done
router.post('/:id/timer', async (req: AuthRequest, res: Response) => {
  try { res.json(await timerAction(getDB(), req.user!, req.params.id as string, req.body)); }
  catch (err) { sendServiceError(res, err, 'tasks.timer'); }
});

// ── Deliverables (files + links attached at done) ────────────────────────────

router.get('/:id/deliverables', seeTask(), async (req: AuthRequest, res: Response) => {
  try { res.json(await listDeliverables(getDB(), req.user!, req.params.id as string)); }
  catch (err) { sendServiceError(res, err, 'tasks.deliverables'); }
});

router.post('/:id/deliverables/link', seeTask(), async (req: AuthRequest, res: Response) => {
  try { res.json(await addDeliverableLink(getDB(), req.user!, req.params.id as string, req.body)); }
  catch (err) { sendServiceError(res, err, 'tasks.deliverables'); }
});

router.post('/:id/deliverables/file', seeTask(), deliverableUpload.single('file'), async (req: AuthRequest, res: Response) => {
  if (!req.file) { res.status(400).json({ error: 'file required' }); return; }
  try { res.json(await addDeliverableFile(getDB(), req.user!, req.params.id as string, req.file)); }
  catch (err) { sendServiceError(res, err, 'tasks.deliverables'); }
});

router.delete('/:taskId/deliverables/:id', seeTask('taskId'), async (req: AuthRequest, res: Response) => {
  try { await deleteDeliverable(getDB(), req.user!, req.params.taskId as string, req.params.id as string); res.json({ ok: true }); }
  catch (err) { sendServiceError(res, err, 'tasks.deliverables'); }
});

// POST /:id/share-token — generate or return existing share token (authenticated)
router.post('/:id/share-token', seeTask(), async (req: AuthRequest, res: Response) => {
  const db = getDB();
  const taskId = Number(req.params.id);
  const existing = await db('task_share_tokens').where({ task_id: taskId }).first();
  if (existing) { res.json({ token: existing.token }); return; }
  const crypto = await import('crypto');
  const token = crypto.randomBytes(32).toString('hex');
  await db('task_share_tokens').insert({ task_id: taskId, token });
  res.json({ token });
});

// GET /tasks/:id/comments
router.get('/:id/comments', seeTask(), async (req: AuthRequest, res: Response) => {
  try { res.json(await listComments(getDB(), req.user!, req.params.id as string)); }
  catch (err) { sendServiceError(res, err, 'tasks.comments'); }
});

router.get('/:id/mentionable', seeTask(), async (req: AuthRequest, res: Response) => {
  try { res.json(await mentionable(getDB(), Number(req.params.id))); }
  catch (err) { sendServiceError(res, err, 'tasks.mentionable'); }
});

router.post('/:id/comments', seeTask(), async (req: AuthRequest, res: Response) => {
  try { res.status(201).json(await addComment(getDB(), req.user!, req.params.id as string, req.body)); }
  catch (err) { sendServiceError(res, err, 'tasks.comment'); }
});

router.put('/:id/comments/:cid', async (req: AuthRequest, res: Response) => {
  try { res.json(await updateComment(getDB(), req.user!, req.params.id as string, req.params.cid as string, req.body)); }
  catch (err) { sendServiceError(res, err, 'tasks.comment'); }
});

router.delete('/:id/comments/:cid', async (req: AuthRequest, res: Response) => {
  try { await deleteComment(getDB(), req.user!, req.params.id as string, req.params.cid as string); res.status(204).end(); }
  catch (err) { sendServiceError(res, err, 'tasks.comment'); }
});

export default router;

// ─── Public task router (no auth) ────────────────────────────────────────────
import { Router as PublicRouter } from 'express';
export const publicTaskRouter = PublicRouter();

publicTaskRouter.get('/:token', async (req: any, res: any) => {
  try {
    const db = getDB();
    const row = await db('task_share_tokens').where({ token: req.params.token }).first();
    if (!row) { res.status(404).json({ error: 'Invalid or revoked link' }); return; }

    const task = await db('tasks as t')
      .join('projects as p', 't.project_id', 'p.id')
      .leftJoin('users as a', 't.assigned_to', 'a.id')
      .leftJoin('users as cr', 't.created_by', 'cr.id')
      .leftJoin('client_companies as c', 'p.client_company_id', 'c.id')
      .where('t.id', row.task_id)
      .select('t.*', 'p.name as project_name', 'c.name as client_name', 'a.name as assigned_name', 'cr.name as created_by_name')
      .first();
    if (!task) { res.status(404).json({ error: 'Ticket not found' }); return; }

    const stageAssignees = await db('task_assignees as ta')
      .leftJoin('users as u', 'u.id', 'ta.user_id')
      .leftJoin(db('task_sessions').whereNull('ended_at').select('user_id', 'task_id', 'stage_idx').as('ts'), function () { this.on('ts.user_id', 'ta.user_id').on('ts.task_id', 'ta.task_id').on(sameStage); })
      .where({ 'ta.task_id': row.task_id })
      .select('ta.stage_idx', 'ta.user_id', 'ta.assignee_role', 'ta.acceptance_status', 'ta.est_hours', 'ta.skipped', 'ta.is_reviewer', 'u.name as user_name', 'u.avatar_color', 'u.avatar_url', db.raw('CASE WHEN ts.user_id IS NOT NULL THEN 1 ELSE 0 END as is_active'));

    const isProd = isMySQLClient();
    const secSQL = isProd
      ? "COALESCE(SUM(TIMESTAMPDIFF(SECOND, ts.started_at, COALESCE(ts.ended_at, NOW()))), 0) as tracked_seconds"
      : "COALESCE(SUM(CAST((COALESCE(ts.ended_at, strftime('%s','now') * 1000) - ts.started_at) / 1000 AS INTEGER)), 0) as tracked_seconds";
    const stageTracked = await db('task_assignees as ta')
      .leftJoin('task_sessions as ts', function () {
        this.on('ts.task_id', 'ta.task_id').on('ts.user_id', 'ta.user_id').on(sameStage);
      })
      .where({ 'ta.task_id': row.task_id })
      .whereNotNull('ta.stage_idx')
      .groupBy('ta.stage_idx')
      .select('ta.stage_idx', db.raw(secSQL));

    let xlr8_stages = null;
    let xlr8_final_approval: any = null;
    if (task.ticket_type_id) {
      const tt = await db('xlr8_ticket_types').where({ id: task.ticket_type_id }).first();
      if (tt) {
        xlr8_stages = typeof tt.stages === 'string' ? JSON.parse(tt.stages || '[]') : (tt.stages ?? []);
        xlr8_final_approval = ticketFinalApproval(tt.final_approval, task);
      }
    }

    const deliverables = await db('task_deliverables as d')
      .leftJoin('users as u', 'd.uploaded_by', 'u.id')
      .where({ 'd.task_id': row.task_id })
      .select('d.*', 'u.name as uploader_name')
      .orderBy('d.created_at', 'asc')
      .then((rows: any[]) => labelDeliverables(db, row.task_id, rows));

    let activity_log: any[] = [];
    if (task.ticket_type_id) {
      activity_log = await db('xlr8_ticket_log as l')
        .leftJoin('users as u', 'l.actor_id', 'u.id')
        .where({ 'l.task_id': row.task_id })
        .select('l.*', 'u.name as actor_name')
        .orderBy('l.created_at', 'asc');
    }

    // Comment thread, read-only on the share page
    const comments = await db('task_comments as c')
      .join('users as u', 'c.user_id', 'u.id')
      .where('c.task_id', row.task_id)
      .select('c.id', 'c.parent_id', 'c.comment', 'c.created_at', 'u.name as user_name', 'u.avatar_color')
      .orderBy('c.created_at', 'asc');

    res.json({ ...task, stage_assignees: stageAssignees, stage_tracked: stageTracked, xlr8_stages, xlr8_final_approval, deliverables, activity_log, comments });
  } catch (e: any) {
    console.error('Public ticket error:', e?.message);
    res.status(500).json({ error: 'Server error' });
  }
});
