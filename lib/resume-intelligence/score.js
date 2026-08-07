// Resume Intelligence Engine — EXPLAINABLE SCORING (Phase 11).
//
// Replaces the old arbitrary fit number with a composite of named, defensible dimensions — each
// 0..1, weighted, and self-explaining (the UI can show exactly why points were gained or lost).
// The composite shape is adapted from Resume-Matcher (Apache-2.0: keyword-coverage + skills-coverage
// + section-completeness), re-weighted so CRITICAL (required) coverage dominates and honest evidence
// matters. It NEVER claims to guarantee passing a real employer's ATS. Pure + deterministic.

import { QUALITY } from './match.js';
import { normSurface } from './taxonomy.js';

export const WEIGHTS = {
  critical_coverage: 0.30,   // required-level requirements the résumé actually covers
  requirement_coverage: 0.20, // all scored requirements, quality-weighted
  skill_alignment: 0.15,     // skill/tool/soft-skill category coverage
  experience_relevance: 0.12, // role-family alignment
  evidence_strength: 0.10,   // share of matches backed by strong, metric-bearing evidence
  terminology_alignment: 0.08, // exact JD terms present verbatim (what keyword ATS scanners see)
  ats_parseability: 0.05,    // résumé is structured enough to be machine-read
};

const coverage = (reqs, matches) => {
  const byId = new Map(matches.map((m) => [m.requirementId, m]));
  let w = 0, c = 0;
  for (const r of reqs) {
    const m = byId.get(r.id);
    w += r.importance;
    c += r.importance * (QUALITY[m?.matchType] ?? 0);
  }
  return w ? c / w : 1; // no requirements of this kind → not penalized
};

function terminology(jobProfile, resume) {
  const terms = jobProfile.requirements
    .filter((r) => r.requirementLevel === 'REQUIRED' && ['skill', 'tool', 'software', 'hard_skill', 'operational', 'soft_skill'].includes(r.category))
    .map((r) => normSurface(r.displayName)).filter((t) => t.length >= 3);
  if (!terms.length) return 1;
  const hay = normSurface(resume.evidenceText + ' ' + (resume.skills || []).map((s) => s.surface).join(' '));
  let hit = 0;
  for (const t of terms) { const re = new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b'); if (re.test(hay)) hit++; }
  return hit / terms.length;
}

function parseability(resume) {
  let s = 0;
  if ((resume.experiences || []).length) s += 0.4;
  if ((resume.skills || []).length) s += 0.2;
  if ((resume.evidenceSentences || []).length >= 3) s += 0.2;
  if ((resume.experiences || []).some((e) => e.dateRange)) s += 0.1;
  if (resume.education?.length || resume.certifications?.length) s += 0.1;
  return Math.min(1, s);
}

export function scoreMatch({ jobProfile, resume, matchResult }) {
  const reqs = jobProfile.requirements.filter((r) => r.requirementLevel !== 'CONTEXTUAL');
  const criticalReqs = reqs.filter((r) => r.requirementLevel === 'REQUIRED');
  const skillReqs = reqs.filter((r) => ['skill', 'tool', 'software', 'hard_skill', 'operational', 'soft_skill'].includes(r.category));
  const matches = matchResult.matches;

  const dims = {
    critical_coverage: coverage(criticalReqs, matches),
    requirement_coverage: coverage(reqs, matches),
    skill_alignment: coverage(skillReqs, matches),
    experience_relevance: jobProfile.roleFamily && resume.overallFamily
      ? (jobProfile.roleFamily === resume.overallFamily ? 1 : 0.5) : 0.6,
    evidence_strength: (() => {
      const strong = matches.filter((m) => ['EXACT_MATCH', 'ALIAS_MATCH', 'TRANSFERABLE_MATCH'].includes(m.matchType));
      if (!matches.length) return 0.5;
      const base = strong.length / matches.length;
      const metricBoost = Math.min(1, (resume.metricCount || 0) / 3);
      return Math.min(1, base * (0.7 + 0.3 * metricBoost));
    })(),
    terminology_alignment: terminology(jobProfile, resume),
    ats_parseability: parseability(resume),
  };

  const contributions = Object.entries(WEIGHTS).map(([dimension, weight]) => {
    const value = Math.max(0, Math.min(1, dims[dimension] ?? 0));
    const points = Math.round(weight * value * 100);
    return { dimension, weight, value: Number(value.toFixed(3)), points, reason: reasonFor(dimension, value) };
  });

  const overall = contributions.reduce((s, c) => s + c.points, 0);

  return {
    overallScore: Math.max(3, Math.min(99, overall)),
    dimensions: dims,
    contributions,
    disclaimer: 'This score reflects how well your résumé evidences THIS posting’s requirements. It does not predict or guarantee any specific employer’s ATS outcome.',
  };
}

function reasonFor(dim, v) {
  const pct = Math.round(v * 100);
  switch (dim) {
    case 'critical_coverage': return `${pct}% of the must-have requirements are backed by real résumé evidence.`;
    case 'requirement_coverage': return `${pct}% of all requirements are covered, weighted by importance.`;
    case 'skill_alignment': return `${pct}% of the role’s skills line up with what your résumé proves.`;
    case 'experience_relevance': return v >= 1 ? 'Your background is in the same field as the role.' : v >= 0.5 ? 'Your background is adjacent to the role’s field.' : 'Your field differs from the role’s.';
    case 'evidence_strength': return `${pct}% strength — how much of your match is proven work with concrete results, not just keywords.`;
    case 'terminology_alignment': return `${pct}% of the exact terms a keyword scanner looks for already appear in your résumé.`;
    case 'ats_parseability': return `${pct}% — your résumé is structured enough (sections, dates, skills) to be machine-read cleanly.`;
    default: return '';
  }
}
