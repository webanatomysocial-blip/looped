// Internal recruitment API. Every admin and manager has full access to recruitment (no pod or project limits);
// who may approve what is decided in services/recruitment.ts (decide()).
import { Router, Response, Request } from 'express';
import fs from 'fs';
import path from 'path';
import { getDB } from '../db';
import { authenticate, requireRoles, AuthRequest } from '../middleware/auth';
import { sendServiceError, ServiceError } from '../services/access';
import * as R from '../services/recruitment';

const router = Router();
const run = (fn: (req: AuthRequest, res: Response) => Promise<unknown>, status = 200) => async (req: AuthRequest, res: Response) => {
  try { const out = await fn(req, res); if (!res.headersSent) res.status(status).json(out ?? { ok: true }); }
  catch (e) { sendServiceError(res, e, 'recruitment'); }
};
const actor = (req: AuthRequest): R.Actor => ({ id: req.user!.id, role: req.user!.role, name: req.user!.name });
const num = (v: unknown) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw new ServiceError(400, 'Invalid id'); return n; };

// Media (recording playback, resume view) by signed short-lived link: before the login check, since a <video> tag
// cannot send the login header. The signature is only issued to a logged-in admin or manager.
router.get('/media/:kind/:id/:seg', (req: Request, res: Response) => {
  const kind = String(req.params.kind); const id = Number(req.params.id); const seg = Number(req.params.seg);
  if (!['recording', 'audio', 'final', 'resume'].includes(kind) || !R.checkMedia(kind, id, seg, Number(req.query.exp), String(req.query.sig ?? ''))) { res.status(403).json({ error: 'Link expired' }); return; }
  (async () => {
    const db = getDB();
    let file: string; let mime: string; let name: string | null = null;
    if (kind === 'resume') {
      const a = await db('rec_applications').where({ id }).first('resume_file', 'resume_mime', 'resume_name');
      if (!a) { res.status(404).end(); return; }
      file = path.join(R.resumeDir(), a.resume_file); mime = a.resume_mime || 'application/octet-stream'; name = a.resume_name;
    } else if (kind === 'final') {
      const iv = await db('rec_interviews').where({ id }).first('final_file', 'recording_deleted_at');
      if (!iv?.final_file || iv.recording_deleted_at) { res.status(404).end(); return; }
      file = path.join(R.recordingDir(id), iv.final_file); mime = iv.final_file.endsWith('.mp4') ? 'video/mp4' : 'video/webm';
    } else {
      const iv = await db('rec_interviews').where({ id }).first('segments', 'recording_deleted_at');
      const s = iv && !iv.recording_deleted_at ? JSON.parse(iv.segments || '[]')[seg] : null;
      if (!s || (kind === 'audio' && !s.audio)) { res.status(404).end(); return; }
      // Source parts: the rebuilt part when processing made one, else the file as uploaded (older interviews)
      const built = path.join(R.recordingDir(id), 'processed', `source-${seg}.${s.mime === 'video/mp4' ? 'mp4' : 'webm'}`);
      file = kind === 'audio' ? path.join(R.recordingDir(id), `segment-${seg}.audio`) : fs.existsSync(built) ? built : path.join(R.recordingDir(id), `segment-${seg}.webm`);
      mime = kind === 'audio' ? s.audio.mime : s.mime || 'video/webm';
    }
    if (!fs.existsSync(file)) { res.status(404).end(); return; }
    const size = fs.statSync(file).size;
    res.setHeader('Content-Type', mime); res.setHeader('Accept-Ranges', 'bytes'); res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (name) res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${name.replace(/[^\w.\- ]/g, '_')}"`);
    const range = /bytes=(\d*)-(\d*)/.exec(String(req.headers.range ?? ''));
    if (range) {
      const start = range[1] ? Number(range[1]) : 0; const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start >= size || start > end) { res.status(416).setHeader('Content-Range', `bytes */${size}`); res.end(); return; }
      res.status(206).setHeader('Content-Range', `bytes ${start}-${end}/${size}`); res.setHeader('Content-Length', String(end - start + 1));
      fs.createReadStream(file, { start, end }).pipe(res);
    } else { res.setHeader('Content-Length', String(size)); fs.createReadStream(file).pipe(res); }
  })().catch((e) => sendServiceError(res, e, 'recruitment.media'));
});

