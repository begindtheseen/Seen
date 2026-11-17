// /start/target — "Getting hired at Target". A COMPANY guide: the page renders from this module only, so every figure
// on it carries a reference and an as-of date (lib/start/guides.test.mjs fails on a figure without one).
//
// THE ONLY SOURCE OF FACTS is the research file compiled 2026-11-17 (session scratchpad guides20/target/research.md).
// Rules this module keeps:
//   • only items the research marked VERIFIED: Target's own careers pages, its own postings on corporate.target.com
//     (read 2026-11-17; each posting's date is the "datePosted" in the page's own JobPosting data), its press releases
//     and fact sheets, its Form 10-K, and the FTC;
//   • pay only where Target states it: the starting wage range Target announced on 2022-02-28 and still states in its
//     10-K (filed 2026-03-11) and its pay fact sheet (updated 2026-10-30), and the starting rate printed on individual
//     postings. Never a job board's estimate. The 10-K says Target shares pay ranges on all U.S. job postings;
//   • FIRST-HAND items (two or more threads agreeing) only as `firstHand: true`, rendered as what people say;
//   • nothing UNVERIFIED or CONFLICTING: no seasonal headcount for any year (news and aggregators disagree: 70,000 /
//     100,000 / 130K, and Target's own 2025 and 2026 pages state none), no "averaging 35 to 60 pounds" (the careers page
//     says 35–60, the postings say 35–50; the postings' figures are printed), no Dream to Be dollar caps or tiers
//     (third-party only), no "250 programs" (Target's two fact sheets count Dream to Be programs differently; the page
//     prints the ~500 "tuition-free or partially funded" wording), no sign-on bonus (its terms were not read in full);
//   • "Target" is also an everyday word and a staffing firm's name ("Target Temporaries"): every fact here is about
//     Target Corporation, the retailer, and only its own pages are used;
//   • `listings = null`: Seen held 4 active rows under the company name "Target" on 2026-11-17 (three Starbucks Barista
//     rows in Los Angeles County and one "Facility Attendant 1" in Austin) — too few to show — so the page shows no
//     listings block and the "Where to find" row sends people to Target's own job search.
//   • no hype, no promises, no exclamation marks.
//
// Shape: `sources` (every reference behind the page, kept here and NEVER printed as citations — readers reach the
// links through the grouped "Additional resources" menu, `resources` below), entries `{ text, src, firstHand? }`,
// `listings` (null here) and the openable menu rows (`menu`, rendered by components/start/Guide.tsx). Pure data;
// relative imports only so `node --test` runs it as is.

import { blockEntries } from './entries.js'

/** @typedef {{ label: string, url: string, date: string, note?: string }} Source */

const SEARCH = 'https://corporate.target.com/careers/job-search'
const posting = (id) => `https://corporate.target.com/job/id/${id}`

