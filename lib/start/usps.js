// /start/usps — "Getting hired at the Postal Service". A COMPANY guide: the page renders from this module only, so every
// figure on it carries a reference and an as-of date (lib/start/guides.test.mjs fails on a figure without one).
//
// THE ONLY SOURCE OF FACTS is the research file compiled 2026-11-17 (session scratchpad guides20/usps/research.md).
// Rules this module keeps:
//   • only items the research marked VERIFIED: USPS's own careers pages, the VEA candidate guide, Handbook EL-312, the
//     FY2025 Annual Report to Congress, the Postal Bulletin, 39 U.S.C. § 201, the four unions' own contracts and pay
//     charts (NALC, NRLCA, APWU, NPMHU), the Postal Inspection Service and the FTC;
//   • pay ONLY from a union pay chart or contract, each with its effective date. No rural carrier associate dollar rate:
//     the NRLCA's Table Four is not in the public contract text and its pay page is members-only (rates on fan sites are
//     not printed). No individual USPS posting could be read (jobs.usps.com answers servers with a challenge), so no
//     posting's own pay line is printed;
//   • USAJOBS: only what USPS's own pages say (its entry jobs are applied for on its own USPS Careers site), never a
//     claim that no USPS job is ever on USAJOBS;
//   • FIRST-HAND items (two or more r/USPS accounts agreeing) only as `firstHand: true`, rendered as what people say;
//   • nothing UNVERIFIED: no "most applicants fail", no test-taking tricks, no time-to-regular figure, no PSE grade per job
//     (no primary page states it), no injury rates, no leadership, finances or politics;
//   • `listings = null`: Seen holds no USPS rows (seven read-only checks on 2026-11-17 returned 0), so the page sends
//     people to USPS's own job search (the "Where to apply" row);
//   • no hype, no promises, no exclamation marks.
//
// Shape: `sources` (every reference behind the page, kept here and NEVER printed as citations — readers reach the links
// through the grouped "Additional resources" menu, `resources` below), entries `{ text, src, firstHand? }`, `listings`
// (null here) and the openable menu rows (`menu`, rendered by components/start/Guide.tsx). Pure data; relative imports
// only so `node --test` runs it as is.

import { blockEntries } from './entries.js'

/** @typedef {{ label: string, url: string, date: string, note?: string }} Source */

const JOBS = 'https://jobs.usps.com/'
const thread = (id) => `https://www.reddit.com/r/USPS/comments/${id}/`

