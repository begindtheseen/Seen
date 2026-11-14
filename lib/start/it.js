// /start/it — "Getting into IT help desk work". The page renders from this module only, so every figure on it
// carries a source and an as-of date (lib/start/guides.test.mjs fails on a figure without one).
//
// THE ONLY SOURCE OF FACTS is the research file compiled 2026-11-14 (session scratchpad research/it.md).
// Rules this module keeps:
//   • only items the research marked VERIFIED (BLS and O*NET, CompTIA's own exam pages, Google and Coursera's own
//     pages, the programs' own pages, Indeed Hiring Lab's public data, federal enforcement records);
//   • FIRST-HAND items only as `firstHand: true`, rendered as what people say, never as fact;
//   • nothing from the research's UNVERIFIED / CONFLICTING list: no CompTIA exam prices (no $274, $548, $265,
//     $253, $399, $439), no Google "$70,000+" median (built from postings, not pay), no layoffs total, no NPower
//     outcome rates (its own pages disagree), no MS-900, no AZ-900 price, no OEWS 717,190 count, no Per Scholas
//     "80% placement", no IBM / Apple / Best Buy program or pay claims, no CompTIA Apprenticeships for Tech;
//   • the projection is negative and the page says so: user support is a replacement market, not a growth one;
//   • no hype, no guarantees, no exclamation marks; contract jobs, long searches and course-loan traps said plainly.
//
// Shape: `sources` (every reference behind the page, kept here and never printed as citations — readers reach the
// links through the grouped "Additional resources" menu, `resources` below), entries `{ text, src, firstHand? }`, the
// listings filter config (`listings`) and the openable menu rows (`menu`).

import { blockEntries } from './entries.js'

/** @typedef {{ label: string, url: string, date: string, note?: string }} Source */

