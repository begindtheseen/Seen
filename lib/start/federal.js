// /start/federal — "Getting a federal job". The page renders from this module only, so every figure on it carries a
// source and an as-of date (lib/start/guides.test.mjs fails on a figure without one).
//
// THE ONLY SOURCE OF FACTS is the research file compiled 2026-11-17 (session scratchpad guides20/federal/research.md).
// Rules this module keeps:
//   • only items the research marked VERIFIED: OPM's own pages, pay tables and memos, the eCFR (read through its API),
//     the U.S. Code on govinfo, agency pages (TSA, Forest Service, Interior fire jobs, USPS), live USAJOBS postings
//     read 2026-11-17 (announcement numbers in `sources`), the FTC;
//   • pay is OPM's 2026 tables (1% raise, January 2026); a posting's pay is printed with its place, never as a
//     national figure;
//   • hiring conditions are stated with their dates and only as the official memos word them (EO 14356 of October 15,
//     2025 and OMB/OPM's November 5, 2025 guidance; OPM's July 30, 2026 staffing-plan guidance for FY 2027). The
//     FY 2026 "one hire per four departures" interim ratio, shutdown talk and the essay questions (litigated) are left
//     out;
//   • the Postal Service is described as the law describes it: its jobs are part of the civil service (39 U.S.C.
//     1001), but it hires under its own procedures on its own sites, not through USAJOBS;
//   • the clearance levels are named plainly (Top Secret, Secret and Confidential, EO 13526 section 1.2), highest first:
//     the calm-wording test strips "Secret and <word>" but not "Secret and Top Secret," before a comma;
//   • FIRST-HAND items (several accounts agreeing) only as `firstHand: true`, rendered as what people say;
//   • `listings = null`: Seen holds no reliable federal-agency listings (2026-11-17 read-only checks: no Veterans
//     Affairs, Forest Service or TSA rows; "Department of" rows are state agencies or two Adzuna Air Force rows), so
//     the page shows no listings block and the first row sends people to USAJOBS;
//   • no hype, no guarantees, no exclamation marks.
//
// Shape: `sources` (every reference behind the page, kept here and NEVER printed as citations — readers reach the
// links through the grouped "Additional resources" menu, `resources` below), entries `{ text, src, firstHand? }`,
// `listings` (null here) and the openable menu rows (`menu`, rendered by components/start/Guide.tsx). Pure data;
// relative imports only so `node --test` runs it as is.

import { blockEntries } from './entries.js'

/** @typedef {{ label: string, url: string, date: string, note?: string }} Source */

const USAJOBS = 'https://www.usajobs.gov/'

