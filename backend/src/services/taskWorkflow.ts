// Non-XLR8 task workflow: manager approval of requests, accept/decline of an assignment, timer, deletion.
// Shared by routes/tasks.ts and the assistant. Behaviour carried over from the route handlers.
import { Knex } from 'knex';
import { createNotification, getDB, inTransaction, onCommit } from '../db';
import { uncheckedItems, uncheckedError } from '../utils/checklist';
import { snapshotTicket, ensureTrashTable } from './ticketTrash';
import { appendLog, activateTicket, startIfAccepted, awaitingPodApproval, AWAITING_APPROVAL, dropCustomTypeIfUnused } from './xlr8';
import { Actor, ServiceError, STAFF, assertCanSeeTask, assertCanManageTask } from './access';
import { pauseActiveSession, sameStage, applyAssignees } from './tasks';

type Db = Knex | any;

// Scheduling runs after commit on the global connection: the caller's transaction handle is closed by then.
function scheduleTask(id: number, _db?: Db) { onCommit(async () => { const { scheduleTaskUsers } = await import('./scheduler'); await scheduleTaskUsers(id, getDB()); }).catch(() => {}); }
function scheduleOne(userId: number, _db?: Db) { onCommit(async () => { const { scheduleUser } = await import('./scheduler'); await scheduleUser(userId, getDB()); }).catch(() => {}); }

const ALREADY_HANDLED = 'This request was already handled — refresh to see its current state';

// ── Manager approval of a pending request ──

// One transaction: the decision, any reassignment it applies, and the notifications (sent after commit) succeed together.
export async function managerApproveTask(conn: Db, actor: Actor, taskId: number | string, body: any): Promise<Record<string, unknown>> {
  return inTransaction(conn, (db) => managerApproveTaskInTx(db, actor, taskId, body));
}

