import { useEffect, useState, useCallback, useRef } from 'react';
import { Play, Pause, Check, AlertTriangle, Clock } from 'lucide-react';
import Layout from '../components/Layout/Layout';
import { useAuth } from '../contexts/AuthContext';
import { capacityApi, tasksApi } from '../services/api';
import { CapacityData, CapacityTask } from '../types';
import '../css/pages/Home.css';

function fmtSeconds(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtHrs(sec: number): string {
  return (sec / 3600).toFixed(1);
}

function fmtEstimated(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function getDeadlineInfo(due_date: string | null, due_time: string | null): { label: string; urgent: boolean; overdue: boolean } | null {
  if (!due_date) return null;
  const deadline = new Date(`${due_date}T${due_time || '23:59'}:00`);
  const now = new Date();
  const diffMs = deadline.getTime() - now.getTime();
  const diffHrs = diffMs / 3600000;
  if (diffMs < 0) return { label: 'Overdue', urgent: true, overdue: true };
  if (diffHrs < 1) return { label: `Due in ${Math.round(diffHrs * 60)}m`, urgent: true, overdue: false };
  if (diffHrs < 3) return { label: `Due in ${diffHrs.toFixed(1)}h`, urgent: true, overdue: false };
  if (diffHrs < 24) {
    const h = Math.floor(diffHrs);
    const m = Math.round((diffHrs - h) * 60);
    return { label: `Due in ${h}h${m > 0 ? ` ${m}m` : ''}`, urgent: false, overdue: false };
  }
  const dateStr = deadline.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const timeStr = due_time ? ` at ${deadline.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : '';
  return { label: `Due ${dateStr}${timeStr}`, urgent: false, overdue: false };
}

export default function Home() {
  const { user } = useAuth();
  const [data, setData] = useState<CapacityData | null>(null);
  // elapsed counts seconds since the last API fetch — added on top of the
  // already-baked tracked_seconds values so nothing is counted twice.
  const [elapsed, setElapsed] = useState(0);
  const [taskFilter, setTaskFilter] = useState<'all' | 'pending' | 'accepted'>('all');
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isCapacityRole = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'employee';

  const load = useCallback(async () => {
    if (!isCapacityRole) return;
    try {
      const res = await capacityApi.daily();
      setData(res.data);
      setElapsed(0); // reset on every fetch — new baseline baked into tracked_seconds
    } catch { /* silent */ }
  }, [isCapacityRole]);

  useEffect(() => {
    load();
    const poll = setInterval(load, 30000);
    return () => clearInterval(poll);
  }, [load]);

  // Tick elapsed +1 every second only when a session is active
  useEffect(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (data?.active_task_id) {
      tickRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    }
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [data?.active_task_id]);

  const handleAccept = async (taskId: number, action: 'accept' | 'decline') => {
    await tasksApi.accept(taskId, action);
    load();
  };

  const handleTimer = async (taskId: number, action: 'start' | 'pause' | 'done') => {
    await tasksApi.timer(taskId, action);
    load();
  };

  // Total tracked today = server snapshot + seconds ticked since last fetch
  const totalTrackedSec = data ? data.tracked_seconds + elapsed : 0;

  const trackedPct = data ? Math.min(100, (totalTrackedSec / data.capacity_seconds) * 100) : 0;
  const isOverCapacity = trackedPct >= 100;
  const isApproaching = trackedPct >= 80 && !isOverCapacity;
  const barClass = isOverCapacity ? 'over' : isApproaching ? 'warn' : 'ok';
  const statusText = isOverCapacity
    ? 'Overtime — past 7 hr limit'
    : isApproaching
    ? 'Status: Approaching capacity limit'
    : 'Status: On track';

  const allTasks = data?.tasks ?? [];
  const pendingTasks  = allTasks.filter(t => t.acceptance_status === 'pending' || t.acceptance_status == null);
  const acceptedTasks = allTasks.filter(t => t.acceptance_status === 'accepted');

  const visibleTasks =
    taskFilter === 'pending'  ? pendingTasks  :
    taskFilter === 'accepted' ? acceptedTasks :
    allTasks;

  const activeTask = data?.tasks.find((t) => t.timer_running);

  // Per-task live seconds: server snapshot + elapsed (only for the running task)
  const taskLiveSeconds = (task: CapacityTask): number => {
    if (!task.timer_running) return task.tracked_seconds_today;
    return task.tracked_seconds_today + elapsed;
  };

  if (!isCapacityRole) {
    return (
      <Layout>
        <div className="page-wrap">
          <h2 className="page-title">Home</h2>
          <p className="page-subtitle" style={{ marginTop: 8 }}>Welcome back, {user?.name?.split(' ')[0]}.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="page-wrap">
        <div style={{ marginBottom: 20 }}>
          <h2 className="page-title">Home</h2>
          <p className="page-subtitle" style={{ marginTop: 2 }}>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>

        {/* Capacity header card */}
        <div className="cap-header card">
          <div className="cap-header__left">
            <div className="cap-header__label">
              <span className="cap-header__label-dot" />
              Daily Capacity Tracker
            </div>
            <div className="cap-header__hrs">
              {fmtHrs(totalTrackedSec)}
              <span className="cap-header__hrs-total">/ 7 hrs tracked today</span>
            </div>
            <div className="cap-header__meta">
              <span className="cap-header__meta-item">
                <span className="cap-header__meta-dot" style={{ background: 'var(--blue)' }} />
                {(data?.tasks ?? []).filter((t) => t.acceptance_status === 'pending').length} pending tasks
              </span>
              <span className="cap-header__meta-item">
                <span className="cap-header__meta-dot" style={{ background: 'var(--orange)' }} />
                {(data?.tasks ?? []).filter((t) => t.timer_running).length > 0 ? '1 task running' : 'No active task'}
              </span>
            </div>
          </div>

          <div className="cap-header__right">
            <div className="cap-header__status-row">
              <span className={`cap-header__status-label cap-header__status-label--${barClass}`}>{statusText}</span>
              <span className="cap-header__pct">{trackedPct.toFixed(0)}% Used</span>
            </div>
            <div className="cap-bar-track">
              <div
                className={`cap-bar-fill cap-bar-fill--${barClass}`}
                style={{ width: `${Math.min(trackedPct, 100)}%` }}
              />
            </div>
            <div className="cap-header__bar-note">
              Capacity based on 7 productive hrs/day (9 total − 1 lunch − 1 meetings)
            </div>
          </div>
        </div>

        <div className="home-grid">
          {/* Today's Priorities */}
          <div className="home-section card">
            <div className="home-section__header">
              <div>
                <div className="home-section__title">Today's Priorities</div>
                <div className="home-section__sub">Accept tasks and track time</div>
              </div>
              <div className="home-section__filter">
                {([
                  { key: 'all',      label: 'All',      count: allTasks.length },
                  { key: 'pending',  label: 'Pending',  count: pendingTasks.length },
                  { key: 'accepted', label: 'Accepted', count: acceptedTasks.length },
                ] as const).map(({ key, label, count }) => (
                  <button
                    key={key}
                    className={`home-section__filter-btn${taskFilter === key ? ' active' : ''}`}
                    onClick={() => setTaskFilter(key)}
                  >
                    {label}
                    {count > 0 && (
                      <span style={{ marginLeft: 5, fontSize: 10, fontWeight: 700, opacity: taskFilter === key ? 0.75 : 0.5 }}>
                        {count}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {activeTask && (
              <div className="cap-active-banner">
                <span className="cap-active-banner__dot" />
                <span>Working on: <strong>{activeTask.title}</strong></span>
                <span className="cap-active-banner__time">{fmtSeconds(Math.round(taskLiveSeconds(activeTask)))}</span>
              </div>
            )}

            <div className="cap-task-list">
              {visibleTasks.length === 0 && (
                <div className="empty-state" style={{ padding: '32px 20px' }}>
                  No tasks found
                </div>
              )}
              {visibleTasks.map((task) => {
                const isRunning = task.timer_running;
                const liveSec = Math.round(task.timer_running ? taskLiveSeconds(task) : task.tracked_seconds_today);

                return (
                  <div key={task.id} className="cap-task-row">
                    <div
                      className={`cap-task-row__check${task.status === 'in_review' ? ' cap-task-row__check--done' : ''}`}
                      onClick={() => task.status === 'in_progress' && handleTimer(task.id, 'done')}
                      title={task.status === 'in_progress' ? 'Mark done' : ''}
                    />

                    <div className="cap-task-row__info">
                      <div className="cap-task-row__title">{task.title}</div>
                      <div className="cap-task-row__meta">
                        <span>{task.project_name}</span>
                        {task.estimated_hours != null && (
                          <span>· <Clock size={10} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 2 }} />{fmtEstimated(task.estimated_hours)} est.</span>
                        )}
                        {(() => {
                          const dl = getDeadlineInfo(task.due_date, task.due_time);
                          if (!dl) return null;
                          return (
                            <span style={{ color: dl.overdue ? 'var(--red, #e53e3e)' : dl.urgent ? 'var(--orange)' : undefined, fontWeight: dl.urgent ? 700 : undefined }}>
                              · {dl.label}
                            </span>
                          );
                        })()}
                      </div>
                    </div>

                    {task.acceptance_status === 'pending' && (
                      <div className="cap-task-row__accept-btns">
                        <button className="cap-accept-btn cap-accept-btn--yes" onClick={() => handleAccept(task.id, 'accept')}>
                          Accept
                        </button>
                        <button className="cap-accept-btn cap-accept-btn--no" onClick={() => handleAccept(task.id, 'decline')}>
                          Decline
                        </button>
                      </div>
                    )}

                    {task.status === 'in_review' && (
                      <div className="cap-task-row__review-badge">
                        In Review
                      </div>
                    )}

                    {task.acceptance_status === 'accepted' && task.status !== 'in_review' && (
                      <div className="cap-task-row__timer">
                        {liveSec > 0 && (
                          <span className={`cap-timer-time${isRunning ? ' cap-timer-time--running' : ''}`}>
                            {fmtSeconds(liveSec)}
                          </span>
                        )}
                        {isRunning ? (
                          <button
                            className="cap-timer-btn cap-timer-btn--pause"
                            title="Pause"
                            onClick={() => handleTimer(task.id, 'pause')}
                          >
                            <Pause size={12} />
                          </button>
                        ) : task.assignee_role === 'employee' || task.assignee_role == null ? (
                          <button
                            className="cap-timer-btn cap-timer-btn--start"
                            title="Start"
                            onClick={() => handleTimer(task.id, 'start')}
                          >
                            <Play size={12} />
                          </button>
                        ) : null}
                        {task.status === 'in_progress' && (
                          <button
                            className="cap-timer-btn cap-timer-btn--done"
                            title="Done"
                            onClick={() => handleTimer(task.id, 'done')}
                          >
                            <Check size={12} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Capacity Summary */}
          <div className="home-section card">
            <div className="home-section__header">
              <div>
                <div className="home-section__title">Capacity Breakdown</div>
                <div className="home-section__sub">Estimated vs tracked time per task</div>
              </div>
            </div>

            {isOverCapacity && (
              <div style={{ padding: '12px 20px 0' }}>
                <div className="cap-warning">
                  <AlertTriangle size={14} />
                  You've exceeded your 7-hour daily capacity. Any additional work is overtime.
                </div>
              </div>
            )}

            <div className="cap-task-list">
              {(data?.tasks ?? []).length === 0 && (
                <div className="empty-state" style={{ padding: '32px 20px' }}>No tasks assigned today</div>
              )}
              {(data?.tasks ?? []).map((task) => {
                const estSec = (task.estimated_hours ?? 0) * 3600;
                const trackedSec = task.timer_running ? taskLiveSeconds(task) : task.tracked_seconds_today;
                const pct = estSec > 0 ? Math.min(100, (trackedSec / estSec) * 100) : 0;
                const remainSec = Math.max(0, estSec - trackedSec);
                const dl = getDeadlineInfo(task.due_date, task.due_time);

                return (
                  <div key={task.id} style={{ padding: '14px 20px', borderBottom: '1px solid var(--bg-sand-lt)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{task.title}</div>
                        <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 2 }}>{task.project_name}</div>
                        {dl && (
                          <div style={{ fontSize: 11, marginTop: 3, fontWeight: dl.urgent ? 700 : 600, color: dl.overdue ? 'var(--red, #e53e3e)' : dl.urgent ? 'var(--orange)' : 'var(--ink-muted)' }}>
                            {dl.label}
                          </div>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--ink-muted)', textAlign: 'right', flexShrink: 0, marginLeft: 12 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--ink)' }}>{fmtSeconds(Math.round(trackedSec))}</div>
                        {task.estimated_hours != null && (
                          <>
                            <div style={{ marginTop: 1 }}>of {fmtEstimated(task.estimated_hours)} est.</div>
                            {remainSec > 0 && (
                              <div style={{ color: pct >= 80 ? 'var(--orange)' : undefined }}>
                                {fmtEstimated(remainSec / 3600)} left
                              </div>
                            )}
                            {pct >= 100 && <div style={{ color: 'var(--red, #e53e3e)', fontWeight: 700 }}>Over estimate</div>}
                          </>
                        )}
                      </div>
                    </div>
                    {estSec > 0 && (
                      <div className="cap-bar-track" style={{ height: 5 }}>
                        <div
                          className={`cap-bar-fill cap-bar-fill--${pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