router.use(authenticate, requireRoles('admin', 'manager'));

// ── Departments (Loop's employee categories) ──
router.get('/departments', run(async () => getDB()('employee_categories').orderBy('name').select('id', 'name')));
// Departments are Loop-wide (employee categories), so only an admin adds one
router.post('/departments', requireRoles('admin'), run(async (req) => {
  const name = R.clip(req.body?.name, 100);
  if (!name) throw new ServiceError(400, 'Please enter a department name');
  const db = getDB();
  const same = await db('employee_categories').whereRaw('LOWER(name) = ?', [name.toLowerCase()]).first('id', 'name');
  if (same) return same;                                         // already there: reuse it, no duplicate
  const [id] = await db('employee_categories').insert({ name });
  return { id: Number(id), name };
}, 201));

// ── Job openings ──
const JOB_FIELDS = ['title', 'category_id', 'description', 'responsibilities', 'qualifications', 'skills', 'experience', 'employment_type', 'location', 'vacancies', 'deadline', 'status'];
function jobRow(b: any) {
  const row: any = {};
  for (const k of JOB_FIELDS) if (b[k] !== undefined) row[k] = b[k];
  if (row.title !== undefined) { row.title = R.clip(row.title, 200); if (!row.title) throw new ServiceError(400, 'Please enter a job title'); }
  if (row.status !== undefined && !['draft', 'published', 'closed'].includes(row.status)) throw new ServiceError(400, 'Invalid status');
  if (row.vacancies !== undefined) { row.vacancies = Number(row.vacancies); if (!Number.isInteger(row.vacancies) || row.vacancies < 1 || row.vacancies > 999) throw new ServiceError(400, 'Vacancies must be at least 1'); }
  if (row.deadline !== undefined) row.deadline = row.deadline ? String(row.deadline).slice(0, 10) : null;
  if (row.category_id !== undefined) row.category_id = row.category_id ? Number(row.category_id) : null;
  for (const k of ['description', 'responsibilities', 'qualifications', 'skills']) if (row[k] !== undefined) row[k] = String(row[k] ?? '').slice(0, 10000);
  for (const k of ['experience', 'employment_type', 'location']) if (row[k] !== undefined) row[k] = R.clip(row[k], k === 'location' ? 200 : 100);
  return row;
}
const jobsQuery = () => getDB()('rec_jobs as j').leftJoin('employee_categories as c', 'c.id', 'j.category_id').leftJoin('users as u', 'u.id', 'j.created_by')
  .select('j.*', 'c.name as department', 'u.name as created_by_name',
    getDB().raw('(SELECT COUNT(*) FROM rec_applications a WHERE a.job_id = j.id) as applications'));
router.get('/jobs', run(async () => jobsQuery().orderBy('j.id', 'desc')));
router.post('/jobs', run(async (req) => {
  const row = jobRow({ status: 'draft', ...req.body });
  if (!row.title) throw new ServiceError(400, 'Please enter a job title');
  const [id] = await getDB()('rec_jobs').insert({ ...row, public_id: require('crypto').randomUUID(), created_by: req.user!.id });
  return jobsQuery().where('j.id', id).first();
}, 201));
router.put('/jobs/:id', run(async (req) => {
  const n = await getDB()('rec_jobs').where({ id: num(req.params.id) }).update({ ...jobRow(req.body ?? {}), updated_at: new Date() });
  if (!n) throw new ServiceError(404, 'Job not found');
  return jobsQuery().where('j.id', num(req.params.id)).first();
}));
router.delete('/jobs/:id', run(async (req) => {
  const db = getDB(); const id = num(req.params.id);
  if (await db('rec_applications').where({ job_id: id }).first('id')) throw new ServiceError(409, 'This job has applications. Close it instead of deleting it.');
  await db('rec_jobs').where({ id }).del();
}));

