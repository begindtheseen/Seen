// /start/energy — "Getting into solar and wind work". The page renders from this module only, so every figure on it
// carries a reference and an as-of date (lib/start/guides.test.mjs fails on a figure without one).
//
// THE ONLY SOURCE OF FACTS is the research file compiled 2026-11-17 (session scratchpad guides20/energy/research.md).
// Rules this module keeps:
//   • only items the research marked VERIFIED: BLS (May 2025 pay, 2025–35 projections), NABCEP and GWO's own pages,
//     OSHA and the eCFR text (Cornell LII), the FTC, the IRS, and employers' own postings read on their own boards;
//   • FIRST-HAND items (several accounts agreeing) only as `firstHand: true`, rendered as what people say, never as fact;
//   • not printed: course prices from training vendors, GWO validity in months (vendor pages only), aggregator pay
//     (ZipRecruiter, Indeed salaries, job-board copies), a per diem amount (no live employer posting states one), GE
//     Vernova's pay (its posting gives no unit), the home-solar tax credit (the IRS page contradicts itself);
//   • electrician training is the trades guide's subject (/start/trades): here only what solar and battery employers ask
//     of electricians. No hype, no guarantees, no exclamation marks.
//
// Shape: `sources` (every reference behind the page, kept here and never printed as citations — readers reach the
// links through the grouped "Additional resources" menu, `resources` below), entries `{ text, src, firstHand? }`, the
// listings filter config (`listings`, lib/start/listingFilters.js) and the openable menu rows (`menu`).

import { blockEntries } from './entries.js'

/** @typedef {{ label: string, url: string, date: string, note?: string }} Source */

