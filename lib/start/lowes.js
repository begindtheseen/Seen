// /start/lowes — "Getting hired at Lowe's". A COMPANY guide: the page renders from this module only, so every figure on
// it carries a reference and an as-of date (lib/start/guides.test.mjs fails on a figure without one).
//
// THE ONLY SOURCE OF FACTS is the research file compiled 2026-11-17 (session scratchpad guides20/lowes/research.md):
//   • Lowe's own careers pages on talent.lowes.com (getting hired, FAQ, role pages, benefits, Track to the Trades);
//   • Lowe's own postings, read in full on 2026-11-17 through the public JSON of Lowe's Workday job site
//     (lowes.wd5.myworkdayjobs.com/LWS_External_CS — the site every talent.lowes.com "Apply" button opens). Pay is
//     printed only from a posting's own "Pay Range:" line, with the posting's place: Lowe's prints a range on postings in
//     states with pay-range laws, so no range is shown for any other state;
//   • Lowe's Form 10-K for the fiscal year ended January 30, 2026 (SEC EDGAR) and Lowe's 2025 Impact and Culture Report;
//   • the Lowe's Foundation's own Gable Grants pages and its April 7, 2026 announcement; the FTC.
// Rules this module keeps:
//   • FIRST-HAND items (several accounts in at least two threads agreeing) only as `firstHand: true`;
//   • nothing UNVERIFIED or CONFLICTING: no Track to the Trades participant count or launch year (Lowe's own pages say
//     20,000 since 2022 and 31,000 since 2018/2022), no drug-test policy (no posting read states one), no store
//     assessment test (Lowe's describes none for store or warehouse jobs), no wait before tuition-free education starts
//     (only a 2022 report states one), no review-site or news figures;
//   • no lawsuits, executives or stock; no hype, no guarantees, no exclamation marks;
//   • `listings = null`: Seen held 9 active Lowe's rows on 2026-11-17 against thousands on Lowe's own site, so the page
//     shows no listings block and sends people to Lowe's own search (the "Where to find Lowe's open jobs" row).
//
// Shape: `sources` (every reference behind the page, kept here and NEVER printed as citations — readers reach the
// links through the grouped "Additional resources" menu, `resources` below), entries `{ text, src, firstHand? }`,
// `listings` (null here) and the openable menu rows (`menu`, rendered by components/start/Guide.tsx). Pure data;
// relative imports only so `node --test` runs it as is.

import { blockEntries } from './entries.js'

/** @typedef {{ label: string, url: string, date: string, note?: string }} Source */

const TALENT = 'https://talent.lowes.com/us/en'
const SEARCH = `${TALENT}/search-results`
const READ = 'read 2026-11-17 on Lowe\'s own job site (talent.lowes.com, which opens Lowe\'s Workday postings)'

