// Metric-prompt engine — when a bullet is weak because it has no numbers, don't say "add [X]".
// Ask a SMART, role-specific question. Answers become CONFIRMED evidence (structured), which
// the bullet compiler may then use — never fabricated. Deterministic; no AI.

import { roleFamily } from './roleOntology.js';

const GENERIC_BY_CATEGORY = {
  skill: 'Roughly how often or at what volume did you do this (per shift, day, or week)?',
  tool: 'Which specific system/tool did you use for this, and how heavily?',
  soft_skill: 'Can you give one concrete situation where this mattered and what the outcome was?',
  credential: 'Do you currently hold this credential/license, and is it active?',
  experience: 'How long did you do this, and in what setting?',
};

// family: role-family key; assessments: transferability assessments; resume: parsed résumé.
// Returns [{ id, question, forRequirement, unit, category }].
export function generateQuestions({ family, transferability, resume }) {
  const fam = roleFamily(family);
  const questions = [];
  const seen = new Set();
  const add = (id, question, forRequirement, unit, category) => {
    const key = question.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    questions.push({ id, question, forRequirement: forRequirement || null, unit: unit || null, category: category || null });
  };

  // 1. Role-family metric questions (the "this knows the job" ones).
  if (fam) for (let i = 0; i < (fam.metrics || []).length; i++) {
    const m = fam.metrics[i];
    add(`fam_${family}_${i}`, m.q, null, m.unit, 'metric');
  }

  // 2. For weak / recoverable-missing requirements, ask a targeted question.
  const targets = [...(transferability?.weak || []), ...(transferability?.missingRecoverable || [])];
  let qi = 0;
  for (const a of targets.slice(0, 6)) {
    const q = GENERIC_BY_CATEGORY[a.category] || `Have you done anything that demonstrates "${a.requirement}"? If so, describe it briefly.`;
    add(`req_${qi++}`, `${a.requirement}: ${q}`, a.requirement, null, a.category);
  }

  // 3. If the résumé has NO metrics at all, prompt the single highest-value one.
  if ((resume?.metrics || []).length === 0 && fam && fam.metrics?.[0]) {
    add('no_metrics', fam.metrics[0].q, null, fam.metrics[0].unit, 'metric');
  }

  return questions.slice(0, 8);
}

// Turn a user's answer to a metric question into a structured, confirmed evidence node so it
// can be used exactly like a résumé-sourced fact (but tagged confirmed_by_user).
export function confirmedEvidenceFromAnswer(question, answer) {
  const val = String(answer || '').trim();
  if (!val) return null;
  return {
    id: `confirmed_${question.id}`,
    type: 'metric',
    label: val.slice(0, 120),
    normalizedLabel: 'confirmed_metric',
    value: val.slice(0, 120),
    evidenceText: `Confirmed by user: ${val.slice(0, 200)}`,
    source: 'confirmed_by_user',
    forRequirement: question.forRequirement || null,
    unit: question.unit || null,
    confidence: 0.9,
  };
}
