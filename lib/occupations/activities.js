// The activity index: a free-text work phrase (a posting duty or a résumé line) → the O*NET Detailed Work Activities
// (DWA) it describes, each under an Intermediate (IWA) and a Generalized (GWA) activity — and whether two phrases
// describe the same kind of work. Rule-based retrieval: Porter stems, IDF-weighted overlap with each activity's own
// title and with the task statements O*NET analysts mapped to it (lib/occupations/data/activities.json, built by
// scripts/occupations/build-activities.mjs; O*NET 31.0, USDOL/ETA, CC BY 4.0). Isomorphic: no data in a browser.
//
//   activitiesOf(phrase, { occupation?, limit? }) → [{ dwa, iwa, gwa, title, iwaTitle, score, via }]   ([] = unknown)
//   relateActivities(a, b, { occupationA?, occupationB? }) → { relation: 'same'|'related'|null, via, confidence } | null
//   activityTitle(dwaOrIwaId) → plain words for copy ("loading or unloading materials")
//   hasActivityData() → is the index loaded
//
// TRUST CONTRACT (what a consumer may conclude):
//   relation 'same'    — both phrases retrieve one Detailed Work Activity: the same kind of work, said differently.
//                        exact → may be shown as "the same kind of work"; close → use, a contradicting reading wins.
//   relation 'related' — one Intermediate Activity (a sibling task): the same family of work, NOT the same duty.
//                        Never proof the requirement is met; at most "partly".
//   null               — no shared activity at a usable score, or one phrase is unknown. Says nothing either way.
//   A phrase scoring below the floor returns [] — a weak nearest neighbour is never offered. Generalized activities
//   alone never relate two phrases (too broad). Tech, sales and marketing work is thin in O*NET's task text: expect []
//   and null there more often than elsewhere.

import { loadKnowledge } from '../text/knowledgeData.js';
import { stem, isStopWord } from '../text/morph.js';
import { unitsOf, workFamilyMembers } from '../text/workFamilies.js';

/** Fraction of the phrase's information an activity must explain. Calibrated on O*NET itself (800 held-out task
 * statements: same-activity pairs vs different-GWA pairs), at the setting whose false rate stayed ≤ 1%, never on the
 * evaluation set. */
export let ACTIVITY_FLOOR = 0.5;
let UNKNOWN_FACTOR = 0.6;
let MIN_SHARED = 2;
let TOP_K = 3;
let CORE = 0.2;
let IWA_FLOOR = 0.8;
let BRIDGE_OOV_ONLY = true;
/** Calibration hook (measurement scripts only): change the retrieval constants. @param {{ floor?: number, unknownFactor?: number, minShared?: number, topK?: number, core?: number }} t */
export function _tune(t) {
  if (t.floor != null) ACTIVITY_FLOOR = t.floor;
  if (t.unknownFactor != null) UNKNOWN_FACTOR = t.unknownFactor;
  if (t.minShared != null) MIN_SHARED = t.minShared;
  if (t.topK != null) TOP_K = t.topK;
  if (/** @type {any} */ (t).core != null) CORE = /** @type {any} */ (t).core;
  if (/** @type {any} */ (t).iwaFloor != null) IWA_FLOOR = /** @type {any} */ (t).iwaFloor;
  if (/** @type {any} */ (t).bridgeAll != null) BRIDGE_OOV_ONLY = !(/** @type {any} */ (t).bridgeAll);
  CACHE.clear();
}
/** Drop the loaded index (calibration only). */
export function _reset() { A = null; CACHE.clear(); }
const FILLER = new Set(['other', 'activ', 'relat', 'use', 'such', 'variou', 'ensur', 'necessari', 'appropri', 'specif', 'determin',
  'accord', 'requir', 'need', 'includ', 'perform', 'provid', 'etc', 'type', 'item', 'oper', 'work', 'job', 'task', 'proper', 'make',
  'everi', 'daili', 'weekli', 'month', 'year', 'team', 'new', 'all', 'each', 'help', 'assist', 'support', 'respons', 'duti']);

/** @typedef {{ dwa: string, iwa: string, gwa: string, title: string, iwaTitle: string, score: number, via: string[] }} Activity */

