// Employer-side one-time products (Operation 50%, Engine E4). Owner-locked prices. Plain JS so
// both the Vercel api/*.js handlers and the Next client can import the identical literals — copy
// on /employers renders from here, so it can never drift from what the checkout actually charges.
//
// INTEGRITY (load-bearing): buying these NEVER changes a company's transparency score. A Featured
// Listing buys reach (placement), not a better grade. Transparency Verified is an ENROLLMENT — the
// employer commits to responding to applicants; the badge is granted/reviewed by the owner and
// reflects that commitment + real outcome data, never the payment itself.

export const EMPLOYER_SKUS = {
  featured30: {
    name: 'Featured Placement',
    amount_cents: 7900, // $79
    days: 30,
    kind: 'featured',
    // Placement is company-keyed (employer_perks.company) — it boosts EVERY live role you have in
    // matching searches, not a single listing. Copy says so; the checkout charges from this literal.
    blurb: "30 days of priority placement for all your company's live roles on Seen.",
  },
  verified90: {
    name: 'Transparency Verified',
    amount_cents: 24900, // $249
    days: 90,
    kind: 'verified',
    blurb: '90-day Transparency Verified enrollment — publicly commit to responding to every applicant.',
  },
};

export const isEmployerSku = (sku) => !!(sku && Object.prototype.hasOwnProperty.call(EMPLOYER_SKUS, sku));

// Dollar label for UI ($79, $249) derived from the single source of truth.
export const employerPrice = (sku) =>
  isEmployerSku(sku) ? `$${(EMPLOYER_SKUS[sku].amount_cents / 100).toFixed(0)}` : null;