/** @type {Record<string, Source>} */
export const sources = {
  'usps-careers': { label: 'USPS, Careers overview (about.usps.com)', url: 'https://about.usps.com/careers/', date: '2026-11-17', note: 'read' },
  'usps-jobs': { label: 'USPS Careers job search, jobs.usps.com (search by ZIP code and radius; list page read 2026-11-17)', url: JOBS, date: '2026-11-17', note: 'read' },
  'usps-topjobs': { label: 'USPS, Career opportunities: top jobs (CCA, RCA, ARC, PSE clerks, MHA)', url: 'https://about.usps.com/careers/career-opportunities/top-jobs.htm', date: '2026-11-17', note: 'read' },
  'usps-apply': { label: 'USPS, How to apply: the two application systems, employment requirements, when to search', url: 'https://about.usps.com/careers/how-to-apply/', date: '2026-11-17', note: 'read' },
  'usps-ecareer': { label: 'USPS, Legacy application website (eCareer) help and tips', url: 'https://about.usps.com/careers/how-to-apply/create-profile-and-apply.htm', date: '2026-11-17', note: 'read' },
  'usps-exams': { label: 'USPS, Exams: Virtual Entry Assessment, exam list, retests and fraud', url: 'https://about.usps.com/careers/how-to-apply/exams.htm', date: '2026-11-17', note: 'read' },
  'usps-vea': { label: 'USPS, Virtual Entry Assessment (VEA) Candidate Guide (PDF)', url: 'https://about.usps.com/careers/global/pdf/vea-guide.pdf', date: '2025-05-07', note: 'revised' },
  'usps-military': { label: 'USPS, Careers for military and veterans: veterans’ preference', url: 'https://about.usps.com/careers/career-opportunities/transitioning-military.htm', date: '2026-11-17', note: 'read' },
  'usps-benefits': { label: 'USPS, Compensation and benefits for career employees', url: 'https://about.usps.com/careers/working-usps/benefits.htm', date: '2026-11-17', note: 'read' },
  'usps-fairchance': { label: 'USPS, Fair Chance Act (criminal history questions before a conditional offer)', url: 'https://about.usps.com/who/legal/fair-chance-act/welcome.htm', date: '2026-11-17', note: 'read' },
  'el312': { label: 'USPS Handbook EL-312, Employment and Placement (April 2026): minimum age, driving record, drug screening', url: 'https://about.usps.com/handbooks/el312.pdf', date: '2026-04', note: 'issued' },
  'usps-ar2025': { label: 'USPS, Fiscal Year 2025 Annual Report to Congress (career and pre-career employees at Sept. 30, 2025)', url: 'https://about.usps.com/what/financials/annual-reports/fy2025.pdf', date: '2026-01-14', note: 'published' },
  'usps-pb-ema': { label: 'USPS Postal Bulletin 22705, Equipment Maintenance Allowance schedule for rural routes', url: 'https://about.usps.com/postal-bulletin/2026/pb22705/html/info_003.htm', date: '2026-06-25', note: 'published' },
  'usps-nrlca-news': { label: 'USPS Link, National Rural Letter Carriers’ Association approves contract with USPS', url: 'https://news.usps.com/2025/06/16/national-rural-letter-carriers-association-approves-contract-with-usps/', date: '2025-06-16', note: 'published' },
  'usc-201': { label: '39 U.S.C. § 201, United States Postal Service (U.S. Code, GovInfo)', url: 'https://www.govinfo.gov/content/pkg/USCODE-2023-title39/html/USCODE-2023-title39-partI-chap2-sec201.htm', date: '2026-11-17', note: 'read' },
  'nalc-pay': { label: 'National Association of Letter Carriers, City Carrier Wage Schedule effective March 7, 2026 (Table 3: City Carrier Assistant)', url: 'https://www.nalc.org/news/research-and-economics/body/paychart-03-07-26.pdf', date: '2026-03-07', note: 'effective' },
  'nalc-summary': { label: 'National Association of Letter Carriers, Summary of the 2023–2026 NALC-USPS National Agreement', url: 'https://cdn.nalc.org/workplace-issues/body/2023-2026-NALC-USPS-National-Agreement-Summary.pdf', date: '2025-03', note: 'published' },
  'nalc-mediation': { label: 'National Association of Letter Carriers, NALC, USPS head to mediation on new collective-bargaining agreement', url: 'https://nalc.org/news/nalc-updates/nalc-usps-head-to-mediation-on-new-collective-bargaining-agreement', date: '2026-05-22', note: 'published' },
  'el902': { label: 'Handbook EL-902, 2024–2027 Agreement between USPS and the National Rural Letter Carriers’ Association (NRLCA)', url: 'https://www.nrlca.org/Documents/WebContent/EditorDocuments/userFiles/File/public/hbk_el902.pdf', date: '2025-10-28', note: 'published' },
  'apwu-rates': { label: 'American Postal Workers Union, rates effective March 7, 2026 (Postal Support Employee hourly rates)', url: 'https://apwu.org/wp-content/uploads/2026/03/APWU-Rates-Effective-March-07-2026_v2.pdf', date: '2026-03-07', note: 'effective' },
  'apwu-summary': { label: 'American Postal Workers Union, Summary of the 2024–2027 Collective Bargaining Agreement', url: 'https://apwu.org/tasummary/', date: '2025-06', note: 'published' },
  'apwu-cola': { label: 'American Postal Workers Union, Third cost-of-living adjustment announced (PSE step increases under the 2024 contract)', url: 'https://apwu.org/news/third-cost-of-living-adjustment-announced/', date: '2026-02-13', note: 'published' },
  'npmhu-wage': { label: 'National Postal Mail Handlers Union, wage chart PP 07-2025 (Mail Handler Assistant hourly rates effective Nov. 16, 2024)', url: 'https://www.npmhu.org/resources/WAGE%20CHART%20TEMPLATE%20PP%2007-2025%20COLA.pdf', date: '2025-03-08', note: 'effective' },
  'npmhu-2022': { label: 'National Postal Mail Handlers Union, 2022 National Agreement ratification booklet (MHA conversion to career)', url: 'https://m.npmhu.org/resources/body/2022-NPMHU-RATIFICATION-BOOKLET.pdf', date: '2022-12-30', note: 'published' },
  'npmhu-arb': { label: 'National Postal Mail Handlers Union, Arbitrator panel selected for interest arbitration', url: 'https://www.npmhu.org/media/news/arbitrator-panel-selected-for-interest-arbitration', date: '2026-10-30', note: 'published' },
  'uspis-scams': { label: 'U.S. Postal Inspection Service, USPS/Government employment scams', url: 'https://www.uspis.gov/news/scam-article/usps-government-employment-scams', date: '2022-01-12', note: 'updated' },
  'ftc-jobscams': { label: 'Federal Trade Commission, Job Scams', url: 'https://consumer.ftc.gov/articles/job-scams', date: '2023-03', note: 'published' },
  // First-hand accounts (r/USPS, read through the Arctic Shift archive). Used only where two or more accounts agree, and
  // rendered as what people say, never as fact.
  'r-1wzkyko': { label: 'r/USPS, "Genuinely considering a career as a city carrier assistant"', url: thread('1wzkyko'), date: '2026-10-07', note: 'thread' },
  'r-1xp4b2w': { label: 'r/USPS, "Just accepted an offer as a CCA in California"', url: thread('1xp4b2w'), date: '2026-11-06', note: 'thread' },
  'r-1xtka1f': { label: 'r/USPS, "Just got my job offer for the CCA position what can I expect?"', url: thread('1xtka1f'), date: '2026-11-11', note: 'thread' },
  'r-1xwifr4': { label: 'r/USPS, "Got the RCA offer but I already have a part-time job"', url: thread('1xwifr4'), date: '2026-11-15', note: 'thread' },
  'r-1xvmwhp': { label: 'r/USPS, "New RCA - Advice and Tips?"', url: thread('1xvmwhp'), date: '2026-11-13', note: 'thread' },
  'r-1x3sut4': { label: 'r/USPS, "Tips for a new rca who doesn’t have a RHD"', url: thread('1x3sut4'), date: '2026-10-12', note: 'thread' },
  'r-1wxfh2u': { label: 'r/USPS, "New rca: what do i need to get in order before I use a pov?"', url: thread('1wxfh2u'), date: '2026-10-04', note: 'thread' },
  'r-1xgxrzc': { label: 'r/USPS, "Received a Job offer with no interview"', url: thread('1xgxrzc'), date: '2026-10-27', note: 'thread' },
  'r-1xt8j3o': { label: 'r/USPS, "Pittsburgh, PA immediate job offer... sketchy?"', url: thread('1xt8j3o'), date: '2026-11-11', note: 'thread' },
  'r-1xx41i6': { label: 'r/USPS, "Passed exam 474- got a 77"', url: thread('1xx41i6'), date: '2026-11-15', note: 'thread' },
  'r-1xplh09': { label: 'r/USPS, "Just scored 96 on the 474 for a position as CCA"', url: thread('1xplh09'), date: '2026-11-06', note: 'thread' },
  'r-1wvae91': { label: 'r/USPS, "Is a 95 a good assessment score when trying to get hired?"', url: thread('1wvae91'), date: '2026-10-01', note: 'thread' },
}

