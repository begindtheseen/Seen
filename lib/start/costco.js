// /start/costco — "Getting hired at Costco". A COMPANY guide: the page renders from this module only, so every figure on
// it carries a reference and an as-of date (lib/start/guides.test.mjs fails on a figure without one).
//
// THE ONLY SOURCE OF FACTS is the research file compiled 2026-11-17 (session scratchpad guides20/costco/research.md) and
// its pull of Costco's own job board (careers.costco.com/api/jobs, 5,066 U.S. postings read 2026-11-17 19:39–19:44 UTC;
// the board reported 19,267 and its paging shifted, so it is a large sample, not a count — no posting counts are printed).
// Rules this module keeps:
//   • only items the research marked VERIFIED: Costco's careers pages, its postings, its customer-service pages (career
//     FAQ, fraud page), its pay-range sheet linked from its own postings, its SEC 10-Ks, its 2025 sustainability report,
//     the Teamsters' own release, the eCFR and the FTC;
//   • Costco's postings list duties, pay and benefits only — no education, experience or age line — and say each is an
//     example of jobs Costco "may hire for when openings exist". The page says so plainly;
//   • FIRST-HAND items only as `firstHand: true`, where two or more discussions agree; a single account is never used;
//   • nothing UNVERIFIED or CONFLICTING: no minimum age (Costco states none; third-party sites disagree), no benefit
//     waiting period (third-party only), no schedule lead time (careers page says three weeks, the sustainability report
//     two), no Stocker top of range ($31.20 on its postings, $32.90 on the pay sheet), no undated careers-page counters,
//     no Teamsters contract pay (the union states none), no hiring calendar;
//   • `listings = null`: Seen holds no Costco rows (0 active, 0 ever, read-only check 2026-11-17); Costco takes
//     applications on its own site, so the "How to apply" row sends people there;
//   • no executives, no stock, no lawsuits; no hype, no guarantees, no exclamation marks.
//
// Shape: `sources` (every reference behind the page, NEVER printed as citations — readers reach the links only through
// the grouped "Additional resources" menu, `resources` below), entries `{ text, src, firstHand? }`, `listings` (null)
// and the openable menu rows (`menu`, rendered by components/start/Guide.tsx). Pure data; relative imports only so
// `node --test` runs it as is.

import { blockEntries } from './entries.js'

/** @typedef {{ label: string, url: string, date: string, note?: string }} Source */

const CAREERS = 'https://careers.costco.com/'
const JOBS = 'https://careers.costco.com/jobs'
const posting = (id) => `https://careers.costco.com/jobs/${id}?lang=en-us`

