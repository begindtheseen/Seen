// Company-name duplicates for Admin → "Scan for dupes" / "Auto-merge" (api/admin-stats.js).
// Tests: lib/server/companyDupes.test.mjs.
//
// The scan used to read only the top 500 company_scores rows by report_count, so on prod (1,718 rows,
// 2026-10-20) it said "No duplicates" while three groups existed below the cut-off. It now reads all.
//
// Two levels of "same name":
//   • LISTED (broad): case, spacing and a trailing legal/structural word (Inc, LLC, Corp, Ltd, Co, PLC,
//     Group, Holdings, Enterprises, Solutions, Technologies) are ignored. Shown for a human to decide.
//   • AUTO-MERGED (strict): the names differ ONLY by case, spacing, punctuation and a legal-form suffix
//     (Inc, LLC, Corp, Corporation, Ltd, Co, PLC). "ShiftKey, LLC" = "ShiftKey"; but "Compass Group"
//     (food service) is NOT "Compass" (real estate) — "Group"/"Holdings"/… groups are listed only.

const BROAD_SUFFIX = /[\s,]+(inc\.?|llc\.?|corp\.?|ltd\.?|co\.|plc\.?|group|holdings|enterprises|solutions|technologies)\.?$/i;
const LEGAL_SUFFIX = /[\s,]+(inc|llc|l\.l\.c|corp|corporation|ltd|co|plc)\.?$/i;

export function broadKey(name) {
  return name ? String(name).toLowerCase().trim().replace(BROAD_SUFFIX, '').trim() : '';
}

export function strictKey(name) {
  let s = String(name || '').toLowerCase().trim();
  for (let prev = ''; prev !== s;) { prev = s; s = s.replace(LEGAL_SUFFIX, '').trim(); }
  return s.replace(/[^a-z0-9]+/g, '');
}

// rows: { id, name, report_count }. Groups of 2+ by broadKey, biggest first inside each group.
// `auto` = every member has the same strictKey, so a merge cannot join two different companies.
export function findCompanyDuplicates(rows) {
  const groups = new Map();
  for (const r of rows) {
    const k = broadKey(r.name);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return [...groups.entries()]
    .filter(([, g]) => g.length > 1)
    .map(([key, g]) => {
      const companies = [...g].sort((a, b) => (b.report_count || 0) - (a.report_count || 0) || String(a.id).localeCompare(String(b.id)));
      return { key, companies, auto: new Set(companies.map((c) => strictKey(c.name))).size === 1 };
    });
}
