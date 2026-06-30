"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
// GET tasks (filtered by role)
router.get('/', async (req, res) => {
    try {
        const db = (0, db_1.getDB)();
        const { role, id: userId } = req.user;
        const { project_id } = req.query;
        let query = db('tasks as t')
            .join('projects as p', 't.project_id', 'p.id')
            .leftJoin('users as a', 't.assigned_to', 'a.id')
            .leftJoin('users as cr', 't.created_by', 'cr.id')
            .leftJoin('client_companies as c', 'p.client_company_id', 'c.id')
            .select('t.*', 'p.name as project_name', 'c.name as client_name', 'a.name as assigned_name', 'a.avatar_color as assigned_color', 'cr.name as created_by_name');
        if (project_id)
            query = query.where('t.project_id', project_id);
        if (role === 'employee') {
            query = query.where(function () {
                this.where('t.assigned_to', userId).orWhere('t.created_by', userId);
            });
        }
        else if (role === 'client') {
            query = query
                .join('project_members as pm', 'p.id', 'pm.project_id')
                .where('pm.user_id', userId);
        }
        const tasks = await query.orderBy('t.created_at', 'desc');
        res.json(tasks);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});
// GET single task with checklist
router.get('/:id', async (req, res) => {
    try {
        const db = (0, db_1.getDB)();
        const task = await db('tasks as t')
            .join('projects as p', 't.project_id', 'p.id')
            .leftJoin('users as a', 't.assigned_to', 'a.id')
            .leftJoin('client_companies as c', 'p.client_company_id', 'c.id')
            .where('t.id', req.params.id)
            .select('t.*', 'p.name as project_name', 'c.name as client_name', 'a.name as assigned_name', 'a.avatar_color as assigned_color')
            .first();
        if (!task) {
            res.status(404).json({ error: 'Not found' });
            return;
        }
        const checklist = await db('task_checklist').where({ task_id: req.params.id });
        res.json({ ...task, checklist });
    }
    catch {
        res.status(500).json({ error: 'Server error' });
    }
});
// POST create task (admin, manager, employee)
router.post('/', (0, auth_1.requireRoles)('admin', 'manager', 'employee'), async (req, res) => {
    const { title, description, project_id, assigned_to, due_date, checklist } = req.body;
    if (!title || !project_id) {
        res.status(400).json({ error: 'Title and project required' });
        return;
    }
    try {
        const db = (0, db_1.getDB)();
        const checklistItems = checklist || [];
        const [id] = await db('tasks').insert({
            title, description: description || null,
            project_id, assigned_to: assigned_to || null,
            created_by: req.user.id,
            due_date: due_date || null,
            status: 'todo',
            checklist_total: checklistItems.length,
            checklist_done: 0,
        });
        if (checklistItems.length) {
            await db('task_checklist').insert(checklistItems.map((text) => ({ task_id: id, text, completed: false })));
        }
        // Notify assigned user
        if (assigned_to && assigned_to !== req.user.id) {
            const project = await db('projects').where({ id: project_id }).first();
            await (0, db_1.createNotification)(assigned_to, `You have been assigned task "${title}" in ${project?.name || 'a project'}`, 'task');
        }
        res.status(201).json({ id });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});
// PUT update task
router.put('/:id', (0, auth_1.requireRoles)('admin', 'manager', 'employee'), async (req, res) => {
    const { title, description, assigned_to, due_date, status } = req.body;
    try {
        const db = (0, db_1.getDB)();
        const updates = {};
        if (title)
            updates.title = title;
        if (description !== undefined)
            updates.description = description;
        if (assigned_to !== undefined)
            updates.assigned_to = assigned_to;
        if (due_date !== undefined)
            updates.due_date = due_date;
        if (status)
            updates.status = status;
        await db('tasks').where({ id: req.params.id }).update(updates);
        // Sync task status changes to approvals if they exist
        if (status === 'completed') {
            const approval = await db('approvals').where({ task_id: req.params.id }).whereNotIn('status', ['approved', 'rejected']).first();
            if (approval) {
                await db('approvals').where({ id: approval.id }).update({
                    status: 'approved',
                    final_approved_by: req.user.id,
                    final_approved_at: new Date(),
                });
            }
        }
        else if (status === 'in_review') {
            const approval = await db('approvals').where({ task_id: req.params.id, status: 'work_in_progress' }).first();
            if (approval) {
                await db('approvals').where({ id: approval.id }).update({
                    status: 'pending_review',
                    work_submitted_at: new Date(),
                });
            }
        }
        res.json({ message: 'Updated' });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});
// PUT update checklist item
router.put('/:taskId/checklist/:itemId', async (req, res) => {
    const { completed } = req.body;
    try {
        const db = (0, db_1.getDB)();
        await db('task_checklist').where({ id: req.params.itemId, task_id: req.params.taskId }).update({ completed });
        const total = await db('task_checklist').where({ task_id: req.params.taskId }).count('* as count').first();
        const done = await db('task_checklist').where({ task_id: req.params.taskId, completed: true }).count('* as count').first();
        await db('tasks').where({ id: req.params.taskId }).update({
            checklist_total: total.count,
            checklist_done: done.count,
        });
        res.json({ message: 'Updated' });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});
// DELETE task (admin + manager)
router.delete('/:id', (0, auth_1.requireRoles)('admin', 'manager'), async (req, res) => {
    try {
        const db = (0, db_1.getDB)();
        await db('task_checklist').where({ task_id: req.params.id }).delete();
        await db('tasks').where({ id: req.params.id }).delete();
        res.json({ message: 'Deleted' });
    }
    catch {
        res.status(500).json({ error: 'Server error' });
    }
});
exports.default = router;
