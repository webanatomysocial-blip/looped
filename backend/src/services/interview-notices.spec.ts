/// <reference types="node" />
// WhatsApp messages to interviewers: assigned, 1 hour before, 5 minutes before, feedback reminder 1 hour after, group 30 minutes later.
process.env.SQLITE_FILE = ':memory:';
process.env.WHATSAPP_NOTIFICATION_GROUP_JID = '120363412745413406@g.us';
process.env.RECRUITMENT_EMAILS = 'off';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDB, getDB } from '../db';
import * as R from './recruitment';
import { submitFeedback } from './interviewFeedback';
import { enqueueInterviewNotices, processOutbox, deadlineInstant } from './assignmentNotices';

const db = () => getDB();
const MIN = 60_000;
const noMail: any = { interviewInvite: async () => {}, scheduled: async () => {}, cancelled: async () => {}, selected: async () => {}, rejected: async () => {}, welcome: async () => {} };
const U: any = {};
before(async () => {
  await initDB();
  U.iv = Number((await db()('users').insert({ name: 'Ravi Interviewer', email: 'ravi@iv.t', password_hash: 'x', role: 'employee' }))[0]);
  U.iv2 = Number((await db()('users').insert({ name: 'Sita Interviewer', email: 'sita@iv.t', password_hash: 'x', role: 'employee' }))[0]);
  for (const [u, ph] of [[U.iv, '+919000000001'], [U.iv2, '+919000000002']] as any) await db()('assistant_identities').insert({ user_id: u, channel: 'whatsapp', external_sender_id: ph, status: 'active', active_sender_key: `whatsapp:${ph}`, active_user_key: `${u}:whatsapp`, linked_via: 'admin', verified_at: new Date() });
  const [role] = await db()('rec_roles').insert({ name: 'IV role' });
  await db()('rec_questions').insert({ department_id: role, category: 'G', text: 'Q1', active: true });
  const [jid] = await db()('rec_jobs').insert({ public_id: 'iv-job', title: 'Designer', role_id: role, status: 'published' });
  const { ref } = await R.submitApplication(db(), 'iv-job', { name: 'Asha Candidate', email: 'asha@x.test', phone: '9811111111', experience_years: 2, current_ctc: '4', expected_ctc: '6', interview_mode: 'walkin' }, { file: 'r.pdf', name: 'r.pdf', mime: 'application/pdf' }, noMail);
  U.app = await db()('rec_applications').where({ ref }).first();
  void jid;
  await db()('rec_applications').where({ id: U.app.id }).update({ status: 'prelim_approved' });
  await R.schedule(db(), { id: 1, role: 'admin', name: 'Admin' }, U.app.id, { type: 'online', date: '2030-06-10', start_time: '15:00', end_time: '15:30', meeting_url: 'https://meet.example/a', interviewer_ids: [U.iv, U.iv2] }, noMail);
  U.s = await db()('rec_schedules').where({ application_id: U.app.id }).first();
});
after(() => db().destroy());

const START = deadlineInstant('2030-06-10', '15:00')!, END = deadlineInstant('2030-06-10', '15:30')!;
const rows = () => db()('whatsapp_outbox').where({ kind: 'interview' }).orderBy('id');
const steps = async () => (await rows()).map((r: any) => r.event_key.split(':').slice(0, 2).join(':') + (r.event_key.split(':').length > 4 ? `:${r.event_key.split(':')[4]}` : ':group'));

