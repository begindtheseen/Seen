// /start/secondchance — "Getting hired with a record". The page renders from this module only, so every figure on it
// carries a reference and an as-of date (lib/start/guides.test.mjs fails on a figure without one).
//
// THE ONLY SOURCE OF FACTS is the research file compiled 2026-11-17 (session scratchpad guides20/secondchance/research.md).
// Rules this module keeps:
//   • only items the research marked VERIFIED: the statutes and federal rules themselves (5 CFR 920, 41 U.S.C. 4714,
//     15 U.S.C. 1681b / 1681c), federal agencies (CFPB, EEOC, FTC, DOL, IRS, LSC), state and city enforcement agencies
//     (California CRD, NYC Commission on Human Rights, Washington AG, Texas TDLR, Idaho Department of Labor, a
//     Pennsylvania county court page), the DOL's Federal Bonding Program site and the DOJ-funded Clean Slate
//     Clearinghouse and NICCC, and one employer's own statement (JPMorganChase);
//   • the EEOC rescinded its 2012 arrest-and-conviction guidance on 2026-10-29: nothing from that guidance (the
//     "Green factors", individualized assessment as an EEOC rule) is presented as current; the page says it was
//     withdrawn and what the EEOC says Title VII still forbids;
//   • WOTC: the IRS and DOL pages (read 2026-11-17) cover hires who began work on or before 2025-12-31 and name no
//     renewal, so the page says exactly that, dated;
//   • never link bonding.org (the old Federal Bonding Program domain now redirects to a domain-for-sale page);
//   • describe the rules and point to legal aid; never legal advice, never "you will" or a promise of a job;
//   • FIRST-HAND items (several accounts agreeing) only as `firstHand: true`, rendered as what people say;
//   • tone: plain, dignified, never pitying. No hype, no exclamation marks.
//
// Shape: `sources` (every reference behind the page, NEVER printed as citations — readers reach the links through the
// grouped "Additional resources" row), entries `{ text, src, firstHand? }`, `listings` (null here) and the openable
// menu rows (`menu`, rendered by components/start/Guide.tsx). Pure data; relative imports only.

import { blockEntries } from './entries.js'

/** @typedef {{ label: string, url: string, date: string, note?: string }} Source */

