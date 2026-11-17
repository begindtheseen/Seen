// /start/ups — "Getting hired at UPS". A COMPANY guide: the page renders from this module only, so every figure on it
// carries a reference and an as-of date (lib/start/guides.test.mjs fails on a figure without one).
//
// THE ONLY SOURCE OF FACTS is the research file compiled 2026-11-17 (session scratchpad guides20/ups/research.md, raw
// copies beside it). Rules this module keeps:
//   • only items the research marked VERIFIED: UPS's own careers pages and postings (jobs-ups.com), UPS's 2025 Form 10-K,
//     the 2023–2028 UPS National Master Agreement as the Teamsters publish it, the Teamsters' own ratification release,
//     The UPS Store's own site, the FTC and OSHA;
//   • posted pay = the base pay line on UPS's own postings ("The base pay for this position is …"), counted over a pull of
//     every U.S. posting on UPS's careers search (3,332 postings, 2026-11-17). Mechanic pay is printed only from the
//     two postings that state it;
//   • the contract figures are the contract's own text (Article 22 §3–5, Article 41 §1–5, Article 18 §14 and §27,
//     Article 26 §1(f)); the $49 average top rate is printed only as the Teamsters' own figure — the national contract
//     writes the driver top rate as "Top Rate", set in the local supplements;
//   • FIRST-HAND items (several accounts agreeing, never one) only as `firstHand: true`, rendered as what people say;
//   • nothing UNVERIFIED: no union claim that UPS drivers are the highest paid, no single-thread pay figure, no retention
//     rate, no lawsuits or grievances, no executives, no stock;
//   • The UPS Store is a franchise: its stores are independently owned and their staff are the franchisee's employees, so
//     its jobs are not UPS jobs and its rows are kept out of the listings (`employer` is anchored to UPS's own names).
//   • no hype, no promises, no exclamation marks.
//
// Shape: `sources` (every reference behind the page, kept here and NEVER printed as citations — readers reach the links
// through the grouped "Additional resources" menu, `resources` below), entries `{ text, src, firstHand? }`, the listings
// filter config (`listings`, lib/start/listingFilters.js; a company guide sets `employer`) and the openable menu rows
// (`menu`, rendered by components/start/Guide.tsx). Pure data; relative imports only so `node --test` runs it as is.

import { blockEntries } from './entries.js'

/** @typedef {{ label: string, url: string, date: string, note?: string }} Source */

const CAREERS = 'https://www.jobs-ups.com/us/en/search-results'
const JOB = (id) => `https://www.jobs-ups.com/us/en/job/${id}`

