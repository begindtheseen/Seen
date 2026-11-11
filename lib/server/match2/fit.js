// match2 — the ONE fit engine (runOptimizer), asked once per résumé × listing text and obeyed.
//
// The listing's title goes in as the first line of the description so conditions stated only in the title are read.
// Nothing here reads years, licences or degrees itself: the engine's failed hard gates, its band and its own schedule
// conflict are taken as they come.
import { createHash } from 'node:crypto';
import { runOptimizer } from '../../optimizer/index.js';

const CACHE = new Map();
const MAX = 4000;

/** @typedef {{ bandKey: string|null, score: number|null, gates: Array<{ kind: string, message: string }>,
 *   fieldLevel: string|null, scheduleConflict: string|null, scheduleSentences: string[], held: string[], ms: number, cached: boolean }} Fit */

const BAND_KEY = { 'Strong fit': 'strong', 'Good fit': 'good', 'Partial fit': 'partial', 'Weak fit': 'weak', 'Different field': 'different' };

/**
 * @param {string} resumeText
 * @param {{ id?: any, title?: string, company?: string, description?: string }} job
 * @param {{ now?: Date, resumeKey?: string }} [opts]
 * @returns {Fit}
 */
export function fitOf(resumeText, job, { now = new Date(), resumeKey = '' } = {}) {
  const desc = String(job.description || '');
  const key = `${resumeKey}␟${String(job.id ?? '')}␟${createHash('sha1').update(`${job.title}\n${job.company}\n${desc}`).digest('hex').slice(0, 16)}`;
  const hit = CACHE.get(key);
  if (hit) return { ...hit, cached: true };
  const t0 = Date.now();
  const o = runOptimizer({ resumeText, jobTitle: String(job.title || ''), company: String(job.company || ''), jobDescription: `${job.title || ''}\n${desc}`, now });
  const constraints = Array.isArray(o.constraints) ? o.constraints : [];
  /** @type {Fit} */
  const fit = {
    bandKey: o.fit_band ? (/** @type {any} */ (BAND_KEY)[o.fit_band] || null) : null,
    score: o.fit_score ?? null,
    gates: (o.hard_gates || []).map((/** @type {any} */ g) => ({ kind: String(g.kind || ''), message: String(g.message || '') })),
    fieldLevel: o.field_match && o.field_match.known ? String(o.field_match.level || '') || null : null,
    scheduleConflict: (constraints.find((/** @type {any} */ c) => c.conflict) || null)?.message || null,
    scheduleSentences: constraints.filter((/** @type {any} */ c) => c.kind === 'schedule').map((/** @type {any} */ c) => String(c.posting_quote || c.evidence || c.label || '')),
    // a credential the posting asks for and the résumé lists, in the engine's own words ("Your résumé lists …")
    held: constraints.filter((/** @type {any} */ c) => c.kind === 'certification' && c.status === 'met' && /^Your résumé lists /.test(String(c.message || ''))).map((/** @type {any} */ c) => String(c.message)),
    ms: Date.now() - t0,
    cached: false,
  };
  if (CACHE.size > MAX) CACHE.clear();
  CACHE.set(key, fit);
  return fit;
}

/** @param {Fit} f good enough for the rail: no failed gate, not a different field, not weak */
export const railFit = (f) => !f.gates.length && f.bandKey !== 'different' && f.bandKey !== 'weak' && f.fieldLevel !== 'different';
/** @param {Fit} f good enough for an email: the rail's bar and a band of Good or Strong */
export const emailFit = (f) => railFit(f) && (f.bandKey === 'good' || f.bandKey === 'strong');
