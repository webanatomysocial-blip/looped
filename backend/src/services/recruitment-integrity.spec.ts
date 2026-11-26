/// <reference types="node" />
// Interview integrity: warnings for rule breaks (each counted once), the pause past the limit, serious incidents,
// and the review where managers recommend and only admins decide. In-memory database; nothing is sent.
import os from 'os';
import fs from 'fs';
import path from 'path';
process.env.SQLITE_FILE = ':memory:';
process.env.RECRUITMENT_STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-integrity-'));
process.env.RECRUITMENT_EMAILS = 'off';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDB, getDB } from '../db';
import * as R from './recruitment';

const admin = { id: 1, role: 'admin', name: 'Admin' } as R.Actor;
const mgr = { id: 2, role: 'manager', name: 'Mgr' } as R.Actor;
const noMail: R.Mailer = { interviewInvite: async () => undefined, scheduled: async () => undefined, cancelled: async () => undefined, selected: async () => undefined, welcome: async () => undefined };
let role = 0; let n = 0;
const db = () => getDB();

before(async () => {
  await initDB();
  [role] = await db()('rec_roles').insert({ name: 'Integrity role' });
  await db()('rec_questions').insert([{ department_id: role, category: 'G', text: 'Q1', active: true }, { department_id: role, category: 'G', text: 'Q2', active: true }]);
});
after(() => { getDB().destroy(); });

async function live() {
  const [jid] = await db()('rec_jobs').insert({ public_id: `int-${++n}`, title: `Integrity ${n}`, role_id: role, status: 'published' });
  const job = await db()('rec_jobs').where({ id: jid }).first();
  const { ref } = await R.submitApplication(db(), job.public_id, { name: 'C', email: `c${n}@x.test`, phone: `98000000${String(n).padStart(2, '0')}`, experience_years: 1, current_ctc: '4 LPA', expected_ctc: '6 LPA', interview_mode: 'walkin' }, { file: 'r.pdf', name: 'r.pdf', mime: 'application/pdf' }, noMail);
  const a = await db()('rec_applications').where({ ref }).first();
  await R.startInterview(db(), a, { accepted: true, version: 'v1' });
  const iv = await db()('rec_interviews').where({ application_id: a.id }).first();
  return { a, iv, job };
}
let clock = Date.now() - 600_000;
const away = (secs: number) => ({ type: 'tab_visible', detail: `away ${secs} s`, at: new Date(clock += 1000).toISOString() });
const ivOf = (id: number) => db()('rec_interviews').where({ id }).first();

test('warnings 1, 2, 3 then a pause on the 4th; each a different message; the application is never rejected', async () => {
  const { a, iv } = await live();
  const w1: any = (await R.recordEvents(db(), a, [away(20)])).warning;
  assert.equal(w1.count, 1); assert.equal(w1.level, 'first'); assert.match(w1.message, /Warning 1 of 3/);
  const w2: any = (await R.recordEvents(db(), a, [away(20)])).warning;
  assert.equal(w2.level, 'strong'); assert.match(w2.message, /may be paused/);
  const w3: any = (await R.recordEvents(db(), a, [away(20)])).warning;
  assert.equal(w3.level, 'final'); assert.match(w3.message, /Final warning \(3 of 3\)[\s\S]*One more violation will pause/);
  assert.equal((await ivOf(iv.id)).integrity_status, 'monitoring', 'marked for closer monitoring at the final warning');
  const w4: any = (await R.recordEvents(db(), a, [away(20)])).warning;
  assert.equal(w4.paused, true); assert.equal(w4.message, R.PAUSED_MESSAGE);
  const after = await ivOf(iv.id);
  assert.equal(after.status, 'paused'); assert.equal(after.integrity_status, 'integrity_review_required'); assert.equal(after.paused_by, 'auto'); assert.equal(after.warnings, 4);
  assert.equal((await db()('rec_applications').where({ id: a.id }).first()).status, 'prelim_pending', 'not rejected');
  assert.ok(await db()('rec_history').where({ application_id: a.id, action: 'interview_paused' }).first());
  assert.ok(await db()('notifications').where('message', 'like', '%paused for integrity review%').first(), 'admins and managers notified');
});

