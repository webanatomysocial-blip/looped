export type Chip = { label: string; bg: string; color: string };

// What to show next to a stage assignee. The raw acceptance flag only matters for a work stage that hasn't
// finished: finished stages are just "Done", and reviewers never accept, they review.
export function assigneeChip(o: {
  acceptance?: string | null; working?: boolean; logged?: boolean;
  stageDone: boolean; stageCurrent: boolean; reviewStage: boolean;
}): Chip | null {
  if (o.acceptance === 'declined') return { label: 'Declined', bg: 'rgba(239,68,68,0.12)', color: '#dc2626' };
  if (o.stageDone) return { label: 'Done', bg: 'rgba(34,197,94,0.12)', color: '#16a34a' };
  // "Reviewing"/"Working" only while their timer is actually running
  if (o.reviewStage) {
    if (!o.stageCurrent) return null;
    return o.working ? { label: 'Reviewing', bg: 'rgba(59,130,246,0.12)', color: '#2563eb' } : { label: 'Review not started', bg: 'rgba(245,158,11,0.12)', color: '#b45309' };
  }
  if (o.working) return { label: 'Working', bg: 'rgba(59,130,246,0.12)', color: '#2563eb' };
  if (o.acceptance === 'accepted' && o.stageCurrent) return o.logged
    ? { label: 'Paused', bg: 'rgba(245,158,11,0.12)', color: '#b45309' }
    : { label: 'Accepted · not started', bg: 'rgba(148,163,184,0.15)', color: '#475569' };
  if (o.acceptance === 'accepted') return { label: 'Accepted', bg: 'rgba(34,197,94,0.12)', color: '#16a34a' };
  return { label: 'Awaiting acceptance', bg: 'rgba(148,163,184,0.15)', color: '#64748b' };
}
