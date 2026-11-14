// /start/tesla — "Getting hired at Tesla". The page renders from this module only, so every figure on it carries a
// source and an as-of date (lib/start/guides.test.mjs fails on a figure without one).
//
// THE ONLY SOURCE OF FACTS is the research file compiled 2026-11-14 (session scratchpad research/tesla.md).
// Rules this module keeps:
//   • only items the research marked VERIFIED: Tesla's own posting text, Tesla's SEC filings, Tesla's own injury
//     filings with OSHA, a partner school's page, the FTC;
//   • tesla.com answers servers with 403, so Tesla's posting text was read through a job board's mirror of the full
//     posting (2026-11-14; every posting below re-read in full on 2026-11-14 by the fact-check). Only Tesla's own
//     "Expected Compensation" line is printed — never the board's pay field, which is the board's estimate on some
//     rows (Giga Texas / Giga Nevada: no pay stated, none shown). Tesla's search page cannot be read from a server, so
//     no query parameter is assumed: every posting link opens the plain search page and its name says so;
//   • the injury comparison is the federal survey's published rate (BLS SOII, NAICS 336110, 2024). An earlier draft
//     pooled the OSHA filers coded 336110, but Tesla's own plants were 84% (2024) and 64% (2025) of that pool's hours,
//     so it compared Tesla mostly with itself;
//   • FIRST-HAND items (several accounts agreeing) only as `firstHand: true`, rendered as what people say;
//   • nothing UNVERIFIED or CONFLICTING: no drug-test policy, no Texas / Nevada / Buffalo production pay, no MDP pay,
//     no START pass mark or school cost, no START Semi length, no BBB report, no board pay estimates;
//   • owner brief 2026-11-14: injury rates only from Tesla's own OSHA filings, stated calmly with the year; no
//     pending lawsuits; nothing about Elon Musk or the stock price;
//   • `listings = null`: Tesla's careers site refuses servers and Seen holds no reliable Tesla listing source, so the
//     page shows no listings block and sends people to Tesla's own site (the "How to apply" row).
//   • no hype, no guarantees, no exclamation marks.
//
// Shape: `sources` (every reference behind the page, kept here and NEVER printed as citations — readers reach the
// links through the grouped "Additional resources" menu, `resources` below), entries `{ text, src, firstHand? }`,
// `listings` (null here) and the openable menu rows (`menu`, rendered by components/start/Guide.tsx). Pure data;
// relative imports only so `node --test` runs it as is.

import { blockEntries } from './entries.js'

/** @typedef {{ label: string, url: string, date: string, note?: string }} Source */

const SEARCH = 'https://www.tesla.com/careers/search/'
const ON_SEARCH = 'Tesla careers search page (search the title there; tesla.com refuses servers, checked 2026-11-14).'