/** @type {Record<string, Source>} */
export const sources = {
  // Pay and outlook
  'bls-solar': { label: 'U.S. Bureau of Labor Statistics, Occupational Outlook Handbook: Solar Photovoltaic Installers (May 2025 pay, 2025–35 outlook)', url: 'https://www.bls.gov/ooh/construction-and-extraction/solar-photovoltaic-installers.htm', date: '2026-08-27', note: 'page updated' },
  'bls-wind': { label: 'U.S. Bureau of Labor Statistics, Occupational Outlook Handbook: Wind Turbine Technicians (May 2025 pay, 2025–35 outlook)', url: 'https://www.bls.gov/ooh/installation-maintenance-and-repair/wind-turbine-technicians.htm', date: '2026-08-27', note: 'page updated' },
  // Certifications
  'nabcep-enroll': { label: 'NABCEP, Apply Now: requirements for each certification and associate credential', url: 'https://www.nabcep.org/enroll-now/', date: '2026-11-17', note: 'read' },
  'nabcep-fees': { label: 'NABCEP, fees for certifications and associate credentials', url: 'https://www.nabcep.org/certifications/nabcep-fees/', date: '2026-11-17', note: 'read' },
  'nabcep-assoc': { label: 'NABCEP, Associate Program: what the PV Associate credential is', url: 'https://www.nabcep.org/certifications/associate-program/', date: '2026-11-17', note: 'read' },
  'gwo-bst': { label: 'Global Wind Organisation, Basic Safety Training Standard (version 20)', url: 'https://www.globalwindsafety.org/standards/basic-safety-training-standard', date: '2026-03-10', note: 'standard dated' },
  'gwo-refresh': { label: 'Global Wind Organisation, Explained: why some GWO courses require a refresher every two years', url: 'https://www.globalwindsafety.org/news/explained-why-do-some-gwo-courses-require-a-refresher-every-two-years', date: '2020-06-11', note: 'published' },
  // Safety rules
  'osha-wind-falls': { label: 'OSHA, Green Job Hazards: Wind Energy, Falls', url: 'https://www.osha.gov/green-jobs/wind-energy/falls', date: '2026-11-17', note: 'read' },
  'osha-solar': { label: 'OSHA, Green Job Hazards: Solar Energy', url: 'https://www.osha.gov/green-jobs/solar', date: '2026-11-17', note: 'read' },
  'cfr-1926-501': { label: '29 CFR 1926.501, duty to have fall protection in construction (Cornell Legal Information Institute)', url: 'https://www.law.cornell.edu/cfr/text/29/1926.501', date: '2026-11-17', note: 'read' },
  'cfr-1926-503': { label: '29 CFR 1926.503, fall protection training requirements (Cornell Legal Information Institute)', url: 'https://www.law.cornell.edu/cfr/text/29/1926.503', date: '2026-11-17', note: 'read' },
  // Scams and taxes
  'ftc-scams': { label: 'Federal Trade Commission, Job Scams (consumer advice)', url: 'https://consumer.ftc.gov/articles/job-scams', date: '2023-03', note: 'article dated' },
  'irs-contractor': { label: 'IRS, Independent contractor (self-employed) or employee?', url: 'https://www.irs.gov/businesses/small-businesses-self-employed/independent-contractor-self-employed-or-employee', date: '2026-05-19', note: 'page reviewed' },
  // Employers' boards
  'sunrun-board': { label: 'Sunrun job board', url: 'https://sunrun.wd5.myworkdayjobs.com/Sunrun_Careers', date: '2026-11-17', note: 'read' },
  'clearway-board': { label: 'Clearway Energy job board', url: 'https://job-boards.greenhouse.io/clearwayjobs', date: '2026-11-17', note: 'read' },
  'edf-board': { label: 'EDF power solutions North America job board', url: 'https://careers-edf-re.icims.com/jobs/search?ss=1', date: '2026-11-17', note: 'read' },
  'gev-board': { label: 'GE Vernova job board', url: 'https://gevernova.wd5.myworkdayjobs.com/Vernova_ExternalSite', date: '2026-11-17', note: 'read' },
  'blattner-board': { label: 'Blattner Energy job board', url: 'https://blattner.wd5.myworkdayjobs.com/BlattnerEnergy', date: '2026-11-17', note: 'read' },
  'pearce-board': { label: 'Pearce Services job board', url: 'https://job-boards.greenhouse.io/pearceservices', date: '2026-11-17', note: 'read' },
  // Employers' postings
  'sunrun-installer': { label: 'Sunrun posting R77975, Solar Installer, Bloomington, IL (own job board)', url: 'https://sunrun.wd5.myworkdayjobs.com/Sunrun_Careers/job/IL-Bloomington/Solar-Installer_R77975', date: '2026-11-11', note: 'posted' },
  'sunrun-lead': { label: 'Sunrun posting R78029, Lead Solar Installer, Rockford, IL (own job board)', url: 'https://sunrun.wd5.myworkdayjobs.com/Sunrun_Careers/job/IL-Rockford/Lead-Solar-Installer_R78029', date: '2026-11-12', note: 'posted' },
  'sunrun-fore': { label: 'Sunrun posting R78016, Foreperson, Phoenix, AZ, for crews in the Chicago area (own job board)', url: 'https://sunrun.wd5.myworkdayjobs.com/Sunrun_Careers/job/AZ-Phoenix/Foreperson----3-000-sign-on-bonus_R78016', date: '2026-11-16', note: 'posted' },
  'sunrun-apprentice': { label: 'Sunrun posting R77982, Electrician Apprentice, Carpentersville, IL (own job board)', url: 'https://sunrun.wd5.myworkdayjobs.com/Sunrun_Careers/job/IL-Carpentersville/Electrician-Apprentice_R77982', date: '2026-11-11', note: 'posted' },
  'sunrun-nce': { label: 'Sunrun posting R78018, Non-Certified Electrician, Phoenix, AZ (own job board)', url: 'https://sunrun.wd5.myworkdayjobs.com/Sunrun_Careers/job/AZ-Phoenix/Non-Certified-Electrician----3-000-sign-on-bonus_R78018', date: '2026-11-16', note: 'posted' },
  'clearway-wind': { label: 'Clearway Energy posting 5216459007, Wind Technician, Forsan, TX (own job board)', url: 'https://job-boards.greenhouse.io/clearwayjobs/jobs/5216459007', date: '2026-08-24', note: 'posted' },
  'clearway-solar': { label: 'Clearway Energy posting 5273256007, Solar Technician, Desert Center, CA (own job board)', url: 'https://job-boards.greenhouse.io/clearwayjobs/jobs/5273256007', date: '2026-11-06', note: 'posted' },
  'clearway-ground': { label: 'Clearway Energy posting 5244238007, Solar Groundman, Lemoore, CA (own job board)', url: 'https://job-boards.greenhouse.io/clearwayjobs/jobs/5244238007', date: '2026-09-28', note: 'posted' },
  'edf-wind': { label: 'EDF power solutions posting 5185, Renewable Energy Technician (Wind), multiple levels, Earl Park, IN (own job board)', url: 'https://careers-edf-re.icims.com/jobs/5185/renewable-energy-technician-%28wind%29---multiple-levels-%5bon-site%5d/job', date: '2026-11-16', note: 'posted' },
  'gev-wind': { label: 'GE Vernova posting R5051844, Wind Technician, Limestone (Texas Hub 14) (own job board)', url: 'https://gevernova.wd5.myworkdayjobs.com/Vernova_ExternalSite/job/Remote/Wind-Technician---Limestone--TX14-_R5051844-2', date: '2026-11-10', note: 'posted' },
  'blattner-pool': { label: 'Blattner posting R8258, Laborer & Operator, talent pool for future openings (own job board)', url: 'https://blattner.wd5.myworkdayjobs.com/BlattnerEnergy/job/United-States/Laborer---Operator---Talent-Pool--Future-Opportunities-_R8258', date: '2026-09-30', note: 'posted' },
  'blattner-comm': { label: 'Blattner posting R8254, Commissioning Laborer, traveling nationwide (own job board)', url: 'https://blattner.wd5.myworkdayjobs.com/BlattnerEnergy/job/United-States/Commissioning-Laborer---Traveling-Nationwide_R8254', date: '2026-10-26', note: 'posted' },
  'blattner-foreman': { label: 'Blattner posting R8362, Commissioning Foreman (own job board)', url: 'https://blattner.wd5.myworkdayjobs.com/BlattnerEnergy/job/United-States/Commissioning-Foreman_R8362-1', date: '2026-08-05', note: 'posted' },
  'blattner-elec': { label: 'Blattner posting R7250, Oklahoma State Licensed Electrician (own job board)', url: 'https://blattner.wd5.myworkdayjobs.com/BlattnerEnergy/job/RemoteTraveling---Oklahoma/Oklahoma-State-Licensed-Electrician_R7250', date: '2026-09-30', note: 'posted' },
  'pearce-lead-wind': { label: 'Pearce Services posting 4802091008, Advanced and Lead Wind Technicians (own job board)', url: 'https://job-boards.greenhouse.io/pearceservices/jobs/4802091008', date: '2026-06-11', note: 'updated' },
  'pearce-wind-site': { label: 'Pearce Services posting 5431576008, Local Wind Site O&M Technician, Hoffman, MN (own job board)', url: 'https://job-boards.greenhouse.io/pearceservices/jobs/5431576008', date: '2026-09-22', note: 'posted' },
  'pearce-solar': { label: 'Pearce Services posting 5478861008, Solar Field Service Technician, Pueblo, CO (own job board)', url: 'https://job-boards.greenhouse.io/pearceservices/jobs/5478861008', date: '2026-11-11', note: 'posted' },
  'pearce-bess': { label: 'Pearce Services posting 5455972008, Solar O&M BESS Technician, Laredo, TX (own job board)', url: 'https://job-boards.greenhouse.io/pearceservices/jobs/5455972008', date: '2026-10-19', note: 'posted' },
  'pearce-ess': { label: 'Pearce Services posting 5468732008, ESS Services Technician 3, traveling (own job board)', url: 'https://job-boards.greenhouse.io/pearceservices/jobs/5468732008', date: '2026-10-30', note: 'posted' },
  // First-hand accounts (r/windturbine, read through the Arctic Shift archive). Used only where several accounts agree,
  // and rendered as what people say, never as fact.
  'r-1xdz6oy': { label: 'r/windturbine, "UTI or airstreams renewables?"', url: 'https://www.reddit.com/r/windturbine/comments/1xdz6oy/', date: '2026-10-24', note: 'thread' },
  'r-1xkxhk2': { label: 'r/windturbine, "Entering Wind: Career Questions, November 2026"', url: 'https://www.reddit.com/r/windturbine/comments/1xkxhk2/', date: '2026-11-01', note: 'thread' },
  'r-1xaj3jq': { label: 'r/windturbine, "Getting into the Wind Turbine industry."', url: 'https://www.reddit.com/r/windturbine/comments/1xaj3jq/', date: '2026-10-20', note: 'thread' },
  'r-1wkztu8': { label: 'r/windturbine, "Fresh Graduated wind turbine technician any advices"', url: 'https://www.reddit.com/r/windturbine/comments/1wkztu8/', date: '2026-09-19', note: 'thread' },
  'r-1xd4xxv': { label: 'r/windturbine, "Wind turbine tech jobs Sacramento or traveling? Relocation? Offshore operations?"', url: 'https://www.reddit.com/r/windturbine/comments/1xd4xxv/', date: '2026-10-23', note: 'thread' },
  'r-1xu1z6a': { label: 'r/windturbine, "Wind technician pay"', url: 'https://www.reddit.com/r/windturbine/comments/1xu1z6a/', date: '2026-11-12', note: 'thread' },
}

