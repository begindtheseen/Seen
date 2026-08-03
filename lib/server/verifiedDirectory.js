// Pure shaper for the public "companies that respond" directory (Wave 3 — acquisition + makes the
// Transparency Verified badge worth buying). Joins active Verified perks (employer_perks.verified_until
// > now, migration 049) to their public company_scores, so the page lists currently-verified employers
// with the same public grade/response-rate candidates already see. No I/O — the page fetches, this shapes.
//
// INTEGRITY: Verified is a reviewed commitment badge, never a bought score. This page only DISPLAYS
// verified companies next to their real (unmodified) transparency numbers — it never ranks by, or
// implies, anything money changed. Companies with no score yet still list (badge earned; score pending).

// Canonical slug — the ONE scheme used everywhere (see CLAUDE.md): lower, spaces→hyphens, encoded.
export function companySlug(name) {
  return encodeURIComponent(String(name == null ? '' : name).toLowerCase().trim().replace(/\s+/g, '-'));
}

const norm = (s) => String(s == null ? '' : s).toLowerCase().trim().replace(/\s+/g, ' ');
const gradeOf = (s) => (s >= 80 ? 'A' : s >= 65 ? 'B' : s >= 50 ? 'C' : s >= 35 ? 'D' : 'F');
const pct = (v) => (v == null ? null : Math.round(v * 100));

/**
 * @param {Array<{company?:string, verified_until?:string|null}>} perks
 * @param {Array<{company_name?:string, overall_score?:number|null, ghost_rate?:number|null, response_rate?:number|null, report_count?:number}>} scores
 * @param {number} nowMs
 * @returns {Array<{company:string, slug:string, grade:string|null, score:number|null, responseRate:number|null, ghostRate:number|null, reportCount:number}>}
 */
export function shapeVerifiedDirectory(perks, scores, nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : 0;
  const scoreByName = new Map();
  for (const s of Array.isArray(scores) ? scores : []) {
    if (s && s.company_name) scoreByName.set(norm(s.company_name), s);
  }

  const seen = new Set();
  const out = [];
  for (const p of Array.isArray(perks) ? perks : []) {
    if (!p || !p.company) continue;
    const t = Date.parse(p.verified_until);
    if (!Number.isFinite(t) || t <= now) continue; // only CURRENTLY verified
    const key = norm(p.company);
    if (seen.has(key)) continue;
    seen.add(key);
    const sc = scoreByName.get(key) || null;
    const score = sc && typeof sc.overall_score === 'number' ? sc.overall_score : null;
    out.push({
      company: p.company,
      slug: companySlug(p.company),
      grade: score == null ? null : gradeOf(score),
      score,
      responseRate: sc ? pct(sc.response_rate) : null,
      ghostRate: sc ? pct(sc.ghost_rate) : null,
      reportCount: sc && typeof sc.report_count === 'number' ? sc.report_count : 0,
    });
  }

  // Best transparency first (highest score), unscored companies last, then alphabetical.
  out.sort((a, b) => {
    if (a.score == null && b.score == null) return a.company.localeCompare(b.company);
    if (a.score == null) return 1;
    if (b.score == null) return -1;
    return b.score - a.score || a.company.localeCompare(b.company);
  });
  return out;
}
