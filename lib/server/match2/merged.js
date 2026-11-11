// match2 — the MERGE EXPERIMENT (not the clean-room matcher): match2 decides the field, the rung, the fit-engine bar
// and the stated limits; the incumbent (jobKeys.matchListing, called whole — none of its tables are imported) may
// only REFUSE, and only for a requirement it read: years in a subject, a licence or credential, a stated limit,
// recency, an industry or specialisation, management years. Its field / level / direction refusals are ignored, so
// match2's recall stands; its requirement readings stand in for the fit engine's known misses (licences, subject
// years, recency — see director/reports/m2-matcher.md).
import { matchListing as match2 } from './index.js';
import { matchListing as incumbent } from '../jobKeys.js';

const REQUIREMENT_WHY = /^(years|licence|credential|limit|recency|industry|specialisation|management|level_years)/;

/**
 * @param {any} job @param {any} keys
 * @param {{ now?: Date, alert?: boolean, mode?: 'rail'|'email', resumeText?: string }} [opts]
 */
export function matchListing(job, keys, opts = {}) {
  const m = match2(job, keys, opts);
  if (!m.ok || !keys) return m;
  let inc = null;
  try { inc = incumbent(job, keys, { now: opts.now, alert: opts.alert, mode: opts.mode }); } catch { inc = null; }
  if (inc && !inc.ok && REQUIREMENT_WHY.test(String(inc.why || ''))) return { ok: false, why: `incumbent:${inc.why}` };
  return m;
}
matchListing.selfGated = true;
