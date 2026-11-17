// /start/starbucks — "Getting hired at Starbucks". A COMPANY guide: the page renders from this module only, so every
// figure on it carries a reference and an as-of date (lib/start/guides.test.mjs fails on a figure without one).
//
// THE ONLY BASIS FOR FACTS is the research file compiled 2026-11-17 (session scratchpad guides20/starbucks/research.md).
// Rules this module keeps:
//   • only items the research marked VERIFIED: Starbucks' own careers pages (careers.starbucks.com), its benefits site
//     (starbucksbenefits.com), its own postings on its Career Hub (apply.starbucks.com, read 2026-11-17 through the
//     hub's public search, which its robots.txt allows; every pay figure is the posting's own pay-range field), its
//     Form 10-K for fiscal 2026 (filed 2026-11-12), its dress code and interview planner, ASU's own SCAP FAQ, Target's
//     own careers page, the union's own site, and the FTC;
//   • pay only where Starbucks states it on a posting, with the place; never a board estimate, never the union's
//     figures (its "$15.25 or $16/hr in 43 states" line is the union's characterisation, so it is not printed);
//   • the union is stated only as each side states it, with dates: Starbucks' 10-K and benefits site, Workers
//     United's own pages. No claims about outcomes neither page states; no NLRB case detail, no lawsuits;
//   • licensed coffeehouses: the 10-K says licensees run them and their staff are licensee employees; ASU says the
//     college plan is for people employed by a Starbucks-owned business; Target's own page lists the barista job as a
//     Target store job. No airport or grocery operator is named (no primary page read for one);
//   • FIRST-HAND items only as `firstHand: true`, each backed by two or more discussions that agree;
//   • nothing UNVERIFIED or CONFLICTING: no minimum age, no "140+ degrees" (Starbucks' benefits overview says 140+,
//     its education page, benefits site and ASU say 180+), no background-check policy, no schedule-posting lead time,
//     no coffeehouse-coach pay (no open posting found), no shift-manager pay, no store counts by state;
//   • `listings = null`: on 2026-11-17 Seen held 19 active Starbucks rows (17 barista, 1 shift supervisor, 0 store
//     manager, 0 roasting or distribution), against thousands on Starbucks' own hub, and 22 more "Starbucks" titles
//     posted by licensees (Kroger, Target, Ralphs, Albertsons, Macy's, Gopuff, comstock) that the filters cannot label
//     per row. So the page shows no listings block and sends people to the Career Hub (the "Where to apply" row);
//   • no hype, no guarantees, no exclamation marks.
//
// Shape: `sources` (every reference behind the page, NEVER printed as citations — readers reach the links through the
// grouped "Additional resources" row, `resources` below), entries `{ text, src, firstHand? }`, `listings` (null here)
// and the openable menu rows (`menu`, rendered by components/start/Guide.tsx). Pure data; relative imports only so
// `node --test` runs it as is.

import { blockEntries } from './entries.js'

/** @typedef {{ label: string, url: string, date: string, note?: string }} Source */

const HUB = 'https://apply.starbucks.com/careers'

