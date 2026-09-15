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
      .select('ic.*', 'icm.is_pinned')
      .orderBy([{ column: 'icm.is_pinned', order: 'desc' }, { column: 'ic.created_at', order: 'desc' }]);

    const enriched = await Promise.all(chats.map(async (chat: any) => {
      const members = await db('internal_chat_members as icm')
        .join('users as u', 'icm.user_id', 'u.id')
        .where('icm.chat_id', chat.id)
        .select('u.id', 'u.name', 'u.avatar_color', 'u.role', 'u.avatar_url');

      const lastMsg = await db('internal_messages')
        .where({ chat_id: chat.id })
        .whereNull('deleted_at')
        .orderBy('created_at', 'desc')
        .first();

      // unread count
      const readRow = await db('message_reads').where({ user_id: userId, chat_id: chat.id }).first();
      const unreadCount = readRow
        ? await db('internal_messages').where('chat_id', chat.id).whereNull('deleted_at').where('created_at', '>', readRow.last_read_at).whereNot('sender_id', userId).count('id as n').first()
        : await db('internal_messages').where('chat_id', chat.id).whereNull('deleted_at').whereNot('sender_id', userId).count('id as n').first();

      return { ...chat, members, last_message: lastMsg || null, unread_count: Number((unreadCount as any)?.n ?? 0) };
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

// GET messages for a specific chat (supports ?search=)
router.get('/:chatId/messages', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const userId = req.user!.id;
    const search = (req.query.search as string | undefined)?.trim();

    const member = await db('internal_chat_members')
      .where({ chat_id: req.params.chatId, user_id: userId }).first();
    if (!member) { res.status(403).json({ error: 'Not a member of this chat' }); return; }

    let q = db('internal_messages as im')
      .join('users as u', 'im.sender_id', 'u.id')
      .where('im.chat_id', req.params.chatId)
      .select('im.*', 'u.name as sender_name', 'u.avatar_color as sender_color', 'u.role as sender_role', 'u.avatar_url as sender_avatar')
      .orderBy('im.created_at', 'asc');

    if (search) q = q.whereNull('im.deleted_at').whereILike('im.content', `%${search}%`);

    const messages = await q;

    // Enrich with reactions and reply_to snippet
    const enriched = await Promise.all(messages.map(async (m: any) => {
      const reactions = await db('internal_message_reactions as r')
        .join('users as u', 'r.user_id', 'u.id')
        .where('r.message_id', m.id)
        .select('r.emoji', 'r.user_id', 'u.name as user_name');

      let reply_to = null;
      if (m.reply_to_id) {
        const rt = await db('internal_messages as im').join('users as u', 'im.sender_id', 'u.id')
          .where('im.id', m.reply_to_id).select('im.id', 'im.content', 'im.deleted_at', 'u.name as sender_name').first();
        reply_to = rt || null;
      }

      // read receipt for direct chats: check if other user has read past this message
      let read_by_other = false;
      const chatInfo = await db('internal_chats').where({ id: m.chat_id }).first();
      if (chatInfo?.type === 'direct' && m.sender_id === userId) {
        const others = await db('internal_chat_members').where('chat_id', m.chat_id).whereNot('user_id', userId).select('user_id');
        for (const o of others) {
          const rr = await db('message_reads').where({ user_id: o.user_id, chat_id: m.chat_id }).first();
          if (rr && new Date(rr.last_read_at) >= new Date(m.created_at)) { read_by_other = true; break; }
        }
      }

      return { ...m, reactions, reply_to, read_by_other };
    }));

    // Mark as read
    await db('message_reads').insert({ user_id: userId, chat_id: req.params.chatId, last_read_at: new Date() })
      .onConflict(['user_id', 'chat_id']).merge({ last_read_at: new Date() });

    res.json(enriched);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST send a text message (supports reply_to_id, forwarded_from_id)
router.post('/:chatId/messages', async (req: AuthRequest, res: Response) => {
  const { content, reply_to_id, forwarded_from_id } = req.body;
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
      reply_to_id: reply_to_id || null,
      forwarded_from_id: forwarded_from_id || null,
    });

    const others = await db('internal_chat_members')
      .where('chat_id', req.params.chatId).whereNot('user_id', userId).select('user_id');
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

// PATCH edit own message
router.patch('/:chatId/messages/:msgId', async (req: AuthRequest, res: Response) => {
  const { content } = req.body;
  if (!content?.trim()) { res.status(400).json({ error: 'content required' }); return; }
  try {
    const db = getDB();
    const userId = req.user!.id;
    const msg = await db('internal_messages').where({ id: req.params.msgId, sender_id: userId, chat_id: req.params.chatId }).first();
    if (!msg) { res.status(404).json({ error: 'Not found or not yours' }); return; }
    await db('internal_messages').where({ id: req.params.msgId }).update({ content: content.trim(), edited_at: new Date() });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// DELETE soft-delete own message
router.delete('/:chatId/messages/:msgId', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const userId = req.user!.id;
    const msg = await db('internal_messages').where({ id: req.params.msgId, sender_id: userId, chat_id: req.params.chatId }).first();
    if (!msg) { res.status(404).json({ error: 'Not found or not yours' }); return; }
    await db('internal_messages').where({ id: req.params.msgId }).update({ deleted_at: new Date() });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// POST toggle reaction on a message
router.post('/:chatId/messages/:msgId/react', async (req: AuthRequest, res: Response) => {
  const { emoji } = req.body;
  if (!emoji) { res.status(400).json({ error: 'emoji required' }); return; }
  try {
    const db = getDB();
    const userId = req.user!.id;
    const existing = await db('internal_message_reactions').where({ message_id: req.params.msgId, user_id: userId, emoji }).first();
    if (existing) {
      await db('internal_message_reactions').where({ id: existing.id }).delete();
      res.json({ action: 'removed' });
    } else {
      await db('internal_message_reactions').insert({ message_id: req.params.msgId, user_id: userId, emoji });
      res.json({ action: 'added' });
    }
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// POST forward a message to another chat
router.post('/:chatId/messages/:msgId/forward', async (req: AuthRequest, res: Response) => {
  const { to_chat_id } = req.body;
  if (!to_chat_id) { res.status(400).json({ error: 'to_chat_id required' }); return; }
  try {
    const db = getDB();
    const userId = req.user!.id;
    const orig = await db('internal_messages').where({ id: req.params.msgId }).first();
    if (!orig) { res.status(404).json({ error: 'Message not found' }); return; }
    const isMember = await db('internal_chat_members').where({ chat_id: to_chat_id, user_id: userId }).first();
    if (!isMember) { res.status(403).json({ error: 'Not a member of target chat' }); return; }
    const [id] = await db('internal_messages').insert({
      chat_id: to_chat_id,
      sender_id: userId,
      content: orig.content,
      file_url: orig.file_url,
      file_name: orig.file_name,
      forwarded_from_id: orig.id,
    });
    res.status(201).json({ id });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// PATCH toggle pin for current user
router.patch('/:chatId/pin', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const userId = req.user!.id;
    const row = await db('internal_chat_members').where({ chat_id: req.params.chatId, user_id: userId }).first();
    if (!row) { res.status(404).json({ error: 'Not a member' }); return; }
    await db('internal_chat_members').where({ chat_id: req.params.chatId, user_id: userId }).update({ is_pinned: !row.is_pinned });
    res.json({ is_pinned: !row.is_pinned });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// POST leave a group chat
router.post('/:chatId/leave', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const userId = req.user!.id;
    const chat = await db('internal_chats').where({ id: req.params.chatId, type: 'group' }).first();
    if (!chat) { res.status(404).json({ error: 'Group chat not found' }); return; }
    await db('internal_chat_members').where({ chat_id: req.params.chatId, user_id: userId }).delete();
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// POST upload group avatar
router.post('/:chatId/avatar', upload.single('avatar'), async (req: AuthRequest, res: Response) => {
  if (!req.file) { res.status(400).json({ error: 'File required' }); return; }
  try {
    const db = getDB();
    const chat = await db('internal_chats').where({ id: req.params.chatId, type: 'group' }).first();
    if (!chat) { res.status(404).json({ error: 'Group chat not found' }); return; }
    const avatarUrl = `/uploads/chat/${req.file.filename}`;
    await db('internal_chats').where({ id: req.params.chatId }).update({ avatar_url: avatarUrl });
    res.json({ avatar_url: avatarUrl });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH rename a group chat
router.patch('/:chatId/name', async (req: AuthRequest, res: Response) => {
  const { name } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: 'name required' }); return; }
  try {
    const db = getDB();
    await db('internal_chats').where({ id: req.params.chatId, type: 'group' }).update({ name: name.trim() });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
