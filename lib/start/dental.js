// /start/dental — "Getting into dental work without a degree". The page renders from this module only, so every
// figure on it carries a reference and an as-of date (lib/start/guides.test.mjs fails on a figure without one).
//
// THE ONLY SOURCE OF FACTS is the research file compiled 2026-11-17 (session scratchpad guides20/dental/research.md).
// Rules this module keeps:
//   • only items the research marked VERIFIED (BLS / O*NET May 2025 pay, DANB's own 2026 application packet, state
//     dental boards and codes, OSHA, CODA, the FTC, the employer's own posting); projections are 2025–35;
//   • FIRST-HAND items (two or more threads agreeing) only as `firstHand: true`, rendered as what people say;
//   • nothing from the research's UNVERIFIED list: no California 2-hour law course or day windows, no Washington minors
//     rule or fees, no "Florida does not recognise DANB", no CDT years of experience, no BLS pay figure for dental
//     sterilization (BLS publishes none), no programme dates that go stale;
//   • scope: dental assistant, sterilization tech, front office, dental lab tech; expanded functions as the experienced
//     step; hygienist named plainly as a degree job. The healthcare guide covers CNA / medical assistant / phlebotomy.
//
// Shape: `sources` (every reference behind the page, never printed as citations — readers reach the links through the
// grouped "Additional resources" menu, `resources` below), entries `{ text, src, firstHand? }`, the listings filter
// config (`listings`) and the openable menu rows (`menu`).

import { blockEntries } from './entries.js'

/** @typedef {{ label: string, url: string, date: string, note?: string }} Source */

