// /start/security — "Getting into security guard work". The page renders from this module only, so every figure on it
// carries a reference and an as-of date (lib/start/guides.test.mjs fails on a figure without one).
//
// THE ONLY SOURCE OF FACTS is the research file compiled 2026-11-17 (session scratchpad guides20/security/research.md).
// Rules this module keeps:
//   • only items the research marked VERIFIED (BLS / O*NET, a state licensing agency's own page or the state's statute,
//     an employer's own posting or careers page, the FTC); pay is BLS May 2025;
//   • FIRST-HAND items (several accounts agreeing) only as `firstHand: true`, said as what people say, never as fact;
//   • nothing from the research's UNVERIFIED list: no ranking of states by guard jobs (not read), no Texas Level II hours
//     or Texas fees, no Florida Class D fee or term, no Florida Class G minimum age, no Illinois 20-hour timing or yearly
//     hours (the statute site was down), no G4S, no GardaWorld terms, no injury rate (BLS gives none for guards), no pay
//     figure from a single discussion;
//   • the candid parts stay: guard companies employ most guards and pay less than hospitals and schools; armed work does
//     not always pay more in the postings read; most guards pay nothing to be hired, and a school's job-placement promise
//     is not a job.
//
// Shape: `sources` (every reference behind the page, never printed as citations — readers reach the links through the
// grouped "Additional resources" row), entries `{ text, src, firstHand? }`, the listings filter config (`listings`,
// lib/start/listingFilters.js) and the openable menu rows (`menu`, rendered by components/start/Guide.tsx).

import { blockEntries } from './entries.js'

/** @typedef {{ label: string, url: string, date: string, note?: string }} Source */

