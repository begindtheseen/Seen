// /start/delivery — "Getting into delivery driving (no CDL)". The page renders from this module only, so every figure
// on it carries a reference and an as-of date (lib/start/guides.test.mjs fails on a figure without one).
//
// THE ONLY SOURCE OF FACTS is the research file compiled 2026-11-17 (session scratchpad guides20/delivery/research.md,
// raw page text beside it). Rules this module keeps:
//   • only items the research marked VERIFIED against a primary source: BLS (the Occupational Outlook Handbook, the
//     couriers-and-messengers industry page, the injury release), the eCFR text of the FMCSA rules, the IRS, the
//     Department of Labor, the FTC, the Texas Department of Insurance, and employers' own pages and postings (UPS,
//     Amazon's own announcements, FedEx, and postings read on the employers' Greenhouse and Ashby boards);
//   • FIRST-HAND items (several drivers agreeing across at least two threads) only as `firstHand: true`, worded as
//     what drivers say, never as fact; a single account is never used;
//   • left out on purpose: Amazon's projections of partner-driver pay ("nearly $24", "nearly $22.00"), the couriers
//     national median (the figures conflict), UPS's seasonal hiring count, Amazon Flex age and car rules (its site
//     refuses servers), city and state gig-pay laws (no primary page read), and the aggregator ad pay lines on
//     Seen's own rows;
//   • the candid parts are said plainly: gig work is contract work whose costs are yours, many personal car policies
//     do not cover deliveries, the injury rate is several times the private-industry rate, and seasonal work comes
//     with no promise of a job after the season;
//   • no hype, no guarantees, no exclamation marks.
//
// Shape: `sources` (every reference behind the page, never printed as citations — readers reach the links through the
// grouped "Additional resources" row, `resources` below), entries `{ text, src: [sourceKey…], firstHand? }`, the
// listings filter config (`listings`, lib/start/listingFilters.js) and the openable rows (`menu`, rendered by
// components/start/Guide.tsx Blocks). Pure data; relative imports only so `node --test` runs it as is.

import { blockEntries } from './entries.js'

/** @typedef {{ label: string, url: string, date: string, note?: string }} Source */

const ECFR = (section) => `https://www.ecfr.gov/current/title-49/section-${section}`

