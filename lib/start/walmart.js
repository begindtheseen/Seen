// /start/walmart — "Getting hired at Walmart". A COMPANY guide: the page renders from this module only, so every figure
// on it carries a reference and an as-of date (lib/start/guides.test.mjs fails on a figure without one).
//
// THE ONLY SOURCE OF FACTS is the research file compiled 2026-11-17 (session scratchpad guides20/walmart/research.md).
// Rules this module keeps:
//   • only items the research marked VERIFIED: Walmart's own careers pages and postings (careers.walmart.com), its own
//     corporate pages and dated news posts (corporate.walmart.com), its Form 10-K for the fiscal year ended
//     January 31, 2026, USCIS (Form I-9) and the FTC;
//   • pay only where Walmart states it, with the date it stated it: company-wide ranges from its "Working at Walmart"
//     page (read 2026-11-17), the Team Lead / Store Manager / driver figures from its July 16, 2026 Jobs Spotlight
//     report, the 2025 average wage and the 2024 store-manager average from its September 25, 2025 post, and posting
//     ranges from postings read on 2026-11-17 (Walmart's postings show no posting date, so the read date is given);
//   • FIRST-HAND items (two or more r/walmart threads agreeing, read through the Arctic Shift archive) only as
//     `firstHand: true`, rendered as what people say;
//   • nothing UNVERIFIED or CONFLICTING: no assessment length or retake rule, no drug-test policy, no minimum age of 16,
//     no time-to-hire beyond Walmart's own "within a week", no Team Lead "$19 - $37" (the undated page disagrees with the
//     dated July 2026 report, which is used), no coach posting salaries (those postings are gone), no medical premium
//     (two Walmart pages disagree), no "12-week" Associate to Driver length (2023 only), no third-party pay;
//   • no lawsuits, executives, stock price or hype; no guarantees, no exclamation marks.
//   • `listings = null`: Seen held only 25 active Walmart rows nationwide on 2026-11-17 (all from one aggregator, a mix
//     of store, driver, maintenance and office jobs, none from Sam's Club as an employer), too few for position filters,
//     so the page sends people to Walmart's own careers search (the "How to apply" row).
//
// Shape: `sources` (every reference behind the page, NEVER printed as citations — readers reach the links through the
// grouped "Additional resources" menu, `resources` below), entries `{ text, src, firstHand? }`, `listings` (null here)
// and the openable menu rows (`menu`, rendered by components/start/Guide.tsx). Pure data; relative imports only so
// `node --test` runs it as is.

import { blockEntries } from './entries.js'

/** @typedef {{ label: string, url: string, date: string, note?: string }} Source */

const CAREERS = 'https://careers.walmart.com/'
const posting = (id) => `https://careers.walmart.com/us/en/jobs/${id}`