/** @type {Record<string, Source>} */
export const sources = {
  'tesla-careers': {
    label: 'Tesla careers, job search (tesla.com answers servers with 403; checked 2026-11-14)',
    url: SEARCH,
    date: '2026-11-14', note: 'checked',
  },
  // Tesla's own posting text (the full posting incl. "Expected Compensation"), read 2026-11-14 through a job board's
  // mirror because tesla.com refuses servers. Each link opens Tesla's own careers search for that role.
  'post-pa': {
    label: 'Tesla postings, Production Associate: Fremont CA Megapack (posted 2026-11-05), Castings (2026-11-09) and Model 3 Body in White (2026-08-25); Austin TX General Assembly Model Y (2026-05-28) and Cybercab Body (2026-10-16); Sparks NV LFP Cell Manufacturing (2026-11-03). Tesla\'s posting text, read via a job-board mirror. Link: ' + ON_SEARCH,
    url: SEARCH,
    date: '2026-11-14', note: 'read',
  },
  'post-mh': {
    label: 'Tesla postings, Material Handler: Pleasanton CA (2026-10-26), Riverside CA Energy (2026-11-11), Recycling Operations, Palo Alto CA (2026-08-27), Seasonal Material Handler, Lathrop CA (2026-11-02). Tesla\'s posting text, read via a job-board mirror. Link: ' + ON_SEARCH,
    url: SEARCH,
    date: '2026-11-14', note: 'read',
  },
  'post-svc': {
    label: 'Tesla postings, Service Technician: Seattle WA (2026-06-08), Mobile Service Technician Fife WA (2026-06-24), Buffalo NY (2026-07-16), Englewood CO (2026-10-23). Tesla\'s posting text, read via a job-board mirror. Link: ' + ON_SEARCH,
    url: SEARCH,
    date: '2026-11-14', note: 'read',
  },
  'post-start': {
    label: 'Tesla postings, START Service Technician (Winter 2027), Shoreline WA (2026-11-04), and START Optimus Service Technician (Winter 2027), Fremont CA (2026-08-28). Tesla\'s posting text, read via a job-board mirror. Link: ' + ON_SEARCH,
    url: SEARCH,
    date: '2026-11-14', note: 'read',
  },
  'post-advisor': {
    label: 'Tesla postings, Tesla Advisor: Sales, Upland CA (2026-11-09); Delivery, Gilroy CA (2026-10-30). Tesla\'s posting text, read via a job-board mirror. Link: ' + ON_SEARCH,
    url: SEARCH,
    date: '2026-11-14', note: 'read',
  },
  'post-energy': {
    label: 'Tesla postings, Field Service Technician, Residential Energy Service, Aurora CO (2026-09-21); Commercial, Tacoma WA and Colorado Springs CO; Solar Maintenance Technician, Aurora CO; Installer, Residential Energy Operations, Riverside CA (title only). Tesla\'s posting text, read via a job-board mirror. Link: ' + ON_SEARCH,
    url: SEARCH,
    date: '2026-11-14', note: 'read',
  },
  'sec-10k': {
    label: 'Tesla, Inc. Form 10-K for fiscal year 2025 (SEC EDGAR)',
    url: 'https://www.sec.gov/Archives/edgar/data/1318605/000162828026003952/tsla-20251231.htm',
    date: '2026-01-29', note: 'filed',
  },
  'osha-ita': {
    label: 'OSHA, Establishment-Specific Injury and Illness Data (Form 300A; Tesla establishments, calendar years 2024 and 2025)',
    url: 'https://www.osha.gov/Establishment-Specific-Injury-and-Illness-Data',
    date: '2026-11-14', note: 'read',
  },
  'bls-soii': {
    label: 'U.S. Bureau of Labor Statistics, Survey of Occupational Injuries and Illnesses: total recordable cases per 100 full-time workers, automobile and light duty motor vehicle manufacturing (NAICS 336110), private industry, 2024',
    url: 'https://data.bls.gov/timeseries/ISUMFG33611031100',
    date: '2026-11-14', note: 'read',
  },
  'mdp-flyer': {
    label: 'Tesla, 2026 Manufacturing Development Program flyer and Q&A (Giga Texas; hosted by Austin ISD)',
    url: 'https://anderson.austinschools.org/sites/anderson.austinschools.org/files/inline-files/2026%20MDP%20Flyer%20and%20QA%20Copy%20-%20Copy%20Anderson%20High%20School%20.pdf',
    date: '2025-10-01', note: 'created',
  },
  'tstc-start': {
    label: 'Texas State Technical College, Tesla START program page',
    url: 'https://www.tstc.edu/workforce/tesla-start/',
    date: '2026-11-14', note: 'read',
  },
  'tstc-grads': {
    label: 'Texas State Technical College, "TSTC honors six graduates of Tesla START program"',
    url: 'https://www.tstc.edu/blog/2026/03/26/tstc-honors-six-graduates-of-tesla-start-program/',
    date: '2026-03-26', note: 'published',
  },
  'shoreline-start': {
    label: 'Shoreline Community College, Tesla START certificate page',
    url: 'https://www.shoreline.edu/programs/automotive/tesla-certificate.aspx',
    date: '2026-11-14', note: 'read',
  },
  'ftc-text': {
    label: 'Federal Trade Commission consumer alert, "That job offer text is probably a scam"',
    url: 'https://www.consumer.ftc.gov/consumer-alerts/2026/04/job-offer-text-probably-scam',
    date: '2026-04-30', note: 'published',
  },
  // First-hand accounts (r/TeslaLounge). Used only where several accounts agree, and rendered as what people say.
  'r-1j1iz62': { label: 'r/TeslaLounge, Tesla Advisor interview thread', url: 'https://www.reddit.com/r/TeslaLounge/comments/1j1iz62/', date: '2025-03', note: 'thread' },
  'r-1j00z84': { label: 'r/TeslaLounge, "Tesla Job Interview - Advice Please"', url: 'https://www.reddit.com/r/TeslaLounge/comments/1j00z84/', date: '2025-02-28', note: 'thread' },
  'r-1o8inz9': { label: 'r/TeslaLounge, seasonal advisor group interview thread', url: 'https://www.reddit.com/r/TeslaLounge/comments/1o8inz9/', date: '2025-10', note: 'thread' },
  'r-1tcebxb': { label: 'r/TeslaLounge, START Pathway info session thread', url: 'https://www.reddit.com/r/TeslaLounge/comments/1tcebxb/', date: '2026-05', note: 'thread' },
  'r-1wgh7yi': { label: 'r/TeslaLounge, "Overqualified for a Tesla Production Associate role, or a good way to get into the company"', url: 'https://www.reddit.com/r/TeslaLounge/comments/1wgh7yi/', date: '2026-09-14', note: 'thread' },
}