/** @type {Record<string, Source>} */
export const sources = {
  // Target's own careers pages.
  'tgt-search': { label: 'Target careers, job search (corporate.target.com)', url: SEARCH, date: '2026-11-17', note: 'read' },
  'tgt-store-hourly': { label: 'Target careers, Store Hourly: role groups and "Before you apply"', url: 'https://corporate.target.com/careers/career-areas/stores/hourly', date: '2026-11-17', note: 'read' },
  'tgt-guest-advocate': { label: 'Target careers, Guest Advocate job description', url: 'https://corporate.target.com/careers/career-areas/stores/hourly/guest-advocate', date: '2026-11-17', note: 'read' },
  'tgt-fulfillment': { label: 'Target careers, Fulfillment Expert job description', url: 'https://corporate.target.com/careers/career-areas/stores/hourly/fulfillment-expert', date: '2026-11-17', note: 'read' },
  'tgt-inbound': { label: 'Target careers, Inbound Expert job description', url: 'https://corporate.target.com/careers/career-areas/stores/hourly/inbound-expert', date: '2026-11-17', note: 'read' },
  'tgt-barista': { label: 'Target careers, Starbucks Barista job description', url: 'https://corporate.target.com/careers/career-areas/stores/hourly/starbucks-barista', date: '2026-11-17', note: 'read' },
  'tgt-style': { label: 'Target careers, Style Consultant job description', url: 'https://corporate.target.com/careers/career-areas/stores/hourly/style-consultant', date: '2026-11-17', note: 'read' },
  'tgt-security': { label: 'Target careers, Security Specialist job description', url: 'https://corporate.target.com/careers/career-areas/stores/hourly/security-specialist', date: '2026-11-17', note: 'read' },
  'tgt-on-demand': { label: 'Target careers, On-Demand Team Member', url: 'https://corporate.target.com/careers/career-areas/stores/hourly/on-demand', date: '2026-11-17', note: 'read' },
  'tgt-store-lead': { label: 'Target careers, Store Leadership roles', url: 'https://corporate.target.com/careers/career-areas/stores/leadership', date: '2026-11-17', note: 'read' },
  'tgt-entry': { label: 'Target careers, Entry-Level Opportunities', url: 'https://corporate.target.com/careers/career-areas/intern-entry-level/entry-level-opportunities', date: '2026-11-17', note: 'read' },
  'tgt-sc-hourly': { label: 'Target careers, Supply Chain Hourly roles', url: 'https://corporate.target.com/careers/career-areas/supply-chain/hourly', date: '2026-11-17', note: 'read' },
  'tgt-hiring': { label: 'Target careers, Our Hiring Process', url: 'https://corporate.target.com/careers/hiring-process', date: '2026-11-17', note: 'read' },
  'tgt-interview': { label: 'Target careers, Interview Guide and Tips', url: 'https://corporate.target.com/careers/hiring-process/interview-guide', date: '2026-11-17', note: 'read' },
  'tgt-video': { label: 'Target careers, Recorded Video Interviews', url: 'https://corporate.target.com/careers/hiring-process/recorded-video-interviews', date: '2026-11-17', note: 'read' },
  'tgt-faqs': { label: 'Target careers, Careers FAQs (background check, drug screen, applying)', url: 'https://corporate.target.com/careers/faqs', date: '2026-11-17', note: 'read' },
  'tgt-pay': { label: 'Target careers, Pay & Benefits', url: 'https://corporate.target.com/careers/pay-and-benefits', date: '2026-11-17', note: 'read' },
  'tgt-growth': { label: 'Target careers, Grow With Target (growth and development)', url: 'https://corporate.target.com/careers/growth-and-development', date: '2026-11-17', note: 'read' },
  'tgt-seasonal': { label: 'Target careers, seasonal jobs ("Hiring holiday helpers")', url: 'https://corporate.target.com/careers/seasonal', date: '2026-11-17', note: 'read' },
  'tgt-events': { label: 'Target careers, holiday recruiting events', url: 'https://corporate.target.com/careers/seasonal-events', date: '2026-11-17', note: 'read' },
  'tgt-fraud': { label: 'Target careers, Fraudulent Job Postings', url: 'https://corporate.target.com/careers/fraudulent-job-postings', date: '2026-11-17', note: 'read' },
  // Target's own postings (pay and requirements word for word), read 2026-11-17. Date = the posting's datePosted.
  'post-ga-holland': { label: 'Target posting R0000456902, Guest Advocate (Cashier or Front of Store Attendant/Cart Attendant), Holland, OH', url: posting('R0000456902'), date: '2026-09-23', note: 'posted' },
  'post-ga-dallas': { label: 'Target posting R0000454587, Guest Advocate (Cashier or Front of Store Attendant/Cart Attendant), Dallas, TX', url: posting('R0000454587'), date: '2026-09-23', note: 'posted' },
  'post-gm-stcharles': { label: 'Target posting R0000464082, General Merchandise, Closing, Fulfillment, St Charles, IL', url: posting('R0000464082'), date: '2026-09-23', note: 'posted' },
  'post-barista-normal': { label: 'Target posting R0000481105, Starbucks Barista, Normal, IL', url: posting('R0000481105'), date: '2026-11-17', note: 'posted' },
  'post-seasonal-inbound': { label: 'Target posting R0000455722, Seasonal: 4am Inbound (Stocking), Delray Beach, FL', url: posting('R0000455722'), date: '2026-09-25', note: 'posted' },
  'post-wh-tifton': { label: 'Target posting R0000447562, Full Time Hourly Warehouse Operations, Tifton, GA', url: posting('R0000447562'), date: '2026-11-17', note: 'posted' },
  'post-wh-denton': { label: 'Target posting R0000447663, Warehouse Worker, Food Distribution Center, Denton, TX', url: posting('R0000447663'), date: '2026-11-17', note: 'posted' },
  'post-wh-amsterdam': { label: 'Target posting R0000453979, Full Time Hourly Warehouse Operations Openings, Amsterdam, NY', url: posting('R0000453979'), date: '2026-11-17', note: 'posted' },
  'post-tl-lombard': { label: 'Target posting R0000480389, Specialty Sales Team Leader, Lombard, IL', url: posting('R0000480389'), date: '2026-11-13', note: 'posted' },
  'post-etl-tinley': { label: 'Target posting R0000480821, General Merchandise & Food Sales Executive Team Leader, Tinley Park, IL', url: posting('R0000480821'), date: '2026-11-13', note: 'posted' },
  // Target's press material and annual report.
  'pr-wage-2022': {
    label: 'Target press release, "Target to Set New Starting Wage Range and Expand Access to Health Care Benefits to More Team Members"',
    url: 'https://corporate.target.com/press/release/2022/02/target-to-set-new-starting-wage-range-and-expand-a',
    date: '2022-02-28', note: 'published',
  },
  'fs-pay': {
    label: 'Target fact sheet, "Pay & Benefits: Setting Target’s Team Members Up for Success, at Work and Beyond"',
    url: 'https://corporate.target.com/press/fact-sheet/2025/12/target-pay-and-benefits',
    date: '2026-10-30', note: 'updated',
  },
  'fs-dream': {
    label: 'Target fact sheet, "Dream to Be: Empowering Target’s Team Members through Access to Education"',
    url: 'https://corporate.target.com/press/fact-sheet/2025/09/dream-to-be',
    date: '2025-09-29', note: 'updated',
  },
  'fs-seasonal': {
    label: 'Target fact sheet, "Seasonal Staffing: How Target’s Team Gears Up for the Holidays"',
    url: 'https://corporate.target.com/press/fact-sheet/2023/09/seasonal-staffing',
    date: '2026-10-07', note: 'updated',
  },
  'pr-holiday-2025': {
    label: 'Target press release, holiday 2025 ("Target Brings Holiday Magic and Style with 20,000 New Items…")',
    url: 'https://corporate.target.com/press/release/2025/09/target-brings-holiday-magic-and-style-with-20,000-new-items,-thousands-of-gifts-starting-at-$5-and-e',
    date: '2025-09-16', note: 'published',
  },
  'sec-10k': {
    label: 'Target Corporation Form 10-K for fiscal year 2025 (SEC EDGAR)',
    url: 'https://www.sec.gov/Archives/edgar/data/27419/000002741926000016/tgt-20260131.htm',
    date: '2026-03-11', note: 'filed',
  },
  // Federal Trade Commission.
  'ftc-scams': { label: 'Federal Trade Commission, Job Scams (consumer advice)', url: 'https://consumer.ftc.gov/articles/job-scams', date: '2023-03', note: 'article dated' },
  'ftc-text': { label: 'Federal Trade Commission consumer alert, "That job offer text is probably a scam"', url: 'https://www.consumer.ftc.gov/consumer-alerts/2026/04/job-offer-text-probably-scam', date: '2026-04-30', note: 'published' },
  // First-hand accounts (r/Target, read through the Arctic Shift archive). Used only where several threads agree.
  'r-1ou5me3': { label: 'r/Target, "I applied for GM But got a call for Guest Advocate, I want to switch."', url: 'https://www.reddit.com/r/Target/comments/1ou5me3/', date: '2025-11-11', note: 'thread' },
  'r-1ovs7oq': { label: 'r/Target, "Applied for cashier (Help)"', url: 'https://www.reddit.com/r/Target/comments/1ovs7oq/', date: '2025-11-13', note: 'thread' },
  'r-1orn5q7': { label: 'r/Target, "Just accepted 4 am inbound position"', url: 'https://www.reddit.com/r/Target/comments/1orn5q7/', date: '2025-11-08', note: 'thread' },
  'r-1osjujn': { label: 'r/Target, "How on earth do you get hired at target?"', url: 'https://www.reddit.com/r/Target/comments/1osjujn/', date: '2025-11-09', note: 'thread' },
  'r-1oz4l75': { label: 'r/Target, "How to go from seasonal to permanent"', url: 'https://www.reddit.com/r/Target/comments/1oz4l75/', date: '2025-11-17', note: 'thread' },
  'r-1ox75t2': { label: 'r/Target, "Will calling out once make me ineligible to become perment from seasonal?"', url: 'https://www.reddit.com/r/Target/comments/1ox75t2/', date: '2025-11-14', note: 'thread' },
  'r-1otvjjz': { label: 'r/Target, "No Hours this Schedule??"', url: 'https://www.reddit.com/r/Target/comments/1otvjjz/', date: '2025-11-11', note: 'thread' },
  'r-1owhuy7': { label: 'r/Target, "Is it required to work 40 during the holidays?"', url: 'https://www.reddit.com/r/Target/comments/1owhuy7/', date: '2025-11-14', note: 'thread' },
}

