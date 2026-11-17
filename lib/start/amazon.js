// /start/amazon — "Getting hired at Amazon". A COMPANY guide: the page renders from this module only, so every figure
// on it carries a reference and an as-of date (lib/start/guides.test.mjs fails on a figure without one).
//
// THE ONLY SOURCE OF FACTS is the research file compiled 2026-11-17 (session scratchpad guides20/amazon/research.md,
// with the raw page text, the amazon.jobs posting pull and the OSHA aggregation beside it). Rules this module keeps:
//   • only items the research marked VERIFIED: Amazon's own dated announcements (aboutamazon.com, its press center),
//     Amazon's own postings on amazon.jobs (read through amazon.jobs/en/search.json on 2026-11-17, word for word),
//     Amazon's job FAQ and interview pages, Amazon's own OSHA filings, BLS, the FTC;
//   • hiring.amazon.com (Amazon's hourly-jobs site) answers servers with 403, so nothing is read from it. The hourly
//     application steps come from Amazon's own 2022 hiring guide and are printed as such; the current appointment
//     (people call it the "pre-hire appointment") and the background check are only what several applicants agree on;
//   • pay only where Amazon states it, with the date: the September 2026 floor and average, the October 2026 seasonal
//     average, and the pay line on each amazon.jobs posting. No site pay for plain associate jobs (they live on the
//     site that refuses servers), no DSP pay projection, no 2022 starting-pay figure;
//   • injury rates worked out from Amazon's own OSHA 300A filings (Amazon.com Services LLC, NAICS 493110 and 492110;
//     cross-checked: they reproduce the year-over-year changes Amazon itself published in March 2026), beside the BLS
//     rate for all warehousing in the same year (2024);
//   • Amazon Flex (independent contractors) and Delivery Service Partner drivers (employed by partner companies) are kept
//     apart from Amazon employment, as Amazon's own pages put it;
//   • no lawsuits, no executives, no stock, no Glassdoor / Indeed figures, no hype, no guarantees, no exclamation marks.
//
// Shape: `sources` (never printed as citations — the links reach readers only through "Additional resources"),
// entries `{ text, src: [sourceKey…], firstHand? }`, `listings` (null: see below) and the openable `menu` rows
// (components/start/Guide.tsx). Pure data; relative imports only so `node --test` runs it as is.

import { blockEntries } from './entries.js'

/** @typedef {{ label: string, url: string, date: string, note?: string }} Source */

const HOURLY = 'https://hiring.amazon.com/'
const JOBS = 'https://www.amazon.jobs/'