/** @type {Record<string, Source>} */
export const sources = {
  // Applying
  usajobs: { label: 'USAJOBS, the federal government\'s job site', url: USAJOBS, date: '2026-11-17' },
  'uj-paths': { label: 'USAJOBS: hiring paths (who each announcement is open to)', url: 'https://www.usajobs.gov/hiringpath/', date: '2026-11-17' },
  'uj-public': { label: 'USAJOBS: open to the public', url: 'https://www.usajobs.gov/hiringpath/public/', date: '2026-11-17' },
  'opm-2page': { label: 'OPM, Merit Hiring Plan resources: Agency guidance on the two-page limit on resume length (in force from September 27, 2025)', url: 'https://www.opm.gov/policy-data-oversight/hiring-information/merit-hiring-plan-resources/agency-guidance-on-the-two-page-limit-on-resume-length', date: '2026-11-17', note: 'read' },
  'opm-mhp': { label: 'White House Domestic Policy Council and OPM, Merit Hiring Plan (memo of May 29, 2025)', url: 'https://www.opm.gov/chcoc/latest-memos/merit-hiring-plan.pdf', date: '2025-05-29' },
  'opm-status': { label: 'OPM FAQ: Why have I not heard anything back after applying?', url: 'https://www.opm.gov/frequently-asked-questions/employment-faq/federal-hiring/why-have-i-not-heard-anything-back-after-applying-how-long-does-it-take-to-hear-from-an-agency-after-i-have-applied/', date: '2026-11-17', note: 'read' },
  'opm-tth': { label: 'OPM, Guidance on Time-to-Hire Under the Merit Hiring Plan (80-day standard)', url: 'https://www.opm.gov/chcoc/latest-memos/guidance-on-time-to-hire-under-the-merit-hiring-plan.pdf', date: '2026-11-17', note: 'read' },
  // Pay
  'opm-gs': { label: 'OPM: General Schedule overview (grades, steps, locality pay, entry grades)', url: 'https://www.opm.gov/policy-data-oversight/pay-leave/pay-systems/general-schedule/', date: '2026-11-17', note: 'read' },
  'opm-gs-2026': { label: 'OPM Salary Table 2026-GS, incorporating the 1% General Schedule increase, effective January 2026', url: 'https://www.opm.gov/policy-data-oversight/pay-leave/salaries-wages/salary-tables/26Tables/html/GS.aspx', date: '2026-01' },
  'opm-rus': { label: 'OPM Salary Table 2026-RUS, Rest of U.S. locality area (17.06%)', url: 'https://www.opm.gov/policy-data-oversight/pay-leave/salaries-wages/salary-tables/26Tables/html/RUS.aspx', date: '2026-01' },
  'opm-dcb': { label: 'OPM Salary Table 2026-DCB, Washington-Baltimore-Arlington locality area (33.94%)', url: 'https://www.opm.gov/policy-data-oversight/pay-leave/salaries-wages/salary-tables/26Tables/html/DCB.aspx', date: '2026-01' },
  'opm-sf': { label: 'OPM Salary Table 2026-SF, San Jose-San Francisco-Oakland locality area (46.34%)', url: 'https://www.opm.gov/policy-data-oversight/pay-leave/salaries-wages/salary-tables/26Tables/html/SF.aspx', date: '2026-01' },
  'opm-gw': { label: 'OPM Salary Table 2026-RUS (GW): wildland firefighters, special base rates, Rest of U.S.', url: 'https://www.opm.gov/policy-data-oversight/pay-leave/salaries-wages/salary-tables/26Tables/html/RUS%20(GW).aspx', date: '2026-01' },
  'cfr-531': { label: '5 CFR 531.405, waiting periods for within-grade (step) increases (eCFR)', url: 'https://www.ecfr.gov/current/title-5/section-531.405', date: '2026-11-13', note: 'eCFR as of' },
  'opm-quals': { label: 'OPM General Schedule qualification standards: group standards for clerical and administrative support, and administrative and management positions', url: 'https://www.opm.gov/policy-data-oversight/classification-qualifications/general-schedule-qualification-standards/', date: '2026-11-17', note: 'read' },
  'opm-fws': { label: 'OPM: Federal Wage System (hourly blue-collar pay)', url: 'https://www.opm.gov/policy-data-oversight/pay-leave/pay-systems/federal-wage-system/', date: '2026-11-17', note: 'read' },
  // Entry jobs
  'tsa-tso': { label: 'TSA careers: Transportation Security Officer (requirements and hiring steps)', url: 'https://tsa.gov/about/careers/tso', date: '2026-11-17', note: 'read' },
  'uj-tso': { label: 'USAJOBS posting: Transportation Security Officer, Omaha, NE (12979106-OMA-FT-PT, SV-D, $46,566–$57,412; accepting applications 2026-11-17)', url: 'https://www.usajobs.gov/job/871922400', date: '2026-11-17' },
  'uj-va': { label: 'USAJOBS posting: Housekeeping Aid, VA Honolulu (CBSW-13087268-27-OP, WG-2, $19.58–$22.88 an hour; open October 15 – November 16, 2026)', url: 'https://www.usajobs.gov/job/888901100', date: '2026-11-17' },
  'usc-3310': { label: '5 U.S.C. 3310, preference eligibles and examinations for guards, elevator operators, messengers and custodians (VA housekeeping aides excepted, Pub. L. 117-168, 2022)', url: 'https://www.govinfo.gov/content/pkg/USCODE-2023-title5/html/USCODE-2023-title5-partIII-subpartB-chap33-subchapI-sec3310.htm', date: '2026-11-17', note: 'read' },
  'uj-wf': { label: 'USAJOBS posting: Wildland Firefighter (Seasonal), U.S. Wildland Fire Service, Interior (WFS-27-13093654-DHA-YRG-TSB, GW 3–5, $21.14–$29.90 an hour; open October 20 – November 3, 2026)', url: 'https://www.usajobs.gov/job/889447000', date: '2026-11-17' },
  'fs-wf': { label: 'USDA Forest Service: Temporary Wildland Fire Opportunities, November 2026 (138 announcements, open October 30 – November 12, 2026)', url: 'https://www.fs.usda.gov/working-with-us/careers/recruitment-events/temporary-wildland-fire-opportunities-november-2026', date: '2026-11-17', note: 'read' },
  'doi-faq': { label: 'Interior wildland fire jobs: FAQs (updated May 2026)', url: 'https://www.firejobs.doi.gov/faq', date: '2026-05' },
  'fs-wct': { label: 'USDA Forest Service: Work Capacity Test brochure (pack test)', url: 'https://www.fs.usda.gov/sites/default/files/2023-03/Work-Capacity-Test-brochure.pdf', date: '2023-03' },
  'usps-apply': { label: 'USPS careers: How to apply (USPS Careers and eCareer)', url: 'https://about.usps.com/careers/how-to-apply/', date: '2026-11-17', note: 'read' },
  'usc-3328': { label: '5 U.S.C. 3328, Selective Service registration (a condition of appointment in an executive agency)', url: 'https://www.govinfo.gov/content/pkg/USCODE-2023-title5/html/USCODE-2023-title5-partIII-subpartB-chap33-subchapI-sec3328.htm', date: '2026-11-17', note: 'read' },
  'usc-1001': { label: '39 U.S.C. 1001, appointment of Postal Service officers and employees (postal career service)', url: 'https://www.govinfo.gov/content/pkg/USCODE-2023-title39/html/USCODE-2023-title39-partII-chap10-sec1001.htm', date: '2026-11-17', note: 'read' },
  // Students, veterans, disability
  'cfr-362': { label: '5 CFR part 362, Pathways Programs: Internship and Recent Graduates (eCFR)', url: 'https://www.ecfr.gov/current/title-5/part-362', date: '2026-11-13', note: 'eCFR as of' },
  'opm-pathways': { label: 'OPM: Students and recent graduates (Pathways)', url: 'https://www.opm.gov/policy-data-oversight/hiring-information/students-recent-graduates/', date: '2026-11-17', note: 'read' },
  'opm-early': { label: 'OPM news release: OPM launches effort to recruit the next generation of federal talent (Early Career Talent Network)', url: 'https://www.opm.gov/news/news-releases/opm-launches-effort-to-recruit-the-next-generation-of-federal-talent', date: '2026-11-17', note: 'read' },
  'opm-vets': { label: 'OPM FedsHireVets: veterans\' preference and special hiring authorities for veterans', url: 'https://www.opm.gov/fedshirevets/veteran-job-seekers/vets/', date: '2026-11-17', note: 'read' },
  'cfr-213': { label: '5 CFR 213.3102(u), Schedule A appointment of persons with disabilities (eCFR)', url: 'https://www.ecfr.gov/current/title-5/section-213.3102', date: '2026-11-13', note: 'eCFR as of' },
  'opm-scheda': { label: 'OPM: Disability employment, getting a job (Schedule A)', url: 'https://www.opm.gov/policy-data-oversight/disability-employment/getting-a-job/', date: '2026-11-17', note: 'read' },
  // Hiring rules now
  'eo-14356': { label: 'Executive Order 14356 of October 15, 2025, Ensuring Continued Accountability in Federal Hiring (Federal Register, 90 FR 48387, October 20, 2025)', url: 'https://www.govinfo.gov/content/pkg/FR-2025-10-20/html/2025-19614.htm', date: '2025-10-20' },
  'omb-eo14356': { label: 'OMB and OPM memo of November 5, 2025: Guidance on Executive Order 14356, Ensuring Continued Accountability in Federal Hiring', url: 'https://www.opm.gov/chcoc/latest-memos/guidance-on-executive-order-14356-ensuring-continued-accountability-in-federal-hiring.pdf', date: '2025-11-05' },
  'opm-asp': { label: 'OPM memo of July 30, 2026: Guidance on Annual Staffing Plans (FY 2027 hiring targets)', url: 'https://www.opm.gov/chcoc/latest-memos/guidance-on-annual-staffing-plans.pdf', date: '2026-07-30' },
  'cfr-11': { label: '5 CFR part 11, probationary and trial periods (Civil Service Rule XI, E.O. 14284 of April 24, 2025; section 11.5 in effect 90 days later; eCFR)', url: 'https://www.ecfr.gov/current/title-5/part-11', date: '2026-11-13', note: 'eCFR as of' },
  // Checks and scams
  'opm-sf86': { label: 'OPM Standard Form 86, Questionnaire for National Security Positions (revised November 2016)', url: 'https://www.opm.gov/forms/pdf_fill/sf86.pdf', date: '2016-11' },
  'eo-13526': { label: 'Executive Order 13526, Classified National Security Information, section 1.2 (National Archives)', url: 'https://www.archives.gov/isoo/policy-documents/cnsi-eo.html', date: '2009-12-29' },
  'ftc-jobs': { label: 'FTC consumer advice: Job scams (federal and postal jobs)', url: 'https://consumer.ftc.gov/articles/job-scams', date: '2023-03' },
  // First-hand discussions (archived copies read through the Arctic Shift archive, 2026-11-17)
  'r-rescinded': { label: 'r/usajobs: "FJO rescinded" (a final offer pulled days before the start date)', url: 'https://www.reddit.com/r/usajobs/comments/1xvrjqy/', date: '2026-11-14' },
  'r-rescind-often': { label: 'r/usajobs: "How often do Fed jobs get rescinded?"', url: 'https://www.reddit.com/r/usajobs/comments/1x569s7/', date: '2026-10-13' },
  'r-badtime': { label: 'r/usajobs: "Is right now still a bad time to get hired to a Fed Job?"', url: 'https://www.reddit.com/r/usajobs/comments/1x56917/', date: '2026-10-13' },
  'r-dol': { label: 'r/usajobs: "DOL Hiring Timeline" (applied August, started October 2026)', url: 'https://www.reddit.com/r/usajobs/comments/1x24nsn/', date: '2026-10-10' },
  'r-timeline': { label: 'r/usajobs: "Timeline" (announcement closed in July, tentative offer in October)', url: 'https://www.reddit.com/r/usajobs/comments/1x3i6ss/', date: '2026-10-11' },
  'r-wf-timeline': { label: 'r/WildlandFire: "How does the hiring process timeline work?"', url: 'https://www.reddit.com/r/WildlandFire/comments/1xvn9cd/', date: '2026-11-13' },
  'r-wf-hiring': { label: 'r/WildlandFire: "Hiring" (referred, no calls yet)', url: 'https://www.reddit.com/r/WildlandFire/comments/1xnw4cg/', date: '2026-11-04' },
  'r-wf-hearback': { label: 'r/WildlandFire: "How long after applying before you hear back from anyone?"', url: 'https://www.reddit.com/r/WildlandFire/comments/1xpoq5g/', date: '2026-11-06' },
}