export const guide = {
  path: '/start/usps',
  title: 'Getting hired at the Postal Service',
  crumbLabel: 'Postal Service',
  eyebrow: 'Company guide',
  // The one-sentence answer under the h1 (no figure: the figures live in the tiles).
  answer: { text: 'Most people start at the Postal Service in a non-career job: city carrier assistant, rural carrier associate, assistant rural carrier, mail handler assistant or PSE clerk. You apply on its own careers site, pass a free online assessment and a background check, and the union contracts set the pay and the path to a career job.', src: ['usps-apply', 'usps-topjobs', 'usps-exams', 'nalc-summary', 'el902', 'apwu-summary', 'npmhu-2022'] },
  metaDescription: 'How people get hired at the U.S. Postal Service: the entry jobs (CCA, RCA, ARC, MHA, PSE clerk), where to apply, the Virtual Entry Assessment, age, driving and background rules, pay from the union contracts, and the path to a career job.',
  asOf: '2026-11-17',
}

// The three readings in the hero: each restates a fact below, with the same references.
export const tiles = [
  { label: 'City carrier assistant pay', value: '$21.21/hr', text: 'to start, on the letter carriers’ union pay chart in force since March 7, 2026', src: ['nalc-pay', 'nalc-mediation'] },
  { label: 'Entry exam pass mark', value: '70%', text: 'on the free Virtual Entry Assessment, taken online within 72 hours of the invitation', src: ['usps-vea', 'usps-exams'] },
  { label: 'Non-career to career', value: '24 months', text: 'when city carrier assistants, PSE clerks and mail handler assistants move to career status under their contracts, if not sooner', src: ['nalc-summary', 'apwu-summary', 'npmhu-2022'] },
]

// 1. Where to apply, and the steps USPS describes.
export const apply = {
  what: { text: 'The Postal Service is set up by law as an independent establishment of the executive branch of the federal government, and it runs its own hiring.', src: ['usc-201', 'usps-apply'] },
  site: { text: 'USPS says its city carrier assistant, rural carrier associate, assistant rural carrier, mail handler assistant, PSE clerk and holiday clerk and carrier jobs must be applied for on its new USPS Careers site, jobs.usps.com. Drivers, maintenance, full-time rural carrier, some mail handler and corporate jobs go through its older eCareer system, which needs a separate account.', src: ['usps-apply', 'usps-jobs', 'usps-careers'] },
  when: { text: 'New postings are usually added on Fridays and stay up through Wednesday, so a search on a Thursday may find few or none. Search by ZIP code and a radius.', src: ['usps-apply', 'usps-jobs'] },
  steps: [
    { step: 'Apply on jobs.usps.com', text: 'List your work history back five years, or to your 16th birthday if that is shorter. Being fired from a job does not on its own rule you out; USPS reviews the reasons you give.', src: ['usps-ecareer'] },
    { step: 'Take the assessment if invited', text: 'The invitation comes by email, so check spam; you then have 72 hours. Not everyone who applies is invited.', src: ['usps-exams', 'usps-vea'] },
    { step: 'Accept an offer, then screening', text: 'After you accept, USPS may run a background check, a medical questionnaire and a motor vehicle record check, and a drug test is ordered before hire.', src: ['usps-apply', 'el312'] },
    { step: 'Confirm and pick a start date', text: 'You confirm the job and a start date, then get an email within a few days to finalize it.', src: ['usps-apply'] },
  ],
  veterans: { text: 'Veterans claim preference on the online application and send a DD-214 (Member 4 copy) or other official proof of service and discharge.', src: ['usps-military'] },
  federal: { text: 'For jobs at other federal agencies, Seen has a separate guide.', src: ['usc-201'] },
}

