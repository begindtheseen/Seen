// /start/fedex — "Getting hired at FedEx". A COMPANY guide: the page renders from this module only, so every figure on
// it carries a reference and an as-of date (lib/start/guides.test.mjs fails on a figure without one).
//
// THE ONLY SOURCE OF FACTS is the research file compiled 2026-11-17 (session scratchpad guides20/fedex/research.md)
// and its pull of FedEx's own job board: every one of the 182 result pages of careers.fedex.com/jobs, read 2026-11-17,
// from the site's own embedded data (guides20/fedex/careers_jobs.json, 4,533 postings, 2,583 in the U.S.;
// guides20/fedex/stats.py recomputes every count and median below).
//   • "Starting rate" = the posting's own minimum (`cf_base_pay_minimum`), which is the figure the posting text states
//     ("Competitive wages beginning at $17.75", "Pay $24.21/hour").
//   • Medians are over U.S. postings the site marks `isInternal: "false"` (1,177 of 2,583). The internal ones are
//     mostly special assignments for current employees, so the page calls the rest "open to outside applicants".
//     Package handler = titles with "package handler", "handler warehouse" or "PH -" (switcher titles excluded, their
//     data carries a $1–$150 placeholder): 525 with a rate, median $18.35. Courier = titles with "courier": 358,
//     median $22.43.
//   • FedEx Freight figures are FedEx Freight's own postings (careers.fedexfreight.com, read 2026-11-17).
// Rules this module keeps:
//   • only items the research marked VERIFIED: FedEx's and FedEx Freight's own pages and postings, FedEx's service-
//     provider sites (driver-prospects.buildagroundbiz.com, contracting.fedex.com, both run by FedEx), FedEx's annual
//     report (Form 10-K for the year ended May 31, 2026, filed 2026-07-20), the FTC;
//   • THE ONE THING THIS PAGE MUST GET RIGHT: drivers for FedEx's contracted service providers are employed by those
//     companies, not by FedEx. Said only in FedEx's own words (who hires, who sets pay and schedules, who pays benefits),
//     never as a court question: no lawsuits, no "misclassification", no joint-employer cases (owner brief);
//   • FIRST-HAND items (two or more threads agree) only as `firstHand: true`; no contractor pay figure from a thread
//     (they disagree person to person);
//   • nothing UNVERIFIED: FedEx's fraud page refused every server read, so the scam lines are the FTC's; no "tuition from
//     day one" (the same posting's benefits paragraph says after 90 continuous days); nothing about who pays for an
//     apprentice's CDL; no stock, share price, ticker, executives or spin-off share terms;
//   • no hype, no guarantees, no exclamation marks.
//
// Shape: `sources` (every reference, NEVER printed as citations — readers reach the links through the grouped
// "Additional resources" row, `resources` below), entries `{ text, src, firstHand? }`, `listings` (a company guide sets
// `employer`) and the openable menu rows (`menu`, rendered by components/start/Guide.tsx). Pure data; relative imports
// only so `node --test` runs it as is.

import { blockEntries } from './entries.js'

/** @typedef {{ label: string, url: string, date: string, note?: string }} Source */

const FX = 'https://careers.fedex.com'
const FXF = 'https://careers.fedexfreight.com'

