// The "part time", "night shift", "entry level", "$20 an hour" a person typed, applied to listings as a ranking nudge.
// Listings say these things unevenly (Adzuna sets a contract type, most boards do not; pay is often missing), so a
// modifier never hides a listing — it moves the ones that say it up, and the ones that contradict it down.
import { parsePayText } from './pay.js';

const HOURS_PER_YEAR = 2080;

/** The most a listing's stated pay comes to per hour, or null when it states none we can read. */
export function hourlyTop(salary) {
  const p = parsePayText(salary);
  if (!p || !p.lo) return null;
  const top = p.hi && p.hi > p.lo ? p.hi : p.lo;
  if (p.period === 'hour') return top;
  if (p.period === 'year' || (!p.period && top >= 15000)) return top / HOURS_PER_YEAR;
  if (p.period === 'week') return top / 40;
  if (p.period === 'month') return (top * 12) / HOURS_PER_YEAR;
  return null;
}

const SENIOR_RE = /\b(?:senior|sr\.?|lead|principal|staff|manager|director|head of|vp|vice president|chief|supervisor)\b/i;
const ENTRY_RE = /\b(?:entry[- ]?level|junior|jr\.?|trainee|apprentice|intern(?:ship)?|associate|no experience|will train|paid training|new grad(?:uate)?)\b/i;

/**
 * How much to move a listing for the modifiers in a search (0 when none apply).
 * @param {{ title?: string, type?: string, level?: string, salary?: string, description?: string, location?: string }} job
 * @param {{ partTime?: boolean, fullTime?: boolean, entry?: boolean, night?: boolean, weekend?: boolean, payMin?: number|null }} mods
 */
export function modifierBoost(job, mods) {
  if (!mods) return 0;
  const title = String(job.title || '');
  const type = String(job.type || '');
  const head = `${title} ${type} ${String(job.description || '').slice(0, 600)}`;
  let b = 0;
  if (mods.partTime) {
    if (/part[- ]?time/i.test(`${title} ${type}`) || /\bpart[- ]?time\b/i.test(head)) b += 15;
    else if (/full[- ]?time/i.test(title)) b -= 10;
  }
  if (mods.fullTime) {
    if (/part[- ]?time/i.test(`${title} ${type}`)) b -= 12;
    else if (/full[- ]?time/i.test(`${title} ${type}`)) b += 6;
  }
  if (mods.entry) {
    if (ENTRY_RE.test(title) || /entry/i.test(String(job.level || ''))) b += 12;
    if (SENIOR_RE.test(title)) b -= 15;
  }
  if (mods.night && /\b(?:night|overnight|graveyard|3rd shift|third shift)\b/i.test(head)) b += 12;
  if (mods.weekend && /\bweekends?\b/i.test(head)) b += 10;
  if (mods.payMin) {
    const top = hourlyTop(job.salary);
    if (top != null) b += top >= mods.payMin ? 15 : -20;
  }
  return b;
}

/** True when a search carries any modifier this module ranks by. */
export function hasModifiers(mods) {
  return !!(mods && (mods.partTime || mods.fullTime || mods.entry || mods.night || mods.weekend || mods.payMin));
}

/** The modifiers in words, for the page ("part-time · night shift · $20+/hr"). */
export function modifierLabels(mods) {
  if (!mods) return [];
  const out = [];
  if (mods.remote) out.push('remote');
  if (mods.partTime) out.push('part-time');
  if (mods.fullTime) out.push('full-time');
  if (mods.entry) out.push('entry level');
  if (mods.night) out.push('night shift');
  if (mods.weekend) out.push('weekends');
  if (mods.payMin) out.push(`$${mods.payMin}+/hr`);
  return out;
}