/** @type {Record<string, Source>} */
export const sources = {
  // UPS's own careers site (jobs-ups.com), read 2026-11-17.
  'ups-board': {
    label: 'UPS careers, job search: every U.S. posting with its stated base pay (3,332 postings read 2026-11-17)',
    url: CAREERS, date: '2026-11-17', note: 'read',
  },
  'ups-home': { label: 'UPS careers home page ("Get a job offer in 10 minutes")', url: 'https://www.jobs-ups.com/us/en/home', date: '2026-11-17', note: 'read' },
  'ups-hourly': { label: 'UPS careers, Hourly Roles', url: 'https://www.jobs-ups.com/us/en/hourly-roles', date: '2026-11-17', note: 'read' },
  'ups-apply': { label: 'UPS careers, Application and Onboarding', url: 'https://www.jobs-ups.com/us/en/application-and-onboarding', date: '2026-11-17', note: 'read' },
  'ups-warehouse': { label: 'UPS careers, Warehouse Workers (FAQ, shifts, first day)', url: 'https://www.jobs-ups.com/us/en/warehouse-workers', date: '2026-11-17', note: 'read' },
  'ups-helpers': { label: 'UPS careers, Driver Helpers (FAQ)', url: 'https://www.jobs-ups.com/us/en/driver-helpers', date: '2026-11-17', note: 'read' },
  'ups-pdd': { label: 'UPS careers, Package Delivery Driver (FAQ, qualifications, training)', url: 'https://www.jobs-ups.com/us/en/package-delivery-driver', date: '2026-11-17', note: 'read' },
  'ups-ssd': { label: 'UPS careers, Seasonal Support Driver (FAQ)', url: 'https://www.jobs-ups.com/us/en/seasonal-support-driver', date: '2026-11-17', note: 'read' },
  'ups-cover': { label: 'UPS careers, Warehouse Worker/Cover Driver (FAQ)', url: 'https://www.jobs-ups.com/us/en/temporary-cover-driver', date: '2026-11-17', note: 'read' },
  'ups-ttd': { label: 'UPS careers, Tractor-Trailer Drivers (FAQ)', url: 'https://www.jobs-ups.com/us/en/tractor-trailer-driver', date: '2026-11-17', note: 'read' },
  'ups-metro': { label: 'UPS careers, Metropolitan College (program page and hiring FAQ)', url: 'https://www.jobs-ups.com/us/en/metropolitan-college', date: '2026-11-17', note: 'read' },
  'ups-earn': { label: 'UPS careers, Earn and Learn tuition assistance', url: 'https://www.jobs-ups.com/us/en/earn-and-learn', date: '2026-11-17', note: 'read' },
  'ups-fraud': { label: 'UPS careers, Avoid Fraud', url: 'https://www.jobs-ups.com/us/en/avoid-fraud-', date: '2026-11-17', note: 'read' },
  // UPS's own postings, read in full on 2026-11-17.
  'post-handler': { label: 'UPS posting, Warehouse Worker - Package Handler, Salt Lake City, UT (posted 2026-11-17)', url: JOB('1f05bee4-1eae-499f-8200-efa823f54542'), date: '2026-11-17', note: 'read' },
  'post-helper': { label: 'UPS posting, Driver Helper, Great Bend, KS (posted 2026-11-17)', url: JOB('6985e35b-0879-458a-9b7d-4be7b23760ea'), date: '2026-11-17', note: 'read' },
  'post-ssd': { label: 'UPS posting, Seasonal Support Driver, Hutchinson, KS (posted 2026-11-17)', url: JOB('018e7eff-aa6b-4251-af16-03116749a007'), date: '2026-11-17', note: 'read' },
  'post-pdd': { label: 'UPS posting, Seasonal Package Delivery Driver, Salt Lake City, UT (posted 2026-11-17)', url: JOB('9dda8f83-3eaa-4e59-ba2f-2d2068baadd1'), date: '2026-11-17', note: 'read' },
  'post-feeder': { label: 'UPS posting, Seasonal Tractor Trailer Driver, Arlington, TX (posted 2026-10-29)', url: JOB('9049ffab-bcee-44c9-916d-960b67c6faf6'), date: '2026-11-17', note: 'read' },
  'post-mech': { label: 'UPS posting, Mechanic Journeyman, Edgerton, KS (R26041240, posted 2026-11-04)', url: JOB('R26041240'), date: '2026-11-17', note: 'read' },
  'post-appr': { label: 'UPS posting, PT Mechanic Apprentice, Hodgkins, IL (R26041956, posted 2026-11-16)', url: JOB('R26041956'), date: '2026-11-17', note: 'read' },
  // The contract and the union's own summary.
  'nma': {
    label: 'National Master United Parcel Service Agreement, August 1, 2023 through July 31, 2028 (International Brotherhood of Teamsters)',
    url: 'https://teamster.org/wp-content/uploads/2024/01/1924UPSNATIONALMASTERFINAL.pdf',
    date: '2024-01', note: 'published',
  },
  'ibt-ratify': {
    label: 'International Brotherhood of Teamsters, "Teamsters Ratify Historic UPS Contract"',
    url: 'https://teamster.org/2023/08/teamsters-ratify-historic-ups-contract/',
    date: '2023-08-22', note: 'published',
  },
  'sec-10k': {
    label: 'United Parcel Service, Inc. Form 10-K for fiscal year 2025 (SEC EDGAR)',
    url: 'https://www.sec.gov/Archives/edgar/data/1090727/000162828026008432/ups-20251231.htm',
    date: '2026-02-17', note: 'filed',
  },
  'tus-careers': { label: 'The UPS Store, careers page (franchise and employer notice)', url: 'https://www.theupsstore.com/careers', date: '2026-11-17', note: 'read' },
  'osha-heat': { label: 'OSHA, Heat: Overview — working in outdoor and indoor heat environments', url: 'https://www.osha.gov/heat-exposure', date: '2026-11-17', note: 'read' },
  'ftc-jobs': { label: 'Federal Trade Commission consumer advice, "Job Scams"', url: 'https://consumer.ftc.gov/articles/job-scams', date: '2023-03', note: 'published' },
  // First-hand accounts (r/UPS, read through the Arctic Shift archive). Used only where several accounts agree.
  'r-1q0rq9x': { label: 'r/UPS, "Time served before promoted to full-time driver"', url: 'https://www.reddit.com/r/UPS/comments/1q0rq9x/', date: '2026-01-01', note: 'thread' },
  'r-1pfdon1': { label: 'r/UPS, "What\'s the best way to get a full time position after my time as a seasonal driver helper is over?"', url: 'https://www.reddit.com/r/UPS/comments/1pfdon1/', date: '2025-12-06', note: 'thread' },
  'r-1pe4e72': { label: 'r/UPS, "Chances of seasonal driver helper/walker to transition to full time position."', url: 'https://www.reddit.com/r/UPS/comments/1pe4e72/', date: '2025-12-04', note: 'thread' },
  'r-1p2maok': { label: 'r/UPS, "After the second day as a driver helper, I realize that being a driver is not for me."', url: 'https://www.reddit.com/r/UPS/comments/1p2maok/', date: '2025-11-21', note: 'thread' },
  'r-1p4xwor': { label: 'r/UPS, "First week as a driver helper and the front of my thighs are trashed from stairs"', url: 'https://www.reddit.com/r/UPS/comments/1p4xwor/', date: '2025-11-23', note: 'thread' },
  'r-1xqqyhf': { label: 'r/UPS, "Seasonal driver helper questions"', url: 'https://www.reddit.com/r/UPS/comments/1xqqyhf/', date: '2026-11-08', note: 'thread' },
  'r-1xujq3n': { label: 'r/UPS, "Just got hired as a Driver Helper, but I\'m having so many issues..."', url: 'https://www.reddit.com/r/UPS/comments/1xujq3n/', date: '2026-11-12', note: 'thread' },
}