/** @type {Record<string, Source>} */
export const sources = {
  'amz-pay-2026': {
    label: 'Amazon, "Amazon raises minimum starting pay for full-time core operations employees to $20/hour, with average pay reaching nearly $24/hour…" (aboutamazon.com)',
    url: 'https://www.aboutamazon.com/news/workplace/amazon-raises-minimum-starting-pay-adds-grocery-banking-benefits',
    date: '2026-09-16', note: 'published',
  },
  'amz-holiday-2026': {
    label: 'Amazon press release, "Amazon Creates Over 300,000 New U.S. Jobs This Holiday Season with Increased Pay and Expanded Benefits"',
    url: 'https://press.aboutamazon.com/2026/10/amazon-creates-over-300-000-new-u-s-jobs-this-holiday-season-with-increased-pay-and-expanded-benefits',
    date: '2026-10-20', note: 'published',
  },
  'amz-guide-2022': {
    label: 'Amazon, U.S. guide to hiring refugees at Amazon (Amazon\'s hourly hiring guide: requirements, shift types, application steps), PDF',
    url: 'https://assets.aboutamazon.com/36/7e/e1571dab4b02957104bafad55a2d/us-guide-to-hiring-refugees-at-amazon.pdf',
    date: '2022-09-07', note: 'created',
  },
  'amz-facilities': {
    label: 'Amazon, "Amazon facilities and warehouses" (aboutamazon.com)',
    url: 'https://www.aboutamazon.com/workplace/facilities',
    date: '2026-11-17', note: 'read',
  },
  'aj-faq': {
    label: 'amazon.jobs, FAQ: Application (hourly roles on hiring.amazon.com; applying without a résumé; up to 10 roles at a time)',
    url: 'https://amazon.jobs/content/en/faq/application',
    date: '2026-11-17', note: 'read',
  },
  'amz-drug-2021': {
    label: 'Amazon, "Update on our vision to be Earth\'s Best Employer and Earth\'s Safest Place to Work" (drug screening change)',
    url: 'https://www.aboutamazon.com/news/operations/update-on-our-vision-to-be-earths-best-employer-and-earths-safest-place-to-work',
    date: '2021-06-01', note: 'published',
  },
  // Amazon's own postings on amazon.jobs, read in full 2026-11-17 (the pay line is Amazon's own).
  'post-lfa': { label: 'Amazon posting 10607404, Lead Fulfillment Associate, Los Lunas, NM', url: 'https://www.amazon.jobs/en/jobs/10607404/lead-fulfillment-associate', date: '2026-11-17', note: 'posted' },
  'post-pa': { label: 'Amazon posting 10603519, Process Assistant, Northborough, MA', url: 'https://www.amazon.jobs/en/jobs/10603519/process-assistant', date: '2026-11-12', note: 'posted' },
  'post-pa2': { label: 'Amazon posting 10607214, Process Assistant, Council Bluffs, IA', url: 'https://www.amazon.jobs/en/jobs/10607214/process-assistant', date: '2026-11-17', note: 'posted' },
  'post-am': { label: 'Amazon posting 10606580, Area Manager, Lanham, MD', url: 'https://www.amazon.jobs/en/jobs/10606580/area-manager', date: '2026-11-16', note: 'posted' },
  'post-am-ec': { label: 'Amazon posting 10606710, Area Manager, Early Career (2027), all U.S. openings', url: 'https://www.amazon.jobs/en/jobs/10606710/area-manager-early-career-2027', date: '2026-11-16', note: 'posted' },
  'post-mrt': { label: 'Amazon posting 10601928, Mechatronics & Robotics Tech (RME), Indianapolis, IN', url: 'https://www.amazon.jobs/en/jobs/10601928/mechatronics-robotics-tech', date: '2026-11-10', note: 'posted' },
  'post-mra': { label: 'Amazon posting 10605036, Mechatronic Apprentice I (RME), Phoenix, AZ', url: 'https://www.amazon.jobs/en/jobs/10605036/mechatronic-apprentice-i', date: '2026-11-13', note: 'posted' },
  'post-ta': { label: 'Amazon posting 10605758, Transportation Associate, Teterboro, NJ', url: 'https://www.amazon.jobs/en/jobs/10605758/transportation-associate', date: '2026-11-16', note: 'posted' },
  'amz-cc': {
    label: 'Amazon, "Everything you need to know about Career Choice, Amazon\'s education benefit that pre-pays tuition…" (updated 2025-10-23)',
    url: 'https://www.aboutamazon.com/news/workplace/career-choice-free-education-for-amazon-employees',
    date: '2025-10-23', note: 'updated',
  },
  'aj-lps': {
    label: 'amazon.jobs, Leadership Principles',
    url: 'https://www.amazon.jobs/content/en/our-workplace/leadership-principles',
    date: '2026-11-17', note: 'read',
  },
  'aj-loop': {
    label: 'amazon.jobs, How we hire: Interview loop',
    url: 'https://amazon.jobs/content/en/how-we-hire/interview-loop',
    date: '2026-11-17', note: 'read',
  },
  'aj-how': {
    label: 'amazon.jobs, How We Hire (online application, assessments, phone screening, interview loop)',
    url: 'https://www.amazon.jobs/content/en/how-we-hire',
    date: '2026-11-17', note: 'read',
  },
  'flex-home': {
    label: 'Amazon Flex, home page (earnings line and requirements)',
    url: 'https://flex.amazon.com/',
    date: '2026-11-17', note: 'read',
  },
  'flex-faq': {
    label: 'Amazon Flex, support FAQ (requirements, background check, "As an independent contractor, you are responsible for your own expenses")',
    url: 'https://flex.amazon.com/support/faq',
    date: '2026-11-17', note: 'read',
  },
  'amz-dsp': {
    label: 'Amazon, "Everything you need to know about Amazon\'s Delivery Service Partner (DSP) program" (updated 2024-10-28)',
    url: 'https://www.aboutamazon.com/news/policy-news-views/amazon-dsp-program-update',
    date: '2024-10-28', note: 'updated',
  },
  'osha-ita': {
    label: 'OSHA, Establishment-Specific Injury and Illness Data (Form 300A; establishments filed by Amazon.com Services LLC, NAICS 493110 and 492110, calendar years 2024 and 2025)',
    url: 'https://www.osha.gov/Establishment-Specific-Injury-and-Illness-Data',
    date: '2026-11-14', note: 'downloaded',
  },
  'bls-iag493': {
    label: 'U.S. Bureau of Labor Statistics, Industries at a Glance: Warehousing and Storage, NAICS 493 (2024 injury and illness rates)',
    url: 'https://www.bls.gov/iag/tgs/iag493.htm',
    date: '2026-11-17', note: 'read',
  },
  'amz-safety-2026': {
    label: 'Amazon, "Amazon invests $2.5 billion in workplace safety, reduces workplace injury rates" (full-year 2025 data)',
    url: 'https://www.aboutamazon.com/news/workplace/amazon-workplace-safety-2025-injury-reduction',
    date: '2026-03-12', note: 'published',
  },
  'amz-scams': {
    label: 'Amazon, "The latest scam trends from Amazon US" (employment impersonation scams, entries of April and October 2025)',
    url: 'https://trustworthyshopping.aboutamazon.com/amazon-scam-trends',
    date: '2026-11-17', note: 'read',
  },
  'ftc-text': {
    label: 'Federal Trade Commission consumer alert, "That job offer text is probably a scam"',
    url: 'https://www.consumer.ftc.gov/consumer-alerts/2026/04/job-offer-text-probably-scam',
    date: '2026-04-30', note: 'published',
  },
  // First-hand accounts (r/AmazonFC, read through the Arctic Shift archive). Used only where several threads agree.
  'r-1x51ngm': { label: 'r/AmazonFC, "What should I expect at an Amazon pre-hire appointment / seasonal Delivery Station job?"', url: 'https://www.reddit.com/r/AmazonFC/comments/1x51ngm/', date: '2026-10-13', note: 'thread' },
  'r-1x5i0vn': { label: 'r/AmazonFC, "did swab drug test and finished i9 at the pre hire in person appointment…"', url: 'https://www.reddit.com/r/AmazonFC/comments/1x5i0vn/', date: '2026-10-14', note: 'thread' },
  'r-1xc2fjp': { label: 'r/AmazonFC, "if you\'re wanting to work at amazon and you\'re unsure about the pre-hire appointment"', url: 'https://www.reddit.com/r/AmazonFC/comments/1xc2fjp/', date: '2026-10-21', note: 'thread' },
}

