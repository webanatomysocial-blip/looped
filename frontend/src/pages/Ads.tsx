import { useEffect, useState, useCallback } from 'react';
import { Megaphone, Edit2, Plus, Trash2, Globe, TrendingUp, MousePointer, Users, DollarSign, Target } from 'lucide-react';
import Layout from '../components/Layout/Layout';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';

interface AdsClient {
  id: number;
  name: string;
  ads_customer_id: string | null;
}

interface Campaign {
  id: string;
  name: string;
  status: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  reach: number | null;
}

interface AdsManual {
  notes: string;
  campaigns_manual: ManualCampaign[];
}

interface ManualCampaign {
  name: string;
  impressions: string;
  clicks: string;
  reach: string;
  leads: string;
  cost: string;
}

const emptyManual = (): AdsManual => ({ notes: '', campaigns_manual: [] });
const emptyCampaign = (): ManualCampaign => ({ name: '', impressions: '', clicks: '', reach: '', leads: '', cost: '' });

export default function Ads() {
  const { user } = useAuth();
  const canEdit = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'employee';

  const [clients, setClients] = useState<AdsClient[]>([]);
  const [selectedClient, setSelectedClient] = useState<AdsClient | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [manual, setManual] = useState<AdsManual>(emptyManual());
  const [manualEdit, setManualEdit] = useState<AdsManual>(emptyManual());
  const [editingPanel, setEditingPanel] = useState(false);
  const [saving, setSaving] = useState(false);

  // Client config edit
  const [editingClientId, setEditingClientId] = useState<number | null>(null);
  const [cfCustomerId, setCfCustomerId] = useState('');
  const [cfSaving, setCfSaving] = useState(false);

  useEffect(() => {
    api.get('/ads/clients').then((r) => {
      setClients(r.data);
      const first = r.data[0];
      if (first) setSelectedClient(first);
    }).catch(() => {});
  }, []);

  const loadCampaigns = useCallback(() => {
    if (!selectedClient?.ads_customer_id) { setCampaigns([]); return; }
    setLoading(true);
    setError('');
    api.get(`/ads/report/${selectedClient.id}`)
      .then((r) => setCampaigns(r.data.campaigns ?? []))
      .catch((e) => setError(e.response?.data?.error || 'Failed to load campaigns'))
      .finally(() => setLoading(false));
  }, [selectedClient]);

  useEffect(() => { loadCampaigns(); }, [loadCampaigns]);

  useEffect(() => {
    if (!selectedClient) return;
    api.get(`/ads/manual/${selectedClient.id}`)
      .then((r) => { setManual({ ...emptyManual(), ...r.data }); })
      .catch(() => setManual(emptyManual()));
  }, [selectedClient]);

  const openEdit = () => { setManualEdit({ ...manual }); setEditingPanel(true); };

  const saveManual = async () => {
    if (!selectedClient) return;
    setSaving(true);
    try {
      await api.put(`/ads/manual/${selectedClient.id}`, manualEdit);
      setManual({ ...manualEdit });
      setEditingPanel(false);
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

  // Totals from API campaigns
  const totals = campaigns.reduce((acc, c) => ({
    impressions: acc.impressions + c.impressions,
    clicks: acc.clicks + c.clicks,
    cost: acc.cost + c.cost,
    conversions: acc.conversions + c.conversions,
    reach: acc.reach + (c.reach ?? 0),
  }), { impressions: 0, clicks: 0, cost: 0, conversions: 0, reach: 0 });

  const ctr = totals.impressions > 0 ? ((totals.clicks / totals.impressions) * 100).toFixed(2) : '0';
  const costPerLead = totals.conversions > 0 ? (totals.cost / totals.conversions).toFixed(2) : '—';

  // Manual campaigns totals
  const manualTotals = manual.campaigns_manual.reduce((acc, c) => ({
    impressions: acc.impressions + (Number(c.impressions) || 0),
    clicks: acc.clicks + (Number(c.clicks) || 0),
    cost: acc.cost + (Number(c.cost) || 0),
    leads: acc.leads + (Number(c.leads) || 0),
    reach: acc.reach + (Number(c.reach) || 0),
  }), { impressions: 0, clicks: 0, cost: 0, leads: 0, reach: 0 });

  const hasCampaigns = campaigns.length > 0;
  const hasManual = manual.campaigns_manual.length > 0;
  const showManual = !hasCampaigns || hasManual;

  const fmtCurrency = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

  return (
    <Layout>
      <div className="seo-page">
        <div className="seo-header">
          <div>
            <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Megaphone size={22} /> Ads Analytics
            </h1>
            <p className="page-subtitle">Google Ads campaign performance</p>
          </div>

          {/* Client selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <select
              className="form-input"
              style={{ minWidth: 180 }}
              value={selectedClient?.id ?? ''}
              onChange={(e) => {
                const c = clients.find((x) => x.id === Number(e.target.value));
                setSelectedClient(c ?? null);
              }}
            >
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {canEdit && selectedClient && (
              <button className="seo-manual-edit-btn" style={{ fontSize: 12 }}
                onClick={() => {
                  if (editingClientId === selectedClient.id) { setEditingClientId(null); return; }
                  setEditingClientId(selectedClient.id);
                  setCfCustomerId(selectedClient.ads_customer_id || '');
                }}>
                <Edit2 size={11} /> {editingClientId === selectedClient.id ? 'Cancel' : 'Configure'}
              </button>
            )}
          </div>
        </div>

        {/* Config panel */}
        {editingClientId && canEdit && (
          <div className="seo-manual-panel" style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-muted)', marginBottom: 8 }}>Google Ads Customer ID</p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input className="form-input" placeholder="e.g. 123-456-7890"
                value={cfCustomerId} onChange={(e) => setCfCustomerId(e.target.value)} style={{ width: 220 }} />
              <button className="seo-inline-save" onClick={saveClientConfig} disabled={cfSaving}>{cfSaving ? 'Saving…' : 'Save'}</button>
            </div>
            <p className="seo-hint">Remove dashes — enter as numbers only if required. Found in your Google Ads account header.</p>
          </div>
        )}

        {error && <p className="seo-error">{error}</p>}
        {loading && <p className="page-subtitle" style={{ marginTop: 24 }}>Loading campaigns…</p>}

        {selectedClient && !selectedClient.ads_customer_id && !editingClientId && (
          <div className="seo-empty-state">
            <Megaphone size={36} style={{ color: 'var(--sand-border)' }} />
            <p>Google Ads Customer ID not configured for <strong>{selectedClient.name}</strong>.</p>
            {canEdit
              ? <button className="btn-primary" onClick={() => { setEditingClientId(selectedClient.id); setCfCustomerId(''); }}>Configure now</button>
              : <p className="page-subtitle">Ask your admin to set this up.</p>}
          </div>
        )}

        {/* ── API Campaigns ── */}
        {hasCampaigns && (
          <>
            {/* Summary cards */}
            <div className="seo-cards">
              {[
                { label: 'Campaigns',     value: String(campaigns.length),               icon: Target },
                { label: 'Reach',         value: totals.reach > 0 ? totals.reach.toLocaleString() : '—', icon: Users },
                { label: 'Impressions',   value: totals.impressions.toLocaleString(),    icon: Globe },
                { label: 'Clicks',        value: totals.clicks.toLocaleString(),         icon: MousePointer },
                { label: 'CTR',           value: `${ctr}%`,                              icon: TrendingUp },
                { label: 'Leads',         value: totals.conversions.toLocaleString(),    icon: Target },
                { label: 'Cost / Lead',   value: costPerLead !== '—' ? `₹${costPerLead}` : '—', icon: DollarSign },
                { label: 'Amount Spent',  value: fmtCurrency(totals.cost),              icon: DollarSign },
              ].map(({ label, value, icon: Icon }) => (
                <div key={label} className="seo-card">
                  <div className="seo-card__icon"><Icon size={15} /></div>
                  <div>
                    <p className="seo-card__val">{value}</p>
                    <p className="seo-card__label">{label}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Campaigns table */}
            <div className="seo-section">
              <h3 className="seo-section__title">Campaigns <span className="seo-badge">Google Ads</span></h3>
              <div style={{ overflowX: 'auto' }}>
                <table className="seo-table">
                  <thead>
                    <tr>
                      <th>Campaign</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Impressions</th>
                      <th style={{ textAlign: 'right' }}>Clicks</th>
                      <th style={{ textAlign: 'right' }}>CTR</th>
                      <th style={{ textAlign: 'right' }}>Leads</th>
                      <th style={{ textAlign: 'right' }}>Cost/Lead</th>
                      <th style={{ textAlign: 'right' }}>Spent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.map((c) => {
                      const cCtr = c.impressions > 0 ? ((c.clicks / c.impressions) * 100).toFixed(2) : '0';
                      const cpl = c.conversions > 0 ? `₹${(c.cost / c.conversions).toFixed(2)}` : '—';
                      return (
                        <tr key={c.id}>
                          <td>{c.name}</td>
                          <td><span style={{ fontSize: 11, fontWeight: 700, color: c.status === 'ENABLED' ? '#16a34a' : 'var(--ink-muted)', background: c.status === 'ENABLED' ? '#f0fdf4' : 'var(--bg-sand)', padding: '2px 8px', borderRadius: 10 }}>{c.status}</span></td>
                          <td style={{ textAlign: 'right' }}>{c.impressions.toLocaleString()}</td>
                          <td style={{ textAlign: 'right' }}>{c.clicks.toLocaleString()}</td>
                          <td style={{ textAlign: 'right' }}>{cCtr}%</td>
                          <td style={{ textAlign: 'right' }}>{c.conversions.toLocaleString()}</td>
                          <td style={{ textAlign: 'right' }}>{cpl}</td>
                          <td style={{ textAlign: 'right' }}>{fmtCurrency(c.cost)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* ── Manual Campaigns ── */}
        {showManual && (canEdit || hasManual) && (
          <div className="seo-section">
            <h3 className="seo-section__title">
              Campaigns <span className="seo-badge">Manual</span>
              {canEdit && (
                <button className="seo-manual-edit-btn" onClick={() => editingPanel ? setEditingPanel(false) : openEdit()}>
                  <Edit2 size={11} /> {editingPanel ? 'Cancel' : 'Edit'}
                </button>
              )}
            </h3>

            {editingPanel && canEdit && (
              <div className="seo-manual-panel">
                {/* Summary totals edit */}
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Campaign Rows</div>
                <div style={{ display: 'flex', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', marginBottom: 4, padding: '0 4px' }}>
                  <span style={{ flex: 2 }}>Campaign name</span>
                  <span style={{ width: 80 }}>Impressions</span>
                  <span style={{ width: 70 }}>Clicks</span>
                  <span style={{ width: 80 }}>Reach</span>
                  <span style={{ width: 70 }}>Leads</span>
                  <span style={{ width: 90 }}>Cost (₹)</span>
                  <span style={{ width: 28 }} />
                </div>
                {manualEdit.campaigns_manual.map((c, i) => {
                  const upd = (patch: Partial<ManualCampaign>) => {
                    const a = [...manualEdit.campaigns_manual]; a[i] = { ...a[i], ...patch };
                    setManualEdit({ ...manualEdit, campaigns_manual: a });
                  };
                  return (
                    <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                      <input className="form-input seo-inline-input" placeholder="Campaign name" value={c.name} onChange={(e) => upd({ name: e.target.value })} style={{ flex: 2 }} />
                      <input className="form-input seo-inline-input" placeholder="0" type="number" value={c.impressions} onChange={(e) => upd({ impressions: e.target.value })} style={{ width: 80 }} />
                      <input className="form-input seo-inline-input" placeholder="0" type="number" value={c.clicks} onChange={(e) => upd({ clicks: e.target.value })} style={{ width: 70 }} />
                      <input className="form-input seo-inline-input" placeholder="0" type="number" value={c.reach} onChange={(e) => upd({ reach: e.target.value })} style={{ width: 80 }} />
                      <input className="form-input seo-inline-input" placeholder="0" type="number" value={c.leads} onChange={(e) => upd({ leads: e.target.value })} style={{ width: 70 }} />
                      <input className="form-input seo-inline-input" placeholder="0.00" type="number" value={c.cost} onChange={(e) => upd({ cost: e.target.value })} style={{ width: 90 }} />
                      <button className="seo-manual-del" onClick={() => setManualEdit({ ...manualEdit, campaigns_manual: manualEdit.campaigns_manual.filter((_, j) => j !== i) })}><Trash2 size={13} /></button>
                    </div>
                  );
                })}
                <div className="seo-manual-actions">
                  <button className="seo-manual-add" onClick={() => setManualEdit({ ...manualEdit, campaigns_manual: [...manualEdit.campaigns_manual, emptyCampaign()] })}>
                    <Plus size={12} /> Add campaign
                  </button>
                  <button className="seo-inline-save" onClick={saveManual} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
                </div>
              </div>
            )}

            {hasManual && !editingPanel && (
              <>
                {/* Manual summary cards */}
                <div className="seo-cards" style={{ marginBottom: 16 }}>
                  {[
                    { label: 'Campaigns',    value: String(manual.campaigns_manual.length) },
                    { label: 'Reach',        value: manualTotals.reach > 0 ? manualTotals.reach.toLocaleString() : '—' },
                    { label: 'Impressions',  value: manualTotals.impressions.toLocaleString() },
                    { label: 'Clicks',       value: manualTotals.clicks.toLocaleString() },
                    { label: 'Leads',        value: manualTotals.leads.toLocaleString() },
                    { label: 'Cost / Lead',  value: manualTotals.leads > 0 ? fmtCurrency(manualTotals.cost / manualTotals.leads) : '—' },
                    { label: 'Amount Spent', value: fmtCurrency(manualTotals.cost) },
                  ].map(({ label, value }) => (
                    <div key={label} className="seo-card">
                      <div><p className="seo-card__val">{value}</p><p className="seo-card__label">{label}</p></div>
                    </div>
                  ))}
                </div>

                {/* Manual campaigns table */}
                <div style={{ overflowX: 'auto' }}>
                  <table className="seo-table">
                    <thead>
                      <tr>
                        <th>Campaign</th>
                        <th style={{ textAlign: 'right' }}>Reach</th>
                        <th style={{ textAlign: 'right' }}>Impressions</th>
                        <th style={{ textAlign: 'right' }}>Clicks</th>
                        <th style={{ textAlign: 'right' }}>Leads</th>
                        <th style={{ textAlign: 'right' }}>Cost/Lead</th>
                        <th style={{ textAlign: 'right' }}>Amount Spent</th>
                      </tr>
                    </thead>
                    <tbody>
                      {manual.campaigns_manual.map((c, i) => {
                        const leads = Number(c.leads) || 0;
                        const cost  = Number(c.cost)  || 0;
                        const cpl   = leads > 0 ? fmtCurrency(cost / leads) : '—';
                        return (
                          <tr key={i}>
                            <td>{c.name || '—'}</td>
                            <td style={{ textAlign: 'right' }}>{Number(c.reach) > 0 ? Number(c.reach).toLocaleString() : '—'}</td>
                            <td style={{ textAlign: 'right' }}>{Number(c.impressions) > 0 ? Number(c.impressions).toLocaleString() : '—'}</td>
                            <td style={{ textAlign: 'right' }}>{Number(c.clicks) > 0 ? Number(c.clicks).toLocaleString() : '—'}</td>
                            <td style={{ textAlign: 'right' }}>{leads > 0 ? leads.toLocaleString() : '—'}</td>
                            <td style={{ textAlign: 'right' }}>{cpl}</td>
                            <td style={{ textAlign: 'right' }}>{cost > 0 ? fmtCurrency(cost) : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {!hasManual && !editingPanel && canEdit && (
              <p className="page-subtitle" style={{ padding: '12px 0' }}>Click Edit to add campaign data manually.</p>
            )}
          </div>
        )}

        {/* ── Notes ── */}
        {(canEdit || manual.notes) && (
          <div className="seo-section">
            <h3 className="seo-section__title">Notes</h3>
            {canEdit ? (
              <textarea className="form-input" rows={4} placeholder="Add notes about this period's ad performance…"
                style={{ width: '100%', resize: 'vertical' }}
                value={editingPanel ? manualEdit.notes : manual.notes}
                onChange={(e) => {
                  if (editingPanel) {
                    setManualEdit({ ...manualEdit, notes: e.target.value });
                  } else {
                    const updated = { ...manual, notes: e.target.value };
                    setManual(updated);
                    api.put(`/ads/manual/${selectedClient?.id}`, updated).catch(() => {});
                  }
                }} />
            ) : (
              manual.notes && <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>{manual.notes}</p>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
