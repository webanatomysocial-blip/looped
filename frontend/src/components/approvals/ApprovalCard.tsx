import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { ChevronDown, ChevronUp, CheckCheck, Play, Pause, Clock, Paperclip, Link2, ExternalLink } from 'lucide-react';
import { StageTag } from '../UI/ChecklistEditor';
import XLR8StageFlow from '../UI/XLR8StageFlow';
import Avatar, { MiniAvatar } from '../UI/Avatar';
import AttachmentMeta from '../UI/AttachmentMeta';
import { approvalsApi, tasksApi, xlr8Api } from '../../services/api';
import { Approval, ApprovalStep, ChecklistItem } from '../../types';
import {
  STATUS_META, WORKFLOWS, getTimeline, getDotState, getCurrentStageLabel, getNextApproverRole,
  isNewWorkflow, isLegacy, parseTs, canReviewApproval, canMarkCompleteApproval,
} from './approvalWorkflow';
import ReviewForm from './ReviewForm';
import type { ApprovalActions } from './useApprovalActions';
import '../../css/pages/Approvals.css';

interface Props {
  a: Approval;
  actions: ApprovalActions;
  expanded?: boolean;
  onToggle?: () => void;
  // Compact: header row only (the task drawer already shows the stage flow and attachments)
  compact?: boolean;
}

