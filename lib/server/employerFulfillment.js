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
  const RESEND_KEY = process.env.RESEND_KEY;
  const to = process.env.OWNER_EMAIL || process.env.ADMIN_EMAIL || process.env.NOTIFY_EMAIL;
  if (!RESEND_KEY || !to) return; // no-op until email is configured
  const amount = `$${((purchase.amount_cents || def.amount_cents) / 100).toFixed(2)}`;
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
          <p>Fulfill it in admin: mark the listing featured / grant the Transparency Verified enrollment after review. (Payment never auto-grants a badge or changes a score.)</p>
        </div>`,
      }),
    });
  } catch { /* best-effort */ }
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
  if (isNew) { await notifyOwner(purchase, def); await broadcastActivity('purchase'); }
  return { ok: true, duplicate: !isNew, sku };
}
