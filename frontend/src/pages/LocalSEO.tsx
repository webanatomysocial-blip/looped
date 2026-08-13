import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { RiMapPin2Line, RiSearchLine, RiRefreshLine, RiAddLine, RiCloseLine, RiSettings3Line, RiDownloadLine } from 'react-icons/ri';
import Layout from '../components/Layout/Layout';
import { useAuth } from '../contexts/AuthContext';
import { usersApi, localSeoApi, appSettingsApi } from '../services/api';
import '../css/pages/LocalSEO.css';

interface GridPoint {
  lat: number;
  lng: number;
  row: number;
  col: number;
  location: string;
  position: number | null;
  url: string | null;
  title: string | null;
}

interface Config {
  domain: string;
  address: string;
  country_code: string;
  radius_km: number;
  grid_size: number;
}

function posColor(pos: number | null): string {
  if (pos === null) return '#9ca3af';
  if (pos === 1) return '#f59e0b';
  if (pos <= 3) return '#16a34a';
  if (pos <= 10) return '#2563eb';
  if (pos <= 20) return '#ea580c';
  return '#dc2626';
}

function makeIcon(pos: number | null) {
  const color = posColor(pos);
  const label = pos === null ? '—' : String(pos);
  const fs = label.length > 2 ? 9 : label.length > 1 ? 11 : 13;
  const svg = `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
    <circle cx="16" cy="16" r="14" fill="${color}" stroke="white" stroke-width="2"/>
    <text x="16" y="16" text-anchor="middle" dominant-baseline="central"
      font-family="system-ui,sans-serif" font-size="${fs}" font-weight="700" fill="white">${label}</text>
  </svg>`;
  return L.divIcon({ html: svg, className: '', iconSize: [32, 32], iconAnchor: [16, 16] });
}

const COUNTRIES = [
  { code: 'in', label: '🇮🇳 India' },
  { code: 'us', label: '🇺🇸 USA' },
  { code: 'gb', label: '🇬🇧 UK' },
  { code: 'au', label: '🇦🇺 Australia' },
  { code: 'ae', label: '🇦🇪 UAE' },
  { code: 'sg', label: '🇸🇬 Singapore' },
  { code: 'ca', label: '🇨🇦 Canada' },
];

