// /start/trades — "Getting into the trades". The page renders from this module only, so every figure on it
// carries a source and an as-of date (lib/start/guides.test.mjs fails on a figure without one).
//
// THE ONLY SOURCE OF FACTS is the research file compiled 2026-11-13 (session scratchpad research/trades.md).
// Rules this module keeps:
//   • only items the research marked VERIFIED (government, a union / JATC, an employer's own page or posting);
//   • FIRST-HAND items only as `firstHand: true`, rendered as what people say, never as fact;
//   • nothing from the research's UNVERIFIED / CONFLICTING list: no stanine cutoff, no lineman 60/65/70% table,
//     no "exactly 50%" elevator first year, no Schneider or Werner reimbursement amounts, no Prime exit amount,
//     no CRST figures, no Vestas program, no lineman-college total, no Rosendin program cost, no national
//     "$80,000 after an apprenticeship";
//   • union rules are LOCAL: a wage, a window or a cutoff from one local is shown as that local's, never national;
//   • no hype, no guarantees, no exclamation marks; competition and contract payback terms are said plainly.
//
// Shape: `sources` (every reference behind the page, kept here and never printed as citations — readers reach the
// links through the grouped "Additional resources" menu, `resources` below), entries `{ text, src, firstHand? }`, the
// listings filter config (`listings`) and the openable menu rows (`menu`).

import { blockEntries } from './entries.js'

/** @typedef {{ label: string, url: string, date: string, note?: string }} Source */

