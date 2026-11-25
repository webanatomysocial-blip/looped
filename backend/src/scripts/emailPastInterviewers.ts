/// <reference types="node" />
// One-off: interviewers assigned before interviewer emails existed only got the in-app bell. This emails them the
// details of their upcoming final interviews (today or later). The candidates are not emailed again.
// Shows who would be emailed; sends nothing unless run with --send.
//   node dist/scripts/emailPastInterviewers.js          → dry run: lists the interviews and interviewers
//   node dist/scripts/emailPastInterviewers.js --send   → sends the emails (copied to the recruitment CC list)
import { initDB, getDB } from '../db';
import * as R from '../services/recruitment';

const send = process.argv.includes('--send');
const system = { id: null, name: 'Loop (catch-up email)', role: 'admin' } as unknown as R.Actor;

(async () => {
  await initDB();
  const db = getDB();
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);   // IST
  const rows = await db('rec_schedules as s').join('rec_applications as a', 'a.id', 's.application_id').leftJoin('rec_jobs as j', 'j.id', 'a.job_id')
    .where('s.status', 'scheduled').where('a.status', 'final_scheduled').where('s.date', '>=', today)
    .select('s.*', 'a.id as app_id', 'a.ref', 'a.name as cand', 'j.title as job').orderBy('s.date');
  if (!rows.length) { console.log('No upcoming scheduled interviews.'); process.exit(0); }
  for (const s of rows) {
    const people = JSON.parse(s.interviewers || '[]');
    const users = people.length ? await db('users').whereIn('id', people.map((p: any) => p.id)).select('name', 'email') : [];
    console.log(`${s.ref} ${s.cand} · ${String(s.date).slice(0, 10)} ${s.start_time} · interviewers: ${users.map((u: any) => `${u.name} <${u.email || 'NO EMAIL'}>`).join(', ') || 'none'}`);
    if (send) for (const line of await R.mailInterviewers(db, { id: s.app_id, ref: s.ref, name: s.cand }, s.job ?? 'a role', s, false, system)) console.log(`   ${line}`);
  }
  if (!send) console.log('\nDry run: nothing sent. Run again with --send to email these interviewers.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
