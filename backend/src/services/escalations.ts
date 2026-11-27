// Escalations the WhatsApp bot raises against an employee (acceptance not given in time, or work 24h past its deadline).
// Each is stored per employee and reviewed by a manager or admin: confirmed ones count against the employee, rejected ones don't.
import { Knex } from 'knex';
import { Actor, ServiceError } from './access';

export type EscalationKind = 'acceptance' | 'delayed';

export async function ensureEscalationSchema(db: Knex): Promise<void> {
  if (await db.schema.hasTable('employee_escalations')) return;
  await db.schema.createTable('employee_escalations', (t) => {
    t.increments('id').primary();
    t.integer('user_id').unsigned().notNullable().index();
    t.integer('task_id').unsigned().nullable();
    t.string('task_title', 255).nullable();
    t.string('kind', 20).notNullable();
    t.string('reason', 500).nullable();
    t.string('event_key', 160).notNullable();
    t.string('status', 20).notNullable().defaultTo('pending');   // pending | confirmed | rejected
    t.integer('reviewed_by').unsigned().nullable();
    t.string('reviewed_by_name', 120).nullable();
    t.timestamp('reviewed_at').nullable();
    t.string('review_note', 500).nullable();
    t.timestamp('created_at').defaultTo(db.fn.now());
    t.unique(['event_key', 'user_id']);
  });
}

// Called once per escalation message the bot queues; never throws (a failed record must not stop the message)
export async function recordEscalation(db: Knex, a: { userIds: number[]; taskId: number; kind: EscalationKind; reason: string; eventKey: string }): Promise<void> {
  try {
    const task = await db('tasks').where({ id: a.taskId }).first('title');
    for (const uid of [...new Set(a.userIds.map(Number))].filter(Boolean)) {
      await db('employee_escalations').insert({ user_id: uid, task_id: a.taskId, task_title: task?.title ?? null, kind: a.kind, reason: a.reason.slice(0, 500), event_key: a.eventKey.slice(0, 160), status: 'pending' })
        .catch((e: any) => { if (!/unique|duplicate/i.test(String(e?.message))) throw e; });
    }
  } catch (e: any) { console.error('[escalations] could not record:', e?.message ?? e); }
}

// Managers see their pod's employees; admins everyone
async function scope(db: Knex, actor: Actor, q: Knex.QueryBuilder) {
  if (actor.role === 'admin') return q;
  if (actor.role !== 'manager') throw new ServiceError(403, 'Only managers and admins can see escalations');
  const me = await db('users').where({ id: actor.id }).first('pod');
  return q.where('u.pod', me?.pod ?? '__none__');
}

export async function listEscalations(db: Knex, actor: Actor, status?: string) {
  let q = db('employee_escalations as e').join('users as u', 'u.id', 'e.user_id')
    .select('e.*', 'u.name as user_name', 'u.pod as user_pod').orderBy('e.id', 'desc').limit(500);
  if (status && ['pending', 'confirmed', 'rejected'].includes(status)) q = q.where('e.status', status);
  return scope(db, actor, q);
}

export async function escalationCounts(db: Knex, actor: Actor) {
  const q = db('employee_escalations as e').join('users as u', 'u.id', 'e.user_id')
    .groupBy('e.user_id', 'u.name')
    .select('e.user_id', 'u.name as user_name',
      db.raw("SUM(CASE WHEN e.status = 'confirmed' THEN 1 ELSE 0 END) as confirmed"),
      db.raw("SUM(CASE WHEN e.status = 'pending' THEN 1 ELSE 0 END) as pending"),
      db.raw("SUM(CASE WHEN e.status = 'rejected' THEN 1 ELSE 0 END) as rejected"));
  const rows = await scope(db, actor, q);
  return rows.map((r: any) => ({ user_id: Number(r.user_id), user_name: r.user_name, confirmed: Number(r.confirmed), pending: Number(r.pending), rejected: Number(r.rejected) }))
    .sort((a: any, b: any) => b.confirmed - a.confirmed || b.pending - a.pending);
}

// Confirm (counts against the employee) or reject (does not). Can be changed later, e.g. a mistaken reject.
export async function reviewEscalation(db: Knex, actor: Actor & { name?: string }, id: number, decision: string, note?: string) {
  if (!['confirm', 'reject'].includes(decision)) throw new ServiceError(400, 'decision must be confirm or reject');
  const row = await scope(db, actor, db('employee_escalations as e').join('users as u', 'u.id', 'e.user_id').where('e.id', id).select('e.*').first());
  if (!row) throw new ServiceError(404, 'Escalation not found');
  if (Number(row.user_id) === Number(actor.id)) throw new ServiceError(403, 'You cannot review your own escalation');
  if (decision === 'reject' && !String(note ?? '').trim()) throw new ServiceError(400, 'Please give a reason for rejecting it');
  await db('employee_escalations').where({ id }).update({
    status: decision === 'confirm' ? 'confirmed' : 'rejected', reviewed_by: actor.id, reviewed_by_name: actor.name ?? null,
    reviewed_at: new Date(), review_note: note ? String(note).slice(0, 500) : null,
  });
  return { ok: true };
}
