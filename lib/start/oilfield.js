// /start/oilfield — "Getting into oilfield work". The page renders from this module only, so every figure on it
// carries a source and an as-of date (lib/start/guides.test.mjs fails on a figure without one).
//
// THE ONLY SOURCE OF FACTS is the research file compiled 2026-11-13 (session scratchpad research/oilfield.md).
// Rules this module keeps (owner, 2026-11-13: "the right way, on brand and not out of place or too highlighted"):
//   • only items the research marked VERIFIED (a primary source: BLS, a federal page, a company's own board or
//     posting, a certifying body);
//   • FIRST-HAND items (several Reddit accounts agreeing) only as `firstHand: true`, rendered as "people who got
//     in say…", never as fact; a single account is never used;
//   • nothing marked UNVERIFIED or CONFLICTING: no Dallas Fed index, no oil price, no aggregator pay (ZipRecruiter,
//     Recruitee), no search-snippet Halliburton pay, no vendor course prices;
//   • no hype, no guarantees, no exclamation marks. 2025 was a down year and the page says so.
//
// Shape: `sources` (every reference behind the page, kept here and NEVER printed as citations — the links reach
// readers only through the grouped "Additional resources" menu, `resources` below), entries
// `{ text, src: [sourceKey…], firstHand? }`, the listings filter config (`listings`, lib/start/listingFilters.js) and
// the page's openable menu rows (`menu`, rendered by components/start/Blocks.tsx). Pure data; relative imports only
// so `node --test` runs it as is.

import { blockEntries } from './entries.js'

/** @typedef {{ label: string, url: string, date: string, note?: string }} Source */