export const guide = {
  path: '/start/federal',
  title: 'Getting a federal job',
  crumbLabel: 'Federal jobs',
  eyebrow: 'Guide',
  // The one-sentence answer under the h1 (the page's first screen).
  answer: { text: 'Federal jobs are posted on USAJOBS, and each announcement says who may apply, what experience counts and how you will be tested. Pay follows public tables, and many entry jobs take a high school diploma or some work experience instead of a degree.', src: ['usajobs', 'ftc-jobs', 'uj-paths', 'opm-mhp', 'opm-rus', 'opm-quals', 'tsa-tso'] },
  metaDescription: 'How to get a federal job: how USAJOBS works, the two-page résumé, General Schedule pay by city, Pathways for students and recent graduates, veterans\' preference, Schedule A, background checks, and federal jobs that need no degree.',
  asOf: '2026-11-17',
}

// The three readings in the hero: each restates a fact below, with the same references.
export const tiles = [
  { label: 'Starting pay at GS-5', value: '$40,736 a year', text: 'at step 1 in the catch-all Rest of U.S. pay area, 2026; $46,610 around Washington, D.C.', src: ['opm-rus', 'opm-dcb'] },
  { label: 'Résumé limit', value: '2 pages', text: 'on most federal announcements since September 27, 2025; a longer one is not considered', src: ['opm-2page'] },
  { label: 'Early-career goal', value: '33%', text: 'of new outside hires, OPM\'s goal for agencies in the year that began October 2026', src: ['opm-asp'] },
]