export const guide = {
  path: '/start/energy',
  title: 'Getting into solar and wind work',
  crumbLabel: 'Solar and wind work',
  eyebrow: 'Guide',
  // The one-sentence answer under the h1 (the page's first screen).
  answer: { text: 'Rooftop solar crews and wind farm operators hire beginners and train them; battery and wiring work goes to people with electrical experience. Here is what they ask for, what they pay, and who is hiring now.', src: ['sunrun-installer', 'clearway-wind', 'sunrun-nce', 'pearce-bess'] },
  metaDescription: 'How to start in US solar and wind work: solar installer, solar farm laborer, battery storage and wind turbine technician jobs, what employers ask for and pay, NABCEP and GWO training, travel and per diem, and live listings near you.',
  asOf: '2026-11-17',
}

// The three readings in the hero: each restates a fact below, with the same references.
export const tiles = [
  { label: 'Solar installer pay', value: '$21.82–$29.09', text: 'an hour at Sunrun, posted November 2026; experience preferred, not required', src: ['sunrun-installer'] },
  { label: 'Wind trainee pay', value: '$41,600–$49,920', text: 'a year at Clearway Energy; no prior electrical experience required', src: ['clearway-wind'] },
  { label: 'Projected job growth', value: '37% and 30%', text: 'solar installers and wind technicians, 2025 to 2035 (BLS), from small bases', src: ['bls-solar', 'bls-wind'] },
]

// 1. The jobs: a name, one line, and the figures as chips.
export const jobs = [
  {
    name: 'Solar installer', aka: 'Rooftop crews',
    body: { text: 'Mounts racking and panels on homes with a crew. Sunrun lists solar, construction or military experience as preferred, not required, and includes paid training.', src: ['sunrun-installer'] },
    chips: [{ text: '$21.82–$29.09/hr at Sunrun', src: ['sunrun-installer'] }, { text: 'Median $53,140/yr, all PV installers', src: ['bls-solar'] }],
  },
  {
    name: 'Solar farm laborer', aka: 'Utility-scale building',
    body: { text: 'Builds and commissions large solar, wind and battery sites, usually on the road. Blattner asks its commissioning laborers to travel 100%.', src: ['blattner-comm'] },
    chips: [{ text: '$18–$30/hr at Blattner, plus per diem if eligible', src: ['blattner-pool'] }],
  },
  {
    name: 'Solar technician', aka: 'Running built plants',
    body: { text: 'Maintains solar plants that are already running. Clearway hires trainees with no prior electrical experience; they must pass an exam and an oral board within 6 months.', src: ['clearway-solar'] },
    chips: [{ text: '$50,000–$60,000/yr, trainee at Clearway', src: ['clearway-solar'] }],
  },
  {
    name: 'Battery storage technician', aka: 'BESS',
    body: { text: 'Installs and services batteries. It is electrical work: Sunrun gives battery installs to its electricians as state rules allow, and Pearce asks for 3 to 4 years or more of electrical work.', src: ['sunrun-nce', 'pearce-bess'] },
    chips: [{ text: '$30–$42/hr at Pearce, Laredo, TX', src: ['pearce-bess'] }],
  },
  {
    name: 'Wind turbine technician', aka: 'Windtech',
    body: { text: 'Climbs towers to maintain and repair turbines. Clearway takes trainees with no prior electrical experience; GE Vernova asks for a year as a windtech, a wind program, or 2 years of electrical work.', src: ['clearway-wind', 'gev-wind'] },
    chips: [{ text: '$41,600–$49,920/yr, trainee at Clearway', src: ['clearway-wind'] }, { text: 'Median $64,120/yr', src: ['bls-wind'] }],
  },
  {
    name: 'Lead or foreperson', aka: 'With experience',
    body: { text: 'Runs an install crew of 3 to 6 at Sunrun, which asks for 2 years of construction and wiring experience up to 600 VDC.', src: ['sunrun-fore'] },
    chips: [{ text: '$31.94–$53.24/hr at Sunrun', src: ['sunrun-fore'] }],
  },
]