/** @type {Record<string, Source>} */
export const sources = {
  'bls-elec': { label: 'U.S. Bureau of Labor Statistics, Occupational Outlook Handbook: Electricians (May 2025 pay)', url: 'https://www.bls.gov/ooh/construction-and-extraction/electricians.htm', date: '2026-08-27', note: 'page updated' },
  'bls-plumb': { label: 'BLS Occupational Outlook Handbook: Plumbers, Pipefitters, and Steamfitters (May 2025 pay)', url: 'https://www.bls.gov/ooh/construction-and-extraction/plumbers-pipefitters-and-steamfitters.htm', date: '2026-10-29', note: 'page updated' },
  'bls-hvac': { label: 'BLS Occupational Outlook Handbook: Heating, Air Conditioning, and Refrigeration Mechanics and Installers (May 2025 pay)', url: 'https://www.bls.gov/ooh/installation-maintenance-and-repair/heating-air-conditioning-and-refrigeration-mechanics-and-installers.htm', date: '2026-10-29', note: 'page updated' },
  'bls-weld': { label: 'BLS Occupational Outlook Handbook: Welders, Cutters, Solderers, and Brazers (May 2025 pay)', url: 'https://www.bls.gov/ooh/production/welders-cutters-solderers-and-brazers.htm', date: '2026-10-29', note: 'page updated' },
  'bls-line': { label: 'BLS Occupational Outlook Handbook: Line Installers and Repairers (May 2025 pay)', url: 'https://www.bls.gov/ooh/installation-maintenance-and-repair/line-installers-and-repairers.htm', date: '2026-08-27', note: 'page updated' },
  'bls-elev': { label: 'BLS Occupational Outlook Handbook: Elevator and Escalator Installers and Repairers (May 2025 pay)', url: 'https://www.bls.gov/ooh/construction-and-extraction/elevator-installers-and-repairers.htm', date: '2026-10-29', note: 'page updated' },
  'bls-equip': { label: 'BLS Occupational Outlook Handbook: Construction Equipment Operators (May 2025 pay)', url: 'https://www.bls.gov/ooh/construction-and-extraction/construction-equipment-operators.htm', date: '2026-10-29', note: 'page updated' },
  'bls-diesel': { label: 'BLS Occupational Outlook Handbook: Diesel Service Technicians and Mechanics (May 2025 pay)', url: 'https://www.bls.gov/ooh/installation-maintenance-and-repair/diesel-service-technicians-and-mechanics.htm', date: '2026-10-29', note: 'page updated' },
  'bls-truck': { label: 'BLS Occupational Outlook Handbook: Heavy and Tractor-trailer Truck Drivers (May 2025 pay)', url: 'https://www.bls.gov/ooh/transportation-and-material-moving/heavy-and-tractor-trailer-truck-drivers.htm', date: '2026-08-27', note: 'page updated' },
  'ibew11': { label: 'IBEW Local 11 / LA NECA (Los Angeles), inside wage rates', url: 'https://laneca.org/wp-content/uploads/2026/10/2026-10-11-Inside-wage-rates.pdf', date: '2026-10-26', note: 'rates effective' },
  'jatc26': { label: 'IBEW/NECA JATC Local 26 (Washington, DC area), inside wireman apprenticeship', url: 'https://www.jatc26.org/?p=149', date: '2026-06-01', note: 'rates as of' },
  'ua469': { label: 'Arizona Pipe Trades (UA Local 469), 2026–2027 wage and fringe rates', url: 'https://ualocal469.org/wp-content/uploads/2026/06/AZPT-2026-2027-Wage-Fringe-Rates-6.5.26-Update.pdf', date: '2026-07-01', note: 'rates effective' },
  'neiep-help': { label: 'National Elevator Industry Educational Program (NEIEP), help and FAQ', url: 'https://neiep.org/Help', date: '2026-11-13', note: 'read' },
  'neiep-recruit': { label: 'NEIEP, elevator apprenticeship recruitment opportunities', url: 'https://www.neiep.org/elevator-apprenticeship-recruitment-opportunities', date: '2026-11-13', note: 'read' },
  'eta-prep': { label: 'Electrical Training Alliance (IBEW/NECA), Preparing for the Test', url: 'https://electricaltrainingalliance.org/SamplePage/PreparingfortheTest', date: '2026-11-13', note: 'read' },
  'eta-apply': { label: 'Electrical Training Alliance (IBEW/NECA), Applying for Apprenticeship', url: 'https://electricaltrainingalliance.org/SamplePage/ApplyingforApprenticeship', date: '2026-11-13', note: 'read' },
  'eta-training': { label: 'Electrical Training Alliance, apprenticeship training and Locate a Training Center', url: 'https://www.electricaltrainingalliance.org/training/apprenticeshipTraining', date: '2026-11-13', note: 'read' },
  'ua-apprentice': { label: 'United Association (UA), apprenticeship', url: 'https://www.ua.org/apprenticeship', date: '2026-11-13', note: 'read' },
  'iuoe501': { label: 'IUOE Local 501 (Las Vegas) 2026 apprenticeship notice, Nevada Labor Commissioner', url: 'https://labor.nv.gov/uploadedFiles/labornvgov/content/Apprenticeship_Council/Announcements/2026_Apprenticeship_Opportunity_Offical_Notice.pdf', date: '2026-06-01', note: 'applications opened' },
  'smart10': { label: 'SMART Sheet Metal Workers Local 10, training and education', url: 'https://smw10.org/trainingeducation.html', date: '2026-11-13', note: 'read' },
  'nwline': { label: 'Northwest Line JATC apprenticeship standards (Washington L&I)', url: 'https://lni.wa.gov/licensing-permits/apprenticeship/agenda-docs/25NorthwestLine.pdf', date: '2026-11-13', note: 'read' },
  'rotorooter': { label: 'Roto-Rooter, service technician careers page', url: 'https://www.rotorooter.com/careers/service-tech/', date: '2026-11-13', note: 'read' },
  'electric-boat': { label: 'General Dynamics Electric Boat, Welder – Entry Level, posting 20028, Quonset Point (own job board)', url: 'https://careers-gdeb.icims.com/jobs/20028/welder---entry-level/job', date: '2026-11-14', note: 'read' },
  'georgia-power': { label: 'Georgia Power, Lineworker Entry Program', url: 'https://www.georgiapower.com/about/company/careers/lineworker-entry.html', date: '2026-11-13', note: 'read' },
  'service-experts': { label: 'Service Experts, apprenticeship programs (company blog)', url: 'https://www.serviceexperts.com/blog/apprenticeship-programs-offer-short-and-long-term-benefits', date: '2025-08-07', note: 'page updated' },
  'thinkbig': { label: 'Thompson Tractor (Caterpillar dealer), ThinkBIG program', url: 'https://thompsontractor.com/careers/thinkbig-program/', date: '2026-11-13', note: 'read' },
  'mrrooter': { label: 'Mr. Rooter Plumbing, brand entity statement', url: 'https://www.mrrooter.com/about/mr-rooter-brand-entity/', date: '2026-11-13', note: 'read' },
  'onehour': { label: 'One Hour Heating & Air Conditioning, site map (Authority Brands franchise locations)', url: 'https://www.onehourheatandair.com/site-map', date: '2026-11-13', note: 'read' },
  'prime': { label: 'Prime Inc., student driver training program (own page)', url: 'https://www.driveforprime.com/train/student-driver-training-program/', date: '2026-11-14', note: 'read' },
  'schneider': { label: 'Schneider, paid CDL training for inexperienced drivers', url: 'https://schneiderjobs.com/truck-driving-jobs/inexperienced/paid-cdl-training', date: '2026-11-13', note: 'read' },
  'cfpb-traps': { label: 'Consumer Financial Protection Bureau, 2023 report on employer-driven debt (archived)', url: 'https://www.consumerfinance.gov/about-us/newsroom/cfpb-report-shows-workers-face-risks-from-employer-driven-debt', date: '2023-07-20', note: 'published' },
  'cfr-391-11': { label: '49 CFR 391.11, qualifications of commercial drivers (Cornell Legal Information Institute)', url: 'https://www.law.cornell.edu/cfr/text/49/391.11', date: '2026-11-13', note: 'read' },
  'fmcsa-tpr': { label: 'FMCSA Training Provider Registry', url: 'https://tpr.fmcsa.dot.gov/', date: '2026-11-13', note: 'read' },
  'apprenticeship-gov': { label: 'U.S. Department of Labor, Apprenticeship Finder', url: 'https://www.apprenticeship.gov/apprenticeship-job-finder', date: '2026-11-13', note: 'read' },
  'njca-jobcorps': { label: 'National Job Corps Association, settlement with the Department of Labor', url: 'https://njcaweb.org/njca-dol-reach-settlement-agreement-to-keep-job-corps-open/', date: '2026-09-01', note: 'announced' },
  'knpr-jobcorps': { label: 'KNPR, Job Corps is having a comeback', url: 'https://knpr.org/2026-10-09/job-corps-is-having-a-comeback-and-teaching-potentially-ai-proof-trades', date: '2026-10-09', note: 'published' },
  'h2h': { label: 'Helmets to Hardhats, about', url: 'https://helmetstohardhats.org/about-h2h', date: '2026-11-13', note: 'read' },
  'youthbuild': { label: 'U.S. Department of Labor, YouthBuild', url: 'https://www.dol.gov/agencies/eta/youth/youthbuild', date: '2026-11-13', note: 'read' },
  'dol-preapp': { label: 'U.S. Department of Labor, Training and Employment Notice 05-26 (pre-apprenticeship quality framework)', url: 'https://www.dol.gov/sites/dolgov/files/ETA/advisories/TEN/2026/TEN%2005-26/TEN%2005-26%201.pdf', date: '2026-11-13', note: 'read' },
  'neiep-guide': { label: 'NEIEP, EIAT study guide', url: 'https://www.neiep.org/wp-content/uploads/2024/08/study-guide-eiat-2024.pdf', date: '2024-08', note: 'published' },
  'cfr-686-400': { label: '20 CFR 686.400, who is eligible for Job Corps (Cornell Legal Information Institute)', url: 'https://www.law.cornell.edu/cfr/text/20/686.400', date: '2026-11-14', note: 'read' },
  'uti-catalog': { label: 'Universal Technical Institute catalog, tuition (enrollment on or after Aug 1, 2026)', url: 'https://catalogs.uti.edu/node/952', date: '2026-11-13', note: 'read' },
  'osha-forklift': { label: 'OSHA, powered industrial trucks: training requirements', url: 'https://www.osha.gov/training/library/powered-industrial-trucks/general-industry', date: '2026-11-13', note: 'read' },
  'ftc-scams': { label: 'Federal Trade Commission, Job Scams (consumer advice)', url: 'https://consumer.ftc.gov/articles/job-scams', date: '2023-03', note: 'article dated' },
  // First-hand accounts (Reddit threads read through the Arctic Shift archive); never presented as fact.
  'r-ibew551': { label: 'r/ibew_applicants, "Local 551 devastating news"', url: 'https://reddit.com/r/ibew_applicants/comments/1w76xl5/local_551_devastating_news/', date: '2026-09-04', note: 'thread' },
  'r-seven': { label: 'r/ibew_applicants, "My experience trying and failing to get into the…"', url: 'https://reddit.com/r/ibew_applicants/comments/1s98880/my_experience_trying_and_failing_to_get_into_the/', date: '2026-04-01', note: 'thread' },
  'r-waiting': { label: 'r/IBEW, "What job did you work while waiting for the apprenticeship?"', url: 'https://reddit.com/r/IBEW/comments/1vnbf03/what_job_did_you_work_while_waiting_for_the/', date: '2026-08-13', note: 'thread' },
  'r-utility': { label: 'r/Lineman, "Am I just wasting my time… thinking I\'ll get a utility apprenticeship?"', url: 'https://reddit.com/r/Lineman/comments/1v0xknj/am_i_just_wasting_my_timebeing_foolish_by/', date: '2026-07-19', note: 'thread' },
  'r-weldschool': { label: 'r/skilledtrades, "I feel like the trade school for welding was a waste of time and money"', url: 'https://reddit.com/r/skilledtrades/comments/1wvcca7/i_feel_like_the_trade_school_for_welding_was_a/', date: '2026-10-01', note: 'thread' },
  'r-weld2': { label: 'r/skilledtrades, "I want to go into welding but everyone tells me…"', url: 'https://reddit.com/r/skilledtrades/comments/1xue8zb/i_want_to_go_into_welding_but_everyone_tells_me/', date: '2026-11-12', note: 'thread' },
  'r-age34': { label: 'r/IBEW, "Is 34 too old to apply for apprenticeship?"', url: 'https://reddit.com/r/IBEW/comments/1q0de2f/is_34_too_old_to_apply_for_apprenticeship/', date: '2025-12-31', note: 'thread' },
  'r-weed': { label: 'r/ibew_applicants, "I wish someone would\'ve told me they make such a big deal about weed"', url: 'https://reddit.com/r/ibew_applicants/comments/1uws5bn/i_wish_someone_wouldve_told_me_they_make_such_a/', date: '2026-07-15', note: 'thread' },
}