test('while paused: no answers, no submit, no events; uploads already recorded are still accepted; refresh shows the pause', async () => {
  const { a, iv } = await live();
  for (let i = 0; i < 4; i++) await R.recordEvents(db(), a, [away(30)]);
  await assert.rejects(R.nextQuestion(db(), a, 0), (e: any) => e.status === 423 && /paused/.test(e.message));
  await assert.rejects(R.submitInterview(db(), a), /paused/);
  await assert.rejects(R.recordEvents(db(), a, [away(30)]), /paused/);
  await R.saveChunk(db(), a, 0, 0, false, Buffer.alloc(30_000, 1), 'video/webm', 1000);   // the tail of the recording is kept
  const st = await R.interviewState(db(), a);
  assert.equal(st.state, 'paused'); assert.equal(st.paused_message, R.PAUSED_MESSAGE); assert.equal(st.warnings.count, 4);
  void iv;
});

test('the limit is configurable by an admin setting', async () => {
  await R.saveSettings(db(), { max_warnings: 1 } as any);
  try {
    const { a, iv } = await live();
    assert.equal(((await R.recordEvents(db(), a, [away(20)])).warning as any).level, 'final');
    assert.equal(((await R.recordEvents(db(), a, [away(20)])).warning as any).paused, true);
    assert.equal((await ivOf(iv.id)).status, 'paused');
    await assert.rejects(R.saveSettings(db(), { max_warnings: 0 } as any), /between 1 and 10/);
  } finally { await R.saveSettings(db(), { max_warnings: 3 } as any); }
});

test('the same event delivered twice counts once; short absences and technical problems never count', async () => {
  const { a, iv } = await live();
  const e = away(25);
  await R.recordEvents(db(), a, [e]); await R.recordEvents(db(), a, [e, e]);
  assert.equal((await ivOf(iv.id)).warnings, 1);
  const r = await R.recordEvents(db(), a, [away(3), { type: 'network_offline', at: new Date().toISOString() }, { type: 'camera_lost', at: new Date().toISOString() },
    { type: 'microphone_lost', at: new Date().toISOString() }, { type: 'recording_interrupted', at: new Date().toISOString() }, { type: 'fullscreen_exit', at: new Date().toISOString() }]);
  assert.equal(r.warning, null, 'below the away limit, technical, and fullscreen not required by default');
  await R.heartbeat(db(), a, undefined);
  await db()('rec_interviews').where({ id: iv.id }).update({ last_seen_at: new Date(Date.now() - 120_000) });
  await R.heartbeat(db(), a, undefined);   // a connection gap: recorded, not a warning
  assert.equal((await ivOf(iv.id)).warnings, 1);
});

test('a serious incident (another device at the same time) pauses at once for review, before three warnings', async () => {
  const { a, iv } = await live();
  await R.claimSession(db(), a, 'device-one-xx');
  await R.claimSession(db(), a, 'device-two-yy');
  const x = await ivOf(iv.id);
  assert.equal(x.status, 'paused'); assert.equal(x.integrity_status, 'integrity_review_required'); assert.equal(x.warnings, 1);
  assert.ok((await db()('rec_incidents').where({ interview_id: iv.id, kind: 'session_conflict' }).first()).serious);
});

test('admin resumes (with a reason) or closes; a manager cannot; the question timer restarts after a resume', async () => {
  const { a, iv } = await live();
  for (let i = 0; i < 4; i++) await R.recordEvents(db(), a, [away(30)]);
  await assert.rejects(R.resumeInterview(db(), mgr, iv.id, 'ok'), /Only an admin/);
  await assert.rejects(R.resumeInterview(db(), admin, iv.id, ' '), /reason/);
  await R.resumeInterview(db(), admin, iv.id, 'Spoke to the candidate: power cut');
  assert.equal((await ivOf(iv.id)).status, 'in_progress');
  assert.equal((await R.interviewState(db(), a)).current.seconds_left, iv.seconds_per_question);
  await assert.rejects(R.terminateInterview(db(), mgr, iv.id, 'x'), /Only an admin/);
  await R.terminateInterview(db(), admin, iv.id, 'Closed after review');
  assert.equal((await ivOf(iv.id)).status, 'terminated');
  await assert.rejects(R.byInterviewToken(db(), 'x'.repeat(43)), /not valid/);
  const acts = (await db()('rec_history').where({ application_id: a.id }).pluck('action'));
  assert.ok(acts.includes('interview_resumed') && acts.includes('interview_terminated'));
});

