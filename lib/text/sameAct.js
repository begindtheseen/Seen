// Same act on the same kind of thing: does a résumé's verb phrase ("Trained 12 new associates") show a posting's
// ("Onboard new hires")? A verb means the same act only for the KIND OF THING it acts on — "run" a store is "manage"
// a store, "run" tests is not — so the reviewed table (scripts/text/act-families.txt → lib/text/data/actFamilies.json,
// scripts/text/build-act-families.mjs) groups verbs into families by object class, with one-way edges
// (coach ⇒ train; train ⇏ coach). Nouns are compared with tradeTalk's sameThing (field-scoped trade and everyday
// equals: "new associates" = "new hires"). No model, no network. Isomorphic: no data in a browser (every answer null).
//
//   sameAct(résuméVerbPhrase, postingVerbPhrase, { objectClass?, field? })
//     → { same: true | false | null, confidence: 'exact' | 'close' | 'guess' | null, how, via, objectClass, family }
//   readActs(phrase)       → [{ verbs, object, np, head, mods, classes }] — every act the phrase states, one per clause
//   readAct(phrase)        → the first of them (null when no listed verb)
//   actClasses()           → the object class ids
//   hasActFamilies()       → is the table loaded
//
// TRUST CONTRACT
//   same: true,  exact — the same act (same-act verbs of one family, or the same verb) on the same thing (the same
//                        head noun, or a listed equal): use as fact. "Trained new associates" ~ "train new hires".
//   same: true,  close — the same act on a thing of the same narrow class ("Trained cashiers" ~ "train new hires"), or a
//                        one-way edge that holds ("Coached associates" ~ "train associates"): use; a contradicting
//                        line wins. Scale is NOT judged here ("supervised 15" vs "a team of 200+").
//   same: true,  guess — related acts ("near" members: "handled complaints" ~ "resolve complaints"), or the same
//                        act with conflicting modifiers ("maintain patient records" ~ "maintain inventory records"),
//                        or two different things of a BROAD class ("implement audits" ~ "implement integrations"),
//                        or no object on one side (unless the caller gives the class): a tie-break only, never proof.
//   same: false        — known different: the verbs read the objects as different classes ("maintain equipment" vs
//                        "maintain records"; "train staff" vs "train models"), two different families of one class
//                        ("track sales goals" vs "exceed sales goals"), or a one-way edge read backwards ("trained"
//                        does not show "coach"). confidence 'close'. Given only when EVERY act the résumé phrase
//                        states is known not to be the posting's.
//   same: null         — the table does not know a verb or the object's class: says nothing either way.

import { loadKnowledge } from './knowledgeData.js';
import { words, inflectionCandidates, derivationCandidates, stem, isStopWord } from './morph.js';
import { sameThing } from './tradeTalk.js';

/** @typedef {{ id: string, broad: boolean, nouns: string[][], fams: Array<{ id: string, same: Set<string>, near: Set<string> }>, edges: Set<string>, verbs: Set<string> }} ActClass */
/** @typedef {{ verbs: string[], object: string, np: string, head: string | null, mods: string[], classes: number[], skill?: boolean }} Reading */

/** @type {{ classes: ActClass[], links: Set<string>, verbFirst: Map<string, string[][]>, nounFirst: Map<string, Array<{ seq: string[], key: string, cls: number[] }>> } | null} */
let T = null;