export const guide = {
  path: '/start/trades',
  title: 'Getting into the trades',
  crumbLabel: 'The trades',
  eyebrow: 'Guide',
  // The one-sentence answer under the h1 (the page's first screen).
  answer: { text: 'Apprenticeships pay you from day one; helper and trainee jobs pay you now. Here is how each door works, what it pays and how to get through it.', src: ['bls-elec', 'rotorooter'] },
  metaDescription: 'How to get into the skilled trades with no experience: paid apprenticeships and what they pay to start, the IBEW aptitude test, employers that train, free programs, live apprentice and journeyman listings near you, and contract terms to read first.',
  asOf: '2026-11-14',
}

// The three readings in the hero: each restates a sourced fact below, with the same sources.
export const tiles = [
  { label: 'First-year apprentice pay', value: '$26.43–$27.90', text: 'an hour, 40% to 50% of journeyman, at three locals in 2026', src: ['ibew11', 'jatc26', 'ua469'] },
  { label: 'Applicants per opening', value: '4–6+', text: 'what union electrical programs often get', src: ['eta-prep'] },
  { label: 'Median pay', value: '$53,750–$109,910', text: 'a year in the trade, across nine trades, May 2025', src: ['bls-weld', 'bls-elev'] },
]

// 1. Two doors. Examples are `{ who, figure, text }` rows: the figure is what a reader scans for.
export const doors = {
  apprenticeship: {
    title: 'A registered apprenticeship',
    lead: { text: 'Hired, paid from the first day, and taught in class at the same time. Pay starts at a share of the journeyworker rate and rises as you go. Electricians train 4 to 5 years, about 2,000 paid hours a year.', src: ['bls-elec'] },
    examples: [
      { who: 'IBEW Local 11, Los Angeles', figure: '$26.80/hr', text: '40% of the $67.00 journeyman rate, first period, from October 26, 2026', src: ['ibew11'] },
      { who: 'JATC Local 26, Washington, DC area', figure: '$27.90/hr', text: '45% of $62.00, as of June 1, 2026', src: ['jatc26'] },
      { who: 'UA Local 469, Arizona Pipe Trades', figure: '$26.43/hr', text: '50% in the first year, commercial work, July 2026 to June 2027', src: ['ua469'] },
      { who: 'Elevator apprentices', figure: 'About 40–50%', text: 'of mechanic pay in the first year', src: ['neiep-help'] },
    ],
    note: { text: 'These are single locals\' rates on their own wage sheets, not national figures. Union classes are usually free or low cost; NEIEP says elevator school has no out-of-pocket cost beyond a $25 testing fee.', src: ['neiep-help'] },
  },
  now: {
    title: 'A job that trains you now',
    lead: { text: 'Helper, trainee and entry-level jobs pay less than a journeyworker, but they pay, and documented hours help later: IBEW/NECA programs can waive some minimums for them, and SMART Local 10 ranks applicants partly on work experience.', src: ['eta-apply', 'smart10'] },
    examples: [
      { who: 'Roto-Rooter, company-run branches', figure: '$55k–$65k', text: 'its stated first-year range, by location, after 11 to 13 weeks of paid training', src: ['rotorooter'] },
      { who: 'General Dynamics Electric Boat', figure: 'Paid training', text: 'entry-level welder: "no welding experience or training required"; a bend test after training', src: ['electric-boat'] },
    ],
    note: null,
  },
}

