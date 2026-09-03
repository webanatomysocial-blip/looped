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
interface OrganicForm  { date: string; source: string; contact: string; doc_link?: string; }
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
  clicks: string | null;
  reach: string | null;
  content_interactions: string | null;
  link_clicks: string | null;
  key_insights: string | null;
  top_post_description: string | null;
  top_post_impressions: string | null;
  channel_plan_action: string | null;
  channel_plan_impressions_target: string | null;
}

interface MetaOrganic {
  instagram: OrganicMetrics;
  facebook: OrganicMetrics;
}

interface PmCampaign {
  name: string; reach: string; impressions: string;
  clicks: string; leads: string; cost_per_lead: string; cost: string;
}
interface PmGroup { campaigns: PmCampaign[]; key_insights: string; }
interface PerformanceMarketing {
  google: PmGroup;
  linkedin: PmGroup;
  meta: PmGroup;
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
  best_performing_asset: string | string[];
  next_period_plan: NextPeriodPlanItem[];
  period_targets: PeriodTargets;
  // Social & Performance Marketing
  meta_organic: MetaOrganic;
  linkedin_organic: OrganicMetrics;
  performance_marketing: PerformanceMarketing;
  health_score: number;
  health_label: string;
  flags_risks: string;
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

function fmtDuration(s: number) { const m = Math.floor(s / 60); return `${m}m ${s % 60}s`; }
export const parseOrganicDisplay = (metrics: OrganicMetrics | undefined) => {
  if (!metrics) return { viewsVal: '—', clicksVal: '—', reachVal: '—', interactionsVal: '—', linkClicksVal: '—', key_insights: null, top_post_description: null, top_post_impressions: null, channel_plan_action: null, channel_plan_impressions_target: null };
  return {
    viewsVal:        metrics.views?.trim()                || '—',
    clicksVal:       metrics.clicks?.trim()               || '—',
    reachVal:        metrics.reach?.trim()                || '—',
    interactionsVal: metrics.content_interactions?.trim() || '—',
    linkClicksVal:   metrics.link_clicks?.trim()          || '—',
    key_insights:    metrics.key_insights,
    top_post_description:            metrics.top_post_description,
    top_post_impressions:            metrics.top_post_impressions,
    channel_plan_action:             metrics.channel_plan_action,
    channel_plan_impressions_target: metrics.channel_plan_impressions_target,
  };
};

const calcPmTotals = (g: PmGroup) => g.campaigns.reduce(
  (acc, c) => ({
    reach: acc.reach + (Number(c.reach) || 0),
    impressions: acc.impressions + (Number(c.impressions) || 0),
    clicks: acc.clicks + (Number(c.clicks) || 0),
    leads: acc.leads + (Number(c.leads) || 0),
    cost: acc.cost + (Number(c.cost) || 0),
  }),
  { reach: 0, impressions: 0, clicks: 0, leads: 0, cost: 0 }
);

const calcPmAvgCpl = (g: PmGroup): number | null => {
  const vals = g.campaigns.map((c) => Number(c.cost_per_lead)).filter((v) => !isNaN(v) && v > 0);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
};

function downloadPDF(
  report: Report,
  clientName: string,
  range: string,
  manual: ManualData,
  demoCountry: string,
  selectedAcquisitions: Set<string>,
  selectedDemographics: Set<string>,
  agencyName = 'webanatomy',
  customStart = '',
  customEnd = '',
  compareStart = '',
  compareEnd = ''
) {
  const eng = report.engagement;
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
    ['Total Users',     eng.users.toLocaleString()         + cmpBadge(eng.users, prev?.users)],
    ['New Users',       eng.newUsers.toLocaleString()       + cmpBadge(eng.newUsers, prev?.newUsers)],
    ['Sessions',        eng.sessions.toLocaleString()       + cmpBadge(eng.sessions, prev?.sessions)],
    ['Avg. Duration',   fmtDuration(eng.avgDuration)        + cmpBadge(eng.avgDuration, prev?.avgDuration)],
    ['Engagement Rate', `${eng.engagementRate}%`            + cmpBadge(eng.engagementRate, prev?.engagementRate)],
  ];

  const acqRows = report.acquisition.filter((r) => selectedAcquisitions.has(r.channel)).map((r, i) => `
    <tr style="background:${i % 2 === 0 ? '#f9f9f9' : '#fff'}">
      <td style="padding:8px 12px;font-weight:600">${r.channel}</td>
      <td style="padding:8px 12px;text-align:left">${r.sessions.toLocaleString()}</td>
      <td style="padding:8px 12px;text-align:left">${r.users.toLocaleString()}</td>
    </tr>`).join('');

  const showCountryCol = demoCountry === 'all';
  const demoRows = report.demographics.filter((r) => selectedDemographics.has(r.city)).map((r: any, i) => `
    <tr style="background:${i % 2 === 0 ? '#f9f9f9' : '#fff'}">
      <td style="padding:8px 12px;font-weight:600">${r.city}</td>
      ${showCountryCol ? `<td style="padding:8px 12px;color:#888">${r.country ?? ''}</td>` : ''}
      <td style="padding:8px 12px;text-align:left">${r.users.toLocaleString()}</td>
      <td style="padding:8px 12px;text-align:left">${r.sessions.toLocaleString()}</td>
    </tr>`).join('');

  const totalClicks = report.pages.reduce((s, p) => s + p.clicks, 0);
  const totalImpr   = report.pages.reduce((s, p) => s + p.impressions, 0);
  const avgCtr      = totalImpr > 0 ? ((totalClicks / totalImpr) * 100).toFixed(1) : '0.0';
  const avgPos      = report.pages.length > 0
    ? (report.pages.reduce((s, p) => s + p.position, 0) / report.pages.length).toFixed(1) : '—';

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
<h2>Current Period Targets</h2>
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

  // ── Key Highlights (BPA only, matching share link design) ──
  const bpaItems = Array.isArray(manual.best_performing_asset) ? manual.best_performing_asset.filter(Boolean) : (manual.best_performing_asset ? [manual.best_performing_asset as string] : []);
  const highlightsHtml = bpaItems.length > 0 ? `
<div class="section-block">
<h2>Key Highlights &amp; Insights</h2>
<div class="section">
  <div class="section-inner">
    <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#888;margin:0 0 4px">Best Performing Asset / Campaign</p>
    <ul>${bpaItems.map((item) => `<li style="font-size:13px;line-height:1.6;margin-bottom:4px">${item}</li>`).join('')}</ul>
  </div>
</div>
</div>` : '';

