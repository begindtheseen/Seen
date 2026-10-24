// "Has this new account been confirmed yet?" — the verify screen's poll (app/login/page.tsx).
//
// Why a server answer: the confirmation link is often opened on ANOTHER device (the phone that got the
// email). No session ever reaches the waiting browser, so its getUser() poll can never see the click,
// and retrying signInWithPassword every 5 s spends the project's per-IP sign-in budget (30 per 5 min by
// default) — the waiting tab would lock its own sign-in out after ~2.5 minutes. This answers from the
// auth admin API instead, so the tab moves on within ONE poll of the click and signs in exactly once.
//
// What it reveals, and to whom: only `confirmed: true|false` for a user id. The id is the random UUID
// supabase-js returned to the browser that ran signUp — it is not derivable from an email address, so
// this cannot be used to learn whether an address has an account. An unknown id answers false (never
// 404), and the account's email, dates and metadata are never returned.

import { rateLimit } from '../lib/server/ratelimit.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  const o = req.headers.origin || '';
  const dev = !o || o.includes('localhost') || o.includes('127.0.0.1');
  res.setHeader('Access-Control-Allow-Origin', (dev || ['https://seenjobs.io', 'https://www.seenjobs.io'].includes(o)) ? (o || '*') : 'https://seenjobs.io');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const id = String(body?.id || '');
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'id required' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'not configured' });

  const { allowed } = await rateLimit(req, 'signup-status');
  if (!allowed) return res.status(429).json({ error: 'Too many requests' });

  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(id)}`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      signal: AbortSignal.timeout(5000),
    });
    // 404 (an obfuscated id from a repeat signup of a confirmed address, or a deleted user) = "not yet".
    if (r.status === 404) return res.status(200).json({ confirmed: false });
    if (!r.ok) return res.status(502).json({ error: 'unavailable' });
    const u = await r.json().catch(() => null);
    return res.status(200).json({ confirmed: !!(u && (u.email_confirmed_at || u.confirmed_at)) });
  } catch {
    return res.status(502).json({ error: 'unavailable' });
  }
}
