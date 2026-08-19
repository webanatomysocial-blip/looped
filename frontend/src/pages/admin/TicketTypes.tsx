import { useEffect, useState } from 'react';
import Layout from '../../components/Layout/Layout';
import { xlr8Api, categoriesApi } from '../../services/api';
import { RiAddLine, RiDeleteBinLine, RiEditLine, RiArrowUpLine, RiArrowDownLine } from 'react-icons/ri';

interface Stage { category_id: number; category_name: string }
interface FinalApproval { adminRequired: boolean; adminSkippable: boolean; clientOptional: boolean }
interface TicketType {
  id: number; name: string; stages: Stage[]; final_approval: FinalApproval; created_at: string;
}
interface Category { id: number; name: string }

const DEFAULT_FA: FinalApproval = { adminRequired: true, adminSkippable: true, clientOptional: true };

export default function TicketTypes() {
  const [types, setTypes] = useState<TicketType[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [editing, setEditing] = useState<TicketType | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', stages: [] as Stage[], final_approval: { ...DEFAULT_FA } });

  const load = () => xlr8Api.getTicketTypes().then((r) => setTypes(r.data));
  useEffect(() => {
    load();
    categoriesApi.list().then((r) => setCategories(r.data));
  }, []);

  const openCreate = () => {
    const autoStages = categories.map((c) => ({ category_id: c.id, category_name: c.name }));
    setForm({ name: '', stages: autoStages, final_approval: { ...DEFAULT_FA } });
    setIsNew(true); setEditing(null);
  };

  const openEdit = (t: TicketType) => {
    setForm({ name: t.name, stages: [...t.stages], final_approval: { ...DEFAULT_FA, ...t.final_approval } });
    setEditing(t); setIsNew(false);
  };

  const close = () => { setEditing(null); setIsNew(false); };

  const addStage = () => {
    if (!categories.length) return;
    const cat = categories[0];
    setForm((f) => ({ ...f, stages: [...f.stages, { category_id: cat.id, category_name: cat.name }] }));
  };

  const removeStage = (i: number) => setForm((f) => ({ ...f, stages: f.stages.filter((_, idx) => idx !== i) }));

  const moveStage = (i: number, dir: -1 | 1) => setForm((f) => {
    const s = [...f.stages];
    const to = i + dir;
    if (to < 0 || to >= s.length) return f;
    [s[i], s[to]] = [s[to], s[i]];
    return { ...f, stages: s };
  });

  const setStageCategory = (i: number, catId: number) => {
    const cat = categories.find((c) => c.id === catId)!;
    setForm((f) => {
      const s = [...f.stages];
      s[i] = { category_id: cat.id, category_name: cat.name };
      return { ...f, stages: s };
    });
  };

  const save = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (isNew) await xlr8Api.createTicketType(form);
      else await xlr8Api.updateTicketType(editing!.id, form);
      await load(); close();
    } finally { setSaving(false); }
  };

  const del = async (id: number) => {
    if (!confirm('Delete this ticket type?')) return;
    await xlr8Api.deleteTicketType(id); load();
  };

  const showModal = isNew || !!editing;

  return (
    <Layout>
      <div className="page-wrap">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h2 className="page-title">Ticket Types</h2>
            <p className="page-subtitle">Define XLR8 ticket workflows — each type has N stages assigned to employee categories</p>
          </div>
          <button className="btn-primary" onClick={openCreate}><RiAddLine style={{ marginRight: 6 }} />New Type</button>
        </div>

        {types.length === 0 && (
          <div className="empty-state">No ticket types yet. Create one to enable the XLR8 ticket workflow.</div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {types.map((t) => (
            <div key={t.id} className="card" style={{ padding: '16px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <p style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>{t.name}</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {t.stages.map((s, i) => (
                      <span key={i} className="badge" style={{ background: 'var(--surface-2)', color: 'var(--ink)', fontSize: 11 }}>
                        {i + 1}. {s.category_name}
                      </span>
                    ))}
                    {t.stages.length === 0 && <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>No stages</span>}
                    <span className="badge" style={{ background: 'var(--surface-2)', color: 'var(--ink-muted)', fontSize: 11 }}>
                      Final: {t.final_approval?.adminRequired ? 'Admin' : 'Skip admin'}
                      {t.final_approval?.clientOptional ? ' → Client' : ''}
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-ghost" style={{ padding: '4px 10px' }} onClick={() => openEdit(t)}>
                    <RiEditLine />
                  </button>
                  <button className="btn-ghost" style={{ padding: '4px 10px', color: 'var(--red)' }} onClick={() => del(t.id)}>
                    <RiDeleteBinLine />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {showModal && (
          <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
            <div className="modal" style={{ width: '100%', maxWidth: 560, padding: '20px', backgroundColor :  'whitesmoke' }}>
              <div className="modal-header">
                <h3 className="modal-title">{isNew ? 'New Ticket Type' : 'Edit Ticket Type'}</h3>
              </div>
              <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
                <div>
                  <label className="form-label">Name</label>
                  <input className="form-input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Website Update" />
                </div>

                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <label className="form-label" style={{ marginBottom: 0 }}>Stages</label>
                    <button className="btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} onClick={addStage}>
                      <RiAddLine style={{ marginRight: 4 }} />Add Stage
                    </button>
                  </div>
                  {form.stages.length === 0 && <p style={{ fontSize: 12, color: 'var(--ink-muted)' }}>No stages — ticket goes straight to final approval. Use Add Stage to add one back.</p>}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {form.stages.map((s, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 12, color: 'var(--ink-muted)', width: 20, textAlign: 'center' }}>{i + 1}</span>
                        <select
                          className="form-input"
                          value={s.category_id}
                          onChange={(e) => setStageCategory(i, Number(e.target.value))}
                          style={{ flex: 1 }}
                        >
                          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                        <button className="btn-ghost" style={{ padding: '4px 8px' }} onClick={() => moveStage(i, -1)} disabled={i === 0}><RiArrowUpLine /></button>
                        <button className="btn-ghost" style={{ padding: '4px 8px' }} onClick={() => moveStage(i, 1)} disabled={i === form.stages.length - 1}><RiArrowDownLine /></button>
                        <button className="btn-ghost" style={{ padding: '4px 8px', color: 'var(--red)' }} onClick={() => removeStage(i)}><RiDeleteBinLine /></button>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="form-label">Final Approval</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {([
                      ['adminRequired', 'Admin approval required'],
                      ['adminSkippable', 'Manager can skip admin (send directly to client)'],
                      ['clientOptional', 'Send to client for review'],
                    ] as [keyof FinalApproval, string][]).map(([key, label]) => (
                      <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={form.final_approval[key]}
                          onChange={(e) => setForm((f) => ({ ...f, final_approval: { ...f.final_approval, [key]: e.target.checked } }))}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="modal-actions">
                <button className="btn-ghost" onClick={close}>Cancel</button>
                <button className="btn-primary" onClick={save} disabled={saving || !form.name.trim()}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