// 1. How applying works.
export const apply = {
  site: { text: 'Federal openings are listed on USAJOBS. The FTC says it is always free to apply for a federal job, and that paying a fee to get one is a scam.', src: ['usajobs', 'ftc-jobs'] },
  steps: [
    { step: 'Make a profile and a two-page résumé', text: 'USAJOBS has a résumé builder, and since September 27, 2025 it holds every résumé to two pages. OPM recommends uploading a PDF so the formatting and page count stay as you set them.', src: ['opm-2page'] },
    { step: 'Read who the job is open to', text: '"Open to the public" means any U.S. citizen or national can apply. Other announcements take only certain groups, such as current or former federal employees, students, recent graduates, veterans or military spouses.', src: ['uj-public', 'uj-paths'] },
    { step: 'Show every qualification it lists', text: 'For each job give the title and employer, the month and year you started and stopped, and your hours a week, and make your experience answer every required qualification in the announcement.', src: ['opm-2page'] },
    { step: 'Take the assessment', text: 'Every competitive hiring process must include at least one assessment beyond a questionnaire where you rate yourself, such as a written test, a work sample or simulation, or a structured interview. The announcement says which ones it uses.', src: ['opm-mhp', 'opm-asp'] },
    { step: 'Watch for four updates', text: 'Agencies are required to tell you when your application is received, when it is assessed, whether it is referred to the hiring official, and whether you are selected. OPM says you generally hear from the agency about 15 to 30 days after the announcement closes; if not, contact the agency named on it.', src: ['opm-status'] },
  ],
  tooLong: { text: 'If the only résumé you send is longer than two pages, you are not considered. Agencies outside the main federal hiring rules (title 5), and the courts and Congress, may accept a longer one only if their announcement says how to send it.', src: ['opm-2page'] },
  peopleSay: [
    { text: 'People who were hired describe months, not weeks: one went from applying to a first day in about two and a half months and called it quick; another waited three months after the announcement closed for a tentative offer, and their status on USAJOBS never changed.', src: ['r-dol', 'r-timeline'], firstHand: true },
  ],
}

// 2. Pay: the General Schedule, locality pay, hourly jobs.
export const pay = {
  how: { text: 'Most white-collar federal jobs are paid on the General Schedule (GS): 15 grades, each with 10 steps. Every 2026 rate includes a 1% raise from January 2026.', src: ['opm-gs', 'opm-gs-2026'] },
  locality: { text: 'Locality pay is built in for where the job is: 17.06% in the catch-all Rest of U.S. area, 33.94% around Washington, D.C., and 46.34% in the San Francisco Bay Area.', src: ['opm-rus', 'opm-dcb', 'opm-sf', 'opm-gs'] },
  rows: [
    { grade: 'GS-4', rus: '$36,409', dc: '$41,659', sf: '$45,516', src: ['opm-rus', 'opm-dcb', 'opm-sf'] },
    { grade: 'GS-5', rus: '$40,736', dc: '$46,610', sf: '$50,925', src: ['opm-rus', 'opm-dcb', 'opm-sf'] },
    { grade: 'GS-7', rus: '$50,460', dc: '$57,736', sf: '$63,081', src: ['opm-rus', 'opm-dcb', 'opm-sf'] },
    { grade: 'GS-9', rus: '$61,722', dc: '$70,623', sf: '$77,161', src: ['opm-rus', 'opm-dcb', 'opm-sf'] },
  ],
  steps: { text: 'Yearly pay at step 1, January 2026. With acceptable performance, steps 2 to 4 come after a year each, steps 5 to 7 after two years each, and steps 8 to 10 after three years each.', src: ['opm-rus', 'cfr-531'] },
  grades: [
    { name: 'GS-2', text: 'A high school diploma or equivalent, or 3 months of work experience.', src: ['opm-quals', 'opm-gs'] },
    { name: 'GS-3', text: 'A year of education after high school, or 6 months of work experience.', src: ['opm-quals'] },
    { name: 'GS-4', text: 'Two years of education after high school, or a year of work experience.', src: ['opm-quals'] },
    { name: 'GS-5', text: 'A bachelor\'s degree, or 3 years of experience with at least 1 at the GS-4 level.', src: ['opm-quals', 'opm-gs'] },
    { name: 'GS-7', text: 'A year of graduate school, superior grades in college, or a year of job-related experience at the GS-5 level.', src: ['opm-quals'] },
  ],
  gradesNote: { text: 'These are OPM\'s group rules for office support jobs (GS-2 to GS-4) and administrative jobs (GS-5 and GS-7). Other kinds of work have their own rules, and each announcement states the ones that apply.', src: ['opm-quals'] },
  hourly: { text: 'Trade, craft and labor jobs are paid by the hour under the Federal Wage System (WG grades): a VA housekeeping aid job in Honolulu was posted at $19.58 to $22.88 an hour in 2026.', src: ['opm-fws', 'uj-va'] },
}