/** @type {Record<string, Source>} */
export const sources = {
  'lowes-search': { label: 'Lowe\'s careers, job search (talent.lowes.com)', url: SEARCH, date: '2026-11-17', note: 'checked' },
  'getting-hired': { label: 'Lowe\'s careers, "Getting hired": the hiring process for store and warehouse roles', url: `${TALENT}/getting-hired`, date: '2026-11-17', note: 'read' },
  'lowes-faq': { label: 'Lowe\'s careers, Frequently Asked Questions (applying, age, schedules, pay, hiring time, onboarding)', url: `${TALENT}/faq`, date: '2026-11-17', note: 'read' },
  'store-careers': { label: 'Lowe\'s careers, Store Careers page (promotion and bonus figures for 2024)', url: `${TALENT}/store-careers`, date: '2026-11-17', note: 'read' },
  'career-progression': { label: 'Lowe\'s careers, Career Progression page', url: `${TALENT}/career-progression`, date: '2026-11-17', note: 'read' },
  'benefits': { label: 'Lowe\'s careers, Compensation and Benefits page', url: `${TALENT}/compensation-benefits`, date: '2026-11-17', note: 'read' },
  'supply-chain': { label: 'Lowe\'s careers, Supply Chain Careers page', url: `${TALENT}/supply-chain-careers`, date: '2026-11-17', note: 'read' },
  't2t': { label: 'Lowe\'s careers, Track to the Trades page', url: `${TALENT}/track-to-the-trades`, date: '2026-11-17', note: 'read' },
  'role-cashier': { label: 'Lowe\'s careers, Cashier page', url: `${TALENT}/cashier`, date: '2026-11-17', note: 'read' },
  'role-csa': { label: 'Lowe\'s careers, Customer Service Associate page', url: `${TALENT}/customer-service-associate`, date: '2026-11-17', note: 'read' },
  'role-mst': { label: 'Lowe\'s careers, Merchandising Service Team page', url: `${TALENT}/merchandising-service-team`, date: '2026-11-17', note: 'read' },
  'role-receiver': { label: 'Lowe\'s careers, Receiver / Stocker page', url: `${TALENT}/receiver-stocker`, date: '2026-11-17', note: 'read' },
  // Lowe's own postings, read in full 2026-11-17 (posting ID, place, date posted). Each link opens Lowe's own search or
  // role page for that job, since a single posting closes within weeks.
  'post-cashier': { label: `Lowe's postings, Cashier: Cashier Part Time JR-02690842, West Hills, CA (posted 2026-11-03); Full Time - Cashier - Day JR-02707216, Fountain, CO (2026-11-17); ${READ}`, url: `${TALENT}/cashier`, date: '2026-11-17', note: 'read' },
  'post-sales': { label: `Lowe's postings, store sales: Sales Associate - Plumbing JR-02707069, Hamburg, NY (2026-11-17); Sales Associate - ProServices JR-02705201, Owatonna, MN (2026-11-13); Sales Specialist - ProServices JR-02704517, Pasco, WA (2026-11-16); ${READ}`, url: `${TALENT}/customer-service-associate`, date: '2026-11-17', note: 'read' },
  'post-mst': { label: `Lowe's posting, Full Time - Merchandising Service Associate - Day JR-02706586, Vancouver, WA (2026-11-16); ${READ}`, url: `${TALENT}/merchandising-service-team`, date: '2026-11-17', note: 'read' },
  'post-loader': { label: `Lowe's posting, Part Time - Loader/Cart Associate - Flexible JR-02706581, Clinton, MD (2026-11-16); ${READ}`, url: `${SEARCH}?keywords=loader`, date: '2026-11-17', note: 'read' },
  'post-receiver': { label: `Lowe's postings, Receiver/Stocker: Day JR-02705750, Longmont, CO (2026-11-16); Overnight JR-02705043, Bellingham, WA (2026-11-13); ${READ}`, url: `${TALENT}/receiver-stocker`, date: '2026-11-17', note: 'read' },
  'post-fulfill': { label: `Lowe's posting, Full Time - Fulfillment Associate - Day JR-02707106, Kingston, NY (2026-11-17); ${READ}`, url: `${SEARCH}?keywords=fulfillment%20associate`, date: '2026-11-17', note: 'read' },
  'post-driver': { label: `Lowe's postings, drivers: CDL Delivery Driver JR-02706923, Mount Vernon, WA (2026-11-17), JR-02622341, Plymouth, MN (2026-11-17) and JR-02706283, Colorado Springs, CO (2026-11-16); Delivery Driver I JR-02650950, Denver, CO (2026-11-05); ${READ}`, url: `${SEARCH}?keywords=cdl%20delivery%20driver`, date: '2026-11-17', note: 'read' },
  'post-dc': { label: `Lowe's posting, Team Member JR-02688294, Rockford, IL regional distribution center (2026-11-13); ${READ}`, url: `${TALENT}/c/supply-chain-jobs`, date: '2026-11-17', note: 'read' },
  'post-leaders': { label: `Lowe's postings, Sales Floor Dept Supervisor - Outside Garden and Lawn JR-02703059, Littleton, CO (2026-11-12); Specialty ASM JR-02705900, Glenwood Springs, CO (2026-11-16); ${READ}`, url: `${TALENT}/store-managers-supervisors-jobs`, date: '2026-11-17', note: 'read' },
  'sec-10k': {
    label: 'Lowe\'s Companies, Inc. Form 10-K for the fiscal year ended January 30, 2026 (SEC EDGAR)',
    url: 'https://www.sec.gov/Archives/edgar/data/60667/000006066726000029/low-20260130.htm',
    date: '2026-03-23', note: 'filed',
  },
  'icr-2025': {
    label: 'Lowe\'s 2025 Impact and Culture Report (Track to the Trades eligibility, tuition-free education)',
    url: 'https://corporate.lowes.com/sites/lowes-corp/files/2026-09/lowes-2025-icr-9-21-26.pdf',
    date: '2026-09', note: 'published',
  },
  'lf-gable': { label: 'Lowe\'s Foundation, Gable Grants program page', url: 'https://www.lowesfoundation.org/gable-grants', date: '2026-11-17', note: 'read' },
  'lf-faq': { label: 'Lowe\'s Foundation, Gable Grants frequently asked questions (eligibility, dates, award sizes)', url: 'https://www.lowesfoundation.org/gable-grants/faqs', date: '2026-11-17', note: 'read' },
  'lf-colleges': { label: 'Lowe\'s Foundation, Gable Grant recipients: community and technical colleges', url: 'https://www.lowesfoundation.org/gable-grants/community-and--technical-colleges', date: '2026-11-17', note: 'read' },
  'lf-start': { label: 'Lowe\'s Foundation, Get Started (NCCER CareerStarter)', url: 'https://www.lowesfoundation.org/get-started', date: '2026-11-17', note: 'read' },
  'lf-250': {
    label: 'Lowe\'s, "Lowe\'s Foundation Plans Expanded $250 Million Investment to Help Train and Develop 250,000 Tradespeople Over Next Decade"',
    url: 'https://corporate.lowes.com/newsroom/press-releases/lowes-foundation-plans-expanded-250-million-investment-help-train-and-develop-250000-tradespeople-over-next-decade-increasing-skilled-trades-workforce',
    date: '2026-04-07', note: 'published',
  },
  'ftc-text': {
    label: 'Federal Trade Commission consumer alert, "That job offer text is probably a scam"',
    url: 'https://www.consumer.ftc.gov/consumer-alerts/2026/04/job-offer-text-probably-scam',
    date: '2026-04-30', note: 'published',
  },
  'ftc-jobs': { label: 'Federal Trade Commission, "Job Scams"', url: 'https://www.consumer.ftc.gov/articles/job-scams', date: '2023-03', note: 'updated' },
  // First-hand accounts (r/Lowes, read through the Arctic Shift archive). Used only where accounts in at least two
  // threads agree, and rendered as what people say.
  'r-1s2yk1h': { label: 'r/Lowes, "Is this a real email for an interview seems like a scam"', url: 'https://www.reddit.com/r/Lowes/comments/1s2yk1h/', date: '2026-03-25', note: 'thread' },
  'r-1sic3vt': { label: 'r/Lowes, "Got the job during first interview"', url: 'https://www.reddit.com/r/Lowes/comments/1sic3vt/', date: '2026-04-11', note: 'thread' },
  'r-1rdfrdz': { label: 'r/Lowes, "Had in person interview a week ago, just got an email saying I have an interview tomorrow"', url: 'https://www.reddit.com/r/Lowes/comments/1rdfrdz/', date: '2026-02-24', note: 'thread' },
  'r-1qwz25b': { label: 'r/Lowes, "How long does it take to be hired after an interview"', url: 'https://www.reddit.com/r/Lowes/comments/1qwz25b/', date: '2026-02-05', note: 'thread' },
  'r-1s8sko7': { label: 'r/Lowes, what to wear to a Lowe\'s interview', url: 'https://www.reddit.com/r/Lowes/comments/1s8sko7/', date: '2026-03-31', note: 'thread' },
  'r-1srr9n4': { label: 'r/Lowes, "Interview process?"', url: 'https://www.reddit.com/r/Lowes/comments/1srr9n4/', date: '2026-04-21', note: 'thread' },
}

