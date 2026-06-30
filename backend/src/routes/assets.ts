import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { getDB } from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';

const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

const router = Router();
router.use(authenticate);

// GET assets
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const { project_id } = req.query;
    let query = db('assets as a')
      .leftJoin('projects as p', 'a.project_id', 'p.id')
      .leftJoin('users as u', 'a.uploaded_by', 'u.id')
      .select('a.*', 'p.name as project_name', 'u.name as uploaded_by_name', 'u.avatar_color');
    if (project_id) query = query.where('a.project_id', project_id);
    const assets = await query.orderBy('a.created_at', 'desc');
    res.json(assets);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST upload asset
router.post('/', upload.single('file'), async (req: AuthRequest, res: Response) => {
  if (!req.file) { res.status(400).json({ error: 'File required' }); return; }
  try {
    const db = getDB();
    const [id] = await db('assets').insert({
      name: req.body.name || req.file.originalname,
      file_type: req.file.mimetype,
      file_path: req.file.filename,
      file_size: req.file.size,
      project_id: req.body.project_id || null,
      uploaded_by: req.user!.id,
    });
    res.status(201).json({ id, name: req.body.name || req.file.originalname });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET download asset
router.get('/:id/download', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const asset = await db('assets').where({ id: req.params.id }).first();
    if (!asset) { res.status(404).json({ error: 'Not found' }); return; }
    const filePath = path.join(uploadDir, asset.file_path);
    res.download(filePath, asset.name);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE asset
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const asset = await db('assets').where({ id: req.params.id }).first();
    if (!asset) { res.status(404).json({ error: 'Not found' }); return; }
    const filePath = path.join(uploadDir, asset.file_path);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    await db('assets').where({ id: req.params.id }).delete();
    res.json({ message: 'Deleted' });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
