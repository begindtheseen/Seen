// /start/cdl — "Getting into CDL trucking". The page renders from this module only, so every figure on it
// carries a source and an as-of date (lib/start/guides.test.mjs fails on a figure without one).
//
// THE ONLY SOURCE OF FACTS is the research file compiled 2026-11-14 (session scratchpad research/cdl.md).
// Rules this module keeps:
//   • only items the research marked VERIFIED against a primary source (eCFR, the Federal Register, FMCSA's Training
//     Provider Registry and Clearinghouse sites, BLS, a state DMV, TSA, a carrier's own page or posting). Items the
//     research marked VERIFIED (secondary) — read through a trade outlet — are NOT printed: no FreightWaves "10,000
//     providers" quote, no CVSA English-enforcement date, no hair-test rule, no WIOA provider-list rule, no Walmart
//     graduate count from Fortune;
//   • FIRST-HAND items (several driver accounts agreeing) only as `firstHand: true`, worded as what drivers say,
//     never as fact; a single account is never used;
//   • nothing from the research's do-not-publish list: no Swift tuition or commitment, no Prime early-exit amount,
//     no Werner / Schneider / Covenant reimbursement amounts, no Stevens loan terms, no Roehl repayment amount, no
//     old CRST contract (CRST says it does not offer paid training), no ATA turnover figure, no UPS "apprentice"
//     program, no Amazon eligibility days or cap, no non-domiciled status list or court outcome, no marijuana
//     rescheduling dates, no California AB 692 details, no industry-wide DUI lookback, no FTC action on CDL schools;
//   • the candid parts are said plainly: under 21 is in-state only (the pilot ended 2025-11-07), a Clearinghouse
//     violation costs the licence, paper medical cards stopped counting on 2026-10-12, "up to" pay is a ceiling, and
//     company-paid training usually ties you to the carrier with repayment if you leave;
//   • no hype, no guarantees, no exclamation marks (TMC's own "!" is left out of its quote).
//
// Shape: `sources` (every reference behind the page, kept here and NEVER printed as citations — the links reach
// readers only through the grouped "Additional resources" menu, `resources` below), entries
// `{ text, src: [sourceKey…], firstHand? }`, the listings filter config (`listings`, lib/start/listingFilters.js) and
// the page's openable menu rows (`menu`, rendered by components/start/Guide.tsx Blocks). Pure data; relative imports
// only so `node --test` runs it as is.

import { blockEntries } from './entries.js'

/** @typedef {{ label: string, url: string, date: string, note?: string }} Source */