/** @type {Record<string, Source>} */
export const sources = {
  'bls-css': { label: 'U.S. Bureau of Labor Statistics, Occupational Outlook Handbook: Computer Support Specialists (May 2025 pay, 2025–35 projections)', url: 'https://www.bls.gov/ooh/computer-and-information-technology/computer-support-specialists.htm', date: '2026-08-27', note: 'page updated' },
  'onet-1232-wages': { label: 'O*NET OnLine, wages for Computer User Support Specialists, 15-1232.00 (BLS May 2025 data)', url: 'https://www.onetonline.org/link/localwages/15-1232.00', date: '2026-11-14', note: 'read' },
  'onet-1231-wages': { label: 'O*NET OnLine, wages for Computer Network Support Specialists, 15-1231.00 (BLS May 2025 data)', url: 'https://www.onetonline.org/link/localwages/15-1231.00', date: '2026-11-14', note: 'read' },
  'onet-1232': { label: 'O*NET OnLine, Computer User Support Specialists, 15-1232.00 (reported job titles)', url: 'https://www.onetonline.org/link/summary/15-1232.00', date: '2026-11-14', note: 'read' },
  'onet-1231': { label: 'O*NET OnLine, Computer Network Support Specialists, 15-1231.00 (education required)', url: 'https://www.onetonline.org/link/summary/15-1231.00', date: '2026-11-14', note: 'read' },
  'indeed-data': { label: 'Indeed Hiring Lab, job postings by sector, US (seasonally adjusted index, February 1, 2020 = 100)', url: 'https://raw.githubusercontent.com/hiring-lab/job_postings_tracker/master/US/job_postings_by_sector_US.csv', date: '2026-11-06', note: 'data through' },
  'indeed-q3': { label: 'Indeed Hiring Lab, 2026 Q3 US tech labor market update', url: 'https://hiringlab.indeed.com/2026/11/12/2026-q3-us-tech-labor-market-update/', date: '2026-11-12', note: 'published' },
  'comptia-workforce': { label: 'CompTIA, State of the Tech Workforce 2026', url: 'https://lecbyo.files.cmp.optimizely.com/download/ca5c4d84197d11f1b0fa326ff783616b', date: '2026-11-14', note: 'read' },
  'metricnet': { label: 'MetricNet, Benchmarking Roundup: Summary of 2023 IT Service and Support Benchmarks', url: 'https://www.brighttalk.com/resource/core/447335/benchmarking-roundup---summary-of-2023-service-and-support-benchmarks-v3_954461.pdf', date: '2026-11-14', note: 'read' },
  'comptia-aplus': { label: 'CompTIA A+ certification overview (two exams, taken in any order)', url: 'https://www.comptia.org/en-us/certifications/a/', date: '2026-11-14', note: 'read' },
  'comptia-a1': { label: 'CompTIA A+ Core 1 (220-1201) exam page', url: 'https://www.comptia.org/en-us/certifications/a/core-1-v15/', date: '2026-11-14', note: 'read' },
  'comptia-a2': { label: 'CompTIA A+ Core 2 (220-1202) exam page', url: 'https://www.comptia.org/en-us/certifications/a/core-2-v15/', date: '2026-11-14', note: 'read' },
  'comptia-net': { label: 'CompTIA Network+ (N10-009) exam page', url: 'https://www.comptia.org/en-us/certifications/network/', date: '2026-11-14', note: 'read' },
  'comptia-sec': { label: 'CompTIA Security+ V8 (SY0-801) exam page', url: 'https://www.comptia.org/en-us/certifications/security/v8/', date: '2026-11-14', note: 'read' },
  'comptia-renew': { label: 'CompTIA, certification renewal policy', url: 'https://www.comptia.org/en-us/resources/test-policies/continuing-education-policies/certification-renewal-policy/', date: '2026-11-14', note: 'read' },
  'comptia-higher': { label: 'CompTIA, renew by earning a higher-level certification', url: 'https://www.comptia.org/en-us/resources/ce/choose/renew-with-a-single-activity/earn-a-higher-level-comptia-certification/', date: '2026-11-14', note: 'read' },
  'comptia-fees': { label: 'CompTIA, continuing education renewal fees', url: 'https://www.comptia.org/en-us/resources/ce/learn/continuing-education-renewal-fees/', date: '2026-11-14', note: 'read' },
  'comptia-dod': { label: 'CompTIA, DoD 8140 framework alignment', url: 'https://www.comptia.org/en/resources/comptia-framework-alignment/', date: '2026-11-14', note: 'read' },
  'dodm-8140': { label: 'DoD Manual 8140.03, Cyberspace Workforce Qualification and Management Program', url: 'https://www.esd.whs.mil/Portals/54/Documents/DD/issuances/dodm/814003p.PDF', date: '2023-02-15', note: 'effective' },
  'google-cert': { label: 'Grow with Google, Google IT Support Certificate', url: 'https://grow.google/certificates/it-support/', date: '2026-11-14', note: 'read' },
  'coursera-google': { label: 'Coursera, Google IT Support Professional Certificate', url: 'https://www.coursera.org/professional-certificates/google-it-support', date: '2026-11-14', note: 'read' },
  'perscholas-course': { label: 'Per Scholas, IT Support course', url: 'https://perscholas.org/courses/it-support/', date: '2026-11-14', note: 'read' },
  'perscholas-elig': { label: 'Per Scholas, apply (eligibility rules)', url: 'https://www.perscholas.org/learners/apply-now/', date: '2026-11-14', note: 'read' },
  'perscholas-impact': { label: 'Per Scholas, impact and research', url: 'https://www.perscholas.org/about/impact-and-research/', date: '2026-11-14', note: 'read' },
  'yearup-it': { label: 'Year Up United, IT Support training program', url: 'https://www.yearup.org/job-training-programs/new-york/it-support', date: '2026-11-14', note: 'read' },
  'yearup-students': { label: 'Year Up United, for students (tuition and stipend)', url: 'https://www.yearup.org/students', date: '2026-11-14', note: 'read' },
  'yearup-faq': { label: 'Year Up United, student FAQs', url: 'https://www.yearup.org/students/student-faqs', date: '2026-11-14', note: 'read' },
  'opre-yearup': { label: 'Administration for Children and Families (OPRE), Benefits that Last: long-term impact and cost-benefit findings for Year Up', url: 'https://acf.gov/opre/report/benefits-last-long-term-impact-and-cost-benefit-findings-year-up', date: '2022-05', note: 'published' },
  'npower-apply': { label: 'NPower, apply to Tech Fundamentals', url: 'https://www.npower.org/apply/', date: '2026-11-14', note: 'read' },
  'npower-home': { label: 'NPower, home page (its outcome figures)', url: 'https://www.npower.org/', date: '2026-11-14', note: 'read' },
  'dol-it-fs': { label: 'U.S. Department of Labor, apprenticeship industry fact sheet: information technology', url: 'https://www.apprenticeship.gov/sites/default/files/DOLIndFS-IT-042624-508.pdf', date: '2024-04', note: 'updated' },
  'cfpb-bloomtech': { label: 'Consumer Financial Protection Bureau, enforcement action: BloomTech Inc.', url: 'https://www.consumerfinance.gov/enforcement/actions/bloomtech-inc-and-austen-allred/', date: '2024-04-17', note: 'order' },
  'cfpb-bloomtech-pr': { label: 'Consumer Financial Protection Bureau, press release on its action against the coding boot camp BloomTech', url: 'https://www.consumerfinance.gov/archive/newsroom/cfpb-takes-action-against-coding-boot-camp-bloomtech-and-ceo-austen-allred-for-deceiving-students-and-hiding-loan-costs/', date: '2024-04-17', note: 'announced' },
  'cfpb-bff': { label: 'Consumer Financial Protection Bureau, enforcement action: Better Future Forward, Inc.', url: 'https://www.consumerfinance.gov/enforcement/actions/better-future-forward-inc/', date: '2021-09-07', note: 'order' },
  'ftc-careerstep': { label: 'Federal Trade Commission, Career Step to pay $43.5 million to resolve deceptive advertising charges', url: 'https://www.ftc.gov/news-events/news/press-releases/2024/07/career-step-pay-435-million-cash-debt-cancellation-resolve-charges-it-used-deceptive-advertising', date: '2024-07-30', note: 'announced' },
  // First-hand accounts (Reddit threads read through the Arctic Shift archive); never presented as fact.
  'r-1ta9chn': { label: 'r/ITCareerQuestions, "How many applications did it take you to land your first IT job in this market?"', url: 'https://www.reddit.com/r/ITCareerQuestions/comments/1ta9chn/', date: '2026-05-11', note: 'thread' },
  'r-1ndtb2g': { label: 'r/ITCareerQuestions, "I finally did it, I landed my first IT job"', url: 'https://www.reddit.com/r/ITCareerQuestions/comments/1ndtb2g/', date: '2025-09-10', note: 'thread' },
  'r-1od833q': { label: 'r/ITCareerQuestions, "Finally landed a job"', url: 'https://www.reddit.com/r/ITCareerQuestions/comments/1od833q/', date: '2025-10-22', note: 'thread' },
  'r-1xi60u4': { label: 'r/CompTIA, "I have a CompTIA A+. I\'ve applied to over 100 IT help desk jobs…"', url: 'https://www.reddit.com/r/CompTIA/comments/1xi60u4/', date: '2026-10-29', note: 'thread' },
  'r-1u7rbvt': { label: 'r/CompTIA, "Still job searching for 1st help desk job 1 year after Net+ / A+"', url: 'https://www.reddit.com/r/CompTIA/comments/1u7rbvt/', date: '2026-06-16', note: 'thread' },
  'r-1p7vpq2': { label: 'r/ITCareerQuestions, "Landed my First IT job recently"', url: 'https://www.reddit.com/r/ITCareerQuestions/comments/1p7vpq2/', date: '2025-11-27', note: 'thread' },
  'r-1v7jxgj': { label: 'r/ITCareerQuestions, "Hiring managers/interviewers: What makes you interview an entry-level candidate?"', url: 'https://www.reddit.com/r/ITCareerQuestions/comments/1v7jxgj/', date: '2026-07-26', note: 'thread' },
  'r-1x3bg9c': { label: 'r/ITCareerQuestions, "If someone with no tech background… got some IT certifications like CompTIA A+…"', url: 'https://www.reddit.com/r/ITCareerQuestions/comments/1x3bg9c/', date: '2026-10-11', note: 'thread' },
  'r-1puof6c': { label: 'r/CompTIA, "Leadership at my job sees no value in CompTIA certs"', url: 'https://www.reddit.com/r/CompTIA/comments/1puof6c/', date: '2025-12-24', note: 'thread' },
  'r-1slniik': { label: 'r/ITCareerQuestions, "Landed an internship with a local MSP"', url: 'https://www.reddit.com/r/ITCareerQuestions/comments/1slniik/', date: '2026-04-14', note: 'thread' },
  'r-1kferni': { label: 'r/ITCareerQuestions, "From customer service to IT help desk at a FAANG company"', url: 'https://www.reddit.com/r/ITCareerQuestions/comments/1kferni/', date: '2025-05-05', note: 'thread' },
  'r-1vi8fd6': { label: 'r/ITCareerQuestions, "Does helpdesk or IT support specialist pay scale rapidly over a year or two?"', url: 'https://www.reddit.com/r/ITCareerQuestions/comments/1vi8fd6/', date: '2026-08-07', note: 'thread' },
  'r-1ts5dcl': { label: 'r/ITCareerQuestions, "Is \'too long at helpdesk\' still a thing in the last few years?"', url: 'https://www.reddit.com/r/ITCareerQuestions/comments/1ts5dcl/', date: '2026-05-30', note: 'thread' },
  'r-1xln55v': { label: 'r/ITCareerQuestions, "Struggling to get beyond helpdesk"', url: 'https://www.reddit.com/r/ITCareerQuestions/comments/1xln55v/', date: '2026-11-02', note: 'thread' },
  'r-1ughucy': { label: 'r/sysadmin, "Got promoted from Helpdesk today"', url: 'https://www.reddit.com/r/sysadmin/comments/1ughucy/', date: '2026-06-26', note: 'thread' },
  'r-1q7kzom': { label: 'r/ITCareerQuestions, "Landed an entry level SysAdmin/Helpdesk Role At a Small Business…"', url: 'https://www.reddit.com/r/ITCareerQuestions/comments/1q7kzom/', date: '2026-01-08', note: 'thread' },
}

