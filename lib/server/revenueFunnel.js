// Admin → "Revenue funnel": every step between a visitor and a paid Interview Prep, counted from the
// tables that already record it, so revenue is arithmetic on counts instead of hope (owner, 2026-10-25:
// "a funnel that leaves our revenue up to laws of average").
//
//   guest email shown → given          funnel_events (components/track/CheckinEmailAsk.tsx)
//   sign-ups                           profiles.created_at
//   tracked an application             applications.user_id (distinct, created in the window)
//   reached an interview               applications.stage in the interview stages, updated in the window
//   prep offer shown → clicked         funnel_events (components/tracker/InterviewPrep.tsx)
//   prep built                         funnel_events (api/interview-prep.js)
//   Interview Prep bought              credit_transactions reason purchase_interview
//   Credit Pack bought                 credit_transactions reason purchase_credits20
//   paying subscribers (now)           ai_credits pro=true, not comped, with a Stripe customer
//
// Before migration 20261025120000 the funnel_events steps read null (not recording), never 0.

import { ONE_TIME_SKUS, PRO_PRICING } from './creditRules.js';
import { INTERVIEW_STAGES } from './interviewPrep.js';

const rangeCount = (res) => {
  const v = parseInt(String(res?.headers?.get?.('content-range') || '').split('/')[1], 10);
  return Number.isFinite(v) ? v : null;
};

/** Ratio as a whole percent, or null when there is nothing to divide by. */
export function rate(n, of) {
  if (n == null || of == null || !of) return null;
  return Math.round((n / of) * 100);
}

/**
 * Monthly revenue the measured rates imply, at the current interview volume. Every input is a count
 * from the report; null when a step has no data yet.
 */
export function impliedMonthly({ interviews, shown, clicked, prepPurchases, days }) {
  if (!days || interviews == null || !shown || !clicked || prepPurchases == null) return null;
  const perMonth = (interviews / days) * 30;
  const takeRate = (clicked / shown) * (prepPurchases / clicked);
  const price = ONE_TIME_SKUS.interview.amount_cents / 100;
  return { interviews_per_month: Math.round(perMonth * 10) / 10, take_rate_pct: Math.round(takeRate * 1000) / 10, dollars: Math.round(perMonth * takeRate * price * 100) / 100 };
}

export async function loadRevenueFunnel(db, { days = 30, nowMs = Date.now() } = {}) {
  const d = [7, 30, 90, 365].includes(Number(days)) ? Number(days) : 30;
  const since = encodeURIComponent(new Date(nowMs - d * 86400e3).toISOString());
  const count = (path) => db(`${path}&limit=1`, { headers: { Prefer: 'count=exact' } }).then((r) => (r && r.ok ? rangeCount(r) : null)).catch(() => null);
  const ev = (event) => count(`funnel_events?select=id&event=eq.${event}&created_at=gte.${since}`);
  const stages = encodeURIComponent(INTERVIEW_STAGES.map((s) => `"${s}"`).join(','));

  const [probe, signups, trackedRows, interviews, emailShown, emailGiven, shown, clicked, built, prepBuys, packBuys, subs] = await Promise.all([
    db('funnel_events?select=id&limit=1').then((r) => !!(r && r.ok)).catch(() => false),
    count(`profiles?select=id&created_at=gte.${since}`),
    db(`applications?select=user_id&created_at=gte.${since}&user_id=not.is.null&limit=10000`).then((r) => (r && r.ok ? r.json() : null)).catch(() => null),
    count(`applications?select=id&stage=in.(${stages})&status=eq.active&updated_at=gte.${since}`),
    ev('guest_email_shown'), ev('guest_email_given'),
    ev('prep_offer_shown'), ev('prep_offer_clicked'), ev('prep_built'),
    count(`credit_transactions?select=id&reason=eq.purchase_interview&created_at=gte.${since}`),
    count(`credit_transactions?select=id&reason=eq.purchase_credits20&created_at=gte.${since}`),
    count('ai_credits?select=user_id&pro=eq.true&comped=eq.false&stripe_customer_id=not.is.null'),
  ]);
  const recording = probe;
  const tracked = Array.isArray(trackedRows) ? new Set(trackedRows.map((r) => r.user_id)).size : null;
  const n = (v) => (recording ? v : null);

  const prepPrice = ONE_TIME_SKUS.interview.amount_cents / 100;
  const packPrice = ONE_TIME_SKUS.credits20.amount_cents / 100;
  const steps = [
    { key: 'guest_email_shown', label: 'Guests asked for an email', n: n(emailShown) },
    { key: 'guest_email_given', label: 'Guests who gave one', n: n(emailGiven) },
    { key: 'signups', label: 'Sign-ups', n: signups },
    { key: 'tracked', label: 'Tracked an application', n: tracked },
    { key: 'interviews', label: 'Cards at an interview now', n: interviews },
    { key: 'prep_offer_shown', label: 'Saw the Interview Prep offer', n: n(shown) },
    { key: 'prep_offer_clicked', label: 'Pressed it', n: n(clicked) },
    { key: 'prep_purchases', label: 'Bought Interview Prep', n: prepBuys },
    { key: 'prep_built', label: 'Built a prep pack', n: n(built) },
  ];
  return {
    ok: true,
    days: d,
    recording,
    steps,
    rates: {
      email: rate(n(emailGiven), n(emailShown)),
      activation: rate(tracked, signups),
      offer_click: rate(n(clicked), n(shown)),
      checkout: rate(prepBuys, n(clicked)),
    },
    revenue: {
      interview_prep: prepBuys == null ? null : Math.round(prepBuys * prepPrice * 100) / 100,
      credit_pack: packBuys == null ? null : Math.round(packBuys * packPrice * 100) / 100,
      credit_pack_count: packBuys,
      paying_subscribers_now: subs,
      monthly_price: PRO_PRICING.monthly,
    },
    implied: impliedMonthly({ interviews, shown: n(shown), clicked: n(clicked), prepPurchases: prepBuys, days: d }),
  };
}
