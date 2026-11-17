// /start/callcenter — "Getting into call center and customer service work". The page renders from this module only, so
// every figure on it carries a reference and an as-of date (lib/start/guides.test.mjs fails on a figure without one).
//
// THE ONLY SOURCE OF FACTS is the research file compiled 2026-11-17 (session scratchpad guides20/callcenter/research.md).
// Rules this module keeps:
//   • only items the research marked VERIFIED (BLS Occupational Outlook Handbook, the CFPB, the NAIC model law, the FTC,
//     and employers' own postings read on their own applicant systems: TP, GEICO, Enova, Wedgewood Pharmacy);
//   • FIRST-HAND items (several accounts agreeing) only as `firstHand: true`, said as what people say, never as fact;
//   • nothing from the research's UNVERIFIED list: no OEWS figure (supervisor pay, call-center-industry pay could not be
//     read for May 2025), no inside-sales incentive ceiling, no Florida licence details, no Philippines postings, no
//     third-party internet-speed claims (TTEC, Alorica), no "calls per shift" or handle-time benchmark;
//   • metrics are named only as employers name them (first-call resolution, quality, service level, schedule
//     adherence, KPIs); the time a call takes appears only in what agents say;
//   • the licence row says only what the NAIC model law says and that your state's law decides;
//   • pay medians sit below the all-occupations median and the page says so; no hype, no guarantees, no exclamation marks.
//
// Shape: `sources` (every reference behind the page, kept here and never printed as citations — readers reach the
// links through the grouped "Additional resources" menu, `resources` below), entries `{ text, src, firstHand? }`, the
// listings filter config (`listings`, lib/start/listingFilters.js) and the openable menu rows (`menu`, rendered by
// components/start/Guide.tsx). Pure data; relative imports only so `node --test` runs it as is.

import { blockEntries } from './entries.js'

/** @typedef {{ label: string, url: string, date: string, note?: string }} Source */