/** @type {Record<string, Source>} */
export const sources = {
  'bls-ooh': { label: 'U.S. Bureau of Labor Statistics, Occupational Outlook Handbook: Security Guards and Gambling Surveillance Officers (May 2025 pay)', url: 'https://www.bls.gov/ooh/protective-service/security-guards.htm', date: '2026-08-27', note: 'page updated' },
  'onet-guard': { label: 'O*NET OnLine, Security Guards (33-9032.00): wages and employment (BLS 2025 wage data)', url: 'https://www.onetonline.org/link/summary/33-9032.00', date: '2026-11-17', note: 'read' },
  'onet-sup': { label: 'O*NET OnLine, First-Line Supervisors of Security Workers (33-1091.00): wages and employment (BLS 2025 wage data)', url: 'https://www.onetonline.org/link/summary/33-1091.00', date: '2026-11-17', note: 'read' },
  'ca-guard': { label: 'California Bureau of Security and Investigative Services (BSIS), Security Guard registration fact sheet', url: 'https://bsis.ca.gov/forms_pubs/guard_fact.shtml', date: '2022-01', note: 'revised' },
  'ca-app': { label: 'California BSIS, Security Guard registration application and instructions (Power to Arrest and Appropriate Use of Force; required training)', url: 'https://bsis.ca.gov/forms_pubs/gappnew.pdf', date: '2025-12', note: 'revised' },
  'ca-fees': { label: 'California BSIS, licensing fees (new fees from October 1, 2025)', url: 'https://www.bsis.ca.gov/forms_pubs/newfees.pdf', date: '2025-09', note: 'published' },
  'ca-fire': { label: 'California BSIS, Firearms Permit fact sheet', url: 'https://www.bsis.ca.gov/forms_pubs/fire_fact.pdf', date: '2025-01', note: 'revised' },
  'tx-training': { label: 'Texas Department of Public Safety, Private Security: training and continuing education (Level II, III and IV)', url: 'https://www.dps.texas.gov/section/private-security/training-and-continuing-education', date: '2026-11-17', note: 'read' },
  'tx-law': { label: 'Texas DPS, Texas Private Security Statutes and Rules, 2023–2024 edition (Occupations Code ch. 1702; 37 TAC ch. 35)', url: 'https://www.dps.texas.gov/sites/default/files/documents/rsd/psb/docs/psStatutesAndRules2024.pdf', date: '2026-11-17', note: 'read' },
  'tx-faq': { label: 'Texas DPS, Private Security: individual license questions', url: 'https://www.dps.texas.gov/section/private-security/faq/individual-license-questions', date: '2026-11-17', note: 'read' },
  'fl-d': { label: 'Florida Department of Agriculture and Consumer Services, Class D Security Officer License requirements', url: 'https://www.fdacs.gov/Business-Services/Private-Security-Licenses/Class-D-Security-Officer-License-Requirements', date: '2026-11-17', note: 'read' },
  'fl-6105': { label: 'Florida Statutes § 493.6105, initial application for license (Class D work on a complete application; Class G training)', url: 'https://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0400-0499/0493/Sections/0493.6105.html', date: '2026-11-17', note: 'read' },
  'fl-6115': { label: 'Florida Statutes § 493.6115, weapons and firearms', url: 'https://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0400-0499/0493/Sections/0493.6115.html', date: '2026-11-17', note: 'read' },
  'fl-6113': { label: 'Florida Statutes § 493.6113, renewal (Class G firearms requalification)', url: 'https://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0400-0499/0493/Sections/0493.6113.html', date: '2026-11-17', note: 'read' },
  'ny-become': { label: 'New York Department of State, Become a Security Guard (requirements and fees)', url: 'https://dos.ny.gov/become-security-guard', date: '2026-11-17', note: 'read' },
  'ny-training': { label: 'New York Department of State, Security Guard Training Requirements', url: 'https://dos.ny.gov/security-guard-training-requirements', date: '2026-11-17', note: 'read' },
  'ny-dcjs': { label: 'New York Division of Criminal Justice Services, Security Guard Training (approved schools, fees, job-placement promises)', url: 'https://criminaljustice.ny.gov/security-guard-training', date: '2026-11-17', note: 'read' },
  'il-perc': { label: 'Illinois Department of Financial and Professional Regulation, Permanent Employee Registration Card (PERC) application checklist', url: 'https://idfpr.illinois.gov/content/dam/soi/en/web/idfpr/forms/online/Permanent%20Employee%20Registration%20Card%20(PERC).pdf', date: '2026-11-17', note: 'read' },
  'il-fcc': { label: 'Illinois IDFPR, Qualifications for licensure: Firearm Control Card (FCC)', url: 'https://idfpr.illinois.gov/content/dam/soi/en/web/idfpr/core/dpr/229-qualifications-for-licensure.pdf', date: '2026-09', note: 'effective' },
  'aus-noexp': { label: 'Allied Universal careers, No Experience? How Allied Universal trains security officers', url: 'https://jobs.aus.com/no-experience-security-officer-training', date: '2026-11-17', note: 'read' },
  'aus-ruther': { label: 'Allied Universal posting 2026-1751676, Security Officer, entry level, part time weekends, Ruther Glen, VA (own careers site)', url: 'https://jobs.aus.com/job/ruther-glen/security-officer-entry-level-distribution-center-part-time-weekends/22950/103428422768', date: '2026-11-17', note: 'posted' },
  'aus-crozier': { label: 'Allied Universal posting 2026-1751572, Armed Security Officer, part time mornings, Crozier, VA (own careers site)', url: 'https://jobs.aus.com/job/crozier/armed-security-officer-part-time-mornings/22950/103428422784', date: '2026-11-17', note: 'posted' },
  'aus-dallas': { label: 'Allied Universal posting 2026-1751879, Security Shift Supervisor, unarmed, Dallas, TX (own careers site)', url: 'https://jobs.aus.com/job/dallas/security-shift-supervisor-unarmed-corporate-building/22950/103428422736', date: '2026-11-17', note: 'posted' },
  'sec-careers': { label: 'Securitas USA careers, security officer requirements', url: 'https://www.securitasinc.com/join-us/training-and-development/security-officer-training/', date: '2026-11-17', note: 'read' },
  'sec-secureu': { label: 'Securitas USA press release, SecureU education benefit with Guild', url: 'https://www.securitasinc.com/news-insights/press/securitas-guild/', date: '2026-05-18', note: 'published' },
  'sec-tucson': { label: 'Securitas posting 176536, Unarmed Security Officer, Tucson, AZ (own careers site)', url: 'https://ekaw.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/176536', date: '2026-11-17', note: 'posted' },
  'sec-covina': { label: 'Securitas posting 170134, Unarmed Security Officer, West Covina area, CA (own careers site)', url: 'https://ekaw.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/170134', date: '2026-05-01', note: 'posted' },
  'sec-chicago': { label: 'Securitas posting 176736, Mobile Security Officer, Chicago, IL (own careers site)', url: 'https://ekaw.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/176736', date: '2026-11-17', note: 'posted' },
  'mk-armed': { label: 'Marksman Security posting 4472782009, Armed Security Officer, Deerfield Beach, FL (own job board)', url: 'https://job-boards.greenhouse.io/marksman/jobs/4472782009', date: '2026-11-13', note: 'updated' },
  'mk-plano': { label: 'Marksman Security posting 4479084009, Retail Security Officer, Plano, TX (own job board)', url: 'https://job-boards.greenhouse.io/marksman/jobs/4479084009', date: '2026-11-13', note: 'updated' },
  'mk-slc': { label: 'Marksman Security posting 4030415009, Retail Unarmed Security Officer, Salt Lake City, UT (own job board)', url: 'https://job-boards.greenhouse.io/marksman/jobs/4030415009', date: '2026-11-13', note: 'updated' },
  'target-ap': { label: 'Target posting R0000477369, Assets Protection Specialist, Wesley Chapel, FL (own careers site)', url: 'https://corporate.target.com/jobs/w73/69/assets-protection-specialist', date: '2026-11-17', note: 'read' },
  'ftc-scams': { label: 'Federal Trade Commission, Job Scams (consumer advice)', url: 'https://consumer.ftc.gov/articles/job-scams', date: '2023-03', note: 'article dated' },
  // First-hand accounts (Reddit threads read through the Arctic Shift archive on 2026-11-17). Used only where several
  // accounts agree, and rendered as what people say, never as fact.
  'r-inhouse1': { label: 'r/securityguards, in-house security jobs: duties, requirements and pay', url: 'https://www.reddit.com/r/securityguards/comments/1r3oiqn/', date: '2026-11-17', note: 'thread read' },
  'r-inhouse2': { label: 'r/securityguards, how to move from a guard company to in-house security', url: 'https://www.reddit.com/r/securityguards/comments/1vmufhl/', date: '2026-11-17', note: 'thread read' },
  'r-inhouse3': { label: 'r/securityguards, finding in-house security jobs', url: 'https://www.reddit.com/r/securityguards/comments/1o90f94/', date: '2026-11-17', note: 'thread read' },
  'r-inhouse4': { label: 'r/securityguards, in-house salaries compared with contract work', url: 'https://www.reddit.com/r/securityguards/comments/1ma9ftt/', date: '2026-11-17', note: 'thread read' },
  'r-observe1': { label: 'r/securityguards, jobs that ask for more than observe and report', url: 'https://www.reddit.com/r/securityguards/comments/1oxvjka/', date: '2026-11-17', note: 'thread read' },
  'r-observe2': { label: 'r/securityguards, observe and report, and when a post expects more', url: 'https://www.reddit.com/r/securityguards/comments/1nxw2fr/', date: '2026-11-17', note: 'thread read' },
  'r-night1': { label: 'r/securityguards, tips for a first overnight security job', url: 'https://www.reddit.com/r/securityguards/comments/1wuxp56/', date: '2026-11-17', note: 'thread read' },
  'r-night2': { label: 'r/securityguards, nervous before a first overnight shift', url: 'https://www.reddit.com/r/securityguards/comments/1ubukh2/', date: '2026-11-17', note: 'thread read' },
  'r-night3': { label: 'r/securityguards, starting an overnight job at a guard company', url: 'https://www.reddit.com/r/securityguards/comments/1u9m6gf/', date: '2026-11-17', note: 'thread read' },
}