/** @type {Record<string, Source>} */
export const sources = {
  // Federal rules (eCFR text "up to date as of 2026-11-12").
  'cfr-383-25': { label: '49 CFR 383.25, commercial learner\'s permit (eCFR)', url: 'https://www.ecfr.gov/current/title-49/section-383.25', date: '2026-11-12', note: 'text as of' },
  'cfr-383-51': { label: '49 CFR 383.51, disqualification of drivers (eCFR)', url: 'https://www.ecfr.gov/current/title-49/section-383.51', date: '2026-11-12', note: 'text as of' },
  'cfr-383-91': { label: '49 CFR 383.91, commercial motor vehicle groups (eCFR)', url: 'https://www.ecfr.gov/current/title-49/section-383.91', date: '2026-11-12', note: 'text as of' },
  'cfr-383-93': { label: '49 CFR 383.93, endorsements (eCFR)', url: 'https://www.ecfr.gov/current/title-49/section-383.93', date: '2026-11-12', note: 'text as of' },
  'cfr-383-153': { label: '49 CFR 383.153, information on the CDL, including the K (intrastate only) restriction (eCFR)', url: 'https://www.ecfr.gov/current/title-49/section-383.153', date: '2026-11-12', note: 'text as of' },
  'cfr-380': { label: '49 CFR Part 380, entry-level driver training, Subparts F and G (eCFR)', url: 'https://www.ecfr.gov/current/title-49/part-380', date: '2026-11-12', note: 'text as of' },
  'cfr-391-11': { label: '49 CFR 391.11, general qualifications of drivers (eCFR)', url: 'https://www.ecfr.gov/current/title-49/section-391.11', date: '2026-11-12', note: 'text as of' },
  'cfr-391-41': { label: '49 CFR 391.41, physical qualifications for drivers (eCFR)', url: 'https://www.ecfr.gov/current/title-49/section-391.41', date: '2026-11-12', note: 'text as of' },
  'cfr-391-45': { label: '49 CFR 391.45, persons who must be medically examined and certified (eCFR)', url: 'https://www.ecfr.gov/current/title-49/section-391.45', date: '2026-11-12', note: 'text as of' },
  'cfr-382-301': { label: '49 CFR 382.301, pre-employment drug testing (eCFR)', url: 'https://www.ecfr.gov/current/title-49/section-382.301', date: '2026-11-12', note: 'text as of' },
  'cfr-382-701': { label: '49 CFR 382.701, Drug and Alcohol Clearinghouse queries (eCFR)', url: 'https://www.ecfr.gov/current/title-49/section-382.701', date: '2026-11-12', note: 'text as of' },
  'cfr-395-3': { label: '49 CFR 395.3, maximum driving time for property-carrying vehicles (eCFR)', url: 'https://www.ecfr.gov/current/title-49/section-395.3', date: '2026-11-12', note: 'text as of' },
  // FMCSA registries and notices.
  'tpr-home': { label: 'FMCSA Training Provider Registry, home page counters', url: 'https://tpr.fmcsa.dot.gov/home', date: '2026-11-14', note: 'read' },
  'tpr-faq': { label: 'FMCSA Training Provider Registry, FAQ: training requirements', url: 'https://tpr.fmcsa.dot.gov/FAQ/Topics/training-requirements', date: '2026-11-14', note: 'read' },
  'ch-downgrade': { label: 'FMCSA Drug and Alcohol Clearinghouse, CDL downgrades (Clearinghouse-II)', url: 'https://clearinghouse.fmcsa.dot.gov/Learn/News/Item/clearinghouse-cdl-downgrades', date: '2026-11-14', note: 'read' },
  'ch-monthly': { label: 'FMCSA Drug and Alcohol Clearinghouse, monthly report for October 2026', url: 'https://clearinghouse.fmcsa.dot.gov/content/resources/Clearinghouse_MonthlyReport_October2026.html', date: '2026-11-01', note: 'data as of' },
  'ch-marijuana': { label: 'FMCSA Drug and Alcohol Clearinghouse, ODAPC update on marijuana (February 2026)', url: 'https://clearinghouse.fmcsa.dot.gov/Learn/News/Item/ODAPC-updates-Feb2026', date: '2026-02-25', note: 'posted' },
  'fr-medcard': { label: 'Federal Register 91 FR 64454, Qualification of Drivers; Commercial Vehicle Safety Alliance; Application for Exemption', url: 'https://www.federalregister.gov/documents/2026/10/08/2026-20649/qualification-of-drivers-commercial-vehicle-safety-alliance-application-for-exemption', date: '2026-10-08', note: 'published' },
  'fr-elp': { label: 'Federal Register 91 FR 51422, English Language Proficiency; Out of Service Criteria (proposed rule)', url: 'https://www.federalregister.gov/documents/2026/08/10/2026-16288/english-language-proficiency-out-of-service-criteria', date: '2026-08-10', note: 'published' },
  'fr-nondom': { label: 'Federal Register 91 FR 7044, Restoring Integrity to the Issuance of Non-Domiciled Commercial Drivers Licenses (final rule)', url: 'https://www.federalregister.gov/documents/2026/02/13/2026-02965/restoring-integrity-to-the-issuance-of-non-domiciled-commercial-drivers-licenses-cdl', date: '2026-02-13', note: 'published' },
  'crs-sdap': { label: 'Congressional Research Service R48244, Safe Driver Apprenticeship Pilot Program: In Brief', url: 'https://www.congress.gov/crs_external_products/R/PDF/R48244/R48244.3.pdf', date: '2026-11-03', note: 'updated' },
  'tsa-hme': { label: 'TSA, Hazardous Materials Endorsement threat assessment', url: 'https://www.tsa.gov/for-industry/hazmat-endorsement', date: '2026-11-14', note: 'read' },
  // States.
  'ca-dmv-cdl': { label: 'California DMV, commercial driver\'s licenses', url: 'https://www.dmv.ca.gov/portal/driver-licenses-identification-cards/commercial-driver-licenses-cdl/', date: '2026-11-14', note: 'read' },
  'ca-fees': { label: 'California DMV, licensing fees', url: 'https://www.dmv.ca.gov/portal/driver-licenses-identification-cards/licensing-fees/', date: '2026-11-14', note: 'read' },
  'tx-fees': { label: 'Texas Department of Public Safety, driver license fees', url: 'https://www.dps.texas.gov/section/driver-license/driver-license-fees', date: '2026-11-14', note: 'read' },
  'fl-fees': { label: 'Florida Highway Safety and Motor Vehicles, fees', url: 'https://www.flhsmv.gov/fees/', date: '2026-11-14', note: 'read' },
  // Pay, hours, overtime.
  'bls-truck': { label: 'U.S. Bureau of Labor Statistics, Occupational Outlook Handbook: Heavy and Tractor-trailer Truck Drivers (May 2025 pay)', url: 'https://www.bls.gov/ooh/transportation-and-material-moving/heavy-and-tractor-trailer-truck-drivers.htm', date: '2026-08-27', note: 'page updated' },
  'bls-light': { label: 'BLS Occupational Outlook Handbook: Delivery Truck Drivers and Driver/Sales Workers (May 2025 pay)', url: 'https://www.bls.gov/ooh/transportation-and-material-moving/delivery-truck-drivers-and-driver-sales-workers.htm', date: '2026-08-27', note: 'page updated' },
  'dol-flsa': { label: 'U.S. Department of Labor, Fact Sheet 19: the motor carrier exemption under the FLSA', url: 'https://www.dol.gov/agencies/whd/fact-sheets/19-flsa-motor-carrier', date: '2026-11-14', note: 'read' },
  'oig-detention': { label: 'U.S. DOT Office of Inspector General, report ST2018019 on driver detention', url: 'https://www.oig.dot.gov/library-item/36237', date: '2018-01-31', note: 'published' },
  'cfpb-traps': { label: 'Consumer Financial Protection Bureau, Issue Spotlight: Consumer risks posed by employer-driven debt', url: 'https://www.consumerfinance.gov/data-research/research-reports/issue-spotlight-consumer-risks-posed-by-employer-driven-debt/full-report/', date: '2023-07-20', note: 'published' },
  // Carriers' and employers' own pages (what each says, not what drivers earn).
  'prime-train': { label: 'Prime Inc., student driver training program (own page)', url: 'https://www.driveforprime.com/train/student-driver-training-program/', date: '2026-11-14', note: 'read' },
  'tmc': { label: 'TMC Transportation, new to trucking (own page)', url: 'https://www.tmctrans.com/drive-for-tmc/new-to-trucking/', date: '2026-11-14', note: 'read' },
  'roehl': { label: 'Roehl, CDL truck driving schools (own page)', url: 'https://www.roehl.jobs/driving-jobs/cdl-truck-driving-schools', date: '2026-10-19', note: 'page updated' },
  'knight-school': { label: 'Knight Transportation, CDL school (own page)', url: 'https://www.knighttrans.com/cdl-school/', date: '2026-11-14', note: 'read' },
  'werner': { label: 'Werner, CDL training (own page)', url: 'https://werner.com/cdl-training/', date: '2026-11-14', note: 'read' },
  'stevens': { label: 'Stevens Transport, CDL training (own page)', url: 'https://www.stevenstransport.com/drivers/cdl-training/', date: '2026-11-14', note: 'read' },
  'schneider-cat': { label: 'Schneider, paid CDL training for inexperienced drivers (own page)', url: 'https://schneiderjobs.com/truck-driving-jobs/inexperienced/paid-cdl-training', date: '2026-11-14', note: 'read' },
  'schneider-cost': { label: 'Schneider blog, how much it costs to get a CDL', url: 'https://schneiderjobs.com/blog/how-much-does-it-cost-to-get-cdl', date: '2026-11-14', note: 'read' },
  'crst': { label: 'CRST, driving careers FAQ (own page)', url: 'https://www.crst.com/driving-careers/', date: '2026-11-14', note: 'read' },
  'walmart-fleet': { label: 'Walmart, Private Fleet regional truck driver posting R-2652563 (own careers site)', url: 'https://careers.walmart.com/us/en/jobs/R-2652563', date: '2026-11-14', note: 'read' },
  'walmart-a2d': { label: 'Walmart, career advancement opportunities (Associate to Driver)', url: 'https://corporate.walmart.com/about/working-at-walmart/career-advancement-opportunities', date: '2026-11-14', note: 'read' },
  'amazon-cc': { label: 'Amazon, Career Choice truck driver job training (company news)', url: 'https://www.aboutamazon.com/news/workplace/amazon-career-choice-truck-driver-job-training', date: '2024-03-05', note: 'published' },
  // Community colleges.
  'pima': { label: 'Arizona Job Connection eligible training provider record: Pima Community College, CDL training Class A', url: 'https://www.azjobconnection.gov/etp/public/institution_programs/22573', date: '2026-08-13', note: 'record updated' },
  'mcc-nh': { label: 'Manchester Community College (NH), Commercial Driver License Class A', url: 'https://mccnh.edu/program/wdc-commercial-driver-license-cdl-class-a/', date: '2026-11-14', note: 'read' },
  // First-hand accounts (r/Truckers, read through the Arctic Shift archive). Used only where several accounts agree,
  // and rendered as what drivers say, never as fact.
  'r-1u3ma8r': { label: 'r/Truckers, "Got a 90-day card for possible sleep apnea, how…"', url: 'https://www.reddit.com/r/Truckers/comments/1u3ma8r/got_a_90day_card_for_possible_sleep_apnea_how/', date: '2026-06-12', note: 'thread' },
  'r-1wh7yqk': { label: 'r/Truckers, "Question on DOT physical and sleep apnea"', url: 'https://www.reddit.com/r/Truckers/comments/1wh7yqk/question_on_dot_physical_and_sleep_apnea/', date: '2026-09-15', note: 'thread' },
  'r-1sqmmkg': { label: 'r/Truckers, "What did you make your first year? Any advice"', url: 'https://www.reddit.com/r/Truckers/comments/1sqmmkg/what_did_you_make_your_first_year_any_advice/', date: '2026-04-20', note: 'thread' },
  'r-1tzrv9e': { label: 'r/Truckers, "OTR first year gross earnings"', url: 'https://www.reddit.com/r/Truckers/comments/1tzrv9e/otr_first_year_gross_earnings/', date: '2026-06-07', note: 'thread' },
  'r-1q1pf77': { label: 'r/Truckers, "My first full year trucking"', url: 'https://www.reddit.com/r/Truckers/comments/1q1pf77/my_first_full_year_trucking/', date: '2026-01-02', note: 'thread' },
  'r-1w4cd75': { label: 'r/Truckers, thread on first-year pay and training contracts', url: 'https://www.reddit.com/r/Truckers/comments/1w4cd75/', date: '2026-09-01', note: 'thread' },
  'r-1xgf2xl': { label: 'r/Truckers, "Thinking of getting a CDL, is it worth it?"', url: 'https://www.reddit.com/r/Truckers/comments/1xgf2xl/thinking_of_getting_a_cdl_is_it_worth_it/', date: '2026-10-27', note: 'thread' },
  'r-1qi3oe8': { label: 'r/Truckers, thread on local jobs after a year over the road', url: 'https://www.reddit.com/r/Truckers/comments/1qi3oe8/', date: '2026-01-20', note: 'thread' },
  'r-1weumxg': { label: 'r/Truckers, "Getting screwed under contract"', url: 'https://www.reddit.com/r/Truckers/comments/1weumxg/getting_screwed_under_contract/', date: '2026-09-13', note: 'thread' },
  'r-1nj1cn4': { label: 'r/Truckers, "Year contract"', url: 'https://www.reddit.com/r/Truckers/comments/1nj1cn4/year_contract/', date: '2025-09-17', note: 'thread' },
  'r-1tsi6up': { label: 'r/Truckers, thread on a Knight training contract', url: 'https://www.reddit.com/r/Truckers/comments/1tsi6up/', date: '2026-05-31', note: 'thread' },
  'r-1xqqunf': { label: 'r/Truckers, thread on getting a Class A for Class B work', url: 'https://www.reddit.com/r/Truckers/comments/1xqqunf/', date: '2026-11-08', note: 'thread' },
}

