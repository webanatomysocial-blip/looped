/// <reference types="node" />
// Hardening: one open application per person per careers role (by role id, across openings and renames), withdrawal
// stopping an interview, one owning page per interview, heartbeats, the reviewers' monitoring summary and identity
// matches. Runs on an in-memory database and a temporary storage folder; no email or WhatsApp is sent.
import os from 'os';
import fs from 'fs';
import path from 'path';
process.env.SQLITE_FILE = ':memory:';
process.env.RECRUITMENT_STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-monitor-'));
process.env.RECRUITMENT_EMAILS = 'off';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDB, getDB } from '../db';
import * as R from './recruitment';

const RESUME = { file: 'r.pdf', name: 'r.pdf', mime: 'application/pdf' };
let role = 0; let roleB = 0; let n = 0;
const job = async (title: string, role_id: number | null) => {
  const d = getDB(); const [id] = await d('rec_jobs').insert({ public_id: `mon-${++n}`, title, role_id, status: 'published' });
  return d('rec_jobs').where({ id }).first();
};
const apply = (j: any, email: string, phone: string) => R.submitApplication(getDB(), j.public_id, { name: 'Asha', email, phone, experience_years: 1 }, RESUME);
const app = (ref: string) => getDB()('rec_applications').where({ ref }).first();

before(async () => {
  await initDB();
  const d = getDB();
  [role] = await d('rec_roles').insert({ name: 'Designer' });
  [roleB] = await d('rec_roles').insert({ name: 'Developer' });
  for (const r of [role, roleB]) await d('rec_questions').insert({ department_id: r, category: 'General', text: `Q for ${r}`, active: true });
});
after(() => { getDB().destroy(); });

test('one open application per person per role: another opening or a renamed one of the same role is refused; other roles are open', async () => {
  const a = await job('Graphic Designer', role); const renamed = await job('Visual Designer (2027)', role); const other = await job('Developer', roleB);
  await apply(a, 'one@x.test', '+91 91111 11111');
  await assert.rejects(apply(renamed, 'ONE@x.test', '9000000001'), /already have an open application for this role/, 'same email, other opening of the role');
  assert.ok(await apply(renamed, 'two@x.test', '091111-11111'), 'a shared phone alone is not the same person (flagged, not refused)');
  assert.ok(await apply(other, 'one@x.test', '+91 91111 11111'), 'a different role is open');
});

test('a rejection blocks the role by its id for three months, even through a renamed opening; withdrawing never blocks', async () => {
  const a = await job('Motion Designer', role); const renamed = await job('Senior Motion Designer', role);
  const { ref } = await apply(a, 'rej@x.test', '9222200000');
  const x = await app(ref);
  await R.act(getDB(), { id: 1, role: 'admin', name: 'Admin' }, x.id, 'reject', 'Not a fit now');
  await assert.rejects(apply(renamed, 'rej@x.test', '9222200000'), /apply for it again from/);
  const { ref: w } = await apply(a, 'wd@x.test', '9333300000');
  await R.withdraw(getDB(), await app(w));
  assert.ok(await apply(renamed, 'wd@x.test', '9333300000'), 'withdrawn → may apply again');
  // Withdraw again and apply again: every application is kept
  const all = await getDB()('rec_applications').where({ email: 'wd@x.test' });
  await R.withdraw(getDB(), all.find((r: any) => r.status !== 'withdrawn'));
  assert.ok(await apply(a, 'wd@x.test', '9333300000'));
  assert.equal((await getDB()('rec_applications').where({ email: 'wd@x.test' })).length, 3, 'history kept, nothing overwritten');
});

test('withdrawal never overwrites a decision made a moment earlier', async () => {
  const j = await job('Brand Designer', role);
  const { ref } = await apply(j, 'race@x.test', '9444400000');
  const stale = await app(ref);   // the candidate's page read the application before the admin rejected it
  await R.act(getDB(), { id: 1, role: 'admin', name: 'Admin' }, stale.id, 'reject', 'Reason');
  await assert.rejects(R.withdraw(getDB(), stale), /just updated/);
  assert.equal((await app(ref)).status, 'rejected');
});

async function started(email: string, phone: string) {
  const j = await job(`Role ${email}`, roleB);
  const { ref } = await apply(j, email, phone);
  const a = await app(ref);
  await R.startInterview(getDB(), a, { accepted: true, version: 'v1' });
  return { a, iv: await getDB()('rec_interviews').where({ application_id: a.id }).first() };
}

test('withdrawing during the interview stops it: no more answers or uploads, recorded for reviewers', async () => {
  const { a, iv } = await started('mid@x.test', '9555500000');
  await R.withdraw(getDB(), a);
  assert.equal((await getDB()('rec_interviews').where({ id: iv.id }).first()).status, 'withdrawn');
  await assert.rejects(R.nextQuestion(getDB(), a, 0), /already been submitted|not/);
  await assert.rejects(R.saveChunk(getDB(), a, 0, 0, false, Buffer.alloc(10), 'video/webm'));
  await assert.rejects(R.byInterviewToken(getDB(), 'x'.repeat(43)), /not valid/);
  assert.ok(await getDB()('rec_events').where({ interview_id: iv.id, type: 'interview_withdrawn', source: 'server' }).first());
});

