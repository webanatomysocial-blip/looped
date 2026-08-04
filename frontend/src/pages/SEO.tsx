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
interface OrganicForm  { date: string; source: string; contact: string; }
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
  key_insights: string | null;
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
  // Shared
  key_insights: string | null;
}
interface SocialMediaData {
  instagram: SocialPlatformData;
  facebook: SocialPlatformData;
  tiktok: SocialPlatformData;
}
interface GmbLocation {
  name: string;
  rating: number | null;
  reviews: number | null;
  profile_url: string;
  overview: string;
  calls: number | null;
  bookings: number | null;
  website_clicks: number | null;
  key_insights: string;
  prev_rating: number | null;
  prev_reviews: number | null;
  prev_calls: number | null;
  prev_bookings: number | null;
  prev_website_clicks: number | null;
}

interface LastPeriodPlanItem {
  area: string;
  action: string;
  expected: string;
  status: 'done' | 'partial' | 'not_done';
}

interface NextPeriodPlanItem {
  focus: string;
  action: string;
  expected: string;
}

interface PeriodTargets {
  sessions: string;
  leads: string;
  engagement_rate: string;
  instagram_reach: string;
  facebook_reach: string;
}

interface OrganicMetrics {
  views: string | null;
  reach: string | null;
  content_interactions: string | null;
  link_clicks: string | null;
  key_insights: string | null;
  top_post_description: string | null;
  top_post_impressions: string | null;
  channel_plan_action: string | null;
  channel_plan_impressions_target: string | null;
  flags_risks: string | null;
}

interface PaidMetrics {
  spend: string | null;
  reach: string | null;
  reach_change: string | null;
  cost_per_reach: string | null;
  key_insights: string | null;
}

interface MetaOrganic {
  instagram: OrganicMetrics;
  facebook: OrganicMetrics;
}

interface PerformanceMarketing {
  meta_paid: PaidMetrics;
  linkedin_paid: PaidMetrics;
  instagram_paid?: PaidMetrics;
  facebook_paid?: PaidMetrics;
}

interface ManualData {
  keyword_rankings: KeywordRank[];
  targets: Target[];
  key_insights: string;
  linkedin_data: LinkedInData | null;
  social_media_data: SocialMediaData | null;
  organic_form_data: OrganicForm[];
  gmb_locations: GmbLocation[];
  // Structured sections
  executive_summary: string;
  sig_change_whys: Record<string, string>;
  last_period_plan: LastPeriodPlanItem[];
  best_performing_asset: string;
  next_period_plan: NextPeriodPlanItem[];
  period_targets: PeriodTargets;
  // Social & Performance Marketing
  meta_organic: MetaOrganic;
  linkedin_organic: OrganicMetrics;
  performance_marketing: PerformanceMarketing;
  health_score: number;
  health_label: string;
  // legacy flat fields
  gmb_rating: number | null;
  gmb_reviews: number | null;
  gmb_profile_url: string;
  gmb_overview: string;
  gmb_calls: number | null;
  gmb_bookings: number | null;
  gmb_website_clicks: number | null;
  gmb_key_insights: string;
  gmb_prev_rating: number | null;
  gmb_prev_reviews: number | null;
  gmb_prev_calls: number | null;
  gmb_prev_bookings: number | null;
  gmb_prev_website_clicks: number | null;
  linkedin_url: string;
  linkedin_followers: number | null;
}

