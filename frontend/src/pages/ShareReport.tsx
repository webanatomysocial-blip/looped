import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';

const API = '/api';

function fmtDuration(s: number) { const m = Math.floor(s / 60); return `${m}m ${s % 60}s`; }

export default function ShareReport() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    document.documentElement.style.overflow = 'auto';
    document.body.style.overflow = 'auto';
    document.body.style.height = 'auto';
    return () => {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
      document.body.style.height = '';
    };
  }, []);

  useEffect(() => {
    if (!token) return;
    axios.get(`${API}/public/seo/${token}`)
      .then((r) => setData(r.data))
      .catch(() => setError('This report link is invalid or has been revoked.'));
  }, [token]);

  if (error) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui', background: '#f8fafc' }}>
      <div style={{ textAlign: 'center', color: '#64748b' }}>
        <p style={{ fontSize: 40, marginBottom: 12 }}>🔒</p>
        <p style={{ fontSize: 16, fontWeight: 600 }}>{error}</p>
      </div>
    </div>
  );

  if (!data) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui' }}>
      <p style={{ color: '#94a3b8', fontSize: 14 }}>Loading report…</p>
    </div>
  );

  const { client, manual, report, agency_name } = data;
  const eng = report?.engagement;

  const totalClicks = report?.pages?.reduce((s: number, p: any) => s + (p.clicks || 0), 0) ?? 0;
  const totalImpr   = report?.pages?.reduce((s: number, p: any) => s + (p.impressions || 0), 0) ?? 0;
  const avgCtr      = totalImpr > 0 ? ((totalClicks / totalImpr) * 100).toFixed(1) : '0.0';
  const avgPos      = report?.pages?.length > 0
    ? (report.pages.reduce((s: number, p: any) => s + p.position, 0) / report.pages.length).toFixed(1) : '—';

  const sigWhys = manual.sig_change_whys && Object.values(manual.sig_change_whys).some((v: any) => v?.trim?.());

  const delta = (cur: number, pre?: number) => {
    if (!pre) return null;
    const pct = Math.round(((cur - pre) / pre) * 100);
    return { pct, color: pct >= 0 ? '#16a34a' : '#dc2626', label: `${pct >= 0 ? '+' : ''}${pct}%` };
  };

  const prev = report?.prevEngagement;
  const sigChanges: { key: string; label: string; from: number; to: number; pct: number }[] = [];
  if (eng && prev) {
    const check = (key: string, label: string, cur: number, pre: number) => {
      if (!pre) return;
      const pct = Math.round(((cur - pre) / pre) * 100);
      sigChanges.push({ key, label, from: pre, to: cur, pct });
    };
    check('sessions', 'Sessions', eng.sessions, prev.sessions);
    check('users', 'Users', eng.users, prev.users);
    check('engagementRate', 'Engagement Rate', eng.engagementRate, prev.engagementRate);
  }
  // GMB location sig changes
  (manual.gmb_locations ?? []).forEach((loc: any, i: number) => {
    const prefix = (manual.gmb_locations?.length ?? 0) > 1 ? `${loc.name || `Location ${i + 1}`} ` : '';
    const checkGmb = (key: string, label: string, cur: number | null, pre: number | null) => {
      if (cur == null || pre == null || pre === 0) return;
      const pct = Math.round(((cur - pre) / pre) * 100);
      sigChanges.push({ key: `gmb_${i}_${key}`, label: `GBP ${prefix}${label}`, from: pre, to: cur, pct });
    };
    checkGmb('calls', 'Calls', loc.calls, loc.prev_calls);
    checkGmb('website_clicks', 'Website Clicks', loc.website_clicks, loc.prev_website_clicks);
    checkGmb('reviews', 'Reviews', loc.reviews, loc.prev_reviews);
    checkGmb('bookings', 'Bookings', loc.bookings, loc.prev_bookings);
  });

  return (
    <div style={{ fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif', background: '#f1f5f9', minHeight: '100vh', padding: '32px 24px' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ background: '#1d2033', borderRadius: 14, padding: '22px 26px', marginBottom: 24, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 4px' }}>{client.name} — Analytics Report</h1>
            <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>Powered by {agency_name || 'webanatomy'}</p>
          </div>
          {manual.health_score != null && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: '#22c55e' }}>{manual.health_score}</div>
              <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Health Score</div>
            </div>
          )}
        </div>

        {/* Executive Summary */}
        {manual.executive_summary && (
          <Section title="Executive Summary">
            <p style={{ fontSize: 13, lineHeight: 1.7, color: '#334155', margin: 0 }}>{manual.executive_summary}</p>
          </Section>
        )}

        {/* Notable Changes This Period — below Executive Summary */}
        {sigWhys && (
          <Section title="Notable Changes This Period">
            <ul style={{ paddingLeft: 20, margin: 0 }}>
              {sigChanges.filter(sc => manual.sig_change_whys?.[sc.key]?.trim?.()).map(sc => (
                <li key={sc.key} style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 6 }}>
                  <strong>{sc.label}:</strong>{' '}
                  {sc.from.toLocaleString()} → {sc.to.toLocaleString()}{' '}
                  <span style={{ color: sc.pct >= 0 ? '#16a34a' : '#dc2626', fontWeight: 700 }}>
                    ({sc.pct >= 0 ? '+' : ''}{sc.pct}%)
                  </span>
                  <span style={{ color: '#64748b', fontStyle: 'italic' }}>
                    {' '}: {manual.sig_change_whys[sc.key]}
                  </span>
                </li>
              ))}
              {sigWhys && Object.entries(manual.sig_change_whys)
                .filter(([k]) => !sigChanges.find(sc => sc.key === k))
                .map(([k, v]) => {
                  const labelMap: Record<string, string> = {
                    sessions: 'Sessions', users: 'Users', engagementRate: 'Engagement Rate',
                  };
                  const gmbMatch = k.match(/^gmb_(\d+)_(.+)$/);
                  let label = labelMap[k] ?? k;
                  if (gmbMatch) {
                    const loc = manual.gmb_locations?.[Number(gmbMatch[1])];
                    const prefix = (manual.gmb_locations?.length ?? 0) > 1 ? `${loc?.name || `Location ${Number(gmbMatch[1]) + 1}`} ` : '';
                    const fieldMap: Record<string, string> = { calls: 'Calls', website_clicks: 'Website Clicks', reviews: 'Reviews', bookings: 'Bookings' };
                    label = `GBP ${prefix}${fieldMap[gmbMatch[2]] ?? gmbMatch[2]}`;
                  }
                  return (
                    <li key={k} style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 4 }}>
                      <strong>{label}:</strong> {v as string}
                    </li>
                  );
                })}
            </ul>
          </Section>
        )}

        {/* Current Period Targets */}
        {manual.period_targets && Object.values(manual.period_targets).some((v) => v) && (
          <Section title="Current Period Targets">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {[
                ['Sessions', manual.period_targets.sessions],
                ['Leads', manual.period_targets.leads],
                ['Engagement Rate', manual.period_targets.engagement_rate],
                ['Instagram Reach', manual.period_targets.instagram_reach],
                ['Facebook Reach', manual.period_targets.facebook_reach],
              ].filter(([, v]) => v).map(([label, val]) => (
                <MiniCard key={label as string} label={label as string} val={val as string} />
              ))}
            </div>
          </Section>
        )}

        {/* Last Period Plan */}
        {manual.last_period_plan?.length > 0 && (
          <Section title="Last Period's Plan — Progress">
            <Table
              head={['Focus Area', 'Action Taken', 'Expected Result', 'Status']}
              rows={manual.last_period_plan.map((p: any) => [
                p.area, p.action, p.expected,
                <span style={{ fontWeight: 700, color: p.status === 'done' ? '#16a34a' : p.status === 'partial' ? '#d97706' : '#dc2626' }}>
                  {p.status === 'done' ? '✓ Done' : p.status === 'partial' ? '⚠ Partial' : '✕ Not Done'}
                </span>,
              ])}
            />
          </Section>
        )}

        {/* Next Period Plan */}
        {manual.next_period_plan?.length > 0 && (
          <Section title="Next Period's Plan">
            <Table
              head={['Focus Area', 'Planned Action', 'Expected Impact']}
              rows={manual.next_period_plan.map((p: any) => [p.focus, p.action, p.expected])}
            />
          </Section>
        )}

        {/* Key Highlights */}
        {(() => {
          const bpaItems: string[] = Array.isArray(manual.best_performing_asset)
            ? manual.best_performing_asset.filter(Boolean)
            : (manual.best_performing_asset ? [manual.best_performing_asset] : []);
          return bpaItems.length > 0 && (
            <Section title="Key Highlights & Insights">
              <div>
                <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#888', margin: '0 0 6px' }}>Best Performing Asset / Campaign</p>
                <ul style={{ paddingLeft: 20, margin: 0 }}>
                  {bpaItems.map((item, i) => <li key={i} style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 4 }}>{item}</li>)}
                </ul>
              </div>
            </Section>
          );
        })()}

        {/* Website Performance */}
        {eng && (
          <Section title="Website Performance">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10 }}>
              {[
                { label: 'Total Users',     val: (eng.users ?? 0).toLocaleString(),       d: delta(eng.users, prev?.users) },
                { label: 'New Users',       val: (eng.newUsers ?? 0).toLocaleString(),     d: delta(eng.newUsers, prev?.newUsers) },
                { label: 'Sessions',        val: (eng.sessions ?? 0).toLocaleString(),     d: delta(eng.sessions, prev?.sessions) },
                { label: 'Avg. Duration',   val: fmtDuration(eng.avgDuration ?? 0),        d: delta(eng.avgDuration, prev?.avgDuration) },
                { label: 'Engagement Rate', val: `${eng.engagementRate ?? 0}%`,            d: delta(eng.engagementRate, prev?.engagementRate) },
              ].map(({ label, val, d }) => (
                <div key={label} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>{val}</div>
                    {d && <span style={{ fontSize: 11, fontWeight: 700, color: d.color }}>{d.label}</span>}
                  </div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: '#64748b', marginTop: 3, textTransform: 'uppercase' }}>{label}</div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Search Performance */}
        {totalClicks > 0 && (
          <Section title="Search Performance">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <MiniCard label="Total Clicks" val={totalClicks.toLocaleString()} />
              <MiniCard label="Impressions" val={totalImpr.toLocaleString()} />
              <MiniCard label="Avg. CTR" val={`${avgCtr}%`} />
              <MiniCard label="Avg. Position" val={avgPos} />
            </div>
          </Section>
        )}

        {/* Keyword Rankings */}
        {manual.keyword_rankings?.length > 0 && (
          <Section title="Keyword Rankings">
            <Table head={['Keyword', 'Previous Rank', 'Current Rank']} rows={manual.keyword_rankings.map((k: any) => [k.keyword, `#${k.rank ?? '—'}`, `#${k.change ?? '—'}`])} />
          </Section>
        )}

        {/* Traffic Acquisition + Demographics */}
        {report?.acquisition?.length > 0 && (
          <Section title="Traffic Acquisition">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                  {['Channel', 'Sessions', 'Users'].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#64748b', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.acquisition.map((r: any, i: number) => {
                  const p = report.prevAcquisition?.find((x: any) => x.channel === r.channel);
                  const ds = delta(r.sessions, p?.sessions);
                  const du = delta(r.users, p?.users);
                  return (
                    <tr key={r.channel} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? '#fff' : '#f8fafc' }}>
                      <td style={{ padding: '8px 12px' }}>{r.channel}</td>
                      <td style={{ padding: '8px 12px' }}>
                        {r.sessions.toLocaleString()}
                        {ds && <span style={{ fontSize: 10, fontWeight: 700, marginLeft: 5, color: ds.color }}>{ds.label}</span>}
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        {r.users.toLocaleString()}
                        {du && <span style={{ fontSize: 10, fontWeight: 700, marginLeft: 5, color: du.color }}>{du.label}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Section>
        )}

        {report?.demographics?.length > 0 && (
          <Section title="Demographics — Cities">
            <Table head={['City', 'Users', 'Sessions']} rows={report.demographics.map((r: any) => [r.city, r.users.toLocaleString(), r.sessions.toLocaleString()])} />
          </Section>
        )}

        {/* Organic Form Submissions */}
        {manual.organic_form_data?.filter((r: any) => r.date || r.source || r.contact || r.doc_link).length > 0 && (
          <Section title="Organic Form Submissions">
            <Table
              head={['Date', 'Source', 'Contact', 'Doc']}
              rows={manual.organic_form_data.filter((r: any) => r.date || r.source || r.contact || r.doc_link).map((r: any) => [
                r.date || '—', r.source || '—', r.contact || '—',
                r.doc_link ? <a href={r.doc_link} target="_blank" rel="noreferrer" style={{ color: '#6366f1' }}>View Doc</a> : '—',
              ])}
            />
          </Section>
        )}

        {/* Targets — Achieved vs Set */}
        {manual.targets?.length > 0 && (
          <Section title="Targets — Achieved vs Set">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {manual.targets.map((t: any, i: number) => {
                const pct = t.target > 0 ? Math.min(100, Math.round((t.achieved / t.target) * 100)) : 0;
                const done = pct >= 100;
                return (
                  <div key={i}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{t.name}</span>
                      <span style={{ fontSize: 12, color: '#64748b' }}>{t.achieved?.toLocaleString()}{t.unit && ` ${t.unit}`} / {t.target?.toLocaleString()}{t.unit && ` ${t.unit}`} <strong style={{ color: done ? '#16a34a' : '#0f172a' }}>{pct}%</strong></span>
                    </div>
                    <div style={{ height: 6, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: done ? '#16a34a' : '#6366f1', borderRadius: 4 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {/* Key Insights */}
        {manual.key_insights && (
          <Section title="Key Insights">
            <div style={{ fontSize: 13, lineHeight: 1.7, color: '#334155' }} dangerouslySetInnerHTML={{ __html: manual.key_insights }} />
          </Section>
        )}

        {/* GMB */}
        {manual.gmb_locations?.some((loc: any) => loc.rating != null || loc.reviews != null || loc.calls != null || loc.bookings != null || loc.website_clicks != null || loc.overview || loc.key_insights) && (
          <Section title="Google My Business">
            {manual.gmb_locations.map((loc: any, i: number) => (
              <div key={i} style={{ marginBottom: i < manual.gmb_locations.length - 1 ? 20 : 0 }}>
                {loc.name && <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{loc.name}</h3>}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                  {loc.rating != null && <MiniCard label="Rating" val={Number(loc.rating).toFixed(1)} />}
                  {loc.reviews != null && <MiniCard label="Reviews" val={Number(loc.reviews).toLocaleString()} />}
                  {loc.calls != null && <MiniCard label="Calls" val={Number(loc.calls).toLocaleString()} />}
                  {loc.bookings != null && <MiniCard label="Bookings" val={Number(loc.bookings).toLocaleString()} />}
                  {loc.website_clicks != null && <MiniCard label="Website Clicks" val={Number(loc.website_clicks).toLocaleString()} />}
                </div>
                {loc.overview && <p style={{ fontSize: 12, color: '#555', lineHeight: 1.55, marginBottom: 6 }}>{loc.overview}</p>}
                {loc.key_insights && <p style={{ fontSize: 13, color: '#334155', lineHeight: 1.6, margin: 0 }}>{loc.key_insights}</p>}
              </div>
            ))}
          </Section>
        )}

        {/* Social Media Organic */}
        {(() => {
          const hasData = (m: any) => m && (m.views || m.clicks || m.reach || m.content_interactions || m.link_clicks || m.key_insights || m.top_post_description || m.channel_plan_action);
          const organicItems = [
            { title: 'Instagram Organic', m: manual.meta_organic?.instagram, labels: ['Views', 'Reach', 'Content Interactions', 'Link Clicks'] },
            { title: 'Facebook Organic', m: manual.meta_organic?.facebook, labels: ['Views', 'Reach', 'Content Interactions', 'Link Clicks'] },
            { title: 'LinkedIn Organic', m: manual.linkedin_organic, labels: ['Impressions', 'Clicks', 'Relations', 'Total Followers', 'New Followers'], isLinkedIn: true },
          ].filter(({ m }) => hasData(m));
          return organicItems.length > 0 && (
          <Section title="Social Media Report (Organic)">
            {organicItems.map(({ title, m, labels, isLinkedIn }: any) => (
              <div key={title} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, marginBottom: 12 }}>
                <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: '#6366f1' }}>{title}</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                  {(isLinkedIn ? [m.views, m.clicks, m.reach, m.content_interactions, m.link_clicks] : [m.views, m.reach, m.content_interactions, m.link_clicks]).map((v: any, i: number) => v ? <MiniCard key={i} label={labels[i]} val={v} /> : null)}
                </div>
                {m.key_insights && <p style={{ fontSize: 13, color: '#334155', lineHeight: 1.6, marginTop: 8 }}>{m.key_insights}</p>}
                {m.top_post_description && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed #e2e8f0' }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>Top Performing Post</p>
                    <p style={{ fontSize: 13, color: '#1a1a1a', lineHeight: 1.6, margin: 0 }}>{m.top_post_description}</p>
                    {m.top_post_impressions && <p style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Impressions: <strong>{m.top_post_impressions}</strong></p>}
                  </div>
                )}
                {m.channel_plan_action && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed #e2e8f0' }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>Plan — Next Period</p>
                    <p style={{ fontSize: 13, color: '#1a1a1a', lineHeight: 1.6, margin: 0 }}>{m.channel_plan_action}</p>
                    {m.channel_plan_impressions_target && <p style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Impressions target: <strong>{m.channel_plan_impressions_target}</strong></p>}
                  </div>
                )}
              </div>
            ))}
          </Section>
          );
        })()}

        {/* Performance Marketing */}
        {manual.performance_marketing && (() => {
          const pm = manual.performance_marketing;
          const groups: [string, any][] = [['Google Ads', pm.google], ['LinkedIn Ads', pm.linkedin], ['Meta Ads', pm.meta]];
          const active = groups.filter(([, g]) => g?.campaigns?.length > 0);
          if (!active.length) return null;
          return (
            <Section title="Performance Marketing">
              {active.map(([title, g]) => {
                const tot = g.campaigns.reduce((a: any, c: any) => ({
                  reach: a.reach + (Number(c.reach) || 0),
                  impressions: a.impressions + (Number(c.impressions) || 0),
                  clicks: a.clicks + (Number(c.clicks) || 0),
                  leads: a.leads + (Number(c.leads) || 0),
                  cost: a.cost + (Number(c.cost) || 0),
                }), { reach: 0, impressions: 0, clicks: 0, leads: 0, cost: 0 });
                return (
                  <div key={title} style={{ marginBottom: 20 }}>
                    <h3 style={{ fontSize: 13, fontWeight: 700, color: '#059669', marginBottom: 8 }}>{title}</h3>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead><tr>{['Campaign', 'Reach', 'Impressions', 'Clicks', 'Leads', 'Cost/Lead (₹)', 'Spent (₹)'].map((h) => (
                          <th key={h} style={{ padding: '6px 10px', textAlign: h === 'Campaign' ? 'left' : 'right', fontSize: 10, fontWeight: 700, color: '#64748b', background: '#f1f5f9', textTransform: 'uppercase' }}>{h}</th>
                        ))}</tr></thead>
                        <tbody>
                          {g.campaigns.map((c: any, i: number) => (
                            <tr key={i} style={{ background: i % 2 === 0 ? '#f9f9f9' : '#fff' }}>
                              <td style={{ padding: '6px 10px' }}>{c.name || '—'}</td>
                              <td style={{ padding: '6px 10px', textAlign: 'right' }}>{c.reach || '—'}</td>
                              <td style={{ padding: '6px 10px', textAlign: 'right' }}>{c.impressions || '—'}</td>
                              <td style={{ padding: '6px 10px', textAlign: 'right' }}>{c.clicks || '—'}</td>
                              <td style={{ padding: '6px 10px', textAlign: 'right' }}>{c.leads || '—'}</td>
                              <td style={{ padding: '6px 10px', textAlign: 'right' }}>{c.cost_per_lead || '—'}</td>
                              <td style={{ padding: '6px 10px', textAlign: 'right' }}>{c.cost || '—'}</td>
                            </tr>
                          ))}
                          <tr style={{ background: '#f1f5f9', fontWeight: 700 }}>
                            <td style={{ padding: '6px 10px' }}>Total</td>
                            <td style={{ padding: '6px 10px', textAlign: 'right' }}>{tot.reach.toLocaleString()}</td>
                            <td style={{ padding: '6px 10px', textAlign: 'right' }}>{tot.impressions.toLocaleString()}</td>
                            <td style={{ padding: '6px 10px', textAlign: 'right' }}>{tot.clicks.toLocaleString()}</td>
                            <td style={{ padding: '6px 10px', textAlign: 'right' }}>{tot.leads.toLocaleString()}</td>
                            <td style={{ padding: '6px 10px', textAlign: 'right' }}>—</td>
                            <td style={{ padding: '6px 10px', textAlign: 'right' }}>{tot.cost.toLocaleString()}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    {g.key_insights && <p style={{ fontSize: 13, color: '#334155', lineHeight: 1.6, marginTop: 8 }}>{g.key_insights}</p>}
                  </div>
                );
              })}
            </Section>
          );
        })()}

        {/* Flags / Risks */}
        {manual.flags_risks && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '14px 18px', marginBottom: 20 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', marginBottom: 4 }}>Flags / Risks</p>
            <p style={{ fontSize: 13, color: '#7f1d1d', lineHeight: 1.6, margin: 0 }}>{manual.flags_risks}</p>
          </div>
        )}

        <p style={{ textAlign: 'center', fontSize: 11, color: '#94a3b8', marginTop: 32 }}>Generated by {agency_name || 'webanatomy'} · This is a read-only shared report</p>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <h2 style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px' }}>{title}</h2>
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '14px 18px' }}>{children}</div>
    </div>
  );
}

function MiniCard({ label, val }: { label: string; val: any }) {
  return (
    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 14px', minWidth: 100 }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>{val}</div>
      <div style={{ fontSize: 10, fontWeight: 600, color: '#64748b', marginTop: 2, textTransform: 'uppercase' }}>{label}</div>
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: any[][] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead><tr>{head.map((h) => <th key={h} style={{ padding: '7px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#64748b', background: '#f1f5f9', textTransform: 'uppercase' }}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((row, i) => <tr key={i} style={{ background: i % 2 === 0 ? '#f9f9f9' : '#fff' }}>{row.map((cell, j) => <td key={j} style={{ padding: '7px 10px' }}>{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
