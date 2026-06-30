import { useEffect, useState } from 'react';
import { TrendingUp, Users, MousePointer, Globe, MapPin, Settings, Check, X, Download, Plus, Trash2, Edit2, Search, Star, Linkedin, FileText } from 'lucide-react';
import Layout from '../components/Layout/Layout';
import Header from '../components/Layout/Header';
import { useAuth } from '../contexts/AuthContext';
import { seoApi } from '../services/api';
import '../css/pages/SEO.css';

type Range = '7d' | '28d' | '90d' | 'custom';

interface Client { id: number; name: string; ga_property_id: string | null; gsc_site_url: string | null; }
interface TrafficRow { date: string; users: number; sessions: number; pageviews: number; newUsers: number; }
interface AcqRow { channel: string; sessions: number; users: number; }
interface Engagement { avgDuration: number; bounceRate: number; pagesPerSession: number; engagementRate: number; sessions: number; users: number; newUsers: number; }
interface DemoRow { city: string; users: number; sessions: number; }
interface PageRow { page: string; clicks: number; impressions: number; ctr: number; position: number; }
interface QueryRow { query: string; clicks: number; impressions: number; ctr: number; position: number; }
interface KeywordRank { keyword: string; rank: number; change: number; }
interface Target { name: string; target: number; achieved: number; unit: string; }
interface ManualData {
  keyword_rankings: KeywordRank[];
  targets: Target[];
  organic_submissions: number;
  gmb_rating: number | null;
  gmb_reviews: number | null;
  gmb_profile_url: string;
  linkedin_url: string;
  linkedin_followers: number | null;
}

interface Report {
  traffic: TrafficRow[];
  acquisition: AcqRow[];
  engagement: Engagement;
  demographics: DemoRow[];
  pages: PageRow[];
  queries: QueryRow[];
  client: { id: number; name: string };
}

