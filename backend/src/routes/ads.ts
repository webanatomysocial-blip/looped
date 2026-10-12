import { Router, Response, Request } from 'express';
import { randomUUID } from 'crypto';
import { getDB } from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';
import { visibleCompanyIds } from '../utils/companyAccess';

const router = Router();
router.use(authenticate);

// GET /api/ads/clients — list client companies with ads config
router.get('/clients', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const { role, id: userId } = req.user!;
    const ids = await visibleCompanyIds(db, role, userId);
    const q = db('client_companies').select('id', 'name', 'ads_customer_id').orderBy('name');
    if (ids !== null) { if (!ids.length) { res.json([]); return; } q.whereIn('id', ids); }
    res.json(await q);
  } catch (err) {
    console.error('Error fetching ads clients:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/ads/clients/:id — save customer ID
router.put('/clients/:id', async (req: AuthRequest, res: Response) => {
  const { role } = req.user!;
  if (!['admin', 'manager'].includes(role)) { res.status(403).json({ error: 'Insufficient permissions' }); return; }
  try {
    const db = getDB();
    await db('client_companies').where({ id: req.params.id }).update({ ads_customer_id: req.body.ads_customer_id || null });
    res.json({ message: 'Saved' });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/ads/report/:clientId — fetch campaigns from Google Ads API
router.get('/report/:clientId', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const client = await db('client_companies').where({ id: req.params.clientId }).select('ads_customer_id').first();
    if (!client?.ads_customer_id) { res.status(400).json({ error: 'Google Ads Customer ID not configured' }); return; }

    const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;
    const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
    const managerCustomerId = process.env.GOOGLE_ADS_MANAGER_CUSTOMER_ID;

    if (!devToken || !refreshToken || !clientId || !clientSecret) {
      res.status(503).json({ error: 'Google Ads API not configured on server. See /ads setup guide.' });
      return;
    }

    // Get OAuth access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const tokenData = await tokenRes.json() as any;
    if (!tokenData.access_token) { res.status(502).json({ error: 'Failed to get Google Ads access token' }); return; }

    const customerId = client.ads_customer_id.replace(/-/g, '');
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${tokenData.access_token}`,
      'developer-token': devToken,
      'Content-Type': 'application/json',
    };
    if (managerCustomerId) headers['login-customer-id'] = managerCustomerId.replace(/-/g, '');

    const query = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions
      FROM campaign
      WHERE segments.date DURING LAST_30_DAYS
        AND campaign.status != 'REMOVED'
      ORDER BY metrics.cost_micros DESC
      LIMIT 50
    `;

    const adsRes = await fetch(
      `https://googleads.googleapis.com/v17/customers/${customerId}/googleAds:search`,
      { method: 'POST', headers, body: JSON.stringify({ query }) }
    );
    const adsData = await adsRes.json() as any;
    if (!adsRes.ok) { res.status(502).json({ error: adsData.error?.message || 'Google Ads API error' }); return; }

    const campaigns = (adsData.results ?? []).map((r: any) => ({
      id:          r.campaign.id,
      name:        r.campaign.name,
      status:      r.campaign.status,
      impressions: Number(r.metrics.impressions ?? 0),
      clicks:      Number(r.metrics.clicks ?? 0),
      cost:        Number(r.metrics.costMicros ?? 0) / 1_000_000,
      conversions: Number(r.metrics.conversions ?? 0),
      reach:       null,
    }));

    res.json({ campaigns });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/ads/ad-approvals/:clientId
router.get('/ad-approvals/:clientId', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const client = await db('client_companies').where({ id: req.params.clientId }).select('ads_customer_id').first();
    if (!client?.ads_customer_id) { res.status(400).json({ error: 'Google Ads Customer ID not configured' }); return; }

    const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;
    const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
    const managerCustomerId = process.env.GOOGLE_ADS_MANAGER_CUSTOMER_ID;

    if (!devToken || !refreshToken || !clientId || !clientSecret) {
      res.status(503).json({ error: 'Google Ads API not configured' }); return;
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
    });
    const tokenData = await tokenRes.json() as any;
    if (!tokenData.access_token) { res.status(502).json({ error: 'Failed to get access token' }); return; }

    const customerId = client.ads_customer_id.replace(/-/g, '');
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${tokenData.access_token}`,
      'developer-token': devToken,
      'Content-Type': 'application/json',
    };
    if (managerCustomerId) headers['login-customer-id'] = managerCustomerId.replace(/-/g, '');

    const query = `
      SELECT
        ad_group_ad.ad.id,
        ad_group_ad.ad.name,
        ad_group_ad.ad.type,
        ad_group_ad.status,
        ad_group_ad.policy_summary.approval_status,
        ad_group_ad.policy_summary.policy_topic_entries,
        ad_group.name,
        campaign.name
      FROM ad_group_ad
      WHERE ad_group_ad.status != 'REMOVED'
      ORDER BY campaign.name
      LIMIT 100
    `;

    const adsRes = await fetch(
      `https://googleads.googleapis.com/v17/customers/${customerId}/googleAds:search`,
      { method: 'POST', headers, body: JSON.stringify({ query }) }
    );
    const adsData = await adsRes.json() as any;
    if (!adsRes.ok) { res.status(502).json({ error: adsData.error?.message || 'Google Ads API error' }); return; }

    const ads = (adsData.results ?? []).map((r: any) => ({
      id:              r.adGroupAd?.ad?.id,
      name:            r.adGroupAd?.ad?.name || r.adGroupAd?.ad?.id,
      type:            r.adGroupAd?.ad?.type,
      status:          r.adGroupAd?.status,
      approval_status: r.adGroupAd?.policySummary?.approvalStatus ?? 'UNKNOWN',
      policy_topics:   (r.adGroupAd?.policySummary?.policyTopicEntries ?? []).map((e: any) => ({ topic: e.topic, type: e.type })),
      ad_group:        r.adGroup?.name,
      campaign:        r.campaign?.name,
    }));

    res.json({ ads });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

type ReportRow = { entity_id: number; name: string; reach: string; impressions: string; clicks: string; leads: string; cost_per_lead: string; cost: string; level_used: number; source: string };
const parseStored = (raw: any) => { try { const v = raw ? JSON.parse(raw) : {}; return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } };

// The report is built from Campaigns. A row is a campaign (LinkedIn: a Campaign under a Campaign Group).
// Its numbers come from ONE level only — its own entries, else its ad groups/sets, else its ads — so nothing is counted twice.
export async function buildReport(clientId: number, start?: string | null, end?: string | null) {
  const db = getDB();
  const row = await db('ads_manual_data').where({ client_id: clientId }).first();
  const stored = parseStored(row?.campaigns_manual);
  const ents = await db('ad_entities').where({ client_id: clientId }).orderBy('id');
  const ids = ents.map((e: any) => e.id);
  const mets = ids.length ? await db('ad_entity_metrics').whereIn('entity_id', ids) : [];
  const ranged = !!(start || end);
  let undatedHidden = 0;
  const inRange = (m: any) => {
    if (!ranged) return true;
    if (!m.period_start) { undatedHidden++; return false; }
    return (!end || m.period_start <= end) && (!start || (m.period_end || m.period_start) >= start);
  };
  const byEntity = new Map<number, any[]>();
  for (const m of mets) if (inRange(m)) { const l = byEntity.get(m.entity_id) || []; l.push(m); byEntity.set(m.entity_id, l); }
  const kids = new Map<number, any[]>();
  for (const e of ents) if (e.parent_id) { const l = kids.get(e.parent_id) || []; l.push(e); kids.set(e.parent_id, l); }
  const fmt = (n: number | null) => (n == null ? '' : String(Math.round(n * 100) / 100));

  const rowsFor = (platform: string): ReportRow[] => {
    const rootLevel = platform === 'linkedin' ? 2 : 1;
    const out: ReportRow[] = [];
    for (const root of ents.filter((e: any) => e.platform === platform && e.level === rootLevel)) {
      let layer = [root], used: any[] = [], levelUsed = root.level;
      while (layer.length) {
        used = layer.flatMap((e: any) => byEntity.get(e.id) || []);
        if (used.length) { levelUsed = layer[0].level; break; }
        layer = layer.flatMap((e: any) => kids.get(e.id) || []);
      }
      if (!used.length) continue;
      const sum = (k: string) => { const v = used.map((m) => m[k]).filter((x) => x != null).map(Number); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
      const cost = sum('cost'), leads = sum('leads');
      const storedCpl = used.length === 1 && used[0].cost_per_lead != null ? Number(used[0].cost_per_lead) : null;
      out.push({
        entity_id: root.id, name: root.name, level_used: levelUsed,
        source: used.every((m) => m.source === 'imported') ? 'imported' : 'manual',
        reach: fmt(sum('reach')), impressions: fmt(sum('impressions')), clicks: fmt(sum('clicks')), leads: fmt(leads), cost: fmt(cost),
        cost_per_lead: fmt(cost != null && leads ? cost / leads : storedCpl),
      });
    }
    return out;
  };
  const group = (p: string) => ({ campaigns: rowsFor(p), key_insights: stored[p]?.key_insights || '' });
  return { notes: row?.notes || '', campaigns_manual: { google: group('google'), linkedin: group('linkedin'), meta: group('meta') }, undated_hidden: undatedHidden };
}

const isDate = (v: any) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

// GET /api/ads/manual/:clientId?startDate&endDate — report data, built from Campaigns
router.get('/manual/:clientId', async (req: AuthRequest, res: Response) => {
  try {
    if (!(await canSeeClient(req, Number(req.params.clientId)))) { res.status(403).json({ error: 'No access to this client' }); return; }
    const { startDate, endDate } = req.query;
    res.json(await buildReport(Number(req.params.clientId), isDate(startDate) ? String(startDate) : null, isDate(endDate) ? String(endDate) : null));
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// PUT /api/ads/manual/:clientId
router.put('/manual/:clientId', async (req: AuthRequest, res: Response) => {
  const { role } = req.user!;
  if (!['admin', 'manager', 'employee'].includes(role)) { res.status(403).json({ error: 'Insufficient permissions' }); return; }
  try {
    const db = getDB();
    if (!(await canSeeClient(req, Number(req.params.clientId)))) { res.status(403).json({ error: 'No access to this client' }); return; }
    const { notes, campaigns_manual } = req.body;
    const existing = await db('ads_manual_data').where({ client_id: req.params.clientId }).first();
    // Campaign rows now live in Campaigns; only per-platform Key Insights are stored here
    const stored = parseStored(existing?.campaigns_manual);
    if (campaigns_manual && typeof campaigns_manual === 'object') {
      for (const p of PLATFORMS) if (campaigns_manual[p] && typeof campaigns_manual[p].key_insights === 'string') stored[p] = { ...(stored[p] || {}), key_insights: campaigns_manual[p].key_insights };
    }
    const payload: Record<string, any> = { campaigns_manual: JSON.stringify(stored), updated_at: new Date() };
    if (notes !== undefined) payload.notes = notes;
    if (!existing) payload.campaigns_migrated = true;
    if (existing) {
      await db('ads_manual_data').where({ client_id: req.params.clientId }).update(payload);
    } else {
      await db('ads_manual_data').insert({ ...payload, client_id: req.params.clientId });
    }
    res.json({ message: 'Saved' });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/ads/share/:clientId
router.post('/share/:clientId', async (req: AuthRequest, res: Response) => {
  const { role } = req.user!;
  if (!['admin', 'manager'].includes(role)) { res.status(403).json({ error: 'Forbidden' }); return; }
  const { startDate, endDate } = req.body;
  const token = randomUUID();
  await getDB()('ads_share_tokens').insert({ token, client_id: req.params.clientId, start_date: startDate || null, end_date: endDate || null });
  res.json({ token });
});

// DELETE /api/ads/share-token/:token
router.delete('/share-token/:token', async (req: AuthRequest, res: Response) => {
  const { role } = req.user!;
  if (!['admin', 'manager'].includes(role)) { res.status(403).json({ error: 'Forbidden' }); return; }
  await getDB()('ads_share_tokens').where({ token: req.params.token }).delete();
  res.json({ message: 'Revoked' });
});

// GET /api/ads/share-tokens/:clientId
router.get('/share-tokens/:clientId', async (req: AuthRequest, res: Response) => {
  const rows = await getDB()('ads_share_tokens').where({ client_id: req.params.clientId }).select('token', 'start_date', 'end_date', 'created_at').orderBy('created_at', 'desc');
  res.json(rows);
});

// ── Internal campaign hierarchy (records here never touch Google/Meta/LinkedIn) ──
const PLATFORMS = ['google', 'meta', 'linkedin'];
const STATUSES = ['draft', 'active', 'paused', 'archived'];
const BUDGET_TYPES = ['daily', 'lifetime'];
const ENTITY_FIELDS = ['name', 'status', 'objective', 'budget', 'budget_type', 'start_date', 'end_date', 'notes', 'external_id',
  'targeting', 'ad_format', 'headline', 'primary_text', 'cta', 'destination_url', 'asset_id', 'asset_url'] as const;
const canWrite = (role: string) => ['admin', 'manager', 'employee'].includes(role);
const canDelete = (role: string) => ['admin', 'manager'].includes(role);

async function canSeeClient(req: AuthRequest, clientId: number) {
  const ids = await visibleCompanyIds(getDB(), req.user!.role, req.user!.id);
  return ids === null || ids.includes(Number(clientId));
}

// Clean + validate editable fields; returns [fields, error]
function cleanEntity(body: any, partial: boolean): [Record<string, any>, string | null] {
  const out: Record<string, any> = {};
  for (const f of ENTITY_FIELDS) {
    if (!(f in body)) continue;
    const v = body[f];
    out[f] = v === '' || v === undefined ? null : typeof v === 'string' ? v.trim() || null : v;
  }
  if (!partial || 'name' in out) { if (!out.name) return [out, 'Name is required']; if (String(out.name).length > 255) return [out, 'Name is too long']; }
  if (out.status != null && !STATUSES.includes(out.status)) return [out, 'Invalid status'];
  if (!partial && out.status == null) out.status = 'draft';
  if (out.budget_type != null && !BUDGET_TYPES.includes(out.budget_type)) return [out, 'Budget type must be daily or lifetime'];
  if (out.budget != null) { const n = Number(out.budget); if (!Number.isFinite(n) || n < 0) return [out, 'Budget must be a positive number']; out.budget = n; }
  for (const d of ['start_date', 'end_date']) if (out[d] != null && !/^\d{4}-\d{2}-\d{2}$/.test(out[d])) return [out, 'Dates must be YYYY-MM-DD'];
  if (out.start_date && out.end_date && out.end_date < out.start_date) return [out, 'End date is before start date'];
  if (out.destination_url != null && !/^https?:\/\//i.test(out.destination_url)) return [out, 'Destination URL must start with http:// or https://'];
  if (out.asset_url != null && !/^https?:\/\//i.test(out.asset_url)) return [out, 'Asset URL must start with http:// or https://'];
  if (out.asset_id != null) { out.asset_id = Number(out.asset_id); if (!Number.isInteger(out.asset_id)) return [out, 'Invalid asset']; }
  if (out.targeting != null && typeof out.targeting !== 'string') out.targeting = JSON.stringify(out.targeting);
  return [out, null];
}

async function subtreeIds(db: any, rootId: number): Promise<number[]> {
  const ids = [rootId]; let frontier = [rootId];
  while (frontier.length) {
    frontier = await db('ad_entities').whereIn('parent_id', frontier).pluck('id');
    ids.push(...frontier);
  }
  return ids;
}

// Parent must exist, be one level up, same client and platform
async function checkParent(db: any, client_id: number, platform: string, level: number, parent_id: any): Promise<string | null> {
  if (level === 1) return parent_id ? 'Top-level records have no parent' : null;
  if (!parent_id) return 'Parent is required';
  const p = await db('ad_entities').where({ id: parent_id }).first();
  if (!p || p.client_id !== client_id || p.platform !== platform || p.level !== level - 1) return 'Parent is not valid for this level';
  return null;
}

async function loadEntity(req: AuthRequest, res: Response) {
  const e = await getDB()('ad_entities').where({ id: req.params.id }).first();
  if (!e || !(await canSeeClient(req, e.client_id))) { res.status(404).json({ error: 'Not found' }); return null; }
  return e;
}

// GET /api/ads/entities/:clientId?platform=google — whole tree flat, with metrics
router.get('/entities/:clientId', async (req: AuthRequest, res: Response) => {
  try {
    const clientId = Number(req.params.clientId);
    if (!(await canSeeClient(req, clientId))) { res.status(403).json({ error: 'No access to this client' }); return; }
    const db = getDB();
    const q = db('ad_entities').where({ client_id: clientId }).orderBy('level').orderBy('id');
    if (req.query.platform) q.where({ platform: String(req.query.platform) });
    const entities = await q;
    const ids = entities.map((e: any) => e.id);
    const metrics = ids.length ? await db('ad_entity_metrics').whereIn('entity_id', ids).orderBy('period_start', 'desc') : [];
    res.json({ entities, metrics });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// POST /api/ads/entities — body { client_id, platform, level, parent_id?, ...fields }
router.post('/entities', async (req: AuthRequest, res: Response) => {
  if (!canWrite(req.user!.role)) { res.status(403).json({ error: 'Insufficient permissions' }); return; }
  try {
    const db = getDB();
    const client_id = Number(req.body.client_id), level = Number(req.body.level), platform = String(req.body.platform || '');
    if (!PLATFORMS.includes(platform)) { res.status(400).json({ error: 'Invalid platform' }); return; }
    if (![1, 2, 3].includes(level)) { res.status(400).json({ error: 'Invalid level' }); return; }
    if (!(await canSeeClient(req, client_id))) { res.status(403).json({ error: 'No access to this client' }); return; }
    const [fields, err] = cleanEntity(req.body, false);
    if (err) { res.status(400).json({ error: err }); return; }
    const parent_id = level === 1 ? null : Number(req.body.parent_id) || null;
    const perr = await checkParent(db, client_id, platform, level, parent_id);
    if (perr) { res.status(400).json({ error: perr }); return; }
    const [id] = await db('ad_entities').insert({ ...fields, client_id, platform, level, parent_id, created_by: req.user!.id });
    const newId = typeof id === 'object' ? (id as any).id : id;
    res.status(201).json(await db('ad_entities').where({ id: newId }).first());
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// PUT /api/ads/entities/:id — edit fields; parent_id moves within the same level/platform/client
router.put('/entities/:id', async (req: AuthRequest, res: Response) => {
  if (!canWrite(req.user!.role)) { res.status(403).json({ error: 'Insufficient permissions' }); return; }
  try {
    const db = getDB();
    const e = await loadEntity(req, res); if (!e) return;
    const [fields, err] = cleanEntity(req.body, true);
    if (err) { res.status(400).json({ error: err }); return; }
    if ('parent_id' in req.body && e.level > 1) {
      const parent_id = Number(req.body.parent_id) || null;
      const perr = await checkParent(db, e.client_id, e.platform, e.level, parent_id);
      if (perr) { res.status(400).json({ error: perr }); return; }
      fields.parent_id = parent_id;
    }
    await db('ad_entities').where({ id: e.id }).update({ ...fields, updated_at: new Date() });
    res.json(await db('ad_entities').where({ id: e.id }).first());
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// GET /api/ads/entities/:id/impact — what a delete would remove
router.get('/entities/:id/impact', async (req: AuthRequest, res: Response) => {
  const e = await loadEntity(req, res); if (!e) return;
  const db = getDB();
  const ids = await subtreeIds(db, e.id);
  const rows = await db('ad_entities').whereIn('id', ids).select('level');
  const byLevel: Record<number, number> = {};
  rows.forEach((r: any) => { if (r.level !== e.level) byLevel[r.level] = (byLevel[r.level] || 0) + 1; });
  const metrics = Number((await db('ad_entity_metrics').whereIn('entity_id', ids).count('id as n').first() as any)?.n || 0);
  res.json({ children: byLevel, metrics });
});

// DELETE /api/ads/entities/:id — deletes the record and everything under it (UI confirms with /impact first)
router.delete('/entities/:id', async (req: AuthRequest, res: Response) => {
  if (!canDelete(req.user!.role)) { res.status(403).json({ error: 'Only managers and admins can delete. Archive it instead.' }); return; }
  try {
    const db = getDB();
    const e = await loadEntity(req, res); if (!e) return;
    await db.transaction(async (trx: any) => {
      const ids = await subtreeIds(trx, e.id);
      await trx('ad_entity_metrics').whereIn('entity_id', ids).delete();
      await trx('ad_entities').whereIn('id', [...ids].reverse()).delete();
    });
    res.json({ message: 'Deleted' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// POST /api/ads/entities/:id/duplicate — deep copy as Draft; external IDs and metrics are not copied
router.post('/entities/:id/duplicate', async (req: AuthRequest, res: Response) => {
  if (!canWrite(req.user!.role)) { res.status(403).json({ error: 'Insufficient permissions' }); return; }
  try {
    const db = getDB();
    const e = await loadEntity(req, res); if (!e) return;
    let rootId = 0;
    await db.transaction(async (trx: any) => {
      const copy = async (src: any, parent_id: number | null, rename: boolean): Promise<number> => {
        const { id, created_at, updated_at, ...rest } = src;
        const [nid] = await trx('ad_entities').insert({ ...rest, parent_id, name: rename ? `${src.name} (copy)` : src.name, status: 'draft', external_id: null, created_by: req.user!.id });
        const newId = typeof nid === 'object' ? nid.id : nid;
        for (const child of await trx('ad_entities').where({ parent_id: id }).orderBy('id')) await copy(child, newId, false);
        return newId;
      };
      rootId = await copy(e, e.parent_id, true);
    });
    res.status(201).json({ id: rootId });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Manual metrics stay on the record they were entered against — never rolled up, so nothing is double-counted
router.post('/entities/:id/metrics', async (req: AuthRequest, res: Response) => {
  if (!canWrite(req.user!.role)) { res.status(403).json({ error: 'Insufficient permissions' }); return; }
  try {
    const e = await loadEntity(req, res); if (!e) return;
    const { period_start, period_end } = req.body;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(period_start || '') || !/^\d{4}-\d{2}-\d{2}$/.test(period_end || '')) { res.status(400).json({ error: 'Reporting period start and end are required' }); return; }
    if (period_end < period_start) { res.status(400).json({ error: 'Period end is before start' }); return; }
    const row: Record<string, any> = { entity_id: e.id, period_start, period_end, source: 'manual', created_by: req.user!.id };
    for (const k of ['reach', 'impressions', 'clicks', 'leads', 'cost']) {
      const v = req.body[k];
      if (v === '' || v == null) { row[k] = null; continue; }
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) { res.status(400).json({ error: `${k} must be a positive number` }); return; }
      row[k] = n;
    }
    if (['reach', 'impressions', 'clicks', 'leads', 'cost'].every(k => row[k] == null)) { res.status(400).json({ error: 'Enter at least one metric' }); return; }
    await getDB()('ad_entity_metrics').insert(row);
    res.status(201).json({ message: 'Saved' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.delete('/metrics/:metricId', async (req: AuthRequest, res: Response) => {
  if (!canWrite(req.user!.role)) { res.status(403).json({ error: 'Insufficient permissions' }); return; }
  const db = getDB();
  const m = await db('ad_entity_metrics').where({ id: req.params.metricId }).first();
  const e = m && await db('ad_entities').where({ id: m.entity_id }).first();
  if (!e || !(await canSeeClient(req, e.client_id))) { res.status(404).json({ error: 'Not found' }); return; }
  await db('ad_entity_metrics').where({ id: m.id }).delete();
  res.json({ message: 'Deleted' });
});

export default router;

export const publicAdsRouter = Router();
publicAdsRouter.get('/:token', async (req: Request, res: Response) => {
  try {
    const db = getDB();
    const shareRow = await db('ads_share_tokens').where({ token: req.params.token }).first();
    if (!shareRow) { res.status(404).json({ error: 'Not found' }); return; }
    const client = await db('client_companies').where({ id: shareRow.client_id }).first();
    if (!client) { res.status(404).json({ error: 'Not found' }); return; }
    // Only aggregated numbers, names, insights and notes — no drafts' details, internal notes or creatives
    const { undated_hidden, ...data } = await buildReport(client.id, shareRow.start_date, shareRow.end_date);
    res.json({
      clientName: client.name,
      startDate: shareRow.start_date || null,
      endDate: shareRow.end_date || null,
      data,
    });
  } catch { res.status(500).json({ error: 'Server error' }); }
});