/** @type {Record<string, Source>} */
export const sources = {
  'bls-da': { label: 'U.S. Bureau of Labor Statistics, Occupational Outlook Handbook: Dental Assistants (May 2025 pay)', url: 'https://www.bls.gov/ooh/healthcare/dental-assistants.htm', date: '2026-10-29', note: 'page updated' },
  'onet-da': { label: 'O*NET OnLine, Dental Assistants (31-9091.00), wages (BLS 2025 wage data)', url: 'https://www.onetonline.org/link/localwages/31-9091.00', date: '2026-11-17', note: 'read' },
  'bls-lab': { label: 'BLS Occupational Outlook Handbook: Dental and Ophthalmic Laboratory Technicians and Medical Appliance Technicians (May 2025 pay)', url: 'https://www.bls.gov/ooh/production/dental-and-ophthalmic-laboratory-technicians-and-medical-appliance-technicians.htm', date: '2026-08-27', note: 'page updated' },
  'onet-lab': { label: 'O*NET OnLine, Dental Laboratory Technicians (51-9081.00), wages (BLS 2025 wage data)', url: 'https://www.onetonline.org/link/localwages/51-9081.00', date: '2026-11-17', note: 'read' },
  'bls-recep': { label: 'BLS Occupational Outlook Handbook: Receptionists (May 2025 pay)', url: 'https://www.bls.gov/ooh/office-and-administrative-support/receptionists.htm', date: '2026-10-29', note: 'page updated' },
  'onet-recep': { label: 'O*NET OnLine, Receptionists and Information Clerks (43-4171.00), wages (BLS 2025 wage data)', url: 'https://www.onetonline.org/link/localwages/43-4171.00', date: '2026-11-17', note: 'read' },
  'bls-hyg': { label: 'BLS Occupational Outlook Handbook: Dental Hygienists (May 2025 pay)', url: 'https://www.bls.gov/ooh/healthcare/dental-hygienists.htm', date: '2026-10-29', note: 'page updated' },
  'danb-cda': { label: 'Dental Assisting National Board (DANB), Certified Dental Assistant (CDA) exam and eligibility pathways', url: 'https://www.danb.org/exams/exam/cda-exam', date: '2026-11-17', note: 'read' },
  'danb-packet': { label: 'DANB, CDA 2026 application packet: eligibility, fees and renewal', url: 'https://danbsfprodassets.azureedge.net/assets/docs/default-source/national-application-packets/cda-application-packet.pdf', date: '2026-05-13', note: 'packet updated' },
  'danb-cert': { label: 'DANB, earn dental assistant certification', url: 'https://www.danb.org/certification/earn-dental-assistant-certification', date: '2026-11-17', note: 'read' },
  'tsbde-xray': { label: 'Texas State Board of Dental Examiners, Dental Assistant Radiology Certificate', url: 'https://tsbde.texas.gov/licensing/dental-assistants/registered-dental-assistant-x-ray-certification/', date: '2026-11-17', note: 'read' },
  'dbc-faq': { label: 'Dental Board of California, allowable duties of dental auxiliaries (FAQ)', url: 'https://dbc.ca.gov/consumers/dental_auxiliaries_faqs.shtml', date: '2026-11-17', note: 'read' },
  'dbc-sb1453': { label: 'Dental Board of California, new requirements of SB 1453 (effective January 1, 2025)', url: 'https://www.dbc.ca.gov/formspubs/dap_and_course_prov.pdf', date: '2024-12', note: 'notice issued' },
  'fl-rad': { label: 'Florida Board of Dentistry, dental radiographer certification', url: 'https://floridasdentistry.gov/dental-radiographer/', date: '2026-11-17', note: 'read' },
  'fl-rule': { label: 'Florida Administrative Code rule 64B5-9.011, radiography training for dental assistants (rule page; the text opens as a Word file)', url: 'https://www.flrules.org/gateway/ruleNo.asp?id=64B5-9.011', date: '2025-11-30', note: 'rule effective' },
  'pa-301': { label: '49 Pa. Code § 33.301, definitions: the radiologic procedure examination', url: 'https://www.pacodeandbulletin.gov/Display/pacode?file=/secure/pacode/data/049/chapter33/s33.301.html', date: '2026-11-17', note: 'read' },
  'pa-302': { label: '49 Pa. Code § 33.302, who may perform radiologic procedures', url: 'https://www.pacodeandbulletin.gov/Display/pacode?file=/secure/pacode/data/049/chapter33/s33.302.html', date: '2026-11-17', note: 'read' },
  'pa-efda': { label: 'Pennsylvania State Board of Dentistry, dental assistant (EFDA) licensure snapshot', url: 'https://www.pa.gov/agencies/dos/department-and-offices/bpoa/boards-commissions/dentistry/dental-assistant-licensure-snapshot', date: '2026-11-17', note: 'read' },
  'oh-4715': { label: 'Ohio Revised Code § 4715.53, dental x-ray machine operator certificate', url: 'https://codes.ohio.gov/ohio-revised-code/section-4715.53', date: '2026-11-17', note: 'read' },
  'wa-faq': { label: 'Washington State Department of Health, dental assistant frequently asked questions', url: 'https://doh.wa.gov/licenses-permits-and-certificates/professions-new-renew-or-update/dental-assistant/frequently-asked-questions', date: '2026-11-17', note: 'read' },
  'osha-bbp': { label: 'OSHA, 29 CFR 1910.1030, bloodborne pathogens: hepatitis B vaccination, training and protective equipment', url: 'https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.1030', date: '2026-11-17', note: 'read' },
  'coda-find': { label: 'Commission on Dental Accreditation (CODA), find an accredited program', url: 'https://coda.ada.org/find-a-program', date: '2026-11-17', note: 'read' },
  'coda-about': { label: 'CODA, about the Commission on Dental Accreditation', url: 'https://coda.ada.org/about-coda', date: '2026-11-17', note: 'read' },
  'ftc-voc': { label: 'Federal Trade Commission, choosing a vocational school or certificate program', url: 'https://consumer.ftc.gov/articles/choosing-vocational-school-or-certificate-program', date: '2021-05', note: 'published' },
  'nbc-cdt': { label: 'National Board for Certification in Dental Laboratory Technology, Certified Dental Technician (CDT) application and exams', url: 'https://nbccert.org/certificants/certified-dental-technician/cdt-application.cfm', date: '2026-11-17', note: 'read' },
  'wd-boise': { label: 'Willamette Dental Group, Dental Assistant, Boise, Idaho (posting 5473348008)', url: 'https://job-boards.greenhouse.io/willamettedentalgroup/jobs/5473348008', date: '2026-11-06', note: 'posting updated' },
  'wd-tacoma': { label: 'Willamette Dental Group, Sterilizer, Tacoma, Washington (posting 5453028008)', url: 'https://job-boards.greenhouse.io/willamettedentalgroup/jobs/5453028008', date: '2026-10-16', note: 'posting updated' },
  'wd-recep': { label: 'Willamette Dental Group, Dental Receptionist, Coeur d\'Alene, Idaho (posting 5478446008)', url: 'https://job-boards.greenhouse.io/willamettedentalgroup/jobs/5478446008', date: '2026-11-12', note: 'posting updated' },
  'wd-efda': { label: 'Willamette Dental Group, Expanded Functions Dental Assistant, Portland, Oregon (posting 5460626008)', url: 'https://job-boards.greenhouse.io/willamettedentalgroup/jobs/5460626008', date: '2026-11-04', note: 'posting updated' },
  'd365-entry': { label: 'Dental365, Dental Assistant (Entry Level), Croton-on-Hudson, New York (posting 8182419003)', url: 'https://job-boards.greenhouse.io/dental365/jobs/8182419003', date: '2026-11-03', note: 'posting updated' },
  'd365-fd': { label: 'Dental365, Dental Front Desk Coordinator, Flemington, New Jersey (posting 8078149003)', url: 'https://job-boards.greenhouse.io/dental365/jobs/8078149003', date: '2026-11-16', note: 'posting updated' },
  'urmc': { label: 'University of Rochester Medical Center, Eastman Institute for Oral Health, Dental Assistant Training Program', url: 'https://www.urmc.rochester.edu/dentistry/employment-opportunities/dental-assistant-training-program', date: '2026-11-17', note: 'read' },
  // First-hand accounts (Reddit threads read through the Arctic Shift archive); never presented as fact.
  'r-steril1': { label: 'r/DentalAssistant, "Becoming a sterilization tech"', url: 'https://www.reddit.com/r/DentalAssistant/comments/1lofnh5/becoming_a_sterilization_tech/', date: '2025-06-30', note: 'thread' },
  'r-steril2': { label: 'r/DentalAssistant, "Pay growth for sterilization techs in dental offices?"', url: 'https://www.reddit.com/r/DentalAssistant/comments/1xp5ivh/pay_growth_for_sterilization_techs_in_dental/', date: '2026-11-06', note: 'thread' },
  'r-raise': { label: 'r/DentalAssistant, "How long did you work until you finally got a decent pay raise as an assistant?"', url: 'https://www.reddit.com/r/DentalAssistant/comments/1vc4pe2/90s_millenial_and_gen_z_assistants_how_long_did/', date: '2026-07-31', note: 'thread' },
  'r-paylist': { label: 'r/DentalAssistant, "Dental Assistant Experience & Pay"', url: 'https://www.reddit.com/r/DentalAssistant/comments/1vgfemm/dental_assistant_experience_pay/', date: '2026-08-05', note: 'thread' },
  'r-fdinsure': { label: 'r/DentalAssistant, "New dental front desk hired for scheduling but now doing insurance too"', url: 'https://www.reddit.com/r/DentalAssistant/comments/1t1h5on/new_dental_front_desk_hired_for_scheduling_but/', date: '2026-05-02', note: 'thread' },
  'r-fdangry': { label: 'r/DentalAssistant, "What\'s something patients get angry about that the front desk has no control over?"', url: 'https://www.reddit.com/r/DentalAssistant/comments/1x5qe4x/whats_something_patients_get_angry_about_that_the/', date: '2026-10-14', note: 'thread' },
  'r-left': { label: 'r/DentalAssistant, "Any ex dental assistants who left for better pay at a whole new career?"', url: 'https://www.reddit.com/r/DentalAssistant/comments/1vfps3n/any_ex_dental_assistants_who_left_for_better_pay/', date: '2026-08-04', note: 'thread' },
}

