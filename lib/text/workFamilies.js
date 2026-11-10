// The work thesaurus: hand-reviewed families of work ACTIONS (teach ≈ educate ≈ instruct; build ≈ develop for
// software) and work OBJECTS (customer ≈ client ≈ guest; inventory ≈ stock ≈ merchandise), shipped in
// lib/text/data/workFamilies.json (source scripts/text/work-families.txt, built by scripts/text/build-work-families.mjs).
// No network, no model.
//
//   unitsOf(text)                     → the phrase read as units: multi-word members first ("look ahead", "work with"),
//                                       each with the action / object families it can belong to
//   relatePhrases(a, b, { field? })   → { same, how, action, object } — do two short phrases (a requirement and a
//                                       résumé line) name the same work act on the same kind of thing?
//   sameWorkWord(a, b, { field?, context? }) → { same, family, conditional } | null (null = a word the table does not know)
//
// A conditional member ("coach?staff", "drive?vehicles", "client?care") counts only when the object it acts on — in
// either phrase — is one of the named objects or in their family (or, for an object member, in the named field).
// Tests: workFamilies.test.mjs.

import { loadKnowledge } from './knowledgeData.js';
import { words, inflectionCandidates, derivationCandidates, isStopWord } from './morph.js';

/** @typedef {{ fam: string, kind: 'action'|'object', cond: string[] | null }} Membership */
/** @typedef {{ text: string, key: string, tokens: string[], members: Membership[] }} Unit */

/** @type {{ byFirst: Map<string, Array<{ seq: string[], key: string, m: Membership }>>, fields: Map<string, string[]>, ids: Set<string> } | null} */
let T = null;
function table() {
  if (T) return T;
  const d = (loadKnowledge('lib/text/data', 'workFamilies.json', import.meta.url) || { a: {}, o: {} });
  /** @type {Map<string, Array<{ seq: string[], key: string, m: Membership }>>} */
  const byFirst = new Map();
  const add = (/** @type {string} */ member, /** @type {Membership} */ m) => {
    const seq = member.split(' ');
    if (!byFirst.has(seq[0])) byFirst.set(seq[0], []);
    byFirst.get(seq[0])?.push({ seq, key: member, m });
  };
  for (const [fam, ms] of Object.entries(d.a)) for (const [w, c] of /** @type {any[]} */ (ms)) add(w, { fam, kind: 'action', cond: c ? c.split('|') : null });
  /** @type {Map<string, string[]>} */
  const fields = new Map();
  for (const [fam, v] of Object.entries(d.o)) {
    fields.set(fam, /** @type {any} */ (v).f);
    for (const [w, c] of /** @type {any} */ (v).m) add(w, { fam, kind: 'object', cond: c ? c.split('|') : null });
  }
  for (const list of byFirst.values()) list.sort((x, y) => y.seq.length - x.seq.length);   // longest member first
  T = { byFirst, fields, ids: new Set([...Object.keys(d.a), ...Object.keys(d.o)]) };
  return T;
}

/** Base forms a text token could be (itself, its inflections, the verb a noun of action names). @param {string} t */
function forms(t) {
  const out = inflectionCandidates(t);
  for (const d of derivationCandidates(t)) if (!out.includes(d)) out.push(d);
  return out;
}

/**
 * A phrase read as units. Multi-word members are matched first (longest), then single words; words the
 * table does not know become units with no memberships (still compared literally).
 * @param {string} text
 * @returns {Unit[]}
 */
export function unitsOf(text) {
  const { byFirst } = table();
  const toks = words(text);
  /** @type {Unit[]} */
  const out = [];
  for (let i = 0; i < toks.length;) {
    /** @type {{ len: number, key: string, ms: Membership[] } | null} */
    let hit = null;
    for (const f of forms(toks[i])) {
      for (const cand of byFirst.get(f) || []) {
        if (hit && cand.seq.length < hit.len) break;
        if (i + cand.seq.length > toks.length) continue;
        let ok = true;
        for (let j = 1; j < cand.seq.length && ok; j++) ok = forms(toks[i + j]).includes(cand.seq[j]);
        if (!ok) continue;
        if (!hit || cand.seq.length > hit.len) hit = { len: cand.seq.length, key: cand.key, ms: [] };
        if (cand.key === hit.key || cand.seq.length === hit.len) { if (!hit.ms.includes(cand.m)) hit.ms.push(cand.m); }
      }
    }
    if (hit) {
      out.push({ text: toks.slice(i, i + hit.len).join(' '), key: hit.key, tokens: toks.slice(i, i + hit.len), members: hit.ms });
      i += hit.len;
    } else {
      if (!isStopWord(toks[i]) && !/^\d+$/.test(toks[i])) out.push({ text: toks[i], key: inflectionCandidates(toks[i])[1] || toks[i], tokens: [toks[i]], members: [] });
      i += 1;
    }
  }
  return out;
}

