import { useEffect, useState } from 'react';
import Layout from '../../components/Layout/Layout';
import { xlr8Api, categoriesApi } from '../../services/api';
import { RiAddLine, RiDeleteBinLine, RiEditLine, RiArrowUpLine, RiArrowDownLine, RiArrowLeftLine } from 'react-icons/ri';

interface Stage { category_id: number; category_name: string }
interface FinalApproval { adminRequired: boolean; adminSkippable: boolean; clientOptional: boolean }
interface TicketType {
  id: number; name: string; stages: Stage[]; final_approval: FinalApproval; created_at: string;
}
interface Category { id: number; name: string }

const DEFAULT_FA: FinalApproval = { adminRequired: true, adminSkippable: true, clientOptional: true };

// Template definitions — stage names matched to category names at runtime
const TEMPLATES: { name: string; stages: string[]; icon: string }[] = [
  { name: 'SSM Post',              stages: ['Designer', 'Social Media Manager'],        icon: '📱' },
  { name: 'Blog Post',             stages: ['Social Media Manager', 'SEO Specialist'],  icon: '✍️' },
  { name: 'New Website',           stages: ['UI/UX Designer', 'Web Developer'],         icon: '🌐' },
  { name: 'Website Update',        stages: ['Web Developer'],                            icon: '🔧' },
  { name: 'Landing Page Design',   stages: ['UI/UX Designer', 'Web Developer'],         icon: '🖥️' },
  { name: 'Logo Design',           stages: ['Designer'],                                 icon: '🎨' },
  { name: 'Brand Identity',        stages: ['UI/UX Designer'],                          icon: '💎' },
  { name: 'Ad Creative',           stages: ['UI/UX Designer', 'Ads Specialist'],        icon: '📢' },
  { name: 'Google Ads Campaign',   stages: ['Ads Specialist'],                          icon: '🔍' },
  { name: 'Meta Ads Campaign',     stages: ['Ads Specialist'],                          icon: '📘' },
  { name: 'SEO Audit',             stages: ['SEO Specialist'],                          icon: '📊' },
  { name: 'SEO Report',            stages: ['SEO Specialist'],                          icon: '📈' },
  { name: 'Email Campaign Design', stages: ['UI/UX Designer', 'Social Media Manager'], icon: '📧' },
  { name: 'Lead Generation',       stages: ['Ads Specialist', 'Sales Executive'],       icon: '🎯' },
];

