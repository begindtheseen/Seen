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
// Shape: `sources` (declaration order = the numbered list at the bottom of the page) and entries
// `{ text, src: [sourceKey…], firstHand? }`. Pure data; relative imports only so `node --test` runs it as is.

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
  'hal-212296': {
    label: 'Halliburton posting 212296, Operator Assistant Trainee, Frac/Acid, Odessa (own job board)',
    url: 'https://jobs.halliburton.com/job/Odessa-US-Odessa-Operator-Assistant-Trainee-FracAcid-TX-79763/1439293900/',
    date: '2026-11-10', note: 'posted',
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
  'precision-fairs': {
    label: 'Precision Drilling, upcoming career fairs',
    url: 'https://jobs.precisiondrilling.com/content/Upcoming-Career-Fairs/',
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
    date: '2026-11-06', note: 'week of',
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
  sub: 'What entry jobs exist, what the big employers ask for, what they pay on their own postings, and how people with no experience get hired. Every figure is linked to its source below.',
  metaDescription: 'How people with no experience get into US oilfield work: entry jobs, what drillers and service companies ask for, starting pay from their own postings, tickets, and scams to avoid. Every figure sourced.',
  asOf: '2026-11-13',
}

// 1. What the entry jobs are.
export const entryJobs = [
  {
    role: 'Floorhand (also roughneck, floorman)',
    what: { text: 'The bottom rung of a drilling rig crew: handles drill pipe, cleans and paints, and helps rig up, rig down and move. Patterson-UTI calls it "an entry-level job that provides initial introductory training and substantial on-the-job training."', src: ['pat-6127'] },
    schedule: { text: '14 days on, 14 off, 12.5-hour shifts at Patterson-UTI; 12-hour days for 14 to 28 days, then 14 to 28 off, at Helmerich & Payne.', src: ['pat-6457', 'hp-req1'] },
  },
  {
    role: 'Roustabout',
    what: { text: 'Assembles and repairs oilfield equipment such as mud pumps, shakers and pipes, and cleans rigs and work areas. BLS: roustabout jobs "typically do not require experience to enter."', src: ['bls-oil'] },
    schedule: { text: 'Varies by employer; the postings read did not give one standard schedule. Helmerich & Payne lists an offshore entry-level roustabout job.', src: ['hp-req1'] },
  },
  {
    role: 'Frac or pressure pumping operator trainee',
    what: { text: 'Rigs up and down high-pressure equipment, inspects and maintains it, and drives to and from location. Halliburton runs a 90-day training period.', src: ['hal-212296'] },
    schedule: { text: 'Halliburton says to expect long work days, irregular hours and calls on short notice; lodging and a rotating schedule may be provided depending on location.', src: ['hal-212296'] },
  },
  {
    role: 'CDL hauler (water, sand, crude)',
    what: { text: 'Hauls water, sand or crude between well sites, storage and disposal. Needs a Class A CDL; ProPetro asks for 1 year of driving experience and age 21. Truck drivers were the most posted job in the Texas upstream sector in August 2026, with 613 postings.', src: ['propetro-driver', 'rigzone-tipro'] },
    schedule: null,
  },
  {
    role: 'Yard hand, warehouse or shop hand',
    what: { text: 'Loads, stores and moves equipment at a yard or shop. Baker Hughes posts a Warehouse & Yard Operator job in Midland; Liberty Energy posts Warehouse I jobs.', src: ['bh-board', 'liberty-board'] },
    schedule: null,
  },
  {
    role: 'Compression field technician, entry level',
    what: { text: 'Services gas compressors at well sites. Kodiak Gas Services and Archrock both post entry-level field service technician jobs; Kodiak prefers trade school or comparable experience.', src: ['kodiak-entry', 'archrock-board'] },
    schedule: null,
  },
]

// 2. What the big companies ask for (eight green-hand postings read in full).
export const asks = {
  intro: { text: 'Eight entry postings from Patterson-UTI, Helmerich & Payne, Precision Drilling, Halliburton, Nabors and Kodiak, read in full in November 2026, ask for the same short list:', src: ['pat-6127', 'pat-6457', 'hp-req1', 'precision-pa', 'hal-212296', 'kodiak-entry'] },
  items: [
    { text: 'Age 18 or older (Helmerich & Payne).', src: ['hp-req1'] },
    { text: 'A drug and alcohol test and a physical, usually after the offer. Patterson-UTI adds periodic testing.', src: ['hp-req1', 'pat-6127'] },
    { text: 'A background check.', src: ['hal-212296', 'hp-req1', 'pat-6127'] },
    { text: 'A valid driver\'s license, and at Precision Drilling a dependable vehicle.', src: ['precision-pa'] },
    { text: 'For frac and cementing trainees at Halliburton, the ability to get a Class A CDL with a tanker endorsement or a Class B, and no DWI or DUI in the past 3 years.', src: ['hal-212296'] },
    { text: 'A work history. Patterson-UTI asks people new to the industry for 1 year of stable work history, and prefers 6 months of related work such as farming, ranching, construction, heavy equipment or another trade, or military service. Precision asks for 2 or more years of recent outdoor heavy labor.', src: ['pat-6127', 'precision-pa'] },
  ],
  note: { text: 'None of the eight lists SafeLand, H2S, OSHA 10 or first aid as something to have before you apply. Patterson-UTI says new hires complete classroom training and testing before a rig assignment. So these companies train new hires themselves; that is a reading of these eight postings, not a rule for every employer.', src: ['pat-6127', 'pat-6457'] },
  smaller: { text: 'Smaller contractors can be different. People in the field say that outside the big companies you may need tickets before anyone will hire you.', src: ['r-1viy24l'], firstHand: true },
}

// 3. Starting pay on employers' own postings.
export const payRows = [
  { company: 'Patterson-UTI', role: 'Floorhand, Colorado and Utah', pay: 'Starting at $28.50/hr, plus per diem', src: ['pat-6457'] },
  { company: 'Precision Drilling', role: 'Floorhand, Pennsylvania', pay: '$30.64/hr, plus per diem and housing', src: ['precision-pa'] },
  { company: 'Helmerich & Payne', role: 'Rig-based positions, Colorado pay range', pay: '$25.00 to $34.50/hr', src: ['hp-req1'] },
  { company: 'Liberty Energy', role: 'Equipment Operator I, Cheyenne', pay: '$20 to $21/hr', src: ['liberty-board'] },
  { company: 'Liberty Energy', role: 'PropX Equipment Operator, Odessa', pay: '$18 to $25/hr', src: ['liberty-board'] },
  { company: 'Liberty Energy', role: 'Warehouse I, Cheyenne, El Reno and Vernal', pay: '$20 to $27/hr', src: ['liberty-board'] },
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

// 4. Who hires green hands (each with evidence from its own board). `board` is the source key of its board.
export const employers = [
  { name: 'Patterson-UTI', board: 'patterson-board', evidence: { text: 'Floorhand postings say the job is entry level with introductory training; it lists separate qualifications for people new to the industry.', src: ['pat-6127'] } },
  { name: 'Helmerich & Payne', board: 'hp-board', evidence: { text: 'An ongoing posting for an entry-level floorman and an offshore entry-level roustabout, hiring in Odessa, Tyler, Oklahoma City, Grand Junction, Dickinson and Barnesville, Ohio.', src: ['hp-req1'] } },
  { name: 'Precision Drilling', board: 'precision-board', evidence: { text: 'Entry-level drilling rig jobs for applicants with 2 or more years of recent outdoor heavy labor; it also lists career fairs.', src: ['precision-pa', 'precision-fairs'] } },
  { name: 'Nabors', board: 'nabors-board', evidence: { text: 'Floorhand I postings in West, South and East Texas and North Dakota, and roustabout jobs in Alaska.', src: ['nabors-board'] } },
  { name: 'Halliburton', board: 'hal-board', evidence: { text: '11 U.S. trainee and entry-level operator postings in November 2026 (frac and acid, cementing, wireline, production), with a 90-day training period.', src: ['hal-board', 'hal-212296'] } },
  { name: 'Liberty Energy', board: 'liberty-board', evidence: { text: 'Equipment operator and warehouse jobs with pay stated on each posting.', src: ['liberty-board'] } },
  { name: 'Kodiak Gas Services', board: 'kodiak-board', evidence: { text: 'Seven entry-level field service technician postings in Texas, New Mexico and Oklahoma, with its own short service employee program.', src: ['kodiak-entry'] } },
  { name: 'Archrock', board: 'archrock-board', evidence: { text: 'An entry-level field service technician job in Midland; its careers page names oilfield, HVAC and automotive backgrounds as ways in.', src: ['archrock-board', 'archrock-careers'] } },
  { name: 'Baker Hughes', board: 'bh-board', evidence: { text: 'Field operator jobs want a CDL already and, for wireline, age 21. Its warehouse and yard job is the door without one.', src: ['bh-wireline', 'bh-board'] } },
]

// 5. How people actually get in (first-hand, several accounts agreeing; never presented as fact).
export const howPeopleGetIn = [
  { text: 'Apply online to the big drillers and service companies; their boards take people with no experience, and some report an offer within days. Applicant pools can be large.', src: ['r-1x058sg', 'r-1w6rwhw', 'r-1vsoer7'], firstHand: true },
  { text: 'Going to the basin and staying several weeks helps some people; being reliable, passing the drug test and having a clean driving record already puts you ahead of many applicants. Walking into offices is disputed: some say it works, others say offices do not want it.', src: ['r-1x5adb1', 'r-1x058sg', 'r-1vsoer7'], firstHand: true },
  { text: 'Knowing someone matters. "O&G becomes who you know more often than not," and referrals come up in almost every thread.', src: ['r-1vuw90t', 'r-1x5adb1'], firstHand: true },
  { text: 'A CDL opens more doors, though many driving jobs also want a year of driving first.', src: ['r-1x5adb1', 'propetro-driver'], firstHand: true },
  { text: 'Take the first door that opens (a yard, a casing crew, any entry job), show up every day, then move.', src: ['r-1wsxsx4', 'r-1x5adb1'], firstHand: true },
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
  { name: 'IADC RigPass', text: 'The drilling-side orientation; student certificates do not expire.', src: ['iadc-rigpass'] },
  { name: 'H2S Clear', text: 'A 3.5 to 4 hour course on hydrogen sulfide gas that has to be retaken every year. Not listed on the entry postings read.', src: ['veriforce-h2s'] },
  { name: 'OSHA 10', text: 'OSHA calls its outreach classes "a voluntary program," and says none of them "is considered a certification." It is not an oilfield requirement.', src: ['osha-outreach'] },
  { name: 'TWIC card', text: 'Needed for secure areas of maritime facilities and vessels, so it matters for offshore and port work, not land rigs. A new card is $127.', src: ['tsa-twic'] },
  { name: 'Green hat', text: 'BSEE, the offshore safety regulator, describes green hard hats and short service employee stickers that mark workers with under 6 months on site or in the industry.', src: ['bsee-440'] },
]
export const ticketsNote = { text: 'Who pays: at the big drillers and service companies above, training happens after hire. Canadian course names such as H2S Alive come up in threads; they are not US credentials.', src: ['pat-6127', 'r-1x058sg'] }

// 7. Scams and red flags (FTC; never a promise that paying gets anyone hired).
export const scams = [
  { text: 'The FTC: "Don\'t pay for the promise of a job." Honest employers "will never ask you to pay to get a job."', src: ['ftc-scams'] },
  { text: 'Scammers sell "so-called training, or certifications that are useless." Check that a course is one an employer actually asks for before you pay.', src: ['ftc-scams'] },
  { text: '"Honest placement firms do not typically charge a fee to job candidates."', src: ['ftc-scams'] },
  { text: 'Apply on the company\'s own job board (linked above). If anyone asks you to pay to be hired or placed, stop.', src: ['ftc-scams'] },
]

// The state of hiring, said plainly.
export const hiringNow = [
  { text: '2025 was a down year. The US rig count fell 7% over 2025, and Reuters reported staff cuts at Halliburton and SLB that year.', src: ['boe-rigs', 'oe-cuts'] },
  { text: 'Activity has picked up in 2026: 604 rigs in the week of November 6, 2026, against 548 a year earlier.', src: ['aogr-rigs'] },
]

// FAQ — visible on the page and mirrored in FAQPage JSON-LD (only Q&As shown on the page).
export const faq = [
  {
    q: 'Can I get into the oilfield with no experience?',
    a: { text: 'Yes, at some large employers. Helmerich & Payne posts entry-level floorman jobs, and Patterson-UTI calls its floorhand job entry level with training provided. Some ask for a steady work history first: 1 year at Patterson-UTI.', src: ['hp-req1', 'pat-6127'] },
  },
  {
    q: 'Do I need SafeLand or H2S before I apply?',
    a: { text: 'Not at the companies checked here. None of the eight entry postings read in November 2026 lists them; those companies train new hires. Smaller contractors may ask for them first.', src: ['pat-6127', 'hp-req1'] },
  },
  {
    q: 'How much does a floorhand make to start?',
    a: { text: 'On employers\' own postings in November 2026: $28.50/hr at Patterson-UTI in Colorado and Utah, and $30.64/hr at Precision Drilling in Pennsylvania, both plus per diem.', src: ['pat-6457', 'precision-pa'] },
  },
  {
    q: 'Do oilfield companies drug test?',
    a: { text: 'Yes. Every entry posting read requires a pre-employment drug test, and Patterson-UTI also tests periodically.', src: ['pat-6127', 'hp-req1', 'hal-212296'] },
  },
  {
    q: 'Do I need a CDL?',
    a: { text: 'Not for floorhand or roustabout jobs on the postings read. Halliburton frac trainees must be able to get one, Baker Hughes wireline jobs want it before hire, and driving across state lines requires age 21.', src: ['hal-212296', 'bh-wireline', 'cfr-391-11'] },
  },
]

// Live listings block: search presets (api/jobs.js POST, nationwide when no location is sent).
export const listings = { query: 'oilfield', seeAll: 'oilfield' }

/** Every entry on the page, in render order (sources are numbered by first appearance). Employer board links count
 *  as a citation of that board. */
export function pageEntries() {
  return [
    ...entryJobs.flatMap((j) => [j.what, j.schedule].filter(Boolean)),
    asks.intro, ...asks.items, asks.note, asks.smaller,
    ...payRows, payNote, ...blsRows, blsNote,
    ...hiringNow, ...employers.map((e) => ({ ...e.evidence, src: [...e.evidence.src, e.board] })),
    ...howPeopleGetIn, ...whatEndsIt,
    ...tickets, ticketsNote,
    ...scams,
    ...faq.map((f) => f.a),
  ]
}