/** @type {{ v: string[], idf: number[], idfOf: Map<string, number>, post: Map<string, Array<[number, number]>>, ipost: Map<string, Array<[number, number]>>, d: any[], i: any[], g: string[], byId: Map<string, number>, occ: Set<number>[], maxIdf: number } | null} */
let A = null;
function index() {
  if (A) return A;
  const f = loadKnowledge('lib/occupations/data', 'activities.json', import.meta.url);
  if (!f) { A = { v: [], idf: [], idfOf: new Map(), post: new Map(), ipost: new Map(), d: [], i: [], g: [], byId: new Map(), occ: [], maxIdf: 1 }; return A; }
  const idf = f.df.map((/** @type {number} */ x) => Math.log(1 + f.n / x));
  /** @type {Map<string, Array<[number, number]>>} */
  const post = new Map();
  f.d.forEach((/** @type {any[]} */ row, di) => {
    const st = row[2];
    for (let k = 0; k < st.length; k += 2) {
      const s = f.v[st[k]];
      if (!post.has(s)) post.set(s, []);
      post.get(s)?.push([di, st[k + 1] / 100]);
    }
  });
  /** @type {Map<string, Map<number, number>>} */
  const ip = new Map();
  for (const [s, list] of post) {
    const m = new Map();
    for (const [d, w] of list) { const iw = f.d[d][1]; m.set(iw, Math.max(m.get(iw) || 0, w)); }
    ip.set(s, m);
  }
  /** @type {Map<string, Array<[number, number]>>} */
  const ipost = new Map([...ip].map(([s, m]) => [s, [...m.entries()]]));
  A = {
    v: f.v, idf, idfOf: new Map(f.v.map((/** @type {string} */ s, k) => [s, idf[k]])), post, ipost, d: f.d, i: f.i, g: f.g,
    byId: new Map(f.d.map((/** @type {any[]} */ r, k) => [r[4], k])), occ: f.d.map((/** @type {any[]} */ r) => new Set(r[3])),
    maxIdf: Math.max(1, ...idf),
  };
  return A;
}

/** True when the activity index is loaded (false in a browser bundle or after a failed server load). */
export function hasActivityData() { return index().d.length > 0; }

// Work-thesaurus families that are fixed TERMS whose parts mean something else on their own: "logistic regression" is
// not logistics, "age-restricted sales" is not sales work in general, "PT" is not "PTA".
const TERM_FAMILIES = new Set(['logistic_regression', 'age_restricted', 'b2b_sales', 'retail_sales', 'pt', 'pta', 'rn', 'lpn', 'cna']);

/**
 * Content stems of a phrase. A multi-word term the work thesaurus knows as one thing ("logistic regression", "law and
 * order" is not one, "age-restricted sales" is) stays ONE token, so its parts cannot match other work.
 * @param {string} text
 */
function phraseStems(text) {
  const out = [];
  for (const u of unitsOf(text)) {
    if (u.tokens.length > 1 && u.members.some((m) => m.kind === 'object' && TERM_FAMILIES.has(m.fam))) { out.push(u.tokens.join('_')); continue; }
    for (const w of u.tokens) if (w.length > 2 && !isStopWord(w) && !/^\d/.test(w)) out.push(stem(w));
  }
  return [...new Set(out.filter((s) => s.length > 2 && !FILLER.has(s)))];
}

const EXPANSION_WEIGHT = 0.6;
/**
 * For each stem of the phrase, the stems of the other members of its reviewed work families (unconditional
 * memberships only — "coach?staff" never expands to sports).
 * @param {string} phrase
 * @returns {Map<string, Set<string>>}
 */
function expansions(phrase) {
  /** @type {Map<string, Set<string>>} */
  const out = new Map();
  for (const u of unitsOf(phrase)) {
    // object families bridge vocabulary ("trailers" → vehicles); action families only when small and tight
    // ("put away" → store / stack) — a wide verb family ("build" → create, make, produce …) would match anything
    const fams = u.members.filter((m) => !m.cond && (m.kind === 'object' ? familyStems(m.fam).length <= 24 : familyStems(m.fam).length <= 8)).map((m) => m.fam);
    if (!fams.length) continue;
    const own = u.tokens.map(stem);
    // bridge only words O*NET's activity text does not use ("putaway"); a known word speaks for itself
    if (BRIDGE_OOV_ONLY && own.every((o) => index().idfOf.has(o))) continue;
    const sib = new Set();
    for (const f of fams) for (const st of familyStems(f)) if (!own.includes(st)) sib.add(st);
    for (const o of own) {
      if (!out.has(o)) out.set(o, new Set());
      for (const x of sib) out.get(o)?.add(x);
    }
  }
  return out;
}
/** @type {Map<string, string[]> | null} */
let FAM = null;
/** Stems of every unconditional member of a work family (from the shipped thesaurus). @param {string} fam */
function familyStems(fam) {
  if (!FAM) {
    FAM = new Map();
    const famMembers = workFamilyMembers();
    for (const [id, members] of famMembers) FAM.set(id, [...new Set(members.flatMap((m) => m.split(' ')).filter((w) => w.length > 2 && !isStopWord(w)).map(stem))]);
  }
  return FAM.get(fam) || [];
}