/** @type {Record<string, Source>} */
export const sources = {
  'wm-careers': { label: 'Walmart Careers, job search for Walmart and Sam\'s Club', url: CAREERS, date: '2026-11-17', note: 'read' },
  'wm-hiring': { label: 'Walmart Careers, How we hire (hiring process questions)', url: 'https://careers.walmart.com/us/en/home/resources/hiring-process', date: '2026-11-17', note: 'read' },
  'wm-askjob': { label: 'Walmart, Ask Walmart: How do I get a job at Walmart?', url: 'https://corporate.walmart.com/askwalmart/how-do-i-get-a-job-at-walmart', date: '2026-11-17', note: 'read' },
  'wm-stores': { label: 'Walmart Careers, Stores and Clubs (store job areas)', url: 'https://careers.walmart.com/us/en/home/careers-areas/stores-and-clubs', date: '2026-11-17', note: 'read' },
  'wm-clubs': { label: 'Walmart Careers, Sam\'s Club job areas', url: 'https://careers.walmart.com/us/en/sams-home/careers-areas/clubs', date: '2026-11-17', note: 'read' },
  'wm-texts': { label: 'Walmart Careers, recruiting text message terms', url: 'https://careers.walmart.com/us/en/home/resources/alert-terms', date: '2026-11-17', note: 'read' },
  'wm-working': { label: 'Walmart, Working at Walmart (pay ranges, benefits, promotions)', url: 'https://corporate.walmart.com/about/working-at-walmart', date: '2026-11-17', note: 'read' },
  'wm-askpay': { label: 'Walmart, Ask Walmart: How much do Walmart associates make?', url: 'https://corporate.walmart.com/askwalmart/how-much-do-walmart-associates-make', date: '2026-11-17', note: 'read' },
  'wm-spotlight': { label: 'Walmart, "Walmart\'s 2026 Jobs Spotlight Report"', url: 'https://corporate.walmart.com/news/2026/07/16/2026-jobs-spotlight-report', date: '2026-07-16', note: 'published' },
  'wm-system': { label: 'Walmart, "Shaking up the System" (associate pay and training since 2015)', url: 'https://corporate.walmart.com/news/2025/09/25/shaking-up-the-system', date: '2025-09-25', note: 'published' },
  'wm-lbu': { label: 'Walmart, Live Better U education benefit', url: 'https://corporate.walmart.com/about/working-at-walmart/live-better-u/', date: '2026-11-17', note: 'read' },
  'wm-10k': {
    label: 'Walmart Inc. Form 10-K for the fiscal year ended January 31, 2026 (SEC EDGAR)',
    url: 'https://www.sec.gov/Archives/edgar/data/104169/000010416926000055/wmt-20260131.htm',
    date: '2026-03-13', note: 'filed',
  },
  'wm-fraud': { label: 'Walmart, Fraud Alerts (employment scams, fake checks)', url: 'https://corporate.walmart.com/privacy-security/fraud-alerts', date: '2026-11-17', note: 'read' },
  // Walmart's own postings. The pages show no posting date, so each carries the day it was read.
  'p-checkout': { label: 'Walmart posting CP-1380-9020, Checkout Team Associate, Supercenter, Las Vegas, NM', url: posting('CP-1380-9020'), date: '2026-11-17', note: 'read' },
  'p-stocking': { label: 'Walmart posting CP-2279-9048, Stocking Team Associate, Supercenter, Glen Burnie, MD', url: posting('CP-2279-9048'), date: '2026-11-17', note: 'read' },
  'p-overnight-lead': { label: 'Walmart posting CP-5087-9095, overnight Team Lead (DIH O/N Team Lead), Supercenter, North Myrtle Beach, SC', url: posting('CP-5087-9095'), date: '2026-11-17', note: 'read' },
  'p-overnight-pr': { label: 'Walmart posting CP-5802-9501, Overnight Dry Grocery/GM stocker, Supercenter, Canóvanas, PR', url: posting('CP-5802-9501'), date: '2026-11-17', note: 'read' },
  'p-online': { label: 'Walmart posting CP-1005-9038, Online Order Filling Team Associate, Supercenter, Waverly, IA', url: posting('CP-1005-9038'), date: '2026-11-17', note: 'read' },
  'p-delivery': { label: 'Walmart posting CP-1495-9015, Delivery Team Associate, Supercenter, Huber Heights, OH', url: posting('CP-1495-9015'), date: '2026-11-17', note: 'read' },
  'p-fresh': { label: 'Walmart posting CP-1327-9036, Meat/Produce Team Associate, Supercenter, Madison, IN (not open when read)', url: posting('CP-1327-9036'), date: '2026-11-17', note: 'read' },
  'p-auto': { label: 'Walmart posting CP-1313-9005, Auto Care Center Team Associate, Supercenter, San Antonio, TX (not open when read)', url: posting('CP-1313-9005'), date: '2026-11-17', note: 'read' },
  'p-dc-grocery': { label: 'Walmart posting CP-6062-11023, Orderfiller / Loader / Unloader, grocery distribution center, Shelbyville, TN', url: posting('CP-6062-11023'), date: '2026-11-17', note: 'read' },
  'p-dc-breakpack': { label: 'Walmart posting R-2600839, Supply Chain Orderfiller BreakPack, regional distribution center, Prince George, VA', url: posting('R-2600839'), date: '2026-11-17', note: 'read' },
  'p-fc-seasonal': { label: 'Walmart posting CP-4030-11105, eCom Seasonal Warehouse Worker, fulfillment center, Atlanta, GA', url: posting('CP-4030-11105'), date: '2026-11-17', note: 'read' },
  'p-driver': { label: 'Walmart posting R-2658827, Truck Driver OTR, Regional, Hermiston, OR', url: posting('R-2658827'), date: '2026-11-17', note: 'read' },
  'uscis-i9': { label: 'USCIS, Form I-9 acceptable documents', url: 'https://www.uscis.gov/i-9-central/form-i-9-acceptable-documents', date: '2026-10-05', note: 'updated' },
  'ftc-jobs': { label: 'Federal Trade Commission, Job Scams', url: 'https://consumer.ftc.gov/articles/job-scams', date: '2023-03', note: 'published' },
  // First-hand accounts (r/walmart, read through the Arctic Shift archive). Used only where two or more threads agree,
  // and rendered as what people say, never as fact.
  'r-1wuf1mk': { label: 'r/walmart, "Went for an interview, didnt get hired, what am I doing wrong?"', url: 'https://www.reddit.com/r/walmart/comments/1wuf1mk/', date: '2026-09-30', note: 'thread' },
  'r-1xczbr9': { label: 'r/walmart, "Tips for Getting Hired?"', url: 'https://www.reddit.com/r/walmart/comments/1xczbr9/', date: '2026-10-23', note: 'thread' },
  'r-1xhtfi1': { label: 'r/walmart, "Was I just hired over the phone?"', url: 'https://www.reddit.com/r/walmart/comments/1xhtfi1/', date: '2026-10-28', note: 'thread' },
  'r-1v6pccr': { label: 'r/walmart, "Did anybody else get hired weird like i did"', url: 'https://www.reddit.com/r/walmart/comments/1v6pccr/', date: '2026-07-26', note: 'thread' },
  'r-1ua7nvw': { label: 'r/walmart, "I got hired on Wednesday and my background got cleared the same day. How soon after should I be contacted for orientation??"', url: 'https://www.reddit.com/r/walmart/comments/1ua7nvw/', date: '2026-06-19', note: 'thread' },
}

