/// <reference types="node" />
// Recruitment rules from the audit: rejecting at every stage, new/extended interview links, the three-calendar-month
// reapplication rule with its admin override, India-time deadlines and all-or-nothing candidate deletion.
import os from 'os';
import fs from 'fs';
import path from 'path';
process.env.SQLITE_FILE = ':memory:';
process.env.RECRUITMENT_STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-rules-'));
process.env.RECRUITMENT_EMAILS = 'off';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDB, getDB } from '../db';
import * as R from './recruitment';

const admin = { id: 1, role: 'admin', name: 'Admin' } as R.Actor;
const mgr = { id: 2, role: 'manager', name: 'Mgr' } as R.Actor;
const noMail: R.Mailer = { interviewInvite: async () => undefined, scheduled: async () => undefined, cancelled: async () => undefined, selected: async () => undefined, welcome: async () => undefined };
let jobA: any, jobB: any, jobA2: any; let n = 0;
const RESUME = { file: 'r.pdf', name: 'r.pdf', mime: 'application/pdf' };
const person = (email: string, phone = '+91 98765 43210') => ({ name: 'Asha', email, phone, experience_years: 1, current_ctc: '4 LPA', expected_ctc: '6 LPA', interview_mode: 'walkin' });

before(async () => {
  await initDB();
  const d = getDB();
  const job = async (title: string) => { const [id] = await d('rec_jobs').insert({ public_id: `job-${++n}`, title, status: 'published' }); return d('rec_jobs').where({ id }).first(); };
  jobA = await job('Web Developer'); jobB = await job('SEO Specialist');
  jobA2 = await job(' web developer ');   // the same role, posted again as a new opening
});
after(() => { getDB().destroy(); });

const apply = (job: any, email: string, phone?: string) => R.submitApplication(getDB(), job.public_id, person(email, phone), RESUME);
const app = (ref: string) => getDB()('rec_applications').where({ ref }).first();
async function at(ref: string, status: string, extra: object = {}) { await getDB()('rec_applications').where({ ref }).update({ status, ...extra }); return app(ref); }
// Rejected at a given moment (the history row is what the rule reads)
async function rejectedAt(ref: string, when: Date) {
  const a = await at(ref, 'rejected');
  await getDB()('rec_history').insert({ application_id: a.id, action: 'reject', from_status: 'under_review', to_status: 'rejected', actor_id: 1, actor_name: 'Admin', actor_role: 'admin', created_at: when });
  return a;
}

test('an admin can reject at every stage where candidates used to be stuck; a manager cannot; the reason is recorded', async () => {
  for (const status of ['prelim_pending', 'prelim_approved', 'final_scheduled']) {
    const { ref } = await apply(jobB, `stuck-${status}@x.test`, `90000000${n++}`);
    const a = await at(ref, status, status === 'prelim_pending' ? { interview_hash: 'h'.repeat(64), interview_expires_at: new Date(Date.now() - 1000) } : {});
    if (status === 'final_scheduled') await getDB()('rec_schedules').insert({ application_id: a.id, type: 'online', date: '2099-01-01', start_time: '10:00', end_time: '11:00', meeting_url: 'https://m.x/1', status: 'scheduled' });
    await assert.rejects(R.act(getDB(), mgr, a.id, 'reject', 'no'), /Only an admin/);
    await assert.rejects(R.act(getDB(), admin, a.id, 'reject', ''), /reason/);
    if (status === 'final_scheduled') await assert.rejects(R.act(getDB(), mgr, a.id, 'approve'), /Only an admin/, 'the final decision is the admin\'s');
    else await assert.rejects(R.act(getDB(), admin, a.id, 'approve'), /No decision/, 'no approval sneaks in at these stages');
    assert.equal((await R.act(getDB(), admin, a.id, 'reject', 'Did not attend', noMail)).status, 'rejected');
    const after = await app(ref);
    assert.equal(after.status, 'rejected'); assert.equal(after.interview_hash, null, 'an open interview link stops working');
    const h = await getDB()('rec_history').where({ application_id: a.id, to_status: 'rejected' }).first();
    assert.deepEqual([h.from_status, h.actor_role, h.comment], [status, 'admin', 'Did not attend']);
    if (status === 'final_scheduled') assert.equal((await getDB()('rec_schedules').where({ application_id: a.id }).first()).status, 'cancelled');
  }
});

