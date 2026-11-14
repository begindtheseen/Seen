// /start/warehouse — "Getting into warehouse and logistics work". The page renders from this module only, so every
// figure on it carries a source and an as-of date (lib/start/guides.test.mjs fails on a figure without one).
//
// THE ONLY SOURCE OF FACTS is the research file compiled 2026-11-14 (session scratchpad research/warehouse.md).
// Rules this module keeps:
//   • only items the research marked VERIFIED (BLS, OSHA and its letters of interpretation, a state labor department,
//     the FTC, an employer's own posting or announcement, the union's own contract summary);
//   • FIRST-HAND items (several accounts agreeing) only as `firstHand: true`, said as what people say, never as fact;
//   • nothing from the research's UNVERIFIED / CONFLICTING list: no UPS "$23 by the end of the contract", no UPS
//     100,000 seasonal hires, no Amazon night-differential amount or conversion policy, no Amazon "$32/hr total
//     compensation" as pay, no DHL / GXO / Home Depot / Lowe's / Costco / Kroger pay, no FedEx Fort Worth or Great Falls
//     ranges, no FedEx Ground pay or tuition, no 151,980 injury count, no Washington / Oregon / Connecticut / Rhode
//     Island quota-law details (no primary page opened), no Illinois quota law, no 2025 job-scam figure;
//   • there is NO forklift license: OSHA 29 CFR 1910.178(l) makes the EMPLOYER train, evaluate and certify each
//     operator, and the page says so in OSHA's own words;
//   • pay medians are said as "in the warehousing industry" (NAICS 493), not "warehouse jobs" everywhere; an average
//     (Walmart, Amazon, the industry's $26.02) is never shown as starting pay;
//   • no hype, no guarantees, no exclamation marks; the injury rate is stated plainly.
//
// Shape: `sources` (every reference behind the page, kept here and never printed as citations — readers reach the
// links through the grouped "Additional resources" menu, `resources` below), entries `{ text, src, firstHand? }`, the
// listings filter config (`listings`, lib/start/listingFilters.js) and the openable menu rows (`menu`, rendered by
// components/start/Guide.tsx). Pure data; relative imports only so `node --test` runs it as is.

import { blockEntries } from './entries.js'

/** @typedef {{ label: string, url: string, date: string, note?: string }} Source */

