// /start/retail — "Getting into retail work". The page renders from this module only, so every figure on it carries a
// reference and an as-of date (lib/start/guides.test.mjs fails on a figure without one).
//
// THE ONLY SOURCE OF FACTS is the research file compiled 2026-11-17 (session scratchpad guides20/retail/research.md).
// Rules this module keeps:
//   • only items the research marked VERIFIED (BLS, O*NET, DOL / eCFR, FDA, the FTC, a state or city labor office, an
//     employer's own careers page, fact sheet or posting);
//   • FIRST-HAND items (several threads agreeing) only as `firstHand: true`, said as what people say, never as fact;
//   • nothing from the research's UNVERIFIED / CONFLICTING list: no Walmart team-lead or store-manager pay (its two pages
//     disagree), no Walmart average wage, no Costco / Home Depot / Kroger pay, no Target 2026 seasonal headcount, no
//     assessment name or reapply wait, no Seattle / Chicago pay ceilings, no San Francisco or LA County details;
//   • pay medians are BLS's 2025 figures INSIDE retail trade (Industries at a Glance), with the all-industry medians beside
//     them; a posting is one store's rate on the day it was read, never what every store pays;
//   • overnight stocking belongs here (store freight); warehouse and distribution jobs belong to /start/warehouse;
//   • no hype, no guarantees, no exclamation marks.
//
// Shape: `sources` (every reference behind the page, never printed as citations — readers reach the links through the
// grouped "Additional resources" menu, `resources` below), entries `{ text, src, firstHand? }`, the listings filter config
// (`listings`, lib/start/listingFilters.js) and the openable menu rows (`menu`, rendered by components/start/Guide.tsx).
// Pure data; relative imports only so `node --test` runs it as is.

import { blockEntries } from './entries.js'

/** @typedef {{ label: string, url: string, date: string, note?: string }} Source */

