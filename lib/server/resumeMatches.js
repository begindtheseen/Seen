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
import { matchListing as match2Listing } from './match2/index.js';
import { locationDbTerm, parseLocation } from '../../api/_utils/jobRelevance.js';
import { scoreRow } from './jobScore.js';
import {
  buildJobKeys, keysStale, matchListing, placeMatch, occupation, hasJobKeysColumn, storeJobKeys, readOccupations, readTermsFor, directionTerms,
  readRecentApplications, serviceDb, normTitle, applySharedGate, proofSentence, saysEntryLevel, credentialShown, scheduleAgreement, scheduleQuestion, unreadYearsAsks,
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
// THE SEAM (match2, 2026-11-11): a second matcher with matchListing's interface may be injected — per call
// (`matcher`) or module-wide (setMatcher, for tests and scorers). It is called as matcher(job, keys, { now, mode,
// resumeText }). A matcher marked `selfGated` runs the fit engine itself, so finalizeMatches does not apply the
// shared gate again. Nothing injected → today's matchListing, unchanged.
let injectedMatcher = null;
/** @param {Function|null} fn */
export function setMatcher(fn) { injectedMatcher = typeof fn === 'function' ? fn : null; }
/** The injected matcher, or null (today's matchListing). */
export function activeMatcher() { return injectedMatcher; }

export async function findResumeMatches({ supabaseUrl, serviceKey, userId, persist = true, now = new Date(), geo, miles = RAIL_MILES, exclude = null, onlyKeys = false, mode = 'rail', matcher = null }) {
  const mx = typeof matcher === 'function' ? matcher : injectedMatcher;
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
  if (!(keys.occupations || []).length && !(keys.applied || []).length && !(keys.education || []).length && !(keys.intent || []).length) {
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
  const words = [...new Set([...directionTerms(keys), ...occIds.flatMap((id) => readTermsFor(id))])];
  const remoteWords = [...new Set(occIds.filter((id) => occupation(id)?.remote).flatMap((id) => readTermsFor(id)))];
  const areaPats = [];
  try {
    if (point && g && typeof g.areaTextPatterns === 'function') areaPats.push(...g.areaTextPatterns(point, miles));
    if (point && g && typeof g.distanceMiles === 'function') for (const c of countiesNear(point, miles, g.distanceMiles)) areaPats.push(`*${c}*`);
  } catch { /* the radius clause alone */ }
  const scopes = [scope, ...chunk([...new Set(areaPats)], 45).map((c) => `&or=${encodeURIComponent(`(${c.map((pat) => `location.ilike.${pat}`).join(',')})`)}`)];
  for (const group of chunk(words, 32)) {
    const titleOr = `&or=${encodeURIComponent(`(${group.map((w) => ilike('title', w)).join(',')})`)}`;
    for (const sc of scopes) reads.push(read(`select_hint=1${titleOr}${sc}`, 1000));
  }
  for (const group of chunk(remoteWords, 32)) {
    const titleOr = `&or=${encodeURIComponent(`(${group.map((w) => ilike('title', w)).join(',')})`)}`;
    reads.push(read(`select_hint=1${titleOr}&or=${encodeURIComponent('(location.ilike.*remote*,location.ilike.*united states*,location.ilike.usa*,location.eq.US,location.ilike.*anywhere*,location.is.null)')}`, 300));
  }
  // Every row the rule would accept must be a candidate, whatever its title words: the newest listings in the
  // radius with no title filter, and (for remote-able job types) the newest US-remote rows. The rule decides.
  reads.push(read(`select_hint=1${scope}`, 1000));
  if (remoteWords.length) reads.push(read(`select_hint=1&or=${encodeURIComponent('(location.ilike.*remote*,location.ilike.*united states*,location.ilike.usa*,location.eq.US,location.ilike.*anywhere*)')}`, 500));
  // An explicitly US-remote row is in range for every US résumé, whatever the job type (placeMatch decides): read
  // them for everyone, or the place rule accepts rows the read never loaded.
  reads.push(read(`select_hint=1&or=${encodeURIComponent('(location.ilike.*remote*,title.ilike.*remote*)')}`, 500));
  const results = await Promise.all(reads);
  if (results.length && results.every((r) => r === null)) { out.reason = 'unavailable'; return out; }

  const home = { city, point };
  const appliedIds = new Set([...(apps || []).map((a) => a.job_id).filter(Boolean).map(String), ...(exclude?.jobIds || [])]);
  const appliedKeys = new Set([...(apps || []).map((a) => matchKey({ title: a.role || a.job_title, company: a.company_name })), ...(exclude?.keys || [])]);
  const best = new Map();
  const seen = new Set();
  let m2Calls = 0;
  for (const j of results.flat()) {
    if (!j?.id || seen.has(j.id)) continue;
    seen.add(j.id);
    if (DEAD.has(String(j.availability_status || '').toLowerCase())) continue;
    if (appliedIds.has(String(j.id)) || appliedKeys.has(matchKey(j))) continue;
    // stated limits about place: "within 15 miles", "remote only"
    const lim = keys.limits || {};
    let place;
    try { place = placeMatch(j, home, g, lim.maxMiles ? Math.min(miles, lim.maxMiles) : miles); } catch { out.skippedError = (out.skippedError || 0) + 1; continue; }
    if (!place.ok) continue;
    if (lim.remoteOnly && !place.remote) continue;
    // one listing that makes a helper throw never removes the person's whole rail: it is skipped and counted
    let m;
    try { m = mx ? mx(j, keys, { now, mode, resumeText }) : matchListing(j, keys, { now, mode }); } catch (e) { out.skippedError = (out.skippedError || 0) + 1; continue; }
    // RECALL FROM KNOWLEDGE, RAIL ONLY (round 12): a listing this file's tables cannot place is read by match2's field
    // stage (person / listing / rung from the occupation knowledge base). Its yes is a rail CANDIDATE that still goes
    // through this matcher's gates (finalizeMatches) and is never an email headline.
    if (!mx && mode !== 'email' && m && !m.ok && m.why === 'field_unknown' && resumeText && m2Calls < 20) {
      m2Calls++;
      let m2 = null;
      try { m2 = match2Listing(j, keys, { now, mode: 'rail', resumeText }); } catch { m2 = null; }
      if (m2 && m2.ok && m2.reason) m = { ...m2, noHeadline: true, headlineOk: false, via: 'match2', checks: m2.checks || [{ check: 'field', pass: true, basis: m2.basis }] };
    }
    if (!m.ok || !m.reason) continue;
    const ageDays = (now.getTime() - Date.parse(j.created_at || '')) / 86_400_000;
    const score = m.rank
      + (place.remote ? 0 : 8) - (Number.isFinite(place.miles) ? Math.min(10, place.miles / 3) : 2)
      + (Number.isFinite(ageDays) ? Math.max(0, 6 - ageDays / 2) : 0)
      + (scoreRow(j).score || 0) / 20;
    const row = { ...j, _reason: `${m.reason}${place.remote ? " It's a remote role open to US applicants." : ''}${m.summaryOnly && mode !== 'email' ? ' Seen could only read a summary of this listing.' : ''}`, _basis: m.basis, _occupation: m.occupation, _need: m.need, _have: m.have, _checked: m.checked || [], _checks: m.checks || [], _summaryOnly: !!m.summaryOnly, _sameRung: !!m.sameRung,
      // a career move, a transfer or a shared-duties row is never an email headline (round 11)
      _noHeadline: ['intent', 'transfer'].includes(m.basis) || !!m.noHeadline, _headlineOk: !!m.headlineOk, _entryStated: saysEntryLevel(j), _remote: place.remote, _miles: place.miles, _matchScore: Math.round(score * 10) / 10 };
    // The same job posted twice (or in two nearby towns) is one match: keep the nearer / better one.
    const k = matchKey(j);
    const prev = best.get(k);
    if (!prev || row._matchScore > prev._matchScore) best.set(k, row);
  }
  out.ranked = [...best.values()].sort((a, b) => b._matchScore - a._matchScore);
  // The rail shows only what the fit check also passes: its gates on the top rows, and a reason that names
  // what in each listing the résumé shows. (Email mode: the cron does this after reading full postings.)
  if (mode !== 'email') out.ranked = finalizeMatches(out.ranked, resumeText, { limit: 12, now, keys, matcher: mx }).rows;
  out.resumeText = resumeText; // for the cron's own final check; never sent to a browser
  return out;
}

/**
 * The final yes: the fit check's own gates (jobKeys.sharedGates → runOptimizer) on the first `limit` rows that
 * have a readable posting, and a reason whose second sentence names what in THAT listing the résumé shows —
 * never the same line twice in one set. Summary-only rows pass through unchanged (nothing to read; the rail
 * labels them, the email reads them first). Rows past `limit` are not returned.
 * @returns {{ rows: object[], dropped: Array<{ id: string, why: string }> }}
 */
/** Run `fn` on each listing; a listing whose judgement throws is skipped and counted, never the whole person. */
export function judgeEach(rows, fn) {
  let skippedError = 0;
  const out = [];
  for (const j of rows || []) {
    try { const r = fn(j); if (r !== undefined) out.push(r); } catch { skippedError++; }
  }
  return { out, skippedError };
}
export function finalizeMatches(rows, resumeText, { limit = 12, now = new Date(), keys = null, strict = false, maxGateRuns = 40, matcher = undefined } = {}) {
  const out = []; const dropped = []; const used = new Set(); let gateRuns = 0;
  // an injected self-gated matcher already asked the fit engine (rail and email bars): its rows pass as they are
  if ((matcher === undefined ? injectedMatcher : matcher)?.selfGated === true) return { rows: (rows || []).slice(0, limit), dropped };
  const unverifiedRows = [];
  for (let j of rows || []) {
    if (out.length >= limit) break;
    // RULE OF EVIDENCE (round 12): an email item needs every check PASSED on evidence — teasers never qualify
    if (strict && j._summaryOnly) { dropped.push({ id: String(j.id), why: 'not_positive:summary' }); continue; }
    if (j._summaryOnly) {
      // a summary still states its schedule in the title: unknown agreement → named and sorted with the unverified rows
      const ss = scheduleAgreement(j, keys?.limits);
      if (ss.verdict === 'no') { dropped.push({ id: String(j.id), why: 'limit:schedule' }); continue; }
      if (ss.verdict === 'unknown') { const sq = scheduleQuestion(ss); unverifiedRows.push({ ...j, _reason: sq ? `${j._reason} ${sq}` : j._reason, _unverified: ['schedule'], _gates: 'unverified' }); continue; }
      out.push(j); continue;
    }
    if (strict && !j._headlineOk) { dropped.push({ id: String(j.id), why: 'not_positive:basis' }); continue; }
    // THE decision's second half: the shared gate (licence, degree, years in a subject) — one function for the
    // rail's shown rows and the email; its met years asks become the sentence's years clauses.
    if (gateRuns >= maxGateRuns) { dropped.push({ id: String(j.id), why: 'gate_budget' }); continue; }
    gateRuns++;
    let d;
    try { d = applySharedGate({ ok: true, reason: j._reason, checks: j._checks, checked: j._checked, summaryOnly: false }, j, resumeText, { now }); } catch { dropped.push({ id: String(j.id), why: 'skipped_error' }); continue; }
    if (!d.ok) { dropped.push({ id: String(j.id), why: d.why.startsWith('years') ? 'gate:years_subject' : d.why, gate: d.gate || null }); continue; }
    const g = d.gate;
    // a stated move appears in an email only when the posting itself says it is entry level
    if (strict && j._basis === 'intent' && !j._entryStated) { dropped.push({ id: String(j.id), why: 'move_not_entry' }); continue; }
    // THE SAFETY NET (email): Seen never emails a job its own fit check calls weak, partial or a different field.
    if (strict && (g.fieldLevel === 'different' || (g.bandKey && !['good', 'strong'].includes(g.bandKey)))) { dropped.push({ id: String(j.id), why: `fit:${g.bandKey || g.fieldLevel}` }); continue; }
    // ...and never one where the fit check finds most of the posting's required items missing from the résumé
    if (strict && g.score != null && g.reqTotal >= 2 && g.reqMissing / g.reqTotal > 0.5) { dropped.push({ id: String(j.id), why: 'fit:requirements_missing' }); continue; }
    // HARD REQUIREMENTS must be SHOWN: every licence / certification / degree / clearance / years row the posting
    // requires — the fit engine's status 'met', and a credential named on a résumé line with no doubt about it.
    const hard = (g.constraints || []).filter((c) => (c.gate || c.importance === 'required') && /^(certification|license|licence|degree|clearance|years|credential)$/i.test(String(c.kind || '')));
    // A credential is shown when a résumé line names it with no doubt (credentialShown — strict: every significant word
    // of the label on one line, no expired / pending / eligible; a basic driver's licence by driving work), whatever the
    // engine's non-fatal status says; a degree or years row needs the engine's 'met'.
    const isCred = (c) => /^(certification|license|licence|credential|clearance)$/i.test(c.kind);
    const notShown = hard.filter((c) => (isCred(c) ? !credentialShown(c.label, resumeText) : c.status !== 'met'));
    // a years ask the posting states that neither reader read is not shown either
    for (const t of unreadYearsAsks(j, g.years, j._checked)) notShown.push({ kind: 'years', label: `"${t}"`, status: 'unread' });
    // CONDITIONS: a schedule the listing states needs a positive match with any schedule the résumé says it wants
    const sched = scheduleAgreement(j, keys?.limits);
    if (sched.verdict === 'no') { dropped.push({ id: String(j.id), why: 'limit:schedule' }); continue; }
    if (strict) {
      if (notShown.length) { dropped.push({ id: String(j.id), why: 'not_positive:requirement', gate: notShown[0].label || null }); continue; }
      if (!sched.affirmed) { dropped.push({ id: String(j.id), why: 'not_positive:schedule' }); continue; }
    }
    j = { ...j, _reason: d.reason, _checks: d.checks };
    // THE RAIL SAYS WHAT IT COULD NOT CHECK: a requirement the gate could not show is named as a question, and the row
    // sorts below every clean row
    if (!strict && (notShown.length || sched.verdict === 'unknown')) {
      const qs = [];
      if (notShown.length) {
        const c = notShown[0];
        const label = String(c.label || 'a requirement').replace(/^(a|an)\s+/i, '');
        const an = /^[aeiou]/i.test(label) ? 'an' : 'a';
        qs.push(/^(certification|license|licence|credential|clearance)$/i.test(c.kind) ? `They require ${an} ${label} — check yours is current.` : `They ask for ${label} — check your résumé shows it.`);
      }
      if (sched.verdict === 'unknown') { const sq = scheduleQuestion(sched); if (sq) qs.push(sq); }
      const unv = [...notShown.map((x) => x.label), ...(sched.verdict === 'unknown' ? ['schedule'] : [])];
      unverifiedRows.push({ ...j, _reason: `${j._reason} ${qs.join(' ')}`.trim(), _unverified: unv, _checks: [...(j._checks || []), ...notShown.map((x) => ({ check: x.kind, pass: null, label: x.label })), ...(sched.verdict === 'unknown' ? [{ check: 'schedule', pass: null, label: (sched.conditions || []).map((c) => c.word).join(', ') }] : [])], _gates: 'unverified' });
      continue;
    }
    const p = proofSentence(g.proofs, used, keys);
    if (p) used.add(p.line);
    out.push({ ...j, _reason: p ? `${j._reason} ${p.sentence}` : j._reason, _gates: 'met' });
  }
  // clean rows first; rows with a requirement Seen could not show follow, never above a clean one
  if (!strict) for (const u of unverifiedRows) { if (out.length >= limit) break; out.push(u); }
  return { rows: out, dropped };
}