// 2. Trade by trade. `path` and `length` are plain words; the median carries its BLS source.
export const tradeRows = [
  { trade: 'Electrician', path: 'IBEW/NECA or merit-shop apprenticeship; helper jobs at contractors', length: '4 to 5 years', apply: 'Your local JATC (Electrical Training Alliance "Locate a Training Center"); aptitude test and interview', median: '$63,190', src: ['bls-elec', 'eta-training'] },
  { trade: 'Plumber or pipefitter', path: 'UA apprenticeship; service-company training', length: 'UA: typically 5 years', apply: 'Your UA local; service companies hire trainees directly', median: '$63,800', src: ['bls-plumb', 'ua-apprentice', 'rotorooter'] },
  { trade: 'HVAC/R technician', path: 'A 6-month to 2-year program, or an apprenticeship of several years', length: '6 months to several years', apply: 'Employer training programs, UA or sheet metal locals; EPA Section 608 certification is needed to handle refrigerant', median: '$61,010', src: ['bls-hvac'] },
  { trade: 'Welder', path: 'A union trade that welds (pipefitters, ironworkers, boilermakers), or a certificate plus an employer weld test', length: 'Varies', apply: 'Weld test at the employer; some shipyards train from zero', median: '$53,750', src: ['bls-weld', 'electric-boat'] },
  { trade: 'Lineworker', path: 'Outside line JATC or a utility apprenticeship; groundman first', length: 'Up to 3 years; 7,000 hours at Northwest Line JATC', apply: 'Regional line JATCs and utilities; some ask for a Class A CDL before you apply', median: '$95,320', src: ['bls-line', 'nwline'] },
  { trade: 'Elevator mechanic', path: 'IUEC union apprenticeship run with NEIEP', length: '8 semesters', apply: 'NEIEP recruitment portal; each local opens about every 2 years', median: '$109,910', src: ['bls-elev', 'neiep-help', 'neiep-recruit'] },
  { trade: 'Heavy equipment operator', path: 'Operating Engineers (IUOE) apprenticeship, or learning on light equipment on the job', length: '3 to 4 years', apply: 'Your IUOE local; check whether it trains equipment operators or stationary engineers', median: '$59,600', src: ['bls-equip', 'iuoe501'] },
  { trade: 'Diesel mechanic', path: 'On-the-job training after high school; some employers prefer a diesel program; dealer programs', length: 'Varies', apply: 'Dealers and fleets; Caterpillar dealer ThinkBIG programs alternate college and paid internships', median: '$61,770', src: ['bls-diesel', 'thinkbig'] },
  { trade: 'CDL truck driver', path: 'CDL school or company-paid training', length: 'School programs can run 3 to 6 months', apply: 'Training must come from a provider on FMCSA\'s Training Provider Registry; driving across state lines requires age 21', median: '$58,640', src: ['bls-truck', 'fmcsa-tpr', 'cfr-391-11'] },
]
export const tradeNote = { text: 'Medians are national yearly pay for May 2025 and include union and non-union workers.', src: ['bls-elec'] }

