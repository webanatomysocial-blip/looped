import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, ChevronDown, Plus, Edit2, Copy, Archive, ArchiveRestore, Trash2, BarChart3, X, Search } from 'lucide-react';
import api, { assetsApi } from '../../services/api';

type Platform = 'google' | 'meta' | 'linkedin';
type Status = 'draft' | 'active' | 'paused' | 'archived';
interface Entity {
  id: number; client_id: number; platform: Platform; level: 1 | 2 | 3; parent_id: number | null;
  name: string; status: Status; objective: string | null; budget: number | null; budget_type: string | null;
  start_date: string | null; end_date: string | null; notes: string | null; external_id: string | null; targeting: string | null;
  ad_format: string | null; headline: string | null; primary_text: string | null; cta: string | null;
  destination_url: string | null; asset_id: number | null; asset_url: string | null; updated_at: string;
}
interface Metric { id: number; entity_id: number; period_start: string | null; period_end: string | null; reach: number | null; impressions: number | null; clicks: number | null; leads: number | null; cost: number | null; cost_per_lead: number | null; source: string }

const LEVELS: Record<Platform, string[]> = {
  google: ['Campaign', 'Ad Group', 'Ad'],
  meta: ['Campaign', 'Ad Set', 'Ad'],
  linkedin: ['Campaign Group', 'Campaign', 'Ad'],
};
const TABS: { key: Platform; label: string }[] = [{ key: 'google', label: 'Google Ads' }, { key: 'meta', label: 'Meta Ads' }, { key: 'linkedin', label: 'LinkedIn Ads' }];
const STATUS_STYLE: Record<Status, { bg: string; color: string }> = {
  draft: { bg: 'rgba(148,163,184,0.18)', color: '#475569' },
  active: { bg: 'rgba(34,197,94,0.14)', color: '#15803d' },
  paused: { bg: 'rgba(245,158,11,0.14)', color: '#b45309' },
  archived: { bg: 'rgba(100,116,139,0.12)', color: '#64748b' },
};
const OBJECTIVES: Record<Platform, string[]> = {
  google: ['Sales', 'Leads', 'Website traffic', 'Brand awareness', 'App promotion', 'Local store visits'],
  meta: ['Awareness', 'Traffic', 'Engagement', 'Leads', 'App promotion', 'Sales'],
  linkedin: ['Brand awareness', 'Website visits', 'Engagement', 'Video views', 'Lead generation', 'Website conversions', 'Job applicants'],
};
const FORMATS: Record<Platform, string[]> = {
  google: ['Responsive search', 'Responsive display', 'Video', 'Performance Max asset group', 'Shopping'],
  meta: ['Single image', 'Video', 'Carousel', 'Collection', 'Stories / Reels'],
  linkedin: ['Single image', 'Video', 'Carousel', 'Document', 'Text ad', 'Message ad'],
};
const CTAS = ['Learn more', 'Sign up', 'Contact us', 'Get quote', 'Book now', 'Shop now', 'Download', 'Apply now', 'Register'];