/** @type {Record<string, Source>} */
export const sources = {
  'sb-hub': { label: 'Starbucks Career Hub, job search (search by role and location; job alerts)', url: HUB, date: '2026-11-17', note: 'read' },
  'sb-coffeehouses': { label: 'Starbucks Careers, Coffeehouses: barista, shift supervisor, coffeehouse coach, store manager; flexible scheduling; training', url: 'https://careers.starbucks.com/discover-opportunities/coffeehouses/', date: '2026-11-17', note: 'read' },
  'sb-hiring': { label: 'Starbucks Careers, Hiring Process', url: 'https://careers.starbucks.com/discover-opportunities/hiring-process/', date: '2026-11-17', note: 'read' },
  'sb-faq': { label: 'Starbucks Careers, FAQs & Tips (application process, Applicant Insights, job alerts)', url: 'https://careers.starbucks.com/discover-opportunities/faqs-tips/', date: '2026-11-17', note: 'read' },
  'sb-planner': { label: 'Starbucks, Craft Your Path Planner (interview preparation, PDF)', url: 'https://careers.starbucks.com/uploads/2026/02/Craft-Your-Path-Planner.pdf', date: '2026-02', note: 'published' },
  'sb-dress': { label: 'Starbucks, Dress Code Guidelines for U.S. company-operated coffeehouses (PDF)', url: 'https://careers.starbucks.com/uploads/2025/05/Dress-Code-Guide-US-CO.pdf', date: '2025-05', note: 'published' },
  'sb-mfg': { label: 'Starbucks Careers, Manufacturing & Distribution: the five U.S. plants', url: 'https://careers.starbucks.com/discover-opportunities/manufacturing-distribution/', date: '2026-11-17', note: 'read' },
  'sb-grow': { label: 'Starbucks Careers, Grow With Us (internal promotion)', url: 'https://careers.starbucks.com/culture/grow/', date: '2026-11-17', note: 'read' },
  'sb-perks': { label: 'Starbucks Careers, Benefits & Perks overview', url: 'https://careers.starbucks.com/benefits/', date: '2026-11-17', note: 'read' },
  'sb-health': { label: 'Starbucks Careers, Health & Well-being (parental leave, mental health)', url: 'https://careers.starbucks.com/benefits/health-and-wellbeing/', date: '2026-11-17', note: 'read' },
  'sb-financial': { label: 'Starbucks Careers, Financial Support (401(k) match, Bean Stock)', url: 'https://careers.starbucks.com/benefits/financial-support/', date: '2026-11-17', note: 'read' },
  'sb-education': { label: 'Starbucks Careers, Education (Starbucks College Achievement Plan)', url: 'https://careers.starbucks.com/benefits/education/', date: '2026-11-17', note: 'read' },
  'sb-elig': { label: 'Starbucks Partner Benefits, Benefits Eligibility (U.S.)', url: 'https://www.starbucksbenefits.com/en-us/home/resources/eligibility/', date: '2026-11-17', note: 'read' },
  'sb-scap': { label: 'Starbucks Partner Benefits, Starbucks College Achievement Plan', url: 'https://www.starbucksbenefits.com/en-us/home/education-opportunity/starbucks-college-achievement-plan/', date: '2026-11-17', note: 'read' },
  'asu-scap': { label: 'Arizona State University, Starbucks College Achievement Plan FAQ', url: 'https://starbucks.asu.edu/faq', date: '2026-11-17', note: 'read' },
  // Starbucks' own postings, read 2026-11-17 on its Career Hub (posting ID, place, posted date). Pay = the posting's own
  // pay-range field. Each link opens the hub's search for that role.
  'post-barista': {
    label: 'Starbucks barista postings: 260064076 Tempe AZ (posted 2026-08-29), 260077661 Tempe AZ, 260062374 and 260064480 Houston TX, 260068453 Munster IN, 260074965 Woodridge IL, 260077917 and 260080237 Columbus/Etna OH, 260067686 and 260083122 Atlanta/Dunwoody GA, 260064488 and 260074121 New York NY, 260076587 Los Angeles CA, 260063209 Glendora CA, 260069716 Redmond WA, 260063318 Everett WA. Read on the Career Hub',
    url: 'https://apply.starbucks.com/careers?query=Barista',
    date: '2026-11-17', note: 'read',
  },
  'post-ssv': {
    label: 'Starbucks shift supervisor postings: 260079852 Peoria AZ, 260068320 Houston TX, 260072624 Atlanta GA, 260070885 Lynnwood WA, 260073679 Astoria NY, 260076319 Los Angeles CA. Read on the Career Hub',
    url: 'https://apply.starbucks.com/careers?query=Shift%20Supervisor',
    date: '2026-11-17', note: 'read',
  },
  'post-sm': {
    label: 'Starbucks store manager postings: 260089062 Surprise AZ (posted 2026-11-16), 260088813 Sugar Land TX, 260089389 Atlanta GA, 260089332 Passaic County NJ, 260088214 Inglewood CA. Read on the Career Hub',
    url: 'https://apply.starbucks.com/careers?job_function=Store%20Manager',
    date: '2026-11-17', note: 'read',
  },
  'post-plant': {
    label: 'Starbucks plant postings: 260088746 picker/forklift operator Minden NV, 260088000 materials specialist York PA, 260079232 manufacturing technician York PA, 260081652 manufacturing technician Minden NV, 260086042 maintenance mechanic Augusta GA, 260084436 maintenance mechanic Gaston SC, 260027666 maintenance mechanic York PA. Read on the Career Hub',
    url: 'https://apply.starbucks.com/careers?job_category=manufacturing%20and%20distribution',
    date: '2026-11-17', note: 'read',
  },
  'post-roastery': {
    label: 'Starbucks Reserve Roastery postings, Chicago and New York (barista, baker, operations lead), Career Hub search',
    url: 'https://apply.starbucks.com/careers?query=Roastery',
    date: '2026-11-17', note: 'read',
  },
  'sb-10k': {
    label: 'Starbucks Corporation Form 10-K for fiscal year 2026, ended September 27, 2026 (SEC EDGAR)',
    url: 'https://www.sec.gov/Archives/edgar/data/829224/000082922426000162/sbux-20260927.htm',
    date: '2026-11-12', note: 'filed',
  },
  'target-barista': { label: 'Target careers, Starbucks Barista (a Target store hourly role)', url: 'https://corporate.target.com/careers/career-areas/stores/hourly/starbucks-barista', date: '2026-11-17', note: 'read' },
  'wu-home': { label: 'Starbucks Workers United (the union), home page', url: 'https://sbworkersunited.org/', date: '2026-11-17', note: 'read' },
  'wu-bargaining': { label: 'Starbucks Workers United, "What We’re Fighting For: Updates on Contract Bargaining"', url: 'https://sbworkersunited.org/what-were-fighting-for-updates-on-contract-bargaining/', date: '2026-03-24', note: 'published' },
  'ftc-jobs': { label: 'Federal Trade Commission, Job Scams', url: 'https://consumer.ftc.gov/articles/job-scams', date: '2023-03', note: 'published' },
  'ftc-text': { label: 'Federal Trade Commission consumer alert, That job offer text is probably a scam', url: 'https://www.consumer.ftc.gov/consumer-alerts/2026/04/job-offer-text-probably-scam', date: '2026-04-30', note: 'published' },
  // First-hand accounts (r/starbucks, read through the Arctic Shift archive). Used only where two or more agree, and
  // rendered as what people say.
  'r-1vl1b8e': { label: 'r/starbucks, "Interview tips/help"', url: 'https://www.reddit.com/r/starbucks/comments/1vl1b8e/', date: '2026-08-10', note: 'thread' },
  'r-1ubemcl': { label: 'r/starbucks, "i need tips for interview on tuesday"', url: 'https://www.reddit.com/r/starbucks/comments/1ubemcl/', date: '2026-06-21', note: 'thread' },
  'r-1smnd4z': { label: 'r/starbucks, "Interview tips"', url: 'https://www.reddit.com/r/starbucks/comments/1smnd4z/', date: '2026-04-16', note: 'thread' },
  'r-1txfhjq': { label: 'r/starbucks, "The new barista training system is perplexing"', url: 'https://www.reddit.com/r/starbucks/comments/1txfhjq/', date: '2026-06-05', note: 'thread' },
  'r-1v2dna3': { label: 'r/starbucks, new barista on the Green Apron training', url: 'https://www.reddit.com/r/starbucks/comments/1v2dna3/', date: '2026-07-21', note: 'thread' },
  'r-1xtv5j3': { label: 'r/starbucks, "how it feels to be training as a barista right now"', url: 'https://www.reddit.com/r/starbucks/comments/1xtv5j3/', date: '2026-11-11', note: 'thread' },
  'r-1vnx5ai': { label: 'r/starbucks, "New barista. I’m so nervous about after all my training"', url: 'https://www.reddit.com/r/starbucks/comments/1vnx5ai/', date: '2026-08-14', note: 'thread' },
}