export const guide = {
  path: '/start/security',
  title: 'Getting into security guard work',
  crumbLabel: 'Security work',
  eyebrow: 'Guide',
  // The one-sentence answer under the h1 (the page's first screen).
  answer: { text: 'Many guard jobs take people without experience, and most guards learn the job in a few weeks, but most states require a state guard license, and carrying a gun usually takes a second license with stricter checks. Here is what five large states ask, what the work pays, and who is hiring now.', src: ['bls-ooh', 'aus-noexp'] },
  metaDescription: 'How to become a security guard: unarmed and armed jobs, guard cards and licenses in California, Texas, Florida, New York and Illinois, what guards are paid, who trains new guards, live security listings near you, and scams to avoid.',
  asOf: '2026-11-17',
}

// The three readings in the hero: each restates a fact below, with the same references.
export const tiles = [
  { label: 'Median pay', value: '$18.28/hr', text: 'for security guards, May 2025: $38,020 a year; the lowest tenth earned under $30,210, the top tenth over $58,840', src: ['onet-guard', 'bls-ooh'] },
  { label: 'California guard card', value: '40 hours, $60', text: '8 hours of training before the card is issued and 32 within six months, plus the state application fee; you also pay the fingerprint fees', src: ['ca-app', 'ca-guard', 'ca-fees'] },
  { label: 'Guard firms vs healthcare', value: '$37,350 vs $44,920', text: 'median a year for guards at guard companies (investigation, guard and armored car services), where 58% of guards work, against healthcare and social assistance, May 2025', src: ['bls-ooh'] },
]

// 1. The jobs: a name, one line, and the figures as chips.
export const jobs = [
  {
    role: 'Unarmed security officer', aka: 'Also security guard, site officer, access control',
    what: { text: 'Patrols a site, controls who comes in and reports what happens. Most guards learn the job in a few weeks; a high school diploma is the usual ask, and some jobs do not require one.', src: ['bls-ooh', 'onet-guard'] },
    chips: [
      { text: '$18.28/hr median, all guards', src: ['onet-guard'] },
      { text: 'Allied Universal, Ruther Glen, VA: $19.00/hr', src: ['aus-ruther'] },
      { text: 'Securitas, Tucson, AZ: $16.00–$17.00/hr', src: ['sec-tucson'] },
    ],
  },
  {
    role: 'Armed security officer', aka: 'Also armed guard; commissioned officer in Texas',
    what: { text: 'Carries a firearm on duty. It usually takes a separate state firearm license, weapons training and stricter background checks, armed guards may be tested on the range from time to time, and the armed postings read ask for age 21.', src: ['bls-ooh', 'aus-crozier', 'mk-armed'] },
    chips: [
      { text: 'Allied Universal, Crozier, VA: $18.00/hr', src: ['aus-crozier'] },
      { text: 'Marksman, Deerfield Beach, FL: $19.25/hr', src: ['mk-armed'] },
    ],
  },
  {
    role: 'Mobile patrol officer', aka: 'Also patrol driver, rover',
    what: { text: 'Patrols buildings and parking lots on foot and in a company vehicle. Some jobs ask for a valid driver’s license; the Securitas patrol job in Chicago also asks for a clear driving record and two years of security experience.', src: ['bls-ooh', 'sec-chicago'] },
    chips: [{ text: 'Securitas, Chicago: $18.00–$18.70/hr', src: ['sec-chicago'] }],
  },
  {
    role: 'Loss prevention', aka: 'Target calls it assets protection',
    what: { text: 'Works for a store to stop theft and fraud: watches video, documents incidents and works with police. Target’s posting says its specialists "apprehend subjects in accordance with company policy."', src: ['target-ap'] },
    chips: [{ text: 'Target, Wesley Chapel, FL: starts $21.25–$23.25/hr', src: ['target-ap'] }],
  },
  {
    role: 'Event security', aka: 'Also venue, arena and concert security',
    what: { text: 'Works games, concerts and other events at venues. BLS notes that seasonal guard work may be available during the holidays and the warmer summer months in some states.', src: ['bls-ooh'] },
    chips: [],
  },
  {
    role: 'Security supervisor', aka: 'Also shift supervisor, site supervisor',
    what: { text: 'Runs a shift: Allied Universal’s Dallas posting has its shift supervisor supervise, coach and discipline the officers on the shift and write reports and logs.', src: ['aus-dallas'] },
    chips: [
      { text: '$26.90/hr median, security supervisors', src: ['onet-sup'] },
      { text: 'Allied Universal shift supervisor, Dallas: $22.00/hr', src: ['aus-dallas'] },
    ],
  },
]

