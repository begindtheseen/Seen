// Company Score Audit & Methodology Report — PDF endpoint.
//
// Builds the SAME company_audit_bundle the JSON export uses (companyAuditBundle.js), computes
// the SHA-256 of that exact bundle, renders the legal PDF from it, and returns application/pdf.
// The raw JSON export remains available separately via /api/admin-stats action:'export_company'.
//
// Admin-only (same admin_sessions auth as admin-stats; moderators are refused). No external AI.

import { buildCompanyAuditBundle, auditBundleHash } from './_utils/companyAuditBundle.js';
import { renderCompanyAuditPdf } from '../lib/server/companyAuditPdf.js';

const ALLOWED = ['https://seenjobs.io', 'https://www.seenjobs.io'];

function cors(req, res) {
  const o = req.headers.origin || '';
  const ok = !o || o.includes('localhost') || o.includes('127.0.0.1') || ALLOWED.includes(o);
  res.setHeader('Access-Control-Allow-Origin', ok ? (o || '*') : ALLOWED[0]);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const SB = process.env.SUPABASE_URL;
  const SK = process.env.SUPABASE_SERVICE_KEY;
  if (!SB || !SK) return res.status(500).json({ error: 'Not configured' });

  const db = (path, opts = {}) => fetch(`${SB}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SK, Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });

  try {
    // ── Admin session auth (mirrors admin-stats) ──
    const adminToken = (req.headers['x-admin-token'] || '').trim();
    if (!adminToken) return res.status(401).json({ error: 'unauthorized' });
    const sessRes = await db(`admin_sessions?token=eq.${encodeURIComponent(adminToken)}&limit=1`);
    const sess = sessRes.ok ? (await sessRes.json())[0] : null;
    if (!sess || new Date(sess.expires_at) < new Date()) return res.status(401).json({ error: 'Session expired — log in again' });
    const adminRole = sess.role;
    if (adminRole === 'moderator') return res.status(403).json({ error: 'Insufficient role' });

    // ── Input: company name (query or body) or company id (resolved to a name) ──
    const q = req.query || {};
    const body = req.method === 'POST' ? (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})) : {};
    let company = String(body.company || q.company || '').trim();
    const companyId = String(body.id || q.id || '').trim();
    if (!company && companyId) {
      const cr = await db(`companies?id=eq.${encodeURIComponent(companyId)}&select=name&limit=1`);
      const row = cr.ok ? (await cr.json())[0] : null;
      if (row?.name) company = row.name;
    }
    if (company.length < 2) return res.status(400).json({ error: 'company query or id required' });

    // ── Build bundle → hash → PDF (all from the one bundle) ──
    const bundle = await buildCompanyAuditBundle({ db, serviceKey: SK, adminId: sess.admin_id, adminRole, company });
    const { hash } = auditBundleHash(bundle);
    const pdf = await renderCompanyAuditPdf(bundle, {
      sourceHash: hash,
      codeVersion: process.env.VERCEL_GIT_COMMIT_SHA || null,
    });

    // Audit-log the disclosure (best-effort).
    db('admin_audit_log', {
      method: 'POST',
      body: JSON.stringify({ admin_id: sess.admin_id, username: sess.username || 'admin', action: 'export_company_pdf', target_type: 'company', target_id: bundle.query, metadata: { reports: bundle.totals.total_reports, source_hash: hash } }),
      headers: { Prefer: 'return=minimal' },
    }).catch(() => {});

    const slug = company.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'company';
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="seen-legal-audit-${slug}-${date}.pdf"`);
    res.setHeader('X-Source-Json-Sha256', hash);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(pdf);
  } catch (e) {
    console.error('[admin-company-audit-pdf] error:', e?.message || e);
    return res.status(e?.statusCode || 500).json({ error: e?.statusCode ? e.message : 'Internal server error' });
  }
}