function table() {
  if (T) return T;
  const d = loadKnowledge('lib/text/data', 'actFamilies.json', import.meta.url);
  /** @type {ActClass[]} */
  const classes = [];
  /** @type {Map<string, string[][]>} */
  const verbFirst = new Map();
  /** @type {Map<string, Map<string, number[]>>} */
  const nounKeys = new Map();
  for (const [ci, row] of (d ? d.c : []).entries()) {
    const [id, nouns, fams, edges, broad] = row;
    const verbs = new Set();
    const fs = fams.map((/** @type {any[]} */ f) => {
      for (const v of [...f[1], ...f[2]]) verbs.add(v);
      return { id: f[0], same: new Set(f[1]), near: new Set(f[2]) };
    });
    classes.push({ id, broad: !!broad, nouns: nouns.map((/** @type {string} */ n) => n.split(' ')), fams: fs, edges: new Set(edges.map((/** @type {string[]} */ e) => `${e[0]}>${e[1]}`)), verbs });
    for (const v of verbs) {
      const seq = v.split(' ');
      if (!verbFirst.has(seq[0])) verbFirst.set(seq[0], []);
      const l = verbFirst.get(seq[0]);
      if (l && !l.some((s) => s.join(' ') === v)) l.push(seq);
    }
    for (const n of nouns) {
      const first = n.split(' ')[0];
      if (!nounKeys.has(first)) nounKeys.set(first, new Map());
      const m = nounKeys.get(first);
      if (m) { if (!m.has(n)) m.set(n, []); m.get(n)?.push(ci); }
    }
  }
  /** @type {Map<string, Array<{ seq: string[], key: string, cls: number[] }>>} */
  const nounFirst = new Map();
  for (const [first, m] of nounKeys) nounFirst.set(first, [...m].map(([key, cls]) => ({ seq: key.split(' '), key, cls })).sort((a, b) => b.seq.length - a.seq.length));
  for (const l of verbFirst.values()) l.sort((a, b) => b.length - a.length);
  // links hold both ways
  const links = new Set((d && d.l ? d.l : []).flatMap((/** @type {string[]} */ l) => [`${l[0]}~${l[1]}`, `${l[1]}~${l[0]}`]));
  T = { classes, links, verbFirst, nounFirst };
  return T;
}

/** True when the action-family table is loaded. */
export function hasActFamilies() { return table().classes.length > 0; }

/** The object class ids, in table order. */
export function actClasses() { return table().classes.map((c) => c.id); }

/** Forms a token could be (itself, plural/past/-ing bases; short pasts too: "used" → use, "fed" → feed). @param {string} t */
function forms(t) {
  const out = inflectionCandidates(t);
  if (/^[a-z]{2,3}ed$/.test(t)) for (const x of [t.slice(0, -1), t.slice(0, -2)]) if (!out.includes(x)) out.push(x);
  return out;
}

// Nouns of action whose verb no suffix rule finds.
const ACT_NOUN = { maintenance: 'maintain', analysis: 'analyze', analyses: 'analyze', oversight: 'oversee', delivery: 'deliver',
  deliveries: 'deliver', reconciliation: 'reconcile', reconciliations: 'reconcile', research: 'research', care: 'care for',
  supervision: 'supervise', recruitment: 'recruit', recruiting: 'recruit', onboarding: 'onboard', cross: 'cross train',
  inventory: 'count', inventories: 'count', upkeep: 'upkeep', sale: 'sell', sales: 'sell', service: 'serve', repairs: 'repair',
  admission: 'admit', admissions: 'admit', transport: 'transport', transfer: 'transfer', triage: 'triage', escalation: 'escalate',
  payment: 'pay', payments: 'pay', receipt: 'receive', receiving: 'receive', shipping: 'ship', storage: 'store' };
// Verbs that carry no act of their own: the noun after them names it ("perform cycle counts", "provide training to").
const LIGHT = new Set(['perform', 'conduct', 'complete', 'carry out', 'do', 'provide', 'give', 'undertake', 'execute', 'handle', 'participate in', 'take part in', 'assist with', 'assist in', 'help with', 'support', 'ensure']);
// What may come before the verb of a requirement ("Experience training new hires", "Proven ability to lead").
const LEAD_IN = new Set(['experience', 'experienced', 'proven', 'demonstrated', 'ability', 'able', 'to', 'for', 'in', 'at', 'of',
  'with', 'responsible', 'will', 'must', 'can', 'and', 'or', 'record', 'history', 'skilled', 'skill', 'skills', 'years', 'year',
  'strong', 'comfortable', 'you', 'be', 'is', 'are', 'who', 'that', 'help', 'helps', 'helped', 'successfully', 'consistently',
  'regularly', 'actively', 'effectively', 'independently', 'directly', 'personally', 'also', 'routinely', 'daily', 'plus',
  'expertise', 'background', 'knowledge', 'familiarity', 'including', 'such', 'as', 'e', 'g', 'eg', 'like', 'by', 'from']);
