// Application Intelligence V2 — orchestrator. Runs the whole local pipeline and returns a
// single application package. "A compiler, not a chatbot": parse résumé → parse job → build
// evidence + transferability graph → simulate ATS → compile classified bullets → prompt for
// missing proof → assemble a strategy. NO external AI, NO runtime fetch anywhere in this
// module or its dependencies.

import { ENGINE_VERSION_V2, confidenceLabelV2 } from './types.js';
import { parseResumeV2 } from './resumeParserV2.js';
import { parseJobV2 } from './jobParserV2.js';
import { assessTransferability } from './transferabilityEngine.js';
import { simulateAts } from './atsSimulator.js';
import { compileBullets } from './bulletCompiler.js';
import { generateQuestions, confirmedEvidenceFromAnswer } from './metricPromptEngine.js';
import { checkInterviewDefense } from './interviewDefense.js';
import { roleFamily } from './roleOntology.js';
import { canonSkill } from './skillGraph.js';

const MATCH_QUALITY = { exact: 1, adjacent: 0.85, transferable: 0.65, weak: 0.3, missing: 0 };

function scoreFitV2({ transferability, ats, job, resume }) {
  const reqs = transferability.assessments;
  let wSum = 0, wCov = 0;
  for (const a of reqs) { wSum += a.weight; wCov += a.weight * (MATCH_QUALITY[a.matchType] || 0); }
  const coverage = wSum ? wCov / wSum : 0.6;

  // evidence strength: share of matched requirements backed by exact/transferable + metrics.
  const matched = reqs.filter(a => a.matchType !== 'missing' && a.matchType !== 'weak');
  const evidenceStrength = reqs.length
    ? Math.min(1, (matched.length / reqs.length) * (0.7 + 0.3 * Math.min(1, (resume.metrics || []).length / 3)))
    : 0.5;

  const titleAlign = job.roleFamily && resume.overallFamily ? (job.roleFamily === resume.overallFamily ? 1 : 0.55) : 0.6;

  // fatal-miss penalty
  const fatalMisses = transferability.missingRisky.filter(a => a.missSeverity === 'fatal').length;
  const penalty = Math.max(0.55, 1 - fatalMisses * 0.12);

  const raw = 100 * (0.45 * coverage + 0.28 * (ats.ats_score / 100) + 0.17 * evidenceStrength + 0.10 * titleAlign) * penalty;
  const fit_score = Math.max(8, Math.min(97, Math.round(raw)));

  // confidence: amount of real evidence + role clarity.
  const conf = Math.min(0.95, 0.3 + 0.35 * Math.min(1, matched.length / 4) + 0.2 * (job.roleFamilyConfidence || 0.5) + 0.15 * Math.min(1, (resume.metrics || []).length / 3));
  return { fit_score, coverage: Number(coverage.toFixed(3)), evidenceStrength: Number(evidenceStrength.toFixed(3)), titleAlign: Number(titleAlign.toFixed(2)), confidence: Number(conf.toFixed(2)), penalty: Number(penalty.toFixed(3)) };
}