export const guide = {
  path: '/start/amazon',
  title: 'Getting hired at Amazon',
  crumbLabel: 'Amazon',
  eyebrow: 'Guide',
  // The one-sentence answer under the h1 (no figure: the figures live in the tiles).
  answer: { text: 'Amazon\'s warehouse, sort center and delivery station jobs take no résumé: you apply on its hourly jobs site, take a short online test, pick a shift and bring your ID and work documents to a short appointment. The work is physical, on shifts that include nights and weekends, and the drivers of Amazon vans and Amazon Flex drivers are not Amazon employees.', src: ['aj-faq', 'amz-guide-2022', 'post-lfa', 'flex-faq', 'amz-dsp'] },
  metaDescription: 'How people get hired at Amazon: warehouse, sort center, delivery station and seasonal jobs, the pay Amazon states, the application and appointment, Career Choice, moving up to process assistant and area manager, corporate interviews, injury rates, Flex and delivery partners, and job scams.',
  asOf: '2026-11-17',
}

// The three readings in the hero: each restates a fact below, with the same references.
export const tiles = [
  { label: 'Starting pay, full-time', value: '$20/hr', text: 'minimum for Amazon\'s full-time core operations jobs across the U.S., with an average of nearly $24 an hour (Amazon, September 2026)', src: ['amz-pay-2026'] },
  { label: 'Career Choice', value: '$5,250 a year', text: 'prepaid tuition for most hourly employees, full- or part-time, after 90 days', src: ['amz-pay-2026', 'amz-cc'] },
  { label: 'Warehouse injury rate', value: '6.2 vs 4.8', text: 'recordable cases per 100 full-time workers in 2024: Amazon\'s warehouses, from its own OSHA filings, against all U.S. warehousing. Amazon\'s fell to 5.2 in 2025.', src: ['osha-ita', 'bls-iag493'] },
]

// ── 1. Where to apply, the hourly steps, and scams ───────────────────────────────────────────────────────────────
export const apply = {
  hourly: { text: 'Amazon\'s hourly warehouse and fulfillment jobs are listed on hiring.amazon.com, not on its main job site. Amazon says fulfillment associates can apply without a résumé.', src: ['aj-faq'] },
  corporate: { text: 'Corporate and tech jobs, and the operations jobs above the floor (lead associate, process assistant, area manager, maintenance technician), are posted on amazon.jobs. You can apply and interview for up to 10 roles at a time there, and preferred qualifications are not required to apply.', src: ['aj-faq', 'post-lfa', 'post-pa', 'post-am', 'post-mrt'] },
  steps: [
    { step: 'Apply online and pick a shift', text: 'Amazon\'s 2022 hiring guide describes the application as some information about yourself, an online assessment, and choosing your preferred shift. Each hourly listing shows full-time, part-time or flex, seasonal or regular, and the pay.', src: ['amz-guide-2022'] },
    { step: 'Bring your ID and work documents', text: 'The same guide describes a short in-person appointment where you bring proof of identity and of permission to work for Form I-9, and says it is unpaid because it is part of applying.', src: ['amz-guide-2022'] },
    { step: 'Be 18, and expect a drug test', text: 'The guide asks warehouse applicants to be 18 or older and willing to take a pre-employment drug test. Understanding spoken and written directions is enough: "Competency is not fluency."', src: ['amz-guide-2022'] },
  ],
  alerts: { text: 'Amazon sends local job alerts to people who sign up for them at amazon.com/localjobs or by texting NEWJOB to 31432, and says it hires seasonal workers year-round.', src: ['amz-holiday-2026'] },
}
export const peopleSay = [
  { text: 'People hired for warehouse and delivery station jobs this autumn describe applying, taking a short online test about where boxes go, and being sent straight to a pre-hire appointment.', src: ['r-1x51ngm', 'r-1xc2fjp'], firstHand: true },
  { text: 'They describe the appointment as short: show the documents you were asked for, take a mouth-swab drug test yourself, and have your badge photo taken.', src: ['r-1xc2fjp', 'r-1x5i0vn', 'r-1x51ngm'], firstHand: true },
  { text: 'They say a background check runs after it, and the start date is confirmed by email once it and the drug test clear.', src: ['r-1x5i0vn', 'r-1x51ngm', 'r-1xc2fjp'], firstHand: true },
]
export const scams = [
  { text: 'Amazon: "All genuine Amazon job opportunities are posted on our official job board at www.amazon.jobs. If someone approaches you about a job opportunity that asks for payment, it\'s an impersonation scam."', src: ['amz-scams'] },
  { text: 'Amazon says that in 83% of the job-scam cases it was told about in early 2025, the scammer asked for money up front in cryptocurrency or gift cards, or for sensitive personal information.', src: ['amz-scams'] },
  { text: 'A job offer by text you did not sign up for is probably a scam. The FTC: "Real employers will never contact you that way," and "Never pay to get paid or get a job."', src: ['ftc-text'] },
]