// Words that make an "object" an ability or a setting, not a thing acted on.
const SKILL_WORD = new Set(['skill', 'skills', 'ability', 'abilities', 'aptitude', 'attitude', 'mindset', 'sense', 'proficiency',
  'environment', 'pace', 'paced', 'setting', 'manner', 'fashion', 'capacity', 'attention', 'judgment', 'judgement', 'acumen']);
const BOUNDARY = new Set(['on', 'in', 'for', 'with', 'to', 'at', 'by', 'from', 'of', 'across', 'within', 'through', 'throughout',
  'including', 'such', 'that', 'which', 'while', 'as', 'and', 'or', 'into', 'per', 'via', 'using', 'during', 'under', 'over',
  'when', 'where', 'who', 'so', 'than', 'between', 'among', 'around', 'against', 'toward', 'towards', 'like', 'without',
  'upon', 'about', 'after', 'before', 'until', 'if', 'but', 'resulting', 'leading', 'reducing', 'increasing', 'achieving']);
const SKIP = new Set(['the', 'a', 'an', 'all', 'any', 'our', 'their', 'its', 'his', 'her', 'your', 'my', 'this', 'these',
  'those', 'some', 'up', 'over', 'more', 'than', 'nearly', 'approximately', 'about', 'around', 'roughly', 'plus', 'k', 'm']);
// Modifiers that do not make two things different ("daily reports" ~ "reports"; "key accounts" ~ "accounts").
const GENERIC_MOD = new Set(['daily', 'weekly', 'monthly', 'quarterly', 'annual', 'yearly', 'high', 'large', 'small', 'key',
  'multiple', 'various', 'several', 'complex', 'critical', 'internal', 'external', 'existing', 'major', 'minor', 'assigned',
  'own', 'every', 'each', 'many', 'other', 'new', 'all', 'full', 'entire', 'whole', 'overall', 'total', 'top', 'core', 'main',
  'primary', 'general', 'routine', 'standard', 'accurate', 'detailed', 'timely', 'regular', 'ongoing', 'day', 'today',
  'appropriate', 'relevant', 'necessary', 'required', 'needed', 'applicable', 'scale', 'level', 'high-volume', 'volume',
  'person', 'people', 'peak', 'busy', 'strategic', 'effective', 'efficient', 'successful', 'clear', 'positive', 'best', 'great']);

/**
 * Longest listed verb starting at token i (a multi-word verb's later words may be inflected too).
 * @param {string[]} toks @param {number} i
 * @returns {{ verb: string, len: number } | null}
 */
function verbAt(toks, i) {
  const { verbFirst } = table();
  for (const f of forms(toks[i])) {
    for (const seq of verbFirst.get(f) || []) {
      if (i + seq.length > toks.length) continue;
      let ok = true;
      for (let j = 1; j < seq.length && ok; j++) ok = forms(toks[i + j]).includes(seq[j]);
      if (ok) return { verb: seq.join(' '), len: seq.length };
    }
  }
  return null;
}

/** The verb a noun of action names ("training" → train, "counts" → count, "inspections" → inspect). @param {string} t */
function actNounVerb(t) {
  const { verbFirst } = table();
  if (Object.hasOwn(ACT_NOUN, t)) return /** @type {Record<string, string>} */ (ACT_NOUN)[t];
  for (const f of [...forms(t), ...derivationCandidates(t)]) if (verbFirst.has(f) && (verbFirst.get(f) || []).some((s) => s.length === 1)) return f;
  return null;
}