// 2. Licenses: what five large states ask (each from the state agency's own page or the state's statute).
export const licenseCallout = { text: 'Most states require security guards to be licensed by the state they work in, and guards who carry weapons usually need a second license. The names, hours and fees differ from state to state, so check your own state’s licensing agency before you pay for any course.', src: ['bls-ooh'] }
export const states = [
  {
    lead: 'California: a guard card from BSIS',
    text: 'Be 18, pass an FBI and state background check through Live Scan fingerprinting (you pay the fingerprint fees) and finish 8 hours of training before you apply: 3 hours of Power to Arrest and 5 of Appropriate Use of Force, with a state exam. Another 32 hours are due within six months of getting the card, 16 of them within 30 days, then 8 hours every year. The application fee is $60. To carry a gun you need a separate firearms permit: age 21, U.S. citizenship or permanent legal status, an assessment of judgment, restraint and self-control, a firearms course with a written test and range qualification, and a $110 fee; it lasts two years, with four range requalifications.',
    src: ['ca-app', 'ca-guard', 'ca-fees', 'ca-fire'],
  },
  {
    lead: 'Texas: Level II and Level III from DPS',
    text: 'Unarmed guards hold a non-commissioned security officer license and must pass the state’s Level II course and test, which a licensed guard company may teach itself. Armed guards need a security officer commission: at least 18, the Level III course (at least 45 hours, with a shooting test), a personality test (the MMPI) and Level II. New licenses last two years; commissioned officers take 6 hours of continuing education to renew, and unarmed officers are exempt.',
    src: ['tx-training', 'tx-law', 'tx-faq'],
  },
  {
    lead: 'Florida: Class D, and Class G to carry',
    text: 'A Class D license takes age 18, the right to work in the U.S. and at least 40 hours of training at a licensed school. Once you file a complete application, you may start work for a licensed agency; if the state denies it, that job ends. To carry a gun you also need a Class G license: 28 hours of range and classroom training, no more than 20 of them online and 8 in person on a range, and 4 hours of requalification every year.',
    src: ['fl-d', 'fl-6105', 'fl-6115', 'fl-6113'],
  },
  {
    lead: 'New York: registration from the Department of State',
    text: 'Be 18, take an 8-hour pre-assignment course at a state-approved school before you apply, and pay $36 plus a $102.50 fingerprint fee. Within 90 days of starting work you take 16 hours of on-the-job training, then 8 hours every year. Armed guards need a New York pistol license first, then a 47-hour firearms course and 8 hours of firearms training every year.',
    src: ['ny-become', 'ny-training', 'ny-dcjs'],
  },
  {
    lead: 'Illinois: a PERC card from IDFPR',
    text: 'Unarmed guards need a Permanent Employee Registration Card (PERC): age 18, a fingerprint background check and a $55 fee; the cards expire every three years. To carry a gun your employer applies for a Firearm Control Card for you: you need the PERC first, a FOID card (Illinois’ Firearm Owner’s Identification card) and a 48-hour firearms course, and a separate card for each agency you work for.',
    src: ['il-perc', 'il-fcc'],
  },
]
export const recommended = { text: 'BLS says many states recommend about 8 hours of training before your first post, 8 to 16 hours on the job and 8 hours a year after that.', src: ['bls-ooh'] }
export const approvedSchools = { text: 'Train only where your state allows it. California accepts training from a licensed guard company or a state-certified school; in New York, only a school approved by the state criminal justice agency may teach the required courses.', src: ['ca-guard', 'ny-dcjs'] }