export const blsRows = [
  { job: 'Solar photovoltaic installers', median: '$53,140', hourly: '$25.55', range: '$41,600 to $79,970', count: '31,100', growth: '37%', src: ['bls-solar'] },
  { job: 'Wind turbine technicians', median: '$64,120', hourly: '$30.83', range: '$49,230 to $92,460', count: '11,800', growth: '30%', src: ['bls-wind'] },
]
export const blsNote = { text: 'National pay for May 2025; the range runs from the lowest-paid 10% to the highest-paid 10%. Jobs are the 2025 count, and growth is projected for 2025 to 2035: about 11,300 more solar installer jobs and 3,500 more wind technician jobs. The BLS calls both "much faster than average."', src: ['bls-solar', 'bls-wind'] }

// 2. What employers ask for (entry postings read in full on their own boards).
export const asks = {
  intro: { text: 'What entry postings from Sunrun, Clearway Energy, EDF power solutions and GE Vernova asked for in November 2026.', src: ['sunrun-installer', 'clearway-wind', 'clearway-solar', 'edf-wind', 'gev-wind'] },
  items: [
    { name: 'A high school diploma or GED', text: 'Clearway also takes trainees who finish one within 6 months of hire.', src: ['clearway-wind', 'edf-wind', 'gev-wind'] },
    { name: 'A driver\'s license and a clean record', text: 'Sunrun reviews your driving record after a conditional offer; its lead, foreperson and electrician jobs ask for age 21.', src: ['sunrun-nce', 'sunrun-lead', 'clearway-ground'] },
    { name: 'Heavy lifting', text: 'Sunrun: up to 50 pounds often and up to 100 pounds with help. GE Vernova: 50 pounds, again and again.', src: ['sunrun-installer', 'gev-wind'] },
    { name: 'Climbing, for wind', text: 'Towers up to 300 feet, daily at GE Vernova. Clearway adds standing outside the nacelle at the top.', src: ['gev-wind', 'clearway-wind'] },
    { name: 'A weight limit, for wind', text: 'Fall-arrest gear has one: EDF caps wind technicians at 285 pounds; Pearce asks for 120 to 280 pounds with clothes and boots.', src: ['edf-wind', 'pearce-wind-site'] },
    { name: 'A drug screen', text: 'GE Vernova makes its offers conditional on one.', src: ['gev-wind'] },
    { name: 'Electrical experience, for battery and wiring jobs', text: 'Sunrun\'s electrician apprentice asks for 2 years of electrical work; Pearce\'s battery technician, 3 to 4 years or more.', src: ['sunrun-apprentice', 'pearce-bess'] },
  ],
  certLine: { text: 'Certificates first: none of the entry postings we read asks for NABCEP or GWO before hire. EDF trains every new technician, and Sunrun includes paid training.', src: ['sunrun-installer', 'clearway-wind', 'clearway-solar', 'gev-wind', 'edf-wind'] },
}

// The certificates: who issues each, what it takes, what it costs (fees only from the issuing body).
export const certRows = [
  { cert: 'PV Associate (PVA)', body: 'NABCEP', takes: 'A course with a NABCEP-registered provider, or 6 months of full-time solar work; then an exam', fee: '$25 application, $125 exam', src: ['nabcep-enroll', 'nabcep-fees'] },
  { cert: 'PV Installation Professional (PVIP)', body: 'NABCEP', takes: '6 project credits in a decision-making role, OSHA 10 and 58 hours of training; then an exam', fee: '$125 application, $375 exam', src: ['nabcep-enroll', 'nabcep-fees'] },
  { cert: 'Energy Storage Installation Professional (ESIP)', body: 'NABCEP', takes: '6 project credits in a decision-making role, OSHA 30 and 58 hours of training; then an exam', fee: '$125 application, $375 exam', src: ['nabcep-enroll', 'nabcep-fees'] },
  { cert: 'Basic Safety Training (BST)', body: 'Global Wind Organisation (GWO)', takes: 'Modules in first aid, manual handling, fire awareness and working at height; sea survival for offshore wind', src: ['gwo-bst'] },
]
export const certNote = { text: 'NABCEP says passing the Associate exam qualifies you to design, sell, install or maintain systems "in a supervised capacity," and that its fees are non-refundable. A training provider may charge $125 to $180 for the first Associate test. GWO recommends refreshing safety training every two years.', src: ['nabcep-assoc', 'nabcep-fees', 'gwo-refresh'] }
export const licenseNote = { text: 'Wiring can need a license. The BLS says some states require one for solar installers, and Sunrun assigns battery installs by state electrical certification rules. Seen\'s trades guide covers the electrical apprenticeship.', src: ['bls-solar', 'sunrun-nce'] }

// 3. Heights and safety (BLS, OSHA, the eCFR; employers' own postings).
export const hazards = { text: 'The main risks, as the BLS and OSHA list them: falls from roofs, ladders and towers, electric shock and arc flash, and burns.', src: ['bls-solar', 'osha-solar'] }
export const fallRules = [
  { text: 'On roofs, homes and building sites, OSHA requires fall protection from 6 feet up: a guardrail, a net or a personal fall-arrest harness.', src: ['cfr-1926-501', 'osha-wind-falls'] },
  { text: 'Maintaining a turbine that is already built counts as general industry, where the line is 4 feet.', src: ['osha-wind-falls'] },
  { text: 'Your employer must train you to recognize fall hazards and what to do about them.', src: ['cfr-1926-503'] },
]
export const windWork = [
  { text: 'Nacelles sit on towers over 200 feet tall. Technicians climb in a fall-protection harness and rappel down for blade repairs.', src: ['bls-wind'] },
  { text: 'Most windtechs work full time and may be on call evenings and weekends; Clearway\'s on-call list adds holidays.', src: ['bls-wind', 'clearway-wind'] },
]
export const solarWork = [
  { text: 'Rooftop work in extreme heat, cold and wet weather, walking on rafters and shingles in a harness.', src: ['sunrun-installer'] },
  { text: 'The BLS says solar installers lift equipment and materials of up to 60 pounds.', src: ['bls-solar'] },
]

