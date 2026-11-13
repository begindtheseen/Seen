// Shared plumbing for the employer-board providers (lib/jobs/atsProviders.js and lib/jobs/providers/*).
//
// Every call is bounded twice: each request has its own timeout (raced against the fetch, so a fetch
// that ignores its AbortSignal still cannot hang a sync), and a board has one overall budget that every
// paging and detail loop checks before it starts more work. A board that runs out of budget returns
// what it finished — never an unbounded loop. Pure helpers; the only I/O is through `fetchImpl`.

import { inUsMarket, locationScope, countryIsUs, withCountry } from '../usLocation.js';

export const UA = 'SeenJobs/1.0 (+https://seenjobs.io)';

/**
 * One HTTP request with a hard timeout. Resolves to the parsed body (`as: 'json' | 'text'`) or null on
 * any failure (non-2xx, network error, timeout, unparsable body). Never throws, never outlives timeoutMs.
 */
export async function request(url, { method = 'GET', body, headers = {}, fetchImpl = fetch, timeoutMs = 10000, as = 'json' } = {}) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => { controller.abort(); resolve(null); }, Math.max(1, timeoutMs)); });
  const run = (async () => {
    try {
      const init = {
        method,
        headers: { Accept: as === 'json' ? 'application/json' : 'text/html,application/xhtml+xml', 'User-Agent': UA, ...headers },
        signal: controller.signal,
      };
      if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
      const res = await fetchImpl(url, init);
      if (!res || !res.ok) return null;
      return as === 'json' ? await res.json() : await res.text();
    } catch {
      return null;
    }
  })();
  try {
    return await Promise.race([run, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** A board-wide time budget: `left()` ms remaining (never below 0), `expired()` once it is spent. */
export function makeBudget(budgetMs, now = Date.now) {
  const end = now() + Math.max(0, Number(budgetMs) || 0);
  return {
    left: () => Math.max(0, end - now()),
    expired: () => now() >= end,
  };
}

/** A per-request timeout that never runs past the board's budget (at least 1 ms so a call can fail fast). */
export const callTimeout = (budget, timeoutMs) => Math.max(1, Math.min(timeoutMs, budget.left()));

/** Bounded-concurrency map that stops starting new items once `budget` is spent (unstarted → null). */
export async function mapWithin(items, limit, budget, fn) {
  const out = new Array(items.length).fill(null);
  let idx = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (idx < items.length && !budget.expired()) {
      const i = idx++;
      try { out[i] = await fn(items[i], i); } catch { out[i] = null; }
    }
  });
  await Promise.all(runners);
  return out;
}

/**
 * The detail list started at a rotating point (`seed`, default the current hour), so a board too big
 * to read inside one budget is read from a different place on every sync — over a few syncs every
 * posting is refreshed, instead of the same tail never being reached. `seed` 0 keeps the order.
 */
export function rotated(list, seed = Math.floor(Date.now() / 3_600_000)) {
  if (!list.length) return list;
  const k = ((Math.trunc(Number(seed) || 0) * 97) % list.length + list.length) % list.length;
  return k ? [...list.slice(k), ...list.slice(0, k)] : list;
}

/** Provenance stamp on a buildJob() row (null passes through). */
export function stamp(row, { provider, tenant, externalId, applyUrl }) {
  if (!row) return null;
  return {
    ...row,
    source_type: 'ATS_DIRECT',
    ats_provider: provider,
    ats_tenant: tenant,
    external_id: externalId ? String(externalId) : null,
    canonical_url: applyUrl || row.apply_url || null,
  };
}

/**
 * A short user-visible field (title, place, name) as plain text: tags removed, control characters and
 * runs of whitespace collapsed, capped. Descriptions go through cleanDescription instead.
 */
export function plainText(s, max = 200) {
  return String(s ?? '')
    .replace(/<[^>]*>/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f​-‍﻿]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** The URL when it is https on exactly `host` (parsed, anchored — never a substring test), else null. */
export function sameHostUrl(url, host) {
  try {
    const u = new URL(String(url || ''));
    return u.protocol === 'https:' && u.hostname.toLowerCase() === String(host).toLowerCase() ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * The location text a row stores, written so the market filter judges it by the ATS's OWN country
 * field: a US posting whose text does not read as US ("Houston Office") gets ", United States"; a
 * posting the ATS places abroad gets its country's name ("Taleigao - Goa" + IN → "…, India").
 */
export function placeWithCountry(text, countryCode) {
  const t = plainText(text, 160);
  const us = countryIsUs(countryCode);
  if (us === true) {
    if (!t) return 'United States';
    return locationScope(t) === 'us' ? t : `${t}, United States`;
  }
  if (us === false) return withCountry(t, countryCode);
  return t;
}

/** Finite coordinates or nulls (buildJob drops (0,0) itself). */
export function coords(lat, lng) {
  const a = Number(lat); const b = Number(lng);
  return Number.isFinite(a) && Number.isFinite(b) && (a !== 0 || b !== 0) ? { lat: a, lng: b } : { lat: null, lng: null };
}

/**
 * One posting at several places → one row per place. The first place keeps the posting's own id (so it
 * is the same row on every sync); each further place is `<id>#<n>` in the ATS's own order. Further
 * places outside Seen's market are not emitted (the first always is — the sync's health counts it).
 * @param {Array<{ text: string, lat?: number|null, lng?: number|null }>} places
 * @param {(place: { text: string, lat: number|null, lng: number|null }) => object|null} build  buildJob for one place
 */
export function rowsForPlaces(places, build, { provider, tenant, externalId, applyUrl, max = 10 }) {
  // A place with no text would become buildJob's 'Remote' default — a claim no board made — so it is
  // never emitted; a provider that knows a posting is remote passes 'Remote' itself.
  // Two addresses in one town are one place to a job seeker (and one title/company/location row).
  const texts = new Set();
  const list = places.filter((p) => {
    const k = String(p?.text || '').trim().toLowerCase();
    if (!k || texts.has(k)) return false;
    texts.add(k);
    return true;
  }).slice(0, max);
  const out = [];
  list.forEach((p, i) => {
    if (i > 0 && !inUsMarket(p.text)) return;
    const row = build({ text: p.text, ...coords(p.lat, p.lng) });
    const id = i === 0 ? externalId : `${externalId}#${i + 1}`;
    const stamped = stamp(row, { provider, tenant, externalId: id, applyUrl });
    if (stamped) out.push(stamped);
  });
  return out;
}

/**
 * The JSON object literal that starts at `text[start]` ("{"), read by brace matching that respects
 * strings — for boards that embed their data as a script argument. null when unbalanced/unparsable.
 */
export function jsonObjectAt(text, start) {
  if (text[start] !== '{') return null;
  let depth = 0; let inStr = false; let esc = false;
  const max = Math.min(text.length, start + 2_000_000);
  for (let i = start; i < max; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

// Short words kept upper case when an all-caps title is re-cased.
const KEEP_UPPER = new Set(['I', 'II', 'III', 'IV', 'V', 'VI', 'CDL', 'HSE', 'EHS', 'QHSE', 'IT', 'HR', 'QA', 'QC', 'DOT', 'CNC', 'MWD', 'LWD', 'LLC', 'US', 'USA', 'PM', 'SCADA', 'ERP', 'HVAC', 'OSHA', 'GIS', 'CPA', 'EOR', 'SAP', 'AP', 'AR', 'FP&A', 'WTX', 'STX', 'ETX', 'OKC', 'NEX', 'MSD', 'PCS', 'LPI', 'CNG', 'LNG', 'NGL', 'RN', 'LVN', 'TX', 'NM', 'ND', 'OK', 'CO', 'LA', 'PA', 'WY', 'UT']);
/**
 * A title a board stores in capitals ("EQUIPMENT OPERATOR I", "MAINTENANCE TECHNICIAN - FIELD") in title
 * case ("Equipment Operator I", "Maintenance Technician - Field"). A title with any lower-case letter is
 * returned unchanged — only an all-caps title is re-cased, and known abbreviations stay upper case.
 */
export function tidyCaps(title) {
  const t = String(title || '');
  if (!/[A-Z]{2}/.test(t) || /[a-z]/.test(t)) return t;
  return t.replace(/[A-Z0-9&']+/g, (w) => (KEEP_UPPER.has(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()));
}
