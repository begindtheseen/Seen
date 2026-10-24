// First-touch signup attribution — the pure rules, shared by the browser (lib/attributionClient.ts)
// and the server (lib/server/signupAttribution.js), so a touch is cleaned the same way on both sides.
//
// A "touch" is how a device first arrived on Seen: the page it landed on (path only), the site that sent
// it (hostname only), the utm_* tags of the link, and the invite code (?ref=, read with lib/referral.js —
// the same parser ReferralHost uses). Nothing else: never a full URL, never a query string, never an IP.
//
// Device state, one localStorage key (FIRST_TOUCH_KEY), 90 days:
//   { v: 1, first: <touch>, last: <touch> | null, at: <ms> }   waiting to be recorded on an account
//   { v: 1, done: <ms> }                                       answered by the server; nothing is kept
// The touch itself is removed after the server's final answer (recorded, already recorded, account too
// old, touch after the sign-up); the small `done` marker stays so the next page load does not capture a
// new "first touch" and send it again. It is device-level, pre-account data, so it is NOT in the
// sign-out sweep (lib/sessionLocalKeys.js names it as device-scoped).
//
// `last` is updated once per browser session (SESSION_TOUCH_KEY in sessionStorage), or whenever a link
// with utm/ref tags is opened, but only when that visit came from another site or carries tags — an
// internal page view never overwrites it.

import { refFromSearch, isReferralCode } from './referral.js';

export const FIRST_TOUCH_KEY = 'seen_first_touch_v1';
export const SESSION_TOUCH_KEY = 'seen_touch_session_v1';
export const TOUCH_TTL_MS = 90 * 86400e3;
export const FIELD_MAX = 200;
export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
export const TOUCH_FIELDS = ['landing_path', 'referrer_host', ...UTM_KEYS, 'ref_code', 'first_seen_at'];

// Hosts that are Seen itself or a step inside one of its own flows (payment return, the e-mail
// confirmation hop, sign-in providers): never "the site that sent this visitor".
const OWN_OR_FLOW_HOST = /(^|\.)(seenjobs\.io|vercel\.app|stripe\.com|supabase\.co|supabase\.in)$|^(localhost|127\.0\.0\.1)$|^accounts\.google\.com$|^appleid\.apple\.com$/;

const HOST_RE = /^(?=.{1,200}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** A hostname, lower-cased, or null. Requires a dot (no bare words, no IPv6, no ports). */
export function cleanHost(v) {
  if (typeof v !== 'string') return null;
  const h = v.trim().toLowerCase().replace(/\.$/, '');
  return HOST_RE.test(h) ? h : null;
}

/** A printable value (letters, digits, punctuation, symbols, single spaces), ≤200 chars, or null. */
export function cleanValue(v) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[^\p{L}\p{N}\p{P}\p{S} ]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, FIELD_MAX).trim();
  return s || null;
}