/** @type {Record<string, Source>} */
export const sources = {
  'bls-oil': {
    label: 'U.S. Bureau of Labor Statistics, Occupational Outlook Handbook: Oil and Gas Workers (May 2025 pay)',
    url: 'https://www.bls.gov/ooh/construction-and-extraction/oil-and-gas-workers.htm',
    date: '2026-08-27', note: 'page updated',
  },
  'bls-midland': {
    label: 'U.S. Bureau of Labor Statistics, Occupational Employment and Wages in Midland, TX (May 2025)',
    url: 'https://www.bls.gov/regions/southwest/news-release/2026/occupationalemploymentandwages_midland_20260813.htm',
    date: '2026-08-13', note: 'released',
  },
  'bls-truck': {
    label: 'U.S. Bureau of Labor Statistics, Occupational Outlook Handbook: Heavy and Tractor-trailer Truck Drivers (May 2025 pay)',
    url: 'https://www.bls.gov/ooh/transportation-and-material-moving/heavy-and-tractor-trailer-truck-drivers.htm',
    date: '2026-08-27', note: 'page updated',
  },
  'pat-6127': {
    label: 'Patterson-UTI job posting #6127, Floorhand (own job board)',
    url: 'https://fa-elpm-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/6127',
    date: '2026-10-30', note: 'posted',
  },
  'pat-6457': {
    label: 'Patterson-UTI job posting #6457, Floorhand, Colorado and Utah (own job board)',
    url: 'https://fa-elpm-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/6457',
    date: '2026-11-05', note: 'posted',
  },
  'hp-req1': {
    label: 'Helmerich & Payne posting REQ-1, U.S. Rig Based Positions (own job board; an ongoing posting)',
    url: 'https://hpinc.wd5.myworkdayjobs.com/HPINC/job/Odessa-TX-USA/US-Rig-Based-Positions_REQ-1',
    date: '2026-11-13', note: 'read',
  },
  'precision-pa': {
    label: 'Precision Drilling posting, Entry Level Drilling Rig Jobs, Pennsylvania (own job board)',
    url: 'https://jobs.precisiondrilling.com/job/Williamsport-Entry-Level-Drilling-Rig-Jobs-Pennsylvania-PA-17701/1387479800/',
    date: '2026-11-13', note: 'read',
  },
  'hal-211992': {
    label: 'Halliburton posting 211992, Operator Assistant Trainee, Frac/Acid, Victoria (own job board)',
    url: 'https://jobs.halliburton.com/job/Victoria-US-Victoria-Operator-Assistant-Trainee-FracAcid-TX-77905-5555/1434976800/',
    date: '2026-10-28', note: 'posted',
  },
  'hal-board': {
    label: 'Halliburton job board, U.S. search',
    url: 'https://jobs.halliburton.com/search/?q=&locationsearch=US',
    date: '2026-11-13', note: 'read',
  },
  'liberty-board': {
    label: 'Liberty Energy job board (pay shown on each posting)',
    url: 'https://na1.empforce.com/Recruiting/Applicant/JobListings.aspx?Cd=cXSAlMyrKnU%3d',
    date: '2026-11-13', note: 'read',
  },
  'bh-wireline': {
    label: 'Baker Hughes posting R165861, Field Operator/CDL Driver, Wireline Services, Midland (own job board)',
    url: 'https://bakerhughes.wd5.myworkdayjobs.com/BakerHughes/job/US-TX-MIDLAND-2613-SCR-1208/Field-Operator-CDL-Driver---A-or-B--Wireline-Services-_R165861',
    date: '2026-11-03', note: 'posted',
  },
  'bh-board': {
    label: 'Baker Hughes job board',
    url: 'https://bakerhughes.wd5.myworkdayjobs.com/BakerHughes',
    date: '2026-11-13', note: 'read',
  },
  'propetro-driver': {
    label: 'ProPetro posting R-101105, Commercial Truck Driver, Midland (own job board)',
    url: 'https://propetroservices.wd5.myworkdayjobs.com/ProPetro_Careers/job/Midland-TX/Commercial-Truck-Driver_R-101105',
    date: '2026-09-10', note: 'posted',
  },
  'kodiak-entry': {
    label: 'Kodiak Gas Services posting JR3861, Field Service Technician, Entry (own job board)',
    url: 'https://kodiakgas.wd12.myworkdayjobs.com/KodiakGasCareers/job/TX---Pecos/Field-Service-Technician--Entry_JR3861',
    date: '2026-11-02', note: 'posted',
  },
  'archrock-board': {
    label: 'Archrock job board',
    url: 'https://edva.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs',
    date: '2026-11-13', note: 'read',
  },
  'archrock-careers': {
    label: 'Archrock careers page',
    url: 'https://www.archrock.com/careers',
    date: '2026-11-13', note: 'read',
  },
  'nabors-board': {
    label: 'Nabors job board',
    url: 'https://fa-eyem-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/requisitions',
    date: '2026-11-13', note: 'read',
  },
  'patterson-board': {
    label: 'Patterson-UTI job board',
    url: 'https://fa-elpm-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/requisitions',
    date: '2026-11-13', note: 'read',
  },
  'hp-board': {
    label: 'Helmerich & Payne job board',
    url: 'https://hpinc.wd5.myworkdayjobs.com/hpinc',
    date: '2026-11-13', note: 'read',
  },
  'precision-board': {
    label: 'Precision Drilling job board, drilling rig jobs',
    url: 'https://jobs.precisiondrilling.com/go/Drilling-Rig/8968100/',
    date: '2026-11-13', note: 'read',
  },
  'kodiak-board': {
    label: 'Kodiak Gas Services job board',
    url: 'https://kodiakgas.wd12.myworkdayjobs.com/KodiakGasCareers',
    date: '2026-11-13', note: 'read',
  },
  'veriforce-basic': {
    label: 'Veriforce, PEC Basic Orientation course page',
    url: 'https://veriforce.com/course/basic-orientation',
    date: '2026-11-13', note: 'read',
  },
  'iadc-rigpass': {
    label: 'IADC, RigPass program page',
    url: 'https://iadc.org/rigpass',
    date: '2026-11-13', note: 'read',
  },
  'veriforce-h2s': {
    label: 'Veriforce, PEC H2S Clear course page',
    url: 'https://veriforce.com/course/pec-h2s-clear',
    date: '2026-11-13', note: 'read',
  },
  'osha-outreach': {
    label: 'OSHA, Outreach Training Program (10- and 30-hour classes)',
    url: 'https://www.osha.gov/training/outreach',
    date: '2026-11-13', note: 'read',
  },
  'tsa-twic': {
    label: 'TSA, Transportation Worker Identification Credential (TWIC)',
    url: 'https://www.tsa.gov/twic',
    date: '2026-11-13', note: 'read',
  },
  'bsee-440': {
    label: 'BSEE Safety Alert 440, short service employees',
    url: 'https://www.bsee.gov/sites/bsee.gov/files/safety-alerts/bsee-safety-alert-440-reducing-incidents-through-increasing-training-and-supervision-of-short.pdf',
    date: '2026-11-13', note: 'read',
  },
  'cfr-391-11': {
    label: '49 CFR 391.11, qualifications of commercial drivers (Cornell Legal Information Institute)',
    url: 'https://www.law.cornell.edu/cfr/text/49/391.11',
    date: '2026-11-13', note: 'read',
  },
  'ftc-scams': {
    label: 'Federal Trade Commission, Job Scams (consumer advice)',
    url: 'https://consumer.ftc.gov/articles/job-scams',
    date: '2023-03', note: 'article dated',
  },
  'aogr-rigs': {
    label: 'American Oil & Gas Reporter, U.S. rig count (Baker Hughes weekly count)',
    url: 'https://www.aogr.com/web-exclusives/us-rig-count/2026',
    date: '2026-11-13', note: 'week of',
  },
  'boe-rigs': {
    label: 'BOE Report (Reuters), U.S. energy firms add rigs for fourth time in five weeks',
    url: 'https://boereport.com/2026/10/09/us-energy-firms-add-rigs-for-fourth-time-in-five-weeks-to-highest-since-2024-baker-hughes-says/',
    date: '2026-10-09', note: 'published',
  },
  'oe-cuts': {
    label: 'Offshore Engineer (Reuters reporting), Halliburton shrinks workforce as oil activity falls',
    url: 'https://www.oedigital.com/amp/news/529711-halliburton-shrinks-workforce-as-oil-activity-plummets',
    date: '2025-09', note: 'published',
  },
  'reuters-slb': {
    label: 'Reuters (Yahoo Finance), Exclusive: oilfield services company SLB cuts jobs',
    url: 'https://finance.yahoo.com/news/exclusive-oilfield-services-company-slb-164957936.html',
    date: '2025-02', note: 'published',
  },
  'rigzone-tipro': {
    label: 'Rigzone, Texas upstream employment rises (TIPRO analysis of August 2026 data)',
    url: 'https://www.rigzone.com/news/texas_upstream_employment_rises-22-sep-2026-184671-article/',
    date: '2026-09-22', note: 'published',
  },
  // First-hand accounts (r/oilandgasworkers, read through the Arctic Shift archive). Used only where several
  // accounts agree, and rendered as what people say, never as fact.
  'r-1x5adb1': { label: 'r/oilandgasworkers, "How easy is it to get a Green-hat job down in Odessa/Midland TX?"', url: 'https://www.reddit.com/r/oilandgasworkers/comments/1x5adb1/', date: '2026-10-13', note: 'thread' },
  'r-1x058sg': { label: 'r/oilandgasworkers, "Is it possible to get into the field with no prior experience?"', url: 'https://www.reddit.com/r/oilandgasworkers/comments/1x058sg/', date: '2026-10-07', note: 'thread' },
  'r-1viy24l': { label: 'r/oilandgasworkers, "Starting up as a 20 yr old male… How quickly can I get into the field with no experience?"', url: 'https://www.reddit.com/r/oilandgasworkers/comments/1viy24l/', date: '2026-08-08', note: 'thread' },
  'r-1vuw90t': { label: 'r/oilandgasworkers, "How do yall find work?"', url: 'https://www.reddit.com/r/oilandgasworkers/comments/1vuw90t/', date: '2026-08-21', note: 'thread' },
  'r-1wsxsx4': { label: 'r/oilandgasworkers, "No experience"', url: 'https://www.reddit.com/r/oilandgasworkers/comments/1wsxsx4/', date: '2026-09-29', note: 'thread' },
  'r-1sa0f2q': { label: 'r/oilandgasworkers, "Drug testing for marijuana"', url: 'https://www.reddit.com/r/oilandgasworkers/comments/1sa0f2q/', date: '2026-04-01', note: 'thread' },
  'r-1w4sh3r': { label: 'r/oilandgasworkers, "Drug testing in the industry"', url: 'https://www.reddit.com/r/oilandgasworkers/comments/1w4sh3r/', date: '2026-09-01', note: 'thread' },
  'r-1xs4icb': { label: 'r/oilandgasworkers, "Should I lie?"', url: 'https://www.reddit.com/r/oilandgasworkers/comments/1xs4icb/', date: '2026-11-09', note: 'thread' },
  'r-1upv59w': { label: 'r/oilandgasworkers, "Patterson UTI start date?"', url: 'https://www.reddit.com/r/oilandgasworkers/comments/1upv59w/', date: '2026-07-07', note: 'thread' },
  'r-1to9dkk': { label: 'r/oilandgasworkers, "Where would I start if I wanted to get into working oil fields"', url: 'https://www.reddit.com/r/oilandgasworkers/comments/1to9dkk/', date: '2026-05-26', note: 'thread' },
  'r-1w6rwhw': { label: 'r/oilandgasworkers, "How difficult is it to start?"', url: 'https://www.reddit.com/r/oilandgasworkers/comments/1w6rwhw/', date: '2026-09-04', note: 'thread' },
  'r-1w3htns': { label: 'r/oilandgasworkers, "First time going to the oilfield in West tx"', url: 'https://www.reddit.com/r/oilandgasworkers/comments/1w3htns/', date: '2026-08-31', note: 'thread' },
  'r-1vsoer7': { label: 'r/oilandgasworkers, "How long does Deep Well Services usually take to contact Green Hat applicants?"', url: 'https://www.reddit.com/r/oilandgasworkers/comments/1vsoer7/', date: '2026-08-19', note: 'thread' },
}

