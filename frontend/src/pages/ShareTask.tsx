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

const STATUS_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  todo:              { bg: '#f1f5f9', color: '#475569', border: '#cbd5e1' },
  in_progress:       { bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe' },
  done:              { bg: '#fefce8', color: '#b45309', border: '#fde68a' },
  completed:         { bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0' },
  manager_review:    { bg: '#faf5ff', color: '#7c3aed', border: '#ddd6fe' },
  admin_review:      { bg: '#fdf4ff', color: '#a21caf', border: '#f0abfc' },
  client_review:     { bg: '#fff7ed', color: '#ea580c', border: '#fed7aa' },
  rejected:          { bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
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

export default function ShareTask() {
  const { token } = useParams<{ token: string }>();
  const [task, setTask] = useState<any>(null);
  const [error, setError] = useState('');

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

  const stageAssignees: any[] = task.stage_assignees || [];
  const stageTracked: any[] = task.stage_tracked || [];
  const stages: any[] = task.xlr8_stages || [];
  const finalApproval = task.xlr8_final_approval;
  const deliverables: any[] = task.deliverables || [];

  const trackedByStage = Object.fromEntries(stageTracked.map((s: any) => [s.stage_idx, Number(s.tracked_seconds)]));
  const assigneesByStage = stageAssignees.reduce((acc: any, a: any) => {
    if (a.stage_idx == null) return acc;
    if (!acc[a.stage_idx]) acc[a.stage_idx] = [];
    acc[a.stage_idx].push(a);
    return acc;
  }, {});

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f8f5f0 0%, #ede8e0 100%)', fontFamily: 'system-ui, -apple-system, sans-serif', padding: '40px 20px 80px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>

        {/* Header card */}
        <div style={{ borderRadius: 20, border: '1px solid rgba(255,255,255,0.7)', background: 'linear-gradient(135deg, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.6) 100%)', backdropFilter: 'blur(24px)', boxShadow: '0 10px 40px rgba(0,0,0,0.06)', padding: '28px 28px 24px', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#78716c', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>{task.project_name}</div>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#1a1a1a', lineHeight: 1.2 }}>{task.title}</h1>
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, padding: '5px 14px', borderRadius: 99, border: `1px solid ${statusStyle.border}`, background: statusStyle.bg, color: statusStyle.color, textTransform: 'capitalize', whiteSpace: 'nowrap' }}>
              {task.status?.replace(/_/g, ' ')}
            </span>
          </div>

          {/* Info grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
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
        </div>

        {/* Description */}
        {task.description && (
          <div style={{ borderRadius: 16, border: '1px solid rgba(255,255,255,0.7)', background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(16px)', padding: '20px 24px', marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#78716c', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Description</div>
            <div style={{ fontSize: 13, color: '#1a1a1a', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{linkify(task.description)}</div>
          </div>
        )}

        {/* Stage Flow (XLR8 tasks) */}
        {stages.length > 0 && (
          <div style={{ borderRadius: 16, border: '1px solid rgba(255,255,255,0.7)', background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(16px)', padding: '20px 24px', marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#78716c', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>Stage Flow</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {stages.map((stage: any, idx: number) => {
                const assignees = assigneesByStage[idx] || [];
                const tracked = trackedByStage[idx] || 0;
                const isCurrent = idx === (task.xlr8_stage_idx ?? 0);
                const isDone = idx < (task.xlr8_stage_idx ?? 0) || task.status === 'completed';
                return (
                  <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px', borderRadius: 12, background: isCurrent ? 'rgba(37,99,235,0.06)' : isDone ? 'rgba(34,197,94,0.04)' : 'rgba(0,0,0,0.02)', border: `1px solid ${isCurrent ? '#bfdbfe' : isDone ? '#bbf7d0' : 'transparent'}` }}>
                    <div style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0, background: isDone ? '#22c55e' : isCurrent ? '#2563eb' : '#d1d5db', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff' }}>
                      {isDone ? '✓' : idx + 1}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', marginBottom: 4 }}>{stage.name || `Stage ${idx + 1}`}</div>
                      {assignees.map((a: any) => (
                        <div key={a.user_id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                          <Avatar name={a.user_name} color={a.avatar_color} url={a.avatar_url} size={20} />
                          <span style={{ fontSize: 12, color: '#44403c' }}>{a.user_name}</span>
                          <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 99, background: a.acceptance_status === 'accepted' ? 'rgba(34,197,94,0.1)' : a.acceptance_status === 'rejected' ? 'rgba(239,68,68,0.1)' : 'rgba(0,0,0,0.06)', color: a.acceptance_status === 'accepted' ? '#15803d' : a.acceptance_status === 'rejected' ? '#dc2626' : '#78716c', textTransform: 'capitalize' }}>
                            {a.acceptance_status || 'Not yet accepted'}
                          </span>
                        </div>
                      ))}
                      {tracked > 0 && <div style={{ fontSize: 11, color: '#78716c', marginTop: 4 }}>{fmtSec(tracked)} logged</div>}
                    </div>
                  </div>
                );
              })}

              {/* Final approvals */}
              {finalApproval && (
                <>
                  {(finalApproval.admin !== false) && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 12, background: 'rgba(0,0,0,0.02)' }}>
                      <div style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0, background: task.admin_approved ? '#22c55e' : '#d1d5db', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff' }}>A</div>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#1a1a1a' }}>Admin Approval</div>
                        <div style={{ fontSize: 11, color: task.admin_approved ? '#15803d' : '#78716c', fontWeight: 600 }}>{task.admin_approved ? 'Approved' : 'Pending'}</div>
                      </div>
                    </div>
                  )}
                  {(finalApproval.client !== false) && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 12, background: 'rgba(0,0,0,0.02)' }}>
                      <div style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0, background: task.client_approved ? '#22c55e' : '#d1d5db', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff' }}>C</div>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#1a1a1a' }}>Client Approval</div>
                        <div style={{ fontSize: 11, color: task.client_approved ? '#15803d' : '#78716c', fontWeight: 600 }}>{task.client_approved ? 'Approved' : 'Pending'}</div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
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

        {/* Footer */}
        <div style={{ textAlign: 'center', fontSize: 11, color: '#a8a29e', marginTop: 32 }}>
          This is a live task link — it always reflects the latest status.
        </div>
      </div>
    </div>
  );
}
