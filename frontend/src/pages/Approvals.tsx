import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { CheckCircle, XCircle, ChevronDown, ChevronUp, CheckCheck, RotateCcw } from 'lucide-react';
import Pagination from '../components/UI/Pagination';

const PAGE_SIZE = 7;
import Layout from '../components/Layout/Layout';
import Avatar from '../components/UI/Avatar';
import Drawer from '../components/UI/Drawer';
import { useAuth } from '../contexts/AuthContext';
import { approvalsApi } from '../services/api';
import { Approval, ApprovalStatus, ApprovalStep, WorkflowType } from '../types';
import '../css/pages/Approvals.css';

// ─── State machine definition (mirrors backend) ───────────────────────────────

interface WFStage {
  status: string;
  role: 'manager' | 'admin' | 'client';
  label: string;
}

const WORKFLOWS: Record<string, WFStage[]> = {
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

function getTimeline(wfType: WorkflowType): Array<{ key: string; label: string }> {
  if (!wfType || wfType === 'admin_no_client') return LEGACY_TIMELINE;
  const stages = WORKFLOWS[wfType] ?? [];
  return [
    { key: 'submitted', label: 'Submitted' },
    ...stages.map((s) => ({ key: s.status, label: s.label })),
    { key: 'approved', label: 'Done' },
  ];
}

function getDotState(
  stageKey: string,
  approval: Approval,
  timeline: Array<{ key: string; label: string }>
): 'done' | 'active' | 'rejected' | 'pending' {
  if (approval.status === 'approved') return 'done';
  if (stageKey === 'submitted') return 'done';
  if (approval.status === 'rejected') {
    const current = timeline.findIndex((t) => t.key === approval.status);
    const me = timeline.findIndex((t) => t.key === stageKey);
    return me <= current ? 'rejected' : 'pending';
  }
  const currentIdx = timeline.findIndex((t) => t.key === approval.status);
  const myIdx = timeline.findIndex((t) => t.key === stageKey);
  if (myIdx < 0) return 'pending';
  if (myIdx < currentIdx) return 'done';
  if (myIdx === currentIdx) return 'active';
  return 'pending';
}

// ─── Status display map ───────────────────────────────────────────────────────

const STATUS_META: Record<ApprovalStatus, { label: string; color: string }> = {
  pending_manager:       { label: 'Pending Manager',        color: 'var(--yellow)' },
  pending_admin:         { label: 'Pending Admin',           color: 'var(--orange)' },
  pending_client:        { label: 'Pending Client',          color: '#9b59b6' },
  pending_admin_final:   { label: 'Admin Final Review',      color: 'var(--orange)' },
  pending_manager_final: { label: 'Manager Confirmation',    color: 'var(--yellow)' },
  work_in_progress:      { label: 'In Progress',             color: 'var(--blue)' },
  pending_review:        { label: 'Pending Review',          color: 'var(--orange)' },
  revision_requested:    { label: 'Revision Requested',      color: 'var(--red)' },
  pending_custom:        { label: 'In Review',               color: 'var(--blue)' },
  approved:              { label: 'Approved',                color: 'var(--green)' },
  rejected:              { label: 'Rejected',                color: 'var(--red)' },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getCurrentStageLabel(a: Approval): string {
  if (!a.workflow_type || a.workflow_type === 'admin_no_client') return STATUS_META[a.status]?.label ?? a.status;
  const stages = WORKFLOWS[a.workflow_type] ?? [];
  const stage = stages.find((s) => s.status === a.status);
  return stage ? stage.label : STATUS_META[a.status]?.label ?? a.status;
}

function getNextApproverRole(a: Approval): string | null {
  if (!a.workflow_type || a.workflow_type === 'admin_no_client') return null;
  const stages = WORKFLOWS[a.workflow_type] ?? [];
  const stage = stages.find((s) => s.status === a.status);
  return stage ? stage.role : null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Approvals() {
  const { user } = useAuth();
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading]     = useState(true);
  const [expanded, setExpanded]   = useState<number | null>(null);
  const [steps, setSteps]         = useState<Record<number, ApprovalStep[]>>({});

  // Review modal state
  const [reviewModal, setReviewModal]   = useState<Approval | null>(null);
  const [action, setAction]             = useState<'approve' | 'reject' | 'request_revision'>('approve');
  const [notes, setNotes]               = useState('');
  const [submitting, setSubmitting]     = useState(false);

  const [podTab, setPodTab] = useState<'pod1' | 'pod2'>('pod1');
  const [page, setPage]     = useState(1);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [dateFilter, setDateFilter] = useState('');

  const load = (pod?: string) => {
    setLoading(true);
    const podParam = user?.role === 'admin' ? pod : undefined;
    approvalsApi.list(podParam).then((r) => setApprovals(r.data)).catch(console.error).finally(() => setLoading(false));
  };

  useEffect(() => { load(podTab); }, [podTab]);

  const expand = async (id: number) => {
    const isOpen = expanded === id;
    setExpanded(isOpen ? null : id);
    if (!isOpen && !steps[id]) {
      try {
        const res = await approvalsApi.steps(id);
        setSteps((prev) => ({ ...prev, [id]: res.data }));
      } catch { /* silent */ }
    }
  };

  // Who can review this approval right now
  const canReview = (a: Approval): boolean => {
    if (!user) return false;
    if (a.status === 'approved' || a.status === 'rejected') return false;
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
  };

  const canMarkComplete = (a: Approval) =>
    a.status === 'work_in_progress' &&
    (user?.role === 'employee' || user?.role === 'manager' || user?.role === 'admin');

  const markComplete = async (a: Approval) => {
    if (!confirm(`Mark "${a.title}" as completed?`)) return;
    try { await approvalsApi.markComplete(a.id); load(); }
    catch (err: any) { alert(err.response?.data?.error || 'Error'); }
  };

  const openReview = (a: Approval, e: React.MouseEvent) => {
    e.stopPropagation();
    setReviewModal(a);
    setAction('approve');
    setNotes('');
  };

  const submitReview = async () => {
    if (!reviewModal) return;
    if (action !== 'approve' && !notes.trim()) { alert('Please add a reason'); return; }
    setSubmitting(true);
    try {
      await approvalsApi.review(reviewModal.id, action, notes);
      setReviewModal(null);
      // Refresh steps cache for this approval
      setSteps((prev) => { const next = { ...prev }; delete next[reviewModal.id]; return next; });
      load();
    } catch (err: any) { alert(err.response?.data?.error || 'Error'); }
    finally { setSubmitting(false); }
  };

  // Whether this approval uses the new state machine
  const isNewWorkflow = (a: Approval) => !!a.workflow_type && a.workflow_type !== 'admin_no_client';
  const isLegacy = (a: Approval) => !a.workflow_type;

  const filtered = approvals.filter(a => {
    if (statusFilter === 'pending' && (a.status === 'approved' || a.status === 'rejected')) return false;
    if (statusFilter === 'approved' && a.status !== 'approved') return false;
    if (statusFilter === 'rejected' && a.status !== 'rejected') return false;
    if (dateFilter && a.created_at.slice(0, 10) !== dateFilter) return false;
    return true;
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <Layout>
      <div className="page-wrap">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h2 className="page-title">{user?.role === 'client' ? 'Pending Reviews' : 'Approvals'}</h2>
            <p className="page-subtitle">{filtered.length} of {approvals.length} item{approvals.length !== 1 ? 's' : ''}</p>
          </div>
          {user?.role === 'admin' && (
            <div className="filter-bar">
              {(['pod1', 'pod2'] as const).map((p) => (
                <button key={p} className={`filter-tab${podTab === p ? ' active' : ''}`}
                  onClick={() => { setPodTab(p); setPage(1); }}>
                  {p === 'pod1' ? 'Pod 1' : 'Pod 2'}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Status + date filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <div className="filter-bar">
            {(['all', 'pending', 'approved', 'rejected'] as const).map((s) => (
              <button key={s} className={`filter-tab${statusFilter === s ? ' active' : ''}`}
                onClick={() => { setStatusFilter(s); setPage(1); }}>
                {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          <input
            type="date"
            className="form-input"
            style={{ width: 150, fontSize: 12, padding: '7px 12px' }}
            value={dateFilter}
            onChange={(e) => { setDateFilter(e.target.value); setPage(1); }}
          />
          {dateFilter && (
            <button className="filter-tab" style={{ padding: '7px 10px', fontSize: 11 }}
              onClick={() => { setDateFilter(''); setPage(1); }}>✕</button>
          )}
        </div>

        {loading && <p className="page-subtitle">Loading…</p>}
        {filtered.length === 0 && !loading && <div className="empty-state">No approvals at this stage</div>}

        <div className="approvals-list">
          {paginated.map((a) => {
            const meta = STATUS_META[a.status] ?? { label: a.status, color: 'var(--ink-muted)' };
            const timeline = getTimeline(a.workflow_type);

            return (
              <div key={a.id} className="approval-card">
                {/* Header row */}
                <div className="approval-card__row" onClick={() => expand(a.id)}>
                  <Avatar name={a.submitted_by_name} color={a.submitted_by_color} size="md" />

                  <div className="approval-card__info">
                    <p className="approval-card__title">{a.title}</p>
                    <p className="approval-card__meta">
                      {a.project_name}{a.client_name ? ` · ${a.client_name}` : ''} · {format(new Date(a.created_at), 'MMM d')}
                    </p>
                    {a.worker_name && (
                      <p className="approval-card__meta" style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Avatar name={a.worker_name} color={a.worker_avatar_color ?? undefined} size="sm" />
                        <span>Worked by <strong style={{ color: 'var(--ink)' }}>{a.worker_name}</strong></span>
                      </p>
                    )}
                  </div>

                  {/* Progress dots */}
                  <div className="approval-steps">
                    {timeline.map((step, i) => {
                      const dotState = getDotState(step.key, a, timeline);
                      const dotColor =
                        dotState === 'done'     ? 'var(--green)' :
                        dotState === 'active'   ? meta.color :
                        dotState === 'rejected' ? 'var(--red)' :
                        'var(--bg-sand)';
                      return (
                        <div key={step.key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <div className="approval-step-dot" style={{ background: dotColor }} title={step.label} />
                          {i < timeline.length - 1 && <div className="approval-step-line" />}
                        </div>
                      );
                    })}
                  </div>

                  <div className="approval-card__actions">
                    <span className="approval-status-pill" style={{ '--pill-color': meta.color } as any}>
                      {meta.label}
                    </span>

                    {canMarkComplete(a) && (
                      <button
                        className="btn-secondary"
                        style={{ padding: '7px 12px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}
                        onClick={(e) => { e.stopPropagation(); markComplete(a); }}
                      >
                        <CheckCheck size={13} /> Mark Complete
                      </button>
                    )}

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

                {/* Expanded detail */}
                {expanded === a.id && (
                  <div className="approval-card__detail">

                    {/* Workflow info */}
                    {isNewWorkflow(a) && (
                      <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ink-muted)', marginBottom: 8 }}>
                          {a.workflow_type === 'custom' ? 'Approvers (Sequential)' : `Approval Path · ${a.workflow_type?.replace(/_/g, ' ')} workflow`}
                        </div>

                        {/* Custom flow: named approver chips with current-step indicator */}
                        {a.workflow_type === 'custom' && a.flow_chain && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 6 }}>
                            {a.flow_chain.map((step, i) => {
                              const currentStep = a.current_step ?? 0;
                              const isDone     = a.status === 'approved' || i < currentStep;
                              const isActive   = a.status !== 'approved' && a.status !== 'rejected' && i === currentStep;
                              const isRejected = a.status === 'rejected' && i === currentStep;
                              // Find the audit record for this step
                              const acted = steps[a.id]?.find((s) => s.stage_key === `step_${i}`);
                              return (
                                <div key={step.user_id} style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                                    <div style={{
                                      display: 'inline-flex', alignItems: 'center', gap: 6,
                                      padding: '5px 12px 5px 6px',
                                      borderRadius: 'var(--r-pill)',
                                      background: isDone ? 'rgba(76,175,125,0.12)' : isRejected ? 'rgba(232,66,74,0.10)' : isActive ? 'rgba(99,102,241,0.10)' : 'var(--bg-sand)',
                                      border: `1.5px solid ${isDone ? 'var(--green)' : isRejected ? 'var(--red)' : isActive ? 'var(--blue)' : 'var(--sand-border)'}`,
                                      fontSize: 12, fontWeight: 600,
                                      color: isDone ? 'var(--green)' : isRejected ? 'var(--red)' : isActive ? 'var(--blue)' : 'var(--ink-muted)',
                                    }}>
                                      <div style={{ width: 22, height: 22, borderRadius: '50%', background: step.avatar_color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#fff', fontWeight: 800, flexShrink: 0 }}>
                                        {step.name.split(' ').map((n:string)=>n[0]).join('').toUpperCase().slice(0,2)}
                                      </div>
                                      {isActive && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--blue)', flexShrink: 0 }} />}
                                      {step.name}
                                    </div>
                                    {/* Show who acted on this step */}
                                    {acted && (
                                      <div style={{ fontSize: 10, color: acted.action === 'approve' ? 'var(--green)' : 'var(--red)', paddingLeft: 4, display: 'flex', flexDirection: 'column', gap: 1 }}>
                                        <span style={{ fontWeight: 700 }}>
                                          {acted.action === 'approve' ? '✓ Approved' : '✗ Rejected'} by {acted.actor_name}
                                        </span>
                                        <span style={{ color: 'var(--ink-muted)' }}>
                                          {format(new Date(acted.acted_at), 'MMM d, h:mm a')}
                                        </span>
                                        {acted.comments && (
                                          <span style={{ color: 'var(--ink-muted)', fontStyle: 'italic' }}>"{acted.comments}"</span>
                                        )}
                                      </div>
                                    )}
                                    {isActive && !acted && (
                                      <div style={{ fontSize: 10, color: 'var(--ink-muted)', paddingLeft: 4 }}>Waiting for review…</div>
                                    )}
                                  </div>
                                  {i < (a.flow_chain?.length ?? 0) - 1 && (
                                    <div style={{ width: 16, height: 1.5, background: 'var(--sand-border)', flexShrink: 0, marginTop: 14 }} />
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Legacy step timeline */}
                        {a.workflow_type !== 'custom' && (
                          <div className="approval-timeline" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
                            {[{ key: 'submitted', label: 'Submitted' }, ...(WORKFLOWS[a.workflow_type!] ?? []).map(s => ({ key: s.status, label: s.label })), { key: 'approved', label: 'Done' }].map((step, i, arr) => {
                              const dotState = getDotState(step.key, a, timeline);
                              const acted = steps[a.id]?.find((s) => s.stage_key === step.key);
                              return (
                                <div key={step.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
                                    <div className={`timeline-chip ${dotState === 'done' ? 'timeline-chip--done' : dotState === 'active' ? 'timeline-chip--active' : dotState === 'rejected' ? 'timeline-chip--active' : 'timeline-chip--pending'}`}
                                      style={dotState === 'rejected' ? { background: 'rgba(232,66,74,0.1)', color: 'var(--red)' } : {}}>
                                      <div className="timeline-chip-dot" style={{
                                        background: dotState === 'done' ? 'var(--green)' : dotState === 'active' ? 'var(--yellow)' : dotState === 'rejected' ? 'var(--red)' : 'var(--sand-border)'
                                      }} />
                                      {step.label}
                                    </div>
                                    {acted && (
                                      <div style={{ fontSize: 10, paddingLeft: 4, display: 'flex', flexDirection: 'column', gap: 1, color: acted.action === 'approve' ? 'var(--green)' : 'var(--red)' }}>
                                        <span style={{ fontWeight: 700 }}>
                                          {acted.action === 'approve' ? '✓' : '✗'} {acted.actor_name}
                                        </span>
                                        <span style={{ color: 'var(--ink-muted)' }}>{format(new Date(acted.acted_at), 'MMM d')}</span>
                                      </div>
                                    )}
                                  </div>
                                  {i < arr.length - 1 && <div className="timeline-line" style={{ marginTop: 12 }} />}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Current approver info (legacy) */}
                        {a.workflow_type !== 'custom' && a.status !== 'approved' && a.status !== 'rejected' && (
                          <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 10 }}>
                            <strong style={{ color: 'var(--ink)' }}>Waiting for:</strong>{' '}
                            <span style={{ textTransform: 'capitalize' }}>{getNextApproverRole(a)}</span>
                            {' — '}<span style={{ color: 'var(--ink-muted)' }}>{getCurrentStageLabel(a)}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Legacy timeline */}
                    {isLegacy(a) && (
                      <div className="approval-timeline" style={{ marginBottom: 14 }}>
                        {[
                          { label: 'Submitted', date: a.created_at,          done: true,                       active: false },
                          { label: 'Manager',   date: a.manager_approved_at,  done: !!a.manager_approved_at,    active: a.status === 'pending_manager' },
                          { label: 'Admin',     date: a.admin_approved_at,    done: !!a.admin_approved_at,      active: a.status === 'pending_admin' },
                          { label: 'Client',    date: null,                   done: ['work_in_progress','pending_review','revision_requested','approved'].includes(a.status), active: a.status === 'pending_client' },
                          { label: 'In Work',   date: null,                   done: ['pending_review','revision_requested','approved'].includes(a.status), active: a.status === 'work_in_progress' },
                          { label: 'Review',    date: a.work_submitted_at,    done: !!a.work_submitted_at && a.status !== 'work_in_progress', active: a.status === 'pending_review' },
                          { label: 'Approved',  date: a.final_approved_at,    done: a.status === 'approved',    active: false },
                        ].map((step, i, arr) => (
                          <div key={step.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div className={`timeline-chip ${step.done ? 'timeline-chip--done' : step.active ? 'timeline-chip--active' : 'timeline-chip--pending'}`}>
                              <div className="timeline-chip-dot" style={{ background: step.done ? 'var(--green)' : step.active ? 'var(--yellow)' : 'var(--sand-border)' }} />
                              {step.label}
                              {step.done && step.date && (
                                <span style={{ opacity: 0.6, fontSize: 10 }}>{format(new Date(step.date), 'MMM d')}</span>
                              )}
                            </div>
                            {i < arr.length - 1 && <div className="timeline-line" />}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Audit step history */}
                    {(steps[a.id]?.length ?? 0) > 0 && (
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ink-muted)', marginBottom: 8 }}>
                          Decision History
                        </div>
                        {steps[a.id].map((step) => (
                          <div key={step.id} className={`approval-note${step.action === 'reject' ? ' approval-note--danger' : ''}`}>
                            <strong>
                              {step.actor_name} ({step.actor_role}) · {step.action === 'approve' ? '✓ Approved' : '✗ Rejected'} · {format(new Date(step.acted_at), 'MMM d, h:mm a')}
                            </strong>
                            {step.comments && <span> — {step.comments}</span>}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Legacy notes */}
                    {isLegacy(a) && [
                      { label: 'Manager notes',  text: a.manager_notes },
                      { label: 'Admin notes',    text: a.admin_notes },
                      { label: 'Revision notes', text: a.revision_notes },
                      { label: 'Final notes',    text: a.final_notes },
                      { label: 'Rejection',      text: a.rejection_notes },
                    ].filter((n) => n.text).map((n) => (
                      <div key={n.label} className={`approval-note${n.label === 'Rejection' ? ' approval-note--danger' : ''}`}>
                        <strong>{n.label}</strong>{n.text}
                      </div>
                    ))}

                    {/* Rejection note */}
                    {isNewWorkflow(a) && a.rejection_notes && (
                      <div className="approval-note approval-note--danger">
                        <strong>Rejection reason</strong>{a.rejection_notes}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <Pagination page={page} totalPages={totalPages} total={filtered.length} pageSize={PAGE_SIZE} onPage={setPage} />
      </div>

      {/* Review drawer */}
      {reviewModal && (
        <Drawer
          label="Review Approval"
          title={reviewModal.title}
          onClose={() => setReviewModal(null)}
        >
          <div className="drawer-body">
            <p className="review-desc">
              {isNewWorkflow(reviewModal) ? (
                <>
                  <strong>{getCurrentStageLabel(reviewModal)}</strong>
                  {' — Approving will advance to the next stage. Rejecting returns it to the previous approver.'}
                  {(() => {
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
              {isNewWorkflow(reviewModal) ? (
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
              onClick={submitReview}
              disabled={submitting || (action !== 'approve' && !notes.trim())}
              className={`drawer-submit${action !== 'approve' ? ' drawer-submit--danger' : ''}`}
            >
              {submitting ? 'Saving…' : action === 'approve' ? 'Approve' : action === 'reject' ? 'Reject' : 'Request Revision'}
            </button>
            <button className="drawer-cancel" onClick={() => setReviewModal(null)} disabled={submitting}>
              Cancel
            </button>
          </div>
        </Drawer>
      )}
    </Layout>
  );
}