/** @type {Record<string, Source>} */
export const sources = {
  'bls-hand': { label: 'U.S. Bureau of Labor Statistics, Occupational Outlook Handbook: Hand Laborers and Material Movers (May 2025 pay)', url: 'https://www.bls.gov/ooh/transportation-and-material-moving/hand-laborers-and-material-movers.htm', date: '2026-08-27', note: 'page updated' },
  'bls-mmo': { label: 'BLS Occupational Outlook Handbook: Material Moving Machine Operators (May 2025 pay)', url: 'https://www.bls.gov/ooh/transportation-and-material-moving/material-moving-machine-operators.htm', date: '2026-10-29', note: 'page updated' },
  'bls-clerks': { label: 'BLS Occupational Outlook Handbook: Material Recording Clerks (May 2025 pay)', url: 'https://www.bls.gov/ooh/office-and-administrative-support/material-recording-clerks.htm', date: '2026-10-29', note: 'page updated' },
  'bls-iag493': { label: 'BLS Industries at a Glance: Warehousing and Storage, NAICS 493 (May 2025 wages, 2024 injury rates)', url: 'https://www.bls.gov/iag/tgs/iag493.htm', date: '2026-11-14', note: 'read' },
  'bls-osh': { label: 'BLS news release, Employer-Reported Workplace Injuries and Illnesses – 2024', url: 'https://www.bls.gov/news.release/osh.nr0.htm', date: '2026-01-22', note: 'released' },
  'bls-agency': { label: 'BLS Occupational Employment and Wage Statistics data series: hand laborers and freight movers in employment services, NAICS 5613 (May 2025)', url: 'https://api.bls.gov/publicAPI/v2/timeseries/data/OEUN000000056130053706201', date: '2026-11-14', note: 'queried' },
  'onet-clerk': { label: 'O*NET OnLine, Shipping, Receiving, and Inventory Clerks: 2025 wage data (BLS OEWS)', url: 'https://www.onetonline.org/link/localwages/43-5071.00', date: '2026-11-14', note: 'read' },
  'onet-sup': { label: 'O*NET OnLine, First-Line Supervisors of Transportation and Material Moving Workers: 2025 wage data (BLS OEWS 53-1047)', url: 'https://www.onetonline.org/link/localwages/53-1043.00', date: '2026-11-14', note: 'read' },
  'osha-1910-178': { label: 'OSHA, 29 CFR 1910.178, powered industrial trucks (operator training, paragraph l)', url: 'https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.178', date: '2026-11-14', note: 'read' },
  'osha-loi-2016': { label: 'OSHA letter of interpretation, July 14, 2016: operators trained and certified by their employer', url: 'https://www.osha.gov/laws-regs/standardinterpretations/2016-07-14-1', date: '2016-07-14', note: 'letter dated' },
  'osha-loi-1999': { label: 'OSHA letter of interpretation, February 16, 1999: prior training and a new employer', url: 'https://www.osha.gov/laws-regs/standardinterpretations/1999-02-16', date: '1999-02-16', note: 'letter dated' },
  'osha-loi-2025': { label: 'OSHA letter of interpretation, April 1, 2025: live-streamed forklift evaluations', url: 'https://www.osha.gov/laws-regs/standardinterpretations/2025-04-01', date: '2025-04-01', note: 'letter dated' },
  'osha-pit': { label: 'OSHA, powered industrial trucks: standards (including the under-18 rule)', url: 'https://www.osha.gov/powered-industrial-trucks/standards', date: '2026-11-14', note: 'read' },
  'osha-warehousing': { label: 'OSHA, Warehousing (hazards and the national emphasis program)', url: 'https://www.osha.gov/warehousing', date: '2026-11-14', note: 'read' },
  'osha-temp': { label: 'OSHA, Protecting Temporary Workers', url: 'https://www.osha.gov/temporaryworkers', date: '2026-11-14', note: 'read' },
  'ca-quota': { label: 'California Labor Commissioner, warehouse quotas FAQ (AB 701)', url: 'https://www.dir.ca.gov/dlse/FAQ_warehousequotas.htm', date: '2022-01', note: 'FAQ dated' },
  'ny-quota': { label: 'New York State Department of Labor, Warehouse Worker Protection Act FAQ for employers', url: 'https://dol.ny.gov/wwpa-frequently-asked-questions-employers', date: '2026-11-14', note: 'read' },
  'mn-quota': { label: 'Minnesota Department of Labor and Industry, FAQs for warehouse workers (Minn. Stat. 182.6526)', url: 'https://dli.mn.gov/business/workplace-safety-and-health/faqs-warehouse-workers-minn-stat-1826526', date: '2026-11-14', note: 'read' },
  'amazon-pay': { label: 'Amazon press release, minimum starting pay for full-time core operations employees rises to $20/hour', url: 'https://press.aboutamazon.com/2026/9/amazon-raises-minimum-starting-pay-for-full-time-core-operations-employees-to-20-hour-with-average-pay-reaching-nearly-24-hour-and-launches-grocery-discount-and-access-to-new-lifetime-banking-benefits-to-make-everyday-life-more-affordable', date: '2026-09-16', note: 'announced' },
  'amazon-holiday': { label: 'Amazon press release, over 300,000 new U.S. jobs this holiday season', url: 'https://press.aboutamazon.com/2026/10/amazon-creates-over-300-000-new-u-s-jobs-this-holiday-season-with-increased-pay-and-expanded-benefits', date: '2026-10-20', note: 'announced' },
  'amazon-career-choice': { label: 'Amazon, Career Choice (education for hourly employees)', url: 'https://www.aboutamazon.com/news/workplace/career-choice-free-education-for-amazon-employees', date: '2026-11-14', note: 'read' },
  'walmart-people': { label: 'Walmart, ESG report: Our People (fiscal year ending January 31, 2026)', url: 'https://corporate.walmart.com/purpose/esgreport/our-people', date: '2026-11-14', note: 'read' },
  'walmart-pay': { label: 'Walmart, How much do Walmart associates make?', url: 'https://corporate.walmart.com/askwalmart/how-much-do-walmart-associates-make', date: '2026-11-14', note: 'read' },
  'target-ocon': { label: 'Target posting T0557, seasonal and full-time hourly warehouse openings, Oconomowoc, WI distribution center (own careers site)', url: 'https://corporate.target.com/jobs/w39/74/seasonal-full-time-hourly-warehouse-operations-openings-only-t0557', date: '2026-11-14', note: 'read' },
  'target-stuarts': { label: 'Target posting T0560, full-time hourly warehouse operations, evening and overnight shifts, Stuarts Draft, VA (own careers site)', url: 'https://corporate.target.com/jobs/w39/71/full-time-hourly-warehouse-operations-hiring-evening-overnight-shifts-t0560', date: '2026-11-14', note: 'read' },
  'fedex-hag': { label: 'FedEx posting P25-95151-21, Package Handler, Hagerstown, MD (own careers site)', url: 'https://careers.fedex.com/package-handler-warehouse-like/job/P25-95151-21', date: '2026-11-14', note: 'read' },
  'fedex-nsl': { label: 'FedEx posting P25-95492-76, Package Handler, part time, North Salt Lake, UT (own careers site)', url: 'https://careers.fedex.com/package-handler-part-time-warehouse-like/job/P25-95492-76', date: '2026-11-14', note: 'read' },
  'sysco-ontario': { label: 'Sysco posting, Outbound Selector, Ontario, CA (taken down October 16, 2026)', url: 'https://www.builtinla.com/job/outbound-selector/10871863', date: '2026-10-16', note: 'taken down' },
  'teamsters-ups': { label: 'Teamsters, UPS tentative agreement highlights (national contract, August 1, 2023 – July 31, 2028)', url: 'https://teamster.org/wp-content/uploads/2023/08/8.5x11-UPS-TA-Highlights-1.pdf', date: '2023-08', note: 'published' },
  'teamsters-parttime': { label: 'Teamsters, UPS part-time daily guarantee flier (National Master Agreement Article 22)', url: 'https://teamster.org/wp-content/uploads/2024/03/UPS-March-Toolkit-Guarantee-Flier.pdf', date: '2024-03', note: 'published' },
  'ups-jobs': { label: 'Careers at United Parcel Service (UPS’s own job site)', url: 'https://www.jobs-ups.com', date: '2026-11-14', note: 'read' },
  'ftc-scams': { label: 'Federal Trade Commission, Job Scams (consumer advice)', url: 'https://consumer.ftc.gov/articles/job-scams', date: '2023-03', note: 'article dated' },
  'ftc-2025': { label: 'Federal Trade Commission press release, reported fraud losses in 2024', url: 'https://www.ftc.gov/news-events/news/press-releases/2025/03/new-ftc-data-show-big-jump-reported-losses-fraud-125-billion-2024', date: '2025-03', note: 'published' },
  // First-hand accounts (Reddit threads read through the Arctic Shift archive on 2026-11-14). Used only where
  // several accounts agree, and rendered as what people say, never as fact.
  'r-temps': { label: 'r/Warehouseworkers, managers on hiring through temp agencies', url: 'https://www.reddit.com/r/Warehouseworkers/comments/1qx1fz8/', date: '2026-11-14', note: 'thread read' },
  'r-convert': { label: 'r/Warehouseworkers, temp-to-hire timing and raises', url: 'https://www.reddit.com/r/Warehouseworkers/comments/1n2b9c7/', date: '2026-11-14', note: 'thread read' },
  'r-senthome': { label: 'r/Warehouseworkers, an agency temp sent home early', url: 'https://www.reddit.com/r/Warehouseworkers/comments/1wunp0m/', date: '2026-11-14', note: 'thread read' },
  'r-badge1': { label: 'r/AmazonFC, white badge to blue badge', url: 'https://www.reddit.com/r/AmazonFC/comments/1ultlg8/', date: '2026-11-14', note: 'thread read' },
  'r-badge2': { label: 'r/AmazonFC, converting from seasonal', url: 'https://www.reddit.com/r/AmazonFC/comments/1v5juac/', date: '2026-11-14', note: 'thread read' },
  'r-badge3': { label: 'r/AmazonFC, seasonal workers after peak', url: 'https://www.reddit.com/r/AmazonFC/comments/1uvy94n/', date: '2026-11-14', note: 'thread read' },
  'r-forklift-license': { label: 'r/Warehouseworkers, "forklift license" and forklift training', url: 'https://www.reddit.com/r/Warehouseworkers/comments/1sjw9th/', date: '2026-11-14', note: 'thread read' },
  'r-forklift-recert': { label: 'r/forklift, a hiring manager on re-certifying new operators', url: 'https://www.reddit.com/r/forklift/comments/1jwakin/', date: '2026-11-14', note: 'thread read' },
  'r-forklift-follow': { label: 'r/forklift, whether a certification follows you between jobs', url: 'https://www.reddit.com/r/forklift/comments/1k4w5ki/', date: '2026-11-14', note: 'thread read' },
  'r-forklift-online': { label: 'r/forklift, online forklift certification', url: 'https://www.reddit.com/r/forklift/comments/1kk2y9j/', date: '2026-11-14', note: 'thread read' },
  'r-rate1': { label: 'r/AmazonFC, automatic write-ups for rate', url: 'https://www.reddit.com/r/AmazonFC/comments/1vpld7r/', date: '2026-11-14', note: 'thread read' },
  'r-rate2': { label: 'r/AmazonFC, rate and time off task', url: 'https://www.reddit.com/r/AmazonFC/comments/1vgwqkc/', date: '2026-11-14', note: 'thread read' },
  'r-supervisor': { label: 'r/Warehouseworkers, a supervisor on new hires, rate and attendance', url: 'https://www.reddit.com/r/Warehouseworkers/comments/1rykxjl/', date: '2026-11-14', note: 'thread read' },
  'r-freezer': { label: 'r/Warehouseworkers, a freezer selector near the end of probation', url: 'https://www.reddit.com/r/Warehouseworkers/comments/1q49g1x/', date: '2026-11-14', note: 'thread read' },
  'r-writeup': { label: 'r/Warehouseworkers, written up just under the rate target', url: 'https://www.reddit.com/r/Warehouseworkers/comments/1mujr7w/', date: '2026-11-14', note: 'thread read' },
  'r-met': { label: 'r/AmazonFC, fired over mandatory extra time', url: 'https://www.reddit.com/r/AmazonFC/comments/1umu8i0/', date: '2026-11-14', note: 'thread read' },
  'r-upt1': { label: 'r/AmazonFC, unpaid time and attendance', url: 'https://www.reddit.com/r/AmazonFC/comments/1uoihjv/', date: '2026-11-14', note: 'thread read' },
  'r-upt2': { label: 'r/AmazonFC, running out of unpaid time', url: 'https://www.reddit.com/r/AmazonFC/comments/1v6ntr2/', date: '2026-11-14', note: 'thread read' },
  'r-sore1': { label: 'r/Warehouseworkers, the first weeks on the body', url: 'https://www.reddit.com/r/Warehouseworkers/comments/1x6by2t/', date: '2026-11-14', note: 'thread read' },
  'r-sore2': { label: 'r/Warehouseworkers, leaving over back pain', url: 'https://www.reddit.com/r/Warehouseworkers/comments/1wz1llj/', date: '2026-11-14', note: 'thread read' },
  'r-fedex-attend': { label: 'r/FedEx, missed days as a new package handler', url: 'https://www.reddit.com/r/FedEx/comments/1sywry3/', date: '2026-11-14', note: 'thread read' },
  'r-ups1': { label: 'r/UPS, part-time preload hours', url: 'https://www.reddit.com/r/UPS/comments/1vtrig5/', date: '2026-11-14', note: 'thread read' },
  'r-ups2': { label: 'r/UPS, hours a week as a part-timer', url: 'https://www.reddit.com/r/UPS/comments/1ua26fi/', date: '2026-11-14', note: 'thread read' },
  'r-ups3': { label: 'r/UPS, shift length on the sort', url: 'https://www.reddit.com/r/UPS/comments/1v4puir/', date: '2026-11-14', note: 'thread read' },
}