/** @type {Record<string, Source>} */
export const sources = {
  'bls-csr': { label: 'U.S. Bureau of Labor Statistics, Occupational Outlook Handbook: Customer Service Representatives (May 2025 pay, 2025–35 projections)', url: 'https://www.bls.gov/ooh/office-and-administrative-support/customer-service-representatives.htm', date: '2026-10-29', note: 'page updated' },
  'bls-collectors': { label: 'BLS Occupational Outlook Handbook: Bill and Account Collectors (May 2025 pay, 2025–35 projections)', url: 'https://www.bls.gov/ooh/office-and-administrative-support/bill-and-account-collectors.htm', date: '2026-08-27', note: 'page updated' },
  'ecfr-1006': { label: 'Electronic Code of Federal Regulations, 12 CFR part 1006 (Regulation F, debt collection), sections 1006.6 and 1006.14', url: 'https://www.ecfr.gov/current/title-12/chapter-X/part-1006', date: '2026-11-12', note: 'current as of' },
  'cfpb-calls': { label: 'Consumer Financial Protection Bureau, When and how often can a debt collector call me on the phone?', url: 'https://www.consumerfinance.gov/ask-cfpb/when-and-how-often-can-a-debt-collector-call-me-on-the-phone-en-2110/', date: '2024-12-09', note: 'last reviewed' },
  'naic-218': { label: 'National Association of Insurance Commissioners, Producer Licensing Model Act (Model 218), sections 3 and 5', url: 'https://content.naic.org/sites/default/files/model-law-218.pdf', date: '2005-01', note: 'published' },
  'tp-remote': { label: 'TP (Teleperformance) posting 2026-91814, Customer Service Representative, remote (own careers site)', url: 'https://careersus-teleperformance.icims.com/jobs/91814/customer-service-representative---remote/job', date: '2026-11-17', note: 'read' },
  'tp-health': { label: 'TP posting 2026-95984, Healthcare Customer Service Representative, remote (own careers site)', url: 'https://careersus-teleperformance.icims.com/jobs/95984/healthcare-customer-service-representative---remote/job', date: '2026-11-17', note: 'read' },
  'tp-onsite': { label: 'TP posting 2026-95255, Customer Service Representative, on site in North Lauderdale, FL (own careers site)', url: 'https://careersus-teleperformance.icims.com/jobs/95255/customer-service-representative---onsite/job', date: '2026-11-17', note: 'read' },
  'tp-bilingual': { label: 'TP posting 2026-91476, Bilingual Spanish/English Customer Service Representative, remote (own careers site)', url: 'https://careersus-teleperformance.icims.com/jobs/91476/remote-----bilingual-spanish-english-customer-service-representative----remote/job', date: '2026-11-17', note: 'read' },
  'tp-prelicensed': { label: 'TP posting 2026-90720, Pre-Licensed Customer Service Representative (insurance), remote (own careers site)', url: 'https://careersus-teleperformance.icims.com/jobs/90720/pre-licensed-customer-service-representative---remote/job', date: '2026-11-17', note: 'read' },
  'tp-supervisor': { label: 'TP posting 2026-86889, Operations Supervisor, El Paso, TX (own careers site)', url: 'https://careersus-teleperformance.icims.com/jobs/86889/operations-supervisor/job', date: '2026-11-17', note: 'read' },
  'geico-tx': { label: 'GEICO posting R0066743, Customer Service Representative, Richardson, TX (own careers site)', url: 'https://geico.wd1.myworkdayjobs.com/External/job/Richardson-TX/Customer-Service-Representative_R0066743', date: '2026-11-12', note: 'posted' },
  'geico-bilingual': { label: 'GEICO posting R0066780, Bilingual Customer Service Representative (Spanish), Richardson, TX (own careers site)', url: 'https://geico.wd1.myworkdayjobs.com/External/job/Richardson-TX/Bilingual-Customer-Service-Representative--Spanish--_R0066780', date: '2026-11-11', note: 'posted' },
  'geico-ny': { label: 'GEICO posting R0066507, Customer Service Representative, Getzville, NY (own careers site)', url: 'https://geico.wd1.myworkdayjobs.com/External/job/Getzville-NY/Customer-Service-Representative_R0066507', date: '2026-11-02', note: 'posted' },
  'geico-sales': { label: 'GEICO posting R0066420, Inside Sales Representative, Tucson, AZ (own careers site)', url: 'https://geico.wd1.myworkdayjobs.com/External/job/Tucson-AZ/Inside-Sales-Representative_R0066420', date: '2026-11-10', note: 'posted' },
  'enova-collections': { label: 'Enova posting 8289567, Small Business Collections Representative, Denver, CO (own job board)', url: 'https://job-boards.greenhouse.io/enova/jobs/8289567', date: '2026-11-17', note: 'read' },
  'enova-lead': { label: 'Enova posting 8359985, Contact Center Team Lead, Outbound Collections, Chicago, IL (own job board)', url: 'https://job-boards.greenhouse.io/enova/jobs/8359985', date: '2026-11-17', note: 'read' },
  'wedgewood': { label: 'Wedgewood Pharmacy posting 4436657009, Customer Service Call Center Agent, remote after training, Swedesboro, NJ (own job board)', url: 'https://job-boards.greenhouse.io/wedgewoodpharmacy/jobs/4436657009', date: '2026-11-17', note: 'read' },
  'ftc-scams': { label: 'Federal Trade Commission, Job Scams (consumer advice)', url: 'https://consumer.ftc.gov/articles/job-scams', date: '2023-03', note: 'article dated' },
  'ftc-remote': { label: 'FTC consumer alert, Searching for a job to work remotely? Avoid scams and identity theft', url: 'https://consumer.ftc.gov/consumer-alerts/2023/11/searching-job-work-remotely-avoid-scams-identity-theft', date: '2023-11-13', note: 'published' },
  'ftc-text': { label: 'FTC consumer alert, That job offer text is probably a scam', url: 'https://consumer.ftc.gov/consumer-alerts/2026/04/job-offer-text-probably-scam', date: '2026-04-30', note: 'published' },
  'ftc-2025': { label: 'Federal Trade Commission press release, reported fraud losses in 2024', url: 'https://www.ftc.gov/news-events/news/press-releases/2025/03/new-ftc-data-show-big-jump-reported-losses-fraud-125-billion-2024', date: '2025-03-10', note: 'published' },
  // First-hand accounts (Reddit threads read through the Arctic Shift archive on 2026-11-17). Used only where several
  // accounts agree, and rendered as what people say, never as fact.
  'r-aht1': { label: 'r/CallCenterWorkers, whether call-time targets make sense', url: 'https://www.reddit.com/r/CallCenterWorkers/comments/1n5keos/', date: '2026-11-17', note: 'thread read' },
  'r-aht2': { label: 'r/CallCenterWorkers, 30 days to bring call times down', url: 'https://www.reddit.com/r/CallCenterWorkers/comments/15z3kxg/', date: '2026-11-17', note: 'thread read' },
  'r-aht3': { label: 'r/CallCenterWorkers, advice for shorter calls', url: 'https://www.reddit.com/r/CallCenterWorkers/comments/10dkco6/', date: '2026-11-17', note: 'thread read' },
  'r-aht4': { label: 'r/CallCenterWorkers, a new billing agent over the call-time target', url: 'https://www.reddit.com/r/CallCenterWorkers/comments/1xjj5c0/', date: '2026-11-17', note: 'thread read' },
  'r-quit1': { label: 'r/CallCenterWorkers, how long before people wanted to quit', url: 'https://www.reddit.com/r/CallCenterWorkers/comments/1o5ak2y/', date: '2026-11-17', note: 'thread read' },
  'r-quit2': { label: 'r/CallCenterWorkers, quitting a week into training', url: 'https://www.reddit.com/r/CallCenterWorkers/comments/1qgmlag/', date: '2026-11-17', note: 'thread read' },
  'r-noexp': { label: 'r/CallCenterWorkers, applying with no experience', url: 'https://www.reddit.com/r/CallCenterWorkers/comments/1vsrm5q/', date: '2026-11-17', note: 'thread read' },
}

