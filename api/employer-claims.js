// Employer → company claims API (ADMIN-APPROVED CLAIMS model, migration 053).
//
// ONE endpoint, TWO callers, distinguished by auth header:
//   • EMPLOYER  (Authorization: Bearer <supabase jwt>) — request a claim, list own claims.
//   • ADMIN     (X-Admin-Token: <admin session token>) — list all claims, approve, reject.
//
// Both paths do their DB work with the SERVICE KEY (RLS bypassed), the same architecture as
// api/user-sync.js ("proxy all user data reads/writes through the service key"). RLS on the table
// (migration 053) is the defense-in-depth boundary for direct anon-key access; the authz that
// matters operationally is enforced here.

import { createHmac, timingSafeEqual } from 'crypto';
import {
  normalizeClaimCompany,
  isValidClaimCompany,
  canRequestClaim,
} from '../lib/server/employerClaims.js';

const ALLOWED = ['https://seenjobs.io', 'https://www.seenjobs.io'];

function cors(req, res) {
  const o = req.headers.origin || '';
  const ok = !o || o.includes('localhost') || o.includes('127.0.0.1') || ALLOWED.includes(o);
  res.setHeader('Access-Control-Allow-Origin', ok ? (o || '*') : ALLOWED[0]);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Token');
}

// Verify a Supabase JWT locally (HS256) — no network round-trip. Returns payload (.sub = user
// UUID) or null. Mirrors api/user-sync.js exactly, including the ES256/RS256 fallback below.
function verifyJWTLocal(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const mac = createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest('base64url');
    const sigBuf = Buffer.from(parts[2], 'base64url');
    const macBuf = Buffer.from(mac, 'base64url');
    if (sigBuf.length !== macBuf.length || !timingSafeEqual(sigBuf, macBuf)) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!payload.sub || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try { return await route(req, res); }
  catch (e) {
    console.error('[employer-claims] Unhandled error:', e?.message || e);
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
      Prefer: 'return=representation',
      ...(opts.headers || {}),
    },
  });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  // ── ADMIN PATH (X-Admin-Token) ───────────────────────────────────────────────
  const adminToken = (req.headers['x-admin-token'] || body.admin_token || '').trim();
  if (adminToken) return adminRoute(req, res, { db, body, adminToken });

  // ── EMPLOYER PATH (Supabase Bearer JWT) ──────────────────────────────────────
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return res.status(401).json({ error: 'Sign in as an employer to manage claims' });

  let uid;
  const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
  const payload = JWT_SECRET ? verifyJWTLocal(token, JWT_SECRET) : null;
  if (payload) {
    uid = payload.sub;
  } else {
    // Asymmetric (ES256/RS256) tokens can't be HS256-verified — fall back to the auth API.
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Invalid token' });
    const { id } = await userRes.json();
    if (!id) return res.status(401).json({ error: 'Could not identify user' });
    uid = id;
  }

  return employerRoute(req, res, { db, body, uid });
}

// ── Employer actions: list own claims, request a claim ─────────────────────────
async function employerRoute(req, res, { db, body, uid }) {
  const action = req.method === 'GET' ? 'mine' : (body.action || 'mine');

  if (action === 'mine') {
    const claims = await listClaimsForUser(db, uid);
    return res.status(200).json({ claims });
  }

  if (action === 'request') {
    // Only an employer account may claim a company (migration 050 hard separation).
    const profRes = await db(`profiles?id=eq.${encodeURIComponent(uid)}&select=account_type,type,email&limit=1`);
    const prof = profRes.ok ? (await profRes.json())[0] : null;
    const accountType = prof ? (prof.account_type || prof.type) : null;
    if (accountType !== 'employer') {
      return res.status(403).json({ error: 'Only employer accounts can claim a company' });
    }

    const rawName = String(body.company || '').trim().slice(0, 120);
    if (!isValidClaimCompany(rawName)) {
      return res.status(400).json({ error: 'Enter a valid company name' });
    }

    // Precheck against this user's existing claims (mirrors the DB partial-unique indexes so we
    // can return a clear reason instead of a raw constraint error).
    const existing = await listClaimsForUser(db, uid);
    const gate = canRequestClaim(existing, rawName);
    if (!gate.ok) {
      const msg = {
        invalid: 'Enter a valid company name',
        already_pending: 'You already have a pending claim for this company',
        already_approved: 'You already manage this company',
        has_other_company: 'Your account already manages another company. Contact us to change it.',
      }[gate.reason] || 'Could not submit this claim';
      return res.status(409).json({ error: msg, reason: gate.reason });
    }

    const canonical = normalizeClaimCompany(rawName);

    // Guard: is this company already approved-claimed by ANOTHER employer? (The DB unique index
    // also enforces it; this returns a friendly message first.)
    const takenRes = await db(
      `employer_company_claims?company_name=eq.${encodeURIComponent(canonical)}&status=eq.approved&select=id&limit=1`,
    );
    const taken = takenRes.ok ? await takenRes.json() : [];
    if (taken.length) {
      return res.status(409).json({ error: 'This company has already been claimed. Contact us if this is a mistake.', reason: 'company_taken' });
    }

    const insRes = await db('employer_company_claims', {
      method: 'POST',
      body: JSON.stringify({
        user_id: uid,
        company_name: canonical,
        company_display_name: rawName,
        status: 'pending',
      }),
      headers: { Prefer: 'return=representation' },
    });
    if (!insRes.ok) {
      // A concurrent request could still trip a unique index — treat as an honest duplicate.
      const txt = await insRes.text().catch(() => '');
      if (insRes.status === 409 || /duplicate|unique/i.test(txt)) {
        return res.status(409).json({ error: 'You already have a claim for this company', reason: 'duplicate' });
      }
      console.error('[employer-claims] insert failed:', insRes.status, txt.slice(0, 200));
      return res.status(500).json({ error: 'Could not submit your claim — please try again' });
    }
    const claim = (await insRes.json())[0] || null;
    return res.status(200).json({ ok: true, claim, claims: await listClaimsForUser(db, uid) });
  }

  return res.status(400).json({ error: 'Unknown action' });
}