/** @type {Record<string, Source>} */
export const sources = {
  // Federal fair-chance rules.
  'cfr-920': {
    label: 'eCFR, 5 CFR part 920, Fair Chance to Compete for Jobs: timing of criminal history inquiries for federal positions',
    url: 'https://www.ecfr.gov/current/title-5/part-920',
    date: '2026-11-17', note: 'read',
  },
  'usc-4714': {
    label: '41 U.S.C. 4714, Prohibition on criminal history inquiries by contractors prior to conditional offer (Legal Information Institute)',
    url: 'https://www.law.cornell.edu/uscode/text/41/4714',
    date: '2026-11-17', note: 'read',
  },
  // State and city fair-chance laws (official pages only).
  'ca-crd': {
    label: 'California Civil Rights Department, Fair Chance Act',
    url: 'https://calcivilrights.ca.gov/fair-chance-act/',
    date: '2026-11-17', note: 'read',
  },
  'nyc-cchr': {
    label: 'NYC Commission on Human Rights, Fair Chance Act legal guidance',
    url: 'https://www.nyc.gov/site/cchr/law/fair-chance-act.page',
    date: '2026-11-17', note: 'read',
  },
  'wa-ag': {
    label: 'Washington State Office of the Attorney General, Fair Chance Act',
    url: 'https://www.atg.wa.gov/fair-chance-act',
    date: '2026-11-17', note: 'read',
  },
  // Background checks (Fair Credit Reporting Act).
  'fcra-1681b': {
    label: '15 U.S.C. 1681b(b), Fair Credit Reporting Act: conditions for furnishing and using reports for employment (Legal Information Institute)',
    url: 'https://www.law.cornell.edu/uscode/text/15/1681b',
    date: '2026-11-17', note: 'read',
  },
  'fcra-1681c': {
    label: '15 U.S.C. 1681c, Fair Credit Reporting Act: information that may not be included in reports (Legal Information Institute)',
    url: 'https://www.law.cornell.edu/uscode/text/15/1681c',
    date: '2026-11-17', note: 'read',
  },
  'cfpb-bg': {
    label: 'Consumer Financial Protection Bureau, "Background screening reports" handout',
    url: 'https://files.consumerfinance.gov/f/documents/cfpb_background-screening-report_handout_2021-08.pdf',
    date: '2021-08', note: 'published',
  },
  'eeoc-bg': {
    label: 'EEOC and FTC, "Background Checks: What Job Applicants and Employees Should Know"',
    url: 'https://www.eeoc.gov/laws/guidance/background-checks-what-job-applicants-and-employees-should-know',
    date: '2014-03-11', note: 'issued',
  },
  'eeoc-rescind': {
    label: 'EEOC press release, "EEOC Votes to Rescind Enforcement Guidance on Arrest and Conviction Records"',
    url: 'https://www.eeoc.gov/newsroom/eeoc-votes-rescind-enforcement-guidance-arrest-and-conviction-records',
    date: '2026-10-29', note: 'published',
  },
  // Clearing a record, legal help.
  'clean-slate': {
    label: 'Clean Slate Clearinghouse, National Reentry Resource Center (CSG Justice Center, funded by the Bureau of Justice Assistance)',
    url: 'https://nationalreentryresourcecenter.org/cleanslate',
    date: '2026-11-17', note: 'read',
  },
  'pa-clean-slate': {
    label: 'Dauphin County, Pennsylvania, court departments: Clean Slate, Expungement, and Limited Access from the Unified Judicial System of Pennsylvania',
    url: 'https://www.dauphincounty.gov/government/court-departments/adult-division/clean-slate-expungement-and-limited-access-from-the-unified-judicial-system-of-pennsylvania',
    date: '2026-11-17', note: 'read',
  },
  'lsc': {
    label: 'Legal Services Corporation, Get Legal Help (find an LSC-funded legal aid organization)',
    url: 'https://www.lsc.gov/about-lsc/what-legal-aid/i-need-legal-help',
    date: '2026-11-17', note: 'read',
  },
  // Federal Bonding Program and WOTC.
  'dol-recruit': {
    label: 'U.S. Department of Labor, Employment and Training Administration, Recruit and Hire (Federal Bonding Program, WOTC)',
    url: 'https://www.dol.gov/agencies/eta/employers/recruit',
    date: '2026-11-17', note: 'read',
  },
  'fbp-faq': {
    label: 'The Federal Bonding Program (U.S. Department of Labor), FAQs',
    url: 'https://bonds4jobs.com/about-us/faqs',
    date: '2026-11-17', note: 'read',
  },
  'fbp-seekers': {
    label: 'The Federal Bonding Program (U.S. Department of Labor), For Job Seekers',
    url: 'https://bonds4jobs.com/our-services/job-seekers',
    date: '2026-11-17', note: 'read',
  },
  'irs-wotc': {
    label: 'Internal Revenue Service, Work Opportunity Tax Credit (page last reviewed 2026-07-20)',
    url: 'https://www.irs.gov/businesses/small-businesses-self-employed/work-opportunity-tax-credit',
    date: '2026-07-20', note: 'reviewed',
  },
  'dol-wotc': {
    label: 'U.S. Department of Labor, Work Opportunity Tax Credit',
    url: 'https://www.dol.gov/agencies/eta/wotc',
    date: '2026-11-17', note: 'read',
  },
  // Applying and talking about a record.
  'idaho-reentry': {
    label: 'Idaho Department of Labor, "Reentry services: Resource guide for formerly incarcerated individuals" (January 2026)',
    url: 'https://www.labor.idaho.gov/wp-content/uploads/2026/06/Reentry-services.pdf',
    date: '2026-01', note: 'published',
  },
  'jpmc': {
    label: 'JPMorganChase newsroom, "Why JPMorganChase believes second chances are good for business" (May 2, 2024)',
    url: 'https://www.jpmorganchase.com/newsroom/stories/why-jpmorgan-chase-believes-second-chances-are',
    date: '2024-05-02', note: 'published',
  },
  // Licenses.
  'tdlr': {
    label: 'Texas Department of Licensing and Regulation, Criminal History Evaluation Letter',
    url: 'https://www.tdlr.texas.gov/crimhistoryeval.htm',
    date: '2026-11-17', note: 'read',
  },
  'niccc': {
    label: 'National Inventory of Collateral Consequences of Conviction (funded by the Bureau of Justice Assistance)',
    url: 'https://niccc.nationalreentryresourcecenter.org/',
    date: '2026-11-17', note: 'read',
  },
  // Scams.
  'ftc-jobscams': {
    label: 'Federal Trade Commission, "Job Scams" (March 2023)',
    url: 'https://consumer.ftc.gov/articles/job-scams',
    date: '2023-03', note: 'published',
  },
  // First-hand accounts (r/felons, read through the Arctic Shift archive). Used only where several accounts agree.
  'r-1supn9i': { label: 'r/felons, "Have any of you ever disclosed your conviction to a potential employer during a job interview?"', url: 'https://www.reddit.com/r/felons/comments/1supn9i/', date: '2026-04-24', note: 'thread' },
  'r-1vh9a28': { label: 'r/felons, "Help with job interview questions about my felony."', url: 'https://www.reddit.com/r/felons/comments/1vh9a28/', date: '2026-08-06', note: 'thread' },
  'r-1kf0pig': { label: 'r/felons, "Job interview tomorrow"', url: 'https://www.reddit.com/r/felons/comments/1kf0pig/', date: '2025-05-05', note: 'thread' },
  'r-1u7haw7': { label: 'r/felons, "Was upfront about pending charges during interview"', url: 'https://www.reddit.com/r/felons/comments/1u7haw7/', date: '2026-06-16', note: 'thread' },
}