export const guide = {
  path: '/start/oilfield',
  title: 'Getting into oilfield work',
  crumbLabel: 'Oilfield work',
  eyebrow: 'Guide',
  // The one-sentence answer under the h1 (the page's first screen).
  answer: { text: 'Several big drillers hire people new to the industry and train them; most want a steady work history first. Here is what they ask for, what they pay, and who is hiring now.', src: ['pat-6127', 'pat-6457', 'hp-req1', 'precision-pa'] },
  metaDescription: 'How people with no experience get into US oilfield work: entry jobs, what drillers and service companies ask for, what they pay to start, tickets, live entry listings near you, and scams to avoid.',
  asOf: '2026-11-14',
}

// The three readings in the hero: each restates a sourced fact below, with the same sources.
export const tiles = [
  { label: 'Floorhand starting pay', value: '$28.50–$30.64', text: 'an hour plus per diem at two big drillers', src: ['pat-6457', 'precision-pa'] },
  { label: 'Tickets asked for first', value: '0 of 6', text: 'live entry postings we read in November 2026 ask for SafeLand or H2S', src: ['pat-6127', 'pat-6457', 'hp-req1', 'precision-pa', 'hal-211992', 'kodiak-entry'] },
  { label: 'Days on, days off', value: '14 / 14', text: 'Patterson-UTI floorhands, 12.5-hour shifts', src: ['pat-6457'] },
]

// 1. What the entry jobs are: a name, one line, and the sourced figures as chips.
export const entryJobs = [
  {
    role: 'Floorhand', aka: 'Also roughneck, floorman',
    what: { text: 'The bottom rung of a rig crew: drill pipe, cleaning, rig moves. Trained on the job.', src: ['pat-6127'] },
    chips: [{ text: '$28.50–$30.64/hr', src: ['pat-6457', 'precision-pa'] }, { text: '14 on, 14 off', src: ['pat-6457'] }],
  },
  {
    role: 'Roustabout', aka: null,
    what: { text: 'Builds and repairs equipment and cleans rigs. Usually needs no experience.', src: ['bls-oil'] },
    chips: [{ text: 'U.S. median $46,960/yr', src: ['bls-oil'] }],
  },
  {
    role: 'Frac operator trainee', aka: 'Pressure pumping',
    what: { text: 'Rigs up high-pressure equipment and drives to location. Long days, short notice.', src: ['hal-211992'] },
    chips: [{ text: '90-day training at Halliburton', src: ['hal-211992'] }],
  },
  {
    role: 'CDL hauler', aka: 'Water, sand, crude',
    what: { text: 'Hauls between well sites. Class A CDL; ProPetro asks for age 21 and 1 year driving.', src: ['propetro-driver'] },
    chips: [{ text: 'Most posted Texas upstream job, Aug 2026: 613', src: ['rigzone-tipro'] }],
  },
  {
    role: 'Yard or warehouse hand', aka: null,
    what: { text: 'Loads and moves equipment at a yard or shop (Baker Hughes, Liberty Energy).', src: ['bh-board', 'liberty-board'] },
    chips: [{ text: '$20–$27/hr at Liberty Energy', src: ['liberty-board'] }],
  },
  {
    role: 'Compression technician', aka: 'Entry level',
    what: { text: 'Services gas compressors (Kodiak, Archrock). Kodiak asks for a year of related experience or training, prefers trade school, and puts new techs on call.', src: ['kodiak-entry', 'archrock-board'] },
    chips: [],
  },
]

