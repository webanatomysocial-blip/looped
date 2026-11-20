import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { getDB } from '../db';
import { authenticate, requireRoles, AuthRequest } from '../middleware/auth';
import { sendEmail } from '../services/emailService';
import { visibleCompanyIds } from '../utils/companyAccess';
import crypto from 'crypto';
import { otpLimiter } from '../middleware/rateLimits';
import { multerName } from '../services/uploads';

const uploadDir = path.join(__dirname, '../../uploads/contact-forms');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: multerName(),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const router = Router();
router.use(authenticate, requireRoles('admin', 'manager', 'employee'));

function parseForm(form: any) {
  return {
    ...form,
    fields: JSON.parse(form.fields || '[]'),
    conditions: form.conditions ? JSON.parse(form.conditions) : [],
  };
}

// ---- clients ----

// Same rule as the client list: a manager or employee only sees the clients they work with
async function seesClient(req: AuthRequest, clientId: unknown): Promise<boolean> {
  if (req.user!.role === 'admin') return true;
  const ids = await visibleCompanyIds(getDB(), req.user!.role, req.user!.id);
  return ids === null || ids.map(String).includes(String(clientId));
}

router.get('/', async (req: AuthRequest, res: Response) => {
  const db = getDB();
  const { role, id: userId } = req.user!;
  const ids = await visibleCompanyIds(db, role, userId);
  const q = db('client_companies').select('id', 'name').orderBy('name');
  if (ids !== null) { if (!ids.length) { res.json([]); return; } q.whereIn('id', ids); }
  const clients = await q;
  const counts = await db('contact_forms').select('client_id').count({ n: '*' }).groupBy('client_id');
  const countMap: Record<number, number> = {};
  counts.forEach((c: any) => { countMap[c.client_id] = Number(c.n); });
  res.json(clients.map((c: any) => ({ ...c, formCount: countMap[c.id] || 0 })));
});

router.get('/:id', async (req: AuthRequest, res: Response) => {
  const db = getDB();
  const { role, id: userId } = req.user!;
  if (role !== 'admin') {
    const ids = await visibleCompanyIds(db, role, userId);
    if (ids !== null && !ids.map(String).includes(String(req.params.id))) { res.status(403).json({ error: 'Access denied.' }); return; }
  }
  const client = await db('client_companies').where({ id: req.params.id }).select('id', 'name').first();
  if (!client) { res.status(404).json({ error: 'Not found.' }); return; }
  res.json(client);
});

// ---- forms ----

router.get('/:id/forms', async (req: AuthRequest, res: Response) => {
  if (!(await seesClient(req, req.params.id))) { res.status(403).json({ error: 'Access denied.' }); return; }
  try {
    const db = getDB();
    const forms = await db('contact_forms').where({ client_id: req.params.id }).orderBy('created_at', 'desc');
    let countMap: Record<number, number> = {};
    let unreadMap: Record<number, number> = {};
    try {
      const counts = await db('contact_submissions').select('contact_form_id')
        .count({ n: '*' }).groupBy('contact_form_id');
      counts.forEach((c: any) => { countMap[c.contact_form_id] = Number(c.n); });
      const unreads = await db('contact_submissions').select('contact_form_id')
        .count({ n: '*' }).where({ read: false }).groupBy('contact_form_id');
      unreads.forEach((c: any) => { unreadMap[c.contact_form_id] = Number(c.n); });
    } catch { /* table may not exist yet */ }
    res.json(forms.map((f: any) => ({
      ...parseForm(f),
      submissionCount: countMap[f.id] || 0,
      unreadCount: unreadMap[f.id] || 0,
    })));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/forms', async (req: AuthRequest, res: Response) => {
  const { name } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: 'Form name is required.' }); return; }
  const client = await getDB()('client_companies').where({ id: req.params.id }).first();
  if (!client) { res.status(404).json({ error: 'Client not found.' }); return; }
  const defaultFields = [
    { id: 'f1', name: 'name',    label: 'Name',    type: 'text',     required: true,  width: 100, placeholder: '' },
    { id: 'f2', name: 'email',   label: 'Email',   type: 'email',    required: true,  width: 100, placeholder: '' },
    { id: 'f3', name: 'message', label: 'Message', type: 'textarea', required: true,  width: 100, placeholder: '' },
  ];
  const [id] = await getDB()('contact_forms').insert({
    name: name.trim(),
    client_id: req.params.id,
    contact_project_id: null,
    to_emails: '',
    template: '',
    fields: JSON.stringify(defaultFields),
  });
  const form = await getDB()('contact_forms').where({ id }).first();
  res.status(201).json(parseForm(form));
});

