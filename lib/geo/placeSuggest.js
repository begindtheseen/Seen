// Place suggestions and the one fixed format — server only (reads the vendored place tables through usPlaces.js).
// Served by GET /api/places (api/places.js); the browser side is components/ui/LocationInput.tsx.
//
//   suggestPlaces(text, limit = 8) → [{ label, kind, detail? }]   kind: 'place' | 'state' | 'zip' | 'remote'
//   resolvePlace(text)             → { label, kind } | null       the single fixed form of what was typed, or null
//
// Labels are the fixed format: "City, ST" with the everyday name ("Boise, ID", never "Boise City, ID"; "Nashville, TN",
// never "Nashville-Davidson, TN"), a whole state by name ("Texas", "New York State"), and "Remote".
//
// Ranking (suggestPlaces), in order:
//   1. what the whole text resolves to (a nickname "PHX", a ZIP "85004", "phoenix az", "texas", "remote");
//   2. a state whose name or code IS the text ("ca", "ohio");
//   3. places whose everyday or official name starts with the text, by population — an exact name ×3 ("York, PA"
//      before "Yorktown"); states whose name starts with the text compete at a tenth of their summed population
//      ("tex" → Texas first, "new" → New York, NY before New York State);
//   4. from 3 letters, places with a later word starting with the text ("louis" → St. Louis, MO) compete at a tenth
//      of their population.
//   Only labels the job search reads back as themselves are offered (a fixed point of resolvePlace).
//   A state after the name narrows the list: "springfield, il", "phoenix a", "st louis mo", "albany new york".
//   3–4 digits → the places those ZIP codes belong to.
//
// resolvePlace — the rules for a field left without picking a suggestion (blur / Enter / a form save):
//   - "remote" / "work from home" → "Remote";
//   - geocodePlace (lib/geo/usPlaces.js, the reader the job search itself uses) places it → its fixed label, when the
//     text names the state, is a ZIP or a known nickname, or the place has 10,000+ people. A bare small-town name
//     ("Toronto" → Toronto, OH, 5k) is NOT resolved: it is too likely to be somewhere else, so it is kept as typed;
//   - an ambiguous bare name ("Springfield": MO 171k vs MA 155k) → null, kept as typed — the suggestion list offers
//     every Springfield instead (geocodePlace refuses to pick one unless one is 3× the next);
//   - geocodePlace finds nothing but the words are exactly one place's indexed name ("winston salem") → that place,
//     under the same rules;
//   - a whole state → its label; several places ("Phoenix; Dallas"), a county-only reading, "near me" → null.
// Everything is in memory: the index is built once per instance (~0.3 s cold, measured in placeSuggest.test.mjs),
// then a query is a binary search plus a scan of the matching names (well under a millisecond warm).

import { placesByPopulation, geocodePlace, isNickname, isDevicePhrase, allZips } from './usPlaces.js';
import { STATE_NAMES, stateLabel, isRemoteText, placeKey } from './placeFormat.js';

export const BARE_MIN_POP = 10000;
const REMOTE = Object.freeze({ label: 'Remote', kind: 'remote' });

// Same spelling rules as usPlaces.js norm() ("saint"/"ste" → "st", "ft "/"mt " spelled out, no accents or periods),
// plus hyphens / slashes as spaces so "winston salem" finds "Winston-Salem". Commas are kept for the caller to split.
function norm(s) {
  let t = String(s || '');
  if (/[^\x00-\x7f]/.test(t)) t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return t
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9, ]+/g, ' ')
    .replace(/\b(?:saint|ste)\b/g, 'st')
    .replace(/\bft\s+(?=[a-z])/g, 'fort ')
    .replace(/\bmt\s+(?=[a-z])/g, 'mount ')
    .replace(/\s+/g, ' ')
    .trim();
}
const key = (s) => norm(s).replace(/,/g, ' ').replace(/\s+/g, ' ').trim();

const LOWER_KIND_RE = /\s(?:city|town|village|borough|township|municipality)$/;
const KIND_RE = /\s+(?:city|town|village|borough|township|municipality|plantation)$/i;

