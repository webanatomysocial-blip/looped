// Recruitment: job openings, public applications, the approval workflow, the recorded preliminary interview,
// evaluations and final interview scheduling. Candidates are not Loop users: they reach their own application only
// through secret links (stored hashed). Admins and managers see everything; who may approve what is decided in one
// place (FLOW / decide()).
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Knex } from 'knex';
import { createNotification } from '../db';
import { ServiceError } from './access';
import { sniffVideo } from './mp4Timing';

// ── Storage: outside the public /uploads folder. In Docker, mount this folder from the server (see RECRUITMENT.md).
export const storageDir = () => process.env.RECRUITMENT_STORAGE_DIR || path.join(__dirname, '../../private/recruitment');
const ensureDir = (d: string) => { fs.mkdirSync(d, { recursive: true }); return d; };
export const resumeDir = () => ensureDir(path.join(storageDir(), 'resumes'));
export const recordingDir = (interviewId: number) => ensureDir(path.join(storageDir(), 'recordings', String(interviewId)));

export const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export const newToken = () => crypto.randomBytes(32).toString('base64url');
const newRef = () => `LP-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;

// ── Schema ──
export async function ensureRecruitmentSchema(db: Knex): Promise<void> {
  const make = async (name: string, build: (t: Knex.CreateTableBuilder) => void) => { if (!(await db.schema.hasTable(name))) await db.schema.createTable(name, build); };
  await make('rec_jobs', (t) => {
    t.increments('id').primary();
    t.string('public_id', 36).notNullable().unique();          // used in public URLs instead of the number
    t.string('title', 200).notNullable();
    t.integer('category_id').unsigned().nullable().references('id').inTable('employee_categories').onDelete('SET NULL');   // unused: roles are role_id (rec_roles)
    t.text('description'); t.text('responsibilities'); t.text('qualifications'); t.text('skills');
    t.string('experience', 100); t.string('employment_type', 40); t.string('location', 200);
    t.integer('vacancies').notNullable().defaultTo(1);
    t.date('deadline').nullable();
    t.string('status', 12).notNullable().defaultTo('draft');  // draft | published | closed
    t.integer('created_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at').defaultTo(db.fn.now()); t.timestamp('updated_at').defaultTo(db.fn.now());
    t.index(['status']);
  });
  await make('rec_applications', (t) => {
    t.increments('id').primary();
    t.string('ref', 20).notNullable().unique();
    t.string('access_hash', 64).notNullable().unique();       // tracking link, hashed
    t.integer('job_id').unsigned().notNullable().references('id').inTable('rec_jobs').onDelete('CASCADE');
    t.string('name', 120).notNullable(); t.string('email', 190).notNullable(); t.string('phone', 30).notNullable();
    t.string('location', 120); t.string('education', 200); t.decimal('experience_years', 4, 1).defaultTo(0);
    t.string('company', 160); t.text('skills');
    t.string('resume_file', 80).notNullable(); t.string('resume_name', 200).notNullable(); t.string('resume_mime', 120);
    t.string('status', 30).notNullable().defaultTo('applied');
    t.string('interview_hash', 64).nullable().unique(); t.timestamp('interview_expires_at').nullable();
    t.timestamp('created_at').defaultTo(db.fn.now()); t.timestamp('updated_at').defaultTo(db.fn.now());
    t.index(['job_id', 'email'], 'rec_applications_job_email_idx');   // one OPEN application per job per email: checked in submitApplication
    t.index(['status']);
  });
  await make('rec_history', (t) => {
    t.increments('id').primary();
    t.integer('application_id').unsigned().notNullable().references('id').inTable('rec_applications').onDelete('CASCADE');
    t.string('action', 40).notNullable(); t.string('from_status', 30); t.string('to_status', 30);
    t.integer('actor_id').unsigned().nullable(); t.string('actor_name', 120); t.string('actor_role', 20);
    t.boolean('override').notNullable().defaultTo(false);
    t.text('comment');
    t.timestamp('created_at').defaultTo(db.fn.now());
    t.index(['application_id']);
  });
  await make('rec_questions', (t) => {
    t.increments('id').primary();
    t.string('category', 60).notNullable(); t.text('text').notNullable();
    t.string('difficulty', 10).nullable();                    // easy | medium | hard (optional)
    t.boolean('active').notNullable().defaultTo(true);
    t.integer('created_by').unsigned().nullable();
    t.timestamp('created_at').defaultTo(db.fn.now()); t.timestamp('updated_at').defaultTo(db.fn.now());
  });
  await make('rec_settings', (t) => { t.string('name', 60).primary(); t.string('value', 500); });
  await make('rec_interviews', (t) => {
    t.increments('id').primary();
    t.integer('application_id').unsigned().notNullable().unique().references('id').inTable('rec_applications').onDelete('CASCADE');
    t.string('status', 15).notNullable().defaultTo('in_progress');   // in_progress | submitted
    t.timestamp('consent_at').notNullable(); t.string('consent_version', 20).notNullable();
    t.integer('seconds_per_question').notNullable();
    t.integer('current_position').notNullable().defaultTo(0);
    t.timestamp('started_at').notNullable(); t.timestamp('submitted_at').nullable();
    t.text('segments');                                       // JSON [{ n, chunks, bytes, done, mime }]
    t.bigInteger('recording_bytes').notNullable().defaultTo(0);
    t.timestamp('recording_deleted_at').nullable();
  });
  await make('rec_interview_questions', (t) => {
    t.increments('id').primary();
    t.integer('interview_id').unsigned().notNullable().references('id').inTable('rec_interviews').onDelete('CASCADE');
    t.integer('position').notNullable(); t.integer('question_id').unsigned().nullable();
    t.string('category', 60); t.text('text').notNullable();   // a copy: later edits never change a past interview
    t.timestamp('shown_at').nullable(); t.timestamp('answered_at').nullable();
    t.unique(['interview_id', 'position']);
  });
  await make('rec_events', (t) => {
    t.increments('id').primary();
    t.integer('interview_id').unsigned().notNullable().references('id').inTable('rec_interviews').onDelete('CASCADE');
    t.string('type', 40).notNullable(); t.string('detail', 300); t.integer('position').nullable();
    t.timestamp('at').notNullable();
    t.index(['interview_id']);
  });
  await make('rec_evaluations', (t) => {
    t.increments('id').primary();
    t.integer('application_id').unsigned().notNullable().references('id').inTable('rec_applications').onDelete('CASCADE');
    t.integer('reviewer_id').unsigned().nullable(); t.string('reviewer_name', 120);
    t.integer('overall'); t.integer('communication'); t.integer('confidence');   // 1–5
    t.text('observations'); t.text('comments');
    t.timestamp('created_at').defaultTo(db.fn.now());
  });
  await make('rec_schedules', (t) => {
    t.increments('id').primary();
    t.integer('application_id').unsigned().notNullable().references('id').inTable('rec_applications').onDelete('CASCADE');
    t.string('type', 10).notNullable();                       // walkin | online
    t.date('date').notNullable(); t.string('start_time', 5).notNullable(); t.string('end_time', 5).notNullable();
    t.string('location', 200); t.text('address'); t.string('meeting_url', 500);
    t.text('interviewers');                                   // JSON [{ id, name }]
    t.text('instructions');
    t.string('status', 12).notNullable().defaultTo('scheduled');   // scheduled | cancelled | completed
    t.integer('created_by').unsigned().nullable();
    t.timestamp('created_at').defaultTo(db.fn.now()); t.timestamp('updated_at').defaultTo(db.fn.now());
  });
  for (const [col, add] of [
    ['processing_status', (t: Knex.AlterTableBuilder) => t.string('processing_status', 15).nullable()],   // processing | verified | incomplete | failed
    ['verification', (t: Knex.AlterTableBuilder) => t.text('verification').nullable()],                  // JSON: manifest, measurements, problems
    ['verified_at', (t: Knex.AlterTableBuilder) => t.timestamp('verified_at').nullable()],
    ['final_file', (t: Knex.AlterTableBuilder) => t.string('final_file', 200).nullable()],
  ] as const) if (!(await db.schema.hasColumn('rec_interviews', col))) await db.schema.alterTable('rec_interviews', add);
  // WhatsApp number the candidate confirmed after the video interview (for the welcome message and updates)
  for (const [col, add] of [
    ['whatsapp', (t: Knex.AlterTableBuilder) => t.string('whatsapp', 20).nullable()],
    ['whatsapp_confirmed_at', (t: Knex.AlterTableBuilder) => t.timestamp('whatsapp_confirmed_at').nullable()],
  ] as const) if (!(await db.schema.hasColumn('rec_applications', col))) await db.schema.alterTable('rec_applications', add);
  // Careers roles: recruitment's own list, with no link to Loop's employee departments
  await make('rec_roles', (t) => { t.increments('id').primary(); t.string('name', 100).notNullable(); t.timestamp('created_at').defaultTo(db.fn.now()); });
  if (!(await db.schema.hasColumn('rec_jobs', 'role_id'))) await db.schema.alterTable('rec_jobs', (t) => t.integer('role_id').nullable());
  // The order questions are asked in (set in the Question Bank), and per role whether they are shuffled per candidate
  // Monitoring: when the server received each event and whether the page or the server recorded it; the interview's
  // owning page (one tab or device at a time) and its last heartbeat
  for (const [col, add] of [
    ['received_at', (t: Knex.AlterTableBuilder) => t.timestamp('received_at').nullable()],
    ['source', (t: Knex.AlterTableBuilder) => t.string('source', 10).nullable()],
  ] as const) if (!(await db.schema.hasColumn('rec_events', col))) await db.schema.alterTable('rec_events', add);
  for (const [col, add] of [
    ['session_id', (t: Knex.AlterTableBuilder) => t.string('session_id', 40).nullable()],
    ['last_seen_at', (t: Knex.AlterTableBuilder) => t.timestamp('last_seen_at').nullable()],
  ] as const) if (!(await db.schema.hasColumn('rec_interviews', col))) await db.schema.alterTable('rec_interviews', add);
  // Interview integrity: warnings, an automatic or manual pause, and the review outcome. One incident per real
  // violation (dedupe stops a resent event from counting twice).
  for (const [col, add] of [
    ['warnings', (t: Knex.AlterTableBuilder) => t.integer('warnings').notNullable().defaultTo(0)],
    ['integrity_status', (t: Knex.AlterTableBuilder) => t.string('integrity_status', 30).nullable()],   // monitoring | integrity_review_required | cleared | technical | suspicious | insufficient | confirmed
    ['paused_at', (t: Knex.AlterTableBuilder) => t.timestamp('paused_at').nullable()],
    ['paused_by', (t: Knex.AlterTableBuilder) => t.string('paused_by', 20).nullable()],                 // auto | admin
  ] as const) if (!(await db.schema.hasColumn('rec_interviews', col))) await db.schema.alterTable('rec_interviews', add);
  await make('rec_incidents', (t) => {
    t.increments('id').primary();
    t.integer('interview_id').unsigned().notNullable().references('id').inTable('rec_interviews').onDelete('CASCADE');
    t.string('kind', 30).notNullable(); t.boolean('serious').notNullable().defaultTo(false);
    t.string('dedupe', 80).notNullable(); t.string('detail', 300); t.integer('position').nullable();
    t.timestamp('at').notNullable(); t.string('status', 20).notNullable().defaultTo('open');   // open | suspicious | confirmed | dismissed | technical | insufficient
    t.unique(['interview_id', 'dedupe']);
  });
  if (!(await db.schema.hasColumn('rec_questions', 'sort_order'))) await db.schema.alterTable('rec_questions', (t) => t.integer('sort_order').nullable());
  if (!(await db.schema.hasColumn('rec_roles', 'shuffle'))) await db.schema.alterTable('rec_roles', (t) => t.boolean('shuffle').notNullable().defaultTo(false));
  // A question's role (rec_roles.id; the column keeps its first name); none = asked in every role's interview
  if (!(await db.schema.hasColumn('rec_questions', 'department_id'))) await db.schema.alterTable('rec_questions', (t) => t.integer('department_id').nullable());
  await separateRoles(db);
  // An admin may let a rejected candidate apply again for the same role before the three months are up
  for (const [col, add] of [
    ['reapply_override_at', (t: Knex.AlterTableBuilder) => t.timestamp('reapply_override_at').nullable()],
    ['reapply_override_by', (t: Knex.AlterTableBuilder) => t.integer('reapply_override_by').nullable()],
    ['reapply_override_reason', (t: Knex.AlterTableBuilder) => t.text('reapply_override_reason').nullable()],
  ] as const) if (!(await db.schema.hasColumn('rec_applications', col))) await db.schema.alterTable('rec_applications', add);
  // One application per job per email was a unique index, which also blocked reapplying after the three months. It is
  // now "one OPEN application per job per email", checked when applying. The job_id index comes first: MySQL needs an
  // index for the job foreign key, and the unique index was serving as it.
  if (await db.schema.hasColumn('rec_applications', 'job_id')) {
    await db.schema.alterTable('rec_applications', (t) => t.index(['job_id', 'email'], 'rec_applications_job_email_idx')).catch(() => undefined);
    await db.schema.alterTable('rec_applications', (t) => t.dropUnique(['job_id', 'email'])).catch(() => undefined);
  }
  if (!(await db('rec_questions').first('id'))) await db('rec_questions').insert(STARTER_QUESTIONS.map(([category, text]) => ({ category, text, active: true })));
}

// Once: openings and questions that pointed at Loop's departments move to careers roles of the same name, and the
// openings' link to Loop's departments is cleared. Loop's department list itself is never changed.
async function separateRoles(db: Knex) {
  if (await db('rec_settings').where({ name: 'roles_separated' }).first('name')) return;
  await db.transaction(async (trx) => {
    const roleFor = new Map<number, number>();
    const role = async (catId: number): Promise<number | null> => {
      if (roleFor.has(catId)) return roleFor.get(catId)!;
      const cat = await trx('employee_categories').where({ id: catId }).first('name');
      if (!cat?.name) return null;
      let r = await trx('rec_roles').whereRaw('LOWER(name) = ?', [String(cat.name).toLowerCase()]).first('id');
      if (!r) { const [id] = await trx('rec_roles').insert({ name: cat.name }); r = { id }; }
      roleFor.set(catId, Number(r.id)); return Number(r.id);
    };
    // Read everything first, then write by row id: old and new ids are both small numbers and must not be confused
    const jobs = await trx('rec_jobs').whereNotNull('category_id').select('id', 'category_id');
    const qs = await trx('rec_questions').whereNotNull('department_id').select('id', 'department_id');
    for (const j of jobs) await trx('rec_jobs').where({ id: j.id }).update({ role_id: await role(Number(j.category_id)), category_id: null });
    for (const q of qs) await trx('rec_questions').where({ id: q.id }).update({ department_id: await role(Number(q.department_id)) });
    await trx('rec_settings').insert({ name: 'roles_separated', value: String(Date.now()) });
  });
}

export const QUESTION_CATEGORIES = ['Self Introduction', 'Hobbies and Interests', 'Educational Background', 'Previous Experience', 'Achievements',
  'Strengths and Weaknesses', 'Challenges and Problem Solving', 'Motivation to Join', 'Career Goals', 'General Personality'];
const STARTER_QUESTIONS: [string, string][] = [
  ['Self Introduction', 'Please introduce yourself and tell us a little about your background.'],
  ['Hobbies and Interests', 'What do you enjoy doing outside of work, and why?'],
  ['Educational Background', 'Tell us about your education and what you learned that you still use.'],
  ['Previous Experience', 'Describe your most recent role and your main responsibilities.'],
  ['Achievements', 'What is an achievement you are proud of, and how did you get there?'],
  ['Strengths and Weaknesses', 'What is your greatest strength, and one area you are working to improve?'],
  ['Challenges and Problem Solving', 'Tell us about a difficult problem you faced and how you solved it.'],
  ['Motivation to Join', 'Why do you want to join our team?'],
  ['Career Goals', 'Where do you see your career in the next three years?'],
  ['General Personality', 'How do you handle feedback that you disagree with?'],
];

// ── Settings ──
export const DEFAULT_SETTINGS = { question_count: 5, seconds_per_question: 120, interview_link_days: 7, recording_retention_days: 180, consent_version: 'v1',
  // Interview rules: warnings before the interview pauses; how long away from the tab counts; fullscreen required (0/1);
  // pause at once on a serious incident (0/1)
  max_warnings: 3, warning_away_seconds: 10, fullscreen_required: 0, pause_on_serious: 1 };
export type Settings = typeof DEFAULT_SETTINGS;
export async function getSettings(db: Knex): Promise<Settings> {
  const rows = await db('rec_settings').select('name', 'value');
  const out: any = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.name in out) out[r.name] = typeof (DEFAULT_SETTINGS as any)[r.name] === 'number' ? Number(r.value) : String(r.value);
  return out;
}
export async function saveSettings(db: Knex, patch: Partial<Settings>): Promise<Settings> {
  const limits: Record<string, [number, number]> = { question_count: [1, 30], seconds_per_question: [20, 900], interview_link_days: [1, 60], recording_retention_days: [7, 3650], max_warnings: [1, 10], warning_away_seconds: [3, 600], fullscreen_required: [0, 1], pause_on_serious: [0, 1] };
  for (const [k, [lo, hi]] of Object.entries(limits)) {
    if ((patch as any)[k] === undefined) continue;
    const n = Number((patch as any)[k]);
    if (!Number.isInteger(n) || n < lo || n > hi) throw new ServiceError(400, `${k.replace(/_/g, ' ')} must be between ${lo} and ${hi}`);
    await db('rec_settings').where({ name: k }).del();
    await db('rec_settings').insert({ name: k, value: String(n) });
  }
  return getSettings(db);
}

/** Today's date in India (YYYY-MM-DD): job deadlines close at the end of that day in India, not in UTC. */
export const todayIST = (now = new Date()) => now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

// ── Statuses ──
// What staff see, and the simpler wording a candidate sees (internal review steps are not shown to them)
// The flow: apply → video interview straight away → manager review → admin decision → final interview (one-on-one,
// walk-in or online) → shortlisted or rejected. "applied/under_review/admin_review" remain only for older applications.
export const STATUS_LABEL: Record<string, string> = {
  applied: 'Applied', under_review: 'Under Review', admin_review: 'Manager Approved · Admin Review Pending',
  prelim_pending: 'Video Interview Pending', interview_review: 'Video Interview Done · Manager Review',
  interview_admin_review: 'Manager Approved · Admin Review Pending', prelim_approved: 'Approved · Final Interview to Schedule',
  final_scheduled: 'Final Interview Scheduled', final_completed: 'Final Interview Done · Decision Pending',
  selected: 'Shortlisted', rejected: 'Rejected', withdrawn: 'Withdrawn',
};
export const CANDIDATE_LABEL: Record<string, string> = {
  applied: 'Applied', under_review: 'Under Review', admin_review: 'Under Review',
  prelim_pending: 'Video Interview Pending', interview_review: 'Video Interview Completed · Under Review', interview_admin_review: 'Video Interview Completed · Under Review',
  prelim_approved: 'Moved to Final Interview', final_scheduled: 'Final Interview Scheduled', final_completed: 'Final Interview Completed',
  selected: 'Shortlisted', rejected: 'Not Selected', withdrawn: 'Withdrawn',
};
const CLOSED = ['selected', 'rejected', 'withdrawn'];

// ── The approval workflow, in one place ──
// For each status: where a manager's approval leads (their review step), and where an admin's leads (the decision).
// A manager can only approve or reject at a manager step; an admin can decide at any step (recorded as an override
// when it skips the manager's step).
const FLOW: Record<string, { manager?: string; admin: string }> = {
  applied: { manager: 'admin_review', admin: 'prelim_pending' },
  under_review: { manager: 'admin_review', admin: 'prelim_pending' },
  admin_review: { admin: 'prelim_pending' },
  interview_review: { manager: 'interview_admin_review', admin: 'prelim_approved' },
  interview_admin_review: { admin: 'prelim_approved' },
  final_completed: { admin: 'selected' },
};
export type Actor = { id: number; role: string; name: string };
export type Decision = 'approve' | 'reject' | 'reopen';

// Stages with no approval step that a candidate can still be turned down at (they used to be stuck there for good).
// Only an admin decides here: no manager step exists at these stages.
const REJECT_ONLY = ['prelim_pending', 'prelim_approved', 'final_scheduled'];
export function decide(status: string, role: string, action: Decision, beforeRejected?: string | null): { to: string; override: boolean } {
  const isAdmin = role === 'admin';
  if (role !== 'admin' && role !== 'manager') throw new ServiceError(403, 'Not authorised');
  if (REJECT_ONLY.includes(status) && action !== 'reopen') {
    if (action !== 'reject') throw new ServiceError(409, `No decision can be made while the application is "${STATUS_LABEL[status] ?? status}"`);
    if (!isAdmin) throw new ServiceError(403, 'Only an admin can reject at this stage');
    return { to: 'rejected', override: false };
  }
  if (action === 'reopen') {
    if (!isAdmin) throw new ServiceError(403, 'Only an admin can reopen an application');
    if (status !== 'rejected' || !beforeRejected) throw new ServiceError(409, 'Only a rejected application can be reopened');
    return { to: beforeRejected, override: true };
  }
  const step = FLOW[status];
  if (!step) throw new ServiceError(409, `No decision can be made while the application is "${STATUS_LABEL[status] ?? status}"`);
  if (!isAdmin && !step.manager) throw new ServiceError(403, 'This step is waiting for an admin decision');
  const managerStep = !!step.manager;
  if (action === 'reject') return { to: 'rejected', override: isAdmin && managerStep };
  return isAdmin ? { to: step.admin, override: managerStep } : { to: step.manager!, override: false };
}

// ── Applications ──
async function log(db: Knex, a: { application_id: number; action: string; from?: string | null; to?: string | null; actor?: Actor | null; override?: boolean; comment?: string | null }) {
  await db('rec_history').insert({
    application_id: a.application_id, action: a.action, from_status: a.from ?? null, to_status: a.to ?? null,
    actor_id: a.actor?.id ?? null, actor_name: a.actor?.name ?? (a.actor === null ? 'Candidate' : null), actor_role: a.actor?.role ?? 'candidate',
    override: !!a.override, comment: a.comment ? String(a.comment).slice(0, 2000) : null,
  });
}
const staffIds = async (db: Knex) => (await db('users').whereIn('role', ['admin', 'manager']).select('id', 'role'));
const notifyStaff = async (db: Knex, message: string, roles: string[] = ['admin', 'manager']) => {
  for (const u of await staffIds(db)) if (roles.includes(u.role)) await createNotification(u.id, message, 'recruitment');
};

export const clip = (v: unknown, n: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, n);
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;
const PHONE = /^\+?[0-9 ()-]{7,20}$/;

export async function submitApplication(db: Knex, jobPublicId: string, body: any, resume: { file: string; name: string; mime: string } | null, mail: Mailer = defaultMailer): Promise<{ ref: string; token: string; interview_token: string }> {
  const job = await db('rec_jobs').where({ public_id: String(jobPublicId) }).first();
  if (!job || job.status !== 'published' || (job.deadline && String(job.deadline).slice(0, 10) < todayIST())) throw new ServiceError(404, 'This job is not open for applications');
  const name = clip(body.name, 120), email = clip(body.email, 190).toLowerCase(), phone = clip(body.phone, 30);
  if (!name || !EMAIL.test(email) || !PHONE.test(phone)) throw new ServiceError(400, 'Please enter your full name, a valid email and a valid phone number');
  if (!resume) throw new ServiceError(400, 'Please attach your resume (PDF, DOC or DOCX)');
  const years = Number(body.experience_years ?? 0);
  if (!Number.isFinite(years) || years < 0 || years > 60) throw new ServiceError(400, 'Please enter your total experience in years');
  return withApplyLock(`${email}|${phoneKey(phone)}`, async () => {
  // By email only: a shared phone is not proof of the same person (it is shown to reviewers as a possible conflict)
  if (await db('rec_applications').whereIn('job_id', await sameRoleJobIds(db, job)).whereRaw('LOWER(email) = ?', [email]).whereNotIn('status', CLOSED).first('id')) throw new ServiceError(409, 'You already have an open application for this role. Use your tracking link to check its status.');
  // The video interview starts right after applying: the role must have questions
  if (!(await roleQuestions(db, job.role_id)).length) throw new ServiceError(503, 'Applications for this role open shortly. Please try again later.');
  const until = await reapplyBlockedUntil(db, job, email, phone);
  if (until) throw new ServiceError(409, `You applied for this role recently and were not selected. You can apply for it again from ${until.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })}. You are welcome to apply for other roles now.`);
  const token = newToken();
  const ref = newRef();
  const interviewToken = newToken();
  const s = await getSettings(db);
  const expires = new Date(Date.now() + s.interview_link_days * 86_400_000);
  const [id] = await db('rec_applications').insert({
    ref, access_hash: sha(token), job_id: job.id, name, email, phone,
    location: clip(body.location, 120), education: clip(body.education, 200), experience_years: years,
    company: clip(body.company, 160), skills: clip(body.skills, 2000),
    resume_file: resume.file, resume_name: clip(resume.name, 200), resume_mime: resume.mime,
    status: 'prelim_pending', interview_hash: sha(interviewToken), interview_expires_at: expires,
  });
  await log(db, { application_id: Number(id), action: 'applied', to: 'prelim_pending', actor: null });
  // The interview link also goes by email (when email is on), in case they close the page
  await mail.interviewInvite({ name, email, ref }, job.title, interviewToken, expires);
  await notifyStaff(db, `New application from ${name} for "${job.title}" — video interview pending`);
  return { ref, token, interview_token: interviewToken };
  });
}

// ── Reapplying after a rejection: not for the same role for three calendar months ──
// The same person: same email (any case) or same phone number (digits only, last 10). The same role: every opening
// with the same careers role, or (for openings without one) the same title, so a reposted or renamed opening counts.
export const phoneKey = (p: string) => String(p ?? '').replace(/\D/g, '').slice(-10);
/** Calendar months, not days: 30 Nov + 3 months is 28 (or 29) Feb, at the same time of day. */
export function addCalendarMonths(d: Date, months: number): Date {
  const out = new Date(d.getTime());
  const day = out.getUTCDate();
  out.setUTCDate(1); out.setUTCMonth(out.getUTCMonth() + months);
  const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, last));
  return out;
}
export async function sameRoleJobIds(db: Knex, job: { id: number; title: string; role_id?: number | null }): Promise<number[]> {
  const q = db('rec_jobs').whereRaw('LOWER(TRIM(title)) = ?', [String(job.title).trim().toLowerCase()]);
  if (job.role_id) q.orWhere('role_id', job.role_id);
  return [...new Set([Number(job.id), ...(await q.pluck('id')).map(Number)])];
}
export async function reapplyBlockedUntil(db: Knex, job: { id: number; title: string; role_id?: number | null }, email: string, phone: string, now = new Date()): Promise<Date | null> {
  email = String(email).trim().toLowerCase();
  const rejected = await db('rec_applications').whereIn('job_id', await sameRoleJobIds(db, job)).where({ status: 'rejected' }).whereNull('reapply_override_at').select('id', 'email', 'phone');
  const pk = phoneKey(phone);
  let latest: Date | null = null;
  for (const r of rejected) {
    if (String(r.email).toLowerCase() !== email && !(pk.length >= 7 && phoneKey(r.phone) === pk)) continue;
    // From the actual rejection (the latest move to "rejected"; a reopened-then-rejected application counts from the last)
    const h = await db('rec_history').where({ application_id: r.id, to_status: 'rejected' }).orderBy('id', 'desc').first('created_at');
    const at = h?.created_at ? toDate(h.created_at) : null;
    if (!at) continue;
    const until = addCalendarMonths(at, 3);
    if (until > now && (!latest || until > latest)) latest = until;
  }
  return latest;
}
const toDate = (v: any) => (v instanceof Date ? v : /^\d+$/.test(String(v)) ? new Date(Number(v)) : new Date(String(v).includes('T') || String(v).endsWith('Z') ? v : String(v).replace(' ', 'T') + 'Z'));
// One application at a time per person, so two simultaneous submissions can't both pass the checks above.
// shortcut: in-process lock (Loop runs as one process); a database lock is needed if it ever runs as several.
const applyLocks = new Map<string, Promise<unknown>>();
async function withApplyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  while (applyLocks.has(key)) await applyLocks.get(key)!.catch(() => undefined);
  const p = fn(); applyLocks.set(key, p);
  try { return await p; } finally { applyLocks.delete(key); }
}

/** Admin only: lets a rejected candidate apply for the same role again now. Recorded with the reason. */
export async function allowReapply(db: Knex, actor: Actor, appId: number, reason: string) {
  if (actor.role !== 'admin') throw new ServiceError(403, 'Only an admin can allow an early reapplication');
  if (!String(reason ?? '').trim()) throw new ServiceError(400, 'Please give a reason');
  const a = await db('rec_applications').where({ id: appId }).first();
  if (!a) throw new ServiceError(404, 'Application not found');
  if (a.status !== 'rejected') throw new ServiceError(409, 'Only a rejected application can be released for reapplication');
  await db('rec_applications').where({ id: appId }).update({ reapply_override_at: new Date(), reapply_override_by: actor.id, reapply_override_reason: clip(reason, 1000) });
  await log(db, { application_id: appId, action: 'reapply_allowed', from: 'rejected', to: 'rejected', actor, override: true, comment: reason });
}

/** Admin only: a fresh interview link (the old one stops working) or a later expiry for the current one. */
export async function renewInterviewLink(db: Knex, actor: Actor, appId: number, mode: 'new' | 'extend', mail: Mailer = defaultMailer) {
  if (actor.role !== 'admin') throw new ServiceError(403, 'Only an admin can change interview links');
  const a = await db('rec_applications').where({ id: appId }).first();
  if (!a) throw new ServiceError(404, 'Application not found');
  if (a.status !== 'prelim_pending') throw new ServiceError(409, 'The interview link can only be changed while the preliminary interview is pending');
  const iv = await db('rec_interviews').where({ application_id: appId }).first('status');
  if (iv?.status === 'submitted') throw new ServiceError(409, 'This interview has already been submitted');
  const s = await getSettings(db);
  const expires = new Date(Date.now() + s.interview_link_days * 86_400_000);
  let token: string | null = null;
  if (mode === 'new' || !a.interview_hash) { token = newToken(); await db('rec_applications').where({ id: appId }).update({ interview_hash: sha(token), interview_expires_at: expires, updated_at: new Date() }); }
  else await db('rec_applications').where({ id: appId }).update({ interview_expires_at: expires, updated_at: new Date() });
  // An interview already started keeps its questions and timer: only the way in changes
  await log(db, { application_id: appId, action: token ? 'interview_link_renewed' : 'interview_link_extended', from: a.status, to: a.status, actor, comment: `valid until ${expires.toISOString().slice(0, 10)}` });
  const job = await db('rec_jobs').where({ id: a.job_id }).first('title');
  if (token) await mail.interviewInvite(a, job?.title ?? '', token, expires);
  return { expires_at: expires, link: token ? `${site()}/careers/interview/${token}` : null };
}

export async function byAccessToken(db: Knex, token: string) {
  const a = token && token.length >= 20 ? await db('rec_applications').where({ access_hash: sha(String(token)) }).first() : null;
  if (!a) throw new ServiceError(404, 'Application not found. Please use the link you received when you applied.');
  return a;
}

// What a candidate may see: their own details, a simple status, the interview link when it is open, and the
// schedule. Never reviewer names, comments, scores, the audit trail or the recording.
export async function candidateView(db: Knex, a: any) {
  const job = await db('rec_jobs').where({ id: a.job_id }).first('title', 'location', 'employment_type');
  const schedule = ['final_scheduled', 'final_completed'].includes(a.status)
    ? await db('rec_schedules').where({ application_id: a.id, status: 'scheduled' }).orderBy('id', 'desc').first('type', 'date', 'start_time', 'end_time', 'location', 'address', 'meeting_url', 'instructions')
    : null;
  const interviewOpen = a.status === 'prelim_pending' && a.interview_expires_at && new Date(a.interview_expires_at).getTime() > Date.now();
  return {
    ref: a.ref, name: a.name, job: job?.title ?? '', job_location: job?.location ?? '', applied_at: a.created_at,
    status: CANDIDATE_LABEL[a.status] ?? a.status, status_key: ['admin_review', 'under_review'].includes(a.status) ? 'under_review' : ['interview_review', 'interview_admin_review'].includes(a.status) ? 'interview_review' : a.status,
    can_withdraw: !CLOSED.includes(a.status),
    interview: a.status === 'prelim_pending' ? { open: !!interviewOpen, expires_at: a.interview_expires_at } : null,
    schedule: schedule ? { ...schedule, date: String(schedule.date).slice(0, 10) } : null,
  };
}

export async function withdraw(db: Knex, a: any) {
  if (CLOSED.includes(a.status)) throw new ServiceError(409, 'This application is already closed');
  // Guarded by the status read above: a rejection or decision made at the same moment is never overwritten
  const n = await db('rec_applications').where({ id: a.id, status: a.status }).update({ status: 'withdrawn', interview_hash: null, updated_at: new Date() });
  if (!n) throw new ServiceError(409, 'This application was just updated. Please refresh the page.');
  // An interview under way stops: no more questions or uploads (the link above no longer works either)
  const live = await db('rec_interviews').where({ application_id: a.id }).whereIn('status', ['in_progress', 'paused']).first('id');
  if (live) {
    await db('rec_interviews').where({ id: live.id }).whereIn('status', ['in_progress', 'paused']).update({ status: 'withdrawn' });
    await serverEvent(db, live.id, 'interview_withdrawn', 'the candidate withdrew during the interview');
  }
  await log(db, { application_id: a.id, action: 'withdrawn', from: a.status, to: 'withdrawn', actor: null });
}

// Approve / reject / reopen, by an admin or a manager. The rules are in decide(); this applies them.
export async function act(db: Knex, actor: Actor, appId: number, action: Decision, comment?: string, mail: Mailer = defaultMailer): Promise<any> {
  const a = await db('rec_applications').where({ id: appId }).first();
  if (!a) throw new ServiceError(404, 'Application not found');
  if (action === 'reject' && !String(comment ?? '').trim()) throw new ServiceError(400, 'Please add a reason for rejecting');
  const before = action === 'reopen'
    ? (await db('rec_history').where({ application_id: a.id, to_status: 'rejected' }).orderBy('id', 'desc').first('from_status'))?.from_status ?? null
    : null;
  const { to, override } = decide(a.status, actor.role, action, before);
  const patch: any = { status: to, updated_at: new Date() };
  let interviewToken: string | null = null;
  if (to === 'prelim_pending') {
    const s = await getSettings(db);
    interviewToken = newToken();
    patch.interview_hash = sha(interviewToken);
    patch.interview_expires_at = new Date(Date.now() + s.interview_link_days * 86_400_000);
  }
  if (to === 'rejected') patch.interview_hash = null;   // an open interview link stops working
  // Guarded by the current status, so two reviewers acting at once cannot both move it
  const n = await db('rec_applications').where({ id: a.id, status: a.status }).update(patch);
  if (!n) throw new ServiceError(409, 'This application was just updated by someone else. Please refresh.');
  if (to === 'rejected' && a.status === 'final_scheduled') await db('rec_schedules').where({ application_id: a.id, status: 'scheduled' }).update({ status: 'cancelled', updated_at: new Date() });
  await log(db, { application_id: a.id, action, from: a.status, to, actor, override, comment });
  const job = await db('rec_jobs').where({ id: a.job_id }).first('title');
  if (to === 'admin_review' || to === 'interview_admin_review') await notifyStaff(db, `${actor.name} approved ${a.name} (${job?.title}) — awaiting admin decision`, ['admin']);
  if (to === 'prelim_pending' && interviewToken) await mail.interviewInvite(a, job?.title ?? '', interviewToken, patch.interview_expires_at);
  if (to === 'selected') await mail.selected(a, job?.title ?? '');
  return { status: to, override };
}

// Opening an application moves it from Applied to Under Review (so the candidate sees it is being looked at)
export async function markViewed(db: Knex, actor: Actor, a: any) {
  if (a.status !== 'applied') return;
  const n = await db('rec_applications').where({ id: a.id, status: 'applied' }).update({ status: 'under_review', updated_at: new Date() });
  if (n) await log(db, { application_id: a.id, action: 'review_started', from: 'applied', to: 'under_review', actor });
}

// ── Preliminary interview ──
export async function byInterviewToken(db: Knex, token: string) {
  const a = token && token.length >= 20 ? await db('rec_applications').where({ interview_hash: sha(String(token)) }).first() : null;
  if (!a) throw new ServiceError(404, 'This interview link is not valid.');
  return a;
}
const linkOpen = (a: any) => a.status === 'prelim_pending' && a.interview_expires_at && new Date(a.interview_expires_at).getTime() > Date.now();

export const CONSENT_TEXT = 'This interview is recorded (video and audio) from the moment you start until you submit. The recording, your answers and '
  + 'interview activity (such as leaving the interview tab or exiting fullscreen) are stored securely and are seen only by our recruitment team '
  + 'for evaluating your application. They are deleted after the retention period. Activity indicators are reviewed by people and are never used '
  + 'to reject a candidate automatically.';

// The number as WhatsApp needs it: India numbers given without a country code get 91. Null when it can't be a phone number.
export function whatsappJid(input: unknown): { digits: string; jid: string } | null {
  let d = String(input ?? '').replace(/\D/g, '');
  if (d.length === 10) d = `91${d}`;
  if (d.length < 11 || d.length > 15) return null;
  return { digits: d, jid: `${d}@s.whatsapp.net` };
}

// The candidate confirms their WhatsApp number after the video interview. Then the welcome message and a NEW tracking
// link are queued for WhatsApp (the old link stops working: only its scrambled form is stored, so it can't be sent again).
export async function confirmWhatsApp(db: Knex, a: any, input: unknown, now = new Date(), mail: Mailer = defaultMailer): Promise<{ tracking_url: string; number: string }> {
  const iv = await db('rec_interviews').where({ application_id: a.id }).first('status');
  if (!iv || iv.status !== 'submitted') throw new ServiceError(409, 'Please finish the video interview first');
  const fresh = await db('rec_applications').where({ id: a.id }).first('whatsapp_confirmed_at');
  if (fresh?.whatsapp_confirmed_at) throw new ServiceError(409, 'Your WhatsApp number is already confirmed');
  const num = whatsappJid(input);
  if (!num) throw new ServiceError(400, 'Please enter a valid WhatsApp number (with country code, e.g. 919876543210)');
  if (!a.interview_hash) throw new ServiceError(409, 'This page has already been used. Please open the link from your application.');
  const token = newToken();
  const job = await db('rec_jobs').where({ id: a.job_id }).first('title');
  const link = `${site()}/careers/track/${token}`;
  // The old tracking link stops working; the new one is the only way back to the application
  await db('rec_applications').where({ id: a.id }).update({ access_hash: sha(token), whatsapp: num.digits, whatsapp_confirmed_at: now, updated_at: now });
  await log(db, { application_id: a.id, action: 'whatsapp_confirmed', actor: null, comment: 'candidate confirmed WhatsApp; new tracking link sent' });
  // The interview link is no longer needed: close it now that the number is confirmed
  await db('rec_applications').where({ id: a.id }).update({ interview_hash: null });
  const text = `Hi ${clip(a.name, 60).split(' ')[0] || 'there'}, welcome to Loooped Careers! 👋\n\nThank you for completing your video interview for ${clip(job?.title ?? 'the role', 120)} (reference ${a.ref}). Our team will review it and we will update you here and by email.\n\nYou can check your application status any time with this private link (please keep it to yourself):\n${link}`;
  // Queued like the team's other private notices (sent by the same outbox, only to a verified private chat)
  await db('whatsapp_outbox').insert({
    event_key: `rec-welcome:${a.id}`, kind: 'recruitment', task_id: 0,
    payload: JSON.stringify({ text, caption: text, mentions: [], tags: [], to: num.jid }),
    status: 'pending', attempts: 0, next_attempt_at: now, created_at: now,
  }).catch((e: any) => { if (!/unique|duplicate/i.test(String(e?.message))) throw e; });
  // The same thanks and link by email, to the address on the application (never blocks: a mail failure is only logged)
  await mail.welcome(a, job?.title ?? 'the role', link);
  return { tracking_url: link, number: num.digits };
}

export async function interviewState(db: Knex, a: any) {
  const s = await getSettings(db);
  const job = await db('rec_jobs').where({ id: a.job_id }).first('title');
  const iv = await db('rec_interviews').where({ application_id: a.id }).first();
  const total = iv ? Number((await db('rec_interview_questions').where({ interview_id: iv.id }).count({ n: '*' }).first() as any).n)
    : (await roleQuestions(db, (await db('rec_jobs').where({ id: a.job_id }).first('role_id'))?.role_id ?? null)).length;
  let current: any = null;
  if (iv && iv.status === 'in_progress' && iv.current_position < total) {
    const q = await db('rec_interview_questions').where({ interview_id: iv.id, position: iv.current_position }).first();
    if (q && !q.shown_at) await db('rec_interview_questions').where({ id: q.id }).update({ shown_at: new Date() });
    const shown = q?.shown_at ? new Date(q.shown_at).getTime() : Date.now();
    current = q ? { position: q.position, category: q.category, text: q.text, seconds_left: Math.max(0, iv.seconds_per_question - Math.floor((Date.now() - shown) / 1000)) } : null;
  }
  return {
    name: a.name, job: job?.title ?? '',
    state: a.status === 'withdrawn' || iv?.status === 'terminated' || iv?.status === 'withdrawn' ? 'closed' : iv?.status === 'paused' ? 'paused' : iv?.status === 'submitted' ? 'submitted' : iv ? 'in_progress' : linkOpen(a) ? 'not_started' : 'closed',
    paused_message: iv?.status === 'paused' ? PAUSED_MESSAGE : null, warnings: { count: Number(iv?.warnings ?? 0), max: s.max_warnings },
    question_count: total, seconds_per_question: iv?.seconds_per_question ?? s.seconds_per_question,
    estimated_minutes: Math.ceil((total * (iv?.seconds_per_question ?? s.seconds_per_question)) / 60) + 2,
    consent_text: CONSENT_TEXT, consent_version: s.consent_version, expires_at: a.interview_expires_at,
    // After the interview: the number to confirm (prefilled from the application) and whether it is confirmed
    phone: a.phone ?? '', whatsapp_confirmed: !!a.whatsapp_confirmed_at, whatsapp: a.whatsapp ?? null,
    position: iv?.current_position ?? 0, current, segments: iv ? JSON.parse(iv.segments || '[]').length : 0,
  };
}

/** The questions asked for a role: active ones for every role, then the role's own. */
export async function roleQuestions(db: Knex, departmentId: number | null | undefined) {
  return db('rec_questions').where({ active: true })
    .where((q) => { q.whereNull('department_id'); if (departmentId) q.orWhere('department_id', departmentId); })
    .orderByRaw('CASE WHEN department_id IS NULL THEN 0 ELSE 1 END').orderByRaw('COALESCE(sort_order, 1000000 + id)').select('id', 'category', 'text', 'department_id');
}
/** Whether a role's questions (or, for null, the "All roles" ones) are shuffled for each candidate. */
export async function shuffleOn(db: Knex, roleId: number | null): Promise<boolean> {
  if (roleId == null) return (await db('rec_settings').where({ name: 'shuffle_general' }).first('value'))?.value === '1';
  return !!(await db('rec_roles').where({ id: roleId }).first('shuffle'))?.shuffle;
}
const shuffled = <T,>(xs: T[], rand: () => number) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// Picks the questions once, at the start, and stores them: a refresh or a second visit resumes the same interview
export async function startInterview(db: Knex, a: any, consent: { accepted: boolean; version: string }, rand: () => number = Math.random) {
  const existing = await db('rec_interviews').where({ application_id: a.id }).first();
  if (existing) return existing;
  if (!linkOpen(a)) throw new ServiceError(410, 'This interview link has expired or is no longer available.');
  const s = await getSettings(db);
  if (!consent.accepted || consent.version !== s.consent_version) throw new ServiceError(400, 'Please read and accept the recording consent to start');
  // Every active question for this role: the ones for all roles first, then the role's own, in the order they were added
  const job = await db('rec_jobs').where({ id: a.job_id }).first('role_id');
  const all = await roleQuestions(db, job?.role_id ?? null);
  if (!all.length) throw new ServiceError(503, 'The interview is not ready yet. Please try again later.');
  // All-roles questions first, then the role's; each group in the saved order, or shuffled if that group's toggle is on
  const general = all.filter((q: any) => q.department_id == null); const own = all.filter((q: any) => q.department_id != null);
  const picked = [
    ...((await shuffleOn(db, null)) ? shuffled(general, rand) : general),
    ...(job?.role_id && (await shuffleOn(db, Number(job.role_id))) ? shuffled(own, rand) : own),
  ];
  const now = new Date();
  try {
    const [id] = await db('rec_interviews').insert({ application_id: a.id, status: 'in_progress', consent_at: now, consent_version: s.consent_version, seconds_per_question: s.seconds_per_question, current_position: 0, started_at: now, segments: '[]' });
    await db('rec_interview_questions').insert(picked.map((q: any, i: number) => ({ interview_id: id, position: i, question_id: q.id, category: q.category, text: q.text })));
    await db('rec_events').insert({ interview_id: id, type: 'interview_started', detail: `consent ${s.consent_version}`, at: now });
    await log(db, { application_id: a.id, action: 'interview_started', actor: null });
    return db('rec_interviews').where({ id }).first();
  } catch (e: any) {
    // Two tabs starting at once: the unique application id keeps one interview
    if (/unique|duplicate/i.test(String(e?.message))) return db('rec_interviews').where({ application_id: a.id }).first();
    throw e;
  }
}

export const PAUSED_MESSAGE = 'Your interview has been paused because repeated interview-rule violations were detected. Your application is under review. The recruitment team will contact you regarding the next step.';
const inProgress = async (db: Knex, a: any, allowPaused = false) => {
  const iv = await db('rec_interviews').where({ application_id: a.id }).first();
  if (!iv) throw new ServiceError(409, 'The interview has not started');
  if (iv.status === 'paused' && !allowPaused) throw new ServiceError(423, PAUSED_MESSAGE);
  if (iv.status === 'terminated') throw new ServiceError(409, 'This interview has been closed by the recruitment team.');
  if (iv.status !== 'in_progress' && !(allowPaused && iv.status === 'paused')) throw new ServiceError(409, 'This interview has already been submitted');
  return iv;
};

export async function nextQuestion(db: Knex, a: any, position: number) {
  const iv = await inProgress(db, a);
  if (Number(position) !== iv.current_position) return interviewState(db, a);   // a repeated click: no double skip
  await db('rec_interview_questions').where({ interview_id: iv.id, position: iv.current_position }).update({ answered_at: new Date() });
  await db('rec_interviews').where({ id: iv.id, current_position: iv.current_position }).update({ current_position: iv.current_position + 1 });
  return interviewState(db, a);
}

export const EVENT_TYPES = ['tab_hidden', 'tab_visible', 'window_blur', 'window_focus', 'fullscreen_exit', 'fullscreen_enter', 'camera_lost', 'microphone_lost',
  'recording_interrupted', 'recording_resumed', 'permission_changed', 'copy_attempt', 'paste_attempt', 'navigation_attempt', 'network_offline', 'network_online', 'page_reload', 'device_info', 'session_resumed',
  'page_exit', 'multiple_tabs', 'recording_started', 'recording_stopped'];
export async function recordEvents(db: Knex, a: any, events: any[]) {
  const iv = await inProgress(db, a);
  const rows = (Array.isArray(events) ? events : []).slice(0, 50).filter((e) => EVENT_TYPES.includes(e?.type)).map((e) => ({
    interview_id: iv.id, type: e.type, detail: e.detail ? clip(e.detail, 300) : null,
    position: Number.isInteger(e.position) ? e.position : iv.current_position,
    at: Number.isFinite(Date.parse(e.at)) && Math.abs(Date.parse(e.at) - Date.now()) < 3_600_000 ? new Date(e.at) : new Date(),
    received_at: new Date(), source: 'client',
  }));
  if (rows.length) await db('rec_events').insert(rows);
  return { saved: rows.length, warning: await checkIntegrity(db, iv, rows) };
}

// Recording: the browser sends short chunks in order. Each restart of the recorder (a reload, a lost camera, a new
// 30-second part on Apple devices) is a new segment. Every chunk is kept as its own file, exactly as received, and
// listed in the segment's manifest; the playable recording is built from them after submission (processRecording).
const MAX_RECORDING_BYTES = 800 * 1024 * 1024;
// Less than this is not a video (a few seconds of camera is far more)
export const MIN_VIDEO_BYTES = 20 * 1024;
const chunkDir = (ivId: number, seg: number) => ensureDir(path.join(recordingDir(ivId), `segment-${seg}`));
const isEndMarker = (last: boolean, data: Buffer) => last && data.length === 1 && data[0] === 0;

// Saves the manifest only if nobody changed it meanwhile; two uploads at once can't both write their version
async function saveManifest(db: Knex, iv: any, segments: any[], addBytes: number): Promise<boolean> {
  const n = await db('rec_interviews').where({ id: iv.id, segments: iv.segments ?? '[]' }).whereIn('status', ['in_progress', 'paused'])
    .update({ segments: JSON.stringify(segments), recording_bytes: Number(iv.recording_bytes) + addBytes });
  return n === 1;
}

// A new part starts when the page was reloaded, closed or opened elsewhere: the part that page was recording never
// got its end marker. It is closed with what arrived, so the interview can still be submitted (it used to be refused
// forever with "has not finished uploading").
function closeCutParts(segments: any[]) {
  for (const s of segments) if (!s.done) { s.done = true; s.cut = true; s.expected = s.chunks; s.mime = s.mime || 'video/webm'; }
}
export async function saveChunk(db: Knex, a: any, seg: number, seq: number, last: boolean, data: Buffer, mime: string, ms?: number) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const iv = await inProgress(db, a, true);   // a pause keeps what was already recorded
    const segments: any[] = JSON.parse(iv.segments || '[]');
    if (!Number.isInteger(seg) || seg < 0 || seg > segments.length || seg > 200) throw new ServiceError(400, 'Invalid recording segment');
    if (!Number.isInteger(seq) || seq < 0 || seq > 100_000) throw new ServiceError(400, 'Invalid recording chunk');
    if (seg === segments.length) { closeCutParts(segments); segments.push({ n: seg, chunks: 0, bytes: 0, done: false, mime: null, parts: [] }); }
    const s = segments[seg]; s.parts = s.parts ?? [];
    if (seq < s.chunks) return { segment: seg, next: s.chunks, duplicate: true };   // a retry of a chunk already kept
    if (seq > s.chunks || s.done) throw new ServiceError(409, `Expected chunk ${s.chunks}`);
    const marker = isEndMarker(last, data);
    if (Number(iv.recording_bytes) + data.length > MAX_RECORDING_BYTES) throw new ServiceError(413, 'The recording is too large');
    // The chunk's own file, named by its number: writing it twice writes the same bytes, never a second copy
    if (!marker) fs.writeFileSync(path.join(chunkDir(iv.id, seg), `${String(seq).padStart(6, '0')}.part`), data);
    // The type comes from the file's own first bytes when it can: browsers do not always label it (iPhone MP4 arrived unlabelled)
    if (!s.mime && !marker) s.mime = sniffVideo(data) ?? (/^(video|audio)\/[\w.+-]+(;.*)?$/.test(mime) ? mime.split(';')[0] : 'video/webm');
    s.parts.push({ seq, bytes: marker ? 0 : data.length });
    s.chunks += 1; s.bytes += marker ? 0 : data.length;
    if (last) { s.done = true; s.expected = seq + 1; s.mime = s.mime || 'video/webm'; }
    // How long the camera had run when this chunk was made: the part's real length, measured by the candidate's clock
    if (Number.isFinite(ms) && ms! > 0 && ms! < 3_600_000) s.ms = Math.max(Number(s.ms || 0), Math.round(ms!));
    if (await saveManifest(db, iv, segments, marker ? 0 : data.length)) return { segment: seg, next: s.chunks, duplicate: false };
    // Someone else saved first (a retry racing the original): read again and decide afresh
  }
  throw new ServiceError(503, 'The recording is busy, retrying');   // the browser retries 5xx by itself
}

// The sound of one part, recorded separately on Apple devices (their recorder drops the sound from the video after
// about half a second). Sent whole when the part ends; offsetMs is when it started relative to the part's video.
export async function saveAudio(db: Knex, a: any, seg: number, data: Buffer, offsetMs?: number) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const iv = await inProgress(db, a, true);   // a pause keeps what was already recorded
    const segments: any[] = JSON.parse(iv.segments || '[]');
    if (!Number.isInteger(seg) || seg < 0 || seg > segments.length || seg > 200) throw new ServiceError(400, 'Invalid recording segment');
    if (seg === segments.length) { closeCutParts(segments); segments.push({ n: seg, chunks: 0, bytes: 0, done: false, mime: null, parts: [] }); }
    const s = segments[seg];
    if (s.audio) return { segment: seg, duplicate: true };
    if (Number(iv.recording_bytes) + data.length > MAX_RECORDING_BYTES) throw new ServiceError(413, 'The recording is too large');
    fs.writeFileSync(path.join(recordingDir(iv.id), `segment-${seg}.audio`), data);
    s.audio = { bytes: data.length, mime: sniffVideo(data) ? 'audio/mp4' : 'audio/webm', offset_ms: Number.isFinite(offsetMs) && Math.abs(offsetMs!) < 10_000 ? Math.round(offsetMs!) : 0 };
    if (await saveManifest(db, iv, segments, data.length)) return { segment: seg, duplicate: false };
  }
  throw new ServiceError(503, 'The recording is busy, retrying');
}

// Submitted only when every question was reached and every segment's manifest is closed by its last chunk. The
// recording is then "Processing" until processRecording has built and measured it: never "complete" on upload alone.
export async function submitInterview(db: Knex, a: any) {
  const iv = await inProgress(db, a);
  const total = Number((await db('rec_interview_questions').where({ interview_id: iv.id }).count({ n: '*' }).first() as any).n);
  if (iv.current_position < total) throw new ServiceError(409, 'Please answer all questions before submitting');
  const segments: any[] = JSON.parse(iv.segments || '[]');
  if (!segments.length || segments.some((s) => !s.done)) throw new ServiceError(409, 'Your recording has not finished uploading. Please keep this page open and try again.');
  const now = new Date();
  const n = await db('rec_interviews').where({ id: iv.id, status: 'in_progress' }).update({ status: 'submitted', submitted_at: now, processing_status: 'processing' });
  if (!n) throw new ServiceError(409, 'This interview has already been submitted');
  await db('rec_events').insert({ interview_id: iv.id, type: 'interview_submitted', at: now });
  // The interview link stays open until the candidate confirms their WhatsApp number (see confirmWhatsApp)
  await db('rec_applications').where({ id: a.id, status: 'prelim_pending' }).update({ status: 'interview_review', updated_at: now });
  await log(db, { application_id: a.id, action: 'interview_submitted', from: 'prelim_pending', to: 'interview_review', actor: null });
  const job = await db('rec_jobs').where({ id: a.job_id }).first('title');
  await notifyStaff(db, `${a.name} completed the preliminary interview for "${job?.title}" — ready for evaluation`);
  return iv.id as number;
}

// ── Building and verifying the recording ──
// Statuses: processing → verified | incomplete (built, but a check failed: reviewers see what) | failed (could not
// be built; the uploaded chunks are kept untouched for recovery).
const running = new Map<number, Promise<string>>();   // one build per interview at a time; a second call waits for it
export function processRecording(db: Knex, ivId: number): Promise<string> {
  const busy = running.get(ivId); if (busy) return busy;
  const job = buildAndVerify(db, ivId).catch(async () => {
    console.error('[recruitment] recording processing failed for interview', ivId);
    await db('rec_interviews').where({ id: ivId }).update({ processing_status: 'failed', verification: JSON.stringify({ problems: ['processing stopped with an error; the uploaded recording is kept'] }), verified_at: new Date() });
    return 'failed';
  }).finally(() => running.delete(ivId));
  running.set(ivId, job);
  return job;
}

async function buildAndVerify(db: Knex, ivId: number): Promise<string> {
  const M = await import('./recordingMedia');
  const iv = await db('rec_interviews').where({ id: ivId }).first();
  const segments: any[] = JSON.parse(iv.segments || '[]');
  const dir = recordingDir(ivId);
  const problems: string[] = [];
  const manifest = segments.map((s) => {
    // Interviews recorded before chunks were tracked one by one have no chunk list: nothing to compare
    const seqs = s.parts ? s.parts.map((p: any) => p.seq) : Array.from({ length: s.chunks }, (_, i) => i);
    const expected = s.expected ?? s.chunks;
    const missing: number[] = []; for (let q = 0; q < expected; q++) if (!seqs.includes(q)) missing.push(q);
    const dupes = seqs.length - new Set(seqs).size;
    if (!s.done) problems.push(`part ${s.n + 1}: upload never finished`);
    if (s.cut && !s.bytes) problems.push(`part ${s.n + 1}: lost (the page was closed, reloaded or opened elsewhere before this part was uploaded)`);
    if (missing.length) problems.push(`part ${s.n + 1}: chunks missing (${missing.slice(0, 10).join(', ')})`);
    if (dupes) problems.push(`part ${s.n + 1}: ${dupes} chunk(s) listed twice`);
    return { n: s.n, expected, received: seqs.length, missing, bytes: s.bytes, has_audio_file: !!s.audio };
  });
  if (!M.mediaToolsAvailable()) {
    await db('rec_interviews').where({ id: ivId }).update({ processing_status: 'failed', verification: JSON.stringify({ manifest, problems: [...problems, 'media tools are not installed on the server (npm install)'] }), verified_at: new Date() });
    return 'failed';
  }
  // 1. Each part's video, rebuilt from its chunk files in order (older interviews stored one file per part)
  const work = ensureDir(path.join(dir, 'processed'));
  const inputs: any[] = [];
  for (const s of segments) {
    if (!s.bytes) continue;   // a part that only says "ended" (no camera data): listed in the manifest, nothing to build
    const legacy = path.join(dir, `segment-${s.n}.webm`);
    let video = legacy;
    if (s.parts?.length) {
      video = path.join(work, `source-${s.n}.${s.mime === 'video/mp4' ? 'mp4' : 'webm'}`);
      const fd = fs.openSync(video, 'w');
      try {
        for (const p of [...s.parts].sort((x: any, y: any) => x.seq - y.seq)) {
          if (!p.bytes) continue;
          const f = path.join(dir, `segment-${s.n}`, `${String(p.seq).padStart(6, '0')}.part`);
          const data = fs.readFileSync(f);
          if (data.length !== p.bytes) problems.push(`part ${s.n + 1}: chunk ${p.seq} size differs from what was received`);
          fs.writeSync(fd, data);
        }
      } finally { fs.closeSync(fd); }
    }
    if (!fs.existsSync(video)) { problems.push(`part ${s.n + 1}: recording file missing`); continue; }
    const audio = s.audio ? path.join(dir, `segment-${s.n}.audio`) : null;
    inputs.push({ n: s.n, video, mime: s.mime || 'video/webm', ms: s.ms, audio: audio && fs.existsSync(audio) ? audio : null, audioOffsetMs: s.audio?.offset_ms ?? 0 });
  }
  if (!inputs.length) problems.push('no video was received from the browser');
  // 2. One playable file per part (separate sound put in), 3. joined in order, 4. measured
  const parts = [];
  for (const p of inputs) parts.push(await M.buildPart(p, work));
  for (const p of parts) {
    problems.push(...p.problems);
    if (p.expected && p.probe.video && !M.near(p.probe.video.seconds, p.expected)) problems.push(`part ${p.n + 1}: video lasts ${p.probe.video.seconds.toFixed(1)} s but ${p.expected.toFixed(1)} s were recorded`);
    if (p.probe.video && p.probe.audio && !M.near(p.probe.audio.seconds, p.probe.video.seconds)) problems.push(`part ${p.n + 1}: sound lasts ${p.probe.audio.seconds.toFixed(1)} s, video ${p.probe.video.seconds.toFixed(1)} s`);
  }
  const final = await M.joinParts(parts, work);
  const fp = final ? await M.probe(final) : null;
  const expectedTotal = parts.every((p) => p.expected) ? parts.reduce((t, p) => t + (p.expected ?? 0), 0) : null;
  if (parts.some((p) => p.file) && !final) problems.push('parts could not be joined into one file (format changed during the interview); they play one after another');
  if (fp && !fp.valid) problems.push('the joined recording is not playable');
  if (fp?.video && expectedTotal && !M.near(fp.video.seconds, expectedTotal)) problems.push(`recording lasts ${fp.video.seconds.toFixed(1)} s but ${expectedTotal.toFixed(1)} s were recorded`);
  // Without the browser's own timing (older interviews), the interview's start-to-submit time is the yardstick: a
  // recording much shorter than the time the candidate spent is never passed (setup and gaps allow for some loss)
  const wall = iv.submitted_at && iv.started_at ? (new Date(iv.submitted_at).getTime() - new Date(iv.started_at).getTime()) / 1000 : 0;
  if (fp?.video && !expectedTotal && wall > 10 && fp.video.seconds < wall * 0.5) problems.push(`recording lasts ${fp.video.seconds.toFixed(1)} s but the interview took ${Math.round(wall)} s`);
  if (fp?.video && fp.audio && !M.near(fp.audio.seconds, fp.video.seconds)) problems.push(`sound lasts ${fp.audio.seconds.toFixed(1)} s, video ${fp.video.seconds.toFixed(1)} s`);
  if (fp && !fp.audio) problems.push('the recording has no sound');
  if (fp && !fp.video) problems.push('the recording has no video');
  const status = !inputs.length || (!final && !parts.some((p) => p.file)) ? 'failed' : problems.length ? 'incomplete' : 'verified';
  const verification = {
    manifest, problems, expected_seconds: expectedTotal,
    final: fp ? { valid: fp.valid, video: fp.video, audio: fp.audio } : null,
    parts: parts.map((p) => ({ n: p.n, ok: !!p.file, video: p.probe.video, audio: p.probe.audio })),
  };
  await db('rec_interviews').where({ id: ivId }).update({
    processing_status: status, verification: JSON.stringify(verification), verified_at: new Date(),
    final_file: final ? path.relative(dir, final) : null,
  });
  return status;
}

/** After a restart: interviews left in "processing" are built again (their chunks are all kept). */
export async function resumeProcessing(db: Knex) {
  for (const r of await db('rec_interviews').where({ processing_status: 'processing' }).select('id')) await processRecording(db, Number(r.id));
}

// ── Final interview scheduling ──
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export async function schedule(db: Knex, actor: Actor, appId: number, body: any, mail: Mailer = defaultMailer, scheduleId?: number) {
  const a = await db('rec_applications').where({ id: appId }).first();
  if (!a) throw new ServiceError(404, 'Application not found');
  const resched = scheduleId !== undefined;
  if (!resched && a.status !== 'prelim_approved') throw new ServiceError(409, 'A final interview can be scheduled once the preliminary interview is approved');
  if (resched && a.status !== 'final_scheduled') throw new ServiceError(409, 'There is no scheduled interview to change');
  const type = body.type === 'online' ? 'online' : body.type === 'walkin' ? 'walkin' : null;
  if (!type) throw new ServiceError(400, 'Choose walk-in or online');
  const date = String(body.date ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !TIME.test(body.start_time) || !TIME.test(body.end_time) || body.end_time <= body.start_time) throw new ServiceError(400, 'Please enter a valid date, start time and end time');
  if (type === 'walkin' && !clip(body.address, 1000)) throw new ServiceError(400, 'Please enter the office address');
  if (type === 'online' && !/^https:\/\/[^\s]{4,490}$/.test(String(body.meeting_url ?? ''))) throw new ServiceError(400, 'Please enter the meeting link (starting with https://)');
  const ids = (Array.isArray(body.interviewer_ids) ? body.interviewer_ids : []).map(Number).filter((n: number) => n > 0).slice(0, 10);
  const people = ids.length ? await db('users').whereIn('id', ids).whereIn('role', ['admin', 'manager', 'employee']).select('id', 'name') : [];
  const row = {
    type, date, start_time: body.start_time, end_time: body.end_time,
    location: type === 'walkin' ? clip(body.location, 200) : null, address: type === 'walkin' ? clip(body.address, 1000) : null,
    meeting_url: type === 'online' ? String(body.meeting_url) : null, interviewers: JSON.stringify(people), instructions: clip(body.instructions, 2000),
    updated_at: new Date(),
  };
  if (resched) {
    const n = await db('rec_schedules').where({ id: scheduleId, application_id: a.id, status: 'scheduled' }).update(row);
    if (!n) throw new ServiceError(404, 'Scheduled interview not found');
  } else {
    await db('rec_schedules').insert({ ...row, application_id: a.id, status: 'scheduled', created_by: actor.id });
    await db('rec_applications').where({ id: a.id }).update({ status: 'final_scheduled', updated_at: new Date() });
  }
  await log(db, { application_id: a.id, action: resched ? 'interview_rescheduled' : 'interview_scheduled', from: a.status, to: 'final_scheduled', actor, comment: `${type === 'online' ? 'Online' : 'Walk-in'} on ${date} ${body.start_time}–${body.end_time}${body.reason ? ` · ${clip(body.reason, 300)}` : ''}` });
  for (const p of people) await createNotification(p.id, `You are an interviewer for ${a.name} on ${date} at ${body.start_time}`, 'recruitment');
  const job = await db('rec_jobs').where({ id: a.job_id }).first('title');
  await mail.scheduled(a, job?.title ?? '', { ...row, people }, resched);
}

export async function cancelSchedule(db: Knex, actor: Actor, appId: number, scheduleId: number, reason: string, mail: Mailer = defaultMailer) {
  const a = await db('rec_applications').where({ id: appId }).first();
  if (!a || a.status !== 'final_scheduled') throw new ServiceError(409, 'There is no scheduled interview to cancel');
  if (!String(reason ?? '').trim()) throw new ServiceError(400, 'Please give a reason for cancelling');
  const n = await db('rec_schedules').where({ id: scheduleId, application_id: appId, status: 'scheduled' }).update({ status: 'cancelled', updated_at: new Date() });
  if (!n) throw new ServiceError(404, 'Scheduled interview not found');
  await db('rec_applications').where({ id: appId }).update({ status: 'prelim_approved', updated_at: new Date() });
  await log(db, { application_id: appId, action: 'interview_cancelled', from: 'final_scheduled', to: 'prelim_approved', actor, comment: reason });
  const job = await db('rec_jobs').where({ id: a.job_id }).first('title');
  await mail.cancelled(a, job?.title ?? '', clip(reason, 300));
}

export async function completeFinal(db: Knex, actor: Actor, appId: number, comment?: string) {
  const a = await db('rec_applications').where({ id: appId }).first();
  if (!a || a.status !== 'final_scheduled') throw new ServiceError(409, 'There is no scheduled interview to mark as completed');
  await db('rec_schedules').where({ application_id: appId, status: 'scheduled' }).update({ status: 'completed', updated_at: new Date() });
  await db('rec_applications').where({ id: appId }).update({ status: 'final_completed', updated_at: new Date() });
  await log(db, { application_id: appId, action: 'final_completed', from: 'final_scheduled', to: 'final_completed', actor, comment });
}

// ── Emails to candidates: only good news and interview details. A rejection is shown on their tracking page. ──
export interface Mailer {
  interviewInvite(a: any, job: string, token: string, expires: Date): Promise<void>;
  scheduled(a: any, job: string, s: any, resched: boolean): Promise<void>;
  cancelled(a: any, job: string, reason: string): Promise<void>;
  selected(a: any, job: string): Promise<void>;
  welcome(a: any, job: string, link: string): Promise<void>;
}
const site = () => (process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || 'https://looped.in').replace(/\/$/, '');
async function sendMail(to: { email: string; name: string }, subject: string, body: string) {
  // Never during tests or when mail is not set up; a mail failure never blocks the decision
  if (process.env.RECRUITMENT_EMAILS === 'off' || !process.env.GMAIL_USER) return;
  try { const { sendEmail } = await import('./emailService'); await sendEmail({ to: [to], subject, body }); }
  catch { console.error('[recruitment] candidate email could not be sent'); }
}
export const defaultMailer: Mailer = {
  welcome: (a, job, link) => sendMail({ email: a.email, name: a.name }, `Thank you for applying for ${job}`,
    `Hi ${a.name},\n\nThank you for applying for ${job} and for completing your video interview (reference ${a.ref}).\n\nOur team will review your application and keep you updated here and on WhatsApp.\n\nYou can check your application status any time with this private link (please keep it to yourself):\n${link}\n\nBest wishes,\nThe Loooped team`),
  interviewInvite: (a, job, token, expires) => sendMail({ email: a.email, name: a.name }, `Your video interview for ${job}`,
    `Hi ${a.name},\n\nThank you for applying for ${job} (reference ${a.ref}). The next step is a short recorded video interview.\n\nIf you haven't finished it yet, you can take it here:\n${site()}/careers/interview/${token}\n\nThe link is valid until ${expires.toDateString()}. You'll need a camera and microphone; the interview is recorded.\n\nBest of luck!`),
  scheduled: (a, job, s, resched) => sendMail({ email: a.email, name: a.name }, `${resched ? 'Updated: ' : ''}Final interview for ${job}`,
    `Hi ${a.name},\n\nCongratulations on clearing the preliminary interview for ${job}. Your final interview is ${resched ? 'now ' : ''}scheduled:\n\nType: ${s.type === 'online' ? 'Online (one-to-one)' : 'Walk-in'}\nDate: ${s.date}\nTime: ${s.start_time} – ${s.end_time} (IST)\n${s.type === 'online' ? `Meeting link: ${s.meeting_url}` : `Location: ${s.location || ''}\nAddress: ${s.address}`}\n${s.instructions ? `\nInstructions: ${s.instructions}\n` : ''}\nYou can always check your application at the tracking link you received when you applied (reference ${a.ref}).`),
  cancelled: (a, job, reason) => sendMail({ email: a.email, name: a.name }, `Final interview for ${job} has been cancelled`,
    `Hi ${a.name},\n\nYour final interview for ${job} has been cancelled${reason ? ` (${reason})` : ''}. We will share a new time with you soon.\n\nReference: ${a.ref}`),
  selected: (a, job) => sendMail({ email: a.email, name: a.name }, `Congratulations! You've been shortlisted for ${job}`,
    `Hi ${a.name},\n\nWe're delighted to let you know that you have been shortlisted for ${job}. Our team will contact you shortly about the next steps.\n\nReference: ${a.ref}`),
};

