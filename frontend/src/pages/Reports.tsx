import { useEffect, useState } from 'react';
import Layout from '../components/Layout/Layout';
import Header from '../components/Layout/Header';
import { reportsApi } from '../services/api';
import { ReportSummary } from '../types';
import '../css/pages/Reports.css';

const STATUS_BAR_COLOR: Record<string, string> = {
  todo:        'var(--sand-border)',
  in_progress: 'var(--orange)',
  in_review:   'var(--blue)',
  overdue:     'var(--red)',
  completed:   'var(--green)',
};

const STAT_VARIANT = ['yellow', 'green', 'blue', 'green', 'orange', 'purple'];

export default function Reports() {
  const [summary, setSummary]                 = useState<ReportSummary | null>(null);
  const [tasksByStatus, setTasksByStatus]     = useState<{ status: string; count: number }[]>([]);
  const [projectsByClient, setProjectsByClient] = useState<{ client: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([reportsApi.summary(), reportsApi.tasksByStatus(), reportsApi.projectsByClient()])
      .then(([s, t, p]) => { setSummary(s.data); setTasksByStatus(t.data); setProjectsByClient(p.data); })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Layout><div className="empty-state">Loading…</div></Layout>;

  const completionRate = summary
    ? Math.round((Number(summary.completed_tasks) / Math.max(Number(summary.total_tasks), 1)) * 100)
    : 0;

  const stats = [
    { label: 'Total projects',    value: summary?.total_projects },
    { label: 'Active projects',   value: summary?.active_projects },
    { label: 'Total tasks',       value: summary?.total_tasks },
    { label: 'Completed tasks',   value: summary?.completed_tasks },
    { label: 'Pending approvals', value: summary?.pending_approvals },
    { label: 'Team members',      value: summary?.total_users },
  ];

  const circ = 2 * Math.PI * 44;

  return (
    <Layout>
      <div className="page-wrap">
        <Header />
        <div style={{ marginBottom: 20 }}>
          <h2 className="page-title">Reports</h2>
          <p className="page-subtitle">Overview of your agency's performance</p>
        </div>

        {/* Stat cards */}
        <div className="reports-stats">
          {stats.map(({ label, value }, i) => (
            <div key={label} className={`report-stat-card report-stat-card--${STAT_VARIANT[i]}`}>
              <p className="report-stat-card__label">{label}</p>
              <p className="report-stat-card__value">{value ?? 0}</p>
            </div>
          ))}
        </div>

        <div className="reports-charts">
          {/* Completion ring */}
          <div className="report-card">
            <p className="report-card__title">Task Completion</p>
            <div className="report-ring-wrap">
              <div className="report-ring">
                <svg width="110" height="110" style={{ transform: 'rotate(-90deg)' }}>
                  <circle cx="55" cy="55" r="44" fill="none" stroke="#E8E0D0" strokeWidth="10" />
                  <circle
                    cx="55" cy="55" r="44" fill="none" stroke="var(--orange)" strokeWidth="10"
                    strokeLinecap="round"
                    strokeDasharray={`${circ * completionRate / 100} ${circ * (1 - completionRate / 100)}`}
                  />
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

          {/* Tasks by status */}
          <div className="report-card">
            <p className="report-card__title">Tasks by Status</p>
            {tasksByStatus.map(({ status, count }) => {
              const total = tasksByStatus.reduce((s, t) => s + Number(t.count), 0);
              const pct   = total ? Math.round((Number(count) / total) * 100) : 0;
              return (
                <div key={status} className="report-bar-row">
                  <div className="report-bar-row__labels">
                    <span className="report-bar-row__name">{status.replace('_', ' ')}</span>
                    <span className="report-bar-row__count">{count} ({pct}%)</span>
                  </div>
                  <div className="report-bar-wrap">
                    <div
                      className="report-bar-fill"
                      style={{ width: `${pct}%`, background: STATUS_BAR_COLOR[status] ?? 'var(--sand-border)' }}
                    />
                  </div>
                </div>
              );
            })}
            {tasksByStatus.length === 0 && <p className="page-subtitle">No data yet</p>}
          </div>

          {/* Projects by client */}
          <div className="report-card report-card--full">
            <p className="report-card__title">Projects by Client</p>
            {projectsByClient.length === 0 ? (
              <p className="page-subtitle">No data yet</p>
            ) : (
              projectsByClient.map(({ client, count }) => {
                const max = Math.max(...projectsByClient.map((p) => Number(p.count)));
                const pct = Math.round((Number(count) / max) * 100);
                return (
                  <div key={client} className="client-bar-row">
                    <span className="client-bar-row__name">{client || 'No client'}</span>
                    <div className="client-bar-row__track">
                      <div className="client-bar-row__fill" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="client-bar-row__count">{count}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