/** @type {Record<string, Source>} */
export const sources = {
  'bls-cashiers': { label: 'U.S. Bureau of Labor Statistics, Occupational Outlook Handbook: Cashiers (May 2025 pay)', url: 'https://www.bls.gov/ooh/sales/cashiers.htm', date: '2026-08-27', note: 'page updated' },
  'bls-retail': { label: 'BLS Occupational Outlook Handbook: Retail Sales Workers (May 2025 pay)', url: 'https://www.bls.gov/ooh/sales/retail-sales-workers.htm', date: '2026-10-29', note: 'page updated' },
  'bls-hand': { label: 'BLS Occupational Outlook Handbook: Hand Laborers and Material Movers (stockers and order fillers)', url: 'https://www.bls.gov/ooh/transportation-and-material-moving/hand-laborers-and-material-movers.htm', date: '2026-08-27', note: 'page updated' },
  'bls-iag-retail': { label: 'BLS Industries at a Glance: Retail Trade, NAICS 44-45 (2025 wages by occupation, hours, 2024 injury rate)', url: 'https://www.bls.gov/iag/tgs/iag44-45.htm', date: '2026-11-17', note: 'read' },
  'bls-osh': { label: 'BLS news release, Employer-Reported Workplace Injuries and Illnesses – 2023-2024 (private industry rate for 2024)', url: 'https://www.bls.gov/news.release/osh.nr0.htm', date: '2026-01-22', note: 'released' },
  'onet-stockers': { label: 'O*NET OnLine, Stockers and Order Fillers 53-7065.00 (BLS wages, 2025)', url: 'https://www.onetonline.org/link/summary/53-7065.00', date: '2026-11-17', note: 'read' },
  'onet-supervisors': { label: 'O*NET OnLine, First-Line Supervisors of Retail Sales Workers 41-1011.00 (BLS wages, 2025)', url: 'https://www.onetonline.org/link/summary/41-1011.00', date: '2026-11-17', note: 'read' },
  'target-seasonal': { label: 'Target fact sheet, Seasonal Staffing: How Target’s Team Gears Up for the Holidays (updated Oct 7, 2026)', url: 'https://corporate.target.com/press/fact-sheet/2023/09/seasonal-staffing', date: '2026-10-07', note: 'updated' },
  'target-overnight': { label: 'Target posting R0000474552, Overnight Inbound (Stocking), store T3354, Orlando, FL (own careers site)', url: 'https://corporate.target.com/jobs/w45/52/overnight-inbound-stocking-t3354', date: '2026-11-17', note: 'read' },
  'target-4am': { label: 'Target posting R0000461019, Seasonal: 4am Inbound (Stocking), store T1918, Kissimmee, FL (own careers site)', url: 'https://corporate.target.com/jobs/w10/19/seasonal-4am-inbound-stocking-t1918', date: '2026-11-17', note: 'read' },
  'target-closing': { label: 'Target posting R0000466893, General Merchandise, Closing, Fulfillment, store T1790, Orlando, FL (own careers site)', url: 'https://corporate.target.com/jobs/w68/93/general-merchandise,-closing,-fulfillment-t1790', date: '2026-11-17', note: 'read' },
  'walmart-hire': { label: 'Walmart careers, How we hire', url: 'https://careers.walmart.com/us/en/home/resources/hiring-process', date: '2026-11-17', note: 'read' },
  'walmart-texts': { label: 'Walmart careers, recruiting text message terms', url: 'https://careers.walmart.com/us/en/home/resources/alert-terms', date: '2026-11-17', note: 'read' },
  'walmart-pay': { label: 'Walmart, How much do Walmart associates make?', url: 'https://corporate.walmart.com/askwalmart/how-much-do-walmart-associates-make', date: '2026-11-17', note: 'read' },
  'walmart-jobs': { label: 'Walmart, 2026 Jobs Spotlight Report (July 16, 2026)', url: 'https://corporate.walmart.com/news/2026/07/16/2026-jobs-spotlight-report', date: '2026-07-16', note: 'published' },
  'kh-lwp': { label: 'Little Words Project posting 5158937008, Key Holder, Nashville, TN (own job board)', url: 'https://job-boards.greenhouse.io/littlewordsproject/jobs/5158937008', date: '2026-11-17', note: 'read' },
  'kh-thirdlove': { label: 'Thirdlove posting 8873076002, Part-Time Key Holder, Corte Madera, CA (own job board)', url: 'https://job-boards.greenhouse.io/thirdlove/jobs/8873076002', date: '2026-11-17', note: 'read' },
  'kh-shinola': { label: 'Shinola posting 8839023002, Retail Key Holder, Ann Arbor, MI (own job board)', url: 'https://job-boards.greenhouse.io/shinolaretail/jobs/8839023002', date: '2026-11-17', note: 'read' },
  'kh-mizzen': { label: 'Mizzen+Main posting 4719218006, Key Holder, Dallas / Fort Worth, TX (own job board)', url: 'https://job-boards.greenhouse.io/mizzenandmain/jobs/4719218006', date: '2026-11-17', note: 'read' },
  'dol-fs43': { label: 'U.S. Department of Labor, Wage and Hour Division Fact Sheet #43: child labor rules outside farm work', url: 'https://www.dol.gov/agencies/whd/fact-sheets/43-child-labor-non-agriculture', date: '2016-12', note: 'revised' },
  'ecfr-570-34': { label: 'eCFR, 29 CFR 570.34: jobs 14- and 15-year-olds may do', url: 'https://www.ecfr.gov/current/title-29/section-570.34', date: '2026-11-17', note: 'read' },
  'ecfr-570-63': { label: 'eCFR, 29 CFR 570.63: balers and compactors (Hazardous Occupations Order 12)', url: 'https://www.ecfr.gov/current/title-29/section-570.63', date: '2026-11-17', note: 'read' },
  'fda-t21': { label: 'U.S. Food and Drug Administration, Tobacco 21 (age of sale and photo ID)', url: 'https://www.fda.gov/tobacco-products/retail-sales-tobacco-products/tobacco-21', date: '2025-08-07', note: 'page updated' },
  'or-sched': { label: 'Oregon Bureau of Labor and Industries, predictive scheduling', url: 'https://www.oregon.gov/boli/workers/pages/predictive-scheduling.aspx', date: '2026-11-17', note: 'read' },
  'sea-sched': { label: 'Seattle Office of Labor Standards, Secure Scheduling Ordinance', url: 'https://www.seattle.gov/laborstandards/ordinances/secure-scheduling', date: '2026-11-17', note: 'read' },
  'chi-sched': { label: 'City of Chicago, Business Affairs and Consumer Protection: Fair Workweek', url: 'https://www.chicago.gov/city/en/depts/bacp/supp_info/fairworkweek.html', date: '2026-11-17', note: 'read' },
  'nyc-sched': { label: 'NYC Department of Consumer and Worker Protection, Fair Workweek: retail workers', url: 'https://www.nyc.gov/site/dca/workers/workersrights/retail-workers.page', date: '2026-11-17', note: 'read' },
  'phl-sched': { label: 'City of Philadelphia, report a Fair Workweek violation (who is covered)', url: 'https://www.phila.gov/services/working-jobs/report-a-fair-workweek-violation/', date: '2026-11-17', note: 'read' },
  'la-sched': { label: 'City of Los Angeles Office of Wage Standards, Fair Work Week information', url: 'https://wagesla.lacity.gov/fair-work-week-information', date: '2026-11-17', note: 'read' },
  'ftc-text': { label: 'Federal Trade Commission consumer alert, That job offer text is probably a scam (April 30, 2026)', url: 'https://www.consumer.ftc.gov/consumer-alerts/2026/04/job-offer-text-probably-scam', date: '2026-04-30', note: 'published' },
  'ftc-scams': { label: 'Federal Trade Commission, Job Scams (consumer advice)', url: 'https://consumer.ftc.gov/articles/job-scams', date: '2023-03', note: 'article dated' },
  // First-hand accounts (Reddit threads read through the Arctic Shift archive on 2026-11-17). Used only where several
  // accounts agree, and rendered as what people say, never as fact.
  'r-hard': { label: 'r/Target, why getting hired is hard', url: 'https://www.reddit.com/r/Target/comments/1wyg3i3/', date: '2026-11-17', note: 'thread read' },
  'r-rejected': { label: 'r/Target, rejected after interviews with open availability', url: 'https://www.reddit.com/r/Target/comments/1xew7o9/', date: '2026-11-17', note: 'thread read' },
  'r-weekend': { label: 'r/walmart, hours cut without weekend availability', url: 'https://www.reddit.com/r/walmart/comments/1vgg03t/', date: '2026-11-17', note: 'thread read' },
  'r-video': { label: 'r/Target, waiting after the video interview', url: 'https://www.reddit.com/r/Target/comments/1whdbkt/', date: '2026-11-17', note: 'thread read' },
  'r-phone': { label: 'r/Target, scheduling the phone interview', url: 'https://www.reddit.com/r/Target/comments/1wynz0x/', date: '2026-11-17', note: 'thread read' },
  'r-seasonal': { label: 'r/Target, staying on after a seasonal job', url: 'https://www.reddit.com/r/Target/comments/1wxz7s2/', date: '2026-11-17', note: 'thread read' },
  'r-temp': { label: 'r/walmart, a temporary associate hoping to stay', url: 'https://www.reddit.com/r/walmart/comments/1uz934n/', date: '2026-11-17', note: 'thread read' },
  'r-on-speed': { label: 'r/walmart, getting faster on overnight stocking', url: 'https://www.reddit.com/r/walmart/comments/1wxogcy/', date: '2026-11-17', note: 'thread read' },
  'r-on-times': { label: 'r/walmart, freight times on the overnight crew', url: 'https://www.reddit.com/r/walmart/comments/1wgi622/', date: '2026-11-17', note: 'thread read' },
  'r-tl-what': { label: 'r/walmart, what team leads do', url: 'https://www.reddit.com/r/walmart/comments/1vy3s8z/', date: '2026-11-17', note: 'thread read' },
  'r-tl-down': { label: 'r/walmart, stepping down from team lead', url: 'https://www.reddit.com/r/walmart/comments/1wgp4fc/', date: '2026-11-17', note: 'thread read' },
  'r-tl-open': { label: 'r/walmart, team leads and open availability', url: 'https://www.reddit.com/r/walmart/comments/1wh5l6o/', date: '2026-11-17', note: 'thread read' },
  'r-tl-mentee': { label: 'r/walmart, filling in for a team lead', url: 'https://www.reddit.com/r/walmart/comments/1whb4dp/', date: '2026-11-17', note: 'thread read' },
}

