import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { Plus, MoreHorizontal, ArrowUpRight } from 'lucide-react';
import Layout from '../components/Layout/Layout';
import Avatar from '../components/UI/Avatar';
import { useAuth } from '../contexts/AuthContext';
import { projectsApi, tasksApi, approvalsApi } from '../services/api';
import { Project, Task, Approval } from '../types';
import '../css/pages/Dashboard.css';

export default function Dashboard() {
  useAuth();
  const [projects, setProjects]           = useState<Project[]>([]);
  const [tasks, setTasks]                 = useState<Task[]>([]);
  const [approvals, setApprovals]         = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([projectsApi.list(), tasksApi.list(), approvalsApi.list()])
      .then(([p, t, a]) => {
        setProjects(p.data);
        setTasks(t.data);
        setApprovals(a.data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const totalTasks       = tasks.length;
  const completedTasks   = tasks.filter((t) => t.status === 'completed').length;
  const pendingApprovals = approvals.filter((a) => a.status !== 'approved').length;
  const completePct      = totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const pendingTasks = tasks
    .filter((t) => t.status !== 'completed')
    .sort((a, b) => {
      const order: Record<string, number> = { overdue: 0, in_progress: 1, in_review: 2, todo: 3 };
      return (order[a.status] ?? 4) - (order[b.status] ?? 4);
    });

  if (loading) return (
    <Layout>
      <div className="empty-state">Loading...</div>
    </Layout>
  );

  return (
    <Layout>
      <div className="page-wrap">
        

        {/* Row 1 */}
        <div className="dash-grid-top">
          {/* Pending work list */}
          <div className="pending-card">
            <div className="pending-card__header">
              <div>
                <p className="pending-card__title">Pending Work</p>
                <p className="pending-card__sub">{pendingTasks.length} task{pendingTasks.length !== 1 ? 's' : ''} remaining</p>
              </div>
              <Link to="/tasks" className="pending-card__link">
                View all <ArrowUpRight size={12} />
              </Link>
            </div>

            <div className="pending-card__list">
              {pendingTasks.length === 0 && (
                <p className="pending-card__empty">All tasks are completed 🎉</p>
              )}
              {pendingTasks.slice(0, 6).map((task) => (
                <div key={task.id} className="pending-row">
                  <div className={`pending-row__dot pending-row__dot--${task.status}`} />
                  <div className="pending-row__info">
                    <p className="pending-row__title">{task.title}</p>
                    <p className="pending-row__project">{task.project_name}</p>
                  </div>
                  <div className="pending-row__right">
                    {task.due_date && (
                      <span className={`pending-row__due${task.status === 'overdue' ? ' pending-row__due--over' : ''}`}>
                        {format(new Date(task.due_date), 'MMM d')}
                      </span>
                    )}
                    {task.assigned_name ? (
                      <div className="pending-row__assignee">
                        <Avatar name={task.assigned_name} color={task.assigned_color || '#6366f1'} size="sm" />
                        <span className="pending-row__assignee-name">{task.assigned_name.split(' ')[0]}</span>
                      </div>
                    ) : (
                      <span className="pending-row__unassigned">Unassigned</span>
                    )}
                    <span className={`pending-row__status pending-row__status--${task.status}`}>
                      {task.status.replace('_', ' ')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Dark project card */}
          <div className="projects-dark-card">
            <div className="projects-dark-card__header">
              <p>Your Active Projects</p>
              <Link to="/projects" className="projects-dark-card__link">
                {format(new Date(), 'MMMM')} <ArrowUpRight size={12} />
              </Link>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {projects.slice(0, 4).length === 0 && (
                <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>No projects yet</p>
              )}
              {projects.slice(0, 4).map((p) => (
                <div key={p.id} className="projects-dark-card__row">
                  <div className="projects-dark-card__row-left">
                    <div className={`projects-dark-card__dot projects-dark-card__dot--${p.status}`} />
                    <div>
                      <span className="projects-dark-card__name">{p.name}</span>
                      {p.client_name && (
                        <span className="projects-dark-card__client">{p.client_name}</span>
                      )}
                    </div>
                  </div>
                  <div className="projects-dark-card__members">
                    {p.members.slice(0, 2).map((m) => (
                      <Avatar key={m.user_id} name={m.name} color={m.avatar_color} size="sm" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="projects-dark-card__legend">
              <LegendDark dot="rgba(255,255,255,0.4)" label="Review" />
              <LegendDark dot="var(--yellow)"         label="Active" />
              <LegendDark dot="#4caf7d"               label="Done" />
            </div>
          </div>
        </div>

        {/* Row 2 */}
        <div className="dash-grid-bottom">
          {/* Left column */}
          <div className="dash-left-col">
            {/* Arc progress card */}
            <div className="arc-card">
              <div>
                <p className="arc-card__title">Tasks for Today</p>
                <p className="arc-card__sub">Keep your projects on track</p>
                <Link to="/tasks" className="arc-card__link">View all tasks</Link>
              </div>
              <div className="arc-wrap">
                <ArcProgress pct={completePct} />
                <div className="arc-label">
                  <span className="arc-label__sub">Goal</span>
                  <span className="arc-label__val">{totalTasks}</span>
                </div>
              </div>
            </div>

            {/* Progress card */}
            <div className="progress-card">
              <div className="progress-card__header">
                <p className="progress-card__title">Approvals</p>
                <span className="progress-card__pct">{completePct}%</span>
              </div>
              <p className="progress-card__sub">Completed</p>
              <div className="progress-bar-wrap">
                <div className="progress-bar-fill" style={{ width: `${completePct}%` }} />
                <div className="progress-bar-thumb" style={{ left: `calc(${completePct}% - 8px)` }} />
              </div>
              <div className="progress-card__footer">
                <span>0</span>
                <span>{pendingApprovals} pending</span>
                <span>{approvals.length}</span>
              </div>
            </div>
          </div>

          {/* Recent tasks habits card */}
          <div className="habits-card">
            <div className="habits-card__header">
              <p className="habits-card__title">Recent Tasks</p>
              <Link to="/tasks" className="habits-card__add">
                Add New
                <span className="habits-card__add-icon"><Plus size={12} /></span>
              </Link>
            </div>
            <div>
              {tasks.slice(0, 5).map((task) => (
                <HabitRow key={task.id} task={task} />
              ))}
              {tasks.length === 0 && (
                <p className="empty-state" style={{ padding: '24px 0' }}>No tasks yet</p>
              )}
            </div>
          </div>
        </div>

      </div>
    </Layout>
  );
}

/* Sub-components */

function LegendDark({ dot, label }: { dot: string; label: string }) {
  return (
    <div className="projects-dark-card__legend-item">
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: dot }} />
      <span>{label}</span>
    </div>
  );
}

function ArcProgress({ pct }: { pct: number }) {
  const r    = 36;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ * 0.75;
  const gap  = circ - dash;
  const offset = circ * 0.125;

  return (
    <svg width="90" height="90" style={{ transform: 'rotate(-135deg)' }}>
      <circle cx="45" cy="45" r={r} fill="none" stroke="#E8E0D0" strokeWidth="7" strokeLinecap="round"
        strokeDasharray={`${circ * 0.75} ${circ * 0.25}`} strokeDashoffset={-offset} />
      <circle cx="45" cy="45" r={r} fill="none" stroke="#F47326" strokeWidth="7" strokeLinecap="round"
        strokeDasharray={`${dash} ${gap + circ * 0.25}`} strokeDashoffset={-offset} />
    </svg>
  );
}

function HabitRow({ task }: { task: Task }) {
  const done  = task.checklist_done ?? 0;
  const total = task.checklist_total ?? 6;
  return (
    <div className="habit-row">
      <div className="habit-row__icon">
        <span>{task.project_name?.slice(0, 1).toUpperCase() || '?'}</span>
      </div>
      <div className="habit-row__info">
        <p className="habit-row__title">{task.title}</p>
        <p className="habit-row__sub">{task.project_name}</p>
      </div>
      <div className="habit-row__right">
        <span className="habit-row__count">{done}/{total}</span>
        <div className="session-dots">
          {Array.from({ length: Math.max(total, 1) }).map((_, i) => (
            <div key={i} className={`session-dot${i < done ? ' session-dot--done' : ''}`} />
          ))}
        </div>
        <button className="icon-action"><MoreHorizontal size={14} /></button>
      </div>
    </div>
  );
}
