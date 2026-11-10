// Line proof — the ONE place the verdict decides which résumé line proves a requirement (2026-11-10 judge,
// optimize #3 / #5, prep D10 / D11).
//
// A requirement is proved by ONE résumé line that contains it as a phrase or a field-standard alias, its words on
// the same line — never by a word sense that only shares a stem ("power tools" is not "lighting and power problems"),
// never by an employer's name ("Midland Logistics Inc" is not logistics), never by an objective ("…warehouse
// professional looking for a lead role"), never by something still in progress ("Currently enrolled: RN to BSN").
// When several lines could prove it, the line that DOES the thing wins (a bullet over a title over a skills list over
// a summary; a bullet that trained others on it only when nothing else names it).
import { tokenize, stemWord, findStemmed } from './lemma.js';
import { resumeLineInfo, titleFromHeader } from './extractResumeFacts.js';
import { FIELD_ALIASES, TITLE_PROVES, FIELD_FUNDAMENTALS } from './fieldAliases.js';
import { detectRoleFamily } from '../application-intelligence/roleOntology.js';
import { escapeRegExp } from '../text/escapeRegExp.js';

const OBJECTIVE_RE = /\b(?:looking\s+for|seeking|to\s+obtain|objective|i\s+am\s+(?:a|an)|hard[- ]?working|team\s+player|where\s+i\s+can)\b/i;
export const IN_PROGRESS_LINE_RE = /\b(?:currently\s+enrolled|enrolled\s+in|enrolled:|expected\s+(?:graduation|(?:19|20)\d\d)|anticipated\s+(?:graduation|(?:19|20)\d\d)|in\s+progress|pursuing|working\s+toward|candidate\s+for|coursework\s+toward)\b/i;
const TEACH_RE = /^[\s•●▪◦*·\-–—]*(?:trained|certified|taught|coached|onboarded|mentored)\b/i;
const HEADER_SEP_RE = /\s+[—–|]\s+|\s+-\s+|\s+@\s+|\s+at\s+/;
// rank of a line kind as proof (higher wins)
const RANK = { bullet: 6, role: 5, skills: 3, summary: 2, education: 2, other: 2, header: 0 };

const cache = new Map();
/** The résumé's lines as proof candidates: what each may be matched on, its kind and rank. */
export function proofLines(resumeText) {
  const key = String(resumeText || '');
  if (cache.has(key)) return cache.get(key);
  const out = [];
  for (const l of resumeLineInfo(key)) {
    const text = String(l.text || '').trim();
    if (!text || l.kind === 'header') continue;
    let match = text;
    let kind = l.kind;
    // a role header proves only through its TITLE segment — never the employer, the city or the dates
    if (kind === 'role') {
      const title = titleFromHeader(text);
      match = title || text.split(HEADER_SEP_RE)[0];
    }
    const objective = (kind === 'summary' || l.section === 'header') && OBJECTIVE_RE.test(text);
    const inProgress = IN_PROGRESS_LINE_RE.test(text);
    const teaches = kind === 'bullet' && TEACH_RE.test(text);
    const rank = objective ? 0.5 : (RANK[kind] ?? 2) - (teaches ? 2 : 0);
    const toks = tokenize(match);
    const stems = new Set();
    for (const t of toks) { stems.add(t.stem); if (t.raw.includes('-')) for (const p of t.raw.split('-')) if (p) stems.add(stemWord(p)); }
    out.push({ text, match, kind, rank, objective, inProgress, teaches, toks, stems, title: kind === 'role' ? match : null });
  }
  if (cache.size > 50) cache.clear();
  cache.set(key, out);
  return out;
}

// one proof against one line
function provesOn(line, proof) {
  if (Array.isArray(proof)) return proof.every((s) => line.stems.has(s));
  const p = String(proof);
  if (/^[A-Z][A-Z0-9&/+-]{1,9}$/.test(p)) return new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(p)}(?![A-Za-z0-9])`).test(line.match);
  const want = tokenize(p).map((t) => t.stem);
  if (!want.length) return false;
  if (findStemmed(line.toks, want).length) return true;
  // hyphen/space variants: "balance-sheet" ↔ "balance sheet"
  const flat = want.flatMap((w) => w.split('-')).filter(Boolean);
  const lineFlat = line.toks.flatMap((t) => (t.raw.includes('-') ? t.raw.split('-').filter(Boolean).map(stemWord) : [t.stem]));
  for (let i = 0; i + flat.length <= lineFlat.length; i++) if (flat.every((w, k) => lineFlat[i + k] === w)) return true;
  return false;
}

/** The best line (by rank) proving any of the proofs; in-progress lines never prove. */
export function bestLine(resumeText, proofs, { allowObjective = false } = {}) {
  let best = null;
  for (const line of proofLines(resumeText)) {
    if (line.inProgress || (line.objective && !allowObjective)) continue;
    if (!proofs.some((p) => provesOn(line, p))) continue;
    if (!best || line.rank > best.rank) best = line;
  }
  return best ? { ...best, sentence: sentenceProving(best, proofs) } : null;
}

// The sentence of a multi-sentence line that holds the proof ("…busy offices. Proficient in Microsoft Office." cites the
// second sentence, not the whole summary).
function sentenceProving(line, proofs) {
  const parts = line.text.split(/(?<=[.!?;])\s+(?=[A-Z•])/);
  if (parts.length < 2) return line.text;
  for (const p of parts) {
    const toks = tokenize(p);
    const sub = { ...line, match: p, toks, stems: new Set(toks.flatMap((t) => [t.stem, ...(t.raw.includes('-') ? t.raw.split('-').filter(Boolean).map(stemWord) : [])])) };
    if (proofs.some((pr) => provesOn(sub, pr))) return p.trim();
  }
  return line.text;
}
const norm = (s) => tokenize(s).map((t) => t.stem).join(' ');
/** The field-alias entries that name this requirement (by its label or any posting phrase). */
export function aliasEntriesFor(labels) {
  const want = labels.filter(Boolean).map((l) => ({ raw: String(l).trim(), stems: norm(l) }));
  return FIELD_ALIASES.filter((e) => e.names.some((n) => {
    const ns = norm(n);
    const acr = /^[A-Z][A-Z0-9&/+-]{1,9}s?$/.test(n);
    return want.some((w) => {
      if (acr) return new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(n)}(?![A-Za-z0-9])`).test(w.raw);
      if (w.stems === ns) return true;
      // a longer requirement that contains a multi-word name ("applicable electrical codes", "EMR systems")
      return ns.includes(' ') && (` ${w.stems} `).includes(` ${ns} `) && w.stems.split(' ').length <= ns.split(' ').length + 2;
    });
  }));
}

