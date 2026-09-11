import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';

const API = '/api';

const URL_RE = /(https?:\/\/[^\s]+)/g;
function linkify(text: string) {
  return text.split(URL_RE).map((p, i) =>
    URL_RE.test(p)
      ? <a key={i} href={p} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', textDecoration: 'underline', wordBreak: 'break-all' }}>{p}</a>
      : p
  );
}

function fmtSec(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtTs(ts: any) {
  try {
    const d = new Date(Number(ts) || ts);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  } catch { return ''; }
}

const ACTION_LABELS: Record<string, string> = {
  created: 'Created', assigned: 'Assigned to employee', employee_accepted: 'Accepted',
  employee_declined: 'Declined', work_done: 'Marked done',
  manager_approved: 'Manager approved', manager_declined: 'Returned to employee',
  next_stage: 'Moved to next stage', sent_to_admin: 'Sent to admin',
  admin_approved: 'Admin approved', admin_declined: 'Admin returned to employee',
  admin_skip_client: 'Completed (client skipped)', admin_skipped: 'Admin skipped',
  client_approved: 'Client approved', completed: 'Completed',
};

const STATUS_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  todo:           { bg: '#f1f5f9', color: '#475569', border: '#cbd5e1' },
  in_progress:    { bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe' },
  done:           { bg: '#fefce8', color: '#b45309', border: '#fde68a' },
  completed:      { bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0' },
  manager_review: { bg: '#faf5ff', color: '#7c3aed', border: '#ddd6fe' },
  admin_review:   { bg: '#fdf4ff', color: '#a21caf', border: '#f0abfc' },
  client_review:  { bg: '#fff7ed', color: '#ea580c', border: '#fed7aa' },
  rejected:       { bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
};
const PRIORITY_COLORS: Record<string, { bg: string; color: string }> = {
  urgent: { bg: '#fef2f2', color: '#dc2626' },
  high:   { bg: '#fff7ed', color: '#ea580c' },
  medium: { bg: '#fffbeb', color: '#b45309' },
  low:    { bg: '#f0fdf4', color: '#15803d' },
};

function Avatar({ name, color, url, size = 28 }: { name: string; color?: string; url?: string; size?: number }) {
  const initials = name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?';
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, overflow: 'hidden', background: url ? 'transparent' : (color || '#888'), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.38, fontWeight: 700, color: '#fff' }}>
      {url ? <img src={url} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials}
    </div>
  );
}