function fmtDate(d: string) { return `${d.slice(4, 6)}/${d.slice(6, 8)}`; }
function fmtDateLabel(d: string) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parseInt(d.slice(4,6)) - 1]} ${parseInt(d.slice(6,8))}`;
}
function fmtDuration(s: number) { const m = Math.floor(s / 60); return `${m}m ${s % 60}s`; }
function shortenUrl(url: string) { return url.replace(/^https?:\/\/(www\.)?/, '').replace(/\?.*$/, '').slice(0, 60); }

function downloadPDF(report: Report, clientName: string, range: string) {
  const eng = report.engagement;
  const maxV = Math.max(...report.traffic.map((r) => Math.max(r.users, r.sessions)), 1);
  const W = 700, H = 160, pad = 32, barW = Math.max(4, Math.floor((W - pad * 2) / report.traffic.length) - 2);

  const bars = report.traffic.map((row, i) => {
    const x = pad + i * (barW + 2);
    const sh = Math.round((row.sessions / maxV) * H);
    const uh = Math.round((row.users / maxV) * H);
    return `
      <rect x="${x}" y="${H - sh}" width="${barW}" height="${sh}" fill="#c7d2fe" rx="2"/>
      <rect x="${x}" y="${H - uh}" width="${barW}" height="${uh}" fill="#6366f1" rx="2"/>`;
  }).join('');

  const labels = report.traffic.filter((_, i) => i % Math.ceil(report.traffic.length / 10) === 0)
    .map((row) => {
      const origI = report.traffic.findIndex((r) => r.date === row.date);
      const x = pad + origI * (barW + 2) + barW / 2;
      return `<text x="${x}" y="${H + 16}" text-anchor="middle" font-size="9" fill="#888">${fmtDate(row.date)}</text>`;
    }).join('');

  const cards = [
    ['Total Users', eng.users.toLocaleString()],
    ['New Users', eng.newUsers.toLocaleString()],
    ['Sessions', eng.sessions.toLocaleString()],
    ['Avg. Duration', fmtDuration(eng.avgDuration)],
    ['Engagement Rate', `${eng.engagementRate}%`],
  ];

  const acqRows = report.acquisition.map((r, i) => `
    <tr style="background:${i % 2 === 0 ? '#f9f9f9' : '#fff'}">
      <td style="padding:8px 12px;font-weight:600">${r.channel}</td>
      <td style="padding:8px 12px;text-align:right">${r.sessions.toLocaleString()}</td>
      <td style="padding:8px 12px;text-align:right">${r.users.toLocaleString()}</td>
    </tr>`).join('');

  const demoRows = report.demographics.slice(0, 10).map((r, i) => `
    <tr style="background:${i % 2 === 0 ? '#f9f9f9' : '#fff'}">
      <td style="padding:8px 12px;font-weight:600">${r.city}</td>
      <td style="padding:8px 12px;text-align:right">${r.users.toLocaleString()}</td>
      <td style="padding:8px 12px;text-align:right">${r.sessions.toLocaleString()}</td>
    </tr>`).join('');

  const pageRows = report.pages.slice(0, 6).map((r, i) => `
    <tr style="background:${i % 2 === 0 ? '#f9f9f9' : '#fff'}">
      <td style="padding:8px 12px;font-size:11px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${shortenUrl(r.page)}</td>
      <td style="padding:8px 12px;text-align:right;font-weight:700">${r.clicks.toLocaleString()}</td>
      <td style="padding:8px 12px;text-align:right">${r.impressions.toLocaleString()}</td>
      <td style="padding:8px 12px;text-align:right">${r.ctr}%</td>
      <td style="padding:8px 12px;text-align:right">${r.position}</td>
    </tr>`).join('');

  const rangeLabel = range === '7d' ? 'Last 7 days' : range === '28d' ? 'Last 28 days' : 'Last 90 days';
  const dateStr = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>SEO Report — ${clientName}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a1a; background: #fff; padding: 40px 48px; }
  h1 { font-size: 22px; font-weight: 800; color: #1a1a1a; }
  h2 { font-size: 13px; font-weight: 700; color: #1a1a1a; margin-bottom: 12px; margin-top: 28px; text-transform: uppercase; letter-spacing: 0.05em; }
  .meta { font-size: 12px; color: #888; margin-top: 4px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #6366f1; padding-bottom: 16px; margin-bottom: 24px; }
  .logo { font-size: 11px; font-weight: 700; color: #6366f1; letter-spacing: 0.1em; text-transform: uppercase; }
  .cards { display: grid; grid-template-columns: repeat(5,1fr); gap: 12px; margin-bottom: 4px; }
  .card { background: #f5f5f0; border-radius: 10px; padding: 14px 16px; }
  .card-val { font-size: 20px; font-weight: 800; color: #1a1a1a; }
  .card-label { font-size: 10px; font-weight: 600; color: #888; margin-top: 3px; text-transform: uppercase; letter-spacing: 0.04em; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; font-size: 10px; font-weight: 700; color: #888; padding: 8px 12px; background: #f5f5f0; text-transform: uppercase; letter-spacing: 0.05em; }
  th:not(:first-child) { text-align: right; }
  .section { border: 1px solid #e8e8e0; border-radius: 10px; overflow: hidden; margin-bottom: 20px; }
  .section-title { font-size: 13px; font-weight: 700; padding: 14px 16px 0; margin: 0; text-transform: none; letter-spacing: 0; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .badge { display: inline-block; background: #e8f5e9; color: #2e7d32; font-size: 9px; font-weight: 700; padding: 2px 7px; border-radius: 4px; margin-left: 8px; vertical-align: middle; }
  svg { display: block; }
  .legend { display: flex; gap: 16px; padding: 10px 16px; font-size: 10px; color: #888; font-weight: 600; }
  .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 4px; }
  @media print {
    body { padding: 20px 24px; }
    @page { margin: 0.5cm; size: A4 portrait; }
  }
</style>
</head><body>
<div class="header">
  <div>
    <h1>SEO Analytics Report</h1>
    <p class="meta">${clientName} &nbsp;·&nbsp; ${rangeLabel} &nbsp;·&nbsp; Generated ${dateStr}</p>
  </div>
  <div class="logo">Workdeck</div>
</div>

<div class="cards">
  ${cards.map(([label, val]) => `<div class="card"><div class="card-val">${val}</div><div class="card-label">${label}</div></div>`).join('')}
</div>

<h2>Website Traffic</h2>
<div class="section">
  <svg width="${W}" height="${H + 28}" viewBox="0 0 ${W} ${H + 28}" xmlns="http://www.w3.org/2000/svg">
    ${bars}${labels}
  </svg>
  <div class="legend">
    <span><span class="dot" style="background:#6366f1"></span>Users</span>
    <span><span class="dot" style="background:#c7d2fe"></span>Sessions</span>
  </div>
</div>

<div class="two-col">
  <div>
    <h2>User Acquisition</h2>
    <div class="section">
      <table><thead><tr><th>Channel</th><th>Sessions</th><th>Users</th></tr></thead>
      <tbody>${acqRows}</tbody></table>
    </div>
  </div>
  <div>
    <h2>Demographics — Cities (India)</h2>
    <div class="section">
      <table><thead><tr><th>City</th><th>Users</th><th>Sessions</th></tr></thead>
      <tbody>${demoRows}</tbody></table>
    </div>
  </div>
</div>

${report.pages.length > 0 ? `
<h2>Pages &amp; Screens <span class="badge">Search Console</span></h2>
<div class="section">
  <table><thead><tr><th>Page</th><th>Clicks</th><th>Impressions</th><th>CTR</th><th>Position</th></tr></thead>
  <tbody>${pageRows}</tbody></table>