// ── Retention: recordings older than the configured number of days are deleted (files only; the record stays) ──
export async function purgeOldRecordings(db: Knex, now = new Date()): Promise<number> {
  const s = await getSettings(db);
  const before = new Date(now.getTime() - s.recording_retention_days * 86_400_000);
  const old = await db('rec_interviews').whereNull('recording_deleted_at').where('started_at', '<', before).select('id');
  for (const r of old) {
    fs.rmSync(path.join(storageDir(), 'recordings', String(r.id)), { recursive: true, force: true });
    await db('rec_interviews').where({ id: r.id }).update({ recording_deleted_at: now });
  }
  return old.length;
}

// Removes a candidate completely (their data, resume and recording), e.g. on request. Admin only, logged nowhere
// candidate-identifying: only the reference survives in the server log.
export async function deleteCandidate(db: Knex, appId: number) {
  const a = await db('rec_applications').where({ id: appId }).first();
  if (!a) throw new ServiceError(404, 'Application not found');
  const iv = await db('rec_interviews').where({ application_id: appId }).first('id');
  // The records go together or not at all; the files only after that has succeeded
  await db.transaction(async (trx) => {
    if (iv) for (const t of ['rec_events', 'rec_interview_questions']) await trx(t).where({ interview_id: iv.id }).del();
    await trx('rec_interviews').where({ application_id: appId }).del();
    for (const t of ['rec_history', 'rec_evaluations', 'rec_schedules']) await trx(t).where({ application_id: appId }).del();
    await trx('rec_applications').where({ id: appId }).del();
  });
  const files = [path.join(resumeDir(), a.resume_file), ...(iv ? [path.join(storageDir(), 'recordings', String(iv.id))] : [])];
  for (const f of files) {
    try { fs.rmSync(f, { recursive: true, force: true }); }
    catch { console.error(`[recruitment] file clean-up failed after deleting ${a.ref}; remove it by hand from the recruitment storage`); }
  }
  console.log(`[recruitment] candidate data deleted for ${a.ref}`);
}

