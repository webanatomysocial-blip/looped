// Recycle bin for tickets: deleting stores a snapshot of the ticket and everything attached to it,
// then removes it as before (so it disappears from every page). Restoring puts the rows back with
// their original ids. Child tables are listed in insert order (parents before children).
const CHILD_TABLES: { table: string; byApproval?: boolean }[] = [
  { table: 'task_assignees' },
  { table: 'task_checklist' },
  { table: 'task_sessions' },
  { table: 'time_logs' },
  { table: 'approvals' },
  { table: 'approval_steps', byApproval: true },
  { table: 'task_approval_flow' },
  { table: 'xlr8_ticket_log' },
  { table: 'task_schedule_slots' },
  { table: 'task_deliverables' },
  { table: 'regularisation_requests' },
  { table: 'task_share_tokens' },
  { table: 'task_stage_comments' },
  { table: 'task_comments' },
];

export async function ensureTrashTable(db: any) {
  if (!(await db.schema.hasTable('deleted_tasks'))) {
    await db.schema.createTable('deleted_tasks', (t: any) => {
      t.increments('id').primary();
      t.integer('task_id').notNullable();
      t.string('title', 500).notNullable();
      t.integer('project_id').nullable();
      t.integer('deleted_by').nullable();
      t.timestamp('deleted_at').defaultTo(db.fn.now());
      t.text('snapshot', 'longtext').notNullable();
    });
  }
}

export async function snapshotTicket(db: any, taskId: number) {
  const task = await db('tasks').where({ id: taskId }).first();
  if (!task) return null;
  const rows: Record<string, any[]> = {};
  const approvalIds = (await db('approvals').where({ task_id: taskId }).select('id')).map((r: any) => r.id);
  for (const { table, byApproval } of CHILD_TABLES) {
    if (!(await db.schema.hasTable(table))) continue;
    rows[table] = byApproval
      ? (approvalIds.length ? await db(table).whereIn('approval_id', approvalIds).orderBy('id') : [])
      : await db(table).where({ task_id: taskId }).orderBy('id');
  }
  // A custom stage set belongs to this ticket only and is removed with it — keep it to restore
  const customType = task.ticket_type_id
    ? await db('xlr8_ticket_types').where({ id: task.ticket_type_id, is_custom: true }).first()
    : null;
  return { task, rows, customType: customType ?? null };
}

export async function restoreTicket(db: any, snap: any) {
  await db.transaction(async (trx: any) => {
    if (await trx('tasks').where({ id: snap.task.id }).first()) throw new Error('A ticket with this id already exists');
    if (snap.customType && !(await trx('xlr8_ticket_types').where({ id: snap.customType.id }).first())) {
      await trx('xlr8_ticket_types').insert(snap.customType);
    }
    await trx('tasks').insert(snap.task);
    for (const { table } of CHILD_TABLES) {
      const list: any[] = snap.rows?.[table] || [];
      if (!list.length || !(await trx.schema.hasTable(table))) continue;
      for (const row of list) await trx(table).insert(row); // one by one keeps comment parents first
    }
  });
}