export const guide = {
  path: '/start/callcenter',
  title: 'Getting into call center and customer service work',
  crumbLabel: 'Call center work',
  eyebrow: 'Guide',
  // The one-sentence answer under the h1 (the page's first screen).
  answer: { text: 'Most customer service and call center jobs ask for a high school diploma and no related experience, then train you on the job; many postings also set a typing speed and ask for open availability. The work is closely measured and can run evenings and weekends. Here is what each job pays, what working from home really takes, and who is hiring now.', src: ['bls-csr', 'tp-remote', 'geico-tx'] },
  metaDescription: 'How to get a call center or customer service job: what employers screen for, what the jobs pay, what work-from-home jobs require, insurance licences, collections rules, live listings near you, and the scams to avoid.',
  asOf: '2026-11-17',
}

// The three readings in the hero: each restates a fact below, with the same references.
export const tiles = [
  { label: 'Median pay', value: '$21.53/hr', text: 'for customer service representatives in May 2025; the lowest-paid tenth earned under $15.27', src: ['bls-csr'] },
  { label: 'Training', value: '2 to 4 weeks', text: 'of training on the job is typical; finance and insurance jobs can take several months', src: ['bls-csr'] },
  { label: 'Openings a year', value: 'About 289,500', text: 'projected each year to 2035, even though the number of these jobs is projected to fall 5% as simple requests move to self-service', src: ['bls-csr'] },
]

// 1. The jobs: a name, one line, and the figures as chips.
export const jobs = [
  {
    role: 'Customer service representative', aka: 'Also call center agent, customer care rep',
    what: { text: 'Answers questions about orders, bills and accounts, mostly by phone. A high school diploma is typical, no related work experience is expected, and training on the job usually lasts 2 to 4 weeks.', src: ['bls-csr'] },
    chips: [{ text: '$21.53/hr median', src: ['bls-csr'] }, { text: 'TP remote posting: $17/hr', src: ['tp-remote'] }],
  },
  {
    role: 'Chat and email support', aka: 'Also customer support specialist',
    what: { text: 'The same work in writing. BLS says some representatives work by email or text, live chat and social media; Wedgewood Pharmacy’s agents handle phone, email, SMS and chat in one job.', src: ['bls-csr', 'wedgewood'] },
    chips: [{ text: 'Typing speed on TP postings: 25–30 words a minute', src: ['tp-remote', 'tp-onsite'] }],
  },
  {
    role: 'Bilingual representative', aka: 'Most often Spanish and English',
    what: { text: 'The same jobs in two languages. GEICO’s Spanish-English posting requires fluency in both and adds a 10% bilingual differential; TP’s remote Spanish-English posting states no language differential.', src: ['geico-bilingual', 'tp-bilingual'] },
    chips: [{ text: 'GEICO, Texas: $23.00–$35.61/hr, plus 10%', src: ['geico-bilingual'] }, { text: 'TP remote: $15.50/hr', src: ['tp-bilingual'] }],
  },
  {
    role: 'Collections representative', aka: 'Also collector, collections specialist',
    what: { text: 'Calls people about overdue bills and works out repayment plans, under federal and state debt-collection law. A diploma is typical, with moderate-term training on the job; these jobs are projected to fall 10% from 2025 to 2035.', src: ['bls-collectors'] },
    chips: [{ text: '$22.61/hr median', src: ['bls-collectors'] }, { text: 'Enova posting: $25/hr, may include commission or bonus', src: ['enova-collections'] }],
  },
  {
    role: 'Inbound sales and insurance service', aka: 'Also inside sales, licensed rep',
    what: { text: 'Takes calls from people shopping for a policy or changing one. The NAIC’s model law for states says selling insurance takes a licence; GEICO’s postings say it provides the licensing training and covers exam fees.', src: ['naic-218', 'geico-tx', 'geico-sales'] },
    chips: [{ text: 'GEICO inside sales, Arizona: $41,000–$47,000 base a year', src: ['geico-sales'] }, { text: 'TP pre-licensed rep: $16–$19/hr', src: ['tp-prelicensed'] }],
  },
  {
    role: 'Team lead or supervisor', aka: 'After time on the phones',
    what: { text: 'Coaches agents and takes escalated calls. TP’s supervisor posting says 80% of the day is coaching and asks for 6 months of leadership experience; Enova’s collections team lead asks for 3 years in a contact center.', src: ['tp-supervisor', 'enova-lead'] },
    chips: [{ text: 'Enova team lead, Chicago: $21–$23/hr', src: ['enova-lead'] }],
  },
]