async function managerApproveTaskInTx(db: Db, actor: Actor, taskId: number | string, body: any): Promise<Record<string, unknown>> {
  if (!['admin', 'manager'].includes(actor.role)) throw new ServiceError(403, 'Insufficient permissions');
  const action = body?.action;
  if (!['approve', 'reject'].includes(action)) throw new ServiceError(400, 'Invalid action');
  const task = await db('tasks').where({ id: taskId }).first();
  if (!task) throw new ServiceError(404, 'Ticket not found');
  if (task.status !== 'pending_approval') throw new ServiceError(400, 'Ticket is not pending approval');
  // Seeing a pod's task is not the same as deciding on it: managers decide only within their scope (S5/approval)
  // A pod waiting on a held reassignment has no member on the ticket yet, so manage-scope cannot cover it.
  // Its manager may decide because their pod is listed as waiting (checked below); they can still see the ticket.
  const myPod = (await db('users').where({ id: actor.id }).select('pod').first())?.pod;
  const waitingOnMyPod = !!task.pending_assign && JSON.parse(task.crosspod_pods || '[]').includes(myPod);
  if (waitingOnMyPod) await assertCanSeeTask(db, actor, task.id);
  else await assertCanManageTask(db, actor, task.id);

  const crossPods: string[] = task.crosspod_pods ? JSON.parse(task.crosspod_pods) : [];
  const me = await db('users').where({ id: actor.id }).select('pod', 'name').first();
  const actorName = me?.name || actor.name || 'Manager';
  const note = String(body?.comment || '').trim() || 'Rejected';

  if (crossPods.length) {
    if (actor.role === 'manager' && !crossPods.includes(me?.pod)) throw new ServiceError(403, `Waiting for the ${crossPods.join(', ')} manager to approve`);
    // A held reassignment: approval applies the new assignees, rejection leaves the ticket as it was
    if (task.pending_assign) return decideReassignment(db, actor, task, action, note, actorName);
    const stillPending = () => db('tasks').where({ id: task.id, status: 'pending_approval', crosspod_pods: task.crosspod_pods });
    if (action === 'reject') {
      const n = await stillPending().update({
        status: 'draft', crosspod_pods: null, crosspod_note: `${actorName}: ${note}`,
        ...(task.ticket_type_id ? { xlr8_status: 'crosspod_rejected' } : {}),
      });
      if (!n) throw new ServiceError(409, ALREADY_HANDLED);
      if (task.ticket_type_id) await appendLog(task.id, actor, 'crosspod_rejected', 'pending_crosspod', 'crosspod_rejected', note);
      await createNotification(task.created_by, `${actorName} rejected "${task.title}": ${note} — edit and resubmit it from Tickets`, 'task', task.project_id);
      return { ok: true, status: 'draft' };
    }
    const remaining = actor.role === 'admin' ? [] : crossPods.filter((p) => p !== me?.pod);
    if (remaining.length) {
      if (!(await stillPending().update({ crosspod_pods: JSON.stringify(remaining) }))) throw new ServiceError(409, ALREADY_HANDLED);
      if (task.ticket_type_id) await appendLog(task.id, actor, 'crosspod_approved', 'pending_crosspod', null, `Still waiting on ${remaining.join(', ')}`);
      return { ok: true, status: 'pending_approval', crosspod_pending: remaining };
    }
    if (!(await stillPending().update({ status: 'todo', crosspod_pods: null, crosspod_note: null, ...(task.ticket_type_id ? { xlr8_status: 'pending_manager' } : {}) }))) throw new ServiceError(409, ALREADY_HANDLED);
    if (task.ticket_type_id) await appendLog(task.id, actor, 'crosspod_approved', 'pending_crosspod', null);
    await createNotification(task.created_by, `${actorName} approved "${task.title}" — it's now live`, 'task', task.project_id);
    if (task.ticket_type_id) {
      await activateTicket(db, task.id, { id: task.created_by, name: (await db('users').where({ id: task.created_by }).select('name').first())?.name || 'Creator' });
    } else {
      if (task.assigned_to && ['high', 'urgent'].includes(task.priority)) await pauseActiveSession(db, task.assigned_to);
      if (task.assigned_to && task.assigned_to !== task.created_by) {
        const proj = await db('projects').where({ id: task.project_id }).select('name').first();
        await createNotification(task.assigned_to, `You have been assigned ticket "${task.title}" in ${proj?.name || 'a project'}`, 'task', task.project_id);
      }
      scheduleTask(task.id, db);
    }
    return { ok: true, status: 'todo' };
  }

  if (action === 'reject') {
    const n = await db('tasks').where({ id: task.id, status: 'pending_approval' }).update({
      status: 'draft', crosspod_note: `${actorName}: ${note}`, ...(task.ticket_type_id ? { xlr8_status: 'crosspod_rejected' } : {}),
    });
    if (!n) throw new ServiceError(409, ALREADY_HANDLED);
    if (task.ticket_type_id) await appendLog(task.id, actor, 'crosspod_rejected', 'pending_approval', 'crosspod_rejected', note);
    if (task.created_by !== actor.id) await createNotification(task.created_by, `${actorName} rejected "${task.title}": ${note} — edit and resubmit it from Tickets`, 'task', task.project_id);
    return { ok: true, status: 'draft' };
  }
  if (!(await db('tasks').where({ id: task.id, status: 'pending_approval' }).update({ status: 'todo', ...(task.ticket_type_id ? { xlr8_status: 'pending_manager' } : {}) }))) {
    throw new ServiceError(409, ALREADY_HANDLED);
  }
  if (task.created_by !== actor.id) await createNotification(task.created_by, `${actorName} approved "${task.title}" — it's now live`, 'task', task.project_id);
  if (task.ticket_type_id) {
    await activateTicket(db, task.id, { id: task.created_by, name: (await db('users').where({ id: task.created_by }).select('name').first())?.name || 'Creator' });
    return { ok: true, status: 'todo' };
  }
  if (task.assigned_to && task.assigned_to !== task.created_by) {
    await createNotification(task.assigned_to, `You have been assigned ticket "${task.title}"`, 'task', task.project_id);
  }
  scheduleTask(task.id, db);
  return { ok: true, status: 'todo' };
}

// ── Accept / decline a plain task assignment ──