export const guide = {
  path: '/start/it',
  title: 'Getting into IT help desk work',
  crumbLabel: 'IT help desk',
  eyebrow: 'Guide',
  // The one-sentence answer under the h1 (the page's first screen).
  answer: { text: 'You can start in IT support without a degree, but the door is narrower than it was a few years ago: the field is not growing, and openings come from people leaving or moving on. Here is what employers ask for, which certifications count, and who is hiring now.', src: ['bls-css', 'indeed-data'] },
  metaDescription: 'How to get a first IT help desk job without a degree: the entry roles, what employers ask for, CompTIA A+ and other certifications, what the work pays, free training programs, and live help desk listings near you.',
  asOf: '2026-11-14',
}

// The three readings in the hero: each restates a sourced fact below, with the same sources.
export const tiles = [
  { label: 'Median pay', value: '$61,860', text: 'a year for computer user support specialists, May 2025; a quarter earn under $49,000', src: ['bls-css', 'onet-1232-wages'] },
  { label: 'Projected change', value: '−3%', text: 'in user support jobs, 2025 to 2035, which BLS puts down to automation such as chatbots', src: ['bls-css'] },
  { label: 'Openings a year', value: 'About 48,700', text: 'in computer support, all from people leaving or changing jobs, not from growth', src: ['bls-css'] },
]