export const guide = {
  path: '/start/target',
  title: 'Getting hired at Target',
  crumbLabel: 'Target',
  eyebrow: 'Guide',
  // The one-sentence answer under the h1 (no figure: the figures live in the tiles).
  answer: { text: 'Target\'s store and warehouse jobs list no degree or past experience, and Target says its training teaches the rest. What they do ask for is a flexible schedule that includes nights, weekends and holidays, and steady physical work. Target prints the starting pay on its own postings.', src: ['tgt-guest-advocate', 'tgt-fulfillment', 'post-wh-tifton', 'sec-10k'] },
  metaDescription: 'How to get hired at Target: store, Drive Up, Starbucks, warehouse and team lead jobs, what the postings ask for, the pay Target states, Dream to Be, seasonal jobs, the hiring steps and how to spot fake Target job offers.',
  asOf: '2026-11-17',
}

// The three readings in the hero: each restates a fact below, with the same references.
export const tiles = [
  { label: 'Starting wage range', value: '$15–$24/hr', text: 'for hourly store and warehouse jobs, depending on role and location. Target set it in 2022 and still states it in 2026.', src: ['pr-wage-2022', 'sec-10k', 'fs-pay'] },
  { label: 'Warehouse worker start', value: '$20.75–$24.00/hr', text: 'on Target warehouse postings in Georgia, Texas and New York, November 2026', src: ['post-wh-tifton', 'post-wh-denton', 'post-wh-amsterdam'] },
  { label: 'Dream to Be', value: '~500 programs', text: 'tuition-free or partly paid, from day one, for part-time and full-time U.S. team members', src: ['fs-dream'] },
]