export const guide = {
  path: '/start/secondchance',
  title: 'Getting hired with a record',
  crumbLabel: 'Hired with a record',
  eyebrow: 'Guide',
  // The one-sentence answer under the h1 (no figure: the figures live in the tiles).
  answer: { text: 'For most jobs, federal agencies, and federal contractors hiring for contract work, cannot ask about a criminal record until they make a conditional job offer, and some states and cities set a similar rule for private employers. Any employer that runs a background check through a screening company needs your permission first, and must give you a copy of the report before turning you down because of it.', src: ['cfr-920', 'usc-4714', 'ca-crd', 'nyc-cchr', 'wa-ag', 'fcra-1681b', 'cfpb-bg'] },
  metaDescription: 'Getting hired with a criminal record: when employers can ask, your rights in a background check, how to talk about a record, clearing or sealing records, the free Federal Bonding Program, licenses and where to get legal help.',
  asOf: '2026-11-17',
}

// The three readings in the hero: each restates a fact below, with the same references.
export const tiles = [
  { label: 'Old arrests on a report', value: '7 years', text: 'the usual federal limit for reporting an arrest that did not lead to a conviction. Convictions have no federal limit.', src: ['fcra-1681c'] },
  { label: 'Free bond for your employer', value: '$5,000–$25,000', text: 'Federal Bonding Program cover for your first six months, at no cost to you or the employer', src: ['fbp-faq'] },
  { label: 'A wrong report', value: '30 days', text: 'the time a screening company generally has to look into your dispute, 15 more in some cases', src: ['cfpb-bg'] },
]

