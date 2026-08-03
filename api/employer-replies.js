// Employer replies to community outcome reports (Wave 2 — the employer "voice"). Three actions:
//   • create  (employer JWT → approved claim) — post/replace a reply to a report ABOUT your company.
//                Lands 'pending'; invisible to seekers until an admin approves (migration 060).
//   • mine    (employer JWT → approved claim) — your company's replies + their moderation status.
//   • public  (NO auth) — approved replies for a company, keyed by report_id, for the company page.
//
// INTEGRITY: display-only employer voice. Nothing here reads or writes the scoring path
// (reports/company_scores/companyIntel) — a reply is a CLAIM, never a score input. Admin moderation
// (list/approve/reject) lives in api/admin-stats.js.
//
// NO DATA BLEED: create/mine key strictly off the caller's APPROVED claim companyKey. The report a
// reply targets is verified to be about the caller's own company before the reply is accepted.

import { resolveEmployerUid, resolveApprovedClaim } from '../lib/server/employerAuth.js';
import { normalizeClaimCompany } from '../lib/server/employerClaims.js';
import { normalizeReplyBody, isValidReportId, reportBelongsToCompany } from '../lib/server/employerReplies.js';

const ALLOWED = ['https://seenjobs.io', 'https://www.seenjobs.io'];

function cors(req, res) {
  const o = req.headers.origin || '';
  const ok = !o || o.includes('localhost') || o.includes('127.0.0.1') || ALLOWED.includes(o);
  res.setHeader('Access-Control-Allow-Origin', ok ? (o || '*') : ALLOWED[0]);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try { return await route(req, res); }
  catch (e) {
    console.error('[employer-replies] Unhandled error:', e?.message || e);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function route(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'DB not configured' });

  const db = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=representation',
      ...(opts.headers || {}),
    },
  });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const action = req.method === 'GET' ? 'public' : (body.action || 'public');

  // ── PUBLIC: approved replies for a company, keyed by report_id (no auth) ────────
  if (action === 'public') {
    const raw = (req.method === 'GET' ? req.query?.company : body.company) || '';
    const companyKey = normalizeClaimCompany(String(raw));
    if (!companyKey) return res.status(200).json({ replies: {} });
    const r = await db(
      `employer_report_replies?company_key=eq.${encodeURIComponent(companyKey)}&status=eq.approved` +
      `&select=report_id,body,created_at&order=created_at.desc&limit=300`,
    );
    const rows = r.ok ? await r.json() : [];
    const replies = {};
    for (const row of rows) {
      if (row.report_id && !replies[row.report_id]) replies[row.report_id] = { body: row.body, created_at: row.created_at };
    }
    res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=300');
    return res.status(200).json({ replies });
  }

  // ── EMPLOYER paths (Bearer JWT → approved claim) ───────────────────────────────
  const uid = await resolveEmployerUid(req, { SUPABASE_URL, SERVICE_KEY });
  if (!uid) return res.status(401).json({ error: 'Sign in as an employer to reply' });
  const claim = await resolveApprovedClaim(db, uid);
  if (!claim) return res.status(403).json({ error: 'Your company claim must be approved first', reason: 'no_approved_claim' });

  if (action === 'mine') {
    const r = await db(
      `employer_report_replies?company_key=eq.${encodeURIComponent(claim.companyKey)}` +
      `&select=id,report_id,body,status,created_at,reviewed_at&order=created_at.desc&limit=300`,
    );
    const replies = r.ok ? await r.json() : [];
    return res.status(200).json({ ok: true, company: claim.companyName, replies });
  }

  if (action === 'create') {
    const reportId = String(body.report_id || '').trim();
    if (!isValidReportId(reportId)) return res.status(400).json({ error: 'A valid report is required' });
    const cleanBody = normalizeReplyBody(body.body);
    if (!cleanBody) return res.status(400).json({ error: 'Write a reply first' });

    // The report must be ABOUT this employer's company — you can only reply to your own reports.
    const repRes = await db(`reports?id=eq.${encodeURIComponent(reportId)}&select=company_name&limit=1`);
    const report = repRes.ok ? (await repRes.json())[0] : null;
    if (!report) return res.status(404).json({ error: 'That report no longer exists' });
    if (!reportBelongsToCompany(claim.companyKey, report.company_name)) {
      return res.status(403).json({ error: 'You can only reply to reports about your own company' });
    }

    // Upsert on (company_key, report_id): a re-submit replaces the text and re-enters review.
    const nowIso = new Date().toISOString();
    const up = await db('employer_report_replies?on_conflict=company_key,report_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({
        report_id: reportId,
        company_key: claim.companyKey,
        employer_user_id: uid,
        body: cleanBody,
        status: 'pending',
        reviewed_by: null,
        reviewed_at: null,
        updated_at: nowIso,
      }),
    });
    if (!up.ok) {
      const txt = await up.text().catch(() => '');
      console.error('[employer-replies] upsert failed:', up.status, txt.slice(0, 200));
      return res.status(500).json({ error: 'Could not save your reply — please try again' });
    }
    const reply = (await up.json())[0] || null;
    return res.status(200).json({ ok: true, reply });
  }

  return res.status(400).json({ error: 'Unknown action' });
}