/** @type {Record<string, Source>} */
export const sources = {
  'cc-home': { label: 'Costco careers, home page (career areas, new locations, E-Verify)', url: CAREERS, date: '2026-11-17', note: 'read' },
  'cc-apply': { label: 'Costco careers, Resources for Applying', url: 'https://careers.costco.com/resources-for-applying', date: '2026-11-17', note: 'read' },
  'cc-why': { label: 'Costco careers, Why Costco (benefits, wages, scheduling, promotion from within)', url: 'https://careers.costco.com/why-costco', date: '2026-11-17', note: 'read' },
  'cc-jobs': { label: 'Costco job search, U.S. postings (several thousand read in full on 2026-11-17)', url: JOBS, date: '2026-11-17', note: 'read' },
  'cc-faq': { label: 'Costco customer service, Costco Career FAQs (document CU2516)', url: 'https://customerservice.costco.com/app/answers/answer_view/a_id/9227/loc/en_US', date: '2025-02-20', note: 'published' },
  'cc-fraud': { label: 'Costco customer service, Preventing Fraud: fictitious job-related offers (document CU1432)', url: 'https://customerservice.costco.com/app/answers/answer_view/a_id/1174', date: '2026-03-16', note: 'published' },
  'cc-payranges': { label: 'Costco pay ranges by position (sheet linked from Costco’s own postings, which say “Posting Updated: July 2026”)', url: 'https://mobilecontent.costco.com/live/resource/img/static-us-landing-pages/Pay-Ranges-Cadient.pdf', date: '2026-11-17', note: 'read' },
  // Costco's own postings (each read in full on 2026-11-17; dates are the posting dates Costco's board shows).
  'p-cashier-asst': { label: 'Costco posting 67549, Cashier Assistant (Front End), Meridian, ID', url: posting('67549'), date: '2026-08-13', note: 'posted' },
  'p-cashier': { label: 'Costco posting 68150, Cashier (Front End), Naples, FL', url: posting('68150'), date: '2026-11-16', note: 'posted' },
  'p-membership': { label: 'Costco posting 59596, Membership Clerk, Ridgefield, WA', url: posting('59596'), date: '2026-07-28', note: 'posted' },
  'p-msa': { label: 'Costco posting 15545, Member Service Assistant, Pocatello, ID', url: posting('15545'), date: '2025-07-14', note: 'posted' },
  'p-stocker': { label: 'Costco posting 66002, Stocker, St. George, UT', url: posting('66002'), date: '2026-07-28', note: 'posted' },
  'p-forklift': { label: 'Costco posting 67430, Forklift Driver, Camarillo, CA', url: posting('67430'), date: '2026-07-30', note: 'posted' },
  'p-receiving': { label: 'Costco posting 67727, Receiving Clerk, Port St. Lucie, FL', url: posting('67727'), date: '2026-09-30', note: 'posted' },
  'p-food': { label: 'Costco posting 65472, Food Service Assistant, Mettawa, IL', url: posting('65472'), date: '2026-07-28', note: 'posted' },
  'p-deli': { label: 'Costco posting 58329, Service Deli Clerk, Lihue, HI', url: posting('58329'), date: '2026-07-28', note: 'posted' },
  'p-bakery': { label: 'Costco posting 68078, Bakery Wrapper / Clean Up, Littleton, CO', url: posting('68078'), date: '2026-11-16', note: 'posted' },
  'p-meat': { label: 'Costco posting 68143, Meat Wrapper / Sanitation, Naples, FL', url: posting('68143'), date: '2026-11-16', note: 'posted' },
  'p-gas': { label: 'Costco posting 60871, Gas Station Attendant, Oshtemo Township, MI', url: posting('60871'), date: '2026-07-28', note: 'posted' },
  'p-rx-cert': { label: 'Costco posting 52188, Pharmacy Technician-Certified, University City, MO', url: posting('52188'), date: '2026-07-28', note: 'posted' },
  'p-rx-noncert': { label: 'Costco posting 50119, Pharmacy Technician Non-Certified, Mechanicsburg, PA', url: posting('50119'), date: '2026-07-28', note: 'posted' },
  'p-optician': { label: 'Costco posting 61130, Non-Licensed Optician, Baxter, MN', url: posting('61130'), date: '2026-07-28', note: 'posted' },
  'p-optician-lic': { label: 'Costco posting 53599, Licensed Optician, St. Charles, IL', url: posting('53599'), date: '2026-07-28', note: 'posted' },
  'p-depot-forklift': { label: 'Costco posting 50814, Forklift Operator (depots and logistics), Eugene, OR', url: posting('50814'), date: '2026-07-28', note: 'posted' },
  'p-picker': { label: 'Costco posting 56553, Order Picker, Stafford, TX', url: posting('56553'), date: '2026-07-28', note: 'posted' },
  'p-fleet': { label: 'Costco posting 55956, Fleet Truck Driver (depots and logistics), Dallas, TX', url: posting('55956'), date: '2026-07-28', note: 'posted' },
  'p-delivery': { label: 'Costco posting 50328, Delivery Driver (depots and logistics), Reno, NV', url: posting('50328'), date: '2026-07-28', note: 'posted' },
  'p-any': { label: 'Costco posting 51238, Any Position, Omaha, NE', url: posting('51238'), date: '2026-07-28', note: 'posted' },
  'sec-10k-2026': {
    label: 'Costco Wholesale Corporation, Form 10-K for the fiscal year ended August 30, 2026 (SEC EDGAR)',
    url: 'https://www.sec.gov/Archives/edgar/data/909832/000090983226000093/cost-20260830.htm',
    date: '2026-10-07', note: 'filed',
  },
  'sec-10k-2025': {
    label: 'Costco Wholesale Corporation, Form 10-K for the fiscal year ended August 31, 2025 (SEC EDGAR)',
    url: 'https://www.sec.gov/Archives/edgar/data/909832/000090983225000101/cost-20250831.htm',
    date: '2025-10-08', note: 'filed',
  },
  'sust-2025': {
    label: 'Costco 2025 Sustainability Report (People: employees, benefits, development)',
    url: 'https://s201.q4cdn.com/287523651/files/doc_financials/2025/ar/costco-sustainability-report-2025.pdf',
    date: '2025-11-26', note: 'published',
  },
  'teamsters-2025': {
    label: 'International Brotherhood of Teamsters, "Costco Fleet Drivers Overwhelmingly Ratify New Contract"',
    url: 'https://teamster.org/2025/04/costco-fleet-drivers-overwhelmingly-ratify-new-contract/',
    date: '2025-04-10', note: 'published',
  },
  'ecfr-hoist': {
    label: 'eCFR, 29 CFR 570.58, power-driven hoisting apparatus including high-lift trucks (Hazardous Occupations Order 7)',
    url: 'https://www.ecfr.gov/current/title-29/subtitle-B/chapter-V/subchapter-A/part-570/subpart-E/section-570.58',
    date: '2026-11-01', note: 'in force',
  },
  'ecfr-baler': {
    label: 'eCFR, 29 CFR 570.63, balers, compactors and paper-products machines (Hazardous Occupations Order 12)',
    url: 'https://www.ecfr.gov/current/title-29/subtitle-B/chapter-V/subchapter-A/part-570/subpart-E/section-570.63',
    date: '2026-11-01', note: 'in force',
  },
  'ftc-text': {
    label: 'Federal Trade Commission consumer alert, "That job offer text is probably a scam"',
    url: 'https://www.consumer.ftc.gov/consumer-alerts/2026/04/job-offer-text-probably-scam',
    date: '2026-04-30', note: 'published',
  },
  // First-hand accounts (r/Costco, read through the Arctic Shift archive). Used only where two or more discussions agree,
  // and rendered as what people say, never as fact.
  'r-1s5jfwp': { label: 'r/Costco, "Costco employees, how did you get hired?"', url: 'https://www.reddit.com/r/Costco/comments/1s5jfwp/', date: '2026-03-27', note: 'thread' },
  'r-1q9j1i9': { label: 'r/Costco, "What position am I most likely to get hired for when applying to Costco?"', url: 'https://www.reddit.com/r/Costco/comments/1q9j1i9/', date: '2026-01-10', note: 'thread' },
  'r-1tc3i4d': { label: 'r/Costco, "Any tips on how to get hired?"', url: 'https://www.reddit.com/r/Costco/comments/1tc3i4d/', date: '2026-05-13', note: 'thread' },
  'r-1ouidan': { label: 'r/Costco, "I got an interview for seasonal and just wondering if it leads to full time?"', url: 'https://www.reddit.com/r/Costco/comments/1ouidan/', date: '2025-11-11', note: 'thread' },
  'r-1wv4g0y': { label: 'r/Costco, "What are my odds of getting hired at Costco? New one is being built near me."', url: 'https://www.reddit.com/r/Costco/comments/1wv4g0y/', date: '2026-10-01', note: 'thread' },
  'r-1ucq7lf': { label: 'r/Costco, "Costco Employees, getting hired"', url: 'https://www.reddit.com/r/Costco/comments/1ucq7lf/', date: '2026-06-22', note: 'thread' },
}