export const guide = {
  path: '/start/ups',
  title: 'Getting hired at UPS',
  crumbLabel: 'UPS',
  eyebrow: 'Company guide',
  // The one-sentence answer under the h1 (no figure: the figures live in the tiles).
  answer: { text: 'Most people start at UPS in a part-time warehouse job or a seasonal delivery job that asks for no experience, and some get an offer online with no interview. The full-time driving jobs are filled mostly from inside, by seniority, under the Teamsters contract.', src: ['ups-home', 'ups-hourly', 'post-handler', 'post-helper', 'nma'] },
  metaDescription: 'How people get hired at UPS: package handler, seasonal driver helper, own-car driver, package car driver, tractor-trailer and mechanic jobs, the pay UPS posts, the Teamsters contract scales, moving from part-time to full-time, Earn and Learn, and UPS jobs open now.',
  asOf: '2026-11-17',
}

// The three readings in the hero: each restates a fact below, with the same references.
export const tiles = [
  { label: 'Package handler pay', value: '$21.00/hr', text: 'base pay on most of UPS\'s own warehouse worker and package handler postings in November 2026', src: ['ups-board', 'post-handler'] },
  { label: 'New part-timer scale', value: '$21 to $23/hr', text: 'under the Teamsters contract: $23 after four years, and $23 to start for anyone hired after August 1, 2027', src: ['nma'] },
  { label: 'Full-time jobs offered', value: '22,500', text: 'full-time openings UPS agreed to offer its part-timers over the 2023–2028 contract, 7,500 of them new jobs', src: ['nma'] },
]

// 1. The jobs people start in (UPS's own titles), with the pay its postings state.
export const roles = [
  {
    name: 'Package handler', aka: 'Warehouse worker: preload, sort, unload',
    body: { text: 'Loads and unloads trailers and brown trucks, or sorts packages, in a building of conveyor belts and machinery. Shifts run about 3:00 to 9:00 AM (preload), 10:30 AM to 4:30 PM, 5:00 to 10:00 PM (twilight) or 11:00 PM to 3:00 AM, and vary by building.', src: ['post-handler', 'ups-warehouse'] },
    chips: [{ text: '$21.00/hr on most postings', src: ['ups-board', 'post-handler'] }, { text: 'No experience asked', src: ['post-handler'] }],
  },
  {
    name: 'Driver helper', aka: 'Seasonal, October to December',
    body: { text: 'Rides with a delivery driver and runs packages to the door; helpers never drive the truck. UPS hires helpers only for the holiday season, offers work each morning by call or text, and asks that you be ready within 30 minutes.', src: ['ups-helpers', 'post-helper'] },
    chips: [{ text: '$17.75–$21.00/hr by state', src: ['ups-board', 'post-helper'] }, { text: 'No driver\'s license needed', src: ['ups-helpers'] }],
  },
  {
    name: 'Seasonal support driver', aka: 'Delivers in your own vehicle',
    body: { text: 'Delivers packages from your own car or covered pickup during the holiday season. You must be 21 or older, with a clean, valid license, a registered and insured vehicle under 10,000 pounds, and no other company logos or bumper stickers on it.', src: ['ups-ssd', 'post-ssd'] },
    chips: [{ text: '$23.00/hr on most postings', src: ['ups-board', 'post-ssd'] }, { text: 'Plus $0.76 a mile', src: ['post-ssd'] }],
  },
  {
    name: 'Package delivery driver', aka: 'The brown truck, no CDL',
    body: { text: 'Drives a set route and delivers all day, typically 8 to 10 hours, in all weather. You must be 21, hold a regular license from your state, pass a DOT physical and a UPS driving test, and your driving record is checked.', src: ['ups-pdd', 'post-pdd'] },
    chips: [{ text: '$23.00/hr on most seasonal postings', src: ['ups-board', 'post-pdd'] }],
  },
  {
    name: 'Warehouse worker / cover driver', aka: 'Part-time warehouse, driving when needed',
    body: { text: 'A part-time warehouse job of 3.5 to 5 hours a day that also covers delivery routes of 8 to 10 hours when the building needs a driver. Same rules as a delivery driver: 21 or older, a DOT physical and a UPS driving test.', src: ['ups-cover'] },
    chips: [],
  },
  {
    name: 'Tractor-trailer driver', aka: 'Feeder driver, Class A CDL', link: 'https://seenjobs.io/start/cdl',
    body: { text: 'Pulls trailers between UPS buildings or to customers and is home after each shift; UPS also runs sleeper teams that spend 4 to 6 days on the road. It takes a Class A CDL, a doubles/triples endorsement in some places, a road test, a DOT physical and a drug screen. Loading and unloading is done for you.', src: ['ups-ttd', 'ups-hourly', 'ups-apply', 'post-feeder'] },
    chips: [{ text: '$35–$37/hr on most seasonal postings', src: ['ups-board', 'post-feeder'] }],
  },
  {
    name: 'Mechanic', aka: 'Fleet, trailer and building maintenance',
    body: { text: 'Fleet mechanics keep delivery trucks, tractors and trailers running, on second or third shift. The postings ask for documented automotive experience, your own hand tools and a driver\'s license, with a CDL preferred. A part-time apprentice posting asks only for age 18 and a high school diploma or equivalent.', src: ['post-mech', 'post-appr'] },
    chips: [{ text: '$40.14/hr start, Edgerton, KS', src: ['post-mech'] }, { text: 'Apprentice $24.10/hr, Hodgkins, IL', src: ['post-appr'] }],
  },
]
export const cdlNote = { text: 'No CDL yet? The tractor-trailer card links to Seen\'s guide to getting one. UPS\'s own driving jobs without a CDL are the package delivery, cover and seasonal support driver jobs above.', src: ['ups-pdd', 'ups-cover', 'ups-ssd'] }
export const storeNote = { text: 'The UPS Store is a different employer: its stores are independently owned and operated by franchisees, and their staff are the franchisee\'s employees, not UPS\'s.', src: ['tus-careers'] }