export const guide = {
  path: '/start/lowes',
  title: 'Getting hired at Lowe\'s',
  crumbLabel: 'Lowe\'s',
  eyebrow: 'Guide',
  // The one-sentence answer under the h1 (no figure: the figures live in the tiles).
  answer: { text: 'Most Lowe\'s store jobs ask for no degree or retail experience: you apply online or through Luci, Lowe\'s recruiting assistant, then interview in person at the store. Lowe\'s says store and warehouse jobs generally need evening or weekend availability, and its CDL delivery driver jobs need a commercial license.', src: ['getting-hired', 'lowes-faq', 'post-cashier', 'post-sales', 'post-driver'] },
  metaDescription: 'How to get hired at Lowe\'s: store, warehouse and driver jobs, what the postings ask for, the pay Lowe\'s states, the interview, Track to the Trades, moving up to supervisor, and job scams.',
  asOf: '2026-11-17',
}

// The three readings in the hero: each restates a fact below, with the same references.
export const tiles = [
  { label: 'Lowest starting wage', value: '$15/hr', text: 'Lowe\'s minimum wage as of fiscal 2025, by its annual report. Each posting states its own range.', src: ['sec-10k'] },
  { label: 'Store hiring time', value: 'About 2 weeks', text: 'from application to offer for most store roles, Lowe\'s says', src: ['lowes-faq'] },
  { label: 'Store leaders from inside', value: '85%+', text: 'of store leadership jobs filled internally in the past year, Lowe\'s fiscal 2025 annual report says', src: ['sec-10k'] },
]

