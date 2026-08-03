// Fulfillment for employer one-time checkouts (Operation 50%, Engine E4). Called from BOTH Stripe
// delivery paths in api/stripe.js — the webhook `checkout.session.completed` and the return-page
// `action=confirm` — so it must be idempotent. Idempotency is the UNIQUE stripe_session_id on
// employer_purchases (migration 048): whichever path inserts first wins; the other's insert is
// ignored and reports duplicate:true.
//
// Fulfillment = RECORD the paid purchase + notify the owner. Applying it (featuring the listing /
// granting the Transparency Verified enrollment) is a deliberate owner action in admin — money
// never auto-grants a badge or touches a score.

import { EMPLOYER_SKUS } from './employerSkus.js';
import { broadcastActivity } from './realtime.js';

export function employerSkuFromSession(session) {
  const sku = session?.metadata?.employer_sku;
  return sku && EMPLOYER_SKUS[sku] ? sku : null;
}

export function isEmployerSession(session) {
  return session?.metadata?.kind === 'employer' && !!employerSkuFromSession(session);
}

async function notifyOwner(purchase, def) {
  const RESEND_KEY = process.env.RESEND_KEY || process.env.RESEND_API_KEY;
  const to = process.env.OWNER_EMAIL || process.env.ADMIN_EMAIL || process.env.NOTIFY_EMAIL;
  if (!RESEND_KEY || !to) return; // no-op until email is configured
  const amount = `$${((purchase.amount_cents || def.amount_cents) / 100).toFixed(2)}`;
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Featured is reach-only (no integrity concern) so it's applied automatically on payment; Verified
  // is a reviewed commitment badge and stays a deliberate admin action.
  const nextStep = def.kind === 'featured'
    ? 'Featured placement was applied automatically (company-wide, time-boxed). No action needed — reach only, never a score.'
    : def.kind === 'sponsor'
      ? 'Grant the Ghost Index sponsor slot in admin (single, exclusive slot — reviewed so it is never oversold). Reach/branding only, never a score or the ranking.'
      : 'Grant the Transparency Verified enrollment in admin after review. (Payment never auto-grants a badge or changes a score.)';
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Seen <noreply@seenjobs.io>',
        to: [to],
        subject: `💰 Employer purchase — ${def.name} (${amount})`,
        html: `<div style="font-family:-apple-system,sans-serif;font-size:14px;color:#111;line-height:1.7">
          <p><strong>${esc(def.name)}</strong> — ${amount}</p>
          <p>Company: <strong>${esc(purchase.company) || '—'}</strong><br/>
          Email: ${esc(purchase.email) || '—'}<br/>
          ${purchase.target_url ? `Listing: <a href="${esc(purchase.target_url)}">${esc(purchase.target_url)}</a><br/>` : ''}
          </p>
          <p>${nextStep}</p>
        </div>`,
      }),
    });
  } catch { /* best-effort */ }
}

// Auto-apply the Featured perk the moment payment clears — Featured is paid REACH (placement +
// badge), never a score change, so there's no reason to make the buyer wait on manual fulfillment.
// Company-keyed merge-upsert into employer_perks (same shape as the admin fulfill path in
// api/admin-stats.js), then flag the purchase fulfilled so it doesn't linger in the admin to-do.
// Best-effort: a failure here just leaves the purchase in the manual queue, never breaks checkout.
// Verified is deliberately NOT auto-granted — it's a reviewed commitment badge.
async function grantFeaturedPerk(purchase, def, env) {
  const { SUPABASE_URL, SERVICE_KEY } = env;
  const company = String(purchase.company || '').trim().toLowerCase();
  if (!company) return { ok: false, reason: 'no_company' };
  const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
  const until = new Date(Date.now() + (def.days || 30) * 86400e3).toISOString();
  try {
    const up = await fetch(`${SUPABASE_URL}/rest/v1/employer_perks?on_conflict=company`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ company, featured_until: until, updated_at: new Date().toISOString() }),
    });
    if (!up.ok) return { ok: false, reason: 'perk_upsert_failed' };
    await fetch(`${SUPABASE_URL}/rest/v1/employer_purchases?stripe_session_id=eq.${encodeURIComponent(purchase.stripe_session_id)}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'fulfilled', fulfilled_at: new Date().toISOString() }),
    });
    return { ok: true, until };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

export async function fulfillEmployerCheckout(session, env) {
  const { SUPABASE_URL, SERVICE_KEY } = env;
  const sku = employerSkuFromSession(session);
  if (!sku || !SUPABASE_URL || !SERVICE_KEY) return { ok: false, reason: 'missing_sku_or_creds' };
  if (session.payment_status !== 'paid') return { ok: false, reason: 'not_paid' };

  const def = EMPLOYER_SKUS[sku];
  const purchase = {
    stripe_session_id: session.id,
    employer_sku: sku,
    company: session.metadata?.company || null,
    email: session.customer_details?.email || session.metadata?.email || null,
    target_url: session.metadata?.target || null,
    amount_cents: def.amount_cents,
    status: 'paid',
  };

  // Idempotent insert on the unique session id. resolution=ignore-duplicates → a re-delivery
  // returns an empty representation, which is how we detect the duplicate.
  const res = await fetch(`${SUPABASE_URL}/rest/v1/employer_purchases?on_conflict=stripe_session_id`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=representation',
    },
    body: JSON.stringify(purchase),
  });
  if (!res.ok) return { ok: false, reason: 'insert_failed' };
  const rows = await res.json().catch(() => []);
  const isNew = Array.isArray(rows) && rows.length > 0;
  let featured_applied = false;
  if (isNew) {
    if (def.kind === 'featured') {
      const grant = await grantFeaturedPerk(purchase, def, env);
      featured_applied = !!grant.ok;
    }
    await notifyOwner(purchase, def);
    await broadcastActivity('purchase');
  }
  return { ok: true, duplicate: !isNew, sku, featured_applied };
}