// 3. Pay.
export const payMedians = { text: 'Security guards earned a median of $18.28 an hour ($38,020 a year) in May 2025. The lowest tenth earned under $30,210 a year and the top tenth over $58,840.', src: ['onet-guard', 'bls-ooh'] }
export const postedPay = [
  { employer: 'Allied Universal, Ruther Glen, VA', role: 'Security officer, weekend nights, part time', pay: '$19.00/hr', src: ['aus-ruther'] },
  { employer: 'Allied Universal, Crozier, VA', role: 'Armed officer, part time', pay: '$18.00/hr', src: ['aus-crozier'] },
  { employer: 'Allied Universal, Dallas, TX', role: 'Shift supervisor, unarmed, nights', pay: '$22.00/hr', src: ['aus-dallas'] },
  { employer: 'Securitas, Tucson, AZ', role: 'Unarmed officer, full time', pay: '$16.00–$17.00/hr', src: ['sec-tucson'] },
  { employer: 'Securitas, Chicago, IL', role: 'Mobile patrol officer, full time', pay: '$18.00–$18.70/hr', src: ['sec-chicago'] },
  { employer: 'Marksman, Plano, TX', role: 'Retail security officer', pay: 'From $18.00/hr', src: ['mk-plano'] },
  { employer: 'Marksman, Deerfield Beach, FL', role: 'Armed officer, overnight', pay: '$19.25/hr', src: ['mk-armed'] },
  { employer: 'Target, Wesley Chapel, FL', role: 'Assets protection specialist', pay: 'Starts $21.25–$23.25/hr', src: ['target-ap'] },
]
export const postedPayIntro = { text: 'Pay stated on employers’ own postings, read in November 2026. A posting is one site’s rate on that date, not what every location pays.', src: ['aus-ruther', 'sec-tucson', 'mk-plano', 'target-ap'] }
export const paysMore = [
  { name: 'Hospitals and schools', text: 'Guards in healthcare and social assistance earned a median of $44,920 a year and in schools and colleges $44,250, against $37,350 at guard and patrol companies, which employ 58% of guards.', src: ['bls-ooh'] },
  { name: 'Supervising', text: 'First-line supervisors of security workers earned a median of $26.90 an hour in May 2025.', src: ['onet-sup'] },
  { name: 'Store loss prevention', text: 'Target’s assets protection posting starts at $21.25 to $23.25 an hour, with a full range up to $36.15.', src: ['target-ap'] },
]
export const armedNote = { text: 'Armed work does not always pay more. In two Allied Universal postings in Virginia read on the same day, a part-time armed job paid $18.00 an hour and an unarmed weekend night job $19.00.', src: ['aus-crozier', 'aus-ruther'] }

// 4. Getting hired.
export const hireSteps = [
  { step: 'Read your state’s rules first', text: 'Find out what card your state asks for and whether you need training before you can work. In Florida you may start for a licensed agency once you file a complete Class D application; in California the 8 hours of Power to Arrest and use-of-force training come before the card.', src: ['fl-6105', 'ca-app'] },
  { step: 'Apply to a company that trains', text: 'Allied Universal’s careers site says many security officer roles are entry-level and "designed for candidates without prior experience." A Securitas posting in California says no experience is necessary and "we will provide you with the training," and Securitas postings list paid training. Some Marksman postings say "State training and licensing assistance may be available for qualified candidates."', src: ['aus-noexp', 'sec-covina', 'sec-tucson', 'sec-chicago', 'mk-slc'] },
  { step: 'Expect checks', text: 'Expect a background check and, in many jobs, a drug test, which BLS says may also come randomly once you work there. Securitas asks for 18 or older, a high school diploma or GED, and the ability to speak, read and write English.', src: ['bls-ooh', 'aus-noexp', 'sec-careers'] },
  { step: 'Learn the site', text: 'Training goes on after you are hired: Allied Universal says "additional site specific training continues after placement," and employer training usually covers emergency procedures, crime prevention and communication.', src: ['aus-noexp', 'bls-ooh'] },
]
export const inHouse = { text: 'Guards say in-house jobs, where a hospital, college, casino, hotel or other organization hires its own guards, are posted on that organization’s own careers page, not a guard company’s. Most who compared say they paid better than contract work, and many say they ask for prior security, police or military experience.', src: ['r-inhouse1', 'r-inhouse2', 'r-inhouse3', 'r-inhouse4'], firstHand: true }
export const school = { text: 'Securitas announced SecureU in May 2026, an education benefit it says is designed to give employees, including frontline officers, tuition-free education.', src: ['sec-secureu'] }

// 5. Moving up.
export const movingUp = [
  { name: 'Armed', text: 'A second license, age 21 in the postings read, and sometimes experience: Marksman’s Deerfield Beach armed job asks for three years of armed experience and your own firearm, belt and holster. Some employers provide the certification: a Securitas patrol job in Chicago that asks for two years of experience lists armed certification as "provided."', src: ['mk-armed', 'sec-chicago', 'aus-crozier'] },
  { name: 'Supervisor', text: 'Shift and site supervisors earned a median of $26.90 an hour in May 2025; an Allied Universal night shift supervisor job in Dallas pays $22.00.', src: ['onet-sup', 'aus-dallas'] },
  { name: 'Loss prevention', text: 'Stores hire their own; Target’s posting asks for 18 or older and a diploma, and says it trains you.', src: ['target-ap'] },
  { name: 'In-house security', text: 'Healthcare and schools pay guards more than guard companies do, by the BLS medians.', src: ['bls-ooh'] },
]