export const guide = {
  path: '/start/warehouse',
  title: 'Getting into warehouse and logistics work',
  crumbLabel: 'Warehouse work',
  eyebrow: 'Guide',
  // The one-sentence answer under the h1 (the page's first screen).
  answer: { text: 'Most warehouse jobs take people with no experience and train them on the job; the work is physical and often runs nights and weekends. Here is what each job pays, what it asks of you, and who is hiring now.', src: ['bls-hand'] },
  metaDescription: 'How to get a warehouse job with no experience: the entry jobs, what warehouses pay, which shifts pay more, how forklift certification really works, live warehouse listings near you, and scams to avoid.',
  asOf: '2026-11-14',
}

// The three readings in the hero: each restates a sourced fact below, with the same sources.
export const tiles = [
  { label: 'Median pay in warehouses', value: '$21.49–$23.16', text: 'an hour for order fillers, hand laborers and forklift operators in the warehousing industry, May 2025', src: ['bls-iag493'] },
  { label: 'Openings a year', value: 'About 904,200', text: 'projected for hand laborers and material movers through 2035; typically no diploma needed', src: ['bls-hand'] },
  { label: 'Injury rate', value: '4.8 vs 2.3', text: 'recorded cases per 100 full-time workers in 2024: warehousing against all private industry', src: ['bls-iag493', 'bls-osh'] },
]

