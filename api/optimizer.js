// api/optimizer.js — SeenFit Engine endpoint (Vercel serverless).
//
// DETERMINISTIC, KEYLESS optimizer. This endpoint makes ZERO calls to any external AI
// provider (Anthropic / OpenAI / Gemini / Hugging Face). All scoring is computed by the
// pure engine in lib/optimizer/* (taxonomy + templates + math). The only network calls
// here are to Supabase (process.env.SUPABASE_URL with the service key) for: company
// process score, cached job_facts, the taxonomy, and persistence of runs/feedback.
//
// Actions:
//   action: 'optimize'  → run a full optimization, persist an optimizer_runs row.
//   action: 'feedback'  → record optimizer_feedback (copy/edit/apply/save/ignore + rating + outcome).
//
// Feature flags: gated by SEENFIT_ENGINE_ENABLED (env var OR feature_flags
// 'seenfit_engine_enabled'). LOCAL_MODEL_POLISH_ENABLED is a documented stub only.

import { createHmac, timingSafeEqual } from 'crypto';
import { applyRateLimit } from '../lib/server/ratelimit.js';
import { logError } from '../lib/server/errlog.js';
import { runOptimizer, ENGINE_VERSION } from '../lib/optimizer/index.ts';
import { extractJobFacts } from '../lib/optimizer/extractJobFacts.ts';

// ── auth: derive the user id from the Supabase JWT (same pattern as api/apply.js) ──
function verifyJWT(token, secret) {
  try {
    const [h, p, s] = token.split('.');
    if (!h || !p || !s) return null;
    const mac = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
    const sig = Buffer.from(s, 'base64url');
    const exp = Buffer.from(mac, 'base64url');
    if (sig.length !== exp.length || !timingSafeEqual(sig, exp)) return null;
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (!payload.sub || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch { return null; }
}

async function resolveUid(req, SUPABASE_URL, SERVICE_KEY) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
  if (JWT_SECRET) {
    const p = verifyJWT(token, JWT_SECRET);
    if (p) return p.sub;
  }
  if (SUPABASE_URL && SERVICE_KEY) {
    try {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
      });
      if (r.ok) return (await r.json())?.id || null;
    } catch { /* ignore */ }
  }
  return null;
}

// ── feature flag: env var wins; else feature_flags table (cached per cold start) ──
let _flagCache = { ts: 0, on: null };
async function seenfitEnabled(db) {
  const env = process.env.SEENFIT_ENGINE_ENABLED;
  if (env != null && env !== '') return /^(1|true|on|fully_on|yes)$/i.test(env);
  if (Date.now() - _flagCache.ts < 60_000 && _flagCache.on != null) return _flagCache.on;
  let on = true; // default ON for launch (per spec)
  try {
    const r = await db(`feature_flags?flag_name=eq.seenfit_engine_enabled&select=status&limit=1`);
    if (r.ok) {
      const rows = await r.json();
      if (rows?.length) on = ['fully_on', 'on', 'admin_only', 'beta_users', 'percentage_rollout'].includes(rows[0].status);
    }
  } catch { /* default on */ }
  _flagCache = { ts: Date.now(), on };
  return on;
}

// ── taxonomy loader: merge DB skill_aliases / skill_relationships over built-ins ──
let _taxCache = { ts: 0, tax: null };
async function loadTaxonomy(db) {
  if (Date.now() - _taxCache.ts < 5 * 60_000 && _taxCache.tax) return _taxCache.tax;
  const tax = { aliases: {}, relationships: {} };
  try {
    const [aRes, rRes] = await Promise.all([
      db(`skill_aliases?select=skill,alias&limit=2000`),
      db(`skill_relationships?select=from_skill,to_skill,weight&limit=2000`),
    ]);
    if (aRes.ok) for (const row of await aRes.json()) {
      if (row.alias && row.skill) tax.aliases[String(row.alias).toLowerCase()] = String(row.skill).toLowerCase();
    }
    if (rRes.ok) for (const row of await rRes.json()) {
      const from = String(row.from_skill || '').toLowerCase();
      if (!from || !row.to_skill) continue;
      (tax.relationships[from] ||= []).push({ to: String(row.to_skill).toLowerCase(), weight: Number(row.weight) || 0.5 });
    }
  } catch { /* fall back to built-in taxonomy */ }
  _taxCache = { ts: Date.now(), tax };
  return tax;
}

// ── company process score from the existing company_scores table (by name) ──
async function getCompanyProcess(db, company) {
  if (!company) return { score: null, confidence: null };
  try {
    const r = await db(`company_scores?company_name=ilike.${encodeURIComponent(company)}&select=overall_score,report_count&order=report_count.desc&limit=1`);
    if (!r.ok) return { score: null, confidence: null };
    const rows = await r.json();
    if (!rows?.length) return { score: null, confidence: null };
    const score = rows[0].overall_score == null ? null : Number(rows[0].overall_score);
    const cnt = Number(rows[0].report_count) || 0;
    const confidence = Math.max(0, Math.min(1, cnt / 10)); // mirrors companyScore confidence shape
    return { score, confidence };
  } catch { return { score: null, confidence: null }; }
}

// ── cached job_facts per job_id (fast repeat runs) ──
async function getCachedJobFacts(db, jobId) {
  if (!jobId) return null;
  try {
    const r = await db(`job_facts?job_id=eq.${encodeURIComponent(String(jobId))}&select=fact_type,label,normalized_label,weight,confidence,importance&limit=500`);
    if (!r.ok) return null;
    const rows = await r.json();
    if (!rows?.length) return null;
    return rows.map((row) => ({
      factType: row.fact_type,
      label: row.label,
      normalizedLabel: row.normalized_label,
      importance: row.importance || 'required',
      weight: Number(row.weight) || (row.importance === 'preferred' ? 0.6 : 1),
      confidence: Number(row.confidence) || 0.8,
    }));
  } catch { return null; }
}