// 1. Store jobs (Lowe's own titles), what each posting asks, and the pay it states.
export const storeRoles = [
  {
    name: 'Cashier', aka: 'Front end',
    body: { text: 'Scans and bags items, runs the register, payments and exchanges, and helps at self-checkout. The postings ask for reading, writing and basic arithmetic, some computer use and lifting at least 10 lbs; retail experience and a second language are preferred, not required.', src: ['role-cashier', 'post-cashier'] },
    chips: [{ text: '$18.42–$19.45/hr in West Hills, CA', src: ['post-cashier'] }, { text: '$15.16–$15.60/hr in Fountain, CO', src: ['post-cashier'] }],
  },
  {
    name: 'Sales associate', aka: 'By department',
    body: { text: 'The postings call this job customer service associate: welcoming customers, answering questions, restocking shelves and preparing merchandise, such as mixing paint or cutting pipe, wood or blinds. Each works in one department, from Appliances, Plumbing and Paint to Tool Rental or Pro Services. The postings ask for 6 months of using a computer and phones or tablets and lifting 25 lbs; a trade certification for the department is preferred.', src: ['role-csa', 'post-sales'] },
    chips: [{ text: '$16.50–$17.20/hr in Hamburg, NY', src: ['post-sales'] }],
  },
  {
    name: 'Merchandising service associate', aka: 'Displays and resets',
    body: { text: 'Builds product displays and completes merchandise resets and store maintenance projects. Lowe\'s says most of this team can work a fixed Monday–Friday schedule. Reading planograms, power equipment and hand tools are preferred.', src: ['role-mst', 'post-mst'] },
    chips: [{ text: '$17.13–$18.40/hr in Vancouver, WA', src: ['post-mst'] }],
  },
  {
    name: 'Loader/cart associate', aka: 'Pro and garden loading',
    body: { text: 'Pulls and stages orders, loads customer and contractor vehicles and collects carts, including under the Pro canopy and in the Garden Center. The posting asks for 6 months of using a computer and phones or tablets, and loaders complete Lowe\'s required power-equipment and spotter training.', src: ['post-loader'] },
    chips: [{ text: '$16.50–$17.20/hr in Clinton, MD', src: ['post-loader'] }],
  },
  {
    name: 'Receiver/stocker', aka: 'Trucks and shelves',
    body: { text: 'Unloads trucks, sorts products and stocks shelves; shifts can be morning, evening or overnight, depending on the store. The minimum is a high school diploma, a GED or equal years of experience; forklift and warehouse experience are preferred.', src: ['role-receiver', 'post-receiver'] },
    chips: [{ text: '$16.50–$17.20/hr in Longmont, CO', src: ['post-receiver'] }, { text: '$19.13/hr overnight in Bellingham, WA', src: ['post-receiver'] }],
  },
  {
    name: 'Fulfillment associate', aka: 'Online orders',
    body: { text: 'Picks, stages and checks customer orders. The posting requires certification on a counterbalance forklift, an order picker and a narrow-aisle reach truck, which you must obtain if you do not already hold it.', src: ['post-fulfill'] },
    chips: [{ text: '$16.00–$16.15/hr in Kingston, NY', src: ['post-fulfill'] }],
  },
  {
    name: 'Pro sales', aka: 'ProServices desk',
    body: { text: 'Serves contractors and other Pro customers. A ProServices sales associate posting asks the same as other sales associates; a ProServices sales specialist posting asks for a year of sales and a year of customer service.', src: ['post-sales'] },
    chips: [{ text: 'Associate $15.00–$15.60/hr in Owatonna, MN', src: ['post-sales'] }, { text: 'Specialist $19.00–$19.80/hr in Pasco, WA', src: ['post-sales'] }],
  },
]
export const storeNote = { text: 'Store postings add work in hot, cold or wet weather inside and outside, single lifts limited to 75 pounds with team lifts above that, and any sales license or registration your state requires.', src: ['post-cashier', 'post-sales', 'post-mst'] }

// 2. Distribution centers and drivers.
export const scIntro = { text: 'Lowe\'s runs more than 120 supply chain facilities: regional, flatbed, import and bulk distribution centers, cross-dock terminals and fulfillment centers.', src: ['sec-10k'] }
export const scRoles = [
  {
    name: 'Distribution center team member', aka: 'Receiving, building, shipping',
    body: { text: 'Receives, organizes and ships product. The posting asks for the fitness to move continuously through the building, lift up to 70 pounds and run power equipment, with evening, overnight and weekend shifts and overtime as needed. A diploma and forklift or reach-truck experience are preferred, not required.', src: ['post-dc'] },
    chips: [{ text: '$18.75–$23.10/hr in Rockford, IL', src: ['post-dc'] }, { text: 'Shift most needed: Mon–Thu, 5:30am–4:00pm', src: ['post-dc'] }],
  },
  {
    name: 'CDL delivery driver', aka: 'Store deliveries',
    body: { text: 'Loads, drives and delivers store orders, then unloads, installs and tests appliances at the customer\'s home. The posting needs a Class A CDL where the store runs tractor-trailers or flatbeds, or Class A or B with an air brake endorsement for single-unit trucks, plus a medical certificate (or the ability to get one when hired), a driving-record check, and age 21.', src: ['post-driver'] },
    chips: [{ text: '$26.50–$27.55/hr in Mount Vernon, WA', src: ['post-driver'] }, { text: '$21.75–$23.50/hr in Colorado Springs, CO', src: ['post-driver'] }],
  },
  {
    name: 'Delivery driver I', aka: 'Box truck',
    body: { text: 'A Denver posting asks for a valid driver\'s license, box-truck experience (14,500 to 26,000 pounds) and the DOT medical certification, not a CDL, and says drivers spend about 2 hours a shift loading trucks and on warehouse work.', src: ['post-driver'] },
    chips: [{ text: '$21.75–$26.90/hr in Denver, CO', src: ['post-driver'] }],
  },
]
export const cdlCard = { name: 'Getting a CDL', aka: 'Seen\'s guide to commercial driving', link: 'https://seenjobs.io/start/cdl', body: { text: 'Lowe\'s store driving jobs ask for the license first; its postings prefer a year of semi-truck driving or a driving-school certificate.', src: ['post-driver'] } }