/** Admin only: deletes an interview's recording for good (files on disk); the application and its history stay. */
export async function deleteRecording(db: Knex, actor: Actor, interviewId: number) {
  if (actor.role !== 'admin') throw new ServiceError(403, 'Only an admin can delete a recording');
  const iv = await db('rec_interviews').where({ id: interviewId }).first('id', 'application_id', 'recording_deleted_at');
  if (!iv) throw new ServiceError(404, 'Interview not found');
  if (iv.recording_deleted_at) return { already: true };
  const dir = path.join(storageDir(), 'recordings', String(iv.id));
  const freed = sizeOf(dir);
  await db('rec_interviews').where({ id: iv.id }).update({ recording_deleted_at: new Date(), final_file: null, processing_status: null });
  await log(db, { application_id: iv.application_id, action: 'recording_deleted', actor, comment: `${Math.round(freed / 1024)} KB` });
  fs.rmSync(dir, { recursive: true, force: true });
  return { freed_bytes: freed };
}

/** How often each applicant left the interview tab, and for how long in total (from the "away N s" the page records). */
export async function tabSwitches(db: Knex, appIds: number[]): Promise<Map<number, { tab_switches: number; away_seconds: number }>> {
  const out = new Map<number, { tab_switches: number; away_seconds: number }>();
  if (!appIds.length) return out;
  const rows = await db('rec_events as e').join('rec_interviews as i', 'i.id', 'e.interview_id').whereIn('i.application_id', appIds)
    .whereIn('e.type', ['tab_hidden', 'tab_visible']).select('i.application_id', 'e.type', 'e.detail');
  for (const r of rows) {
    const o = out.get(Number(r.application_id)) ?? { tab_switches: 0, away_seconds: 0 };
    if (r.type === 'tab_hidden') o.tab_switches++;
    else o.away_seconds += Number(/away (\d+) s/.exec(String(r.detail ?? ''))?.[1] ?? 0);
    out.set(Number(r.application_id), o);
  }
  return out;
}

