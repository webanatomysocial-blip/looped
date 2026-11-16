import { Knex } from 'knex';
import { refreshChecklistCounts } from '../utils/checklist';
import { Actor, ServiceError, assertCanSeeTask } from './access';

// A stage's items are ticked by that stage's person; plain-task items by anyone on the task. Admins and managers can tick any.
export async function setChecklistItem(db: Knex | any, actor: Actor, taskId: number, itemId: number | string, completed: boolean): Promise<void> {
  await assertCanSeeTask(db, actor, taskId);
  const item = await db('task_checklist').where({ id: itemId, task_id: taskId }).first();
  if (!item) throw new ServiceError(404, 'Checklist item not found');
  if (!['admin', 'manager'].includes(actor.role)) {
    const task = await db('tasks').where({ id: taskId }).first('assigned_to', 'created_by');
    const onTask = item.stage_idx == null
      ? task?.assigned_to === actor.id || !!(await db('task_assignees').where({ task_id: taskId, user_id: actor.id }).first())
      : !!(await db('task_assignees').where({ task_id: taskId, user_id: actor.id, stage_idx: item.stage_idx }).first());
    if (!onTask) throw new ServiceError(403, item.stage_idx == null ? 'Only people on this ticket can tick its checklist' : 'Only the person on this stage can tick its checklist');
  }
  await db('task_checklist').where({ id: item.id }).update({ completed });
  await refreshChecklistCounts(db, taskId);
}
