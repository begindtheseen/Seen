// Trade talk: the same OBJECT or ACT under two names, by field — abbreviation ⇄ long form (IM ⇄ intramuscular),
// trade verb ⇄ plain verb (stow ⇄ put away), instance ⇒ class (autoclave ⇒ sterilization; Epic ⇒ electronic health
// record). A reviewed table (scripts/text/trade-talk.txt → lib/text/data/tradeTalk.json, scripts/text/build-trade-talk.mjs).
// Isomorphic: no data in a browser (every answer is null there).
//
//   sameThing(a, b, { field }) → { same: true | false | null, via, kind, confidence }
//   expand(term, { field })    → what the term shows in that field (its equivalents; for an instance, its class)
//   fieldsOf(socCode)          → the field keys for an O*NET-SOC occupation code
//   hasTradeTalk()             → is the table loaded
//
// TRUST CONTRACT
//   same: true   — in this field, a (the résumé's term) names the posting's thing b. exact: both are listed terms,
//                  use as fact ("vitals" shows "vital signs"); close: a term contains a listed term ("IM injections"),
//                  use, a contradicting reading wins.
//   same: false  — both terms are in the table for this field and name different things, or a names the CLASS while
//                  b asks for an INSTANCE ("food safety certification" does not show "ServSafe Manager").
//   same: null   — the table does not know one of the terms here, or no field was given and the two terms do not
//                  share one reading in one field ("IM" alone means intramuscular in a clinic, instant messaging in an
//                  office; "IM" ~ "intramuscular" is answered because only the clinic reading joins them).
//                  Says nothing either way. Pass the field whenever it is known.
//   Outside its field an entry answers null: "pick" is order selection only in a warehouse.

import { loadKnowledge } from './knowledgeData.js';
import { words, stem } from './morph.js';

/** @typedef {{ fields: Set<string>, kind: '='|'>', inst: string[][], cls: string[][], label: string }} Group */
/** @typedef {{ g: number, side: 'i'|'c', member: number, exact: boolean, at: number, len: number }} Hit */

/** @type {{ fields: string[], groups: Group[], byFirst: Map<string, Array<[number, 'i'|'c', number]>>, common: Set<string> } | null} */
let T = null;
const tok = (/** @type {string} */ s) => words(s).map(stem);

function table() {
  if (T) return T;
  const d = loadKnowledge('lib/text/data', 'tradeTalk.json', import.meta.url);
  if (!d) { T = { fields: [], groups: [], byFirst: new Map(), common: new Set() }; return T; }
  const lex = loadKnowledge('lib/text/data', 'synonyms.json', import.meta.url);
  /** @type {Group[]} */
  const groups = d.g.map((/** @type {any[]} */ r) => ({
    fields: new Set(r[0].map((/** @type {number} */ i) => d.f[i])), kind: r[1],
    inst: r[2].map(tok), cls: r[3].map(tok), label: (r[3][0] || r[2][r[2].length > 1 ? 1 : 0]),
  }));
  /** @type {Map<string, Array<[number, 'i'|'c', number]>>} */
  const byFirst = new Map();
  groups.forEach((g, gi) => {
    for (const [side, list] of /** @type {Array<['i'|'c', string[][]]>} */ ([['i', g.inst], ['c', g.cls]])) {
      list.forEach((m, mi) => { if (!byFirst.has(m[0])) byFirst.set(m[0], []); byFirst.get(m[0])?.push([gi, side, mi]); });
    }
  });
  // English words (the WordNet lexicon): a single-word member that is an ordinary word ("pick", "chart", "open")
  // matches only as the whole term or its first word, never buried inside a longer phrase.
  const common = new Set(lex ? Object.keys(lex.w).map(stem) : []);
  T = { fields: d.f, groups, byFirst, common };
  return T;
}

/** True when the trade-talk table is loaded. */
export function hasTradeTalk() { return table().groups.length > 0; }

/** @param {string|string[]|undefined} field */
const fieldSet = (field) => (field == null || field === '' ? null : new Set(Array.isArray(field) ? field : [field]));

/**
 * Where a term mentions a listed member (as a whole word sequence), within the given fields.
 * @param {string} term @param {Set<string> | null} fields
 * @returns {Hit[]}
 */
function hits(term, fields) {
  const X = table();
  const t = tok(term);
  /** @type {Hit[]} */
  const out = [];
  for (let i = 0; i < t.length; i++) {
    for (const [gi, side, mi] of X.byFirst.get(t[i]) || []) {
      const g = X.groups[gi];
      if (fields && ![...fields].some((f) => g.fields.has(f))) continue;
      const m = (side === 'i' ? g.inst : g.cls)[mi];
      if (i + m.length > t.length) continue;
      let ok = true;
      for (let j = 1; j < m.length && ok; j++) ok = t[i + j] === m[j];
      if (!ok) continue;
      const whole = m.length === t.length;
      // a single ordinary English word ("pick", "stow", "rest", "framing") counts only as the whole term:
      // "pick a lock", "stow luggage", "rest breaks" are not the trade's thing
      if (m.length === 1 && X.common.has(m[0]) && !whole) continue;
      out.push({ g: gi, side, member: mi, exact: whole, at: i, len: m.length });
    }
  }
  // longest match wins: "EPA 608 Universal" is the instance, not the "EPA 608" inside it
  return out.filter((h) => !out.some((o) => o.len > h.len && o.at <= h.at && o.at + o.len >= h.at + h.len));
}

/** @param {Group} g */
const kindOf = (g) => (g.kind === '>' ? 'instance of class' : g.inst.some((m) => m.length === 1 && m[0].length <= 5) ? 'abbreviation or trade term' : 'trade term');

