// THE one letter-grade scale. 80+ A · 65+ B · 50+ C · 35+ D · else F. Plain JS so server metadata
// (lib/companyMeta.ts), the OG image, the leaderboard, the share card and the page all import the same
// function (lib/companyDisplay.ts re-exports it for client code). Audit 2026-10-23: the page said
// "A · 91" while the share card said "A+" from a second 13-step scale.
//
// GRADE_BANDS is the same scale as data, so the public methods page (/methods) prints the bands the
// code uses instead of a hand-typed copy.
export const GRADE_BANDS = [
  { letter: 'A', min: 80 },
  { letter: 'B', min: 65 },
  { letter: 'C', min: 50 },
  { letter: 'D', min: 35 },
  { letter: 'F', min: 0 },
];

export function gradeLetter(score) {
  for (const band of GRADE_BANDS) if (score >= band.min) return band.letter;
  return 'F';
}