// 6. The work itself.
export const work = [
  { name: 'Shifts and nights', text: 'Guards usually work shifts of about 8 hours on rotating schedules, and "night shifts are common." Most work full time.', src: ['bls-ooh'] },
  { name: 'Weekends and holidays', text: 'Allied Universal’s Ruther Glen job runs Saturday and Sunday, 11 p.m. to 7 a.m.; Target’s assets protection job lists nights, weekends and holidays.', src: ['aus-ruther', 'target-ap'] },
  { name: 'On your feet', text: 'Target’s posting asks you to stay mobile for the whole shift and lift up to 40 pounds.', src: ['target-ap'] },
  { name: 'Reports and people', text: 'Employer training typically covers emergency procedures, crime prevention and communication; BLS says training may also include report writing, first aid and public relations.', src: ['bls-ooh'] },
]
export const handsOn = { text: 'How hands-on a post is depends on the site. Guards describe many contract posts as observe and report, while hospital officers describe restraining patients; the common advice is to do what your contract and post orders (the written instructions for your site) say.', src: ['r-observe1', 'r-observe2'], firstHand: true }
export const nights = { text: 'Overnight guards say the hard part is staying awake and keeping a sleep schedule, not the post itself; trainers stress staying awake, and the usual advice is a fixed sleep time, food and water, and getting up to walk.', src: ['r-night1', 'r-night2', 'r-night3'], firstHand: true }

// 7. Watch out.
export const scams = [
  { text: 'Never pay to be hired. The FTC: "Honest employers, including the federal government, will never ask you to pay to get a job," and if a placement firm asks for a fee, "especially one you have to pay in advance — walk away."', src: ['ftc-scams'] },
  { text: 'A school’s promise of a job is not a job. New York’s criminal justice agency tells guards to thoroughly scrutinize any promise of job placement by a training school before signing a contract or paying, and notes that schools set their own course fees.', src: ['ny-dcjs'] },
  { text: 'Check that a training school is approved by your state before you pay for a course.', src: ['ny-dcjs', 'ca-guard'] },
  { text: 'The FTC also warns that an offer that has you deposit a check and then use some of the money, for any reason, is a scam.', src: ['ftc-scams'] },
  { text: 'Read what you must bring: some armed jobs require your own firearm, duty belt and holster.', src: ['mk-armed'] },
]

// FAQ — visible on the page and mirrored in FAQPage JSON-LD (only Q&As shown on the page).
export const faq = [
  {
    q: 'Do I need a license to be a security guard?',
    a: { text: 'In most states, yes: BLS says most states require guards to be licensed by the state they work in. It goes by different names, such as a guard card in California, a Class D license in Florida or a PERC card in Illinois. Carrying a gun usually takes a second license.', src: ['bls-ooh', 'ca-guard', 'fl-d', 'il-perc'] },
  },
  {
    q: 'How long does it take to get a guard card?',
    a: { text: 'It depends on the state. California needs 8 hours before you apply and 32 more within six months of getting the card; Florida needs 40 hours before you apply, but you may start work once your complete application is filed. New York needs an 8-hour course before you apply and 16 hours within 90 days of starting.', src: ['ca-app', 'fl-d', 'fl-6105', 'ny-training'] },
  },
  {
    q: 'Can I become a security guard with no experience?',
    a: { text: 'Usually, yes. BLS says most guards learn the job in a few weeks, and Allied Universal says many of its officer jobs are designed for people without prior experience. Some armed and patrol jobs do ask for experience: two to three years in the postings read.', src: ['bls-ooh', 'aus-noexp', 'mk-armed', 'sec-chicago'] },
  },
  {
    q: 'How old do you have to be?',
    a: { text: 'Usually 18 for unarmed work: California, Florida, New York and Illinois all set 18. California’s firearms permit requires 21, and the armed postings read ask for 21.', src: ['ca-guard', 'fl-d', 'ny-become', 'il-perc', 'ca-fire', 'aus-crozier', 'mk-armed'] },
  },
  {
    q: 'Does armed security pay more?',
    a: { text: 'Not always. In two Allied Universal postings in Virginia read the same day, a part-time armed job paid $18.00 an hour and an unarmed weekend night job $19.00. Ask the employer for the rate in writing before you pay for firearms training.', src: ['aus-crozier', 'aus-ruther'] },
  },
  {
    q: 'Who pays for guard card training?',
    a: { text: 'It varies. Securitas postings list paid training and some Marksman postings say training and licensing help may be available; in California you pay the fingerprint fees and the $60 application fee. Never pay a company to hire you.', src: ['sec-tucson', 'mk-slc', 'ca-guard', 'ca-fees', 'ftc-scams'] },
  },
]