// 2. The entry jobs, in USPS's own words (and the union chart pay where one is published).
export const roles = [
  {
    name: 'City Carrier Assistant', aka: 'CCA · city delivery',
    body: { text: 'Delivers and collects mail on foot or by vehicle in a city area, on weekdays, weekends and holidays, in all weather. USPS says CCAs may be eligible for paid leave and health insurance.', src: ['usps-topjobs'] },
    chips: [{ text: '$21.21/hr to start', src: ['nalc-pay'] }, { text: 'Exam 474', src: ['usps-exams'] }],
  },
  {
    name: 'Rural Carrier Associate', aka: 'RCA · rural and suburban routes',
    body: { text: 'Delivers mail and packages on rural and suburban routes, in your own vehicle if no postal vehicle is provided. USPS promises work at least one day a week and asks you to be available up to six.', src: ['usps-topjobs'] },
    chips: [{ text: 'Exam 474', src: ['usps-exams'] }, { text: 'Vehicle allowance for your own car', src: ['usps-pb-ema'] }],
  },
  {
    name: 'Assistant Rural Carrier', aka: 'ARC · Sundays and holidays',
    body: { text: 'Part-time package delivery on Sundays and holidays, which USPS pitches to people with another job. The rural contract also lets ARCs work Saturdays, or deliver parcels on any day.', src: ['usps-topjobs', 'el902'] },
    chips: [{ text: 'Part-time', src: ['usps-topjobs'] }],
  },
  {
    name: 'Mail Handler Assistant', aka: 'MHA · processing plants',
    body: { text: 'Loads, unloads and moves mail and packages, lifting moderate to heavy loads from trucks and sorting equipment.', src: ['usps-topjobs'] },
    chips: [{ text: '$19.02/hr to start, grade 4', src: ['npmhu-wage'] }, { text: 'Exam 475', src: ['usps-exams'] }],
  },
  {
    name: 'PSE Mail Processing Clerk', aka: 'Postal Support Employee',
    body: { text: 'Sorts mail on automated equipment or by hand, with prolonged standing and some lifting. USPS says benefits may include paid vacation and health insurance.', src: ['usps-topjobs'] },
    chips: [{ text: 'From $20.26/hr, by grade', src: ['apwu-rates'] }, { text: 'Exam 476', src: ['usps-exams'] }],
  },
  {
    name: 'PSE Sales and Services/Distribution Associate', aka: 'Postal Support Employee · the counter',
    body: { text: 'Serves customers at the post office counter, handles sales and returns, and does passport duties.', src: ['usps-topjobs'] },
    chips: [{ text: 'From $20.26/hr, by grade', src: ['apwu-rates'] }, { text: 'Exam 477', src: ['usps-exams'] }],
  },
]
export const rolesMore = [
  { text: 'Holiday clerk and carrier jobs are also applied for on jobs.usps.com. Under the letter carriers’ contract, holiday carrier assistants can work six weeks in the December period, with up to two weeks of training before.', src: ['usps-apply', 'nalc-summary'] },
  { text: 'Some offices hire city carriers straight into career jobs: the letter carriers’ contract notes hundreds of offices moved to all-career hiring, and USPS lists City Carrier separately from CCA on its new site.', src: ['nalc-summary', 'usps-apply'] },
]
export const workforce = [
  { group: 'Rural part-time (rural carrier associates and assistants)', people: '46,870', src: ['usps-ar2025'] },
  { group: 'City carrier assistants', people: '23,921', src: ['usps-ar2025'] },
  { group: 'Postal support employees', people: '15,030', src: ['usps-ar2025'] },
  { group: 'Mail handler assistants', people: '5,522', src: ['usps-ar2025'] },
  { group: 'All pre-career employees', people: '93,231', src: ['usps-ar2025'] },
  { group: 'All career employees', people: '531,261', src: ['usps-ar2025'] },
]
export const workforceNote = { text: 'Headcount on September 30, 2025, from USPS’s annual report to Congress. Pre-career headcount fell 12% in the year; USPS says it has been converting pre-career employees to career status.', src: ['usps-ar2025'] }

// 3. The Virtual Entry Assessment.
export const exam = {
  intro: { text: 'Most entry jobs require the Virtual Entry Assessment (VEA), taken online on a computer, tablet or phone. It takes about 30–45 minutes, it is free, and USPS says you do not need to study for it.', src: ['usps-exams', 'usps-vea'] },
  rows: [
    { job: 'City Carrier Assistant, Rural Carrier Associate (and career city and rural carrier)', exam: 'Exam 474, Mail Carriers', src: ['usps-exams'] },
    { job: 'Mail Handler Assistant (and mail handler)', exam: 'Exam 475, Mail Handlers', src: ['usps-exams'] },
    { job: 'PSE Mail Processing Clerk (and mail processing clerk)', exam: 'Exam 476, Mail Processing', src: ['usps-exams'] },
    { job: 'PSE Sales and Services/Distribution Associate', exam: 'Exam 477, Customer Service', src: ['usps-exams'] },
  ],
  note: { text: 'The exam list does not name the Assistant Rural Carrier job; a posting that needs an exam lists it under “Examination Requirements.”', src: ['usps-exams'] },
  parts: [
    { name: 'A job preview', text: 'What the work is like, the daily tasks and the hard parts. The only unscored part.', src: ['usps-vea'] },
    { name: 'Work situations', text: 'For each situation, pick what you are most likely and least likely to do.', src: ['usps-vea'] },
    { name: 'Checking for accuracy', text: 'Whether customer information on screen matches USPS records.', src: ['usps-vea'] },
    { name: 'Motivation, story and work style', text: 'Choices between statements, and questions on your work history; with no work history, use school, sports or other activities.', src: ['usps-vea'] },
  ],
  rules: { text: 'You need at least 70% to pass. Fail, and you cannot retake that version for 12 months, but you can take a different version at once by applying to a job in another group. A missed 72-hour deadline counts as ineligible for that posting.', src: ['usps-vea', 'usps-exams'] },
  drivers: { text: 'Driving jobs such as motor vehicle operator and tractor trailer operator use a different exam: a self-reported driving history.', src: ['usps-exams'] },
}

