// Wilson score interval for a binomial proportion — a grounded, sample-size-aware confidence
// interval for a rate like the ghost rate. Pure, dependency-free (the wilson-score-rank npm package
// reimplemented from Evan Miller's "How Not To Sort By Average Rating"), so it's unit-testable.
//
// WHY (competitive-research finding, agents 2 & 6): a raw rate treats 2/2 ghosts (100%) the same as
// 40/50 (80%), when the former is far less certain. The Wilson LOWER bound is a confidence-discounted
// rate — it collapses "how high is the rate" and "how sure are we" into one number that is naturally
// gaming-resistant on small n (a two-report brigade can't manufacture a confident 100% ghost rate).
// The interval WIDTH is also an honest confidence signal ("we can only say 34–100% so far").
//
// Fed ONLY raw first-party counts (see api/_utils/companyIntel.js) — never a blended/reconstructed
// rate, which would be a fabricated input.

const DEFAULT_Z = 1.96; // ~95% confidence

/**
 * Wilson score interval for `pos` successes out of `n` trials.
 * @param {number} pos  successes (e.g. ghosted outcomes)
 * @param {number} n    total trials (e.g. resolved reports)
 * @param {number} [z]  z-score (default 1.96 ≈ 95%)
 * @returns {{ lower:number, upper:number, n:number }}  bounds clamped to [0,1]; n<=0 → full [0,1] (max uncertainty)
 */
export function wilsonInterval(pos, n, z = DEFAULT_Z) {
  const trials = Math.max(0, Math.floor(Number(n) || 0));
  if (trials <= 0) return { lower: 0, upper: 1, n: 0 };
  const successes = Math.min(trials, Math.max(0, Math.floor(Number(pos) || 0)));
  const phat = successes / trials;
  const z2 = z * z;
  const denom = 1 + z2 / trials;
  const center = (phat + z2 / (2 * trials)) / denom;
  const margin = (z / denom) * Math.sqrt((phat * (1 - phat)) / trials + z2 / (4 * trials * trials));
  const clamp = (x) => Math.max(0, Math.min(1, x));
  return { lower: clamp(center - margin), upper: clamp(center + margin), n: trials };
}

/** Wilson LOWER bound — the confidence-discounted rate. */
export function wilsonLowerBound(pos, n, z = DEFAULT_Z) {
  return wilsonInterval(pos, n, z).lower;
}
