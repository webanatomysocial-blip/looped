<title>TaskViewDrawer</title>
import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { format, formatDistanceToNow } from 'date-fns';
import { Paperclip, Link2, ExternalLink, Trash2, CornerDownRight, Pencil, X, Check } from 'lucide-react';
import XLR8StageFlow, { fmtSec } from './XLR8StageFlow';
import { tasksApi, xlr8Api, projectsApi } from '../../services/api';
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
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionTarget, setMentionTarget] = useState<'main' | 'reply' | null>(null);
  const [mentionRect, setMentionRect] = useState<DOMRect | null>(null);
  const [projectMembers, setProjectMembers] = useState<any[]>([]);
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
        if (task.project_id) projectsApi.members(task.project_id).then(r => setProjectMembers(r.data || [])).catch(() => {});
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

            // @mention pool: project members (excluding self), falling back to assignees + comment authors
            const seen = new Set<string>();
            const members: any[] = [];
            const addM = (m: any) => {
              if (!m?.id || !m?.name) return;
              if (String(m.id) === String(user?.id)) return; // no self-tagging
              const k = String(m.id);
              if (!seen.has(k)) { seen.add(k); members.push(m); }
            };
            (projectMembers.length > 0 ? projectMembers : (task.assignees || [])).forEach(addM);
            comments.forEach((c: any) => addM({ id: c.user_id, name: c.user_name, avatar_color: c.avatar_color, avatar_url: c.avatar_url }));
            const mentionSuggestions = mentionQuery !== null
              ? members.filter((m: any) => m.name?.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 6)
              : [];

            // Detect @ trigger — also capture the input's rect for fixed-position dropdown
            const handleMentionInput = (val: string, target: 'main' | 'reply', cursorPos: number, el: HTMLElement | null) => {
              const textUpToCursor = val.slice(0, cursorPos);
              const match = textUpToCursor.match(/@(\w*)$/);
              if (match) { setMentionQuery(match[1]); setMentionTarget(target); setMentionRect(el ? el.getBoundingClientRect() : null); }
              else { setMentionQuery(null); setMentionTarget(null); setMentionRect(null); }
            };

            const insertMention = (name: string) => {
              const mention = `@${name} `;
              if (mentionTarget === 'main') {
                const el = commentInputRef.current;
                if (!el) return;
                const pos = el.selectionStart ?? commentText.length;
                const before = commentText.slice(0, pos).replace(/@\w*$/, '');
                const after = commentText.slice(pos);
                setCommentText(before + mention + after);
                setTimeout(() => { el.focus(); el.setSelectionRange((before + mention).length, (before + mention).length); }, 0);
              } else {
                const cur = replyText;
                const el = replyInputRef.current;
                const pos = el?.selectionStart ?? cur.length;
                const before = cur.slice(0, pos).replace(/@\w*$/, '');
                const after = cur.slice(pos);
                setReplyText(before + mention + after);
                setTimeout(() => { el?.focus(); el?.setSelectionRange((before + mention).length, (before + mention).length); }, 0);
              }
              setMentionQuery(null); setMentionTarget(null);
            };

            // Render @mentions as highlighted spans in comment text
            const renderComment = (text: string) => {
              const parts = text.split(/(@\w+)/g);
              return parts.map((p, i) => p.startsWith('@')
                ? <span key={i} style={{ color: 'var(--blue, #2563eb)', fontWeight: 600 }}>{p}</span>
                : p
              );
            };

            // Portal-based dropdown — uses fixed position to escape overflow:hidden/auto scroll containers
            const MentionDropdown = ({ target }: { target: 'main' | 'reply' }) => {
              if (mentionTarget !== target || mentionSuggestions.length === 0 || !mentionRect) return null;
              const style: React.CSSProperties = {
                position: 'fixed',
                left: mentionRect.left,
                top: mentionRect.bottom + 4,
                width: Math.max(mentionRect.width, 200),
                zIndex: 99999,
                background: '#ffffff',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
                maxHeight: 220,
                overflowY: 'auto',
                isolation: 'isolate',
              };
              return createPortal(
                <div style={style}>
                  <style>{`.mention-item:hover{background:rgba(0,0,0,0.06)}`}</style>
                  {mentionSuggestions.map((m: any) => (
                    <div key={m.id} className="mention-item" onMouseDown={e => { e.preventDefault(); insertMention(m.name); }}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', cursor: 'pointer', fontSize: 13, transition: 'background 0.1s' }}
                    >
                      <MiniAvatar name={m.name} color={m.avatar_color || '#94a3b8'} size={22} fontSize={9} />
                      <span style={{ fontWeight: 600 }}>{m.name}</span>
                      {m.role && <span style={{ fontSize: 10, color: 'var(--ink-muted)', textTransform: 'capitalize' }}>{m.role}</span>}
                    </div>
                  ))}
                </div>,
                document.body
              );
            };

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
                          onChange={e => { setReplyText(e.target.value); handleMentionInput(e.target.value, 'reply', e.target.selectionStart ?? e.target.value.length, e.target); }}
                          onKeyDown={async e => {
                            if (mentionQuery !== null && mentionTarget === 'reply' && e.key === 'Escape') { setMentionQuery(null); return; }
                            if (e.key === 'Enter' && !e.shiftKey && mentionQuery === null) { e.preventDefault(); await postComment(replyText, c.id); setReplyText(''); setReplyingTo(null); }
                          }}
                          onBlur={() => setTimeout(() => { setMentionQuery(null); setMentionTarget(null); }, 150)}
                          placeholder={`Reply to ${c.user_name?.split(' ')[0]}… (@ to mention)`}
                          style={{ width: '100%', fontSize: 12, padding: '7px 10px', borderRadius: 7, border: '1.5px solid var(--blue, #2563eb)', background: 'var(--surface)', color: 'var(--ink)', outline: 'none', boxSizing: 'border-box' }}
                        />
                        {MentionDropdown({ target: 'reply' })}
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
                      onChange={e => { setCommentText(e.target.value); handleMentionInput(e.target.value, 'main', e.target.selectionStart ?? e.target.value.length, e.target); }}
                      onKeyDown={async e => {
                        if (mentionQuery !== null && mentionTarget === 'main' && mentionSuggestions.length > 0 && (e.key === 'Escape')) { setMentionQuery(null); return; }
                        if (e.key === 'Enter' && !e.shiftKey && mentionQuery === null) { e.preventDefault(); if (!commentText.trim() || submittingComment) return; setSubmittingComment(true); try { await postComment(commentText); setCommentText(''); } finally { setSubmittingComment(false); } }
                      }}
                      placeholder="Add a comment… (@ to mention, Enter to post)"
                      rows={2}
                      style={{ width: '100%', fontSize: 13, padding: '8px 10px', borderRadius: 8, border: '1.5px solid var(--border, #e5e7eb)', background: 'var(--surface)', color: 'var(--ink)', outline: 'none', resize: 'vertical', boxSizing: 'border-box', transition: 'border-color 0.15s' }}
                      onFocus={e => { e.target.style.borderColor = 'var(--blue, #2563eb)'; }}
                      onBlur={e => { e.target.style.borderColor = 'var(--border, #e5e7eb)'; setTimeout(() => { setMentionQuery(null); setMentionTarget(null); }, 150); }}
                    />
                    {MentionDropdown({ target: 'main' })}
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