export const guide = {
  path: '/start/tesla',
  title: 'Getting hired at Tesla',
  crumbLabel: 'Tesla',
  eyebrow: 'Guide',
  // The one-sentence answer under the h1 (no figure: the figures live in the tiles).
  answer: { text: 'Tesla\'s production associate and material handler postings ask for no degree or experience, but the work is physical, on shifts that can run long and fall on nights and weekends. Service technician jobs pay more and mean diagnosing and repairing cars, which Tesla\'s paid START program trains people with some automotive background to do.', src: ['post-pa', 'post-mh', 'post-svc', 'post-start'] },
  metaDescription: 'How people without a degree get hired at Tesla: production, warehouse, service, delivery and energy jobs, what the postings ask for, the pay Tesla states, Tesla START, the big plants, injury rates and how to apply.',
  asOf: '2026-11-14',
}

// The three readings in the hero: each restates a fact below, with the same references.
export const tiles = [
  { label: 'Production associate pay', value: '$25.76/hr', text: 'plus cash and stock awards, on Tesla\'s Fremont postings in November 2026. Texas and Nevada postings state no pay.', src: ['post-pa'] },
  { label: 'Degree or experience asked', value: '0 of 6', text: 'Production Associate postings read in full in November 2026 ask for either', src: ['post-pa'] },
  { label: 'Tesla START', value: '16 weeks', text: 'paid service-technician training, $28.50/hr (Shoreline, WA, Winter 2027 cohort)', src: ['post-start'] },
]

// 1. The jobs people without degrees get, by family (Tesla's own titles).
export const roles = [
  {
    name: 'Production associate', aka: 'Fremont, Austin, Sparks',
    body: { text: 'Assembles vehicles and energy products, operating equipment under supervision. Postings in Fremont (Megapack, Castings), Austin (Model Y, Cybercab) and Sparks (battery cells).', src: ['post-pa'] },
    chips: [{ text: '$25.76/hr in Fremont', src: ['post-pa'] }, { text: 'No degree or experience listed', src: ['post-pa'] }],
  },
  {
    name: 'Material handler', aka: 'Warehouse and logistics',
    body: { text: 'Moves parts and material. Experience is "preferred but not required", and the Pleasanton posting says "Tesla will provide forklift training & certification".', src: ['post-mh'] },
    chips: [{ text: '$21.00–$25.76/hr in California', src: ['post-mh'] }],
  },
  {
    name: 'Service technician', aka: 'Service centers, mobile service',
    body: { text: 'Diagnoses and repairs Tesla vehicles, at service centers or as a mobile service technician. The postings ask for a driver\'s license and basic computer skills, and prefer a Section 609 refrigerant certification; no degree or years are stated.', src: ['post-svc'] },
    chips: [{ text: 'Tech I from $27.45/hr in Washington', src: ['post-svc'] }, { text: 'Trained through START', src: ['post-start'] }],
  },
  {
    name: 'Tesla Advisor', aka: 'Sales and delivery',
    body: { text: 'Sells cars or hands them over to buyers. The sales posting asks for a year or more of customer service or sales, evenings, weekends and holidays.', src: ['post-advisor'] },
    chips: [{ text: '$20.44–$36.45/hr in Upland, CA', src: ['post-advisor'] }],
  },
  {
    name: 'Energy field technician', aka: 'Solar and home batteries',
    body: { text: 'Energy field jobs posted include field service technician, solar maintenance technician and installer. Residential service work means heights, heat and cold, and travel for up to 2 weeks at a time. Solar and battery experience is "preferred but not required", but the posting also asks for skill installing inverters and home batteries and knowledge of the electrical codes for solar.', src: ['post-energy'] },
    chips: [{ text: 'Tech I $20.41–$30.62/hr in Aurora, CO', src: ['post-energy'] }],
  },
  {
    name: 'Engineering', aka: null,
    body: { text: 'Tesla\'s annual report names an Engineering Development Program and a Manufacturing Development Program alongside apprenticeships and START training.', src: ['sec-10k'] },
    chips: [],
  },
]

