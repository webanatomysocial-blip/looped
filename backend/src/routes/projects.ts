import { Router, Response } from 'express';
import { getDB, createNotification, audit, nameConfirmed } from '../db';
import { authenticate, requireRoles, AuthRequest } from '../middleware/auth';
import { listProjects, getProject, createProject, updateProject, deleteProject } from '../services/projects';
import { canSeeProject, canManageProject, sendServiceError } from '../services/access';

const router = Router();
router.use(authenticate);

// 404 unless the caller can see / manage this project (same rules as the Projects page)
const seeProject = async (req: AuthRequest, res: Response, next: () => void) => {
  if (await canSeeProject(getDB(), req.user!, req.params.id as string)) return next();
  res.status(404).json({ error: 'Not found' });
};
const manageProject = async (req: AuthRequest, res: Response, next: () => void) => {
  if (await canManageProject(getDB(), req.user!, req.params.id as string)) return next();
  res.status(404).json({ error: 'Not found' });
};

// GET all projects (filtered by role)
router.get('/', async (req: AuthRequest, res: Response) => {
  try { res.json(await listProjects(getDB(), req.user!, { scope: req.query.scope as string })); }
  catch (err) { sendServiceError(res, err, 'projects.list'); }
});

// GET project members — union of project_members + task_assignees for this project
router.get('/:id/members', seeProject, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const pid = req.params.id;
    const fromProjectMembers = await db('project_members as pm')
      .join('users as u', 'pm.user_id', 'u.id')
      .where('pm.project_id', pid)
      .whereNotIn('u.role', ['client'])
      .select('u.id', 'u.name', 'u.avatar_color', 'u.avatar_url', 'u.role');
    const fromTaskAssignees = await db('task_assignees as ta')
      .join('tasks as t', 'ta.task_id', 't.id')
      .join('users as u', 'ta.user_id', 'u.id')
      .where('t.project_id', pid)
      .whereNotIn('u.role', ['client'])
      .distinct('u.id', 'u.name', 'u.avatar_color', 'u.avatar_url', 'u.role');
    // deduplicate by id
    const seen = new Set<number>();
    const all = [...fromProjectMembers, ...fromTaskAssignees].filter(m => {
      if (seen.has(m.id)) return false;
      seen.add(m.id); return true;
    });
    res.json(all);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// GET single project
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try { res.json(await getProject(getDB(), req.user!, req.params.id as string)); }
  catch (err) { sendServiceError(res, err, 'projects.get'); }
});

// POST create project — admin-created projects go to the pod manager for acceptance
router.post('/', requireRoles('admin', 'manager'), async (req: AuthRequest, res: Response) => {
  try {
    const out = await createProject(getDB(), req.user!, req.body);
    await audit('project', 'create', await getDB()('projects').where({ id: out.id }).first() ?? out, req.user!);
    res.status(201).json(out);
  }
  catch (err) { sendServiceError(res, err, 'projects.create'); }
});

// POST manager accepts or declines a project
router.post('/:id/manager-response', requireRoles('manager'), manageProject, async (req: AuthRequest, res: Response) => {
  const { action, member_ids } = req.body; // action: 'accept' | 'decline'
  if (!['accept', 'decline'].includes(action)) { res.status(400).json({ error: 'action must be accept or decline' }); return; }
  try {
    const db = getDB();
    const project = await db('projects').where({ id: req.params.id }).first();
    if (!project) { res.status(404).json({ error: 'Not found' }); return; }
    if (project.manager_status !== 'pending_manager') { res.status(400).json({ error: 'Project not pending manager acceptance' }); return; }

    if (action === 'decline') {
      await db('projects').where({ id: req.params.id }).update({ manager_status: 'declined', status: 'on_hold' });
      // Notify admin who created it
      await createNotification(project.created_by, `Manager declined project "${project.name}" — please review and resubmit`, 'project');
      res.json({ message: 'Declined' });
      return;
    }

    // Accept: set active, add manager + selected employees as members
    await db('projects').where({ id: req.params.id }).update({ manager_status: 'accepted', status: 'active' });

    const memberSet = new Set<number>();
    // Keep existing members (admin was added on create)
    const existing = await db('project_members').where({ project_id: req.params.id }).select('user_id');
    existing.forEach((m: any) => memberSet.add(Number(m.user_id)));
    // Add manager
    memberSet.add(req.user!.id);
    // Add selected employees
    if (member_ids) (member_ids as number[]).forEach((mid: number) => memberSet.add(mid));

    // Sync members
    await db('project_members').where({ project_id: req.params.id }).delete();
    await db('project_members').insert([...memberSet].map((uid) => ({ project_id: Number(req.params.id), user_id: uid })));

    // Notify each new employee
    for (const uid of memberSet) {
      if (uid !== req.user!.id && uid !== project.created_by) {
        await createNotification(uid, `You were added to project "${project.name}"`, 'project');
      }
    }
    // Notify admin
    await createNotification(project.created_by, `Manager accepted project "${project.name}" — it is now active`, 'project');

    res.json({ message: 'Accepted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT update project (admin; managers for the projects in their list)
router.put('/:id', requireRoles('admin', 'manager'), async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB(); const before = await db('projects').where({ id: req.params.id }).first();
    const members = () => db('project_members').where({ project_id: req.params.id }).orderBy('user_id').pluck('user_id');
    const mBefore = await members();
    await updateProject(db, req.user!, req.params.id as string, req.body);
    const mAfter = await members();
    if (before) await audit('project', 'update', await db('projects').where({ id: req.params.id }).first(), req.user!, mBefore.join() !== mAfter.join() ? { members: { from: mBefore, to: mAfter } } : {}, before);
    res.json({ message: 'Updated' });
  }
  catch (err) { sendServiceError(res, err, 'projects.update'); }
});

// DELETE project — admins only, with the project's name typed in; a full copy goes to audit_log first
router.delete('/:id', requireRoles('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const p = await db('projects').where({ id: req.params.id }).first();
    if (!p) { res.status(404).json({ error: 'Not found' }); return; }
    if (!nameConfirmed(req.body?.confirm_name, p.name)) { res.status(400).json({ error: `To delete, type the project name exactly: ${p.name}` }); return; }
    await audit('project', 'delete', p, req.user!, {
      members: await db('project_members').where({ project_id: p.id }).pluck('user_id'),
      tasks: await db('tasks').where({ project_id: p.id }).select('id', 'title', 'status', 'assigned_to', 'created_by', 'due_date', 'created_at'),
    });
    await deleteProject(db, req.user!, req.params.id as string); res.json({ message: 'Deleted' });
  }
  catch (err) { sendServiceError(res, err, 'projects.delete'); }
});

export default router;