export const guide = {
  path: '/start/dental',
  title: 'Getting into dental work without a degree',
  crumbLabel: 'Dental',
  eyebrow: 'Guide',
  // The one-sentence answer under the h1 (the page's first screen).
  answer: { text: 'Dental offices hire assistants, sterilization techs and front-desk staff without a degree, and some train you on the job. What you may do, taking x-rays above all, is set by your state, so read its rules before you pay for a course.', src: ['bls-da', 'd365-entry', 'wd-tacoma', 'tsbde-xray', 'dbc-faq'] },
  metaDescription: 'How to get into dental work without a degree: dental assistant, sterilization tech, dental receptionist and dental lab tech. State x-ray rules, DANB exams and fees, what each job pays, how to get hired, and live listings near you.',
  asOf: '2026-11-17',
}

// The three readings in the hero: each restates a fact below, with the same references.
export const tiles = [
  { label: 'Dental assistants, median pay', value: '$48,070', text: 'a year, May 2025; the median for all U.S. jobs was $50,980', src: ['bls-da'] },
  { label: 'Openings a year', value: 'About 53,000', text: 'projected for dental assistants, 2025–35', src: ['bls-da'] },
  { label: 'DANB CDA exam, 2026', value: '$450', text: 'for all three parts; the x-ray and infection control parts can be taken alone, with no eligibility rules', src: ['danb-packet'] },
]

// 1. Job by job: one card each, the way in as the body, length and pay as chips.
export const jobs = [
  {
    name: 'Dental assistant',
    text: 'Seats patients, passes instruments, takes impressions and, where the state allows, takes x-rays. Some states require an accredited program and an exam; in others there are no formal education rules, and assistants learn on the job from a dentist, hygienist or experienced assistant.',
    src: ['bls-da', 'wd-boise'],
    chips: [{ text: 'Median $48,070 a year', src: ['bls-da'] }, { text: 'Programs: often about 1 year', src: ['bls-da'] }],
  },
  {
    name: 'Sterilization tech',
    text: 'Cleans, packs and sterilizes instruments, runs weekly spore tests and services handpieces. Willamette Dental\'s Tacoma posting asks for a high school diploma or GED and, in Washington, dental assistant registration at hire.',
    src: ['wd-tacoma', 'wa-faq'],
    chips: [{ text: 'Posted $24–$29 an hour, Tacoma', src: ['wd-tacoma'] }],
  },
  {
    name: 'Front desk / receptionist',
    text: 'Books patients, collects payments and checks insurance. A high school diploma is the usual floor; dental groups often prefer dental-office or customer-service experience.',
    src: ['bls-recep', 'wd-recep', 'd365-fd'],
    chips: [{ text: 'Receptionists, median $38,010', src: ['bls-recep'] }, { text: 'Training: days to a month', src: ['bls-recep'] }],
  },
  {
    name: 'Dental lab tech',
    text: 'Makes crowns, bridges and dentures in a lab, with little patient contact. Most learn on the job, starting with models made from impressions; certification is optional. The BLS projects the job to shrink 6% from 2025 to 2035 as 3D printing and other labor-saving tools spread.',
    src: ['bls-lab'],
    chips: [{ text: 'Median $49,610 a year', src: ['bls-lab'] }],
  },
]
export const jobNote = { text: 'Medians are national, May 2025. The BLS publishes no separate pay figure for dental sterilization techs, so that card shows one employer\'s posted range; dental receptionists are counted with all receptionists.', src: ['bls-recep', 'wd-tacoma'] }