export const guide = {
  path: '/start/retail',
  title: 'Getting into retail work',
  crumbLabel: 'Retail work',
  eyebrow: 'Guide',
  // The one-sentence answer under the h1 (the page's first screen).
  answer: { text: 'Most store jobs need no diploma or experience and train you on the job; schedules often include evenings, weekends and holidays. Here is what each job pays, how stores hire, and who is hiring now.', src: ['bls-cashiers', 'bls-retail'] },
  metaDescription: 'How to get a retail job with no experience: cashier, sales associate, overnight stocker, customer service and key holder jobs, what stores pay, how hiring works, scheduling laws, age rules, live store listings near you, and job-text scams to avoid.',
  asOf: '2026-11-17',
}

// The three readings in the hero: each restates a referenced fact below, with the same references.
export const tiles = [
  { label: 'Median pay in stores', value: '$15.90–$17.34', text: 'an hour for cashiers, retail salespersons and stockers working in retail, 2025', src: ['bls-iag-retail'] },
  { label: 'Openings a year', value: 'About 1.07 million', text: 'projected each year, 2025–35: about 521,300 for cashiers and 550,600 for retail sales workers, mostly to replace people who leave', src: ['bls-cashiers', 'bls-retail'] },
  { label: 'Average week', value: '30.7 hours', text: 'for nonsupervisory retail workers in October 2026 (preliminary); part-time work is common', src: ['bls-iag-retail', 'bls-cashiers'] },
]

// 1. The jobs: a name, one line, and the referenced figures as chips.
export const jobs = [
  {
    role: 'Cashier', aka: 'Also checker, guest advocate, front end',
    what: { text: 'Scans purchases, takes payment, handles returns and checks ID for alcohol and tobacco. Training is on the job and may last up to a few weeks.', src: ['bls-cashiers'] },
    chips: [{ text: '$15.90/hr median in retail', src: ['bls-iag-retail'] }],
  },
  {
    role: 'Sales associate', aka: 'Also retail salesperson, store associate',
    what: { text: 'Greets shoppers, recommends and explains products, and rings up sales. Training usually lasts a few days to a few months.', src: ['bls-retail'] },
    chips: [{ text: '$17.01/hr median in retail', src: ['bls-iag-retail'] }],
  },
  {
    role: 'Stocker / overnight', aka: 'Also inbound, freight team, replenishment',
    what: { text: 'Unpacks freight and fills shelves, often overnight or before the store opens. Target’s overnight stocking posting in Orlando asks you to be 18 or older and to lift up to 44 lb again and again through the shift.', src: ['bls-hand', 'target-overnight'] },
    chips: [{ text: '$17.34/hr median in retail', src: ['bls-iag-retail'] }, { text: 'Target overnight posting: $16.50/hr', src: ['target-overnight'] }],
  },
  {
    role: 'Customer service desk', aka: 'Also service desk, returns, front of store',
    what: { text: 'Handles returns and exchanges, answers questions about store policies, and signs people up for store rewards or credit cards. BLS lists all of these among cashier duties.', src: ['bls-cashiers'] },
    chips: [{ text: '$15.90/hr cashier median in retail', src: ['bls-iag-retail'] }],
  },
  {
    role: 'Key holder', aka: 'After some time in a store',
    what: { text: 'Opens and closes the store and runs the floor when managers are out. Key holder postings read in fall 2026 asked for one to two or more years of retail experience.', src: ['kh-lwp', 'kh-thirdlove', 'kh-mizzen'] },
    chips: [{ text: 'Posted: $16.50–$20/hr', src: ['kh-shinola', 'kh-lwp', 'kh-thirdlove'] }],
  },
  {
    role: 'Supervisor / assistant manager', aka: 'Also team lead, shift supervisor',
    what: { text: 'Runs a team or the store on a shift. BLS says retail workers may move up to supervisory or managerial jobs, and some employers prefer a bachelor’s degree for management.', src: ['bls-retail'] },
    chips: [{ text: '$23.18/hr median in retail', src: ['bls-iag-retail'] }],
  },
]

