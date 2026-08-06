import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

const API = '/api';

interface ManualCampaign {
  name: string; reach: string; impressions: string; clicks: string;
  leads: string; cost_per_lead: string; cost: string;
}
interface CampaignGroup { campaigns: ManualCampaign[]; key_insights: string; }
interface AdsManualData { notes: string; google: CampaignGroup; linkedin: CampaignGroup; meta: CampaignGroup; }

const emptyGroup = (): CampaignGroup => ({ campaigns: [], key_insights: '' });
const parseData = (raw: any): AdsManualData => {
  const base = { notes: raw?.notes || '', google: emptyGroup(), linkedin: emptyGroup(), meta: emptyGroup() };
  const cm = raw?.campaigns_manual;
  if (cm && typeof cm === 'object' && !Array.isArray(cm)) {
    if (cm.google)   base.google   = { ...emptyGroup(), ...cm.google };
    if (cm.linkedin) base.linkedin = { ...emptyGroup(), ...cm.linkedin };
    if (cm.meta)     base.meta     = { ...emptyGroup(), ...cm.meta };
  }
  return base;
};

const fmtNum = (n: number) => n > 0 ? n.toLocaleString('en-IN') : '—';
const fmtCur = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const calcTotals = (g: CampaignGroup) =>
  g.campaigns.reduce((a, c) => ({
    reach: a.reach + (Number(c.reach) || 0),
    impressions: a.impressions + (Number(c.impressions) || 0),
    clicks: a.clicks + (Number(c.clicks) || 0),
    leads: a.leads + (Number(c.leads) || 0),
    cost: a.cost + (Number(c.cost) || 0),
  }), { reach: 0, impressions: 0, clicks: 0, leads: 0, cost: 0 });

const calcAvgCpl = (g: CampaignGroup) => {
  const cpls = g.campaigns.map((c) => Number(c.cost_per_lead) || null).filter((v): v is number => v !== null);
  return cpls.length > 0 ? cpls.reduce((a, b) => a + b, 0) / cpls.length : null;
};

const GROUPS: { key: keyof Pick<AdsManualData, 'google' | 'linkedin' | 'meta'>; label: string }[] = [
  { key: 'google', label: 'Google Ads' },
  { key: 'linkedin', label: 'LinkedIn Ads' },
  { key: 'meta', label: 'Meta Ads' },
];