export async function acceptTask(db: Db, actor: Actor, taskId: number | string, body: any): Promise<Record<string, unknown>> {
  const action = body?.action;
  if (!['accept', 'decline'].includes(action)) throw new ServiceError(400, 'Invalid action');
  const row = await db('task_assignees').where({ task_id: taskId, user_id: actor.id }).first();
  if (!row) throw new ServiceError(403, 'Not assigned to this ticket');
  const held = await db('tasks').where({ id: taskId }).first();
  if (action === 'accept' && held && awaitingPodApproval(held)) throw new ServiceError(409, AWAITING_APPROVAL);
  if (action === 'accept' && held && (held.status === 'draft' || (held.status === 'pending_approval' && held.created_by !== actor.id))) {
    throw new ServiceError(409, 'This is waiting for a manager to approve it — you can accept once it is approved');
  }
  // Accepting twice does nothing the second time (no repeat notifications, timer pause or start)
  if (action === 'accept' && row.acceptance_status === 'accepted') return { ok: true, already: true };

  await db('task_assignees').where({ task_id: taskId, user_id: actor.id }).update({ acceptance_status: action === 'accept' ? 'accepted' : 'declined' });
  const task = await db('tasks').where({ id: taskId }).first();
  const me = await db('users').where({ id: actor.id }).first();
  if (task && task.created_by !== actor.id) {
    await createNotification(task.created_by,
      action === 'accept' ? `${me?.name} accepted the task "${task.title}"` : `${me?.name} declined the task "${task.title}" — please reassign`,
      'task', task.project_id);
  }
  if (action === 'accept') {
    // Pause active session BEFORE responding so the frontend reload sees the closed session
    if (task && ['high', 'urgent'].includes(task.priority)) await pauseActiveSession(db, actor.id);
    scheduleOne(actor.id, db);
    if (task?.ticket_type_id) await startIfAccepted(db, task.id, actor);
  }
  return { ok: true };
}

// ── Timer ──

// Whose turn it is: the current ticket stage person, a plain/recurring task's assignee, or a reviewer in its approval flow
export async function canWorkOn(db: Db, task: any, userId: number): Promise<boolean> {
  if (task.ticket_type_id) {
    if (task.xlr8_assignee_id === userId && ['in_progress', 'pending_manager', 'pending_admin'].includes(task.xlr8_status)) return true;
  } else {
    if (task.assigned_to === userId) return true;
    if (task.recurring_task_id && task.created_by === userId) return true;
    const row = await db('task_assignees').where({ task_id: task.id, user_id: userId })
      .where((q: any) => q.whereNot('acceptance_status', 'declined').orWhereNull('acceptance_status')).first();
    if (row) return true;
  }
  return !!(await db('task_approval_flow').where({ task_id: task.id, user_id: userId }).first().catch(() => null));
}

// Required employee assignees who have not accepted yet. Skipped assignees and managers are not required.
export async function pendingAcceptances(db: Db, taskId: number | string): Promise<{ name: string; status: string }[]> {
  const rows: any[] = await db('task_assignees as ta').join('users as u', 'u.id', 'ta.user_id')
    .where('ta.task_id', taskId).where('ta.assignee_role', 'employee')
    .where((q: any) => q.whereNull('ta.skipped').orWhere('ta.skipped', 0))
    .where((q: any) => q.whereNull('ta.acceptance_status').orWhereNot('ta.acceptance_status', 'accepted'))
    .select('u.name', 'ta.acceptance_status');
  return rows.map((r) => ({ name: String(r.name), status: r.acceptance_status ?? 'pending' }));
}