// The same occupations inside retail and across every industry (2025 medians, hourly).
export const payTable = [
  { occupation: 'Cashiers', retail: '$15.90', all: '$15.81', src: ['bls-iag-retail', 'bls-cashiers'] },
  { occupation: 'Retail salespersons', retail: '$17.01', all: '$17.03', src: ['bls-iag-retail', 'bls-retail'] },
  { occupation: 'Stockers and order fillers', retail: '$17.34', all: '$17.95', src: ['bls-iag-retail', 'onet-stockers'] },
  { occupation: 'First-line supervisors, retail sales', retail: '$23.18', all: '$23.33', src: ['bls-iag-retail', 'onet-supervisors'] },
]
export const payTableNote = { text: '"In stores" is the retail trade industry; "every industry" also counts warehouses, gas stations, restaurants and other workplaces. Medians are national, 2025; local pay varies a lot.', src: ['bls-iag-retail', 'bls-cashiers'] }
export const outlook = [
  { text: 'From 2025 to 2035, cashier jobs are projected to fall 6% and retail sales jobs to stay about the same, while stocker and order filler jobs grow 9%. Retail supervisor jobs are projected to decline slightly.', src: ['bls-cashiers', 'bls-retail', 'bls-hand', 'onet-supervisors'] },
]

// 2. Pay on employers' own pages and postings (fall 2026).
export const postedPay = [
  { employer: 'Target, all stores', role: 'Store and seasonal team members', pay: '$15–$24/hr starting range, by role and place', src: ['target-seasonal'] },
  { employer: 'Target, Orlando, FL', role: 'Overnight stocking', pay: 'Starts at $16.50/hr', src: ['target-overnight'] },
  { employer: 'Target, Orlando, FL', role: 'General merchandise, closing', pay: 'Starts at $16.50/hr', src: ['target-closing'] },
  { employer: 'Target, Kissimmee, FL', role: 'Seasonal early-morning stocking', pay: 'Starts at $16.25/hr', src: ['target-4am'] },
  { employer: 'Walmart, U.S. stores', role: 'Team associate', pay: 'Range listed as $14–$37/hr', src: ['walmart-pay'] },
  { employer: 'Shinola, Ann Arbor, MI', role: 'Key holder', pay: 'Starts at $16.50/hr', src: ['kh-shinola'] },
  { employer: 'Little Words Project, Nashville, TN', role: 'Key holder', pay: 'Starts at $18.50/hr', src: ['kh-lwp'] },
  { employer: 'Thirdlove, Corte Madera, CA', role: 'Key holder, part time', pay: '$20/hr', src: ['kh-thirdlove'] },
]
export const postedPayIntro = { text: 'Starting pay stated on employers’ own fact sheets and postings read in November 2026. A posting is one store’s rate on that date, not what every location pays.', src: ['target-seasonal', 'target-overnight', 'walmart-pay', 'kh-lwp'] }

// What pays more, from the same postings.
export const paysMore = [
  { name: 'Overnight and early hours', text: 'Target’s store postings list a $1 an hour shift differential for eligible overnight or early-morning hours, with a second $1 added for the 2026–27 holiday season (September 20 to January 2).', src: ['target-overnight', 'target-4am'] },
  { name: 'Moving up a rung', text: 'In retail, first-line supervisors’ median pay was $23.18 an hour in 2025, against $15.90 for cashiers and $17.01 for retail salespersons.', src: ['bls-iag-retail'] },
  { name: 'The discount', text: 'Target says its team members, seasonal ones included, get a 10% discount from day one.', src: ['target-seasonal'] },
]

// 3. Getting hired.
export const walmartSteps = [
  { name: 'No résumé needed', text: 'Walmart says a résumé is not required, though you list your job history on the application.', src: ['walmart-hire'] },
  { name: 'About 20 to 25 minutes', text: 'Its first application takes that long on average; some jobs add an assessment you must finish to be considered.', src: ['walmart-hire'] },
  { name: 'An answer in about a week', text: 'Walmart says it tries to respond within a week and tells you if you are not picked for an interview.', src: ['walmart-hire'] },
  { name: 'Sixty days on file', text: 'An application for an hourly job stays in its system for 60 days, and you can add other jobs to it in that time.', src: ['walmart-hire'] },
]
export const howPeopleGetIn = [
  { step: 'Give the widest availability you can', text: 'People who work in big stores say wide availability, weekends especially, helps you get hired and keep your hours, though it does not guarantee a job.', src: ['r-hard', 'r-weekend', 'r-rejected'], firstHand: true },
  { step: 'Expect a video interview at Target', text: 'Applicants describe a recorded video interview soon after applying, then a phone or in-person interview, with an answer in about a week. Several say trying other stores helped.', src: ['r-video', 'r-rejected', 'r-hard', 'r-phone'], firstHand: true },
  { step: 'Show up for every shift', text: 'For seasonal and temporary hires, the advice is the same: do not call out, ask questions, and stores tend to keep you.', src: ['r-seasonal', 'r-temp'], firstHand: true },
]
export const seasonal = { text: 'Stores add people for the holidays. Target says it first offers extra hours to its own team and to about 43,000 on-demand team members, then hires seasonal staff, mostly to stock shelves, work style departments, run checkout and fill online orders. It says more than half of its seasonal store team members stayed on after the 2025 holidays.', src: ['target-seasonal'] }

