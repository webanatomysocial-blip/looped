"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
router.use((0, auth_1.requireRoles)('admin', 'manager'));
router.get('/summary', async (_req, res) => {
    try {
        const db = (0, db_1.getDB)();
        const [totalProjects] = await db('projects').count('* as count');
        const [activeProjects] = await db('projects').where({ status: 'active' }).count('* as count');
        const [totalTasks] = await db('tasks').count('* as count');
        const [completedTasks] = await db('tasks').where({ status: 'completed' }).count('* as count');
        const [pendingApprovals] = await db('approvals').whereNotIn('status', ['approved']).count('* as count');
        const [totalUsers] = await db('users').count('* as count');
        res.json({
            total_projects: totalProjects.count,
            active_projects: activeProjects.count,
            total_tasks: totalTasks.count,
            completed_tasks: completedTasks.count,
            pending_approvals: pendingApprovals.count,
            total_users: totalUsers.count,
        });
    }
    catch {
        res.status(500).json({ error: 'Server error' });
    }
});
router.get('/tasks-by-status', async (_req, res) => {
    try {
        const db = (0, db_1.getDB)();
        const data = await db('tasks').select('status').count('* as count').groupBy('status');
        res.json(data);
    }
    catch {
        res.status(500).json({ error: 'Server error' });
    }
});
router.get('/projects-by-client', async (_req, res) => {
    try {
        const db = (0, db_1.getDB)();
        const data = await db('projects as p')
            .leftJoin('client_companies as c', 'p.client_company_id', 'c.id')
            .select('c.name as client', db.raw('COUNT(p.id) as count'))
            .groupBy('c.id', 'c.name');
        res.json(data);
    }
    catch {
        res.status(500).json({ error: 'Server error' });
    }
});
exports.default = router;
