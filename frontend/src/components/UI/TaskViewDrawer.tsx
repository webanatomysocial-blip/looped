<title>TaskViewDrawer</title>
import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Paperclip, Link2, ExternalLink, Trash2 } from 'lucide-react';
import XLR8StageFlow, { fmtSec } from './XLR8StageFlow';
import { tasksApi, xlr8Api } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { MiniAvatar } from './Avatar';

const URL_RE = /(https?:\/\/[^\s]+)/g;
function linkifyText(text: string) {
  const parts = text.split(URL_RE);
  return parts.map((p, i) =>
    URL_RE.test(p)
      ? <a key={i} href={p} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--blue, #2563eb)', textDecoration: 'underline', wordBreak: 'break-all' }}>{p}</a>
      : p
  );
}

interface Props {
  taskId: number;
  onClose: () => void;
}

const ACTION_LABELS: Record<string, string> = {
  created: 'Created', assigned: 'Assigned to employee', employee_accepted: 'Accepted',
  employee_declined: 'Declined', work_done: 'Marked done',
  manager_approved: 'Manager approved', manager_declined: 'Returned to employee',
  next_stage: 'Moved to next stage', sent_to_admin: 'Sent to admin',
  admin_approved: 'Admin approved', admin_declined: 'Admin returned to employee', admin_skip_client: 'Completed (client skipped)',
  admin_skipped: 'Admin skipped', client_approved: 'Client approved', completed: 'Completed',
};


