import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { UserPlus, Edit2, Trash2, Shield, Plus, X, Tag } from 'lucide-react';
import Layout from '../../components/Layout/Layout';
import Header from '../../components/Layout/Header';
import Avatar from '../../components/UI/Avatar';
import Modal from '../../components/UI/Modal';
import { usersApi, categoriesApi } from '../../services/api';
import { User, Role, EmployeeCategory } from '../../types';
import '../../css/admin/UserManagement.css';

const ROLE_OPTIONS: Role[] = ['admin', 'manager', 'employee', 'client'];
const defaultForm = { name: '', email: '', password: '', role: 'employee' as Role, company_name: '', category_ids: [] as number[] };

export default function UserManagement() {
  const [users, setUsers]         = useState<User[]>([]);
  const [categories, setCategories] = useState<EmployeeCategory[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser]   = useState<User | null>(null);
  const [form, setForm]           = useState(defaultForm);
  const [error, setError]         = useState('');
  const [filterRole, setFilterRole] = useState<string>('all');
  // Category management panel
  const [showCatPanel, setShowCatPanel] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [catError, setCatError] = useState('');

  const load = () => {
    usersApi.list().then((r) => setUsers(r.data)).finally(() => setLoading(false));
  };
  const loadCats = () => { categoriesApi.list().then((r) => setCategories(r.data)); };

  useEffect(() => { load(); loadCats(); }, []);

  const openCreate = () => {
    setEditUser(null);
    setForm(defaultForm);
    setError('');
    setShowModal(true);
  };
  const openEdit = (u: User) => {
    setEditUser(u);
    setForm({
      name: u.name, email: u.email, password: '', role: u.role,
      company_name: (u as any).company_name || '',
      category_ids: u.categories?.map((c) => c.id) || [],
    });
    setError('');
    setShowModal(true);
  };

  const toggleCategory = (id: number) =>
    setForm((f) => ({
      ...f,
      category_ids: f.category_ids.includes(id)
        ? f.category_ids.filter((x) => x !== id)
        : [...f.category_ids, id],
    }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (editUser) {
        const payload: any = { name: form.name, email: form.email, role: form.role };
        if (form.password) payload.password = form.password;
        if (form.role === 'employee') payload.category_ids = form.category_ids;
        if (form.role === 'client' && form.company_name) payload.company_name = form.company_name;
        await usersApi.update(editUser.id, payload);
      } else {
        if (!form.password) { setError('Password is required'); return; }
        const payload: any = { name: form.name, email: form.email, password: form.password, role: form.role, company_name: form.company_name };
        if (form.role === 'employee') payload.category_ids = form.category_ids;
        await usersApi.create(payload);
      }
      setShowModal(false);
      load();
    } catch (err: any) { setError(err.response?.data?.error || 'Error'); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this user? This cannot be undone.')) return;
    try { await usersApi.delete(id); load(); }
    catch (err: any) { alert(err.response?.data?.error || 'Error'); }
  };

  const addCategory = async () => {
    if (!newCatName.trim()) return;
    setCatError('');
    try {
      await categoriesApi.create(newCatName.trim());
      setNewCatName('');
      loadCats();
    } catch (err: any) { setCatError(err.response?.data?.error || 'Error'); }
  };

  const deleteCategory = async (id: number) => {
    if (!confirm('Delete this category?')) return;
    await categoriesApi.delete(id);
    loadCats();
  };

  const filtered = filterRole === 'all' ? users : users.filter((u) => u.role === filterRole);

  return (
    <Layout>
      <div className="page-wrap">
        <Header action={{ label: 'New user', onClick: openCreate }} />

        <div className="users-top">
          <div>
            <h2 className="page-title">Users</h2>
            <p className="page-subtitle">{filtered.length} member{filtered.length !== 1 ? 's' : ''}</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div className="filter-bar">
              {['all', ...ROLE_OPTIONS].map((r) => (
                <button key={r} onClick={() => setFilterRole(r)} className={`filter-tab${filterRole === r ? ' active' : ''}`}>
                  {r === 'all' ? 'All' : r}
                </button>
              ))}
            </div>
            <button className="cat-manage-btn" onClick={() => setShowCatPanel(!showCatPanel)} title="Manage categories">
              <Tag size={14} /> Categories
            </button>
          </div>
        </div>

        {/* Category management panel */}
        {showCatPanel && (
          <div className="cat-panel">
            <div className="cat-panel__header">
              <p className="cat-panel__title">Employee Categories</p>
              <button className="cat-panel__close" onClick={() => setShowCatPanel(false)}><X size={14} /></button>
            </div>
            {catError && <p style={{ color: 'var(--red)', fontSize: 12, marginBottom: 6 }}>{catError}</p>}
            <div className="cat-add-row">
              <input
                className="form-input"
                style={{ flex: 1 }}
                placeholder="New category name…"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addCategory()}
              />
              <button className="btn-primary" style={{ padding: '8px 14px' }} onClick={addCategory}>
                <Plus size={13} /> Add
              </button>
            </div>
            <div className="cat-list">
              {categories.map((cat) => (
                <div key={cat.id} className="cat-row">
                  <span className="cat-row__name">{cat.name}</span>
                  <button className="icon-action danger" onClick={() => deleteCategory(cat.id)}><Trash2 size={11} /></button>
                </div>
              ))}
              {!categories.length && <p style={{ fontSize: 12, color: 'var(--ink-muted)', textAlign: 'center', padding: '12px 0' }}>No categories yet</p>}
            </div>
          </div>
        )}

        {loading && <p className="page-subtitle">Loading…</p>}

        <div className="users-grid">
          {filtered.map((u) => (
            <div key={u.id} className="user-card">
              <div className="user-card__top">
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flex: 1, minWidth: 0 }}>
                  <Avatar name={u.name} color={u.avatar_color} size="lg" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p className="user-card__name">{u.name}</p>
                    <p className="user-card__email">{u.email}</p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                      <span className={`user-role-pill user-role-pill--${u.role}`}>
                        {u.role === 'admin' && <Shield size={10} />}
                        {u.role}
                      </span>
                      {(u as any).created_at && (
                        <span style={{ fontSize: 11, color: 'var(--sand-border)' }}>{format(new Date((u as any).created_at), 'MMM d, yyyy')}</span>
                      )}
                    </div>
                    {u.categories && u.categories.length > 0 && (
                      <div className="user-card__cats">
                        {u.categories.map((cat) => (
                          <span key={cat.id} className="user-cat-tag">{cat.name}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="user-card__actions">
                  <button className="icon-action" onClick={() => openEdit(u)} title="Edit"><Edit2 size={12} /></button>
                  <button className="icon-action danger" onClick={() => handleDelete(u.id)} title="Delete"><Trash2 size={12} /></button>
                </div>
              </div>
            </div>
          ))}

          <button className="project-add-card" style={{ minHeight: 100 }} onClick={openCreate}>
            <div className="project-add-card__icon"><UserPlus size={16} /></div>
            <span>Add user</span>
          </button>
        </div>
      </div>

      {showModal && (
        <Modal title={editUser ? `Edit ${editUser.name}` : 'Create new user'} onClose={() => setShowModal(false)}>
          <form onSubmit={handleSubmit}>
            {error && <div className="modal-error">{error}</div>}
            <div className="modal-form-row">
              <label className="form-label">Full name *</label>
              <input className="form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div className="modal-form-row">
              <label className="form-label">Email *</label>
              <input type="email" className="form-input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </div>
            <div className="modal-form-row">
              <label className="form-label">{editUser ? 'New password (leave blank to keep)' : 'Password *'}</label>
              <input
                type="password"
                className="form-input"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required={!editUser}
                placeholder={editUser ? 'Leave blank to keep unchanged' : ''}
              />
            </div>
            <div className="modal-form-row">
              <label className="form-label">Role *</label>
              <div className="user-form-role-row">
                {ROLE_OPTIONS.map((r) => (
                  <button
                    key={r} type="button"
                    onClick={() => setForm({ ...form, role: r })}
                    className={`role-btn role-btn--${r}${form.role === r ? ' role-btn--selected' : ''}`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            {form.role === 'client' && (
              <div className="modal-form-row">
                <label className="form-label">Company name</label>
                <input className="form-input" placeholder="Client company" value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} />
              </div>
            )}
            {/* Employee categories */}
            {form.role === 'employee' && (
              <div className="modal-form-row">
                <label className="form-label">Specializations</label>
                <div className="cat-checkbox-grid">
                  {categories.map((cat) => (
                    <label key={cat.id} className={`cat-checkbox-item${form.category_ids.includes(cat.id) ? ' selected' : ''}`}>
                      <input
                        type="checkbox"
                        checked={form.category_ids.includes(cat.id)}
                        onChange={() => toggleCategory(cat.id)}
                        style={{ display: 'none' }}
                      />
                      {cat.name}
                    </label>
                  ))}
                  {!categories.length && <p style={{ fontSize: 12, color: 'var(--ink-muted)' }}>No categories defined yet.</p>}
                </div>
              </div>
            )}
            <div className="modal-info">
              <strong>Admin</strong> — full access, create users<br />
              <strong>Manager</strong> — projects, tasks, approve step 1<br />
              <strong>Employee</strong> — assigned tasks, submit for approval<br />
              <strong>Client</strong> — view projects, review completed work
            </div>
            <div className="modal-actions">
              <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
              <button type="submit" className="btn-primary">{editUser ? 'Save changes' : 'Create user'}</button>
            </div>
          </form>
        </Modal>
      )}
    </Layout>
  );
}