// ── Listings: the filters on the "Hiring now" block (lib/start/listingFilters.js) ──────────────────────────────────
// A plain "Security Officer" or "Security Guard" IS the entry job (trained in a few weeks), so the level reads
// 'entryUnlessMarked': a title is experienced only when it says lead / supervisor / II / III / licensed, or the
// listing's own level says senior. Every row must carry a guard word in its title (gateTitle). Measured on Seen's own
// rows 2026-11-17 (read-only): "security officer" 387 active rows, "security guard" 82, "armed" 107 (most say
// "Unarmed"), "patrol" 39, "unarmed" 72, "security supervisor" 13, event security 13, "loss prevention" 9. The look-alikes
// in those rows — information-systems security officers (ISSO, CISO), facility security officers (a clearance office
// job), data loss prevention, a "Patrol to Power" internship, guard-card instructors, directors and managers — are
// dropped by `exclude`. "Unarmed" contains "armed", so the armed pattern needs a non-letter, non-hyphen before "armed"
// (and "commissioned" the same, so "Non-commissioned" is not armed). The unarmed chip takes titles that say unarmed, or
// that START with "security officer / guard" (after a few schedule words), so "Armed Security Officer" stays out.
const SEC_TITLE = '\\b(security|guards?|patrol|un-?armed|armed|loss prevention|assets? protection|protection officer|executive protection|public safety)\\b'
export const listings = {
  defaultRadius: '25',
  radii: ['10', '25', '50', '100'],
  levelMode: 'entryUnlessMarked',
  levelLabels: { any: 'Any level', entry: 'Entry / no experience', experienced: 'Experienced / lead' },
  levelWords: { entry: 'entry-level', experienced: 'experienced' },
  gateTitle: SEC_TITLE,
  exclude: '\\b(information|cyber\\w*|network|isso|ciso|it security|information security|data loss|^facility security officer|fso|chief|director|head of|vice president|managers?|engineer\\w*|developer|software|analyst|architect|consultant|compliance|sales|recruit\\w*|onboarding|instructors?|trainers?|attorney|nurse|coast guard|national guard|crossing guard|lifeguard|internship|skillbridge|social security|personnel security)\\b',
  positions: [
    {
      id: 'all', label: 'All security jobs', noun: 'security', mix: 'positions',
      queries: ['security officer', 'security guard', 'unarmed security officer', 'armed security officer', 'mobile patrol officer', 'loss prevention officer', 'event security', 'security supervisor'],
      seeAll: 'security officer',
    },
    {
      id: 'unarmed', label: 'Unarmed officer', noun: 'unarmed security officer',
      queries: ['unarmed security officer', 'security officer', 'security guard'],
      match: '\\bun-?armed\\b|^\\W*(?:(?:part[- ]time|full[- ]time|flex|overnight|weekend|entry[- ]level|retail|lobby|campus|hotel|residential|concierge|gate|professional|bilingual|customer[- ]focused|service[- ]focused|graveyard|high[- ]rise|hospital|school|site|standing|premier|senior|oilfield)\\s+)*security (?:officers?|guards?)\\b|/\\s*security guard\\b',
    },
    {
      id: 'armed', label: 'Armed officer', noun: 'armed security officer',
      queries: ['armed security officer', 'armed security guard', 'commissioned security officer'],
      match: '(?:^|[^a-z-])armed\\b|(?:^|[^a-z-])commissioned\\b|level iii|class g\\b',
    },
    {
      id: 'patrol', label: 'Mobile patrol', noun: 'patrol security',
      queries: ['mobile patrol officer', 'patrol security officer', 'security patrol driver'],
      match: '\\bpatrol|\\brover\\b',
    },
    {
      id: 'supervisor', label: 'Supervisor', noun: 'security supervisor',
      queries: ['security supervisor', 'security shift supervisor', 'site supervisor security'],
      match: '\\bsupervisor|\\bshift lead\\b|\\bsite lead\\b|\\blieutenant\\b|\\bsergeant\\b|post commander',
    },
    {
      id: 'loss', label: 'Loss prevention', noun: 'loss prevention',
      queries: ['loss prevention officer', 'assets protection specialist', 'loss prevention specialist'],
      match: '\\bloss prevention\\b|\\bassets? protection\\b',
    },
    {
      id: 'event', label: 'Event security', noun: 'event security',
      queries: ['event security', 'event security guard', 'venue security'],
      match: '\\bevent security|\\bevents? (?:security|staff|guards?)\\b|\\(events\\)|event shift|\\barena\\b|\\bstadium\\b|\\bvenue\\b|\\btheat(?:re|er)\\b|\\bconcert|\\bcrowd',
    },
  ],
}

// ── The page's openable rows (components/start/Guide.tsx `Blocks` renders each block type) ──────────────────────────
export const menu = [
  {
    id: 'the-jobs', title: 'The jobs', summary: 'Six security jobs, and what each pays',
    blocks: [
      { type: 'cards', items: jobs.map((j) => ({ name: j.role, aka: j.aka, body: j.what, chips: j.chips })) },
    ],
  },
  {
    id: 'licenses', title: 'Guard cards and licenses', summary: 'What five large states ask before you work',
    blocks: [
      { type: 'callout', entry: licenseCallout },
      { type: 'disclosures', items: states },
      { type: 'text', entry: recommended },
      { type: 'note', entry: approvedSchools },
    ],
  },
  {
    id: 'what-it-pays', title: 'What it pays', summary: 'Medians, posted pay, and what pays more',
    blocks: [
      { type: 'text', entry: payMedians },
      { type: 'text', entry: postedPayIntro },
      { type: 'table', caption: 'Pay stated on employers’ own security postings', columns: [{ key: 'employer', label: 'Employer' }, { key: 'role', label: 'Job' }, { key: 'pay', label: 'Stated pay', num: true }], rows: postedPay },
      { type: 'heading', text: 'Where guards earn more' },
      { type: 'checklist', items: paysMore, cols: true },
      { type: 'callout', entry: armedNote },
    ],
  },
  {
    id: 'getting-hired', title: 'How people get hired', summary: 'Who trains you, and what they check',
    blocks: [
      { type: 'steps', items: hireSteps },
      { type: 'text', entry: inHouse, lead: 'From guards:' },
      { type: 'text', entry: school },
      { type: 'resumeLink', before: 'Before you apply, you can', label: 'check your résumé against a posting' },
    ],
  },
  {
    id: 'moving-up', title: 'Moving up', summary: 'Armed, supervisor, loss prevention, in-house',
    blocks: [
      { type: 'checklist', items: movingUp, cols: true },
    ],
  },
  {
    id: 'the-work', title: 'What the work is like', summary: 'Shifts, nights, how hands-on it gets',
    blocks: [
      { type: 'checklist', items: work, cols: true },
      { type: 'text', entry: handsOn, lead: 'From guards:' },
      { type: 'text', entry: nights, lead: 'From overnight guards:' },
    ],
  },
  {
    id: 'watch-out', title: 'Watch out', icon: 'caution', summary: 'Paying to be hired, schools, your own gear',
    blocks: [
      { type: 'notes', label: 'Before you pay anyone', items: scams, icon: 'x', caution: true },
    ],
  },
  { id: 'questions', title: 'Common questions', summary: 'Licenses, time, experience, age, pay', blocks: [{ type: 'faq', items: faq }] },
]