// 2. Pay: BLS by industry, then employers' own postings.
export const industryPay = [
  { industry: 'Insurance carriers', median: '$22.47', src: ['bls-csr'] },
  { industry: 'Professional and technical services', median: '$21.77', src: ['bls-csr'] },
  { industry: 'Healthcare and social assistance', median: '$21.49', src: ['bls-csr'] },
  { industry: 'Retail', median: '$17.96', src: ['bls-csr'] },
  { industry: 'Business support services', median: '$17.68', src: ['bls-csr'] },
]
export const industryNote = { text: 'Median hourly pay for customer service representatives by industry, May 2025. The median for all occupations was $24.51, so these jobs pay below it; the top tenth of representatives earned more than $30.57.', src: ['bls-csr'] }

export const postedPay = [
  { employer: 'TP, remote (38 states)', role: 'Customer service rep', pay: '$17.00/hr', src: ['tp-remote'] },
  { employer: 'TP, remote', role: 'Healthcare customer service rep', pay: '$14.00/hr', src: ['tp-health'] },
  { employer: 'TP, North Lauderdale, FL', role: 'Customer service rep, on site', pay: '$16.00–$17.00/hr', src: ['tp-onsite'] },
  { employer: 'TP, remote', role: 'Pre-licensed insurance rep', pay: '$16.00–$19.00/hr', src: ['tp-prelicensed'] },
  { employer: 'Wedgewood Pharmacy, NJ', role: 'Call center agent, remote after training', pay: '$19.25–$21.00/hr', src: ['wedgewood'] },
  { employer: 'GEICO, Getzville, NY', role: 'Customer service rep', pay: '$20.15/hr', src: ['geico-ny'] },
  { employer: 'GEICO, Richardson, TX', role: 'Customer service rep', pay: '$24.50–$29.51/hr', src: ['geico-tx'] },
  { employer: 'GEICO, Richardson, TX', role: 'Bilingual rep (Spanish)', pay: '$23.00–$35.61/hr', src: ['geico-bilingual'] },
  { employer: 'Enova, Denver, CO', role: 'Collections rep, hybrid', pay: '$25.00/hr', src: ['enova-collections'] },
  { employer: 'Enova, Chicago, IL', role: 'Collections team lead, hybrid', pay: '$21.00–$23.00/hr', src: ['enova-lead'] },
]
export const postedPayIntro = { text: 'Pay stated on employers’ own postings, read in November 2026. A posting is one job’s rate on that date, not what every location pays.', src: ['tp-remote', 'geico-tx', 'enova-collections', 'wedgewood'] }

export const paysMore = [
  { name: 'Evenings and weekends', text: 'GEICO’s customer service postings add 10% for evening shifts and 20% for weekends.', src: ['geico-tx', 'geico-ny'] },
  { name: 'A second language', text: 'GEICO adds 10% for the bilingual skill on its Spanish-English posting. Not every posting pays extra, so look for a stated differential.', src: ['geico-bilingual', 'tp-bilingual'] },
  { name: 'Insurance and finance', text: 'Representatives at insurance carriers had a median of $22.47 an hour in May 2025, against $17.96 in retail and $17.68 in business support services.', src: ['bls-csr'] },
  { name: 'Commission', text: 'Enova’s collections posting says pay "may include commission or bonus" on top of the hourly rate.', src: ['enova-collections'] },
]

// 3. Working from home, from the postings.
export const remoteLead = { text: 'BLS says working from home "is also possible in some companies." Real remote postings spell out what they require, and some make you train in person first.', src: ['bls-csr', 'wedgewood', 'geico-tx'] }
export const remoteRules = [
  { name: 'A wired connection', text: 'TP’s remote postings ask for a workspace near your router for a hardwired Ethernet connection, at least 15 Mbps down and 10 up.', src: ['tp-remote'] },
  { name: 'No satellite or hotspot', text: 'The same postings rule out satellite and mobile-data hotspots, and ask for proof of your internet speed.', src: ['tp-remote'] },
  { name: 'The right state', text: 'TP’s remote postings say employment is currently restricted to residents of 38 listed states; California and New York are not on the list.', src: ['tp-remote'] },
  { name: 'Time without interruptions', text: 'Wedgewood Pharmacy asks agents to be able to work uninterrupted, with 90% of the day helping customers.', src: ['wedgewood'] },
  { name: 'Equipment', text: 'Wedgewood provides the computer equipment for working from home. The FTC says never to pay for a job or for equipment.', src: ['wedgewood', 'ftc-remote'] },
  { name: 'Training in person first', text: 'Wedgewood trains new hires for six weeks, paid, on its New Jersey campus before they go remote; GEICO trains in the office, then offers the chance to work 20% of the time off site.', src: ['wedgewood', 'geico-tx'] },
]
export const nearOffice = { text: 'A remote job can still need you nearby: Wedgewood asks its remote agents to live within a commutable distance of its campus, and Enova’s hybrid roles are in the office Tuesday to Thursday.', src: ['wedgewood', 'enova-collections'] }