// 1. Where to find the jobs, and how Target hires.
export const apply = {
  site: { text: 'Every Target job is posted on Target\'s own careers site, and every application goes through Workday, Target\'s application system. Search by job title and place.', src: ['tgt-search', 'tgt-fraud', 'tgt-hiring'] },
  before: { text: 'Before an hourly application, Target says to have proof you can legally work in the U.S. and a working email address, and to allow up to 30 minutes. A résumé is "not required to apply for jobs but highly encouraged."', src: ['tgt-store-hourly', 'tgt-sc-hourly', 'tgt-faqs'] },
  steps: [
    { step: 'Apply online', text: 'In Workday, by typing your details, uploading a résumé or reusing an earlier Target application. Some applications add questions about your availability or a short skills assessment.', src: ['tgt-hiring'] },
    { step: 'Interview', text: 'By phone or video call, in person, or as recorded video answers. Target\'s seasonal fact sheet says store jobs use recorded video and online interviews, and supply chain jobs use applications and online assessments.', src: ['tgt-hiring', 'fs-seasonal'] },
    { step: 'Offer', text: 'An email tells you how to open your offer letter in Workday, with the position, pay and benefits.', src: ['tgt-hiring'] },
    { step: 'Background check', text: 'Every offer depends on a background check, run by Accurate Background after you accept. Some jobs also need a drug screen, done within 24 hours of accepting.', src: ['tgt-faqs'] },
    { step: 'Orientation', text: 'New hires start with Target Welcome, Target\'s orientation.', src: ['tgt-hiring'] },
  ],
  video: [
    { text: 'A recorded video interview takes about 30 minutes. You can practise as often as you like, but Target does not allow retakes of the interview itself.', src: ['tgt-video'] },
    { text: 'The invitation email comes from interviews@hirevue.com. Target says it usually answers within five business days, and to ask for the store\'s human resources after ten days.', src: ['tgt-video'] },
    { text: 'Target\'s interview guide suggests about five minutes per answer, with a real example, such as "a time you were confronted with a problem and had to help find a solution."', src: ['tgt-interview'] },
    { text: 'If you were turned down, you can apply to other jobs at any time, but the system may not let you reapply to the same posting.', src: ['tgt-faqs'] },
  ],
}
export const peopleSay = [
  { text: 'Several store hires describe recorded video answers followed by a short phone call, rather than an in-person interview.', src: ['r-1orn5q7', 'r-1osjujn'], firstHand: true },
  { text: 'People who work in Target stores say most store jobs are cross-trained to help at checkout and with online orders, and that the store may offer the role it needs filled rather than the one you applied for.', src: ['r-1ou5me3', 'r-1ovs7oq', 'r-1orn5q7'], firstHand: true },
]
export const scams = [
  { text: 'Target: recruiter emails come from an @target.com address, every open job is on corporate.target.com/careers, and applications go only through Workday.', src: ['tgt-fraud'] },
  { text: '"Target will never ask for payment, gift cards or banking information during the recruiting process," and never asks for personal information by text.', src: ['tgt-fraud', 'tgt-guest-advocate'] },
  { text: 'The FTC: "Real employers will never contact you that way" about a job offer by text you did not expect, and "No honest potential employer will ever send you a check to deposit and then tell you to send on part of the money."', src: ['ftc-text', 'ftc-scams'] },
]

// 2. The jobs, by Target's own families and titles.
export const roles = [
  {
    name: 'Guest Advocate', aka: 'Checkout, guest service, Drive Up',
    body: { text: 'Works the checklanes, guest services, order pickup and Drive Up, and keeps the front of the store clean. Target lists the same title for cashier, front of store attendant and cart attendant work.', src: ['tgt-guest-advocate', 'post-ga-holland'] },
    chips: [{ text: 'From $15.50/hr in Holland, OH', src: ['post-ga-holland'] }],
  },
  {
    name: 'Fulfillment Expert', aka: 'Online orders and Drive Up',
    body: { text: 'Picks, packs and sorts online orders for order pickup, Drive Up and ship to home, against time goals, and climbs ladders.', src: ['tgt-fulfillment'] },
    chips: [{ text: 'From $17.25/hr in St Charles, IL', src: ['post-gm-stcharles'] }],
  },
  {
    name: 'General merchandise and inbound', aka: 'Stocking, early mornings',
    body: { text: 'Unloads trucks, fills shelves and keeps prices and signs right. Inbound shifts can start at 4 a.m., and the Inbound Expert page says you must be at least 18.', src: ['tgt-inbound', 'post-seasonal-inbound'] },
    chips: [{ text: 'Seasonal from $16.00/hr in Delray Beach, FL', src: ['post-seasonal-inbound'] }],
  },
  {
    name: 'Starbucks Barista', aka: 'Food and beverage',
    body: { text: 'Makes drinks and food from recipe cards in the Starbucks inside the store and keeps food-safety logs. Starbucks or food service experience is "preferred, but not required."', src: ['tgt-barista'] },
    chips: [{ text: 'From $16.50/hr in Normal, IL', src: ['post-barista-normal'] }],
  },
  {
    name: 'Style, Tech and Beauty Consultant', aka: 'Specialty sales',
    body: { text: 'Helps shoppers in apparel, electronics or beauty and keeps those areas set and stocked. Closing, security and human resources jobs make up the store\'s support roles.', src: ['tgt-store-hourly', 'tgt-style', 'tgt-security'] },
    chips: [],
  },
  {
    name: 'Warehouse Associate or Warehouse Worker', aka: 'Distribution centers',
    body: { text: 'Packs, loads and ships freight to stores and shoppers. You are considered for one or the other based on your answers to the application\'s questionnaire and assessment; Warehouse Workers are trained on forklifts and other powered equipment.', src: ['post-wh-tifton', 'tgt-sc-hourly'] },
    chips: [{ text: 'Associate from $19.00/hr in Tifton, GA', src: ['post-wh-tifton'] }],
  },
  {
    name: 'On-Demand Team Member', aka: 'Pick your own shifts',
    body: { text: 'Picks up open shifts at one store through Target\'s scheduling app, up to 40 hours a week. You must work at least one four-hour shift every four weeks, and at least one shift in five months or you are let go.', src: ['tgt-on-demand'] },
    chips: [],
  },
]
export const rolesNote = { text: 'Target had 1,995 stores and 70 supply chain facilities, such as distribution and sortation centers, at the end of January 2026, and about 415,000 team members counting part-time and seasonal.', src: ['sec-10k'] }

