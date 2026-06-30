import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { CheckCircle, XCircle, ChevronDown, ChevronUp, RotateCcw, CheckCheck } from 'lucide-react';
import Layout from '../components/Layout/Layout';
import Header from '../components/Layout/Header';
import Badge from '../components/UI/Badge';
import Avatar from '../components/UI/Avatar';
import Modal from '../components/UI/Modal';
import { useAuth } from '../contexts/AuthContext';
import { approvalsApi } from '../services/api';
import { Approval, ApprovalStatus } from '../types';
import '../css/pages/Approvals.css';

// Status → human label + color
const STATUS_META: Record<ApprovalStatus, { label: string; color: string }> = {
  pending_manager:    { label: 'Pending Manager',    color: 'var(--yellow)' },
  pending_admin:      { label: 'Pending Admin',       color: 'var(--orange)' },
  pending_client:     { label: 'Pending Client',      color: '#9b59b6' },
  work_in_progress:   { label: 'In Progress',         color: '#4A90E2' },
  pending_review:     { label: 'Pending Review',      color: 'var(--orange)' },
  revision_requested: { label: 'Revision Requested',  color: 'var(--red)' },
  approved:           { label: 'Approved',            color: 'var(--green)' },
  rejected:           { label: 'Rejected',            color: 'var(--red)' },
};

// Timeline steps for the new workflow
const TIMELINE = [
  { key: 'submitted',     label: 'Submitted' },
  { key: 'mgr_review',   label: 'Manager' },
  { key: 'admin_review', label: 'Admin' },
  { key: 'client_review',label: 'Client' },
  { key: 'in_work',      label: 'In Work' },
  { key: 'final_review', label: 'Review' },
  { key: 'approved',     label: 'Done' },
];

function timelineIndex(status: ApprovalStatus): number {
  const map: Record<ApprovalStatus, number> = {
    pending_manager:    1,
    pending_admin:      2,
    pending_client:     3,
    work_in_progress:   4,
    pending_review:     5,
    revision_requested: 5,
    approved:           6,
    rejected:           1,
  };
  return map[status] ?? 0;
}

function getRejectionIndex(a: Approval): number {
  if (!a.manager_approved_at) return 1;
  if (!a.admin_approved_at) return 2;
  return 3;
}

