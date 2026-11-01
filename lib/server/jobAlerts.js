// Job alerts (owner request 2026-11-01): "an option in settings to only be notified for specific
// jobs in specific areas." A person keeps up to MAX_ALERTS alerts, each = title words + a place
// (city/state, ZIP, or Remote) + a radius. In 'alerts' mode the job-match email
// (api/cron-job-matches.js) only sends listings that match one of them; in 'resume' mode it keeps
// matching the résumé; 'off' is the existing job-match unsubscribe (email_prefs.job_match_opt_out).
//
// Pure, no I/O: the settings page (describeAlert), the save action in api/user-sync.js
// (cleanAlertsInput) and the cron (matchAlertJob) share these. Geocoding is passed in as `geo`
// ({ geocodePlace, withinMiles, distanceMiles } from lib/geo/usPlaces.js) so tests can stub it.

import { isRemoteListing } from './jobPriority.js';
import { locationScope } from '../jobs/usLocation.js';

export const MAX_ALERTS = 5;
export const ALERT_RADII = [10, 25, 50, 100];
export const DEFAULT_MILES = 25;
export const KEYWORDS_MAX = 60;
export const PLACE_MAX = 80;
/** Alert emails only offer listings Seen added in this many days, so "New" in the subject is true. */
export const ALERT_NEW_DAYS = 14;

const STOP = new Set(['and', 'or', 'the', 'a', 'an', 'of', 'for', 'in', 'at', 'to', 'with', 'job', 'jobs']);
const REMOTE_PLACE = /^(?:remote|anywhere|work from home|wfh|remote only)$/i;

const normWords = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').trim().split(' ').filter(Boolean);
function stem(w) {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/** Trimmed, single-spaced, plain characters only, capped. '' when nothing usable is left. */
export function cleanKeywords(s) {
  const t = String(s ?? '').replace(/[^\p{L}\p{N}\s\-&+#./']/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, KEYWORDS_MAX).trim();
  return keywordWords(t).length ? t : '';
}

/** The words a title must contain (stop words dropped). */
export function keywordWords(keywords) {
  return [...new Set(normWords(keywords).filter((w) => !STOP.has(w)))];
}

/** Every alert word is a whole word of the title, any order; plurals count ("cashiers" ~ "cashier"). */
export function titleMatches(title, keywords) {
  const want = keywordWords(keywords);
  if (!want.length) return false;
  const have = new Set(normWords(title).map(stem));
  return want.every((w) => have.has(stem(w)));
}

export const isRemotePlace = (place) => REMOTE_PLACE.test(String(place ?? '').trim());

/** "Phoenix, AZ" from a geocodePlace result. */
export function placeLabel(g) {
  if (!g) return '';
  const name = String(g.name || '').trim();
  const st = String(g.state || '').trim();
  return name && st && !name.toUpperCase().endsWith(`, ${st.toUpperCase()}`) ? `${name}, ${st}` : name || st;
}

/** Radius from the allowed set; anything else → null (refused on save). Missing → the default. */
export function cleanMiles(m) {
  if (m === undefined || m === null || m === '') return DEFAULT_MILES;
  const n = Number(m);
  return ALERT_RADII.includes(n) ? n : null;
}

/** 'resume' | 'alerts' | 'off', or null for anything else. */
export function cleanMode(mode) {
  return mode === 'resume' || mode === 'alerts' || mode === 'off' ? mode : null;
}

const usable = (p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)) && !(Number(p.lat) === 0 && Number(p.lng) === 0);

/**
 * Validate and clip what the settings page sent. Each place is geocoded once here, so the stored
 * alert carries the name Seen understood and its coordinates.
 * @returns {{ ok: true, alerts: Array<object> } | { ok: false, error: string, index?: number, field?: string }}
 */
export function cleanAlertsInput(raw, { geocodePlace }) {
  if (raw === undefined || raw === null) return { ok: true, alerts: [] };
  if (!Array.isArray(raw)) return { ok: false, error: 'Alerts must be a list.' };
  if (raw.length > MAX_ALERTS) return { ok: false, error: `You can keep up to ${MAX_ALERTS} alerts.` };
  const out = [];
  const seen = new Set();
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i] && typeof raw[i] === 'object' ? raw[i] : {};
    const keywords = cleanKeywords(typeof a.keywords === 'string' ? a.keywords : '');
    if (!keywords) return { ok: false, error: 'Add a job title or keywords, e.g. "cashier".', index: i, field: 'keywords' };
    const placeIn = typeof a.place === 'string' ? a.place.replace(/\s+/g, ' ').trim().slice(0, PLACE_MAX) : '';
    if (!placeIn) return { ok: false, error: 'Add a city and state, a ZIP code, or "Remote".', index: i, field: 'place' };
    let alert;
    if (isRemotePlace(placeIn)) {
      alert = { keywords, place: 'Remote', remote: true, miles: null, lat: null, lng: null };
    } else {
      const miles = cleanMiles(a.miles);
      if (miles == null) return { ok: false, error: `Pick a distance: ${ALERT_RADII.join(', ')} miles.`, index: i, field: 'miles' };
      let g = null;
      try { g = geocodePlace(placeIn); } catch { g = null; }
      if (g && g.stateOnly) return { ok: false, error: `"${placeIn}" is a whole state. Use a city and state or a ZIP so the distance means something.`, index: i, field: 'place' };
      if (!g || !usable(g)) return { ok: false, error: `We couldn't find "${placeIn}". Try "City, ST" or a 5-digit ZIP.`, index: i, field: 'place' };
      alert = { keywords, place: placeLabel(g) || placeIn, remote: false, miles, lat: Number(g.lat), lng: Number(g.lng) };
    }
    const key = `${keywordWords(alert.keywords).map(stem).sort().join(' ')}|${alert.place.toLowerCase()}|${alert.miles}`;
    if (seen.has(key)) continue; // the same alert twice is one alert
    seen.add(key);
    out.push(alert);
  }
  return { ok: true, alerts: out };
}