// 2. What the big companies ask for (the live green-hand postings read in full), as a checklist.
export const asks = {
  intro: { text: 'What six live entry postings from big drillers and service companies asked for in November 2026.', src: ['pat-6127', 'pat-6457', 'hp-req1', 'precision-pa', 'hal-211992', 'kodiak-entry'] },
  items: [
    { name: '18 or older', text: 'Helmerich & Payne\'s minimum age.', src: ['hp-req1'] },
    { name: 'Pass a drug test and a physical', text: 'Usually after the offer. Patterson-UTI also tests periodically.', src: ['hp-req1', 'pat-6127'] },
    { name: 'Pass a background check', text: null, src: ['hal-211992', 'pat-6127'] },
    { name: 'A valid driver\'s license', text: 'Precision Drilling also asks for a dependable vehicle.', src: ['precision-pa'] },
    { name: 'A steady work history', text: 'Patterson-UTI: 1 year of stable work, ideally 6 months of farming, ranching, construction, heavy equipment, a trade or the military (South and East Texas); in Colorado and Utah, 1 year of related work or military service. Precision: 2 or more years of recent outdoor heavy labor.', src: ['pat-6127', 'pat-6457', 'precision-pa'] },
    { name: 'A CDL only for driving, frac and wireline jobs', text: 'Halliburton frac and cementing trainees must be able to get a Class A (tanker endorsement) or Class B, with no DWI or DUI in 3 years. Baker Hughes’ wireline field operator jobs are CDL A or B driving jobs.', src: ['hal-211992', 'bh-wireline'] },
  ],
  note: { text: 'None of the six lists SafeLand, H2S, OSHA 10 or first aid as something to have before you apply. Patterson-UTI says new hires complete classroom training and testing before a rig assignment. So these companies train new hires themselves; that is a reading of these six postings, not a rule for every employer.', src: ['pat-6127', 'pat-6457'] },
  // The one line the page shows; the note above and the tickets list sit one tap away.
  ticketsLine: { text: 'Tickets like SafeLand and H2S: the big companies above train new hires themselves. Smaller outfits may want tickets first, people in the field say.', src: ['pat-6127', 'pat-6457', 'r-1viy24l'] },
  smaller: { text: 'Smaller contractors can be different. People in the field say that outside the big companies you may need tickets before anyone will hire you.', src: ['r-1viy24l'], firstHand: true },
}

// 3. Starting pay on employers' own postings (shown on each employer's row below).
export const payRows = [
  { company: 'Patterson-UTI', role: 'Floorhand, Colorado and Utah', pay: 'Starting at $28.50/hr, plus per diem', src: ['pat-6457'] },
  { company: 'Precision Drilling', role: 'Floorhand, Pennsylvania', pay: '$30.64/hr, plus per diem and housing', src: ['precision-pa'] },
  { company: 'Helmerich & Payne', role: 'Rig-based positions, Colorado pay range', pay: '$25.00 to $34.50/hr', src: ['hp-req1'] },
  { company: 'Liberty Energy', role: 'Equipment Operator I, Cheyenne', pay: '$20 to $21/hr', src: ['liberty-board'] },
  { company: 'Liberty Energy', role: 'PropX Equipment Operator, Odessa', pay: '$18 to $25/hr', src: ['liberty-board'] },
  { company: 'Liberty Energy', role: 'Warehouse I, El Reno and Vernal', pay: '$20 to $27/hr', src: ['liberty-board'] },
]
export const payNote = { text: 'Helmerich & Payne\'s range covers all rig-based positions, not only the entry job. Pay on a posting is the employer\'s statement on that date; rotations, overtime and per diem change what a year adds up to.', src: ['hp-req1'] }

export const blsRows = [
  { occupation: 'Roustabouts', median: '$46,960', midland: '$22.84/hr', src: ['bls-oil', 'bls-midland'] },
  { occupation: 'Service unit operators', median: '$58,160', midland: '$26.67/hr', src: ['bls-oil', 'bls-midland'] },
  { occupation: 'Derrick operators', median: '$58,620', midland: '$28.02/hr', src: ['bls-oil', 'bls-midland'] },
  { occupation: 'Rotary drill operators (drillers)', median: '$67,890', midland: '$38.81/hr', src: ['bls-oil', 'bls-midland'] },
  { occupation: 'Heavy and tractor-trailer truck drivers', median: '$58,640', midland: null, src: ['bls-truck'] },
]
export const blsNote = { text: 'National medians are yearly pay for May 2025; Midland figures are mean hourly pay in the Midland, TX metro area for May 2025. Derrick operator and driller are the rungs above floorhand: Helmerich & Payne asks for 6 months of drilling experience for its non-entry jobs.', src: ['bls-oil', 'bls-midland', 'hp-req1'] }