export default function Approvals() {
  const { user } = useAuth();
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading]     = useState(true);
  const [reviewModal, setReviewModal] = useState<Approval | null>(null);
  const [action, setAction]           = useState<'approve' | 'reject' | 'request_revision'>('approve');
  const [notes, setNotes]             = useState('');
  const [expanded, setExpanded]       = useState<number | null>(null);

  const load = () => {
    setLoading(true);
    approvalsApi.list().then((r) => setApprovals(r.data)).catch(console.error).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const canReview = (a: Approval): boolean => {
    if (user?.role === 'manager' && a.status === 'pending_manager') return true;
    if (user?.role === 'admin'   && a.status === 'pending_admin')   return true;
    if (user?.role === 'client'  && a.status === 'pending_client')  return true;
    if (a.status === 'pending_review') {
      if (user?.role === 'manager' || user?.role === 'admin' || user?.role === 'client') return true;
    }
    return false;
  };

  const canMarkComplete = (a: Approval): boolean =>
    a.status === 'work_in_progress' &&
    (user?.role === 'employee' || user?.role === 'manager' || user?.role === 'admin');

  const markComplete = async (a: Approval) => {
    if (!confirm(`Mark "${a.title}" as completed and send for review?`)) return;
    try {
      await approvalsApi.markComplete(a.id);
      load();
    } catch (err: any) { alert(err.response?.data?.error || 'Error'); }
  };

  const submitReview = async () => {
    if (!reviewModal) return;
    try {
      await approvalsApi.review(reviewModal.id, action as any, notes);
      setReviewModal(null);
      load();
    } catch (err: any) { alert(err.response?.data?.error || 'Error'); }
  };

  const openReview = (a: Approval, e: React.MouseEvent) => {
    e.stopPropagation();
    setReviewModal(a);
    // Default action based on stage
    setAction(a.status === 'pending_review' ? 'approve' : 'approve');
    setNotes('');
  };

  const isEarlyStage = (a: Approval) =>
    a.status === 'pending_manager' || a.status === 'pending_admin' || a.status === 'pending_client';

  return (
    <Layout>
      <div className="page-wrap">
        <Header />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h2 className="page-title">{user?.role === 'client' ? 'Pending Reviews' : 'Approvals'}</h2>
            <p className="page-subtitle">{approvals.length} item{approvals.length !== 1 ? 's' : ''}</p>
          </div>
        </div>

        {loading && <p className="page-subtitle">Loading…</p>}
        {approvals.length === 0 && !loading && <div className="empty-state">No approvals at this stage</div>}

        <div className="approvals-list">
          {approvals.map((a) => {
            const idx = timelineIndex(a.status);
            const meta = STATUS_META[a.status];
            return (
              <div key={a.id} className="approval-card">
                <div className="approval-card__row" onClick={() => setExpanded(expanded === a.id ? null : a.id)}>
                  <Avatar name={a.submitted_by_name} color={a.submitted_by_color} size="md" />

                  <div className="approval-card__info">
                    <p className="approval-card__title">{a.title}</p>
                    <p className="approval-card__meta">
                      {a.project_name}{a.client_name ? ` · ${a.client_name}` : ''} · {format(new Date(a.created_at), 'MMM d')}
                    </p>
                  </div>

                  {/* Mini progress dots */}
                  <div className="approval-steps">
                    {TIMELINE.map((step, i) => {
                      const done   = i < idx || a.status === 'approved';
                      const active = i === idx && a.status !== 'rejected';
                      const isRejectedStep = a.status === 'rejected' && i <= getRejectionIndex(a);
                      return (
                        <div key={step.key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <div
                            className="approval-step-dot"
                            style={{
                              background: isRejectedStep ? 'var(--red)'
                                : done ? 'var(--green)'
                                : active ? meta.color
                                : 'var(--bg-sand)',
                            }}
                            title={step.label}
                          />
                          {i < TIMELINE.length - 1 && <div className="approval-step-line" />}
                        </div>
                      );
                    })}
                  </div>

                  <div className="approval-card__actions">
                    {/* Status pill */}
                    <span className="approval-status-pill" style={{ '--pill-color': meta.color } as any}>
                      {meta.label}
                    </span>

                    {/* Mark complete button (for employee after admin approved) */}
                    {canMarkComplete(a) && (
                      <button
                        className="btn-secondary"
                        style={{ padding: '7px 12px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}
                        onClick={(e) => { e.stopPropagation(); markComplete(a); }}
                      >
                        <CheckCheck size={13} /> Mark Complete
                      </button>
                    )}

                    {/* Review button */}
                    {canReview(a) && (
                      <button
                        className="btn-primary"
                        style={{ padding: '7px 14px', fontSize: 12 }}
                        onClick={(e) => openReview(a, e)}
                      >
                        Review
                      </button>
                    )}

                    {expanded === a.id
                      ? <ChevronUp size={15} style={{ color: 'var(--ink-muted)' }} />
                      : <ChevronDown size={15} style={{ color: 'var(--ink-muted)' }} />}
                  </div>
                </div>

                {expanded === a.id && (
                  <div className="approval-card__detail">
                    {/* Timeline */}
                    <div className="approval-timeline">
                      {[
                        { label: 'Submitted',    date: a.created_at,           done: true,                       active: false },
                        { label: 'Manager',      date: a.manager_approved_at,  done: !!a.manager_approved_at,    active: a.status === 'pending_manager' },
                        { label: 'Admin',        date: a.admin_approved_at,    done: !!a.admin_approved_at,      active: a.status === 'pending_admin' },
                        { label: 'Client',       date: null,                   done: ['work_in_progress','pending_review','revision_requested','approved'].includes(a.status), active: a.status === 'pending_client' },
                        { label: 'In Work',      date: null,                   done: ['pending_review','revision_requested','approved'].includes(a.status), active: a.status === 'work_in_progress' },
                        { label: 'Review',       date: a.work_submitted_at,    done: !!a.work_submitted_at && a.status !== 'work_in_progress', active: a.status === 'pending_review' },
                        { label: 'Approved',     date: a.final_approved_at,    done: a.status === 'approved',    active: false },
                      ].map((step, i, arr) => (
                        <div key={step.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div className={`timeline-chip ${step.done ? 'timeline-chip--done' : step.active ? 'timeline-chip--active' : 'timeline-chip--pending'}`}>
                            <div
                              className="timeline-chip-dot"
                              style={{ background: step.done ? 'var(--green)' : step.active ? 'var(--yellow)' : 'var(--sand-border)' }}
                            />
                            {step.label}
                            {step.done && step.date && (
                              <span style={{ opacity: 0.6, fontSize: 10 }}>{format(new Date(step.date), 'MMM d')}</span>
                            )}
                          </div>
                          {i < arr.length - 1 && <div className="timeline-line" />}
                        </div>
                      ))}
                    </div>

                    {/* Notes */}
                    {[
                      { label: 'Manager notes',  text: a.manager_notes },
                      { label: 'Admin notes',    text: a.admin_notes },
                      { label: 'Revision notes', text: a.revision_notes },
                      { label: 'Final notes',    text: a.final_notes },
                      { label: 'Rejection',      text: a.rejection_notes },
                    ].filter((n) => n.text).map((n) => (
                      <div key={n.label} className={`approval-note${n.label === 'Rejection' ? ' approval-note--danger' : ''}`}>
                        <strong>{n.label}</strong>
                        {n.text}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {reviewModal && (
        <Modal title={`Review: ${reviewModal.title}`} onClose={() => setReviewModal(null)} size="sm">
          <div>
            <p className="review-desc">
              {reviewModal.status === 'pending_manager' && 'Approve to send for admin review, or reject to return to the employee.'}
              {reviewModal.status === 'pending_admin'   && 'Approve to officially assign this task, or reject to return to the employee.'}
              {reviewModal.status === 'pending_client'  && 'Approve to authorize the start of work, or reject to return to the employee.'}
              {reviewModal.status === 'pending_review'  && 'Approve the completed work, or request revisions from the employee.'}
            </p>

            <div className={`review-action-row${isEarlyStage(reviewModal) ? ' three-col' : ''}`}>
              <button onClick={() => setAction('approve')} className={`review-action-btn approve${action === 'approve' ? ' selected' : ''}`}>
                <CheckCircle size={15} /> Approve
              </button>
              {reviewModal.status === 'pending_review' ? (
                <button onClick={() => setAction('request_revision')} className={`review-action-btn changes${action === 'request_revision' ? ' selected' : ''}`}>
                  <RotateCcw size={15} /> Revise
                </button>
              ) : (
                <button onClick={() => setAction('reject')} className={`review-action-btn changes${action === 'reject' ? ' selected' : ''}`}>
                  <XCircle size={15} /> Reject
                </button>
              )}
            </div>

            <div className="modal-form-row">
              <label className="form-label">
                {action === 'approve' ? 'Notes (optional)' : action === 'reject' ? 'Rejection reason *' : 'Revision notes *'}
              </label>
              <textarea
                className="form-input"
                style={{ resize: 'none' }}
                rows={3}
                placeholder={
                  action === 'approve' ? 'Any comments…'
                  : action === 'reject' ? 'Why is this rejected?'
                  : 'What needs to be revised?'
                }
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <div className="modal-actions">
              <button onClick={() => setReviewModal(null)} className="btn-secondary">Cancel</button>
              <button
                onClick={submitReview}
                disabled={action !== 'approve' && !notes.trim()}
                className={action === 'approve' ? 'review-submit-approve' : 'review-submit-changes'}
              >
                {action === 'approve' ? 'Approve' : action === 'reject' ? 'Reject' : 'Request revision'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </Layout>
  );
}