// 4. The work and your schedule.
export const work = [
  { name: 'On your feet', text: 'Target tells applicants its store jobs "can be physically demanding": standing for long periods, and lifting and moving heavy items.', src: ['target-4am'] },
  { name: 'Lifting and ladders', text: 'Its stocking postings ask you to lift up to 40 or 44 lb often, climb ladders, and work in cold coolers or outside for pickup orders.', src: ['target-4am', 'target-overnight'] },
  { name: 'Evenings, weekends, holidays', text: 'BLS says cashier schedules can include early mornings, late evenings, weekends and holidays, and overnight shifts in stores open 24 hours.', src: ['bls-cashiers'] },
  { name: 'Part-time hours', text: 'Nonsupervisory retail workers averaged 30.7 hours a week in October 2026 (preliminary). Extra shifts often come at the holidays.', src: ['bls-iag-retail', 'bls-retail'] },
  { name: 'Injuries', text: 'Retail recorded 3.0 injury and illness cases per 100 full-time workers in 2024, against 2.3 across private industry.', src: ['bls-iag-retail', 'bls-osh'] },
]
export const overnightPeopleSay = { text: 'Overnight stockers describe being timed by the cases or boxes they work an hour, with nightly freight goals set by their leads; the numbers people mention vary by store and department.', src: ['r-on-speed', 'r-on-times'], firstHand: true }
export const schedLine = { text: 'Oregon and several big cities have scheduling laws that cover large retailers: your schedule in advance, the right to turn down added shifts, and extra pay for late changes or short rest between shifts.', src: ['or-sched', 'sea-sched', 'chi-sched', 'nyc-sched', 'phl-sched', 'la-sched'] }
export const schedPlaces = [
  { name: 'Oregon', text: 'Retail, hospitality and food service employers with 500 or more workers worldwide: a written schedule 14 calendar days ahead, a good-faith estimate of your hours when hired, and time-and-a-half for work within 10 hours of your last shift.', src: ['or-sched'] },
  { name: 'Seattle', text: 'Retail and food service employers with 500 or more workers worldwide: schedules 14 days ahead, the right to decline hours not on them, and time-and-a-half when a closing and an opening shift are less than 10 hours apart.', src: ['sea-sched'] },
  { name: 'Chicago', text: 'Retail and six other industries, employers with at least 100 workers worldwide: one hour of predictability pay for a schedule change within 14 days, and the right to decline work less than 10 hours after the previous day’s shift.', src: ['chi-sched'] },
  { name: 'New York City', text: 'Retail employers: schedules 72 hours before the first shift, no on-call shifts, and no cancelling a shift with less than 72 hours’ notice.', src: ['nyc-sched'] },
  { name: 'Philadelphia', text: 'Retail, service and hospitality employers with 250 or more workers and 30 or more locations worldwide: schedules 14 days ahead, good-faith estimates, and nine hours of rest between shifts unless you agree and are paid $40.', src: ['phl-sched'] },
  { name: 'Los Angeles', text: 'Retailers with 300 or more workers worldwide: schedules 14 calendar days ahead, the right to decline late changes, and time and a half when a shift starts less than 10 hours after the last one.', src: ['la-sched'] },
]

// 5. Under 18.
export const youth = [
  { name: 'At 14 and 15', text: 'Federal rules allow cashiering, selling, price marking, shelving, and bagging and carrying out orders, outside school hours.', src: ['ecfr-570-34', 'dol-fs43'] },
  { name: 'Hour limits at 14 and 15', text: 'No more than 3 hours on a school day and 18 in a school week, 8 hours on a day off and 40 in a week off, between 7 a.m. and 7 p.m. (9 p.m. from June 1 to Labor Day).', src: ['dol-fs43'] },
  { name: 'At 16 and 17', text: 'Any number of hours, in any job the Labor Department has not declared hazardous.', src: ['dol-fs43'] },
  { name: 'Balers and compactors', text: 'No one under 18 may run or unload the cardboard baler or compactor; at 16 and 17 you may only load certain paper balers that meet safety standards.', src: ['ecfr-570-63'] },
  { name: 'Some jobs start at 18', text: 'Target’s overnight stocking and closing postings say you must be at least 18.', src: ['target-overnight', 'target-closing'] },
  { name: 'Your state may be stricter', text: 'Where state and federal law both apply, "the law with the stricter standard must be obeyed."', src: ['dol-fs43'] },
]
export const tobacco = { text: 'At the register you check ID for age-restricted sales. The federal age for tobacco is 21, and retailers must check the photo ID of anyone under 30.', src: ['bls-cashiers', 'fda-t21'] }

// 6. Moving up.
export const movingUp = [
  { text: 'Walmart says about 75% of its salaried U.S. store, club and supply chain leaders started as hourly associates. Its no-cost Live Better U program pays for education, and over 600 associates have moved into skilled trades through its Associate to Technician program, which needs no prior technical experience.', src: ['walmart-jobs'] },
  { text: 'Key holder postings ask for retail or customer service experience, often one to two years, and the job means opening and closing the store, counting the registers and leading the floor when managers are out.', src: ['kh-lwp', 'kh-thirdlove', 'kh-mizzen'] },
]
export const leadPeopleSay = { text: 'Team leads describe being responsible for a whole area, with more pay and more stress, and some step back down; stores often train a fill-in or mentee first. Leads also say they are expected to have open availability.', src: ['r-tl-what', 'r-tl-down', 'r-tl-open', 'r-tl-mentee'], firstHand: true }