// 3. Pay Lowe's states on its own postings ("Pay Range:"), by role.
export const payRows = [
  { role: 'Cashier, part time', place: 'West Hills, CA', pay: '$18.42–$19.45/hr', src: ['post-cashier'] },
  { role: 'Cashier, full time', place: 'Fountain, CO', pay: '$15.16–$15.60/hr', src: ['post-cashier'] },
  { role: 'Sales Associate, Plumbing', place: 'Hamburg, NY', pay: '$16.50–$17.20/hr', src: ['post-sales'] },
  { role: 'Sales Associate, ProServices', place: 'Owatonna, MN', pay: '$15.00–$15.60/hr', src: ['post-sales'] },
  { role: 'Sales Specialist, ProServices', place: 'Pasco, WA', pay: '$19.00–$19.80/hr', src: ['post-sales'] },
  { role: 'Merchandising Service Associate', place: 'Vancouver, WA', pay: '$17.13–$18.40/hr', src: ['post-mst'] },
  { role: 'Loader/Cart Associate', place: 'Clinton, MD', pay: '$16.50–$17.20/hr', src: ['post-loader'] },
  { role: 'Receiver/Stocker, overnight', place: 'Bellingham, WA', pay: '$19.13/hr', src: ['post-receiver'] },
  { role: 'Fulfillment Associate', place: 'Kingston, NY', pay: '$16.00–$16.15/hr', src: ['post-fulfill'] },
  { role: 'Distribution center Team Member', place: 'Rockford, IL', pay: '$18.75–$23.10/hr', src: ['post-dc'] },
  { role: 'CDL Delivery Driver', place: 'Plymouth, MN', pay: '$24.00–$26.90/hr', src: ['post-driver'] },
  { role: 'Sales Floor Dept Supervisor', place: 'Littleton, CO', pay: '$25.20–$27.25/hr', src: ['post-leaders'] },
  { role: 'Specialty Assistant Store Manager', place: 'Glenwood Springs, CO', pay: '$62,000–$104,000/yr', src: ['post-leaders'] },
]
export const payNote = { text: 'Ranges from postings read in November 2026; Lowe\'s adds that the starting rate "may vary based on factors including, but not limited to, position offered, location, education, training, and/or experience." Lowe\'s says it can give a pay estimate at the interview.', src: ['post-cashier', 'lowes-faq'] }
export const benefits = [
  { text: 'Medical, dental and vision plans for all regular full-time and part-time associates, subject to eligibility.', src: ['benefits'] },
  { text: 'A 401(k) with a company match up to 4.25% if you put in 6% of your pay, and an employee stock purchase plan at a 15% discount.', src: ['benefits'] },
  { text: 'A 10% associate discount; most full-time associates start with around 10–15 days of combined time off.', src: ['benefits'] },
  { text: 'Up to 10 weeks of paid maternity leave and 4 weeks of paid parental leave for eligible full-time associates.', src: ['benefits'] },
  { text: 'Lowe\'s says it awarded more than $300 million in discretionary and profit-sharing bonuses to front-line associates in 2024.', src: ['store-careers'] },
]

// 4. Track to the Trades (associates) and the Lowe's Foundation's Gable Grants (colleges and nonprofits).
export const trades = {
  what: { text: 'Track to the Trades is Lowe\'s own pre-apprentice program for its associates: short online lessons at your own pace, with no tuition and upfront money for eligible certification exams.', src: ['t2t'] },
  items: [
    { name: 'Who can join', text: 'Current Lowe\'s associates. In 2025 Lowe\'s cut the wait from one year to 10 days after hire.', src: ['t2t', 'icr-2025'] },
    { name: 'Seven tracks', text: 'Electrical, plumbing, HVAC, appliance repair, residential construction, multi-family housing and utility maintenance.', src: ['t2t'] },
    { name: 'What you earn', text: 'A certificate of completion for each track, and paths to the OSHA-10, EPA-608 and NATE Ready-to-Work certifications.', src: ['t2t'] },
    { name: 'How long', text: 'Lowe\'s says job-ready skills can take as little as three to four months.', src: ['icr-2025'] },
  ],
  notPlacement: { text: 'Lowe\'s states plainly that Track to the Trades "is not a job placement program": a trades job afterwards is not promised.', src: ['t2t'] },
  gable: { text: 'Gable Grants are the Lowe\'s Foundation\'s money for community and technical colleges and nonprofits that train tradespeople: $250 million to help train 250,000 people by 2035, announced in April 2026. Individuals cannot apply: colleges apply each March and nonprofits by invitation, and awards run $100,000 to $1,000,000.', src: ['lf-gable', 'lf-faq', 'lf-250'] },
  gableUse: { text: 'To use one, enroll in a funded program: the foundation lists the colleges it funds by name and city. Funded community nonprofits must offer their training free, and the programs serve adults and young people 16 to 24.', src: ['lf-colleges', 'lf-faq'] },
  careerStarter: { text: 'The foundation also points to NCCER CareerStarter, a free site to explore the trades and find training near you.', src: ['lf-start'] },
}
export const tradesCard = { name: 'Getting into the trades', aka: 'Seen\'s guide to apprenticeships', link: 'https://seenjobs.io/start/trades', body: { text: 'Track to the Trades is a first step, not an apprenticeship: Lowe\'s calls it pre-apprentice training.', src: ['t2t'] } }