// ── Applications ──
router.get('/applications', run(async (req) => {
  const q = getDB()('rec_applications as a').join('rec_jobs as j', 'j.id', 'a.job_id').leftJoin('employee_categories as c', 'c.id', 'j.category_id')
    .select('a.id', 'a.ref', 'a.name', 'a.email', 'a.phone', 'a.experience_years', 'a.status', 'a.created_at', 'a.updated_at', 'j.id as job_id', 'j.title as job_title', 'c.name as department');
  const { job_id, department_id, status, from, to, search } = req.query as any;
  if (job_id) q.where('a.job_id', Number(job_id));
  if (department_id) q.where('j.category_id', Number(department_id));
  if (status) q.whereIn('a.status', String(status).split(','));
  if (from) q.where('a.created_at', '>=', `${String(from).slice(0, 10)} 00:00:00`);
  if (to) q.where('a.created_at', '<=', `${String(to).slice(0, 10)} 23:59:59`);
  if (search) { const s = `%${String(search).slice(0, 60)}%`; q.where((w: any) => w.where('a.name', 'like', s).orWhere('a.email', 'like', s).orWhere('a.ref', 'like', s)); }
  const rows = await q.orderBy('a.id', 'desc').limit(500);
  return rows.map((r: any) => ({ ...r, status_label: R.STATUS_LABEL[r.status] ?? r.status }));
}));

router.get('/applications/:id', run(async (req) => {
  const db = getDB(); const id = num(req.params.id);
  let a = await db('rec_applications').where({ id }).first();
  if (!a) throw new ServiceError(404, 'Application not found');
  await R.markViewed(db, actor(req), a);
  a = await db('rec_applications').where({ id }).first();
  const job = await db('rec_jobs as j').leftJoin('employee_categories as c', 'c.id', 'j.category_id').where('j.id', a.job_id).first('j.id', 'j.title', 'c.name as department');
  const history = await db('rec_history').where({ application_id: id }).orderBy('id');
  const evaluations = await db('rec_evaluations').where({ application_id: id }).orderBy('id', 'desc');
  const schedules = (await db('rec_schedules').where({ application_id: id }).orderBy('id', 'desc')).map((s: any) => ({ ...s, date: String(s.date).slice(0, 10), interviewers: JSON.parse(s.interviewers || '[]') }));
  const iv = await db('rec_interviews').where({ application_id: id }).first();
  let interview: any = null;
  if (iv) {
    const segments = JSON.parse(iv.segments || '[]');
    interview = {
      id: iv.id, status: iv.status, consent_at: iv.consent_at, consent_version: iv.consent_version, started_at: iv.started_at, submitted_at: iv.submitted_at,
      duration_sec: iv.submitted_at ? Math.round((new Date(iv.submitted_at).getTime() - new Date(iv.started_at).getTime()) / 1000) : null,
      recording_bytes: Number(iv.recording_bytes), recording_deleted_at: iv.recording_deleted_at,
      recording_complete: segments.length > 0 && segments.every((s: any) => s.done),
      recording_empty: Number(iv.recording_bytes) < R.MIN_VIDEO_BYTES,
      // Only "verified" means the server built the recording and measured complete sound and video
      processing_status: iv.processing_status ?? null, verified_at: iv.verified_at ?? null,
      verification: iv.verification ? JSON.parse(iv.verification) : null,
      segments: segments.map((s: any) => ({ n: s.n, bytes: s.bytes, done: s.done })),
      questions: await db('rec_interview_questions').where({ interview_id: iv.id }).orderBy('position').select('position', 'category', 'text', 'shown_at', 'answered_at'),
      events: await db('rec_events').where({ interview_id: iv.id }).orderBy('at').select('type', 'detail', 'position', 'at'),
    };
  }
  const { access_hash, interview_hash, resume_file, ...safe } = a;
  return {
    ...safe, status_label: R.STATUS_LABEL[a.status] ?? a.status, job, history, evaluations, schedules, interview,
    // What this person may do now: the same rules the server applies
    can: ['approve', 'reject', 'reopen'].filter((x) => { try { R.decide(a.status, req.user!.role, x as R.Decision, 'applied'); return x !== 'reopen' || a.status === 'rejected'; } catch { return false; } }),
  };
}));

router.post('/applications/:id/decision', run(async (req) => {
  const action = req.body?.action;
  if (!['approve', 'reject', 'reopen'].includes(action)) throw new ServiceError(400, 'Invalid action');
  return R.act(getDB(), actor(req), num(req.params.id), action, req.body?.comment);
}));