/** @type {Record<string, Source>} */
export const sources = {
  // Pay, outlook, injuries (BLS).
  'bls-ooh': { label: 'U.S. Bureau of Labor Statistics, Occupational Outlook Handbook: Delivery Truck Drivers and Driver/Sales Workers (May 2025 pay)', url: 'https://www.bls.gov/ooh/transportation-and-material-moving/delivery-truck-drivers-and-driver-sales-workers.htm', date: '2026-08-27', note: 'page updated' },
  'bls-iag492': { label: 'BLS Industries at a Glance: Couriers and Messengers, NAICS 492 (2024 injury rates)', url: 'https://www.bls.gov/iag/tgs/iag492.htm', date: '2026-11-17', note: 'read' },
  'bls-osh': { label: 'BLS news release, Employer-Reported Workplace Injuries and Illnesses – 2023-2024 (private industry rate for 2024)', url: 'https://www.bls.gov/news.release/osh.nr0.htm', date: '2026-01-22', note: 'released' },
  // Federal rules (eCFR text up to date as of 2026-11-13).
  'cfr-383-5': { label: '49 CFR 383.5, definitions: the commercial motor vehicle that needs a CDL (eCFR)', url: ECFR('383.5'), date: '2026-11-13', note: 'text as of' },
  'cfr-390-5': { label: '49 CFR 390.5, definitions: commercial motor vehicle for the FMCSA safety rules, 10,001 pounds (eCFR)', url: ECFR('390.5'), date: '2026-11-13', note: 'text as of' },
  'cfr-391-11': { label: '49 CFR 391.11, general qualifications of drivers (eCFR)', url: ECFR('391.11'), date: '2026-11-13', note: 'text as of' },
  'cfr-391-41': { label: '49 CFR 391.41, physical qualifications for drivers (eCFR)', url: ECFR('391.41'), date: '2026-11-13', note: 'text as of' },
  'cfr-391-45': { label: '49 CFR 391.45, persons who must be medically examined and certified (eCFR)', url: ECFR('391.45'), date: '2026-11-13', note: 'text as of' },
  'cfr-391-23': { label: '49 CFR 391.23, investigation and inquiries: the new driver\'s 3-year motor vehicle record (eCFR)', url: ECFR('391.23'), date: '2026-11-13', note: 'text as of' },
  'cfr-391-25': { label: '49 CFR 391.25, annual inquiry and review of driving record (eCFR)', url: ECFR('391.25'), date: '2026-11-13', note: 'text as of' },
  'cfr-382-103': { label: '49 CFR 382.103, who the DOT drug and alcohol testing rules apply to (eCFR)', url: ECFR('382.103'), date: '2026-11-13', note: 'text as of' },
  'dol-fs19': { label: 'U.S. Department of Labor, Fact Sheet 19: the motor carrier exemption under the FLSA (small vehicle exception)', url: 'https://www.dol.gov/agencies/whd/fact-sheets/19-flsa-motor-carrier', date: '2026-11-17', note: 'read' },
  'dol-misclass': { label: 'U.S. Department of Labor, Misclassification of employees as independent contractors under the FLSA', url: 'https://www.dol.gov/agencies/whd/flsa/misclassification', date: '2026-11-17', note: 'read' },
  // Gig work: taxes, costs, insurance.
  'irs-gig': { label: 'Internal Revenue Service, Manage taxes for your gig work', url: 'https://www.irs.gov/businesses/small-businesses-self-employed/manage-taxes-for-your-gig-work', date: '2026-06-28', note: 'page reviewed' },
  'irs-se': { label: 'Internal Revenue Service, Self-employment tax (Social Security and Medicare taxes)', url: 'https://www.irs.gov/businesses/small-businesses-self-employed/self-employment-tax-social-security-and-medicare-taxes', date: '2026-10-30', note: 'page reviewed' },
  'irs-mileage': { label: 'Internal Revenue Service, Standard mileage rates (2026, July 1 to December 31)', url: 'https://www.irs.gov/tax-professionals/standard-mileage-rates', date: '2026-07-28', note: 'page reviewed' },
  'dd-tax': { label: 'DoorDash, Dasher guide to taxes (own help page)', url: 'https://help.doordash.com/en-us/dashers/article/common-dasher-tax-questions', date: '2026-11-17', note: 'read' },
  'amz-flex': { label: 'Amazon, "Amazon Flex: Everything to know about our flexible delivery service" (company news)', url: 'https://www.aboutamazon.com/news/operations/amazon-flex-delivery-service', date: '2025-05-01', note: 'published' },
  'ftc-gig': { label: 'Federal Trade Commission consumer alert, "FTC helps Walmart Spark Drivers (and other gig workers): here\'s how"', url: 'https://consumer.ftc.gov/consumer-alerts/2026/02/ftc-helps-walmart-spark-drivers-and-other-gig-workers-heres-how', date: '2026-02-26', note: 'published' },
  'tdi': { label: 'Texas Department of Insurance, "Delivering packages? What to know about auto insurance"', url: 'https://tdi.texas.gov/tips/delivering-packages-what-to-know-about-auto-insurance.html', date: '2024-10-14', note: 'page updated' },
  // Your rights, and scams.
  'ftc-bg': { label: 'Federal Trade Commission, Employer background checks and your rights', url: 'https://consumer.ftc.gov/articles/employer-background-checks-and-your-rights', date: '2025-08', note: 'published' },
  'ftc-scams': { label: 'Federal Trade Commission, Job scams (reshipping, paying for a job, fake checks)', url: 'https://consumer.ftc.gov/articles/job-scams', date: '2023-03', note: 'published' },
  // Employers' own pages.
  'ups-pdd': { label: 'UPS careers, Package Delivery Driver (FAQ: qualifications, shifts, training, seasonal roles)', url: 'https://www.jobs-ups.com/us/en/package-delivery-driver', date: '2026-11-17', note: 'read' },
  'ups-helpers': { label: 'UPS careers, Driver Helpers (FAQ)', url: 'https://www.jobs-ups.com/us/en/driver-helpers', date: '2026-11-17', note: 'read' },
  'ups-ssd': { label: 'UPS careers, Seasonal Support Driver (FAQ)', url: 'https://www.jobs-ups.com/us/en/seasonal-support-driver', date: '2026-11-17', note: 'read' },
  'ups-helper-post': { label: 'UPS posting, Driver Helper, Great Bend, KS (posted 2026-11-11)', url: 'https://www.jobs-ups.com/us/en/job/6985e35b-0879-458a-9b7d-4be7b23760ea', date: '2026-11-17', note: 'read' },
  'ups-ssd-post': { label: 'UPS posting, Seasonal Support Driver, Hutchinson, KS (posted 2026-11-17)', url: 'https://www.jobs-ups.com/us/en/job/018e7eff-aa6b-4251-af16-03116749a007', date: '2026-11-17', note: 'read' },
  'amz-dsp': { label: 'Amazon, "Everything you need to know about Amazon\'s Delivery Service Partner (DSP) program" (updated 2024-10-28)', url: 'https://www.aboutamazon.com/news/policy-news-views/amazon-dsp-program-update', date: '2024-10-28', note: 'updated' },
  'amz-dsp-2026': { label: 'Amazon, Delivery Service Partner program investment announcement (September 2026)', url: 'https://www.aboutamazon.com/news/transportation/amazon-dsp-program-investment-2026', date: '2026-09-21', note: 'published' },
  'fedex-contract': { label: 'FedEx, Contract with FedEx: the opportunity (pickup and delivery service providers)', url: 'https://www.contracting.fedex.com/the-opportunity', date: '2026-11-17', note: 'read' },
  'fedex-careers': { label: 'FedEx Careers, drivers', url: 'https://careers.fedex.com/career-areas/driver/', date: '2026-11-17', note: 'read' },
  // Postings on employers' own job boards (read 2026-11-17; the date shown is the posting's last update).
  'post-certified': { label: 'Certified Group posting 4505521009, Courier, Melville, NY (own job board)', url: 'https://job-boards.greenhouse.io/certifiedgroup/jobs/4505521009', date: '2026-11-12', note: 'posting updated' },
  'post-rls': { label: 'RLS posting 4714310006, Courier, Sterling, VA (own job board)', url: 'https://job-boards.greenhouse.io/rlsbio/jobs/4714310006', date: '2026-11-17', note: 'posting updated' },
  'post-sps': { label: 'SPS North America posting 5477672008, Courier/Driver (Delivery Trucks and Vans), Seattle, WA (own job board)', url: 'https://job-boards.greenhouse.io/spsnorthamerica/jobs/5477672008', date: '2026-11-09', note: 'posting updated' },
  'post-airspace': { label: 'Airspace posting 6231167004, Medical Courier, Dayton, OH area (own job board)', url: 'https://job-boards.greenhouse.io/airspace/jobs/6231167004', date: '2026-11-03', note: 'posting updated' },
  'post-icee': { label: 'ICEE posting 5479125008, Route Sales Driver, Detroit, MI (own job board)', url: 'https://job-boards.greenhouse.io/icee/jobs/5479125008', date: '2026-11-11', note: 'posting updated' },
  'post-base-box': { label: 'Base Power posting, Box Truck Driver (Dallas-Fort Worth) (own job board)', url: 'https://jobs.ashbyhq.com/base-power/561d397d-2471-473e-9299-219757071f9d', date: '2026-11-02', note: 'published' },
  'post-base-lastmile': { label: 'Base Power posting, Last Mile Driver, Bloomingdale, IL (own job board)', url: 'https://jobs.ashbyhq.com/base-power/c318523e-aee1-4dc5-9810-3fd1899c4ac5', date: '2026-05-21', note: 'published' },
  // First-hand accounts (read through the Arctic Shift archive). Used only where several accounts agree, and rendered
  // as what drivers say, never as fact.
  'r-1xvb94p': { label: 'r/AmazonDSPDrivers, "Why\'d I get nursery level 1 route 3 months in"', url: 'https://www.reddit.com/r/AmazonDSPDrivers/comments/1xvb94p/', date: '2026-11-13', note: 'thread' },
  'r-1xumnkk': { label: 'r/AmazonDSPDrivers, "My nursery level 3 route, is that right"', url: 'https://www.reddit.com/r/AmazonDSPDrivers/comments/1xumnkk/', date: '2026-11-12', note: 'thread' },
  'r-1xuthp5': { label: 'r/AmazonDSPDrivers, "Will I eventually get back to better routes?"', url: 'https://www.reddit.com/r/AmazonDSPDrivers/comments/1xuthp5/', date: '2026-11-13', note: 'thread' },
  'r-1xuznz7': { label: 'r/AmazonDSPDrivers, "Anyone else have a good DSP?"', url: 'https://www.reddit.com/r/AmazonDSPDrivers/comments/1xuznz7/', date: '2026-11-13', note: 'thread' },
  'r-1xtz80c': { label: 'r/AmazonDSPDrivers, "The worst part of this job is how inconsistent it is"', url: 'https://www.reddit.com/r/AmazonDSPDrivers/comments/1xtz80c/', date: '2026-11-12', note: 'thread' },
  'r-1xu2e24': { label: 'r/AmazonDSPDrivers, thread on body pain after two years of routes', url: 'https://www.reddit.com/r/AmazonDSPDrivers/comments/1xu2e24/', date: '2026-11-12', note: 'thread' },
  'r-1xx58e0': { label: 'r/AmazonDSPDrivers, "Need advice, older 40+, physically brutal"', url: 'https://www.reddit.com/r/AmazonDSPDrivers/comments/1xx58e0/', date: '2026-11-15', note: 'thread' },
  'r-1xxi790': { label: 'r/AmazonDSPDrivers, "Dealing with the pain + gear/gadgets"', url: 'https://www.reddit.com/r/AmazonDSPDrivers/comments/1xxi790/', date: '2026-11-16', note: 'thread' },
  'r-1xxvylt': { label: 'r/doordash_drivers, "Miles driven per dollar earnings"', url: 'https://www.reddit.com/r/doordash_drivers/comments/1xxvylt/', date: '2026-11-16', note: 'thread' },
  'r-1xtjlbp': { label: 'r/doordash_drivers, thread on offers paying a dollar a mile or less', url: 'https://www.reddit.com/r/doordash_drivers/comments/1xtjlbp/', date: '2026-11-11', note: 'thread' },
  'r-1xu8fpg': { label: 'r/AmazonFlexDrivers, "Stop cheating yourself"', url: 'https://www.reddit.com/r/AmazonFlexDrivers/comments/1xu8fpg/', date: '2026-11-12', note: 'thread' },
  'r-1xv9he4': { label: 'r/AmazonFlexDrivers, thread on long trips and gas costs for a block', url: 'https://www.reddit.com/r/AmazonFlexDrivers/comments/1xv9he4/', date: '2026-11-13', note: 'thread' },
}

