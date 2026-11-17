// /start/homedepot — "Getting hired at The Home Depot". A COMPANY guide: the page renders from this module only, so every
// figure on it carries a reference and an as-of date (lib/start/guides.test.mjs fails on a figure without one).
//
// THE ONLY SOURCE OF FACTS is the research file compiled 2026-11-17 (session scratchpad guides20/homedepot/research.md):
// The Home Depot's own careers pages and postings (careers.homedepot.com, read 2026-11-17; postings found through the
// job sitemap its robots.txt lists — one posting per role in six states and one cashier + one freight posting in every
// state and D.C., 189 postings), its Form 10-K for fiscal 2025, its Living Our Values report for fiscal 2025, the Path to
// Pro pages it and The Home Depot Foundation run, and the FTC.
// Rules this module keeps:
//   • only items the research marked VERIFIED; FIRST-HAND items (two or more r/HomeDepot threads agreeing) only as
//     `firstHand: true`, rendered as what people say;
//   • pay only as The Home Depot prints it on its own postings ("The pay range for this position is between …"), with
//     the job ID in the reference; a posting with no pay line ("*" or "$0.00 – $0.00") is never given a figure. Postings
//     carry no posting date (the page stamp 2026-11-09 is a site refresh), so each is dated by the day it was read;
//   • nothing UNVERIFIED or CONFLICTING: no hiring-event dates or seasonal hiring counts (the only releases found are old
//     and undated), no "text JOBS" number, no drug-test policy, no minimum age for store jobs (THD states none; only the
//     under-18 paperwork line and the 21+ rule for drivers, technicians and mechanics), no Path to Pro participant or
//     network counts (three THD pages disagree), no injury rate (the only one found is THD's own report, not OSHA/BLS),
//     no ~465,000 headcount (the careers page; the 10-K says 472,400), no Temco / delivery-partner driver pay (written by
//     a delivery partner, not THD), no scholarship window dates (they go stale);
//   • no lawsuits, executives, stock price; no hype, no guarantees, no exclamation marks;
//   • `listings = null`: Seen held 13 active Home Depot rows on 2026-11-17, all from one aggregator, nine of them in the
//     Boise, Idaho area (read-only check), against one posting per store per role on The Home Depot's own site. The
//     "How to apply" row sends people to careers.homedepot.com instead.
//
// Shape: `sources` (every reference behind the page, kept here and NEVER printed as citations — readers reach the links
// through the grouped "Additional resources" menu, `resources` below), entries `{ text, src, firstHand? }`, `listings`
// (null here) and the openable menu rows (`menu`, rendered by components/start/Guide.tsx). Pure data; relative imports
// only so `node --test` runs it as is.

import { blockEntries } from './entries.js'

/** @typedef {{ label: string, url: string, date: string, note?: string }} Source */

const CAREERS = 'https://careers.homedepot.com/'
const job = (path) => `https://careers.homedepot.com/job/${path}/`
const READ = '2026-11-17'

