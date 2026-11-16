// Task comments and @mentions. Shared by routes/tasks.ts and the assistant.
import { Knex } from 'knex';
import { createNotification } from '../db';
import { Actor, ServiceError, assertCanSeeTask } from './access';

type Db = Knex | any;

// People who can be @mentioned on a task: everyone on it, the project's members, its pod's managers, and admins
export async function mentionable(db: Db, taskId: number) {
  const t = await db('tasks').where('id', taskId).select('created_by', 'assigned_to', 'xlr8_assignee_id').first();
  if (!t) return [];
  const ids = new Set<number>([t.created_by, t.assigned_to, t.xlr8_assignee_id].filter(Boolean));
  for (const r of await db('task_assignees').where({ task_id: taskId }).whereNotNull('user_id').where((q: any) => q.whereNull('skipped').orWhere('skipped', 0)).pluck('user_id')) ids.add(r);
  for (const r of await db('task_approval_flow').where({ task_id: taskId }).pluck('user_id')) ids.add(r);
  return db('users').whereIn('id', [...ids, 0]).orderBy('name').select('id', 'name', 'avatar_color', 'avatar_url', 'role');
}

// Notify everyone tagged as @Full Name in a comment (longest names first so "@Sai Kumar" beats "@Sai")
async function notifyMentions(db: Db, taskId: number, text: string, author: { id: number; name?: string }) {
  const people = (await mentionable(db, taskId)).sort((a: any, b: any) => b.name.length - a.name.length);
  let rest = text.toLowerCase();
  const hit: any[] = [];
  for (const p of people) {
    const tag = '@' + String(p.name).trim().toLowerCase();
    if (tag.length > 1 && rest.includes(tag)) { hit.push(p); rest = rest.split(tag).join(' '); }
  }
  if (!hit.length) return [];
  const task = await db('tasks').where({ id: taskId }).select('title', 'project_id').first();
  const who = author.name || (await db('users').where({ id: author.id }).select('name').first())?.name || 'Someone';
  const excerpt = text.length > 80 ? text.slice(0, 77) + '…' : text;
  for (const p of hit) if (p.id !== author.id) await createNotification(p.id, `${who} mentioned you on "${task?.title}": ${excerpt}`, 'task', task?.project_id);
  return hit.map((p) => p.id);
}

export async function listComments(db: Db, actor: Actor, taskId: number | string) {
  await assertCanSeeTask(db, actor, taskId);
  return db('task_comments as c').join('users as u', 'c.user_id', 'u.id')
    .where('c.task_id', taskId)
    .select('c.*', 'u.name as user_name', 'u.avatar_color', 'u.avatar_url')
    .orderBy('c.created_at', 'asc');
}

export async function addComment(db: Db, actor: Actor, taskId: number | string, body: any) {
  const text = String(body?.comment ?? '').trim();
  if (!text) throw new ServiceError(400, 'comment required');
  await assertCanSeeTask(db, actor, taskId);
  const [id] = await db('task_comments').insert({
    task_id: Number(taskId),
    parent_id: body?.parent_id ? Number(body.parent_id) : null,
    user_id: actor.id,
    comment: text,
  });
  await notifyMentions(db, Number(taskId), text, actor);
  return db('task_comments as c').join('users as u', 'c.user_id', 'u.id').where('c.id', id)
    .select('c.*', 'u.name as user_name', 'u.avatar_color', 'u.avatar_url').first();
}

// Only the author edits their own comment
export async function updateComment(db: Db, actor: Actor, taskId: number | string, commentId: number | string, body: any) {
  const text = String(body?.comment ?? '').trim();
  if (!text) throw new ServiceError(400, 'comment required');
  await assertCanSeeTask(db, actor, taskId);
  const row = await db('task_comments').where({ id: commentId, task_id: taskId }).first();
  if (!row) throw new ServiceError(404, 'Not found');
  if (Number(row.user_id) !== actor.id) throw new ServiceError(403, 'You can only edit your own comments');
  const updated_at = new Date();
  await db('task_comments').where({ id: commentId }).update({ comment: text, updated_at });
  return { ...row, comment: text, updated_at };
}

export async function deleteComment(db: Db, actor: Actor, taskId: number | string, commentId: number | string): Promise<void> {
  await assertCanSeeTask(db, actor, taskId);
  const row = await db('task_comments').where({ id: commentId, task_id: taskId }).first();
  if (!row) throw new ServiceError(404, 'Not found');
  if (Number(row.user_id) !== actor.id) throw new ServiceError(403, 'You can only delete your own comments');
  await db('task_comments').where({ id: commentId }).delete();
}