export const guide = {
  path: '/start/delivery',
  title: 'Getting into delivery driving (no CDL)',
  crumbLabel: 'Delivery driving',
  eyebrow: 'Guide',
  // The one-sentence answer under the h1 (the page's first screen). No figure here: figures live in the tiles.
  answer: { text: 'Most delivery jobs take a regular driver\'s license, a clean driving record and the strength to carry packages all day, and employers train you on the job. App-based gig delivery is different: apps such as DoorDash treat you as a contractor, so the car, the gas and the taxes are yours.', src: ['bls-ooh', 'ups-pdd', 'dd-tax', 'amz-flex', 'irs-gig'] },
  metaDescription: 'How to get a delivery driving job without a CDL: route, package and helper jobs, couriers, box trucks and route sales, what employers check, gig apps versus a paycheck, pay, the work, scams, and live delivery listings near you.',
  asOf: '2026-11-17',
}

// The three readings in the hero: each restates a sourced fact below, with the same sources.
export const tiles = [
  { label: 'Median pay', value: '$44,860', text: 'a year for light truck drivers, the occupation most delivery drivers fall in, May 2025', src: ['bls-ooh'] },
  { label: 'CDL needed from', value: '26,001 lb', text: 'below that weight rating a regular license is enough, unless the vehicle is built for 16 or more people or hauls placarded hazmat', src: ['cfr-383-5'] },
  { label: 'Injury rate', value: '8.0 vs 2.3', text: 'recorded injury and illness cases per 100 full-time workers in 2024: courier and delivery companies against all private industry', src: ['bls-iag492', 'bls-osh'] },
]