// 1. Finding work (listings = null, so this row sends people to job search with tips).
export const findWork = {
  roles: { text: 'Idaho\'s Department of Labor lists the jobs where people leaving prison have found work: retail sales, warehouse work, laundry and dry cleaning, helper to an electrician, plumber or carpenter, construction labor, cooking and serving food, housekeeping and janitorial work, landscaping, and delivery or package handling.', src: ['idaho-reentry'] },
  first: { text: 'The same guide: "your first job after release does not have to be your ideal job." If you finished a training program while incarcerated, it says to tell the employer.', src: ['idaho-reentry'] },
  search: { text: 'Search Seen\'s job listings by role and your city. The jobs below are a place to start.', src: ['idaho-reentry'] },
  employer: { text: 'One example: JPMorganChase says it removed the criminal-history question from its applications in 2018 and looks at records only after a conditional offer. In May 2024 it said that over the last three years about 10 percent of its new U.S. hires had a criminal record.', src: ['jpmc'] },
  help: [
    { name: 'Your state\'s workforce office', text: 'The Federal Bonding Program\'s toll-free line, 1-800-233-2258, gives the nearest workforce office and your state\'s bonding coordinator.', src: ['fbp-seekers'] },
    { name: 'Legal aid', text: 'The Legal Services Corporation\'s finder lists the civil legal aid groups it funds near any address or city.', src: ['lsc'] },
    { name: 'A lawyer for record clearing', text: 'The Clean Slate Clearinghouse has a Find A Lawyer tool by state.', src: ['clean-slate'] },
  ],
}
export const peopleWork = [
  { text: 'People who have been through it describe getting hired in food service, at a fast-food restaurant or a pizza place.', src: ['r-1supn9i', 'r-1vh9a28'], firstHand: true },
]

// 2. When employers can ask.
export const whenAsk = {
  federal: { text: 'Federal agencies may not ask about criminal history before they make a conditional offer: an offer that depends on the background investigation. The rule covers competitive, excepted and Senior Executive Service jobs.', src: ['cfr-920'] },
  federalExceptions: { text: 'It does not cover jobs where a law requires an earlier check, jobs that need access to classified information or are designated sensitive, some military technician jobs, federal law enforcement officer jobs, and political appointments. Agencies must tell applicants how to complain.', src: ['cfr-920'] },
  contractors: { text: 'Federal contractors may not ask, on paper or out loud, about the record of someone applying for a job on a federal contract until they make a conditional offer. The exceptions are jobs where a law requires an earlier check, contracts that need access to classified information or sensitive law enforcement or national security duties, and other positions the General Services Administration exempts by regulation. The General Services Administration publishes how to complain.', src: ['usc-4714'] },
  places: [
    { name: 'California', text: 'Employers with five or more employees generally cannot ask about conviction history before a job offer. In effect since January 1, 2018.', src: ['ca-crd'] },
    { name: 'New York City', text: 'Employers with four or more employees cannot ask about or consider conviction history until after a conditional offer. To withdraw an offer over your record, they must give you a copy of what they found and their written analysis, and at least five business days to respond.', src: ['nyc-cchr'] },
    { name: 'Washington', text: 'Job ads may not exclude people with records, applications may not ask about a record, and employers may not ask about a record or run a check until they have found you otherwise qualified and made a job offer, which can depend on the check. Amendments to the law took effect July 1, 2026 for employers with 15 or more employees and take effect January 1, 2027 for smaller ones.', src: ['wa-ag'] },
  ],
  placesNote: { text: 'These are examples, not a full list, and each law has exceptions. Rules differ by state and city, and state laws can add protections, so check your state\'s civil rights or labor agency. This page describes the rules; for advice about your own case, ask a legal aid group or a lawyer.', src: ['cfpb-bg', 'ca-crd', 'nyc-cchr', 'wa-ag'] },
  eeoc: { text: 'In October 2026 the EEOC withdrew its 2012 guidance on how employers may use arrest and conviction records. It says Title VII still forbids discrimination based on race or national origin, including job requirements that are a stand-in for intentional discrimination.', src: ['eeoc-rescind'] },
  same: { text: 'An employer that asks about backgrounds must treat you the same as anyone else, whatever your race, national origin, color, sex, religion, disability, genetic information or age (40 or older). Rejecting applicants of one ethnicity with criminal records, but not others with the same records, is illegal. Complaints go to the EEOC.', src: ['eeoc-bg'] },
}