/** IDs as O*NET writes them: IWA = the DWA id without its last segment, GWA = without its last two. */
const iwaIdOf = (/** @type {string} */ dwaId) => dwaId.split('.').slice(0, -1).join('.');
const gwaIdOf = (/** @type {string} */ dwaId) => dwaId.split('.').slice(0, -2).join('.');

let occIndexOf = /** @type {((code: string) => number | null) | null} */ (null);
/** Lets index.js hand over the occupation-code → position lookup without a circular import. @param {(code: string) => number | null} fn */
export function _setOccupationLookup(fn) { occIndexOf = fn; }

/**
 * The Detailed Work Activities a work phrase describes, best first; [] when nothing explains at least half of the
 * phrase's information (unknown is an answer).
 * @param {string} phrase
 * @param {{ occupation?: string, limit?: number }} [opts] occupation: an O*NET-SOC code whose own tasks get a small boost
 * @returns {Activity[]}
 */
export function activitiesOf(phrase, opts = {}) {
  const key = `${phrase}\u241f${opts.occupation || ''}\u241f${opts.limit || 5}\u241f${ACTIVITY_FLOOR}\u241f${MIN_SHARED}\u241f${CORE}\u241f${BRIDGE_OOV_ONLY}`;
  const hit = CACHE.get(key);
  if (hit) return hit.map((x) => ({ ...x, via: x.via.slice() }));
  const r = activitiesOfUncached(phrase, opts);
  if (CACHE.size > 5000) CACHE.clear();
  CACHE.set(key, r);
  return r.map((x) => ({ ...x, via: x.via.slice() }));
}
/** @type {Map<string, Activity[]>} */
const CACHE = new Map();

/** @param {string} phrase @param {{ occupation?: string, limit?: number }} opts @returns {Activity[]} */
function activitiesOfUncached(phrase, opts) {
  const X = index();
  if (!X.d.length) return [];
  const occI = opts.occupation && occIndexOf ? occIndexOf(opts.occupation) : null;
  const out = [];
  for (const [d, score, via] of scoreAgainst(phrase, X.post)) {
    const sc = occI != null && X.occ[d].has(occI) ? score * 1.15 : score;
    if (sc < ACTIVITY_FLOOR) continue;
    const row = X.d[d];
    const iwa = X.i[row[1]];
    out.push({ dwa: row[4], iwa: iwaIdOf(row[4]), gwa: gwaIdOf(row[4]), title: row[0], iwaTitle: iwa ? iwa[0] : '', score: Math.round(Math.min(1, sc) * 1000) / 1000, via });
  }
  out.sort((x, y) => y.score - x.score || (x.dwa < y.dwa ? -1 : 1));
  return out.slice(0, opts.limit || 5);
}

/**
 * Intermediate activities a phrase describes (each IWA's vocabulary = the union of its detailed activities'), best first.
 * @param {string} phrase @param {number} limit
 * @returns {Array<{ iwa: number, score: number }>}
 */
function iwasOf(phrase, limit) {
  const X = index();
  return scoreAgainst(phrase, X.ipost).filter((r) => r[1] >= IWA_FLOOR).sort((x, y) => y[1] - x[1] || x[0] - y[0]).slice(0, limit).map(([iwa, score]) => ({ iwa, score }));
}

/**
 * IDF-weighted coverage of a phrase by each candidate (a DWA or an IWA). Rules: at least two shared words; the verb
 * alone never counts (an object word must hit the candidate's CORE vocabulary); a word O*NET never uses counts against
 * coverage; an out-of-vocabulary word may be bridged by its reviewed work family at 0.6.
 * @param {string} phrase @param {Map<string, Array<[number, number]>>} postings
 * @returns {Array<[number, number, string[]]>} [candidate, score, matched stems]
 */
