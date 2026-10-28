import { useEffect, useState, useCallback } from 'react';
import TaskViewDrawer from '../components/UI/TaskViewDrawer';
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
import { fmtDate } from '../utils/date';

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

type Period = 'today' | '7d' | '30d' | 'custom';
type SubTab = 'capacity' | 'reworks' | 'escalations' | 'assigned' | 'pending';
type Item = { id: number; title: string; project_name: string | null; due_date: string | null; status: string; stage?: string | null; at?: number; by?: string | null; reason?: string | null; kind?: 'overdue' | 'late' | 'overtime'; days_late?: number; over_seconds?: number; estimate_seconds?: number; accepted?: boolean; seconds?: number };
interface MemberStats {
  user_id: number; name: string; avatar_color: string; avatar_url?: string; role: string; pod: string | null;
  capacity: { logged_seconds: number; available_hours: number; by_day: { date: string; seconds: number }[]; by_task: Item[] };
  reworks: Item[]; escalations: Item[]; assigned: Item[]; pending: Item[];
}
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };
const PERIODS: { key: Period; label: string }[] = [{ key: 'today', label: 'Today' }, { key: '7d', label: 'Last 7 days' }, { key: '30d', label: 'Last 30 days' }, { key: 'custom', label: 'Custom' }];
const fmtDur = (sec: number) => { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), x = sec % 60; return h ? `${h}h ${m}m` : m ? `${m}m ${x}s` : `${x}s`; };
const hrs = (sec: number) => (sec < 3600 ? `${Math.round(sec / 60)}m` : `${(sec / 3600).toFixed(1)}h`);

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
  const [period, setPeriod] = useState<Period>('today');
  const [customFrom, setCustomFrom] = useState(daysAgo(7));
  const [customTo, setCustomTo] = useState(ymd(new Date()));
  const [stats, setStats] = useState<MemberStats[] | null>(null);
  const [statsError, setStatsError] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [subTab, setSubTab] = useState<SubTab>('capacity');
  const [viewTask, setViewTask] = useState<number | null>(null);
  const range = period === 'today' ? [ymd(new Date()), ymd(new Date())] : period === '7d' ? [daysAgo(6), ymd(new Date())] : period === '30d' ? [daysAgo(29), ymd(new Date())] : [customFrom, customTo];
  const customInvalid = period === 'custom' && (!customFrom || !customTo || customTo < customFrom);
  const dateFilter = '';
  const showOverdue = false;

  const load = useCallback(async (pod?: 'pod1' | 'pod2', date?: string, overdue?: boolean) => {
    try {
      const res = await capacityApi.team(pod, date || undefined, overdue);
      setTeam(res.data);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  const loadStats = useCallback(async () => {
    if (customInvalid) return;
    const pod = isAdmin && podTab !== 'all' ? podTab : undefined;
    try { const r = await capacityApi.teamStats(range[0], range[1], pod); setStats(r.data.members); setStatsError(''); }
    catch (e: any) { setStatsError(e?.response?.data?.error || "Couldn't load team stats"); }
  }, [range[0], range[1], podTab, isAdmin, customInvalid]);
  useEffect(() => { setStats(null); loadStats(); const t = setInterval(loadStats, 30000); return () => clearInterval(t); }, [loadStats]);
  useEffect(() => {
    if (stats?.length && !stats.some((m) => m.user_id === selectedId)) setSelectedId(stats[0].user_id);
  }, [stats]);

  useEffect(() => {
    const pod = isAdmin && podTab !== 'all' ? podTab : undefined;
    load(pod, showOverdue ? undefined : dateFilter, showOverdue);
    const poll = setInterval(() => load(pod, showOverdue ? undefined : dateFilter, showOverdue), 30000);
    return () => clearInterval(poll);
  }, [load, podTab, isAdmin, dateFilter, showOverdue]);

  const totalPages  = Math.max(1, Math.ceil(team.length / PAGE_SIZE));
  const paginated   = team.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const selRaw = stats?.find((m) => m.user_id === selectedId) || null;
  // Timers started and stopped within seconds aren't worth a line
  const sel = selRaw && { ...selRaw, capacity: { ...selRaw.capacity, by_day: selRaw.capacity.by_day.filter((d) => d.seconds >= 60), by_task: selRaw.capacity.by_task.filter((t) => (t.seconds || 0) >= 60) } };
  const periodLabel = period === 'today' ? 'today' : `${fmtDate(range[0])} – ${fmtDate(range[1])}`;
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
                ? 'Tickets past their due date'
                : dateFilter
                  ? `${new Date(dateFilter + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' })}, ${fmtDate(dateFilter)}`
                  : `${new Date().toLocaleDateString('en-US', { weekday: 'long' })}, ${fmtDate(new Date())}`}
              {!loading && !dateFilter && !showOverdue && ` · ${activeCount} of ${team.length} members working now`}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
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
            {isAdmin && <span aria-hidden style={{ width: 1, height: 22, background: 'var(--sand-border)' }} />}
            <div className="filter-bar" role="tablist" aria-label="Period">
              {PERIODS.map((p) => (
                <button key={p.key} role="tab" aria-selected={period === p.key} className={`filter-tab${period === p.key ? ' active' : ''}`} onClick={() => setPeriod(p.key)}>{p.label}</button>
              ))}
            </div>
            {period === 'custom' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="date" className="form-input" aria-label="From" style={{ width: 145, fontSize: 12, padding: '7px 10px' }} value={customFrom} max={customTo || undefined} onChange={(e) => setCustomFrom(e.target.value)} />
                <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>to</span>
                <input type="date" className="form-input" aria-label="To" style={{ width: 145, fontSize: 12, padding: '7px 10px' }} value={customTo} min={customFrom || undefined} onChange={(e) => setCustomTo(e.target.value)} />
              </div>
            )}
            <button className="btn-secondary tc-refresh-btn" onClick={() => { load(isAdmin && podTab !== 'all' ? podTab : undefined, undefined, false); loadStats(); }}>
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
              <span className="tc-summary-lbl">Open tickets</span>
            </div>
          </div>
        )}


        {statsError && <p role="alert" style={{ fontSize: 13, color: '#dc2626' }}>{statsError}</p>}
        {customInvalid && <p role="alert" style={{ fontSize: 13, color: '#dc2626' }}>Pick a start date and an end date on or after it.</p>}
        {!stats && !statsError && !customInvalid && <p className="page-subtitle" style={{ marginTop: 32, textAlign: 'center' }}>Loading team data…</p>}
        {stats && stats.length === 0 && (
          <div className="card" style={{ padding: '56px 24px', textAlign: 'center' }}>
            <Users size={36} style={{ color: 'var(--sand-border)', marginBottom: 10 }} />
            <p className="page-subtitle">No team members found</p>
          </div>
        )}
        {stats && stats.length > 0 && (
          <>
            <div className="tc-picker">
              <label className="tc-picker__field">
                <span className="tc-picker__lbl">Employee</span>
                <select className="form-input" value={selectedId ?? ''} onChange={(e) => { setSelectedId(Number(e.target.value)); setSubTab('capacity'); }}>
                  {stats.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {[m.name, hrs(m.capacity.logged_seconds), m.escalations.length ? `${m.escalations.length} escalation${m.escalations.length === 1 ? '' : 's'}` : '', m.pending.length ? `${m.pending.length} pending` : ''].filter(Boolean).join(' · ')}
                    </option>
                  ))}
                </select>
              </label>
              {sel && (
                <div className="tc-picker__who">
                  <Avatar name={sel.name} color={sel.avatar_color} avatarUrl={sel.avatar_url} size="md" />
                  <div>
                    <div className="tc-person__name">{sel.name}</div>
                    <div className="tc-person__meta">
                      <span style={{ textTransform: 'capitalize' }}>{sel.role}</span>
                      {sel.pod && <span>{sel.pod === 'pod1' ? 'Pod 1' : 'Pod 2'}</span>}
                      {sel.escalations.length > 0 && <span className="tc-pill tc-pill--esc">{sel.escalations.length} esc</span>}
                      {sel.pending.length > 0 && <span className="tc-pill tc-pill--pend">{sel.pending.length} pending</span>}
                    </div>
                  </div>
                </div>
              )}
            </div>
            {sel && (
              <div className="card" style={{ padding: '14px 18px' }}>
                <div className="tc-subtabs" role="tablist" aria-label={`${sel.name} details`}>
                  {([['capacity', 'Capacity', null], ['reworks', 'Reworks', sel.reworks.length], ['escalations', 'Escalations', sel.escalations.length], ['assigned', 'Assigned tickets', sel.assigned.length], ['pending', 'Pending tasks', sel.pending.length]] as [SubTab, string, number | null][]).map(([k, l, n]) => (
                    <button key={k} type="button" role="tab" aria-selected={subTab === k} className={`tc-subtab${subTab === k ? ' tc-subtab--active' : ''}`} onClick={() => setSubTab(k)}>
                      {l}{n != null && <span className="tc-count">{n}</span>}
                    </button>
                  ))}
                </div>

                {subTab === 'capacity' && (
                  <>
                    <div className="tc-period">
                      <div className="tc-period__stat"><div className="tc-period__val">{hrs(sel.capacity.logged_seconds)}</div><div className="tc-period__lbl">Logged · {periodLabel}</div></div>
                      <div className="tc-period__stat"><div className="tc-period__val">{sel.capacity.available_hours}h</div><div className="tc-period__lbl">Available (working days)</div></div>
                      <div className="tc-period__stat"><div className="tc-period__val">{sel.capacity.available_hours ? Math.round((sel.capacity.logged_seconds / 3600 / sel.capacity.available_hours) * 100) : 0}%</div><div className="tc-period__lbl">Utilisation</div></div>
                    </div>
                    {period === 'today' && <>
                      <p className="tc-section-lbl">Live today</p>
            {team.some((m) => m.user_id === selectedId) ? (
              <div className="card tc-list">
                {/* Table header */}
                <div className="tc-list-header">
                  <div className="tc-col-member">Member</div>
                  <div className="tc-col-active">Active Ticket</div>
                  <div className="tc-col-bar">Today's Progress</div>
                  <div className="tc-col-hrs">Tracked</div>
                  <div className="tc-col-tasks">Tickets</div>
                </div>

                {team.filter((m) => m.user_id === selectedId).map((member, idx, arr) => {
                  const pct = Math.min(100, (member.tracked_seconds / member.capacity_seconds) * 100);
                  const barClass = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok';
                  const isExpanded = true;
                  const isLast = idx === arr.length - 1;

                  return (
                    <div key={member.user_id}>
                      {/* Member row */}
                      <div
                        className={`tc-member-row${member.tasks.length > 0 ? ' tc-member-row--clickable' : ''}${isExpanded ? ' tc-member-row--expanded' : ''}`}
                        style={{ borderBottom: isExpanded || !isLast ? '1px solid var(--bg-sand-lt)' : 'none' }}
                    
                      >
                        {/* Member column */}
                        <div className="tc-col-member">
                          <Avatar name={member.name} color={member.avatar_color} avatarUrl={(member as any).avatar_url} size="md" />
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
                              {member.tasks.length} ticket{member.tasks.length !== 1 ? 's' : ''} assigned
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
            ) : <p className="tc-empty">Nothing live for {sel?.name} today.</p>}

                    </>}
                    {period !== 'today' && sel.capacity.by_day.length > 0 && <>
                      <p className="tc-section-lbl">By day</p>
                      {sel.capacity.by_day.map((d) => (
                        <div key={d.date} className="tc-item"><div className="tc-item__main">{new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' })}, {fmtDate(d.date)}</div><div className="tc-item__side"><strong>{hrs(d.seconds)}</strong></div></div>
                      ))}
                    </>}
                    {period !== 'today' && <>
                      <p className="tc-section-lbl">By ticket</p>
                      {sel.capacity.by_task.length === 0 ? <p className="tc-empty">No time logged in this period.</p> : sel.capacity.by_task.map((t) => (
                        <div key={t.id} className="tc-item">
                          <div className="tc-item__main"><button type="button" className="tc-item__title" onClick={() => setViewTask(t.id)}>{t.title}</button><div className="tc-item__sub">{t.project_name}</div></div>
                          <div className="tc-item__side"><strong>{hrs(t.seconds || 0)}</strong></div>
                        </div>
                      ))}
                    </>}
                  </>
                )}

                {subTab !== 'capacity' && (() => {
                  const list = sel[subTab];
                  const empty = { reworks: 'No work was sent back to them in this period.', escalations: 'Nothing overdue in this period.', assigned: 'No tickets assigned in this period.', pending: 'Nothing pending from this period.' }[subTab];
                  if (!list.length) return <p className="tc-empty">{empty}</p>;
                  return list.map((t, i) => (
                    <div key={`${t.id}-${i}`} className="tc-item">
                      <div className="tc-item__main">
                        <button type="button" className="tc-item__title" onClick={() => setViewTask(t.id)}>{t.title}</button>
                        <div className="tc-item__sub">
                          {[t.project_name, t.stage && `Stage: ${t.stage}`, t.due_date && `Due ${fmtDate(t.due_date)}`].filter(Boolean).join(' · ')}
                        </div>
                        {subTab === 'reworks' && <div className="tc-item__sub" style={{ color: '#b45309' }}>Sent back{t.by ? ` by ${t.by}` : ''}{t.at ? ` on ${fmtDate(new Date(t.at))}` : ''}{t.reason ? ` — “${t.reason}”` : ''}</div>}
                      </div>
                      <div className="tc-item__side">
                        {subTab === 'escalations' && <span className="tc-pill tc-pill--esc">{t.kind === 'overtime' ? `Over estimate by ${fmtDur(t.over_seconds || 0)}` : t.kind === 'overdue' ? `Overdue · ${t.days_late}d` : `Submitted ${t.days_late}d late`}</span>}
                        {subTab === 'pending' && <span className={`tc-pill ${t.accepted ? 'tc-pill--pend' : 'tc-pill--rw'}`}>{t.accepted ? 'Accepted' : 'Not accepted'}</span>}
                        {(subTab === 'assigned' || subTab === 'reworks') && <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{t.status.replace(/_/g, ' ')}</span>}
                      </div>
                    </div>
                  ));
                })()}
              </div>
            )}
          </>
        )}
        {viewTask && <TaskViewDrawer taskId={viewTask} onClose={() => setViewTask(null)} />}
      </div>
    </Layout>
  );
}
