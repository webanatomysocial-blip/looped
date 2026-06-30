"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
router.get('/', async (req, res) => {
    try {
        const db = (0, db_1.getDB)();
        const notifications = await db('notifications')
            .where({ user_id: req.user.id })
            .orderBy('created_at', 'desc')
            .limit(50);
        res.json(notifications);
    }
    catch {
        res.status(500).json({ error: 'Server error' });
    }
});
router.get('/unread-count', async (req, res) => {
    try {
        const db = (0, db_1.getDB)();
        const result = await db('notifications').where({ user_id: req.user.id, read: false }).count('* as count').first();
        res.json({ count: result.count });
    }
    catch {
        res.status(500).json({ error: 'Server error' });
    }
});
router.put('/:id/read', async (req, res) => {
    try {
        const db = (0, db_1.getDB)();
        await db('notifications').where({ id: req.params.id, user_id: req.user.id }).update({ read: true });
        res.json({ message: 'Marked as read' });
    }
    catch {
        res.status(500).json({ error: 'Server error' });
    }
});
router.put('/mark-all-read', async (req, res) => {
    try {
        const db = (0, db_1.getDB)();
        await db('notifications').where({ user_id: req.user.id }).update({ read: true });
        res.json({ message: 'All marked as read' });
    }
    catch {
        res.status(500).json({ error: 'Server error' });
    }
});
exports.default = router;