// ── Interview monitoring ──
// Events the server itself records (never accepted from the page): who owns the interview, missed heartbeats, ends.
async function serverEvent(db: Knex, ivId: number, type: string, detail: string | null, position: number | null = null) {
  const now = new Date();
  await db('rec_events').insert({ interview_id: ivId, type, detail: detail ? clip(detail, 300) : null, position, at: now, received_at: now, source: 'server' });
}
export const audit = log;
const SESSION = /^[A-Za-z0-9_-]{8,40}$/;
const LIVE_MS = 45_000;          // a page that sent a heartbeat this recently is connected
const GAP_MS = 60_000;           // longer without one is recorded as an interruption (browsers slow timers in hidden tabs)
const ABANDONED_MS = 30 * 60_000;

/** The page opening an interview under way becomes its owner; the previous page is stopped and the switch recorded. */
export async function claimSession(db: Knex, a: any, sid: unknown) {
  if (typeof sid !== 'string' || !SESSION.test(sid)) return;
  const iv = await db('rec_interviews').where({ application_id: a.id, status: 'in_progress' }).first('id', 'session_id', 'last_seen_at', 'current_position');
  if (!iv || iv.session_id === sid) return;
  const now = new Date();
  if (iv.session_id) {
    const live = iv.last_seen_at && now.getTime() - toDate(iv.last_seen_at).getTime() < LIVE_MS;
    await serverEvent(db, iv.id, live ? 'session_conflict' : 'session_resumed', live
      ? 'opened in another tab, browser or device while the previous page was still connected; the previous page was stopped'
      : 'opened again (reload, reopened browser or another device); the previous page had stopped', iv.current_position);
    if (live) await checkIntegrity(db, { ...iv, application_id: a.id }, [{ type: 'session_conflict', at: now, detail: 'another tab, browser or device while the first was connected', position: iv.current_position }]);
  }
  await db('rec_interviews').where({ id: iv.id }).update({ session_id: sid, last_seen_at: now });
}
/** Writes come only from the owning page. Without a session id (an older page) the write is allowed. */
export async function checkSession(db: Knex, a: any, sid: unknown) {
  if (typeof sid !== 'string' || !sid) return;   // shortcut: pages without a session id pass; require it once every page sends one
  const iv = await db('rec_interviews').where({ application_id: a.id }).whereIn('status', ['in_progress', 'paused']).first('session_id');
  if (iv?.session_id && iv.session_id !== sid) throw new ServiceError(409, 'This interview is now open in another tab or device. Please continue there, or reload this page to continue here.');
}
/** The page's regular sign of life; a long silence before it is recorded as an interruption (inferred, not observed). */
export async function heartbeat(db: Knex, a: any, sid: unknown) {
  const iv = await inProgress(db, a);
  await checkSession(db, a, sid);
  const now = new Date();
  const gap = iv.last_seen_at ? now.getTime() - toDate(iv.last_seen_at).getTime() : 0;
  if (gap > GAP_MS) await serverEvent(db, iv.id, 'connection_gap', `no contact from the interview page for ${Math.round(gap / 1000)} s (network, a sleeping device or a closed page; the cause is not known)`, iv.current_position);
  await db('rec_interviews').where({ id: iv.id }).update({ last_seen_at: now });
  return { ok: true, gap_seconds: gap > GAP_MS ? Math.round(gap / 1000) : 0 };
}