// Hourly pay, from the 10th to the 90th percentile (one tap away).
export const payRows = [
  { job: 'Dental assistant', median: '$23.11', range: '$17.85 to $29.93', src: ['bls-da', 'onet-da'] },
  { job: 'Dental lab technician', median: '$23.85', range: '$17.62 to $36.99', src: ['onet-lab'] },
  { job: 'Receptionist (all fields)', median: '$18.27', range: '$13.83 to $24.01', src: ['bls-recep', 'onet-recep'] },
]
export const payNote = { text: '10% of workers earn the low end or less, and 10% the high end or more, May 2025. Dental assistants in dentists\' offices had a median of $48,000 a year; in government jobs, $55,270. Receptionists in health care and social assistance had a median of $19.00 an hour.', src: ['onet-da', 'bls-da', 'bls-recep'] }

// 2. X-rays and state rules. `name` is what a reader scans, `text` the detail.
export const states = [
  { name: 'Texas', text: 'A Dental Assistant Radiology Certificate from the state board before you position or take x-rays: a diploma or GED, fingerprints, hands-on BLS (online courses are not accepted), a human trafficking prevention course, and a board-approved course and exam, or a current DANB certificate plus the state\'s jurisprudence assessment.', src: ['tsbde-xray'] },
  { name: 'California', text: 'An unlicensed assistant may take x-rays only after passing a Board-approved radiation safety course. Since January 1, 2025, a Board-approved 8-hour infection control course comes first, before any work that could expose you to blood or saliva.', src: ['dbc-faq', 'dbc-sb1453'] },
  { name: 'Florida', text: 'The Board of Dentistry does not license dental assistants. Graduates of a Board-approved dental assisting program may take x-rays; anyone else needs radiographer certification: at least 3 months of continuous on-the-job training under a Florida dentist, then a Board-approved course within 12 months; the application fee is $35.', src: ['fl-rad', 'fl-rule'] },
  { name: 'Pennsylvania', text: 'Pass DANB\'s Radiation Health and Safety exam, the state\'s required x-ray exam; then you may take x-rays with a dentist on the premises.', src: ['pa-301', 'pa-302'] },
  { name: 'Ohio', text: 'A dental x-ray machine operator certificate: certification from DANB (or two other named bodies), or a board-approved or CODA-accredited course with at least 7 hours of x-ray instruction; the application fee is $32.', src: ['oh-4715'] },
  { name: 'Washington', text: 'Every dental assistant needs an active state registration to work, required since July 1, 2008; the law sets no continuing education for assistants.', src: ['wa-faq'] },
]
export const stateRule = { text: 'States typically do not license entry-level dental assistants, but many states require a certificate, registration or license for x-rays or expanded duties. Ask your state\'s dental board what it requires before you pay for any course.', src: ['bls-da'] }

// 3. DANB and other certifications: what each takes, from the issuing body only.
export const certRows = [
  { cert: 'RHS (x-ray safety)', body: 'DANB', takes: 'No eligibility rules; Pennsylvania uses it as its x-ray exam', fee: '$270 alone', src: ['danb-packet', 'pa-301'] },
  { cert: 'ICE (infection control)', body: 'DANB', takes: 'No eligibility rules', fee: '$270 alone; $375 with RHS', src: ['danb-packet'] },
  { cert: 'CDA (certified dental assistant)', body: 'DANB', takes: 'RHS, ICE and the chairside exam (GC) within 5 years. For most newcomers GC needs a CODA-accredited program, or a high school diploma and 3,500 hours of work over 2 to 4 years signed off by a dentist; every route needs hands-on CPR, BLS or ACLS', fee: '$450 for all three; renew yearly', src: ['danb-packet', 'danb-cda'] },
  { cert: 'EFDA (Pennsylvania)', body: 'State board', takes: 'A board-approved program, such as one of at least 200 hours, and a written exam', fee: '$120 to start', src: ['pa-efda'] },
  { cert: 'CDT (lab tech)', body: 'NBC', takes: 'A high school diploma and the board\'s technical prerequisites, then a written, a specialty and a practical exam, all passed within 4 years', fee: '$295, $295 and $685', src: ['nbc-cdt'] },
]
export const certNote = { text: 'DANB says its CDA is recognized or required in many states. Its fees include a $75 application fee that is not refunded, even if you cancel.', src: ['danb-cert', 'danb-packet'] }

