import { useEffect, useState } from 'react';
import Layout from '../components/Layout/Layout';
import { regularisationApi } from '../services/api';

type Request = {
  id: number;
  task_id: number;
  task_title: string;
  project_name: string;
  estimated_hours: number | null;
  tracked_hours: number;
  user_id: number;
  user_name: string;
  status: 'pending' | 'approved' | 'rejected';
  reason: string | null;
  new_est_hours: number | null;
  reviewed_by_name: string | null;
  created_at: string;
};

function fmtHrs(h: number) {
  const m = Math.round(h * 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${m % 60 > 0 ? ` ${m % 60}m` : ''}`;
}

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  pending:  { bg: 'rgba(245,158,11,0.12)', color: '#b45309' },
  approved: { bg: 'rgba(34,197,94,0.12)',  color: '#15803d' },
  rejected: { bg: 'rgba(239,68,68,0.12)',  color: '#dc2626' },
};

export default function Regularisation() {
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading]   = useState(true);
  const [approveModal, setApproveModal] = useState<Request | null>(null);
  const [newEst, setNewEst]     = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = () => {
    setLoading(true);
    regularisationApi.list().then((r) => setRequests(r.data)).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const handleReject = async (id: number) => {
    if (!window.confirm('Reject this regularisation request?')) return;
    await regularisationApi.review(id, 'reject').catch(() => {});
    load();
  };

  const handleApprove = async () => {
    if (!approveModal) return;
    const hrs = parseFloat(newEst);
    if (!hrs || hrs <= 0) { alert('Enter a valid number of hours'); return; }
    setSubmitting(true);
    try {
      await regularisationApi.review(approveModal.id, 'approve', hrs);
      setApproveModal(null);
      load();
    } catch (e: any) { alert(e?.response?.data?.error || 'Error'); }
    finally { setSubmitting(false); }
  };

  const pending  = requests.filter((r) => r.status === 'pending');
  const reviewed = requests.filter((r) => r.status !== 'pending');

  return (
    <Layout>
      <div style={{ padding: '28px 32px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: 'var(--ink)' }}>Regularisation Requests</h1>
            <p style={{ fontSize: 13, color: 'var(--ink-muted)', margin: '4px 0 0' }}>Review and approve time extension requests from employees</p>
          </div>
          {pending.length > 0 && (
            <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 'var(--r-pill)', background: 'rgba(245,158,11,0.12)', color: '#b45309' }}>
              {pending.length} pending
            </span>
          )}
        </div>

        {loading ? (
          <div style={{ color: 'var(--ink-muted)', fontSize: 14, padding: 40, textAlign: 'center' }}>Loading…</div>
        ) : requests.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 20px', color: 'var(--ink-muted)', fontSize: 14 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⏱</div>
            No regularisation requests yet.
          </div>
        ) : (
          <>
            {pending.length > 0 && (
              <section style={{ marginBottom: 36 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-muted)', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 12 }}>Pending</div>
                <div style={{
                  borderRadius: 20, border: '1px solid rgba(255,255,255,0.6)',
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.4) 100%)',
                  backdropFilter: 'blur(24px)', boxShadow: '0 10px 40px rgba(0,0,0,0.04)', overflow: 'hidden',
                }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font)' }}>
                    <thead>
                      <tr>
                        {['Task', 'Employee', 'Est.', 'Tracked', 'Overdue by', 'Buffer (20%)', 'Reason', ''].map((h) => (
                          <th key={h} style={{ padding: '14px 20px', fontSize: 12, fontWeight: 600, color: 'var(--ink-muted)', textAlign: 'left', borderBottom: '1px solid rgba(229,223,211,0.55)', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pending.map((r, i) => {
                        const overdue = r.estimated_hours ? Math.max(0, r.tracked_hours - r.estimated_hours) : 0;
                        const buffer  = r.estimated_hours ? r.estimated_hours * 0.2 : 0;
                        return (
                          <tr key={r.id} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.015)', transition: 'background 0.12s' }}>
                            <td style={{ padding: '14px 20px', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                              {r.task_title}
                              <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--ink-muted)', marginTop: 2 }}>{r.project_name}</div>
                            </td>
                            <td style={{ padding: '14px 20px', fontSize: 13, color: 'var(--ink)' }}>{r.user_name}</td>
                            <td style={{ padding: '14px 20px', fontSize: 13, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{r.estimated_hours ? fmtHrs(r.estimated_hours) : '—'}</td>
                            <td style={{ padding: '14px 20px', fontSize: 13, fontWeight: 600, color: '#dc2626', fontVariantNumeric: 'tabular-nums' }}>{fmtHrs(r.tracked_hours)}</td>
                            <td style={{ padding: '14px 20px', fontSize: 13, fontWeight: 600, color: '#f59e0b', fontVariantNumeric: 'tabular-nums' }}>{overdue > 0 ? fmtHrs(overdue) : '—'}</td>
                            <td style={{ padding: '14px 20px', fontSize: 13, color: 'var(--ink-muted)', fontVariantNumeric: 'tabular-nums' }}>{buffer > 0 ? fmtHrs(buffer) : '—'}</td>
                            <td style={{ padding: '14px 20px', fontSize: 12, color: 'var(--ink-muted)', maxWidth: 200 }}>
                              {r.reason ? <span style={{ background: 'rgba(245,158,11,0.08)', color: '#92400e', padding: '2px 8px', borderRadius: 6, display: 'inline-block' }}>"{r.reason}"</span> : '—'}
                            </td>
                            <td style={{ padding: '14px 20px', whiteSpace: 'nowrap' }}>
                              <div style={{ display: 'flex', gap: 8 }}>
                                <button onClick={() => { setApproveModal(r); const suggested = r.estimated_hours ? Math.ceil((r.estimated_hours * 1.2) * 10) / 10 : Math.ceil(r.tracked_hours * 10) / 10; setNewEst(String(suggested)); }}
                                  style={{ padding: '6px 14px', borderRadius: 'var(--r-pill)', border: 'none', background: 'var(--ink)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)' }}>
                                  Approve
                                </button>
                                <button onClick={() => handleReject(r.id)}
                                  style={{ padding: '6px 14px', borderRadius: 'var(--r-pill)', border: '1.5px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.06)', color: '#dc2626', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)' }}>
                                  Reject
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {reviewed.length > 0 && (
              <section>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-muted)', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 12 }}>Reviewed</div>
                <div style={{
                  borderRadius: 20, border: '1px solid rgba(255,255,255,0.6)',
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.4) 100%)',
                  backdropFilter: 'blur(24px)', boxShadow: '0 10px 40px rgba(0,0,0,0.04)', overflow: 'hidden',
                }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font)' }}>
                    <thead>
                      <tr>
                        {['Task', 'Employee', 'Est.', 'Tracked', 'New Est.', 'Reason', 'Status', 'Reviewed by'].map((h) => (
                          <th key={h} style={{ padding: '14px 20px', fontSize: 12, fontWeight: 600, color: 'var(--ink-muted)', textAlign: 'left', borderBottom: '1px solid rgba(229,223,211,0.55)', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {reviewed.map((r, i) => {
                        const st = STATUS_STYLE[r.status] || STATUS_STYLE.pending;
                        return (
                          <tr key={r.id} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.015)' }}>
                            <td style={{ padding: '14px 20px', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                              {r.task_title}
                              <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--ink-muted)', marginTop: 2 }}>{r.project_name}</div>
                            </td>
                            <td style={{ padding: '14px 20px', fontSize: 13, color: 'var(--ink)' }}>{r.user_name}</td>
                            <td style={{ padding: '14px 20px', fontSize: 13, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{r.estimated_hours ? fmtHrs(r.estimated_hours) : '—'}</td>
                            <td style={{ padding: '14px 20px', fontSize: 13, color: '#dc2626', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtHrs(r.tracked_hours)}</td>
                            <td style={{ padding: '14px 20px', fontSize: 13, color: '#15803d', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{r.new_est_hours ? fmtHrs(r.new_est_hours) : '—'}</td>
                            <td style={{ padding: '14px 20px', fontSize: 12, color: 'var(--ink-muted)', maxWidth: 180 }}>
                              {r.reason ? <span style={{ background: 'rgba(245,158,11,0.08)', color: '#92400e', padding: '2px 8px', borderRadius: 6, display: 'inline-block' }}>"{r.reason}"</span> : '—'}
                            </td>
                            <td style={{ padding: '14px 20px' }}>
                              <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 'var(--r-pill)', background: st.bg, color: st.color, textTransform: 'capitalize' }}>{r.status}</span>
                            </td>
                            <td style={{ padding: '14px 20px', fontSize: 12, color: 'var(--ink-muted)' }}>{r.reviewed_by_name || '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {/* Approve modal */}
      {approveModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}>
          <div style={{ background: '#fff', borderRadius: 20, padding: 32, width: 440, boxShadow: '0 24px 64px rgba(0,0,0,0.18)', border: '1px solid rgba(255,255,255,0.8)' }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 700, color: 'var(--ink)', fontFamily: 'var(--font)' }}>Approve Regularisation</h3>
            <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--ink-muted)' }}>
              <strong style={{ color: 'var(--ink)' }}>{approveModal.user_name}</strong> · <em>{approveModal.task_title}</em>
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 20 }}>
              {[
                { label: 'Original est.', value: approveModal.estimated_hours ? fmtHrs(approveModal.estimated_hours) : '—', color: 'var(--ink)' },
                { label: 'Tracked', value: fmtHrs(approveModal.tracked_hours), color: '#dc2626' },
                { label: 'Buffer (20%)', value: approveModal.estimated_hours ? fmtHrs(approveModal.estimated_hours * 0.2) : '—', color: '#f59e0b' },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ background: 'var(--bg-sand, #f8f5f0)', borderRadius: 12, padding: '12px 14px' }}>
                  <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginBottom: 4 }}>{label}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
                </div>
              ))}
            </div>

            {approveModal.reason && (
              <div style={{ marginBottom: 16, padding: '10px 14px', background: 'rgba(245,158,11,0.08)', borderRadius: 10, fontSize: 12, color: '#92400e', borderLeft: '3px solid #f59e0b' }}>
                <strong>Reason:</strong> {approveModal.reason}
              </div>
            )}

            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', display: 'block', marginBottom: 6, fontFamily: 'var(--font)' }}>
              New estimated hours
            </label>
            <input type="number" min="0.1" step="0.1" className="form-input" value={newEst}
              onChange={(e) => setNewEst(e.target.value)}
              placeholder="e.g. 1.5"
              autoFocus
            />
            <p style={{ fontSize: 11, color: 'var(--ink-muted)', margin: '6px 0 0' }}>
              Pre-filled with est. + 20% buffer{approveModal.estimated_hours ? ` (${fmtHrs(approveModal.estimated_hours * 1.2)})` : ''}. You can adjust up or down — overdue clears once tracked ≤ new est.
            </p>

            <div style={{ display: 'flex', gap: 8, marginTop: 24, justifyContent: 'flex-end' }}>
              <button onClick={() => setApproveModal(null)}
                style={{ padding: '9px 20px', borderRadius: 'var(--r-pill)', border: '1px solid var(--border, #e5e5e5)', background: 'transparent', cursor: 'pointer', fontSize: 13, color: 'var(--ink-muted)', fontFamily: 'var(--font)', fontWeight: 500 }}>
                Cancel
              </button>
              <button disabled={submitting} onClick={handleApprove}
                style={{ padding: '9px 20px', borderRadius: 'var(--r-pill)', border: 'none', background: 'var(--ink)', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'var(--font)', opacity: submitting ? 0.6 : 1 }}>
                {submitting ? 'Approving…' : 'Approve & Update'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