  // ── Notable Changes (separate section, matching share link design) ──
  const notableChangesHtml = (() => {
    const hasSigWhys = manual.sig_change_whys && Object.values(manual.sig_change_whys).some((v: any) => (v as string)?.trim?.());
    if (!hasSigWhys) return '';
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
    (manual.gmb_locations ?? []).forEach((loc: any, gi: number) => {
      const prefix = (manual.gmb_locations?.length ?? 0) > 1 ? `${loc.name || `Location ${gi + 1}`} ` : '';
      const checkGmb = (key: string, label: string, cur: number | null, pre: number | null) => {
        if (cur == null || pre == null || pre === 0) return;
        const pct = Math.round(((cur - pre) / pre) * 100);
        sigChanges.push({ key: `gmb_${gi}_${key}`, label: `GBP ${prefix}${label}`, from: pre, to: cur, pct });
      };
      checkGmb('calls', 'Calls', loc.calls, loc.prev_calls);
      checkGmb('website_clicks', 'Website Clicks', loc.website_clicks, loc.prev_website_clicks);
      checkGmb('reviews', 'Reviews', loc.reviews, loc.prev_reviews);
      checkGmb('bookings', 'Bookings', loc.bookings, loc.prev_bookings);
    });
    const labelMap: Record<string, string> = { sessions: 'Sessions', users: 'Users', engagementRate: 'Engagement Rate' };
    const fieldMap: Record<string, string> = { calls: 'Calls', website_clicks: 'Website Clicks', reviews: 'Reviews', bookings: 'Bookings' };
    const items = [
      ...sigChanges.filter(sc => (manual.sig_change_whys?.[sc.key] as string)?.trim?.()).map(sc => `<li style="font-size:13px;line-height:1.6;margin-bottom:6px"><strong>${sc.label}:</strong> ${sc.from.toLocaleString()} → ${sc.to.toLocaleString()} <span style="font-weight:700;color:${sc.pct >= 0 ? '#16a34a' : '#dc2626'}">(${sc.pct >= 0 ? '+' : ''}${sc.pct}%)</span> <span style="color:#64748b;font-style:italic">: ${manual.sig_change_whys[sc.key]}</span></li>`),
      ...Object.entries(manual.sig_change_whys).filter(([k, v]) => (v as string)?.trim?.() && !sigChanges.find(sc => sc.key === k)).map(([k, v]) => {
        const gmbMatch = k.match(/^gmb_(\d+)_(.+)$/);
        let label = labelMap[k] ?? k;
        if (gmbMatch) {
          const loc = manual.gmb_locations?.[Number(gmbMatch[1])];
          const pre = (manual.gmb_locations?.length ?? 0) > 1 ? `${loc?.name || `Location ${Number(gmbMatch[1]) + 1}`} ` : '';
          label = `GBP ${pre}${fieldMap[gmbMatch[2]] ?? gmbMatch[2]}`;
        }
        return `<li style="font-size:13px;line-height:1.6;margin-bottom:4px"><strong>${label}:</strong> ${v}</li>`;
      }),
    ].join('');
    return items ? `
<div class="section-block">
<h2>Notable Changes This Period</h2>
<div class="section"><div class="section-inner">
  <ul style="padding-left:20px;margin:0">${items}</ul>
</div></div>
</div>` : '';
  })();

