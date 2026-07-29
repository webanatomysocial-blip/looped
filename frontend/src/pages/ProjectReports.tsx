import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import Layout from '../components/Layout/Layout';
import { projectsApi, timeLogsApi } from '../services/api';
import { Project } from '../types';
import '../css/pages/Reports.css';

interface ProjectLog {
  user_id: number;
  user_name: string;
  user_color: string;
  total_hours: number;
  // cost computed client-side from hourly_rate on logs
}

interface ProjectDetail {
  project: Project;
  by_user: ProjectLog[];
  total_hours: number;
}

const HEALTH_COLORS: Record<string, string> = {
  green: 'var(--green)',
  amber: '#d97706',
  red:   'var(--red)',
};

const HEALTH_LABELS: Record<string, string> = {
  green: 'Healthy',
  amber: 'At Risk',
  red:   'Critical',
};

export default function ProjectReports() {
  const [projects, setProjects]           = useState<Project[]>([]);
  const [details, setDetails]             = useState<Record<number, ProjectDetail>>({});
  const [loading, setLoading]             = useState(true);
  const [expandedId, setExpandedId]       = useState<number | null>(null);
  const [filterStatus, setFilterStatus]   = useState<string>('active');

  useEffect(() => {
    projectsApi.list().then((r) => {
      const perProject = r.data.filter((p: Project) => p.service_type === 'per_project');
      setProjects(perProject);
      setLoading(false);
    });
  }, []);

  const loadDetail = async (projectId: number) => {
    if (details[projectId]) { setExpandedId(expandedId === projectId ? null : projectId); return; }
    try {
      const r = await timeLogsApi.byProject(projectId);
      setDetails((prev) => ({ ...prev, [projectId]: { project: projects.find(p => p.id === projectId)!, ...r.data } }));
      setExpandedId(projectId);
    } catch { /* ignore */ }
  };

  const displayed = filterStatus === 'all' ? projects : projects.filter(p => p.status === filterStatus);

  const fmt = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

  return (
    <Layout>
      <div className="page-wrap">
        <div style={{ marginBottom: 24 }}>
          <h2 className="page-title">Project Cost Reports</h2>
          <p className="page-subtitle">Per-project salary-based budget analytics</p>
        </div>

        <div className="filter-bar" style={{ marginBottom: 20 }}>
          {['all', 'active', 'completed', 'on_hold'].map((s) => (
            <button key={s} className={`filter-tab${filterStatus === s ? ' active' : ''}`} onClick={() => setFilterStatus(s)}>
              {s === 'all' ? 'All' : s === 'on_hold' ? 'On Hold' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {loading && <p className="page-subtitle" style={{ textAlign: 'center', padding: 40 }}>Loading…</p>}

        {!loading && displayed.length === 0 && (
          <div className="empty-state">No per-project projects found</div>
        )}

        {!loading && displayed.map((project) => {
          const isExpanded = expandedId === project.id;
          const detail     = details[project.id];
          const cutoff     = Number(project.budget_cutoff_pct) || 0;
          const budget     = Number(project.budget_amount) || 0;
          const working    = project.working_budget ?? (budget * (1 - cutoff / 100));
          const spent      = project.total_spend ?? 0;
          const remaining  = project.amount_remaining ?? Math.max(0, working - spent);
          const usedPct    = project.budget_used_pct ?? (working > 0 ? Math.round((spent / working) * 100) : 0);
          const flag       = project.health_flag ?? 'green';

          return (
            <div key={project.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, marginBottom: 16, overflow: 'hidden' }}>
              {/* Summary row */}
              <div
                style={{ padding: '16px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 16 }}
                onClick={() => loadDetail(project.id)}
              >
                {/* Name + status */}
                <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                  <p style={{ fontWeight: 700, fontSize: 15, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.name}</p>
                  <p style={{ fontSize: 12, color: 'var(--ink-muted)', margin: 0, marginTop: 2 }}>
                    {project.client_name || 'No client'} · {project.status}
                  </p>
                </div>

                {/* Budget */}
                <div style={{ flex: '0 0 120px', textAlign: 'right' }}>
                  <p style={{ fontSize: 11, color: 'var(--ink-muted)', margin: 0 }}>Budget</p>
                  <p style={{ fontWeight: 700, fontSize: 14, margin: 0 }}>{fmt(budget)}</p>
                  {cutoff > 0 && <p style={{ fontSize: 11, color: 'var(--ink-muted)', margin: 0 }}>−{cutoff}% = {fmt(working)} working</p>}
                </div>

                {/* Spent */}
                <div style={{ flex: '0 0 100px', textAlign: 'right' }}>
                  <p style={{ fontSize: 11, color: 'var(--ink-muted)', margin: 0 }}>Spent</p>
                  <p style={{ fontWeight: 700, fontSize: 14, margin: 0, color: spent > 0 ? 'var(--ink)' : 'var(--ink-muted)' }}>{fmt(spent)}</p>
                </div>

                {/* Remaining */}
                <div style={{ flex: '0 0 110px', textAlign: 'right' }}>
                  <p style={{ fontSize: 11, color: 'var(--ink-muted)', margin: 0 }}>Remaining</p>
                  <p style={{ fontWeight: 700, fontSize: 14, margin: 0, color: HEALTH_COLORS[flag] }}>{fmt(remaining)}</p>
                </div>

                {/* Health badge + bar */}
                <div style={{ flex: '0 0 160px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: HEALTH_COLORS[flag] }}>{HEALTH_LABELS[flag]}</span>
                    <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{usedPct}%</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 3, width: `${Math.min(100, usedPct)}%`, background: HEALTH_COLORS[flag], transition: 'width 0.4s' }} />
                  </div>
                </div>

                {/* Hours */}
                <div style={{ flex: '0 0 70px', textAlign: 'right' }}>
                  <p style={{ fontSize: 11, color: 'var(--ink-muted)', margin: 0 }}>Hours</p>
                  <p style={{ fontWeight: 600, fontSize: 14, margin: 0 }}>{(project.hours_logged ?? 0).toFixed(1)}h</p>
                </div>

                <div style={{ color: 'var(--ink-muted)', fontSize: 18 }}>{isExpanded ? '▲' : '▼'}</div>
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div style={{ borderTop: '1px solid var(--border)', padding: '16px 20px', background: 'var(--bg)' }}>
                  {/* Key metrics row */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
                    {[
                      { label: 'Total Budget',    value: fmt(budget) },
                      { label: `Cut-off (${cutoff}%)`, value: fmt(budget - working) },
                      { label: 'Working Budget',  value: fmt(working) },
                      { label: 'Total Spent',     value: fmt(spent), color: spent > 0 ? 'var(--ink)' : undefined },
                      { label: 'Amount Remaining', value: fmt(remaining), color: HEALTH_COLORS[flag] },
                      { label: 'Due',             value: project.due_date ? format(parseISO(project.due_date), 'MMM d, yyyy') : '—' },
                    ].map(({ label, value, color }) => (
                      <div key={label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px' }}>
                        <p style={{ fontSize: 11, color: 'var(--ink-muted)', margin: 0 }}>{label}</p>
                        <p style={{ fontSize: 16, fontWeight: 700, margin: '4px 0 0', color: color ?? 'var(--ink)' }}>{value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Per-employee breakdown */}
                  {detail && detail.by_user.length > 0 && (
                    <div>
                      <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-muted)', marginBottom: 10 }}>Employee Breakdown</p>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--border)' }}>
                            <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--ink-muted)', fontWeight: 600 }}>Employee</th>
                            <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--ink-muted)', fontWeight: 600 }}>Hours Logged</th>
                            <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--ink-muted)', fontWeight: 600 }}>Spent Cost</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.by_user.map((u: any) => (
                            <tr key={u.user_id} style={{ borderBottom: '1px solid var(--border)' }}>
                              <td style={{ padding: '8px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ width: 26, height: 26, borderRadius: '50%', background: u.user_color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                                  {u.user_name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
                                </div>
                                {u.user_name}
                              </td>
                              <td style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 600 }}>{Number(u.total_hours).toFixed(2)}h</td>
                              <td style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 600 }}>₹{Math.round(u.total_cost ?? 0).toLocaleString('en-IN')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {detail && detail.by_user.length === 0 && (
                    <p style={{ color: 'var(--ink-muted)', fontSize: 13, margin: 0 }}>No time logged yet</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Layout>
  );
}
