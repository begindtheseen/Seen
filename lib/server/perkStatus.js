// Pure perk-expiry logic (Wave 3 — renewal awareness). Turns an employer_perks row (migration 049:
// featured_until / verified_until) into a per-perk state the dashboard uses to nudge renewal BEFORE
// the paid placement/badge silently lapses. No I/O — the endpoint fetches, this classifies.
//
// States: 'none' (never bought) · 'active' · 'expiring' (≤ EXPIRING_WINDOW_DAYS left) · 'expired'.
// Renewal reuses the existing one-time checkout — this never implies auto-charge (the locked pricing
// is one-time SKUs; this only makes lapses visible).

export const EXPIRING_WINDOW_DAYS = 7;
const DAY = 86400000;

function statusFor(until, now) {
  if (!until) return { state: 'none', until: null, daysLeft: null };
  const t = Date.parse(until);
  if (!Number.isFinite(t)) return { state: 'none', until: null, daysLeft: null };
  const daysLeft = Math.ceil((t - now) / DAY);
  if (t <= now) return { state: 'expired', until, daysLeft }; // daysLeft ≤ 0
  if (daysLeft <= EXPIRING_WINDOW_DAYS) return { state: 'expiring', until, daysLeft };
  return { state: 'active', until, daysLeft };
}

/**
 * @param {{featured_until?:string|null, verified_until?:string|null}|null} perk
 * @param {number} nowMs
 * @returns {{ featured: object, verified: object, anyRenewable: boolean }}
 */
export function perkStatus(perk, nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : 0;
  const featured = statusFor(perk && perk.featured_until, now);
  const verified = statusFor(perk && perk.verified_until, now);
  // "Renewable" = something is lapsing or already lapsed and worth re-buying.
  const renewable = (s) => s.state === 'expiring' || s.state === 'expired';
  return { featured, verified, anyRenewable: renewable(featured) || renewable(verified) };
}