interface Report {
  traffic: TrafficRow[];
  acquisition: AcqRow[];
  engagement: Engagement;
  prevEngagement: Engagement | null;
  prevAcquisition: AcqRow[];
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
export const parseOrganicDisplay = (metrics: OrganicMetrics | undefined) => {
  if (!metrics) return { viewsVal: '—', reachVal: '—', interactionsVal: '—', linkClicksVal: '—', key_insights: null, top_post_description: null, top_post_impressions: null, channel_plan_action: null, channel_plan_impressions_target: null, flags_risks: null };
  return {
    viewsVal:        metrics.views?.trim()                || '—',
    reachVal:        metrics.reach?.trim()                || '—',
    interactionsVal: metrics.content_interactions?.trim() || '—',
    linkClicksVal:   metrics.link_clicks?.trim()          || '—',
    key_insights:    metrics.key_insights,
    top_post_description:        metrics.top_post_description,
    top_post_impressions:        metrics.top_post_impressions,
    channel_plan_action:         metrics.channel_plan_action,
    channel_plan_impressions_target: metrics.channel_plan_impressions_target,
    flags_risks:                 metrics.flags_risks,
  };
};

export const parsePaidDisplay = (metrics: PaidMetrics | undefined) => {
  if (!metrics) return { spendVal: '—', reachVal: '—', reachBadge: null, costVal: '—', key_insights: null };

  const parseBadge = (changeStr: string | null | undefined) => {
    if (!changeStr || !changeStr.trim()) return null;
    const s = changeStr.trim();
    const isDown = s.includes('↓') || s.includes('-') || s.toLowerCase().includes('down');
    let numStr = s.replace(/[↑↓]/g, '').trim();
    if (!numStr.endsWith('%') && !isNaN(Number(numStr.replace(/,/g, '')))) {
      numStr = `${numStr}%`;
    }
    return { text: `${isDown ? '↓' : '↑'} ${numStr}`, isDown };
  };

  const spendVal = metrics.spend?.trim() || '—';
  let reachVal = metrics.reach?.trim() || '—';
  let reachBadge = parseBadge(metrics.reach_change);

  if (!reachBadge && reachVal !== '—') {
    const m = reachVal.match(/^(.*?)\s+([↑↓].*|\+.*|\-.*|\d+%\s*)$/);
    if (m) {
      reachVal = m[1].trim();
      reachBadge = parseBadge(m[2]);
    }
  }

  const costVal = metrics.cost_per_reach?.trim() || '—';

  return { spendVal, reachVal, reachBadge, costVal, key_insights: metrics.key_insights };
};

function downloadPDF(
  report: Report,
  clientName: string,
  range: string,
  manual: ManualData,
  demoCountry: string,
  selectedAcquisitions: Set<string>,
  selectedDemographics: Set<string>,
  selectedPages: Set<string>,
  selectedQueries: Set<string>,
  agencyName = 'webanatomy',
  customStart = '',
  customEnd = '',
  compareStart = '',
  compareEnd = ''
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

  const showCmp = !!(compareStart && compareEnd && report.prevEngagement);
  const prev = report.prevEngagement;
  const cmpBadge = (cur: number, pre: number | undefined) => {
    if (!showCmp || !pre || pre === 0) return '';
    const pct = Math.round(((cur - pre) / pre) * 100);
    return `<span style="font-size:10px;font-weight:700;margin-left:6px;color:${pct >= 0 ? '#16a34a' : '#dc2626'}">${pct >= 0 ? '▲' : '▼'}${Math.abs(pct)}%</span>`;
  };
  const gmbCmpBadge = (cur: number, pre: number | null) => {
    if (pre == null || pre === 0) return '';
    const pct = Math.round(((cur - pre) / pre) * 100);
    return ` <span style="font-size:10px;font-weight:700;color:${pct >= 0 ? '#16a34a' : '#dc2626'}">${pct >= 0 ? '▲' : '▼'}${Math.abs(pct)}%</span>`;
  };
  const cards = [
    ['Total Users', eng.users.toLocaleString() + cmpBadge(eng.users, prev?.users)],
    ['New Users', eng.newUsers.toLocaleString() + cmpBadge(eng.newUsers, prev?.newUsers)],
    ['Sessions', eng.sessions.toLocaleString() + cmpBadge(eng.sessions, prev?.sessions)],
    ['Avg. Duration', fmtDuration(eng.avgDuration) + cmpBadge(eng.avgDuration, prev?.avgDuration)],
    ['Engagement Rate', `${eng.engagementRate}%` + cmpBadge(eng.engagementRate, prev?.engagementRate)],
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

  // ── Executive Summary ──
  const execHtml = manual.executive_summary ? `
<div class="section-block">
<h2>Executive Summary</h2>
<div class="section"><div class="section-inner" style="font-size:13px;line-height:1.7">${manual.executive_summary}</div></div>
</div>` : '';

  // ── Period Targets ──
  const pt = manual.period_targets;
  const ptCards = [
    pt?.sessions ? ['Target Sessions', pt.sessions] : null,
    pt?.leads ? ['Target Leads', pt.leads] : null,
    pt?.engagement_rate ? ['Target Engagement Rate', pt.engagement_rate] : null,
    pt?.instagram_reach ? ['Instagram Reach Target', pt.instagram_reach] : null,
    pt?.facebook_reach ? ['Facebook Reach Target', pt.facebook_reach] : null,
  ].filter(Boolean) as [string, string][];
  const targetCardsHtml = ptCards.length > 0 ? `
<div class="section-block">
<h2>Period Targets</h2>
<div class="section">
  <div class="section-inner">
    <div class="mini-cards">${ptCards.map(([l, v]) => `<div class="mini-card"><div class="mini-card-val">${v}</div><div class="mini-card-label">${l}</div></div>`).join('')}</div>
  </div>
</div>
</div>` : '';

  // ── Last Period Plan ──
  const lastPlanHtml = manual.last_period_plan && manual.last_period_plan.length > 0 ? `
<div class="section-block">
<h2>Last Period Plan vs Accomplishments</h2>
<div class="section">
  <table>
    <thead><tr><th>Focus Area</th><th>Action Taken</th><th>Expected Result</th><th>Status</th></tr></thead>
    <tbody>
      ${manual.last_period_plan.map((p, i) => `
        <tr style="background:${i % 2 === 0 ? '#f9f9f9' : '#fff'}">
          <td style="padding:8px 12px;font-weight:600">${p.area}</td>
          <td style="padding:8px 12px">${p.action}</td>
          <td style="padding:8px 12px">${p.expected}</td>
          <td style="padding:8px 12px;font-weight:700;color:${p.status === 'done' ? '#16a34a' : p.status === 'partial' ? '#d97706' : '#dc2626'}">
            ${p.status === 'done' ? '✓ Completed' : p.status === 'partial' ? '⚠ Partial' : '✕ Not Done'}
          </td>
        </tr>`).join('')}
    </tbody>
  </table>
</div>
</div>` : '';

  // ── Next Period Plan ──
  const nextPlanHtml = manual.next_period_plan && manual.next_period_plan.length > 0 ? `
<div class="section-block">
<h2>Next Period Plan &amp; Focus</h2>
<div class="section">
  <table>
    <thead><tr><th>Focus Area</th><th>Planned Action</th><th>Expected Impact</th></tr></thead>
    <tbody>
      ${manual.next_period_plan.map((p, i) => `
        <tr style="background:${i % 2 === 0 ? '#f9f9f9' : '#fff'}">
          <td style="padding:8px 12px;font-weight:600">${p.focus}</td>
          <td style="padding:8px 12px">${p.action}</td>
          <td style="padding:8px 12px">${p.expected}</td>
        </tr>`).join('')}
    </tbody>
  </table>
</div>
</div>` : '';

  // ── Highlights & Whys ──
  const sigWhys = manual.sig_change_whys && Object.keys(manual.sig_change_whys).length > 0;
  const highlightsHtml = (sigWhys || manual.best_performing_asset) ? `
<div class="section-block">
<h2>Key Highlights &amp; Insights</h2>
<div class="section">
  <div class="section-inner">
    ${manual.best_performing_asset ? `<p style="font-size:13px;line-height:1.6;margin-bottom:10px"><b>Best Performing Asset:</b> ${manual.best_performing_asset}</p>` : ''}
    ${sigWhys ? `
      <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#888;margin:8px 0 4px">Significant Changes &amp; Reasons</p>
      <ul>${Object.entries(manual.sig_change_whys).map(([k, v]) => `<li style="font-size:12px;margin-bottom:4px"><b>${k}:</b> ${v}</li>`).join('')}</ul>
    ` : ''}
  </div>
</div>
</div>` : '';

  // ── Multi GMB ──
  const gmbMultiHtml = manual.gmb_locations && manual.gmb_locations.length > 0 ? `
<div class="section-block">
<h2>Google My Business Locations</h2>
${manual.gmb_locations.map((loc) => {
  const gmbLocCards = [
    loc.rating != null ? ['Rating', Number(loc.rating).toFixed(1) + gmbCmpBadge(loc.rating, loc.prev_rating)] : null,
    loc.reviews != null ? ['Reviews', Number(loc.reviews).toLocaleString() + gmbCmpBadge(loc.reviews, loc.prev_reviews)] : null,
    loc.calls != null ? ['Calls', Number(loc.calls).toLocaleString() + gmbCmpBadge(loc.calls, loc.prev_calls)] : null,
    loc.bookings != null ? ['Bookings', Number(loc.bookings).toLocaleString() + gmbCmpBadge(loc.bookings, loc.prev_bookings)] : null,
    loc.website_clicks != null ? ['Website Clicks', Number(loc.website_clicks).toLocaleString() + gmbCmpBadge(loc.website_clicks, loc.prev_website_clicks)] : null,
  ].filter(Boolean) as [string, string][];
  return `
  <div class="section" style="margin-bottom:12px">
    <div class="section-inner">
      ${loc.name ? `<h3 style="font-size:13px;font-weight:700;margin-bottom:8px">${loc.name}</h3>` : ''}
      ${gmbLocCards.length > 0 ? `<div class="mini-cards">${gmbLocCards.map(([label, val]) => `<div class="mini-card"><div class="mini-card-val">${val}</div><div class="mini-card-label">${label}</div></div>`).join('')}</div>` : ''}
      ${loc.overview ? `<div class="overview-text">${loc.overview}</div>` : ''}
      ${loc.key_insights ? `<div style="font-size:13px;line-height:1.7;margin-top:8px;color:#333">${loc.key_insights}</div>` : ''}
    </div>
  </div>`;
}).join('')}
</div>` : '';

  // ── Social Media Organic ──
  const renderOrganicBlock = (title: string, metrics: OrganicMetrics | undefined) => {
    if (!metrics || (!metrics.views && !metrics.reach && !metrics.content_interactions && !metrics.link_clicks && !metrics.key_insights)) return '';
    const parsed = parseOrganicDisplay(metrics);

    const cards = [
      parsed.viewsVal        !== '—' ? ['Views',                parsed.viewsVal]        : null,
      parsed.reachVal        !== '—' ? ['Reach',                parsed.reachVal]        : null,
      parsed.interactionsVal !== '—' ? ['Content Interactions', parsed.interactionsVal] : null,
      parsed.linkClicksVal   !== '—' ? ['Link Clicks',          parsed.linkClicksVal]   : null,
    ].filter(Boolean) as [string, string][];

    return `
      <div class="section" style="margin-bottom:14px">
        <div class="section-inner">
          <h3 style="font-size:13px;font-weight:700;margin-bottom:10px;color:#6366f1">${title}</h3>
          ${cards.length ? `<div class="mini-cards">${cards.map(([l, v]) => `<div class="mini-card"><div class="mini-card-val">${v}</div><div class="mini-card-label">${l}</div></div>`).join('')}</div>` : ''}
          ${parsed.key_insights ? `<div style="font-size:13px;line-height:1.7;margin-top:10px;color:#333">${parsed.key_insights}</div>` : ''}
        </div>
      </div>
    `;
  };

  const instaOrgHtml = renderOrganicBlock('Instagram Organic', manual.meta_organic?.instagram);
  const fbOrgHtml = renderOrganicBlock('Facebook Organic', manual.meta_organic?.facebook);
  const liOrgHtml = renderOrganicBlock('LinkedIn Organic', manual.linkedin_organic);

  const socialOrganicHtml = (instaOrgHtml || fbOrgHtml || liOrgHtml) ? `
<div class="section-block">
  <h2>Social Media Report (Organic)</h2>
  ${instaOrgHtml}
  ${fbOrgHtml}
  ${liOrgHtml}
</div>` : '';

  // ── Performance Marketing (Paid) ──
  const renderPaidBlock = (title: string, metrics: PaidMetrics | undefined) => {
    if (!metrics || (!metrics.spend && !metrics.reach && !metrics.cost_per_reach && !metrics.key_insights)) return '';
    const parsed = parsePaidDisplay(metrics);
    const reachValStr = parsed.reachBadge
      ? `${parsed.reachVal} <span style="font-size:11px;font-weight:700;margin-left:4px;color:${parsed.reachBadge.isDown ? '#dc2626' : '#16a34a'}">${parsed.reachBadge.text}</span>`
      : parsed.reachVal;

    const cards = [
      parsed.spendVal !== '—' ? ['Paid Spend', parsed.spendVal] : null,
      parsed.reachVal !== '—' ? ['Paid Reach', reachValStr] : null,
      parsed.costVal !== '—' ? ['Cost / Reach Point', parsed.costVal] : null,
    ].filter(Boolean) as [string, string][];

    return `
      <div class="section" style="margin-bottom:14px">
        <div class="section-inner">
          <h3 style="font-size:13px;font-weight:700;margin-bottom:10px;color:#059669">${title}</h3>
          ${cards.length ? `<div class="mini-cards">${cards.map(([l, v]) => `<div class="mini-card"><div class="mini-card-val">${v}</div><div class="mini-card-label">${l}</div></div>`).join('')}</div>` : ''}
          ${parsed.key_insights ? `<div style="font-size:13px;line-height:1.7;margin-top:10px;color:#333">${parsed.key_insights}</div>` : ''}
        </div>
      </div>
    `;
  };

  const metaPaidHtml = renderPaidBlock('Meta Paid (Ads)', manual.performance_marketing?.meta_paid || manual.performance_marketing?.instagram_paid);
  const liPaidHtml = renderPaidBlock('LinkedIn Paid (Ads)', manual.performance_marketing?.linkedin_paid);

  const performanceMarketingHtml = (metaPaidHtml || liPaidHtml) ? `
<div class="section-block">
  <h2>Performance Marketing</h2>
  ${metaPaidHtml}
  ${liPaidHtml}
</div>` : '';

  // ── Manual sections ──
  const kwRows = manual.keyword_rankings.map((k, i) => `
    <tr style="background:${i % 2 === 0 ? '#f9f9f9' : '#fff'}">
      <td style="padding:8px 12px;font-weight:600">${k.keyword}</td>
      <td style="padding:8px 12px;text-align:right;font-weight:700">#${k.rank ?? '—'}</td>
      <td style="padding:8px 12px;text-align:right;font-weight:700">#${k.change ?? '—'}</td>
    </tr>`).join('');

  const targetRows = manual.targets.map((t, i) => `
    <tr style="background:${i % 2 === 0 ? '#f9f9f9' : '#fff'}">
      <td style="padding:8px 12px;font-weight:600">${t.name}</td>
      <td style="padding:8px 12px;text-align:right">${t.achieved ?? '—'}</td>
      <td style="padding:8px 12px;text-align:right">${t.target ?? '—'}</td>
    </tr>`).join('');

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
<div class="section-block">
<h2>${label}</h2>
<div class="section">
  <div class="section-inner">
    ${cards.length ? `<div class="mini-cards">${cards.map(([lbl, val]) => `<div class="mini-card"><div class="mini-card-val">${val}</div><div class="mini-card-label">${lbl}</div></div>`).join('')}</div>` : ''}
    ${splitBar}
    ${d.key_insights ? `<div style="font-size:13px;line-height:1.7;margin-top:12px;color:#333">${d.key_insights}</div>` : ''}
  </div>
</div>
</div>`;
  }).join('');

  const organicRows = manual.organic_form_data.map((row, i) => `
    <tr style="background:${i % 2 === 0 ? '#f9f9f9' : '#fff'}">
      <td style="padding:8px 12px;font-size:11px">${row.date}</td>
      <td style="padding:8px 12px;font-size:11px">${row.source}</td>
      <td style="padding:8px 12px;font-size:11px">${row.contact}</td>
    </tr>`).join('');

  const fmtD = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const today = new Date();
  const daysAgo = (n: number) => { const d = new Date(today); d.setDate(d.getDate() - n); return d; };
  const [rStart, rEnd] = range === 'custom' && customStart && customEnd
    ? [new Date(customStart), new Date(customEnd)]
    : range === '7d' ? [daysAgo(7), today]
    : range === '28d' ? [daysAgo(28), today]
    : [daysAgo(90), today];
  const rangeLabel = `${fmtD(rStart)} – ${fmtD(rEnd)}`;
  const dateStr = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>SEO &amp; Social Analytics Report — ${clientName}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a1a; background: #fff; padding: 32px 36px; }
  h1 { font-size: 22px; font-weight: 800; color: #ffffff; }
  h2 { font-size: 13px; font-weight: 700; color: #1e293b; margin-bottom: 12px; margin-top: 24px; text-transform: uppercase; letter-spacing: 0.05em; }
  .meta { font-size: 12px; color: #94a3b8; margin-top: 4px; }
  .cards { display: grid; grid-template-columns: repeat(5,1fr); gap: 12px; margin-bottom: 20px; }
  .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; }
  .card-val { font-size: 20px; font-weight: 800; color: #0f172a; }
  .card-label { font-size: 10px; font-weight: 600; color: #64748b; margin-top: 3px; text-transform: uppercase; letter-spacing: 0.04em; }
  .mini-cards { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 12px; }
  .mini-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 14px; min-width: 110px; }
  .mini-card-val { font-size: 16px; font-weight: 800; color: #0f172a; }
  .mini-card-label { font-size: 10px; font-weight: 600; color: #64748b; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.04em; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; font-size: 10px; font-weight: 700; color: #64748b; padding: 8px 12px; background: #f1f5f9; text-transform: uppercase; letter-spacing: 0.05em; }
  th:not(:first-child) { text-align: right; }
  .section { border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; margin-bottom: 20px; page-break-inside: avoid; background: #fff; }
  .section-inner { padding: 14px 20px; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .badge { display: inline-block; background: #dcfce7; color: #166534; font-size: 9px; font-weight: 700; padding: 2px 7px; border-radius: 4px; margin-left: 8px; vertical-align: middle; }
  svg { display: block; max-width: 100%; height: auto; }
  .legend { display: flex; gap: 16px; padding: 10px 16px; font-size: 10px; color: #64748b; font-weight: 600; }
  .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 4px; }
  .insights-body { font-size: 13px; line-height: 1.7; padding: 14px 16px; }
  .insights-body ul, .insights-body ol { padding-left: 20px; }
  .insights-body li { margin-bottom: 4px; }
  .gmb-link { font-size: 11px; color: #6366f1; margin-top: 8px; display: inline-block; }
  .overview-text { font-size: 12px; color: #555; margin-top: 10px; line-height: 1.55; white-space: pre-line; }
  @media print {
    body { padding: 16px 20px; }
    @page { margin: 0.6cm; size: A4 portrait; }
    h2 { page-break-after: avoid; }
    .section { page-break-inside: avoid; }
    .two-col { page-break-inside: avoid; }
    .section-block { page-break-inside: avoid; }
  }
</style>
</head><body>

<div style="background:#1d2033;border-radius:14px;padding:22px 26px;margin-bottom:24px;color:#fff;display:flex;align-items:center;justify-content:space-between;page-break-inside:avoid;box-shadow:0 4px 16px rgba(0,0,0,0.12)">
  <div>
    <h1 style="font-size:22px;font-weight:700;color:#ffffff;margin:0 0 4px">${clientName} — ${rangeLabel}</h1>
    <p style="font-size:12px;color:#94a3b8;margin:0">Generated ${dateStr} · ${agencyName || 'Loooped'} Report Module</p>
  </div>
  <div style="display:flex;align-items:center;gap:16px">
    <div style="position:relative;width:64px;height:64px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
      <svg width="64" height="64" viewBox="0 0 64 64">
        <circle cx="32" cy="32" r="26" fill="none" stroke="#2e344e" stroke-width="5"/>
        <circle cx="32" cy="32" r="26" fill="none" stroke="#22c55e" stroke-width="5"
          stroke-dasharray="${(2 * Math.PI * 26 * (manual.health_score ?? 76)) / 100} ${2 * Math.PI * 26}"
          stroke-dashoffset="0" stroke-linecap="round" transform="rotate(-90 32 32)"/>
      </svg>
      <div style="position:absolute;text-align:center">
        <span style="font-size:17px;font-weight:800;color:#ffffff;display:block;line-height:1">${manual.health_score ?? 76}</span>
        <span style="font-size:7px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em;display:block;margin-top:2px">HEALTH</span>
      </div>
    </div>
    <div style="max-width:180px;font-size:11px;color:#cbd5e1;line-height:1.4">${manual.health_label || 'Weighted for a balanced goal, vs target'}</div>
  </div>
</div>

${execHtml}
${targetCardsHtml}
${lastPlanHtml}
${nextPlanHtml}
${highlightsHtml}

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

${acqRows && demoRows ? `<div class="two-col">
  <div>
    <h2>Traffic Acquisition</h2>
    <div class="section"><table><thead><tr><th>Channel</th><th>Sessions</th><th>Users</th></tr></thead><tbody>${acqRows}</tbody></table></div>
  </div>
  <div>
    <h2>Demographics — Cities${demoCountry !== 'all' ? ` (${demoCountry})` : ''}</h2>
    <div class="section"><table><thead><tr><th>City</th>${showCountryCol ? '<th>Country</th>' : ''}<th>Users</th><th>Sessions</th></tr></thead><tbody>${demoRows}</tbody></table></div>
  </div>
</div>` : acqRows ? `
<h2>Traffic Acquisition</h2>
<div class="section"><table><thead><tr><th>Channel</th><th>Sessions</th><th>Users</th></tr></thead><tbody>${acqRows}</tbody></table></div>
` : demoRows ? `
<h2>Demographics — Cities${demoCountry !== 'all' ? ` (${demoCountry})` : ''}</h2>
<div class="section"><table><thead><tr><th>City</th>${showCountryCol ? '<th>Country</th>' : ''}<th>Users</th><th>Sessions</th></tr></thead><tbody>${demoRows}</tbody></table></div>
` : ''}

${pageRows && queryRows ? `<div class="two-col">
  <div>
    <h2>Pages &amp; Screens <span class="badge">Search Console</span></h2>
    <div class="section"><table><thead><tr><th>Page</th><th>Clicks</th><th>Impr.</th><th>CTR</th><th>Pos.</th></tr></thead><tbody>${pageRows}</tbody></table></div>
  </div>
  <div>
    <h2>Top Queries <span class="badge">Search Console</span></h2>
    <div class="section"><table><thead><tr><th>Query</th><th>Clicks</th><th>Impr.</th><th>CTR</th><th>Pos.</th></tr></thead><tbody>${queryRows}</tbody></table></div>
  </div>
</div>` : pageRows ? `
<h2>Pages &amp; Screens <span class="badge">Search Console</span></h2>
<div class="section"><table><thead><tr><th>Page</th><th>Clicks</th><th>Impr.</th><th>CTR</th><th>Pos.</th></tr></thead><tbody>${pageRows}</tbody></table></div>
` : queryRows ? `
<h2>Top Queries <span class="badge">Search Console</span></h2>
<div class="section"><table><thead><tr><th>Query</th><th>Clicks</th><th>Impr.</th><th>CTR</th><th>Pos.</th></tr></thead><tbody>${queryRows}</tbody></table></div>
` : ''}

${kwRows ? `
<div class="section-block">
<h2>Keyword Rankings</h2>
<div class="section">
  <table><thead><tr><th>Keyword</th><th>Previous Ranking</th><th>Current Ranking</th></tr></thead>
  <tbody>${kwRows}</tbody></table>
</div>
</div>` : ''}

${organicRows ? `
<div class="section-block">
<h2>Organic Form Submissions</h2>
<div class="section">
  <table><thead><tr><th>Date</th><th>Source</th><th>Contact</th></tr></thead>
  <tbody>${organicRows}</tbody></table>
</div>
</div>` : ''}

${targetRows ? `
<div class="section-block">
<h2>Targets</h2>
<div class="section">
  <table><thead><tr><th>Metric</th><th>Achieved</th><th>Target</th></tr></thead>
  <tbody>${targetRows}</tbody></table>
</div>
</div>` : ''}

${manual.key_insights ? `
<div class="section-block">
<h2>Key Insights</h2>
<div class="section">
  <div class="insights-body">${manual.key_insights}</div>
</div>
</div>` : ''}

${gmbMultiHtml}

${socialOrganicHtml}

${performanceMarketingHtml}

</body></html>`;

  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  setTimeout(() => { win.focus(); win.print(); }, 500);
}

const emptyLinkedIn = (): LinkedInData => ({
  impressions: null, impressions_organic: null, impressions_sponsored: null,
  clicks: null, clicks_organic: null, clicks_sponsored: null,
  new_followers: null, new_followers_period: '', growth_rate: '', growth_label: '', posts: [], key_insights: null,
});

const emptyGmbLocation = (): GmbLocation => ({
  name: '', rating: null, reviews: null, profile_url: '', overview: '',
  calls: null, bookings: null, website_clicks: null, key_insights: '',
  prev_rating: null, prev_reviews: null, prev_calls: null, prev_bookings: null, prev_website_clicks: null,
});

const emptyOrganicMetrics = (): OrganicMetrics => ({
  views: null, reach: null, content_interactions: null, link_clicks: null, key_insights: null,
  top_post_description: null, top_post_impressions: null,
  channel_plan_action: null, channel_plan_impressions_target: null,
  flags_risks: null,
});

const emptyPaidMetrics = (): PaidMetrics => ({
  spend: null, reach: null, reach_change: '', cost_per_reach: null, key_insights: null,
});

const emptyManual = (): ManualData => ({
  keyword_rankings: [], targets: [], key_insights: '', linkedin_data: null, social_media_data: null,
  organic_form_data: [], gmb_locations: [],
  executive_summary: '', sig_change_whys: {}, last_period_plan: [],
  best_performing_asset: '', next_period_plan: [],
  period_targets: { sessions: '', leads: '', engagement_rate: '', instagram_reach: '', facebook_reach: '' },
  meta_organic: {
    instagram: emptyOrganicMetrics(),
    facebook: emptyOrganicMetrics(),
  },
  linkedin_organic: emptyOrganicMetrics(),
  performance_marketing: {
    meta_paid: emptyPaidMetrics(),
    linkedin_paid: emptyPaidMetrics(),
  },
  health_score: 76,
  health_label: 'Weighted for a balanced goal, vs target',
  gmb_rating: null, gmb_reviews: null, gmb_profile_url: '',
  gmb_overview: '', gmb_calls: null, gmb_bookings: null, gmb_website_clicks: null,
  gmb_key_insights: '', gmb_prev_rating: null, gmb_prev_reviews: null,
  gmb_prev_calls: null, gmb_prev_bookings: null, gmb_prev_website_clicks: null,
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
  const [compareStart, setCompareStart] = useState('');
  const [compareEnd, setCompareEnd]     = useState('');
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
  const [manualPanel, setManualPanel]   = useState<'keywords' | 'targets' | 'gmb' | 'insights' | 'organic' | 'linkedin' | 'social' | 'meta_organic' | 'linkedin_organic' | 'performance_marketing' | 'exec_summary' | 'last_plan' | 'next_plan' | 'health' | null>(null);
  const [socialTab, setSocialTab] = useState<'meta_organic' | 'linkedin_organic'>('meta_organic');
  const [paidTab, setPaidTab] = useState<'meta_paid' | 'linkedin_paid'>('meta_paid');
  const [showTiktok, setShowTiktok] = useState(false);
  const [agencyName, setAgencyName] = useState('webanatomy');
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
    seoApi.report(
      selectedClient.id, range,
      range === 'custom' ? customStart : undefined,
      range === 'custom' ? customEnd : undefined,
      demoCountry,
      compareStart || undefined,
      compareEnd || undefined,
    )
      .then((r) => setReport(r.data))
      .catch((e) => setError(e.response?.data?.error || 'Failed to load report'))
      .finally(() => setLoading(false));
  }, [selectedClient, range, customStart, customEnd, demoCountry, compareStart, compareEnd]);

  useEffect(() => {
    if (!selectedClient) return;
    seoApi.getManual(selectedClient.id)
      .then((r) => {
        const data = { ...emptyManual(), ...r.data };
        // Migrate legacy flat GMB fields into gmb_locations[0]
        if ((!data.gmb_locations || data.gmb_locations.length === 0) &&
            (data.gmb_rating != null || data.gmb_reviews != null || data.gmb_calls != null ||
             data.gmb_bookings != null || data.gmb_website_clicks != null || data.gmb_profile_url || data.gmb_overview)) {
          data.gmb_locations = [{
            name: '', rating: data.gmb_rating, reviews: data.gmb_reviews,
            profile_url: data.gmb_profile_url, overview: data.gmb_overview,
            calls: data.gmb_calls, bookings: data.gmb_bookings, website_clicks: data.gmb_website_clicks,
            key_insights: data.gmb_key_insights,
            prev_rating: data.gmb_prev_rating, prev_reviews: data.gmb_prev_reviews,
            prev_calls: data.gmb_prev_calls, prev_bookings: data.gmb_prev_bookings,
            prev_website_clicks: data.gmb_prev_website_clicks,
          }];
        }
        setManual(data);
        setShowTiktok(!!(data.social_media_data?.tiktok && Object.values(data.social_media_data.tiktok).some((v) => v != null)));
      })
      .catch(() => { setManual(emptyManual()); setShowTiktok(false); });
  }, [selectedClient]);

  const openManualPanel = (panel: typeof manualPanel) => {
    const base = { ...manual };
    if (panel === 'linkedin' && !base.linkedin_data) base.linkedin_data = emptyLinkedIn();
    if (panel === 'social') {
      const empty = (): SocialPlatformData => ({ views: null, from_organic: null, from_ads: null, reach: null, total_followers: null, new_followers: null, interactions: null, watch_time: null, likes: null, key_insights: null });
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--ink-muted)', whiteSpace: 'nowrap' }}>Compare to:</span>
                <div className="seo-date-custom">
                  <input
                    type="date"
                    className={`seo-date-input${compareStart ? ' active' : ''}`}
                    value={compareStart}
                    onChange={(e) => setCompareStart(e.target.value)}
                  />
                  <span className="seo-date-sep">→</span>
                  <input
                    type="date"
                    className={`seo-date-input${compareEnd ? ' active' : ''}`}
                    value={compareEnd}
                    onChange={(e) => setCompareEnd(e.target.value)}
                  />
                </div>
                {(compareStart || compareEnd) && (
                  <button
                    style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink-muted)', cursor: 'pointer' }}
                    onClick={() => { setCompareStart(''); setCompareEnd(''); }}
                  >✕</button>
                )}
              </div>
            </div>
            <select
              value={agencyName}
              onChange={(e) => setAgencyName(e.target.value)}
              style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink)', cursor: 'pointer' }}
            >
              <option value="webanatomy">webanatomy</option>
              <option value="mosol9">mosol9</option>
              <option value="businessanatomy">businessanatomy</option>
            </select>
            {report && (
              <button
                className="seo-download-btn"
                onClick={() => downloadPDF(report!, selectedClient?.name ?? 'Client', range, manual, demoCountry, selectedAcquisitions, selectedDemographics, selectedPages, selectedQueries, agencyName, customStart, customEnd, compareStart, compareEnd)}
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
            {/* ── Dark Header Banner (Client, Period & Health Score) ── */}
            <div style={{
              background: '#1d2033',
              borderRadius: 16,
              padding: '22px 28px',
              marginBottom: 20,
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
              position: 'relative',
              flexWrap: 'wrap',
              gap: 16,
            }}>
              <div>
                <h1 style={{ fontSize: 22, fontWeight: 700, color: '#ffffff', margin: '0 0 6px', letterSpacing: '-0.01em' }}>
                  {selectedClient ? selectedClient.name : 'Report'} — {range === '28d' ? 'Last 28 Days' : range === '7d' ? 'Last 7 Days' : range === '90d' ? 'Last 90 Days' : `${customStart} to ${customEnd}`}
                </h1>
                <p style={{ fontSize: 13, color: '#94a3b8', margin: 0, fontWeight: 500 }}>
                  Generated {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} · {agencyName || 'Loooped'} Report Module
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                {/* Circular Health Indicator */}
                <div style={{ position: 'relative', width: 68, height: 68, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="68" height="68" viewBox="0 0 68 68">
                    <circle cx="34" cy="34" r="28" fill="none" stroke="#2e344e" strokeWidth="6" />
                    <circle cx="34" cy="34" r="28" fill="none" stroke="#22c55e" strokeWidth="6"
                      strokeDasharray={`${(2 * Math.PI * 28 * (manual.health_score ?? 76)) / 100} ${2 * Math.PI * 28}`}
                      strokeDashoffset={0}
                      strokeLinecap="round"
                      transform="rotate(-90 34 34)" />
                  </svg>
                  <div style={{ position: 'absolute', textAlign: 'center' }}>
                    <span style={{ fontSize: 18, fontWeight: 800, color: '#ffffff', display: 'block', lineHeight: 1 }}>
                      {manual.health_score ?? 76}
                    </span>
                    <span style={{ fontSize: 7, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginTop: 2 }}>
                      HEALTH
                    </span>
                  </div>
                </div>

                <div style={{ maxWidth: 190, fontSize: 12, color: '#cbd5e1', lineHeight: 1.45 }}>
                  {manual.health_label || 'Weighted for a balanced goal, vs target'}
                </div>

                {canEdit && (
                  <button type="button" className="seo-manual-edit-btn" style={{ background: 'rgba(255,255,255,0.1)', color: '#ffffff', border: '1px solid rgba(255,255,255,0.2)', marginLeft: 8 }}
                    onClick={() => openManualPanel(manualPanel === 'health' ? null : 'health')}>
                    <Edit2 size={11} /> {manualPanel === 'health' ? 'Cancel' : 'Edit Header'}
                  </button>
                )}
              </div>
            </div>

            {/* Health edit modal/panel */}
            {manualPanel === 'health' && canEdit && (
              <div className="seo-manual-panel" style={{ marginBottom: 20 }}>
                <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Report Header & Health Score (Manual Input)</h4>
                <div className="seo-manual-grid" style={{ marginBottom: 12 }}>
                  <div className="seo-inline-field">
                    <label className="seo-inline-label">Health Score (Number 0-100)</label>
                    <input className="form-input seo-inline-input" type="number" placeholder="76"
                      value={manualEdit.health_score ?? 76}
                      onChange={(e) => setManualEdit({ ...manualEdit, health_score: Number(e.target.value) })} />
                  </div>
                  <div className="seo-inline-field">
                    <label className="seo-inline-label">Health Subtitle / Goal Label</label>
                    <input className="form-input seo-inline-input" placeholder="Weighted for a balanced goal, vs target"
                      value={manualEdit.health_label ?? ''}
                      onChange={(e) => setManualEdit({ ...manualEdit, health_label: e.target.value })} />
                  </div>
                </div>
                <div className="seo-manual-actions">
                  <button className="seo-inline-save" onClick={saveManual} disabled={manualSaving}>{manualSaving ? 'Saving…' : 'Save'}</button>
                </div>
              </div>
            )}

            {/* ── Executive Summary ── */}
            {(canEdit || manual.executive_summary) && (
              <div className="seo-section">
                <h3 className="seo-section__title">
                  Executive Summary
                  <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--ink-muted)', marginLeft: 6 }}>manual</span>
                  {canEdit && (
                    <button className="seo-manual-edit-btn" onClick={() => openManualPanel(manualPanel === 'exec_summary' as any ? null : 'exec_summary' as any)}>
                      <Edit2 size={11} /> {manualPanel === ('exec_summary' as any) ? 'Cancel' : 'Edit'}
                    </button>
                  )}
                </h3>
                {manualPanel === ('exec_summary' as any) && canEdit && (
                  <div className="seo-manual-panel">
                    <textarea className="seo-insights-editor" rows={4}
                      placeholder="2–3 lines. Plain English. This is the first thing the client reads.&#10;e.g. Steady month overall. Organic search and GBP kept driving qualified leads…"
                      value={manualEdit.executive_summary}
                      onChange={(e) => setManualEdit({ ...manualEdit, executive_summary: e.target.value })} />
                    <div className="seo-manual-actions" style={{ marginTop: 10 }}>
                      <button className="seo-inline-save" onClick={saveManual} disabled={manualSaving}>{manualSaving ? 'Saving…' : 'Save'}</button>
                    </div>
                  </div>
                )}
                {manual.executive_summary
                  ? <p style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--ink)', margin: '8px 0 0' }}>{manual.executive_summary}</p>
                  : !manualPanel && canEdit && <p className="page-subtitle" style={{ padding: '8px 0' }}>Click Edit to write the executive summary.</p>}
              </div>
            )}

            {/* ── Significant Changes ── */}
            {(() => {
              const eng = report.engagement;
              const prev = report.prevEngagement;
              const sigChanges: { key: string; label: string; from: number; to: number; pct: number }[] = [];
              if (prev) {
                const check = (key: string, label: string, cur: number, pre: number) => {
                  if (pre === 0) return;
                  const pct = Math.round(((cur - pre) / pre) * 100);
                  if (Math.abs(pct) >= 25) sigChanges.push({ key, label, from: pre, to: cur, pct });
                };
                check('sessions', 'Sessions', eng.sessions, prev.sessions);
                check('users', 'Users', eng.users, prev.users);
                check('engagementRate', 'Engagement Rate', eng.engagementRate, prev.engagementRate);
              }
              // GBP location checks
              (manual.gmb_locations ?? []).forEach((loc, i) => {
                const prefix = manual.gmb_locations.length > 1 ? `${loc.name || `Location ${i+1}`} ` : '';
                const check = (key: string, label: string, cur: number | null, pre: number | null) => {
                  if (cur == null || pre == null || pre === 0) return;
                  const pct = Math.round(((cur - pre) / pre) * 100);
                  if (Math.abs(pct) >= 25) sigChanges.push({ key: `gmb_${i}_${key}`, label: `GBP ${prefix}${label}`, from: pre, to: cur, pct });
                };
                check('calls', 'calls', loc.calls, loc.prev_calls);
                check('website_clicks', 'website clicks', loc.website_clicks, loc.prev_website_clicks);
                check('reviews', 'reviews', loc.reviews, loc.prev_reviews);
                check('bookings', 'bookings', loc.bookings, loc.prev_bookings);
              });
              if (sigChanges.length === 0) return null;
              return (
                <div className="seo-section" style={{ border: '1.5px solid #fde68a', background: 'linear-gradient(135deg,#fffbeb 0%,#fff 100%)', borderRadius: 12, padding: '16px 20px' }}>
                  <h3 className="seo-section__title" style={{ color: '#92400e' }}>
                    ⚠ Significant Changes Detected
                  </h3>
                  {/* <p style={{ fontSize: 12, color: '#92400e', marginBottom: 14 }}>These metrics moved more than 25% vs last period. Add a one-line reason before generating the report.</p> */}
                  {sigChanges.map(sc => (
                    <div key={sc.key} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                      <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                        {sc.label}: <span style={{ color: 'var(--ink-muted)', fontWeight: 400 }}>{sc.from.toLocaleString()} → {sc.to.toLocaleString()}</span>
                        <span style={{ marginLeft: 6, fontWeight: 700, color: sc.pct >= 0 ? '#16a34a' : '#dc2626' }}>({sc.pct >= 0 ? '+' : ''}{sc.pct}%)</span>
                      </div>
                      {canEdit && (
                        <input className="form-input" placeholder="Why?" style={{ width: 260, fontSize: 12 }}
                          value={manual.sig_change_whys?.[sc.key] ?? ''}
                          onChange={(e) => {
                            const updated = { ...manual, sig_change_whys: { ...(manual.sig_change_whys ?? {}), [sc.key]: e.target.value } };
                            setManual(updated);
                            setManualEdit(updated);
                          }} />
                      )}
                      {!canEdit && manual.sig_change_whys?.[sc.key] && (
                        <span style={{ fontSize: 12, color: 'var(--ink-muted)', fontStyle: 'italic' }}>{manual.sig_change_whys[sc.key]}</span>
                      )}
                    </div>
                  ))}
                  {canEdit && (
                    <button className="seo-inline-save" style={{ marginTop: 6 }} onClick={saveManual} disabled={manualSaving}>{manualSaving ? 'Saving…' : 'Save'}</button>
                  )}
                </div>
              );
            })()}

            {/* ── Last Period's Plan — Update Progress ── */}
            {(canEdit || manual.last_period_plan?.length > 0) && (
              <div className="seo-section">
                <h3 className="seo-section__title">
                  Last Period's Plan — Update Progress
                  <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--ink-muted)', marginLeft: 6 }}>closes the loop</span>
                  {canEdit && (
                    <button className="seo-manual-edit-btn" onClick={() => openManualPanel(manualPanel === ('last_plan' as any) ? null : 'last_plan' as any)}>
                      <Edit2 size={11} /> {manualPanel === ('last_plan' as any) ? 'Cancel' : 'Edit'}
                    </button>
                  )}
                </h3>
                <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginBottom: 10 }}>What was promised last period. Mark what actually happened.</p>
                {manualPanel === ('last_plan' as any) && canEdit && (
                  <div className="seo-manual-panel">
                    {manualEdit.last_period_plan.map((item, i) => {
                      const upd = (patch: Partial<LastPeriodPlanItem>) => {
                        const a = [...manualEdit.last_period_plan]; a[i] = { ...a[i], ...patch };
                        setManualEdit({ ...manualEdit, last_period_plan: a });
                      };
                      return (
                        <div key={i} style={{ border: '1px solid var(--sand-border)', borderRadius: 8, padding: '12px 12px 8px', marginBottom: 10 }}>
                          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                            <input className="form-input seo-inline-input" placeholder="Focus area (e.g. Content)" value={item.area} onChange={(e) => upd({ area: e.target.value })} style={{ width: 130 }} />
                            <input className="form-input seo-inline-input" placeholder="Action taken" value={item.action} onChange={(e) => upd({ action: e.target.value })} style={{ flex: 1 }} />
                          </div>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <input className="form-input seo-inline-input" placeholder="Expected outcome" value={item.expected} onChange={(e) => upd({ expected: e.target.value })} style={{ flex: 1 }} />
                            <select className="form-input seo-inline-input" value={item.status} onChange={(e) => upd({ status: e.target.value as any })} style={{ width: 140 }}>
                              <option value="done">✓ Done</option>
                              <option value="partial">◐ Partially done</option>
                              <option value="not_done">✗ Not done</option>
                            </select>
                            <button className="seo-manual-del" onClick={() => setManualEdit({ ...manualEdit, last_period_plan: manualEdit.last_period_plan.filter((_, j) => j !== i) })}><Trash2 size={13} /></button>
                          </div>
                        </div>
                      );
                    })}
                    <div className="seo-manual-actions">
                      <button className="seo-manual-add" onClick={() => setManualEdit({ ...manualEdit, last_period_plan: [...manualEdit.last_period_plan, { area: '', action: '', expected: '', status: 'done' }] })}>
                        <Plus size={12} /> Add item
                      </button>
                      <button className="seo-inline-save" onClick={saveManual} disabled={manualSaving}>{manualSaving ? 'Saving…' : 'Save'}</button>
                    </div>
                  </div>
                )}
                {manual.last_period_plan?.length > 0 && manualPanel !== ('last_plan' as any) && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {manual.last_period_plan.map((item, i) => {
                      const statusColor = item.status === 'done' ? '#16a34a' : item.status === 'partial' ? '#d97706' : '#dc2626';
                      const statusBg = item.status === 'done' ? '#f0fdf4' : item.status === 'partial' ? '#fffbeb' : '#fef2f2';
                      const statusLabel = item.status === 'done' ? '✓ Done' : item.status === 'partial' ? '◐ Partially done' : '✗ Not done';
                      return (
                        <div key={i} style={{ border: `1.5px solid ${statusColor}22`, borderLeft: `4px solid ${statusColor}`, background: statusBg, borderRadius: 8, padding: '12px 16px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                          <div style={{ flex: 1 }}>
                            {item.area && (
                              <div style={{ fontSize: 10, fontWeight: 800, color: statusColor, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{item.area}</div>
                            )}
                            {item.action && (
                              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>{item.action}</div>
                            )}
                            {item.expected && (
                              <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                                <span style={{ fontWeight: 600 }}>Expected outcome: </span>{item.expected}
                              </div>
                            )}
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: statusColor, background: `${statusColor}18`, padding: '3px 10px', borderRadius: 20, flexShrink: 0, whiteSpace: 'nowrap' }}>
                            {statusLabel}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ── Business Outcome + Next Period's Plan ── */}
            {(canEdit || manual.best_performing_asset || manual.next_period_plan?.length > 0) && (
              <div className="seo-section">
                <h3 className="seo-section__title">
                  Business Outcome
                  {canEdit && (
                    <button className="seo-manual-edit-btn" onClick={() => openManualPanel(manualPanel === ('business' as any) ? null : 'business' as any)}>
                      <Edit2 size={11} /> {manualPanel === ('business' as any) ? 'Cancel' : 'Edit'}
                    </button>
                  )}
                </h3>
                {manualPanel === ('business' as any) && canEdit && (
                  <div className="seo-manual-panel">
                    <div className="seo-inline-field" style={{ marginBottom: 12 }}>
                      <label className="seo-inline-label">Best performing asset / campaign this month</label>
                      <textarea className="form-input seo-gmb-overview-input" rows={2}
                        placeholder="e.g. Blog: 'Eco Drain Pipes — Complete Buyer's Guide' + GBP offer post"
                        value={manualEdit.best_performing_asset}
                        onChange={(e) => setManualEdit({ ...manualEdit, best_performing_asset: e.target.value })} />
                    </div>
                    <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', margin: '14px 0 8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Next Period's Plan</p>
                    {manualEdit.next_period_plan.map((item, i) => {
                      const upd = (patch: Partial<NextPeriodPlanItem>) => {
                        const a = [...manualEdit.next_period_plan]; a[i] = { ...a[i], ...patch };
                        setManualEdit({ ...manualEdit, next_period_plan: a });
                      };
                      return (
                        <div key={i} style={{ border: '1px solid var(--sand-border)', borderRadius: 8, padding: '12px 12px 8px', marginBottom: 10 }}>
                          <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                            <input className="form-input seo-inline-input" placeholder="Focus area (e.g. GBP)" value={item.focus} onChange={(e) => upd({ focus: e.target.value })} style={{ width: 140 }} />
                            <button className="seo-manual-del" onClick={() => setManualEdit({ ...manualEdit, next_period_plan: manualEdit.next_period_plan.filter((_, j) => j !== i) })}><Trash2 size={13} /></button>
                          </div>
                          <input className="form-input seo-inline-input" placeholder="Specific action" value={item.action} onChange={(e) => upd({ action: e.target.value })} style={{ width: '100%', marginBottom: 6 }} />
                          <input className="form-input seo-inline-input" placeholder="Expected impact" value={item.expected} onChange={(e) => upd({ expected: e.target.value })} style={{ width: '100%' }} />
                        </div>
                      );
                    })}
                    <div className="seo-manual-actions">
                      <button className="seo-manual-add" onClick={() => setManualEdit({ ...manualEdit, next_period_plan: [...manualEdit.next_period_plan, { focus: '', action: '', expected: '' }] })}>
                        <Plus size={12} /> Add plan item
                      </button>
                      <button className="seo-inline-save" onClick={saveManual} disabled={manualSaving}>{manualSaving ? 'Saving…' : 'Save'}</button>
                    </div>
                  </div>
                )}
                {manualPanel !== ('business' as any) && (
                  <>
                    {manual.best_performing_asset && (
                      <div style={{ background: 'var(--bg-sand)', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
                        <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Best performing asset / campaign this month</div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.6 }}>{manual.best_performing_asset}</div>
                      </div>
                    )}
                    {manual.next_period_plan?.length > 0 && (
                      <>
                        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '4px 0 10px' }}>Next Period's Plan</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {manual.next_period_plan.map((item, i) => (
                            <div key={i} style={{ border: '1px solid var(--sand-border)', borderRadius: 8, padding: '12px 16px' }}>
                              {item.focus && (
                                <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--brand,#2563eb)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                                  Focus area: {item.focus}
                                </div>
                              )}
                              {item.action && (
                                <div style={{ marginBottom: 4 }}>
                                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)' }}>Specific action: </span>
                                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{item.action}</span>
                                </div>
                              )}
                              {item.expected && (
                                <div>
                                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)' }}>Expected impact: </span>
                                  <span style={{ fontSize: 12, color: 'var(--ink)' }}>{item.expected}</span>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ── Targets — Next Period ── */}
            {(canEdit || Object.values(manual.period_targets ?? {}).some(v => v)) && (
              <div className="seo-section">
                <h3 className="seo-section__title">
                  Targets — Next Period
                  <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--ink-muted)', marginLeft: 6 }}>manual</span>
                  {canEdit && (
                    <button className="seo-manual-edit-btn" onClick={() => openManualPanel(manualPanel === ('period_targets' as any) ? null : 'period_targets' as any)}>
                      <Edit2 size={11} /> {manualPanel === ('period_targets' as any) ? 'Cancel' : 'Edit'}
                    </button>
                  )}
                </h3>
                <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginBottom: 10 }}>What this account is being held to next period.</p>
                {manualPanel === ('period_targets' as any) && canEdit && (
                  <div className="seo-manual-panel">
                    <div className="seo-manual-grid">
                      {([
                        { key: 'sessions', label: 'Sessions target' },
                        { key: 'leads', label: 'Leads target' },
                        { key: 'engagement_rate', label: 'Engagement rate target' },
                        { key: 'instagram_reach', label: 'Instagram reach target' },
                        { key: 'facebook_reach', label: 'Facebook reach target' },
                      ] as const).map(({ key, label }) => (
                        <div key={key} className="seo-inline-field">
                          <label className="seo-inline-label">{label}</label>
                          <input className="form-input seo-inline-input" placeholder="e.g. 1,450"
                            value={manualEdit.period_targets?.[key] ?? ''}
                            onChange={(e) => setManualEdit({ ...manualEdit, period_targets: { ...(manualEdit.period_targets ?? {}), [key]: e.target.value } as PeriodTargets })} />
                        </div>
                      ))}
                    </div>
                    <div className="seo-manual-actions" style={{ marginTop: 12 }}>
                      <button className="seo-inline-save" onClick={saveManual} disabled={manualSaving}>{manualSaving ? 'Saving…' : 'Save'}</button>
                    </div>
                  </div>
                )}
                {manualPanel !== ('period_targets' as any) && Object.values(manual.period_targets ?? {}).some(v => v) && (
                  <div className="seo-cards" style={{ flexWrap: 'wrap' }}>
                    {([
                      { key: 'sessions', label: 'Sessions', icon: Globe },
                      { key: 'leads', label: 'Leads', icon: Users },
                      { key: 'engagement_rate', label: 'Engagement Rate', icon: TrendingUp },
                      { key: 'instagram_reach', label: 'Instagram Reach', icon: Users },
                      { key: 'facebook_reach', label: 'Facebook Reach', icon: Users },
                    ] as const).filter(({ key }) => manual.period_targets?.[key]).map(({ key, label, icon: Icon }) => (
                      <div key={key} className="seo-card">
                        <div className="seo-card__icon"><Icon size={15} /></div>
                        <div>
                          <p className="seo-card__val">{manual.period_targets[key]}</p>
                          <p className="seo-card__label">{label} target</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Summary cards ── */}
            <div className="seo-cards">
              {(() => {
                const eng = report.engagement;
                const prev = (compareStart && compareEnd) ? report.prevEngagement : null;
                const delta = (cur: number, pre: number | undefined) => {
                  if (!prev || !pre) return null;
                  const pct = pre === 0 ? null : Math.round(((cur - pre) / pre) * 100);
                  return pct;
                };
                return [
                  { label: 'Total Users',     value: eng.users.toLocaleString(),    icon: Users,         pct: delta(eng.users, prev?.users) },
                  { label: 'New Users',       value: eng.newUsers.toLocaleString(), icon: TrendingUp,    pct: delta(eng.newUsers, prev?.newUsers) },
                  { label: 'Sessions',        value: eng.sessions.toLocaleString(), icon: Globe,         pct: delta(eng.sessions, prev?.sessions) },
                  { label: 'Avg. Duration',   value: fmtDuration(eng.avgDuration),  icon: MousePointer,  pct: delta(eng.avgDuration, prev?.avgDuration) },
                  { label: 'Engagement Rate', value: `${eng.engagementRate}%`,      icon: Check,         pct: delta(eng.engagementRate, prev?.engagementRate) },
                ].map(({ label, value, icon: Icon, pct }) => (
                  <div key={label} className="seo-card">
                    <div className="seo-card__icon"><Icon size={15} /></div>
                    <div>
                      <p className="seo-card__val">{value}</p>
                      <p className="seo-card__label">{label}</p>
                      {pct !== null && (
                        <p style={{ fontSize: 11, fontWeight: 700, marginTop: 3, color: pct >= 0 ? '#16a34a' : '#dc2626' }}>
                          {pct >= 0 ? '▲' : '▼'} {Math.abs(pct)}% vs prev period
                        </p>
                      )}
                    </div>
                  </div>
                ));
              })()}
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
                                <td>
                                  {row.sessions.toLocaleString()}
                                  {(compareStart && compareEnd) && (() => { const prev = report.prevAcquisition.find(p => p.channel === row.channel); if (!prev || prev.sessions === 0) return null; const pct = Math.round(((row.sessions - prev.sessions) / prev.sessions) * 100); return <span style={{ fontSize: 10, fontWeight: 700, marginLeft: 5, color: pct >= 0 ? '#16a34a' : '#dc2626' }}>{pct >= 0 ? '▲' : '▼'}{Math.abs(pct)}%</span>; })()}
                                </td>
                                <td>
                                  {row.users.toLocaleString()}
                                  {(compareStart && compareEnd) && (() => { const prev = report.prevAcquisition.find(p => p.channel === row.channel); if (!prev || prev.users === 0) return null; const pct = Math.round(((row.users - prev.users) / prev.users) * 100); return <span style={{ fontSize: 10, fontWeight: 700, marginLeft: 5, color: pct >= 0 ? '#16a34a' : '#dc2626' }}>{pct >= 0 ? '▲' : '▼'}{Math.abs(pct)}%</span>; })()}
                                </td>
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

            {/* ── Search Performance summary ── */}
            {report.pages.length > 0 && (() => {
              const totalClicks = report.pages.reduce((s, p) => s + p.clicks, 0);
              const totalImpr   = report.pages.reduce((s, p) => s + p.impressions, 0);
              const avgCtr      = totalImpr > 0 ? (totalClicks / totalImpr) * 100 : 0;
              const avgPos      = report.pages.length > 0
                ? report.pages.reduce((s, p) => s + p.position, 0) / report.pages.length : 0;
              return (
                <div className="seo-section">
                  <h3 className="seo-section__title">Search Performance <span className="seo-badge">Search Console</span></h3>
                  <div className="seo-cards">
                    {[
                      { label: 'Total clicks',   value: totalClicks.toLocaleString() },
                      { label: 'Impressions',     value: totalImpr.toLocaleString() },
                      { label: 'Avg. CTR',        value: `${avgCtr.toFixed(1)}%` },
                      { label: 'Avg. position',   value: avgPos.toFixed(1) },
                    ].map(({ label, value }) => (
                      <div key={label} className="seo-card">
                        <div>
                          <p className="seo-card__label" style={{ marginBottom: 4 }}>{label}</p>
                          <p className="seo-card__val">{value}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

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
                    <span style={{ width: 80 }}>Previous Ranking</span>
                    <span style={{ width: 80 }}>Current Ranking</span>
                    <span style={{ width: 28 }} />
                  </div>
                  {manualEdit.keyword_rankings.map((kw, i) => (
                    <div key={i} className="seo-manual-row">
                      <input className="form-input seo-manual-input" placeholder="Keyword" value={kw.keyword}
                        onChange={(e) => { const a = [...manualEdit.keyword_rankings]; a[i] = { ...a[i], keyword: e.target.value }; setManualEdit({ ...manualEdit, keyword_rankings: a }); }} />
                      <input className="form-input seo-manual-input seo-manual-input--sm" placeholder="e.g. 5" type="number" min={1} value={kw.rank}
                        onChange={(e) => { const a = [...manualEdit.keyword_rankings]; a[i] = { ...a[i], rank: Number(e.target.value) }; setManualEdit({ ...manualEdit, keyword_rankings: a }); }} />
                      <input className="form-input seo-manual-input seo-manual-input--sm" placeholder="e.g. 3" type="number" value={kw.change}
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
                    <thead><tr><th>#</th><th>Keyword</th><th>Previous Ranking</th><th>Current Ranking</th></tr></thead>
                    <tbody>
                      {manual.keyword_rankings.map((kw, i) => (
                        <tr key={i}>
                          <td className="seo-medium">{i + 1}</td>
                          <td className="seo-source">{kw.keyword}</td>
                          <td><span className="seo-rank-badge">#{kw.rank}</span></td>
                          <td><span className="seo-rank-badge">#{kw.change}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                : !manualPanel && <p className="page-subtitle" style={{ padding: '12px 0' }}>{canEdit ? 'Click Edit to add keyword rankings.' : 'No keyword data yet.'}</p>}
            </div>

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
                      <span style={{ width: 100 }}>Date</span>
                      <span style={{ width: 130 }}>Source</span>
                      <span style={{ flex: 1 }}>Contact</span>
                      <span style={{ width: 28 }} />
                    </div>
                    {manualEdit.organic_form_data.map((row, i) => (
                      <div key={i} className="seo-manual-row">
                        <input className="form-input seo-manual-input" style={{ flex: '0 0 100px' }} placeholder="04/08/2026" value={row.date}
                          onChange={(e) => { const v = e.target.value; setManualEdit(prev => { const a = [...prev.organic_form_data]; a[i] = { ...a[i], date: v }; return { ...prev, organic_form_data: a }; }); }} />
                        <input className="form-input seo-manual-input" style={{ flex: '0 0 130px' }} placeholder="Organic Search" value={row.source}
                          onChange={(e) => { const v = e.target.value; setManualEdit(prev => { const a = [...prev.organic_form_data]; a[i] = { ...a[i], source: v }; return { ...prev, organic_form_data: a }; }); }} />
                        <input className="form-input seo-manual-input" placeholder="R. Naidu · 90xxxxx210" value={row.contact}
                          onChange={(e) => { const v = e.target.value; setManualEdit(prev => { const a = [...prev.organic_form_data]; a[i] = { ...a[i], contact: v }; return { ...prev, organic_form_data: a }; }); }} />
                        <button className="seo-manual-del" onClick={() => setManualEdit(prev => ({ ...prev, organic_form_data: prev.organic_form_data.filter((_, j) => j !== i) }))}><Trash2 size={13} /></button>
                      </div>
                    ))}
                    <div className="seo-manual-actions">
                      <button className="seo-manual-add" onClick={() => setManualEdit(prev => ({ ...prev, organic_form_data: [...prev.organic_form_data, { date: '', source: '', contact: '' }] }))}><Plus size={12} /> Add page</button>
                      <button className="seo-inline-save" onClick={saveManual} disabled={manualSaving}>{manualSaving ? 'Saving…' : 'Save'}</button>
                    </div>
                  </div>
                )}
                {manual.organic_form_data.length > 0
                  ? <table className="seo-table">
                      <thead><tr><th>Date</th><th>Source</th><th>Contact</th></tr></thead>
                      <tbody>
                        {manual.organic_form_data.map((row, i) => (
                          <tr key={i}><td>{row.date}</td><td>{row.source}</td><td>{row.contact}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  : !manualPanel && <p className="page-subtitle" style={{ padding: '12px 0' }}>Click Edit to add form submission data.</p>}
              </div>
            )}

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
              const locs = manual.gmb_locations ?? [];
              const hasGmb = locs.length > 0;
              if (!canEdit && !hasGmb) return null;
              const gmbDelta = (cur: number, pre: number | null) => {
                if (pre == null || pre === 0) return null;
                const pct = Math.round(((cur - pre) / pre) * 100);
                return <span style={{ fontSize: 10, fontWeight: 700, marginTop: 2, display: 'block', color: pct >= 0 ? '#16a34a' : '#dc2626' }}>{pct >= 0 ? '▲' : '▼'} {Math.abs(pct)}%</span>;
              };
              const updLoc = (i: number, patch: Partial<GmbLocation>) => {
                const a = [...manualEdit.gmb_locations];
                a[i] = { ...a[i], ...patch };
                setManualEdit({ ...manualEdit, gmb_locations: a });
              };
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
                      {manualEdit.gmb_locations.map((loc, i) => (
                        <div key={i} style={{ border: '1px solid var(--sand-border)', borderRadius: 10, padding: '14px 14px 10px', marginBottom: 14 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                            <input className="form-input seo-inline-input" placeholder="Location name (e.g. Branch 1)"
                              value={loc.name} onChange={(e) => updLoc(i, { name: e.target.value })}
                              style={{ fontWeight: 700, fontSize: 13, maxWidth: 220 }} />
                            {manualEdit.gmb_locations.length > 1 && (
                              <button onClick={() => setManualEdit({ ...manualEdit, gmb_locations: manualEdit.gmb_locations.filter((_, j) => j !== i) })}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: 18, lineHeight: 1 }} title="Remove location">−</button>
                            )}
                          </div>
                          <div className="seo-manual-grid">
                            <div className="seo-inline-field"><label className="seo-inline-label">Rating</label>
                              <input className="form-input seo-inline-input" placeholder="4.5" type="number" step="0.1" min="0" max="5"
                                value={loc.rating ?? ''} onChange={(e) => updLoc(i, { rating: e.target.value ? Number(e.target.value) : null })} /></div>
                            <div className="seo-inline-field"><label className="seo-inline-label">Reviews</label>
                              <input className="form-input seo-inline-input" placeholder="120" type="number"
                                value={loc.reviews ?? ''} onChange={(e) => updLoc(i, { reviews: e.target.value ? Number(e.target.value) : null })} /></div>
                            <div className="seo-inline-field"><label className="seo-inline-label">Calls</label>
                              <input className="form-input seo-inline-input" placeholder="45" type="number"
                                value={loc.calls ?? ''} onChange={(e) => updLoc(i, { calls: e.target.value ? Number(e.target.value) : null })} /></div>
                            <div className="seo-inline-field"><label className="seo-inline-label">Bookings</label>
                              <input className="form-input seo-inline-input" placeholder="12" type="number"
                                value={loc.bookings ?? ''} onChange={(e) => updLoc(i, { bookings: e.target.value ? Number(e.target.value) : null })} /></div>
                            <div className="seo-inline-field"><label className="seo-inline-label">Website Clicks</label>
                              <input className="form-input seo-inline-input" placeholder="230" type="number"
                                value={loc.website_clicks ?? ''} onChange={(e) => updLoc(i, { website_clicks: e.target.value ? Number(e.target.value) : null })} /></div>
                            <div className="seo-inline-field"><label className="seo-inline-label">Profile URL</label>
                              <input className="form-input seo-inline-input" placeholder="https://g.page/…"
                                value={loc.profile_url} onChange={(e) => updLoc(i, { profile_url: e.target.value })} /></div>
                          </div>
                          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', margin: '12px 0 6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Previous Period</p>
                          <div className="seo-manual-grid">
                            <div className="seo-inline-field"><label className="seo-inline-label">Prev Rating</label>
                              <input className="form-input seo-inline-input" placeholder="4.3" type="number" step="0.1" min="0" max="5"
                                value={loc.prev_rating ?? ''} onChange={(e) => updLoc(i, { prev_rating: e.target.value ? Number(e.target.value) : null })} /></div>
                            <div className="seo-inline-field"><label className="seo-inline-label">Prev Reviews</label>
                              <input className="form-input seo-inline-input" placeholder="100" type="number"
                                value={loc.prev_reviews ?? ''} onChange={(e) => updLoc(i, { prev_reviews: e.target.value ? Number(e.target.value) : null })} /></div>
                            <div className="seo-inline-field"><label className="seo-inline-label">Prev Calls</label>
                              <input className="form-input seo-inline-input" placeholder="40" type="number"
                                value={loc.prev_calls ?? ''} onChange={(e) => updLoc(i, { prev_calls: e.target.value ? Number(e.target.value) : null })} /></div>
                            <div className="seo-inline-field"><label className="seo-inline-label">Prev Bookings</label>
                              <input className="form-input seo-inline-input" placeholder="10" type="number"
                                value={loc.prev_bookings ?? ''} onChange={(e) => updLoc(i, { prev_bookings: e.target.value ? Number(e.target.value) : null })} /></div>
                            <div className="seo-inline-field"><label className="seo-inline-label">Prev Website Clicks</label>
                              <input className="form-input seo-inline-input" placeholder="200" type="number"
                                value={loc.prev_website_clicks ?? ''} onChange={(e) => updLoc(i, { prev_website_clicks: e.target.value ? Number(e.target.value) : null })} /></div>
                          </div>
                          <div className="seo-inline-field" style={{ marginTop: 10 }}>
                            <label className="seo-inline-label">Overview</label>
                            <textarea className="form-input seo-gmb-overview-input" placeholder="Brief description…"
                              value={loc.overview} onChange={(e) => updLoc(i, { overview: e.target.value })} />
                          </div>
                          <div className="seo-inline-field" style={{ marginTop: 10 }}>
                            <label className="seo-inline-label">Key Insights</label>
                            <textarea className="form-input seo-gmb-overview-input" placeholder="Key insights…"
                              value={loc.key_insights} onChange={(e) => updLoc(i, { key_insights: e.target.value })} />
                          </div>
                        </div>
                      ))}
                      <button className="seo-manual-add" style={{ marginBottom: 12 }}
                        onClick={() => setManualEdit({ ...manualEdit, gmb_locations: [...manualEdit.gmb_locations, emptyGmbLocation()] })}>
                        + Add Location
                      </button>
                      <div className="seo-manual-actions">
                        <button className="seo-inline-save" onClick={saveManual} disabled={manualSaving}>{manualSaving ? 'Saving…' : 'Save'}</button>
                      </div>
                    </div>
                  )}

                  {locs.map((loc, i) => {
                    const hasData = loc.rating != null || loc.reviews != null || loc.calls != null || loc.bookings != null || loc.website_clicks != null;
                    return (
                      <div key={i} style={locs.length > 1 ? { borderBottom: '1px solid var(--sand-border)', paddingBottom: 16, marginBottom: 16 } : {}}>
                        {locs.length > 1 && loc.name && <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-muted)', marginBottom: 8 }}>{loc.name}</p>}
                        {hasData && (
                          <div className="seo-gmb-grid">
                            {loc.rating != null && (<div className="seo-gmb-card"><Star size={14} className="seo-gmb-icon seo-gmb-icon--star" /><div><p className="seo-card__val">{Number(loc.rating).toFixed(1)}</p><p className="seo-card__label">Rating</p>{gmbDelta(loc.rating, loc.prev_rating)}</div></div>)}
                            {loc.reviews != null && (<div className="seo-gmb-card"><FileText size={14} className="seo-gmb-icon" /><div><p className="seo-card__val">{loc.reviews.toLocaleString()}</p><p className="seo-card__label">Reviews</p>{gmbDelta(loc.reviews, loc.prev_reviews)}</div></div>)}
                            {loc.calls != null && (<div className="seo-gmb-card"><MousePointer size={14} className="seo-gmb-icon" /><div><p className="seo-card__val">{loc.calls.toLocaleString()}</p><p className="seo-card__label">Calls</p>{gmbDelta(loc.calls, loc.prev_calls)}</div></div>)}
                            {loc.bookings != null && (<div className="seo-gmb-card"><Check size={14} className="seo-gmb-icon" /><div><p className="seo-card__val">{loc.bookings.toLocaleString()}</p><p className="seo-card__label">Bookings</p>{gmbDelta(loc.bookings, loc.prev_bookings)}</div></div>)}
                            {loc.website_clicks != null && (<div className="seo-gmb-card"><Globe size={14} className="seo-gmb-icon" /><div><p className="seo-card__val">{loc.website_clicks.toLocaleString()}</p><p className="seo-card__label">Website Clicks</p>{gmbDelta(loc.website_clicks, loc.prev_website_clicks)}</div></div>)}
                          </div>
                        )}
                        {loc.overview && <p className="seo-gmb-overview-text">{loc.overview}</p>}
                        {loc.key_insights && <div className="seo-insights-display" style={{ marginTop: 10 }}>{loc.key_insights}</div>}
                        {loc.profile_url && <div className="seo-gmb-links"><a href={loc.profile_url} target="_blank" rel="noreferrer" className="seo-gmb-link"><Star size={11} /> GMB Profile</a></div>}
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* ── Social Media Report ── */}
            <div className="seo-section">
              <h2 className="seo-section__title" style={{ fontSize: 17, fontWeight: 700, borderBottom: 'none', marginBottom: 4 }}>
                Social Media Report
              </h2>

              {/* Platform tabs */}
              <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border)', marginBottom: 16, flexWrap: 'wrap', gap: 4 }}>
                {(['meta_organic', 'linkedin_organic'] as const).map((tab) => (
                  <button key={tab} type="button" onClick={() => setSocialTab(tab)}
                    style={{
                      padding: '8px 16px', fontSize: 13, fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer',
                      borderBottom: socialTab === tab ? '2px solid var(--brand,#2563eb)' : '2px solid transparent',
                      color: socialTab === tab ? 'var(--brand,#2563eb)' : 'var(--ink-muted)',
                      marginBottom: -1,
                    }}>
                    {tab === 'meta_organic' ? 'Meta Organic' : 'LinkedIn Organic'}
                  </button>
                ))}
                {canEdit && (
                  <button type="button" className="seo-manual-edit-btn" style={{ marginLeft: 'auto', marginRight: 4 }}
                    onClick={() => openManualPanel(manualPanel === socialTab ? null : socialTab)}>
                    {manualPanel === socialTab
                      ? <><X size={11} /> Cancel</>
                      : <><Edit2 size={11} /> Edit</>}
                  </button>
                )}
              </div>

              {/* Meta Organic Tab (Instagram & Facebook) */}
              {socialTab === 'meta_organic' && (() => {
                const mo = manual.meta_organic ?? { instagram: emptyOrganicMetrics(), facebook: emptyOrganicMetrics() };
                const moEdit = manualEdit.meta_organic ?? { instagram: emptyOrganicMetrics(), facebook: emptyOrganicMetrics() };
                const setInstaOrg = (field: keyof OrganicMetrics, val: string | null) =>
                  setManualEdit(prev => ({
                    ...prev,
                    meta_organic: {
                      ...prev.meta_organic,
                      instagram: { ...(prev.meta_organic?.instagram ?? emptyOrganicMetrics()), [field]: val },
                    },
                  }));
                const setFbOrg = (field: keyof OrganicMetrics, val: string | null) =>
                  setManualEdit(prev => ({
                    ...prev,
                    meta_organic: {
                      ...prev.meta_organic,
                      facebook: { ...(prev.meta_organic?.facebook ?? emptyOrganicMetrics()), [field]: val },
                    },
                  }));

                const renderOrganicCard = (title: string, metrics: OrganicMetrics) => {
                  const parsed = parseOrganicDisplay(metrics);
                  return (
                    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 16, background: 'var(--surface)' }}>
                      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: 'var(--brand,#2563eb)' }}>{title}</h3>
                      <div className="seo-li-stats">
                        <div className="seo-li-stat">
                          <p className="seo-card__val">{parsed.viewsVal}</p>
                          <p className="seo-card__label">Views</p>
                        </div>
                        <div className="seo-li-stat">
                          <p className="seo-card__val">{parsed.reachVal}</p>
                          <p className="seo-card__label">Reach</p>
                        </div>
                        <div className="seo-li-stat">
                          <p className="seo-card__val">{parsed.interactionsVal}</p>
                          <p className="seo-card__label">Content Interactions</p>
                        </div>
                        <div className="seo-li-stat">
                          <p className="seo-card__val">{parsed.linkClicksVal}</p>
                          <p className="seo-card__label">Link Clicks</p>
                        </div>
                      </div>
                      {parsed.key_insights && (
                        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px dashed var(--border)' }}>
                          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Key Insights</p>
                          <div className="seo-insights-display" dangerouslySetInnerHTML={{ __html: parsed.key_insights }} />
                        </div>
                      )}
                      {parsed.top_post_description && (
                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--border)' }}>
                          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Top Performing Post</p>
                          <p style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.6 }}>{parsed.top_post_description}</p>
                          {parsed.top_post_impressions && <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 2 }}>Impressions: <strong>{parsed.top_post_impressions}</strong></p>}
                        </div>
                      )}
                      {parsed.channel_plan_action && (
                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--border)' }}>
                          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Plan — Next Period</p>
                          <p style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.6 }}>{parsed.channel_plan_action}</p>
                          {parsed.channel_plan_impressions_target && <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 2 }}>Impressions target: <strong>{parsed.channel_plan_impressions_target}</strong></p>}
                        </div>
                      )}
                      {parsed.flags_risks && (
                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--border)', background: '#fef2f2', borderRadius: 6, padding: '8px 10px' }}>
                          <p style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', marginBottom: 4 }}>Flags / Risks</p>
                          <p style={{ fontSize: 13, color: '#7f1d1d', lineHeight: 1.6 }}>{parsed.flags_risks}</p>
                        </div>
                      )}
                    </div>
                  );
                };

                return (
                  <>
                    {manualPanel === 'meta_organic' && canEdit && (
                      <div className="seo-manual-panel" style={{ marginBottom: 20 }}>
                        <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Instagram Organic (Manual Inputs)</h4>
                        <div className="seo-manual-grid" style={{ marginBottom: 14 }}>
                          <div className="seo-inline-field"><label className="seo-inline-label">Views</label><input className="form-input seo-inline-input" placeholder="e.g. 12,500" value={moEdit.instagram?.views ?? ''} onChange={(e) => setInstaOrg('views', e.target.value || null)} /></div>
                          <div className="seo-inline-field"><label className="seo-inline-label">Reach</label><input className="form-input seo-inline-input" placeholder="e.g. 1,75,828" value={moEdit.instagram?.reach ?? ''} onChange={(e) => setInstaOrg('reach', e.target.value || null)} /></div>
                          <div className="seo-inline-field"><label className="seo-inline-label">Content Interactions</label><input className="form-input seo-inline-input" placeholder="e.g. 430" value={moEdit.instagram?.content_interactions ?? ''} onChange={(e) => setInstaOrg('content_interactions', e.target.value || null)} /></div>
                          <div className="seo-inline-field"><label className="seo-inline-label">Link Clicks</label><input className="form-input seo-inline-input" placeholder="e.g. 58" value={moEdit.instagram?.link_clicks ?? ''} onChange={(e) => setInstaOrg('link_clicks', e.target.value || null)} /></div>
                        </div>
                        <div className="seo-inline-field" style={{ marginBottom: 16 }}>
                          <label className="seo-inline-label">Instagram Key Insights</label>
                          <textarea className="form-input seo-inline-input" rows={2} style={{ width: '100%' }} placeholder="Key insights…" value={moEdit.instagram?.key_insights ?? ''} onChange={(e) => setInstaOrg('key_insights', e.target.value || null)} />
                        </div>
                        <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, marginTop: 12 }}>Top performing post this period</h4>
                        <div className="seo-manual-grid" style={{ marginBottom: 10 }}>
                          <div className="seo-inline-field"><label className="seo-inline-label">Post description</label><input className="form-input seo-inline-input" placeholder="e.g. MEP layout planning checklist for contractors" value={moEdit.instagram?.top_post_description ?? ''} onChange={(e) => setInstaOrg('top_post_description', e.target.value || null)} /></div>
                          <div className="seo-inline-field"><label className="seo-inline-label">Impressions</label><input className="form-input seo-inline-input" placeholder="e.g. 410" value={moEdit.instagram?.top_post_impressions ?? ''} onChange={(e) => setInstaOrg('top_post_impressions', e.target.value || null)} /></div>
                        </div>
                        <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, marginTop: 12 }}>Plan for this channel next period</h4>
                        <div className="seo-manual-grid" style={{ marginBottom: 10 }}>
                          <div className="seo-inline-field"><label className="seo-inline-label">Action</label><input className="form-input seo-inline-input" placeholder="e.g. Publish 1 technical article, engage in 3 industry group discussions" value={moEdit.instagram?.channel_plan_action ?? ''} onChange={(e) => setInstaOrg('channel_plan_action', e.target.value || null)} /></div>
                          <div className="seo-inline-field"><label className="seo-inline-label">Impressions target</label><input className="form-input seo-inline-input" placeholder="e.g. 1100" value={moEdit.instagram?.channel_plan_impressions_target ?? ''} onChange={(e) => setInstaOrg('channel_plan_impressions_target', e.target.value || null)} /></div>
                        </div>
                        <div className="seo-inline-field" style={{ marginBottom: 14 }}>
                          <label className="seo-inline-label">Flags / Risks <span style={{ fontWeight: 400, color: 'var(--ink-muted)' }}>(Optional)</span></label>
                          <p style={{ fontSize: 11, color: 'var(--ink-muted)', marginBottom: 4 }}>Leave blank if nothing's wrong — this only shows on the report if filled in.</p>
                          <textarea className="form-input seo-inline-input" rows={2} style={{ width: '100%' }} placeholder="Flags or risks…" value={moEdit.instagram?.flags_risks ?? ''} onChange={(e) => setInstaOrg('flags_risks', e.target.value || null)} />
                        </div>

                        <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, marginTop: 10 }}>Facebook Organic (Manual Inputs)</h4>
                        <div className="seo-manual-grid" style={{ marginBottom: 14 }}>
                          <div className="seo-inline-field"><label className="seo-inline-label">Views</label><input className="form-input seo-inline-input" placeholder="e.g. 5,200" value={moEdit.facebook?.views ?? ''} onChange={(e) => setFbOrg('views', e.target.value || null)} /></div>
                          <div className="seo-inline-field"><label className="seo-inline-label">Reach</label><input className="form-input seo-inline-input" placeholder="e.g. 2,110" value={moEdit.facebook?.reach ?? ''} onChange={(e) => setFbOrg('reach', e.target.value || null)} /></div>
                          <div className="seo-inline-field"><label className="seo-inline-label">Content Interactions</label><input className="form-input seo-inline-input" placeholder="e.g. 180" value={moEdit.facebook?.content_interactions ?? ''} onChange={(e) => setFbOrg('content_interactions', e.target.value || null)} /></div>
                          <div className="seo-inline-field"><label className="seo-inline-label">Link Clicks</label><input className="form-input seo-inline-input" placeholder="e.g. 24" value={moEdit.facebook?.link_clicks ?? ''} onChange={(e) => setFbOrg('link_clicks', e.target.value || null)} /></div>
                        </div>
                        <div className="seo-inline-field" style={{ marginBottom: 16 }}>
                          <label className="seo-inline-label">Facebook Key Insights</label>
                          <textarea className="form-input seo-inline-input" rows={2} style={{ width: '100%' }} placeholder="Key insights…" value={moEdit.facebook?.key_insights ?? ''} onChange={(e) => setFbOrg('key_insights', e.target.value || null)} />
                        </div>
                        <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, marginTop: 12 }}>Top performing post this period</h4>
                        <div className="seo-manual-grid" style={{ marginBottom: 10 }}>
                          <div className="seo-inline-field"><label className="seo-inline-label">Post description</label><input className="form-input seo-inline-input" placeholder="e.g. MEP layout planning checklist for contractors" value={moEdit.facebook?.top_post_description ?? ''} onChange={(e) => setFbOrg('top_post_description', e.target.value || null)} /></div>
                          <div className="seo-inline-field"><label className="seo-inline-label">Impressions</label><input className="form-input seo-inline-input" placeholder="e.g. 410" value={moEdit.facebook?.top_post_impressions ?? ''} onChange={(e) => setFbOrg('top_post_impressions', e.target.value || null)} /></div>
                        </div>
                        <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, marginTop: 12 }}>Plan for this channel next period</h4>
                        <div className="seo-manual-grid" style={{ marginBottom: 10 }}>
                          <div className="seo-inline-field"><label className="seo-inline-label">Action</label><input className="form-input seo-inline-input" placeholder="e.g. Publish 1 technical article, engage in 3 industry group discussions" value={moEdit.facebook?.channel_plan_action ?? ''} onChange={(e) => setFbOrg('channel_plan_action', e.target.value || null)} /></div>
                          <div className="seo-inline-field"><label className="seo-inline-label">Impressions target</label><input className="form-input seo-inline-input" placeholder="e.g. 1100" value={moEdit.facebook?.channel_plan_impressions_target ?? ''} onChange={(e) => setFbOrg('channel_plan_impressions_target', e.target.value || null)} /></div>
                        </div>
                        <div className="seo-inline-field" style={{ marginBottom: 14 }}>
                          <label className="seo-inline-label">Flags / Risks <span style={{ fontWeight: 400, color: 'var(--ink-muted)' }}>(Optional)</span></label>
                          <p style={{ fontSize: 11, color: 'var(--ink-muted)', marginBottom: 4 }}>Leave blank if nothing's wrong — this only shows on the report if filled in.</p>
                          <textarea className="form-input seo-inline-input" rows={2} style={{ width: '100%' }} placeholder="Flags or risks…" value={moEdit.facebook?.flags_risks ?? ''} onChange={(e) => setFbOrg('flags_risks', e.target.value || null)} />
                        </div>

                        <div className="seo-manual-actions">
                          <button className="seo-inline-save" onClick={saveManual} disabled={manualSaving}>{manualSaving ? 'Saving…' : 'Save'}</button>
                        </div>
                      </div>
                    )}
                    {renderOrganicCard('Instagram Organic', mo.instagram)}
                    {renderOrganicCard('Facebook Organic', mo.facebook)}
                  </>
                );
              })()}

              {/* LinkedIn Organic Tab */}
              {socialTab === 'linkedin_organic' && (() => {
                const lo = manual.linkedin_organic ?? emptyOrganicMetrics();
                const loEdit = manualEdit.linkedin_organic ?? emptyOrganicMetrics();
                const setLiOrg = (field: keyof OrganicMetrics, val: string | null) =>
                  setManualEdit(prev => ({
                    ...prev,
                    linkedin_organic: { ...(prev.linkedin_organic ?? emptyOrganicMetrics()), [field]: val },
                  }));

                const parsed = parseOrganicDisplay(lo);

                return (
                  <>
                    {manualPanel === 'linkedin_organic' && canEdit && (
                      <div className="seo-manual-panel" style={{ marginBottom: 20 }}>
                        <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>LinkedIn Organic (Manual Inputs)</h4>
                        <div className="seo-manual-grid" style={{ marginBottom: 14 }}>
                          <div className="seo-inline-field"><label className="seo-inline-label">Views</label><input className="form-input seo-inline-input" placeholder="e.g. 3,200" value={loEdit.views ?? ''} onChange={(e) => setLiOrg('views', e.target.value || null)} /></div>
                          <div className="seo-inline-field"><label className="seo-inline-label">Reach</label><input className="form-input seo-inline-input" placeholder="e.g. 960" value={loEdit.reach ?? ''} onChange={(e) => setLiOrg('reach', e.target.value || null)} /></div>
                          <div className="seo-inline-field"><label className="seo-inline-label">Content Interactions</label><input className="form-input seo-inline-input" placeholder="e.g. 75" value={loEdit.content_interactions ?? ''} onChange={(e) => setLiOrg('content_interactions', e.target.value || null)} /></div>
                          <div className="seo-inline-field"><label className="seo-inline-label">Link Clicks</label><input className="form-input seo-inline-input" placeholder="e.g. 18" value={loEdit.link_clicks ?? ''} onChange={(e) => setLiOrg('link_clicks', e.target.value || null)} /></div>
                        </div>
                        <div className="seo-inline-field" style={{ marginBottom: 16 }}>
                          <label className="seo-inline-label">Key Insights</label>
                          <textarea className="form-input seo-inline-input" rows={2} style={{ width: '100%' }} placeholder="Key insights…" value={loEdit.key_insights ?? ''} onChange={(e) => setLiOrg('key_insights', e.target.value || null)} />
                        </div>
                        <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, marginTop: 12 }}>Top performing post this period</h4>
                        <div className="seo-manual-grid" style={{ marginBottom: 10 }}>
                          <div className="seo-inline-field"><label className="seo-inline-label">Post description</label><input className="form-input seo-inline-input" placeholder="e.g. MEP layout planning checklist for contractors" value={loEdit.top_post_description ?? ''} onChange={(e) => setLiOrg('top_post_description', e.target.value || null)} /></div>
                          <div className="seo-inline-field"><label className="seo-inline-label">Impressions</label><input className="form-input seo-inline-input" placeholder="e.g. 410" value={loEdit.top_post_impressions ?? ''} onChange={(e) => setLiOrg('top_post_impressions', e.target.value || null)} /></div>
                        </div>
                        <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, marginTop: 12 }}>Plan for this channel next period</h4>
                        <div className="seo-manual-grid" style={{ marginBottom: 10 }}>
                          <div className="seo-inline-field"><label className="seo-inline-label">Action</label><input className="form-input seo-inline-input" placeholder="e.g. Publish 1 technical article, engage in 3 industry group discussions" value={loEdit.channel_plan_action ?? ''} onChange={(e) => setLiOrg('channel_plan_action', e.target.value || null)} /></div>
                          <div className="seo-inline-field"><label className="seo-inline-label">Impressions target</label><input className="form-input seo-inline-input" placeholder="e.g. 1100" value={loEdit.channel_plan_impressions_target ?? ''} onChange={(e) => setLiOrg('channel_plan_impressions_target', e.target.value || null)} /></div>
                        </div>
                        <div className="seo-inline-field" style={{ marginBottom: 14 }}>
                          <label className="seo-inline-label">Flags / Risks <span style={{ fontWeight: 400, color: 'var(--ink-muted)' }}>(Optional)</span></label>
                          <p style={{ fontSize: 11, color: 'var(--ink-muted)', marginBottom: 4 }}>Leave blank if nothing's wrong — this only shows on the report if filled in.</p>
                          <textarea className="form-input seo-inline-input" rows={2} style={{ width: '100%' }} placeholder="Flags or risks…" value={loEdit.flags_risks ?? ''} onChange={(e) => setLiOrg('flags_risks', e.target.value || null)} />
                        </div>
                        <div className="seo-manual-actions">
                          <button className="seo-inline-save" onClick={saveManual} disabled={manualSaving}>{manualSaving ? 'Saving…' : 'Save'}</button>
                        </div>
                      </div>
                    )}
                    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 16, background: 'var(--surface)' }}>
                      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: 'var(--brand,#2563eb)' }}>LinkedIn Organic</h3>
                      <div className="seo-li-stats">
                        <div className="seo-li-stat">
                          <p className="seo-card__val">{parsed.viewsVal}</p>
                          <p className="seo-card__label">Views</p>
                        </div>
                        <div className="seo-li-stat">
                          <p className="seo-card__val">{parsed.reachVal}</p>
                          <p className="seo-card__label">Reach</p>
                        </div>
                        <div className="seo-li-stat">
                          <p className="seo-card__val">{parsed.interactionsVal}</p>
                          <p className="seo-card__label">Content Interactions</p>
                        </div>
                        <div className="seo-li-stat">
                          <p className="seo-card__val">{parsed.linkClicksVal}</p>
                          <p className="seo-card__label">Link Clicks</p>
                        </div>
                      </div>
                      {parsed.key_insights && (
                        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px dashed var(--border)' }}>
                          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Key Insights</p>
                          <div className="seo-insights-display" dangerouslySetInnerHTML={{ __html: parsed.key_insights }} />
                        </div>
                      )}
                      {parsed.top_post_description && (
                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--border)' }}>
                          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Top Performing Post</p>
                          <p style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.6 }}>{parsed.top_post_description}</p>
                          {parsed.top_post_impressions && <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 2 }}>Impressions: <strong>{parsed.top_post_impressions}</strong></p>}
                        </div>
                      )}
                      {parsed.channel_plan_action && (
                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--border)' }}>
                          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Plan — Next Period</p>
                          <p style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.6 }}>{parsed.channel_plan_action}</p>
                          {parsed.channel_plan_impressions_target && <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 2 }}>Impressions target: <strong>{parsed.channel_plan_impressions_target}</strong></p>}
                        </div>
                      )}
                      {parsed.flags_risks && (
                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--border)', background: '#fef2f2', borderRadius: 6, padding: '8px 10px' }}>
                          <p style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', marginBottom: 4 }}>Flags / Risks</p>
                          <p style={{ fontSize: 13, color: '#7f1d1d', lineHeight: 1.6 }}>{parsed.flags_risks}</p>
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}

            </div>

            {/* ── Performance Marketing (Paid) ── */}
            <div className="seo-section">
              <h2 className="seo-section__title" style={{ fontSize: 17, fontWeight: 700, borderBottom: 'none', marginBottom: 4 }}>
                Performance Marketing
              </h2>

              {/* Platform tabs */}
              <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border)', marginBottom: 16, flexWrap: 'wrap', gap: 4 }}>
                {(['meta_paid', 'linkedin_paid'] as const).map((tab) => (
                  <button key={tab} type="button" onClick={() => setPaidTab(tab)}
                    style={{
                      padding: '8px 16px', fontSize: 13, fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer',
                      borderBottom: paidTab === tab ? '2px solid #059669' : '2px solid transparent',
                      color: paidTab === tab ? '#059669' : 'var(--ink-muted)',
                      marginBottom: -1,
                    }}>
                    {tab === 'meta_paid' ? 'Meta Paid' : 'LinkedIn Paid'}
                  </button>
                ))}
                {canEdit && (
                  <button type="button" className="seo-manual-edit-btn" style={{ marginLeft: 'auto', marginRight: 4 }}
                    onClick={() => openManualPanel(manualPanel === 'performance_marketing' ? null : 'performance_marketing')}>
                    {manualPanel === 'performance_marketing'
                      ? <><X size={11} /> Cancel</>
                      : <><Edit2 size={11} /> Edit</>}
                  </button>
                )}
              </div>

              {/* Edit Mode for Performance Marketing */}
              {manualPanel === 'performance_marketing' && canEdit && (() => {
                const pmEdit = manualEdit.performance_marketing ?? { meta_paid: emptyPaidMetrics(), linkedin_paid: emptyPaidMetrics() };
                const setPaidField = (platformKey: 'meta_paid' | 'linkedin_paid', field: keyof PaidMetrics, val: string | null) =>
                  setManualEdit(prev => ({
                    ...prev,
                    performance_marketing: {
                      ...(prev.performance_marketing ?? { meta_paid: emptyPaidMetrics(), linkedin_paid: emptyPaidMetrics() }),
                      [platformKey]: { ...(prev.performance_marketing?.[platformKey] ?? emptyPaidMetrics()), [field]: val },
                    },
                  }));

                const renderPaidInputs = (title: string, pKey: 'meta_paid' | 'linkedin_paid', defaultSpend: string, defaultReach: string, defaultReachChg: string, defaultCost: string) => (
                  <div style={{ marginBottom: 20 }}>
                    <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{title} Inputs</h4>
                    <div className="seo-manual-grid" style={{ marginBottom: 10 }}>
                      <div className="seo-inline-field"><label className="seo-inline-label">Spend</label><input className="form-input seo-inline-input" placeholder={`e.g. ${defaultSpend}`} value={pmEdit[pKey]?.spend ?? ''} onChange={(e) => setPaidField(pKey, 'spend', e.target.value || null)} /></div>
                      <div className="seo-inline-field"><label className="seo-inline-label">Reach</label><input className="form-input seo-inline-input" placeholder={`e.g. ${defaultReach}`} value={pmEdit[pKey]?.reach ?? ''} onChange={(e) => setPaidField(pKey, 'reach', e.target.value || null)} /></div>
                      <div className="seo-inline-field"><label className="seo-inline-label">Reach Change</label><input className="form-input seo-inline-input" placeholder={`e.g. ${defaultReachChg}`} value={pmEdit[pKey]?.reach_change ?? ''} onChange={(e) => setPaidField(pKey, 'reach_change', e.target.value || null)} /></div>
                      <div className="seo-inline-field"><label className="seo-inline-label">Cost / Reach Point</label><input className="form-input seo-inline-input" placeholder={`e.g. ${defaultCost}`} value={pmEdit[pKey]?.cost_per_reach ?? ''} onChange={(e) => setPaidField(pKey, 'cost_per_reach', e.target.value || null)} /></div>
                    </div>
                    <div className="seo-inline-field">
                      <label className="seo-inline-label">Key Insights</label>
                      <textarea className="form-input seo-inline-input" rows={2} style={{ width: '100%' }} placeholder="Key insights…" value={pmEdit[pKey]?.key_insights ?? ''} onChange={(e) => setPaidField(pKey, 'key_insights', e.target.value || null)} />
                    </div>
                  </div>
                );

                return (
                  <div className="seo-manual-panel" style={{ marginBottom: 20 }}>
                    {renderPaidInputs('Meta Paid', 'meta_paid', '49,500', '1,27,242', '↑ 12%', '0.39')}
                    {renderPaidInputs('LinkedIn Paid', 'linkedin_paid', '31,000', '74,549', '↑ 14%', '0.42')}
                    <div className="seo-manual-actions">
                      <button className="seo-inline-save" onClick={saveManual} disabled={manualSaving}>{manualSaving ? 'Saving…' : 'Save'}</button>
                    </div>
                  </div>
                );
              })()}

              {/* Display Mode for Performance Marketing */}
              {(() => {
                const pm = manual.performance_marketing ?? { meta_paid: emptyPaidMetrics(), linkedin_paid: emptyPaidMetrics() };
                const curPaid = paidTab === 'meta_paid' ? (pm.meta_paid || pm.instagram_paid) : pm.linkedin_paid;
                const parsed = parsePaidDisplay(curPaid);
                const title = paidTab === 'meta_paid' ? 'Meta Paid' : 'LinkedIn Paid';

                return (
                  <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 16, background: 'var(--surface)' }}>
                    <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: '#059669' }}>{title}</h3>
                    <div className="seo-li-stats">
                      <div className="seo-li-stat">
                        <p className="seo-card__val" style={{ color: '#059669' }}>{parsed.spendVal}</p>
                        <p className="seo-card__label">Paid Spend</p>
                      </div>
                      <div className="seo-li-stat">
                        <p className="seo-card__val">
                          {parsed.reachVal}
                          {parsed.reachBadge && <span style={{ fontSize: 11, fontWeight: 700, marginLeft: 6, color: parsed.reachBadge.isDown ? '#dc2626' : '#16a34a' }}>{parsed.reachBadge.text}</span>}
                        </p>
                        <p className="seo-card__label">Paid Reach</p>
                      </div>
                      <div className="seo-li-stat">
                        <p className="seo-card__val">{parsed.costVal}</p>
                        <p className="seo-card__label">Cost / Reach Point</p>
                      </div>
                    </div>
                    {parsed.key_insights && (
                      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px dashed var(--border)' }}>
                        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Key Insights</p>
                        <div className="seo-insights-display" dangerouslySetInnerHTML={{ __html: parsed.key_insights }} />
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

          </>
        )}
      </div>
    </Layout>
  );
}