export const guide = {
  path: '/start/cdl',
  title: 'Getting into CDL trucking',
  crumbLabel: 'CDL trucking',
  eyebrow: 'Guide',
  // The one-sentence answer under the h1 (the page's first screen). No figure here: figures live in the tiles.
  answer: { text: 'You can get a Class A in a few weeks through a registered school or a carrier that trains you. Company-paid training usually ties you to that carrier for a year or more, and you may owe money if you leave early.', src: ['werner', 'prime-train', 'tmc', 'roehl', 'knight-school'] },
  metaDescription: 'How to get a CDL with no experience: the permit, entry-level training and skills test, who can drive, company-paid training and its contract terms, community college costs, first-year pay and work, and live truck driving listings near you.',
  asOf: '2026-11-14',
}

// The three readings in the hero: each restates a sourced fact below, with the same sources.
export const tiles = [
  { label: 'Median pay', value: '$58,640', text: 'a year for heavy and tractor-trailer drivers, May 2025', src: ['bls-truck'] },
  { label: 'Openings a year', value: '214,500', text: 'projected on average for those drivers, 2025 to 2035', src: ['bls-truck'] },
  { label: 'Age to cross state lines', value: '21', text: 'under 21 is in-state only; the federal pilot for younger drivers ended in November 2025', src: ['cfr-391-11', 'cfr-383-153', 'crs-sdap'] },
]