// 2. Pay: what UPS posts, and what the contract sets.
export const unionIntro = { text: 'Most UPS hourly jobs are union jobs: nearly 80% of UPS\'s U.S. employees are represented by unions, mainly the Teamsters, under a national contract that runs from August 1, 2023 to July 31, 2028. Local supplements add rules for each area.', src: ['sec-10k', 'nma', 'ibt-ratify'] }
export const payRows = [
  { role: 'Warehouse worker / package handler', pay: '$21.00 on most; $25.00 on a few', src: ['ups-board', 'post-handler'] },
  { role: 'Driver helper (seasonal)', pay: '$21.00, $18.40 or $17.75, by state', src: ['ups-board', 'post-helper'] },
  { role: 'Seasonal support driver (own car)', pay: '$23.00 on most; $28.00 in some states; plus $0.76 a mile', src: ['ups-board', 'post-ssd'] },
  { role: 'Seasonal package delivery driver', pay: '$23.00 on most; $24.84 in Illinois', src: ['ups-board', 'post-pdd'] },
  { role: 'Seasonal tractor-trailer driver', pay: '$35.00–$37.00 on most', src: ['ups-board', 'post-feeder'] },
  { role: 'Mechanic Journeyman, Edgerton, KS', pay: '$40.14 to start', src: ['post-mech'] },
  { role: 'Part-time mechanic apprentice, Hodgkins, IL', pay: '$24.10 to start', src: ['post-appr'] },
]
export const payNote = { text: 'Base pay per hour as stated on UPS\'s own postings on November 17, 2026. Where a job is union-represented, UPS\'s postings say pay and benefits follow the union contract.', src: ['ups-board', 'post-mech', 'post-appr'] }
export const scaleRows = [
  { step: 'Start', pt: '$21.00', ft: '$23.00', src: ['nma'] },
  { step: 'After 12 months', pt: '$21.50', ft: '$24.00', src: ['nma'] },
  { step: 'After 24 months', pt: '$22.00', ft: '$25.00', src: ['nma'] },
  { step: 'After 36 months', pt: '$22.50', ft: '$30.75', src: ['nma'] },
  { step: 'After 48 months', pt: '$23.00', ft: 'Top rate', src: ['nma'] },
]
export const scaleIntro = { text: 'The national contract\'s hourly scale for part-timers hired after August 1, 2023, and for anyone entering a full-time package car, feeder or certain other full-time jobs after that date. The contract calls these rates a minimum.', src: ['nma'] }
export const dates = [
  { name: 'August 1, 2027', text: 'The part-time start rate becomes $23.00, and part-timers still moving up the scale are raised to $23.00.', src: ['nma'] },
  { name: 'Each contract year', text: 'Workers who had seniority when the contract began get raises: $1.00 an hour in 2026 and $2.25 in 2027, after $2.75, $0.75 and $0.75 in 2023 to 2025.', src: ['nma'] },
  { name: 'July 31, 2028', text: 'The contract ends; UPS\'s annual report gives the same date.', src: ['nma', 'sec-10k'] },
]
export const topRate = { text: 'The national contract writes the full-time driver top rate as "Top Rate" without a figure; it differs by area. The Teamsters said the contract raises full-time drivers\' average top rate to $49 an hour.', src: ['nma', 'ibt-ratify'] }
export const mechNote = { text: 'Mechanics under the Teamsters contract start at 85% of the top rate and reach it after 12 months. About 3,000 UPS auto and maintenance mechanics work under a separate machinists\' union contract instead.', src: ['nma', 'sec-10k'] }
export const benefits = [
  { text: 'UPS\'s package handler posting lists a 401(k), a defined-benefit pension, medical, dental and vision after a waiting period with a $0 healthcare premium, paid vacation, paid holidays and an education assistance program.', src: ['post-handler'] },
  { text: 'UPS pays weekly.', src: ['ups-warehouse', 'ups-pdd'] },
  { text: 'Under the contract, part-timers are paid for at least three and a half hours on each day they work.', src: ['nma'] },
  { text: 'The contract made Martin Luther King Jr. Day a named holiday.', src: ['nma', 'ibt-ratify'] },
]
export const earn = { text: 'Earn and Learn, UPS\'s tuition help, pays up to $5,250 a calendar year and $25,000 in a lifetime, for any subject, from your first day of work. It is offered only at some locations, so ask at the building you apply to.', src: ['ups-earn'] }