// 4. Getting hired: steps, then real postings with the pay each employer states.
export const steps = [
  { step: 'Read your state\'s rules first', text: 'They decide whether you need a course before your first day, and what you need before you take x-rays.', src: ['bls-da', 'tsbde-xray', 'dbc-sb1453'] },
  { step: 'Look for postings that say entry level', text: 'Dental365\'s entry-level floater posting says previous dental assisting experience is a plus but not required, and lists $18 to $22 an hour.', src: ['d365-entry'] },
  { step: 'Consider a paid training program', text: 'The University of Rochester\'s six-month program pays trainees $18 an hour and $20.30 after it, takes people 17 or older with no dental experience, and gives a certificate of completion; it says the program is not licensed.', src: ['urmc'] },
  { step: 'Get hands-on CPR or BLS', text: 'DANB\'s certification paths need it, Texas will not accept an online course, and Willamette Dental lists Basic Life Support on its postings.', src: ['danb-cda', 'tsbde-xray', 'wd-boise'] },
  { step: 'Ask what the office pays for', text: 'Willamette Dental lists tuition reimbursement among its benefits; ask any employer whether it covers exams and courses.', src: ['wd-boise'] },
]
export const postings = [
  { job: 'Dental assistant (entry level)', where: 'Dental365, Croton-on-Hudson, NY', pay: '$18 to $22 an hour', src: ['d365-entry'] },
  { job: 'Dental assistant', where: 'Willamette Dental, Boise, ID', pay: '$22 to $34 an hour', src: ['wd-boise'] },
  { job: 'Sterilizer', where: 'Willamette Dental, Tacoma, WA', pay: '$24 to $29 an hour', src: ['wd-tacoma'] },
  { job: 'Dental receptionist', where: 'Willamette Dental, Coeur d\'Alene, ID', pay: '$20 to $23 an hour', src: ['wd-recep'] },
  { job: 'Front desk coordinator', where: 'Dental365, Flemington, NJ', pay: '$18 to $24 an hour', src: ['d365-fd'] },
  { job: 'Expanded functions assistant', where: 'Willamette Dental, Portland, OR', pay: '$25 to $38 an hour', src: ['wd-efda'] },
]
export const postingsNote = { text: 'Ranges as each employer posted them in autumn 2026; the offer depends on experience. The Coeur d\'Alene posting prefers two years of customer service, and Dental365 is open to health care or customer-service experience.', src: ['wd-boise', 'wd-recep', 'd365-fd'] }

// 5. Safety and the hard parts (OSHA, BLS, postings).
export const safety = [
  { text: 'If your job exposes you to blood, your employer must offer the hepatitis B vaccine at no cost within 10 working days of your first assignment; if you decline, you sign a statement saying so.', src: ['osha-bbp'] },
  { text: 'Bloodborne-pathogen training is free and given during working hours, when you start and at least once a year; protective equipment is free.', src: ['osha-bbp'] },
  { text: 'Assistants wear safety glasses, masks, gowns and gloves, and follow safety steps around x-ray machines.', src: ['bls-da'] },
]
export const hours = [
  { text: 'Most dental assistants work full time, and some work evenings or weekends; about 91% work in dentists\' offices.', src: ['bls-da'] },
  { text: 'Schedules vary by office: Willamette Dental posts 10-hour shifts, and Dental365\'s entry-level posting includes a Saturday.', src: ['wd-boise', 'd365-entry'] },
]
export const payTruth = { text: 'The dental assistant median, $48,070, is below the $50,980 median for all U.S. jobs, and receptionists, at $38,010, are further below it.', src: ['bls-da', 'bls-recep'] }
// What people in these jobs say (first-hand, several accounts each).
export const peopleSay = [
  { text: 'Sterilization is described as the usual beginner job in a dental office, often filled by people with no experience, but with little pay growth unless you move on to assisting, hygiene or office management.', src: ['r-steril1', 'r-steril2'], firstHand: true },
  { text: 'Assistants describe slow raises at one office, and bigger jumps after adding an x-ray or expanded-function certificate or changing offices.', src: ['r-raise', 'r-paylist'], firstHand: true },
  { text: 'Front-desk staff in small offices say they end up doing insurance and billing as well as scheduling, and take the blame when insurance pays less than patients expected.', src: ['r-fdinsure', 'r-fdangry'], firstHand: true },
  { text: 'Some assistants leave over pay, for other health jobs such as sonography or nursing, or for the trades.', src: ['r-left', 'r-raise'], firstHand: true },
]

// 6. Moving up: expanded functions, certification, and the honest line on hygiene.
export const ladder = [
  { name: 'Expanded functions (EFDA)', text: 'A state title with its own training. Pennsylvania asks for a board-approved program and a written exam; California licenses extended-function assistants (RDAEF). Willamette Dental\'s Portland EFDA posting pays $25 to $38 an hour.', src: ['pa-efda', 'dbc-faq', 'wd-efda'] },
  { name: 'DANB certification by work', text: 'No dental school needed: a high school diploma, 3,500 hours of work over 2 to 4 years signed off by a dentist, and hands-on CPR or BLS qualify you for the CDA\'s chairside exam.', src: ['danb-packet'] },
  { name: 'Dental lab: the CDT', text: 'An optional certification for lab techs: three exams from the national board, passed within 4 years.', src: ['nbc-cdt', 'bls-lab'] },
  { name: 'Dental hygienist needs a degree', text: 'Hygienists typically need an associate\'s degree in dental hygiene, programs usually take 3 years, and every state requires a license. The median was $98,100 in May 2025.', src: ['bls-hyg'] },
]

