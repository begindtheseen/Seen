// One-time admin-triggered listing re-score (backfill) endpoint.
//
// WHY: before 2026-07-03 the whole `jobs` corpus was scored by an old thin scorer (a bare 65
// for unknown companies, a flat waste_score 25 for ~all rows) — numbers for no reason. The
// canonical scorer now lives in lib/server/jobScore.js (scoreJob / wasteScore) and grades each
// listing from signals PRESENT IN THE POSTING ITSELF. New / re-ingested listings already score
// correctly; this endpoint converges the EXISTING rows on demand instead of waiting the ~14-day
// natural expiry/re-ingest. It is the API twin of scripts/rescore-jobs.mjs.
//
// It recomputes purely from columns already stored on each row — NO external calls, invents
// nothing. salary_min (used only for the ">$120k" nudge, not a stored column) is reconstructed
// from the stored salary STRING so the backfill matches ingest-time scoring exactly.
//
// Idempotent: only PATCHes rows whose stored score/waste_score differ from the recomputation,
// so a second run (or a run after natural re-ingest) is a near-total no-op.
//
// Contract: POST /api/admin-rescore-jobs, header `x-admin-token: <session token>`,
// JSON body { dry_run?: boolean }. Admin-only — moderators are refused (destructive/bulk op;
// requires admin or super_admin). Returns { ok, dry_run, scanned, changed, unchanged, sample }.

import { scoreJob, wasteScore } from '../lib/server/jobScore.js';

const ALLOWED = ['https://seenjobs.io', 'https://www.seenjobs.io'];
const PAGE = 500;

function cors(req, res) {
  const o = req.headers.origin || '';
  const ok = !o || o.includes('localhost') || o.includes('127.0.0.1') || ALLOWED.includes(o);
  res.setHeader('Access-Control-Allow-Origin', ok ? (o || '*') : ALLOWED[0]);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
}

// Reconstruct the lower salary bound from the stored display string so the >$120k signal fires
// exactly as it did at ingest. Handles "$180k", "$180k–$220k", "$45/hr". Returns 0 when no annual
// figure is recoverable (hourly/blank) — the scorer then simply skips that nudge. Kept identical
// to scripts/rescore-jobs.mjs's helper so the endpoint and the script converge on the same result.
export function salaryMinFromString(salary) {
  if (!salary) return 0;
  const s = String(salary);
  const k = s.match(/\$\s*([\d,.]+)\s*k/i);      // "$180k"
  if (k) return Math.round(parseFloat(k[1].replace(/,/g, '')) * 1000);
  const hr = /\/\s*hr/i.test(s);
  const n = s.match(/\$\s*([\d,]+)/);            // "$120000"
  if (n && !hr) { const v = parseInt(n[1].replace(/,/g, ''), 10); return Number.isFinite(v) ? v : 0; }
  return 0;
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const SB = process.env.SUPABASE_URL;
  const SK = process.env.SUPABASE_SERVICE_KEY;
  if (!SB || !SK) return res.status(503).json({ error: 'Not configured' });

  const db = (path, opts = {}) => fetch(`${SB}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SK, Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    signal: AbortSignal.timeout(30000),
  });

  try {
    // ── Admin session auth (mirrors admin-stats / admin-company-audit-pdf) ──
    const adminToken = (req.headers['x-admin-token'] || '').trim();
    if (!adminToken) return res.status(401).json({ error: 'unauthorized' });
    const sessRes = await db(`admin_sessions?token=eq.${encodeURIComponent(adminToken)}&limit=1`);
    const sess = sessRes.ok ? (await sessRes.json())[0] : null;
    if (!sess || new Date(sess.expires_at) < new Date()) return res.status(401).json({ error: 'Session expired — log in again' });
    // Destructive bulk op — require admin or super_admin; moderators are refused.
    if (sess.role !== 'admin' && sess.role !== 'super_admin') return res.status(403).json({ error: 'Insufficient role' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const dryRun = body.dry_run === true;

    let offset = 0, scanned = 0, changed = 0, unchanged = 0;
    const sample = [];

    for (;;) {
      const rowsRes = await db(`jobs?select=id,title,company,location,salary,source,type,description,score,waste_score&order=id&offset=${offset}&limit=${PAGE}`);
      if (!rowsRes.ok) return res.status(502).json({ error: `read failed at offset ${offset}: HTTP ${rowsRes.status}` });
      const rows = await rowsRes.json();
      if (!Array.isArray(rows) || rows.length === 0) break;

      for (const j of rows) {
        scanned++;
        const salary_min = salaryMinFromString(j.salary);
        const nextScore = scoreJob({ ...j, salary_min });
        const nextWaste = wasteScore({ ...j, salary_min });
        if (nextScore === j.score && nextWaste === j.waste_score) { unchanged++; continue; }
        changed++;
        if (sample.length < 15) sample.push({ id: j.id, company: j.company, from: `${j.score}/${j.waste_score}`, to: `${nextScore}/${nextWaste}` });
        if (!dryRun) {
          const up = await db(`jobs?id=eq.${encodeURIComponent(j.id)}`, {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ score: nextScore, waste_score: nextWaste }),
          });
          if (!up.ok) console.warn(`[admin-rescore-jobs] PATCH failed for ${j.id}: HTTP ${up.status}`);
        }
      }

      offset += rows.length;
      if (rows.length < PAGE) break;
    }

    // Audit-log the run (best-effort; mirrors admin-company-audit-pdf).
    db('admin_audit_log', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        admin_id: sess.admin_id,
        username: sess.username || 'admin',
        action: 'rescore_jobs',
        target_type: 'jobs',
        target_id: 'corpus',
        metadata: { dry_run: dryRun, scanned, changed, unchanged },
      }),
    }).catch(() => {});

    return res.status(200).json({ ok: true, dry_run: dryRun, scanned, changed, unchanged, sample });
  } catch (e) {
    console.error('[admin-rescore-jobs] error:', e?.message || e);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
