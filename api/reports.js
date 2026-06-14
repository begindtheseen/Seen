// Server-side reports fetch — uses service key to bypass RLS.
// Queries by company_name column directly — no company table join needed.

import { applyRateLimit } from '../lib/server/ratelimit.js';
import { logError } from '../lib/server/errlog.js';

// Industry baseline benchmarks (Greenhouse 2023, LinkedIn Talent Insights)
const INDUSTRY_BENCHMARKS = {
  ghost_rate: 0.55,
  response_rate: 0.20,
  interview_rate: 0.025,
  avg_wait_days: 21,
  avg_rounds: 2.5,
  offer_rate: 0.008,
};

export default async function handler(req, res) {
  const _o=req.headers.origin||'';
  const _devO=!_o||_o.includes('localhost')||_o.includes('127.0.0.1');
  res.setHeader('Access-Control-Allow-Origin',(_devO||['https://seenjobs.io','https://www.seenjobs.io'].includes(_o))?(_o||'*'):'https://seenjobs.io');
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET: benchmark stats (industry or company) ───────────────────────────────
  if (req.method === 'GET') {
    const limited = await applyRateLimit(req, res, 'benchmarks');
    if (limited) return;
    const { type, name, names } = req.query || {};
    if (type === 'industry') return res.status(200).json({ ok: true, benchmarks: INDUSTRY_BENCHMARKS });
    if (type === 'company' && name) {
      const stats = await fetchCompanyStats(String(name).slice(0, 100), SUPABASE_URL, { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' });
      return res.status(200).json({ ok: true, stats });
    }
    if (type === 'batch' && names) {
      const nameList = String(names).split(',').slice(0, 25).map(n => n.trim()).filter(Boolean);
      const dbH = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };
      const arr = await Promise.all(nameList.map(n => fetchCompanyStats(n, SUPABASE_URL, dbH)));
      const result = {};
      nameList.forEach((n, i) => { if (arr[i]) result[n.toLowerCase()] = arr[i]; });
      return res.status(200).json({ ok: true, stats: result });
    }
    return res.status(400).json({ error: 'type required: industry|company|batch' });
  }

  if (req.method !== 'POST') return res.status(405).end('Method not allowed');

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'DB not configured' });
  }

  let body = req.body;
  if (typeof body === 'string') try { body = JSON.parse(body); } catch(e) { body = {}; }
  body = body || {};

  // ── Company-score: merged from api/company-score.js ─────────────────────────
  if (body.action === 'company_score' || body.action === 'research' || body.action === 'resolve' || body.action === 'populate' || body.name) {
    if (await applyRateLimit(req, res, 'company-score')) return;
    return handleCompanyScore(req, res, body);
  }

  // ── Company leaderboard ───────────────────────────────────────────────────────
  if (body.action === 'leaderboard') {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return res.status(200).json({ companies: [] });
    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/company_scores?select=company_name,overall_score,ghost_rate,response_rate,avg_wait_days,waste_score,report_count,data_quality,verification_status,industry&order=report_count.desc&limit=150`,
        { headers: dbH }
      );
      if (!r.ok) return res.status(200).json({ companies: [] });
      const rows = await r.json();
      const overall = s => s || 0;
      const companies = (Array.isArray(rows) ? rows : []).map(c => ({
        name: c.company_name,
        industry: c.industry || '',
        verified: c.verification_status === 'verified',
        score: {
          overall_score: overall(c.overall_score),
          ghost_rate: c.ghost_rate || 0,
          response_rate: c.response_rate || 0,
          avg_wait_days: c.avg_wait_days || 0,
          report_count: c.report_count || 0,
          risk_level: overall(c.overall_score) >= 70 ? 'safe' : overall(c.overall_score) >= 40 ? 'warn' : 'danger',
          waste: c.waste_score || 0,
        },
      }));
      return res.status(200).json({ ok: true, companies });
    } catch(e) { return res.status(200).json({ companies: [] }); }
  }

  // Rate-limit only write actions — reads are cheap and public
  if (['submit','moderate','quick_submit','report_issue'].includes(body.action)) {
    const limited = await applyRateLimit(req, res, 'report-submit');
    if (limited) return;
  }

  // ── Quick-submit: anonymous one-click outcome from feed cards / modals ───────
  if (body.action === 'quick_submit') {
    try {
      const { company, outcome, role, city } = body;
      if (!company || !outcome) return res.status(400).json({ error: 'company and outcome required' });
      const VALID = new Set(['ghosted','rejected','autoreject','hired','offer','interview','human','waiting']);
      if (!VALID.has(outcome)) return res.status(400).json({ error: 'invalid outcome' });
      const safeCompany = String(company).slice(0, 120).replace(/[<>`\\]/g, '').trim();
      const safeRole    = role ? String(role).slice(0, 120).replace(/[<>`\\]/g, '').trim() : '';
      const safeCity    = city ? String(city).slice(0,  80).replace(/[<>`\\]/g, '').trim() : '';
      if (!safeCompany) return res.status(400).json({ error: 'company required' });
      const r = await fetch(`${SUPABASE_URL}/rest/v1/reports`, {
        method: 'POST',
        headers: { ...hdrsBase, Prefer: 'return=minimal' },
        body: JSON.stringify({ company_name: safeCompany, outcome, role: safeRole, city: safeCity, platform: 'Seen', experience_level: 'Unknown', outcome_weight: 1.0, trust_reason: 'direct_submission' }),
      });
      if (!r.ok) { const e = await r.text().catch(() => ''); console.error('quick_submit failed:', r.status, e.slice(0, 150)); return res.status(400).json({ error: 'Submit failed' }); }
      return res.status(200).json({ ok: true, submitted: true });
    } catch(err) {
      logError('reports/quick_submit', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  const hdrsBase = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };

  // ── Batch score lookup — DB-only, no AI, cached scores for up to 50 companies ──
  if (body.action === 'batch_scores') {
    try {
      const names = body.names;
      if (!Array.isArray(names) || !names.length) return res.json({ ok: true, scores: {} });
      const nameList = names.slice(0, 50).map(n => String(n).toLowerCase().trim()).filter(Boolean);
      if (!nameList.length) return res.json({ ok: true, scores: {} });
      const inFilter = nameList.map(n => `"${n}"`).join(',');
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/company_scores?company_name=in.(${inFilter})&select=company_name,overall_score,ghost_rate,response_rate,avg_wait_days,waste_score,report_count&limit=50`,
        { headers: hdrsBase }
      );
      const rows = r.ok ? await r.json() : [];
      const scores = {};
      (Array.isArray(rows) ? rows : []).forEach(row => {
        scores[row.company_name.toLowerCase()] = {
          overall_score: row.overall_score,
          ghost_rate: row.ghost_rate,
          response_rate: row.response_rate,
          avg_wait_days: row.avg_wait_days,
          waste: row.waste_score,
          report_count: row.report_count,
        };
      });
      return res.json({ ok: true, scores });
    } catch { return res.json({ ok: true, scores: {} }); }
  }

  // ── User-reported issue (wrong data, duplicate, broken listing, etc.) ─────────
  if (body.action === 'report_issue') {
    const VALID_TYPES = new Set(['wrong_data','duplicate','broken_listing','spam','other']);
    const { type, target_type, target_name, notes } = body;
    if (!type || !VALID_TYPES.has(type)) return res.status(400).json({ error: 'Invalid issue type' });
    const safeTargetType = ['company','job','feed','other'].includes(target_type) ? target_type : 'other';
    const safeName  = target_name ? String(target_name).slice(0, 200).replace(/[<>`]/g, '').trim() : null;
    const safeNotes = notes ? String(notes).slice(0, 500).replace(/[<>`]/g, '').trim() : null;
    const r = await fetch(`${SUPABASE_URL}/rest/v1/user_issues`, {
      method: 'POST',
      headers: { ...hdrsBase, Prefer: 'return=minimal' },
      body: JSON.stringify({ type, target_type: safeTargetType, target_name: safeName, notes: safeNotes }),
    });
    if (!r.ok) return res.status(500).json({ error: 'Failed to save issue' });
    return res.status(200).json({ ok: true });
  }

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

  // ── Community feed — real Seen reports only ──────────────────────────────────
  if (body.action === 'feed') {
    try {
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

      let url = `${SUPABASE_URL}/rest/v1/reports`
        + `?select=id,role,outcome,ghost_stage,rounds,report_text,platform,created_at,experience_level,company_name`
        + `&order=created_at.desc`
        + `&limit=${safeLimit}&offset=${safeOffset}`;
      if (outcomes) url += `&outcome=in.(${outcomes.join(',')})`;

      // Prefer= count to get total without a second query
      const r = await fetch(url, { headers: { ...hdrsBase, 'Prefer': 'count=estimated' } });
      if (!r.ok) { console.error('FEED: supabase error', r.status); return res.status(500).json({ error: 'feed error' }); }
      const rows = await r.json();
      const page = (rows || []).map(row => ({ ...row, source: 'seen' }));

      // Content-Range: 0-19/1234
      const contentRange = r.headers.get('content-range') || '';
      const total = parseInt(contentRange.split('/')[1]) || page.length;

      console.log(`FEED: offset=${safeOffset} page=${page.length} total=${total}`);
      return res.status(200).json({ ok: true, reports: page, total });
    } catch(e) {
      console.error('FEED: unhandled error:', e.message);
      return res.status(500).json({ error: 'feed error', detail: e.message });
    }
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

    const reportBase = { company_id: cid, location_id: lid || null, role: (role||'').trim().slice(0,200), platform: (platform||'').trim().slice(0,100), outcome: outcome||'waiting', ghost_stage: ghost_stage||null, rounds: parseInt(rounds)||0, wait_days: null, unpaid_work: unpaid_work||'na', experience_level: (experience_level||'').trim().slice(0,50), report_text: report_text ? report_text.slice(0,2000) : null, source: 'direct', needs_review: false, outcome_weight: 1.0, trust_reason: 'direct_submission' };
    let repRes = await fetch(`${SUPABASE_URL}/rest/v1/reports`, { method: 'POST', headers: { ...hdrs, Prefer: 'return=minimal' }, body: JSON.stringify({ ...reportBase, company_name: safeCo }) });
    if (!repRes.ok && repRes.status === 400) {
      const errText = await repRes.text();
      if (errText.includes('company_name') || errText.includes('column')) repRes = await fetch(`${SUPABASE_URL}/rest/v1/reports`, { method: 'POST', headers: { ...hdrs, Prefer: 'return=minimal' }, body: JSON.stringify(reportBase) });
    }
    if (!repRes.ok) { const e = await repRes.text(); return res.status(500).json({ error: 'Failed to save report', detail: e.slice(0,100) }); }
    console.log(`REPORT SAVED: "${safeCo}" @ "${safeLoc}" company_id:${cid}`);
    return res.status(200).json({ ok: true, company_id: cid });
  }

  // ── Reddit import (cron or admin panel) ──────────────────────────────────────
  // Crons are GET requests and pass subreddit as query param: /api/reports?reddit_cron=recruitinghell
  if (req.method === 'GET' && req.query.reddit_cron) {
    body = { action: 'reddit_import', subreddit: req.query.reddit_cron };
  }

  if (body.action === 'reddit_import') {
    const isCron = req.headers['x-vercel-cron'] === '1';
    if (!isCron) {
      // Validate X-Admin-Token against admin_sessions table
      const adminToken = (req.headers['x-admin-token'] || '').trim();
      if (!adminToken) return res.status(401).json({ error: 'unauthorized' });
      const sessRes = await fetch(
        `${SUPABASE_URL}/rest/v1/admin_sessions?token=eq.${encodeURIComponent(adminToken)}&select=expires_at&limit=1`,
        { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
      );
      const sess = sessRes.ok ? (await sessRes.json())?.[0] : null;
      if (!sess || new Date(sess.expires_at) < new Date()) return res.status(401).json({ error: 'unauthorized' });
    }
    const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_KEY not configured' });

    const ALL_SUBREDDITS = [
      'recruitinghell','jobs','cscareerquestions','careerguidance',
      'antiwork','AskHR','interviews','ExperiencedDevs','humanresources','WorkReform',
    ];
    const SUBREDDITS    = body.subreddit ? [body.subreddit] : ALL_SUBREDDITS.slice(0, 1);
    const REDDIT_WEIGHT = 0.3;
    const BATCH_SIZE    = 25; // companies per cron run — 10 crons/day = 250 companies/day

    // Pull companies from DB, cycling through all of them via offset.
    // Each subreddit cron run processes the next BATCH_SIZE companies.
    // With thousands of companies and 10 daily crons, full coverage cycles every few days.
    let companies;
    if (Array.isArray(body.companies)) {
      companies = body.companies;
    } else {
      // Get current offset from feature_flags, advance it for next run
      const flagKey = `reddit_offset_${body.subreddit || 'default'}`;
      const flagRes = await fetch(`${SUPABASE_URL}/rest/v1/feature_flags?flag_name=eq.${encodeURIComponent(flagKey)}&select=percentage&limit=1`, { headers: hdrsBase });
      const flagRow = flagRes.ok ? (await flagRes.json())?.[0] : null;
      const offset  = flagRow ? (Number(flagRow.percentage) || 0) : 0;

      // Fetch BATCH_SIZE companies starting at offset
      const coRes = await fetch(`${SUPABASE_URL}/rest/v1/companies?select=name&order=name.asc&limit=${BATCH_SIZE}&offset=${offset}`, { headers: hdrsBase });
      const coRows = coRes.ok ? await coRes.json() : [];
      companies = coRows.map(r => r.name).filter(Boolean);

      if (!companies.length) {
        // Wrapped around — reset offset and grab first batch
        companies = (await fetch(`${SUPABASE_URL}/rest/v1/companies?select=name&order=name.asc&limit=${BATCH_SIZE}&offset=0`, { headers: hdrsBase }).then(r => r.ok ? r.json() : [])).map(r => r.name).filter(Boolean);
        await fetch(`${SUPABASE_URL}/rest/v1/feature_flags?on_conflict=flag_name`, { method: 'POST', headers: { ...hdrsBase, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ flag_name: flagKey, status: 'off', percentage: 0, description: 'Reddit import batch offset' }) });
      } else {
        // Advance offset for next run
        const nextOffset = offset + companies.length;
        await fetch(`${SUPABASE_URL}/rest/v1/feature_flags?on_conflict=flag_name`, { method: 'POST', headers: { ...hdrsBase, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ flag_name: flagKey, status: 'off', percentage: nextOffset, description: 'Reddit import batch offset' }) });
      }

      // If still nothing, fall back to known active companies
      if (!companies.length) companies = ['Amazon','Google','Meta','Microsoft','Apple','Walmart','Target','UPS','FedEx','Deloitte'];
    }
    const dryRun         = !!body.dry_run;

    // Reddit RSS/Atom feeds — designed for programmatic consumption, not blocked like the JSON API
    function parseRedditAtom(xml, sub) {
      const posts = [];
      const entryRx = /<entry>([\s\S]*?)<\/entry>/g;
      const unescape = s => s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&#x27;/g,"'");
      let m;
      while ((m = entryRx.exec(xml)) !== null) {
        const block = m[1];
        const link  = /<link[^>]+href="([^"]+)"/.exec(block)?.[1] || '';
        const idM   = /\/comments\/([a-z0-9]+)\//i.exec(link);
        if (!idM) continue;
        const id    = `t3_${idM[1]}`;
        const title = unescape(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/.exec(block)?.[1] || '').trim().slice(0, 300);
        // content:encoded or content tag holds the post body as HTML — strip tags
        const rawBody = /<content[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/content>/i.exec(block)?.[1] || '';
        const body  = unescape(rawBody.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim().slice(0, 1200);
        posts.push({ id, title, body, subreddit: sub });
      }
      return posts;
    }

    const fetchDebug = {};
    async function redditFetch(sub) {
      const sleep = ms => new Promise(res => setTimeout(res, ms));
      const hosts = ['https://www.reddit.com', 'https://old.reddit.com'];
      const delays = [8000, 20000, 35000]; // 8s, 20s, 35s — long enough for Reddit's rate limit window to reset
      let attempt = 0;
      for (const host of hosts) {
        for (let retry = 0; retry <= 1; retry++) {
          try {
            const r = await fetch(`${host}/r/${sub}/new/.rss?limit=100`, {
              headers: { 'User-Agent': 'SeenJobs/1.0 RSS reader (+https://seenjobs.io)', Accept: 'application/rss+xml, application/atom+xml, text/xml' },
            });
            if (r.status === 429) {
              fetchDebug[sub] = { status: 429, attempt, host };
              if (attempt < delays.length) await sleep(delays[attempt++]);
              continue;
            }
            fetchDebug[sub] = { status: r.status, host, method: 'rss' };
            if (!r.ok) { fetchDebug[sub].error = `HTTP ${r.status}`; break; }
            const xml   = await r.text();
            const posts = parseRedditAtom(xml, sub);
            fetchDebug[sub].posts = posts.length;
            return posts;
          } catch(e) { fetchDebug[sub] = { error: e.message }; return []; }
        }
      }
      fetchDebug[sub] = { ...(fetchDebug[sub] || {}), error: 'rate limited on all hosts' };
      return [];
    }

    // Reddit search RSS — targeted by company name, surfaces older posts that /new misses
    async function redditSearchFetch(sub, company) {
      try {
        const q = encodeURIComponent(`"${company}"`);
        const r = await fetch(`https://www.reddit.com/r/${sub}/search/.rss?q=${q}&restrict_sr=on&sort=new&t=month&limit=25`, {
          headers: { 'User-Agent': 'SeenJobs/1.0 RSS reader (+https://seenjobs.io)', Accept: 'application/rss+xml, application/atom+xml, text/xml' },
        });
        if (!r.ok) return [];
        const xml = await r.text();
        return parseRedditAtom(xml, sub);
      } catch { return []; }
    }

    // Pullpush.io — Pushshift archive mirror, indexes Reddit posts + comments over time
    // Lets us search by company name across months of data, not just /new
    async function pullpushFetch(sub, company) {
      try {
        const q = encodeURIComponent(company);
        const [postRes, commentRes] = await Promise.all([
          fetch(`https://api.pullpush.io/reddit/search/submission/?q=${q}&subreddit=${sub}&size=25&sort=created_utc&order=desc`, {
            headers: { 'User-Agent': 'SeenJobs/1.0 (+https://seenjobs.io)' },
          }),
          fetch(`https://api.pullpush.io/reddit/search/comment/?q=${q}&subreddit=${sub}&size=50&sort=created_utc&order=desc`, {
            headers: { 'User-Agent': 'SeenJobs/1.0 (+https://seenjobs.io)' },
          }),
        ]);
        const posts    = postRes.ok    ? (await postRes.json())?.data    || [] : [];
        const comments = commentRes.ok ? (await commentRes.json())?.data || [] : [];

        // Normalise posts to our format
        const normPosts = posts.map(p => ({
          id:        `t3_${p.id}`,
          title:     (p.title    || '').slice(0, 300),
          body:      (p.selftext || '').replace(/\n{3,}/g, '\n\n').slice(0, 1200),
          subreddit: p.subreddit || sub,
          source:    'pullpush',
        }));

        // Group comments by their parent post id, attach as comment arrays
        // Comments without a known post become standalone entries with blank title
        const commentMap = {};
        for (const c of comments) {
          const pid = `t3_${c.link_id?.replace(/^t3_/, '') || c.id}`;
          if (!commentMap[pid]) commentMap[pid] = { id: pid, title: `[comment thread in r/${sub}]`, body: '', subreddit: sub, source: 'pullpush', comments: [] };
          const text = (c.body || '').replace(/\n{3,}/g, '\n\n').slice(0, 500);
          if (text && text !== '[deleted]' && text !== '[removed]') commentMap[pid].comments.push(text);
        }

        return [...normPosts, ...Object.values(commentMap).filter(e => e.comments?.length)];
      } catch { return []; }
    }

    // Fetch top comments for a single post — single-post JSON endpoints are far less restricted than subreddit browsing
    async function fetchComments(postId, sub) {
      try {
        const base = postId.replace(/^t3_/, '');
        const r = await fetch(`https://www.reddit.com/r/${sub}/comments/${base}.json?limit=20&depth=1&sort=top`, {
          headers: { 'User-Agent': 'SeenJobs/1.0 RSS reader (+https://seenjobs.io)', Accept: 'application/json' },
        });
        if (!r.ok) return [];
        const d = await r.json();
        return (d?.[1]?.data?.children || [])
          .filter(c => c.kind === 't1' && c.data?.body && c.data.body !== '[deleted]' && c.data.body !== '[removed]')
          .slice(0, 10)
          .map(c => c.data.body.slice(0, 500).replace(/\n{3,}/g, '\n\n'));
      } catch { return []; }
    }

    async function alreadyImported(ids) {
      if (!ids.length) return new Set();
      const filter = ids.map(id => `reddit_post_id.eq.${encodeURIComponent(id)}`).join(',');
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/reddit_imports?or=(${filter})&select=reddit_post_id`, { headers: hdrsBase });
        if (!r.ok) return new Set();
        return new Set((await r.json() || []).map(x => x.reddit_post_id));
      } catch { return new Set(); }
    }

    // Extract ALL hiring experiences from a batch of threads for one company.
    // Comments responding to a company thread don't need to name the company —
    // Claude infers the subject from thread context (OP establishes who, replies extend it).
    async function extractReports(posts, company) {
      if (!posts.length) return [];
      const system = `You are extracting hiring experience reports from Reddit threads. The company being analyzed is "${company}".

Rules:
- The OP establishes the company context. Comments responding to the thread are about the same company even if they don't name it.
- Extract EVERY distinct hiring experience mentioned — OP's experience AND each commenter's experience separately.
- Only skip a comment if it's clearly unrelated (meme, off-topic question, mod note).
- A comment saying "same thing happened to me, ghosted after final round" with no company name = valid report about ${company}.

For each experience return: {"outcome":"ghosted"|"rejected"|"hired"|"offer"|"interview"|"applied"|"unknown","role":string|null,"sentiment":"positive"|"negative"|"neutral"|"mixed","summary":string,"post_idx":number}
"summary" should be a 1-2 sentence description of what happened, written as if it's a review.
Return ONLY a valid JSON array. Return [] if there are genuinely no hiring experiences.`;

      const input = posts.map((p, i) =>
        `[POST ${i}] r/${p.subreddit}\nTITLE: ${p.title}\nBODY: ${p.body || '(none)'}${
          p.comments?.length
            ? `\nCOMMENTS (${p.comments.length}):\n${p.comments.map((c, ci) => `  [C${ci + 1}] ${c}`).join('\n')}`
            : ''
        }`
      ).join('\n\n===\n\n');

      try {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 2048,
            system,
            messages: [{ role: 'user', content: `Extract hiring experiences about ${company}:\n\n${input}` }],
          }),
        });
        if (!r.ok) return [];
        const d = await r.json();
        const text = (d.content?.[0]?.text || '').replace(/```json\n?/g, '').replace(/```\n?/g, '');
        const match = text.match(/\[[\s\S]*\]/);
        return match ? JSON.parse(match[0]) : [];
      } catch { return []; }
    }

    async function upsertCo(name) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/companies?name=ilike.${encodeURIComponent(name)}&select=id&limit=1`, { headers: hdrsBase });
      if (r.ok) { const rows = await r.json(); if (rows?.[0]?.id) return rows[0].id; }
      const ins = await fetch(`${SUPABASE_URL}/rest/v1/companies`, { method: 'POST', headers: { ...hdrsBase, Prefer: 'return=representation' }, body: JSON.stringify({ name }) });
      return (ins.ok ? (await ins.json())?.[0]?.id : null) || null;
    }

    const keywords = ['hiring', 'interview', 'ghosted', 'rejected', 'offer', 'recruiter', 'application', 'applied', 'onsite', 'phone screen', 'final round', 'heard back', 'never heard', 'no response', 'background check', 'offer letter', 'laid off', 'let go'];
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // Run fn on each item with at most `n` concurrent in-flight at once
    async function pMap(arr, fn, n) {
      for (let i = 0; i < arr.length; i += n) {
        await Promise.all(arr.slice(i, i + n).map(fn));
      }
    }

    // Fetch each subreddit once, fan out across companies
    const postsByCompany = {};
    for (const company of companies) postsByCompany[company] = [];

    for (const sub of SUBREDDITS) {
      // Source 1: /new RSS — catches fresh activity and implicit company mentions
      const newPosts = await redditFetch(sub);
      for (const company of companies) {
        const cl = company.toLowerCase();
        const matching = newPosts.filter(p => {
          const txt = `${p.title} ${p.body}`.toLowerCase();
          return txt.includes(cl) && keywords.some(k => txt.includes(k));
        });
        postsByCompany[company].push(...matching);
      }

      await sleep(2000);

      // Source 2: Reddit search RSS per company — 5 concurrent instead of serial+1.5s sleep
      await pMap(companies, async (company) => {
        const searchPosts = await redditSearchFetch(sub, company);
        postsByCompany[company].push(...searchPosts);
      }, 5);

      await sleep(1500);

      // Source 3: Pullpush archive — separate infra, 8 concurrent (no Reddit rate limit)
      await pMap(companies, async (company) => {
        const archivePosts = await pullpushFetch(sub, company);
        postsByCompany[company].push(...archivePosts);
      }, 8);

      await sleep(1000);
    }

    const results = {};

    // Process companies 5 at a time — parallel Claude calls + DB writes per company
    await pMap(companies, async (company) => {
      let imported = 0, skipped = 0;
      const seen_ids = new Set();
      const posts = postsByCompany[company].filter(p => { if (seen_ids.has(p.id)) return false; seen_ids.add(p.id); return true; });
      if (!posts.length) { results[company] = { imported: 0, skipped: 0, fetched: 0 }; return; }

      const seen = await alreadyImported(posts.map(p => p.id));
      const fresh = posts.filter(p => !seen.has(p.id));
      if (!fresh.length) { results[company] = { imported: 0, skipped: 0, fetched: posts.length, note: 'all_seen' }; return; }

      // Fetch comments for all fresh posts in parallel (capped at 10)
      await Promise.all(fresh.slice(0, 10).map(async post => {
        const comments = await fetchComments(post.id, post.subreddit);
        if (comments.length) post.comments = comments;
      }));

      // Extract all experiences from this company's threads in one Claude call
      const experiences = await extractReports(fresh, company);

      if (!experiences.length) {
        if (!dryRun) {
          await Promise.all(fresh.map(post =>
            fetch(`${SUPABASE_URL}/rest/v1/reddit_imports`, { method: 'POST', headers: { ...hdrsBase, Prefer: 'return=minimal' }, body: JSON.stringify({ reddit_post_id: post.id, company_name: company, subreddit: post.subreddit, skipped: true, skip_reason: 'no_experiences_extracted' }) })
          ));
        }
        results[company] = { imported: 0, skipped: fresh.length, fetched: posts.length };
        return;
      }

      if (dryRun) {
        results[company] = { imported: experiences.length, skipped: 0, fetched: posts.length, dry_run: true };
        return;
      }

      const cid = await upsertCo(company);

      // Insert all reports in parallel instead of serial loop
      const insertResults = await Promise.all(experiences.map(exp => {
        const sourcePost = fresh[exp.post_idx] || fresh[0];
        const rpt = {
          company_name: company,
          platform: `Reddit r/${sourcePost.subreddit}`,
          outcome: exp.outcome || 'unknown',
          role: exp.role || null,
          report_text: exp.summary || sourcePost.title.slice(0, 500),
          source: 'reddit',
          outcome_weight: REDDIT_WEIGHT,
          trust_reason: 'community_signal',
          needs_review: false,
          rounds: 0,
          unpaid_work: 'na',
          experience_level: 'Unknown',
        };
        if (cid) rpt.company_id = cid;
        return fetch(`${SUPABASE_URL}/rest/v1/reports`, { method: 'POST', headers: { ...hdrsBase, Prefer: 'return=representation' }, body: JSON.stringify(rpt) });
      }));
      for (const r of insertResults) { if (r.ok) imported++; else skipped++; }

      // Mark source posts as imported
      await Promise.all(fresh.map(post =>
        fetch(`${SUPABASE_URL}/rest/v1/reddit_imports`, { method: 'POST', headers: { ...hdrsBase, Prefer: 'return=minimal' }, body: JSON.stringify({ reddit_post_id: post.id, company_name: company, subreddit: post.subreddit, skipped: false, skip_reason: null }) })
      ));

      results[company] = { imported, skipped, fetched: posts.length, experiences: experiences.length };
    }, 5);

    return res.status(200).json({ ok: true, results, debug: { subreddits: fetchDebug } });
  }

  // ── n8n / external ingest webhook ────────────────────────────────────────────
  // n8n POSTs here with action:'ingest' to push data from Glassdoor, Indeed,
  // LinkedIn, Blind, or any other source n8n can reach.
  // Body: { action:'ingest', source:'glassdoor', reports:[{company,outcome,role,report_text,platform,source},...] }
  if (body.action === 'ingest') {
    const tok = (req.headers['x-admin-token'] || '').trim();
    if (!tok) return res.status(401).json({ error: 'unauthorized' });
    const s = await fetch(`${SUPABASE_URL}/rest/v1/admin_sessions?token=eq.${encodeURIComponent(tok)}&select=expires_at&limit=1`, { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } });
    const sess = s.ok ? (await s.json())?.[0] : null;
    if (!sess || new Date(sess.expires_at) < new Date()) return res.status(401).json({ error: 'unauthorized' });

    const reports = Array.isArray(body.reports) ? body.reports : [];
    if (!reports.length) return res.status(400).json({ error: 'reports array required' });

    const SOURCE_WEIGHTS = { glassdoor: 0.7, indeed: 0.6, linkedin: 0.5, blind: 0.6, trustpilot: 0.4, news: 0.3, other: 0.3 };
    const VALID_OUTCOMES = new Set(['ghosted','rejected','hired','offer','interview','applied','unknown','waiting','autoreject','human']);

    let imported = 0, skipped = 0, errors = [];
    for (const rpt of reports.slice(0, 500)) {
      try {
        if (!rpt.company || !rpt.outcome) { skipped++; continue; }
        const outcome = VALID_OUTCOMES.has(rpt.outcome) ? rpt.outcome : 'unknown';
        const src = (rpt.source || body.source || 'other').toLowerCase().split('/')[0];
        const weight = SOURCE_WEIGHTS[src] || 0.3;

        // Resolve company id
        const coR = await fetch(`${SUPABASE_URL}/rest/v1/companies?name=ilike.${encodeURIComponent(String(rpt.company).slice(0,120))}&select=id&limit=1`, { headers: hdrsBase });
        const coRows = coR.ok ? await coR.json() : [];
        let cid = coRows?.[0]?.id || null;
        if (!cid) {
          const ins = await fetch(`${SUPABASE_URL}/rest/v1/companies`, { method: 'POST', headers: { ...hdrsBase, Prefer: 'return=representation' }, body: JSON.stringify({ name: String(rpt.company).slice(0, 120) }) });
          cid = ins.ok ? (await ins.json())?.[0]?.id || null : null;
        }

        const row = {
          company_name:     String(rpt.company).slice(0, 120),
          platform:         String(rpt.platform || body.source || 'External').slice(0, 100),
          outcome,
          role:             rpt.role ? String(rpt.role).slice(0, 200) : null,
          report_text:      rpt.report_text ? String(rpt.report_text).slice(0, 2000) : null,
          source:           src,
          outcome_weight:   weight,
          trust_reason:     'external_import',
          needs_review:     true, // flag for admin review since it's external
          rounds:           Number.isInteger(rpt.rounds) ? rpt.rounds : 0,
          unpaid_work:      'na',
          experience_level: rpt.experience_level ? String(rpt.experience_level).slice(0, 50) : 'Unknown',
        };
        if (cid) row.company_id = cid;
        const ins = await fetch(`${SUPABASE_URL}/rest/v1/reports`, { method: 'POST', headers: { ...hdrsBase, Prefer: 'return=minimal' }, body: JSON.stringify(row) });
        if (ins.ok) imported++; else skipped++;
      } catch(e) { errors.push(e.message); skipped++; }
    }
    return res.status(200).json({ ok: true, imported, skipped, errors: errors.slice(0, 5) });
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
      + `&select=id,role,outcome,ghost_stage,rounds,report_text,platform,outcome_weight,trust_reason,created_at,experience_level,location_id,company_name,company_id`
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
        + `&select=id,role,outcome,ghost_stage,rounds,report_text,platform,outcome_weight,trust_reason,created_at,experience_level,location_id,company_id`
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
          + `&select=id,role,outcome,ghost_stage,rounds,report_text,platform,outcome_weight,trust_reason,created_at,experience_level,location_id,company_id`
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

