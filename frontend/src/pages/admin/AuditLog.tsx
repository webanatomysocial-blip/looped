// Change log: who created, changed or deleted which project or person, and when (admins only)
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../../components/Layout/Layout';
import '../../css/admin/UserManagement.css';
import { usersApi } from '../../services/api';

const ACTION: Record<string, [string, string]> = { create: ['Created', '#257a50'], update: ['Changed', '#1a5fa0'], delete: ['Deleted', '#b52028'] };
const when = (v: string) => { const d = new Date(String(v).includes('T') || String(v).endsWith('Z') ? v : String(v).replace(' ', 'T') + 'Z'); const p = (n: number) => String(n).padStart(2, '0'); return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`; };
// Plain words for the fields people care about; anything else is left out of the summary
const LABEL: Record<string, string> = { name: 'Name', email: 'Email', role: 'Role', pod: 'Pod', status: 'Status', due_date: 'Due date', monthly_salary: 'Salary', budget_amount: 'Budget', description: 'Description', password: 'Password', members: 'Members', categories: 'Categories', page_access: 'Page access', client_company_id: 'Client' };
const KEY: Record<string, string[]> = { user: ['email', 'role', 'pod'], project: ['pod', 'status', 'due_date'] };
const show = (v: unknown) => (v === null || v === undefined || v === '' ? 'none' : String(v).slice(0, 80));
const count = (v: unknown) => (Array.isArray(v) ? `${v.length}` : show(v));

function Details({ r }: { r: any }) {
  const d = r.details ?? {};
  if (r.action === 'update') {
    const lines = Object.entries(d).filter(([k]) => LABEL[k]).map(([k, v]: [string, any]) => {
      if (k === 'password') return 'Password changed';
      if (k === 'page_access') return 'Page access changed';
      if (k === 'members' || k === 'categories') return `${LABEL[k]}: ${count(v.from)} → ${count(v.to)}`;
      return `${LABEL[k]}: ${show(v?.from)} → ${show(v?.to)}`;
    });
    return lines.length ? <div className="audit-line">{lines.join(' · ')}</div> : null;
  }
  const facts = (KEY[r.kind] ?? []).filter((k) => d[k]).map((k) => `${LABEL[k]}: ${show(k === 'due_date' ? String(d[k]).slice(0, 10) : d[k])}`);
  const tasks = (d.tasks ?? d.tasks_created ?? []) as any[];
  if (r.action === 'delete' && tasks.length) facts.push(`${tasks.length} ticket${tasks.length > 1 ? 's' : ''} deleted with it`);
  return facts.length ? <div className="audit-line">{facts.join(' · ')}</div> : null;
}

export default function AuditLog() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [kind, setKind] = useState(''); const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => usersApi.auditLog({ kind: kind || undefined, q: q || undefined }).then((r) => setRows(r.data)).catch(() => setRows([])), 250); return () => clearTimeout(t); }, [kind, q]);
  return (
    <Layout>
      <div className="page-wrap">
        <div className="users-top">
          <div>
            <h2 className="page-title">Change log</h2>
            <p className="page-subtitle">Every project and person created, changed or deleted, with who did it. <Link to="/admin/users">Back to users</Link></p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0 16px' }}>
          <select className="form-input" style={{ width: 'auto' }} value={kind} onChange={(e) => setKind(e.target.value)}><option value="">Projects and people</option><option value="project">Projects</option><option value="user">People</option></select>
          <input className="form-input" style={{ flex: '1 1 220px' }} placeholder="Search by name or by who did it" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {rows === null ? <p className="page-subtitle">Loading…</p> : rows.length === 0 ? <p className="page-subtitle">Nothing recorded yet. Changes are recorded from this update onwards.</p> : (
          <div className="audit-list">
            {rows.map((r) => (
              <div key={r.id} className="audit-row">
                <div className="audit-head">
                  <span className="audit-tag" style={{ color: ACTION[r.action]?.[1], background: `${ACTION[r.action]?.[1]}18` }}>{ACTION[r.action]?.[0] ?? r.action}</span>
                  <b>{r.kind === 'project' ? 'Project' : 'Person'}: {r.name}</b>
                  <span className="audit-meta">by {r.actor_name ?? 'unknown'} · {when(r.created_at)}</span>
                </div>
                <Details r={r} />
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