export default function ShareAdsReport() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [clientName, setClientName] = useState('');
  const [period, setPeriod] = useState('');
  const [data, setData] = useState<AdsManualData>({ notes: '', google: emptyGroup(), linkedin: emptyGroup(), meta: emptyGroup() });

  useEffect(() => {
    document.documentElement.style.overflow = 'auto';
    document.body.style.overflow = 'auto';
    return () => {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    };
  }, []);

  useEffect(() => {
    fetch(`${API}/public/ads/${token}`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((r) => {
        setClientName(r.clientName);
        setPeriod(r.startDate && r.endDate ? `${r.startDate} → ${r.endDate}` : r.startDate || r.endDate || '');
        setData(parseData(r.data));
        setLoading(false);
      })
      .catch(() => { setError('This report link is invalid or has been revoked.'); setLoading(false); });
  }, [token]);

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'sans-serif', color: '#64748b' }}>Loading…</div>;
  if (error)   return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'sans-serif', color: '#ef4444' }}>{error}</div>;

  const allCampaigns = [...data.google.campaigns, ...data.linkedin.campaigns, ...data.meta.campaigns];
  const overall = allCampaigns.reduce((a, c) => ({
    reach: a.reach + (Number(c.reach) || 0),
    impressions: a.impressions + (Number(c.impressions) || 0),
    clicks: a.clicks + (Number(c.clicks) || 0),
    leads: a.leads + (Number(c.leads) || 0),
    cost: a.cost + (Number(c.cost) || 0),
  }), { reach: 0, impressions: 0, clicks: 0, leads: 0, cost: 0 });
  const overallCpl = calcAvgCpl({ campaigns: allCampaigns, key_insights: '' });

  const thStyle: React.CSSProperties = { padding: '8px 10px', textAlign: 'left', fontWeight: 700, fontSize: 12, background: '#1e3a5f', color: '#fff', whiteSpace: 'nowrap' };
  const tdStyle: React.CSSProperties = { padding: '7px 10px', fontSize: 12, borderBottom: '1px solid #e8edf5' };

  return (
    <div style={{ fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', color: '#1a1a1a', background: '#f8fafc', minHeight: '100vh', padding: '0 0 60px' }}>
      {/* Header */}
      <div style={{ background: '#1e3a5f', color: '#fff', padding: '20px 32px' }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Ads Analytics Report</h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, opacity: 0.8 }}>{clientName}{period ? ` · ${period}` : ''}</p>
      </div>

      <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px' }}>

        {/* Summary cards */}
        {allCampaigns.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 28 }}>
            {[
              ['Campaigns', String(allCampaigns.length)],
              ['Total Reach', fmtNum(overall.reach)],
              ['Impressions', fmtNum(overall.impressions)],
              ['Clicks', fmtNum(overall.clicks)],
              ['Total Leads', fmtNum(overall.leads)],
              ['Avg Cost/Lead', overallCpl !== null ? fmtCur(overallCpl) : '—'],
              ['Total Spent', overall.cost > 0 ? fmtCur(overall.cost) : '—'],
            ].map(([label, value]) => (
              <div key={label} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 18px', textAlign: 'center', minWidth: 100 }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#1e3a5f' }}>{value}</div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Per-platform tables */}
        {GROUPS.map(({ key, label }) => {
          const group = data[key];
          if (!group.campaigns.length) return null;
          const totals = calcTotals(group);
          const avgCpl = calcAvgCpl(group);
          return (
            <div key={key} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20, marginBottom: 20 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#2563eb', marginBottom: 12 }}>{label} Campaigns</h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['Campaign', 'Reach', 'Impressions', 'Clicks', 'Leads', 'Cost/Lead', 'Amount Spent'].map((h, i) => (
                        <th key={h} style={{ ...thStyle, textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {group.campaigns.map((c, i) => {
                      const leads = Number(c.leads) || 0;
                      const cost  = Number(c.cost)  || 0;
                      const cpl   = Number(c.cost_per_lead) || null;
                      const cplColor = cpl === null || avgCpl === null ? '#555' : cpl < avgCpl ? '#16a34a' : '#d97706';
                      return (
                        <tr key={i} style={{ background: i % 2 === 1 ? '#f9f9f6' : '#fff' }}>
                          <td style={{ ...tdStyle, fontWeight: 600 }}>{c.name || '—'}</td>
                          <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtNum(Number(c.reach) || 0)}</td>
                          <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtNum(Number(c.impressions) || 0)}</td>
                          <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtNum(Number(c.clicks) || 0)}</td>
                          <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700 }}>{leads > 0 ? fmtNum(leads) : '—'}</td>
                          <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: cplColor }}>{cpl !== null ? fmtCur(cpl) : '—'}</td>
                          <td style={{ ...tdStyle, textAlign: 'right' }}>{cost > 0 ? fmtCur(cost) : '—'}</td>
                        </tr>
                      );
                    })}
                    <tr style={{ background: '#e8edf5', fontWeight: 700 }}>
                      <td style={{ ...tdStyle, fontWeight: 700 }}>Total</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtNum(totals.reach)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtNum(totals.impressions)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtNum(totals.clicks)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtNum(totals.leads)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', color: '#16a34a', fontWeight: 700 }}>{avgCpl !== null ? fmtCur(avgCpl) : '—'}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{totals.cost > 0 ? fmtCur(totals.cost) : '—'}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {group.key_insights && (
                <div style={{ marginTop: 14, padding: '10px 14px', background: '#f8f8f5', borderRadius: 8, border: '1px solid #e0e0d6' }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Key Insights</p>
                  <p style={{ fontSize: 13, lineHeight: 1.7, color: '#333', whiteSpace: 'pre-wrap', margin: 0 }}>{group.key_insights}</p>
                </div>
              )}
            </div>
          );
        })}

        {data.notes && (
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Notes</p>
            <p style={{ fontSize: 13, lineHeight: 1.7, color: '#1a1a1a', whiteSpace: 'pre-wrap', margin: 0 }}>{data.notes}</p>
          </div>
        )}

        {allCampaigns.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#94a3b8', fontSize: 14 }}>No campaign data in this report.</div>
        )}
      </div>
    </div>
  );
}