test('assigned (private, each interviewer), then 1 hour and 5 minutes before; each once', async () => {
  await db()('rec_schedules').where({ id: U.s.id }).update({ updated_at: new Date(START - 2 * 3600_000) });
  await enqueueInterviewNotices(db(), new Date(START - 2 * 3600_000));
  await enqueueInterviewNotices(db(), new Date(START - 2 * 3600_000 + MIN));
  assert.deepEqual(await steps(), [`iv:assigned:${U.iv}`, `iv:assigned:${U.iv2}`]);
  const first = JSON.parse((await rows())[0].payload);
  assert.equal(first.to, '919000000001@s.whatsapp.net', 'private chat');
  assert.match(first.text, /You are taking an interview[\s\S]*Asha Candidate[\s\S]*my-interviews#iv-/);
  await enqueueInterviewNotices(db(), new Date(START - 60 * MIN + MIN));
  await enqueueInterviewNotices(db(), new Date(START - 5 * MIN + 10_000));
  await enqueueInterviewNotices(db(), new Date(START - 4 * MIN));
  const s = await steps();
  assert.equal(s.filter((x) => x.startsWith('iv:before60')).length, 2);
  assert.equal(s.filter((x) => x.startsWith('iv:before5')).length, 2);
  assert.ok((await rows()).every((r: any) => JSON.parse(r.payload).to), 'everything so far is private');
});

test('after the interview: only those without feedback get the 1-hour reminder, then the group tag 30 minutes later', async () => {
  await enqueueInterviewNotices(db(), new Date(END + 30 * MIN));
  assert.equal((await steps()).filter((x) => x.startsWith('iv:after60')).length, 0, 'nothing before an hour');
  await submitFeedback(db(), { id: U.iv2, role: 'employee', name: 'Sita Interviewer' }, U.s.id, { rating: 4, recommendation: 'approve', notes: 'Good' });
  await enqueueInterviewNotices(db(), new Date(END + 61 * MIN));
  assert.deepEqual((await steps()).filter((x) => x.startsWith('iv:after60')), [`iv:after60:${U.iv}`], 'Sita sent hers; only Ravi is reminded');
  await enqueueInterviewNotices(db(), new Date(END + 80 * MIN));
  assert.equal((await steps()).filter((x) => x.endsWith(':group')).length, 0, 'the group waits 30 minutes');
  await enqueueInterviewNotices(db(), new Date(END + 91 * MIN));
  const g = (await rows()).find((r: any) => r.event_key.startsWith('iv:group'));
  const p = JSON.parse(g.payload);
  assert.ok(!p.to, 'this one goes to the group');
  assert.match(p.text, /Interview feedback overdue[\s\S]*Ravi Interviewer/);
  assert.ok(!/Sita/.test(p.text), 'only the one still missing is tagged');
  assert.deepEqual(p.mentions, ['919000000001@s.whatsapp.net']);
});

test('at send time: a reminder is dropped once the feedback arrives', async () => {
  const sent: string[] = [];
  const sender = { isConnected: () => true, sendGroup: async (_j: string, t: string) => { sent.push(t); return true; } };
  await submitFeedback(db(), { id: U.iv, role: 'employee', name: 'Ravi Interviewer' }, U.s.id, { rating: 3, recommendation: 'reject', notes: 'Weak' });
  await db()('whatsapp_outbox').where({ kind: 'interview' }).whereNot('event_key', 'like', 'iv:after60%').whereNot('event_key', 'like', 'iv:group%').update({ status: 'sent' });
  await db()('whatsapp_outbox').where({ kind: 'interview', status: 'pending' }).update({ next_attempt_at: new Date(Date.now() - 1000) });
  await processOutbox(db(), sender as any, new Date(), 1000);
  assert.equal(sent.length, 0, 'feedback is in: the reminder and the group tag are not sent');
  assert.equal((await db()('whatsapp_outbox').where({ kind: 'interview', status: 'cancelled' })).length, 2);
});

test('"Need help?": a reported problem (candidate did not come) is recorded, shown to staff, and stops the feedback reminders', async () => {
  const F = await import('./interviewFeedback');
  const [role] = await db()('rec_roles').insert({ name: 'IV role 2' });
  await db()('rec_questions').insert({ department_id: role, category: 'G', text: 'Q1', active: true });
  await db()('rec_jobs').insert({ public_id: 'iv-job2', title: 'Intern', role_id: role, status: 'published' });
  const { ref } = await R.submitApplication(db(), 'iv-job2', { name: 'No Show', email: 'noshow@x.test', phone: '9822222222', experience_years: 0, current_ctc: '0', expected_ctc: '2', interview_mode: 'walkin' }, { file: 'r2.pdf', name: 'r2.pdf', mime: 'application/pdf' }, noMail);
  const app = await db()('rec_applications').where({ ref }).first();
  await db()('rec_applications').where({ id: app.id }).update({ status: 'prelim_approved' });
  await R.schedule(db(), { id: 1, role: 'admin', name: 'Admin' }, app.id, { type: 'walkin', date: '2030-07-01', start_time: '14:00', end_time: '14:30', address: 'Madhapur', interviewer_ids: [U.iv] }, noMail);
  const s = await db()('rec_schedules').where({ application_id: app.id }).first();
  const me = { id: U.iv, role: 'employee', name: 'Ravi Interviewer' };
  await assert.rejects(F.reportIssue(db(), me, s.id, { reason: 'nonsense' }), /choose what happened/);
  await assert.rejects(F.reportIssue(db(), me, s.id, { reason: 'other' }), /what happened/);
  await assert.rejects(F.reportIssue(db(), { id: U.iv2, role: 'employee', name: 'x' }, s.id, { reason: 'no_show' }), /not found/, 'only its interviewers');
  await F.reportIssue(db(), me, s.id, { reason: 'no_show', note: 'Waited 30 minutes, phone switched off' });
  const mine = (await F.myInterviews(db(), me)).find((x: any) => x.schedule_id === s.id)!;
  assert.equal(mine.issue?.label, 'Candidate did not attend');
  const staff = await F.issuesFor(db(), app.id);
  assert.equal(staff.length, 1); assert.equal(staff[0].label, 'Candidate did not attend'); assert.match(staff[0].note, /phone switched off/);
  assert.ok(await db()('rec_history').where({ application_id: app.id, action: 'interview_issue' }).first(), 'in the candidate history');
  const end = deadlineInstant('2030-07-01', '14:30')!;
  await enqueueInterviewNotices(db(), new Date(end + 61 * MIN));
  await enqueueInterviewNotices(db(), new Date(end + 91 * MIN));
  assert.equal((await db()('whatsapp_outbox').where('event_key', 'like', `iv:after60:${s.id}:%`)).length + (await db()('whatsapp_outbox').where('event_key', 'like', `iv:group:${s.id}:%`)).length, 0, 'no reminders after reporting');
  await R.act(db(), { id: 1, role: 'admin', name: 'Admin' }, app.id, 'reject', 'Did not attend', noMail);
  await assert.rejects(F.reportIssue(db(), me, s.id, { reason: 'no_show' }), /already been made/);
});