// 4. Travel and per diem (employers' own postings only; no per diem amount is stated on a live posting).
export const travelIntro = { text: 'Building big solar, wind and battery sites, and many service jobs, means moving from site to site. What employers state on their own postings:', src: ['blattner-comm', 'pearce-ess'] }
export const travel = [
  { text: 'Blattner: commissioning laborers travel 100%, nationwide, with per diem "based on eligibility."', src: ['blattner-comm'] },
  { text: 'Blattner\'s commissioning foreman: per diem for meals, lodging and incidentals, and a rotation with paid flights home.', src: ['blattner-foreman'] },
  { text: 'Pearce: traveling battery technicians can be away up to six weeks at a time, with per diem while traveling.', src: ['pearce-ess'] },
  { text: 'EDF: every new technician trains 3 to 4 weeks in Albert Lea, Minnesota, with travel, lodging and expenses covered.', src: ['edf-wind'] },
  { text: 'The BLS says wind technicians may travel to rural or offshore wind farms and be away from home for days or weeks.', src: ['bls-wind'] },
]
export const travelSaid = [
  { text: 'A traveling technician job is the easiest first door into wind, and per diem is a big part of the money.', src: ['r-1xaj3jq', 'r-1xu1z6a'], firstHand: true },
  { text: 'Winter is slow for contractors; some techs are benched for a month or two, or worry about work every winter.', src: ['r-1xd4xxv', 'r-1xu1z6a'], firstHand: true },
]

// 5. Who hires beginners (each with evidence from its own board). `board` is the reference key of its board.
export const employers = [
  { name: 'Sunrun', board: 'sunrun-board', roles: ['Solar installer', 'Lead installer', 'Electrician', 'Foreperson'], pay: { value: '$21.82–$29.09/hr', note: 'solar installer, Bloomington, IL', src: ['sunrun-installer'] }, evidence: { text: 'Home solar and batteries. Its installer posting lists experience as preferred, not required.', src: ['sunrun-installer'] } },
  { name: 'Clearway Energy', board: 'clearway-board', roles: ['Wind technician trainee', 'Solar technician trainee', 'Solar groundman'], pay: { value: '$41,600–$49,920/yr', note: 'wind technician trainee', src: ['clearway-wind'] }, evidence: { text: 'Runs solar and wind plants. Trainees need no prior electrical experience and must pass an exam and an oral board within 6 months.', src: ['clearway-wind', 'clearway-solar'] } },
  { name: 'EDF power solutions', board: 'edf-board', roles: ['Renewable energy technician'], pay: { value: '$22.69–$47.74/hr', note: 'all five technician levels', src: ['edf-wind'] }, evidence: { text: 'Its entry level asks for 0 to 1 year of experience, and technicians work on wind, solar and battery sites.', src: ['edf-wind'] } },
  { name: 'Blattner', board: 'blattner-board', roles: ['Laborer', 'Commissioning laborer', 'Electrician', 'Commissioning foreman'], pay: { value: '$18–$30/hr', note: 'laborers and operators, plus per diem if eligible', src: ['blattner-pool'] }, evidence: { text: 'Builds utility-scale solar, wind and battery sites. Its laborer posting is a pool for future openings, and its field jobs are 100% travel.', src: ['blattner-pool', 'blattner-comm', 'blattner-elec'] } },
  { name: 'GE Vernova', board: 'gev-board', roles: ['Wind technician', 'Wind hub technician'], evidence: { text: 'Asks for a year as a windtech, a wind program or 2 years of electrical work, and a drug screen after the offer.', src: ['gev-wind'] } },
  { name: 'Pearce Services', board: 'pearce-board', roles: ['Solar field technician', 'Battery technician', 'Wind technician'], pay: { value: '$25–$35/hr', note: 'solar field technician, Pueblo, CO', src: ['pearce-solar'] }, evidence: { text: 'Services solar, battery and wind sites. Its wind and battery postings ask for 3 years of experience or more.', src: ['pearce-wind-site', 'pearce-bess'] } },
]

export const payRows = [
  { company: 'Sunrun', role: 'Solar installer, Bloomington, IL', pay: '$21.82 to $29.09 an hour', src: ['sunrun-installer'] },
  { company: 'Sunrun', role: 'Foreperson, Chicago-area crews', pay: '$31.94 to $53.24 an hour', src: ['sunrun-fore'] },
  { company: 'Clearway Energy', role: 'Wind technician trainee', pay: '$41,600 to $49,920 a year', src: ['clearway-wind'] },
  { company: 'Clearway Energy', role: 'Solar technician trainee', pay: '$50,000 to $60,000 a year', src: ['clearway-solar'] },
  { company: 'Clearway Energy', role: 'Solar groundman, Lemoore, CA', pay: '$47,000 to $55,000 a year', src: ['clearway-ground'] },
  { company: 'EDF power solutions', role: 'Renewable energy technician, all levels', pay: '$22.69 to $47.74 an hour', src: ['edf-wind'] },
  { company: 'Pearce Services', role: 'Solar field service technician, Pueblo, CO', pay: '$25 to $35 an hour', src: ['pearce-solar'] },
  { company: 'Pearce Services', role: 'Wind site technician, Hoffman, MN', pay: '$26 to $30 an hour', src: ['pearce-wind-site'] },
  { company: 'Pearce Services', role: 'Solar and battery technician, Laredo, TX', pay: '$30 to $42 an hour', src: ['pearce-bess'] },
  { company: 'Blattner', role: 'Laborer and operator, talent pool', pay: '$18 to $30 an hour, plus per diem if eligible', src: ['blattner-pool'] },
  { company: 'Blattner', role: 'Commissioning laborer, traveling', pay: '$18 to $25 an hour, plus per diem if eligible', src: ['blattner-comm'] },
]
export const payNote = { text: 'Pay on a posting is the employer\'s statement on the date read. Clearway and EDF give one range across several levels, and trainees start at the bottom of it.', src: ['clearway-wind', 'edf-wind'] }