// 3. The aptitude test (IBEW/NECA) and what committees weigh. `facts` are checklist rows: `name` is what a reader
// scans, `text` the detail.
export const test = {
  intro: 'The electrical apprenticeship test, as the IBEW/NECA Electrical Training Alliance describes it.',
  facts: [
    { name: 'Algebra and reading, no calculator', text: 'Algebra and functions: 33 questions in 46 minutes. Reading comprehension: 36 questions in 51 minutes.', src: ['eta-apply'] },
    { name: 'A diploma or GED and a year of algebra', text: 'One full year of high school algebra with a passing grade. "Previous knowledge of electrical work is not required." Programs typically also ask for age 18 and a drug test.', src: ['eta-apply', 'eta-training'] },
    { name: 'Qualified or not, with a retake after 90 days', text: 'You are told only whether you qualified.', src: ['eta-apply'] },
    { name: 'Then an interview and a ranked list', text: 'The committee interview leads to a ranked list that lasts two years; names are taken in rank order as jobs open.', src: ['eta-apply'] },
  ],
  weigh: [
    { text: 'IUOE Local 501, a stationary engineers program in Las Vegas whose 2026 window has closed: "A good candidate is an individual who excelled in school, especially in math, demonstrates reliability, possesses a sincere desire to succeed, and has a positive attitude."', src: ['iuoe501'] },
    { text: 'SMART Local 10 ranks applicants by test score, work experience, high school grades and any sheet metal training.', src: ['smart10'] },
    { text: 'IBEW/NECA programs ask for official transcripts showing the algebra grade; documented electrical construction hours can waive some minimums.', src: ['eta-apply'] },
  ],
  prep: { text: 'Free practice: the Electrical Training Alliance publishes a sample test with an answer key, and NEIEP publishes a study guide for the elevator test.', src: ['eta-prep', 'neiep-guide'] },
}

// 4. Employers with paid training (verified programs only) + the caveats.
export const employers = [
  { name: 'Roto-Rooter', chip: { text: '11–13 weeks paid training', src: ['rotorooter'] }, text: 'Company or partner plumbing schools, with help logging apprentice hours toward a license.', src: ['rotorooter'] },
  { name: 'General Dynamics Electric Boat', chip: { text: 'No welding experience', src: ['electric-boat'] }, text: 'An entry-level welder job at Quonset Point, Rhode Island, in November 2026. It asks for a high school diploma or 2 years of technical experience, any shift, and your own basic hand tools.', src: ['electric-boat'] },
  { name: 'Georgia Power', chip: { text: '$21/hr during training', src: ['georgia-power'] }, text: 'A 6-week lineworker entry program at no cost to you. Not taking applications in November 2026.', src: ['georgia-power'] },
  { name: 'Service Experts', chip: { text: 'Free classes', src: ['service-experts'] }, text: 'Its company blog describes an in-house HVAC apprenticeship (Service Experts Career Academy) with free classes and a tool kit on completion. Ask whether it runs near you.', src: ['service-experts'] },
  { name: 'Caterpillar dealers (ThinkBIG)', chip: { text: 'Paid internships', src: ['thinkbig'] }, text: 'About two years alternating college classes and paid internships. At Thompson Tractor the dealer covers tuition, books, lab and graduation fees; you pay room, board and travel. Other dealers set their own terms, and the work commitment is not stated.', src: ['thinkbig'] },
]
// The one line the page shows above the contract details (which sit one tap away).
export const caveatLine = { text: 'Company-paid training often comes with a work commitment, and some repayment agreements make you owe money if you leave. Get the exit terms in writing before you sign.', src: ['prime', 'cfpb-traps'] }
export const employerCaveats = [
  { text: 'Franchise brands such as Mr. Rooter, Mister Sparky, One Hour Heating & Air and Benjamin Franklin Plumbing are independently owned locations, so training and pay differ by owner.', src: ['mrrooter', 'onehour'] },
  { text: 'Company-paid CDL training often comes with a work commitment. Prime says you pay nothing for its training as long as you drive for it for 1 year with your CDL; its page does not say what you owe if you leave early. Schneider pays during its training; its page does not state commitment or exit terms either.', src: ['prime', 'schneider'] },
  { text: 'A 2023 CFPB report found that training repayment agreements can "impede worker mobility." Ask for the exit terms in writing: is the amount prorated, is it the real cost, and what happens if you are let go.', src: ['cfpb-traps'] },
]

// 5. Free help.
export const freeHelp = [
  { name: 'Apprenticeship Finder', url: 'https://www.apprenticeship.gov/apprenticeship-job-finder', text: 'The Department of Labor\'s search of open registered apprenticeships by trade and place; you apply directly with the sponsor.', src: ['apprenticeship-gov'] },
  { name: 'Job Corps', url: 'https://enroll.jobcorps.gov', text: 'Free, residential training, including electrical, carpentry and heavy equipment, for low-income people aged 16 to 24 who also face a barrier such as no diploma, homelessness or foster care. A September 2026 settlement keeps it open through at least January 31, 2029.', src: ['njca-jobcorps', 'knpr-jobcorps', 'cfr-686-400'] },
  { name: 'Helmets to Hardhats', url: 'https://helmetstohardhats.org/about-h2h', text: 'Connects service members and veterans with registered apprenticeships in 15 building-trades unions. A matching service, not a school.', src: ['h2h'] },
  { name: 'YouthBuild', url: 'https://www.dol.gov/agencies/eta/youth/youthbuild', text: 'For ages 16 to 24 without a diploma: construction training while finishing a high school diploma or equivalency.', src: ['youthbuild'] },
  { name: 'Pre-apprenticeship programs', url: null, text: 'A quality program has a documented partnership with at least one registered apprenticeship. Ask which apprenticeships its graduates entered last year.', src: ['dol-preapp'] },
]

