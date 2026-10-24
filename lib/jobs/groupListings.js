// One employer, one title, many addresses → one card.
//
// "customer service · Phoenix" returned a wall of 15+ "Customer Service Representative — plscareers"
// rows that differed only by street address (live audits 2026-10-23). Grouping is display-only: the
// page still holds and counts every row; the first row of a group (in the page's own order) leads
// the card and the rest are listed under it as "+N more locations". Different titles at the same
// employer stay separate cards.

const key = (j) => `${String(j?.company || '').toLowerCase().trim()}|${String(j?.title || '').toLowerCase().trim()}`;

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
