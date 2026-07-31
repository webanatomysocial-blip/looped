import { useEffect, useState } from 'react';
import { TrendingUp, Users, MousePointer, Globe, MapPin, Settings, Check, X, Download, Plus, Trash2, Edit2, Search, Star, Linkedin, FileText } from 'lucide-react';
import Layout from '../components/Layout/Layout';
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
interface OrganicForm  { url: string; count: number; }
interface LinkedInPost { title: string; impressions: number; clicks: number; }
interface LinkedInData {
  impressions: number | null;
  impressions_organic: number | null;
  impressions_sponsored: number | null;
  clicks: number | null;
  clicks_organic: number | null;
  clicks_sponsored: number | null;
  new_followers: number | null;
  new_followers_period: string;
  growth_rate: string;
  growth_label: string;
  posts: LinkedInPost[];
}
interface SocialPlatformData {
  // Instagram
  views: number | null;
  from_organic: number | null;
  from_ads: number | null;
  reach: number | null;
  total_followers: number | null;
  new_followers: number | null;
  interactions: number | null;
  // Facebook
  watch_time: string | null;
  // TikTok
  likes: number | null;
}
interface SocialMediaData {
  instagram: SocialPlatformData;
  facebook: SocialPlatformData;
  tiktok: SocialPlatformData;
}
interface ManualData {
  keyword_rankings: KeywordRank[];
  targets: Target[];
  key_insights: string;
  linkedin_data: LinkedInData | null;
  social_media_data: SocialMediaData | null;
  organic_form_data: OrganicForm[];
  gmb_rating: number | null;
  gmb_reviews: number | null;
  gmb_profile_url: string;
  gmb_overview: string;
  gmb_calls: number | null;
  gmb_bookings: number | null;
  gmb_website_clicks: number | null;
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

function downloadPDF(
  report: Report,
  clientName: string,
  range: string,
  manual: ManualData,
  demoCountry: string,
  selectedAcquisitions: Set<string>,
  selectedDemographics: Set<string>,
  selectedPages: Set<string>,
  selectedQueries: Set<string>
) {
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

  const acqRows = report.acquisition.filter((r) => selectedAcquisitions.has(r.channel)).map((r, i) => `
    <tr style="background:${i % 2 === 0 ? '#f9f9f9' : '#fff'}">
      <td style="padding:8px 12px;font-weight:600">${r.channel}</td>
      <td style="padding:8px 12px;text-align:right">${r.sessions.toLocaleString()}</td>
      <td style="padding:8px 12px;text-align:right">${r.users.toLocaleString()}</td>
    </tr>`).join('');

  const showCountryCol = manual !== undefined && demoCountry === 'all';
  const demoRows = report.demographics.filter((r) => selectedDemographics.has(r.city)).map((r: any, i) => `
    <tr style="background:${i % 2 === 0 ? '#f9f9f9' : '#fff'}">
      <td style="padding:8px 12px;font-weight:600">${r.city}</td>
      ${showCountryCol ? `<td style="padding:8px 12px;color:#888">${r.country ?? ''}</td>` : ''}
      <td style="padding:8px 12px;text-align:right">${r.users.toLocaleString()}</td>
      <td style="padding:8px 12px;text-align:right">${r.sessions.toLocaleString()}</td>
    </tr>`).join('');

  const pageRows = report.pages.filter((r) => selectedPages.has(r.page)).map((r, i) => `
    <tr style="background:${i % 2 === 0 ? '#f9f9f9' : '#fff'}">
      <td style="padding:8px 12px;font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${shortenUrl(r.page)}</td>
      <td style="padding:8px 12px;text-align:right;font-weight:700">${r.clicks.toLocaleString()}</td>
      <td style="padding:8px 12px;text-align:right">${r.impressions.toLocaleString()}</td>
      <td style="padding:8px 12px;text-align:right">${r.ctr}%</td>
      <td style="padding:8px 12px;text-align:right">${r.position}</td>
    </tr>`).join('');

  const queryRows = report.queries.filter((r) => selectedQueries.has(r.query)).map((r, i) => `
    <tr style="background:${i % 2 === 0 ? '#f9f9f9' : '#fff'}">
      <td style="padding:8px 12px;font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.query}</td>
      <td style="padding:8px 12px;text-align:right;font-weight:700">${r.clicks.toLocaleString()}</td>
      <td style="padding:8px 12px;text-align:right">${r.impressions.toLocaleString()}</td>
      <td style="padding:8px 12px;text-align:right">${r.ctr}%</td>
      <td style="padding:8px 12px;text-align:right">${r.position}</td>
    </tr>`).join('');

  // ── Manual sections ──
  const kwRows = manual.keyword_rankings.map((k, i) => `
    <tr style="background:${i % 2 === 0 ? '#f9f9f9' : '#fff'}">
      <td style="padding:8px 12px;font-weight:600">${k.keyword}</td>
      <td style="padding:8px 12px;text-align:right;font-weight:700">${k.rank ?? '—'}</td>
      <td style="padding:8px 12px;text-align:right;color:${(k.change ?? 0) > 0 ? '#16a34a' : (k.change ?? 0) < 0 ? '#dc2626' : '#888'}">${(k.change ?? 0) > 0 ? '+' : ''}${k.change ?? '—'}</td>
    </tr>`).join('');

  const targetRows = manual.targets.map((t, i) => `
    <tr style="background:${i % 2 === 0 ? '#f9f9f9' : '#fff'}">
      <td style="padding:8px 12px;font-weight:600">${t.name}</td>
      <td style="padding:8px 12px;text-align:right">${t.achieved ?? '—'}</td>
      <td style="padding:8px 12px;text-align:right">${t.target ?? '—'}</td>
    </tr>`).join('');

  const gmbCards = [
    manual.gmb_rating != null ? ['Rating', Number(manual.gmb_rating).toFixed(1)] : null,
    manual.gmb_reviews != null ? ['Reviews', Number(manual.gmb_reviews).toLocaleString()] : null,
    manual.gmb_calls != null ? ['Calls', Number(manual.gmb_calls).toLocaleString()] : null,
    manual.gmb_bookings != null ? ['Bookings', Number(manual.gmb_bookings).toLocaleString()] : null,
    manual.gmb_website_clicks != null ? ['Website Clicks', Number(manual.gmb_website_clicks).toLocaleString()] : null,
  ].filter(Boolean) as [string, string][];

  const li = manual.linkedin_data;
  const liCards = li ? [
    li.impressions != null ? ['Total Impressions', li.impressions.toLocaleString()] : null,
    li.clicks != null ? ['Total Clicks', li.clicks.toLocaleString()] : null,
    manual.linkedin_followers != null ? ['Followers', manual.linkedin_followers.toLocaleString()] : null,
    li.new_followers != null ? [`New Followers${li.new_followers_period ? ' (' + li.new_followers_period + ')' : ''}`, li.new_followers.toLocaleString()] : null,
    li.growth_rate ? ['Growth Rate', li.growth_rate] : null,
  ].filter(Boolean) as [string, string][] : [];

  const liHasImpressions = !!li && li.posts.some(p => p.impressions > 0);
  const liHasClicks      = !!li && li.posts.some(p => p.clicks > 0);
  const liPostHead = li && li.posts.length > 0
    ? `<tr><th style="text-align:left;font-size:10px;font-weight:700;color:#888;padding:8px 12px;background:#f5f5f0;text-transform:uppercase;letter-spacing:0.05em">Post</th>${liHasImpressions ? '<th style="text-align:right;font-size:10px;font-weight:700;color:#888;padding:8px 12px;background:#f5f5f0;text-transform:uppercase;letter-spacing:0.05em">Impressions</th>' : ''}${liHasClicks ? '<th style="text-align:right;font-size:10px;font-weight:700;color:#888;padding:8px 12px;background:#f5f5f0;text-transform:uppercase;letter-spacing:0.05em">Clicks</th>' : ''}${liHasImpressions ? '<th style="text-align:right;font-size:10px;font-weight:700;color:#888;padding:8px 12px;background:#f5f5f0;text-transform:uppercase;letter-spacing:0.05em">CTR</th>' : ''}</tr>`
    : '';
  const liPostRows = li && li.posts.length > 0 ? li.posts.map((p, i) => {
    const ctr = p.impressions > 0 ? ((p.clicks / p.impressions) * 100).toFixed(2) : null;
    return `<tr style="background:${i % 2 === 0 ? '#f9f9f9' : '#fff'}">
      <td style="padding:8px 12px">${p.title}</td>
      ${liHasImpressions ? `<td style="padding:8px 12px;text-align:right">${p.impressions.toLocaleString()}</td>` : ''}
      ${liHasClicks ? `<td style="padding:8px 12px;text-align:right">${p.clicks.toLocaleString()}</td>` : ''}
      ${liHasImpressions ? `<td style="padding:8px 12px;text-align:right">${ctr ?? '—'}%</td>` : ''}
    </tr>`;
  }).join('') : '';

  const socialPlatforms: { key: 'instagram' | 'facebook' | 'tiktok'; label: string }[] = [
    { key: 'instagram', label: 'Instagram' },
    { key: 'facebook', label: 'Facebook' },
    { key: 'tiktok', label: 'TikTok' },
  ];
  const socialSections = socialPlatforms.map(({ key, label }) => {
    const d = manual.social_media_data?.[key];
    if (!d) return '';
    const allCards: ([string, string] | null)[] = key === 'instagram' ? [
      d.views != null ? ['Views', d.views.toLocaleString()] : null,
      d.from_organic != null ? ['From Organic', d.from_organic.toLocaleString()] : null,
      d.from_ads != null ? ['From Ads', d.from_ads.toLocaleString()] : null,
      d.reach != null ? ['Reach', d.reach.toLocaleString()] : null,
      d.total_followers != null ? ['Total Followers', d.total_followers.toLocaleString()] : null,
      d.new_followers != null ? ['New Followers', d.new_followers.toLocaleString()] : null,
      d.interactions != null ? ['Interactions', d.interactions.toLocaleString()] : null,
    ] : key === 'facebook' ? [
      d.views != null ? ['Views', d.views.toLocaleString()] : null,
      d.from_organic != null ? ['From Organic', d.from_organic.toLocaleString()] : null,
      d.from_ads != null ? ['From Ads', d.from_ads.toLocaleString()] : null,
      d.interactions != null ? ['Interactions', d.interactions.toLocaleString()] : null,
      d.watch_time != null ? ['Watch Time', d.watch_time] : null,
    ] : [
      d.views != null ? ['Views', d.views.toLocaleString()] : null,
      d.total_followers != null ? ['Followers', d.total_followers.toLocaleString()] : null,
      d.likes != null ? ['Likes', d.likes.toLocaleString()] : null,
    ];
    const cards = allCards.filter(Boolean) as [string, string][];
    if (!cards.length && d.from_organic == null && d.from_ads == null) return '';
    const tot = (d.from_organic ?? 0) + (d.from_ads ?? 0) || 1;
    const oPct = Math.round(((d.from_organic ?? 0) / tot) * 100);
    const aPct = 100 - oPct;
    const hasSplit = (key === 'instagram' || key === 'facebook') && (d.from_organic != null || d.from_ads != null);
    const splitBar = hasSplit ? `
      <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#888;margin:14px 0 6px">Views Breakdown</p>
      <div style="display:flex;gap:12px;margin-bottom:8px">
        <div style="flex:1">
          <div style="height:8px;background:#e8e8e0;border-radius:4px;overflow:hidden;margin-bottom:4px">
            <div style="height:100%;width:${Math.max(oPct, 2)}%;background:#22c55e;border-radius:4px"></div>
          </div>
          <p style="font-size:11px;color:#888;margin:0">Organic ${oPct}% &nbsp;<b style="color:#1a1a1a">${(d.from_organic ?? 0).toLocaleString()}</b></p>
        </div>
        <div style="flex:1">
          <div style="height:8px;background:#e8e8e0;border-radius:4px;overflow:hidden;margin-bottom:4px">
            <div style="height:100%;width:${Math.max(aPct, 2)}%;background:#6366f1;border-radius:4px"></div>
          </div>
          <p style="font-size:11px;color:#888;margin:0">Ads ${aPct}% &nbsp;<b style="color:#1a1a1a">${(d.from_ads ?? 0).toLocaleString()}</b></p>
        </div>
      </div>` : '';
    return `
<h2>${label}</h2>
<div class="section">
  <div class="section-inner">
    ${cards.length ? `<div class="mini-cards">${cards.map(([lbl, val]) => `<div class="mini-card"><div class="mini-card-val">${val}</div><div class="mini-card-label">${lbl}</div></div>`).join('')}</div>` : ''}
    ${splitBar}
  </div>
</div>`;
  }).join('');

  const organicRows = manual.organic_form_data.map((row, i) => `
    <tr style="background:${i % 2 === 0 ? '#f9f9f9' : '#fff'}">
      <td style="padding:8px 12px;font-size:11px">${row.url}</td>
      <td style="padding:8px 12px;text-align:right;font-weight:700">${row.count.toLocaleString()}</td>
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
  .mini-cards { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 12px; }
  .mini-card { background: #f5f5f0; border-radius: 8px; padding: 10px 14px; min-width: 110px; }
  .mini-card-val { font-size: 16px; font-weight: 800; color: #1a1a1a; }
  .mini-card-label { font-size: 10px; font-weight: 600; color: #888; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.04em; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; font-size: 10px; font-weight: 700; color: #888; padding: 8px 12px; background: #f5f5f0; text-transform: uppercase; letter-spacing: 0.05em; }
  th:not(:first-child) { text-align: right; }
  .section { border: 1px solid #e8e8e0; border-radius: 10px; overflow: hidden; margin-bottom: 20px; }
  .section-inner { padding: 14px 16px; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .badge { display: inline-block; background: #e8f5e9; color: #2e7d32; font-size: 9px; font-weight: 700; padding: 2px 7px; border-radius: 4px; margin-left: 8px; vertical-align: middle; }
  svg { display: block; }
  .legend { display: flex; gap: 16px; padding: 10px 16px; font-size: 10px; color: #888; font-weight: 600; }
  .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 4px; }
  .insights-body { font-size: 13px; line-height: 1.7; padding: 14px 16px; }
  .insights-body ul, .insights-body ol { padding-left: 20px; }
  .insights-body li { margin-bottom: 4px; }
  .gmb-link { font-size: 11px; color: #6366f1; margin-top: 8px; display: inline-block; }
  .overview-text { font-size: 12px; color: #555; margin-top: 10px; line-height: 1.55; white-space: pre-line; }
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

${acqRows || demoRows ? `<div class="two-col">
  ${acqRows ? `<div>
    <h2>Traffic Acquisition</h2>
    <div class="section">
      <table><thead><tr><th>Channel</th><th>Sessions</th><th>Users</th></tr></thead>
      <tbody>${acqRows}</tbody></table>
    </div>
  </div>` : ''}
  ${demoRows ? `<div>
    <h2>Demographics — Cities${demoCountry !== 'all' ? ` (${demoCountry})` : ''}</h2>
    <div class="section">
      <table><thead><tr><th>City</th>${showCountryCol ? '<th>Country</th>' : ''}<th>Users</th><th>Sessions</th></tr></thead>
      <tbody>${demoRows}</tbody></table>
    </div>
  </div>` : ''}
</div>` : ''}

${pageRows || queryRows ? `<div class="two-col">
  ${pageRows ? `<div>
    <h2>Pages &amp; Screens <span class="badge">Search Console</span></h2>
    <div class="section">
      <table><thead><tr><th>Page</th><th>Clicks</th><th>Impr.</th><th>CTR</th><th>Pos.</th></tr></thead>
      <tbody>${pageRows}</tbody></table>
    </div>
  </div>` : ''}
  ${queryRows ? `<div>
    <h2>Top Queries <span class="badge">Search Console</span></h2>
    <div class="section">
      <table><thead><tr><th>Query</th><th>Clicks</th><th>Impr.</th><th>CTR</th><th>Pos.</th></tr></thead>
      <tbody>${queryRows}</tbody></table>
    </div>
  </div>` : ''}
</div>` : ''}

${kwRows ? `
<h2>Keyword Rankings</h2>
<div class="section">
  <table><thead><tr><th>Keyword</th><th>Rank</th><th>Change</th></tr></thead>
  <tbody>${kwRows}</tbody></table>
</div>` : ''}

${targetRows ? `
<h2>Targets</h2>
<div class="section">
  <table><thead><tr><th>Metric</th><th>Achieved</th><th>Target</th></tr></thead>
  <tbody>${targetRows}</tbody></table>
</div>` : ''}

${manual.key_insights ? `
<h2>Key Insights</h2>
<div class="section">
  <div class="insights-body">${manual.key_insights}</div>
</div>` : ''}

${gmbCards.length > 0 ? `
<h2>Google My Business</h2>
<div class="section">
  <div class="section-inner">
    <div class="mini-cards">
      ${gmbCards.map(([label, val]) => `<div class="mini-card"><div class="mini-card-val">${val}</div><div class="mini-card-label">${label}</div></div>`).join('')}
    </div>
    ${manual.gmb_overview ? `<div class="overview-text">${manual.gmb_overview}</div>` : ''}
    ${manual.gmb_profile_url ? `<a href="${manual.gmb_profile_url}" class="gmb-link">View GMB Profile →</a>` : ''}
  </div>
</div>` : ''}

${socialSections}

${(manual.linkedin_data != null || manual.linkedin_followers != null) ? `
<h2>LinkedIn Analytics</h2>
<div class="section">
  <div class="section-inner">
    ${liCards.length > 0 ? `<div class="mini-cards">${liCards.map(([label, val]) => `<div class="mini-card"><div class="mini-card-val">${val}</div><div class="mini-card-label">${label}</div></div>`).join('')}</div>` : ''}
    ${liPostRows ? `<p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#888;margin:12px 0 6px">Top Posts</p>
    <table><thead>${liPostHead}</thead><tbody>${liPostRows}</tbody></table>` : ''}
    ${manual.linkedin_url ? `<a href="${manual.linkedin_url}" class="gmb-link">LinkedIn Page →</a>` : ''}
  </div>
</div>` : ''}

${organicRows ? `
<h2>Organic Form Submissions</h2>
<div class="section">
  <table><thead><tr><th>Page URL</th><th>Submissions</th></tr></thead>
  <tbody>${organicRows}</tbody></table>
</div>` : ''}

</body></html>`;

  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  setTimeout(() => { win.focus(); win.print(); }, 400);
}

const emptyLinkedIn = (): LinkedInData => ({
  impressions: null, impressions_organic: null, impressions_sponsored: null,
  clicks: null, clicks_organic: null, clicks_sponsored: null,
  new_followers: null, new_followers_period: '', growth_rate: '', growth_label: '', posts: [],
});

const emptyManual = (): ManualData => ({
  keyword_rankings: [], targets: [], key_insights: '', linkedin_data: null, social_media_data: null,
  organic_form_data: [],
  gmb_rating: null, gmb_reviews: null, gmb_profile_url: '',
  gmb_overview: '', gmb_calls: null, gmb_bookings: null, gmb_website_clicks: null,
  linkedin_url: '', linkedin_followers: null,
});

export default function SEO() {
  const { user } = useAuth();
  const canEdit   = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'employee';

  const [clients, setClients]           = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [range, setRange]               = useState<Range>('28d');
  const [customStart, setCustomStart]   = useState('');
  const [customEnd, setCustomEnd]       = useState('');
  const [demoCountry, setDemoCountry]   = useState('India');
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
  const [manualPanel, setManualPanel]   = useState<'keywords' | 'targets' | 'gmb' | 'insights' | 'organic' | 'linkedin' | 'social' | null>(null);
  const [socialTab, setSocialTab] = useState<'linkedin' | 'instagram' | 'facebook' | 'tiktok'>('linkedin');
  const [showTiktok, setShowTiktok] = useState(false);
  const [manualSaving, setManualSaving] = useState(false);

  // User Acquisition & Demographics selection
  const [selectedAcquisitions, setSelectedAcquisitions] = useState<Set<string>>(new Set());
  const [selectedDemographics, setSelectedDemographics]   = useState<Set<string>>(new Set());

  // Pages & Screens: search + pagination + PDF selection
  const PAGES_PER_PAGE = 10;
  const [pageSearchInput, setPageSearchInput] = useState('');
  const [pageSearch, setPageSearch]           = useState('');
  const [pagePage, setPagePage]               = useState(1);
  const [selectedPages, setSelectedPages]     = useState<Set<string>>(new Set());

  // Top Queries: search + pagination + PDF selection
  const QUERIES_PER_PAGE = 10;
  const [querySearchInput, setQuerySearchInput] = useState('');
  const [querySearch, setQuerySearch]           = useState('');
  const [queryPage, setQueryPage]               = useState(1);
  const [selectedQueries, setSelectedQueries]   = useState<Set<string>>(new Set());

  useEffect(() => {
    // New report loaded — select all items by default and reset search/pagination
    setSelectedAcquisitions(new Set(report?.acquisition.map((a) => a.channel) ?? []));
    setSelectedDemographics(new Set(report?.demographics.map((d) => d.city) ?? []));
    setSelectedPages(new Set(report?.pages.map((p) => p.page) ?? []));
    setSelectedQueries(new Set(report?.queries.map((q) => q.query) ?? []));
    setPageSearchInput('');
    setPageSearch('');
    setPagePage(1);
    setQuerySearchInput('');
    setQuerySearch('');
    setQueryPage(1);
  }, [report]);

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
    seoApi.report(selectedClient.id, range, range === 'custom' ? customStart : undefined, range === 'custom' ? customEnd : undefined, demoCountry)
      .then((r) => setReport(r.data))
      .catch((e) => setError(e.response?.data?.error || 'Failed to load report'))
      .finally(() => setLoading(false));
  }, [selectedClient, range, customStart, customEnd, demoCountry]);