test('interview links: an admin issues a new one (old stops working) or extends the current one; never after submission', async () => {
  const { ref } = await apply(jobB, 'link@x.test', '9111111111');
  const a = await at(ref, 'prelim_pending', { interview_hash: R.sha('old-token-old-token-old'), interview_expires_at: new Date(Date.now() - 86_400_000) });
  await assert.rejects(R.renewInterviewLink(getDB(), mgr, a.id, 'new', noMail), /Only an admin/);
  const r = await R.renewInterviewLink(getDB(), admin, a.id, 'new', noMail);
  assert.match(r.link!, /\/careers\/interview\/[\w-]{40,}$/);
  await assert.rejects(R.byInterviewToken(getDB(), 'old-token-old-token-old'), /not valid/, 'the old link is dead');
  const token = r.link!.split('/').pop()!;
  assert.equal((await R.byInterviewToken(getDB(), token)).id, a.id);
  // Extend keeps the same link and moves the expiry
  await getDB()('rec_applications').where({ id: a.id }).update({ interview_expires_at: new Date(Date.now() + 1000) });
  const e = await R.renewInterviewLink(getDB(), admin, a.id, 'extend', noMail);
  assert.equal(e.link, null); assert.equal((await R.byInterviewToken(getDB(), token)).id, a.id, 'same link still works');
  assert.ok(new Date((await app(ref)).interview_expires_at).getTime() > Date.now() + 86_400_000);
  const acts = (await getDB()('rec_history').where({ application_id: a.id }).orderBy('id')).map((x: any) => `${x.action}:${x.actor_name}`);
  assert.deepEqual(acts.slice(-2), ['interview_link_renewed:Admin', 'interview_link_extended:Admin']);
  // A started interview keeps its questions; a submitted one can't be reopened by a new link
  const live = await getDB()('rec_applications').where({ id: a.id }).first();
  const iv = await R.startInterview(getDB(), live, { accepted: true, version: 'v1' });
  await R.renewInterviewLink(getDB(), admin, a.id, 'new', noMail);
  assert.equal((await getDB()('rec_interviews').where({ application_id: a.id })).length, 1, 'no second interview session');
  assert.equal((await getDB()('rec_interviews').where({ id: iv.id }).first()).current_position, 0);
  await getDB()('rec_interviews').where({ id: iv.id }).update({ status: 'submitted' });
  await assert.rejects(R.renewInterviewLink(getDB(), admin, a.id, 'new', noMail), /already been submitted/);
});

test('three calendar months, not 90 days: month ends clamp, the time of day is kept', () => {
  const d = (s: string) => new Date(s);
  assert.equal(R.addCalendarMonths(d('2026-11-30T10:00:00Z'), 3).toISOString(), '2027-02-28T10:00:00.000Z');
  assert.equal(R.addCalendarMonths(d('2027-11-30T10:00:00Z'), 3).toISOString(), '2028-02-29T10:00:00.000Z', 'leap year');
  assert.equal(R.addCalendarMonths(d('2026-01-31T00:00:00Z'), 3).toISOString(), '2026-04-30T00:00:00.000Z');
  assert.equal(R.addCalendarMonths(d('2026-12-15T23:59:00Z'), 3).toISOString(), '2027-03-15T23:59:00.000Z', 'across a year');
});

test('a rejected candidate cannot apply for the same role for three months (by email in any case, or by phone); other roles are open', async () => {
  const { ref } = await apply(jobA, 'Ravi@Example.com', '+91 90000 11111');
  const rejected = new Date(Date.now() - 30 * 86_400_000);   // a month ago: still inside the three months
  await rejectedAt(ref, rejected);
  const until = R.addCalendarMonths(rejected, 3);
  // The exact boundary: blocked a moment before, free from that moment
  assert.ok(await R.reapplyBlockedUntil(getDB(), jobA, 'ravi@example.com', '', new Date(until.getTime() - 1)));
  assert.equal(await R.reapplyBlockedUntil(getDB(), jobA, 'ravi@example.com', '', until), null);
  const day = until.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
  await assert.rejects(apply(jobA, 'RAVI@example.COM', '+91 99999 00000'), new RegExp(`not selected[\\s\\S]*apply for it again from ${day}`), 'same email, other case; the message gives the date');
  await assert.rejects(apply(jobA2, 'someone.else@x.test', '090000-11111'), /apply for it again/, 'same phone, written differently, same role reposted');
  assert.ok(await apply(jobB, 'ravi@example.com', '+91 90000 11111'), 'another role is open right away');
});

