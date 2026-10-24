// THE one letter-grade scale. 80+ A · 65+ B · 50+ C · 35+ D · else F. Plain JS so server metadata
// (lib/companyMeta.ts), the OG image, the leaderboard, the share card and the page all import the same
// function (lib/companyDisplay.ts re-exports it for client code). Audit 2026-10-23: the page said
// "A · 91" while the share card said "A+" from a second 13-step scale.
export function gradeLetter(score) {
  if (score >= 80) return 'A';
  if (score >= 65) return 'B';
  if (score >= 50) return 'C';
  if (score >= 35) return 'D';
  return 'F';
}