router.post('/applications/:id/interview-link', requireRoles('admin'), run(async (req) => R.renewInterviewLink(getDB(), actor(req), num(req.params.id), req.body?.mode === 'extend' ? 'extend' : 'new')));
router.post('/applications/:id/allow-reapply', requireRoles('admin'), run(async (req) => R.allowReapply(getDB(), actor(req), num(req.params.id), req.body?.reason)));
router.get('/applications/:id/resume-link', run(async (req) => ({ url: `/api/recruitment/media/${R.signMedia('resume', num(req.params.id), 0)}` })));
router.get('/interviews/:id/recording-links', run(async (req) => {
  const iv = await getDB()('rec_interviews').where({ id: num(req.params.id) }).first('id', 'segments', 'recording_deleted_at', 'final_file', 'processing_status');
  if (!iv) throw new ServiceError(404, 'Interview not found');
  if (iv.recording_deleted_at) return { status: 'deleted', final: null, parts: [] };
  const parts = JSON.parse(iv.segments || '[]').filter((s: any) => s.bytes > 0).map((s: any) => ({ segment: s.n, done: s.done, url: `/api/recruitment/media/${R.signMedia('recording', iv.id, s.n)}`,
    audio_url: s.audio ? `/api/recruitment/media/${R.signMedia('audio', iv.id, s.n)}` : null }));
  // The joined recording (sound and video together, parts in order) once processing built it
  return { status: iv.processing_status ?? null, final: iv.final_file ? `/api/recruitment/media/${R.signMedia('final', iv.id, 0)}` : null, parts };
}));

router.post('/applications/:id/evaluations', run(async (req) => {
  const db = getDB(); const id = num(req.params.id);
  if (!(await db('rec_applications').where({ id }).first('id'))) throw new ServiceError(404, 'Application not found');
  const score = (v: unknown) => (v === undefined || v === null || v === '' ? null : (Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 5 ? Number(v) : (() => { throw new ServiceError(400, 'Scores are from 1 to 5'); })()));
  const b = req.body ?? {};
  const row = { application_id: id, reviewer_id: req.user!.id, reviewer_name: req.user!.name, overall: score(b.overall), communication: score(b.communication), confidence: score(b.confidence), observations: R.clip(b.observations, 4000), comments: R.clip(b.comments, 4000) };
  if (!row.overall && !row.comments) throw new ServiceError(400, 'Add an overall score or a comment');
  await db('rec_evaluations').insert(row);
  return db('rec_evaluations').where({ application_id: id }).orderBy('id', 'desc');
}, 201));

router.post('/applications/:id/schedule', run(async (req) => R.schedule(getDB(), actor(req), num(req.params.id), req.body ?? {}), 201));
router.put('/applications/:id/schedule/:sid', run(async (req) => R.schedule(getDB(), actor(req), num(req.params.id), req.body ?? {}, R.defaultMailer, num(req.params.sid))));
router.post('/applications/:id/schedule/:sid/cancel', run(async (req) => R.cancelSchedule(getDB(), actor(req), num(req.params.id), num(req.params.sid), req.body?.reason)));
router.post('/applications/:id/final-completed', run(async (req) => R.completeFinal(getDB(), actor(req), num(req.params.id), req.body?.comment)));
router.delete('/applications/:id', requireRoles('admin'), run(async (req) => R.deleteCandidate(getDB(), num(req.params.id))));

// People who can be interviewers
router.get('/staff', run(async () => getDB()('users').whereIn('role', ['admin', 'manager', 'employee']).orderBy('name').select('id', 'name', 'role')));