/**
 * Head noun (rightmost listed class noun, else the last content word) and its classes.
 * @param {string[]} obj
 * @returns {{ head: string | null, classes: number[], mods: string[], np: string }}
 */
function headOf(obj) {
  const { nounFirst } = table();
  // a noun is matched in its plural or singular, never through a verb ending ("engineering" is not "engineer")
  const nounForms = (/** @type {string} */ t) => (/(ing|ed)$/.test(t) ? [t] : /[^aeiou]ves$/.test(t) ? [...forms(t), `${t.slice(0, -3)}f`, `${t.slice(0, -3)}fe`] : forms(t));
  /** @type {{ at: number, len: number, key: string, cls: number[] } | null} */
  let best = null;
  for (let i = 0; i < obj.length; i++) {
    for (const f of nounForms(obj[i])) {
      for (const n of nounFirst.get(f) || []) {
        if (i + n.seq.length > obj.length) continue;
        let ok = true;
        for (let j = 1; j < n.seq.length && ok; j++) ok = nounForms(obj[i + j]).includes(n.seq[j]);
        if (!ok) continue;
        const end = i + n.seq.length;
        if (!best || end > best.at + best.len || (end === best.at + best.len && n.seq.length > best.len)) best = { at: i, len: n.seq.length, key: n.key, cls: n.cls };
      }
    }
  }
  const content = (/** @type {string} */ t) => !isStopWord(t) && !/^\d/.test(t) && !SKIP.has(t);
  if (best) {
    const b = best;
    // modifiers: every content word but the head's own last word ("inventory records" → inventory)
    return { head: b.key, classes: [...new Set(b.cls)], mods: obj.filter((t, k) => k !== b.at + b.len - 1 && k < b.at + b.len && content(t)), np: obj.slice(0, b.at + b.len).join(' ') };
  }
  const cs = obj.filter(content);
  if (!cs.length) return { head: null, classes: [], mods: [], np: '' };
  const last = cs[cs.length - 1];
  return { head: forms(last)[1] || last, classes: [], mods: cs.slice(0, -1), np: obj.join(' ') };
}

/**
 * One act read from token `start`: the verb is the first listed verb within `scan` tokens — at the start, after a
 * lead-in ("experience", "ability to"), or an -ing/-ed form — then its coordinated verbs and its object.
 * @param {string[]} toks @param {number} start @param {number} scan
 * @returns {{ reading: Reading, tail: number } | null}
 */