export const guide = {
  path: '/start/costco',
  title: 'Getting hired at Costco',
  crumbLabel: 'Costco',
  eyebrow: 'Company guide',
  // The one-sentence answer under the h1 (no figure: the figures live in the tiles).
  answer: { text: 'Costco hires most new people into part-time, entry-level warehouse jobs such as front end, food court, member service and early-morning stocking, through applications on its own careers site. Most postings state the pay range, the ones we read list no diploma or experience requirement, and you should expect nights and weekends and may need to apply more than once.', src: ['cc-apply', 'cc-jobs', 'cc-home'] },
  metaDescription: 'How people get hired at Costco: the entry warehouse, depot and call-center jobs, the pay Costco states on its own postings, benefits, part-time and seasonal starts, promotion from within, how to apply and how to spot a fake Costco job offer.',
  asOf: '2026-11-17',
}

// The three readings in the hero: each restates a fact below, with the same references.
export const tiles = [
  { label: 'Starting pay', value: '$20.00/hr', text: 'the floor for entry-level jobs in the U.S. since March 2025; cashier and clerk postings start at $21.00', src: ['sec-10k-2025', 'p-cashier-asst', 'p-cashier', 'p-membership'] },
  { label: 'Average hourly pay', value: '$33.00/hr', text: 'about what Costco’s hourly U.S. employees averaged at the end of its 2026 fiscal year, its annual report says', src: ['sec-10k-2026'] },
  { label: 'An application lasts', value: '90 days', text: 'then it expires. Costco asks you to apply again to stay in the pool', src: ['cc-apply'] },
]