// 3. Jobs that start without a degree (each from the agency's own page or a live posting).
export const entryJobs = [
  {
    name: 'Transportation Security Officer', aka: 'TSA', link: 'https://tsa.gov/about/careers/tso',
    body: { text: 'A U.S. citizen or national, 18 or older, with a high school diploma or GED, or a year of full-time security, aviation screening or X-ray work. Expect a computer test of X-ray image reading, a panel interview, a medical exam, a drug test and a background check, then a wait in a "Ready Pool" until an airport has an opening. Shifts can fall at odd hours.', src: ['tsa-tso', 'uj-tso'] },
    chips: [{ text: '$46,566–$57,412 a year in Omaha', src: ['uj-tso'] }, { text: 'Lifting up to 50 lb', src: ['tsa-tso'] }],
    src: ['tsa-tso', 'uj-tso'],
  },
  {
    name: 'Housekeeping aid', aka: 'Department of Veterans Affairs', link: null,
    body: { text: 'No education requirement and no set length of experience, though your résumé must show training or experience that fits the work. The work means walking, standing, stooping and pushing all shift, with cleaning machines that weigh over 50 pounds. A 2022 change in federal law took VA housekeeping aid jobs out of a rule that limits exams for custodian, guard, messenger and elevator operator jobs to preference-eligible veterans while any are available.', src: ['uj-va', 'usc-3310'] },
    chips: [{ text: '$19.58–$22.88 an hour in Honolulu', src: ['uj-va'] }],
    src: ['uj-va', 'usc-3310'],
  },
  {
    name: 'Wildland firefighter', aka: 'U.S. Wildland Fire Service and Forest Service', link: 'https://www.firejobs.doi.gov/faq',
    body: { text: 'The entry grade asks for 6 months of work experience or firefighter training, or a year of education after high school. Interior posts most of its seasonal fire jobs October through March, hazardous work starts at 18, and you must pass the pack test: 3 miles carrying 45 pounds in 45 minutes or less.', src: ['uj-wf', 'doi-faq', 'fs-wct'] },
    chips: [{ text: '$21.14–$29.90 an hour, seasonal', src: ['uj-wf', 'fs-wf'] }],
    src: ['uj-wf', 'doi-faq', 'fs-wct', 'fs-wf'],
  },
  {
    name: 'Clerk and office assistant', aka: 'GS-2 to GS-4',
    body: { text: 'Office support jobs start at GS-2 with a high school diploma or 3 months of work: $29,725 a year at step 1 in the Rest of U.S. area in 2026.', src: ['opm-quals', 'opm-rus'] },
    src: ['opm-quals', 'opm-rus'],
  },
]
export const fireNote = { text: 'Wildland firefighters are paid from their own higher table: GS-3 step 1 is $44,112 a year in the Rest of U.S. area in 2026, against $32,435 on the regular scale.', src: ['opm-gw', 'opm-rus'] }
export const firePeopleSay = [
  { text: 'People in wildland fire threads, including one who hires, say that once you have applied, calling or visiting the crews you want to work for matters, and that hiring managers favor applicants who reach out.', src: ['r-wf-timeline', 'r-wf-hiring', 'r-wf-hearback'], firstHand: true },
]
export const postal = { text: 'The Postal Service is separate. By law its jobs are part of the civil service, but it hires under its own procedures: every postal job is applied for on USPS Careers or eCareer, and the application and any exams are free.', src: ['usc-1001', 'usps-apply'] }

// 4. Paths for students, recent graduates, veterans and people with disabilities.
export const pathways = [
  { name: 'Internship Program', text: 'Paid federal jobs for students in high school, college, trade school or a career and technical program. After at least 480 hours and finishing school, an agency can move a U.S. citizen intern into a term or permanent job without a new competition, within 180 days of finishing.', src: ['cfr-362', 'opm-pathways'] },
  { name: 'Recent Graduates Program', text: 'Apply within 2 years of finishing a degree, certificate or career and technical program, or up to 6 years for veterans whose service got in the way. It is usually a year of training with a mentor, after which the agency can move U.S. citizens who do well into a term or permanent job without a new competition.', src: ['cfr-362'] },
  { name: 'Early Career Talent Network', text: 'OPM\'s EarlyCareers.gov lets you register interest in full-time early-career roles across agencies, in finance, human resources, engineering, project management and procurement.', src: ['opm-early'] },
  { name: 'U.S. Tech Force', text: 'OPM recruits software engineering, AI, data science and cybersecurity applicants as one pool, tests them, and gives agencies lists of qualified candidates to hire from.', src: ['opm-asp'] },
]
export const veterans = [
  { text: 'Preference gives eligible veterans an edge over many other applicants: 10 points for a service-connected disability or a Purple Heart, 5 for qualifying active-duty service such as a campaign.', src: ['opm-vets'] },
  { text: 'It does not promise a job, and it does not apply to promotions, transfers or other moves inside an agency.', src: ['opm-vets'] },
  { text: 'Send your DD-214, and an SF-15 with a VA letter for 10-point preference. Agencies can also hire some veterans without competition, through the Veterans Recruitment Appointment (VRA) or the authority for veterans with a service-connected disability rated 30% or more.', src: ['opm-vets'] },
]
export const scheduleA = [
  { text: 'Agencies can hire a qualified person with an intellectual, severe physical or psychiatric disability without the usual competition.', src: ['cfr-213', 'opm-scheda'] },
  { text: 'You need a letter showing the disability from a doctor or other licensed medical professional, a licensed vocational rehabilitation specialist, or an agency that provides disability benefits.', src: ['cfr-213', 'opm-scheda'] },
  { text: 'Send it with your résumé to the agency\'s Selective Placement Program Coordinator. Schedule A does not promise a job either.', src: ['opm-scheda'] },
]