// 4. What employers screen for.
export const screens = [
  { name: 'A diploma and age 18', text: 'TP’s postings ask for a high school diploma or equivalent and age 18 or older; GEICO asks for a diploma or GED.', src: ['tp-remote', 'geico-tx'] },
  { name: 'Typing speed', text: 'TP asks remote representatives to type at least 25 words a minute, and 30 for its on-site job in Florida.', src: ['tp-remote', 'tp-onsite'] },
  { name: 'Some customer experience', text: 'From none listed (GEICO in New York) to 6 months of customer service (TP remote), 1 year (GEICO bilingual) or 3 years customer-facing (GEICO in Texas).', src: ['geico-ny', 'tp-remote', 'geico-bilingual', 'geico-tx'] },
  { name: 'Open availability', text: 'GEICO asks you to be available evenings, weekends and holidays; TP’s postings describe a schedule with a variety of shifts.', src: ['geico-tx', 'tp-remote'] },
]
export const applyLine = { text: 'Apply on the employer’s own careers site. The FTC warns about "employers" who will only interview you through Signal or similar text-only apps.', src: ['ftc-remote'] }
export const noExpPeopleSay = { text: 'People in call centers say turnover is high, which helps beginners get hired. Some say many people in their training class left during training or in the first months on live calls.', src: ['r-noexp', 'r-quit1', 'r-quit2'], firstHand: true }
export const movingUp = [
  { text: 'With experience, representatives may move up to supervisory roles, BLS says.', src: ['bls-csr'] },
  { text: 'TP’s supervisor posting asks for 6 months of leadership experience and says the job is coaching agents, running performance improvement plans and meeting quality, service level and schedule adherence targets.', src: ['tp-supervisor'] },
]

// 5. The work itself.
export const work = [
  { name: 'One contact after another', text: 'Wedgewood’s agents answer over 60 calls a day. BLS says call center representatives answer the phone and use computers to find solutions.', src: ['wedgewood', 'bls-csr'] },
  { name: 'Measured and monitored', text: 'BLS says supervisors monitor calls for quality. Employers name the measures: first-call resolution (TP), quality reports and customer surveys (Enova), and GEICO prefers people used to KPIs and productivity goals.', src: ['bls-csr', 'tp-remote', 'geico-tx', 'enova-lead'] },
  { name: 'Schedules by results', text: 'At Wedgewood, work schedules are awarded based on tenure and performance.', src: ['wedgewood'] },
  { name: 'Early, late and weekends', text: 'Some call centers are open 24 hours a day, BLS says, so shifts can start early or end late, and busy times may include evenings, weekends and holidays.', src: ['bls-csr'] },
  { name: 'Upset callers', text: 'Dealing with dissatisfied customers can be stressful, BLS says; collectors deal with people who "may become angry and confrontational."', src: ['bls-csr', 'bls-collectors'] },
  { name: 'Some selling', text: 'BLS says representatives may help generate sales. TP’s posting lists "Upsell if required"; GEICO asks reps to recommend more coverage.', src: ['bls-csr', 'tp-remote', 'geico-tx'] },
]
export const callTimePeopleSay = { text: 'Agents often name one number as the hardest to meet: how long their calls take on average, a target the company sets. Some say staying over it brought a deadline to improve or a final warning, even with good quality scores.', src: ['r-aht1', 'r-aht2', 'r-aht3', 'r-aht4'], firstHand: true }
export const callTimeTips = { text: 'Their usual advice: sum up what you did for the caller, then close the call without an open-ended question that invites a new topic. Check your call script first, since some require that question.', src: ['r-aht2', 'r-aht3'], firstHand: true }

// 6. Insurance, banking and collections.
export const licence = [
  { text: 'Under the NAIC’s model law for insurance agents, a person may not "sell, solicit or negotiate insurance" without a licence for that line, and a resident applying for one must pass a written exam unless exempt. Your own state’s law decides.', src: ['naic-218'] },
  { text: 'BLS says representatives who give finance and insurance information may need a state licence, and may need several months of training to learn the rules.', src: ['bls-csr'] },
  { text: 'GEICO’s Richardson, TX customer service posting needs no licence at hire, then requires a Personal Lines or Property and Casualty licence; GEICO provides the training and covers exam fees. TP posts a pre-licensed customer service job helping insurance policyholders with billing and policy changes.', src: ['geico-tx', 'tp-prelicensed'] },
]
export const collectionsRules = [
  { name: 'Federal and state law', text: 'Collectors follow the Fair Debt Collection Practices Act and state rules; Enova’s collections posting asks for knowledge of the FDCPA and FCRA.', src: ['bls-collectors', 'enova-collections'] },
  { name: 'Call hours', text: 'The CFPB says collectors are generally prohibited from contacting people before 8 a.m. or after 9 p.m.; Regulation F counts those hours by the person’s local time.', src: ['cfpb-calls', 'ecfr-1006'] },
  { name: 'How often', text: 'Under Regulation F, a collector is presumed to break the law when it places phone calls about a debt more than seven times within seven days, or within seven days after a phone conversation with the person about it. The rule counts phone calls, not texts or emails.', src: ['cfpb-calls', 'ecfr-1006'] },
]

