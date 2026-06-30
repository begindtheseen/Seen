// Detect repeated bullet rhythm / sentence structure. NO external AI.
//
// Résumé-generator output often opens every bullet the same way ("Leveraged …",
// "Spearheaded …", "Utilized …") or uses the identical action-verb cadence on every
// line. That uniform rhythm reads machine-generated. We measure:
//   - repeated opening words across bullets/lines
//   - low variety in bullet length
//   - repeated overall structure (same first verb)
// and emit a flag plus a 0–1 "rhythm naturalness" score (1 = varied/natural).

import type { HumanProofFlag } from './types.ts';

export interface RepetitionResult {
  flags: HumanProofFlag[];
  naturalRhythm: number; // 0–1, higher = more natural variation
}

// Split text into bullet-like lines (handles •, -, *, numbered, or newline-separated).
export function splitBullets(text: string): string[] {
  return String(text || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^[\s•\-*•▪‣]+/, '').replace(/^\d+[.)]\s*/, '').trim())
    .filter((l) => l.length > 0);
}

function firstWord(line: string): string {
  const m = line.trim().match(/^([A-Za-z][A-Za-z'-]*)/);
  return m ? m[1].toLowerCase() : '';
}

export function detectRepetition(text: string): RepetitionResult {
  const lines = splitBullets(text);
  const flags: HumanProofFlag[] = [];

  // Single line or empty → nothing to compare; treat rhythm as neutral-high.
  if (lines.length < 2) return { flags, naturalRhythm: 0.85 };

  // 1. Repeated opening words.
  const openers = lines.map(firstWord).filter(Boolean);
  const openerCounts = new Map<string, number>();
  for (const w of openers) openerCounts.set(w, (openerCounts.get(w) || 0) + 1);
  let maxOpener = 0;
  let repeatedOpener = '';
  for (const [w, c] of openerCounts) {
    if (c > maxOpener) { maxOpener = c; repeatedOpener = w; }
  }
  const openerRepeatRatio = openers.length ? maxOpener / openers.length : 0;
  const distinctOpenerRatio = openers.length ? openerCounts.size / openers.length : 1;

  if (maxOpener >= 2 && openerRepeatRatio >= 0.5) {
    flags.push({
      flagType: 'repetition',
      severity: openerRepeatRatio >= 0.75 ? 'high' : 'medium',
      originalPhrase: repeatedOpener,
      explanation: `Most bullets start the same way ("${repeatedOpener}…"). Varying how lines open reads more natural.`,
      suggestedFix: 'Start some lines with the task or context instead of the same verb.',
    });
  }

  // 2. Low length variety (every bullet nearly identical length → templated).
  const lens = lines.map((l) => l.length);
  const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
  const variance = lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0; // coefficient of variation
  const lengthVariety = Math.max(0, Math.min(1, cv / 0.4)); // cv of ~0.4 → fully varied

  // Compose a 0–1 naturalness score from opener variety and length variety.
  const naturalRhythm = Number(
    Math.max(0, Math.min(1, distinctOpenerRatio * 0.6 + lengthVariety * 0.4)).toFixed(3)
  );

  return { flags, naturalRhythm };
}