// 5. Federal hiring right now (official wording, with dates).
export const now = {
  committee: { text: 'Since Executive Order 14356 of October 15, 2025, each agency\'s Strategic Hiring Committee must approve creating or filling every opening. Jobs tied to national security, immigration enforcement and public safety are outside that rule.', src: ['eo-14356', 'omb-eo14356'] },
  goalsIntro: { text: 'For the fiscal year that began October 2026, OPM asked every agency to plan its hiring around these goals.', src: ['opm-asp'] },
  goals: [
    { name: 'A third of new hires early in their careers', text: 'At least 33% of new outside hires should be recent graduates, interns, Pathways participants or other entry-level people.', src: ['opm-asp'] },
    { name: 'Shared lists', text: 'At least 60% of outside competitive hires should come from shared lists of applicants already tested and found qualified.', src: ['opm-asp'] },
    { name: 'An assessment for every hire', text: 'Every outside hire should be judged by a validated skills test or an OPM-approved alternative, such as a structured interview or work sample, not a self-rating questionnaire alone.', src: ['opm-asp'] },
    { name: 'Jobs outside Washington', text: 'Agencies should place new jobs outside the Washington, D.C. area wherever the work allows.', src: ['opm-asp'] },
  ],
  probation: { text: 'Your first year is a probationary period. In the excepted service the trial period is one year for preference-eligible veterans and two years for everyone else. Under a rule set by an executive order of April 2025 and in effect since July 2025, your job ends on the period\'s last day unless your agency certifies that keeping you advances the public interest.', src: ['cfr-11'] },
  peopleSay: [
    { text: 'People in these threads say not to give notice at your current job until you start: offers are described as rarely withdrawn, but it happens even after a final offer, in one case days before the start date because a hiring committee approval had been missed.', src: ['r-rescinded', 'r-rescind-often', 'r-badtime'], firstHand: true },
  ],
}

// 6. Background checks and clearances.
export const checks = [
  { text: 'Federal jobs check that you are suitable for federal work through a background investigation; the TSA, VA and wildland fire postings all say so. Some also require a drug test and a medical exam, as TSA and wildland fire jobs do.', src: ['uj-wf', 'uj-va', 'uj-tso', 'tsa-tso'] },
  { text: 'Men born after December 31, 1959 who were required to register with Selective Service must be registered to be hired by an executive agency.', src: ['usc-3328', 'uj-va', 'uj-wf'] },
  { text: 'Each announcement has a security clearance line. TSA\'s officer posting reads "Not Required".', src: ['uj-tso'] },
]
export const clearance = [
  { text: 'A clearance makes you eligible to see classified information. Its three levels are Top Secret, Secret and Confidential, set by how much damage to national security a leak could be expected to cause: "exceptionally grave damage", "serious damage" and "damage".', src: ['eo-13526'] },
  { text: 'For a job that needs one, the hiring office gives you the SF-86 questionnaire. Answer every question truthfully: hiding or falsifying information can cost you the job, bar you from federal work or lead to prosecution.', src: ['opm-sf86'] },
  { text: 'Investigators may contact your current employer, and a security freeze on your credit report can stop the investigation from being completed, so the form asks you to lift it. Once cleared, you may stay under continuous evaluation.', src: ['opm-sf86'] },
]

// 7. Watch out.
export const mistakes = [
  { lead: 'Anyone who charges for a federal job', text: 'The FTC: "Honest employers, including the federal government, will never ask you to pay to get a job." Information about federal and postal openings is free, and so is applying.', src: ['ftc-jobs'] },
  { lead: 'Ads that promise a federal or postal job', text: 'The FTC says never to respond to them. Postal Service applications and exams are free; report sites that charge to the Postal Inspection Service.', src: ['ftc-jobs', 'usps-apply'] },
  { lead: 'A résumé over two pages', text: 'If it is the only one you send, you are out before anyone reads it.', src: ['opm-2page'] },
  { lead: 'Counting on the self-rating questionnaire', text: 'Except for seasonal jobs and GS-1 to GS-4, agencies are no longer to rank applicants by the questions where you rate yourself; those answers may only decide whether you meet the minimum, and the ranking comes from another assessment.', src: ['opm-mhp'] },
]

