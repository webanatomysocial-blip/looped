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
const ALLOWED_MIME = new Set([
  'image/jpeg','image/png','image/gif','image/webp','image/svg+xml',
  'application/pdf','video/mp4','video/quicktime','video/webm',
  'application/zip','application/x-zip-compressed',
  'text/plain','text/csv',
  'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) cb(null, true);
    else cb(new Error('File type not allowed'));
  },
});

const router = Router();
router.use(authenticate);

// GET folders + files for a location (project_id + optional folder_id)
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const { project_id, folder_id } = req.query;

    // If no project_id — return project list with file counts (root view)
    if (!project_id) {
      const projects = await db('projects as p')
        .leftJoin('assets as a', 'a.project_id', 'p.id')
        .leftJoin('asset_folders as af', 'af.project_id', 'p.id')
        .select('p.id', 'p.name')
        .count('a.id as file_count')
        .groupBy('p.id', 'p.name')
        .orderBy('p.name');

      // Also include "No project" bucket
      const noProject = await db('assets').whereNull('project_id').count('id as file_count').first();

      return res.json({
        type: 'root',
        projects,
        no_project_count: Number((noProject as any)?.file_count ?? 0),
      });
    }

    const pid = project_id === 'none' ? null : Number(project_id);
    const fid = folder_id ? Number(folder_id) : null;

    // Subfolders at this level
    let folderQ = db('asset_folders').orderBy('name');
    if (pid === null) folderQ = folderQ.whereNull('project_id');
    else folderQ = folderQ.where('project_id', pid);
    if (fid === null) folderQ = folderQ.whereNull('parent_id');
    else folderQ = folderQ.where('parent_id', fid);
    const folders = await folderQ;

    // Files at this level
    let fileQ = db('assets as a')
      .leftJoin('users as u', 'a.uploaded_by', 'u.id')
      .select('a.*', 'u.name as uploaded_by_name', 'u.avatar_color', 'u.avatar_url')
      .orderBy('a.created_at', 'desc');
    if (pid === null) fileQ = fileQ.whereNull('a.project_id');
    else fileQ = fileQ.where('a.project_id', pid);
    if (fid === null) fileQ = fileQ.whereNull('a.folder_id');
    else fileQ = fileQ.where('a.folder_id', fid);
    const files = await fileQ;

    // Breadcrumb: walk parent chain
    const breadcrumb: { id: number; name: string }[] = [];
    let cur = fid;
    while (cur) {
      const row = await db('asset_folders').where({ id: cur }).first();
      if (!row) break;
      breadcrumb.unshift({ id: row.id, name: row.name });
      cur = row.parent_id;
    }

    res.json({ type: 'folder', folders, files, breadcrumb });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST create folder
router.post('/folders', async (req: AuthRequest, res: Response) => {
  const { name, project_id, parent_id } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: 'Name required' }); return; }
  try {
    const db = getDB();
    const [id] = await db('asset_folders').insert({
      name: name.trim(),
      project_id: project_id || null,
      parent_id: parent_id || null,
      created_by: req.user!.id,
    });
    res.status(201).json({ id, name: name.trim() });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH rename folder
router.patch('/folders/:id', async (req: AuthRequest, res: Response) => {
  const { name } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: 'Name required' }); return; }
  try {
    await getDB()('asset_folders').where({ id: req.params.id }).update({ name: name.trim() });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// DELETE folder (cascades files inside)
router.delete('/folders/:id', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    // Collect all nested folder ids
    const toDelete: number[] = [Number(req.params.id)];
    const queue = [Number(req.params.id)];
    while (queue.length) {
      const pid = queue.shift()!;
      const children = await db('asset_folders').where({ parent_id: pid }).select('id');
      for (const c of children) { toDelete.push(c.id); queue.push(c.id); }
    }
    // Delete files in those folders
    const fileRows = await db('assets').whereIn('folder_id', toDelete).select('file_path');
    for (const f of fileRows) {
      const fp = path.join(uploadDir, f.file_path);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
    await db('assets').whereIn('folder_id', toDelete).delete();
    await db('asset_folders').whereIn('id', toDelete).delete();
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// POST upload file
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
      folder_id: req.body.folder_id || null,
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
