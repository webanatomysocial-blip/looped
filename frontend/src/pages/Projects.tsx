import { useEffect, useState, useRef } from 'react';
import { format, parseISO } from 'date-fns';
import { Plus, Filter, ArrowUpDown, Check } from 'lucide-react';
import Layout from '../components/Layout/Layout';

import Avatar from '../components/UI/Avatar';
import Drawer from '../components/UI/Drawer';
import { useAuth } from '../contexts/AuthContext';
import { projectsApi, usersApi, categoriesApi, assetsApi } from '../services/api';
import { Project, User, ClientCompany, EmployeeCategory } from '../types';
import '../css/pages/Projects.css';

const STATUS_OPTIONS = ['active', 'on_hold', 'completed'];
type MemberTab = 'admins' | 'managers' | 'employees';
type HealthLevel = 'all' | 'healthy' | 'tight' | 'over';
type SortKey = 'none' | 'budget_asc' | 'budget_desc' | 'due_asc' | 'due_desc';

const STAGE_LABELS: Record<string, string> = {
  active:    'In Progress',
  in_review: 'In Review',
  on_hold:   'On Hold',
  completed: 'Completed',
};

const FILTER_LABELS: Record<string, string> = {
  all: 'All', active: 'Active', in_review: 'In Review', on_hold: 'On Hold', completed: 'Completed',
};

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'budget_asc',  label: 'Budget used — Low to High' },
  { value: 'budget_desc', label: 'Budget used — High to Low' },
  { value: 'due_asc',     label: 'Due date — Earliest first' },
  { value: 'due_desc',    label: 'Due date — Latest first'   },
];

function budgetPct(project: Project): number {
  if (project.service_type === 'per_project') {
    return project.budget_used_pct ?? 0;
  }
  if (project.service_type === 'xlr8') {
    if (!project.monthly_hours_bucket) return 0;
    return Math.min(200, Math.round(((project.hours_this_cycle ?? 0) / project.monthly_hours_bucket) * 100));
  }
  if (!project.budgeted_hours) return 0;
  return Math.min(200, Math.round(((project.hours_logged ?? 0) / project.budgeted_hours) * 100));
}

function getHealth(project: Project): { label: string; level: 'healthy' | 'tight' | 'over' } {
  if (project.service_type === 'per_project' && project.health_flag) {
    const map: Record<string, { label: string; level: 'healthy' | 'tight' | 'over' }> = {
      green: { label: 'Healthy', level: 'healthy' },
      amber: { label: 'At Risk', level: 'tight'   },
      red:   { label: 'Critical', level: 'over'   },
    };
    return map[project.health_flag] ?? { label: 'Healthy', level: 'healthy' };
  }
  const pct = budgetPct(project);
  if (pct > 100) return { label: 'Over',    level: 'over'    };
  if (pct >= 82)  return { label: 'Tight',   level: 'tight'   };
  return                 { label: 'Healthy', level: 'healthy' };
}