// 1. How to apply, what Costco says helps, and what people who were hired say.
export const apply = {
  site: { text: 'Costco takes applications online on its own careers site. Search by ZIP code and apply to the warehouse, depot or office you can get to.', src: ['cc-home', 'cc-faq'] },
  examples: { text: 'Each posting says it is an example of the jobs Costco “may hire for when openings exist”, and that a listing “does not mean that any positions are currently open”. Many warehouses also post an “Any Position” listing, which asks for open availability.', src: ['cc-jobs', 'p-any'] },
  steps: [
    { step: 'Apply online to a location', text: 'A new warehouse takes applications about 12 weeks before it opens; if it does not show up for a nearby ZIP code, it is not taking them yet.', src: ['cc-home'] },
    { step: 'Introduce yourself to a manager', text: 'Costco: “Each warehouse receives hundreds of applications. After applying online, stand out by introducing yourself to a manager at your desired location.”', src: ['cc-apply'] },
    { step: 'Apply again after 90 days', text: 'Applications expire after 90 days. Costco says its locations hire all year, “not only during seasonal periods.”', src: ['cc-apply'] },
    { step: 'Ask the location about your status', text: 'Costco does not send application updates by email or messaging apps; it suggests contacting the location you applied to. For trouble with the online form, Costco HR is at 1-800-284-4882, option 2, then option 3.', src: ['cc-faq'] },
  ],
  veterans: { text: 'Veterans applying for part-time, entry-level warehouse jobs get “an interview spot toward the front of the line”: apply online, then email the regional representative listed on Costco’s Resources for Applying page.', src: ['cc-apply'] },
  where: { text: 'At the end of its 2026 fiscal year (August 30, 2026) Costco had 647 U.S. warehouses in 47 states, Washington, D.C. and Puerto Rico; its careers site says it has none in Wyoming, West Virginia or Rhode Island.', src: ['sec-10k-2026', 'cc-home'] },
}
export const peopleSay = [
  { text: 'Several people who were hired say that calling or visiting the warehouse and asking for a manager after applying online is what got them an interview.', src: ['r-1s5jfwp', 'r-1q9j1i9', 'r-1tc3i4d'], firstHand: true },
  { text: 'They describe interviews that ask for examples from past jobs, such as a time you did work outside your usual role or how you handled a disagreement with a coworker.', src: ['r-1ucq7lf', 'r-1tc3i4d'], firstHand: true },
]

// 2. Entry jobs in a warehouse (Costco's own titles). Pay chips are the range stated on the posting named in `src`.
export const roles = [
  {
    name: 'Front end', aka: 'Cashier assistant, cashier',
    body: { text: 'Cashier assistants pack orders, bring in carts and restock merchandise; cashiers ring up orders and handle payment.', src: ['p-cashier-asst', 'p-cashier'] },
    chips: [{ text: 'Cashier assistant $20.00–$31.20/hr', src: ['p-cashier-asst'] }, { text: 'Cashier $21.00–$32.90/hr', src: ['p-cashier'] }],
  },
  {
    name: 'Member service', aka: 'Door, membership desk',
    body: { text: 'Member service assistants greet members, check cards and receipts and walk the building on safety checks. Membership clerks sign members up and handle renewals.', src: ['p-msa', 'p-membership'] },
    chips: [{ text: 'Member service assistant $20.00–$31.20/hr', src: ['cc-payranges'] }, { text: 'Membership clerk $21.00–$32.90/hr', src: ['p-membership'] }],
  },
  {
    name: 'Stocking and receiving', aka: 'Stocker, forklift driver, receiving clerk',
    body: { text: 'Stockers fill and straighten the shelves, move pallets with a pallet jack and run the cardboard baler. Forklift drivers move pallets with a stand-up electric forklift.', src: ['p-stocker', 'p-forklift'] },
    chips: [{ text: 'Stocker from $20.00/hr', src: ['p-stocker', 'cc-payranges'] }, { text: 'Forklift driver $21.00–$32.90/hr, plus $1.00/hr on the forklift', src: ['p-forklift'] }],
  },
  {
    name: 'Food court', aka: 'Food service assistant',
    body: { text: 'Prepares and sells food and drinks, stocks supplies and cleans the kitchen and eating area.', src: ['p-food'] },
    chips: [{ text: '$20.00–$31.20/hr', src: ['p-food'] }],
  },
  {
    name: 'Fresh foods', aka: 'Deli, bakery, meat',
    body: { text: 'Service deli clerks prepare and package meals, salads, party trays and rotisserie chicken; bakery and meat wrappers package product and clean up.', src: ['p-deli', 'p-bakery', 'p-meat'] },
    chips: [{ text: 'Deli clerk $21.00–$32.90/hr', src: ['p-deli'] }, { text: 'Bakery or meat wrapper $20.00–$31.20/hr', src: ['p-bakery', 'p-meat'] }],
  },
  {
    name: 'Gas station', aka: 'Gas station attendant',
    body: { text: 'Monitors the pumps and traffic, cleans up spills, helps members and responds to emergencies.', src: ['p-gas'] },
    chips: [{ text: '$20.00–$31.20/hr', src: ['p-gas'] }],
  },
  {
    name: 'Pharmacy technician', aka: 'Certified or not',
    body: { text: 'Helps pharmacists fill prescriptions, works the counter and register, and stocks the pharmacy. Costco posts both a certified and a non-certified technician job; the certified one adds an hourly premium.', src: ['p-rx-cert', 'p-rx-noncert'] },
    chips: [{ text: 'Non-certified $21.00–$32.90/hr', src: ['p-rx-noncert'] }, { text: 'Certified: the same plus $3.00/hr', src: ['p-rx-cert'] }],
  },
  {
    name: 'Optical', aka: 'Optician, licensed or not',
    body: { text: 'Helps members choose and order glasses and fits them; a non-licensed optician works under a licensed one. Licensed opticians earn a premium of $5 to $9 an hour on top of the range, depending on the state.', src: ['p-optician', 'p-optician-lic'] },
    chips: [{ text: 'Non-licensed $20.00–$31.20/hr', src: ['p-optician'] }],
  },
]
export const samples = { text: 'The people handing out samples in the aisles work for a separate company, Club Demonstration Services (CDS), not for Costco.', src: ['cc-faq'] }

