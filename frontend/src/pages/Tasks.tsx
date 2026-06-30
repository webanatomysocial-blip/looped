import { useEffect, useState, useRef } from 'react';
import { format } from 'date-fns';
import { Plus, CheckSquare, Send, X } from 'lucide-react';
import Layout from '../components/Layout/Layout';
import Header from '../components/Layout/Header';
import Badge from '../components/UI/Badge';
import Avatar from '../components/UI/Avatar';
import Modal from '../components/UI/Modal';
import { useAuth } from '../contexts/AuthContext';
import { tasksApi, projectsApi, usersApi, approvalsApi } from '../services/api';
import { Task, Project, User } from '../types';
import '../css/pages/Tasks.css';

export default function Tasks() {
  const { user } = useAuth();
  const [tasks, setTasks]       = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers]       = useState<User[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showModal, setShowModal]               = useState(false);
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [selectedTask, setSelectedTask]         = useState<Task | null>(null);
  const [approvalTitle, setApprovalTitle]       = useState('');
  const [filterStatus, setFilterStatus]         = useState('all');

  const [form, setForm] = useState({
    title: '', description: '', project_id: '', assignee_ids: [] as number[], due_date: '',
    checklist: [''] as string[],
  });
  const [assigneeSearch, setAssigneeSearch] = useState('');
  const [showAssigneeDropdown, setShowAssigneeDropdown] = useState(false);
  const assigneeRef = useRef<HTMLDivElement>(null);

  const canCreate = user?.role !== 'client';

  const load = async () => {
    setLoading(true);
    const [t, p] = await Promise.allSettled([tasksApi.list(), projectsApi.list()]);
    if (t.status === 'fulfilled') setTasks(t.value.data);
    if (p.status === 'fulfilled') setProjects(p.value.data);
    setLoading(false);
    if (canCreate) {
      try { const u = await usersApi.team(); setUsers(u.data); } catch {}
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (assigneeRef.current && !assigneeRef.current.contains(e.target as Node)) {
        setShowAssigneeDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await tasksApi.create({
        title: form.title,
        description: form.description || null,
        project_id: Number(form.project_id),
        assignee_ids: form.assignee_ids,
        due_date: form.due_date || null,
        checklist: form.checklist.filter(Boolean),
      });
      setShowModal(false);
      load();
    } catch (err: any) { alert(err.response?.data?.error || 'Error'); }
  };

  const handleStatusChange = async (id: number, status: string) => {
    await tasksApi.update(id, { status });
    load();
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this task?')) return;
    await tasksApi.delete(id);
    load();
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

  const statuses = ['all', 'todo', 'in_progress', 'in_review', 'overdue', 'completed'];
  const filtered = filterStatus === 'all' ? tasks : tasks.filter((t) => t.status === filterStatus);

  return (
    <Layout>
      <div className="page-wrap">
        <Header
          action={canCreate ? {
            label: 'New task',
            onClick: () => { setForm({ title: '', description: '', project_id: '', assignee_ids: [], due_date: '', checklist: [''] }); setAssigneeSearch(''); setShowModal(true); },
          } : undefined}
        />

        <div className="tasks-top">
          <div>
            <h2 className="page-title">{user?.role === 'employee' ? 'My Tasks' : 'All Tasks'}</h2>
            <p className="page-subtitle">
              {filtered.length} task{filtered.length !== 1 ? 's' : ''}
              {filtered.filter((t) => t.status === 'overdue').length > 0 &&
                ` · ${filtered.filter((t) => t.status === 'overdue').length} overdue`}
            </p>
          </div>
          <div className="filter-bar">
            {statuses.map((s) => (
              <button key={s} onClick={() => setFilterStatus(s)} className={`filter-tab${filterStatus === s ? ' active' : ''}`}>
                {s === 'all' ? 'All' : s.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
              </button>
            ))}
          </div>
        </div>

        {loading && <p className="page-subtitle">Loading…</p>}

        <div className="tasks-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                {['Task', 'Project', 'Assigned to', 'Due', 'Status', 'Checklist', ''].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((task) => (
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
                      ? <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          {task.assignees.slice(0, 3).map((a) => (
                            <Avatar key={a.user_id} name={a.name} color={a.avatar_color} size="sm" />
                          ))}
                          {task.assignees.length > 3 && (
                            <span className="task-cell-sub">+{task.assignees.length - 3}</span>
                          )}
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
                    {user?.role === 'admin' || user?.role === 'manager' ? (
                      <select
                        value={task.status}
                        onChange={(e) => handleStatusChange(task.id, e.target.value)}
                        className="task-status-select"
                      >
                        {['todo', 'in_progress', 'in_review', 'overdue', 'completed'].map((s) => (
                          <option key={s} value={s}>{s.replace('_', ' ')}</option>
                        ))}
                      </select>
                    ) : <Badge status={task.status} />}
                  </td>
                  <td>
                    {task.checklist_total > 0
                      ? <span className="task-checklist-badge">{task.checklist_done}/{task.checklist_total}</span>
                      : <span style={{ color: 'var(--sand-border)' }}>—</span>}
                  </td>
                  <td>
                    <div className="task-actions">
                      {canCreate && task.status !== 'in_review' && task.status !== 'completed' && (
                        <button
                          className="icon-action"
                          title="Submit for approval"
                          onClick={() => { setSelectedTask(task); setApprovalTitle(task.title); setShowApprovalModal(true); }}
                        >
                          <Send size={12} />
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
                <tr><td colSpan={7} className="empty-state">No tasks found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <Modal title="New task" onClose={() => setShowModal(false)} size="lg">
          <form onSubmit={handleSubmit}>
            <div className="modal-form-row">
              <label className="form-label">Title *</label>
              <input className="form-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
            </div>
            <div className="modal-form-row">
              <label className="form-label">Description</label>
              <textarea className="form-input" style={{ resize: 'none' }} rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="modal-form-grid">
              <div>
                <label className="form-label">Project *</label>
                <select className="form-input" value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })} required>
                  <option value="">Select project</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Assign to</label>
                <div className="assignee-picker" ref={assigneeRef}>
                  <div
                    className="assignee-picker__box form-input"
                    onClick={() => setShowAssigneeDropdown((v) => !v)}
                  >
                    {form.assignee_ids.length === 0 && (
                      <span className="assignee-picker__placeholder">Select people…</span>
                    )}
                    {form.assignee_ids.map((uid) => {
                      const u = users.find((u) => u.id === uid);
                      return u ? (
                        <span key={uid} className="assignee-pill">
                          <Avatar name={u.name} color={u.avatar_color} size="sm" />
                          {u.name.split(' ')[0]}
                          <button
                            type="button"
                            className="assignee-pill__remove"
                            onClick={(e) => { e.stopPropagation(); setForm((f) => ({ ...f, assignee_ids: f.assignee_ids.filter((id) => id !== uid) })); }}
                          ><X size={10} /></button>
                        </span>
                      ) : null;
                    })}
                  </div>
                  {showAssigneeDropdown && (
                    <div className="assignee-picker__dropdown">
                      <input
                        className="assignee-picker__search"
                        placeholder="Search…"
                        value={assigneeSearch}
                        onChange={(e) => setAssigneeSearch(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                      />
                      {users
                        .filter((u) => u.role !== 'client' && u.name.toLowerCase().includes(assigneeSearch.toLowerCase()))
                        .map((u) => {
                          const selected = form.assignee_ids.includes(u.id);
                          return (
                            <div
                              key={u.id}
                              className={`assignee-picker__option${selected ? ' selected' : ''}`}
                              onClick={() => {
                                setForm((f) => ({
                                  ...f,
                                  assignee_ids: selected
                                    ? f.assignee_ids.filter((id) => id !== u.id)
                                    : [...f.assignee_ids, u.id],
                                }));
                              }}
                            >
                              <Avatar name={u.name} color={u.avatar_color} size="sm" />
                              <span>{u.name}</span>
                              {selected && <span className="assignee-picker__check">✓</span>}
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="modal-form-row">
              <label className="form-label">Due date</label>
              <input type="date" className="form-input" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
            </div>
            <div className="modal-form-row">
              <div className="checklist-header">
                <label className="form-label" style={{ marginBottom: 0 }}>Checklist</label>
                <button type="button" onClick={addItem} className="checklist-add-btn">
                  <Plus size={11} /> Add item
                </button>
              </div>
              <div className="checklist-wrap">
                {form.checklist.map((item, i) => (
                  <div key={i} className="checklist-row">
                    <CheckSquare size={14} style={{ color: 'var(--sand-border)', flexShrink: 0 }} />
                    <input className="form-input" style={{ padding: '8px 14px' }} placeholder={`Item ${i + 1}`} value={item} onChange={(e) => updItem(i, e.target.value)} />
                    <button type="button" onClick={() => delItem(i)} className="icon-action danger" style={{ flexShrink: 0 }}>×</button>
                  </div>
                ))}
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
              <button type="submit" className="btn-primary">Create task</button>
            </div>
          </form>
        </Modal>
      )}

      {showApprovalModal && selectedTask && (
        <Modal title="Submit for approval" onClose={() => setShowApprovalModal(false)} size="sm">
          <div>
            <p className="modal-info">Submit <strong>{selectedTask.title}</strong> for manager review.</p>
            <div className="modal-form-row">
              <label className="form-label">Approval title</label>
              <input className="form-input" value={approvalTitle} onChange={(e) => setApprovalTitle(e.target.value)} />
            </div>
            <div className="modal-actions">
              <button onClick={() => setShowApprovalModal(false)} className="btn-secondary">Cancel</button>
              <button onClick={submitApproval} className="btn-primary">Submit</button>
            </div>
          </div>
        </Modal>
      )}
    </Layout>
  );
}