// 3. Part-time to full-time, as the contract describes it.
export const ladder = {
  intro: { text: 'Under the contract, part-timers get six of every seven full-time jobs before UPS hires anyone from outside.', src: ['nma'] },
  items: [
    { name: 'Full-time openings for part-timers', text: 'UPS agreed to offer part-timers at least 22,500 full-time openings over the contract, including 7,500 new full-time jobs made from part-time ones: 1,000 in its third year, 3,000 in the fourth and 3,500 in the fifth.', src: ['nma'] },
    { name: 'A better part-time job after six months', text: 'Part-timers with six months\' seniority can sign a list for preferred jobs in their building, such as preload, sorter, clerical or carwasher.', src: ['nma'] },
    { name: 'Part-timers rarely drive', text: 'A part-timer drives only when no full-timer is on site, to avoid a delay, or in air operations.', src: ['nma'] },
    { name: 'A 30-day qualification period', text: 'The contract refers to a thirty-day qualification period for new drivers, alongside UPS\'s driver training.', src: ['nma', 'ups-pdd'] },
    { name: 'No forced work on days off', text: 'Regular package car drivers cannot be forced to work a day outside their scheduled workweek.', src: ['nma', 'ibt-ratify'] },
  ],
}
export const ladderSay = [
  { text: 'People who made the move describe waits from under a year to more than ten years, depending on their building.', src: ['r-1q0rq9x', 'r-1pfdon1'], firstHand: true },
  { text: 'The path they describe: an inside part-time job, then the cover driver list, then a full-time spot when one opens.', src: ['r-1q0rq9x', 'r-1pfdon1'], firstHand: true },
]
export const cuts = { text: 'Openings depend on volume. UPS\'s annual report says it cut about 48,000 operational positions in 2025, including 15,000 fewer seasonal ones, closed daily operations at 93 buildings, named 24 more to close in the first half of 2026, and offered full-time drivers a voluntary separation program.', src: ['sec-10k'] }

// 4. Seasonal jobs.
export const seasonal = {
  intro: { text: 'UPS\'s busy season usually runs October to December, and seasonal jobs have a set end date. Under the contract, seasonal support drivers who use their own vehicles are hired for November 15 to December 26 each year.', src: ['ups-warehouse', 'nma'] },
  ssdTerms: { text: 'Seasonal support drivers are W-2 employees and union members, paid for at least three hours a day they work, reimbursed for every delivery mile and covered by insurance for their vehicle while working. UPS\'s current part-timers and cover drivers get this work before new hires.', src: ['nma'] },
  vehicle: [
    { name: 'Registered and insured', text: 'Proof of registration and at least the insurance your state requires.', src: ['post-ssd'] },
    { name: 'Under 10,000 pounds', text: 'A four-door car, or a pickup with a covered, secured bed.', src: ['post-ssd'] },
    { name: 'No other logos', text: 'No company markings, bumper stickers or political stickers.', src: ['post-ssd'] },
    { name: 'Phone close by', text: 'Work is offered each morning by call or text; some locations pay a phone stipend.', src: ['post-ssd', 'ups-ssd'] },
  ],
  after: { text: 'UPS says many people start in a seasonal job and later move into other UPS jobs, but it does not promise work after the season.', src: ['post-helper', 'post-ssd'] },
}
export const seasonalSay = [
  { text: 'Seasonal helpers who asked about staying on were told few are kept after the holidays, and that the usual way to stay is to apply for a permanent part-time job inside.', src: ['r-1pe4e72', 'r-1pfdon1', 'r-1p2maok'], firstHand: true },
  { text: 'New helpers describe sore legs from stairs and climbing in and out of the truck; drivers tell them to walk quickly, never jog.', src: ['r-1p4xwor', 'r-1p2maok', 'r-1xqqyhf'], firstHand: true },
  { text: 'Work comes by text, and some days no call comes, such as on a day of heavy rain.', src: ['r-1xqqyhf', 'r-1xujq3n'], firstHand: true },
]