test('only an admin decides (a manager is refused); a reason is required; dismissed or technical incidents stop counting', async () => {
  const { a, iv } = await live();
  for (let i = 0; i < 2; i++) await R.recordEvents(db(), a, [away(30)]);
  await assert.rejects(R.reviewIntegrity(db(), mgr, iv.id, { outcome: 'confirmed', reason: 'Looks like reading notes' }), /Only an admin/);
  assert.equal((await ivOf(iv.id)).integrity_status, null, 'a manager changes nothing');
  await assert.rejects(R.reviewIntegrity(db(), admin, iv.id, { outcome: 'confirmed', reason: '' }), /reason/);
  await R.reviewIntegrity(db(), admin, iv.id, { outcome: 'technical', reason: 'Laptop battery died' });
  const x = await ivOf(iv.id);
  assert.equal(x.integrity_status, 'technical'); assert.equal(x.warnings, 0, 'not counted any more');
  assert.equal((await db()('rec_applications').where({ id: a.id }).first()).status, 'prelim_pending', 'no rejection');
  for (const outcome of ['no_violation', 'insufficient']) { await R.reviewIntegrity(db(), admin, iv.id, { outcome, reason: 'Reviewed' }); assert.equal((await ivOf(iv.id)).warnings, 0); }
});

test('suspected incidents never start the three-month rule; a confirmed violation with rejection does, from the rejection', async () => {
  const { a, iv, job } = await live();
  for (let i = 0; i < 4; i++) await R.recordEvents(db(), a, [away(30)]);
  await R.reviewIntegrity(db(), admin, iv.id, { outcome: 'suspicious', reason: 'Needs a second look' });
  assert.equal(await R.reapplyBlockedUntil(db(), job, a.email, a.phone), null, 'paused and suspicious: no restriction');
  await R.reviewIntegrity(db(), admin, iv.id, { outcome: 'confirmed', reason: 'Second person visible answering', evidence: 'Recording 02:10–03:40', reject: true }, noMail);
  const app = await db()('rec_applications').where({ id: a.id }).first();
  assert.equal(app.status, 'rejected'); assert.equal(app.interview_hash, null);
  assert.equal((await ivOf(iv.id)).status, 'terminated');
  const until = await R.reapplyBlockedUntil(db(), job, a.email, a.phone);
  const rejectedAt = (await db()('rec_history').where({ application_id: a.id, to_status: 'rejected' }).first()).created_at;
  assert.ok(until && Math.abs(until.getTime() - R.addCalendarMonths(new Date(String(rejectedAt).includes('T') ? rejectedAt : String(rejectedAt).replace(' ', 'T') + 'Z'), 3).getTime()) < 2000);
  await assert.rejects(R.withdraw(db(), app), /already closed/, 'withdrawing cannot erase the rejection');
  const h = await db()('rec_history').where({ application_id: a.id, action: 'integrity_review' }).orderBy('id', 'desc').first();
  assert.equal(h.actor_role, 'admin'); assert.match(h.comment, /Second person visible[\s\S]*Evidence: Recording/);
  assert.equal((await db()('rec_incidents').where({ interview_id: iv.id }).first()).status, 'confirmed', 'evidence kept');
});

test('warnings and review status are stored, so a reload or a server restart keeps them', async () => {
  const { a, iv } = await live();
  await R.recordEvents(db(), a, [away(30)]);
  const fresh = await db()('rec_applications').where({ id: a.id }).first();   // as after a restart: read back from the database
  assert.equal((await R.interviewState(db(), fresh)).warnings.count, 1);
  assert.equal((await db()('rec_incidents').where({ interview_id: iv.id })).length, 1);
});

test('each question gets the second of the recording it appeared at (first question = 0:00)', async () => {
  const { iv } = await live();
  const t0 = new Date('2026-01-01T10:00:00Z');
  await db()('rec_interview_questions').where({ interview_id: iv.id, position: 0 }).update({ shown_at: t0 });
  await db()('rec_interview_questions').where({ interview_id: iv.id, position: 1 }).update({ shown_at: new Date(t0.getTime() + 95_000) });
  const q = await R.questionTimes(db(), await ivOf(iv.id));
  assert.deepEqual(q.slice(0, 2).map((x: any) => x.video_at), [0, 95]); assert.equal(q[2]?.video_at ?? null, null, 'not shown yet: no time');
});