// 3. Background checks and your rights.
export const checks = {
  intro: { text: 'Under the Fair Credit Reporting Act, an employer that uses a background screening company must follow these steps. A report can include criminal records from public files.', src: ['cfpb-bg', 'fcra-1681b'] },
  steps: [
    { step: 'You are told first', text: 'The employer must tell you in writing, in a document that is only that notice, that it may get a report on you.', src: ['fcra-1681b', 'cfpb-bg'] },
    { step: 'You give written permission', text: 'You do not have to agree, but the employer may then reject your application. Ask which screening company it uses when you sign. Some trucking jobs can take permission by phone or online.', src: ['eeoc-bg', 'cfpb-bg'] },
    { step: 'Before a no, you see the report', text: 'If the employer might not hire you because of the report, it must first give you a copy and "A Summary of Your Rights under the Fair Credit Reporting Act".', src: ['fcra-1681b', 'cfpb-bg'] },
    { step: 'After a no, you get a notice', text: 'It names the company that supplied the report, says that company did not make the decision, and says you can dispute the report and get another free copy if you ask within 60 days.', src: ['cfpb-bg'] },
  ],
  sevenYears: { text: 'Under federal law, a report generally cannot include an arrest more than seven years old, or older than the statute of limitations if that is longer. Convictions can be reported however old they are, and the seven-year limit does not apply to a job paying $75,000 a year or more.', src: ['fcra-1681c'] },
  ownCopy: { text: 'To know what an employer may see, the CFPB suggests getting your own background screening report and checking it for errors.', src: ['cfpb-bg'] },
  dispute: [
    { name: 'Write to the screening company', text: 'Say what is wrong, send copies of court papers, never originals. An arrest older than seven years is one example of what to dispute.', src: ['cfpb-bg'] },
    { name: 'Tell the employer too', text: 'Let the employer know about the mistake. If the report is wrong, the screening company must fix it and send the corrected report to the employer.', src: ['eeoc-bg', 'cfpb-bg'] },
    { name: 'Wait for the answer', text: 'The company generally has 30 days to investigate, 15 more in some cases, then 5 business days to tell you the result.', src: ['cfpb-bg'] },
    { name: 'If it is not fixed', text: 'Complain to the CFPB or the FTC. You can also file a lawsuit.', src: ['cfpb-bg'] },
  ],
}

// 4. Talking about a record.
export const talking = {
  intro: { text: 'Advice from Idaho\'s Department of Labor guide for people leaving prison.', src: ['idaho-reentry'] },
  items: [
    { name: 'Answer the question that is asked', text: 'Applications are legal documents. Some ask only about felonies, some about every conviction, and many only about a set period, such as the last 7 years.', src: ['idaho-reentry'] },
    { name: 'Do not leave it blank', text: 'If you are unsure how to answer, the guide suggests writing "Will discuss in interview."', src: ['idaho-reentry'] },
    { name: 'Keep it brief and factual', text: 'Give a short summary of the conviction, without the details of the offense.', src: ['idaho-reentry'] },
    { name: 'Talk about what has changed', text: 'Bring proof: programs finished, training, letters and references.', src: ['idaho-reentry'] },
    { name: 'Take responsibility', text: 'Do not make excuses or blame others.', src: ['idaho-reentry'] },
    { name: 'Practice what you will say', text: 'Knowing your words ahead makes it easier for you and for the employer.', src: ['idaho-reentry'] },
  ],
  where: { text: 'Where a fair-chance law applies, the employer cannot ask until after a job offer, so the conversation comes later.', src: ['cfr-920', 'ca-crd', 'nyc-cchr'] },
}
export const peopleTalk = [
  { text: 'People in these discussions say to keep the answer short and leave out the details of the case.', src: ['r-1supn9i', 'r-1vh9a28', 'r-1kf0pig'], firstHand: true },
  { text: 'Their results vary: some were hired after telling the employer up front, others had an offer withdrawn after the background check.', src: ['r-1supn9i', 'r-1u7haw7'], firstHand: true },
]