// 1. The entry jobs. Cards: a name, what the work is, figures as chips.
export const entryJobs = [
  {
    role: 'Help desk or service desk analyst', aka: 'Also help desk technician, IT support specialist, IT technician',
    what: { text: 'Answers people by phone, chat, email or in person, works out what is wrong and walks them through the fix, and reports problems that keep coming back.', src: ['bls-css', 'onet-1232'] },
    chips: [{ text: 'About 456 calls a month per analyst, in one consulting firm\'s 2023 benchmark', src: ['metricnet'] }],
  },
  {
    role: 'Desktop support technician', aka: 'Also deskside or onsite support',
    what: { text: 'Sets up, repairs and replaces equipment where people work, and shows them how to use it. Fewer requests than a phone desk, each one longer.', src: ['bls-css', 'onet-1232', 'metricnet'] },
    chips: [{ text: 'About 74 tickets a month per technician, in the same benchmark', src: ['metricnet'] }],
  },
  {
    role: 'Network support specialist', aka: 'Also network technician',
    what: { text: 'Tests and maintains an organization\'s networks, often under network and systems administrators. The harder door without a degree: in O*NET\'s survey, 47% of respondents said a new hire needs a bachelor\'s and 22% an associate\'s.', src: ['bls-css', 'onet-1231'] },
    chips: [{ text: 'Median $76,220 a year', src: ['onet-1231-wages', 'bls-css'] }],
  },
]
export const leadsTo = [
  { text: 'BLS names where support specialists move on to: network and computer systems administrator, information security analyst, software developer, or manager in a support department.', src: ['bls-css'] },
  { text: 'People describe the usual climb as help desk, then desktop support or a junior systems administrator job, then systems, network or security work, often after one to four years. Some stay on the help desk by choice.', src: ['r-1vi8fd6', 'r-1ts5dcl', 'r-1xln55v', 'r-1ughucy'], firstHand: true },
]

// 2. What employers ask for (BLS), as a checklist, plus what people who hire say.
export const asks = {
  intro: { text: 'What the Bureau of Labor Statistics says employers typically ask of a user support specialist.', src: ['bls-css'] },
  items: [
    { name: 'Some college, or a diploma plus certifications', text: 'User support jobs typically ask for some college courses, though BLS says candidates may qualify with a high school diploma plus IT certifications. Large software companies may require a bachelor\'s.', src: ['bls-css'] },
    { name: 'No earlier IT job, typically', text: 'BLS lists no related work experience as typical for entry, then moderate-term training on the job.', src: ['bls-css'] },
    { name: 'Customer service', text: 'BLS says support specialists "must be patient and sympathetic." It also lists communication, listening and problem-solving skills.', src: ['bls-css'] },
    { name: 'Shifts that can include nights and weekends', text: 'Most work full time. Because support can be needed around the clock, some work nights or weekends.', src: ['bls-css'] },
  ],
  hirers: { text: 'What people who hire beginners say they look for: customer service, a wish to learn, and real fix stories, such as a home lab or helping people with their computers. In their telling, a certification can get you a callback but not, on its own, the offer.', src: ['r-1v7jxgj', 'r-1x3bg9c'], firstHand: true },
  bridge: { text: 'Retail, call-center and other people-facing jobs count. People describe moving from customer service to a help desk, one at a large tech company, and an outside IT services firm hiring an intern partly for that experience.', src: ['r-1slniik', 'r-1kferni', 'r-1v7jxgj'], firstHand: true },
}

// 3. Certifications: what each exam is (CompTIA's and Google's own pages). No prices: CompTIA's were not readable.
export const certs = {
  intro: { text: 'CompTIA A+ is the one built for this work: CompTIA lists help desk technician and IT support specialist as the roles it prepares you for.', src: ['comptia-a1'] },
  items: [
    { name: 'CompTIA A+', text: 'Two exams, in any order: Core 1 (220-1201, hardware and networking) and Core 2 (220-1202, operating systems and security). Each has up to 90 questions in 90 minutes, including hands-on tasks; the pass marks are 675 and 700 out of 900. CompTIA recommends 12 months in a support role first.', src: ['comptia-aplus', 'comptia-a1', 'comptia-a2'] },
    { name: 'Google IT Support Certificate', text: 'A self-paced online course with no prerequisites: $49 a month on Coursera in the US after a 7-day free trial, about 3 months at 10 hours a week by Coursera\'s estimate. Google says more than 150 U.S. companies have committed to considering its graduates, which is not a promise to hire. Passing A+ as well earns a joint Google and CompTIA credential.', src: ['google-cert', 'coursera-google'] },
    { name: 'CompTIA Network+', text: 'For after the first job: CompTIA recommends A+ plus 9 to 12 months as a junior network administrator or network support technician. One exam (N10-009), up to 90 questions in 90 minutes, pass mark 720 out of 900.', src: ['comptia-net'] },
    { name: 'CompTIA Security+', text: 'Not an entry certification by CompTIA\'s own description: it recommends two years of hands-on work as a security administrator. CompTIA set its new version (SY0-801) to launch on or around November 17, 2026.', src: ['comptia-sec'] },
  ],
  renew: { text: 'CompTIA certifications last 3 years. Renewing A+ means continuing education and a $75 fee per cycle, or passing a higher CompTIA certification that covers it, such as Network+ or Security+.', src: ['comptia-renew', 'comptia-fees', 'comptia-higher'] },
  say: [
    { text: 'Some people describe being hired into help desk with no certification, and some employers put little weight on CompTIA certifications.', src: ['r-1v7jxgj', 'r-1puof6c', 'r-1x3bg9c'], firstHand: true },
    { text: 'Stacking certifications is no shortcut: people holding A+, or A+ and Network+, report a hundred applications or a year of searching without an offer.', src: ['r-1xi60u4', 'r-1u7rbvt'], firstHand: true },
  ],
  defense: { text: 'The Defense Department\'s current rule, Manual 8140.03 (in effect since February 15, 2023), replaced the old 8570 checklist with a choice of education, training or certification. CompTIA lists A+, Network+ and Security+ as approved for technical support work. Read each posting for what it requires.', src: ['dodm-8140', 'comptia-dod'] },
}

