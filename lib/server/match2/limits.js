// match2 — stated limits, both sides, through ONE normaliser.
//
// The person's side: the sentences of their summary / objective that the posting reader's own schedule cue
// (SCHEDULE_CUE_RE, lib/optimizer/postingSections.js) finds, plus their remote wording. The listing's side: its
// title (a title's own words win — a stored "Full-time" is often a default), else the schedule sentences the fit
// engine's posting reader took as constraints. Both go through `scheduleTerms`, which only says what a sentence
// states and whether it is negated in its clause ("no overnights", "not nights"). Unknown on either side is no
// conflict.
import { SCHEDULE_CUE_RE } from '../../optimizer/postingSections.js';

/** @typedef {{ type: Set<string>, shift: Map<string, boolean>, weekends: boolean|null, hours: number|null, remote: boolean|null }} Terms */

const NEG_RE = /\b(?:no|not|never|without|avoid|except|other than|non)\b[^,;.()]*$/i;

/**
 * What a piece of text states about the schedule. `shift` maps day/evening/night → wanted (true) / refused (false).
 * @param {string} text
 * @returns {Terms}
 */
export function scheduleTerms(text) {
  const s = String(text || '').toLowerCase().replace(/[‐-―]/g, '-');
  /** @type {Terms} */
  const out = { type: new Set(), shift: new Map(), weekends: null, hours: null, remote: null };
  const negAt = (/** @type {number} */ i) => NEG_RE.test(s.slice(Math.max(0, i - 40), i));
  for (const m of s.matchAll(/\b(full|part)[- ]?time\b|\b(per diem|prn|seasonal|temporary|temp-to-hire|contract)\b/g)) {
    if (negAt(m.index)) continue;
    out.type.add(m[1] ? `${m[1]}-time` : m[2] === 'prn' ? 'per diem' : m[2]);
  }
  for (const m of s.matchAll(/\b(day|days|morning|mornings|evening|evenings|swing|night|nights|overnight|overnights|graveyard|third)\b(?:[- ]?(shifts?|hours?|work|only|schedule))?/g)) {
    const w = m[1];
    const which = /^(day|days|morning|mornings)$/.test(w) ? 'day' : /^(evening|evenings|swing)$/.test(w) ? 'evening' : 'night';
    // a bare "day"/"days" counts only as a shift word ("day shift", "days only"), never "5 days a week"
    if (which === 'day' && !m[2] && !/\bdays?\s+only\b/.test(s.slice(m.index, m.index + 12))) continue;
    if (w === 'third' && m[2] !== 'shift' && m[2] !== 'shifts') continue;
    const neg = negAt(m.index);
    if (!out.shift.has(which) || neg) out.shift.set(which, !neg);
  }
  for (const m of s.matchAll(/\b(weekends?|saturdays?|sundays?)\b|\b(weekdays?|monday[- ](?:through|to|-)[- ]friday|m-f)\b/g)) {
    if (m[2]) { if (out.weekends == null) out.weekends = false; continue; }
    out.weekends = negAt(m.index) ? false : (out.weekends === false ? false : true);
  }
  const h = s.match(/\b(\d{1,2})\s*(?:[-–to]+\s*(\d{1,2}))?\s*(?:hours?|hrs?)\s*(?:per|a|\/)\s*(?:week|wk)\b/);
  if (h) out.hours = Number(h[2] || h[1]);
  if (/\bremote\b/.test(s)) out.remote = !negAt(s.indexOf('remote'));
  return out;
}

/** The want sentences of the person's own head lines: what the posting reader's schedule cue finds there. */
export function personWants(head) {
  const sentences = String(head || '').split(/(?<=[.!?;])\s+|\n+|\s—\s/).filter((x) => SCHEDULE_CUE_RE.test(x) || /\b(?:day|night|overnight)[- ]?shifts?\b|\bremote only\b|\bweekdays?\b/i.test(x));
  // a sentence describing the present ("currently working two part-time jobs") is not a want, and one that states
  // breadth ("open to days, nights and weekends", "flexible schedule") limits nothing
  const wants = sentences.filter((x) => !/\b(?:open to|available (?:for|to work)|open availability|flexible|any shifts?|all shifts)\b/i.test(x)).filter((x) => !/\b(?:currently|now)\s+(?:work|working|employed|hold|holding)\b/i.test(x) || /\b(?:looking|seeking|want|prefer|only|need)\b/i.test(x))
    .map((x) => x.replace(/\b(?:currently|now)\s+(?:work|working|employed|hold|holding)\b[^.;]*/i, ''));
  return scheduleTerms(wants.join(' . '));
}

/**
 * The listing's stated conditions: the title first; for each dimension the title is silent on, the posting
 * reader's schedule sentences.
 * @param {string} title @param {string[]} scheduleSentences
 */
export function listingConditions(title, scheduleSentences) {
  const t = scheduleTerms(String(title || '').replace(/[()]/g, ' , '));
  const b = scheduleTerms((scheduleSentences || []).join(' . '));
  return {
    type: t.type.size ? t.type : b.type,
    shift: t.shift.size ? t.shift : b.shift,
    weekends: t.weekends ?? b.weekends,
    hours: t.hours ?? b.hours,
    remote: t.remote ?? b.remote,
  };
}

/**
 * A stated want against a stated listing condition that contradicts it.
 * @param {Terms} want @param {ReturnType<typeof listingConditions>} cond
 * @returns {string|null} the plain reason, or null
 */
export function limitConflict(want, cond) {
  const wt = [...want.type].filter((x) => x === 'full-time' || x === 'part-time');
  if (wt.length === 1 && cond.type.size && !cond.type.has(wt[0])) {
    const other = [...cond.type][0];
    return `you asked for ${wt[0]} work and this job is ${other}`;
  }
  if (want.hours != null && want.hours <= 32 && cond.type.has('full-time') && !cond.type.has('part-time') && !wt.includes('full-time')) return `you asked for about ${want.hours} hours a week and this job is full-time`;
  for (const [which, wanted] of want.shift) {
    if (wanted === false && cond.shift.get(which) === true) return `you said no ${which} shifts and this job is a ${which} shift`;
  }
  const onlyShift = [...want.shift].filter(([, v]) => v).map(([k]) => k);
  if (onlyShift.length === 1) {
    const listed = [...cond.shift].filter(([, v]) => v).map(([k]) => k);
    if (listed.length && !listed.includes(onlyShift[0])) return `you asked for ${onlyShift[0]} shifts and this job is ${listed.join('/')} shifts`;
  }
  if (want.weekends === false && cond.weekends === true) return 'you said no weekends and this job asks for weekends';
  return null;
}
