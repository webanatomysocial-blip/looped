import { useEffect, useState, useRef } from 'react';
import { format, parseISO } from 'date-fns';
import { Plus, Filter, ArrowUpDown, Check } from 'lucide-react';
import Layout from '../components/Layout/Layout';

import Avatar from '../components/UI/Avatar';
import Drawer from '../components/UI/Drawer';
import { useAuth } from '../contexts/AuthContext';
import { projectsApi, usersApi, categoriesApi } from '../services/api';
import { Project, User, ClientCompany, EmployeeCategory } from '../types';
import '../css/pages/Projects.css';

const STATUS_OPTIONS = ['active', 'in_review', 'on_hold', 'completed'];
type MemberTab = 'admins' | 'managers' | 'employees' | 'clients';
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
    name: '', client_company_id: '', due_date: '', status: 'active', member_ids: [] as number[],
    service_type: 'per_project' as 'per_project' | 'xlr8',
    budget_amount: '', budget_cutoff_pct: '', budgeted_hours: '',
    monthly_hours_bucket: '', billing_cycle_start_day: '1',
  });

  const canCreate = user?.role === 'admin' || user?.role === 'manager';

  const load = () => {
    setLoading(true);
    Promise.all([
      projectsApi.list(),
      canCreate ? usersApi.list()      : Promise.resolve({ data: [] }),
      canCreate ? usersApi.companies() : Promise.resolve({ data: [] }),
      canCreate ? categoriesApi.list() : Promise.resolve({ data: [] }),
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
    setForm({ name: '', client_company_id: '', due_date: '', status: 'active', member_ids: [],
      service_type: 'per_project', budget_amount: '', budget_cutoff_pct: '', budgeted_hours: '',
      monthly_hours_bucket: '', billing_cycle_start_day: '1' });
    setMemberTab('admins');
    setEmpSubTab('all');
    setShowModal(true);
  };

  const openEdit = (p: Project) => {
    setEditProject(p);
    setForm({
      name: p.name,
      client_company_id: String(p.client_company_id || ''),
      due_date: p.due_date || '',
      status: p.status,
      member_ids: p.members.map((m) => m.user_id),
      service_type: (p.service_type as 'per_project' | 'xlr8') || 'per_project',
      budget_amount: p.budget_amount != null ? String(p.budget_amount) : '',
      budget_cutoff_pct: p.budget_cutoff_pct != null ? String(p.budget_cutoff_pct) : '',
      budgeted_hours: p.budgeted_hours != null ? String(p.budgeted_hours) : '',
      monthly_hours_bucket: p.monthly_hours_bucket != null ? String(p.monthly_hours_bucket) : '',
      billing_cycle_start_day: p.billing_cycle_start_day != null ? String(p.billing_cycle_start_day) : '1',
    });
    setMemberTab('admins');
    setEmpSubTab('all');
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        name: form.name,
        client_company_id: form.client_company_id ? Number(form.client_company_id) : null,
        due_date: form.due_date || null,
        status: form.status,
        member_ids: form.member_ids,
        service_type: form.service_type,
        budget_amount: form.budget_amount ? Number(form.budget_amount) : null,
        budget_cutoff_pct: form.service_type === 'per_project' && form.budget_cutoff_pct ? Number(form.budget_cutoff_pct) : null,
        budgeted_hours: form.service_type === 'per_project' && form.budgeted_hours ? Number(form.budgeted_hours) : null,
        monthly_hours_bucket: form.service_type === 'xlr8' && form.monthly_hours_bucket ? Number(form.monthly_hours_bucket) : null,
        billing_cycle_start_day: form.service_type === 'xlr8' ? Number(form.billing_cycle_start_day) || 1 : null,
      };
      if (editProject) await projectsApi.update(editProject.id, payload);
      else await projectsApi.create(payload);
      setShowModal(false);
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
    if (memberTab === 'clients')  return users.filter((u) => u.role === 'client');
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
      if (tab === 'clients')  return u.role === 'client';
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
                  <th className="proj-th">Health</th>
                  <th className="proj-th proj-th--budget">Budget used</th>
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
                      onClick={() => canCreate && openEdit(project)}
                    >
                      <td className="proj-td">
                        <span className="proj-name">{project.name}</span>
                      </td>
                      <td className="proj-td proj-client">
                        {project.client_name || '—'}
                      </td>
                      <td className="proj-td">
                        <span className={`proj-stage proj-stage--${project.status}`}>
                          {STAGE_LABELS[project.status]}
                        </span>
                      </td>
                      <td className="proj-td">
                        <span className={`proj-health proj-health--${health.level}`}>
                          {health.label}
                        </span>
                      </td>
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
                                ₹{((project.hours_this_cycle ?? 0) * (project.budget_amount / project.monthly_hours_bucket)).toLocaleString('en-IN', { maximumFractionDigits: 0 })} spent · {Math.max(0, project.monthly_hours_bucket - (project.hours_this_cycle ?? 0)).toFixed(1)}h left
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="proj-budget-pct" style={{ color: 'var(--ink-muted)' }}>—</span>
                        )}
                      </td>
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
                  onChange={(e) => setForm({ ...form, client_company_id: e.target.value })}>
                  <option value="">No client</option>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              {/* Service type toggle */}
              <div>
                <label className="form-label">Service type</label>
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
              </div>

              {/* Per-project billing fields */}
              {form.service_type === 'per_project' && (
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
                          <> · ₹{(Number(form.budget_amount) * (Number(form.budget_cutoff_pct) / 100)).toLocaleString('en-IN', { maximumFractionDigits: 0 })} reserved as agency margin</>
                        )}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* XLR8 billing fields */}
              {form.service_type === 'xlr8' && (
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
                    <label className="form-label">Billing cycle start day</label>
                    <input type="date" className="form-input"
                      value={form.billing_cycle_start_day ? `2000-01-${String(form.billing_cycle_start_day).padStart(2, '0')}` : ''}
                      onChange={(e) => {
                        const day = e.target.value ? String(new Date(e.target.value).getDate()) : '1';
                        setForm({ ...form, billing_cycle_start_day: day });
                      }} />
                  </div>
                  {form.budget_amount && form.monthly_hours_bucket && Number(form.monthly_hours_bucket) > 0 && (
                    <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                      <p className="proj-rate-hint" style={{ margin: 0 }}>
                        ₹{(Number(form.budget_amount) / Number(form.monthly_hours_bucket)).toLocaleString('en-IN', { maximumFractionDigits: 2 })} / hr
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

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label className="form-label">Due date</label>
                  <input type="date" className="form-input" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
                </div>
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
                  {(['admins', 'managers', 'employees', 'clients'] as MemberTab[]).map((tab) => {
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
                    {visibleUsers().length} {memberTab === 'clients' ? 'client' : memberTab === 'admins' ? 'admin' : memberTab === 'managers' ? 'manager' : 'employee'}{visibleUsers().length !== 1 ? 's' : ''}
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
            </div>
            <div className="drawer-footer">
              <button type="submit" className="drawer-submit">{editProject ? 'Save changes' : 'Create project'}</button>
              <button type="button" className="drawer-cancel" onClick={() => setShowModal(false)}>Cancel</button>
            </div>
          </form>
        </Drawer>
      )}
    </Layout>
  );
}
