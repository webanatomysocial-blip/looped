import path from 'path';
import fs from 'fs';
import { Knex } from 'knex';
import { Actor, ServiceError, assertCanSeeTask } from './access';

type Db = Knex | any;

// Label each attachment with the XLR8 stage it was added on, e.g. "UI/UX Designer"
export async function labelDeliverables(db: Db, taskId: any, rows: any[]) {
  const task = await db('tasks').where({ id: taskId }).select('ticket_type_id').first();
  let stages: any[] = [];
  if (task?.ticket_type_id) {
    const tt = await db('xlr8_ticket_types').where({ id: task.ticket_type_id }).select('stages').first();
    try { stages = typeof tt?.stages === 'string' ? JSON.parse(tt.stages) : (tt?.stages || []); } catch { stages = []; }
  }
  const userStages: Record<number, number[]> = {};
  if (stages.length) {
    const assignees = await db('task_assignees').where({ task_id: taskId }).whereNotNull('stage_idx').select('user_id', 'stage_idx');
    for (const a of assignees) (userStages[a.user_id] ||= []).push(a.stage_idx);
  }
  const stageName = (idx: number) => {
    const st = stages[idx];
    if (!st) return null;
    return st.type === 'admin' ? 'Admin Review' : st.category_name || (st.reviewer ? 'Manager Review' : `Stage ${idx + 1}`);
  };
  return rows.map((r: any) => {
    // Older rows have no stage_idx: use the uploader's stage when they only work one stage on this ticket
    const own = userStages[r.uploaded_by] || [];
    const idx = r.stage_idx ?? (own.length === 1 ? own[0] : null);
    return { ...r, stage_idx: idx, stage_name: idx != null ? stageName(idx) : null };
  });
}

export async function listDeliverables(db: Db, actor: Actor, taskId: number | string) {
  await assertCanSeeTask(db, actor, taskId);
  const rows = await db('task_deliverables as d').join('users as u', 'd.uploaded_by', 'u.id')
    .where('d.task_id', taskId).select('d.*', 'u.name as uploader_name').orderBy('d.created_at', 'asc');
  return labelDeliverables(db, taskId, rows);
}

// Only web links: a javascript:/data: link would run script for everyone who opens it
export function isSafeLink(url: unknown): url is string {
  if (typeof url !== 'string' || url.length > 2000) return false;
  try { return ['http:', 'https:'].includes(new URL(url).protocol); } catch { return false; }
}

async function insertDeliverable(db: Db, actor: Actor, taskId: number | string, row: { type: 'link' | 'file'; name: string; url: string }) {
  const stage = await db('tasks').where({ id: taskId }).select('ticket_type_id', 'xlr8_stage_idx').first();
  const stage_idx = stage?.ticket_type_id ? stage.xlr8_stage_idx ?? null : null;
  const [id] = await db('task_deliverables').insert({ task_id: taskId, uploaded_by: actor.id, stage_idx, type: row.type, name: row.name, url: row.url });
  return (await labelDeliverables(db, taskId, [{ id, ...row, uploaded_by: actor.id, uploader_name: actor.name, stage_idx }]))[0];
}

export async function addDeliverableLink(db: Db, actor: Actor, taskId: number | string, body: any) {
  await assertCanSeeTask(db, actor, taskId);
  const { url, name } = body ?? {};
  if (!url) throw new ServiceError(400, 'url required');
  if (!isSafeLink(url)) throw new ServiceError(400, 'Links must start with http:// or https://');
  return insertDeliverable(db, actor, taskId, { type: 'link', name: name || url, url });
}

// The route has already stored the file with multer (type, size and filename rules live there)
export async function addDeliverableFile(db: Db, actor: Actor, taskId: number | string, file: { filename: string; originalname: string }) {
  await assertCanSeeTask(db, actor, taskId);
  return insertDeliverable(db, actor, taskId, { type: 'file', name: file.originalname, url: `/uploads/deliverables/${file.filename}` });
}

export async function deleteDeliverable(db: Db, actor: Actor, taskId: number | string, deliverableId: number | string): Promise<void> {
  await assertCanSeeTask(db, actor, taskId);
  const row = await db('task_deliverables').where({ id: deliverableId, task_id: taskId }).first();
  if (!row) throw new ServiceError(404, 'Not found');
  if (row.uploaded_by !== actor.id && !['admin', 'manager'].includes(actor.role)) {
    throw new ServiceError(403, 'Only the person who added this attachment, or a manager, can remove it');
  }
  if (row.type === 'file') {
    const fp = path.join(__dirname, '../../', row.url);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
  await db('task_deliverables').where({ id: deliverableId }).delete();
}
