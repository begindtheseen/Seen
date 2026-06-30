// Self-explaining HumanProof Score — every score explains itself (no black box).
//
// Given the 8 weighted human-signal sub-scores, produce the per-factor contribution
// breakdown (weight, raw 0–1, points contributed, plain-English reason) plus a one-line
// summary. The UI's "Why your HumanProof Score is X" panel renders this directly.
// GUARANTEE (asserted by tests): humanproof_score === sum(contribution.points), rounded.

import {
  HUMANPROOF_WEIGHTS, type HumanSignalBreakdown, type HumanProofContribution, type HumanProofFactor, type AiSlopRisk,
} from './types.ts';

const REASONS: Record<HumanProofFactor, (raw: number) => string> = {
  specificity: (r) => `Specificity is ${pct(r)} — concrete duties and real work context beat vague filler.`,
  natural_rhythm: (r) => `Natural rhythm is ${pct(r)} — varied sentence openers and lengths read more human than templated bullets.`,
  evidence_grounding: (r) => `Evidence grounding is ${pct(r)} — claims that match your résumé facts score higher; unsupported numbers/tools lower it.`,
  buzzword_control: (r) => `Buzzword control is ${pct(r)} — fewer generic AI/corporate phrases means a higher, more believable score.`,
  voice_consistency: (r) => `Voice consistency is ${pct(r)} — a steady person/tense reads like one real writer, not a stitched-together draft.`,
  interview_defensibility: (r) => `Interview defensibility is ${pct(r)} — lines you can explain out loud in an interview score higher.`,
  role_believability: (r) => `Role believability is ${pct(r)} — language that matches your actual role and level is more convincing.`,
  formatting_naturalness: (r) => `Formatting naturalness is ${pct(r)} — human formatting (not perfectly uniform, no shouting) reads real.`,
};

function pct(n: number): string {
  return `${Math.round((n || 0) * 100)}%`;
}

export function computeHumanProofScore(b: HumanSignalBreakdown): number {
  let score = 0;
  for (const k of Object.keys(HUMANPROOF_WEIGHTS) as HumanProofFactor[]) {
    score += HUMANPROOF_WEIGHTS[k] * (b[k] ?? 0);
  }
  return Math.max(0, Math.min(100, Math.round(score * 100)));
}

// Map a 0–100 HumanProof score to the AI-slop risk band. A LOW score means the text
// still reads generic/AI-style → HIGH slop risk; a HIGH score → LOW slop risk.
export function aiSlopRiskFromScore(score: number): AiSlopRisk {
  if (score >= 70) return 'low';
  if (score >= 45) return 'medium';
  return 'high';
}

export function explainHumanProof(b: HumanSignalBreakdown): {
  humanproof_score: number;
  ai_slop_risk: AiSlopRisk;
  summary: string;
  contributions: HumanProofContribution[];
  notes: string[];
} {
  const contributions: HumanProofContribution[] = (Object.keys(HUMANPROOF_WEIGHTS) as HumanProofFactor[]).map((k) => {
    const weight = HUMANPROOF_WEIGHTS[k];
    const raw = b[k] ?? 0;
    return {
      factor: k,
      weight,
      raw: Number(raw.toFixed(3)),
      points: Number((weight * raw * 100).toFixed(1)),
      reason: REASONS[k](raw),
    };
  });

  const humanproof_score = Math.max(0, Math.min(100, Math.round(contributions.reduce((s, c) => s + c.points, 0))));
  const ai_slop_risk = aiSlopRiskFromScore(humanproof_score);

  const sorted = [...contributions].sort((a, c) => c.points - a.points);
  const topDriver = sorted[0];
  const biggestGap = [...contributions].sort((a, c) => a.points / a.weight - c.points / c.weight)[0];

  const summary =
    `HumanProof Score ${humanproof_score}/100 (${ai_slop_risk} AI-slop risk). ` +
    `Strongest: ${labelOf(topDriver.factor)} (${topDriver.points} pts). ` +
    `Biggest opportunity: ${labelOf(biggestGap.factor)}.`;

  const notes: string[] = [];
  if (b.buzzword_control < 0.6) notes.push('Several generic/AI-style phrases remain — replacing them with specifics will raise the score.');
  if (b.evidence_grounding < 0.6) notes.push('Some claims aren\'t backed by your résumé — confirm or remove them before using.');
  if (b.interview_defensibility < 0.6) notes.push('A few lines would be hard to defend in an interview — make them concrete.');
  if (b.specificity < 0.5) notes.push('Add real work context (what you did, with what, for whom) to lift specificity.');

  return { humanproof_score, ai_slop_risk, summary, contributions, notes };
}

function labelOf(factor: string): string {
  return ({
    specificity: 'specificity',
    natural_rhythm: 'natural rhythm',
    evidence_grounding: 'evidence grounding',
    buzzword_control: 'buzzword control',
    voice_consistency: 'voice consistency',
    interview_defensibility: 'interview defensibility',
    role_believability: 'role believability',
    formatting_naturalness: 'formatting naturalness',
  } as Record<string, string>)[factor] || factor;
}