// 6. Common mistakes. `lead` is the mistake in a few words; `text` the detail.
export const mistakes = [
  { lead: 'Paying for school when an apprenticeship would pay you.', text: 'At one large for-profit school, HVAC/R costs $26,265 and welding $25,255; union apprenticeship classes are usually free or low cost. School is the normal door for some trades, such as HVAC and CDL driving.', src: ['uti-catalog', 'neiep-help', 'bls-hvac'] },
  { lead: 'Missing the window.', text: 'Elevator locals recruit about every 2 years, and other locals take applications only in set windows. NEIEP offers email alerts; for other trades, check the training center\'s page monthly.', src: ['neiep-recruit'] },
  { lead: 'Failing the math.', text: 'The electrical test is algebra without a calculator, with a 90-day wait to retake it. A college algebra course also meets the algebra requirement.', src: ['eta-apply'] },
  { lead: 'Missing paperwork.', text: 'Official transcripts, a diploma or GED, and originals where asked. IUOE Local 501 (stationary engineers, Las Vegas) asks for original documents.', src: ['eta-apply', 'iuoe501'] },
  { lead: 'Failing the drug test.', text: 'IUOE Local 501\'s stationary engineers program in Las Vegas "still considers marijuana an illegal drug," and applicants say union programs test for it even where it is legal.', src: ['iuoe501', 'r-weed'] },
  { lead: 'Getting the wrong card.', text: 'Northwest Line JATC does not accept online First Aid/CPR cards, and OSHA requires the employer to train and evaluate a forklift operator in person, so an online-only forklift card is not proof.', src: ['nwline', 'osha-forklift'] },
  { lead: 'Treating a job titled "apprentice" as a registered apprenticeship.', text: 'Check that it is a registered apprenticeship on apprenticeship.gov, or ask for the program\'s registration.', src: ['apprenticeship-gov'] },
]

// What people who got in say (first-hand, several accounts).
export const peopleSay = [
  { text: 'Apply to several locals or utilities at once, and work a related job while you wait: a non-union shop, groundman, laborer.', src: ['r-waiting', 'r-utility'], firstHand: true },
  { text: 'Even ranked applicants can wait when work is slow; some locals took no one in a slow year, and some applicants apply to several locals for years.', src: ['r-ibew551', 'r-seven'], firstHand: true },
  { text: 'Welding school without a plan for the first job is the most common regret; the usual advice is a union trade that welds pipe.', src: ['r-weldschool', 'r-weld2'], firstHand: true },
  { text: 'Starting later is common: people report getting in at 36, 38, 41 and 51.', src: ['r-age34'], firstHand: true },
]

// Scams and red flags (FTC).
export const scams = [
  { text: 'The FTC: honest employers "will never ask you to pay to get a job." Real programs charge small application or test fees to the program itself, such as NEIEP\'s $25, not to a recruiter or placement firm.', src: ['ftc-scams', 'neiep-help'] },
  { text: 'Before paying a CDL school, check that it is on FMCSA\'s Training Provider Registry.', src: ['fmcsa-tpr'] },
]

// FAQ — visible on the page and mirrored in FAQPage JSON-LD.
export const faq = [
  {
    q: 'Do apprentices get paid?',
    a: { text: 'Yes, from the first day. Pay starts at a share of the journeyworker rate: 40% at IBEW Local 11 in Los Angeles ($26.80 an hour from October 26, 2026) and 50% at Arizona Pipe Trades ($26.43 for 2026–27), on their own wage sheets.', src: ['ibew11', 'ua469'] },
  },
  {
    q: 'How hard is it to get into a union apprenticeship?',
    a: { text: 'Competitive. The Electrical Training Alliance says many programs get applicants "four, five, six or more times the number of new apprenticeship openings," and elevator locals recruit about every 2 years.', src: ['eta-prep', 'neiep-recruit'] },
  },
  {
    q: 'What is on the IBEW aptitude test?',
    a: { text: 'Algebra and functions (33 questions, 46 minutes) and reading comprehension (36 questions, 51 minutes), with no calculator. If you do not qualify, you can retake it after 90 days.', src: ['eta-apply'] },
  },
  {
    q: 'Do I need to go to trade school first?',
    a: { text: 'Not for an electrical apprenticeship: "Previous knowledge of electrical work is not required." School is the usual door for HVAC (6 months to 2 years), and a first CDL needs training from a registered provider.', src: ['eta-apply', 'bls-hvac', 'fmcsa-tpr'] },
  },
  {
    q: 'Is Job Corps still open?',
    a: { text: 'Yes. A settlement announced September 1, 2026 keeps Job Corps open through at least January 31, 2029. It is free for low-income people aged 16 to 24 who also face a barrier, such as having no diploma.', src: ['njca-jobcorps', 'knpr-jobcorps', 'cfr-686-400'] },
  },
  {
    q: 'Is company-paid CDL training really free?',
    a: { text: 'It often comes with a work commitment, and some training repayment agreements make you owe money if you leave. Prime asks drivers to stay 1 year with their CDL; its page does not say what leaving early costs. Get the exit terms in writing before you sign.', src: ['prime', 'cfpb-traps'] },
  },
]

