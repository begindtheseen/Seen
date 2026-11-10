// Résumé → matching listings: the ONE matcher behind the /jobs "Matched to your résumé" rail
// (api/jobs.js handleRecommended) and the matched-jobs emails (api/cron-job-matches.js), so the two can
// never disagree about what "matched to your résumé" means.
//
// Rebuilt 2026-11-10 on the person's job keys (lib/server/jobKeys.js, profiles.job_keys): a match is a
// live US listing near the person (or genuinely remote) that passes matchListing — the listing's field is
// one their résumé holds (or a close neighbour, or one they applied to in the last 60 days, or the field
// of their degree at entry level), every required minimum of years is met by their years IN THAT FIELD,
// every required licence is theirs, and the level is at most one step up. Each match carries the reason a
// person would nod at. There is no padding and no live "floor" pull: three right matches beat six with a
// wrong one, and zero is said honestly.
//
// The old resume_skills cache is not read: it does not exist in production (PGRST205, verified
// 2026-11-10), and the keys are re-derived whenever they are missing, of an old version, or built from a
// different résumé text or set of applications.

import { readFileSync } from 'node:fs';
import { geocodeLocation, boundingBox } from './geo.js';
import { isReadableResume } from './resumeReadability.js';
import { deriveResumeCity } from './resumeJobMatch.js';
import { locationDbTerm, parseLocation } from '../../api/_utils/jobRelevance.js';
import { scoreRow } from './jobScore.js';
import {
  buildJobKeys, keysStale, matchListing, placeMatch, occupation, hasJobKeysColumn, storeJobKeys, readOccupations, readTermsFor,
  readRecentApplications, serviceDb, normTitle,
} from './jobKeys.js';

export const RAIL_MILES = 30;
const COLS = 'id,title,company,location,salary,apply_url,description,type,level,source,score,waste_score,lat,lng,ats_tenant,created_at,availability_status';
const DEAD = new Set(['stale', 'expired', 'closed', 'filled', 'removed']);

// The radius read: a bounding box OR'd with the city (and nearby towns) named in the row's own location
// text — most ATS rows have no coordinates. Two `or=` params on one PostgREST read are ANDed.
export function geoScopeClause(center, miles, cityTerm, nearby = []) {
  const clean = (x) => String(x || '').replace(/[(),*\\]/g, '').replace(/\./g, '*').trim();
  const names = [...new Set([clean(cityTerm), ...nearby.map(clean)])].filter((n) => n.length >= 3).slice(0, 24);
  const b = boundingBox(center, miles);
  const parts = [];
  if (b) {
    const f = (n) => n.toFixed(6);
    parts.push(`and(lat.gte.${f(b.latMin)},lat.lte.${f(b.latMax)},lng.gte.${f(b.lngMin)},lng.lte.${f(b.lngMax)})`);
  }
  for (const n of names) parts.push(`location.ilike.*${n}*`);
  if (!parts.length) return '';
  return `&or=${encodeURIComponent(`(${parts.join(',')})`)}`;
}

// Counties whose land reaches into the circle (lib/geo/data/us-counties.json, the table lib/geo/usPlaces.js
// places "<neighbourhood>, <County>" rows with), as listings write them: "harris county".
let _counties;
function countiesNear(center, miles, distanceMiles) {
  if (_counties === undefined) {
    try { _counties = JSON.parse(readFileSync(new URL('../geo/data/us-counties.json', import.meta.url), 'utf8')).counties || []; } catch { _counties = []; }
  }
  const out = [];
  for (const [, name, lat, lng, aland] of _counties) {
    const reach = 10 + 0.8 * Math.sqrt(Math.max(1, aland || 400)); // the same reach usPlaces uses
    if (distanceMiles(center, { lat, lng }) <= miles + reach) out.push(String(name).toLowerCase().replace(/[^a-z ]/g, ''));
  }
  return [...new Set(out)].slice(0, 30);
}

let _geo; // lib/geo/usPlaces.js (local Census/USGS places), feature-detected once per instance
async function loadGeo() {
  if (_geo !== undefined) return _geo;
  let places = null; let radius = null;
  try { places = await import('../geo/usPlaces.js'); } catch { places = null; }
  try { radius = await import('../geo/radius.js'); } catch { radius = null; } // L's placement helper, when present
  _geo = places ? { ...places, ...(radius && typeof radius.withinRadius === 'function' ? { withinRadius: radius.withinRadius } : {}) } : null;
  return _geo;
}

const matchKey = (j) => `${normTitle(j.title)}|${normTitle(j.company)}`;