// 7. Watch out.
export const scams = [
  { text: 'An unexpected job text is probably a scam. The FTC says fake recruiters "claim to be with legit companies you might know," mention pay without details of the job, and may just ask you to reply "YES."', src: ['ftc-text'] },
  { text: 'Target says it "will never ask you to submit personal information via a text message" and takes applications only through corporate.target.com/careers or its Workday system.', src: ['target-4am'] },
  { text: 'Walmart sends recruiting texts only if you opted in on your own application; hourly store texts come from 240240, and Walmart charges nothing for them.', src: ['walmart-texts'] },
  { text: '"Never pay to get paid or get a job," the FTC says, and no honest employer sends a check to deposit and asks you to pass part of it on.', src: ['ftc-text', 'ftc-scams'] },
  { text: 'Being paid to rate or review products, then asked to deposit your own money, is a task scam. Report scams at ReportFraud.ftc.gov.', src: ['ftc-text'] },
]
export const whatEndsIt = [
  { text: 'Calling out in your first weeks, or as a seasonal hire.', src: ['r-seasonal', 'r-temp'], firstHand: true },
  { text: 'Availability that no longer covers the hours the store needs, weekends especially.', src: ['r-weekend', 'r-hard'], firstHand: true },
]

// FAQ — visible on the page and mirrored in FAQPage JSON-LD (only Q&As shown on the page).
export const faq = [
  {
    q: 'Can I get a retail job with no experience?',
    a: { text: 'Usually, yes. BLS says cashiers and retail sales workers need no formal education and learn on the job in days to weeks. Walmart says you do not need a résumé to apply.', src: ['bls-cashiers', 'bls-retail', 'walmart-hire'] },
  },
  {
    q: 'How old do you have to be to work in a store?',
    a: { text: 'Federal rules let 14- and 15-year-olds work as cashiers, shelvers and baggers with limits on hours, and 16- and 17-year-olds work any hours in jobs that are not hazardous. Some jobs, such as Target’s overnight stocking, start at 18, and a stricter state law always applies.', src: ['ecfr-570-34', 'dol-fs43', 'target-overnight'] },
  },
  {
    q: 'How much do retail jobs pay?',
    a: { text: 'In retail, the 2025 median was $15.90 an hour for cashiers, $17.01 for retail salespersons and $17.34 for stockers. Target says its store and seasonal team members start at $15 to $24 an hour, depending on role and place.', src: ['bls-iag-retail', 'target-seasonal'] },
  },
  {
    q: 'Do I need open availability?',
    a: { text: 'Store postings ask for a flexible schedule that includes nights, weekends and holidays. People who work in big stores say the more of that you can offer, weekends especially, the better your chances of being hired and keeping your hours.', src: ['target-overnight', 'r-hard', 'r-weekend'], firstHand: true },
  },
  {
    q: 'Can a seasonal job turn into a regular one?',
    a: { text: 'Often. Target says more than half of its seasonal store team members stayed on after the 2025 holidays.', src: ['target-seasonal'] },
  },
  {
    q: 'Is a text offering me a store job real?',
    a: { text: 'Probably not. The FTC says unexpected job texts from "recruiters" are usually scams, and Target says it never asks for personal information by text. Apply on the store’s own careers site.', src: ['ftc-text', 'target-4am'] },
  },
]