/** @type {Record<string, Source>} */
export const sources = {
  'fx-board': {
    label: 'FedEx Careers job search (careers.fedex.com), all 182 result pages and the site\'s own posting data: 2,583 U.S. postings',
    url: `${FX}/jobs`,
    date: '2026-11-17', note: 'read',
  },
  'fx-ph': { label: 'FedEx posting P25-195068-20, Package Handler - Part Time (Warehouse like), Charlottesville, VA (Federal Express Corporation)', url: `${FX}/package-handler-part-time-warehouse-like/job/P25-195068-20`, date: '2026-11-17', note: 'read' },
  'fx-mh': { label: 'FedEx posting P25-93658-75, Material Handler - Part Time (Warehouse like), Reno, NV', url: `${FX}/material-handler-part-time-warehouse-like/job/P25-93658-75`, date: '2026-11-17', note: 'read' },
  'fx-courier': { label: 'FedEx posting P25-346398-1, Courier/DOT-2, Carlsbad, CA', url: `${FX}/courier-dot-2/job/P25-346398-1`, date: '2026-11-17', note: 'read' },
  'fx-courier-rural': { label: 'FedEx posting P25-370191-2, Courier (Non-DOT) - Rural/Residential (C)-8, Pharr, TX', url: `${FX}/courier-non-dot-rural-residential-c-8/job/P25-370191-2`, date: '2026-11-17', note: 'read' },
  'fx-tt': { label: 'FedEx posting P25-396872-1, Tractor Trailer Driver/RTD - Apprentice-2, Atlanta, GA', url: `${FX}/tractor-trailer-driver-rtd-apprentice-2/job/P25-396872-1`, date: '2026-11-17', note: 'read' },
  'fx-tech': { label: 'FedEx posting P25-386692-2, Sr. Vehicle Maintenance Technician/DOT, Chicago, IL', url: `${FX}/sr-vehicle-maintenance-technician-dot/job/P25-386692-2`, date: '2026-11-17', note: 'read' },
  'fx-area-ph': { label: 'FedEx Careers, Package Handler career area', url: `${FX}/career-areas/package-handler/`, date: '2026-11-17', note: 'read' },
  'fx-area-driver': { label: 'FedEx Careers, Driver career area', url: `${FX}/career-areas/driver/`, date: '2026-11-17', note: 'read' },
  'fx-area-mx': { label: 'FedEx Careers, Maintenance career area', url: `${FX}/career-areas/maintenance/`, date: '2026-11-17', note: 'read' },
  'fx-hiring': { label: 'FedEx Careers, Hiring and Development (tuition reimbursement, hiring process)', url: `${FX}/hiring-and-development`, date: '2026-11-17', note: 'read' },
  'fx-sp-drivers': {
    label: 'FedEx, "Service providers may be hiring" (driver-prospects.buildagroundbiz.com, a FedEx site for people who want to drive for service providers)',
    url: 'https://driver-prospects.buildagroundbiz.com/',
    date: '2026-11-17', note: 'read',
  },
  'fx-sp-faq': {
    label: 'FedEx, Contract with FedEx: frequently asked questions (contracting.fedex.com)',
    url: 'https://www.contracting.fedex.com/faqs/',
    date: '2026-11-17', note: 'read',
  },
  'sec-10k': {
    label: 'FedEx Corporation Form 10-K for the fiscal year ended May 31, 2026 (SEC EDGAR), filed July 20, 2026',
    url: 'https://www.sec.gov/Archives/edgar/data/1048911/000104891126000105/fdx-20260531.htm',
    date: '2026-07-20', note: 'filed',
  },
  'fxf-areas': { label: 'FedEx Freight Careers, career areas (Freight Handler, CDL Driver, CDL Driver Apprentice, Fleet Maintenance)', url: `${FXF}/career-areas`, date: '2026-11-17', note: 'read' },
  'fxf-city': { label: 'FedEx Freight posting RC5984, City Driver, Round Rock, TX', url: `${FXF}/jobs/RC5984`, date: '2026-11-13', note: 'posted' },
  'fxf-apprentice': { label: 'FedEx Freight posting RC5352, Driver Apprentice-City, Newark, NJ', url: `${FXF}/jobs/RC5352`, date: '2026-11-04', note: 'posted' },
  'fxf-handler': { label: 'FedEx Freight posting RC6004, Freight Handler Part-Time, Memphis, TN', url: `${FXF}/jobs/RC6004`, date: '2026-11-16', note: 'posted' },
  'fxf-road': { label: 'FedEx Freight posting RC4273, Road Driver, Albany, GA', url: `${FXF}/jobs/RC4273`, date: '2026-11-11', note: 'posted' },
  'ftc-jobs': {
    label: 'Federal Trade Commission, consumer advice "Job Scams" (page dated March 2023)',
    url: 'https://consumer.ftc.gov/articles/job-scams',
    date: '2023-03', note: 'published',
  },
  // First-hand accounts (r/FedExers, read through the Arctic Shift archive). Used only where two or more threads agree,
  // and rendered as what people say, never as fact.
  'r-1xpmu1u': { label: 'r/FedExers, "Got this as a part time job to help with debt … never there for more than 2 hours"', url: 'https://www.reddit.com/r/FedExers/comments/1xpmu1u/', date: '2026-11-06', note: 'thread' },
  'r-1wv5jli': { label: 'r/FedExers, "The scheduled shift says 4 hours but the manager sends people home 2 hours into the work"', url: 'https://www.reddit.com/r/FedExers/comments/1wv5jli/', date: '2026-10-01', note: 'thread' },
  'r-1tw4p57': { label: 'r/FedExers, "Is it true package handlers only work 3-4 hrs a clip a few days a week?"', url: 'https://www.reddit.com/r/FedExers/comments/1tw4p57/', date: '2026-06-03', note: 'thread' },
  'r-1wk0eot': { label: 'r/FedExers, "Why don\'t ground drivers get overtime pay?"', url: 'https://www.reddit.com/r/FedExers/comments/1wk0eot/', date: '2026-09-18', note: 'thread' },
  'r-1uq235m': { label: 'r/FedExers, "Got offered $200 a day" (a contractor driving offer)', url: 'https://www.reddit.com/r/FedExers/comments/1uq235m/', date: '2026-07-07', note: 'thread' },
  'r-1udvpbu': { label: 'r/FedExers, "Starting ground driver rate"', url: 'https://www.reddit.com/r/FedExers/comments/1udvpbu/', date: '2026-06-23', note: 'thread' },
  'r-1x8mr9d': { label: 'r/FedExers, "Seasonal, but want to be a driver"', url: 'https://www.reddit.com/r/FedExers/comments/1x8mr9d/', date: '2026-10-17', note: 'thread' },
  'r-1xhqu51': { label: 'r/FedExers, "Got hired as a package handler seasonal and was told after it ends I\'ll become a permanent package handler"', url: 'https://www.reddit.com/r/FedExers/comments/1xhqu51/', date: '2026-10-28', note: 'thread' },
}

