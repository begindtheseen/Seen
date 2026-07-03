// Bullet compiler — compiles résumé evidence + job requirements + role knowledge into
// specific, interview-defensible bullets. NOT a chatbot: it composes from role-family
// scaffolds and REAL evidence only, classifies every output (safe / needs_confirmation /
// not_recommended / unsupported), and never emits a banned generic phrase or an unproven
// number. Deterministic; no AI.

import { roleFamily, BANNED_PHRASES, FAST_PACED_OK } from './roleOntology.js';
import { canonSkill } from './skillGraph.js';
import { checkInterviewDefense, isDefensible } from './interviewDefense.js';

// A short, natural context clause per role family — makes composed bullets sound human and
// role-specific instead of "applied X to deliver results". Only asserts things the family's
// work genuinely involves.
const FAMILY_CONTEXT = {
  valet_parking: 'during time-sensitive guest arrival and departure windows',
  food_service: 'during high-volume service rushes',
  retail: 'across a busy sales floor and register',
  warehouse: 'on a high-throughput fulfillment floor',
  delivery_logistics: 'across a full daily route',
  customer_service: 'across a steady queue of customer contacts',
  hospitality: 'across guest check-in and service',
  healthcare_support: 'in a patient-facing support setting',
  administrative: 'across daily intake and recordkeeping',
  sales: 'across an active pipeline',
  operations: 'across day-to-day operations',
  security: 'across patrol and incident response',
  finance_accounting: 'across recurring close and reconciliation cycles',
  software_engineering: 'on production code',
  data_analytics: 'across recurring reporting and analysis',
};

const REQUIREMENT_ACTION = {
  'customer service': 'handled guest-facing service and kept interactions clear and professional',
  'point of sale': 'processed point-of-sale transactions accurately',
  'cash handling': 'handled cash and balanced a drawer accurately',
  'inventory management': 'kept inventory accurate through careful stocking and counts',
  'food safety': 'followed food-safety and sanitation standards',
  'route planning': 'planned and completed routes efficiently',
  logistics: 'coordinated logistics and kept deliveries on schedule',
  'time management': 'managed competing tasks under time pressure',
  'data entry': 'entered and verified records accurately',
  documentation: 'documented work accurately and kept records complete',
  'customer intake': 'handled customer intake and captured details accurately',
  scheduling: 'coordinated schedules and appointments',
  communication: 'communicated clearly with customers and teammates',
  teamwork: 'worked closely with a team to keep service moving',
  safety: 'followed safety procedures consistently',
  hospitality: 'delivered attentive, professional guest service',
  sales: 'supported sales through attentive customer service',
};

function hasBanned(text) {
  const l = text.toLowerCase();
  return BANNED_PHRASES.some(p => l.includes(p)) || (/\bfast-paced\b/.test(l) && false); // fast-paced handled per-family below
}

function stripBanned(family, text) {
  // remove fast-paced unless the family truly warrants it
  if (/\bfast-paced\b/i.test(text) && !FAST_PACED_OK.has(family)) {
    text = text.replace(/\s*in a fast-paced environment/gi, '').replace(/\bfast-paced\b/gi, 'busy');
  }
  return text.replace(/\s{2,}/g, ' ').trim();
}

function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

// Compose a NEW transferable bullet for a requirement, grounded in a role that provides it.
function composeTransferableBullet(family, reqCanon, roleTitles) {
  const action = REQUIREMENT_ACTION[reqCanon] || `applied ${reqCanon}`;
  const ctx = FAMILY_CONTEXT[family] || '';
  const roleWord = roleTitles && roleTitles[0] ? ` in ${roleTitles[0].toLowerCase()} work` : '';
  let text = `${cap(action)}${roleWord}${ctx ? ' ' + ctx : ''}.`;
  return stripBanned(family, text);
}

// Conservatively improve an existing résumé bullet: lead with a strong role verb and clean
// banned phrasing — WITHOUT inventing content. Keeps the original substance.
function rewriteExisting(family, original) {
  const fam = roleFamily(family);
  let text = original.replace(/^\s*[•\-*]\s*/, '').trim();
  // If it doesn't start with a strong verb, and the family has one that fits the content, lead with it.
  const startsStrong = /^(led|managed|built|created|developed|resolved|handled|processed|delivered|coordinated|maintained|operated|scheduled|documented|served|assisted|drove|parked|reconciled|analyzed|picked|packed|restocked)/i.test(text);
  if (!startsStrong && fam) {
    // do not fabricate — only rephrase the leading clause if it's clearly a duty phrase
    const m = /^(responsible for|duties included|worked on|helped with|in charge of)\s+/i.exec(text);
    if (m) {
      const verb = (fam.strongVerbs || ['handled'])[0];
      text = `${cap(verb)} ${text.slice(m[0].length)}`;
    }
  }
  return stripBanned(family, text);
}

