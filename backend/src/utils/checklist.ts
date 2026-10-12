import { Knex } from 'knex';

// Items that apply right now: whole-task items plus the current stage's own (tickets); everything for plain tasks
export function activeChecklist(db: Knex, task: { id: number; ticket_type_id?: number | null; xlr8_stage_idx?: number | null }) {
  const q = db('task_checklist').where({ task_id: task.id });
  return task.ticket_type_id ? q.where((w) => w.whereNull('stage_idx').orWhere('stage_idx', task.xlr8_stage_idx ?? 0)) : q;
}

// The x/y badge on a task follows the stage being worked on
export async function refreshChecklistCounts(db: Knex, taskId: number) {
  const task = await db('tasks').where({ id: taskId }).first('id', 'ticket_type_id', 'xlr8_stage_idx');
  if (!task) return;
  const items = await activeChecklist(db, task).select('completed');
  await db('tasks').where({ id: taskId }).update({ checklist_total: items.length, checklist_done: items.filter((i: any) => !!i.completed).length });
}

// Stage checklist from the form (if sent) or the ticket type's stage defaults; skipped → none
export function stageChecklistItems(stage: any, sa: any): string[] {
  if (sa?.skipped || sa?.skip_checklist) return [];
  const src = Array.isArray(sa?.checklist) ? sa.checklist : Array.isArray(stage?.checklist) ? stage.checklist : [];
  return src.map((i: any) => String(i?.text ?? i ?? '').trim()).filter(Boolean).slice(0, 50);
}

// Unticked items the person must finish before marking their work done (empty = good to go)
export async function uncheckedItems(db: Knex, taskId: number): Promise<string[]> {
  const task = await db('tasks').where({ id: taskId }).first('id', 'ticket_type_id', 'xlr8_stage_idx');
  if (!task) return [];
  const rows = await activeChecklist(db, task).select('text', 'completed');
  return rows.filter((r: any) => !r.completed).map((r: any) => r.text);
}
export const uncheckedError = (items: string[]) =>
  `Tick every checklist item before marking this done — still open: ${items.slice(0, 5).join(', ')}${items.length > 5 ? ` and ${items.length - 5} more` : ''}`;
