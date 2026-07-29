import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Plus, CheckSquare, Send, X, Play, Pause, Check, Clock, AlertTriangle, Pencil } from 'lucide-react';
import Layout from '../components/Layout/Layout';
import Pagination from '../components/UI/Pagination';

const PAGE_SIZE = 7;
import Badge from '../components/UI/Badge';
import Avatar from '../components/UI/Avatar';
import Drawer from '../components/UI/Drawer';
import { useAuth } from '../contexts/AuthContext';
import { tasksApi, projectsApi, usersApi, approvalsApi, capacityApi } from '../services/api';
import { Task, Project, User } from '../types';
import '../css/pages/Tasks.css';

export default function Tasks() {
  const { user } = useAuth();
  const [tasks, setTasks]       = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers]       = useState<User[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showModal, setShowModal]               = useState(false);
  const [assignTab, setAssignTab]               = useState<'working_person_id'|'task_manager_id'>('working_person_id');
  const [roleTab, setRoleTab]                   = useState<'admin'|'manager'|'employee'>('employee');
  const [approvalFlow, setApprovalFlow]         = useState<User[]>([]);
  const [flowRoleTab, setFlowRoleTab]           = useState<'admin'|'manager'|'employee'|'client'>('employee');
  const [flowCategoryTab, setFlowCategoryTab]   = useState<number | 'all'>('all');
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [selectedTask, setSelectedTask]         = useState<Task | null>(null);
  const [approvalTitle, setApprovalTitle]       = useState('');
  const [filterStatus, setFilterStatus]         = useState('all');
  const [editTask, setEditTask]                 = useState<Task | null>(null);
  const [editForm, setEditForm]                 = useState({ title: '', description: '', due_date: '', due_time: '', est_hours: '', est_minutes: '0', working_person_id: '', task_manager_id: '' });
  const [editAssignTab, setEditAssignTab]       = useState<'working_person_id'|'task_manager_id'>('working_person_id');
  const [editRoleTab, setEditRoleTab]           = useState<'admin'|'manager'|'employee'>('employee');

  const [form, setForm] = useState({
    title: '', description: '', project_id: '',
    working_person_id: '', task_manager_id: '',
    due_date: '', due_time: '', checklist: [''] as string[],
    est_hours: '', est_minutes: '0',
  });
  const [capacityWarnings, setCapacityWarnings] = useState<string[]>([]);

  const canCreate = user?.role !== 'client';
  const [podTab, setPodTab] = useState<'pod1' | 'pod2'>('pod1');

  const load = async (pod?: string) => {
    setLoading(true);
    const podParam = user?.role === 'admin' ? pod : undefined;
    const [t, p] = await Promise.allSettled([tasksApi.list(undefined, podParam), projectsApi.list()]);
    if (t.status === 'fulfilled') setTasks(t.value.data);
    if (p.status === 'fulfilled') setProjects(p.value.data);
    setLoading(false);
    if (canCreate) {
      try { const u = await usersApi.list(); setUsers(u.data); } catch {}
    }
  };

  useEffect(() => { load(podTab); }, [podTab]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const estHrs = form.est_hours ? Number(form.est_hours) + Number(form.est_minutes) / 60 : null;
      const res = await tasksApi.create({
        title: form.title,
        description: form.description || null,
        project_id: Number(form.project_id),
        working_person_id: form.working_person_id ? Number(form.working_person_id) : null,
        task_manager_id: form.task_manager_id ? Number(form.task_manager_id) : null,
        due_date: form.due_date || null,
        due_time: form.due_time || null,
        checklist: form.checklist.filter(Boolean),
        estimated_hours: estHrs,
        approval_flow: approvalFlow.map(u => u.id),
      });
      if (res.data.warnings?.length) setCapacityWarnings(res.data.warnings);
      setShowModal(false);
      load();
    } catch (err: any) { alert(err.response?.data?.error || 'Error'); }
  };

  const checkCapacity = async () => {
    const estHrs = form.est_hours ? Number(form.est_hours) + Number(form.est_minutes) / 60 : 0;
    if (!estHrs) return;
    const idsToCheck = [form.working_person_id].filter(Boolean).map(Number);
    if (!idsToCheck.length) return;

    // Scale capacity by task duration (7h per working day)
    let capacityDays = 1;
    if (form.due_date) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const due = new Date(form.due_date + 'T00:00:00');
      const diffDays = Math.round((due.getTime() - today.getTime()) / 86_400_000);
      if (diffDays > 1) capacityDays = diffDays;
    }
    const capacityHours = capacityDays * 7;

    try {
      const warns: string[] = [];
      for (const uid of idsToCheck) {
        const res = await capacityApi.check(uid);
        const total = res.data.estimated_hours_assigned + estHrs;
        if (total > capacityHours) {
          const assignee = users.find((u) => u.id === uid);
          const limitLabel = capacityDays > 1 ? `${capacityDays} days × 7h = ${capacityHours}h` : '7h';
          warns.push(`${assignee?.name || 'Assignee'} will be over capacity — ${res.data.estimated_hours_assigned.toFixed(1)}h already assigned + ${estHrs.toFixed(1)}h this task = ${total.toFixed(1)} / ${limitLabel}`);
        }
      }
      setCapacityWarnings(warns);
    } catch { /* silent */ }
  };

  const handleAccept = async (taskId: number, action: 'accept' | 'decline') => {
    await tasksApi.accept(taskId, action);
    load();
  };

  const handleTimer = async (taskId: number, action: 'start' | 'pause' | 'done') => {
    await tasksApi.timer(taskId, action);
    load();
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this task?')) return;
    try { await tasksApi.delete(id); load(); }
    catch (err: any) { alert(err.response?.data?.error || 'Delete failed'); }
  };

  const openEdit = (task: Task) => {
    const estH = task.estimated_hours ?? 0;
    const employeeAssignee = task.assignees?.find(a => a.assignee_role === 'employee' || a.assignee_role === 'worker' as any);
    const managerAssignee  = task.assignees?.find(a => a.assignee_role === 'manager');
    setEditTask(task);
    setEditAssignTab('working_person_id');
    setEditRoleTab('employee');
    setEditForm({
      title:             task.title,
      description:       (task as any).description ?? '',
      due_date:          task.due_date ?? '',
      due_time:          task.due_time ?? '',
      est_hours:         estH > 0 ? String(Math.floor(estH)) : '',
      est_minutes:       estH > 0 ? String(Math.round((estH % 1) * 60)) : '0',
      working_person_id: employeeAssignee ? String(employeeAssignee.user_id) : '',
      task_manager_id:   managerAssignee  ? String(managerAssignee.user_id)  : '',
    });
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTask) return;
    const estHrs = editForm.est_hours
      ? Number(editForm.est_hours) + Number(editForm.est_minutes) / 60
      : null;
    try {
      await tasksApi.update(editTask.id, {
        title:               editForm.title,
        description:         editForm.description || null,
        due_date:            editForm.due_date || null,
        due_time:            editForm.due_time || null,
        estimated_hours:     estHrs,
        working_person_id: editForm.working_person_id || null,
        task_manager_id:   editForm.task_manager_id   || null,
      });
      setEditTask(null);
      load();
    } catch (err: any) { alert(err.response?.data?.error || 'Error'); }
  };

  const submitApproval = async () => {
    if (!selectedTask) return;
    try {
      await approvalsApi.submit({ task_id: selectedTask.id, title: approvalTitle });
      setShowApprovalModal(false);
      load();
    } catch (err: any) { alert(err.response?.data?.error || 'Error'); }
  };

  const addItem = () => setForm((f) => ({ ...f, checklist: [...f.checklist, ''] }));
  const updItem = (i: number, v: string) => { const c = [...form.checklist]; c[i] = v; setForm((f) => ({ ...f, checklist: c })); };
  const delItem = (i: number) => setForm((f) => ({ ...f, checklist: f.checklist.filter((_, idx) => idx !== i) }));

  const [page, setPage] = useState(1);
  const [dateFilter, setDateFilter] = useState('');

  const statuses = ['all', 'todo', 'in_progress', 'in_review', 'overdue', 'completed'];
  const filtered = tasks.filter((t) => {
    if (filterStatus !== 'all' && t.status !== filterStatus) return false;
    if (dateFilter && t.due_date) {
      const taskDate = t.due_date.slice(0, 10);
      if (taskDate !== dateFilter) return false;
    } else if (dateFilter && !t.due_date) {
      return false;
    }
    return true;
  });
  const totalPages  = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated   = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <Layout>
      <div className="page-wrap">
        <div className="tasks-top">
          <div>
            <h2 className="page-title">{user?.role === 'employee' ? 'My Tasks' : 'All Tasks'}</h2>
            <p className="page-subtitle">
              {filtered.length} task{filtered.length !== 1 ? 's' : ''}
              {filtered.filter((t) => t.status === 'overdue').length > 0 &&
                ` · ${filtered.filter((t) => t.status === 'overdue').length} overdue`}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Pod tabs — admin only */}
            {user?.role === 'admin' && (
              <div className="filter-bar">
                {(['pod1', 'pod2'] as const).map((p) => (
                  <button
                    key={p}
                    className={`filter-tab${podTab === p ? ' active' : ''}`}
                    style={podTab === p ? {} : {}}
                    onClick={() => setPodTab(p)}
                  >
                    {p === 'pod1' ? 'Pod 1' : 'Pod 2'}
                  </button>
                ))}
              </div>
            )}
            <div className="filter-bar">
              {statuses.map((s) => (
                <button key={s} onClick={() => { setFilterStatus(s); setPage(1); }} className={`filter-tab${filterStatus === s ? ' active' : ''}`}>
                  {s === 'all' ? 'All' : s.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                </button>
              ))}
            </div>
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
            {canCreate && (
              <button className="btn-primary" onClick={() => { setForm({ title: '', description: '', project_id: '', working_person_id: '', task_manager_id: '', due_date: '', due_time: '', checklist: [''], est_hours: '', est_minutes: '0' }); setCapacityWarnings([]); setApprovalFlow([]); setShowModal(true); }}>
                <Plus size={14} /> New task
              </button>
            )}
          </div>
        </div>

        {loading && <p className="page-subtitle">Loading…</p>}

        <div className="tasks-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                {['Task', 'Project', 'Assigned to', 'Due', 'Est.', 'Status', 'Checklist', ''].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginated.map((task) => (
                <tr key={task.id}>
                  <td>
                    <div className="task-cell-main">
                      <div className={`task-status-dot task-status-dot--${task.status}`} />
                      <div>
                        <p className="task-cell-title">{task.title}</p>
                        {task.client_name && <p className="task-cell-sub">{task.client_name}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="task-cell-sub">{task.project_name}</td>
                  <td>
                    {(task.assignees?.length ?? 0) > 0
                      ? <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {task.assignees.map((a) => {
                            const isWorking = task.active_runner_ids?.includes(a.user_id);
                            const ar = a.assignee_role ?? 'employee';
                            const arColor = ar === 'manager' ? 'var(--orange)' : 'var(--green)';
                            const arLabel = ar === 'manager' ? 'M' : 'E';
                            const arFull  = ar === 'manager' ? 'Manager' : 'Employee';
                            return (
                              <div key={a.user_id} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                                <div style={{ position: 'relative' }}>
                                  <Avatar name={a.name} color={a.avatar_color} size="sm" title={`${a.name} · ${arFull}`} />
                                  {isWorking && (
                                    <span style={{ position: 'absolute', bottom: -1, right: -1, width: 7, height: 7, background: 'var(--green)', borderRadius: '50%', border: '1.5px solid #fff' }} title="Working now" />
                                  )}
                                </div>
                                <span style={{ fontSize: 9, fontWeight: 800, color: arColor, lineHeight: 1 }}>{arLabel}</span>
                              </div>
                            );
                          })}
                        </div>
                      : <span style={{ color: 'var(--sand-border)' }}>—</span>}
                  </td>
                  <td>
                    {task.due_date
                      ? <span className={`task-date${task.status === 'overdue' ? ' task-date--over' : ''}`}>
                          {format(new Date(task.due_date), 'MMM d')}
                        </span>
                      : <span style={{ color: 'var(--sand-border)' }}>—</span>}
                  </td>
                  <td>
                    {task.estimated_hours
                      ? <span style={{ fontSize: 12, color: 'var(--ink-muted)', display: 'flex', alignItems: 'center', gap: 3 }}>
                          <Clock size={11} />{task.estimated_hours}h
                        </span>
                      : <span style={{ color: 'var(--sand-border)' }}>—</span>}
                  </td>
                  <td>
                    <Badge status={task.status} />
                  </td>
                  <td>
                    {task.checklist_total > 0
                      ? <span className="task-checklist-badge">{task.checklist_done}/{task.checklist_total}</span>
                      : <span style={{ color: 'var(--sand-border)' }}>—</span>}
                  </td>
                  <td>
                    <div className="task-actions" style={{ opacity: 1 }}>
                      {/* Accept / Decline for employee assigned tasks */}
                      {user?.role === 'employee' && task.my_acceptance_status === 'pending' && (
                        <>
                          <button
                            className="icon-action"
                            title="Accept task"
                            style={{ background: 'rgba(76,175,125,0.12)', color: 'var(--green)' }}
                            onClick={() => handleAccept(task.id, 'accept')}
                          ><Check size={12} /></button>
                          <button
                            className="icon-action danger"
                            title="Decline task"
                            onClick={() => handleAccept(task.id, 'decline')}
                          ><X size={12} /></button>
                        </>
                      )}
                      {/* In Review badge */}
                      {task.status === 'in_review' && (
                        <span style={{
                          fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
                          padding: '3px 10px', borderRadius: 99,
                          background: 'rgba(155,89,182,0.12)', color: 'var(--purple)',
                          border: '1px solid rgba(155,89,182,0.22)', whiteSpace: 'nowrap',
                        }}>In Review</span>
                      )}
                      {/* Timer controls for accepted tasks */}
                      {user?.role === 'employee' && task.my_acceptance_status === 'accepted' && task.status !== 'completed' && task.status !== 'in_review' && (
                        <>
                          {task.timer_running ? (
                            <button className="icon-action" title="Pause" style={{ background: 'rgba(244,115,38,0.12)', color: 'var(--orange)' }} onClick={() => handleTimer(task.id, 'pause')}>
                              <Pause size={12} />
                            </button>
                          ) : (
                            <button className="icon-action" title="Start timer" style={{ background: 'rgba(76,175,125,0.12)', color: 'var(--green)' }} onClick={() => handleTimer(task.id, 'start')}>
                              <Play size={12} />
                            </button>
                          )}
                          {task.status === 'in_progress' && (
                            <button className="icon-action" title="Mark done" style={{ background: 'var(--ink)', color: '#fff' }} onClick={() => handleTimer(task.id, 'done')}>
                              <Check size={12} />
                            </button>
                          )}
                        </>
                      )}
                      {canCreate && task.status !== 'completed' && (
                        <button
                          className="icon-action"
                          title="Submit for approval"
                          onClick={() => { setSelectedTask(task); setApprovalTitle(task.title); setShowApprovalModal(true); }}
                        >
                          <Send size={12} />
                        </button>
                      )}
                      {(user?.role === 'admin' || user?.role === 'manager' || task.created_by === user?.id) && task.status !== 'completed' && (
                        <button className="icon-action" title="Edit task" onClick={() => openEdit(task)}>
                          <Pencil size={11} />
                        </button>
                      )}
                      {(user?.role === 'admin' || user?.role === 'manager') && (
                        <button className="icon-action danger" onClick={() => handleDelete(task.id)}>
                          <span style={{ fontSize: 14, fontWeight: 700 }}>×</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && !loading && (
                <tr><td colSpan={8} className="empty-state">No tasks found</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} totalPages={totalPages} total={filtered.length} pageSize={PAGE_SIZE} onPage={setPage} />
      </div>

      {showModal && (
        <div className="drawer-overlay">
          <div className="drawer-backdrop" onClick={() => setShowModal(false)} />
          <div className="drawer-panel">
            <form onSubmit={handleSubmit} style={{ display: 'contents' }}>

              {/* Header */}
              <div className="drawer-header">
                <div className="drawer-header__label">New Task</div>
                <div className="drawer-header__row">
                  <input
                    className="drawer-title-input"
                    placeholder="Task title…"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    required
                    autoFocus
                  />
                  <button type="button" className="drawer-close" onClick={() => setShowModal(false)}>×</button>
                </div>
              </div>

              {/* Body */}
              <div className="drawer-body">

                {/* Info card — Project + Due date */}
                <div className="drawer-info-card">
                  <div className="drawer-info-field">
                    <div className="drawer-info-label">Project *</div>
                    <select className="form-input" style={{ fontSize: 12 }} value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })} required>
                      <option value="">Select…</option>
                      {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div className="drawer-info-field">
                    <div className="drawer-info-label">Due date</div>
                    <input type="date" className="form-input" style={{ fontSize: 12 }} value={form.due_date} onChange={(e) => { setForm({ ...form, due_date: e.target.value }); setTimeout(checkCapacity, 0); }} />
                  </div>
                  <div className="drawer-info-field">
                    <div className="drawer-info-label">Due time</div>
                    <input type="time" className="form-input" style={{ fontSize: 12 }} value={form.due_time} onChange={(e) => setForm({ ...form, due_time: e.target.value })} />
                  </div>
                  <div className="drawer-info-field">
                    <div className="drawer-info-label">Est. time</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input type="number" min="0" max="23" placeholder="0h" className="form-input" style={{ fontSize: 12, flex: 1 }} value={form.est_hours} onChange={(e) => setForm({ ...form, est_hours: e.target.value })} onBlur={checkCapacity} />
                      <input type="number" min="0" max="59" placeholder="0m" className="form-input" style={{ fontSize: 12, flex: 1 }} value={form.est_minutes} onChange={(e) => setForm({ ...form, est_minutes: e.target.value })} onBlur={checkCapacity} />
                    </div>
                  </div>
                </div>

                {/* Description */}
                <div className="drawer-section">
                  <div className="drawer-section-title">Description</div>
                  <textarea
                    className="form-input"
                    style={{ resize: 'none', fontSize: 13 }}
                    rows={3}
                    placeholder="Add a description…"
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                  />
                </div>

                {/* Assignment */}
                {(() => {
                  const SLOTS = [
                    { key: 'working_person_id' as const, label: 'Employee', accent: 'var(--green)',  eligibleRoles: ['admin','manager','employee'] as const },
                    { key: 'task_manager_id'   as const, label: 'Manager',  accent: 'var(--orange)', eligibleRoles: ['admin','manager'] as const },
                  ];
                  const active = SLOTS.find(s => s.key === assignTab)!;
                  const pool = users.filter(u => (active.eligibleRoles as readonly string[]).includes(u.role));
                  const selectedId = form[active.key];
                  const selectedUser = pool.find(u => String(u.id) === selectedId);
                  return (
                    <div className="drawer-section">
                      <div className="drawer-section-title">Assignment</div>

                      {/* Tabs */}
                      <div className="ap-tabs">
                        {SLOTS.map(s => {
                          const sel = form[s.key];
                          const selUser = users.find(u => String(u.id) === sel);
                          return (
                            <button
                              key={s.key}
                              type="button"
                              className={`ap-tab${assignTab === s.key ? ' ap-tab--active' : ''}`}
                              style={assignTab === s.key ? { '--ap-accent': s.accent } as any : undefined}
                              onClick={() => setAssignTab(s.key)}
                            >
                              {selUser
                                ? <><div className="ap-avatar ap-tab__avatar" style={{ background: selUser.avatar_color }}>{selUser.name.split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2)}</div>{s.label}</>
                                : <>{s.label}<span className="ap-tab__dot" /></>}
                            </button>
                          );
                        })}
                      </div>

                      {/* Active slot chips */}
                      <div className="ap-slot">
                        {selectedUser && (
                          <div className="ap-selected" style={{ borderColor: active.accent }}>
                            <div className="ap-avatar ap-avatar--lg" style={{ background: selectedUser.avatar_color }}>
                              {selectedUser.name.split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2)}
                            </div>
                            <div style={{ flex: 1 }}>
                              <div className="ap-selected__name">{selectedUser.name}</div>
                              <div className="ap-selected__role">{selectedUser.role}</div>
                            </div>
                            <button type="button" className="ap-slot__clear" onClick={() => { setForm({ ...form, [active.key]: '' }); setTimeout(checkCapacity, 0); }}>× Clear</button>
                          </div>
                        )}

                        {/* Role tabs */}
                        {(() => {
                          const availableRoles = (['admin','manager','employee'] as const).filter(r => (active.eligibleRoles as readonly string[]).includes(r));
                          const activeRole = availableRoles.includes(roleTab) ? roleTab : availableRoles[0];
                          const visibleUsers = pool.filter(u => u.role === activeRole);
                          return (
                            <>
                              <div className="ap-role-tabs">
                                {availableRoles.map(r => (
                                  <button key={r} type="button"
                                    className={`ap-role-tab${activeRole === r ? ' ap-role-tab--active' : ''}`}
                                    onClick={() => setRoleTab(r)}
                                  >
                                    {r.charAt(0).toUpperCase() + r.slice(1)}
                                    <span className="ap-role-tab__count">{pool.filter(u => u.role === r).length}</span>
                                  </button>
                                ))}
                              </div>
                              <div className="ap-group__chips" style={{ marginTop: 8 }}>
                                {visibleUsers.length === 0 && <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>No {activeRole}s</span>}
                                {visibleUsers.map(u => {
                                  const isSelected = String(u.id) === selectedId;
                                  return (
                                    <button key={u.id} type="button"
                                      className={`ap-chip${isSelected ? ' ap-chip--selected' : ''}`}
                                      style={isSelected ? { '--ap-accent': active.accent } as any : undefined}
                                      onClick={() => { setForm({ ...form, [active.key]: isSelected ? '' : String(u.id) }); setTimeout(checkCapacity, 0); }}
                                      title={u.name}
                                    >
                                      <div className="ap-avatar" style={{ background: u.avatar_color }}>
                                        {u.name.split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2)}
                                      </div>
                                      <span className="ap-chip__name">{u.name.split(' ')[0]}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  );
                })()}

                {/* Approvers (Sequential) */}
                {(() => {
                  const FLOW_ROLES = ['employee', 'manager', 'admin', 'client'] as const;
                  const rolePool = users.filter(u => u.role === flowRoleTab);

                  // Category sub-tabs — only relevant for employees
                  const empCategories: { id: number; name: string }[] = [];
                  if (flowRoleTab === 'employee') {
                    const seen = new Set<number>();
                    for (const u of rolePool) {
                      for (const cat of (u.categories ?? [])) {
                        if (!seen.has(cat.id)) { seen.add(cat.id); empCategories.push({ id: cat.id, name: cat.name }); }
                      }
                    }
                  }

                  const pool = flowRoleTab === 'employee' && flowCategoryTab !== 'all'
                    ? rolePool.filter(u => u.categories?.some(c => c.id === flowCategoryTab))
                    : rolePool;

                  const addToFlow = (u: User) => {
                    if (!approvalFlow.find(a => a.id === u.id))
                      setApprovalFlow([...approvalFlow, u]);
                  };
                  const removeFromFlow = (id: number) =>
                    setApprovalFlow(approvalFlow.filter(a => a.id !== id));

                  return (
                    <div className="drawer-section">
                      <div className="drawer-section-title" style={{ textTransform: 'uppercase', fontSize: 11, letterSpacing: '0.06em', color: 'var(--ink-muted)' }}>
                        Approvers (Sequential)
                      </div>

                      {/* Selected approver chips in order */}
                      {approvalFlow.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                          {approvalFlow.map((a, i) => (
                            <div key={a.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px 4px 6px', background: 'var(--bg-sand)', border: '1.5px solid var(--sand-border)', borderRadius: 'var(--r-pill)', fontSize: 12, fontWeight: 600 }}>
                              <span style={{ width: 18, height: 18, borderRadius: '50%', background: a.avatar_color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#fff', fontWeight: 800, flexShrink: 0 }}>
                                {a.name.split(' ').map((n:string)=>n[0]).join('').toUpperCase().slice(0,2)}
                              </span>
                              <span style={{ color: 'var(--ink-muted)', fontWeight: 400, fontSize: 10, marginRight: 2 }}>{i + 1}.</span>
                              {a.name.split(' ')[0]}
                              <button type="button" onClick={() => removeFromFlow(a.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)', padding: 0, lineHeight: 1, fontSize: 14 }}>×</button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Role tabs */}
                      <div className="ap-role-tabs">
                        {FLOW_ROLES.map(r => (
                          <button key={r} type="button"
                            className={`ap-role-tab${flowRoleTab === r ? ' ap-role-tab--active' : ''}`}
                            onClick={() => { setFlowRoleTab(r); setFlowCategoryTab('all'); }}
                          >
                            {r.charAt(0).toUpperCase() + r.slice(1)}
                            <span className="ap-role-tab__count">{users.filter(u => u.role === r).length}</span>
                          </button>
                        ))}
                      </div>

                      {/* Employee category sub-tabs */}
                      {flowRoleTab === 'employee' && empCategories.length > 0 && (
                        <div className="ap-role-tabs" style={{ marginTop: 6, paddingLeft: 4, borderLeft: '2px solid var(--sand-border)' }}>
                          <button type="button"
                            className={`ap-role-tab${flowCategoryTab === 'all' ? ' ap-role-tab--active' : ''}`}
                            onClick={() => setFlowCategoryTab('all')}
                          >
                            All
                            <span className="ap-role-tab__count">{rolePool.length}</span>
                          </button>
                          {empCategories.map(cat => (
                            <button key={cat.id} type="button"
                              className={`ap-role-tab${flowCategoryTab === cat.id ? ' ap-role-tab--active' : ''}`}
                              onClick={() => setFlowCategoryTab(cat.id)}
                            >
                              {cat.name}
                              <span className="ap-role-tab__count">{rolePool.filter(u => u.categories?.some(c => c.id === cat.id)).length}</span>
                            </button>
                          ))}
                        </div>
                      )}

                      {/* User chips for current role / category */}
                      <div className="ap-group__chips" style={{ marginTop: 8 }}>
                        {pool.length === 0 && <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>No {flowRoleTab}s{flowCategoryTab !== 'all' ? ' in this category' : ''}</span>}
                        {pool.map(u => {
                          const inFlow = !!approvalFlow.find(a => a.id === u.id);
                          return (
                            <button key={u.id} type="button"
                              className={`ap-chip${inFlow ? ' ap-chip--selected' : ''}`}
                              style={inFlow ? { '--ap-accent': 'var(--blue)' } as any : undefined}
                              onClick={() => inFlow ? removeFromFlow(u.id) : addToFlow(u)}
                              title={u.name}
                            >
                              <div className="ap-avatar" style={{ background: u.avatar_color }}>
                                {u.name.split(' ').map((n:string)=>n[0]).join('').toUpperCase().slice(0,2)}
                              </div>
                              <span className="ap-chip__name">{u.name.split(' ')[0]}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* Capacity warnings */}
                {capacityWarnings.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {capacityWarnings.map((w, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'rgba(244,115,38,0.10)', border: '1.5px solid rgba(244,115,38,0.25)', borderRadius: 'var(--r)', fontSize: 12, color: 'var(--orange)', fontWeight: 600 }}>
                        <AlertTriangle size={13} />{w}
                      </div>
                    ))}
                  </div>
                )}

                {/* Checklist */}
                <div className="drawer-section">
                  <div className="drawer-section-title" style={{ justifyContent: 'space-between' }}>
                    <span>Checklist Goals</span>
                    <button type="button" onClick={addItem} className="checklist-add-btn"><Plus size={11} /> Add item</button>
                  </div>
                  <div className="drawer-checklist">
                    {form.checklist.map((item, i) => (
                      <div key={i} className="drawer-checklist-row">
                        <CheckSquare size={14} style={{ color: 'var(--sand-border)', flexShrink: 0 }} />
                        <input className="form-input" style={{ padding: '8px 12px', fontSize: 13 }} placeholder={`Goal ${i + 1}`} value={item} onChange={(e) => updItem(i, e.target.value)} />
                        <button type="button" onClick={() => delItem(i)} className="icon-action danger" style={{ flexShrink: 0 }}>×</button>
                      </div>
                    ))}
                  </div>
                </div>

              </div>

              {/* Footer */}
              <div className="drawer-footer">
                <button type="submit" className="drawer-submit">
                  <Plus size={15} /> Create Task
                </button>
                <button type="button" className="drawer-cancel" onClick={() => setShowModal(false)}>Cancel</button>
              </div>

            </form>
          </div>
        </div>
      )}

      {showApprovalModal && selectedTask && (
        <Drawer
          label="Submit for Approval"
          title={selectedTask.title}
          onClose={() => setShowApprovalModal(false)}
        >
          <div className="drawer-body">
            <p style={{ fontSize: 13, color: 'var(--ink-muted)', lineHeight: 1.5 }}>
              This will send <strong style={{ color: 'var(--ink)' }}>{selectedTask.title}</strong> to the manager for review.
            </p>
            <div>
              <label className="form-label">Approval title</label>
              <input
                className="form-input"
                value={approvalTitle}
                onChange={(e) => setApprovalTitle(e.target.value)}
                placeholder="e.g. Final design review…"
                autoFocus
              />
            </div>
          </div>
          <div className="drawer-footer">
            <button onClick={submitApproval} className="drawer-submit">Submit for approval</button>
            <button onClick={() => setShowApprovalModal(false)} className="drawer-cancel">Cancel</button>
          </div>
        </Drawer>
      )}

      {/* ── Edit Task Drawer ── */}
      {editTask && (
        <div className="drawer-overlay">
          <div className="drawer-backdrop" onClick={() => setEditTask(null)} />
          <div className="drawer-panel">
            <form onSubmit={handleEditSubmit} style={{ display: 'contents' }}>

              <div className="drawer-header">
                <div className="drawer-header__label">Edit Task</div>
                <div className="drawer-header__row">
                  <input
                    className="drawer-title-input"
                    value={editForm.title}
                    onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                    required
                    autoFocus
                  />
                  <button type="button" className="drawer-close" onClick={() => setEditTask(null)}>×</button>
                </div>
              </div>

              <div className="drawer-body">

                {/* Info card */}
                <div className="drawer-info-card">
                  <div className="drawer-info-field">
                    <div className="drawer-info-label">Due date</div>
                    <input type="date" className="form-input" style={{ fontSize: 12 }} value={editForm.due_date} onChange={(e) => setEditForm({ ...editForm, due_date: e.target.value })} />
                  </div>
                  <div className="drawer-info-field">
                    <div className="drawer-info-label">Due time</div>
                    <input type="time" className="form-input" style={{ fontSize: 12 }} value={editForm.due_time} onChange={(e) => setEditForm({ ...editForm, due_time: e.target.value })} />
                  </div>
                  <div className="drawer-info-field" style={{ gridColumn: '1 / -1' }}>
                    <div className="drawer-info-label">Estimated time (Capacity hours)</div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <div style={{ flex: 1 }}>
                        <input
                          type="number" min="0" max="23" placeholder="0"
                          className="form-input" style={{ fontSize: 12 }}
                          value={editForm.est_hours}
                          onChange={(e) => setEditForm({ ...editForm, est_hours: e.target.value })}
                        />
                        <div style={{ fontSize: 10, color: 'var(--ink-muted)', marginTop: 3, textAlign: 'center' }}>Hours</div>
                      </div>
                      <div style={{ flex: 1 }}>
                        <input
                          type="number" min="0" max="59" placeholder="0"
                          className="form-input" style={{ fontSize: 12 }}
                          value={editForm.est_minutes}
                          onChange={(e) => setEditForm({ ...editForm, est_minutes: e.target.value })}
                        />
                        <div style={{ fontSize: 10, color: 'var(--ink-muted)', marginTop: 3, textAlign: 'center' }}>Minutes</div>
                      </div>
                      {(editForm.est_hours || editForm.est_minutes !== '0') && (
                        <div style={{ fontSize: 12, color: 'var(--ink-muted)', fontWeight: 600, whiteSpace: 'nowrap', paddingBottom: 14 }}>
                          = {Number(editForm.est_hours || 0)}h {editForm.est_minutes}m
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Current stats */}
                {(editTask.estimated_hours || editTask.due_date) && (
                  <div style={{ background: 'var(--bg-sand)', borderRadius: 12, padding: '12px 16px', display: 'flex', gap: 20 }}>
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Project</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{editTask.project_name}</div>
                    </div>
                    {editTask.estimated_hours && (
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Current Est.</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{editTask.estimated_hours}h</div>
                      </div>
                    )}
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Status</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', textTransform: 'capitalize' }}>{editTask.status.replace('_', ' ')}</div>
                    </div>
                  </div>
                )}

                {/* Description */}
                <div className="drawer-section">
                  <div className="drawer-section-title">Description</div>
                  <textarea
                    className="form-input"
                    style={{ resize: 'none', fontSize: 13 }}
                    rows={3}
                    placeholder="Add a description…"
                    value={editForm.description}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  />
                </div>

                {/* Assignment */}
                {(() => {
                  const SLOTS = [
                    { key: 'working_person_id' as const, label: 'Employee', accent: 'var(--green)',  eligibleRoles: ['admin','manager','employee'] as const },
                    { key: 'task_manager_id'   as const, label: 'Manager',  accent: 'var(--orange)', eligibleRoles: ['admin','manager'] as const },
                  ];
                  const active = SLOTS.find(s => s.key === editAssignTab)!;
                  const pool = users.filter(u => (active.eligibleRoles as readonly string[]).includes(u.role));
                  const selectedId = editForm[active.key];
                  const selectedUser = pool.find(u => String(u.id) === selectedId);
                  const availableRoles = (['admin','manager','employee'] as const).filter(r => (active.eligibleRoles as readonly string[]).includes(r));
                  const activeRole = availableRoles.includes(editRoleTab) ? editRoleTab : availableRoles[0];

                  return (
                    <div className="drawer-section">
                      <div className="drawer-section-title">Assignment</div>
                      <div className="ap-tabs">
                        {SLOTS.map(s => {
                          const sel = editForm[s.key];
                          const selUser = users.find(u => String(u.id) === sel);
                          return (
                            <button key={s.key} type="button"
                              className={`ap-tab${editAssignTab === s.key ? ' ap-tab--active' : ''}`}
                              style={editAssignTab === s.key ? { '--ap-accent': s.accent } as any : undefined}
                              onClick={() => setEditAssignTab(s.key)}
                            >
                              {selUser
                                ? <><div className="ap-avatar ap-tab__avatar" style={{ background: selUser.avatar_color }}>{selUser.name.split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2)}</div>{s.label}</>
                                : <>{s.label}<span className="ap-tab__dot" /></>}
                            </button>
                          );
                        })}
                      </div>
                      <div className="ap-slot">
                        {selectedUser && (
                          <div className="ap-selected" style={{ borderColor: active.accent }}>
                            <div className="ap-avatar ap-avatar--lg" style={{ background: selectedUser.avatar_color }}>
                              {selectedUser.name.split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2)}
                            </div>
                            <div style={{ flex: 1 }}>
                              <div className="ap-selected__name">{selectedUser.name}</div>
                              <div className="ap-selected__role">{selectedUser.role}</div>
                            </div>
                            <button type="button" className="ap-slot__clear"
                              onClick={() => setEditForm({ ...editForm, [active.key]: '' })}>× Clear</button>
                          </div>
                        )}
                        <div className="ap-role-tabs">
                          {availableRoles.map(r => (
                            <button key={r} type="button"
                              className={`ap-role-tab${activeRole === r ? ' ap-role-tab--active' : ''}`}
                              onClick={() => setEditRoleTab(r)}
                            >
                              {r.charAt(0).toUpperCase() + r.slice(1)}
                              <span className="ap-role-tab__count">{pool.filter(u => u.role === r).length}</span>
                            </button>
                          ))}
                        </div>
                        <div className="ap-group__chips" style={{ marginTop: 8 }}>
                          {pool.filter(u => u.role === activeRole).map(u => {
                            const isSelected = String(u.id) === selectedId;
                            return (
                              <button key={u.id} type="button"
                                className={`ap-chip${isSelected ? ' ap-chip--selected' : ''}`}
                                style={isSelected ? { '--ap-accent': active.accent } as any : undefined}
                                onClick={() => setEditForm({ ...editForm, [active.key]: isSelected ? '' : String(u.id) })}
                                title={u.name}
                              >
                                <div className="ap-avatar" style={{ background: u.avatar_color }}>
                                  {u.name.split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2)}
                                </div>
                                <span className="ap-chip__name">{u.name.split(' ')[0]}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })()}

              </div>

              <div className="drawer-footer">
                <button type="submit" className="drawer-submit">
                  <Check size={15} /> Save Changes
                </button>
                <button type="button" className="drawer-cancel" onClick={() => setEditTask(null)}>Cancel</button>
              </div>

            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}
