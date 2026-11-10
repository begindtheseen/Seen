// The verdict, read onto the document — the Tailor's spine (director's decision A, 2026-11-10).
//
// `runOptimizer` (lib/optimizer) is the ONE reading of a posting and the ONE judgement of a résumé:
// matched_requirements (each with the résumé line that proves it) and unsupported_requirements. The
// Tailor used to shape the document from its own lexicons (competencies.js TERMS, keywords.js) and
// consulted the verdict only for the score: the judges found the evidence for matched requirements cut
// ("Managed front office for a 6-dentist practice" for a Medical Receptionist posting) while unrelated
// lines stayed (studio.md D2). This module maps the verdict onto the ResumeDoc so every decision —
// which bullet leads, which may be cut, what the summary names, what is asked — follows it:
//
//   readVerdict(doc, out) → {
//     matched:   [{ key, label, importance, weight, via, hard, soft, inferred, evidence, where, itemId, bulletId }],
//     unmet:     [...the unsupported rows, same shape without evidence],
//     bulletReqs: Map<bulletId, row[]>   (the requirements each bullet proves, heaviest first),
//     roleWeight: Map<itemId, number>    (evidence mass per role: its title line + its bullets),
//     buried:    [{ row, bulletId, itemId }] (a requirement proved only in skills / summary / a title line
//                                            whose words a bullet also carries — the line to surface),
//   }
//
// It never re-reads the posting and never contradicts a match: it only LOCATES the evidence the verdict
// already cites. Pure and deterministic.
import { stemWord } from '../../optimizer/lemma.js';

const IMPORTANCE_W = { required: 1, preferred: 0.6, nice_to_have: 0.35, responsibility: 0.55 };
const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'at', 'by', 'with', 'from', 'as', 'per', 'via', 'our', 'your', 'their', 'all', 'any', 'one', 'other', 'etc', 'including', 'such', 'like']);