</div>` : ''}

</body></html>`;

  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  setTimeout(() => { win.focus(); win.print(); }, 400);
}

const emptyManual = (): ManualData => ({
  keyword_rankings: [], targets: [], organic_submissions: 0,
  gmb_rating: null, gmb_reviews: null, gmb_profile_url: '', linkedin_url: '', linkedin_followers: null,
});

export default function SEO() {
  const { user } = useAuth();
  const isAdmin   = user?.role === 'admin';
  const canEdit   = user?.role === 'admin' || user?.role === 'manager';

  const [clients, setClients]           = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [range, setRange]               = useState<Range>('28d');
  const [customStart, setCustomStart]   = useState('');
  const [customEnd, setCustomEnd]       = useState('');
  const [report, setReport]             = useState<Report | null>(null);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState('');

  // GA/GSC config inline edit
  const [editingId, setEditingId]   = useState<number | null>(null);
  const [cfGa, setCfGa]             = useState('');
  const [cfGsc, setCfGsc]           = useState('');
  const [saving, setSaving]         = useState(false);
  const [saved, setSaved]           = useState(false);

  // Manual data
  const [manual, setManual]             = useState<ManualData>(emptyManual());
  const [manualEdit, setManualEdit]     = useState<ManualData>(emptyManual());
  const [manualPanel, setManualPanel]   = useState<'keywords' | 'targets' | 'gmb' | null>(null);
  const [manualSaving, setManualSaving] = useState(false);

  useEffect(() => {
    seoApi.clients().then((r) => {
      setClients(r.data);
      const first = r.data.find((c: Client) => c.ga_property_id);
      if (first) setSelectedClient(first);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedClient?.ga_property_id) { setReport(null); return; }
    if (range === 'custom' && (!customStart || !customEnd)) return;
    setLoading(true);
    setError('');
    seoApi.report(selectedClient.id, range, range === 'custom' ? customStart : undefined, range === 'custom' ? customEnd : undefined)
      .then((r) => setReport(r.data))
      .catch((e) => setError(e.response?.data?.error || 'Failed to load report'))
      .finally(() => setLoading(false));
  }, [selectedClient, range, customStart, customEnd]);

  useEffect(() => {
    if (!selectedClient) return;
    seoApi.getManual(selectedClient.id)
      .then((r) => setManual({ ...emptyManual(), ...r.data }))
      .catch(() => setManual(emptyManual()));
  }, [selectedClient]);

  const openManualPanel = (panel: typeof manualPanel) => {
    setManualEdit({ ...manual });
    setManualPanel(panel);
  };
  const saveManual = async () => {
    if (!selectedClient) return;
    setManualSaving(true);
    try {
      await seoApi.updateManual(selectedClient.id, manualEdit);
      setManual({ ...manualEdit });
      setManualPanel(null);
    } catch { alert('Failed to save'); }
    finally { setManualSaving(false); }
  };

  const openEdit = (c: Client) => {
    if (editingId === c.id) { setEditingId(null); return; }
    setEditingId(c.id);
    setCfGa(c.ga_property_id || '');
    setCfGsc(c.gsc_site_url || '');
    setSaved(false);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      await seoApi.configClient(editingId, { ga_property_id: cfGa, gsc_site_url: cfGsc });
      const updated = clients.map((c) =>
        c.id === editingId ? { ...c, ga_property_id: cfGa || null, gsc_site_url: cfGsc || null } : c
      );
      setClients(updated);
      if (selectedClient?.id === editingId) {
        setSelectedClient((sc) => sc ? { ...sc, ga_property_id: cfGa || null, gsc_site_url: cfGsc || null } : sc);
      }
      setSaved(true);
      setTimeout(() => { setEditingId(null); setSaved(false); }, 800);
    } catch { alert('Failed to save'); }
    finally { setSaving(false); }
  };

  const maxUsers = Math.max(...(report?.traffic.map((r) => r.users) ?? [1]), 1);
  const maxAcq   = Math.max(...(report?.acquisition.map((r) => r.sessions) ?? [1]), 1);
  const maxDemo  = Math.max(...(report?.demographics.map((r) => r.users) ?? [1]), 1);

  const editingClient = clients.find((c) => c.id === editingId) ?? null;

  return (
    <Layout>
      <div className="page-wrap">
        <Header />

        <div className="seo-top">
          <div>
            <h2 className="page-title">SEO Analytics</h2>
            <p className="page-subtitle">Google Analytics + Search Console — per client</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="seo-range-row">
              {(['7d', '28d', '90d'] as Range[]).map((r) => (
                <button key={r} className={`filter-tab${range === r ? ' active' : ''}`} onClick={() => setRange(r)}>
                  {r === '7d' ? '7 days' : r === '28d' ? '28 days' : '90 days'}
                </button>
              ))}
              <div className="seo-date-custom">
                <input
                  type="date"
                  className={`seo-date-input${range === 'custom' ? ' active' : ''}`}
                  value={customStart}
                  onChange={(e) => { setCustomStart(e.target.value); if (customEnd) setRange('custom'); }}
                />
                <span className="seo-date-sep">→</span>
                <input
                  type="date"
                  className={`seo-date-input${range === 'custom' ? ' active' : ''}`}
                  value={customEnd}
                  onChange={(e) => { setCustomEnd(e.target.value); if (customStart) setRange('custom'); }}
                />
              </div>
            </div>
            {report && (
              <button
                className="seo-download-btn"
                onClick={() => downloadPDF(report!, selectedClient?.name ?? 'Client', range)}
                title="Download PDF"
              >
                <Download size={13} /> Download PDF
              </button>
            )}
          </div>
        </div>

        {/* ── Client selector + inline config ── */}
        <div className="seo-nav">
          <div className="seo-client-row">
            {clients.map((c) => (
              <div key={c.id} className="seo-client-wrap">
                <button
                  className={`seo-client-btn${selectedClient?.id === c.id ? ' active' : ''}${!c.ga_property_id ? ' unconfigured' : ''}`}
                  onClick={() => { setSelectedClient(c); if (editingId !== c.id) setEditingId(null); }}
                >
                  <span>{c.name}</span>
                  {!c.ga_property_id && <span className="seo-badge-warn">Setup</span>}
                  {isAdmin && (
                    <span
                      className={`seo-config-icon${editingId === c.id ? ' open' : ''}`}
                      onClick={(e) => { e.stopPropagation(); openEdit(c); }}
                      title="Configure GA4 & GSC"
                    >
                      <Settings size={11} />
                    </span>
                  )}
                </button>
              </div>
            ))}
          </div>

          {/* Inline edit panel */}
          {isAdmin && editingId && editingClient && (
            <div className="seo-inline-config">
              <div className="seo-inline-config__header">
                <span className="seo-inline-config__title">Configure — {editingClient.name}</span>
                <button className="seo-inline-close" onClick={() => setEditingId(null)}><X size={13} /></button>
              </div>
              <div className="seo-inline-config__fields">
                <div className="seo-inline-field">
                  <label className="seo-inline-label">GA4 Property ID</label>
                  <input
                    className="form-input seo-inline-input"
                    placeholder="e.g. 123456789"
                    value={cfGa}
                    onChange={(e) => setCfGa(e.target.value)}
                  />
                  <p className="seo-hint">GA4 → Admin → Property Settings → Property ID</p>
                </div>
                <div className="seo-inline-field">
                  <label className="seo-inline-label">Search Console URL</label>
                  <input
                    className="form-input seo-inline-input"
                    placeholder="e.g. pebpro.in"
                    value={cfGsc}
                    onChange={(e) => setCfGsc(e.target.value)}
                  />
                  <p className="seo-hint">Just the domain — no https:// needed</p>
                </div>
                <button
                  className={`seo-inline-save${saved ? ' saved' : ''}`}
                  onClick={saveEdit}
                  disabled={saving || saved}
                >
                  {saved ? <><Check size={13} /> Saved</> : saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* No client configured */}
        {selectedClient && !selectedClient.ga_property_id && !editingId && (
          <div className="seo-empty-state">
            <Globe size={36} style={{ color: 'var(--sand-border)' }} />
            <p>GA4 Property ID not configured for <strong>{selectedClient.name}</strong>.</p>
            {isAdmin
              ? <button className="btn-primary" onClick={() => openEdit(selectedClient)}>Configure now</button>
              : <p className="page-subtitle">Ask your admin to set this up.</p>}
          </div>
        )}

        {error && <p className="seo-error">{error}</p>}
        {loading && <p className="page-subtitle" style={{ marginTop: 24 }}>Loading analytics…</p>}

        {report && !loading && (
          <>
            {/* ── Summary cards ── */}
            <div className="seo-cards">
              {[
                { label: 'Total Users',     value: report.engagement.users.toLocaleString(),    icon: Users },
                { label: 'New Users',       value: report.engagement.newUsers.toLocaleString(), icon: TrendingUp },
                { label: 'Sessions',        value: report.engagement.sessions.toLocaleString(), icon: Globe },
                { label: 'Avg. Duration',   value: fmtDuration(report.engagement.avgDuration), icon: MousePointer },
                { label: 'Engagement Rate', value: `${report.engagement.engagementRate}%`,     icon: Check },
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

            {/* ── Traffic chart ── */}
            <div className="seo-section">
              <h3 className="seo-section__title">Website Traffic</h3>
              <div className="seo-chart-wrap">
                {report.traffic.map((row) => (
                  <div key={row.date} className="seo-bar-col" title={`${row.date} — ${row.users} users, ${row.sessions} sessions`}>
                    <div className="seo-bar-stack">
                      <div className="seo-bar seo-bar--sessions" style={{ height: `${(row.sessions / maxUsers) * 100}%` }} />
                      <div className="seo-bar seo-bar--users"    style={{ height: `${(row.users   / maxUsers) * 100}%` }} />
                    </div>
                    {report.traffic.length <= 28 && <span className="seo-bar-label">{fmtDate(row.date)}</span>}
                  </div>
                ))}
              </div>
              <div className="seo-legend">
                <span className="seo-legend__dot seo-legend__dot--users" /> Users
                <span className="seo-legend__dot seo-legend__dot--sessions" style={{ marginLeft: 16 }} /> Sessions
              </div>
            </div>

            {/* ── Acquisition + Demographics ── */}
            <div className="seo-two-col">
              <div className="seo-section">
                <h3 className="seo-section__title">User Acquisition</h3>
                <table className="seo-table">
                  <thead><tr><th>Channel</th><th>Sessions</th><th>Users</th><th></th></tr></thead>
                  <tbody>
                    {report.acquisition.map((row, i) => (
                      <tr key={i}>
                        <td><span className="seo-source">{row.channel}</span></td>
                        <td>{row.sessions.toLocaleString()}</td>
                        <td>{row.users.toLocaleString()}</td>
                        <td>
                          <div className="seo-bar-inline">
                            <div style={{ width: `${(row.sessions / maxAcq) * 100}%` }} className="seo-bar-inline__fill" />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="seo-section">
                <h3 className="seo-section__title"><MapPin size={13} style={{ marginRight: 6 }} />Demographics — Cities</h3>
                <table className="seo-table">
                  <thead><tr><th>City</th><th>Users</th><th>Sessions</th><th></th></tr></thead>
                  <tbody>
                    {report.demographics.map((row, i) => (
                      <tr key={i}>
                        <td className="seo-source">{row.city}</td>
                        <td>{row.users.toLocaleString()}</td>
                        <td>{row.sessions.toLocaleString()}</td>
                        <td>
                          <div className="seo-bar-inline">
                            <div style={{ width: `${(row.users / maxDemo) * 100}%` }} className="seo-bar-inline__fill seo-bar-inline__fill--green" />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ── Pages & Screens + Top Queries ── */}
            <div className="seo-two-col">
              <div className="seo-section">
                <h3 className="seo-section__title">Pages & Screens <span className="seo-badge">Search Console</span></h3>
                {report.pages.length > 0
                  ? <table className="seo-table">
                      <thead><tr><th>Page</th><th>Clicks</th><th>Impressions</th><th>CTR</th><th>Pos.</th></tr></thead>
                      <tbody>
                        {report.pages.slice(0, 6).map((row, i) => (
                          <tr key={i}>
                            <td className="seo-page-url" title={row.page}>{shortenUrl(row.page)}</td>
                            <td>{row.clicks.toLocaleString()}</td>
                            <td>{row.impressions.toLocaleString()}</td>
                            <td>{row.ctr}%</td>
                            <td>{row.position}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  : <p className="page-subtitle" style={{ padding: '12px 0' }}>No GSC site URL configured.</p>}
              </div>

              <div className="seo-section">
                <h3 className="seo-section__title"><Search size={13} style={{ marginRight: 6 }} />Top Queries <span className="seo-badge">Search Console</span></h3>
                {report.queries.length > 0
                  ? <table className="seo-table">
                      <thead><tr><th>Query</th><th>Clicks</th><th>Impr.</th><th>CTR</th><th>Pos.</th></tr></thead>
                      <tbody>
                        {report.queries.slice(0, 10).map((row, i) => (
                          <tr key={i}>
                            <td className="seo-page-url" title={row.query}>{row.query}</td>
                            <td>{row.clicks.toLocaleString()}</td>
                            <td>{row.impressions.toLocaleString()}</td>
                            <td>{row.ctr}%</td>
                            <td>{row.position}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  : <p className="page-subtitle" style={{ padding: '12px 0' }}>No query data available.</p>}
              </div>
            </div>

            {/* ── Keyword Rankings (manual) ── */}
            <div className="seo-section">
              <h3 className="seo-section__title">
                Keyword Rankings
                {canEdit && (
                  <button className="seo-manual-edit-btn" onClick={() => openManualPanel(manualPanel === 'keywords' ? null : 'keywords')}>
                    <Edit2 size={11} /> {manualPanel === 'keywords' ? 'Cancel' : 'Edit'}
                  </button>
                )}
              </h3>

              {manualPanel === 'keywords' && canEdit && (
                <div className="seo-manual-panel">
                  {manualEdit.keyword_rankings.map((kw, i) => (
                    <div key={i} className="seo-manual-row">
                      <input className="form-input seo-manual-input" placeholder="Keyword" value={kw.keyword}
                        onChange={(e) => { const a = [...manualEdit.keyword_rankings]; a[i] = { ...a[i], keyword: e.target.value }; setManualEdit({ ...manualEdit, keyword_rankings: a }); }} />
                      <input className="form-input seo-manual-input seo-manual-input--sm" placeholder="Rank" type="number" min={1} value={kw.rank}
                        onChange={(e) => { const a = [...manualEdit.keyword_rankings]; a[i] = { ...a[i], rank: Number(e.target.value) }; setManualEdit({ ...manualEdit, keyword_rankings: a }); }} />
                      <input className="form-input seo-manual-input seo-manual-input--sm" placeholder="±Change" type="number" value={kw.change}
                        onChange={(e) => { const a = [...manualEdit.keyword_rankings]; a[i] = { ...a[i], change: Number(e.target.value) }; setManualEdit({ ...manualEdit, keyword_rankings: a }); }} />
                      <button className="seo-manual-del" onClick={() => { const a = manualEdit.keyword_rankings.filter((_, j) => j !== i); setManualEdit({ ...manualEdit, keyword_rankings: a }); }}><Trash2 size={13} /></button>
                    </div>
                  ))}
                  <div className="seo-manual-actions">
                    <button className="seo-manual-add" onClick={() => setManualEdit({ ...manualEdit, keyword_rankings: [...manualEdit.keyword_rankings, { keyword: '', rank: 1, change: 0 }] })}>
                      <Plus size={12} /> Add keyword
                    </button>
                    <button className="seo-inline-save" onClick={saveManual} disabled={manualSaving}>{manualSaving ? 'Saving…' : 'Save'}</button>
                  </div>
                </div>
              )}

              {manual.keyword_rankings.length > 0
                ? <table className="seo-table">
                    <thead><tr><th>#</th><th>Keyword</th><th>Rank</th><th>Change</th></tr></thead>
                    <tbody>
                      {manual.keyword_rankings.map((kw, i) => (
                        <tr key={i}>
                          <td className="seo-medium">{i + 1}</td>
                          <td className="seo-source">{kw.keyword}</td>
                          <td><span className="seo-rank-badge">#{kw.rank}</span></td>
                          <td>
                            {kw.change > 0 && <span className="seo-change seo-change--up">▲ {kw.change}</span>}
                            {kw.change < 0 && <span className="seo-change seo-change--down">▼ {Math.abs(kw.change)}</span>}
                            {kw.change === 0 && <span className="seo-change">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                : !manualPanel && <p className="page-subtitle" style={{ padding: '12px 0' }}>{canEdit ? 'Click Edit to add keyword rankings.' : 'No keyword data yet.'}</p>}
            </div>

            {/* ── Targets ── */}
            <div className="seo-section">
              <h3 className="seo-section__title">
                Targets — Achieved vs Set
                {canEdit && (
                  <button className="seo-manual-edit-btn" onClick={() => openManualPanel(manualPanel === 'targets' ? null : 'targets')}>
                    <Edit2 size={11} /> {manualPanel === 'targets' ? 'Cancel' : 'Edit'}
                  </button>
                )}
              </h3>

              {manualPanel === 'targets' && canEdit && (
                <div className="seo-manual-panel">
                  {manualEdit.targets.map((t, i) => (
                    <div key={i} className="seo-manual-row">
                      <input className="form-input seo-manual-input" placeholder="Target name" value={t.name}
                        onChange={(e) => { const a = [...manualEdit.targets]; a[i] = { ...a[i], name: e.target.value }; setManualEdit({ ...manualEdit, targets: a }); }} />
                      <input className="form-input seo-manual-input seo-manual-input--sm" placeholder="Target" type="number" value={t.target}
                        onChange={(e) => { const a = [...manualEdit.targets]; a[i] = { ...a[i], target: Number(e.target.value) }; setManualEdit({ ...manualEdit, targets: a }); }} />
                      <input className="form-input seo-manual-input seo-manual-input--sm" placeholder="Achieved" type="number" value={t.achieved}
                        onChange={(e) => { const a = [...manualEdit.targets]; a[i] = { ...a[i], achieved: Number(e.target.value) }; setManualEdit({ ...manualEdit, targets: a }); }} />
                      <input className="form-input seo-manual-input seo-manual-input--xs" placeholder="Unit" value={t.unit}
                        onChange={(e) => { const a = [...manualEdit.targets]; a[i] = { ...a[i], unit: e.target.value }; setManualEdit({ ...manualEdit, targets: a }); }} />
                      <button className="seo-manual-del" onClick={() => { const a = manualEdit.targets.filter((_, j) => j !== i); setManualEdit({ ...manualEdit, targets: a }); }}><Trash2 size={13} /></button>
                    </div>
                  ))}
                  <div className="seo-manual-actions">
                    <button className="seo-manual-add" onClick={() => setManualEdit({ ...manualEdit, targets: [...manualEdit.targets, { name: '', target: 0, achieved: 0, unit: '' }] })}>
                      <Plus size={12} /> Add target
                    </button>
                    <button className="seo-inline-save" onClick={saveManual} disabled={manualSaving}>{manualSaving ? 'Saving…' : 'Save'}</button>
                  </div>
                </div>
              )}

              {manual.targets.length > 0
                ? <div className="seo-targets-list">
                    {manual.targets.map((t, i) => {
                      const pct = t.target > 0 ? Math.min(100, Math.round((t.achieved / t.target) * 100)) : 0;
                      const done = pct >= 100;
                      return (
                        <div key={i} className="seo-target-row">
                          <div className="seo-target-header">
                            <span className="seo-source">{t.name}</span>
                            <span className="seo-target-nums">{t.achieved.toLocaleString()}{t.unit && ` ${t.unit}`} / {t.target.toLocaleString()}{t.unit && ` ${t.unit}`}</span>
                            <span className={`seo-target-pct${done ? ' seo-target-pct--done' : ''}`}>{pct}%</span>
                          </div>
                          <div className="seo-target-bar">
                            <div className={`seo-target-bar__fill${done ? ' seo-target-bar__fill--done' : ''}`} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                : !manualPanel && <p className="page-subtitle" style={{ padding: '12px 0' }}>{canEdit ? 'Click Edit to add targets.' : 'No targets set yet.'}</p>}
            </div>

            {/* ── GMB + LinkedIn + Organic Submissions ── */}
            <div className="seo-two-col">
              <div className="seo-section">
                <h3 className="seo-section__title">
                  <Star size={13} style={{ marginRight: 6 }} />GMB &amp; LinkedIn
                  {canEdit && (
                    <button className="seo-manual-edit-btn" onClick={() => openManualPanel(manualPanel === 'gmb' ? null : 'gmb')}>
                      <Edit2 size={11} /> {manualPanel === 'gmb' ? 'Cancel' : 'Edit'}
                    </button>
                  )}
                </h3>

                {manualPanel === 'gmb' && canEdit && (
                  <div className="seo-manual-panel">
                    <div className="seo-manual-grid">
                      <div className="seo-inline-field">
                        <label className="seo-inline-label">GMB Rating</label>
                        <input className="form-input seo-inline-input" placeholder="4.5" type="number" step="0.1" min="0" max="5"
                          value={manualEdit.gmb_rating ?? ''} onChange={(e) => setManualEdit({ ...manualEdit, gmb_rating: e.target.value ? Number(e.target.value) : null })} />
                      </div>
                      <div className="seo-inline-field">
                        <label className="seo-inline-label">GMB Reviews</label>
                        <input className="form-input seo-inline-input" placeholder="120" type="number"
                          value={manualEdit.gmb_reviews ?? ''} onChange={(e) => setManualEdit({ ...manualEdit, gmb_reviews: e.target.value ? Number(e.target.value) : null })} />
                      </div>
                      <div className="seo-inline-field">
                        <label className="seo-inline-label">GMB Profile URL</label>
                        <input className="form-input seo-inline-input" placeholder="https://g.page/…"
                          value={manualEdit.gmb_profile_url} onChange={(e) => setManualEdit({ ...manualEdit, gmb_profile_url: e.target.value })} />
                      </div>
                      <div className="seo-inline-field">
                        <label className="seo-inline-label">LinkedIn URL</label>
                        <input className="form-input seo-inline-input" placeholder="https://linkedin.com/company/…"
                          value={manualEdit.linkedin_url} onChange={(e) => setManualEdit({ ...manualEdit, linkedin_url: e.target.value })} />
                      </div>
                      <div className="seo-inline-field">
                        <label className="seo-inline-label">LinkedIn Followers</label>
                        <input className="form-input seo-inline-input" placeholder="500" type="number"
                          value={manualEdit.linkedin_followers ?? ''} onChange={(e) => setManualEdit({ ...manualEdit, linkedin_followers: e.target.value ? Number(e.target.value) : null })} />
                      </div>
                      <div className="seo-inline-field">
                        <label className="seo-inline-label">Organic Submissions</label>
                        <input className="form-input seo-inline-input" placeholder="0" type="number"
                          value={manualEdit.organic_submissions} onChange={(e) => setManualEdit({ ...manualEdit, organic_submissions: Number(e.target.value) })} />
                      </div>
                    </div>
                    <div className="seo-manual-actions" style={{ marginTop: 12 }}>
                      <button className="seo-inline-save" onClick={saveManual} disabled={manualSaving}>{manualSaving ? 'Saving…' : 'Save'}</button>
                    </div>
                  </div>
                )}

                <div className="seo-gmb-grid">
                  {manual.gmb_rating != null && (
                    <div className="seo-gmb-card">
                      <Star size={14} className="seo-gmb-icon seo-gmb-icon--star" />
                      <div>
                        <p className="seo-card__val">{manual.gmb_rating.toFixed(1)}</p>
                        <p className="seo-card__label">GMB Rating</p>
                      </div>
                    </div>
                  )}
                  {manual.gmb_reviews != null && (
                    <div className="seo-gmb-card">
                      <FileText size={14} className="seo-gmb-icon" />
                      <div>
                        <p className="seo-card__val">{manual.gmb_reviews.toLocaleString()}</p>
                        <p className="seo-card__label">GMB Reviews</p>
                      </div>
                    </div>
                  )}
                  {manual.linkedin_followers != null && (
                    <div className="seo-gmb-card">
                      <Linkedin size={14} className="seo-gmb-icon seo-gmb-icon--li" />
                      <div>
                        <p className="seo-card__val">{manual.linkedin_followers.toLocaleString()}</p>
                        <p className="seo-card__label">LinkedIn Followers</p>
                      </div>
                    </div>
                  )}
                </div>
                <div className="seo-gmb-links">
                  {manual.gmb_profile_url && <a href={manual.gmb_profile_url} target="_blank" rel="noreferrer" className="seo-gmb-link"><Star size={11} /> GMB Profile</a>}
                  {manual.linkedin_url    && <a href={manual.linkedin_url}    target="_blank" rel="noreferrer" className="seo-gmb-link"><Linkedin size={11} /> LinkedIn Page</a>}
                </div>
                {!manual.gmb_rating && !manual.gmb_reviews && !manual.linkedin_followers && !manual.gmb_profile_url && !manual.linkedin_url && !manualPanel && (
                  <p className="page-subtitle" style={{ padding: '4px 0 8px' }}>{canEdit ? 'Click Edit to add GMB & LinkedIn data.' : 'No data yet.'}</p>
                )}
              </div>

              <div className="seo-section">
                <h3 className="seo-section__title"><FileText size={13} style={{ marginRight: 6 }} />Organic Form Submissions</h3>
                <div className="seo-organic-wrap">
                  <p className="seo-card__val seo-organic-val">{manual.organic_submissions.toLocaleString()}</p>
                  <p className="seo-card__label">Total submissions this period</p>
                  {canEdit && (
                    <div className="seo-organic-edit">
                      <input
                        className="form-input"
                        type="number"
                        min={0}
                        placeholder="0"
                        style={{ width: 120, fontSize: 13 }}
                        defaultValue={manual.organic_submissions}
                        key={manual.organic_submissions}
                        onBlur={(e) => {
                          const val = Number(e.target.value);
                          if (val !== manual.organic_submissions) {
                            seoApi.updateManual(selectedClient!.id, { ...manual, organic_submissions: val })
                              .then(() => setManual({ ...manual, organic_submissions: val }))
                              .catch(() => {});
                          }
                        }}
                      />
                      <span className="seo-hint">Tab / click away to save</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
