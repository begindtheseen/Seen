// Server-side report submission — uses service key to bypass RLS on
// the companies table (anon/user key can't INSERT there).
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end('Method not allowed');

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'DB not configured' });
  }

  let body = req.body;
  if (typeof body === 'string') try { body = JSON.parse(body); } catch(e) { body = {}; }
  const { company, role, location, platform, outcome, ghost_stage, rounds, unpaid_work, experience_level, report_text } = body || {};
  if (!company || !role || !location) {
    return res.status(400).json({ error: 'company, role and location required' });
  }

  const hdrs = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };

  const safeCo = company.trim().slice(0, 200);
  const safeLoc = location.trim().slice(0, 200);

  try {
    // ── 1. Find or create company ─────────────────────────────────────────────
    const coWord = encodeURIComponent(safeCo.split(/\s+/)[0]);
    const coSearch = await fetch(
      `${SUPABASE_URL}/rest/v1/companies?name=ilike.*${coWord}*&select=id,name&limit=20`,
      { headers: hdrs }
    );
    const coRows = coSearch.ok ? await coSearch.json() : [];

    const normalize = n => {
      if (!n) return '';
      return n.trim().toLowerCase().replace(/[\s,]+(inc\.?|llc\.?|corp\.?|ltd\.?|co\.|plc\.?|group|holdings|enterprises|solutions|technologies)\.?$/i, '').trim();
    };
    const coNorm = normalize(safeCo);

    let cid = (coRows || []).find(c => normalize(c.name) === coNorm)?.id
           || (coRows || []).find(c => c.name.toLowerCase() === safeCo.toLowerCase())?.id
           || null;

    if (!cid) {
      const insRes = await fetch(`${SUPABASE_URL}/rest/v1/companies`, {
        method: 'POST',
        headers: hdrs,
        body: JSON.stringify({ name: safeCo, logo_letter: safeCo[0]?.toUpperCase() || '?' }),
      });
      if (insRes.ok) {
        const insRows = await insRes.json();
        cid = Array.isArray(insRows) ? insRows[0]?.id : insRows?.id;
      }
      if (!cid) {
        // Unique constraint fired — company already exists, fetch it
        const retry = await fetch(
          `${SUPABASE_URL}/rest/v1/companies?name=ilike.${encodeURIComponent(safeCo)}&select=id&limit=1`,
          { headers: hdrs }
        );
        if (retry.ok) {
          const retryRows = await retry.json();
          cid = retryRows?.[0]?.id || null;
        }
      }
    }

    if (!cid) {
      console.error('submit-report: could not find or create company:', safeCo);
      return res.status(500).json({ error: 'Could not resolve company record' });
    }

    // ── 2. Find or create location ────────────────────────────────────────────
    const locCity = encodeURIComponent(safeLoc);
    const locSearch = await fetch(
      `${SUPABASE_URL}/rest/v1/company_locations?company_id=eq.${cid}&city=ilike.${locCity}&select=id&limit=1`,
      { headers: hdrs }
    );
    const locRows = locSearch.ok ? await locSearch.json() : [];
    let lid = locRows?.[0]?.id || null;

    if (!lid) {
      const locIns = await fetch(`${SUPABASE_URL}/rest/v1/company_locations`, {
        method: 'POST',
        headers: hdrs,
        body: JSON.stringify({ company_id: cid, city: safeLoc }),
      });
      if (locIns.ok) {
        const locInsRows = await locIns.json();
        lid = Array.isArray(locInsRows) ? locInsRows[0]?.id : locInsRows?.id;
      }
      if (!lid) {
        const locRetry = await fetch(
          `${SUPABASE_URL}/rest/v1/company_locations?company_id=eq.${cid}&select=id&limit=1`,
          { headers: hdrs }
        );
        if (locRetry.ok) {
          const lr = await locRetry.json();
          lid = lr?.[0]?.id || null;
        }
      }
    }

    // ── 3. Insert report ──────────────────────────────────────────────────────
    const reportBase = {
      company_id: cid,
      location_id: lid || null,
      role: (role || '').trim().slice(0, 200),
      platform: (platform || '').trim().slice(0, 100),
      outcome: outcome || 'waiting',
      ghost_stage: ghost_stage || null,
      rounds: parseInt(rounds) || 0,
      wait_days: null,
      unpaid_work: unpaid_work || 'na',
      experience_level: (experience_level || '').trim().slice(0, 50),
      report_text: report_text ? report_text.slice(0, 2000) : null,
      source: 'direct',
      needs_review: false,
    };

    // Try with company_name first; fall back without it if column doesn't exist yet
    let repRes = await fetch(`${SUPABASE_URL}/rest/v1/reports`, {
      method: 'POST',
      headers: { ...hdrs, Prefer: 'return=minimal' },
      body: JSON.stringify({ ...reportBase, company_name: safeCo }),
    });
    if (!repRes.ok && repRes.status === 400) {
      const errText = await repRes.text();
      if (errText.includes('company_name') || errText.includes('column')) {
        console.warn('submit-report: company_name column missing, retrying without it');
        repRes = await fetch(`${SUPABASE_URL}/rest/v1/reports`, {
          method: 'POST',
          headers: { ...hdrs, Prefer: 'return=minimal' },
          body: JSON.stringify(reportBase),
        });
      }
    }

    if (!repRes.ok) {
      const errText = await repRes.text();
      console.error('submit-report insert failed:', repRes.status, errText.slice(0, 200));
      return res.status(500).json({ error: 'Failed to save report', detail: errText.slice(0, 100) });
    }

    console.log(`REPORT SAVED: "${safeCo}" @ "${safeLoc}" company_id:${cid}`);
    return res.status(200).json({ ok: true, company_id: cid });

  } catch(e) {
    console.error('submit-report error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