// FAQ — visible on the page and mirrored in FAQPage JSON-LD (each answer at most three sentences).
export const faq = [
  {
    q: 'Do I need a degree to get a federal job?',
    a: { text: 'Not for many jobs. Office support jobs start at GS-2 with a high school diploma or 3 months of work, and GS-5 takes a bachelor\'s degree or 3 years of experience. TSA officers, VA housekeeping aids and seasonal wildland firefighters can start without a degree.', src: ['opm-quals', 'tsa-tso', 'uj-va', 'uj-wf'] },
  },
  {
    q: 'How long does federal hiring take?',
    a: { text: 'OPM\'s goal for agencies is 80 days from an approved opening to your first day. It says you usually hear from the agency 15 to 30 days after the announcement closes.', src: ['opm-tth', 'opm-status'] },
  },
  {
    q: 'Can my federal résumé be longer than two pages?',
    a: { text: 'Not for most announcements: since September 27, 2025 USAJOBS limits résumés to two pages. If the only résumé you send is longer, you are not considered, unless the announcement says it accepts a longer one.', src: ['opm-2page'] },
  },
  {
    q: 'What does a GS-5 job pay?',
    a: { text: '$40,736 a year at step 1 in the catch-all Rest of U.S. pay area in 2026, and $46,610 around Washington, D.C.', src: ['opm-rus', 'opm-dcb'] },
  },
  {
    q: 'Do veterans get federal jobs first?',
    a: { text: 'Veterans\' preference gives eligible veterans an edge, adding 5 or 10 points, but it does not promise a job. It does not apply to promotions or transfers inside an agency.', src: ['opm-vets'] },
  },
  {
    q: 'Is the Postal Service hired through USAJOBS?',
    a: { text: 'No. Postal jobs are part of the civil service, but the Postal Service hires under its own procedures on USPS Careers and eCareer, and applying is free.', src: ['usc-1001', 'usps-apply'] },
  },
]

// ── Listings: none. Seen holds no reliable federal-agency listings (read-only checks 2026-11-17: no Veterans Affairs,
// Forest Service or TSA rows; "Department of" rows are state agencies plus two Adzuna Air Force rows), so the template
// shows no "Hiring now" block; the first row sends people to USAJOBS.
export const listings = null

// ── The page's openable rows (components/start/Guide.tsx `Blocks` renders each block type) ─────────────────────────
export const menu = [
  {
    id: 'apply', title: 'How applying works', summary: 'USAJOBS, the résumé, who may apply',
    blocks: [
      { type: 'cards', items: [{ name: 'USAJOBS', aka: 'The federal government\'s job site', link: USAJOBS, body: apply.site, src: ['usajobs'] }] },
      { type: 'steps', items: apply.steps },
      { type: 'callout', entry: apply.tooLong },
      { type: 'more', title: 'What people who were hired say', blocks: [
        { type: 'text', plain: 'More than one account agrees on this.' },
        { type: 'notes', items: apply.peopleSay },
      ] },
      { type: 'resumeLink', before: 'Before you apply, you can', label: 'check your résumé against a posting' },
    ],
  },
  {
    id: 'pay', title: 'Pay: grades, steps and your city', summary: 'The GS scale, locality pay, hourly jobs',
    blocks: [
      { type: 'text', entry: pay.how },
      { type: 'text', entry: pay.locality },
      { type: 'table', caption: 'Yearly General Schedule pay at the first step in three locality areas', columns: [{ key: 'grade', label: 'Grade' }, { key: 'rus', label: 'Rest of U.S.', num: true }, { key: 'dc', label: 'Washington, D.C.', num: true }, { key: 'sf', label: 'San Francisco Bay Area', num: true }], rows: pay.rows },
      { type: 'note', entry: pay.steps },
      { type: 'more', title: 'Which grade you qualify for', blocks: [
        { type: 'checklist', items: pay.grades },
        { type: 'text', entry: pay.gradesNote },
      ] },
      { type: 'text', entry: pay.hourly },
    ],
  },
  {
    id: 'no-degree', title: 'Jobs that start without a degree', summary: 'TSA, VA, wildland fire, office jobs',
    blocks: [
      { type: 'cards', items: entryJobs },
      { type: 'note', entry: fireNote },
      { type: 'more', title: 'What seasonal firefighters say', blocks: [
        { type: 'text', plain: 'More than one account agrees on this.' },
        { type: 'notes', items: firePeopleSay },
      ] },
      { type: 'callout', entry: postal },
    ],
  },
  {
    id: 'paths', title: 'Students, graduates, veterans', summary: 'Pathways, veterans\' preference, Schedule A',
    blocks: [
      { type: 'heading', text: 'Pathways and early careers' },
      { type: 'checklist', items: pathways },
      { type: 'heading', text: 'Veterans\' preference' },
      { type: 'notes', items: veterans },
      { type: 'heading', text: 'Schedule A, for people with disabilities' },
      { type: 'notes', items: scheduleA },
    ],
  },
  {
    id: 'right-now', title: 'What changed in federal hiring', summary: 'Approvals, hiring goals and probation',
    blocks: [
      { type: 'text', entry: now.committee },
      { type: 'heading', text: 'OPM\'s hiring goals for agencies' },
      { type: 'text', entry: now.goalsIntro },
      { type: 'checklist', items: now.goals, cols: true },
      { type: 'callout', entry: now.probation },
      { type: 'more', title: 'What people say about offers', blocks: [
        { type: 'text', plain: 'Several accounts agree on this.' },
        { type: 'notes', items: now.peopleSay },
      ] },
    ],
  },
  {
    id: 'checks', title: 'Background checks and clearances', summary: 'What every job checks, and clearances',
    blocks: [
      { type: 'notes', items: checks },
      { type: 'heading', text: 'What a clearance is' },
      { type: 'notes', items: clearance },
    ],
  },
  {
    id: 'watch-out', title: 'Watch out', icon: 'caution', summary: 'Fees, fake offers, résumé traps',
    blocks: [{ type: 'disclosures', items: mistakes }],
  },
  { id: 'questions', title: 'Common questions', summary: 'Degrees, timing, résumés, pay, veterans', blocks: [{ type: 'faq', items: faq }] },
]