// 2. What the postings ask for.
export const asks = {
  intro: { text: 'What Tesla\'s own entry postings asked for in November 2026.', src: ['post-pa', 'post-mh', 'post-svc', 'post-advisor'] },
  items: [
    { name: 'No degree, no experience for production', text: 'Production Associate postings ask for a "demonstrated ability to learn new skills and adapt to new work environments".', src: ['post-pa'] },
    { name: 'English, written and spoken', text: '"Must have command of the English language, both written and verbal."', src: ['post-pa'] },
    { name: 'Any shift', text: 'Days, nights, overnight and weekends "as needed as well as potential overtime".', src: ['post-pa'] },
    { name: 'Physical work up to 12 hours a day', text: 'Lifting up to 35 lbs on Fremont and Austin production postings, 50 lbs at the Sparks cell plant and for material handlers, 60 lbs for START.', src: ['post-pa', 'post-mh', 'post-start'] },
    { name: 'Keep pace on the line', text: 'Fasten bolts "within required cycle time" during new hire training and after it.', src: ['post-pa'] },
    { name: 'A driver\'s license', text: 'For service, mobile service, START, advisor and energy jobs.', src: ['post-svc', 'post-start', 'post-advisor', 'post-energy'] },
    { name: 'A background check and E-Verify', text: 'Tesla\'s Giga Texas program flyer says people it hires must "successfully pass a comprehensive background check"; a partner college notes "Tesla participates in the E-Verify Program".', src: ['mdp-flyer', 'tstc-start'] },
    { name: 'A sales license for sales advisors', text: 'In CA, CO, HI, ID, MD, MS, NV, NC, PA, TN, UT, VA and DC the sales posting requires "a Motor Vehicle Salesperson License issued by the State Department of Motor Vehicles".', src: ['post-advisor'] },
  ],
  gear: { text: 'Production work can mean overhead work, ladders and scaffolding, and full-face respirators; the Sparks cell plant adds a full gown, shoe covers, face mask and hair net for up to 12 hours a day. The Austin postings ask associates to "wear motion capture equipment while working".', src: ['post-pa'] },
}

// Shifts as the postings state them.
export const shifts = [
  { site: 'Fremont, Megapack', shift: '6:00 AM–2:30 PM, Monday–Friday', src: ['post-pa'] },
  { site: 'Fremont, Castings', shift: '5:00 PM–5:00 AM, a two-week rotation that includes weekends', src: ['post-pa'] },
  { site: 'Sparks, battery cells', shift: '12-hour shifts, e.g. 6:00 AM–6:00 PM Sunday, Monday, Tuesday and every other Wednesday', src: ['post-pa'] },
]
export const shiftsNote = { text: 'Every production posting adds possible overtime. The Sparks posting lists free shuttles from Reno, Sparks, Carson City, Fernley, Fallon, Dayton and other nearby towns.', src: ['post-pa'] }