export default function LocalSEO() {
  const { user } = useAuth();
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);
  const markers = useRef<L.Marker[]>([]);

  const [clients, setClients] = useState<{ id: number; name: string }[]>([]);
  const [clientId, setClientId] = useState<number | null>(null);
  const [config, setConfig] = useState<Config>({ domain: '', address: '', country_code: 'in', radius_km: 10, grid_size: 7 });
  const [showSettings, setShowSettings] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [serperKey, setSerperKey] = useState('');
  const [showSerperKey, setShowSerperKey] = useState(false);

  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState('');

  const [keywords, setKeywords] = useState<string[]>([]);
  const [activeKeyword, setActiveKeyword] = useState('');
  const [kwInput, setKwInput] = useState('');

  const [points, setPoints] = useState<GridPoint[]>([]);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState('');
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  const total = points.length;
  const notOut = points.filter((p) => p.position !== null);
  const high  = points.filter((p) => p.position !== null && p.position <= 3).length;
  const med   = points.filter((p) => p.position !== null && p.position > 3 && p.position <= 10).length;
  const low   = points.filter((p) => p.position !== null && p.position > 10).length;
  const out   = points.filter((p) => p.position === null).length;
  const avgRank = notOut.length
    ? (notOut.reduce((s, p) => s + p.position!, 0) / notOut.length).toFixed(2)
    : '—';

  // Init map once
  useEffect(() => {
    if (!mapRef.current || leafletMap.current) return;
    leafletMap.current = L.map(mapRef.current, { center: [20.5937, 78.9629], zoom: 5 });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(leafletMap.current);
    return () => {
      leafletMap.current?.remove();
      leafletMap.current = null;
    };
  }, []);

  // Update markers when points change
  useEffect(() => {
    markers.current.forEach((m) => m.remove());
    markers.current = [];
    if (!leafletMap.current) return;
    points.forEach((p) => {
      const m = L.marker([p.lat, p.lng], { icon: makeIcon(p.position) })
        .bindPopup(`<div style="font-size:13px;min-width:150px">
          <strong>${p.position ? '#' + p.position : 'Not found'}</strong><br/>
          <span style="color:#6b7280;font-size:11px">${p.location}</span>
          ${p.title ? `<br/><span style="font-size:11px">${p.title}</span>` : ''}
          ${p.url ? `<br/><a href="${p.url}" target="_blank" style="font-size:11px;color:#6366f1">View page</a>` : ''}
        </div>`)
        .addTo(leafletMap.current!);
      markers.current.push(m);
    });
  }, [points]);

  // Fly to center when it changes
  useEffect(() => {
    if (center && leafletMap.current) {
      leafletMap.current.flyTo([center.lat, center.lng], 11, { duration: 1 });
    }
  }, [center]);

  // Load clients
  useEffect(() => {
    usersApi.companies().then((r) => {
      const list = r.data || [];
      setClients(list);
      if (list.length) setClientId(list[0].id);
    }).catch(() => {});
  }, []);

  // Load config + keywords when client changes
  useEffect(() => {
    if (!clientId) return;
    localSeoApi.getConfig(clientId).then((r) => {
      const d = r.data;
      setConfig({ domain: d.domain || '', address: d.address || '', country_code: d.country_code || 'in', radius_km: d.radius_km || 10, grid_size: d.grid_size || 7 });
    }).catch(() => {});
    localSeoApi.getKeywords(clientId).then((r) => setKeywords(r.data || [])).catch(() => {});
    setPoints([]);
    setActiveKeyword('');
    setCenter(null);
  }, [clientId]);

  // Geocode directly via Nominatim (no backend hop)
  const geoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!config.address) return;
    if (geoTimer.current) clearTimeout(geoTimer.current);
    geoTimer.current = setTimeout(async () => {
      setGeocoding(true);
      setGeocodeError('');
      // Try progressively shorter segments (handles GMB full addresses with business name)
      const parts = config.address.split(',').map((s) => s.trim()).filter(Boolean);
      const candidates = parts.map((_, i) => parts.slice(i).join(', '));
      let found = false;
      for (const q of candidates) {
        if (q.length < 3) continue;
        try {
          const resp = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`,
            { headers: { 'User-Agent': 'AgencyLSEO/1.0' } }
          );
          const data = await resp.json();
          if (data.length) {
            setCenter({ lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) });
            // Auto-detect country code from address details
            const detailResp = await fetch(
              `https://nominatim.openstreetmap.org/reverse?lat=${data[0].lat}&lon=${data[0].lon}&format=json`,
              { headers: { 'User-Agent': 'AgencyLSEO/1.0' } }
            );
            const detail = await detailResp.json();
            const cc = (detail.address?.country_code || '').toLowerCase();
            if (cc) setConfig((prev) => ({ ...prev, country_code: cc }));
            setGeocodeError('');
            found = true;
            break;
          }
        } catch { break; }
      }
      if (!found) setGeocodeError('Address not found — try a shorter address like "Rhymney, Wales, UK"');
      setGeocoding(false);
    }, 900);
    return () => { if (geoTimer.current) clearTimeout(geoTimer.current); };
  }, [config.address]);

  async function saveConfig() {
    if (!clientId) return;
    setSavingConfig(true);
    await Promise.all([
      localSeoApi.saveConfig(clientId, { ...config, keywords, locations: [] }),
      serperKey ? appSettingsApi.save({ serper_api_key: serperKey }) : Promise.resolve(),
    ]);
    setSavingConfig(false);
    setShowSettings(false);
  }

  function addKeyword() {
    const v = kwInput.trim();
    if (!v) return;
    setKwInput('');
    if (!keywords.includes(v)) setKeywords((prev) => [...prev, v]);
    runCheck(v);
  }

  function removeKeyword(kw: string) {
    setKeywords((prev) => prev.filter((k) => k !== kw));
    if (activeKeyword === kw) { setActiveKeyword(''); setPoints([]); }
  }

  async function runCheck(kw: string) {
    if (!clientId || !config.domain || !config.address) {
      setCheckError('Open Settings and enter your domain + address first.');
      setShowSettings(true);
      return;
    }
    if (!center) { setCheckError('Still geocoding address…'); return; }
    setActiveKeyword(kw);
    setChecking(true);
    setCheckError('');
    setPoints([]);

    // Try cache only if it has actual ranked results (skip all-null cache)
    try {
      const cached = await localSeoApi.getGeogrid(clientId, kw);
      const cachedResults: GridPoint[] = cached.data?.results || [];
      const hasRanked = cachedResults.some((p) => p.position !== null);
      if (cached.data && hasRanked) {
        setPoints(cachedResults);
        setCheckedAt(cached.data.checked_at);
        if (cached.data.center_lat) setCenter({ lat: cached.data.center_lat, lng: cached.data.center_lng });
        setChecking(false);
        return;
      }
    } catch { /* no cache */ }

    try {
      const r = await localSeoApi.runGeogrid(clientId, {
        keyword: kw, center_lat: center.lat, center_lng: center.lng,
        radius_km: config.radius_km, grid_size: config.grid_size,
        country_code: config.country_code, domain: config.domain,
      });
      setPoints(r.data.results || []);
      setCheckedAt(r.data.checkedAt);
    } catch (err: any) {
      setCheckError(err.response?.data?.error || 'Check failed.');
    }
    setChecking(false);
  }

  function downloadCsv() {
    if (!points.length) return;
    const rows = [
      ['Keyword', 'Location', 'Position', 'URL', 'Title', 'Checked At'],
      ...points.map((p) => [
        activeKeyword,
        p.location,
        p.position ?? 'Not found',
        p.url ?? '',
        p.title ?? '',
        checkedAt ?? '',
      ]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lseo-${activeKeyword.replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function recheck() {
    if (!activeKeyword || !clientId || !center) return;
    setChecking(true);
    setCheckError('');
    try {
      const r = await localSeoApi.runGeogrid(clientId, {
        keyword: activeKeyword, center_lat: center.lat, center_lng: center.lng,
        radius_km: config.radius_km, grid_size: config.grid_size,
        country_code: config.country_code, domain: config.domain,
      });
      setPoints(r.data.results || []);
      setCheckedAt(r.data.checkedAt);
    } catch (err: any) {
      setCheckError(err.response?.data?.error || 'Check failed.');
    }
    setChecking(false);
  }

  return (
    <Layout>
      <div className="lseo-page lseo-map-layout">
        {/* Sidebar */}
        <div className="lseo-sidebar">
          <div className="lseo-sidebar-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <RiMapPin2Line size={16} />
              <span style={{ fontWeight: 700, fontSize: 14 }}>Local SEO Rank Tracker</span>
            </div>
            <select className="lseo-client-select" style={{ width: '100%' }} value={clientId ?? ''} onChange={(e) => setClientId(Number(e.target.value))}>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {/* Stats */}
          {activeKeyword && (
            <div className="lseo-stats-card">
              <div className="lseo-stats-avg">
                <span className="lseo-stats-avg-num">{avgRank}</span>
                <svg width="48" height="48" viewBox="0 0 48 48">
                  <circle cx="24" cy="24" r="20" fill="none" stroke="#e5e7eb" strokeWidth="4"/>
                  <circle cx="24" cy="24" r="20" fill="none" stroke="#16a34a" strokeWidth="4"
                    strokeDasharray={`${Math.max(0, (1 - out / Math.max(total, 1)) * 125.7)} 125.7`}
                    strokeLinecap="round" transform="rotate(-90 24 24)"/>
                </svg>
              </div>
              <div className="lseo-stats-label">Avg. Rank</div>
              <div className="lseo-stats-row">
                <span className="lseo-stats-pill lseo-stats-pill--high">● High {high}</span>
                <span className="lseo-stats-pill lseo-stats-pill--med">● Med {med}</span>
                <span className="lseo-stats-pill lseo-stats-pill--low">● Low {low}</span>
                <span className="lseo-stats-pill lseo-stats-pill--out">○ Out {out}</span>
              </div>
              <div className="lseo-stats-keyword">{activeKeyword}</div>
              {checkedAt && (
                <div style={{ fontSize: 10, color: 'var(--ink-muted)', marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                  {new Date(checkedAt).toLocaleString()}
                  <button className="lseo-recheck-btn" onClick={recheck} disabled={checking} title="Re-check">
                    <RiRefreshLine size={12} style={{ animation: checking ? 'spin 1s linear infinite' : 'none' }} />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Keywords */}
          <div className="lseo-kw-section">
            <div className="lseo-kw-label">Keywords</div>
            <div className="lseo-add-row">
              <input
                placeholder="e.g. dentist near me"
                value={kwInput}
                onChange={(e) => setKwInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addKeyword()}
              />
              <button className="lseo-add-btn" onClick={addKeyword} disabled={!kwInput.trim() || checking}>
                <RiAddLine size={14} />
              </button>
            </div>
            <div className="lseo-kw-list">
              {keywords.map((kw) => (
                <div key={kw} className={`lseo-kw-item${activeKeyword === kw ? ' active' : ''}`} onClick={() => !checking && runCheck(kw)}>
                  <RiSearchLine size={12} />
                  <span>{kw}</span>
                  <button className="lseo-kw-del" onClick={(e) => { e.stopPropagation(); removeKeyword(kw); }}><RiCloseLine size={12} /></button>
                </div>
              ))}
              {!keywords.length && <div style={{ fontSize: 12, color: 'var(--ink-muted)', padding: '6px 0' }}>Add a keyword above to start</div>}
            </div>
          </div>

          <div className="lseo-bottom-btns">
            {checkError && <div style={{ fontSize: 11, color: '#ef4444' }}>{checkError}</div>}
            <button className="lseo-csv-btn" onClick={downloadCsv} disabled={!points.length}>
              <RiDownloadLine size={13} /> Download CSV
            </button>
            <button className="lseo-settings-btn" onClick={() => {
              if (!showSettings) appSettingsApi.get().then((r) => setSerperKey(r.data.serper_api_key || '')).catch(() => {});
              setShowSettings(!showSettings);
            }}>
              <RiSettings3Line size={13} /> Settings
            </button>
          </div>

          {showSettings && (
            <div className="lseo-settings-panel">
              <div className="lseo-settings-field">
                <label>Domain</label>
                <input placeholder="webanatomy.in" value={config.domain} onChange={(e) => setConfig({ ...config, domain: e.target.value })} />
              </div>
              <div className="lseo-settings-field">
                <label>Business Address</label>
                <input placeholder="123 Main St, Hyderabad, India" value={config.address} onChange={(e) => setConfig({ ...config, address: e.target.value })} />
                {geocoding && <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>Locating…</span>}
                {geocodeError && <span style={{ fontSize: 11, color: '#ef4444' }}>{geocodeError}</span>}
                {center && !geocoding && <span style={{ fontSize: 11, color: '#16a34a' }}>✓ {center.lat.toFixed(4)}, {center.lng.toFixed(4)}</span>}
              </div>
              <div className="lseo-settings-row">
                <div className="lseo-settings-field">
                  <label>Radius (km)</label>
                  <input type="number" min={1} max={50} value={config.radius_km} onChange={(e) => setConfig({ ...config, radius_km: Number(e.target.value) })} />
                </div>
                <div className="lseo-settings-field">
                  <label>Grid</label>
                  <select value={config.grid_size} onChange={(e) => setConfig({ ...config, grid_size: Number(e.target.value) })}>
                    <option value={5}>5×5</option>
                    <option value={7}>7×7</option>
                    <option value={9}>9×9</option>
                  </select>
                </div>
              </div>
              <div className="lseo-settings-field" style={{ marginTop: 8, borderTop: '1px solid var(--sand-border)', paddingTop: 10 }}>
                <label>Serper.dev API Key</label>
                <div style={{ display: 'flex', gap: 4 }}>
                  <input
                    type={showSerperKey ? 'text' : 'password'}
                    placeholder="Your Serper.dev API key"
                    value={serperKey}
                    onChange={(e) => setSerperKey(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button type="button" style={{ background: 'none', border: '1px solid var(--sand-border)', borderRadius: 6, padding: '0 8px', cursor: 'pointer', color: 'var(--ink-muted)' }} onClick={() => setShowSerperKey(!showSerperKey)}>
                    {showSerperKey ? '🙈' : '👁️'}
                  </button>
                </div>
              </div>
              <button className="btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={saveConfig} disabled={savingConfig}>
                {savingConfig ? 'Saving…' : 'Save Settings'}
              </button>
            </div>
          )}
        </div>

        {/* Map */}
        <div className="lseo-map-wrap">
          {checking && (
            <div className="lseo-map-overlay">
              <div className="lseo-map-loading">
                <RiRefreshLine size={24} style={{ animation: 'spin 1s linear infinite' }} />
                <div>Checking "{activeKeyword}"…</div>
                <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>~{Math.ceil(config.grid_size * config.grid_size * 1.5 / 60)} min</div>
              </div>
            </div>
          )}

          <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

          <div className="lseo-map-legend">
            {[
              { color: '#f59e0b', label: '#1' },
              { color: '#16a34a', label: 'Top 3' },
              { color: '#2563eb', label: 'Top 10' },
              { color: '#ea580c', label: 'Top 20' },
              { color: '#dc2626', label: '21+' },
              { color: '#9ca3af', label: 'Not found' },
            ].map((item) => (
              <div key={item.label} className="lseo-legend-item">
                <span className="lseo-legend-dot" style={{ background: item.color }} />
                {item.label}
              </div>
            ))}
          </div>

          {!center && !checking && (
            <div className="lseo-map-empty">
              <RiMapPin2Line size={28} style={{ marginBottom: 8 }} />
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Set up your business</div>
              <div style={{ fontSize: 12 }}>Open Settings → enter domain + address, then add a keyword</div>
            </div>
          )}
        </div>
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </Layout>
  );
}
