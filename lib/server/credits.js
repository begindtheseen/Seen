// Server-side credit gate for AI endpoints.
// Validates the caller's JWT, checks their balance, deducts 1 credit.
// Returns { ok: true, uid, balance, pro } or { ok: false, status, error }.
//
// Usage:
//   import { gateAI } from './_utils/credits.js';
//   const gate = await gateAI(req, 'resume_scan');
//   if (!gate.ok) return res.status(gate.status).json({ error: gate.error, credits_required: true });

import { createHmac, timingSafeEqual } from 'crypto';
import { WELCOME_CREDITS, FREE_DAILY_CREDITS, PRO_DAILY_CREDITS, RESUME_OPTIMIZE_COST, hasProAccess } from './creditRules.js';

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

// Resolve the authenticated user from the request's Bearer token WITHOUT touching
// credits. Returns { uid, email } or null. Used by routes that need identity (e.g.
// to send an email only to the signed-in user's own address) but are not AI-gated.
export async function resolveAuthedUser(req) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
  const JWT_SECRET   = process.env.SUPABASE_JWT_SECRET;
  if (!SUPABASE_URL || !SERVICE_KEY) return null;

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  if (JWT_SECRET) {
    const payload = verifyJWT(token, JWT_SECRET);
    if (payload) {
      return { uid: payload.sub, email: typeof payload.email === 'string' ? payload.email : null };
    }
  }
  // Local verify unavailable/failed — ask Supabase.
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  if (!u?.id) return null;
  return { uid: u.id, email: typeof u.email === 'string' ? u.email : null };
}

// Resolve identity AND effective Pro status WITHOUT touching credits. Returns
// { uid, email, pro }. `pro` goes through the ONE definition (hasProAccess over the
// ai_credits row: subscription flag, admin-comped, or an unexpired purchased window).
// Fails SAFE: anonymous callers and any lookup failure yield pro=false, so an
// unverifiable caller keeps the free-tier (watermarked) treatment. Used by routes
// that must brand output for free users but not for Pro (e.g. résumé PDF export).
export async function resolveProAccess(req) {
  const authed = await resolveAuthedUser(req);
  if (!authed?.uid) return { uid: null, email: null, pro: false };

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) return { ...authed, pro: false };

  try {
    // Read the FULL ai_credits row (no select filter) so this never 400s on a DB
    // missing the pro_until/comped columns — mirrors gateAI's read exactly.
    const r = await fetch(`${SUPABASE_URL}/rest/v1/ai_credits?user_id=eq.${authed.uid}&limit=1`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (!r.ok) return { ...authed, pro: false };
    const cred = (await r.json())?.[0] || null;
    return { ...authed, pro: hasProAccess(cred) };
  } catch {
    return { ...authed, pro: false };
  }
}

