<title>TaskViewDrawer</title>
import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { CheckCircle2, XCircle, RefreshCw, Circle, MinusCircle, Clock } from 'lucide-react';
import { tasksApi, xlr8Api } from '../../services/api';

interface Props {
  taskId: number;
  onClose: () => void;
}

const ACTION_LABELS: Record<string, string> = {
  created: 'Created', assigned: 'Assigned to employee', employee_accepted: 'Accepted',
  employee_declined: 'Declined', work_done: 'Marked done',
  manager_approved: 'Manager approved', manager_declined: 'Returned to employee',
  next_stage: 'Moved to next stage', sent_to_admin: 'Sent to admin',
  admin_approved: 'Admin approved', admin_skip_client: 'Completed (client skipped)',
  admin_skipped: 'Admin skipped', client_approved: 'Client approved', completed: 'Completed',
};

function fmtSec(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function TaskViewDrawer({ taskId, onClose }: Props) {
  const [task, setTask] = useState<any>(null);
  const [log, setLog]   = useState<any[]>([]);
  const [tab, setTab]   = useState<'info' | 'activity'>('info');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setTask(null);
    setLog([]);
    setTab('info');
    tasksApi.get(taskId)
      .then(r => {
        setTask(r.data);
        if (r.data.ticket_type_id) {
          xlr8Api.getTicketLog(taskId).then(lr => setLog(lr.data)).catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [taskId]);

  return (
    <div className="drawer-overlay">
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer-panel">
        {/* Header */}
        <div className="drawer-header">
          <div className="drawer-header__label">
            {task?.project_name}{task?.client_name ? ` · ${task.client_name}` : ''}
          </div>
          <div className="drawer-header__row">
            <span className="drawer-header__title">{task?.title ?? '…'}</span>
            <button type="button" className="drawer-close" onClick={onClose}>×</button>
          </div>
          {task && (
            <div style={{ display: 'flex', marginTop: 14, gap: 0, borderBottom: '1.5px solid var(--bg-sand)', marginBottom: -18 }}>
              {(['info', 'activity'] as const).map(t => (
                <button key={t} type="button" onClick={() => setTab(t)} style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: '6px 16px 10px',
                  fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                  color: tab === t ? 'var(--ink)' : 'var(--ink-muted)',
                  borderBottom: tab === t ? '2px solid var(--ink)' : '2px solid transparent',
                  marginBottom: -1.5,
                }}>
                  {t === 'info' ? 'Info' : 'Activity Log'}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Body */}
        <div className="drawer-body" style={{ overflowY: 'auto' }}>
          {loading && <div style={{ fontSize: 13, color: 'var(--ink-muted)', padding: '20px 0' }}>Loading…</div>}

          {task && tab === 'info' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Meta */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {[
                  { label: 'Task Key', value: (() => {
                    const mon = task.created_at ? new Date(task.created_at).toLocaleString('en-US', { month: 'short' }).toUpperCase() : '';
                    const proj = (task.project_name || '').replace(/\s+/g, '').toUpperCase().slice(0, 8);
                    return <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{proj}-{task.id}-{mon}</span>;
                  })() },
                  { label: 'Status', value: <span className={`badge badge--${task.status}`}>{task.status?.replace(/_/g, ' ')}</span> },
                  { label: 'Due Date', value: task.due_date ? format(new Date(task.due_date + 'T00:00:00'), 'MMM d, yyyy') : '—' },
                  { label: 'Created by', value: task.created_by_name || '—' },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <div className="drawer-info-label">{label}</div>
                    <div style={{ fontSize: 13, color: 'var(--ink)', marginTop: 2 }}>{value}</div>
                  </div>
                ))}
              </div>

              {/* Description */}
              <div>
                <div className="drawer-info-label">Description</div>
                {task.description
                  ? <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.6, whiteSpace: 'pre-wrap', background: 'rgba(0,0,0,0.03)', borderRadius: 8, padding: '12px 14px', marginTop: 6 }}>{task.description}</div>
                  : <div style={{ fontSize: 13, color: 'var(--ink-muted)', fontStyle: 'italic', marginTop: 4 }}>No description provided.</div>
                }
              </div>

              {/* XLR8 Stage Tracker */}
              {task.ticket_type_id && task.xlr8_stages?.length > 0 && (() => {
                const stages: any[] = task.xlr8_stages;
                const stageAssignees: any[] = task.stage_assignees || [];
                const stageTracked: any[] = task.stage_tracked || [];
                const currentIdx: number = task.xlr8_stage_idx ?? 0;
                const isCompleted = task.status === 'completed' || task.xlr8_status === 'completed';
                const lastLogEntry = log[log.length - 1];
                const lastWasRejected = lastLogEntry && (lastLogEntry.action.includes('declined') || lastLogEntry.action.includes('reject'));
                const rejectedAt = lastWasRejected && lastLogEntry?.created_at
                  ? format(new Date(Number(lastLogEntry.created_at) || lastLogEntry.created_at), 'MMM d, h:mm a')
                  : null;
                return (
                  <div>
                    <div className="drawer-info-label" style={{ marginBottom: 12 }}>Stage Flow</div>
                    <div style={{ overflowX: 'auto', paddingBottom: lastWasRejected ? 52 : 4, position: 'relative' }}>
                      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'stretch', gap: 0, marginTop: 10, width: 'max-content' }}>
                        {stages.map((stage: any, i: number) => {
                          const isReview = stage.type === 'manager' || stage.type === 'admin';
                          const isRedoTarget = lastWasRejected && i === currentIdx - 1;
                          const isDone = !isRedoTarget && (isCompleted || i < currentIdx);
                          const isCurrent = !isCompleted && i === currentIdx;
                          const isPending = !isCompleted && i > currentIdx;
                          const stageAssignee = stageAssignees.filter((a: any) => a.stage_idx === i && a.user_id);
                          const trackedSec = stageTracked.find((t: any) => t.stage_idx === i)?.tracked_seconds ?? 0;
                          const label = stage.type === 'admin' ? 'Admin Review' : stage.type === 'manager' ? 'Manager Review' : stage.category_name;
                          const borderColor = isDone ? '#22c55e' : isCurrent ? (lastWasRejected ? '#ef4444' : '#3b82f6') : isRedoTarget ? '#f59e0b' : '#e2e8f0';
                          const bgColor = isDone ? 'rgba(34,197,94,0.06)' : isCurrent ? (lastWasRejected ? 'rgba(239,68,68,0.05)' : 'rgba(59,130,246,0.05)') : isRedoTarget ? 'rgba(245,158,11,0.05)' : 'var(--surface)';
                          const dotColor = isDone ? '#22c55e' : isCurrent ? (lastWasRejected ? '#ef4444' : '#3b82f6') : isRedoTarget ? '#f59e0b' : '#cbd5e1';
                          const isRejected = lastWasRejected && isCurrent;
                          return (
                            <div key={i} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', flexShrink: 0 }}>
                              <div style={{ width: 180, minHeight: 130, border: `2px solid ${borderColor}`, borderRadius: 12, padding: '14px 12px 12px', background: bgColor, position: 'relative', display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <div style={{ position: 'absolute', top: -10, left: 10, background: dotColor, color: '#fff', borderRadius: 99, fontSize: 9, fontWeight: 800, padding: '1px 7px', whiteSpace: 'nowrap' }}>Stage {i + 1}</div>
                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                  {isDone && <CheckCircle2 size={22} color="#22c55e" />}
                                  {isRejected && <XCircle size={22} color="#ef4444" />}
                                  {isRedoTarget && <RefreshCw size={22} color="#f59e0b" />}
                                  {isCurrent && !isRejected && <Circle size={22} color="#3b82f6" fill="rgba(59,130,246,0.15)" />}
                                  {isPending && <MinusCircle size={22} color="#cbd5e1" />}
                                </div>
                                <div style={{ fontSize: 12, fontWeight: 700, color: isPending ? 'var(--ink-muted)' : 'var(--ink)', lineHeight: 1.3 }}>
                                  {label}
                                  {isReview && <div style={{ marginTop: 2, fontSize: 9, fontWeight: 600, color: stage.type === 'admin' ? 'var(--orange)' : '#3b82f6', display: 'inline-block', background: stage.type === 'admin' ? 'rgba(234,88,12,0.1)' : 'rgba(59,130,246,0.1)', borderRadius: 4, padding: '1px 4px', marginLeft: 4 }}>Review</div>}
                                </div>
                                <div style={{ flex: 1 }}>
                                  {stageAssignee.length > 0 ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                      {stageAssignee.map((a: any) => (
                                        <span key={a.user_id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: isPending ? 'var(--ink-muted)' : 'var(--ink)' }}>
                                          <span style={{ width: 16, height: 16, borderRadius: '50%', background: isPending ? '#cbd5e1' : (a.avatar_color || '#94a3b8'), display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 7, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
                                            {(a.user_name || '?').split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
                                          </span>
                                          {a.user_name?.split(' ')[0]}
                                        </span>
                                      ))}
                                    </div>
                                  ) : <span style={{ fontSize: 10, color: 'var(--ink-muted)', fontStyle: 'italic' }}>TBD</span>}
                                </div>
                                {(() => {
                                  const estSec = stageAssignee.reduce((s: number, a: any) => s + (Number(a.est_hours) || 0) * 3600, 0);
                                  const overSec = trackedSec > 0 && estSec > 0 ? Math.max(0, trackedSec - estSec) : 0;
                                  return (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, color: trackedSec > 0 ? 'var(--ink-muted)' : '#cbd5e1' }}>
                                      <Clock size={10} color={trackedSec > 0 ? 'var(--ink-muted)' : '#cbd5e1'} />
                                      {trackedSec > 0 ? fmtSec(Number(trackedSec)) : '—'} logged
                                      {overSec > 0 && (
                                        <span style={{ fontSize: 9, fontWeight: 800, color: '#dc2626', background: 'rgba(220,38,38,0.1)', borderRadius: 99, padding: '1px 5px', marginLeft: 2 }}>
                                          +{fmtSec(overSec)} over
                                        </span>
                                      )}
                                    </div>
                                  );
                                })()}
                                {isRejected && lastLogEntry?.comment && (
                                  <div style={{ fontSize: 10, color: '#ef4444', background: 'rgba(239,68,68,0.08)', borderRadius: 6, padding: '4px 6px', fontStyle: 'italic' }}>✕ "{lastLogEntry.comment}"</div>
                                )}
                                {isRejected && !lastLogEntry?.comment && <div style={{ fontSize: 10, color: '#ef4444', fontWeight: 600 }}>✕ Rejected</div>}
                              </div>
                              {i < stages.length - 1 && (
                                <div style={{ width: 40, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  <svg width="40" height="20" viewBox="0 0 40 20">
                                    <line x1="0" y1="10" x2="30" y2="10" stroke={isDone ? '#22c55e' : '#e2e8f0'} strokeWidth="2" strokeDasharray={isPending ? '4 3' : 'none'} />
                                    <polygon points="40,10 28,4 28,16" fill={isDone ? '#22c55e' : '#e2e8f0'} />
                                  </svg>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {lastWasRejected && currentIdx > 0 && (() => {
                        const cardW = 180, arrowW = 40, unitW = cardW + arrowW;
                        const totalW = stages.length * cardW + (stages.length - 1) * arrowW;
                        const fromX = currentIdx * unitW + cardW / 2;
                        const toX = (currentIdx - 1) * unitW + cardW / 2;
                        const midX = (fromX + toX) / 2;
                        const arcH = 44;
                        return (
                          <div style={{ marginTop: 6, position: 'relative', minWidth: totalW }}>
                            <svg width={totalW} height={arcH} viewBox={`0 0 ${totalW} ${arcH}`} style={{ display: 'block', overflow: 'visible' }}>
                              <defs><marker id="rejArrowHead2" markerWidth="8" markerHeight="8" refX="1" refY="4" orient="auto-start-reverse"><polygon points="8,4 0,0 0,8" fill="#ef4444" /></marker></defs>
                              <path d={`M ${fromX} 4 C ${fromX} ${arcH}, ${toX} ${arcH}, ${toX} 4`} stroke="#ef4444" strokeWidth="2" fill="none" markerEnd="url(#rejArrowHead2)" strokeDasharray="5 3" />
                            </svg>
                            <div style={{ position: 'absolute', bottom: -28, left: midX, transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 99, padding: '3px 10px', fontSize: 10, fontWeight: 700, color: '#ef4444', whiteSpace: 'nowrap' }}>
                                <XCircle size={11} color="#ef4444" /> Rejected{rejectedAt ? ` · ${rejectedAt}` : ''}
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                );
              })()}

              {/* Non-XLR8: assigned to */}
              {!task.ticket_type_id && (
                <div>
                  <div className="drawer-info-label">Assigned to</div>
                  <div style={{ fontSize: 13, color: 'var(--ink)', marginTop: 2 }}>
                    {task.assignees?.length > 0 ? task.assignees.map((a: any) => a.name).join(', ') : task.assigned_name || '—'}
                  </div>
                </div>
              )}
            </div>
          )}

          {task && tab === 'activity' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {log.length > 0 ? log.map((entry: any, i: number) => {
                const isDanger = entry.action.includes('declined') || entry.action.includes('reject');
                return (
                  <div key={i} style={{ fontSize: 12, padding: '10px 12px', borderRadius: 8, background: isDanger ? 'rgba(239,68,68,0.06)' : 'rgba(76,175,125,0.06)', border: `1px solid ${isDanger ? 'rgba(239,68,68,0.18)' : 'rgba(76,175,125,0.18)'}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span><strong>{entry.actor_name}</strong> · <span style={{ color: 'var(--ink-muted)' }}>{ACTION_LABELS[entry.action] || entry.action}</span></span>
                      <span style={{ fontSize: 10, color: 'var(--ink-muted)', whiteSpace: 'nowrap' }}>
                        {format(new Date(Number(entry.created_at) || entry.created_at), 'MMM d, h:mm a')}
                      </span>
                    </div>
                    {entry.comment && <div style={{ fontSize: 11, color: 'var(--ink-muted)', fontStyle: 'italic', marginTop: 3 }}>"{entry.comment}"</div>}
                  </div>
                );
              }) : (
                <div style={{ fontSize: 13, color: 'var(--ink-muted)', fontStyle: 'italic' }}>
                  {task.ticket_type_id ? 'No workflow history yet.' : 'Activity log is available for XLR8 tickets only.'}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