// 3. What the postings ask.
export const asks = {
  intro: { text: 'What Target\'s own role pages and postings asked for in November 2026.', src: ['tgt-guest-advocate', 'tgt-fulfillment', 'post-wh-tifton'] },
  items: [
    { name: 'A flexible schedule', text: 'Nights, weekends and holidays in stores; one Tifton, GA warehouse opening runs 6:00 PM to 6:00 AM on Saturday, Sunday and Monday.', src: ['tgt-guest-advocate', 'post-wh-tifton'] },
    { name: 'Lifting, in stores', text: 'Up to 44 pounds alone on most store jobs; a general merchandise posting adds team lifts of 45 to 100 pounds.', src: ['tgt-fulfillment', 'tgt-guest-advocate', 'post-gm-stcharles'] },
    { name: 'Lifting, in warehouses', text: '35 to 50 pounds often and up to 60 pounds at times, up to 2,000 cartons a day, standing or walking on concrete all shift.', src: ['post-wh-tifton'] },
    { name: 'Ladders and the cold', text: 'Fulfillment and stocking jobs climb ladders; baristas and food distribution centers work in fridge and freezer conditions.', src: ['tgt-fulfillment', 'tgt-barista', 'post-wh-denton'] },
    { name: 'Age 18 for some jobs', text: 'Inbound Expert, Security Specialist and team leader postings say you must be at least 18.', src: ['tgt-inbound', 'tgt-security', 'post-tl-lombard'] },
    { name: 'English for warehouse jobs', text: 'Enough to "follow safety and other policies, trainings, and instructions", plus basic counting and reading labels.', src: ['post-wh-tifton'] },
    { name: 'Heights and forklifts', text: 'Warehouse Workers are trained on forklifts and scissor lifts and may work up to 40 feet up on a mezzanine where a site has one.', src: ['post-wh-tifton'] },
    { name: 'No headphones on the floor', text: 'Warehouses are loud; Target gives hearing protection and does not allow headphones or earbuds on the warehouse floor.', src: ['post-wh-tifton'] },
  ],
  training: { text: 'Store role pages say, "we have some amazing training that will help teach you everything you need to know," and list the skills to bring: a helpful attitude, attention to detail and working with a team.', src: ['tgt-guest-advocate', 'tgt-fulfillment'] },
}

// 4. Pay Target states.
export const payIntro = { text: 'Target\'s annual report says it shares pay ranges on all of its U.S. job postings. Its starting range for hourly store and warehouse jobs is $15 to $24 an hour, depending on the job and the local market.', src: ['sec-10k', 'pr-wage-2022'] }
export const payRows = [
  { role: 'Guest Advocate', place: 'Holland, OH', pay: '$15.50/hr to start (range $15.50–$23.25)', src: ['post-ga-holland'] },
  { role: 'Guest Advocate', place: 'Dallas, TX', pay: '$16.50/hr to start', src: ['post-ga-dallas'] },
  { role: 'General Merchandise, Closing, Fulfillment', place: 'St Charles, IL', pay: '$17.25/hr to start (range $17.25–$25.90)', src: ['post-gm-stcharles'] },
  { role: 'Starbucks Barista', place: 'Normal, IL', pay: '$16.50/hr to start (range $16.50–$24.75)', src: ['post-barista-normal'] },
  { role: 'Seasonal 4am Inbound', place: 'Delray Beach, FL', pay: '$16.00/hr to start', src: ['post-seasonal-inbound'] },
  { role: 'Warehouse Associate / Worker', place: 'Tifton, GA', pay: '$19.00 / $20.75 an hour to start', src: ['post-wh-tifton'] },
  { role: 'Warehouse Worker, food distribution center', place: 'Denton, TX', pay: '$22.85/hr to start', src: ['post-wh-denton'] },
  { role: 'Warehouse Associate / Worker', place: 'Amsterdam, NY', pay: '$21.55 / $24.00 an hour to start', src: ['post-wh-amsterdam'] },
  { role: 'Specialty Sales Team Leader', place: 'Lombard, IL', pay: '$23.75–$25.75/hr to start', src: ['post-tl-lombard'] },
  { role: 'Executive Team Leader', place: 'Tinley Park, IL', pay: '$64,000–$128,000 a year', src: ['post-etl-tinley'] },
]
export const payNote = { text: 'Each posting states its own starting rate, so check the one for your store. Warehouse postings add a shift differential of $2.00 to $3.50 an hour where eligible, and stores pay extra for early-morning and overnight hours.', src: ['post-wh-tifton', 'tgt-seasonal'] }
export const payMore = { text: 'Target says the average wage of its frontline team members is above $18.50 an hour.', src: ['fs-pay'] }
export const benefits = [
  { text: 'Health plans: hourly team members become eligible at an average of 25 hours a week; Target\'s store role pages say medical, dental and vision are available to eligible team members after 90 days.', src: ['fs-pay', 'pr-wage-2022', 'tgt-guest-advocate'] },
  { text: 'From day one for every team member: free 24/7 virtual care and mental health support, early access to earned pay through DailyPay where eligible, and a 10% discount at Target and Target.com, plus 20% off wellness products and adult owned-brand apparel.', src: ['tgt-pay', 'fs-pay'] },
  { text: 'A 401(k) match of dollar for dollar up to 5% of eligible pay, vested immediately.', src: ['fs-pay', 'tgt-pay'] },
  { text: 'Up to four weeks of paid family leave at full pay for eligible team members, plus sick pay, paid time off and paid national holidays.', src: ['tgt-pay'] },
  { text: 'Target adds that eligibility "may vary based on position, average hours worked, length of service and program requirements."', src: ['tgt-pay'] },
]

