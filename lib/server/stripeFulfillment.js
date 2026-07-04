// One-time SKU fulfillment for Stripe Checkout sessions (mode: 'payment').
//
// Called from BOTH delivery paths in api/stripe.js:
//   - webhook `checkout.session.completed` (authoritative, retried by Stripe)
//   - `action=confirm` on the post-checkout return page (works even without a webhook)
// Both paths share ONE idempotency claim keyed on the Checkout SESSION id (not the event
// id) in stripe_events_processed — whichever runs first grants; the other no-ops. If the
// grant write fails after the claim, the claim is released so a retry can fulfill.
//
// Grants (see lib/server/creditRules.js ONE_TIME_SKUS + migration 044):
//   - credits  → ai_credits.purchased_credits (NEVER `balance`, which the daily reset wipes)
//   - pro_days → ai_credits.pro_until = GREATEST(existing, now + pro_days)

import { ONE_TIME_SKUS, WELCOME_CREDITS } from './creditRules.js';

export function skuFromSession(session) {
  const sku = session?.metadata?.sku;
  return sku && ONE_TIME_SKUS[sku] ? sku : null;
}

export async function fulfillOneTimeCheckout(session, env) {
  const { SUPABASE_URL, SERVICE_KEY } = env;
  const sku = skuFromSession(session);
  const uid = session?.metadata?.uid || session?.metadata?.user_id || session?.client_reference_id;
  if (!sku || !uid || !SUPABASE_URL || !SERVICE_KEY) return { ok: false, reason: 'missing_sku_or_uid' };
  // One-time payments are synchronous card charges: only fulfill a PAID session.
  if (session.payment_status !== 'paid') return { ok: false, reason: 'not_paid' };

  const def = ONE_TIME_SKUS[sku];
  const q = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });

  // ── Idempotency claim on the session id (UNIQUE PK insert) ─────────────────
  const claimId = `fulfill_${session.id}`;
  const claim = await q('stripe_events_processed', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ event_id: claimId, event_type: `checkout_sku_${sku}` }),
  });
  if (claim.status === 409) return { ok: true, duplicate: true };
  if (claim.status === 400) {
    const t = await claim.text().catch(() => '');
    if (t.includes('duplicate') || t.includes('unique')) return { ok: true, duplicate: true };
  }
  if (!claim.ok && claim.status !== 201) return { ok: false, reason: 'claim_failed' };

  const releaseClaim = () =>
    q(`stripe_events_processed?event_id=eq.${encodeURIComponent(claimId)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }).catch(() => {});

  // ── Grant ───────────────────────────────────────────────────────────────────
  const rowRes = await q(`ai_credits?user_id=eq.${uid}&limit=1`);
  if (!rowRes.ok) { await releaseClaim(); return { ok: false, reason: 'row_read_failed' }; }
  const row = (await rowRes.json())?.[0] || null;

  const nowMs = Date.now();
  const newWindow = def.pro_days > 0 ? new Date(nowMs + def.pro_days * 86400e3).toISOString() : null;
  const today = new Date().toISOString().slice(0, 10);
  const ledger = (delta, reason) => q('credit_transactions', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ user_id: uid, delta, reason, metadata: { sku, session_id: session.id } }),
  }).catch(() => {});

  let proUntil = newWindow;
  if (!row) {
    // First-ever credit row. Include the welcome bonus the lazy gateAI creation would have
    // granted, so buying before the first AI use never costs the user their welcome credits
    // (gateAI only grants the bonus when NO row exists).
    const ins = await q('ai_credits?on_conflict=user_id', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        user_id: uid, balance: WELCOME_CREDITS, purchased_credits: def.credits,
        daily_earned: 0, last_reset: today, pro: false,
        ...(newWindow ? { pro_until: newWindow } : {}),
        ...(session.customer ? { stripe_customer_id: session.customer } : {}),
      }),
    });
    if (!ins.ok) { await releaseClaim(); return { ok: false, reason: 'row_insert_failed' }; }
    await ledger(WELCOME_CREDITS, 'welcome_bonus');
  } else {
    const patch = { purchased_credits: Math.max(0, row.purchased_credits || 0) + def.credits };
    if (newWindow) {
      // GREATEST(existing, now + pro_days) — stacking sprints never shortens a window.
      const existing = row.pro_until ? Date.parse(row.pro_until) : 0;
      proUntil = Number.isFinite(existing) && existing > Date.parse(newWindow) ? row.pro_until : newWindow;
      patch.pro_until = proUntil;
    }
    if (session.customer && !row.stripe_customer_id) patch.stripe_customer_id = session.customer;
    const up = await q(`ai_credits?user_id=eq.${uid}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(patch),
    });
    if (!up.ok) { await releaseClaim(); return { ok: false, reason: 'row_update_failed' }; }
  }
  await ledger(def.credits, `purchase_${sku}`);

  return { ok: true, sku, credits_added: def.credits, pro_until: def.pro_days > 0 ? proUntil : null };
}