// ── Question bank ──
router.get('/questions', run(async () => {
  const db = getDB();
  const used = new Set((await db('rec_interview_questions').whereNotNull('question_id').distinct('question_id')).map((r: any) => Number(r.question_id)));
  return (await db('rec_questions').orderBy('category').orderBy('id')).map((q: any) => ({ ...q, active: !!q.active, used: used.has(Number(q.id)) }));
}));
const questionRow = (b: any) => {
  const row: any = {};
  if (b.category !== undefined) { if (!R.QUESTION_CATEGORIES.includes(b.category)) throw new ServiceError(400, 'Choose a category'); row.category = b.category; }
  if (b.text !== undefined) { row.text = R.clip(b.text, 1000); if (row.text.length < 5) throw new ServiceError(400, 'Please write the question'); }
  if (b.difficulty !== undefined) row.difficulty = ['easy', 'medium', 'hard'].includes(b.difficulty) ? b.difficulty : null;
  if (b.active !== undefined) row.active = !!b.active;
  return row;
};
router.get('/question-categories', run(async () => R.QUESTION_CATEGORIES));
router.post('/questions', run(async (req) => {
  const row = questionRow(req.body ?? {});
  if (!row.category || !row.text) throw new ServiceError(400, 'Choose a category and write the question');
  const [id] = await getDB()('rec_questions').insert({ ...row, active: row.active ?? true, created_by: req.user!.id });
  return getDB()('rec_questions').where({ id }).first();
}, 201));
router.put('/questions/:id', run(async (req) => {
  const n = await getDB()('rec_questions').where({ id: num(req.params.id) }).update({ ...questionRow(req.body ?? {}), updated_at: new Date() });
  if (!n) throw new ServiceError(404, 'Question not found');
}));
// A question already asked in an interview is kept for the record: it can only be deactivated
router.delete('/questions/:id', run(async (req) => {
  const db = getDB(); const id = num(req.params.id);
  if (await db('rec_interview_questions').where({ question_id: id }).first('id')) throw new ServiceError(409, 'This question has been used in interviews. Deactivate it instead.');
  await db('rec_questions').where({ id }).del();
}));

// ── Settings ──
router.get('/settings', run(async () => R.getSettings(getDB())));
// Recruitment-wide (retention, questions, link validity): admins only
router.put('/settings', requireRoles('admin'), run(async (req) => R.saveSettings(getDB(), req.body ?? {})));

// ── Overview and reports (all from the records) ──
router.get('/overview', run(async (req) => {
  const db = getDB();
  const q = db('rec_applications as a').join('rec_jobs as j', 'j.id', 'a.job_id');
  const { job_id, department_id, from, to } = req.query as any;
  if (job_id) q.where('a.job_id', Number(job_id));
  if (department_id) q.where('j.category_id', Number(department_id));
  if (from) q.where('a.created_at', '>=', `${String(from).slice(0, 10)} 00:00:00`);
  if (to) q.where('a.created_at', '<=', `${String(to).slice(0, 10)} 23:59:59`);
  const byStatus = Object.fromEntries((await q.clone().groupBy('a.status').select('a.status').count({ n: '*' })).map((r: any) => [r.status, Number(r.n)]));
  const c = (...s: string[]) => s.reduce((n, k) => n + (byStatus[k] ?? 0), 0);
  const jobs = await db('rec_jobs').groupBy('status').select('status').count({ n: '*' });
  const jc = Object.fromEntries(jobs.map((r: any) => [r.status, Number(r.n)]));
  const perJob = await db('rec_jobs as j').leftJoin('rec_applications as a', 'a.job_id', 'j.id').leftJoin('employee_categories as c', 'c.id', 'j.category_id')
    .groupBy('j.id', 'j.title', 'j.status', 'c.name').select('j.id', 'j.title', 'j.status', 'c.name as department')
    .count({ applications: 'a.id' })
    .select(db.raw("SUM(CASE WHEN a.status = 'selected' THEN 1 ELSE 0 END) as selected"), db.raw("SUM(CASE WHEN a.status = 'rejected' THEN 1 ELSE 0 END) as rejected"));
  return {
    jobs_total: Object.values(jc).reduce((n: number, v: any) => n + v, 0), jobs_active: jc.published ?? 0,
    applications_total: Object.values(byStatus).reduce((n: number, v: any) => n + v, 0),
    awaiting_manager: c('applied', 'under_review'), awaiting_admin: c('admin_review'),
    prelim_pending: c('prelim_pending'), awaiting_evaluation: c('interview_review', 'interview_admin_review'),
    final_scheduled: c('final_scheduled'), selected: c('selected'), rejected: c('rejected'), withdrawn: c('withdrawn'),
    by_status: byStatus, per_job: perJob.map((r: any) => ({ ...r, applications: Number(r.applications), selected: Number(r.selected ?? 0), rejected: Number(r.rejected ?? 0) })),
  };
}));

export default router;