// 4. Pay (BLS May 2025 via O*NET; medians and the 10th/90th match the BLS page).
export const payRows = [
  { point: '10th percentile', user: '$40,980 ($19.70/hr)', network: '$47,120 ($22.65/hr)', src: ['onet-1232-wages', 'onet-1231-wages'] },
  { point: '25th percentile', user: '$49,000 ($23.56/hr)', network: '$58,240 ($28.00/hr)', src: ['onet-1232-wages', 'onet-1231-wages'] },
  { point: 'Median', user: '$61,860 ($29.74/hr)', network: '$76,220 ($36.64/hr)', src: ['onet-1232-wages', 'onet-1231-wages', 'bls-css'] },
  { point: '75th percentile', user: '$79,040 ($38.00/hr)', network: '$98,750 ($47.48/hr)', src: ['onet-1232-wages', 'onet-1231-wages'] },
  { point: '90th percentile', user: '$100,540 ($48.34/hr)', network: '$127,780 ($61.43/hr)', src: ['onet-1232-wages', 'onet-1231-wages'] },
]
export const payNote = { text: 'Yearly pay for May 2025 across everyone in the job, beginners and people with years of experience alike. A percentile is the share earning less: a quarter of user support workers earn under $49,000. The median for all U.S. jobs is $50,980.', src: ['onet-1232-wages', 'bls-css'] }
export const payFirst = { text: 'A first job often pays near the bottom of that range: people report starting around $18 to $20 an hour, some on short contracts.', src: ['r-1ndtb2g', 'r-1q7kzom', 'r-1p7vpq2'], firstHand: true }
export const industryRows = [
  { industry: 'Government', median: '$77,180', src: ['bls-css'] },
  { industry: 'Information', median: '$65,400', src: ['bls-css'] },
  { industry: 'Computer systems design and IT services firms', median: '$60,440', src: ['bls-css'] },
  { industry: 'Schools and colleges', median: '$58,550', src: ['bls-css'] },
  { industry: 'Administrative and support services, which includes staffing agencies', median: '$52,100', src: ['bls-css'] },
]
export const industryNote = { text: 'Computer systems design and related services employs the most user support specialists (21%), then education (12%). Of the five, administrative and support services, the industry staffing agencies belong to, pays the least and government the most.', src: ['bls-css'] }

// 5. The market right now, said plainly.
export const market = [
  { text: 'Postings are down. Indeed\'s index of IT infrastructure, operations and support postings stood at 69.4 on November 6, 2026, where February 1, 2020 is 100: about 31% lower, and less than half its June 2022 peak of 159.3. It is up from 63.9 a year earlier.', src: ['indeed-data', 'indeed-q3'] },
  { text: 'Jobs open because people leave. BLS projects user support jobs to fall 3% from 2025 to 2035, about 26,200 fewer, while network support grows 1%; about 48,700 openings a year come from people leaving or changing jobs. CompTIA\'s own projection is roughly flat to 2036.', src: ['bls-css', 'comptia-workforce'] },
  { text: 'Turnover runs high. In a 2023 benchmark by MetricNet, a consulting firm that measures the service desks of its clients in 19 countries, analysts stayed about 28.8 months on average and 43.1% left in a year. It is the firm\'s own sample, not a national count.', src: ['metricnet'] },
]
export const gettingIn = [
  { step: 'Expect volume', text: 'Many report 100 to 500 or more applications, and months to over a year, before the first job.', src: ['r-1ta9chn', 'r-1od833q', 'r-1xi60u4'], firstHand: true },
  { step: 'Take the contract', text: 'First jobs are often contract or contract-to-hire, such as imaging and setting up laptops and Chromebooks.', src: ['r-1ndtb2g', 'r-1p7vpq2'], firstHand: true },
  { step: 'Lead with people skills', text: 'Customer service history and concrete fix stories come up again and again in accounts of who got hired.', src: ['r-1v7jxgj', 'r-1x3bg9c', 'r-1slniik'], firstHand: true },
]

// 6. Free training (each program's own pages). Outcomes only where the program states them plainly.
export const freeTraining = [
  {
    name: 'Per Scholas', url: 'https://perscholas.org/courses/it-support/',
    body: { text: 'A 12-week IT support course at no cost: 35 hours a week of live class plus study time, preparing for A+ and the Google certificate, among others. For adults with a diploma or GED, US work authorization and income under a limit, where it runs; the IT support classes listed in November 2026 were all in northern New Jersey (Newark and Plainfield). It reports an 85% graduation rate and a $54K average salary for graduates of its courses it verified in full-time IT jobs, but no share of all students placed.', src: ['perscholas-course', 'perscholas-elig', 'perscholas-impact'] },
    chips: [{ text: 'No cost', src: ['perscholas-course'] }, { text: '12 weeks, full time', src: ['perscholas-course'] }],
  },
  {
    name: 'Year Up United', url: 'https://www.yearup.org/job-training-programs/new-york/it-support',
    body: { text: 'Tuition-free IT support training with a stipend, then an internship; in most places a one-year, weekday commitment. For ages 18 to 29 with a diploma or GED, low to moderate income and no bachelor\'s degree, near one of its sites. Its own FAQ says the internship is not a sure thing. In a randomized study funded by the federal government, applicants from 2013 and 2014 who were offered a place earned 30% more ($8,251) in year seven than those who were not.', src: ['yearup-students', 'yearup-it', 'yearup-faq', 'opre-yearup'] },
    chips: [{ text: 'Paid stipend', src: ['yearup-faq'] }, { text: 'Ages 18–29', src: ['yearup-faq'] }],
  },
  {
    name: 'NPower Tech Fundamentals', url: 'https://www.npower.org/apply/',
    body: { text: 'Free IT training with virtual classes for listed areas, including Baltimore, New York, Newark, Dallas, Houston and St. Louis. For ages 18 to 26 with a diploma or equivalent, or veterans, military spouses, Guard and Reserve members 21 and over. Its own pages give two different rates for graduates who get jobs or continue their education, so ask for current figures.', src: ['npower-apply', 'npower-home'] },
    chips: [{ text: 'Free', src: ['npower-apply'] }],
  },
  {
    name: 'Registered IT apprenticeships', url: null,
    body: { text: 'A paid job with training, run by an employer. Desktop support and IT generalist are recognized apprenticeship jobs, but the door is small: the Labor Department counted about 6,300 registered apprentices in the whole information technology industry in 2023, in every kind of job, against about 903,100 computer support jobs alone.', src: ['dol-it-fs', 'bls-css'] },
    chips: [],
  },
]

