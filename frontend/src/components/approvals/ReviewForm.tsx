import { CheckCircle, XCircle, RotateCcw } from 'lucide-react';
import { Approval } from '../../types';
import SendBackStagePicker from '../UI/SendBackStagePicker';
import ReviewAttachments from '../UI/ReviewAttachments';
import StageChecklist from '../UI/StageChecklist';
import { WORKFLOWS, getCurrentStageLabel, isNewWorkflow } from './approvalWorkflow';
import type { ReviewAction } from './useApprovalActions';

interface Props {
  reviewModal: Approval | null;
  setReviewModal: (a: Approval | null) => void;
  action: ReviewAction;
  setAction: (a: ReviewAction) => void;
  returnIdx: number | null;
  setReturnIdx: (i: number | null) => void;
  notes: string;
  setNotes: (n: string) => void;
  submitting: boolean;
  submitReview: (skipType?: 'skip_admin' | 'send_client') => void;
}

// Body + footer of the review form: what was submitted, approve/reject/revision, skips, send-back stage.
// Used inside a side drawer on the Approvals page and inline in the task drawer.
export default function ReviewForm({ reviewModal, setReviewModal, action, setAction, returnIdx, setReturnIdx, notes, setNotes, submitting, submitReview }: Props) {
  if (!reviewModal) return null;
  return (
    <>
      <div className="drawer-body">
        {reviewModal.task_id && <ReviewAttachments taskId={reviewModal.task_id} />}
        {reviewModal.task_id && <StageChecklist taskId={reviewModal.task_id} />}
        <p className="review-desc">
          {isNewWorkflow(reviewModal) ? (
            <>
              <strong>{getCurrentStageLabel(reviewModal)}</strong>
              {(() => {
                if (reviewModal.workflow_type === 'xlr8') {
                  const st = (reviewModal as any).xlr8_status ?? reviewModal.status;
                  if (st === 'pending_manager') return ' — Approve to move to admin review, or reject to send back to the employee.';
                  if (st === 'pending_admin') return ' — Approve to send to the client, or reject to send the work back to be redone.';
                  if (st === 'pending_client') return ' — Approve to mark the ticket as completed.';
                  return ' — Review this stage.';
                }
                return ' — Approving will advance to the next stage. Rejecting returns it to the previous approver.';
              })()}
              {reviewModal.workflow_type !== 'xlr8' && (() => {
                const stages = WORKFLOWS[reviewModal.workflow_type!] ?? [];
                const i = stages.findIndex((s) => s.status === reviewModal.status);
                return i === 0 ? ' Rejection at this stage fully rejects the submission.' : null;
              })()}
            </>
          ) : (
            <>
              {reviewModal.status === 'pending_manager' && 'Approve to send for admin review, or reject to return to the employee.'}
              {reviewModal.status === 'pending_admin'   && 'Approve to send to the client, or reject.'}
              {reviewModal.status === 'pending_client'  && 'Approve to authorize work to start, or reject.'}
              {reviewModal.status === 'pending_review'  && 'Approve the completed work, or request revisions.'}
            </>
          )}
        </p>

        <div className="review-action-row">
          <button
            onClick={() => setAction('approve')}
            className={`review-action-btn approve${action === 'approve' ? ' selected' : ''}`}
          >
            <CheckCircle size={15} /> Approve
          </button>
          {isNewWorkflow(reviewModal) && !(reviewModal.workflow_type === 'xlr8' && ['pending_client'].includes((reviewModal as any).xlr8_status ?? reviewModal.status)) ? (
            <button
              onClick={() => setAction('reject')}
              className={`review-action-btn changes${action === 'reject' ? ' selected' : ''}`}
            >
              <XCircle size={15} /> Reject
            </button>
          ) : reviewModal.status === 'pending_review' ? (
            <button
              onClick={() => setAction('request_revision')}
              className={`review-action-btn changes${action === 'request_revision' ? ' selected' : ''}`}
            >
              <RotateCcw size={15} /> Request Revision
            </button>
          ) : (
            <button
              onClick={() => setAction('reject')}
              className={`review-action-btn changes${action === 'reject' ? ' selected' : ''}`}
            >
              <XCircle size={15} /> Reject
            </button>
          )}
        </div>

        {reviewModal.workflow_type === 'xlr8' && action === 'reject' && reviewModal.task_id && ((reviewModal as any).xlr8_status ?? reviewModal.status) !== 'pending_client' && (
          <SendBackStagePicker ticketId={reviewModal.task_id} value={returnIdx} onChange={setReturnIdx} />
        )}

        <div>
          <label className="form-label">
            {action === 'approve' ? 'Notes (optional)' : action === 'reject' ? 'Rejection reason *' : 'Revision notes *'}
          </label>
          <textarea
            className="form-input"
            style={{ resize: 'none' }}
            rows={4}
            placeholder={
              action === 'approve' ? 'Any comments…'
              : action === 'reject' ? 'Why is this rejected? (required)'
              : 'What needs to be revised?'
            }
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>

      <div className="drawer-footer">
        <button
          onClick={() => submitReview()}
          disabled={submitting || (action !== 'approve' && !notes.trim())}
          className={`drawer-submit${action !== 'approve' ? ' drawer-submit--danger' : ''}`}
        >
          {submitting ? 'Saving…' : action === 'approve' ? 'Approve' : action === 'reject' ? 'Reject' : 'Request Revision'}
        </button>
        {reviewModal?.workflow_type === 'xlr8' && action === 'approve' && (() => {
          const st = (reviewModal as any).xlr8_status ?? reviewModal.status;
          if (st === 'pending_admin') return (
            <button key="send-client" className="drawer-cancel" style={{ color: 'var(--blue)', borderColor: 'var(--blue)' }}
              disabled={submitting} onClick={() => submitReview('send_client')}>
              Skip Client
            </button>
          );
          if (st === 'pending_manager') return (
            <button key="skip-admin" className="drawer-cancel" style={{ color: 'var(--orange)', borderColor: 'var(--orange)' }}
              disabled={submitting} onClick={() => submitReview('skip_admin')}>
              Skip Admin
            </button>
          );
          return null;
        })()}
        <button className="drawer-cancel" onClick={() => setReviewModal(null)} disabled={submitting}>
          Cancel
        </button>
      </div>
    </>
  );
}