/**
 * Find the listings that match a user's job keys, best first.
 *
 * @param {{ supabaseUrl: string, serviceKey: string, userId: string, persist?: boolean, now?: Date,
 *   geo?: object|null, miles?: number, exclude?: { jobIds?: Set<string>, keys?: Set<string> } }} opts
 *   mode: 'rail' (a summary-only row only for the person's own current title or an applied-to job type) or
 *   'email' (summary-only rows are returned flagged `_summaryOnly`; the cron must read the full posting).
 *   persist: write rebuilt keys back to profiles.job_keys (false for dry runs). onlyKeys: stop once the
 *   keys are known (the alert path checks requirements with them).
 * @returns {Promise<{ hasResume: boolean|null, reason: null|'no_resume'|'no_signal'|'unavailable'|'no_city',
 *   ranked: Array<object>, city: string|null, citySource: 'profile'|'resume'|null, keys: object|null,
 *   applications: Array<object>|null, skills: string[], seniority: null, fn: null, heal: Promise|null }>}
 *   Each ranked row carries `_reason` (the sentence to show), `_basis`, `_occupation`, `_remote`,
 *   `_miles` and `_matchScore`.
 */
export async function findResumeMatches({ supabaseUrl, serviceKey, userId, persist = true, now = new Date(), geo, miles = RAIL_MILES, exclude = null, onlyKeys = false, mode = 'rail' }) {
  const db = serviceDb(supabaseUrl, serviceKey);
  const out = { hasResume: null, reason: null, ranked: [], city: null, citySource: null, keys: null, applications: null, skills: [], seniority: null, fn: null, heal: null };
  const uid = encodeURIComponent(userId);

  const hasCol = await hasJobKeysColumn(db);
  const [profRes, apps] = await Promise.all([
    db(`profiles?id=eq.${uid}&select=resume_text,resume_updated_at,city${hasCol ? ',job_keys' : ''}&limit=1`).catch(() => null),
    readRecentApplications(db, userId, now),
  ]);
  const profRows = profRes && profRes.ok ? await profRes.json().catch(() => null) : null;
  const prof = Array.isArray(profRows) ? (profRows[0] || {}) : null; // null = the profile read failed
  const resumeText = typeof prof?.resume_text === 'string' ? prof.resume_text : '';
  out.applications = apps;
  out.hasResume = prof ? (!!resumeText && isReadableResume(resumeText)) : null;
  if (out.hasResume === false) {
    // Keys of a removed résumé are cleared, so nothing can match from them.
    if (persist && hasCol && prof?.job_keys) out.heal = storeJobKeys(db, userId, null, now);
    out.reason = 'no_resume';
    return out;
  }
  if (!prof) { out.reason = 'unavailable'; return out; }

  // The keys: stored when they describe this résumé and these applications, else rebuilt now.
  let keys = hasCol ? prof.job_keys : null;
  if (keysStale(keys, { resumeText, applications: apps, now })) {
    keys = buildJobKeys({ resumeText, applications: apps || [], profile: prof, now });
    if (persist && hasCol) out.heal = storeJobKeys(db, userId, keys, now);
  }
  out.keys = keys;
  if (onlyKeys) return out;
  if (!(keys.occupations || []).length && !(keys.applied || []).length && !(keys.education || []).length) {
    out.reason = 'no_signal';
    return out;
  }

  // Home: the profile city, else the city the résumé states.
  let city = String(prof.city || '').trim().slice(0, 80);
  let citySource = city ? 'profile' : null;
  if (!city) { city = deriveResumeCity(resumeText); citySource = city ? 'resume' : null; }
  if (!city) { out.reason = 'no_city'; return out; }
  out.city = city;
  out.citySource = citySource;

  const g = geo === undefined ? await loadGeo() : geo;
  let point = null;
  try { const p = g && typeof g.geocodePlace === 'function' ? g.geocodePlace(city) : null; if (p && !p.stateOnly) point = { lat: Number(p.lat), lng: Number(p.lng) }; } catch { point = null; }
  if (!point) {
    const c = await geocodeLocation(city, supabaseUrl, serviceKey).catch(() => null);
    if (c && Number.isFinite(Number(c.lat))) point = { lat: Number(c.lat), lng: Number(c.lng) };
  }
  let nearby = [];
  try { nearby = point && g && typeof g.placesWithin === 'function' ? g.placesWithin(point, miles, { limit: 10, minPop: 5000 }).map((p) => p.name) : []; } catch { nearby = []; }
  // Big places in the circle as listings write them bare ("Phoenix", "Glendale") — lib/geo areaTextPatterns.
  try {
    if (point && g && typeof g.areaTextPatterns === 'function') {
      for (const pat of g.areaTextPatterns(point, miles)) if (!pat.includes('_') && !pat.includes('>')) nearby.push(pat.replace(/\*/g, ' ').trim());
    }
  } catch { /* names above are enough */ }
  const parsed = parseLocation(city);
  const cityTerm = parsed && parsed.city ? parsed.city : locationDbTerm(city);
  const scope = point ? geoScopeClause(point, miles, cityTerm, nearby) : (cityTerm ? `&location=ilike.*${encodeURIComponent(String(cityTerm).replace(/[(),*\\]/g, ''))}*` : '');
  const nowIso = encodeURIComponent(now.toISOString());
  const read = (filter, limit) => db(`jobs?${filter.replace(/^select_hint=1&/, '')}&expires_at=gt.${nowIso}&select=${COLS}&order=created_at.desc&limit=${limit}`)
    .then(async (r) => (r && r.ok ? r.json() : null)).catch(() => null);

  // One read per occupation in the keys (the same keys the rule judges with): every title word of that job type
  // OR'd, inside the radius; and for remote-able job types the rows whose location says remote, names only the
  // US, or is blank (placeMatch reads the posting text for "remote").
  // The read is derived from the SAME keys the rule judges with (jobKeys.readOccupations / readTermsFor): every
  // title word of every job type in the keys, OR'd. Places: the radius clause (box, city, nearby towns) plus, for
  // rows with no coordinates, every way a location line names a place in the circle (lib/geo areaTextPatterns)
  // and the counties those places are in ("Usps Official, Harris County"). Remote-able job types also read rows
  // whose location says remote, names only the US, or is blank (placeMatch reads the posting for "remote").
  const reads = [];
  const ilike = (col, t) => `${col}.ilike.*${String(t).replace(/[^a-zA-Z0-9 \-+#]/g, '').slice(0, 40)}*`; // literal spaces kept (" rn ")
  const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
  const occIds = readOccupations(keys, now).slice(0, 16);
  const words = [...new Set(occIds.flatMap((id) => readTermsFor(id)))];
  const remoteWords = [...new Set(occIds.filter((id) => occupation(id)?.remote).flatMap((id) => readTermsFor(id)))];
  const areaPats = [];
  try {
    if (point && g && typeof g.areaTextPatterns === 'function') areaPats.push(...g.areaTextPatterns(point, miles));
    if (point && g && typeof g.distanceMiles === 'function') for (const c of countiesNear(point, miles, g.distanceMiles)) areaPats.push(`*${c}*`);
  } catch { /* the radius clause alone */ }
  const scopes = [scope, ...chunk([...new Set(areaPats)], 45).map((c) => `&or=${encodeURIComponent(`(${c.map((pat) => `location.ilike.${pat}`).join(',')})`)}`)];
  for (const group of chunk(words, 32)) {
    const titleOr = `&or=${encodeURIComponent(`(${group.map((w) => ilike('title', w)).join(',')})`)}`;
    for (const sc of scopes) reads.push(read(`select_hint=1${titleOr}${sc}`, 300));
  }
  for (const group of chunk(remoteWords, 32)) {
    const titleOr = `&or=${encodeURIComponent(`(${group.map((w) => ilike('title', w)).join(',')})`)}`;
    reads.push(read(`select_hint=1${titleOr}&or=${encodeURIComponent('(location.ilike.*remote*,location.ilike.*united states*,location.ilike.usa*,location.eq.US,location.ilike.*anywhere*,location.is.null)')}`, 300));
  }
  const results = await Promise.all(reads);
  if (results.length && results.every((r) => r === null)) { out.reason = 'unavailable'; return out; }

  const home = { city, point };
  const appliedIds = new Set([...(apps || []).map((a) => a.job_id).filter(Boolean).map(String), ...(exclude?.jobIds || [])]);
  const appliedKeys = new Set([...(apps || []).map((a) => matchKey({ title: a.role || a.job_title, company: a.company_name })), ...(exclude?.keys || [])]);
  const best = new Map();
  const seen = new Set();
  for (const j of results.flat()) {
    if (!j?.id || seen.has(j.id)) continue;
    seen.add(j.id);
    if (DEAD.has(String(j.availability_status || '').toLowerCase())) continue;
    if (appliedIds.has(String(j.id)) || appliedKeys.has(matchKey(j))) continue;
    const place = placeMatch(j, home, g, miles);
    if (!place.ok) continue;
    const m = matchListing(j, keys, { now, mode });
    if (!m.ok || !m.reason) continue;
    const ageDays = (now.getTime() - Date.parse(j.created_at || '')) / 86_400_000;
    const score = m.rank
      + (place.remote ? 0 : 8) - (Number.isFinite(place.miles) ? Math.min(10, place.miles / 3) : 2)
      + (Number.isFinite(ageDays) ? Math.max(0, 6 - ageDays / 2) : 0)
      + (scoreRow(j).score || 0) / 20;
    const row = { ...j, _reason: m.reason, _basis: m.basis, _occupation: m.occupation, _need: m.need, _have: m.have, _summaryOnly: !!m.summaryOnly, _remote: place.remote, _miles: place.miles, _matchScore: Math.round(score * 10) / 10 };
    // The same job posted twice (or in two nearby towns) is one match: keep the nearer / better one.
    const k = matchKey(j);
    const prev = best.get(k);
    if (!prev || row._matchScore > prev._matchScore) best.set(k, row);
  }
  out.ranked = [...best.values()].sort((a, b) => b._matchScore - a._matchScore);
  return out;
}