// 1. The jobs: a name, one line, and the sourced figures as chips.
export const jobs = [
  {
    role: 'Warehouse associate', aka: 'Also material handler, warehouse worker',
    what: { text: 'The general job: unloading, moving, picking, packing and shipping freight. Usually no diploma or experience needed, with a month or less of training on the job.', src: ['bls-hand'] },
    chips: [{ text: '$22.06/hr median in warehouses', src: ['bls-iag493'] }],
  },
  {
    role: 'Picker / packer', aka: 'Also order selector, order filler, stower',
    what: { text: 'Pulls orders and builds pallets. A Sysco selector posting counted about 1,600 cases a shift, averaging 25 lb; a Target posting says up to 2,000 cartons a day.', src: ['sysco-ontario', 'target-ocon'] },
    chips: [{ text: '$21.49/hr median in warehouses', src: ['bls-iag493'] }],
  },
  {
    role: 'Loader / package handler', aka: 'Also unloader, dock worker',
    what: { text: 'Loads, unloads and sorts packages at parcel hubs. FedEx’s part-time handler shifts run about 3 to 6 hours a day.', src: ['fedex-hag', 'fedex-nsl'] },
    chips: [{ text: 'UPS part-time start: $21/hr', src: ['teamsters-ups'] }, { text: 'FedEx posting: $21.75–$23.75/hr', src: ['fedex-hag'] }],
  },
  {
    role: 'Forklift operator', aka: 'Also reach truck, order picker, pallet jack',
    what: { text: 'Moves pallets with powered equipment. BLS says it "may take only a few days to learn"; your employer trains and certifies you on its own trucks, and you must be 18.', src: ['bls-mmo', 'osha-1910-178', 'osha-pit'] },
    chips: [{ text: '$23.16/hr median in warehouses', src: ['bls-iag493'] }],
  },
  {
    role: 'Shipping, receiving and inventory clerk', aka: 'Also receiver, cycle counter',
    what: { text: 'Checks shipments in and out and keeps the counts right. These jobs are projected to shrink 8% from 2025 to 2035.', src: ['bls-clerks'] },
    chips: [{ text: '$22.42/hr median in warehouses', src: ['bls-iag493'] }],
  },
  {
    role: 'Lead or supervisor', aka: 'After time on the floor',
    what: { text: 'Runs a team or a shift. The pay figure covers every first-line supervisor of transportation and material-moving workers, not only warehouses.', src: ['onet-sup'] },
    chips: [{ text: '$30.23/hr median', src: ['onet-sup'] }],
  },
]

// The same occupations in warehouses and across every industry (May 2025 medians, hourly).
export const payTable = [
  { occupation: 'Hand laborers and freight movers', warehouses: '$22.06', all: '$19.35', src: ['bls-iag493', 'bls-hand'] },
  { occupation: 'Stock clerks and order fillers', warehouses: '$21.49', all: '$17.95', src: ['bls-iag493', 'bls-hand'] },
  { occupation: 'Forklift (industrial truck) operators', warehouses: '$23.16', all: '$22.32', src: ['bls-iag493', 'bls-mmo'] },
  { occupation: 'Shipping and receiving clerks', warehouses: '$22.42', all: '$21.76', src: ['bls-iag493', 'onet-clerk'] },
  { occupation: 'First-line supervisors, material moving', warehouses: null, all: '$30.23', src: ['onet-sup'] },
]
export const payTableNote = { text: '"In warehouses" is the warehousing and storage industry; "every industry" also counts stores, factories and other workplaces, where these jobs pay less. Medians are national, May 2025; local pay varies a lot.', src: ['bls-iag493', 'bls-hand'] }
export const outlook = [
  { text: 'Stocker and order filler jobs are projected to grow 9% from 2025 to 2035, hand laborer jobs 2% and forklift operator jobs 1%; shipping, receiving and inventory clerk jobs to fall 8%.', src: ['bls-hand', 'bls-mmo', 'bls-clerks'] },
  { text: 'BLS notes that "some warehouses have installed equipment, such as high-speed conveyors and sorting systems."', src: ['bls-hand'] },
]

// 2. Pay on employers' own postings and announcements (fall 2026).
export const postedPay = [
  { employer: 'Target, Oconomowoc, WI', role: 'Warehouse associate', pay: 'Starts at $22.75/hr', src: ['target-ocon'] },
  { employer: 'Target, Oconomowoc, WI', role: 'Warehouse worker (powered equipment)', pay: 'Starts at $24.50/hr', src: ['target-ocon'] },
  { employer: 'Target, Stuarts Draft, VA', role: 'Associate / worker (equipment)', pay: 'Starts at $21.00 / $23.60/hr', src: ['target-stuarts'] },
  { employer: 'FedEx, Hagerstown, MD', role: 'Package handler', pay: '$21.75–$23.75/hr', src: ['fedex-hag'] },
  { employer: 'FedEx, North Salt Lake, UT', role: 'Package handler, part time', pay: '$21.60–$26.60/hr to start', src: ['fedex-nsl'] },
  { employer: 'UPS (Teamsters contract)', role: 'Part-time', pay: 'Starts at $21/hr', src: ['teamsters-ups'] },
  { employer: 'Amazon, nationwide', role: 'Full-time operations', pay: 'Minimum start raised to $20/hr', src: ['amazon-pay'] },
  { employer: 'Sysco, Ontario, CA', role: 'Outbound order selector', pay: 'Starts at $29.40/hr', src: ['sysco-ontario'] },
]
export const postedPayIntro = { text: 'Starting pay stated by employers, or in UPS’s union contract, as of fall 2026. A posting is one building’s rate on that date, not what every location pays.', src: ['target-ocon', 'fedex-hag', 'amazon-pay'] }

// What pays more, from the same postings.
export const paysMore = [
  { name: 'Running equipment', text: 'At Target’s Oconomowoc and Stuarts Draft centers, the powered-equipment job starts $1.75 to $2.60 an hour above the manual one.', src: ['target-ocon', 'target-stuarts'] },
  { name: 'Nights', text: 'Target’s postings add a shift differential of $2.00 to $3.50 an hour, "based on eligibility." Sysco’s posting added $1.00 for nights.', src: ['target-ocon', 'target-stuarts', 'sysco-ontario'] },
  { name: 'The freezer', text: 'The same Sysco posting added $1.00 an hour for freezer work, and up to $1,000 a week in productivity incentives.', src: ['sysco-ontario'] },
  { name: 'Peak season', text: 'Target offered a $1,000 sign-on bonus for hires between October 18 and December 19, 2026, paid after 90 days.', src: ['target-ocon', 'target-stuarts'] },
]
export const averages = { text: 'Averages are not starting pay. Walmart says its supply chain associates averaged $27.50 an hour in the year ending January 31, 2026, and its distribution and fulfillment center range is $17.85 to $40.40. Amazon says average pay in its core operations is nearly $24. Across the warehousing industry, nonsupervisory workers averaged $26.02 an hour in September 2026, counting every level of experience.', src: ['walmart-people', 'walmart-pay', 'amazon-pay', 'bls-iag493'] }