// 5. Dream to Be.
export const dream = {
  what: { text: 'Dream to Be is Target\'s education benefit. U.S. team members can use it from their first day, part-time or full-time, through Target\'s partner Guild.', src: ['fs-dream'] },
  items: [
    { name: 'About 500 programs', text: 'Tuition-free or partly paid: high school completion, language learning, certificates, bootcamps, and undergraduate and master\'s degrees.', src: ['fs-dream'] },
    { name: 'More than 40 schools', text: 'Colleges and universities, online and in person.', src: ['fs-dream', 'tgt-growth'] },
    { name: 'Credit for Target training', text: 'Target now gives college credit for some of its own training programs.', src: ['fs-dream'] },
  ],
  results: { text: 'Target says more than 10,000 team members have graduated since the program began in September 2021, and that hourly team members enrolled in it are 3.5 times more likely to be promoted.', src: ['fs-dream'] },
  ask: { text: 'Some programs are tuition-free and others are only partly paid, so check what a program covers before you enroll.', src: ['fs-dream'] },
}

// 6. Seasonal jobs.
export const seasonal = {
  what: { text: 'Target hires seasonal team members for the holidays in its stores and supply chain facilities, after first offering extra hours to its current team and its On-Demand team of about 43,000 store team members.', src: ['fs-seasonal'] },
  items: [
    { name: 'The roles', text: 'Guest services, early morning and overnight inbound, fulfillment, food and beverage, style, beauty, tech, general merchandise and Starbucks.', src: ['tgt-seasonal'] },
    { name: 'Same pay range, benefits from day one', text: 'Seasonal team members start in the same $15 to $24 range, with day-one benefits such as early pay access, the team discount and virtual care.', src: ['fs-seasonal'] },
    { name: 'Extra pay for early hours', text: 'For the 2026 holidays, a Delray Beach, FL seasonal posting added a temporary $1 an hour on top of the usual $1 for eligible early-morning and overnight hours, through January 2, 2027.', src: ['post-seasonal-inbound'] },
    { name: 'When it opens', text: 'Seasonal hiring for the 2025 holidays opened on September 24, 2025, in all 50 states. Some stores hold recruiting events in November.', src: ['pr-holiday-2025', 'tgt-events'] },
  ],
  stay: { text: 'Target says more than half of its seasonal store team members stayed on after the previous holidays, and store seasonal team members can move to On-Demand after the season; supply chain facilities have no On-Demand jobs.', src: ['fs-seasonal'] },
}
export const seasonalSay = [
  { text: 'Store team members say attendance is what decides which seasonal hires are kept: write-ups and missed shifts in the first weeks count against you.', src: ['r-1oz4l75', 'r-1ox75t2'], firstHand: true },
  { text: 'Hours change week to week: some seasonal and part-time hires describe a week with few or no hours, others a week scheduled past what they asked for, and the advice is to talk to your team leader and post or pick up shifts.', src: ['r-1otvjjz', 'r-1owhuy7'], firstHand: true },
]

// 7. Moving up.
export const movingUp = {
  ladder: { text: 'Store leadership at Target runs Team Leader, then Executive Team Leader, then Store Director, then District Senior Director.', src: ['tgt-store-lead'] },
  items: [
    { name: 'Team Leader', text: 'Hourly, full-time, leading a team in one area. A Lombard, IL posting starts at $23.75–$25.75 an hour, asks for 18 or older, and says "Previous retail experience preferred, but not required."', src: ['post-tl-lombard'] },
    { name: 'Executive Team Leader', text: 'Salaried, running several areas of a store: $64,000–$128,000 a year on a Tinley Park, IL posting, which asks for a "4 year degree or equivalent experience" and early morning, evening, overnight and weekend shifts.', src: ['post-etl-tinley'] },
    { name: 'Also a first job out of college', text: 'Target lists Store Executive Team Leader among its full-time, entry-level roles.', src: ['tgt-entry'] },
  ],
  inside: { text: 'Team members apply for new roles through Workday\'s internal Career Hub after talking with their leader. Target\'s Prepare for Next program helps team members who want to move up build the skills for it.', src: ['tgt-hiring', 'tgt-growth'] },
  warehouse: { text: 'In warehouses, Target\'s postings say pay can grow with time in the role, and that Warehouse Workers are trained on powered equipment.', src: ['post-wh-tifton'] },
}

