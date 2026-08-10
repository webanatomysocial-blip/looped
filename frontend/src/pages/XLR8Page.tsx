import { useEffect, useState, useCallback } from 'react';
import Layout from '../components/Layout/Layout';
import { projectsApi, timeLogsApi } from '../services/api';
import { Project } from '../types';
import '../css/pages/Reports.css';

export default function XLR8Page() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<number | ''>('');
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    projectsApi.list().then((r) => {
      const xlr8 = r.data.filter((p: Project) => p.service_type === 'xlr8');
      setProjects(xlr8);
      if (xlr8.length === 1) setSelectedId(xlr8[0].id);
    });
  }, []);

  const load = useCallback(async (id: number) => {
    setLoading(true);
    setReport(null);
    try {
      const r = await timeLogsApi.xlr8(id);
      setReport(r.data);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (selectedId) load(Number(selectedId));
  }, [selectedId, load]);

  const byEmp: Record<string, { name: string; color: string; hours: number }> = {};
  if (report?.logs) {
    for (const l of report.logs) {
      if (!byEmp[l.user_id]) byEmp[l.user_id] = { name: l.user_name, color: l.user_color, hours: 0 };
      byEmp[l.user_id].hours += Number(l.hours);
    }
  }
  const empList = Object.values(byEmp).sort((a, b) => b.hours - a.hours);

  return (
    <Layout>
      <div className="page-wrap">
        <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 className="page-title">XLR8 Bucket Usage</h2>
            <p className="page-subtitle">Monthly hours bucket and team breakdown</p>
          </div>
          {projects.length > 1 && (
            <select
              className="form-input"
              style={{ maxWidth: 280, fontSize: 13 }}
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">Select project…</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
        </div>

        {projects.length === 0 && (
          <div className="empty-state">No XLR8 projects yet. Set service type to "XLR8" when creating a project.</div>
        )}

        {loading && <p className="page-subtitle" style={{ textAlign: 'center', padding: 40 }}>Loading…</p>}

        {report && !report.error && (
          <div>
            {/* Header */}
            <div className="report-xlr8-header" style={{ marginBottom: 20 }}>
              <div>
                <p className="report-xlr8-project">{report.project_name}</p>
                {report.client_name && <p className="page-subtitle">{report.client_name}</p>}
                <p className="page-subtitle" style={{ marginTop: 4 }}>Billing cycle: {report.cycle_start} → {report.cycle_end}</p>
              </div>
              <div className="report-xlr8-nums">
                {report.rate_per_hour > 0 && (
                  <span className="page-subtitle">₹{report.rate_per_hour.toLocaleString('en-IN', { maximumFractionDigits: 2 })} / hr</span>
                )}
                {report.budget_amount > 0 && (
                  <span className="page-subtitle">Budget: ₹{report.budget_amount.toLocaleString('en-IN')}</span>
                )}
              </div>
            </div>

            {/* KPI row */}
            <div className="rp-kpi-row" style={{ marginBottom: 20 }}>
              <div className="rp-kpi">
                <span className="rp-kpi__val">{report.monthly_hours_bucket} <small>hrs</small></span>
                <span className="rp-kpi__label">Monthly Bucket</span>
              </div>
              <div className="rp-kpi">
                <span className="rp-kpi__val" style={{ color: report.warning ? 'var(--orange)' : 'var(--ink)' }}>{report.hours_used} <small>hrs</small></span>
                <span className="rp-kpi__label">Hours Used</span>
              </div>
              <div className="rp-kpi">
                <span className="rp-kpi__val" style={{ color: 'var(--green)' }}>{report.hours_remaining} <small>hrs</small></span>
                <span className="rp-kpi__label">Remaining</span>
              </div>
              <div className="rp-kpi">
                <span className="rp-kpi__val" style={{ color: report.usage_pct >= 100 ? 'var(--red)' : report.warning ? 'var(--orange)' : 'var(--ink)' }}>
                  {report.usage_pct}%
                </span>
                <span className="rp-kpi__label">Usage</span>
              </div>
              {report.budget_amount > 0 && (
                <>
                  <div className="rp-kpi">
                    <span className="rp-kpi__val">₹{report.amount_spent.toLocaleString('en-IN')}</span>
                    <span className="rp-kpi__label">Amount Spent</span>
                  </div>
                  <div className="rp-kpi">
                    <span className="rp-kpi__val" style={{ color: 'var(--green)' }}>₹{report.amount_remaining.toLocaleString('en-IN')}</span>
                    <span className="rp-kpi__label">Remaining Budget</span>
                  </div>
                </>
              )}
            </div>

            {/* Usage bar */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--ink-muted)', marginBottom: 6 }}>
                <span>Bucket Usage</span>
                <span>{report.hours_used} / {report.monthly_hours_bucket} hrs {report.usage_pct >= 100 ? '🔴 Over limit' : report.warning ? '⚠ Approaching limit' : ''}</span>
              </div>
              <div className="report-xlr8-bar-wrap" style={{ height: 14 }}>
                <div
                  className={`report-xlr8-bar-fill${report.usage_pct >= 100 ? ' report-xlr8-bar-fill--over' : report.warning ? ' report-xlr8-bar-fill--warn' : ''}`}
                  style={{ width: `${Math.min(100, report.usage_pct)}%` }}
                />
              </div>
            </div>

            {/* Hours by team member */}
            {empList.length > 0 && (
              <div style={{ marginBottom: 28 }}>
                <p className="report-section-label">Hours by Team Member</p>
                {empList.map((e) => (
                  <div key={e.name} className="rp-member-row">
                    <div className="report-tl-avatar" style={{ background: e.color }}>
                      {e.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span className="report-tl-name" style={{ flex: 'unset' }}>{e.name}</span>
                        <span className="report-tl-hrs">{Math.round(e.hours * 100) / 100} hrs</span>
                      </div>
                      {report.hours_used > 0 && (
                        <div className="report-bar-wrap" style={{ height: 5 }}>
                          <div className="report-bar-fill" style={{ width: `${Math.round((e.hours / report.hours_used) * 100)}%`, background: 'var(--orange)' }} />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Log entries */}
            {report.logs.length > 0 && (
              <div>
                <p className="report-section-label">Log Entries This Cycle ({report.logs.length})</p>
                <div className="rp-log-table-wrap">
                  <table className="rp-log-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Employee</th>
                        <th>Task</th>
                        <th>Hours</th>
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.logs.map((l: any) => (
                        <tr key={l.id}>
                          <td>{l.log_date}</td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <div className="report-tl-avatar" style={{ background: l.user_color, width: 22, height: 22, fontSize: 9 }}>
                                {l.user_name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
                              </div>
                              {l.user_name}
                            </div>
                          </td>
                          <td>{l.task_title}</td>
                          <td style={{ fontWeight: 700 }}>{l.hours}</td>
                          <td style={{ color: 'var(--ink-muted)' }}>{l.notes || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {report.logs.length === 0 && (
              <p className="page-subtitle" style={{ marginTop: 16 }}>No time logs recorded this cycle yet.</p>
            )}
          </div>
        )}

        {report?.error && <p style={{ color: 'var(--red)', marginTop: 16 }}>{report.error}</p>}
      </div>
    </Layout>
  );
}