export const guide = {
  path: '/start/starbucks',
  title: 'Getting hired at Starbucks',
  crumbLabel: 'Starbucks',
  eyebrow: 'Company guide',
  // The one-sentence answer under the h1 (no figure: the figures live in the tiles).
  answer: { text: 'Starbucks hires baristas with no experience, at an hourly rate set by where the store is. Most of what sets the job apart, from health coverage to a paid-for online degree, starts once you average enough hours a week, and a licensed Starbucks counter inside another business is that business’s job, not Starbucks’.', src: ['post-barista', 'sb-elig', 'sb-10k'] },
  metaDescription: 'How people get hired at Starbucks: barista, shift supervisor, store manager and roasting-plant jobs, what the postings ask for, the pay Starbucks posts by place, the hours that unlock benefits, the college plan with ASU, licensed stores, unions and how to apply.',
  asOf: '2026-11-17',
}

// The three readings in the hero: each restates a fact below, with the same references.
export const tiles = [
  { label: 'Barista starting pay', value: '$15.25–$20.90', text: 'an hour at the bottom of the range on 16 barista postings read November 17, 2026; Starbucks says new hires typically start there', src: ['post-barista'] },
  { label: 'Hours for benefits', value: '20 a week', text: 'on average, for health coverage, paid parental leave and the college plan', src: ['sb-10k', 'sb-elig'] },
  { label: 'College plan', value: '100% tuition', text: 'paid upfront for a first-time bachelor’s degree online at Arizona State University', src: ['sb-scap', 'asu-scap'] },
]