// ── 2. The hourly jobs ───────────────────────────────────────────────────────────────────────────────────────────
export const roles = [
  {
    name: 'Fulfillment center associate', aka: 'Pick, pack, stow, ship',
    body: { text: 'Fulfillment centers are where orders are picked, packed and shipped: books, toys and housewares in sortable buildings that can employ more than 1,500 full-time associates, patio furniture and rugs in non-sortable ones. You may work on a mezzanine up to 40 feet high or on a forklift.', src: ['amz-facilities', 'post-lfa'] },
    chips: [{ text: 'No résumé to apply', src: ['aj-faq'] }],
  },
  {
    name: 'Sortation center associate', aka: 'Sort and load',
    body: { text: 'Sortation centers sort orders by where they are going and load them onto trucks, with full- and part-time jobs.', src: ['amz-facilities'] },
    chips: [],
  },
  {
    name: 'Delivery station associate', aka: 'The last stop before delivery',
    body: { text: 'Delivery stations get orders ready for the last mile. Amazon\'s 2022 guide describes the work as receiving trucks, loading conveyor belts, and staging packages for drivers to pick up.', src: ['amz-facilities', 'amz-guide-2022'] },
    chips: [],
  },
  {
    name: 'Seasonal associate', aka: 'Holiday and year-round',
    body: { text: 'Amazon said in October 2026 it was hiring over 300,000 people for seasonal, part-time and full-time jobs for the holidays, that seasonal workers average $20 an hour, and that they can move into full-time jobs.', src: ['amz-holiday-2026'] },
    chips: [{ text: 'Average $20/hr', src: ['amz-holiday-2026'] }],
  },
  {
    name: 'Maintenance technician', aka: 'Reliability Maintenance & Engineering',
    body: { text: 'Maintains the conveyors, robotics and other material handling equipment. The technician posting asks for two or more years of conveyor and controls experience, or Amazon\'s own Mechatronics and Robotics Apprenticeship, which takes people with technical school, a year in Amazon maintenance, or military service.', src: ['post-mrt', 'post-mra'] },
    chips: [{ text: '$31.80–$33.80/hr in Indianapolis', src: ['post-mrt'] }],
  },
  {
    name: 'Transportation associate', aka: 'Yard and trucks',
    body: { text: 'Works with the trucks at a site. If Amazon asks you to get a CDL for the job, it pays for it, and the job then follows Department of Transportation rules, with a DOT physical, a background screening and Amazon\'s drug test.', src: ['post-ta'] },
    chips: [{ text: '$27.55–$29.55/hr in Teterboro, NJ', src: ['post-ta'] }],
  },
]

