// Server-side reports fetch — uses service key to bypass RLS.
// Queries by company_name column directly — no company table join needed.
export default async function handler(req, res) {
  const _o=req.headers.origin||'';
  const _devO=!_o||_o.includes('localhost')||_o.includes('127.0.0.1');
  res.setHeader('Access-Control-Allow-Origin',(_devO||['https://seenjobs.io','https://www.seenjobs.io'].includes(_o))?(_o||'*'):'https://seenjobs.io');
  res.setHeader('Vary','Origin');
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
  body = body || {};

  const hdrsBase = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };

  // ── Moderation (merged from moderate-report.js) ─────────────────────────────
  if (body.action === 'moderate') {
    const { company: mCo, role: mRole, location: mLoc, experience: mExp } = body;
    if (!mCo || !mRole) return res.status(400).json({ ok: false, issues: ['Company and role are required.'] });
    const [locResult, modResult] = await Promise.all([
      checkLocation(mLoc).catch(() => ({ valid: true, normalized: mLoc })),
      moderateContent(mCo, mRole, mExp).catch(() => ({ ok: true, issues: [], corrected_experience: null })),
    ]);
    const issues = [
      ...(!locResult.valid ? ['Location not recognized — enter a real city (e.g. "Austin, TX" or "Chicago, IL").'] : []),
      ...(modResult.issues || []),
    ];
    return res.json({ ok: locResult.valid && modResult.ok, issues, corrected_experience: modResult.corrected_experience || null, normalized_location: locResult.normalized || mLoc });
  }

  // ── Community feed — Seen reports + Reddit aggregation ──────────────────────
  if (body.action === 'feed') {
    const { outcome, offset = 0, limit = 20 } = body;
    const safeLimit = Math.min(50, Math.max(1, parseInt(limit) || 20));
    const safeOffset = Math.max(0, parseInt(offset) || 0);

    const outcomeMap = {
      ghosted:      ['ghosted'],
      rejected:     ['autoreject', 'rejected'],
      interviewing: ['human', 'interview', 'interviewing'],
      hired:        ['hired', 'offer'],
    };
    const outcomes = outcomeMap[outcome] || null;

    // ── Fetch Seen reports ──────────────────────────────────────────────────
    const seenPromise = (async () => {
      let url = `${SUPABASE_URL}/rest/v1/reports`
        + `?select=id,role,outcome,ghost_stage,rounds,report_text,platform,created_at,experience_level,company_name`
        + `&order=created_at.desc&limit=100`;
      if (outcomes) url += `&outcome=in.(${outcomes.join(',')})`;
      const r = await fetch(url, { headers: hdrsBase });
      if (!r.ok) return [];
      const rows = await r.json();
      return (rows || []).map(r => ({
        id: `seen-${r.id}`,
        source: 'seen',
        company_name: r.company_name || '',
        role: r.role || '',
        outcome: r.outcome || 'waiting',
        ghost_stage: r.ghost_stage || null,
        rounds: r.rounds || 0,
        report_text: r.report_text || '',
        platform: r.platform || '',
        experience_level: r.experience_level || '',
        created_at: r.created_at,
        url: null,
        subreddit: null,
      }));
    })().catch(() => []);

    // ── Fetch Reddit posts ──────────────────────────────────────────────────
    // Subreddits: recruitinghell (ghosting/rejections), cscareerquestions (tech), jobs (general)
    const redditHeaders = {
      'User-Agent': 'Seen/1.0 (seenjobs.io; community feed aggregator)',
      'Accept': 'application/json',
    };

    // Query terms matched to outcome filter
    const redditQuery = {
      ghosted:      'ghosted OR "no response" OR "never heard back" OR "complete silence"',
      rejected:     'rejected OR rejection OR "turned down" OR "didn\'t get"',
      interviewing: 'interview OR "phone screen" OR "technical round" OR "got an interview"',
      hired:        'offer OR hired OR "got the job" OR "accepted offer" OR "start date"',
      all:          'ghosted OR rejected OR interview OR offer OR hired OR "job application"',
    }[outcome || 'all'];

    const subs = outcome === 'ghosted' || outcome === 'rejected'
      ? ['recruitinghell', 'jobs', 'cscareerquestions']
      : outcome === 'interviewing' || outcome === 'hired'
      ? ['cscareerquestions', 'interviews', 'jobs']
      : ['recruitinghell', 'cscareerquestions', 'jobs'];

    const redditPromises = subs.map(sub =>
      fetch(
        `https://www.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(redditQuery)}&sort=new&restrict_sr=1&limit=50&t=month`,
        { headers: redditHeaders, signal: AbortSignal.timeout(8000) }
      )
      .then(r => r.ok ? r.json() : null)
      .then(d => (d?.data?.children || []).map(c => c.data).filter(p => p && !p.stickied && p.selftext && p.selftext.length > 80))
      .catch(() => [])
    );

    const classifyOutcome = (title, text) => {
      const t = (title + ' ' + text).toLowerCase();
      if (/ghosted|no response|never heard|complete silence|heard nothing|disappeared|radio silence/.test(t)) return 'ghosted';
      if (/rejected|rejection|turned down|didn.t get|not moving forward|not selected|position.*filled/.test(t)) return 'autoreject';
      if (/got.*offer|accepted.*offer|start date|hired|got the job|signed|onboarding/.test(t)) return 'hired';
      if (/interview|phone screen|technical|coding round|final round|offer stage/.test(t)) return 'human';
      return null;
    };

    const extractCompany = (title, text) => {
      // Look for "at [Company]" or "[Company] ghosted" patterns
      const patterns = [
        /(?:at|from|with|by)\s+([A-Z][A-Za-z0-9&\s.,']+?)(?:\s+(?:ghosted|rejected|interview|offer|hiring|HR|recruiter|job|position|role))/,
        /^([A-Z][A-Za-z0-9&\s.,]+?)\s+(?:ghosted|rejected|offered|hired)/,
      ];
      for (const p of patterns) {
        const m = title.match(p);
        if (m?.[1] && m[1].trim().length < 60) return m[1].trim();
      }
      return '';
    };

    const [seenReports, ...redditResults] = await Promise.all([seenPromise, ...redditPromises]);

    const redditPosts = redditResults.flat().map(p => {
      const detectedOutcome = classifyOutcome(p.title, p.selftext);
      if (outcomes && detectedOutcome && !outcomes.includes(detectedOutcome)) return null;
      if (!detectedOutcome && outcomes) return null;
      return {
        id: `reddit-${p.id}`,
        source: 'reddit',
        company_name: extractCompany(p.title, p.selftext),
        role: '',
        outcome: detectedOutcome || 'waiting',
        ghost_stage: null,
        rounds: 0,
        report_text: p.title + (p.selftext ? '\n\n' + p.selftext.slice(0, 400) : ''),
        platform: `r/${p.subreddit}`,
        experience_level: '',
        created_at: new Date(p.created_utc * 1000).toISOString(),
        url: `https://reddit.com${p.permalink}`,
        subreddit: p.subreddit,
        ups: p.ups || 0,
      };
    }).filter(Boolean);

    // Merge: interleave Seen + Reddit, sorted by date, then paginate
    const all = [...seenReports, ...redditPosts].sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );
    const page = all.slice(safeOffset, safeOffset + safeLimit);

    return res.status(200).json({ ok: true, reports: page, total: all.length });
  }

  // ── Submit report (merged from submit-report.js) ────────────────────────────
  if (body.action === 'submit') {
    const { company: co, role, location, platform, outcome, ghost_stage, rounds, unpaid_work, experience_level, report_text } = body;
    if (!co || !role || !location) return res.status(400).json({ error: 'company, role and location required' });
    const hdrs = { ...hdrsBase, Prefer: 'return=representation' };
    const safeCo = co.trim().slice(0, 200);
    const safeLoc = location.trim().slice(0, 200);
    const normalize = n => n ? n.trim().toLowerCase().replace(/[\s,]+(inc\.?|llc\.?|corp\.?|ltd\.?|co\.|plc\.?|group|holdings|enterprises|solutions|technologies)\.?$/i, '').trim() : '';
    const coNorm = normalize(safeCo);

    const coWord = encodeURIComponent(safeCo.split(/\s+/)[0]);
    const coSearch = await fetch(`${SUPABASE_URL}/rest/v1/companies?name=ilike.*${coWord}*&select=id,name&limit=20`, { headers: hdrs });
    const coRows = coSearch.ok ? await coSearch.json() : [];
    let cid = (coRows || []).find(c => normalize(c.name) === coNorm)?.id || (coRows || []).find(c => c.name.toLowerCase() === safeCo.toLowerCase())?.id || null;

    if (!cid) {
      const insRes = await fetch(`${SUPABASE_URL}/rest/v1/companies`, { method: 'POST', headers: hdrs, body: JSON.stringify({ name: safeCo, logo_letter: safeCo[0]?.toUpperCase() || '?' }) });
      if (insRes.ok) { const insRows = await insRes.json(); cid = Array.isArray(insRows) ? insRows[0]?.id : insRows?.id; }
      if (!cid) {
        const retry = await fetch(`${SUPABASE_URL}/rest/v1/companies?name=ilike.${encodeURIComponent(safeCo)}&select=id&limit=1`, { headers: hdrs });
        if (retry.ok) { const r = await retry.json(); cid = r?.[0]?.id || null; }
      }
    }
    if (!cid) return res.status(500).json({ error: 'Could not resolve company record' });

    const locSearch = await fetch(`${SUPABASE_URL}/rest/v1/company_locations?company_id=eq.${cid}&city=ilike.${encodeURIComponent(safeLoc)}&select=id&limit=1`, { headers: hdrs });
    const locRows = locSearch.ok ? await locSearch.json() : [];
    let lid = locRows?.[0]?.id || null;
    if (!lid) {
      const locIns = await fetch(`${SUPABASE_URL}/rest/v1/company_locations`, { method: 'POST', headers: hdrs, body: JSON.stringify({ company_id: cid, city: safeLoc }) });
      if (locIns.ok) { const lr = await locIns.json(); lid = Array.isArray(lr) ? lr[0]?.id : lr?.id; }
      if (!lid) { const lr2 = await fetch(`${SUPABASE_URL}/rest/v1/company_locations?company_id=eq.${cid}&select=id&limit=1`, { headers: hdrs }); if (lr2.ok) { const r2 = await lr2.json(); lid = r2?.[0]?.id || null; } }
    }

    const reportBase = { company_id: cid, location_id: lid || null, role: (role||'').trim().slice(0,200), platform: (platform||'').trim().slice(0,100), outcome: outcome||'waiting', ghost_stage: ghost_stage||null, rounds: parseInt(rounds)||0, wait_days: null, unpaid_work: unpaid_work||'na', experience_level: (experience_level||'').trim().slice(0,50), report_text: report_text ? report_text.slice(0,2000) : null, source: 'direct', needs_review: false };
    let repRes = await fetch(`${SUPABASE_URL}/rest/v1/reports`, { method: 'POST', headers: { ...hdrs, Prefer: 'return=minimal' }, body: JSON.stringify({ ...reportBase, company_name: safeCo }) });
    if (!repRes.ok && repRes.status === 400) {
      const errText = await repRes.text();
      if (errText.includes('company_name') || errText.includes('column')) repRes = await fetch(`${SUPABASE_URL}/rest/v1/reports`, { method: 'POST', headers: { ...hdrs, Prefer: 'return=minimal' }, body: JSON.stringify(reportBase) });
    }
    if (!repRes.ok) { const e = await repRes.text(); return res.status(500).json({ error: 'Failed to save report', detail: e.slice(0,100) }); }
    console.log(`REPORT SAVED: "${safeCo}" @ "${safeLoc}" company_id:${cid}`);
    return res.status(200).json({ ok: true, company_id: cid });
  }

  // ── Fetch reports ───────────────────────────────────────────────────────────
  const { company, city } = body;
  if (!company) return res.status(400).json({ error: 'company required' });

  const hdrs = hdrsBase;

  // Normalize: strip legal suffixes, lowercase for matching
  const normalize = n => n ? n.trim().toLowerCase()
    .replace(/[\s,]+(inc\.?|llc\.?|corp\.?|ltd\.?|co\.|plc\.?|group|holdings|enterprises|solutions|technologies)\.?$/i, '')
    .trim() : '';

  const canonical = normalize(company.trim());
  const firstWord = canonical.split(/\s+/)[0];

  console.log(`REPORTS: company="${company}" canonical="${canonical}"`);

  try {
    // ── Query reports directly by company_name (no FK join) ───────────────────
    // Use first significant word so "Towne Park LLC" matches "Towne Park"
    const nameEnc = encodeURIComponent(`*${firstWord}*`);
    const url = `${SUPABASE_URL}/rest/v1/reports`
      + `?company_name=ilike.${nameEnc}`
      + `&select=id,role,outcome,ghost_stage,rounds,report_text,platform,created_at,experience_level,location_id,company_name,company_id`
      + `&order=created_at.desc`
      + `&limit=100`;

    console.log(`REPORTS: fetching URL: ${url.replace(SUPABASE_URL, '[URL]')}`);

    const rRes = await fetch(url, { headers: hdrs });

    if (!rRes.ok) {
      const err = await rRes.text();
      console.error(`REPORTS: fetch failed ${rRes.status}:`, err.slice(0, 300));

      // Fallback: try querying by company_id if company_name column doesn't exist yet
      const cosRes = await fetch(
        `${SUPABASE_URL}/rest/v1/companies?name=ilike.${nameEnc}&select=id,name&limit=20`,
        { headers: hdrs }
      );
      if (!cosRes.ok) {
        return res.status(200).json({ ok: true, reports: [], cities: [], _debug: `fetch failed: ${rRes.status}` });
      }
      const cosRows = await cosRes.json();
      const ids = (cosRows || [])
        .filter(c => normalize(c.name) === canonical || c.name.toLowerCase().includes(canonical))
        .map(c => c.id).filter(Boolean);

      if (!ids.length) {
        return res.status(200).json({ ok: true, reports: [], cities: [], _debug: 'no company found' });
      }

      const fbUrl = `${SUPABASE_URL}/rest/v1/reports`
        + `?company_id=in.(${ids.join(',')})`
        + `&select=id,role,outcome,ghost_stage,rounds,report_text,platform,created_at,experience_level,location_id,company_id`
        + `&order=created_at.desc&limit=100`;
      const fbRes = await fetch(fbUrl, { headers: hdrs });
      const fbRows = fbRes.ok ? await fbRes.json() : [];
      console.log(`REPORTS: fallback company_id query got ${fbRows?.length || 0} rows`);
      return buildResponse(res, fbRows, hdrs, SUPABASE_URL, city);
    }

    const rows = await rRes.json();
    console.log(`REPORTS: company_name query got ${rows?.length || 0} rows`);

    // Also get any older reports that have company_id but no company_name
    // by doing a secondary company_id-based lookup and merging
    const cosRes2 = await fetch(
      `${SUPABASE_URL}/rest/v1/companies?name=ilike.${nameEnc}&select=id,name&limit=20`,
      { headers: hdrs }
    );
    let extraRows = [];
    if (cosRes2.ok) {
      const cosRows2 = await cosRes2.json();
      const ids2 = (cosRows2 || [])
        .filter(c => normalize(c.name) === canonical || c.name.toLowerCase().includes(canonical))
        .map(c => c.id).filter(Boolean);
      if (ids2.length) {
        const knownIds = new Set((rows || []).map(r => r.id));
        const fbUrl2 = `${SUPABASE_URL}/rest/v1/reports`
          + `?company_id=in.(${ids2.join(',')})`
          + `&select=id,role,outcome,ghost_stage,rounds,report_text,platform,created_at,experience_level,location_id,company_id`
          + `&order=created_at.desc&limit=100`;
        const fb2 = await fetch(fbUrl2, { headers: hdrs });
        if (fb2.ok) {
          const fb2Rows = await fb2.json();
          extraRows = (fb2Rows || []).filter(r => !knownIds.has(r.id));
          if (extraRows.length) console.log(`REPORTS: merged ${extraRows.length} older company_id-only rows`);
        }
      }
    }

    return buildResponse(res, [...(rows || []), ...extraRows], hdrs, SUPABASE_URL, city);

  } catch(e) {
    console.error('REPORTS error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}

// ── Moderation helpers ────────────────────────────────────────────────────────

async function checkLocation(location) {
  if (!location || location.trim().length < 3) return { valid: false, normalized: null };
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(location)}&limit=1&addressdetails=1`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Seen/1.0 (seenjobs.io)' }, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return { valid: true, normalized: location };
    const places = await res.json();
    if (!places?.length) return { valid: false, normalized: null };
    const addr = places[0].address || {};
    const city  = addr.city || addr.town || addr.village || addr.municipality || addr.county || '';
    const state = addr.state || '';
    return { valid: true, normalized: city && state ? `${city}, ${state}` : city || state || location };
  } catch(e) {
    return { valid: true, normalized: location };
  }
}

async function moderateContent(company, role, experience) {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
  if (!ANTHROPIC_KEY) return { ok: true, issues: [], corrected_experience: null };
  const exp = (experience || '').trim();
  const prompt = `You moderate reports on a job-application transparency platform. Review this submission:\n\nCompany: "${company}"\nJob title: "${role}"\nExperience: "${exp || '(not provided)'}"\n\nFlag ANY of the following — be strict:\n1. Profanity or slurs (even mild)\n2. Hate speech or discrimination\n3. Personal attacks on named individuals\n4. Doxxing or private information\n5. Obviously fake content (gibberish, keyboard mashing, lorem ipsum)\n6. Job title that is not a real position name\n\nFor the experience text, also correct any genuine spelling mistakes (not slang or informal phrasing).\n\nReturn ONLY valid JSON, no extra text:\n{\n  "ok": true,\n  "issues": [],\n  "corrected_experience": null\n}\n\nIf there are problems set ok:false and fill issues[]. If spelling was fixed set corrected_experience to the cleaned text, otherwise null.`;
  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 400, messages: [{ role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(12000),
    });
    if (!apiRes.ok) return { ok: true, issues: [], corrected_experience: null };
    const data = await apiRes.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return { ok: true, issues: [], corrected_experience: null };
    return JSON.parse(match[0]);
  } catch(e) {
    return { ok: true, issues: [], corrected_experience: null };
  }
}

async function buildResponse(res, reports, hdrs, SUPABASE_URL, city) {
  // Fetch city names for any location_ids
  const locIds = [...new Set((reports || []).map(r => r.location_id).filter(Boolean))];
  const cityMap = {};
  if (locIds.length) {
    try {
      const locRes = await fetch(
        `${SUPABASE_URL}/rest/v1/company_locations?id=in.(${locIds.join(',')})&select=id,city&limit=100`,
        { headers: hdrs }
      );
      if (locRes.ok) {
        const locRows = await locRes.json();
        (locRows || []).forEach(l => { if (l.id && l.city) cityMap[l.id] = l.city; });
      }
    } catch(_e) {}
  }

  const enriched = (reports || []).map(r => ({
    ...r,
    city: r.location_id ? (cityMap[r.location_id] || '') : '',
  }));

  const cityFilter = city?.trim()?.toLowerCase();
  const filtered = cityFilter
    ? enriched.filter(r => !r.city || r.city.toLowerCase().includes(cityFilter))
    : enriched;

  const cities = [...new Set(enriched.map(r => r.city).filter(Boolean))].sort();

  return res.status(200).json({ ok: true, reports: filtered, cities, total: enriched.length });
}