// 7. Watch out.
export const scams = [
  { text: 'Never pay to get a job, or for equipment. "Honest employers won’t ask you to pay upfront," the FTC says.', src: ['ftc-remote', 'ftc-scams'] },
  { text: 'A large check sent to set up your home office is a warning sign: no honest employer sends you a check to deposit and then asks you to send part of the money on.', src: ['ftc-remote', 'ftc-scams'] },
  { text: 'Ignore unexpected texts offering a job, or asking you to reply YES or INTERESTED.', src: ['ftc-text'] },
  { text: 'Be wary of an "interview" held only in a text-only chat app, and of a job offered after a few questions that is followed at once by direct deposit and tax forms.', src: ['ftc-remote'] },
  { text: 'Reports of job and employment-agency scams tripled from 2020 to 2024, and reported losses rose from $90 million to $501 million, the FTC says.', src: ['ftc-2025'] },
]
export const firstMonths = [
  { text: 'Leaving during training or the first months on live calls is common, people say.', src: ['r-quit1', 'r-quit2', 'r-noexp'], firstHand: true },
  { text: 'Staying over the call-time target can bring a deadline to improve or a final warning.', src: ['r-aht2', 'r-aht4'], firstHand: true },
]

// FAQ — visible on the page and mirrored in FAQPage JSON-LD (only Q&As shown on the page).
export const faq = [
  {
    q: 'Can I get a call center job with no experience?',
    a: { text: 'Often, yes. BLS says the job needs no related work experience and usually trains you for 2 to 4 weeks. Postings vary: GEICO’s New York posting lists no minimum, while TP’s remote posting asks for 6 months of customer service.', src: ['bls-csr', 'geico-ny', 'tp-remote'] },
  },
  {
    q: 'Are work-from-home customer service jobs real?',
    a: { text: 'Yes, at some companies. Real postings list their internet and workspace rules, and some train you in person first. A real employer never asks you to pay for the job or for equipment.', src: ['bls-csr', 'tp-remote', 'wedgewood', 'ftc-remote'] },
  },
  {
    q: 'How much do call center jobs pay?',
    a: { text: 'The May 2025 median for customer service representatives was $21.53 an hour, below the $24.51 median for all jobs. On postings read in November 2026, starting pay ran from $14 an hour (a TP remote healthcare job) to $35.61 at the top of a GEICO bilingual range.', src: ['bls-csr', 'tp-health', 'geico-bilingual'] },
  },
  {
    q: 'How fast do I need to type?',
    a: { text: 'TP’s postings ask for at least 25 words a minute for its remote job and 30 for an on-site job in Florida; other employers may set a different bar.', src: ['tp-remote', 'tp-onsite'] },
  },
  {
    q: 'Do I need a licence?',
    a: { text: 'Only some do. BLS says representatives who give finance or insurance information may need a state licence, and under the NAIC’s model law for states, selling insurance takes one, with a written exam. Some insurers, such as GEICO, provide the training and cover exam fees.', src: ['naic-218', 'bls-csr', 'geico-tx'] },
  },
  {
    q: 'Do bilingual jobs pay more?',
    a: { text: 'Some do. GEICO adds 10% for Spanish-English reps, while TP’s remote Spanish-English posting states no language differential, so check the posting.', src: ['geico-bilingual', 'tp-bilingual'] },
  },
]

