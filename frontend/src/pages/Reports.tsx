import { useEffect, useState } from 'react';
import Layout from '../components/Layout/Layout';
import { reportsApi, timeLogsApi, projectsApi, usersApi } from '../services/api';
import { ReportSummary, Project, User } from '../types';
import '../css/pages/Reports.css';

const STATUS_BAR_COLOR: Record<string, string> = {
  todo:        'var(--sand-border)',
  in_progress: 'var(--orange)',
  in_review:   'var(--blue)',
  overdue:     'var(--red)',
  completed:   'var(--green)',
};

const STAT_VARIANT = ['yellow', 'green', 'blue', 'green', 'orange', 'purple'];

type ReportTab = 'overview' | 'per_project' | 'per_employee' | 'xlr8';

export default function Reports() {
  const [tab, setTab] = useState<ReportTab>('overview');

  const [summary, setSummary]                   = useState<ReportSummary | null>(null);
  const [tasksByStatus, setTasksByStatus]       = useState<{ status: string; count: number }[]>([]);
  const [projectsByClient, setProjectsByClient] = useState<{ client: string; count: number }[]>([]);
  const [loading, setLoading]                   = useState(true);

  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers]       = useState<User[]>([]);

  const [selProjectId, setSelProjectId] = useState<number | ''>('');
  const [projFrom, setProjFrom]         = useState('');
  const [projTo, setProjTo]             = useState('');
  const [projReport, setProjReport]     = useState<any>(null);
  const [projLoading, setProjLoading]   = useState(false);

  const [selUserId, setSelUserId]     = useState<number | ''>('');
  const [userFrom, setUserFrom]       = useState('');
  const [userTo, setUserTo]           = useState('');
  const [userReport, setUserReport]   = useState<any>(null);
  const [userLoading, setUserLoading] = useState(false);

  const [xlr8ProjectId, setXlr8ProjectId] = useState<number | ''>('');
  const [xlr8Report, setXlr8Report]       = useState<any>(null);
  const [xlr8Loading, setXlr8Loading]     = useState(false);

  useEffect(() => {
    Promise.all([
      reportsApi.summary(), reportsApi.tasksByStatus(), reportsApi.projectsByClient(),
      projectsApi.list(), usersApi.list(),
    ]).then(([s, t, p, projs, usrs]) => {
      setSummary(s.data); setTasksByStatus(t.data); setProjectsByClient(p.data);
      setProjects(projs.data); setUsers(usrs.data);
    }).finally(() => setLoading(false));
  }, []);

  const loadProjReport = () => {
    if (!selProjectId) return;
    setProjLoading(true);
    timeLogsApi.byProject(Number(selProjectId), { from: projFrom || undefined, to: projTo || undefined })
      .then((r) => setProjReport(r.data)).finally(() => setProjLoading(false));
  };

  const loadUserReport = () => {
    if (!selUserId) return;
    setUserLoading(true);
    timeLogsApi.byUser(Number(selUserId), { from: userFrom || undefined, to: userTo || undefined })
      .then((r) => setUserReport(r.data)).finally(() => setUserLoading(false));
  };

  const loadXlr8 = () => {
    if (!xlr8ProjectId) return;
    setXlr8Loading(true);
    timeLogsApi.xlr8(Number(xlr8ProjectId))
      .then((r) => setXlr8Report(r.data))
      .catch((e) => setXlr8Report({ error: e.response?.data?.error || 'Error' }))
      .finally(() => setXlr8Loading(false));
  };

  if (loading) return <Layout><div className="empty-state">Loading…</div></Layout>;

  const completionRate = summary
    ? Math.round((Number(summary.completed_tasks) / Math.max(Number(summary.total_tasks), 1)) * 100) : 0;

  const stats = [
    { label: 'Total projects',    value: summary?.total_projects },
    { label: 'Active projects',   value: summary?.active_projects },
    { label: 'Total tasks',       value: summary?.total_tasks },
    { label: 'Completed tasks',   value: summary?.completed_tasks },
    { label: 'Pending approvals', value: summary?.pending_approvals },
    { label: 'Team members',      value: summary?.total_users },
  ];

  const circ = 2 * Math.PI * 44;
  const xlr8Projects = projects.filter(p => p.service_type === 'xlr8');
  const teamUsers = users.filter(u => u.role !== 'client');

  return (
    <Layout>
      <div className="page-wrap">
        <div style={{ marginBottom: 20 }}>
          <h2 className="page-title">Reports</h2>
          <p className="page-subtitle">Overview of your agency's performance</p>
        </div>

        <div className="filter-bar" style={{ marginBottom: 24 }}>
          {([
            { key: 'overview',     label: 'Overview' },
            { key: 'per_project',  label: 'Per Project' },
            { key: 'per_employee', label: 'Per Employee' },
            { key: 'xlr8',        label: 'XLR8 Bucket' },
          ] as { key: ReportTab; label: string }[]).map(({ key, label }) => (
            <button key={key} className={`filter-tab${tab === key ? ' active' : ''}`} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </div>

        {/* OVERVIEW */}
        {tab === 'overview' && (
          <>
            <div className="reports-stats">
              {stats.map(({ label, value }, i) => (
                <div key={label} className={`report-stat-card report-stat-card--${STAT_VARIANT[i]}`}>
                  <p className="report-stat-card__label">{label}</p>
                  <p className="report-stat-card__value">{value ?? 0}</p>
                </div>
              ))}
            </div>
            <div className="reports-charts">
              <div className="report-card">
                <p className="report-card__title">Task Completion</p>
                <div className="report-ring-wrap">
                  <div className="report-ring">
                    <svg width="110" height="110" style={{ transform: 'rotate(-90deg)' }}>
                      <circle cx="55" cy="55" r="44" fill="none" stroke="#E8E0D0" strokeWidth="10" />
                      <circle cx="55" cy="55" r="44" fill="none" stroke="var(--orange)" strokeWidth="10"
                        strokeLinecap="round"
                        strokeDasharray={`${circ * completionRate / 100} ${circ * (1 - completionRate / 100)}`} />
                    </svg>
                    <div className="report-ring-label">
                      <span className="report-ring-label__val">{completionRate}%</span>
                      <span className="report-ring-label__sub">done</span>
                    </div>
                  </div>
                  <div className="report-ring-info">
                    <p>Task Completion</p>
                    <span>{summary?.completed_tasks} of {summary?.total_tasks} tasks completed</span>
                  </div>
                </div>
              </div>
              <div className="report-card">
                <p className="report-card__title">Tasks by Status</p>
                {tasksByStatus.map(({ status, count }) => {
                  const total = tasksByStatus.reduce((s, t) => s + Number(t.count), 0);
                  const pct = total ? Math.round((Number(count) / total) * 100) : 0;
                  return (
                    <div key={status} className="report-bar-row">
                      <div className="report-bar-row__labels">
                        <span className="report-bar-row__name">{status.replace('_', ' ')}</span>
                        <span className="report-bar-row__count">{count} ({pct}%)</span>
                      </div>
                      <div className="report-bar-wrap">
                        <div className="report-bar-fill" style={{ width: `${pct}%`, background: STATUS_BAR_COLOR[status] ?? 'var(--sand-border)' }} />
                      </div>
                    </div>
                  );
                })}
                {tasksByStatus.length === 0 && <p className="page-subtitle">No data yet</p>}
              </div>
              <div className="report-card report-card--full">
                <p className="report-card__title">Projects by Client</p>
                {projectsByClient.length === 0 ? <p className="page-subtitle">No data yet</p> : (
                  projectsByClient.map(({ client, count }) => {
                    const max = Math.max(...projectsByClient.map((p) => Number(p.count)));
                    const pct = Math.round((Number(count) / max) * 100);
                    return (
                      <div key={client} className="client-bar-row">
                        <span className="client-bar-row__name">{client || 'No client'}</span>
                        <div className="client-bar-row__track"><div className="client-bar-row__fill" style={{ width: `${pct}%` }} /></div>
                        <span className="client-bar-row__count">{count}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </>
        )}

        {/* PER PROJECT */}
        {tab === 'per_project' && (
          <div className="report-card report-card--full">
            <p className="report-card__title">Hours by Project</p>
            <div className="report-filter-row">
              <select className="form-input" style={{ maxWidth: 260 }} value={selProjectId}
                onChange={(e) => { setSelProjectId(e.target.value ? Number(e.target.value) : ''); setProjReport(null); }}>
                <option value="">Select project…</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input type="date" className="form-input" style={{ maxWidth: 150 }} value={projFrom} onChange={(e) => setProjFrom(e.target.value)} />
              <input type="date" className="form-input" style={{ maxWidth: 150 }} value={projTo}   onChange={(e) => setProjTo(e.target.value)} />
              <button className="btn-secondary" onClick={loadProjReport} disabled={!selProjectId || projLoading}>
                {projLoading ? 'Loading…' : 'Run report'}
              </button>
            </div>
            {projReport && (
              <>
                <div className="report-tl-summary"><span className="report-tl-total">{projReport.total_hours} hrs total</span></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 16 }}>
                  <div>
                    <p className="report-section-label">By Employee</p>
                    {projReport.by_user.length === 0 && <p className="page-subtitle">No logs yet</p>}
                    {projReport.by_user.map((u: any) => (
                      <div key={u.user_id} className="report-tl-row">
                        <div className="report-tl-avatar" style={{ background: u.user_color }}>
                          {u.user_name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
                        </div>
                        <span className="report-tl-name">{u.user_name}</span>
                        <span className="report-tl-hrs">{u.total_hours} hrs</span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <p className="report-section-label">By Task</p>
                    {projReport.by_task.length === 0 && <p className="page-subtitle">No logs yet</p>}
                    {projReport.by_task.map((t: any) => (
                      <div key={t.task_id} className="report-tl-row">
                        <span className="report-tl-name">{t.task_title}</span>
                        <span className="report-tl-hrs">{t.total_hours} hrs</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
            {!projReport && !projLoading && <p className="page-subtitle" style={{ marginTop: 16 }}>Select a project and run report.</p>}
          </div>
        )}

        {/* PER EMPLOYEE */}
        {tab === 'per_employee' && (
          <div className="report-card report-card--full">
            <p className="report-card__title">Hours by Employee</p>
            <div className="report-filter-row">
              <select className="form-input" style={{ maxWidth: 260 }} value={selUserId}
                onChange={(e) => { setSelUserId(e.target.value ? Number(e.target.value) : ''); setUserReport(null); }}>
                <option value="">Select employee…</option>
                {teamUsers.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
              </select>
              <input type="date" className="form-input" style={{ maxWidth: 150 }} value={userFrom} onChange={(e) => setUserFrom(e.target.value)} />
              <input type="date" className="form-input" style={{ maxWidth: 150 }} value={userTo}   onChange={(e) => setUserTo(e.target.value)} />
              <button className="btn-secondary" onClick={loadUserReport} disabled={!selUserId || userLoading}>
                {userLoading ? 'Loading…' : 'Run report'}
              </button>
            </div>
            {userReport && (
              <>
                <div className="report-tl-summary"><span className="report-tl-total">{userReport.total_hours} hrs total</span></div>
                {userReport.by_project.length === 0 && <p className="page-subtitle" style={{ marginTop: 16 }}>No logs yet for this period.</p>}
                {userReport.by_project.map((p: any) => (
                  <div key={p.project_id} style={{ marginTop: 20 }}>
                    <div className="report-tl-project-header">
                      <span className="report-tl-project-name">{p.project_name}</span>
                      <span className="report-tl-hrs">{p.total_hours} hrs</span>
                    </div>
                    {p.tasks.map((t: any) => (
                      <div key={t.task_id} className="report-tl-row report-tl-row--indent">
                        <span className="report-tl-name">{t.task_title}</span>
                        <span className="report-tl-hrs">{t.total_hours} hrs</span>
                      </div>
                    ))}
                  </div>
                ))}
              </>
            )}
            {!userReport && !userLoading && <p className="page-subtitle" style={{ marginTop: 16 }}>Select an employee and run report.</p>}
          </div>
        )}

        {/* XLR8 BUCKET */}
        {tab === 'xlr8' && (
          <div className="report-card report-card--full">
            <p className="report-card__title">XLR8 Bucket Usage</p>
            <div className="report-filter-row">
              <select className="form-input" style={{ maxWidth: 300 }} value={xlr8ProjectId}
                onChange={(e) => { setXlr8ProjectId(e.target.value ? Number(e.target.value) : ''); setXlr8Report(null); }}>
                <option value="">Select XLR8 project…</option>
                {xlr8Projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button className="btn-secondary" onClick={loadXlr8} disabled={!xlr8ProjectId || xlr8Loading}>
                {xlr8Loading ? 'Loading…' : 'Load'}
              </button>
            </div>
            {xlr8Projects.length === 0 && (
              <p className="page-subtitle" style={{ marginTop: 16 }}>No XLR8 projects yet. Set service type to "XLR8" when creating a project.</p>
            )}
            {xlr8Report?.error && <p style={{ color: 'var(--red)', marginTop: 16 }}>{xlr8Report.error}</p>}
            {xlr8Report && !xlr8Report.error && (
              <div style={{ marginTop: 20 }}>
                <div className="report-xlr8-header">
                  <div>
                    <p className="report-xlr8-project">{xlr8Report.project_name}</p>
                    <p className="page-subtitle">Cycle: {xlr8Report.cycle_start} → {xlr8Report.cycle_end}</p>
                    {xlr8Report.rate_per_hour > 0 && (
                      <p className="page-subtitle">Rate: ₹{xlr8Report.rate_per_hour.toLocaleString('en-IN', { maximumFractionDigits: 2 })} / hr</p>
                    )}
                  </div>
                  <div className="report-xlr8-nums">
                    <span className="report-tl-total">{xlr8Report.hours_used} / {xlr8Report.monthly_hours_bucket} hrs</span>
                    {xlr8Report.budget_amount > 0 && (
                      <span className="page-subtitle">₹{xlr8Report.amount_spent.toLocaleString('en-IN')} spent · ₹{xlr8Report.amount_remaining.toLocaleString('en-IN')} left</span>
                    )}
                    <span className={`report-xlr8-pct${xlr8Report.warning ? ' report-xlr8-pct--warn' : ''}`}>
                      {xlr8Report.usage_pct}%{xlr8Report.warning ? ' ⚠ Approaching limit' : ''}
                    </span>
                  </div>
                </div>
                <div className="report-xlr8-bar-wrap">
                  <div
                    className={`report-xlr8-bar-fill${xlr8Report.usage_pct >= 100 ? ' report-xlr8-bar-fill--over' : xlr8Report.warning ? ' report-xlr8-bar-fill--warn' : ''}`}
                    style={{ width: `${Math.min(100, xlr8Report.usage_pct)}%` }}
                  />
                </div>
                <p className="page-subtitle" style={{ marginTop: 6 }}>{xlr8Report.hours_remaining} hrs remaining this cycle</p>
                {xlr8Report.logs.length > 0 && (
                  <div style={{ marginTop: 20 }}>
                    <p className="report-section-label">Log entries this cycle</p>
                    <div className="report-tl-log-list">
                      {xlr8Report.logs.map((l: any) => (
                        <div key={l.id} className="report-tl-row">
                          <div className="report-tl-avatar" style={{ background: l.user_color }}>
                            {l.user_name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
                          </div>
                          <span className="report-tl-name">{l.user_name}</span>
                          <span className="report-tl-task">{l.task_title}</span>
                          <span className="report-tl-date">{l.log_date}</span>
                          <span className="report-tl-hrs">{l.hours} hrs</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {!xlr8Report && !xlr8Loading && xlr8Projects.length > 0 && (
              <p className="page-subtitle" style={{ marginTop: 16 }}>Select an XLR8 project to view bucket usage.</p>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