export default function TicketTypes() {
  const [types, setTypes] = useState<TicketType[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [editing, setEditing] = useState<TicketType | null>(null);
  const [view, setView] = useState<'list' | 'pick' | 'form'>('list');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', stages: [] as Stage[], final_approval: { ...DEFAULT_FA } });

  const load = () => xlr8Api.getTicketTypes().then((r) => setTypes(r.data));
  useEffect(() => {
    load();
    categoriesApi.list().then((r) => setCategories(r.data));
  }, []);

  function resolveStages(names: string[]): Stage[] {
    return names
      .map(name => categories.find(c => c.name === name))
      .filter(Boolean)
      .map(c => ({ category_id: c!.id, category_name: c!.name }));
  }

  function pickTemplate(tpl: typeof TEMPLATES[0]) {
    setForm({ name: tpl.name, stages: resolveStages(tpl.stages), final_approval: { ...DEFAULT_FA } });
    setEditing(null);
    setView('form');
  }

  function openCreate() { setView('pick'); }

  function openEdit(t: TicketType) {
    setForm({ name: t.name, stages: [...t.stages], final_approval: { ...DEFAULT_FA, ...t.final_approval } });
    setEditing(t);
    setView('form');
  }

  function close() { setEditing(null); setView('list'); }

  const addStage = () => {
    const unused = categories.find(c => !form.stages.find(s => s.category_id === c.id));
    const cat = unused || categories[0];
    if (!cat) return;
    setForm(f => ({ ...f, stages: [...f.stages, { category_id: cat.id, category_name: cat.name }] }));
  };

  const removeStage = (i: number) => setForm(f => ({ ...f, stages: f.stages.filter((_, idx) => idx !== i) }));

  const moveStage = (i: number, dir: -1 | 1) => setForm(f => {
    const s = [...f.stages];
    const to = i + dir;
    if (to < 0 || to >= s.length) return f;
    [s[i], s[to]] = [s[to], s[i]];
    return { ...f, stages: s };
  });

  const setStageCategory = (i: number, catId: number) => {
    const cat = categories.find(c => c.id === catId)!;
    setForm(f => { const s = [...f.stages]; s[i] = { category_id: cat.id, category_name: cat.name }; return { ...f, stages: s }; });
  };

  const save = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editing) await xlr8Api.updateTicketType(editing.id, form);
      else await xlr8Api.createTicketType(form);
      await load(); close();
    } finally { setSaving(false); }
  };

  const del = async (id: number) => {
    if (!confirm('Delete this ticket type?')) return;
    await xlr8Api.deleteTicketType(id); load();
  };

  // ── Template picker ───────────────────────────────────────────────────────
  if (view === 'pick') {
    return (
      <Layout>
        <div className="page-wrap">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <button className="btn-ghost" style={{ padding: '6px 10px' }} onClick={() => setView('list')}>
              <RiArrowLeftLine />
            </button>
            <div>
              <h2 className="page-title">Choose a Template</h2>
              <p className="page-subtitle">Select a task type — stages are set automatically. You can adjust them before saving.</p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12, marginBottom: 24 }}>
            {TEMPLATES.map(tpl => {
              const stages = resolveStages(tpl.stages);
              return (
                <div
                  key={tpl.name}
                  onClick={() => pickTemplate(tpl)}
                  style={{ border: '1.5px solid var(--sand-border)', borderRadius: 12, padding: '16px', cursor: 'pointer', background: 'var(--surface)', transition: 'border-color 0.15s, box-shadow 0.15s' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--blue, #2563eb)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 3px rgba(37,99,235,0.08)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--sand-border)'; (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}
                >
                  <div style={{ fontSize: 28, marginBottom: 8 }}>{tpl.icon}</div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)', marginBottom: 8 }}>{tpl.name}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {stages.map((s, i) => (
                      <span key={i} style={{ background: 'var(--surface-raised, #f4f4f4)', borderRadius: 4, padding: '2px 7px', fontSize: 11, fontWeight: 600, color: 'var(--ink-muted)' }}>
                        {i + 1}. {s.category_name}
                      </span>
                    ))}
                    {stages.length === 0 && tpl.stages.map((s, i) => (
                      <span key={i} style={{ background: 'var(--surface-raised, #f4f4f4)', borderRadius: 4, padding: '2px 7px', fontSize: 11, fontWeight: 600, color: 'var(--ink-muted)' }}>
                        {i + 1}. {s}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <button className="btn-ghost" style={{ fontSize: 13 }} onClick={() => {
            setForm({ name: '', stages: [], final_approval: { ...DEFAULT_FA } });
            setEditing(null);
            setView('form');
          }}>
            + Custom (start blank)
          </button>
        </div>
      </Layout>
    );
  }

  // ── Edit form ─────────────────────────────────────────────────────────────
  if (view === 'form') {
    return (
      <Layout>
        <div className="page-wrap" style={{ maxWidth: 560 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <button className="btn-ghost" style={{ padding: '6px 10px' }} onClick={close}><RiArrowLeftLine /></button>
            <h2 className="page-title">{editing ? 'Edit Ticket Type' : 'New Ticket Type'}</h2>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <label className="form-label">Name</label>
              <input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. SSM Post" autoFocus />
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <label className="form-label" style={{ marginBottom: 0 }}>Stages</label>
                <button className="btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} onClick={addStage}>
                  <RiAddLine style={{ marginRight: 4 }} />Add Stage
                </button>
              </div>
              {form.stages.length === 0 && <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginBottom: 8 }}>No stages — ticket goes straight to final approval.</p>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {form.stages.map((s, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--surface-raised, #f8f8f8)', borderRadius: 8, border: '1px solid var(--sand-border)' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', width: 20, textAlign: 'center', flexShrink: 0 }}>{i + 1}</span>
                    <select
                      className="form-input"
                      value={s.category_id}
                      onChange={e => setStageCategory(i, Number(e.target.value))}
                      style={{ flex: 1, marginBottom: 0 }}
                    >
                      {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
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
                      onChange={e => setForm(f => ({ ...f, final_approval: { ...f.final_approval, [key]: e.target.checked } }))}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 8, borderTop: '1px solid var(--sand-border)' }}>
              <button className="btn-ghost" onClick={close}>Cancel</button>
              <button className="btn-primary" onClick={save} disabled={saving || !form.name.trim()}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  // ── List ──────────────────────────────────────────────────────────────────
  return (
    <Layout>
      <div className="page-wrap">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h2 className="page-title">Ticket Types</h2>
            <p className="page-subtitle">XLR8 ticket workflows — click a type to edit its stages</p>
          </div>
          <button className="btn-primary" onClick={openCreate}><RiAddLine style={{ marginRight: 6 }} />New Type</button>
        </div>

        {types.length === 0 && (
          <div className="empty-state">No ticket types yet. Click "New Type" to get started.</div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {types.map(t => (
            <div key={t.id} className="card" style={{ padding: '16px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>{t.name}</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                    {t.stages.map((s, i) => (
                      <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span className="badge" style={{ background: 'var(--surface-2)', color: 'var(--ink)', fontSize: 11 }}>
                          {i + 1}. {s.category_name}
                        </span>
                        {i < t.stages.length - 1 && <span style={{ color: 'var(--ink-muted)', fontSize: 12 }}>→</span>}
                      </span>
                    ))}
                    {t.stages.length === 0 && <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>No stages</span>}
                    <span style={{ color: 'var(--ink-muted)', fontSize: 12 }}>→</span>
                    <span className="badge" style={{ background: 'var(--surface-2)', color: 'var(--ink-muted)', fontSize: 11 }}>
                      {t.final_approval?.adminRequired ? 'Admin' : ''}
                      {t.final_approval?.clientOptional ? ' → Client' : ''}
                      {!t.final_approval?.adminRequired && !t.final_approval?.clientOptional ? 'Done' : ''}
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button className="btn-ghost" style={{ padding: '4px 10px' }} onClick={() => openEdit(t)}><RiEditLine /></button>
                  <button className="btn-ghost" style={{ padding: '4px 10px', color: 'var(--red)' }} onClick={() => del(t.id)}><RiDeleteBinLine /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Layout>
  );
}
