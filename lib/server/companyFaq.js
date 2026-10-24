// Pure builder for the company-page FAQ (GEO — real-data-first AI citations). Produces the Q&A pairs
// that back BOTH a FAQPage JSON-LD node and a matching VISIBLE FAQ block (Google requires FAQ schema
// content to be present on the page). Questions follow what people search (Google Ads keyword data,
// Oct 2026): "<employer> application status", "<employer> hiring process", and for staffing agencies
// "is <agency> legit".
//
// HONESTY RULES (load-bearing — identical to the rest of the company surface):
//   - Every answer is worded as what applicant reports SAY ("Of 48 applicant reports on Seen, 87%
//     say …"), never as a fact about the employer ("X ghosts applicants").
//   - Ghost / response numbers render ONLY when the caller passes them (the page's own rule: graded
//     AND at least MIN_REPORTS_FOR_RATES applicant reports, lib/companyMeta.ts). A rate is never made up.
//   - A wait time renders ONLY from a real average of at least one day. None is ever estimated.
//   - Returns [] when there is no grade, so callers emit no empty FAQ and no FAQPage schema.
//   - No dashes in the copy (owner 2026-10-24), correct plurals.

import { gradeLetter } from '../gradeScale.js';

const plural = (n, one) => `${n.toLocaleString('en-US')} ${one}${n === 1 ? '' : 's'}`;
const CLAIMS = 'These are applicants\' own accounts, not verified facts.';

/**
 * @param {{name?:string|null, overallScore?:number|null, ghostRate?:number|null, responseRate?:number|null,
 *   avgWaitDays?:number|null, reportCount?:number|null, mentionCount?:number|null, isAgency?:boolean}} s
 * @returns {Array<{question:string, answer:string}>}
 */
export function buildCompanyFaq(s) {
  const { name, overallScore, ghostRate, responseRate, avgWaitDays, reportCount, mentionCount, isAgency } = s || {};
  if (name == null || name === '' || overallScore == null || !Number.isFinite(Number(overallScore))) return [];

  const score = Math.round(Number(overallScore));
  const grade = gradeLetter(score);
  const rc = Number.isFinite(reportCount) && reportCount > 0 ? Math.floor(reportCount) : 0;
  const mc = Number.isFinite(mentionCount) && mentionCount > 0 ? Math.floor(mentionCount) : 0;
  const reports = rc > 0 ? plural(rc, 'applicant report') : '';
  const basis = rc > 0 ? `${reports}${mc > 0 ? ` and ${plural(mc, 'online mention')}` : ''}` : 'aggregated hiring data';
  const pct = (v) => Math.round(Number(v) * 100);
  const rates = rc > 0 && ghostRate != null && responseRate != null;
  const resp = rates ? pct(responseRate) : null;
  const ghost = rates ? pct(ghostRate) : null;
  const waitN = avgWaitDays != null && Number.isFinite(Number(avgWaitDays)) ? Math.round(Number(avgWaitDays)) : 0;
  const wait = rc > 0 && waitN > 0 ? plural(waitN, 'day') : null;
  const gradeLine = `Seen grades the ${name} hiring process ${grade} (${score}/100) from ${basis}.`;
  const faq = [];

  // "<employer> application status" — the biggest search. Rates only; the wait only when real.
  if (rates) {
    faq.push({
      question: `${name} application status: do applicants hear back?`,
      answer: `Of ${reports} on Seen, ${resp}% say ${name} got back to them (a rejection counts as an answer) and ${ghost}% say they never heard back.`
        + (wait ? ` The reports put the average wait to hear back at ${wait}.` : '')
        + ` ${CLAIMS}`,
    });
  }

  // "<employer> hiring process" — the grade and what it stands on, then the reported outcomes.
  faq.push({
    question: `What is the ${name} hiring process like?`,
    answer: `${gradeLine} `
      + (rates
        ? `Those reports say ${resp}% of applicants heard back and ${ghost}% never did.`
        : 'There are too few applicant reports for a response rate yet.')
      + ` ${CLAIMS}`,
  });

  // Staffing agencies: "is <agency> legit". Seen cannot vouch for a company or an offer; it can say
  // what applicants reported, in the same neutral wording.
  if (isAgency) {
    faq.push({
      question: `Is ${name} legit?`,
      answer: `Seen does not verify companies or job offers. What it has is what applicants report: `
        + (rates
          ? `of ${reports} on Seen about ${name}, ${resp}% say they heard back and ${ghost}% say they never did.`
          : `${basis} on Seen about ${name}, too few for a response rate yet.`)
        + ` ${gradeLine} ${CLAIMS}`,
    });
  }

  // The ghosting question, answered in report wording.
  if (rates) {
    const read = ghost >= 60 ? 'Most say they never heard back.'
      : ghost >= 30 ? 'A large share say they were left without an answer.'
        : 'Most say they did hear back one way or another.';
    faq.push({
      question: `Does ${name} ghost applicants?`,
      answer: `Of ${reports} on Seen, ${ghost}% say ${name} never got back to them after they applied or interviewed. ${read} ${CLAIMS}`,
    });
  }

  // Wait time: only from a real average.
  if (wait) {
    faq.push({
      question: `How long does ${name} take to respond to applicants?`,
      answer: `Across ${reports} on Seen, the average wait to hear back from ${name} was ${wait}. ${CLAIMS}`,
    });
  }

  return faq;
}