// Classify a candidate bullet. options: { evidenceUsed[], requirementsAddressed[], matchType,
// needsMetric, resume, family, confirmedMetrics }.
function classify(text, opts) {
  const { resume, family, confirmedMetrics = new Set(), matchType = 'exact', needsMetric = false } = opts;
  const warnings = checkInterviewDefense(text, { resume, family, confirmedMetrics });
  const banned = hasBanned(text);
  let classification, riskLevel, whySafe;
  const confirmBeforeUsing = [];

  if (banned) {
    classification = 'not_recommended';
    riskLevel = 'high';
    whySafe = 'Contains generic filler phrasing; rewrite with specifics.';
  } else if (matchType === 'missing') {
    classification = 'unsupported';
    riskLevel = 'high';
    whySafe = 'No résumé evidence supports this; do not use as-is.';
  } else if (!isDefensible(warnings)) {
    classification = 'not_recommended';
    riskLevel = 'high';
    whySafe = 'Would not survive an interview as written — see warnings.';
    for (const w of warnings) if (w.severity === 'high') confirmBeforeUsing.push(w.message);
  } else if (needsMetric || warnings.some(w => w.code === 'unconfirmed_metric')) {
    classification = 'needs_confirmation';
    riskLevel = 'medium';
    whySafe = 'Grounded in your experience, but add/confirm a real number to make it strongest.';
    confirmBeforeUsing.push('Add a real number (count, %, or timeframe) you can defend.');
  } else {
    classification = 'safe_to_use';
    riskLevel = 'low';
    whySafe = `Uses only ${matchType === 'exact' ? 'directly-shown' : 'transferable'} experience from your résumé.`;
  }
  return { classification, riskLevel, whySafe, warnings, confirmBeforeUsing };
}

// Main entry. Compiles a set of classified bullets from the parsed résumé + job + transferability.
export function compileBullets({ resume, job, transferability, confirmedMetrics = new Set() }) {
  const family = job.roleFamily || resume.overallFamily;
  const out = [];
  let id = 0;
  const push = (partial) => out.push({ id: `blt_${id++}`, ...partial });

  const resumeHasMetrics = (resume.metrics || []).length > 0;

  // 1. Rewrite existing bullets (real évidence spans), aligned to a matched requirement.
  const matchedByEvidence = new Map();
  for (const a of transferability.assessments) {
    for (const ev of a.evidence) matchedByEvidence.set(ev, a);
  }
  for (const role of resume.roles || []) {
    for (const b of role.bullets) {
      const text = rewriteExisting(family, b.text);
      const bulletHasMetric = b.nodes.some(n => n.type === 'metric');
      // which requirement does this bullet address? match by a skill node canon.
      const skillNode = b.nodes.find(n => n.type === 'skill');
      const addressed = skillNode ? [canonSkill(skillNode.label)] : [];
      const matchType = 'exact';
      const cls = classify(text, { resume, family, confirmedMetrics, matchType, needsMetric: !bulletHasMetric && !resumeHasMetrics });
      push({
        type: 'rewrite_existing', text,
        evidenceUsed: [b.text.slice(0, 200)],
        requirementsAddressed: addressed,
        matchType, confidence: 0.85, ...cls,
      });
    }
  }

  // 2. New transferable bullets for transferable/adjacent matched requirements NOT already
  //    demonstrated by an existing bullet.
  const demonstrated = new Set(out.flatMap(b => b.requirementsAddressed));
  for (const a of transferability.transferable) {
    const reqCanon = canonSkill(a.requirement);
    if (demonstrated.has(reqCanon)) continue;
    const roleTitles = (resume.roles || []).filter(r => {
      const fam = roleFamily(r.family);
      return fam && (fam.provides || []).map(canonSkill).includes(reqCanon);
    }).map(r => r.title).filter(Boolean);
    const text = composeTransferableBullet(family, reqCanon, roleTitles);
    const needsMetric = !resumeHasMetrics;
    const cls = classify(text, { resume, family, confirmedMetrics, matchType: 'transferable', needsMetric });
    push({
      type: 'add_transferable', text,
      evidenceUsed: a.evidence,
      requirementsAddressed: [reqCanon],
      matchType: a.matchType, confidence: a.confidence, ...cls,
    });
  }

  // 3. Metric-needed prompts for missing-recoverable required-ish requirements (as guidance,
  //    NOT final copy — always needs_confirmation / unsupported classification).
  for (const a of transferability.missingRecoverable.slice(0, 3)) {
    const reqCanon = canonSkill(a.requirement);
    const text = `(New bullet to add) Describe real work that demonstrates "${reqCanon}", and attach a number you can defend.`;
    push({
      type: 'metric_needed', text,
      evidenceUsed: [], requirementsAddressed: [reqCanon],
      matchType: 'missing', confidence: 0,
      classification: 'unsupported', riskLevel: 'high',
      whySafe: 'Only add this if you actually did the work — then confirm a real number.',
      warnings: [], confirmBeforeUsing: [`Confirm you have real "${reqCanon}" experience before adding this.`],
    });
  }

  // Bucketed views for the UI / compat.
  const safe = out.filter(b => b.classification === 'safe_to_use');
  const needsConfirmation = out.filter(b => b.classification === 'needs_confirmation');
  const notRecommended = out.filter(b => b.classification === 'not_recommended');
  const unsupported = out.filter(b => b.classification === 'unsupported');

  return { bullets: out, safe, needsConfirmation, notRecommended, unsupported, roleFamily: family };
}
