// Pure selector for the single sponsor slot on the Staffing Agency Ghost Index (/agencies), the
// beachhead hero asset. A sponsor is an employer_perks row with sponsor_until > now (granted by the
// owner in admin — a singular, visible slot, so it is a reviewed grant, never auto-sold twice).
//
// INTEGRITY: a sponsor buys a labeled brand slot ABOVE the index — it never enters the ranking, never
// changes any agency's ghost/response numbers, and the slot is always marked "Sponsored". This shaper
// only picks WHICH active sponsor to show; the page renders it as clearly-separated advertising.

/**
 * @param {Array<{company?:string, sponsor_until?:string|null}>} perks
 * @param {number} nowMs
 * @returns {{ company:string, until:string }|null}  the active sponsor with the longest remaining commitment, or null
 */
export function pickActiveSponsor(perks, nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : 0;
  let best = null;
  let bestT = -Infinity;
  for (const p of Array.isArray(perks) ? perks : []) {
    if (!p || !p.company || !p.sponsor_until) continue;
    const t = Date.parse(p.sponsor_until);
    if (!Number.isFinite(t) || t <= now) continue; // only currently-active sponsors
    if (t > bestT) { bestT = t; best = { company: p.company, until: p.sponsor_until }; }
  }
  return best;
}