const LABEL: Record<string, [string, 'info' | 'notice' | 'warning']> = {
  interview_started: ['Interview started (consent given)', 'info'], interview_submitted: ['Interview submitted', 'info'], interview_withdrawn: ['Withdrawn during the interview', 'notice'],
  tab_hidden: ['Left the interview tab', 'notice'], tab_visible: ['Came back to the tab', 'info'],
  window_blur: ['Window lost focus (another window or app was used)', 'notice'], window_focus: ['Window focused again', 'info'],
  fullscreen_exit: ['Left fullscreen', 'notice'], fullscreen_enter: ['Entered fullscreen', 'info'],
  network_offline: ['Internet disconnected', 'warning'], network_online: ['Internet back', 'info'], connection_gap: ['No contact from the page', 'warning'],
  camera_lost: ['Camera interrupted', 'warning'], microphone_lost: ['Microphone interrupted', 'warning'], permission_changed: ['Camera/microphone permission changed', 'warning'],
  recording_interrupted: ['Recording interrupted / upload failed', 'warning'], recording_resumed: ['Recording resumed', 'info'], recording_started: ['Recording started', 'info'], recording_stopped: ['Recording stopped', 'info'],
  session_conflict: ['Opened in another tab or device at the same time', 'warning'], session_resumed: ['Interview reopened', 'notice'], multiple_tabs: ['Interview open in two tabs of this browser', 'warning'],
  page_reload: ['Page reloaded', 'notice'], page_exit: ['Page closed or navigated away', 'notice'], navigation_attempt: ['Tried to leave the page', 'notice'],
  interview_paused: ['Interview paused for review', 'warning'], interview_resumed: ['Interview resumed by an admin', 'notice'], interview_terminated: ['Interview closed by an admin', 'warning'],
  copy_attempt: ['Copy attempted (blocked)', 'notice'], paste_attempt: ['Paste attempted (blocked)', 'notice'], device_info: ['Device', 'info'],
};
const ms = (v: any) => (v ? toDate(v).getTime() : 0);
/** What reviewers see about an interview's activity: one incident per real event (a tab switch also fires a window
 *  blur: shown once, both kept), with counts, the longest absence and a live status. Evidence for people to review,
 *  never a verdict. */