export const guide = {
  path: '/start/walmart',
  title: 'Getting hired at Walmart',
  crumbLabel: 'Walmart',
  eyebrow: 'Company guide',
  // The one-sentence answer under the h1 (no figure: the figures live in the tiles).
  answer: { text: 'Walmart says most of its jobs need no college degree, and its store and warehouse postings ask for little beyond the shift: you apply on Walmart\'s own careers site, some roles add an assessment, and pay depends on the role and the region. Truck drivers in Walmart\'s own fleet need a commercial license plus driving experience or Walmart\'s own training.', src: ['wm-spotlight', 'wm-hiring', 'wm-working', 'p-dc-breakpack', 'p-driver'] },
  metaDescription: 'How people get hired at Walmart and Sam\'s Club: store, warehouse and driver jobs, how Walmart\'s hiring process works, the pay Walmart states, Live Better U, Walmart Academy, moving up to team lead and coach, and job scams to avoid.',
  asOf: '2026-11-17',
}

// The three readings in the hero: each restates a fact below, with the same references.
export const tiles = [
  { label: 'Average hourly pay', value: '$18.50+', text: 'for U.S. hourly frontline associates, on Walmart\'s pay page in November 2026; starting pay varies by region and role', src: ['wm-working'] },
  { label: 'No degree needed', value: '90%', text: 'of Walmart U.S. roles, Walmart said in July 2026', src: ['wm-spotlight'] },
  { label: 'Live Better U', value: '100%', text: 'of tuition and books paid for eligible programs, for full- and part-time associates from day one', src: ['wm-stores', 'wm-lbu'] },
]

// 1. How to apply and get hired (Walmart's own words), then what applicants say.
export const apply = {
  site: { text: 'Walmart takes applications for Walmart and Sam\'s Club jobs, full-time and part-time, on its own careers site.', src: ['wm-askjob', 'wm-careers'] },
  steps: [
    { step: 'Find a role and read the description', text: 'Search by the job and your city. Walmart asks you to read the job description before you apply to be sure it fits.', src: ['wm-askjob', 'wm-careers'] },
    { step: 'Fill in the application', text: 'About 20 to 25 minutes the first time, with your job history. You can save and come back, but you cannot change it after you submit.', src: ['wm-hiring'] },
    { step: 'Take the assessment if the role has one', text: 'Walmart: "some positions require the completion of assessments in order to receive consideration for that role."', src: ['wm-hiring'] },
    { step: 'Watch your status', text: 'Walmart says it tries to respond within a week. Your careers account shows under review, interview scheduled or position filled, and Walmart tells you if you are not picked for an interview.', src: ['wm-hiring', 'wm-askjob'] },
    { step: 'Prepare for the interview', text: 'Walmart suggests practising answers with the STAR method: situation, task, action and result.', src: ['wm-askjob'] },
  ],
  notes: [
    { text: 'An hourly application stays in Walmart\'s system for 60 days.', src: ['wm-hiring'] },
    { text: 'Need an accommodation? Walmart says to tell your manager, recruiter or recruiting coordinator. Its candidate help line is 1-800-955-7267, Monday to Friday, 7 AM to 4 PM Central.', src: ['wm-hiring'] },
    { text: 'For the first day you prove you may work in the U.S. on Form I-9: one document such as a U.S. passport, or a driver\'s license or state ID plus a document such as a Social Security card or birth certificate.', src: ['uscis-i9'] },
  ],
}
export const peopleSay = [
  { text: 'Open availability helps: people say stores lean toward applicants who can work the hours the role needs, and pass over applications that cannot.', src: ['r-1wuf1mk', 'r-1xczbr9', 'r-1xhtfi1'], firstHand: true },
  { text: 'If an application sits, people suggest calling back, or asking in the store for the people lead or the area\'s coach, who can pull your application.', src: ['r-1wuf1mk', 'r-1xczbr9'], firstHand: true },
  { text: 'After an offer comes a background check, then a group orientation, which can wait a few days until the store has hired several people. Bring your ID documents to it.', src: ['r-1v6pccr', 'r-1ua7nvw', 'r-1xhtfi1'], firstHand: true },
  { text: 'Some people say they were hired after one short interview, or over the phone.', src: ['r-1xhtfi1', 'r-1wuf1mk'], firstHand: true },
]

