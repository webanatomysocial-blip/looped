import { Router, Response } from 'express';
import { GoogleAuth } from 'google-auth-library';
import { getDB } from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';
import path from 'path';
import fs from 'fs';

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

// Helper: company IDs accessible to an employee via their assigned projects
async function employeeCompanyIds(db: any, userId: number): Promise<number[]> {
  return db('projects as p')
    .join('project_members as pm', 'pm.project_id', 'p.id')
    .where('pm.user_id', userId)
    .whereNotNull('p.client_company_id')
    .distinct('p.client_company_id')
    .pluck('p.client_company_id');
}

// GET /api/seo/clients — companies visible to the logged-in user
router.get('/clients', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const { role, id: userId } = req.user!;

    if (role === 'client') {
      const user = await db('users').where({ id: userId }).select('client_company_id').first();
      if (!user?.client_company_id) { res.json([]); return; }
      const companies = await db('client_companies')
        .where({ id: user.client_company_id })
        .select('id', 'name', 'ga_property_id', 'gsc_site_url');
      res.json(companies);
    } else if (role === 'employee') {
      // Employee only sees companies from projects they're assigned to
      const ids = await employeeCompanyIds(db, userId);
      if (!ids.length) { res.json([]); return; }
      const clients = await db('client_companies')
        .whereIn('id', ids)
        .select('id', 'name', 'ga_property_id', 'gsc_site_url')
        .orderBy('name');
      res.json(clients);
    } else {
      // Admin and manager see every company
      const clients = await db('client_companies').select('id', 'name', 'ga_property_id', 'gsc_site_url').orderBy('name');
      res.json(clients);
    }
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
  // Employee must be assigned to a project with this company
  if (role === 'employee') {
    const db = getDB();
    const ids = await employeeCompanyIds(db, userId);
    if (!ids.map(String).includes(String(req.params.id))) {
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
    } else if (role === 'employee') {
      const ids = await employeeCompanyIds(db, userId);
      if (!ids.map(String).includes(String(req.params.clientId))) {
        res.status(403).json({ error: 'Access denied' }); return;
      }
    }
    // admin and manager: unrestricted

    const client = await db('client_companies').where({ id: req.params.clientId }).first();
    if (!client) { res.status(404).json({ error: 'Client not found' }); return; }
    if (!client.ga_property_id) { res.status(400).json({ error: 'GA4 Property ID not configured for this client' }); return; }

    const { token, error: authError } = await getAccessToken();
    if (!token) { res.status(500).json({ error: authError ?? 'Google auth failed' }); return; }

    const range        = String(req.query.range || '28d');
    const customStart  = req.query.startDate ? String(req.query.startDate) : null;
    const customEnd    = req.query.endDate   ? String(req.query.endDate)   : null;
    const isCustom     = range === 'custom' && customStart && customEnd;
    const ga4Start     = isCustom ? customStart : ga4StartDate(range);
    const ga4End       = isCustom ? customEnd   : 'today';
    const gscStart     = isCustom ? customStart : formatDate(range === '7d' ? 7 : range === '28d' ? 28 : 90);
    const gscEnd       = isCustom ? customEnd   : formatDate(0);
    const propertyId   = client.ga_property_id;
    const siteUrl      = client.gsc_site_url;

    const ga4Base = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    // Run all GA4 requests in parallel
    const [trafficRes, acquisitionRes, engagementRes, demoRes, gscRes, gscQueriesRes] = await Promise.allSettled([

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
        body: JSON.stringify({
          dateRanges: [{ startDate: ga4Start, endDate: ga4End }],
          metrics: [
            { name: 'averageSessionDuration' },
            { name: 'bounceRate' },
            { name: 'screenPageViewsPerSession' },
            { name: 'engagementRate' },
            { name: 'sessions' },
            { name: 'activeUsers' },
            { name: 'newUsers' },
          ],
        }),
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

    res.json({ traffic, acquisition, engagement, demographics, pages, queries, client: { id: client.id, name: client.name } });
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
            rowLimit: dimension === 'query' ? 15 : 20,
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
    // Employee must be assigned to this company's project
    if (role === 'employee') {
      const ids = await employeeCompanyIds(db, userId);
      if (!ids.map(String).includes(String(req.params.clientId))) {
        res.status(403).json({ error: 'Access denied' }); return;
      }
    }
    const { keyword_rankings, targets, key_insights, linkedin_data, social_media_data, organic_form_data, gmb_rating, gmb_reviews, gmb_profile_url, gmb_overview, gmb_calls, gmb_bookings, gmb_website_clicks, linkedin_url, linkedin_followers } = req.body;
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
      updated_at:          new Date(),
    };
    const existing = await db('seo_manual_data').where({ client_id: req.params.clientId }).first();
    if (existing) {
      await db('seo_manual_data').where({ client_id: req.params.clientId }).update(payload);
    } else {
      await db('seo_manual_data').insert({ ...payload, client_id: req.params.clientId });
    }
    res.json({ message: 'Saved' });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

export default router;
