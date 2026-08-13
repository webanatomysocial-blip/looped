import { Router, Response } from 'express';
import { authenticate as authMiddleware, AuthRequest } from '../middleware/auth';
import { getDB } from '../db';

const router = Router();
router.use(authMiddleware);

function stripWww(domain: string) {
  return domain.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].toLowerCase().trim();
}

async function getSerperKey(): Promise<string> {
  const row = await getDB()('app_settings').where({ key: 'serper_api_key' }).first();
  return row?.value || '';
}

// Forward geocode: address → { lat, lng }
// Tries progressively shorter versions of the address to handle GMB-style full addresses
async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  // Build candidate queries: full, then drop leading segments one at a time
  const parts = address.split(',').map((s) => s.trim()).filter(Boolean);
  const candidates: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    candidates.push(parts.slice(i).join(', '));
  }
  // Also try postcode + country if there's a postcode-like token
  const postcodeMatch = address.match(/([A-Z]{1,2}\d[\d A-Z]*\s*\d[A-Z]{2}|\d{5,6})/i);
  if (postcodeMatch) candidates.push(postcodeMatch[0] + ', ' + (parts[parts.length - 1] || ''));

  for (const q of candidates) {
    if (q.length < 3) continue;
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'AgencyLSEO/1.0' } });
    const data: any[] = await resp.json();
    if (data.length) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    await new Promise((r) => setTimeout(r, 1100)); // Nominatim rate limit
  }
  return null;
}

// Reverse geocode: lat/lng → location string for Serper
async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=12`;
  const resp = await fetch(url, { headers: { 'User-Agent': 'AgencyLSEO/1.0' } });
  const data: any = await resp.json();
  const a = data.address || {};
  const parts = [
    a.suburb || a.neighbourhood || a.village || a.town || a.city_district,
    a.city || a.town || a.county,
    a.country,
  ].filter(Boolean);
  return parts.join(', ') || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

// Generate circular grid of points around center
function generateGrid(centerLat: number, centerLng: number, radiusKm: number, gridSize: number) {
  const points: { lat: number; lng: number; row: number; col: number }[] = [];
  const half = Math.floor(gridSize / 2);
  const step = (radiusKm * 2) / gridSize;
  const cosLat = Math.cos(centerLat * Math.PI / 180);

  for (let row = -half; row <= half; row++) {
    for (let col = -half; col <= half; col++) {
      const offsetKm = Math.sqrt(Math.pow(row * step, 2) + Math.pow(col * step, 2));
      if (offsetKm > radiusKm) continue; // circular mask
      const lat = centerLat + (row * step) / 111;
      const lng = centerLng + (col * step) / (111 * cosLat);
      points.push({ lat, lng, row, col });
    }
  }
  return points;
}

function findPosition(places: any[], domain: string): { position: number | null; url: string | null; title: string | null } {
  const d = stripWww(domain);
  const match = places.find((r: any) => {
    const site = stripWww(r.website || r.link || '');
    return site && (site === d || site.endsWith('.' + d) || d.endsWith('.' + site) || site.includes(d) || d.includes(site));
  });
  return match
    ? { position: match.position, url: match.website || match.link || null, title: match.title }
    : { position: null, url: null, title: null };
}

// GET config for a client
router.get('/config/:clientId', async (req: AuthRequest, res: Response) => {
  const config = await getDB()('local_seo_configs').where({ client_company_id: req.params.clientId }).first();
  if (!config) {
    res.json({ domain: '', address: '', keywords: [], locations: [], country_code: 'in', radius_km: 10, grid_size: 7 });
    return;
  }
  res.json({
    ...config,
    keywords: JSON.parse(config.keywords || '[]'),
    locations: JSON.parse(config.locations || '[]'),
  });
});

// PUT config
router.put('/config/:clientId', async (req: AuthRequest, res: Response) => {
  const { domain, address, keywords, locations, country_code, radius_km, grid_size } = req.body;
  const db = getDB();
  const data = {
    domain: (domain || '').trim(),
    address: (address || '').trim(),
    keywords: JSON.stringify(keywords || []),
    locations: JSON.stringify(locations || []),
    country_code: country_code || 'in',
    radius_km: radius_km || 10,
    grid_size: grid_size || 7,
    updated_at: new Date(),
  };
  const exists = await db('local_seo_configs').where({ client_company_id: req.params.clientId }).first();
  if (exists) {
    await db('local_seo_configs').where({ client_company_id: req.params.clientId }).update(data);
  } else {
    await db('local_seo_configs').insert({ ...data, client_company_id: req.params.clientId });
  }
  res.json({ ok: true });
});

// POST /geocode - convert address to lat/lng
router.post('/geocode', async (req: AuthRequest, res: Response) => {
  const { address } = req.body;
  if (!address) { res.status(400).json({ error: 'address required' }); return; }
  const coords = await geocodeAddress(address);
  if (!coords) { res.status(404).json({ error: 'Address not found' }); return; }
  res.json(coords);
});

// POST /geogrid/:clientId - run geogrid check for a keyword
router.post('/geogrid/:clientId', async (req: AuthRequest, res: Response) => {
  const { keyword, center_lat, center_lng, radius_km, grid_size, country_code, domain } = req.body;
  if (!keyword || !center_lat || !center_lng || !domain) {
    res.status(400).json({ error: 'keyword, center coordinates, and domain are required' }); return;
  }

  const serperKey = await getSerperKey();
  if (!serperKey) {
    res.status(400).json({ error: 'Serper API key not configured. Go to Settings → Integrations.' }); return;
  }

  const radius = radius_km || 10;
  const size = Math.min(grid_size || 7, 9); // cap at 9x9
  const gl = country_code || 'in';

  const points = generateGrid(parseFloat(center_lat), parseFloat(center_lng), radius, size);
  const results: any[] = [];

  for (const point of points) {
    // Small delay to respect Nominatim rate limit
    await new Promise((r) => setTimeout(r, 1100));
    const location = await reverseGeocode(point.lat, point.lng);

    try {
      await new Promise((r) => setTimeout(r, 250));
      const resp = await fetch('https://google.serper.dev/maps', {
        method: 'POST',
        headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: keyword, location, gl, hl: 'en' }),
      });
      const data: any = await resp.json();
      const places: any[] = data.places || [];
      // Log first point only for debugging
      if (results.length === 0) {
        console.log(`[LSEO] location="${location}" places=${places.length}`);
        places.slice(0, 3).forEach((p: any) =>
          console.log(`  #${p.position} ${p.title} | website: ${p.website || '(none)'} | address: ${p.address}`)
        );
      }
      const { position, url, title } = findPosition(places, domain);
      results.push({ ...point, location, position, url, title });
    } catch {
      results.push({ ...point, location, position: null, url: null, title: null });
    }
  }

  // Save to DB
  const db = getDB();
  const checkedAt = new Date().toISOString();
  await db('geo_grid_results').insert({
    client_company_id: req.params.clientId,
    keyword,
    center_lat: parseFloat(center_lat),
    center_lng: parseFloat(center_lng),
    radius_km: radius,
    grid_size: size,
    results: JSON.stringify(results),
    checked_at: checkedAt,
  });

  res.json({ results, checkedAt, center: { lat: parseFloat(center_lat), lng: parseFloat(center_lng) }, radius, grid_size: size });
});