export default function TaskViewDrawer({ taskId, onClose }: Props) {
  const { user } = useAuth();
  const [task, setTask] = useState<any>(null);
  const [log, setLog]   = useState<any[]>([]);
  const [deliverables, setDeliverables] = useState<any[]>([]);
  const [linkInput, setLinkInput] = useState('');
  const [uploading, setUploading] = useState(false);
  const [tab, setTab]   = useState<'info' | 'activity'>('info');
  const [loading, setLoading] = useState(true);
  const [linkCopied, setLinkCopied] = useState(false);
  const [drawerElapsed, setDrawerElapsed] = useState(0);

  const handleCopyLink = async () => {
    try {
      const r = await tasksApi.getShareToken(taskId);
      const url = `${window.location.origin}/share/task/${r.data.token}`;
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {}
  };

  const addLink = async () => {
    const url = linkInput.trim();
    if (!url) return;
    try {
      const r = await tasksApi.addDeliverableLink(taskId, url);
      setDeliverables(prev => [...prev, r.data]);
      setLinkInput('');
    } catch {}
  };

  const addFile = async (file: File) => {
    setUploading(true);
    try {
      const r = await tasksApi.addDeliverableFile(taskId, file);
      setDeliverables(prev => [...prev, r.data]);
    } catch {} finally { setUploading(false); }
  };

  const removeDeliverable = async (id: number) => {
    try {
      await tasksApi.deleteDeliverable(taskId, id);
      setDeliverables(prev => prev.filter(d => d.id !== id));
    } catch {}
  };

  useEffect(() => {
    setLoading(true);
    setTask(null);
    setLog([]);
    setDeliverables([]);
    setTab('info');
    tasksApi.get(taskId)
      .then(r => {
        setTask(r.data);
        if (r.data.ticket_type_id) {
          xlr8Api.getTicketLog(taskId).then(lr => setLog(lr.data)).catch(() => {});
        }
        tasksApi.getDeliverables(taskId).then(dr => setDeliverables(dr.data || [])).catch(() => {});
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [taskId]);

  // Tick elapsed seconds so live-running stage tracked time stays accurate
  useEffect(() => {
    setDrawerElapsed(0);
    const id = setInterval(() => setDrawerElapsed(e => e + 1), 1000);
    return () => clearInterval(id);
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
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{proj}-{task.id}-{mon}</span>
                        <button onClick={handleCopyLink} style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, border: '1px solid var(--border, #e5e5e5)', background: linkCopied ? 'rgba(34,197,94,0.1)' : 'transparent', color: linkCopied ? '#15803d' : 'var(--ink-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, transition: 'all 0.15s', fontFamily: 'inherit' }}>
                          {linkCopied ? '✓ Copied' : '🔗 Copy link'}
                        </button>
                      </div>
                    );
                  })() },
                  { label: 'Status', value: <span className={`badge badge--${task.status}`}>{({ pending_approval: 'Pending Approval', draft: 'Draft', todo: 'To Do', in_progress: 'In Progress', in_review: 'In Review', overdue: 'Delayed', completed: 'Completed' } as Record<string,string>)[task.status] ?? task.status}</span> },
                  { label: 'Due Date', value: task.due_date ? format(new Date(task.due_date + 'T00:00:00'), 'MMM d, yyyy') : '—' },
                  { label: 'Created by', value: task.created_by_name || '—' },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <div className="drawer-info-label">{label}</div>
                    <div style={{ fontSize: 13, color: 'var(--ink)', marginTop: 2 }}>{value}</div>
                  </div>
                ))}
              </div>

              {/* Manager approve/reject for pending_approval tasks */}
              {task.status === 'pending_approval' && (user?.role === 'manager' || user?.role === 'admin') && (
                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                  <button
                    onClick={async () => { await tasksApi.managerApprove(taskId, 'approve'); const r = await tasksApi.get(taskId); setTask(r.data); }}
                    style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', background: 'var(--green)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
                  >✓ Approve Task</button>
                  <button
                    onClick={async () => { await tasksApi.managerApprove(taskId, 'reject'); const r = await tasksApi.get(taskId); setTask(r.data); }}
                    style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: '1.5px solid var(--red)', background: 'transparent', color: 'var(--red)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
                  >✕ Reject</button>
                </div>
              )}

              {/* Description */}
              <div>
                <div className="drawer-info-label">Description</div>
                {task.description
                  ? <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.6, whiteSpace: 'pre-wrap', background: 'rgba(0,0,0,0.03)', borderRadius: 8, padding: '12px 14px', marginTop: 6 }}>{linkifyText(task.description)}</div>
                  : <div style={{ fontSize: 13, color: 'var(--ink-muted)', fontStyle: 'italic', marginTop: 4 }}>No description provided.</div>
                }
              </div>

              {/* Attachments — always visible for XLR8 tasks */}
              {task.ticket_type_id && (
                <div style={{ marginBottom: 20 }}>
                  <div className="drawer-info-label" style={{ marginBottom: 8 }}>Attachments</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {deliverables.length === 0 && (
                      <div style={{ fontSize: 12, color: 'var(--ink-muted)', fontStyle: 'italic', padding: '6px 0' }}>No attachments yet</div>
                    )}
                    {deliverables.map((d: any) => (
                      <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                        {d.type === 'file' ? <Paperclip size={13} color="var(--ink-muted)" /> : <Link2 size={13} color="var(--ink-muted)" />}
                        <a href={d.url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, fontSize: 12, color: 'var(--ink)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</a>
                        <ExternalLink size={11} color="var(--ink-muted)" style={{ flexShrink: 0 }} />
                        <button onClick={() => removeDeliverable(d.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, flexShrink: 0 }}>
                          <Trash2 size={11} color="#ef4444" />
                        </button>
                      </div>
                    ))}
                    <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                      <input
                        value={linkInput}
                        onChange={e => setLinkInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') addLink(); }}
                        placeholder="Paste link (Drive, Figma, URL…)"
                        style={{ flex: 1, padding: '6px 10px', borderRadius: 7, border: '1px solid var(--border)', fontSize: 12, background: 'var(--surface)', color: 'var(--ink)', outline: 'none' }}
                      />
                      <button onClick={addLink} style={{ padding: '6px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap', color: 'var(--ink)' }}>+ Link</button>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: 'var(--ink-muted)', padding: '7px 12px', border: '1.5px dashed var(--border)', borderRadius: 8, justifyContent: 'center' }}>
                      <Paperclip size={13} />
                      {uploading ? 'Uploading…' : 'Upload a file'}
                      <input type="file" style={{ display: 'none' }} disabled={uploading}
                        onChange={async e => { const f = e.target.files?.[0]; if (f) await addFile(f); e.target.value = ''; }}
                      />
                    </label>
                  </div>
                </div>
              )}

              {/* XLR8 Stage Tracker */}
              {task.ticket_type_id && task.xlr8_stages?.length > 0 && (
                <div>
                  <div className="drawer-info-label" style={{ marginBottom: 12 }}>Stage Flow</div>
                  <XLR8StageFlow task={task} log={log} drawerElapsed={drawerElapsed} />
                </div>
              )}

              {/* Non-XLR8: assigned to */}
              {!task.ticket_type_id && (
                <div>
                  <div className="drawer-info-label">Assigned to</div>
                  <div style={{ fontSize: 13, color: 'var(--ink)', marginTop: 2 }}>
                    {task.assignees?.length > 0 ? task.assignees.map((a: any) => a.name).join(', ') : task.assigned_name || '—'}
                  </div>
                </div>
              )}

              {/* Attachments (non-XLR8 tasks) */}
              {!task.ticket_type_id && (
                <div>
                  <div className="drawer-info-label" style={{ marginBottom: 8 }}>Attachments</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {deliverables.length === 0 && <div style={{ fontSize: 12, color: 'var(--ink-muted)', fontStyle: 'italic' }}>No attachments yet</div>}
                    {deliverables.map((d: any) => (
                      <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                        {d.type === 'file' ? <Paperclip size={13} color="var(--ink-muted)" /> : <Link2 size={13} color="var(--ink-muted)" />}
                        <a href={d.url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, fontSize: 12, color: 'var(--ink)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</a>
                        <ExternalLink size={11} color="var(--ink-muted)" style={{ flexShrink: 0 }} />
                        <button onClick={() => removeDeliverable(d.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}><Trash2 size={11} color="#ef4444" /></button>
                      </div>
                    ))}
                    <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                      <input value={linkInput} onChange={e => setLinkInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addLink(); }} placeholder="Paste link…" style={{ flex: 1, padding: '6px 10px', borderRadius: 7, border: '1px solid var(--border)', fontSize: 12, background: 'var(--surface)', color: 'var(--ink)', outline: 'none' }} />
                      <button onClick={addLink} style={{ padding: '6px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: 12, color: 'var(--ink)' }}>+ Link</button>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: 'var(--ink-muted)', padding: '7px 12px', border: '1.5px dashed var(--border)', borderRadius: 8, justifyContent: 'center' }}>
                      <Paperclip size={13} />{uploading ? 'Uploading…' : 'Upload a file'}
                      <input type="file" style={{ display: 'none' }} disabled={uploading} onChange={async e => { const f = e.target.files?.[0]; if (f) await addFile(f); e.target.value = ''; }} />
                    </label>
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