/** @type {Record<string, Source>} */
export const sources = {
  'thd-careers': { label: 'The Home Depot Careers, home page (where it takes applications, and its warning about fake recruiters)', url: CAREERS, date: READ, note: 'read' },
  'thd-assessment': { label: 'The Home Depot Careers, Online Assessment', url: 'https://careers.homedepot.com/online-assessment/', date: READ, note: 'read' },
  'thd-onsite': { label: 'The Home Depot Careers, Onsite Visit Preparation', url: 'https://careers.homedepot.com/onsite/', date: READ, note: 'read' },
  'thd-orientation': { label: 'The Home Depot Careers, Onsite Orientation (documents to bring)', url: 'https://careers.homedepot.com/orientation/', date: READ, note: 'read' },
  'thd-benefits': { label: 'The Home Depot Careers, Our Benefits', url: 'https://careers.homedepot.com/our-benefits/', date: READ, note: 'read' },
  'thd-about': { label: 'The Home Depot Careers, About Us (career growth)', url: 'https://careers.homedepot.com/about-us/', date: READ, note: 'read' },
  'role-cashier': { label: 'The Home Depot Careers, Cashier role page', url: 'https://careers.homedepot.com/career-areas/retail/cashier/', date: READ, note: 'read' },
  'role-sales': { label: 'The Home Depot Careers, Customer Service/Sales role page', url: 'https://careers.homedepot.com/career-areas/retail/customer-service-sales/', date: READ, note: 'read' },
  'role-freight': { label: 'The Home Depot Careers, Freight/Receiving role page and Overnight Freight Associate page', url: 'https://careers.homedepot.com/career-areas/retail/freight/', date: READ, note: 'read' },
  'role-merch': { label: 'The Home Depot Careers, Merchandising Associate role page and Overnight Merchandising Associate page', url: 'https://careers.homedepot.com/career-areas/retail/merchandising-in-store/', date: READ, note: 'read' },
  'role-support': { label: 'The Home Depot Careers, Support Associate role page (lot associates)', url: 'https://careers.homedepot.com/career-areas/retail/support/', date: READ, note: 'read' },
  'role-ds': { label: 'The Home Depot Careers, Department Supervisor role page', url: 'https://careers.homedepot.com/career-areas/retail/department-supervisor/', date: READ, note: 'read' },
  'role-asm': { label: 'The Home Depot Careers, Assistant Store Manager role page', url: 'https://careers.homedepot.com/career-areas/retail/assistant-store-manager/', date: READ, note: 'read' },
  'role-nrm': { label: 'The Home Depot Careers, Night Replenishment Manager role page', url: 'https://careers.homedepot.com/career-areas/retail/night-replenishment-manager/', date: READ, note: 'read' },
  'role-dc': { label: 'The Home Depot Careers, Distribution Centers pages (warehouse associate, office support, maintenance)', url: 'https://careers.homedepot.com/career-areas/warehouse-jobs/', date: READ, note: 'read' },
  'role-driver': { label: 'The Home Depot Careers, Drivers role page', url: 'https://careers.homedepot.com/career-areas/driver/', date: READ, note: 'read' },
  // The Home Depot's own postings (pay as printed on the posting; read 2026-11-17).
  'p-cashier': { label: 'The Home Depot postings, Cashier: 75936BR Virginia Beach, VA; 76102BR Seattle, WA; 71115BR San Diego, CA; plus one cashier posting read in every state and D.C.', url: job('6952685/cashier-seattle-wa'), date: READ, note: 'read' },
  'p-cashier-va': { label: 'The Home Depot posting 75936BR, Cashier, Virginia Beach, VA', url: job('6952539/cashier-virginia-beach-va'), date: READ, note: 'read' },
  'p-cashier-sd': { label: 'The Home Depot posting 71115BR, Cashier, San Diego, CA (with the online assessment and benefits text every store posting carries)', url: job('6948289/cashier-san-diego-ca'), date: READ, note: 'read' },
  'p-sales': { label: 'The Home Depot postings, Customer Service/Sales: 78099BR Syosset, NY and 76100BR Tukwila, WA', url: job('6954420/customer-service-sales-syosset-ny'), date: READ, note: 'read' },
  'p-freight': { label: 'The Home Depot postings, Freight/Receiving: 84409BR Las Vegas, NV and 76091BR Issaquah, WA; plus one freight posting read in every state and D.C.', url: job('6958080/freight-receiving-las-vegas-nv'), date: READ, note: 'read' },
  'p-merch': { label: 'The Home Depot postings, Merchandising: 72798BR Colorado Springs, CO and 85923BR Bellingham, WA', url: job('6949774/merchandising-colorado-springs-co'), date: READ, note: 'read' },
  'p-lot': { label: 'The Home Depot postings, Lot Associate: 117218BR Schenectady, NY and 116943BR Emeryville, CA', url: job('7149169/lot-associate-emeryville-ca'), date: READ, note: 'read' },
  'p-pro': { label: 'The Home Depot postings, Pro Customer Service/Sales: 155853BR Monument, CO and 155641BR San Diego, CA', url: job('22708404/pro-customer-service-sales-san-diego-ca'), date: READ, note: 'read' },
  'p-tool': { label: 'The Home Depot postings, Repair and Tool Technician 120757BR Ridgecrest, CA and Tool Rental Technician 158261BR Placerville, CA', url: job('23533370/tool-rental-technician-placerville-ca'), date: READ, note: 'read' },
  'p-ds': { label: 'The Home Depot postings, Department Supervisor: 72699BR Pueblo, CO and 81017BR Oceanside, CA', url: job('6955084/department-supervisor-oceanside-ca'), date: READ, note: 'read' },
  'p-asm': { label: 'The Home Depot posting Req193755, Assistant Store Manager (Merchandising ASM in Training), Lemon Grove, CA', url: job('23887667/assistant-store-manager-lemon-grove-ca'), date: READ, note: 'read' },
  'p-gwa': { label: 'The Home Depot postings, Warehouse Associate (distribution centers): 153434BR Ontario, CA and 125715BR Hicksville, NY', url: job('22537992/warehouse-associate-ontario-ca'), date: READ, note: 'read' },
  'p-rdd1': { label: 'The Home Depot posting Req182587, Rental Delivery Driver I CDLA, Jericho, NY', url: job('23451248/rental-delivery-driver-i-cdla-jericho-ny-jericho-ny'), date: READ, note: 'read' },
  'p-rdd2': { label: 'The Home Depot posting Req197229, Rental Delivery Driver II CDLA, Signal Hill, CA', url: job('24110542/rental-delivery-driver-ii-cdla-los-angeles-ca-signal-hill-ca'), date: READ, note: 'read' },
  'p-yard-cdl': { label: 'The Home Depot posting Req175782, Yard Driver CDL, Joliet, IL', url: job('23230583/yard-driver-cdl-joliet-il'), date: READ, note: 'read' },
  'p-yard': { label: 'The Home Depot posting Req192947, Yard Driver Non CDL, Dallas, TX', url: job('23854694/yard-driver-non-cdl-dallas-tx'), date: READ, note: 'read' },
  'sec-10k': {
    label: 'The Home Depot, Inc. Form 10-K for fiscal 2025, the year ended February 1, 2026 (SEC EDGAR)',
    url: 'https://www.sec.gov/Archives/edgar/data/354950/000162828026019436/hd-20260201.htm',
    date: '2026-03-18', note: 'filed',
  },
  'thd-lov': {
    label: 'The Home Depot, Living Our Values report, fiscal 2025',
    url: 'https://corporate.homedepot.com/sites/default/files/2026-09/THD_LOV_vF9.17_0.pdf',
    date: '2026-09', note: 'published',
  },
  'ptp-corp': { label: 'The Home Depot, "Path to Pro: Our Commitment to the Skilled Trades"', url: 'https://corporate.homedepot.com/page/path-pro-our-commitment-skilled-trades', date: READ, note: 'read' },
  'ptp-faq': { label: 'Path to Pro (The Home Depot), Frequently Asked Questions', url: 'https://www.pathtopro.com/faq/', date: '2026-10-26', note: 'updated' },
  'ptp-training': { label: 'Path to Pro (The Home Depot), Free Trades Training: the Path to Pro Skills Program', url: 'https://www.pathtopro.com/free-training/', date: '2026-11-11', note: 'updated' },
  'ptp-foundation': { label: 'The Home Depot Foundation, Path to Pro programs and scholarships', url: 'https://www.pathtopro.com/foundation/', date: '2026-10-19', note: 'updated' },
  'ftc-jobs': { label: 'Federal Trade Commission, Job Scams (consumer advice)', url: 'https://consumer.ftc.gov/articles/job-scams', date: READ, note: 'read' },
  'ftc-text': { label: 'Federal Trade Commission consumer alert, "That job offer text is probably a scam"', url: 'https://www.consumer.ftc.gov/consumer-alerts/2026/04/job-offer-text-probably-scam', date: '2026-04-30', note: 'published' },
  // First-hand accounts (r/HomeDepot, read through the Arctic Shift archive). Used only where two or more agree.
  'r-1o6orr3': { label: 'r/HomeDepot, "Job Interview went fast, should I be worried?"', url: 'https://www.reddit.com/r/HomeDepot/comments/1o6orr3/', date: '2025-10-14', note: 'thread' },
  'r-1m9y77m': { label: 'r/HomeDepot, "pls help i have an interview at home depot today"', url: 'https://www.reddit.com/r/HomeDepot/comments/1m9y77m/', date: '2025-07-26', note: 'thread' },
  'r-1nunmua': { label: 'r/HomeDepot, "Accepted job offer (interview or orientation)"', url: 'https://www.reddit.com/r/HomeDepot/comments/1nunmua/', date: '2025-09-30', note: 'thread' },
  'r-1o3f77s': { label: 'r/HomeDepot, "Call after Job offer/interview"', url: 'https://www.reddit.com/r/HomeDepot/comments/1o3f77s/', date: '2025-10-10', note: 'thread' },
  'r-1o687ie': { label: 'r/HomeDepot, "Job offer/interview … haven’t [had a call]"', url: 'https://www.reddit.com/r/HomeDepot/comments/1o687ie/', date: '2025-10-14', note: 'thread' },
}

