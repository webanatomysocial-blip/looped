// Escalations the WhatsApp bot raised against employees. Managers (their pod) and admins confirm or reject each;
// only confirmed ones count against the employee.
import { useEffect, useState } from 'react';
import Layout from '../../components/Layout/Layout';
import '../../css/admin/UserManagement.css';
import { escalationsApi } from '../../services/api';
import TaskViewDrawer from '../../components/UI/TaskViewDrawer';

const when = (v: any) => { const d = /^\d+$/.test(String(v)) ? new Date(Number(v)) : new Date(String(v).includes('T') || String(v).endsWith('Z') ? v : String(v).replace(' ', 'T') + 'Z'); const p = (n: number) => String(n).padStart(2, '0'); return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const STATUS: Record<string, [string, string]> = { pending: ['To review', '#b45309'], confirmed: ['Confirmed', '#b52028'], rejected: ['Rejected', '#64748b'] };
const KIND: Record<string, string> = { acceptance: 'Not accepted in time', delayed: 'Delayed work' };

export default function Escalations() {
  const [tab, setTab] = useState<'pending' | 'confirmed' | 'rejected' | ''>('pending');
  const [rows, setRows] = useState<any[] | null>(null);
  const [counts, setCounts] = useState<any[]>([]);
  const [who, setWho] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [openTask, setOpenTask] = useState<number | null>(null);
  const load = () => {
    escalationsApi.list(tab || undefined).then((r) => setRows(r.data)).catch(() => setRows([]));
    escalationsApi.counts().then((r) => setCounts(r.data)).catch(() => setCounts([]));
  };
  useEffect(() => { setRows(null); load(); }, [tab]);

  const review = async (r: any, decision: 'confirm' | 'reject') => {
    let note: string | null = '';
    if (decision === 'reject') { note = window.prompt(`Why is this escalation for ${r.user_name} not fair? (required)`); if (note === null) return; if (!note.trim()) { alert('Please give a reason.'); return; } }
    setBusy(r.id);
    try { await escalationsApi.review(r.id, decision, note || undefined); load(); }
    catch (e: any) { alert(e?.response?.data?.error || 'Could not save this'); }
    finally { setBusy(null); }
  };

  const shown = (rows ?? []).filter((r) => who == null || Number(r.user_id) === who);
  return (
    <Layout>
      <div className="page-wrap">
        <div className="users-top">
          <div>
            <h2 className="page-title">Escalations</h2>
            <p className="page-subtitle">Raised by the WhatsApp bot when work was not accepted in time or stayed delayed. Confirm the fair ones (they count against the employee) or reject the ones that were not their fault.</p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0' }}>
          {counts.length === 0 && <span className="page-subtitle">No escalations yet.</span>}
          {counts.map((c) => (
            <button key={c.user_id} type="button" onClick={() => setWho(who === c.user_id ? null : c.user_id)}
              style={{ padding: '8px 12px', borderRadius: 10, border: `1.5px solid ${who === c.user_id ? '#1a5fa0' : 'var(--sand-border)'}`, background: 'var(--surface)', cursor: 'pointer', textAlign: 'left' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{c.user_name}</div>
              <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
                <b style={{ color: '#b52028' }}>{c.confirmed}</b> confirmed{c.pending ? <> · <b style={{ color: '#b45309' }}>{c.pending}</b> to review</> : null}{c.rejected ? ` · ${c.rejected} rejected` : ''}
              </div>
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 6, margin: '8px 0 14px', flexWrap: 'wrap' }}>
          {([['pending', 'To review'], ['confirmed', 'Confirmed'], ['rejected', 'Rejected'], ['', 'All']] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={tab === k ? 'btn-primary' : 'btn-secondary'} style={{ fontSize: 12, padding: '6px 12px' }}>{label}</button>
          ))}
          {who != null && <button type="button" className="btn-secondary" style={{ fontSize: 12, padding: '6px 12px' }} onClick={() => setWho(null)}>Show everyone</button>}
        </div>

        {rows === null ? <p className="page-subtitle">Loading…</p> : shown.length === 0 ? <p className="page-subtitle">Nothing here.</p> : (
          <div className="audit-list">
            {shown.map((r) => (
              <div key={r.id} className="audit-row">
                <div className="audit-head" style={{ flexWrap: 'wrap' }}>
                  <span className="audit-tag" style={{ color: STATUS[r.status]?.[1], background: `${STATUS[r.status]?.[1]}18` }}>{STATUS[r.status]?.[0] ?? r.status}</span>
                  <b>{r.user_name}</b>
                  <span>· {KIND[r.kind] ?? r.kind}</span>
                  <span className="audit-meta">{when(r.created_at)}</span>
                </div>
                <div className="audit-line">
                  {r.task_id ? <button type="button" onClick={() => setOpenTask(Number(r.task_id))} title="Open the ticket" style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: '#1a5fa0', textDecoration: 'underline', cursor: 'pointer' }}>{r.task_title || `Ticket #${r.task_id}`}</button> : null}
                  {r.task_id ? ' · ' : null}{r.reason}
                </div>
                {r.status !== 'pending' && <div className="audit-line">{r.status === 'confirmed' ? 'Confirmed' : 'Rejected'} by {r.reviewed_by_name ?? 'someone'}{r.reviewed_at ? ` · ${when(r.reviewed_at)}` : ''}{r.review_note ? ` · “${r.review_note}”` : ''}</div>}
                <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                  {r.task_id ? <button type="button" className="btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => setOpenTask(Number(r.task_id))}>Open ticket</button> : null}
                  {r.status !== 'confirmed' && <button type="button" disabled={busy === r.id} className="btn-primary" style={{ fontSize: 12, padding: '4px 10px', background: '#b52028', borderColor: '#b52028' }} onClick={() => review(r, 'confirm')}>Confirm escalation</button>}
                  {r.status !== 'rejected' && <button type="button" disabled={busy === r.id} className="btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => review(r, 'reject')}>Reject</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {openTask != null && <TaskViewDrawer taskId={openTask} onClose={() => setOpenTask(null)} onChanged={load} />}
    </Layout>
  );
}
