
import { format } from 'date-fns';
import { CheckCircle2, XCircle, RefreshCw, Circle, MinusCircle, Clock } from 'lucide-react';
import { MiniAvatar } from './Avatar';

export function fmtSec(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0
    ? `${h}h ${String(m).padStart(2,'0')}m`
    : `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

interface Props {
  task: any;
  log: any[];
  drawerElapsed?: number;
}

export default function XLR8StageFlow({ task, log, drawerElapsed = 0 }: Props) {
  if (!task.ticket_type_id || !task.xlr8_stages?.length) return null;

  const stages: any[] = task.xlr8_stages;
  const stageAssignees: any[] = task.stage_assignees || [];
  const stageTracked: any[] = task.stage_tracked || [];
  const currentIdx: number = task.xlr8_stage_idx ?? 0;
  const isCompleted = task.status === 'completed' || task.xlr8_status === 'completed';
  const lastLogEntry = log[log.length - 1];
  const lastWasRejected = lastLogEntry && !lastLogEntry.action.includes('stage_pre_declined') &&
    (lastLogEntry.action.includes('declined') || lastLogEntry.action.includes('reject'));

  type DeclineEvent = { fromIdx: number; toIdx: number; comment: string | null; at: string; actor_name: string; fromLabel: string; toLabel: string };
  const stageTypeOf = (s: any) => s?.type === 'manager' ? 'manager' : s?.type === 'admin' ? 'admin' : s?.reviewer ? 'admin' : 'employee';
  // A stage index is fully skipped only if every row for it is marked skipped (a null-user placeholder + skipped=1)
  const stageIdxSet = [...new Set(stageAssignees.map((a: any) => Number(a.stage_idx)))];
  const skippedIdxSet = new Set(stageIdxSet.filter(idx => {
    const rows = stageAssignees.filter((a: any) => Number(a.stage_idx) === idx);
    return rows.length > 0 && rows.every((a: any) => a.skipped);
  }));
  const stageLabelOf = (idx: number) => {
    if (idx === stages.length) return 'Admin Approval';
    const s = stages[idx];
    if (!s) return `Stage ${idx + 1}`;
    return s.type === 'admin' ? 'Admin Review' : s.type === 'manager' ? 'Manager Review' : (s.category_name || `Stage ${idx + 1}`);
  };

  const declineEvents: DeclineEvent[] = [];
  let trackedIdx = 0, lastAdminInStageIdx = -1, lastManagerIdx = -1;
  for (const entry of log) {
    if (entry.action === 'next_stage') {
      const m = (entry.comment ?? '').match(/^Stage (\d+):/);
      if (m) {
        trackedIdx = Number(m[1]) - 1;
        if ((entry.comment ?? '').includes('Admin Review')) lastAdminInStageIdx = trackedIdx;
        else if ((entry.comment ?? '').includes('Manager Review')) lastManagerIdx = trackedIdx;
      }
    } else if (entry.action === 'admin_declined') {
      const fromIdx = lastAdminInStageIdx >= 0 ? lastAdminInStageIdx : stages.length;
      const searchFrom = lastAdminInStageIdx >= 0 ? lastAdminInStageIdx - 1 : stages.length - 1;
      let pi = searchFrom;
      while (pi >= 0 && (stageTypeOf(stages[pi]) !== 'employee' || skippedIdxSet.has(pi))) pi--;
      const toIdx = pi >= 0 ? pi : 0;
      declineEvents.push({ fromIdx, toIdx, comment: entry.comment ?? null, at: entry.created_at, actor_name: entry.actor_name ?? '', fromLabel: stageLabelOf(fromIdx), toLabel: stageLabelOf(toIdx) });
      trackedIdx = toIdx; lastAdminInStageIdx = -1;
    } else if (entry.action === 'manager_declined') {
      const fromIdx = lastManagerIdx >= 0 ? lastManagerIdx : trackedIdx;
      let pi = fromIdx - 1;
      while (pi >= 0 && (stageTypeOf(stages[pi]) !== 'employee' || skippedIdxSet.has(pi))) pi--;
      const toIdx = pi >= 0 ? pi : 0;
      declineEvents.push({ fromIdx, toIdx, comment: entry.comment ?? null, at: entry.created_at, actor_name: entry.actor_name ?? '', fromLabel: stageLabelOf(fromIdx), toLabel: stageLabelOf(toIdx) });
      trackedIdx = toIdx; lastManagerIdx = -1;
    } else if (entry.action === 'employee_declined') {
      declineEvents.push({ fromIdx: trackedIdx, toIdx: trackedIdx, comment: entry.comment ?? null, at: entry.created_at, actor_name: entry.actor_name ?? '', fromLabel: stageLabelOf(trackedIdx), toLabel: stageLabelOf(trackedIdx) });
    }
  }

  const rejectedStageIdx = (() => {
    if (!lastWasRejected) return currentIdx;
    if (lastLogEntry.action === 'admin_declined') {
      const idx = stages.findIndex((_s: any, si: number) => si > currentIdx && _s.type === 'admin');
      return idx >= 0 ? idx : currentIdx;
    }
    return currentIdx;
  })();
  const redoIdx = rejectedStageIdx > currentIdx ? currentIdx : rejectedStageIdx - 1;

  return (
    <div>
      <div style={{ overflowX: 'auto', position: 'relative' }}>
        <div style={{ width: 'max-content' }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'stretch', gap: 0, marginTop: 10 }}>
            {stages.map((stage: any, i: number) => {
              const stageRows = stageAssignees.filter((a: any) => a.stage_idx === i);
              const realAssignees = stageRows.filter((a: any) => a.user_id);
              const isSkippedStage = stageRows.some((a: any) => a.skipped) && realAssignees.every((a: any) => a.skipped);
              const reviewerOverride = stageRows.find((a: any) => a.is_reviewer === 1 || a.is_reviewer === true);
              const isReview = isSkippedStage ? false : (stage.type === 'manager' || stage.type === 'admin' || stage.reviewer === true || (reviewerOverride ? !!reviewerOverride.is_reviewer : false));
              const isRejected   = !isSkippedStage && lastWasRejected && i === rejectedStageIdx;
              const isRedoTarget = !isSkippedStage && lastWasRejected && i === redoIdx;
              const isDone    = !isSkippedStage && !isRedoTarget && !isRejected && (isCompleted || i < currentIdx);
              const isCurrent = !isSkippedStage && !isCompleted && i === currentIdx && !isRejected;
              const isPending = !isSkippedStage && !isCompleted && !isRejected && i > currentIdx && i !== redoIdx;
              const stageAssignee = stageRows.filter((a: any) => a.user_id && !a.skipped);
              const rawTracked = stageTracked.find((t: any) => t.stage_idx === i)?.tracked_seconds ?? 0;
              const stageIsActive = stageAssignees.some((a: any) => a.stage_idx === i && a.is_active);
              const trackedSec = Number(rawTracked) + (stageIsActive ? drawerElapsed : 0);
              const estSec = stageAssignee.reduce((s: number, a: any) => s + (Number(a.est_hours) || 0) * 3600, 0);
              const overSec = trackedSec > 0 && estSec > 0 ? Math.max(0, trackedSec - estSec) : 0;
              const label = stage.type === 'admin' ? 'Admin Review' : stage.type === 'manager' ? 'Manager Review' : stage.category_name;
              const borderColor = isSkippedStage ? '#d1d5db' : isRejected ? '#ef4444' : isDone ? '#22c55e' : isCurrent ? '#3b82f6' : isRedoTarget ? '#f59e0b' : '#e2e8f0';
              const bgColor = isSkippedStage ? 'rgba(209,213,219,0.15)' : isRejected ? 'rgba(239,68,68,0.05)' : isDone ? 'rgba(34,197,94,0.06)' : isCurrent ? 'rgba(59,130,246,0.05)' : isRedoTarget ? 'rgba(245,158,11,0.05)' : 'var(--surface)';
              const dotColor = isSkippedStage ? '#9ca3af' : isRejected ? '#ef4444' : isDone ? '#22c55e' : isCurrent ? '#3b82f6' : isRedoTarget ? '#f59e0b' : '#cbd5e1';

              return (
                <div key={i} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', flexShrink: 0 }}>
                  <div style={{ width: 180, minHeight: 130, border: `2px solid ${borderColor}`, borderRadius: 12, padding: '14px 12px 12px', background: bgColor, position: 'relative', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ position: 'absolute', top: -10, left: 10, background: dotColor, color: '#fff', borderRadius: 99, fontSize: 9, fontWeight: 800, padding: '1px 7px', whiteSpace: 'nowrap' }}>Stage {i + 1}</div>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      {isSkippedStage && <MinusCircle size={22} color="#9ca3af" />}
                      {!isSkippedStage && isDone       && <CheckCircle2 size={22} color="#22c55e" />}
                      {!isSkippedStage && isRejected   && <XCircle      size={22} color="#ef4444" />}
                      {!isSkippedStage && isRedoTarget && <RefreshCw    size={22} color="#f59e0b" />}
                      {!isSkippedStage && isCurrent    && <Circle       size={22} color="#3b82f6" fill="rgba(59,130,246,0.15)" />}
                      {!isSkippedStage && isPending    && <MinusCircle  size={22} color="#cbd5e1" />}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: isSkippedStage ? '#9ca3af' : isPending ? 'var(--ink-muted)' : 'var(--ink)', lineHeight: 1.3, textDecoration: isSkippedStage ? 'line-through' : 'none' }}>
                      {label}
                      {isSkippedStage && <div style={{ marginTop: 2, fontSize: 9, fontWeight: 700, color: '#6b7280', display: 'inline-block', background: 'rgba(107,114,128,0.12)', borderRadius: 4, padding: '1px 4px', marginLeft: 4, textDecoration: 'none' }}>Skipped</div>}
                      {!isSkippedStage && isReview && <div style={{ marginTop: 2, fontSize: 9, fontWeight: 600, color: stage.type === 'admin' ? 'var(--orange)' : stage.type === 'manager' ? '#3b82f6' : '#16a34a', display: 'inline-block', background: stage.type === 'admin' ? 'rgba(234,88,12,0.1)' : stage.type === 'manager' ? 'rgba(59,130,246,0.1)' : 'rgba(34,197,94,0.12)', borderRadius: 4, padding: '1px 4px', marginLeft: 4 }}>Review</div>}
                    </div>
                    <div style={{ flex: 1 }}>
                      {isSkippedStage ? (
                        <span style={{ fontSize: 10, color: '#9ca3af', fontStyle: 'italic' }}>Stage bypassed</span>
                      ) : stageAssignee.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          {stageAssignee.map((a: any) => {
                            const status = a.is_active ? 'working' : (a.acceptance_status || 'pending');
                            const pill: Record<string, { label: string; bg: string; color: string }> = {
                              working:  { label: 'Working',        bg: 'rgba(59,130,246,0.12)',  color: '#2563eb' },
                              accepted: { label: 'Accepted',       bg: 'rgba(34,197,94,0.12)',   color: '#16a34a' },
                              declined: { label: 'Declined',       bg: 'rgba(239,68,68,0.12)',   color: '#dc2626' },
                              pending:  { label: 'Not yet accepted', bg: 'rgba(148,163,184,0.15)', color: '#64748b' },
                            };
                            const p = pill[status] || pill.pending;
                            return (
                              <span key={a.user_id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: isPending ? 'var(--ink-muted)' : 'var(--ink)', flexWrap: 'wrap' }}>
                                <MiniAvatar name={a.user_name || '?'} color={isPending ? '#cbd5e1' : (a.avatar_color || '#94a3b8')} avatarUrl={isPending ? null : a.avatar_url} size={16} fontSize={7} />
                                {a.user_name?.split(' ')[0]}
                                <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 99, background: p.bg, color: p.color }}>{p.label}</span>
                              </span>
                            );
                          })}
                        </div>
                      ) : (
                        <span style={{ fontSize: 10, color: 'var(--ink-muted)', fontStyle: 'italic' }}>TBD</span>
                      )}
                    </div>
                    {/* Est + logged time */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {estSec > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#94a3b8' }}>
                          <Clock size={10} color="#94a3b8" />
                          Est: {fmtSec(estSec)}
                        </div>
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, color: trackedSec > 0 ? 'var(--ink-muted)' : '#cbd5e1' }}>
                        <Clock size={10} color={trackedSec > 0 ? 'var(--ink-muted)' : '#cbd5e1'} />
                        {trackedSec > 0 ? fmtSec(Number(trackedSec)) : '—'} logged
                        {overSec > 0 && (
                          <span style={{ fontSize: 9, fontWeight: 800, color: '#dc2626', background: 'rgba(220,38,38,0.1)', borderRadius: 99, padding: '1px 5px', marginLeft: 2 }}>
                            +{fmtSec(overSec)} over
                          </span>
                        )}
                      </div>
                    </div>
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

            {/* Final approval cards */}
            {(() => {
              const fa = task.xlr8_final_approval || {};
              const allStagesDone = isCompleted || ['pending_admin','pending_client','completed'].includes(task.xlr8_status);
              const cards: { key: string; label: string; color: string; accentColor: string; isDone: boolean; isActive: boolean }[] = [];
              if (fa.adminRequired) {
                cards.push({ key: 'admin', label: 'Admin Approval', color: '#ea580c', accentColor: 'rgba(234,88,12,0.08)', isDone: isCompleted || task.xlr8_status === 'pending_client', isActive: task.xlr8_status === 'pending_admin' });
              }
              if (fa.clientOptional) {
                cards.push({ key: 'client', label: 'Client Approval', color: '#0891b2', accentColor: 'rgba(8,145,178,0.08)', isDone: isCompleted, isActive: task.xlr8_status === 'pending_client' });
              }
              if (cards.length === 0) return null;
              return cards.map((c, ci) => (
                <div key={c.key} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', flexShrink: 0 }}>
                  <div style={{ width: 32, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="32" height="20" viewBox="0 0 32 20">
                      <line x1="0" y1="10" x2="22" y2="10" stroke={ci === 0 && allStagesDone ? '#22c55e' : '#e2e8f0'} strokeWidth="2" strokeDasharray={!allStagesDone ? '4 3' : 'none'} />
                      <polygon points="32,10 20,4 20,16" fill={ci === 0 && allStagesDone ? '#22c55e' : '#e2e8f0'} />
                    </svg>
                  </div>
                  <div style={{ width: 160, minHeight: 100, border: `2px solid ${c.isDone ? '#22c55e' : c.isActive ? c.color : '#e2e8f0'}`, borderRadius: 12, padding: '14px 12px 12px', background: c.isDone ? 'rgba(34,197,94,0.06)' : c.isActive ? c.accentColor : 'var(--surface)', position: 'relative', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
                    <div style={{ position: 'absolute', top: -10, left: 10, background: c.isDone ? '#22c55e' : c.isActive ? c.color : '#cbd5e1', color: '#fff', borderRadius: 99, fontSize: 9, fontWeight: 800, padding: '1px 7px', whiteSpace: 'nowrap' }}>{c.label}</div>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      {c.isDone   && <CheckCircle2 size={22} color="#22c55e" />}
                      {c.isActive && !c.isDone && <Circle size={22} color={c.color} fill={c.accentColor} />}
                      {!c.isDone && !c.isActive && <MinusCircle size={22} color="#cbd5e1" />}
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: c.isDone ? 'var(--ink)' : c.isActive ? c.color : 'var(--ink-muted)' }}>
                      {c.isDone ? 'Approved' : c.isActive ? 'Pending approval' : 'Awaiting stages'}
                    </div>
                  </div>
                </div>
              ));
            })()}
          </div>

          {/* Rejection arcs */}
          {declineEvents.length > 0 && (() => {
            const cardW = 180, arrowW = 40, unitW = cardW + arrowW;
            const stagesW = stages.length * cardW + (stages.length - 1) * arrowW;
            const adminCardX = stagesW + 32 + 80;
            const cardCenterX = (idx: number) => idx === stages.length ? adminCardX : idx * unitW + cardW / 2;
            const svgW = declineEvents.some(ev => ev.fromIdx === stages.length) ? adminCardX + 80 : stagesW;
            const baseArcH = 40, arcStep = 20;
            const realArcs = declineEvents.filter(ev => ev.fromIdx !== ev.toIdx);
            const maxArcH = baseArcH + (realArcs.length - 1) * arcStep;
            return (
              <div style={{ marginTop: 8 }}>
                {realArcs.length > 0 && (
                  <div style={{ position: 'relative', minWidth: svgW }}>
                    <svg width={svgW} height={maxArcH + 4} viewBox={`0 0 ${svgW} ${maxArcH + 4}`} style={{ display: 'block', overflow: 'visible' }}>
                      <defs><marker id="rejArrowHead2" markerWidth="8" markerHeight="8" refX="1" refY="4" orient="auto-start-reverse"><polygon points="8,4 0,0 0,8" fill="#ef4444" /></marker></defs>
                      {realArcs.map((ev, ei) => {
                        const fromX = cardCenterX(ev.fromIdx);
                        const toX = cardCenterX(ev.toIdx);
                        const h = maxArcH - ei * arcStep;
                        const isLast = ei === realArcs.length - 1;
                        return (
                          <path key={ei}
                            d={`M ${fromX} 4 C ${fromX} ${h}, ${toX} ${h}, ${toX} 4`}
                            stroke="#ef4444" strokeWidth={isLast ? 2.5 : 1.5} fill="none"
                            markerEnd="url(#rejArrowHead2)"
                            strokeDasharray="5 3"
                            opacity={0.25 + (ei / Math.max(1, realArcs.length - 1)) * 0.75}
                          />
                        );
                      })}
                    </svg>
                    {(() => {
                      const last = realArcs[realArcs.length - 1];
                      const midX = (cardCenterX(last.fromIdx) + cardCenterX(last.toIdx)) / 2;
                      const atStr = last.at ? (() => { const s = String(last.at); const iso = s.includes('T') || s.includes('Z') || s.includes('+') ? s : s.replace(' ', 'T') + 'Z'; return format(new Date(Number(s) || iso), 'MMM d, h:mm a'); })() : null;
                      return (
                        <div style={{ position: 'absolute', top: baseArcH - 10, left: midX, transform: 'translateX(-50%)' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 99, padding: '3px 10px', fontSize: 10, fontWeight: 700, color: '#ef4444', whiteSpace: 'nowrap' }}>
                            <XCircle size={11} color="#ef4444" />
                            {declineEvents.length > 1 ? `${declineEvents.length} Rejections` : 'Rejected'}{atStr ? ` · ${atStr}` : ''}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
                <div style={{ marginTop: realArcs.length > 0 ? maxArcH - 8 : 4, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {declineEvents.map((ev, ei) => {
                    const atStr = ev.at ? (() => { const s = String(ev.at); const iso = s.includes('T') || s.includes('Z') || s.includes('+') ? s : s.replace(' ', 'T') + 'Z'; return format(new Date(Number(s) || iso), 'MMM d, h:mm a'); })() : null;
                    const isLast = ei === declineEvents.length - 1;
                    return (
                      <div key={ei} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 11, background: isLast ? 'rgba(239,68,68,0.04)' : 'transparent', borderRadius: 8, padding: '6px 8px' }}>
                        <div style={{ width: 18, height: 18, borderRadius: '50%', background: isLast ? '#ef4444' : '#fca5a5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 800, color: '#fff', flexShrink: 0, marginTop: 1 }}>{ei + 1}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 700, color: isLast ? '#ef4444' : '#f87171' }}>Rejection {ei + 1}</span>
                            {ev.actor_name && <span style={{ color: 'var(--ink-muted)' }}>by <strong style={{ color: 'var(--ink)' }}>{ev.actor_name}</strong></span>}
                            {atStr && <span style={{ color: 'var(--ink-muted)' }}>· {atStr}</span>}
                          </div>
                          {ev.fromIdx !== ev.toIdx && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3, fontSize: 10, color: 'var(--ink-muted)' }}>
                              <span style={{ background: 'rgba(239,68,68,0.1)', color: '#dc2626', borderRadius: 4, padding: '1px 5px', fontWeight: 600 }}>{ev.fromLabel}</span>
                              <span>→ returned to</span>
                              <span style={{ background: 'rgba(245,158,11,0.1)', color: '#b45309', borderRadius: 4, padding: '1px 5px', fontWeight: 600 }}>{ev.toLabel}</span>
                            </div>
                          )}
                          {ev.comment && <div style={{ color: '#b91c1c', fontStyle: 'italic', marginTop: 3 }}>"{ev.comment}"</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