// 4. Who hires green hands (each with evidence from its own board). `board` is the source key of its board;
// `roles` are the entry roles its own postings name (plain words, from the evidence); pay comes from payRows.
export const employers = [
  { name: 'Patterson-UTI', board: 'patterson-board', roles: ['Floorhand'], pay: { value: '$28.50/hr', note: 'floorhand, plus per diem', src: ['pat-6457'] }, evidence: { text: 'Entry level with introductory training, and separate qualifications for people new to the industry.', src: ['pat-6127'] } },
  { name: 'Helmerich & Payne', board: 'hp-board', roles: ['Floorman', 'Offshore roustabout'], pay: { value: '$25.00–$34.50/hr', note: 'all rig jobs, Colorado', src: ['hp-req1'] }, evidence: { text: 'An always-open posting for rig jobs in Odessa, Tyler, Oklahoma City, Grand Junction, Dickinson and Barnesville, Ohio.', src: ['hp-req1'] } },
  { name: 'Precision Drilling', board: 'precision-board', roles: ['Entry-level rig jobs'], pay: { value: '$30.64/hr', note: 'floorhand, plus per diem and housing', src: ['precision-pa'] }, evidence: { text: 'For 2 or more years of recent outdoor heavy labor.', src: ['precision-pa'] } },
  { name: 'Halliburton', board: 'hal-board', roles: ['Frac and acid', 'Cementing', 'Wireline', 'Production'], evidence: { text: '9 U.S. trainee and entry-level operator postings in mid-November 2026, with a 90-day training period.', src: ['hal-board', 'hal-211992'] } },
  { name: 'Nabors', board: 'nabors-board', roles: ['Floorhand I', 'Roustabout'], evidence: { text: 'Floorhands in West, South and East Texas and North Dakota; roustabouts in Alaska.', src: ['nabors-board'] } },
  { name: 'Liberty Energy', board: 'liberty-board', roles: ['Equipment operator', 'Warehouse'], pay: { value: '$18–$27/hr', note: 'across three postings', src: ['liberty-board'] }, evidence: { text: 'Pay is stated on each posting.', src: ['liberty-board'] } },
  { name: 'Kodiak Gas Services', board: 'kodiak-board', roles: ['Field service technician, entry'], evidence: { text: '11 entry postings in Texas, New Mexico and Oklahoma in mid-November 2026, with its own short service employee program.', src: ['kodiak-entry', 'kodiak-board'] } },
  { name: 'Archrock', board: 'archrock-board', roles: ['Field service technician, entry'], evidence: { text: 'Midland. Its careers page names oilfield, HVAC and automotive backgrounds as ways in.', src: ['archrock-board', 'archrock-careers'] } },
  { name: 'Baker Hughes', board: 'bh-board', roles: ['Warehouse and yard operator', 'Field operator (CDL)'], evidence: { text: 'Its wireline field operator jobs are CDL A or B driving jobs; it also posts warehouse and yard operator jobs.', src: ['bh-wireline', 'bh-board'] } },
]

// 5. How people actually get in (first-hand, several accounts agreeing; never presented as fact). `step` is the
// short line a reader scans; `text` the rest.
export const howPeopleGetIn = [
  { step: 'Apply online to the big companies', text: 'Their boards take people with no experience, and some report an offer within days. Applicant pools can be large.', src: ['r-1x058sg', 'r-1w6rwhw', 'r-1vsoer7'], firstHand: true },
  { step: 'Be the easy hire', text: 'Being reliable, passing the drug test and having a clean driving record already puts you ahead of many applicants. Going to the basin and staying several weeks helps some people; walking into offices is disputed.', src: ['r-1x5adb1', 'r-1x058sg', 'r-1vsoer7'], firstHand: true },
  { step: 'Ask everyone you know', text: '"O&G becomes who you know more often than not," and referrals come up in almost every thread.', src: ['r-1vuw90t', 'r-1x5adb1'], firstHand: true },
  { step: 'Take the first door that opens', text: 'A yard, a casing crew, any entry job. Show up every day, then move.', src: ['r-1wsxsx4', 'r-1x5adb1'], firstHand: true },
]
// Said as often, kept beside the steps.
export const alsoSaid = [
  { text: 'A CDL opens more doors, though many driving jobs also want a year of driving first.', src: ['r-1x5adb1', 'propetro-driver'], firstHand: true },
  { text: 'Frac crews often live in a man camp or hotel with food covered. Precision Drilling offers housing and per diem on its own posting.', src: ['r-1w6rwhw', 'r-1w3htns', 'precision-pa'], firstHand: true },
]
export const whatEndsIt = [
  { text: 'Failing the drug test. "They all test. Every single one of them," and a failed test ends the application.', src: ['r-1sa0f2q', 'r-1w4sh3r'], firstHand: true },
  { text: 'Lying about experience. Employers check schooling and past W-2s.', src: ['r-1xs4icb'], firstHand: true },
  { text: 'No way to get to work, or asking to push the start date back.', src: ['r-1upv59w', 'r-1to9dkk'], firstHand: true },
]