// 2. Store jobs (Walmart's own titles and postings read in November 2026).
export const storeIntro = { text: 'Walmart groups store jobs into areas such as cashier and front-end services, food and grocery, general merchandise, stocking and unloading, digital pickup and delivery, auto services, pharmacy, optical and maintenance. Most hourly store jobs are "team associate" roles in one area.', src: ['wm-stores', 'wm-working'] }
export const storeRoles = [
  {
    name: 'Cashier and front end', aka: 'Checkout Team Associate',
    body: { text: 'Checks out customers, helps across the store, gathers carts from the parking lot and cleans as needed. The posting says it means standing for long periods.', src: ['p-checkout'] },
    chips: [{ text: '$15.00–$28.00/hr in Las Vegas, NM', src: ['p-checkout'] }],
  },
  {
    name: 'Stocking and unloading', aka: 'Stocking Team Associate, overnight stocking',
    body: { text: 'Unloads trucks, sorts the backroom and stocks shelves. The posting says the work can mean lifting heavy objects over 50 pounds and may mean running a forklift. Overnight team leads in North Myrtle Beach, SC start between 8 and 11 PM.', src: ['p-stocking', 'p-overnight-lead'] },
    chips: [{ text: '$15.00–$28.00/hr in Glen Burnie, MD', src: ['p-stocking'] }],
  },
  {
    name: 'Online pickup and delivery', aka: 'Online Order Filling, Delivery Team Associate',
    body: { text: 'Order fillers find, pack and check online orders before pickup, at a pace the posting calls "extremely fast paced". Delivery associates load and unload their vehicle, deliver and confirm with the customer.', src: ['p-online', 'p-delivery'] },
    chips: [{ text: '$15.00–$28.00/hr in Waverly, IA', src: ['p-online'] }, { text: '$14.00–$27.00/hr delivery, Huber Heights, OH', src: ['p-delivery'] }],
  },
  {
    name: 'Fresh food', aka: 'Meat, produce, deli and bakery',
    body: { text: 'Keeps the fresh area stocked, rotates product and follows food safety: checking temperatures, verifying dates and pulling food past its best.', src: ['p-fresh'] },
    chips: [{ text: '$15.00–$28.00/hr in Madison, IN', src: ['p-fresh'] }],
  },
  {
    name: 'Auto care', aka: 'Auto Care Center Team Associate',
    body: { text: 'Changes oil and tires and does other general maintenance, and gets certified on the powered equipment the job uses. The posting asks for a valid driver\'s license.', src: ['p-auto'] },
    chips: [{ text: '$14.00–$27.00/hr in San Antonio, TX', src: ['p-auto'] }],
  },
  {
    name: 'Team lead and coach', aka: 'The first steps into leading people',
    body: { text: 'Walmart calls the team lead role, for many, "the first step into people leadership"; coaches run a whole area of the store.', src: ['wm-spotlight', 'wm-working'] },
    chips: [{ text: 'Team lead $19–$40/hr before bonus', src: ['wm-spotlight'] }, { text: 'Coach $75k–$104k total pay', src: ['wm-working'] }],
  },
]
export const postingNote = { text: 'Posting ranges as read on November 17, 2026. Each posting adds that pay will meet the local minimum wage, plus annual or quarterly performance incentives and premiums of $0.35 to $3.00 an hour in some circumstances.', src: ['p-checkout', 'p-stocking', 'p-online'] }
export const samsClub = { text: 'Sam\'s Club is part of Walmart Inc.: one of the three business segments in Walmart\'s annual report, with 601 clubs in 44 states and Puerto Rico. Its jobs are on the same careers site, in similar areas plus membership services, at a starting range Walmart lists as $16 to $37 an hour.', src: ['wm-10k', 'wm-clubs', 'wm-askjob', 'wm-working'] }