/** A site path: starts with one '/', no query or hash, printable ASCII (browsers percent-encode the rest), ≤200. */
export function cleanPath(v) {
  if (typeof v !== 'string') return null;
  const p = v.split(/[?#]/)[0];
  if (!p.startsWith('/') || p.startsWith('//') || p.includes('\\')) return null;
  if (!/^[\x21-\x7e]+$/.test(p)) return null;
  return p.slice(0, FIELD_MAX);
}

/** An ISO timestamp that parses and is not in the future (5 min clock slack), or null. */
export function cleanTime(v, nowMs = Date.now()) {
  if (typeof v !== 'string' || v.length > 40) return null;
  const t = Date.parse(v);
  if (!Number.isFinite(t) || t > nowMs + 5 * 60e3 || t < Date.UTC(2020, 0, 1)) return null;
  return new Date(t).toISOString();
}

/**
 * Clean one touch from any source (the page, local storage, a request body). Every field is validated
 * and clamped; unknown fields are dropped. Returns null when there is no valid landing path.
 */
export function cleanTouch(raw, nowMs = Date.now()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const landing_path = cleanPath(raw.landing_path);
  if (!landing_path) return null;
  const out = { landing_path, referrer_host: cleanHost(raw.referrer_host) };
  for (const k of UTM_KEYS) out[k] = cleanValue(raw[k]);
  const code = typeof raw.ref_code === 'string' ? raw.ref_code.trim().toLowerCase() : '';
  out.ref_code = isReferralCode(code) ? code : null;
  out.first_seen_at = cleanTime(raw.first_seen_at, nowMs);
  return out;
}

/** The referring site's hostname when it is another site (not Seen, not a payment/auth hop), else null. */
export function externalReferrerHost(referrer, ownHost) {
  if (!referrer || typeof referrer !== 'string') return null;
  let h;
  try { h = new URL(referrer).hostname; } catch { return null; }
  const host = cleanHost(h);
  if (!host) return null;
  const own = cleanHost(String(ownHost || ''));
  if (own && (host === own || host === `www.${own}` || own === `www.${host}`)) return null;
  return OWN_OR_FLOW_HOST.test(host) ? null : host;
}

/** True when the touch says where the visitor came from (another site, utm tags or an invite code). */
export function isAcquisitionTouch(t) {
  return !!t && (!!t.referrer_host || !!t.ref_code || UTM_KEYS.some((k) => !!t[k]));
}

/** True when the URL itself carries attribution tags (a link was just opened). */
export function hasTagsInSearch(search) {
  try {
    const q = new URLSearchParams(String(search || ''));
    return UTM_KEYS.some((k) => !!q.get(k)) || !!refFromSearch(search);
  } catch { return false; }
}

/** The touch for this page view: path, external referrer host, utm tags, invite code, time. */
export function touchFromPage({ pathname, search, referrer, host }, nowMs = Date.now()) {
  let q;
  try { q = new URLSearchParams(String(search || '')); } catch { q = new URLSearchParams(); }
  const raw = { landing_path: pathname, referrer_host: externalReferrerHost(referrer, host), ref_code: refFromSearch(search), first_seen_at: new Date(nowMs).toISOString() };
  for (const k of UTM_KEYS) raw[k] = q.get(k);
  return cleanTouch(raw, nowMs) || cleanTouch({ ...raw, landing_path: '/' }, nowMs);
}

/** The stored state, or null when there is none, it is unreadable, or it is older than 90 days. */
export function readTouchState(storage, nowMs = Date.now()) {
  let raw = null;
  try { raw = storage.getItem(FIRST_TOUCH_KEY); } catch { return null; }
  if (!raw) return null;
  let s;
  try { s = JSON.parse(raw); } catch { s = null; }
  const stamp = s && (Number.isFinite(s.done) ? s.done : s.at);
  const valid = s && s.v === 1 && Number.isFinite(stamp) && nowMs - stamp <= TOUCH_TTL_MS && (Number.isFinite(s.done) || cleanTouch(s.first, nowMs));
  if (!valid) { try { storage.removeItem(FIRST_TOUCH_KEY); } catch { /* blocked */ } return null; }
  if (Number.isFinite(s.done)) return { v: 1, done: s.done };
  return { v: 1, first: cleanTouch(s.first, nowMs), last: cleanTouch(s.last, nowMs), at: s.at };
}

function write(storage, state) {
  try { storage.setItem(FIRST_TOUCH_KEY, JSON.stringify(state)); } catch { /* storage blocked: nothing kept */ }
}

/**
 * Run once per page load, BEFORE anything strips ?ref= from the address bar.
 * `storage` = localStorage, `session` = sessionStorage (both may throw; never fatal).
 * Returns the state after this page view.
 */
export function captureTouch(page, storage, session, nowMs = Date.now()) {
  const touch = touchFromPage(page, nowMs);
  let newSession = true;
  try { newSession = !session.getItem(SESSION_TOUCH_KEY); session.setItem(SESSION_TOUCH_KEY, '1'); } catch { /* treat as new */ }
  const state = readTouchState(storage, nowMs);
  if (!state) {
    const fresh = { v: 1, first: touch, last: null, at: nowMs };
    write(storage, fresh);
    return fresh;
  }
  if (state.done) return state;
  if (isAcquisitionTouch(touch) && (newSession || hasTagsInSearch(page.search))) {
    const next = { ...state, last: touch };
    write(storage, next);
    return next;
  }
  return state;
}

/** The server answered for good: drop the touch, keep only the `done` marker. */
export function markTouchDone(storage, nowMs = Date.now()) {
  write(storage, { v: 1, done: nowMs });
}

/** The request body for record_attribution, or null when there is nothing to send. */
export function pendingTouchPayload(storage, nowMs = Date.now()) {
  const s = readTouchState(storage, nowMs);
  if (!s || s.done || !s.first) return null;
  return { first_touch: s.first, last_touch: s.last || null };
}