export async function monitoring(db: Knex, iv: any, now = new Date()) {
  const rows = await db('rec_events').where({ interview_id: iv.id }).orderBy('at').orderBy('id').select('id', 'type', 'detail', 'position', 'at', 'received_at', 'source');
  const hidden = rows.filter((r: any) => r.type === 'tab_hidden' || r.type === 'tab_visible').map((r: any) => ms(r.at));
  const near = (t: number) => hidden.some((h: number) => Math.abs(h - t) <= 2000);
  const counts = { tab_switches: 0, away_seconds: 0, longest_away_seconds: 0, focus_losses: 0, fullscreen_exits: 0, connection: 0, devices: 0, recording: 0, conflicts: 0, reloads: 0 };
  const timeline: any[] = []; let hiddenAt = 0;
  for (const r of rows) {
    const t = ms(r.at);
    // The blur/focus that comes with a tab switch is the same incident: folded into it, not counted twice
    if ((r.type === 'window_blur' || r.type === 'window_focus') && near(t)) { timeline[timeline.length - 1]?.grouped.push(r.type); continue; }
    let duration: number | null = null;
    if (r.type === 'tab_hidden') { counts.tab_switches++; hiddenAt = t; }
    if (r.type === 'tab_visible') {
      duration = Number(/away (\d+) s/.exec(String(r.detail ?? ''))?.[1] ?? (hiddenAt ? Math.round((t - hiddenAt) / 1000) : 0));
      counts.away_seconds += duration; counts.longest_away_seconds = Math.max(counts.longest_away_seconds, duration); hiddenAt = 0;
    }
    if (r.type === 'connection_gap') duration = Number(/for (\d+) s/.exec(String(r.detail ?? ''))?.[1] ?? 0) || null;
    if (r.type === 'window_blur') counts.focus_losses++;
    if (r.type === 'fullscreen_exit') counts.fullscreen_exits++;
    if (r.type === 'network_offline' || r.type === 'connection_gap') counts.connection++;
    if (r.type === 'camera_lost' || r.type === 'microphone_lost' || r.type === 'permission_changed') counts.devices++;
    if (r.type === 'recording_interrupted') counts.recording++;
    if (r.type === 'session_conflict' || r.type === 'multiple_tabs') counts.conflicts++;
    if (r.type === 'page_reload' || r.type === 'session_resumed') counts.reloads++;
    const [label, severity] = LABEL[r.type] ?? [r.type, 'info'];
    timeline.push({ id: r.id, type: r.type, label, severity, detail: r.detail, position: r.position, at: r.at, received_at: r.received_at ?? null,
      source: r.source ?? (['interview_started', 'interview_submitted', 'session_resumed'].includes(r.type) ? 'server' : 'page'), duration_seconds: duration, grouped: [] as string[] });
  }
  const seen = ms(iv.last_seen_at);
  const live = iv.status !== 'in_progress' ? (iv.status === 'submitted' ? 'Completed' : iv.status === 'withdrawn' ? 'Withdrawn' : iv.status)
    : seen && now.getTime() - seen < LIVE_MS ? 'Connected now'
    : seen && now.getTime() - seen > ABANDONED_MS ? `Not connected for ${Math.round((now.getTime() - seen) / 60_000)} min (possibly abandoned)`
    : seen ? `Not connected since ${toDate(iv.last_seen_at).toISOString()}` : 'No heartbeat received';
  return { status: iv.status, live, last_seen_at: iv.last_seen_at ?? null, ...counts, timeline };
}

