import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import Layout from '../../components/Layout/Layout';
import Breadcrumb from '../../components/ContactForms/Breadcrumb';
import { contactFormsApi } from '../../services/api';
import '../../css/pages/ContactForms.css';

interface FileRecord { stored: string; original: string; fieldname: string; }

interface Submission {
  id: number;
  contact_form_id: number;
  form_name: string;
  data: Record<string, string>;
  files: FileRecord[];
  read: boolean;
  created_at: string;
}

interface FormMeta { id: number; name: string; }

function csvEscape(value: unknown) {
  const str = String(value ?? '');
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

const PER_PAGE = 25;

export default function ContactFormSubmissions() {
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const [searchParams] = useSearchParams();

  const [project, setProject] = useState<{ id: number; name: string } | null>(null);
  const [forms, setForms] = useState<FormMeta[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);

  const [formFilter, setFormFilter] = useState<string>(searchParams.get('form_id') || '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);

  const [detail, setDetail] = useState<Submission | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await contactFormsApi.listSubmissions(projectId, {
        page,
        per_page: PER_PAGE,
        form_id: formFilter ? Number(formFilter) : undefined,
        unread_only: unreadOnly || undefined,
      });
      setSubmissions(res.data.submissions);
      setTotal(res.data.total);
      setPages(res.data.pages);
    } finally { setLoading(false); }
  }, [projectId, page, formFilter, unreadOnly]);

  useEffect(() => {
    contactFormsApi.getProject(projectId).then((r) => setProject(r.data));
    contactFormsApi.listForms(projectId).then((r) => setForms(r.data));
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  // Client-side date filter (already paginated server-side by form/unread)
  const filtered = useMemo(() => submissions.filter((s) => {
    const date = s.created_at.slice(0, 10);
    if (from && date < from) return false;
    if (to && date > to) return false;
    return true;
  }), [submissions, from, to]);

  const columns = useMemo(() => {
    const keys = new Set<string>();
    filtered.forEach((s) => Object.keys(s.data).forEach((k) => keys.add(k)));
    return Array.from(keys);
  }, [filtered]);

  const markRead = async (s: Submission, read: boolean) => {
    await contactFormsApi.markRead(s.id, read);
    setSubmissions((prev) => prev.map((x) => x.id === s.id ? { ...x, read } : x));
    if (detail?.id === s.id) setDetail((d) => d ? { ...d, read } : d);
  };

  const openDetail = async (s: Submission) => {
    setDetail(s);
    if (!s.read) markRead(s, true);
  };

  function downloadCsv(rows: Submission[], cols: string[], filename: string) {
    const header = ['Form', ...cols, 'Received'];
    const data = rows.map((s) => [
      s.form_name,
      ...cols.map((col) => s.data[col] ?? ''),
      new Date(s.created_at).toLocaleString(),
    ]);
    const csv = [header, ...data].map((r) => r.map(csvEscape).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  const unreadCount = submissions.filter((s) => !s.read).length;

  return (
    <Layout>
      <div className="cf-page">
        <Breadcrumb items={[
          { label: 'Contact Forms', href: '/contact-forms' },
          { label: project?.name || '...', href: `/contact-forms/${projectId}` },
          { label: 'Submissions' },
        ]} />

        <div className="cf-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1>Submissions</h1>
            {unreadCount > 0 && (
              <span style={{ background: 'var(--red)', color: '#fff', borderRadius: 99, fontSize: 11, fontWeight: 700, padding: '2px 8px' }}>
                {unreadCount} new
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn-secondary" onClick={() => downloadCsv(filtered, columns, `${project?.name || 'submissions'}.csv`)} disabled={!filtered.length}>
              ↓ Export CSV
            </button>
            {formFilter && (
              <button type="button" className="btn-secondary" onClick={() => {
                const formSubs = filtered.filter((s) => String(s.contact_form_id) === formFilter);
                const formName = forms.find((f) => String(f.id) === formFilter)?.name || 'form';
                downloadCsv(formSubs, columns, `${formName}.csv`);
              }} disabled={!filtered.length}>
                ↓ Export This Form
              </button>
            )}
          </div>
        </div>

        <div className="cf-filters">
          <select value={formFilter} onChange={(e) => { setFormFilter(e.target.value); setPage(1); }}>
            <option value="">All forms</option>
            {forms.map((f) => <option key={f.id} value={String(f.id)}>{f.name}</option>)}
          </select>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="cf-filter-sep">to</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={unreadOnly} onChange={(e) => { setUnreadOnly(e.target.checked); setPage(1); }} />
            Unread only
          </label>
        </div>

        {loading ? (
          <p className="cf-empty">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="cf-empty">No submissions match these filters.</p>
        ) : (
          <>
            <div className="cf-table-wrap">
              <table className="cf-table">
                <thead>
                  <tr>
                    <th style={{ width: 8 }}></th>
                    <th>Form</th>
                    {columns.map((col) => <th key={col}>{col}</th>)}
                    <th>Received</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => (
                    <tr
                      key={s.id}
                      style={{ cursor: 'pointer', fontWeight: s.read ? undefined : 700, background: s.read ? undefined : 'var(--surface-raised)' }}
                      onClick={() => openDetail(s)}
                    >
                      <td>
                        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: s.read ? 'transparent' : 'var(--blue)', border: s.read ? '1px solid var(--border)' : 'none' }} />
                      </td>
                      <td>{s.form_name}</td>
                      {columns.map((col) => (
                        <td key={col} style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {s.data[col] ?? ''}
                        </td>
                      ))}
                      <td style={{ whiteSpace: 'nowrap' }}>{new Date(s.created_at).toLocaleString()}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <button
                          className="btn-ghost"
                          style={{ fontSize: 11, padding: '3px 8px' }}
                          onClick={() => markRead(s, !s.read)}
                        >
                          {s.read ? 'Mark unread' : 'Mark read'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {pages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, justifyContent: 'center' }}>
                <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</button>
                <span style={{ fontSize: 13 }}>Page {page} of {pages} · {total} total</span>
                <button className="btn-secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next →</button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Submission detail modal */}
      {detail && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setDetail(null); }}>
          <div className="modal" style={{ width: '100%', maxWidth: 560, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
            <div className="modal-header" style={{ flexShrink: 0 }}>
              <div>
                <h3 className="modal-title">{detail.form_name}</h3>
                <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 2 }}>
                  {new Date(detail.created_at).toLocaleString()}
                </p>
              </div>
              <button className="modal-close" onClick={() => setDetail(null)}>✕</button>
            </div>
            <div style={{ overflowY: 'auto', padding: '16px 24px', flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {Object.entries(detail.data).map(([key, value]) => (
                <div key={key}>
                  <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink-muted)', marginBottom: 3 }}>{key}</div>
                  <div style={{ fontSize: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{value || <em style={{ color: 'var(--ink-muted)' }}>—</em>}</div>
                </div>
              ))}
              {detail.files?.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink-muted)', marginBottom: 6 }}>Attachments</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {detail.files.map((f) => (
                      <a
                        key={f.stored}
                        href={contactFormsApi.fileDownloadUrl(detail.id, f.stored)}
                        download={f.original}
                        style={{ fontSize: 13, color: 'var(--blue)', display: 'flex', alignItems: 'center', gap: 6 }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        📎 {f.original}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div style={{ padding: '12px 24px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, flexShrink: 0 }}>
              <button className="btn-secondary" onClick={() => markRead(detail, !detail.read)}>
                {detail.read ? 'Mark as Unread' : 'Mark as Read'}
              </button>
              <button className="btn-ghost" onClick={() => setDetail(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