// 5. Clearing or sealing a record.
export const clearing = {
  vary: { text: 'Each state sets its own rules for clearing, sealing or expunging records. The Clean Slate Clearinghouse lets you look up your state\'s rules and compare states.', src: ['clean-slate'] },
  auto: { text: 'Some states clear certain records automatically. In Pennsylvania, for example, eligible records are shielded from public view once a person has gone a set time without a conviction and has met every court-ordered obligation; the courts began this in June 2019. Other cases there still take a petition to the court, for limited access or for expungement.', src: ['pa-clean-slate'] },
  steps: { text: 'Correcting a background report can mean getting or correcting records at each court that holds one, sometimes in more than one state, and the CFPB says help from a lawyer may be necessary.', src: ['cfpb-bg'] },
  free: { text: 'Before you pay anyone, look at legal aid: groups funded by the Legal Services Corporation handle civil legal problems for people with low incomes, and the Clearinghouse lists lawyers by state.', src: ['lsc', 'clean-slate'] },
}

// 6. What helps an employer say yes: the Federal Bonding Program and WOTC.
export const bonding = {
  what: { text: 'The Department of Labor\'s Federal Bonding Program gives employers a free fidelity bond for people with barriers to employment, including people with records. It covers the first six months of a job, at no cost to you or the employer.', src: ['dol-recruit', 'fbp-faq'] },
  items: [
    { name: 'From $5,000 to $25,000', text: 'Bond amounts, with no deductible.', src: ['fbp-faq'] },
    { name: 'Once you have an offer', text: 'A bond can be issued as soon as you have a job offer with a start date. It starts on your first day and ends by itself after six months.', src: ['fbp-faq'] },
    { name: 'Any job, any state', text: 'For employees paid wages with federal taxes taken out. Self-employed people do not qualify.', src: ['fbp-faq'] },
    { name: 'What it covers', text: 'Theft, forgery and embezzlement by the employee. It is not a bail or court bond.', src: ['fbp-faq'] },
  ],
  ask: { text: 'Ask your state\'s bonding coordinator; the program says most bonds can be arranged by phone.', src: ['fbp-seekers'] },
  wotc: { text: 'The Work Opportunity Tax Credit gave employers generally up to $2,400 for hiring someone within a year of a felony conviction or release from prison. As of November 2026, the IRS and Labor Department pages say it covers people who began work on or before December 31, 2025, and name no renewal.', src: ['irs-wotc', 'dol-wotc'] },
}

// 7. Licenses and jobs with extra checks.
export const licenses = {
  intro: { text: 'Some state licenses weigh criminal records, and some jobs have checks that fair-chance laws do not change: Washington\'s law, for one, makes exceptions for jobs with unsupervised access to children or vulnerable adults and for law enforcement.', src: ['niccc', 'wa-ag'] },
  ask: { text: 'Before paying for training, ask the state board that issues the license how it treats your record. The Texas Department of Licensing and Regulation, for example, gives a criminal history evaluation letter before you apply, even if you are not in school yet: $10, within 90 days of a complete request.', src: ['tdlr'] },
  niccc: { text: 'The National Inventory of Collateral Consequences of Conviction lists the job and license restrictions in each state. It is information, not legal advice.', src: ['niccc'] },
}

// Scams.
export const scams = [
  { text: '"Don\'t pay for the promise of a job." The FTC says honest employers never charge you to get one.', src: ['ftc-jobscams'] },
  { text: 'Report a job scam at ReportFraud.ftc.gov.', src: ['ftc-jobscams'] },
  { text: 'Look at legal aid and your state\'s record-clearing rules before paying anyone to clear a record.', src: ['lsc', 'clean-slate'] },
]