// 3. Distribution centers, fulfillment centers and drivers.
export const supplyRoles = [
  {
    name: 'Distribution center associate', aka: 'Orderfiller, loader, unloader',
    body: { text: 'Receives, unloads, picks and ships freight to the stores. The postings say it is "very physically demanding", with heavy cases "in extreme climates", and some use pick-to-light, RF guns or voice-pick systems. One Virginia schedule runs 5 AM to 3 PM, Tuesday to Friday.', src: ['p-dc-grocery', 'p-dc-breakpack'] },
    chips: [{ text: '$20.80–$24.30/hr in Shelbyville, TN', src: ['p-dc-grocery'] }, { text: '$22.60–$26.10/hr in Prince George, VA', src: ['p-dc-breakpack'] }],
  },
  {
    name: 'Fulfillment center associate', aka: 'Online orders, often seasonal',
    body: { text: 'Moves and packs online orders. The Atlanta seasonal posting is temporary, full time, and asks applicants to be at least 18.', src: ['p-fc-seasonal'] },
    chips: [{ text: '$21.55/hr in Atlanta, GA', src: ['p-fc-seasonal'] }],
  },
  {
    name: 'Truck driver, Walmart\'s private fleet', aka: 'Class A CDL',
    body: { text: 'Hauls freight in Walmart\'s own fleet. The posting asks for a Class A CDL with a hazmat endorsement (or hazmat within 120 days) and 30 months of full-time Class A driving in the last 3 years, or Walmart\'s Fleet Development Academy Program. It lists weekly home time.', src: ['p-driver', 'wm-10k'] },
    chips: [{ text: 'Average over $109,000 a year', src: ['wm-spotlight'] }, { text: '$0.55–$0.69 a mile, Hermiston, OR', src: ['p-driver'] }],
  },
]
export const supplyPay = { text: 'Walmart lists distribution and fulfillment center starting pay as $17.85 to $40.40 an hour, varying by region and role, and says supply chain associates make $27.50 an hour on average.', src: ['wm-working', 'wm-askpay'] }
export const age18 = { text: 'The distribution center, fulfillment center and overnight stocking postings read for this page say "Must be at least 18 years old."', src: ['p-dc-grocery', 'p-fc-seasonal', 'p-overnight-pr'] }
export const driverRules = [
  { name: 'A clean record', text: 'No more than two moving violations, no serious traffic violations and no preventable collisions in the last 3 years.', src: ['p-driver'] },
  { name: 'Live near the hub', text: 'Within 250 miles of the facility, or move within 250 miles by 90 days after hire.', src: ['p-driver'] },
  { name: 'Or start as an associate', text: 'Walmart\'s Associate to Driver program lets store, club and supply chain associates earn a CDL through company-paid training. Walmart says more than 1,000 associates moved into its fleet this way in the three years to July 2026.', src: ['wm-spotlight'] },
]
export const driverPay = { text: 'The average is Walmart\'s own figure for all its over-the-road drivers, as of the end of the first quarter of its 2027 fiscal year. The Hermiston posting says regional drivers "can earn up to $110,000 in their first year."', src: ['wm-spotlight', 'p-driver'] }
export const cdlCard = { name: 'Getting a CDL', aka: 'Seen\'s guide to commercial driving', link: 'https://seenjobs.io/start/cdl', body: { text: 'Most drivers need the license and experience first. Walmart\'s posting sets the bar at 30 months of Class A driving or its own academy.', src: ['p-driver'] } }

// 4. Pay Walmart states, company-wide, with the date it said it.
export const payRows = [
  { role: 'Store team associate', pay: '$14–$37 an hour', when: 'Starting range, varies by region and role (careers page, November 2026)', src: ['wm-working'] },
  { role: 'Team lead', pay: '$19–$40 an hour before bonus', when: 'July 2026', src: ['wm-spotlight'] },
  { role: 'Coach', pay: '$75k–$104k total pay a year', when: 'Starting range (careers page, November 2026)', src: ['wm-working'] },
  { role: 'Store manager', pay: '$95,000–$170,000 a year before bonus and stock', when: 'July 2026', src: ['wm-spotlight'] },
  { role: 'Distribution and fulfillment centers', pay: '$17.85–$40.40 an hour', when: 'Starting range (careers page, November 2026)', src: ['wm-working'] },
  { role: 'Sam\'s Club hourly', pay: '$16–$37 an hour', when: 'Starting range (careers page, November 2026)', src: ['wm-working'] },
  { role: 'Private fleet driver', pay: 'More than $109,000 a year on average', when: 'All over-the-road drivers, July 2026', src: ['wm-spotlight'] },
]
export const payAverages = [
  { text: 'Walmart\'s careers page says the average U.S. hourly frontline associate makes more than $18.50 an hour. In September 2025 Walmart put the 2025 average for a Walmart U.S. associate at $18.25.', src: ['wm-working', 'wm-system'] },
  { text: 'Store managers earned $249,000 on average in 2024 with bonus and stock, Walmart said in September 2025.', src: ['wm-system'] },
]
export const benefits = [
  { text: 'A 401(k) match: "dollar-for-dollar, up to 6% of their eligible pay" once you are eligible, and a stock purchase plan with a 15% match on the first $1,800 a year.', src: ['wm-working'] },
  { text: 'Store associates know their schedule two weeks ahead, and full-time store associates can sign up for set schedules of up to 40 hours a week.', src: ['wm-working'] },
  { text: 'A 10% discount on 95% of regularly priced items in the store; 10 weeks of paid maternity leave and up to 12 weeks of paid parental leave.', src: ['wm-working'] },
]