// 7. Watch out. `lead` is the mistake in a few words; `text` the detail.
export const mistakes = [
  { lead: 'A program that is not accredited.', text: 'DANB\'s school route to the CDA needs a CODA-accredited program, and CODA is the one agency the U.S. Department of Education recognizes for dental assisting, hygiene and lab programs. Look the school up on CODA\'s own search before you enroll.', src: ['danb-cda', 'coda-about', 'coda-find'] },
  { lead: 'A course your state does not approve.', text: 'California\'s board can now fine programs that falsely claim its approval, and Texas and Pennsylvania require board-approved courses or programs for x-rays and expanded functions. Check the board\'s list, not the school\'s ad.', src: ['dbc-sb1453', 'tsbde-xray', 'pa-efda'] },
  { lead: 'Paying for school you may not need.', text: 'In some states there are no formal education rules for assistants, DANB\'s x-ray and infection control exams have no eligibility rules, and its work route counts hours on the job.', src: ['bls-da', 'danb-packet'] },
  { lead: 'A school that promises you a job.', text: 'The FTC says no school can promise you a job. Ask how many graduates find jobs in the field and what they start at; recruiters may be paid by the number of students they sign up.', src: ['ftc-voc'] },
  { lead: 'Taking x-rays before you qualify.', text: 'In Texas you must hold the radiology certificate first; in California, pass the radiation safety course first.', src: ['tsbde-xray', 'dbc-faq'] },
]
export const cheaper = { text: 'The FTC notes that community college tuition may be less than at private vocational schools; compare prices before you sign.', src: ['ftc-voc'] }

// FAQ — visible on the page and mirrored in FAQPage JSON-LD.
export const faq = [
  {
    q: 'Do I need to go to school to become a dental assistant?',
    a: { text: 'Not in every state. Some states require an accredited program and an exam, while others have no formal education rules and assistants learn on the job. Check your state\'s dental board first.', src: ['bls-da'] },
  },
  {
    q: 'Can I take dental x-rays without a certificate?',
    a: { text: 'In many states, no. Texas requires a Dental Assistant Radiology Certificate, California a Board-approved radiation safety course, Pennsylvania DANB\'s Radiation Health and Safety exam, and Florida, unless you graduated from a Board-approved program, 3 months of supervised training plus a course.', src: ['tsbde-xray', 'dbc-faq', 'pa-301', 'fl-rad', 'fl-rule'] },
  },
  {
    q: 'How much does DANB certification cost?',
    a: { text: 'In 2026 DANB charges $450 for the full CDA exam, or $270 for the x-ray (RHS) or infection control (ICE) exam alone, including a $75 application fee that is not refunded. For most newcomers the chairside part needs a CODA-accredited program or 3,500 hours of work.', src: ['danb-packet'] },
  },
  {
    q: 'How much do dental assistants make?',
    a: { text: 'The national median was $48,070 a year, or $23.11 an hour, in May 2025. The lowest 10% earned less than $37,130 and the highest 10% more than $62,250.', src: ['bls-da', 'onet-da'] },
  },
  {
    q: 'Can I become a dental hygienist without a degree?',
    a: { text: 'No. Hygienists typically need an associate\'s degree in dental hygiene, programs usually take 3 years, and every state requires a license.', src: ['bls-hyg'] },
  },
  {
    q: 'Do I have to pay for the hepatitis B vaccine?',
    a: { text: 'No. If your job exposes you to blood, your employer must offer it at no cost within 10 working days of your first assignment. You may decline it in writing.', src: ['osha-bbp'] },
  },
]

