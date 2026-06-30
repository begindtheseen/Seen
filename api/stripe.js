// Stripe payment handler — checkout session creation, webhook processing, customer portal.
// Env vars required: STRIPE_SECRET_KEY, STRIPE_PRICE_ID_MONTHLY, STRIPE_PRICE_ID_YEARLY,
//                   STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_JWT_SECRET

import { createHmac, timingSafeEqual } from 'crypto';

const CORS = (req, res) => {
  const o = req.headers.origin || '';
  const dev = !o || o.includes('localhost') || o.includes('127.0.0.1');
  res.setHeader('Access-Control-Allow-Origin', (dev || ['https://seenjobs.io','https://www.seenjobs.io'].includes(o)) ? (o || '*') : 'https://seenjobs.io');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return true; }
  return false;
};

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

function verifyStripeSignature(rawBody, sigHeader, secret) {
  try {
    const t = sigHeader.match(/t=(\d+)/)?.[1];
    const v1 = sigHeader.match(/v1=([a-f0-9]+)/)?.[1];
    if (!t || !v1) return null;
    // Replay attack protection: 5-minute window
    if (Math.abs(Date.now() / 1000 - parseInt(t)) > 300) return null;
    const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    const receivedBuf = Buffer.from(v1, 'hex');
    if (expectedBuf.length !== receivedBuf.length || !timingSafeEqual(expectedBuf, receivedBuf)) return null;
    return JSON.parse(rawBody);
  } catch { return null; }
}

async function resolveUid(req, env) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return { uid: null, email: null };
  const { JWT_SECRET, SUPABASE_URL, SERVICE_KEY } = env;
  if (JWT_SECRET) {
    const p = verifyJWT(token, JWT_SECRET);
    if (p) return { uid: p.sub, email: p.email };
  }
  if (SUPABASE_URL && SERVICE_KEY) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
    });
    if (r.ok) { const u = await r.json(); return { uid: u?.id, email: u?.email }; }
  }
  return { uid: null, email: null };
}