// 1. The jobs: a name, one paragraph, and the sourced figures as chips.
export const jobs = [
  {
    name: 'Route delivery driver', aka: 'Package vans: Amazon partners, UPS',
    body: { text: 'Drives a set route of homes and businesses in a company van or truck. Amazon\'s route drivers work for Delivery Service Partners, which Amazon describes as independent businesses that hire and manage their own employees; it says every partner gives full-time drivers health coverage and paid time off. UPS package drivers work for UPS: 21 or older, a regular license, a DOT physical and a UPS driving test.', src: ['amz-dsp', 'amz-dsp-2026', 'ups-pdd'] },
    chips: [{ text: 'No CDL needed', src: ['ups-pdd'] }, { text: 'UPS shifts typically 8–10 hours', src: ['ups-pdd'] }],
  },
  {
    name: 'Driver helper', aka: 'Seasonal, rides along',
    body: { text: 'Rides with a UPS driver and runs packages to the door; helpers never drive the truck. No driver\'s license and no experience needed, but you must lift up to 70 lb. UPS usually hires helpers only in October, November and December, offers work each morning by call or text, and you meet the truck at a pick-up point.', src: ['ups-helpers', 'ups-helper-post'] },
    chips: [{ text: '$18.40/hr on a Kansas posting', src: ['ups-helper-post'] }],
  },
  {
    name: 'Courier', aka: 'Lab, medical and pharmacy runs',
    body: { text: 'Carries samples, medicine or packages between labs, clinics and businesses, often in a company car. One lab courier posting rules out any DUI or major moving violation in the past 5 years; a radiopharmacy courier posting asks for a drug test, a background check and lifting 60 lb.', src: ['post-certified', 'post-rls', 'post-sps'] },
    chips: [{ text: '$21–$23/hr, lab courier, New York', src: ['post-certified'] }, { text: '$22–$23/hr, Seattle', src: ['post-sps'] }, { text: 'From $20/hr part-time, Virginia', src: ['post-rls'] }],
  },
  {
    name: 'Box truck driver', aka: 'Straight trucks under the CDL line',
    body: { text: 'A box truck rated under 26,001 lb needs no CDL. At 10,001 lb or more, used in interstate commerce, federal rules add a DOT medical card and a minimum age of 21. A 26-foot box truck job in Dallas asks for a regular license with a clean record and the ability to pass a DOT physical.', src: ['cfr-383-5', 'cfr-390-5', 'cfr-391-41', 'cfr-391-11', 'post-base-box'] },
    chips: [{ text: '$23–$25/hr with 2+ years of box truck driving, Illinois', src: ['post-base-lastmile'] }],
  },
  {
    name: 'Route sales driver', aka: 'Delivers, restocks and takes orders',
    body: { text: 'Drives a regular route to stores and food service customers, delivers, restocks and sells. An ICEE posting asks for age 21 "due to DOT requirements," 3 years of DOT driving and lifting 55 lb regularly, and supplies the vehicle, a phone and a gas card. Nationally, driver/sales workers earned a median $38,770 a year in May 2025.', src: ['post-icee', 'bls-ooh'] },
    chips: [{ text: 'From $22/hr, Detroit', src: ['post-icee'] }],
  },
]
export const startInside = { text: 'Many start inside the building: BLS notes that some drivers begin as package loaders at warehouses, especially at large companies. Training is usually a month or less on the job, sometimes with a mentor who rides along.', src: ['bls-ooh'] }
export const fedex = { text: 'At FedEx, pickup and delivery contractors acquire their own vehicles and hire and train their own drivers. FedEx asks its delivery drivers for a standard license and a good driving record under federal motor carrier rules.', src: ['fedex-contract', 'fedex-careers'] }

// 2. What employers check.
export const checks = [
  { name: 'A regular license from your state', text: 'A CDL is needed only from 26,001 lb, for 16 or more passengers, or for placarded hazmat. The other jobs in this guide take a regular license.', src: ['cfr-383-5', 'ups-pdd'] },
  { name: 'A clean driving record', text: 'UPS reviews your driving record in its background check; a lab courier posting rules out DUIs and major moving violations in the past 5 years.', src: ['ups-pdd', 'post-certified', 'bls-ooh'] },
  { name: 'Often 21 or older', text: 'UPS asks 21 for its drivers, seasonal drivers in their own cars included, and federal rules generally set 21 for anyone driving a vehicle of 10,001 lb or more in interstate commerce. UPS driver helpers need no license.', src: ['ups-pdd', 'ups-ssd', 'cfr-391-11', 'cfr-390-5', 'ups-helpers'] },
  { name: 'Lifting, all day', text: 'UPS asks you to lift up to 70 lb, and ICEE says lifts over 70 lb come up now and then; courier postings ask for 50 to 60 lb.', src: ['ups-pdd', 'post-icee', 'post-rls', 'post-airspace'] },
  { name: 'A DOT medical card, for some trucks', text: 'Required for a vehicle rated 10,001 lb or more used in interstate commerce, and renewed at least every 24 months. UPS asks every package driver to pass the DOT physical.', src: ['cfr-390-5', 'cfr-391-41', 'cfr-391-45', 'ups-pdd'] },
  { name: 'A drug test, if the employer asks', text: 'Federal DOT drug and alcohol testing covers CDL drivers, not regular-license drivers, but employers can test anyway: one radiopharmacy courier posting asks for a drug test and a background check.', src: ['cfr-382-103', 'post-rls'] },
]
export const rights = [
  { text: 'An employer must get your written permission before a background check company runs a report on you. If it turns you down because of the report, it must first give you a copy and a summary of your rights.', src: ['ftc-bg'] },
  { text: 'For drivers of vehicles rated 10,001 lb or more in interstate work, the employer must get your last 3 years of driving record within 30 days of hiring, and review it at least once every 12 months.', src: ['cfr-391-23', 'cfr-391-25'] },
]

