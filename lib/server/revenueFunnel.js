// Admin → "Revenue funnel": every step between a visitor and a paid purchase, counted from the tables
// that already record it, so revenue is arithmetic on counts instead of hope (owner, 2026-10-25: "a
// funnel that leaves our revenue up to laws of average").
//
//   guest email shown → given          funnel_events (components/track/CheckinEmailAsk.tsx)
//   sign-ups                           profiles.created_at
//   tracked an application             applications.user_id (distinct, created in the window)
//   reached an interview               applications.stage in the interview stages, updated in the window
//   pricing page views                 funnel_events pricing_view (app/pricing)
//   offers shown → pressed, by surface funnel_events offer_shown / offer_clicked (+ surface); the tracker
//                                      card's offer also counts its pre-migration name prep_offer_shown/_clicked
//   prep previews shown                funnel_events prep_preview_shown (components/tracker/InterviewPrep.tsx)
//   checkouts started → completed      funnel_events checkout_started / checkout_completed (+ sku)
//   prep built                         funnel_events prep_built (api/interview-prep.js)
//   purchases                          credit_transactions reason purchase_<sku> — the money, by product
//   paying customers                   DISTINCT users with a purchase in the window. A comped account or a
//                                      no-card trial never creates a purchase row, so neither is counted as
//                                      paying (until 2026-10-25 "paying subscribers" was every pro=true row
//                                      with a Stripe customer, which counted every no-card trial).
//
// Before migration 20261025120000 the funnel_events steps read null (not recording), never 0; before
// 20261025160000 the new steps (and the surface split) read null while the old ones still count.

import { ONE_TIME_SKUS } from './creditRules.js';
import { INTERVIEW_STAGES } from './interviewPrep.js';
import { OFFER_SURFACES } from './funnelEvents.js';

const rangeCount = (res) => {
  const v = parseInt(String(res?.headers?.get?.('content-range') || '').split('/')[1], 10);
  return Number.isFinite(v) ? v : null;
};

/** Ratio as a whole percent, or null when there is nothing to divide by. */
export function rate(n, of) {
  if (n == null || of == null || !of) return null;
  return Math.round((n / of) * 100);
}

const sum = (...v) => (v.every((x) => x == null) ? null : v.reduce((a, x) => a + (x || 0), 0));
const dollars = (count, sku) => (count == null ? null : Math.round(count * ONE_TIME_SKUS[sku].amount_cents) / 100);

/**
 * Monthly revenue the measured rates imply, at the current interview volume. Every input is a count
 * from the report; null when a step has no data yet. Priced at Interview Prep (the card's lead offer).
 */
export function impliedMonthly({ interviews, shown, clicked, purchases, days }) {
  const perPurchase = ONE_TIME_SKUS.interview.amount_cents / 100;
  if (!days || interviews == null || !shown || !clicked || purchases == null) return null;
  const perMonth = (interviews / days) * 30;
  const takeRate = (clicked / shown) * (purchases / clicked);
  return { interviews_per_month: Math.round(perMonth * 10) / 10, take_rate_pct: Math.round(takeRate * 1000) / 10, dollars: Math.round(perMonth * takeRate * perPurchase * 100) / 100 };
}