// 1. The jobs, by family (Starbucks' own titles), with what the postings ask and the pay they state.
export const roles = [
  {
    name: 'Barista', aka: 'Company-operated coffeehouses',
    body: { text: 'Takes orders, makes drinks and food to recipe, handles cash and helps keep the store safe. All 16 barista postings we read say "No previous experience required" and ask for flexible hours that may include early mornings, evenings, weekends, nights and holidays.', src: ['post-barista', 'sb-coffeehouses'] },
    chips: [{ text: 'From $15.25/hr in Arizona, Texas, Indiana', src: ['post-barista'] }, { text: 'No experience asked', src: ['post-barista'] }],
  },
  {
    name: 'Shift supervisor', aka: 'Runs shifts and leads the team',
    body: { text: 'Every shift supervisor posting we read asks for 6 months of work serving customers and 6 months of delegating tasks or coordinating two or more people. Starbucks counts shift supervisors as full-time for benefits.', src: ['post-ssv', 'sb-elig'] },
    chips: [{ text: '$19.37–$21.99/hr in Houston, TX', src: ['post-ssv'] }],
  },
  {
    name: 'Coffeehouse coach', aka: 'A newer leadership role',
    body: { text: 'Coaches baristas and supports the store’s operations. Starbucks’ annual report says it introduced the role in fiscal 2026 to give partners a step up into leadership. We found no coach posting open on November 17, 2026.', src: ['sb-coffeehouses', 'sb-10k', 'sb-hub'] },
    chips: [],
  },
  {
    name: 'Store manager', aka: 'Experienced hires and promotions',
    body: { text: 'Runs the coffeehouse. The postings ask for 3 years of retail or customer service management or 4 or more years of U.S. military service, a high school diploma or GED, and full-time work that "regularly demands in excess of 40 hours per week."', src: ['post-sm'] },
    chips: [{ text: '$58,800–$82,300 a year in Sugar Land, TX', src: ['post-sm'] }],
  },
  {
    name: 'Roasting plant and distribution', aka: 'Kent WA, Augusta GA, Gaston SC, York PA, Carson Valley NV',
    body: { text: 'Starbucks lists five U.S. manufacturing and distribution centers. A York manufacturing technician posting asks for a year in production or distribution, a year on packaging equipment, and a high school diploma, GED or 4 years of U.S. military service; a Minden picker and forklift job asks for a diploma or GED and a year in a plant or warehouse.', src: ['sb-mfg', 'post-plant'] },
    chips: [{ text: '$20.30–$27.80/hr picker, Minden, NV', src: ['post-plant'] }],
  },
  {
    name: 'Reserve Roastery', aka: 'Chicago and New York',
    body: { text: 'The two Roasteries post their own barista, baker and operations lead jobs. Starbucks’ annual report says it is simplifying how its Reserve and Roastery locations run.', src: ['post-roastery', 'sb-10k'] },
    chips: [],
  },
]

export const growth = [
  { text: 'Starbucks says 60% of its store managers started as baristas, and it aims to fill 90% of U.S. retail leadership roles from within.', src: ['sb-grow', 'sb-10k'] },
  { text: 'New hires get "essential training their first month, with more training at 90 and 190 days."', src: ['sb-coffeehouses'] },
  { text: 'In the U.S., Starbucks employed about 221,000 people as of September 27, 2026, about 214,000 of them in company-operated coffeehouses.', src: ['sb-10k'] },
]

// 2. Company-operated or licensed.
export const licensed = {
  intro: { text: 'On September 27, 2026, Starbucks ran 9,974 company-operated coffeehouses in the U.S., and licensees ran 6,804 more.', src: ['sb-10k'] },
  who: { text: 'A licensee runs its coffeehouses itself. Starbucks says most licensees are large retailers, and that licensee employees follow its operating procedures and take training similar to its own staff. They are the licensee’s employees, not Starbucks’.', src: ['sb-10k'] },
  example: { text: 'Target, for example, lists "Starbucks Barista" among its own store jobs. You apply through Target and work for Target.', src: ['target-barista'] },
  college: { text: 'Starbucks’ college plan is only for people employed by a Starbucks-owned business in the U.S., so a licensed-store job does not open it.', src: ['asu-scap'] },
}

