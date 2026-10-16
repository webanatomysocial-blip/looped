<title>TaskViewDrawer</title>
import { useEffect, useState, useRef } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { Paperclip, Link2, ExternalLink, Trash2, CornerDownRight, Pencil, X, Check } from 'lucide-react';
import XLR8StageFlow, { fmtSec } from './XLR8StageFlow';
import { tasksApi, xlr8Api } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { MiniAvatar } from './Avatar';
import TaskApprovalSection from '../approvals/TaskApprovalSection';
import { taskStage, reworkFromLog, TASK_STAGE_LABELS, TASK_STAGE_BADGE } from '../../utils/taskStatus';

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
  // Show the task's approval (Start Review, Review…) at the top of Info — Tasks page only
  showApproval?: boolean;
  // Called after an approval action so the page behind can refresh
  onChanged?: () => void;
}

const ACTION_LABELS: Record<string, string> = {
  created: 'Created', assigned: 'Assigned to employee', employee_accepted: 'Accepted',
  employee_declined: 'Declined', work_done: 'Marked done',
  manager_approved: 'Manager approved', manager_declined: 'Returned to employee',
  next_stage: 'Moved to next stage', sent_to_admin: 'Sent to admin',
  admin_approved: 'Admin approved', admin_declined: 'Admin returned to employee', admin_skip_client: 'Completed (client skipped)',
  admin_skipped: 'Admin skipped', client_approved: 'Client approved', completed: 'Completed',
};