// 6. Tickets: what they are, who usually pays.
export const tickets = [
  { name: 'PEC Basic Orientation (formerly SafeLand USA Basic)', text: 'A full-day, 6-hour safety orientation; the training does not expire. The big drillers above do not ask for it before hire.', src: ['veriforce-basic', 'pat-6127'] },
  { name: 'IADC RigPass', text: 'A standard safety orientation for new rig workers, onshore or offshore; student certificates do not expire.', src: ['iadc-rigpass'] },
  { name: 'H2S Clear', text: 'A 3.5 to 4 hour course on hydrogen sulfide gas that has to be retaken every year. None of the entry postings we read lists it.', src: ['veriforce-h2s'] },
  { name: 'OSHA 10', text: 'OSHA calls its outreach classes "a voluntary program," and says none of them "is considered a certification." It is not an oilfield requirement.', src: ['osha-outreach'] },
  { name: 'TWIC card', text: 'Needed for secure areas of maritime facilities and vessels, so it matters for offshore and port work, not land rigs. A new card is $127.', src: ['tsa-twic'] },
  { name: 'Green hat', text: 'BSEE, the offshore safety regulator, says green hard hats and short service employee stickers can be used to identify workers with under 6 months on site or in the industry.', src: ['bsee-440'] },
]
export const ticketsNote = { text: 'Who pays: at the big drillers and service companies above, training happens after hire. Canadian course names such as H2S Alive come up in threads; they are not US credentials.', src: ['pat-6127', 'r-1x058sg'] }

// 7. Scams and red flags (FTC; never a promise that paying gets anyone hired).
export const scams = [
  { text: 'Never pay to be hired or placed. The FTC: honest employers "will never ask you to pay to get a job."', src: ['ftc-scams'] },
  { text: 'Skip "so-called training, or certifications that are useless." Check that an employer actually asks for a course before you pay.', src: ['ftc-scams'] },
  { text: 'Apply on the company\'s own job board, linked on each company above. "Honest placement firms do not typically charge a fee to job candidates."', src: ['ftc-scams'] },
]

// The state of hiring, said plainly.
export const hiringNow = [
  { text: '2025 was a down year. The US rig count fell 7% over 2025, and Reuters reported staff cuts at Halliburton and SLB that year.', src: ['boe-rigs', 'oe-cuts', 'reuters-slb'] },
  { text: 'Activity has picked up in 2026: 601 rigs in the week of November 13, 2026, against 549 a year earlier.', src: ['aogr-rigs'] },
]

// FAQ — visible on the page and mirrored in FAQPage JSON-LD (only Q&As shown on the page).
export const faq = [
  {
    q: 'Can I get into the oilfield with no experience?',
    a: { text: 'Yes, at some large employers. Helmerich & Payne posts entry-level floorman jobs, and Patterson-UTI calls its floorhand job entry level with training provided. Some ask for a steady work history first: 1 year at Patterson-UTI.', src: ['hp-req1', 'pat-6127'] },
  },
  {
    q: 'Do I need SafeLand or H2S before I apply?',
    a: { text: 'Not at the companies we checked. None of the entry postings we read in November 2026 lists them; those companies train new hires. Smaller contractors may ask for them first.', src: ['pat-6127', 'hp-req1'] },
  },
  {
    q: 'How much does a floorhand make to start?',
    a: { text: 'On employers\' own postings in November 2026: $28.50/hr at Patterson-UTI in Colorado and Utah, and $30.64/hr at Precision Drilling in Pennsylvania, both plus per diem.', src: ['pat-6457', 'precision-pa'] },
  },
  {
    q: 'Do oilfield companies drug test?',
    a: { text: 'Yes. Patterson-UTI, Precision Drilling, Halliburton and ProPetro state a pre-employment drug test on their postings, and people in the field say every company tests.', src: ['pat-6127', 'precision-pa', 'hal-211992', 'propetro-driver', 'r-1sa0f2q'] },
  },
  {
    q: 'Do I need a CDL?',
    a: { text: 'Not for floorhand or roustabout jobs on the postings we read. Halliburton frac trainees must be able to get one, Baker Hughes’ wireline field operator jobs are CDL driving jobs, and driving across state lines requires age 21.', src: ['hal-211992', 'bh-wireline', 'cfr-391-11'] },
  },
]