// ── Listings: the filters on the "Hiring now" block (lib/start/listingFilters.js) ──────────────────────────────────
// A plain "Cashier", "Sales Associate" or "Stocker" IS the entry job (no diploma, on-the-job training), so the level
// reads 'entryUnlessMarked': a title is experienced only when it says lead / supervisor / manager / II, or the
// listing's own level says senior. Every row must carry a store word in its title (gateTitle), so "Front End Engineer",
// a hospital "Front End Days" nurse or a stock-trading app cannot fill the list; restaurant counter jobs (barista, host,
// cook, café) belong to the restaurants guide and warehouse jobs to the warehouse guide, so `exclude` drops them, along
// with office sales (medical device, territory, wealth, internships). Measured on Seen's own rows 2026-11-17 (10 title
// reads): cashier, sales associate, store associate, key holder, assistant store manager and customer service associate
// return many store rows (Kroger, Fry's, Lowe's, Walgreens, Dollar Tree, CVS, AutoZone, Verizon, Reformation); "stocker"
// returned only three, so the stocker chip also searches the wordings stores use (stock associate, overnight, inbound).
const RETAIL_TITLE = '\\b(cashiers?|cashiering|checkers?|retail|store|stores|sales associates?|salesperson|sales floor|stockers?|stocking|stock (?:associate|clerk|team|lead|ambassador)|replenish\\w*|inbound|merchandis\\w*|front end|key ?holders?|keyholders?|customer service associates?|customer service desk|guest services?|guest advocate|shift (?:lead|leader|supervisor)|team lead|assistant (?:store )?manager)\\b'
export const listings = {
  defaultRadius: '25',
  radii: ['10', '25', '50', '100'],
  levelMode: 'entryUnlessMarked',
  levelLabels: { any: 'Any level', entry: 'Entry / no experience', experienced: 'Experienced / lead' },
  levelWords: { entry: 'entry-level', experienced: 'experienced' },
  gateTitle: RETAIL_TITLE,
  exclude: '\\b(engineer\\w*|developer|software|programmer|analyst|data|nurse|nursing|rn|lpn|psychiatric|clinical|technician|therapist|pharmacist|veterinar\\w*|physician|recovery|barista|host|hostess|cook|line cook|server|bartender|dishwasher|foh|boh|restaurant|cafe|café|pizza|taqueria|smoothie|vault|treasury|director|vice president|head of|medical device|territory|account (?:executive|manager)|wealth|internal sales|inside sales|outside sales|intelligence|intern|internship|insurance|mortgage|financial|banking|motor vehicle|automotive|warehouse|distribution center|fulfillment center|delivery station|driver|cdl|provisioning|stockton|stockholm|stockbrok\\w*|stock trading|stock plan|livestock|district manager|regional manager|area manager|corporate|recruit\\w*|talent|marketing|e-?commerce|buyer|planner|designer)\\b',
  positions: [
    {
      id: 'all', label: 'All store jobs', noun: 'retail', mix: 'positions',
      queries: ['cashier', 'sales associate', 'stocker', 'customer service associate', 'key holder'],
      seeAll: 'retail sales associate',
    },
    {
      id: 'cashier', label: 'Cashier', noun: 'cashier',
      queries: ['cashier', 'front end cashier', 'checker'],
      match: '\\bcashiers?\\b|\\bcashiering\\b|\\bcheckers?\\b|\\bcheckout\\b|guest advocate|front end (?:associate|clerk)|front end/',
    },
    {
      id: 'sales', label: 'Sales associate', noun: 'sales associate',
      queries: ['sales associate', 'retail sales associate', 'store associate'],
      match: 'sales associates?|retail sales|salesperson|sales floor|store associates?|retail associates?|sales (?:consultant|advisor|specialist)',
    },
    {
      id: 'stocker', label: 'Stocker / overnight', noun: 'stocker and overnight',
      queries: ['stocker', 'stock associate', 'overnight stocker', 'inbound stocking'],
      match: '\\bstockers?\\b|\\bstocking\\b|stock (?:associate|clerk|team|lead|ambassador)|\\breplenish\\w*|\\binbound\\b|overnight (?:associate|team|merchandis\\w*|freight)|freight (?:team|associate|flow)|merchandis(?:er|ing) associate',
    },
    {
      id: 'service', label: 'Customer service', noun: 'customer service',
      queries: ['customer service associate', 'guest services', 'service desk associate'],
      match: 'customer service associates?|customer service desk|service desk associate|guest services?|returns? (?:associate|desk|clerk)',
    },
    {
      id: 'lead', label: 'Key holder / supervisor', noun: 'key holder and supervisor',
      queries: ['key holder', 'assistant store manager', 'shift supervisor retail'],
      match: 'key ?holders?|keyholders?|shift (?:lead|leader|supervisor)|team lead|\\bsupervisor\\b|assistant (?:store )?manager|front end (?:coach|lead)|\\blead\\b',
    },
  ],
}

// ── The page's openable rows (components/start/Guide.tsx `Blocks` renders each block type) ──────────────────────────
export const menu = [
  {
    id: 'the-jobs', title: 'The jobs', summary: 'Six store jobs, and what each pays',
    blocks: [
      { type: 'cards', items: jobs.map((j) => ({ name: j.role, aka: j.aka, body: j.what, chips: j.chips })) },
      { type: 'more', title: 'Pay in stores and everywhere else', blocks: [
        { type: 'table', caption: 'Median hourly pay, in retail and across every industry', columns: [{ key: 'occupation', label: 'Occupation' }, { key: 'retail', label: 'In stores', num: true }, { key: 'all', label: 'Every industry', num: true }], rows: payTable },
        { type: 'note', entry: payTableNote },
        { type: 'text', entries: outlook },
      ] },
    ],
  },
  {
    id: 'what-it-pays', title: 'What stores pay to start', summary: 'Employers’ own numbers, and what pays more',
    blocks: [
      { type: 'text', entry: postedPayIntro },
      { type: 'table', caption: 'Starting pay stated on employers’ own fact sheets and postings', columns: [{ key: 'employer', label: 'Employer' }, { key: 'role', label: 'Job' }, { key: 'pay', label: 'Stated pay', num: true }], rows: postedPay },
      { type: 'heading', text: 'What pays more' },
      { type: 'checklist', items: paysMore, cols: true },
    ],
  },
  {
    id: 'getting-hired', title: 'How stores hire', summary: 'Applying, interviews, the holiday rush',
    blocks: [
      { type: 'text', plain: 'At Walmart, by its own account:' },
      { type: 'checklist', items: walmartSteps, cols: true },
      { type: 'text', plain: 'What people who got in say. Several accounts agree on each of these.' },
      { type: 'steps', items: howPeopleGetIn },
      { type: 'text', entry: seasonal },
      { type: 'resumeLink', before: 'Before you apply, you can', label: 'check your résumé against a posting' },
    ],
  },
  {
    id: 'the-work', title: 'The work and your schedule', summary: 'Hours, lifting, scheduling laws',
    blocks: [
      { type: 'checklist', items: work, cols: true },
      { type: 'text', entry: overnightPeopleSay, lead: 'From people who stock overnight:' },
      { type: 'heading', text: 'Scheduling laws' },
      { type: 'callout', entry: schedLine },
      { type: 'more', title: 'Scheduling laws, place by place', blocks: [{ type: 'checklist', items: schedPlaces }] },
    ],
  },
  {
    id: 'under-18', title: 'If you are under 18', summary: 'Which store jobs you can do, and hours',
    blocks: [
      { type: 'checklist', items: youth, cols: true },
      { type: 'text', entry: tobacco },
    ],
  },
  {
    id: 'moving-up', title: 'Moving up', summary: 'Key holder, team lead, manager',
    blocks: [
      { type: 'text', entries: movingUp },
      { type: 'text', entry: leadPeopleSay, lead: 'From people who lead store teams:' },
    ],
  },
  {
    id: 'watch-out', title: 'Watch out', icon: 'caution', summary: 'Job-text scams, and what ends a new job',
    blocks: [
      { type: 'notesGrid', groups: [
        { label: 'Scams', items: scams, icon: 'x' },
        { label: 'What ends a new job, people say', items: whatEndsIt, icon: 'x' },
      ] },
    ],
  },
  { id: 'questions', title: 'Common questions', summary: 'Experience, age, pay, availability, scams', blocks: [{ type: 'faq', items: faq }] },
]

