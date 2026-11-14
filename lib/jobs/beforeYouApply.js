// "Before you apply" — the help a listing's drawer and page give a beginner, read from THIS posting only:
//   checks     what the employer checks for a new hire (a driver's license, a CDL class, a drug test, a background
//              check, an age, a rotation, a lift, the tickets it wants and whether they come after hire);
//   terms      the credential words the posting uses, each with a short neutral definition (lib/jobs/termGlossary.js);
//   payToTrain the sentence in which the posting asks the applicant to pay (lib/jobs/payToTrain.js), or null;
//   repayment  the posting's "training is paid back if you leave before N months", or null.
//
// Shown for an entry / trains-beginners / trade or oilfield posting (lib/optimizer/tradeReading.js tradeContext,
// lib/jobs/trainsBeginners.js) — and for ANY posting that asks the applicant to pay. Nothing here states a requirement
// the posting does not: every check is a constraint the shared posting reader (lib/optimizer/postingSections.js
// extractConstraints, which runs the trade reading) took from one of the posting's own sentences, and carries it.
//
// Client-safe (no node imports); the drawer loads it on demand.
import { extractConstraints } from '../optimizer/postingSections.js';
import { tradeContext } from '../optimizer/tradeReading.js';
import { listingTrainsBeginners } from './trainsBeginners.js';
import { termsIn } from './termGlossary.js';
import { payToTrain, trainingRepayment } from './payToTrain.js';

const cap = (s) => String(s || '').replace(/^\s*(?:a|an)\s+(?=[A-Z])/, '').replace(/^\w/, (c) => c.toUpperCase());
const MAX_CHECKS = 10;

/** @typedef {{ key: string, text: string, status: 'required'|'preferred'|'after_hire'|null, sentence: string }} Check */

/**
 * The posting's checks for a new hire, in a fixed order (licences and tickets, age, screening, physical, schedule,
 * experience, schooling), each phrased plainly.
 * @param {string} title @param {string} description
 * @returns {Check[]}
 */