export default function TaskViewDrawer({ taskId, onClose, showApproval = false, onChanged }: Props) {
  const { user } = useAuth();
  const [task, setTask] = useState<any>(null);
  // Bumped after an approval action to reload the task (status, stage flow)
  const [reloadKey, setReloadKey] = useState(0);
  const [log, setLog]   = useState<any[]>([]);
  const [deliverables, setDeliverables] = useState<any[]>([]);
  const [linkInput, setLinkInput] = useState('');
  const [uploading, setUploading] = useState(false);
  const [tab, setTab]   = useState<'info' | 'activity' | 'comments'>('info');
  const [loading, setLoading] = useState(true);
  const [linkCopied, setLinkCopied] = useState(false);
  const [drawerElapsed, setDrawerElapsed] = useState(0);
  const [comments, setComments] = useState<any[]>([]);
  const [commentText, setCommentText] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const [replyText, setReplyText] = useState('');
  const [editingComment, setEditingComment] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const commentInputRef = useRef<HTMLTextAreaElement>(null);
  const replyInputRef = useRef<HTMLInputElement>(null);

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
    setComments([]);
    setCommentText('');
    setReplyingTo(null);
    setEditingComment(null);
    setTab('info');
    tasksApi.get(taskId)
      .then(r => {
        setTask(r.data);
        if (r.data.ticket_type_id) {
          xlr8Api.getTicketLog(taskId).then(lr => setLog(lr.data)).catch(() => {});
        }
        tasksApi.getDeliverables(taskId).then(dr => setDeliverables(dr.data || [])).catch(() => {});
        tasksApi.getComments(taskId).then(cr => setComments(cr.data || [])).catch(() => {});
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [taskId]);

  // After an approval action: refresh in place (no reset), so the approval section and its popups stay
  useEffect(() => {
    if (!reloadKey) return;
    tasksApi.get(taskId).then(r => {
      setTask(r.data);
      if (r.data.ticket_type_id) xlr8Api.getTicketLog(taskId).then(lr => setLog(lr.data)).catch(() => {});
    }).catch(() => {});
    tasksApi.getDeliverables(taskId).then(dr => setDeliverables(dr.data || [])).catch(() => {});
  }, [reloadKey]);

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
              {([['info','Info'], ['comments', `Comments${comments.length ? ` (${comments.length})` : ''}`], ['activity','Activity Log']] as const).map(([t, label]) => (
                <button key={t} type="button" onClick={() => setTab(t as any)} style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: '6px 14px 10px',
                  fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                  color: tab === t ? 'var(--ink)' : 'var(--ink-muted)',
                  borderBottom: tab === t ? '2px solid var(--ink)' : '2px solid transparent',
                  marginBottom: -1.5, whiteSpace: 'nowrap',
                }}>
                  {label}
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
              {showApproval && (
                <TaskApprovalSection taskId={taskId} onChanged={() => { setReloadKey(k => k + 1); onChanged?.(); }} />
              )}
              {/* Meta */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {[
                  { label: 'Ticket Key', value: (() => {
                    const mon = task.created_at ? (() => { const s = String(task.created_at); const iso = s.includes('T') || s.includes('Z') || s.includes('+') ? s : s.replace(' ', 'T') + 'Z'; return new Date(Number(s) || iso).toLocaleString('en-US', { month: 'short' }).toUpperCase(); })() : '';
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
                  { label: 'Status', value: (() => { const st = taskStage({ ...task, in_rework: task.ticket_type_id ? reworkFromLog(log) : false }); return <span className={`badge badge--${TASK_STAGE_BADGE[st]}`}>{TASK_STAGE_LABELS[st]}</span>; })() },
                  { label: 'Due Date', value: task.due_date ? format(new Date(task.due_date + 'T00:00:00'), 'MMM d, yyyy') : '—' },
                  { label: 'Created by', value: task.created_by_name || '—' },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <div className="drawer-info-label">{label}</div>
                    <div style={{ fontSize: 13, color: 'var(--ink)', marginTop: 2 }}>{value}</div>
                  </div>
                ))}
              </div>

              {/* Approval request: who it's waiting on, or why it was sent back */}
              {(() => {
                const podLabel = (p: string) => p === 'pod1' ? 'Pod 1' : p === 'pod2' ? 'Pod 2' : p;
                let waiting: string[] = [];
                try { waiting = task.crosspod_pods ? JSON.parse(task.crosspod_pods) : []; } catch { waiting = []; }
                let reasons: { pod: string; text: string }[] = [];
                try { reasons = task.crosspod_reasons ? JSON.parse(task.crosspod_reasons) : []; } catch { reasons = []; }
                if (waiting.length && task.status === 'pending_approval') return (
                  <div style={{ marginTop: 16, fontSize: 12, color: '#92400e', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 8, padding: '10px 12px' }}>
                    <div><strong>Waiting for approval</strong> from the {waiting.map(podLabel).join(' & ')} manager. Nothing starts and assignees aren't notified until it's approved.</div>
                    {reasons.length > 0 && (
                      <ul style={{ margin: '8px 0 0', paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {reasons.map((r, i) => {
                          const pending = waiting.includes(r.pod);
                          const mine = user?.role === 'manager' && user?.pod === r.pod;
                          return (
                            <li key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color: pending ? '#92400e' : 'var(--ink-muted)' }}>
                              <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 99, marginTop: 1, background: mine && pending ? '#b45309' : pending ? 'rgba(180,83,9,0.15)' : 'rgba(22,163,74,0.12)', color: mine && pending ? '#fff' : pending ? '#b45309' : 'var(--green)' }}>
                                {mine && pending ? 'Your approval' : pending ? `${podLabel(r.pod)} manager` : `✓ ${podLabel(r.pod)} approved`}
                              </span>
                              <span style={{ textDecoration: pending ? 'none' : 'line-through' }}>{r.text}</span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
                if (task.crosspod_note && task.status === 'draft') return (
                  <div style={{ marginTop: 16, fontSize: 12, color: 'var(--red)', background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.25)', borderRadius: 8, padding: '10px 12px' }}>
                    <strong>Request rejected</strong> — {task.crosspod_note}
                    {task.created_by === user?.id && <div style={{ color: 'var(--ink-muted)', marginTop: 4 }}>Use <strong>Edit &amp; resend</strong> on this ticket in the Tickets list to fix it and send it again.</div>}
                  </div>
                );
                return null;
              })()}

              {/* Manager approve/reject for pending_approval tasks — only someone who can decide sees the buttons */}
              {task.status === 'pending_approval' && (user?.role === 'admin' || (user?.role === 'manager' && (() => {
                try { return !task.crosspod_pods || (JSON.parse(task.crosspod_pods) as string[]).includes(user?.pod ?? ''); } catch { return true; }
              })())) && (
                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                  <button
                    onClick={async () => { try { await tasksApi.managerApprove(taskId, 'approve'); } catch (e: any) { alert(e.response?.data?.error || 'Could not approve'); } const r = await tasksApi.get(taskId); setTask(r.data); }}
                    style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', background: 'var(--green)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
                  >✓ Approve Ticket</button>
                  <button
                    onClick={async () => {
                      let comment: string | undefined;
                      if (task.crosspod_pods) { const c = window.prompt('Reason for rejecting (sent to the creator):'); if (c === null) return; comment = c; }
                      try { await tasksApi.managerApprove(taskId, 'reject', comment); } catch (e: any) { alert(e.response?.data?.error || 'Could not reject'); }
                      const r = await tasksApi.get(taskId); setTask(r.data);
                    }}
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
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <a href={d.url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', fontSize: 12, color: 'var(--ink)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</a>
                          {(d.uploader_name || d.stage_name) && (
                            <div style={{ fontSize: 10, color: 'var(--ink-muted)', marginTop: 2 }}>
                              {d.uploader_name && <>Added by <strong style={{ fontWeight: 600 }}>{d.uploader_name}</strong></>}
                              {d.stage_name && <span style={{ marginLeft: 6, padding: '1px 6px', borderRadius: 4, background: 'rgba(99,102,241,0.1)', color: '#4f46e5', fontWeight: 600 }}>{d.stage_name}</span>}
                            </div>
                          )}
                        </div>
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
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <a href={d.url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', fontSize: 12, color: 'var(--ink)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</a>
                          {(d.uploader_name || d.stage_name) && (
                            <div style={{ fontSize: 10, color: 'var(--ink-muted)', marginTop: 2 }}>
                              {d.uploader_name && <>Added by <strong style={{ fontWeight: 600 }}>{d.uploader_name}</strong></>}
                              {d.stage_name && <span style={{ marginLeft: 6, padding: '1px 6px', borderRadius: 4, background: 'rgba(99,102,241,0.1)', color: '#4f46e5', fontWeight: 600 }}>{d.stage_name}</span>}
                            </div>
                          )}
                        </div>
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
                        {(() => { const s = String(entry.created_at); const iso = s.includes('T') || s.includes('Z') || s.includes('+') ? s : s.replace(' ', 'T') + 'Z'; return format(new Date(Number(s) || iso), 'MMM d, h:mm a'); })()}
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

          {task && tab === 'comments' && (() => {
            const topLevel = comments.filter((c: any) => !c.parent_id);
            const repliesOf = (id: number) => comments.filter((c: any) => c.parent_id === id);
            const fmtTime = (ts: any) => {
              try {
                const s = String(ts);
                const iso = s.includes('T') || s.includes('Z') || s.includes('+') ? s : s.replace(' ', 'T') + 'Z';
                return formatDistanceToNow(new Date(iso), { addSuffix: true });
              } catch { return ''; }
            };
            const canEditComment = (c: any) => String(c.user_id) === String(user?.id);
            const canDeleteComment = (c: any) => String(c.user_id) === String(user?.id);

            const renderComment = (text: string) => <>{text}</>;

            const postComment = async (text: string, parentId?: number) => {
              if (!text.trim()) return;
              const r = await tasksApi.addComment(taskId, text.trim(), parentId);
              setComments(prev => [...prev, r.data]);
            };

            const saveEdit = async (c: any) => {
              if (!editText.trim()) return;
              await tasksApi.updateComment(taskId, c.id, editText.trim());
              setComments(prev => prev.map(x => x.id === c.id ? { ...x, comment: editText.trim() } : x));
              setEditingComment(null);
            };

            const deleteC = async (c: any) => {
              if (!confirm('Delete this comment?')) return;
              await tasksApi.deleteComment(taskId, c.id);
              setComments(prev => prev.filter(x => x.id !== c.id && x.parent_id !== c.id));
            };

            const CommentCard = ({ c, isReply = false }: { c: any; isReply?: boolean }) => (
              <div style={{ display: 'flex', gap: 10, marginBottom: isReply ? 10 : 0 }}>
                <div style={{ flexShrink: 0, paddingTop: 2 }}>
                  <MiniAvatar name={c.user_name || '?'} color={c.avatar_color || '#94a3b8'} avatarUrl={c.avatar_url} size={isReply ? 24 : 30} fontSize={isReply ? 10 : 12} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)' }}>{c.user_name}</span>
                    <span style={{ fontSize: 10, color: 'var(--ink-muted)' }}>{fmtTime(c.created_at)}</span>
                    {c.updated_at && <span style={{ fontSize: 9, color: 'var(--ink-muted)', fontStyle: 'italic' }}>edited</span>}
                  </div>
                  {editingComment === c.id ? (
                    <div style={{ marginTop: 6 }}>
                      <textarea
                        value={editText}
                        onChange={e => setEditText(e.target.value)}
                        autoFocus
                        rows={2}
                        style={{ width: '100%', fontSize: 12, padding: '6px 8px', borderRadius: 7, border: '1.5px solid var(--blue, #2563eb)', background: 'var(--surface)', color: 'var(--ink)', outline: 'none', resize: 'vertical', boxSizing: 'border-box' }}
                      />
                      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                        <button onClick={() => saveEdit(c)} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: 'none', background: 'var(--blue, #2563eb)', color: '#fff', cursor: 'pointer', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 3 }}><Check size={11} /> Save</button>
                        <button onClick={() => setEditingComment(null)} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--ink-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}><X size={11} /> Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <p style={{ fontSize: 13, color: 'var(--ink)', margin: '4px 0 6px', lineHeight: 1.5, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{renderComment(c.comment)}</p>
                  )}
                  {editingComment !== c.id && (
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      {!isReply && (
                        <button onClick={() => { setReplyingTo(replyingTo === c.id ? null : c.id); setReplyText(''); }} style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-muted)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, padding: 0 }}>
                          <CornerDownRight size={12} /> Reply
                        </button>
                      )}
                      {canEditComment(c) && (
                        <button onClick={() => { setEditingComment(c.id); setEditText(c.comment); setReplyingTo(null); }} style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-muted)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, padding: 0 }}>
                          <Pencil size={11} /> Edit
                        </button>
                      )}
                      {canDeleteComment(c) && (
                        <button onClick={() => deleteC(c)} style={{ fontSize: 11, fontWeight: 600, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, padding: 0 }}>
                          <Trash2 size={11} /> Delete
                        </button>
                      )}
                    </div>
                  )}
                  {/* Replies */}
                  {repliesOf(c.id).length > 0 && (
                    <div style={{ marginTop: 12, paddingLeft: 12, borderLeft: '2px solid var(--border, #e5e7eb)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {repliesOf(c.id).map((r: any) => <CommentCard key={r.id} c={r} isReply />)}
                    </div>
                  )}
                  {/* Reply input */}
                  {replyingTo === c.id && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'flex-start' }}>
                      <MiniAvatar name={user?.name || '?'} color={user?.avatar_color || '#94a3b8'} size={24} fontSize={10} />
                      <div style={{ flex: 1, position: 'relative' }}>
                        <input
                          ref={replyInputRef}
                          autoFocus
                          value={replyText}
                          onChange={e => setReplyText(e.target.value)}
                          onKeyDown={async e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); await postComment(replyText, c.id); setReplyText(''); setReplyingTo(null); } }}
                          placeholder={`Reply to ${c.user_name?.split(' ')[0]}…`}
                          style={{ width: '100%', fontSize: 12, padding: '7px 10px', borderRadius: 7, border: '1.5px solid var(--blue, #2563eb)', background: 'var(--surface)', color: 'var(--ink)', outline: 'none', boxSizing: 'border-box' }}
                        />
                        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                          <button onClick={async () => { await postComment(replyText, c.id); setReplyText(''); setReplyingTo(null); }} disabled={!replyText.trim()} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: 'none', background: 'var(--blue, #2563eb)', color: '#fff', cursor: 'pointer', fontWeight: 700, opacity: replyText.trim() ? 1 : 0.4 }}>Reply</button>
                          <button onClick={() => setReplyingTo(null)} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--ink-muted)', cursor: 'pointer' }}>Cancel</button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {/* New comment input */}
                <div style={{ display: 'flex', gap: 10, marginBottom: 20, alignItems: 'flex-start' }}>
                  <div style={{ flexShrink: 0, paddingTop: 2 }}>
                    <MiniAvatar name={user?.name || '?'} color={(user as any)?.avatar_color || '#94a3b8'} size={30} fontSize={12} />
                  </div>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <textarea
                      ref={commentInputRef}
                      value={commentText}
                      onChange={e => setCommentText(e.target.value)}
                      onKeyDown={async e => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!commentText.trim() || submittingComment) return; setSubmittingComment(true); try { await postComment(commentText); setCommentText(''); } finally { setSubmittingComment(false); } }
                      }}
                      placeholder="Add a comment… (Enter to post)"
                      rows={2}
                      style={{ width: '100%', fontSize: 13, padding: '8px 10px', borderRadius: 8, border: '1.5px solid var(--border, #e5e7eb)', background: 'var(--surface)', color: 'var(--ink)', outline: 'none', resize: 'vertical', boxSizing: 'border-box', transition: 'border-color 0.15s' }}
                      onFocus={e => { e.target.style.borderColor = 'var(--blue, #2563eb)'; }}
                      onBlur={e => { e.target.style.borderColor = 'var(--border, #e5e7eb)'; }}
                    />
                    {commentText.trim() && (
                      <div style={{ display: 'flex', gap: 6, marginTop: 6, position: 'relative', zIndex: 0 }}>
                        <button
                          onClick={async () => { if (submittingComment) return; setSubmittingComment(true); try { await postComment(commentText); setCommentText(''); } finally { setSubmittingComment(false); } }}
                          disabled={submittingComment}
                          style={{ fontSize: 12, padding: '5px 14px', borderRadius: 7, border: 'none', background: 'var(--blue, #2563eb)', color: '#fff', cursor: 'pointer', fontWeight: 700 }}
                        >{submittingComment ? 'Posting…' : 'Post'}</button>
                        <button onClick={() => setCommentText('')} style={{ fontSize: 12, padding: '5px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--ink-muted)', cursor: 'pointer' }}>Cancel</button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Comment count */}
                {topLevel.length > 0 && (
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)', marginBottom: 16, paddingBottom: 10, borderBottom: '1px solid var(--border, #e5e7eb)' }}>
                    {comments.length} Comment{comments.length !== 1 ? 's' : ''}
                  </div>
                )}

                {/* Comments list */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  {topLevel.length === 0 ? (
                    <div style={{ fontSize: 13, color: 'var(--ink-muted)', fontStyle: 'italic', textAlign: 'center', padding: '20px 0' }}>No comments yet. Be the first to comment.</div>
                  ) : (
                    topLevel.map((c: any) => <CommentCard key={c.id} c={c} />)
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