function readFrom(toks, start, scan) {
  /** @type {{ verb: string, len: number, at: number } | null} */
  let v = null;
  /** @type {string[]} */
  let pre = [];
  for (let i = start; i < Math.min(toks.length, start + scan) && !v; i++) {
    if (toks[i] === 'track' && toks[i + 1] === 'record') { i++; continue; }
    const hit = verbAt(toks, i);
    if (!hit) continue;
    // a past or -ing form may stand mid-phrase; a plain -s word there is a noun ("trial specific reports")
    const inflected = /(ing|ed)$/.test(toks[i]) || (!/s$/.test(toks[i]) && forms(toks[i]).length > 1 && forms(toks[i])[0] !== hit.verb.split(' ')[0]);
    // "of" leads in only after record / history / experience ("track record of exceeding"), not "sense of design"
    const leadIn = i === start || (LEAD_IN.has(toks[i - 1]) && (toks[i - 1] !== 'of' || ['record', 'history', 'experience', 'years'].includes(toks[i - 2])));
    if (leadIn || inflected) {
      v = { ...hit, at: i };
      // "cash handling", "inventory counting": the words before an -ing form are its object
      if (!leadIn && /ing$/.test(toks[i])) pre = toks.slice(start, i).filter((t) => !LEAD_IN.has(t));
    }
  }
  if (!v) return null;
  const verbs = [v.verb];
  let i = v.at + v.len;
  // coordinated verbs ("Lead and develop a team", "receive, stock and rotate product")
  while (i < toks.length - 1 && (toks[i] === 'and' || toks[i] === 'or')) {
    const nx = verbAt(toks, i + 1);
    if (!nx) break;
    verbs.push(nx.verb);
    i += 1 + nx.len;
  }
  /** @type {string[]} */
  const obj = [];
  let tail = i;
  for (; tail < toks.length && obj.length < 6; tail++) {
    const t = toks[tail];
    if (!obj.length && t === 'day' && toks[tail + 1] === 'to' && toks[tail + 2] === 'day') { tail += 2; continue; }   // "day to day operations"
    if (BOUNDARY.has(t)) break;
    // a past-tense listed verb starts the next clause ("answered phones greeted visitors sorted mail")
    if (obj.length && /ed$/.test(t) && verbAt(toks, tail)) break;
    if (!obj.length && (SKIP.has(t) || /^\d/.test(t))) continue;
    obj.push(t);
  }
  let object = pre.length ? pre : obj;
  // a light verb takes its act from the noun after it ("conduct inventory counts" → count inventory)
  if (LIGHT.has(verbs[0]) && obj.length) {
    for (let k = obj.length - 1; k >= 0; k--) {
      // a two-word act ("cycle counts" → cycle count) before a one-word one ("counts" → count)
      const two = k > 0 ? verbAt(obj, k - 1) : null;
      const multi = two && two.len === 2 ? two.verb : null;
      const nv = multi || actNounVerb(obj[k]);
      if (!nv) continue;
      verbs[0] = nv;
      object = obj.slice(0, multi ? k - 1 : k);
      if (!object.length) {
        // "provide training to new hires", "perform maintenance on equipment"
        let j = tail;
        if (j < toks.length && ['to', 'for', 'of', 'on', 'with'].includes(toks[j])) j++;
        const after = [];
        for (; j < toks.length && after.length < 6; j++) {
          if (BOUNDARY.has(toks[j])) break;
          if (!after.length && (SKIP.has(toks[j]) || /^\d/.test(toks[j]))) continue;
          after.push(toks[j]);
        }
        object = after;
        tail = j;
      }
      break;
    }
  }
  // "writing skills", "operate in a fast paced environment": an ability, not an act on a thing
  if (object.some((t) => SKILL_WORD.has(t))) return { reading: { verbs, object: '', np: '', head: null, mods: [], classes: [], skill: true }, tail };
  const h = headOf(object);
  return { reading: { verbs, object: object.join(' '), np: h.np, head: h.head, mods: h.mods, classes: h.classes }, tail };
}

/**
 * Every act a phrase states: one per clause ("Answered phones and scheduled appointments" → answer phones; schedule
 * appointments). Clauses are split at ; : , • | , at "and"/"then" before a listed verb, and at a past-tense listed verb
 * ("answered phones greeted visitors sorted mail").
 * @param {string} phrase
 * @returns {Reading[]}
 */
export function readActs(phrase) {
  if (!hasActFamilies()) return [];
  /** @type {Reading[]} */
  const out = [];
  /** @type {Reading[]} */
  let waiting = [];   // "Mentor, coach, and support therapists": verbs of a comma list wait for the list's object
  for (const piece of String(phrase || '').split(/([;:•|]|,\s|\.\s|\s[-–—]\s)/)) {
    if (/^([;:•|]|\.\s|\s[-–—]\s)$/.test(piece)) { out.push(...waiting); waiting = []; continue; }
    if (/^,\s$/.test(piece)) continue;
    const toks = words(piece);
    let r = readFrom(toks, 0, 10);
    if (!r) { out.push(...waiting); waiting = []; }
    let first = true;
    while (r) {
      const rd = r.reading;
      if (first) {
        if (!rd.head && !rd.skill) { waiting.push(rd); r = null; break; }
        for (const w of waiting) out.push({ ...rd, verbs: w.verbs });
        waiting = [];
        first = false;
      }
      if (!rd.skill) out.push(rd);
      let next = null;
      for (let k = r.tail; k < toks.length - 1 && !next; k++) {
        if (/ed$/.test(toks[k]) && verbAt(toks, k)) { next = readFrom(toks, k, 1); continue; }
        if (toks[k] !== 'and' && toks[k] !== 'then' && toks[k] !== 'while') continue;
        next = readFrom(toks, k + 1, 1);
      }
      r = next && next.tail > r.tail ? next : null;
    }
  }
  out.push(...waiting);
  return out;
}

