import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { getDB } from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';

const uploadsDir = path.join(__dirname, '../../uploads/chat');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const ALLOWED_MIME = new Set([
  'image/jpeg','image/png','image/gif','image/webp',
  'application/pdf','video/mp4','video/webm',
  'text/plain','application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 10);
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext ? '.' + ext : ''}`);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) cb(null, true);
    else cb(new Error('File type not allowed'));
  },
});

const router = Router();
router.use(authenticate);

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const { project_id } = req.query;
    let query = db('messages as m')
      .join('users as u', 'm.sender_id', 'u.id')
      .leftJoin('projects as p', 'm.project_id', 'p.id')
      .select('m.*', 'u.name as sender_name', 'u.avatar_color as sender_color', 'u.role as sender_role', 'p.name as project_name')
      .orderBy('m.created_at', 'asc');
    if (project_id) query = query.where('m.project_id', project_id);
    const messages = await query;
    res.json(messages);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', async (req: AuthRequest, res: Response) => {
  const { message, project_id } = req.body;
  if (!message) { res.status(400).json({ error: 'Message required' }); return; }
  try {
    const db = getDB();
    const [id] = await db('messages').insert({
      sender_id: req.user!.id,
      project_id: project_id || null,
      message,
    });
    res.status(201).json({ id });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/upload/:projectId', upload.single('file'), async (req: AuthRequest, res: Response) => {
  if (!req.file) { res.status(400).json({ error: 'File required' }); return; }
  try {
    const db = getDB();
    const fileUrl = `/uploads/chat/${req.file.filename}`;
    const [id] = await db('messages').insert({
      sender_id: req.user!.id,
      project_id: req.params.projectId || null,
      message: req.file.originalname,
      file_url: fileUrl,
      file_name: req.file.originalname,
    });
    res.status(201).json({ id, file_url: fileUrl });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