test('a withdrawal with no recorded date does not block; a reopened application no longer counts', async () => {
  const { ref } = await apply(jobA, 'withdrew@x.test', '9222222222');
  await at(ref, 'withdrawn');
  assert.equal(await R.reapplyBlockedUntil(getDB(), jobA, 'withdrew@x.test', '9222222222'), null);
  assert.ok(await apply(jobA, 'withdrew@x.test', '9222222222'), 'same job again after withdrawing');
  const { ref: r2 } = await apply(jobA, 'reopened@x.test', '9333333333');
  await rejectedAt(r2, new Date());
  await at(r2, 'under_review');   // reopened by an admin
  assert.equal(await R.reapplyBlockedUntil(getDB(), jobA, 'reopened@x.test', ''), null);
});

test('only an admin may let a rejected candidate reapply early; it needs a reason and is recorded', async () => {
  const { ref } = await apply(jobA, 'override@x.test', '9444444444');
  const a = await rejectedAt(ref, new Date());
  await assert.rejects(apply(jobA, 'override@x.test', '9444444444'), /apply for it again/);
  await assert.rejects(R.allowReapply(getDB(), mgr, a.id, 'please'), /Only an admin/);
  await assert.rejects(R.allowReapply(getDB(), admin, a.id, ' '), /reason/);
  await R.allowReapply(getDB(), admin, a.id, 'Strong portfolio received');
  const h = await getDB()('rec_history').where({ application_id: a.id, action: 'reapply_allowed' }).first();
  assert.equal(h.actor_role, 'admin'); assert.equal(h.comment, 'Strong portfolio received'); assert.ok(h.override);
  assert.ok(await apply(jobA, 'override@x.test', '9444444444'), 'allowed now');
});