// 3. Gig work or a delivery job.
export const doors = {
  job: {
    title: 'A delivery job (employee)',
    lead: { text: 'Usually paid by the hour, with tax withheld from each paycheck and minimum wage and overtime law behind you. Many of these jobs put you in a company vehicle.', src: ['irs-gig', 'dol-misclass', 'post-icee', 'post-rls'] },
    examples: [
      { who: 'Overtime', figure: 'Applies', text: 'under federal law to employee drivers in any week they drive, even in part, a vehicle of 10,000 lb or less, the Labor Department says; drivers of heavier trucks between states can be exempt', src: ['dol-fs19'] },
      { who: 'Company vehicle', figure: 'Vehicle and gas card', text: 'ICEE supplies the vehicle, a phone and a gas card; RLS couriers drive company cars, not their own', src: ['post-icee', 'post-rls'] },
      { who: 'Your own car, as an employee', figure: '$0.76 a mile', text: 'mileage pay for UPS seasonal support drivers, beside $23.00 an hour base pay, a Kansas posting says', src: ['ups-ssd-post'] },
    ],
    note: null,
  },
  gig: {
    title: 'App-based gig work (usually contractor)',
    lead: { text: 'You choose when to work, in your own vehicle. DoorDash calls its drivers independent contractors: nothing is withheld, and tracking expenses and paying the taxes is on you.', src: ['amz-flex', 'dd-tax', 'irs-gig'] },
    examples: [
      { who: 'Amazon Flex', figure: '$18–$25 an hour', text: 'what Amazon says most Flex drivers make, depending on location; drivers see a block\'s pay before taking it, and the page does not say whether gas and car costs come out first', src: ['amz-flex'] },
      { who: 'Self-employment tax', figure: '15.3%', text: 'Social Security and Medicare on your self-employment earnings, on top of income tax, once you net $400 or more', src: ['irs-se', 'irs-gig'] },
      { who: 'Miles you can deduct', figure: '76¢ a mile', text: 'the IRS standard rate for business driving from July 1 to December 31, 2026 (72.5¢ before), if you log your miles', src: ['irs-mileage'] },
    ],
    note: { text: 'DoorDash says its mileage estimate covers on-delivery miles only, so keep your own log. As a contractor you may have to pay estimated tax four times a year.', src: ['dd-tax', 'irs-gig'] },
  },
}
export const insurance = { text: 'Check your car insurance before your first delivery. The Texas Department of Insurance warns that some personal policies won\'t cover driving for business, and that if you don\'t tell your insurer, "the company could deny your claims, and you\'d have to pay."', src: ['tdi'] }
export const ftcAsk = { text: 'Before you sign up, the FTC suggests asking whether you are paid by the hour or by the gig, getting a breakdown of what you earned to check it against what was promised, and asking current and past workers about their income and out-of-pocket expenses.', src: ['ftc-gig'] }
export const gigSay = { text: 'Gig drivers say what the app shows is not what you keep: gas, the drive out and wear on the car come out of it. Many food delivery drivers judge each offer by its pay per mile and treat $1 a mile as the floor.', src: ['r-1xxvylt', 'r-1xtjlbp', 'r-1xu8fpg', 'r-1xv9he4'], firstHand: true }

// 4. The work.
export const work = [
  { text: 'Most drivers work full time and some more than 40 hours a week; regular routes can start very early or end late, and weekends and holidays are common, BLS says. Light truck drivers have "one of the highest rates of injuries and illnesses of all occupations."', src: ['bls-ooh'] },
  { text: 'In 2024, courier and delivery companies recorded 8.0 injury and illness cases per 100 full-time workers (all their workers, not only drivers), against 2.3 across private industry.', src: ['bls-iag492', 'bls-osh'] },
]
export const breaks = { text: 'Amazon says its partners\' routes are built to leave time for two 15-minute rest breaks and one 30-minute meal break.', src: ['amz-dsp'] }
export const driversSay = [
  { step: 'Expect 100 to 200 stops a day', text: 'Amazon partner drivers describe 10-hour routes of roughly 100 to 200 stops, with lighter "nursery" routes for new drivers at first; some say the later nursery levels are close to a full route.', src: ['r-1xvb94p', 'r-1xumnkk', 'r-1xuthp5', 'r-1xuznz7'], firstHand: true },
  { step: 'Give your body a couple of months', text: 'Many say climbing in and out of the van all day wears on knees and backs, and that the first two or three months are the hardest; they advise a dolly and plenty of water.', src: ['r-1xu2e24', 'r-1xx58e0', 'r-1xxi790'], firstHand: true },
  { step: 'Choose the company, not just the job', text: 'How good the job is depends on the partner company you work for: pay, the routes you get and how help on late routes is handled vary from one to the next.', src: ['r-1xuznz7', 'r-1xtz80c'], firstHand: true },
]
export const peak = { text: 'Hiring picks up before the holidays. UPS usually hires driver helpers only in October, November and December. It says work after the season is not promised, though many of its people start in seasonal jobs.', src: ['ups-helpers', 'ups-helper-post'] }

// 5. Pay.
export const payRows = [
  { what: 'Median, light truck drivers', figure: '$44,860 a year', src: ['bls-ooh'] },
  { what: 'Lowest 10% earned less than', figure: '$30,800', src: ['bls-ooh'] },
  { what: 'Highest 10% earned more than', figure: '$80,310', src: ['bls-ooh'] },
  { what: 'Light truck drivers at courier and delivery companies', figure: '$47,700', src: ['bls-ooh'] },
  { what: 'Light truck drivers in retail', figure: '$34,350', src: ['bls-ooh'] },
  { what: 'Median, driver/sales workers', figure: '$38,770', src: ['bls-ooh'] },
]
export const payNote = { text: 'National yearly pay for May 2025. Light trucks weigh less than 26,001 lb with their load. BLS projects these jobs to grow 7% from 2025 to 2035, with about 152,700 openings a year.', src: ['bls-ooh'] }
export const postedRows = [
  { job: 'UPS driver helper, Great Bend, KS', pay: '$18.40/hr', src: ['ups-helper-post'] },
  { job: 'UPS seasonal support driver in your own car, Hutchinson, KS', pay: '$23.00/hr + $0.76 a mile', src: ['ups-ssd-post'] },
  { job: 'Lab courier, Melville, NY', pay: '$21–$23/hr', src: ['post-certified'] },
  { job: 'Courier, Seattle, WA', pay: '$22–$23/hr', src: ['post-sps'] },
  { job: 'Radiopharmacy courier, part-time, Sterling, VA', pay: 'From $20/hr', src: ['post-rls'] },
  { job: 'Route sales driver, Detroit, MI', pay: 'From $22/hr', src: ['post-icee'] },
  { job: 'Box truck last-mile driver, 2+ years, Bloomingdale, IL', pay: '$23–$25/hr', src: ['post-base-lastmile'] },
]

