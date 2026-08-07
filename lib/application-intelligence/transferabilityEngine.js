// Transferability engine — the part that feels smart. For every job requirement it decides
// whether the résumé has EXACT, ADJACENT, TRANSFERABLE, WEAK, or MISSING evidence, and it
// can see that a valet has genuine customer-service/hospitality/logistics proof even with no
// "customer service" title. It returns the evidence used and a plain-English explanation for
// every judgment. Deterministic; no AI.

import { canonSkill, skillRelation, normForMatch } from './skillGraph.js';
import { roleFamily } from './roleOntology.js';

const MATCH_RANK = { exact: 5, adjacent: 4, transferable: 3, weak: 2, missing: 1 };

// Does any of the résumé's roles' families provide this requirement as transferable proof?
function familyProof(reqCanon, resume) {
  const hits = [];
  for (const role of resume.roles || []) {
    const fam = roleFamily(role.family);
    if (!fam) continue;
    if ((fam.provides || []).map(canonSkill).includes(reqCanon)) {
      hits.push({ role, fam });
    }
  }
  return hits;
}

// Best skill-graph relation between the résumé's skills and the requirement.
function skillProof(reqCanon, resumeSkills) {
  let best = { relation: 'none', weight: 0, skill: null };
  for (const s of resumeSkills) {
    const rel = skillRelation(s, reqCanon);
    if (MATCH_RANK[rel.relation === 'none' ? 'missing' : rel.relation] > MATCH_RANK[best.relation === 'none' ? 'missing' : best.relation]
      || (rel.relation === best.relation && rel.weight > best.weight)) {
      best = { ...rel, skill: s };
    }
  }
  return best;
}

// Assess ONE requirement against the parsed résumé.
export function assessRequirement(req, resume) {
  const reqCanon = canonSkill(req.normalizedLabel);
  const reqNorm = normForMatch(req.normalizedLabel);
  const resumeSkills = (resume.skills || []).map(canonSkill);

  // 1. Exact skill present — canonical match OR open-vocab normalized-string match, so any
  //    skill the résumé and job both name lines up even if the ontology has never seen it.
  const exactSurface = (resume.skills || []).find(s => canonSkill(s) === reqCanon || normForMatch(s) === reqNorm);
  if (exactSurface) {
    const node = (resume.evidenceNodes || []).find(n => n.type === 'skill' && (canonSkill(n.label) === reqCanon || normForMatch(n.label) === reqNorm));
    return finalize(req, 'exact', 0.95, node ? [node.evidenceText] : [exactSurface],
      `Your résumé directly shows "${req.normalizedLabel}".`);
  }

  // 1b. Requirement phrase demonstrated verbatim in the résumé's bullets (even when it isn't
  //     in a Skills list) — real evidence, in any industry.
  const resumeText = normForMatch(
    ((resume.evidenceNodes || []).map(n => n.evidenceText).join(' ')) + ' ' +
    (resume.sections ? Object.values(resume.sections).flat().join(' ') : ''));
  if (reqNorm.length >= 4 && new RegExp('\\b' + reqNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(resumeText)) {
    return finalize(req, 'exact', 0.85, [req.normalizedLabel], `Your résumé describes "${req.normalizedLabel}".`);
  }

  // 2. Skill-graph relation (adjacent / transferable).
  const sp = skillProof(reqCanon, resumeSkills);
  // 3. Role-family transferable proof.
  const fp = familyProof(reqCanon, resume);

  // Prefer the stronger of skill-relation vs family proof.
  const spRank = MATCH_RANK[sp.relation === 'none' ? 'missing' : sp.relation];
  const fpRank = fp.length ? MATCH_RANK.transferable : MATCH_RANK.missing;

  if (fp.length && fpRank >= spRank && fpRank >= MATCH_RANK.transferable) {
    const roles = fp.map(h => h.role.title || h.fam.label);
    const conf = Math.min(0.88, 0.6 + 0.1 * fp.length + 0.2 * (fp[0].role.familyConfidence || 0.5));
    return finalize(req, 'transferable', Number(conf.toFixed(2)),
      [...new Set(roles)].slice(0, 3),
      `${fp[0].fam.label} work provides transferable evidence for "${reqCanon}".`);
  }

  if (sp.relation === 'adjacent') {
    return finalize(req, 'adjacent', Number(Math.min(0.9, 0.55 + sp.weight * 0.4).toFixed(2)), [sp.skill],
      `Your "${sp.skill}" is closely related to "${reqCanon}".`);
  }
  if (sp.relation === 'transferable') {
    return finalize(req, 'transferable', Number(Math.min(0.82, 0.45 + sp.weight * 0.4).toFixed(2)), [sp.skill],
      `Your "${sp.skill}" gives transferable evidence toward "${reqCanon}".`);
  }

  // 4. Weak: the requirement token is mentioned somewhere but not really demonstrated.
  const mentionedText = (resume.evidenceNodes || []).some(n => (n.evidenceText || '').toLowerCase().includes(reqCanon));
  if (mentionedText) {
    return finalize(req, 'weak', 0.35, [reqCanon], `"${reqCanon}" appears in your résumé but is not clearly demonstrated with detail.`);
  }

  return finalize(req, 'missing', 0, [], `No résumé evidence found for "${reqCanon}".`);
}

function finalize(req, matchType, confidence, evidence, explanation) {
  return {
    requirement: req.normalizedLabel,
    text: req.text,
    importance: req.importance,
    category: req.category,
    weight: req.weight,
    missSeverity: req.missSeverity,
    matchType,
    confidence,
    // Always a clean array of non-empty strings — a match built from an evidence node with a
    // missing evidenceText would otherwise yield [undefined], which the UI then rendered with
    // .slice() and crashed the whole page. Sanitize at the source.
    evidence: (Array.isArray(evidence) ? evidence : []).filter((e) => typeof e === 'string' && e.length > 0),
    explanation,
  };
}

// Assess ALL requirements; return per-requirement assessments + buckets.
export function assessTransferability(resume, job) {
  const all = (job.requirements || []).map(r => assessRequirement(r, resume));
  const bucket = (types) => all.filter(a => types.includes(a.matchType));
  const missingRisky = all.filter(a => a.matchType === 'missing' && (a.missSeverity === 'fatal' || a.missSeverity === 'risky'));
  const missingRecoverable = all.filter(a => a.matchType === 'missing' && a.missSeverity === 'recoverable');
  return {
    assessments: all,
    exact: bucket(['exact']),
    transferable: bucket(['adjacent', 'transferable']),
    weak: bucket(['weak']),
    missingRecoverable,
    missingRisky,
  };
}
