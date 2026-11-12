// The matched-jobs rail, answered instantly (2026-11-12, owner: "Matched to your resume … take forever … this all
// needs to be lightning fast"). The rail's answer is computed once and kept per person in public.matched_jobs_cache
// (migration 20261112100000, server-only). A request answers from the kept copy in one small read; a copy older than
// REFRESH_MS is answered AND rebuilt in the background; a copy whose signature no longer matches (the résumé, the city
// or the recent applications changed, or the matcher's version moved) is rebuilt before answering.
// Before the migration the table is missing: every request computes, exactly as before.

import { JOB_KEYS_VERSION } from './jobKeys.js';
import { ENGINE_VERSION } from '../optimizer/types.js';

export const RAIL_CACHE_VERSION = 'rail-1';
export const REFRESH_MS = 30 * 60 * 1000; // listings come and go: a copy this old is served, then rebuilt
export const MAX_AGE_MS = 24 * 60 * 60 * 1000; // never served past this, whatever the signature

let _hasTable; // true | false | undefined (unknown)
let _probedAt = 0;
/** Is the cache table there? Probed once per instance (a missing table is re-checked every 10 minutes). */
export async function hasRailCache(db) {
  if (_hasTable === true) return true;
  if (_hasTable === false && Date.now() - _probedAt < 600_000) return false;
  try {
    const r = await db('matched_jobs_cache?select=user_id&limit=0');
    _probedAt = Date.now();
    if (r && r.ok) { _hasTable = true; return true; }
    const body = r ? await r.json().catch(() => null) : null;
    const code = String(body?.code || '');
    if (r && (r.status === 404 || code === '42P01' || code === 'PGRST205')) _hasTable = false;
    return false;
  } catch { return false; }
}
export function _resetRailCacheProbe() { _hasTable = undefined; _probedAt = 0; }

/**
 * What the kept answer depends on: the résumé (its save time), the home city, the recent applications (an applied-to
 * job leaves the rail; an application can change the keys) and the versions of the matcher and the fit check.
 */
export function railSignature({ resumeUpdatedAt, city, applications }) {
  const apps = Array.isArray(applications) ? applications : [];
  const latest = apps.reduce((m, a) => { const t = String(a?.created_at || a?.applied_at || ''); return t > m ? t : m; }, '');
  return [RAIL_CACHE_VERSION, JOB_KEYS_VERSION, ENGINE_VERSION, String(resumeUpdatedAt || ''), String(city || '').trim().toLowerCase(), `${apps.length}:${latest}`].join('|');
}

/** The kept answer for this person, or null. { payload, sig, builtAt }. */
export async function readRailCache(db, uid) {
  try {
    const r = await db(`matched_jobs_cache?user_id=eq.${encodeURIComponent(uid)}&select=sig,built_at,payload&limit=1`);
    if (!r || !r.ok) return null;
    const rows = await r.json().catch(() => null);
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row || !row.payload || typeof row.payload !== 'object') return null;
    return { payload: row.payload, sig: String(row.sig || ''), builtAt: Date.parse(row.built_at || '') || 0 };
  } catch { return null; }
}

/** Keep this answer for the person (best effort: a failed write only means the next request computes). */
export async function writeRailCache(db, uid, payload, sig, now = Date.now()) {
  try {
    const r = await db('matched_jobs_cache?on_conflict=user_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ user_id: uid, sig, built_at: new Date(now).toISOString(), payload }),
    });
    if (!r || !r.ok) console.error('[rail-cache] write failed: HTTP %s', r ? r.status : 'none');
    return !!(r && r.ok);
  } catch (e) {
    console.error('[rail-cache] write failed: %s', String(e?.message || e).replace(/\n|\r/g, ' ').slice(0, 120));
    return false;
  }
}

/**
 * What to do with a kept copy: 'fresh' (answer it), 'stale' (answer it, rebuild in the background), 'rebuild'
 * (do not answer it). A copy that is not this person's current signature is never answered.
 */
export function railCacheState(cached, sig, now = Date.now()) {
  if (!cached || cached.sig !== sig || !cached.builtAt) return 'rebuild';
  const age = now - cached.builtAt;
  if (age < 0 || age > MAX_AGE_MS) return 'rebuild';
  return age > REFRESH_MS ? 'stale' : 'fresh';
}