// 5. Training, Live Better U and moving up.
export const lbu = {
  what: { text: 'Live Better U is Walmart\'s education benefit: "little or no out-of-pocket cost for tuition and required books in eligible programs," with "no obligation to stay at Walmart after completion."', src: ['wm-lbu'] },
  items: [
    { name: 'From day one', text: 'For full- and part-time hourly and salaried Walmart and Sam\'s Club associates.', src: ['wm-lbu'] },
    { name: 'Not for everyone', text: 'Temporary associates, salaried associates at market level and above, and anyone who already holds a bachelor\'s degree are not eligible.', src: ['wm-lbu'] },
    { name: 'Grants go first', text: '"Any federal or state grant aid you receive will be applied first."', src: ['wm-lbu'] },
    { name: 'What you can study', text: 'A high school diploma, languages including English, bachelor\'s degrees and certificates, from Walmart\'s own list of programs.', src: ['wm-lbu', 'wm-10k'] },
  ],
}
export const academy = { text: 'Walmart Academy, started in 2016, gives job-specific retail training and leadership courses and is now in more than 200 locations. Walmart counts more than 4 million training completions since 2016.', src: ['wm-system', 'wm-stores', 'wm-spotlight', 'wm-10k'] }
export const path = [
  { step: 'Team associate', text: 'Walmart says U.S. associates get their first promotion in nine months, on average.', src: ['wm-working', 'wm-spotlight'] },
  { step: 'Team lead', text: 'Leads a team in one area of the store, paid by the hour.', src: ['wm-spotlight'] },
  { step: 'Coach', text: 'A salaried manager over an area such as front end, stocking or auto care.', src: ['wm-spotlight', 'wm-working'] },
  { step: 'Store manager', text: 'Walmart: "Many Store Managers began in frontline roles."', src: ['wm-spotlight'] },
]
export const promoted = { text: 'Walmart\'s annual report says about 75% of its U.S. salaried store, club and supply chain managers began in hourly jobs.', src: ['wm-10k', 'wm-working'] }
export const technician = { text: 'Walmart\'s Associate to Technician program trains associates as facility maintenance technicians "with no previous technical experience required."', src: ['wm-spotlight'] }

// 6. Where Walmart hires.
export const whereRows = [
  { what: 'Walmart stores in the U.S.', count: '4,611', src: ['wm-10k'] },
  { what: 'Sam\'s Clubs in the U.S. and Puerto Rico', count: '601', src: ['wm-10k'] },
  { what: 'U.S. distribution facilities', count: '192', src: ['wm-10k'] },
  { what: 'Associates in the U.S.', count: 'About 1.6 million', src: ['wm-10k'] },
]
export const whereNote = { text: 'From Walmart\'s annual report for the fiscal year ended January 31, 2026; Walmart had about 2.1 million associates worldwide on that date. Walmart says a store is within 10 miles of about 90% of Americans.', src: ['wm-10k', 'wm-working'] }

// 7. Watch out.
export const beforeYouApply = [
  { text: 'Store and warehouse work is physical: lifting over 50 pounds in stocking, heavy cases in heat and cold in distribution centers, long hours standing at checkout.', src: ['p-stocking', 'p-dc-grocery', 'p-checkout'] },
  { text: 'Pay ranges are wide. Where you start depends on the role and the region, so read the range on the posting for your store.', src: ['wm-working', 'p-checkout'] },
  { text: 'You cannot edit an application once it is in, so check your availability and job history before you submit.', src: ['wm-hiring'] },
]
export const scams = [
  { text: 'Walmart: "Fake job offers will often require payment for trainings, background checks or other fees." The FTC: "Don\'t pay for the promise of a job."', src: ['wm-fraud', 'ftc-jobs'] },
  { text: '"Walmart will NEVER mail you a check and ask that you deposit it to purchase an item or service."', src: ['wm-fraud'] },
  { text: 'Walmart does send automated recruiting texts to people who sign up, so check any offer against the job on careers.walmart.com before you share bank details.', src: ['wm-texts', 'wm-fraud', 'wm-careers'] },
  { text: 'Report a job scam to the FTC at ReportFraud.ftc.gov, and send suspicious emails that claim to be Walmart to OnlineAbuse@walmart.com.', src: ['ftc-jobs', 'wm-fraud'] },
]

