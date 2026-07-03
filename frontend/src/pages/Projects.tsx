import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Plus } from 'lucide-react';
import Layout from '../components/Layout/Layout';
import Header from '../components/Layout/Header';
import Badge from '../components/UI/Badge';
import Avatar from '../components/UI/Avatar';
import Modal from '../components/UI/Modal';
import { useAuth } from '../contexts/AuthContext';
import { projectsApi, usersApi, categoriesApi } from '../services/api';
import { Project, User, ClientCompany, EmployeeCategory } from '../types';
import '../css/pages/Projects.css';

const STATUS_OPTIONS = ['active', 'in_review', 'on_hold', 'completed'];
type MemberTab = 'admins' | 'managers' | 'employees' | 'clients';

export default function Projects() {
  const { user } = useAuth();
  const [projects, setProjects]     = useState<Project[]>([]);
  const [users, setUsers]           = useState<User[]>([]);
  const [companies, setCompanies]   = useState<ClientCompany[]>([]);
  const [categories, setCategories] = useState<EmployeeCategory[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showModal, setShowModal]   = useState(false);
  const [editProject, setEditProject] = useState<Project | null>(null);
  const [filter, setFilter]         = useState('all');

  // Member picker tabs
  const [memberTab, setMemberTab]   = useState<MemberTab>('admins');
  const [empSubTab, setEmpSubTab]   = useState<string>('all');

  const [form, setForm] = useState({
    name: '', client_company_id: '', due_date: '', status: 'active', member_ids: [] as number[],
  });

  const canCreate = user?.role === 'admin' || user?.role === 'manager';

  const load = () => {
    setLoading(true);
    Promise.all([
      projectsApi.list(),
      canCreate ? usersApi.list()       : Promise.resolve({ data: [] }),
      canCreate ? usersApi.companies()  : Promise.resolve({ data: [] }),
      canCreate ? categoriesApi.list()  : Promise.resolve({ data: [] }),
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

  const openCreate = () => {
    setEditProject(null);
    setForm({ name: '', client_company_id: '', due_date: '', status: 'active', member_ids: [] });
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
      };
      if (editProject) await projectsApi.update(editProject.id, payload);
      else await projectsApi.create(payload);
      setShowModal(false);
      load();
    } catch (err: any) { alert(err.response?.data?.error || 'Error'); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this project?')) return;
    await projectsApi.delete(id);
    load();
  };

  const toggleMember = (id: number) =>
    setForm((f) => ({
      ...f,
      member_ids: f.member_ids.includes(id)
        ? f.member_ids.filter((x) => x !== id)
        : [...f.member_ids, id],
    }));

  // Which users to show in the current tab/sub-tab
  const visibleUsers = (): User[] => {
    if (memberTab === 'admins')   return users.filter((u) => u.role === 'admin');
    if (memberTab === 'managers') return users.filter((u) => u.role === 'manager');
    if (memberTab === 'clients')  return users.filter((u) => u.role === 'client');
    const emps = users.filter((u) => u.role === 'employee');
    if (empSubTab === 'all') return emps;
    return emps.filter((u) => u.categories?.some((c) => String(c.id) === empSubTab));
  };

  // Employee category sub-tabs — only show categories that have at least one employee
  const empCategories = categories.filter((cat) =>
    users.some((u) => u.role === 'employee' && u.categories?.some((c) => c.id === cat.id))
  );

  // Selected count per tab for badge
  const countSelected = (tab: MemberTab) =>
    users.filter((u) => {
      if (!form.member_ids.includes(u.id)) return false;
      if (tab === 'admins')   return u.role === 'admin';
      if (tab === 'managers') return u.role === 'manager';
      if (tab === 'clients')  return u.role === 'client';
      return u.role === 'employee';
    }).length;

  const filtered = filter === 'all' ? projects : projects.filter((p) => p.status === filter);

  return (
    <Layout>
      <div className="page-wrap">
        <Header action={canCreate ? { label: 'New project', onClick: openCreate } : undefined} />

        <div className="projects-top">
          <div>
            <h2 className="page-title">Projects</h2>
            <p className="page-subtitle">{projects.length} projects · {projects.filter((p) => p.client_name).length} clients</p>
          </div>
          <div className="filter-bar">
            {['all', ...STATUS_OPTIONS].map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`filter-tab${filter === s ? ' active' : ''}`}
              >
                {s === 'all' ? 'All' : s.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
              </button>
            ))}
          </div>
        </div>

        {loading && <p className="page-subtitle">Loading…</p>}

        <div className="projects-grid">
          {filtered.map((project) => (
            <div
              key={project.id}
              className={`project-card project-card--${project.status}`}
              onClick={() => canCreate && openEdit(project)}
            >
              <div className="project-card__header">
                <div>
                  <p className="project-card__name">{project.name}</p>
                  <p className="project-card__client">{project.client_name || '—'}</p>
                </div>
                <Badge status={project.status} />
              </div>

              <div className="project-card__bar-wrap">
                <div
                  className="project-card__bar-fill"
                  style={{ width: project.status === 'completed' ? '100%' : project.status === 'on_hold' ? '40%' : '65%' }}
                />
              </div>

              <div className="project-card__footer">
                <div className="project-card__members">
                  {project.members.slice(0, 4).map((m) => (
                    <Avatar key={m.user_id} name={m.name} color={m.avatar_color} size="sm" />
                  ))}
                  {project.members.length > 4 && (
                    <div className="project-card__member-more">+{project.members.length - 4}</div>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {project.due_date && (
                    <span className="project-card__due">{format(new Date(project.due_date), 'MMM d')}</span>
                  )}
                  {user?.role === 'admin' && (
                    <button
                      className="project-card__delete"
                      onClick={(e) => { e.stopPropagation(); handleDelete(project.id); }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}

          {canCreate && (
            <button className="project-add-card" onClick={openCreate}>
              <div className="project-add-card__icon"><Plus size={18} /></div>
              <span>New project</span>
            </button>
          )}
        </div>

        {filtered.length === 0 && !loading && <div className="empty-state">No projects found</div>}
      </div>

      {showModal && (
        <Modal title={editProject ? 'Edit project' : 'New project'} onClose={() => setShowModal(false)}>
          <form onSubmit={handleSubmit}>
            <div className="modal-form-row">
              <label className="form-label">Project name *</label>
              <input className="form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div className="modal-form-row">
              <label className="form-label">Client</label>
              <select className="form-input" value={form.client_company_id} onChange={(e) => setForm({ ...form, client_company_id: e.target.value })}>
                <option value="">No client</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="modal-form-grid">
              <div>
                <label className="form-label">Due date</label>
                <input type="date" className="form-input" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
              </div>
              <div>
                <label className="form-label">Status</label>
                <select className="form-input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</option>)}
                </select>
              </div>
            </div>

            {/* ── Team members with tabbed picker ── */}
            <div className="modal-form-row">
              <div className="member-picker-header">
                <label className="form-label" style={{ margin: 0 }}>Team members</label>
                {form.member_ids.length > 0 && (
                  <span className="member-total-badge">{form.member_ids.length} selected</span>
                )}
              </div>

              {/* Role tabs */}
              <div className="member-role-tabs">
                {(['admins', 'managers', 'employees', 'clients'] as MemberTab[]).map((tab) => {
                  const sel = countSelected(tab);
                  return (
                    <button
                      key={tab}
                      type="button"
                      className={`member-role-tab${memberTab === tab ? ' active' : ''}`}
                      onClick={() => { setMemberTab(tab); setEmpSubTab('all'); }}
                    >
                      {tab.charAt(0).toUpperCase() + tab.slice(1)}
                      {sel > 0 && <span className="member-role-tab__badge">{sel}</span>}
                    </button>
                  );
                })}
              </div>

              {/* Employee category sub-tabs */}
              {memberTab === 'employees' && empCategories.length > 0 && (
                <div className="member-cat-tabs">
                  <button
                    type="button"
                    className={`member-cat-tab${empSubTab === 'all' ? ' active' : ''}`}
                    onClick={() => setEmpSubTab('all')}
                  >
                    All
                  </button>
                  {empCategories.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      className={`member-cat-tab${empSubTab === String(cat.id) ? ' active' : ''}`}
                      onClick={() => setEmpSubTab(String(cat.id))}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>
              )}

              {/* User list */}
              {visibleUsers().length > 0 && (
                <p className="member-list-count">
                  {visibleUsers().length} {memberTab === 'clients' ? 'client' : memberTab === 'admins' ? 'admin' : memberTab === 'managers' ? 'manager' : 'employee'}{visibleUsers().length !== 1 ? 's' : ''}
                  {countSelected(memberTab) > 0 && ` · ${countSelected(memberTab)} selected`}
                </p>
              )}
              <div className="member-list">
                {visibleUsers().length === 0 && (
                  <p className="member-list-empty">No users in this category</p>
                )}
                {visibleUsers().map((u) => (
                  <label key={u.id} className={`member-list-row${form.member_ids.includes(u.id) ? ' member-list-row--selected' : ''}`}>
                    <input
                      type="checkbox"
                      checked={form.member_ids.includes(u.id)}
                      onChange={() => toggleMember(u.id)}
                      style={{ display: 'none' }}
                    />
                    <div className="member-list-row__check">
                      {form.member_ids.includes(u.id) && <span className="member-list-row__tick">✓</span>}
                    </div>
                    <Avatar name={u.name} color={u.avatar_color} size="sm" />
                    <div className="member-list-row__info">
                      <span className="member-list-row__name">{u.name}</span>
                      {u.categories && u.categories.length > 0 && (
                        <span className="member-list-row__cats">
                          {u.categories.map((c) => c.name).join(' · ')}
                        </span>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="modal-actions">
              <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
              <button type="submit" className="btn-primary">{editProject ? 'Save changes' : 'Create project'}</button>
            </div>
          </form>
        </Modal>
      )}
    </Layout>
  );
}