// ── 3. Pay and benefits Amazon states ────────────────────────────────────────────────────────────────────────────
export const payRows = [
  { role: 'Full-time core operations, minimum', place: 'Nationwide', pay: '$20/hr, average nearly $24 (September 2026)', src: ['amz-pay-2026'] },
  { role: 'Seasonal, average', place: 'Nationwide', pay: '$20/hr (October 2026)', src: ['amz-holiday-2026'] },
  { role: 'Lead Fulfillment Associate', place: 'Los Lunas, NM', pay: '$23.50–$24.50/hr', src: ['post-lfa'] },
  { role: 'Process Assistant', place: 'Council Bluffs, IA', pay: '$24.25–$26.25/hr', src: ['post-pa2'] },
  { role: 'Process Assistant', place: 'Northborough, MA', pay: '$25.50–$28.50/hr', src: ['post-pa'] },
  { role: 'Mechatronic Apprentice I', place: 'Phoenix, AZ', pay: '$27.00–$29.00/hr', src: ['post-mra'] },
  { role: 'Mechatronics & Robotics Tech', place: 'Indianapolis, IN', pay: '$31.80–$33.80/hr', src: ['post-mrt'] },
  { role: 'Transportation Associate', place: 'Teterboro, NJ', pay: '$27.55–$29.55/hr', src: ['post-ta'] },
  { role: 'Area Manager', place: 'Lanham, MD', pay: '$70,000–$90,900 a year, plus sign-on pay and stock units', src: ['post-am'] },
  { role: 'Area Manager, Early Career', place: 'Several sites', pay: '$71,400 a year', src: ['post-am-ec'] },
]
export const payNote = { text: 'Postings from November 2026. Amazon says each hourly figure is the base rate plus the highest shift differential, which applies depending on the shift you choose. It also says pay rises each year for your first three years.', src: ['post-lfa', 'post-pa', 'amz-pay-2026'] }
export const benefits = [
  { text: 'Healthcare from day one for regular full-time employees, with a plan at $5 a week and $5 copays.', src: ['amz-pay-2026'] },
  { text: 'From January 1, 2027, seasonal employees who work at least 30 hours a week get healthcare from their first day, Amazon said in October 2026.', src: ['amz-holiday-2026'] },
  { text: 'A 401(k) with company match, paid parental leave, and 24/7 mental health support.', src: ['amz-pay-2026'] },
  { text: 'Since October 2026, 10% off eligible groceries and essentials on Amazon.com and Whole Foods Market online, and 20% off in Whole Foods Market stores.', src: ['amz-pay-2026'] },
]

// ── 4. What the work is like, and the injury record ──────────────────────────────────────────────────────────────
export const shifts = [
  { kind: 'Part-time', pattern: '3–4 days a week, 4–5 hours a day', src: ['amz-guide-2022'] },
  { kind: 'Full-time', pattern: '4–5 days a week, 8–12 hours a day, usually including one weekend day', src: ['amz-guide-2022'] },
  { kind: 'Flex', pattern: 'Pick your own shifts in an app, as few as 4 hours a week', src: ['amz-guide-2022'] },
]
export const shiftsNote = { text: 'Shift types as Amazon\'s 2022 hiring guide lists them; it adds that most buildings are open 365 days a year and that shift options change with business need.', src: ['amz-guide-2022'] }
export const physical = [
  { name: 'Lifting up to 49 pounds', text: 'And frequent pushing, pulling, squatting, bending and reaching.', src: ['post-lfa'] },
  { name: 'On your feet up to 10–12 hours', text: 'Standing and walking for the whole shift.', src: ['post-lfa'] },
  { name: 'Heights and equipment', text: 'A mezzanine up to 40 feet high, or a forklift or cherry picker.', src: ['post-lfa'] },
  { name: 'Noise and temperature', text: '"Even with climate controls the noise and temperature levels can vary day to day. Hearing protection is available."', src: ['post-lfa'] },
  { name: 'Nights, weekends and holidays', text: 'Postings above the entry level ask for a flexible schedule including weekends, nights and holidays, and overtime as required.', src: ['post-lfa', 'post-pa'] },
]
export const safetyIntro = { text: 'Recordable injuries and illnesses per 100 full-time workers, worked out from the case and hours totals Amazon files with OSHA each year for its own sites, beside the national rate the Bureau of Labor Statistics publishes for all warehousing.', src: ['osha-ita', 'bls-iag493'] }
export const safetyRows = [
  { site: 'Amazon warehouses', rate: '5.2 in 2025, 6.2 in 2024', src: ['osha-ita'] },
  { site: 'Amazon sites filed as courier and delivery work', rate: '4.3 in 2025, 5.3 in 2024', src: ['osha-ita'] },
  { site: 'All U.S. warehousing (federal survey)', rate: '4.8 in 2024', src: ['bls-iag493'] },
]
export const safetyNote = { text: 'Amazon\'s warehouse rate fell from 2024 to 2025 but was above the national warehousing rate in 2024, the latest year the national figure covers. Its 2024 warehouse filings record one death. Amazon says strains and sprains from repetitive motion, awkward postures or heavy lifting are more than half of its recordable injuries.', src: ['osha-ita', 'bls-iag493', 'amz-safety-2026'] }
export const drugTest = { text: 'In 2021 Amazon said it would no longer include marijuana in its drug screening for jobs not regulated by the Department of Transportation, while keeping impairment checks on the job and testing for all drugs and alcohol after any incident.', src: ['amz-drug-2021'] }

