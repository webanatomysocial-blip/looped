import { useEffect, useState } from 'react';
import { approvalsApi } from '../../services/api';
import { Approval } from '../../types';
import ApprovalCard from './ApprovalCard';
import { useApprovalActions } from './useApprovalActions';

// The task's open approval inside the task drawer, with the same actions as the Approvals page.
// Renders nothing when the task has no open approval.
export default function TaskApprovalSection({ taskId, onChanged }: { taskId: number; onChanged: () => void }) {
  const [approval, setApproval] = useState<Approval | null>(null);

  const load = () => {
    approvalsApi.list(undefined, taskId).then((r) => {
      const open = (r.data as Approval[]).find((a) => a.status !== 'approved' && a.status !== 'rejected') ?? null;
      setApproval(open);
      if (open) actions.seedTimers([open]);
    }).catch(() => setApproval(null));
  };

  const actions = useApprovalActions({ inlineReview: true, onChanged: () => { load(); onChanged(); } });

  useEffect(() => { setApproval(null); load(); }, [taskId]);

  // Keep popups (e.g. pick the next stage's person) even once the approval is no longer open
  if (!approval) return actions.overlays;
  return (
    <div>
      <div className="drawer-info-label" style={{ marginBottom: 8 }}>Approval</div>
      <ApprovalCard a={approval} actions={actions} compact />
      {actions.overlays}
    </div>
  );
}