// 4. What USPS requires.
export const needs = {
  items: [
    { name: 'Age', text: '18 at appointment, or 16 with a high school diploma. Nobody under 18 may be put in a job that means driving a motor vehicle. There is no maximum age.', src: ['usps-apply', 'el312'] },
    { name: 'Citizenship or residence', text: 'A U.S. citizen, a permanent resident, or a citizen of American Samoa or another U.S. territory.', src: ['usps-apply'] },
    { name: 'Two years of driving, for driving jobs', text: 'At least 2 years of documented, unsupervised driving experience, continuous and right before you apply, in the United States or its territories.', src: ['el312'] },
    { name: 'A safe driving record', text: 'USPS pulls a state driving record for driving jobs. A disqualifying record rules you out of driving jobs only.', src: ['usps-apply', 'el312'] },
    { name: 'A background check', text: 'A criminal check covering 10 years, using U.S. records only. If you have not lived in the U.S. or its territories for the past 5 years, it may not be complete and you may be ineligible.', src: ['usps-apply'] },
    { name: 'A drug test', text: 'A urine test before hire. USPS applies federal law on illegal drug use even where a state allows it.', src: ['el312'] },
    { name: 'A medical assessment', text: 'Part of the screening after an offer.', src: ['usps-apply'] },
    { name: 'Selective Service', text: 'Registration, where it applies to you.', src: ['usps-apply'] },
  ],
  fairChance: { text: 'Under the Fair Chance Act, USPS may not ask about criminal history before it makes a conditional job offer.', src: ['usps-fairchance'] },
  drivingRows: [
    { factor: 'License suspended', window: 'once in 3 years, or twice in 5', src: ['el312'] },
    { factor: 'License revoked', window: 'once in 5 years', src: ['el312'] },
    { factor: 'Reckless or careless driving', window: '1 in 3 years, or 2 in 5', src: ['el312'] },
    { factor: 'Any drug or alcohol driving conviction', window: 'any in 5 years', src: ['el312'] },
    { factor: 'Other traffic offenses (not parking)', window: '3 in 3 years (or more than 1 in the last 12 months), or 5 in 5', src: ['el312'] },
    { factor: 'At-fault accidents', window: '2 in 5 years, or any with a death', src: ['el312'] },
    { factor: 'Hit-and-run', window: 'any in 5 years', src: ['el312'] },
  ],
  drivingNote: { text: 'Only traffic offenses that ended in a conviction count, dated by the violation itself. A pending ticket makes you ineligible for a driving job until it is resolved.', src: ['el312'] },
}

// 5. Pay, only from the union contracts and pay charts.
export const payIntro = { text: 'Pay for these jobs is set by four union contracts, not by each post office. These are the latest hourly rates each union publishes; the rate on the posting is the one that counts.', src: ['nalc-pay', 'el902', 'apwu-rates', 'npmhu-wage'] }
export const payRows = [
  { role: 'City Carrier Assistant', union: 'Letter carriers (NALC)', pay: '$21.21 to start, $21.71 after 52 weeks', asOf: 'Chart effective March 7, 2026', src: ['nalc-pay'] },
  { role: 'Career city carrier, part-time flexible', union: 'Letter carriers (NALC)', pay: '$26.36 at the first step', asOf: 'Chart effective March 7, 2026', src: ['nalc-pay', 'nalc-summary'] },
  { role: 'PSE clerk (both jobs)', union: 'Postal workers (APWU)', pay: '$20.26–$23.13 by grade; $0.50 more after 26 weeks', asOf: 'Chart effective March 7, 2026', src: ['apwu-rates', 'apwu-summary', 'apwu-cola'] },
  { role: 'Mail Handler Assistant', union: 'Mail handlers (NPMHU)', pay: '$19.02 (grade 4) or $20.01 (grade 5); $0.50 more after 26 weeks', asOf: 'Rates effective November 16, 2024', src: ['npmhu-wage'] },
  { role: 'Rural Carrier Associate, Assistant Rural Carrier', union: 'Rural carriers (NRLCA)', pay: 'Contract Table Four, shown on each posting; a step $1.00 higher after 156 weeks', asOf: 'Contract through May 20, 2027', src: ['el902', 'usps-nrlca-news'] },
]
export const payNotes = [
  { text: 'The postal workers’ and rural carriers’ contracts both added a raise on November 14, 2026 (2.5% for PSEs, 1.5% plus 1.0% for RCAs and ARCs), so current PSE rates are higher than the chart above, and rural rates rose too.', src: ['apwu-summary', 'el902'] },
  { text: 'The letter carriers’ contract expired May 22, 2026 and stays in force until a new one is agreed or decided by arbitration. In late October 2026 the mail handlers’ union said its new contract was going to interest arbitration.', src: ['nalc-mediation', 'npmhu-arb'] },
  { text: 'Rural carriers who use their own vehicle also get an equipment maintenance allowance by the mile or the hour, set in the Postal Bulletin.', src: ['usps-pb-ema'] },
  { text: 'A CCA paid at the carrier technician rate gets 2.1% more.', src: ['nalc-pay'] },
]
export const benefits = [
  { text: 'Health insurance for non-career carriers: USPS pays 75% of the premium for CCAs, and 75% on its non-career health plan for non-career rural carriers.', src: ['nalc-summary', 'el902'] },
  { text: 'Career employees get health insurance with most of the cost paid by USPS, a pension, the Thrift Savings Plan with up to 5% of pay in automatic and matching contributions, 13 days of annual leave a year for the first 3 years, and 11 holidays.', src: ['usps-benefits'] },
]

