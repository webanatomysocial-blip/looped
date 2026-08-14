import { useEffect, useState, useCallback } from 'react';
import Layout from '../components/Layout/Layout';
import { xlr8Api, projectsApi, categoriesApi } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import {
  RiAddLine, RiTimeLine, RiCheckLine, RiUserLine, RiLoader4Line, RiArrowRightLine,
  RiCloseLine, RiCheckboxCircleLine,
} from 'react-icons/ri';

interface Stage { category_id: number; category_name: string }
interface FinalApproval { adminRequired: boolean; adminSkippable: boolean; clientOptional: boolean }
interface TicketType { id: number; name: string; stages: Stage[]; final_approval: FinalApproval }
interface LogEntry { id: number; actor_name: string; action: string; from_state: string | null; to_state: string | null; comment: string | null; created_at: string }
interface Ticket {
  id: number; title: string; description?: string; status: string; xlr8_status: string;
  xlr8_stage_idx: number; ticket_type_id: number; ticket_type_name: string;
  project_id: number; project_name: string; creator_id: number; creator_name: string; creator_color: string;
  assignee_name?: string; assignee_color?: string; xlr8_assignee_id?: number;
  stages: Stage[]; final_approval: FinalApproval; created_at: string;
}

const STATUS_LABELS: Record<string, string> = {
  pending_manager: 'Needs Manager',
  pending_assignee: 'Awaiting Acceptance',
  in_progress: 'In Progress',
  pending_admin: 'Admin Review',
  pending_client: 'Client Review',
  completed: 'Completed',
};

const STATUS_COLOR: Record<string, string> = {
  pending_manager: 'var(--orange)',
  pending_assignee: 'var(--blue)',
  in_progress: 'var(--green)',
  pending_admin: '#7c3aed',
  pending_client: 'var(--ink-muted)',
  completed: 'var(--green)',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
      background: STATUS_COLOR[status] + '22', color: STATUS_COLOR[status],
      display: 'inline-block',
    }}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}

function Avatar({ name, color, size = 28 }: { name: string; color: string; size?: number }) {
  const initials = name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.35, color: '#fff', fontWeight: 700, flexShrink: 0 }}>
      {initials}
    </div>
  );
}

function StagePips({ stages, currentIdx, xlrStatus }: { stages: Stage[]; currentIdx: number; xlrStatus: string }) {
  if (!stages.length) return null;
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 6 }}>
      {stages.map((s, i) => (
        <div key={i} title={s.category_name} style={{
          width: 8, height: 8, borderRadius: '50%',
          background: i < currentIdx ? 'var(--green)' : i === currentIdx && xlrStatus !== 'completed' ? 'var(--orange)' : 'var(--surface-2)',
          border: '1.5px solid ' + (i < currentIdx ? 'var(--green)' : i === currentIdx && xlrStatus !== 'completed' ? 'var(--orange)' : 'var(--ink-muted)'),
          flexShrink: 0,
        }} />
      ))}
    </div>
  );
}