/** The everyday name of a place entry ("Boise City" → "Boise", "Nashville-Davidson" → "Nashville"). */
function everyday(e) {
  const alt = e.alt || [];
  if (alt.length) {
    if (/\(/.test(e.name)) return alt[1] || alt[0]; // Census "official (common)": "San Buenaventura (Ventura)"
    if (/[-/,]|^Urban /.test(e.name)) return alt[0]; // a consolidated government: "Louisville/Jefferson County"
    const bare = e.name.replace(KIND_RE, '');
    if (bare !== e.name && alt.includes(bare)) return bare; // "Indianapolis city", "Weymouth Town", "Boise City" (ID)
  }
  return e.name.replace(LOWER_KIND_RE, '');
}

let IDX = null;
// The name index is two sorted arrays of plain strings "key\u0000n" (n = the item's number) — V8 sorts plain strings
// several times faster than pairs, and "\u0000" sorts before any letter, so a prefix range stays contiguous.
const SEP = '\u0000';
function index() {
  if (IDX) return IDX;
  const items = new Map(); // label → { label, kind, state, pop }
  const list = []; // item number → item
  const displayBy = new Map(); // "ST|key" → everyday name
  const keys = []; // whole names
  const inner = []; // from a later word on ("louis" in "st louis")
  const statePop = {};
  const entries = placesByPopulation(0).slice().sort((a, b) => b.pop - a.pop);
  for (const e of entries) {
    if (e.state === 'DC' && e.name !== 'Washington') continue; // DC is one city
    const display = everyday(e);
    if (!display) continue;
    const label = `${display}, ${e.state}`;
    const nameKey = key(e.name);
    const own = new Set([nameKey]);
    own.add(display === e.name ? nameKey : key(display));
    for (const a of e.alt || []) own.add(key(a));
    own.delete('');
    for (const k of own) { const dk = `${e.state}|${k}`; if (!displayBy.has(dk)) displayBy.set(dk, display); }
    statePop[e.state] = (statePop[e.state] || 0) + e.pop;
    let it = items.get(label);
    if (!it) {
      it = { label, kind: 'place', state: e.state, pop: e.pop, n: list.length };
      items.set(label, it);
      list.push(it);
    } else if (e.pop > it.pop) it.pop = e.pop;
    for (const k of own) {
      keys.push(k + SEP + it.n);
      let at = k.indexOf(' ');
      while (at >= 0) {
        const rest = k.slice(at + 1);
        const sp = rest.indexOf(' ');
        if ((sp < 0 ? rest.length : sp) >= 3) inner.push(rest + SEP + it.n); // the later word has 3+ letters
        at = k.indexOf(' ', at + 1);
      }
    }
  }
  const states = [];
  for (const code of Object.keys(STATE_NAMES)) {
    const label = stateLabel(code);
    if (!label) continue;
    const name = key(STATE_NAMES[code]);
    const names = code === 'NY' || code === 'WA' ? [name, `${name} state`] : [name];
    states.push({ label, kind: 'state', state: code, pop: statePop[code] || 0, name, names, code: code.toLowerCase() });
  }
  keys.sort();
  inner.sort();
  IDX = { items, list, displayBy, keys, inner, states, zips: null };
  return IDX;
}

// [key, item] for each indexed name starting with p (binary search to the first, then walk the run).
function* withPrefix(arr, p) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (arr[mid] < p) lo = mid + 1; else hi = mid; }
  const { list } = index();
  for (let i = lo; i < arr.length && arr[i].startsWith(p); i++) {
    const cut = arr[i].lastIndexOf(SEP);
    yield [arr[i].slice(0, cut), list[Number(arr[i].slice(cut + 1))]];
  }
}

/** The everyday name for a geocodePlace / ZIP name in a state. */
function displayFor(state, name) {
  if (!name) return null;
  return index().displayBy.get(`${state}|${key(name)}`) || String(name).replace(LOWER_KIND_RE, '');
}

// State codes named by a typed tail: exact code / name → that one; partial ("a", "ari", "new y") → each match.
function statesFor(tail, partial) {
  const t = key(tail);
  if (!t) return null;
  if (t === 'dc' || t === 'd c' || t === 'district of columbia' || t === 'washington dc') return new Set(['DC']);
  const { states } = index();
  const hit = states.filter((s) => s.code === t || s.names.includes(t));
  if (hit.length) return new Set(hit.map((s) => s.state));
  if (!partial) return null;
  const pre = states.filter((s) => s.code.startsWith(t) || s.name.startsWith(t)).map((s) => s.state);
  if (t.length <= 2 && 'dc'.startsWith(t)) pre.push('DC');
  return pre.length ? new Set(pre) : null;
}

const LONG_STATES = Object.values(STATE_NAMES).map((n) => key(n)).filter((n) => n.includes(' ')).sort((a, b) => b.length - a.length);