// 3. Pay Tesla states on its own postings (the "Expected Compensation" line), by role.
export const payRows = [
  { role: 'Production Associate', place: 'Fremont, CA', pay: '$25.76/hr + cash and stock awards', src: ['post-pa'] },
  { role: 'Material Handler', place: 'Pleasanton, CA', pay: '$25.76/hr + cash and stock awards', src: ['post-mh'] },
  { role: 'Material Handler, Energy', place: 'Riverside, CA', pay: '$23.46/hr + cash and stock awards', src: ['post-mh'] },
  { role: 'Material Handler, Recycling Operations', place: 'Palo Alto, CA', pay: '$21.00–$22.50/hr + cash and stock awards', src: ['post-mh'] },
  { role: 'Seasonal Material Handler', place: 'Lathrop, CA', pay: '$23.46/hr', src: ['post-mh'] },
  { role: 'Service Technician I / II / III', place: 'Seattle, WA', pay: '$28.98–$32.30 / $33.39–$36.91 / $36.66–$42.60 an hour', src: ['post-svc'] },
  { role: 'Mobile Service Technician I / II / III', place: 'Fife, WA', pay: '$27.45–$30.60 / $31.64–$34.96 / $34.73–$40.36 an hour', src: ['post-svc'] },
  { role: 'START Service Technician', place: 'Shoreline, WA', pay: '$28.50/hr', src: ['post-start'] },
  { role: 'START Optimus Service Technician', place: 'Fremont, CA', pay: '$30.00/hr', src: ['post-start'] },
  { role: 'Tesla Advisor, Sales', place: 'Upland, CA', pay: '$20.44–$36.45/hr + cash and stock awards', src: ['post-advisor'] },
  { role: 'Field Service Technician I / II / III, Residential Energy', place: 'Aurora, CO', pay: '$20.41–$30.62 / $23.44–$35.15 / $27.22–$40.82 an hour', src: ['post-energy'] },
]
export const payNote = { text: 'Production Associate postings for Giga Texas and Giga Nevada state no pay, so none is shown here. Tesla adds that "pay offered may vary depending on multiple individualized factors, including market location, job-related knowledge, skills, and experience."', src: ['post-pa'] }
export const benefits = [
  { text: 'Benefits start "at day 1 of hire" for full-time employees: medical plans with $0 payroll-deduction options, dental and vision.', src: ['post-pa'] },
  { text: '"401(k) with employer match, Employee Stock Purchase Plans", sick and vacation time (accrued hours for hourly jobs), paid holidays, commuter benefits and earned wage access.', src: ['post-pa'] },
  { text: 'Tesla\'s annual report says it emphasizes stock ownership, "with 92% of employees included in total rewards packages."', src: ['sec-10k'] },
]

// 4. Training: START and the Giga Texas Manufacturing Development Program.
export const start = {
  what: { text: 'Tesla START is "a comprehensive 16-week EV service training initiative tailored for individuals with prior automotive experience." The Winter 2027 cohort in Shoreline, WA pays $28.50 an hour, with benefits as a full-time Tesla intern.', src: ['post-start'] },
  items: [
    { name: 'Some automotive training first', text: 'Shoreline Community College: "Applicants are required to have some previous automotive training before applying to this program." Its program is 16 weeks and 24 credits.', src: ['shoreline-start'] },
    { name: 'Full-time, with a passing score', text: 'A "minimum of 40 hours per week", and every session passed at the score the program sets.', src: ['post-start'] },
    { name: 'A service-center job after', text: '"Accept employment at a Tesla Service Center within 30 days of graduation from the program; must be willing to relocate."', src: ['post-start'] },
    { name: 'A driver\'s license and lifting', text: 'Lift up to 60 pounds.', src: ['post-start'] },
  ],
  tstc: { text: 'Texas State Technical College runs START at its Fort Bend County and Waco campuses: 18 or older, a high school diploma or GED plus automotive schooling or equivalent military service, and a clean driving record. "Tesla will provide the required tools", and students receive a stipend from Tesla for program hours. In March 2026 the college reported six START graduates hired as service technicians at Tesla service centers in Texas.', src: ['tstc-start', 'tstc-grads'] },
  askSchool: { text: 'Pass marks and any cost differ between Tesla\'s posting and the partner schools\' pages, so ask the school running your cohort.', src: ['post-start', 'tstc-start'] },
  optimus: { text: 'START Optimus, in Fremont, trains technicians to service Tesla\'s humanoid robot at $30.00 an hour, for people "with existing technical experience in electrical, electromechanical, robotics, automotive, or a related field."', src: ['post-start'] },
  mdp: { text: 'At Giga Texas, the Manufacturing Development Program is "a paid 7-week Advanced Manufacturing Program at Austin Community College leading to full-time employment at Tesla." Trainees start as Production Associates when it ends and earn "a Production Operator Certificate and 15 articulated college credits."', src: ['mdp-flyer'] },
  mdpRules: { text: 'Enrollment is "available every month year round"; you must be 18 by the cohort start date and pass a background check.', src: ['mdp-flyer'] },
}