// 6. Watch out.
export const redFlags = [
  { text: 'A "job" receiving packages at home and shipping them on. The FTC says: "Reshipping goods is never a real job."', src: ['ftc-scams'] },
  { text: 'Paying to get hired. The FTC says honest employers "will never ask you to pay to get a job."', src: ['ftc-scams'] },
  { text: 'A check that arrives before the work, with a request to send some back. The check will bounce, and the bank will want the money from you.', src: ['ftc-scams'] },
]
export const beforeYes = [
  { text: 'Read the posting for "contract": one medical courier posting asks you to own a high-top cargo van and calls the job "full-time, contract-based."', src: ['post-airspace'] },
  { text: 'Ask whose insurance covers you while you deliver, including the drive to the pickup and back.', src: ['tdi'] },
  { text: 'If the truck is rated 26,001 lb or more, the job needs a CDL.', src: ['cfr-383-5'] },
]

// FAQ — visible on the page and mirrored in FAQPage JSON-LD (only Q&As shown on the page).
export const faq = [
  {
    q: 'Do I need a CDL to drive a box truck?',
    a: { text: 'Not if it is rated under 26,001 lb and does not carry 16 or more people or placarded hazmat. At 10,001 lb or more in interstate commerce, you also need a DOT medical card and must be 21.', src: ['cfr-383-5', 'cfr-390-5', 'cfr-391-41', 'cfr-391-11'] },
  },
  {
    q: 'How old do I have to be?',
    a: { text: 'UPS asks 21 for its drivers, and federal rules set 21 for vehicles of 10,001 lb or more in interstate commerce. A UPS driver helper needs no driver\'s license.', src: ['ups-pdd', 'cfr-391-11', 'ups-helpers'] },
  },
  {
    q: 'Is DoorDash or Amazon Flex a job?',
    a: { text: 'Not usually as an employee: DoorDash calls its drivers independent contractors and withholds no tax, and Amazon Flex drivers deliver in their own vehicles on blocks they choose. As a contractor you owe income tax plus 15.3% self-employment tax on what you net, and you can deduct the business miles you log.', src: ['dd-tax', 'amz-flex', 'irs-se', 'irs-mileage'] },
  },
  {
    q: 'What do delivery drivers make?',
    a: { text: 'Light truck drivers, the occupation most delivery drivers fall in, earned a median $44,860 a year in May 2025, and the lowest 10% under $30,800. The employer postings in this guide, read in November 2026, offered $18.40 to $25 an hour.', src: ['bls-ooh', 'ups-helper-post', 'post-base-lastmile'] },
  },
  {
    q: 'Will a ticket keep me from getting hired?',
    a: { text: 'It depends on the employer and the record: one courier posting rules out any DUI or major moving violation in the past 5 years. An employer needs your written permission to run a background check, and must give you a copy of the report before turning you down because of it.', src: ['post-certified', 'ftc-bg'] },
  },
  {
    q: 'When do seasonal delivery jobs open?',
    a: { text: 'Many seasonal jobs open before the holidays. UPS calls October to December its busy holiday season, and usually hires driver helpers only then.', src: ['ups-pdd', 'ups-helpers'] },
  },
]