test('scheduling records in the history whether the candidate email went out', async () => {
  const { a } = await live();
  await db()('rec_applications').where({ id: a.id }).update({ status: 'prelim_approved' });
  const mail = { ...noMail, scheduled: async () => 'FAILED to send to c@x.test (bad login)' };
  await R.schedule(db(), admin, a.id, { type: 'online', date: '2027-01-05', start_time: '10:00', end_time: '10:30', meeting_url: 'https://meet.example/abc' }, mail);
  const h = await db()('rec_history').where({ application_id: a.id, action: 'email' }).first();
  assert.match(h.comment, /Interview details email FAILED/);
});

test('reschedule request: the link in the email files a request; approving it through the form moves the interview', async () => {
  const { a } = await live();
  await db()('rec_applications').where({ id: a.id }).update({ status: 'prelim_approved' });
  let link = '';
  const mail = { ...noMail, scheduled: async (_a: any, _j: string, s: any) => { link = s.reschedule_link; return 'ok'; } };
  await R.schedule(db(), admin, a.id, { type: 'walkin', date: '2027-01-05', start_time: '10:00', end_time: '10:30', address: 'Office' }, mail);
  const token = link.split('/').pop()!;
  await assert.rejects(R.requestReschedule(db(), token, { date: '2027-01-09', start_time: '11:00', type: 'walkin' }), /reason/);
  const v = await R.requestReschedule(db(), token, { date: '2027-01-09', start_time: '11:00', type: 'walkin', reason: 'exam' });
  assert.equal(v.pending?.date, '2027-01-09');
  const req = await db()('rec_reschedule_requests').where({ application_id: a.id, status: 'pending' }).first();
  const s = await db()('rec_schedules').where({ application_id: a.id }).first();
  await R.schedule(db(), admin, a.id, { type: 'walkin', date: req.date, start_time: '11:00', end_time: '11:30', address: 'Office', request_id: req.id }, mail, s.id);
  assert.equal((await db()('rec_reschedule_requests').where({ id: req.id }).first()).status, 'approved');
  await assert.rejects(R.rescheduleView(db(), token), /no longer valid/, 'the old link stops after a new email');
});

test('a withdrawn application blocks reapplying for the same role for three months', async () => {
  const { a, job } = await live();
  await R.withdraw(db(), a);
  await assert.rejects(R.submitApplication(db(), job.public_id, { name: 'C', email: a.email, phone: a.phone, experience_years: 1, current_ctc: '4', expected_ctc: '6', interview_mode: 'walkin' }, { file: 'r.pdf', name: 'r.pdf', mime: 'application/pdf' }, noMail), /withdrawn[\s\S]*webanatomysocial@gmail\.com/);
});

test('lost interview link: re-sent only to the applicant, the old link stops, the reply is the same for unknown emails', async () => {
  const { a } = await live();
  await db()('rec_applications').where({ id: a.id }).update({ status: 'prelim_pending', interview_expires_at: new Date(Date.now() + 86_400_000) });
  const sent: string[] = [];
  const mail = { ...noMail, interviewInvite: async (x: any) => { sent.push(x.email); return 'ok'; } };
  const before = (await db()('rec_applications').where({ id: a.id }).first()).interview_hash;
  const r1 = await R.resendInterviewLinks(db(), a.email.toUpperCase(), mail);
  const r2 = await R.resendInterviewLinks(db(), 'nobody@x.test', mail);
  assert.deepEqual(sent, [a.email]);
  assert.notEqual((await db()('rec_applications').where({ id: a.id }).first()).interview_hash, before);
  assert.equal(r1.message.replace(a.email, 'E'), r2.message.replace('nobody@x.test', 'E'));
});