// 1. The steps to a CDL, in order. `step` is the short line a reader scans; `text` the rest.
export const steps = [
  { step: 'Get a commercial learner\'s permit', text: 'From age 18, with a driver\'s license from the same state and a passed general knowledge test. A CDL holder must ride beside you, you cannot haul hazmat, and the permit lasts up to 1 year.', src: ['cfr-383-25'] },
  { step: 'Pass a DOT physical', text: 'You need a medical certificate before you drive a commercial vehicle. It lasts up to 24 months, or 12 for some conditions such as insulin-treated diabetes.', src: ['cfr-391-45'] },
  { step: 'Finish entry-level driver training (ELDT)', text: 'Required for a first Class A or B, and for a first passenger, school bus or hazmat endorsement. It must come from a provider on FMCSA\'s Training Provider Registry. There is no federal minimum of hours: you need 80% on the theory test, and the instructor judges your driving.', src: ['cfr-380', 'tpr-faq'] },
  { step: 'Wait 14 days, then take the skills test', text: 'At least 14 days after the permit was first issued: a vehicle inspection, basic control and a road test.', src: ['cfr-383-25'] },
  { step: 'Get the CDL from your home state', text: 'A new Class A license is $100 in California, $97 in Texas (good for 8 years) and $75 in Florida. That is the license alone: school, the physical and the drug test cost extra.', src: ['ca-fees', 'tx-fees', 'fl-fees'] },
]
export const schoolCheck = { text: 'Check that a school is on FMCSA\'s Training Provider Registry before you pay. Training given after a school\'s removal date does not count, and 10,046 training locations had been removed as of November 14, 2026.', src: ['tpr-home', 'cfr-380'] }

// Classes and endorsements (one tap away).
export const classes = [
  { name: 'Class A', text: 'A truck pulling a trailer: 26,001 lb or more combined, with a trailer over 10,000 lb. The tractor-trailer license, and it also covers Class B and C vehicles.', src: ['cfr-383-91'] },
  { name: 'Class B', text: 'A single vehicle of 26,001 lb or more, such as a straight truck, dump truck, large box truck or bus.', src: ['cfr-383-91'] },
  { name: 'Class C', text: 'A smaller vehicle built for 16 or more people, or one carrying placarded hazardous materials.', src: ['cfr-383-91'] },
  { name: 'Endorsements', text: 'T for doubles and triples, N for tank vehicles, H for hazmat, X for tank plus hazmat, P for passengers, S for school buses. Only P, S and N can go on a permit.', src: ['cfr-383-93'] },
  { name: 'Hazmat costs extra', text: 'The TSA background check for H is $88.25 for new applicants, with fingerprints; it lasts 5 years and is not refundable.', src: ['tsa-hme'] },
  { name: 'States can ask for more training', text: 'California adds 15 hours of its own behind-the-wheel training on top of ELDT.', src: ['ca-dmv-cdl'] },
]
export const classAFirst = { text: 'Drivers often advise getting the Class A even if you want Class B work, because a Class A covers Class B vehicles.', src: ['r-1xqqunf', 'cfr-383-91'], firstHand: true }

// 2. Who can drive: what can stop you, as a checklist.
export const whoCan = [
  { name: '21 to cross state lines', text: 'At 18 to 20 you can drive only inside your state, where the state allows it, with a K (intrastate only) restriction on the license. The federal pilot that let some under-21 drivers cross state lines ended on November 7, 2025.', src: ['cfr-391-11', 'cfr-383-153', 'crs-sdap'] },
  { name: 'Pass the DOT physical', text: 'Among the standards: 20/40 vision in each eye, glasses allowed; hearing a forced whisper at 5 feet; no condition likely to make you black out. Since October 12, 2026, drivers licensed anywhere but Alaska can no longer rely on a paper medical card; the state\'s record is what counts.', src: ['cfr-391-41', 'fr-medcard'] },
  { name: 'A clean drug and alcohol record', text: 'Employers must check the federal Drug and Alcohol Clearinghouse before hiring you and every year after, and need a negative drug test. A violation puts you in "prohibited" status, and since November 18, 2024 your state removes your CDL or permit until you finish the return-to-duty process.', src: ['cfr-382-701', 'cfr-382-301', 'ch-downgrade'] },
  { name: 'No marijuana, even where it is legal', text: 'In February 2026 DOT said it is "still unacceptable" for people in safety-sensitive transportation jobs, drivers included, to use marijuana, and that its guidance on medical and recreational marijuana and CBD is still in effect.', src: ['ch-marijuana'] },
  { name: 'A driving record carriers accept', text: 'A DUI, a refused test or leaving the scene takes a CDL holder off commercial vehicles for 1 year (3 with hazmat, life for a second offense), even in a personal car. Carriers set their own bar too: Walmart\'s fleet allows no more than 2 moving violations and no preventable collision in 3 years.', src: ['cfr-383-51', 'walmart-fleet'] },
  { name: 'Read and speak English', text: 'Well enough to talk with the public, read road signs, answer officials and fill in records. FMCSA proposed in August 2026 to make failing this an out-of-service violation in its own rules; roadside enforcement of it already exists.', src: ['cfr-391-11', 'fr-elp'] },
]
export const whoCanMore = [
  { text: 'Most drivers who lose the CDL this way have not started the way back: of the 220,688 drivers in prohibited status on November 1, 2026, FMCSA counted 79.5% who had not begun the return-to-duty process.', src: ['ch-monthly'] },
  { text: 'Screening starts before school: Knight asks for criminal and driving-record checks and drug screens before its CDL school, and Manchester Community College warns that to get hired you must have no alcohol-related or major driving offenses in the previous two years.', src: ['knight-school', 'mcc-nh'] },
  { text: 'If your permanent home is in another country, a federal rule in effect since March 16, 2026 limits non-domiciled CDLs and permits "to those who hold specific, verifiable employment-based nonimmigrant status."', src: ['fr-nondom'] },
]
export const sleepApnea = { text: 'Drivers say examiners often give a short card, commonly 90 days, to someone who may have sleep apnea, until a sleep study is done and treatment starts if it is needed.', src: ['r-1u3ma8r', 'r-1wh7yqk'], firstHand: true }