/**
 * How a verb phrase is read (its first act): verb(s), object phrase, head noun and the object classes that noun can
 * be in.
 * @param {string} phrase
 * @returns {Reading | null} null when no listed verb is found
 */
export function readAct(phrase) {
  return readActs(phrase)[0] || null;
}

/**
 * Do two head nouns name the same thing? 'exact' when equal or when the résumé's is a kind of the posting's
 * ("data pipeline" shows "pipeline"); 'close' when the posting's is the more specific one.
 * @param {string} a résumé head @param {string} b posting head
 * @returns {'exact' | 'close' | null}
 */
function headRelation(a, b) {
  const fa = a.split(' ').map((t) => forms(t));
  const fb = b.split(' ').map((t) => forms(t));
  const endsWith = (/** @type {string[][]} */ x, /** @type {string[][]} */ y) => y.length <= x.length
    && y.every((f, k) => f.some((w) => x[x.length - y.length + k].includes(w)));
  if (fa.length === fb.length) return endsWith(fa, fb) ? 'exact' : null;
  if (endsWith(fa, fb)) return 'exact';
  if (endsWith(fb, fa)) return 'close';
  return null;
}

/**
 * The act relation of two verbs within one class.
 * @param {ActClass} c @param {string} va résumé verb @param {string} vb posting verb
 * @returns {{ kind: 'same'|'edge'|'near'|'reverse'|'different'|null, family: string | null }}
 */
function relateVerbs(c, va, vb) {
  if (!c.verbs.has(va) || !c.verbs.has(vb)) return { kind: null, family: null };
  const famOf = c.fams.find((f) => (f.same.has(va) || f.near.has(va)) && (f.same.has(vb) || f.near.has(vb)));
  if (va === vb) return { kind: 'same', family: famOf ? famOf.id : null };
  const sameFam = c.fams.find((f) => f.same.has(va) && f.same.has(vb));
  if (sameFam) return { kind: 'same', family: sameFam.id };
  if (c.edges.has(`${va}>${vb}`)) return { kind: 'edge', family: famOf ? famOf.id : null };
  if (c.edges.has(`${vb}>${va}`)) return { kind: 'reverse', family: famOf ? famOf.id : null };
  if (famOf) return { kind: 'near', family: famOf.id };
  return { kind: 'different', family: null };
}

const RANK = { same: 5, edge: 4, near: 3, reverse: 2, different: 1 };

/**
 * Does the résumé's verb phrase show the posting's: the same act on the same kind of thing?
 * @param {string} resumePhrase e.g. "Trained 12 new associates on the register"
 * @param {string} postingPhrase e.g. "Onboard and train new hires"
 * @param {{ objectClass?: string, field?: string | string[] }} [opts] objectClass: one of actClasses() — the class both
 *   objects are known to be in (used when a phrase has no object, and to pick one reading); field: a tradeTalk field
 *   key, used to compare the nouns
 * @returns {{ same: boolean | null, confidence: 'exact' | 'close' | 'guess' | null, how: string | null, via: string | null, objectClass: string | null, family: string | null }}
 */
