/**
 * What Seen sells, in the words every surface uses — ONE place (owner decisions 2026-10-25).
 *
 * The numbers live in lib/server/creditRules.js (ONE_TIME_SKUS, the same cents api/stripe.js charges);
 * this module gives the client the names, prices and the plain lines /pricing, the upgrade modal, the
 * lock cards, the tracker card, the homepage and Settings all print. lib/pricing.test.mjs fails the
 * suite on any hand-typed price.
 *
 *   Free forever — company grades, the tracker and its check-ins, job search, résumé match. No card.
 *   Interview Prep — $9.99 for one interview (also opens 14 days of Pro). The lead product.
 *   Job Search Pass — $19.99 for 30 days of everything, including Interview Prep for every interview.
 * Both are one-time and never renew. There is no subscription and no trial to start.
 */
import { ONE_TIME_SKUS, ONE_TIME_NOTE, skuPrice } from './server/creditRules.js'

export type OfferSku = 'interview' | 'pass30'

export const PREP = ONE_TIME_SKUS.interview
export const PASS = ONE_TIME_SKUS.pass30
export const PREP_PRICE: string = skuPrice('interview')
export const PASS_PRICE: string = skuPrice('pass30')
export { ONE_TIME_NOTE }

export const usd = (n: number) => `$${n.toFixed(2)}`

/** What stays free for every job seeker, always. Each line is something the free code path does. */
export const FREE_FOREVER: string[] = [
  'Company grades, ghost rates and what applicants report',
  'The tracker and its day 7, 14 and 30 check-ins',
  'Job search, with every listing scored',
  'Résumé match: what a job asks for that your résumé is missing',
]
export const FREE_LINE = 'Free forever. No card.'

/** Interview Prep — what one interview's prep holds (api/interview-prep.js build). */
export const PREP_INCLUDES: string[] = [
  'Likely questions for the role, and what each one checks',
  'Answers built from your own résumé — no invented jobs or numbers',
  'Your 30-second “tell me about yourself”',
  'Thank-you and follow-up emails, timed to your interview date',
]

/**
 * The Job Search Pass — described by what the person gets for their search, not by credits. Every line
 * is something Pro access grants in code: Interview Prep builds (gateAI proOnly), résumé optimize /
 * tailor / scan and job insights with no daily cap (gateAI, Pro bypasses the cap), HumanProof
 * (api/optimizer.js proOnly; Pro optimize results also come back in that voice), AI polish in Résumé
 * Studio (proOnly) and unbranded downloads (lib/server/resumeStudio.js).
 */
export const PASS_INCLUDES: string[] = [
  'Interview Prep for every interview in those 30 days',
  'A résumé tailored to every job you apply to — no daily limit',
  'What each job asks for, on any listing with a full description',
  'HumanProof: your bullets rewritten so they sound like you, nothing invented',
  'AI polish in Résumé Studio, and downloads without the Seen footer',
]

/** "$9.99 — for one interview" */
export const PREP_LINE = `${PREP_PRICE} — for one interview`
/** "$19.99 — 30 days of everything" */
export const PASS_LINE = `${PASS_PRICE} — ${PASS.pro_days} days of everything`

/** The Settings / legal one-liner naming both products and their prices. */
export function offerLine(): string {
  return `${PREP.name} is ${PREP_PRICE} for one interview; the ${PASS.name} is ${PASS_PRICE} for ${PASS.pro_days} days of everything, including Interview Prep for every interview. Both are one-time and never renew.`
}

/** Under every Pro-only lock (HumanProof, AI polish): what unlocks it, priced, once. */
export const LOCK_NOTE = `Comes with the ${PASS.name} (${PASS_PRICE}) or ${PREP.name} (${PREP_PRICE}). ${ONE_TIME_NOTE}.`
/** After a tailored résumé: the outcome the pass buys, not a credit count. */
export const PASS_AFTER_WIN = `Applying to a lot of jobs? The ${PASS.name} tailors every one for ${PASS.pro_days} days →`