// 3. Pay Starbucks states on its own postings (the posting's pay-range field), by role and place.
export const payRows = [
  { role: 'Barista', place: 'Tempe, AZ · Houston, TX · Munster, IN', pay: '$15.25–$17.31/hr', src: ['post-barista'] },
  { role: 'Barista', place: 'Woodridge, IL · Columbus, OH', pay: '$15.75–$17.88/hr', src: ['post-barista'] },
  { role: 'Barista', place: 'Atlanta, GA', pay: '$16.00–$18.16/hr', src: ['post-barista'] },
  { role: 'Barista', place: 'New York, NY', pay: '$17.75–$20.15/hr', src: ['post-barista'] },
  { role: 'Barista', place: 'Los Angeles, CA', pay: '$20.25–$22.99/hr', src: ['post-barista'] },
  { role: 'Barista', place: 'Everett, WA', pay: '$20.90–$23.72/hr', src: ['post-barista'] },
  { role: 'Shift supervisor', place: 'Houston, TX · Peoria, AZ', pay: '$19.37–$21.99/hr', src: ['post-ssv'] },
  { role: 'Shift supervisor', place: 'New York, NY', pay: '$22.54–$25.59/hr', src: ['post-ssv'] },
  { role: 'Shift supervisor', place: 'Los Angeles, CA', pay: '$25.72–$29.19/hr', src: ['post-ssv'] },
  { role: 'Store manager', place: 'Sugar Land, TX', pay: '$58,800–$82,300 a year', src: ['post-sm'] },
  { role: 'Store manager', place: 'Atlanta, GA · Surprise, AZ', pay: '$60,000–$84,000 a year', src: ['post-sm'] },
  { role: 'Store manager', place: 'Inglewood, CA', pay: '$72,000–$100,800 a year', src: ['post-sm'] },
  { role: 'Picker / forklift operator', place: 'Minden, NV', pay: '$20.30–$27.80/hr', src: ['post-plant'] },
  { role: 'Manufacturing technician', place: 'York, PA', pay: '$21.55–$29.40/hr', src: ['post-plant'] },
  { role: 'Maintenance mechanic', place: 'Augusta, GA · Gaston, SC', pay: '$33.00–$45.65/hr', src: ['post-plant'] },
]
export const payNote = { text: 'Ranges as posted, read November 17, 2026. For baristas and shift supervisors Starbucks says "it is typical for new partners to be hired at the entry point of the range," set by location; for store managers, "it is not typical" to be hired at the high end.', src: ['post-barista', 'post-ssv', 'post-sm'] }
export const payExtras = [
  { text: 'Barista and shift supervisor postings add a quarterly bonus opportunity; Starbucks’ annual report says that reward pays up to $1,200 a year when the store meets its goals.', src: ['post-barista', 'sb-10k'] },
  { text: 'They also add extra pay for working one of eight observed holidays, sick time of 1 hour for every 25 or 30 hours worked, and vacation that builds to 40 hours a year (64 in California) after an introductory period.', src: ['post-barista'] },
]

// 4. Benefits: what starts when, and the college plan.
export const elig = {
  intro: { text: 'Starbucks splits its benefits three ways: some from the first day, some after a set time, and the biggest ones once you are "benefits eligible", which turns on your hours.', src: ['sb-elig'] },
  items: [
    { name: 'From day one', text: 'Sick time, free mental health sessions, the food and drink benefit, a free pound of coffee or box of tea each week, 30% off in store, and commuter benefits.', src: ['sb-elig', 'sb-perks'] },
    { name: 'After 90 days', text: 'The 401(k), with a company match up to 5% (age 18 or older), and the discounted stock purchase plan.', src: ['sb-elig', 'sb-financial'] },
    { name: 'Bean Stock', text: 'A yearly stock grant, typically in November, if you were employed by May 1 with no break. More than 240,000 partners received one in fiscal 2026.', src: ['sb-elig', 'sb-10k'] },
    { name: 'Benefits eligible: part-time', text: 'From the first day of the second month after you reach 240 total hours over three full months in a row (U.S. mainland).', src: ['sb-elig'] },
    { name: 'Benefits eligible: full-time', text: 'From the first day of the month after 60 calendar days. Shift supervisors count as full-time here.', src: ['sb-elig'] },
    { name: 'Keeping it', text: 'At least 520 total hours in each six-month period, checked every January 6 and July 6: "it will still be 20 hours per week."', src: ['sb-elig'] },
  ],
  unlocks: { text: 'Being benefits eligible opens medical, dental and vision coverage, disability and life insurance, paid parental leave (up to 18 weeks for birth parents, up to 12 for non-birth parents) and the college plan.', src: ['sb-elig', 'sb-health'] },
}

export const scap = {
  what: { text: 'The Starbucks College Achievement Plan pays 100% of tuition upfront for a first-time bachelor’s degree, online at Arizona State University, with over 180 degree programs to choose from.', src: ['sb-scap', 'sb-education'] },
  items: [
    { name: 'Who qualifies', text: 'Benefits-eligible partners without a bachelor’s degree, employed by a Starbucks-owned business in the U.S.', src: ['asu-scap', 'sb-elig'] },
    { name: 'A FAFSA every year', text: 'The federal student aid form and any documents ASU asks for, done before your first session and each year after, plus steady academic progress.', src: ['asu-scap', 'sb-scap'] },
    { name: 'How it is paid', text: 'An automatic 42% ASU scholarship comes first, then grants, then Starbucks covers the rest of tuition and fees upfront.', src: ['asu-scap'] },
    { name: 'What it does not cover', text: '"Other educational expenses, such as textbooks and laptops, are not covered."', src: ['asu-scap'] },
    { name: 'No strings after', text: 'ASU: "there is no commitment to remain employed with Starbucks after you complete your education."', src: ['asu-scap'] },
    { name: 'If ASU does not admit you yet', text: 'You are offered Pathway to Admission, and Starbucks covers the credit conversion costs.', src: ['asu-scap', 'sb-education'] },
  ],
  start: { text: 'You can start your ASU application before you are benefits eligible; an enrollment coach helps you pick a start date around when you expect to qualify. Veterans who work at Starbucks can also pass the benefit to one family member.', src: ['asu-scap', 'sb-scap'] },
}