// ── Additional resources: every reference above, as plain grouped links (no numbers, closed by default) ────────────
export const resourcesSummary = 'Employers’ postings, pay data, your rights'
export const resources = [
  { title: 'Employers’ postings and pay', items: [
    { key: 'target-seasonal', name: 'Target: seasonal hiring and starting pay' },
    { key: 'target-overnight', name: 'Target: overnight stocking, Orlando, FL' },
    { key: 'target-closing', name: 'Target: general merchandise and closing, Orlando, FL' },
    { key: 'target-4am', name: 'Target: seasonal early-morning stocking, Kissimmee, FL' },
    { key: 'walmart-hire', name: 'Walmart: how it hires' },
    { key: 'walmart-texts', name: 'Walmart: recruiting text messages' },
    { key: 'walmart-pay', name: 'Walmart: how much associates make' },
    { key: 'walmart-jobs', name: 'Walmart: jobs and promotions report, July 2026' },
    { key: 'kh-lwp', name: 'Little Words Project: key holder, Nashville, TN' },
    { key: 'kh-thirdlove', name: 'Thirdlove: key holder, Corte Madera, CA' },
    { key: 'kh-shinola', name: 'Shinola: key holder, Ann Arbor, MI' },
    { key: 'kh-mizzen', name: 'Mizzen+Main: key holder, Dallas and Fort Worth, TX' },
  ] },
  { title: 'Pay and jobs data', items: [
    { key: 'bls-iag-retail', name: 'Retail trade (Bureau of Labor Statistics)' },
    { key: 'bls-cashiers', name: 'Cashiers' },
    { key: 'bls-retail', name: 'Retail sales workers' },
    { key: 'bls-hand', name: 'Hand laborers, stockers and order fillers' },
    { key: 'onet-stockers', name: 'Stockers and order fillers (O*NET)' },
    { key: 'onet-supervisors', name: 'Retail supervisors (O*NET)' },
    { key: 'bls-osh', name: 'Workplace injuries and illnesses, 2024 (Bureau of Labor Statistics)' },
  ] },
  { title: 'Scheduling laws', items: [
    { key: 'or-sched', name: 'Oregon predictive scheduling' },
    { key: 'sea-sched', name: 'Seattle Secure Scheduling' },
    { key: 'chi-sched', name: 'Chicago Fair Workweek' },
    { key: 'nyc-sched', name: 'New York City Fair Workweek for retail' },
    { key: 'phl-sched', name: 'Philadelphia Fair Workweek' },
    { key: 'la-sched', name: 'Los Angeles Fair Work Week' },
  ] },
  { title: 'Age rules', items: [
    { key: 'dol-fs43', name: 'Child labor rules outside farm work (Department of Labor)' },
    { key: 'ecfr-570-34', name: 'Jobs 14- and 15-year-olds may do (29 CFR 570.34)' },
    { key: 'ecfr-570-63', name: 'Balers and compactors (29 CFR 570.63)' },
    { key: 'fda-t21', name: 'Tobacco 21 and photo ID (FDA)' },
  ] },
  { title: 'Job scams', items: [
    { key: 'ftc-text', name: 'That job offer text is probably a scam (Federal Trade Commission)' },
    { key: 'ftc-scams', name: 'Job scams (Federal Trade Commission)' },
  ] },
  { title: 'Community discussions', items: [
    { key: 'r-hard', name: 'Why getting hired at Target is hard' },
    { key: 'r-rejected', name: 'Rejected with open availability' },
    { key: 'r-weekend', name: 'Hours cut without weekend availability' },
    { key: 'r-video', name: 'Waiting after the video interview' },
    { key: 'r-phone', name: 'Scheduling the phone interview' },
    { key: 'r-seasonal', name: 'Staying on after a seasonal job' },
    { key: 'r-temp', name: 'A temporary associate hoping to stay' },
    { key: 'r-on-speed', name: 'Getting faster on overnight stocking' },
    { key: 'r-on-times', name: 'Freight times on the overnight crew' },
    { key: 'r-tl-what', name: 'What team leads do' },
    { key: 'r-tl-down', name: 'Stepping down from team lead' },
    { key: 'r-tl-open', name: 'Team leads and open availability' },
    { key: 'r-tl-mentee', name: 'Filling in for a team lead' },
  ] },
]

/** Every fact on the page, in reading order: the hero, then each menu row. */
export function pageEntries() {
  return [guide.answer, ...tiles, ...blockEntries(menu)]
}
