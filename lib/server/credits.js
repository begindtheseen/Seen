// Server-side credit gate for AI endpoints.
// Validates the caller's JWT, checks their balance, deducts 1 credit.
// Returns { ok: true, uid, balance, pro } or { ok: false, status, error }.
//
// Usage:
//   import { gateAI } from './_utils/credits.js';
//   const gate = await gateAI(req, 'resume_scan');
//   if (!gate.ok) return res.status(gate.status).json({ error: gate.error, credits_required: true });

import { createHmac, timingSafeEqual } from 'crypto';

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
      return { ok: true, uid, balance: 999, pro: false };
    }
  }

  const today = new Date().toISOString().slice(0, 10);

  // Fetch or create credit row
  const cRes = await db(`ai_credits?user_id=eq.${uid}&limit=1`);
  let cred = cRes.ok ? (await cRes.json())?.[0] : null;

  if (!cred) {
    // Welcome bonus: 10 credits, first use costs 1
    const welcomeBalance = 9;
    await db('ai_credits', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ user_id: uid, balance: welcomeBalance, daily_earned: 0, last_reset: today, pro: false }) });
    await db('credit_transactions', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ user_id: uid, delta: 10, reason: 'welcome_bonus' }) });
    await db('credit_transactions', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ user_id: uid, delta: -1, reason }) });
    return { ok: true, uid, balance: welcomeBalance, pro: false };
  }

  // Pro users: unlimited
  if (cred.pro) {
    await db('credit_transactions', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ user_id: uid, delta: -1, reason }) });
    return { ok: true, uid, balance: 999, pro: true };
  }

  if (proOnly && !cred.pro) {
    return { ok: false, status: 402, error: 'This feature requires Seen Pro — upgrade to unlock unlimited AI + Stealth Mode.', pro_required: true };
  }

  // Daily reset: 3 credits
  if (cred.last_reset !== today) {
    cred = { ...cred, balance: 3, daily_earned: 0, last_reset: today };
    await db(`ai_credits?user_id=eq.${uid}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ balance: 3, daily_earned: 0, last_reset: today }) });
  }

  if (cred.balance <= 0) {
    return { ok: false, status: 402, error: 'No AI credits remaining — earn more by answering surveys or tracking applications, or go Pro for unlimited.', credits_required: true, balance: 0 };
  }

  const newBalance = cred.balance - 1;
  await db(`ai_credits?user_id=eq.${uid}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ balance: newBalance }) });
  await db('credit_transactions', { method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ user_id: uid, delta: -1, reason }) });

  return { ok: true, uid, balance: newBalance, pro: false };
}