export function sameAct(resumePhrase, postingPhrase, opts = {}) {
  const none = { same: null, confidence: null, how: null, via: null, objectClass: null, family: null };
  if (!table().classes.length) return none;
  const as = readActs(resumePhrase);
  const bs = readActs(postingPhrase);
  if (opts.objectClass && !table().classes.some((c) => c.id === opts.objectClass)) return none;
  // every act on one side against every act on the other: the strongest "yes" wins; else a known "no"; else null
  const CONF = { exact: 3, close: 2, guess: 1 };
  /** @type {ReturnType<typeof compareReadings>} */
  let best = none;
  /** @type {ReturnType<typeof compareReadings> | null} */
  let no = null;
  let unknown = false;
  for (const ra of as) for (const rb of bs) {
    const r = compareReadings(ra, rb, opts);
    if (r.same === true && (best.same !== true || CONF[r.confidence || 'guess'] > CONF[best.confidence || 'guess'])) best = r;
    else if (r.same === false) no = no || r;
    else if (r.same === null) unknown = true;
  }
  if (best.same === true) return best;
  // "no" only when every act of the résumé phrase is known not to be the posting's (an unread act could be it)
  return no && !unknown ? no : none;
}

/**
 * @param {Reading} ra résumé act @param {Reading} rb posting act
 * @param {{ objectClass?: string, field?: string | string[] }} opts
 * @returns {{ same: boolean | null, confidence: 'exact' | 'close' | 'guess' | null, how: string | null, via: string | null, objectClass: string | null, family: string | null }}
 */
