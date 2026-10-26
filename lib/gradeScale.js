// THE one letter-grade scale. Plain JS so server metadata (lib/companyMeta.ts), the OG image, the
// leaderboard, the share card and the page all import the same function (lib/companyDisplay.ts
// re-exports it for client code). Audit 2026-10-23: the page said "A · 91" while the share card said
// "A+" from a second 13-step scale.
//
// OWNER DECISION 2026-10-25: stricter fixed bands with ± steps (A needs 90+). The old scale (A at 80+)
// gave 67 of the top 150 an A and none an F. Scores themselves now lean toward a typical company
// until there is enough evidence (api/_utils/companyIntel.js POPULATION_PRIOR), so a grade means the
// same thing every day and a thin sample cannot reach the top or the bottom.
//
// GRADE_BANDS is the same scale as data, so the public methods page (/methods) prints the bands the
// code uses instead of a hand-typed copy.
export const GRADE_BANDS = [
  { letter: 'A+', min: 97 },
  { letter: 'A', min: 93 },
  { letter: 'A-', min: 90 },
  { letter: 'B+', min: 87 },
  { letter: 'B', min: 83 },
  { letter: 'B-', min: 80 },
  { letter: 'C+', min: 77 },
  { letter: 'C', min: 73 },
  { letter: 'C-', min: 70 },
  { letter: 'D+', min: 67 },
  { letter: 'D', min: 63 },
  { letter: 'D-', min: 60 },
  { letter: 'F', min: 0 },
];

export function gradeLetter(score) {
  for (const band of GRADE_BANDS) if (score >= band.min) return band.letter;
  return 'F';
}

/** The letter without its step ("B+" → "B"), for colour and tone. */
export function gradeBase(letter) {
  return String(letter || '').charAt(0) || null;
}

/**
 * The tone of a company grade, from its letter: A and B read as good, C as caution, D and F as bad
 * (audit 2026-10-25: a 40% ghost rate was labelled "SAFE" under a 70/40 cut that ignored the letter).
 */
export function gradeRisk(score) {
  if (score == null || !Number.isFinite(Number(score))) return null;
  const b = gradeBase(gradeLetter(Number(score)));
  return b === 'A' || b === 'B' ? 'safe' : b === 'C' ? 'warn' : 'danger';
}