// 3. Depots, logistics and call centers.
export const depots = {
  intro: { text: 'Depots receive large shipments from suppliers and send them on to the warehouses, and Costco Logistics delivers big and bulky items such as furniture and appliances to Costco locations and to members’ homes. Costco’s member service centers answer member calls, emails and chats.', src: ['cc-home', 'sec-10k-2026'] },
  cards: [
    {
      name: 'Forklift operator', aka: 'Depots',
      body: { text: 'Moves pallets of merchandise with a stand-up electric forklift and stacks product by hand.', src: ['p-depot-forklift'] },
      chips: [{ text: '$21.00–$32.90/hr, plus $1.00/hr on the forklift', src: ['p-depot-forklift'] }],
    },
    {
      name: 'Order picker', aka: 'Business delivery orders',
      body: { text: 'Pulls stock for large business delivery orders onto pallets with a manual or electric pallet jack and loads delivery trucks.', src: ['p-picker'] },
      chips: [{ text: '$20.00–$31.20/hr', src: ['p-picker'] }],
    },
    {
      name: 'Fleet truck driver', aka: 'Depots',
      body: { text: 'Drives a tractor-trailer between the depot and warehouses within a 100 air-mile radius, and keeps the logs and inspection reports.', src: ['p-fleet'] },
      chips: [{ text: '$31.00–$37.45/hr', src: ['p-fleet'] }],
    },
    {
      name: 'Delivery driver', aka: 'Business delivery',
      body: { text: 'Drives commercial trucks with air brakes and a hydraulic lift to deliver to businesses, unloads orders and collects payment.', src: ['p-delivery'] },
      chips: [{ text: '$21.00–$32.90/hr, plus $4/hr', src: ['p-delivery'] }],
    },
    {
      name: 'Member service center agent', aka: 'Phone, email, chat',
      body: { text: 'Answers member calls, emails and chats about memberships, Costco.com products and services. Costco says calm problem-solvers with good typing skills do well.', src: ['cc-home'] },
      chips: [{ text: 'Contact center membership agent $21.00–$31.90/hr', src: ['cc-payranges'] }],
    },
  ],
}

// 4. What Costco looks for (its own words; the postings themselves list no education, experience or age line).
export const asks = {
  intro: { text: 'Costco’s postings list duties, pay and benefits. None of the thousands of U.S. postings we read in November 2026 lists a diploma, degree or experience requirement, though jobs such as pharmacist or licensed optician still need the license their title names. Bakery postings list completing a food safety certification and safety training among the duties.', src: ['cc-jobs', 'p-bakery'] },
  items: [
    { name: 'Skills that carry over', text: 'Costco picks “the best-qualified candidates based on transferable skills, prior experience and member service skills.”', src: ['cc-apply'] },
    { name: 'Nights, weekends, early mornings', text: 'Be ready for busy hours, “typically nights and weekends”; stocking happens “in the early morning hours.”', src: ['cc-apply'] },
    { name: 'Open availability', text: 'The Any Position postings say open availability is needed, apart from religious or disability considerations.', src: ['p-any'] },
    { name: 'A skills test, for some jobs', text: '“You may be required to demonstrate skills or pass a business-related test for some positions.”', src: ['cc-apply'] },
    { name: 'Proof you can work in the U.S.', text: 'The Any Position postings say you must show it if hired, and Costco says it takes part in E-Verify nationwide.', src: ['p-any', 'cc-home'] },
    { name: 'A license for some jobs', text: 'Certified pharmacy technician and licensed optician are separate postings from the non-certified and non-licensed ones, with their own pay.', src: ['p-rx-cert', 'p-optician-lic'] },
  ],
  physical: { text: 'The work is on your feet: stockers cut boxes, move pallets with a pallet jack and run the baler and trash compactor; cashier assistants bring in carts.', src: ['p-stocker', 'p-cashier-asst'] },
  age: { text: 'Costco’s careers pages and postings state no minimum age. Federal child-labor rules treat driving a forklift as too dangerous for workers under 18 and limit what 16- and 17-year-olds may do with balers and compactors.', src: ['cc-jobs', 'cc-faq', 'ecfr-hoist', 'ecfr-baler'] },
}