router.post('/:id/forms/:formId/clone', async (req: AuthRequest, res: Response) => {
  const db = getDB();
  const orig = await db('contact_forms').where({ id: req.params.formId, client_id: req.params.id }).first();
  if (!orig) { res.status(404).json({ error: 'Form not found.' }); return; }
  const [id] = await db('contact_forms').insert({
    name: `${orig.name} (Copy)`,
    client_id: orig.client_id,
    contact_project_id: null,
    to_emails: orig.to_emails,
    template: orig.template || '',
    fields: orig.fields,
    redirect_url: orig.redirect_url,
    otp_enabled: orig.otp_enabled,
    style_config: orig.style_config,
    webhook_url: orig.webhook_url,
    confirmation_email_field: orig.confirmation_email_field,
    confirmation_message: orig.confirmation_message,
    conditions: orig.conditions,
  });
  const form = await db('contact_forms').where({ id }).first();
  res.status(201).json(parseForm(form));
});

router.get('/forms/:formId', async (req: AuthRequest, res: Response) => {
  const form = await getDB()('contact_forms').where({ id: req.params.formId }).first();
  if (!form || !(await seesClient(req, form.client_id))) { res.status(404).json({ error: 'Not found.' }); return; }
  res.json(parseForm(form));
});

router.patch('/forms/:formId', async (req: AuthRequest, res: Response) => {
  const {
    name, fields, toEmails, template, redirectUrl, otpEnabled, style_config,
    webhook_url, confirmation_email_field, confirmation_message, conditions,
  } = req.body;
  const update: Record<string, any> = {};
  if (name?.trim()) update.name = name.trim();
  if (fields) update.fields = JSON.stringify(fields);
  if (toEmails !== undefined) update.to_emails = toEmails.trim();
  if (template !== undefined) update.template = template;
  if (redirectUrl !== undefined) update.redirect_url = redirectUrl.trim();
  if (otpEnabled !== undefined) update.otp_enabled = otpEnabled ? 1 : 0;
  if (style_config !== undefined) update.style_config = style_config;
  if (webhook_url !== undefined) update.webhook_url = webhook_url?.trim() || null;
  if (confirmation_email_field !== undefined) update.confirmation_email_field = confirmation_email_field || null;
  if (confirmation_message !== undefined) update.confirmation_message = confirmation_message || null;
  if (conditions !== undefined) update.conditions = conditions ? JSON.stringify(conditions) : null;
  await getDB()('contact_forms').where({ id: req.params.formId }).update(update);
  const form = await getDB()('contact_forms').where({ id: req.params.formId }).first();
  res.json(parseForm(form));
});

router.delete('/forms/:formId', async (req: AuthRequest, res: Response) => {
  await getDB()('contact_forms').where({ id: req.params.formId }).delete();
  res.status(204).end();
});

// Upload a confirmation attachment for a form
const confirmUploadDir = path.join(__dirname, '../../uploads/confirm-attachments');
if (!fs.existsSync(confirmUploadDir)) fs.mkdirSync(confirmUploadDir, { recursive: true });
const confirmUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, confirmUploadDir),
    filename: multerName(),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});