test('a rejected reschedule request stays open for a decision until a new time is sent, and can be approved instead', async () => {
  const { a } = await live();
  await db()('rec_applications').where({ id: a.id }).update({ status: 'prelim_approved' });
  let link = '';
  const mail = { ...noMail, scheduled: async (_a: any, _j: string, s: any) => { link = s.reschedule_link; return 'ok'; } };
  await R.schedule(db(), admin, a.id, { type: 'walkin', date: '2027-02-05', start_time: '10:00', end_time: '10:30', address: 'Office' }, mail);
  await R.requestReschedule(db(), link.split('/').pop()!, { date: '2027-02-09', start_time: '12:00', type: 'walkin', reason: 'travel' });
  const req = await db()('rec_reschedule_requests').where({ application_id: a.id }).first();
  await R.rejectRescheduleRequest(db(), admin, a.id, req.id, 'busy');
  assert.equal((await db()('rec_reschedule_requests').where({ id: req.id }).first()).followed_up_at, null, 'still waiting for a new time');
  const s = await db()('rec_schedules').where({ application_id: a.id }).first();
  await R.schedule(db(), admin, a.id, { type: 'walkin', date: '2027-02-09', start_time: '12:00', end_time: '12:30', address: 'Office', request_id: req.id }, mail, s.id);
  const after = await db()('rec_reschedule_requests').where({ id: req.id }).first();
  assert.equal(after.status, 'approved'); assert.ok(after.followed_up_at);
});

test('interviewers: rescheduled ones are told was → now, removed ones and a cancellation say "no longer needed"', async () => {
  const { a } = await live();
  await db()('rec_applications').where({ id: a.id }).update({ status: 'prelim_approved' });
  const [u1] = await db()('users').insert({ name: 'Iv One', email: `iv1-${a.id}@x.test`, password_hash: 'x', role: 'employee' });
  const [u2] = await db()('users').insert({ name: 'Iv Two', email: `iv2-${a.id}@x.test`, password_hash: 'x', role: 'employee' });
  const [u3] = await db()('users').insert({ name: 'Iv Three', email: `iv3-${a.id}@x.test`, password_hash: 'x', role: 'employee' });
  await R.schedule(db(), admin, a.id, { type: 'walkin', date: '2027-03-05', start_time: '10:00', end_time: '10:30', address: 'Office', interviewer_ids: [u1, u2] }, noMail);
  const s = await db()('rec_schedules').where({ application_id: a.id }).first();
  await R.schedule(db(), admin, a.id, { type: 'walkin', date: '2027-03-07', start_time: '11:00', end_time: '11:30', address: 'Office', interviewer_ids: [u1, u3] }, noMail, s.id);
  await R.cancelSchedule(db(), admin, a.id, s.id, 'candidate unwell', noMail);
  const mails = (await db()('rec_history').where({ application_id: a.id, action: 'email' }).pluck('comment')).filter((c: string) => c.startsWith('Interviewer email'));
  assert.equal(mails.filter((c: string) => c.includes('Iv Two (not needed)')).length, 1, 'removed in the reschedule');
  assert.equal(mails.filter((c: string) => /Iv (One|Three) \(not needed\)/.test(c)).length, 2, 'both told of the cancellation');
  assert.equal(mails.filter((c: string) => c.startsWith('Interviewer email to Iv One:')).length, 2, 'assigned, then rescheduled');
});

test('rejecting a candidate with a booked interview emails them (no reviewer comment) and frees the interviewers', async () => {
  const { a } = await live();
  await db()('rec_applications').where({ id: a.id }).update({ status: 'prelim_approved' });
  const [u1] = await db()('users').insert({ name: 'Iv Rej', email: `ivr-${a.id}@x.test`, password_hash: 'x', role: 'employee' });
  await R.schedule(db(), admin, a.id, { type: 'walkin', date: '2027-04-05', start_time: '10:00', end_time: '10:30', address: 'Office', interviewer_ids: [u1] }, noMail);
  let got: any = null;
  await R.act(db(), admin, a.id, 'reject', 'internal: weak answers', { ...noMail, rejected: async (x: any, job: string) => { got = { x, job }; return 'sent'; } });
  assert.equal(got?.x.email, a.email);
  const h = await db()('rec_history').where({ application_id: a.id, action: 'email' }).pluck('comment');
  assert.ok(h.includes('Rejection email sent'));
  assert.ok(h.some((c: string) => c.startsWith('Interviewer email to Iv Rej (not needed)')));
  assert.equal((await db()('rec_schedules').where({ application_id: a.id }).first()).status, 'cancelled');
});
