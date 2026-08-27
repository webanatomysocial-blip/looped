import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Users } from 'lucide-react';
import Layout from '../components/Layout/Layout';
import Pagination from '../components/UI/Pagination';

const PAGE_SIZE = 6;
import Avatar from '../components/UI/Avatar';
import { capacityApi } from '../services/api';
import { TeamMemberCapacity } from '../types';
import { useAuth } from '../contexts/AuthContext';
import '../css/pages/Home.css';
import '../css/pages/TeamCapacity.css';

function fmtHrs(sec: number) {
  return (sec / 3600).toFixed(1);
}

function fmtSeconds(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const roleColor = (role: string) =>
  role === 'manager' ? '#7c3aed' : role === 'admin' ? 'var(--orange)' : 'var(--blue)';

export default function TeamCapacityPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [team, setTeam] = useState<TeamMemberCapacity[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [podTab, setPodTab] = useState<'all' | 'pod1' | 'pod2'>('all');
  const [page, setPage] = useState(1);
  const [dateFilter, setDateFilter] = useState('');
  const [showOverdue, setShowOverdue] = useState(false);

  const load = useCallback(async (pod?: 'pod1' | 'pod2', date?: string, overdue?: boolean) => {
    try {
      const res = await capacityApi.team(pod, date || undefined, overdue);
      setTeam(res.data);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const pod = isAdmin && podTab !== 'all' ? podTab : undefined;
    load(pod, showOverdue ? undefined : dateFilter, showOverdue);
    const poll = setInterval(() => load(pod, showOverdue ? undefined : dateFilter, showOverdue), 30000);
    return () => clearInterval(poll);
  }, [load, podTab, isAdmin, dateFilter, showOverdue]);

  const totalPages  = Math.max(1, Math.ceil(team.length / PAGE_SIZE));
  const paginated   = team.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const activeCount = team.filter((m) => m.active_task_id !== null).length;
  const totalTracked = team.reduce((s, m) => s + m.tracked_seconds, 0);
  const totalTasks   = team.reduce((s, m) => s + m.tasks.length, 0);

  return (
    <Layout>
      <div className="page-wrap">

        {/* Page header */}
        <div className="tc-page-header">
          <div>
            <h2 className="page-title">Team Capacity</h2>
            <p className="page-subtitle">
              {showOverdue
                ? 'Tasks past their due date'
                : dateFilter
                  ? new Date(dateFilter + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
                  : new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              {!loading && !dateFilter && !showOverdue && ` · ${activeCount} of ${team.length} members working now`}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {isAdmin && (
              <div className="filter-bar">
                {(['all', 'pod1', 'pod2'] as const).map((p) => (
                  <button
                    key={p}
                    className={`filter-tab${podTab === p ? ' active' : ''}`}
                    onClick={() => { setPodTab(p); setPage(1); }}
                  >
                    {p === 'all' ? 'All' : p === 'pod1' ? 'Pod 1' : 'Pod 2'}
                  </button>
                ))}
              </div>
            )}
            <button
              className={`filter-tab${showOverdue ? ' active' : ''}`}
              style={{ padding: '7px 12px', fontSize: 12, color: showOverdue ? '#dc2626' : undefined, borderColor: showOverdue ? '#dc2626' : undefined }}
              onClick={() => { setShowOverdue(!showOverdue); setPage(1); }}
            >
              Overdue
            </button>
            {!showOverdue && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="date"
                  className="form-input"
                  style={{ width: 150, fontSize: 12, padding: '7px 12px' }}
                  value={dateFilter}
                  onChange={(e) => { setDateFilter(e.target.value); setPage(1); }}
                />
                {dateFilter && (
                  <button
                    className="filter-tab"
                    style={{ padding: '7px 10px', fontSize: 11 }}
                    onClick={() => { setDateFilter(''); setPage(1); }}
                  >
                    ✕
                  </button>
                )}
              </div>
            )}
            <button className="btn-secondary tc-refresh-btn" onClick={() => load(isAdmin && podTab !== 'all' ? podTab : undefined, showOverdue ? undefined : dateFilter, showOverdue)}>
              <RefreshCw size={13} /> Refresh
            </button>
          </div>
        </div>

        {/* Summary strip */}
        {!loading && team.length > 0 && (
          <div className="card tc-summary">
            <div className="tc-summary-stat">
              <span className="tc-summary-dot" style={{ background: activeCount > 0 ? 'var(--green)' : 'var(--sand-border)', animationPlayState: activeCount > 0 ? 'running' : 'paused' }} />
              <span className="tc-summary-val">{activeCount}</span>
              <span className="tc-summary-lbl">Active now</span>
            </div>
            <div className="tc-summary-div" />
            <div className="tc-summary-stat">
              <span className="tc-summary-val">{team.length}</span>
              <span className="tc-summary-lbl">Team members</span>
            </div>
            <div className="tc-summary-div" />
            <div className="tc-summary-stat">
              <span className="tc-summary-val">{fmtHrs(totalTracked)}<span className="tc-summary-unit"> hrs</span></span>
              <span className="tc-summary-lbl">Tracked today (total)</span>
            </div>
            <div className="tc-summary-div" />
            <div className="tc-summary-stat">
              <span className="tc-summary-val">{totalTasks}</span>
              <span className="tc-summary-lbl">Open tasks</span>
            </div>
          </div>
        )}

        {loading && <p className="page-subtitle" style={{ marginTop: 32, textAlign: 'center' }}>Loading team data…</p>}

        {!loading && team.length === 0 && (
          <div className="card" style={{ padding: '56px 24px', textAlign: 'center' }}>
            <Users size={36} style={{ color: 'var(--sand-border)', marginBottom: 10 }} />
            <p className="page-subtitle">No team members found</p>
          </div>
        )}

        {/* Team list */}
        {!loading && team.length > 0 && (
          <div className="card tc-list">
            {/* Table header */}
            <div className="tc-list-header">
              <div className="tc-col-member">Member</div>
              <div className="tc-col-active">Active Task</div>
              <div className="tc-col-bar">Today's Progress</div>
              <div className="tc-col-hrs">Tracked</div>
              <div className="tc-col-tasks">Tasks</div>
            </div>

            {paginated.map((member, idx) => {
              const pct = Math.min(100, (member.tracked_seconds / member.capacity_seconds) * 100);
              const barClass = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok';
              const isExpanded = expanded === member.user_id;
              const isLast = idx === paginated.length - 1;

              return (
                <div key={member.user_id}>
                  {/* Member row */}
                  <div
                    className={`tc-member-row${member.tasks.length > 0 ? ' tc-member-row--clickable' : ''}${isExpanded ? ' tc-member-row--expanded' : ''}`}
                    style={{ borderBottom: isExpanded || !isLast ? '1px solid var(--bg-sand-lt)' : 'none' }}
                    onClick={() => member.tasks.length > 0 && setExpanded(isExpanded ? null : member.user_id)}
                  >
                    {/* Member column */}
                    <div className="tc-col-member">
                      <Avatar name={member.name} color={member.avatar_color} size="md" />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          {member.name}
                          <span className="tc-role-chip" style={{ background: roleColor(member.role) + '22', color: roleColor(member.role) }}>
                            {member.role}
                          </span>
                          {member.pod && (
                            <span className="tc-role-chip" style={{ background: member.pod === 'pod1' ? '#e0f2fe' : '#fce7f3', color: member.pod === 'pod1' ? '#0369a1' : '#9d174d' }}>
                              {member.pod === 'pod1' ? 'Pod 1' : 'Pod 2'}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 1 }}>
                          {member.tasks.length} task{member.tasks.length !== 1 ? 's' : ''} assigned
                        </div>
                      </div>
                    </div>

                    {/* Active task column */}
                    <div className="tc-col-active">
                      {member.active_task_title ? (
                        <div className="tc-active-task">
                          <span className="tc-active-dot" />
                          <span className="tc-active-title">{member.active_task_title}</span>
                        </div>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--sand-border)' }}>—</span>
                      )}
                    </div>

                    {/* Capacity bar column */}
                    <div className="tc-col-bar">
                      <div className="cap-bar-track">
                        <div className={`cap-bar-fill cap-bar-fill--${barClass}`} style={{ width: `${pct}%` }} />
                      </div>
                      <div className="tc-bar-labels">
                        <span>0</span>
                        <span style={{ color: pct >= 100 ? 'var(--red, #e53e3e)' : pct >= 80 ? 'var(--orange)' : 'var(--ink-muted)', fontWeight: pct >= 80 ? 700 : 400 }}>
                          {pct.toFixed(0)}%{pct >= 100 && ' OT'}
                        </span>
                        <span>7h</span>
                      </div>
                    </div>

                    {/* Hrs column */}
                    <div className="tc-col-hrs">
                      <span className="tc-hrs-val">{fmtHrs(member.tracked_seconds)}</span>
                      <span className="tc-hrs-unit">/ 7 hrs</span>
                    </div>

                    {/* Tasks expand column */}
                    <div className="tc-col-tasks">
                      {member.tasks.length > 0 && (
                        <span className="tc-expand-hint">
                          {member.tasks.length} {isExpanded ? '▲' : '▼'}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Expanded tasks */}
                  {isExpanded && (
                    <div className="tc-tasks-expanded">
                      {member.tasks.map((task, ti) => {
                        const displayEstHours = task.ticket_type_id ? (task.stage_est_hours ?? null) : task.estimated_hours;
                        const estSec = (displayEstHours ?? 0) * 3600;
                        const tp = estSec > 0 ? Math.min(100, (task.tracked_seconds_today / estSec) * 100) : 0;
                        const isTaskLast = ti === member.tasks.length - 1;
                        return (
                          <div key={task.id} className="tc-task-row" style={{ borderBottom: isTaskLast ? 'none' : '1px solid var(--bg-sand-lt)' }}>
                            <div className="tc-task-indicator">
                              {task.timer_running
                                ? <span className="tc-task-running-dot" />
                                : <span className="tc-task-idle-dot" />
                              }
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)' }}>{task.title}</div>
                              <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 1 }}>{task.project_name}</div>
                              {estSec > 0 && (
                                <div className="cap-bar-track" style={{ height: 4, marginTop: 6, maxWidth: 200 }}>
                                  <div className={`cap-bar-fill cap-bar-fill--${tp >= 100 ? 'over' : tp >= 80 ? 'warn' : 'ok'}`} style={{ width: `${tp}%` }} />
                                </div>
                              )}
                            </div>
                            <div className="tc-task-meta">
                              <div style={{ fontWeight: 700, color: 'var(--ink)', fontSize: 12 }}>{fmtSeconds(task.tracked_seconds_today)}</div>
                              {displayEstHours && <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{Math.floor(displayEstHours)}h {Math.round((displayEstHours % 1) * 60)}m est.</div>}
                              <div className={`tc-task-status tc-task-status--${task.acceptance_status}`}>
                                {task.acceptance_status}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <Pagination page={page} totalPages={totalPages} total={team.length} pageSize={PAGE_SIZE} onPage={setPage} />
      </div>
    </Layout>
  );
}