// ── Interview integrity: warnings, pause, review ──
// Only rule breaks count, once each: a long absence from the tab, leaving fullscreen when it is required, a second
// tab, another device at the same time. Network, camera, microphone and other technical problems never count.
const RULE: Record<string, string> = {
  tab_away: 'You left the interview page for too long.',
  fullscreen_exit: 'You left fullscreen mode, which this interview requires.',
  multiple_tabs: 'The interview was opened in more than one tab.',
  session_conflict: 'The interview was opened on another device or browser at the same time.',
};
const SERIOUS = ['session_conflict'];
const COUNTED = ['open', 'suspicious', 'confirmed'];   // dismissed, technical and insufficient-evidence incidents never count
export type Warning = { count: number; max: number; level: 'first' | 'strong' | 'final'; rule: string; message: string } | { paused: true; message: string } | null;
export function warningFor(count: number, max: number, kind: string): Warning {
  const rule = RULE[kind] ?? 'An interview rule was not followed.';
  if (count >= max) return { count, max, level: 'final', rule, message: `Final warning (${count} of ${max}). ${rule} One more violation will pause your interview for review by the recruitment team.` };
  if (count === max - 1) return { count, max, level: 'strong', rule, message: `Warning ${count} of ${max}. ${rule} If this happens again your interview may be paused for review.` };
  return { count, max, level: 'first', rule, message: `Warning ${count} of ${max}. ${rule} Please stay on this page in fullscreen until you finish. Repeated warnings can pause your interview.` };
}
const ivAppName = async (db: Knex, ivId: number) => db('rec_interviews as i').join('rec_applications as a', 'a.id', 'i.application_id').join('rec_jobs as j', 'j.id', 'a.job_id').where('i.id', ivId).first('a.id', 'a.name', 'a.ref', 'j.title');
async function countWarnings(db: Knex, ivId: number) {
  const n = Number((await db('rec_incidents').where({ interview_id: ivId }).whereIn('status', COUNTED).count({ n: '*' }).first() as any).n);
  await db('rec_interviews').where({ id: ivId }).update({ warnings: n });
  return n;
}
async function pauseInterview(db: Knex, ivId: number, by: 'auto' | 'admin', reason: string, actor: Actor | null = null) {
  const n = await db('rec_interviews').where({ id: ivId, status: 'in_progress' }).update({ status: 'paused', paused_at: new Date(), paused_by: by, integrity_status: 'integrity_review_required' });
  if (!n) return false;
  await serverEvent(db, ivId, 'interview_paused', reason);
  const x = await ivAppName(db, ivId);
  await log(db, { application_id: x.id, action: 'interview_paused', actor, comment: reason });
  await notifyStaff(db, `Interview paused for integrity review: ${x.name} (${x.ref}, ${x.title}). ${reason}`);
  return true;
}
/** Turns new events into incidents (each once), updates the warning count and pauses past the limit. Never rejects. */
export async function checkIntegrity(db: Knex, iv: any, rows: { type: string; detail?: string | null; at: Date | string; position?: number | null }[]): Promise<Warning> {
  const s = await getSettings(db);
  let last: string | null = null; let serious = false;
  for (const r of rows) {
    let kind: string | null = null;
    if (r.type === 'tab_visible' && Number(/away (\d+) s/.exec(String(r.detail ?? ''))?.[1] ?? 0) >= s.warning_away_seconds) kind = 'tab_away';
    else if (r.type === 'fullscreen_exit' && s.fullscreen_required) kind = 'fullscreen_exit';
    else if (r.type === 'multiple_tabs' || r.type === 'session_conflict') kind = r.type;
    if (!kind) continue;
    try {
      await db('rec_incidents').insert({ interview_id: iv.id, kind, serious: SERIOUS.includes(kind), dedupe: `${r.type}:${new Date(r.at).getTime()}`, detail: r.detail ? clip(r.detail, 300) : null, position: r.position ?? null, at: new Date(r.at), status: 'open' });
      last = kind; serious ||= SERIOUS.includes(kind);
    } catch (e: any) { if (!/unique|duplicate/i.test(String(e?.message))) throw e; }   // the same event delivered again
  }
  if (!last) return null;
  const count = await countWarnings(db, iv.id);
  const x = await ivAppName(db, iv.id);
  if (count > s.max_warnings || (serious && s.pause_on_serious)) {
    await pauseInterview(db, iv.id, 'auto', serious && count <= s.max_warnings ? `Serious incident: ${RULE[last]}` : `${count} warnings, more than the limit of ${s.max_warnings}`);
    return { paused: true, message: PAUSED_MESSAGE };
  }
  if (serious) { await db('rec_interviews').where({ id: iv.id }).update({ integrity_status: 'integrity_review_required' }); await notifyStaff(db, `Serious interview incident for ${x.name} (${x.ref}): ${RULE[last]}`); }
  else if (count === s.max_warnings) {
    await db('rec_interviews').where({ id: iv.id }).whereNull('integrity_status').update({ integrity_status: 'monitoring' });
    await notifyStaff(db, `Final interview warning for ${x.name} (${x.ref}, ${x.title}): closer review recommended`);
  }
  return warningFor(count, s.max_warnings, last);
}