// 5. How hiring works.
export const apply = {
  site: { text: 'UPS takes applications on its own careers site, and says that is the place to start.', src: ['ups-board', 'ups-fraud'] },
  steps: [
    { step: 'Apply online and watch a short video', text: 'For warehouse jobs you could get an offer and pick your first day in under 10 minutes. UPS says most hourly hiring has no interview step.', src: ['ups-apply', 'ups-home', 'ups-metro'] },
    { step: 'Drivers: road test and DOT physical', text: 'After an offer, delivery and cover drivers schedule a road test and a DOT physical; tractor-trailer drivers also pass a drug screen. Your driving record is checked in the background check.', src: ['ups-apply', 'ups-pdd'] },
    { step: 'Prove you can work in the U.S.', text: 'Submit identity and work-eligibility documents online, then bring the originals; copies are not accepted.', src: ['ups-apply', 'ups-warehouse'] },
    { step: 'Training', text: 'Drivers pass an online pre-course, then a multi-day training program, then coaching on their own route.', src: ['ups-pdd'] },
  ],
  firstDay: [
    { name: 'Sturdy shoes', text: 'Leather or similar uppers with non-slip soles; sneakers, loafers and sandals are not allowed. Helpers\' shoes must be black or brown.', src: ['ups-warehouse', 'ups-helpers'] },
    { name: 'Layers and water', text: 'Buildings change temperature through a shift, and UPS says the work is very physical.', src: ['ups-warehouse'] },
    { name: 'Your own way there', text: 'You need reliable transportation to the building or the helper meet point.', src: ['ups-warehouse', 'ups-helpers'] },
  ],
}

// 6. Safety and scams.
export const safety = {
  lift: { text: 'Every warehouse, helper and driver posting we read asks you to lift up to 70 pounds.', src: ['post-handler', 'post-helper', 'post-ssd', 'post-pdd', 'post-feeder'] },
  heat: [
    { name: 'A heat plan and training', text: 'UPS must have a heat illness prevention plan, train employees on it, and name someone on each shift who can call emergency services.', src: ['nma'] },
    { name: 'An easier first week', text: 'New employees get a lighter workload for their first 5 to 7 working days to get used to the heat.', src: ['nma'] },
    { name: 'Water, ice and fans', text: 'Drinking water and ice in every building, and at least 18,000 more fans and 2,500 more water fountains over the contract.', src: ['nma'] },
    { name: 'Air conditioning in new trucks', text: 'Package cars and vans bought after January 1, 2024 must have in-cab air conditioning, and the contract required two fans and exhaust heat shields in older package cars.', src: ['nma', 'ibt-ratify'] },
  ],
  osha: { text: 'OSHA\'s advice for heat is water, rest and shade. Heat stroke is the most serious heat illness and needs medical help right away.', src: ['osha-heat'] },
}
export const scams = [
  { text: 'UPS says it charges no application fee or any other fee to apply, and warns of fake job offer letters.', src: ['ups-fraud'] },
  { text: 'The FTC: "Honest employers, including the federal government, will never ask you to pay to get a job."', src: ['ftc-jobs'] },
  { text: 'No real employer sends you a check to deposit and asks you to send part of it back.', src: ['ftc-jobs'] },
]

// FAQ — visible on the page and mirrored in FAQPage JSON-LD.
export const faq = [
  {
    q: 'Do I need experience to work at UPS?',
    a: { text: 'Not for warehouse, driver helper or seasonal support driver jobs: their postings say no prior experience is needed. You must be able to lift up to 70 pounds and be authorized to work in the U.S. Delivery drivers must also be 21 and pass a DOT physical and a UPS driving test.', src: ['post-handler', 'post-helper', 'post-ssd', 'ups-pdd'] },
  },
  {
    q: 'How much does UPS pay package handlers?',
    a: { text: '$21.00 an hour base pay on most of UPS\'s own postings in November 2026, and $25.00 on a few. Under the Teamsters contract, new part-timers reach $23.00 after four years, and anyone hired after August 1, 2027 starts at $23.00.', src: ['ups-board', 'post-handler', 'nma'] },
  },
  {
    q: 'Do I need a CDL to drive for UPS?',
    a: { text: 'Not for the brown truck: package delivery drivers need a regular license from their state, must be 21, and must pass a DOT physical and a UPS driving test. Tractor-trailer drivers need a Class A CDL, and in some places a doubles/triples endorsement.', src: ['ups-pdd', 'ups-ttd'] },
  },
  {
    q: 'How do you go from part-time to full-time at UPS?',
    a: { text: 'Mostly by seniority: the contract gives part-timers six of every seven full-time jobs before UPS hires from outside. UPS also agreed to offer part-timers 22,500 full-time openings over the 2023–2028 contract.', src: ['nma'] },
  },
  {
    q: 'Is The UPS Store part of UPS?',
    a: { text: 'Its stores are independently owned and operated by franchisees, and their staff are the franchisee\'s employees, not UPS\'s. Jobs with UPS itself are on UPS\'s careers site.', src: ['tus-careers', 'ups-board'] },
  },
  {
    q: 'Does UPS charge a fee to apply?',
    a: { text: 'No. UPS says it charges no application fee or any other fee, and warns of fake job offer letters. Apply only on UPS\'s own careers site.', src: ['ups-fraud'] },
  },
]

