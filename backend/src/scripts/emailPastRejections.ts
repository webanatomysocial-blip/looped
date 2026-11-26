/// <reference types="node" />
// One-off: candidates rejected before rejection emails existed were never emailed. This sends them the standard
// rejection email (copied to the recruitment CC list), once: anyone whose history already has a rejection email is skipped.
// Only recent rejections by default, since a "not moving forward" email months later confuses more than it helps.
//   node dist/scripts/emailPastRejections.js                  → dry run: lists who would be emailed (last 30 days)
//   node dist/scripts/emailPastRejections.js --days 90        → dry run over the last 90 days (--days 0 = everyone)
//   node dist/scripts/emailPastRejections.js --send [--days N] → sends the emails
import { initDB, getDB } from '../db';
import * as R from '../services/recruitment';

const send = process.argv.includes('--send');
const di = process.argv.indexOf('--days');
const days = di > 0 ? Number(process.argv[di + 1]) : 30;
const system = { id: null, name: 'Loop (catch-up email)', role: 'admin' } as unknown as R.Actor;

(async () => {
  if (!Number.isFinite(days) || days < 0) { console.error('--days must be a number (0 = everyone)'); process.exit(1); }
  await initDB();
  const db = getDB();
  const q = db('rec_applications as a').leftJoin('rec_jobs as j', 'j.id', 'a.job_id').where('a.status', 'rejected')
    .whereNotExists(function (this: any) { this.select(1).from('rec_history as h').whereRaw('h.application_id = a.id').where('h.action', 'email').where('h.comment', 'like', 'Rejection email sent%'); })   // a failed or switched-off send is tried again
    .select('a.*', 'j.title as job');
  const rows: any[] = [];
  for (const a of await q) {
    // When it was rejected: the latest move to "rejected"
    const h = await db('rec_history').where({ application_id: a.id, to_status: 'rejected' }).orderBy('id', 'desc').first('created_at');
    const at = h?.created_at ? new Date(h.created_at) : null;
    if (days && (!at || Date.now() - at.getTime() > days * 86_400_000)) continue;
    rows.push({ ...a, at });
  }
  if (!rows.length) { console.log(`No rejected candidates without a rejection email${days ? ` in the last ${days} days` : ''}.`); process.exit(0); }
  for (const a of rows) {
    console.log(`${a.ref} ${a.name} <${a.email}> · ${a.job ?? 'a role'} · rejected ${a.at ? a.at.toISOString().slice(0, 10).split('-').reverse().join('-') : 'date unknown'}`);
    if (!send) continue;
    const res = await R.defaultMailer.rejected!(a, a.job ?? 'the role');
    await R.log(db, { application_id: a.id, action: 'email', actor: system, comment: `Rejection email ${res} (catch-up)` });
    console.log(`   ${res}`);
  }
  console.log(send ? `\nDone: ${rows.length} candidate(s) processed.` : `\nDry run: nothing sent. ${rows.length} candidate(s) would be emailed. Run again with --send to email them.`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
