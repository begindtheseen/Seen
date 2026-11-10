// judge2: does a résumé line hold a statement's unit (its action, its object, a detail)? Matched through KNOWLEDGE,
// never through shared characters:
//   1.0  the same word in another form (morph: "trained" / "train", "remakes" / "remake", "presentation" / "present")
//   0.9  the same work family, its conditions met by the objects of the line or the statement (workFamilies:
//        "new hire" ~ "team member", "guest" ~ "customer", "count" ~ "cash" when drawers are counted)
//   1.0 / 0.85  the same thing under trade talk in the field (tradeTalk sameThing, résumé term → posting term, one way;
//        exact → 1.0, close → 0.85)
//   0.8  a kept WordNet synonym (synonyms relateWords: first senses only)
// A unit no source links is 0 — "unknown", which the judge reads as "not shown on this line", never as a contradiction.
import { relateWords } from '../../text/synonyms.js';
import { sameThing } from '../../text/tradeTalk.js';
import { inflectionCandidates, stem } from '../../text/morph.js';
import { surfaceTokens, formsOf, unitsIn } from './reading.js';
import { workFamilyMembers } from '../../text/workFamilies.js';

/** @typedef {import('./reading.js').Unit} Unit */
/** @typedef {{ text: string, toks: Array<{ w: string, s: string }>, units: Array<{ text: string, tokens: string[], key: string, fams: any[], spec: number }>, forms: Map<string, string>, words: Set<string> }} ReadLine */

/** @param {string} text @returns {ReadLine} */
export function readLine(text) {
  const toks = surfaceTokens(text);
  /** @type {Map<string, string>} */
  const forms = new Map();
  for (const t of toks) for (const f of formsOf(t.w)) if (!forms.has(f)) forms.set(f, t.s);
  return { text, toks, units: unitsIn(text), forms, words: new Set(toks.map((t) => t.w)) };
}

/** Object families and object words a set of units names (the context a conditional family member needs). */
function contextOf(/** @type {Array<{ tokens: string[], key: string, fams: any[] }>} */ units) {
  const fams = new Set();
  const words = new Set();
  for (const u of units) {
    for (const f of u.fams) if (f.kind === 'object' && !f.cond) fams.add(f.fam);
    words.add(u.key);
    for (const t of u.tokens) for (const f of inflectionCandidates(t)) words.add(f);
  }
  return { fams, words };
}
/** A conditional membership holds when one of its named objects (a family id or a word) is in the context. */
function holds(/** @type {{ cond: string[] | null }} */ m, /** @type {{ fams: Set<string>, words: Set<string> }} */ ctx) {
  if (!m.cond) return true;
  return m.cond.some((c) => ctx.fams.has(c) || inflectionCandidates(c).some((b) => ctx.words.has(b)));
}

// a family of 20+ members is a broad class (every kind of worker, every kind of time word): a match through it says
// "the same kind of thing", not "the same thing" — it adds to coverage, never makes a unit matched
const BROAD = 20;
/** @type {Map<string, number> | null} */
let SIZES = null;
function familySize(/** @type {string} */ fam) {
  if (!SIZES) { SIZES = new Map(); for (const [k, v] of workFamilyMembers()) SIZES.set(k, v.length); }
  return SIZES.get(fam) || 0;
}

/** @type {Map<string, { same: boolean, how: string | null }>} */
const WN = new Map();
function wordnet(/** @type {string} */ a, /** @type {string} */ b) {
  const k = a < b ? `${a}|${b}` : `${b}|${a}`;
  let r = WN.get(k);
  if (!r) {
    r = relateWords(a, b);
    if (WN.size > 50000) WN.clear();
    WN.set(k, r);
  }
  return r;
}

/**
 * How well a line holds one statement unit. `atSpec` is how specific the LINE's word is: evidence is only as specific as
 * the weaker side ("draft" shown by "write" is as generic as "write").
 * @param {Unit} u
 * @param {ReadLine} line
 * @param {{ fams: Set<string>, words: Set<string>, statement?: { fams: Set<string>, words: Set<string> }, line?: { fams: Set<string>, words: Set<string> } }} ctx
 *   object context of the statement and of the line (each side's conditional members are checked against its own)
 * @returns {{ m: number, via: string, at: string, atSpec: number }}
 */
