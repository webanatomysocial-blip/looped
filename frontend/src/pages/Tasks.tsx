import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Plus, CheckSquare, Send, X, Play, Pause, Check, Clock, AlertTriangle, Pencil } from 'lucide-react';
import Layout from '../components/Layout/Layout';
import Pagination from '../components/UI/Pagination';
import { getChecklistForCategory } from '../data/categoryChecklists';

const PAGE_SIZE = 7;

function fmtHours(h: number): string {
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  if (hrs === 0) return `${mins}m`;
  if (mins === 0) return `${hrs}h`;
  return `${hrs}h ${mins}m`;
}
import Badge from '../components/UI/Badge';
import Avatar from '../components/UI/Avatar';
import Drawer from '../components/UI/Drawer';
import { useAuth } from '../contexts/AuthContext';
import { tasksApi, projectsApi, usersApi, approvalsApi, capacityApi, xlr8Api } from '../services/api';
import { Task, Project, User } from '../types';
import '../css/pages/Tasks.css';

export default function Tasks() {
  const { user } = useAuth();
  const [tasks, setTasks]       = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers]       = useState<User[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showModal, setShowModal]               = useState(false);

  const [roleTab, setRoleTab]                   = useState<'admin'|'manager'|'employee'>('employee');
  const [assignCategoryTab, setAssignCategoryTab] = useState<number | 'all'>('all');
  const [approvalFlow, setApprovalFlow]         = useState<User[]>([]);
  const [flowRoleTab, setFlowRoleTab]           = useState<'admin'|'manager'|'employee'|'client'>('employee');
  const [flowCategoryTab, setFlowCategoryTab]   = useState<number | 'all'>('all');
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [selectedTask, setSelectedTask]         = useState<Task | null>(null);
  const [approvalTitle, setApprovalTitle]       = useState('');
  const [filterStatus, setFilterStatus]         = useState('all');
  const [editTask, setEditTask]                 = useState<Task | null>(null);
  const [editForm, setEditForm]                 = useState({ title: '', description: '', due_date: '', due_time: '', est_hours: '', est_minutes: '0', working_person_id: '', task_manager_id: '' });
  const [editChecklist, setEditChecklist]       = useState<{ id: number; text: string; completed: boolean }[]>([]);

  const [editRoleTab, setEditRoleTab]           = useState<'admin'|'manager'|'employee'>('employee');

  const [form, setForm] = useState({
    title: '', description: '', project_id: '',
    working_person_id: '', task_manager_id: '',
    due_date: '', due_time: '',
    checklist: [{ text: '', checked: false }] as { text: string; checked: boolean }[],
    est_hours: '', est_minutes: '0',
    ticket_type_id: '',
  });
  const [ticketTypes, setTicketTypes] = useState<{ id: number; name: string; stages: any[] }[]>([]);
  // XLR8 ticket workflow modal
  const [ticketActionTask, setTicketActionTask] = useState<any>(null);
  const [ticketEligible, setTicketEligible] = useState<any[] | null>(null);
  const [ticketActionLoading, setTicketActionLoading] = useState(false);
  const [ticketDeclineComment, setTicketDeclineComment] = useState('');
  const [showTicketDecline, setShowTicketDecline] = useState(false);
  const [doneConfirmTask, setDoneConfirmTask] = useState<Task | null>(null);
  const [doneModalChecklist, setDoneModalChecklist] = useState<{ id: number; text: string; completed: boolean }[]>([]);
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

  useEffect(() => {
    if (canCreate) xlr8Api.getTicketTypes().then((r) => setTicketTypes(r.data)).catch(() => {});
  }, [canCreate]);

  useEffect(() => {
    const refresh = () => load(podTab);
    window.addEventListener('wd:new-notification', refresh);
    return () => window.removeEventListener('wd:new-notification', refresh);
  }, [podTab]);

  // Auto-fill: actual hours remaining for same-day tasks; 7h per working day for multi-day
  useEffect(() => {
    if (!form.due_date) return;
    const due = new Date(`${form.due_date}T${form.due_time || '23:59'}`);
    const diffMs = due.getTime() - Date.now();
    if (diffMs <= 0) return;
    const diffDays = diffMs / 86400000;
    // Under 1 day → use real time remaining; over 1 day → 7 working hours per day
    const workingMins = diffDays < 1
      ? Math.round(diffMs / 60000)
      : Math.round(diffDays * 7 * 60);
    setForm(f => ({ ...f, est_hours: String(Math.floor(workingMins / 60)), est_minutes: String(workingMins % 60) }));
  }, [form.due_date, form.due_time]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const selectedProject = projects.find(p => String(p.id) === String(form.project_id));
    const isXlr8 = selectedProject?.service_type === 'xlr8';

    if (isXlr8) {
      if (!form.ticket_type_id) { alert('Please select a Ticket Type.'); return; }
      try {
        await xlr8Api.createTicket({
          title: form.title,
          description: form.description || null,
          project_id: Number(form.project_id),
          ticket_type_id: Number(form.ticket_type_id),
          due_date: form.due_date || null,
        });
        setShowModal(false);
        load();
      } catch (err: any) { alert(err.response?.data?.error || 'Error'); }
      return;
    }

    if (approvalFlow.length === 0) {
      alert('Please add at least one approver in the Approvers (Sequential) section.');
      return;
    }
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
        checklist: form.checklist.filter(i => i.text),
        estimated_hours: estHrs,
        approval_flow: approvalFlow.map(u => u.id),
      });
      if (res.data.warnings?.length) setCapacityWarnings(res.data.warnings);
      setShowModal(false);
      load();
    } catch (err: any) { alert(err.response?.data?.error || 'Error'); }
  };

  // ── XLR8 ticket workflow actions ─────────────────────────────────────────
  const openTicketAction = (task: any) => {
    setTicketActionTask(task); setTicketEligible(null); setShowTicketDecline(false); setTicketDeclineComment('');
  };

  const ticketAccept = async () => {
    if (!ticketActionTask) return;
    setTicketActionLoading(true);
    try {
      const r = await xlr8Api.acceptTicket(ticketActionTask.id);
      if (r.data.auto_assigned) { setTicketActionTask(null); load(); }
      else setTicketEligible(r.data.eligible);
    } finally { setTicketActionLoading(false); }
  };

  const ticketAssign = async (assigneeId: number) => {
    if (!ticketActionTask) return;
    setTicketActionLoading(true);
    try { await xlr8Api.assignTicket(ticketActionTask.id, assigneeId); setTicketActionTask(null); load(); }
    finally { setTicketActionLoading(false); }
  };

  const ticketReview = async (action: 'approve' | 'decline', comment?: string) => {
    if (!ticketActionTask) return;
    setTicketActionLoading(true);
    try { await xlr8Api.reviewTicket(ticketActionTask.id, action, comment); setTicketActionTask(null); setShowTicketDecline(false); load(); }
    finally { setTicketActionLoading(false); }
  };

  const ticketEmployeeAccept = async (taskId: number) => {
    setTicketActionLoading(true);
    try { await xlr8Api.employeeAccept(taskId); load(); }
    finally { setTicketActionLoading(false); }
  };

  const ticketEmployeeDeclineInline = async (taskId: number) => {
    try { await xlr8Api.employeeDecline(taskId); load(); }
    catch {}
  };

  const ticketMarkDone = async (taskId: number) => {
    try { await xlr8Api.markDone(taskId); load(); }
    catch {}
  };
  // ─────────────────────────────────────────────────────────────────────────

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

  const handleTimer = async (taskId: number, action: 'start' | 'pause' | 'done', taskObj?: Task) => {
    if (action === 'done' && taskObj) {
      setDoneConfirmTask(taskObj);
      setDoneModalChecklist([]);
      try {
        const full = await tasksApi.get(taskId);
        setDoneModalChecklist((full.data.checklist || []).filter((i: any) => i.completed));
      } catch { /* show modal without checklist */ }
      return;
    }
    tasksApi.timer(taskId, action).then(() => load());
  };

  const toggleDoneItem = async (idx: number) => {
    const item = doneModalChecklist[idx];
    const newCompleted = !item.completed;
    // Optimistic update
    setDoneModalChecklist(prev => prev.map((it, i) => i === idx ? { ...it, completed: newCompleted } : it));
    try { await tasksApi.updateChecklist(doneConfirmTask!.id, item.id, newCompleted); }
    catch { setDoneModalChecklist(prev => prev.map((it, i) => i === idx ? { ...it, completed: !newCompleted } : it)); }
  };

  const confirmDone = async () => {
    if (!doneConfirmTask) return;
    if (doneConfirmTask.ticket_type_id) {
      // XLR8 ticket: close timer + log time + submit to approvals + advance XLR8 workflow
      await xlr8Api.markDone(doneConfirmTask.id);
    } else {
      await tasksApi.timer(doneConfirmTask.id, 'done');
    }
    setDoneConfirmTask(null);
    setDoneModalChecklist([]);
    load();
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this task?')) return;
    try { await tasksApi.delete(id); load(); }
    catch (err: any) { alert(err.response?.data?.error || 'Delete failed'); }
  };

  const openEdit = async (task: Task) => {
    const estH = task.estimated_hours ?? 0;
    const employeeAssignee = task.assignees?.find(a => a.assignee_role === 'employee' || a.assignee_role === 'worker' as any);
    const managerAssignee  = task.assignees?.find(a => a.assignee_role === 'manager');
    setEditTask(task);

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
    // Load existing checklist items
    try {
      const res = await tasksApi.get(task.id);
      setEditChecklist((res.data.checklist || []).map((c: any) => ({ id: c.id, text: c.text, completed: !!c.completed })));
    } catch { setEditChecklist([]); }
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
      // Save any checklist item completions toggled during edit
      await Promise.all(
        editChecklist.map(item => tasksApi.updateChecklist(editTask.id, item.id, item.completed))
      );
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

  const addItem = () => setForm((f) => ({ ...f, checklist: [...f.checklist, { text: '', checked: false }] }));
  const updItem = (i: number, v: string) => { const c = [...form.checklist]; c[i] = { ...c[i], text: v }; setForm((f) => ({ ...f, checklist: c })); };
  const togItem = (i: number) => { const c = [...form.checklist]; c[i] = { ...c[i], checked: !c[i].checked }; setForm((f) => ({ ...f, checklist: c })); };
  const delItem = (i: number) => setForm((f) => ({ ...f, checklist: f.checklist.filter((_, idx) => idx !== i) }));

  const applyEmployeeChecklist = (userId: string) => {
    if (!userId) return;
    const emp = users.find(u => String(u.id) === userId);
    if (!emp?.categories?.length) return;
    const items: { text: string; checked: boolean }[] = [];
    for (const cat of emp.categories) {
      const tpl = getChecklistForCategory(cat.name);
      if (tpl) items.push(...tpl.items.map(i => ({ text: i.text, checked: i.checked })));
    }
    if (items.length) setForm((f) => ({ ...f, checklist: items }));
  };

  // Auto-assign pod manager when employee is selected
  const podManagerFor = (employeeId: string) => {
    if (!employeeId) return '';
    const emp = users.find(u => String(u.id) === employeeId);
    if (!emp?.pod) return '';
    const mgr = users.find(u => u.role === 'manager' && u.pod === emp.pod);
    return mgr ? String(mgr.id) : '';
  };

  const [page, setPage] = useState(1);
  const [dateFilter, setDateFilter] = useState('');

  const statuses = ['all', 'todo', 'in_progress', 'in_review', 'overdue', 'completed'];
  const filtered = tasks.filter((t) => {
    if (filterStatus !== 'all' && t.status !== filterStatus) return false;
    if (dateFilter) {
      const createdDate = t.created_at ? String(t.created_at).slice(0, 10) : '';
      if (createdDate !== dateFilter) return false;
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 10, color: 'var(--ink-muted)', fontWeight: 600, paddingLeft: 2 }}>Added on</span>
                <input
                  type="date"
                  className="form-input"
                  style={{ width: 150, fontSize: 12, padding: '7px 12px' }}
                  value={dateFilter}
                  onChange={(e) => { setDateFilter(e.target.value); setPage(1); }}
                />
              </div>
              {dateFilter && (
                <button
                  className="filter-tab"
                  style={{ padding: '7px 10px', fontSize: 11, marginTop: 18 }}
                  onClick={() => { setDateFilter(''); setPage(1); }}
                >
                  ✕
                </button>
              )}
            </div>
            {canCreate && (
              <button className="btn-primary" onClick={() => { setForm({ title: '', description: '', project_id: '', working_person_id: '', task_manager_id: '', due_date: '', due_time: '', checklist: [{ text: '', checked: false }], est_hours: '', est_minutes: '0', ticket_type_id: '' }); setCapacityWarnings([]); setApprovalFlow([]); setShowModal(true); }}>
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
                          <Clock size={11} />{fmtHours(Number(task.estimated_hours))}
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
                      {/* XLR8 ticket workflow buttons */}
                      {task.ticket_type_id && (() => {
                        const s = task.xlr8_status;
                        const isAssignee = task.xlr8_assignee_id === user?.id;
                        const isManager = user?.role === 'admin' || user?.role === 'manager';
                        const needsAssign = s === 'pending_manager' && !task.xlr8_assignee_id;
                        const needsReview = s === 'pending_manager' && !!task.xlr8_assignee_id;
                        if (needsAssign && isManager) return (
                          <button className="icon-action" title="Accept & Assign ticket" style={{ background: 'rgba(76,175,125,0.12)', color: 'var(--green)', padding: '3px 8px', fontSize: 11, fontWeight: 700, borderRadius: 8, whiteSpace: 'nowrap', gap: 4 }} onClick={() => openTicketAction(task)}>
                            Accept & Assign
                          </button>
                        );
                        if (needsReview && isManager) return (
                          <button className="icon-action" title="Review ticket work" style={{ background: 'rgba(244,115,38,0.12)', color: 'var(--orange)', padding: '3px 8px', fontSize: 11, fontWeight: 700, borderRadius: 8, whiteSpace: 'nowrap' }} onClick={() => openTicketAction(task)}>
                            Review
                          </button>
                        );
                        if (s === 'pending_assignee' && isAssignee) return (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="icon-action" title="Accept ticket" style={{ background: 'rgba(76,175,125,0.12)', color: 'var(--green)' }} onClick={() => ticketEmployeeAccept(task.id)}><Check size={12} /></button>
                            <button className="icon-action danger" title="Decline ticket" onClick={() => ticketEmployeeDeclineInline(task.id)}><X size={12} /></button>
                          </div>
                        );
                        if (s === 'pending_admin' && user?.role === 'admin') return (
                          <button className="icon-action" title="Final approve" style={{ background: 'rgba(124,58,237,0.12)', color: '#7c3aed', padding: '3px 8px', fontSize: 11, fontWeight: 700, borderRadius: 8 }} onClick={async () => { await xlr8Api.adminApprove(task.id); load(); }}>
                            Final Approve
                          </button>
                        );
                        return null;
                      })()}
                      {/* Accept / Decline for employee assigned tasks */}
                      {!task.ticket_type_id && user?.role === 'employee' && task.my_acceptance_status === 'pending' && (
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
                      {/* Timer controls — regular accepted tasks OR XLR8 in_progress tickets */}
                      {user?.role === 'employee' && task.status !== 'completed' && task.status !== 'in_review' &&
                        (task.ticket_type_id ? task.xlr8_status === 'in_progress' && task.xlr8_assignee_id === user.id : task.my_acceptance_status === 'accepted') && (
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
                            <button className="icon-action" title="Mark done" style={{ background: 'var(--ink)', color: '#fff' }}
                              onClick={() => handleTimer(task.id, 'done', task)}>
                              <Check size={12} />
                            </button>
                          )}
                        </>
                      )}
                      {/* Re-assign when employee declined */}
                      {canCreate && user?.role !== 'employee' && task.assignees?.some(a => a.acceptance_status === 'declined') && task.status !== 'completed' && (
                        <button
                          title="Assignee declined — reassign task"
                          onClick={() => openEdit(task)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700, letterSpacing: '0.03em', whiteSpace: 'nowrap', cursor: 'pointer', border: '1.5px solid rgba(231,76,60,0.3)', background: 'rgba(231,76,60,0.08)', color: 'var(--red)' }}
                        >
                          <Send size={10} /> Reassign
                        </button>
                      )}
                      {/* Send Again for rejected approvals */}
                      {canCreate && task.status !== 'completed' && task.has_rejected_approval && (
                        <button
                          title="Approval rejected — resubmit"
                          onClick={() => { setSelectedTask(task); setApprovalTitle(task.title); setShowApprovalModal(true); }}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700, letterSpacing: '0.03em', whiteSpace: 'nowrap', cursor: 'pointer', border: '1.5px solid rgba(244,115,38,0.3)', background: 'rgba(244,115,38,0.08)', color: 'var(--orange)' }}
                        >
                          <Send size={10} /> Send Again
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
                    <select className="form-input" style={{ fontSize: 12 }} value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value, ticket_type_id: '' })} required>
                      <option value="">Select…</option>
                      {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  {(() => {
                    const selProj = projects.find(p => String(p.id) === String(form.project_id));
                    if (selProj?.service_type !== 'xlr8') return null;
                    return (
                      <div className="drawer-info-field">
                        <div className="drawer-info-label">Ticket Type *</div>
                        <select className="form-input" style={{ fontSize: 12 }} value={form.ticket_type_id} onChange={(e) => setForm({ ...form, ticket_type_id: e.target.value })} required>
                          <option value="">Select type…</option>
                          {ticketTypes.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.stages.length} stage{t.stages.length !== 1 ? 's' : ''})</option>)}
                        </select>
                      </div>
                    );
                  })()}
                  <div className="drawer-info-field">
                    <div className="drawer-info-label">Due date</div>
                    <input type="date" className="form-input" style={{ fontSize: 12 }} value={form.due_date} onChange={(e) => { setForm({ ...form, due_date: e.target.value }); setTimeout(checkCapacity, 0); }} />
                  </div>
                  <div className="drawer-info-field">
                    <div className="drawer-info-label">Due time</div>
                    <input type="time" className="form-input" style={{ fontSize: 12 }} value={form.due_time} onChange={(e) => setForm({ ...form, due_time: e.target.value })} />
                  </div>
                  <div className="drawer-info-field">
                    <div className="drawer-info-label">Est. time *</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input type="number" min="0" max="23" placeholder="0h" className="form-input" style={{ fontSize: 12, flex: 1 }} value={form.est_hours} required onChange={(e) => setForm({ ...form, est_hours: e.target.value })} onBlur={checkCapacity} />
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

                {/* Assignment — hidden for XLR8 (manager assigns after ticket is raised) */}
                {(() => {
                  const selProjForAssign = projects.find(p => String(p.id) === String(form.project_id));
                  if (selProjForAssign?.service_type === 'xlr8') return null;
                  const pool = users.filter(u => ['admin','manager','employee'].includes(u.role));
                  const selectedId = form.working_person_id;
                  const selectedUser = pool.find(u => String(u.id) === selectedId);
                  const autoManagerId = podManagerFor(selectedId);
                  const autoManager = autoManagerId ? users.find(u => String(u.id) === autoManagerId) : null;
                  return (
                    <div className="drawer-section">
                      <div className="drawer-section-title">Assignment</div>

                      {/* Auto-manager info */}
                      {autoManager && (
                        <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
                          <div className="ap-avatar" style={{ background: autoManager.avatar_color, width: 18, height: 18, fontSize: 8 }}>
                            {autoManager.name.split(' ').map((n:string)=>n[0]).join('').toUpperCase().slice(0,2)}
                          </div>
                          <span>Manager: <strong style={{ color: 'var(--ink)' }}>{autoManager.name}</strong> (auto-assigned)</span>
                        </div>
                      )}

                      {/* Active slot chips */}
                      <div className="ap-slot">
                        {selectedUser && (
                          <div className="ap-selected" style={{ borderColor: 'var(--green)' }}>
                            <div className="ap-avatar ap-avatar--lg" style={{ background: selectedUser.avatar_color }}>
                              {selectedUser.name.split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2)}
                            </div>
                            <div style={{ flex: 1 }}>
                              <div className="ap-selected__name">{selectedUser.name}</div>
                              <div className="ap-selected__role">{selectedUser.role}</div>
                            </div>
                            <button type="button" className="ap-slot__clear" onClick={() => {
                              setForm((f) => ({ ...f, working_person_id: '', task_manager_id: '', checklist: [{ text: '', checked: false }] }));
                              setTimeout(checkCapacity, 0);
                            }}>× Clear</button>
                          </div>
                        )}

                        {/* Role tabs */}
                        {(() => {
                          const availableRoles = (['admin','manager','employee'] as const);
                          const activeRole = availableRoles.includes(roleTab) ? roleTab : availableRoles[0];
                          const rolePool = pool.filter(u => u.role === activeRole);

                          // Category sub-tabs for employees
                          const empCategories: { id: number; name: string }[] = [];
                          if (activeRole === 'employee') {
                            const seen = new Set<number>();
                            for (const u of rolePool) {
                              for (const cat of (u.categories ?? [])) {
                                if (!seen.has(cat.id)) { seen.add(cat.id); empCategories.push({ id: cat.id, name: cat.name }); }
                              }
                            }
                          }

                          const visibleUsers = activeRole === 'employee' && assignCategoryTab !== 'all'
                            ? rolePool.filter(u => u.categories?.some((c: any) => c.id === assignCategoryTab))
                            : rolePool;

                          return (
                            <>
                              <div className="ap-role-tabs">
                                {availableRoles.map(r => (
                                  <button key={r} type="button"
                                    className={`ap-role-tab${activeRole === r ? ' ap-role-tab--active' : ''}`}
                                    onClick={() => { setRoleTab(r); setAssignCategoryTab('all'); }}
                                  >
                                    {r.charAt(0).toUpperCase() + r.slice(1)}
                                    <span className="ap-role-tab__count">{pool.filter(u => u.role === r).length}</span>
                                  </button>
                                ))}
                              </div>

                              {/* Category sub-tabs — only for employees */}
                              {activeRole === 'employee' && empCategories.length > 0 && (
                                <div className="ap-role-tabs" style={{ marginTop: 6, paddingLeft: 4, borderLeft: '2px solid var(--sand-border)' }}>
                                  <button type="button"
                                    className={`ap-role-tab${assignCategoryTab === 'all' ? ' ap-role-tab--active' : ''}`}
                                    onClick={() => setAssignCategoryTab('all')}
                                  >
                                    All <span className="ap-role-tab__count">{rolePool.length}</span>
                                  </button>
                                  {empCategories.map(cat => (
                                    <button key={cat.id} type="button"
                                      className={`ap-role-tab${assignCategoryTab === cat.id ? ' ap-role-tab--active' : ''}`}
                                      onClick={() => setAssignCategoryTab(cat.id)}
                                    >
                                      {cat.name}
                                      <span className="ap-role-tab__count">{rolePool.filter(u => u.categories?.some((c: any) => c.id === cat.id)).length}</span>
                                    </button>
                                  ))}
                                </div>
                              )}

                              <div className="ap-group__chips" style={{ marginTop: 8 }}>
                                {visibleUsers.length === 0 && <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>No {activeRole}s{assignCategoryTab !== 'all' ? ' in this category' : ''}</span>}
                                {visibleUsers.map(u => {
                                  const isSelected = String(u.id) === selectedId;
                                  return (
                                    <button key={u.id} type="button"
                                      className={`ap-chip${isSelected ? ' ap-chip--selected' : ''}`}
                                      style={isSelected ? { '--ap-accent': 'var(--green)' } as any : undefined}
                                      onClick={() => {
                                        const newId = isSelected ? '' : String(u.id);
                                        const mgr = newId ? podManagerFor(newId) : '';
                                        setForm((f) => ({ ...f, working_person_id: newId, task_manager_id: mgr }));
                                        if (!isSelected) applyEmployeeChecklist(String(u.id));
                                        setTimeout(checkCapacity, 0);
                                      }}
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

                {/* Approvers (Sequential) — hidden for XLR8 projects */}
                {(() => {
                  const FLOW_ROLES = ['employee', 'manager', 'admin', 'client'] as const;
                  const selectedProject = projects.find(p => String(p.id) === String(form.project_id));
                  if (selectedProject?.service_type === 'xlr8') return null;
                  const projectPod = selectedProject?.members
                    .map(m => users.find(u => u.id === m.user_id && u.role === 'employee')?.pod)
                    .find(pod => !!pod) ?? null;
                  const rolePool = users.filter(u => {
                    if (u.role !== flowRoleTab) return false;
                    if (flowRoleTab === 'client' && selectedProject?.client_company_id)
                      return u.client_company_id === selectedProject.client_company_id;
                    if (flowRoleTab === 'manager' && projectPod)
                      return u.pod === projectPod;
                    return true;
                  });

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
                        Approvers (Sequential) <span style={{ color: 'var(--red)', fontWeight: 800 }}>*</span>
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
                            <span className="ap-role-tab__count">{users.filter(u => {
                              if (u.role !== r) return false;
                              if (r === 'client' && selectedProject?.client_company_id)
                                return u.client_company_id === selectedProject.client_company_id;
                              if (r === 'manager' && projectPod)
                                return u.pod === projectPod;
                              return true;
                            }).length}</span>
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
                    <span>Checklist Goals <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--ink-muted)' }}>({form.checklist.filter(i => i.checked && i.text).length}/{form.checklist.filter(i => i.text).length} pre-checked)</span></span>
                    <button type="button" onClick={addItem} className="checklist-add-btn"><Plus size={11} /> Add item</button>
                  </div>
                  <div className="drawer-checklist">
                    {form.checklist.map((item, i) => (
                      <div key={i} className="drawer-checklist-row">
                        <button
                          type="button"
                          onClick={() => togItem(i)}
                          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center' }}
                          title={item.checked ? 'Uncheck (not required)' : 'Pre-check (required by default)'}
                        >
                          <CheckSquare size={14} style={{ color: item.checked ? 'var(--green)' : 'var(--sand-border)' }} />
                        </button>
                        <input
                          className="form-input"
                          style={{ padding: '8px 12px', fontSize: 13, textDecoration: item.checked ? 'none' : undefined }}
                          placeholder={`Goal ${i + 1}`}
                          value={item.text}
                          onChange={(e) => updItem(i, e.target.value)}
                        />
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
                          = {Math.floor(Number(editForm.est_hours || 0))}h {Math.round(Number(editForm.est_minutes || 0))}m
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
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{fmtHours(Number(editTask.estimated_hours))}</div>
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

                {/* Checklist */}
                {editChecklist.length > 0 && (
                  <div className="drawer-section">
                    <div className="drawer-section-title" style={{ justifyContent: 'space-between' }}>
                      <span>
                        Checklist Goals{' '}
                        <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--ink-muted)' }}>
                          ({editChecklist.filter(i => i.completed).length}/{editChecklist.length} pre-checked)
                        </span>
                      </span>
                    </div>
                    <div className="drawer-checklist">
                      {editChecklist.map((item, i) => (
                        <div key={item.id} className="drawer-checklist-row">
                          <button
                            type="button"
                            onClick={() => {
                              const c = [...editChecklist];
                              c[i] = { ...c[i], completed: !c[i].completed };
                              setEditChecklist(c);
                            }}
                            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center' }}
                            title={item.completed ? 'Uncheck' : 'Check'}
                          >
                            <CheckSquare size={14} style={{ color: item.completed ? 'var(--green)' : 'var(--sand-border)' }} />
                          </button>
                          <span style={{ fontSize: 13, flex: 1, textDecoration: item.completed ? 'line-through' : 'none', color: item.completed ? 'var(--ink-muted)' : 'var(--ink)' }}>
                            {item.text}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Assignment */}
                {(() => {
                  const pool = users.filter(u => ['admin','manager','employee'].includes(u.role));
                  const selectedId = editForm.working_person_id;
                  const selectedUser = pool.find(u => String(u.id) === selectedId);
                  const autoManagerId = podManagerFor(selectedId);
                  const autoManager = autoManagerId ? users.find(u => String(u.id) === autoManagerId) : null;
                  const availableRoles = (['admin','manager','employee'] as const);
                  const activeRole = availableRoles.includes(editRoleTab) ? editRoleTab : availableRoles[0];

                  return (
                    <div className="drawer-section">
                      <div className="drawer-section-title">Assignment</div>

                      {/* Auto-manager info */}
                      {autoManager && (
                        <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
                          <div className="ap-avatar" style={{ background: autoManager.avatar_color, width: 18, height: 18, fontSize: 8 }}>
                            {autoManager.name.split(' ').map((n:string)=>n[0]).join('').toUpperCase().slice(0,2)}
                          </div>
                          <span>Manager: <strong style={{ color: 'var(--ink)' }}>{autoManager.name}</strong> (auto-assigned)</span>
                        </div>
                      )}

                      <div className="ap-slot">
                        {selectedUser && (
                          <div className="ap-selected" style={{ borderColor: 'var(--green)' }}>
                            <div className="ap-avatar ap-avatar--lg" style={{ background: selectedUser.avatar_color }}>
                              {selectedUser.name.split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2)}
                            </div>
                            <div style={{ flex: 1 }}>
                              <div className="ap-selected__name">{selectedUser.name}</div>
                              <div className="ap-selected__role">{selectedUser.role}</div>
                            </div>
                            <button type="button" className="ap-slot__clear"
                              onClick={() => setEditForm({ ...editForm, working_person_id: '', task_manager_id: '' })}>× Clear</button>
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
                                style={isSelected ? { '--ap-accent': 'var(--green)' } as any : undefined}
                                onClick={() => {
                                  const newId = isSelected ? '' : String(u.id);
                                  const mgr = newId ? podManagerFor(newId) : '';
                                  setEditForm({ ...editForm, working_person_id: newId, task_manager_id: mgr });
                                }}
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
            position: 'relative', background: '#fff', borderRadius: 20, padding: 0,
            width: '90%', maxWidth: 460, zIndex: 901,
            boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
            display: 'flex', flexDirection: 'column', maxHeight: '80vh',
          }}>
            {/* Header */}
            <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--sand-border)' }}>
              <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--ink-muted)', marginBottom: 4 }}>
                {doneModalChecklist.length > 0 ? 'Task Checklist' : 'Mark as Done'}
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)', marginBottom: 2 }}>{doneConfirmTask.title}</div>
              {doneModalChecklist.length > 0 && (() => {
                const checkedCount = doneModalChecklist.filter(i => i.completed).length;
                const total = doneModalChecklist.length;
                const allDone = checkedCount === total;
                return (
                  <div style={{ fontSize: 12, color: allDone ? 'var(--green)' : 'var(--orange)', fontWeight: 600 }}>
                    {checkedCount}/{total} items completed {allDone ? '✓ All done!' : '— please check everything before marking done'}
                  </div>
                );
              })()}
              {doneModalChecklist.length === 0 && (
                <div style={{ fontSize: 13, color: 'var(--ink-muted)', marginTop: 4 }}>
                  Have you completed everything for this task?
                </div>
              )}
            </div>

            {/* Checklist items (only if task has checklist) */}
            {doneModalChecklist.length > 0 && (
              <div style={{ flex: 1, overflowY: 'auto', padding: '12px 24px' }}>
                {doneModalChecklist.map((item, idx) => (
                  <div
                    key={item.id}
                    onClick={() => toggleDoneItem(idx)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '9px 12px', marginBottom: 4, borderRadius: 10, cursor: 'pointer',
                      background: item.completed ? 'rgba(76,175,125,0.07)' : 'var(--bg-sand)',
                      border: `1.5px solid ${item.completed ? 'rgba(76,175,125,0.3)' : 'var(--sand-border)'}`,
                      transition: 'all 0.15s',
                    }}
                  >
                    <CheckSquare size={16} style={{ color: item.completed ? 'var(--green)' : 'var(--sand-border)', flexShrink: 0 }} />
                    <span style={{
                      fontSize: 13, flex: 1,
                      textDecoration: item.completed ? 'line-through' : 'none',
                      color: item.completed ? 'var(--ink-muted)' : 'var(--ink)',
                    }}>{item.text}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Footer */}
            <div style={{ padding: '16px 24px', borderTop: '1px solid var(--sand-border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {doneModalChecklist.length === 0 || doneModalChecklist.every(i => i.completed) ? (
                <button className="drawer-submit" onClick={confirmDone} style={{ background: 'var(--green)' }}>
                  <Check size={15} /> Yes, mark as complete
                </button>
              ) : (
                <button className="drawer-submit" onClick={confirmDone}>
                  Mark as done anyway
                </button>
              )}
              <button className="drawer-cancel" onClick={() => { setDoneConfirmTask(null); setDoneModalChecklist([]); }}>
                Go back
              </button>
            </div>
          </div>
        </div>
      )}
      {/* XLR8 Ticket Action Modal */}
      {ticketActionTask && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setTicketActionTask(null); }}>
          <div className="modal" style={{ width: '100%', maxWidth: 440 }}>
            <div className="modal-header">
              <div>
                <h3 className="modal-title">{ticketActionTask.title}</h3>
                <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 2 }}>
                  {ticketActionTask.xlr8_assignee_id ? 'Review completed work' : 'Accept & assign this ticket'}
                </p>
              </div>
            </div>
            <div style={{ padding: '16px 24px' }}>
              {!ticketActionTask.xlr8_assignee_id && !ticketEligible && (
                <p style={{ fontSize: 13, marginBottom: 16, color: 'var(--ink-muted)' }}>
                  Accepting will find the right employee for this ticket type's current stage and assign them.
                </p>
              )}
              {ticketEligible && (
                <div>
                  <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Pick an assignee:</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {ticketEligible.map((e: any) => (
                      <button key={e.id} className="btn-ghost" style={{ justifyContent: 'flex-start', gap: 8 }} onClick={() => ticketAssign(e.id)}>
                        <span style={{ width: 28, height: 28, borderRadius: '50%', background: e.avatar_color || '#888', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#fff', fontWeight: 700 }}>
                          {e.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
                        </span>
                        {e.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {ticketActionTask.xlr8_assignee_id && !showTicketDecline && (
                <p style={{ fontSize: 13, color: 'var(--ink-muted)' }}>
                  The assignee has submitted their work. Approve to move forward or decline to send it back.
                </p>
              )}
              {showTicketDecline && (
                <div>
                  <label className="form-label">Reason for declining</label>
                  <textarea className="form-input" rows={3} value={ticketDeclineComment} onChange={(e) => setTicketDeclineComment(e.target.value)} placeholder="What needs to be changed?" />
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => { setTicketActionTask(null); setShowTicketDecline(false); }}>Cancel</button>
              {!ticketActionTask.xlr8_assignee_id && !ticketEligible &&
                <button className="btn-primary" onClick={ticketAccept} disabled={ticketActionLoading}>{ticketActionLoading ? 'Accepting…' : 'Accept & Assign'}</button>
              }
              {ticketActionTask.xlr8_assignee_id && !showTicketDecline && (
                <>
                  <button className="btn-ghost" onClick={() => setShowTicketDecline(true)}>Decline</button>
                  <button className="btn-primary" onClick={() => ticketReview('approve')} disabled={ticketActionLoading}>{ticketActionLoading ? '…' : 'Approve'}</button>
                </>
              )}
              {showTicketDecline &&
                <button className="btn-primary" style={{ background: 'var(--red)', borderColor: 'var(--red)' }} onClick={() => ticketReview('decline', ticketDeclineComment)} disabled={ticketActionLoading}>
                  {ticketActionLoading ? '…' : 'Decline'}
                </button>
              }
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