// 3. Ways to pay for school. Each door: a lead, examples `{ who, figure, text }`, and an optional note.
export const doors = {
  carrier: {
    title: 'A carrier trains you',
    lead: { text: 'Little or nothing up front, then you drive for that carrier. Most tie you to it for a year or more, and leaving early can mean paying back part of the cost.', src: ['prime-train', 'tmc', 'roehl', 'knight-school'] },
    examples: [
      { who: 'Prime', figure: 'No cost if you stay', text: 'for 1 year after your CDL, plus a $300 a week loan for living costs during 2 to 4 weeks of training with an instructor. Its page does not say what you owe if you leave early.', src: ['prime-train'] },
      { who: 'TMC', figure: '$500 a week', text: 'in training, nothing up front. Drive 1 year after your CDL, or repay a prorated part of the training cost.', src: ['tmc'] },
      { who: 'Roehl', figure: '$616 a week', text: 'in the first phase, as an employee from day one. Training is "in effect a loan," forgiven after 120,000 solo miles, about 15 months.', src: ['roehl'] },
      { who: 'Knight', figure: '$5,200 tuition', text: 'paid off over 52 weeks if hired, and paid back to you after 104 weeks of work there.', src: ['knight-school'] },
      { who: 'Stevens', figure: 'No out-of-pocket cost', text: 'a 160-hour Class A course, then a 240-hour paid finishing program. Its page does not state the commitment, and its application asks if you are 22 or older.', src: ['stevens'] },
    ],
    note: { text: 'Schneider runs a paid 5 to 7.5 week apprenticeship in some areas and Werner owns Roadmaster Drivers School; neither page states the commitment or exit terms. CRST says it "does not offer paid CDL training."', src: ['schneider-cat', 'werner', 'crst'] },
  },
  school: {
    title: 'You pay a registered school',
    lead: { text: 'You owe no carrier afterward and choose where to work. Some community college programs are approved for WIOA, the federal workforce training funds; ask your local workforce office.', src: ['pima'] },
    examples: [
      { who: 'Pima Community College, Arizona', figure: '$4,094.25', text: 'in-state, 16 weeks, approved for WIOA', src: ['pima'] },
      { who: 'Manchester Community College, New Hampshire', figure: '$9,150', text: '85 hours; the physical, the drug screen and a re-test, if you need one, are extra', src: ['mcc-nh'] },
      { who: 'One carrier\'s estimate', figure: '$4,000–$12,000', text: 'what a CDL generally costs, per Schneider', src: ['schneider-cost'] },
    ],
    note: { text: 'Some drivers say a local workforce office or a grant paid for their school, so they owed no carrier contract.', src: ['r-1nj1cn4'], firstHand: true },
  },
  employer: {
    title: 'Your employer trains you',
    lead: { text: 'A few large employers train their own staff for a CDL.', src: ['walmart-a2d', 'amazon-cc'] },
    examples: [
      { who: 'Walmart, Associate to Driver', figure: 'Fully paid', text: 'a 16-week program for frontline associates, for Walmart\'s own fleet', src: ['walmart-a2d'] },
      { who: 'Amazon Career Choice', figure: 'Prepaid tuition', text: 'Amazon said in March 2024 that more than 28,000 employees had taken part in its truck-driving training since it began; graduates have gone on to drive for Amazon and for other employers', src: ['amazon-cc'] },
    ],
    note: null,
  },
}
export const contractLine = { text: 'Before you sign a training contract, get the exit terms in writing: what you would owe, whether it shrinks as you work, and what happens if you are let go. A 2023 CFPB report on training repayment agreements names trucking among the industries that use them.', src: ['cfpb-traps'] }
export const contractsSay = [
  { text: 'Read the whole agreement and get a recruiter\'s promises in writing. Breaking one usually means a payment plan or collections; whether carriers sue is disputed.', src: ['r-1nj1cn4', 'r-1tsi6up', 'r-1w4cd75'], firstHand: true },
]

// 4. The first year: what the work and the pay look like.
export const firstYear = [
  { text: 'Carriers that train new drivers start them on the road with a trainer: Prime for 30,000 to 50,000 training miles, TMC for 4 weeks, Roehl at $112 a day in its second phase.', src: ['prime-train', 'tmc', 'roehl'] },
  { text: 'The Bureau of Labor Statistics says long-haul drivers "can be away from home for days or weeks at a time," truck drivers often work nights, weekends and holidays, and heavy and tractor-trailer drivers "have one of the highest rates of injuries and illnesses of all occupations."', src: ['bls-truck'] },
]
export const driversSay = [
  { step: 'Start over the road or regional', text: 'The usual path is a year or so of over-the-road or regional driving first: many local jobs ask for 6 months to 2 years of experience, though some hire sooner.', src: ['r-1xgf2xl', 'r-1qi3oe8', 'r-1xqqunf'], firstHand: true },
  { step: 'Expect less than the ad', text: 'First-year pay people report at large carriers is mostly $40,000 to $65,000, lower for dry van and higher for flatbed. Several call "$100k first year" a recruiter figure, not a typical year.', src: ['r-1sqmmkg', 'r-1tzrv9e', 'r-1q1pf77', 'r-1w4cd75', 'r-1xgf2xl'], firstHand: true },
  { step: 'Get through the first year', text: 'The first year is the hardest on money, and new hires get the worst schedules and routes until they build seniority.', src: ['r-1tzrv9e', 'r-1xgf2xl', 'r-1w4cd75', 'r-1weumxg'], firstHand: true },
]
export const howPaid = [
  { name: 'By the mile, the load or the week', text: 'Walmart\'s fleet pays $0.55 to $0.69 a mile, local and regional drivers alike; TMC offers percentage pay; Prime pays at least $900 a week while you train on the road away from home.', src: ['walmart-fleet', 'tmc', 'prime-train'] },
  { name: 'Often no overtime', text: 'Federal overtime law exempts drivers under the Department of Transportation\'s authority, so many CDL drivers are not owed time-and-a-half under federal law.', src: ['dol-flsa'] },
  { name: 'Hours are capped', text: 'At most 11 hours of driving in a 14-hour window after 10 hours off, a 30-minute break after 8 hours of driving, and 60 hours on duty in 7 days or 70 in 8.', src: ['cfr-395-3'] },
  { name: 'Waiting at docks is often unpaid', text: 'A 2018 DOT Inspector General report estimated that detention, time held at shippers and receivers, is linked to $1.1 to $1.3 billion a year in lost earnings for for-hire truckload drivers.', src: ['oig-detention'] },
]
export const upTo = { text: '"Up to" is a ceiling, not a typical year. Walmart says regional drivers "earn up to $110,000 in their first year," but it hires only drivers with 30 months of experience or its own academy graduates; TMC says first-year drivers are "earning up to $100,000."', src: ['walmart-fleet', 'tmc'] }
export const payRows = [
  { what: 'Median, heavy and tractor-trailer drivers', figure: '$58,640 a year ($28.19 an hour)', src: ['bls-truck'] },
  { what: 'Lowest 10% earned less than', figure: '$40,140', src: ['bls-truck'] },
  { what: 'Highest 10% earned more than', figure: '$79,380', src: ['bls-truck'] },
  { what: 'Median in truck transportation', figure: '$60,320', src: ['bls-truck'] },
  { what: 'Median in wholesale trade', figure: '$58,550', src: ['bls-truck'] },
  { what: 'Median, light truck drivers (a regular license)', figure: '$44,860', src: ['bls-light'] },
]
export const payNote = { text: 'National yearly pay for May 2025. Light trucks are 26,000 lb or less. Roehl says its drivers with at least a year average $1,461 a week; that is the carrier\'s statement, not a national figure.', src: ['bls-truck', 'bls-light', 'roehl'] }