export function unitOnLine(u, line, ctx) {
  let best = { m: 0, via: '', at: '', atSpec: 0 };
  const take = (/** @type {number} */ m, /** @type {string} */ via, /** @type {string} */ at, /** @type {number} */ atSpec) => { if (m > best.m) best = { m, via, at, atSpec }; };
  // 1. the same word in another form
  let hit = 0; const at = [];
  for (const t of u.tokens) { const f = formsOf(t).find((x) => line.forms.has(x)); if (f) { hit++; at.push(line.forms.get(f) || t); } }
  if (hit) take(hit === u.tokens.length ? 1 : 0.5 * (hit / u.tokens.length) + (u.tokens.length > 1 && hit / u.tokens.length >= 0.5 ? 0.3 : 0), 'word', at.join(' '), u.spec);
  if (best.m >= 1) return best;
  // 1b. one Porter stem for a longer word ("documentation" / "documented", "analytical" / "analysis")
  if (u.tokens.length === 1 && u.tokens[0].length >= 6) {
    const st = stem(u.tokens[0]);
    if (st.length >= 5) for (const t of line.toks) if (t.w.length >= 5 && stem(t.w) === st) { take(0.85, 'stem', t.s, u.spec); break; }
  }
  // 2. the same work family (conditions met by the objects present)
  // (an action is compared with actions and a thing with things: "inventory" is not the act of counting)
  const kind = u.role === 'action' ? 'action' : 'object';
  // (a conditional member counts when ITS OWN side meets the condition: the statement's verb by the statement's objects,
  // the line's verb by the line's objects — "develop" is a scheduling verb only for someone developing schedules)
  const mine = u.fams.filter((f) => f.kind === kind && holds(f, ctx.statement || ctx));
  if (mine.length) {
    for (const v of line.units) {
      if (!v.fams.length) continue;
      const shared = mine.find((f) => v.fams.some((g) => g.fam === f.fam && g.kind === f.kind && holds(g, ctx.line || ctx)));
      // (in a broad family the class word is shown by any member — "team members" by "new hires" — but a specific member
      // is not shown by a sibling: "nursing" is not "rep"; instance ⇒ class, one way)
      if (shared) { take(familySize(shared.fam) >= BROAD && u.spec >= 0.3 ? 0.7 : 0.9, `family:${shared.fam}`, v.text, v.spec); if (best.m >= 0.9) break; }
    }
  }
  if (best.m >= 0.9) return best;
  // 3. a kept WordNet synonym (single words only; first senses, by the module's contract)
  if (u.tokens.length === 1 && u.spec >= 0.08) {
    for (const v of line.units) {
      if (v.tokens.length !== 1 || v.spec < 0.08) continue;
      const r = wordnet(u.tokens[0], v.tokens[0]);
      // (only WordNet's own answers here — the work-family answer was taken above, with each side's conditions)
      if (r.same && r.how !== 'work') { take(r.how === 'family' || r.how === 'identical' ? 1 : 0.8, `wordnet:${r.how}`, v.text, v.spec); if (best.m >= 0.8) break; }
    }
  }
  return best;
}

/**
 * Trade talk for a whole phrase of the statement against the line: in the posting's field, does the line name the
 * phrase's thing (instance ⇒ class one way)? 1.0 exact, 0.85 close, 0 otherwise (null and false say nothing here).
 * @param {string} lineText @param {string} phrase @param {string[]} fields
 */
export function tradeOnLine(lineText, phrase, fields) {
  if (!fields.length || !phrase) return { m: 0, via: '' };
  const r = sameThing(lineText, phrase, { field: fields });
  if (r.same === true) return { m: r.confidence === 'exact' ? 1 : 0.85, via: `trade:${r.via}` };
  return { m: 0, via: '' };
}

/** The object context of a statement's units and a line's units together. */
export function pairContext(/** @type {Array<{ tokens: string[], key: string, fams: any[] }>} */ statementUnits, /** @type {ReadLine} */ line) {
  const both = contextOf([...statementUnits, ...line.units]);
  return { ...both, statement: contextOf(statementUnits), line: contextOf(line.units) };
}