export const guide = {
  path: '/start/fedex',
  title: 'Getting hired at FedEx',
  crumbLabel: 'FedEx',
  eyebrow: 'Company guide',
  // The one-sentence answer under the h1 (no figure: the figures live in the tiles).
  answer: { text: 'FedEx hires its own package handlers, couriers, tractor-trailer drivers and mechanics through careers.fedex.com, and most of those jobs ask for no college degree or work experience. Many drivers in FedEx-branded vans work for independent service providers instead, companies that hire their own drivers and set their pay, hours and benefits.', src: ['fx-board', 'fx-ph', 'fx-mh', 'fx-courier-rural', 'fx-sp-drivers', 'fx-sp-faq'] },
  metaDescription: 'How people get hired at FedEx: package handler, courier, driver and mechanic jobs, the pay FedEx states on its postings, how jobs with FedEx Ground service providers differ, FedEx Freight CDL jobs, and FedEx postings open now.',
  asOf: '2026-11-17',
}

// The three readings in the hero: each restates a fact below, with the same references.
export const tiles = [
  { label: 'Package handler pay', value: '$18.35/hr', text: 'the middle starting rate on FedEx\'s U.S. package handler postings open to outside applicants, November 17, 2026', src: ['fx-board', 'fx-ph'] },
  { label: 'Courier pay', value: '$22.43/hr', text: 'the middle starting rate on FedEx\'s U.S. courier postings open to outside applicants, November 17, 2026', src: ['fx-board', 'fx-courier'] },
  { label: 'Service providers', value: 'about 5,300', text: 'independent companies FedEx contracts with for pickup, delivery and linehaul; their drivers work for them, not FedEx (May 31, 2026)', src: ['sec-10k', 'fx-sp-faq'] },
]