// 5. Watch out: red flags and what ends a career early.
export const redFlags = [
  { text: 'A school that is not on FMCSA\'s Training Provider Registry, or was removed from it: that training does not count toward your CDL.', src: ['cfr-380', 'tpr-home'] },
  { text: 'Pay quoted as "up to." It is the top of the range, not what most first-year drivers make.', src: ['walmart-fleet', 'tmc'] },
  { text: 'A training contract with no written exit terms. Ask what you owe if you leave or are let go.', src: ['cfpb-traps', 'tmc'] },
]
export const whatEndsIt = [
  { text: 'A failed or refused drug or alcohol test: your state removes the CDL until you finish return-to-duty.', src: ['ch-downgrade'] },
  { text: 'A DUI, even in your own car: 1 year off commercial vehicles for a first offense, life for a second.', src: ['cfr-383-51'] },
  { text: 'Marijuana, including medical or state-legal use.', src: ['ch-marijuana'] },
  { text: 'Letting your medical certificate lapse: you need a current one to drive.', src: ['cfr-391-45'] },
]

// FAQ — visible on the page and mirrored in FAQPage JSON-LD (only Q&As shown on the page).
export const faq = [
  {
    q: 'Can I drive a truck at 18?',
    a: { text: 'Yes, but only inside your state, where the state allows it, with a K restriction on the license. Crossing state lines requires age 21, and the federal pilot that let some younger drivers do it ended on November 7, 2025.', src: ['cfr-391-11', 'cfr-383-153', 'crs-sdap'] },
  },
  {
    q: 'Is company-paid CDL training free?',
    a: { text: 'Usually only if you stay. Prime charges nothing if you drive for it for 1 year after your CDL; TMC asks the same year and charges a prorated part of the cost if you leave early. Get the exit terms in writing before you sign.', src: ['prime-train', 'tmc', 'cfpb-traps'] },
  },
  {
    q: 'How long does it take to get a CDL?',
    a: { text: 'A few weeks to a few months. Werner says CDL training takes about four weeks on average, and Prime trains you with an instructor for 2 to 4 weeks before the CDL exam. You must hold the permit at least 14 days before the skills test, and a community college program can run 16 weeks.', src: ['werner', 'prime-train', 'cfr-383-25', 'pima'] },
  },
  {
    q: 'What do truck drivers make?',
    a: { text: 'The median for heavy and tractor-trailer drivers was $58,640 a year in May 2025, and the lowest 10% earned under $40,140. Carrier ads that say "up to" quote the top of the range, not the usual.', src: ['bls-truck', 'walmart-fleet', 'tmc'] },
  },
  {
    q: 'Can a failed drug test end a CDL?',
    a: { text: 'Yes. A violation puts you in prohibited status in the federal Clearinghouse, and your state removes your CDL or permit until you finish the return-to-duty process. On November 1, 2026, FMCSA counted 79.5% of drivers in that status who had not begun it.', src: ['ch-downgrade', 'ch-monthly'] },
  },
  {
    q: 'How do I know a CDL school is real?',
    a: { text: 'Look it up on FMCSA\'s Training Provider Registry at tpr.fmcsa.dot.gov before you pay. Training given after a school\'s removal date does not count.', src: ['tpr-home', 'cfr-380'] },
  },
]

