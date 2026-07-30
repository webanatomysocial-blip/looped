import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { getDB, createNotification } from '../db';
import { authenticate, requireRoles, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate);

// Clients cannot access internal chat
router.use(requireRoles('admin', 'manager', 'employee'));

const uploadsDir = path.join(__dirname, '../../uploads/chat');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const CHAT_ALLOWED_MIME = new Set([
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
    if (CHAT_ALLOWED_MIME.has(file.mimetype)) cb(null, true);
    else cb(new Error('File type not allowed'));
  },
});

// GET list of chats the current user is part of
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const userId = req.user!.id;

    const chats = await db('internal_chats as ic')
      .join('internal_chat_members as icm', 'ic.id', 'icm.chat_id')
      .where('icm.user_id', userId)
      .select('ic.*')
      .orderBy('ic.created_at', 'desc');

    // For each chat, attach members and last message
    const enriched = await Promise.all(chats.map(async (chat: any) => {
      const members = await db('internal_chat_members as icm')
        .join('users as u', 'icm.user_id', 'u.id')
        .where('icm.chat_id', chat.id)
        .select('u.id', 'u.name', 'u.avatar_color', 'u.role');

      const lastMsg = await db('internal_messages')
        .where({ chat_id: chat.id })
        .orderBy('created_at', 'desc')
        .first();

      return { ...chat, members, last_message: lastMsg || null };
    }));

    res.json(enriched);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST create a direct or group chat
router.post('/', async (req: AuthRequest, res: Response) => {
  const { type, name, member_ids } = req.body; // type: 'direct'|'group', member_ids: number[]
  if (!type || !Array.isArray(member_ids) || !member_ids.length) {
    res.status(400).json({ error: 'type and member_ids required' }); return;
  }
  if (type !== 'direct' && type !== 'group') {
    res.status(400).json({ error: 'type must be direct or group' }); return;
  }

  try {
    const db = getDB();
    const userId = req.user!.id;
    const allMemberIds = [...new Set([userId, ...member_ids.map(Number)])];

    // For direct chats, check if one already exists between these two users
    if (type === 'direct' && allMemberIds.length === 2) {
      const otherId = allMemberIds.find((id) => id !== userId)!;
      const existing = await db('internal_chats as ic')
        .join('internal_chat_members as a', 'ic.id', 'a.chat_id')
        .join('internal_chat_members as b', 'ic.id', 'b.chat_id')
        .where('ic.type', 'direct')
        .where('a.user_id', userId)
        .where('b.user_id', otherId)
        .select('ic.id')
        .first();
      if (existing) { res.json({ id: existing.id, existing: true }); return; }
    }

    const [chatId] = await db('internal_chats').insert({
      type,
      name: type === 'group' ? (name || 'Group Chat') : null,
      created_by: userId,
    });

    const memberRows = allMemberIds.map((uid) => ({ chat_id: chatId, user_id: uid }));
    await db('internal_chat_members').insert(memberRows);

    // Notify other members
    for (const uid of allMemberIds.filter((id) => id !== userId)) {
      await createNotification(uid, `You were added to a ${type} chat by ${req.user!.name}`, 'message');
    }

    res.status(201).json({ id: chatId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET messages for a specific chat
router.get('/:chatId/messages', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const userId = req.user!.id;

    // Verify user is a member
    const member = await db('internal_chat_members')
      .where({ chat_id: req.params.chatId, user_id: userId }).first();
    if (!member) { res.status(403).json({ error: 'Not a member of this chat' }); return; }

    const messages = await db('internal_messages as im')
      .join('users as u', 'im.sender_id', 'u.id')
      .where('im.chat_id', req.params.chatId)
      .select('im.*', 'u.name as sender_name', 'u.avatar_color as sender_color', 'u.role as sender_role')
      .orderBy('im.created_at', 'asc');

    res.json(messages);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST send a text message
router.post('/:chatId/messages', async (req: AuthRequest, res: Response) => {
  const { content } = req.body;
  if (!content?.trim()) { res.status(400).json({ error: 'Content required' }); return; }
  try {
    const db = getDB();
    const userId = req.user!.id;

    const member = await db('internal_chat_members')
      .where({ chat_id: req.params.chatId, user_id: userId }).first();
    if (!member) { res.status(403).json({ error: 'Not a member of this chat' }); return; }

    const [id] = await db('internal_messages').insert({
      chat_id: req.params.chatId,
      sender_id: userId,
      content: content.trim(),
    });

    // Notify other members
    const others = await db('internal_chat_members')
      .where('chat_id', req.params.chatId)
      .whereNot('user_id', userId)
      .select('user_id');
    for (const o of others) {
      await createNotification(o.user_id, `New message from ${req.user!.name}`, 'message');
    }

    res.status(201).json({ id });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST send a file in chat
router.post('/:chatId/upload', upload.single('file'), async (req: AuthRequest, res: Response) => {
  if (!req.file) { res.status(400).json({ error: 'File required' }); return; }
  try {
    const db = getDB();
    const userId = req.user!.id;

    const member = await db('internal_chat_members')
      .where({ chat_id: req.params.chatId, user_id: userId }).first();
    if (!member) { res.status(403).json({ error: 'Not a member' }); return; }

    const fileUrl = `/uploads/chat/${req.file.filename}`;
    const [id] = await db('internal_messages').insert({
      chat_id: req.params.chatId,
      sender_id: userId,
      content: req.file.originalname,
      file_url: fileUrl,
      file_name: req.file.originalname,
    });

    res.status(201).json({ id, file_url: fileUrl });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST add a member to a group chat
router.post('/:chatId/members', async (req: AuthRequest, res: Response) => {
  const { user_id } = req.body;
  if (!user_id) { res.status(400).json({ error: 'user_id required' }); return; }
  try {
    const db = getDB();
    const chat = await db('internal_chats').where({ id: req.params.chatId, type: 'group' }).first();
    if (!chat) { res.status(404).json({ error: 'Group chat not found' }); return; }
    await db('internal_chat_members').insert({ chat_id: req.params.chatId, user_id }).onConflict(['chat_id', 'user_id']).ignore();
    res.json({ message: 'Member added' });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