export const guide = {
  path: '/start/homedepot',
  title: 'Getting hired at The Home Depot',
  crumbLabel: 'The Home Depot',
  eyebrow: 'Company guide',
  // The one-sentence answer under the h1 (no figure: the figures live in the tiles).
  answer: { text: 'The Home Depot’s store jobs welcome people with no experience: you apply on its own careers site, take a short online assessment, then visit the store. Most of the work is on your feet, freight runs overnight, and pay is printed on its postings in some states but not others.', src: ['thd-careers', 'thd-assessment', 'thd-onsite', 'role-cashier', 'role-freight', 'p-cashier'] },
  metaDescription: 'How people get hired at The Home Depot: cashier, sales, freight, lot, Pro desk, tool rental, warehouse and driver jobs, the online assessment and store visit, pay printed on its own postings, benefits, moving up, Path to Pro and fake job offers.',
  asOf: '2026-11-17',
}

// The three readings in the hero: each restates a fact below, with the same references.
export const tiles = [
  { label: 'Cashier pay, where posted', value: '$15.00–$23.50', text: 'an hour on The Home Depot’s own cashier postings in November 2026, from Virginia Beach to Seattle. Postings in Texas, Georgia, Florida and many other states show no pay.', src: ['p-cashier', 'p-cashier-va'] },
  { label: 'The online assessment', value: 'About 20 min', text: 'online, on a phone or a computer, for a store or warehouse job, with 96 hours to finish it', src: ['thd-assessment'] },
  { label: 'Store leaders who began hourly', value: 'About 90%', text: 'of The Home Depot’s U.S. store leaders at the end of 2025, by its own count', src: ['thd-lov', 'thd-about'] },
]

