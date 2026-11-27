// Final-interview feedback from the interviewers (any staff member assigned to a candidate's final interview).
// Interviewers rate and recommend; the admin makes the final decision (shortlist or reject) regardless of the recommendations.
import { Knex } from 'knex';
import { createNotification } from '../db';
import * as R from './recruitment';
import { ServiceError } from './access';

const CLOSED = ['selected', 'rejected', 'withdrawn'];

export async function ensureFeedbackSchema(db: Knex): Promise<void> {
  if (await db.schema.hasTable('rec_interview_feedback')) return;
  await db.schema.createTable('rec_interview_feedback', (t) => {
    t.increments('id').primary();
    t.integer('application_id').unsigned().notNullable().index();
    t.integer('schedule_id').unsigned().notNullable();
    t.integer('user_id').unsigned().notNullable();
    t.string('user_name', 120).nullable();
    t.integer('rating').notNullable();                    // 1–5
    t.string('recommendation', 10).notNullable();         // approve | reject
    t.text('notes').nullable();
    t.timestamp('created_at').defaultTo(db.fn.now());
    t.timestamp('updated_at').defaultTo(db.fn.now());
    t.unique(['schedule_id', 'user_id']);
  });
}

const isInterviewer = (s: any, userId: number) => {
  try { return (JSON.parse(s.interviewers || '[]') as any[]).some((p) => Number(p.id) === Number(userId)); } catch { return false; }
};

/** The interviews this person takes, newest first, with what they need (never salary details). */
export async function myInterviews(db: Knex, actor: R.Actor) {
  // shortcut: LIKE narrows the rows, the JSON check below decides; fine for the few hundred schedules we have
  const rows = (await db('rec_schedules as s').join('rec_applications as a', 'a.id', 's.application_id').leftJoin('rec_jobs as j', 'j.id', 'a.job_id')
    .whereIn('s.status', ['scheduled', 'completed']).where('s.interviewers', 'like', `%${actor.id}%`)
    .select('s.*', 'a.name as candidate', 'a.ref', 'a.status as app_status', 'a.experience_years', 'a.resume_file', 'j.title as job')
    .orderBy('s.date', 'desc')).filter((s: any) => isInterviewer(s, actor.id));
  const mine = rows.length ? await db('rec_interview_feedback').whereIn('schedule_id', rows.map((s: any) => s.id)).where({ user_id: actor.id }) : [];
  return rows.map((s: any) => {
    const fb = mine.find((f: any) => Number(f.schedule_id) === Number(s.id));
    return {
      schedule_id: s.id, application_id: s.application_id, candidate: s.candidate, ref: s.ref, job: s.job ?? '',
      experience_years: s.experience_years, type: s.type, date: String(s.date).slice(0, 10), start_time: s.start_time, end_time: s.end_time,
      meeting_url: s.meeting_url, location: s.location, address: s.address, interview_status: s.status,
      decision: CLOSED.includes(s.app_status) ? (R.STATUS_LABEL[s.app_status] ?? s.app_status) : null,
      has_resume: !!s.resume_file,
      feedback: fb ? { rating: fb.rating, recommendation: fb.recommendation, notes: fb.notes, updated_at: fb.updated_at } : null,
    };
  });
}

async function mySchedule(db: Knex, actor: R.Actor, scheduleId: number) {
  const s = await db('rec_schedules').where({ id: scheduleId }).first();
  if (!s || !isInterviewer(s, actor.id)) throw new ServiceError(404, 'Interview not found');
  return s;
}

/** A short-lived link to the candidate's resume, for this interview's interviewers. */
export async function interviewerResumeLink(db: Knex, actor: R.Actor, scheduleId: number) {
  const s = await mySchedule(db, actor, scheduleId);
  await R.audit(db, { application_id: s.application_id, action: 'resume_opened', actor });
  return { url: `/api/recruitment/media/${R.signMedia('resume', Number(s.application_id), 0)}` };
}

/** Save (or update) this interviewer's rating and recommendation. Allowed until the admin's final decision. */
export async function submitFeedback(db: Knex, actor: R.Actor, scheduleId: number, body: any) {
  const s = await mySchedule(db, actor, scheduleId);
  const a = await db('rec_applications').where({ id: s.application_id }).first('id', 'name', 'ref', 'status');
  if (!a || CLOSED.includes(a.status)) throw new ServiceError(409, 'The final decision has already been made for this candidate');
  const rating = Number(body?.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new ServiceError(400, 'Please rate the candidate from 1 to 5');
  const recommendation = body?.recommendation === 'approve' || body?.recommendation === 'reject' ? body.recommendation : null;
  if (!recommendation) throw new ServiceError(400, 'Please choose approve or reject');
  const notes = String(body?.notes ?? '').trim().slice(0, 4000);
  if (!notes) throw new ServiceError(400, 'Please add a few notes on how the interview went');
  const prev = await db('rec_interview_feedback').where({ schedule_id: s.id, user_id: actor.id }).first();
  const row = { rating, recommendation, notes, user_name: actor.name, updated_at: new Date() };
  if (prev) await db('rec_interview_feedback').where({ id: prev.id }).update(row);
  else await db('rec_interview_feedback').insert({ ...row, application_id: a.id, schedule_id: s.id, user_id: actor.id });
  await R.log(db, { application_id: a.id, action: 'interviewer_feedback', actor, comment: `${prev ? 'Updated: ' : ''}${rating}/5, recommends ${recommendation === 'approve' ? 'approving' : 'rejecting'}` });
  if (!prev) for (const u of await db('users').where({ role: 'admin' }).pluck('id')) await createNotification(u, `${actor.name} sent interview feedback for ${a.name} (${a.ref}): ${rating}/5, ${recommendation === 'approve' ? 'approve' : 'reject'}`, 'recruitment');
  return { ok: true };
}

/** All interviewers' feedback on one application, for the admin's decision. */
export async function feedbackFor(db: Knex, applicationId: number) {
  return db('rec_interview_feedback').where({ application_id: applicationId }).orderBy('updated_at', 'desc')
    .select('id', 'user_id', 'user_name', 'rating', 'recommendation', 'notes', 'updated_at');
}
