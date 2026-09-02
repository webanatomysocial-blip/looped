import { useEffect, useState, useCallback, useRef } from 'react';
import { format } from 'date-fns';
import { Play, Pause, Check, CheckSquare, AlertTriangle, Clock, ArrowUpRight, XCircle, CheckCircle, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout/Layout';
import Avatar from '../components/UI/Avatar';
import { useAuth } from '../contexts/AuthContext';
import { capacityApi, tasksApi, projectsApi, approvalsApi, xlr8Api } from '../services/api';
import { CapacityData, CapacityTask, Project } from '../types';
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
  const [taskFilter, setTaskFilter] = useState<'all' | 'pending' | 'accepted' | 'overdue'>('all');
  const [declineModal, setDeclineModal] = useState<{ task: CapacityTask } | null>(null);
  const [declineComment, setDeclineComment] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [priorityPage, setPriorityPage] = useState(1);
  const PAGE_SIZE = 5;
  const [approvedTasks, setApprovedTasks] = useState<{ id: number; task_title: string; project_name: string; final_approved_at: string }[]>([]);
  const [dismissedApprovedIds, setDismissedApprovedIds] = useState<Set<number>>(
    () => new Set(JSON.parse(localStorage.getItem('dismissed_approved_ids') || '[]'))
  );
  const [dismissedRejectedIds, setDismissedRejectedIds] = useState<Set<number>>(
    () => new Set(JSON.parse(localStorage.getItem('dismissed_rejected_ids') || '[]'))
  );
  const [doneConfirmTask, setDoneConfirmTask] = useState<CapacityTask | null>(null);
  const [doneModalChecklist, setDoneModalChecklist] = useState<{ id: number; text: string; completed: boolean }[]>([]);
  const [viewTask, setViewTask] = useState<any | null>(null);
  const [viewTab, setViewTab] = useState<'info' | 'activity'>('info');
  const [viewLog, setViewLog] = useState<any[]>([]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const openTaskView = async (taskId: number) => {
    try {
      const res = await tasksApi.get(taskId);
      setViewTask(res.data);
      setViewTab('info');
      setViewLog([]);
      if (res.data.ticket_type_id) {
        try { const r = await xlr8Api.getTicketLog(taskId); setViewLog(r.data); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  };

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
    window.addEventListener('wd:new-notification', load);
    return () => { clearInterval(poll); window.removeEventListener('wd:new-notification', load); };
  }, [load]);

  useEffect(() => {
    projectsApi.list().then((r) => setProjects(r.data)).catch(() => {});
    approvalsApi.list().then((r) => {
      const approved = (r.data as any[])
        .filter(a => a.status === 'approved')
        .sort((a, b) => new Date(b.final_approved_at).getTime() - new Date(a.final_approved_at).getTime())
        .slice(0, 5);
      setApprovedTasks(approved);
    }).catch(() => {});
  }, []);

  // Tick elapsed +1 every second only when a session is active
  useEffect(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (data?.active_task_id) {
      tickRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    }
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [data?.active_task_id]);

  const handleAccept = async (task: CapacityTask, action: 'accept' | 'decline') => {
    if (action === 'decline') {
      setDeclineModal({ task });
      setDeclineComment('');
      return;
    }
    // Only use xlr8 employee-accept if THIS user is the current stage assignee
    if (task.ticket_type_id && task.xlr8_status === 'pending_assignee' && task.xlr8_assignee_id === user?.id) {
      await xlr8Api.employeeAccept(task.id);
    } else {
      await tasksApi.accept(task.id, action);
    }
    load();
  };

  const submitDecline = async () => {
    if (!declineModal) return;
    const { task } = declineModal;
    // XLR8 current-stage: decline via xlr8 endpoint (reverts xlr8_status to pending_manager)
    // Future-stage or non-XLR8: mark declined in task_assignees and notify creator
    if (task.ticket_type_id && task.xlr8_status === 'pending_assignee' && task.xlr8_assignee_id === user?.id) {
      await xlr8Api.employeeDecline(task.id, declineComment);
    } else {
      await tasksApi.accept(task.id, 'decline');
    }
    setDeclineModal(null);
    setDeclineComment('');
    load();
  };

  const handleTimer = async (taskId: number, action: 'start' | 'pause' | 'done', taskObj?: CapacityTask) => {
    if (action === 'done' && taskObj) {
      setDoneConfirmTask(taskObj);
      setDoneModalChecklist([]);
      try {
        const full = await tasksApi.get(taskId);
        setDoneModalChecklist((full.data.checklist || []).filter((i: any) => i.completed));
      } catch { /* show modal without checklist */ }
      return;
    }
    await tasksApi.timer(taskId, action);
    load();
  };

  const toggleDoneItem = async (idx: number) => {
    const item = doneModalChecklist[idx];
    const newCompleted = !item.completed;
    setDoneModalChecklist(prev => prev.map((it, i) => i === idx ? { ...it, completed: newCompleted } : it));
    try { await tasksApi.updateChecklist(doneConfirmTask!.id, item.id, newCompleted); }
    catch { setDoneModalChecklist(prev => prev.map((it, i) => i === idx ? { ...it, completed: !newCompleted } : it)); }
  };

  const confirmDone = async () => {
    if (!doneConfirmTask) return;
    if (doneConfirmTask.ticket_type_id) {
      await xlr8Api.markDone(doneConfirmTask.id);
    } else {
      await tasksApi.timer(doneConfirmTask.id, 'done');
    }
    setDoneConfirmTask(null);
    setDoneModalChecklist([]);
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

  const allTasksRaw = [...(data?.tasks ?? [])].sort((a, b) => b.id - a.id);
  const today = new Date().toISOString().slice(0, 10);
  const overdueTasks  = allTasksRaw.filter(t => t.status !== 'completed' && t.due_date && t.due_date < today);
  const todayTasks = allTasksRaw.filter(t => !t.due_date || t.due_date === today);
  const allTasks = allTasksRaw.filter(t => t.status !== 'completed');
  const pendingTasks  = todayTasks.filter(t => t.acceptance_status === 'pending' || t.acceptance_status == null);
  const acceptedTasks = todayTasks.filter(t => t.acceptance_status === 'accepted');

  const visibleApproved = approvedTasks.filter(a => !dismissedApprovedIds.has(a.id));
  const visibleRejected = allTasksRaw.filter(t => t.has_rejected_approval && !dismissedRejectedIds.has(t.id));

  const dismissApproved = () => {
    const next = new Set([...dismissedApprovedIds, ...visibleApproved.map(a => a.id)]);
    setDismissedApprovedIds(next);
    localStorage.setItem('dismissed_approved_ids', JSON.stringify([...next]));
  };
  const dismissRejected = () => {
    const next = new Set([...dismissedRejectedIds, ...visibleRejected.map(t => t.id)]);
    setDismissedRejectedIds(next);
    localStorage.setItem('dismissed_rejected_ids', JSON.stringify([...next]));
  };

  const visibleTasks =
    taskFilter === 'pending'  ? pendingTasks  :
    taskFilter === 'accepted' ? acceptedTasks :
    taskFilter === 'overdue'  ? overdueTasks  :
    allTasks;

  const priorityTotalPages = Math.max(1, Math.ceil(visibleTasks.length / PAGE_SIZE));
  const paginatedPriority  = visibleTasks.slice((priorityPage - 1) * PAGE_SIZE, priorityPage * PAGE_SIZE);

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
        {/* <div style={{ marginBottom: 20 }}>
          <h2 className="page-title">Home</h2>
          <p className="page-subtitle" style={{ marginTop: 2 }}>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div> */}

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

        {/* Pending task invitation alert */}
        {user?.role !== 'admin' && user?.role !== 'client' && (() => {
          const pending = (data?.tasks ?? []).filter(t => t.acceptance_status === 'pending');
          if (pending.length === 0) return null;
          return (
            <div style={{
              background: 'rgba(245,158,11,0.08)',
              border: '1.5px solid rgba(245,158,11,0.4)',
              borderRadius: 12,
              padding: '14px 18px',
              marginBottom: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle size={16} color="var(--orange, #f59e0b)" />
                <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>
                  {pending.length} task{pending.length > 1 ? 's' : ''} waiting for your acceptance
                </span>
                <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>— accept to start working and see them on your calendar</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {pending.map(task => (
                  <div key={task.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    background: 'var(--surface)', borderRadius: 8, padding: '10px 14px',
                    border: '1px solid var(--sand-border)',
                  }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>{task.title}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 2 }}>
                        {task.project_name}
                        {task.due_date ? ` · Due ${task.due_date}` : ''}
                        {task.xlr8_status && task.xlr8_status !== 'pending_assignee'
                          ? <span style={{ marginLeft: 6, background: 'rgba(59,130,246,0.1)', color: 'var(--blue)', borderRadius: 4, padding: '1px 6px', fontWeight: 600 }}>Future stage</span>
                          : null}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                      <button
                        className="cap-accept-btn cap-accept-btn--yes"
                        onClick={() => handleAccept(task, 'accept')}
                      >
                        <CheckCircle size={12} /> Accept
                      </button>
                      <button
                        className="cap-accept-btn cap-accept-btn--no"
                        onClick={() => handleAccept(task, 'decline')}
                      >
                        <XCircle size={12} /> Decline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

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
                  { key: 'overdue',  label: 'Overdue',  count: overdueTasks.length },
                ] as const).map(({ key, label, count }) => (
                  <button
                    key={key}
                    className={`home-section__filter-btn${taskFilter === key ? ' active' : ''}`}
                    onClick={() => { setTaskFilter(key); setPriorityPage(1); }}
                  >
                    {label}
                    {count > 0 && (
                      <span style={{ marginLeft: 5, fontSize: 10, fontWeight: 700, opacity: taskFilter === key ? 0.75 : 0.5, color: key === 'overdue' ? '#ef4444' : undefined }}>
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
              {paginatedPriority.map((task) => {
                const isRunning = task.timer_running;
                const liveSec = Math.round(task.timer_running ? taskLiveSeconds(task) : task.tracked_seconds_today);

                return (
                  <div key={task.id} className="cap-task-row">
                    <div
                      className={`cap-task-row__check${task.status === 'in_review' ? ' cap-task-row__check--done' : ''}`}
                      onClick={() => task.status === 'in_progress' && handleTimer(task.id, 'done', task)}
                      title={task.status === 'in_progress' ? 'Mark done' : ''}
                    />

                    <div className="cap-task-row__info">
                      <div className="cap-task-row__title" style={{ cursor: 'pointer' }} onClick={() => openTaskView(task.id)}>{task.title}</div>
                      <div className="cap-task-row__meta">
                        <span>{task.project_name}</span>
                        {(() => {
                          const displayEst = task.ticket_type_id ? (task.stage_est_hours ?? null) : task.estimated_hours;
                          if (!displayEst) return null;
                          return <span>· <Clock size={10} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 2 }} />{fmtEstimated(displayEst)} est.</span>;
                        })()}
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
                        <button className="cap-accept-btn cap-accept-btn--yes" onClick={() => handleAccept(task, 'accept')}>
                          Accept
                        </button>
                        <button className="cap-accept-btn cap-accept-btn--no" onClick={() => handleAccept(task, 'decline')}>
                          Decline
                        </button>
                      </div>
                    )}

                    {task.status === 'in_review' && (
                      <div className="cap-task-row__review-badge">
                        In Review
                      </div>
                    )}

                    {(task.acceptance_status === 'accepted' || task.assignee_role === 'review') && task.status !== 'in_review' && (
                      <div className="cap-task-row__timer">
                        {task.assignee_role === 'review' && (
                          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--blue)', background: 'rgba(59,130,246,0.08)', padding: '2px 7px', borderRadius: 10, marginRight: 4 }}>Reviewing</span>
                        )}
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
                            onClick={() => handleTimer(task.id, 'done', task)}
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
            {priorityTotalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 20px', borderTop: '1px solid var(--bg-sand-lt)' }}>
                <button
                  onClick={() => setPriorityPage(p => Math.max(1, p - 1))}
                  disabled={priorityPage === 1}
                  style={{ background: 'none', border: '1px solid var(--sand-border)', borderRadius: 6, padding: '3px 10px', fontSize: 12, cursor: priorityPage === 1 ? 'default' : 'pointer', opacity: priorityPage === 1 ? 0.4 : 1 }}
                >‹</button>
                <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{priorityPage} / {priorityTotalPages}</span>
                <button
                  onClick={() => setPriorityPage(p => Math.min(priorityTotalPages, p + 1))}
                  disabled={priorityPage === priorityTotalPages}
                  style={{ background: 'none', border: '1px solid var(--sand-border)', borderRadius: 6, padding: '3px 10px', fontSize: 12, cursor: priorityPage === priorityTotalPages ? 'default' : 'pointer', opacity: priorityPage === priorityTotalPages ? 0.4 : 1 }}
                >›</button>
              </div>
            )}
          </div>

          {/* Right column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Tasks for Today arc */}
            <div className="card" style={{ padding: '22px 24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div>
                  <div className="home-section__title">Tasks for Today</div>
                  <div className="home-section__sub">Keep your projects on track</div>
                </div>
                <Link to="/tasks" style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', display: 'flex', alignItems: 'center', gap: 3, textDecoration: 'none' }}>
                  View all <ArrowUpRight size={11} />
                </Link>
              </div>
              {(() => {
                const total = todayTasks.length;
                const completed = todayTasks.filter(t => t.status === 'completed').length;
                const pct = total ? Math.round((completed / total) * 100) : 0;
                const r = 36; const circ = 2 * Math.PI * r;
                const dash = (pct / 100) * circ * 0.75;
                const gap = circ - dash;
                const offset = circ * 0.125;
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
                    <div style={{ position: 'relative', width: 90, height: 90, flexShrink: 0 }}>
                      <svg width="90" height="90" style={{ transform: 'rotate(-135deg)' }}>
                        <circle cx="45" cy="45" r={r} fill="none" stroke="#E8E0D0" strokeWidth="7" strokeLinecap="round"
                          strokeDasharray={`${circ * 0.75} ${circ * 0.25}`} strokeDashoffset={-offset} />
                        <circle cx="45" cy="45" r={r} fill="none" stroke="var(--orange)" strokeWidth="7" strokeLinecap="round"
                          strokeDasharray={`${dash} ${gap + circ * 0.25}`} strokeDashoffset={-offset} />
                      </svg>
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink)', lineHeight: 1 }}>{pct}%</span>
                        <span style={{ fontSize: 9, color: 'var(--ink-muted)', marginTop: 2 }}>done</span>
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink)', lineHeight: 1, marginBottom: 4 }}>{completed}/{total}</div>
                      <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>tasks completed</div>
                      {isOverCapacity && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--red)', fontWeight: 700, marginTop: 8 }}>
                          <AlertTriangle size={11} /> Over daily capacity
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Rejected tasks */}
            {visibleRejected.length > 0 && (
              <div className="card" style={{ padding: '18px 24px', border: '1.5px solid #fca5a5', background: 'linear-gradient(135deg,#fff5f5 0%,#fff 100%)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <XCircle size={16} color="#ef4444" />
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#dc2626' }}>Rejected Approvals</span>
                  <span style={{ fontSize: 11, background: '#fee2e2', color: '#b91c1c', fontWeight: 700, padding: '2px 8px', borderRadius: 20 }}>
                    {visibleRejected.length}
                  </span>
                  <button onClick={dismissRejected} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center', color: '#b91c1c', opacity: 0.6 }} title="Dismiss">
                    <X size={14} />
                  </button>
                </div>
                {visibleRejected.map(t => (
                  <Link key={t.id} to="/tasks" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid #fee2e2' }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#ef4444', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</div>
                      <div style={{ fontSize: 11, color: '#ef4444', marginTop: 1 }}>{t.project_name}</div>
                    </div>
                    <ArrowUpRight size={13} color="#ef4444" style={{ flexShrink: 0 }} />
                  </Link>
                ))}
              </div>
            )}

            {/* Approved tasks */}
            {visibleApproved.length > 0 && (
              <div className="card" style={{ padding: '18px 24px', border: '1.5px solid #86efac', background: 'linear-gradient(135deg,#f0fdf4 0%,#fff 100%)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <CheckCircle size={16} color="#16a34a" />
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#15803d' }}>Approved Tasks</span>
                  <span style={{ fontSize: 11, background: '#dcfce7', color: '#15803d', fontWeight: 700, padding: '2px 8px', borderRadius: 20 }}>
                    {visibleApproved.length}
                  </span>
                  <button onClick={dismissApproved} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center', color: '#15803d', opacity: 0.6 }} title="Dismiss">
                    <X size={14} />
                  </button>
                </div>
                {visibleApproved.map(a => (
                  <Link key={a.id} to="/approvals" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid #dcfce7' }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#16a34a', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.task_title}</div>
                      <div style={{ fontSize: 11, color: '#16a34a', marginTop: 1 }}>{a.project_name}</div>
                    </div>
                    <ArrowUpRight size={13} color="#16a34a" style={{ flexShrink: 0 }} />
                  </Link>
                ))}
              </div>
            )}

            {/* Your Active Projects */}
            <div className="card" style={{ padding: '22px 24px', flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div className="home-section__title">Your Active Projects</div>
                <Link to="/projects" style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', display: 'flex', alignItems: 'center', gap: 3, textDecoration: 'none' }}>
                  View all <ArrowUpRight size={11} />
                </Link>
              </div>
              {projects.filter(p => p.status === 'active' || p.status === 'in_review').length === 0 && (
                <p style={{ fontSize: 13, color: 'var(--ink-muted)' }}>No active projects</p>
              )}
              {projects.filter(p => p.status === 'active' || p.status === 'in_review').slice(0, 5).map((p) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--bg-sand)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: p.status === 'in_review' ? 'var(--blue)' : 'var(--yellow)', flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{p.name}</div>
                      {p.client_name && <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{p.client_name}</div>}
                    </div>
                  </div>
                  <div style={{ display: 'flex' }}>
                    {(p.members || []).slice(0, 3).map((m) => (
                      <div key={m.user_id} style={{ marginLeft: -6 }}>
                        <Avatar name={m.name} color={m.avatar_color} size="sm" />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Done confirmation modal ── */}
      {doneConfirmTask && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 900,
          display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
          paddingTop: '8vh',
        }}>
          <div style={{
            position: 'absolute', inset: 0,
            background: 'rgba(26,26,26,0.4)', backdropFilter: 'blur(3px)',
          }} onClick={() => { setDoneConfirmTask(null); setDoneModalChecklist([]); }} />
          <div style={{
            position: 'relative', background: '#fff', borderRadius: 20,
            width: '90%', maxWidth: 460, zIndex: 901,
            boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
            display: 'flex', flexDirection: 'column', maxHeight: '80vh',
          }}>
            <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #e8e3da' }}>
              <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#888', marginBottom: 4 }}>
                {doneModalChecklist.length > 0 ? 'Task Checklist' : 'Mark as Done'}
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#1a1a1a', marginBottom: 2 }}>{doneConfirmTask.title}</div>
              {doneModalChecklist.length > 0 && (() => {
                const checkedCount = doneModalChecklist.filter(i => i.completed).length;
                const total = doneModalChecklist.length;
                const allDone = checkedCount === total;
                return (
                  <div style={{ fontSize: 12, color: allDone ? '#4caf7d' : '#f47326', fontWeight: 600 }}>
                    {checkedCount}/{total} items completed {allDone ? '✓ All done!' : '— please check everything before marking done'}
                  </div>
                );
              })()}
              {doneModalChecklist.length === 0 && (
                <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>
                  Have you completed everything for this task?
                </div>
              )}
            </div>
            {doneModalChecklist.length > 0 && (
              <div style={{ flex: 1, overflowY: 'auto', padding: '12px 24px' }}>
                {doneModalChecklist.map((item, idx) => (
                  <div
                    key={item.id}
                    onClick={() => toggleDoneItem(idx)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '9px 12px', marginBottom: 4, borderRadius: 10, cursor: 'pointer',
                      background: item.completed ? 'rgba(76,175,125,0.07)' : '#f8f6f2',
                      border: `1.5px solid ${item.completed ? 'rgba(76,175,125,0.3)' : '#e8e3da'}`,
                    }}
                  >
                    <CheckSquare size={16} style={{ color: item.completed ? '#4caf7d' : '#ccc', flexShrink: 0 }} />
                    <span style={{
                      fontSize: 13, flex: 1,
                      textDecoration: item.completed ? 'line-through' : 'none',
                      color: item.completed ? '#888' : '#1a1a1a',
                    }}>{item.text}</span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ padding: '16px 24px', borderTop: '1px solid #e8e3da', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {doneModalChecklist.length > 0 && !doneModalChecklist.every(i => i.completed) && (
                <div style={{ fontSize: 12, color: '#b45309', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 8, padding: '8px 12px', textAlign: 'center' }}>
                  Complete all checklist items before marking as done.
                </div>
              )}
              <button
                className="drawer-submit"
                onClick={confirmDone}
                disabled={doneModalChecklist.length > 0 && !doneModalChecklist.every(i => i.completed)}
                style={{ background: '#4caf7d', opacity: (doneModalChecklist.length > 0 && !doneModalChecklist.every(i => i.completed)) ? 0.4 : 1, cursor: (doneModalChecklist.length > 0 && !doneModalChecklist.every(i => i.completed)) ? 'not-allowed' : 'pointer' }}
              >
                <Check size={15} /> Yes, mark as complete
              </button>
              <button className="drawer-cancel" onClick={() => { setDoneConfirmTask(null); setDoneModalChecklist([]); }}>
                Go back
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Decline comment modal */}
      {declineModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }}>
          <div style={{ background: '#ffffff', borderRadius: 14, padding: 28, width: 380, boxShadow: '0 16px 48px rgba(0,0,0,0.25)', border: '1px solid #e2e8f0' }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700, color: '#0f172a' }}>Decline Task</h3>
            <p style={{ margin: '0 0 14px', fontSize: 13, color: '#64748b' }}>
              <strong style={{ color: '#0f172a' }}>{declineModal.task.title}</strong> — please provide a reason for declining.
            </p>
            <textarea
              autoFocus
              placeholder="Reason for declining…"
              value={declineComment}
              onChange={(e) => setDeclineComment(e.target.value)}
              style={{ width: '100%', minHeight: 90, borderRadius: 8, border: '1.5px solid #e2e8f0', padding: '10px 12px', fontSize: 13, color: '#0f172a', background: '#f8fafc', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit', outline: 'none' }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', fontSize: 13, color: '#64748b', fontWeight: 500 }} onClick={() => setDeclineModal(null)}>Cancel</button>
              <button style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }} onClick={submitDecline}>Decline</button>
            </div>
          </div>
        </div>
      )}

      {/* Task view canvas */}
      {viewTask && (
        <div className="drawer-overlay">
          <div className="drawer-backdrop" onClick={() => setViewTask(null)} />
          <div className="drawer-panel">
            <div className="drawer-header">
              <div className="drawer-header__label">
                {viewTask.project_name}{viewTask.client_name ? ` · ${viewTask.client_name}` : ''}
              </div>
              <div className="drawer-header__row">
                <span className="drawer-header__title">{viewTask.title}</span>
                <button type="button" className="drawer-close" onClick={() => setViewTask(null)}>×</button>
              </div>
              <div style={{ display: 'flex', marginTop: 14, gap: 0, borderBottom: '1.5px solid var(--bg-sand)', marginBottom: -18 }}>
                {(['info', 'activity'] as const).map(tab => (
                  <button key={tab} type="button" onClick={() => setViewTab(tab)} style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    padding: '6px 16px 10px',
                    fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                    color: viewTab === tab ? 'var(--ink)' : 'var(--ink-muted)',
                    borderBottom: viewTab === tab ? '2px solid var(--ink)' : '2px solid transparent',
                    marginBottom: -1.5,
                  }}>
                    {tab === 'info' ? 'Info' : 'Activity Log'}
                  </button>
                ))}
              </div>
            </div>

            <div className="drawer-body" style={{ overflowY: 'auto' }}>
              {viewTab === 'info' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    {[
                      { label: 'Task Key', value: (() => {
                        const mon = new Date(viewTask.created_at).toLocaleString('en-US', { month: 'short' }).toUpperCase();
                        const proj = (viewTask.project_name || '').replace(/\s+/g, '').toUpperCase().slice(0, 8);
                        return <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{proj}-{viewTask.id}-{mon}</span>;
                      })() },
                      { label: 'Status', value: <span className={`badge badge--${viewTask.status}`}>{viewTask.status.replace(/_/g, ' ')}</span> },
                      { label: 'Due Date', value: viewTask.due_date ? format(new Date(viewTask.due_date), 'MMM d, yyyy') : '—' },
                      { label: 'Created by', value: viewTask.created_by_name || '—' },
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <div className="drawer-info-label">{label}</div>
                        <div style={{ fontSize: 13, color: 'var(--ink)', marginTop: 2 }}>{value}</div>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div className="drawer-info-label">Description</div>
                    {viewTask.description
                      ? <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.6, whiteSpace: 'pre-wrap', background: 'rgba(0,0,0,0.03)', borderRadius: 8, padding: '12px 14px', marginTop: 6 }}>{viewTask.description}</div>
                      : <div style={{ fontSize: 13, color: 'var(--ink-muted)', fontStyle: 'italic', marginTop: 4 }}>No description provided.</div>
                    }
                  </div>

                  {/* XLR8 Stage Tracker */}
                  {viewTask.ticket_type_id && viewTask.xlr8_stages?.length > 0 && (() => {
                    const stages: any[] = viewTask.xlr8_stages;
                    const stageAssignees: any[] = viewTask.stage_assignees || [];
                    const currentIdx: number = viewTask.xlr8_stage_idx ?? 0;
                    const isCompleted = viewTask.status === 'completed' || viewTask.xlr8_status === 'completed';
                    const lastLogEntry = viewLog[viewLog.length - 1];
                    const lastWasRejected = lastLogEntry && (lastLogEntry.action.includes('declined') || lastLogEntry.action.includes('reject'));
                    return (
                      <div>
                        <div className="drawer-info-label" style={{ marginBottom: 12 }}>Stage Flow</div>
                        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'stretch', gap: 0, marginTop: '10px', width: '100%', paddingBottom: 4 }}>
                          {stages.map((stage: any, i: number) => {
                            const isReview = stage.type === 'manager' || stage.type === 'admin';
                            const isDone = isCompleted || i < currentIdx;
                            const isCurrent = !isCompleted && i === currentIdx;
                            const isPending = !isCompleted && i > currentIdx;
                            const stageAssignee = stageAssignees.filter((a: any) => a.stage_idx === i && a.user_id);
                            const estH = stageAssignees.find((a: any) => a.stage_idx === i && a.est_hours)?.est_hours ?? null;
                            const label = stage.type === 'admin' ? 'Admin Review' : stage.type === 'manager' ? 'Manager Review' : stage.category_name;
                            const borderColor = isDone ? '#22c55e' : isCurrent ? (lastWasRejected ? '#ef4444' : '#3b82f6') : '#e2e8f0';
                            const bgColor = isDone ? 'rgba(34,197,94,0.06)' : isCurrent ? (lastWasRejected ? 'rgba(239,68,68,0.05)' : 'rgba(59,130,246,0.05)') : 'var(--surface)';
                            const dotColor = isDone ? '#22c55e' : isCurrent ? (lastWasRejected ? '#ef4444' : '#3b82f6') : '#cbd5e1';
                            const showArrow = i < stages.length - 1;
                            return (
                              <div key={i} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', flexShrink: 0 }}>
                                <div style={{ width: 150, minHeight: 130, border: `2px solid ${borderColor}`, borderRadius: 12, padding: '14px 12px 12px', background: bgColor, position: 'relative', display: 'flex', flexDirection: 'column', gap: 8 }}>
                                  <div style={{ position: 'absolute', top: -10, left: 10, background: dotColor, color: '#fff', borderRadius: 99, fontSize: 9, fontWeight: 800, padding: '1px 7px', whiteSpace: 'nowrap' }}>Stage {i + 1}</div>
                                  <div style={{ fontSize: 20, lineHeight: 1 }}>{isDone ? '✅' : isCurrent && lastWasRejected ? '🔴' : isCurrent ? '🔵' : '⬜'}</div>
                                  <div style={{ fontSize: 12, fontWeight: 700, color: isPending ? 'var(--ink-muted)' : 'var(--ink)', lineHeight: 1.3 }}>
                                    {label}
                                    {isReview && <span style={{ marginLeft: 4, fontSize: 9, fontWeight: 600, color: stage.type === 'admin' ? 'var(--orange)' : '#3b82f6', background: stage.type === 'admin' ? 'rgba(234,88,12,0.1)' : 'rgba(59,130,246,0.1)', borderRadius: 4, padding: '1px 4px' }}>Review</span>}
                                  </div>
                                  <div style={{ flex: 1 }}>
                                    {stageAssignee.length > 0 ? (
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                        {stageAssignee.map((a: any) => (
                                          <span key={a.user_id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: isPending ? 'var(--ink-muted)' : 'var(--ink)' }}>
                                            <span style={{ width: 16, height: 16, borderRadius: '50%', background: isPending ? '#cbd5e1' : (a.avatar_color || '#94a3b8'), display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 7, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
                                              {(a.user_name || '?').split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
                                            </span>
                                            {a.user_name?.split(' ')[0]}
                                          </span>
                                        ))}
                                      </div>
                                    ) : <span style={{ fontSize: 10, color: 'var(--ink-muted)', fontStyle: 'italic' }}>TBD</span>}
                                  </div>
                                  {estH && <div style={{ fontSize: 10, color: 'var(--ink-muted)', fontWeight: 600 }}>⏱ {Math.floor(estH)}h {Math.round((estH % 1) * 60)}m</div>}
                                  {lastWasRejected && isCurrent && lastLogEntry?.comment && (
                                    <div style={{ fontSize: 10, color: '#ef4444', background: 'rgba(239,68,68,0.08)', borderRadius: 6, padding: '4px 6px', fontStyle: 'italic', lineHeight: 1.4 }}>
                                      ✕ "{lastLogEntry.comment}"
                                    </div>
                                  )}
                                  {lastWasRejected && isCurrent && !lastLogEntry?.comment && (
                                    <div style={{ fontSize: 10, color: '#ef4444', fontWeight: 600 }}>✕ Rejected</div>
                                  )}
                                </div>
                                {showArrow && (
                                  <div style={{ width: 40, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                                    <svg width="40" height="20" viewBox="0 0 40 20">
                                      <line x1="0" y1="10" x2="30" y2="10" stroke={isDone ? '#22c55e' : '#e2e8f0'} strokeWidth="2" strokeDasharray={isPending ? '4 3' : 'none'} />
                                      <polygon points="40,10 28,4 28,16" fill={isDone ? '#22c55e' : '#e2e8f0'} />
                                    </svg>
                                    {lastWasRejected && i === currentIdx && (
                                      <svg width="40" height="16" viewBox="0 0 40 16">
                                        <line x1="40" y1="8" x2="10" y2="8" stroke="#ef4444" strokeWidth="2" />
                                        <polygon points="0,8 12,2 12,14" fill="#ef4444" />
                                      </svg>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {!viewTask.ticket_type_id && (
                    <div>
                      <div className="drawer-info-label">Assigned to</div>
                      <div style={{ fontSize: 13, color: 'var(--ink)', marginTop: 2 }}>{viewTask.assignees?.length > 0 ? viewTask.assignees.map((a: any) => a.name).join(', ') : viewTask.assigned_name || '—'}</div>
                    </div>
                  )}
                </div>
              )}

              {viewTab === 'activity' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {viewLog.length > 0 ? viewLog.map((entry: any, i: number) => {
                    const actionLabels: Record<string, string> = {
                      created: 'Created', assigned: 'Assigned to employee', employee_accepted: 'Accepted',
                      employee_declined: 'Declined', work_done: 'Marked done',
                      manager_approved: 'Manager approved', manager_declined: 'Returned to employee',
                      next_stage: 'Moved to next stage', sent_to_admin: 'Sent to admin',
                      admin_approved: 'Admin approved', admin_skip_client: 'Completed (client skipped)',
                      admin_skipped: 'Admin skipped', client_approved: 'Client approved', completed: 'Completed',
                    };
                    const isDanger = entry.action.includes('declined') || entry.action.includes('reject');
                    return (
                      <div key={i} style={{
                        fontSize: 12, padding: '10px 12px', borderRadius: 8,
                        background: isDanger ? 'rgba(239,68,68,0.06)' : 'rgba(76,175,125,0.06)',
                        border: `1px solid ${isDanger ? 'rgba(239,68,68,0.18)' : 'rgba(76,175,125,0.18)'}`,
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <span><strong>{entry.actor_name}</strong> · <span style={{ color: 'var(--ink-muted)' }}>{actionLabels[entry.action] || entry.action}</span></span>
                          <span style={{ fontSize: 10, color: 'var(--ink-muted)', whiteSpace: 'nowrap' }}>
                            {format(new Date(Number(entry.created_at) || entry.created_at), 'MMM d, h:mm a')}
                          </span>
                        </div>
                        {entry.comment && <div style={{ fontSize: 11, color: 'var(--ink-muted)', fontStyle: 'italic', marginTop: 3 }}>"{entry.comment}"</div>}
                      </div>
                    );
                  }) : (
                    <div style={{ fontSize: 13, color: 'var(--ink-muted)', fontStyle: 'italic' }}>
                      {viewTask.ticket_type_id ? 'No workflow history yet.' : 'Activity log is available for XLR8 tickets only.'}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