// 5. Where Tesla hires: average workforce Tesla reports to OSHA for each big site.
export const sites = [
  { site: 'Fremont vehicle plant, CA', people: '16,609 in 2025 (18,803 in 2024)', src: ['osha-ita'] },
  { site: 'Giga Texas, Austin', people: '13,620 in 2025 (14,748 in 2024)', src: ['osha-ita'] },
  { site: 'Gigafactory Nevada, Sparks', people: '8,020 in 2024', src: ['osha-ita'] },
  { site: 'Fremont, 901 Page Ave', people: '2,744 in 2025 (3,267 in 2024)', src: ['osha-ita'] },
  { site: 'Lathrop battery plant, CA', people: '1,899 in 2024', src: ['osha-ita'] },
  { site: 'Gigafactory New York, Buffalo', people: '1,834 in 2024', src: ['osha-ita'] },
]
export const sitesNote = { text: 'Average employees on Tesla\'s own yearly filings with OSHA. The 2025 file has no row yet for Sparks, the Lathrop battery plant or Buffalo.', src: ['osha-ita'] }
export const company = [
  { text: 'Tesla had 134,785 employees worldwide at the end of 2025 and is headquartered in Austin, Texas.', src: ['sec-10k'] },
  { text: 'Service jobs are not tied to the plants: service technician postings open in November 2026 included Seattle and Fife, Washington, Buffalo, New York, and Englewood, Colorado.', src: ['post-svc'] },
  { text: 'Tesla has cut jobs: its annual report records $583 million of employee termination costs from restructuring in the second quarter of 2024, and cost cuts tied to its AI chip work in the second half of 2025 that also included employee terminations.', src: ['sec-10k'] },
  { text: 'The same report says 69% of managers were promoted internally, and its educational assistance programs support about 7,000 learners in fields like engineering and AI.', src: ['sec-10k'] },
]

// 6. Safety: injury rates worked out from Tesla's own OSHA filings (recordable cases per 100 full-time workers).
export const safetyRows = [
  { site: 'Fremont vehicle plant', rate: '8.19 in 2025, 7.60 in 2024', src: ['osha-ita'] },
  { site: 'Giga Texas', rate: '3.54 in 2025, 5.17 in 2024 (one death recorded in 2024)', src: ['osha-ita'] },
  { site: 'Gigafactory Nevada', rate: '3.37 in 2024', src: ['osha-ita'] },
  { site: 'Fremont, 901 Page Ave', rate: '2.30 in 2025, 3.01 in 2024', src: ['osha-ita'] },
  { site: 'Lathrop battery plant', rate: '4.38 in 2024', src: ['osha-ita'] },
  { site: 'Gigafactory New York, Buffalo', rate: '2.07 in 2024', src: ['osha-ita'] },
  { site: 'U.S. car and light-truck plants (federal survey)', rate: '5.8 in 2024', src: ['bls-soii'] },
]
export const safetyIntro = { text: 'Recordable injuries and illnesses per 100 full-time workers, worked out from the case and hours totals Tesla files with OSHA each year, beside the national rate the Bureau of Labor Statistics publishes for car and light-truck plants.', src: ['osha-ita', 'bls-soii'] }
export const safetyNote = { text: 'In 2024 the Fremont vehicle plant ran above the national rate and Giga Texas below it; the national rate for 2025 is not out yet. A plant\'s rate covers every job in it, not one line.', src: ['osha-ita', 'bls-soii'] }

// 7. How to apply, what the process looks like, and scams.
export const apply = {
  site: { text: 'Tesla takes applications on its own careers site, and its training programs send applicants there too.', src: ['tesla-careers', 'tstc-start', 'mdp-flyer'] },
  search: { text: 'Search by the title Tesla uses: Production Associate, Material Handler, Service Technician, START, Tesla Advisor or Field Service Technician. Then add the city you can get to: Fremont, Austin, Sparks, Buffalo or Lathrop for the plants, or your own city for service and sales jobs.', src: ['tesla-careers', 'post-pa', 'post-mh', 'post-svc', 'post-start', 'post-advisor', 'post-energy', 'sec-10k'] },
  steps: [
    { step: 'Apply online with a résumé', text: 'For the Giga Texas program, "a Tesla recruiter will schedule an interview" after you apply.', src: ['mdp-flyer'] },
    { step: 'For START, wait for the cohort', text: 'A partner college says Tesla reviews every applicant and announces who is selected close to the start of each new cohort.', src: ['tstc-start'] },
    { step: 'Ask for what you need', text: '"Please let your recruiter know if you need an accommodation at any point during the interview process."', src: ['post-pa'] },
  ],
}
export const peopleSay = [
  { text: 'Expect more than one interview: one applicant for an advisor job describes a recruiter phone call and then an in-person interview, and an employee describes five interviews before being hired.', src: ['r-1j1iz62', 'r-1j00z84'], firstHand: true },
  { text: 'Some sessions are in a group: people describe a group interview for a seasonal advisor job and a group information session for START.', src: ['r-1o8inz9', 'r-1tcebxb'], firstHand: true },
  { text: 'People answering a question about starting as a production associate say you can move up at Tesla from wherever you start.', src: ['r-1wgh7yi'], firstHand: true },
]
export const scams = [
  { text: 'A job offer by text you did not expect is probably a scam. The FTC: "Real employers will never contact you that way."', src: ['ftc-text'] },
  { text: '"Never pay to get paid or get a job."', src: ['ftc-text'] },
  { text: 'Check that a Tesla job is on Tesla\'s own careers site before you send anything.', src: ['tesla-careers'] },
]