// 5. Pay Costco states, raises, benefits, unions.
export const payIntro = { text: 'For most hourly jobs, a title carries the same stated range on Costco’s postings from state to state, and Costco says pay rises with hours worked.', src: ['cc-jobs', 'cc-why'] }
export const payRows = [
  { role: 'Cashier assistant, food service assistant, gas station attendant', range: '$20.00–$31.20', src: ['p-cashier-asst', 'p-food', 'p-gas'] },
  { role: 'Bakery wrapper, meat wrapper, non-licensed optician', range: '$20.00–$31.20', src: ['p-bakery', 'p-meat', 'p-optician'] },
  { role: 'Stocker', range: 'from $20.00', src: ['p-stocker', 'cc-payranges'] },
  { role: 'Cashier, membership clerk, service deli clerk', range: '$21.00–$32.90', src: ['p-cashier', 'p-membership', 'p-deli'] },
  { role: 'Receiving clerk, non-certified pharmacy technician', range: '$21.00–$32.90', src: ['p-receiving', 'p-rx-noncert'] },
  { role: 'Certified pharmacy technician', range: '$21.00–$32.90 + $3.00', src: ['p-rx-cert'] },
  { role: 'Forklift driver or operator', range: '$21.00–$32.90 + $1.00 on the forklift', src: ['p-forklift', 'p-depot-forklift'] },
  { role: 'Fleet truck driver, depots', range: '$31.00–$37.45', src: ['p-fleet'] },
]
export const payNotes = [
  { text: 'In March 2025 Costco raised its starting wage by $0.50 to at least $20.00 an hour for all entry-level jobs in the U.S. and Canada. In March 2026 it raised the top of its wage scales by $1.00 an hour.', src: ['sec-10k-2025', 'sec-10k-2026'] },
  { text: 'Costco: “regular increases based on accumulated hours”, and tenured hourly employees get extra pay twice a year based on their years of service.', src: ['cc-why'] },
  { text: 'About 5% of Costco’s employees worldwide are represented by unions. A Teamsters release of April 2025 says more than 18,000 Costco Teamsters had recently ratified a new national master agreement; it gives no pay rates.', src: ['sec-10k-2026', 'teamsters-2025'] },
]
export const benefits = [
  { text: 'Costco offers medical, dental, vision, pharmacy and hearing-aid coverage to full-time and part-time employees; spouses, children and domestic partners are also eligible.', src: ['cc-why'] },
  { text: 'It says over 94% of its U.S. employees are eligible for health benefits. Its careers pages do not state the hours or waiting period that make a new hire eligible.', src: ['sust-2025', 'cc-why'] },
  { text: 'Also listed: a 401(k), an employee stock purchase plan, paid sick and vacation time, eight paid holidays plus a floating holiday, and paid bonding leave.', src: ['cc-why'] },
  { text: 'Costco says it sets minimum scheduled hours for full-time and part-time employees and posts weekly schedules weeks in advance.', src: ['cc-why', 'sust-2025'] },
]

// 6. Part-time, seasonal, full-time, and moving up.
export const growth = {
  partTime: { text: '“Most candidates are hired for part-time, entry-level jobs, such as front end assistant, food court, member service and merchandise stocking.” Costco also hires seasonal employees.', src: ['cc-apply', 'sec-10k-2026'] },
  fullTime: { text: 'Costco targets at least half of its workforce being full-time; 63% of its U.S. employees were full-time in its 2025 fiscal year.', src: ['sec-10k-2026', 'sust-2025'] },
  items: [
    { name: 'Managers who started hourly', text: 'Costco says “the vast majority” of its warehouse managers began in hourly jobs, and most of its office staff started in its warehouses, depots and business centers.', src: ['cc-why', 'sust-2025'] },
    { name: 'Supervisor in Training', text: 'Over 8,100 hourly employees in the U.S. and Canada finished the six-week course in Costco’s 2026 fiscal year.', src: ['sec-10k-2026'] },
    { name: 'People stay', text: 'Costco reports a retention rate of about 94% in its 2026 fiscal year for U.S. and Canadian employees with at least a year of service.', src: ['sec-10k-2026'] },
    { name: 'School while you work', text: 'Students can keep their tenure while working toward a degree, and an employee scholarship pays up to $2,500 a year for up to four years.', src: ['cc-why', 'sust-2025'] },
  ],
}
export const growthSay = [
  { text: 'Employees say new hires usually start part-time on the front end and carts, in the food court or stocking, and that full-time comes later, by seniority.', src: ['r-1q9j1i9', 'r-1wv4g0y', 'r-1ouidan', 'r-1s5jfwp'], firstHand: true },
  { text: 'They say a seasonal job often ends after the holidays, but seasonal workers who did well are often among the first called back.', src: ['r-1ouidan', 'r-1s5jfwp', 'r-1q9j1i9'], firstHand: true },
]