// ── Listings: the filters on the "Hiring now" block (lib/start/listingFilters.js) ──────────────────────────────────
// A plain "Customer Service Representative" or "Call Center Agent" IS the entry job (diploma, no related experience,
// a few weeks of training), so the level reads 'entryUnlessMarked': a title is experienced only when it says lead /
// supervisor / senior / II, or the listing's own level says senior. Every row must carry a service word in its title
// (gateTitle), so a "Data Collection Tester", "Collectibles" or a "Bilingual Psychiatric Provider" never shows; office
// management, engineering, clinical, store-counter and AI-training rows are dropped by `exclude`.
// Measured read-only on Seen's own rows 2026-11-17: "customer service representative" 200 active rows (many store or
// branch jobs), "call center" 55, "contact center" 17, "collect" 119 (mostly data collection / collectibles — hence
// the plural-or-collector gate), "bilingual" 200 (mostly retail sales and clinical — hence the bilingual match needs a
// service word), "customer support" 170 (many AI-training gigs and support engineers — excluded), "customer service
// supervisor" 2.
const SERVICE = '(?:customer (?:service|care|support|experience|contact)|call cent(?:er|re)|contact cent(?:er|re)|inbound call|in-bound call|chat support|email support|member services?|patient access|collections|collector|debt collection)'
export const listings = {
  defaultRadius: '25',
  radii: ['10', '25', '50', '100'],
  levelMode: 'entryUnlessMarked',
  levelLabels: { any: 'Any level', entry: 'Entry / no experience', experienced: 'Experienced / lead' },
  levelWords: { entry: 'entry-level', experienced: 'experienced' },
  gateTitle: `\\b${SERVICE}`,
  exclude: '\\b(engineer\\w*|developer|software|architect|director|managers?|management|vice president|head of|analyst|scientist|consultant|nurse|nursing|physician|clinical|clinician|therapist|medical assistant|dental|veterinar\\w*|receptionist|teller|cashier|retail|store|paint|psychic|data collection|collectibles?|ai training|trainer|instructor|recruit\\w*|marketing|attorney|counsel|pharmacist|technician|driver|cdl|warehouse|dock|account executive|account manager|account specialist|product owner|quality assurance|workforce|implementation|osint|intelligence|clearance|data collector|toll|designer|paralegal|subject matter|curator|archiv\\w*)\\b',
  positions: [
    {
      id: 'all', label: 'All customer service jobs', noun: 'customer service', mix: 'positions',
      queries: ['customer service representative', 'call center representative', 'customer support specialist', 'bilingual customer service', 'collections specialist', 'call center supervisor'],
      seeAll: 'customer service representative',
    },
    {
      id: 'rep', label: 'Customer service rep', noun: 'customer service rep',
      queries: ['customer service representative', 'customer care representative', 'customer service associate'],
      match: 'customer (?:service|care|experience|contact) (?:representative|rep|associate|agent|advocate|specialist|professional|coordinator)|member services? (?:representative|rep|specialist|associate)|patient access (?:representative|specialist)',
    },
    {
      id: 'callcenter', label: 'Call center agent', noun: 'call center agent',
      queries: ['call center representative', 'call center agent', 'contact center representative'],
      match: '(?:call|contact) cent(?:er|re)(?: \\w+)? (?:agent|rep\\w*|associate|specialist|advocate|scheduler|positions)|in-?bound call|(?:representative|agent|specialist|scheduler|relations)\\W+(?:call|contact) cent|(?:call|contact) cent(?:er|re) ?/',
    },
    {
      id: 'chat', label: 'Support & chat', noun: 'customer support and chat',
      queries: ['customer support specialist', 'chat support', 'customer support representative'],
      match: '\\bchat\\b|email support|customer support (?:specialist|associate|representative|rep|agent|team member|advocate|advisor)|customer support\\W*(?:-|\\(|$)',
    },
    {
      id: 'bilingual', label: 'Bilingual', noun: 'bilingual customer service',
      queries: ['bilingual customer service', 'bilingual call center', 'spanish customer service'],
      match: '(?:bilingual|spanish|español)',
    },
    {
      id: 'collections', label: 'Collections', noun: 'collections',
      queries: ['collections specialist', 'collections representative', 'debt collector'],
      match: 'collections|collector|debt collection',
    },
    {
      id: 'lead', label: 'Team lead', noun: 'team lead and supervisor',
      queries: ['call center supervisor', 'customer service supervisor', 'team lead customer service'],
      match: '\\b(?:team lead|lead|team leader|supervisor)\\b',
    },
  ],
}