// Verbs that carry no work act of their own ("perform maintenance", "conduct interviews", "provide care"):
// the noun after them says what was done.
const LIGHT_VERBS = new Set(['perform', 'conduct', 'provide', 'do', 'carry out', 'complete', 'execute', 'ensure', 'responsible', 'able', 'work']);

/** Literal comparison key of a unit (singular / base form). @param {Unit} u */
const lit = (u) => (u.members.length ? u.key : inflectionCandidates(u.tokens[0]).slice(-1)[0] || u.text);

/**
 * Object families a set of units stands for (unconditional object memberships, or conditional ones whose
 * field / family is satisfied by `field` or by the other units).
 * @param {Unit[]} units @param {string | undefined} field
 */
function objectFamilies(units, field) {
  const { fields } = table();
  const fams = new Set();
  const plain = units.flatMap((u) => u.members.filter((m) => m.kind === 'object' && !m.cond).map((m) => m.fam));
  const plainFields = new Set(plain.flatMap((f) => fields.get(f) || []));
  for (const u of units) for (const m of u.members) {
    if (m.kind !== 'object') continue;
    if (!m.cond) { fams.add(m.fam); continue; }
    if (m.cond.some((c) => c === field || plainFields.has(c) || plain.includes(c))) fams.add(m.fam);
  }
  return fams;
}

/**
 * Does a conditional action membership hold, given the objects present (families + literal words)?
 * @param {Membership} m @param {Set<string>} objFams @param {Set<string>} objWords
 */
function actionHolds(m, objFams, objWords) {
  if (!m.cond) return true;
  for (const c of m.cond) {
    if (objFams.has(c)) return true;                                    // a family id
    const base = inflectionCandidates(c);
    if (base.some((b) => objWords.has(b))) return true;                 // the literal object word
    for (const u of unitsOf(c)) for (const mm of u.members) if (mm.kind === 'object' && !mm.cond && objFams.has(mm.fam)) return true;
  }
  return false;
}

/**
 * @param {Unit[]} units
 * @returns {{ fams: Set<string>, words: Set<string> }}
 */
function objectContext(units, field) {
  const fams = objectFamilies(units, field);
  const ws = new Set();
  for (const u of units) {
    if (u.members.some((m) => m.kind === 'action') && !u.members.some((m) => m.kind === 'object')) continue;
    for (const f of [u.key, ...u.tokens.flatMap((t) => inflectionCandidates(t))]) ws.add(f);
  }
  return { fams, words: ws };
}

/**
 * Do two short phrases name the same work act on the same kind of thing?
 *  - actions agree when the same verb (base form) appears in both, or two verbs share an action family whose
 *    conditions the objects of EITHER phrase satisfy;
 *  - objects agree when both name the same object word, or share an object family; when both phrases name
 *    objects and none agree, the phrases are NOT the same ("drive a truck" vs "drive revenue");
 *  - at least one action or object must agree.
 * @param {string} a
 * @param {string} b
 * @param {{ field?: string }} [opts]
 * @returns {{ same: boolean, how: string, action: { a: string, b: string, family: string | null } | null, object: { a: string, b: string, family: string | null } | null }}
 */
