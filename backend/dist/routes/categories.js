"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
// GET all categories (any authenticated user can read)
router.get('/', async (_req, res) => {
    try {
        const categories = await (0, db_1.getDB)()('employee_categories').select('*').orderBy('name');
        res.json(categories);
    }
    catch {
        res.status(500).json({ error: 'Server error' });
    }
});
// POST create new category (admin only)
router.post('/', (0, auth_1.requireRoles)('admin'), async (req, res) => {
    const { name } = req.body;
    if (!name?.trim()) {
        res.status(400).json({ error: 'Name required' });
        return;
    }
    try {
        const db = (0, db_1.getDB)();
        const exists = await db('employee_categories').where({ name: name.trim() }).first();
        if (exists) {
            res.status(409).json({ error: 'Category already exists' });
            return;
        }
        const [id] = await db('employee_categories').insert({ name: name.trim() });
        res.status(201).json({ id, name: name.trim() });
    }
    catch {
        res.status(500).json({ error: 'Server error' });
    }
});
// PUT rename category (admin only)
router.put('/:id', (0, auth_1.requireRoles)('admin'), async (req, res) => {
    const { name } = req.body;
    if (!name?.trim()) {
        res.status(400).json({ error: 'Name required' });
        return;
    }
    try {
        await (0, db_1.getDB)()('employee_categories').where({ id: req.params.id }).update({ name: name.trim() });
        res.json({ message: 'Updated' });
    }
    catch {
        res.status(500).json({ error: 'Server error' });
    }
});
// DELETE category (admin only)
router.delete('/:id', (0, auth_1.requireRoles)('admin'), async (req, res) => {
    try {
        await (0, db_1.getDB)()('employee_categories').where({ id: req.params.id }).delete();
        res.json({ message: 'Deleted' });
    }
    catch {
        res.status(500).json({ error: 'Server error' });
    }
});
exports.default = router;