// 1. Who your employer is: FedEx, or a service provider.
export const who = {
  oneCompany: { text: 'On June 1, 2024, FedEx Ground was merged into Federal Express Corporation. Package handler and courier postings on careers.fedex.com, including those at former FedEx Ground buildings, name Federal Express Corporation as the employer.', src: ['sec-10k', 'fx-ph', 'fx-courier'] },
  cards: [
    {
      name: 'FedEx courier', aka: 'Employed by FedEx',
      body: { text: 'Hired by Federal Express Corporation through careers.fedex.com. FedEx states the pay on the posting and offers its own benefits, including tuition help.', src: ['fx-courier', 'fx-ph', 'fx-hiring'] },
      chips: [{ text: 'Apply on careers.fedex.com', src: ['fx-board'] }],
    },
    {
      name: 'Driver for a service provider', aka: 'Employed by that company',
      body: { text: 'Service providers are independent businesses that contract with FedEx to pick up and deliver packages or haul trailers. FedEx says it "does not offer employment opportunities for service provider drivers".', src: ['fx-sp-drivers'] },
      chips: [{ text: 'Hired by the service provider', src: ['fx-sp-drivers'] }],
    },
  ],
  means: [
    { name: 'Who hires and fires', text: 'The service provider. FedEx says each one has "sole and complete discretion over its job positions, hiring decisions, and all other employment matters."', src: ['fx-sp-drivers'] },
    { name: 'Who sets pay, schedule and route', text: 'The service provider, which FedEx says sets "compensation, payment, work schedules and times, assignments".', src: ['fx-sp-faq'] },
    { name: 'Who pays benefits', text: 'The service provider bears wages, benefits, payroll taxes and workers\' compensation for its own staff, so FedEx\'s employee benefits, such as tuition help, are not yours.', src: ['fx-sp-faq', 'fx-hiring'] },
    { name: 'Whose van and uniform', text: 'Service providers buy or lease their own vehicles; most agree to put staff who meet the public in FedEx-designated apparel.', src: ['fx-sp-drivers', 'fx-sp-faq'] },
    { name: 'You are an employee, of them', text: 'Service providers agree to assign only people "classified and treated as employees of the service provider".', src: ['fx-sp-faq'] },
    { name: 'Where to apply', text: 'With the service provider. FedEx runs a site where you can leave a profile for service providers to see, and it says doing so is "not applying for employment with FedEx".', src: ['fx-sp-drivers'] },
  ],
  network: { text: 'FedEx is combining its Express and Ground networks under a plan it calls Network 2.0, with both employee couriers and service providers "using a market-by-market approach". By May 31, 2026 it was in place at about 360 U.S. locations, and FedEx expects to finish by the end of 2027. Which kind of driver delivers where you live depends on your market.', src: ['sec-10k'] },
  listingNote: { text: 'The "Hiring now" list above shows only jobs posted by FedEx and FedEx Freight themselves. A posting from another company that puts "FedEx" or "FedEx Ground" in the job title is a service provider job: that company is the employer.', src: ['fx-sp-drivers', 'fx-board'] },
}
export const contractorSay = [
  { text: 'Drivers for service providers say pay, overtime and benefits all depend on which company you work for: many are paid a flat amount for each day, and some describe days of ten hours or more.', src: ['r-1wk0eot', 'r-1uq235m', 'r-1udvpbu'], firstHand: true },
  { text: 'People who want to drive a route suggest asking the drivers at your building which service provider they work for, because the company you pick matters.', src: ['r-1x8mr9d', 'r-1wk0eot'], firstHand: true },
]

// 2. The jobs FedEx itself hires for (its own titles).
export const roles = [
  {
    name: 'Package handler', aka: 'Hubs and stations',
    body: { text: 'Sorts, scans, loads and unloads packages. Part-time handlers usually work 3 to 6 hours a shift, set by package volume; full-time handlers work two shifts a day. Seasonal jobs open around the holidays.', src: ['fx-area-ph', 'fx-ph'] },
    chips: [{ text: 'From $17.75/hr in Charlottesville, VA', src: ['fx-ph'] }, { text: 'Paid weekly', src: ['fx-ph'] }],
  },
  {
    name: 'Material handler', aka: 'Airport and ramp work',
    body: { text: 'Moves packages, freight and air containers with equipment. The Reno posting asks no education or experience but needs a driver\'s license, a drug screen and lifting 50 lbs. without help.', src: ['fx-mh', 'fx-area-ph'] },
    chips: [{ text: '$19.34/hr, Tue–Sat 3:00–8:00 AM in Reno, NV', src: ['fx-mh'] }],
  },
  {
    name: 'Courier', aka: 'Delivery driver, FedEx employee',
    body: { text: 'Drives a FedEx vehicle to deliver and pick up packages. Postings ask for a high school diploma or GED, age 21, a clean driving record and lifting 50 lbs.; swing, part-time and casual courier jobs are posted too.', src: ['fx-courier', 'fx-courier-rural', 'fx-area-driver'] },
    chips: [{ text: '$24.21/hr part time in Carlsbad, CA', src: ['fx-courier'] }, { text: '$22.10/hr in Pharr, TX', src: ['fx-courier-rural'] }],
  },
  {
    name: 'Tractor-trailer driver', aka: 'Apprentice track',
    body: { text: 'The apprentice posting asks you to get a commercial driver\'s license with a hazmat endorsement within 90 days and prefers six months at FedEx Express. FedEx\'s annual report names a Driver Development program that prepares team members to drive tractor-trailers.', src: ['fx-tt', 'sec-10k'] },
    chips: [{ text: '$26.35–$35.54/hr in Atlanta, GA', src: ['fx-tt'] }],
  },
  {
    name: 'Vehicle and maintenance technician', aka: 'Fleet and buildings',
    body: { text: 'Repairs FedEx vehicles, forklifts and sort equipment. A senior vehicle technician posting asks four years of fleet or truck repair and your own hand tools; FedEx also posts Tech Apprentice and shop utility jobs for people earlier on.', src: ['fx-tech', 'fx-area-mx'] },
    chips: [{ text: '$34.03–$44.76/hr in Chicago, IL', src: ['fx-tech'] }],
  },
]

