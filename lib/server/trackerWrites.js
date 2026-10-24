// Pure pieces of the tracker's write path (api/user-sync.js add_application / update_application),
// kept out of the handler so they are unit-testable and shared by both actions.
//
//  - sanitizeEvents: the client's events[] as it is stored — small objects, required fields,
//    the first event (application_submitted) always kept, newest kept when over the cap.
//  - clientApplicationId: the tracker's own "app_<ms>" id, the key add_application is idempotent on.
//  - casWindow: the PostgREST filter for compare-and-set on updated_at. Postgres keeps microseconds,
//    the client only has milliseconds, so the match is the one-millisecond window [t, t+1ms).
//  - timelineAnomalies: an offer/rejection recorded under 2 days after applying is flagged
//    (CLAUDE.md anti-gaming: every event carries confidence / trust_weight / anomaly_flags).

export const EVENTS_CAP = 100;
export const COMPANY_MAX = 120;
export const ROLE_MAX = 120;
export const CITY_MAX = 80;
export const PLATFORM_MAX = 60;

/** A client-generated tracker id ("app_<ms>") or null. Server rows are uuids and never match. */
export function clientApplicationId(v) {
  const s = String(v == null ? '' : v);
  return /^app_\d{10,16}$/.test(s) ? s : null;
}

const text = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
export const cleanText = text;

function cleanData(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return undefined;
  let json;
  try { json = JSON.stringify(d); } catch { return undefined; }
  if (json.length > 2000) return undefined;
  return JSON.parse(json);
}

/** Events as stored: shape-checked, capped at EVENTS_CAP (first + newest kept). */
export function sanitizeEvents(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const e of list) {
    if (!e || typeof e !== 'object') continue;
    const type = String(e.type || '').slice(0, 40);
    if (!type) continue;
    const ev = {
      id: String(e.id || '').slice(0, 40),
      type,
      date: Number(e.date) || Date.now(),
      source: String(e.source || 'user').slice(0, 20),
      confidence: typeof e.confidence === 'number' ? e.confidence : String(e.confidence || 'low').slice(0, 10),
    };
    if (typeof e.trust_weight === 'number') ev.trust_weight = e.trust_weight;
    if (Array.isArray(e.anomaly_flags) && e.anomaly_flags.length) ev.anomaly_flags = e.anomaly_flags.slice(0, 8).map((f) => String(f).slice(0, 40));
    const data = cleanData(e.data);
    if (data) ev.data = data;
    out.push(ev);
  }
  if (out.length <= EVENTS_CAP) return out;
  return [out[0], ...out.slice(out.length - (EVENTS_CAP - 1))];
}

/**
 * PostgREST filter suffix matching the row whose updated_at is the millisecond the client last saw.
 * `expectedMs` must be a finite number; returns '' otherwise (no compare-and-set).
 */
export function casWindow(expectedMs) {
  const t = Number(expectedMs);
  if (!Number.isFinite(t) || t <= 0) return '';
  return `&updated_at=gte.${encodeURIComponent(new Date(t).toISOString())}&updated_at=lt.${encodeURIComponent(new Date(t + 1).toISOString())}`;
}

const TWO_DAYS = 2 * 86400000;
const DECISIVE = new Set(['offer_received', 'rejected']);

/** ['impossible_timeline'] when an un-superseded offer/rejection sits under 2 days after applied_at. */
export function timelineAnomalies(appliedAt, events) {
  const applied = new Date(appliedAt || 0).getTime();
  if (!Number.isFinite(applied) || !applied || !Array.isArray(events)) return [];
  const fast = events.some((e) => e && DECISIVE.has(e.type) && !(e.anomaly_flags || []).includes('superseded') && Number(e.date) - applied < TWO_DAYS);
  return fast ? ['impossible_timeline'] : [];
}

/** The natural key a retried add matches before the client_id column exists: same user, company, role, applied_at, created in the last 15 minutes. */
export function naturalKeyQuery(uid, row, now = Date.now()) {
  const since = new Date(now - 15 * 60000).toISOString();
  return `applications?user_id=eq.${uid}&company_name=eq.${encodeURIComponent(row.company_name)}&role=eq.${encodeURIComponent(row.role)}&applied_at=eq.${encodeURIComponent(row.applied_at)}&created_at=gte.${encodeURIComponent(since)}&select=id,updated_at&limit=1`;
}
