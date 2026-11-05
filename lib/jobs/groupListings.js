// One employer, one title, many addresses → one card.
//
// "customer service · Phoenix" returned a wall of 15+ "Customer Service Representative — plscareers"
// rows that differed only by street address (live audits 2026-10-23). Grouping is display-only: the
// page still holds and counts every row; the first row of a group (in the page's own order) leads
// the card and the rest are listed under it as "+N more locations". Different titles at the same
// employer stay separate cards.

// A board that posts one role once per city puts the city in the TITLE: Speechify's "Team Lead, Android
// Core Product - Cleveland, OH, USA" / "- Atlanta, GA, USA" / … (46 rows in one Remote search, round 3,
// 2026-11-03); DashMart's "Site Manager, DashMart - [Nashville, TN]"; Target's "Specialty Sales Team
// Leader- (Tempe, AZ)". The clause is a place when it follows a dash / pipe / colon or sits in brackets
// and reads "<Place>, <ST|State|Country>[, USA]" or "Remote …". Up to two clauses come off.
const PLACE_CLAUSE = String.raw`(?:Remote\b[^()\[\]]*|[A-Z][\w.'’ -]*(?:,\s*[A-Z][\w.'’ ]*){1,2})`;
const TRAIL_RE = new RegExp(String.raw`\s*(?:[-–—|:]\s*|\bin\s+)${PLACE_CLAUSE}\s*$`);
const BRACKET_RE = new RegExp(String.raw`\s*[\[(]\s*${PLACE_CLAUSE}\s*[\])]\s*$`);
/** The title without a trailing location clause; trailing separators are trimmed. */
export function stripTitleLocation(title) {
  let t = String(title || '').trim();
  for (let i = 0; i < 2; i++) {
    const n = t.replace(BRACKET_RE, '').replace(TRAIL_RE, '').replace(/[\s\-–—|:,]+$/, '').trim();
    if (n === t || n.length < 3) break;
    t = n;
  }
  return t;
}
/** The role identity a group shares: the employer and the title minus its location clause. */
export const roleKey = (j) => `${String(j?.company || '').toLowerCase().trim()}|${stripTitleLocation(j?.title).toLowerCase()}`;
const key = roleKey;

/**
 * One row per employer + role: a listing posted once per city collapses onto its first row, which carries
 * `also_in` (how many other locations it was posted for). Order and every other row are unchanged. The
 * server applies this to a Remote search (api/jobs.js serve()), where every copy is the same remote job.
 * @template T
 * @param {T[]} rows
 * @returns {(T & { also_in?: number })[]}
 */
export function collapseLocationVariants(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const first = new Map();
  const out = [];
  for (const j of list) {
    if (!j) continue;
    const k = key(j);
    const kept = first.get(k);
    if (kept) { kept.also_in = (kept.also_in || 0) + 1; continue; }
    const copy = { ...j };
    first.set(k, copy);
    out.push(copy);
  }
  return out;
}

/**
 * @template T
 * @param {T[]} rows in display order
 * @returns {{ lead: T, more: T[] }[]} one entry per employer+title, in the order of each group's first row
 */
export function groupListings(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const groups = new Map();
  const out = [];
  for (const j of list) {
    if (!j) continue;
    const k = key(j);
    const g = groups.get(k);
    if (g) { g.more.push(j); continue; }
    const entry = { lead: j, more: [] };
    groups.set(k, entry);
    out.push(entry);
  }
  return out;
}