// 7. Fake job offers.
export const scams = [
  { text: 'Costco: it “does not extend job offers via email, message app, or text to individuals with whom it has had no prior contact.”', src: ['cc-fraud'] },
  { text: 'Costco says it does not ask for a fee to be considered for a job or to get an offer, and does not let recruiters or agents do so for it. Fake offers often carry a subject like “Provisional Job Offer”.', src: ['cc-fraud'] },
  { text: 'A real Costco email comes from a costco.com address. Report a job scam to the FTC or the FBI’s Internet Crime Complaint Center.', src: ['cc-fraud'] },
  { text: 'The FTC says to ignore generic, unexpected job texts and WhatsApp or Telegram messages (“Real employers will never contact you that way”), and: “Never pay to get paid or get a job.”', src: ['ftc-text'] },
]

// FAQ — visible on the page and mirrored in FAQPage JSON-LD.
export const faq = [
  {
    q: 'Do I need experience to work at Costco?',
    a: { text: 'The entry postings we read list no diploma, degree or experience requirement. Costco picks people on transferable skills, prior experience and member service skills, and most new hires start part-time.', src: ['cc-jobs', 'cc-apply'] },
  },
  {
    q: 'How much does Costco pay to start?',
    a: { text: 'At least $20.00 an hour for entry-level jobs in the U.S. since March 2025. Its postings state $20.00 to $31.20 for jobs like cashier assistant and food court, and $21.00 to $32.90 for cashier and clerk jobs.', src: ['sec-10k-2025', 'p-cashier-asst', 'p-food', 'p-cashier'] },
  },
  {
    q: 'How old do you have to be to work at Costco?',
    a: { text: 'Costco’s careers pages and postings do not state a minimum age. Federal rules bar workers under 18 from driving a forklift, which some Costco jobs require.', src: ['cc-jobs', 'ecfr-hoist', 'p-forklift'] },
  },
  {
    q: 'How do I check on my Costco application?',
    a: { text: 'Call or visit the location you applied to: Costco does not send updates by email or messaging apps. Applications expire after 90 days, so apply again if you have not heard back.', src: ['cc-faq', 'cc-apply'] },
  },
  {
    q: 'Is a Costco job offer by text or email real?',
    a: { text: 'Be wary if it comes out of the blue: Costco says it does not make job offers by email, message app or text to people it has had no prior contact with, and it does not ask for a fee for a job.', src: ['cc-fraud'] },
  },
]

// ── Listings: none. Seen holds no Costco rows (company ilike costco: 0 active, 0 in any state, checked read-only
// 2026-11-17; the 7 active rows with "Costco" in the title are other employers — a carrier hauling for Costco, vendors'
// sales jobs). Costco takes applications on its own site, so the template shows no "Hiring now" block and the
// "How to apply" row sends people to careers.costco.com.
export const listings = null

// ── The page's openable rows (components/start/Guide.tsx `Blocks` renders each block type) ─────────────────────────
export const menu = [
  {
    id: 'apply', title: 'How to apply and get noticed', summary: 'Costco’s own site, then a manager',
    blocks: [
      { type: 'cards', items: [{ name: 'Costco careers', aka: 'Costco’s own job search', link: JOBS, body: apply.site }] },
      { type: 'steps', items: apply.steps },
      { type: 'text', entry: apply.examples },
      { type: 'more', title: 'Veterans, and where Costco has warehouses', blocks: [
        { type: 'text', entry: apply.veterans },
        { type: 'text', entry: apply.where },
      ] },
      { type: 'heading', text: 'What people who were hired say' },
      { type: 'text', plain: 'More than one account agrees on each of these.' },
      { type: 'notes', items: peopleSay },
      { type: 'resumeLink', before: 'Before you apply, you can', label: 'check your résumé against a posting' },
    ],
  },
  {
    id: 'jobs', title: 'Entry jobs in the warehouse', summary: 'Eight job families, with the pay stated',
    blocks: [
      { type: 'cards', items: roles },
      { type: 'note', entry: samples },
    ],
  },
  {
    id: 'depots', title: 'Depots, delivery and call centers', summary: 'Forklifts, picking, driving, phones',
    blocks: [
      { type: 'text', entry: depots.intro },
      { type: 'cards', items: depots.cards },
    ],
  },
  {
    id: 'what-costco-looks-for', title: 'What Costco looks for', summary: 'Availability, skills, work papers, age',
    blocks: [
      { type: 'text', entry: asks.intro },
      { type: 'checklist', items: asks.items, cols: true },
      { type: 'text', entry: asks.physical },
      { type: 'callout', entry: asks.age },
    ],
  },
  {
    id: 'pay', title: 'Pay and benefits', summary: 'Ranges on its postings, raises, benefits',
    blocks: [
      { type: 'text', entry: payIntro },
      { type: 'table', caption: 'Hourly pay stated on Costco’s own postings', columns: [{ key: 'role', label: 'Job' }, { key: 'range', label: 'Stated range, hourly', num: true }], rows: payRows },
      { type: 'notes', items: payNotes },
      { type: 'more', title: 'Benefits', blocks: [{ type: 'notes', items: benefits }] },
    ],
  },
  {
    id: 'moving-up', title: 'Part-time, seasonal and moving up', summary: 'How people start, and what comes next',
    blocks: [
      { type: 'text', entry: growth.partTime },
      { type: 'text', entry: growth.fullTime },
      { type: 'checklist', items: growth.items },
      { type: 'text', plain: 'What employees say. More than one account agrees on each of these.' },
      { type: 'notes', items: growthSay },
    ],
  },
  {
    id: 'fake-offers', title: 'Fake Costco job offers', summary: 'How Costco says real offers arrive',
    blocks: [{ type: 'notes', label: 'Scams', items: scams, icon: 'x', caution: true }],
  },
  { id: 'questions', title: 'Common questions', summary: 'Experience, pay, age, status, offers', blocks: [{ type: 'faq', items: faq }] },
]