// FAQ — visible on the page and mirrored in FAQPage JSON-LD.
export const faq = [
  {
    q: 'Do I need a degree to work in a Tesla factory?',
    a: { text: 'No. The Production Associate postings we read in November 2026 ask for no degree and no experience: the ability to learn, English, shift flexibility, and physical work up to 12 hours a day.', src: ['post-pa'] },
  },
  {
    q: 'How much does a Tesla production associate make?',
    a: { text: '$25.76 an hour plus cash and stock awards, on Tesla\'s Fremont postings in November 2026. Its Giga Texas and Giga Nevada postings state no pay.', src: ['post-pa'] },
  },
  {
    q: 'What is Tesla START?',
    a: { text: 'Paid, 16-week service-technician training for people with some automotive training, run with partner colleges. The Winter 2027 Shoreline, WA cohort pays $28.50 an hour, and graduates take a Tesla service-center job within 30 days, relocating if needed.', src: ['post-start', 'shoreline-start'] },
  },
  {
    q: 'Do Tesla factory jobs have night and weekend shifts?',
    a: { text: 'Often. The postings ask for days, nights, overnight and weekends as needed, plus possible overtime; one Fremont Castings posting runs 5:00 PM to 5:00 AM.', src: ['post-pa'] },
  },
  {
    q: 'How do I apply to Tesla?',
    a: { text: 'On Tesla\'s own careers site: search the job title and the city of the plant or service center you can reach. The FTC says never to pay to get a job, and that a job offer by unexpected text is probably a scam.', src: ['tesla-careers', 'ftc-text'] },
  },
]

// ── Listings: none. Tesla's careers site refuses every server and Seen has no reliable Tesla listing source
// (seenjobs.io searches for "tesla" near Austin, Fremont and Reno, and "production associate" near Fremont, returned
// 0 rows on 2026-11-14), so the template shows no "Hiring now" block; the "How to apply" row sends people to Tesla.
export const listings = null

