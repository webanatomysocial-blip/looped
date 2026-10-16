// Display stage for a task: Waiting → Accepted → Working → Submitted → Approved, or Rework after a rejection.
// Labels only — the stored task statuses are unchanged. Pending Approval, Draft and Delayed keep their names.
export type TaskStage = 'pending_approval' | 'draft' | 'waiting' | 'accepted' | 'working' | 'submitted' | 'rework' | 'overdue' | 'approved';

export const TASK_STAGE_LABELS: Record<TaskStage | 'all', string> = {
  all: 'All',
  pending_approval: 'Pending Approval',
  draft: 'Draft',
  waiting: 'Waiting',
  accepted: 'Accepted',
  working: 'Working',
  submitted: 'Submitted',
  rework: 'Rework',
  overdue: 'Delayed',
  approved: 'Approved',
};

// Reuse the existing badge colours
export const TASK_STAGE_BADGE: Record<TaskStage, string> = {
  pending_approval: 'pending_approval',
  draft: 'draft',
  waiting: 'todo',
  accepted: 'pending_manager',
  working: 'in_progress',
  submitted: 'in_review',
  rework: 'overdue',
  overdue: 'overdue',
  approved: 'completed',
};

export function taskStage(t: any): TaskStage {
  if (t.status === 'completed') return 'approved';
  if (t.status === 'draft') return 'draft';
  if (t.status === 'pending_approval') return 'pending_approval';
  if (t.status === 'overdue') return 'overdue';
  // Sent back after a rejection and not yet resubmitted
  if (t.in_rework || t.has_rejected_approval) return 'rework';
  if (t.status === 'in_review') return 'submitted';
  if (t.status === 'in_progress') return 'working';
  // To Do: still waiting for the person to accept, or accepted but not started
  const waiting = t.ticket_type_id
    ? t.xlr8_status === 'pending_assignee'
    : (t.assignees || []).some((a: any) => a.assignee_role === 'employee' && a.acceptance_status === 'pending');
  return waiting ? 'waiting' : 'accepted';
}

// Same rework rule as the task list, from a ticket's log: latest step is a rejection
const STEP_ACTIONS = ['manager_declined', 'admin_declined', 'work_done', 'next_stage', 'sent_to_admin', 'manager_approved', 'admin_approved', 'completed'];
export function reworkFromLog(log: { action?: string }[] = []): boolean {
  const last = [...log].reverse().find((e) => STEP_ACTIONS.includes(e.action || ''));
  return last?.action === 'manager_declined' || last?.action === 'admin_declined';
}