// 7. Before you pay for a course (federal enforcement records).
export const askFirst = { text: 'Ask any paid program four things. Is it a loan? What share of everyone who enrolled, not only those who answered a survey, got an IT job, and how fast? Are its employer partners committed to hire, or only to consider? Who pays for the exam?', src: ['cfpb-bloomtech', 'ftc-careerstep'] }
export const traps = [
  { lead: 'An income share agreement can be a loan.', text: 'In an April 2024 order, the Consumer Financial Protection Bureau (CFPB) found that the coding boot camp BloomTech (formerly Lambda School) told students its income share agreements were not loans; the agency said they were loans, "with an average finance charge of $4,000." A 2021 CFPB order against Better Future Forward, an income share lender, found it had falsely said the same.', src: ['cfpb-bloomtech', 'cfpb-bloomtech-pr', 'cfpb-bff'] },
  { lead: 'A placement rate can be inflated.', text: 'BloomTech advertised that 71 to 86 percent of students were placed in jobs within six months, the CFPB said, while its non-public reports to investors showed rates "closer to 50 percent."', src: ['cfpb-bloomtech-pr', 'cfpb-bloomtech'] },
  { lead: '"Hiring partners" may not hire.', text: 'In July 2024 Career Step, an online healthcare training school, agreed to pay $43.5 million in cash and debt cancellation to settle Federal Trade Commission (FTC) charges. The FTC said its "career placement team" did no job placement, its claim that more than 80% of graduates found work in their field rested on a 2020 survey that only 24% of program completers answered, and the employers it showed as "Hiring Partners" had agreements that had nothing to do with placing graduates.', src: ['ftc-careerstep'] },
]

// FAQ — visible on the page and mirrored in FAQPage JSON-LD (no abbreviations with a full stop: answers are split
// into sentences on ". ").
export const faq = [
  {
    q: 'Can I get an IT help desk job without a degree?',
    a: { text: 'Often, yes. BLS says candidates may qualify with a high school diploma plus IT certifications, and typical entry needs no earlier related job. Large software companies may require a bachelor\'s.', src: ['bls-css'] },
  },
  {
    q: 'Is CompTIA A+ worth getting?',
    a: { text: 'It is the certification CompTIA builds for help desk and IT support roles, and CompTIA lists it as approved for Defense Department technical support work. People who hire say it can get you a callback, not the offer: customer service and real fix stories count more.', src: ['comptia-a1', 'comptia-dod', 'r-1x3bg9c', 'r-1v7jxgj'] },
  },
  {
    q: 'How much does IT support pay?',
    a: { text: 'The median for computer user support specialists was $61,860 a year in May 2025. A quarter earned under $49,000 ($23.56 an hour), and one in ten under $40,980.', src: ['bls-css', 'onet-1232-wages'] },
  },
  {
    q: 'Is IT help desk a growing field?',
    a: { text: 'No. BLS projects user support jobs to shrink 3% from 2025 to 2035, though about 48,700 openings a year still come from people leaving or moving up. Indeed postings for IT infrastructure, operations and support were about 31% below their February 2020 level in November 2026.', src: ['bls-css', 'indeed-data'] },
  },
  {
    q: 'Do I need Security+ for help desk?',
    a: { text: 'Not by CompTIA\'s own description: it recommends two years as a security administrator first. For defense and contractor jobs, CompTIA lists A+, Network+ and Security+ as approved for technical support work, so read each posting.', src: ['comptia-sec', 'comptia-dod'] },
  },
  {
    q: 'Are there free IT training programs?',
    a: { text: 'Yes. Per Scholas and Year Up United run free IT support training for people who meet their age, income and location rules, and NPower runs free virtual classes for listed cities.', src: ['perscholas-course', 'yearup-it', 'npower-apply'] },
  },
]

