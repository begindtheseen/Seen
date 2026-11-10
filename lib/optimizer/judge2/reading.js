// judge2: a requirement statement (or a résumé line) read into UNITS — the head ACTION, the head OBJECT with its
// modifiers, and DETAILS (prepositional phrases, "including …", "using …", purpose and time clauses). Every rule here
// is a statement about English sentences in job postings, not about one posting:
//  - a duty is an imperative or third-person verb phrase: its first content word is the action ("Run the shift");
//  - a requirement is a frame around a thing ("Experience with X", "Ability to X", "X experience", "Comfortable with X"):
//    the frame is dropped and X is read the same way;
//  - the head of an English noun phrase is its last noun before a preposition ("the daily food and paper ORDER");
//    "of" keeps the phrase going ("records of shipments");
//  - after the head object, a preposition, a colon, a dash, a bracket, "including / such as / using / to ensure / when"
//    starts the details: who it is for, where, how, why, with what;
//  - "; " and ", and <verb>" start another clause ("…on each station and COACH the crew").
import { unitsOf } from '../../text/workFamilies.js';
import { inflectionCandidates, derivationCandidates, isStopWord } from '../../text/morph.js';
import { specOf } from './idf.js';

/** @typedef {{ text: string, tokens: string[], key: string, fams: Array<{ fam: string, kind: string, cond: string[] | null }>, spec: number, role: 'action'|'object'|'detail', head: boolean, alt: number, example?: boolean }} Unit */
/** @typedef {{ text: string, head: string, actions: Unit[], objects: Unit[], details: Unit[], or: boolean }} Clause */