// ── Additional resources: every reference above, as plain grouped links (no numbers, closed by default) ────────────
export const resourcesSummary = 'USAJOBS, pay tables, hiring rules, programs'
export const resources = [
  { title: 'Applying', items: [
    { key: 'usajobs', name: 'USAJOBS' },
    { key: 'uj-paths', name: 'Hiring paths on USAJOBS' },
    { key: 'uj-public', name: 'Jobs open to the public' },
    { key: 'opm-2page', name: 'The two-page résumé limit (OPM)' },
    { key: 'opm-mhp', name: 'Merit Hiring Plan (OPM)' },
    { key: 'opm-status', name: 'When you hear back after applying (OPM)' },
    { key: 'opm-tth', name: 'Time-to-hire standard (OPM)' },
  ] },
  { title: 'Pay tables and grades', items: [
    { key: 'opm-gs', name: 'How the General Schedule works (OPM)' },
    { key: 'opm-gs-2026', name: 'General Schedule base pay table' },
    { key: 'opm-rus', name: 'Pay table: Rest of U.S.' },
    { key: 'opm-dcb', name: 'Pay table: Washington-Baltimore-Arlington' },
    { key: 'opm-sf', name: 'Pay table: San Jose-San Francisco-Oakland' },
    { key: 'opm-gw', name: 'Wildland firefighter pay table' },
    { key: 'cfr-531', name: 'Waiting periods for step increases (eCFR)' },
    { key: 'opm-quals', name: 'Qualification standards (OPM)' },
    { key: 'opm-fws', name: 'Federal Wage System (OPM)' },
  ] },
  { title: 'Entry jobs', items: [
    { key: 'tsa-tso', name: 'Transportation Security Officer (TSA)' },
    { key: 'uj-tso', name: 'A TSA officer posting in Omaha' },
    { key: 'uj-va', name: 'A VA housekeeping aid posting in Honolulu' },
    { key: 'usc-3310', name: 'Custodian and guard jobs reserved for veterans (U.S. Code)' },
    { key: 'uj-wf', name: 'A seasonal wildland firefighter posting' },
    { key: 'fs-wf', name: 'Forest Service temporary fire jobs' },
    { key: 'doi-faq', name: 'Interior wildland fire jobs FAQ' },
    { key: 'fs-wct', name: 'The wildland fire pack test (Forest Service)' },
    { key: 'usps-apply', name: 'How to apply to the Postal Service' },
    { key: 'usc-1001', name: 'The postal career service (U.S. Code)' },
  ] },
  { title: 'Students, veterans and disability', items: [
    { key: 'cfr-362', name: 'Pathways Programs rules (eCFR)' },
    { key: 'opm-pathways', name: 'Students and recent graduates (OPM)' },
    { key: 'opm-early', name: 'Early Career Talent Network (OPM)' },
    { key: 'opm-vets', name: 'Veterans\' preference (OPM FedsHireVets)' },
    { key: 'cfr-213', name: 'Schedule A rule (eCFR)' },
    { key: 'opm-scheda', name: 'Getting a job with a disability (OPM)' },
  ] },
  { title: 'Hiring rules now', items: [
    { key: 'eo-14356', name: 'Executive Order 14356 (Federal Register)' },
    { key: 'omb-eo14356', name: 'Strategic Hiring Committees guidance (OMB and OPM)' },
    { key: 'opm-asp', name: 'Annual staffing plans and hiring goals (OPM)' },
    { key: 'cfr-11', name: 'Probationary and trial periods (eCFR)' },
  ] },
  { title: 'Checks and scams', items: [
    { key: 'usc-3328', name: 'Selective Service registration (U.S. Code)' },
    { key: 'opm-sf86', name: 'Questionnaire for national security positions, SF-86 (OPM)' },
    { key: 'eo-13526', name: 'Classified information levels (National Archives)' },
    { key: 'ftc-jobs', name: 'Job scams (FTC)' },
  ] },
  { title: 'Community discussions', items: [
    { key: 'r-rescinded', name: 'A final offer pulled before the start date' },
    { key: 'r-rescind-often', name: 'How often federal offers are withdrawn' },
    { key: 'r-badtime', name: 'Is now a good time to take a federal job' },
    { key: 'r-dol', name: 'A Labor Department hiring timeline' },
    { key: 'r-timeline', name: 'From closing date to offer' },
    { key: 'r-wf-timeline', name: 'How wildland fire hiring works' },
    { key: 'r-wf-hiring', name: 'Referred for fire jobs, no calls yet' },
    { key: 'r-wf-hearback', name: 'Hearing back on a fire application' },
  ] },
]

/** Every fact on the page, in reading order: the hero, then each menu row. */
export function pageEntries() {
  return [guide.answer, ...tiles, ...blockEntries(menu)]
}