// 5. Moving up: supervisor, assistant store manager, education.
export const moveIntro = { text: 'Lowe\'s says nearly 90% of its store leaders started in hourly roles (2024). One path it shows: sales specialist, department supervisor, assistant store manager, store manager.', src: ['store-careers', 'career-progression'] }
export const rungs = [
  { rung: 'Sales floor department supervisor', asks: 'A diploma and 3 years in retail, or 5 years in retail; a year of customer service; experience directing a team, with or without direct reports', src: ['post-leaders'] },
  { rung: 'Specialty assistant store manager', asks: '2 years leading retail associates, a year as manager on duty and a year directly managing sales associates; a bachelor\'s degree is preferred', src: ['post-leaders'] },
]
export const moveNote = { text: 'Lowe\'s annual report names a virtual fundamentals series for store department supervisors and an in-person assistant store manager training.', src: ['sec-10k'] }
export const education = [
  { text: 'Lowe\'s offers a tuition-free education program through Guild, with over 50 programs at 23 universities and learning providers.', src: ['supply-chain', 'benefits', 'icr-2025'] },
  { text: 'Nearly 850 associates earned degrees through it in 2025, Lowe\'s says.', src: ['icr-2025'] },
]

// 6. How to apply, the interview, and scams.
export const apply = {
  site: { text: 'Lowe\'s takes applications on its own careers site, searchable by keyword, location or job ID, with job alerts.', src: ['lowes-search', 'lowes-faq'] },
  search: { text: 'Search the title Lowe\'s uses: Cashier, Sales Associate, Merchandising Service Associate, Loader/Cart Associate, Receiver/Stocker, Fulfillment Associate, CDL Delivery Driver, or Team Member for distribution centers. Many store titles also name Full Time or Part Time and a shift such as Day, Closing or Overnight.', src: ['lowes-search', 'post-cashier', 'post-sales', 'post-receiver', 'post-dc', 'post-driver'] },
  steps: [
    { step: 'Apply online or with Luci', text: 'Lowe\'s asks for the last four digits of your Social Security number and the month and day of your birth; it asks for the full number once you have accepted an offer.', src: ['getting-hired', 'lowes-faq'] },
    { step: 'Interview in person', text: 'If selected, Luci schedules an in-person interview at the store or facility; depending on the role, a second one with a hiring manager or facility leader can follow.', src: ['getting-hired'] },
    { step: 'Offer and screens', text: 'An accepted offer is followed by pre-employment screens, then orientation. Onboarding email comes from lowes@myworkday.com.', src: ['getting-hired', 'lowes-faq'] },
  ],
  when: { text: 'Lowe\'s hires extra people for spring: "Hiring for our peak season starts in January/February." Most hourly store jobs need you to be 18, though it can vary by location.', src: ['lowes-faq', 'sec-10k'] },
}
export const interviewTips = [
  { name: 'Know the store', text: 'Lowe\'s advises learning the products, tools and services it sells before the interview.', src: ['getting-hired'] },
  { name: 'Bring a customer story', text: 'Be ready with an example of going above and beyond for a customer. A Lowe\'s recruiter: "Product knowledge can be taught."', src: ['getting-hired'] },
  { name: 'Be clear on your hours', text: 'Store and supply chain jobs generally need evening or weekend availability; the schedule is explained if you are picked for an interview.', src: ['lowes-faq'] },
]
export const peopleSay = [
  { text: 'Applying through Luci often leads straight to booking an interview, sometimes within half an hour.', src: ['r-1s2yk1h', 'r-1sic3vt', 'r-1rdfrdz'], firstHand: true },
  { text: 'Some applicants are told at the end of the interview that they will be hired.', src: ['r-1sic3vt', 'r-1qwz25b', 'r-1s8sko7'], firstHand: true },
  { text: 'If no word comes after the interview, people advise calling the store to ask.', src: ['r-1qwz25b', 'r-1sic3vt', 'r-1srr9n4', 'r-1rdfrdz'], firstHand: true },
]
export const scams = [
  { text: 'A generic job text, WhatsApp or Telegram message you did not expect is probably a scam. The FTC: "Real employers will never contact you that way." Lowe\'s says Luci sends updates to people who applied through her.', src: ['ftc-text', 'lowes-faq'] },
  { text: '"Honest employers, including the federal government, will never ask you to pay to get a job." No honest employer sends you a check to deposit and then asks you to send part of it back, the FTC says.', src: ['ftc-jobs'] },
  { text: 'Lowe\'s says its application asks for the last four digits of your Social Security number, and the full number once you have accepted an offer.', src: ['lowes-faq'] },
  { text: 'Check that the job is on Lowe\'s own careers site, or call the store, before you send anything.', src: ['lowes-search', 'lowes-faq'] },
]

