// Company deduplication logic — imported by refresh-jobs on Sundays
const ALIASES = {
  'aws': 'Amazon', 'amazon web services': 'Amazon', 'amazon.com': 'Amazon',
  'amazon fresh': 'Amazon', 'amazon logistics': 'Amazon', 'whole foods': 'Amazon',
  'whole foods market': 'Amazon', 'zappos': 'Amazon', 'ring': 'Amazon', 'twitch': 'Amazon',
  'facebook': 'Meta', 'instagram': 'Meta', 'whatsapp': 'Meta', 'meta platforms': 'Meta',
  'alphabet': 'Google', 'alphabet inc': 'Google', 'google llc': 'Google', 'youtube': 'Google',
  'deepmind': 'Google', 'waymo': 'Google',
  'microsoft corp': 'Microsoft', 'microsoft corporation': 'Microsoft',
  'apple inc': 'Apple', 'jpmorgan chase': 'JPMorgan', 'jp morgan': 'JPMorgan',
  'goldman sachs group': 'Goldman Sachs', 'bank of america corp': 'Bank of America',
  'wells fargo bank': 'Wells Fargo', 'unitedhealth group': 'UnitedHealth',
  'cvs pharmacy': 'CVS Health', 'cvs caremark': 'CVS Health',
  'deloitte llp': 'Deloitte', 'deloitte consulting': 'Deloitte',
  'walmart inc': 'Walmart', 'wal-mart': 'Walmart', 'target corporation': 'Target',
  'costco wholesale': 'Costco', 'salesforce inc': 'Salesforce', 'salesforce.com': 'Salesforce',
  'slack': 'Salesforce', 'tableau': 'Salesforce',
  'ibm corporation': 'IBM', 'oracle corporation': 'Oracle',
  'tesla inc': 'Tesla', 'spacex': 'SpaceX',
  'netflix inc': 'Netflix', 'uber technologies': 'Uber', 'lyft inc': 'Lyft',
  "mcdonald's corporation": "McDonald's", 'mcdonalds': "McDonald's",
  'starbucks corporation': 'Starbucks', 'instacart': 'Instacart',
  'openai': 'OpenAI', 'airbnb inc': 'Airbnb', 'shopify inc': 'Shopify',
};
const SFXRE = /[\s,]+(inc\.?|llc\.?|corp\.?|ltd\.?|co\.|plc\.?|group|holdings|enterprises|solutions|technologies)\.?$/i;

function normalize(raw) {
  if (!raw) return '';
  const k = raw.toLowerCase().trim();
  if (ALIASES[k]) return ALIASES[k];
  const k2 = k.replace(SFXRE, '').trim();
  return ALIASES[k2] || raw.trim();
}

export async function mergeCompanies(supabaseUrl, serviceKey) {
  const h = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  };

  const coRes = await fetch(
    `${supabaseUrl}/rest/v1/companies?select=id,name,created_at&order=created_at.asc&limit=2000`,
    { headers: h }
  );
  if (!coRes.ok) return { ok: false };
  const companies = await coRes.json();

  const groups = {};
  for (const c of companies) {
    const canon = normalize(c.name);
    if (!groups[canon]) groups[canon] = [];
    groups[canon].push(c);
  }

  let deleted = 0;
  for (const [canon, group] of Object.entries(groups)) {
    if (group.length <= 1) {
      const only = group[0];
      if (only.name !== canon && ALIASES[only.name.toLowerCase().trim()]) {
        await fetch(`${supabaseUrl}/rest/v1/companies?id=eq.${only.id}`, {
          method: 'PATCH', headers: h, body: JSON.stringify({ name: canon }),
        });
      }
      continue;
    }
    const primary = group.find(c => c.name === canon) || group[0];
    const duplicates = group.filter(c => c.id !== primary.id);
    for (const dup of duplicates) {
      await fetch(`${supabaseUrl}/rest/v1/reports?company_id=eq.${dup.id}`, {
        method: 'PATCH', headers: h, body: JSON.stringify({ company_id: primary.id }),
      });
      await fetch(`${supabaseUrl}/rest/v1/company_locations?company_id=eq.${dup.id}`, {
        method: 'PATCH', headers: h, body: JSON.stringify({ company_id: primary.id }),
      });
      await fetch(`${supabaseUrl}/rest/v1/companies?id=eq.${dup.id}`, {
        method: 'DELETE', headers: h,
      });
      deleted++;
    }
    if (primary.name !== canon) {
      await fetch(`${supabaseUrl}/rest/v1/companies?id=eq.${primary.id}`, {
        method: 'PATCH', headers: h, body: JSON.stringify({ name: canon }),
      });
    }
  }
  console.log(`COMPANY MERGE: ${deleted} duplicates removed`);
  return { ok: true, deleted };
}