export default function Projects() {
  const { user } = useAuth();
  const [projects, setProjects]     = useState<Project[]>([]);
  const [users, setUsers]           = useState<User[]>([]);
  const [companies, setCompanies]   = useState<ClientCompany[]>([]);
  const [categories, setCategories] = useState<EmployeeCategory[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showModal, setShowModal]   = useState(false);
  const [editProject, setEditProject] = useState<Project | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');

  // Filter + sort state
  const [healthFilter, setHealthFilter] = useState<HealthLevel>('all');
  const [sortBy, setSortBy]             = useState<SortKey>('none');
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [showSortMenu, setShowSortMenu]     = useState(false);

  const filterRef = useRef<HTMLDivElement>(null);
  const sortRef   = useRef<HTMLDivElement>(null);

  // Member picker tabs
  const [memberTab, setMemberTab] = useState<MemberTab>('admins');
  const [empSubTab, setEmpSubTab] = useState<string>('all');

  const [form, setForm] = useState({
    name: '', client_company_id: '', start_date: '', due_date: '', status: 'active', member_ids: [] as number[],
    service_type: 'per_project' as 'per_project' | 'xlr8',
    budget_amount: '', budget_cutoff_pct: '', budgeted_hours: '',
    monthly_hours_bucket: '', billing_cycle_start_day: '1',
    pod: 'pod1' as 'pod1' | 'pod2',
    briefing_doc: '', project_drive_doc: '',
  });

  const [briefingFileName, setBriefingFileName] = useState('');
  const [driveFileName, setDriveFileName] = useState('');

  // Manager accept flow
  const [acceptProject, setAcceptProject] = useState<Project | null>(null);
  const [acceptMemberIds, setAcceptMemberIds] = useState<number[]>([]);
  const [acceptEmpSubTab, setAcceptEmpSubTab] = useState<string>('all');

  const canCreate = user?.role === 'admin';
  const canEdit   = user?.role === 'admin' || user?.role === 'manager';

  const load = () => {
    setLoading(true);
    Promise.all([
      projectsApi.list(),
      canEdit ? usersApi.list()      : Promise.resolve({ data: [] }),
      canEdit ? usersApi.companies() : Promise.resolve({ data: [] }),
      canEdit ? categoriesApi.list() : Promise.resolve({ data: [] }),
    ])
      .then(([p, u, c, cats]) => {
        setProjects(p.data);
        setUsers(u.data);
        setCompanies(c.data);
        setCategories(cats.data);
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setShowFilterMenu(false);
      if (sortRef.current   && !sortRef.current.contains(e.target as Node))   setShowSortMenu(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const openCreate = () => {
    setEditProject(null);
    setForm({ name: '', client_company_id: '', start_date: '', due_date: '', status: 'active', member_ids: [],
      service_type: 'per_project', budget_amount: '', budget_cutoff_pct: '', budgeted_hours: '',
      monthly_hours_bucket: '', billing_cycle_start_day: '1',
      pod: 'pod1', briefing_doc: '', project_drive_doc: '' });
    setBriefingFileName('');
    setDriveFileName('');
    setMemberTab('admins');
    setEmpSubTab('all');
    setShowModal(true);
  };

  const openEdit = (p: Project) => {
    setEditProject(p);
    setForm({
      name: p.name,
      client_company_id: String(p.client_company_id || ''),
      start_date: p.start_date || '',
      due_date: p.due_date || '',
      status: p.status,
      member_ids: [...new Set([
        ...p.members.map((m) => m.user_id),
        ...users.filter((u) => u.role === 'admin').map((u) => u.id),
      ])],
      service_type: (p.service_type as 'per_project' | 'xlr8') || 'per_project',
      budget_amount: p.budget_amount != null ? String(p.budget_amount) : '',
      budget_cutoff_pct: p.budget_cutoff_pct != null ? String(p.budget_cutoff_pct) : '',
      budgeted_hours: p.budgeted_hours != null ? String(p.budgeted_hours) : '',
      monthly_hours_bucket: p.monthly_hours_bucket != null ? String(p.monthly_hours_bucket) : '',
      billing_cycle_start_day: p.billing_cycle_start_day != null ? String(p.billing_cycle_start_day) : '1',
      pod: (p.pod as 'pod1' | 'pod2') || 'pod1',
      briefing_doc: p.briefing_doc || '',
      project_drive_doc: p.project_drive_doc || '',
    });
    setMemberTab('admins');
    setEmpSubTab('all');
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (!editProject && user?.role === 'admin') {
        // Admin create: new flow — no member_ids, send pod + docs
        if (!form.briefing_doc.trim()) { alert('Briefing doc is required'); return; }
        await projectsApi.create({
          name: form.name,
          client_company_id: form.client_company_id ? Number(form.client_company_id) : null,
          service_type: form.service_type,
          pod: form.pod,
          briefing_doc: form.briefing_doc,
          project_drive_doc: form.project_drive_doc || null,
          start_date: form.start_date || null,
          due_date: form.due_date || null,
          budget_amount: form.budget_amount ? Number(form.budget_amount) : null,
          budget_cutoff_pct: form.budget_cutoff_pct ? Number(form.budget_cutoff_pct) : null,
          budgeted_hours: form.service_type === 'per_project' && form.budgeted_hours ? Number(form.budgeted_hours) : null,
          monthly_hours_bucket: form.service_type === 'xlr8' && form.monthly_hours_bucket ? Number(form.monthly_hours_bucket) : null,
          billing_cycle_start_day: form.service_type === 'xlr8' ? Number(form.billing_cycle_start_day) || 1 : null,
        });
      } else {
        const payload = {
          name: form.name,
          client_company_id: form.client_company_id ? Number(form.client_company_id) : null,
          start_date: form.start_date || null,
          due_date: form.due_date || null,
          status: form.status,
          member_ids: form.member_ids,
          service_type: form.service_type,
          budget_amount: form.budget_amount ? Number(form.budget_amount) : null,
          budget_cutoff_pct: form.budget_cutoff_pct ? Number(form.budget_cutoff_pct) : null,
          budgeted_hours: form.service_type === 'per_project' && form.budgeted_hours ? Number(form.budgeted_hours) : null,
          monthly_hours_bucket: form.service_type === 'xlr8' && form.monthly_hours_bucket ? Number(form.monthly_hours_bucket) : null,
          billing_cycle_start_day: form.service_type === 'xlr8' ? Number(form.billing_cycle_start_day) || 1 : null,
        };
        if (editProject) await projectsApi.update(editProject.id, payload);
        else await projectsApi.create(payload);
      }
      setShowModal(false);
      load();
    } catch (err: any) { alert(err.response?.data?.error || 'Error'); }
  };

  const handleManagerResponse = async (project: Project, action: 'accept' | 'decline') => {
    if (action === 'accept') {
      setAcceptProject(project);
      setAcceptMemberIds([]);
      setAcceptEmpSubTab('all');
    } else {
      if (!confirm(`Decline project "${project.name}"? Admin will be notified to review.`)) return;
      try { await projectsApi.managerResponse(project.id, 'decline'); load(); }
      catch (err: any) { alert(err.response?.data?.error || 'Error'); }
    }
  };

  const openDoc = async (url: string) => {
    if (!url.startsWith('/api/')) { window.open(url, '_blank'); return; }
    const token = localStorage.getItem('token');
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) { alert('Could not open file'); return; }
    const blob = await res.blob();
    window.open(URL.createObjectURL(blob), '_blank');
  };

  const handleManagerAccept = async () => {
    if (!acceptProject) return;
    try {
      await projectsApi.managerResponse(acceptProject.id, 'accept', acceptMemberIds);
      setAcceptProject(null);
      load();
    } catch (err: any) { alert(err.response?.data?.error || 'Error'); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this project?')) return;
    try { await projectsApi.delete(id); } catch (err: any) { alert(err.response?.data?.error || 'Delete failed'); return; }
    load();
  };

  const toggleMember = (id: number) =>
    setForm((f) => ({
      ...f,
      member_ids: f.member_ids.includes(id)
        ? f.member_ids.filter((x) => x !== id)
        : [...f.member_ids, id],
    }));

  const visibleUsers = (): User[] => {
    if (memberTab === 'admins')   return users.filter((u) => u.role === 'admin');
    if (memberTab === 'managers') return users.filter((u) => u.role === 'manager');
    const emps = users.filter((u) => u.role === 'employee');
    if (empSubTab === 'all') return emps;
    return emps.filter((u) => u.categories?.some((c) => String(c.id) === empSubTab));
  };

  const empCategories = categories.filter((cat) =>
    users.some((u) => u.role === 'employee' && u.categories?.some((c) => c.id === cat.id))
  );

  const countSelected = (tab: MemberTab) =>
    users.filter((u) => {
      if (!form.member_ids.includes(u.id)) return false;
      if (tab === 'admins')   return u.role === 'admin';
      if (tab === 'managers') return u.role === 'manager';
      return u.role === 'employee';
    }).length;

  // ── Compute display list ──
  let displayProjects = statusFilter === 'all'
    ? [...projects]
    : projects.filter((p) => p.status === statusFilter);

  // Health filter
  if (healthFilter !== 'all') {
    displayProjects = displayProjects.filter((p) => getHealth(p).level === healthFilter);
  }

  // Sort
  if (sortBy === 'budget_asc')  displayProjects.sort((a, b) => budgetPct(a) - budgetPct(b));
  if (sortBy === 'budget_desc') displayProjects.sort((a, b) => budgetPct(b) - budgetPct(a));
  if (sortBy === 'due_asc')     displayProjects.sort((a, b) => {
    if (!a.due_date && !b.due_date) return 0;
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return parseISO(a.due_date).getTime() - parseISO(b.due_date).getTime();
  });
  if (sortBy === 'due_desc')    displayProjects.sort((a, b) => {
    if (!a.due_date && !b.due_date) return 0;
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return parseISO(b.due_date).getTime() - parseISO(a.due_date).getTime();
  });

  const activeCount    = projects.filter((p) => p.status === 'active').length;
  const inReviewCount  = projects.filter((p) => p.status === 'in_review').length;
  const completedCount = projects.filter((p) => p.status === 'completed').length;

  const activeFilterCount = (healthFilter !== 'all' ? 1 : 0);
  const activeSortLabel   = SORT_OPTIONS.find((o) => o.value === sortBy)?.label ?? '';

  return (
    <Layout>
      <div className="page-wrap">

        {/* ── Page header ── */}
        <div className="proj-page-header">
          <div>
            <h2 className="page-title">Projects</h2>
            <p className="page-subtitle">
              {activeCount} active · {inReviewCount} in review · {completedCount} completed
            </p>
          </div>
          <div className="proj-header-actions">

            {/* Filter button + dropdown */}
            <div className="proj-dropdown-wrap" ref={filterRef}>
              <button
                className={`btn-secondary proj-action-btn${activeFilterCount > 0 ? ' proj-action-btn--on' : ''}`}
                onClick={() => { setShowFilterMenu((v) => !v); setShowSortMenu(false); }}
              >
                <Filter size={13} />
                Filter
                {activeFilterCount > 0 && <span className="proj-action-badge">{activeFilterCount}</span>}
              </button>
              {showFilterMenu && (
                <div className="proj-dropdown">
                  <div className="proj-dropdown__section">Health</div>
                  {(['all', 'healthy', 'tight', 'over'] as HealthLevel[]).map((h) => (
                    <button
                      key={h}
                      className={`proj-dropdown__item${healthFilter === h ? ' proj-dropdown__item--on' : ''}`}
                      onClick={() => { setHealthFilter(h); setShowFilterMenu(false); }}
                    >
                      <span className={`proj-dropdown__dot proj-dot--${h}`} />
                      {h === 'all' ? 'All health' : h.charAt(0).toUpperCase() + h.slice(1)}
                      {healthFilter === h && <Check size={12} className="proj-dropdown__check" />}
                    </button>
                  ))}
                  {healthFilter !== 'all' && (
                    <button className="proj-dropdown__clear" onClick={() => { setHealthFilter('all'); setShowFilterMenu(false); }}>
                      Clear filter
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Sort button + dropdown */}
            <div className="proj-dropdown-wrap" ref={sortRef}>
              <button
                className={`btn-secondary proj-action-btn${sortBy !== 'none' ? ' proj-action-btn--on' : ''}`}
                onClick={() => { setShowSortMenu((v) => !v); setShowFilterMenu(false); }}
              >
                <ArrowUpDown size={13} />
                Sort
                {sortBy !== 'none' && <span className="proj-action-badge">1</span>}
              </button>
              {showSortMenu && (
                <div className="proj-dropdown">
                  <div className="proj-dropdown__section">Sort by</div>
                  {SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      className={`proj-dropdown__item${sortBy === opt.value ? ' proj-dropdown__item--on' : ''}`}
                      onClick={() => { setSortBy(opt.value); setShowSortMenu(false); }}
                    >
                      {opt.label}
                      {sortBy === opt.value && <Check size={12} className="proj-dropdown__check" />}
                    </button>
                  ))}
                  {sortBy !== 'none' && (
                    <button className="proj-dropdown__clear" onClick={() => { setSortBy('none'); setShowSortMenu(false); }}>
                      Clear sort
                    </button>
                  )}
                </div>
              )}
            </div>

            {canCreate && (
              <button className="proj-new-btn" onClick={openCreate}>
                <Plus size={14} /> New project
              </button>
            )}
          </div>
        </div>

        {/* Active filter/sort pills */}
        {(healthFilter !== 'all' || sortBy !== 'none') && (
          <div className="proj-active-filters">
            {healthFilter !== 'all' && (
              <span className="proj-filter-pill">
                Health: {healthFilter.charAt(0).toUpperCase() + healthFilter.slice(1)}
                <button onClick={() => setHealthFilter('all')}>×</button>
              </span>
            )}
            {sortBy !== 'none' && (
              <span className="proj-filter-pill">
                {activeSortLabel}
                <button onClick={() => setSortBy('none')}>×</button>
              </span>
            )}
          </div>
        )}

        {/* ── Status tabs ── */}
        <div className="filter-bar" style={{ marginBottom: 24 }}>
          {['all', ...STATUS_OPTIONS].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`filter-tab${statusFilter === s ? ' active' : ''}`}
            >
              {FILTER_LABELS[s] ?? s}
            </button>
          ))}
        </div>

        {/* ── Manager: pending projects ── */}
        {user?.role === 'manager' && (() => {
          const pending = projects.filter((p) => p.manager_status === 'pending_manager');
          if (!pending.length) return null;
          return (
            <div style={{ marginBottom: 24, padding: '16px 20px', background: 'var(--amber-50,#fffbeb)', border: '1px solid var(--amber-200,#fde68a)', borderRadius: 10 }}>
              <p style={{ fontWeight: 600, marginBottom: 12, color: 'var(--amber-700,#92400e)' }}>Pending your approval ({pending.length})</p>
              {pending.map((p) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid var(--amber-100,#fef3c7)' }}>
                  <div>
                    <span style={{ fontWeight: 500 }}>{p.name}</span>
                    {p.client_name && <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--ink-muted)' }}>{p.client_name}</span>}
                    {p.briefing_doc && <button type="button" style={{ marginLeft: 10, fontSize: 12, background: 'none', border: 'none', color: 'var(--brand)', cursor: 'pointer', padding: 0, textDecoration: 'underline' }} onClick={() => openDoc(p.briefing_doc!)}>Briefing doc ↗</button>}
                    {p.project_drive_doc && <button type="button" style={{ marginLeft: 8, fontSize: 12, background: 'none', border: 'none', color: 'var(--brand)', cursor: 'pointer', padding: 0, textDecoration: 'underline' }} onClick={() => openDoc(p.project_drive_doc!)}>Drive ↗</button>}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn-secondary" style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => handleManagerResponse(p, 'decline')}>Decline</button>
                    <button className="proj-new-btn" style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => handleManagerResponse(p, 'accept')}>Accept</button>
                  </div>
                </div>
              ))}
            </div>
          );
        })()}

        {loading && <p className="page-subtitle" style={{ textAlign: 'center', padding: '40px 0' }}>Loading…</p>}

        {/* ── Projects table ── */}
        {!loading && displayProjects.length > 0 && (
          <div className="proj-table-wrap">
            <table className="proj-table">
              <thead>
                <tr>
                  <th className="proj-th">Project</th>
                  <th className="proj-th">Client</th>
                  <th className="proj-th">Stage</th>
                  {user?.role === 'admin' && <th className="proj-th">Health</th>}
                  {user?.role === 'admin' && <th className="proj-th proj-th--budget">Budget used</th>}
                  <th className="proj-th">Team</th>
                  <th className="proj-th proj-th--right">Due</th>
                </tr>
              </thead>
              <tbody>
                {displayProjects.map((project) => {
                  const pct    = budgetPct(project);
                  const health = getHealth(project);
                  return (
                    <tr
                      key={project.id}
                      className="proj-row"
                      onClick={() => canEdit && openEdit(project)}
                    >
                      <td className="proj-td">
                        <span className="proj-name">{project.name}</span>
                        {project.manager_status === 'pending_manager' && (
                          <span style={{ marginLeft: 6, fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'var(--amber-100,#fef3c7)', color: 'var(--amber-700,#92400e)', fontWeight: 600 }}>Pending</span>
                        )}
                        {project.manager_status === 'declined' && (
                          <span style={{ marginLeft: 6, fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'var(--red-100,#fee2e2)', color: 'var(--red-700,#b91c1c)', fontWeight: 600 }}>Declined</span>
                        )}
                      </td>
                      <td className="proj-td proj-client">
                        {project.client_name || '—'}
                      </td>
                      <td className="proj-td">
                        <span className={`proj-stage proj-stage--${project.status}`}>
                          {STAGE_LABELS[project.status]}
                        </span>
                      </td>
                      {user?.role === 'admin' && (
                        <td className="proj-td">
                          <span className={`proj-health proj-health--${health.level}`}>
                            {health.label}
                          </span>
                        </td>
                      )}
                      {user?.role === 'admin' && (
                      <td className="proj-td proj-td--budget">
                        {project.service_type === 'per_project' && project.working_budget != null ? (
                          <div>
                            <div className="proj-budget-row">
                              <div className="proj-budget-track">
                                <div className={`proj-budget-fill proj-budget-fill--${health.level}`}
                                  style={{ width: `${Math.min(100, pct)}%` }} />
                              </div>
                              <span className="proj-budget-pct" style={{ color: `var(--${health.level === 'healthy' ? 'green' : health.level === 'tight' ? 'amber-600' : 'red'})` }}>
                                {pct}%
                              </span>
                            </div>
                            <p className="proj-rate-inline">
                              ₹{(project.total_spend ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })} spent · ₹{(project.amount_remaining ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })} left
                            </p>
                          </div>
                        ) : project.service_type === 'xlr8' && project.monthly_hours_bucket ? (
                          <div>
                            <div className="proj-budget-row">
                              <div className="proj-budget-track">
                                <div className={`proj-budget-fill proj-budget-fill--${health.level}`}
                                  style={{ width: `${Math.min(100, pct)}%` }} />
                              </div>
                              <span className="proj-budget-pct">{project.hours_this_cycle ?? 0}/{project.monthly_hours_bucket}h</span>
                            </div>
                            {project.budget_amount && project.monthly_hours_bucket && (
                              <p className="proj-rate-inline">
                                ₹{((project.hours_this_cycle ?? 0) * ((project.budget_amount * (1 - (project.budget_cutoff_pct ?? 0) / 100)) / project.monthly_hours_bucket)).toLocaleString('en-IN', { maximumFractionDigits: 0 })} spent · {Math.max(0, project.monthly_hours_bucket - (project.hours_this_cycle ?? 0)).toFixed(1)}h left
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="proj-budget-pct" style={{ color: 'var(--ink-muted)' }}>—</span>
                        )}
                      </td>
                      )}
                      <td className="proj-td">
                        <div className="proj-team">
                          {project.members.slice(0, 4).map((m) => (
                            <Avatar key={m.user_id} name={m.name} color={m.avatar_color} size="sm" />
                          ))}
                          {project.members.length > 4 && (
                            <div className="proj-team-more">+{project.members.length - 4}</div>
                          )}
                        </div>
                      </td>
                      <td className="proj-td proj-td--due">
                        <span className="proj-due">
                          {project.due_date ? format(parseISO(project.due_date), 'MMM dd') : '—'}
                        </span>
                        {user?.role === 'admin' && (
                          <button
                            className="proj-delete-btn"
                            onClick={(e) => { e.stopPropagation(); handleDelete(project.id); }}
                          >
                            ×
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && displayProjects.length === 0 && (
          <div className="empty-state">No projects found</div>
        )}
      </div>

      {showModal && (
        <Drawer
          label={editProject ? 'Edit Project' : 'New Project'}
          title={editProject ? editProject.name : 'Project details'}
          onClose={() => setShowModal(false)}
        >
          <form onSubmit={handleSubmit} style={{ display: 'contents' }}>
            <div className="drawer-body">
              <div>
                <label className="form-label">Project name *</label>
                <input className="form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
              </div>

              <div>
                <label className="form-label">Client</label>
                <select className="form-input" value={form.client_company_id}
                  onChange={(e) => {
                    const cid = e.target.value;
                    const client = companies.find((c) => String(c.id) === cid);
                    setForm((f) => ({
                      ...f,
                      client_company_id: cid,
                      ...(client?.pod ? { pod: client.pod as 'pod1' | 'pod2' } : {}),
                    }));
                  }}>
                  <option value="">No client</option>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              {/* Service type — toggle for admin, read-only badge for manager */}
              <div>
                <label className="form-label">Service type</label>
                {user?.role === 'admin' ? (
                  <div className="proj-svc-toggle">
                    <button type="button"
                      className={`proj-svc-btn${form.service_type === 'per_project' ? ' proj-svc-btn--active' : ''}`}
                      onClick={() => setForm({ ...form, service_type: 'per_project' })}>
                       Project
                    </button>
                    <button type="button"
                      className={`proj-svc-btn${form.service_type === 'xlr8' ? ' proj-svc-btn--active' : ''}`}
                      onClick={() => setForm({ ...form, service_type: 'xlr8' })}>
                      XLR8
                    </button>
                  </div>
                ) : (
                  <span className={`proj-svc-btn proj-svc-btn--active`} style={{ display: 'inline-block', cursor: 'default', marginTop: 4 }}>
                    {form.service_type === 'xlr8' ? 'XLR8' : 'Project'}
                  </span>
                )}
              </div>

              {/* Per-project billing fields — admin only */}
              {form.service_type === 'per_project' && user?.role === 'admin' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label className="form-label">Budget (₹)</label>
                    <input type="number" min="0" step="0.01" className="form-input"
                      placeholder="e.g. 70000"
                      value={form.budget_amount}
                      onChange={(e) => setForm({ ...form, budget_amount: e.target.value })} />
                  </div>
                  <div>
                    <label className="form-label">Cut-off %</label>
                    <input type="number" min="0" max="100" step="0.1" className="form-input"
                      placeholder="e.g. 10"
                      value={form.budget_cutoff_pct}
                      onChange={(e) => setForm({ ...form, budget_cutoff_pct: e.target.value })} />
                  </div>
                  {form.budget_amount && (
                    <div style={{ gridColumn: '1/-1' }}>
                      <p className="proj-rate-hint">
                        Working budget: ₹{(Number(form.budget_amount) * (1 - (Number(form.budget_cutoff_pct) || 0) / 100)).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        {form.budget_cutoff_pct && Number(form.budget_cutoff_pct) > 0 && (
                          <> · ₹{(Number(form.budget_amount) * (Number(form.budget_cutoff_pct) / 100)).toLocaleString('en-IN', { maximumFractionDigits: 0 })} </>
                        )}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* XLR8 billing fields — admin only */}
              {form.service_type === 'xlr8' && user?.role === 'admin' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label className="form-label">Budget (₹)</label>
                    <input type="number" min="0" step="0.01" className="form-input"
                      placeholder="e.g. 50000"
                      value={form.budget_amount}
                      onChange={(e) => setForm({ ...form, budget_amount: e.target.value })} />
                  </div>
                  <div>
                    <label className="form-label">Hours bucket</label>
                    <input type="number" min="1" step="0.5" className="form-input"
                      placeholder="e.g. 31"
                      value={form.monthly_hours_bucket}
                      onChange={(e) => setForm({ ...form, monthly_hours_bucket: e.target.value })} />
                  </div>
                  <div>
                    <label className="form-label">Cut-off %</label>
                    <input type="number" min="0" max="100" step="0.1" className="form-input"
                      placeholder="e.g. 20"
                      value={form.budget_cutoff_pct}
                      onChange={(e) => setForm({ ...form, budget_cutoff_pct: e.target.value })} />
                    {form.budget_cutoff_pct && form.budget_amount && Number(form.budget_cutoff_pct) > 0 && (
                      <p className="proj-rate-hint" style={{ marginTop: 4 }}>
                        Working budget: ₹{(Number(form.budget_amount) * (1 - Number(form.budget_cutoff_pct) / 100)).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        {' · '}₹{(Number(form.budget_amount) * Number(form.budget_cutoff_pct) / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })} reserved
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="form-label">Billing cycle start day</label>
                    <input type="date" className="form-input"
                      value={(() => {
                        const now = new Date();
                        const day = String(form.billing_cycle_start_day || now.getDate()).padStart(2, '0');
                        const m = String(now.getMonth() + 1).padStart(2, '0');
                        return `${now.getFullYear()}-${m}-${day}`;
                      })()}
                      onChange={(e) => {
                        const day = e.target.value ? e.target.value.split('-')[2] : String(new Date().getDate());
                        setForm({ ...form, billing_cycle_start_day: String(Number(day)) });
                      }} />
                  </div>
                  {form.budget_amount && form.monthly_hours_bucket && Number(form.monthly_hours_bucket) > 0 && (
                    <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                      <p className="proj-rate-hint" style={{ margin: 0 }}>
                        ₹{((Number(form.budget_amount) * (1 - (Number(form.budget_cutoff_pct) || 0) / 100)) / Number(form.monthly_hours_bucket)).toLocaleString('en-IN', { maximumFractionDigits: 2 })} / hr
                      </p>
                    </div>
                  )}
                  {!form.budget_amount && !form.monthly_hours_bucket && (
                    <div style={{ gridColumn: '1/-1' }}>
                      <p className="proj-rate-hint">Resets on day {form.billing_cycle_start_day || 1} of each month</p>
                    </div>
                  )}
                </div>
              )}

              {form.service_type !== 'xlr8' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label className="form-label">Start date</label>
                    <input type="date" className="form-input" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
                  </div>
                  <div>
                    <label className="form-label">End date</label>
                    <input type="date" className="form-input" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
                  </div>
                </div>
              )}

              {/* Admin create: pod + docs instead of status + members */}
              {!editProject && user?.role === 'admin' ? (
                <>
                  <div>
                    <label className="form-label">Send to pod *</label>
                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                      {(['pod1', 'pod2'] as const).map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setForm({ ...form, pod: p })}
                          style={{
                            flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                            border: form.pod === p ? '2px solid var(--brand)' : '2px solid var(--border)',
                            background: form.pod === p ? 'var(--brand-light,#eff6ff)' : 'transparent',
                            color: form.pod === p ? 'var(--brand)' : 'var(--ink-muted)',
                          }}
                        >
                          {p === 'pod1' ? 'Pod 1' : 'Pod 2'}
                        </button>
                      ))}
                    </div>
                  </div>
                  {(['briefing', 'drive'] as const).map((kind) => {
                    const isRequired = kind === 'briefing';
                    const label = kind === 'briefing' ? 'Briefing doc' : 'Project drive doc';
                    const fileName = kind === 'briefing' ? briefingFileName : driveFileName;
                    const fieldKey = kind === 'briefing' ? 'briefing_doc' : 'project_drive_doc';
                    const hasFile = !!form[fieldKey];
                    return (
                      <div key={kind}>
                        <label className="form-label">
                          {label}{isRequired ? ' *' : <span style={{ fontWeight: 400, color: 'var(--ink-muted)' }}> (optional)</span>}
                        </label>
                        <label style={{
                          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                          gap: 8, padding: '20px 16px', marginTop: 4,
                          border: `2px dashed ${hasFile ? 'var(--brand)' : 'var(--border)'}`,
                          borderRadius: 10, cursor: 'pointer',
                          background: hasFile ? 'var(--brand-light,#eff6ff)' : 'var(--surface-2,transparent)',
                          transition: 'border-color 0.15s, background 0.15s',
                        }}>
                          <input type="file" style={{ display: 'none' }} onChange={async (e) => {
                            const file = e.target.files?.[0]; if (!file) return;
                            const fd = new FormData(); fd.append('file', file); fd.append('name', file.name);
                            try {
                              const res = await assetsApi.upload(fd);
                              setForm((f) => ({ ...f, [fieldKey]: assetsApi.downloadUrl(res.data.id) }));
                              kind === 'briefing' ? setBriefingFileName(file.name) : setDriveFileName(file.name);
                            } catch { alert('Upload failed'); }
                            e.target.value = '';
                          }} />
                          {hasFile ? (
                            <>
                              <span style={{ fontSize: 22 }}>📄</span>
                              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--brand)', textAlign: 'center', wordBreak: 'break-all' }}>{fileName}</span>
                              <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>Click to replace</span>
                            </>
                          ) : (
                            <>
                              <span style={{ fontSize: 22 }}>☁️</span>
                              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-2,var(--ink-muted))' }}>Click to upload</span>
                              <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>PDF, image, or any doc</span>
                            </>
                          )}
                        </label>
                      </div>
                    );
                  })}
                </>
              ) : (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label className="form-label">Status</label>
                      <select className="form-input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                        {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{FILTER_LABELS[s] ?? s}</option>)}
                      </select>
                    </div>
                  </div>

                  <div>
                    <div className="member-picker-header">
                      <label className="form-label" style={{ margin: 0 }}>Team members</label>
                      {form.member_ids.length > 0 && (
                        <span className="member-total-badge">{form.member_ids.length} selected</span>
                      )}
                    </div>
                    <div className="member-role-tabs" style={{ marginTop: 8 }}>
                      {(['admins', 'managers', 'employees'] as MemberTab[]).map((tab) => {
                        const sel = countSelected(tab);
                        return (
                          <button key={tab} type="button" className={`member-role-tab${memberTab === tab ? ' active' : ''}`}
                            onClick={() => { setMemberTab(tab); setEmpSubTab('all'); }}>
                            {tab.charAt(0).toUpperCase() + tab.slice(1)}
                            {sel > 0 && <span className="member-role-tab__badge">{sel}</span>}
                          </button>
                        );
                      })}
                    </div>
                    {memberTab === 'employees' && empCategories.length > 0 && (
                      <div className="member-cat-tabs" style={{ marginTop: 6 }}>
                        <button type="button" className={`member-cat-tab${empSubTab === 'all' ? ' active' : ''}`} onClick={() => setEmpSubTab('all')}>All</button>
                        {empCategories.map((cat) => (
                          <button key={cat.id} type="button" className={`member-cat-tab${empSubTab === String(cat.id) ? ' active' : ''}`} onClick={() => setEmpSubTab(String(cat.id))}>
                            {cat.name}
                          </button>
                        ))}
                      </div>
                    )}
                    {visibleUsers().length > 0 && (
                      <p className="member-list-count">
                        {visibleUsers().length} {memberTab === 'admins' ? 'admin' : memberTab === 'managers' ? 'manager' : 'employee'}{visibleUsers().length !== 1 ? 's' : ''}
                        {countSelected(memberTab) > 0 && ` · ${countSelected(memberTab)} selected`}
                      </p>
                    )}
                    <div className="member-list">
                      {visibleUsers().length === 0 && <p className="member-list-empty">No users in this category</p>}
                      {visibleUsers().map((u) => (
                        <label key={u.id} className={`member-list-row${form.member_ids.includes(u.id) ? ' member-list-row--selected' : ''}`}>
                          <input type="checkbox" checked={form.member_ids.includes(u.id)} onChange={() => toggleMember(u.id)} style={{ display: 'none' }} />
                          <div className="member-list-row__check">
                            {form.member_ids.includes(u.id) && <span className="member-list-row__tick">✓</span>}
                          </div>
                          <Avatar name={u.name} color={u.avatar_color} size="sm" />
                          <div className="member-list-row__info">
                            <span className="member-list-row__name">{u.name}</span>
                            {u.categories && u.categories.length > 0 && (
                              <span className="member-list-row__cats">{u.categories.map((c) => c.name).join(' · ')}</span>
                            )}
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="drawer-footer">
              <button type="submit" className="drawer-submit">
                {editProject ? 'Save changes' : (!editProject && user?.role === 'admin') ? 'Send to pod' : 'Create project'}
              </button>
              <button type="button" className="drawer-cancel" onClick={() => setShowModal(false)}>Cancel</button>
            </div>
          </form>
        </Drawer>
      )}

      {/* Manager accept modal — employee picker */}
      {acceptProject && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(26,26,26,0.45)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setAcceptProject(null)}>
          <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 660, maxHeight: '82vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,0.18)', overflow: 'hidden' }}
            onClick={(e) => e.stopPropagation()}>

            {/* Header */}
            <div style={{ padding: '22px 24px 16px', borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Accepting project</p>
                  <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#111' }}>{acceptProject.name}</h3>
                </div>
                <button onClick={() => setAcceptProject(null)} style={{ flexShrink: 0, marginTop: 2, width: 28, height: 28, borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', background: 'rgba(0,0,0,0.04)', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555' }}>×</button>
              </div>
              <p style={{ margin: '10px 0 0', fontSize: 13, color: 'rgba(0,0,0,0.5)', lineHeight: 1.5 }}>
                Pick employees to assign — you'll be added automatically.
              </p>
            </div>

            {/* Category tabs */}
            {empCategories.length > 0 && (
              <div style={{ padding: '12px 24px', display: 'flex', gap: 6, flexWrap: 'wrap', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                <button type="button" className={`member-cat-tab${acceptEmpSubTab === 'all' ? ' active' : ''}`} onClick={() => setAcceptEmpSubTab('all')}>All</button>
                {empCategories.map((cat) => (
                  <button key={cat.id} type="button" className={`member-cat-tab${acceptEmpSubTab === String(cat.id) ? ' active' : ''}`} onClick={() => setAcceptEmpSubTab(String(cat.id))}>
                    {cat.name}
                  </button>
                ))}
              </div>
            )}

            {/* Employee list */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px' }}>
              {users
                .filter((u) => u.role === 'employee' && (acceptEmpSubTab === 'all' || u.categories?.some((c) => String(c.id) === acceptEmpSubTab)))
                .map((u) => {
                  const selected = acceptMemberIds.includes(u.id);
                  return (
                    <label key={u.id} style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '9px 10px', borderRadius: 10, cursor: 'pointer',
                      background: selected ? 'rgba(59,130,246,0.08)' : 'transparent', marginBottom: 2,
                      transition: 'background 0.12s',
                    }}>
                      <input type="checkbox" checked={selected}
                        onChange={() => setAcceptMemberIds((ids) => ids.includes(u.id) ? ids.filter((x) => x !== u.id) : [...ids, u.id])}
                        style={{ display: 'none' }} />
                      <div style={{
                        width: 20, height: 20, borderRadius: 6, flexShrink: 0,
                        border: selected ? '2px solid #3b82f6' : '2px solid rgba(0,0,0,0.18)',
                        background: selected ? '#3b82f6' : '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.12s',
                      }}>
                        {selected && <svg width="11" height="8" viewBox="0 0 11 8" fill="none"><path d="M1 3.5L4 6.5L10 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      </div>
                      <Avatar name={u.name} color={u.avatar_color} size="sm" />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#111' }}>{u.name}</p>
                        {u.categories && u.categories.length > 0 && (
                          <p style={{ margin: 0, fontSize: 11, color: 'rgba(0,0,0,0.45)', marginTop: 1 }}>{u.categories.map((c) => c.name).join(' · ')}</p>
                        )}
                      </div>
                    </label>
                  );
                })}
            </div>

            {/* Footer */}
            <div style={{ padding: '14px 24px', borderTop: '1px solid rgba(0,0,0,0.07)', display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ flex: 1, fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
                {acceptMemberIds.length > 0 ? `${acceptMemberIds.length} employee${acceptMemberIds.length !== 1 ? 's' : ''} selected` : 'No employees selected'}
              </span>
              <button style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)', background: 'transparent', fontSize: 13, cursor: 'pointer', color: '#555', fontWeight: 500 }}
                onClick={() => setAcceptProject(null)}>Cancel</button>
              <button className="drawer-submit" style={{ padding: '9px 20px', fontSize: 13, margin: 0 }} onClick={handleManagerAccept}>
                Accept project
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