// FAQ — visible on the page and mirrored in FAQPage JSON-LD.
export const faq = [
  {
    q: 'Do I need a degree or experience to work at Walmart?',
    a: { text: 'Usually not. Walmart said in July 2026 that 90% of its roles in this country do not require a college degree, and the store and warehouse postings we read list no experience. Some roles add an assessment.', src: ['wm-spotlight', 'p-dc-breakpack', 'p-checkout', 'wm-hiring'] },
  },
  {
    q: 'How much does Walmart pay?',
    a: { text: 'Walmart lists starting pay for store team associates at $14 to $37 an hour, varying by region and role, and says its average hourly frontline associate makes more than $18.50. Team leads are paid $19 to $40 an hour before bonus.', src: ['wm-working', 'wm-spotlight'] },
  },
  {
    q: 'How long does Walmart take to answer an application?',
    a: { text: 'Walmart says it tries to respond within a week, and your careers account shows under review, interview scheduled or position filled. An hourly application stays in its system for 60 days.', src: ['wm-hiring', 'wm-askjob'] },
  },
  {
    q: 'Does Walmart pay for college?',
    a: { text: 'Through Live Better U, eligible full- and part-time associates can study from day one with little or no out-of-pocket cost for tuition and required books. Grants are applied first, and people who already hold a bachelor\'s degree are not eligible.', src: ['wm-lbu'] },
  },
  {
    q: 'Can I drive trucks for Walmart without experience?',
    a: { text: 'Not straight away: the regional driver posting asks for 30 months of Class A driving in the last 3 years or Walmart\'s own fleet academy. Associates already at Walmart can earn a CDL through its company-paid Associate to Driver program.', src: ['p-driver', 'wm-spotlight'] },
  },
  {
    q: 'Is Sam\'s Club part of Walmart?',
    a: { text: 'Yes. Sam\'s Club is one of Walmart Inc.\'s three business segments, and its jobs are listed on the same careers site as Walmart\'s.', src: ['wm-10k', 'wm-askjob'] },
  },
]

// ── Listings: none. Seen held 25 active Walmart rows nationwide on 2026-11-17 (all from one aggregator; a mix of store,
// driver, maintenance and office titles; 0 rows with Sam's Club as the employer), too few to fill position filters,
// so the template shows no "Hiring now" block; the "How to apply" row sends people to Walmart's own careers search.
export const listings = null

// ── The page's openable rows (components/start/Guide.tsx `Blocks` renders each block type) ─────────────────────────
export const menu = [
  {
    id: 'apply', title: 'How to apply and get hired', summary: 'Careers site, assessment, interview, first day',
    blocks: [
      { type: 'cards', items: [{ name: 'Walmart Careers', aka: 'Walmart and Sam\'s Club jobs', link: CAREERS, body: apply.site }] },
      { type: 'steps', items: apply.steps },
      { type: 'notes', items: apply.notes },
      { type: 'heading', text: 'What applicants say' },
      { type: 'text', plain: 'From people who applied. More than one account agrees on each of these.' },
      { type: 'notes', items: peopleSay },
      { type: 'resumeLink', before: 'Before you apply, you can', label: 'check your résumé against a Walmart posting' },
    ],
  },
  {
    id: 'store-jobs', title: 'Store jobs', summary: 'Front end, stocking, pickup, fresh, auto care',
    blocks: [
      { type: 'text', entry: storeIntro },
      { type: 'cards', items: storeRoles },
      { type: 'note', entry: postingNote },
      { type: 'more', title: 'Sam\'s Club', blocks: [{ type: 'text', entry: samsClub }] },
    ],
  },
  {
    id: 'warehouse-drivers', title: 'Distribution centers and drivers', summary: 'Warehouse work, and the CDL route',
    blocks: [
      { type: 'cards', items: supplyRoles },
      { type: 'text', entry: supplyPay },
      { type: 'note', entry: age18 },
      { type: 'more', title: 'What the driver posting asks', blocks: [
        { type: 'checklist', items: driverRules },
        { type: 'note', entry: driverPay },
        { type: 'cards', items: [cdlCard] },
      ] },
    ],
  },
  {
    id: 'pay', title: 'Pay Walmart states', summary: 'Ranges by role, with dates',
    blocks: [
      { type: 'table', caption: 'Pay Walmart states for its U.S. jobs', columns: [{ key: 'role', label: 'Role' }, { key: 'pay', label: 'Stated pay', num: true }, { key: 'when', label: 'As stated' }], rows: payRows },
      { type: 'notes', items: payAverages },
      { type: 'more', title: 'Benefits', blocks: [{ type: 'notes', items: benefits }] },
    ],
  },
  {
    id: 'training', title: 'Live Better U and moving up', summary: 'Free study, training, the path to manager',
    blocks: [
      { type: 'text', entry: lbu.what },
      { type: 'checklist', items: lbu.items, cols: true },
      { type: 'text', entry: academy },
      { type: 'heading', text: 'The path Walmart describes' },
      { type: 'steps', items: path },
      { type: 'text', entry: promoted },
      { type: 'more', title: 'Other paths', blocks: [{ type: 'text', entry: technician }] },
    ],
  },
  {
    id: 'where', title: 'Where Walmart hires', summary: 'Stores, clubs and distribution centers',
    blocks: [
      { type: 'table', caption: 'Walmart in the U.S.', columns: [{ key: 'what', label: 'What' }, { key: 'count', label: 'How many', num: true }], rows: whereRows },
      { type: 'note', entry: whereNote },
    ],
  },
  {
    id: 'watch-out', title: 'Watch out', icon: 'caution', summary: 'Physical work, wide pay ranges, scams',
    blocks: [
      { type: 'notesGrid', groups: [
        { label: 'Before you apply', items: beforeYouApply, icon: 'dot' },
        { label: 'Scams', items: scams, icon: 'x' },
      ] },
    ],
  },
  { id: 'questions', title: 'Common questions', summary: 'Degree, pay, timing, college, driving', blocks: [{ type: 'faq', items: faq }] },
]

