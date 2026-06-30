"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const db_1 = require("../db");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
const AVATAR_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#14b8a6'];
async function attachCategories(users) {
    if (!users.length)
        return users;
    const db = (0, db_1.getDB)();
    const ids = users.map((u) => u.id);
    const rows = await db('user_categories as uc')
        .join('employee_categories as ec', 'uc.category_id', 'ec.id')
        .whereIn('uc.user_id', ids)
        .select('uc.user_id', 'ec.id as category_id', 'ec.name as category_name');
    const map = {};
    for (const r of rows) {
        if (!map[r.user_id])
            map[r.user_id] = [];
        map[r.user_id].push({ id: r.category_id, name: r.category_name });
    }
    return users.map((u) => ({ ...u, categories: map[u.id] || [] }));
}
// GET all users (admin + manager)
router.get('/', (0, auth_1.requireRoles)('admin', 'manager'), async (_req, res) => {
    try {
        const users = await (0, db_1.getDB)()('users').select('id', 'name', 'email', 'role', 'avatar_color', 'created_at');
        res.json(await attachCategories(users));
    }
    catch {
        res.status(500).json({ error: 'Server error' });
    }
});
// GET users by role
router.get('/by-role/:role', (0, auth_1.requireRoles)('admin', 'manager'), async (req, res) => {
    try {
        const users = await (0, db_1.getDB)()('users')
            .where({ role: req.params.role })
            .select('id', 'name', 'email', 'role', 'avatar_color');
        res.json(await attachCategories(users));
    }
    catch {
        res.status(500).json({ error: 'Server error' });
    }
});
// GET client companies
router.get('/companies', (0, auth_1.requireRoles)('admin', 'manager'), async (_req, res) => {
    try {
        res.json(await (0, db_1.getDB)()('client_companies').select('*'));
    }
    catch {
        res.status(500).json({ error: 'Server error' });
    }
});
// GET a specific user's project assignments
router.get('/:id/projects', (0, auth_1.requireRoles)('admin', 'manager'), async (req, res) => {
    try {
        const rows = await (0, db_1.getDB)()('project_members as pm')
            .join('projects as p', 'pm.project_id', 'p.id')
            .where('pm.user_id', req.params.id)
            .select('p.id', 'p.name');
        res.json(rows);
    }
    catch {
        res.status(500).json({ error: 'Server error' });
    }
});
// GET team members only (no clients) — used for internal chat
router.get('/team', async (_req, res) => {
    try {
        const users = await (0, db_1.getDB)()('users')
            .whereIn('role', ['admin', 'manager', 'employee'])
            .select('id', 'name', 'email', 'role', 'avatar_color');
        res.json(users);
    }
    catch {
        res.status(500).json({ error: 'Server error' });
    }
});
// POST create user (admin only)
router.post('/', (0, auth_1.requireRoles)('admin'), async (req, res) => {
    const { name, email, password, role, company_name, category_ids } = req.body;
    if (!name || !email || !password || !role) {
        res.status(400).json({ error: 'All fields required' });
        return;
    }
    if (!['admin', 'manager', 'employee', 'client'].includes(role)) {
        res.status(400).json({ error: 'Invalid role' });
        return;
    }
    try {
        const db = (0, db_1.getDB)();
        const existing = await db('users').where({ email }).first();
        if (existing) {
            res.status(409).json({ error: 'Email already exists' });
            return;
        }
        const hash = await bcryptjs_1.default.hash(password, 10);
        const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
        const [id] = await db('users').insert({
            name, email, password_hash: hash, role,
            avatar_color: color, created_by: req.user.id,
        });
        if (role === 'client' && company_name) {
            let company = await db('client_companies').where({ name: company_name }).first();
            if (!company)
                await db('client_companies').insert({ name: company_name });
        }
        if (role === 'employee' && Array.isArray(category_ids) && category_ids.length) {
            const rows = category_ids.map((cid) => ({ user_id: id, category_id: cid }));
            await db('user_categories').insert(rows);
        }
        // Assign client to selected projects
        if (role === 'client' && Array.isArray(req.body.project_ids) && req.body.project_ids.length) {
            const rows = req.body.project_ids.map((pid) => ({ project_id: pid, user_id: id }));
            await db('project_members').insert(rows).onConflict(['project_id', 'user_id']).ignore();
        }
        res.status(201).json({ id, name, email, role, avatar_color: color });
    }
    catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});