// FAQ — visible on the page and mirrored in FAQPage JSON-LD.
export const faq = [
  {
    q: 'Do I need experience to work at Target?',
    a: { text: 'Not for most store and warehouse jobs. Target\'s role pages say its training teaches what you need, and list skills such as a helpful attitude, attention to detail and working in a team. Some jobs, such as inbound and team leader, require you to be at least 18.', src: ['tgt-guest-advocate', 'tgt-inbound', 'post-tl-lombard'] },
  },
  {
    q: 'How much does Target pay to start?',
    a: { text: 'Target\'s starting range for hourly store and warehouse jobs is $15 to $24 an hour, depending on role and location. Each posting states its own rate: in fall 2026, $15.50 for a Guest Advocate in Holland, OH and $20.75 for a Warehouse Worker in Tifton, GA.', src: ['sec-10k', 'post-ga-holland', 'post-wh-tifton'] },
  },
  {
    q: 'How long does Target take to get back to you?',
    a: { text: 'After a recorded video interview, Target says it usually answers within five business days. If it has been more than ten days, contact your recruiter or the store\'s human resources. You can follow every application in your Workday candidate account.', src: ['tgt-video', 'tgt-hiring'] },
  },
  {
    q: 'Does Target do background checks or drug tests?',
    a: { text: 'Every Target offer depends on a background check, done after you accept. Some jobs also require a drug screen, which you are told about with the offer and must complete within 24 hours of accepting.', src: ['tgt-faqs'] },
  },
  {
    q: 'What is Target\'s Dream to Be program?',
    a: { text: 'Target\'s education benefit for U.S. team members, part-time or full-time, from day one. It offers about 500 tuition-free or partly paid programs at more than 40 schools, through Guild.', src: ['fs-dream'] },
  },
  {
    q: 'Can a seasonal job at Target turn permanent?',
    a: { text: 'It can. Target says more than half of its seasonal store team members stayed on after the previous holidays, and that store seasonal team members can move to its On-Demand team once the season ends.', src: ['fs-seasonal'] },
  },
]

// ── Listings: none. Seen held only four active rows under the company name "Target" on 2026-11-17 (three Starbucks
// Barista rows in Los Angeles County and one "Facility Attendant 1" in Austin; a fifth row was the staffing firm
// "Target Temporaries"), so the template shows no "Hiring now" block; the first row sends people to Target's search.
export const listings = null

// ── The page's openable rows (components/start/Guide.tsx `Blocks` renders each block type) ─────────────────────────
export const menu = [
  {
    id: 'apply', title: 'Where to find Target\'s jobs', summary: 'Target\'s own site, and the hiring steps',
    blocks: [
      { type: 'cards', items: [{ name: 'Target careers', aka: 'Target\'s own job search', link: SEARCH, body: apply.site }] },
      { type: 'text', entry: apply.before },
      { type: 'steps', items: apply.steps },
      { type: 'more', title: 'Recorded video interviews', blocks: [{ type: 'notes', items: apply.video }] },
      { type: 'heading', text: 'What people hired at Target stores say' },
      { type: 'text', plain: 'More than one account agrees on each of these.' },
      { type: 'notes', items: peopleSay },
      { type: 'notes', label: 'Fake Target job offers', items: scams, icon: 'x', caution: true },
      { type: 'resumeLink', before: 'Before you apply, you can', label: 'check your résumé against a posting' },
    ],
  },
  {
    id: 'jobs', title: 'Store and warehouse jobs', summary: 'Target\'s titles, with stated pay',
    blocks: [
      { type: 'cards', items: roles },
      { type: 'note', entry: rolesNote },
    ],
  },
  {
    id: 'what-you-need', title: 'What the postings ask', summary: 'Schedule, lifting, age, warehouse rules',
    blocks: [
      { type: 'text', entry: asks.intro },
      { type: 'checklist', items: asks.items, cols: true },
      { type: 'callout', entry: asks.training },
    ],
  },
  {
    id: 'pay', title: 'Pay Target states', summary: 'Starting rates on its own postings',
    blocks: [
      { type: 'text', entry: payIntro },
      { type: 'table', caption: 'Pay stated on Target’s own postings', columns: [{ key: 'role', label: 'Role' }, { key: 'place', label: 'Where' }, { key: 'pay', label: 'Stated pay', num: true }], rows: payRows },
      { type: 'note', entry: payNote },
      { type: 'more', title: 'Benefits', blocks: [{ type: 'text', entry: payMore }, { type: 'notes', items: benefits }] },
    ],
  },
  {
    id: 'dream-to-be', title: 'Dream to Be, Target\'s school benefit', summary: 'Tuition-free or partly paid programs',
    blocks: [
      { type: 'text', entry: dream.what },
      { type: 'checklist', items: dream.items },
      { type: 'text', entry: dream.results },
      { type: 'callout', entry: dream.ask },
    ],
  },
  {
    id: 'seasonal', title: 'Seasonal jobs', summary: 'Holiday roles, extra pay, staying on',
    blocks: [
      { type: 'text', entry: seasonal.what },
      { type: 'checklist', items: seasonal.items },
      { type: 'text', entry: seasonal.stay },
      { type: 'heading', text: 'What seasonal hires say' },
      { type: 'text', plain: 'More than one account agrees on each of these.' },
      { type: 'notes', items: seasonalSay },
    ],
  },
  {
    id: 'moving-up', title: 'Moving up', summary: 'Team leader, executive team leader',
    blocks: [
      { type: 'text', entry: movingUp.ladder },
      { type: 'checklist', items: movingUp.items },
      { type: 'text', entry: movingUp.inside },
      { type: 'text', entry: movingUp.warehouse },
    ],
  },
  { id: 'questions', title: 'Common questions', summary: 'Experience, pay, timing, checks, school', blocks: [{ type: 'faq', items: faq }] },
]

