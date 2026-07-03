// ATS-readability & keyword-coverage SIMULATOR. Deterministic, local. It does NOT claim to
// predict any specific vendor's ATS — it simulates the coverage/readability signals ATS
// systems and recruiters generally reward, and returns concrete, placement-level fixes.

import { canonSkill, hasWord } from './skillGraph.js';

const GENERIC_SOFT = new Set(['communication', 'teamwork', 'leadership', 'reliability', 'time management', 'problem solving', 'detail oriented', 'hard working']);

export function simulateAts({ resumeText, resume, job, transferability }) {
  const text = String(resumeText || '');
  const lower = text.toLowerCase();
  const skillsSection = (resume?.sections?.skills || []).join(' ').toLowerCase();

  const required = (job.requirements || []).filter(r => r.importance === 'required' && ['skill', 'tool', 'credential'].includes(r.category));
  const allKeyReqs = (job.requirements || []).filter(r => ['skill', 'tool', 'credential'].includes(r.category));

  const literallyPresent = (canon) => hasWord(lower, canon);
  const missing_exact_keywords = [...new Set(allKeyReqs.map(r => canonSkill(r.normalizedLabel)).filter(c => c && !literallyPresent(c)))];
  const missing_required = [...new Set(required.map(r => canonSkill(r.normalizedLabel)).filter(c => c && !literallyPresent(c)))];

  const exactCoverage = allKeyReqs.length ? allKeyReqs.filter(r => literallyPresent(canonSkill(r.normalizedLabel))).length / allKeyReqs.length : 0.7;
  // normalized coverage: exact OR transferable, from the transferability assessments.
  const byLabel = new Map((transferability?.assessments || []).map(a => [canonSkill(a.requirement), a.matchType]));
  const normalizedCoverage = allKeyReqs.length
    ? allKeyReqs.filter(r => ['exact', 'adjacent', 'transferable'].includes(byLabel.get(canonSkill(r.normalizedLabel)))).length / allKeyReqs.length
    : 0.75;

  // title alignment
  const titleAlign = job.roleFamily && resume.overallFamily
    ? (job.roleFamily === resume.overallFamily ? 1 : 0.5)
    : 0.6;

  // skill-section coverage of required
  const skillSectionCoverage = required.length
    ? required.filter(r => hasWord(skillsSection, canonSkill(r.normalizedLabel))).length / required.length
    : 0.6;

  const metricCount = (resume.metrics || []).length;

  const notes = [];
  const recommendations = [];
  if (missing_required.length) {
    notes.push(`Missing ${missing_required.length} required keyword(s) from the résumé text: ${missing_required.slice(0, 6).join(', ')}.`);
    for (const k of missing_required.slice(0, 4)) recommendations.push(`Add "${k}" to your Skills section AND to a bullet where you actually did it — ATS weights a keyword more when it appears in context, not just a skills list.`);
  }
  if (!skillsSection) recommendations.push('Add an explicit "Skills" section — many ATS parsers key off it for exact matches.');
  if (metricCount === 0) notes.push('No measurable numbers detected — bullets read as duties, not achievements.');

  // keyword stuffing: same canon appearing > 6 times
  const counts = {};
  for (const r of allKeyReqs) { const c = canonSkill(r.normalizedLabel); counts[c] = (lower.match(new RegExp(c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length; }
  const stuffed = Object.entries(counts).filter(([, n]) => n > 6).map(([k]) => k);
  if (stuffed.length) notes.push(`Possible keyword stuffing (${stuffed.join(', ')} repeated heavily) — ATS and recruiters both penalize unnatural repetition.`);

  // generic soft-skill overload in the skills section
  const softInSkills = [...GENERIC_SOFT].filter(s => skillsSection.includes(s));
  if (softInSkills.length >= 4) notes.push('Your Skills section leans on generic soft skills; lead with role-specific, hard nouns instead.');

  const ats_score = Math.round(100 * (
    0.34 * exactCoverage +
    0.24 * normalizedCoverage +
    0.16 * titleAlign +
    0.16 * skillSectionCoverage +
    0.10 * Math.min(1, metricCount / 3)
  ) - (stuffed.length ? 4 : 0));

  return {
    ats_score: Math.max(5, Math.min(98, ats_score)),
    exact_coverage: Number(exactCoverage.toFixed(3)),
    normalized_coverage: Number(normalizedCoverage.toFixed(3)),
    title_alignment: Number(titleAlign.toFixed(2)),
    skill_section_coverage: Number(skillSectionCoverage.toFixed(3)),
    missing_exact_keywords,
    missing_required_keywords: missing_required,
    metric_count: metricCount,
    notes,
    recommendations,
    disclaimer: 'Local ATS-readability and keyword-coverage simulation. It does not predict any specific employer ATS.',
  };
}
