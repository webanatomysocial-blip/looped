import { useEffect, useState, useRef } from 'react';
import { format } from 'date-fns';
import { Send, Clock, CheckCircle, XCircle, Trash2, Plus, X, Search } from 'lucide-react';
import Layout from '../components/Layout/Layout';

import Avatar from '../components/UI/Avatar';
import { useAuth } from '../contexts/AuthContext';
import { mailApi, usersApi } from '../services/api';
import { User } from '../types';
import '../css/pages/Mail.css';

interface EmailRecord {
  id: number;
  subject: string;
  body: string;
  status: 'scheduled' | 'sent' | 'failed';
  scheduled_at: string | null;
  sent_at: string | null;
  created_at: string;
  created_by_name: string;
  error_message: string | null;
  recipients: { id: number; user_id: number; email: string; name: string }[];
}

const defaultForm = { subject: '', body: '', recipient_ids: [] as number[], use_schedule: false, scheduled_at: '' };

export default function Mail() {
  const { user } = useAuth();
  const [emails, setEmails]       = useState<EmailRecord[]>([]);
  const [allUsers, setAllUsers]   = useState<User[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showCompose, setShowCompose] = useState(false);
  const [form, setForm]           = useState(defaultForm);
  const [search, setSearch]       = useState('');
  const [filter, setFilter]       = useState<'all' | 'scheduled' | 'sent' | 'failed'>('all');
  const [sending, setSending]     = useState(false);
  const [error, setError]         = useState('');
  const [expanded, setExpanded]   = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await mailApi.list();
      setEmails(r.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // Load users for recipient picker — try full list, fall back to team
    usersApi.list()
      .then((r) => setAllUsers(r.data))
      .catch(() => usersApi.team().then((r) => setAllUsers(r.data)));
  }, []);

  const toggleRecipient = (id: number) =>
    setForm((f) => ({
      ...f,
      recipient_ids: f.recipient_ids.includes(id)
        ? f.recipient_ids.filter((x) => x !== id)
        : [...f.recipient_ids, id],
    }));

  const removeRecipient = (id: number) =>
    setForm((f) => ({ ...f, recipient_ids: f.recipient_ids.filter((x) => x !== id) }));

  const handleSend = async () => {
    if (!form.subject.trim()) { setError('Subject is required'); return; }
    if (!form.body.trim())    { setError('Body is required'); return; }
    if (!form.recipient_ids.length) { setError('Select at least one recipient'); return; }
    if (form.use_schedule && !form.scheduled_at) { setError('Pick a date and time to schedule'); return; }
    setError('');
    setSending(true);
    try {
      await mailApi.send({
        subject: form.subject,
        body: form.body,
        recipient_ids: form.recipient_ids,
        ...(form.use_schedule ? { scheduled_at: form.scheduled_at } : {}),
      });
      setForm(defaultForm);
      setSearch('');
      setShowCompose(false);
      load();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async (id: number, status: string) => {
    if (status === 'sent' && user?.role !== 'admin') { alert('Cannot delete sent emails'); return; }
    if (!confirm('Delete this email?')) return;
    try { await mailApi.delete(id); load(); }
    catch (err: any) { alert(err.response?.data?.error || 'Error'); }
  };

  const filtered = filter === 'all' ? emails : emails.filter((e) => e.status === filter);
  const visibleUsers = allUsers.filter((u) =>
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase())
  );
  const selectedUsers = allUsers.filter((u) => form.recipient_ids.includes(u.id));

  const minDateTime = new Date();
  minDateTime.setMinutes(minDateTime.getMinutes() + 1);
  const minStr = minDateTime.toISOString().slice(0, 16);

  return (
    <Layout>
      <div className="page-wrap">
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 className="page-title">Mail</h2>
            <p className="page-subtitle">{filtered.length} email{filtered.length !== 1 ? 's' : ''}</p>
          </div>
          <button className="btn-primary" onClick={() => { setShowCompose(true); setForm(defaultForm); setSearch(''); setError(''); }}>
            <Plus size={14} /> Compose
          </button>
          <div className="filter-bar">
            {(['all', 'scheduled', 'sent', 'failed'] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={`filter-tab${filter === f ? ' active' : ''}`}>
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Compose form */}
        {showCompose && (
          <div className="mail-compose-card">
            <div className="mail-compose-header">
              <span className="mail-compose-title">New Email</span>
              <button className="icon-action" onClick={() => setShowCompose(false)}><X size={14} /></button>
            </div>

            {error && <div className="modal-error" style={{ marginBottom: 12 }}>{error}</div>}

            {/* Selected recipients pills */}
            {selectedUsers.length > 0 && (
              <div className="mail-pills">
                {selectedUsers.map((u) => (
                  <span key={u.id} className="mail-pill">
                    <Avatar name={u.name} color={u.avatar_color} size="sm" />
                    {u.name}
                    <button onClick={() => removeRecipient(u.id)} className="mail-pill__x"><X size={10} /></button>
                  </span>
                ))}
              </div>
            )}

            {/* Recipient search */}
            <div className="mail-recipient-wrap">
              <div className="mail-recipient-search">
                <Search size={13} style={{ color: 'var(--ink-muted)', flexShrink: 0 }} />
                <input
                  className="mail-recipient-input"
                  placeholder="Search users to add…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              {search && (
                <div className="mail-recipient-list">
                  {visibleUsers.filter((u) => !form.recipient_ids.includes(u.id)).slice(0, 8).map((u) => (
                    <button key={u.id} className="mail-recipient-row" onClick={() => { toggleRecipient(u.id); setSearch(''); }}>
                      <Avatar name={u.name} color={u.avatar_color} size="sm" />
                      <div className="mail-recipient-info">
                        <span className="mail-recipient-name">{u.name}</span>
                        <span className="mail-recipient-email">{u.email}</span>
                      </div>
                      <span className={`user-role-pill user-role-pill--${u.role}`} style={{ fontSize: 10 }}>{u.role}</span>
                    </button>
                  ))}
                  {visibleUsers.filter((u) => !form.recipient_ids.includes(u.id)).length === 0 && (
                    <p style={{ fontSize: 12, color: 'var(--ink-muted)', padding: '10px 14px' }}>No users found</p>
                  )}
                </div>
              )}
            </div>

            <div className="modal-form-row">
              <label className="form-label">Subject *</label>
              <input className="form-input" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Email subject…" />
            </div>
            <div className="modal-form-row">
              <label className="form-label">Message *</label>
              <textarea className="form-input mail-body" rows={7} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Write your message…" />
            </div>

            {/* Schedule toggle */}
            <div className="mail-schedule-row">
              <label className="mail-schedule-toggle">
                <input type="checkbox" checked={form.use_schedule} onChange={(e) => setForm({ ...form, use_schedule: e.target.checked, scheduled_at: '' })} />
                <span>Schedule for later</span>
              </label>
              {form.use_schedule && (
                <input
                  type="datetime-local"
                  className="form-input"
                  style={{ maxWidth: 220 }}
                  min={minStr}
                  value={form.scheduled_at}
                  onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })}
                />
              )}
            </div>

            <div className="mail-compose-actions">
              <button className="btn-secondary" onClick={() => setShowCompose(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleSend} disabled={sending} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {form.use_schedule ? <Clock size={14} /> : <Send size={14} />}
                {sending ? 'Sending…' : form.use_schedule ? 'Schedule' : 'Send now'}
              </button>
            </div>
          </div>
        )}

        {/* Email list */}
        {loading && <p className="page-subtitle">Loading…</p>}
        {!loading && filtered.length === 0 && <div className="empty-state">No emails {filter !== 'all' ? `with status "${filter}"` : 'yet'}</div>}

        <div className="mail-list">
          {filtered.map((email) => (
            <div key={email.id} className={`mail-row${expanded === email.id ? ' mail-row--open' : ''}`}>
              <div className="mail-row__main" onClick={() => setExpanded(expanded === email.id ? null : email.id)}>
                <div className="mail-row__status-icon">
                  {email.status === 'sent'      && <CheckCircle size={15} style={{ color: 'var(--green)' }} />}
                  {email.status === 'scheduled' && <Clock size={15} style={{ color: 'var(--yellow)' }} />}
                  {email.status === 'failed'    && <XCircle size={15} style={{ color: 'var(--red)' }} />}
                </div>

                <div className="mail-row__info">
                  <p className="mail-row__subject">{email.subject}</p>
                  <p className="mail-row__meta">
                    To: {email.recipients.slice(0, 3).map((r) => r.name).join(', ')}
                    {email.recipients.length > 3 ? ` +${email.recipients.length - 3} more` : ''}
                    {email.created_by_name && ` · From: ${email.created_by_name}`}
                  </p>
                </div>

                <div className="mail-row__right">
                  <span className={`mail-status-pill mail-status-pill--${email.status}`}>
                    {email.status === 'sent' ? 'Sent' : email.status === 'scheduled' ? 'Scheduled' : 'Failed'}
                  </span>
                  <span className="mail-row__date">
                    {email.status === 'sent' && email.sent_at
                      ? format(new Date(email.sent_at), 'MMM d, h:mm a')
                      : email.scheduled_at
                      ? format(new Date(email.scheduled_at), 'MMM d, h:mm a')
                      : format(new Date(email.created_at), 'MMM d')}
                  </span>
                  <button
                    className="icon-action danger"
                    style={{ opacity: 1 }}
                    onClick={(e) => { e.stopPropagation(); handleDelete(email.id, email.status); }}
                    title="Delete"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>

              {expanded === email.id && (
                <div className="mail-row__detail">
                  <div className="mail-row__detail-recipients">
                    <span className="form-label" style={{ marginBottom: 6, display: 'block' }}>Recipients</span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {email.recipients.map((r) => (
                        <span key={r.id} className="mail-pill" style={{ cursor: 'default' }}>
                          <Avatar name={r.name} color="#6366f1" size="sm" />
                          {r.name} <span style={{ opacity: 0.6, fontSize: 11 }}>({r.email})</span>
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="mail-row__detail-body">
                    <span className="form-label" style={{ marginBottom: 6, display: 'block' }}>Message</span>
                    <p className="mail-row__body-text">{email.body}</p>
                  </div>
                  {email.error_message && (
                    <div className="modal-error" style={{ marginTop: 10 }}>Error: {email.error_message}</div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </Layout>
  );
}