export async function timerAction(db: Db, actor: Actor, taskId: number | string, body: any): Promise<Record<string, unknown>> {
  const action = body?.action;
  if (!['start', 'pause', 'done'].includes(action)) throw new ServiceError(400, 'Invalid action');
  await assertCanSeeTask(db, actor, taskId);
  const userId = actor.id;
  const id = Number(taskId);
  const now = new Date();
  // A ticket waiting on a cross-pod approval (creation or reassignment) cannot be finished. Starting is already refused
  // by the pod-approval check below; pausing still stops a clock.
  if (action === 'done') {
    const held = await db('tasks').where({ id }).first('crosspod_pods', 'pending_assign');
    if (held && (awaitingPodApproval(held) || held.pending_assign)) throw new ServiceError(409, 'This ticket is waiting for pod approval — it can be finished once it is approved');
  }
  const today = now.toISOString().slice(0, 10);

  if (action === 'start') {
    const held = await db('tasks').where({ id }).first();
    if (!held) throw new ServiceError(404, 'Task not found');
    if (awaitingPodApproval(held)) throw new ServiceError(409, AWAITING_APPROVAL);
    // Mandatory acceptance gate for regular tasks: every required employee assignee must accept before the task starts
    if (!held.ticket_type_id) {
      const waiting = await pendingAcceptances(db, id);
      if (waiting.length) {
        throw new ServiceError(409, `This task can't start until every assignee accepts it. Still waiting for: ${waiting.map((w) => `${w.name} (${w.status})`).join(', ')}.`, { pending_acceptances: waiting });
      }
    }
    if (actor.role === 'employee' && !(await canWorkOn(db, held, userId))) {
      throw new ServiceError(403, held.ticket_type_id ? "It isn't your turn on this ticket yet — you can start once your stage is active" : "You're not assigned to this task");
    }
    // Pause any other running sessions for this user first, and write time_logs for them
    const otherOpen = await db('task_sessions').where({ user_id: userId }).whereNull('ended_at').whereNot('task_id', id).select('*');
    for (const s of otherOpen) {
      await db('task_sessions').where({ id: s.id }).update({ ended_at: now });
      const startMs = isNaN(Number(s.started_at)) ? new Date(s.started_at).getTime() : Number(s.started_at);
      const hrs = (now.getTime() - startMs) / 3600000;
      if (hrs >= 0.001) {
        const otherTask = await db('tasks').where({ id: s.task_id }).select('project_id').first();
        const userRec = await db('users').where({ id: userId }).select('monthly_salary').first();
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const hourlyRate = userRec?.monthly_salary ? Number(userRec.monthly_salary) / daysInMonth / 7 : null;
        if (otherTask) {
          await db('time_logs').insert({
            task_id: s.task_id, project_id: otherTask.project_id, user_id: userId, log_date: s.session_date,
            hours: Math.round(hrs * 1000) / 1000, notes: 'Auto-paused when another task was started', task_session_id: s.id, hourly_rate: hourlyRate,
          });
        }
      }
    }
    // Tickets: tagged with the stage being worked, so time stays on that stage
    await db('task_sessions').insert({ task_id: id, user_id: userId, started_at: now, ended_at: null, session_date: today, stage_idx: held.ticket_type_id ? (held.xlr8_stage_idx ?? 0) : null });

    // For XLR8 reviewer stages: fill in the reviewer's user_id on the null placeholder row
    if (held.ticket_type_id) {
      await db('task_assignees').where({ task_id: id, stage_idx: held.xlr8_stage_idx ?? 0 }).whereNull('user_id').update({ user_id: userId });
    }
    // Don't touch status if task is already in_review (reviewer timing their review); recurring instances manage their own lifecycle
    const currentTask = await db('tasks').where({ id }).select('status', 'recurring_task_id').first();
    if (currentTask?.status !== 'in_review' && !currentTask?.recurring_task_id) await db('tasks').where({ id }).update({ status: 'in_progress' });
    return { ok: true };
  }

  if (action === 'pause') {
    const pauseSession = await db('task_sessions').where({ task_id: id, user_id: userId }).whereNull('ended_at').first();
    await db('task_sessions').where({ task_id: id, user_id: userId }).whereNull('ended_at').update({ ended_at: now });
    if (pauseSession) {
      const pauseHours = (now.getTime() - new Date(pauseSession.started_at).getTime()) / 3600000;
      if (pauseHours >= 0.01) {
        const pauseTask = await db('tasks').where({ id }).select('project_id').first();
        if (pauseTask) {
          const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
          const userRec = await db('users').where({ id: userId }).select('monthly_salary').first();
          const hourlyRate = userRec?.monthly_salary ? Number(userRec.monthly_salary) / daysInMonth / 7 : null;
          await db('time_logs').insert({ task_id: id, project_id: pauseTask.project_id, user_id: userId, task_session_id: pauseSession.id, log_date: today, hours: Math.round(pauseHours * 100) / 100, hourly_rate: hourlyRate });
        }
      }
    }
    return { ok: true };
  }

  // done — a plain task's assignee finishes it and it goes to review
  const open = await uncheckedItems(db, id);
  if (open.length) throw new ServiceError(400, uncheckedError(open), { unchecked: open });
  const doneSession = await db('task_sessions').where({ task_id: id, user_id: userId }).whereNull('ended_at').first();
  await db('task_sessions').where({ task_id: id, user_id: userId }).whereNull('ended_at').update({ ended_at: now });
  if (doneSession) {
    const doneHours = (now.getTime() - new Date(doneSession.started_at).getTime()) / 3600000;
    if (doneHours >= 0.01) {
      const doneTask = await db('tasks').where({ id }).select('project_id').first();
      if (doneTask) {
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const userRec = await db('users').where({ id: userId }).select('monthly_salary').first();
        const hourlyRate = userRec?.monthly_salary ? Number(userRec.monthly_salary) / daysInMonth / 7 : null;
        await db('time_logs').insert({ task_id: id, project_id: doneTask.project_id, user_id: userId, task_session_id: doneSession.id, log_date: today, hours: Math.round(doneHours * 100) / 100, hourly_rate: hourlyRate });
      }
    }
  }
  const task = await db('tasks').where({ id }).first();
  // XLR8 tickets manage their own status and approval via the xlr8 service
  if (task?.ticket_type_id) return { message: 'Session closed' };
  // Recurring task instances complete directly — no review/approval flow
  if (task?.recurring_task_id) {
    await db('tasks').where({ id }).update({ status: 'completed', completed_at: new Date() });
    return { message: 'Completed' };
  }
  await db('tasks').where({ id }).update({ status: 'in_review' });
  const existingApproval = await db('approvals').where({ task_id: id }).whereNotIn('status', ['approved', 'rejected']).first();
  if (!existingApproval && task) {
    const customFlow = await db('task_approval_flow').where({ task_id: id }).orderBy('position').select('user_id', 'position');
    if (customFlow.length > 0) {
      await db('approvals').insert({ task_id: id, title: task.title, project_id: task.project_id, submitted_by: userId, status: 'pending_custom', workflow_type: 'custom', current_step: 0 });
      const firstApprover = customFlow[0];
      if (firstApprover.user_id !== userId) await createNotification(firstApprover.user_id, `"${task.title}" is waiting for your approval`, 'approval', task.project_id);
    } else {
      const userRole = actor.role;
      const clientCount = await db('project_members as pm').join('users as u', 'pm.user_id', 'u.id')
        .where('pm.project_id', task.project_id).where('u.role', 'client').count('u.id as cnt').first();
      const hasClient = Number(clientCount?.cnt ?? 0) > 0;
      let workflowType: string;
      if (userRole === 'employee') workflowType = 'employee';
      else if (userRole === 'manager') workflowType = 'manager';
      else workflowType = hasClient ? 'admin_with_client' : 'admin_no_client';
      const FIRST_STAGE: Record<string, { status: string; role: string } | null> = {
        employee: { status: 'pending_manager', role: 'manager' },
        manager: { status: 'pending_admin', role: 'admin' },
        admin_with_client: { status: 'pending_client', role: 'client' },
        admin_no_client: null,
      };
      const firstStage = FIRST_STAGE[workflowType];
      if (firstStage) {
        await db('approvals').insert({ task_id: id, title: task.title, project_id: task.project_id, submitted_by: userId, status: firstStage.status, workflow_type: workflowType });
        const recipients = firstStage.role === 'manager'
          ? await db('users as u').join('project_members as pm', function (this: any) { this.on('pm.user_id', 'u.id').andOn('pm.project_id', db.raw('?', [task.project_id])); }).where('u.role', 'manager').select('u.id')
          : firstStage.role === 'admin'
            ? await db('users as u').join('project_members as pm', function (this: any) { this.on('pm.user_id', 'u.id').andOn('pm.project_id', db.raw('?', [task.project_id])); }).where('u.role', 'admin').select('u.id')
            : await db('project_members as pm').join('users as u', 'pm.user_id', 'u.id').where('pm.project_id', task.project_id).where('u.role', 'client').select('u.id');
        for (const r of recipients) {
          if (r.id !== userId || firstStage.role === 'client') await createNotification(r.id, `"${task.title}" is ready for your review`, 'approval', task.project_id);
        }
      } else {
        await db('tasks').where({ id }).update({ status: 'completed', completed_at: new Date() });
      }
    }
  }
  if (task && task.created_by !== userId) {
    const me = await db('users').where({ id: userId }).first();
    await createNotification(task.created_by, `${me?.name} marked "${task.title}" ready for review`, 'task', task.project_id);
  }
  return { message: 'OK' };
}