async function fetchCompanyStats(name, supabaseUrl, dbHeaders) {
  if (!supabaseUrl || !dbHeaders?.apikey) return null;
  try {
    const enc = encodeURIComponent(name);
    const [scoresRes, reportsRes] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/company_scores?company_name=ilike.${enc}&select=company_name,overall_score,ghost_rate,response_rate,avg_wait_days,avg_rounds,waste_score,report_count,data_quality&order=created_at.desc&limit=1`, { headers: dbHeaders }),
      fetch(`${supabaseUrl}/rest/v1/reports?company_name=ilike.${enc}&select=outcome&order=created_at.desc&limit=150`, { headers: dbHeaders }),
    ]);
    const [scores, reps] = await Promise.all([scoresRes.ok ? scoresRes.json() : [], reportsRes.ok ? reportsRes.json() : []]);
    const cs = Array.isArray(scores) ? scores[0] : null;
    const total = Array.isArray(reps) ? reps.length : 0;
    const dist = {};
    (Array.isArray(reps) ? reps : []).forEach(r => { const oc = r.outcome||'unknown'; dist[oc] = (dist[oc]||0)+1; });
    const ghost_rate = cs?.ghost_rate ?? (total >= 5 ? (dist.ghosted||0)/total : null);
    const response_rate = cs?.response_rate ?? (total >= 5 ? ((dist.hired||0)+(dist.offer||0)+(dist.interview||0)+(dist.human||0))/total : null);
    return { company_name: cs?.company_name||name, overall_score: cs?.overall_score||null, ghost_rate, response_rate, avg_wait_days: cs?.avg_wait_days||null, avg_rounds: cs?.avg_rounds||null, waste_score: cs?.waste_score||null, report_count: total||cs?.report_count||0, data_quality: cs?.data_quality||(total>=10?'strong':total>=3?'moderate':'limited'), outcome_dist: dist };
  } catch(e) { return null; }
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

// ── handleCompanyScore: merged from api/company-score.js ──────────────────────
const _SCORE_TTL_MS = 365 * 24 * 60 * 60 * 1000;

function _calcScore(rr, gr, wait, cnt) {
  return Math.max(0, Math.min(100, Math.round(
    50 + (rr * 40) + (gr * -30) + (Math.min(wait / 60, 1) * -15) + (Math.log(cnt + 1) * 5)
  )));
}

function _calcWaste(ghostRate, avgRounds, unpaidRate) {
  return Math.max(0, Math.min(100, Math.round(
    ghostRate * 60 + unpaidRate * 25 + (avgRounds > 4 ? 15 : 0)
  )));
}

function _rowToScore(row) {
  const s = row.overall_score;
  let reviews = [];
  if (row.web_reviews) {
    try { reviews = typeof row.web_reviews === 'string' ? JSON.parse(row.web_reviews) : row.web_reviews; } catch(_e) {}
  }
  return {
    overall_score: s, ghost_rate: row.ghost_rate, response_rate: row.response_rate,
    avg_wait_days: row.avg_wait_days, avg_rounds: row.avg_rounds, waste: row.waste_score,
    unpaid_rate: row.unpaid_rate, report_count: row.report_count || 0,
    data_quality: row.data_quality || 'medium', data_source: 'web_research',
    risk_level: s >= 70 ? 'safe' : s >= 40 ? 'warn' : 'danger',
    industry: row.industry || '', summary: row.raw_summary || '',
    process_score: s, web_reviews: reviews,
  };
}

async function handleCompanyScore(req, res, body) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
  const dbH = SUPABASE_URL && SUPABASE_SERVICE_KEY ? { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' } : null;

  if (body.action === 'research') {
    if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_KEY missing' });
    const { company: co, location } = body;
    if (!co) return res.status(400).json({ error: 'company required' });
    const locationStr = location ? ` in ${location}` : '';
    try {
      const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'web-search-2025-03-05' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001', max_tokens: 1500,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          system: 'You are a hiring transparency researcher. Search Reddit (r/jobs, r/recruitinghell, r/cscareerquestions), Glassdoor, and news for real hiring data. Return ONLY valid JSON, no markdown.',
          messages: [{ role: 'user', content: `Research hiring practices for: ${co}${locationStr}. Return ONLY this JSON: {"summary":"2-3 sentences","ghost_rate_estimate":0-100 or null,"response_rate_estimate":0-100 or null,"avg_rounds_estimate":number or null,"known_issues":["up to 5 real complaints"],"known_positives":["up to 3 positives"],"process_notes":"string or null","data_confidence":"high|medium|low","sources_note":"string","reddit_mentions":number,"glassdoor_rating":number or null}` }],
        })
      });
      if (!apiRes.ok) throw new Error(`Claude ${apiRes.status}`);
      const d = await apiRes.json();
      const txt = (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
      const clean = txt.replace(/```json|```/g, '').trim();
      let parsed; try { parsed = JSON.parse(clean); } catch(e) { const m = clean.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : { error: 'Parse failed', summary: 'Could not parse results.', data_confidence: 'low', known_issues: [], known_positives: [], sources_note: 'Search completed.' }; }
      return res.json(parsed);
    } catch(err) { return res.status(500).json({ error: err.message }); }
  }

  if (body.action === 'resolve') {
    const { query } = body;
    if (!query) return res.status(400).json({ error: 'query required' });
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return res.status(200).json({ ok: true, candidates: [] });
    const q = String(query).slice(0, 100).toLowerCase().trim();
    const qWord = q.split(/\s+/)[0];
    try {
      const [aliasRes, scoresRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/company_aliases?alias=ilike.${encodeURIComponent(q)}&select=canonical,alias&limit=3`, { headers: dbH }),
        fetch(`${SUPABASE_URL}/rest/v1/company_scores?company_name=ilike.*${encodeURIComponent(qWord)}*&select=company_name,overall_score,ghost_rate,report_count,data_quality,verification_status&order=report_count.desc&limit=8`, { headers: dbH }),
      ]);
      const aliases = aliasRes.ok ? await aliasRes.json() : [];
      const scores = scoresRes.ok ? await scoresRes.json() : [];
      const candidates = [];
      (Array.isArray(aliases) ? aliases : []).forEach(a => { candidates.push({ name: a.canonical, match_confidence: 97, via_alias: true, data_source: 'alias' }); });
      (Array.isArray(scores) ? scores : []).forEach(s => {
        const cn = (s.company_name || '').toLowerCase();
        let conf = cn === q ? 99 : cn.includes(q) || q.includes(cn) ? Math.round(Math.min(q.length, cn.length) / Math.max(q.length, cn.length) * 90) : Math.round([...q.split(' ')].filter(w => w.length > 1 && cn.includes(w)).length / Math.max(q.split(' ').length, 1) * 80);
        if (!candidates.find(c => c.name.toLowerCase() === cn)) candidates.push({ name: s.company_name, match_confidence: conf, overall_score: s.overall_score, report_count: s.report_count, data_quality: s.data_quality, verification_status: s.verification_status });
      });
      candidates.sort((a, b) => b.match_confidence - a.match_confidence);
      return res.status(200).json({ ok: true, query, candidates: candidates.slice(0, 5) });
    } catch(e) { return res.status(200).json({ ok: true, candidates: [] }); }
  }

  if (body.action === 'populate') {
    if (!ANTHROPIC_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) return res.status(500).json({ error: 'Missing env vars' });
    const listRes = await fetch(`${SUPABASE_URL}/rest/v1/company_scores?select=company_name,web_reviews&order=created_at.desc&limit=200`, { headers: dbH });
    if (!listRes.ok) return res.status(502).json({ error: 'DB list failed', detail: await listRes.text() });
    const rows = await listRes.json();
    const seen = new Set();
    const deduped = (rows || []).filter(r => { if (!r.company_name || seen.has(r.company_name)) return false; seen.add(r.company_name); return true; });
    const targets = deduped.filter(r => { if (!r.web_reviews) return true; try { const v = typeof r.web_reviews === 'string' ? JSON.parse(r.web_reviews) : r.web_reviews; return !Array.isArray(v) || v.length === 0; } catch(_e) { return true; } }).map(r => r.company_name).filter(Boolean);
    if (!targets.length) return res.json({ ok: true, message: 'All done — every company has reviews!', remaining: 0 });
    const batch = targets.slice(0, 3);
    const remaining = targets.length - batch.length;
    const results = [];
    for (const co of batch) {
      try {
        const apiRes = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'web-search-2025-03-05' }, body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 2000, tools: [{ type: 'web_search_20250305', name: 'web_search' }], system: 'You are a hiring transparency researcher. Search Reddit, Glassdoor, and Blind for real applicant experiences. Return ONLY valid JSON — no markdown.', messages: [{ role: 'user', content: `Research hiring experience at "${co}". Find 4-6 real applicant quotes from Reddit/Glassdoor/Blind (2023-2025). Return ONLY this JSON: {"ghost_rate":0.0-1.0,"response_rate":0.0-1.0,"avg_rounds":1-8,"avg_wait_days":5-120,"unpaid_rate":0.0-1.0,"report_count":number,"data_quality":"high|medium|low","industry":"string","summary":"2-3 sentences","reviews":[{"text":"quote","sentiment":"positive|negative|mixed","source":"Reddit r/...","year":"2024"}]}` }] }) });
        if (!apiRes.ok) throw new Error(`Claude ${apiRes.status}`);
        const d = await apiRes.json();
        const txt = (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
        const m = txt.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim().match(/\{[\s\S]*\}/);
        if (!m) throw new Error('no JSON');
        const p = JSON.parse(m[0]);
        const gr = Math.max(0,Math.min(1,Number(p.ghost_rate)||0)), rr = Math.max(0,Math.min(1,Number(p.response_rate)||0)), wait = Math.max(1,Math.min(180,Number(p.avg_wait_days)||30)), rounds = Math.max(1,Math.min(10,Number(p.avg_rounds)||3)), unpaid = Math.max(0,Math.min(1,Number(p.unpaid_rate)||0)), cnt = Math.max(1,Number(p.report_count)||5);
        const overall = _calcScore(rr,gr,wait,cnt), waste = _calcWaste(gr,rounds,unpaid);
        const revs = Array.isArray(p.reviews) ? p.reviews.slice(0,6).map(r=>({text:(r.text||'').slice(0,400),sentiment:['positive','negative','mixed'].includes(r.sentiment)?r.sentiment:'mixed',source:(r.source||'').slice(0,80),year:(r.year||'').slice(0,4)})) : [];
        const row = { company_name:co, overall_score:overall, ghost_rate:gr, response_rate:rr, avg_wait_days:Math.round(wait), avg_rounds:Math.round(rounds*10)/10, waste_score:waste, unpaid_rate:unpaid, report_count:cnt, data_quality:p.data_quality||'medium', data_source:'web_search', industry:(p.industry||'').slice(0,80), raw_summary:(p.summary||'').slice(0,500), expires_at:new Date(Date.now()+_SCORE_TTL_MS).toISOString(), web_reviews:revs };
        const sv = await fetch(`${SUPABASE_URL}/rest/v1/company_scores`, { method:'POST', headers:{...dbH,Prefer:'resolution=merge-duplicates,return=minimal'}, body:JSON.stringify(row) });
        results.push({ company:co, score:overall, reviews:revs.length, saved:sv.ok });
      } catch(e) {
        try { await fetch(`${SUPABASE_URL}/rest/v1/company_scores`, { method:'POST', headers:{...dbH,Prefer:'resolution=merge-duplicates,return=minimal'}, body:JSON.stringify({company_name:co, web_reviews:[]}) }); } catch(_e) {}
        results.push({ company:co, error:e.message });
      }
      if (batch.indexOf(co) < batch.length - 1) await new Promise(r => setTimeout(r, 2000));
    }
    return res.json({ ok:true, processed:results, remaining, message: remaining > 0 ? `Refresh to process next ${Math.min(3,remaining)}` : 'All done!' });
  }

  // Default: compute/fetch company score by name
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_KEY missing' });
  const { name, force_refresh = false } = body;
  if (!name) return res.status(400).json({ error: 'name required' });

  if (!force_refresh && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    try {
      const nameEnc = encodeURIComponent(name.toLowerCase().trim());
      const cacheRes = await fetch(`${SUPABASE_URL}/rest/v1/company_scores?company_name=ilike.${nameEnc}&order=created_at.desc&limit=1`, { headers: dbH });
      if (cacheRes.ok) { const rows = await cacheRes.json(); if (rows?.[0]) return res.json({ ok: true, score: _rowToScore(rows[0]), _src: 'cache' }); }
    } catch(e) { console.warn('Cache check:', e.message); }
  }

  let apiRes;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, attempt * 4000));
    apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'web-search-2025-03-05' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 2000, tools: [{ type: 'web_search_20250305', name: 'web_search' }], system: 'You are a hiring transparency researcher. First verify the company exists online, then search Reddit (r/recruitinghell, r/jobs, r/cscareerquestions), Glassdoor interview reviews, Blind, and LinkedIn for real applicant experiences. Focus on posts from 2023-2025. Return ONLY a valid JSON object — no markdown, no explanation.', messages: [{ role: 'user', content: `First, search online to verify that "${name}" is a real, findable company. If it does NOT appear to be a real company — it seems fictional, misspelled, has no web presence, or you cannot find any credible online results — return ONLY this JSON and nothing else: {"not_found":true,"reason":"one sentence explanation"}.\n\nOtherwise, research the hiring process and applicant experience at "${name}". Search for: ghosting complaints, interview timelines, number of rounds, unpaid take-home tests, and overall process reputation. Find 4-6 specific quotes or close paraphrases from real applicants on Reddit, Glassdoor, or Blind.\n\nReturn ONLY this JSON:\n{"ghost_rate":0.0-1.0,"response_rate":0.0-1.0,"avg_rounds":1-8,"avg_wait_days":5-120,"unpaid_rate":0.0-1.0,"report_count":number,"data_quality":"high|medium|low","industry":"e.g. E-Commerce, Fintech","summary":"2-3 sentences","reviews":[{"text":"quote","sentiment":"positive|negative|mixed","source":"Reddit r/...","year":"2024"}]}` }] })
    });
    if (apiRes.status !== 429 && apiRes.status !== 529) break;
  }

  if (!apiRes.ok) {
    if ((apiRes.status === 429 || apiRes.status === 529 || apiRes.status >= 500) && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      try {
        const nameEnc = encodeURIComponent(name.toLowerCase().trim());
        const staleRes = await fetch(`${SUPABASE_URL}/rest/v1/company_scores?company_name=ilike.${nameEnc}&order=created_at.desc&limit=1`, { headers: dbH });
        if (staleRes.ok) { const staleRows = await staleRes.json(); if (staleRows?.[0]) return res.json({ ok: true, score: _rowToScore(staleRows[0]), _src: 'stale-cache' }); }
      } catch(_) {}
    }
    return res.status(502).json({ error: 'Score service temporarily unavailable', retry_after: '60' });
  }

  const data = await apiRes.json();
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  let parsed;
  try { const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim(); const match = clean.match(/\{[\s\S]*\}/); if (!match) throw new Error('no JSON found'); parsed = JSON.parse(match[0]); }
  catch(e) { return res.status(502).json({ error: 'Could not parse response', raw: text.slice(0, 200) }); }

  if (parsed.not_found) {
    return res.json({ ok: false, not_found: true, message: `"${name}" doesn't appear to be a real company — we couldn't find it online. Check the spelling or try a well-known company name.` });
  }

  const gr = Math.max(0, Math.min(1, Number(parsed.ghost_rate)||0)), rr = Math.max(0, Math.min(1, Number(parsed.response_rate)||0)), wait = Math.max(1, Math.min(180, Number(parsed.avg_wait_days)||30)), rounds = Math.max(1, Math.min(10, Number(parsed.avg_rounds)||3)), unpaid = Math.max(0, Math.min(1, Number(parsed.unpaid_rate)||0)), cnt = Math.max(1, Number(parsed.report_count)||5);
  const overall = _calcScore(rr, gr, wait, cnt), waste = _calcWaste(gr, rounds, unpaid);
  const reviews = Array.isArray(parsed.reviews) ? parsed.reviews.slice(0, 6).map(r => ({ text:(r.text||'').slice(0,400), sentiment:['positive','negative','mixed'].includes(r.sentiment)?r.sentiment:'mixed', source:(r.source||'').slice(0,80), year:(r.year||'').slice(0,4) })) : [];
  const score = { overall_score:overall, ghost_rate:gr, response_rate:rr, avg_wait_days:Math.round(wait), avg_rounds:Math.round(rounds*10)/10, waste, unpaid_rate:unpaid, report_count:cnt, data_quality:parsed.data_quality||'medium', data_source:'web_research', risk_level:overall>=70?'safe':overall>=40?'warn':'danger', industry:(parsed.industry||'').slice(0,80), summary:(parsed.summary||'').slice(0,500), process_score:overall, web_reviews:reviews };

  if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    const expires = new Date(Date.now() + _SCORE_TTL_MS).toISOString();
    const rowBase = { company_name:name.toLowerCase().trim(), overall_score:overall, ghost_rate:gr, response_rate:rr, avg_wait_days:Math.round(wait), avg_rounds:Math.round(rounds*10)/10, waste_score:waste, unpaid_rate:unpaid, report_count:cnt, data_quality:score.data_quality, data_source:'web_search', industry:score.industry, raw_summary:score.summary, expires_at:expires };
    try {
      const prefer = force_refresh ? 'resolution=merge-duplicates,return=minimal' : 'resolution=ignore-duplicates,return=minimal';
      let saveRes = await fetch(`${SUPABASE_URL}/rest/v1/company_scores`, { method:'POST', headers:{...dbH,Prefer:prefer}, body:JSON.stringify({...rowBase,web_reviews:reviews}) });
      if (!saveRes.ok && saveRes.status === 400) { const errText = await saveRes.text(); if (errText.includes('web_reviews') || errText.includes('column')) saveRes = await fetch(`${SUPABASE_URL}/rest/v1/company_scores`, { method:'POST', headers:{...dbH,Prefer:prefer}, body:JSON.stringify(rowBase) }); }
    } catch(e) { console.error('Save error:', e.message); }
  }

  return res.json({ ok: true, score, _src: 'fresh' });
}