// 3. Pay FedEx states on its own postings.
export const payRows = [
  { role: 'Package Handler, part time', place: 'Charlottesville, VA', pay: '$18.25/hr early morning, $17.75 afternoon', src: ['fx-ph'] },
  { role: 'Material Handler, part time', place: 'Reno, NV', pay: '$19.34/hr', src: ['fx-mh'] },
  { role: 'Courier (Non-DOT), rural and residential', place: 'Pharr, TX', pay: '$22.10/hr', src: ['fx-courier-rural'] },
  { role: 'Courier/DOT, part time', place: 'Carlsbad, CA', pay: '$24.21/hr (range $24.21–$35.25)', src: ['fx-courier'] },
  { role: 'Tractor Trailer Driver, apprentice', place: 'Atlanta, GA', pay: '$26.35–$35.54/hr', src: ['fx-tt'] },
  { role: 'Sr. Vehicle Maintenance Technician', place: 'Chicago, IL', pay: '$34.03–$44.76/hr', src: ['fx-tech'] },
]
export const payNote = { text: 'Across FedEx\'s U.S. postings open to outside applicants on November 17, 2026, half of package handler postings start at $18.35 an hour or more and half of courier postings at $22.43 or more. FedEx says actual pay depends on "experience relative to the job, tenure, market level, pay at the location".', src: ['fx-board', 'fx-courier'] }
export const benefits = [
  { text: 'Full-time employees can enroll in medical, dental and vision coverage on their date of hire; part-time employees qualify after 91 days if they average at least 17 hours a week.', src: ['fx-ph'] },
  { text: 'Up to $5,250 a calendar year in educational assistance after 90 continuous days of employment. FedEx\'s careers site says it covers college and trade, vocational or technical school, "with no lifetime maximums while you are with us".', src: ['fx-ph', 'fx-hiring'] },
  { text: 'Paid time off that builds up to 5 weeks a year, overtime after 40 hours a week, and weekly pay.', src: ['fx-ph'] },
  { text: 'Casual package handlers work up to 24 hours a week and are not eligible for benefits unless the law requires them.', src: ['fx-area-ph'] },
]

// 4. How FedEx hires, as FedEx describes it.
export const apply = {
  site: { text: 'FedEx takes applications on its own careers site. Search by the title FedEx uses (Package Handler, Material Handler, Courier, Tractor Trailer Driver, Vehicle Maintenance Technician) and your city.', src: ['fx-board'] },
  steps: [
    { step: 'Apply online with a résumé', text: 'FedEx says you can apply even if you do not meet every preferred qualification on the posting.', src: ['fx-hiring'] },
    { step: 'Interview, for some jobs', text: '"Some of our jobs will require you to participate in an interview process, which will be via phone, video, or in-person."', src: ['fx-hiring'] },
    { step: 'Get the offer', text: 'The offer includes the pay and benefits.', src: ['fx-hiring'] },
    { step: 'Onboarding and training', text: 'Your manager guides you through on-the-job training and introductory courses.', src: ['fx-hiring'] },
  ],
  checks: [
    { name: 'Drug screen', text: 'Stated on the material handler and tractor-trailer postings; tractor-trailer drivers are also tested under federal rules.', src: ['fx-mh', 'fx-tt'] },
    { name: 'Driving record and medical exam', text: 'Couriers need a clean driving record, and DOT courier jobs a federal medical exam.', src: ['fx-courier'] },
    { name: 'Airport jobs', text: 'Jobs with airport secure-area access go through the TSA\'s criminal history and security threat checks.', src: ['fx-courier'] },
    { name: 'Work authorization', text: 'Federal Express Corporation uses E-Verify.', src: ['fx-courier'] },
  ],
}
export const handlerSay = [
  { text: 'Package handlers say hours follow the package volume and the building: a scheduled shift can end early on a light day, and hours grow in the weeks before the holidays.', src: ['r-1xpmu1u', 'r-1wv5jli', 'r-1tw4p57'], firstHand: true },
  { text: 'Seasonal handlers who were kept on say it came down to showing up for every shift and telling the manager you want to stay, though some buildings keep fewer people after the holidays.', src: ['r-1xhqu51', 'r-1x8mr9d'], firstHand: true },
]
export const scams = [
  { text: '"If someone asks you to pay to get a job, that\'s a scam." (Federal Trade Commission)', src: ['ftc-jobs'] },
  { text: 'A "job" receiving packages at home and shipping them on is a scam: "Reshipping goods is never a real job."', src: ['ftc-jobs'] },
  { text: 'No real employer sends you a check to deposit and then asks you to send part of it back or buy gift cards.', src: ['ftc-jobs'] },
  { text: 'Check that a FedEx job is on careers.fedex.com before you send anything.', src: ['fx-board'] },
]