function compareReadings(ra, rb, opts) {
  const none = { same: null, confidence: null, how: null, via: null, objectClass: null, family: null };
  const X = table();
  const forced = opts.objectClass ? X.classes.findIndex((c) => c.id === opts.objectClass) : -1;

  // the objects: the same thing (same head word, or a listed equal in tradeTalk), known different, or unknown
  /** @type {'exact'|'close'|null} */
  let thing = null;
  let thingByEqual = false;   // the nouns are equal by a listed equivalence (not just by their head word)
  let differentThing = false;
  const hr = ra.head && rb.head ? headRelation(ra.head, rb.head) : null;
  if (hr) thing = hr;
  // the posting names a kind the résumé does not ("records" vs "CRM records"): the same thing at most close
  const content = (/** @type {string[]} */ ms) => ms.filter((t) => !GENERIC_MOD.has(t));
  if (thing === 'exact' && content(rb.mods).length > 0 && content(ra.mods).length === 0) thing = 'close';
  if (thing !== 'exact' && ra.np && rb.np) {
    const st = sameThing(ra.np, rb.np, { field: opts.field });
    if (st.same === true) { thing = st.confidence === 'exact' ? 'exact' : 'close'; thingByEqual = true; }
    else if (st.same === false && st.via && !thing) differentThing = true;
  }
  let clsA = ra.classes.slice();
  let clsB = rb.classes.slice();
  if (thing) { const u = [...new Set([...clsA, ...clsB])]; clsA = u; clsB = u; }   // an equal names one thing
  if (forced >= 0) {
    clsA = !ra.head || !clsA.length || clsA.includes(forced) ? [forced] : clsA;
    clsB = !rb.head || !clsB.length || clsB.includes(forced) ? [forced] : clsB;
  }
  const noObject = !ra.head || !rb.head;
  if (noObject && forced < 0) {
    // no object on a side: it takes the other side's classes (or any class, when neither names one)
    if (!ra.head) clsA = rb.head ? clsB.slice() : X.classes.map((_, k) => k);
    if (!rb.head) clsB = ra.head ? clsA.slice() : X.classes.map((_, k) => k);
  }
  if (!clsA.length || !clsB.length) return none;

  // the verbs pick the reading: the classes where each phrase's verb is listed
  const readsA = clsA.filter((k) => ra.verbs.some((v) => X.classes[k].verbs.has(v)));
  const readsB = clsB.filter((k) => rb.verbs.some((v) => X.classes[k].verbs.has(v)));
  const shared = readsA.filter((k) => readsB.includes(k));
  if (!shared.length) {
    // linked families across classes ("supervise pickers" ~ "oversee warehouse operations"): related, never proof
    for (const ka of readsA) for (const kb of readsB) for (const va of ra.verbs) for (const vb of rb.verbs) {
      const fa = X.classes[ka].fams.find((f) => f.same.has(va) || f.near.has(va));
      const fb = X.classes[kb].fams.find((f) => f.same.has(vb) || f.near.has(vb));
      if (fa && fb && X.links.has(`${X.classes[ka].id}.${fa.id}~${X.classes[kb].id}.${fb.id}`)) {
        return { same: true, confidence: 'guess', how: 'related act across classes', via: `${va} ${ra.head || ''} (${X.classes[ka].id}) ~ ${vb} ${rb.head || ''} (${X.classes[kb].id})`, objectClass: null, family: null };
      }
    }
    if (readsA.length && readsB.length && !noObject) {
      const ca = X.classes[readsA[0]].id;
      const cb = X.classes[readsB[0]].id;
      return { same: false, confidence: 'close', how: 'different object class', via: `${ra.verbs[0]} ${ra.head} (${ca}) vs ${rb.verbs[0]} ${rb.head} (${cb})`, objectClass: null, family: null };
    }
    return none;
  }
  /** @type {{ kind: 'same'|'edge'|'near'|'reverse'|'different', family: string | null, cls: number, va: string, vb: string } | null} */
  let best = null;
  for (const k of shared) for (const va of ra.verbs) for (const vb of rb.verbs) {
    const r = relateVerbs(X.classes[k], va, vb);
    if (!r.kind) continue;
    if (!best || RANK[r.kind] > RANK[best.kind]) best = { kind: r.kind, family: r.family, cls: k, va, vb };
  }
  if (!best) return none;
  const cid = X.classes[best.cls].id;
  const via = `${best.va} ~ ${best.vb} (${cid}${best.family ? `: ${best.family}` : ''})`;
  const out = (/** @type {boolean} */ same, /** @type {'exact'|'close'|'guess'} */ confidence, /** @type {string} */ how) => ({ same, confidence, how, via, objectClass: cid, family: best ? best.family : null });
  if (best.kind === 'different') return out(false, 'close', 'different act');
  if (best.kind === 'reverse') return out(false, 'close', 'one-way edge read backwards');
  // conflicting modifiers ("patient records" vs "inventory records") or a known-different noun pair: only a guess
  const modsA = content(ra.mods).map(stem);
  const modsB = content(rb.mods).map(stem);
  const conflict = differentThing || (!thingByEqual && modsA.length > 0 && modsB.length > 0 && !modsA.some((m) => modsB.includes(m)));
  // a broad class (systems, projects, documents…): two different things in it are not the same thing
  const broadMiss = !thing && !noObject && X.classes[best.cls].broad;
  if (best.kind === 'near') return out(true, 'guess', 'related act');
  // an object on one side only: the class comes from that side; when the RÉSUMÉ names no object it proves little
  if (noObject && forced < 0) return out(true, 'guess', !ra.head && !rb.head ? 'no object on either side' : !ra.head ? 'no object on the résumé side' : 'no object on the posting side');
  if (conflict) return out(true, 'guess', best.kind === 'same' ? 'same act, different modifiers' : 'one-way edge, different modifiers');
  if (broadMiss) return out(true, 'guess', best.kind === 'same' ? 'same act, different things in a broad class' : 'one-way edge, different things in a broad class');
  if (best.kind === 'edge') return out(true, thing || noObject ? 'close' : 'guess', 'one-way edge holds');
  if (thing === 'exact') return out(true, 'exact', 'same act, same thing');
  return out(true, 'close', thing === 'close' ? 'same act, equal thing' : noObject ? 'same act, object class given' : 'same act, same class');
}