// ─── Stage Flow (mirrors TaskViewDrawer logic exactly) ───────────────────────
function StageFlow({ task, log }: { task: any; log: any[] }) {
  const stages: any[] = task.xlr8_stages || [];
  const stageAssignees: any[] = task.stage_assignees || [];
  const stageTracked: any[] = task.stage_tracked || [];
  const currentIdx: number = task.xlr8_stage_idx ?? 0;
  const isCompleted = task.status === 'completed' || task.xlr8_status === 'completed';

  const lastLogEntry = log[log.length - 1];
  const lastWasRejected = lastLogEntry && !lastLogEntry.action.includes('stage_pre_declined') &&
    (lastLogEntry.action.includes('declined') || lastLogEntry.action.includes('reject'));

  const stageTypeOf = (s: any) => s?.type === 'manager' ? 'manager' : s?.type === 'admin' ? 'admin' : s?.reviewer ? 'admin' : 'employee';
  type DeclineEvent = { fromIdx: number; toIdx: number; comment: string | null; at: string; actor_name: string };
  const declineEvents: DeclineEvent[] = [];
  let trackedIdx = 0, lastAdminIdx = -1, lastManagerIdx = -1;
  for (const entry of log) {
    if (entry.action === 'next_stage') {
      const m = (entry.comment ?? '').match(/^Stage (\d+):/);
      if (m) {
        trackedIdx = Number(m[1]) - 1;
        if ((entry.comment ?? '').includes('Admin Review')) lastAdminIdx = trackedIdx;
        else if ((entry.comment ?? '').includes('Manager Review')) lastManagerIdx = trackedIdx;
      }
    } else if (entry.action === 'admin_declined') {
      const fromIdx = lastAdminIdx >= 0 ? lastAdminIdx : trackedIdx;
      let pi = fromIdx - 1;
      while (pi >= 0 && stageTypeOf(stages[pi]) !== 'employee') pi--;
      declineEvents.push({ fromIdx, toIdx: pi >= 0 ? pi : 0, comment: entry.comment ?? null, at: entry.created_at, actor_name: entry.actor_name ?? '' });
      trackedIdx = pi >= 0 ? pi : 0; lastAdminIdx = -1;
    } else if (entry.action === 'manager_declined') {
      const fromIdx = lastManagerIdx >= 0 ? lastManagerIdx : trackedIdx;
      let pi = fromIdx - 1;
      while (pi >= 0 && stageTypeOf(stages[pi]) !== 'employee') pi--;
      declineEvents.push({ fromIdx, toIdx: pi >= 0 ? pi : 0, comment: entry.comment ?? null, at: entry.created_at, actor_name: entry.actor_name ?? '' });
      trackedIdx = pi >= 0 ? pi : 0; lastManagerIdx = -1;
    } else if (entry.action === 'employee_declined') {
      declineEvents.push({ fromIdx: trackedIdx, toIdx: trackedIdx, comment: entry.comment ?? null, at: entry.created_at, actor_name: entry.actor_name ?? '' });
    }
  }

  const rejectedStageIdx = (() => {
    if (!lastWasRejected) return currentIdx;
    if (lastLogEntry.action === 'admin_declined') {
      const idx = stages.findIndex((s: any, si: number) => si > currentIdx && s.type === 'admin');
      return idx >= 0 ? idx : currentIdx;
    }
    return currentIdx;
  })();
  const redoIdx = rejectedStageIdx > currentIdx ? currentIdx : rejectedStageIdx - 1;

  const fa = task.xlr8_final_approval || {};
  const allStagesDone = isCompleted || ['pending_admin', 'pending_client', 'completed'].includes(task.xlr8_status);

  const cardW = 180, arrowW = 40, unitW = cardW + arrowW;
  const totalW = stages.length * cardW + (stages.length - 1) * arrowW;
  const baseArcH = 40, arcStep = 20;
  const realArcs = declineEvents.filter(ev => ev.fromIdx !== ev.toIdx);
  const maxArcH = baseArcH + (realArcs.length - 1) * arcStep;

  const approvalCards: { key: string; label: string; color: string; accentColor: string; isDone: boolean; isActive: boolean }[] = [];
  if (fa.adminRequired) {
    approvalCards.push({ key: 'admin', label: 'Admin Approval', color: '#ea580c', accentColor: 'rgba(234,88,12,0.08)',
      isDone: isCompleted || task.xlr8_status === 'pending_client',
      isActive: task.xlr8_status === 'pending_admin' });
  }
  if (fa.clientOptional) {
    approvalCards.push({ key: 'client', label: 'Client Approval', color: '#0891b2', accentColor: 'rgba(8,145,178,0.08)',
      isDone: isCompleted,
      isActive: task.xlr8_status === 'pending_client' });
  }

  return (
    <div style={{ overflowX: 'auto', position: 'relative' }}>
      <div style={{ width: 'max-content' }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'stretch', gap: 0, marginTop: 10 }}>
          {stages.map((stage: any, i: number) => {
            const isRejected   = lastWasRejected && i === rejectedStageIdx;
            const isRedoTarget = lastWasRejected && i === redoIdx;
            const isDone    = !isRedoTarget && !isRejected && (isCompleted || i < currentIdx);
            const isCurrent = !isCompleted && i === currentIdx && !isRejected;
            const isPending = !isCompleted && !isRejected && i > currentIdx && i !== redoIdx;
            const stageAssignee = stageAssignees.filter((a: any) => a.stage_idx === i && a.user_id);
            const trackedSec = Number(stageTracked.find((t: any) => t.stage_idx === i)?.tracked_seconds ?? 0);
            const label = stage.type === 'admin' ? 'Admin Review' : stage.type === 'manager' ? 'Manager Review' : stage.category_name;
            const borderColor = isRejected ? '#ef4444' : isDone ? '#22c55e' : isCurrent ? '#3b82f6' : isRedoTarget ? '#f59e0b' : '#e2e8f0';
            const bgColor = isRejected ? 'rgba(239,68,68,0.05)' : isDone ? 'rgba(34,197,94,0.06)' : isCurrent ? 'rgba(59,130,246,0.05)' : isRedoTarget ? 'rgba(245,158,11,0.05)' : 'rgba(255,255,255,0.6)';
            const dotColor = isRejected ? '#ef4444' : isDone ? '#22c55e' : isCurrent ? '#3b82f6' : isRedoTarget ? '#f59e0b' : '#cbd5e1';
            const pill: Record<string, { label: string; bg: string; color: string }> = {
              working:  { label: 'Working',         bg: 'rgba(59,130,246,0.12)',  color: '#2563eb' },
              accepted: { label: 'Accepted',        bg: 'rgba(34,197,94,0.12)',   color: '#16a34a' },
              declined: { label: 'Declined',        bg: 'rgba(239,68,68,0.12)',   color: '#dc2626' },
              pending:  { label: 'Not yet accepted',bg: 'rgba(148,163,184,0.15)', color: '#64748b' },
            };
            return (
              <div key={i} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', flexShrink: 0 }}>
                <div style={{ width: cardW, minHeight: 130, border: `2px solid ${borderColor}`, borderRadius: 12, padding: '14px 12px 12px', background: bgColor, position: 'relative', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ position: 'absolute', top: -10, left: 10, background: dotColor, color: '#fff', borderRadius: 99, fontSize: 9, fontWeight: 800, padding: '1px 7px', whiteSpace: 'nowrap' }}>Stage {i + 1}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: isPending ? '#94a3b8' : '#1a1a1a', lineHeight: 1.3, marginTop: 4 }}>{label}</div>
                  <div style={{ flex: 1 }}>
                    {stageAssignee.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {stageAssignee.map((a: any) => {
                          const status = a.acceptance_status || 'pending';
                          const p = pill[status] || pill.pending;
                          return (
                            <span key={a.user_id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: isPending ? '#94a3b8' : '#1a1a1a', flexWrap: 'wrap' }}>
                              <Avatar name={a.user_name || '?'} color={isPending ? '#cbd5e1' : a.avatar_color} url={isPending ? undefined : a.avatar_url} size={16} />
                              {a.user_name?.split(' ')[0]}
                              <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 99, background: p.bg, color: p.color }}>{p.label}</span>
                            </span>
                          );
                        })}
                      </div>
                    ) : <span style={{ fontSize: 10, color: '#94a3b8', fontStyle: 'italic' }}>TBD</span>}
                  </div>
                  {(() => {
                    const estSec = stageAssignee.reduce((s: number, a: any) => s + (Number(a.est_hours) || 0) * 3600, 0);
                    const overSec = trackedSec > 0 && estSec > 0 ? Math.max(0, trackedSec - estSec) : 0;
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, color: trackedSec > 0 ? '#78716c' : '#cbd5e1' }}>
                        {trackedSec > 0 ? fmtSec(trackedSec) : '—'} logged
                        {overSec > 0 && <span style={{ fontSize: 9, fontWeight: 800, color: '#dc2626', background: 'rgba(220,38,38,0.1)', borderRadius: 99, padding: '1px 5px', marginLeft: 2 }}>+{fmtSec(overSec)} over</span>}
                      </div>
                    );
                  })()}
                  {isRejected && lastLogEntry?.comment && <div style={{ fontSize: 10, color: '#ef4444', background: 'rgba(239,68,68,0.08)', borderRadius: 6, padding: '4px 6px', fontStyle: 'italic' }}>✕ "{lastLogEntry.comment}"</div>}
                </div>
                {i < stages.length - 1 && (
                  <div style={{ width: arrowW, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
          {approvalCards.map((c, ci) => (
            <div key={c.key} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', flexShrink: 0 }}>
              <div style={{ width: 32, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="32" height="20" viewBox="0 0 32 20">
                  <line x1="0" y1="10" x2="22" y2="10" stroke={ci === 0 && allStagesDone ? '#22c55e' : '#e2e8f0'} strokeWidth="2" strokeDasharray={!allStagesDone ? '4 3' : 'none'} />
                  <polygon points="32,10 20,4 20,16" fill={ci === 0 && allStagesDone ? '#22c55e' : '#e2e8f0'} />
                </svg>
              </div>
              <div style={{ width: 160, minHeight: 100, border: `2px solid ${c.isDone ? '#22c55e' : c.isActive ? c.color : '#e2e8f0'}`, borderRadius: 12, padding: '14px 12px 12px', background: c.isDone ? 'rgba(34,197,94,0.06)' : c.isActive ? c.accentColor : 'rgba(255,255,255,0.6)', position: 'relative', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
                <div style={{ position: 'absolute', top: -10, left: 10, background: c.isDone ? '#22c55e' : c.isActive ? c.color : '#cbd5e1', color: '#fff', borderRadius: 99, fontSize: 9, fontWeight: 800, padding: '1px 7px', whiteSpace: 'nowrap' }}>{c.label}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: c.isDone ? '#15803d' : c.isActive ? c.color : '#94a3b8', marginTop: 4 }}>
                  {c.isDone ? '✓ Approved' : c.isActive ? 'Pending approval' : 'Awaiting stages'}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Rejection arcs */}
        {realArcs.length > 0 && (
          <div style={{ marginTop: 8, position: 'relative', minWidth: totalW }}>
            <svg width={totalW} height={maxArcH + 4} viewBox={`0 0 ${totalW} ${maxArcH + 4}`} style={{ display: 'block', overflow: 'visible' }}>
              <defs><marker id="rejArrow" markerWidth="8" markerHeight="8" refX="1" refY="4" orient="auto-start-reverse"><polygon points="8,4 0,0 0,8" fill="#ef4444" /></marker></defs>
              {realArcs.map((ev, ei) => {
                const fromX = ev.fromIdx * unitW + cardW / 2;
                const toX = ev.toIdx * unitW + cardW / 2;
                const h = maxArcH - ei * arcStep;
                const isLast = ei === realArcs.length - 1;
                return (
                  <path key={ei} d={`M ${fromX} 4 C ${fromX} ${h}, ${toX} ${h}, ${toX} 4`}
                    stroke="#ef4444" strokeWidth={isLast ? 2.5 : 1.5} fill="none"
                    markerEnd={isLast ? 'url(#rejArrow)' : undefined}
                    strokeDasharray="5 3" opacity={0.25 + (ei / Math.max(1, realArcs.length - 1)) * 0.75} />
                );
              })}
            </svg>
          </div>
        )}

        {/* Rejection history */}
        {declineEvents.length > 0 && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 5 }}>
            {declineEvents.map((ev, ei) => (
              <div key={ei} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 11 }}>
                <div style={{ width: 18, height: 18, borderRadius: '50%', background: ei === declineEvents.length - 1 ? '#ef4444' : '#fca5a5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 800, color: '#fff', flexShrink: 0, marginTop: 1 }}>{ei + 1}</div>
                <div>
                  <span style={{ fontWeight: 700, color: ei === declineEvents.length - 1 ? '#ef4444' : '#f87171' }}>Rejection {ei + 1}</span>
                  {ev.actor_name && <span style={{ color: '#78716c', marginLeft: 4 }}>by {ev.actor_name}</span>}
                  {ev.at && <span style={{ color: '#78716c', marginLeft: 4 }}>· {fmtTs(ev.at)}</span>}
                  {ev.comment && <span style={{ color: '#b91c1c', fontStyle: 'italic', marginLeft: 4 }}>— "{ev.comment}"</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ShareTask() {
  const { token } = useParams<{ token: string }>();
  const [task, setTask] = useState<any>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'info' | 'activity'>('info');

  useEffect(() => {
    document.documentElement.style.overflow = 'auto';
    document.body.style.overflow = 'auto';
    document.body.style.height = 'auto';
    return () => {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
      document.body.style.height = '';
    };
  }, []);

  useEffect(() => {
    if (!token) return;
    axios.get(`${API}/public/task/${token}`)
      .then(r => setTask(r.data))
      .catch(() => setError('This task link is invalid or has been revoked.'));
  }, [token]);

  if (error) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8f5f0', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ textAlign: 'center', color: '#78716c' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{error}</div>
      </div>
    </div>
  );

  if (!task) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8f5f0' }}>
      <div style={{ width: 32, height: 32, borderRadius: '50%', border: '3px solid #e5e0d8', borderTopColor: '#1a1a1a', animation: 'spin 0.7s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );

  const mon = task.created_at ? new Date(task.created_at).toLocaleString('en-US', { month: 'short' }).toUpperCase() : '';
  const proj = (task.project_name || '').replace(/\s+/g, '').toUpperCase().slice(0, 8);
  const taskKey = `${proj}-${task.id}-${mon}`;
  const statusStyle = STATUS_COLORS[task.status] || STATUS_COLORS.todo;
  const priorityStyle = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.medium;
  const activityLog: any[] = task.activity_log || [];
  const deliverables: any[] = task.deliverables || [];
  const hasStages = task.ticket_type_id && (task.xlr8_stages?.length > 0);

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f8f5f0 0%, #ede8e0 100%)', fontFamily: 'system-ui, -apple-system, sans-serif', padding: '40px 20px 80px' }}>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>

        {/* Header card */}
        <div style={{ borderRadius: 20, border: '1px solid rgba(255,255,255,0.7)', background: 'linear-gradient(135deg, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.6) 100%)', backdropFilter: 'blur(24px)', boxShadow: '0 10px 40px rgba(0,0,0,0.06)', padding: '28px 28px 0', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#78716c', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>{task.project_name}{task.client_name ? ` · ${task.client_name}` : ''}</div>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#1a1a1a', lineHeight: 1.2 }}>{task.title}</h1>
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, padding: '5px 14px', borderRadius: 99, border: `1px solid ${statusStyle.border}`, background: statusStyle.bg, color: statusStyle.color, textTransform: 'capitalize', whiteSpace: 'nowrap' }}>
              {task.status?.replace(/_/g, ' ')}
            </span>
          </div>

          {/* Info grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 20 }}>
            {[
              { label: 'Task Key', value: <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13 }}>{taskKey}</span> },
              { label: 'Due Date', value: task.due_date ? new Date(task.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—' },
              { label: 'Created by', value: task.created_by_name || '—' },
              { label: 'Priority', value: <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: priorityStyle.bg, color: priorityStyle.color, textTransform: 'capitalize' }}>{task.priority || 'medium'}</span> },
            ].map(({ label, value }) => (
              <div key={label} style={{ background: 'rgba(0,0,0,0.03)', borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: '#78716c', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 13, color: '#1a1a1a' }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', borderTop: '1px solid rgba(0,0,0,0.07)', marginTop: 4 }}>
            {(['info', 'activity'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '10px 18px', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: tab === t ? '#1a1a1a' : '#78716c', borderBottom: tab === t ? '2px solid #1a1a1a' : '2px solid transparent', marginBottom: -1 }}>
                {t === 'info' ? 'Info' : 'Activity Log'}
              </button>
            ))}
          </div>
        </div>

        {/* ── Info tab ── */}
        {tab === 'info' && (
          <>
            {/* Description */}
            {task.description && (
              <div style={{ borderRadius: 16, border: '1px solid rgba(255,255,255,0.7)', background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(16px)', padding: '20px 24px', marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#78716c', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Description</div>
                <div style={{ fontSize: 13, color: '#1a1a1a', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{linkify(task.description)}</div>
              </div>
            )}

            {/* Stage Flow */}
            {hasStages && (
              <div style={{ borderRadius: 16, border: '1px solid rgba(255,255,255,0.7)', background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(16px)', padding: '20px 24px', marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#78716c', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Stage Flow</div>
                <StageFlow task={task} log={activityLog} />
              </div>
            )}

            {/* Attachments */}
            {deliverables.length > 0 && (
              <div style={{ borderRadius: 16, border: '1px solid rgba(255,255,255,0.7)', background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(16px)', padding: '20px 24px', marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#78716c', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Attachments</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {deliverables.map((d: any) => (
                    <a key={d.id} href={d.url} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.06)', textDecoration: 'none', color: '#1a1a1a', fontSize: 13, fontWeight: 500 }}>
                      <span style={{ fontSize: 16 }}>{d.type === 'file' ? '📎' : '🔗'}</span>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name || d.url}</span>
                      <span style={{ fontSize: 10, color: '#78716c' }}>↗</span>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Activity Log tab ── */}
        {tab === 'activity' && (
          <div style={{ borderRadius: 16, border: '1px solid rgba(255,255,255,0.7)', background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(16px)', padding: '20px 24px' }}>
            {activityLog.length > 0 ? activityLog.map((entry: any, i: number) => {
              const isDanger = entry.action?.includes('declined') || entry.action?.includes('reject');
              return (
                <div key={i} style={{ fontSize: 12, padding: '10px 12px', borderRadius: 8, background: isDanger ? 'rgba(239,68,68,0.06)' : 'rgba(34,197,94,0.06)', border: `1px solid ${isDanger ? 'rgba(239,68,68,0.18)' : 'rgba(34,197,94,0.18)'}`, marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span><strong style={{ color: '#1a1a1a' }}>{entry.actor_name}</strong> · <span style={{ color: '#78716c' }}>{ACTION_LABELS[entry.action] || entry.action}</span></span>
                    <span style={{ fontSize: 10, color: '#78716c', whiteSpace: 'nowrap' }}>{fmtTs(entry.created_at)}</span>
                  </div>
                  {entry.comment && <div style={{ fontSize: 11, color: '#78716c', fontStyle: 'italic', marginTop: 3 }}>"{entry.comment}"</div>}
                </div>
              );
            }) : (
              <div style={{ fontSize: 13, color: '#78716c', fontStyle: 'italic' }}>
                {task.ticket_type_id ? 'No workflow history yet.' : 'Activity log is available for XLR8 workflow tasks only.'}
              </div>
            )}
          </div>
        )}

        <div style={{ textAlign: 'center', fontSize: 11, color: '#a8a29e', marginTop: 32 }}>
          This is a live task link — it always reflects the latest status.
        </div>
      </div>
    </div>
  );
}