// 5. FedEx Freight: a separate company since June 1, 2026.
export const freight = {
  what: { text: 'FedEx Freight, the less-than-truckload carrier, became a separate public company on June 1, 2026. It hires through its own careers site, careers.fedexfreight.com, not careers.fedex.com.', src: ['sec-10k', 'fxf-areas'] },
  rows: [
    { role: 'City Driver', place: 'Round Rock, TX', pay: '$32.90/hr', src: ['fxf-city'] },
    { role: 'Driver Apprentice, city', place: 'Newark, NJ', pay: '$32.91/hr', src: ['fxf-apprentice'] },
    { role: 'Road Driver', place: 'Albany, GA', pay: '$0.7377 a mile, $32.20/hr off the road', src: ['fxf-road'] },
    { role: 'Freight Handler, part time', place: 'Memphis, TN', pay: '$21.78/hr, 5:00–10:30 PM', src: ['fxf-handler'] },
  ],
  asks: [
    { name: 'City driver', text: 'A Class A CDL with doubles/triples, hazmat and tank endorsements, and a year of experience in the last three years or FedEx Freight\'s Driver Development Course.', src: ['fxf-city'] },
    { name: 'Driver apprentice', text: 'A Class A CDL or a commercial learner\'s permit before you start; the program mixes driving, classroom and dock work.', src: ['fxf-apprentice', 'fxf-areas'] },
    { name: 'Freight handler', text: 'Age 18 or older; lifting dock plates of about 100 pounds and moving freight with forklifts and pallet jacks.', src: ['fxf-handler', 'fxf-areas'] },
  ],
}

// FAQ — visible on the page and mirrored in FAQPage JSON-LD.
export const faq = [
  {
    q: 'Do FedEx Ground drivers work for FedEx?',
    a: { text: 'Many do not. Drivers for FedEx\'s contracted service providers are employees of those companies, which hire them and set their pay, schedules and benefits. FedEx\'s own couriers apply on careers.fedex.com.', src: ['fx-sp-drivers', 'fx-sp-faq', 'fx-board'] },
  },
  {
    q: 'How much does a FedEx package handler make?',
    a: { text: 'Half of FedEx\'s package handler postings open to outside applicants on November 17, 2026 started at $18.35 an hour or more. A Charlottesville, VA posting pays $18.25 early morning and $17.75 afternoon.', src: ['fx-board', 'fx-ph'] },
  },
  {
    q: 'How old do you have to be to drive for FedEx?',
    a: { text: 'FedEx\'s courier postings ask for age 21, a high school diploma or GED and a clean driving record. Its tractor-trailer apprentice posting also asks for age 21, plus a commercial driver\'s license within 90 days.', src: ['fx-courier', 'fx-courier-rural', 'fx-tt'] },
  },
  {
    q: 'Does FedEx pay for school?',
    a: { text: 'FedEx employees can get up to $5,250 a calendar year for tuition after 90 continuous days of employment, including trade and technical school. Drivers for service providers are not FedEx employees.', src: ['fx-ph', 'fx-hiring', 'fx-sp-faq'] },
  },
  {
    q: 'Is FedEx Freight the same company as FedEx?',
    a: { text: 'Not since June 1, 2026, when FedEx Freight became a separate public company. Apply for its freight handler and CDL driver jobs on careers.fedexfreight.com.', src: ['sec-10k', 'fxf-areas'] },
  },
]

