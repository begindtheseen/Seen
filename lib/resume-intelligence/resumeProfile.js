// Resume Intelligence Engine — CANONICAL RESUME PROFILE (Phase 3).
//
// A structured view of the candidate — NOT a flat word-blob. Wraps the tested deterministic parser
// (parseResumeV2: sections → roles → bullets → skill/metric/verb evidence nodes) and enriches it
// with taxonomy resolution so every explicitly-present skill maps to a canonical concept WITH the
// résumé span that proves it. Transferable evidence (verbs implying a concept) is NOT precomputed
// here — the matcher derives it from `evidenceSentences` via the semantic layer, so a claim is only
// ever as strong as the text behind it. Pure + deterministic, NO AI.

import { parseResumeV2 } from '../application-intelligence/resumeParserV2.js';
import { extractTaxonomyConcepts } from './concepts.js';
import { resolveConcept } from './taxonomy.js';
import { extractEducation, extractCertifications } from './structured.js';

export function buildResumeProfile(resumeText) {
  const raw = parseResumeV2(resumeText || '');
  const family = raw.overallFamily || 'general';

  // Experiences (structured per role).
  const experiences = (raw.roles || []).map((r) => {
    const bulletTexts = (r.bullets || []).map((b) => b.text);
    const techs = new Set();
    for (const b of r.bullets || []) for (const n of b.nodes || []) {
      if (n.type === 'skill') { const res = resolveConcept(n.label); if (res) techs.add(res.id); }
    }
    return {
      company: r.employer || null,
      title: r.title || null,
      dateRange: r.dateRange || null,
      current: !!r.current,
      family: r.family || null,
      bullets: bulletTexts,
      metrics: (r.nodes || []).filter((n) => n.type === 'metric').map((n) => ({ value: n.value })),
      technologies: [...techs],
    };
  });

  // Every bullet + every skills-section line is an evidence node.
  const evidence = [];
  for (const r of raw.roles || []) for (const b of r.bullets || []) evidence.push({ text: b.text, section: 'experience', company: r.employer || null, title: r.title || null });
  for (const line of raw.sections?.skills || []) { const t = String(line || '').trim(); if (t.length > 1) evidence.push({ text: t, section: 'skills' }); }
  for (const line of raw.sections?.summary || []) { const t = String(line || '').trim(); if (t.length > 8) evidence.push({ text: t, section: 'summary' }); }

  const evidenceText = evidence.map((e) => e.text).join('  ').toLowerCase();
  const skillsBlob = [...(raw.skills || []), ...evidence.map((e) => e.text)].join('\n');

  // Explicitly-present taxonomy concepts (EXACT/ALIAS) with the résumé span that proves each.
  const concepts = {};
  const { concepts: found } = extractTaxonomyConcepts(skillsBlob, { family });
  for (const c of found) {
    // find a proving span: a bullet/skill line that contains the surface.
    const span = evidence.find((e) => e.text.toLowerCase().includes(c.surface))?.text
      || (raw.skills || []).find((s) => s.toLowerCase().includes(c.surface))
      || c.surface;
    concepts[c.id] = { id: c.id, display: c.display, category: c.category, evidence: [span], via: 'alias' };
  }

  // Raw skill surfaces (open-vocab — for matching skills the taxonomy doesn't model).
  const skills = (raw.skills || []).map((s) => {
    const res = resolveConcept(s);
    return { surface: s, conceptId: res ? res.id : null, display: res ? res.display : s, category: res ? res.category : 'skill' };
  });

  const eduText = (raw.sections?.education || []).join(' ') + ' ' + (raw.sections?.header || []).join(' ');
  const certText = (raw.sections?.certifications || []).join(' ') + ' ' + (raw.sections?.skills || []).join(' ') + ' ' + evidenceText;

  return {
    summary: (raw.sections?.summary || []).join(' ').trim() || null,
    overallFamily: family,
    experiences,
    skills,
    education: extractEducation(eduText) ? [extractEducation(eduText)] : [],
    certifications: extractCertifications(certText),
    evidence,
    evidenceSentences: evidence.map((e) => e.text),
    evidenceText,
    concepts, // explicitly-present concepts (exact/alias), each with a proving span
    metricCount: (raw.metrics || []).length,
    _debug: {
      overallFamily: family,
      roleCount: experiences.length,
      explicitConcepts: Object.keys(concepts),
      skillSurfaces: (raw.skills || []).length,
    },
  };
}