export const peopleSay = [
  { text: 'Wind employers usually send new hires through GWO training themselves, so paying for a school first is not required.', src: ['r-1xdz6oy', 'r-1xkxhk2', 'r-1xaj3jq'], firstHand: true },
  { text: 'The first wind job is competitive, even with GWO certificates in hand: apply widely and keep applying.', src: ['r-1wkztu8', 'r-1xd4xxv'], firstHand: true },
]

// 6. Watch out (FTC, IRS, employers' own terms).
export const beforeYouSign = [
  { text: 'Read the repayment terms. Sunrun\'s relocation money must be paid back if you quit, or are fired for cause, within 12 months.', src: ['sunrun-fore'] },
  { text: 'A "talent pool" is not an opening. Blattner says its laborer pool "does not represent an active job opening."', src: ['blattner-pool'] },
  { text: 'Ask whether the job is W-2 or 1099. For employees the business withholds income, Social Security and Medicare taxes; for contractors it generally does not.', src: ['irs-contractor'] },
]
export const scams = [
  { text: 'Never pay to be hired. The FTC: honest employers "will never ask you to pay to get a job."', src: ['ftc-scams'] },
  { text: 'Skip "so-called training, or certifications that are useless." Check that an employer asks for a course before you pay for it.', src: ['ftc-scams'] },
  { text: 'Apply on the employer\'s own job board, linked under Who hires beginners. "Honest placement firms do not typically charge a fee to job candidates."', src: ['ftc-scams'] },
]

// FAQ — visible on the page and mirrored in FAQPage JSON-LD (only Q&As shown on the page).
export const faq = [
  {
    q: 'Can I become a solar installer with no experience?',
    a: { text: 'Yes, at some employers. Sunrun lists solar, construction or military experience as preferred, not required, and includes paid training. The BLS says on-the-job training usually lasts 1 month to 1 year.', src: ['sunrun-installer', 'bls-solar'] },
  },
  {
    q: 'Do I need NABCEP certification to get hired?',
    a: { text: 'Not on the entry postings we read in November 2026 from Sunrun, Clearway Energy and Pearce. The NABCEP PV Associate costs $25 to apply plus $125 for the exam, and NABCEP says it qualifies you to work "in a supervised capacity."', src: ['sunrun-installer', 'clearway-solar', 'pearce-solar', 'nabcep-fees', 'nabcep-assoc'] },
  },
  {
    q: 'Do I need GWO training before I apply for wind jobs?',
    a: { text: 'None of the entry wind postings we read at Clearway Energy, GE Vernova and EDF asks for it before hire. EDF sends every new technician to a 3 to 4 week course with travel paid, and Pearce lists GWO certifications for its lead technicians.', src: ['clearway-wind', 'gev-wind', 'edf-wind', 'pearce-lead-wind'] },
  },
  {
    q: 'How much do wind turbine technicians make?',
    a: { text: 'The BLS median was $64,120 a year in May 2025. Clearway Energy pays trainees $41,600 to $49,920 a year, and EDF\'s range across five levels is $22.69 to $47.74 an hour.', src: ['bls-wind', 'clearway-wind', 'edf-wind'] },
  },
  {
    q: 'Do I need an electrician\'s license to install solar?',
    a: { text: 'Some states require a license for solar installers, the BLS says. At Sunrun, battery installs and wiring go to electricians as state rules require, and its electrician jobs ask for electrical experience first.', src: ['bls-solar', 'sunrun-nce', 'sunrun-apprentice'] },
  },
  {
    q: 'Are solar and wind jobs growing?',
    a: { text: 'The BLS projects solar installer jobs to grow 37% and wind technician jobs 30% from 2025 to 2035. Both are small fields: 31,100 and 11,800 jobs in 2025.', src: ['bls-solar', 'bls-wind'] },
  },
]

