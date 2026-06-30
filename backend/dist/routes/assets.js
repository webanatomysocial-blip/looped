"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const db_1 = require("../db");
const auth_1 = require("../middleware/auth");
const uploadDir = path_1.default.join(__dirname, '../../uploads');
if (!fs_1.default.existsSync(uploadDir))
    fs_1.default.mkdirSync(uploadDir, { recursive: true });
const storage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `${unique}${path_1.default.extname(file.originalname)}`);
    },
});
const upload = (0, multer_1.default)({ storage, limits: { fileSize: 50 * 1024 * 1024 } });
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
// GET assets
router.get('/', async (req, res) => {
    try {
        const db = (0, db_1.getDB)();
        const { project_id } = req.query;
        let query = db('assets as a')
            .leftJoin('projects as p', 'a.project_id', 'p.id')
            .leftJoin('users as u', 'a.uploaded_by', 'u.id')
            .select('a.*', 'p.name as project_name', 'u.name as uploaded_by_name', 'u.avatar_color');
        if (project_id)
            query = query.where('a.project_id', project_id);
        const assets = await query.orderBy('a.created_at', 'desc');
        res.json(assets);
    }
    catch {
        res.status(500).json({ error: 'Server error' });
    }
});
// POST upload asset
router.post('/', upload.single('file'), async (req, res) => {
    if (!req.file) {
        res.status(400).json({ error: 'File required' });
        return;
    }
    try {
        const db = (0, db_1.getDB)();
        const [id] = await db('assets').insert({
            name: req.body.name || req.file.originalname,
            file_type: req.file.mimetype,
            file_path: req.file.filename,
            file_size: req.file.size,
            project_id: req.body.project_id || null,
            uploaded_by: req.user.id,
        });
        res.status(201).json({ id, name: req.body.name || req.file.originalname });
    }
    catch {
        res.status(500).json({ error: 'Server error' });
    }
});
// GET download asset
router.get('/:id/download', async (req, res) => {
    try {
        const db = (0, db_1.getDB)();
        const asset = await db('assets').where({ id: req.params.id }).first();
        if (!asset) {
            res.status(404).json({ error: 'Not found' });
            return;
        }
        const filePath = path_1.default.join(uploadDir, asset.file_path);
        res.download(filePath, asset.name);
    }
    catch {
        res.status(500).json({ error: 'Server error' });
    }
});
// DELETE asset
router.delete('/:id', async (req, res) => {
    try {
        const db = (0, db_1.getDB)();
        const asset = await db('assets').where({ id: req.params.id }).first();
        if (!asset) {
            res.status(404).json({ error: 'Not found' });
            return;
        }
        const filePath = path_1.default.join(uploadDir, asset.file_path);
        if (fs_1.default.existsSync(filePath))
            fs_1.default.unlinkSync(filePath);
        await db('assets').where({ id: req.params.id }).delete();
        res.json({ message: 'Deleted' });
    }
    catch {
        res.status(500).json({ error: 'Server error' });
    }
});
exports.default = router;
