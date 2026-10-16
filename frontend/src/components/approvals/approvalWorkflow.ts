import { Approval, ApprovalStatus, WorkflowType } from '../../types';

// ─── State machine definition (mirrors backend) ───────────────────────────────

interface WFStage {
  status: string;
  role: 'manager' | 'admin' | 'client';
  label: string;
}

export const WORKFLOWS: Record<string, WFStage[]> = {
  xlr8: [
    { status: 'pending_manager', role: 'manager', label: 'Manager Review' },
    { status: 'pending_admin',   role: 'admin',   label: 'Admin Approval' },
    { status: 'pending_client',  role: 'client',  label: 'Client Review' },
  ],
  employee: [
    { status: 'pending_manager',       role: 'manager', label: 'Manager Review' },
    { status: 'pending_admin',         role: 'admin',   label: 'Admin Review' },
    { status: 'pending_client',        role: 'client',  label: 'Client Review' },
    { status: 'pending_admin_final',   role: 'admin',   label: 'Admin Final Review' },
    { status: 'pending_manager_final', role: 'manager', label: 'Manager Confirmation' },
  ],
  manager: [
    { status: 'pending_admin',         role: 'admin',   label: 'Admin Review' },
    { status: 'pending_client',        role: 'client',  label: 'Client Review' },
    { status: 'pending_admin_final',   role: 'admin',   label: 'Admin Final Review' },
    { status: 'pending_manager_final', role: 'manager', label: 'Manager Confirmation' },
  ],
  admin_with_client: [
    { status: 'pending_client',      role: 'client', label: 'Client Review' },
    { status: 'pending_admin_final', role: 'admin',  label: 'Admin Final Review' },
  ],
};

// Legacy timeline (no workflow_type)
const LEGACY_TIMELINE = [
  { key: 'submitted',      label: 'Submitted' },
  { key: 'pending_manager',label: 'Manager' },
  { key: 'pending_admin',  label: 'Admin' },
  { key: 'pending_client', label: 'Client' },
  { key: 'work_in_progress',label: 'In Work' },
  { key: 'pending_review', label: 'Review' },
  { key: 'approved',       label: 'Done' },
];

export function parseTs(s: any): Date {
  if (!s) return new Date(NaN);
  const str = String(s);
  const iso = str.includes('T') || str.includes('Z') || str.includes('+') ? str : str.replace(' ', 'T') + 'Z';
  return new Date(Number(str) || iso);
}

export function getTimeline(wfType: WorkflowType): Array<{ key: string; label: string }> {
  if (!wfType || wfType === 'admin_no_client') return LEGACY_TIMELINE;
  const stages = WORKFLOWS[wfType] ?? [];
  return [
    { key: 'submitted', label: 'Submitted' },
    ...stages.map((s) => ({ key: s.status, label: s.label })),
    { key: 'approved', label: 'Done' },
  ];
}

export function getDotState(
  stageKey: string,
  approval: Approval,
  timeline: Array<{ key: string; label: string }>
): 'done' | 'active' | 'rejected' | 'pending' {
  if (approval.status === 'approved') return 'done';
  if (stageKey === 'submitted') return 'done';
  // For XLR8 approvals, use xlr8_status as the live position
  const liveStatus = (approval.workflow_type === 'xlr8' && (approval as any).xlr8_status)
    ? (approval as any).xlr8_status
    : approval.status;
  if (approval.status === 'rejected') {
    // Find the stage just before the last active stage — all stages at or before it are rejected
    const currentIdx = timeline.findIndex((t) => t.key === liveStatus);
    const me = timeline.findIndex((t) => t.key === stageKey);
    // If the current stage can't be found, mark all non-submitted stages as rejected
    const threshold = currentIdx >= 0 ? currentIdx : timeline.length;
    return me <= threshold ? 'rejected' : 'pending';
  }
  const currentIdx = timeline.findIndex((t) => t.key === liveStatus);
  const myIdx = timeline.findIndex((t) => t.key === stageKey);
  if (myIdx < 0) return 'pending';
  if (myIdx < currentIdx) return 'done';
  if (myIdx === currentIdx) return 'active';
  return 'pending';
}