// proOnly: if true, returns { ok: false, status: 402, pro_required: true } for non-Pro users without deducting credits.
export async function gateAI(req, reason = 'ai_tool', { proOnly = false } = {}) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
  const JWT_SECRET   = process.env.SUPABASE_JWT_SECRET;

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return { ok: false, status: 500, error: 'Server not configured' };
  }

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return { ok: false, status: 401, error: 'Sign in to use AI features', credits_required: true };

  // Resolve user ID — try local JWT first (fast), fall back to Supabase API
  let uid;
  if (JWT_SECRET) {
    const payload = verifyJWT(token, JWT_SECRET);
    if (payload) {
      uid = payload.sub;
    } else {
      // Local verification failed — wrong JWT_SECRET or clock drift.
      // Fall back to Supabase auth API rather than hardcoding a 401.
      const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return { ok: false, status: 401, error: 'Session expired — sign in again', credits_required: true };
      uid = (await r.json())?.id;
      if (!uid) return { ok: false, status: 401, error: 'Could not identify user', credits_required: true };
    }
  } else {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return { ok: false, status: 401, error: 'Session expired — sign in again', credits_required: true };
    uid = (await r.json())?.id;
    if (!uid) return { ok: false, status: 401, error: 'Could not identify user', credits_required: true };
  }

  const db = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });

  // Check feature flag — if ai_credit_system_enabled is off, bypass entirely
  const flagRes = await db(`feature_flags?flag_name=eq.ai_credit_system_enabled&select=status&limit=1`);
  if (flagRes.ok) {
    const flagRow = (await flagRes.json())?.[0];
    if (!flagRow || flagRow.status === 'off') {
      return { ok: true, uid, balance: PRO_DAILY_CREDITS, pro: false };
    }
  }

  // Atomic consume via the consume_credit SQL function (SELECT ... FOR UPDATE). This serializes
  // concurrent calls for the same user, closing the read-modify-write race where two parallel
  // requests could spend the same credit. Falls through to the legacy inline path below if the
  // RPC is unavailable (e.g. a DB without migration 025_atomic_consume_credit applied).
  try {
    const rpc = await db('rpc/consume_credit', {
      method: 'POST',
      body: JSON.stringify({ p_uid: uid, p_reason: reason, p_pro_only: proOnly }),
    });
    if (rpc.ok) {
      const row = (await rpc.json())?.[0];
      if (row && row.status) {
        if (row.status === 'ok') return { ok: true, uid, balance: row.balance, pro: row.pro };
        if (row.status === 'pro_required') {
          return { ok: false, status: 402, error: 'This feature requires Seen Pro — upgrade to unlock unlimited AI + Human Voice.', pro_required: true };
        }
        if (row.status === 'no_credits') {
          return { ok: false, status: 402, error: 'No AI credits remaining — earn more by answering surveys or tracking applications, or go Pro for unlimited.', credits_required: true, balance: 0 };
        }
      }
    }
  } catch { /* RPC unavailable — fall back to the legacy path below */ }

  const today = new Date().toISOString().slice(0, 10);

  // Fetch or create credit row
  const cRes = await db(`ai_credits?user_id=eq.${uid}&limit=1`);
  // If the balance read itself failed (transient DB error), fail OPEN for this single call
  // WITHOUT creating a new credit row. A failed read previously looked identical to a
  // brand-new user, which re-granted the 10-credit welcome bonus on every error — a
  // repeatable free-credit exploit and a ledger-spam vector.
  if (!cRes.ok) return { ok: true, uid, balance: FREE_DAILY_CREDITS, pro: false };
  let cred = (await cRes.json())?.[0] || null;

  if (!cred) {
    // Welcome bonus, first use costs one credit.
    const welcomeBalance = WELCOME_CREDITS - RESUME_OPTIMIZE_COST;
    await db('ai_credits', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ user_id: uid, balance: welcomeBalance, daily_earned: 0, last_reset: today, pro: false }) });
    await db('credit_transactions', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ user_id: uid, delta: WELCOME_CREDITS, reason: 'welcome_bonus' }) });
    await db('credit_transactions', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ user_id: uid, delta: -1, reason }) });
    return { ok: true, uid, balance: welcomeBalance, pro: false };
  }

  // Pro users: unlimited. Effective Pro = subscription flag OR an unexpired purchased
  // Pro window (ai_credits.pro_until, sprint SKU) — hasProAccess is the ONE definition.
  if (hasProAccess(cred)) {
    await db('credit_transactions', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ user_id: uid, delta: -1, reason }) });
    return { ok: true, uid, balance: PRO_DAILY_CREDITS, pro: true };
  }

  if (proOnly) {
    return { ok: false, status: 402, error: 'This feature requires Seen Pro — upgrade to unlock unlimited AI + Human Voice.', pro_required: true };
  }

  // Daily reset to FREE_DAILY_CREDITS (code resets daily; DB DEFAULT stays 1 per migration
  // 031, which already matches). Unlimited is the Pro upgrade.
  if (cred.last_reset !== today) {
    cred = { ...cred, balance: FREE_DAILY_CREDITS, daily_earned: 0, last_reset: today };
    await db(`ai_credits?user_id=eq.${uid}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ balance: FREE_DAILY_CREDITS, daily_earned: 0, last_reset: today }) });
  }

  // Spend the daily balance first, then purchased credits (ai_credits.purchased_credits —
  // bought via one-time SKUs; NEVER reset daily, so they must be consumed separately).
  const purchased = Math.max(0, cred.purchased_credits || 0);
  if ((cred.balance || 0) <= 0 && purchased <= 0) {
    return { ok: false, status: 402, error: 'No AI credits remaining — earn more by answering surveys or tracking applications, or go Pro for unlimited.', credits_required: true, balance: 0 };
  }

  let newBalance;
  if ((cred.balance || 0) > 0) {
    await db(`ai_credits?user_id=eq.${uid}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ balance: cred.balance - 1 }) });
    newBalance = (cred.balance - 1) + purchased;
  } else {
    await db(`ai_credits?user_id=eq.${uid}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ purchased_credits: purchased - 1 }) });
    newBalance = purchased - 1;
  }
  await db('credit_transactions', { method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ user_id: uid, delta: -1, reason }) });

  return { ok: true, uid, balance: newBalance, pro: false };
}