test('one page owns the interview: opening it elsewhere takes over, the old page is refused, the switch is recorded', async () => {
  const { a, iv } = await started('tabs@x.test', '9666600000');
  await R.claimSession(getDB(), a, 'tab-one-aaaa');
  await R.checkSession(getDB(), a, 'tab-one-aaaa');
  await R.claimSession(getDB(), a, 'tab-two-bbbb');   // a second tab/device while the first is still connected
  await assert.rejects(R.checkSession(getDB(), a, 'tab-one-aaaa'), /open in another tab or device/);
  await R.checkSession(getDB(), a, 'tab-two-bbbb');
  await assert.rejects(R.heartbeat(getDB(), a, 'tab-one-aaaa'), /another tab|paused/, 'refused (the conflict is serious: the interview is also paused for review)');
  const ev = await getDB()('rec_events').where({ interview_id: iv.id, type: 'session_conflict' }).first();
  assert.equal(ev.source, 'server'); assert.ok(ev.received_at);
  // The interview itself is unchanged: one interview, same questions
  assert.equal((await getDB()('rec_interviews').where({ application_id: a.id })).length, 1);
  await R.claimSession(getDB(), a, 'bad id!');   // malformed ids are ignored
  assert.equal((await getDB()('rec_interviews').where({ id: iv.id }).first()).session_id, 'tab-two-bbbb');
});

test('heartbeats: a long silence is recorded by the server as an inferred interruption; page events get a server time', async () => {
  const { a, iv } = await started('beat@x.test', '9777700000');
  await R.claimSession(getDB(), a, 'page-cccccc');
  await R.heartbeat(getDB(), a, 'page-cccccc');
  await getDB()('rec_interviews').where({ id: iv.id }).update({ last_seen_at: new Date(Date.now() - 95_000) });
  const r = await R.heartbeat(getDB(), a, 'page-cccccc');
  assert.ok(r.gap_seconds >= 94);
  const gap = await getDB()('rec_events').where({ interview_id: iv.id, type: 'connection_gap' }).first();
  assert.equal(gap.source, 'server'); assert.match(gap.detail, /cause is not known/);
  // A page cannot pretend to be the server
  assert.equal((await R.recordEvents(getDB(), a, [{ type: 'connection_gap' }, { type: 'session_conflict' }])).saved, 0);
  await R.recordEvents(getDB(), a, [{ type: 'tab_hidden', at: new Date().toISOString() }]);
  const e = await getDB()('rec_events').where({ interview_id: iv.id, type: 'tab_hidden' }).first();
  assert.equal(e.source, 'client'); assert.ok(e.received_at);
});

test('monitoring summary: a tab switch with its window blur is one incident; counts, longest absence, live status', async () => {
  const { a, iv } = await started('sum@x.test', '9888800000');
  const t0 = Date.now() - 120_000; const at = (s: number) => new Date(t0 + s * 1000).toISOString();
  await R.recordEvents(getDB(), a, [
    { type: 'window_blur', at: at(10) }, { type: 'tab_hidden', at: at(10.2) }, { type: 'tab_visible', detail: 'away 12 s', at: at(22) }, { type: 'window_focus', at: at(22.1) },
    { type: 'tab_hidden', at: at(40) }, { type: 'tab_visible', detail: 'away 30 s', at: at(70) },
    { type: 'window_blur', at: at(80) }, { type: 'window_focus', at: at(85) },   // another window, no tab switch
    { type: 'fullscreen_exit', at: at(90) }, { type: 'network_offline', at: at(95) }, { type: 'network_online', at: at(99) },
    { type: 'camera_lost', detail: 'no picture for 2.0 s', at: at(100) }, { type: 'recording_interrupted', detail: 'upload refused (error 413, part 1)', at: at(101) },
  ]);
  await getDB()('rec_interviews').where({ id: iv.id }).update({ last_seen_at: new Date() });
  const m = await R.monitoring(getDB(), await getDB()('rec_interviews').where({ id: iv.id }).first());
  assert.equal(m.tab_switches, 2); assert.equal(m.away_seconds, 42); assert.equal(m.longest_away_seconds, 30);
  assert.equal(m.focus_losses, 1, 'only the blur without a tab switch');
  assert.equal(m.fullscreen_exits, 1); assert.equal(m.connection, 1); assert.equal(m.devices, 1); assert.equal(m.recording, 1);
  assert.equal(m.live, 'Connected now');
  const first = m.timeline.find((x: any) => x.type === 'tab_hidden');
  assert.ok(first.grouped.length >= 1 || m.timeline.filter((x: any) => x.type === 'window_blur').length === 1, 'the blur is folded in, kept as evidence');
  assert.equal(m.timeline.filter((x: any) => x.type === 'window_blur').length, 1);
  assert.ok(m.timeline.every((x: any) => x.severity && x.label && x.source));
  // Evidence only: nothing about the application changed
  assert.equal((await app(a.ref)).status, 'prelim_pending');
  // A page silent for an hour shows as possibly abandoned
  const old = await R.monitoring(getDB(), { ...iv, status: 'in_progress', last_seen_at: new Date(Date.now() - 3_600_000) });
  assert.match(old.live, /possibly abandoned/);
});

test('identity: other applications by the same email or phone are listed; a phone shared with another email is a conflict, never merged', async () => {
  const j1 = await job('Id role 1', role); const j2 = await job('Id role 2', roleB);
  const { ref } = await apply(j1, 'id@x.test', '+91 90909 09090');
  await apply(j2, 'someone@x.test', '090909 09090');
  const m = await R.identityMatches(getDB(), await app(ref));
  assert.equal(m.related.length, 1); assert.equal(m.related[0].match, 'phone'); assert.equal(m.conflict, true);
  assert.equal((await getDB()('rec_applications').where({ email: 'id@x.test' })).length, 1, 'nothing merged');
});