router.post('/forms/:formId/confirmation-attachment', confirmUpload.single('file'), async (req: AuthRequest, res: Response) => {
  const file = (req as any).file;
  if (!file) { res.status(400).json({ error: 'No file uploaded.' }); return; }
  await getDB()('contact_forms').where({ id: req.params.formId }).update({
    confirmation_attachment: JSON.stringify({ stored: file.filename, original: file.originalname }),
  });
  res.json({ stored: file.filename, original: file.originalname });
});

router.delete('/forms/:formId/confirmation-attachment', async (req: AuthRequest, res: Response) => {
  const form = await getDB()('contact_forms').where({ id: req.params.formId }).first();
  if (form?.confirmation_attachment) {
    try {
      const att = JSON.parse(form.confirmation_attachment);
      const filePath = path.join(confirmUploadDir, att.stored);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {}
  }
  await getDB()('contact_forms').where({ id: req.params.formId }).update({ confirmation_attachment: null });
  res.json({ ok: true });
});

// ---- submissions ----

router.get('/:id/submissions', async (req: AuthRequest, res: Response) => {
  if (!(await seesClient(req, req.params.id))) { res.status(403).json({ error: 'Access denied.' }); return; }
  const { page = '1', per_page = '50', form_id, unread_only } = req.query as Record<string, string>;
  const db = getDB();
  let q = db('contact_submissions').where({ client_id: req.params.id });
  if (form_id) q = q.where({ contact_form_id: form_id });
  if (unread_only === 'true') q = q.where({ read: false });
  const total = await q.clone().count({ n: '*' }).first().then((r: any) => Number(r?.n ?? 0));
  const pageNum = Math.max(1, Number(page));
  const perPage = Math.min(100, Math.max(1, Number(per_page)));
  const rows = await q.orderBy('created_at', 'desc').limit(perPage).offset((pageNum - 1) * perPage);
  res.json({
    total,
    page: pageNum,
    per_page: perPage,
    pages: Math.max(1, Math.ceil(total / perPage)),
    submissions: rows.map((s: any) => ({
      ...s,
      data: JSON.parse(s.data),
      files: s.files ? JSON.parse(s.files) : [],
    })),
  });
});

router.get('/submissions/:submissionId', async (req: AuthRequest, res: Response) => {
  const s = await getDB()('contact_submissions').where({ id: req.params.submissionId }).first();
  if (!s || !(await seesClient(req, s.client_id))) { res.status(404).json({ error: 'Not found.' }); return; }
  // Each file comes with its own link (signed on the way out), since a plain link can't carry the login
  const files = (s.files ? JSON.parse(s.files) : []).map((f: any) => ({ ...f, url: `/uploads/contact-forms/${f.stored}` }));
  res.json({ ...s, data: JSON.parse(s.data), files });
});

router.patch('/submissions/:submissionId/read', async (req: AuthRequest, res: Response) => {
  const { read = true } = req.body;
  await getDB()('contact_submissions').where({ id: req.params.submissionId }).update({ read: read ? 1 : 0 });
  res.json({ ok: true });
});

// Serve uploaded file for a submission
router.get('/submissions/:submissionId/files/:filename', async (req: AuthRequest, res: Response) => {
  const s = await getDB()('contact_submissions').where({ id: req.params.submissionId }).first();
  if (!s || !(await seesClient(req, s.client_id))) { res.status(404).json({ error: 'Not found.' }); return; }
  const files: Array<{ stored: string; original: string }> = s.files ? JSON.parse(s.files) : [];
  const file = files.find((f) => f.stored === req.params.filename || f.original === req.params.filename);
  if (!file) { res.status(404).json({ error: 'File not found.' }); return; }
  const filePath = path.join(uploadDir, file.stored);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: 'File missing from disk.' }); return; }
  res.download(filePath, file.original);
});

export default router;

// ---- public (no auth): embed config + submit ----

export const publicContactFormsRouter = Router();

const corsHeaders = (res: Response) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
};

