import { Router, Request, Response } from 'express';
import { GoogleAuth } from 'google-auth-library';
import { getDB } from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';
import { visibleCompanyIds } from '../utils/companyAccess';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';

const router = Router();
router.use(authenticate);

function getGoogleAuth() {
  // Support both a file path and an inline JSON string
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH;
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  let credentials: object | null = null;

  if (keyPath) {
    const resolved = path.resolve(__dirname, '../../', keyPath);
    try { credentials = JSON.parse(fs.readFileSync(resolved, 'utf8')); } catch { return null; }
  } else if (keyJson) {
    try { credentials = JSON.parse(keyJson); } catch { return null; }
  }

  if (!credentials) return null;

  return new GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/analytics.readonly',
      'https://www.googleapis.com/auth/webmasters.readonly',
    ],
  });
}

async function getAccessToken(): Promise<{ token: string | null; error?: string }> {
  const auth = getGoogleAuth();
  if (!auth) return { token: null, error: 'Google service account not configured. Add GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_PATH to .env' };
  try {
    const client = await auth.getClient();
    const t = await (client as any).getAccessToken();
    return { token: t.token ?? null };
  } catch (e: any) {
    return { token: null, error: `Google auth failed: ${e.message}` };
  }
}

// Range helper → GA4 date string
function ga4StartDate(range: string): string {
  const map: Record<string, string> = { '7d': '7daysAgo', '28d': '28daysAgo', '90d': '90daysAgo' };
  return map[range] ?? '28daysAgo';
}