// Recommend skills-section additions: canon skills with exact/transferable evidence that are
// NOT already in the résumé's skills section. Truthful — only evidenced skills.
function skillsRecommendation(resume, transferability) {
  const inSkills = new Set((resume.sections?.skills || []).join(' ').toLowerCase().match(/[a-z][a-z /.+#-]{2,}/g) || []);
  const rec = [];
  for (const a of transferability.assessments) {
    if (['exact', 'adjacent', 'transferable'].includes(a.matchType)) {
      const c = canonSkill(a.requirement);
      if (![...inSkills].some(s => s.includes(c))) rec.push({ skill: c, matchType: a.matchType, why: a.explanation });
    }
  }
  const seen = new Set();
  return rec.filter(r => (seen.has(r.skill) ? false : seen.add(r.skill))).slice(0, 10);
}

// Role-family-aware profile/summary suggestion built ONLY from proven strengths. No numbers
// unless the résumé proved them.
function summaryRecommendation(resume, job, transferability) {
  const fam = roleFamily(job.roleFamily || resume.overallFamily);
  const strengths = transferability.assessments
    .filter(a => ['exact', 'adjacent', 'transferable'].includes(a.matchType))
    .sort((a, b) => (b.weight * (MATCH_QUALITY[b.matchType])) - (a.weight * (MATCH_QUALITY[a.matchType])))
    .slice(0, 3).map(a => canonSkill(a.requirement));
  if (!strengths.length) return null;
  const roleWord = job.jobTitle ? job.jobTitle : (fam ? fam.label : 'the role');
  const text = `${fam ? fam.label + '-experienced' : 'Experienced'} candidate for ${roleWord}, with demonstrated ${strengths.slice(0, 3).join(', ')}.`;
  return { text, usesOnlyProvenStrengths: true, strengths };
}

function applicationMessageV2({ job, transferability }) {
  const top = transferability.assessments
    .filter(a => ['exact', 'transferable', 'adjacent'].includes(a.matchType))
    .slice(0, 2).map(a => canonSkill(a.requirement));
  const role = job.jobTitle || (roleFamily(job.roleFamily)?.label || 'this role');
  if (!top.length) {
    return `I'm applying for ${role} and would welcome the chance to walk you through how my experience fits. I can start quickly and am reliable and consistent.`;
  }
  return `I'm applying for ${role}. My background gives me real ${top.join(' and ')} experience, and I'd welcome the chance to show how it maps to what you need. I can start quickly and take the work seriously.`;
}

// input: { resumeText, jobDescription, jobTitle, company, confirmedAnswers?: [{id, forRequirement, unit, answer}], pro? }
export function buildApplicationPackage(input = {}) {
  const resume = parseResumeV2(input.resumeText || '');
  const job = parseJobV2(input.jobDescription || '', { jobTitle: input.jobTitle || '' });

  // Fold confirmed user answers into the résumé as confirmed evidence.
  const confirmedMetrics = new Set();
  const confirmedNodes = [];
  for (const q of input.confirmedAnswers || []) {
    const node = confirmedEvidenceFromAnswer({ id: q.id, forRequirement: q.forRequirement, unit: q.unit }, q.answer);
    if (node) { confirmedNodes.push(node); confirmedMetrics.add(node.value); }
  }
  if (confirmedNodes.length) { resume.evidenceNodes = [...(resume.evidenceNodes || []), ...confirmedNodes]; resume.metrics = [...(resume.metrics || []), ...confirmedNodes]; }

  const transferability = assessTransferability(resume, job);
  const ats = simulateAts({ resumeText: input.resumeText || '', resume, job, transferability });
  const compiled = compileBullets({ resume, job, transferability, confirmedMetrics });
  const questions = generateQuestions({ family: job.roleFamily || resume.overallFamily, transferability, resume });
  const fit = scoreFitV2({ transferability, ats, job, resume });

  // Interview-defense notes aggregated across all recommended bullets.
  const interviewDefense = [];
  for (const b of [...compiled.safe, ...compiled.needsConfirmation]) {
    for (const w of checkInterviewDefense(b.text, { resume, family: compiled.roleFamily, confirmedMetrics })) {
      interviewDefense.push({ bulletId: b.id, ...w });
    }
  }

  const summaryRec = summaryRecommendation(resume, job, transferability);
  const skillsRec = skillsRecommendation(resume, transferability);

  return {
    engine_version: ENGINE_VERSION_V2,
    legacy_seenfit_compatible: true,
    fit_score: fit.fit_score,
    confidence: fit.confidence,
    confidence_label: confidenceLabelV2(fit.confidence),
    role_family: compiled.roleFamily,
    role_family_label: roleFamily(compiled.roleFamily)?.label || 'General',

    // Match views (why you match / transferable proof / missing).
    why_you_match: transferability.exact.map(pubMatch),
    transferable_proof: transferability.transferable.map(pubMatch),
    weak_matches: transferability.weak.map(pubMatch),
    missing_recoverable: transferability.missingRecoverable.map(pubMatch),
    missing_risky: transferability.missingRisky.map(pubMatch),

    // ATS simulation.
    ats: {
      ats_score: ats.ats_score,
      exact_coverage: ats.exact_coverage,
      normalized_coverage: ats.normalized_coverage,
      missing_exact_keywords: ats.missing_exact_keywords,
      missing_required_keywords: ats.missing_required_keywords,
      notes: ats.notes,
      recommendations: ats.recommendations,
      disclaimer: ats.disclaimer,
    },

    // Compiled bullets, classified.
    safe_bullets: compiled.safe.map(pubBullet),
    needs_confirmation: compiled.needsConfirmation.map(pubBullet),
    not_recommended: compiled.notRecommended.map(pubBullet),
    unsupported: compiled.unsupported.map(pubBullet),

    // Strategy.
    summary_recommendation: summaryRec,
    skills_recommendation: skillsRec,
    application_message: applicationMessageV2({ job, transferability }),
    interview_defense: interviewDefense,
    questions_to_improve: questions,

    // Structured detail for the UI / debugging.
    fit_breakdown: fit,
    job_summary: {
      role_family: job.roleFamily, role_family_label: job.roleFamilyLabel, seniority: job.seniority,
      years_required: job.yearsRequired, schedule: job.schedule, physical: job.physical,
      remote: job.remote, credentials: job.credentials, disqualifiers: job.disqualifiers,
      required_count: (job.requirements || []).filter(r => r.importance === 'required').length,
      preferred_count: (job.requirements || []).filter(r => r.importance === 'preferred').length,
      responsibility_count: (job.requirements || []).filter(r => r.importance === 'responsibility').length,
    },
    resume_summary: {
      overall_family: resume.overallFamily,
      roles: (resume.roles || []).map(r => ({ id: r.id, title: r.title, employer: r.employer, dateRange: r.dateRange, current: r.current, family: r.family, bulletCount: r.bullets.length })),
      skill_count: (resume.skills || []).length,
      metric_count: (resume.metrics || []).length,
    },
  };
}

function pubMatch(a) {
  return { requirement: a.requirement, importance: a.importance, category: a.category, matchType: a.matchType, confidence: a.confidence, evidence: a.evidence, explanation: a.explanation, missSeverity: a.missSeverity };
}
function pubBullet(b) {
  // warnings from checkInterviewDefense are {code,severity,message} objects; the public/UI shape
  // is string[] (the human-readable message). Flatten so the client never receives an object where
  // it renders a string — an unflattened warning object crashed the Deep Dive render.
  const warnings = (b.warnings || [])
    .map((w) => (typeof w === 'string' ? w : (w && w.message) || ''))
    .filter(Boolean);
  return { id: b.id, type: b.type, text: b.text, evidenceUsed: b.evidenceUsed, requirementsAddressed: b.requirementsAddressed, matchType: b.matchType, confidence: b.confidence, riskLevel: b.riskLevel, whySafe: b.whySafe, classification: b.classification, confirmBeforeUsing: b.confirmBeforeUsing || [], warnings };
}

export { ENGINE_VERSION_V2 };