// ── Listings: the filters on the "Hiring now" block (lib/start/listingFilters.js) ──────────────────────────────────
// Each trade × level is its own search (Electrician + Apprentice → "apprentice electrician"); rows are kept only when
// the title names that trade, and the level is read from the title (a plain "Electrician" is a trained trade job, so
// "Apprentice / helper / trainee" needs a beginner word, the listing's own "Entry level" or a paid-training flag).
// A trade runs its plain, apprentice and journeyman searches at every level — the level's own search first (it is the
// one "See all in job search" opens) — and the level then filters the rows. So "Any level" always holds every row
// either level shows, and switching level is instant (the answers are already in hand). "All trades" runs one search
// per trade (or the apprenticeship / journeyman searches) and deals the rows out trade by trade, two per employer
// before a third.
const byLevel = (any, entry, experienced) => {
  const all = (first) => [...new Set([...first, ...any, ...entry, ...experienced])]
  return { any: all(any), entry: all(entry), experienced: all(experienced) }
}
export const listings = {
  defaultRadius: '50',
  radii: ['25', '50', '100', '250'],
  levelMode: 'entryNeedsMarker',
  levelLabels: { any: 'Any level', entry: 'Apprentice / helper / trainee', experienced: 'Journeyman / licensed' },
  levelWords: { entry: 'apprentice and helper', experienced: 'journeyman' },
  exclude: '\\b(instructor|instructors|trainer|teacher|faculty|professor|recruiter|sales|estimator|project manager|coordinator|dispatcher|welfare|beneficiary)\\b',
  positions: [
    {
      id: 'all', label: 'All trades', noun: 'trade', mix: 'positions',
      queries: {
        any: ['electrician', 'plumber', 'hvac technician', 'welder', 'lineman', 'pipefitter', 'diesel mechanic', 'carpenter', 'apprenticeship'],
        entry: ['apprenticeship', 'hvac apprentice', 'welder helper', 'diesel technician apprentice'],
        experienced: ['journeyman electrician', 'journeyman plumber', 'journeyman pipefitter', 'hvac technician', 'welder', 'lineman'],
      },
    },
    { id: 'electrician', label: 'Electrician', noun: 'electrician', match: 'electrician|electrical (?:apprentice|helper|technician|trainee|worker)|wirem[ae]n', queries: byLevel(['electrician'], ['apprentice electrician'], ['journeyman electrician']) },
    { id: 'plumber', label: 'Plumber', noun: 'plumber', match: 'plumb', queries: byLevel(['plumber'], ['apprentice plumber'], ['journeyman plumber']) },
    { id: 'hvac', label: 'HVAC', noun: 'HVAC', match: '\\bhvac|heating|air condition|refrigeration', queries: byLevel(['hvac technician'], ['hvac apprentice', 'hvac helper'], ['hvac technician']) },
    { id: 'welder', label: 'Welder', noun: 'welder', match: 'weld', queries: byLevel(['welder'], ['welder helper', 'apprentice welder'], ['welder']) },
    { id: 'lineworker', label: 'Lineworker', noun: 'lineworker', match: 'line\\s?(?:man|men|worker|workers)\\b|groundm[ae]n', queries: byLevel(['lineman', 'groundman', 'lineworker'], ['apprentice lineman', 'groundman'], ['journeyman lineman', 'lineman']) },
    { id: 'pipefitter', label: 'Pipefitter', noun: 'pipefitter', match: 'pipe\\s?fitt|steam\\s?fitt', queries: byLevel(['pipefitter'], ['pipefitter helper', 'apprentice pipefitter'], ['journeyman pipefitter']) },
    { id: 'diesel', label: 'Diesel / heavy equipment mechanic', noun: 'diesel and heavy equipment mechanic', match: 'diesel|heavy (?:equipment|duty) (?:technician|mechanic)|fleet (?:technician|mechanic)', queries: byLevel(['diesel mechanic'], ['diesel technician apprentice'], ['diesel mechanic']) },
    { id: 'carpenter', label: 'Carpenter', noun: 'carpenter', match: 'carpent', queries: byLevel(['carpenter'], ['apprentice carpenter'], ['journeyman carpenter', 'carpenter']) },
  ],
}

// ── The page's openable rows ──────────────────────────────────────────────────────────────────────────────────────
export const menu = [
  { id: 'two-doors', title: 'Two ways in', summary: 'Paid apprenticeship, or a job that trains you', blocks: [{ type: 'doors', items: [doors.apprenticeship, doors.now] }] },
  {
    id: 'by-trade', title: 'Trade by trade', summary: 'How long each takes, and median pay',
    blocks: [
      { type: 'text', plain: 'Tap a trade for the way in and how to apply.' },
      { type: 'tradeRows', items: tradeRows },
      { type: 'note', entry: tradeNote },
    ],
  },
  {
    id: 'aptitude-test', title: 'The aptitude test', summary: 'What is on it, and how to prepare',
    blocks: [
      { type: 'text', plain: test.intro },
      { type: 'checklist', items: test.facts, cols: true },
      { type: 'text', entry: test.prep },
      { type: 'more', title: 'What selection committees say they look for', blocks: [
        { type: 'notes', items: test.weigh },
        { type: 'resumeLink', before: 'If you send a résumé, you can', label: 'check it against a posting' },
      ] },
    ],
  },
  {
    id: 'paid-training', title: 'Who trains you', summary: 'Paid training and free programs',
    blocks: [
      { type: 'cards', items: employers.map((e) => ({ name: e.name, body: e, chips: [e.chip] })) },
      { type: 'callout', entry: caveatLine },
      { type: 'more', title: 'Before you sign: franchises, CDL contracts, repayment terms', blocks: [{ type: 'notes', items: employerCaveats }] },
      { type: 'heading', text: 'Free programs' },
      { type: 'cards', items: freeHelp.map((f) => ({ name: f.name, body: f, link: f.url })) },
    ],
  },
  {
    id: 'watch-out', title: 'Watch out', icon: 'caution', summary: 'Common mistakes and scams',
    blocks: [
      { type: 'disclosures', items: mistakes },
      { type: 'more', title: 'What people who got in say', blocks: [
        { type: 'text', plain: 'Several accounts agree on each of these.' },
        { type: 'notes', items: peopleSay },
      ] },
      { type: 'notes', label: 'Scams', items: scams, icon: 'x', caution: true },
    ],
  },
  { id: 'questions', title: 'Common questions', summary: 'Pay, the test, school, Job Corps', blocks: [{ type: 'faq', items: faq }] },
]