// FAQ — visible on the page and mirrored in FAQPage JSON-LD (each answer at most three sentences; no "U.S." mid-answer).
export const faq = [
  {
    q: 'Do I have to tell an employer about my record?',
    a: { text: 'Answer honestly when you are asked, and answer the exact question: some ask only about felonies or a set number of years. Employers covered by a fair-chance law cannot ask until after a job offer.', src: ['idaho-reentry', 'cfr-920', 'ca-crd', 'nyc-cchr'] },
  },
  {
    q: 'How far back does a background check go?',
    a: { text: 'Under federal law, an arrest that did not lead to a conviction generally cannot be reported once it is more than seven years old. Convictions can be reported however old they are, and the limit does not apply to jobs paying $75,000 a year or more.', src: ['fcra-1681c'] },
  },
  {
    q: 'Can an employer turn me down because of a background check?',
    a: { text: 'Sometimes it is legal and sometimes it is not. Before acting on a report, the employer must give you a copy and a summary of your rights, then tell you who supplied it and that you can dispute it.', src: ['eeoc-bg', 'cfpb-bg', 'fcra-1681b'] },
  },
  {
    q: 'What if my background check is wrong?',
    a: { text: 'Write to the screening company, send copies of your court papers, and tell the employer. The company generally has 30 days to investigate and must send a corrected report to the employer.', src: ['cfpb-bg', 'eeoc-bg'] },
  },
  {
    q: 'Can I get my record cleared?',
    a: { text: 'It depends on your state and the record. The Clean Slate Clearinghouse shows each state\'s rules and lists lawyers, and the Legal Services Corporation\'s finder lists legal aid groups near you.', src: ['clean-slate', 'lsc'] },
  },
  {
    q: 'What is the Federal Bonding Program?',
    a: { text: 'A free bond, from $5,000 to $25,000, that protects your employer against employee theft during your first six months. Neither you nor the employer pays; it can be issued once you have a job offer with a start date, through your state\'s bonding coordinator or workforce office.', src: ['fbp-faq', 'fbp-seekers'] },
  },
]

// ── Listings: none. Seen's own rows carry no reliable fair-chance signal a title search can read (titles containing
// "fair chance", "second chance", "reentry" or "re-entry" returned 0 active rows on 2026-11-17; the employer's statement
// lives in the posting text), so the template shows no "Hiring now" block and the first row sends people to job search.
export const listings = null

// ── The page's openable rows (components/start/Guide.tsx `Blocks` renders each block type) ─────────────────────────
export const menu = [
  {
    id: 'find-work', title: 'Finding work', summary: 'Where people find jobs, and who helps',
    blocks: [
      { type: 'text', entry: findWork.search },
      { type: 'text', entry: findWork.roles },
      { type: 'text', entry: findWork.first },
      { type: 'notes', items: peopleWork },
      { type: 'checklist', items: findWork.help },
      { type: 'more', title: 'An employer that says it hires people with records', blocks: [{ type: 'text', entry: findWork.employer }] },
      { type: 'resumeLink', before: 'Before you apply, you can', label: 'check your résumé against a posting' },
    ],
  },
  {
    id: 'when-asked', title: 'When employers can ask', summary: 'Fair-chance rules: federal, state, city',
    blocks: [
      { type: 'heading', text: 'Federal jobs and federal contractors' },
      { type: 'text', entry: whenAsk.federal },
      { type: 'text', entry: whenAsk.federalExceptions },
      { type: 'text', entry: whenAsk.contractors },
      { type: 'heading', text: 'Some state and city laws' },
      { type: 'checklist', items: whenAsk.places },
      { type: 'note', entry: whenAsk.placesNote },
      { type: 'more', title: 'Discrimination rules', blocks: [
        { type: 'text', entry: whenAsk.same },
        { type: 'text', entry: whenAsk.eeoc },
      ] },
    ],
  },
  {
    id: 'background-checks', title: 'Background checks and your rights', summary: 'Permission, notices, old records, errors',
    blocks: [
      { type: 'text', entry: checks.intro },
      { type: 'steps', items: checks.steps },
      { type: 'callout', entry: checks.sevenYears },
      { type: 'heading', text: 'If the report is wrong' },
      { type: 'text', entry: checks.ownCopy },
      { type: 'checklist', items: checks.dispute },
    ],
  },
  {
    id: 'talking', title: 'Talking about your record', summary: 'Short, honest, about what has changed',
    blocks: [
      { type: 'text', entry: talking.intro },
      { type: 'checklist', items: talking.items, cols: true },
      { type: 'note', entry: talking.where },
      { type: 'text', plain: 'What people who have been through it say. More than one account agrees on each of these.' },
      { type: 'notes', items: peopleTalk },
    ],
  },
  {
    id: 'clearing', title: 'Clearing or sealing a record', summary: 'Rules differ by state; where to get help',
    blocks: [
      { type: 'text', entry: clearing.vary },
      { type: 'text', entry: clearing.auto },
      { type: 'text', entry: clearing.steps },
      { type: 'callout', entry: clearing.free },
    ],
  },
  {
    id: 'bonding', title: 'Free bonding and tax credits', summary: 'What can help an employer say yes',
    blocks: [
      { type: 'text', entry: bonding.what },
      { type: 'checklist', items: bonding.items, cols: true },
      { type: 'text', entry: bonding.ask },
      { type: 'note', entry: bonding.wotc },
    ],
  },
  {
    id: 'licenses-scams', title: 'Licenses and scams', summary: 'Check the license board; never pay for a job',
    icon: 'caution',
    blocks: [
      { type: 'text', entry: licenses.intro },
      { type: 'text', entry: licenses.ask },
      { type: 'text', entry: licenses.niccc },
      { type: 'notes', label: 'Scams', items: scams, icon: 'x', caution: true },
    ],
  },
  { id: 'questions', title: 'Common questions', summary: 'Telling, old records, errors, clearing', blocks: [{ type: 'faq', items: faq }] },
]