// GET latest geogrid result for a keyword
router.get('/geogrid/:clientId', async (req: AuthRequest, res: Response) => {
  const { keyword } = req.query as { keyword: string };
  const row = await getDB()('geo_grid_results')
    .where({ client_company_id: req.params.clientId, keyword })
    .orderBy('checked_at', 'desc')
    .first();
  if (!row) { res.json(null); return; }
  res.json({
    ...row,
    results: JSON.parse(row.results || '[]'),
  });
});

// GET list of checked keywords for a client
router.get('/keywords/:clientId', async (req: AuthRequest, res: Response) => {
  const rows = await getDB()('geo_grid_results')
    .where({ client_company_id: req.params.clientId })
    .distinct('keyword')
    .orderBy('keyword');
  res.json(rows.map((r: any) => r.keyword));
});

// Debug: test a single Serper maps call — admin only
router.post('/debug', async (req: AuthRequest, res: Response) => {
  if (req.user!.role !== 'admin') { res.status(403).json({ error: 'Forbidden' }); return; }
  const { keyword, location, country_code } = req.body;
  const serperKey = await getSerperKey();
  if (!serperKey) { res.status(400).json({ error: 'No Serper key configured' }); return; }
  const resp = await fetch('https://google.serper.dev/maps', {
    method: 'POST',
    headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: keyword || 'dentist', location: location || 'London, UK', gl: country_code || 'gb', hl: 'en' }),
  });
  const data = await resp.json();
  res.json(data);
});

export default router;