test('two applications sent at the same moment for the same job: only one is accepted', async () => {
  const results = await Promise.allSettled([apply(jobB, 'twice@x.test', '9555555555'), apply(jobB, 'twice@x.test', '9555555555'), apply(jobB, 'Twice@X.test', '9555555555')]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal((await getDB()('rec_applications').where({ job_id: jobB.id, email: 'twice@x.test' })).length, 1);
});

test('job deadlines follow the India calendar, not UTC', async () => {
  assert.equal(R.todayIST(new Date('2026-11-19T18:29:00Z')), '2026-11-19', '23:59 in India: still the 19th');
  assert.equal(R.todayIST(new Date('2026-11-19T18:31:00Z')), '2026-11-20', '00:01 in India: already the 20th (UTC still says the 19th)');
  const [id] = await getDB()('rec_jobs').insert({ public_id: 'closed-yesterday', title: 'Closed', status: 'published', deadline: '2000-01-01' });
  await assert.rejects(R.submitApplication(getDB(), 'closed-yesterday', person('late@x.test'), RESUME), /not open/);
  void id;
});

test('deleting a candidate is all or nothing: if the records cannot be deleted, the files stay', async () => {
  const { ref } = await apply(jobB, 'delete@x.test', '9666666666');
  const a = await app(ref);
  fs.writeFileSync(path.join(R.resumeDir(), a.resume_file), 'resume');
  // Make the database refuse part of the delete (a trigger aborts deleting this candidate's history)
  await getDB().raw(`CREATE TRIGGER no_delete BEFORE DELETE ON rec_history WHEN OLD.application_id = ${a.id} BEGIN SELECT RAISE(ABORT, 'blocked'); END`);
  await getDB()('rec_history').insert({ application_id: a.id, action: 'note', actor_role: 'admin' });
  await assert.rejects(R.deleteCandidate(getDB(), a.id), /blocked/);
  assert.ok(await app(ref), 'record still there'); assert.ok(fs.existsSync(path.join(R.resumeDir(), a.resume_file)), 'and its resume');
  await getDB().raw('DROP TRIGGER no_delete');
  await R.deleteCandidate(getDB(), a.id);
  assert.equal(await app(ref), undefined); assert.ok(!fs.existsSync(path.join(R.resumeDir(), a.resume_file)), 'files removed after the records');
});

test('media links are never signed without the server secret', () => {
  const saved = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;
  try {
    assert.throws(() => R.signMedia('resume', 1, 0), /not configured/);
    assert.equal(R.checkMedia('resume', 1, 0, Date.now() / 1000 + 60, 'x'), false);
  } finally { if (saved) process.env.JWT_SECRET = saved; }
});

test('storage per applicant is measured from disk; only an admin can delete several applicants at once, completely', async () => {
  const mk = async (email: string, phone: string) => { const { ref } = await apply(jobB, email, phone); const a = await app(ref); fs.writeFileSync(path.join(R.resumeDir(), a.resume_file), Buffer.alloc(2048)); return a; };
  const a1 = await mk('bulk1@x.test', '9777777771'); const a2 = await mk('bulk2@x.test', '9777777772'); const keep = await mk('keep@x.test', '9777777773');
  const iv = await R.startInterview(getDB(), await at(a1.ref, 'prelim_pending', { interview_expires_at: new Date(Date.now() + 86_400_000) }), { accepted: true, version: 'v1' });
  fs.mkdirSync(path.join(R.storageDir(), 'recordings', String(iv.id), 'segment-0'), { recursive: true });
  fs.writeFileSync(path.join(R.storageDir(), 'recordings', String(iv.id), 'segment-0', '000000.part'), Buffer.alloc(5000));
  const sizes = await R.storageBytes(getDB(), [a1, a2]);
  assert.equal(sizes.get(a1.id), 2048 + 5000, 'resume + recording');
  assert.equal(sizes.get(a2.id), 2048);
  await assert.rejects(R.deleteCandidates(getDB(), mgr, [a1.id]), /Only an admin/);
  await assert.rejects(R.deleteCandidates(getDB(), admin, []), /at least one/);
  const r = await R.deleteCandidates(getDB(), admin, [a1.id, a2.id, a1.id]);
  assert.deepEqual([r.deleted, r.freed_bytes, r.failed], [2, 2048 + 5000 + 2048, []]);
  assert.equal(await app(a1.ref), undefined); assert.equal(await app(a2.ref), undefined);
  assert.ok(!fs.existsSync(path.join(R.storageDir(), 'recordings', String(iv.id))), 'recording files gone');
  assert.ok(await app(keep.ref), 'others untouched');
});

test('once: openings and questions that pointed at Loop departments move to careers roles; Loop departments untouched', async () => {
  const d = getDB();
  const [cat] = await d('employee_categories').insert({ name: 'Legacy Role' });
  const loop = Number((await d('employee_categories').count({ n: '*' }).first() as any).n);
  const [job] = await d('rec_jobs').insert({ public_id: 'legacy-job', title: 'Legacy', status: 'draft', category_id: cat });
  const [q] = await d('rec_questions').insert({ category: 'General', text: 'Legacy question?', active: true, department_id: cat });
  await d('rec_settings').where({ name: 'roles_separated' }).del();
  await R.ensureRecruitmentSchema(d);
  const role = await d('rec_roles').where({ name: 'Legacy Role' }).first();
  assert.ok(role, 'a careers role of the same name');
  const j = await d('rec_jobs').where({ id: job }).first();
  assert.equal(Number(j.role_id), Number(role.id)); assert.equal(j.category_id, null, 'no link to the Loop department any more');
  assert.equal(Number((await d('rec_questions').where({ id: q }).first()).department_id), Number(role.id));
  assert.equal(Number((await d('employee_categories').count({ n: '*' }).first() as any).n), loop, 'Loop departments unchanged');
  await R.ensureRecruitmentSchema(d);
  assert.equal((await d('rec_roles').where({ name: 'Legacy Role' })).length, 1, 'runs once');
});

test('a candidate who confirmed WhatsApp and writes to the bot is pointed to email once; anyone else is unchanged', async () => {
  const { candidateReply, CANDIDATE_EMAIL } = await import('../assistant/whatsapp/handler');
  const { ref } = await apply(jobB, 'wa@x.test', '9888888888');
  const a = await app(ref);
  const msg = { senderId: 'lid:123456789', senderPhoneId: '+919888888888', conversationId: '123456789@lid' };
  assert.equal(await candidateReply(getDB(), msg, 1000), undefined, 'not confirmed yet: usual handling');
  await getDB()('rec_applications').where({ id: a.id }).update({ whatsapp: '919888888888', whatsapp_confirmed_at: new Date() });
  const r = await candidateReply(getDB(), msg, 2000);
  assert.ok(r && r.includes(CANDIDATE_EMAIL) && r.includes(ref) && r.startsWith('Hi Asha'), String(r));
  assert.equal(await candidateReply(getDB(), msg, 3000), null, 'quiet after telling once');
  assert.ok(await candidateReply(getDB(), msg, 2000 + 6 * 3600_000 + 1), 'told again after 6 hours');
  // Recognised by the chat's phone address too
  assert.ok(await candidateReply(getDB(), { senderId: 'opaque:x', conversationId: '919888888888@s.whatsapp.net' }, 99 * 3600_000));
  assert.equal(await candidateReply(getDB(), { senderId: '+919000011111', conversationId: '919000011111@s.whatsapp.net' }, 5000), undefined, 'unknown number: unchanged (silent)');
});
