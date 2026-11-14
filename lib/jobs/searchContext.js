// What a title search can say about ITSELF, from the rows it already holds (api/jobs.js) — never an invented number:
//   alsoSearched(rows, query)    the other titles for the same work the role family brought in ("floorhand",
//                                "derrickhand" for a "roustabout" search), each one a title some shown match carries;
//   paySummary(rows)             the employer-STATED pay on the shown matches: how many state it, and the 10th–90th
//                                percentile range in one unit (hourly or yearly), or null;
//   elsewhereClusters(rows, …)   where matches exist outside a thin radius, grouped to a nearby big place ("Midland, TX").
//
// Each is a pure function of rows the search already read (no database reads here). Rendered by
// components/jobs/SearchContext.tsx and components/jobs/WhereJobsAre.tsx. Tests: lib/jobs/searchContext.test.mjs.
import { expandQueryTerms, effectiveSynonyms, tokenize, tokenInTitle, normalizeCompany } from '../../api/_utils/jobRelevance.js';
import { parsePayText, normalizePay, parseStatedPay, belowWageFloor, formatPay } from './pay.js';
import { placeListing } from '../geo/radius.js';
import { placesWithin, distanceMiles } from '../geo/usPlaces.js';

// ── also_searched ────────────────────────────────────────────────────────────────────────────────────────────────
const ACRONYMS = new Set(['cdl', 'cna', 'csr', 'dsp', 'hvac', 'hvacr', 'cpht', 'rn', 'lpn', 'lvn', 'it', 'ii', 'iii']);
const titleCase = (s) => String(s).split(' ').map((w) => (ACRONYMS.has(w) ? w.toUpperCase() : w.replace(/^\w/, (c) => c.toUpperCase()))).join(' ');
const compact = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '').replace(/s$/, '');
function phraseInTitle(title, phrase) {
  if (phrase.includes(' ')) return title.includes(phrase);
  return new RegExp(`(^|[^a-z0-9])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(title);
}

/**
 * The family titles a search showed besides the one typed: up to `max`, most-shown first, title-cased. Empty when the
 * query has no role / trade family (nothing was expanded) or no shown match carries a family title.
 * A shown match counts toward a family title only when its title does NOT already carry the query's own words — those
 * rows were found by what the person typed, not by the expansion.
 * @param {Array<{ title?: string, related?: boolean, in_radius?: boolean }>} rows the served rows
 * @param {string} query the typed query
 */
export function alsoSearched(rows, query, max = 4) {
  const family = expandQueryTerms(query, 1000);
  if (!family.length) return [];
  const qn = normalizeCompany(query);
  const tokens = tokenize(query);
  if (!tokens.length) return [];
  const qCompact = compact(qn);
  // the family's title phrases, minus generic single words and any phrase the query already says
  const terms = effectiveSynonyms('', family).filter((t) => {
    const words = t.split(' ');
    if (words.every((w) => tokens.includes(w))) return false;
    const c = compact(t);
    return c !== qCompact && !c.includes(qCompact) && !qCompact.includes(c);
  });
  if (!terms.length) return [];
  const count = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || r.related === false) continue;
    const title = String(r.title || '').toLowerCase();
    if (!title) continue;
    if ((qn && title.includes(qn)) || tokens.every((t) => tokenInTitle(title, t))) continue; // the query's own words found it
    for (const t of terms) if (phraseInTitle(title, t)) count.set(t, (count.get(t) || 0) + 1);
  }
  const ranked = [...count.entries()].sort((a, b) => (b[1] - a[1]) || (family.indexOf(a[0]) - family.indexOf(b[0])));
  const picked = [];
  for (const [t] of ranked) {
    const c = compact(t);
    // "Floor Hand" and "Floorhand", "Casing Floorhand" and "Floorhand": one name
    if (picked.some((p) => { const pc = compact(p); return pc === c || pc.includes(c) || c.includes(pc); })) continue;
    picked.push(t);
    if (picked.length >= max) break;
  }
  return picked.map(titleCase);
}

// ── pay_summary ──────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * The pay a row states, as the card renders it (lib/jobs/pay.js displayPay's rules): { lo, hi, period } or null.
 * A free-text pay line ("Competitive", "DOE") states no figure; a figure under the wage floor is not pay.
 */
export function statedPayOf(row) {
  const text = [row?.title, row?.description].filter(Boolean).join('\n');
  const salary = row?.salary ? String(row.salary).trim() : '';
  let n = null;
  if (salary) {
    const p = parsePayText(salary);
    if (!p) return null;
    n = normalizePay({ min: p.lo, max: p.hi, period: p.period, text, prefix: p.prefix });
  } else {
    n = parseStatedPay(text);
  }
  if (!n || !(n.lo > 0) || belowWageFloor(n)) return null;
  return { lo: n.lo, hi: n.hi != null && n.hi > n.lo ? n.hi : n.lo, period: n.period || null };
}

// nearest-rank percentile of a sorted list
const pct = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
export const PAY_MIN_ROWS = 5;
const PAY_ONE_UNIT_SHARE = 0.8;

/**
 * The stated pay on the shown matches (rows with related !== false and in_radius !== false):
 * { stated, total, low, high, unit: 'hr'|'yr', text, other } — `stated` rows state pay in `unit`, `other` state it in
 * another unit; `low` = 10th percentile of the stated lows, `high` = 90th percentile of the stated highs (one outlier
 * never sets the range). Null when fewer than PAY_MIN_ROWS rows state pay in one unit, or no unit holds 80% of them
 * (mixed hourly and yearly pay is not summed into one range).
 * @param {Array<object>} rows the served rows
 */
export function paySummary(rows) {
  const matches = (Array.isArray(rows) ? rows : []).filter((r) => r && r.related !== false && r.in_radius !== false);
  const byUnit = { hour: [], year: [], other: [] };
  for (const r of matches) {
    const p = statedPayOf(r);
    if (!p) continue;
    (p.period === 'hour' ? byUnit.hour : p.period === 'year' ? byUnit.year : byUnit.other).push(p);
  }
  const stating = byUnit.hour.length + byUnit.year.length + byUnit.other.length;
  const unit = byUnit.hour.length >= byUnit.year.length ? 'hour' : 'year';
  const list = byUnit[unit];
  if (list.length < PAY_MIN_ROWS || list.length < stating * PAY_ONE_UNIT_SHARE) return null;
  const los = list.map((p) => p.lo).sort((a, b) => a - b);
  const his = list.map((p) => p.hi).sort((a, b) => a - b);
  let low = pct(los, 0.1);
  let high = pct(his, 0.9);
  if (low > high) [low, high] = [high, low];
  if (unit === 'year') { low = Math.round(low / 1000) * 1000; high = Math.round(high / 1000) * 1000; }
  return {
    stated: list.length,
    total: matches.length,
    other: stating - list.length,
    low, high,
    unit: unit === 'hour' ? 'hr' : 'yr',
    text: formatPay(low, high > low ? high : null, unit),
  };
}

// ── elsewhere ────────────────────────────────────────────────────────────────────────────────────────────────────
const ANCHOR_MILES = 40; // a row is "near" the biggest place within this distance
const ANCHOR_MIN_POP = 25000;
const MERGE_MILES = 60; // two anchors this close are one cluster
const _anchorMemo = new Map();
function anchorOf(pt) {
  const key = `${pt.lat.toFixed(2)},${pt.lng.toFixed(2)}`;
  if (_anchorMemo.has(key)) return _anchorMemo.get(key);
  const big = placesWithin(pt, ANCHOR_MILES, { limit: 1, minPop: ANCHOR_MIN_POP })[0]
    || placesWithin(pt, ANCHOR_MILES, { limit: 1 })[0]
    || (pt.name && pt.state ? { name: pt.name, state: pt.state, lat: pt.lat, lng: pt.lng, pop: 0 } : null);
  // the everyday name a listing uses ("Boise", not the Census "Boise City"; "Nashville", not "Nashville-Davidson")
  const a = big ? { name: (Array.isArray(big.alt) && big.alt[0]) || big.name, state: big.state, lat: big.lat, lng: big.lng, pop: big.pop || 0 } : null;
  if (_anchorMemo.size > 5000) _anchorMemo.clear();
  _anchorMemo.set(key, a);
  return a;
}
const placeLabel = (name, state) => `${name}, ${state}`;

/**
 * Where matching rows are, grouped to the biggest place near each (within 40 mi), places within 60 mi of each other
 * merged: [{ place: "Midland, TX", count, miles|null }], biggest first, at most `max`. Rows that `skip(row)` keeps out
 * (inside the searched radius, not a match) and remote-only / non-US / unplaceable rows are not counted.
 * @param {Array<object>} rows raw rows (location, lat, lng)
 * @param {{ center?: {lat:number,lng:number}|null, skip?: (row: object) => boolean, max?: number }} opts
 */
export function elsewhereClusters(rows, { center = null, skip = () => false, max = 3 } = {}) {
  const groups = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || skip(r)) continue;
    const pl = placeListing(r);
    if (!pl.us || pl.remoteOnly || !pl.points.length) continue;
    const a = anchorOf(pl.points[0]);
    if (!a) continue;
    const k = `${a.state}|${a.name}`;
    const g = groups.get(k) || { anchor: a, count: 0 };
    g.count++;
    groups.set(k, g);
  }
  const clusters = [];
  for (const g of [...groups.values()].sort((x, y) => (y.count - x.count) || (y.anchor.pop - x.anchor.pop))) {
    const near = clusters.find((c) => distanceMiles(c.anchor, g.anchor) <= MERGE_MILES);
    if (near) { near.count += g.count; continue; }
    clusters.push({ anchor: g.anchor, count: g.count });
  }
  return clusters
    .sort((x, y) => y.count - x.count)
    .slice(0, max)
    .map((c) => ({ place: placeLabel(c.anchor.name, c.anchor.state), count: c.count, miles: center ? Math.round(distanceMiles(center, c.anchor)) : null }));
}