// ── Additional resources: every reference above, as plain grouped links (no numbers, closed by default) ────────────
export const resourcesSummary = 'Walmart careers, postings, public records'
export const resources = [
  { title: 'Walmart careers', items: [
    { key: 'wm-careers', name: 'Walmart Careers job search' },
    { key: 'wm-hiring', name: 'How Walmart hires' },
    { key: 'wm-askjob', name: 'How do I get a job at Walmart?' },
    { key: 'wm-stores', name: 'Store job areas' },
    { key: 'wm-clubs', name: 'Sam\'s Club job areas' },
    { key: 'wm-texts', name: 'Recruiting text messages' },
  ] },
  { title: 'Pay, benefits and training', items: [
    { key: 'wm-working', name: 'Working at Walmart: pay ranges and benefits' },
    { key: 'wm-askpay', name: 'How much do Walmart associates make?' },
    { key: 'wm-spotlight', name: 'Walmart 2026 Jobs Spotlight report' },
    { key: 'wm-system', name: 'Associate pay and training since 2015' },
    { key: 'wm-lbu', name: 'Live Better U' },
  ] },
  { title: 'Postings on this page', items: [
    { key: 'p-checkout', name: 'Checkout Team Associate, Las Vegas, NM' },
    { key: 'p-stocking', name: 'Stocking Team Associate, Glen Burnie, MD' },
    { key: 'p-overnight-lead', name: 'Overnight team lead, North Myrtle Beach, SC' },
    { key: 'p-overnight-pr', name: 'Overnight stocker, Canóvanas, PR' },
    { key: 'p-online', name: 'Online Order Filling Team Associate, Waverly, IA' },
    { key: 'p-delivery', name: 'Delivery Team Associate, Huber Heights, OH' },
    { key: 'p-fresh', name: 'Meat/Produce Team Associate, Madison, IN' },
    { key: 'p-auto', name: 'Auto Care Center Team Associate, San Antonio, TX' },
    { key: 'p-dc-grocery', name: 'Orderfiller / Loader / Unloader, Shelbyville, TN' },
    { key: 'p-dc-breakpack', name: 'Orderfiller BreakPack, Prince George, VA' },
    { key: 'p-fc-seasonal', name: 'Seasonal warehouse worker, Atlanta, GA' },
    { key: 'p-driver', name: 'Regional truck driver, Hermiston, OR' },
  ] },
  { title: 'Public records', items: [
    { key: 'wm-10k', name: 'Walmart annual report, fiscal year ended January 2026 (SEC)' },
    { key: 'uscis-i9', name: 'Form I-9 acceptable documents (USCIS)' },
  ] },
  { title: 'Job scams', items: [
    { key: 'wm-fraud', name: 'Walmart fraud alerts' },
    { key: 'ftc-jobs', name: 'Job scams (Federal Trade Commission)' },
  ] },
  { title: 'Community discussions', items: [
    { key: 'r-1wuf1mk', name: 'An interview that did not lead to a job' },
    { key: 'r-1xczbr9', name: 'Tips for getting hired' },
    { key: 'r-1xhtfi1', name: 'Hired over the phone' },
    { key: 'r-1v6pccr', name: 'Waiting on a background check' },
    { key: 'r-1ua7nvw', name: 'Waiting for orientation' },
  ] },
]

/** Every fact on the page, in reading order: the hero, then each menu row. */
export function pageEntries() {
  return [guide.answer, ...tiles, ...blockEntries(menu)]
}