async function cacheJobFacts(db, jobId, facts) {
  if (!jobId || !facts?.length) return;
  try {
    await db(`job_facts?job_id=eq.${encodeURIComponent(String(jobId))}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    await db(`job_facts`, {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(
        facts.map((f) => ({
          job_id: String(jobId),
          fact_type: f.factType,
          label: f.label,
          normalized_label: f.normalizedLabel,
          weight: f.weight,
          confidence: f.confidence,
          importance: f.importance,
        }))
      ),
    });
  } catch (e) { console.error('optimizer cacheJobFacts:', e.message); }
}

export default async function handler(req, res) {
  const _o = req.headers.origin || '';
  const _devO = !_o || _o.includes('localhost') || _o.includes('127.0.0.1');
  res.setHeader('Access-Control-Allow-Origin', (_devO || ['https://seenjobs.io', 'https://www.seenjobs.io'].includes(_o)) ? (_o || '*') : 'https://seenjobs.io');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (await applyRateLimit(req, res, 'optimizer')) return;
  if (req.method !== 'POST') return res.status(405).end('Method not allowed');

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  if (!body || typeof body !== 'object') body = {};

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const dbHeaders = {
    'Content-Type': 'application/json',
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
  };
  const db = (path, opts = {}) =>
    fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...dbHeaders, ...(opts.headers || {}) } });
  const haveDb = !!(SUPABASE_URL && SERVICE_KEY);

  // Feature gate.
  if (haveDb && !(await seenfitEnabled(db))) {
    return res.status(403).json({ error: 'SEENFIT_DISABLED', message: 'SeenFit Engine is currently disabled.' });
  }

  const action = body.action || 'optimize';

  try {
    // ── feedback ──────────────────────────────────────────────────────────────
    if (action === 'feedback') {
      const { run_id, rating, user_action, outcome } = body;
      const uid = haveDb ? await resolveUid(req, SUPABASE_URL, SERVICE_KEY) : null;
      const allowedActions = ['copy', 'edit', 'apply', 'save', 'ignore', 'view'];
      if (user_action && !allowedActions.includes(user_action)) {
        return res.status(400).json({ error: 'INVALID_ACTION' });
      }
      if (haveDb) {
        await db('optimizer_feedback', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            run_id: run_id || null,
            user_id: uid,
            rating: Number.isInteger(rating) ? rating : null,
            user_action: user_action || null,
            outcome: outcome || null,
          }),
        });
      }
      return res.status(200).json({ ok: true });
    }

    // ── optimize ────────────────────────────────────────────────────────────────
    const { resumeText, jobId, jobTitle, company, jobDescription, jobLocation, desiredLocation, remoteOk } = body;
    if (!resumeText || String(resumeText).trim().length < 40) {
      return res.status(400).json({ error: 'RESUME_REQUIRED', message: 'Provide résumé text (at least 40 characters).' });
    }

    const uid = haveDb ? await resolveUid(req, SUPABASE_URL, SERVICE_KEY) : null;

    // Taxonomy + company process score (parallel).
    const [taxonomy, companyProc] = await Promise.all([
      haveDb ? loadTaxonomy(db) : Promise.resolve(null),
      haveDb ? getCompanyProcess(db, company) : Promise.resolve({ score: null, confidence: null }),
    ]);

    // Job facts: prefer cached → else extract → cache for next time.
    let jobFacts = null;
    let factsSource = 'extracted';
    if (haveDb && jobId) {
      jobFacts = await getCachedJobFacts(db, jobId);
      if (jobFacts) factsSource = 'cache';
    }
    if (!jobFacts) {
      jobFacts = extractJobFacts(jobDescription || '', { jobTitle, taxonomy: taxonomy ? { aliases: { ...taxonomy.aliases }, relationships: { ...taxonomy.relationships } } : undefined });
      if (haveDb && jobId && jobFacts.length) cacheJobFacts(db, jobId, jobFacts).catch(() => {});
    }

    const output = runOptimizer(
      {
        resumeText: String(resumeText),
        jobId: jobId || null,
        jobTitle,
        company,
        jobDescription,
        jobFacts,
        companyProcessScore: companyProc.score,
        companyProcessConfidence: companyProc.confidence,
        jobLocation: jobLocation || null,
        desiredLocation: desiredLocation || null,
        remoteOk: !!remoteOk,
      },
      { taxonomy }
    );

    // Persist the run (best-effort). Don't fail the response if persistence fails.
    let runId = null;
    if (haveDb) {
      try {
        const r = await db('optimizer_runs', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            user_id: uid,
            job_id: jobId || null,
            fit_score: output.fit_score,
            ats_score: output.ats_coverage,
            evidence_score: output.evidence_strength,
            company_process_score: output.company_process_score,
            output,
            engine_version: output.engine_version,
          }),
        });
        if (r.ok) { const rows = await r.json(); runId = rows?.[0]?.id || null; }
      } catch (e) { console.error('optimizer persist:', e.message); }
    }

    return res.status(200).json({ ...output, run_id: runId, _facts_source: factsSource, _engine_version: ENGINE_VERSION });
  } catch (e) {
    console.error('optimizer error:', e.message);
    logError('optimizer', e.message, { action });
    return res.status(500).json({ error: 'OPTIMIZER_ERROR', message: 'Failed to run optimization.' });
  }
}