// ── Listings: the filters on the "Hiring now" block (lib/start/listingFilters.js) ──────────────────────────────────
// Checked read-only on Seen's own rows 2026-11-17 (active jobs, title searches): "delivery driver" 50+ rows (UPS, a
// Coca-Cola non-CDL ad, Amazon delivery-partner ads, EquipmentShare non-CDL drivers, pizza and food service drivers,
// and 20-odd Amazon Flex rows), "courier" 50+ (Certified Group, RLS, Airspace, SPS, FedEx, hospital couriers),
// "driver helper" 19 (UPS, Maersk), "box truck" 10 (Base Power, Gatik, WME Express, Meyer Logistics), "route sales" 20
// (ICEE, Culligan, Alpha Baking, 1-800-GOT-JUNK), "non-cdl" 34, "route driver" 16 (HP Hood, ICEE, UPS, Ground
// Logistics). Look-alikes the gate and exclusions keep out: CDL and Class A/B jobs (a title that starts with CDL, or
// has "(CDL" or " - CDL" (not "Non - CDL"), or names Class A/B, tractor, OTR, tanker…; "Non-CDL" and "No CDL" titles stay), gig and
// contract offers ("Amazon Flex", "Gig", "Earn $", 1099, owner-operator, sub hauler, lease), bus, shuttle, valet, rideshare, tow,
// yard, forklift and rail-terminal drivers, junk-removal "route sales", and office roles (dispatcher, analyst — an
// "Epic Implementation Analyst (Data Courier)" row — manager, recruiter). Gig apps are kept out by employer
// (`excludeCompany`): Seen's Amazon Flex rows carry the company "Amazon Flex" (checked 2026-11-17), including the one
// titled plainly "Local Package Delivery Driver"; an employee title with "Flex" in it (flexible hours) stays.
// Level: delivery jobs train on the job, so a plain "Delivery Driver" is the entry rung; lead / supervisor / II rows
// read as experienced.
const DELIVERY_TITLE = '\\b(deliver\\w*|drivers?|couriers?|runner|route sales)\\b'
export const listings = {
  defaultRadius: '25',
  radii: ['10', '25', '50', '100'],
  levelMode: 'entryUnlessMarked',
  levelLabels: { any: 'Any level', entry: 'Entry / no experience', experienced: 'Experienced / lead' },
  levelWords: { entry: 'entry-level', experienced: 'experienced' },
  gateTitle: DELIVERY_TITLE,
  exclude: '\\b(amazon flex|gig|earn \\$|1099|independent contractors?|owner[- ]?operators?|sub[- ]?haulers?|lease\\w*|instructor|trainer|recruit\\w*|dispatch\\w*|managers?|supervisor|coordinator|analyst|engineer\\w*|developer|mechanic|forklift|yard|terminal|rail|tow|shuttle|valet|bus|rideshare|chauffeur|limo\\w*|passenger|ambulance|school|junk|hauler|tractor|semi|otr|over[- ]the[- ]road|long[- ]haul|line[- ]?haul|regional|tank\\w*|hazmat|flatbed|dump truck|mixer|class[- ]?[ab]|cdl[- ]?[ab])\\b|(?:^|\\(|[^n]\\s[-–|]\\s)cdl\\b',
  // App-based contract work is explained in the guide, not listed: these employers' driver rows are gig offers.
  excludeCompany: '\\b(amazon flex|doordash|uber|instacart|grubhub|spark driver|roadie|veho|shipt|lyft)\\b',
  positions: [
    { id: 'all', label: 'All delivery jobs', noun: 'delivery driving', queries: ['delivery driver', 'courier', 'route driver', 'driver helper'], match: 'deliver|driver|courier|runner|route sales', seeAll: 'delivery driver' },
    { id: 'route', label: 'Route / package driver', noun: 'route delivery', queries: ['delivery driver', 'package delivery driver', 'route driver', 'parcel delivery driver'], match: 'delivery driver|route driver|route delivery|package|parcel|delivery associate|\\bdsp\\b', seeAll: 'delivery driver' },
    { id: 'helper', label: 'Driver helper', noun: 'driver helper', queries: ['driver helper', 'delivery helper'], match: 'helper|ride[- ]along', seeAll: 'driver helper' },
    { id: 'courier', label: 'Courier', noun: 'courier', queries: ['courier', 'medical courier', 'courier driver'], match: 'courier|runner', seeAll: 'courier' },
    { id: 'box-truck', label: 'Box truck / non-CDL', noun: 'box truck and non-CDL', queries: ['box truck driver', 'non-cdl driver', 'non cdl delivery driver'], match: 'box truck|straight truck|non[- ]?cdl|no cdl|cargo van|sprinter|26 ?(?:ft|foot)', seeAll: 'box truck driver' },
    { id: 'route-sales', label: 'Route sales', noun: 'route sales', queries: ['route sales', 'route sales driver', 'driver sales'], match: 'route sales|sales driver|driver[/ -]sales', seeAll: 'route sales driver' },
  ],
}

// ── The page's openable rows (components/start/Guide.tsx Blocks renders each block type) ──────────────────────────
export const menu = [
  {
    id: 'jobs', title: 'The jobs, and who hires', summary: 'Route, helper, courier, box truck, sales',
    blocks: [
      { type: 'cards', items: jobs },
      { type: 'text', entry: startInside },
      { type: 'link', before: 'Loading and sorting jobs are covered in', label: 'Seen\'s warehouse guide', href: '/start/warehouse', after: '.' },
      { type: 'link', before: 'For bigger trucks that need a commercial license, see', label: 'Seen\'s CDL trucking guide', href: '/start/cdl', after: '.' },
      { type: 'more', title: 'FedEx drivers', blocks: [{ type: 'text', entry: fedex }] },
    ],
  },
  {
    id: 'what-they-check', title: 'What employers check', summary: 'License, record, age, lifting, medical card',
    blocks: [
      { type: 'checklist', items: checks, cols: true },
      { type: 'more', title: 'Your rights in a background check', blocks: [{ type: 'notes', items: rights }] },
    ],
  },
  {
    id: 'gig-or-job', title: 'Gig apps or a delivery job', summary: 'Who pays for the car, the gas and the taxes',
    blocks: [
      { type: 'doors', items: [doors.job, doors.gig] },
      { type: 'callout', entry: insurance },
      { type: 'text', entry: ftcAsk },
      { type: 'text', entry: gigSay, lead: 'From drivers:' },
    ],
  },
  {
    id: 'the-work', title: 'What the work is like', summary: 'Hours, stops, lifting, injuries, peak season',
    blocks: [
      { type: 'text', entries: work },
      { type: 'text', entry: breaks },
      { type: 'heading', text: 'What drivers who got in say' },
      { type: 'steps', items: driversSay },
      { type: 'callout', entry: peak },
    ],
  },
  {
    id: 'pay', title: 'What it pays', summary: 'National medians and pay on real postings',
    blocks: [
      { type: 'table', caption: 'Delivery driver pay across the country', columns: [{ key: 'what', label: 'What' }, { key: 'figure', label: 'Pay', num: true }], rows: payRows },
      { type: 'text', entry: payNote },
      { type: 'more', title: 'Pay on employers\' own postings', blocks: [
        { type: 'table', caption: 'Pay stated on employers\' own postings', columns: [{ key: 'job', label: 'Job' }, { key: 'pay', label: 'Posted pay', num: true }], rows: postedRows },
      ] },
      { type: 'resumeLink', before: 'Before you apply, you can', label: 'check your résumé against a posting' },
    ],
  },
  {
    id: 'watch-out', title: 'Watch out', icon: 'caution', summary: 'Scams, contract jobs, insurance gaps',
    blocks: [
      { type: 'notesGrid', groups: [
        { label: 'Red flags', items: redFlags, icon: 'x' },
        { label: 'Before you say yes', items: beforeYes, icon: 'dot' },
      ] },
    ],
  },
  { id: 'questions', title: 'Common questions', summary: 'CDL, age, gig apps, pay, tickets, timing', blocks: [{ type: 'faq', items: faq }] },
]