// ── Listings: the filters on the "Hiring now" block (lib/start/listingFilters.js) ──────────────────────────────────
// Measured on seenjobs.io 2026-11-14 (Dallas, TX, 50 mi, and nationwide): a "truck driver", "tanker driver" or
// "student driver" search also answers couriers, Amazon Flex, van and package delivery, a "Student Driver" afterschool
// teacher and NON-CDL jobs. So every row must name CDL work in its title (the gate: CDL / Class A or B / truck driver /
// tractor-trailer / OTR / tanker / hazmat / box, straight or dump truck / yard driver…), and lease-purchase,
// owner-operator and 1099 contract-driver offers are never shown (the guide warns about them; they are not a way in).
// Level: a plain "CDL A Truck Driver" needs a CDL, so the entry level needs a marker — trainee, entry, no experience,
// apprentice, or the posting's own paid-training offer ("Paid CDL training" sets `trains_beginners`). The other level
// is labelled "CDL required", never "experienced": many plain titles are open to new CDL holders.
const CDL_TITLE = '\\b(cdl|cdl-?a|cdl-?b|class[- ]?a|class[- ]?b|truck\\s?driv\\w*|trucker|tractor[- ]trailer|semi[- ]?(?:truck )?driver|otr|over[- ]the[- ]road|long[- ]haul|regional driver|team driver|tank(?:er)? driver|tanker|hazmat|haz-mat|flatbed|reefer|dry van|box truck|straight truck|dump truck|mixer driver|linehaul|line haul|yard (?:driver|jockey|hostler|spotter)|hostler|spotter driver|driver trainee|student (?:truck )?driver)\\b'
export const listings = {
  defaultRadius: '50',
  radii: ['25', '50', '100', '250'],
  levelMode: 'entryNeedsMarker',
  levelLabels: { any: 'Any level', entry: 'Trainee / new driver', experienced: 'CDL required' },
  levelWords: { entry: 'trainee and entry-level', experienced: 'CDL-required' },
  gateTitle: CDL_TITLE,
  exclude: '\\b(instructor|recruiter|recruiting|sales|dispatcher|dispatch|mechanic|technician|manager|coordinator|planner|teacher|courier|non\\s*-?\\s*cdl|cdl not required|lease|leased|owner[- ]?operators?|1099|sub hauler)\\b',
  positions: [
    { id: 'all', label: 'All CDL jobs', noun: 'CDL driving', queries: ['truck driver', 'cdl driver', 'class a driver'], match: 'driv|\\bcdl\\b|trucker|hostler|spotter|jockey', prefer: 'trainee|student|apprentice|paid (?:cdl )?training|no experience|entry', seeAll: 'truck driver' },
    { id: 'trainee', label: 'Trainee / paid training', noun: 'CDL trainee', queries: ['cdl trainee', 'truck driver', 'cdl driver', 'cdl a truck driver', 'student truck driver'], orTraining: true, match: 'trainee|student|apprentice|paid (?:cdl )?training|cdl training|no experience|entry[- ]level|recent grad\\w*|new cdl|earn your cdl|get your cdl', seeAll: 'cdl trainee' },
    { id: 'otr', label: 'OTR / regional', noun: 'OTR and regional', queries: ['otr truck driver', 'regional truck driver'], match: '\\botr\\b|over[- ]the[- ]road|long[- ]haul|regional|\\bteams?\\b|dedicated' },
    { id: 'local', label: 'Local / home daily', noun: 'local CDL', queries: ['local cdl driver', 'local truck driver'], match: '\\blocal\\b|home daily|home every night|home nightly|day cab|\\bp&d\\b|pickup (?:and|&) delivery|route driver' },
    { id: 'class-b', label: 'Class B / box truck', noun: 'Class B', queries: ['cdl b driver', 'box truck driver', 'dump truck driver'], match: 'class[- ]?b\\b|cdl[- ]?b\\b|box truck|straight truck|dump truck|mixer' },
    { id: 'tanker', label: 'Tanker / hazmat', noun: 'tanker and hazmat', queries: ['tanker driver', 'hazmat driver', 'fuel truck driver'], match: '\\btank|hazmat|haz-mat|\\bfuel\\b|chemical|bulk' },
    { id: 'yard', label: 'Yard / spotter', noun: 'yard and spotter', queries: ['yard driver', 'yard jockey', 'spotter driver'], match: '\\byard\\b|spotter|hostler|jockey|shifter' },
  ],
}

// ── The page's openable rows (components/start/Guide.tsx Blocks renders each block type) ──────────────────────────
export const menu = [
  {
    id: 'steps', title: 'The steps to a CDL', summary: 'Permit, physical, training, skills test',
    blocks: [
      { type: 'steps', items: steps },
      { type: 'callout', entry: schoolCheck },
      { type: 'more', title: 'Classes and endorsements', blocks: [
        { type: 'checklist', items: classes },
        { type: 'text', entry: classAFirst, lead: 'From drivers:' },
      ] },
    ],
  },
  {
    id: 'who-can-drive', title: 'Who can drive', summary: 'Age, medical card, drug tests, record',
    blocks: [
      { type: 'checklist', items: whoCan, cols: true },
      { type: 'more', title: 'More on screening, and the sleep apnea card', blocks: [
        { type: 'notes', items: whoCanMore },
        { type: 'text', entry: sleepApnea, lead: 'From drivers:' },
      ] },
    ],
  },
  {
    id: 'paying-for-school', title: 'Paying for school', summary: 'Carrier-paid, community college, employer',
    blocks: [
      { type: 'doors', items: [doors.carrier, doors.school, doors.employer] },
      { type: 'callout', entry: contractLine },
      { type: 'more', title: 'What drivers say about training contracts', blocks: [
        { type: 'text', plain: 'Several accounts agree on each of these.' },
        { type: 'notes', items: contractsSay },
      ] },
    ],
  },
  {
    id: 'first-year', title: 'Your first year', summary: 'The work, the hours, and real pay',
    blocks: [
      { type: 'text', entries: firstYear },
      { type: 'heading', text: 'What drivers who got in say' },
      { type: 'steps', items: driversSay },
      { type: 'checklist', items: howPaid, cols: true },
      { type: 'callout', entry: upTo },
      { type: 'more', title: 'Pay across the country', blocks: [
        { type: 'table', caption: 'Truck driver pay across the country', columns: [{ key: 'what', label: 'What' }, { key: 'figure', label: 'Pay', num: true }], rows: payRows },
        { type: 'text', entry: payNote },
      ] },
      { type: 'resumeLink', before: 'Before you apply, you can', label: 'check your résumé against a posting' },
    ],
  },
  {
    id: 'watch-out', title: 'Watch out', icon: 'caution', summary: 'Red flags, and what ends a CDL',
    blocks: [
      { type: 'notesGrid', groups: [
        { label: 'Red flags', items: redFlags, icon: 'x' },
        { label: 'What can end a CDL', items: whatEndsIt, icon: 'x' },
      ] },
    ],
  },
  { id: 'questions', title: 'Common questions', summary: 'Age, cost, time, pay, drug tests', blocks: [{ type: 'faq', items: faq }] },
]

