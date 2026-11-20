/// <reference types="node" />
// One-off clean-up of recruitment test data before real applicants arrive.
// Shows what it would delete; changes nothing unless run with --apply.
//   node dist/scripts/clearRecruitmentData.js                        → dry run: counts and sizes
//   node dist/scripts/clearRecruitmentData.js --apply                → deletes every applicant: application, history,
//                                                                     scores, interview, resume and recording
//   node dist/scripts/clearRecruitmentData.js --videos-only --apply  → deletes only the interview videos
// Job openings, the question bank and recruitment settings are never touched.
import fs from 'fs';
import path from 'path';
import { initDB, getDB } from '../db';
import * as R from '../services/recruitment';

const apply = process.argv.includes('--apply');
const videosOnly = process.argv.includes('--videos-only');
const mb = (b: number) => `${(b / 1048576).toFixed(1)} MB`;
const sizeOf = (p: string): number => { try { const st = fs.statSync(p); return st.isDirectory() ? fs.readdirSync(p).reduce((n, f) => n + sizeOf(path.join(p, f)), 0) : st.size; } catch { return 0; } };

async function main() {
  await initDB();
  const db = getDB();
  const apps = await db('rec_applications').select('id', 'ref', 'resume_file');
  const ivs = await db('rec_interviews').select('id', 'application_id', 'recording_deleted_at');
  const recDir = path.join(R.storageDir(), 'recordings');
  const recordings = sizeOf(recDir); const resumes = sizeOf(R.resumeDir());
  console.log(`Storage folder: ${R.storageDir()}`);
  console.log(`Applicants: ${apps.length} · interviews: ${ivs.length} (${ivs.filter((i: any) => !i.recording_deleted_at).length} with a video)`);
  console.log(`On disk: recordings ${mb(recordings)} · resumes ${mb(resumes)}`);
  console.log(`Kept: ${await db('rec_jobs').count({ n: '*' }).first().then((r: any) => r.n)} job openings, ${await db('rec_questions').count({ n: '*' }).first().then((r: any) => r.n)} questions, settings`);
  if (!apply) { console.log(`\nDry run: nothing changed. Run again with ${videosOnly ? '--videos-only --apply' : '--apply'} to ${videosOnly ? 'delete only the videos' : 'delete every applicant and their files'}.`); return; }

  const system = { id: 0, role: 'admin', name: 'clean-up script' } as R.Actor;
  if (videosOnly) {
    let n = 0;
    for (const iv of ivs) if (!iv.recording_deleted_at) { await R.deleteRecording(db, system, Number(iv.id)); n++; }
    // Recording folders no interview points to (left by earlier tests)
    for (const d of fs.existsSync(recDir) ? fs.readdirSync(recDir) : []) if (!ivs.some((i: any) => String(i.id) === d)) fs.rmSync(path.join(recDir, d), { recursive: true, force: true });
    console.log(`Deleted ${n} video(s). Recordings folder now ${mb(sizeOf(recDir))}.`);
    return;
  }
  let deleted = 0; const failed: string[] = [];
  for (const a of apps) { try { await R.deleteCandidate(db, Number(a.id)); deleted++; } catch { failed.push(a.ref); } }
  // Files no remaining application points to (orphans from tests or interrupted uploads)
  const keepResumes = new Set((await db('rec_applications').pluck('resume_file')).map(String));
  const keepIvs = new Set((await db('rec_interviews').pluck('id')).map(String));
  for (const f of fs.existsSync(R.resumeDir()) ? fs.readdirSync(R.resumeDir()) : []) if (!keepResumes.has(f)) fs.rmSync(path.join(R.resumeDir(), f), { force: true });
  for (const d of fs.existsSync(recDir) ? fs.readdirSync(recDir) : []) if (!keepIvs.has(d)) fs.rmSync(path.join(recDir, d), { recursive: true, force: true });
  console.log(`Deleted ${deleted} applicant(s)${failed.length ? `; could not delete ${failed.join(', ')}` : ''}.`);
  console.log(`On disk now: recordings ${mb(sizeOf(recDir))} · resumes ${mb(sizeOf(R.resumeDir()))}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('Clean-up failed:', e?.message ?? e); process.exit(1); });