// 1. How to apply, and the steps The Home Depot describes.
export const apply = {
  site: { text: 'The Home Depot takes applications only on careers.homedepot.com, and on careerdepot.homedepot.com for people who already work there. Search by job title and the store or city you can get to.', src: ['thd-careers'] },
  more: { text: 'Each store posts each role on its own. The postings ask you to "come back and apply for other jobs at this store and any store near you."', src: ['p-cashier-sd'] },
  steps: [
    { step: 'Apply online', text: 'From a phone or a computer. You do not need to go to the store to apply or to take the assessment.', src: ['sec-10k', 'thd-assessment'] },
    { step: 'Take the assessment', text: 'The link opens right after you apply. You have 96 hours, it takes about 20 minutes, and you can stop and restart.', src: ['thd-assessment', 'p-cashier-sd'] },
    { step: 'The store visit', text: 'If you are picked, you may be contacted by email or phone for an interview. Arrive 15 minutes early; under 18, bring a parent or guardian to sign documents.', src: ['thd-assessment', 'thd-onsite'] },
    { step: 'Change the time only once', text: 'You can move the visit once, up to 24 hours before. Miss the new time and you are no longer considered for that job.', src: ['thd-onsite'] },
    { step: 'Orientation', text: 'Bring unexpired papers that show who you are and that you can work in the U.S.: one from List A, or one each from List B and List C.', src: ['thd-orientation'] },
  ],
  assessment: { text: 'Store and merchandising applicants get 11 short video scenarios, choosing what they would be most and least likely to do, then 16 multiple-choice questions; supply chain applicants get 8 and 10. The questions cover customer service (store jobs only), learning, dependability, teamwork, safety and initiative, and you can answer from school or volunteer work.', src: ['thd-assessment'] },
  help: { text: 'A job coach or a support person such as a parent may help you apply and take the assessment. If a disability could affect your score, you can ask for an alternative by emailing myTHDHR@homedepot.com.', src: ['thd-assessment'] },
  status: { text: 'To check where you stand, the careers site has one status link for hourly store and warehouse jobs, and a Workday "Jobs Hub" for drivers, salaried and office jobs.', src: ['thd-careers'] },
}
export const peopleSay = [
  { text: 'The store visit is often short, a few minutes, and mostly about which hours you can work.', src: ['r-1o6orr3', 'r-1m9y77m', 'r-1nunmua'], firstHand: true },
  { text: 'Open availability is what people say helps most.', src: ['r-1o6orr3', 'r-1m9y77m'], firstHand: true },
  { text: 'A background check comes before your first day.', src: ['r-1o6orr3', 'r-1m9y77m'], firstHand: true },
  { text: 'No word a week or so after the visit: people say call the store and ask for the person who met you.', src: ['r-1o3f77s', 'r-1o687ie'], firstHand: true },
]

// 2. Store jobs, by The Home Depot's own titles (pay chips from its own postings).
export const storeIntro = { text: 'For its hourly store roles The Home Depot says, "We welcome all experience levels, from entry-level to those that have prior career experience." The store postings list no degree or experience.', src: ['role-cashier', 'role-sales', 'p-cashier'] }
export const storeJobs = [
  {
    name: 'Cashier', aka: 'Front end and self-checkout',
    body: { text: 'Rings up sales and returns and looks after self-checkout. Full-time cashiers have morning, afternoon and evening shifts with schedules given ahead.', src: ['role-cashier'] },
    chips: [{ text: '$15.00–$16.00/hr, Virginia Beach', src: ['p-cashier-va'] }, { text: '$22.50–$23.50/hr, Seattle', src: ['p-cashier'] }],
  },
  {
    name: 'Customer service and sales', aka: 'One department: plumbing, lumber, paint, garden and others',
    body: { text: 'Finds customers in the aisles, helps them pick products and keeps the shelves stocked. The Home Depot says it trains people with no home improvement experience.', src: ['role-sales', 'p-sales'] },
    chips: [{ text: '$17.50–$20.50/hr, Syosset, NY', src: ['p-sales'] }, { text: '$23.00–$24.00/hr, Tukwila, WA', src: ['p-sales'] }],
  },
  {
    name: 'Freight and receiving', aka: 'The overnight team',
    body: { text: 'Unloads trucks and stocks the shelves. Most freight jobs run evenings and overnight, and the work uses forklifts and conveyors but still means lifting.', src: ['role-freight'] },
    chips: [{ text: '$17.00–$18.00/hr, Las Vegas', src: ['p-freight'] }, { text: '$23.00–$24.00/hr, Issaquah, WA', src: ['p-freight'] }],
  },
  {
    name: 'Merchandising', aka: 'Displays, resets and signs',
    body: { text: 'Builds displays with hand and power tools and reorganizes aisles, with repeated lifting and lift equipment. There are day, overnight and travel jobs; the travel team covers stores within about 30 miles and needs reliable transportation, a driver’s license and insurance.', src: ['role-merch', 'p-merch'] },
    chips: [{ text: '$17.00/hr, Colorado Springs', src: ['p-merch'] }, { text: '$21.50/hr, Bellingham, WA', src: ['p-merch'] }],
  },
  {
    name: 'Lot associate', aka: 'Store support',
    body: { text: 'Helps customers load their vehicles and keeps carts at the entrance, outside in any weather. Lot associates are most of the store’s support jobs, which also include office and order fulfillment work.', src: ['p-lot', 'role-support'] },
    chips: [{ text: '$17.00/hr, Schenectady, NY', src: ['p-lot'] }, { text: '$21.50/hr, Emeryville, CA', src: ['p-lot'] }],
  },
  {
    name: 'Pro desk', aka: 'Pro customer service and sales',
    body: { text: 'Serves contractors and other professional buyers at the Pro Desk, with loading and deliveries. These jobs carry monthly sales goals, and some stores prefer bilingual applicants.', src: ['p-pro'] },
    chips: [{ text: '$16.50–$18.50/hr, Monument, CO', src: ['p-pro'] }, { text: '$20.00–$22.00/hr, San Diego', src: ['p-pro'] }],
  },
  {
    name: 'Tool rental', aka: 'Repair and tool technician, tool rental technician',
    body: { text: 'Writes rental contracts and keeps the rental equipment running: diagnosing and repairing small engines, outdoor power equipment and handheld electric tools.', src: ['p-tool'] },
    chips: [{ text: '$23.00/hr, Ridgecrest, CA', src: ['p-tool'] }, { text: '$24.00/hr, Placerville, CA', src: ['p-tool'] }],
  },
]

