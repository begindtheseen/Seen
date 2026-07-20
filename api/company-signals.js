// Company public-record signals API (the reliable-at-scale reputation spine).
//
// TWO callers:
//   • PUBLIC (no auth) — `list` the ATTRIBUTED, high-confidence, active signals for one company
//     (what the company page renders). Only status=active + match_confidence=high are ever returned.
//   • ADMIN (X-Admin-Token) — `ingest` official records (SEC 8-K to start) and `retract` a signal
//     (the right-of-reply shield). Ingest matches each filing to OUR companies with the CONSERVATIVE
//     entity-matcher and inserts ONLY high-confidence matches; anything ambiguous is dropped, not
//     mis-attributed. Nothing is fabricated — every row links to the official filing.
//
// Storage/legal posture lives in migration 062_company_signals.sql.

import {
  buildCompanyIndex, matchViaIndex,
} from '../lib/server/companyEntityMatch.js';
import { SEC_PHRASES, fetchEdgarGroup } from '../lib/server/secEdgar.js';

const ALLOWED = ['https://seenjobs.io', 'https://www.seenjobs.io'];

function cors(req, res) {
  const o = req.headers.origin || '';
  const ok = !o || o.includes('localhost') || o.includes('127.0.0.1') || ALLOWED.includes(o);
  res.setHeader('Access-Control-Allow-Origin', ok ? (o || '*') : ALLOWED[0]);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Token');
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try { return await route(req, res); }
  catch (e) {
    console.error('[company-signals] Unhandled error:', e?.message || e);
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
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const adminToken = (req.headers['x-admin-token'] || body.admin_token || '').trim();
  if (adminToken) return adminRoute(req, res, { db, body, adminToken });

  // ── PUBLIC: list attributed, high-confidence, active signals for a company ──
  const company = String(body.company || req.query?.company || '').trim();
  if (!company) return res.status(400).json({ error: 'company required' });
  const q = new URLSearchParams({
    company: `eq.${company}`,
    status: 'eq.active',
    match_confidence: 'eq.high',
    select: 'source,event_type,title,detail,event_date,location,source_url,source_label',
    order: 'event_date.desc.nullslast',
    limit: '25',
  });
  const r = await db(`company_signals?${q.toString()}`);
  const rows = r.ok ? await r.json() : [];
  return res.status(200).json({ company, signals: Array.isArray(rows) ? rows : [] });
}

// ── ADMIN ────────────────────────────────────────────────────────────────────
async function adminRoute(req, res, { db, body, adminToken }) {
  const sessRes = await db(`admin_sessions?token=eq.${encodeURIComponent(adminToken)}&limit=1`);
  const sess = sessRes.ok ? (await sessRes.json())[0] : null;
  if (!sess || new Date(sess.expires_at) < new Date()) {
    return res.status(401).json({ error: 'Session expired — log in again' });
  }

  const action = req.method === 'GET' ? 'list' : (body.action || 'list');

  if (action === 'retract') {
    // Right-of-reply: hide a mis-attached/contested signal without destroying history.
    const id = String(body.id || '').trim();
    if (!id) return res.status(400).json({ error: 'id required' });
    const reason = String(body.reason || '').slice(0, 500);
    const r = await db(`company_signals?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ status: 'retracted', retracted_reason: reason, updated_at: new Date().toISOString() }),
    });
    const rows = r.ok ? await r.json() : [];
    return res.status(r.ok ? 200 : 500).json({ retracted: rows.length });
  }

  if (action === 'ingest') {
    const source = String(body.source || 'sec_8k');
    if (source !== 'sec_8k') return res.status(400).json({ error: `ingest not implemented for source '${source}'` });
    return ingestSec(req, res, { db, body });
  }

  return res.status(400).json({ error: `unknown action '${action}'` });
}

// Ingest SEC 8-K filings → match to our companies → insert high-confidence attributed signals.
async function ingestSec(req, res, { db, body }) {
  // Date window (default last 90 days). Format YYYY-MM-DD.
  const days = Math.min(Math.max(parseInt(body.days, 10) || 90, 1), 365);
  const enddt = new Date().toISOString().slice(0, 10);
  const startdt = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const userAgent = body.user_agent || 'SeenJobs/1.0 job-transparency (contact via seenjobs.io)';

  // Our candidate companies (the ones we have pages for). Build the O(1) match index once.
  const cr = await db('companies?select=id,name&limit=20000');
  const companies = cr.ok ? await cr.json() : [];
  const index = buildCompanyIndex((Array.isArray(companies) ? companies : []).map(c => ({ name: c.name, key: c.id })));

  // Fetch every phrase group (sequentially — SEC asks for ≤10 req/s and we're well under).
  let fetched = 0, matched = 0;
  const toInsert = [];
  const seenRef = new Set();
  for (const group of SEC_PHRASES) {
    const sigs = await fetchEdgarGroup(group, { startdt, enddt, userAgent });
    fetched += sigs.length;
    for (const sig of sigs) {
      const m = matchViaIndex(index, sig.company);
      if (!m) continue;                         // no high-confidence match → DROP (never mis-attribute)
      matched++;
      if (seenRef.has(sig.external_ref)) continue;
      seenRef.add(sig.external_ref);
      toInsert.push({
        company: m.name,                        // OUR canonical company name
        company_key: m.key || null,
        source: sig.source,
        event_type: sig.event_type,
        title: sig.title,
        detail: sig.detail,
        event_date: sig.event_date,
        location: sig.location,
        source_url: sig.source_url,
        source_label: sig.source_label,
        external_ref: sig.external_ref,
        match_confidence: 'high',
      });
    }
  }

  let inserted = 0;
  if (toInsert.length) {
    // Upsert on external_ref — re-ingest never duplicates a claim.
    const ir = await db('company_signals?on_conflict=external_ref', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify(toInsert),
    });
    if (ir.ok) { const rows = await ir.json(); inserted = Array.isArray(rows) ? rows.length : 0; }
    else { return res.status(500).json({ error: 'insert failed', detail: (await ir.text()).slice(0, 300) }); }
  }

  return res.status(200).json({
    source: 'sec_8k', window: { startdt, enddt },
    companies_indexed: index.size,
    fetched, matched, unique_matched: toInsert.length, inserted,
    note: 'Only high-confidence company matches inserted; unmatched filings dropped (never mis-attributed).',
  });
}