// ── Delete ──

export async function deleteTask(db: Db, actor: Actor, taskId: number | string): Promise<void> {
  if (!['admin', 'manager', 'employee'].includes(actor.role)) throw new ServiceError(403, 'Insufficient permissions');
  await assertCanSeeTask(db, actor, taskId);
  if (actor.role === 'employee') {
    const own = await db('tasks').where({ id: taskId, created_by: actor.id, status: 'draft' }).first();
    if (!own) throw new ServiceError(403, 'You can only delete your own drafts');
  } else {
    await assertCanManageTask(db, actor, taskId);
  }
  const task = await db('tasks').where({ id: taskId }).select('assigned_to').first();
  const assignees = await db('task_assignees').where({ task_id: taskId }).select('user_id');
  const affectedUsers = new Set<number>();
  if (task?.assigned_to) affectedUsers.add(task.assigned_to);
  for (const a of assignees) if (a.user_id) affectedUsers.add(a.user_id);

  // Keep a full copy in the Deleted tab so it can be restored
  const snap = await snapshotTicket(db, Number(taskId));
  if (!snap) throw new ServiceError(404, 'Ticket not found');
  await ensureTrashTable(db);
  await db('deleted_tasks').insert({ task_id: snap.task.id, title: snap.task.title, project_id: snap.task.project_id ?? null, deleted_by: actor.id, snapshot: JSON.stringify(snap) });

  await db('approval_steps').whereIn('approval_id', db('approvals').where({ task_id: taskId }).select('id')).delete();
  await db('approvals').where({ task_id: taskId }).delete();
  await db('time_logs').where({ task_id: taskId }).delete();
  await db('task_sessions').where({ task_id: taskId }).delete();
  await db('task_assignees').where({ task_id: taskId }).delete();
  await db('task_checklist').where({ task_id: taskId }).delete();
  const typeRow = await db('tasks').where({ id: taskId }).select('ticket_type_id').first();
  await db('tasks').where({ id: taskId }).delete();
  await dropCustomTypeIfUnused(db, typeRow?.ticket_type_id);
  // Reschedule affected users so freed capacity gets filled by remaining tasks
  for (const uid of affectedUsers) scheduleOne(uid, db);
}

