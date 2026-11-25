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
      const iv = await db('rec_interviews as i').join('rec_applications as a', 'a.id', 'i.application_id').where('i.id', id).first('i.final_file', 'i.recording_deleted_at', 'a.ref', 'a.name');
      if (!iv?.final_file || iv.recording_deleted_at) { res.status(404).end(); return; }
      file = path.join(R.recordingDir(id), iv.final_file); mime = iv.final_file.endsWith('.mp4') ? 'video/mp4' : 'video/webm';
      name = `${iv.ref} ${iv.name} interview${path.extname(iv.final_file)}`;   // the name it downloads with
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
// Careers roles (recruitment's own list; not Loop's employee departments)
router.get('/departments', run(async () => getDB()('rec_roles').orderBy('name').select('id', 'name')));
// Departments are Loop-wide (employee categories), so only an admin adds one
router.post('/departments', requireRoles('admin'), run(async (req) => {
  const name = R.clip(req.body?.name, 100);
  if (!name) throw new ServiceError(400, 'Please enter a department name');
  const db = getDB();
  const same = await db('rec_roles').whereRaw('LOWER(name) = ?', [name.toLowerCase()]).first('id', 'name');
  if (same) return same;                                         // already there: reuse it, no duplicate
  const [id] = await db('rec_roles').insert({ name });
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
  // The form's "role" (category_id) is stored as the careers role, never as a Loop department
  if (row.category_id !== undefined) { row.role_id = row.category_id ? Number(row.category_id) : null; delete row.category_id; }
  for (const k of ['description', 'responsibilities', 'qualifications', 'skills']) if (row[k] !== undefined) row[k] = String(row[k] ?? '').slice(0, 10000);
  for (const k of ['experience', 'employment_type', 'location']) if (row[k] !== undefined) row[k] = R.clip(row[k], k === 'location' ? 200 : 100);
  return row;
}
const jobsQuery = () => getDB()('rec_jobs as j').leftJoin('rec_roles as c', 'c.id', 'j.role_id').leftJoin('users as u', 'u.id', 'j.created_by')
  .select('j.*', 'j.role_id as category_id', 'c.name as department', 'u.name as created_by_name',
    getDB().raw('(SELECT COUNT(*) FROM rec_applications a WHERE a.job_id = j.id) as applications'),
    getDB().raw('(SELECT COUNT(*) FROM rec_questions q WHERE q.active = ? AND (q.department_id IS NULL OR q.department_id = j.role_id)) as question_count', [true]));
// Applicants go straight into the video interview, so a role can only be published once it has questions
async function canPublish(status: unknown, categoryId: unknown) {
  if (status !== 'published') return;
  if (!(await R.roleQuestions(getDB(), categoryId ? Number(categoryId) : null)).length) throw new ServiceError(400, 'Add interview questions for this role (Question Bank) before publishing');
}
router.get('/jobs', run(async () => jobsQuery().orderBy('j.id', 'desc')));
router.post('/jobs', run(async (req) => {
  const row = jobRow({ status: 'draft', ...req.body });
  if (!row.title) throw new ServiceError(400, 'Please enter a job title');
  await canPublish(row.status, row.role_id);
  const [id] = await getDB()('rec_jobs').insert({ ...row, public_id: require('crypto').randomUUID(), created_by: req.user!.id });
  return jobsQuery().where('j.id', id).first();
}, 201));
router.put('/jobs/:id', run(async (req) => {
  const row = jobRow(req.body ?? {});
  const cur = await getDB()('rec_jobs').where({ id: num(req.params.id) }).first('status', 'role_id');
  if (cur) await canPublish(row.status ?? cur.status, row.role_id !== undefined ? row.role_id : cur.role_id);
  const n = await getDB()('rec_jobs').where({ id: num(req.params.id) }).update({ ...row, updated_at: new Date() });
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
  const q = getDB()('rec_applications as a').join('rec_jobs as j', 'j.id', 'a.job_id').leftJoin('rec_roles as c', 'c.id', 'j.role_id')
    .select('a.id', 'a.ref', 'a.name', 'a.email', 'a.phone', 'a.experience_years', 'a.status', 'a.created_at', 'a.updated_at', 'j.id as job_id', 'j.title as job_title', 'c.name as department');
  const { job_id, department_id, status, from, to, search } = req.query as any;
  if (job_id) q.where('a.job_id', Number(job_id));
  if (department_id) q.where('j.role_id', Number(department_id));
  if (status) q.whereIn('a.status', String(status).split(','));
  if (from) q.where('a.created_at', '>=', `${String(from).slice(0, 10)} 00:00:00`);
  if (to) q.where('a.created_at', '<=', `${String(to).slice(0, 10)} 23:59:59`);
  if (search) { const s = `%${String(search).slice(0, 60)}%`; q.where((w: any) => w.where('a.name', 'like', s).orWhere('a.email', 'like', s).orWhere('a.ref', 'like', s)); }
  const rows = await q.orderBy('a.id', 'desc').limit(500);
  // How much storage each applicant's files use (shown so test or old applicants can be cleared)
  const files = await getDB()('rec_applications').whereIn('id', rows.map((r: any) => r.id)).select('id', 'resume_file');
  const sizes = await R.storageBytes(getDB(), files);
  const away = await R.tabSwitches(getDB(), rows.map((r: any) => Number(r.id)));
  const integrity = new Map((await getDB()('rec_interviews').whereIn('application_id', rows.map((r: any) => r.id)).select('application_id', 'warnings', 'integrity_status', 'status')).map((i: any) => [Number(i.application_id), i]));
  const resched = new Set((await getDB()('rec_reschedule_requests').whereIn('application_id', rows.map((r: any) => r.id)).where({ status: 'pending' }).pluck('application_id')).map(Number));
  return rows.map((r: any) => ({ ...r, reschedule_pending: resched.has(Number(r.id)), warnings: Number(integrity.get(Number(r.id))?.warnings ?? 0), integrity_status: integrity.get(Number(r.id))?.integrity_status ?? null, interview_paused: integrity.get(Number(r.id))?.status === 'paused', status_label: R.STATUS_LABEL[r.status] ?? r.status, storage_bytes: sizes.get(Number(r.id)) ?? 0, ...(away.get(Number(r.id)) ?? { tab_switches: 0, away_seconds: 0 }) }));
}));

router.get('/applications/:id', run(async (req) => {
  const db = getDB(); const id = num(req.params.id);
  let a = await db('rec_applications').where({ id }).first();
  if (!a) throw new ServiceError(404, 'Application not found');
  await R.markViewed(db, actor(req), a);
  a = await db('rec_applications').where({ id }).first();
  const job = await db('rec_jobs as j').leftJoin('rec_roles as c', 'c.id', 'j.role_id').where('j.id', a.job_id).first('j.id', 'j.title', 'c.name as department');
  const history = await db('rec_history').where({ application_id: id }).orderBy('id');
  const evaluations = await db('rec_evaluations').where({ application_id: id }).orderBy('id', 'desc');
  const schedules = (await db('rec_schedules').where({ application_id: id }).orderBy('id', 'desc')).map(({ reschedule_hash, ...s }: any) => ({ ...s, date: String(s.date).slice(0, 10), interviewers: JSON.parse(s.interviewers || '[]') }));
  const reschedule_requests = (await db('rec_reschedule_requests').where({ application_id: id }).orderBy('id', 'desc')).map((r: any) => ({ ...r, date: String(r.date).slice(0, 10), followed_up: !!r.followed_up_at }));
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
      questions: await R.questionTimes(db, iv),
      events: await db('rec_events').where({ interview_id: iv.id }).orderBy('at').select('type', 'detail', 'position', 'at'),
      ...((await R.tabSwitches(db, [id])).get(id) ?? { tab_switches: 0, away_seconds: 0 }),
      monitoring: await R.monitoring(db, iv),
      warnings: Number(iv.warnings ?? 0), integrity_status: iv.integrity_status ?? null, paused_at: iv.paused_at ?? null, paused_by: iv.paused_by ?? null,
      incidents: await db('rec_incidents').where({ interview_id: iv.id }).orderBy('at').select('id', 'kind', 'serious', 'detail', 'position', 'at', 'status'),
      max_warnings: (await R.getSettings(db)).max_warnings,
    };
  }
  const identity = await R.identityMatches(db, a);

  const { access_hash, interview_hash, resume_file, current_ctc, expected_ctc, ...safe } = a;
  if (req.user!.role === 'admin') Object.assign(safe, { current_ctc, expected_ctc });   // salary: admins only
  return {
    ...safe, status_label: R.STATUS_LABEL[a.status] ?? a.status, schedule_defaults: R.OFFICE, job, history, evaluations, schedules, reschedule_requests, interview, identity,
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
router.get('/applications/:id/resume-link', run(async (req) => {
  const id = num(req.params.id);
  if (!(await getDB()('rec_applications').where({ id }).first('id'))) throw new ServiceError(404, 'Application not found');
  await R.audit(getDB(), { application_id: id, action: 'resume_opened', actor: actor(req) });   // who looked, never the link
  return { url: `/api/recruitment/media/${R.signMedia('resume', id, 0)}` };
}));
router.get('/interviews/:id/recording-links', run(async (req) => {
  const iv = await getDB()('rec_interviews').where({ id: num(req.params.id) }).first('id', 'application_id', 'segments', 'recording_deleted_at', 'final_file', 'processing_status');
  if (!iv) throw new ServiceError(404, 'Interview not found');
  if (!iv.recording_deleted_at) await R.audit(getDB(), { application_id: iv.application_id, action: 'recording_opened', actor: actor(req) });
  if (await R.processUnfinished(getDB(), iv.id)) return { status: 'processing', final: null, parts: [] };
  if (iv.recording_deleted_at) return { status: 'deleted', final: null, parts: [] };
  const parts = JSON.parse(iv.segments || '[]').filter((s: any) => s.bytes > 0).map((s: any) => ({ segment: s.n, done: s.done, url: `/api/recruitment/media/${R.signMedia('recording', iv.id, s.n)}`,
    audio_url: s.audio ? `/api/recruitment/media/${R.signMedia('audio', iv.id, s.n)}` : null }));
  // The joined recording (sound and video together, parts in order) once processing built it
  return { status: iv.processing_status ?? null, final: iv.final_file ? `/api/recruitment/media/${R.signMedia('final', iv.id, 0)}` : null, parts };
}));

// Interview integrity: admins decide (checked again in the service)
router.post('/interviews/:id/integrity', requireRoles('admin'), run(async (req) => R.reviewIntegrity(getDB(), actor(req), num(req.params.id), req.body ?? {})));
router.post('/interviews/:id/resume', requireRoles('admin'), run(async (req) => R.resumeInterview(getDB(), actor(req), num(req.params.id), req.body?.reason)));
router.post('/interviews/:id/terminate', requireRoles('admin'), run(async (req) => R.terminateInterview(getDB(), actor(req), num(req.params.id), req.body?.reason)));
router.post('/interviews/:id/delete-recording', requireRoles('admin'), run(async (req) => R.deleteRecording(getDB(), actor(req), num(req.params.id))));
router.post('/applications/:id/evaluations', run(async (req) => {
  const db = getDB(); const id = num(req.params.id);
  if (!(await db('rec_applications').where({ id }).first('id'))) throw new ServiceError(404, 'Application not found');
  const score = (v: unknown) => (v === undefined || v === null || v === '' ? null : (Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 5 ? Number(v) : (() => { throw new ServiceError(400, 'Scores are from 1 to 5'); })()));
  const b = req.body ?? {};
  const at = Number(b.video_at);
  const row = { application_id: id, reviewer_id: req.user!.id, reviewer_name: req.user!.name, overall: score(b.overall), communication: score(b.communication), confidence: score(b.confidence),
    observations: R.clip(b.observations, 4000), comments: R.clip(b.comments, 4000), video_at: Number.isFinite(at) && at >= 0 && at < 86400 ? Math.floor(at) : null };
  if (!row.overall && !row.communication && !row.confidence && !row.comments && !row.observations) throw new ServiceError(400, 'Write a comment or give a score');
  await db('rec_evaluations').insert(row);
  return db('rec_evaluations').where({ application_id: id }).orderBy('id', 'desc');
}, 201));

router.post('/applications/:id/schedule', run(async (req) => R.schedule(getDB(), actor(req), num(req.params.id), req.body ?? {}), 201));
router.put('/applications/:id/schedule/:sid', run(async (req) => R.schedule(getDB(), actor(req), num(req.params.id), req.body ?? {}, R.defaultMailer, num(req.params.sid))));
router.post('/applications/:id/schedule/:sid/cancel', run(async (req) => R.cancelSchedule(getDB(), actor(req), num(req.params.id), num(req.params.sid), req.body?.reason)));
router.post('/applications/:id/reschedule-requests/:rid/reject', run(async (req) => R.rejectRescheduleRequest(getDB(), actor(req), num(req.params.id), num(req.params.rid), req.body?.note)));
router.post('/applications/:id/final-completed', run(async (req) => R.completeFinal(getDB(), actor(req), num(req.params.id), req.body?.comment)));
router.post('/applications/bulk-delete', requireRoles('admin'), run(async (req) => R.deleteCandidates(getDB(), actor(req), Array.isArray(req.body?.ids) ? req.body.ids : [])));
router.delete('/applications/:id', requireRoles('admin'), run(async (req) => R.deleteCandidate(getDB(), num(req.params.id))));

// People who can be interviewers
router.get('/staff', run(async () => getDB()('users').whereIn('role', ['admin', 'manager', 'employee']).orderBy('name').select('id', 'name', 'role')));

// ── Question bank ──
router.get('/questions', run(async () => {
  const db = getDB();
  const used = new Set((await db('rec_interview_questions').whereNotNull('question_id').distinct('question_id')).map((r: any) => Number(r.question_id)));
  return (await db('rec_questions').orderByRaw('COALESCE(sort_order, 1000000 + id)')).map((q: any) => ({ ...q, active: !!q.active, used: used.has(Number(q.id)) }));
}));
const questionRow = (b: any) => {
  const row: any = {};
  // The role it is asked for (a department); empty = every role
  if (b.department_id !== undefined) row.department_id = b.department_id ? Number(b.department_id) : null;
  // A topic label only (questions are grouped by role): any short text is fine
  if (b.category !== undefined) row.category = R.clip(b.category, 60) || 'General';
  if (b.text !== undefined) { row.text = R.clip(b.text, 1000); if (row.text.length < 5) throw new ServiceError(400, 'Please write the question'); }
  if (b.difficulty !== undefined) row.difficulty = ['easy', 'medium', 'hard'].includes(b.difficulty) ? b.difficulty : null;
  if (b.active !== undefined) row.active = !!b.active;
  return row;
};
// Order (the list of ids as they should be asked) and shuffle, per role tab; role null = "All roles"
router.put('/questions/order', run(async (req) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter((n: number) => Number.isInteger(n) && n > 0).slice(0, 500);
  if (!ids.length) throw new ServiceError(400, 'Nothing to reorder');
  await getDB().transaction(async (trx) => { for (let i = 0; i < ids.length; i++) await trx('rec_questions').where({ id: ids[i] }).update({ sort_order: i + 1 }); });
}));
router.get('/questions/shuffle', run(async () => ({ general: await R.shuffleOn(getDB(), null), roles: Object.fromEntries((await getDB()('rec_roles').select('id', 'shuffle')).map((r: any) => [r.id, !!r.shuffle])) })));
router.put('/questions/shuffle', run(async (req) => {
  const on = !!req.body?.on; const role = req.body?.role_id ? Number(req.body.role_id) : null;
  if (role == null) { await getDB()('rec_settings').where({ name: 'shuffle_general' }).del(); await getDB()('rec_settings').insert({ name: 'shuffle_general', value: on ? '1' : '0' }); }
  else if (!(await getDB()('rec_roles').where({ id: role }).update({ shuffle: on }))) throw new ServiceError(404, 'Role not found');
  return { on };
}));
router.get('/question-categories', run(async () => R.QUESTION_CATEGORIES));
router.post('/questions', run(async (req) => {
  const row = questionRow(req.body ?? {});
  if (!row.text) throw new ServiceError(400, 'Please write the question');
  if (row.department_id && !(await getDB()('rec_roles').where({ id: row.department_id }).first('id'))) throw new ServiceError(400, 'Choose a role');
  const [id] = await getDB()('rec_questions').insert({ category: 'General', ...row, active: row.active ?? true, created_by: req.user!.id });
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
  if (department_id) q.where('j.role_id', Number(department_id));
  if (from) q.where('a.created_at', '>=', `${String(from).slice(0, 10)} 00:00:00`);
  if (to) q.where('a.created_at', '<=', `${String(to).slice(0, 10)} 23:59:59`);
  const byStatus = Object.fromEntries((await q.clone().groupBy('a.status').select('a.status').count({ n: '*' })).map((r: any) => [r.status, Number(r.n)]));
  const c = (...s: string[]) => s.reduce((n, k) => n + (byStatus[k] ?? 0), 0);
  const jobs = await db('rec_jobs').groupBy('status').select('status').count({ n: '*' });
  const jc = Object.fromEntries(jobs.map((r: any) => [r.status, Number(r.n)]));
  const perJob = await db('rec_jobs as j').leftJoin('rec_applications as a', 'a.job_id', 'j.id').leftJoin('rec_roles as c', 'c.id', 'j.role_id')
    .groupBy('j.id', 'j.title', 'j.status', 'c.name').select('j.id', 'j.title', 'j.status', 'c.name as department')
    .count({ applications: 'a.id' })
    .select(db.raw("SUM(CASE WHEN a.status = 'selected' THEN 1 ELSE 0 END) as selected"), db.raw("SUM(CASE WHEN a.status = 'rejected' THEN 1 ELSE 0 END) as rejected"));
  return {
    jobs_total: Object.values(jc).reduce((n: number, v: any) => n + v, 0), jobs_active: jc.published ?? 0,
    applications_total: Object.values(byStatus).reduce((n: number, v: any) => n + v, 0),
    // Apply → video interview → manager review → admin decision (applied/under_review/admin_review: older applications)
    awaiting_manager: c('interview_review', 'applied', 'under_review'), awaiting_admin: c('interview_admin_review', 'admin_review'),
    prelim_pending: c('prelim_pending'), awaiting_evaluation: c('interview_review', 'interview_admin_review'), to_schedule: c('prelim_approved'),
    final_scheduled: c('final_scheduled'), selected: c('selected'), rejected: c('rejected'), withdrawn: c('withdrawn'),
    by_status: byStatus, per_job: perJob.map((r: any) => ({ ...r, applications: Number(r.applications), selected: Number(r.selected ?? 0), rejected: Number(r.rejected ?? 0) })),
  };
}));

export default router;