// ── Listings: the filters on the "Hiring now" block (lib/start/listingFilters.js) ──────────────────────────────────
// Seen's rows read 2026-11-17 (read-only PostgREST): 120 active rows whose company names FedEx, every one from Adzuna
// carrying FedEx's own posting text — "FedEx" 118 (package handlers / warehouse associates around Columbus, Chicago,
// Boise and Phoenix; FedEx Office retail; couriers; yard switchers), "EST FedEx Freight" 1 (City Driver, Lubbock),
// "FedEx Logistics" 1 (a forwarding office job, left out). NO active row names FedEx in its title, so Seen holds no
// service-provider ("FedEx Ground contractor") rows: there is no contractor chip, and the "who hires" row says plainly
// that the list is FedEx's own postings. No mechanic rows either, so no mechanic chip.
// Every position searches "fedex": api/jobs.js lists fedex as a company word, reads company=ilike.*fedex* and counts a
// company match as related, so the search returns FedEx's rows wherever they are; the title pattern then picks the chip.
// `employer` keeps FedEx's and FedEx Freight's own rows and nothing else (a contractor's company name never matches).
// Special assignments (for current employees) are excluded. FedEx's hourly postings ask no experience, so a plain
// title is entry level unless it says otherwise (known gap: FedEx Freight's "City Driver" needs a CDL and a year's
// experience but reads as entry, since levelOf has no CDL rule; yard switcher titles are listed after handler titles).
export const listings = {
  defaultRadius: '50',
  radii: ['25', '50', '100', '250'],
  levelMode: 'entryUnlessMarked',
  levelLabels: { any: 'Any level', entry: 'Entry level', experienced: 'Experienced' },
  levelWords: { entry: 'entry-level', experienced: 'experienced' },
  employer: '^\\s*(fedex|fedex express|fedex ground|fedex office|fedex freight|est fedex freight(?:,? inc\\.?)?|federal express(?: corporation)?)\\s*$',
  exclude: '\\b(special assign\\w*|spec\\.? assign\\w*|forwarding|brokerage|recruiter)\\b',
  positions: [
    { id: 'all', label: 'All FedEx jobs', noun: 'FedEx', mix: 'positions', queries: ['fedex'], seeAll: 'fedex' },
    { id: 'handler', label: 'Package handler', noun: 'FedEx package handler', queries: ['fedex'], match: 'package|handler|handling|warehouse|switcher|\\bph\\b', prefer: 'package|handler|handling|warehouse', seeAll: 'fedex package handler' },
    { id: 'driver', label: 'Courier and driver', noun: 'FedEx courier and driver', queries: ['fedex'], match: 'courier|driver', seeAll: 'fedex courier' },
    { id: 'retail', label: 'FedEx Office store', noun: 'FedEx Office store', queries: ['fedex'], match: 'retail|print|store|shipping and retail', seeAll: 'fedex retail' },
  ],
}

// ── The page's openable rows (components/start/Guide.tsx `Blocks` renders each block type) ─────────────────────────
export const menu = [
  {
    id: 'who-hires', title: 'FedEx or a service provider', summary: 'Who hires you, sets pay and pays benefits',
    blocks: [
      { type: 'text', entry: who.oneCompany },
      { type: 'cards', items: who.cards },
      { type: 'checklist', items: who.means },
      { type: 'callout', entry: who.network },
      { type: 'note', entry: who.listingNote },
      { type: 'heading', text: 'What drivers say' },
      { type: 'text', plain: 'What people who drive for service providers say. More than one account agrees on each of these.' },
      { type: 'notes', items: contractorSay },
    ],
  },
  {
    id: 'jobs', title: 'Jobs FedEx hires for', summary: 'Handlers, couriers, drivers, mechanics',
    blocks: [{ type: 'cards', items: roles }],
  },
  {
    id: 'pay', title: 'Pay FedEx states', summary: 'Starting rates on its own postings',
    blocks: [
      { type: 'table', caption: 'Pay stated on FedEx’s own postings', columns: [{ key: 'role', label: 'Role' }, { key: 'place', label: 'Where' }, { key: 'pay', label: 'Stated pay', num: true }], rows: payRows },
      { type: 'note', entry: payNote },
      { type: 'more', title: 'Benefits and tuition help', blocks: [{ type: 'notes', items: benefits }] },
    ],
  },
  {
    id: 'apply', title: 'How FedEx hires', summary: 'Apply, checks, interview, first weeks',
    blocks: [
      { type: 'cards', items: [{ name: 'FedEx Careers', aka: 'FedEx’s own job search', link: `${FX}/jobs`, body: apply.site }] },
      { type: 'steps', items: apply.steps },
      { type: 'checklist', items: apply.checks, cols: true },
      { type: 'heading', text: 'What handlers say' },
      { type: 'text', plain: 'What package handlers say about the first months. More than one account agrees on each of these.' },
      { type: 'notes', items: handlerSay },
      { type: 'notes', label: 'Scams', items: scams, icon: 'x', caution: true },
      { type: 'resumeLink', before: 'Before you apply, you can', label: 'check your résumé against a posting' },
    ],
  },
  {
    id: 'freight', title: 'FedEx Freight and CDL jobs', summary: 'A separate company now, with CDL training',
    blocks: [
      { type: 'text', entry: freight.what },
      { type: 'table', caption: 'Pay stated on FedEx Freight’s own postings', columns: [{ key: 'role', label: 'Role' }, { key: 'place', label: 'Where' }, { key: 'pay', label: 'Stated pay', num: true }], rows: freight.rows },
      { type: 'checklist', items: freight.asks },
      { type: 'link', before: 'New to trucking? Read', href: '/start/cdl', label: 'how to get a CDL and who pays for training' },
    ],
  },
  { id: 'questions', title: 'Common questions', summary: 'Ground drivers, pay, age, school, Freight', blocks: [{ type: 'faq', items: faq }] },
]