// 6. From non-career to career, as each contract describes it.
export const careerPath = [
  { name: 'City Carrier Assistant', aka: 'Letter carriers’ contract', body: { text: 'A CCA is converted to a career part-time flexible carrier on reaching 24 months of relative standing, and can be converted sooner as full-time openings are filled.', src: ['nalc-summary'] }, chips: [{ text: '$26.36/hr once career', src: ['nalc-pay'] }] },
  { name: 'PSE clerk', aka: 'Postal workers’ contract', body: { text: 'PSEs are converted to career status automatically after two years, except PSEs in four-hour remotely managed post offices, and a PSE converted during a first term no longer serves a second probation period.', src: ['apwu-summary'] }, chips: [] },
  { name: 'Mail Handler Assistant', aka: 'Mail handlers’ contract', body: { text: 'Under the 2022 contract, an MHA who reaches 24 months is converted to a career full-time flexible mail handler, with full health care and retirement, on a slightly lower rate for up to 48 weeks.', src: ['npmhu-2022'] }, chips: [] },
  { name: 'Rural Carrier Associate', aka: 'Rural carriers’ contract', body: { text: 'No automatic conversion. A vacant regular route goes, after regular and other carriers, usually to the RCA in that office with the longest service and at least a year as an RCA; open part-time flexible jobs go, after any substitutes, to the longest-serving RCA past probation.', src: ['el902'] }, chips: [] },
]
export const careerNote = { text: 'New city carriers work limited hours and places for their first eight weeks after the carrier academy, and from the ninth week get at least one scheduled day off each week.', src: ['nalc-summary'] }

// 7. What the work is like (first-hand, several accounts agreeing), and scams.
export const peopleSay = [
  { text: 'City carrier assistants describe long days, often 10 to 12 hours and six days a week, Sundays included, with the first months before the holidays the hardest.', src: ['r-1wzkyko', 'r-1xp4b2w', 'r-1xtka1f'], firstHand: true },
  { text: 'Carriers say every office is different, including how long it takes to make regular.', src: ['r-1xp4b2w', 'r-1wzkyko'], firstHand: true },
  { text: 'Rural carrier associates say hours swing from almost none to 60 a week and change at short notice, which makes a second job hard to keep.', src: ['r-1xwifr4', 'r-1xvmwhp'], firstHand: true },
  { text: 'Rural carrier associates using their own car describe fitting it to drive from the right side, with a pedal kit, a steering knob or stick, or a reach tool.', src: ['r-1x3sut4', 'r-1wxfh2u', 'r-1xvmwhp'], firstHand: true },
  { text: 'People hired as carriers say there was no interview: a conditional offer came by email, sometimes within days of applying.', src: ['r-1xgxrzc', 'r-1xt8j3o', 'r-1xx41i6'], firstHand: true },
  { text: 'Applicants say a passing score is ranked against everyone who applied to the same posting, so a high score can mean an offer in days and a lower one months of reapplying.', src: ['r-1xx41i6', 'r-1xplh09', 'r-1wvae91'], firstHand: true },
]
export const scams = [
  { text: 'USPS never charges a fee to apply for a job or to take a postal exam. The Postal Inspection Service warns against websites that offer to help you apply or charge to get you a job.', src: ['uspis-scams', 'usps-exams'] },
  { text: 'Paid exam prep is not needed: USPS says you do not need to study for the Virtual Entry Assessment.', src: ['usps-vea'] },
  { text: 'The FTC: “Never respond to an ad that promises jobs with the federal government or postal service.” Information about postal job openings is free to everyone.', src: ['ftc-jobscams'] },
  { text: 'Apply only through USPS’s own careers pages, and report a fee-charging site to the Postal Inspection Service.', src: ['uspis-scams', 'usps-exams'] },
]

