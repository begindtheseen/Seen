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
import { canonSkill, normForMatch } from './skillGraph.js';
import { rewriteIsGrounded, isNounList } from '../optimizer/rewriteGuard.js';
import { isUsableKeyword } from './keywordFilter.js';

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
// Rules (live audit 2026-10-23 showed "with demonstrated sales, associates, associate."): each
// strength is ONE keyword (case/plural folded), a phrase a résumé can carry (keywordFilter), and
// present in the résumé's own text — never a posting word the résumé lacks; at most three, joined
// as a sentence ("sales and customer service experience"), never a comma list of nouns.
function summaryRecommendation(resume, job, transferability, resumeText = '') {
  const fam = roleFamily(job.roleFamily || resume.overallFamily);
  const resumeNorm = ` ${normForMatch(resumeText)} `;
  const seen = new Set();
  const strengths = [];
  for (const a of transferability.assessments
    .filter(a => ['exact', 'adjacent', 'transferable'].includes(a.matchType))
    .sort((a, b) => (b.weight * (MATCH_QUALITY[b.matchType])) - (a.weight * (MATCH_QUALITY[a.matchType])))) {
    const skill = canonSkill(a.requirement);
    const key = normForMatch(skill);
    if (!key || seen.has(key) || !isUsableKeyword(skill)) continue;
    if (!resumeNorm.includes(` ${key} `)) continue; // the résumé itself must say it
    seen.add(key);
    strengths.push(skill);
    if (strengths.length === 3) break;
  }
  if (!strengths.length) return null;
  const roleWord = job.jobTitle ? job.jobTitle : (fam ? fam.label : 'the role');
  const list = strengths.length === 1 ? strengths[0] : `${strengths.slice(0, -1).join(', ')} and ${strengths[strengths.length - 1]}`;
  const text = `${fam ? fam.label + '-experienced' : 'Experienced'} candidate for ${roleWord} with ${list} experience.`;
  if (isNounList(text)) return null; // cannot happen with ≤3 "and"-joined items; kept as the contract
  return { text, usesOnlyProvenStrengths: true, strengths };
}

// One row per requirement keyword: "customer service" listed as required AND preferred, or
// "ASSOCIATE" and "associates", collapse to the first (highest-ranked) row. Rows are already
// sorted by the caller's bucket order; the first occurrence wins.
function uniqueByRequirement(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows || []) {
    const key = normForMatch(canonSkill(r.requirement));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}
function excludeRequirements(rows, taken) {
  const keys = new Set((taken || []).map(r => normForMatch(canonSkill(r.requirement))));
  return (rows || []).filter(r => !keys.has(normForMatch(canonSkill(r.requirement))));
}

// No claim the résumé does not make: "I can start quickly" and "reliable and consistent" were
// templated promises (the audit saw them on a Director application) — gone. Strengths are
// deduped by keyword ("customer service and customer service").
function applicationMessageV2({ job, transferability }) {
  const seen = new Set();
  const top = [];
  for (const a of transferability.assessments.filter(a => ['exact', 'transferable', 'adjacent'].includes(a.matchType))) {
    const c = canonSkill(a.requirement);
    const k = normForMatch(c);
    if (!k || seen.has(k) || !isUsableKeyword(c)) continue;
    seen.add(k); top.push(c);
    if (top.length === 2) break;
  }
  const role = job.jobTitle || (roleFamily(job.roleFamily)?.label || 'this role');
  if (!top.length) {
    return `I'm applying for ${role} and would welcome the chance to walk you through how my experience fits.`;
  }
  return `I'm applying for ${role}. My background gives me real ${top.join(' and ')} experience, and I'd welcome the chance to show how it maps to what you need.`;
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

  const summaryRec = summaryRecommendation(resume, job, transferability, input.resumeText || '');
  const skillsRec = skillsRecommendation(resume, transferability);

  // Match lists: one row per keyword, and matched ∩ missing = ∅ — a requirement shown under
  // "Why you match" (or as transferable proof) can never also appear as missing.
  const whyYouMatch = uniqueByRequirement(transferability.exact);
  const transferableProof = excludeRequirements(uniqueByRequirement(transferability.transferable), whyYouMatch);
  const matchedRows = [...whyYouMatch, ...transferableProof];
  const weakMatches = excludeRequirements(uniqueByRequirement(transferability.weak), matchedRows);
  const missingRecoverable = excludeRequirements(uniqueByRequirement(transferability.missingRecoverable), matchedRows);
  const missingRisky = excludeRequirements(uniqueByRequirement(transferability.missingRisky), [...matchedRows, ...missingRecoverable]);

  // "Nothing invented" is checked, not promised: a compiled bullet is safe to use only when
  // every word it adds beyond its evidence already appears in the résumé or the posting. A
  // template that introduced its own words is downgraded to needs-confirmation and says why.
  const vocab = [input.resumeText || '', input.jobDescription || ''];
  const safeCompiled = [];
  const needsConfirmation = [...compiled.needsConfirmation];
  for (const b of compiled.safe) {
    const evidence = (b.evidenceUsed || []).join(' ');
    if (rewriteIsGrounded(evidence, b.text, vocab) && !isNounList(b.text)) { safeCompiled.push(b); continue; }
    needsConfirmation.push({
      ...b,
      classification: 'needs_confirmation',
      riskLevel: 'medium',
      whySafe: 'Worded by us from your evidence — read it as a draft and confirm every word is true before using it.',
      confirmBeforeUsing: [...(b.confirmBeforeUsing || []), 'Some wording here is not from your résumé or the posting — confirm it is true before using.'],
    });
  }

  return {
    engine_version: ENGINE_VERSION_V2,
    legacy_seenfit_compatible: true,
    fit_score: fit.fit_score,
    confidence: fit.confidence,
    confidence_label: confidenceLabelV2(fit.confidence),
    role_family: compiled.roleFamily,
    role_family_label: roleFamily(compiled.roleFamily)?.label || 'General',

    // Match views (why you match / transferable proof / missing).
    why_you_match: whyYouMatch.map(pubMatch),
    transferable_proof: transferableProof.map(pubMatch),
    weak_matches: weakMatches.map(pubMatch),
    missing_recoverable: missingRecoverable.map(pubMatch),
    missing_risky: missingRisky.map(pubMatch),

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
    safe_bullets: safeCompiled.map(pubBullet),
    needs_confirmation: needsConfirmation.map(pubBullet),
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