export default function XLR8Tickets() {
  const { user } = useAuth();
  const role = user?.role;
  const userId = user?.id;

  const [projects, setProjects] = useState<any[]>([]);
  const [projectId, setProjectId] = useState<number | ''>('');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [ticketTypes, setTicketTypes] = useState<TicketType[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [logLoading, setLogLoading] = useState(false);

  // Create ticket form
  const [creating, setCreating] = useState(false);
  const [newForm, setNewForm] = useState({ title: '', description: '', project_id: '', ticket_type_id: '', due_date: '' });
  const [createSaving, setCreateSaving] = useState(false);

  // Workflow action state
  const [actionLoading, setActionLoading] = useState(false);
  const [eligible, setEligible] = useState<any[] | null>(null); // employees to pick from
  const [declineComment, setDeclineComment] = useState('');
  const [showDecline, setShowDecline] = useState(false);
  const [showEmployeeDecline, setShowEmployeeDecline] = useState(false);
  const [employeeDeclineComment, setEmployeeDeclineComment] = useState('');

  useEffect(() => {
    projectsApi.list().then((r) => {
      const xlr8 = r.data.filter((p: any) => p.service_type === 'xlr8');
      setProjects(xlr8);
      if (xlr8.length === 1) setProjectId(xlr8[0].id);
    });
    if (['admin', 'manager'].includes(role!)) {
      xlr8Api.getTicketTypes().then((r) => setTicketTypes(r.data));
    }
  }, [role]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await xlr8Api.getTickets(projectId ? Number(projectId) : undefined);
      setTickets(r.data);
    } finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const openTicket = async (t: Ticket) => {
    setSelected(t); setEligible(null); setShowDecline(false); setDeclineComment(''); setShowEmployeeDecline(false); setEmployeeDeclineComment('');
    setLogLoading(true);
    xlr8Api.getTicketLog(t.id).then((r) => { setLog(r.data); setLogLoading(false); });
  };

  const refresh = async () => {
    await load();
    if (selected) {
      const r = await xlr8Api.getTicket(selected.id);
      setSelected(r.data);
      const lr = await xlr8Api.getTicketLog(selected.id);
      setLog(lr.data);
    }
  };

  // ── Workflow actions ──────────────────────────────────────────────────────

  const acceptTicket = async () => {
    if (!selected) return;
    setActionLoading(true);
    try {
      const r = await xlr8Api.acceptTicket(selected.id);
      if (r.data.auto_assigned) { await refresh(); setEligible(null); }
      else setEligible(r.data.eligible);
    } finally { setActionLoading(false); }
  };

  const assignTo = async (assigneeId: number) => {
    if (!selected) return;
    setActionLoading(true);
    try { await xlr8Api.assignTicket(selected.id, assigneeId); await refresh(); setEligible(null); }
    finally { setActionLoading(false); }
  };

  const employeeAccept = async () => {
    if (!selected) return;
    setActionLoading(true);
    try { await xlr8Api.employeeAccept(selected.id); await refresh(); }
    finally { setActionLoading(false); }
  };

  const employeeDecline = async () => {
    if (!selected) return;
    setActionLoading(true);
    try { await xlr8Api.employeeDecline(selected.id, employeeDeclineComment); await refresh(); setShowEmployeeDecline(false); setEmployeeDeclineComment(''); }
    finally { setActionLoading(false); }
  };

  const markDone = async () => {
    if (!selected) return;
    setActionLoading(true);
    try { await xlr8Api.markDone(selected.id); await refresh(); }
    finally { setActionLoading(false); }
  };

  const approve = async (skipAdmin?: boolean) => {
    if (!selected) return;
    setActionLoading(true);
    try { await xlr8Api.reviewTicket(selected.id, 'approve', undefined, skipAdmin); await refresh(); }
    finally { setActionLoading(false); }
  };

  const decline = async () => {
    if (!selected) return;
    setActionLoading(true);
    try { await xlr8Api.reviewTicket(selected.id, 'decline', declineComment); await refresh(); setShowDecline(false); }
    finally { setActionLoading(false); }
  };

  const adminApprove = async () => {
    if (!selected) return;
    setActionLoading(true);
    try { await xlr8Api.adminApprove(selected.id); await refresh(); }
    finally { setActionLoading(false); }
  };

  const clientApprove = async () => {
    if (!selected) return;
    setActionLoading(true);
    try { await xlr8Api.clientApprove(selected.id); await refresh(); }
    finally { setActionLoading(false); }
  };

  const createTicket = async () => {
    if (!newForm.title.trim() || !newForm.project_id || !newForm.ticket_type_id) return;
    setCreateSaving(true);
    try {
      await xlr8Api.createTicket({ ...newForm, project_id: Number(newForm.project_id), ticket_type_id: Number(newForm.ticket_type_id) });
      setCreating(false); setNewForm({ title: '', description: '', project_id: '', ticket_type_id: '', due_date: '' });
      await load();
    } finally { setCreateSaving(false); }
  };

  // Visible tickets by role
  const visibleTickets = tickets.filter((t) => {
    if (role === 'employee') return t.xlr8_assignee_id === userId || t.creator_id === userId;
    if (role === 'client') return ['pending_client', 'completed'].includes(t.xlr8_status);
    return true;
  });

  const grouped: Record<string, Ticket[]> = {};
  const COLS = role === 'employee'
    ? ['pending_assignee', 'in_progress', 'completed']
    : role === 'client'
    ? ['pending_client', 'completed']
    : ['pending_manager', 'pending_assignee', 'in_progress', 'pending_admin', 'pending_client', 'completed'];

  for (const col of COLS) grouped[col] = [];
  for (const t of visibleTickets) {
    if (grouped[t.xlr8_status]) grouped[t.xlr8_status].push(t);
  }

  const DEFAULT_FA: FinalApproval = { adminRequired: true, adminSkippable: true, clientOptional: true };

  const actionBtn = (label: string, onClick: () => void, variant: 'primary' | 'ghost' | 'danger' = 'primary', disabled = false) => (
    <button
      className={variant === 'primary' ? 'btn-primary' : 'btn-ghost'}
      style={variant === 'danger' ? { color: 'var(--red)' } : {}}
      onClick={onClick}
      disabled={disabled || actionLoading}
    >
      {actionLoading ? <RiLoader4Line style={{ animation: 'spin 1s linear infinite' }} /> : label}
    </button>
  );

  const renderActions = () => {
    if (!selected) return null;
    const s = selected.xlr8_status;
    const fa = selected.final_approval || DEFAULT_FA;
    const isManager = ['admin', 'manager'].includes(role!);
    const isAssignee = selected.xlr8_assignee_id === userId;

    if (s === 'pending_manager' && isManager) {
      // Has assignee = work was done, needs review; no assignee = needs initial acceptance
      const needsReview = !!selected.xlr8_assignee_id;

      if (!needsReview) {
        if (eligible) {
          return (
            <div style={{ marginTop: 12 }}>
              <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Pick an assignee:</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {eligible.map((e: any) => (
                  <button key={e.id} className="btn-ghost" onClick={() => assignTo(e.id)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Avatar name={e.name} color={e.avatar_color || '#888'} size={22} /> {e.name}
                  </button>
                ))}
              </div>
            </div>
          );
        }
        return (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            {actionBtn('Accept & Assign', acceptTicket)}
          </div>
        );
      }

      // Work done — review mode
      return (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          {actionBtn('Approve', () => approve())}
          {actionBtn('Decline', () => setShowDecline(true), 'ghost')}
          {fa.adminRequired && fa.adminSkippable && actionBtn('Approve & Skip Admin', () => approve(true), 'ghost')}
        </div>
      );
    }

    if (s === 'pending_assignee' && isAssignee) {
      if (showEmployeeDecline) {
        return (
          <div style={{ marginTop: 12, padding: 12, background: 'var(--surface-2)', borderRadius: 8 }}>
            <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Reason for declining:</p>
            <textarea className="form-input" rows={3} value={employeeDeclineComment} onChange={(e) => setEmployeeDeclineComment(e.target.value)} placeholder="Why can't you take this?" />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => setShowEmployeeDecline(false)}>Cancel</button>
              <button className="btn-primary" style={{ fontSize: 12, background: 'var(--red)', borderColor: 'var(--red)' }} onClick={employeeDecline} disabled={actionLoading}>Decline</button>
            </div>
          </div>
        );
      }
      return (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          {actionBtn('Accept', employeeAccept)}
          {actionBtn('Decline', () => setShowEmployeeDecline(true), 'ghost')}
        </div>
      );
    }

    if (s === 'in_progress' && isAssignee) {
      return <div style={{ marginTop: 12 }}>{actionBtn('Mark as Done', markDone)}</div>;
    }

    if (s === 'pending_admin' && role === 'admin') {
      return <div style={{ marginTop: 12 }}>{actionBtn('Final Approve', adminApprove)}</div>;
    }

    if (s === 'pending_client' && role === 'client') {
      return <div style={{ marginTop: 12 }}>{actionBtn('Approve', clientApprove)}</div>;
    }

    return null;
  };

  return (
    <Layout>
      <div className="page-wrap">
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 className="page-title">XLR8 Tickets</h2>
            <p className="page-subtitle">Ticket workflow for retainer projects</p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {projects.length > 1 && (
              <select className="form-input" style={{ maxWidth: 220, fontSize: 13 }} value={projectId} onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : '')}>
                <option value="">All projects</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
            {['admin', 'manager', 'employee'].includes(role!) && (
              <button className="btn-primary" onClick={() => setCreating(true)}>
                <RiAddLine style={{ marginRight: 6 }} />New Ticket
              </button>
            )}
          </div>
        </div>

        {loading && <p className="page-subtitle" style={{ textAlign: 'center', padding: 40 }}>Loading…</p>}

        {!loading && (
          <div style={{ display: 'flex', gap: 16, overflowX: 'auto', alignItems: 'flex-start', paddingBottom: 12 }}>
            {COLS.map((col) => (
              <div key={col} style={{ minWidth: 240, flex: '0 0 240px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLOR[col], display: 'inline-block', flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {STATUS_LABELS[col]}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--ink-muted)', marginLeft: 'auto' }}>{grouped[col]?.length ?? 0}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {(grouped[col] || []).map((t) => (
                    <div
                      key={t.id}
                      className="card"
                      style={{ padding: '12px 14px', cursor: 'pointer', transition: 'box-shadow 0.15s' }}
                      onClick={() => openTicket(t)}
                    >
                      <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, lineHeight: 1.4 }}>{t.title}</p>
                      <p style={{ fontSize: 11, color: 'var(--ink-muted)', marginBottom: 6 }}>{t.ticket_type_name}</p>
                      <StagePips stages={t.stages} currentIdx={t.xlr8_stage_idx} xlrStatus={t.xlr8_status} />
                      {t.assignee_name && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 8 }}>
                          <Avatar name={t.assignee_name} color={t.assignee_color || '#888'} size={18} />
                          <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{t.assignee_name}</span>
                        </div>
                      )}
                      <p style={{ fontSize: 10, color: 'var(--ink-muted)', marginTop: 6 }}>{t.project_name}</p>
                    </div>
                  ))}
                  {!grouped[col]?.length && (
                    <div style={{ fontSize: 12, color: 'var(--ink-muted)', textAlign: 'center', padding: '16px 0' }}>—</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Ticket Detail Modal */}
        {selected && (
          <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) { setSelected(null); setEligible(null); } }}>
            <div className="modal" style={{ width: '100%', maxWidth: 580, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
              <div className="modal-header" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <h3 className="modal-title" style={{ marginBottom: 0 }}>{selected.title}</h3>
                    <StatusBadge status={selected.xlr8_status} />
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                    {selected.ticket_type_name} · {selected.project_name}
                  </p>
                </div>
                <button className="btn-ghost" onClick={() => { setSelected(null); setEligible(null); }} style={{ padding: '4px 8px' }}>
                  <RiCloseLine />
                </button>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
                {/* Stage progress */}
                {selected.stages.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <p style={{ fontSize: 11, color: 'var(--ink-muted)', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Workflow</p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 0, flexWrap: 'wrap' }}>
                      {selected.stages.map((s, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center' }}>
                          <div style={{
                            padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                            background: i < selected.xlr8_stage_idx ? 'var(--green)' + '22' : i === selected.xlr8_stage_idx ? 'var(--orange)' + '22' : 'var(--surface-2)',
                            color: i < selected.xlr8_stage_idx ? 'var(--green)' : i === selected.xlr8_stage_idx ? 'var(--orange)' : 'var(--ink-muted)',
                          }}>
                            {i < selected.xlr8_stage_idx && <RiCheckLine style={{ marginRight: 3, fontSize: 10 }} />}
                            {s.category_name}
                          </div>
                          {i < selected.stages.length - 1 && <RiArrowRightLine style={{ fontSize: 12, color: 'var(--ink-muted)', margin: '0 2px' }} />}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selected.description && (
                  <div style={{ marginBottom: 14 }}>
                    <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginBottom: 4 }}>Description</p>
                    <p style={{ fontSize: 13 }}>{selected.description}</p>
                  </div>
                )}

                {selected.assignee_name && (
                  <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <RiUserLine style={{ color: 'var(--ink-muted)', fontSize: 14 }} />
                    <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Current assignee:</span>
                    <Avatar name={selected.assignee_name} color={selected.assignee_color || '#888'} size={20} />
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{selected.assignee_name}</span>
                  </div>
                )}

                {/* Actions */}
                {renderActions()}

                {showDecline && (
                  <div style={{ marginTop: 12, padding: 12, background: 'var(--surface-2)', borderRadius: 8 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Reason for decline:</p>
                    <textarea
                      className="form-input"
                      rows={3}
                      value={declineComment}
                      onChange={(e) => setDeclineComment(e.target.value)}
                      placeholder="Explain what needs to be changed…"
                    />
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button className="btn-ghost" onClick={() => setShowDecline(false)} style={{ fontSize: 12 }}>Cancel</button>
                      <button className="btn-primary" onClick={decline} disabled={actionLoading} style={{ fontSize: 12, background: 'var(--red)', borderColor: 'var(--red)' }}>
                        Decline
                      </button>
                    </div>
                  </div>
                )}

                {/* Audit log */}
                <div style={{ marginTop: 20 }}>
                  <p style={{ fontSize: 11, color: 'var(--ink-muted)', fontWeight: 600, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Activity</p>
                  {logLoading && <p style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Loading…</p>}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {log.map((entry) => (
                      <div key={entry.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
                          <RiTimeLine style={{ fontSize: 11, color: 'var(--ink-muted)' }} />
                        </div>
                        <div style={{ flex: 1 }}>
                          <p style={{ fontSize: 12, lineHeight: 1.5 }}>
                            <strong>{entry.actor_name}</strong>{' '}
                            <span style={{ color: 'var(--ink-muted)' }}>{formatAction(entry.action)}</span>
                            {entry.comment && <span> — <em>{entry.comment}</em></span>}
                          </p>
                          <p style={{ fontSize: 10, color: 'var(--ink-muted)' }}>{new Date(entry.created_at).toLocaleString()}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="modal-actions">
                <button className="btn-ghost" onClick={() => { setSelected(null); setEligible(null); }}>Close</button>
                {selected.xlr8_status === 'completed' && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--green)', fontWeight: 600 }}>
                    <RiCheckboxCircleLine /> Completed
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Create Ticket Modal */}
        {creating && (
          <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setCreating(false); }}>
            <div className="modal" style={{ width: '100%', maxWidth: 480 }}>
              <div className="modal-header">
                <h3 className="modal-title">New Ticket</h3>
              </div>
              <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label className="form-label">Title</label>
                  <input className="form-input" value={newForm.title} onChange={(e) => setNewForm((f) => ({ ...f, title: e.target.value }))} placeholder="What needs to be done?" />
                </div>
                <div>
                  <label className="form-label">Description (optional)</label>
                  <textarea className="form-input" rows={3} value={newForm.description} onChange={(e) => setNewForm((f) => ({ ...f, description: e.target.value }))} placeholder="Details, links, requirements…" />
                </div>
                <div>
                  <label className="form-label">Project</label>
                  <select className="form-input" value={newForm.project_id} onChange={(e) => setNewForm((f) => ({ ...f, project_id: e.target.value }))}>
                    <option value="">Select project…</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Ticket Type</label>
                  <select className="form-input" value={newForm.ticket_type_id} onChange={(e) => setNewForm((f) => ({ ...f, ticket_type_id: e.target.value }))}>
                    <option value="">Select type…</option>
                    {ticketTypes.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.stages.length} stage{t.stages.length !== 1 ? 's' : ''})</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Due Date (optional)</label>
                  <input className="form-input" type="date" value={newForm.due_date} onChange={(e) => setNewForm((f) => ({ ...f, due_date: e.target.value }))} />
                </div>
              </div>
              <div className="modal-actions">
                <button className="btn-ghost" onClick={() => setCreating(false)}>Cancel</button>
                <button className="btn-primary" onClick={createTicket} disabled={createSaving || !newForm.title.trim() || !newForm.project_id || !newForm.ticket_type_id}>
                  {createSaving ? 'Creating…' : 'Create Ticket'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

function formatAction(action: string): string {
  const map: Record<string, string> = {
    created: 'created the ticket',
    assigned: 'assigned the ticket',
    employee_accepted: 'accepted the assignment',
    employee_declined: 'declined the assignment',
    work_done: 'marked work as done',
    manager_approved: 'approved the work',
    manager_declined: 'declined the work',
    next_stage: 'advanced to next stage',
    sent_to_admin: 'sent for admin approval',
    admin_skipped: 'skipped admin review',
    admin_approved: 'gave final approval',
    client_approved: 'approved as client',
    completed: 'marked ticket completed',
  };
  return map[action] || action;
}
