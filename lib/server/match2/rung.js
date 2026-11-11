// match2 — the rung a title states, on one scale for the person's roles and the listing.
//
// Built on the occupation module's levelOf (a rule over the title's own words) and the occupation's own name:
//   0 apprentice / trainee / intern / helper · 1 assistant / junior · 1.5 associate · 2 no level stated ·
//   3 senior / lead · 4 supervisor · 4.5 assistant manager · 5 manager · 6 director · 7 executive
// A grade numeral ("Respiratory Therapist II") is half a rung per grade above I. An occupation that IS a
// first-line supervisor ("Process Assistant" at Amazon → First-Line Supervisors of Helpers…) is at least a lead,
// whatever the title's words say; a helper occupation is at most an apprentice.
import { levelOf } from '../../occupations/index.js';

/** @param {number} rank levelOf's rank */
function rungOfRank(rank) {
  if (rank <= 0) return 0;
  if (rank <= 1.5) return 1;
  if (rank < 3) return 1.5;
  if (rank === 3) return 2;
  if (rank <= 5) return 3;
  if (rank < 6.5) return 4;
  if (rank < 7) return 4.5;
  if (rank < 8) return 5;
  if (rank < 9) return 6;
  return 7;
}

/**
 * @param {string} title
 * @param {{ title?: string } | null} [occ] the occupation the title was placed in (occupationOf)
 * @returns {{ rung: number, stated: boolean, marker: string|null }} stated: the title itself states a level
 */
export function rungOf(title, occ = null) {
  const t = String(title || '');
  const lv = levelOf(t);
  // "Senior X" is X with more years — half a rung, like a grade numeral; a lead / supervisor / manager is a rung each
  let rung = lv.marker === 'senior' && lv.rank < 4.5 ? 2.5 : rungOfRank(lv.rank);
  let stated = lv.marker != null;
  // levelOf adds a fraction for a grade numeral ("Phlebotomist II" 3.3): half a rung up — unless the number is a
  // school grade ("Grade 4 Teacher", "3rd Grade Teacher"), which is no level at all
  if (lv.rank > 3 && lv.rank < 4 && lv.marker == null) {
    if (/\bgrades?\b/i.test(t)) rung = 2;
    else { rung = 2.5; stated = true; }
  }
  const ot = String(occ?.title || '');
  if (/^First-Line Supervisors\b/.test(ot) && rung < 3) { rung = 3; stated = true; }
  if (/^Helpers\b/.test(ot) && rung > 0) { rung = 0; stated = true; }
  return { rung, stated, marker: lv.marker };
}