function db(SUPABASE_URL, SERVICE_KEY) {
  return (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

async function setPro(uid, isPro, env) {
  if (!uid) return;
  const q = db(env.SUPABASE_URL, env.SERVICE_KEY);
  const today = new Date().toISOString().slice(0, 10);
  const patch = await q(`ai_credits?user_id=eq.${uid}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ pro: isPro }),
  });
  // 404 or no rows matched (PostgREST returns 200 with count 0 when no rows found)
  const text = await patch.text();
  if (patch.status !== 200 && patch.status !== 204) {
    await q('ai_credits', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ user_id: uid, balance: isPro ? 999 : 3, pro: isPro, daily_earned: 0, last_reset: today }),
    });
  }
}

export default async function handler(req, res) {
  if (CORS(req, res)) return;

  const STRIPE_KEY   = process.env.STRIPE_SECRET_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
  const JWT_SECRET   = process.env.SUPABASE_JWT_SECRET;
  const env = { STRIPE_KEY, SUPABASE_URL, SERVICE_KEY, JWT_SECRET };

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  if (!body || typeof body !== 'object') body = {};

  const action = (req.query?.action) || body.action;

  // ── CREATE CHECKOUT SESSION ───────────────────────────────────────────────
  if (action === 'checkout') {
    if (req.method !== 'POST') return res.status(405).end();
    if (!STRIPE_KEY) return res.status(503).json({ error: 'Payments not yet configured — contact hello@seenjobs.io to upgrade.' });
    if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Server misconfigured' });

    const { uid, email } = await resolveUid(req, env);
    if (!uid) return res.status(401).json({ error: 'Sign in before upgrading' });

    const plan = body.plan === 'yearly' ? 'yearly' : 'monthly';
    const priceId = plan === 'yearly' ? process.env.STRIPE_PRICE_ID_YEARLY : process.env.STRIPE_PRICE_ID_MONTHLY;
    if (!priceId) return res.status(503).json({ error: 'Payments not yet configured' });

    const origin = req.headers.origin || 'https://seenjobs.io';

    const form = new URLSearchParams({
      mode: 'subscription',
      'payment_method_types[]': 'card',
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      client_reference_id: uid,
      success_url: `${origin}/pricing?upgraded=1`,
      cancel_url: `${origin}/pricing`,
      'metadata[uid]': uid,
      'subscription_data[metadata][uid]': uid,
      // 7-day free trial. Card is still collected up front (Checkout subscription mode),
      // so Stripe creates the subscription in `trialing` and auto-converts to a paid charge
      // on day 7 — no manual entitlement bookkeeping. checkout.session.completed still fires
      // immediately (no charge yet), granting Pro for the trial window below.
      'subscription_data[trial_period_days]': '7',
      allow_promotion_codes: 'true',
    });
    if (email) form.set('customer_email', email);

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${STRIPE_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });

    if (!stripeRes.ok) {
      const err = await stripeRes.json().catch(() => ({}));
      return res.status(502).json({ error: err.error?.message || 'Checkout creation failed — try again' });
    }

    const session = await stripeRes.json();
    return res.status(200).json({ url: session.url });
  }

  // ── CUSTOMER PORTAL (manage subscription) ────────────────────────────────
  if (action === 'portal') {
    if (req.method !== 'POST') return res.status(405).end();
    if (!STRIPE_KEY) return res.status(503).json({ error: 'Payments not configured' });

    const { uid } = await resolveUid(req, env);
    if (!uid) return res.status(401).json({ error: 'Sign in first' });

    const q = db(SUPABASE_URL, SERVICE_KEY);
    const credRes = await q(`ai_credits?user_id=eq.${uid}&select=stripe_customer_id&limit=1`);
    const cred = credRes.ok ? (await credRes.json())[0] : null;
    const customerId = cred?.stripe_customer_id;

    if (!customerId) {
      const origin = req.headers.origin || 'https://seenjobs.io';
      return res.status(200).json({ url: `${origin}/pricing` });
    }

    const origin = req.headers.origin || 'https://seenjobs.io';
    const portalRes = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${STRIPE_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ customer: customerId, return_url: `${origin}/pricing` }).toString(),
    });

    if (!portalRes.ok) return res.status(502).json({ error: 'Portal unavailable' });
    const portal = await portalRes.json();
    return res.status(200).json({ url: portal.url });
  }

  // ── STRIPE WEBHOOK ────────────────────────────────────────────────────────
  if (action === 'webhook') {
    if (req.method !== 'POST') return res.status(405).end();

    const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
    const sigHeader = req.headers['stripe-signature'];
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

    // SECURITY: Require signature verification — no unsigned fallback.
    // If STRIPE_WEBHOOK_SECRET is not configured, return 503 rather than
    // processing an unverified payload (which would allow anyone to grant Pro).
    if (!WEBHOOK_SECRET) {
      console.error('[stripe/webhook] STRIPE_WEBHOOK_SECRET not configured — refusing unsigned webhook');
      return res.status(503).json({ error: 'Webhook not configured' });
    }
    if (!sigHeader) {
      console.error('[stripe/webhook] Missing stripe-signature header');
      return res.status(400).json({ error: 'Missing signature' });
    }

    const event = verifyStripeSignature(rawBody, sigHeader, WEBHOOK_SECRET);
    if (!event) {
      console.error('[stripe/webhook] Signature verification failed');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    // SECURITY: Idempotency — ignore already-processed events.
    // Stripe can deliver the same event multiple times; processing it twice
    // would double-grant Pro status or double-revoke subscriptions.
    if (event.id && SUPABASE_URL && SERVICE_KEY) {
      const q = db(SUPABASE_URL, SERVICE_KEY);
      // Try to insert the event ID; if it already exists the insert will fail (UNIQUE constraint)
      const idempotencyRes = await q('stripe_events_processed', {
        method: 'POST',
        headers: { Prefer: 'return=minimal', 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: event.id, event_type: event.type }),
      });
      if (idempotencyRes.status === 409 || idempotencyRes.status === 400) {
        // 409 = UNIQUE violation (duplicate), 400 can also come from duplicate on some PostgREST versions
        const body = await idempotencyRes.text().catch(() => '');
        if (body.includes('duplicate') || body.includes('unique') || idempotencyRes.status === 409) {
          console.log(`[stripe/webhook] Skipping duplicate event ${event.id}`);
          return res.status(200).json({ received: true, duplicate: true });
        }
      }
    }

    const getUid = (obj) => obj?.metadata?.uid || obj?.client_reference_id;

    try {
      if (event.type === 'checkout.session.completed') {
        const session = event.data?.object || {};
        const uid = getUid(session);
        const customerId = session.customer;
        if (uid && SUPABASE_URL && SERVICE_KEY) {
          await setPro(uid, true, env);
          if (customerId) {
            const q = db(SUPABASE_URL, SERVICE_KEY);
            await q(`ai_credits?user_id=eq.${uid}`, {
              method: 'PATCH', headers: { Prefer: 'return=minimal' },
              body: JSON.stringify({ stripe_customer_id: customerId }),
            });
          }
        }
      }

      if (event.type === 'customer.subscription.deleted' || event.type === 'customer.subscription.paused') {
        const sub = event.data?.object || {};
        const uid = getUid(sub);
        if (uid) await setPro(uid, false, env);
      }

      if (event.type === 'customer.subscription.resumed') {
        const sub = event.data?.object || {};
        const uid = getUid(sub);
        if (uid) await setPro(uid, true, env);
      }

      // Keep entitlement in lockstep with the subscription lifecycle — critical for trials:
      // a trial that converts moves trialing → active (keep Pro); a trial the user cancels,
      // or a failed final charge, ends as canceled/unpaid (revoke). past_due / incomplete are
      // left untouched so dunning retries don't yank Pro mid-grace-period.
      if (event.type === 'customer.subscription.updated') {
        const sub = event.data?.object || {};
        const uid = getUid(sub);
        if (uid) {
          if (sub.status === 'trialing' || sub.status === 'active') await setPro(uid, true, env);
          else if (sub.status === 'canceled' || sub.status === 'unpaid' || sub.status === 'incomplete_expired') await setPro(uid, false, env);
        }
      }
    } catch (err) {
      console.error('Webhook handler error:', err.message);
    }

    return res.status(200).json({ received: true });
  }

  return res.status(400).json({ error: 'Unknown action' });
}