/** Pairs a résumé spells out itself: "Accounts payable (AP)" → AP ↔ accounts payable. */
export function resumeDefinedPairs(resumeText) {
  const out = [];
  const re = /((?:[A-Za-z][\w&'’-]*\s+){1,5})\(\s*([A-Z][A-Z0-9&/+-]{1,8})\s*\)/g;
  let m;
  while ((m = re.exec(String(resumeText || ''))) !== null) {
    const words = m[1].trim().split(/\s+/);
    const acr = m[2].replace(/[^A-Z]/g, '');
    const picked = words.slice(-acr.length);
    if (picked.length === acr.length && picked.every((w, i) => w[0].toUpperCase() === acr[i])) out.push({ acronym: m[2], long: picked.join(' ') });
  }
  return out;
}

/**
 * Prove a requirement on one résumé line through a field-standard alias (fieldAliases.js) or a pair the résumé or
 * the posting spells out. Returns { line, via: 'alias', kind } or null.
 */
export function aliasProof(resumeText, { labels, acronym = null, long = null }) {
  const proofs = [];
  let kind = null;
  for (const e of aliasEntriesFor(labels)) { proofs.push(...e.proofs); kind = kind || e.kind; }
  // acronym ↔ long form, both ways, whenever either text spells the pair out
  if (acronym && long) proofs.push(acronym, long);
  for (const p of resumeDefinedPairs(resumeText)) {
    if (labels.some((l) => String(l).trim() === p.acronym || norm(l) === norm(p.long))) proofs.push(p.acronym, p.long);
  }
  if (!proofs.length) return null;
  const line = bestLine(resumeText, proofs);
  return line ? { line, kind } : null;
}

/** The résumé's own field, from its titles (most recent first). */
export function resumeFamily(resumeText) {
  for (const l of proofLines(resumeText)) {
    if (l.kind !== 'role' || !l.title) continue;
    const fam = detectRoleFamily(l.title, '').family;
    if (fam && fam !== 'general') return fam;
  }
  return null;
}

/**
 * A field requirement the person's job TITLE shows: the requirement's words on a title segment ("Software
 * Engineer" → software engineering), or a title the field table names (Registered Nurse → patient care).
 * Returns the role line or null.
 */
export function titleProof(resumeText, labels, fullStems) {
  const lines = proofLines(resumeText).filter((l) => l.kind === 'role' && l.title);
  for (const t of TITLE_PROVES) {
    if (!labels.some((l) => t.req.test(String(l).trim()))) continue;
    const hit = lines.find((l) => t.title.test(l.title));
    if (hit) return hit;
  }
  if (fullStems && fullStems.length >= 2) {
    const hit = lines.find((l) => fullStems.every((s) => l.stems.has(s)));
    if (hit) return hit;
  }
  return null;
}

/** A fundamental of the person's own field (an engineer is tested on algorithms, not asked to list them). */
export function fundamentalOf(resumeText, labels) {
  const fam = resumeFamily(resumeText);
  if (!fam) return null;
  const f = FIELD_FUNDAMENTALS.find((x) => x.families.includes(fam) && labels.some((l) => x.re.test(String(l).trim())));
  return f ? fam : null;
}

/**
 * Is a posting term (postingTerms.js) shown on one résumé line? By its acronym as a whole word, else by its word
 * stems on one line (all of them for a 1–2 word term, two thirds for a longer one — termStemVariants), with the line
 * rules above (no employer, objective or in-progress line; the doing line first).
 * @returns {{ matched: boolean, line: string|null, partial: boolean, lineKind: string|null }}
 */
export function termProof(term, resumeText, variants) {
  const lines = proofLines(resumeText).filter((l) => !l.inProgress && !l.objective);
  if (term.acronym) {
    const re = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(term.acronym)}(?![A-Za-z0-9])`);
    const hits = lines.filter((l) => re.test(l.match)).sort((a, b) => b.rank - a.rank);
    if (hits.length) return { matched: true, line: sentenceProving(hits[0], [term.acronym]).slice(0, 240), partial: false, lineKind: hits[0].kind };
  }
  let best = null;
  for (const want of variants || []) {
    if (!want.length) continue;
    const need = want.length <= 2 ? want.length : Math.ceil(want.length * 2 / 3);
    for (const l of lines) {
      const got = want.filter((s) => l.stems.has(s)).length;
      if (got < need) continue;
      const score = got / want.length;
      if (!best || score > best.score || (score === best.score && l.rank > best.l.rank)) best = { l, score, want, partial: got < want.length };
    }
  }
  return best ? { matched: true, line: (best.l.kind === 'role' ? best.l.text : sentenceProving(best.l, [best.want.filter((x) => best.l.stems.has(x))])).slice(0, 240), partial: best.partial, lineKind: best.l.kind } : { matched: false, line: null, partial: false, lineKind: null };
}
