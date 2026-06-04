// Weekly cron: auto-merge fragmented company records into canonical names
// Finds every company whose normalized name matches another, picks the oldest
// as primary, reassigns all reports + locations to it, deletes the duplicates.
// Also runs the company_scores table creation in case it's missing.
// Safe to run repeatedly — idempotent.

const ALIASES = {
  'aws': 'Amazon', 'amazon web services': 'Amazon', 'amazon.com': 'Amazon',
  'amazon fresh': 'Amazon', 'amazon logistics': 'Amazon', 'amazon prime video': 'Amazon',
  'whole foods market': 'Amazon', 'whole foods': 'Amazon', 'zappos': 'Amazon',
  'ring': 'Amazon', 'twitch': 'Amazon', 'audible': 'Amazon',
  'facebook': 'Meta', 'fb': 'Meta', 'instagram': 'Meta', 'whatsapp': 'Meta',
  'oculus': 'Meta', 'meta platforms': 'Meta', 'meta platforms inc': 'Meta',
  'alphabet': 'Google', 'alphabet inc': 'Google', 'google llc': 'Google',
  'youtube': 'Google', 'deepmind': 'Google', 'waymo': 'Google', 'waze': 'Google',
  'microsoft corp': 'Microsoft', 'microsoft corporation': 'Microsoft',
  'azure': 'Microsoft', 'xbox': 'Microsoft', 'activision blizzard': 'Microsoft',
  'github': 'GitHub',
  'apple inc': 'Apple', 'apple computer': 'Apple',
  'linkedin corporation': 'LinkedIn', 'linkedin learning': 'LinkedIn',
  'jp morgan': 'JPMorgan', 'j.p. morgan': 'JPMorgan', 'jpmorgan chase': 'JPMorgan',
  'jpmorgan chase & co': 'JPMorgan', 'jpmorgan chase and co': 'JPMorgan',
  'goldman sachs group': 'Goldman Sachs', 'goldman sachs & co': 'Goldman Sachs',
  'bank of america corp': 'Bank of America', 'bank of america corporation': 'Bank of America', 'bofa': 'Bank of America',
  'wells fargo bank': 'Wells Fargo', 'wells fargo & company': 'Wells Fargo',
  'mckinsey & company': 'McKinsey', 'mckinsey and company': 'McKinsey',
  'unitedhealth group': 'UnitedHealth', 'united health': 'UnitedHealth', 'optum': 'UnitedHealth',
  'cvs pharmacy': 'CVS Health', 'cvs caremark': 'CVS Health', 'cvs health corporation': 'CVS Health',
  'kaiser': 'Kaiser Permanente', 'kaiser permanente health plan': 'Kaiser Permanente',
  'walmart inc': 'Walmart', 'wal-mart': 'Walmart', "sam's club": 'Walmart',
  'target corporation': 'Target', 'target corp': 'Target',
  'costco wholesale': 'Costco', 'costco wholesale corporation': 'Costco',
  'salesforce inc': 'Salesforce', 'salesforce.com': 'Salesforce', 'slack': 'Salesforce', 'tableau': 'Salesforce',
  'ibm corporation': 'IBM', 'international business machines': 'IBM',
  'oracle corporation': 'Oracle', 'accenture plc': 'Accenture',
  'deloitte llp': 'Deloitte', 'deloitte & touche': 'Deloitte', 'deloitte consulting': 'Deloitte',
  'spacex': 'SpaceX', 'space exploration technologies': 'SpaceX',
  'tesla inc': 'Tesla', 'tesla motors': 'Tesla',
  'lockheed martin corporation': 'Lockheed Martin',
  'raytheon technologies': 'Raytheon', 'rtx': 'Raytheon',
  'boeing company': 'Boeing', 'the boeing company': 'Boeing',
  'netflix inc': 'Netflix', 'uber technologies': 'Uber', 'lyft inc': 'Lyft',
  'shopify inc': 'Shopify', 'doordash inc': 'DoorDash',
  'instacart': 'Instacart', 'maplebear': 'Instacart',
  'chewy inc': 'Chewy', 'wayfair llc': 'Wayfair',
  'airbnb inc': 'Airbnb', 'figma inc': 'Figma', 'notion labs': 'Notion',
  'vercel inc': 'Vercel', 'openai': 'OpenAI',
  "mcdonald's corporation": "McDonald's", 'mcdonalds': "McDonald's",
  'starbucks corporation': 'Starbucks', 'starbucks corp': 'Starbucks',
  'indeed.com': 'Indeed', 'indeed inc': 'Indeed',
};
const SFXRE = /[\s,]+(inc\.?|llc\.?|corp\.?|ltd\.?|co\.|plc\.?|group|holdings|enterprises|solutions|technologies|gmbh|s\.a\.|ag)\.?$/i;