// ── Listings: the filters on the "Hiring now" block (lib/start/listingFilters.js) ──────────────────────────────────
// Seen's rows (read-only check 2026-11-17): plenty of dental assistant rows (Willamette Dental, 42 North Dental,
// Dental365, Elite Dental Partners, Comprehensive Mobile Care, specialty1…), 8 sterilization rows (mostly oral-surgery
// groups), about 19 dental front-desk / receptionist rows, a handful of EFDA rows, and 1 dental lab row (Catalis Dental
// Lab Partners). A row must say "dental" (or a dental word) in its title, or come from a dental employer, so a hospital
// "Sterilization Technician" or a medical front desk stays out. Look-alikes kept out: hygienists and dentists (licensed,
// degree jobs), "Medical, Dental, and Vision insurance" front-desk ads, field trainers, sales reps, managers, and
// "residental" (an ilike match on HVAC titles). A plain "Dental Assistant" title usually needs state credentials, so
// "Entry level" needs a beginner word (entry, trainee, no experience) or the listing's own entry flag. Patterns avoid
// lookaheads (the wording test reads every string here).
const byLevel = (any, entry, experienced) => {
  const all = (first) => [...new Set([...first, ...any, ...entry, ...experienced])]
  return { any: all(any), entry: all(entry), experienced: all(experienced) }
}
export const listings = {
  defaultRadius: '50',
  radii: ['25', '50', '100', '250'],
  levelMode: 'entryNeedsMarker',
  levelLabels: { any: 'Any level', entry: 'Entry level / will train', experienced: 'Experienced / credentialed' },
  levelWords: { entry: 'entry-level', experienced: 'experienced' },
  gateTitle: '\\bdental|\\befdas?\\b|\\bdenture|\\borthodont\\w*|\\bortho\\b|oral surgery',
  gateCompany: '\\bdental|dentistry|\\bdds\\b|\\bdmd\\b|orthodont\\w*|oral ?surgery|endodont\\w*|periodont\\w*|\\bsmiles?\\b|specialty ?1',
  exclude: '\\b(hygienists?|rdh|dentists?|dds|dmd|orthodontist|oral surgeon|endodontist|periodontist|instructors?|educators?|faculty|professor|trainer|recruiter|sales|account executive|territory|representative|vision|medical office|veterinar\\w*|vet|animal|manager|director|regional|residental)\\b',
  positions: [
    {
      id: 'all', label: 'All jobs', noun: 'dental', mix: 'positions',
      queries: {
        any: ['dental assistant', 'sterilization technician', 'dental receptionist', 'dental front desk', 'dental lab technician', 'expanded function dental assistant'],
        entry: ['dental assistant entry level', 'dental assistant trainee', 'sterilization technician', 'dental receptionist'],
        experienced: ['registered dental assistant', 'expanded function dental assistant', 'certified dental assistant', 'dental lab technician'],
      },
    },
    { id: 'dental-assistant', label: 'Dental assistant', noun: 'dental assistant', match: 'dental assist\\w*|dental asst|chairside|\\brda\\b|\\bcda\\b|ortho(?:dontic)? assistant|surgical assistant|oral surgery assistant', queries: byLevel(['dental assistant'], ['dental assistant entry level', 'dental assistant trainee'], ['registered dental assistant', 'certified dental assistant']) },
    { id: 'sterilization', label: 'Sterilization', noun: 'sterilization', match: 'steriliz\\w*', queries: byLevel(['dental sterilization technician', 'sterilization technician'], ['sterilization technician'], ['sterilization technician']) },
    { id: 'front-office', label: 'Front office', noun: 'dental front office', match: 'recept\\w*|front (?:desk|office)|patient (?:care )?coordinator|treatment coordinator|care advocate|scheduling coordinator|insurance coordinator|office coordinator', queries: byLevel(['dental receptionist', 'dental front desk'], ['dental receptionist'], ['dental front desk', 'dental treatment coordinator']) },
    { id: 'lab-tech', label: 'Lab tech', noun: 'dental lab', match: 'dental (?:lab|laboratory)|dental tech(?:nician)?\\b|ceramist|denture tech\\w*|crown and bridge|\\bcad ?/ ?cam\\b|\\bpmma\\b', queries: byLevel(['dental lab technician', 'dental technician'], ['dental lab technician'], ['dental lab technician', 'ceramist']) },
    { id: 'efda', label: 'Expanded functions', noun: 'expanded-function', match: '\\befdas?\\b|expanded functions?|\\brdaef\\b|\\bcpfda\\b|\\bcrfda\\b', queries: byLevel(['expanded function dental assistant', 'efda'], ['efda'], ['expanded function dental assistant', 'efda']) },
  ],
}

// ── The page's openable rows ──────────────────────────────────────────────────────────────────────────────────────
export const menu = [
  {
    id: 'by-job', title: 'Job by job', summary: 'What each job is, the way in, the pay',
    blocks: [
      { type: 'cards', items: jobs.map((j) => ({ name: j.name, body: j, chips: j.chips })) },
      { type: 'note', entry: jobNote },
      { type: 'more', title: 'Hourly pay, low to high', blocks: [
        { type: 'table', caption: 'Hourly pay for each job, national', columns: [{ key: 'job', label: 'Job' }, { key: 'median', label: 'Median, hourly', num: true }, { key: 'range', label: 'Low to high', num: true }], rows: payRows },
        { type: 'text', entry: payNote },
      ] },
    ],
  },
  {
    id: 'x-rays', title: 'X-rays and state rules', summary: 'What your state asks before you start',
    blocks: [
      { type: 'callout', entry: stateRule },
      { type: 'checklist', items: states, cols: true },
    ],
  },
  {
    id: 'certifications', title: 'DANB and other certificates', summary: 'What each takes and what it costs',
    blocks: [
      { type: 'table', caption: 'Dental certifications: who issues them, what they take, what they cost', columns: [{ key: 'cert', label: 'Certification' }, { key: 'body', label: 'From' }, { key: 'takes', label: 'What it takes' }, { key: 'fee', label: 'Fee' }], rows: certRows },
      { type: 'text', entry: certNote },
    ],
  },
  {
    id: 'getting-hired', title: 'Getting hired', summary: 'Steps, and what employers post',
    blocks: [
      { type: 'steps', items: steps },
      { type: 'heading', text: 'What employers post' },
      { type: 'table', caption: 'Dental postings and the pay each employer states', columns: [{ key: 'job', label: 'Job' }, { key: 'where', label: 'Employer and place' }, { key: 'pay', label: 'Posted pay', num: true }], rows: postings },
      { type: 'note', entry: postingsNote },
      { type: 'resumeLink', before: 'Before you apply, you can', label: 'check your résumé against a posting' },
    ],
  },
  {
    id: 'hard-parts', title: 'Safety and the hard parts', summary: 'Vaccines, protective gear, hours, pay',
    blocks: [
      { type: 'callout', entry: payTruth },
      { type: 'notes', label: 'Safety rules', items: safety },
      { type: 'notes', label: 'Hours', items: hours },
      { type: 'more', title: 'What people in these jobs say', blocks: [
        { type: 'text', plain: 'Several accounts agree on each of these.' },
        { type: 'notes', items: peopleSay },
      ] },
    ],
  },
  {
    id: 'moving-up', title: 'Moving up', summary: 'Expanded functions, and where hygiene fits',
    blocks: [{ type: 'checklist', items: ladder }],
  },
  {
    id: 'watch-out', title: 'Watch out', icon: 'caution', summary: 'Programs and promises to check first',
    blocks: [
      { type: 'disclosures', items: mistakes },
      { type: 'text', entry: cheaper },
    ],
  },
  { id: 'questions', title: 'Common questions', summary: 'School, x-rays, DANB, pay, hygiene', blocks: [{ type: 'faq', items: faq }] },
]

