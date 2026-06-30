import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

export async function sendEmail(opts: {
  to: { email: string; name: string }[];
  subject: string;
  body: string;
  fromName?: string;
}): Promise<void> {
  const toList = opts.to.map((r) => `"${r.name}" <${r.email}>`).join(', ');
  const fromName = opts.fromName || process.env.MAIL_FROM_NAME || 'Workdeck';
  await transporter.sendMail({
    from: `"${fromName}" <${process.env.GMAIL_USER}>`,
    to: toList,
    subject: opts.subject,
    text: opts.body,
    html: `<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a;">${opts.body.replace(/\n/g, '<br>')}</div>`,
  });
}
