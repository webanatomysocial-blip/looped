import { useEffect, useRef, useState } from 'react';
import { Megaphone, Settings, X, Download, Globe } from 'lucide-react';
import Layout from '../components/Layout/Layout';
import { useAuth } from '../contexts/AuthContext';
import api, { adsApi } from '../services/api';
import '../css/pages/SEO.css';
import AdsCampaigns from '../components/UI/AdsCampaigns';

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
  cost_per_lead: string;
  cost: string;
  source?: string;
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

// Total Cost/Lead = avg of manually entered per-campaign cost/lead values
const calcGroupAvgCpl = (g: CampaignGroup): number | null => {
  const cpls = g.campaigns
    .map((c) => Number(c.cost_per_lead) || null)
    .filter((v): v is number => v !== null);
  return cpls.length > 0 ? cpls.reduce((a, b) => a + b, 0) / cpls.length : null;
};

const fmtNum  = (n: number) => n > 0 ? n.toLocaleString('en-IN') : '—';
const fmtCur  = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function downloadPDF(clientName: string, data: AdsManualData, start: string, end: string) {
  const period = start && end ? `${start} → ${end}` : start || end || 'All time';

  const renderGroup = (key: GroupKey, label: string) => {
    const group = data[key];
    if (!group.campaigns.length) return '';
    const totals = calcGroupTotals(group);
    const avgCpl = calcGroupAvgCpl(group);
    const rows = group.campaigns.map((c) => {
      const leads = Number(c.leads) || 0;
      const cost  = Number(c.cost)  || 0;
      const cpl   = Number(c.cost_per_lead) || null;
      const cplColor = cpl === null || avgCpl === null ? '#555' : cpl < avgCpl ? '#16a34a' : '#d97706';
      return `<tr>
        <td style="font-weight:600">${c.name || '—'}</td>
        <td style="text-align:right">${fmtNum(Number(c.reach) || 0)}</td>
        <td style="text-align:right">${fmtNum(Number(c.impressions) || 0)}</td>
        <td style="text-align:right">${fmtNum(Number(c.clicks) || 0)}</td>
        <td style="text-align:right;font-weight:700">${leads > 0 ? fmtNum(leads) : '—'}</td>
        <td style="text-align:right;font-weight:700;color:${cplColor}">${cpl !== null ? fmtCur(cpl) : '—'}</td>
        <td style="text-align:right">${cost > 0 ? fmtCur(cost) : '—'}</td>
      </tr>`;
    }).join('');
    const insightsHtml = group.key_insights
      ? `<div style="margin-top:10px;padding:10px 14px;background:#f8f8f5;border-radius:8px;border:1px solid #e0e0d6">
          <div style="font-size:10px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Key Insights</div>
          <div style="font-size:12px;line-height:1.7;color:#333;white-space:pre-wrap">${group.key_insights}</div>
        </div>` : '';
    return `
      <div class="section" style="margin-bottom:20px">
        <h3 style="font-size:13px;font-weight:700;color:#2563eb;margin-bottom:8px">${label} Campaigns</h3>
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead>
            <tr style="background:#1e3a5f;color:#fff">
              <th style="padding:8px 10px;text-align:left;font-weight:700">Campaigns</th>
              <th style="padding:8px 10px;text-align:right;font-weight:700">Reach</th>
              <th style="padding:8px 10px;text-align:right;font-weight:700">Impressions</th>
              <th style="padding:8px 10px;text-align:right;font-weight:700">Clicks</th>
              <th style="padding:8px 10px;text-align:right;font-weight:700">Leads</th>
              <th style="padding:8px 10px;text-align:right;font-weight:700">Cost/Lead</th>
              <th style="padding:8px 10px;text-align:right;font-weight:700">Amount Spent</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
            <tr style="background:#e8edf5;font-weight:700;border-top:2px solid #c0c8d8">
              <td style="padding:8px 10px;font-weight:700">Total</td>
              <td style="padding:8px 10px;text-align:right">${fmtNum(totals.reach)}</td>
              <td style="padding:8px 10px;text-align:right">${fmtNum(totals.impressions)}</td>
              <td style="padding:8px 10px;text-align:right">${fmtNum(totals.clicks)}</td>
              <td style="padding:8px 10px;text-align:right">${fmtNum(totals.leads)}</td>
              <td style="padding:8px 10px;text-align:right;color:#16a34a;font-weight:700">${avgCpl !== null ? fmtCur(avgCpl) : '—'}</td>
              <td style="padding:8px 10px;text-align:right">${totals.cost > 0 ? fmtCur(totals.cost) : '—'}</td>
            </tr>
          </tbody>
        </table>
        ${insightsHtml}
      </div>`;
  };

  const allCampaigns = [...data.google.campaigns, ...data.linkedin.campaigns, ...data.meta.campaigns];
  const ov = allCampaigns.reduce((acc, c) => ({ reach: acc.reach + (Number(c.reach)||0), impressions: acc.impressions + (Number(c.impressions)||0), clicks: acc.clicks + (Number(c.clicks)||0), leads: acc.leads + (Number(c.leads)||0), cost: acc.cost + (Number(c.cost)||0) }), { reach:0, impressions:0, clicks:0, leads:0, cost:0 });
  const ovCpl = calcGroupAvgCpl({ campaigns: allCampaigns, key_insights: '' });

  const cards = [
    ['Campaigns', String(allCampaigns.length)],
    ['Total Reach', fmtNum(ov.reach)],
    ['Impressions', fmtNum(ov.impressions)],
    ['Clicks', fmtNum(ov.clicks)],
    ['Total Leads', fmtNum(ov.leads)],
    ['Avg Cost/Lead', ovCpl !== null ? fmtCur(ovCpl) : '—'],
    ['Total Spent', ov.cost > 0 ? fmtCur(ov.cost) : '—'],
  ].map(([l, v]) => `<div style="background:#f0f4ff;border-radius:8px;padding:10px 14px;min-width:90px;text-align:center"><div style="font-size:15px;font-weight:700;color:#1e3a5f">${v}</div><div style="font-size:10px;color:#666;margin-top:2px">${l}</div></div>`).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Ads Report — ${clientName}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#222;background:#fff;padding:28px 32px;font-size:13px}
    table td,table th{padding:7px 10px;border-bottom:1px solid #e8e8e0}
    table tr:nth-child(even) td{background:#f9f9f6}
    @media print{@page{size:A4;margin:14mm 12mm}body{padding:0}}
  </style></head><body>
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;border-bottom:2px solid #1e3a5f;padding-bottom:14px">
      <div>
        <h1 style="font-size:20px;font-weight:800;color:#1e3a5f">Ads Analytics Report</h1>
        <div style="font-size:13px;color:#555;margin-top:4px">${clientName} &nbsp;·&nbsp; ${period}</div>
      </div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:24px">${cards}</div>
    ${GROUPS.map(({ key, label }) => renderGroup(key, label)).join('')}
    ${data.notes ? `<div style="margin-top:16px;padding:12px 16px;background:#f8f8f5;border-radius:8px"><div style="font-size:10px;font-weight:700;color:#888;text-transform:uppercase;margin-bottom:4px">Notes</div><div style="font-size:12px;line-height:1.7;white-space:pre-wrap">${data.notes}</div></div>` : ''}
  </body></html>`;

  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  setTimeout(() => { win.focus(); win.print(); }, 400);
}

export default function Ads() {
  const { user } = useAuth();
  const canEdit = ['admin', 'manager', 'employee'].includes(user?.role ?? '');

  const [clients,        setClients]        = useState<AdsClient[]>([]);
  const [selectedClient, setSelectedClient] = useState<AdsClient | null>(null);
  const [platform,       setPlatform]       = useState<GroupKey>('google');
  const [reportTick,     setReportTick]     = useState(0);
  const [editingClientId, setEditingClientId] = useState<number | null>(null);
  const [cfCustomerId,   setCfCustomerId]   = useState('');
  const [cfSaving,       setCfSaving]       = useState(false);

  const [customStart, setCustomStart] = useState('');
  const [customEnd,   setCustomEnd]   = useState('');

  const [manual,       setManual]       = useState<AdsManualData>(emptyManual());
  const [saving,       setSaving]       = useState(false);
  const [shareTokens,    setShareTokens]    = useState<{ token: string; start_date: string | null; end_date: string | null }[]>([]);
  const [showSharePanel, setShowSharePanel] = useState(false);
  const [shareCopied,    setShareCopied]    = useState<string | null>(null);
  const [adApprovals,    setAdApprovals]    = useState<any[]>([]);
  const [approvalsLoading, setApprovalsLoading] = useState(false);
  const [approvalsError, setApprovalsError] = useState('');
  const [clientsError,   setClientsError]   = useState('');
  const [manualError,    setManualError]    = useState('');
  const [saveTarget,     setSaveTarget]     = useState<'notes' | 'insights'>('notes');
  const [undatedHidden,  setUndatedHidden]  = useState(0);
  const [notesState,     setNotesState]     = useState<'' | 'saving' | 'saved' | 'error'>('');
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notesClient = useRef<number | null>(null);

  useEffect(() => {
    api.get('/ads/clients').then((r) => {
      setClients(r.data);
      setSelectedClient((sc) => sc ?? r.data[0] ?? null);
    }).catch((e) => setClientsError(e?.response?.data?.error || "Couldn't load clients. Refresh to try again."));
  }, []);

  // Report numbers are rebuilt from Campaigns whenever the client, dates or campaign data change
  useEffect(() => {
    if (!selectedClient) return;
    let stale = false;
    setManualError('');
    api.get(`/ads/manual/${selectedClient.id}`, { params: { startDate: customStart || undefined, endDate: customEnd || undefined } })
      .then((r) => { if (!stale) { setManual(parseManualData(r.data)); setUndatedHidden(Number(r.data?.undated_hidden) || 0); } })
      .catch((e) => { if (!stale) { setManual(emptyManual()); setManualError(e?.response?.data?.error || "Couldn't load this client's report data, so editing is disabled to avoid overwriting it. Refresh to try again."); } });
    return () => { stale = true; };
  }, [selectedClient, customStart, customEnd, reportTick]);

  useEffect(() => {
    if (!selectedClient) return;
    let stale = false;
    setNotesState(''); setApprovalsError(''); setAdApprovals([]);
    adsApi.getShareTokens(selectedClient.id)
      .then((r) => { if (!stale) setShareTokens(r.data || []); })
      .catch(() => { if (!stale) setShareTokens([]); });
    if (selectedClient.ads_customer_id) {
      setApprovalsLoading(true);
      adsApi.adApprovals(selectedClient.id)
        .then((r) => { if (!stale) setAdApprovals(r.data.ads || []); })
        .catch((e) => { if (!stale) { setAdApprovals([]); setApprovalsError(e?.response?.data?.error || "Couldn't load ad approvals"); } })
        .finally(() => { if (!stale) setApprovalsLoading(false); });
    }
    return () => { stale = true; };
  }, [selectedClient]);

  const saveNotes = (clientId: number, data: AdsManualData, target: 'notes' | 'insights' = 'notes') => {
    setSaveTarget(target);
    // Only debounce edits to the same client; a pending save for another client still goes through
    if (notesTimer.current && notesClient.current === clientId) clearTimeout(notesTimer.current);
    notesClient.current = clientId;
    setNotesState('saving');
    notesTimer.current = setTimeout(() => {
      api.put(`/ads/manual/${clientId}`, {
        notes: data.notes,
        campaigns_manual: { google: data.google, linkedin: data.linkedin, meta: data.meta },
      }).then(() => setNotesState('saved')).catch(() => setNotesState('error'));
    }, 700);
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
            {selectedClient && (
              <button
                className="seo-download-btn"
                onClick={() => downloadPDF(selectedClient?.name ?? 'Client', manual, customStart, customEnd)}
                title="Download PDF"
              >
                <Download size={13} /> Download PDF
              </button>
            )}
            {selectedClient && canEdit && (
              <div style={{ position: 'relative' }}>
                <button
                  className="seo-download-btn"
                  style={shareTokens.length > 0 ? { background: '#f0fdf4', borderColor: '#86efac', color: '#16a34a' } : undefined}
                  onClick={() => setShowSharePanel((v) => !v)}
                >
                  <Globe size={13} /> Share {shareTokens.length > 0 && `(${shareTokens.length})`}
                </button>
                {showSharePanel && (
                  <div style={{ position: 'absolute', right: 0, top: '110%', zIndex: 50, background: '#fff', border: '1px solid var(--border)', borderRadius: 10, boxShadow: '0 4px 20px rgba(0,0,0,0.12)', padding: 14, minWidth: 320 }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', marginBottom: 10 }}>Share Links</p>
                    {shareTokens.length === 0 && <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginBottom: 10 }}>No links yet.</p>}
                    {shareTokens.map((t) => {
                      const label = t.start_date && t.end_date ? `${t.start_date} → ${t.end_date}` : 'All time';
                      const link = `${window.location.origin}/share/ads/${t.token}`;
                      return (
                        <div key={t.token} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, padding: '6px 8px', background: 'var(--bg)', borderRadius: 6, border: '1px solid var(--border)' }}>
                          <span style={{ flex: 1, fontSize: 12, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                          <button
                            style={{ fontSize: 11, padding: '2px 8px', borderRadius: 5, border: '1px solid var(--border)', background: shareCopied === t.token ? '#f0fdf4' : 'var(--surface)', color: shareCopied === t.token ? '#16a34a' : 'var(--ink)', cursor: 'pointer', whiteSpace: 'nowrap' }}
                            onClick={async () => { await navigator.clipboard.writeText(link); setShareCopied(t.token); setTimeout(() => setShareCopied(null), 2000); }}
                          >{shareCopied === t.token ? '✓ Copied' : 'Copy'}</button>
                          <button
                            style={{ fontSize: 11, padding: '2px 8px', borderRadius: 5, border: '1px solid #fecaca', background: '#fef2f2', color: '#dc2626', cursor: 'pointer' }}
                            onClick={async () => {
                              if (!confirm('Revoke this link?')) return;
                              await adsApi.revokeShareToken(t.token);
                              setShareTokens((prev) => prev.filter((x) => x.token !== t.token));
                            }}
                          >Revoke</button>
                        </div>
                      );
                    })}
                    <button
                      className="seo-inline-save"
                      style={{ width: '100%', marginTop: 4 }}
                      onClick={async () => {
                        const r = await adsApi.createShare(selectedClient!.id, { startDate: customStart || undefined, endDate: customEnd || undefined });
                        const newToken = r.data.token;
                        setShareTokens((prev) => [{ token: newToken, start_date: customStart || null, end_date: customEnd || null }, ...prev]);
                        const link = `${window.location.origin}/share/ads/${newToken}`;
                        await navigator.clipboard.writeText(link);
                        setShareCopied(newToken);
                        setTimeout(() => setShareCopied(null), 2000);
                      }}
                    >+ Create link for current dates &amp; copy</button>
                  </div>
                )}
              </div>
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
                  onClick={() => { setSelectedClient(c); setEditingClientId(null); }}
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

        {clientsError && <p role="alert" style={{ fontSize: 13, color: '#dc2626' }}>{clientsError}</p>}
        {selectedClient && <>
          {manualError && <p role="alert" style={{ fontSize: 13, color: '#dc2626', background: 'rgba(220,38,38,0.06)', padding: '8px 12px', borderRadius: 8 }}>{manualError}</p>}
          {undatedHidden > 0 && <p style={{ fontSize: 12, color: 'var(--ink-muted)', margin: '0 0 8px' }}>{undatedHidden} imported {undatedHidden === 1 ? 'entry has' : 'entries have'} no dates, so {undatedHidden === 1 ? "it isn't" : "they aren't"} counted for the selected dates. Clear the dates to include {undatedHidden === 1 ? 'it' : 'them'}.</p>}
          <AdsCampaigns
            clientId={selectedClient.id}
            platform={platform}
            onPlatformChange={setPlatform}
            reportRows={manual[platform].campaigns}
            onChanged={() => setReportTick((t) => t + 1)}
            canEdit={canEdit}
            canDelete={['admin', 'manager'].includes(user?.role ?? '')}
            googleLive={!!selectedClient.ads_customer_id}
          />
          {(canEdit || manual[platform].key_insights) && (
            <div className="seo-section">
              <h3 className="seo-section__title">Key insights <span className="seo-badge">{GROUPS.find((g) => g.key === platform)!.badge}</span>
                {notesState && saveTarget === 'insights' && <span role="status" style={{ fontSize: 11, fontWeight: 600, marginLeft: 8, color: notesState === 'error' ? '#dc2626' : 'var(--ink-muted)' }}>
                  {notesState === 'saving' ? 'Saving…' : notesState === 'saved' ? 'Saved' : "Couldn't save — check your connection and edit again"}
                </span>}
              </h3>
              {canEdit && !manualError ? (
                <textarea className="form-input" rows={3} style={{ width: '100%', resize: 'vertical' }} placeholder="What stood out on this platform for the period…"
                  value={manual[platform].key_insights}
                  onChange={(e) => { const updated = { ...manual, [platform]: { ...manual[platform], key_insights: e.target.value } }; setManual(updated); saveNotes(selectedClient.id, updated, 'insights'); }} />
              ) : <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>{manual[platform].key_insights}</p>}
            </div>
          )}
        </>}
        {!selectedClient && !clientsError && (
          <p style={{ fontSize: 13, color: 'var(--ink-muted)', textAlign: 'center', padding: '48px 0' }}>{clients.length ? 'Pick a client above to see its ads.' : 'No clients yet.'}</p>
        )}

        {/* ── Notes ── */}
        {selectedClient && (canEdit || manual.notes) && (
          <div className="seo-section">
            <h3 className="seo-section__title">Notes
              {notesState && saveTarget === 'notes' && <span role="status" style={{ fontSize: 11, fontWeight: 600, marginLeft: 8, color: notesState === 'error' ? '#dc2626' : 'var(--ink-muted)' }}>
                {notesState === 'saving' ? 'Saving…' : notesState === 'saved' ? 'Saved' : "Couldn't save — check your connection and edit again"}
              </span>}
            </h3>
            {canEdit && !manualError ? (
              <textarea
                className="form-input"
                rows={4}
                placeholder="General notes about this period's ad performance…"
                style={{ width: '100%', resize: 'vertical' }}
                value={manual.notes}
                onChange={(e) => {
                  const updated = { ...manual, notes: e.target.value };
                  setManual(updated);
                  saveNotes(selectedClient!.id, updated);
                }}
              />
            ) : (
              manual.notes && <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>{manual.notes}</p>
            )}
          </div>
        )}
        {/* ── Ad Approval Status ── */}
        {platform === 'google' && selectedClient?.ads_customer_id && (
          <div className="seo-section">
            <h3 className="seo-section__title">Ad Approval Status</h3>
            {approvalsLoading && <p style={{ fontSize: 13, color: 'var(--ink-muted)' }}>Fetching ad approvals…</p>}
            {!approvalsLoading && approvalsError && <p role="alert" style={{ fontSize: 13, color: '#dc2626' }}>{approvalsError}</p>}
            {!approvalsLoading && !approvalsError && adApprovals.length === 0 && (
              <p style={{ fontSize: 13, color: 'var(--ink-muted)' }}>No active ads found.</p>
            )}
            {!approvalsLoading && adApprovals.length > 0 && (
              <table className="seo-table" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Campaign</th>
                    <th style={{ textAlign: 'left' }}>Ad Group</th>
                    <th style={{ textAlign: 'left' }}>Ad</th>
                    <th style={{ textAlign: 'left' }}>Status</th>
                    <th style={{ textAlign: 'left' }}>Approval</th>
                    <th style={{ textAlign: 'left' }}>Issues</th>
                  </tr>
                </thead>
                <tbody>
                  {adApprovals.map((ad: any) => {
                    const approval = ad.approval_status ?? 'UNKNOWN';
                    const color = approval === 'APPROVED' ? '#16a34a' : approval === 'APPROVED_LIMITED' ? '#d97706' : approval === 'DISAPPROVED' ? '#dc2626' : '#64748b';
                    const icon = approval === 'APPROVED' ? '✅' : approval === 'APPROVED_LIMITED' ? '⚠️' : approval === 'DISAPPROVED' ? '❌' : '🔄';
                    return (
                      <tr key={ad.id}>
                        <td>{ad.campaign}</td>
                        <td>{ad.ad_group}</td>
                        <td>{ad.name || ad.id}</td>
                        <td><span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{ad.status}</span></td>
                        <td><span style={{ fontWeight: 700, color }}>{icon} {approval.replace(/_/g, ' ')}</span></td>
                        <td style={{ color: '#dc2626', fontSize: 11 }}>
                          {ad.policy_topics?.map((t: any) => `${t.topic} (${t.type})`).join(', ') || '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
