import { useEffect, useState } from 'react';
import { Megaphone, Edit2, Plus, Trash2, Settings, X } from 'lucide-react';
import Layout from '../components/Layout/Layout';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';

interface AdsClient {
  id: number;
  name: string;
  ads_customer_id: string | null;
}

interface ManualCampaign {
  name: string;
  reach: string;
  impressions: string;
  clicks: string;
  leads: string;
  cost: string;
}

interface CampaignGroup {
  campaigns: ManualCampaign[];
  key_insights: string;
}

interface AdsManualData {
  notes: string;
  google: CampaignGroup;
  linkedin: CampaignGroup;
  meta: CampaignGroup;
}

type GroupKey = 'google' | 'linkedin' | 'meta';

const GROUPS: { key: GroupKey; label: string; badge: string }[] = [
  { key: 'google',   label: 'Google',   badge: 'Google Ads' },
  { key: 'linkedin', label: 'LinkedIn', badge: 'LinkedIn Ads' },
  { key: 'meta',     label: 'Meta',     badge: 'Meta Ads' },
];

const emptyGroup = (): CampaignGroup => ({ campaigns: [], key_insights: '' });
const emptyManual = (): AdsManualData => ({ notes: '', google: emptyGroup(), linkedin: emptyGroup(), meta: emptyGroup() });
const emptyCampaign = (): ManualCampaign => ({ name: '', reach: '', impressions: '', clicks: '', leads: '', cost: '' });

const parseManualData = (raw: any): AdsManualData => {
  const base = emptyManual();
  if (!raw) return base;
  base.notes = raw.notes || '';
  const cm = raw.campaigns_manual;
  if (cm && typeof cm === 'object' && !Array.isArray(cm)) {
    if (cm.google)   base.google   = { ...emptyGroup(), ...cm.google };
    if (cm.linkedin) base.linkedin = { ...emptyGroup(), ...cm.linkedin };
    if (cm.meta)     base.meta     = { ...emptyGroup(), ...cm.meta };
  }
  return base;
};

const calcGroupTotals = (g: CampaignGroup) =>
  g.campaigns.reduce(
    (acc, c) => ({
      reach:       acc.reach       + (Number(c.reach)       || 0),
      impressions: acc.impressions + (Number(c.impressions) || 0),
      clicks:      acc.clicks      + (Number(c.clicks)      || 0),
      leads:       acc.leads       + (Number(c.leads)       || 0),
      cost:        acc.cost        + (Number(c.cost)        || 0),
    }),
    { reach: 0, impressions: 0, clicks: 0, leads: 0, cost: 0 },
  );

// Total Cost/Lead = avg of individual per-campaign CPLs
const calcGroupAvgCpl = (g: CampaignGroup): number | null => {
  const cpls = g.campaigns
    .map((c) => { const l = Number(c.leads); const cost = Number(c.cost); return l > 0 ? cost / l : null; })
    .filter((v): v is number => v !== null);
  return cpls.length > 0 ? cpls.reduce((a, b) => a + b, 0) / cpls.length : null;
};