// FAQ — visible on the page and mirrored in FAQPage JSON-LD.
export const faq = [
  {
    q: 'Do I need experience to work at Lowe\'s?',
    a: { text: 'Not for most entry store jobs. Cashier postings ask for basic reading, writing and arithmetic and some computer use, and sales associate and loader postings ask for 6 months of using a computer and phones or tablets. Retail experience is preferred, not required.', src: ['post-cashier', 'post-sales', 'post-loader'] },
  },
  {
    q: 'How old do you have to be to work at Lowe\'s?',
    a: { text: 'Lowe\'s says most hourly store jobs need you to be at least 18, though it can vary by location. Its CDL delivery driver postings need you to be 21.', src: ['lowes-faq', 'post-driver'] },
  },
  {
    q: 'How much does Lowe\'s pay?',
    a: { text: 'Lowe\'s minimum wage is $15 an hour as of fiscal 2025. Entry store postings read in November 2026 stated $15.00 to $19.45 an hour depending on the place, and CDL delivery drivers $21.75 to $27.55.', src: ['sec-10k', 'post-cashier', 'post-sales', 'post-driver'] },
  },
  {
    q: 'How long does Lowe\'s take to hire?',
    a: { text: 'Lowe\'s says most store roles take around two weeks from application to offer, and corporate roles may take longer. Luci sends updates during and after the interview process.', src: ['lowes-faq'] },
  },
  {
    q: 'What is Lowe\'s Track to the Trades?',
    a: { text: 'Free, self-paced pre-apprentice training in seven trades for Lowe\'s associates, open 10 days after hire, with upfront money for eligible certification exams. Lowe\'s says it is not a job placement program.', src: ['t2t', 'icr-2025'] },
  },
  {
    q: 'Is a Lowe\'s job offer by text real?',
    a: { text: 'Be careful: the FTC says a generic job text you did not expect is probably a scam, and honest employers never ask you to pay to get a job. If you applied through Luci, Lowe\'s says she sends updates; otherwise find the job on Lowe\'s own careers site or call the store.', src: ['ftc-text', 'ftc-jobs', 'lowes-faq', 'lowes-search'] },
  },
]

// ── Listings: none. Seen held 9 active Lowe's rows on 2026-11-17 (company "Lowe's" / "Lowe's Home Centers"; the other
// "lowe" matches were Flowers Foods, Bellflower, Golden Flower and an unrelated "Lowe"), against thousands of postings on
// Lowe's own site, so the template shows no "Hiring now" block; the first row sends people to Lowe's own search.
export const listings = null

// ── The page's openable rows (components/start/Guide.tsx `Blocks` renders each block type) ─────────────────────────
export const menu = [
  {
    id: 'apply', title: 'Where to find Lowe\'s open jobs', summary: 'Lowe\'s own site, the titles, the steps',
    blocks: [
      { type: 'cards', items: [{ name: 'Lowe\'s careers', aka: 'Lowe\'s own job search', link: SEARCH, body: apply.site }] },
      { type: 'text', entry: apply.search },
      { type: 'steps', items: apply.steps },
      { type: 'text', entry: apply.when },
      { type: 'resumeLink', before: 'Before you apply, you can', label: 'check your résumé against a posting' },
    ],
  },
  {
    id: 'store-jobs', title: 'Store jobs', summary: 'Cashier to Pro desk, with stated pay',
    blocks: [
      { type: 'cards', items: storeRoles },
      { type: 'note', entry: storeNote },
    ],
  },
  {
    id: 'warehouse-drivers', title: 'Distribution centers and drivers', summary: 'Warehouse team members and delivery',
    blocks: [
      { type: 'text', entry: scIntro },
      { type: 'cards', items: scRoles },
      { type: 'cards', items: [cdlCard] },
    ],
  },
  {
    id: 'pay', title: 'Pay Lowe\'s states', summary: 'Ranges on its postings, and benefits',
    blocks: [
      { type: 'table', caption: 'Pay stated on Lowe’s own postings', columns: [{ key: 'role', label: 'Role' }, { key: 'place', label: 'Where' }, { key: 'pay', label: 'Stated pay', num: true }], rows: payRows },
      { type: 'note', entry: payNote },
      { type: 'more', title: 'Benefits', blocks: [{ type: 'notes', items: benefits }] },
    ],
  },
  {
    id: 'trades', title: 'Track to the Trades and Gable Grants', summary: 'Free trades training, and who funds it',
    blocks: [
      { type: 'text', entry: trades.what },
      { type: 'checklist', items: trades.items },
      { type: 'callout', entry: trades.notPlacement },
      { type: 'more', title: 'Lowe\'s Foundation Gable Grants', blocks: [
        { type: 'text', entry: trades.gable },
        { type: 'text', entry: trades.gableUse },
        { type: 'text', entry: trades.careerStarter },
      ] },
      { type: 'cards', items: [tradesCard] },
    ],
  },
  {
    id: 'moving-up', title: 'Moving up', summary: 'Supervisor, assistant manager, school',
    blocks: [
      { type: 'text', entry: moveIntro },
      { type: 'table', caption: 'What Lowe’s leadership postings ask', columns: [{ key: 'rung', label: 'Job' }, { key: 'asks', label: 'Minimum asked' }], rows: rungs },
      { type: 'note', entry: moveNote },
      { type: 'notes', label: 'Tuition-free education', items: education },
    ],
  },
  {
    id: 'interview', title: 'The interview, and scams', summary: 'What to expect, and fake job offers',
    blocks: [
      { type: 'checklist', items: interviewTips },
      { type: 'heading', text: 'What applicants say' },
      { type: 'text', plain: 'What people who applied say. More than one account agrees on each of these.' },
      { type: 'notes', items: peopleSay },
      { type: 'notes', label: 'Scams', items: scams, icon: 'x', caution: true },
    ],
  },
  { id: 'questions', title: 'Common questions', summary: 'Experience, age, pay, timing, trades', blocks: [{ type: 'faq', items: faq }] },
]