// ── Additional resources: every reference above, as plain grouped links (no numbers, closed by default) ────────────
export const resourcesSummary = 'Federal rules, training, carriers, pay data'
export const resources = [
  { title: 'Getting the license', items: [
    { key: 'cfr-383-25', name: 'The commercial learner\'s permit (49 CFR 383.25)' },
    { key: 'cfr-380', name: 'Entry-level driver training rules (49 CFR Part 380)' },
    { key: 'tpr-home', name: 'Training Provider Registry: look up a school (FMCSA)' },
    { key: 'tpr-faq', name: 'Training requirements, questions and answers (FMCSA)' },
    { key: 'cfr-383-91', name: 'CDL classes (49 CFR 383.91)' },
    { key: 'cfr-383-93', name: 'Endorsements (49 CFR 383.93)' },
    { key: 'cfr-383-153', name: 'What a CDL shows, including the intrastate restriction (49 CFR 383.153)' },
    { key: 'tsa-hme', name: 'Hazmat endorsement background check (TSA)' },
    { key: 'ca-dmv-cdl', name: 'Commercial driver\'s licenses (California DMV)' },
    { key: 'ca-fees', name: 'License fees (California DMV)' },
    { key: 'tx-fees', name: 'Driver license fees (Texas DPS)' },
    { key: 'fl-fees', name: 'License fees (Florida HSMV)' },
  ] },
  { title: 'Who can drive', items: [
    { key: 'cfr-391-11', name: 'Driver qualifications: age and English (49 CFR 391.11)' },
    { key: 'crs-sdap', name: 'The under-21 driver pilot (Congressional Research Service)' },
    { key: 'cfr-391-41', name: 'Medical standards (49 CFR 391.41)' },
    { key: 'cfr-391-45', name: 'Who needs a medical certificate (49 CFR 391.45)' },
    { key: 'fr-medcard', name: 'Paper medical cards, October 2026 (Federal Register)' },
    { key: 'fr-elp', name: 'English proficiency proposal, August 2026 (Federal Register)' },
    { key: 'fr-nondom', name: 'Non-domiciled CDL rule, February 2026 (Federal Register)' },
    { key: 'cfr-383-51', name: 'Disqualifying offenses (49 CFR 383.51)' },
  ] },
  { title: 'Drug and alcohol testing', items: [
    { key: 'cfr-382-701', name: 'Clearinghouse checks by employers (49 CFR 382.701)' },
    { key: 'cfr-382-301', name: 'Pre-employment drug tests (49 CFR 382.301)' },
    { key: 'ch-downgrade', name: 'CDL downgrades for prohibited drivers (FMCSA Clearinghouse)' },
    { key: 'ch-monthly', name: 'Clearinghouse monthly report, October 2026 (FMCSA)' },
    { key: 'ch-marijuana', name: 'Marijuana and DOT testing, February 2026 (FMCSA Clearinghouse)' },
  ] },
  { title: 'Carrier training programs', items: [
    { key: 'prime-train', name: 'Prime student driver training' },
    { key: 'tmc', name: 'TMC Transportation: new to trucking' },
    { key: 'roehl', name: 'Roehl CDL truck driving schools' },
    { key: 'knight-school', name: 'Knight CDL school' },
    { key: 'werner', name: 'Werner CDL training' },
    { key: 'stevens', name: 'Stevens Transport CDL training' },
    { key: 'schneider-cat', name: 'Schneider paid CDL training' },
    { key: 'schneider-cost', name: 'What a CDL costs (Schneider blog)' },
    { key: 'crst', name: 'CRST driving careers' },
    { key: 'walmart-fleet', name: 'Walmart Private Fleet: regional truck driver posting' },
    { key: 'walmart-a2d', name: 'Walmart Associate to Driver' },
    { key: 'amazon-cc', name: 'Amazon Career Choice truck driver training' },
  ] },
  { title: 'Community colleges', items: [
    { key: 'pima', name: 'Pima Community College CDL Class A (Arizona Job Connection)' },
    { key: 'mcc-nh', name: 'Manchester Community College CDL Class A' },
  ] },
  { title: 'Work, pay and contracts', items: [
    { key: 'bls-truck', name: 'Heavy and tractor-trailer truck drivers (Bureau of Labor Statistics)' },
    { key: 'bls-light', name: 'Delivery truck drivers (Bureau of Labor Statistics)' },
    { key: 'cfr-395-3', name: 'Hours of service (49 CFR 395.3)' },
    { key: 'dol-flsa', name: 'Overtime and the motor carrier exemption (Department of Labor)' },
    { key: 'oig-detention', name: 'Driver detention at docks (DOT Inspector General)' },
    { key: 'cfpb-traps', name: 'Training repayment agreements (Consumer Financial Protection Bureau)' },
  ] },
  { title: 'Community discussions', items: [
    { key: 'r-1u3ma8r', name: 'A 90-day medical card for possible sleep apnea' },
    { key: 'r-1wh7yqk', name: 'The DOT physical and sleep apnea' },
    { key: 'r-1sqmmkg', name: 'What drivers made their first year' },
    { key: 'r-1tzrv9e', name: 'First-year over-the-road earnings' },
    { key: 'r-1q1pf77', name: 'A first full year trucking' },
    { key: 'r-1w4cd75', name: 'First-year pay and training contracts' },
    { key: 'r-1xgf2xl', name: 'Is getting a CDL worth it' },
    { key: 'r-1qi3oe8', name: 'Local jobs after a year over the road' },
    { key: 'r-1weumxg', name: 'Stuck under a training contract' },
    { key: 'r-1nj1cn4', name: 'Signing a year contract' },
    { key: 'r-1tsi6up', name: 'A Knight training contract' },
    { key: 'r-1xqqunf', name: 'Class A or Class B' },
  ] },
]

/** Every fact on the page, in reading order: the hero, then each menu row. */
export function pageEntries() {
  return [guide.answer, ...tiles, ...blockEntries(menu)]
}