// ── Additional resources: every reference above, as plain grouped links (no numbers, closed by default) ────────────
export const resourcesSummary = 'FedEx careers, service providers, FedEx Freight'
export const resources = [
  { title: 'FedEx careers', items: [
    { key: 'fx-board', name: 'FedEx Careers job search' },
    { key: 'fx-hiring', name: 'Hiring process and tuition reimbursement' },
    { key: 'fx-area-ph', name: 'Package handler jobs' },
    { key: 'fx-area-driver', name: 'Driver jobs' },
    { key: 'fx-area-mx', name: 'Maintenance jobs' },
  ] },
  { title: 'FedEx postings we read', items: [
    { key: 'fx-ph', name: 'Package Handler, Charlottesville, VA' },
    { key: 'fx-mh', name: 'Material Handler, Reno, NV' },
    { key: 'fx-courier', name: 'Courier/DOT, Carlsbad, CA' },
    { key: 'fx-courier-rural', name: 'Courier, rural and residential, Pharr, TX' },
    { key: 'fx-tt', name: 'Tractor Trailer Driver apprentice, Atlanta, GA' },
    { key: 'fx-tech', name: 'Senior Vehicle Maintenance Technician, Chicago, IL' },
  ] },
  { title: 'Service providers', items: [
    { key: 'fx-sp-drivers', name: 'Driving for a FedEx service provider (FedEx)' },
    { key: 'fx-sp-faq', name: 'How service providers work: questions and answers (FedEx)' },
  ] },
  { title: 'FedEx Freight', items: [
    { key: 'fxf-areas', name: 'FedEx Freight careers' },
    { key: 'fxf-city', name: 'City Driver, Round Rock, TX' },
    { key: 'fxf-apprentice', name: 'Driver Apprentice, Newark, NJ' },
    { key: 'fxf-road', name: 'Road Driver, Albany, GA' },
    { key: 'fxf-handler', name: 'Freight Handler, Memphis, TN' },
  ] },
  { title: 'Public records and job scams', items: [
    { key: 'sec-10k', name: 'FedEx annual report, 2026 (SEC)' },
    { key: 'ftc-jobs', name: 'Job scams (Federal Trade Commission)' },
  ] },
  { title: 'Community discussions', items: [
    { key: 'r-1xpmu1u', name: 'Short package handler shifts' },
    { key: 'r-1wv5jli', name: 'Sent home before the scheduled end' },
    { key: 'r-1tw4p57', name: 'How many hours package handlers work' },
    { key: 'r-1xhqu51', name: 'Staying on after a seasonal job' },
    { key: 'r-1x8mr9d', name: 'From seasonal handler to driver' },
    { key: 'r-1wk0eot', name: 'Overtime for service provider drivers' },
    { key: 'r-1uq235m', name: 'A day-rate offer from a service provider' },
    { key: 'r-1udvpbu', name: 'Starting pay for a route driver' },
  ] },
]

/** Every fact on the page, in reading order: the hero, then each menu row. */
export function pageEntries() {
  return [guide.answer, ...tiles, ...blockEntries(menu)]
}