// 3. Distribution centers and drivers.
export const dcIntro = { text: 'Beyond the stores, The Home Depot runs distribution and fulfillment centers, flatbed centers for lumber and building materials, and local hubs for appliance delivery.', src: ['sec-10k'] }
export const dcJobs = [
  {
    name: 'Warehouse associate', aka: 'Distribution centers',
    body: { text: 'Unloads vendor trucks, moves product with hand trucks, forklifts and conveyors, and loads it for delivery. Depending on the warehouse, some shifts are overnight.', src: ['role-dc', 'p-gwa'] },
    chips: [{ text: '$21.25/hr, Ontario, CA', src: ['p-gwa'] }, { text: '$23.50–$25.00/hr, Hicksville, NY', src: ['p-gwa'] }],
  },
  {
    name: 'Warehouse office and maintenance', aka: null,
    body: { text: 'In some warehouses office associates schedule deliveries and handle orders, usually with no overnight shifts. Maintenance associates need no formal certification, only the ability and interest to learn.', src: ['role-dc'] },
    chips: [],
  },
  {
    name: 'Yard driver', aka: 'With or without a CDL',
    body: { text: 'Keeps the trailers in a warehouse yard organized and safe at the dock doors. The non-CDL job asks for a driver’s license and the ability to load heavy items.', src: ['p-yard', 'p-yard-cdl'] },
    chips: [{ text: '$30.00/hr with a CDL, Joliet, IL', src: ['p-yard-cdl'] }],
  },
  {
    name: 'Rental delivery driver', aka: 'Class A CDL',
    body: { text: 'Delivers large rental equipment to job sites and shows customers how to run it. The entry level asks for a CDL-A, a DOT medical card, a clean record and a year of commercial driving in the last five; level II asks for two years of tractor-trailer and one of flatbed.', src: ['p-rdd1', 'p-rdd2'] },
    chips: [{ text: '$28.00–$31.00/hr level I, Jericho, NY', src: ['p-rdd1'] }, { text: '$36.00–$38.00/hr level II, Signal Hill, CA', src: ['p-rdd2'] }],
  },
]
export const driverRules = { text: 'Delivery drivers, technicians and mechanics must be at least 21. Not every driver needs a CDL, the routes are local, and The Home Depot says it trains drivers on the job.', src: ['role-driver'] }
export const cdlCard = { name: 'Getting a CDL', aka: 'Seen’s guide to commercial driving', link: '/start/cdl', body: { text: 'The Class A delivery jobs want the license and driving experience first.', src: ['p-rdd1', 'p-rdd2'] } }

// 4. Pay as printed on The Home Depot's own postings.
export const payIntro = { text: 'The Home Depot prints a pay range on its postings in some states, including California, Washington, Colorado, New York, Illinois and Virginia. Its postings in Texas, Georgia, Florida and many other states show none, so none is shown for them here.', src: ['p-cashier', 'p-freight'] }
export const payRows = [
  { role: 'Cashier', place: 'Virginia Beach, VA', pay: '$15.00–$16.00', src: ['p-cashier-va'] },
  { role: 'Cashier', place: 'San Diego, CA', pay: '$20.00–$21.00', src: ['p-cashier-sd'] },
  { role: 'Cashier', place: 'Seattle, WA', pay: '$22.50–$23.50', src: ['p-cashier'] },
  { role: 'Customer Service/Sales', place: 'Syosset, NY', pay: '$17.50–$20.50', src: ['p-sales'] },
  { role: 'Freight/Receiving', place: 'Las Vegas, NV', pay: '$17.00–$18.00', src: ['p-freight'] },
  { role: 'Merchandising', place: 'Colorado Springs, CO', pay: '$17.00', src: ['p-merch'] },
  { role: 'Lot Associate', place: 'Emeryville, CA', pay: '$21.50', src: ['p-lot'] },
  { role: 'Pro Customer Service/Sales', place: 'San Diego, CA', pay: '$20.00–$22.00', src: ['p-pro'] },
  { role: 'Tool Rental Technician', place: 'Placerville, CA', pay: '$24.00', src: ['p-tool'] },
  { role: 'Department Supervisor', place: 'Pueblo, CO', pay: '$20.50', src: ['p-ds'] },
  { role: 'Warehouse Associate', place: 'Hicksville, NY', pay: '$23.50–$25.00', src: ['p-gwa'] },
  { role: 'Rental Delivery Driver I, CDL-A', place: 'Jericho, NY', pay: '$28.00–$31.00', src: ['p-rdd1'] },
]
export const payNote = { text: 'Hourly pay as printed in November 2026. Each posting adds: "Starting pay may vary based on factors including, but not limited to, position offered and location."', src: ['p-cashier-sd'] }
export const benefits = [
  { text: 'Medical insurance is for full-time associates only. The benefits page lists dental and vision without that limit, and a $120 vision plan is free to all.', src: ['thd-benefits'] },
  { text: 'Vacation: full-time hourly associates get 40 hours after 6 months, part-time 20 hours. Sick time: 4 hours a month full-time, 2 part-time, or what the law requires. Six paid holidays a year.', src: ['thd-benefits'] },
  { text: 'A 401(k) with a company match, and Home Depot stock at a 15% discount through payroll, up to a cap.', src: ['thd-benefits'] },
  { text: 'Tuition reimbursement, scholarships and lower tuition at partner colleges. The amounts are not stated on its careers site.', src: ['thd-benefits', 'p-cashier-sd'] },
  { text: 'Success Sharing, its profit-sharing bonus for hourly associates, paid non-management associates about $288 million for 2025.', src: ['thd-lov', 'sec-10k'] },
]