// ── Additional resources: every reference above, as plain grouped links (no numbers, closed by default) ────────────
export const resourcesSummary = 'Your rights, legal help, fair-chance laws'
export const resources = [
  { title: 'Your rights in a background check', items: [
    { key: 'cfpb-bg', name: 'Background screening reports (CFPB)' },
    { key: 'eeoc-bg', name: 'Background checks: what applicants should know (EEOC and FTC)' },
    { key: 'fcra-1681b', name: 'Fair Credit Reporting Act: reports for employment' },
    { key: 'fcra-1681c', name: 'Fair Credit Reporting Act: what reports may not include' },
    { key: 'eeoc-rescind', name: 'EEOC withdraws its arrest and conviction guidance' },
  ] },
  { title: 'Legal help and record clearing', items: [
    { key: 'lsc', name: 'Find legal aid (Legal Services Corporation)' },
    { key: 'clean-slate', name: 'Record clearing rules by state (Clean Slate Clearinghouse)' },
    { key: 'pa-clean-slate', name: 'Clean Slate in Pennsylvania (Dauphin County courts)' },
  ] },
  { title: 'Fair-chance laws', items: [
    { key: 'cfr-920', name: 'Federal jobs: criminal history after a conditional offer' },
    { key: 'usc-4714', name: 'Federal contractors: criminal history after a conditional offer' },
    { key: 'ca-crd', name: 'California Fair Chance Act' },
    { key: 'nyc-cchr', name: 'New York City Fair Chance Act' },
    { key: 'wa-ag', name: 'Washington Fair Chance Act' },
  ] },
  { title: 'Finding work', items: [
    { key: 'idaho-reentry', name: 'Reentry job guide (Idaho Department of Labor)' },
    { key: 'fbp-seekers', name: 'Federal Bonding Program for job seekers' },
    { key: 'fbp-faq', name: 'Federal Bonding Program questions' },
    { key: 'dol-recruit', name: 'Bonding and tax credits for employers (Department of Labor)' },
    { key: 'irs-wotc', name: 'Work Opportunity Tax Credit (IRS)' },
    { key: 'dol-wotc', name: 'Work Opportunity Tax Credit (Department of Labor)' },
    { key: 'jpmc', name: 'Second chance hiring at JPMorganChase' },
  ] },
  { title: 'Licenses and scams', items: [
    { key: 'tdlr', name: 'Criminal history evaluation letter (Texas licensing)' },
    { key: 'niccc', name: 'Job and license restrictions by state (NICCC)' },
    { key: 'ftc-jobscams', name: 'Job scams (Federal Trade Commission)' },
  ] },
  { title: 'Community discussions', items: [
    { key: 'r-1supn9i', name: 'Telling an employer in an interview' },
    { key: 'r-1vh9a28', name: 'Answering interview questions about a record' },
    { key: 'r-1kf0pig', name: 'Getting ready for an interview' },
    { key: 'r-1u7haw7', name: 'Being upfront about pending charges' },
  ] },
]

/** Every fact on the page, in reading order: the hero, then each menu row. */
export function pageEntries() {
  return [guide.answer, ...tiles, ...blockEntries(menu)]
}