  useEffect(() => {
    if (!selectedClient) return;
    seoApi.getManual(selectedClient.id)
      .then((r) => {
        const data = { ...emptyManual(), ...r.data };
        setManual(data);
        setShowTiktok(!!(data.social_media_data?.tiktok && Object.values(data.social_media_data.tiktok).some((v) => v != null)));
      })
      .catch(() => { setManual(emptyManual()); setShowTiktok(false); });
  }, [selectedClient]);

  const openManualPanel = (panel: typeof manualPanel) => {
    const base = { ...manual };
    if (panel === 'linkedin' && !base.linkedin_data) base.linkedin_data = emptyLinkedIn();
    if (panel === 'social') {
      const empty = (): SocialPlatformData => ({ views: null, from_organic: null, from_ads: null, reach: null, total_followers: null, new_followers: null, interactions: null, watch_time: null, likes: null });
      if (!base.social_media_data) base.social_media_data = { instagram: empty(), facebook: empty(), tiktok: empty() };
      if (!base.linkedin_data) base.linkedin_data = emptyLinkedIn();
    }
    setManualEdit(base);
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

  const maxAcq   = Math.max(...(report?.acquisition.map((r) => r.sessions) ?? [1]), 1);
  const maxDemo  = Math.max(...(report?.demographics.map((r) => r.users) ?? [1]), 1);

  const editingClient = clients.find((c) => c.id === editingId) ?? null;

  return (
    <Layout>
      <div className="page-wrap">
        

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
                onClick={() => downloadPDF(report!, selectedClient?.name ?? 'Client', range, manual, demoCountry, selectedAcquisitions, selectedDemographics, selectedPages, selectedQueries)}
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
                  {canEdit && (
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
          {canEdit && editingId && editingClient && (
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
            {canEdit
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

            {/* ── Traffic chart (SVG) ── */}
            <div className="seo-section">
              <h3 className="seo-section__title">Website Traffic</h3>
              {(() => {
                const W = 900, H = 220;
                const ML = 52, MR = 16, MT = 12, MB = 38;
                const PW = W - ML - MR, PH = H - MT - MB;
                const n = report.traffic.length;
                const groupW = PW / n;
                const barW = Math.max(4, Math.min(28, groupW * 0.65));
                const maxV = Math.max(...report.traffic.map((r) => Math.max(r.users, r.sessions)), 1);
                const yTicks = [0, 0.25, 0.5, 0.75, 1];
                const xEvery = n <= 7 ? 1 : n <= 14 ? 2 : n <= 31 ? 4 : 9;
                return (
                  <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
                    {/* gridlines + Y labels */}
                    {yTicks.map((f) => {
                      const y = MT + PH - f * PH;
                      return (
                        <g key={f}>
                          <line x1={ML} y1={y} x2={ML + PW} y2={y} stroke={f === 0 ? '#d0d0c8' : '#ececec'} strokeWidth={1} />
                          {f > 0 && (
                            <text x={ML - 8} y={y + 4} textAnchor="end" fontSize={9} fill="#aaa" fontFamily="inherit">
                              {Math.round(maxV * f).toLocaleString()}
                            </text>
                          )}
                        </g>
                      );
                    })}

                    {/* bars */}
                    {report.traffic.map((row, i) => {
                      const cx = ML + (i + 0.5) * groupW;
                      const bx = cx - barW / 2;
                      const sH = Math.max(2, (row.sessions / maxV) * PH);
                      const uH = Math.max(2, (row.users    / maxV) * PH);
                      return (
                        <g key={row.date} className="seo-svg-bar-group">
                          <title>{`${fmtDateLabel(row.date)}  •  Users: ${row.users.toLocaleString()}  •  Sessions: ${row.sessions.toLocaleString()}`}</title>
                          <rect x={bx} y={MT + PH - sH} width={barW} height={sH} rx={2} fill="rgba(99,102,241,0.18)" />
                          <rect x={bx} y={MT + PH - uH} width={barW} height={uH} rx={2} fill="#6366f1" />
                        </g>
                      );
                    })}

                    {/* X date labels */}
                    {report.traffic.map((row, i) => {
                      if (i % xEvery !== 0) return null;
                      const cx = ML + (i + 0.5) * groupW;
                      return (
                        <text key={row.date} x={cx} y={H - 4} textAnchor="middle" fontSize={9} fill="#bbb" fontFamily="inherit">
                          {fmtDateLabel(row.date)}
                        </text>
                      );
                    })}
                  </svg>
                );
              })()}
              <div className="seo-legend">
                <span className="seo-legend__dot seo-legend__dot--users" /> Users
                <span className="seo-legend__dot seo-legend__dot--sessions" style={{ marginLeft: 16 }} /> Sessions
              </div>
            </div>

            {/* ── Acquisition + Demographics ── */}
            <div className="seo-two-col">
              <div className="seo-section">
                <h3 className="seo-section__title">Traffic Acquisition</h3>
                {report.acquisition.length > 0
                  ? (() => {
                      const allAcqSelected = report.acquisition.length > 0 && report.acquisition.every((r) => selectedAcquisitions.has(r.channel));
                      const toggleAcq = (channel: string) => setSelectedAcquisitions((prev) => {
                        const next = new Set(prev);
                        if (next.has(channel)) next.delete(channel); else next.add(channel);
                        return next;
                      });
                      const toggleAllAcq = () => setSelectedAcquisitions((prev) => {
                        const next = new Set(prev);
                        report.acquisition.forEach((r) => { if (allAcqSelected) next.delete(r.channel); else next.add(r.channel); });
                        return next;
                      });
                      return (
                        <table className="seo-table">
                          <thead>
                            <tr>
                              <th style={{ width: 24 }}>
                                <input type="checkbox" checked={allAcqSelected} onChange={toggleAllAcq} title="Select all channels" />
                              </th>
                              <th>Channel</th><th>Sessions</th><th>Users</th><th></th>
                            </tr>
                          </thead>
                          <tbody>
                            {report.acquisition.map((row, i) => (
                              <tr key={i}>
                                <td>
                                  <input
                                    type="checkbox"
                                    checked={selectedAcquisitions.has(row.channel)}
                                    onChange={() => toggleAcq(row.channel)}
                                  />
                                </td>
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
                      );
                    })()
                  : <p className="page-subtitle" style={{ padding: '12px 0' }}>No acquisition data available.</p>}
              </div>

              <div className="seo-section">
                <h3 className="seo-section__title">
                  <MapPin size={13} style={{ marginRight: 6 }} />Demographics — Cities
                  <select
                    className="seo-demo-country-select"
                    value={demoCountry}
                    onChange={(e) => setDemoCountry(e.target.value)}
                  >
                    <option value="India">India</option>
                    <option value="United States">United States</option>
                    <option value="United Kingdom">United Kingdom</option>
                    <option value="Australia">Australia</option>
                    <option value="Canada">Canada</option>
                    <option value="Germany">Germany</option>
                    <option value="France">France</option>
                    <option value="Singapore">Singapore</option>
                    <option value="United Arab Emirates">UAE</option>
                    <option value="all">All Countries</option>
                  </select>
                </h3>
                {report.demographics.length > 0
                  ? (() => {
                      const allDemoSelected = report.demographics.length > 0 && report.demographics.every((r) => selectedDemographics.has(r.city));
                      const toggleDemo = (city: string) => setSelectedDemographics((prev) => {
                        const next = new Set(prev);
                        if (next.has(city)) next.delete(city); else next.add(city);
                        return next;
                      });
                      const toggleAllDemo = () => setSelectedDemographics((prev) => {
                        const next = new Set(prev);
                        report.demographics.forEach((r) => { if (allDemoSelected) next.delete(r.city); else next.add(r.city); });
                        return next;
                      });
                      return (
                        <table className="seo-table">
                          <thead>
                            <tr>
                              <th style={{ width: 24 }}>
                                <input type="checkbox" checked={allDemoSelected} onChange={toggleAllDemo} title="Select all cities" />
                              </th>
                              <th>City</th>{demoCountry === 'all' && <th>Country</th>}<th>Users</th><th>Sessions</th><th></th>
                            </tr>
                          </thead>
                          <tbody>
                            {report.demographics.map((row, i) => (
                              <tr key={i}>
                                <td>
                                  <input
                                    type="checkbox"
                                    checked={selectedDemographics.has(row.city)}
                                    onChange={() => toggleDemo(row.city)}
                                  />
                                </td>
                                <td className="seo-source">{row.city}</td>
                                {demoCountry === 'all' && <td className="seo-source" style={{ color: 'var(--ink-muted)' }}>{(row as any).country}</td>}
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
                      );
                    })()
                  : <p className="page-subtitle" style={{ padding: '12px 0' }}>No demographics data available.</p>}
              </div>
            </div>

            {/* ── Pages & Screens + Top Queries ── */}
            <div className="seo-two-col">
              <div className="seo-section">
                <h3 className="seo-section__title">Pages &amp; Screens <span className="seo-badge">Search Console</span></h3>
                {report.pages.length > 0
                  ? (() => {
                      const filteredPages = report.pages.filter((p) => p.page.toLowerCase().includes(pageSearch.toLowerCase()));
                      const totalPagePages = Math.max(1, Math.ceil(filteredPages.length / PAGES_PER_PAGE));
                      const currentPage = Math.min(pagePage, totalPagePages);
                      const pageItems = filteredPages.slice((currentPage - 1) * PAGES_PER_PAGE, currentPage * PAGES_PER_PAGE);
                      const allOnPageSelected = pageItems.length > 0 && pageItems.every((p) => selectedPages.has(p.page));
                      const togglePage = (p: string) => setSelectedPages((prev) => {
                        const next = new Set(prev);
                        if (next.has(p)) next.delete(p); else next.add(p);
                        return next;
                      });
                      const toggleAllOnPage = () => setSelectedPages((prev) => {
                        const next = new Set(prev);
                        pageItems.forEach((p) => { if (allOnPageSelected) next.delete(p.page); else next.add(p.page); });
                        return next;
                      });
                      const runSearch = () => { setPageSearch(pageSearchInput); setPagePage(1); };
                      return (
                        <>
                          <div className="seo-query-search">
                            <input
                              type="text"
                              className="form-input"
                              placeholder="Search pages…"
                              value={pageSearchInput}
                              onChange={(e) => setPageSearchInput(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
                            />
                            <button type="button" className="filter-tab" onClick={runSearch}>Search</button>
                          </div>
                          {filteredPages.length > 0
                            ? <table className="seo-table">
                                <thead>
                                  <tr>
                                    <th style={{ width: 24 }}>
                                      <input type="checkbox" checked={allOnPageSelected} onChange={toggleAllOnPage} title="Select all on this page" />
                                    </th>
                                    <th>Page</th><th>Clicks</th><th>Impr.</th><th>CTR</th><th>Pos.</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {pageItems.map((row) => (
                                    <tr key={row.page}>
                                      <td>
                                        <input
                                          type="checkbox"
                                          checked={selectedPages.has(row.page)}
                                          onChange={() => togglePage(row.page)}
                                        />
                                      </td>
                                      <td className="seo-page-url" title={row.page}>{shortenUrl(row.page)}</td>
                                      <td>{row.clicks.toLocaleString()}</td>
                                      <td>{row.impressions.toLocaleString()}</td>
                                      <td>{row.ctr}%</td>
                                      <td>{row.position}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            : <p className="page-subtitle" style={{ padding: '12px 0' }}>No pages match "{pageSearch}".</p>}
                          {totalPagePages > 1 && (
                            <div className="seo-pagination">
                              <button type="button" disabled={currentPage === 1} onClick={() => setPagePage(currentPage - 1)}>‹</button>
                              {Array.from({ length: totalPagePages }, (_, i) => i + 1).map((p) => (
                                <button
                                  key={p}
                                  type="button"
                                  className={p === currentPage ? 'active' : ''}
                                  onClick={() => setPagePage(p)}
                                >
                                  {p}
                                </button>
                              ))}
                              <button type="button" disabled={currentPage === totalPagePages} onClick={() => setPagePage(currentPage + 1)}>›</button>
                            </div>
                          )}
                        </>
                      );
                    })()
                  : <p className="page-subtitle" style={{ padding: '12px 0' }}>No GSC site URL configured.</p>}
              </div>

              <div className="seo-section">
                <h3 className="seo-section__title"><Search size={13} style={{ marginRight: 6 }} />Top Queries <span className="seo-badge">Search Console</span></h3>
                {report.queries.length > 0
                  ? (() => {
                      const filteredQueries = report.queries.filter((q) => q.query.toLowerCase().includes(querySearch.toLowerCase()));
                      const totalQueryPages = Math.max(1, Math.ceil(filteredQueries.length / QUERIES_PER_PAGE));
                      const page = Math.min(queryPage, totalQueryPages);
                      const pageQueries = filteredQueries.slice((page - 1) * QUERIES_PER_PAGE, page * QUERIES_PER_PAGE);
                      const allOnPageSelected = pageQueries.length > 0 && pageQueries.every((q) => selectedQueries.has(q.query));
                      const toggleQuery = (q: string) => setSelectedQueries((prev) => {
                        const next = new Set(prev);
                        if (next.has(q)) next.delete(q); else next.add(q);
                        return next;
                      });
                      const toggleAllOnPage = () => setSelectedQueries((prev) => {
                        const next = new Set(prev);
                        pageQueries.forEach((q) => { if (allOnPageSelected) next.delete(q.query); else next.add(q.query); });
                        return next;
                      });
                      const runSearch = () => { setQuerySearch(querySearchInput); setQueryPage(1); };
                      return (
                        <>
                          <div className="seo-query-search">
                            <input
                              type="text"
                              className="form-input"
                              placeholder="Search queries…"
                              value={querySearchInput}
                              onChange={(e) => setQuerySearchInput(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
                            />
                            <button type="button" className="filter-tab" onClick={runSearch}>Search</button>
                          </div>
                          {filteredQueries.length > 0
                            ? <table className="seo-table">
                                <thead>
                                  <tr>
                                    <th style={{ width: 24 }}>
                                      <input type="checkbox" checked={allOnPageSelected} onChange={toggleAllOnPage} title="Select all on this page" />
                                    </th>
                                    <th>Query</th><th>Clicks</th><th>Impr.</th><th>CTR</th><th>Pos.</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {pageQueries.map((row) => (
                                    <tr key={row.query}>
                                      <td>
                                        <input
                                          type="checkbox"
                                          checked={selectedQueries.has(row.query)}
                                          onChange={() => toggleQuery(row.query)}
                                        />
                                      </td>
                                      <td className="seo-page-url" title={row.query}>{row.query}</td>
                                      <td>{row.clicks.toLocaleString()}</td>
                                      <td>{row.impressions.toLocaleString()}</td>
                                      <td>{row.ctr}%</td>
                                      <td>{row.position}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            : <p className="page-subtitle" style={{ padding: '12px 0' }}>No queries match "{querySearch}".</p>}
                          {totalQueryPages > 1 && (
                            <div className="seo-pagination">
                              <button type="button" disabled={page === 1} onClick={() => setQueryPage(page - 1)}>‹</button>
                              {Array.from({ length: totalQueryPages }, (_, i) => i + 1).map((p) => (
                                <button
                                  key={p}
                                  type="button"
                                  className={p === page ? 'active' : ''}
                                  onClick={() => setQueryPage(p)}
                                >
                                  {p}
                                </button>
                              ))}
                              <button type="button" disabled={page === totalQueryPages} onClick={() => setQueryPage(page + 1)}>›</button>
                            </div>
                          )}
                        </>
                      );
                    })()
                  : <p className="page-subtitle" style={{ padding: '12px 0' }}>No query data available.</p>}
              </div>
            </div>

            {/* ── Keyword Rankings (manual) ── */}
            <div className="seo-section" style={!canEdit && manual.keyword_rankings.length === 0 ? { display: 'none' } : undefined}>
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
                  <div className="seo-manual-col-headers">
                    <span style={{ flex: 1 }}>Keyword</span>
                    <span style={{ width: 80 }}>Rank #</span>
                    <span style={{ width: 80 }}>Change ±</span>
                    <span style={{ width: 28 }} />
                  </div>
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
            <div className="seo-section" style={!canEdit && manual.targets.length === 0 ? { display: 'none' } : undefined}>
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
                  <div className="seo-manual-col-headers">
                    <span style={{ flex: 1 }}>Target name</span>
                    <span style={{ width: 80 }}>Target</span>
                    <span style={{ width: 80 }}>Achieved</span>
                    <span style={{ width: 60 }}>Unit</span>
                    <span style={{ width: 28 }} />
                  </div>
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

            {/* ── Key Insights ── */}
            <div className="seo-section" style={!canEdit && !manual.key_insights ? { display: 'none' } : undefined}>
              <h3 className="seo-section__title">
                Key Insights
                {canEdit && (
                  <button className="seo-manual-edit-btn" onClick={() => openManualPanel(manualPanel === 'insights' ? null : 'insights')}>
                    <Edit2 size={11} /> {manualPanel === 'insights' ? 'Cancel' : 'Edit'}
                  </button>
                )}
              </h3>

              {manualPanel === 'insights' && canEdit && (
                <div className="seo-manual-panel">
                  <textarea
                    className="seo-insights-editor"
                    placeholder={`<ul>\n  <li>Domain Authority 4 → 5</li>\n  <li>Priority keywords in Top 5</li>\n</ul>`}
                    value={manualEdit.key_insights}
                    onChange={(e) => setManualEdit({ ...manualEdit, key_insights: e.target.value })}
                  />
                  <div className="seo-manual-actions" style={{ marginTop: 10 }}>
                    <button className="seo-inline-save" onClick={saveManual} disabled={manualSaving}>{manualSaving ? 'Saving…' : 'Save'}</button>
                  </div>
                </div>
              )}

              {manual.key_insights
                ? <div className="seo-insights-display" dangerouslySetInnerHTML={{ __html: manual.key_insights }} />
                : !manualPanel && <p className="page-subtitle" style={{ padding: '12px 0' }}>{canEdit ? 'Click Edit to add key insights.' : 'No insights yet.'}</p>}
            </div>

            {/* ── GMB ── */}
            {(() => {
              const hasGmb = manual.gmb_rating != null || manual.gmb_reviews != null || manual.gmb_calls != null || manual.gmb_bookings != null || manual.gmb_website_clicks != null || !!manual.gmb_overview || !!manual.gmb_profile_url;
              if (!canEdit && !hasGmb) return null;
              return (
                <div className="seo-section">
                  <h3 className="seo-section__title">
                    <Star size={13} style={{ marginRight: 6 }} />Google My Business
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
                          <label className="seo-inline-label">Calls</label>
                          <input className="form-input seo-inline-input" placeholder="45" type="number"
                            value={manualEdit.gmb_calls ?? ''} onChange={(e) => setManualEdit({ ...manualEdit, gmb_calls: e.target.value ? Number(e.target.value) : null })} />
                        </div>
                        <div className="seo-inline-field">
                          <label className="seo-inline-label">Bookings</label>
                          <input className="form-input seo-inline-input" placeholder="12" type="number"
                            value={manualEdit.gmb_bookings ?? ''} onChange={(e) => setManualEdit({ ...manualEdit, gmb_bookings: e.target.value ? Number(e.target.value) : null })} />
                        </div>
                        <div className="seo-inline-field">
                          <label className="seo-inline-label">Website Clicks</label>
                          <input className="form-input seo-inline-input" placeholder="230" type="number"
                            value={manualEdit.gmb_website_clicks ?? ''} onChange={(e) => setManualEdit({ ...manualEdit, gmb_website_clicks: e.target.value ? Number(e.target.value) : null })} />
                        </div>
                        <div className="seo-inline-field">
                          <label className="seo-inline-label">GMB Profile URL</label>
                          <input className="form-input seo-inline-input" placeholder="https://g.page/…"
                            value={manualEdit.gmb_profile_url} onChange={(e) => setManualEdit({ ...manualEdit, gmb_profile_url: e.target.value })} />
                        </div>
                      </div>
                      <div className="seo-inline-field" style={{ marginTop: 10 }}>
                        <label className="seo-inline-label">Overview</label>
                        <textarea className="form-input seo-gmb-overview-input" placeholder="Brief description of GMB performance…"
                          value={manualEdit.gmb_overview} onChange={(e) => setManualEdit({ ...manualEdit, gmb_overview: e.target.value })} />
                      </div>
                      <div className="seo-manual-actions" style={{ marginTop: 12 }}>
                        <button className="seo-inline-save" onClick={saveManual} disabled={manualSaving}>{manualSaving ? 'Saving…' : 'Save'}</button>
                      </div>
                    </div>
                  )}
                  <div className="seo-gmb-grid">
                    {manual.gmb_rating != null && (<div className="seo-gmb-card"><Star size={14} className="seo-gmb-icon seo-gmb-icon--star" /><div><p className="seo-card__val">{Number(manual.gmb_rating).toFixed(1)}</p><p className="seo-card__label">Rating</p></div></div>)}
                    {manual.gmb_reviews != null && (<div className="seo-gmb-card"><FileText size={14} className="seo-gmb-icon" /><div><p className="seo-card__val">{manual.gmb_reviews.toLocaleString()}</p><p className="seo-card__label">Reviews</p></div></div>)}
                    {manual.gmb_calls != null && (<div className="seo-gmb-card"><MousePointer size={14} className="seo-gmb-icon" /><div><p className="seo-card__val">{manual.gmb_calls.toLocaleString()}</p><p className="seo-card__label">Calls</p></div></div>)}
                    {manual.gmb_bookings != null && (<div className="seo-gmb-card"><Check size={14} className="seo-gmb-icon" /><div><p className="seo-card__val">{manual.gmb_bookings.toLocaleString()}</p><p className="seo-card__label">Bookings</p></div></div>)}
                    {manual.gmb_website_clicks != null && (<div className="seo-gmb-card"><Globe size={14} className="seo-gmb-icon" /><div><p className="seo-card__val">{manual.gmb_website_clicks.toLocaleString()}</p><p className="seo-card__label">Website Clicks</p></div></div>)}
                  </div>
                  {manual.gmb_overview && <p className="seo-gmb-overview-text">{manual.gmb_overview}</p>}
                  {manual.gmb_profile_url && <div className="seo-gmb-links"><a href={manual.gmb_profile_url} target="_blank" rel="noreferrer" className="seo-gmb-link"><Star size={11} /> GMB Profile</a></div>}
                </div>
              );
            })()}

            {/* ── Organic Form Submissions ── */}
            {(canEdit || manual.organic_form_data.length > 0) && (
              <div className="seo-section">
                <h3 className="seo-section__title">
                  <FileText size={13} style={{ marginRight: 6 }} />Organic Form Submissions
                  {canEdit && (
                    <button className="seo-manual-edit-btn" onClick={() => openManualPanel(manualPanel === 'organic' ? null : 'organic')}>
                      <Edit2 size={11} /> {manualPanel === 'organic' ? 'Cancel' : 'Edit'}
                    </button>
                  )}
                </h3>
                {manualPanel === 'organic' && canEdit && (
                  <div className="seo-manual-panel">
                    <div className="seo-manual-col-headers">
                      <span style={{ flex: 1 }}>Page URL</span>
                      <span style={{ width: 110 }}>Submissions</span>
                      <span style={{ width: 28 }} />
                    </div>
                    {manualEdit.organic_form_data.map((row, i) => (
                      <div key={i} className="seo-manual-row">
                        <input className="form-input seo-manual-input" placeholder="https://example.com/contact" value={row.url}
                          onChange={(e) => { const v = e.target.value; setManualEdit(prev => { const a = [...prev.organic_form_data]; a[i] = { ...a[i], url: v }; return { ...prev, organic_form_data: a }; }); }} />
                        <input className="form-input seo-manual-input" style={{ flex: '0 0 110px' }} type="number" placeholder="0" value={row.count || ''}
                          onChange={(e) => { const v = Number(e.target.value); setManualEdit(prev => { const a = [...prev.organic_form_data]; a[i] = { ...a[i], count: v }; return { ...prev, organic_form_data: a }; }); }} />
                        <button className="seo-manual-del" onClick={() => setManualEdit(prev => ({ ...prev, organic_form_data: prev.organic_form_data.filter((_, j) => j !== i) }))}><Trash2 size={13} /></button>
                      </div>
                    ))}
                    <div className="seo-manual-actions">
                      <button className="seo-manual-add" onClick={() => setManualEdit(prev => ({ ...prev, organic_form_data: [...prev.organic_form_data, { url: '', count: 0 }] }))}><Plus size={12} /> Add page</button>
                      <button className="seo-inline-save" onClick={saveManual} disabled={manualSaving}>{manualSaving ? 'Saving…' : 'Save'}</button>
                    </div>
                  </div>
                )}
                {manual.organic_form_data.length > 0
                  ? <table className="seo-table">
                      <thead><tr><th>Page URL</th><th>Submissions</th></tr></thead>
                      <tbody>
                        {manual.organic_form_data.map((row, i) => (
                          <tr key={i}><td className="seo-page-url" title={row.url}>{row.url}</td><td style={{ fontWeight: 700 }}>{row.count.toLocaleString()}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  : !manualPanel && <p className="page-subtitle" style={{ padding: '12px 0' }}>Click Edit to add form submission data.</p>}
              </div>
            )}

            {/* ── Social Media Report ── */}
            {(canEdit || !!manual.linkedin_data || !!manual.social_media_data) && (
              <div className="seo-section">
                <h2 className="seo-section__title" style={{ fontSize: 17, fontWeight: 700, borderBottom: 'none', marginBottom: 4 }}>
                  Social Media Report
                </h2>

                {/* Platform tabs */}
                <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
                  {(['linkedin', 'instagram', 'facebook'] as const).map((tab) => (
                    <button key={tab} type="button" onClick={() => setSocialTab(tab)}
                      style={{
                        padding: '8px 16px', fontSize: 13, fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer',
                        borderBottom: socialTab === tab ? '2px solid var(--brand,#2563eb)' : '2px solid transparent',
                        color: socialTab === tab ? 'var(--brand,#2563eb)' : 'var(--ink-muted)',
                        marginBottom: -1,
                      }}>
                      {tab === 'linkedin' ? 'LinkedIn' : tab === 'instagram' ? 'Instagram' : 'Facebook'}
                    </button>
                  ))}
                  {showTiktok ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <button type="button" onClick={() => setSocialTab('tiktok')}
                        style={{
                          padding: '8px 16px', fontSize: 13, fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer',
                          borderBottom: socialTab === 'tiktok' ? '2px solid var(--brand,#2563eb)' : '2px solid transparent',
                          color: socialTab === 'tiktok' ? 'var(--brand,#2563eb)' : 'var(--ink-muted)',
                          marginBottom: -1,
                        }}>
                        TikTok
                      </button>
                      {canEdit && (
                        <button type="button" title="Remove TikTok"
                          onClick={() => { setShowTiktok(false); if (socialTab === 'tiktok') setSocialTab('facebook'); }}
                          style={{ fontSize: 14, lineHeight: 1, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)', padding: '0 4px', marginBottom: -1 }}>
                          −
                        </button>
                      )}
                    </div>
                  ) : canEdit && (
                    <button type="button" onClick={() => { setShowTiktok(true); setSocialTab('tiktok'); }}
                      style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, background: 'none', border: '1px dashed var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--ink-muted)', marginLeft: 4, marginBottom: 4 }}>
                      + TikTok
                    </button>
                  )}
                  {canEdit && (
                    <button type="button" className="seo-manual-edit-btn" style={{ marginLeft: 'auto', marginRight: 4 }}
                      onClick={() => openManualPanel(manualPanel === 'social' ? null : 'social')}>
                      {manualPanel === 'social'
                        ? <><X size={11} /> Cancel</>
                        : <><Edit2 size={11} /> Edit</>}
                    </button>
                  )}
                </div>

                {/* LinkedIn tab — existing section inline */}
                {socialTab === 'linkedin' && (() => {
                  const liEdit = manualEdit.linkedin_data!;
                  const setLi = (patch: Partial<LinkedInData>) => setManualEdit(prev => ({ ...prev, linkedin_data: { ...prev.linkedin_data!, ...patch } }));
                  const setLiPost = (i: number, field: keyof LinkedInPost, val: string | number) =>
                    setManualEdit(prev => { const posts = [...prev.linkedin_data!.posts]; posts[i] = { ...posts[i], [field]: val }; return { ...prev, linkedin_data: { ...prev.linkedin_data!, posts } }; });
                  return (
                    <>
                      {manualPanel === 'social' && canEdit && (
                        <div className="seo-manual-panel">
                          <div className="seo-manual-grid" style={{ marginBottom: 12 }}>
                            <div className="seo-inline-field"><label className="seo-inline-label">Total Impressions</label><input className="form-input seo-inline-input" type="number" value={liEdit.impressions ?? ''} onChange={(e) => setLi({ impressions: e.target.value ? Number(e.target.value) : null })} /></div>
                            <div className="seo-inline-field"><label className="seo-inline-label">Impressions — Organic</label><input className="form-input seo-inline-input" type="number" value={liEdit.impressions_organic ?? ''} onChange={(e) => setLi({ impressions_organic: e.target.value ? Number(e.target.value) : null })} /></div>
                            <div className="seo-inline-field"><label className="seo-inline-label">Impressions — Sponsored</label><input className="form-input seo-inline-input" type="number" value={liEdit.impressions_sponsored ?? ''} onChange={(e) => setLi({ impressions_sponsored: e.target.value ? Number(e.target.value) : null })} /></div>
                            <div className="seo-inline-field"><label className="seo-inline-label">Total Clicks</label><input className="form-input seo-inline-input" type="number" value={liEdit.clicks ?? ''} onChange={(e) => setLi({ clicks: e.target.value ? Number(e.target.value) : null })} /></div>
                            <div className="seo-inline-field"><label className="seo-inline-label">Clicks — Organic</label><input className="form-input seo-inline-input" type="number" value={liEdit.clicks_organic ?? ''} onChange={(e) => setLi({ clicks_organic: e.target.value ? Number(e.target.value) : null })} /></div>
                            <div className="seo-inline-field"><label className="seo-inline-label">Clicks — Sponsored</label><input className="form-input seo-inline-input" type="number" value={liEdit.clicks_sponsored ?? ''} onChange={(e) => setLi({ clicks_sponsored: e.target.value ? Number(e.target.value) : null })} /></div>
                            <div className="seo-inline-field"><label className="seo-inline-label">Total Followers</label><input className="form-input seo-inline-input" type="number" value={manualEdit.linkedin_followers ?? ''} onChange={(e) => setManualEdit(prev => ({ ...prev, linkedin_followers: e.target.value ? Number(e.target.value) : null }))} /></div>
                            <div className="seo-inline-field"><label className="seo-inline-label">New Followers</label><input className="form-input seo-inline-input" type="number" value={liEdit.new_followers ?? ''} onChange={(e) => setLi({ new_followers: e.target.value ? Number(e.target.value) : null })} /></div>
                            <div className="seo-inline-field"><label className="seo-inline-label">New Followers Period</label><input className="form-input seo-inline-input" value={liEdit.new_followers_period} onChange={(e) => setLi({ new_followers_period: e.target.value })} /></div>
                            <div className="seo-inline-field"><label className="seo-inline-label">Growth Rate</label><input className="form-input seo-inline-input" value={liEdit.growth_rate} onChange={(e) => setLi({ growth_rate: e.target.value })} /></div>
                            <div className="seo-inline-field"><label className="seo-inline-label">Growth Label</label><input className="form-input seo-inline-input" value={liEdit.growth_label} onChange={(e) => setLi({ growth_label: e.target.value })} /></div>
                            <div className="seo-inline-field"><label className="seo-inline-label">LinkedIn URL</label><input className="form-input seo-inline-input" value={manualEdit.linkedin_url} onChange={(e) => setManualEdit(prev => ({ ...prev, linkedin_url: e.target.value }))} /></div>
                          </div>
                          <p className="seo-inline-label" style={{ marginBottom: 6 }}>Top Posts</p>
                          <div className="seo-manual-col-headers"><span style={{ flex: 1 }}>Post title</span><span style={{ width: 90 }}>Impressions</span><span style={{ width: 70 }}>Clicks</span><span style={{ width: 28 }} /></div>
                          {liEdit.posts.map((p, i) => (
                            <div key={i} className="seo-manual-row">
                              <input className="form-input seo-manual-input" placeholder="Post title" value={p.title} onChange={(e) => setLiPost(i, 'title', e.target.value)} />
                              <input className="form-input seo-manual-input" style={{ flex: '0 0 90px' }} type="number" value={p.impressions || ''} onChange={(e) => setLiPost(i, 'impressions', Number(e.target.value))} />
                              <input className="form-input seo-manual-input" style={{ flex: '0 0 70px' }} type="number" value={p.clicks || ''} onChange={(e) => setLiPost(i, 'clicks', Number(e.target.value))} />
                              <button className="seo-manual-del" onClick={() => setManualEdit(prev => ({ ...prev, linkedin_data: { ...prev.linkedin_data!, posts: prev.linkedin_data!.posts.filter((_, j) => j !== i) } }))}><Trash2 size={13} /></button>
                            </div>
                          ))}
                          <div className="seo-manual-actions" style={{ marginTop: 8 }}>
                            <button className="seo-manual-add" onClick={() => setManualEdit(prev => ({ ...prev, linkedin_data: { ...prev.linkedin_data!, posts: [...prev.linkedin_data!.posts, { title: '', impressions: 0, clicks: 0 }] } }))}><Plus size={12} /> Add post</button>
                            <button className="seo-inline-save" onClick={saveManual} disabled={manualSaving}>{manualSaving ? 'Saving…' : 'Save'}</button>
                          </div>
                        </div>
                      )}
                      {(() => {
                        const li = manual.linkedin_data;
                        if (!li) return !manualPanel ? <p className="page-subtitle" style={{ padding: '12px 0' }}>{canEdit ? 'Click + to add LinkedIn analytics.' : 'No LinkedIn data yet.'}</p> : null;
                        const impOrg = li.impressions_organic ?? 0, impSpon = li.impressions_sponsored ?? 0, impTot = impOrg + impSpon || 1;
                        const clkOrg = li.clicks_organic ?? 0, clkSpon = li.clicks_sponsored ?? 0, clkTot = clkOrg + clkSpon || 1;
                        const impSponPct = Math.round((impSpon / impTot) * 100), impOrgPct = 100 - impSponPct;
                        const clkSponPct = Math.round((clkSpon / clkTot) * 100), clkOrgPct = 100 - clkSponPct;
                        return (
                          <>
                            <div className="seo-li-stats">
                              {li.impressions != null && <div className="seo-li-stat"><p className="seo-card__val">{li.impressions.toLocaleString()}</p><p className="seo-card__label">Total Impressions</p></div>}
                              {li.clicks != null && <div className="seo-li-stat"><p className="seo-card__val">{li.clicks.toLocaleString()}</p><p className="seo-card__label">Total Clicks</p>{(li.clicks_organic != null || li.clicks_sponsored != null) && <p className="seo-li-sub">{li.clicks_organic?.toLocaleString()} organic · {li.clicks_sponsored?.toLocaleString()} paid</p>}</div>}
                              {manual.linkedin_followers != null && <div className="seo-li-stat"><p className="seo-card__val">{manual.linkedin_followers.toLocaleString()}</p><p className="seo-card__label">Total Followers</p>{li.new_followers != null && <p className="seo-li-sub">↑ {li.new_followers.toLocaleString()} new{li.new_followers_period ? ` in ${li.new_followers_period}` : ''}</p>}</div>}
                              {li.growth_rate && <div className="seo-li-stat"><p className="seo-card__val seo-li-growth">{li.growth_rate}</p><p className="seo-card__label">Follower Growth Rate</p>{li.growth_label && <p className="seo-li-sub">↑ {li.growth_label}</p>}</div>}
                            </div>
                            {(impOrg > 0 || impSpon > 0) && (
                              <div className="seo-li-breakdown-row">
                                <div className="seo-li-breakdown">
                                  <p className="seo-li-breakdown__title">Impressions breakdown</p>
                                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                                    <div style={{ flex: 1 }}><div className="seo-li-bar-wrap"><div className="seo-li-bar-fill seo-li-bar-fill--spon" style={{ width: `${Math.max(impSponPct, 2)}%` }} /></div><p style={{ margin: '3px 0 0', fontSize: 11, color: 'var(--ink-muted)' }}>Sponsored {impSponPct}%</p></div>
                                    <div style={{ flex: 1 }}><div className="seo-li-bar-wrap seo-li-bar-wrap--org"><div className="seo-li-bar-fill seo-li-bar-fill--org" style={{ width: `${Math.max(impOrgPct, 2)}%` }} /></div><p style={{ margin: '3px 0 0', fontSize: 11, color: 'var(--ink-muted)' }}>Organic {impOrgPct}%</p></div>
                                  </div>
                                </div>
                                <div className="seo-li-breakdown">
                                  <p className="seo-li-breakdown__title">Clicks breakdown</p>
                                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                                    <div style={{ flex: 1 }}><div className="seo-li-bar-wrap"><div className="seo-li-bar-fill seo-li-bar-fill--spon" style={{ width: `${Math.max(clkSponPct, 2)}%` }} /></div><p style={{ margin: '3px 0 0', fontSize: 11, color: 'var(--ink-muted)' }}>Sponsored {clkSponPct}%</p></div>
                                    <div style={{ flex: 1 }}><div className="seo-li-bar-wrap seo-li-bar-wrap--org"><div className="seo-li-bar-fill seo-li-bar-fill--org" style={{ width: `${Math.max(clkOrgPct, 2)}%` }} /></div><p style={{ margin: '3px 0 0', fontSize: 11, color: 'var(--ink-muted)' }}>Organic {clkOrgPct}%</p></div>
                                  </div>
                                </div>
                              </div>
                            )}
                            {li.posts.length > 0 && (() => {
                              const hasImpressions = li.posts.some(p => p.impressions > 0);
                              const hasClicks = li.posts.some(p => p.clicks > 0);
                              return (
                                <>
                                  <p className="seo-li-posts-title">Top performing LinkedIn posts</p>
                                  <table className="seo-table"><thead><tr><th>Post</th>{hasImpressions && <th>Impressions</th>}{hasClicks && <th>Clicks</th>}{hasImpressions && <th>CTR</th>}</tr></thead>
                                    <tbody>{li.posts.map((p, i) => <tr key={i}><td className="seo-source">{p.title}</td>{hasImpressions && <td>{p.impressions.toLocaleString()}</td>}{hasClicks && <td>{p.clicks.toLocaleString()}</td>}{hasImpressions && <td>{p.impressions > 0 ? ((p.clicks / p.impressions) * 100).toFixed(2) : '0'}%</td>}</tr>)}</tbody>
                                  </table>
                                </>
                              );
                            })()}
                            {manual.linkedin_url && <div style={{ marginTop: 12 }}><a href={manual.linkedin_url} target="_blank" rel="noreferrer" className="seo-gmb-link"><Linkedin size={11} /> LinkedIn Page</a></div>}
                          </>
                        );
                      })()}
                    </>
                  );
                })()}

                {/* Instagram / Facebook / TikTok tabs */}
                {socialTab !== 'linkedin' && (() => {
                  const platform = socialTab as 'instagram' | 'facebook' | 'tiktok';
                  const emptyPlat = (): SocialPlatformData => ({ views: null, from_organic: null, from_ads: null, reach: null, total_followers: null, new_followers: null, interactions: null, watch_time: null, likes: null });
                  const smd = manual.social_media_data;
                  const data = smd?.[platform];
                  const editData = manualEdit.social_media_data?.[platform] ?? emptyPlat();
                  const setField = (field: keyof SocialPlatformData, val: string | number | null) =>
                    setManualEdit(prev => ({
                      ...prev,
                      social_media_data: {
                        instagram: emptyPlat(), facebook: emptyPlat(), tiktok: emptyPlat(),
                        ...prev.social_media_data,
                        [platform]: { ...(prev.social_media_data?.[platform] ?? emptyPlat()), [field]: val },
                      },
                    }));
                  const numField = (field: keyof SocialPlatformData, label: string, placeholder: string) => (
                    <div className="seo-inline-field">
                      <label className="seo-inline-label">{label}</label>
                      <input className="form-input seo-inline-input" type="number" placeholder={placeholder}
                        value={(editData[field] as number | null) ?? ''}
                        onChange={(e) => setField(field, e.target.value ? Number(e.target.value) : null)} />
                    </div>
                  );
                  const fields: Record<string, JSX.Element[]> = {
                    instagram: [
                      numField('views', 'Views', 'e.g. 42000'),
                      numField('from_organic', 'From Organic', 'e.g. 30000'),
                      numField('from_ads', 'From Ads', 'e.g. 12000'),
                      numField('reach', 'Reach', 'e.g. 15000'),
                      numField('total_followers', 'Total Followers', 'e.g. 3200'),
                      numField('new_followers', 'New Followers', 'e.g. 120'),
                      numField('interactions', 'Interactions', 'e.g. 850'),
                    ],
                    facebook: [
                      numField('views', 'Views', 'e.g. 20000'),
                      numField('from_organic', 'From Organic', 'e.g. 12000'),
                      numField('from_ads', 'From Ads', 'e.g. 8000'),
                      numField('interactions', 'Interactions', 'e.g. 400'),
                      <div key="watch_time" className="seo-inline-field">
                        <label className="seo-inline-label">Watch Time</label>
                        <input className="form-input seo-inline-input" placeholder="e.g. 1h 20m"
                          value={(editData.watch_time as string | null) ?? ''}
                          onChange={(e) => setField('watch_time', e.target.value || null)} />
                      </div>,
                    ],
                    tiktok: [
                      numField('views', 'Views', 'e.g. 50000'),
                      numField('total_followers', 'Followers', 'e.g. 1800'),
                      numField('likes', 'Likes', 'e.g. 3400'),
                    ],
                  };
                  const cards: Record<string, ([string, string] | null)[]> = {
                    instagram: [
                      data?.views != null ? ['Views', data.views.toLocaleString()] : null,
                      data?.from_organic != null ? ['From Organic', data.from_organic.toLocaleString()] : null,
                      data?.from_ads != null ? ['From Ads', data.from_ads.toLocaleString()] : null,
                      data?.reach != null ? ['Reach', data.reach.toLocaleString()] : null,
                      data?.total_followers != null ? ['Total Followers', data.total_followers.toLocaleString()] : null,
                      data?.new_followers != null ? ['New Followers', data.new_followers.toLocaleString()] : null,
                      data?.interactions != null ? ['Interactions', data.interactions.toLocaleString()] : null,
                    ],
                    facebook: [
                      data?.views != null ? ['Views', data.views.toLocaleString()] : null,
                      data?.from_organic != null ? ['From Organic', data.from_organic.toLocaleString()] : null,
                      data?.from_ads != null ? ['From Ads', data.from_ads.toLocaleString()] : null,
                      data?.interactions != null ? ['Interactions', data.interactions.toLocaleString()] : null,
                      data?.watch_time != null ? ['Watch Time', data.watch_time] : null,
                    ],
                    tiktok: [
                      data?.views != null ? ['Views', data.views.toLocaleString()] : null,
                      data?.total_followers != null ? ['Followers', data.total_followers.toLocaleString()] : null,
                      data?.likes != null ? ['Likes', data.likes.toLocaleString()] : null,
                    ],
                  };
                  const activeCards = (cards[platform] ?? []).filter(Boolean) as [string, string][];
                  const hasData = activeCards.length > 0;

                  const StatCard = ({ label, val, sub, accent }: { label: string; val: string; sub?: string; accent?: string }) => (
                    <div className="seo-li-stat">
                      <p className="seo-card__val" style={accent ? { color: accent } : {}}>{val}</p>
                      <p className="seo-card__label">{label}</p>
                      {sub && <p className="seo-li-sub">{sub}</p>}
                    </div>
                  );

                  const SplitBar = ({ label, organic, ads }: { label: string; organic: number | null; ads: number | null }) => {
                    if (organic == null && ads == null) return null;
                    const tot = (organic ?? 0) + (ads ?? 0) || 1;
                    const oPct = Math.round(((organic ?? 0) / tot) * 100);
                    const aPct = 100 - oPct;
                    return (
                      <div style={{ marginBottom: 20 }}>
                        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label} breakdown</p>
                        <div style={{ display: 'flex', gap: 12 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ height: 8, background: 'var(--bg-sand)', borderRadius: 4, overflow: 'hidden', marginBottom: 4 }}>
                              <div style={{ height: '100%', width: `${Math.max(oPct, 2)}%`, background: '#22c55e', borderRadius: 4 }} />
                            </div>
                            <p style={{ fontSize: 11, color: 'var(--ink-muted)', margin: 0 }}>Organic {oPct}% <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{(organic ?? 0).toLocaleString()}</span></p>
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ height: 8, background: 'var(--bg-sand)', borderRadius: 4, overflow: 'hidden', marginBottom: 4 }}>
                              <div style={{ height: '100%', width: `${Math.max(aPct, 2)}%`, background: '#6366f1', borderRadius: 4 }} />
                            </div>
                            <p style={{ fontSize: 11, color: 'var(--ink-muted)', margin: 0 }}>Ads {aPct}% <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{(ads ?? 0).toLocaleString()}</span></p>
                          </div>
                        </div>
                      </div>
                    );
                  };

                  return (
                    <>
                      {manualPanel === 'social' && canEdit && (
                        <div className="seo-manual-panel">
                          <div className="seo-manual-grid">
                            {fields[platform]?.map((f, i) => <div key={i}>{f}</div>)}
                          </div>
                          <div className="seo-manual-actions" style={{ marginTop: 12 }}>
                            <button className="seo-inline-save" onClick={saveManual} disabled={manualSaving}>{manualSaving ? 'Saving…' : 'Save'}</button>
                          </div>
                        </div>
                      )}
                      {hasData ? (
                        <>
                          {platform === 'instagram' && data && (
                            <>
                              <div className="seo-li-stats">
                                {data.views != null && <StatCard label="Views" val={data.views.toLocaleString()} />}
                                {data.reach != null && <StatCard label="Reach" val={data.reach.toLocaleString()} />}
                                {data.total_followers != null && <StatCard label="Total Followers" val={data.total_followers.toLocaleString()} sub={data.new_followers != null ? `↑ ${data.new_followers.toLocaleString()} new` : undefined} />}
                                {data.interactions != null && <StatCard label="Interactions" val={data.interactions.toLocaleString()} accent="#f59e0b" />}
                              </div>
                              <SplitBar label="Views" organic={data.from_organic} ads={data.from_ads} />
                            </>
                          )}
                          {platform === 'facebook' && data && (
                            <>
                              <div className="seo-li-stats">
                                {data.views != null && <StatCard label="Views" val={data.views.toLocaleString()} />}
                                {data.interactions != null && <StatCard label="Interactions" val={data.interactions.toLocaleString()} accent="#f59e0b" />}
                                {data.watch_time != null && <StatCard label="Watch Time" val={data.watch_time} />}
                              </div>
                              <SplitBar label="Views" organic={data.from_organic} ads={data.from_ads} />
                            </>
                          )}
                          {platform === 'tiktok' && data && (
                            <div className="seo-li-stats">
                              {data.views != null && <StatCard label="Views" val={data.views.toLocaleString()} />}
                              {data.total_followers != null && <StatCard label="Followers" val={data.total_followers.toLocaleString()} />}
                              {data.likes != null && <StatCard label="Likes" val={data.likes.toLocaleString()} accent="#f43f5e" />}
                            </div>
                          )}
                        </>
                      ) : (
                        !manualPanel && <p className="page-subtitle" style={{ padding: '12px 0' }}>{canEdit ? 'Click Edit to add data.' : `No ${platform} data yet.`}</p>
                      )}
                    </>
                  );
                })()}
              </div>
            )}

          </>
        )}
      </div>
    </Layout>
  );
}
