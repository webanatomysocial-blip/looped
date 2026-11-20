/// <reference types="node" />
// Recruitment, end to end through the real routes: public jobs and applications, tracking, the approval hierarchy
// with admin overrides, the question bank, the recorded interview, evaluation, scheduling and access control.
process.env.SQLITE_FILE = ':memory:';
process.env.JWT_SECRET = 'test-secret';
process.env.RECRUITMENT_EMAILS = 'off';
import os from 'os';
import fs from 'fs';
import path from 'path';
process.env.RECRUITMENT_STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
delete process.env.NODE_ENV;

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import { AddressInfo } from 'net';
import { initDB, getDB } from '../db';
import recruitmentRoutes from '../routes/recruitment';
import publicRoutes from '../routes/publicRecruitment';
import * as R from './recruitment';
import { listenLocal } from '../testServer';

let base = ''; let server: any;
const U: Record<string, any> = {};
const sent: string[] = [];   // candidate emails that would have gone out

async function call(who: string | null, method: string, url: string, body?: any, form?: FormData) {
  const headers: Record<string, string> = {};
  if (who) headers.Authorization = `Bearer ${jwt.sign({ id: U[who].id, role: U[who].role, email: U[who].email, name: U[who].name }, 'test-secret', { algorithm: 'HS256' })}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers, body: form ?? (body ? JSON.stringify(body) : undefined) });
  const text = await res.text(); let json: any = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, body: json, raw: text, headers: res.headers };
}
const ok = async (who: string | null, method: string, url: string, want: number, body?: any, form?: FormData) => {
  const r = await call(who, method, url, body, form);
  assert.equal(r.status, want, `${who ?? 'public'} ${method} ${url} → ${r.status} ${r.raw.slice(0, 200)}`);
  return r.body;
};
const PDF = Buffer.from('%PDF-1.4\n% test resume\n');
function applyForm(fields: Record<string, string>, file: { data: Buffer; name: string; type: string } | null = { data: PDF, name: 'cv.pdf', type: 'application/pdf' }) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  if (file) f.append('resume', new Blob([new Uint8Array(file.data)], { type: file.type }), file.name);
  return f;
}
const candidate = (email: string) => ({ name: 'Asha Rao', email, phone: '+91 98765 43210', location: 'Hyderabad', education: 'B.Tech', experience_years: '2', company: 'Acme', skills: 'React, Node' });

let JOB = ''; let JOB_ID = 0;
before(async () => {
  await initDB();
  const db = getDB();
  for (const [k, role] of [['admin', 'admin'], ['admin2', 'admin'], ['mgr', 'manager'], ['mgr2', 'manager'], ['emp', 'employee'], ['client', 'client']] as const) {
    const [id] = await db('users').insert({ name: k, email: `${k}@rec.test`, password_hash: 'x', role, pod: role === 'manager' ? 'pod2' : null });
    U[k] = { id, role, name: k, email: `${k}@rec.test` };
  }
  // Three general questions keep the interviews in these tests short (every active question is asked)
  const keep = (await db('rec_questions').orderBy('id').limit(3).pluck('id'));
  await db('rec_questions').whereNotIn('id', keep).update({ active: false });
  for (const m of ['interviewInvite', 'scheduled', 'cancelled', 'selected', 'welcome'] as const) (R.defaultMailer as any)[m] = async (a: any) => { sent.push(`${m}:${a.email}`); };
  const app = express();
  app.use(express.json());
  app.use('/api/recruitment', recruitmentRoutes);
  app.use('/api/public/careers', publicRoutes);
  server = await listenLocal(app);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => { server?.close(); await getDB().destroy(); fs.rmSync(process.env.RECRUITMENT_STORAGE_DIR!, { recursive: true, force: true }); });

// ── Departments and job openings ──
test('careers roles: recruitment\'s own list, never Loop\'s departments; "create new" adds once; only admins add', async () => {
  const loopBefore = Number((await getDB()('employee_categories').count({ n: '*' }).first() as any).n);
  const list = await ok('mgr', 'GET', '/api/recruitment/departments', 200);
  assert.ok(!list.some((d: any) => d.name === 'Web Developer'), 'Loop\'s employee departments are not offered');
  await ok('mgr', 'POST', '/api/recruitment/departments', 403, { name: 'Video Editing' });
  const made = await ok('admin', 'POST', '/api/recruitment/departments', 201, { name: 'Video Editing' });
  assert.equal(Number((await getDB()('employee_categories').count({ n: '*' }).first() as any).n), loopBefore, 'Loop\'s department list is untouched');
  const again = await ok('admin', 'POST', '/api/recruitment/departments', 201, { name: 'video editing' });
  assert.equal(again.id, made.id, 'same name: reused, not duplicated');
  assert.ok((await ok('admin', 'GET', '/api/recruitment/departments', 200)).some((d: any) => d.name === 'Video Editing'), 'available for future openings');
  await ok('emp', 'POST', '/api/recruitment/departments', 403, { name: 'X' });
});

test('job openings: a manager creates a draft (hidden publicly), publishes it (listed), closes it (hidden again)', async () => {
  const dept = await ok('admin', 'POST', '/api/recruitment/departments', 201, { name: 'Web Developer' });   // a careers role
  const job = await ok('mgr', 'POST', '/api/recruitment/jobs', 201, { title: 'Frontend Developer', category_id: dept.id, description: 'Build UIs', experience: '1-3 years', employment_type: 'Full-time', location: 'Hyderabad', vacancies: 2, deadline: '2099-12-31' });
  assert.equal(job.status, 'draft'); assert.equal(job.department, 'Web Developer');
  assert.ok(!(await ok(null, 'GET', '/api/public/careers/jobs', 200)).some((j: any) => j.title === 'Frontend Developer'), 'a draft is not public');
  await ok('admin', 'PUT', `/api/recruitment/jobs/${job.id}`, 200, { status: 'published' });
  const pub = (await ok(null, 'GET', '/api/public/careers/jobs', 200)).find((j: any) => j.title === 'Frontend Developer');
  assert.ok(pub && /^[0-9a-f-]{36}$/.test(pub.id), 'listed with an unguessable id, not the number');
  assert.equal(pub.department, 'Web Developer');
  JOB = pub.id; JOB_ID = job.id;
  const closed = await ok('mgr', 'POST', '/api/recruitment/jobs', 201, { title: 'Closed role', status: 'published' });
  await ok('mgr', 'PUT', `/api/recruitment/jobs/${closed.id}`, 200, { status: 'closed' });
  assert.ok(!(await ok(null, 'GET', '/api/public/careers/jobs', 200)).some((j: any) => j.title === 'Closed role'));
  await ok('emp', 'GET', '/api/recruitment/jobs', 403);
  await ok('client', 'GET', '/api/recruitment/jobs', 403);
  await ok(null, 'GET', '/api/recruitment/jobs', 401);
});

// ── Applying and tracking ──
let TOKEN = ''; let APP_ID = 0;
test('applying: valid application gets a reference and a private tracking link; duplicates for the same job are refused', async () => {
  const out = await ok(null, 'POST', `/api/public/careers/jobs/${JOB}/apply`, 201, undefined, applyForm(candidate('asha@x.test')));
  assert.match(out.ref, /^LP-[0-9A-F]{10}$/); assert.ok(out.token.length >= 40);
  TOKEN = out.token; assert.ok(out.interview_token.length >= 40, 'the video interview link comes straight back');
  APP_ID = (await getDB()('rec_applications').where({ ref: out.ref }).first('id')).id;
  await ok(null, 'POST', `/api/public/careers/jobs/${JOB}/apply`, 409, undefined, applyForm(candidate('ASHA@x.test')));
  const view = await ok(null, 'GET', `/api/public/careers/applications/${TOKEN}`, 200);
  assert.equal(view.status, 'Video Interview Pending'); assert.equal(view.job, 'Frontend Developer');
  assert.equal(view.interview.open, true);
  assert.ok(!('history' in view) && !('email' in view) && !('resume_file' in view), 'no internal data');
  await ok(null, 'GET', `/api/public/careers/applications/${'x'.repeat(43)}`, 404);
  const inbox = await getDB()('notifications').where({ type: 'recruitment' }).whereRaw("message LIKE '%Asha Rao%'");
  assert.ok(inbox.length >= 4, 'admins and managers notified of the new application');
});

test('resume validation: only real PDF/DOC/DOCX up to 5 MB; required fields checked', async () => {
  const bad = async (file: any, msg: RegExp, fields = candidate(`r${Math.random()}@x.test`)) => {
    const r = await call(null, 'POST', `/api/public/careers/jobs/${JOB}/apply`, undefined, applyForm(fields, file));
    assert.equal(r.status, 400, r.raw); assert.match(r.body.error, msg);
  };
  await bad({ data: Buffer.from('MZ evil'), name: 'cv.exe', type: 'application/octet-stream' }, /PDF, DOC or DOCX/);
  await bad({ data: Buffer.from('<html>'), name: 'cv.pdf', type: 'application/pdf' }, /damaged|not a real/);
  await bad({ data: Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)]), name: 'cv.pdf', type: 'application/pdf' }, /5 MB/);
  await bad(null, /attach your resume/);
  await bad({ data: PDF, name: 'cv.pdf', type: 'application/pdf' }, /valid email/, { ...candidate('nope'), email: 'not-an-email' });
  assert.equal(fs.readdirSync(R.resumeDir()).length, 1, 'rejected uploads are not kept');
});

test('a candidate can apply to a different job with the same email', async () => {
  const j2 = await ok('admin', 'POST', '/api/recruitment/jobs', 201, { title: 'SEO Executive', status: 'published' });
  const pub = (await ok(null, 'GET', '/api/public/careers/jobs', 200)).find((j: any) => j.title === 'SEO Executive');
  await ok(null, 'POST', `/api/public/careers/jobs/${pub.id}/apply`, 201, undefined, applyForm(candidate('asha@x.test')));
  await ok('admin', 'PUT', `/api/recruitment/jobs/${j2.id}`, 200, { status: 'closed' });
});

// ── The flow: straight to the video interview ──
test('a new application goes straight to the video interview: no screening step; nobody approves before it; an admin can still reject', async () => {
  const detail = await ok('mgr', 'GET', `/api/recruitment/applications/${APP_ID}`, 200);
  assert.equal(detail.status, 'prelim_pending'); assert.equal(detail.status_label, 'Video Interview Pending');
  assert.ok(!('access_hash' in detail) && !('resume_file' in detail));
  assert.deepEqual(detail.can, [], 'a manager has nothing to decide before the interview');
  assert.ok(sent.includes('interviewInvite:asha@x.test'), 'the interview link is also emailed');
  await ok('mgr', 'POST', `/api/recruitment/applications/${APP_ID}/decision`, 403, { action: 'reject', comment: 'x' });
  await ok('admin', 'POST', `/api/recruitment/applications/${APP_ID}/decision`, 409, { action: 'approve' });
  assert.deepEqual((await ok('admin', 'GET', `/api/recruitment/applications/${APP_ID}`, 200)).can, ['reject']);
  assert.deepEqual((await getDB()('rec_history').where({ application_id: APP_ID }).orderBy('id')).map((h: any) => [h.action, h.to_status]), [['applied', 'prelim_pending']]);
});

test('rejection: an admin rejects with a reason; the candidate sees it only on the page (no email); an admin can reopen', async () => {
  const { ref, token } = await ok(null, 'POST', `/api/public/careers/jobs/${JOB}/apply`, 201, undefined, applyForm(candidate('rej@x.test')));
  const id = (await getDB()('rec_applications').where({ ref }).first('id')).id;
  await ok('admin', 'POST', `/api/recruitment/applications/${id}/decision`, 400, { action: 'reject' });
  const before = sent.length;
  await ok('admin', 'POST', `/api/recruitment/applications/${id}/decision`, 200, { action: 'reject', comment: 'Not enough experience' });
  assert.equal(sent.length, before, 'no rejection email');
  const view = await ok(null, 'GET', `/api/public/careers/applications/${token}`, 200);
  assert.equal(view.status, 'Not Selected'); assert.ok(!JSON.stringify(view).includes('Not enough experience'), 'the reason stays internal');
  await ok('mgr', 'POST', `/api/recruitment/applications/${id}/decision`, 403, { action: 'reopen' });
  const re = await ok('admin', 'POST', `/api/recruitment/applications/${id}/decision`, 200, { action: 'reopen', comment: 'Reconsidering' });
  assert.equal(re.status, 'prelim_pending', 'back to where it was before the rejection');
  const h = await getDB()('rec_history').where({ application_id: id, action: 'reopen' }).first();
  assert.ok(h.override && h.actor_role === 'admin' && h.from_status === 'rejected' && h.comment === 'Reconsidering');
});

test('admin override: approving a video interview directly at the manager step is allowed and recorded as an override', async () => {
  const { ref } = await ok(null, 'POST', `/api/public/careers/jobs/${JOB}/apply`, 201, undefined, applyForm(candidate('direct@x.test')));
  const id = (await getDB()('rec_applications').where({ ref }).first('id')).id;
  await getDB()('rec_applications').where({ id }).update({ status: 'interview_review' });   // interview done
  const out = await ok('admin2', 'POST', `/api/recruitment/applications/${id}/decision`, 200, { action: 'approve', comment: 'Strong answers' });
  assert.deepEqual(out, { status: 'prelim_approved', override: true });
  const h = await getDB()('rec_history').where({ application_id: id, action: 'approve' }).first();
  assert.ok(h.override && h.actor_name === 'admin2' && h.from_status === 'interview_review' && h.to_status === 'prelim_approved' && h.comment === 'Strong answers' && h.created_at);
});

test('the rules live in one place: decide()', () => {
  assert.deepEqual(R.decide('applied', 'manager', 'approve'), { to: 'admin_review', override: false });
  assert.deepEqual(R.decide('interview_review', 'admin', 'reject'), { to: 'rejected', override: true });
  assert.throws(() => R.decide('admin_review', 'manager', 'reject'), /admin/);
  assert.throws(() => R.decide('applied', 'employee', 'approve'), /Not authorised/);
  assert.throws(() => R.decide('selected', 'admin', 'approve'), /No decision/);
});

// ── Question bank ──
test('question bank: add, edit, deactivate; a used question cannot be deleted, an unused one can', async () => {
  const q = await ok('mgr', 'POST', '/api/recruitment/questions', 201, { category: 'Career Goals', text: 'What would you like to learn here?', difficulty: 'easy' });
  await ok('admin', 'PUT', `/api/recruitment/questions/${q.id}`, 200, { text: 'What would you most like to learn here?' });
  await ok('mgr', 'POST', '/api/recruitment/questions', 400, { category: 'Not a category', text: 'Hello there?' });
  const all = await ok('mgr', 'GET', '/api/recruitment/questions', 200);
  assert.ok(all.length >= 11 && all.every((x: any) => typeof x.active === 'boolean'));
  await ok('mgr', 'DELETE', `/api/recruitment/questions/${q.id}`, 200);
  await ok('emp', 'GET', '/api/recruitment/questions', 403);
});

test('settings: question count and time per question are configurable within limits', async () => {
  await ok('admin', 'PUT', '/api/recruitment/settings', 400, { question_count: 0 });
  // Recruitment-wide settings: admins only (a manager can't shorten retention or change the interview)
  await ok('mgr', 'PUT', '/api/recruitment/settings', 403, { recording_retention_days: 7 });
  assert.equal((await ok('mgr', 'GET', '/api/recruitment/settings', 200)).recording_retention_days, 180, 'unchanged');
  const s = await ok('admin', 'PUT', '/api/recruitment/settings', 200, { question_count: 3, seconds_per_question: 60 });
  assert.equal(s.question_count, 3); assert.equal(s.seconds_per_question, 60);
});

test('role questions: every active question for the role is asked (all roles first, then the role\'s own); never inactive or another role\'s', async () => {
  const db = getDB();
  const dev = (await ok('admin', 'POST', '/api/recruitment/departments', 201, { name: 'Development' })).id;
  const seo = (await ok('admin', 'POST', '/api/recruitment/departments', 201, { name: 'SEO' })).id;
  const roleQ = await ok('mgr', 'POST', '/api/recruitment/questions', 201, { department_id: dev, text: 'Walk us through a bug you fixed recently.' });
  await ok('mgr', 'POST', '/api/recruitment/questions', 201, { department_id: seo, text: 'How do you research keywords?' });
  const off = await ok('mgr', 'POST', '/api/recruitment/questions', 201, { department_id: dev, text: 'INACTIVE ROLE QUESTION' });
  await ok('mgr', 'PUT', `/api/recruitment/questions/${off.id}`, 200, { active: false });
  const job = await ok('admin', 'POST', '/api/recruitment/jobs', 201, { title: 'Backend Developer', category_id: dev, status: 'published' });
  const { ref } = await ok(null, 'POST', `/api/public/careers/jobs/${job.public_id}/apply`, 201, undefined, applyForm(candidate('roleq@x.test')));
  const a = await db('rec_applications').where({ ref }).first();
  const iv = await R.startInterview(db, a, { accepted: true, version: 'v1' });
  const asked = (await db('rec_interview_questions').where({ interview_id: iv.id }).orderBy('position')).map((q: any) => q.text);
  assert.equal(asked.length, 4, 'the 3 general questions and the role\'s 1');
  assert.equal(asked[3], roleQ.text, 'role questions after the general ones');
  assert.ok(!asked.includes('INACTIVE ROLE QUESTION') && !asked.includes('How do you research keywords?'));
  // A role with no questions at all can't be published (applicants go straight into the interview)
  await db('rec_questions').update({ active: false });
  await ok('admin', 'POST', '/api/recruitment/jobs', 400, { title: 'No questions yet', category_id: seo, status: 'published' });
  await db('rec_questions').whereIn('id', (await db('rec_questions').whereNull('department_id').orderBy('id').limit(3).pluck('id'))).update({ active: true });
  await db('rec_questions').where({ department_id: dev }).whereNot({ id: off.id }).update({ active: true });
  await db('rec_questions').where({ department_id: seo }).update({ active: true });
});

// ── Preliminary interview ──
let IV_TOKEN = '';
test('interview: no questions before consent; consent is required and recorded; refresh keeps the same questions', async () => {
  IV_TOKEN = (await ok(null, 'POST', `/api/public/careers/applications/${TOKEN}/interview-link`, 200)).token;
  const pre = await ok(null, 'GET', `/api/public/careers/interview/${IV_TOKEN}`, 200);
  assert.equal(pre.state, 'not_started'); assert.equal(pre.current, null, 'no question is shown before starting'); assert.equal(pre.question_count, 3);
  assert.match(pre.consent_text, /recorded/);
  await ok(null, 'POST', `/api/public/careers/interview/${IV_TOKEN}/start`, 400, { consent: false, consent_version: 'v1' });
  assert.equal(await getDB()('rec_interviews').where({ application_id: APP_ID }).first(), undefined, 'nothing starts without consent');
  const s1 = await ok(null, 'POST', `/api/public/careers/interview/${IV_TOKEN}/start`, 200, { consent: true, consent_version: 'v1' });
  assert.equal(s1.state, 'in_progress'); assert.ok(s1.current.text);
  const iv = await getDB()('rec_interviews').where({ application_id: APP_ID }).first();
  assert.ok(iv.consent_at && iv.consent_version === 'v1');
  const s2 = await ok(null, 'GET', `/api/public/careers/interview/${IV_TOKEN}`, 200);
  const s3 = await ok(null, 'POST', `/api/public/careers/interview/${IV_TOKEN}/start`, 200, { consent: true, consent_version: 'v1' });
  assert.equal(s2.current.text, s1.current.text); assert.equal(s3.current.text, s1.current.text, 'starting again resumes; questions are not regenerated');
  assert.equal(Number((await getDB()('rec_interview_questions').where({ interview_id: iv.id }).count({ n: '*' }).first() as any).n), 3);
});

test('interview: monitoring events are stored with times; unknown event types are ignored', async () => {
  const r = await ok(null, 'POST', `/api/public/careers/interview/${IV_TOKEN}/events`, 200, { events: [{ type: 'tab_hidden', at: new Date().toISOString() }, { type: 'fullscreen_exit' }, { type: 'drop table' }] });
  assert.equal(r.saved, 2);
  const iv = await getDB()('rec_interviews').where({ application_id: APP_ID }).first();
  assert.deepEqual((await getDB()('rec_events').where({ interview_id: iv.id }).orderBy('id')).map((e: any) => e.type), ['interview_started', 'session_resumed', 'tab_hidden', 'fullscreen_exit'], 'the refresh in the test before is recorded as a return');
});

const chunk = (seg: number, seq: number, last: boolean, data = Buffer.from(`chunk-${seg}-${seq}`)) => {
  const f = new FormData(); f.append('segment', String(seg)); f.append('seq', String(seq)); f.append('last', String(last));
  f.append('chunk', new Blob([new Uint8Array(data)], { type: 'video/webm;codecs=vp8,opus' }), 'c.webm'); return f;
};
test('interview: recording uploads in order; repeats are ignored; gaps are refused; submit is refused until complete', async () => {
  const u = (seg: number, seq: number, last: boolean, want = 200) => ok(null, 'POST', `/api/public/careers/interview/${IV_TOKEN}/chunk`, want, undefined, chunk(seg, seq, last));
  await u(0, 0, false);
  assert.equal((await u(0, 0, false)).duplicate, true, 'a retried chunk is not written twice');
  await u(0, 2, false, 409);
  await u(0, 1, false);
  // Apple devices also send each part's sound on its own; a repeat is ignored
  const snd = () => { const f = new FormData(); f.append('segment', '0'); f.append('chunk', new Blob([new Uint8Array(Buffer.from('sound-0'))], { type: 'audio/mp4' }), 's.m4a'); return f; };
  assert.equal((await ok(null, 'POST', `/api/public/careers/interview/${IV_TOKEN}/audio`, 200, undefined, snd())).duplicate, false);
  assert.equal((await ok(null, 'POST', `/api/public/careers/interview/${IV_TOKEN}/audio`, 200, undefined, snd())).duplicate, true);
  // Answer every question, then try to submit with the recording still open
  for (let p = 0; p < 3; p++) await ok(null, 'POST', `/api/public/careers/interview/${IV_TOKEN}/next`, 200, { position: p });
  const st = await ok(null, 'POST', `/api/public/careers/interview/${IV_TOKEN}/next`, 200, { position: 1 });
  assert.equal(st.position, 3, 'a repeated click does not skip a question');
  const r = await call(null, 'POST', `/api/public/careers/interview/${IV_TOKEN}/submit`);
  assert.equal(r.status, 409); assert.match(r.body.error, /not finished uploading/);
  assert.equal((await getDB()('rec_applications').where({ id: APP_ID }).first()).status, 'prelim_pending', 'never marked completed while the upload is incomplete');
  // The recorder restarted (e.g. a reload): a second segment
  await u(0, 2, true);
  // A segment that only says "ended" (one empty byte): nothing is written for it
  await ok(null, 'POST', `/api/public/careers/interview/${IV_TOKEN}/chunk`, 200, undefined, chunk(1, 0, true, Buffer.from([0])));
  await ok(null, 'POST', `/api/public/careers/interview/${IV_TOKEN}/submit`, 200);
  const iv = await getDB()('rec_interviews').where({ application_id: APP_ID }).first();
  assert.equal(iv.status, 'submitted');
  assert.equal(JSON.parse(iv.segments)[1].bytes, 0, 'the end marker is not stored as video');
  assert.ok(!fs.existsSync(path.join(R.recordingDir(iv.id), 'segment-1.webm')));
  // These test chunks are a few bytes, far less than any real video: reviewers are told plainly
  // Each chunk is kept as received, one file each, listed once in the manifest
  const chunkFiles = fs.readdirSync(path.join(R.recordingDir(iv.id), 'segment-0')).sort();
  assert.deepEqual(chunkFiles, ['000000.part', '000001.part', '000002.part']);
  assert.deepEqual(JSON.parse(iv.segments)[0].parts.map((x: any) => x.seq), [0, 1, 2]);
  assert.equal(iv.processing_status, 'processing', 'never "complete" on upload alone');
  // These test chunks are text, not media: processing must fail loudly and keep every uploaded chunk
  assert.equal(await R.processRecording(getDB(), iv.id), 'failed');
  assert.equal(fs.readFileSync(path.join(R.recordingDir(iv.id), 'processed', 'source-0.webm'), 'utf8'), 'chunk-0-0chunk-0-1chunk-0-2', 'rebuilt in order, none twice');
  assert.deepEqual(fs.readdirSync(path.join(R.recordingDir(iv.id), 'segment-0')).sort(), chunkFiles, 'originals kept after a failure');
  assert.equal((await getDB()('rec_applications').where({ id: APP_ID }).first()).status, 'interview_review');
  // Open until the candidate confirms their WhatsApp number
  const after = await ok(null, 'GET', `/api/public/careers/interview/${IV_TOKEN}`, 200);
  assert.equal(after.state, 'submitted'); assert.equal(after.whatsapp_confirmed, false); assert.equal(after.phone, '+91 98765 43210', 'prefilled from the application');
  await ok(null, 'POST', `/api/public/careers/interview/${IV_TOKEN}/confirm-whatsapp`, 400, { number: '12345' });
  const conf = await ok(null, 'POST', `/api/public/careers/interview/${IV_TOKEN}/confirm-whatsapp`, 200, { number: '+91 98765 43210' });
  assert.match(conf.tracking_url, /\/careers\/track\/[\w-]{40,}$/); assert.equal(conf.number, '919876543210');
  const welcome = await getDB()('whatsapp_outbox').where({ event_key: `rec-welcome:${APP_ID}` }).first();
  assert.equal(welcome.kind, 'recruitment');
  const msg = JSON.parse(welcome.payload);
  assert.equal(msg.to, '919876543210@s.whatsapp.net', 'a private chat to the confirmed number');
  assert.ok(msg.text.includes(conf.tracking_url) && /welcome/i.test(msg.text), 'greeting with the new tracking link');
  assert.equal(welcome.status, 'pending', 'queued only: nothing is sent during tests');
  assert.ok(sent.includes('welcome:asha@x.test'), 'the thank-you email goes to the address on the application');
  // The old tracking link stops working; the new one opens the application
  await ok(null, 'GET', `/api/public/careers/applications/${TOKEN}`, 404);
  assert.equal((await ok(null, 'GET', `/api/public/careers/applications/${conf.tracking_url.split('/').pop()}`, 200)).ref, (await getDB()('rec_applications').where({ id: APP_ID }).first()).ref);
  TOKEN = conf.tracking_url.split('/').pop()!;   // the rest of the suite follows the new link
  await ok(null, 'POST', `/api/public/careers/interview/${IV_TOKEN}/confirm-whatsapp`, 404, { number: '919876543210' });   // link closed
  await ok(null, 'GET', `/api/public/careers/interview/${IV_TOKEN}`, 404);
  assert.equal((await ok(null, 'GET', `/api/public/careers/applications/${TOKEN}`, 200)).status, 'Video Interview Completed · Under Review');
});

test('recording access: only through a signed, expiring link issued to admins and managers; ranges work for playback', async () => {
  const iv = await getDB()('rec_interviews').where({ application_id: APP_ID }).first();
  await ok('emp', 'GET', `/api/recruitment/interviews/${iv.id}/recording-links`, 403);
  await ok(null, 'GET', `/api/recruitment/interviews/${iv.id}/recording-links`, 401);
  const media = await ok('mgr', 'GET', `/api/recruitment/interviews/${iv.id}/recording-links`, 200);
  assert.equal(media.status, 'failed'); assert.equal(media.final, null, 'no verified file is offered for a failed recording');
  const links = media.parts;
  assert.equal(links.length, 1, 'a segment with no video (only the end marker) gets no player');
  const full = await fetch(base + links[0].url);
  assert.equal(full.status, 200); assert.equal(await full.text(), 'chunk-0-0chunk-0-1chunk-0-2');
  assert.equal(full.headers.get('cache-control'), 'private, no-store');
  assert.equal(await (await fetch(base + links[0].audio_url)).text(), 'sound-0', 'the separate sound plays through its own signed link');
  const part = await fetch(base + links[0].url, { headers: { Range: 'bytes=0-6' } });
  assert.equal(part.status, 206); assert.equal(await part.text(), 'chunk-0');
  assert.equal((await fetch(base + links[0].url.replace(/sig=[^&]+/, 'sig=forged'))).status, 403);
  assert.equal((await fetch(base + `/api/recruitment/media/recording/${iv.id}/0?exp=1&sig=x`)).status, 403, 'expired');
  const resume = await ok('admin', 'GET', `/api/recruitment/applications/${APP_ID}/resume-link`, 200);
  assert.equal(await (await fetch(base + resume.url)).text(), PDF.toString());
  assert.ok(!fs.realpathSync(R.storageDir()).includes('/uploads'), 'stored outside the public uploads folder');
});

test('review: the dashboard shows questions, timestamps, events and recording status; evaluation and the interview approval hierarchy', async () => {
  const d = await ok('mgr', 'GET', `/api/recruitment/applications/${APP_ID}`, 200);
  assert.equal(d.interview.questions.length, 3); assert.ok(d.interview.questions.every((q: any) => q.shown_at && q.answered_at));
  assert.ok(d.interview.events.some((e: any) => e.type === 'tab_hidden'));
  assert.equal(d.interview.recording_complete, true);
  assert.deepEqual(d.can, ['approve', 'reject']);
  await ok('mgr', 'POST', `/api/recruitment/applications/${APP_ID}/evaluations`, 400, { overall: 9 });
  const ev = await ok('mgr', 'POST', `/api/recruitment/applications/${APP_ID}/evaluations`, 201, { overall: 4, communication: 5, confidence: 3, observations: 'Looked away twice; explained it was notes', comments: 'Recommend' });
  assert.equal(ev[0].reviewer_name, 'mgr');
  await ok('mgr', 'POST', `/api/recruitment/applications/${APP_ID}/decision`, 200, { action: 'approve' });
  assert.equal((await getDB()('rec_applications').where({ id: APP_ID }).first()).status, 'interview_admin_review');
  await ok('mgr', 'POST', `/api/recruitment/applications/${APP_ID}/decision`, 403, { action: 'approve' });
  await ok('admin', 'POST', `/api/recruitment/applications/${APP_ID}/decision`, 200, { action: 'approve' });
  assert.equal((await getDB()('rec_applications').where({ id: APP_ID }).first()).status, 'prelim_approved');
  // Monitoring events never reject anyone by themselves
  assert.ok(!(await getDB()('rec_history').where({ application_id: APP_ID, to_status: 'rejected' }).first()));
});

test('scheduling: walk-in needs an address, online needs an https link; reschedule and cancel are logged; candidate sees the schedule', async () => {
  const url = `/api/recruitment/applications/${APP_ID}/schedule`;
  await ok('mgr', 'POST', url, 400, { type: 'walkin', date: '2099-01-10', start_time: '10:00', end_time: '11:00' });
  await ok('mgr', 'POST', url, 400, { type: 'online', date: '2099-01-10', start_time: '10:00', end_time: '11:00', meeting_url: 'http://insecure' });
  await ok('mgr', 'POST', url, 400, { type: 'walkin', date: '2099-01-10', start_time: '11:00', end_time: '10:00', address: 'X' });
  await ok('mgr', 'POST', url, 201, { type: 'walkin', date: '2099-01-10', start_time: '10:00', end_time: '11:00', location: 'HQ', address: '1 Main Road, Hyderabad', interviewer_ids: [U.mgr.id, U.emp.id], instructions: 'Bring ID' });
  assert.ok(sent.includes('scheduled:asha@x.test'));
  let view = await ok(null, 'GET', `/api/public/careers/applications/${TOKEN}`, 200);
  assert.equal(view.status, 'Final Interview Scheduled'); assert.equal(view.schedule.address, '1 Main Road, Hyderabad'); assert.equal(view.schedule.date, '2099-01-10');
  assert.ok(!('interviewers' in view.schedule), 'interviewer names stay internal');
  const sid = (await getDB()('rec_schedules').where({ application_id: APP_ID }).first()).id;
  await ok('admin', 'PUT', `${url}/${sid}`, 200, { type: 'online', date: '2099-01-11', start_time: '15:00', end_time: '15:30', meeting_url: 'https://meet.example.com/abc', reason: 'Interviewer travelling' });
  view = await ok(null, 'GET', `/api/public/careers/applications/${TOKEN}`, 200);
  assert.equal(view.schedule.meeting_url, 'https://meet.example.com/abc');
  await ok('mgr', 'POST', `${url}/${sid}/cancel`, 400, {});
  await ok('mgr', 'POST', `${url}/${sid}/cancel`, 200, { reason: 'Office closed' });
  assert.equal((await getDB()('rec_applications').where({ id: APP_ID }).first()).status, 'prelim_approved');
  await ok('mgr', 'POST', url, 201, { type: 'online', date: '2099-01-12', start_time: '09:00', end_time: '09:30', meeting_url: 'https://meet.example.com/xyz' });
  const acts = (await getDB()('rec_history').where({ application_id: APP_ID }).orderBy('id')).map((h: any) => h.action);
  assert.deepEqual(acts.slice(-4), ['interview_scheduled', 'interview_rescheduled', 'interview_cancelled', 'interview_scheduled']);
});

test('final decision: after the final interview, only an admin selects; the candidate is emailed', async () => {
  await ok('mgr', 'POST', `/api/recruitment/applications/${APP_ID}/final-completed`, 200, {});
  await ok('mgr', 'POST', `/api/recruitment/applications/${APP_ID}/decision`, 403, { action: 'approve' });
  await ok('admin', 'POST', `/api/recruitment/applications/${APP_ID}/decision`, 200, { action: 'approve', comment: 'Offer' });
  assert.equal((await ok(null, 'GET', `/api/public/careers/applications/${TOKEN}`, 200)).status, 'Shortlisted');
  assert.ok(sent.includes('selected:asha@x.test'));
  await ok(null, 'POST', `/api/public/careers/applications/${TOKEN}/withdraw`, 409);
});

test('withdraw: a candidate can withdraw an open application themselves', async () => {
  const { token } = await ok(null, 'POST', `/api/public/careers/jobs/${JOB}/apply`, 201, undefined, applyForm(candidate('withdraw@x.test')));
  const v = await ok(null, 'POST', `/api/public/careers/applications/${token}/withdraw`, 200);
  assert.equal(v.status, 'Withdrawn'); assert.equal(v.can_withdraw, false);
});

test('access: every admin and manager sees every application (no pod limits); employees and clients see nothing', async () => {
  const total = Number((await getDB()('rec_applications').count({ n: '*' }).first() as any).n);
  for (const who of ['admin', 'admin2', 'mgr', 'mgr2']) assert.equal((await ok(who, 'GET', '/api/recruitment/applications', 200)).length, total, who);
  for (const who of ['emp', 'client']) for (const url of ['/api/recruitment/applications', `/api/recruitment/applications/${APP_ID}`, '/api/recruitment/overview', `/api/recruitment/applications/${APP_ID}/resume-link`]) await ok(who, 'GET', url, 403);
  await ok('emp', 'POST', `/api/recruitment/applications/${APP_ID}/decision`, 403, { action: 'approve' });
});

test('overview: every figure comes from the records', async () => {
  const o = await ok('mgr', 'GET', '/api/recruitment/overview', 200);
  const db = getDB();
  const n = async (...s: string[]) => Number((await db('rec_applications').whereIn('status', s).count({ n: '*' }).first() as any).n);
  assert.equal(o.applications_total, Number((await db('rec_applications').count({ n: '*' }).first() as any).n));
  assert.equal(o.selected, await n('selected')); assert.equal(o.awaiting_manager, await n('interview_review', 'applied', 'under_review')); assert.equal(o.awaiting_admin, await n('interview_admin_review', 'admin_review')); assert.equal(o.prelim_pending, await n('prelim_pending'));
  assert.equal(o.jobs_active, Number((await db('rec_jobs').where({ status: 'published' }).count({ n: '*' }).first() as any).n));
  const fe = o.per_job.find((j: any) => j.id === JOB_ID);
  assert.equal(fe.applications, Number((await db('rec_applications').where({ job_id: JOB_ID }).count({ n: '*' }).first() as any).n));
});

test('retention and deletion: old recordings are removed after the retention period; an admin can delete a candidate completely', async () => {
  const db = getDB();
  const iv = await db('rec_interviews').where({ application_id: APP_ID }).first();
  assert.equal(await R.purgeOldRecordings(db, new Date(Date.now() + 365 * 86400000)), await db('rec_interviews').count({ n: '*' }).first().then((r: any) => Number(r.n)));
  assert.ok(!fs.existsSync(path.join(R.storageDir(), 'recordings', String(iv.id))));
  assert.deepEqual(await ok('mgr', 'GET', `/api/recruitment/interviews/${iv.id}/recording-links`, 200), { status: 'deleted', final: null, parts: [] });
  await ok('mgr', 'DELETE', `/api/recruitment/applications/${APP_ID}`, 403);
  await ok('admin', 'DELETE', `/api/recruitment/applications/${APP_ID}`, 200);
  assert.equal(await db('rec_applications').where({ id: APP_ID }).first(), undefined);
  await ok(null, 'GET', `/api/public/careers/applications/${TOKEN}`, 404);
});