// ── Additional resources: every reference above, as plain grouped links (no numbers, closed by default) ────────────
export const resourcesSummary = 'Target careers, its postings, public records'
export const resources = [
  { title: 'Target careers', items: [
    { key: 'tgt-search', name: 'Target job search' },
    { key: 'tgt-store-hourly', name: 'Store hourly jobs' },
    { key: 'tgt-guest-advocate', name: 'Guest Advocate job description' },
    { key: 'tgt-fulfillment', name: 'Fulfillment Expert job description' },
    { key: 'tgt-inbound', name: 'Inbound Expert job description' },
    { key: 'tgt-barista', name: 'Starbucks Barista job description' },
    { key: 'tgt-style', name: 'Style Consultant job description' },
    { key: 'tgt-security', name: 'Security Specialist job description' },
    { key: 'tgt-on-demand', name: 'On-Demand Team Member' },
    { key: 'tgt-sc-hourly', name: 'Supply chain hourly jobs' },
    { key: 'tgt-store-lead', name: 'Store leadership jobs' },
    { key: 'tgt-entry', name: 'Entry-level roles' },
    { key: 'tgt-seasonal', name: 'Seasonal jobs' },
    { key: 'tgt-events', name: 'Holiday recruiting events' },
  ] },
  { title: 'Hiring, pay and benefits', items: [
    { key: 'tgt-hiring', name: 'Target\'s hiring process' },
    { key: 'tgt-interview', name: 'Interview guide' },
    { key: 'tgt-video', name: 'Recorded video interviews' },
    { key: 'tgt-faqs', name: 'Careers questions' },
    { key: 'tgt-pay', name: 'Pay and benefits' },
    { key: 'tgt-growth', name: 'Growth and development' },
    { key: 'fs-pay', name: 'Pay and benefits fact sheet' },
    { key: 'fs-dream', name: 'Dream to Be fact sheet' },
    { key: 'fs-seasonal', name: 'Seasonal staffing fact sheet' },
    { key: 'pr-wage-2022', name: 'Starting wage range announcement, 2022' },
    { key: 'pr-holiday-2025', name: 'Holiday 2025 announcement' },
  ] },
  { title: 'Target postings', items: [
    { key: 'post-ga-holland', name: 'Guest Advocate, Holland, OH' },
    { key: 'post-ga-dallas', name: 'Guest Advocate, Dallas, TX' },
    { key: 'post-gm-stcharles', name: 'General Merchandise, Closing, Fulfillment, St Charles, IL' },
    { key: 'post-barista-normal', name: 'Starbucks Barista, Normal, IL' },
    { key: 'post-seasonal-inbound', name: 'Seasonal inbound, Delray Beach, FL' },
    { key: 'post-wh-tifton', name: 'Warehouse operations, Tifton, GA' },
    { key: 'post-wh-denton', name: 'Warehouse Worker, Denton, TX' },
    { key: 'post-wh-amsterdam', name: 'Warehouse operations, Amsterdam, NY' },
    { key: 'post-tl-lombard', name: 'Specialty Sales Team Leader, Lombard, IL' },
    { key: 'post-etl-tinley', name: 'Executive Team Leader, Tinley Park, IL' },
  ] },
  { title: 'Public records', items: [
    { key: 'sec-10k', name: 'Target annual report, 2025 (SEC)' },
  ] },
  { title: 'Job scams', items: [
    { key: 'tgt-fraud', name: 'Fraudulent job postings (Target)' },
    { key: 'ftc-scams', name: 'Job scams (Federal Trade Commission)' },
    { key: 'ftc-text', name: 'Job offer texts (Federal Trade Commission)' },
  ] },
  { title: 'Community discussions', items: [
    { key: 'r-1orn5q7', name: 'Hired for an early inbound job' },
    { key: 'r-1osjujn', name: 'Getting hired at a Target store' },
    { key: 'r-1ou5me3', name: 'Offered a different role than applied for' },
    { key: 'r-1ovs7oq', name: 'Cross-training after being hired as a cashier' },
    { key: 'r-1oz4l75', name: 'Going from seasonal to permanent' },
    { key: 'r-1ox75t2', name: 'Calling out as a seasonal hire' },
    { key: 'r-1otvjjz', name: 'A week with no hours' },
    { key: 'r-1owhuy7', name: 'Scheduled for more hours than asked' },
  ] },
]

/** Every fact on the page, in reading order: the hero, then each menu row. */
export function pageEntries() {
  return [guide.answer, ...tiles, ...blockEntries(menu)]
}