async function listClaimsForUser(db, uid) {
  const r = await db(
    `employer_company_claims?user_id=eq.${encodeURIComponent(uid)}` +
    `&select=id,company_name,company_display_name,status,created_at,reviewed_at,note` +
    `&order=created_at.desc`,
  );
  return r.ok ? await r.json() : [];
}

// ── Admin actions: verify session, list all claims, approve, reject ────────────
async function adminRoute(req, res, { db, body, adminToken }) {
  // Same verification as api/admin-stats.js: look the token up in admin_sessions, check expiry.
  const sessRes = await db(`admin_sessions?token=eq.${encodeURIComponent(adminToken)}&limit=1`);
  const sess = sessRes.ok ? (await sessRes.json())[0] : null;
  if (!sess || new Date(sess.expires_at) < new Date()) {
    return res.status(401).json({ error: 'Session expired — log in again' });
  }

  // Resolve a human-readable reviewer name for the audit trail (falls back to the admin id).
  const reviewer = await adminUsername(db, sess.admin_id);

  const action = req.method === 'GET' ? 'list' : (body.action || 'list');

  if (action === 'list') {
    const status = String(body.status || req.query?.status || '').trim();
    const filter = status && ['pending', 'approved', 'rejected'].includes(status)
      ? `&status=eq.${status}` : '';
    // Pending first (0), then approved (1), then rejected (2); newest within each.
    const r = await db(
      `employer_company_claims?select=id,user_id,company_name,company_display_name,status,created_at,reviewed_at,reviewed_by,note` +
      `${filter}&order=created_at.desc&limit=500`,
    );
    const claims = r.ok ? await r.json() : [];
    // Enrich with the employer's email (best-effort; service-key read of profiles).
    const enriched = await attachEmployerEmails(db, claims);
    const rank = { pending: 0, approved: 1, rejected: 2 };
    enriched.sort((a, b) =>
      (rank[a.status] - rank[b.status]) ||
      (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0));
    return res.status(200).json({ claims: enriched, counts: countByStatus(enriched) });
  }

  if (action === 'approve' || action === 'reject') {
    const id = String(body.id || '').trim();
    if (!id) return res.status(400).json({ error: 'Claim id required' });
    const status = action === 'approve' ? 'approved' : 'rejected';
    const patch = {
      status,
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewer,
      note: (body.note != null ? String(body.note).slice(0, 500) : null),
    };
    const r = await db(`employer_company_claims?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
      headers: { Prefer: 'return=representation' },
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      // A unique-index conflict on approve = another employer already approved for this company,
      // OR this employer already has a different approved company.
      if (r.status === 409 || /duplicate|unique/i.test(txt)) {
        return res.status(409).json({
          error: 'Conflict: this company (or this employer) already has an approved claim. Reject the other first.',
          reason: 'approved_conflict',
        });
      }
      console.error('[employer-claims] admin patch failed:', r.status, txt.slice(0, 200));
      return res.status(500).json({ error: 'Could not update the claim' });
    }
    const updated = (await r.json())[0] || null;
    return res.status(200).json({ ok: true, claim: updated });
  }

  return res.status(400).json({ error: 'Unknown admin action' });
}

async function adminUsername(db, adminId) {
  if (!adminId) return 'admin';
  try {
    const r = await db(`admin_accounts?id=eq.${encodeURIComponent(adminId)}&select=username&limit=1`);
    const row = r.ok ? (await r.json())[0] : null;
    return (row && row.username) || String(adminId);
  } catch { return String(adminId); }
}

async function attachEmployerEmails(db, claims) {
  const ids = [...new Set(claims.map(c => c.user_id).filter(Boolean))];
  if (!ids.length) return claims.map(c => ({ ...c, email: null }));
  try {
    const inList = ids.map(encodeURIComponent).join(',');
    const r = await db(`profiles?id=in.(${inList})&select=id,email,name`);
    const rows = r.ok ? await r.json() : [];
    const byId = new Map(rows.map(p => [p.id, p]));
    return claims.map(c => ({
      ...c,
      email: byId.get(c.user_id)?.email || null,
      employer_name: byId.get(c.user_id)?.name || null,
    }));
  } catch {
    return claims.map(c => ({ ...c, email: null }));
  }
}

function countByStatus(claims) {
  const out = { pending: 0, approved: 0, rejected: 0 };
  for (const c of claims) if (out[c.status] != null) out[c.status]++;
  return out;
}