/**
 * Does the résumé's term `a` name the posting's thing `b` in this field?
 * @param {string} a résumé term or phrase
 * @param {string} b posting term or phrase
 * @param {{ field?: string | string[] }} [opts] field key(s): food, retail, warehouse, healthcare, nursing, trades, office,
 *   support, sales, k12, itsupport, software, accounting, construction, security, military (see fieldsOf)
 * @returns {{ same: boolean | null, via: string | null, kind: string | null, confidence: 'exact' | 'close' | null }}
 */
export function sameThing(a, b, opts = {}) {
  const none = { same: null, via: null, kind: null, confidence: null };
  const X = table();
  if (!X.groups.length) return none;
  const fields = fieldSet(opts.field);
  const ha = hits(a, fields);
  const hb = hits(b, fields);
  if (!ha.length || !hb.length) return none;
  // without a field, a term that belongs to groups of several fields is ambiguous
  if (!fields) {
    const span = (/** @type {Hit[]} */ hs) => new Set(hs.flatMap((h) => [...X.groups[h.g].fields]));
    const groupsA = new Set(ha.map((h) => h.g));
    const groupsB = new Set(hb.map((h) => h.g));
    const shared = [...groupsA].filter((g) => groupsB.has(g));
    if ((span(ha).size > 1 || span(hb).size > 1) && new Set(shared.flatMap((g) => [...X.groups[g].fields])).size !== 1) return none;
  }
  /** @type {{ same: boolean, via: string, kind: string, confidence: 'exact'|'close' } | null} */
  let falseAnswer = null;
  for (const x of ha) {
    for (const y of hb) {
      if (x.g !== y.g) continue;
      const g = X.groups[x.g];
      const confidence = x.exact && y.exact ? 'exact' : 'close';
      if (g.kind === '=') return { same: true, via: g.label, kind: kindOf(g), confidence };
      if (x.side === 'i' && y.side === 'c') return { same: true, via: g.label, kind: kindOf(g), confidence };
      if (x.side === 'c' && y.side === 'c') return { same: true, via: g.label, kind: kindOf(g), confidence };
      if (x.side === 'i' && y.side === 'i' && x.member === y.member) return { same: true, via: g.label, kind: kindOf(g), confidence };
      // the class does not show the instance; sibling instances are not each other
      falseAnswer = { same: false, via: g.label, kind: kindOf(g), confidence };
    }
  }
  if (falseAnswer) return falseAnswer;
  return { same: false, via: null, kind: null, confidence: ha.every((h) => h.exact) && hb.every((h) => h.exact) ? 'exact' : 'close' };
}

/**
 * What a term shows in a field: its equivalents, or (for an instance) its class. A class shows no instances.
 * @param {string} term
 * @param {{ field?: string | string[] }} [opts]
 * @returns {Array<{ shows: string[], kind: string, fields: string[] }>}
 */
export function expand(term, opts = {}) {
  const X = table();
  if (!X.groups.length) return [];
  const fields = fieldSet(opts.field);
  const seen = new Set();
  const out = [];
  for (const h of hits(term, fields)) {
    const key = `${h.g}:${h.side}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const g = X.groups[h.g];
    // an equivalent shows its whole group; an instance shows its class; a class shows only the class (never instances)
    out.push({ shows: rawMembers(h.g, g.kind === '=' ? 'i' : 'c'), kind: kindOf(g), fields: [...g.fields] });
  }
  return out;
}

/** Listed members of a group side as written in the data file. @param {number} gi @param {'i'|'c'} side */
function rawMembers(gi, side) {
  const d = loadKnowledge('lib/text/data', 'tradeTalk.json', import.meta.url);
  if (!d) return [];
  return side === 'i' ? d.g[gi][2].slice() : d.g[gi][3].slice();
}

/**
 * Field keys for an O*NET-SOC occupation code (several fields can hold).
 * @param {string} code
 * @returns {string[]}
 */
export function fieldsOf(code) {
  const c = String(code || '');
  const out = [];
  if (/^35-/.test(c)) out.push('food');
  if (/^41-(1011|2011|2021|2022|2031)/.test(c)) out.push('retail');
  if (/^41-(1012|3|4|9)/.test(c) || /^11-2022/.test(c)) out.push('sales');
  if (/^53-(1042|1043|7|3033|3031)/.test(c) || /^43-5071|^43-5061|^13-1081/.test(c)) out.push('warehouse');
  if (/^31-|^29-2|^29-9/.test(c)) out.push('healthcare');
  if (/^29-1141|^29-1171|^29-2061|^11-9111|^31-1/.test(c)) out.push('nursing');
  if (/^49-|^47-2(111|152|211)|^47-3/.test(c)) out.push('trades');
  if (/^47-|^11-9021/.test(c)) out.push('construction');
  if (/^43-(1|4|6|9)/.test(c)) out.push('office');
  if (/^43-4051|^43-4|^41-9041/.test(c)) out.push('support');
  if (/^13-2011|^43-3|^11-3031|^13-2/.test(c)) out.push('accounting');
  if (/^25-|^11-9032/.test(c)) out.push('k12');
  if (/^15-123[12]|^15-1244/.test(c)) out.push('itsupport');
  if (/^15-12(5|4[123]|99|11|12)|^15-2051|^11-3021/.test(c)) out.push('software');
  if (/^33-|^15-1212|^15-1299\.05/.test(c)) out.push('security');
  if (/^55-/.test(c)) out.push('military');
  return [...new Set(out)];
}