const OUTCOMES: Record<string, [string, string]> = {   // outcome → [incident status, interview integrity status]
  no_violation: ['dismissed', 'cleared'], technical: ['technical', 'technical'], suspicious: ['suspicious', 'suspicious'],
  insufficient: ['insufficient', 'insufficient'], confirmed: ['confirmed', 'confirmed'],
};
/** Only an admin decides. Confirming can reject through the normal workflow. */
export async function reviewIntegrity(db: Knex, actor: Actor, ivId: number, body: { outcome?: string; reason?: string; evidence?: string; reject?: boolean }, mail: Mailer = defaultMailer) {
  const outcome = String(body.outcome ?? ''); const reason = clip(body.reason, 1000); const evidence = clip(body.evidence, 1000);
  if (!OUTCOMES[outcome]) throw new ServiceError(400, 'Choose an outcome');
  if (!reason) throw new ServiceError(400, 'Please give a reason');
  const iv = await db('rec_interviews').where({ id: ivId }).first();
  if (!iv) throw new ServiceError(404, 'Interview not found');
  const comment = `${outcome.replace(/_/g, ' ')}: ${reason}${evidence ? ` · Evidence: ${evidence}` : ''}`;
  if (actor.role !== 'admin') throw new ServiceError(403, 'Only an admin can decide an integrity review');
  const [incident, status] = OUTCOMES[outcome];
  await db.transaction(async (trx) => {
    await trx('rec_incidents').where({ interview_id: ivId }).whereNot('status', 'confirmed').update({ status: incident });
    const patch: any = { integrity_status: status };
    // Confirmed: the interview cannot continue or be submitted; its link stops working
    if (outcome === 'confirmed' && ['in_progress', 'paused'].includes(iv.status)) patch.status = 'terminated';
    await trx('rec_interviews').where({ id: ivId }).update(patch);
    if (outcome === 'confirmed') await trx('rec_applications').where({ id: iv.application_id }).update({ interview_hash: null });
  });
  await countWarnings(db, ivId);
  await log(db, { application_id: iv.application_id, action: 'integrity_review', from: iv.integrity_status ?? null, to: status, actor, comment });
  // Only an admin's rejection, through the usual workflow, starts the three-month rule
  if (outcome === 'confirmed' && body.reject) await act(db, actor, iv.application_id, 'reject', `Interview integrity violation confirmed: ${reason}`, mail);
  return { integrity_status: status };
}
export async function resumeInterview(db: Knex, actor: Actor, ivId: number, reason: string) {
  if (actor.role !== 'admin') throw new ServiceError(403, 'Only an admin can resume an interview');
  if (!clip(reason, 1000)) throw new ServiceError(400, 'Please give a reason');
  const iv = await db('rec_interviews').where({ id: ivId }).first();
  if (!iv || iv.status !== 'paused') throw new ServiceError(409, 'This interview is not paused');
  await db('rec_interviews').where({ id: ivId, status: 'paused' }).update({ status: 'in_progress', paused_at: null, session_id: null });
  // The current question's time starts again, so the pause does not use up the candidate's time
  await db('rec_interview_questions').where({ interview_id: ivId, position: iv.current_position }).update({ shown_at: null });
  await serverEvent(db, ivId, 'interview_resumed', clip(reason, 300));
  await log(db, { application_id: iv.application_id, action: 'interview_resumed', from: 'paused', to: 'in_progress', actor, comment: reason });
  return { status: 'in_progress' };
}
export async function terminateInterview(db: Knex, actor: Actor, ivId: number, reason: string) {
  if (actor.role !== 'admin') throw new ServiceError(403, 'Only an admin can close an interview');
  if (!clip(reason, 1000)) throw new ServiceError(400, 'Please give a reason');
  const iv = await db('rec_interviews').where({ id: ivId }).first();
  if (!iv || !['in_progress', 'paused'].includes(iv.status)) throw new ServiceError(409, 'This interview is not under way');
  await db('rec_interviews').where({ id: ivId }).update({ status: 'terminated' });
  await db('rec_applications').where({ id: iv.application_id }).update({ interview_hash: null });
  await serverEvent(db, ivId, 'interview_terminated', clip(reason, 300));
  await log(db, { application_id: iv.application_id, action: 'interview_terminated', from: iv.status, to: 'terminated', actor, comment: reason });
  return { status: 'terminated' };
}

/** Other applications from the same person (by email or phone). Never merged automatically: a phone shared with a
 *  different email is shown as a possible conflict for an admin to check. */
export async function identityMatches(db: Knex, a: any) {
  const email = String(a.email).toLowerCase(); const pk = phoneKey(a.phone);
  const rows = await db('rec_applications as r').leftJoin('rec_jobs as j', 'j.id', 'r.job_id').whereNot('r.id', a.id)
    .where((q) => { q.whereRaw('LOWER(r.email) = ?', [email]); if (pk.length >= 7) q.orWhereRaw("REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(r.phone, ' ', ''), '-', ''), '(', ''), ')', ''), '+', '') LIKE ?", [`%${pk}`]); })
    .select('r.id', 'r.ref', 'r.email', 'r.phone', 'r.status', 'r.created_at', 'j.title as job');
  const out = rows.flatMap((r: any) => {
    const byEmail = String(r.email).toLowerCase() === email; const byPhone = pk.length >= 7 && phoneKey(r.phone) === pk;
    if (!byEmail && !byPhone) return [];   // the phone prefilter matched only its last digits
    return [{ id: r.id, ref: r.ref, job: r.job, status: r.status, status_label: STATUS_LABEL[r.status] ?? r.status, created_at: r.created_at,
      match: byEmail && byPhone ? 'email and phone' : byEmail ? 'email' : 'phone', conflict: byEmail !== byPhone }];
  });
  return { related: out, conflict: out.some((r: any) => r.conflict) };
}

// ── Storage: what each applicant's files take on disk (resume, recording chunks and the built recording) ──
const sizeOf = (p: string): number => {
  try {
    const st = fs.statSync(p);
    return st.isDirectory() ? fs.readdirSync(p).reduce((n, f) => n + sizeOf(path.join(p, f)), 0) : st.size;
  } catch { return 0; }   // already gone
};
export async function storageBytes(db: Knex, apps: { id: number; resume_file: string }[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (!apps.length) return out;
  const ivs = await db('rec_interviews').whereIn('application_id', apps.map((a) => a.id)).select('id', 'application_id');
  const ivOf = new Map(ivs.map((r: any) => [Number(r.application_id), Number(r.id)]));
  for (const a of apps) {
    const iv = ivOf.get(Number(a.id));
    out.set(Number(a.id), sizeOf(path.join(resumeDir(), a.resume_file)) + (iv ? sizeOf(path.join(storageDir(), 'recordings', String(iv))) : 0));
  }
  return out;
}
/** Admin only: removes several applicants completely (records and files), one by one; returns what was freed. */
export async function deleteCandidates(db: Knex, actor: Actor, ids: number[]) {
  if (actor.role !== 'admin') throw new ServiceError(403, 'Only an admin can delete applicants');
  const unique = [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 500);
  if (!unique.length) throw new ServiceError(400, 'Choose at least one applicant');
  const rows = await db('rec_applications').whereIn('id', unique).select('id', 'resume_file');
  const sizes = await storageBytes(db, rows);
  let deleted = 0; let freed = 0; const failed: number[] = [];
  for (const r of rows) {
    try { await deleteCandidate(db, Number(r.id)); deleted++; freed += sizes.get(Number(r.id)) ?? 0; }
    catch { failed.push(Number(r.id)); }
  }
  console.log(`[recruitment] ${actor.name} deleted ${deleted} applicant(s)`);
  return { deleted, freed_bytes: freed, failed };
}

// Signed, short-lived media links: a <video> tag cannot send the login header, so playback uses a link that only
// works for this file, for a few minutes.
// No fallback: without the server secret, links are refused rather than signed with a guessable key
const secret = () => { const s = process.env.JWT_SECRET; if (!s) throw new ServiceError(500, 'Media links are not configured on this server'); return s; };
// Recordings: long enough to watch a whole interview without the link running out (the page also re-fetches on expiry)
export function signMedia(kind: 'recording' | 'audio' | 'final' | 'resume', id: number, seg: number, ttlSec = kind === 'resume' ? 600 : 4 * 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = crypto.createHmac('sha256', secret()).update(`${kind}:${id}:${seg}:${exp}`).digest('base64url');
  return `${kind}/${id}/${seg}?exp=${exp}&sig=${sig}`;
}
export function checkMedia(kind: string, id: number, seg: number, exp: number, sig: string): boolean {
  if (!(exp > Date.now() / 1000) || !process.env.JWT_SECRET) return false;
  const want = crypto.createHmac('sha256', secret()).update(`${kind}:${id}:${seg}:${exp}`).digest('base64url');
  return sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want));
}