// ── Additional resources: every reference above, as plain grouped links (no numbers, closed by default) ────────────
export const resourcesSummary = 'State licensing agencies, employers, pay data'
export const resources = [
  { title: 'State licensing agencies', items: [
    { key: 'ca-guard', name: 'California guard card (BSIS)' },
    { key: 'ca-app', name: 'California guard card application and training (BSIS)' },
    { key: 'ca-fees', name: 'California license fees (BSIS)' },
    { key: 'ca-fire', name: 'California firearms permit (BSIS)' },
    { key: 'tx-training', name: 'Texas Level II, III and IV training (DPS)' },
    { key: 'tx-law', name: 'Texas private security law and rules (DPS)' },
    { key: 'tx-faq', name: 'Texas individual license questions (DPS)' },
    { key: 'fl-d', name: 'Florida Class D security officer license (FDACS)' },
    { key: 'fl-6105', name: 'Florida law: applying for a license' },
    { key: 'fl-6115', name: 'Florida law: firearms and the Class G license' },
    { key: 'fl-6113', name: 'Florida law: renewal and firearms requalification' },
    { key: 'ny-become', name: 'Become a security guard in New York (Department of State)' },
    { key: 'ny-training', name: 'New York security guard training requirements' },
    { key: 'ny-dcjs', name: 'New York approved training schools (DCJS)' },
    { key: 'il-perc', name: 'Illinois PERC card application (IDFPR)' },
    { key: 'il-fcc', name: 'Illinois Firearm Control Card (IDFPR)' },
  ] },
  { title: 'Employers’ pages and postings', items: [
    { key: 'aus-noexp', name: 'Allied Universal: starting without experience' },
    { key: 'aus-ruther', name: 'Allied Universal: security officer, Ruther Glen, VA' },
    { key: 'aus-crozier', name: 'Allied Universal: armed officer, Crozier, VA' },
    { key: 'aus-dallas', name: 'Allied Universal: shift supervisor, Dallas, TX' },
    { key: 'sec-careers', name: 'Securitas: officer requirements' },
    { key: 'sec-secureu', name: 'Securitas: SecureU education benefit' },
    { key: 'sec-tucson', name: 'Securitas: unarmed officer, Tucson, AZ' },
    { key: 'sec-covina', name: 'Securitas: unarmed officer, West Covina, CA' },
    { key: 'sec-chicago', name: 'Securitas: mobile patrol officer, Chicago, IL' },
    { key: 'mk-armed', name: 'Marksman: armed officer, Deerfield Beach, FL' },
    { key: 'mk-plano', name: 'Marksman: retail security officer, Plano, TX' },
    { key: 'mk-slc', name: 'Marksman: retail security officer, Salt Lake City, UT' },
    { key: 'target-ap', name: 'Target: assets protection specialist, Wesley Chapel, FL' },
  ] },
  { title: 'Pay and jobs data', items: [
    { key: 'bls-ooh', name: 'Security guards (Bureau of Labor Statistics)' },
    { key: 'onet-guard', name: 'Security guards: wages (O*NET)' },
    { key: 'onet-sup', name: 'Security supervisors: wages (O*NET)' },
  ] },
  { title: 'Job scams', items: [
    { key: 'ftc-scams', name: 'Job scams (Federal Trade Commission)' },
  ] },
  { title: 'Community discussions', items: [
    { key: 'r-inhouse1', name: 'In-house security jobs: duties and pay' },
    { key: 'r-inhouse2', name: 'Moving from a guard company to in-house' },
    { key: 'r-inhouse3', name: 'Finding in-house security jobs' },
    { key: 'r-inhouse4', name: 'In-house salaries and contract pay' },
    { key: 'r-observe1', name: 'Jobs that ask for more than observe and report' },
    { key: 'r-observe2', name: 'Observe and report, and when a post expects more' },
    { key: 'r-night1', name: 'Tips for a first overnight job' },
    { key: 'r-night2', name: 'Before a first overnight shift' },
    { key: 'r-night3', name: 'Starting an overnight job at a guard company' },
  ] },
]

/** Every fact on the page, in reading order: the hero, then each menu row. */
export function pageEntries() {
  return [guide.answer, ...tiles, ...blockEntries(menu)]
}