// ── Additional resources: every reference above, as plain grouped links ──────────────────────────────────────────
export const resourcesSummary = 'Programs, wage sheets, pay data'
export const resources = [
  { title: 'Training and apprenticeship programs', items: [
    { key: 'eta-apply', name: 'Applying for an electrical apprenticeship (Electrical Training Alliance)' },
    { key: 'eta-prep', name: 'Preparing for the electrical aptitude test' },
    { key: 'eta-training', name: 'Find an electrical training center' },
    { key: 'ua-apprentice', name: 'Plumbing and pipefitting apprenticeships (United Association)' },
    { key: 'neiep-recruit', name: 'Elevator apprenticeship openings (NEIEP)' },
    { key: 'neiep-help', name: 'Elevator apprenticeship questions (NEIEP)' },
    { key: 'neiep-guide', name: 'Elevator aptitude test study guide (NEIEP)' },
    { key: 'iuoe501', name: 'Operating Engineers Local 501 apprenticeship notice' },
    { key: 'smart10', name: 'Sheet Metal Workers Local 10 training' },
    { key: 'nwline', name: 'Northwest Line JATC apprenticeship standards' },
  ] },
  { title: 'Union wage sheets', items: [
    { key: 'ibew11', name: 'IBEW Local 11, Los Angeles: inside wage rates from October 2026' },
    { key: 'jatc26', name: 'JATC Local 26, Washington, DC area: apprentice pay' },
    { key: 'ua469', name: 'Arizona Pipe Trades (UA Local 469): 2026–2027 wage and fringe rates' },
  ] },
  { title: 'Employers that train', items: [
    { key: 'rotorooter', name: 'Roto-Rooter service technician careers' },
    { key: 'electric-boat', name: 'General Dynamics Electric Boat: entry-level welder, Quonset Point' },
    { key: 'georgia-power', name: 'Georgia Power Lineworker Entry Program' },
    { key: 'service-experts', name: 'Service Experts apprenticeship programs' },
    { key: 'thinkbig', name: 'Thompson Tractor ThinkBIG program' },
    { key: 'prime', name: 'Prime Inc. student driver program' },
    { key: 'schneider', name: 'Schneider paid CDL training' },
    { key: 'mrrooter', name: 'Mr. Rooter franchise ownership' },
    { key: 'onehour', name: 'One Hour Heating & Air locations' },
  ] },
  { title: 'Free programs', items: [
    { key: 'apprenticeship-gov', name: 'Apprenticeship Finder (U.S. Department of Labor)' },
    { key: 'cfr-686-400', name: 'Who is eligible for Job Corps (20 CFR 686.400)' },
    { key: 'njca-jobcorps', name: 'Job Corps stays open (National Job Corps Association)' },
    { key: 'knpr-jobcorps', name: 'Job Corps is having a comeback (KNPR)' },
    { key: 'h2h', name: 'Helmets to Hardhats' },
    { key: 'youthbuild', name: 'YouthBuild (U.S. Department of Labor)' },
    { key: 'dol-preapp', name: 'What a quality pre-apprenticeship looks like (U.S. Department of Labor)' },
  ] },
  { title: 'Licensing and safety', items: [
    { key: 'fmcsa-tpr', name: 'CDL Training Provider Registry (FMCSA)' },
    { key: 'cfr-391-11', name: 'Who can drive a commercial truck (49 CFR 391.11)' },
    { key: 'osha-forklift', name: 'Forklift operator training rules (OSHA)' },
  ] },
  { title: 'Pay data', items: [
    { key: 'bls-elec', name: 'Electricians (Bureau of Labor Statistics)' },
    { key: 'bls-plumb', name: 'Plumbers, pipefitters and steamfitters' },
    { key: 'bls-hvac', name: 'HVAC and refrigeration mechanics' },
    { key: 'bls-weld', name: 'Welders, cutters, solderers and brazers' },
    { key: 'bls-line', name: 'Line installers and repairers' },
    { key: 'bls-elev', name: 'Elevator and escalator installers' },
    { key: 'bls-equip', name: 'Construction equipment operators' },
    { key: 'bls-diesel', name: 'Diesel service technicians and mechanics' },
    { key: 'bls-truck', name: 'Heavy and tractor-trailer truck drivers' },
  ] },
  { title: 'Costs, contracts and scams', items: [
    { key: 'uti-catalog', name: 'Universal Technical Institute tuition' },
    { key: 'cfpb-traps', name: 'Training repayment agreements (Consumer Financial Protection Bureau)' },
    { key: 'ftc-scams', name: 'Job scams (Federal Trade Commission)' },
  ] },
  { title: 'Community discussions', items: [
    { key: 'r-ibew551', name: 'A slow year at one IBEW local' },
    { key: 'r-seven', name: 'Trying for years to get into the IBEW' },
    { key: 'r-waiting', name: 'What people worked while waiting for an apprenticeship' },
    { key: 'r-utility', name: 'Waiting on a utility lineworker apprenticeship' },
    { key: 'r-weldschool', name: 'Regrets about welding school' },
    { key: 'r-weld2', name: 'Getting into welding' },
    { key: 'r-age34', name: 'Starting an apprenticeship later in life' },
    { key: 'r-weed', name: 'Union programs and marijuana tests' },
  ] },
]

/** Every fact on the page, in reading order: the hero, then each menu row. */
export function pageEntries() {
  return [guide.answer, ...tiles, ...blockEntries(menu)]
}