// Email codes (one-time passwords), per form and email. One server process, so this map is the single truth and
// each request's check-and-update runs without interruption: simultaneous guesses can't slip past the attempt limit.
// shortcut: in-memory, lost on restart (people just ask for a new code); move to the database if Loop ever runs >1 process.
const OTP_TTL_MS = 10 * 60 * 1000, OTP_MAX_TRIES = 5, RESEND_GAP_MS = 60 * 1000, SENDS_PER_HOUR = 5;
export const otpStore = new Map<string, { code: string; expires: number; tries: number }>();
const sends = new Map<string, number[]>();   // per email: when codes were sent (flood guard)
const otpKey = (formId: unknown, email: unknown) => `${String(formId)}:${String(email ?? '').trim().toLowerCase()}`;
// Checks a code: a wrong one counts against the limit and the code is gone after the fifth. 'ok' leaves it for the submit, which uses it up.
export function checkOtp(key: string, code: unknown, now = Date.now()): 'ok' | 'wrong' | 'expired' {
  const st = otpStore.get(key);
  if (!st || now > st.expires) { otpStore.delete(key); return 'expired'; }
  if (st.code !== String(code ?? '').trim()) { st.tries++; if (st.tries >= OTP_MAX_TRIES) otpStore.delete(key); return 'wrong'; }
  return 'ok';
}
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of otpStore) { if (now > val.expires) otpStore.delete(key); }
  for (const [key, times] of sends) { const keep = times.filter((t) => now - t < 3600_000); if (keep.length) sends.set(key, keep); else sends.delete(key); }
}, 15 * 60 * 1000).unref();

publicContactFormsRouter.options('/forms/:formId', (_req: Request, res: Response) => { corsHeaders(res); res.status(204).end(); });
publicContactFormsRouter.options('/forms/:formId/submit', (_req: Request, res: Response) => { corsHeaders(res); res.status(204).end(); });
publicContactFormsRouter.options('/forms/:formId/send-otp', (_req: Request, res: Response) => { corsHeaders(res); res.status(204).end(); });
publicContactFormsRouter.options('/forms/:formId/verify-otp', (_req: Request, res: Response) => { corsHeaders(res); res.status(204).end(); });

publicContactFormsRouter.post('/forms/:formId/send-otp', otpLimiter, async (req: Request, res: Response) => {
  corsHeaders(res);
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i.test(email)) { res.status(400).json({ error: 'Please enter a valid email address.' }); return; }
  const form = await getDB()('contact_forms').where({ id: req.params.formId }).first('id', 'name', 'otp_enabled');
  if (!form || !form.otp_enabled) { res.status(404).json({ error: 'Form not found.' }); return; }
  // One code a minute and five an hour per address, whoever asks: the form can't be used to flood an inbox
  const now = Date.now(); const recent = (sends.get(email) ?? []).filter((t) => now - t < 3600_000);
  if (recent.length >= SENDS_PER_HOUR || (recent.length && now - recent[recent.length - 1] < RESEND_GAP_MS)) { res.status(429).json({ error: 'A code was sent recently. Please wait a moment before asking again.' }); return; }
  sends.set(email, [...recent, now]);
  const code = String(crypto.randomInt(100000, 1000000));
  otpStore.set(otpKey(req.params.formId, email), { code, expires: now + OTP_TTL_MS, tries: 0 });
  try {
    await sendEmail({
      to: [{ email, name: email }],
      subject: `Your verification code for ${form.name}`,
      body: `Your OTP is: ${code}\n\nThis code expires in 10 minutes.`,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('OTP send failed:', err);
    res.status(500).json({ error: 'Failed to send OTP. Please try again.' });
  }
});

publicContactFormsRouter.post('/forms/:formId/verify-otp', otpLimiter, (req: Request, res: Response) => {
  corsHeaders(res);
  const { email, otp } = req.body || {};
  if (!email || !otp) { res.status(400).json({ error: 'Email and code are required.' }); return; }
  const r = checkOtp(otpKey(req.params.formId, email), otp);
  if (r !== 'ok') { res.status(400).json({ error: r === 'expired' ? 'This code has expired. Please request a new one.' : 'That code is not right. Please check and try again.' }); return; }
  res.json({ ok: true });
});

// Google's check, with the secret sent in the request body (never in an address that could be logged). Swappable in tests.
// The keys an admin saved under Settings (app_settings holds one row per key)
async function captchaKeys(): Promise<Record<string, string>> {
  const rows = await getDB()('app_settings').whereIn('key', ['recaptcha_site_key', 'recaptcha_secret_key', 'recaptcha_v3_site_key', 'recaptcha_v3_secret_key']).select('key', 'value').catch(() => []);
  return Object.fromEntries(rows.map((r: any) => [r.key, String(r.value ?? '').trim()]));
}
export const recaptcha = { verify: async (secret: string, token: string): Promise<boolean> => {
  try {
    const r = await fetch('https://www.google.com/recaptcha/api/siteverify', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ secret, response: token }), signal: AbortSignal.timeout(8000) });
    const d = await r.json() as { success?: boolean; score?: number };
    return !!d.success && (d.score === undefined || d.score >= 0.5);
  } catch { return false; }
} };