// GET /api/seo/clients — companies visible to the logged-in user
router.get('/clients', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const { role, id: userId } = req.user!;

    if (role === 'client') {
      const user = await db('users').where({ id: userId }).select('client_company_id').first();
      if (!user?.client_company_id) { res.json([]); return; }
      res.json(await db('client_companies').where({ id: user.client_company_id }).select('id', 'name', 'ga_property_id', 'gsc_site_url'));
      return;
    }

    const ids = await visibleCompanyIds(db, role, userId);
    const q = db('client_companies').select('id', 'name', 'ga_property_id', 'gsc_site_url').orderBy('name');
    if (ids !== null) { if (!ids.length) { res.json([]); return; } q.whereIn('id', ids); }
    res.json(await q);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/seo/clients/:id — admin/manager/employee can set GA property and GSC URL
router.put('/clients/:id', async (req: AuthRequest, res: Response) => {
  const { role, id: userId } = req.user!;
  if (!['admin', 'manager', 'employee'].includes(role)) {
    res.status(403).json({ error: 'Access denied' }); return;
  }
  if (role !== 'admin') {
    const db = getDB();
    const ids = await visibleCompanyIds(db, role, userId);
    if (ids !== null && !ids.map(String).includes(String(req.params.id))) {
      res.status(403).json({ error: 'Access denied' }); return;
    }
  }
  const { ga_property_id, gsc_site_url } = req.body;
  try {
    const db = getDB();
    await db('client_companies').where({ id: req.params.id }).update({ ga_property_id: ga_property_id || null, gsc_site_url: gsc_site_url || null });
    res.json({ message: 'Updated' });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/seo/report/:clientId?range=28d — full analytics report
router.get('/report/:clientId', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const { role, id: userId } = req.user!;

    if (role === 'client') {
      const user = await db('users').where({ id: userId }).select('client_company_id').first();
      if (String(user?.client_company_id) !== String(req.params.clientId)) {
        res.status(403).json({ error: 'Access denied' }); return;
      }
    } else if (role !== 'admin') {
      const ids = await visibleCompanyIds(db, role, userId);
      if (ids !== null && !ids.map(String).includes(String(req.params.clientId))) {
        res.status(403).json({ error: 'Access denied' }); return;
      }
    }

    const client = await db('client_companies').where({ id: req.params.clientId }).first();
    if (!client) { res.status(404).json({ error: 'Client not found' }); return; }
    if (!client.ga_property_id) { res.status(400).json({ error: 'GA4 Property ID not configured for this client' }); return; }

    const { token, error: authError } = await getAccessToken();
    if (!token) { res.status(500).json({ error: authError ?? 'Google auth failed' }); return; }

    const range        = String(req.query.range || '28d');
    const customStart  = req.query.startDate    ? String(req.query.startDate)    : null;
    const customEnd    = req.query.endDate      ? String(req.query.endDate)      : null;
    const compareStart = req.query.compareStart ? String(req.query.compareStart) : null;
    const compareEnd   = req.query.compareEnd   ? String(req.query.compareEnd)   : null;
    const isCustom     = range === 'custom' && customStart && customEnd;
    const ga4Start     = isCustom ? customStart : ga4StartDate(range);
    const ga4End       = isCustom ? customEnd   : 'today';
    const gscStart     = isCustom ? customStart : formatDate(range === '7d' ? 7 : range === '28d' ? 28 : 90);
    const gscEnd       = isCustom ? customEnd   : formatDate(0);
    const propertyId   = client.ga_property_id;
    const siteUrl      = client.gsc_site_url;

    const ga4Base = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    // Compute previous period (manual override wins over auto)
    const daysBack = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
    let prevStartStr: string, prevEndStr: string;
    if (compareStart && compareEnd) {
      prevStartStr = compareStart;
      prevEndStr   = compareEnd;
    } else {
      const resolvedStartStr = isCustom ? ga4Start! : daysBack(range === '7d' ? 7 : range === '28d' ? 28 : 90);
      const resolvedEndStr   = isCustom ? ga4End!   : daysBack(0);
      const diffDays = Math.round((new Date(resolvedEndStr).getTime() - new Date(resolvedStartStr).getTime()) / 86400000) + 1;
      const prevEndDate   = new Date(resolvedStartStr); prevEndDate.setDate(prevEndDate.getDate() - 1);
      const prevStartDate = new Date(prevEndDate);      prevStartDate.setDate(prevStartDate.getDate() - diffDays + 1);
      prevStartStr = prevStartDate.toISOString().slice(0, 10);
      prevEndStr   = prevEndDate.toISOString().slice(0, 10);
    }

    // Run all GA4 requests in parallel
    const engagementMetrics = [
      { name: 'averageSessionDuration' }, { name: 'bounceRate' },
      { name: 'screenPageViewsPerSession' }, { name: 'engagementRate' },
      { name: 'sessions' }, { name: 'activeUsers' }, { name: 'newUsers' },
    ];

    const [trafficRes, acquisitionRes, engagementRes, demoRes, gscRes, gscQueriesRes, prevEngagementRes, prevAcquisitionRes] = await Promise.allSettled([

      // 1. Traffic overview: daily active users + sessions + pageviews
      fetch(ga4Base, {
        method: 'POST', headers,
        body: JSON.stringify({
          dateRanges: [{ startDate: ga4Start, endDate: ga4End }],
          dimensions: [{ name: 'date' }],
          metrics: [
            { name: 'activeUsers' }, { name: 'sessions' },
            { name: 'screenPageViews' }, { name: 'newUsers' },
          ],
          orderBys: [{ dimension: { dimensionName: 'date' } }],
        }),
      }).then((r) => r.json()),

      // 2. Acquisition: by channel group (Direct, Organic Search, Referral, etc.)
      fetch(ga4Base, {
        method: 'POST', headers,
        body: JSON.stringify({
          dateRanges: [{ startDate: ga4Start, endDate: ga4End }],
          dimensions: [{ name: 'sessionDefaultChannelGrouping' }],
          metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
          orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
          limit: 10,
        }),
      }).then((r) => r.json()),

      // 3. Engagement metrics (totals)
      fetch(ga4Base, {
        method: 'POST', headers,
        body: JSON.stringify({ dateRanges: [{ startDate: ga4Start, endDate: ga4End }], metrics: engagementMetrics }),
      }).then((r) => r.json()),

      // 4. Demographics — cities filtered by selected country (or all countries)
      (() => {
        const demoCountry = req.query.country ? String(req.query.country) : 'India';
        const countryFilter = demoCountry !== 'all'
          ? { filter: { fieldName: 'country', stringFilter: { value: demoCountry, matchType: 'EXACT' } } }
          : null;
        const notSetFilter = { notExpression: { filter: { fieldName: 'city', stringFilter: { value: '(not set)', matchType: 'EXACT' } } } };
        const expressions = countryFilter ? [countryFilter, notSetFilter] : [notSetFilter];
        return fetch(ga4Base, {
          method: 'POST', headers,
          body: JSON.stringify({
            dateRanges: [{ startDate: ga4Start, endDate: ga4End }],
            dimensions: [{ name: 'city' }, { name: 'country' }],
            metrics: [{ name: 'activeUsers' }, { name: 'sessions' }],
            orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
            limit: 20,
            dimensionFilter: { andGroup: { expressions } },
          }),
        }).then((r) => r.json());
      })(),

      // 5. GSC pages — auto-detects sc-domain: vs URL prefix format
      siteUrl
        ? queryGSC(siteUrl, headers, gscStart, gscEnd, 'page')
        : Promise.resolve(null),

      // 6. GSC top queries
      siteUrl
        ? queryGSC(siteUrl, headers, gscStart, gscEnd, 'query')
        : Promise.resolve(null),

      // 7. Previous period engagement (for comparison)
      fetch(ga4Base, {
        method: 'POST', headers,
        body: JSON.stringify({ dateRanges: [{ startDate: prevStartStr, endDate: prevEndStr }], metrics: engagementMetrics }),
      }).then((r) => r.json()),

      // 8. Previous period acquisition (for comparison)
      fetch(ga4Base, {
        method: 'POST', headers,
        body: JSON.stringify({
          dateRanges: [{ startDate: prevStartStr, endDate: prevEndStr }],
          dimensions: [{ name: 'sessionDefaultChannelGrouping' }],
          metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
          orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
          limit: 10,
        }),
      }).then((r) => r.json()),
    ]);

    // Parse GA4 traffic rows
    const traffic = trafficRes.status === 'fulfilled'
      ? (trafficRes.value.rows || []).map((r: any) => ({
          date: r.dimensionValues[0].value,
          users: Number(r.metricValues[0].value),
          sessions: Number(r.metricValues[1].value),
          pageviews: Number(r.metricValues[2].value),
          newUsers: Number(r.metricValues[3].value),
        }))
      : [];

    // Parse acquisition — channel grouping (Direct, Organic Search, Referral…)
    const acquisition = acquisitionRes.status === 'fulfilled'
      ? (acquisitionRes.value.rows || []).map((r: any) => ({
          channel: r.dimensionValues[0].value,
          sessions: Number(r.metricValues[0].value),
          users: Number(r.metricValues[1].value),
        }))
      : [];

    // Parse engagement totals
    let engagement = { avgDuration: 0, bounceRate: 0, pagesPerSession: 0, engagementRate: 0, sessions: 0, users: 0, newUsers: 0 };
    if (engagementRes.status === 'fulfilled' && engagementRes.value.rows?.[0]) {
      const mv = engagementRes.value.rows[0].metricValues;
      engagement = {
        avgDuration: Math.round(Number(mv[0].value)),
        bounceRate: Number((Number(mv[1].value) * 100).toFixed(1)),
        pagesPerSession: Number(Number(mv[2].value).toFixed(2)),
        engagementRate: Number((Number(mv[3].value) * 100).toFixed(1)),
        sessions: Number(mv[4].value),
        users: Number(mv[5].value),
        newUsers: Number(mv[6].value),
      };
    }

    // Parse demographics
    const demographics = demoRes.status === 'fulfilled'
      ? (demoRes.value.rows || []).map((r: any) => ({
          city: r.dimensionValues[0].value,
          country: r.dimensionValues[1].value,
          users: Number(r.metricValues[0].value),
          sessions: Number(r.metricValues[1].value),
        }))
      : [];

    // Parse GSC pages
    const pages = gscRes.status === 'fulfilled' && gscRes.value && gscRes.value.rows
      ? (gscRes.value.rows || []).map((r: any) => ({
          page: r.keys[0],
          clicks: r.clicks,
          impressions: r.impressions,
          ctr: Number((r.ctr * 100).toFixed(1)),
          position: Number(r.position.toFixed(1)),
        }))
      : [];

    // Parse GSC queries
    const queries = gscQueriesRes.status === 'fulfilled' && gscQueriesRes.value && gscQueriesRes.value.rows
      ? (gscQueriesRes.value.rows || []).map((r: any) => ({
          query: r.keys[0],
          clicks: r.clicks,
          impressions: r.impressions,
          ctr: Number((r.ctr * 100).toFixed(1)),
          position: Number(r.position.toFixed(1)),
        }))
      : [];

    const parseEngagement = (res: PromiseSettledResult<any>) => {
      if (res.status !== 'fulfilled' || !res.value.rows?.[0]) return null;
      const mv = res.value.rows[0].metricValues;
      return {
        avgDuration: Math.round(Number(mv[0].value)),
        bounceRate: Number((Number(mv[1].value) * 100).toFixed(1)),
        pagesPerSession: Number(Number(mv[2].value).toFixed(2)),
        engagementRate: Number((Number(mv[3].value) * 100).toFixed(1)),
        sessions: Number(mv[4].value),
        users: Number(mv[5].value),
        newUsers: Number(mv[6].value),
      };
    };
    const prevEngagement = parseEngagement(prevEngagementRes);
    const prevAcquisition = prevAcquisitionRes.status === 'fulfilled'
      ? (prevAcquisitionRes.value.rows || []).map((r: any) => ({
          channel: r.dimensionValues[0].value,
          sessions: Number(r.metricValues[0].value),
          users: Number(r.metricValues[1].value),
        }))
      : [];

    res.json({ traffic, acquisition, engagement, prevEngagement, prevAcquisition, demographics, pages, queries, client: { id: client.id, name: client.name } });
  } catch (err) {
    console.error('SEO report error:', err);
    res.status(500).json({ error: 'Failed to fetch analytics data' });
  }
});

function formatDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

// Extracts bare domain from any input: "pebpro.in", "https://pebpro.in/", "sc-domain:pebpro.in"
function extractDomain(raw: string): string {
  return raw
    .replace(/^sc-domain:/i, '')
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/.*$/, '')
    .trim();
}

// Tries sc-domain: first (domain property), falls back to URL prefix property
async function queryGSC(rawSiteUrl: string, headers: Record<string, string>, startDate: string, endDate: string, dimension: 'page' | 'query' = 'page') {
  const domain = extractDomain(rawSiteUrl);
  const candidates = [
    `sc-domain:${domain}`,
    `https://${domain}/`,
    `https://www.${domain}/`,
    `http://${domain}/`,
  ];

  for (const siteUrl of candidates) {
    try {
      const res = await fetch(
        `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
        {
          method: 'POST', headers,
          body: JSON.stringify({
            startDate, endDate,
            dimensions: [dimension],
            rowLimit: dimension === 'query' ? 40 : 20,
            orderBy: [{ fieldName: 'clicks', sortOrder: 'DESCENDING' }],
          }),
        }
      );
      const data = await res.json() as any;
      if (!data.error && data.rows?.length) return data;
    } catch { /* try next */ }
  }
  return null;
}

// GET /api/seo/manual/:clientId — fetch stored manual data
router.get('/manual/:clientId', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const row = await db('seo_manual_data').where({ client_id: req.params.clientId }).first();
    if (!row) { res.json({}); return; }
    res.json({
      keyword_rankings:  row.keyword_rankings  ? JSON.parse(row.keyword_rankings)  : [],
      targets:           row.targets           ? JSON.parse(row.targets)           : [],
      key_insights:      row.key_achievements || '',
      organic_submissions: row.organic_submissions ?? 0,
      gmb_rating:        row.gmb_rating,
      gmb_reviews:       row.gmb_reviews,
      gmb_profile_url:   row.gmb_profile_url,
      linkedin_url:        row.linkedin_url,
      linkedin_followers:  row.linkedin_followers,
      linkedin_data:       row.linkedin_data       ? JSON.parse(row.linkedin_data)       : null,
      social_media_data:   row.social_media_data   ? JSON.parse(row.social_media_data)   : null,
      gmb_overview:        row.gmb_overview        || '',
      gmb_calls:           row.gmb_calls           ?? null,
      gmb_bookings:        row.gmb_bookings        ?? null,
      gmb_website_clicks:  row.gmb_website_clicks  ?? null,
      organic_form_data:   row.organic_form_data   ? JSON.parse(row.organic_form_data)   : [],
      gmb_locations:       row.gmb_locations       ? JSON.parse(row.gmb_locations)       : [],
      executive_summary:   row.executive_summary   || '',
      sig_change_whys:     row.sig_change_whys     ? JSON.parse(row.sig_change_whys)     : {},
      last_period_plan:    row.last_period_plan    ? JSON.parse(row.last_period_plan)    : [],
      best_performing_asset: (() => { try { const v = JSON.parse(row.best_performing_asset || '[]'); return Array.isArray(v) ? v : [row.best_performing_asset]; } catch { return row.best_performing_asset ? [row.best_performing_asset] : []; } })(),
      next_period_plan:    row.next_period_plan    ? JSON.parse(row.next_period_plan)    : [],
      period_targets:      row.period_targets      ? JSON.parse(row.period_targets)      : { sessions: '', leads: '', engagement_rate: '', instagram_reach: '', facebook_reach: '' },
      meta_organic:        row.meta_organic        ? JSON.parse(row.meta_organic)        : null,
      linkedin_organic:    row.linkedin_organic    ? JSON.parse(row.linkedin_organic)    : null,
      performance_marketing: row.performance_marketing ? JSON.parse(row.performance_marketing) : null,
      health_score:        row.health_score        ?? 76,
      health_label:        row.health_label        || 'Weighted for a balanced goal, vs target',
      flags_risks:         row.flags_risks         || '',
    });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// PUT /api/seo/manual/:clientId — save manual data (admin/manager/employee)
router.put('/manual/:clientId', async (req: AuthRequest, res: Response) => {
  const { role, id: userId } = req.user!;
  if (!['admin', 'manager', 'employee'].includes(role)) {
    res.status(403).json({ error: 'Insufficient permissions' }); return;
  }
  try {
    const db = getDB();
    if (role !== 'admin') {
      const ids = await visibleCompanyIds(db, role, userId);
      if (ids !== null && !ids.map(String).includes(String(req.params.clientId))) {
        res.status(403).json({ error: 'Access denied' }); return;
      }
    }
    const { keyword_rankings, targets, key_insights, linkedin_data, social_media_data, organic_form_data, gmb_rating, gmb_reviews, gmb_profile_url, gmb_overview, gmb_calls, gmb_bookings, gmb_website_clicks, linkedin_url, linkedin_followers, gmb_locations, executive_summary, sig_change_whys, last_period_plan, best_performing_asset, next_period_plan, period_targets, meta_organic, linkedin_organic, performance_marketing, health_score, health_label, flags_risks } = req.body;
    const payload = {
      keyword_rankings:    keyword_rankings   !== undefined ? JSON.stringify(keyword_rankings)   : undefined,
      targets:             targets            !== undefined ? JSON.stringify(targets)            : undefined,
      key_achievements:    key_insights       !== undefined ? key_insights                       : undefined,
      linkedin_data:       linkedin_data      !== undefined ? JSON.stringify(linkedin_data)      : undefined,
      social_media_data:   social_media_data  !== undefined ? JSON.stringify(social_media_data)  : undefined,
      organic_form_data:   organic_form_data  !== undefined ? JSON.stringify(organic_form_data)  : undefined,
      gmb_rating:          gmb_rating         ?? null,
      gmb_reviews:         gmb_reviews        ?? null,
      gmb_profile_url:     gmb_profile_url    || null,
      gmb_overview:        gmb_overview       || null,
      gmb_calls:           gmb_calls          ?? null,
      gmb_bookings:        gmb_bookings       ?? null,
      gmb_website_clicks:  gmb_website_clicks ?? null,
      linkedin_url:        linkedin_url       || null,
      linkedin_followers:  linkedin_followers ?? null,
      gmb_locations:       gmb_locations       !== undefined ? JSON.stringify(gmb_locations)       : undefined,
      executive_summary:   executive_summary   !== undefined ? executive_summary                   : undefined,
      sig_change_whys:     sig_change_whys     !== undefined ? JSON.stringify(sig_change_whys)     : undefined,
      last_period_plan:    last_period_plan    !== undefined ? JSON.stringify(last_period_plan)    : undefined,
      best_performing_asset: best_performing_asset !== undefined ? (typeof best_performing_asset === 'string' ? best_performing_asset : JSON.stringify(best_performing_asset)) : undefined,
      next_period_plan:    next_period_plan    !== undefined ? JSON.stringify(next_period_plan)    : undefined,
      period_targets:      period_targets      !== undefined ? JSON.stringify(period_targets)      : undefined,
      meta_organic:        meta_organic        !== undefined ? JSON.stringify(meta_organic)        : undefined,
      linkedin_organic:    linkedin_organic    !== undefined ? JSON.stringify(linkedin_organic)    : undefined,
      performance_marketing: performance_marketing !== undefined ? JSON.stringify(performance_marketing) : undefined,
      health_score:        health_score        !== undefined ? Number(health_score)                : undefined,
      health_label:        health_label        !== undefined ? health_label                        : undefined,
      flags_risks:         flags_risks         !== undefined ? (flags_risks || null)               : undefined,
      updated_at:          new Date(),
    };
    const existing = await db('seo_manual_data').where({ client_id: req.params.clientId }).first();
    if (existing) {
      await db('seo_manual_data').where({ client_id: req.params.clientId }).update(payload);
    } else {
      await db('seo_manual_data').insert({ ...payload, client_id: req.params.clientId });
    }
    res.json({ message: 'Saved' });
  } catch (err) {
    console.error('Error saving SEO manual data:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/seo/share/:clientId — create a new share token for current date range
router.post('/share/:clientId', async (req: AuthRequest, res: Response) => {
  const { role } = req.user!;
  if (!['admin', 'manager', 'employee'].includes(role?.toLowerCase())) { res.status(403).json({ error: 'Insufficient permissions' }); return; }
  try {
    const { range = '28d', startDate, endDate, compareStart, compareEnd, demographics, acquisitions, country } = req.body;
    const token = randomUUID();
    const manualRow = await getDB()('seo_manual_data').where({ client_id: req.params.clientId }).first();
    await getDB()('seo_share_tokens').insert({
      token, client_id: req.params.clientId, range,
      start_date: startDate || null, end_date: endDate || null,
      compare_start: compareStart || null, compare_end: compareEnd || null,
      demographics: demographics ? JSON.stringify(demographics) : null,
      acquisitions: acquisitions ? JSON.stringify(acquisitions) : null,
      country: country || null,
      manual_snapshot: manualRow ? JSON.stringify(manualRow) : null,
    });
    res.json({ token });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// DELETE /api/seo/share-token/:token — revoke a specific token
router.delete('/share-token/:token', async (req: AuthRequest, res: Response) => {
  const { role } = req.user!;
  if (!['admin', 'manager', 'employee'].includes(role?.toLowerCase())) { res.status(403).json({ error: 'Insufficient permissions' }); return; }
  try {
    await getDB()('seo_share_tokens').where({ token: req.params.token }).delete();
    res.json({ message: 'Revoked' });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/seo/share-tokens/:clientId — list all tokens for a client
router.get('/share-tokens/:clientId', async (req: AuthRequest, res: Response) => {
  try {
    const rows = await getDB()('seo_share_tokens')
      .where({ client_id: req.params.clientId })
      .select('token', 'range', 'start_date', 'end_date', 'created_at')
      .orderBy('created_at', 'desc');
    res.json(rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

export default router;

// ── Public router (no auth) ─────────────────────────────────────────────────
export const publicSeoRouter = Router();

publicSeoRouter.get('/:token', async (req: Request, res: Response) => {
  try {
    const db = getDB();
    const shareRow = await db('seo_share_tokens').where({ token: req.params.token }).first();
    if (!shareRow) { res.status(404).json({ error: 'Report not found or link has been revoked' }); return; }
    const client = await db('client_companies').where({ id: shareRow.client_id }).first();
    if (!client) { res.status(404).json({ error: 'Report not found or link has been revoked' }); return; }

    const range = shareRow.range || '28d';
    const customStart = shareRow.start_date || null;
    const customEnd   = shareRow.end_date   || null;
    const isCustom    = range === 'custom' && customStart && customEnd;

    // Manual data — use snapshot if available, else live
    const manual = shareRow.manual_snapshot
      ? JSON.parse(shareRow.manual_snapshot)
      : await db('seo_manual_data').where({ client_id: client.id }).first();
    const manualData = manual ? {
      keyword_rankings:    manual.keyword_rankings      ? JSON.parse(manual.keyword_rankings)      : [],
      targets:             manual.targets               ? JSON.parse(manual.targets)               : [],
      key_insights:        manual.key_achievements      || '',
      organic_form_data:   manual.organic_form_data     ? JSON.parse(manual.organic_form_data)     : [],
      gmb_locations:       manual.gmb_locations         ? JSON.parse(manual.gmb_locations)         : [],
      executive_summary:   manual.executive_summary     || '',
      sig_change_whys:     manual.sig_change_whys       ? JSON.parse(manual.sig_change_whys)       : {},
      last_period_plan:    manual.last_period_plan      ? JSON.parse(manual.last_period_plan)      : [],
      best_performing_asset: (() => { try { const v = JSON.parse(manual.best_performing_asset || '[]'); return Array.isArray(v) ? v : [manual.best_performing_asset]; } catch { return manual.best_performing_asset ? [manual.best_performing_asset] : []; } })(),
      next_period_plan:    manual.next_period_plan      ? JSON.parse(manual.next_period_plan)      : [],
      period_targets:      manual.period_targets        ? JSON.parse(manual.period_targets)        : {},
      meta_organic:        manual.meta_organic          ? JSON.parse(manual.meta_organic)          : null,
      linkedin_organic:    manual.linkedin_organic      ? JSON.parse(manual.linkedin_organic)      : null,
      performance_marketing: manual.performance_marketing ? JSON.parse(manual.performance_marketing) : null,
      health_score:        manual.health_score          ?? 76,
      health_label:        manual.health_label          || '',
      flags_risks:         manual.flags_risks           || '',
      gmb_rating: manual.gmb_rating, gmb_reviews: manual.gmb_reviews, gmb_profile_url: manual.gmb_profile_url,
      gmb_overview: manual.gmb_overview || '', gmb_calls: manual.gmb_calls, gmb_bookings: manual.gmb_bookings,
      gmb_website_clicks: manual.gmb_website_clicks, linkedin_url: manual.linkedin_url, linkedin_followers: manual.linkedin_followers,
      linkedin_data: null, social_media_data: null,
    } : {};

    // GA4 data (if configured)
    if (!client.ga_property_id) {
      res.json({ client: { id: client.id, name: client.name }, range, manual: manualData, report: null });
      return;
    }

    const { token: gToken, error: authError } = await getAccessToken();
    if (!gToken) { res.status(500).json({ error: authError ?? 'Google auth failed' }); return; }

    const ga4Start = isCustom ? customStart : ga4StartDate(range);
    const ga4End   = isCustom ? customEnd   : 'today';
    const gscStart = isCustom ? customStart : formatDate(range === '7d' ? 7 : range === '28d' ? 28 : 90);
    const gscEnd   = isCustom ? customEnd   : formatDate(0);
    const ga4Base  = `https://analyticsdata.googleapis.com/v1beta/properties/${client.ga_property_id}:runReport`;
    const headers  = { Authorization: `Bearer ${gToken}`, 'Content-Type': 'application/json' };

    const engagementMetrics = [
      { name: 'averageSessionDuration' }, { name: 'bounceRate' },
      { name: 'screenPageViewsPerSession' }, { name: 'engagementRate' },
      { name: 'sessions' }, { name: 'activeUsers' }, { name: 'newUsers' },
    ];

    const compareStart = shareRow.compare_start || null;
    const compareEnd   = shareRow.compare_end   || null;

    const [trafficRes, acquisitionRes, engagementRes, demoRes, gscRes, gscQueriesRes, prevEngagementRes, prevAcquisitionRes] = await Promise.allSettled([
      fetch(ga4Base, { method: 'POST', headers, body: JSON.stringify({
        dateRanges: [{ startDate: ga4Start, endDate: ga4End }],
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }, { name: 'newUsers' }],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
      }) }).then((r) => r.json()),
      fetch(ga4Base, { method: 'POST', headers, body: JSON.stringify({
        dateRanges: [{ startDate: ga4Start, endDate: ga4End }],
        dimensions: [{ name: 'sessionDefaultChannelGrouping' }],
        metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 10,
      }) }).then((r) => r.json()),
      fetch(ga4Base, { method: 'POST', headers, body: JSON.stringify({
        dateRanges: [{ startDate: ga4Start, endDate: ga4End }], metrics: engagementMetrics,
      }) }).then((r) => r.json()),
      fetch(ga4Base, { method: 'POST', headers, body: JSON.stringify({
        dateRanges: [{ startDate: ga4Start, endDate: ga4End }],
        dimensions: [{ name: 'city' }],
        metrics: [{ name: 'activeUsers' }, { name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 20,
      }) }).then((r) => r.json()),
      client.gsc_site_url
        ? queryGSC(client.gsc_site_url, headers, gscStart!, gscEnd!, 'page')
        : Promise.resolve(null),
      client.gsc_site_url
        ? queryGSC(client.gsc_site_url, headers, gscStart!, gscEnd!, 'query')
        : Promise.resolve(null),
      compareStart && compareEnd
        ? fetch(ga4Base, { method: 'POST', headers, body: JSON.stringify({ dateRanges: [{ startDate: compareStart, endDate: compareEnd }], metrics: engagementMetrics }) }).then((r) => r.json())
        : Promise.resolve(null),
      compareStart && compareEnd
        ? fetch(ga4Base, { method: 'POST', headers, body: JSON.stringify({ dateRanges: [{ startDate: compareStart, endDate: compareEnd }], dimensions: [{ name: 'sessionDefaultChannelGrouping' }], metrics: [{ name: 'sessions' }, { name: 'activeUsers' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 10 }) }).then((r) => r.json())
        : Promise.resolve(null),
    ]);

    const eng = engagementRes.status === 'fulfilled' && engagementRes.value?.rows?.[0]?.metricValues
      ? engagementRes.value.rows[0].metricValues
      : null;
    const prevEng = prevEngagementRes.status === 'fulfilled' && prevEngagementRes.value?.rows?.[0]?.metricValues
      ? prevEngagementRes.value.rows[0].metricValues
      : null;

    const selectedCities: string[] = shareRow.demographics ? JSON.parse(shareRow.demographics) : [];
    const selectedChannels: string[] = shareRow.acquisitions ? JSON.parse(shareRow.acquisitions) : [];
    const selectedChannelsLower = selectedChannels.map((c) => c.toLowerCase());
    const selectedCitiesLower = selectedCities.map((c) => c.toLowerCase());

    const allDemographics = demoRes.status === 'fulfilled' && demoRes.value?.rows
      ? demoRes.value.rows.map((r: any) => ({ city: r.dimensionValues[0].value, users: Number(r.metricValues[0].value), sessions: Number(r.metricValues[1].value) }))
      : [];
    const allAcquisition = acquisitionRes.status === 'fulfilled' && acquisitionRes.value?.rows
      ? acquisitionRes.value.rows.map((r: any) => ({ channel: r.dimensionValues[0].value, sessions: Number(r.metricValues[0].value), users: Number(r.metricValues[1].value) }))
      : [];

    const report = {
      traffic: trafficRes.status === 'fulfilled' && trafficRes.value?.rows
        ? trafficRes.value.rows.map((r: any) => ({ date: r.dimensionValues[0].value, users: Number(r.metricValues[0].value), sessions: Number(r.metricValues[1].value), pageviews: Number(r.metricValues[2].value), newUsers: Number(r.metricValues[3].value) }))
        : [],
      acquisition: selectedChannelsLower.length > 0 ? allAcquisition.filter((r: any) => selectedChannelsLower.includes(r.channel.toLowerCase())) : allAcquisition,
      engagement: eng
        ? { avgDuration: Math.round(Number(eng[0].value)), bounceRate: Math.round(Number(eng[1].value) * 100), pagesPerSession: Number(Number(eng[2].value).toFixed(1)), engagementRate: Math.round(Number(eng[3].value) * 100), sessions: Number(eng[4].value), users: Number(eng[5].value), newUsers: Number(eng[6].value) }
        : { avgDuration: 0, bounceRate: 0, pagesPerSession: 0, engagementRate: 0, sessions: 0, users: 0, newUsers: 0 },
      prevEngagement: prevEng
        ? { avgDuration: Math.round(Number(prevEng[0].value)), bounceRate: Math.round(Number(prevEng[1].value) * 100), pagesPerSession: Number(Number(prevEng[2].value).toFixed(1)), engagementRate: Math.round(Number(prevEng[3].value) * 100), sessions: Number(prevEng[4].value), users: Number(prevEng[5].value), newUsers: Number(prevEng[6].value) }
        : null,
      prevAcquisition: prevAcquisitionRes.status === 'fulfilled' && prevAcquisitionRes.value?.rows
        ? prevAcquisitionRes.value.rows.map((r: any) => ({ channel: r.dimensionValues[0].value, sessions: Number(r.metricValues[0].value), users: Number(r.metricValues[1].value) }))
        : [],
      demographics: selectedCitiesLower.length > 0 ? allDemographics.filter((r: any) => selectedCitiesLower.includes(r.city.toLowerCase())) : [],
      pages: gscRes.status === 'fulfilled' && gscRes.value?.rows
        ? gscRes.value.rows.map((r: any) => ({ page: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }))
        : [],
      queries: gscQueriesRes.status === 'fulfilled' && gscQueriesRes.value?.rows
        ? gscQueriesRes.value.rows.map((r: any) => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }))
        : [],
      client: { id: client.id, name: client.name },
    };

    res.json({ client: { id: client.id, name: client.name }, range, customStart, customEnd, manual: manualData, report });
  } catch (e: any) { res.status(500).json({ error: 'Server error' }); }
});

// ── Saved Reports ────────────────────────────────────────────────────────────

// GET saved reports for a client
router.get('/saved-reports/:clientId', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const rows = await db('seo_saved_reports as sr')
      .join('users as u', 'sr.created_by', 'u.id')
      .where('sr.client_id', req.params.clientId)
      .select('sr.*', 'u.name as created_by_name')
      .orderBy('sr.created_at', 'desc');
    res.json(rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// POST save a report snapshot
router.post('/saved-reports/:clientId', async (req: AuthRequest, res: Response) => {
  const { name, range, start_date, end_date, compare_start, compare_end, country } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: 'Name required' }); return; }
  try {
    const db = getDB();
    const [id] = await db('seo_saved_reports').insert({
      client_id: req.params.clientId,
      created_by: req.user!.id,
      name: name.trim(),
      range: range || '28d',
      start_date: start_date || null,
      end_date: end_date || null,
      compare_start: compare_start || null,
      compare_end: compare_end || null,
      country: country || null,
    });
    const row = await db('seo_saved_reports as sr')
      .join('users as u', 'sr.created_by', 'u.id')
      .where('sr.id', id)
      .select('sr.*', 'u.name as created_by_name')
      .first();
    res.status(201).json(row);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// DELETE a saved report
router.delete('/saved-reports/:reportId', async (req: AuthRequest, res: Response) => {
  try {
    await getDB()('seo_saved_reports').where({ id: req.params.reportId }).delete();
    res.status(204).end();
  } catch { res.status(500).json({ error: 'Server error' }); }
});