// FAQ — visible on the page and mirrored in FAQPage JSON-LD.
export const faq = [
  {
    q: 'Do I apply for Postal Service jobs on USAJOBS?',
    a: { text: 'Not for the entry jobs. USPS says city carrier assistant, rural carrier associate, assistant rural carrier, mail handler assistant and PSE clerk jobs must be applied for on its own USPS Careers site, jobs.usps.com. Its other jobs, such as drivers, maintenance and corporate jobs, go through its older eCareer system.', src: ['usps-apply'] },
  },
  {
    q: 'How much does a city carrier assistant make?',
    a: { text: '$21.21 an hour to start and $21.71 after 52 weeks, on the letter carriers’ union pay chart in force since March 7, 2026. A CCA paid at the carrier technician rate gets 2.1% more.', src: ['nalc-pay'] },
  },
  {
    q: 'What is on the postal exam, and do I need to study?',
    a: { text: 'The Virtual Entry Assessment asks how you would handle work situations, checks accuracy, and asks about your work history and work style. USPS says you do not need to study for it, it is free, and you need at least 70% to pass.', src: ['usps-vea', 'usps-exams'] },
  },
  {
    q: 'How old do I have to be to work for the Postal Service?',
    a: { text: '18 at appointment, or 16 with a high school diploma. Carrier and other driving jobs also need 2 years of continuous, unsupervised driving experience, and nobody under 18 may be put in a job that means driving.', src: ['usps-apply', 'el312'] },
  },
  {
    q: 'Do I have to be a U.S. citizen?',
    a: { text: 'No. USPS hires citizens and permanent residents of the United States, and citizens of American Samoa or another territory. Its background check uses only United States records, so someone who has not lived in the country or its territories for the past 5 years may be ineligible.', src: ['usps-apply'] },
  },
  {
    q: 'How does a city carrier assistant become a career carrier?',
    a: { text: 'Under the letter carriers’ contract, a CCA is converted to a career part-time flexible carrier on reaching 24 months of relative standing, or sooner as full-time openings are filled. That contract stays in force while a new one is settled.', src: ['nalc-summary', 'nalc-mediation'] },
  },
]

// ── Listings: none. Seen holds no USPS rows (2026-11-17, read-only: company ilike *postal* / *usps*, and titles ilike
// *carrier assistant* / *mail carrier* / *rural carrier* / *mail handler* / *postal* all returned 0), and USPS's own job
// site answers servers with a challenge, so the template shows no "Hiring now" block; the "Where to apply" row sends
// people to jobs.usps.com.
export const listings = null

// ── The page's openable rows (components/start/Guide.tsx `Blocks` renders each block type) ─────────────────────────
export const menu = [
  {
    id: 'apply', title: 'Where to apply', summary: 'USPS’s own job site, and when to look',
    blocks: [
      { type: 'text', entry: apply.what },
      { type: 'cards', items: [{ name: 'USPS Careers', aka: 'Search by ZIP code', link: JOBS, body: apply.site }] },
      { type: 'text', entry: apply.when },
      { type: 'steps', items: apply.steps },
      { type: 'text', entry: apply.veterans },
      { type: 'cards', items: [{ name: 'Federal government jobs', aka: 'Seen guide', link: 'https://seenjobs.io/start/federal', body: apply.federal }] },
    ],
  },
  {
    id: 'jobs', title: 'The entry jobs', summary: 'Carrier, clerk and mail handler jobs',
    blocks: [
      { type: 'cards', items: roles },
      { type: 'more', title: 'Holiday jobs, career hiring and headcount', blocks: [
        { type: 'notes', items: rolesMore },
        { type: 'table', caption: 'USPS pre-career and career employees', columns: [{ key: 'group', label: 'Group' }, { key: 'people', label: 'Employees', num: true }], rows: workforce },
        { type: 'note', entry: workforceNote },
      ] },
    ],
  },
  {
    id: 'exam', title: 'The entry exam', summary: 'Which exam, the time limit, the pass mark',
    blocks: [
      { type: 'text', entry: exam.intro },
      { type: 'table', caption: 'Virtual Entry Assessment by job', columns: [{ key: 'job', label: 'Job' }, { key: 'exam', label: 'Exam' }], rows: exam.rows },
      { type: 'note', entry: exam.note },
      { type: 'checklist', items: exam.parts, cols: true },
      { type: 'callout', entry: exam.rules },
      { type: 'text', entry: exam.drivers },
    ],
  },
  {
    id: 'requirements', title: 'What USPS requires', summary: 'Age, citizenship, driving, checks',
    blocks: [
      { type: 'checklist', items: needs.items, cols: true },
      { type: 'text', entry: needs.fairChance },
      { type: 'more', title: 'Driving records that rule you out of driving jobs', blocks: [
        { type: 'table', caption: 'Driving history that disqualifies an applicant for a driving job', columns: [{ key: 'factor', label: 'What', }, { key: 'window', label: 'How many, how recent' }], rows: needs.drivingRows },
        { type: 'note', entry: needs.drivingNote },
      ] },
    ],
  },
  {
    id: 'pay', title: 'Pay from the union contracts', summary: 'Hourly rates by job, with their dates',
    blocks: [
      { type: 'text', entry: payIntro },
      { type: 'table', caption: 'Hourly pay for entry jobs on the union charts', columns: [{ key: 'role', label: 'Job' }, { key: 'union', label: 'Union' }, { key: 'pay', label: 'Hourly pay', num: true }, { key: 'asOf', label: 'As of' }], rows: payRows },
      { type: 'notes', items: payNotes },
      { type: 'more', title: 'Benefits', blocks: [{ type: 'notes', items: benefits }] },
    ],
  },
  {
    id: 'career', title: 'From non-career to career', summary: 'How each job becomes a career job',
    blocks: [
      { type: 'cards', items: careerPath },
      { type: 'note', entry: careerNote },
      { type: 'resumeLink', before: 'Before you apply, you can', label: 'check your résumé against a posting' },
    ],
  },
  {
    id: 'watch-out', title: 'What the work is like', icon: 'caution', summary: 'Hours, your own car, offers, scams',
    blocks: [
      { type: 'text', plain: 'What people who were hired say. More than one account agrees on each of these.' },
      { type: 'notes', items: peopleSay },
      { type: 'notes', label: 'Scams', items: scams, icon: 'x', caution: true },
    ],
  },
  { id: 'questions', title: 'Common questions', summary: 'USAJOBS, pay, the exam, age, citizenship', blocks: [{ type: 'faq', items: faq }] },
]