// ── The page's openable rows (components/start/Guide.tsx `Blocks` renders each block type) ─────────────────────────
export const menu = [
  {
    id: 'apply', title: 'Where to find Tesla\'s open jobs', summary: 'Tesla\'s own site, by role and city',
    blocks: [
      { type: 'cards', items: [{ name: 'Tesla careers', aka: 'Tesla\'s own job search', link: SEARCH, body: apply.site }] },
      { type: 'text', entry: apply.search },
      { type: 'steps', items: apply.steps },
      { type: 'resumeLink', before: 'Before you apply, you can', label: 'check your résumé against a posting' },
    ],
  },
  {
    id: 'jobs', title: 'Jobs without a degree', summary: 'Six job families, with stated pay',
    blocks: [{ type: 'cards', items: roles }],
  },
  {
    id: 'what-you-need', title: 'What the postings ask', summary: 'Shifts, lifting, license, background',
    blocks: [
      { type: 'text', entry: asks.intro },
      { type: 'checklist', items: asks.items, cols: true },
      { type: 'more', title: 'Shifts and gear', blocks: [
        { type: 'table', caption: 'Shifts stated on Tesla production postings', columns: [{ key: 'site', label: 'Site' }, { key: 'shift', label: 'Shift' }], rows: shifts },
        { type: 'text', entry: shiftsNote },
        { type: 'text', entry: asks.gear },
      ] },
    ],
  },
  {
    id: 'pay', title: 'Pay Tesla states', summary: 'Hourly pay on its postings, by role',
    blocks: [
      { type: 'table', caption: 'Pay stated on Tesla’s own postings', columns: [{ key: 'role', label: 'Role' }, { key: 'place', label: 'Where' }, { key: 'pay', label: 'Stated pay', num: true }], rows: payRows },
      { type: 'note', entry: payNote },
      { type: 'more', title: 'Benefits', blocks: [{ type: 'notes', items: benefits }] },
    ],
  },
  {
    id: 'training', title: 'Tesla START and paid training', summary: 'Paid training for service and factory jobs',
    blocks: [
      { type: 'text', entry: start.what },
      { type: 'checklist', items: start.items },
      { type: 'text', entry: start.tstc },
      { type: 'callout', entry: start.askSchool },
      { type: 'more', title: 'START Optimus, and the Giga Texas factory program', blocks: [
        { type: 'text', entry: start.optimus },
        { type: 'text', entry: start.mdp },
        { type: 'text', entry: start.mdpRules },
      ] },
    ],
  },
  {
    id: 'where', title: 'Where Tesla hires', summary: 'The big plants and how many work there',
    blocks: [
      { type: 'table', caption: 'Average workforce at Tesla’s largest U.S. plants', columns: [{ key: 'site', label: 'Site' }, { key: 'people', label: 'Average employees', num: true }], rows: sites },
      { type: 'note', entry: sitesNote },
      { type: 'notes', items: company },
    ],
  },
  {
    id: 'safety-process', title: 'Safety record and the interview', summary: 'Injury rates, interviews, scams',
    blocks: [
      { type: 'heading', text: 'Injury rates by plant' },
      { type: 'text', entry: safetyIntro },
      { type: 'table', caption: 'Recordable injury rates at Tesla sites', columns: [{ key: 'site', label: 'Site' }, { key: 'rate', label: 'Injury rate', num: true }], rows: safetyRows },
      { type: 'note', entry: safetyNote },
      { type: 'heading', text: 'The interview' },
      { type: 'text', plain: 'What people who applied say. More than one account agrees on each of these.' },
      { type: 'notes', items: peopleSay },
      { type: 'notes', label: 'Scams', items: scams, icon: 'x', caution: true },
    ],
  },
  { id: 'questions', title: 'Common questions', summary: 'Degree, pay, START, shifts, applying', blocks: [{ type: 'faq', items: faq }] },
]

// ── Additional resources: every reference above, as plain grouped links (no numbers, closed by default) ────────────
export const resourcesSummary = 'Tesla careers, training partners, public records'
export const resources = [
  { title: 'Tesla careers', items: [
    { key: 'tesla-careers', name: 'Tesla careers job search' },
    { key: 'post-pa', name: 'Search page: type Production Associate' },
    { key: 'post-mh', name: 'Search page: type Material Handler' },
    { key: 'post-svc', name: 'Search page: type Service Technician' },
    { key: 'post-start', name: 'Search page: type START' },
    { key: 'post-advisor', name: 'Search page: type Tesla Advisor' },
    { key: 'post-energy', name: 'Search page: type Field Service Technician' },
  ] },
  { title: 'Training partners', items: [
    { key: 'tstc-start', name: 'Tesla START at Texas State Technical College' },
    { key: 'tstc-grads', name: 'START graduates at TSTC, March 2026' },
    { key: 'shoreline-start', name: 'Tesla START at Shoreline Community College' },
    { key: 'mdp-flyer', name: 'Giga Texas Manufacturing Development Program flyer' },
  ] },
  { title: 'Public records', items: [
    { key: 'sec-10k', name: 'Tesla annual report, 2025 (SEC)' },
    { key: 'osha-ita', name: 'Injury and illness data by workplace (OSHA)' },
    { key: 'bls-soii', name: 'Injury rate for car and light-truck plants (BLS)' },
  ] },
  { title: 'Job scams', items: [
    { key: 'ftc-text', name: 'Job offer texts (Federal Trade Commission)' },
  ] },
  { title: 'Community discussions', items: [
    { key: 'r-1j1iz62', name: 'A Tesla Advisor interview' },
    { key: 'r-1j00z84', name: 'Interview advice for an office role' },
    { key: 'r-1o8inz9', name: 'A seasonal advisor group interview' },
    { key: 'r-1tcebxb', name: 'A START information session' },
    { key: 'r-1wgh7yi', name: 'Starting as a production associate' },
  ] },
]

/** Every fact on the page, in reading order: the hero, then each menu row. */
export function pageEntries() {
  return [guide.answer, ...tiles, ...blockEntries(menu)]
}