// 3. Forklift: there is no license; the employer trains, evaluates and certifies (29 CFR 1910.178(l)).
export const forklift = {
  callout: { text: 'There is no government forklift license. OSHA puts it on the employer: "The employer shall certify that each operator has been trained and evaluated."', src: ['osha-1910-178', 'osha-loi-2016'] },
  rules: [
    { name: 'Your employer trains you', text: '"All powered industrial truck operators must be trained and certified by their employer," OSHA says, and OSHA itself "does not provide a certification" for heavy equipment operators.', src: ['osha-loi-2016'] },
    { name: 'Training has three parts', text: 'Formal instruction (a class, video or online), hands-on practice, and an evaluation of you driving at the workplace. An online course alone does not meet the rule.', src: ['osha-1910-178'] },
    { name: 'It is checked in person', text: 'An evaluation streamed live does not count: the person evaluating you must be on site.', src: ['osha-loi-2025'] },
    { name: 'A new job checks you again', text: 'A new employer must "evaluate the applicability and adequacy of prior training," and some site-specific training "is likely always to be necessary."', src: ['osha-loi-1999'] },
    { name: 'Every three years', text: 'Your driving is evaluated at least every three years, and you are retrained after an accident or near-miss, unsafe driving, or a move to a different type of truck.', src: ['osha-1910-178'] },
    { name: '18 or older', text: 'Federal child-labor rules effectively bar anyone under 18 from operating a forklift outside farm work.', src: ['osha-pit'] },
  ],
  peopleSay: { text: 'Job ads and interviewers still ask whether you are forklift certified. People who hire operators say it is shorthand for experience, since they re-certify every new operator anyway. The usual advice: do not pay for a card online; ask your employer to train you.', src: ['r-forklift-license', 'r-forklift-recert', 'r-forklift-follow', 'r-forklift-online'], firstHand: true },
}

// 4. The work itself.
export const work = [
  { name: 'Lifting all shift', text: 'Target’s postings: 35 to 50 lb often, up to 60 lb sometimes, and "up to 2,000 cartons daily," standing and walking on concrete. Sysco selector cases ran up to 70 lb.', src: ['target-ocon', 'sysco-ontario'] },
  { name: 'Nights and weekends', text: 'BLS says schedules "may include nights and weekends." Target’s weekend shifts are 12 hours, 6a to 6p or 6p to 6a.', src: ['bls-hand', 'target-ocon'] },
  { name: 'Short shifts at parcel hubs', text: 'The UPS contract sets a daily minimum of 3.5 hours for part-timers; FedEx part-time handler shifts run about 3 to 6 hours.', src: ['teamsters-parttime', 'fedex-nsl'] },
  { name: 'About twice the injuries', text: 'Warehousing recorded 4.8 injuries and illnesses per 100 full-time workers in 2024, against 2.3 across private industry. OSHA says the most common are musculoskeletal injuries, "mainly from overexertion in lifting and lowering," and being struck by forklifts.', src: ['bls-iag493', 'bls-osh', 'osha-warehousing'] },
]
export const inspections = { text: 'OSHA renewed its national inspection program for warehouses and distribution centers in July 2026, for five years. Its inspections look at forklifts, storage, walking surfaces, heat and ergonomics.', src: ['osha-warehousing'] }
export const ratePeopleSay = { text: 'Most warehouses track how fast you work (a rate, in units or cases an hour) and your time off task. People who work in them describe automatic write-ups for staying near the bottom, and new selectors describe pressure to reach the rate before probation ends.', src: ['r-rate1', 'r-rate2', 'r-freezer', 'r-writeup'], firstHand: true }
export const quotaLine = { text: 'Several states, including California, New York and Minnesota, have warehouse quota laws. At larger warehouses there, your quota must be given to you in writing, and it cannot keep you from breaks or the restroom.', src: ['ca-quota', 'ny-quota', 'mn-quota'] }
export const quotaStates = [
  { name: 'California', text: 'Warehouses with 100 workers at one site or 1,000 in the state. You can ask for your quota and your own work-speed data from the last 90 days.', src: ['ca-quota'] },
  { name: 'New York', text: 'Same size rule. A written description of your quota when you are hired, in your language, and your own data from the last 90 days within 14 days of asking.', src: ['ny-quota'] },
  { name: 'Minnesota', text: 'Warehouses with 250 workers at one site or 1,000 in the state. A quota cannot stop you from taking breaks, praying or using the restroom.', src: ['mn-quota'] },
]
export const bodyPeopleSay = { text: 'New workers describe soreness all over that eases after a few weeks. The common advice: good boots, padded socks, plenty of water, and not rushing a lift.', src: ['r-sore1', 'r-supervisor', 'r-sore2'], firstHand: true }
export const upsPeopleSay = { text: 'UPS part-timers describe preload shifts of 3.5 to 5 hours and 15 to 25 hours a week, more at peak.', src: ['r-ups1', 'r-ups2', 'r-ups3'], firstHand: true }

// 5. Getting hired.
export const agencies = [
  { text: 'Many people start through a staffing agency, not the warehouse itself. In May 2025, 440,730 hand laborers and freight movers worked for staffing and other employment-services firms, about as many as the 433,060 in warehousing.', src: ['bls-agency', 'bls-iag493'] },
  { text: 'OSHA holds the agency and the warehouse jointly responsible for a temp’s safety; the warehouse must train you for its site and treat you "like any other workers."', src: ['osha-temp'] },
]
export const howPeopleGetIn = [
  { step: 'Expect to start as a temp', text: 'Managers say many warehouses hire mostly through agencies and take on the reliable temps, often after about 500 hours or 4 to 6 months, sometimes with a raise of about $1 an hour. Some sites cut temps when volume drops.', src: ['r-temps', 'r-convert', 'r-senthome'], firstHand: true },
  { step: 'Show up for every shift', text: 'Missed days in the first weeks end many temp and probation jobs.', src: ['r-fedex-attend', 'r-temps'], firstHand: true },
  { step: 'Move to equipment, then lead', text: 'The usual path: associate or picker, then equipment through a bid or by volunteering to train, then lead and supervisor. Inventory and shipping clerk jobs are the other way up.', src: ['r-supervisor', 'r-forklift-license'], firstHand: true },
]
export const peak = { text: 'October to December is the biggest hiring window. Amazon announced over 300,000 seasonal, part-time and full-time hires on October 20, 2026, with new openings posted weekly through December at amazon.com/localjobs. Seasonal is not the same as permanent.', src: ['amazon-holiday'] }
export const badges = { text: 'At Amazon, a white badge means seasonal or temporary and a blue badge a regular employee. Workers report the switch taking anywhere from 30 days to over a year.', src: ['r-badge1', 'r-badge2', 'r-badge3'], firstHand: true }
export const school = { text: 'Amazon’s Career Choice prepays up to $5,250 a year of tuition for most hourly employees after 90 days.', src: ['amazon-pay', 'amazon-career-choice'] }