// ─── Status display map ───────────────────────────────────────────────────────

export const STATUS_META: Record<ApprovalStatus, { label: string; color: string }> = {
  pending_manager:       { label: 'Pending Manager',        color: 'var(--yellow)' },
  pending_admin:         { label: 'Pending Admin',           color: 'var(--orange)' },
  pending_client:        { label: 'Pending Client',          color: '#9b59b6' },
  pending_admin_final:   { label: 'Admin Final Review',      color: 'var(--orange)' },
  pending_manager_final: { label: 'Manager Confirmation',    color: 'var(--yellow)' },
  work_in_progress:      { label: 'Working',                 color: 'var(--blue)' },
  pending_review:        { label: 'Pending Review',          color: 'var(--orange)' },
  revision_requested:    { label: 'Revision Requested',      color: 'var(--red)' },
  pending_custom:        { label: 'Submitted',               color: 'var(--blue)' },
  approved:              { label: 'Approved',                color: 'var(--green)' },
  rejected:              { label: 'Rework',                  color: 'var(--red)' },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getCurrentStageLabel(a: Approval): string {
  if (!a.workflow_type || a.workflow_type === 'admin_no_client') return STATUS_META[a.status]?.label ?? a.status;
  const stages = WORKFLOWS[a.workflow_type] ?? [];
  const stage = stages.find((s) => s.status === a.status);
  return stage ? stage.label : STATUS_META[a.status]?.label ?? a.status;
}

export function getNextApproverRole(a: Approval): string | null {
  if (!a.workflow_type || a.workflow_type === 'admin_no_client') return null;
  const stages = WORKFLOWS[a.workflow_type] ?? [];
  const stage = stages.find((s) => s.status === a.status);
  return stage ? stage.role : null;
}

// Whether this approval uses the new state machine
export const isNewWorkflow = (a: Approval) => !!a.workflow_type && a.workflow_type !== 'admin_no_client';
export const isLegacy = (a: Approval) => !a.workflow_type;

// Who can review this approval right now
export function canReviewApproval(user: { id: number; role: string } | null | undefined, a: Approval): boolean {
  if (!user) return false;
  if (a.status === 'approved' || a.status === 'rejected') return false;
  // XLR8: use the live xlr8_status from the task, not the potentially stale approval status
  if (a.workflow_type === 'xlr8') {
    const live = (a as any).xlr8_status ?? a.status;
    if (user.role === 'manager') return live === 'pending_manager' && (a as any).xlr8_assignee_role !== 'employee';
    if (user.role === 'admin')   return live === 'pending_admin';
    if (user.role === 'client')  return live === 'pending_client';
    // Reviewer-stage employee: can act when it's their turn as the xlr8_assignee
    if (user.role === 'employee') return live === 'pending_manager' && (a as any).xlr8_assignee_id === user.id;
    return false;
  }
  // Custom sequential flow
  if (a.workflow_type === 'custom') {
    const step = a.current_step ?? 0;
    const currentApprover = a.flow_chain?.[step];
    return currentApprover?.user_id === user.id;
  }
  // New state-machine workflow
  if (a.workflow_type && a.workflow_type !== 'admin_no_client') {
    const stages = WORKFLOWS[a.workflow_type] ?? [];
    const stage = stages.find((s) => s.status === a.status);
    if (!stage) return false;
    return user.role === stage.role;
  }
  // Legacy workflow
  if (user.role === 'manager' && a.status === 'pending_manager') return true;
  if (user.role === 'admin'   && a.status === 'pending_admin')   return true;
  if (user.role === 'client'  && a.status === 'pending_client')  return true;
  if (a.status === 'pending_review') return user.role === 'manager' || user.role === 'admin' || user.role === 'client';
  return false;
}

export const canMarkCompleteApproval = (user: { role: string } | null | undefined, a: Approval) =>
  a.status === 'work_in_progress' &&
  a.workflow_type !== 'xlr8' &&
  (user?.role === 'employee' || user?.role === 'manager' || user?.role === 'admin');
