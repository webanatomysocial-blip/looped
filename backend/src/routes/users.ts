import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { getDB } from '../db';
import { authenticate, requireRoles, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate);

const AVATAR_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#14b8a6'];

async function attachCategories(users: any[]): Promise<any[]> {
  if (!users.length) return users;
  const db = getDB();
  const ids = users.map((u) => u.id);
  const rows = await db('user_categories as uc')
    .join('employee_categories as ec', 'uc.category_id', 'ec.id')
    .whereIn('uc.user_id', ids)
    .select('uc.user_id', 'ec.id as category_id', 'ec.name as category_name');
  const map: Record<number, { id: number; name: string }[]> = {};
  for (const r of rows) {
    if (!map[r.user_id]) map[r.user_id] = [];
    map[r.user_id].push({ id: r.category_id, name: r.category_name });
  }
  return users.map((u) => ({ ...u, categories: map[u.id] || [] }));
}

// GET all users (admin, manager, employee — employees need this to assign tasks and set approvers)
router.get('/', requireRoles('admin', 'manager', 'employee'), async (req: AuthRequest, res: Response) => {
  try {
    const isAdmin = req.user!.role === 'admin';
    const selectCols = [
      'u.id', 'u.name', 'u.email', 'u.role', 'u.avatar_color', 'u.pod',
      'u.created_at', 'u.client_company_id', 'cc.name as company_name',
      // monthly_salary only returned to admin/manager (not exposed to employees or clients)
      ...(isAdmin ? ['u.monthly_salary'] : []),
    ];
    const users = await getDB()('users as u')
      .leftJoin('client_companies as cc', 'u.client_company_id', 'cc.id')
      .select(...selectCols);
    res.json(await attachCategories(users));
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET users by role
router.get('/by-role/:role', requireRoles('admin', 'manager'), async (req: AuthRequest, res: Response) => {
  try {
    const users = await getDB()('users')
      .where({ role: req.params.role })
      .select('id', 'name', 'email', 'role', 'avatar_color', 'pod');
    res.json(await attachCategories(users));
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET client companies (with pod from linked client user)
router.get('/companies', requireRoles('admin', 'manager'), async (_req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const companies = await db('client_companies as cc')
      .leftJoin('users as u', function (this: any) {
        this.on('u.client_company_id', 'cc.id').andOnVal('u.role', 'client');
      })
      .select('cc.*', 'u.pod')
      .orderBy('cc.name');
    res.json(companies);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET clients grouped by pod (admin only)
router.get('/clients-by-pod', requireRoles('admin'), async (_req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const allClients = await db('users as u')
      .leftJoin('client_companies as cc', 'u.client_company_id', 'cc.id')
      .where('u.role', 'client')
      .select('u.id', 'u.name', 'u.email', 'u.avatar_color', 'cc.name as company_name');

    if (!allClients.length) { res.json({ pod1: [], pod2: [], unassigned: [] }); return; }

    const clientIds = allClients.map((c: any) => c.id);
    const podLinks = await db('project_members as pm_c')
      .join('project_members as pm_e', 'pm_c.project_id', 'pm_e.project_id')
      .join('users as emp', 'pm_e.user_id', 'emp.id')
      .whereIn('pm_c.user_id', clientIds)
      .whereIn('emp.role', ['employee', 'manager'])
      .whereNotNull('emp.pod')
      .select('pm_c.user_id as client_id', 'emp.pod')
      .distinct();

    const podMap: Record<number, Set<string>> = {};
    for (const link of podLinks) {
      if (!podMap[link.client_id]) podMap[link.client_id] = new Set();
      podMap[link.client_id].add(link.pod);
    }

    res.json({
      pod1:       allClients.filter((c: any) => podMap[c.id]?.has('pod1')),
      pod2:       allClients.filter((c: any) => podMap[c.id]?.has('pod2')),
      unassigned: allClients.filter((c: any) => !podMap[c.id]?.size),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET clients the current user shares projects with
router.get('/my-clients', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const clients = await db('users as u')
      .join('project_members as pm_c', 'pm_c.user_id', 'u.id')
      .join('project_members as pm_me', 'pm_me.project_id', 'pm_c.project_id')
      .leftJoin('client_companies as cc', 'u.client_company_id', 'cc.id')
      .where('u.role', 'client')
      .where('pm_me.user_id', req.user!.id)
      .select('u.id', 'u.name', 'u.email', 'u.avatar_color', 'cc.name as company_name')
      .distinct('u.id');
    res.json(clients);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET a specific user's project assignments
router.get('/:id/projects', requireRoles('admin', 'manager'), async (req: AuthRequest, res: Response) => {
  try {
    const rows = await getDB()('project_members as pm')
      .join('projects as p', 'pm.project_id', 'p.id')
      .where('pm.user_id', req.params.id)
      .select('p.id', 'p.name');
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET team members only (no clients) — used for internal chat
router.get('/team', async (_req: AuthRequest, res: Response) => {
  try {
    const users = await getDB()('users')
      .whereIn('role', ['admin', 'manager', 'employee'])
      .select('id', 'name', 'email', 'role', 'avatar_color', 'pod');
    res.json(users);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST create user (admin only)
router.post('/', requireRoles('admin'), async (req: AuthRequest, res: Response) => {
  const { name, email, password, role, company_name, category_ids, pod, monthly_salary } = req.body;
  if (!name || !email || !password || !role) {
    res.status(400).json({ error: 'All fields required' }); return;
  }
  if (!['admin', 'manager', 'employee', 'client'].includes(role)) {
    res.status(400).json({ error: 'Invalid role' }); return;
  }
  try {
    const db = getDB();
    const existing = await db('users').where({ email }).first();
    if (existing) { res.status(409).json({ error: 'Email already exists' }); return; }

    const hash = await bcrypt.hash(password, 10);
    const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
    const [id] = await db('users').insert({
      name, email, password_hash: hash, role,
      avatar_color: color, created_by: req.user!.id,
      pod: pod || null,
      monthly_salary: monthly_salary != null ? Number(monthly_salary) : null,
    });

    let clientCompanyId: number | null = null;
    if (role === 'client') {
      const resolvedName = company_name?.trim() || name;
      let company = await db('client_companies').where({ name: resolvedName }).first();
      if (!company) {
        const [cid] = await db('client_companies').insert({ name: resolvedName });
        clientCompanyId = cid;
      } else {
        clientCompanyId = company.id;
      }
      await db('users').where({ id }).update({ client_company_id: clientCompanyId });
    }

    if (role === 'employee' && Array.isArray(category_ids) && category_ids.length) {
      const rows = category_ids.map((cid: number) => ({ user_id: id, category_id: cid }));
      await db('user_categories').insert(rows);
    }

    res.status(201).json({ id, name, email, role, avatar_color: color });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT self-service password change
router.put('/me/password', async (req: AuthRequest, res: Response) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) {
    res.status(400).json({ error: 'current_password and new_password required' }); return;
  }
  if (new_password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters' }); return;
  }
  try {
    const db = getDB();
    const user = await db('users').where({ id: req.user!.id }).select('password_hash').first();
    const valid = await bcrypt.compare(current_password, user.password_hash);
    if (!valid) { res.status(400).json({ error: 'Current password is incorrect' }); return; }
    const hash = await bcrypt.hash(new_password, 10);
    await db('users').where({ id: req.user!.id }).update({ password_hash: hash });
    res.json({ message: 'Password updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT update user (admin only)
router.put('/:id', requireRoles('admin'), async (req: AuthRequest, res: Response) => {
  const { name, email, role, password, category_ids, company_name, pod, monthly_salary } = req.body;
  try {
    const db = getDB();
    const updates: any = {};
    if (name)     updates.name = name;
    if (email)    updates.email = email;
    const VALID_ROLES = ['admin', 'manager', 'employee', 'client'];
    if (role !== undefined) {
      if (!VALID_ROLES.includes(role)) { res.status(400).json({ error: 'Invalid role' }); return; }
      updates.role = role;
    }
    if (password) updates.password_hash = await bcrypt.hash(password, 10);
    if (pod !== undefined) updates.pod = pod || null;
    if (monthly_salary !== undefined) updates.monthly_salary = monthly_salary != null ? Number(monthly_salary) : null;

    // Sync client_company_id when company_name provided
    if (company_name !== undefined) {
      const currentUser = await db('users').where({ id: req.params.id }).select('client_company_id', 'role').first();
      const oldCompanyId: number | null = currentUser?.client_company_id ?? null;

      if (company_name.trim()) {
        // Rename the existing company if this user is its sole owner; otherwise find/create
        const existing = await db('client_companies').where({ name: company_name.trim() }).first();
        if (existing) {
          updates.client_company_id = existing.id;
        } else if (oldCompanyId) {
          const otherUsers = await db('users').where({ client_company_id: oldCompanyId }).whereNot({ id: req.params.id }).count('id as n').first();
          if ((otherUsers as any).n === 0) {
            // Sole owner — just rename the existing company record
            await db('client_companies').where({ id: oldCompanyId }).update({ name: company_name.trim() });
          } else {
            // Shared company — create a new one for this user
            const [cid] = await db('client_companies').insert({ name: company_name.trim() });
            updates.client_company_id = cid;
          }
        } else {
          const [cid] = await db('client_companies').insert({ name: company_name.trim() });
          updates.client_company_id = cid;
        }
      }

      // If the user is now linked to a different company, clean up the old one if orphaned
      if (updates.client_company_id && oldCompanyId && updates.client_company_id !== oldCompanyId) {
        const remaining = await db('users').where({ client_company_id: oldCompanyId }).count('id as n').first();
        if ((remaining as any).n === 0) {
          await db('seo_manual_data').where({ client_id: oldCompanyId }).delete();
          await db('client_companies').where({ id: oldCompanyId }).delete();
        }
      }
    }

    if (Object.keys(updates).length) {
      await db('users').where({ id: req.params.id }).update(updates);
    }

    // Sync categories if provided
    if (Array.isArray(category_ids)) {
      await db('user_categories').where({ user_id: req.params.id }).delete();
      if (category_ids.length) {
        const rows = category_ids.map((cid: number) => ({ user_id: Number(req.params.id), category_id: cid }));
        await db('user_categories').insert(rows);
      }
    }

    res.json({ message: 'Updated' });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE user (admin only)
router.delete('/:id', requireRoles('admin'), async (req: AuthRequest, res: Response) => {
  if (Number(req.params.id) === req.user!.id) {
    res.status(400).json({ error: 'Cannot delete yourself' }); return;
  }
  try {
    const db = getDB();
    const uid = req.params.id;

    // Remember the company this client belonged to (so we can clean it up after)
    const deletedUser = await db('users').where({ id: uid }).select('role', 'client_company_id').first();
    const clientCompanyId: number | null = deletedUser?.role === 'client' ? (deletedUser?.client_company_id ?? null) : null;

    // 1. Nullify nullable FK references first
    await db('tasks').where({ assigned_to: uid }).update({ assigned_to: null });
    await db('approvals').whereNotNull('manager_approved_by').where({ manager_approved_by: uid }).update({ manager_approved_by: null });
    await db('approvals').whereNotNull('admin_approved_by').where({ admin_approved_by: uid }).update({ admin_approved_by: null });
    await db('approvals').whereNotNull('rejected_by').where({ rejected_by: uid }).update({ rejected_by: null });
    await db('approvals').whereNotNull('final_approved_by').where({ final_approved_by: uid }).update({ final_approved_by: null });
    await db('email_recipients').where({ user_id: uid }).update({ user_id: null });

    // Reassign projects created by this user to the deleting admin
    await db('projects').where({ created_by: uid }).update({ created_by: req.user!.id });

    // 2. Remove from junction / membership tables
    await db('project_members').where({ user_id: uid }).delete();
    await db('user_categories').where({ user_id: uid }).delete();
    await db('internal_chat_members').where({ user_id: uid }).delete();
    // Remove task assignments (SQLite doesn't auto-cascade ON DELETE CASCADE)
    await db('task_assignees').where({ user_id: uid }).delete();

    // 3. Delete user-owned content
    await db('notifications').where({ user_id: uid }).delete();
    await db('messages').where({ sender_id: uid }).delete();
    await db('internal_messages').where({ sender_id: uid }).delete();

    // Delete internal chats created by this user (created_by is NOT NULL, blocks deletion)
    const chatIds: number[] = (await db('internal_chats').where({ created_by: uid }).select('id')).map((c: any) => c.id);
    if (chatIds.length) {
      await db('internal_messages').whereIn('chat_id', chatIds).delete();
      await db('internal_chat_members').whereIn('chat_id', chatIds).delete();
      await db('internal_chats').whereIn('id', chatIds).delete();
    }

    // 4. Delete task checklists → approvals → tasks created by this user
    const taskIds: number[] = (await db('tasks').where({ created_by: uid }).select('id')).map((t: any) => t.id);
    if (taskIds.length) {
      const approvalIds: number[] = (await db('approvals').whereIn('task_id', taskIds).select('id')).map((a: any) => a.id);
      if (approvalIds.length) await db('approval_steps').whereIn('approval_id', approvalIds).delete();
      await db('task_sessions').whereIn('task_id', taskIds).delete();
      await db('task_assignees').whereIn('task_id', taskIds).delete();
      await db('task_checklist').whereIn('task_id', taskIds).delete();
      await db('approvals').whereIn('task_id', taskIds).delete();
      await db('time_logs').whereIn('task_id', taskIds).delete();
      await db('tasks').whereIn('id', taskIds).delete();
    }

    // 5. Delete remaining approvals submitted by this user
    const remainingApprovalIds: number[] = (await db('approvals').where({ submitted_by: uid }).select('id')).map((a: any) => a.id);
    if (remainingApprovalIds.length) await db('approval_steps').whereIn('approval_id', remainingApprovalIds).delete();
    await db('approvals').where({ submitted_by: uid }).delete();

    // 6. Delete assets uploaded by this user
    await db('assets').where({ uploaded_by: uid }).delete();

    // 7. Finally delete the user
    await db('users').where({ id: uid }).delete();

    // 8. Clean up the client company if no other users are linked to it
    if (clientCompanyId) {
      const remaining = await db('users').where({ client_company_id: clientCompanyId }).count('id as n').first();
      if ((remaining as any).n === 0) {
        await db('seo_manual_data').where({ client_id: clientCompanyId }).delete();
        await db('client_companies').where({ id: clientCompanyId }).delete();
      }
    }

    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Notification preferences ────────────────────────────────────────────────

// GET /users/notification-preferences?client_user_id=X  →  { approvals, responses, comments }
router.get('/notification-preferences', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const userId = req.user!.id;
    const clientUserId = req.query.client_user_id ? Number(req.query.client_user_id) : null;

    const rows = await db('notification_preferences')
      .where({ user_id: userId, client_user_id: clientUserId });

    const prefs: Record<string, boolean> = { approvals: true, responses: true, comments: true };
    for (const r of rows) prefs[r.pref_key] = !!r.enabled;

    res.json(prefs);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /users/notification-preferences  →  { client_user_id, prefs: { approvals, responses, comments } }
router.put('/notification-preferences', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const userId = req.user!.id;
    const { client_user_id, prefs } = req.body as { client_user_id: number | null; prefs: Record<string, boolean> };

    for (const [key, enabled] of Object.entries(prefs)) {
      await db('notification_preferences')
        .insert({ user_id: userId, client_user_id: client_user_id ?? null, pref_key: key, enabled: enabled ? 1 : 0 })
        .onConflict(['user_id', 'client_user_id', 'pref_key'])
        .merge({ enabled: enabled ? 1 : 0 });
    }

    res.json({ message: 'Saved' });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