// ── Listings: the filters on the "Hiring now" block (lib/start/listingFilters.js) ──────────────────────────────────
// Seen's own rows (read 2026-11-17): Clearway and Pearce solar, wind and battery technicians, a Clearway groundman,
// Freedom Power installers; a plain "solar" or "battery" search answers mostly look-alikes (SpaceX Starlink solar-cell
// factory jobs, space solar engineers, EV and drone battery engineers, Walmart tire and battery), so every row must name
// an energy word in its title (or be at an employer that only does this work), and engineering, factory, sales and
// management titles are excluded. Pearce also hires HVAC and data-center techs, so it is not in the employer gate.
// A plain title is read as entry (installers and technicians train on the job); lead / II / III / journeyman is not.
const ENERGY_TITLE = '\\b(solar|photovoltaic|wind|windtechs?|wind turbines?|bess|ess|battery storage|energy storage|renewables?|nacelle|inverters?)\\b'
const ENERGY_COMPANY = '(sunrun|clearway|blattner|freedom forever|freedom power|edf power|edf renewables|invenergy|vestas|siemens gamesa|nordex|solar|wind energy|renewable)'
export const listings = {
  defaultRadius: '100',
  radii: ['25', '50', '100', '250'],
  levelMode: 'entryUnlessMarked',
  levelLabels: { any: 'Any level', entry: 'Entry / trainee', experienced: 'Experienced' },
  levelWords: { entry: 'entry-level', experienced: 'experienced' },
  gateTitle: ENERGY_TITLE,
  gateCompany: ENERGY_COMPANY,
  exclude: '\\b(engineers?|engineering|manager|director|sales|scientist|starlink|spacecraft|satellite|space|designer|analyst|recruiter|procurement|purchasing|development|developer|attorney|lawyer|counsel|accountant|marketing|cells?|manufacturing|factory|vehicle|automotive|tire|drone|fpv|intern|internship|scheduler|controls|coordinator|administrat\\w*|assistant|surveyor|gas|nuclear|hydro|trading|dispatch|data center)\\b',
  positions: [
    { id: 'all', label: 'All jobs', noun: 'solar and wind', mix: 'positions', queries: ['solar installer', 'wind technician', 'solar technician', 'bess technician', 'solar laborer'], seeAll: 'solar installer' },
    { id: 'solar-installer', label: 'Solar installer / tech', noun: 'solar installer and technician', queries: ['solar installer', 'solar technician'], match: '\\binstallers?\\b|solar (?:panel )?(?:install|technician|tech\\b|field)|pv (?:installer|technician)' },
    { id: 'helper', label: 'Helper / laborer', noun: 'solar and wind laborer', queries: ['solar laborer', 'solar groundman', 'solar helper'], match: '\\blabou?rers?\\b|groundm[ae]n|\\bhelpers?\\b|crew member' },
    { id: 'storage', label: 'Battery storage', noun: 'battery storage', queries: ['bess technician', 'battery storage technician', 'energy storage technician'], match: '\\bbess\\b|\\bess\\b|battery (?:energy )?storage|energy storage|battery install' },
    { id: 'wind', label: 'Wind technician', noun: 'wind technician', queries: ['wind technician', 'wind turbine technician'], match: '\\bwind\\b.*\\b(?:tech\\w*|mechanic)|windtech' },
    { id: 'electrician', label: 'Electrician (solar)', noun: 'solar electrician', queries: ['solar electrician', 'renewable energy electrician'], match: 'electrician|electrical (?:apprentice|trainee|technician|worker)|wirem[ae]n' },
    { id: 'lead', label: 'Lead / foreman', noun: 'solar and wind lead and foreman', queries: ['solar foreman', 'lead solar installer', 'lead wind technician'], match: '\\b(?:lead|foreman|foremen|foreperson|supervisor|superintendent)\\b' },
  ],
}

// ── The page's openable rows (components/start/Guide.tsx `Blocks` renders each block type) ─────────────────────────
export const menu = [
  {
    id: 'jobs', title: 'The jobs', summary: 'Six ways in, with pay on real postings',
    blocks: [
      { type: 'cards', items: jobs },
      { type: 'more', title: 'National pay and job growth', blocks: [
        { type: 'table', caption: 'Pay and projected growth for solar installers and wind technicians', columns: [{ key: 'job', label: 'Job' }, { key: 'median', label: 'Median a year', num: true }, { key: 'hourly', label: 'Median an hour', num: true }, { key: 'range', label: 'Low to high', num: true }, { key: 'count', label: 'Jobs', num: true }, { key: 'growth', label: 'Projected growth', num: true }], rows: blsRows },
        { type: 'text', entry: blsNote },
      ] },
    ],
  },
  {
    id: 'what-you-need', title: 'What employers ask for', summary: 'License, lifting, climbing, certificates',
    blocks: [
      { type: 'text', entry: asks.intro },
      { type: 'checklist', items: asks.items, cols: true },
      { type: 'callout', entry: asks.certLine },
      { type: 'more', title: 'NABCEP and GWO: what each takes and costs', blocks: [
        { type: 'table', caption: 'Solar and wind certificates', columns: [{ key: 'cert', label: 'Certificate' }, { key: 'body', label: 'From' }, { key: 'takes', label: 'What it takes' }, { key: 'fee', label: 'Fee' }], rows: certRows },
        { type: 'text', entry: certNote },
        { type: 'text', entry: licenseNote },
      ] },
      { type: 'resumeLink', before: 'Before you apply, you can', label: 'check your résumé against a posting' },
    ],
  },
  {
    id: 'heights', title: 'Heights and safety', summary: 'Fall protection, climbing, weather',
    blocks: [
      { type: 'text', entry: hazards },
      { type: 'notes', label: 'The rules on falls', items: fallRules },
      { type: 'notes', label: 'Wind work', items: windWork },
      { type: 'notes', label: 'Rooftop solar work', items: solarWork },
    ],
  },
  {
    id: 'travel', title: 'Travel and per diem', summary: 'Who travels, and what employers cover',
    blocks: [
      { type: 'text', entry: travelIntro },
      { type: 'notes', items: travel },
      { type: 'more', title: 'What people in wind say', blocks: [
        { type: 'text', plain: 'Several accounts agree on each of these.' },
        { type: 'notes', items: travelSaid },
      ] },
    ],
  },
  {
    id: 'who-hires', title: 'Who hires beginners', summary: 'Six employers and what they pay',
    blocks: [
      { type: 'employers', items: employers, shown: 4, moreTitle: 'more employers' },
      { type: 'more', title: 'Pay on each posting', blocks: [
        { type: 'table', caption: 'Pay stated on employers’ own postings', columns: [{ key: 'company', label: 'Company' }, { key: 'role', label: 'Role' }, { key: 'pay', label: 'Stated pay', num: true }], rows: payRows },
        { type: 'text', entry: payNote },
      ] },
      { type: 'more', title: 'What people who got into wind say', blocks: [
        { type: 'text', plain: 'Several accounts agree on each of these.' },
        { type: 'notes', items: peopleSay },
      ] },
    ],
  },
  {
    id: 'watch-out', title: 'Watch out', icon: 'caution', summary: 'Repayment terms, contractor jobs, scams',
    blocks: [
      { type: 'notesGrid', groups: [
        { label: 'Before you sign', items: beforeYouSign, icon: 'x' },
        { label: 'Scams', items: scams, icon: 'x' },
      ] },
    ],
  },
  { id: 'questions', title: 'Common questions', summary: 'Experience, NABCEP, GWO, pay, licenses', blocks: [{ type: 'faq', items: faq }] },
]

