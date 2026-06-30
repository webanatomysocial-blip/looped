"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const db_1 = require("../db");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        res.status(400).json({ error: 'Email and password required' });
        return;
    }
    try {
        const db = (0, db_1.getDB)();
        const user = await db('users').where({ email }).first();
        if (!user) {
            res.status(401).json({ error: 'Invalid credentials' });
            return;
        }
        const valid = await bcryptjs_1.default.compare(password, user.password_hash);
        if (!valid) {
            res.status(401).json({ error: 'Invalid credentials' });
            return;
        }
        const token = jsonwebtoken_1.default.sign({ id: user.id, role: user.role, email: user.email, name: user.name }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
        res.json({
            token,
            user: { id: user.id, name: user.name, email: user.email, role: user.role, avatar_color: user.avatar_color },
        });
    }
    catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});
router.get('/me', auth_1.authenticate, async (req, res) => {
    try {
        const db = (0, db_1.getDB)();
        const user = await db('users').where({ id: req.user.id }).first();
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        res.json({ id: user.id, name: user.name, email: user.email, role: user.role, avatar_color: user.avatar_color });
    }
    catch {
        res.status(500).json({ error: 'Server error' });
    }
});
exports.default = router;