const fmtNum = (n: number | null) => (n == null ? '—' : Number(n).toLocaleString('en-IN'));
const fmtCur = (n: number | null) => (n == null ? '—' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
const errMsg = (e: any, fallback: string) => e?.response?.data?.error || fallback;

function StatusBadge({ status }: { status: Status }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.draft;
  return <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', padding: '2px 8px', borderRadius: 99, background: s.bg, color: s.color, flexShrink: 0 }}>{status}</span>;
}

// Uploaded assets are behind auth, so fetch them as a blob for <img>/<video>
function AssetMedia({ assetId, url, style }: { assetId: number | null; url: string | null; style?: React.CSSProperties }) {
  const [src, setSrc] = useState<{ url: string; type: string } | null>(null);
  useEffect(() => {
    if (!assetId) { setSrc(url ? { url, type: /\.(mp4|webm|mov)(\?|$)/i.test(url) ? 'video' : 'image' } : null); return; }
    let obj = '';
    api.get(`/assets/${assetId}/download`, { responseType: 'blob' })
      .then(r => { obj = URL.createObjectURL(r.data); setSrc({ url: obj, type: String(r.data.type).startsWith('video') ? 'video' : 'image' }); })
      .catch(() => setSrc(null));
    return () => { if (obj) URL.revokeObjectURL(obj); };
  }, [assetId, url]);
  if (!src) return null;
  return src.type === 'video' ? <video src={src.url} controls style={style} /> : <img src={src.url} alt="" style={{ objectFit: 'cover', ...style }} />;
}

function AdPreview({ e }: { e: Partial<Entity> }) {
  const host = (() => { try { return e.destination_url ? new URL(e.destination_url).hostname : ''; } catch { return ''; } })();
  return (
    <div>
      <p style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ink-muted)', margin: '0 0 6px' }}>Internal preview · not how the platform renders it</p>
      <div style={{ border: '1px solid var(--sand-border)', borderRadius: 10, overflow: 'hidden', background: 'var(--surface, #fff)', maxWidth: 320 }}>
        {e.primary_text && <p style={{ fontSize: 12.5, padding: '10px 12px 6px', margin: 0, whiteSpace: 'pre-wrap', color: 'var(--ink)' }}>{e.primary_text}</p>}
        <AssetMedia assetId={e.asset_id ?? null} url={e.asset_url ?? null} style={{ width: '100%', maxHeight: 200, display: 'block', background: '#0001' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'rgba(148,163,184,0.08)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {host && <p style={{ fontSize: 10.5, color: 'var(--ink-muted)', margin: 0, textTransform: 'uppercase' }}>{host}</p>}
            <p style={{ fontSize: 13, fontWeight: 700, margin: 0, color: 'var(--ink)' }}>{e.headline || <span style={{ color: 'var(--ink-muted)', fontWeight: 400 }}>No headline yet</span>}</p>
          </div>
          {e.cta && <span style={{ fontSize: 11.5, fontWeight: 700, padding: '5px 10px', borderRadius: 6, background: 'rgba(148,163,184,0.25)', color: 'var(--ink)', whiteSpace: 'nowrap' }}>{e.cta}</span>}
        </div>
      </div>
    </div>
  );
}

type FormState = { mode: 'create' | 'edit'; level: 1 | 2 | 3; parent_id: number | null; data: Partial<Entity> & { targetingText?: string } };

type ReportRow = { entity_id?: number; reach: string; impressions: string; clicks: string; leads: string; cost_per_lead: string; cost: string; level_used?: number; source?: string };

export default function AdsCampaigns({ clientId, platform, onPlatformChange: setPlatform, reportRows, onChanged, canEdit, canDelete, googleLive }: {
  clientId: number; platform: Platform; onPlatformChange: (p: Platform) => void; reportRows: ReportRow[]; onChanged: () => void;
  canEdit: boolean; canDelete: boolean; googleLive: boolean;
}) {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | Status>('all');
  const [showArchived, setShowArchived] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmDel, setConfirmDel] = useState<{ e: Entity; impact: { children: Record<string, number>; metrics: number } } | null>(null);
  const [metricsFor, setMetricsFor] = useState<Entity | null>(null);
  const [mForm, setMForm] = useState({ period_start: '', period_end: '', reach: '', impressions: '', clicks: '', leads: '', cost: '' });
  const [mError, setMError] = useState('');
  const [toast, setToast] = useState('');

  const labels = LEVELS[platform];
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key !== 'Escape') return; if (confirmDel) setConfirmDel(null); else if (form) setForm(null); else if (metricsFor) setMetricsFor(null); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [confirmDel, form, metricsFor]);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2500); };

  const load = () => {
    setLoadError('');
    return api.get(`/ads/entities/${clientId}`)
      .then(r => { setEntities(r.data.entities); setMetrics(r.data.metrics); onChanged(); })
      .catch(e => setLoadError(errMsg(e, "Couldn't load campaigns")))
      .finally(() => setLoading(false));
  };
  useEffect(() => { setLoading(true); setExpanded(new Set()); load(); }, [clientId]);

  const mine = useMemo(() => entities.filter(e => e.platform === platform), [entities, platform]);
  const childrenOf = (id: number | null) => mine.filter(e => e.parent_id === id);
  const metricsOf = (id: number) => metrics.filter(m => m.entity_id === id);

  // Search matches any level; keep the ancestors so the hierarchy stays readable
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const keep = new Set<number>();
    const byId = new Map(mine.map(e => [e.id, e]));
    for (const e of mine) {
      if (q && !e.name.toLowerCase().includes(q)) continue;
      if (statusFilter !== 'all' && e.status !== statusFilter) continue;
      if (!showArchived && statusFilter !== 'archived') {
        let hidden = false;
        for (let cur: Entity | undefined = e; cur; cur = cur.parent_id ? byId.get(cur.parent_id) : undefined) if (cur.status === 'archived') hidden = true;
        if (hidden) continue;
      }
      for (let cur: Entity | undefined = e; cur; cur = cur.parent_id ? byId.get(cur.parent_id) : undefined) keep.add(cur.id);
    }
    return keep;
  }, [mine, search, statusFilter, showArchived]);
  const filtering = !!search.trim() || statusFilter !== 'all';

  const toggle = (id: number) => setExpanded(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const openCreate = (level: 1 | 2 | 3, parent_id: number | null) => {
    setFormError('');
    setForm({ mode: 'create', level, parent_id, data: { status: 'draft' } });
  };
  const openEdit = (e: Entity) => {
    setFormError('');
    let targetingText = e.targeting || '';
    try { const t = JSON.parse(targetingText); if (typeof t === 'string') targetingText = t; } catch { /* plain text */ }
    setForm({ mode: 'edit', level: e.level, parent_id: e.parent_id, data: { ...e, targetingText } });
  };
  const setField = (k: string, v: any) => setForm(f => f && { ...f, data: { ...f.data, [k]: v } });

  const save = async () => {
    if (!form) return;
    const d = form.data;
    if (!d.name?.trim()) { setFormError('Name is required'); return; }
    const payload: any = {
      name: d.name, status: d.status, notes: d.notes, external_id: d.external_id,
      objective: d.objective, budget: d.budget, budget_type: d.budget_type, start_date: d.start_date, end_date: d.end_date,
      targeting: d.targetingText, ad_format: d.ad_format, headline: d.headline, primary_text: d.primary_text, cta: d.cta,
      destination_url: d.destination_url, asset_id: d.asset_id, asset_url: d.asset_url,
    };
    setSaving(true); setFormError('');
    try {
      if (form.mode === 'create') {
        await api.post('/ads/entities', { ...payload, client_id: clientId, platform, level: form.level, parent_id: form.parent_id });
        if (form.parent_id) setExpanded(s => new Set(s).add(form.parent_id!));
      } else {
        await api.put(`/ads/entities/${d.id}`, { ...payload, ...(form.level > 1 ? { parent_id: form.parent_id } : {}) });
        if (form.parent_id) setExpanded(s => new Set(s).add(form.parent_id!));
      }
      await load();
      setForm(null);
      flash(form.mode === 'create' ? `${labels[form.level - 1]} created` : 'Saved');
    } catch (e) { setFormError(errMsg(e, "Couldn't save")); }
    finally { setSaving(false); }
  };

  const upload = async (file: File) => {
    setUploading(true); setFormError('');
    try {
      const fd = new FormData(); fd.append('file', file);
      const r = await assetsApi.upload(fd);
      setField('asset_id', r.data.id);
    } catch (e) { setFormError(errMsg(e, "Couldn't upload that file")); }
    finally { setUploading(false); }
  };

  const setStatus = async (e: Entity, status: Status) => {
    try { await api.put(`/ads/entities/${e.id}`, { status }); await load(); flash(status === 'archived' ? 'Archived' : 'Restored'); }
    catch (err) { flash(errMsg(err, "Couldn't update status")); }
  };
  const duplicate = async (e: Entity) => {
    try { await api.post(`/ads/entities/${e.id}/duplicate`); await load(); flash('Duplicated as a draft'); }
    catch (err) { flash(errMsg(err, "Couldn't duplicate")); }
  };
  const askDelete = async (e: Entity) => {
    try { const r = await api.get(`/ads/entities/${e.id}/impact`); setConfirmDel({ e, impact: r.data }); }
    catch (err) { flash(errMsg(err, "Couldn't check what would be deleted")); }
  };
  const doDelete = async () => {
    if (!confirmDel) return;
    try { await api.delete(`/ads/entities/${confirmDel.e.id}`); setConfirmDel(null); await load(); flash('Deleted'); }
    catch (err) { flash(errMsg(err, "Couldn't delete")); setConfirmDel(null); }
  };

  const addMetric = async () => {
    if (!metricsFor) return;
    setMError('');
    try {
      await api.post(`/ads/entities/${metricsFor.id}/metrics`, mForm);
      setMForm(f => ({ ...f, reach: '', impressions: '', clicks: '', leads: '', cost: '' }));
      await load();
    } catch (e) { setMError(errMsg(e, "Couldn't save metrics")); }
  };
  const delMetric = async (id: number) => {
    try { await api.delete(`/ads/metrics/${id}`); await load(); } catch (e) { setMError(errMsg(e, "Couldn't delete")); }
  };

  const iconBtn: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)', padding: 4, display: 'inline-flex', borderRadius: 6 };

  const renderRow = (e: Entity, depth: number): React.ReactNode => {
    if (!visible.has(e.id)) return null;
    const kids = childrenOf(e.id);
    const open = expanded.has(e.id) || filtering;
    const creatingHere = form?.mode === 'create' && form.parent_id === e.id;
    const m = metricsOf(e.id);
    const summary = [
      e.budget != null ? `${fmtCur(e.budget)}${e.budget_type ? ` ${e.budget_type}` : ''}` : null,
      e.start_date ? `${e.start_date}${e.end_date ? ` → ${e.end_date}` : ''}` : null,
      e.level === 3 ? e.ad_format : e.objective,
      e.external_id ? `ID ${e.external_id}` : null,
    ].filter(Boolean).join(' · ');
    return (
      <div key={e.id}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', paddingLeft: 10 + depth * 22, borderBottom: '1px solid var(--sand-border)', flexWrap: 'wrap', opacity: e.status === 'archived' ? 0.65 : 1 }}>
          {e.level < 3 ? (
            <button type="button" style={iconBtn} onClick={() => toggle(e.id)} aria-label={open ? 'Collapse' : 'Expand'} aria-expanded={open}>
              {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            </button>
          ) : (
            <span style={{ width: 23, display: 'inline-flex', justifyContent: 'center' }}>
              <AssetMedia assetId={e.asset_id} url={e.asset_url} style={{ width: 22, height: 22, borderRadius: 4 }} />
            </span>
          )}
          <div style={{ flex: '1 1 220px', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{labels[e.level - 1]}</span>
              <button type="button" onClick={() => openEdit(e)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', textAlign: 'left' }}>{e.name}</button>
              <StatusBadge status={e.status} />
              {e.level < 3 && <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{kids.length} {kids.length === 1 ? labels[e.level] : `${labels[e.level]}s`}</span>}
              {m.length > 0 && <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>· {m.length} metric {m.length === 1 ? 'entry' : 'entries'}</span>}
            </div>
            {summary && <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', marginTop: 2 }}>{summary}</div>}
            {(() => {
              const r = reportRows.find(x => x.entity_id === e.id);
              if (!r) return null;
              const bits: [string, string][] = [['Spent', r.cost ? fmtCur(Number(r.cost)) : ''], ['Leads', r.leads ? fmtNum(Number(r.leads)) : ''], ['Cost/lead', r.cost_per_lead ? fmtCur(Number(r.cost_per_lead)) : ''], ['Clicks', r.clicks ? fmtNum(Number(r.clicks)) : ''], ['Impr.', r.impressions ? fmtNum(Number(r.impressions)) : ''], ['Reach', r.reach ? fmtNum(Number(r.reach)) : '']];
              return (
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 4, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                  {bits.filter(b => b[1]).map(([k, v]) => <span key={k}><span style={{ color: 'var(--ink-muted)' }}>{k}</span> <strong style={{ color: 'var(--ink)' }}>{v}</strong></span>)}
                  {r.level_used != null && r.level_used !== e.level && <span style={{ color: 'var(--ink-muted)' }}>from its {labels[r.level_used - 1].toLowerCase()}s</span>}
                  {r.source === 'imported' && <span style={{ color: 'var(--ink-muted)' }}>no dates</span>}
                </div>
              );
            })()}
          </div>
          <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            {canEdit && e.level < 3 && e.status !== 'archived' && (
              <button type="button" className="btn-ghost" style={{ fontSize: 11.5, padding: '3px 8px' }} onClick={() => openCreate((e.level + 1) as 2 | 3, e.id)}>
                <Plus size={12} /> {labels[e.level]}
              </button>
            )}
            <button type="button" style={iconBtn} title="Metrics" aria-label="Metrics" onClick={() => { setMError(''); setMetricsFor(e); }}><BarChart3 size={14} /></button>
            {canEdit && <button type="button" style={iconBtn} title="Edit" aria-label="Edit" onClick={() => openEdit(e)}><Edit2 size={14} /></button>}
            {canEdit && <button type="button" style={iconBtn} title="Duplicate" aria-label="Duplicate" onClick={() => duplicate(e)}><Copy size={14} /></button>}
            {canEdit && (e.status === 'archived'
              ? <button type="button" style={iconBtn} title="Restore as paused" aria-label="Restore" onClick={() => setStatus(e, 'paused')}><ArchiveRestore size={14} /></button>
              : <button type="button" style={iconBtn} title="Archive" aria-label="Archive" onClick={() => setStatus(e, 'archived')}><Archive size={14} /></button>)}
            {canDelete && <button type="button" style={{ ...iconBtn, color: '#dc2626' }} title="Delete" aria-label="Delete" onClick={() => askDelete(e)}><Trash2 size={14} /></button>}
          </div>
        </div>
        {form?.mode === 'edit' && form.data.id === e.id && formPanel(depth)}
        {confirmDel?.e.id === e.id && deletePanel(depth)}
        {metricsFor?.id === e.id && metricsPanel(depth)}
        {(open || creatingHere) && e.level < 3 && (
          <>
            {creatingHere && formPanel(depth + 1)}
            {kids.map(k => renderRow(k, depth + 1))}
            {kids.length === 0 && !creatingHere && (
              <p style={{ fontSize: 12, color: 'var(--ink-muted)', margin: 0, padding: '8px 10px', paddingLeft: 10 + (depth + 1) * 22 + 31, borderBottom: '1px solid var(--sand-border)' }}>
                No {labels[e.level].toLowerCase()}s yet.
              </p>
            )}
          </>
        )}
      </div>
    );
  };

  const tops = childrenOf(null);
  const liveNote = platform === 'google'
    ? (googleLive ? 'Live Google Ads reporting is connected for this client (see Report). These campaigns are internal plans — saving here does not change anything in Google Ads.' : 'Google Ads live reporting is not configured for this client. Campaigns here are internal records; enter metrics manually.')
    : `${platform === 'meta' ? 'Meta' : 'LinkedIn'} live integration isn't connected yet. Campaigns here are internal records and are not published to ${platform === 'meta' ? 'Meta' : 'LinkedIn'}; enter metrics manually.`;

  const f = form?.data;
  const lvl = form?.level;
  const parentChoices = form && form.level > 1 ? mine.filter(e => e.level === form.level - 1 && (e.status !== 'archived' || e.id === form.parent_id)) : [];

  const panelStyle = (depth: number): React.CSSProperties => ({ margin: `8px 0 10px ${depth * 22}px`, border: '1px solid var(--sand-border)', borderRadius: 10, background: 'var(--surface, #fff)', overflow: 'hidden' });
      const formPanel = (depth: number) => form && f && lvl && (
        <div style={panelStyle(depth)}>
          <div>
            <div style={{ padding: '12px 16px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: 'var(--ink)' }}>{form.mode === 'create' ? `New ${labels[lvl - 1]}` : `Edit ${labels[lvl - 1]}`}</h3>
              <button type="button" style={iconBtn} onClick={() => setForm(null)} aria-label="Close"><X size={16} /></button>
            </div>
            <div style={{ padding: '12px 16px', display: 'grid', gridTemplateColumns: lvl === 3 ? 'repeat(auto-fit, minmax(280px, 1fr))' : '1fr', gap: 20 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div><label className="form-label">Name *</label><input className="form-input" aria-label="Name" value={f.name || ''} onChange={e => setField('name', e.target.value)} autoFocus /></div>
                {lvl > 1 && (
                  <div>
                    <label className="form-label">{labels[lvl - 2]}</label>
                    <select className="form-input" value={form.parent_id ?? ''} onChange={e => setForm({ ...form, parent_id: Number(e.target.value) })}>
                      {parentChoices.map(p => {
                        const gp = p.parent_id ? mine.find(x => x.id === p.parent_id) : null;
                        return <option key={p.id} value={p.id}>{gp ? `${gp.name} › ` : ''}{p.name}</option>;
                      })}
                    </select>
                  </div>
                )}
                <div><label className="form-label">Status</label>
                  <select className="form-input" value={f.status || 'draft'} onChange={e => setField('status', e.target.value)}>
                    {(['draft', 'active', 'paused', 'archived'] as Status[]).map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
                  </select>
                </div>
                {(lvl === 1 || (platform === 'linkedin' && lvl === 2)) && (
                  <div><label className="form-label">Objective</label>
                    <select className="form-input" value={f.objective || ''} onChange={e => setField('objective', e.target.value)}>
                      <option value="">—</option>{OBJECTIVES[platform].map(o => <option key={o}>{o}</option>)}
                    </select>
                  </div>
                )}
                {lvl < 3 && (
                  <>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <div style={{ flex: 1 }}><label className="form-label">Budget (₹)</label><input className="form-input" type="number" min="0" step="0.01" value={f.budget ?? ''} onChange={e => setField('budget', e.target.value)} /></div>
                      <div style={{ flex: 1 }}><label className="form-label">Budget type</label>
                        <select className="form-input" value={f.budget_type || ''} onChange={e => setField('budget_type', e.target.value)}>
                          <option value="">—</option><option value="daily">Daily</option><option value="lifetime">Lifetime</option>
                        </select>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <div style={{ flex: 1 }}><label className="form-label">Start date</label><input className="form-input" type="date" value={f.start_date || ''} onChange={e => setField('start_date', e.target.value)} /></div>
                      <div style={{ flex: 1 }}><label className="form-label">End date</label><input className="form-input" type="date" value={f.end_date || ''} min={f.start_date || undefined} onChange={e => setField('end_date', e.target.value)} /></div>
                    </div>
                  </>
                )}
                {lvl === 2 && (
                  <div><label className="form-label">Targeting</label>
                    <textarea className="form-input" rows={3} placeholder="Locations, audiences, keywords, placements…" value={f.targetingText || ''} onChange={e => setField('targetingText', e.target.value)} />
                  </div>
                )}
                {lvl === 3 && (
                  <>
                    <div><label className="form-label">Format</label>
                      <select className="form-input" value={f.ad_format || ''} onChange={e => setField('ad_format', e.target.value)}>
                        <option value="">—</option>{FORMATS[platform].map(o => <option key={o}>{o}</option>)}
                      </select>
                    </div>
                    <div><label className="form-label">Headline</label><input className="form-input" value={f.headline || ''} onChange={e => setField('headline', e.target.value)} /></div>
                    <div><label className="form-label">Primary text / description</label><textarea className="form-input" rows={3} value={f.primary_text || ''} onChange={e => setField('primary_text', e.target.value)} /></div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <div style={{ flex: 1 }}><label className="form-label">Call to action</label>
                        <select className="form-input" value={f.cta || ''} onChange={e => setField('cta', e.target.value)}>
                          <option value="">—</option>{CTAS.map(o => <option key={o}>{o}</option>)}
                        </select>
                      </div>
                      <div style={{ flex: 2 }}><label className="form-label">Destination URL</label><input className="form-input" type="url" placeholder="https://" value={f.destination_url || ''} onChange={e => setField('destination_url', e.target.value)} /></div>
                    </div>
                    <div>
                      <label className="form-label">Image or video</label>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <label className="btn-secondary" style={{ cursor: 'pointer' }}>
                          {uploading ? 'Uploading…' : f.asset_id ? 'Replace file' : 'Upload file'}
                          <input type="file" accept="image/*,video/*" hidden disabled={uploading} onChange={e => { const file = e.target.files?.[0]; if (file) upload(file); e.target.value = ''; }} />
                        </label>
                        {f.asset_id && <button type="button" className="btn-ghost" onClick={() => setField('asset_id', null)}>Remove file</button>}
                      </div>
                      <input className="form-input" style={{ marginTop: 6 }} type="url" placeholder="…or paste an image/video URL" value={f.asset_url || ''} onChange={e => setField('asset_url', e.target.value)} disabled={!!f.asset_id} />
                    </div>
                  </>
                )}
                <div><label className="form-label">External {platform === 'google' ? 'Google Ads' : platform === 'meta' ? 'Meta' : 'LinkedIn'} ID (optional)</label><input className="form-input" value={f.external_id || ''} onChange={e => setField('external_id', e.target.value)} /></div>
                <div><label className="form-label">Internal notes</label><textarea className="form-input" rows={2} value={f.notes || ''} onChange={e => setField('notes', e.target.value)} /></div>
              </div>
              {lvl === 3 && <AdPreview e={f} />}
            </div>
            {formError && <p role="alert" style={{ margin: '0 16px', color: '#dc2626', fontSize: 13 }}>{formError}</p>}
            <div style={{ padding: '10px 16px 14px', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn-ghost" onClick={() => setForm(null)}>Cancel</button>
              {canEdit && <button type="button" className="btn-primary" onClick={save} disabled={saving || uploading}>{saving ? 'Saving…' : form.mode === 'create' ? `Create ${labels[lvl - 1]}` : 'Save changes'}</button>}
            </div>
          </div>
        </div>
      );
      const deletePanel = (depth: number) => confirmDel && (() => {
        const lv = LEVELS[confirmDel.e.platform];
        const parts = Object.entries(confirmDel.impact.children).map(([l, n]) => `${n} ${n === 1 ? lv[Number(l) - 1] : lv[Number(l) - 1] + 's'}`);
        if (confirmDel.impact.metrics) parts.push(`${confirmDel.impact.metrics} metric ${confirmDel.impact.metrics === 1 ? 'entry' : 'entries'}`);
        return (
          <div style={{ ...panelStyle(depth), borderColor: 'rgba(220,38,38,0.4)' }}>
            <div>
              <div style={{ padding: '12px 16px 0' }}><h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: 'var(--ink)' }}>Delete “{confirmDel.e.name}”?</h3></div>
              <div style={{ padding: '10px 16px', fontSize: 13, color: 'var(--ink)', lineHeight: 1.6 }}>
                {parts.length ? <>This also permanently deletes everything inside it: <strong>{parts.join(', ')}</strong>.</> : 'Nothing else is inside it.'}
                <br />This can't be undone. To keep the history, archive it instead.
              </div>
              <div style={{ padding: '10px 16px 14px', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" className="btn-ghost" onClick={() => setConfirmDel(null)}>Cancel</button>
                {confirmDel.e.status !== 'archived' && <button type="button" className="btn-secondary" onClick={() => { setStatus(confirmDel.e, 'archived'); setConfirmDel(null); }}>Archive instead</button>}
                <button type="button" className="btn-primary" style={{ background: '#dc2626', borderColor: '#dc2626' }} onClick={doDelete}>Delete permanently</button>
              </div>
            </div>
          </div>
        );
      })();
      const metricsPanel = (depth: number) => metricsFor && (
        <div style={panelStyle(depth)}>
          <div>
            <div style={{ padding: '12px 16px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: 'var(--ink)' }}>Metrics — {metricsFor.name}</h3>
                <p style={{ fontSize: 12, color: 'var(--ink-muted)', margin: '2px 0 0' }}>Manually entered at {LEVELS[metricsFor.platform][metricsFor.level - 1]} level. The Report uses one level per campaign (its own entries first, then its ad groups/sets, then its ads), so nothing is counted twice.</p>
              </div>
              <button type="button" style={iconBtn} onClick={() => setMetricsFor(null)} aria-label="Close"><X size={16} /></button>
            </div>
            <div style={{ padding: '10px 16px 14px' }}>
              <div style={{ overflowX: 'auto' }}>
                <table className="seo-table" style={{ fontSize: 12 }}>
                  <thead><tr><th style={{ textAlign: 'left' }}>Period</th><th>Reach</th><th>Impr.</th><th>Clicks</th><th>Leads</th><th>Cost/Lead</th><th>Spent</th><th style={{ textAlign: 'left' }}>Source</th><th /></tr></thead>
                  <tbody>
                    {metricsOf(metricsFor.id).length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--ink-muted)' }}>No metrics entered yet.</td></tr>}
                    {metricsOf(metricsFor.id).map(m => (
                      <tr key={m.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>{m.period_start ? `${m.period_start} → ${m.period_end}` : 'No dates'}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(m.reach)}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(m.impressions)}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(m.clicks)}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(m.leads)}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{m.cost != null && m.leads ? fmtCur(Number(m.cost) / Number(m.leads)) : fmtCur(m.cost_per_lead)}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtCur(m.cost)}</td>
                        <td><span style={{ fontSize: 10.5, fontWeight: 700, padding: '1px 7px', borderRadius: 99, background: 'rgba(148,163,184,0.18)', color: '#475569' }}>{m.source === 'manual' ? 'Manual' : m.source === 'imported' ? 'Imported' : m.source}</span></td>
                        <td>{canEdit && <button type="button" style={{ ...iconBtn, color: '#dc2626' }} aria-label="Delete entry" onClick={() => delMetric(m.id)}><Trash2 size={13} /></button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {canEdit && (
                <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8, alignItems: 'end' }}>
                  <div><label className="form-label">From *</label><input className="form-input" type="date" value={mForm.period_start} onChange={e => setMForm({ ...mForm, period_start: e.target.value })} /></div>
                  <div><label className="form-label">To *</label><input className="form-input" type="date" value={mForm.period_end} min={mForm.period_start || undefined} onChange={e => setMForm({ ...mForm, period_end: e.target.value })} /></div>
                  {(['reach', 'impressions', 'clicks', 'leads', 'cost'] as const).map(k => (
                    <div key={k}><label className="form-label">{k === 'cost' ? 'Spent (₹)' : k[0].toUpperCase() + k.slice(1)}</label>
                      <input className="form-input" type="number" min="0" value={mForm[k]} onChange={e => setMForm({ ...mForm, [k]: e.target.value })} />
                    </div>
                  ))}
                  <button type="button" className="btn-primary" onClick={addMetric} style={{ marginBottom: 12 }}>Add entry</button>
                </div>
              )}
              {mError && <p role="alert" style={{ color: '#dc2626', fontSize: 13, margin: '4px 0 0' }}>{mError}</p>}
            </div>
          </div>
        </div>
      );

  return (
    <div className="seo-section">
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }} role="tablist">
        {TABS.map(t => {
          const n = entities.filter(e => e.platform === t.key && e.level === 1 && e.status !== 'archived').length;
          return (
            <button key={t.key} type="button" role="tab" aria-selected={platform === t.key} className={`seo-client-btn${platform === t.key ? ' active' : ''}`} onClick={() => setPlatform(t.key)}>
              {t.label}{n > 0 ? ` (${n})` : ''}
            </button>
          );
        })}
      </div>

      <p style={{ fontSize: 12, color: 'var(--ink-muted)', background: 'rgba(148,163,184,0.1)', borderRadius: 8, padding: '8px 12px', margin: '0 0 12px' }}>
        {labels.join(' → ')} · {liveNote}
      </p>

      {reportRows.length > 0 && (() => {
        const t = reportRows.reduce((a, r) => ({ cost: a.cost + (Number(r.cost) || 0), leads: a.leads + (Number(r.leads) || 0), clicks: a.clicks + (Number(r.clicks) || 0), impressions: a.impressions + (Number(r.impressions) || 0), reach: a.reach + (Number(r.reach) || 0) }), { cost: 0, leads: 0, clicks: 0, impressions: 0, reach: 0 });
        return (
          <div className="seo-cards" style={{ marginBottom: 12 }}>
            {[['Spent', t.cost ? fmtCur(t.cost) : '—'], ['Leads', t.leads ? fmtNum(t.leads) : '—'], ['Cost / lead', t.cost && t.leads ? fmtCur(t.cost / t.leads) : '—'], ['Clicks', t.clicks ? fmtNum(t.clicks) : '—'], ['Impressions', t.impressions ? fmtNum(t.impressions) : '—'], ['Reach', t.reach ? fmtNum(t.reach) : '—']].map(([l, v]) => (
              <div key={l} className="seo-card"><div><p className="seo-card__val">{v}</p><p className="seo-card__label">{l}</p></div></div>
            ))}
          </div>
        );
      })()}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ position: 'relative', flex: '1 1 200px' }}>
          <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-muted)' }} />
          <input className="form-input" style={{ marginBottom: 0, paddingLeft: 30 }} placeholder="Search by name" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search campaigns" />
        </div>
        <select className="form-input" style={{ marginBottom: 0, width: 'auto' }} value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} aria-label="Filter by status">
          <option value="all">All statuses</option>
          {(['draft', 'active', 'paused', 'archived'] as Status[]).map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
        </select>
        <label style={{ fontSize: 12, color: 'var(--ink-muted)', display: 'flex', gap: 5, alignItems: 'center' }}>
          <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} /> Show archived
        </label>
        {canEdit && <button type="button" className="btn-primary" onClick={() => openCreate(1, null)}><Plus size={13} /> New {labels[0]}</button>}
      </div>

      {loading && <p style={{ fontSize: 13, color: 'var(--ink-muted)' }}>Loading campaigns…</p>}
      {!loading && loadError && <p role="alert" style={{ fontSize: 13, color: '#dc2626' }}>{loadError} <button type="button" className="btn-ghost" onClick={load}>Retry</button></p>}
      {!loading && !loadError && tops.length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--ink-muted)', textAlign: 'center', padding: '24px 0' }}>
          No {labels[0].toLowerCase()}s for {TABS.find(t => t.key === platform)!.label} yet.{canEdit ? ` Create one to start planning ${labels[1].toLowerCase()}s and ads.` : ''}
        </p>
      )}
      {!loading && !loadError && tops.length > 0 && visible.size === 0 && (
        <p style={{ fontSize: 13, color: 'var(--ink-muted)', textAlign: 'center', padding: '24px 0' }}>Nothing matches these filters.</p>
      )}
      {form?.mode === 'create' && form.level === 1 && formPanel(0)}
      {!loading && !loadError && <div style={{ borderTop: visible.size ? '1px solid var(--sand-border)' : 'none' }}>{tops.map(e => renderRow(e, 0))}</div>}

      {toast && <div role="status" style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#1e293b', color: '#fff', padding: '8px 16px', borderRadius: 8, fontSize: 13, zIndex: 1100 }}>{toast}</div>}

    </div>
  );
}