// 5. Moving up.
export const movingUp = [
  { name: 'Department supervisor', text: 'Still an hourly job: coaching and training the associates in several departments, as the step before a salaried role.', src: ['role-ds', 'p-ds'] },
  { name: 'Assistant store manager', text: 'Salaried, with company stock and a manager bonus of 25–60% of salary depending on the store. Every store has four.', src: ['role-asm'] },
  { name: 'Night replenishment manager', text: 'Salaried, with overtime pay, running the overnight freight team in stores that take freight six or seven nights a week.', src: ['role-nrm'] },
  { name: 'Out of the store', text: 'A Career Mobility Program opens Store Support Center (head office) roles to hourly associates who are not pursuing a college degree.', src: ['thd-lov'] },
]
export const asmPosting = { text: 'One assistant store manager posting in Lemon Grove, CA paid $82,100–$92,100 a year, asked for a high school diploma or GED and a year of work experience, with a training period of up to 6 weeks.', src: ['p-asm'] }
export const leaders = { text: 'The Home Depot says about 90% of its U.S. store leaders began as hourly associates.', src: ['thd-lov', 'thd-about'] }

// 6. Path to Pro and trades training.
export const ptp = {
  what: { text: 'Path to Pro is The Home Depot’s free trades program. It trains people for trades careers, and the hiring it offers is through its job network, where contractors and other Pro customers of The Home Depot look for workers.', src: ['ptp-corp', 'ptp-faq'] },
  items: [
    { name: 'Skills Program, age 16 and up', text: 'Free, self-paced online courses in the basics of general construction, electrical, HVAC, plumbing, painting and jobsite safety, with a completion certificate. The first course takes about an hour.', src: ['ptp-training', 'ptp-faq', 'ptp-corp'] },
    { name: 'Path to Pro Network, age 18 and up', text: 'A free profile that hiring Pros can find and invite to their jobs.', src: ['ptp-corp', 'ptp-faq'] },
    { name: 'Skills Explorers, ages 11 to 17', text: 'Free lessons a teacher or group leader runs.', src: ['ptp-corp'] },
    { name: 'Associates on their own time', text: 'Home Depot employees can take Path to Pro, but not while on the clock.', src: ['ptp-faq'] },
  ],
  foundation: { text: 'The Home Depot Foundation adds hands-on programs with partners: a 9-week Path to Pro Academy with free carpentry and electrical training in six cities, pre-apprenticeship training for people leaving the military at 10 U.S. bases, high school programs, and trade school scholarships that accept applications year-round.', src: ['ptp-foundation', 'ptp-corp'] },
}
export const tradesCard = { name: 'Getting into the trades', aka: 'Seen’s guide to apprenticeships and trade jobs', link: '/start/trades', body: { text: 'Path to Pro’s online courses teach the basics of several trades.', src: ['ptp-training'] } }

// 7. Before you apply, and scams.
export const beforeYouApply = [
  { text: 'Freight, merchandising and lot jobs are physical: lifting, bending, walking all shift, and lot work outdoors in any weather.', src: ['role-freight', 'p-merch', 'role-support'] },
  { text: 'Freight is mostly overnight work, and some merchandising jobs travel between stores.', src: ['role-freight', 'role-merch'] },
  { text: 'Pro desk jobs carry monthly sales goals.', src: ['p-pro'] },
  { text: 'A pay range on a California or Washington posting is not a promise for a store in another state.', src: ['p-cashier', 'p-cashier-sd'] },
]
export const scams = [
  { text: 'The Home Depot takes applications only on careers.homedepot.com, and says it "will never ask for the exchange of money or credit card details" when hiring. If in doubt, it says, ignore the message.', src: ['thd-careers'] },
  { text: 'Fake recruiters often claim to be with companies you know. The FTC: "Real employers will never contact you that way," about job offers by unexpected text, WhatsApp or Telegram.', src: ['ftc-text'] },
  { text: '"Honest employers, including the federal government, will never ask you to pay to get a job."', src: ['ftc-jobs'] },
  { text: 'An employer who sends you a check to deposit and asks you to send part of it back is running a fake check scam.', src: ['ftc-jobs'] },
]
export const company = { text: 'The Home Depot had 2,359 stores at the start of February 2026, 324 of them in Canada and Mexico, and about 422,500 associates in the U.S.', src: ['sec-10k'] }

