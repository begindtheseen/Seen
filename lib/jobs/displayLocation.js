// A listing's location as a person should read it — one place, not a board's whole office list.
//
// Employer boards store every office a role may sit in, joined with ";" or "|" and each one spelled out
// to the country ("Bozeman, Montana, United States; Missoula, Montana, United States; Open to Remote" —
// round-2 review 2026-11-02, printed raw on the card, the drawer, the page and the swipe card). Here:
//   • ", United States" / ", USA" / ", US" come off every part (Seen lists US jobs);
//   • one place prints as itself;
//   • several places print "Remote" when any part says remote, else the first place "· +N more";
//   • duplicates (the same town twice) count once.
// Used by JobCard, JobDetailDrawer, SwipeJobDeck and /jobs/[id]; never by the search or the geo code.
// Tests: lib/jobs/displayLocation.test.mjs.

const US_SUFFIX_RE = /,\s*(?:united states(?: of america)?|u\.s\.a\.?|usa|u\.s\.|us)\s*$/i;
const REMOTE_RE = /\bremote\b|\banywhere\b|work from home|\bwfh\b/i;

/** The parts of a stored location, each without its country suffix, in order and deduplicated. */
export function locationParts(location) {
  const seen = new Set();
  const out = [];
  for (const raw of String(location || '').split(/\s*(?:;|\||\s\/\s|\s•\s|\s·\s)\s*/)) {
    const p = raw.replace(US_SUFFIX_RE, '').replace(/\s+/g, ' ').trim();
    if (!p) continue;
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/**
 * @param {string|null|undefined} location
 * @returns {string} "" for nothing, "Remote", "Bozeman, Montana · +1 more", or the single place
 */
export function displayLocation(location) {
  const parts = locationParts(location);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  if (parts.some((p) => REMOTE_RE.test(p))) return 'Remote';
  return `${parts[0]} · +${parts.length - 1} more`;
}