// 6. Watch out.
export const whatEndsIt = [
  { text: 'Missing shifts in the first weeks, before you are past probation.', src: ['r-fedex-attend', 'r-temps'], firstHand: true },
  { text: 'Staying at the bottom of the rate once your first weeks are over.', src: ['r-rate1', 'r-freezer', 'r-writeup'], firstHand: true },
  { text: 'At Amazon, running out of unpaid time, or missing mandatory extra time added at peak.', src: ['r-met', 'r-upt1', 'r-upt2'], firstHand: true },
]
export const scams = [
  { text: 'Never pay for a job. The FTC: "Don’t pay for the promise of a job," and placement firms that ask for an upfront fee are likely scams.', src: ['ftc-scams'] },
  { text: '"Reshipping goods is never a real job," the FTC says; it also warns about jobs that send you a check to deposit and pass part of the money on.', src: ['ftc-scams'] },
  { text: 'Apply on the employer’s own site: jobs-ups.com, careers.fedex.com, corporate.target.com, or amazon.com/localjobs.', src: ['ups-jobs', 'fedex-hag', 'target-ocon', 'amazon-holiday'] },
  { text: 'Skip paid online "forklift licenses." They cannot replace your employer’s hands-on training and evaluation.', src: ['osha-1910-178'] },
  { text: 'Reported losses to job and employment-agency scams rose from $90 million in 2020 to $501 million in 2024, the FTC says.', src: ['ftc-2025'] },
]

// FAQ — visible on the page and mirrored in FAQPage JSON-LD (only Q&As shown on the page).
export const faq = [
  {
    q: 'Can I get a warehouse job with no experience?',
    a: { text: 'Usually, yes. BLS says hand laborers and material movers typically need no diploma and no experience, and learn on the job in a month or less. Amazon says many of its operations jobs "require no prior experience."', src: ['bls-hand', 'amazon-pay'] },
  },
  {
    q: 'Do I need a forklift license?',
    a: { text: 'No. There is no government forklift license: OSHA requires your employer to train you, evaluate you at the workplace and certify you on its own trucks. A card from a past job can show experience, but a new employer still evaluates you.', src: ['osha-1910-178', 'osha-loi-2016', 'osha-loi-1999'] },
  },
  {
    q: 'How much do warehouse jobs pay?',
    a: { text: 'In the warehousing industry, the May 2025 median was $21.49 an hour for order fillers, $22.06 for hand laborers and $23.16 for forklift operators. On employers’ own postings and announcements this fall, starting pay ran from $20 an hour (Amazon’s full-time minimum) to $29.40 (a Sysco order selector in California).', src: ['bls-iag493', 'amazon-pay', 'sysco-ontario'] },
  },
  {
    q: 'Do night shifts pay more?',
    a: { text: 'Often. Target’s distribution center postings add $2.00 to $3.50 an hour for eligible shifts, and a Sysco selector posting added $1.00 for nights and $1.00 in the freezer.', src: ['target-ocon', 'target-stuarts', 'sysco-ontario'] },
  },
  {
    q: 'Is warehouse work dangerous?',
    a: { text: 'It has about twice the injury rate of private industry overall: 4.8 recorded cases per 100 full-time workers in warehousing in 2024, against 2.3. OSHA says the most common come from lifting and lowering, and from being struck by forklifts and other equipment.', src: ['bls-iag493', 'bls-osh', 'osha-warehousing'] },
  },
  {
    q: 'Should I go through a temp agency?',
    a: { text: 'Many people start that way: in May 2025 about as many hand laborers and freight movers worked for staffing firms (440,730) as for warehouses (433,060). The agency and the warehouse share responsibility for your safety training. Never pay an agency to place you; the FTC calls an upfront fee a likely scam.', src: ['bls-agency', 'bls-iag493', 'osha-temp', 'ftc-scams'] },
  },
]