// Decision on a held cross-pod reassignment. Same pod-by-pod rules as a held creation: each pod's manager decides
// its part, and the reassignment applies only when every pod has approved.
async function decideReassignment(db: Db, actor: Actor, task: any, action: string, note: string, actorName: string) {
  const restore = task.pending_prev_status || 'todo';
  const stillPending = () => db('tasks').where({ id: task.id, status: 'pending_approval', crosspod_pods: task.crosspod_pods });
  if (action === 'reject') {
    if (!(await stillPending().update({ status: restore, crosspod_pods: null, crosspod_note: `${actorName}: ${note}`, pending_assign: null, pending_prev_status: null }))) throw new ServiceError(409, ALREADY_HANDLED);
    await createNotification(task.created_by, `${actorName} did not approve the reassignment of "${task.title}": ${note}`, 'task', task.project_id);
    return { ok: true, status: restore };
  }
  const crossPods: string[] = JSON.parse(task.crosspod_pods);
  const me = await db('users').where({ id: actor.id }).select('pod').first();
  const remaining = actor.role === 'admin' ? [] : crossPods.filter((p) => p !== me?.pod);
  if (remaining.length) {
    if (!(await stillPending().update({ crosspod_pods: JSON.stringify(remaining) }))) throw new ServiceError(409, ALREADY_HANDLED);
    return { ok: true, status: 'pending_approval', crosspod_pending: remaining };
  }
  const pending = JSON.parse(task.pending_assign);
  if (!(await stillPending().update({ status: restore, crosspod_pods: null, crosspod_note: null, pending_assign: null, pending_prev_status: null }))) throw new ServiceError(409, ALREADY_HANDLED);
  await applyAssignees(db, actor, task.id, pending.working_person_id, pending.task_manager_id, task.priority);
  await createNotification(task.created_by, `${actorName} approved the reassignment of "${task.title}"`, 'task', task.project_id);
  return { ok: true, status: restore };
}

