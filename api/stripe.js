// Stripe payment handler — checkout session creation, webhook processing, customer portal.
// Env vars required: STRIPE_SECRET_KEY, STRIPE_PRICE_ID_MONTHLY, STRIPE_PRICE_ID_YEARLY,
//                   STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_JWT_SECRET

import { createHmac, timingSafeEqual } from 'crypto';
import { ONE_TIME_SKUS, PRO_TRIAL_DAYS } from '../lib/server/creditRules.js';
import { fulfillOneTimeCheckout } from '../lib/server/stripeFulfillment.js';
import { EMPLOYER_SKUS } from '../lib/server/employerSkus.js';
import { fulfillEmployerCheckout, isEmployerSession } from '../lib/server/employerFulfillment.js';

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
  // Revokes must NEVER touch an admin-comped account (migration 051) — comped Pro is
  // granted outside the Stripe lifecycle, so Stripe's "no active subscription" is not
  // evidence against it. The filter makes a comped row simply not match (0-row PATCH),
  // and every revoke site (on-read reconcile, reconcile_all, webhooks) routes through
  // here, so the guard holds everywhere at once.
  const filter = isPro ? '' : '&comped=eq.false';
  const patch = await q(`ai_credits?user_id=eq.${uid}${filter}`, {
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

// Resolve the user's Stripe customer id: use the stored value first, else look it up by
// email (self-healing for accounts that subscribed before the id was persisted, or where
// the confirm write failed) and store it back so future calls are instant.
async function resolveCustomerId(uid, email, env) {
  const { STRIPE_KEY, SUPABASE_URL, SERVICE_KEY } = env;
  const q = db(SUPABASE_URL, SERVICE_KEY);
  try {
    const credRes = await q(`ai_credits?user_id=eq.${uid}&select=stripe_customer_id&limit=1`);
    const stored = credRes.ok ? (await credRes.json())?.[0]?.stripe_customer_id : null;
    if (stored) return stored;
  } catch { /* fall through to email lookup */ }
  if (!email || !STRIPE_KEY) return null;
  try {
    const r = await fetch(`https://api.stripe.com/v1/customers?email=${encodeURIComponent(email)}&limit=1`, { headers: { Authorization: `Bearer ${STRIPE_KEY}` } });
    if (!r.ok) return null;
    const cust = (await r.json())?.data?.[0];
    if (!cust?.id) return null;
    q(`ai_credits?user_id=eq.${uid}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ stripe_customer_id: cust.id }) }).catch(() => {});
    return cust.id;
  } catch { return null; }
}

// Stripe signs the RAW request bytes — Vercel's auto-parsed req.body can never re-serialize
// to the exact signed payload, so webhook signature verification was structurally impossible.
// Disable the body parser and read the stream ourselves; every action parses JSON from the
// captured raw string, and the webhook verifies the HMAC against the untouched bytes.
export const config = { api: { bodyParser: false } };

async function readRawBody(req) {
  // If a runtime still pre-parsed the body (config ignored), fall back to it.
  if (req.body !== undefined && req.body !== null) {
    return typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(req, res) {
  if (CORS(req, res)) return;

  const STRIPE_KEY   = process.env.STRIPE_SECRET_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
  const JWT_SECRET   = process.env.SUPABASE_JWT_SECRET;
  const env = { STRIPE_KEY, SUPABASE_URL, SERVICE_KEY, JWT_SECRET };

  let rawBody = '';
  try { if (req.method !== 'GET') rawBody = await readRawBody(req); } catch { rawBody = ''; }
  let body = {};
  if (rawBody) { try { body = JSON.parse(rawBody); } catch { body = {}; } }
  if (!body || typeof body !== 'object') body = {};

  const action = (req.query?.action) || body.action;

  // ── PAYMENTS STATUS (public) ──────────────────────────────────────────────
  // Lets the UI know whether Stripe is wired up yet. When it isn't, the frontend
  // shows a "Pro launching soon" state instead of a broken checkout error. The
  // moment STRIPE_SECRET_KEY + a price ID are set in Vercel, this flips to true
  // and the full upgrade flow (incl. the 7-day trial) activates with no redeploy.
  if (action === 'status') {
    // Just the secret key is enough now — prices are created inline (no pre-made price IDs
    // required) and Pro is granted on the post-checkout return (no webhook required).
    return res.status(200).json({ payments_enabled: !!STRIPE_KEY });
  }

  // ── CONFIRM CHECKOUT (grant Pro on return — no webhook needed) ─────────────
  // The success page calls this with the Checkout session id. We retrieve the session
  // from Stripe, verify it belongs to the signed-in user, and grant Pro if it produced a
  // subscription (trialing/active). This makes the whole flow work with ONLY the secret
  // key configured. The webhook (below) is still honored when present and handles the
  // longer-term lifecycle (cancellations, renewals, failed payments).
  if (action === 'confirm') {
    if (req.method !== 'POST') return res.status(405).end();
    if (!STRIPE_KEY || !SUPABASE_URL || !SERVICE_KEY) return res.status(503).json({ error: 'Payments not configured' });
    const { uid } = await resolveUid(req, env);
    if (!uid) return res.status(401).json({ error: 'Sign in first' });
    const sessionId = (body.session_id || '').toString();
    if (!sessionId.startsWith('cs_')) return res.status(400).json({ error: 'Invalid session' });
    try {
      const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
        headers: { Authorization: `Bearer ${STRIPE_KEY}` },
      });
      if (!r.ok) return res.status(502).json({ error: 'Could not verify session' });
      const session = await r.json();
      // SECURITY: the session must belong to THIS user (set at checkout creation).
      const owner = session.metadata?.uid || session.client_reference_id;
      if (owner !== uid) return res.status(403).json({ error: 'Session does not match account' });
      // One-time SKU purchase (mode: 'payment') — fulfill idempotently (shares the
      // session-id claim with the webhook, so double delivery can never double-grant).
      if (session.mode === 'payment' || session.metadata?.sku) {
        const result = await fulfillOneTimeCheckout(session, env);
        return res.status(200).json({ ok: !!result.ok, sku: session.metadata?.sku || null, duplicate: !!result.duplicate });
      }
      // A subscription (incl. the $0 no-card trial) means the upgrade succeeded.
      const ok = !!session.subscription && (session.status === 'complete' || session.payment_status === 'paid' || session.payment_status === 'no_payment_required');
      if (ok) {
        await setPro(uid, true, env);
        if (session.customer) {
          const q = db(SUPABASE_URL, SERVICE_KEY);
          await q(`ai_credits?user_id=eq.${uid}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ stripe_customer_id: session.customer }) });
        }
        return res.status(200).json({ ok: true, pro: true });
      }
      return res.status(200).json({ ok: false });
    } catch (err) {
      console.error('[stripe/confirm]', err.message);
      return res.status(500).json({ error: 'Confirm failed' });
    }
  }

  // ── SUBSCRIPTION STATUS / CANCEL / RESUME (in-app, no Stripe portal needed) ──
  // Powers "Manage membership": read the current plan + renewal date, cancel (at period
  // end, so they keep access through the month they paid for), or resume a pending cancel.
  if (action === 'subscription_status' || action === 'cancel_subscription' || action === 'resume_subscription') {
    if (req.method !== 'POST') return res.status(405).end();
    if (!STRIPE_KEY || !SUPABASE_URL || !SERVICE_KEY) return res.status(503).json({ error: 'Payments not configured' });
    const { uid, email } = await resolveUid(req, env);
    if (!uid) return res.status(401).json({ error: 'Sign in first' });
    const customerId = await resolveCustomerId(uid, email, env);
    // No Stripe customer → comped/never-subscribed. Pro can still be true here: an
    // admin-comped account (ai_credits.pro=true with no stripe_customer_id — the
    // reconcile paths deliberately never touch those) or a purchased Pro window
    // (ai_credits.pro_until, e.g. Interview Sprint) must read as Pro, not false.
    if (!customerId) {
      try {
        const rowRes = await db(SUPABASE_URL, SERVICE_KEY)(`ai_credits?user_id=eq.${uid}&select=pro,pro_until,comped&limit=1`);
        const row = rowRes.ok ? (await rowRes.json())?.[0] : null;
        const t = row?.pro_until ? Date.parse(row.pro_until) : NaN;
        const windowActive = Number.isFinite(t) && t > Date.now();
        const pro = row?.comped === true || row?.pro === true || windowActive;
        return res.status(200).json({ ok: true, pro, subscription: null, ...(windowActive ? { pro_until: row.pro_until } : {}) });
      } catch {
        return res.status(200).json({ ok: true, pro: false, subscription: null });
      }
    }
    try {
      const listRes = await fetch(`https://api.stripe.com/v1/subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=10`, { headers: { Authorization: `Bearer ${STRIPE_KEY}`, 'Content-Type': 'application/json' } });
      if (!listRes.ok) return res.status(502).json({ error: 'Could not read subscription' });
      const subs = (await listRes.json())?.data || [];
      // Only active / trialing / past_due grant access. A canceled/ended sub grants nothing.
      let active = subs.find(s => ['active', 'trialing', 'past_due'].includes(s.status)) || null;

      if (active && action === 'cancel_subscription' && !active.cancel_at_period_end) {
        const r = await fetch(`https://api.stripe.com/v1/subscriptions/${active.id}`, { method: 'POST', headers: { Authorization: `Bearer ${STRIPE_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'cancel_at_period_end=true' });
        if (!r.ok) return res.status(502).json({ error: 'Cancel failed — try again' });
      } else if (active && action === 'resume_subscription' && active.cancel_at_period_end) {
        const r = await fetch(`https://api.stripe.com/v1/subscriptions/${active.id}`, { method: 'POST', headers: { Authorization: `Bearer ${STRIPE_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'cancel_at_period_end=false' });
        if (!r.ok) return res.status(502).json({ error: 'Resume failed — try again' });
      }

      // Refresh the active sub after any change so we return + reconcile on current state.
      if (active) {
        const freshRes = await fetch(`https://api.stripe.com/v1/subscriptions/${active.id}`, { headers: { Authorization: `Bearer ${STRIPE_KEY}` } });
        active = freshRes.ok ? await freshRes.json() : active;
      }

      // ── RECONCILE entitlement with Stripe on every read ──────────────────────
      // This is what makes the lifecycle self-heal: when the subscription actually
      // ends (period end reached, trial expired, payments failed), the next profile/
      // pricing load flips Pro OFF and the manage buttons disappear — no webhook needed.
      const entitled = !!active && ['active', 'trialing', 'past_due'].includes(active.status);
      await setPro(uid, entitled, env);

      if (!entitled) {
        // No live subscription — but an admin-comped account (setPro above can't touch
        // it, migration 051) or a purchased Pro window (sprint SKU, ai_credits.pro_until)
        // is independent of the subscription lifecycle and must still read as Pro.
        try {
          const rowRes = await db(SUPABASE_URL, SERVICE_KEY)(`ai_credits?user_id=eq.${uid}&limit=1`);
          const row = rowRes.ok ? (await rowRes.json())?.[0] : null;
          if (row?.comped === true) {
            return res.status(200).json({ ok: true, pro: true, subscription: null });
          }
          const t = row?.pro_until ? Date.parse(row.pro_until) : NaN;
          if (Number.isFinite(t) && t > Date.now()) {
            return res.status(200).json({ ok: true, pro: true, subscription: null, pro_until: row.pro_until });
          }
        } catch { /* fall through to plain non-pro */ }
        return res.status(200).json({ ok: true, pro: false, subscription: null });
      }

      const item = active.items?.data?.[0];
      return res.status(200).json({
        ok: true,
        pro: true,
        subscription: {
          status: active.status,
          cancel_at_period_end: !!active.cancel_at_period_end,
          current_period_end: active.current_period_end ? active.current_period_end * 1000 : null,
          amount: item?.price?.unit_amount != null ? item.price.unit_amount / 100 : null,
          interval: item?.price?.recurring?.interval || null,
        },
      });
    } catch (err) {
      console.error('[stripe/manage]', err.message);
      return res.status(500).json({ error: 'Subscription action failed' });
    }
  }

  // ── RECONCILE ALL (cron safety net) ───────────────────────────────────────
  // Belt-and-suspenders so NO user is ever left marked Pro after their subscription
  // ends. The webhook is the real-time path and the on-read reconcile catches lapses on
  // the next profile/pricing visit — this daily sweep catches the last edge: a user whose
  // webhook misfired AND who never revisits. Checks every Pro account that has a Stripe
  // customer against Stripe; if none of their subs are active/trialing/past_due, Pro is
  // revoked. Comped accounts (no stripe_customer_id) are never touched.
  if (action === 'reconcile_all') {
    const cronSecret = process.env.CRON_SECRET;
    const isCron = req.headers['x-vercel-cron'] === '1';
    const authHeader = req.headers['authorization'] || '';
    const qsecret = new URL(req.url, 'https://x').searchParams.get('secret') || '';
    // Fail CLOSED: a non-cron caller must present a valid cron secret. Do NOT make
    // the check contingent on CRON_SECRET being set — an unset secret must never
    // open this sweep (up to 500 Stripe calls; revokes Pro from lapsed subscribers)
    // to anonymous callers.
    if (!isCron) {
      const cronOk = !!cronSecret && (authHeader === `Bearer ${cronSecret}` || qsecret === cronSecret);
      if (!cronOk) return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!STRIPE_KEY || !SUPABASE_URL || !SERVICE_KEY) return res.status(503).json({ error: 'Payments not configured' });
    const q = db(SUPABASE_URL, SERVICE_KEY);
    // comped accounts are excluded outright — the sweep exists to catch lapsed
    // SUBSCRIBERS, and an admin grant is not a subscription.
    const listRes = await q(`ai_credits?pro=eq.true&comped=eq.false&stripe_customer_id=not.is.null&select=user_id,stripe_customer_id&limit=500`);
    const rows = listRes.ok ? await listRes.json() : [];
    let checked = 0, revoked = 0;
    // Bounded concurrency (8) so one Stripe call per user stays well within the function budget.
    for (let i = 0; i < rows.length; i += 8) {
      const batch = rows.slice(i, i + 8);
      await Promise.all(batch.map(async (row) => {
        checked++;
        try {
          const subRes = await fetch(`https://api.stripe.com/v1/subscriptions?customer=${encodeURIComponent(row.stripe_customer_id)}&status=all&limit=10`, { headers: { Authorization: `Bearer ${STRIPE_KEY}` } });
          if (!subRes.ok) return;
          const subs = (await subRes.json())?.data || [];
          const entitled = subs.some(s => ['active', 'trialing', 'past_due'].includes(s.status));
          if (!entitled) { await setPro(row.user_id, false, env); revoked++; }
        } catch { /* skip this user; the next sweep retries */ }
      }));
    }
    return res.status(200).json({ ok: true, checked, revoked });
  }

  // ── CREATE CHECKOUT SESSION ───────────────────────────────────────────────
  // ── EMPLOYER CHECKOUT (no login — email-based, Operation 50% Engine E4) ────────
  // Employers have no Seen account; they buy a one-time Featured Listing or Transparency
  // Verified enrollment by email. mode:'payment', inline price_data (no dashboard product).
  // Fulfillment records the purchase + emails the owner (see employerFulfillment.js). Routed
  // in confirm + webhook by metadata.kind === 'employer'.
  if (action === 'employer_checkout') {
    if (req.method !== 'POST') return res.status(405).end();
    if (!STRIPE_KEY) return res.status(503).json({ error: 'Payments not yet configured — contact hello@seenjobs.io.' });
    const skuKey = body.employer_sku;
    if (!skuKey || !EMPLOYER_SKUS[skuKey]) return res.status(400).json({ error: 'Unknown product' });
    const def = EMPLOYER_SKUS[skuKey];
    const email = String(body.email || '').trim().slice(0, 200);
    const company = String(body.company || '').trim().slice(0, 200);
    const target = String(body.target_url || '').trim().slice(0, 500);
    if (!email || !email.includes('@') || !company) return res.status(400).json({ error: 'Company and a valid email are required' });
    const origin = req.headers.origin || 'https://seenjobs.io';
    const form = new URLSearchParams({
      'payment_method_types[]': 'card',
      'line_items[0][quantity]': '1',
      mode: 'payment',
      success_url: `${origin}/employers?purchased=${skuKey}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/employers`,
      customer_email: email,
      allow_promotion_codes: 'true',
      'metadata[kind]': 'employer',
      'metadata[employer_sku]': skuKey,
      'metadata[company]': company,
      'metadata[email]': email,
      'metadata[target]': target,
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(def.amount_cents),
      'line_items[0][price_data][product_data][name]': `Seen — ${def.name}`,
    });
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

  // Return-page confirm for employer purchases — no login (employers have no account). Verifies
  // the session with Stripe and fulfills; shares the session-id idempotency with the webhook.
  if (action === 'employer_confirm') {
    if (req.method !== 'POST') return res.status(405).end();
    if (!STRIPE_KEY || !SUPABASE_URL || !SERVICE_KEY) return res.status(503).json({ error: 'Payments not configured' });
    const sessionId = String(body.session_id || '');
    if (!sessionId.startsWith('cs_')) return res.status(400).json({ error: 'Invalid session' });
    try {
      const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
        headers: { Authorization: `Bearer ${STRIPE_KEY}` },
      });
      if (!r.ok) return res.status(502).json({ error: 'Could not verify session' });
      const session = await r.json();
      if (!isEmployerSession(session)) return res.status(400).json({ error: 'Not an employer session' });
      const result = await fulfillEmployerCheckout(session, env);
      return res.status(200).json({ ok: !!result.ok, duplicate: !!result.duplicate });
    } catch (e) {
      console.error('[stripe/employer_confirm]', e.message);
      return res.status(500).json({ error: 'Confirm failed' });
    }
  }

  if (action === 'checkout') {
    if (req.method !== 'POST') return res.status(405).end();
    if (!STRIPE_KEY) return res.status(503).json({ error: 'Payments not yet configured — contact hello@seenjobs.io to upgrade.' });
    if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Server misconfigured' });

    const { uid, email } = await resolveUid(req, env);
    if (!uid) return res.status(401).json({ error: 'Sign in before upgrading' });

    // One-time SKUs (owner-approved 2026-07-04): 'sprint' and 'credits20'. Any other
    // non-empty sku is a client bug — reject rather than silently selling a subscription.
    if (body.sku && !ONE_TIME_SKUS[body.sku]) return res.status(400).json({ error: 'Unknown product' });
    const sku = body.sku && ONE_TIME_SKUS[body.sku] ? body.sku : null;

    const plan = body.plan === 'yearly' ? 'yearly' : 'monthly';
    // Use a pre-made Stripe price ID if one is configured; otherwise create the price
    // INLINE so no Products/prices setup is needed in the Stripe dashboard — the secret
    // key alone is enough to take subscriptions.
    const priceId = plan === 'yearly' ? process.env.STRIPE_PRICE_ID_YEARLY : process.env.STRIPE_PRICE_ID_MONTHLY;

    const origin = req.headers.origin || 'https://seenjobs.io';

    // Reuse an existing Stripe customer when we already have one (no duplicate customers).
    let existingCustomer = null;
    try {
      const credRes = await db(SUPABASE_URL, SERVICE_KEY)(`ai_credits?user_id=eq.${uid}&select=stripe_customer_id&limit=1`);
      if (credRes.ok) existingCustomer = (await credRes.json())?.[0]?.stripe_customer_id || null;
    } catch { /* ignore — new customer */ }

    const form = new URLSearchParams({
      'payment_method_types[]': 'card',
      'line_items[0][quantity]': '1',
      client_reference_id: uid,
      cancel_url: `${origin}/pricing`,
      'metadata[uid]': uid,
      allow_promotion_codes: 'true',
    });

    if (sku) {
      // ── ONE-TIME PURCHASE (mode: 'payment', inline price_data) ────────────────
      // Fulfilled by the webhook AND the return-page confirm (shared idempotency claim
      // on the session id) — see lib/server/stripeFulfillment.js.
      const def = ONE_TIME_SKUS[sku];
      form.set('mode', 'payment');
      // Include the session id + sku so the return page can confirm-fulfill and show
      // purchase-specific copy without a webhook.
      form.set('success_url', `${origin}/pricing?upgraded=1&purchase=${sku}&session_id={CHECKOUT_SESSION_ID}`);
      form.set('metadata[user_id]', uid);
      form.set('metadata[sku]', sku);
      form.set('line_items[0][price_data][currency]', 'usd');
      form.set('line_items[0][price_data][unit_amount]', String(def.amount_cents));
      form.set('line_items[0][price_data][product_data][name]', `Seen ${def.name}`);
    } else {
      // ── SUBSCRIPTION with a 7-day NO-CARD trial (owner-approved 2026-07-04) ───
      form.set('mode', 'subscription');
      // Include the session id so the return page can confirm + grant Pro without a webhook.
      form.set('success_url', `${origin}/pricing?upgraded=1&session_id={CHECKOUT_SESSION_ID}`);
      form.set('subscription_data[metadata][uid]', uid);
      if (priceId) {
        form.set('line_items[0][price]', priceId);
      } else {
        // Inline price — Seen Pro $9.99/mo or $83.88/yr. No dashboard product needed.
        const amount = plan === 'yearly' ? '8388' : '999';
        const interval = plan === 'yearly' ? 'year' : 'month';
        form.set('line_items[0][price_data][currency]', 'usd');
        form.set('line_items[0][price_data][unit_amount]', amount);
        form.set('line_items[0][price_data][recurring][interval]', interval);
        form.set('line_items[0][price_data][product_data][name]', 'Seen Pro');
      }
      // 7-day free trial, no card required: if no payment method is on file when the
      // trial ends, the subscription simply CANCELS (nobody is charged without a card);
      // if one was added, it renews at the plan price. Webhook keeps `pro` in lockstep.
      form.set('subscription_data[trial_period_days]', String(PRO_TRIAL_DAYS));
      form.set('subscription_data[trial_settings][end_behavior][missing_payment_method]', 'cancel');
      form.set('payment_method_collection', 'if_required');
    }
    if (existingCustomer) form.set('customer', existingCustomer);
    else if (email) form.set('customer_email', email);

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

    const { uid, email } = await resolveUid(req, env);
    if (!uid) return res.status(401).json({ error: 'Sign in first' });

    const customerId = await resolveCustomerId(uid, email, env);

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
    // rawBody captured at handler entry — the exact bytes Stripe signed.

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
        if (isEmployerSession(session)) {
          // Employer one-time purchase (no Seen account) — record it + notify the owner.
          // Idempotent via the unique stripe_session_id (shared with employer_confirm).
          const result = await fulfillEmployerCheckout(session, env);
          if (!result.ok && !result.duplicate) {
            if (event.id && SUPABASE_URL && SERVICE_KEY) {
              await db(SUPABASE_URL, SERVICE_KEY)(`stripe_events_processed?event_id=eq.${encodeURIComponent(event.id)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }).catch(() => {});
            }
            console.error('[stripe/webhook] employer fulfillment failed:', result.reason);
            return res.status(500).json({ error: 'Fulfillment failed' });
          }
        } else if (session.metadata?.sku) {
          // One-time SKU (mode: 'payment') — grant credits / pro_until, NOT the permanent
          // pro flag. Idempotent via the shared session-id claim (also used by confirm).
          const result = await fulfillOneTimeCheckout(session, env);
          if (!result.ok && !result.duplicate) {
            // Release the event-level idempotency row and 500 so Stripe redelivers —
            // otherwise a transient DB failure would eat a paid purchase forever.
            if (event.id && SUPABASE_URL && SERVICE_KEY) {
              await db(SUPABASE_URL, SERVICE_KEY)(`stripe_events_processed?event_id=eq.${encodeURIComponent(event.id)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }).catch(() => {});
            }
            console.error('[stripe/webhook] one-time fulfillment failed:', result.reason);
            return res.status(500).json({ error: 'Fulfillment failed' });
          }
        } else if (uid && SUPABASE_URL && SERVICE_KEY) {
          // Subscription checkout (incl. a $0 no-card trial start) → Pro on.
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

      // Trial ending in ~3 days. v1: log only — no email infra is configured (see
      // MONETIZATION_TODO.md item 3). The no-card trial cancels itself via
      // trial_settings.end_behavior, and subscription.updated keeps `pro` in lockstep.
      if (event.type === 'customer.subscription.trial_will_end') {
        const sub = event.data?.object || {};
        console.log(`[stripe/webhook] trial_will_end for uid=${getUid(sub) || 'unknown'} sub=${sub.id || '?'} trial_end=${sub.trial_end || '?'}`);
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