// ── Listings: the filters on the "Hiring now" block (lib/start/listingFilters.js) ──────────────────────────────────
// Positions run their own searches; rows are kept only when the title names that position AND the row belongs to the
// oilfield (an oilfield word in the title, or an oilfield employer): a plain "equipment operator" or "truck driver"
// search answers mostly warehouse, construction and freight rows (measured on seenjobs.io 2026-11-14), so those
// positions read oilfield-specific searches (wireline operator, hauler, oilfield cdl driver) and the gate keeps only
// the oilfield rows. "All entry jobs" merges the rig searches with rig roles first. A plain title is the entry rung
// here (field-hand jobs train on the job); a title that asks for experience is not.
const OIL_TITLE = '\\b(oil|oilfield|gas|frac|fracking|rigs?|drilling|driller|wells?|wellsite|wellhead|wireline|coil(?:ed)? tubing|flowback|completions?|pumping|pressure pumping|cement(?:ing)?|sand|crude|water haul\\w*|roustabouts?|floor\\s?hands?|roughnecks?|derrick\\w*|motorhand|pipeline|lease|midstream|compress(?:or|ion)|nitrogen|acid|hydrovac|kill truck|vacuum truck|swamper|workover|pulling unit)\\b'
const OIL_COMPANY = '(drill|energy|oil|petro|frac|well serv|pumping|completion|flow control|pressure control|wellhead|halliburton|nabors|patterson|baker hughes|schlumberger|\\bslb\\b|weatherford|liberty|propetro|cudd|\\bnov\\b|aris water|keystone clearwater|wolla|silvertip|key energy|stallion|archrock|kodiak gas|usa compression|enerflex|exterran|compressco|chevron|exxon|conoco|devon|\\beog\\b|pioneer natural|diamondback|occidental|\\boxy\\b|apache|ensign|scandrill|akita|helmerich|transocean|noble corp|valaris|detmar|lynda kay|arepet|tetra technologies|basin|permian|bakken)'
export const listings = {
  defaultRadius: '100',
  radii: ['25', '50', '100', '250'],
  levelMode: 'entryUnlessMarked',
  levelLabels: { any: 'Any level', entry: 'Entry / no experience', experienced: 'Experienced' },
  levelWords: { entry: 'entry-level', experienced: 'experienced' },
  gateTitle: OIL_TITLE,
  gateCompany: OIL_COMPANY,
  exclude: '\\b(instructor|recruiter|sales|accountant|engineer|geologist|landman|analyst)\\b',
  positions: [
    { id: 'all', label: 'All entry jobs', noun: 'oilfield', queries: ['floorhand', 'roustabout', 'frac equipment operator'], prefer: 'floor\\s?hand|roustabout|roughneck|floor\\s?m[ae]n|rig hands?|\\bfrac\\b', seeAll: 'roustabout' },
    { id: 'floorhand', label: 'Floorhand', noun: 'floorhand', queries: ['floorhand'], match: 'floor\\s?hands?|floor\\s?m[ae]n|roughnecks?|rig hands?' },
    { id: 'roustabout', label: 'Roustabout', noun: 'roustabout', queries: ['roustabout'], match: 'roustabout' },
    { id: 'frac', label: 'Frac / pump operator', noun: 'frac and pump operator', queries: ['frac equipment operator', 'pump operator'], match: '\\bfrac\\b|\\bpump(?:ing)?\\b.*\\boperator|\\boperator\\b.*\\bpump|pressure pump|blender|cementing' },
    { id: 'equipment-operator', label: 'Equipment operator', noun: 'oilfield equipment operator', queries: ['equipment operator', 'wireline operator'], match: 'equipment operator|field operator|wireline operator|wireline equipment|operator trainee|operator assistant|assistant operator', seeAll: 'wireline operator' },
    { id: 'cdl-driver', label: 'CDL driver', noun: 'oilfield CDL driver', queries: ['hauler', 'oilfield cdl driver', 'truck driver'], match: 'haul|\\bcdl\\b|driver|trucker', seeAll: 'oilfield cdl driver' },
    { id: 'yard', label: 'Yard / warehouse hand', noun: 'oilfield yard and warehouse', queries: ['yard operator', 'shop hand', 'warehouse operator'], match: '\\byard\\b|warehouse|shop hand|shop helper|material handler|\\bparts\\b|inventory' },
    { id: 'field-service', label: 'Field service tech', noun: 'oilfield field service tech', queries: ['compressor technician', 'field service technician'], match: 'compress|field service tech|field technician|service technician|mechanic' },
  ],
}

// ── The page's openable rows (components/start/Blocks.tsx renders each block type) ─────────────────────────────────
export const menu = [
  {
    id: 'what-you-need', title: 'What you need', summary: 'Age, drug test, license, tickets',
    blocks: [
      { type: 'text', entry: asks.intro },
      { type: 'checklist', items: asks.items, cols: true },
      { type: 'callout', entry: asks.ticketsLine },
      { type: 'more', title: 'Tickets: what each one is, and who pays', blocks: [
        { type: 'text', entry: asks.note },
        { type: 'text', entry: asks.smaller, lead: 'From people in the field:' },
        { type: 'checklist', items: tickets },
        { type: 'text', entry: ticketsNote },
      ] },
    ],
  },
  {
    id: 'entry-jobs', title: 'Entry jobs', summary: 'Six ways in, with starting pay',
    blocks: [
      { type: 'cards', items: entryJobs.map((j) => ({ name: j.role, aka: j.aka, body: j.what, chips: j.chips })) },
      { type: 'more', title: 'Pay further up the ladder', blocks: [
        { type: 'table', caption: 'Pay for oilfield occupations', columns: [{ key: 'occupation', label: 'Occupation' }, { key: 'median', label: 'U.S. median, yearly', num: true }, { key: 'midland', label: 'Midland, TX, hourly', num: true }], rows: blsRows },
        { type: 'text', entry: blsNote },
      ] },
    ],
  },
  {
    id: 'who-hires', title: 'Who hires beginners', summary: 'Nine companies that train green hands',
    blocks: [
      { type: 'text', entries: hiringNow },
      { type: 'employers', items: employers, shown: 5, moreTitle: 'more companies that hire green hands' },
      { type: 'more', title: 'Pay on each posting', blocks: [
        { type: 'table', caption: 'Starting pay stated on employers’ own postings', columns: [{ key: 'company', label: 'Company' }, { key: 'role', label: 'Role' }, { key: 'pay', label: 'Stated pay', num: true }], rows: payRows },
        { type: 'text', entry: payNote },
      ] },
    ],
  },
  {
    id: 'how-people-get-in', title: 'How people get in', summary: 'What worked for people who got in',
    blocks: [
      { type: 'text', plain: 'What people who got in say. Several accounts agree on each of these.' },
      { type: 'steps', items: howPeopleGetIn },
      { type: 'more', title: 'Two more things people say', blocks: [{ type: 'notes', items: alsoSaid }] },
      { type: 'resumeLink', before: 'Before you apply, you can', label: 'check your résumé against a posting' },
    ],
  },
  {
    id: 'watch-out', title: 'Watch out', icon: 'caution', summary: 'What ends an application, and scams',
    blocks: [
      { type: 'notesGrid', groups: [
        { label: 'What ends an application, people say', items: whatEndsIt, icon: 'x' },
        { label: 'Scams', items: scams, icon: 'x' },
      ] },
    ],
  },
  { id: 'questions', title: 'Common questions', summary: 'Tickets, CDL, drug tests, pay', blocks: [{ type: 'faq', items: faq }] },
]