// ── Additional resources: every reference above, as plain grouped links (no numbers, closed by default) ────────────
export const resourcesSummary = 'USPS careers, union contracts, records'
export const resources = [
  { title: 'USPS careers', items: [
    { key: 'usps-jobs', name: 'USPS Careers job search' },
    { key: 'usps-careers', name: 'USPS careers overview' },
    { key: 'usps-topjobs', name: 'The entry jobs, described by USPS' },
    { key: 'usps-apply', name: 'How to apply, and the employment requirements' },
    { key: 'usps-ecareer', name: 'Help with the eCareer application' },
    { key: 'usps-exams', name: 'USPS exams and retests' },
    { key: 'usps-vea', name: 'Virtual Entry Assessment candidate guide' },
    { key: 'usps-military', name: 'Veterans’ preference at USPS' },
    { key: 'usps-benefits', name: 'Benefits for career employees' },
    { key: 'usps-fairchance', name: 'The Fair Chance Act at USPS' },
  ] },
  { title: 'Union contracts and pay charts', items: [
    { key: 'nalc-pay', name: 'Letter carriers’ pay chart, March 2026 (NALC)' },
    { key: 'nalc-summary', name: 'Letter carriers’ contract summary (NALC)' },
    { key: 'nalc-mediation', name: 'Letter carriers’ contract goes to mediation (NALC)' },
    { key: 'el902', name: 'Rural carriers’ contract, 2024–2027 (NRLCA)' },
    { key: 'apwu-rates', name: 'Postal workers’ pay chart, March 2026 (APWU)' },
    { key: 'apwu-summary', name: 'Postal workers’ contract summary (APWU)' },
    { key: 'apwu-cola', name: 'PSE step increases under the 2024 contract (APWU)' },
    { key: 'npmhu-wage', name: 'Mail handlers’ pay chart (NPMHU)' },
    { key: 'npmhu-2022', name: 'Mail handler assistant conversion to career (NPMHU)' },
    { key: 'npmhu-arb', name: 'Mail handlers’ contract goes to arbitration (NPMHU)' },
  ] },
  { title: 'USPS rules and records', items: [
    { key: 'el312', name: 'Handbook EL-312, Employment and Placement' },
    { key: 'usps-ar2025', name: 'USPS annual report to Congress, 2025' },
    { key: 'usps-pb-ema', name: 'Rural vehicle allowance (Postal Bulletin)' },
    { key: 'usps-nrlca-news', name: 'Rural carriers approve their contract (USPS)' },
    { key: 'usc-201', name: 'The law that sets up the Postal Service' },
  ] },
  { title: 'Job scams', items: [
    { key: 'uspis-scams', name: 'Employment scams (U.S. Postal Inspection Service)' },
    { key: 'ftc-jobscams', name: 'Job scams (Federal Trade Commission)' },
  ] },
  { title: 'Community discussions', items: [
    { key: 'r-1wzkyko', name: 'Thinking about becoming a city carrier assistant' },
    { key: 'r-1xp4b2w', name: 'Just accepted a CCA offer' },
    { key: 'r-1xtka1f', name: 'What to expect as a new CCA' },
    { key: 'r-1xwifr4', name: 'An RCA job beside a part-time job' },
    { key: 'r-1xvmwhp', name: 'Advice for a new RCA' },
    { key: 'r-1x3sut4', name: 'A new RCA without a right-hand-drive car' },
    { key: 'r-1wxfh2u', name: 'Using your own car as an RCA' },
    { key: 'r-1xgxrzc', name: 'A job offer with no interview' },
    { key: 'r-1xt8j3o', name: 'An offer straight after applying' },
    { key: 'r-1xx41i6', name: 'Passing the carrier exam with a lower score' },
    { key: 'r-1xplh09', name: 'A high score on the carrier exam' },
    { key: 'r-1wvae91', name: 'A mail handler assessment score' },
  ] },
]

/** Every fact on the page, in reading order: the hero, then each menu row. */
export function pageEntries() {
  return [guide.answer, ...tiles, ...blockEntries(menu)]
}