// FAQ — visible on the page and mirrored in FAQPage JSON-LD.
export const faq = [
  {
    q: 'How old do you have to be to work at Home Depot?',
    a: { text: 'Its store postings state no minimum age, and The Home Depot asks applicants under 18 to bring a parent or guardian to the store visit to sign documents. Delivery drivers, technicians and mechanics must be at least 21.', src: ['p-cashier', 'thd-onsite', 'role-driver'] },
  },
  {
    q: 'How much does Home Depot pay cashiers?',
    a: { text: 'Where the posting shows pay, $15.00–$16.00 an hour in Virginia Beach up to $22.50–$23.50 in Seattle, in November 2026. Postings in Texas, Georgia, Florida and many other states show no pay.', src: ['p-cashier', 'p-cashier-va'] },
  },
  {
    q: 'What is on the Home Depot assessment?',
    a: { text: 'Short video scenarios where you pick what you would most and least likely do, then multiple-choice questions about how you work. It takes about 20 minutes, and you have 96 hours to finish it.', src: ['thd-assessment'] },
  },
  {
    q: 'Do I need experience to work at Home Depot?',
    a: { text: 'Not for its hourly store jobs: The Home Depot says it welcomes all experience levels and trains sales associates who are new to home improvement. The Class A driver and assistant manager postings do ask for experience.', src: ['role-cashier', 'role-sales', 'p-rdd1', 'p-asm'] },
  },
  {
    q: 'Will Path to Pro get me a job at Home Depot?',
    a: { text: 'Not directly. Path to Pro is free trades training, and the hiring it offers is through its network, where contractors and other Pro customers of The Home Depot look for workers. Store and warehouse jobs are applied for on careers.homedepot.com.', src: ['ptp-corp', 'ptp-faq', 'thd-careers'] },
  },
  {
    q: 'How do I know a Home Depot job offer is real?',
    a: { text: 'The Home Depot takes applications only on careers.homedepot.com and never asks for money or card details when hiring. A job offer by an unexpected text, or any request to pay, is a scam.', src: ['thd-careers', 'ftc-text', 'ftc-jobs'] },
  },
]

// ── Listings: none. Seen held 13 active Home Depot rows on 2026-11-17, all from one aggregator and nine of them in the
// Boise, Idaho area, while The Home Depot posts each role at each of its stores on its own site. So the template shows
// no "Hiring now" block, and the "How to apply" row sends people to careers.homedepot.com.
export const listings = null

// ── The page's openable rows (components/start/Guide.tsx `Blocks` renders each block type) ─────────────────────────
export const menu = [
  {
    id: 'apply', title: 'How to apply and get hired', summary: 'Apply online, the assessment, the store visit',
    blocks: [
      { type: 'cards', items: [{ name: 'The Home Depot Careers', aka: 'Its own job search', link: CAREERS, body: apply.site }] },
      { type: 'text', entry: apply.more },
      { type: 'steps', items: apply.steps },
      { type: 'more', title: 'The assessment, help, and checking your status', blocks: [
        { type: 'text', entry: apply.assessment },
        { type: 'text', entry: apply.help },
        { type: 'text', entry: apply.status },
      ] },
      { type: 'heading', text: 'What applicants say' },
      { type: 'text', plain: 'More than one account agrees on each of these.' },
      { type: 'notes', items: peopleSay },
      { type: 'resumeLink', before: 'Before you apply, you can', label: 'check your résumé against a posting' },
    ],
  },
  {
    id: 'store-jobs', title: 'Store jobs', summary: 'Cashier to tool rental, with posted pay',
    blocks: [
      { type: 'text', entry: storeIntro },
      { type: 'cards', items: storeJobs },
    ],
  },
  {
    id: 'warehouse-drivers', title: 'Warehouses and drivers', summary: 'Distribution centers, yard and delivery',
    blocks: [
      { type: 'text', entry: dcIntro },
      { type: 'cards', items: dcJobs },
      { type: 'callout', entry: driverRules },
      { type: 'cards', items: [cdlCard] },
    ],
  },
  {
    id: 'pay', title: 'Pay and benefits', summary: 'Pay printed on its postings, by role',
    blocks: [
      { type: 'text', entry: payIntro },
      { type: 'table', caption: 'Pay printed on The Home Depot’s own postings', columns: [{ key: 'role', label: 'Role' }, { key: 'place', label: 'Where' }, { key: 'pay', label: 'Hourly pay', num: true }], rows: payRows },
      { type: 'note', entry: payNote },
      { type: 'more', title: 'Benefits', blocks: [{ type: 'notes', items: benefits }] },
    ],
  },
  {
    id: 'moving-up', title: 'Moving up', summary: 'Supervisor, assistant manager and more',
    blocks: [
      { type: 'text', entry: leaders },
      { type: 'checklist', items: movingUp },
      { type: 'text', entry: asmPosting },
    ],
  },
  {
    id: 'path-to-pro', title: 'Path to Pro and trades training', summary: 'Free trades training, and what it is not',
    blocks: [
      { type: 'callout', entry: ptp.what },
      { type: 'checklist', items: ptp.items },
      { type: 'text', entry: ptp.foundation },
      { type: 'cards', items: [tradesCard] },
    ],
  },
  {
    id: 'watch-out', title: 'Watch out', icon: 'caution', summary: 'Hard work, missing pay, fake offers',
    blocks: [
      { type: 'notesGrid', groups: [
        { label: 'Before you apply', items: beforeYouApply, icon: 'dot' },
        { label: 'Scams', items: scams, icon: 'x' },
      ] },
      { type: 'note', entry: company },
    ],
  },
  { id: 'questions', title: 'Common questions', summary: 'Age, pay, assessment, Path to Pro, scams', blocks: [{ type: 'faq', items: faq }] },
]

