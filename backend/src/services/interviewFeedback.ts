// Final-interview feedback from the interviewers (any staff member assigned to a candidate's final interview).
// Interviewers rate and recommend; the admin makes the final decision (shortlist or reject) regardless of the recommendations.
import { Knex } from 'knex';
import { createNotification } from '../db';
import * as R from './recruitment';
import { ServiceError } from './access';

const CLOSED = ['selected', 'rejected', 'withdrawn'];

// Why an interviewer can't give feedback (the interview didn't happen as planned)
export const ISSUE_REASONS: Record<string, string> = {
  no_show: 'Candidate did not attend',
  candidate_late: 'Candidate came too late to interview',
  interviewer_unavailable: 'I could not take the interview',
  technical: 'Technical problems (could not connect)',
  postponed: 'Interview was postponed',
  other: 'Other',
};
// These mean the interview itself didn't happen, so they cover every interviewer on it (the rest are personal)
export const WHOLE_INTERVIEW_ISSUES = ['no_show', 'candidate_late', 'technical', 'postponed'];
const slotOf = (s: any) => `${String(s.date).slice(0, 10)} ${s.start_time}`;

export async function ensureFeedbackSchema(db: Knex): Promise<void> {
  if (!(await db.schema.hasTable('rec_interview_issues'))) {
    await db.schema.createTable('rec_interview_issues', (t) => {
      t.increments('id').primary();
      t.integer('application_id').unsigned().notNullable().index();
      t.integer('schedule_id').unsigned().notNullable();
      t.integer('user_id').unsigned().notNullable();
      t.string('user_name', 120).nullable();
      t.string('reason', 40).notNullable();
      t.text('note').nullable();
      t.timestamp('created_at').defaultTo(db.fn.now());
      t.timestamp('updated_at').defaultTo(db.fn.now());
      t.unique(['schedule_id', 'user_id']);
    });
  }
  // A reported problem stays open until it is dealt with (new time, cancelled, decided, or marked handled)
  // Which interview time the report was about: a new time starts fresh
  if (!(await db.schema.hasColumn('rec_interview_issues', 'slot'))) await db.schema.alterTable('rec_interview_issues', (t) => { t.string('slot', 20).nullable(); });
  // Reports made before the time was stored: about the time the interview has now
  if (await db.schema.hasTable('rec_schedules')) {
    for (const i of await db('rec_interview_issues as i').join('rec_schedules as s', 's.id', 'i.schedule_id').whereNull('i.slot').select('i.id', 's.date', 's.start_time')) {
      await db('rec_interview_issues').where({ id: i.id }).update({ slot: slotOf(i) });
    }
  }
  if (!(await db.schema.hasColumn('rec_interview_issues', 'resolved_at'))) {
    await db.schema.alterTable('rec_interview_issues', (t) => { t.timestamp('resolved_at').nullable(); t.string('resolved_by_name', 120).nullable(); t.string('resolution', 200).nullable(); });
  }
  if (await db.schema.hasTable('rec_interview_issues') && await db.schema.hasTable('rec_interview_feedback')) return;
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
  const allIssues = rows.length ? await db('rec_interview_issues').whereIn('schedule_id', rows.map((s: any) => s.id)) : [];
  // An admin's decision is final, so they see what the other interviewers said (others never see each other's)
  const teamFb = actor.role === 'admin' && rows.length ? await db('rec_interview_feedback').whereIn('schedule_id', rows.map((s: any) => s.id)).whereNot({ user_id: actor.id }) : [];
  const issues = allIssues.filter((i: any) => Number(i.user_id) === Number(actor.id));
  return rows.map((s: any) => {
    const fb = mine.find((f: any) => Number(f.schedule_id) === Number(s.id));
    return {
      schedule_id: s.id, application_id: s.application_id, candidate: s.candidate, ref: s.ref, job: s.job ?? '',
      experience_years: s.experience_years, type: s.type, date: String(s.date).slice(0, 10), start_time: s.start_time, end_time: s.end_time,
      meeting_url: s.meeting_url, location: s.location, address: s.address, interview_status: s.status,
      decision: CLOSED.includes(s.app_status) ? (R.STATUS_LABEL[s.app_status] ?? s.app_status) : null,
      has_resume: !!s.resume_file,
      feedback: fb ? { rating: fb.rating, recommendation: fb.recommendation, notes: fb.notes, updated_at: fb.updated_at } : null,
      issue: (() => { const i = issues.find((x: any) => Number(x.schedule_id) === Number(s.id)); return i ? { reason: i.reason, label: ISSUE_REASONS[i.reason] ?? i.reason, note: i.note } : null; })(),
      team: actor.role === 'admin' ? {
        feedback: teamFb.filter((f: any) => Number(f.schedule_id) === Number(s.id)).map((f: any) => ({ by: f.user_name, rating: f.rating, recommendation: f.recommendation, notes: f.notes })),
        issues: allIssues.filter((i: any) => Number(i.schedule_id) === Number(s.id) && Number(i.user_id) !== Number(actor.id)).map((i: any) => ({ by: i.user_name, label: ISSUE_REASONS[i.reason] ?? i.reason, note: i.note })),
      } : null,
      // A colleague said the interview didn't happen (e.g. the candidate didn't come): this person needn't send anything
      team_issue: (() => {
        const i = allIssues.find((x: any) => Number(x.schedule_id) === Number(s.id) && Number(x.user_id) !== Number(actor.id) && WHOLE_INTERVIEW_ISSUES.includes(x.reason) && x.slot === slotOf(s));
        return i ? { by: i.user_name, label: ISSUE_REASONS[i.reason] ?? i.reason, note: i.note } : null;
      })(),
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
  // No notification: admins see it on the candidate in Recruitment (they're only notified as interviewers)
  return { ok: true };
}

/** All interviewers' feedback on one application, for the admin's decision. */
export async function feedbackFor(db: Knex, applicationId: number) {
  return db('rec_interview_feedback').where({ application_id: applicationId }).orderBy('updated_at', 'desc')
    .select('id', 'user_id', 'user_name', 'rating', 'recommendation', 'notes', 'updated_at');
}

/** The interview didn't go as planned (e.g. the candidate didn't come): recorded instead of an evaluation. */
export async function reportIssue(db: Knex, actor: R.Actor, scheduleId: number, body: any) {
  const s = await mySchedule(db, actor, scheduleId);
  const a = await db('rec_applications').where({ id: s.application_id }).first('id', 'name', 'ref', 'status');
  if (!a || CLOSED.includes(a.status)) throw new ServiceError(409, 'The final decision has already been made for this candidate');
  const reason = String(body?.reason ?? '');
  if (!ISSUE_REASONS[reason]) throw new ServiceError(400, 'Please choose what happened');
  const note = String(body?.note ?? '').trim().slice(0, 2000);
  if (reason === 'other' && !note) throw new ServiceError(400, 'Please tell us what happened');
  const prev = await db('rec_interview_issues').where({ schedule_id: s.id, user_id: actor.id }).first();
  const row = { reason, note: note || null, user_name: actor.name, slot: slotOf(s), updated_at: new Date(), resolved_at: null, resolved_by_name: null, resolution: null };
  if (prev) await db('rec_interview_issues').where({ id: prev.id }).update(row);
  else await db('rec_interview_issues').insert({ ...row, application_id: a.id, schedule_id: s.id, user_id: actor.id });
  await R.log(db, { application_id: a.id, action: 'interview_issue', actor, comment: `${ISSUE_REASONS[reason]}${note ? ` · ${note}` : ''}` });
  // Managers are told; admins see it under Recruitment → Interview problems
  for (const u of await db('users').where({ role: 'manager' }).whereNot({ id: actor.id }).pluck('id')) {
    await createNotification(u, `${actor.name} reported a problem with the interview of ${a.name} (${a.ref}): ${ISSUE_REASONS[reason]}`, 'recruitment');
  }
  return { ok: true };
}

/** Problems interviewers reported for one application, for admins and managers. */
export async function issuesFor(db: Knex, applicationId: number) {
  return (await db('rec_interview_issues').where({ application_id: applicationId }).orderBy('updated_at', 'desc')
    .select('id', 'user_id', 'user_name', 'reason', 'note', 'updated_at', 'resolved_at', 'resolved_by_name', 'resolution')).map((i: any) => ({ ...i, label: ISSUE_REASONS[i.reason] ?? i.reason, open: !i.resolved_at }));
}

/** Close the open problems of an application (called when staff act on it, or by "Mark as handled"). */
export async function resolveIssues(db: Knex, applicationId: number, actor: { name?: string } | null, resolution: string, issueId?: number) {
  if (!(await db.schema.hasTable('rec_interview_issues'))) return 0;
  const q = db('rec_interview_issues').where({ application_id: applicationId }).whereNull('resolved_at');
  if (issueId) q.where({ id: issueId });
  return q.update({ resolved_at: new Date(), resolved_by_name: actor?.name ?? null, resolution: resolution.slice(0, 200) });
}
export const openIssueApps = (db: Knex) => db('rec_interview_issues').whereNull('resolved_at').select('application_id');

/** For each application: who on its current final interview has responded (feedback or a reported problem) and who hasn't. */
export async function feedbackProgress(db: Knex, appIds: number[]) {
  const out = new Map<number, { done: string[]; waiting: string[] }>();
  if (!appIds.length) return out;
  const schedules = await db('rec_schedules').whereIn('application_id', appIds).whereIn('status', ['scheduled', 'completed']).orderBy('id', 'desc');
  const ids = schedules.map((s: any) => s.id);
  const fb = ids.length ? await db('rec_interview_feedback').whereIn('schedule_id', ids).select('schedule_id', 'user_id') : [];
  const iss = ids.length ? await db('rec_interview_issues').whereIn('schedule_id', ids).select('schedule_id', 'user_id', 'reason', 'slot') : [];
  for (const s of schedules) {
    if (out.has(Number(s.application_id))) continue;   // newest interview only
    let people: any[] = []; try { people = JSON.parse(s.interviewers || '[]'); } catch { /* none */ }
    if (!people.length) continue;
    const slot = slotOf(s);
    const mine = iss.filter((i: any) => Number(i.schedule_id) === Number(s.id) && i.slot === slot);
    const whole = mine.some((i: any) => WHOLE_INTERVIEW_ISSUES.includes(i.reason));
    const answered = new Set([...fb.filter((f: any) => Number(f.schedule_id) === Number(s.id)), ...mine].map((x: any) => Number(x.user_id)));
    out.set(Number(s.application_id), {
      done: people.filter((p) => whole || answered.has(Number(p.id))).map((p) => p.name),
      waiting: people.filter((p) => !whole && !answered.has(Number(p.id))).map((p) => p.name),
    });
  }
  return out;
}
/** Final-interview candidates every interviewer has responded to: the admin can decide now. */
export async function readyToDecide(db: Knex): Promise<number[]> {
  const apps = (await db('rec_applications').whereIn('status', ['final_scheduled', 'final_completed']).pluck('id')).map(Number);
  const p = await feedbackProgress(db, apps);
  return apps.filter((id) => { const x = p.get(id); return !!x && x.done.length > 0 && x.waiting.length === 0; });
}

/** Every candidate someone has to act on now, for this person's role (managers don't see admin-only steps). */
export async function needsActionIds(db: Knex, role: string): Promise<number[]> {
  const steps = ['applied', 'under_review', 'interview_review', 'prelim_approved', ...(role === 'admin' ? ['admin_review', 'interview_admin_review'] : [])];
  const ids = new Set<number>((await db('rec_applications').whereIn('status', steps).pluck('id')).map(Number));
  for (const id of await db('rec_reschedule_requests as r').join('rec_applications as a', 'a.id', 'r.application_id').where('r.status', 'pending').where('a.status', 'final_scheduled').pluck('r.application_id')) ids.add(Number(id));
  for (const id of await db('rec_interview_issues as i').join('rec_applications as a', 'a.id', 'i.application_id').whereNull('i.resolved_at').whereNotIn('a.status', ['selected', 'rejected', 'withdrawn']).pluck('i.application_id')) ids.add(Number(id));
  if (role === 'admin') for (const id of await readyToDecide(db)) ids.add(id);   // only an admin decides
  return [...ids];
}