// ── 5. Career Choice and moving up ───────────────────────────────────────────────────────────────────────────────
export const careerChoice = {
  what: { text: 'Career Choice prepays tuition of up to $5,250 a year. In the U.S. it is open to most hourly full- and part-time employees after 90 days, for as many years as they stay eligible; Amazon also reimburses books and fees up to a yearly amount.', src: ['amz-pay-2026', 'amz-cc'] },
  items: [
    { name: 'College', text: 'Associate degrees, bachelor\'s degrees and certificate programs, in any field.', src: ['amz-cc'] },
    { name: 'Pathways', text: 'Industry certifications and licences, such as a commercial driver\'s licence or HVAC certifications.', src: ['amz-cc'] },
    { name: 'Foundations', text: 'English classes, high school completion and the GED.', src: ['amz-cc'] },
    { name: 'Coaching', text: 'Career coaching and college advising through Kaplan.', src: ['amz-cc'] },
  ],
  notTied: { text: 'Amazon says more than half of participants want to use it to move up inside Amazon, but they do not have to: some study for jobs Amazon does not have, such as in healthcare.', src: ['amz-cc'] },
}
export const ladder = [
  { step: 'Lead associate', text: 'Production work plus guiding other associates. The Los Lunas posting asks for a high school diploma or equivalent and a year with Microsoft Office, and prefers Career Choice\'s Operations Leadership Certificate.', src: ['post-lfa'] },
  { step: 'Process assistant', text: 'Assigned to an area manager: assigns work, leads meetings, trains associates and tracks attendance, without handling discipline. Same diploma and Office asks; managing people or schooling past high school is preferred.', src: ['post-pa', 'post-pa2'] },
  { step: 'Area manager', text: 'Leads a team of hourly workers. The Lanham posting takes a bachelor\'s degree, or 2 or more years as an Amazon employee, or 6 or more years of military service, plus 2 or more years managing people and their performance.', src: ['post-am'] },
]
export const ladderNotes = [
  { text: 'Area managers straight from college apply to one national posting and are placed by location preference after the interview; they lead 50 to 100 associates, and most work a fixed 4-day week.', src: ['post-am-ec'] },
  { text: 'The Mechatronic Apprentice I posting pays $27.00–$29.00 an hour in Phoenix during 9 weeks of training at an outside provider, asks for a passing score on a mechanical aptitude test, and expects you to relocate after it.', src: ['post-mra'] },
]

// ── 6. Corporate and tech hiring ─────────────────────────────────────────────────────────────────────────────────
export const corporate = {
  lps: { text: 'Amazon evaluates every candidate against its 16 Leadership Principles, from Customer Obsession to Success and Scale Bring Broad Responsibility, mostly through questions about real things you have done.', src: ['aj-lps', 'aj-loop'] },
  items: [
    { name: 'Application, then screening', text: 'An online application, then, depending on the role, assessments and a phone screen.', src: ['aj-how'] },
    { name: 'The interview loop', text: 'Separate interviews with two to seven people, about 45 minutes to an hour each, which may include a Bar Raiser from another team who focuses on hiring quality.', src: ['aj-loop'] },
    { name: 'Stories, not brain teasers', text: 'Amazon suggests the STAR method (situation, task, action, result), but says it is not the only way to answer.', src: ['aj-loop'] },
    { name: 'Sometimes a writing sample', text: 'Some roles ask for one, because Amazon writes narrative memos instead of slide decks.', src: ['aj-loop'] },
    { name: 'An answer within a week', text: '"You can expect to hear from us within five business days."', src: ['aj-loop'] },
  ],
  noReply: { text: 'Amazon also says it cannot personally contact people it is not moving forward with.', src: ['aj-faq'] },
}

// ── 7. Flex and delivery partners: not Amazon employment ─────────────────────────────────────────────────────────
export const drivers = [
  {
    name: 'Amazon Flex', aka: 'App work in your own car',
    link: 'https://flex.amazon.com/',
    body: { text: 'You deliver Amazon packages in your own vehicle through the Flex app, as an independent contractor: "As an independent contractor, you are responsible for your own expenses," including mileage, parking and tolls. You need to be 21 or older with a four-door midsize car or larger, and pass a background check that includes your driving record.', src: ['flex-home', 'flex-faq'] },
    chips: [{ text: 'Amazon says most drivers earn $18–25/hr', src: ['flex-home'] }],
  },
  {
    name: 'Delivery Service Partner driver', aka: 'The Amazon van',
    body: { text: 'Drivers of Amazon-branded vans work for Delivery Service Partners, which Amazon describes as independent businesses that "hire and manage their own employees"; each partner sets its own wages. Amazon\'s 2022 guide says the job needs a valid driver\'s license but not a CDL.', src: ['amz-dsp', 'amz-guide-2022'] },
    chips: [],
  },
]
export const flexNote = { text: 'Amazon\'s Flex page adds that actual earnings vary with location, tips, delivery time and other factors, and that Amazon employees in most states cannot also deliver with Flex.', src: ['flex-home', 'flex-faq'] }

