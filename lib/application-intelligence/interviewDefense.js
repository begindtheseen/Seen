// Interview defense — before any bullet is recommended, check it is DEFENSIBLE: could the
// user explain it in an interview without overclaiming? Flags management/ownership implied by
// participation-only evidence, tools not in the résumé, unconfirmed metrics, and seniority
// creep. Deterministic; no AI.

import { canonSkill } from './skillGraph.js';
import { roleFamily } from './roleOntology.js';

const MGMT_RE = /\b(managed|led|directed|oversaw|supervised|owned the|headed|ran the)\b/i;
const STRATEGY_RE = /\b(strategy|roadmap|vision|p&l|budget ownership)\b/i;
const METRIC_RE = /(\$\s?\d[\d,]*(?:\.\d+)?\s*(?:k\b|m\b|million|billion|\/hr)?|\d[\d,]*(?:\.\d+)?\s*%|\d[\d,]*\+?(?:\s+[a-z]+){0,2}\s+(?:customers?|clients?|guests?|vehicles?|tickets?|calls?|orders?|deliveries|stops?|packages?|patients?|users?|accounts?|reports?|invoices?|forms?|records?|employees?|transactions?|shifts?|routes?|items?|units?|hours?))/i;
const KNOWN_TOOLS = ['salesforce', 'quickbooks', 'sap', 'tableau', 'power bi', 'excel', 'jira', 'zendesk', 'epic', 'cerner', 'netsuite', 'workday'];

// resume: parsed résumé (skills[], evidenceNodes[], metrics[]); confirmedMetrics: Set of
// confirmed metric strings. Returns [{ code, severity, message }].
export function checkInterviewDefense(bulletText, { resume, family, confirmedMetrics = new Set() } = {}) {
  const warnings = [];
  const text = String(bulletText || '');
  const lower = text.toLowerCase();
  const resumeSkills = new Set((resume?.skills || []).map(canonSkill));
  const resumeText = (resume?.evidenceNodes || []).map(n => n.evidenceText).join(' ').toLowerCase()
    + ' ' + Object.values(resume?.sections || {}).flat().join(' ').toLowerCase();

  // 1. Management / ownership implied without leadership evidence.
  const hasLeadershipEvidence = resumeSkills.has('leadership') || resumeSkills.has('team management') || /\b(managed|led|supervis|trained \d|mentored)\b/i.test(resumeText);
  if (MGMT_RE.test(text) && !hasLeadershipEvidence) {
    warnings.push({ code: 'implies_management', severity: 'high', message: 'This sounds like management, but your résumé only proves individual-contributor work. Use "supported", "coordinated", or "assisted" unless you actually led people.' });
  }
  if (STRATEGY_RE.test(text) && !/\b(strategy|roadmap|owned|budget)\b/i.test(resumeText)) {
    warnings.push({ code: 'implies_strategy', severity: 'medium', message: 'This implies strategy/ownership beyond what the résumé shows.' });
  }

  // 2. Tool named that is not in the résumé.
  for (const tool of KNOWN_TOOLS) {
    if (lower.includes(tool) && !resumeText.includes(tool) && !resumeSkills.has(canonSkill(tool))) {
      warnings.push({ code: 'unlisted_tool', severity: 'high', message: `This names "${tool}", which is not in your résumé. Only claim tools you have actually used.` });
    }
  }

  // 3. Metric present but not proven by the résumé and not confirmed by the user.
  const m = METRIC_RE.exec(text);
  if (m) {
    const metricStr = m[1].trim();
    const inResume = (resume?.metrics || []).some(n => (n.value || '').replace(/\s+/g, '') === metricStr.replace(/\s+/g, ''))
      || resumeText.includes(metricStr.toLowerCase());
    const confirmed = confirmedMetrics.has(metricStr) || [...confirmedMetrics].some(c => String(c).includes(metricStr));
    if (!inResume && !confirmed) {
      warnings.push({ code: 'unconfirmed_metric', severity: 'high', message: `This uses a number ("${metricStr}") that is not in your résumé and has not been confirmed — confirm it or remove it.` });
    }
  }

  // 4. Role-family specific overclaim patterns.
  const fam = roleFamily(family);
  if (fam) for (const oc of fam.overclaims || []) {
    if (oc.pattern.test(text)) warnings.push({ code: 'role_overclaim', severity: 'medium', message: `Careful: this ${oc.warn}.` });
  }

  return warnings;
}

// A bullet is interview-safe when it has no high-severity warnings.
export function isDefensible(warnings) {
  return !(warnings || []).some(w => w.severity === 'high');
}