export function beginnerChecks(title, description) {
  const text = String(description || '');
  if (text.trim().length < 40) return [];
  let cs = [];
  try { cs = extractConstraints(text, { jobTitle: String(title || '') }) || []; } catch { return []; }
  const out = [];
  const schedule = [];
  let scheduleSentence = '';
  const add = (order, key, t, status, sentence) => {
    if (!t || out.some((x) => x.key === key)) return;
    out.push({ order, key, text: t, status, sentence: String(sentence || '').trim().slice(0, 300) });
  };
  const statusOf = (c) => (c.trade && c.trade.obtainLater ? 'after_hire' : c.importance === 'preferred' ? 'preferred' : 'required');
  for (const c of cs) {
    const tr = c.trade || {};
    const s = c.sentence;
    switch (c.kind) {
      case 'certification': {
        if (tr.licence === 'cdl') add(1, 'cdl', tr.cls ? `A Class ${tr.cls} CDL` : 'A CDL (commercial driver\'s license)', statusOf(c), s);
        else if (tr.licence === 'driver') add(2, 'driver', 'A valid driver\'s license', statusOf(c), s);
        else if (tr.licence === 'endorsement') add(3, `end:${c.label}`, cap(c.label), statusOf(c), s);
        else if (tr.ticket) add(4, `ticket:${tr.ticket}`, cap(c.label), statusOf(c), s);
        else if (/\bdriver['’]?s?\s+licen[sc]e\b/i.test(`${c.label}`)) add(2, 'driver', 'A valid driver\'s license', statusOf(c), s);
        else add(5, `cert:${String(c.value || c.label).toLowerCase()}`, cap(c.label), statusOf(c), s);
        break;
      }
      case 'age':
        if (Number(c.value) >= 16) add(6, 'age', `Be at least ${Number(c.value)} years old`, 'required', s);
        break;
      case 'background': {
        const lab = `${c.label || ''}`;
        if (tr.readiness === 'second_chance') add(9, 'second_chance', 'Second-chance employer — the posting welcomes applicants with a record', null, s);
        else if (tr.record || /\bmvr\b|motor\s+vehicle|driving\s+record/i.test(lab)) add(8, 'mvr', 'A clean driving record — they check your MVR (motor vehicle record)', 'required', s);
        else if (tr.readiness === 'drug' || /\bdrug|alcohol/i.test(lab)) add(7, 'drug', 'Pass a drug test', 'required', s);
        else add(7.5, 'background', 'Pass a background check', 'required', s);
        // one sentence often names both ("Must pass a pre-employment drug screen and background check"): the reader keeps one
        if (/\bdrug\s+(?:and\s+alcohol\s+)?(?:tests?|screen\w*|testing)\b/i.test(String(s))) add(7, 'drug', 'Pass a drug test', 'required', s);
        if (/\b(?:criminal\s+)?background\s+(?:check|screen\w*|investigation)s?\b/i.test(String(s)) && !/\bsecond[- ]chance|fair[- ]chance\b/i.test(String(s))) add(7.5, 'background', 'Pass a background check', 'required', s);
        break;
      }
      case 'physical': {
        const items = Array.isArray(c.items) && c.items.length ? c.items : [c.label];
        add(10, 'physical', `Physical: ${items.join(', ')}`, 'required', s);
        break;
      }
      case 'schedule': {
        // ONE schedule line: the trade reading's rotation / travel / long hours first, then the general words (nights,
        // weekends) — an hours figure the trade line already states is not repeated ("up to 50 hours a week" / "50 hours
        // per week")
        const items = (Array.isArray(c.items) && c.items.length ? c.items : [c.label]).map(String);
        if (tr.schedule) schedule.unshift(...items); else schedule.push(...items);
        if (!scheduleSentence || tr.schedule) scheduleSentence = s;
        break;
      }
      case 'years':
        add(12, `years:${c.label}`, cap(c.label), c.importance === 'preferred' ? 'preferred' : 'required', s);
        break;
      case 'degree':
        add(13, 'degree', cap(c.label), c.importance === 'preferred' ? 'preferred' : 'required', s);
        break;
      default:
        break;
    }
  }
  if (schedule.length) {
    const seen = new Set();
    const hours = schedule.some((x) => /\bhours?\b/i.test(x) && /\d/.test(x));
    const kept = schedule.filter((x, i) => {
      const k = x.toLowerCase().trim();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      // a second hours-a-week figure after the first is the same statement in other words
      return !(hours && i > 0 && /\bhours?\s+(?:per|a)\s+week\b/i.test(x) && schedule.slice(0, i).some((y) => /\bweek\b/i.test(y) && /\d/.test(y)));
    });
    add(11, 'schedule', `Schedule: ${kept.join(', ')}`, null, scheduleSentence);
  }
  return out.sort((a, b) => a.order - b.order).slice(0, MAX_CHECKS).map(({ order, ...rest }) => rest); // eslint-disable-line no-unused-vars
}

/** Does the posting take beginners? It trains them, it says entry level, or it is a trade's apprentice / helper rung
 *  that asks for no time in the job (tradeContext.entry). */
export function takesBeginners(job) {
  const title = String(job?.title || '');
  const desc = String(job?.description || '');
  const ctx = tradeContext(title, desc);
  if (ctx) return !!ctx.entry;
  return job?.trains_beginners === true || /\bentry[- ]level\b/i.test(title) || listingTrainsBeginners({ title, description: desc });
}

/** Is this a posting the block is for? An oilfield / trade posting, or one that trains beginners. */
export function isBeginnerListing(job) {
  const title = String(job?.title || '');
  const desc = String(job?.description || '');
  if (job?.trains_beginners === true) return true;
  if (tradeContext(title, desc)) return true;
  if (/\bentry[- ]level\b/i.test(title)) return true;
  return listingTrainsBeginners({ title, description: desc });
}

/**
 * Everything the block shows for a listing, or null when it shows nothing.
 * @param {{ title?: string, description?: string|null, trains_beginners?: boolean }} job
 * `entry`: the posting takes beginners (the checks are "what they check for a beginner"); else they are what it asks for.
 * @returns {null | { beginner: boolean, entry: boolean, checks: Check[], terms: Array<{key:string,term:string,def:string}>, payToTrain: {sentence:string}|null, repayment: {months:number|null,sentence:string}|null }}
 */
export function beforeYouApply(job) {
  const title = String(job?.title || '');
  const desc = String(job?.description || '');
  const all = `${title}\n${desc}`;
  const pay = payToTrain(all);
  const beginner = isBeginnerListing(job);
  if (!beginner && !pay) return null;
  return {
    beginner,
    entry: beginner && takesBeginners(job),
    checks: beginner ? beginnerChecks(title, desc) : [],
    terms: termsIn(all),
    payToTrain: pay,
    repayment: trainingRepayment(desc),
  };
}