// "springfield, il" / "phoenix az" / "albany new york" → { head: "springfield", states: {IL} }; else { head, states: null }.
function splitState(text, partialTail) {
  const n = norm(text);
  const comma = n.lastIndexOf(',');
  if (comma >= 0) {
    const head = key(n.slice(0, comma));
    const tail = n.slice(comma + 1).trim();
    if (!tail) return { head, states: null, qualified: false };
    const st = statesFor(tail, true);
    return st ? { head, states: st, qualified: true } : { head: key(n), states: null, qualified: false };
  }
  const k = key(n);
  const w = k.split(' ');
  // One word, or the whole text is a state ("west virginia" is not West Point, VA).
  if (w.length < 2 || statesFor(k, false)) return { head: k, states: null, qualified: false };
  const long = LONG_STATES.find((s) => k.endsWith(` ${s}`));
  const tailWord = long || w[w.length - 1];
  const exact = statesFor(tailWord, false);
  if (exact) return { head: k.slice(0, k.length - tailWord.length).trim(), states: exact, qualified: true };
  if (partialTail && tailWord.length <= 2) {
    const pre = statesFor(tailWord, true);
    if (pre) return { head: k.slice(0, k.length - tailWord.length).trim(), states: pre, qualified: true };
  }
  return { head: k, states: null, qualified: false };
}

// Places whose name starts with `head` (and, from 3 letters, a later word), ranked; filtered to `states` when given.
function placeMatches(head, states, limit) {
  const { keys, inner } = index();
  if (!head) return [];
  const score = new Map(); // item → score
  const exact = new Set();
  const bump = (it, v) => { if ((score.get(it) || 0) < v) score.set(it, v); };
  for (const [k, it] of withPrefix(keys, head)) {
    if (states && !states.has(it.state)) continue;
    if (k === head) exact.add(it);
    bump(it, (it.pop + 1) * (k === head ? 3 : 1));
  }
  // A later word ("louis" → St. Louis, "worth" → Fort Worth) competes at a tenth of its people, from 3 letters.
  if (head.length >= 3) {
    for (const [, it] of withPrefix(inner, head)) {
      if (states && !states.has(it.state)) continue;
      bump(it, (it.pop + 1) / 10);
    }
  }
  const out = [...score].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([it]) => it);
  out.exact = exact;
  return out;
}

function zipList() {
  const idx = index();
  if (idx.zips) return idx.zips;
  const out = [];
  for (const [zip, v] of allZips()) {
    const d = displayFor(v.state, v.name);
    if (d) out.push([zip, `${d}, ${v.state}`]);
  }
  out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  idx.zips = out;
  return out;
}

function zipPrefixSuggestions(p, limit) {
  const { items } = index();
  const count = new Map();
  const zl = zipList();
  let lo = 0, hi = zl.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (zl[mid][0] < p) lo = mid + 1; else hi = mid; }
  for (let i = lo; i < zl.length && zl[i][0].startsWith(p); i++) count.set(zl[i][1], (count.get(zl[i][1]) || 0) + 1);
  return [...count.keys()]
    .sort((a, b) => ((items.get(b)?.pop || 0) - (items.get(a)?.pop || 0)) || (count.get(b) - count.get(a)))
    .slice(0, limit)
    .map((label) => ({ label, kind: 'zip', detail: `ZIP ${p}…` }));
}

/** Does the text name this state itself (a code or the state's name as words)? */
function namesState(text, state) {
  const k = ` ${key(text)} `;
  return k.includes(` ${state.toLowerCase()} `) || k.includes(` ${key(STATE_NAMES[state] || '')} `);
}

/**
 * The single fixed form of a typed place, or null to keep the text as typed. Rules in the header.
 * @param {unknown} text
 * @returns {{ label: string, kind: 'place'|'state'|'zip'|'remote' } | null}
 */
export function resolvePlace(text) {
  const raw = String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!raw) return null;
  if (isRemoteText(raw)) return REMOTE;
  if (/[;|•]|\s(?:or)\s/i.test(raw) || isDevicePhrase(raw)) return null;
  let g = null;
  try { g = geocodePlace(raw); } catch { g = null; }
  if (!g) return exactName(raw);
  if (g.county) return null;
  if (g.stateOnly) {
    const label = stateLabel(g.state);
    return label ? { label, kind: 'state' } : null;
  }
  const display = displayFor(g.state, g.name);
  if (!display) return null;
  const label = `${display}, ${g.state}`;
  if (/^\d{5}(?:-\d{4})?$/.test(raw)) return { label, kind: 'zip' };
  const pop = index().items.get(label)?.pop || 0;
  if (pop < BARE_MIN_POP && !namesState(raw, g.state) && !isNickname(raw)) return null;
  return { label, kind: 'place' };
}