// ── Additional resources: every reference above, as plain grouped links (no numbers, closed by default) ────────────
export const resourcesSummary = 'Pay data, federal rules, gig taxes, employers'
export const resources = [
  { title: 'Pay and the work', items: [
    { key: 'bls-ooh', name: 'Delivery truck drivers and driver/sales workers (Bureau of Labor Statistics)' },
    { key: 'bls-iag492', name: 'Couriers and messengers industry (Bureau of Labor Statistics)' },
    { key: 'bls-osh', name: 'Workplace injuries and illnesses (Bureau of Labor Statistics)' },
  ] },
  { title: 'Federal rules', items: [
    { key: 'cfr-383-5', name: 'Which vehicles need a CDL (49 CFR 383.5)' },
    { key: 'cfr-390-5', name: 'Commercial motor vehicle, 10,001 pounds (49 CFR 390.5)' },
    { key: 'cfr-391-11', name: 'Driver qualifications, including age (49 CFR 391.11)' },
    { key: 'cfr-391-41', name: 'Medical certificate (49 CFR 391.41)' },
    { key: 'cfr-391-45', name: 'Who must be medically examined (49 CFR 391.45)' },
    { key: 'cfr-391-23', name: 'Driving record checks at hiring (49 CFR 391.23)' },
    { key: 'cfr-391-25', name: 'Yearly driving record review (49 CFR 391.25)' },
    { key: 'cfr-382-103', name: 'Who DOT drug testing covers (49 CFR 382.103)' },
    { key: 'dol-fs19', name: 'Overtime for drivers of small vehicles (Department of Labor)' },
    { key: 'dol-misclass', name: 'Employee or independent contractor (Department of Labor)' },
  ] },
  { title: 'Gig work, taxes and insurance', items: [
    { key: 'irs-gig', name: 'Taxes for gig work (IRS)' },
    { key: 'irs-se', name: 'Self-employment tax (IRS)' },
    { key: 'irs-mileage', name: 'Standard mileage rates (IRS)' },
    { key: 'dd-tax', name: 'Dasher guide to taxes (DoorDash)' },
    { key: 'amz-flex', name: 'Amazon Flex explained (Amazon)' },
    { key: 'ftc-gig', name: 'Tips for gig workers (Federal Trade Commission)' },
    { key: 'tdi', name: 'Delivering packages and auto insurance (Texas Department of Insurance)' },
  ] },
  { title: 'Your rights and scams', items: [
    { key: 'ftc-bg', name: 'Background checks and your rights (Federal Trade Commission)' },
    { key: 'ftc-scams', name: 'Job scams (Federal Trade Commission)' },
  ] },
  { title: 'Employers', items: [
    { key: 'ups-pdd', name: 'UPS package delivery driver' },
    { key: 'ups-helpers', name: 'UPS driver helpers' },
    { key: 'ups-ssd', name: 'UPS seasonal support driver' },
    { key: 'ups-helper-post', name: 'UPS driver helper posting, Kansas' },
    { key: 'ups-ssd-post', name: 'UPS seasonal support driver posting, Kansas' },
    { key: 'amz-dsp', name: 'Amazon Delivery Service Partner program' },
    { key: 'amz-dsp-2026', name: 'Amazon Delivery Service Partner update, September 2026' },
    { key: 'fedex-contract', name: 'FedEx pickup and delivery contractors' },
    { key: 'fedex-careers', name: 'FedEx driver jobs' },
  ] },
  { title: 'Courier, route and box truck postings', items: [
    { key: 'post-certified', name: 'Courier, Melville, NY (Certified Group)' },
    { key: 'post-rls', name: 'Courier, Sterling, VA (RLS)' },
    { key: 'post-sps', name: 'Courier/driver, Seattle, WA (SPS North America)' },
    { key: 'post-airspace', name: 'Medical courier, Ohio (Airspace)' },
    { key: 'post-icee', name: 'Route sales driver, Detroit, MI (ICEE)' },
    { key: 'post-base-box', name: 'Box truck driver, Dallas-Fort Worth (Base Power)' },
    { key: 'post-base-lastmile', name: 'Last mile driver, Bloomingdale, IL (Base Power)' },
  ] },
  { title: 'Community discussions', items: [
    { key: 'r-1xvb94p', name: 'A nursery route three months in' },
    { key: 'r-1xumnkk', name: 'How many stops a nursery route has' },
    { key: 'r-1xuthp5', name: 'Getting back to better routes' },
    { key: 'r-1xuznz7', name: 'Finding a good delivery partner company' },
    { key: 'r-1xtz80c', name: 'How much the job varies day to day' },
    { key: 'r-1xu2e24', name: 'What the routes do to your body' },
    { key: 'r-1xx58e0', name: 'Starting the job over 40' },
    { key: 'r-1xxi790', name: 'Dealing with the pain, and the gear that helps' },
    { key: 'r-1xxvylt', name: 'Miles driven against dollars earned' },
    { key: 'r-1xtjlbp', name: 'Offers that pay a dollar a mile or less' },
    { key: 'r-1xu8fpg', name: 'Not taking the first rate offered' },
    { key: 'r-1xv9he4', name: 'Long trips and gas on a Flex block' },
  ] },
]

/** Every fact on the page, in reading order: the hero, then each menu row. */
export function pageEntries() {
  return [guide.answer, ...tiles, ...blockEntries(menu)]
}