// FAQ — visible on the page and mirrored in FAQPage JSON-LD.
export const faq = [
  {
    q: 'Do I need a résumé or experience for an Amazon warehouse job?',
    a: { text: 'No résumé: Amazon says fulfillment associates can apply without one, and that many of its full-time core operations jobs need no prior experience. You must be at least 18 and allowed to work in the United States.', src: ['aj-faq', 'amz-pay-2026', 'post-lfa'] },
  },
  {
    q: 'How much does Amazon pay warehouse workers?',
    a: { text: 'Amazon said in September 2026 that full-time core operations jobs start at a minimum of $20 an hour across the country, with an average of nearly $24. In October 2026 it said seasonal workers average $20 an hour.', src: ['amz-pay-2026', 'amz-holiday-2026'] },
  },
  {
    q: 'Does Amazon drug test?',
    a: { text: 'Amazon\'s 2022 hiring guide asks warehouse applicants to be willing to take a pre-employment drug test. In 2021 Amazon said marijuana is no longer part of that screen for jobs the Department of Transportation does not regulate, and jobs that do fall under it, such as CDL driving, still take Amazon\'s drug test.', src: ['amz-guide-2022', 'amz-drug-2021', 'post-ta'] },
  },
  {
    q: 'Is Amazon Flex the same as working for Amazon?',
    a: { text: 'No. Flex drivers deliver in their own car through an app as independent contractors and pay their own expenses, such as mileage, parking and tolls. Drivers of Amazon vans work for Delivery Service Partners, independent companies that hire their own staff and set their pay.', src: ['flex-faq', 'amz-dsp'] },
  },
  {
    q: 'What is Amazon Career Choice?',
    a: { text: 'Prepaid tuition of up to $5,250 a year for degrees, certificates, licences such as a CDL, the GED and English classes. Amazon says most hourly full- and part-time employees in the United States qualify after 90 days.', src: ['amz-pay-2026', 'amz-cc'] },
  },
]

// ── Listings: none. Seen's own rows were checked read-only on 2026-11-17 (research §10): of 379 active rows whose
// company contains "amazon", the genuine hourly operations rows were 3 associate postings and about 8 maintenance
// rows, with no area manager or process assistant rows, while about 85 look-alikes sat under the company name
// "Amazon" ("Amazon Warehouse - Shopper / Order Fulfillment Associate $17-$23/hr", "Package Handler $15/ Hour",
// "Amazon Prime Delivery Driver $18-$26/hr") beside 47 "Amazon Flex" rows. Amazon's hourly postings live on
// hiring.amazon.com, which refuses servers. So the template shows no "Hiring now" block, and the first row sends people
// to Amazon's two job sites.
export const listings = null

// ── The page's openable rows (components/start/Guide.tsx `Blocks` renders each block type) ─────────────────────────
export const menu = [
  {
    id: 'apply', title: 'Where to find Amazon\'s jobs', summary: 'Two job sites, the steps, and scams',
    blocks: [
      { type: 'cards', items: [
        { name: 'Hourly jobs', aka: 'Warehouse, sort, delivery station, seasonal', link: HOURLY, body: apply.hourly },
        { name: 'Amazon jobs', aka: 'Corporate, tech, and operations roles above the floor', link: JOBS, body: apply.corporate },
      ] },
      { type: 'heading', text: 'The hourly application' },
      { type: 'steps', items: apply.steps },
      { type: 'text', plain: 'What people hired recently say. More than one account agrees on each of these.' },
      { type: 'notes', items: peopleSay },
      { type: 'note', entry: apply.alerts },
      { type: 'notes', label: 'Scams', items: scams, icon: 'x', caution: true },
      { type: 'resumeLink', before: 'Before you apply for a posted role, you can', label: 'check your résumé against the posting' },
    ],
  },
  {
    id: 'jobs', title: 'Jobs in the buildings', summary: 'Warehouse, sort, delivery, seasonal, upkeep',
    blocks: [{ type: 'cards', items: roles }],
  },
  {
    id: 'pay', title: 'Pay Amazon states', summary: 'Its pay floor, postings and benefits',
    blocks: [
      { type: 'table', caption: 'Pay stated by Amazon, by role', columns: [{ key: 'role', label: 'Role' }, { key: 'place', label: 'Where' }, { key: 'pay', label: 'Stated pay', num: true }], rows: payRows },
      { type: 'note', entry: payNote },
      { type: 'more', title: 'Benefits', blocks: [{ type: 'notes', items: benefits }] },
    ],
  },
  {
    id: 'the-work', title: 'What the work is like', summary: 'Shifts, lifting, injuries, drug tests',
    blocks: [
      { type: 'checklist', items: physical, cols: true },
      { type: 'more', title: 'Shift types', blocks: [
        { type: 'table', caption: 'Hourly shift types in Amazon’s hiring guide', columns: [{ key: 'kind', label: 'Type' }, { key: 'pattern', label: 'Pattern' }], rows: shifts },
        { type: 'text', entry: shiftsNote },
      ] },
      { type: 'heading', text: 'Injury rates' },
      { type: 'text', entry: safetyIntro },
      { type: 'table', caption: 'Recordable injury rates at Amazon sites and in warehousing', columns: [{ key: 'site', label: 'Where' }, { key: 'rate', label: 'Injury rate', num: true }], rows: safetyRows },
      { type: 'note', entry: safetyNote },
      { type: 'heading', text: 'Drug tests' },
      { type: 'text', entry: drugTest },
    ],
  },
  {
    id: 'moving-up', title: 'Career Choice and moving up', summary: 'Paid tuition, then lead, PA, manager',
    blocks: [
      { type: 'text', entry: careerChoice.what },
      { type: 'checklist', items: careerChoice.items },
      { type: 'note', entry: careerChoice.notTied },
      { type: 'heading', text: 'The ladder in the buildings' },
      { type: 'steps', items: ladder },
      { type: 'notes', items: ladderNotes },
    ],
  },
  {
    id: 'corporate', title: 'Corporate and tech jobs', summary: 'Leadership Principles and the loop',
    blocks: [
      { type: 'text', entry: corporate.lps },
      { type: 'checklist', items: corporate.items },
      { type: 'note', entry: corporate.noReply },
      { type: 'text', plain: 'For help desk and other first jobs in tech, see Seen\'s IT guide.' },
    ],
  },
  {
    id: 'drivers', title: 'Flex and delivery drivers', summary: 'Not Amazon jobs: contractors and partners',
    blocks: [
      { type: 'cards', items: drivers },
      { type: 'note', entry: flexNote },
      { type: 'text', plain: 'Driving for a Delivery Service Partner is covered in Seen\'s delivery guide.' },
    ],
  },
  { id: 'questions', title: 'Common questions', summary: 'Résumé, pay, drug tests, Flex, tuition', blocks: [{ type: 'faq', items: faq }] },
]

