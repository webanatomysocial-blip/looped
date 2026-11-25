// Public careers API: open jobs, applying, tracking and the preliminary interview. No Loop login: a candidate reaches
// only their own application, through the secret link they received (stored hashed). Rate-limited with the other
// public routes (/api/public).
import { Router, Request, Response } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import rateLimit from 'express-rate-limit';
import { getDB } from '../db';
import { sendServiceError, ServiceError } from '../services/access';
import * as R from '../services/recruitment';
import { io } from '../socket';

const router = Router();
const run = (fn: (req: Request, res: Response) => Promise<unknown>, status = 200) => async (req: Request, res: Response) => {
  try { res.status(status).json((await fn(req, res)) ?? { ok: true }); }
  catch (e) { if (req.file?.path) fs.rmSync(req.file.path, { force: true }); sendServiceError(res, e, 'careers'); }
};

// Applications: a few per hour per visitor, so the form cannot be used to flood the team
const applyLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: process.env.NODE_ENV === 'test' || process.env.RECRUITMENT_EMAILS === 'off' ? 1000 : 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many applications from this connection. Please try again later.' } });

// Resume: PDF, DOC or DOCX only, up to 5 MB, checked by extension, type and the file's first bytes
const RESUME_TYPES: Record<string, { mimes: string[]; magic: Buffer }> = {
  '.pdf': { mimes: ['application/pdf'], magic: Buffer.from('%PDF') },
  '.doc': { mimes: ['application/msword'], magic: Buffer.from([0xd0, 0xcf, 0x11, 0xe0]) },
  '.docx': { mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'], magic: Buffer.from('PK') },
};
const resumeUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, R.resumeDir()),
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 20 },
  fileFilter: (_req, file, cb) => {
    const t = RESUME_TYPES[path.extname(file.originalname).toLowerCase()];
    if (t && t.mimes.includes(file.mimetype)) cb(null, true);
    else cb(new ServiceError(400, 'Resume must be a PDF, DOC or DOCX file'));
  },
}).single('resume');
const withResume = (req: Request, res: Response, next: () => void) => resumeUpload(req, res, (err: any) => {
  if (!err) return next();
  res.status(400).json({ error: err instanceof ServiceError ? err.message : err?.code === 'LIMIT_FILE_SIZE' ? 'Resume must be 5 MB or smaller' : 'Could not read the resume file' });
});
function checkedResume(file?: Express.Multer.File) {
  if (!file) return null;
  const head = Buffer.alloc(8); const fd = fs.openSync(file.path, 'r'); fs.readSync(fd, head, 0, 8, 0); fs.closeSync(fd);
  const t = RESUME_TYPES[path.extname(file.originalname).toLowerCase()];
  if (!t || !head.subarray(0, t.magic.length).equals(t.magic)) throw new ServiceError(400, 'The resume file appears to be damaged or is not a real PDF/Word document');
  return { file: path.basename(file.path), name: file.originalname, mime: file.mimetype };
}

// ── Jobs ──
const openJobs = () => getDB()('rec_jobs as j').leftJoin('rec_roles as c', 'c.id', 'j.role_id')
  .where('j.status', 'published').where((q: any) => q.whereNull('j.deadline').orWhere('j.deadline', '>=', R.todayIST()))
  .select('j.public_id as id', 'j.title', 'c.name as department', 'j.location', 'j.experience', 'j.employment_type', 'j.vacancies', 'j.deadline', 'j.description', 'j.responsibilities', 'j.qualifications', 'j.skills', 'j.created_at');