function scoreAgainst(phrase, postings) {
  const X = index();
  const P = phraseStems(phrase);
  if (!P.length) return [];
  const unknown = X.maxIdf * UNKNOWN_FACTOR;
  const wOf = (/** @type {string} */ s) => X.idfOf.get(s) ?? unknown;
  const mass = P.reduce((acc0, s) => acc0 + wOf(s), 0);
  const exp = expansions(phrase);
  /** @type {Map<number, { sc: number, via: string[], objectHit: boolean }>} */
  const acc = new Map();
  for (const s of P) {
    /** @type {Map<number, [number, string, number]>} */
    const best = new Map();
    for (const [c, f] of [[s, 1], ...[...(exp.get(s) || [])].map((x) => [x, EXPANSION_WEIGHT])]) {
      for (const [d, w] of postings.get(/** @type {string} */ (c)) || []) {
        const v = /** @type {number} */ (f) * (0.4 + 0.6 * w);
        if (!best.has(d) || /** @type {[number, string, number]} */ (best.get(d))[0] < v) best.set(d, [v, /** @type {string} */ (c), w]);
      }
    }
    for (const [d, [v, c, w]] of best) {
      const e = acc.get(d) || { sc: 0, via: [], objectHit: false };
      e.sc += wOf(s) * v;
      e.via.push(c);
      if (s !== P[0] && w >= CORE) e.objectHit = true;
      acc.set(d, e);
    }
  }
  /** @type {Array<[number, number, string[]]>} */
  const out = [];
  for (const [d, e] of acc) {
    if (e.via.length < Math.min(MIN_SHARED, P.length)) continue;
    if (P.length > 1 && !e.objectHit) continue;
    out.push([d, e.sc / mass, e.via]);
  }
  return out;
}

/**
 * Do two work phrases describe the same kind of work?
 *  same    — they share a Detailed Work Activity among their top three (exact when it is the top one for both);
 *  related — they share only an Intermediate Activity among their top three;
 *  null    — nothing shared at a usable score (or either phrase is unknown). Returns null where the data is not loaded.
 * `via.title` is plain words for copy.
 * @param {string} a @param {string} b
 * @param {{ occupationA?: string, occupationB?: string }} [opts]
 * @returns {{ relation: 'same'|'related'|null, via: { dwa?: string, iwa?: string, title: string } | null, confidence: 'exact'|'close'|'guess'|null } | null}
 */
export function relateActivities(a, b, opts = {}) {
  if (!hasActivityData()) return null;
  const ra = activitiesOf(a, { occupation: opts.occupationA, limit: TOP_K });
  const rb = activitiesOf(b, { occupation: opts.occupationB, limit: TOP_K });
  if (!ra.length || !rb.length) return { relation: null, via: null, confidence: null };
  for (const x of ra) {
    const y = rb.find((z) => z.dwa === x.dwa);
    if (y) {
      const top = ra[0].dwa === x.dwa && rb[0].dwa === x.dwa;
      return { relation: 'same', via: { dwa: x.dwa, iwa: x.iwa, title: x.title }, confidence: top && Math.min(x.score, y.score) >= 0.7 ? 'exact' : top ? 'close' : 'guess' };
    }
  }
  for (const x of ra) {
    const y = rb.find((z) => z.iwa === x.iwa);
    if (y) {
      const top = ra[0].iwa === x.iwa && rb[0].iwa === x.iwa;
      return { relation: 'related', via: { iwa: x.iwa, title: x.iwaTitle }, confidence: top ? 'close' : 'guess' };
    }
  }
  // the same Intermediate Activity when each phrase is read against whole IWA vocabularies (the union of their DWAs)
  const ia = iwasOf(a, TOP_K);
  const ib = iwasOf(b, TOP_K);
  const X = index();
  for (const x of ia) {
    if (ib.some((y) => y.iwa === x.iwa)) {
      const row = X.d.find((r) => r[1] === x.iwa);
      const top = ia[0].iwa === x.iwa && ib[0].iwa === x.iwa;
      return { relation: 'related', via: { iwa: row ? iwaIdOf(row[4]) : '', title: (X.i[x.iwa] || [''])[0] }, confidence: top ? 'close' : 'guess' };
    }
  }
  return { relation: null, via: null, confidence: null };
}

/**
 * Plain words for an activity id (a DWA or an IWA element id): "loading or unloading materials". '' when unknown.
 * @param {string} id
 */
export function activityTitle(id) {
  const X = index();
  const d = X.byId.get(String(id || ''));
  if (d != null) return X.d[d][0];
  const row = X.d.find((r) => iwaIdOf(r[4]) === id);
  return row ? (X.i[row[1]] || [''])[0] : '';
}