// PUT update user (admin only)
router.put('/:id', (0, auth_1.requireRoles)('admin'), async (req, res) => {
    const { name, email, role, password, category_ids } = req.body;
    try {
        const db = (0, db_1.getDB)();
        const updates = {};
        if (name)
            updates.name = name;
        if (email)
            updates.email = email;
        if (role)
            updates.role = role;
        if (password)
            updates.password_hash = await bcryptjs_1.default.hash(password, 10);
        if (Object.keys(updates).length) {
            await db('users').where({ id: req.params.id }).update(updates);
        }
        // Sync categories if provided
        if (Array.isArray(category_ids)) {
            await db('user_categories').where({ user_id: req.params.id }).delete();
            if (category_ids.length) {
                const rows = category_ids.map((cid) => ({ user_id: Number(req.params.id), category_id: cid }));
                await db('user_categories').insert(rows);
            }
        }
        // Sync project assignments for client
        if (Array.isArray(req.body.project_ids)) {
            await db('project_members').where({ user_id: req.params.id }).delete();
            if (req.body.project_ids.length) {
                const rows = req.body.project_ids.map((pid) => ({
                    project_id: pid, user_id: Number(req.params.id),
                }));
                await db('project_members').insert(rows).onConflict(['project_id', 'user_id']).ignore();
            }
        }
        res.json({ message: 'Updated' });
    }
    catch {
        res.status(500).json({ error: 'Server error' });
    }
});
// DELETE user (admin only)
router.delete('/:id', (0, auth_1.requireRoles)('admin'), async (req, res) => {
    if (Number(req.params.id) === req.user.id) {
        res.status(400).json({ error: 'Cannot delete yourself' });
        return;
    }
    try {
        const db = (0, db_1.getDB)();
        const uid = req.params.id;
        // 1. Nullify nullable FK references first
        await db('tasks').where({ assigned_to: uid }).update({ assigned_to: null });
        await db('approvals').whereNotNull('manager_approved_by').where({ manager_approved_by: uid }).update({ manager_approved_by: null });
        await db('approvals').whereNotNull('admin_approved_by').where({ admin_approved_by: uid }).update({ admin_approved_by: null });
        await db('approvals').whereNotNull('rejected_by').where({ rejected_by: uid }).update({ rejected_by: null });
        await db('approvals').whereNotNull('final_approved_by').where({ final_approved_by: uid }).update({ final_approved_by: null });
        // 2. Remove from junction / membership tables
        await db('project_members').where({ user_id: uid }).delete();
        await db('user_categories').where({ user_id: uid }).delete();
        await db('internal_chat_members').where({ user_id: uid }).delete();
        // 3. Delete user-owned content
        await db('notifications').where({ user_id: uid }).delete();
        await db('messages').where({ sender_id: uid }).delete();
        await db('internal_messages').where({ sender_id: uid }).delete();
        // 4. Delete task checklists → approvals → tasks created by this user
        const taskIds = (await db('tasks').where({ created_by: uid }).select('id')).map((t) => t.id);
        if (taskIds.length) {
            await db('task_checklist').whereIn('task_id', taskIds).delete();
            await db('approvals').whereIn('task_id', taskIds).delete();
            await db('tasks').whereIn('id', taskIds).delete();
        }
        // 5. Delete remaining approvals submitted by this user
        await db('approvals').where({ submitted_by: uid }).delete();
        // 6. Delete assets uploaded by this user
        await db('assets').where({ uploaded_by: uid }).delete();
        // 7. Finally delete the user
        await db('users').where({ id: uid }).delete();
        res.json({ message: 'Deleted' });
    }
    catch (err) {
        console.error('Delete user error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});
exports.default = router;