// geocodePlace found nothing, but the words are exactly one place's name in the index ("winston salem" without its
// hyphen): that place, under the same rules — one clear winner (3× the next), named with its state or 10,000+ people,
// and a label the job search reads back as itself.
function exactName(raw) {
  const sp = splitState(raw, false);
  if (!sp.head) return null;
  const hits = [...placeMatches(sp.head, sp.states, 50).exact].sort((a, b) => b.pop - a.pop);
  if (!hits.length || (hits[1] && hits[0].pop < 3 * hits[1].pop)) return null;
  const it = hits[0];
  if (!sp.states && it.pop < BARE_MIN_POP) return null;
  const r = geocodePlace(it.label);
  return r && !r.stateOnly && r.state === it.state && displayFor(r.state, r.name) === it.label.slice(0, -4) ? { label: it.label, kind: 'place' } : null;
}

const CACHE_MAX = 5000;
const cache = new Map();

/**
 * Up to `limit` suggestions for what has been typed so far. Rules in the header.
 * @param {unknown} text
 * @param {number} [limit]
 * @returns {Array<{ label: string, kind: 'place'|'state'|'zip'|'remote', detail?: string }>}
 */
export function suggestPlaces(text, limit = 8) {
  const raw = String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  const n = Math.max(1, Math.min(10, Number(limit) || 8));
  const ck = `${n}|${placeKey(raw)}`;
  const hit = cache.get(ck);
  if (hit) return hit;
  const out = compute(raw, n);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(ck, out);
  return out;
}

function compute(raw, limit) {
  const k = key(raw);
  if (!k) return [];
  const list = [];
  const push = (s) => { if (s && !list.some((x) => x.label === s.label)) list.push(s); };
  const wantsRemote = isRemoteText(raw) || (k.length >= 2 && 'remote'.startsWith(k));

  const digits = raw.replace(/\s/g, '');
  if (/^\d{3,5}(?:-\d{0,4})?$/.test(digits)) {
    const r = /^\d{5}/.test(digits) ? resolvePlace(digits.slice(0, 5)) : null;
    if (r) push({ ...r, detail: `ZIP ${digits.slice(0, 5)}` });
    else if (digits.length < 5) for (const s of zipPrefixSuggestions(digits, limit)) push(s);
    return list.slice(0, limit);
  }

  const resolved = resolvePlace(raw);
  if (resolved) push(resolved.kind === 'state' ? { ...resolved, detail: 'Whole state' } : resolved);
  if (wantsRemote && (k.length >= 3 || resolved?.kind === 'remote')) push({ ...REMOTE, detail: 'Anywhere in the US' });

  const { states } = index();
  let sp = splitState(raw, false);
  let places = placeMatches(sp.head, sp.states, limit + 4);
  if (!places.length) { // "phoenix a": the last word may be a state being typed
    const again = splitState(raw, true);
    if (again.states) { sp = again; places = placeMatches(sp.head, sp.states, limit + 4); }
  }
  if (!sp.states) {
    const exactState = states.find((s) => s.code === k || s.names.includes(k));
    if (exactState) push({ label: exactState.label, kind: 'state', detail: 'Whole state' });
    // States starting with the text compete with places at a tenth of their people.
    const pre = k.length >= 3 ? states.filter((s) => s.names.some((x) => x.startsWith(k)) && s !== exactState) : [];
    // Keep places in their own order (exact-name boost included); slot each state in by its score.
    const ordered = places.slice();
    for (const s of pre.sort((a, b) => b.pop - a.pop)) {
      const at = ordered.findIndex((it) => it.kind !== 'state' && it.pop < s.pop / 10);
      ordered.splice(at < 0 ? ordered.length : at, 0, s);
    }
    for (const it of ordered) push(it.kind === 'state' ? { label: it.label, kind: 'state', detail: 'Whole state' } : { label: it.label, kind: 'place' });
  } else {
    for (const it of places) push({ label: it.label, kind: 'place' });
  }
  if (wantsRemote) push({ ...REMOTE, detail: 'Anywhere in the US' });
  // Offer only labels the job search reads back as themselves ("Campus, IL" reads as Illinois — a noise word — and
  // "Webster County, GA" as a county): 7 of 12,390 sampled labels.
  return list.filter((x) => x.kind !== 'place' || readsAsItself(x.label)).slice(0, limit);
}

const selfRead = new Map();
function readsAsItself(label) {
  let ok = selfRead.get(label);
  if (ok === undefined) {
    ok = resolvePlace(label)?.label === label;
    if (selfRead.size >= 50000) selfRead.clear();
    selfRead.set(label, ok);
  }
  return ok;
}

/** Build the index now (an instance's first request pays for it; tests measure it). */
export function warmPlaceIndex() { index(); return true; }