const TAIL_RE = /\s*(?:\(\s*(?:strongly\s+)?(?:preferred|required|desired|a\s+plus|plus|bonus)\s*\)|,?\s*(?:is\s+|are\s+|would\s+be\s+)?(?:strongly\s+)?(?:preferred|required|desired|a\s+(?:big\s+|huge\s+|strong\s+)?plus|a\s+bonus|nice\s+to\s+have|an?\s+asset|helpful|beneficial))\s*[.!]?\s*$/i;
const YEARS_RE = /\b(?:minimum\s+(?:of\s+)?|at\s+least\s+)?(?:\d{1,2}(?:\.\d)?|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:\(\d+\)\s*)?\+?\s*(?:(?:-|–|to)\s*\d{1,2}\s*\+?\s*)?(?:years?|yrs?|months?)(?:\s+of)?(?:\s+(?:professional|relevant|related|direct|progressive|hands-on|prior|previous|recent|proven|demonstrated|industry|paid|full-time|work))*(?:\s+experience)?(?:\s+(?:in|with|as|of|doing|working|on))?\s*/gi;
// frames around the thing a requirement asks for (grammar of requirement lines)
const LEAD_FRAMES = [
  /^(?:must|should|will|shall)\s+(?:be\s+able\s+to|be|have|possess|demonstrate)\s+/i,
  /^(?:the\s+)?(?:proven|demonstrated|strong|excellent|good|solid|working|basic|advanced|exceptional|outstanding|superior|effective|clear|sound|thorough|deep|in-depth|hands-on|prior|previous|some|relevant|direct|practical|professional)\s+/i,
  /^(?:ability|abilities|able|capacity|willingness|willing|desire|commitment|eagerness|eager|aptitude)\s+(?:and\s+\w+\s+)?to\s+/i,
  /^(?:knowledge|understanding|familiarity|proficiency|expertise|experience|background|exposure|skills?|competency|competence|fluency|comfort|track\s+record|history|success)\s+(?:and\s+\w+\s+)?(?:of|in|with|using|on|doing|working\s+(?:with|in|on)|across|around|at|as|for)\s+/i,
  /^(?:comfortable|familiar|proficient|experienced|skilled|knowledgeable|versed|fluent|competent|confident|adept|capable)\s+(?:(?:and\s+\w+\s+)?(?:with|in|using|on|at|working\s+(?:with|in|on))\s+)?/i,
  /^(?:responsible\s+for|responsibilities\s+include|duties\s+include|you\s+will|you'll|we\s+need\s+someone\s+to)\s+/i,
  /^(?:demonstrates?|demonstrating|displays?|shows?|exhibits?)\s+/i,
];
const MINOR_RE = /^(?:help(?:s|ing)?|assist(?:s|ing)?|participate(?:s)?|participating|support(?:s|ing)?)\s+(?:with|in|on)\s+|^(?:help(?:s|ing)?|assist(?:s|ing)?)\s+/i;
const TRAIL_FRAMES = /\s+(?:experience|skills?|knowledge|background|proficiency|abilities|ability|expertise|exposure|familiarity)\s*$/i;
// where the details start (after the head object has been read)
const DETAIL_START = /\s*(?::|\s[-–—]\s|\(|,?\s+(?:including|includes|such\s+as|e\.g\.?|i\.e\.?|for\s+example|like|using|utilizing|via|through|to\s+ensure|ensuring|so\s+that|in\s+order\s+to|when|whenever|while|during|as\s+needed|as\s+required|per|according\s+to|following|in\s+accordance\s+with|within|under|based\s+on|throughout)\b)/i;
const PREPS = new Set(['on', 'in', 'at', 'for', 'to', 'from', 'with', 'by', 'across', 'throughout', 'under', 'over', 'within', 'into', 'onto', 'around', 'among', 'between', 'during', 'after', 'before', 'without', 'against', 'toward', 'towards', 'upon', 'per', 'via', 'about', 'as']);
const DETERMINERS = new Set(['a', 'an', 'the', 'our', 'your', 'their', 'its', 'all', 'any', 'each', 'every', 'this', 'that', 'these', 'those', 'some', 'other', 'new', 'existing']);
const ADVERB_RE = /^(?:[a-z]+ly|well|quickly|safely|daily|weekly|monthly)$/i;

/** Lower-case tokens with their surface spelling, aligned with morph.words. @param {string} text */
export function surfaceTokens(text) {
  const out = [];
  const s = String(text || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’]s\b/g, '');
  for (const m of s.matchAll(/[A-Za-z0-9+#]+/g)) out.push({ w: m[0].toLowerCase(), s: m[0], at: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  return out;
}

/** Every base form a word can stand for (inflections, the verb a noun of action names). @param {string} w */
export function formsOf(w) {
  const out = inflectionCandidates(w);
  for (const d of derivationCandidates(w)) if (!out.includes(d)) out.push(d);
  return out;
}

/** Can the word be a work action (the work thesaurus lists it as an action, or it is a past form)? @param {string} w */
function actionLike(w, fams) {
  return (fams && fams.some((f) => f.kind === 'action')) || /^[a-z]{3,}ed$/.test(w);
}

/**
 * Units of a piece of text, in order, with work-family memberships and specificity.
 * @param {string} text
 * @returns {Array<{ text: string, tokens: string[], key: string, fams: any[], spec: number }>}
 */
export function unitsIn(text) {
  return unitsOf(text).map((u) => ({ text: u.text, tokens: u.tokens, key: u.key, fams: u.members.map((m) => ({ fam: m.fam, kind: m.kind, cond: m.cond })), spec: specOf(u.tokens) }));
}

/**
 * Strip the frame of a requirement line and the "a plus / preferred" tail. Returns the text the judge reads and
 * whether the line is a minor duty ("Help with …").
 * @param {string} text
 */
export function unframe(text) {
  let t = String(text || '').replace(/\s+/g, ' ').trim().replace(/[.;,]+$/, '');
  t = t.replace(TAIL_RE, '').trim();
  t = t.replace(YEARS_RE, ' ').replace(/\s+/g, ' ').trim();
  let minor = false;
  for (let guard = 0; guard < 6; guard++) {
    const before = t;
    t = t.replace(/^(?:[A-Za-z]+ly)\s+/, '');
    for (const re of LEAD_FRAMES) t = t.replace(re, '');
    if (MINOR_RE.test(t)) { minor = true; t = t.replace(MINOR_RE, ''); }
    if (t === before) break;
  }
  t = t.replace(TRAIL_FRAMES, '').trim();
  return { text: t || String(text || '').trim(), minor };
}

/** Split a statement into clauses at ";" and at ", and <action>" / "and <action>". @param {string} t */
function clauseTexts(t, verbFirst) {
  const parts = t.split(/\s*;\s*/).filter(Boolean);
  const out = [];
  for (const p of parts) {
    const toks = surfaceTokens(p);
    let start = 0;
    for (let i = 2; i < toks.length - 1; i++) {
      const between = p.slice(toks[i - 1].end, toks[i].at);
      // ", and keep …" / "and coach the crew" / (in a verb-led line) ", configure test setups": a new action with its own
      // object after it
      const isAnd = toks[i].w === 'and';
      const next = isAnd ? toks[i + 1] : toks[i];
      if (!isAnd && !(verbFirst && /,\s*$/.test(between))) continue;
      const fams = unitsIn(next.s)[0]?.fams || [];
      const verb = actionLike(next.w, fams) && !fams.some((f) => f.kind === 'object');
      const restLen = toks.length - (isAnd ? i + 2 : i + 1);
      if (verb && toks.slice(start, i).length >= 2 && restLen >= 1 && (isAnd ? (/,\s*$/.test(between) || restLen >= 1) : true)) {
        out.push(p.slice(start === 0 ? 0 : toks[start].at, toks[i].at).replace(/[,\s]+$/, ''));
        start = isAnd ? i + 1 : i;
      }
    }
    out.push(start === 0 ? p : p.slice(toks[start].at));
  }
  return out.map((x) => x.trim().replace(/^(?:and|or)\s+/i, '')).filter(Boolean);
}

/**
 * Read one clause into action / objects / details. Objects come in conjunct groups ("county health code and our food
 * safety standards" = two groups), each with a head: its last noun, or — when that noun is a generic class word
 * ("system", "skills", "standards", "items") — its most specific modifier ("POS system" is about the POS).
 * @param {string} text the clause
 * @param {{ verbFirst: boolean }} opts verbFirst: the clause opens on its verb (a duty, or "Ability to …")
 * @returns {Clause}
 */
function readClause(text, { verbFirst }) {
  const cut = text.search(DETAIL_START);
  const headText = (cut > 2 ? text.slice(0, cut) : text).trim();
  const tailText = cut > 2 ? text.slice(cut) : '';
  const toks = surfaceTokens(headText);
  const units = unitsOf(headText);
  // align the thesaurus units with the head's tokens (it skips stop words and numbers)
  const placed = [];
  let p = 0;
  for (const u of units) {
    while (p < toks.length && toks[p].w !== u.tokens[0]) p++;
    if (p >= toks.length) break;
    placed.push({ u, at: p, end: p + u.tokens.length });
    p += u.tokens.length;
  }
  const gap = (/** @type {number} */ k) => (k <= 0 ? [] : toks.slice(placed[k - 1].end, placed[k].at).map((t) => t.w));
  const gapText = (/** @type {number} */ k) => (k <= 0 ? '' : headText.slice(toks[placed[k - 1].end - 1].end, toks[placed[k].at].at));
  const mk = (/** @type {any} */ x, /** @type {'action'|'object'|'detail'} */ role, alt = 0) => ({ text: x.u.text, tokens: x.u.tokens, key: x.u.key, fams: x.u.members.map((/** @type {any} */ m) => ({ fam: m.fam, kind: m.kind, cond: m.cond })), spec: specOf(x.u.tokens), role, head: false, alt });
  /** @type {Unit[]} */
  const actions = [];
  /** @type {Unit[]} */
  let objects = [];
  /** @type {Unit[]} */
  const details = [];
  let i = 0;
  // adverbs before the verb ("Properly pulls products")
  while (i < placed.length - 1 && ADVERB_RE.test(placed[i].u.text)) i++;
  const first = placed[i];
  const objectOnly = !!first && first.u.members.length > 0 && first.u.members.every((/** @type {any} */ m) => m.kind === 'object');
  const firstIsAction = !!first && ((verbFirst && !objectOnly) || /^[a-z]{3,}(?:ing|ed)$/.test(first.u.tokens[0]));
  // a light verb ("Conduct …", "Provide …", "Serve as …") is passed over: the noun phrase after it is read as the thing
  const light = !!first && firstIsAction && formsOf(first.u.tokens[0]).some((f) => LIGHT.has(f)) && placed.length > i + 1;
  if (light) i++;
  if (first && firstIsAction && !light) {
    actions.push(mk(first, 'action'));
    i++;
    // "Open or close", "Train and coach", "Sets up and breaks down": joined verbs are one action
    while (i < placed.length) {
      const between = gap(i);
      const verbish = actionLike(placed[i].u.tokens[0], placed[i].u.members) && (between.includes('or') || between.includes('and')) && between.length <= 2;
      if (!verbish) break;
      actions.push(mk(placed[i], 'action'));
      i++;
    }
  }
  // the object phrase: up to the first preposition after at least one object word; conjunct groups split at , / and / or
  let group = 0;
  let sawOr = false;
  /** @type {Set<Unit>} the units an "of" follows ("records of shipments": records) */
  const ofHeads = new Set();
  /** @type {Set<number>} groups that a comma opens (a list, not a shared head) */
  const commaGroups = new Set();
  for (; i < placed.length; i++) {
    const between = gap(i);
    if (between.some((w) => PREPS.has(w)) && objects.length && !between.includes('of')) break;
    if (objects.length && (between.includes('and') || between.includes('or') || /,/.test(gapText(i)))) { group++; if (between.includes('or')) sawOr = true; if (/,/.test(gapText(i))) commaGroups.add(group); }
    if (between.includes('of') && objects.length) ofHeads.add(objects[objects.length - 1]);
    const u = mk(placed[i], 'object', group);
    if (TIME_ADJ.has(u.text)) { u.role = 'detail'; details.push(u); continue; }
    objects.push(u);
  }
  for (; i < placed.length; i++) details.push(mk(placed[i], 'detail'));
  // no object before the first preposition ("Step in on any station"): the first phrase after it is the object
  if (!objects.length && details.length) { const d = details.shift(); if (d) { d.role = 'object'; d.alt = 0; objects.push(d); } }
  objects = objects.filter((o) => !DETERMINERS.has(o.text));
  // a one-word conjunct before a longer one shares its head ("food and paper ORDER", "patient and family EDUCATION")
  const groups = [...new Set(objects.map((o) => o.alt))];
  for (let g = 0; g < groups.length - 1; g++) {
    const here = objects.filter((o) => o.alt === groups[g]);
    const next = objects.filter((o) => o.alt === groups[g + 1]);
    if (here.length === 1 && next.length >= 2 && !commaGroups.has(groups[g + 1]) && !commaGroups.has(groups[g])) here[0].alt = groups[g + 1];
  }
  // heads: the last unit of each group (before "of"), or its most specific word when the last is a generic class noun
  for (const g of new Set(objects.map((o) => o.alt))) {
    const us = objects.filter((o) => o.alt === g);
    let h = us[us.length - 1];
    const ofAt = us.findIndex((o, k) => k < us.length - 1 && ofHeads.has(o));
    if (ofAt >= 0) h = us[ofAt];
    // (only a modifier BEFORE the head can lend it meaning — "POS system"; "operations of the therapy team" stays operations)
    const before = us.slice(0, us.indexOf(h));
    if (h.spec < GENERIC_HEAD && before.length) h = before.sort((a, b) => b.spec - a.spec)[0] || h;
    h.head = true;
  }
  // a noun phrase with no verb ("cash handling", "weekly inventory counts", "patient education"): an action noun at
  // its end is the action, and the words before it are what it acts on
  if (!actions.length && objects.length >= 1 && new Set(objects.map((o) => o.alt)).size === 1) {
    const last = objects[objects.length - 1];
    const w0 = last.tokens[last.tokens.length - 1];
    const deverbal = /^[a-z]{3,}ing$/.test(w0) || (last.fams.some((f) => f.kind === 'action') && !last.fams.some((f) => f.kind === 'object') && (derivationCandidates(w0).length > 0 || /[^s]s$/.test(w0)));
    if (deverbal && objects.length >= 2 && objects[objects.length - 2].alt === last.alt) {
      objects.pop();
      last.role = 'action'; last.head = false;
      actions.push(last);
      const rest = objects.filter((o) => o.alt === last.alt);
      if (rest.length && !rest.some((o) => o.head)) rest.sort((a, b) => b.spec - a.spec)[0].head = true;
    }
  }
  // an example list ("including A, B, C", "such as …", "(e.g. …)", "like …") names ways the thing is shown
  const examples = EXAMPLE_START.test(tailText);
  for (const u of unitsOf(tailText)) details.push({ text: u.text, tokens: u.tokens, key: u.key, fams: u.members.map((m) => ({ fam: m.fam, kind: m.kind, cond: m.cond })), spec: specOf(u.tokens), role: 'detail', head: false, alt: 0, example: examples && !EXAMPLE_WORDS.has(u.text) });
  return { text, head: headText, actions, objects, details: details.filter((d) => !isStopWord(d.text) && !DETERMINERS.has(d.text)), or: sawOr && !/\band\b/i.test(headText) };
}
// words that say WHEN or HOW WELL, never WHAT: they qualify the thing and carry no weight of their own
const EXAMPLE_START = /^\s*(?:\(\s*(?:e\.g\.?|i\.e\.?|such\s+as|including|like|ex\.?)?|,?\s*(?:including|includes|such\s+as|e\.g\.?|for\s+example|like)\b)/i;
const EXAMPLE_WORDS = new Set(['including', 'includes', 'such', 'like', 'example']);
const TIME_ADJ = new Set(['daily', 'weekly', 'monthly', 'nightly', 'yearly', 'annual', 'quarterly', 'hourly', 'regular', 'routine', 'ongoing', 'accurate', 'accurately', 'necessary', 'appropriate', 'proper', 'properly', 'various', 'multiple', 'general', 'overall',
  'comprehensive', 'high', 'highest', 'level', 'levels', 'effective', 'effectively', 'efficient', 'efficiently', 'timely', 'excellent', 'strong', 'superior', 'exceptional', 'outstanding', 'complex', 'sophisticated', 'key', 'entire', 'specific', 'relevant', 'consistent', 'smooth', 'seamless', 'best', 'optimal', 'successful', 'successfully', 'positive', 'clear', 'thorough', 'detailed', 'complete', 'full', 'total', 'great', 'good', 'quality']);
// verbs that carry no work act of their own ("Conduct assessments", "Provide care", "Serve as the case manager",
// "Leverage Salesforce"): the thing after them says what is done (the work thesaurus treats the same set as transparent)
const LIGHT = new Set(['conduct', 'perform', 'provide', 'do', 'carry', 'complete', 'execute', 'ensure', 'serve', 'act', 'deliver', 'make', 'take', 'use', 'utilize', 'leverage', 'apply', 'demonstrate', 'exercise', 'have', 'possess', 'get', 'gain', 'bring', 'work']);
// a generic class noun as the last word of a phrase takes its meaning from the modifier: specificity under this
const GENERIC_HEAD = 0.16;

/**
 * A statement read into clauses. The first clause is the core.
 * @param {string} text
 * @param {{ kind?: string }} [opts]
 */
export function readStatement(text, opts = {}) {
  const { text: t, minor } = unframe(text);
  // the clause opens on its verb: a duty with no frame stripped, or an "ability to …" frame
  const verbFirst = (opts.kind === 'duty' && !minor && t === String(text || '').replace(/\s+/g, ' ').trim().replace(/[.;,]+$/, '').replace(TAIL_RE, '').trim()) || /^(?:[A-Za-z]+ly\s+)?(?:ability|able|willing\w*|responsible\s+for)\b/i.test(String(text || '').trim()) || (opts.kind === 'duty' && !minor && !/^(?:demonstrat|display|show|exhibit)/i.test(String(text || '').trim()));
  const clauses = clauseTexts(t, verbFirst).map((c, k) => readClause(c, { verbFirst: verbFirst || k > 0 }));
  return { text: t, minor, clauses };
}