// 5. How hiring works, in Starbucks' own words, then what applicants say.
export const apply = {
  hub: { text: 'Starbucks says the best way to search and apply is its Career Hub: search by role and location, apply to as many openings and stores as you like, and set job alerts.', src: ['sb-faq', 'sb-hub'] },
  cycle: { text: 'Hourly coffeehouse postings are refreshed every 90 days, so an alert tells you when a new round opens. Starbucks also says it is "always accepting applications for baristas."', src: ['sb-faq'] },
  steps: [
    { step: 'Apply online with a résumé', text: 'You get an email saying your application arrived. A first job? Starbucks suggests listing any experience that shows your skills.', src: ['sb-hiring', 'sb-faq'] },
    { step: 'Applicant Insights, if your role uses it', text: 'An online questionnaire of about 20 minutes, "not pass/fail", sent by email if you meet the basic requirements. Finish it within seven days or the application stops.', src: ['sb-faq'] },
    { step: 'A call to schedule', text: 'If you are selected, "a recruiter or coffeehouse leader will reach out to schedule next steps."', src: ['sb-hiring'] },
    { step: 'A behavioral interview', text: 'Starbucks’ planner says to prepare short stories in the Situation, Task, Action, Result form on communication, teamwork, problem-solving and leadership, and to send a thank-you note within 48 hours.', src: ['sb-planner', 'sb-hiring'] },
    { step: 'If it is a no', text: 'Starbucks emails you if it stops after the résumé review. It does not give feedback, and you can apply for other jobs.', src: ['sb-faq'] },
  ],
  dress: { text: 'The dress code: a Starbucks apron (two or more are issued free when you are hired), a solid black top, black or khaki bottoms or blue or black denim, and closed shoes that are water resistant; slip-resistant shoes are "strongly encouraged."', src: ['sb-dress'] },
  accommodation: { text: 'Need an accommodation to apply or interview? Starbucks takes requests at applicantaccommodation@starbucks.com.', src: ['sb-faq', 'post-barista'] },
}
export const peopleSay = [
  { step: 'Usually two conversations', text: 'An interview with the store manager, then a shorter one with the district manager, who has the final say.', src: ['r-1vl1b8e', 'r-1ubemcl', 'r-1smnd4z'], firstHand: true },
  { step: 'Customer and team questions', text: 'Expect questions about an upset customer, a busy rush and working with others.', src: ['r-1vl1b8e', 'r-1ubemcl'], firstHand: true },
  { step: 'Training runs for weeks', text: 'Shifts beside a trainer, mixed with practice shifts on your own; people say how much trainer time you get depends on the store.', src: ['r-1txfhjq', 'r-1v2dna3', 'r-1xtv5j3'], firstHand: true },
  { step: 'Months to feel at ease', text: 'People say it takes a few months for the drinks to stick.', src: ['r-1vnx5ai', 'r-1xtv5j3'], firstHand: true },
]

// 6. Unions, as each side states it, with dates.
export const union = [
  { text: 'Starbucks’ annual report (filed November 12, 2026): since September 2021, partners at some company-operated coffeehouses have sought union representation in elections run by the National Labor Relations Board. Unions hold representation rights at about 6% of its U.S. company-operated coffeehouses, and Starbucks is bargaining for first contracts for them.', src: ['sb-10k'] },
  { text: 'The same report says Starbucks has had work stoppages at some coffeehouses.', src: ['sb-10k'] },
  { text: 'Starbucks Workers United, the union, says on its own site that it has won elections at nearly 700 locations and still needs a contract. In March 2026 it wrote that bargaining with the company was set to start in April.', src: ['wu-home', 'wu-bargaining'] },
  { text: 'At stores with a union, or where organizing is underway, Starbucks says changes to pay, benefits or terms may not be made one-sidedly or are subject to bargaining, and its postings say the benefits list can change through collective bargaining.', src: ['sb-elig', 'post-barista'] },
  { text: 'The dress code allows one pin supporting a labor organization.', src: ['sb-dress'] },
]

// 7. Watch out.
export const beforeYouApply = [
  { text: 'Pay is set by place: the same barista job was posted from $15.25 an hour in Texas to $20.90 near Seattle.', src: ['post-barista'] },
  { text: 'Below an average of about 20 hours a week, you keep the day-one perks but not health coverage, paid parental leave or the college plan.', src: ['sb-elig', 'sb-10k'] },
  { text: 'Starbucks closed more company-operated coffeehouses than it opened in the U.S. in fiscal 2026: 293 closed and 220 opened.', src: ['sb-10k'] },
  { text: 'A "Starbucks" job posted by another company is a job with that company, on its pay and benefits.', src: ['sb-10k', 'target-barista'] },
]
export const scams = [
  { text: 'Apply on Starbucks’ own Career Hub, apply.starbucks.com.', src: ['sb-faq', 'sb-hub'] },
  { text: 'A job offer by text, WhatsApp or Telegram you did not expect is probably a scam. The FTC: "Real employers will never contact you that way."', src: ['ftc-text'] },
  { text: '"Honest employers, including the federal government, will never ask you to pay to get a job."', src: ['ftc-jobs'] },
  { text: '"No honest potential employer will ever send you a check to deposit and then tell you to send on part of the money."', src: ['ftc-jobs'] },
]