export const cleanLine = (s) => String(s || '').replace(/^[\s•·▪◦‣●\-–—*]+/, '').replace(/\s+/g, ' ').trim();
const flat = (s) => cleanLine(s).toLowerCase().replace(/[^a-z0-9+#%$]+/g, ' ').trim();

/** Content stems of a phrase ("insurance verification" → insurance, verif…). */
export function contentStems(text) {
  return String(text || '').toLowerCase().replace(/[‘’`]/g, "'").split(/[^a-z0-9+#]+/).filter((w) => w && w.length >= 2 && !STOP.has(w)).map(stemWord);
}
/** Every content stem of `phrase` appears among the stems of `line`. */
export function stemsCovered(phrase, line) {
  const need = contentStems(phrase);
  if (!need.length) return false;
  const have = new Set(contentStems(line));
  return need.every((s) => have.has(s));
}

/** How much a requirement matters for the document: importance, a hard requirement more, a soft trait,
 * a related or schooling-only match less. The verdict's own fields only. */
export function reqWeight(m) {
  let w = IMPORTANCE_W[m.importance] ?? 0.5;
  if (m.hard) w += 0.25;
  if (m.soft) w *= 0.4;
  if (m.via === 'related') w *= 0.7;
  if (m.inferred) w *= 0.5;
  return Number(w.toFixed(3));
}

/** A posting label the screen shows: never the engine key ("term:…"). */
export const labelOf = (m) => String(m.surface || m.requirement || '').replace(/^term:/, '').trim();

/**
 * A parenthesised career note the parser filed as a role ("Laid off 2020 (plant cutbacks); did DoorDash
 * deliveries", "caring for a family member") is never named as the person's job: not "most recently",
 * not asked about, not reordered. The parse package owns where the note goes; this only refuses to treat
 * it as a job.
 */
export function isGapNote(e) {
  if (!e) return true;
  const t = `${e.title || ''} ${e.company || ''}`;
  if (/\b(?:laid off|layoff|career break|sabbatical|caring for|caregiv\w*|family leave|parental leave|maternity|paternity|between jobs|job search|relocat\w+ for|gap year)\b/i.test(t)) return true;
  if (/^\s*[(\[]/.test(e.title || '')) return true;
  return false;
}

function locate(doc, line) {
  const target = flat(line);
  if (!target) return { where: 'none' };
  for (const e of doc.experience) {
    for (const b of e.bullets) {
      const bt = flat(b.text);
      if (!bt) continue;
      if (bt === target || (target.length >= 16 && (bt.includes(target) || target.includes(bt)))) return { where: 'bullet', itemId: e.id, bulletId: b.id };
    }
  }
  for (const e of doc.experience) {
    const title = flat(e.title), co = flat(e.company);
    if (title && target.includes(title) && (!co || target.includes(co.split(' ')[0]))) return { where: 'role', itemId: e.id };
    if (e.summary && flat(e.summary).includes(target)) return { where: 'role', itemId: e.id };
  }
  if (doc.basics.summary && flat(doc.basics.summary).includes(target.slice(0, 60))) return { where: 'summary' };
  if (doc.basics.headline && flat(doc.basics.headline) === target) return { where: 'summary' };
  const skillItems = doc.skills.flatMap((g) => g.items.map(flat));
  if (skillItems.some((it) => it && (target.includes(it) || it.includes(target)))) return { where: 'skills' };
  if (doc.certifications.some((c) => flat(c.text || c.name).length && target.includes(flat(c.text || c.name).slice(0, 30)))) return { where: 'certification' };
  return { where: 'other' };
}

/**
 * @param {object} doc ResumeDoc (the BASE the verdict was computed on)
 * @param {object} out runOptimizer output for that document
 */
export function readVerdict(doc, out) {
  const matched = [];
  const unmet = [];
  const bulletReqs = new Map();
  const roleWeight = new Map();
  for (const m of (out && out.matched_requirements) || []) {
    if (!m || !m.matched) continue;
    const loc = locate(doc, m.evidence || '');
    const row = { key: m.requirement, label: labelOf(m), postingPhrases: m.postingPhrases || [], importance: m.importance, weight: reqWeight(m), via: m.via, hard: !!m.hard, soft: !!m.soft, inferred: !!m.inferred, term: !!m.term, evidence: cleanLine(m.evidence || ''), evidenceKind: m.evidenceKind || null, ...loc };
    matched.push(row);
    if (loc.bulletId) { const arr = bulletReqs.get(loc.bulletId) || []; arr.push(row); bulletReqs.set(loc.bulletId, arr); }
    if (loc.itemId) roleWeight.set(loc.itemId, (roleWeight.get(loc.itemId) || 0) + row.weight);
  }
  for (const arr of bulletReqs.values()) arr.sort((a, b) => b.weight - a.weight);
  for (const m of (out && out.unsupported_requirements) || []) {
    if (!m || m.matched) continue;
    unmet.push({ key: m.requirement, label: labelOf(m), importance: m.importance, weight: reqWeight(m), hard: !!m.hard, soft: !!m.soft, term: !!m.term, via: m.via || 'none', postingEvidence: m.postingEvidence || null, anyOf: m.anyOf || null });
  }
  // Buried evidence: a requirement the verdict proves only from the skills list, the summary or a title line,
  // while one bullet carries every one of its words ("customer service" in Skills; a bullet that says it).
  const buried = [];
  for (const row of matched) {
    if (row.where === 'bullet' || row.soft || row.inferred || row.via === 'related') continue;
    let best = null;
    for (const e of doc.experience) {
      if (isGapNote(e)) continue;
      if (row.where === 'role' && row.itemId && row.itemId !== e.id) continue;
      for (const [i, b] of e.bullets.entries()) {
        if (!stemsCovered(row.label, b.text)) continue;
        if (!best || i < best.index) best = { row, bulletId: b.id, itemId: e.id, index: i, text: b.text };
      }
      if (best) break; // the first (most recent, as the person ordered them) role that does it
    }
    if (best) {
      buried.push(best);
      const arr = bulletReqs.get(best.bulletId) || [];
      if (!arr.includes(row)) { arr.push({ ...row, surfaced: true }); arr.sort((a, b) => b.weight - a.weight); bulletReqs.set(best.bulletId, arr); }
      roleWeight.set(best.itemId, (roleWeight.get(best.itemId) || 0) + row.weight * 0.5);
    }
  }
  return { matched, unmet, bulletReqs, roleWeight, buried, constraints: (out && out.constraints) || [], fitScore: out ? out.fit_score : null };
}

// one generic word ("cleaning", "safety", "training") is proven by almost any line; it may order lines, but never at
// full weight — "Kept work area clean and followed 5S" must not open a role (optimize.md, Oldcastle)
export const GENERIC_REQ = new Set(['cleaning', 'safety', 'training', 'communication', 'teamwork', 'organization', 'reliability', 'leadership', 'quality', 'support', 'service', 'operations', 'documentation', 'compliance', 'administration', 'coordination', 'flexibility', 'attendance', 'punctuality', 'accuracy', 'efficiency', 'productivity', 'customer', 'customers', 'team', 'warehouse', 'office']);
const effWeight = (r) => (GENERIC_REQ.has(String(r.label || '').toLowerCase().trim()) ? r.weight * 0.45 : r.weight);
/** The heaviest requirement a bullet proves (0 when it proves none). */
export function bulletWeight(verdict, bulletId) {
  const arr = (verdict.bulletReqs.get(bulletId) || []).map(effWeight).sort((a, b) => b - a);
  return arr.length ? arr[0] + Math.min(0.3, (arr.length - 1) * 0.1) : 0;
}
