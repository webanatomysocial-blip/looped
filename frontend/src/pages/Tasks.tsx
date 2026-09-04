import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Plus, CheckSquare, Send, X, Play, Pause, Check, Clock, AlertTriangle, Pencil, CheckCircle2, XCircle, RefreshCw, Circle, MinusCircle } from 'lucide-react';
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
import { tasksApi, projectsApi, usersApi, approvalsApi, capacityApi, xlr8Api, calendarApi } from '../services/api';
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
  const [taskLog, setTaskLog]                   = useState<any[]>([]);
  const [expandedTaskId, setExpandedTaskId]     = useState<number | null>(null);
  const [expandedLog, setExpandedLog]           = useState<Record<number, any[]>>({});
  const [editForm, setEditForm]                 = useState({ title: '', description: '', due_date: '', due_time: '', est_hours: '', est_minutes: '0', working_person_id: '', task_manager_id: '' });
  const [editChecklist, setEditChecklist]       = useState<{ id: number; text: string; completed: boolean }[]>([]);
  const [editStageAssignments, setEditStageAssignments] = useState<Record<number, { user_ids: number[]; est_hours: string; est_minutes: string }>>({});
  const [editStageSearchOpen, setEditStageSearchOpen] = useState<Record<number, boolean>>({});
  const [editStageSearchTerm, setEditStageSearchTerm] = useState<Record<number, string>>({});

  const [editRoleTab, setEditRoleTab]           = useState<'admin'|'manager'|'employee'>('employee');
  const [viewTask, setViewTask]                 = useState<Task | null>(null);
  const [viewTab, setViewTab]                   = useState<'info' | 'activity'>('info');
  const [viewLog, setViewLog]                   = useState<any[]>([]);

  const [form, setForm] = useState({
    title: '', description: '', project_id: '',
    working_person_id: '', task_manager_id: '',
    due_date: '', due_time: '18:00',
    checklist: [{ text: '', checked: false }] as { text: string; checked: boolean }[],
    est_hours: '', est_minutes: '0',
    ticket_type_id: '', priority: 'medium',
  });
  const [ticketTypes, setTicketTypes] = useState<{ id: number; name: string; stages: any[]; checklist: { text: string; checked: boolean }[] }[]>([]);
  // stageAssignments[stage_idx] = { user_ids, est_hours, est_minutes }
  const [stageAssignments, setStageAssignments] = useState<Record<number, { user_ids: number[]; est_hours: string; est_minutes: string }>>({});
  const [stageSearchOpen, setStageSearchOpen] = useState<Record<number, boolean>>({});
  const [stageSearchTerm, setStageSearchTerm] = useState<Record<number, string>>({});
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
  const [showRecurringModal, setShowRecurringModal] = useState(false);
  const [recurringForm, setRecurringForm] = useState({ title: '', recurrence_type: 'weekly', recurrence_days: [] as number[], day_of_month: '1', estimated_hours: '1', project_id: '', assigned_to: '', end_date: '' });
  const [podTab, setPodTab] = useState<'all' | 'pod1' | 'pod2'>('all');

  const load = async (pod?: string) => {
    setLoading(true);
    const podParam = user?.role === 'admin' ? (pod === 'all' ? undefined : pod) : user?.role === 'manager' ? (user?.pod ?? undefined) : undefined;
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


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const selectedProject = projects.find(p => String(p.id) === String(form.project_id));
    const isXlr8 = selectedProject?.service_type === 'xlr8';

    if (isXlr8) {
      if (!form.ticket_type_id) { alert('Please select a Ticket Type.'); return; }
      if (!form.due_date) { alert('Please set a Due date.'); return; }
      if (!form.description?.trim()) { alert('Please add a Description.'); return; }
      // Validate each employee stage has at least one person assigned
      const tt = ticketTypes.find(t => String(t.id) === String(form.ticket_type_id));
      if (tt) {
        for (let i = 0; i < tt.stages.length; i++) {
          const stage = tt.stages[i];
          if (stage.type === 'manager' || stage.type === 'admin') continue;
          const sa = stageAssignments[i];
          if (!sa || sa.user_ids.length === 0) {
            alert(`Please assign at least one employee to Stage ${i + 1} (${stage.category_name}).`);
            return;
          }
        }
      }
      // Require est_hours for every stage
      const tt2 = ticketTypes.find(t => String(t.id) === String(form.ticket_type_id));
      if (tt2) {
        for (let i = 0; i < tt2.stages.length; i++) {
          const sa = stageAssignments[i];
          const stageMin = (Number(sa?.est_hours) || 0) * 60 + (Number(sa?.est_minutes) || 0);
          if (stageMin === 0) {
            alert(`Please set an estimated time for Stage ${i + 1} (${tt2.stages[i].category_name || tt2.stages[i].type}).`);
            return;
          }
        }
      }
      // Block if stage est hours exceed total est hours
      const totalMin = (Number(form.est_hours) || 0) * 60 + (Number(form.est_minutes) || 0);
      const allocMin = Object.values(stageAssignments).reduce((sum, v) => sum + (Number(v.est_hours) || 0) * 60 + (Number(v.est_minutes) || 0), 0);
      if (totalMin > 0 && allocMin > totalMin) {
        alert('Stage estimated hours exceed the total estimated time. Please reduce stage hours or increase the total.');
        return;
      }
      try {
        const sa = Object.entries(stageAssignments)
          .map(([idx, v]) => {
            const dec = (v.est_hours ? Number(v.est_hours) : 0) + (v.est_minutes ? Number(v.est_minutes) / 60 : 0);
            return { stage_idx: Number(idx), user_ids: v.user_ids, est_hours: dec };
          })
          .filter(s => s.user_ids.length > 0 || s.est_hours > 0);
        await xlr8Api.createTicket({
          title: form.title,
          description: form.description || null,
          project_id: Number(form.project_id),
          ticket_type_id: Number(form.ticket_type_id),
          due_date: form.due_date || null,
          stage_assignments: sa,
          priority: form.priority || 'medium',
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
        priority: form.priority || 'medium',
        approval_flow: approvalFlow.map(u => u.id),
      });
      if (res.data.warnings?.length) setCapacityWarnings(res.data.warnings);
      setShowModal(false);
      load();
    } catch (err: any) { alert(err.response?.data?.error || 'Error'); }
  };

  const handleDraft = async () => {
    if (!form.title.trim()) { alert('Please enter a title.'); return; }
    if (!form.project_id) { alert('Please select a project.'); return; }
    const selectedProject = projects.find(p => String(p.id) === String(form.project_id));
    const isXlr8 = selectedProject?.service_type === 'xlr8';
    try {
      if (isXlr8) {
        await xlr8Api.createTicket({
          title: form.title, description: form.description || null,
          project_id: Number(form.project_id),
          ticket_type_id: form.ticket_type_id ? Number(form.ticket_type_id) : undefined,
          due_date: form.due_date || null,
          draft: true,
        } as any);
      } else {
        await tasksApi.create({
          title: form.title, description: form.description || null,
          project_id: Number(form.project_id),
          due_date: form.due_date || null,
          due_time: form.due_time || null,
          checklist: form.checklist.filter(i => i.text),
          draft: true,
        } as any);
      }
      setShowModal(false);
      load();
    } catch (err: any) { alert(err.response?.data?.error || 'Error'); }
  };

  // ── XLR8 ticket workflow actions ─────────────────────────────────────────
  const openTicketAction = async (task: any) => {
    setTicketActionTask(task); setTicketEligible(null); setShowTicketDecline(false); setTicketDeclineComment('');
    // For assignment (no assignee yet), immediately fetch eligible employees
    if (!task.xlr8_assignee_id) {
      try {
        const r = await xlr8Api.acceptTicket(task.id);
        if (r.data.auto_assigned) { setTicketActionTask(null); load(); return; }
        setTicketEligible(r.data.eligible);
      } catch (err: any) {
        setTicketActionTask(null);
        load(); // Reload to get fresh state — ticket may have been assigned already
      }
    }
  };

  const ticketAccept = async () => {
    if (!ticketActionTask) return;
    setTicketActionLoading(true);
    try {
      const r = await xlr8Api.acceptTicket(ticketActionTask.id);
      if (r.data.auto_assigned) { setTicketActionTask(null); load(); }
      else setTicketEligible(r.data.eligible);
    } catch (err: any) {
      setTicketActionTask(null);
      load();
    } finally { setTicketActionLoading(false); }
  };

  const ticketAssign = async (assigneeId: number) => {
    if (!ticketActionTask) return;
    setTicketActionLoading(true);
    try { await xlr8Api.assignTicket(ticketActionTask.id, assigneeId); setTicketActionTask(null); load(); }
    finally { setTicketActionLoading(false); }
  };

  const ticketReview = async (action: 'approve' | 'decline', comment?: string, skip_admin?: boolean) => {
    if (!ticketActionTask) return;
    setTicketActionLoading(true);
    try { await xlr8Api.reviewTicket(ticketActionTask.id, action, comment, skip_admin); setTicketActionTask(null); setShowTicketDecline(false); load(); }
    finally { setTicketActionLoading(false); }
  };

  const ticketEmployeeAccept = async (taskId: number) => {
    setTicketActionLoading(true);
    try {
      await xlr8Api.employeeAccept(taskId);
      load();
    } catch (e: any) {
      const msg = e?.response?.data?.error || 'Could not accept ticket';
      alert(msg);
    } finally {
      setTicketActionLoading(false);
    }
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
        const res = await capacityApi.check(uid, form.due_date || undefined);
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
    // Load existing checklist items and stage assignments
    setEditStageAssignments({});
    try {
      const res = await tasksApi.get(task.id);
      setEditChecklist((res.data.checklist || []).map((c: any) => ({ id: c.id, text: c.text, completed: !!c.completed })));
      // Build editStageAssignments from task_assignees grouped by stage_idx
      const saMap: Record<number, { user_ids: number[]; est_hours: string; est_minutes: string }> = {};
      for (const sa of (res.data.stage_assignees || [])) {
        const idx = sa.stage_idx ?? 0;
        if (!saMap[idx]) {
          const h = sa.est_hours ? Math.floor(Number(sa.est_hours)) : 0;
          const m = sa.est_hours ? Math.round((Number(sa.est_hours) % 1) * 60) : 0;
          saMap[idx] = { user_ids: [], est_hours: h > 0 ? String(h) : '', est_minutes: m > 0 ? String(m) : '0' };
        }
        if (sa.user_id != null) saMap[idx].user_ids.push(sa.user_id);
      }
      setEditStageAssignments(saMap);
    } catch { setEditChecklist([]); }
    // Load workflow history for ticket tasks
    setTaskLog([]);
    if (task.ticket_type_id) {
      try { const r = await xlr8Api.getTicketLog(task.id); setTaskLog(r.data); } catch { /* ignore */ }
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTask) return;
    const estHrs = editForm.est_hours
      ? Number(editForm.est_hours) + Number(editForm.est_minutes) / 60
      : null;
    // For XLR8 tickets, total est is derived from stages — skip the top-level total vs stages check
    try {
      // Save stage assignments for XLR8 tickets
      if (editTask.ticket_type_id && Object.keys(editStageAssignments).length > 0) {
        const sa = Object.entries(editStageAssignments)
          .map(([idx, v]) => {
            const dec = (v.est_hours ? Number(v.est_hours) : 0) + (v.est_minutes ? Number(v.est_minutes) / 60 : 0);
            return { stage_idx: Number(idx), user_ids: v.user_ids, est_hours: dec };
          });
        await xlr8Api.updateStageAssignments(editTask.id, sa);
      }
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

  const statuses = ['all', 'draft', 'todo', 'in_progress', 'in_review', 'overdue', 'completed'];
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
                {(['all', 'pod1', 'pod2'] as const).map((p) => (
                  <button
                    key={p}
                    className={`filter-tab${podTab === p ? ' active' : ''}`}
                    onClick={() => setPodTab(p)}
                  >
                    {p === 'all' ? 'All' : p === 'pod1' ? 'Pod 1' : 'Pod 2'}
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
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-secondary" style={{ fontSize: 13, padding: '7px 14px' }} onClick={() => { setRecurringForm({ title: '', recurrence_type: 'weekly', recurrence_days: [], day_of_month: '1', estimated_hours: '1', project_id: '', assigned_to: String(user?.id || ''), end_date: '' }); setShowRecurringModal(true); }}>
                  🔁 Recurring Task
                </button>
                <button className="btn-primary" onClick={() => { setForm({ title: '', description: '', project_id: '', working_person_id: '', task_manager_id: '', due_date: '', due_time: '18:00', checklist: [{ text: '', checked: false }], est_hours: '', est_minutes: '0', ticket_type_id: '', priority: 'medium' }); setCapacityWarnings([]); setApprovalFlow([]); setStageAssignments({}); setShowModal(true); }}>
                  <Plus size={14} /> New task
                </button>
              </div>
            )}
          </div>
        </div>

        {loading && <p className="page-subtitle">Loading…</p>}

        <div className="tasks-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                {['Task', 'Priority', 'Project', 'Assigned to', 'Created by', 'Pending with', 'Due', 'Est.', 'Status', 'Checklist', ''].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginated.map((task) => (
                <React.Fragment key={task.id}>
                <tr>
                  <td>
                    <div className="task-cell-main" style={{ cursor: 'pointer' }} onClick={async () => {
                      setViewTab('info');
                      setViewLog([]);
                      try {
                        const full = await tasksApi.get(task.id);
                        setViewTask(full.data);
                      } catch { setViewTask(task); }
                      if (task.ticket_type_id) {
                        try { const r = await xlr8Api.getTicketLog(task.id); setViewLog(r.data); } catch { /* ignore */ }
                      }
                    }}>
                      <div className={`task-status-dot task-status-dot--${task.status}`} />
                      <div>
                        <p className="task-cell-title">{task.title}</p>
                        {task.client_name && <p className="task-cell-sub">{task.client_name}</p>}
                      </div>
                    </div>
                  </td>
                  <td>
                    {(() => {
                      const p = task.priority || 'medium';
                      const colors: Record<string, { color: string; bg: string }> = {
                        urgent: { color: '#dc2626', bg: '#fef2f2' },
                        high:   { color: '#ea580c', bg: '#fff7ed' },
                        medium: { color: '#2563eb', bg: '#eff6ff' },
                        low:    { color: '#6b7280', bg: '#f9fafb' },
                      };
                      const c = colors[p] || colors.medium;
                      return <span style={{ fontSize: 10, fontWeight: 700, color: c.color, background: c.bg, borderRadius: 99, padding: '2px 8px', textTransform: 'capitalize', whiteSpace: 'nowrap' }}>{p}</span>;
                    })()}
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
                    <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                      {task.created_by_name || '—'}
                      {task.created_at && <span style={{ display: 'block', fontSize: 11, color: 'var(--ink-muted)', opacity: 0.7 }}>{String(task.created_at).slice(0, 10)}</span>}
                    </span>
                  </td>
                  <td>
                    <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                      {(() => {
                        const s = task.xlr8_status;
                        const managerName = task.assignees?.find((a: any) => a.assignee_role === 'manager')?.name;
                        if (s === 'pending_manager') return task.xlr8_assignee_id ? `${managerName ? managerName + ' · ' : ''}Manager (review)` : `${managerName ? managerName + ' · ' : ''}Manager (assign)`;
                        if (s === 'pending_assignee') return task.xlr8_assignee_name || task.assignees?.find((a: any) => a.assignee_role === 'employee')?.name || 'Employee';
                        if (s === 'pending_admin') return task.xlr8_assignee_name || 'Admin';
                        if (s === 'pending_client') return task.client_name || 'Client';
                        if (s === 'completed') return '—';
                        if (task.status === 'in_progress') return task.assignees?.find((a: any) => a.assignee_role === 'employee')?.name || 'Employee';
                        return '—';
                      })()}
                    </span>
                  </td>
                  <td>
                    {task.due_date
                      ? <span className={`task-date${task.status === 'overdue' ? ' task-date--over' : ''}`}>
                          {format(new Date(task.due_date), 'MMM d')}
                        </span>
                      : <span style={{ color: 'var(--sand-border)' }}>—</span>}
                  </td>
                  <td>
                    {(() => {
                      // For XLR8 tickets show the current stage's est_hours, not the whole-task total
                      if (task.ticket_type_id) {
                        const currentIdx = (task as any).xlr8_stage_idx ?? 0;
                        const stageAssignee = task.assignees?.find((a: any) => a.stage_idx === currentIdx && a.est_hours > 0);
                        const h = stageAssignee?.est_hours ?? null;
                        return h
                          ? <span style={{ fontSize: 12, color: 'var(--ink-muted)', display: 'flex', alignItems: 'center', gap: 3 }}><Clock size={11} />{fmtHours(Number(h))}</span>
                          : <span style={{ color: 'var(--sand-border)' }}>—</span>;
                      }
                      return task.estimated_hours
                        ? <span style={{ fontSize: 12, color: 'var(--ink-muted)', display: 'flex', alignItems: 'center', gap: 3 }}><Clock size={11} />{fmtHours(Number(task.estimated_hours))}</span>
                        : <span style={{ color: 'var(--sand-border)' }}>—</span>;
                    })()}
                  </td>
                  <td>
                    {task.ticket_type_id && user?.role === 'employee' && task.xlr8_assignee_id !== user?.id && task.xlr8_status !== 'completed'
                      ? <Badge status="stage_done" />
                      : <Badge status={task.status} />}
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
                        const isManagerOnly = user?.role === 'manager';
                        const needsAssign = s === 'pending_manager' && !task.xlr8_assignee_id;
                        const needsReview = s === 'pending_manager' && !!task.xlr8_assignee_id;
                        if (needsAssign && isManager) return (
                          <button className="ticket-pill ticket-pill--green" onClick={() => openTicketAction(task)}>
                            ＋ Accept &amp; Assign
                          </button>
                        );
                        if (needsReview && isManagerOnly) return (
                          <button className="ticket-pill ticket-pill--orange" onClick={() => openTicketAction(task)}>
                            ✓ Review
                          </button>
                        );
                        if (s === 'pending_assignee' && user?.role === 'employee' && (isAssignee || !task.xlr8_assignee_id)) return (
                          <div style={{ display: 'flex', gap: 5 }}>
                            <button className="ticket-icon-btn ticket-icon-btn--green" title="Accept ticket" onClick={() => ticketEmployeeAccept(task.id)}><Check size={11} /></button>
                            {task.xlr8_assignee_id && <button className="ticket-icon-btn ticket-icon-btn--red" title="Decline ticket" onClick={() => ticketEmployeeDeclineInline(task.id)}><X size={11} /></button>}
                          </div>
                        );
                        if (s === 'pending_assignee' && isManager) return (
                          <span className="ticket-pill ticket-pill--muted">Awaiting acceptance</span>
                        );
                        if (s === 'pending_admin' && user?.role === 'admin') return (
                          <button className="ticket-pill ticket-pill--purple" onClick={async () => { await xlr8Api.adminApprove(task.id); load(); }}>
                            ✓ Final Approve
                          </button>
                        );
                        if (s === 'pending_client') return (
                          <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                            <span className="ticket-pill ticket-pill--muted">Awaiting client</span>
                            {isManager && <button className="ticket-pill ticket-pill--green" onClick={async () => { if (confirm('Close without client sign-off?')) { await xlr8Api.clientApprove(task.id); load(); } }}>Close</button>}
                          </div>
                        );
                        return null;
                      })()}
                      {/* Pre-accept / Pre-decline for future XLR8 stages */}
                      {task.ticket_type_id && user?.role === 'employee' && (() => {
                        const myAssignment = task.assignees?.find((a: any) => a.user_id === user.id && a.assignee_role === 'employee');
                        const currentIdx = (task as any).xlr8_stage_idx ?? 0;
                        return myAssignment && myAssignment.stage_idx !== currentIdx && myAssignment.acceptance_status === 'pending';
                      })() && (
                        <div style={{ display: 'flex', gap: 5 }}>
                          <button className="ticket-icon-btn ticket-icon-btn--green" title="Pre-accept stage" onClick={async () => { await xlr8Api.stagePreAccept(task.id); load(); }}><Check size={11} /></button>
                          <button className="ticket-icon-btn ticket-icon-btn--red" title="Decline stage" onClick={async () => { await xlr8Api.stagePreDecline(task.id); load(); }}><X size={11} /></button>
                        </div>
                      )}
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
                      {user?.role === 'employee' && task.status !== 'completed' &&
                        (task.ticket_type_id
                          ? task.xlr8_status === 'in_progress' && task.xlr8_assignee_id === user.id
                          : task.status !== 'in_review' && task.my_acceptance_status === 'accepted') && (
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
                      {(user?.role === 'admin' || user?.role === 'manager') && task.status !== 'completed' && (
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
              </React.Fragment>
              ))}
              {filtered.length === 0 && !loading && (
                <tr><td colSpan={10} className="empty-state">No tasks found</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} totalPages={totalPages} total={filtered.length} pageSize={PAGE_SIZE} onPage={setPage} />
      </div>

      {/* ── Task View Canvas ── */}
      {viewTask && (
        <div className="drawer-overlay">
          <div className="drawer-backdrop" onClick={() => setViewTask(null)} />
          <div className="drawer-panel">
            {/* Header */}
            <div className="drawer-header">
              <div className="drawer-header__label">
                {viewTask.project_name}{viewTask.client_name ? ` · ${viewTask.client_name}` : ''}
              </div>
              <div className="drawer-header__row">
                <span className="drawer-header__title">{viewTask.title}</span>
                <button type="button" className="drawer-close" onClick={() => setViewTask(null)}>×</button>
              </div>
              {/* Tabs */}
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

            {/* Body */}
            <div className="drawer-body" style={{ overflowY: 'auto' }}>
              {viewTab === 'info' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  {/* Meta row */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
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

                  {/* Description */}
                  <div>
                    <div className="drawer-info-label">Description</div>
                    {viewTask.description
                      ? <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.6, whiteSpace: 'pre-wrap', background: 'rgba(0,0,0,0.03)', borderRadius: 8, padding: '12px 14px', marginTop: 6 }}>{viewTask.description}</div>
                      : <div style={{ fontSize: 13, color: 'var(--ink-muted)', fontStyle: 'italic', marginTop: 4 }}>No description provided.</div>
                    }
                  </div>

                  {/* XLR8 Stage Tracker */}
                  {viewTask.ticket_type_id && (viewTask as any).xlr8_stages?.length > 0 && (() => {
                    const stages: any[] = (viewTask as any).xlr8_stages;
                    const stageAssignees: any[] = (viewTask as any).stage_assignees || [];
                    const stageTracked: any[] = (viewTask as any).stage_tracked || [];
                    const currentIdx: number = (viewTask as any).xlr8_stage_idx ?? 0;
                    const xlr8Status: string = (viewTask as any).xlr8_status || '';
                    const isCompleted = viewTask.status === 'completed' || xlr8Status === 'completed';
                    const lastLogEntry = viewLog[viewLog.length - 1];
                    const lastWasRejected = lastLogEntry && (lastLogEntry.action.includes('declined') || lastLogEntry.action.includes('reject'));
                    const rejectedAt = lastWasRejected && lastLogEntry?.created_at
                      ? format(new Date(Number(lastLogEntry.created_at) || lastLogEntry.created_at), 'MMM d, h:mm a')
                      : null;
                    const fmtSec = (s: number) => { const h = Math.floor(s/3600); const m = Math.floor((s%3600)/60); const sec = s % 60; return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m` : `${sec}s`; };

                    return (
                      <div>
                        <div className="drawer-info-label" style={{ marginBottom: 12 }}>Stage Flow</div>
                        <div style={{ overflowX: 'auto', paddingBottom: lastWasRejected ? 52 : 4, position: 'relative' }}>
                        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'stretch', gap: 0, marginTop: '10px', width: 'max-content' }}>
                          {stages.map((stage: any, i: number) => {
                            const isReview = stage.type === 'manager' || stage.type === 'admin';
                            // When rejected, the previous stage is being redone — don't mark it as done
                            const isRedoTarget = lastWasRejected && i === currentIdx - 1;
                            const isDone = !isRedoTarget && (isCompleted || i < currentIdx);
                            const isCurrent = !isCompleted && i === currentIdx;
                            const isPending = !isCompleted && i > currentIdx;
                            const stageAssignee = stageAssignees.filter(a => a.stage_idx === i && a.user_id);
                            const trackedSec = stageTracked.find((t: any) => t.stage_idx === i)?.tracked_seconds ?? 0;
                            const label = stage.type === 'admin' ? 'Admin Review' : stage.type === 'manager' ? 'Manager Review' : stage.category_name;
                            const borderColor = isDone ? '#22c55e' : isCurrent ? (lastWasRejected ? '#ef4444' : '#3b82f6') : isRedoTarget ? '#f59e0b' : '#e2e8f0';
                            const bgColor = isDone ? 'rgba(34,197,94,0.06)' : isCurrent ? (lastWasRejected ? 'rgba(239,68,68,0.05)' : 'rgba(59,130,246,0.05)') : isRedoTarget ? 'rgba(245,158,11,0.05)' : 'var(--surface)';
                            const dotColor = isDone ? '#22c55e' : isCurrent ? (lastWasRejected ? '#ef4444' : '#3b82f6') : isRedoTarget ? '#f59e0b' : '#cbd5e1';
                            const showArrow = i < stages.length - 1;
                            const isRejected = lastWasRejected && isCurrent;

                            return (
                              <div key={i} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', flexShrink: 0 }}>
                                {/* Card */}
                                <div style={{
                                  width: 180,
                                  minHeight: 130,
                                  border: `2px solid ${borderColor}`,
                                  borderRadius: 12,
                                  padding: '14px 12px 12px',
                                  background: bgColor,
                                  position: 'relative',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: 8,
                                }}>
                                  {/* Stage badge */}
                                  <div style={{ position: 'absolute', top: -10, left: 10, background: dotColor, color: '#fff', borderRadius: 99, fontSize: 9, fontWeight: 800, padding: '1px 7px', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
                                    Stage {i + 1}
                                  </div>

                                  {/* Status icon */}
                                  <div style={{ display: 'flex', alignItems: 'center' }}>
                                    {isDone      && <CheckCircle2 size={22} color="#22c55e" />}
                                    {isRejected  && <XCircle      size={22} color="#ef4444" />}
                                    {isRedoTarget && <RefreshCw   size={22} color="#f59e0b" />}
                                    {isCurrent && !isRejected && <Circle size={22} color="#3b82f6" fill="rgba(59,130,246,0.15)" />}
                                    {isPending   && <MinusCircle  size={22} color="#cbd5e1" />}
                                  </div>

                                  {/* Label */}
                                  <div style={{ fontSize: 12, fontWeight: 700, color: isPending ? 'var(--ink-muted)' : 'var(--ink)', lineHeight: 1.3 }}>
                                    {label}
                                    {isReview && (
                                      <div style={{ marginTop: 2, fontSize: 9, fontWeight: 600, color: stage.type === 'admin' ? 'var(--orange)' : '#3b82f6', display: 'inline-block', background: stage.type === 'admin' ? 'rgba(234,88,12,0.1)' : 'rgba(59,130,246,0.1)', borderRadius: 4, padding: '1px 4px', marginLeft: 4 }}>Review</div>
                                    )}
                                  </div>

                                  {/* Assignees */}
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
                                    ) : (
                                      <span style={{ fontSize: 10, color: 'var(--ink-muted)', fontStyle: 'italic' }}>TBD</span>
                                    )}
                                  </div>

                                  {/* Tracked time + overtime */}
                                  {(() => {
                                    const estSec = stageAssignee.reduce((s: number, a: any) => s + (Number(a.est_hours) || 0) * 3600, 0);
                                    const overSec = trackedSec > 0 && estSec > 0 ? Math.max(0, trackedSec - estSec) : 0;
                                    return (
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, color: trackedSec > 0 ? 'var(--ink-muted)' : '#cbd5e1' }}>
                                        <Clock size={10} color={trackedSec > 0 ? 'var(--ink-muted)' : '#cbd5e1'} />
                                        {trackedSec > 0 ? fmtSec(Number(trackedSec)) : '—'} logged
                                        {overSec > 0 && (
                                          <span style={{ fontSize: 9, fontWeight: 800, color: '#dc2626', background: 'rgba(220,38,38,0.1)', borderRadius: 99, padding: '1px 5px', marginLeft: 2 }}>
                                            +{fmtSec(overSec)} over
                                          </span>
                                        )}
                                      </div>
                                    );
                                  })()}

                                  {/* Rejection reason */}
                                  {isRejected && lastLogEntry?.comment && (
                                    <div style={{ fontSize: 10, color: '#ef4444', background: 'rgba(239,68,68,0.08)', borderRadius: 6, padding: '4px 6px', fontStyle: 'italic', lineHeight: 1.4 }}>
                                      ✕ "{lastLogEntry.comment}"
                                    </div>
                                  )}
                                  {isRejected && !lastLogEntry?.comment && (
                                    <div style={{ fontSize: 10, color: '#ef4444', fontWeight: 600 }}>✕ Rejected</div>
                                  )}
                                </div>

                                {/* Horizontal connector arrow */}
                                {showArrow && (
                                  <div style={{ width: 40, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <svg width="40" height="20" viewBox="0 0 40 20">
                                      <line x1="0" y1="10" x2="30" y2="10" stroke={isDone ? '#22c55e' : '#e2e8f0'} strokeWidth="2" strokeDasharray={isPending ? '4 3' : 'none'} />
                                      <polygon points="40,10 28,4 28,16" fill={isDone ? '#22c55e' : '#e2e8f0'} />
                                    </svg>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {/* Red rejection back-arrow row */}
                        {lastWasRejected && currentIdx > 0 && (() => {
                          const cardW = 180;
                          const arrowW = 40;
                          const unitW = cardW + arrowW;
                          const totalW = stages.length * cardW + (stages.length - 1) * arrowW;
                          const fromX = currentIdx * unitW + cardW / 2;
                          const toX = (currentIdx - 1) * unitW + cardW / 2;
                          const midX = (fromX + toX) / 2;
                          const arcH = 44;
                          const comment = lastLogEntry?.comment;
                          return (
                            <div style={{ marginTop: 6, position: 'relative', minWidth: totalW }}>
                              {/* Arc SVG */}
                              <svg width={totalW} height={arcH} viewBox={`0 0 ${totalW} ${arcH}`} style={{ display: 'block', overflow: 'visible' }}>
                                <defs>
                                  <marker id="rejArrowHead" markerWidth="8" markerHeight="8" refX="1" refY="4" orient="auto-start-reverse">
                                    <polygon points="8,4 0,0 0,8" fill="#ef4444" />
                                  </marker>
                                </defs>
                                <path
                                  d={`M ${fromX} 4 C ${fromX} ${arcH}, ${toX} ${arcH}, ${toX} 4`}
                                  stroke="#ef4444" strokeWidth="2" fill="none"
                                  markerEnd="url(#rejArrowHead)"
                                  strokeDasharray="5 3"
                                />
                              </svg>
                              {/* Info pill centered under arc */}
                              <div style={{
                                position: 'absolute',
                                bottom: -28,
                                left: midX,
                                transform: 'translateX(-50%)',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: 4,
                                pointerEvents: 'none',
                              }}>
                                <div style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 5,
                                  background: '#fef2f2', border: '1px solid #fecaca',
                                  borderRadius: 99, padding: '3px 10px',
                                  fontSize: 10, fontWeight: 700, color: '#ef4444', whiteSpace: 'nowrap',
                                }}>
                                  <XCircle size={11} color="#ef4444" />
                                  Rejected{rejectedAt ? ` · ${rejectedAt}` : ''}
                                </div>
                                {comment && (
                                  <div style={{
                                    fontSize: 10, color: '#b91c1c', fontStyle: 'italic',
                                    background: '#fff5f5', borderRadius: 6, padding: '2px 8px',
                                    border: '1px solid #fecaca', maxWidth: 220, textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                  }}>
                                    "{comment}"
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })()}
                        </div>{/* end scroll wrapper */}
                      </div>
                    );
                  })()}

                  {/* For non-XLR8: show assigned to */}
                  {!viewTask.ticket_type_id && (
                    <div>
                      <div className="drawer-info-label">Assigned to</div>
                      <div style={{ fontSize: 13, color: 'var(--ink)', marginTop: 2 }}>
                        {viewTask.assignees?.length > 0 ? viewTask.assignees.map((a: any) => a.name).join(', ') : viewTask.assigned_name || '—'}
                      </div>
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
                        <select className="form-input" style={{ fontSize: 12 }} value={form.ticket_type_id} onChange={(e) => {
                          const tt = ticketTypes.find(t => String(t.id) === e.target.value);
                          const checklist = tt?.checklist?.length ? tt.checklist.map((i: any) => ({ text: i.text, checked: !!i.checked })) : [{ text: '', checked: false }];
                          setStageAssignments({});
                          setForm({ ...form, ticket_type_id: e.target.value, checklist });
                        }} required>
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
                    <div className="drawer-info-label">Est. time</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input type="number" min="0" max="999" placeholder="0h" className="form-input" style={{ fontSize: 12, flex: 1 }} value={form.est_hours} onChange={(e) => setForm({ ...form, est_hours: e.target.value })} onBlur={checkCapacity} />
                      <input type="number" min="0" max="59" placeholder="0m" className="form-input" style={{ fontSize: 12, flex: 1 }} value={form.est_minutes} onChange={(e) => setForm({ ...form, est_minutes: e.target.value })} onBlur={checkCapacity} />
                    </div>
                  </div>
                  
                  <div className="drawer-info-field">
                    <div className="drawer-info-label">Priority</div>
                    <select className="form-input" style={{ fontSize: 12 }} value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </select>
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

                {/* XLR8 Stages panel — shown when a ticket type is selected */}
                {(() => {
                  const selProj = projects.find(p => String(p.id) === String(form.project_id));
                  if (selProj?.service_type !== 'xlr8' || !form.ticket_type_id) return null;
                  const tt = ticketTypes.find(t => String(t.id) === String(form.ticket_type_id));
                  if (!tt || tt.stages.length === 0) return null;
                  // If project has no pod, infer from its manager member
                  const projPod = selProj?.pod || (() => {
                    const mgr = selProj?.members?.find((m: any) => m.role === 'manager');
                    return mgr?.pod || (mgr ? users.find(u => u.id === mgr.user_id)?.pod : null);
                  })();
                  const employees = users.filter(u => u.role === 'employee' && (!projPod || u.pod === projPod));

                  // Allocation tracker
                  const totalMin = (Number(form.est_hours) || 0) * 60 + (Number(form.est_minutes) || 0);
                  const allocMin = Object.values(stageAssignments).reduce((sum, v) => sum + (Number(v.est_hours) || 0) * 60 + (Number(v.est_minutes) || 0), 0);
                  const remMin = totalMin - allocMin;
                  const fmtMin = (m: number) => { const abs = Math.abs(m); return `${m < 0 ? '-' : ''}${Math.floor(abs / 60)}h ${abs % 60}m`; };

                  const autoSplit = () => {
                    if (!totalMin) return;
                    const REVIEW_MIN = 2;
                    const reviewCount = tt.stages.filter((s: any) => s.type === 'manager' || s.type === 'admin').length;
                    const empIndices = tt.stages.map((_: any, i: number) => i).filter((i: number) => {
                      const s = tt.stages[i]; return s.type !== 'manager' && s.type !== 'admin';
                    });
                    const empTotal = totalMin - reviewCount * REVIEW_MIN;
                    const empCount = empIndices.length;
                    const perEmpMin = empCount > 0 ? Math.floor(empTotal / empCount) : 0;
                    const empRem = empCount > 0 ? empTotal % empCount : 0;
                    setStageAssignments(prev => {
                      const next = { ...prev };
                      tt.stages.forEach((s: any, i: number) => {
                        const isReview = s.type === 'manager' || s.type === 'admin';
                        const m = isReview ? REVIEW_MIN : perEmpMin + (empIndices[0] === i ? empRem : 0);
                        next[i] = { ...(next[i] || { user_ids: [] }), est_hours: String(Math.floor(m / 60)), est_minutes: String(m % 60) };
                      });
                      return next;
                    });
                  };

                  return (
                    <div className="drawer-section">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <div className="drawer-section-title" style={{ marginBottom: 0 }}>Stages</div>
                        {totalMin > 0 && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 11, color: remMin < 0 ? 'var(--red)' : 'var(--ink-muted)' }}>
                              {fmtMin(allocMin)} / {fmtMin(totalMin)}{remMin !== 0 && ` · ${remMin > 0 ? fmtMin(remMin) + ' left' : fmtMin(remMin) + ' over'}`}
                            </span>
                            <button type="button" onClick={autoSplit} style={{ fontSize: 11, padding: '2px 8px', background: 'none', border: '1px solid var(--sand-border)', borderRadius: 6, cursor: 'pointer', color: 'var(--ink-muted)' }}>
                              Split equally
                            </button>
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {tt.stages.map((s: any, idx: number) => {
                          const sa = stageAssignments[idx] || { user_ids: [], est_hours: '', est_minutes: '0' };
                          const isManager = s.type === 'manager';
                          const isAdmin = s.type === 'admin';
                          const isReviewer = isManager || isAdmin;
                          const projectMemberIds = new Set((selProj?.members || []).map((m: any) => m.user_id));
                          const catEmployees = isReviewer ? [] : employees.filter(u =>
                            u.categories?.some((c: any) => c.name === s.category_name) || projectMemberIds.has(u.id)
                          );
                          const reviewPool = isAdmin
                            ? users.filter(u => u.role === 'admin')
                            : isManager
                              ? users.filter(u => u.role === 'manager' && (!projPod || u.pod === projPod))
                              : [];
                          const pool = isReviewer ? reviewPool : catEmployees;
                          const selectedUsers = users.filter(u => sa.user_ids.includes(u.id));
                          const unselectedUsers = pool.filter(u => !sa.user_ids.includes(u.id));
                          const updateSa = (patch: Partial<{ user_ids: number[]; est_hours: string; est_minutes: string }>) =>
                            setStageAssignments(prev => ({ ...prev, [idx]: { ...(prev[idx] || { user_ids: [], est_hours: '', est_minutes: '0' }), ...patch } }));
                          const bgColor = isAdmin ? 'rgba(234,88,12,0.05)' : isManager ? 'rgba(74,144,226,0.05)' : 'var(--surface-raised, #f8f8f8)';
                          const labelColor = isAdmin ? 'var(--orange, #ea580c)' : isManager ? 'var(--blue, #1a5fa0)' : 'var(--ink)';
                          const label = isAdmin ? 'Admin Review' : isManager ? 'Manager Review' : s.category_name;
                          return (
                            <div key={idx} style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--sand-border)', background: bgColor }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', width: 18, textAlign: 'center', flexShrink: 0 }}>{idx + 1}</span>
                                <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: labelColor }}>{label}</span>
                                <input
                                  type="number" min="0" max="99" placeholder="0h"
                                  value={sa.est_hours}
                                  onChange={e => updateSa({ est_hours: e.target.value })}
                                  className="form-input"
                                  style={{ width: 48, marginBottom: 0, fontSize: 12, textAlign: 'center', border: '1.5px solid var(--sand-border)', background: 'var(--surface)', color: 'var(--ink)', padding: '6px 4px' }}
                                  title="Hours"
                                />
                                <input
                                  type="number" min="0" max="59" placeholder="0m"
                                  value={sa.est_minutes === '0' ? '' : sa.est_minutes}
                                  onChange={e => updateSa({ est_minutes: e.target.value || '0' })}
                                  className="form-input"
                                  style={{ width: 48, marginBottom: 0, fontSize: 12, textAlign: 'center', border: '1.5px solid var(--sand-border)', background: 'var(--surface)', color: 'var(--ink)', padding: '6px 4px' }}
                                  title="Minutes"
                                />
                              </div>
                              <div style={{ paddingLeft: 26 }}>
                                {selectedUsers.length > 0 && (
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
                                    {selectedUsers.map(u => (
                                      <span key={u.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--surface)', border: '1px solid var(--green)', borderRadius: 99, padding: '3px 8px 3px 4px', fontSize: 11 }}>
                                        <span style={{ width: 18, height: 18, borderRadius: '50%', background: u.avatar_color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                                          {u.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
                                        </span>
                                        <span style={{ fontWeight: 600 }}>{u.name.split(' ')[0]}</span>
                                        <button type="button" onClick={() => updateSa({ user_ids: sa.user_ids.filter(id => id !== u.id) })} style={{ background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1, color: 'var(--ink-muted)', padding: 0, fontSize: 12 }}>×</button>
                                      </span>
                                    ))}
                                  </div>
                                )}
                                {unselectedUsers.length > 0 && (
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                    {unselectedUsers.map(u => (
                                      <button key={u.id} type="button"
                                        onClick={() => updateSa({ user_ids: [u.id] })}
                                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: '1px dashed var(--sand-border)', borderRadius: 99, padding: '3px 8px 3px 4px', fontSize: 11, cursor: 'pointer', color: 'var(--ink-muted)' }}>
                                        <span style={{ width: 18, height: 18, borderRadius: '50%', background: u.avatar_color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                                          {u.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
                                        </span>
                                        <span>{u.name.split(' ')[0]}</span>
                                      </button>
                                    ))}
                                  </div>
                                )}
                                {!isReviewer && !stageSearchOpen[idx] && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: pool.length > 0 ? 6 : 0 }}>
                                    {pool.length === 0 && <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>No employees in this category — manager will assign</span>}
                                    <button
                                      type="button"
                                      onClick={() => setStageSearchOpen(prev => ({ ...prev, [idx]: true }))}
                                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', fontSize: 11, background: 'var(--surface)', border: '1px solid var(--sand-border)', borderRadius: 6, cursor: 'pointer' }}
                                    >
                                      Search Project Employees
                                    </button>
                                  </div>
                                )}
                                {!isReviewer && stageSearchOpen[idx] && (
                                  <div style={{ marginTop: 8 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                                      <input
                                        type="text"
                                        placeholder="Search employees..."
                                        value={stageSearchTerm[idx] || ''}
                                        onChange={e => setStageSearchTerm(prev => ({ ...prev, [idx]: e.target.value }))}
                                        className="form-input"
                                        style={{ fontSize: 12, padding: '4px 8px', width: '100%', maxWidth: 200, marginBottom: 0 }}
                                        autoFocus
                                      />
                                      <button type="button" onClick={() => { setStageSearchOpen(prev => ({ ...prev, [idx]: false })); setStageSearchTerm(prev => ({ ...prev, [idx]: '' })); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--ink-muted)' }}>Close</button>
                                    </div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                      {stageSearchTerm[idx] && employees
                                        .filter(u => u.name.toLowerCase().includes(stageSearchTerm[idx].toLowerCase()))
                                        .filter(u => !sa.user_ids.includes(u.id))
                                        .map(u => (
                                          <button key={u.id} type="button"
                                            onClick={() => updateSa({ user_ids: [u.id] })}
                                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: '1px dashed var(--sand-border)', borderRadius: 99, padding: '3px 8px 3px 4px', fontSize: 11, cursor: 'pointer', color: 'var(--ink-muted)' }}>
                                            <span style={{ width: 18, height: 18, borderRadius: '50%', background: u.avatar_color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                                              {u.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
                                            </span>
                                            <span>{u.name.split(' ')[0]}</span>
                                          </button>
                                      ))}
                                      {!stageSearchTerm[idx] && <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>Type a name to search...</span>}
                                      {employees.length === 0 && (
                                        <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>No employees in this project.</span>
                                      )}
                                    </div>
                                  </div>
                                )}
                                {pool.length === 0 && isReviewer && <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>Any {isAdmin ? 'admin' : 'manager'} can review</span>}
                              </div>
                            </div>
                            
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* Assignment — hidden for XLR8 (manager assigns after ticket is raised) */}
                {(() => {
                  const selProjForAssign = projects.find(p => String(p.id) === String(form.project_id));
                  if (selProjForAssign?.service_type === 'xlr8') return null;
                  const projPodForAssign = selProjForAssign?.pod;
                  const pool = users.filter(u => ['admin','manager','employee'].includes(u.role) && (!projPodForAssign || u.role === 'admin' || u.pod === projPodForAssign));
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
                <button type="button" className="drawer-cancel" onClick={handleDraft} style={{ color: 'var(--ink-muted)' }}>Save Draft</button>
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
                          type="number" min="0" max="999" placeholder="0"
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
                {(editTask.estimated_hours || editTask.due_date || editTask.ticket_type_id) && (
                  <div style={{ background: 'var(--bg-sand)', borderRadius: 12, padding: '12px 16px', display: 'flex', gap: 20 }}>
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Project</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{editTask.project_name}</div>
                    </div>
                    {(() => {
                      const dispH = editTask.ticket_type_id
                        ? (editTask.assignees?.find((a: any) => a.stage_idx === ((editTask as any).xlr8_stage_idx ?? 0) && a.est_hours > 0)?.est_hours ?? null)
                        : editTask.estimated_hours;
                      return dispH ? (
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Current Est.</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{fmtHours(Number(dispH))}</div>
                      </div>
                      ) : null;
                    })()}
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

                {/* XLR8 Stages panel in Edit */}
                {(() => {
                  if (!editTask?.ticket_type_id) return null;
                  const tt = ticketTypes.find(t => String(t.id) === String(editTask.ticket_type_id));
                  if (!tt || tt.stages.length === 0) return null;
                  const proj = projects.find(p => String(p.id) === String(editTask.project_id));
                  const projPod = proj?.pod || (() => {
                    const mgr = proj?.members?.find((m: any) => m.role === 'manager');
                    return mgr?.pod || (mgr ? users.find(u => u.id === mgr.user_id)?.pod : null);
                  })();
                  const empPool = users.filter(u => u.role === 'employee' && (!projPod || u.pod === projPod));

                  const totalMinE = (Number(editForm.est_hours) || 0) * 60 + (Number(editForm.est_minutes) || 0);
                  const allocMinE = Object.values(editStageAssignments).reduce((sum, v) => sum + (Number(v.est_hours) || 0) * 60 + (Number(v.est_minutes) || 0), 0);
                  const remMinE = totalMinE - allocMinE;
                  const fmtMinE = (m: number) => { const abs = Math.abs(m); return `${m < 0 ? '-' : ''}${Math.floor(abs / 60)}h ${abs % 60}m`; };

                  const autoSplitE = () => {
                    if (!totalMinE) return;
                    const REVIEW_MIN = 2;
                    const reviewCount = tt.stages.filter((s: any) => s.type === 'manager' || s.type === 'admin').length;
                    const empIndices = tt.stages.map((_: any, i: number) => i).filter((i: number) => {
                      const s = tt.stages[i]; return s.type !== 'manager' && s.type !== 'admin';
                    });
                    const empTotal = totalMinE - reviewCount * REVIEW_MIN;
                    const empCount = empIndices.length;
                    const perEmpMin = empCount > 0 ? Math.floor(empTotal / empCount) : 0;
                    const empRem = empCount > 0 ? empTotal % empCount : 0;
                    setEditStageAssignments(prev => {
                      const next = { ...prev };
                      tt.stages.forEach((s: any, i: number) => {
                        const isReview = s.type === 'manager' || s.type === 'admin';
                        const m = isReview ? REVIEW_MIN : perEmpMin + (empIndices[0] === i ? empRem : 0);
                        next[i] = { ...(next[i] || { user_ids: [] }), est_hours: String(Math.floor(m / 60)), est_minutes: String(m % 60) };
                      });
                      return next;
                    });
                  };

                  return (
                    <div className="drawer-section">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <div className="drawer-section-title" style={{ marginBottom: 0 }}>Stages</div>
                        {totalMinE > 0 && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 11, color: remMinE < 0 ? 'var(--red)' : 'var(--ink-muted)' }}>
                              {fmtMinE(allocMinE)} / {fmtMinE(totalMinE)}{remMinE !== 0 && ` · ${remMinE > 0 ? fmtMinE(remMinE) + ' left' : fmtMinE(remMinE) + ' over'}`}
                            </span>
                            <button type="button" onClick={autoSplitE} style={{ fontSize: 11, padding: '2px 8px', background: 'none', border: '1px solid var(--sand-border)', borderRadius: 6, cursor: 'pointer', color: 'var(--ink-muted)' }}>
                              Split equally
                            </button>
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {tt.stages.map((s: any, idx: number) => {
                          const sa = editStageAssignments[idx] || { user_ids: [], est_hours: '', est_minutes: '0' };
                          const isManager = s.type === 'manager';
                          const isAdmin = s.type === 'admin';
                          const isReviewer = isManager || isAdmin;
                          const editProjMemberIds = new Set((proj?.members || []).map((m: any) => m.user_id));
                          const catEmployees = isReviewer ? [] : empPool.filter(u =>
                            u.categories?.some((c: any) => c.name === s.category_name) || editProjMemberIds.has(u.id)
                          );
                          const reviewPool = isAdmin
                            ? users.filter(u => u.role === 'admin')
                            : isManager
                              ? users.filter(u => u.role === 'manager' && (!projPod || u.pod === projPod))
                              : [];
                          const pool2 = isReviewer ? reviewPool : catEmployees;
                          const selectedUsers = users.filter(u => sa.user_ids.includes(u.id));
                          const unselectedUsers = pool2.filter(u => !sa.user_ids.includes(u.id));
                          const updateSa = (patch: Partial<{ user_ids: number[]; est_hours: string; est_minutes: string }>) =>
                            setEditStageAssignments(prev => ({ ...prev, [idx]: { ...(prev[idx] || { user_ids: [], est_hours: '', est_minutes: '0' }), ...patch } }));
                          const bgColor = isAdmin ? 'rgba(234,88,12,0.05)' : isManager ? 'rgba(74,144,226,0.05)' : 'var(--surface-raised, #f8f8f8)';
                          const labelColor = isAdmin ? 'var(--orange, #ea580c)' : isManager ? 'var(--blue, #1a5fa0)' : 'var(--ink)';
                          const label = isAdmin ? 'Admin Review' : isManager ? 'Manager Review' : s.category_name;
                          return (
                            <div key={idx} style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--sand-border)', background: bgColor }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', width: 18, textAlign: 'center', flexShrink: 0 }}>{idx + 1}</span>
                                <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: labelColor }}>{label}</span>
                                <input
                                  type="number" min="0" max="99" placeholder="0h"
                                  value={sa.est_hours}
                                  onChange={e => updateSa({ est_hours: e.target.value })}
                                  className="form-input"
                                  style={{ width: 48, marginBottom: 0, fontSize: 12, textAlign: 'center', border: '1.5px solid var(--sand-border)', background: 'var(--surface)', color: 'var(--ink)', padding: '6px 4px' }}
                                  title="Hours"
                                />
                                <input
                                  type="number" min="0" max="59" placeholder="0m"
                                  value={sa.est_minutes === '0' ? '' : sa.est_minutes}
                                  onChange={e => updateSa({ est_minutes: e.target.value || '0' })}
                                  className="form-input"
                                  style={{ width: 48, marginBottom: 0, fontSize: 12, textAlign: 'center', border: '1.5px solid var(--sand-border)', background: 'var(--surface)', color: 'var(--ink)', padding: '6px 4px' }}
                                  title="Minutes"
                                />
                              </div>
                              <div style={{ paddingLeft: 26 }}>
                                {selectedUsers.length > 0 && (
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
                                    {selectedUsers.map(u => (
                                      <span key={u.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--surface)', border: '1px solid var(--green)', borderRadius: 99, padding: '3px 8px 3px 4px', fontSize: 11 }}>
                                        <span style={{ width: 18, height: 18, borderRadius: '50%', background: u.avatar_color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                                          {u.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
                                        </span>
                                        <span style={{ fontWeight: 600 }}>{u.name.split(' ')[0]}</span>
                                        <button type="button" onClick={() => updateSa({ user_ids: sa.user_ids.filter(id => id !== u.id) })} style={{ background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1, color: 'var(--ink-muted)', padding: 0, fontSize: 12 }}>×</button>
                                      </span>
                                    ))}
                                  </div>
                                )}
                                {unselectedUsers.length > 0 && (
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                    {unselectedUsers.map(u => (
                                      <button key={u.id} type="button"
                                        onClick={() => updateSa({ user_ids: [u.id] })}
                                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: '1px dashed var(--sand-border)', borderRadius: 99, padding: '3px 8px 3px 4px', fontSize: 11, cursor: 'pointer', color: 'var(--ink-muted)' }}>
                                        <span style={{ width: 18, height: 18, borderRadius: '50%', background: u.avatar_color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                                          {u.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
                                        </span>
                                        <span>{u.name.split(' ')[0]}</span>
                                      </button>
                                    ))}
                                  </div>
                                )}
                                {!isReviewer && !editStageSearchOpen[idx] && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: pool2.length > 0 ? 6 : 0 }}>
                                    {pool2.length === 0 && <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>No employees in this category — manager will assign</span>}
                                    <button
                                      type="button"
                                      onClick={() => setEditStageSearchOpen(prev => ({ ...prev, [idx]: true }))}
                                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', fontSize: 11, background: 'var(--surface)', border: '1px solid var(--sand-border)', borderRadius: 6, cursor: 'pointer' }}
                                    >
                                      Search Project Employees
                                    </button>
                                  </div>
                                )}
                                {!isReviewer && editStageSearchOpen[idx] && (
                                  <div style={{ marginTop: 8 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                                      <input
                                        type="text"
                                        placeholder="Search employees..."
                                        value={editStageSearchTerm[idx] || ''}
                                        onChange={e => setEditStageSearchTerm(prev => ({ ...prev, [idx]: e.target.value }))}
                                        className="form-input"
                                        style={{ fontSize: 12, padding: '4px 8px', width: '100%', maxWidth: 200, marginBottom: 0 }}
                                        autoFocus
                                      />
                                      <button type="button" onClick={() => { setEditStageSearchOpen(prev => ({ ...prev, [idx]: false })); setEditStageSearchTerm(prev => ({ ...prev, [idx]: '' })); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--ink-muted)' }}>Close</button>
                                    </div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                      {editStageSearchTerm[idx] && empPool
                                        .filter(u => u.name.toLowerCase().includes(editStageSearchTerm[idx].toLowerCase()))
                                        .filter(u => !sa.user_ids.includes(u.id))
                                        .map(u => (
                                          <button key={u.id} type="button"
                                            onClick={() => updateSa({ user_ids: [u.id] })}
                                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: '1px dashed var(--sand-border)', borderRadius: 99, padding: '3px 8px 3px 4px', fontSize: 11, cursor: 'pointer', color: 'var(--ink-muted)' }}>
                                            <span style={{ width: 18, height: 18, borderRadius: '50%', background: u.avatar_color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                                              {u.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
                                            </span>
                                            <span>{u.name.split(' ')[0]}</span>
                                          </button>
                                      ))}
                                      {!editStageSearchTerm[idx] && <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>Type a name to search...</span>}
                                      {empPool.length === 0 && (
                                        <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>No employees in this project.</span>
                                      )}
                                    </div>
                                  </div>
                                )}
                                {pool2.length === 0 && isReviewer && <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>Any {isAdmin ? 'admin' : 'manager'} can review</span>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* Assignment */}
                {(() => {
                  const editProj = projects.find(p => String(p.id) === String(editTask?.project_id));
                  const editProjPod = editProj?.pod;
                  const pool = users.filter(u => ['admin','manager','employee'].includes(u.role) && (!editProjPod || u.role === 'admin' || u.pod === editProjPod));
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

              {/* Workflow history for ticket tasks */}
              {taskLog.length > 0 && (
                <div style={{ padding: '0 20px 16px' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ink-muted)', marginBottom: 8 }}>
                    Workflow History
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {taskLog.map((entry: any, i: number) => {
                      const actionLabels: Record<string, string> = {
                        created: 'Created', assigned: 'Assigned to employee', employee_accepted: 'Accepted', employee_declined: 'Declined',
                        work_done: 'Marked done', manager_approved: 'Manager approved', manager_declined: 'Returned to employee',
                        next_stage: 'Moved to next stage', sent_to_admin: 'Sent to admin', admin_approved: 'Admin approved',
                        admin_skip_client: 'Skipped client, completed', admin_skipped: 'Admin skipped', client_approved: 'Client approved', completed: 'Completed',
                      };
                      const isDanger = entry.action.includes('declined') || entry.action.includes('reject');
                      return (
                        <div key={i} style={{ fontSize: 12, padding: '7px 12px', borderRadius: 7, background: isDanger ? 'rgba(239,68,68,0.06)' : 'rgba(76,175,125,0.06)', border: `1px solid ${isDanger ? 'rgba(239,68,68,0.2)' : 'rgba(76,175,125,0.2)'}`, color: 'var(--ink)' }}>
                          <span style={{ fontWeight: 600 }}>{entry.actor_name}</span>
                          <span style={{ color: 'var(--ink-muted)' }}> · {actionLabels[entry.action] || entry.action}</span>
                          {entry.comment && <span style={{ color: 'var(--ink-muted)' }}> — {entry.comment}</span>}
                          <span style={{ display: 'block', fontSize: 10, color: 'var(--ink-muted)', marginTop: 2, opacity: 0.7 }}>{format(new Date(Number(entry.created_at) || entry.created_at), 'MMM d, h:mm a')}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

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
              {ticketActionTask.xlr8_assignee_id && !showTicketDecline && (() => {
                const tt = ticketTypes.find((t) => t.id === ticketActionTask.ticket_type_id);
                const isFinal = tt ? (ticketActionTask.xlr8_stage_idx ?? 0) + 1 >= tt.stages.length : true;
                return (
                  <>
                    <button className="btn-ghost" onClick={() => setShowTicketDecline(true)}>Decline</button>
                    {isFinal ? (
                      <>
                        <button className="btn-ghost" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }} onClick={() => ticketReview('approve', undefined, true)} disabled={ticketActionLoading}>
                          {ticketActionLoading ? '…' : 'Approve → Client'}
                        </button>
                        <button className="btn-primary" onClick={() => ticketReview('approve')} disabled={ticketActionLoading}>
                          {ticketActionLoading ? '…' : 'Approve → Admin'}
                        </button>
                      </>
                    ) : (
                      <button className="btn-primary" onClick={() => ticketReview('approve')} disabled={ticketActionLoading}>{ticketActionLoading ? '…' : 'Approve'}</button>
                    )}
                  </>
                );
              })()}
              {showTicketDecline &&
                <button className="btn-primary" style={{ background: 'var(--red)', borderColor: 'var(--red)' }} onClick={() => ticketReview('decline', ticketDeclineComment)} disabled={ticketActionLoading}>
                  {ticketActionLoading ? '…' : 'Decline'}
                </button>
              }
            </div>
          </div>
        </div>
      )}

      {/* Recurring Task Modal */}
      {showRecurringModal && (
        <div className="drawer-backdrop" onClick={() => setShowRecurringModal(false)} style={{ zIndex: 1200 }}>
          <div onClick={e => e.stopPropagation()} style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: 'var(--surface)', borderRadius: 14, boxShadow: '0 8px 40px rgba(0,0,0,0.18)', width: 420, maxWidth: '95vw', padding: 28, zIndex: 1201 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>New Recurring Task</h2>
              <button type="button" onClick={() => setShowRecurringModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--ink-muted)' }}>×</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label className="form-label">Title *</label>
                <input className="form-input" value={recurringForm.title} onChange={e => setRecurringForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Weekly report every Monday" autoFocus />
              </div>
              <div>
                <label className="form-label">Project</label>
                <select className="form-input" value={recurringForm.project_id} onChange={e => setRecurringForm(f => ({ ...f, project_id: e.target.value }))}>
                  <option value="">None</option>
                  {projects.map(p => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
                </select>
              </div>
              {(user?.role === 'admin' || user?.role === 'manager') && (
                <div>
                  <label className="form-label">Assign To</label>
                  <select className="form-input" value={recurringForm.assigned_to} onChange={e => setRecurringForm(f => ({ ...f, assigned_to: e.target.value }))}>
                    <option value={String(user?.id)}>Me ({user?.name})</option>
                    {users.filter(u => u.id !== user?.id && u.role !== 'client').map(u => (
                      <option key={u.id} value={String(u.id)}>{u.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="form-label">Recurrence</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['daily','weekly','monthly'] as const).map(t => (
                    <button key={t} type="button" onClick={() => setRecurringForm(f => ({ ...f, recurrence_type: t }))}
                      style={{ flex: 1, padding: '7px 0', borderRadius: 8, border: `2px solid ${recurringForm.recurrence_type === t ? 'var(--brand)' : 'var(--sand-border)'}`, background: recurringForm.recurrence_type === t ? 'var(--brand-light,#eff6ff)' : 'transparent', fontWeight: 600, fontSize: 12, cursor: 'pointer', color: recurringForm.recurrence_type === t ? 'var(--brand)' : 'var(--ink-muted)' }}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              {recurringForm.recurrence_type === 'weekly' && (
                <div>
                  <label className="form-label">Repeat on</label>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {['Su','Mo','Tu','We','Th','Fr','Sa'].map((d, i) => (
                      <button key={i} type="button"
                        onClick={() => setRecurringForm(f => ({ ...f, recurrence_days: f.recurrence_days.includes(i) ? f.recurrence_days.filter(x => x !== i) : [...f.recurrence_days, i] }))}
                        style={{ width: 34, height: 34, borderRadius: 8, border: `2px solid ${recurringForm.recurrence_days.includes(i) ? 'var(--brand)' : 'var(--sand-border)'}`, background: recurringForm.recurrence_days.includes(i) ? 'var(--brand)' : 'transparent', color: recurringForm.recurrence_days.includes(i) ? '#fff' : 'var(--ink-muted)', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label className="form-label">Est. hours</label>
                  <input type="number" min="0.5" step="0.5" className="form-input" value={recurringForm.estimated_hours} onChange={e => setRecurringForm(f => ({ ...f, estimated_hours: e.target.value }))} />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="form-label">End date</label>
                  <input type="date" className="form-input" value={recurringForm.end_date} onChange={e => setRecurringForm(f => ({ ...f, end_date: e.target.value }))} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
                <button className="btn-secondary" onClick={() => setShowRecurringModal(false)}>Cancel</button>
                <button className="btn-primary" onClick={async () => {
                  if (!recurringForm.title.trim()) { alert('Title is required'); return; }
                  try {
                    await calendarApi.createRecurring({
                      ...recurringForm,
                      assigned_to: recurringForm.assigned_to ? Number(recurringForm.assigned_to) : undefined,
                      project_id: recurringForm.project_id ? Number(recurringForm.project_id) : null,
                      recurrence_days: recurringForm.recurrence_type === 'weekly' ? recurringForm.recurrence_days : [],
                      day_of_month: recurringForm.recurrence_type === 'monthly' ? Number(recurringForm.day_of_month) : null,
                      end_date: recurringForm.end_date || null,
                      estimated_hours: Number(recurringForm.estimated_hours) || 1,
                      start_date: new Date().toISOString().slice(0, 10),
                    });
                    setShowRecurringModal(false);
                  } catch (err: any) { alert(err.response?.data?.error || 'Error'); }
                }}>Create</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