export function relatePhrases(a, b, opts = {}) {
  if (!table().ids.size) return { same: false, how: 'no knowledge', action: null, object: null };   // browser bundle / failed load
  const ua = unitsOf(a).filter((u) => !LIGHT_VERBS.has(u.key));
  const ub = unitsOf(b).filter((u) => !LIGHT_VERBS.has(u.key));
  const ctx = objectContext([...ua, ...ub], opts.field);
  const famA = objectFamilies(ua, opts.field);
  const famB = objectFamilies(ub, opts.field);
  const isAct = (/** @type {Unit} */ u) => u.members.some((m) => m.kind === 'action');
  // actions
  /** @type {{ a: string, b: string, family: string | null } | null} */
  let action = null;
  const actA = ua.filter(isAct);
  const actB = ub.filter(isAct);
  for (const x of actA) for (const y of actB) {
    if (action) break;
    if (x.key === y.key) { action = { a: x.text, b: y.text, family: null }; break; }
    for (const mx of x.members) {
      if (mx.kind !== 'action' || !actionHolds(mx, ctx.fams, ctx.words)) continue;
      const my = y.members.find((m) => m.kind === 'action' && m.fam === mx.fam && actionHolds(m, ctx.fams, ctx.words));
      if (my) { action = { a: x.text, b: y.text, family: mx.fam }; break; }
    }
  }
  // objects (table objects + unknown nouns compared literally)
  /** @type {{ a: string, b: string, family: string | null } | null} */
  let object = null;
  // an object unit: a satisfied object membership, or a word the table does not know (compared literally)
  // (a word whose object readings all fail their condition is still compared literally); pure verbs are not objects
  const objUnits = (/** @type {Unit[]} */ us, /** @type {Set<string>} */ fams) => us.filter((u) => (!u.members.length)
    || u.members.some((m) => m.kind === 'object' && fams.has(m.fam))
    || (u.members.some((m) => m.kind === 'object') && !u.members.some((m) => m.kind === 'object' && fams.has(m.fam))));
  // the phrase's verb (its first unit, when that can be an action) is not also one of its objects:
  // "Lead a project" has no object "lead"
  const verbOf = (/** @type {Unit[]} */ us) => (us.length > 1 && isAct(us[0]) ? us[0] : null);
  const va = verbOf(ua);
  const vb = verbOf(ub);
  const objA = objUnits(ua, famA).filter((u) => u !== va);
  const objB = objUnits(ub, famB).filter((u) => u !== vb);
  for (const x of objA) for (const y of objB) {
    if (object) break;
    if (lit(x) === lit(y)) { object = { a: x.text, b: y.text, family: null }; break; }
    const fx = objectFamilies([x, ...ua], opts.field);
    const fy = objectFamilies([y, ...ub], opts.field);
    const xs = x.members.filter((m) => m.kind === 'object' && fx.has(m.fam)).map((m) => m.fam);
    const shared = xs.find((f) => y.members.some((m) => m.kind === 'object' && m.fam === f && fy.has(f)));
    if (shared) { object = { a: x.text, b: y.text, family: shared }; break; }
  }
  // both phrases name objects (known or not) and none agree: not the same ("Operate a forklift" ≠ "Operate a business")
  const tableObjA = objA.length > 0;
  const tableObjB = objB.length > 0;
  // a word read as an object that matched ("inventory" ~ "stock") is not also a conflicting action
  const matchedA = object ? object.a : null;
  const matchedB = object ? object.b : null;
  const actionsConflict = actA.some((u) => u.text !== matchedA) && actB.some((u) => u.text !== matchedB) && !action;
  const objectsConflict = tableObjA && tableObjB && !object;
  if (objectsConflict) return { same: false, how: 'different objects', action, object };
  if (actionsConflict) return { same: false, how: 'different actions', action, object };
  if (!action && !object) return { same: false, how: 'nothing in common', action, object };
  return { same: true, how: action && object ? 'action and object' : action ? 'action' : 'object', action, object };
}

/**
 * Word-level check inside the work thesaurus: one family, conditions satisfied by `field` / `context` words.
 * Returns null when either word is not in the table (the caller may fall back to WordNet).
 * @param {string} a @param {string} b
 * @param {{ field?: string, context?: string[] }} [opts]
 * @returns {{ same: boolean, family: string | null, conditional: boolean } | null}
 */
export function sameWorkWord(a, b, opts = {}) {
  const [ua] = unitsOf(a);
  const [ub] = unitsOf(b);
  if (!ua || !ub || !ua.members.length || !ub.members.length) return null;
  if (ua.key === ub.key) return { same: true, family: null, conditional: false };
  const ctxUnits = (opts.context || []).flatMap((c) => unitsOf(c));
  const ctx = objectContext(ctxUnits, opts.field);
  for (const field of [opts.field].filter(Boolean)) ctx.fams.add(/** @type {string} */ (field));
  const holds = (/** @type {Membership} */ m) => (m.kind === 'action' ? actionHolds(m, ctx.fams, ctx.words) : !m.cond || m.cond.some((c) => c === opts.field || ctx.fams.has(c)));
  for (const mx of ua.members) {
    if (!holds(mx)) continue;
    const my = ub.members.find((m) => m.fam === mx.fam && m.kind === mx.kind && holds(m));
    if (my) return { same: true, family: mx.fam, conditional: !!(mx.cond || my.cond) };
  }
  return { same: false, family: null, conditional: false };
}

/**
 * The families a word or phrase belongs to (for display / debugging).
 * @param {string} text
 */
export function familiesOf(text) {
  return unitsOf(text).map((u) => ({ text: u.text, families: u.members.map((m) => `${m.kind}:${m.fam}${m.cond ? `?${m.cond.join('|')}` : ''}`) }));
}

/** Is a family id known? @param {string} id */
export function isFamily(id) { return table().ids.has(id); }