// ── Listings: the filters on the "Hiring now" block (lib/start/listingFilters.js) ──────────────────────────────────
// A plain "Warehouse Associate", "Picker/Packer" or "Package Handler" IS the entry job (no diploma, a month or less of
// training), so the level reads 'entryUnlessMarked': a title is experienced only when it says lead / supervisor / II /
// experienced, or the listing's own level says senior. Every row must carry a warehouse word in its title (gateTitle),
// so a "material handler" or "loader" search cannot fill the list with heavy-equipment or farm rows; each position's
// `match` adds its own look-alike guards (a "Wheel Loader", a "Meat Packer", a fruit picker and movers are dropped by
// `exclude`; Forklift sits before Picker, so in "All warehouse jobs" an "Order Picker Forklift" row is dealt to Forklift).
// Office, sales, manager, engineering and warehouse-management-software jobs are dropped by `exclude`. Measured on seenjobs.io 2026-11-14 (Phoenix and Dallas answers): "warehouse associate"
// and "picker packer" return mostly plain associate rows, so Picker / packer keeps only titles that name the task; the
// search counts a row as a match only for the whole phrase ("inventory clerk" did not match "Inventory Associate";
// "loader unloader" did not match "Warehouse Unloader"), so each position searches its common title wordings.
const WH_TITLE = '\\b(warehouse|warehousing|fulfill?ment|distribution|logistics|material(?:s)? handl\\w*|package handl\\w*|handler warehouse|freight handl\\w*|pick(?:er|ers|ing)|pack(?:er|ers|ing)|selectors?|order fill\\w*|stow\\w*|sort(?:er|ers|ation)|loaders?|unloaders?|dock|dockworkers?|fork\\s?lifts?|reach truck|lift truck|pallet|shipping|receiving|receivers?|shippers?|inventory|cycle count\\w*|stock clerk|general labor\\w*)\\b'
export const listings = {
  defaultRadius: '25',
  radii: ['10', '25', '50', '100'],
  levelMode: 'entryUnlessMarked',
  levelLabels: { any: 'Any level', entry: 'Entry / no experience', experienced: 'Experienced / lead' },
  levelWords: { entry: 'entry-level', experienced: 'experienced' },
  gateTitle: WH_TITLE,
  exclude: '\\b(instructors?|trainers?|teacher|recruit\\w*|talent|sales|account executive|managers?|director|head of|vice president|engineer\\w*|developer|software|programmer|analyst|consultant|implementation|wms|warehouse management system|systems administrator|accountant|accounting|buyer|planner|coordinator|administrator|dispatcher|attorney|pharmacy|pharmacist|nurse|generator|cdl|technician|meat|moving|movers?|fruit|farm|harvest\\w*|agricultur\\w*|wheel loader|front[- ]end loader|skid steer|excavat\\w*|backhoe|heavy equipment|jobs in)\\b',
  positions: [
    {
      id: 'all', label: 'All warehouse jobs', noun: 'warehouse', mix: 'positions',
      queries: ['warehouse associate', 'picker packer', 'package handler', 'unloader', 'forklift operator', 'shipping clerk', 'inventory associate'],
      seeAll: 'warehouse associate',
    },
    {
      id: 'associate', label: 'Warehouse associate', noun: 'warehouse associate',
      queries: ['warehouse associate', 'material handler', 'warehouse worker'],
      match: 'warehouse (?:associate|worker|assistant|helper|operations associate|team member|laborer|clerk|specialist)|general warehouse|fulfill?ment (?:center )?associate|order fulfill?ment associate|material(?:s)? handler|general labor',
    },
    {
      id: 'forklift', label: 'Forklift operator', noun: 'forklift operator',
      queries: ['forklift operator', 'reach truck operator', 'forklift driver'],
      match: 'fork\\s?lift|reach truck|lift truck|order picker (?:operator|driver)|pallet jack|clamp (?:truck|operator)',
    },
    {
      id: 'picker', label: 'Picker / packer', noun: 'picker and packer',
      queries: ['picker packer', 'order selector', 'order picker', 'warehouse selector'],
      match: '\\bpick(?:er|ers|ing)\\b|\\bpack(?:er|ers|ing)\\b|order ?(?:selector|filler|puller)s?|\\bselectors?\\b|\\bstow(?:er|ers)?\\b|\\bsort(?:er|ers|ation)\\b',
    },
    {
      id: 'loader', label: 'Loader / package handler', noun: 'loader and package handler',
      queries: ['package handler', 'unloader', 'loader unloader', 'dock worker'],
      match: 'package handl|handler warehouse|freight handl|\\b(?:un)?load(?:ers?|ing)\\b|dock ?workers?|\\bdock (?:associate|hand|helper)|trailer load|preload',
    },
    {
      id: 'shipping', label: 'Shipping & receiving', noun: 'shipping and receiving',
      queries: ['shipping clerk', 'shipping and receiving clerk', 'receiving clerk'],
      match: '\\bshipping\\b|\\breceiving\\b|\\breceivers?\\b|\\bshippers?\\b|dock clerk',
    },
    {
      id: 'inventory', label: 'Inventory clerk', noun: 'inventory',
      queries: ['inventory associate', 'inventory clerk', 'inventory control specialist', 'cycle counter'],
      match: 'inventory|cycle count|\\bicqa\\b|stock clerk',
    },
    {
      id: 'lead', label: 'Lead / supervisor', noun: 'warehouse lead and supervisor',
      queries: ['warehouse lead', 'warehouse supervisor', 'shift supervisor warehouse'],
      match: '\\blead\\b|supervisor|process assistant|\\bforem[ae]n\\b',
    },
  ],
}

// ── The page's openable rows (components/start/Guide.tsx `Blocks` renders each block type) ──────────────────────────
export const menu = [
  {
    id: 'the-jobs', title: 'The jobs', summary: 'Six warehouse jobs, and what each pays',
    blocks: [
      { type: 'cards', items: jobs.map((j) => ({ name: j.role, aka: j.aka, body: j.what, chips: j.chips })) },
      { type: 'more', title: 'Pay in warehouses and everywhere else', blocks: [
        { type: 'table', caption: 'Median hourly pay, in warehouses and across every industry', columns: [{ key: 'occupation', label: 'Occupation' }, { key: 'warehouses', label: 'In warehouses', num: true }, { key: 'all', label: 'Every industry', num: true }], rows: payTable },
        { type: 'note', entry: payTableNote },
        { type: 'text', entries: outlook },
      ] },
    ],
  },
  {
    id: 'what-it-pays', title: 'What it pays to start', summary: 'Employers’ own numbers, and what pays more',
    blocks: [
      { type: 'text', entry: postedPayIntro },
      { type: 'table', caption: 'Starting pay stated on employers’ own postings and announcements', columns: [{ key: 'employer', label: 'Employer' }, { key: 'role', label: 'Job' }, { key: 'pay', label: 'Stated pay', num: true }], rows: postedPay },
      { type: 'heading', text: 'What pays more' },
      { type: 'checklist', items: paysMore, cols: true },
      { type: 'more', title: 'Averages, and why they are not starting pay', blocks: [{ type: 'text', entry: averages }] },
    ],
  },
  {
    id: 'forklift', title: 'Forklift certification', summary: 'No license: your employer certifies you',
    blocks: [
      { type: 'callout', entry: forklift.callout },
      { type: 'checklist', items: forklift.rules, cols: true },
      { type: 'text', entry: forklift.peopleSay, lead: 'From people who run forklifts:' },
    ],
  },
  {
    id: 'the-work', title: 'What the work is like', summary: 'Lifting, nights, rate, injuries',
    blocks: [
      { type: 'checklist', items: work, cols: true },
      { type: 'text', entry: inspections },
      { type: 'heading', text: 'Rate and quotas' },
      { type: 'text', entry: ratePeopleSay, lead: 'From people who work in warehouses:' },
      { type: 'callout', entry: quotaLine },
      { type: 'more', title: 'Quota laws, state by state', blocks: [{ type: 'checklist', items: quotaStates }] },
      { type: 'more', title: 'Two more things people say', blocks: [{ type: 'notes', items: [bodyPeopleSay, upsPeopleSay] }] },
    ],
  },
  {
    id: 'getting-hired', title: 'How people get hired', summary: 'Agencies, peak season, moving up',
    blocks: [
      { type: 'text', entries: agencies },
      { type: 'text', plain: 'What people who got in say. Several accounts agree on each of these.' },
      { type: 'steps', items: howPeopleGetIn },
      { type: 'text', entry: peak },
      { type: 'more', title: 'Amazon badges, and paid school', blocks: [
        { type: 'text', entry: badges, lead: 'From people who work there:' },
        { type: 'text', entry: school },
      ] },
      { type: 'resumeLink', before: 'Before you apply, you can', label: 'check your résumé against a posting' },
    ],
  },
  {
    id: 'watch-out', title: 'Watch out', icon: 'caution', summary: 'What ends a new job, and scams',
    blocks: [
      { type: 'notesGrid', groups: [
        { label: 'What ends a new job, people say', items: whatEndsIt, icon: 'x' },
        { label: 'Scams', items: scams, icon: 'x' },
      ] },
    ],
  },
  { id: 'questions', title: 'Common questions', summary: 'Experience, forklifts, pay, nights, safety', blocks: [{ type: 'faq', items: faq }] },
]