// ── Additional resources: every reference above, as plain grouped links (no numbers, closed by default) ────────────
export const resourcesSummary = 'Home Depot careers, postings, records'
export const resources = [
  { title: 'The Home Depot careers', items: [
    { key: 'thd-careers', name: 'The Home Depot Careers job search' },
    { key: 'thd-assessment', name: 'The online assessment' },
    { key: 'thd-onsite', name: 'Preparing for the store visit' },
    { key: 'thd-orientation', name: 'Orientation: documents to bring' },
    { key: 'thd-benefits', name: 'Benefits' },
    { key: 'thd-about', name: 'About The Home Depot and career growth' },
  ] },
  { title: 'Role pages', items: [
    { key: 'role-cashier', name: 'Cashier' },
    { key: 'role-sales', name: 'Customer service and sales' },
    { key: 'role-freight', name: 'Freight and receiving' },
    { key: 'role-merch', name: 'Merchandising' },
    { key: 'role-support', name: 'Store support and lot associates' },
    { key: 'role-ds', name: 'Department supervisor' },
    { key: 'role-asm', name: 'Assistant store manager' },
    { key: 'role-nrm', name: 'Night replenishment manager' },
    { key: 'role-dc', name: 'Distribution centers' },
    { key: 'role-driver', name: 'Drivers' },
  ] },
  { title: 'Postings on this page', items: [
    { key: 'p-cashier', name: 'Cashier, Seattle, WA' },
    { key: 'p-cashier-va', name: 'Cashier, Virginia Beach, VA' },
    { key: 'p-cashier-sd', name: 'Cashier, San Diego, CA' },
    { key: 'p-sales', name: 'Customer Service/Sales, Syosset, NY' },
    { key: 'p-freight', name: 'Freight/Receiving, Las Vegas, NV' },
    { key: 'p-merch', name: 'Merchandising, Colorado Springs, CO' },
    { key: 'p-lot', name: 'Lot Associate, Emeryville, CA' },
    { key: 'p-pro', name: 'Pro Customer Service/Sales, San Diego, CA' },
    { key: 'p-tool', name: 'Tool Rental Technician, Placerville, CA' },
    { key: 'p-ds', name: 'Department Supervisor, Oceanside, CA' },
    { key: 'p-asm', name: 'Assistant Store Manager, Lemon Grove, CA' },
    { key: 'p-gwa', name: 'Warehouse Associate, Ontario, CA' },
    { key: 'p-rdd1', name: 'Rental Delivery Driver I, Jericho, NY' },
    { key: 'p-rdd2', name: 'Rental Delivery Driver II, Signal Hill, CA' },
    { key: 'p-yard-cdl', name: 'Yard Driver CDL, Joliet, IL' },
    { key: 'p-yard', name: 'Yard Driver Non CDL, Dallas, TX' },
  ] },
  { title: 'Public records', items: [
    { key: 'sec-10k', name: 'The Home Depot annual report, fiscal 2025 (SEC)' },
    { key: 'thd-lov', name: 'The Home Depot Living Our Values report, fiscal 2025' },
  ] },
  { title: 'Path to Pro', items: [
    { key: 'ptp-corp', name: 'Path to Pro: The Home Depot’s commitment to the skilled trades' },
    { key: 'ptp-training', name: 'Path to Pro Skills Program' },
    { key: 'ptp-faq', name: 'Path to Pro questions and answers' },
    { key: 'ptp-foundation', name: 'The Home Depot Foundation’s Path to Pro programs' },
  ] },
  { title: 'Job scams', items: [
    { key: 'ftc-jobs', name: 'Job scams (Federal Trade Commission)' },
    { key: 'ftc-text', name: 'That job offer text is probably a scam (Federal Trade Commission)' },
  ] },
  { title: 'Community discussions', items: [
    { key: 'r-1o6orr3', name: 'A short store interview' },
    { key: 'r-1m9y77m', name: 'What to expect at the store interview' },
    { key: 'r-1nunmua', name: 'The questions at the store visit' },
    { key: 'r-1o3f77s', name: 'Waiting for a call after the visit' },
    { key: 'r-1o687ie', name: 'No call yet after the visit' },
  ] },
]

/** Every fact on the page, in reading order: the hero, then each menu row. */
export function pageEntries() {
  return [guide.answer, ...tiles, ...blockEntries(menu)]
}