// ── The page's openable rows (components/start/Guide.tsx `Blocks` renders each block type) ──────────────────────────
export const menu = [
  {
    id: 'the-jobs', title: 'The jobs', summary: 'Six ways in, and what each pays',
    blocks: [
      { type: 'cards', items: jobs.map((j) => ({ name: j.role, aka: j.aka, body: j.what, chips: j.chips })) },
    ],
  },
  {
    id: 'what-it-pays', title: 'What it pays', summary: 'Employers’ own numbers, and what pays more',
    blocks: [
      { type: 'text', entry: postedPayIntro },
      { type: 'table', caption: 'Pay stated on employers’ own postings', columns: [{ key: 'employer', label: 'Employer' }, { key: 'role', label: 'Job' }, { key: 'pay', label: 'Stated pay', num: true }], rows: postedPay },
      { type: 'heading', text: 'What pays more' },
      { type: 'checklist', items: paysMore, cols: true },
      { type: 'more', title: 'Pay by industry', blocks: [
        { type: 'table', caption: 'Median hourly pay for customer service representatives, by industry', columns: [{ key: 'industry', label: 'Industry' }, { key: 'median', label: 'Median an hour', num: true }], rows: industryPay },
        { type: 'note', entry: industryNote },
      ] },
    ],
  },
  {
    id: 'remote', title: 'Working from home', summary: 'Internet, space, state, training first',
    blocks: [
      { type: 'text', entry: remoteLead },
      { type: 'checklist', items: remoteRules, cols: true },
      { type: 'note', entry: nearOffice },
    ],
  },
  {
    id: 'getting-hired', title: 'What employers screen for', summary: 'Typing, experience, availability',
    blocks: [
      { type: 'checklist', items: screens, cols: true },
      { type: 'text', entry: applyLine },
      { type: 'text', entry: noExpPeopleSay, lead: 'From people who work in call centers:' },
      { type: 'heading', text: 'Moving up' },
      { type: 'text', entries: movingUp },
      { type: 'resumeLink', before: 'Before you apply, you can', label: 'check your résumé against a posting' },
    ],
  },
  {
    id: 'the-work', title: 'What the work is like', summary: 'Measured calls, shifts, upset callers',
    blocks: [
      { type: 'checklist', items: work, cols: true },
      { type: 'text', entry: callTimePeopleSay, lead: 'From people who take the calls:' },
      { type: 'more', title: 'How agents keep calls short', blocks: [{ type: 'text', entry: callTimeTips }] },
    ],
  },
  {
    id: 'licences', title: 'Insurance and collections', summary: 'Licences, and the rules collectors follow',
    blocks: [
      { type: 'heading', text: 'Insurance licences' },
      { type: 'text', entries: licence },
      { type: 'heading', text: 'Collections' },
      { type: 'checklist', items: collectionsRules },
    ],
  },
  {
    id: 'watch-out', title: 'Watch out', icon: 'caution', summary: 'Work-from-home scams, the first months',
    blocks: [
      { type: 'notesGrid', groups: [
        { label: 'Scams', items: scams, icon: 'x' },
        { label: 'The first months, people say', items: firstMonths, icon: 'x' },
      ] },
    ],
  },
  { id: 'questions', title: 'Common questions', summary: 'Experience, remote, pay, typing, licences', blocks: [{ type: 'faq', items: faq }] },
]

// ── Additional resources: every reference above, as plain grouped links (no numbers, closed by default) ────────────
export const resourcesSummary = 'Employers’ postings, pay data, scam warnings'
export const resources = [
  { title: 'Employers’ postings', items: [
    { key: 'tp-remote', name: 'TP: customer service representative, remote' },
    { key: 'tp-health', name: 'TP: healthcare customer service, remote' },
    { key: 'tp-onsite', name: 'TP: customer service, North Lauderdale, FL' },
    { key: 'tp-bilingual', name: 'TP: bilingual Spanish-English, remote' },
    { key: 'tp-prelicensed', name: 'TP: pre-licensed insurance rep, remote' },
    { key: 'tp-supervisor', name: 'TP: operations supervisor, El Paso, TX' },
    { key: 'geico-tx', name: 'GEICO: customer service, Richardson, TX' },
    { key: 'geico-bilingual', name: 'GEICO: bilingual customer service, Richardson, TX' },
    { key: 'geico-ny', name: 'GEICO: customer service, Getzville, NY' },
    { key: 'geico-sales', name: 'GEICO: inside sales, Tucson, AZ' },
    { key: 'enova-collections', name: 'Enova: collections representative, Denver, CO' },
    { key: 'enova-lead', name: 'Enova: collections team lead, Chicago, IL' },
    { key: 'wedgewood', name: 'Wedgewood Pharmacy: call center agent, New Jersey' },
  ] },
  { title: 'Pay and jobs data', items: [
    { key: 'bls-csr', name: 'Customer service representatives (Bureau of Labor Statistics)' },
    { key: 'bls-collectors', name: 'Bill and account collectors (Bureau of Labor Statistics)' },
  ] },
  { title: 'Licences and rules', items: [
    { key: 'naic-218', name: 'Insurance agent licensing model law (NAIC)' },
    { key: 'cfpb-calls', name: 'When debt collectors may call (CFPB)' },
    { key: 'ecfr-1006', name: 'Regulation F, debt collection rules (eCFR)' },
  ] },
  { title: 'Job scams', items: [
    { key: 'ftc-scams', name: 'Job scams (Federal Trade Commission)' },
    { key: 'ftc-remote', name: 'Remote job scams (Federal Trade Commission)' },
    { key: 'ftc-text', name: 'Job offer texts (Federal Trade Commission)' },
    { key: 'ftc-2025', name: 'Reported fraud losses in 2024 (Federal Trade Commission)' },
  ] },
  { title: 'Community discussions', items: [
    { key: 'r-aht1', name: 'Do call-time targets make sense' },
    { key: 'r-aht2', name: 'Thirty days to bring call times down' },
    { key: 'r-aht3', name: 'Advice for shorter calls' },
    { key: 'r-aht4', name: 'A new billing agent over the target' },
    { key: 'r-quit1', name: 'How long before people wanted to quit' },
    { key: 'r-quit2', name: 'Quitting a week into training' },
    { key: 'r-noexp', name: 'Applying with no experience' },
  ] },
]

/** Every fact on the page, in reading order: the hero, then each menu row. */
export function pageEntries() {
  return [guide.answer, ...tiles, ...blockEntries(menu)]
}