// A readable link per role for posts: /careers/development-intern (from the title; the opening's id still works)
export const slugify = (t: string) => String(t ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
router.get('/jobs', run(async () => (await openJobs().orderBy('j.id', 'desc')).map((j: any) => ({ ...j, slug: slugify(j.title), deadline: j.deadline ? String(j.deadline).slice(0, 10) : null }))));
router.get('/jobs/:id', run(async (req) => {
  const key = String(req.params.id);
  // By the opening's id, else by its readable name (the newest open opening with that title)
  const j = (await openJobs().where('j.public_id', key).first())
    ?? (await openJobs().orderBy('j.id', 'desc')).find((x: any) => slugify(x.title) === key.toLowerCase());
  if (!j) throw new ServiceError(404, 'This job is no longer open');
  return { ...j, slug: slugify(j.title), deadline: j.deadline ? String(j.deadline).slice(0, 10) : null };
}));

router.post('/jobs/:id/apply', applyLimiter, withResume, run(async (req) => {
  // A hidden field real people leave empty: bots that fill every field are dropped
  if (req.body?.website) throw new ServiceError(400, 'Invalid submission');
  return R.submitApplication(getDB(), String(req.params.id), req.body ?? {}, checkedResume(req.file));
}, 201));

// ── Tracking ──
router.get('/applications/:token', run(async (req) => R.candidateView(getDB(), await R.byAccessToken(getDB(), String(req.params.token)))));
router.post('/applications/:token/withdraw', run(async (req) => {
  const db = getDB(); const a = await R.byAccessToken(db, String(req.params.token));
  await R.withdraw(db, a);
  return R.candidateView(db, await db('rec_applications').where({ id: a.id }).first());
}));
// The interview link for a shortlisted candidate who lost the email. The tracking link is equally secret.
router.post('/applications/:token/interview-link', run(async (req) => {
  const db = getDB(); const a = await R.byAccessToken(db, String(req.params.token));
  if (a.status !== 'prelim_pending' || !a.interview_expires_at || new Date(a.interview_expires_at).getTime() < Date.now()) throw new ServiceError(409, 'The interview is not available');
  const token = R.newToken();
  await db('rec_applications').where({ id: a.id }).update({ interview_hash: R.sha(token) });
  return { token };
}));

router.post('/resend-interview-link', run(async (req) => R.resendInterviewLinks(getDB(), String(req.body?.email ?? ''))));

// ── Reschedule request (link in the final interview email) ──
router.get('/reschedule/:token', run(async (req) => R.rescheduleView(getDB(), String(req.params.token))));
router.post('/reschedule/:token', run(async (req) => R.requestReschedule(getDB(), String(req.params.token), req.body ?? {})));

// ── Preliminary interview ──
const sid = (req: Request) => req.header('x-interview-session');
// Writes come only from the page that owns the interview (the latest one opened)
const iv = async (req: Request) => { const a = await R.byInterviewToken(getDB(), String(req.params.token)); await R.checkSession(getDB(), a, sid(req)); return a; };
// Reviewers with the application open see new activity at once (their page also re-checks regularly)
const lastPing = new Map<number, number>();
async function pingStaff(appId: number) {
  if (Date.now() - (lastPing.get(appId) ?? 0) < 3000) return;
  lastPing.set(appId, Date.now());
  const ids = await getDB()('users').whereIn('role', ['admin', 'manager']).pluck('id');
  for (const id of ids) io.to(`user:${id}`).emit('rec:activity', { application_id: appId });
}
router.get('/interview/:token', run(async (req) => {
  const db = getDB(); const a = await R.byInterviewToken(db, String(req.params.token));
  // Coming back to an interview already under way (refresh, another tab or device, reopened browser): the same
  // interview continues; this page takes it over and the switch is recorded for reviewers
  const live = await db('rec_interviews').where({ application_id: a.id, status: 'in_progress' }).first('id', 'current_position');
  if (live && sid(req)) { await R.claimSession(db, a, sid(req)); void pingStaff(a.id); }
  else if (live) await db('rec_events').insert({ interview_id: live.id, type: 'session_resumed', position: live.current_position, at: new Date(), received_at: new Date(), source: 'server' });
  return R.interviewState(db, a);
}));
router.post('/interview/:token/start', run(async (req) => {
  const db = getDB(); const a = await R.byInterviewToken(db, String(req.params.token));
  await R.startInterview(db, a, { accepted: req.body?.consent === true, version: String(req.body?.consent_version ?? '') });
  await R.claimSession(db, a, sid(req));
  void pingStaff(a.id);
  return R.interviewState(db, a);
}));
router.post('/interview/:token/heartbeat', run(async (req) => {
  const a = await iv(req); const r = await R.heartbeat(getDB(), a, sid(req));
  if (r.gap_seconds) void pingStaff(a.id);
  return r;
}));
router.post('/interview/:token/next', run(async (req) => R.nextQuestion(getDB(), await iv(req), Number(req.body?.position))));
router.post('/interview/:token/events', run(async (req) => {
  const a = await iv(req); const r = await R.recordEvents(getDB(), a, req.body?.events);
  if (r.saved) void pingStaff(a.id);
  return r;   // { saved, warning }: the warning (or the pause) the candidate is shown
}));
const chunkUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024, files: 1 } }).single('chunk');   // 40 MB: a whole 30-second Safari part
router.post('/interview/:token/chunk', (req, res, next) => chunkUpload(req, res, (err: any) => (err ? res.status(413).json({ error: 'Chunk too large' }) : next())), run(async (req) => {
  if (!req.file?.buffer?.length) throw new ServiceError(400, 'Empty recording chunk');
  return R.saveChunk(getDB(), await iv(req), Number(req.body?.segment), Number(req.body?.seq), req.body?.last === 'true', req.file.buffer, String(req.file.mimetype), req.body?.ms === undefined ? undefined : Number(req.body.ms));
}));
router.post('/interview/:token/audio', (req, res, next) => chunkUpload(req, res, (err: any) => (err ? res.status(413).json({ error: 'Recording too large' }) : next())), run(async (req) => {
  if (!req.file?.buffer?.length) throw new ServiceError(400, 'Empty recording');
  return R.saveAudio(getDB(), await iv(req), Number(req.body?.segment), req.file.buffer, req.body?.offset_ms === undefined ? undefined : Number(req.body.offset_ms));
}));
router.post('/interview/:token/confirm-whatsapp', run(async (req) => R.confirmWhatsApp(getDB(), await iv(req), req.body?.number)));
router.post('/interview/:token/submit', run(async (req) => {
  const db = getDB(); const id = await R.submitInterview(db, await iv(req));
  void R.processRecording(db, id);   // building and checking the recording takes a moment; reviewers see "Processing" meanwhile
  return { submitted: true };
}));

export default router;