// ── Additional resources: every reference above, as plain grouped links (no numbers, closed by default) ────────────
export const resourcesSummary = 'Job boards, certificates, safety rules, pay data'
export const resources = [
  { title: 'Employers’ job boards', items: [
    { key: 'sunrun-board', name: 'Sunrun careers' },
    { key: 'clearway-board', name: 'Clearway Energy careers' },
    { key: 'edf-board', name: 'EDF power solutions careers' },
    { key: 'blattner-board', name: 'Blattner Energy careers' },
    { key: 'gev-board', name: 'GE Vernova careers' },
    { key: 'pearce-board', name: 'Pearce Services careers' },
  ] },
  { title: 'Postings', items: [
    { key: 'sunrun-installer', name: 'Sunrun: Solar Installer, Bloomington, IL' },
    { key: 'sunrun-lead', name: 'Sunrun: Lead Solar Installer, Rockford, IL' },
    { key: 'sunrun-fore', name: 'Sunrun: Foreperson' },
    { key: 'sunrun-apprentice', name: 'Sunrun: Electrician Apprentice, Carpentersville, IL' },
    { key: 'sunrun-nce', name: 'Sunrun: Non-Certified Electrician' },
    { key: 'clearway-wind', name: 'Clearway Energy: Wind Technician, Forsan, TX' },
    { key: 'clearway-solar', name: 'Clearway Energy: Solar Technician, Desert Center, CA' },
    { key: 'clearway-ground', name: 'Clearway Energy: Solar Groundman, Lemoore, CA' },
    { key: 'edf-wind', name: 'EDF power solutions: Renewable Energy Technician (Wind), Earl Park, IN' },
    { key: 'gev-wind', name: 'GE Vernova: Wind Technician, Limestone, Texas' },
    { key: 'blattner-pool', name: 'Blattner: Laborer and Operator talent pool' },
    { key: 'blattner-comm', name: 'Blattner: Commissioning Laborer, traveling' },
    { key: 'blattner-foreman', name: 'Blattner: Commissioning Foreman' },
    { key: 'blattner-elec', name: 'Blattner: Oklahoma State Licensed Electrician' },
    { key: 'pearce-lead-wind', name: 'Pearce Services: Advanced and Lead Wind Technicians' },
    { key: 'pearce-wind-site', name: 'Pearce Services: Wind Site Technician, Hoffman, MN' },
    { key: 'pearce-solar', name: 'Pearce Services: Solar Field Service Technician, Pueblo, CO' },
    { key: 'pearce-bess', name: 'Pearce Services: Solar and Battery Technician, Laredo, TX' },
    { key: 'pearce-ess', name: 'Pearce Services: traveling battery technician' },
  ] },
  { title: 'Certificates and training', items: [
    { key: 'nabcep-enroll', name: 'NABCEP requirements for each credential' },
    { key: 'nabcep-fees', name: 'NABCEP fees' },
    { key: 'nabcep-assoc', name: 'NABCEP PV Associate' },
    { key: 'gwo-bst', name: 'GWO Basic Safety Training' },
    { key: 'gwo-refresh', name: 'Why GWO training is refreshed every two years' },
  ] },
  { title: 'Safety rules', items: [
    { key: 'osha-wind-falls', name: 'Fall hazards in wind energy (OSHA)' },
    { key: 'osha-solar', name: 'Hazards in solar energy (OSHA)' },
    { key: 'cfr-1926-501', name: 'When fall protection is required (29 CFR 1926.501)' },
    { key: 'cfr-1926-503', name: 'Fall protection training (29 CFR 1926.503)' },
  ] },
  { title: 'Pay data', items: [
    { key: 'bls-solar', name: 'Solar photovoltaic installers (Bureau of Labor Statistics)' },
    { key: 'bls-wind', name: 'Wind turbine technicians (Bureau of Labor Statistics)' },
  ] },
  { title: 'Scams and taxes', items: [
    { key: 'ftc-scams', name: 'Job scams (Federal Trade Commission)' },
    { key: 'irs-contractor', name: 'Contractor or employee? (IRS)' },
  ] },
  { title: 'Community discussions', items: [
    { key: 'r-1xdz6oy', name: 'Choosing a wind training school' },
    { key: 'r-1xkxhk2', name: 'Entering wind: career questions' },
    { key: 'r-1xaj3jq', name: 'Getting into the wind turbine industry' },
    { key: 'r-1wkztu8', name: 'Advice for a new wind technician' },
    { key: 'r-1xd4xxv', name: 'Breaking into wind, local or traveling' },
    { key: 'r-1xu1z6a', name: 'Wind technician pay and per diem' },
  ] },
]

/** Every fact on the page, in reading order: the hero, then each menu row; an employer's board link counts as one. */
export function pageEntries() {
  return [guide.answer, ...tiles, ...blockEntries(menu), ...employers.map((e) => ({ text: e.name, src: [e.board] }))]
}
