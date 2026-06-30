import cron from 'node-cron';
import { getDB } from '../db';
import { sendEmail } from './emailService';

export function startEmailScheduler(): void {
  // Runs every minute — checks for emails whose scheduled_at has passed
  cron.schedule('* * * * *', async () => {
    try {
      const db = getDB();
      const now = new Date();

      const due = await db('emails')
        .where('status', 'scheduled')
        .where('scheduled_at', '<=', now)
        .select('*');

      for (const email of due) {
        const recipients = await db('email_recipients')
          .where('email_id', email.id)
          .select('email', 'name');

        if (!recipients.length) {
          await db('emails').where('id', email.id).update({
            status: 'failed',
            error_message: 'No recipients found',
            sent_at: now,
          });
          continue;
        }

        try {
          const sender = await db('users').where('id', email.created_by).first();
          await sendEmail({
            to: recipients,
            subject: email.subject,
            body: email.body,
            fromName: sender?.name,
          });
          await db('emails').where('id', email.id).update({ status: 'sent', sent_at: new Date() });
          console.log(`[scheduler] Sent email #${email.id}: "${email.subject}"`);
        } catch (err: any) {
          await db('emails').where('id', email.id).update({
            status: 'failed',
            error_message: err.message,
            sent_at: new Date(),
          });
          console.error(`[scheduler] Failed email #${email.id}:`, err.message);
        }
      }
    } catch (err) {
      console.error('[scheduler] Cron error:', err);
    }
  });

  console.log('[scheduler] Email scheduler started (checks every minute)');
}