// ── Listings: the filters on the "Hiring now" block (lib/start/listingFilters.js) ──────────────────────────────────
// Short searches answer best on seenjobs.io (measured 2026-11-14: nationwide "help desk", "service desk",
// "it support", "desktop support" and "systems administrator" each returned 32–60 rows; long forms such as
// "it support technician" returned none). A row is kept only when its title carries an IT word (the gate) AND names
// a position: "technician" alone never counts — pharmacy, HVAC, maintenance and field-service technicians fill the
// same searches. Non-IT help desks (benefits, HR, patient, member services, front desk), sales, recruiters, managers,
// instructors and engineers of other kinds are excluded. Level: the research's rule is that a title never defaults to
// entry (a plain "Help Desk Technician" posting can ask for two years), so a row is entry only when it says so — the
// listing's own "Entry level", intern / trainee / apprentice, or a rung-one "I" title. "Systems administrator" is the
// rung after help desk and reads as experienced unless marked.
const IT_TITLE = '\\b(it|i\\.t\\.|help\\s?-?desk|helpdesk|service\\s?desk|desktop|deskside|end[\\s-]?user|computer|pc|systems?\\s+admin\\w*|sysadmin|information technology|information systems|euc)\\b'
export const listings = {
  defaultRadius: '50',
  radii: ['25', '50', '100', '250'],
  levelMode: 'entryNeedsMarker',
  levelLabels: { any: 'Any level', entry: 'Entry / junior / intern', experienced: 'Experienced / not stated' },
  levelWords: { entry: 'entry-level', experienced: 'experienced' },
  gateTitle: IT_TITLE,
  exclude: '\\b(instructor|instructional|teacher|professor|faculty|trainer|tutor|recruit\\w*|sales|account executive|business development|manager|director|marketing|pharmacy|hvac|maintenance|automotive|diesel|biomedical|dental|veterinary|patient|benefits|hr|human resources|payroll|member services|front desk|front office|service advisor|low voltage|electrician|mechanic|developer|programmer|software|architect|scientist|data analyst|business analyst|security analyst|accounting|gtm|ukg|workday|salesforce|arcgis|audit\\w*|virtual desktop)\\b|\\b(network|systems?|cloud|devops|security|sales|solutions?|data|platform|infrastructure|site reliability|field|technical support)\\s+engineer',
  positions: [
    { id: 'all', label: 'All IT support', noun: 'IT support', mix: 'positions', queries: ['help desk', 'service desk', 'it support', 'desktop support'] },
    { id: 'help-desk', label: 'Help desk / service desk', noun: 'help desk and service desk', match: 'help\\s?-?desk|helpdesk|service\\s?desk', queries: ['help desk', 'service desk'] },
    { id: 'it-support', label: 'IT support specialist', noun: 'IT support', match: '\\b(?:it|computer|pc|end[\\s-]?user)\\s+(?:user\\s+)?support\\b|\\b(?:it|computer|pc)\\s+(?:technician|tech|specialist)\\b', queries: ['it support', 'it technician'] },
    { id: 'desktop', label: 'Desktop support', noun: 'desktop support', match: 'desktop|deskside|end[\\s-]?user comput|\\beuc\\b', queries: ['desktop support'] },
    { id: 'sysadmin', label: 'Systems administrator', noun: 'systems administrator', match: '\\bsystems?\\s+admin\\w*|sysadmin', queries: { any: ['systems administrator', 'junior systems administrator'], entry: ['junior systems administrator', 'systems administrator'], experienced: ['systems administrator'] } },
  ],
}

// ── The page's openable rows ──────────────────────────────────────────────────────────────────────────────────────
export const menu = [
  {
    id: 'entry-jobs', title: 'The entry jobs', summary: 'Help desk, desktop support, and what is next',
    blocks: [
      { type: 'cards', items: entryJobs.map((j) => ({ name: j.role, aka: j.aka, body: j.what, chips: j.chips })) },
      { type: 'heading', text: 'Where it leads' },
      { type: 'notes', items: leadsTo },
    ],
  },
  {
    id: 'what-they-ask', title: 'What employers ask for', summary: 'Schooling, experience, customer service',
    blocks: [
      { type: 'text', entry: asks.intro },
      { type: 'checklist', items: asks.items, cols: true },
      { type: 'callout', entry: asks.hirers },
      { type: 'more', title: 'Customer service is the usual bridge', blocks: [
        { type: 'text', entry: asks.bridge },
        { type: 'resumeLink', before: 'Before you apply, you can', label: 'check your résumé against a posting' },
      ] },
    ],
  },
  {
    id: 'certifications', title: 'Certifications', summary: 'Which ones count, and what each exam is',
    blocks: [
      { type: 'text', entry: certs.intro },
      { type: 'checklist', items: certs.items },
      { type: 'note', entry: certs.renew },
      { type: 'more', title: 'What people who hire and job seekers say', blocks: [
        { type: 'text', plain: 'Several accounts agree on each of these.' },
        { type: 'notes', items: certs.say },
      ] },
      { type: 'more', title: 'Defense and government contractor jobs', blocks: [{ type: 'text', entry: certs.defense }] },
    ],
  },
  {
    id: 'pay', title: 'Pay', summary: 'What the work pays, and where it pays more',
    blocks: [
      { type: 'table', caption: 'Yearly pay for computer support specialists', columns: [{ key: 'point', label: 'Pay point' }, { key: 'user', label: 'User support', num: true }, { key: 'network', label: 'Network support', num: true }], rows: payRows },
      { type: 'note', entry: payNote },
      { type: 'text', entry: payFirst, lead: 'From people who got in:' },
      { type: 'more', title: 'Where the jobs are, and what each pays', blocks: [
        { type: 'table', caption: 'Median pay for user support specialists by industry', columns: [{ key: 'industry', label: 'Industry' }, { key: 'median', label: 'Median, yearly', num: true }], rows: industryRows },
        { type: 'text', entry: industryNote },
      ] },
    ],
  },
  {
    id: 'hiring-now', title: 'Hiring right now', summary: 'Fewer postings, steady turnover',
    blocks: [
      { type: 'notes', items: market },
      { type: 'heading', text: 'What getting in takes' },
      { type: 'text', plain: 'What people who got in say. Several accounts agree on each of these.' },
      { type: 'steps', items: gettingIn },
    ],
  },
  {
    id: 'free-training', title: 'Free training', summary: 'Programs that cost nothing, and who can join',
    blocks: [{ type: 'cards', items: freeTraining.map((f) => ({ name: f.name, body: f.body, link: f.url, chips: f.chips })) }],
  },
  {
    id: 'watch-out', title: 'Before you pay for a course', icon: 'caution', summary: 'Placement claims, and loans by another name',
    blocks: [
      { type: 'callout', entry: askFirst },
      { type: 'disclosures', items: traps },
    ],
  },
  { id: 'questions', title: 'Common questions', summary: 'Degree, A+, pay, growth, free training', blocks: [{ type: 'faq', items: faq }] },
]

