import { Router, Response } from 'express';
import { getDB } from '../db';
import { authenticate, requireRoles, AuthRequest } from '../middleware/auth';
import { sendEmail } from '../services/emailService';

const router = Router();
router.use(authenticate);
router.use(requireRoles('admin', 'manager', 'employee'));

// GET list (admin sees all, others see own)
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const { role, id: userId } = req.user!;

    let query = db('emails as e')
      .leftJoin('users as u', 'e.created_by', 'u.id')
      .select('e.*', 'u.name as created_by_name')
      .orderBy('e.created_at', 'desc');

    if (role !== 'admin') query = query.where('e.created_by', userId);

    const emails = await query;
    const ids = emails.map((e: any) => e.id);
    const recipients = ids.length
      ? await db('email_recipients').whereIn('email_id', ids).select('*')
      : [];

    res.json(
      emails.map((e: any) => ({
        ...e,
        recipients: recipients.filter((r: any) => r.email_id === e.id),
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST create and optionally send/schedule
router.post('/', async (req: AuthRequest, res: Response) => {
  const { subject, body, recipient_ids, scheduled_at } = req.body;
  if (!subject?.trim() || !body?.trim()) {
    res.status(400).json({ error: 'Subject and body are required' }); return;
  }
  if (!Array.isArray(recipient_ids) || !recipient_ids.length) {
    res.status(400).json({ error: 'At least one recipient is required' }); return;
  }

  try {
    const db = getDB();
    const recipients = await db('users').whereIn('id', recipient_ids).select('id', 'name', 'email');
    if (!recipients.length) { res.status(400).json({ error: 'No valid recipients' }); return; }

    const isScheduled = !!scheduled_at;
    const sendAt = isScheduled ? new Date(scheduled_at) : new Date();

    const [emailId] = await db('emails').insert({
      subject: subject.trim(),
      body: body.trim(),
      status: 'scheduled',
      scheduled_at: sendAt,
      created_by: req.user!.id,
    });

    await db('email_recipients').insert(
      recipients.map((r: any) => ({ email_id: emailId, user_id: r.id, email: r.email, name: r.name }))
    );

    // Send immediately if no schedule_at was specified
    if (!isScheduled) {
      const sender = await db('users').where('id', req.user!.id).first();
      try {
        await sendEmail({ to: recipients, subject: subject.trim(), body: body.trim(), fromName: sender?.name });
        await db('emails').where('id', emailId).update({ status: 'sent', sent_at: new Date() });
        res.status(201).json({ id: emailId, status: 'sent' });
      } catch (err: any) {
        await db('emails').where('id', emailId).update({
          status: 'failed',
          error_message: err.message,
          sent_at: new Date(),
        });
        res.status(500).json({ error: 'Email saved but failed to send: ' + err.message });
      }
      return;
    }

    res.status(201).json({ id: emailId, status: 'scheduled' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE (can only delete scheduled; admin can delete anything)
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const email = await db('emails').where('id', req.params.id).first();
    if (!email) { res.status(404).json({ error: 'Not found' }); return; }
    if (req.user!.role !== 'admin' && email.created_by !== req.user!.id) {
      res.status(403).json({ error: 'Not authorized' }); return;
    }
    if (email.status === 'sent' && req.user!.role !== 'admin') {
      res.status(400).json({ error: 'Cannot delete a sent email' }); return;
    }
    await db('email_recipients').where('email_id', req.params.id).delete();
    await db('emails').where('id', req.params.id).delete();
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