// ── Additional resources: every reference above, as plain grouped links (no numbers, closed by default) ────────────
export const resourcesSummary = 'Lowe\'s careers, the Lowe\'s Foundation, public records'
export const resources = [
  { title: 'Lowe\'s careers', items: [
    { key: 'lowes-search', name: 'Lowe\'s job search' },
    { key: 'getting-hired', name: 'Getting hired at Lowe\'s' },
    { key: 'lowes-faq', name: 'Lowe\'s careers questions and answers' },
    { key: 'benefits', name: 'Compensation and benefits' },
    { key: 'store-careers', name: 'Store careers' },
    { key: 'career-progression', name: 'Career progression' },
    { key: 'supply-chain', name: 'Supply chain careers' },
    { key: 't2t', name: 'Track to the Trades' },
  ] },
  { title: 'Lowe\'s jobs by role', items: [
    { key: 'role-cashier', name: 'Cashier' },
    { key: 'post-cashier', name: 'Cashier jobs' },
    { key: 'role-csa', name: 'Customer service associate' },
    { key: 'post-sales', name: 'Sales associate jobs' },
    { key: 'role-mst', name: 'Merchandising service team' },
    { key: 'post-mst', name: 'Merchandising service jobs' },
    { key: 'post-loader', name: 'Search: loader' },
    { key: 'role-receiver', name: 'Receiver and stocker' },
    { key: 'post-receiver', name: 'Receiver and stocker jobs' },
    { key: 'post-fulfill', name: 'Search: fulfillment associate' },
    { key: 'post-driver', name: 'Search: CDL delivery driver' },
    { key: 'post-dc', name: 'Supply chain jobs' },
    { key: 'post-leaders', name: 'Store managers and supervisors' },
  ] },
  { title: 'Lowe\'s Foundation', items: [
    { key: 'lf-gable', name: 'Gable Grants' },
    { key: 'lf-faq', name: 'Gable Grants questions and answers' },
    { key: 'lf-colleges', name: 'Colleges with Gable Grants' },
    { key: 'lf-250', name: 'The 2035 trades commitment, April 2026' },
    { key: 'lf-start', name: 'CareerStarter, through the Lowe\'s Foundation' },
  ] },
  { title: 'Public records', items: [
    { key: 'sec-10k', name: 'Lowe\'s annual report, fiscal 2025 (SEC)' },
    { key: 'icr-2025', name: 'Lowe\'s Impact and Culture Report, 2025' },
  ] },
  { title: 'Job scams', items: [
    { key: 'ftc-text', name: 'Job offer texts (Federal Trade Commission)' },
    { key: 'ftc-jobs', name: 'Job scams (Federal Trade Commission)' },
  ] },
  { title: 'Community discussions', items: [
    { key: 'r-1s2yk1h', name: 'An interview email from Luci' },
    { key: 'r-1sic3vt', name: 'Hired at the first interview' },
    { key: 'r-1rdfrdz', name: 'A second interview email' },
    { key: 'r-1qwz25b', name: 'Waiting to hear after an interview' },
    { key: 'r-1s8sko7', name: 'What to wear to the interview' },
    { key: 'r-1srr9n4', name: 'How long the process takes' },
  ] },
]

/** Every fact on the page, in reading order: the hero, then each menu row. */
export function pageEntries() {
  return [guide.answer, ...tiles, ...blockEntries(menu)]
}