// One task's approval: header (progress dots, status, Start/Pause Review, Review), and expandable detail.
export default function ApprovalCard({ a, actions, expanded = false, onToggle, compact = false }: Props) {
  const { user, timers, fmtSeconds, startReviewTimer, pauseReviewTimer, markComplete, openReview, form, reviewedAt, inlineReview } = actions;
  const [steps, setSteps]           = useState<ApprovalStep[] | null>(null);
  const [taskDetail, setTaskDetail] = useState<any>(null);
  const [checklist, setChecklist]   = useState<ChecklistItem[]>([]);
  const [ticketLog, setTicketLog]   = useState<any[]>([]);

  // Load detail when opened; reload after a review changed it
  useEffect(() => {
    if (!expanded || compact) return;
    approvalsApi.steps(a.id).then((res) => setSteps(res.data)).catch(() => {});
    Promise.all([
      tasksApi.get(a.task_id),
      tasksApi.getDeliverables(a.task_id).catch(() => ({ data: [] })),
    ]).then(([res, dlRes]) => {
      setTaskDetail({ ...res.data, deliverables: dlRes.data });
      setChecklist((res.data.checklist || []).filter((i: ChecklistItem) => i.completed));
    }).catch(() => {});
    if (a.workflow_type === 'xlr8') xlr8Api.getTicketLog(a.task_id).then((lr) => setTicketLog(lr.data)).catch(() => {});
  }, [expanded, compact, a.id, a.status, (a as any).xlr8_status, reviewedAt]);

  const meta = STATUS_META[a.status] ?? { label: a.status, color: 'var(--ink-muted)' };
  const timeline = getTimeline(a.workflow_type);
  const reviewingHere = inlineReview && form.reviewModal?.id === a.id;

  return (
    <div className="approval-card">
      {/* Header row */}
      <div className="approval-card__row" onClick={compact ? undefined : onToggle} style={compact ? { cursor: 'default' } : undefined}>
        {!compact && <Avatar name={a.submitted_by_name} color={a.submitted_by_color} avatarUrl={(a as any).submitted_by_avatar_url} size="md" />}

        <div className="approval-card__info">
          {compact ? (
            <p className="approval-card__title">{getCurrentStageLabel(a)}</p>
          ) : (
            <>
              <p className="approval-card__title">{a.title}</p>
              <p className="approval-card__meta">
                {a.project_name}{a.client_name ? ` · ${a.client_name}` : ''} · {format(parseTs(a.created_at), 'dd-MM-yyyy')}
              </p>
              {a.submitted_by_name && (
                <div className="approval-card__meta" style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Avatar name={a.submitted_by_name} color={a.submitted_by_color ?? undefined} avatarUrl={(a as any).submitted_by_avatar_url} size="sm" />
                  <span>Created by <strong style={{ color: 'var(--ink)' }}>{a.submitted_by_name}</strong></span>
                </div>
              )}
            </>
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

          {canMarkCompleteApproval(user, a) && (
            <button
              className="btn-secondary"
              style={{ padding: '7px 12px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}
              onClick={(e) => { e.stopPropagation(); markComplete(a); }}
            >
              <CheckCheck size={13} /> Mark Complete
            </button>
          )}

          {canReviewApproval(user, a) && (() => {
            const needsTimer = user?.role !== 'admin' && user?.role !== 'client';
            const t = timers[a.task_id] ?? { seconds: 0, running: false };
            const hasTime = t.seconds > 0;
            if (!needsTimer) {
              return (
                <button
                  className="btn-primary"
                  style={{ padding: '7px 14px', fontSize: 12 }}
                  onClick={(e) => openReview(a, e)}
                >
                  Review
                </button>
              );
            }
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={(e) => e.stopPropagation()}>
                {hasTime && (
                  <span style={{ fontSize: 12, fontWeight: 700, color: t.running ? 'var(--green)' : 'var(--ink-muted)', minWidth: 44, fontVariantNumeric: 'tabular-nums' }}>
                    <Clock size={11} style={{ marginRight: 3, verticalAlign: 'middle' }} />
                    {fmtSeconds(t.seconds)}
                  </span>
                )}
                <button
                  className="btn-secondary"
                  style={{ padding: '7px 12px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 5, color: t.running ? 'var(--orange)' : undefined }}
                  onClick={(e) => t.running ? pauseReviewTimer(a.task_id, e) : startReviewTimer(a.task_id, e, a.title)}
                >
                  {t.running ? <><Pause size={12} /> Pause</> : <><Play size={12} /> {hasTime ? 'Resume' : 'Start Review'}</>}
                </button>
                <button
                  className="btn-primary"
                  style={{ padding: '7px 14px', fontSize: 12, opacity: hasTime ? 1 : 0.4, cursor: hasTime ? 'pointer' : 'not-allowed' }}
                  onClick={(e) => { if (hasTime) openReview(a, e); }}
                  title={hasTime ? undefined : 'Start the timer before reviewing'}
                >
                  Review
                </button>
              </div>
            );
          })()}

          {!compact && (expanded
            ? <ChevronUp size={15} style={{ color: 'var(--ink-muted)' }} />
            : <ChevronDown size={15} style={{ color: 'var(--ink-muted)' }} />)}
        </div>
      </div>

      {/* Compact: who's next, and the review form inline */}
      {compact && a.status !== 'approved' && a.status !== 'rejected' && !reviewingHere && !canReviewApproval(user, a) && (
        <div style={{ fontSize: 12, color: 'var(--ink-muted)', padding: '0 4px 8px' }}>
          Waiting for <span style={{ textTransform: 'capitalize' }}>{getNextApproverRole(a) ?? 'the next reviewer'}</span>
        </div>
      )}
      {reviewingHere && (
        <div style={{ borderTop: '1px solid var(--sand-border)', marginTop: 8 }}>
          <ReviewForm {...form} />
        </div>
      )}

      {/* Expanded detail */}
      {expanded && !compact && (
        <div className="approval-card__detail">

          {/* Workflow info */}
          {isNewWorkflow(a) && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ink-muted)', marginBottom: 8 }}>
                {a.workflow_type === 'custom' ? 'Approvers (Sequential)' : a.workflow_type === 'xlr8' ? `XLR8 Ticket · ${a.xlr8_ticket_type_name ?? 'Ticket'} Workflow` : `Approval Path · ${a.workflow_type?.replace(/_/g, ' ')} workflow`}
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
                    const acted = steps?.find((s) => s.stage_key === `step_${i}`);
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
                            <MiniAvatar name={step.name} color={step.avatar_color} avatarUrl={step.avatar_url} size={22} fontSize={9} />
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
                                {format(parseTs(acted.acted_at), 'dd-MM-yyyy, h:mm a')}
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

              {/* XLR8 ticket: full stage flow */}
              {a.workflow_type === 'xlr8' && taskDetail && (() => {
                const td = taskDetail;
                const deliverables: any[] = td.deliverables || [];
                return (
                  <>
                    {/* Description */}
                    {td.description && (
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ink-muted)', marginBottom: 6 }}>Description</div>
                        <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{td.description}</div>
                      </div>
                    )}
                    {/* Stage Flow */}
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ink-muted)', marginBottom: 6 }}>Stage Flow</div>
                      <XLR8StageFlow task={td} log={ticketLog} />
                    </div>
                    {/* Attachments */}
                    {deliverables.length > 0 && (
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ink-muted)', marginBottom: 6 }}>Attachments</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {deliverables.map((d: any) => (
                            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                              {d.type === 'file' ? <Paperclip size={13} color="var(--ink-muted)" /> : <Link2 size={13} color="var(--ink-muted)" />}
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <a href={d.url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', fontSize: 12, color: 'var(--ink)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</a>
                                <AttachmentMeta d={d} />
                              </div>
                              <ExternalLink size={11} color="var(--ink-muted)" style={{ flexShrink: 0 }} />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
              {a.workflow_type === 'xlr8' && !taskDetail && (
                <div style={{ fontSize: 12, color: 'var(--ink-muted)', padding: '8px 0' }}>Loading stage flow…</div>
              )}

              {/* Legacy step timeline */}
              {a.workflow_type !== 'custom' && a.workflow_type !== 'xlr8' && (
                <div className="approval-timeline" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  {[{ key: 'submitted', label: 'Submitted' }, ...(WORKFLOWS[a.workflow_type!] ?? []).map(s => ({ key: s.status, label: s.label })), { key: 'approved', label: 'Done' }].map((step, i, arr) => {
                    const dotState = getDotState(step.key, a, timeline);
                    const acted = steps?.find((s) => s.stage_key === step.key);
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
                              <span style={{ color: 'var(--ink-muted)' }}>{format(parseTs(acted.acted_at), 'dd-MM-yyyy')}</span>
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
                      <span style={{ opacity: 0.6, fontSize: 10 }}>{format(parseTs(step.date), 'dd-MM-yyyy')}</span>
                    )}
                  </div>
                  {i < arr.length - 1 && <div className="timeline-line" />}
                </div>
              ))}
            </div>
          )}

          {/* Audit step history */}
          {(steps?.filter((s: any) => isNewWorkflow(a) ? s.action === 'reject' : true).length ?? 0) > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ink-muted)', marginBottom: 8 }}>
                Decision History
              </div>
              {(isNewWorkflow(a) ? steps!.filter((s: any) => s.action === 'reject') : steps!).map((step: any) => (
                <div key={step.id} className={`approval-note${step.action === 'reject' ? ' approval-note--danger' : ''}`}>
                  <strong>
                    {step.actor_name}{step.actor_name ? ` (${step.actor_role})` : step.actor_role} · {step.action === 'approve' ? '✓ Approved' : '✗ Rejected'} · {format(parseTs(step.acted_at), 'dd-MM-yyyy, h:mm a')}
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

          {/* Task checklist */}
          {checklist.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ink-muted)', marginBottom: 8 }}>
                Task Checklist
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {checklist.map((item) => (
                  <div key={item.id} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '7px 12px', borderRadius: 8,
                    background: 'rgba(76,175,125,0.07)',
                    border: '1.5px solid rgba(76,175,125,0.25)',
                    fontSize: 13, color: 'var(--ink)',
                  }}>
                    <span style={{ color: 'var(--green)', fontWeight: 800, fontSize: 14, lineHeight: 1 }}>✓</span>
                    <span style={{ flex: 1 }}>{item.text}</span>
                    <StageTag name={(item as any).stage_name} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
