import { Router, Response, Request } from 'express';
import { randomUUID } from 'crypto';
import { getDB } from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate);

// GET /api/ads/clients — list client companies with ads config
router.get('/clients', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const clients = await db('client_companies').select('id', 'name', 'ads_customer_id').orderBy('name');
    res.json(clients);
  } catch { res.status(500).json({ error: 'Server error' }); }
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

// GET /api/ads/manual/:clientId
router.get('/manual/:clientId', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDB();
    const row = await db('ads_manual_data').where({ client_id: req.params.clientId }).first();
    if (!row) { res.json({}); return; }
    res.json({
      notes:             row.notes || '',
      campaigns_manual:  row.campaigns_manual ? JSON.parse(row.campaigns_manual) : [],
    });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// PUT /api/ads/manual/:clientId
router.put('/manual/:clientId', async (req: AuthRequest, res: Response) => {
  const { role } = req.user!;
  if (!['admin', 'manager', 'employee'].includes(role)) { res.status(403).json({ error: 'Insufficient permissions' }); return; }
  try {
    const db = getDB();
    const { notes, campaigns_manual } = req.body;
    const payload = {
      notes:            notes            ?? null,
      campaigns_manual: campaigns_manual !== undefined ? JSON.stringify(campaigns_manual) : undefined,
      updated_at:       new Date(),
    };
    const existing = await db('ads_manual_data').where({ client_id: req.params.clientId }).first();
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
  await getDB()('client_companies').where({ id: req.params.clientId }).update({
    ads_share_token: token,
    ads_share_start: startDate || null,
    ads_share_end: endDate || null,
  });
  res.json({ token });
});

// DELETE /api/ads/share/:clientId
router.delete('/share/:clientId', async (req: AuthRequest, res: Response) => {
  await getDB()('client_companies').where({ id: req.params.clientId }).update({ ads_share_token: null, ads_share_start: null, ads_share_end: null });
  res.json({ message: 'Revoked' });
});

// GET /api/ads/share-info/:clientId
router.get('/share-info/:clientId', async (req: AuthRequest, res: Response) => {
  const row = await getDB()('client_companies').where({ id: req.params.clientId }).select('ads_share_token').first();
  res.json({ token: row?.ads_share_token || null });
});

export default router;

export const publicAdsRouter = Router();
publicAdsRouter.get('/:token', async (req: Request, res: Response) => {
  try {
    const db = getDB();
    const client = await db('client_companies').where({ ads_share_token: req.params.token }).first();
    if (!client) { res.status(404).json({ error: 'Not found' }); return; }
    const row = await db('ads_manual_data').where({ client_id: client.id }).first();
    const data = {
      notes: row?.notes || '',
      campaigns_manual: row?.campaigns_manual ? JSON.parse(row.campaigns_manual) : {},
    };
    res.json({
      clientName: client.name,
      startDate: client.ads_share_start || null,
      endDate: client.ads_share_end || null,
      data,
    });
  } catch { res.status(500).json({ error: 'Server error' }); }
});