/** Stored jsonb → alerts the cron can trust (anything malformed is dropped, never guessed). */
export function storedAlerts(value) {
  const list = Array.isArray(value) ? value : [];
  const out = [];
  for (const a of list.slice(0, MAX_ALERTS)) {
    if (!a || typeof a !== 'object') continue;
    const keywords = cleanKeywords(a.keywords);
    if (!keywords) continue;
    if (a.remote === true) { out.push({ keywords, place: 'Remote', remote: true, miles: null, lat: null, lng: null }); continue; }
    const miles = ALERT_RADII.includes(Number(a.miles)) ? Number(a.miles) : null;
    const place = String(a.place || '').trim().slice(0, PLACE_MAX);
    if (!miles || !place) continue;
    out.push({ keywords, place, remote: false, miles, lat: usable(a) ? Number(a.lat) : null, lng: usable(a) ? Number(a.lng) : null });
  }
  return out;
}

/** An email_prefs row → what Settings shows and the cron obeys. No row = résumé matches, no alerts. */
export function prefsFromRow(row) {
  const alerts = storedAlerts(row?.job_alerts);
  if (row?.job_match_opt_out === true) return { mode: 'off', savedMode: row?.job_match_mode === 'alerts' ? 'alerts' : 'resume', alerts };
  const mode = row?.job_match_mode === 'alerts' ? 'alerts' : 'resume';
  return { mode, savedMode: mode, alerts };
}

