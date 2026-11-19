// One-off fresh start for the Tickets page: removes every ticket and task (XLR8 and regular), the recurring
// schedules that create them, and everything attached to them. Nothing else is touched.
//
//   node dist/scripts/clearTickets.js            dry run: prints what would be deleted, changes nothing
//   node dist/scripts/clearTickets.js --apply    deletes, in one transaction (all or nothing)
//
// Take a database backup (cPanel → phpMyAdmin → Export) before --apply. It cannot be undone without it.
import dotenv from 'dotenv';
dotenv.config();
import { Knex } from 'knex';
import { initDB, getDB, isMySQLClient } from '../db';

// [table, filter]. Children first, so nothing is left pointing at a deleted row.
// A filter limits a shared table to ticket rows only; no filter means the whole table is ticket data.
type Step = [string, ((q: Knex.QueryBuilder) => Knex.QueryBuilder) | null];
export const STEPS: Step[] = [
  ['approval_steps', null],               // steps of ticket approvals
  ['approvals', null],
  ['task_approval_flow', null],
  ['task_assignees', null],
  ['xlr8_ticket_log', null],
  ['task_sessions', null],                // timer sessions
  ['time_logs', (q) => q.whereNotNull('task_id')],                     // hours on tickets; hours with no ticket stay
  ['regularisation_requests', (q) => q.whereNotNull('task_id')],
  ['task_schedule_slots', null],
  ['task_checklist', null],
  ['task_comments', null],
  ['task_stage_comments', null],
  ['task_deliverables', null],
  ['task_share_tokens', null],
  ['deleted_tasks', null],                // the tickets trash bin
  ['assistant_ticket_audit', (q) => q.whereNotNull('task_id')],
  ['whatsapp_outbox', (q) => q.where('task_id', '>', 0)],              // queued ticket messages; daily reports (task 0) stay
  ['notifications', (q) => q.whereIn('type', ['task', 'approval'])],   // ticket and approval bell items only
  ['tasks', null],
  ['recurring_task_overrides', null],
  ['recurring_tasks', null],
];

export async function clearTickets(db: Knex, apply: boolean): Promise<{ table: string; rows: number }[]> {
  const out: { table: string; rows: number }[] = [];
  // Which tables exist is checked first: inside the transaction only its own connection may be used
  const present = new Set<string>();
  for (const [table] of STEPS) if (await db.schema.hasTable(table)) present.add(table);
  const run = async (q: Knex | Knex.Transaction) => {
    for (const [table, filter] of STEPS) {
      if (!present.has(table)) continue;
      const base = () => (filter ? filter(q(table)) : q(table));
      const rows = Number(((await base().count({ n: '*' }).first()) as any)?.n ?? 0);
      if (apply && rows) await base().del();
      out.push({ table, rows });
    }
  };
  if (!apply) { await run(db); return out; }
  await db.transaction(async (trx) => {
    // tasks reference each other and recurring_tasks; every linked row is deleted here, so checks can pause
    if (isMySQLClient()) await trx.raw('SET FOREIGN_KEY_CHECKS = 0');
    try { await run(trx); }
    finally { if (isMySQLClient()) await trx.raw('SET FOREIGN_KEY_CHECKS = 1'); }
  });
  return out;
}

if (require.main === module) {
  (async () => {
    const apply = process.argv.includes('--apply');
    await initDB();
    const db = getDB();
    console.log(apply ? 'DELETING ticket data…' : 'DRY RUN: nothing will be changed. Add --apply to delete.');
    const res = await clearTickets(db, apply);
    for (const r of res) console.log(`  ${r.table.padEnd(26)} ${String(r.rows).padStart(7)} ${apply ? 'deleted' : 'would be deleted'}`);
    console.log(`  ${'TOTAL'.padEnd(26)} ${String(res.reduce((n, r) => n + r.rows, 0)).padStart(7)}`);
    await db.destroy();
  })().catch((e) => { console.error('Failed, nothing was changed:', e?.message ?? e); process.exit(1); });
}
