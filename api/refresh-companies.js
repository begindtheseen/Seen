// Nightly cron: refresh company scores for the most-checked companies
// Runs at 3am UTC daily — keeps cache warm so users always get fast results
// Refreshes any company whose score is expired or will expire within 3 days

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const BASE_URL = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://seenjobs.io';

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  const dbHeaders = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };

  // Companies to always keep fresh — the ones users check most
  const TOP_COMPANIES = [
    'Amazon', 'Google', 'Meta', 'Apple', 'Microsoft', 'Netflix', 'Uber', 'Lyft',
    'Stripe', 'Linear', 'Shopify', 'Notion', 'Figma', 'Vercel', 'Airbnb',
    'Accenture', 'Deloitte', 'McKinsey', 'Indeed', 'LinkedIn',
    'Walmart', 'Target', 'Costco', 'McDonald\'s', 'Starbucks',
    'Tesla', 'SpaceX', 'Salesforce', 'Oracle', 'IBM',
    'JPMorgan', 'Goldman Sachs', 'Bank of America', 'Wells Fargo',
    'Kaiser Permanente', 'CVS Health', 'UnitedHealth',
    'Lockheed Martin', 'Boeing', 'Raytheon',
    'DoorDash', 'Instacart', 'Chewy', 'Wayfair',
  ];

  // Also pick up any company checked in the last 30 days that is stale
  const threeDaysOut = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  let staleNames = [];
  try {
    const staleRes = await fetch(
      `${SUPABASE_URL}/rest/v1/company_scores?expires_at=lt.${encodeURIComponent(threeDaysOut)}&order=created_at.desc&limit=40`,
      { headers: dbHeaders }
    );
    if (staleRes.ok) {
      const rows = await staleRes.json();
      staleNames = (rows || []).map(r => r.company_name).filter(Boolean);
    }
  } catch(e) { console.warn('stale fetch:', e.message); }

  // Deduplicate
  const allNames = [...new Set([
    ...TOP_COMPANIES.map(n => n.toLowerCase()),
    ...staleNames,
  ])].slice(0, 50); // cap at 50 per run to stay within Haiku rate limits

  const results = [];
  let refreshed = 0, skipped = 0, failed = 0;

  for (const name of allNames) {
    // Check if already fresh (skip if cached and not expiring soon)
    try {
      const now = encodeURIComponent(new Date().toISOString());
      const checkRes = await fetch(
        `${SUPABASE_URL}/rest/v1/company_scores?company_name=ilike.${encodeURIComponent(name)}&expires_at=gt.${encodeURIComponent(threeDaysOut)}&limit=1`,
        { headers: dbHeaders }
      );
      if (checkRes.ok) {
        const rows = await checkRes.json();
        if (rows?.[0]) { skipped++; continue; } // still fresh
      }
    } catch(e) {}

    // Refresh via company-score endpoint
    try {
      await new Promise(r => setTimeout(r, 1500)); // 1.5s between calls — stay under rate limit
      const r = await fetch(`${BASE_URL}/api/company-score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, force_refresh: true }),
      });
      if (r.ok) {
        const d = await r.json();
        results.push({ name, score: d.score?.overall_score, src: d._src });
        refreshed++;
      } else {
        failed++;
        console.error(`refresh failed for "${name}": ${r.status}`);
      }
    } catch(e) {
      failed++;
      console.error(`refresh error for "${name}":`, e.message);
    }
  }

  console.log(`COMPANY REFRESH DONE: ${refreshed} refreshed, ${skipped} skipped, ${failed} failed`);
  return res.json({ ok: true, refreshed, skipped, failed, results });
}