// FAQ — visible on the page and mirrored in FAQPage JSON-LD.
export const faq = [
  {
    q: 'Do I need experience to work at Starbucks?',
    a: { text: 'Not as a barista. All 16 barista postings we read in November 2026 say "No previous experience required"; they ask for flexible hours that can include early mornings, nights, weekends and holidays.', src: ['post-barista'] },
  },
  {
    q: 'How much does Starbucks pay baristas?',
    a: { text: 'It depends on the store’s location. Postings read in November 2026 started at $15.25 an hour in Arizona and Texas, $17.75 in New York City, $20.25 in Los Angeles and $20.90 in Everett, Washington, and Starbucks says new hires typically start at the bottom of the range.', src: ['post-barista'] },
  },
  {
    q: 'How many hours do I need for Starbucks benefits?',
    a: { text: 'An average of 20 a week. Part-time partners qualify after 240 total hours over three full months in a row, and keep it with 520 hours in each six-month period.', src: ['sb-elig', 'sb-10k'] },
  },
  {
    q: 'Is the Starbucks college plan really free?',
    a: { text: 'Tuition and fees for a first-time bachelor’s degree online at Arizona State University are covered upfront, and you do not have to stay at Starbucks afterwards. You must be benefits eligible and file a FAFSA every year, and books and laptops are not covered.', src: ['asu-scap', 'sb-scap'] },
  },
  {
    q: 'Is the Starbucks inside Target or a grocery store a Starbucks job?',
    a: { text: 'Not if it is a licensed store: licensees employ their own staff, and Target lists its Starbucks barista job as a Target store job. Starbucks’ college plan covers only people employed by a Starbucks-owned business.', src: ['sb-10k', 'target-barista', 'asu-scap'] },
  },
  {
    q: 'Are Starbucks stores unionized?',
    a: { text: 'Some are. Starbucks says unions represent partners at about 6% of its U.S. company-operated coffeehouses and that it is bargaining for first contracts, as of its November 2026 annual report.', src: ['sb-10k'] },
  },
]

// ── Listings: none. On 2026-11-17 Seen held 19 active Starbucks rows (17 barista, 1 shift supervisor, no store manager,
// no roasting or distribution) and 22 "Starbucks" titles posted by licensees the filters cannot label per row, so the
// template shows no "Hiring now" block; the "Where to apply" row sends people to Starbucks' own Career Hub.
export const listings = null

// ── The page's openable rows (components/start/Guide.tsx `Blocks` renders each block type) ─────────────────────────
export const menu = [
  {
    id: 'apply', title: 'Where to apply', summary: 'Starbucks’ own Career Hub, by role and place',
    blocks: [
      { type: 'cards', items: [{ name: 'Starbucks Career Hub', aka: 'Starbucks’ own job search', link: HUB, body: apply.hub }] },
      { type: 'text', entry: apply.cycle },
      { type: 'text', plain: 'For café and restaurant jobs beyond Starbucks, Seen has a separate guide at seenjobs.io/start/restaurants.' },
      { type: 'resumeLink', before: 'Before you apply, you can', label: 'check your résumé against a Starbucks posting' },
    ],
  },
  {
    id: 'jobs', title: 'The jobs and what they ask', summary: 'Barista to store manager, plus the plants',
    blocks: [
      { type: 'cards', items: roles },
      { type: 'more', title: 'Moving up, and training', blocks: [{ type: 'notes', items: growth }] },
    ],
  },
  {
    id: 'licensed', title: 'Starbucks or a licensed store', summary: 'Who you actually work for',
    blocks: [
      { type: 'text', entry: licensed.intro },
      { type: 'text', entry: licensed.who },
      { type: 'callout', entry: licensed.example },
      { type: 'text', entry: licensed.college },
    ],
  },
  {
    id: 'pay', title: 'Pay Starbucks posts', summary: 'Hourly and yearly ranges, by place',
    blocks: [
      { type: 'table', caption: 'Pay stated on Starbucks’ own postings', columns: [{ key: 'role', label: 'Role' }, { key: 'place', label: 'Where' }, { key: 'pay', label: 'Posted range', num: true }], rows: payRows },
      { type: 'note', entry: payNote },
      { type: 'more', title: 'Bonus, holidays, sick time and vacation', blocks: [{ type: 'notes', items: payExtras }] },
    ],
  },
  {
    id: 'benefits', title: 'Benefits and the college plan', summary: 'The hours that unlock them, and ASU',
    blocks: [
      { type: 'text', entry: elig.intro },
      { type: 'checklist', items: elig.items, cols: true },
      { type: 'text', entry: elig.unlocks },
      { type: 'heading', text: 'The college plan with Arizona State University' },
      { type: 'text', entry: scap.what },
      { type: 'checklist', items: scap.items },
      { type: 'text', entry: scap.start },
    ],
  },
  {
    id: 'hiring', title: 'How hiring works', summary: 'Application, questionnaire, interview, training',
    blocks: [
      { type: 'steps', items: apply.steps },
      { type: 'text', plain: 'What people who applied say. More than one account agrees on each of these.' },
      { type: 'steps', items: peopleSay },
      { type: 'more', title: 'What to wear, and accommodations', blocks: [
        { type: 'text', entry: apply.dress },
        { type: 'text', entry: apply.accommodation },
      ] },
    ],
  },
  {
    id: 'watch-out', title: 'Unions, and what to watch', icon: 'caution', summary: 'Union status, hours, closures, scams',
    blocks: [
      { type: 'heading', text: 'Unions at Starbucks' },
      { type: 'notes', items: union },
      { type: 'notesGrid', groups: [
        { label: 'Before you apply', items: beforeYouApply, icon: 'dot' },
        { label: 'Scams', items: scams, icon: 'x' },
      ] },
    ],
  },
  { id: 'questions', title: 'Common questions', summary: 'Experience, pay, hours, college, unions', blocks: [{ type: 'faq', items: faq }] },
]