// ── Additional resources: every reference above, as plain grouped links (no numbers, closed by default) ────────────
export const resourcesSummary = 'Job boards, safety tickets, pay data'
export const resources = [
  { title: 'Employers’ job boards', items: [
    { key: 'patterson-board', name: 'Patterson-UTI careers' },
    { key: 'hp-board', name: 'Helmerich & Payne careers' },
    { key: 'precision-board', name: 'Precision Drilling rig jobs' },
    { key: 'hal-board', name: 'Halliburton careers' },
    { key: 'nabors-board', name: 'Nabors careers' },
    { key: 'liberty-board', name: 'Liberty Energy careers' },
    { key: 'kodiak-board', name: 'Kodiak Gas Services careers' },
    { key: 'archrock-board', name: 'Archrock job openings' },
    { key: 'archrock-careers', name: 'Archrock careers' },
    { key: 'bh-board', name: 'Baker Hughes careers' },
  ] },
  { title: 'Entry postings', items: [
    { key: 'pat-6127', name: 'Patterson-UTI: Floorhand' },
    { key: 'pat-6457', name: 'Patterson-UTI: Floorhand, Colorado and Utah' },
    { key: 'hp-req1', name: 'Helmerich & Payne: U.S. rig-based positions' },
    { key: 'precision-pa', name: 'Precision Drilling: entry-level rig jobs, Pennsylvania' },
    { key: 'hal-211992', name: 'Halliburton: Operator Assistant Trainee, Frac/Acid, Victoria' },
    { key: 'kodiak-entry', name: 'Kodiak Gas Services: Field Service Technician, Entry' },
    { key: 'bh-wireline', name: 'Baker Hughes: Field Operator / CDL Driver, Wireline' },
    { key: 'propetro-driver', name: 'ProPetro: Commercial Truck Driver, Midland' },
  ] },
  { title: 'Training and safety tickets', items: [
    { key: 'veriforce-basic', name: 'PEC Basic Orientation (Veriforce)' },
    { key: 'iadc-rigpass', name: 'IADC RigPass' },
    { key: 'veriforce-h2s', name: 'H2S Clear (Veriforce)' },
    { key: 'osha-outreach', name: 'OSHA Outreach Training Program' },
    { key: 'tsa-twic', name: 'TWIC card (TSA)' },
    { key: 'bsee-440', name: 'BSEE safety alert on short service employees' },
  ] },
  { title: 'Licensing and job scams', items: [
    { key: 'cfr-391-11', name: 'Who can drive a commercial truck (49 CFR 391.11)' },
    { key: 'ftc-scams', name: 'Job scams (Federal Trade Commission)' },
  ] },
  { title: 'Pay data', items: [
    { key: 'bls-oil', name: 'Oil and gas workers (Bureau of Labor Statistics)' },
    { key: 'bls-midland', name: 'Pay in Midland, TX (Bureau of Labor Statistics)' },
    { key: 'bls-truck', name: 'Truck drivers (Bureau of Labor Statistics)' },
  ] },
  { title: 'Industry news', items: [
    { key: 'aogr-rigs', name: 'U.S. rig count, 2026 (American Oil & Gas Reporter)' },
    { key: 'boe-rigs', name: 'Rigs added in October 2026 (BOE Report)' },
    { key: 'oe-cuts', name: 'Halliburton workforce cuts, 2025 (Offshore Engineer)' },
    { key: 'reuters-slb', name: 'SLB job cuts, February 2025 (Reuters)' },
    { key: 'rigzone-tipro', name: 'Texas upstream jobs, August 2026 (Rigzone)' },
  ] },
  { title: 'Community discussions', items: [
    { key: 'r-1x5adb1', name: 'Getting a green-hat job in Odessa and Midland' },
    { key: 'r-1x058sg', name: 'Getting into the field with no experience' },
    { key: 'r-1viy24l', name: 'How fast a 20-year-old can get into the field' },
    { key: 'r-1vuw90t', name: 'How people find work' },
    { key: 'r-1wsxsx4', name: 'No experience' },
    { key: 'r-1sa0f2q', name: 'Drug testing for marijuana' },
    { key: 'r-1w4sh3r', name: 'Drug testing in the industry' },
    { key: 'r-1xs4icb', name: 'Lying about experience' },
    { key: 'r-1upv59w', name: 'Patterson-UTI start dates' },
    { key: 'r-1to9dkk', name: 'Where to start in the oilfield' },
    { key: 'r-1w6rwhw', name: 'How hard it is to start' },
    { key: 'r-1w3htns', name: 'First time going to the oilfield in West Texas' },
    { key: 'r-1vsoer7', name: 'How long Deep Well Services takes to call back' },
  ] },
]

/** Every fact on the page, in reading order: the hero, then each menu row; an employer's board link counts as one. */
export function pageEntries() {
  return [guide.answer, ...tiles, ...blockEntries(menu), ...employers.map((e) => ({ text: e.name, src: [e.board] }))]
}