// ── Additional resources: every reference above, as plain grouped links (no numbers, closed by default) ────────────
export const resourcesSummary = 'Costco careers, postings, public records'
export const resources = [
  { title: 'Costco careers', items: [
    { key: 'cc-jobs', name: 'Costco job search' },
    { key: 'cc-home', name: 'Costco careers home' },
    { key: 'cc-apply', name: 'Resources for applying' },
    { key: 'cc-why', name: 'Why Costco: benefits and wages' },
    { key: 'cc-payranges', name: 'Pay ranges by position' },
    { key: 'cc-faq', name: 'Career questions (Costco customer service)' },
    { key: 'cc-fraud', name: 'Preventing fraud: fake job offers' },
  ] },
  { title: 'Costco postings', items: [
    { key: 'p-cashier-asst', name: 'Cashier Assistant, Meridian, ID' },
    { key: 'p-cashier', name: 'Cashier, Naples, FL' },
    { key: 'p-membership', name: 'Membership Clerk, Ridgefield, WA' },
    { key: 'p-msa', name: 'Member Service Assistant, Pocatello, ID' },
    { key: 'p-stocker', name: 'Stocker, St. George, UT' },
    { key: 'p-forklift', name: 'Forklift Driver, Camarillo, CA' },
    { key: 'p-receiving', name: 'Receiving Clerk, Port St. Lucie, FL' },
    { key: 'p-food', name: 'Food Service Assistant, Mettawa, IL' },
    { key: 'p-deli', name: 'Service Deli Clerk, Lihue, HI' },
    { key: 'p-bakery', name: 'Bakery Wrapper, Littleton, CO' },
    { key: 'p-meat', name: 'Meat Wrapper, Naples, FL' },
    { key: 'p-gas', name: 'Gas Station Attendant, Oshtemo Township, MI' },
    { key: 'p-rx-cert', name: 'Pharmacy Technician (certified), University City, MO' },
    { key: 'p-rx-noncert', name: 'Pharmacy Technician (non-certified), Mechanicsburg, PA' },
    { key: 'p-optician', name: 'Non-Licensed Optician, Baxter, MN' },
    { key: 'p-optician-lic', name: 'Licensed Optician, St. Charles, IL' },
    { key: 'p-depot-forklift', name: 'Forklift Operator, Eugene, OR' },
    { key: 'p-picker', name: 'Order Picker, Stafford, TX' },
    { key: 'p-fleet', name: 'Fleet Truck Driver, Dallas, TX' },
    { key: 'p-delivery', name: 'Delivery Driver, Reno, NV' },
    { key: 'p-any', name: 'Any Position, Omaha, NE' },
  ] },
  { title: 'Public records', items: [
    { key: 'sec-10k-2026', name: 'Costco annual report, fiscal 2026 (SEC)' },
    { key: 'sec-10k-2025', name: 'Costco annual report, fiscal 2025 (SEC)' },
    { key: 'sust-2025', name: 'Costco sustainability report, 2025' },
    { key: 'teamsters-2025', name: 'Costco Teamsters contract announcement' },
  ] },
  { title: 'Rules and scams', items: [
    { key: 'ecfr-hoist', name: 'Forklifts and workers under 18 (federal rule)' },
    { key: 'ecfr-baler', name: 'Balers, compactors and workers under 18 (federal rule)' },
    { key: 'ftc-text', name: 'Job offer texts (Federal Trade Commission)' },
  ] },
  { title: 'Community discussions', items: [
    { key: 'r-1s5jfwp', name: 'How employees got hired' },
    { key: 'r-1q9j1i9', name: 'Which job new hires usually get' },
    { key: 'r-1tc3i4d', name: 'Tips on getting hired' },
    { key: 'r-1ouidan', name: 'Does a seasonal job lead to more' },
    { key: 'r-1wv4g0y', name: 'Applying to a new warehouse' },
    { key: 'r-1ucq7lf', name: 'What the interview asks' },
  ] },
]

/** Every fact on the page, in reading order: the hero, then each menu row. */
export function pageEntries() {
  return [guide.answer, ...tiles, ...blockEntries(menu)]
}