const fmtNum  = (n: number) => n > 0 ? n.toLocaleString('en-IN') : '—';
const fmtCur  = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function Ads() {
  const { user } = useAuth();
  const canEdit = ['admin', 'manager', 'employee'].includes(user?.role ?? '');

  const [clients,        setClients]        = useState<AdsClient[]>([]);
  const [selectedClient, setSelectedClient] = useState<AdsClient | null>(null);
  const [editingClientId, setEditingClientId] = useState<number | null>(null);
  const [cfCustomerId,   setCfCustomerId]   = useState('');
  const [cfSaving,       setCfSaving]       = useState(false);

  const [customStart, setCustomStart] = useState('');
  const [customEnd,   setCustomEnd]   = useState('');

  const [manual,       setManual]       = useState<AdsManualData>(emptyManual());
  const [manualEdit,   setManualEdit]   = useState<AdsManualData>(emptyManual());
  const [editingGroup, setEditingGroup] = useState<GroupKey | null>(null);
  const [saving,       setSaving]       = useState(false);

  useEffect(() => {
    api.get('/ads/clients').then((r) => {
      setClients(r.data);
      if (r.data[0]) setSelectedClient(r.data[0]);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedClient) return;
    api.get(`/ads/manual/${selectedClient.id}`)
      .then((r) => setManual(parseManualData(r.data)))
      .catch(() => setManual(emptyManual()));
  }, [selectedClient]);

  const openGroupEdit = (key: GroupKey) => {
    setManualEdit({ ...manual, [key]: { ...manual[key], campaigns: manual[key].campaigns.map((c) => ({ ...c })) } });
    setEditingGroup(key);
  };

  const saveGroup = async () => {
    if (!selectedClient) return;
    setSaving(true);
    try {
      const updated = { ...manual, [editingGroup!]: manualEdit[editingGroup!] };
      await api.put(`/ads/manual/${selectedClient.id}`, {
        notes: updated.notes,
        campaigns_manual: { google: updated.google, linkedin: updated.linkedin, meta: updated.meta },
      });
      setManual(updated);
      setEditingGroup(null);
    } catch { alert('Failed to save'); }
    finally { setSaving(false); }
  };

  const saveClientConfig = async () => {
    if (!editingClientId) return;
    setCfSaving(true);
    try {
      await api.put(`/ads/clients/${editingClientId}`, { ads_customer_id: cfCustomerId });
      setClients((cs) => cs.map((c) => c.id === editingClientId ? { ...c, ads_customer_id: cfCustomerId || null } : c));
      if (selectedClient?.id === editingClientId) setSelectedClient((sc) => sc ? { ...sc, ads_customer_id: cfCustomerId || null } : sc);
      setEditingClientId(null);
    } catch { alert('Failed to save'); }
    finally { setCfSaving(false); }
  };

  const updGroup = (key: GroupKey, patch: Partial<CampaignGroup>) =>
    setManualEdit((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));

  const updCampaign = (key: GroupKey, i: number, patch: Partial<ManualCampaign>) =>
    setManualEdit((prev) => {
      const arr = [...prev[key].campaigns];
      arr[i] = { ...arr[i], ...patch };
      return { ...prev, [key]: { ...prev[key], campaigns: arr } };
    });

  const addCampaign = (key: GroupKey) =>
    setManualEdit((prev) => ({ ...prev, [key]: { ...prev[key], campaigns: [...prev[key].campaigns, emptyCampaign()] } }));

  const removeCampaign = (key: GroupKey, i: number) =>
    setManualEdit((prev) => ({ ...prev, [key]: { ...prev[key], campaigns: prev[key].campaigns.filter((_, j) => j !== i) } }));

  // Overall totals across all groups
  const allGroups = GROUPS.map(({ key }) => manual[key]);
  const overallTotals = allGroups.map(calcGroupTotals).reduce(
    (acc, t) => ({ reach: acc.reach + t.reach, impressions: acc.impressions + t.impressions, clicks: acc.clicks + t.clicks, leads: acc.leads + t.leads, cost: acc.cost + t.cost }),
    { reach: 0, impressions: 0, clicks: 0, leads: 0, cost: 0 },
  );
  const allCampaigns = allGroups.flatMap((g) => g.campaigns);
  const overallCpl = calcGroupAvgCpl({ campaigns: allCampaigns, key_insights: '' });
  const hasSomeData = allCampaigns.length > 0;

  const renderGroupSection = ({ key, label, badge }: typeof GROUPS[number]) => {
    const group      = manual[key];
    const editGroup  = manualEdit[key];
    const isEditing  = editingGroup === key;
    const totals     = calcGroupTotals(group);
    const avgCpl     = calcGroupAvgCpl(group);
    const hasData    = group.campaigns.length > 0;

    const cplColor = (cpl: number | null) => {
      if (cpl === null || avgCpl === null) return 'var(--ink-muted)';
      if (cpl < avgCpl)  return '#16a34a';
      if (cpl > avgCpl)  return '#d97706';
      return 'var(--ink)';
    };

    return (
      <div key={key} className="seo-section">
        <h3 className="seo-section__title">
          Campaigns <span className="seo-badge">{badge}</span>
          {canEdit && (
            <button className="seo-manual-edit-btn" onClick={() => isEditing ? setEditingGroup(null) : openGroupEdit(key)}>
              <Edit2 size={11} /> {isEditing ? 'Cancel' : 'Edit'}
            </button>
          )}
        </h3>

        {isEditing && canEdit && (
          <div className="seo-manual-panel">
            <div style={{ display: 'flex', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', marginBottom: 6, padding: '0 2px' }}>
              <span style={{ flex: 2 }}>Campaign Name</span>
              <span style={{ width: 82 }}>Reach</span>
              <span style={{ width: 90 }}>Impressions</span>
              <span style={{ width: 70 }}>Clicks</span>
              <span style={{ width: 65 }}>Leads</span>
              <span style={{ width: 100 }}>Amount Spent (₹)</span>
              <span style={{ width: 80 }}>Cost/Lead</span>
              <span style={{ width: 26 }} />
            </div>
            {editGroup.campaigns.map((c, i) => {
              const leads = Number(c.leads) || 0;
              const cost  = Number(c.cost)  || 0;
              const cpl   = leads > 0 ? `₹${(cost / leads).toFixed(2)}` : '—';
              return (
                <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                  <input className="form-input seo-inline-input" placeholder="Campaign name" value={c.name}        onChange={(e) => updCampaign(key, i, { name: e.target.value })}        style={{ flex: 2 }} />
                  <input className="form-input seo-inline-input" placeholder="0" type="number" value={c.reach}       onChange={(e) => updCampaign(key, i, { reach: e.target.value })}       style={{ width: 82 }} />
                  <input className="form-input seo-inline-input" placeholder="0" type="number" value={c.impressions} onChange={(e) => updCampaign(key, i, { impressions: e.target.value })} style={{ width: 90 }} />
                  <input className="form-input seo-inline-input" placeholder="0" type="number" value={c.clicks}      onChange={(e) => updCampaign(key, i, { clicks: e.target.value })}      style={{ width: 70 }} />
                  <input className="form-input seo-inline-input" placeholder="0" type="number" value={c.leads}       onChange={(e) => updCampaign(key, i, { leads: e.target.value })}       style={{ width: 65 }} />
                  <input className="form-input seo-inline-input" placeholder="0.00" type="number" value={c.cost}     onChange={(e) => updCampaign(key, i, { cost: e.target.value })}        style={{ width: 100 }} />
                  <span style={{ width: 80, fontSize: 12, color: 'var(--ink-muted)', textAlign: 'right' }}>{cpl}</span>
                  <button className="seo-manual-del" onClick={() => removeCampaign(key, i)}><Trash2 size={13} /></button>
                </div>
              );
            })}

            <div className="seo-manual-actions" style={{ justifyContent: 'flex-start', marginBottom: 14 }}>
              <button className="seo-manual-add" onClick={() => addCampaign(key)}>
                <Plus size={12} /> Add campaign
              </button>
            </div>

            <div className="seo-inline-field" style={{ marginBottom: 16 }}>
              <label className="seo-inline-label">Key Insights</label>
              <textarea
                className="form-input seo-inline-input"
                rows={3}
                style={{ width: '100%' }}
                placeholder="Key insights for this channel…"
                value={editGroup.key_insights}
                onChange={(e) => updGroup(key, { key_insights: e.target.value })}
              />
            </div>

            <div className="seo-manual-actions">
              <button className="seo-inline-save" onClick={saveGroup} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        )}

        {hasData && !isEditing && (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table className="seo-table">
                <thead>
                  <tr>
                    <th>Campaigns</th>
                    <th style={{ textAlign: 'right' }}>Reach</th>
                    <th style={{ textAlign: 'right' }}>Impressions</th>
                    <th style={{ textAlign: 'right' }}>Clicks</th>
                    <th style={{ textAlign: 'right' }}>Leads</th>
                    <th style={{ textAlign: 'right' }}>Cost/Lead</th>
                    <th style={{ textAlign: 'right' }}>Amount Spent</th>
                  </tr>
                </thead>
                <tbody>
                  {group.campaigns.map((c, i) => {
                    const leads = Number(c.leads) || 0;
                    const cost  = Number(c.cost)  || 0;
                    const cpl   = leads > 0 ? cost / leads : null;
                    return (
                      <tr key={i}>
                        <td style={{ fontWeight: 600 }}>{c.name || '—'}</td>
                        <td style={{ textAlign: 'right' }}>{fmtNum(Number(c.reach) || 0)}</td>
                        <td style={{ textAlign: 'right' }}>{fmtNum(Number(c.impressions) || 0)}</td>
                        <td style={{ textAlign: 'right' }}>{fmtNum(Number(c.clicks) || 0)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{leads > 0 ? fmtNum(leads) : '—'}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: cplColor(cpl) }}>
                          {cpl !== null ? fmtCur(cpl) : '—'}
                        </td>
                        <td style={{ textAlign: 'right' }}>{cost > 0 ? fmtCur(cost) : '—'}</td>
                      </tr>
                    );
                  })}
                  {/* Total row */}
                  <tr style={{ background: 'var(--bg-sand,#f5f5f0)', fontWeight: 700 }}>
                    <td style={{ fontWeight: 700, color: 'var(--ink)' }}>Total</td>
                    <td style={{ textAlign: 'right' }}>{fmtNum(totals.reach)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtNum(totals.impressions)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtNum(totals.clicks)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtNum(totals.leads)}</td>
                    <td style={{ textAlign: 'right', color: '#16a34a', fontWeight: 700 }}>
                      {avgCpl !== null ? fmtCur(avgCpl) : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>{totals.cost > 0 ? fmtCur(totals.cost) : '—'}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {group.key_insights && (
              <div style={{ marginTop: 14, padding: '12px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Key Insights</p>
                <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>{group.key_insights}</p>
              </div>
            )}
          </>
        )}

        {!hasData && !isEditing && canEdit && (
          <p className="page-subtitle" style={{ padding: '12px 0' }}>Click Edit to add {label} campaigns.</p>
        )}
      </div>
    );
  };

  return (
    <Layout>
      <div className="page-wrap">

        {/* ── Header ── */}
        <div className="seo-top">
          <div>
            <h2 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Megaphone size={20} /> Ads Analytics
            </h2>
            <p className="page-subtitle">Google · LinkedIn · Meta — per client</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="seo-date-custom">
              <input
                type="date"
                className={`seo-date-input${customStart ? ' active' : ''}`}
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
              />
              <span className="seo-date-sep">→</span>
              <input
                type="date"
                className={`seo-date-input${customEnd ? ' active' : ''}`}
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
              />
            </div>
            {(customStart || customEnd) && (
              <button
                style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink-muted)', cursor: 'pointer' }}
                onClick={() => { setCustomStart(''); setCustomEnd(''); }}
              >✕</button>
            )}
          </div>
        </div>

        {/* ── Client tabs ── */}
        <div className="seo-nav">
          <div className="seo-client-row">
            {clients.map((c) => (
              <div key={c.id} className="seo-client-wrap">
                <button
                  className={`seo-client-btn${selectedClient?.id === c.id ? ' active' : ''}`}
                  onClick={() => { setSelectedClient(c); setEditingClientId(null); setEditingGroup(null); }}
                >
                  <span>{c.name}</span>
                  {canEdit && (
                    <span
                      className={`seo-config-icon${editingClientId === c.id ? ' open' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (editingClientId === c.id) { setEditingClientId(null); return; }
                        setSelectedClient(c);
                        setEditingClientId(c.id);
                        setCfCustomerId(c.ads_customer_id || '');
                      }}
                      title="Configure Google Ads Customer ID"
                    >
                      <Settings size={11} />
                    </span>
                  )}
                </button>
              </div>
            ))}
          </div>

          {canEdit && editingClientId != null && (
            <div className="seo-inline-config">
              <div className="seo-inline-config__header">
                <span className="seo-inline-config__title">Configure — {clients.find((c) => c.id === editingClientId)?.name}</span>
                <button className="seo-inline-close" onClick={() => setEditingClientId(null)}><X size={13} /></button>
              </div>
              <div className="seo-inline-config__fields">
                <div className="seo-inline-field">
                  <label className="seo-inline-label">Google Ads Customer ID</label>
                  <input
                    className="form-input seo-inline-input"
                    placeholder="e.g. 123-456-7890"
                    value={cfCustomerId}
                    onChange={(e) => setCfCustomerId(e.target.value)}
                  />
                  <p className="seo-hint">Found in your Google Ads account header. Remove dashes if required.</p>
                </div>
              </div>
              <div className="seo-inline-config__actions">
                <button className="seo-inline-save" onClick={saveClientConfig} disabled={cfSaving}>{cfSaving ? 'Saving…' : 'Save'}</button>
              </div>
            </div>
          )}
        </div>

        {/* ── Summary cards ── */}
        {hasSomeData && (
          <div className="seo-cards" style={{ marginBottom: 8 }}>
            {[
              { label: 'Campaigns',    value: String(allCampaigns.length) },
              { label: 'Total Reach',  value: fmtNum(overallTotals.reach) },
              { label: 'Impressions',  value: fmtNum(overallTotals.impressions) },
              { label: 'Clicks',       value: fmtNum(overallTotals.clicks) },
              { label: 'Total Leads',  value: fmtNum(overallTotals.leads) },
              { label: 'Avg Cost/Lead', value: overallCpl !== null ? fmtCur(overallCpl) : '—' },
              { label: 'Total Spent',  value: overallTotals.cost > 0 ? fmtCur(overallTotals.cost) : '—' },
            ].map(({ label, value }) => (
              <div key={label} className="seo-card">
                <div><p className="seo-card__val">{value}</p><p className="seo-card__label">{label}</p></div>
              </div>
            ))}
          </div>
        )}

        {/* ── Per-platform campaign tables ── */}
        {GROUPS.map(renderGroupSection)}

        {/* ── Notes ── */}
        {(canEdit || manual.notes) && (
          <div className="seo-section">
            <h3 className="seo-section__title">Notes</h3>
            {canEdit ? (
              <textarea
                className="form-input"
                rows={4}
                placeholder="General notes about this period's ad performance…"
                style={{ width: '100%', resize: 'vertical' }}
                value={manual.notes}
                onChange={(e) => {
                  const updated = { ...manual, notes: e.target.value };
                  setManual(updated);
                  api.put(`/ads/manual/${selectedClient?.id}`, {
                    notes: updated.notes,
                    campaigns_manual: { google: updated.google, linkedin: updated.linkedin, meta: updated.meta },
                  }).catch(() => {});
                }}
              />
            ) : (
              manual.notes && <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>{manual.notes}</p>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