// ── Additional resources: every reference above, as plain grouped links (no numbers, closed by default) ────────────
export const resourcesSummary = 'Amazon jobs, postings, safety records'
export const resources = [
  { title: 'Amazon jobs and pay', items: [
    { key: 'aj-faq', name: 'Applying at Amazon, questions answered' },
    { key: 'amz-pay-2026', name: 'Amazon pay and benefits announcement, September 2026' },
    { key: 'amz-holiday-2026', name: 'Amazon holiday hiring, October 2026' },
    { key: 'amz-guide-2022', name: 'Amazon hourly hiring guide, 2022' },
    { key: 'amz-facilities', name: 'Amazon building types' },
    { key: 'amz-drug-2021', name: 'Amazon drug screening change, 2021' },
  ] },
  { title: 'Amazon postings', items: [
    { key: 'post-lfa', name: 'Lead Fulfillment Associate, Los Lunas' },
    { key: 'post-pa', name: 'Process Assistant, Northborough' },
    { key: 'post-pa2', name: 'Process Assistant, Council Bluffs' },
    { key: 'post-am', name: 'Area Manager, Lanham' },
    { key: 'post-am-ec', name: 'Area Manager, Early Career' },
    { key: 'post-mrt', name: 'Mechatronics & Robotics Tech, Indianapolis' },
    { key: 'post-mra', name: 'Mechatronic Apprentice I, Phoenix' },
    { key: 'post-ta', name: 'Transportation Associate, Teterboro' },
  ] },
  { title: 'Education and corporate hiring', items: [
    { key: 'amz-cc', name: 'Career Choice explained' },
    { key: 'aj-lps', name: 'Amazon Leadership Principles' },
    { key: 'aj-how', name: 'How Amazon hires' },
    { key: 'aj-loop', name: 'The interview loop' },
  ] },
  { title: 'Flex and delivery partners', items: [
    { key: 'flex-home', name: 'Amazon Flex' },
    { key: 'flex-faq', name: 'Amazon Flex questions answered' },
    { key: 'amz-dsp', name: 'The Delivery Service Partner program' },
  ] },
  { title: 'Safety records', items: [
    { key: 'osha-ita', name: 'Injury and illness data by workplace (OSHA)' },
    { key: 'bls-iag493', name: 'Warehousing injury rate (BLS)' },
    { key: 'amz-safety-2026', name: 'Amazon safety update, March 2026' },
  ] },
  { title: 'Job scams', items: [
    { key: 'amz-scams', name: 'Amazon scam trends' },
    { key: 'ftc-text', name: 'Job offer texts (Federal Trade Commission)' },
  ] },
  { title: 'Community discussions', items: [
    { key: 'r-1x51ngm', name: 'Before a delivery station appointment' },
    { key: 'r-1x5i0vn', name: 'After the appointment' },
    { key: 'r-1xc2fjp', name: 'What the appointment is like' },
  ] },
]

/** Every fact on the page, in reading order: the hero, then each menu row. */
export function pageEntries() {
  return [guide.answer, ...tiles, ...blockEntries(menu)]
}