// ── Additional resources: every reference above, as plain grouped links ──────────────────────────────────────────
export const resourcesSummary = 'Pay data, certifications, free programs'
export const resources = [
  { title: 'Pay and jobs data', items: [
    { key: 'bls-css', name: 'Computer support specialists (Bureau of Labor Statistics)' },
    { key: 'onet-1232-wages', name: 'User support specialist wages (O*NET)' },
    { key: 'onet-1231-wages', name: 'Network support specialist wages (O*NET)' },
    { key: 'onet-1232', name: 'User support specialist job titles (O*NET)' },
    { key: 'onet-1231', name: 'Network support specialist education (O*NET)' },
    { key: 'indeed-data', name: 'Job postings by sector (Indeed Hiring Lab data)' },
    { key: 'indeed-q3', name: 'Tech labor market update, third quarter (Indeed Hiring Lab)' },
    { key: 'comptia-workforce', name: 'State of the Tech Workforce (CompTIA)' },
    { key: 'metricnet', name: 'IT service and support benchmarks (MetricNet)' },
  ] },
  { title: 'Certifications', items: [
    { key: 'comptia-aplus', name: 'CompTIA A+ overview' },
    { key: 'comptia-a1', name: 'CompTIA A+ Core 1' },
    { key: 'comptia-a2', name: 'CompTIA A+ Core 2' },
    { key: 'comptia-net', name: 'CompTIA Network+' },
    { key: 'comptia-sec', name: 'CompTIA Security+' },
    { key: 'comptia-renew', name: 'CompTIA certification renewal policy' },
    { key: 'comptia-fees', name: 'CompTIA renewal fees' },
    { key: 'comptia-higher', name: 'Renewing CompTIA certifications with a higher one' },
    { key: 'google-cert', name: 'Google IT Support Certificate' },
    { key: 'coursera-google', name: 'Google IT Support Certificate on Coursera' },
    { key: 'comptia-dod', name: 'Which CompTIA certifications the Defense Department accepts' },
    { key: 'dodm-8140', name: 'Defense Department workforce qualification manual' },
  ] },
  { title: 'Free training', items: [
    { key: 'perscholas-course', name: 'Per Scholas IT Support course' },
    { key: 'perscholas-elig', name: 'Per Scholas eligibility' },
    { key: 'perscholas-impact', name: 'Per Scholas outcomes' },
    { key: 'yearup-it', name: 'Year Up United IT Support program' },
    { key: 'yearup-students', name: 'Year Up United tuition and stipend' },
    { key: 'yearup-faq', name: 'Year Up United student questions' },
    { key: 'opre-yearup', name: 'Long-term study of Year Up (Administration for Children and Families)' },
    { key: 'npower-apply', name: 'NPower Tech Fundamentals' },
    { key: 'npower-home', name: 'NPower outcome figures' },
    { key: 'dol-it-fs', name: 'IT apprenticeships fact sheet (U.S. Department of Labor)' },
  ] },
  { title: 'Before you pay', items: [
    { key: 'cfpb-bloomtech', name: 'BloomTech enforcement action (Consumer Financial Protection Bureau)' },
    { key: 'cfpb-bloomtech-pr', name: 'BloomTech press release (Consumer Financial Protection Bureau)' },
    { key: 'cfpb-bff', name: 'Better Future Forward enforcement action (Consumer Financial Protection Bureau)' },
    { key: 'ftc-careerstep', name: 'Career Step settlement (Federal Trade Commission)' },
  ] },
  { title: 'Community discussions', items: [
    { key: 'r-1ta9chn', name: 'How many applications a first IT job took' },
    { key: 'r-1ndtb2g', name: 'A first IT job after a long search' },
    { key: 'r-1od833q', name: 'Landing a job after many rejections' },
    { key: 'r-1xi60u4', name: 'Applying to help desk jobs with A+' },
    { key: 'r-1u7rbvt', name: 'Still searching after Network+ and A+' },
    { key: 'r-1p7vpq2', name: 'A first IT job on a contract' },
    { key: 'r-1v7jxgj', name: 'What makes hiring managers interview a beginner' },
    { key: 'r-1x3bg9c', name: 'Certifications without a tech background' },
    { key: 'r-1puof6c', name: 'Employers that put little weight on CompTIA certifications' },
    { key: 'r-1slniik', name: 'An internship at a local IT firm' },
    { key: 'r-1kferni', name: 'From customer service to help desk' },
    { key: 'r-1vi8fd6', name: 'How help desk pay grows' },
    { key: 'r-1ts5dcl', name: 'Staying on the help desk' },
    { key: 'r-1xln55v', name: 'Getting beyond help desk' },
    { key: 'r-1ughucy', name: 'Promoted from help desk' },
    { key: 'r-1q7kzom', name: 'A small-business help desk job' },
  ] },
]

/** Every fact on the page, in reading order: the hero, then each menu row. */
export function pageEntries() {
  return [guide.answer, ...tiles, ...blockEntries(menu)]
}