publicContactFormsRouter.get('/forms/:formId', async (req: Request, res: Response) => {
  corsHeaders(res);
  const db = getDB();
  const form = await db('contact_forms').where({ id: req.params.formId }).first('id', 'name', 'fields', 'conditions', 'style_config', 'otp_enabled', 'redirect_url', 'confirmation_message');
  if (!form) { res.status(404).json({ error: 'Not found.' }); return; }
  // Expose reCAPTCHA site keys (public-safe) so embed.js can mount widgets
  const keys = await captchaKeys();
  const recaptchaV2SiteKey = keys.recaptcha_site_key || '';
  const recaptchaV3SiteKey = keys.recaptcha_v3_site_key || '';
  // Only what the form needs to draw itself: never recipients, webhook, template or client
  res.json({
    id: form.id, name: form.name, style_config: form.style_config ?? null, otp_enabled: !!form.otp_enabled,
    redirect_url: form.redirect_url ?? null, confirmation_message: form.confirmation_message ?? null,
    fields: JSON.parse(form.fields || '[]'),
    conditions: form.conditions ? JSON.parse(form.conditions) : [],
    recaptcha_v2_site_key: recaptchaV2SiteKey,
    recaptcha_v3_site_key: recaptchaV3SiteKey,
  });
});

publicContactFormsRouter.post('/forms/:formId/submit', upload.any(), async (req: Request, res: Response) => {
  corsHeaders(res);
  const db = getDB();
  const values = { ...(req.body || {}) };

  // Map uploaded files: store {stored, original} pairs
  const uploadedFiles: Express.Multer.File[] = (req as any).files || [];
  const fileRecords: Array<{ stored: string; original: string; fieldname: string }> = [];
  uploadedFiles.forEach((f) => {
    values[f.fieldname] = f.originalname;
    fileRecords.push({ stored: f.filename, original: f.originalname, fieldname: f.fieldname });
  });

  const form = await db('contact_forms').where({ id: req.params.formId }).first();
  if (!form) { res.status(404).json({ error: 'Form not found.' }); return; }
  const client = form.client_id ? await db('client_companies').where({ id: form.client_id }).select('name').first() : null;
  const senderName = client?.name || form.name;

  // reCAPTCHA v2/v3 verification
  // When reCAPTCHA is set up (a site key the embed shows, and its secret here), every submission must pass it:
  // leaving the token out is refused, and so is a check that could not be completed
  const recaptchaToken = String(values['g-recaptcha-response-v3'] || values['g-recaptcha-response'] || '');
  const captcha = await captchaKeys();
  const v3 = !!values['g-recaptcha-response-v3'];
  const configured = (captcha.recaptcha_site_key && captcha.recaptcha_secret_key) || (captcha.recaptcha_v3_site_key && captcha.recaptcha_v3_secret_key);
  if (configured) {
    const secretKey = v3 ? captcha.recaptcha_v3_secret_key : captcha.recaptcha_secret_key || captcha.recaptcha_v3_secret_key;
    if (!recaptchaToken || !secretKey) { res.status(400).json({ error: 'Please complete the "I\'m not a robot" check.' }); return; }
    if (!(await recaptcha.verify(secretKey, recaptchaToken))) { res.status(400).json({ error: 'The "I\'m not a robot" check failed. Please try again.' }); return; }
  }
  delete values['g-recaptcha-response'];
  delete values['g-recaptcha-response-v3'];

  // OTP verification
  if (form.otp_enabled) {
    const key = otpKey(req.params.formId, values.email);
    const r = checkOtp(key, values.__otp);
    if (r !== 'ok') { res.status(400).json({ error: r === 'expired' ? 'This code has expired. Please request a new one.' : 'That code is not right. Please check and try again.' }); return; }
    otpStore.delete(key);   // used: a code works for one submission only
    delete values.__otp;
  }

  const fields = JSON.parse(form.fields || '[]');
  for (const field of fields) {
    if (field.required && !String(values[field.name] || '').trim()) {
      res.status(400).json({ error: `${field.label || field.name} is required.` }); return;
    }
  }

  await db('contact_submissions').insert({
    contact_form_id: form.id,
    client_id: form.client_id,
    form_name: form.name,
    data: JSON.stringify(values),
    files: fileRecords.length ? JSON.stringify(fileRecords) : null,
    read: false,
  });

  // Notify recipients
  try {
    const toEmails = (form.to_emails || process.env.CONTACT_TO_EMAIL || '')
      .split(',').map((e: string) => e.trim()).filter(Boolean);
    if (toEmails.length) {
      const labelMap: Record<string, string> = {};
      fields.forEach((f: any) => { if (f.name) labelMap[f.name] = f.label || f.name; });
      const bodyLines = Object.entries(values).map(([k, v]) => `${labelMap[k] || k}: ${v}`).join('\n');
      const attachments = uploadedFiles.map((f) => ({ filename: f.originalname, path: f.path }));
      await sendEmail({
        to: toEmails.map((email: string) => ({ email, name: email })),
        subject: `New submission: ${form.name}`,
        body: bodyLines,
        attachments: attachments.length ? attachments : undefined,
        fromName: senderName,
      });
    }
  } catch (err) { console.error('Contact form mail send failed:', err); }

  // Confirmation email to submitter
  try {
    const confirmField = form.confirmation_email_field;
    const confirmMsg = form.confirmation_message;
    if (confirmField && confirmMsg) {
      const submitterEmail = String(values[confirmField] || '').trim();
      if (submitterEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submitterEmail)) {
        const confirmAttachments: Array<{ filename: string; path: string }> = [];
        if (form.confirmation_attachment) {
          try {
            const att = JSON.parse(form.confirmation_attachment);
            const attPath = path.join(confirmUploadDir, att.stored);
            if (fs.existsSync(attPath)) confirmAttachments.push({ filename: att.original, path: attPath });
          } catch {}
        }
        await sendEmail({
          to: [{ email: submitterEmail, name: submitterEmail }],
          subject: `Thank you for contacting us — ${senderName}`,
          body: confirmMsg,
          attachments: confirmAttachments.length ? confirmAttachments : undefined,
          fromName: senderName,
        });
      }
    }
  } catch (err) { console.error('Confirmation email failed:', err); }

  // Webhook
  try {
    if (form.webhook_url) {
      await fetch(form.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ form_id: form.id, form_name: form.name, data: values, submitted_at: new Date().toISOString() }),
      });
    }
  } catch (err) { console.error('Webhook delivery failed:', err); }

  res.json({ ok: true });
});
