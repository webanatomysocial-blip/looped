import { Router, Request, Response } from 'express';
import { getDB } from '../db';
import { authenticate, requireRoles, AuthRequest } from '../middleware/auth';
import { sendEmail } from '../services/emailService';

const router = Router();
router.use(authenticate, requireRoles('admin'));

function parseForm(form: any) {
  return { ...form, fields: JSON.parse(form.fields || '[]') };
}

// ---- clients (from client_companies, same as SEO/Ads) ----

router.get('/', async (_req: AuthRequest, res: Response) => {
  const db = getDB();
  const clients = await db('client_companies').select('id', 'name').orderBy('name');
  const counts = await db('contact_forms').select('client_id').count({ n: '*' }).groupBy('client_id');
  const countMap: Record<number, number> = {};
  counts.forEach((c: any) => { countMap[c.client_id] = Number(c.n); });
  res.json(clients.map((c: any) => ({ ...c, formCount: countMap[c.id] || 0 })));
});

router.get('/:id', async (req: AuthRequest, res: Response) => {
  const client = await getDB()('client_companies').where({ id: req.params.id }).select('id', 'name').first();
  if (!client) { res.status(404).json({ error: 'Not found.' }); return; }
  res.json(client);
});

// ---- forms ----

router.get('/:id/forms', async (req: AuthRequest, res: Response) => {
  const db = getDB();
  const forms = await db('contact_forms').where({ client_id: req.params.id }).orderBy('created_at', 'desc');
  const counts = await db('contact_submissions').select('contact_form_id').count({ n: '*' }).groupBy('contact_form_id');
  const countMap: Record<number, number> = {};
  counts.forEach((c: any) => { countMap[c.contact_form_id] = Number(c.n); });
  res.json(forms.map((f: any) => ({ ...parseForm(f), submissionCount: countMap[f.id] || 0 })));
});

router.post('/:id/forms', async (req: AuthRequest, res: Response) => {
  const { name } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: 'Form name is required.' }); return; }
  const client = await getDB()('client_companies').where({ id: req.params.id }).first();
  if (!client) { res.status(404).json({ error: 'Client not found.' }); return; }
  const defaultFields = [
    { name: 'name', label: 'Name', type: 'text', required: true },
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'message', label: 'Message', type: 'textarea', required: true },
  ];
  const [id] = await getDB()('contact_forms').insert({
    name: name.trim(),
    client_id: req.params.id,
    to_emails: process.env.CONTACT_TO_EMAIL || '',
    fields: JSON.stringify(defaultFields),
  });
  const form = await getDB()('contact_forms').where({ id }).first();
  res.status(201).json(parseForm(form));
});

router.get('/forms/:formId', async (req: AuthRequest, res: Response) => {
  const form = await getDB()('contact_forms').where({ id: req.params.formId }).first();
  if (!form) { res.status(404).json({ error: 'Not found.' }); return; }
  res.json(parseForm(form));
});

router.patch('/forms/:formId', async (req: AuthRequest, res: Response) => {
  const { name, fields, toEmails, template } = req.body;
  const update: Record<string, any> = {};
  if (name?.trim()) update.name = name.trim();
  if (fields) update.fields = JSON.stringify(fields);
  if (toEmails !== undefined) update.to_emails = toEmails.trim();
  if (template !== undefined) update.template = template;
  await getDB()('contact_forms').where({ id: req.params.formId }).update(update);
  const form = await getDB()('contact_forms').where({ id: req.params.formId }).first();
  res.json(parseForm(form));
});

router.delete('/forms/:formId', async (req: AuthRequest, res: Response) => {
  await getDB()('contact_forms').where({ id: req.params.formId }).delete();
  res.status(204).end();
});

// ---- submissions ----

router.get('/:id/submissions', async (req: AuthRequest, res: Response) => {
  const submissions = await getDB()('contact_submissions')
    .where({ client_id: req.params.id })
    .orderBy('created_at', 'desc');
  res.json(submissions.map((s: any) => ({ ...s, data: JSON.parse(s.data) })));
});

export default router;

// ---- public (no auth): embed config + submit ----

export const publicContactFormsRouter = Router();

const corsHeaders = (res: Response) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
};

publicContactFormsRouter.options('/forms/:formId', (_req: Request, res: Response) => { corsHeaders(res); res.status(204).end(); });
publicContactFormsRouter.options('/forms/:formId/submit', (_req: Request, res: Response) => { corsHeaders(res); res.status(204).end(); });

publicContactFormsRouter.get('/forms/:formId', async (req: Request, res: Response) => {
  corsHeaders(res);
  const form = await getDB()('contact_forms').where({ id: req.params.formId }).first();
  if (!form) { res.status(404).json({ error: 'Not found.' }); return; }
  res.json(parseForm(form));
});

publicContactFormsRouter.post('/forms/:formId/submit', async (req: Request, res: Response) => {
  corsHeaders(res);
  const db = getDB();
  const values = req.body || {};

  const form = await db('contact_forms').where({ id: req.params.formId }).first();
  if (!form) { res.status(404).json({ error: 'Form not found.' }); return; }

  const fields = JSON.parse(form.fields || '[]');
  for (const field of fields) {
    if (field.required && !String(values[field.name] || '').trim()) {
      res.status(400).json({ error: `${field.label || field.name} is required.` });
      return;
    }
  }

  await db('contact_submissions').insert({
    contact_form_id: form.id,
    client_id: form.client_id,
    form_name: form.name,
    data: JSON.stringify(values),
  });

  try {
    const toEmails = (form.to_emails || process.env.CONTACT_TO_EMAIL || '')
      .split(',').map((e: string) => e.trim()).filter(Boolean);
    if (toEmails.length) {
      await sendEmail({
        to: toEmails.map((email: string) => ({ email, name: email })),
        subject: `New submission: ${form.name}`,
        body: Object.entries(values).map(([key, value]) => `${key}: ${value}`).join('\n'),
      });
    }
  } catch (err) {
    console.error('Contact form mail send failed:', err);
  }

  res.json({ ok: true });
});
