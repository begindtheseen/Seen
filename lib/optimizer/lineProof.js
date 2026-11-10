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
// A credential or skill the line itself says is not yet held ("CPA Candidate", "CPA EXAM — REG in progress",
// "pursuing PMP", "RN (expected May 2027)", "Spanish (learning)", "familiar with Tableau"): never proof that it is held
// (coordinator 2026-11-10 — a staff accountant was shown "✓ CPA — “CPA EXAM”").
const NOT_HELD_AFTER_RE = /^[\s,:–—-]*(?:\(\s*)?(?:candidate|candidacy|exam(?:s|ination)?|eligible|eligibility|in[\s-]progress|track|student|trainee|expected|anticipated|pending|learning|coursework|prep(?:aration)?|parts?\s+(?:passed|remaining))\b/i;
const NOT_HELD_BEFORE_RE = /(?:pursuing|studying\s+for|preparing\s+for|prepping\s+for|candidate\s+for|working\s+towards?|eligible\s+for|enrolled\s+in|sitting\s+for|registered\s+for|basic|familiar(?:ity)?\s+with|exposure\s+to|learning|aspiring)\s+(?:the\s+|a\s+|an\s+)?$/i;
/** The words of `label` sit on `line` only as something not yet held. Returns the qualified phrase or null. */
export function notYetHeld(line, label) {
  const text = String(line || '');
  const l = String(label || '').replace(/^(?:an?|the)\s+/i, '').replace(/\s+(?:certification|certificate|license|licence|licensure|credential|designation)$/i, '').trim();
  if (!l || l.length < 2) return null;
  const re = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(l)}(?![A-Za-z0-9])`, /^[A-Z0-9&/+-]+$/.test(l) ? 'g' : 'gi');
  let m, any = false, held = false, phrase = null;
  while ((m = re.exec(text)) !== null) {
    any = true;
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 40);
    const before = text.slice(Math.max(0, m.index - 40), m.index);
    if (NOT_HELD_AFTER_RE.test(after)) phrase = phrase || `${m[0]}${after.match(NOT_HELD_AFTER_RE)[0]}`.replace(/[\s,:–—(-]+$/, '').replace(/\s+/g, ' ');
    else if (NOT_HELD_BEFORE_RE.test(before)) phrase = phrase || `${before.match(NOT_HELD_BEFORE_RE)[0]}${m[0]}`.trim();
    else held = true;
  }
  return any && !held ? phrase : null;
}
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

/** One proof (a phrase, an ACRONYM, or an array of stems) on one proofLines() line — the alias rule, shared with the judge. */
export function proofOnLine(line, proof) { return provesOn(line, proof); }
// one proof against one line
function provesOn(line, proof) {
  if (Array.isArray(proof)) return proof.every((s) => line.stems.has(s));
  const p = String(proof);
  // an acronym as a whole word, its plural included ("EKGs", "SOPs")
  if (/^[A-Z][A-Z0-9&/+-]{1,9}$/.test(p)) return new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(p)}s?(?![A-Za-z0-9])`).test(line.match);
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
    if (!proofs.some((p) => provesOn(line, p) && !(typeof p === 'string' && notYetHeld(line.text, p)))) continue;
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
    const re = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(term.acronym)}s?(?![A-Za-z0-9])`);
    const hits = lines.filter((l) => re.test(l.match) && !notYetHeld(l.text, term.acronym)).sort((a, b) => b.rank - a.rank);
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

// US state names ↔ postal codes, so "Arizona RN license" is proved by "Active RN license (AZ, compact)"
const STATES = { alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY' };
const CRED_NOISE_RE = /\b(?:an?|the|certification|certificate|certified|licen[sc]e[ds]?|licensure|card|valid|current|active|state|in|good|standing|or|eligibility|eligible|compact|multistate)\b/gi;
/**
 * The résumé line that names a credential (V, 2026-11-10): a licence / certification line, never an education line or a
 * role header ("Active Arizona RN license" was cited to "B.S. Nursing — Arizona State University"). A state named in
 * the posting is matched by its name or postal code; the credential's own words must all be on the line.
 * @returns {string|null}
 */
export function credentialLine(resumeText, label) {
  let want = String(label || '');
  const states = [];
  for (const [name, code] of Object.entries(STATES)) {
    const re = new RegExp(`\\b${name}\\b`, 'i');
    if (re.test(want)) { states.push({ name, code }); want = want.replace(re, ' '); }
  }
  const words = tokenize(want.replace(CRED_NOISE_RE, ' ')).map((t) => t.stem).filter((s) => s.length > 1);
  if (!words.length) return null;
  const top = String(resumeText || '').split('\n').map((x) => x.trim()).find(Boolean) || '';
  const lines = proofLines(resumeText).filter((l) => !l.inProgress && l.kind !== 'education' && l.kind !== 'role' && l.text !== top && !notYetHeld(l.text, label));
  // the credential's own words, or the long form of its abbreviation ("PTA" = "Physical Therapist Assistant")
  const alts = [words, ...aliasEntriesFor([want.trim(), ...want.split(/\s+/).filter((w) => /^[A-Z]{2,6}$/.test(w))]).flatMap((e) => e.proofs.filter((p) => typeof p === 'string' && !/^[A-Z]{2,6}$/.test(p)).map((p) => tokenize(p).map((t) => t.stem)))];
  // (the alternatives a posting names — "Journeyman or Master electrical license" — each proves it; an abbreviation's
  // field-standard proof does too: BLS for CPR)
  const orParts = want.split(/\s+or\s+|\//i).map((x) => tokenize(x.replace(CRED_NOISE_RE, ' ')).map((t) => t.stem).filter((st) => st.length > 1)).filter((x) => x.length);
  const tail = words.slice(-1);
  for (const op of orParts) if (op.length && orParts.length > 1) alts.push([...new Set([...op, ...tail.filter((x) => !op.includes(x))])].slice(0, 3));
  const acr = aliasEntriesFor([want.trim(), ...want.split(/\s+/).filter((w) => /^[A-Z]{2,6}$/.test(w))]).flatMap((e) => e.proofs.filter((p) => typeof p === 'string' && /^[A-Z]{2,6}$/.test(p)));
  const has = (l) => alts.some((ws) => ws.length && (ws.every((w) => l.stems.has(w)) || (ws.length > 1 && findStemmed(l.toks, ws).length > 0))) || acr.some((a) => new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(a)}(?![A-Za-z0-9])`).test(l.text));
  const inState = (l) => !states.length || states.some((s) => new RegExp(`\\b${s.name}\\b`, 'i').test(l.text) || new RegExp(`(?<![A-Za-z])${s.code}(?![A-Za-z])`).test(l.text) || /\bcompact|multistate\b/i.test(l.text));
  const hit = lines.filter((l) => has(l) && inState(l)).sort((a, b) => (/licen|certif/i.test(b.text) - /licen|certif/i.test(a.text)) || b.rank - a.rank)[0];
  return hit ? hit.text : null;
}