// ── Listings: the filters on the "Hiring now" block (lib/start/listingFilters.js) ──────────────────────────────────
// A company guide: `employer` keeps only rows whose company is exactly "UPS" or "United Parcel Service" (Seen held 61
// active such rows on 2026-11-17, all from Adzuna, and two read back as UPS's own posting text). The anchor keeps out
// "The UPS Store" (franchise employers; Seen held no such rows) and look-alikes the word matches inside ("Upstart",
// "upshop", "veterinaryemergencygroupst"). Excluded titles: UPS's internal "… - Sourcing Only" hub rows, supervisors and
// sales jobs (not the hourly jobs this page covers). Nationwide, "driver helper" rows are 18 of 19 UPS's and "package
// driver" 1 of 1; "package handler" rows are mostly other employers, so the handler chip also runs UPS's own title
// ("warehouse worker package handler"). Seen held no UPS tractor-trailer rows on 2026-11-17 (the chip shows the honest
// empty line until it does) and one mechanic row. UPS's hourly jobs take beginners, so a plain title is entry level;
// "journeyman", "lead" or a supervisor title reads as experienced.
export const listings = {
  defaultRadius: '50',
  radii: ['25', '50', '100', '250'],
  levelMode: 'entryUnlessMarked',
  levelLabels: { any: 'Any level', entry: 'No experience needed', experienced: 'Experienced' },
  levelWords: { entry: 'entry-level', experienced: 'experienced' },
  employer: '^\\s*(ups|united parcel service(?:,? inc\\.?)?)\\s*$',
  exclude: '\\bsourcing only\\b|supervisor|\\bsales\\b|recruit|coordinator|engineer',
  positions: [
    { id: 'all', label: 'All UPS hourly jobs', noun: 'UPS hourly', mix: 'positions', queries: ['driver helper', 'warehouse worker package handler', 'package driver', 'tractor trailer driver', 'maintenance mechanic'], seeAll: 'ups' },
    { id: 'handler', label: 'Package handler', noun: 'UPS package handler', queries: ['warehouse worker package handler', 'package handler', 'air ramp package handler'], match: 'package handler|warehouse worker|air handler|loader|unloader|sorter|preload', seeAll: 'package handler' },
    { id: 'helper', label: 'Driver helper (seasonal)', noun: 'UPS driver helper', queries: ['driver helper', 'package delivery helper', 'delivery assistant'], match: 'driver helper|delivery helper|delivery assistant', seeAll: 'driver helper' },
    { id: 'driver', label: 'Package driver', noun: 'UPS package driver', queries: ['package driver', 'delivery driver', 'seasonal support driver'], match: '(package|delivery|route|parcel|support|cover)\\b[^,]*\\bdrive|driver\\s*-\\s*courier', seeAll: 'package driver' },
    { id: 'feeder', label: 'Tractor-trailer (CDL)', noun: 'UPS tractor-trailer', queries: ['tractor trailer driver', 'feeder driver', 'cdl a driver'], match: 'tractor|feeder|trailer driver|\\bcdl\\b', seeAll: 'tractor trailer driver' },
    { id: 'mechanic', label: 'Mechanic', noun: 'UPS mechanic', queries: ['maintenance mechanic', 'automotive technician', 'mechanic'], match: 'mechanic|technician', seeAll: 'ups mechanic' },
  ],
}

// ── The page's openable rows (components/start/Guide.tsx renders each block type) ─────────────────────────────────
export const menu = [
  {
    id: 'jobs', title: 'Jobs you can start in', summary: 'Warehouse, seasonal, drivers, mechanics',
    blocks: [
      { type: 'cards', items: roles },
      { type: 'text', entry: cdlNote },
      { type: 'note', entry: storeNote },
    ],
  },
  {
    id: 'pay', title: 'Pay and the Teamsters contract', summary: 'Posted pay, contract scales, dates',
    blocks: [
      { type: 'text', entry: unionIntro },
      { type: 'table', caption: 'Base pay on UPS’s own postings', columns: [{ key: 'role', label: 'Job' }, { key: 'pay', label: 'Hourly base pay', num: true }], rows: payRows },
      { type: 'note', entry: payNote },
      { type: 'heading', text: 'What the contract sets' },
      { type: 'text', entry: scaleIntro },
      { type: 'table', caption: 'Contract hourly scale for new hires', columns: [{ key: 'step', label: 'Step' }, { key: 'pt', label: 'New part-timer', num: true }, { key: 'ft', label: 'New full-time driver', num: true }], rows: scaleRows },
      { type: 'checklist', items: dates },
      { type: 'text', entry: topRate },
      { type: 'more', title: 'Mechanics, benefits and tuition help', blocks: [
        { type: 'text', entry: mechNote },
        { type: 'notes', items: benefits },
        { type: 'text', entry: earn },
      ] },
    ],
  },
  {
    id: 'full-time', title: 'From part-time to full-time', summary: 'Seniority, the six-for-one rule, the wait',
    blocks: [
      { type: 'text', entry: ladder.intro },
      { type: 'checklist', items: ladder.items },
      { type: 'text', plain: 'What people who made the move say. More than one account agrees on each of these.' },
      { type: 'notes', items: ladderSay },
      { type: 'callout', entry: cuts },
    ],
  },
  {
    id: 'seasonal', title: 'Seasonal jobs', summary: 'Helpers, own-car drivers, after the season',
    blocks: [
      { type: 'text', entry: seasonal.intro },
      { type: 'text', entry: seasonal.ssdTerms },
      { type: 'more', title: 'What your vehicle needs', blocks: [{ type: 'checklist', items: seasonal.vehicle, cols: true }] },
      { type: 'text', entry: seasonal.after },
      { type: 'text', plain: 'What seasonal workers say. More than one account agrees on each of these.' },
      { type: 'notes', items: seasonalSay },
    ],
  },
  {
    id: 'apply', title: 'How hiring works', summary: 'Apply online, offer, checks, first day',
    blocks: [
      { type: 'cards', items: [{ name: 'UPS careers', aka: 'UPS’s own job search', link: CAREERS, body: apply.site }] },
      { type: 'steps', items: apply.steps },
      { type: 'more', title: 'Your first day', blocks: [{ type: 'checklist', items: apply.firstDay }] },
      { type: 'resumeLink', before: 'For mechanic and office jobs, which take a résumé, you can', label: 'check your résumé against a UPS posting' },
    ],
  },
  {
    id: 'safety', title: 'Safety and scams', icon: 'caution', summary: 'Lifting, heat rules, fake job offers',
    blocks: [
      { type: 'text', entry: safety.lift },
      { type: 'heading', text: 'Heat rules in the contract' },
      { type: 'checklist', items: safety.heat, cols: true },
      { type: 'note', entry: safety.osha },
      { type: 'notes', label: 'Scams', items: scams, icon: 'x', caution: true },
    ],
  },
  { id: 'questions', title: 'Common questions', summary: 'Experience, pay, CDL, full-time, fees', blocks: [{ type: 'faq', items: faq }] },
]

