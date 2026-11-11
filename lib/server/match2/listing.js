// match2 — WHAT THE LISTING IS: its occupation (occupationOf on the title, with the employer), its rung, its duty
// lines, whether only a summary was stored, and whether it is offered as remote.
import { occupationOf, tasksOf } from '../../occupations/index.js';
import { activitiesOf } from '../../occupations/activities.js';
import { isDescriptionPreview } from '../../jobs/descriptionText.js';
import { isBoilerplate } from '../../optimizer/postingSections.js';
import { rungOf } from './rung.js';

const MIN_FULL = 700;

/** A summary, not a posting: a stored preview, text cut off with an ellipsis, or a short text that states no ask. */
export function summaryOnly(job) {
  const d = String(job?.description || '').replace(/\s+/g, ' ').trim();
  if (isDescriptionPreview(job) || /(…|\.\.\.)$/.test(d)) return true;
  if (d.length < MIN_FULL) return !(d.length >= 60 && /\b(\d+\+?\s*(years?|yrs?|months?)|required|must|license|licence|certificat\w*|no experience|experience)\b/i.test(d));
  return false;
}

/** The posting's own duty / requirement lines (bullets and short sentences), boilerplate dropped. */
export function dutyLines(description, limit = 14) {
  const out = [];
  for (const raw of String(description || '').split(/\r?\n|(?<=[.!?])\s+(?=[A-Z])/)) {
    const l = raw.replace(/^[\s•·*\-–—\d.)]+/, '').trim();
    if (l.length < 18 || l.length > 220) continue;
    if (/[:]$/.test(l) || /\b(?:equal opportunity|401\(k\)|paid time off|benefits|insurance|apply today|background check|authorized to work)\b/i.test(l)) continue;
    let bp = false;
    try { bp = isBoilerplate(l); } catch { bp = false; }
    if (bp) continue;
    if (!out.includes(l)) out.push(l);
    if (out.length >= limit) break;
  }
  return out;
}

// O*NET's Generalized Work Activities for work done with the hands, on things or in a place: performing general
// physical activities, handling and moving objects, controlling machines, operating vehicles, repairing mechanical
// and electronic equipment.
const HANDS_ON_GWA = new Set(['4.A.3.a.1', '4.A.3.a.2', '4.A.3.a.3', '4.A.3.a.4', '4.A.3.b.4', '4.A.3.b.5']);
const HANDS_CACHE = new Map();
/**
 * Is this occupation's work done in person? Its O*NET task statements, each read to its work activity: one in five
 * or more under a hands-on activity means a "remote" listing of it is not this work. null when too few tasks read.
 * @param {string} code
 * @returns {boolean|null}
 */
export function handsOn(code) {
  if (HANDS_CACHE.has(code)) return HANDS_CACHE.get(code);
  let placed = 0; let hands = 0;
  for (const t of tasksOf(code)) {
    const a = activitiesOf(t, { occupation: code, limit: 1 })[0];
    if (!a) continue;
    placed++;
    if (HANDS_ON_GWA.has(a.gwa)) hands++;
  }
  const r = placed >= 4 ? hands / placed >= 0.2 : null;
  HANDS_CACHE.set(code, r);
  return r;
}

/**
 * @param {{ title?: string, company?: string, description?: string, location?: string, source?: string }} job
 */
export function readListing(job) {
  const title = String(job.title || '').trim();
  let occ = null;
  try { occ = occupationOf(title, { employer: String(job.company || '') }); } catch { occ = null; }
  if (occ && occ.confidence === 'guess') occ = null;
  const rg = rungOf(title, occ);
  const remote = /\bremote\b/i.test(`${job.location || ''} ${title}`) && !/\b(?:not|no|non)[- ]remote\b/i.test(`${job.location || ''} ${title}`);
  return {
    title,
    occ: occ ? { code: occ.code, title: occ.title, confidence: occ.confidence, zone: occ.zone, ambiguous: !!occ.ambiguous } : null,
    rung: rg.rung,
    rungStated: rg.stated,
    marker: rg.marker,
    teaser: summaryOnly(job),
    remote,
  };
}