// ── Additional resources: every reference above, as plain grouped links ──────────────────────────────────────────
export const resourcesSummary = 'State rules, certifications, pay data'
export const resources = [
  { title: 'State rules', items: [
    { key: 'tsbde-xray', name: 'Texas dental assistant radiology certificate' },
    { key: 'dbc-faq', name: 'California dental assistant duties (Dental Board of California)' },
    { key: 'dbc-sb1453', name: 'California infection control course rule' },
    { key: 'fl-rad', name: 'Florida dental radiographer certification' },
    { key: 'fl-rule', name: 'Florida x-ray training rule for dental assistants' },
    { key: 'pa-301', name: 'Pennsylvania x-ray exam definition' },
    { key: 'pa-302', name: 'Pennsylvania rules for taking x-rays' },
    { key: 'pa-efda', name: 'Pennsylvania expanded function dental assistant' },
    { key: 'oh-4715', name: 'Ohio dental x-ray machine operator certificate' },
    { key: 'wa-faq', name: 'Washington dental assistant registration' },
  ] },
  { title: 'Certifications', items: [
    { key: 'danb-cda', name: 'Certified Dental Assistant exam (DANB)' },
    { key: 'danb-packet', name: 'CDA application, fees and renewal (DANB)' },
    { key: 'danb-cert', name: 'Dental assistant certification (DANB)' },
    { key: 'nbc-cdt', name: 'Certified Dental Technician exams (NBC)' },
  ] },
  { title: 'Schools and safety', items: [
    { key: 'coda-find', name: 'Find an accredited dental program (CODA)' },
    { key: 'coda-about', name: 'About the Commission on Dental Accreditation' },
    { key: 'ftc-voc', name: 'Choosing a vocational school (FTC)' },
    { key: 'osha-bbp', name: 'Bloodborne pathogens and hepatitis B vaccination (OSHA)' },
  ] },
  { title: 'Employers', items: [
    { key: 'wd-boise', name: 'Willamette Dental dental assistant posting' },
    { key: 'wd-tacoma', name: 'Willamette Dental sterilizer posting' },
    { key: 'wd-recep', name: 'Willamette Dental receptionist posting' },
    { key: 'wd-efda', name: 'Willamette Dental expanded functions posting' },
    { key: 'd365-entry', name: 'Dental365 entry-level dental assistant posting' },
    { key: 'd365-fd', name: 'Dental365 front desk posting' },
    { key: 'urmc', name: 'University of Rochester dental assistant training program' },
  ] },
  { title: 'Pay data', items: [
    { key: 'bls-da', name: 'Dental assistants (Bureau of Labor Statistics)' },
    { key: 'onet-da', name: 'Dental assistant wages (O*NET)' },
    { key: 'bls-lab', name: 'Dental laboratory technicians' },
    { key: 'onet-lab', name: 'Dental laboratory technician wages (O*NET)' },
    { key: 'bls-recep', name: 'Receptionists' },
    { key: 'onet-recep', name: 'Receptionist wages (O*NET)' },
    { key: 'bls-hyg', name: 'Dental hygienists' },
  ] },
  { title: 'Community discussions', items: [
    { key: 'r-steril1', name: 'Becoming a sterilization tech' },
    { key: 'r-steril2', name: 'Pay growth in sterilization' },
    { key: 'r-raise', name: 'How long raises take for assistants' },
    { key: 'r-paylist', name: 'Dental assistant pay and experience' },
    { key: 'r-fdinsure', name: 'Front desk work that grows into insurance' },
    { key: 'r-fdangry', name: 'What patients blame the front desk for' },
    { key: 'r-left', name: 'Assistants who left for other work' },
  ] },
]

/** Every fact on the page, in reading order: the hero, then each menu row. */
export function pageEntries() {
  return [guide.answer, ...tiles, ...blockEntries(menu)]
}
