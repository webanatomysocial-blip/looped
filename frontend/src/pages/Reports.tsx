import { useEffect, useState } from 'react';
import Layout from '../components/Layout/Layout';
import { reportsApi, timeLogsApi, projectsApi, usersApi, tasksApi } from '../services/api';
import { ReportSummary, Project, User } from '../types';
import '../css/pages/Reports.css';

const STATUS_BAR_COLOR: Record<string, string> = {
  todo:        'var(--sand-border)',
  in_progress: 'var(--orange)',
  in_review:   'var(--blue)',
  overdue:     'var(--red)',
  completed:   'var(--green)',
};

const STATUS_LABEL: Record<string, string> = {
  todo: 'To Do', in_progress: 'In Progress', in_review: 'In Review',
  overdue: 'Overdue', completed: 'Completed',
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

  //  Project
  const [selProjectId, setSelProjectId] = useState<number | ''>('');
  const [projFrom, setProjFrom]         = useState('');
  const [projTo, setProjTo]             = useState('');
  const [projReport, setProjReport]     = useState<any>(null);
  const [projTasks, setProjTasks]       = useState<any[]>([]);
  const [projLoading, setProjLoading]   = useState(false);
  const [projLogOpen, setProjLogOpen]   = useState(false);

  // Per Employee
  const [selUserId, setSelUserId]     = useState<number | ''>('');
  const [userFrom, setUserFrom]       = useState('');
  const [userTo, setUserTo]           = useState('');
  const [userReport, setUserReport]   = useState<any>(null);
  const [userTasks, setUserTasks]     = useState<any[]>([]);
  const [userLoading, setUserLoading] = useState(false);
  const [userLogOpen, setUserLogOpen] = useState(false);

  // XLR8
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
    setProjLoading(true); setProjReport(null); setProjTasks([]); setProjLogOpen(false);
    Promise.all([
      timeLogsApi.byProject(Number(selProjectId), { from: projFrom || undefined, to: projTo || undefined }),
      tasksApi.list(Number(selProjectId)),
    ]).then(([r, t]) => {
      setProjReport(r.data);
      setProjTasks(t.data);
    }).finally(() => setProjLoading(false));
  };

  const loadUserReport = () => {
    if (!selUserId) return;
    setUserLoading(true); setUserReport(null); setUserTasks([]); setUserLogOpen(false);
    Promise.all([
      timeLogsApi.byUser(Number(selUserId), { from: userFrom || undefined, to: userTo || undefined }),
      tasksApi.list(),
    ]).then(([r, t]) => {
      setUserReport(r.data);
      const uid = Number(selUserId);
      setUserTasks(t.data.filter((tk: any) =>
        tk.assigned_to === uid || (tk.assignees || []).some((a: any) => Number(a.user_id) === uid)
      ));
    }).finally(() => setUserLoading(false));
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
  const nonXlr8Projects = projects.filter(p => p.service_type !== 'xlr8');
  const teamUsers = users.filter(u => u.role !== 'client');

  // Task status counts helper
  const taskStatusCounts = (tasks: any[]) => {
    const counts: Record<string, number> = {};
    for (const t of tasks) counts[t.status] = (counts[t.status] || 0) + 1;
    return counts;
  };

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
                        <span className="report-bar-row__name">{STATUS_LABEL[status] || status}</span>
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

        {/*  PROJECT */}
        {tab === 'per_project' && (
          <div className="report-card report-card--full">
            <p className="report-card__title"> Project Report</p>
            <div className="report-filter-row">
              <select className="form-input" style={{ maxWidth: 260 }} value={selProjectId}
                onChange={(e) => { setSelProjectId(e.target.value ? Number(e.target.value) : ''); setProjReport(null); setProjTasks([]); }}>
                <option value="">Select project…</option>
                {nonXlr8Projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input type="date" className="form-input" style={{ maxWidth: 150 }} value={projFrom} onChange={(e) => setProjFrom(e.target.value)} placeholder="From" />
              <input type="date" className="form-input" style={{ maxWidth: 150 }} value={projTo}   onChange={(e) => setProjTo(e.target.value)} placeholder="To" />
              <button className="btn-secondary" onClick={loadProjReport} disabled={!selProjectId || projLoading}>
                {projLoading ? 'Loading…' : 'Run Report'}
              </button>
            </div>

            {!projReport && !projLoading && (
              <p className="page-subtitle" style={{ marginTop: 16 }}>Select a project and run report.</p>
            )}

            {projReport && (() => {
              const counts = taskStatusCounts(projTasks);
              const totalTasks = projTasks.length;
              const completedCount = counts['completed'] || 0;
              const pct = totalTasks ? Math.round((completedCount / totalTasks) * 100) : 0;
              return (
                <>
                  {/* Summary KPI row */}
                  <div className="rp-kpi-row">
                    <div className="rp-kpi">
                      <span className="rp-kpi__val">{projReport.total_hours} <small>hrs</small></span>
                      <span className="rp-kpi__label">Total Hours Logged</span>
                    </div>
                    {projReport.total_spend > 0 && (
                      <div className="rp-kpi">
                        <span className="rp-kpi__val">₹{projReport.total_spend.toLocaleString('en-IN')}</span>
                        <span className="rp-kpi__label">Total Spend</span>
                      </div>
                    )}
                    <div className="rp-kpi">
                      <span className="rp-kpi__val">{totalTasks}</span>
                      <span className="rp-kpi__label">Total Tasks</span>
                    </div>
                    <div className="rp-kpi">
                      <span className="rp-kpi__val" style={{ color: 'var(--green)' }}>{completedCount}</span>
                      <span className="rp-kpi__label">Completed</span>
                    </div>
                    <div className="rp-kpi">
                      <span className="rp-kpi__val">{pct}%</span>
                      <span className="rp-kpi__label">Completion Rate</span>
                    </div>
                    <div className="rp-kpi">
                      <span className="rp-kpi__val" style={{ color: 'var(--red)' }}>{counts['overdue'] || 0}</span>
                      <span className="rp-kpi__label">Overdue</span>
                    </div>
                  </div>

                  {/* Progress bar */}
                  {totalTasks > 0 && (
                    <div style={{ marginBottom: 24 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--ink-muted)', marginBottom: 6 }}>
                        <span>Overall Completion</span><span>{completedCount}/{totalTasks} tasks</span>
                      </div>
                      <div className="report-bar-wrap" style={{ height: 10 }}>
                        <div className="report-bar-fill" style={{ width: `${pct}%`, background: 'var(--green)' }} />
                      </div>
                    </div>
                  )}

                  {/* Task status breakdown */}
                  {totalTasks > 0 && (
                    <div style={{ marginBottom: 28 }}>
                      <p className="report-section-label">Task Status Breakdown</p>
                      <div className="rp-status-grid">
                        {Object.entries(counts).map(([status, count]) => (
                          <div key={status} className="rp-status-chip" style={{ borderColor: STATUS_BAR_COLOR[status] }}>
                            <span className="rp-status-chip__dot" style={{ background: STATUS_BAR_COLOR[status] }} />
                            <span className="rp-status-chip__label">{STATUS_LABEL[status] || status}</span>
                            <span className="rp-status-chip__count">{count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28, marginBottom: 28 }}>
                    {/* By Employee */}
                    <div>
                      <p className="report-section-label">Hours by Team Member</p>
                      {projReport.by_user.length === 0
                        ? <p className="page-subtitle">No time logged yet</p>
                        : projReport.by_user.sort((a: any, b: any) => b.total_hours - a.total_hours).map((u: any) => (
                          <div key={u.user_id} className="rp-member-row">
                            <div className="report-tl-avatar" style={{ background: u.user_color }}>
                              {u.user_name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                <span className="report-tl-name" style={{ flex: 'unset' }}>{u.user_name}</span>
                                <span className="report-tl-hrs">{u.total_hours} hrs</span>
                              </div>
                              {projReport.total_hours > 0 && (
                                <div className="report-bar-wrap" style={{ height: 5 }}>
                                  <div className="report-bar-fill" style={{ width: `${Math.round((u.total_hours / projReport.total_hours) * 100)}%`, background: 'var(--orange)' }} />
                                </div>
                              )}
                              {u.total_cost > 0 && (
                                <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>₹{u.total_cost.toLocaleString('en-IN')} cost</span>
                              )}
                            </div>
                          </div>
                        ))
                      }
                    </div>

                    {/* By Task */}
                    <div>
                      <p className="report-section-label">Hours by Task</p>
                      {projReport.by_task.length === 0
                        ? <p className="page-subtitle">No time logged yet</p>
                        : projReport.by_task.sort((a: any, b: any) => b.total_hours - a.total_hours).map((t: any) => {
                          const taskInfo = projTasks.find((tk: any) => tk.id === t.task_id);
                          return (
                            <div key={t.task_id} className="rp-task-row">
                              <div style={{ flex: 1 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                                  <span className="report-tl-name" style={{ flex: 'unset', fontSize: 12 }}>{t.task_title}</span>
                                  <span className="report-tl-hrs">{t.total_hours} hrs</span>
                                </div>
                                {taskInfo && (
                                  <span className="rp-status-badge" style={{ background: STATUS_BAR_COLOR[taskInfo.status] + '22', color: STATUS_BAR_COLOR[taskInfo.status] }}>
                                    {STATUS_LABEL[taskInfo.status] || taskInfo.status}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })
                      }
                    </div>
                  </div>

                  {/* Full Log Entries */}
                  {projReport.logs.length > 0 && (
                    <div>
                      <button
                        className="rp-toggle-btn"
                        onClick={() => setProjLogOpen(v => !v)}
                      >
                        {projLogOpen ? '▾' : '▸'} All Log Entries ({projReport.logs.length})
                      </button>
                      {projLogOpen && (
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
                              {projReport.logs.map((l: any) => (
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
                      )}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}

        {/* PER EMPLOYEE */}
        {tab === 'per_employee' && (
          <div className="report-card report-card--full">
            <p className="report-card__title">Per Employee Report</p>
            <div className="report-filter-row">
              <select className="form-input" style={{ maxWidth: 260 }} value={selUserId}
                onChange={(e) => { setSelUserId(e.target.value ? Number(e.target.value) : ''); setUserReport(null); setUserTasks([]); }}>
                <option value="">Select employee…</option>
                {teamUsers.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
              </select>
              <input type="date" className="form-input" style={{ maxWidth: 150 }} value={userFrom} onChange={(e) => setUserFrom(e.target.value)} />
              <input type="date" className="form-input" style={{ maxWidth: 150 }} value={userTo}   onChange={(e) => setUserTo(e.target.value)} />
              <button className="btn-secondary" onClick={loadUserReport} disabled={!selUserId || userLoading}>
                {userLoading ? 'Loading…' : 'Run Report'}
              </button>
            </div>

            {!userReport && !userLoading && (
              <p className="page-subtitle" style={{ marginTop: 16 }}>Select an employee and run report.</p>
            )}

            {userReport && (() => {
              const counts = taskStatusCounts(userTasks);
              const totalTasks = userTasks.length;
              const completedCount = counts['completed'] || 0;
              const pct = totalTasks ? Math.round((completedCount / totalTasks) * 100) : 0;
              const selectedUser = teamUsers.find(u => u.id === Number(selUserId));
              return (
                <>
                  {/* Employee header */}
                  {selectedUser && (
                    <div className="rp-emp-header">
                      <div className="report-tl-avatar" style={{ background: selectedUser.avatar_color, width: 48, height: 48, fontSize: 16 }}>
                        {selectedUser.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
                      </div>
                      <div>
                        <p style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink)', marginBottom: 2 }}>{selectedUser.name}</p>
                        <p style={{ fontSize: 12, color: 'var(--ink-muted)', textTransform: 'capitalize' }}>{selectedUser.role}{selectedUser.pod ? ` · ${selectedUser.pod}` : ''}</p>
                      </div>
                    </div>
                  )}

                  {/* KPI row */}
                  <div className="rp-kpi-row">
                    <div className="rp-kpi">
                      <span className="rp-kpi__val">{userReport.total_hours} <small>hrs</small></span>
                      <span className="rp-kpi__label">Hours Logged</span>
                    </div>
                    <div className="rp-kpi">
                      <span className="rp-kpi__val">{userReport.by_project.length}</span>
                      <span className="rp-kpi__label">Projects</span>
                    </div>
                    <div className="rp-kpi">
                      <span className="rp-kpi__val">{totalTasks}</span>
                      <span className="rp-kpi__label">Tasks Assigned</span>
                    </div>
                    <div className="rp-kpi">
                      <span className="rp-kpi__val" style={{ color: 'var(--green)' }}>{completedCount}</span>
                      <span className="rp-kpi__label">Completed</span>
                    </div>
                    <div className="rp-kpi">
                      <span className="rp-kpi__val">{pct}%</span>
                      <span className="rp-kpi__label">Completion Rate</span>
                    </div>
                    <div className="rp-kpi">
                      <span className="rp-kpi__val" style={{ color: 'var(--red)' }}>{counts['overdue'] || 0}</span>
                      <span className="rp-kpi__label">Overdue</span>
                    </div>
                  </div>

                  {/* Task status breakdown */}
                  {totalTasks > 0 && (
                    <div style={{ marginBottom: 28 }}>
                      <p className="report-section-label">Task Status Breakdown</p>
                      <div className="rp-status-grid">
                        {Object.entries(counts).map(([status, count]) => (
                          <div key={status} className="rp-status-chip" style={{ borderColor: STATUS_BAR_COLOR[status] }}>
                            <span className="rp-status-chip__dot" style={{ background: STATUS_BAR_COLOR[status] }} />
                            <span className="rp-status-chip__label">{STATUS_LABEL[status] || status}</span>
                            <span className="rp-status-chip__count">{count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* By Project */}
                  {userReport.by_project.length === 0
                    ? <p className="page-subtitle" style={{ marginTop: 16 }}>No time logs for this period.</p>
                    : (
                      <div style={{ marginBottom: 28 }}>
                        <p className="report-section-label">Hours by Project</p>
                        {userReport.by_project.map((p: any) => (
                          <div key={p.project_id} style={{ marginBottom: 20 }}>
                            <div className="rp-proj-header">
                              <span className="report-tl-project-name">{p.project_name}</span>
                              <span className="report-tl-hrs">{p.total_hours} hrs</span>
                            </div>
                            {p.tasks.sort((a: any, b: any) => b.total_hours - a.total_hours).map((t: any) => {
                              const taskInfo = userTasks.find((tk: any) => tk.id === t.task_id);
                              return (
                                <div key={t.task_id} className="report-tl-row report-tl-row--indent">
                                  <div style={{ flex: 1 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                      <span className="report-tl-name" style={{ flex: 'unset', fontSize: 12 }}>{t.task_title}</span>
                                      {taskInfo && (
                                        <span className="rp-status-badge" style={{ background: STATUS_BAR_COLOR[taskInfo.status] + '22', color: STATUS_BAR_COLOR[taskInfo.status] }}>
                                          {STATUS_LABEL[taskInfo.status] || taskInfo.status}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <span className="report-tl-hrs">{t.total_hours} hrs</span>
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    )
                  }

                  {/* Full Log Entries */}
                  {userReport.logs && userReport.logs.length > 0 && (
                    <div>
                      <button className="rp-toggle-btn" onClick={() => setUserLogOpen(v => !v)}>
                        {userLogOpen ? '▾' : '▸'} All Log Entries ({userReport.logs.length})
                      </button>
                      {userLogOpen && (
                        <div className="rp-log-table-wrap">
                          <table className="rp-log-table">
                            <thead>
                              <tr>
                                <th>Date</th>
                                <th>Project</th>
                                <th>Task</th>
                                <th>Hours</th>
                                <th>Notes</th>
                              </tr>
                            </thead>
                            <tbody>
                              {userReport.logs.map((l: any) => (
                                <tr key={l.id}>
                                  <td>{l.log_date}</td>
                                  <td>{l.project_name}</td>
                                  <td>{l.task_title}</td>
                                  <td style={{ fontWeight: 700 }}>{l.hours}</td>
                                  <td style={{ color: 'var(--ink-muted)' }}>{l.notes || '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </>
              );
            })()}
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
                {/* Project + cycle header */}
                <div className="report-xlr8-header">
                  <div>
                    <p className="report-xlr8-project">{xlr8Report.project_name}</p>
                    {xlr8Report.client_name && <p className="page-subtitle">{xlr8Report.client_name}</p>}
                    <p className="page-subtitle" style={{ marginTop: 4 }}>Billing cycle: {xlr8Report.cycle_start} → {xlr8Report.cycle_end}</p>
                  </div>
                  <div className="report-xlr8-nums">
                    {xlr8Report.rate_per_hour > 0 && (
                      <span className="page-subtitle">₹{xlr8Report.rate_per_hour.toLocaleString('en-IN', { maximumFractionDigits: 2 })} / hr</span>
                    )}
                    {xlr8Report.budget_amount > 0 && (
                      <span className="page-subtitle">Budget: ₹{xlr8Report.budget_amount.toLocaleString('en-IN')}</span>
                    )}
                  </div>
                </div>

                {/* KPI row */}
                <div className="rp-kpi-row" style={{ marginBottom: 20 }}>
                  <div className="rp-kpi">
                    <span className="rp-kpi__val">{xlr8Report.monthly_hours_bucket} <small>hrs</small></span>
                    <span className="rp-kpi__label">Monthly Bucket</span>
                  </div>
                  <div className="rp-kpi">
                    <span className="rp-kpi__val" style={{ color: xlr8Report.warning ? 'var(--orange)' : 'var(--ink)' }}>{xlr8Report.hours_used} <small>hrs</small></span>
                    <span className="rp-kpi__label">Hours Used</span>
                  </div>
                  <div className="rp-kpi">
                    <span className="rp-kpi__val" style={{ color: 'var(--green)' }}>{xlr8Report.hours_remaining} <small>hrs</small></span>
                    <span className="rp-kpi__label">Remaining</span>
                  </div>
                  <div className="rp-kpi">
                    <span className="rp-kpi__val" style={{ color: xlr8Report.usage_pct >= 100 ? 'var(--red)' : xlr8Report.warning ? 'var(--orange)' : 'var(--ink)' }}>
                      {xlr8Report.usage_pct}%
                    </span>
                    <span className="rp-kpi__label">Usage</span>
                  </div>
                  {xlr8Report.budget_amount > 0 && (
                    <>
                      <div className="rp-kpi">
                        <span className="rp-kpi__val">₹{xlr8Report.amount_spent.toLocaleString('en-IN')}</span>
                        <span className="rp-kpi__label">Amount Spent</span>
                      </div>
                      <div className="rp-kpi">
                        <span className="rp-kpi__val" style={{ color: 'var(--green)' }}>₹{xlr8Report.amount_remaining.toLocaleString('en-IN')}</span>
                        <span className="rp-kpi__label">Remaining Budget</span>
                      </div>
                    </>
                  )}
                </div>

                {/* Usage bar */}
                <div style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--ink-muted)', marginBottom: 6 }}>
                    <span>Bucket Usage</span>
                    <span>{xlr8Report.hours_used} / {xlr8Report.monthly_hours_bucket} hrs {xlr8Report.usage_pct >= 100 ? '🔴 Over limit' : xlr8Report.warning ? '⚠ Approaching limit' : ''}</span>
                  </div>
                  <div className="report-xlr8-bar-wrap" style={{ height: 14 }}>
                    <div
                      className={`report-xlr8-bar-fill${xlr8Report.usage_pct >= 100 ? ' report-xlr8-bar-fill--over' : xlr8Report.warning ? ' report-xlr8-bar-fill--warn' : ''}`}
                      style={{ width: `${Math.min(100, xlr8Report.usage_pct)}%` }}
                    />
                  </div>
                </div>

                {/* Per-employee breakdown */}
                {xlr8Report.logs.length > 0 && (() => {
                  const byEmp: Record<string, { name: string; color: string; hours: number }> = {};
                  for (const l of xlr8Report.logs) {
                    if (!byEmp[l.user_id]) byEmp[l.user_id] = { name: l.user_name, color: l.user_color, hours: 0 };
                    byEmp[l.user_id].hours += Number(l.hours);
                  }
                  const empList = Object.values(byEmp).sort((a, b) => b.hours - a.hours);
                  return (
                    <div style={{ marginTop: 28, marginBottom: 28 }}>
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
                            {xlr8Report.hours_used > 0 && (
                              <div className="report-bar-wrap" style={{ height: 5 }}>
                                <div className="report-bar-fill" style={{ width: `${Math.round((e.hours / xlr8Report.hours_used) * 100)}%`, background: 'var(--orange)' }} />
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* Log entries */}
                {xlr8Report.logs.length > 0 && (
                  <div>
                    <p className="report-section-label">Log Entries This Cycle ({xlr8Report.logs.length})</p>
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
                          {xlr8Report.logs.map((l: any) => (
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

                {xlr8Report.logs.length === 0 && (
                  <p className="page-subtitle" style={{ marginTop: 16 }}>No time logs recorded this cycle yet.</p>
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