// ── Additional resources: every reference above, as plain grouped links (no numbers, closed by default) ────────────
export const resourcesSummary = 'Starbucks careers, benefits, public records'
export const resources = [
  { title: 'Starbucks careers', items: [
    { key: 'sb-hub', name: 'Starbucks Career Hub job search' },
    { key: 'post-barista', name: 'Barista openings' },
    { key: 'post-ssv', name: 'Shift supervisor openings' },
    { key: 'post-sm', name: 'Store manager openings' },
    { key: 'post-plant', name: 'Manufacturing and distribution openings' },
    { key: 'post-roastery', name: 'Reserve Roastery openings' },
    { key: 'sb-coffeehouses', name: 'Coffeehouse roles' },
    { key: 'sb-mfg', name: 'Roasting plants and distribution centers' },
    { key: 'sb-hiring', name: 'The hiring process' },
    { key: 'sb-faq', name: 'Application questions and Applicant Insights' },
    { key: 'sb-planner', name: 'Interview planner' },
    { key: 'sb-dress', name: 'Coffeehouse dress code' },
    { key: 'sb-grow', name: 'Growing at Starbucks' },
  ] },
  { title: 'Benefits and the college plan', items: [
    { key: 'sb-perks', name: 'Benefits and perks overview' },
    { key: 'sb-health', name: 'Health, mental health and parental leave' },
    { key: 'sb-financial', name: '401(k), Bean Stock and savings' },
    { key: 'sb-elig', name: 'Who is benefits eligible, and when' },
    { key: 'sb-education', name: 'Going to college through Starbucks' },
    { key: 'sb-scap', name: 'Starbucks College Achievement Plan' },
    { key: 'asu-scap', name: 'The college plan, questions answered (ASU)' },
  ] },
  { title: 'Public records and other employers', items: [
    { key: 'sb-10k', name: 'Starbucks annual report, fiscal 2026 (SEC)' },
    { key: 'target-barista', name: 'Starbucks Barista at Target (Target careers)' },
  ] },
  { title: 'The union', items: [
    { key: 'wu-home', name: 'Starbucks Workers United' },
    { key: 'wu-bargaining', name: 'Contract bargaining update, March 2026' },
  ] },
  { title: 'Job scams', items: [
    { key: 'ftc-jobs', name: 'Job scams (Federal Trade Commission)' },
    { key: 'ftc-text', name: 'Job offer texts (Federal Trade Commission)' },
  ] },
  { title: 'Community discussions', items: [
    { key: 'r-1vl1b8e', name: 'What the barista interview asks' },
    { key: 'r-1ubemcl', name: 'Preparing for a first interview' },
    { key: 'r-1smnd4z', name: 'The second interview' },
    { key: 'r-1txfhjq', name: 'The new barista training' },
    { key: 'r-1v2dna3', name: 'Training shifts and practice shifts' },
    { key: 'r-1xtv5j3', name: 'Training through a holiday launch' },
    { key: 'r-1vnx5ai', name: 'Learning the drinks' },
  ] },
]

/** Every fact on the page, in reading order: the hero, then each menu row. */
export function pageEntries() {
  return [guide.answer, ...tiles, ...blockEntries(menu)]
}