  // ── Multi GMB ──
  const hasAnyGmbData = manual.gmb_locations?.some((loc: any) =>
    loc.rating != null || loc.reviews != null || loc.calls != null ||
    loc.bookings != null || loc.website_clicks != null || loc.overview || loc.key_insights
  );
  const gmbMultiHtml = hasAnyGmbData ? `
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
  const renderOrganicBlock = (title: string, metrics: OrganicMetrics | undefined, labels?: { views?: string; clicks?: string; reach?: string; interactions?: string; linkClicks?: string }) => {
    if (!metrics || (!metrics.views && !metrics.clicks && !metrics.reach && !metrics.content_interactions && !metrics.link_clicks && !metrics.key_insights && !metrics.top_post_description && !metrics.channel_plan_action)) return '';
    const parsed = parseOrganicDisplay(metrics);

    const cards = [
      parsed.viewsVal        !== '—' ? [labels?.views        ?? 'Views',                parsed.viewsVal]        : null,
      labels?.clicks && parsed.clicksVal !== '—' ? [labels.clicks, parsed.clicksVal] : null,
      parsed.reachVal        !== '—' ? [labels?.reach        ?? 'Reach',                parsed.reachVal]        : null,
      parsed.interactionsVal !== '—' ? [labels?.interactions ?? 'Content Interactions', parsed.interactionsVal] : null,
      parsed.linkClicksVal   !== '—' ? [labels?.linkClicks   ?? 'Link Clicks',          parsed.linkClicksVal]   : null,
    ].filter(Boolean) as [string, string][];

    return `
      <div class="section" style="margin-bottom:14px">
        <div class="section-inner">
          <h3 style="font-size:13px;font-weight:700;margin-bottom:10px;color:#6366f1">${title}</h3>
          ${cards.length ? `<div class="mini-cards">${cards.map(([l, v]) => `<div class="mini-card"><div class="mini-card-val">${v}</div><div class="mini-card-label">${l}</div></div>`).join('')}</div>` : ''}
          ${parsed.key_insights ? `<div style="font-size:13px;line-height:1.7;margin-top:10px;color:#333">${parsed.key_insights}</div>` : ''}
          ${parsed.top_post_description ? `
            <div style="margin-top:10px;padding-top:10px;border-top:1px dashed #e2e8f0">
              <p style="font-size:10px;font-weight:700;text-transform:uppercase;color:#64748b;margin-bottom:4px">Top Performing Post</p>
              <p style="font-size:13px;color:#1a1a1a;line-height:1.6;margin:0">${parsed.top_post_description}</p>
              ${parsed.top_post_impressions ? `<p style="font-size:12px;color:#64748b;margin-top:2px">Impressions: <strong>${parsed.top_post_impressions}</strong></p>` : ''}
            </div>` : ''}
          ${parsed.channel_plan_action ? `
            <div style="margin-top:10px;padding-top:10px;border-top:1px dashed #e2e8f0">
              <p style="font-size:10px;font-weight:700;text-transform:uppercase;color:#64748b;margin-bottom:4px">Plan — Next Period</p>
              <p style="font-size:13px;color:#1a1a1a;line-height:1.6;margin:0">${parsed.channel_plan_action}</p>
              ${parsed.channel_plan_impressions_target ? `<p style="font-size:12px;color:#64748b;margin-top:2px">Impressions target: <strong>${parsed.channel_plan_impressions_target}</strong></p>` : ''}
            </div>` : ''}
        </div>
      </div>
    `;
  };

  const instaOrgHtml = renderOrganicBlock('Instagram Organic', manual.meta_organic?.instagram);
  const fbOrgHtml = renderOrganicBlock('Facebook Organic', manual.meta_organic?.facebook);
  const liOrgHtml = renderOrganicBlock('LinkedIn Organic', manual.linkedin_organic, { views: 'Impressions', clicks: 'Clicks', reach: 'reactions', interactions: 'Total Followers', linkClicks: 'New Followers' });

  const socialOrganicHtml = (instaOrgHtml || fbOrgHtml || liOrgHtml) ? `
<div class="section-block">
  <h2>Social Media Report (Organic)</h2>
  ${instaOrgHtml}
  ${fbOrgHtml}
  ${liOrgHtml}
</div>` : '';

  // ── Performance Marketing (Paid) ──
  const renderPmGroupBlock = (title: string, g: PmGroup | undefined) => {
    if (!g || g.campaigns.length === 0) return '';
    const tot = calcPmTotals(g);
    const avgCpl = calcPmAvgCpl(g);
    const cols = ['Campaign', 'Reach', 'Impressions', 'Clicks', 'Leads', 'Cost/Lead (₹)', 'Amount Spent (₹)'];
    const rows = g.campaigns.map((c, i) => `
      <tr style="background:${i % 2 === 0 ? '#f9f9f9' : '#fff'}">
        <td style="padding:7px 10px;font-size:12px">${c.name || '—'}</td>
        <td style="padding:7px 10px;text-align:right;font-size:12px">${c.reach || '—'}</td>
        <td style="padding:7px 10px;text-align:right;font-size:12px">${c.impressions || '—'}</td>
        <td style="padding:7px 10px;text-align:right;font-size:12px">${c.clicks || '—'}</td>
        <td style="padding:7px 10px;text-align:right;font-size:12px">${c.leads || '—'}</td>
        <td style="padding:7px 10px;text-align:right;font-size:12px">${c.cost_per_lead || '—'}</td>
        <td style="padding:7px 10px;text-align:right;font-size:12px">${c.cost || '—'}</td>
      </tr>`).join('');
    const totRow = `
      <tr style="background:#f1f5f9;font-weight:700">
        <td style="padding:7px 10px;font-size:12px">Total</td>
        <td style="padding:7px 10px;text-align:right;font-size:12px">${tot.reach.toLocaleString()}</td>
        <td style="padding:7px 10px;text-align:right;font-size:12px">${tot.impressions.toLocaleString()}</td>
        <td style="padding:7px 10px;text-align:right;font-size:12px">${tot.clicks.toLocaleString()}</td>
        <td style="padding:7px 10px;text-align:right;font-size:12px">${tot.leads.toLocaleString()}</td>
        <td style="padding:7px 10px;text-align:right;font-size:12px">${avgCpl !== null ? avgCpl.toFixed(2) : '—'}</td>
        <td style="padding:7px 10px;text-align:right;font-size:12px">${tot.cost.toLocaleString()}</td>
      </tr>`;
    return `
      <div style="margin-bottom:16px">
        <h3 style="font-size:13px;font-weight:700;margin-bottom:8px;color:#059669">${title}</h3>
        <div class="section" style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead><tr>${cols.map((c) => `<th style="padding:7px 10px;text-align:${c === 'Campaign' ? 'left' : 'right'};font-size:10px;font-weight:700;color:#64748b;background:#f1f5f9;text-transform:uppercase">${c}</th>`).join('')}</tr></thead>
            <tbody>${rows}${totRow}</tbody>
          </table>
        </div>
        ${g.key_insights ? `<div style="font-size:13px;line-height:1.7;margin-top:10px;color:#333">${g.key_insights}</div>` : ''}
      </div>`;
  };

  const pm = manual.performance_marketing;
  const googlePmHtml  = renderPmGroupBlock('Google Ads', pm?.google);
  const liPmHtml      = renderPmGroupBlock('LinkedIn Ads', pm?.linkedin);
  const metaPmHtml    = renderPmGroupBlock('Meta Ads', pm?.meta);

  const performanceMarketingHtml = (googlePmHtml || liPmHtml || metaPmHtml) ? `
<div class="section-block">
  <h2>Performance Marketing</h2>
  ${googlePmHtml}
  ${liPmHtml}
  ${metaPmHtml}
</div>` : '';

  const flagsRisksHtml = manual.flags_risks ? `
<div class="section-block" style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px 20px">
  <h2 style="color:#dc2626;font-size:14px;text-transform:uppercase;margin:0 0 8px">Flags / Risks</h2>
  <p style="font-size:13px;color:#7f1d1d;line-height:1.7;margin:0">${manual.flags_risks.replace(/\n/g, '<br/>')}</p>
</div>` : '';

  // ── Manual sections ──
  const kwRows = manual.keyword_rankings.map((k, i) => `
    <tr style="background:${i % 2 === 0 ? '#f9f9f9' : '#fff'}">
      <td style="padding:8px 12px;font-weight:600">${k.keyword}</td>
      <td style="padding:8px 12px;text-align:left;font-weight:700">#${k.rank ?? '—'}</td>
      <td style="padding:8px 12px;text-align:left;font-weight:700">#${k.change ?? '—'}</td>
    </tr>`).join('');

  const targetProgressHtml = manual.targets.length > 0 ? `
<div class="section-block">
<h2>Targets — Achieved vs Set</h2>
<div class="section"><div class="section-inner" style="display:flex;flex-direction:column;gap:10px">
  ${manual.targets.map((t) => {
    const pct = Number(t.target) > 0 ? Math.min(100, Math.round((Number(t.achieved) / Number(t.target)) * 100)) : 0;
    const done = pct >= 100;
    return `<div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <span style="font-size:13px;font-weight:600">${t.name}</span>
        <span style="font-size:12px;color:#64748b">${t.achieved ?? '—'} / ${t.target ?? '—'} <strong style="color:${done ? '#16a34a' : '#0f172a'}">${pct}%</strong></span>
      </div>
      <div style="height:6px;background:#e2e8f0;border-radius:4px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${done ? '#16a34a' : '#6366f1'};border-radius:4px"></div>
      </div>
    </div>`;
  }).join('')}
</div></div>
</div>` : '';

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
      ${liHasImpressions ? `<td style="padding:8px 12px;text-align:left">${p.impressions.toLocaleString()}</td>` : ''}
      ${liHasClicks ? `<td style="padding:8px 12px;text-align:left">${p.clicks.toLocaleString()}</td>` : ''}
      ${liHasImpressions ? `<td style="padding:8px 12px;text-align:left">${ctr ?? '—'}%</td>` : ''}
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

  const organicRows = manual.organic_form_data
    .filter((row) => row.date || row.source || row.contact || row.doc_link)
    .map((row, i) => {
      const hasFields = row.date || row.source || row.contact;
      return hasFields
        ? `<tr style="background:${i % 2 === 0 ? '#f9f9f9' : '#fff'}">
            <td style="padding:8px 12px;font-size:11px">${row.date || '—'}</td>
            <td style="padding:8px 12px;font-size:11px">${row.source || '—'}</td>
            <td style="padding:8px 12px;font-size:11px">${row.contact || '—'}</td>
            <td style="padding:8px 12px;font-size:11px">${row.doc_link ? `<a href="${row.doc_link}" style="color:#6366f1;text-decoration:underline">View Doc</a>` : '—'}</td>
          </tr>`
        : `<tr style="background:${i % 2 === 0 ? '#f9f9f9' : '#fff'}">
            <td colspan="4" style="padding:8px 12px;font-size:11px"><a href="${row.doc_link}" style="color:#6366f1;text-decoration:underline">View Doc</a></td>
          </tr>`;
    }).join('');

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
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a1a; background: #f1f5f9; padding: 32px 36px; }
  h1 { font-size: 22px; font-weight: 800; color: #ffffff; }
  h2 { font-size: 13px; font-weight: 700; color: #1e293b; margin-bottom: 12px; margin-top: 24px; text-transform: uppercase; letter-spacing: 0.05em; }
  .meta { font-size: 12px; color: #94a3b8; margin-top: 4px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit,minmax(140px,1fr)); gap: 10px; margin-bottom: 20px; }
  .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; }
  .card-val { font-size: 20px; font-weight: 800; color: #0f172a; }
  .card-label { font-size: 10px; font-weight: 600; color: #64748b; margin-top: 3px; text-transform: uppercase; letter-spacing: 0.04em; }
  .mini-cards { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 12px; }
  .mini-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 14px; min-width: 110px; }
  .mini-card-val { font-size: 15px; font-weight: 800; color: #0f172a; }
  .mini-card-label { font-size: 10px; font-weight: 600; color: #64748b; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.04em; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; font-size: 10px; font-weight: 700; color: #64748b; padding: 8px 12px; background: #f1f5f9; text-transform: uppercase; letter-spacing: 0.05em; }
  th:not(:first-child) { text-align: left; }
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
${notableChangesHtml}
${targetCardsHtml}
${lastPlanHtml}
${nextPlanHtml}
${highlightsHtml}

<h2>Website Performance</h2>
<div class="cards">
  ${cards.map(([label, val]) => `<div class="card"><div class="card-val">${val}</div><div class="card-label">${label}</div></div>`).join('')}
</div>

${totalClicks > 0 ? `
<div class="section-block">
<h2>Search Performance <span class="badge">Search Console</span></h2>
<div class="section"><div class="section-inner">
  <div class="mini-cards">
    <div class="mini-card"><div class="mini-card-val">${totalClicks.toLocaleString()}</div><div class="mini-card-label">Total Clicks</div></div>
    <div class="mini-card"><div class="mini-card-val">${totalImpr.toLocaleString()}</div><div class="mini-card-label">Impressions</div></div>
    <div class="mini-card"><div class="mini-card-val">${avgCtr}%</div><div class="mini-card-label">Avg. CTR</div></div>
    <div class="mini-card"><div class="mini-card-val">${avgPos}</div><div class="mini-card-label">Avg. Position</div></div>
  </div>
</div></div>
</div>` : ''}

${kwRows ? `
<div class="section-block">
<h2>Keyword Rankings</h2>
<div class="section">
  <table><thead><tr><th>Keyword</th><th>Previous Ranking</th><th>Current Ranking</th></tr></thead>
  <tbody>${kwRows}</tbody></table>
</div>
</div>` : ''}

${acqRows ? `
<div class="section-block">
<h2>Traffic Acquisition</h2>
<div class="section"><table><thead><tr><th>Channel</th><th>Sessions</th><th>Users</th></tr></thead><tbody>${acqRows}</tbody></table></div>
</div>` : ''}

${demoRows ? `
<div class="section-block">
<h2>Demographics — Cities${demoCountry !== 'all' ? ` (${demoCountry})` : ''}</h2>
<div class="section"><table><thead><tr><th>City</th>${showCountryCol ? '<th>Country</th>' : ''}<th>Users</th><th>Sessions</th></tr></thead><tbody>${demoRows}</tbody></table></div>
</div>` : ''}

${organicRows ? `
<div class="section-block">
<h2>Organic Form Submissions</h2>
<div class="section">
  <table><thead><tr><th>Date</th><th>Source</th><th>Contact</th><th>Doc</th></tr></thead>
  <tbody>${organicRows}</tbody></table>
</div>
</div>` : ''}

${targetProgressHtml}

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

${flagsRisksHtml}

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
  views: null, clicks: null, reach: null, content_interactions: null, link_clicks: null, key_insights: null,
  top_post_description: null, top_post_impressions: null,
  channel_plan_action: null, channel_plan_impressions_target: null,
});

const emptyPmCampaign = (): PmCampaign => ({ name: '', reach: '', impressions: '', clicks: '', leads: '', cost_per_lead: '', cost: '' });
const emptyPmGroup = (): PmGroup => ({ campaigns: [], key_insights: '' });

const emptyManual = (): ManualData => ({
  keyword_rankings: [], targets: [], key_insights: '', linkedin_data: null, social_media_data: null,
  organic_form_data: [], gmb_locations: [],
  executive_summary: '', sig_change_whys: {}, last_period_plan: [],
  best_performing_asset: [], next_period_plan: [],
  period_targets: { sessions: '', leads: '', engagement_rate: '', instagram_reach: '', facebook_reach: '' },
  meta_organic: {
    instagram: emptyOrganicMetrics(),
    facebook: emptyOrganicMetrics(),
  },
  linkedin_organic: emptyOrganicMetrics(),
  performance_marketing: { google: emptyPmGroup(), linkedin: emptyPmGroup(), meta: emptyPmGroup() },
  health_score: 76,
  health_label: 'Weighted for a balanced goal, vs target',
  flags_risks: '',
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
  const [paidTab, setPaidTab] = useState<'google' | 'linkedin' | 'meta'>('google');

  // Share links
  const [shareTokens, setShareTokens] = useState<{ token: string; range: string | null; start_date: string | null; end_date: string | null }[]>([]);
  const [showSharePanel, setShowSharePanel] = useState(false);
  const [shareCopied, setShareCopied] = useState<string | null>(null);

  // Saved reports
  const [savedReports, setSavedReports] = useState<any[]>([]);
  const [showSavedReports, setShowSavedReports] = useState(false);
  const [savingReport, setSavingReport] = useState(false);
  const [saveReportName, setSaveReportName] = useState('');
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [savedCopied, setSavedCopied] = useState<number | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [updatingSnapshotId, setUpdatingSnapshotId] = useState<number | null>(null);
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
  // Top Queries: search + pagination
  const QUERIES_PER_PAGE = 10;
  const [querySearchInput, setQuerySearchInput] = useState('');
  const [querySearch, setQuerySearch]           = useState('');
  const [queryPage, setQueryPage]               = useState(1);

  useEffect(() => {
    // New report loaded — select all items by default and reset search/pagination
    setSelectedAcquisitions(new Set(report?.acquisition.map((a) => a.channel) ?? []));
    setSelectedDemographics(new Set(report?.demographics.map((d) => d.city) ?? []));
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
    // Reset manual immediately so stale data from previous client/report never bleeds in
    setManual(emptyManual());
    setManualEdit(emptyManual());
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
        // Migrate best_performing_asset string → string[]
        if (typeof data.best_performing_asset === 'string') {
          data.best_performing_asset = data.best_performing_asset ? [data.best_performing_asset] : [];
        }
        setManual(data);
        setManualEdit(data);
        setShowTiktok(!!(data.social_media_data?.tiktok && Object.values(data.social_media_data.tiktok).some((v) => v != null)));
      })
      .catch(() => { setManual(emptyManual()); setShowTiktok(false); });

    seoApi.getShareTokens(selectedClient.id)
      .then((r) => setShareTokens(r.data || []))
      .catch(() => setShareTokens([]));

    seoApi.getSavedReports(selectedClient.id)
      .then((r) => setSavedReports(r.data || []))
      .catch(() => setSavedReports([]));
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
            <p className="page-subtitle">Google Analytics + Search Console — per clients</p>
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
                onClick={() => downloadPDF(report!, selectedClient?.name ?? 'Client', range, manual, demoCountry, selectedAcquisitions, selectedDemographics, agencyName, customStart, customEnd, compareStart, compareEnd)}
                title="Download PDF"
              >
                <Download size={13} /> Download PDF
              </button>
            )}
            {selectedClient && canEdit && (
              <div style={{ position: 'relative' }}>
                <button
                  className="seo-download-btn"
                  style={{ background: '#eff6ff', borderColor: '#93c5fd', color: '#1d4ed8' }}
                  onClick={() => { setShowSavedReports((v) => !v); setShowSharePanel(false); }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                  Saved {savedReports.length > 0 && `(${savedReports.length})`}
                </button>
                {showSavedReports && (
                  <div style={{ position: 'absolute', right: 0, top: '110%', zIndex: 50, background: '#fff', border: '1px solid var(--border)', borderRadius: 10, boxShadow: '0 4px 20px rgba(0,0,0,0.12)', padding: 14, minWidth: 340 }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', marginBottom: 10 }}>Saved Reports</p>
                    {savedReports.length === 0 && !showSaveForm && (
                      <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginBottom: 10 }}>No saved reports yet.</p>
                    )}
                    {savedReports.map((r: any) => {
                      const dateLabel = r.start_date && r.end_date ? `${r.start_date} → ${r.end_date}` : r.range || '28d';
                      const shareLink = r.share_token ? `${window.location.origin}/share/${r.share_token}` : null;
                      return (
                        <div key={r.id} style={{ marginBottom: 8, padding: '8px 10px', background: 'var(--bg-sand, #f9f9f6)', borderRadius: 7, border: '1px solid var(--border)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                            <button
                              title="Load this report's settings into the page"
                              style={{ fontSize: 11, padding: '2px 8px', borderRadius: 5, border: '1px solid #93c5fd', background: '#eff6ff', color: '#1d4ed8', cursor: 'pointer' }}
                              onClick={async () => {
                                setRange(r.range || '28d');
                                setCustomStart(r.start_date || '');
                                setCustomEnd(r.end_date || '');
                                setCompareStart(r.compare_start || '');
                                setCompareEnd(r.compare_end || '');
                                if (r.country) setDemoCountry(r.country);
                                if (r.agency_name) setAgencyName(r.agency_name);
                                if (r.manual_snapshot) {
                                  try {
                                    const snap = typeof r.manual_snapshot === 'string' ? JSON.parse(r.manual_snapshot) : r.manual_snapshot;
                                    setManual({ ...emptyManual(), ...snap });
                                    setManualEdit({ ...emptyManual(), ...snap });
                                  } catch {}
                                } else {
                                  // No snapshot yet — save current manual as this report's snapshot so it self-heals
                                  const updated = await seoApi.updateSavedReport(r.id, { name: r.name, range: r.range || '28d', start_date: r.start_date || undefined, end_date: r.end_date || undefined, compare_start: r.compare_start || undefined, compare_end: r.compare_end || undefined, country: r.country || undefined, manual_snapshot: manual, agency_name: agencyName || undefined });
                                  setSavedReports((prev) => prev.map((x: any) => x.id === r.id ? updated.data : x));
                                }
                                setShowSavedReports(false);
                              }}
                            >Load</button>
                            <button
                              style={{ fontSize: 11, padding: '2px 8px', borderRadius: 5, border: '1px solid #fecaca', background: '#fef2f2', color: '#dc2626', cursor: 'pointer' }}
                              onClick={async () => {
                                if (!confirm('Delete this saved report?')) return;
                                await seoApi.deleteSavedReport(r.id);
                                setSavedReports((prev) => prev.filter((x: any) => x.id !== r.id));
                              }}
                            >Delete</button>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 2 }}>{dateLabel} · saved by {r.created_by_name}</div>
                          <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                            <button
                              title="Save current page's manual content into this report"
                              style={{ fontSize: 11, padding: '3px 10px', borderRadius: 5, border: '1px solid #86efac', background: updatingSnapshotId === r.id ? '#f0fdf4' : '#f0fdf4', color: '#16a34a', cursor: updatingSnapshotId === r.id ? 'wait' : 'pointer', opacity: updatingSnapshotId === r.id ? 0.6 : 1 }}
                              disabled={updatingSnapshotId === r.id}
                              onClick={async () => {
                                setUpdatingSnapshotId(r.id);
                                try {
                                  const updated = await seoApi.updateSavedReport(r.id, { name: r.name, range: r.range || '28d', start_date: r.start_date || undefined, end_date: r.end_date || undefined, compare_start: r.compare_start || undefined, compare_end: r.compare_end || undefined, country: r.country || undefined, manual_snapshot: manual, agency_name: agencyName || undefined });
                                  setSavedReports((prev) => prev.map((x: any) => x.id === r.id ? updated.data : x));
                                } finally { setUpdatingSnapshotId(null); }
                              }}
                            >{updatingSnapshotId === r.id ? 'Saving…' : '✓ Update'}</button>
                            {shareLink && (
                              <button
                                style={{ fontSize: 11, padding: '3px 10px', borderRadius: 5, border: '1px solid var(--border)', background: savedCopied === r.id ? '#f0fdf4' : 'var(--surface, #fff)', color: savedCopied === r.id ? '#16a34a' : 'var(--ink)', cursor: 'pointer' }}
                                onClick={async () => { await navigator.clipboard.writeText(shareLink); setSavedCopied(r.id); setTimeout(() => setSavedCopied(null), 2000); }}
                              >{savedCopied === r.id ? '✓ Copied' : 'Copy Share Link'}</button>
                            )}
                            {shareLink && (
                              <button
                                style={{ fontSize: 11, padding: '3px 10px', borderRadius: 5, border: '1px solid #fde68a', background: '#fffbeb', color: '#92400e', cursor: 'pointer' }}
                                onClick={async () => {
                                  if (!confirm('Revoke this share link? A new one will be generated.')) return;
                                  const res = await seoApi.revokeAndRegenerateToken(r.id);
                                  setSavedReports((prev) => prev.map((x: any) => x.id === r.id ? { ...x, share_token: res.data.share_token } : x));
                                }}
                              >Revoke Link</button>
                            )}
                            <button
                              style={{ fontSize: 11, padding: '3px 10px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface, #fff)', color: 'var(--ink)', cursor: downloadingId === r.id ? 'wait' : 'pointer', opacity: downloadingId === r.id ? 0.6 : 1 }}
                              disabled={downloadingId === r.id}
                              onClick={async () => {
                                if (!selectedClient) return;
                                setDownloadingId(r.id);
                                const savedRange = r.range || '28d';
                                const isCustomSaved = savedRange === 'custom' && r.start_date && r.end_date;
                                try {
                                  const res = await seoApi.report(
                                    selectedClient.id,
                                    savedRange,
                                    isCustomSaved ? r.start_date : undefined,
                                    isCustomSaved ? r.end_date : undefined,
                                    r.country || undefined,
                                    r.compare_start || undefined,
                                    r.compare_end || undefined,
                                  );
                                  const rpt = res.data?.report ?? res.data;
                                  if (!rpt) throw new Error('No report data');
                                  let snapManual = manual;
                                  if (r.manual_snapshot) {
                                    try { snapManual = { ...emptyManual(), ...(typeof r.manual_snapshot === 'string' ? JSON.parse(r.manual_snapshot) : r.manual_snapshot) }; } catch {}
                                  }
                                  downloadPDF(rpt, selectedClient.name, savedRange, snapManual, r.country || demoCountry, selectedAcquisitions, selectedDemographics, r.agency_name || agencyName, r.start_date || '', r.end_date || '', r.compare_start || '', r.compare_end || '');
                                } catch (e: any) { alert('Failed to fetch report data: ' + (e?.response?.data?.error || e?.message || 'unknown error')); }
                                finally { setDownloadingId(null); }
                              }}
                            >{downloadingId === r.id ? 'Loading…' : '↓ Download PDF'}</button>
                          </div>
                        </div>
                      );
                    })}
                    {showSaveForm ? (
                      <div style={{ marginTop: 8 }}>
                        <input
                          autoFocus
                          placeholder="Report name…"
                          value={saveReportName}
                          onChange={(e) => setSaveReportName(e.target.value)}
                          style={{ width: '100%', padding: '6px 10px', fontSize: 13, borderRadius: 6, border: '1px solid var(--border)', outline: 'none', boxSizing: 'border-box', marginBottom: 8 }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') document.getElementById('seo-save-confirm')?.click();
                            if (e.key === 'Escape') setShowSaveForm(false);
                          }}
                        />
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            id="seo-save-confirm"
                            className="seo-inline-save"
                            style={{ flex: 1 }}
                            disabled={savingReport || !saveReportName.trim()}
                            onClick={async () => {
                              if (!saveReportName.trim()) return;
                              setSavingReport(true);
                              try {
                                const res = await seoApi.saveReport(selectedClient.id, {
                                  name: saveReportName.trim(),
                                  range,
                                  start_date: customStart || undefined,
                                  end_date: customEnd || undefined,
                                  compare_start: compareStart || undefined,
                                  compare_end: compareEnd || undefined,
                                  country: demoCountry || undefined,
                                  manual_snapshot: manual,
                                  agency_name: agencyName || undefined,
                                });
                                setSavedReports((prev) => [res.data, ...prev]);
                                setSaveReportName('');
                                setShowSaveForm(false);
                              } finally {
                                setSavingReport(false);
                              }
                            }}
                          >{savingReport ? 'Saving…' : 'Save'}</button>
                          <button
                            style={{ padding: '4px 12px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--ink-muted)' }}
                            onClick={() => { setShowSaveForm(false); setSaveReportName(''); }}
                          >Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <button
                        className="seo-inline-save"
                        style={{ width: '100%', marginTop: savedReports.length > 0 ? 8 : 0, background: '#eff6ff', borderColor: '#93c5fd', color: '#1d4ed8' }}
                        onClick={() => setShowSaveForm(true)}
                      >+ Save current report</button>
                    )}
                  </div>
                )}
              </div>
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
                      const label = t.start_date && t.end_date ? `${t.start_date} → ${t.end_date}` : t.range || 'All time';
                      const link = `${window.location.origin}/share/${t.token}`;
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
                              await seoApi.revokeShareToken(t.token);
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
                        const r = await seoApi.createShare(selectedClient.id, { range, startDate: customStart || undefined, endDate: customEnd || undefined, compareStart: compareStart || undefined, compareEnd: compareEnd || undefined, demographics: [...selectedDemographics], acquisitions: [...selectedAcquisitions], country: demoCountry, agency_name: agencyName || undefined });
                        const newToken = r.data.token;
                        setShareTokens((prev) => [{ token: newToken, range, start_date: customStart || null, end_date: customEnd || null }, ...prev]);
                        const link = `${window.location.origin}/share/${newToken}`;
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
                  sigChanges.push({ key, label, from: pre, to: cur, pct });
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
                  sigChanges.push({ key: `gmb_${i}_${key}`, label: `GBP ${prefix}${label}`, from: pre, to: cur, pct });
                };
                check('calls', 'calls', loc.calls, loc.prev_calls);
                check('website_clicks', 'website clicks', loc.website_clicks, loc.prev_website_clicks);
                check('reviews', 'reviews', loc.reviews, loc.prev_reviews);
                check('bookings', 'bookings', loc.bookings, loc.prev_bookings);
              });
              // Show section if there are computed changes OR already-saved whys
              const hasSavedWhys = manual.sig_change_whys && Object.values(manual.sig_change_whys).some((v: any) => (v as string)?.trim?.());
              if (sigChanges.length === 0 && !hasSavedWhys) return null;
              return (
                <div className="seo-section" style={{ border: '1.5px solid #fde68a', background: 'linear-gradient(135deg,#fffbeb 0%,#fff 100%)', borderRadius: 12, padding: '16px 20px' }}>
                  <h3 className="seo-section__title" style={{ color: '#92400e' }}>
                    Notable Changes This Period
                  </h3>
                  {sigChanges.map(sc => (
                    <div key={sc.key} style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                        {sc.label}: <span style={{ color: 'var(--ink-muted)', fontWeight: 400 }}>{sc.from.toLocaleString()} → {sc.to.toLocaleString()}</span>
                        <span style={{ marginLeft: 6, fontWeight: 700, color: sc.pct >= 0 ? '#16a34a' : '#dc2626' }}>({sc.pct >= 0 ? '+' : ''}{sc.pct}%)</span>
                      </div>
                      {canEdit && (
                        <input className="form-input" placeholder="Why?" style={{ width: '100%', fontSize: 12, marginTop: 6 }}
                          value={manual.sig_change_whys?.[sc.key] ?? ''}
                          onChange={(e) => {
                            const updated = { ...manual, sig_change_whys: { ...(manual.sig_change_whys ?? {}), [sc.key]: e.target.value } };
                            setManual(updated);
                            setManualEdit(updated);
                          }} />
                      )}
                      {!canEdit && manual.sig_change_whys?.[sc.key] && (
                        <p style={{ fontSize: 12, color: 'var(--ink-muted)', fontStyle: 'italic', marginTop: 4 }}>{manual.sig_change_whys[sc.key]}</p>
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
            {(canEdit || (Array.isArray(manual.best_performing_asset) && manual.best_performing_asset.length > 0) || manual.next_period_plan?.length > 0) && (
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
                    <div style={{ marginBottom: 12 }}>
                      <label className="seo-inline-label">Best performing asset / campaign this month</label>
                      {(Array.isArray(manualEdit.best_performing_asset) ? manualEdit.best_performing_asset : []).map((item, i) => (
                        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                          <input className="form-input seo-inline-input" style={{ flex: 1 }} placeholder="e.g. Blog: 'Eco Drain Pipes Guide'"
                            value={item}
                            onChange={(e) => {
                              const arr = [...(manualEdit.best_performing_asset as string[])];
                              arr[i] = e.target.value;
                              setManualEdit({ ...manualEdit, best_performing_asset: arr });
                            }} />
                          <button className="seo-manual-del" onClick={() => {
                            const arr = (manualEdit.best_performing_asset as string[]).filter((_, j) => j !== i);
                            setManualEdit({ ...manualEdit, best_performing_asset: arr });
                          }}><Trash2 size={13} /></button>
                        </div>
                      ))}
                      <button className="seo-manual-add" onClick={() => setManualEdit({ ...manualEdit, best_performing_asset: [...(manualEdit.best_performing_asset as string[]), ''] })}>
                        <Plus size={12} /> Add item
                      </button>
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
                    {Array.isArray(manual.best_performing_asset) && manual.best_performing_asset.length > 0 && (
                      <div style={{ background: 'var(--bg-sand)', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
                        <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Best performing asset / campaign this month</div>
                        {(manual.best_performing_asset as string[]).map((item, i) => (
                          <div key={i} style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.6 }}>• {item}</div>
                        ))}
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
                  Current Period Targets
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

            {/* ── Website Performance ── */}
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: '20px 0 10px', color: 'var(--ink)' }}>Website Performance</h3>
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
                      <span style={{ flex: 1 }}>Doc Link (optional)</span>
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
                        <input className="form-input seo-manual-input" placeholder="https://docs.google.com/..." value={row.doc_link ?? ''}
                          onChange={(e) => { const v = e.target.value; setManualEdit(prev => { const a = [...prev.organic_form_data]; a[i] = { ...a[i], doc_link: v || undefined }; return { ...prev, organic_form_data: a }; }); }} />
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
                      <thead><tr><th>Date</th><th>Source</th><th>Contact</th><th>Doc</th></tr></thead>
                      <tbody>
                        {manual.organic_form_data.map((row, i) => {
                          const hasFields = row.date || row.source || row.contact;
                          return hasFields ? (
                            <tr key={i}>
                              <td>{row.date || '—'}</td>
                              <td>{row.source || '—'}</td>
                              <td>{row.contact || '—'}</td>
                              <td>{row.doc_link ? <a href={row.doc_link} target="_blank" rel="noreferrer" style={{ color: '#6366f1', textDecoration: 'underline', fontSize: 12 }}>View Doc</a> : '—'}</td>
                            </tr>
                          ) : row.doc_link ? (
                            <tr key={i}>
                              <td colSpan={4}><a href={row.doc_link} target="_blank" rel="noreferrer" style={{ color: '#6366f1', textDecoration: 'underline', fontSize: 12 }}>View Doc</a></td>
                            </tr>
                          ) : null;
                        })}
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
                          <div className="seo-inline-field"><label className="seo-inline-label">Post title</label><input className="form-input seo-inline-input" placeholder="e.g. MEP layout planning checklist for contractors" value={moEdit.instagram?.top_post_description ?? ''} onChange={(e) => setInstaOrg('top_post_description', e.target.value || null)} /></div>
                          <div className="seo-inline-field"><label className="seo-inline-label">Impressions</label><input className="form-input seo-inline-input" placeholder="e.g. 410" value={moEdit.instagram?.top_post_impressions ?? ''} onChange={(e) => setInstaOrg('top_post_impressions', e.target.value || null)} /></div>
                        </div>
                        <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, marginTop: 12 }}>Plan for this channel next period</h4>
                        <div className="seo-manual-grid" style={{ marginBottom: 10 }}>
                          <div className="seo-inline-field"><label className="seo-inline-label">Action</label><input className="form-input seo-inline-input" placeholder="e.g. Publish 1 technical article, engage in 3 industry group discussions" value={moEdit.instagram?.channel_plan_action ?? ''} onChange={(e) => setInstaOrg('channel_plan_action', e.target.value || null)} /></div>
                          <div className="seo-inline-field"><label className="seo-inline-label">Impressions target</label><input className="form-input seo-inline-input" placeholder="e.g. 1100" value={moEdit.instagram?.channel_plan_impressions_target ?? ''} onChange={(e) => setInstaOrg('channel_plan_impressions_target', e.target.value || null)} /></div>
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
                          <div className="seo-inline-field"><label className="seo-inline-label">Post title</label><input className="form-input seo-inline-input" placeholder="e.g. MEP layout planning checklist for contractors" value={moEdit.facebook?.top_post_description ?? ''} onChange={(e) => setFbOrg('top_post_description', e.target.value || null)} /></div>
                          <div className="seo-inline-field"><label className="seo-inline-label">Impressions</label><input className="form-input seo-inline-input" placeholder="e.g. 410" value={moEdit.facebook?.top_post_impressions ?? ''} onChange={(e) => setFbOrg('top_post_impressions', e.target.value || null)} /></div>
                        </div>
                        <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, marginTop: 12 }}>Plan for this channel next period</h4>
                        <div className="seo-manual-grid" style={{ marginBottom: 10 }}>
                          <div className="seo-inline-field"><label className="seo-inline-label">Action</label><input className="form-input seo-inline-input" placeholder="e.g. Publish 1 technical article, engage in 3 industry group discussions" value={moEdit.facebook?.channel_plan_action ?? ''} onChange={(e) => setFbOrg('channel_plan_action', e.target.value || null)} /></div>
                          <div className="seo-inline-field"><label className="seo-inline-label">Impressions target</label><input className="form-input seo-inline-input" placeholder="e.g. 1100" value={moEdit.facebook?.channel_plan_impressions_target ?? ''} onChange={(e) => setFbOrg('channel_plan_impressions_target', e.target.value || null)} /></div>
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
                          <div className="seo-inline-field"><label className="seo-inline-label">Impressions</label><input className="form-input seo-inline-input" placeholder="e.g. 3,200" value={loEdit.views ?? ''} onChange={(e) => setLiOrg('views', e.target.value || null)} /></div>
                          <div className="seo-inline-field"><label className="seo-inline-label">Clicks</label><input className="form-input seo-inline-input" placeholder="e.g. 420" value={loEdit.clicks ?? ''} onChange={(e) => setLiOrg('clicks', e.target.value || null)} /></div>
                          <div className="seo-inline-field"><label className="seo-inline-label">reactions</label><input className="form-input seo-inline-input" placeholder="e.g. 960" value={loEdit.reach ?? ''} onChange={(e) => setLiOrg('reach', e.target.value || null)} /></div>
                          <div className="seo-inline-field"><label className="seo-inline-label">Total Followers</label><input className="form-input seo-inline-input" placeholder="e.g. 1,250" value={loEdit.content_interactions ?? ''} onChange={(e) => setLiOrg('content_interactions', e.target.value || null)} /></div>
                          <div className="seo-inline-field"><label className="seo-inline-label">New Followers</label><input className="form-input seo-inline-input" placeholder="e.g. 18" value={loEdit.link_clicks ?? ''} onChange={(e) => setLiOrg('link_clicks', e.target.value || null)} /></div>
                        </div>
                        <div className="seo-inline-field" style={{ marginBottom: 16 }}>
                          <label className="seo-inline-label">Key Insights</label>
                          <textarea className="form-input seo-inline-input" rows={2} style={{ width: '100%' }} placeholder="Key insights…" value={loEdit.key_insights ?? ''} onChange={(e) => setLiOrg('key_insights', e.target.value || null)} />
                        </div>
                        <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, marginTop: 12 }}>Top performing post this period</h4>
                        <div className="seo-manual-grid" style={{ marginBottom: 10 }}>
                          <div className="seo-inline-field"><label className="seo-inline-label">Post title</label><input className="form-input seo-inline-input" placeholder="e.g. MEP layout planning checklist for contractors" value={loEdit.top_post_description ?? ''} onChange={(e) => setLiOrg('top_post_description', e.target.value || null)} /></div>
                          <div className="seo-inline-field"><label className="seo-inline-label">Impressions</label><input className="form-input seo-inline-input" placeholder="e.g. 410" value={loEdit.top_post_impressions ?? ''} onChange={(e) => setLiOrg('top_post_impressions', e.target.value || null)} /></div>
                        </div>
                        <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, marginTop: 12 }}>Plan for this channel next period</h4>
                        <div className="seo-manual-grid" style={{ marginBottom: 10 }}>
                          <div className="seo-inline-field"><label className="seo-inline-label">Action</label><input className="form-input seo-inline-input" placeholder="e.g. Publish 1 technical article, engage in 3 industry group discussions" value={loEdit.channel_plan_action ?? ''} onChange={(e) => setLiOrg('channel_plan_action', e.target.value || null)} /></div>
                          <div className="seo-inline-field"><label className="seo-inline-label">Impressions target</label><input className="form-input seo-inline-input" placeholder="e.g. 1100" value={loEdit.channel_plan_impressions_target ?? ''} onChange={(e) => setLiOrg('channel_plan_impressions_target', e.target.value || null)} /></div>
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
                          <p className="seo-card__label">Impressions</p>
                        </div>
                        <div className="seo-li-stat">
                          <p className="seo-card__val">{parsed.clicksVal}</p>
                          <p className="seo-card__label">Clicks</p>
                        </div>
                        <div className="seo-li-stat">
                          <p className="seo-card__val">{parsed.reachVal}</p>
                          <p className="seo-card__label">reactions</p>
                        </div>
                        <div className="seo-li-stat">
                          <p className="seo-card__val">{parsed.interactionsVal}</p>
                          <p className="seo-card__label">Total Followers</p>
                        </div>
                        <div className="seo-li-stat">
                          <p className="seo-card__val">{parsed.linkClicksVal}</p>
                          <p className="seo-card__label">New Followers</p>
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
                {([['google', 'Google'], ['linkedin', 'LinkedIn'], ['meta', 'Meta']] as const).map(([key, label]) => (
                  <button key={key} type="button" onClick={() => setPaidTab(key)}
                    style={{
                      padding: '8px 16px', fontSize: 13, fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer',
                      borderBottom: paidTab === key ? '2px solid #059669' : '2px solid transparent',
                      color: paidTab === key ? '#059669' : 'var(--ink-muted)',
                      marginBottom: -1,
                    }}>{label}
                  </button>
                ))}
                {canEdit && (
                  <button type="button" className="seo-manual-edit-btn" style={{ marginLeft: 'auto', marginRight: 4 }}
                    onClick={() => openManualPanel(manualPanel === 'performance_marketing' ? null : 'performance_marketing')}>
                    {manualPanel === 'performance_marketing' ? <><X size={11} /> Cancel</> : <><Edit2 size={11} /> Edit</>}
                  </button>
                )}
              </div>

              {/* Edit Mode */}
              {manualPanel === 'performance_marketing' && canEdit && (() => {
                const gKey = paidTab;
                const grpEdit = manualEdit.performance_marketing?.[gKey] ?? emptyPmGroup();
                const updCamp = (i: number, patch: Partial<PmCampaign>) =>
                  setManualEdit(prev => {
                    const arr = [...(prev.performance_marketing?.[gKey]?.campaigns ?? [])];
                    arr[i] = { ...arr[i], ...patch };
                    return { ...prev, performance_marketing: { ...prev.performance_marketing, [gKey]: { ...grpEdit, campaigns: arr } } };
                  });
                const addCamp = () =>
                  setManualEdit(prev => ({ ...prev, performance_marketing: { ...prev.performance_marketing, [gKey]: { ...grpEdit, campaigns: [...grpEdit.campaigns, emptyPmCampaign()] } } }));
                const delCamp = (i: number) =>
                  setManualEdit(prev => { const arr = [...grpEdit.campaigns]; arr.splice(i, 1); return { ...prev, performance_marketing: { ...prev.performance_marketing, [gKey]: { ...grpEdit, campaigns: arr } } }; });
                const updInsights = (val: string) =>
                  setManualEdit(prev => ({ ...prev, performance_marketing: { ...prev.performance_marketing, [gKey]: { ...grpEdit, key_insights: val } } }));

                return (
                  <div className="seo-manual-panel">
                    <div style={{ display: 'flex', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', marginBottom: 6, padding: '0 2px' }}>
                      <span style={{ flex: 2 }}>Campaign Name</span>
                      <span style={{ width: 82 }}>Reach</span>
                      <span style={{ width: 90 }}>Impressions</span>
                      <span style={{ width: 70 }}>Clicks</span>
                      <span style={{ width: 65 }}>Leads</span>
                      <span style={{ width: 80 }}>Cost/Lead (₹)</span>
                      <span style={{ width: 100 }}>Amount Spent (₹)</span>
                      <span style={{ width: 26 }} />
                    </div>
                    {grpEdit.campaigns.map((c, i) => (
                      <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                        <input className="form-input seo-inline-input" placeholder="Campaign name" value={c.name} onChange={(e) => updCamp(i, { name: e.target.value })} style={{ flex: 2 }} />
                        <input className="form-input seo-inline-input" placeholder="0" type="number" value={c.reach} onChange={(e) => updCamp(i, { reach: e.target.value })} style={{ width: 82 }} />
                        <input className="form-input seo-inline-input" placeholder="0" type="number" value={c.impressions} onChange={(e) => updCamp(i, { impressions: e.target.value })} style={{ width: 90 }} />
                        <input className="form-input seo-inline-input" placeholder="0" type="number" value={c.clicks} onChange={(e) => updCamp(i, { clicks: e.target.value })} style={{ width: 70 }} />
                        <input className="form-input seo-inline-input" placeholder="0" type="number" value={c.leads} onChange={(e) => updCamp(i, { leads: e.target.value })} style={{ width: 65 }} />
                        <input className="form-input seo-inline-input" placeholder="0.00" type="number" value={c.cost_per_lead} onChange={(e) => updCamp(i, { cost_per_lead: e.target.value })} style={{ width: 80 }} />
                        <input className="form-input seo-inline-input" placeholder="0.00" type="number" value={c.cost} onChange={(e) => updCamp(i, { cost: e.target.value })} style={{ width: 100 }} />
                        <button className="seo-manual-del" onClick={() => delCamp(i)}><Trash2 size={13} /></button>
                      </div>
                    ))}
                    <div className="seo-manual-actions" style={{ justifyContent: 'flex-start', marginBottom: 14 }}>
                      <button className="seo-manual-add" onClick={addCamp}><Plus size={12} /> Add campaign</button>
                    </div>
                    <div className="seo-inline-field" style={{ marginBottom: 16 }}>
                      <label className="seo-inline-label">Key Insights</label>
                      <textarea className="form-input seo-inline-input" rows={3} style={{ width: '100%' }} placeholder="Key insights for this channel…" value={grpEdit.key_insights} onChange={(e) => updInsights(e.target.value)} />
                    </div>
                    <div className="seo-manual-actions">
                      <button className="seo-inline-save" onClick={saveManual} disabled={manualSaving}>{manualSaving ? 'Saving…' : 'Save'}</button>
                    </div>
                  </div>
                );
              })()}

              {/* Display Mode */}
              {(() => {
                const grp = manual.performance_marketing?.[paidTab] ?? emptyPmGroup();
                const tot = calcPmTotals(grp);
                const avgCpl = calcPmAvgCpl(grp);
                const cplColor = (v: number | null) => avgCpl === null || v === null ? 'var(--ink-muted)' : v < avgCpl ? '#16a34a' : v > avgCpl ? '#d97706' : 'var(--ink)';
                if (grp.campaigns.length === 0) return <p style={{ fontSize: 13, color: 'var(--ink-muted)', padding: '8px 0' }}>No campaigns yet.</p>;
                return (
                  <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'var(--surface)' }}>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                          <tr style={{ background: 'var(--surface-2)' }}>
                            {['Campaign', 'Reach', 'Impressions', 'Clicks', 'Leads', 'Cost/Lead (₹)', 'Amount Spent (₹)'].map((h) => (
                              <th key={h} style={{ padding: '8px 12px', fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textAlign: h === 'Campaign' ? 'left' : 'right', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {grp.campaigns.map((c, i) => {
                            const cpl = Number(c.cost_per_lead) || null;
                            return (
                              <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                                <td style={{ padding: '8px 12px', fontWeight: 600 }}>{c.name || '—'}</td>
                                <td style={{ padding: '8px 12px', textAlign: 'right' }}>{c.reach || '—'}</td>
                                <td style={{ padding: '8px 12px', textAlign: 'right' }}>{c.impressions || '—'}</td>
                                <td style={{ padding: '8px 12px', textAlign: 'right' }}>{c.clicks || '—'}</td>
                                <td style={{ padding: '8px 12px', textAlign: 'right' }}>{c.leads || '—'}</td>
                                <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: cplColor(cpl) }}>{c.cost_per_lead || '—'}</td>
                                <td style={{ padding: '8px 12px', textAlign: 'right' }}>{c.cost || '—'}</td>
                              </tr>
                            );
                          })}
                          <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--surface-2)', fontWeight: 700 }}>
                            <td style={{ padding: '8px 12px' }}>Total</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right' }}>{tot.reach.toLocaleString()}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right' }}>{tot.impressions.toLocaleString()}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right' }}>{tot.clicks.toLocaleString()}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right' }}>{tot.leads.toLocaleString()}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right' }}>{avgCpl !== null ? avgCpl.toFixed(2) : '—'}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right' }}>{tot.cost.toLocaleString()}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    {grp.key_insights && (
                      <div style={{ padding: '10px 16px', borderTop: '1px dashed var(--border)' }}>
                        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Key Insights</p>
                        <div className="seo-insights-display" dangerouslySetInnerHTML={{ __html: grp.key_insights }} />
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* ── Flags / Risks ── */}
            <div className="seo-section">
              <div className="seo-section-header" style={{ cursor: 'default', marginBottom : '10px' }}>
                <div>
                  <h2 className="seo-section-title">Flags / Risks</h2>
                  <p style={{ fontSize: 12, color: 'var(--ink-muted)', margin: 0 }}>Leave blank if nothing's wrong — this only shows on the report if filled in.</p>
                </div>
              </div>
              {canEdit && (
                <div style={{ padding: '0 16px 16px' }}>
                  <textarea
                    className="form-input"
                    rows={3}
                    style={{ width: '100%', fontSize: 13 }}
                    placeholder="Flags or risks…"
                    value={manualEdit.flags_risks ?? ''}
                    onChange={(e) => setManualEdit((prev) => ({ ...prev, flags_risks: e.target.value }))}
                  />
                  <div className="seo-manual-actions">
                    <button className="seo-inline-save" onClick={saveManual} disabled={manualSaving}>{manualSaving ? 'Saving…' : 'Save'}</button>
                  </div>
                </div>
              )}
              {manual.flags_risks && (
                <div style={{ margin: '0 16px 16px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px' }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', marginBottom: 4 }}>Flags / Risks</p>
                  <p style={{ fontSize: 13, color: '#7f1d1d', lineHeight: 1.6, margin: 0 }}>{manual.flags_risks}</p>
                </div>
              )}
            </div>

          </>
        )}
      </div>
    </Layout>
  );
}