export async function loadRevenueFunnel(db, { days = 30, nowMs = Date.now() } = {}) {
  const d = [7, 30, 90, 365].includes(Number(days)) ? Number(days) : 30;
  const since = encodeURIComponent(new Date(nowMs - d * 86400e3).toISOString());
  const count = (path) => db(`${path}&limit=1`, { headers: { Prefer: 'count=exact' } }).then((r) => (r && r.ok ? rangeCount(r) : null)).catch(() => null);
  const ev = (event, extra = '') => count(`funnel_events?select=id&event=eq.${event}${extra}&created_at=gte.${since}`);
  const stages = encodeURIComponent(INTERVIEW_STAGES.map((s) => `"${s}"`).join(','));
  const bought = (sku) => count(`credit_transactions?select=id&reason=eq.purchase_${sku}&created_at=gte.${since}`);

  const [probe, steps2, signups, trackedRows, interviews, emailShown, emailGiven, legacyShown, legacyClicked, built,
    prepBuys, passBuys, packBuys, buyerRows, legacySubs] = await Promise.all([
    db('funnel_events?select=id&limit=1').then((r) => !!(r && r.ok)).catch(() => false),
    // The surface/sku columns exist only after migration 20261025160000.
    db('funnel_events?select=surface,sku&limit=1').then((r) => !!(r && r.ok)).catch(() => false),
    count(`profiles?select=id&created_at=gte.${since}`),
    db(`applications?select=user_id&created_at=gte.${since}&user_id=not.is.null&limit=10000`).then((r) => (r && r.ok ? r.json() : null)).catch(() => null),
    count(`applications?select=id&stage=in.(${stages})&status=eq.active&updated_at=gte.${since}`),
    ev('guest_email_shown'), ev('guest_email_given'),
    ev('prep_offer_shown'), ev('prep_offer_clicked'), ev('prep_built'),
    bought('interview'), bought('pass30'), bought('credits20'),
    db(`credit_transactions?select=user_id&reason=in.(purchase_interview,purchase_pass30,purchase_credits20)&created_at=gte.${since}&limit=10000`).then((r) => (r && r.ok ? r.json() : null)).catch(() => null),
    // Subscriptions started before 2026-10-25 that Stripe still marks Pro. Not "paying": a no-card trial
    // carries the same flag. Shown as its own line, never added to revenue.
    count('ai_credits?select=user_id&pro=eq.true&comped=eq.false&stripe_customer_id=not.is.null'),
  ]);
  const recording = probe;
  const split = recording && steps2;
  const n = (v) => (recording ? v : null);
  const n2 = (v) => (split ? v : null);

  // The new steps — one read each, and the offer split by surface.
  const [pricingViews, previews, checkoutStarted, checkoutDone, ...bySurface] = split ? await Promise.all([
    ev('pricing_view'), ev('prep_preview_shown'), ev('checkout_started'), ev('checkout_completed'),
    ...OFFER_SURFACES.flatMap((s) => [ev('offer_shown', `&surface=eq.${s}`), ev('offer_clicked', `&surface=eq.${s}`)]),
  ]) : [null, null, null, null];
  const surfaces = OFFER_SURFACES.map((s, i) => ({ surface: s, shown: n2(bySurface[i * 2] ?? null), clicked: n2(bySurface[i * 2 + 1] ?? null) }));
  const tracker = surfaces.find((x) => x.surface === 'tracker_prep');
  // The tracker card's offer: its old event name (before the migration) plus the new one.
  const prepShown = n(sum(legacyShown, tracker?.shown));
  const prepClicked = n(sum(legacyClicked, tracker?.clicked));

  const tracked = Array.isArray(trackedRows) ? new Set(trackedRows.map((r) => r.user_id)).size : null;
  const payingCustomers = Array.isArray(buyerRows) ? new Set(buyerRows.map((r) => r.user_id)).size : null;

  const steps = [
    { key: 'guest_email_shown', label: 'Guests asked for an email', n: n(emailShown) },
    { key: 'guest_email_given', label: 'Guests who gave one', n: n(emailGiven) },
    { key: 'signups', label: 'Sign-ups', n: signups },
    { key: 'tracked', label: 'Tracked an application', n: tracked },
    { key: 'interviews', label: 'Cards at an interview now', n: interviews },
    { key: 'prep_offer_shown', label: 'Saw the Interview Prep offer on a card', n: prepShown },
    { key: 'prep_preview_shown', label: 'Saw the free prep preview', n: n2(previews) },
    { key: 'prep_offer_clicked', label: 'Pressed it', n: prepClicked },
    { key: 'pricing_view', label: 'Opened /pricing', n: n2(pricingViews) },
    { key: 'checkout_started', label: 'Opened a checkout', n: n2(checkoutStarted) },
    { key: 'checkout_completed', label: 'Completed a checkout', n: n2(checkoutDone) },
    { key: 'prep_purchases', label: 'Bought Interview Prep', n: prepBuys },
    { key: 'pass_purchases', label: 'Bought the Job Search Pass', n: passBuys },
    { key: 'prep_built', label: 'Built a prep pack', n: n(built) },
  ];
  const revenueTotal = sum(dollars(prepBuys, 'interview'), dollars(passBuys, 'pass30'), dollars(packBuys, 'credits20'));
  return {
    ok: true,
    days: d,
    recording,
    recording_steps: split,
    steps,
    surfaces,
    rates: {
      email: rate(n(emailGiven), n(emailShown)),
      activation: rate(tracked, signups),
      offer_click: rate(prepClicked, prepShown),
      checkout: rate(prepBuys, prepClicked),
      checkout_completion: rate(n2(checkoutDone), n2(checkoutStarted)),
    },
    revenue: {
      interview_prep: dollars(prepBuys, 'interview'),
      job_search_pass: dollars(passBuys, 'pass30'),
      pass_count: passBuys,
      credit_pack: dollars(packBuys, 'credits20'),
      credit_pack_count: packBuys,
      total: revenueTotal == null ? null : Math.round(revenueTotal * 100) / 100,
      paying_customers: payingCustomers,
      legacy_subscriptions_marked_pro: legacySubs,
    },
    implied: impliedMonthly({ interviews, shown: prepShown, clicked: prepClicked, purchases: prepBuys, days: d }),
  };
}