// ── Additional resources: every reference above, as plain grouped links (no numbers, closed by default) ────────────
export const resourcesSummary = 'UPS careers, the contract, public records'
export const resources = [
  { title: 'UPS careers', items: [
    { key: 'ups-board', name: 'UPS job search' },
    { key: 'ups-home', name: 'UPS careers home' },
    { key: 'ups-hourly', name: 'Hourly roles at UPS' },
    { key: 'ups-apply', name: 'Application and onboarding' },
    { key: 'ups-warehouse', name: 'Warehouse workers: shifts and first day' },
    { key: 'ups-helpers', name: 'Driver helpers' },
    { key: 'ups-ssd', name: 'Seasonal support drivers' },
    { key: 'ups-pdd', name: 'Package delivery drivers' },
    { key: 'ups-cover', name: 'Warehouse worker / cover driver' },
    { key: 'ups-ttd', name: 'Tractor-trailer drivers' },
    { key: 'ups-earn', name: 'Earn and Learn tuition help' },
    { key: 'ups-metro', name: 'Metropolitan College, Louisville' },
    { key: 'ups-fraud', name: 'Avoid fraud' },
  ] },
  { title: 'UPS postings on this page', items: [
    { key: 'post-handler', name: 'Warehouse Worker - Package Handler, Salt Lake City, UT' },
    { key: 'post-helper', name: 'Driver Helper, Great Bend, KS' },
    { key: 'post-ssd', name: 'Seasonal Support Driver, Hutchinson, KS' },
    { key: 'post-pdd', name: 'Seasonal Package Delivery Driver, Salt Lake City, UT' },
    { key: 'post-feeder', name: 'Seasonal Tractor Trailer Driver, Arlington, TX' },
    { key: 'post-mech', name: 'Mechanic Journeyman, Edgerton, KS' },
    { key: 'post-appr', name: 'Part-time Mechanic Apprentice, Hodgkins, IL' },
  ] },
  { title: 'The Teamsters contract', items: [
    { key: 'nma', name: 'UPS National Master Agreement, 2023–2028 (Teamsters)' },
    { key: 'ibt-ratify', name: 'The Teamsters’ summary of the contract' },
  ] },
  { title: 'Public records', items: [
    { key: 'sec-10k', name: 'UPS annual report, 2025 (SEC)' },
  ] },
  { title: 'Safety and scams', items: [
    { key: 'osha-heat', name: 'Working in heat (OSHA)' },
    { key: 'ftc-jobs', name: 'Job scams (Federal Trade Commission)' },
  ] },
  { title: 'The UPS Store', items: [
    { key: 'tus-careers', name: 'The UPS Store careers and franchise notice' },
  ] },
  { title: 'Community discussions', items: [
    { key: 'r-1q0rq9x', name: 'How long it took to become a full-time driver' },
    { key: 'r-1pfdon1', name: 'Staying on after a seasonal helper job' },
    { key: 'r-1pe4e72', name: 'Seasonal helper to full-time' },
    { key: 'r-1p2maok', name: 'Two days as a driver helper' },
    { key: 'r-1p4xwor', name: 'A first week as a driver helper' },
    { key: 'r-1xqqyhf', name: 'Questions before applying as a driver helper' },
    { key: 'r-1xujq3n', name: 'A new driver helper\'s first day' },
  ] },
]

/** Every fact on the page, in reading order: the hero, then each menu row. */
export function pageEntries() {
  return [guide.answer, ...tiles, ...blockEntries(menu)]
}