// ── Additional resources: every reference above, as plain grouped links (no numbers, closed by default) ────────────
export const resourcesSummary = 'Employers’ postings, forklift rules, pay data'
export const resources = [
  { title: 'Employers’ postings and pay', items: [
    { key: 'target-ocon', name: 'Target: warehouse jobs, Oconomowoc, WI' },
    { key: 'target-stuarts', name: 'Target: warehouse jobs, Stuarts Draft, VA' },
    { key: 'fedex-hag', name: 'FedEx: package handler, Hagerstown, MD' },
    { key: 'fedex-nsl', name: 'FedEx: package handler, North Salt Lake, UT' },
    { key: 'sysco-ontario', name: 'Sysco: outbound selector, Ontario, CA' },
    { key: 'ups-jobs', name: 'UPS careers' },
    { key: 'teamsters-ups', name: 'UPS contract highlights (Teamsters)' },
    { key: 'teamsters-parttime', name: 'UPS part-time daily minimum (Teamsters)' },
    { key: 'amazon-pay', name: 'Amazon starting pay announcement, September 2026' },
    { key: 'amazon-holiday', name: 'Amazon holiday hiring, October 2026' },
    { key: 'amazon-career-choice', name: 'Amazon Career Choice' },
    { key: 'walmart-people', name: 'Walmart: pay for its people' },
    { key: 'walmart-pay', name: 'Walmart: how much associates make' },
  ] },
  { title: 'Forklift rules', items: [
    { key: 'osha-1910-178', name: 'OSHA forklift rule (29 CFR 1910.178)' },
    { key: 'osha-loi-2016', name: 'OSHA: operators are certified by their employer' },
    { key: 'osha-loi-1999', name: 'OSHA: prior training and a new employer' },
    { key: 'osha-loi-2025', name: 'OSHA: live-streamed evaluations' },
    { key: 'osha-pit', name: 'OSHA: forklift standards and the under-18 rule' },
  ] },
  { title: 'Safety and your rights', items: [
    { key: 'osha-warehousing', name: 'Warehouse hazards (OSHA)' },
    { key: 'osha-temp', name: 'Temporary workers’ safety (OSHA)' },
    { key: 'bls-osh', name: 'Workplace injuries and illnesses, 2024 (Bureau of Labor Statistics)' },
    { key: 'ca-quota', name: 'California warehouse quota law' },
    { key: 'ny-quota', name: 'New York Warehouse Worker Protection Act' },
    { key: 'mn-quota', name: 'Minnesota warehouse worker law' },
  ] },
  { title: 'Pay and jobs data', items: [
    { key: 'bls-iag493', name: 'Warehousing and storage (Bureau of Labor Statistics)' },
    { key: 'bls-hand', name: 'Hand laborers and material movers' },
    { key: 'bls-mmo', name: 'Material moving machine operators' },
    { key: 'bls-clerks', name: 'Material recording clerks' },
    { key: 'onet-clerk', name: 'Shipping, receiving and inventory clerk pay (O*NET)' },
    { key: 'onet-sup', name: 'Material-moving supervisor pay (O*NET)' },
    { key: 'bls-agency', name: 'Hand laborers at staffing firms (data series)' },
  ] },
  { title: 'Job scams', items: [
    { key: 'ftc-scams', name: 'Job scams (Federal Trade Commission)' },
    { key: 'ftc-2025', name: 'Reported fraud losses in 2024 (Federal Trade Commission)' },
  ] },
  { title: 'Community discussions', items: [
    { key: 'r-temps', name: 'Managers on hiring through temp agencies' },
    { key: 'r-convert', name: 'How long temp-to-hire takes' },
    { key: 'r-senthome', name: 'An agency temp sent home early' },
    { key: 'r-badge1', name: 'Amazon white badge to blue badge' },
    { key: 'r-badge2', name: 'Converting from seasonal at Amazon' },
    { key: 'r-badge3', name: 'Seasonal workers after peak' },
    { key: 'r-forklift-license', name: 'Is there a forklift license' },
    { key: 'r-forklift-recert', name: 'Why employers re-certify new operators' },
    { key: 'r-forklift-follow', name: 'Does a forklift certification follow you' },
    { key: 'r-forklift-online', name: 'Online forklift certification' },
    { key: 'r-rate1', name: 'Write-ups for rate' },
    { key: 'r-rate2', name: 'Rate and time off task' },
    { key: 'r-supervisor', name: 'A supervisor on new hires and attendance' },
    { key: 'r-freezer', name: 'A freezer selector on probation' },
    { key: 'r-writeup', name: 'Written up just under target' },
    { key: 'r-met', name: 'Mandatory extra time at peak' },
    { key: 'r-upt1', name: 'Unpaid time and attendance' },
    { key: 'r-upt2', name: 'Running out of unpaid time' },
    { key: 'r-sore1', name: 'The first weeks on the body' },
    { key: 'r-sore2', name: 'Leaving over back pain' },
    { key: 'r-fedex-attend', name: 'Missed days as a new package handler' },
    { key: 'r-ups1', name: 'UPS preload hours' },
    { key: 'r-ups2', name: 'Hours a week as a UPS part-timer' },
    { key: 'r-ups3', name: 'Shift length on the UPS sort' },
  ] },
]

/** Every fact on the page, in reading order: the hero, then each menu row. */
export function pageEntries() {
  return [guide.answer, ...tiles, ...blockEntries(menu)]
}