/** Plain words for what an alert will match. */
export function describeAlert(alert) {
  const words = keywordWords(alert?.keywords);
  const what = words.length > 1
    ? `the words ${words.map((w) => `“${w}”`).join(' and ')}`
    : `“${String(alert?.keywords || '').trim().toLowerCase()}”`;
  if (alert?.remote || isRemotePlace(alert?.place)) return `Remote jobs whose title has ${what}.`;
  const where = String(alert?.place || '').trim();
  const miles = Number(alert?.miles) || DEFAULT_MILES;
  return `Jobs whose title has ${what}, within ${miles} mi of ${where || 'the place you enter'}.`;
}

/** Short label for an email subject: "cashier jobs within 25 mi of Phoenix, AZ" / "remote cashier jobs". */
export function alertHeadline(alert) {
  const kw = String(alert?.keywords || '').trim().toLowerCase();
  if (alert?.remote) return `remote ${kw}`;
  return `${kw} within ${alert?.miles} mi of ${alert?.place}`;
}

/** For a subject: "cashier job within 25 mi of Phoenix, AZ" / "remote cashier job". */
export function alertJobPhrase(alert) {
  const kw = String(alert?.keywords || '').trim().toLowerCase();
  return alert?.remote ? `remote ${kw} job` : `${kw} job within ${alert?.miles} mi of ${alert?.place}`;
}

/**
 * Does this listing match this alert? Title words first, then place:
 *   remote alert → the listing says remote (and is not a foreign-only remote role);
 *   local alert  → withinMiles(listing location, origin, miles) === true; when the text can't be
 *                  placed (null) the listing's own coordinates are used if it has real ones;
 *                  otherwise it is NOT a match (never guessed).
 * @returns {{ match: boolean, miles: number|null }}
 */
export function matchAlertJob(job, alert, geo) {
  const no = { match: false, miles: null };
  if (!job || !alert || !titleMatches(job.title, alert.keywords)) return no;
  const remoteJob = isRemoteListing(job);
  if (alert.remote) return remoteJob && locationScope(job.location) !== 'non_us' ? { match: true, miles: null } : no;
  if (remoteJob) return no; // a local alert asks for jobs in that area
  const origin = usable(alert) ? { lat: Number(alert.lat), lng: Number(alert.lng) } : null;
  if (!origin || !geo) return no;
  let within = null;
  try { within = geo.withinMiles(job.location, origin, alert.miles); } catch { within = null; }
  let miles = null;
  if (within === null && usable(job)) {
    let d;
    try { d = geo.distanceMiles({ lat: Number(job.lat), lng: Number(job.lng) }, origin); } catch { d = NaN; }
    if (Number.isFinite(d)) { within = d <= alert.miles; miles = d; }
  }
  if (within !== true) return no;
  if (miles == null) {
    try {
      const p = geo.geocodePlace(job.location);
      const d = p && usable(p) ? geo.distanceMiles(p, origin) : NaN;
      if (Number.isFinite(d)) miles = d;
    } catch { /* distance is a nicety; the match already stands */ }
  }
  return { match: true, miles: miles == null ? null : Math.round(miles) };
}

/**
 * The listings that match any alert, each tagged with the FIRST alert it matches (the order the
 * person listed them), `_alert`, `_miles`, `_remote`. Duplicates by id are dropped.
 */
export function matchAlerts(jobs, alerts, geo) {
  const out = [];
  const ids = new Set();
  for (const job of Array.isArray(jobs) ? jobs : []) {
    if (!job?.id || ids.has(String(job.id))) continue;
    for (let i = 0; i < alerts.length; i++) {
      const m = matchAlertJob(job, alerts[i], geo);
      if (!m.match) continue;
      ids.add(String(job.id));
      out.push({ ...job, _alert: i, _miles: m.miles, _remote: !!alerts[i].remote });
      break;
    }
  }
  return out;
}

/** The one title word worth a DB `ilike` (the longest); the full match is checked in matchAlertJob. */
export function alertDbTerm(alert) {
  const w = keywordWords(alert?.keywords).filter((x) => /^[a-z0-9]+$/.test(x));
  return w.sort((a, b) => b.length - a.length)[0] || '';
}