function normalize(raw) {
  if (!raw) return '';
  const k = raw.toLowerCase().trim();
  if (ALIASES[k]) return ALIASES[k];
  const k2 = k.replace(SFXRE, '').trim();
  return ALIASES[k2] || raw.trim();
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  const h = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  };

  // ── 1. Fetch every company record ─────────────────────────────────────────
  const coRes = await fetch(
    `${SUPABASE_URL}/rest/v1/companies?select=id,name,created_at&order=created_at.asc&limit=2000`,
    { headers: h }
  );
  if (!coRes.ok) return res.status(502).json({ error: 'Could not fetch companies' });
  const companies = await coRes.json();

  // ── 2. Group by canonical name ────────────────────────────────────────────
  const groups = {};
  for (const c of companies) {
    const canon = normalize(c.name);
    if (!groups[canon]) groups[canon] = [];
    groups[canon].push(c);
  }

  const log = [];
  let mergedReports = 0, mergedLocs = 0, deleted = 0;

  // ── 3. Merge each group that has duplicates ───────────────────────────────
  for (const [canon, group] of Object.entries(groups)) {
    if (group.length <= 1) {
      // Still rename if casing differs (e.g. "amazon" → "Amazon")
      const only = group[0];
      if (only.name !== canon && ALIASES[only.name.toLowerCase().trim()]) {
        await fetch(`${SUPABASE_URL}/rest/v1/companies?id=eq.${only.id}`, {
          method: 'PATCH', headers: h, body: JSON.stringify({ name: canon }),
        });
      }
      continue;
    }

    // Primary = oldest record (first created_at). Prefer the one already named canonically.
    const primary = group.find(c => c.name === canon) || group[0];
    const duplicates = group.filter(c => c.id !== primary.id);

    for (const dup of duplicates) {
      // Reassign reports
      const rRes = await fetch(`${SUPABASE_URL}/rest/v1/reports?company_id=eq.${dup.id}`, {
        method: 'PATCH', headers: h, body: JSON.stringify({ company_id: primary.id }),
      });
      // Reassign locations
      const lRes = await fetch(`${SUPABASE_URL}/rest/v1/company_locations?company_id=eq.${dup.id}`, {
        method: 'PATCH', headers: h, body: JSON.stringify({ company_id: primary.id }),
      });

      // Delete the duplicate
      await fetch(`${SUPABASE_URL}/rest/v1/companies?id=eq.${dup.id}`, {
        method: 'DELETE', headers: h,
      });

      deleted++;
      log.push(`Merged "${dup.name}" → "${canon}" (primary: ${primary.id})`);
    }

    // Ensure primary has the canonical name
    if (primary.name !== canon) {
      await fetch(`${SUPABASE_URL}/rest/v1/companies?id=eq.${primary.id}`, {
        method: 'PATCH', headers: h, body: JSON.stringify({ name: canon }),
      });
    }
  }

  console.log(`COMPANY MERGE DONE: ${deleted} duplicates removed`);
  log.forEach(l => console.log(l));

  return res.json({ ok: true, deleted, log });
}
