// /start/restaurants — "Getting into restaurant work". The page renders from this module only, so every figure on it
// carries a reference and an as-of date (lib/start/guides.test.mjs fails on a figure without one).
//
// THE ONLY SOURCE OF FACTS is the research file compiled 2026-11-17 (session scratchpad guides20/restaurants/research.md).
// Rules this module keeps:
//   • only items the research marked VERIFIED (BLS and its OEWS data on O*NET, the Labor Department's Wage and Hour
//     Division, state and county health departments, state law, ServSafe's own store, employers' own postings and
//     careers pages, the FTC);
//   • FIRST-HAND items (several accounts agreeing) only as `firstHand: true`, said as what people say, never as fact;
//   • nothing from the research's UNVERIFIED / CONFLICTING list: no Texas "60 days" (the 2021 rule says 30), no
//     "employers in California need not pay" (an old county FAQ, superseded), no bill number for the California
//     employer-pays rule (the statute page could not be read; LA County's 2025 sheet states the rule), no Utah, New
//     Mexico, Arizona, Nevada or Hawaii card rules, no single "normal" tip-out percentage, no Starbucks or McDonald's
//     pay, no restaurant-specific burn or cut count;
//   • the tipped wage is the DOL table revised November 5, 2026, said with that date; medians are May 2025 and
//     national, and servers' median is said to include tips (BLS says so); an average is never shown as starting pay;
//   • no hype, no guarantees, no exclamation marks; the injury rate is stated plainly.
//
// Shape: `sources` (every reference behind the page, kept here and never printed as citations — readers reach the
// links through the grouped "Additional resources" menu, `resources` below), entries `{ text, src, firstHand? }`, the
// listings filter config (`listings`, lib/start/listingFilters.js) and the openable menu rows (`menu`, rendered by
// components/start/Guide.tsx). Pure data; relative imports only so `node --test` runs it as is.

import { blockEntries } from './entries.js'

/** @typedef {{ label: string, url: string, date: string, note?: string }} Source */

/** @type {Record<string, Source>} */
export const sources = {
  'bls-cooks': { label: 'U.S. Bureau of Labor Statistics, Occupational Outlook Handbook: Cooks (May 2025 pay, 2025–35 outlook)', url: 'https://www.bls.gov/ooh/food-preparation-and-serving/cooks.htm', date: '2026-09-14', note: 'page updated' },
  'bls-waiters': { label: 'BLS Occupational Outlook Handbook: Waiters and Waitresses (May 2025 pay, including tips)', url: 'https://www.bls.gov/ooh/food-preparation-and-serving/waiters-and-waitresses.htm', date: '2026-08-27', note: 'page updated' },
  'bls-fbs': { label: 'BLS Occupational Outlook Handbook: Food and Beverage Serving and Related Workers (hosts, bussers, fast food and counter workers)', url: 'https://www.bls.gov/ooh/food-preparation-and-serving/food-and-beverage-serving-and-related-workers.htm', date: '2026-08-27', note: 'page updated' },
  'bls-prep': { label: 'BLS Occupational Outlook Handbook: Food Preparation Workers (May 2025 pay by industry, injuries)', url: 'https://www.bls.gov/ooh/food-preparation-and-serving/food-preparation-workers.htm', date: '2026-08-27', note: 'page updated' },
  'bls-fsm': { label: 'BLS Occupational Outlook Handbook: Food Service Managers (May 2025 pay, how they get the job)', url: 'https://www.bls.gov/ooh/management/food-service-managers.htm', date: '2026-10-29', note: 'page updated' },
  'bls-iag722': { label: 'BLS Industries at a Glance: Food Services and Drinking Places, NAICS 722 (hours and earnings, 2024 injury rates)', url: 'https://www.bls.gov/iag/tgs/iag722.htm', date: '2026-11-17', note: 'read' },
  'bls-osh': { label: 'BLS news release, Employer-Reported Workplace Injuries and Illnesses – 2023-2024 (private industry rate for 2024)', url: 'https://www.bls.gov/news.release/osh.nr0.htm', date: '2026-01-22', note: 'released' },
  'onet-dish': { label: 'O*NET OnLine: Dishwashers, 35-9021.00 (tasks; median wage, 2025 BLS data)', url: 'https://www.onetonline.org/link/summary/35-9021.00', date: '2026-11-17', note: 'read' },
  'onet-barista': { label: 'O*NET OnLine: Baristas, 35-3023.01 (wages from the broader fast food and counter workers occupation, 2025 BLS data)', url: 'https://www.onetonline.org/link/summary/35-3023.01', date: '2026-11-17', note: 'read' },
  'onet-sup': { label: 'O*NET OnLine: First-Line Supervisors of Food Preparation and Serving Workers, 35-1012.00 (median wage, 2025 BLS data)', url: 'https://www.onetonline.org/link/summary/35-1012.00', date: '2026-11-17', note: 'read' },
  'dol-tipped': { label: 'U.S. Department of Labor, Wage and Hour Division: Minimum Wages for Tipped Employees, by state (revised November 5, 2026)', url: 'https://www.dol.gov/agencies/whd/state/minimum-wage/tipped', date: '2026-11-05', note: 'revised' },
  'dol-fs15': { label: 'U.S. Department of Labor, Fact Sheet #15: Tipped Employees Under the Fair Labor Standards Act', url: 'https://www.dol.gov/agencies/whd/fact-sheets/15-tipped-employees-flsa', date: '2026-11-17', note: 'read' },
  'dol-fs2a': { label: 'U.S. Department of Labor, Fact Sheet #2A: Child Labor Provisions for Restaurants and Quick-Service Establishments', url: 'https://www.dol.gov/agencies/whd/fact-sheets/2a-child-labor-restaurants', date: '2010-07', note: 'revised' },
  'ca-sonoma': { label: 'Sonoma County Environmental Health, California food handler card (30 days, three years, ANSI-accredited class)', url: 'https://sonomacounty.ca.gov/Health/Environmental-Health/Food-Program/Food-Handler-Card/', date: '2026-11-17', note: 'read' },
  'ca-la': { label: 'Los Angeles County Public Health, California Food Handler Card fact sheet (who pays, where accepted), May 2025', url: 'https://publichealth.lacounty.gov/eh/docs/business/ca-food-handler-card-en.pdf', date: '2025-05', note: 'published' },
  'tx-dshs': { label: 'Texas Department of State Health Services, food handler training FAQ (Texas Food Establishment Rules §228.31)', url: 'https://www.dshs.texas.gov/licensing-food-handler-training-programs/frequently-asked-questions-food-handler-education-or-training-programs', date: '2026-11-17', note: 'read' },
  'il-idph': { label: 'Illinois Department of Public Health, food handler training', url: 'https://dph.illinois.gov/topics-services/food-safety/food-handler-training.html', date: '2026-11-17', note: 'read' },
  'wa-doh': { label: 'Washington State Department of Health, food worker card', url: 'https://doh.wa.gov/community-and-environment/food/food-worker-and-industry/food-worker-card', date: '2026-11-17', note: 'read' },
  'or-oha': { label: 'Oregon Health Authority, food handler cards (approved providers, fake courses)', url: 'https://www.oregon.gov/oha/ph/healthyenvironments/foodsafety/pages/cert.aspx', date: '2026-11-17', note: 'read' },
  'fl-509': { label: 'Florida Statutes 2026, section 509.049, food service employee training', url: 'https://www.leg.state.fl.us/Statutes/index.cfm?App_mode=Display_Statute&URL=0500-0599%2F0509%2FSections%2F0509.049.html', date: '2026-11-17', note: 'read' },
  'servsafe-fh': { label: 'ServSafe (National Restaurant Association) store: ServSafe Food Handler online course and assessment', url: 'https://www.servsafe.com/access/ss/Catalog/ProductList/22', date: '2026-11-17', note: 'read' },
  'servsafe-mgr': { label: 'ServSafe store: ServSafe Manager courses and exams', url: 'https://www.servsafe.com/access/ss/Catalog/ProductList/10', date: '2026-11-17', note: 'read' },
  'servsafe-exam': { label: 'ServSafe Manager Exam (Online Proctor): Food Protection Manager Certification, ANAB-accredited, valid five years', url: 'https://www.servsafe.com/access/SS/Catalog/ProductDetail/SSONLINEXREM', date: '2026-11-17', note: 'read' },
  'chipotle-arvada': { label: 'Chipotle posting 102302638160, Crew Member, Arvada, CO (posted 2026-10-22; own careers site)', url: 'https://jobs.chipotle.com/job/arvada/crew-member/282/102302638160', date: '2026-11-17', note: 'read' },
  'chipotle-nyc': { label: 'Chipotle posting 71245338192, Crew Member, New York, NY (posted 2026-11-17; own careers site)', url: 'https://jobs.chipotle.com/job/new-york/crew-member/282/71245338192', date: '2026-11-17', note: 'read' },
  'chipotle-cos': { label: 'Chipotle posting 71245349024, Crew Member, Colorado Springs, CO (posted 2026-11-17; own careers site)', url: 'https://jobs.chipotle.com/job/colorado-springs/crew-member/282/71245349024', date: '2026-11-17', note: 'read' },
  'chipotle-crew': { label: 'Chipotle posting 92138220688, Crew, Goodyear, AZ (posted 2026-02-25; requirements, training, benefits; own careers site)', url: 'https://jobs.chipotle.com/job/goodyear/crew/282/92138220688', date: '2026-11-17', note: 'read' },
  'starbucks-leaders': { label: 'Starbucks careers: coffeehouse jobs, barista to store manager', url: 'https://careers.starbucks.com/discover-opportunities/retail/', date: '2026-11-17', note: 'read' },
  'starbucks-benefits': { label: 'Starbucks careers: benefits (education)', url: 'https://careers.starbucks.com/benefits/', date: '2026-11-17', note: 'read' },
  'sweetgreen-phl': { label: 'sweetgreen posting 7985160, Assistant Coach (Assistant General Manager), Philadelphia, PA (updated 2026-08-19; own careers site)', url: 'https://careers.sweetgreen.com/jobs/7985160?gh_jid=7985160', date: '2026-11-17', note: 'read' },
  'ftc-scams': { label: 'Federal Trade Commission, Job Scams (consumer advice)', url: 'https://consumer.ftc.gov/articles/job-scams', date: '2023-03', note: 'article dated' },
  // First-hand accounts (Reddit threads read through the Arctic Shift archive on 2026-11-17). Used only where several
  // accounts agree, and rendered as what people say, never as fact.
  'r-kc-start': { label: 'r/KitchenConfidential, how cooks got into kitchens', url: 'https://www.reddit.com/r/KitchenConfidential/comments/1otg7hx/', date: '2026-11-17', note: 'thread read' },
  'r-chefit-noexp': { label: 'r/Chefit, a kitchen job with no prior experience', url: 'https://www.reddit.com/r/Chefit/comments/1rizaqi/', date: '2026-11-17', note: 'thread read' },
  'r-chefit-cantget': { label: 'r/Chefit, "I cannot get a job in a restaurant"', url: 'https://www.reddit.com/r/Chefit/comments/1rl2npq/', date: '2026-11-17', note: 'thread read' },
  'r-chefit-first': { label: 'r/Chefit, getting a first kitchen job and asking for a stage', url: 'https://www.reddit.com/r/Chefit/comments/1qeu1z6/', date: '2026-11-17', note: 'thread read' },
  'r-server-fine': { label: 'r/Serverlife, getting hired as a server without experience', url: 'https://www.reddit.com/r/Serverlife/comments/1pxy3oc/', date: '2026-11-17', note: 'thread read' },
  'r-tipout1': { label: 'r/Serverlife, what servers tip out to the bar', url: 'https://www.reddit.com/r/Serverlife/comments/1q3954d/', date: '2026-11-17', note: 'thread read' },
  'r-tipout2': { label: 'r/Serverlife, tip-outs to bartenders and runners', url: 'https://www.reddit.com/r/Serverlife/comments/1q8wrm2/', date: '2026-11-17', note: 'thread read' },
  'r-burns': { label: 'r/KitchenConfidential, living with small kitchen burns', url: 'https://www.reddit.com/r/KitchenConfidential/comments/1p496jw/', date: '2026-11-17', note: 'thread read' },
  'r-cuts1': { label: 'r/Chefit, how often cooks cut themselves', url: 'https://www.reddit.com/r/Chefit/comments/1rxtc08/', date: '2026-11-17', note: 'thread read' },
  'r-cuts2': { label: 'r/Chefit, knife cuts over a career', url: 'https://www.reddit.com/r/Chefit/comments/1uhok1l/', date: '2026-11-17', note: 'thread read' },
  'r-barista-noexp': { label: 'r/barista, getting a barista job with no experience', url: 'https://www.reddit.com/r/barista/comments/1v4nfu5/', date: '2026-11-17', note: 'thread read' },
  'r-barista-interview': { label: 'r/barista, an interview with no experience', url: 'https://www.reddit.com/r/barista/comments/1rp2cx1/', date: '2026-11-17', note: 'thread read' },
  'r-open1': { label: 'r/barista, sleeping for early opening shifts', url: 'https://www.reddit.com/r/barista/comments/1ssmewt/', date: '2026-11-17', note: 'thread read' },
  'r-open2': { label: 'r/barista, going to bed early before opening shifts', url: 'https://www.reddit.com/r/barista/comments/1vvs7qu/', date: '2026-11-17', note: 'thread read' },
  'r-hours1': { label: 'r/Chefit, whether 60-hour weeks are normal for chefs', url: 'https://www.reddit.com/r/Chefit/comments/1q1sd61/', date: '2026-11-17', note: 'thread read' },
  'r-hours2': { label: 'r/Chefit, 14-hour days at a restaurant opening', url: 'https://www.reddit.com/r/Chefit/comments/1s9lm27/', date: '2026-11-17', note: 'thread read' },
}

export const guide = {
  path: '/start/restaurants',
  title: 'Getting into restaurant work',
  crumbLabel: 'Restaurant work',
  eyebrow: 'Guide',
  // The one-sentence answer under the h1 (the page's first screen).
  answer: { text: 'Most restaurant jobs take people with no experience and train them on the job in days or weeks; the hours are often part time, early or late, and on weekends. Here is what each job pays, how tips and food handler cards work, and who is hiring now.', src: ['bls-fbs', 'bls-waiters', 'bls-cooks'] },
  metaDescription: 'How to get a restaurant job with no experience: dishwasher, prep and line cook, host, server, barista and crew jobs, what each pays, the tipped minimum wage and tip pool rules, food handler cards by state, live restaurant listings near you, and scams to avoid.',
  asOf: '2026-11-17',
}

// The three readings in the hero: each restates a referenced fact below, with the same references.
export const tiles = [
  { label: 'Median pay', value: '$15.00–$17.98', text: 'an hour, May 2025: from hosts and fast food and counter workers to restaurant cooks; servers’ $16.94 median counts their tips', src: ['bls-fbs', 'bls-cooks', 'bls-waiters'] },
  { label: 'Tipped minimum', value: '$2.13 an hour', text: 'the lowest federal cash wage for a tipped worker; tips must bring it to at least $7.25, and seven states require their full minimum wage before tips', src: ['dol-tipped', 'dol-fs15'] },
  { label: 'Openings a year', value: 'About 1.9 million', text: 'projected each year, 2025–35: cooks (393,200), servers (423,100), and counter, host and busser jobs (1,078,500)', src: ['bls-cooks', 'bls-waiters', 'bls-fbs'] },
]

// 1. The jobs: a name, one line, and the referenced figures as chips (national medians, May 2025).
export const jobs = [
  {
    role: 'Crew member or cashier', aka: 'Also team member, counter worker',
    what: { text: 'Takes orders, makes or fetches the food and takes payment. Chipotle trains its crew at every station: grill, cashier, prep, salsa and expo.', src: ['bls-fbs', 'chipotle-crew'] },
    chips: [{ text: '$15.00/hr median, fast food and counter workers', src: ['bls-fbs'] }],
  },
  {
    role: 'Dishwasher', aka: 'Also dish machine operator, kitchen steward, utility',
    what: { text: 'Washes dishes, glassware, pots and pans by machine or by hand, keeps the kitchen clean and puts supplies away.', src: ['onet-dish'] },
    chips: [{ text: '$16.73/hr median', src: ['onet-dish'] }],
  },
  {
    role: 'Prep cook', aka: 'Also food preparation worker, kitchen helper',
    what: { text: 'Gets food ready before and during service and keeps stations clean. Training usually lasts several weeks, taught by an experienced worker.', src: ['bls-prep'] },
    chips: [{ text: '$16.67/hr median in restaurants', src: ['bls-prep'] }],
  },
  {
    role: 'Line cook', aka: 'Also grill cook, short order cook',
    what: { text: 'Cooks the orders during service. Cooks typically need no formal education and learn on the job.', src: ['bls-cooks'] },
    chips: [{ text: 'Restaurant cooks: $17.98/hr median', src: ['bls-cooks'] }, { text: 'Fast food cooks: $14.85/hr median', src: ['bls-cooks'] }],
  },
  {
    role: 'Host or busser', aka: 'Also greeter, dining room attendant',
    what: { text: 'Hosts greet guests, seat them and keep the waiting list. Bussers clean and set tables, clear dirty dishes and restock, supporting servers and bartenders.', src: ['bls-fbs'] },
    chips: [{ text: 'Hosts: $15.00/hr median', src: ['bls-fbs'] }, { text: 'Bussers: $16.34/hr median', src: ['bls-fbs'] }],
  },
  {
    role: 'Server', aka: 'Also waiter, waitress',
    what: { text: 'Takes orders and serves food and drinks, on your feet the whole shift and often carrying heavy trays. Training on the job usually lasts a month or less.', src: ['bls-waiters'] },
    chips: [{ text: '$16.94/hr median, tips included', src: ['bls-waiters'] }],
  },
  {
    role: 'Barista', aka: 'Also coffee shop crew',
    what: { text: 'Makes and serves coffee drinks. BLS counts baristas with fast food and counter workers, so the pay figure is that whole group’s.', src: ['onet-barista'] },
    chips: [{ text: '$15.00/hr median, fast food and counter workers', src: ['onet-barista', 'bls-fbs'] }],
  },
  {
    role: 'Shift lead or kitchen manager', aka: 'After time on the job',
    what: { text: 'Runs a shift, a kitchen or a whole restaurant. Most food service managers start in jobs like cook or server and work up.', src: ['bls-fsm'] },
    chips: [{ text: 'Supervisors: $21.19/hr median', src: ['onet-sup'] }, { text: 'Managers: $33.36/hr median', src: ['bls-fsm'] }],
  },
]

// Pay stated on employers' own postings (read November 2026).
export const postedPay = [
  { employer: 'Chipotle, Arvada, CO', role: 'Crew member', pay: '$18.50–$19.50/hr, plus digital tips', src: ['chipotle-arvada'] },
  { employer: 'Chipotle, New York, NY', role: 'Crew member', pay: '$17.00–$18.00/hr', src: ['chipotle-nyc'] },
  { employer: 'Chipotle, Colorado Springs, CO', role: 'Crew member', pay: '$15.50–$16.50/hr', src: ['chipotle-cos'] },
  { employer: 'sweetgreen, Philadelphia, PA', role: 'Assistant manager', pay: '$55,000–$65,000 a year', src: ['sweetgreen-phl'] },
]
export const postedPayNote = { text: 'Base pay stated on each posting, read in November 2026. A posting is one location’s rate, not what every location pays; pay tracks the local minimum wage, which is $17.00 in New York City.', src: ['chipotle-arvada', 'chipotle-nyc', 'chipotle-cos', 'sweetgreen-phl', 'dol-tipped'] }
export const outlook = { text: 'Cook jobs are projected to grow 7% from 2025 to 2035, counter, host and busser jobs 5% and server jobs 2%; food preparation jobs are projected to shrink 3%.', src: ['bls-cooks', 'bls-fbs', 'bls-waiters', 'bls-prep'] }

// 2. Tips and the tipped wage (federal law, DOL Fact Sheet #15; state table revised November 5, 2026).
export const tipCallout = { text: 'Under federal law, a restaurant can pay a tipped worker as little as $2.13 an hour in cash, as long as tips bring the total to at least $7.25. Many states require more.', src: ['dol-fs15', 'dol-tipped'] }
export const tipRules = [
  { name: 'Short on tips, the employer pays', text: 'If $2.13 plus your tips comes to less than $7.25 an hour in a week, the employer must make up the difference on payday.', src: ['dol-fs15'] },
  { name: 'The better law wins', text: 'When state law and federal law differ, the employer must follow the one that protects you more.', src: ['dol-fs15'] },
  { name: 'Tip pools', text: 'You can be required to share tips with other tipped staff, such as bussers and service bartenders. Cooks and dishwashers can share only when everyone is paid at least the full federal minimum wage in cash.', src: ['dol-fs15'] },
  { name: 'No share for managers', text: 'Employers, managers and supervisors cannot take any part of your tips or the pool. A manager who serves tables may keep only the tips from those tables.', src: ['dol-fs15'] },
  { name: 'Tips paid by card', text: 'On a tip paid by card, the employer may take out no more than the card company’s fee, and must pay it by the regular payday.', src: ['dol-fs15'] },
  { name: 'Service charges', text: 'A required charge, such as 15 percent of the bill, is not a tip under federal law; money paid out from it can count toward your wage.', src: ['dol-fs15'] },
]
export const tipStates = [
  { name: 'Full minimum wage before tips', text: 'Alaska, California, Minnesota, Montana, Nevada, Oregon and Washington. Washington’s is $17.13 an hour and California’s $16.90.', src: ['dol-tipped'] },
  { name: 'More than $2.13', text: 'Most other states, for example Arizona $12.15, Colorado $12.14, Florida $11.98, Illinois $9.00, Massachusetts $6.75 and Pennsylvania $2.83. New York’s varies by region and type of employer.', src: ['dol-tipped'] },
  { name: 'The federal $2.13', text: 'Alabama, Georgia, Indiana, Kansas, Kentucky, Louisiana, Mississippi, Nebraska, North Carolina, South Carolina, Tennessee, Texas, Utah, Virginia and Wyoming.', src: ['dol-tipped'] },
]
export const tipStatesNote = { text: 'Cash wages from the Labor Department’s state table revised November 5, 2026. Some cities set higher rates than their state.', src: ['dol-tipped'] }
export const tipOutPeopleSay = { text: 'Servers describe tipping out bartenders, bussers and food runners at the end of a shift, usually as a share of their sales, and say the share varies a lot from one restaurant to the next.', src: ['r-tipout1', 'r-tipout2'], firstHand: true }

// 3. Food handler cards and ServSafe.
export const cardIntro = { text: 'Several states require people who handle food to take a short food safety course and pass a test, often online, for a food handler card. Rules differ by state, and some counties run their own card.', src: ['ca-la', 'il-idph', 'tx-dshs', 'wa-doh'] }
export const cardStates = [
  { state: 'California', when: 'Within 30 days of hire', valid: '3 years', note: 'Employer repays your time and cost. Riverside, San Bernardino and San Diego counties have their own card.', src: ['ca-sonoma', 'ca-la'] },
  { state: 'Florida', when: 'Within 60 days', valid: '3 years', note: 'The restaurant must provide the training.', src: ['fl-509'] },
  { state: 'Illinois', when: 'Generally within 30 days', valid: 'May need renewal every 3 years', note: 'ANSI-accredited course for restaurant workers.', src: ['il-idph'] },
  { state: 'Oregon', when: 'Within 30 days', valid: '3 years', note: '$10. Cards from other states are not accepted.', src: ['or-oha'] },
  { state: 'Texas', when: 'Within 30 days', valid: '2 years if no date is printed', note: 'A course accredited by the state or ANSI; online is allowed.', src: ['tx-dshs'] },
  { state: 'Washington', when: 'Before work, or within 14 days if your employer trains you', valid: 'First card 2 years', note: '$10. Online only at foodworkercard.wa.gov.', src: ['wa-doh'] },
]
export const cardElsewhere = { text: 'These are rules from each state’s own health department or law. Elsewhere, ask the restaurant or your county health department, since counties and cities can set their own.', src: ['ca-la', 'il-idph'] }
export const servsafe = { text: 'ServSafe, run by the National Restaurant Association, sells its Food Handler online course and assessment for $15. A card from any course counts only where your state accepts it.', src: ['servsafe-fh', 'wa-doh', 'or-oha'] }
export const fakeCourses = { text: 'Washington accepts online cards only from foodworkercard.wa.gov, and Oregon warns of "fake online courses saying they are approved in Oregon that are not."', src: ['wa-doh', 'or-oha'] }

// 4. The work itself.
export const work = [
  { name: 'Part time, early and late', text: 'Schedules "may include early mornings, late evenings, weekends, and holidays," BLS says. Hourly restaurant and bar workers averaged 23.7 hours a week in September 2026.', src: ['bls-cooks', 'bls-waiters', 'bls-iag722'] },
  { name: 'On your feet all shift', text: 'Serving workers "spend most of their shift on their feet," carry heavy trays, and may need to lift stock and equipment of up to 50 pounds.', src: ['bls-fbs'] },
  { name: 'Slips, cuts and burns', text: 'BLS says food preparation workers have "one of the highest rates of injuries and illnesses of all occupations." Across restaurants and bars, employers recorded 2.4 cases per 100 full-time workers in 2024, against 2.3 in all private industry.', src: ['bls-prep', 'bls-fbs', 'bls-iag722', 'bls-osh'] },
]
export const injuryPeopleSay = { text: 'Cooks describe small burns from oven racks and sheet pans as constant at first, and say most of their cuts come from foil, plastic-wrap cutters and can lids rather than knives.', src: ['r-burns', 'r-cuts1', 'r-cuts2'], firstHand: true }
export const openingPeopleSay = { text: 'Baristas describe opening shifts that start around 4:30 to 5:30 in the morning, and going to bed early to make them.', src: ['r-open1', 'r-open2'], firstHand: true }
export const youth = [
  { name: 'Ages 14 and 15', text: 'Outside school hours only: up to 3 hours on a school day, 8 on other days, 18 in a school week and 40 in a week off school, between 7 a.m. and 7 p.m. (9 p.m. from June 1 to Labor Day).', src: ['dol-fs2a'] },
  { name: 'What they can do', text: 'Cashier, wait and bus tables, clean, and simple cooking on grills with no open flame or on fryers that raise and lower the baskets on their own. No baking, slicers or mixers.', src: ['dol-fs2a'] },
  { name: 'Ages 16 and 17', text: 'Any hours under federal law, but no meat slicers, grinders, commercial mixers or certain bakery machines, and no time-sensitive deliveries such as pizza.', src: ['dol-fs2a'] },
]

// 5. Getting hired.
export const howPeopleGetIn = [
  { step: 'Start where they take beginners', text: 'Many cooks say they started washing dishes or bussing tables, then asked to learn prep and the line.', src: ['r-kc-start', 'r-chefit-noexp', 'r-chefit-cantget'], firstHand: true },
  { step: 'Ask for the chef, in person', text: 'Chefs advise dropping off a résumé when the restaurant is quiet, asking for the chef, and offering a trial shift, called a stage. Some say a stage is unpaid, so ask before you go.', src: ['r-chefit-first', 'r-chefit-cantget'], firstHand: true },
  { step: 'Servers start as bussers or runners', text: 'Servers say most restaurants want serving experience, fine dining even more, so the usual way in is bussing tables or running food.', src: ['r-server-fine', 'r-kc-start'], firstHand: true },
  { step: 'Be honest and show up', text: 'Coffee shop managers say they hire for attitude and reliability over experience, and that claiming experience you do not have is a dealbreaker.', src: ['r-barista-noexp', 'r-barista-interview'], firstHand: true },
]
export const noExperience = { text: 'Chipotle’s crew postings invite people with experience as a dishwasher, cashier, server, host or cook, "or no experience at all," and ask that you be at least 16.', src: ['chipotle-crew'] }

// 6. Moving up.
export const upIntro = { text: 'Most food service managers start in jobs like cook or server and spend years in the industry, BLS says; the typical manager has a high school diploma and less than five years of experience in a related job.', src: ['bls-fsm'] }
export const upSteps = [
  { name: 'Shift lead or supervisor', text: '$21.19 an hour, the median for first-line supervisors of food preparation and serving workers.', src: ['onet-sup'] },
  { name: 'Food service manager', text: '$69,390 a year median. Most work full time, and some more than 40 hours a week.', src: ['bls-fsm'] },
  { name: 'What a posting asks', text: 'A sweetgreen assistant manager posting in Philadelphia asks for 2 or more years supervising in a restaurant, a food handler or ServSafe certificate and age 18 or older, at $55,000 to $65,000 a year.', src: ['sweetgreen-phl'] },
  { name: 'Manager certification', text: 'Some states and cities require managers to hold food safety certification. ServSafe’s manager certification costs $179 for the online course and an online-proctored exam, or $99 for the exam alone, and is valid for 5 years.', src: ['bls-fsm', 'servsafe-mgr', 'servsafe-exam'] },
]
export const promoted = { text: 'Chipotle says over 80% of its managers were promoted from crew, and Starbucks says over 60% of its coffeehouse leaders started as baristas.', src: ['chipotle-crew', 'starbucks-leaders'] }
export const school = { text: 'Both help with school: Chipotle lists tuition assistance of up to $5,250 a year, or 100% for select degrees, and Starbucks covers a first bachelor’s degree online at Arizona State University.', src: ['chipotle-crew', 'starbucks-benefits'] }
export const hoursPeopleSay = { text: 'Chefs and sous chefs describe 60-hour weeks as common and 14-hour days around a restaurant opening; many of them say days that long are not sustainable.', src: ['r-hours1', 'r-hours2'], firstHand: true }

// 7. Watch out.
export const payRights = [
  { text: 'No manager or owner can take a cut of your tips, even when you are paid the full minimum wage.', src: ['dol-fs15'] },
  { text: 'If you are paid $2.13 plus tips, walkouts, broken dishes and register shortages cannot be taken out of your pay.', src: ['dol-fs15'] },
  { text: 'Overtime for a tipped worker is figured on the full $7.25, not on $2.13.', src: ['dol-fs15'] },
  { text: 'Questions about your pay go to the Labor Department’s Wage and Hour Division, 1-866-487-9243.', src: ['dol-fs15'] },
]
export const scams = [
  { text: 'Never pay for a job. The FTC: "Don’t pay for the promise of a job," and honest employers "will never ask you to pay to get a job."', src: ['ftc-scams'] },
  { text: '"No honest potential employer will ever send you a check to deposit and then tell you to send on part of the money," the FTC says.', src: ['ftc-scams'] },
  { text: 'Fake food handler courses: take the course only from a provider your state lists. Washington and Oregon both warn about copycat sites.', src: ['wa-doh', 'or-oha'] },
  { text: 'Apply on the restaurant’s own careers site, such as jobs.chipotle.com or careers.starbucks.com.', src: ['chipotle-crew', 'starbucks-leaders'] },
]

// FAQ — visible on the page and mirrored in FAQPage JSON-LD (only Q&As shown on the page).
export const faq = [
  {
    q: 'Can I get a restaurant job with no experience?',
    a: { text: 'Usually, yes. BLS says most restaurant jobs need no formal education and are learned on the job, in a month or less for servers. Chipotle’s crew postings invite people with restaurant experience "or no experience at all."', src: ['bls-fbs', 'bls-waiters', 'chipotle-crew'] },
  },
  {
    q: 'Do I need a food handler card?',
    a: { text: 'It depends on your state. California, Illinois, Oregon and Texas generally require one within 30 days of starting and Florida within 60, and Washington lets you work up to 14 days without one only if your employer trains you. Take the course only from a provider your state accepts; Washington and Oregon both warn about fake online courses.', src: ['ca-sonoma', 'il-idph', 'or-oha', 'tx-dshs', 'fl-509', 'wa-doh'] },
  },
  {
    q: 'What is the tipped minimum wage?',
    a: { text: 'Under federal law, a restaurant can pay a tipped worker as little as $2.13 an hour in cash if tips bring the total to at least $7.25; if they do not, the employer must make up the difference. Many states set a higher cash wage, and Alaska, California, Minnesota, Montana, Nevada, Oregon and Washington require their full minimum wage before tips.', src: ['dol-fs15', 'dol-tipped'] },
  },
  {
    q: 'Can my manager take part of my tips?',
    a: { text: 'No. Federal law bars employers, managers and supervisors from keeping any part of your tips, directly or through a tip pool. A manager may keep only the tips from tables they served themselves.', src: ['dol-fs15'] },
  },
  {
    q: 'How old do I have to be?',
    a: { text: 'Federal rules let 14- and 15-year-olds work in restaurants outside school hours, up to 3 hours on a school day and 18 in a school week, and not after 7 in the evening (9 from June 1 to Labor Day). At 16 and 17 there is no federal limit on hours, but you cannot use slicers, commercial mixers or other machines the law calls hazardous. Employers can set a higher age: Chipotle’s crew postings ask for 16.', src: ['dol-fs2a', 'chipotle-crew'] },
  },
  {
    q: 'Is a ServSafe certificate the same as a food handler card?',
    a: { text: 'Not always. ServSafe’s Food Handler online course and assessment costs $15, but some states accept only their own card, such as Washington’s from foodworkercard.wa.gov. ServSafe Manager is a different certification for supervisors: $179 for the online course and online-proctored exam, valid for 5 years.', src: ['servsafe-fh', 'wa-doh', 'servsafe-mgr', 'servsafe-exam'] },
  },
]

// ── Listings: the filters on the "Hiring now" block (lib/start/listingFilters.js) ──────────────────────────────────
// A plain "Line Cook", "Dishwasher", "Barista" or "Crew Member" IS the entry job (no diploma, days to weeks of training),
// so the level reads 'entryUnlessMarked': a title is experienced only when it says lead / supervisor / manager / senior
// or the listing's own level says so. Measured on Seen's own rows 2026-11-17 (read-only): "line cook", "prep cook",
// "dishwasher" and "barista" return real restaurant rows; "server" returns mostly server ENGINEERS, "host" returns
// livestream / showroom hosts and Airbnb roles, "shift supervisor" returns check-cashing, pharmacy and security rows, and
// "crew member" a construction crew. So: a row must carry an unambiguous restaurant word in its title (gateTitle) or come
// from a restaurant employer (gateCompany: a restaurant name or a food word in the company name); `exclude` drops tech,
// livestream, retail-pharmacy, security, construction and grocery-store (DashMart) titles; head chefs and private chefs are
// out of scope (they are not entry jobs and the title says neither lead nor senior). "Host" alone counts only from a
// restaurant employer; "Hostess" and "Host/Hostess" count anywhere. The Cook chip takes line / grill / restaurant cooks
// and a title that starts with "Cook" (so "Prep Cook" goes to Prep cook).
const RESTAURANT_TITLE = '\\b(cooks?|line cook|prep cook|dish ?washers?|dishroom|barista|baristas|servers?|waiter|waitress|waitstaff|bussers?|food runners?|hostess|restaurant|kitchen|cafe|café|coffee|food service|fast food|pizza|grill|deli)\\b'
const RESTAURANT_COMPANY = '\\b(chipotle|starbucks|mcdonald\'?s|wendy\'?s|burger king|taco bell|chick-fil-a|subway|domino\'?s|pizza hut|papa john\'?s|panera|sweetgreen|cava|shake shack|five guys|jack in the box|sonic|dairy queen|popeyes|kfc|arby\'?s|whataburger|in-n-out|raising cane\'?s|wingstop|panda express|el pollo loco|qdoba|jersey mike\'?s|jimmy john\'?s|dutch bros|dunkin\'?|peet\'?s|philz|blue bottle|blank street|joe & the juice|tierra mia|chili\'?s|applebee\'?s|olive garden|denny\'?s|ihop|cracker barrel|red robin|texas roadhouse|outback|buffalo wild wings|p\\.?f\\.? chang\'?s|cheesecake factory|hillstone|dig inn|naked ?farmer|au cheval|methodco|restaurants?|grill|cafe|café|coffee|kitchen|pizza|pizzeria|burgers?|tacos?|taqueria|bakery|bistro|diner|eatery|brewing|brewery|steakhouse|sushi|bbq|barbecue|chicken|wings|deli|bagels?|donuts?|smoothie|juice)\\b'
export const listings = {
  defaultRadius: '25',
  radii: ['10', '25', '50', '100'],
  levelMode: 'entryUnlessMarked',
  levelLabels: { any: 'Any level', entry: 'Entry / no experience', experienced: 'Experienced / lead' },
  levelWords: { entry: 'entry-level', experienced: 'experienced' },
  gateTitle: RESTAURANT_TITLE,
  gateCompany: RESTAURANT_COMPANY,
  exclude: '\\b(engineer\\w*|software|developer|hardware|sql|serverless|dba|database|systems?|infrastructure|cloud|windows|linux|network\\w*|architect|administrator|devops|java|python|programmer|analyst|data|storage|compute|technical|recruit\\w*|sales|account executive|instructor|teacher|showroom|live ?stream\\w*|social media|content|video|tiktok|e-?commerce|reporter|security|construction|warehouse|driver|delivery|dashmart|pharmacy|nurse|designer|executive chef|head chef|chef de cuisine|private chef|personal chef|corporate chef|pastry chef|culinary director|director|district manager|regional)\\b',
  positions: [
    {
      id: 'all', label: 'All restaurant jobs', noun: 'restaurant', mix: 'positions',
      queries: ['line cook', 'prep cook', 'dishwasher', 'server', 'barista', 'crew member', 'shift lead'],
      seeAll: 'line cook',
    },
    {
      id: 'crew', label: 'Crew / cashier', noun: 'crew and cashier',
      queries: ['crew member', 'team member', 'cashier'],
      match: '\\bcrew\\b|team member|cashier|counter (?:attendant|associate|server)|front of house|\\bfoh\\b',
    },
    {
      id: 'cook', label: 'Cook / line cook', noun: 'cook',
      queries: ['line cook', 'cook', 'grill cook'],
      match: '\\b(?:line|lead|grill|fry|short[- ]order|breakfast|pizza|banquet|restaurant|kitchen|first|1st|second|2nd)\\s+cooks?\\b|^cooks?\\b|\\bcook\\s*(?:i|ii|iii|1|2|3)\\b|chef de partie',
    },
    {
      id: 'prep', label: 'Prep cook', noun: 'prep cook',
      queries: ['prep cook', 'kitchen prep'],
      match: '\\bprep\\b|food prep\\w*|kitchen (?:helper|assistant)',
    },
    {
      id: 'dish', label: 'Dishwasher', noun: 'dishwasher',
      queries: ['dishwasher', 'dish washer'],
      match: 'dish ?washers?|dish ?machine|dishroom|\\bdish\\b|steward|utility (?:aide|worker)|porter',
    },
    {
      id: 'server', label: 'Server / host', noun: 'server and host',
      queries: ['server', 'hostess', 'busser', 'food runner'],
      match: '\\bservers?\\b|\\bwait(?:er|ress|staff)\\b|\\bhost(?:ess)?\\b|bussers?|food runners?|\\brunners?\\b',
    },
    {
      id: 'barista', label: 'Barista', noun: 'barista',
      queries: ['barista'],
      match: 'barista',
    },
    {
      id: 'lead', label: 'Shift lead / manager', noun: 'shift lead and manager',
      queries: ['shift lead', 'shift supervisor', 'kitchen manager', 'restaurant manager'],
      match: 'shift (?:lead|leader|supervisor|manager)|kitchen (?:manager|lead|supervisor)|restaurant (?:manager|shift leader)|assistant (?:restaurant |general |kitchen )?manager|general manager|sous chef|crew (?:lead|leader|trainer)|team lead',
    },
  ],
}

// ── The page's openable rows (components/start/Guide.tsx `Blocks` renders each block type) ──────────────────────────
export const menu = [
  {
    id: 'the-jobs', title: 'The jobs', summary: 'Eight restaurant jobs, and what each pays',
    blocks: [
      { type: 'cards', items: jobs.map((j) => ({ name: j.role, aka: j.aka, body: j.what, chips: j.chips })) },
      { type: 'more', title: 'Pay on employers’ own postings', blocks: [
        { type: 'table', caption: 'Starting pay stated on employers’ own postings', columns: [{ key: 'employer', label: 'Employer' }, { key: 'role', label: 'Job' }, { key: 'pay', label: 'Stated pay', num: true }], rows: postedPay },
        { type: 'note', entry: postedPayNote },
      ] },
      { type: 'more', title: 'Where the jobs are going', blocks: [{ type: 'text', entry: outlook }] },
    ],
  },
  {
    id: 'tips', title: 'Tips and the tipped wage', summary: 'The tipped minimum, state rules, tip pools',
    blocks: [
      { type: 'callout', entry: tipCallout },
      { type: 'checklist', items: tipRules, cols: true },
      { type: 'more', title: 'Tipped wages, state by state', blocks: [
        { type: 'checklist', items: tipStates },
        { type: 'note', entry: tipStatesNote },
      ] },
      { type: 'text', entry: tipOutPeopleSay, lead: 'From people who wait tables:' },
    ],
  },
  {
    id: 'food-handler-card', title: 'Food handler cards and ServSafe', summary: 'Which states require a card, and the cost',
    blocks: [
      { type: 'text', entry: cardIntro },
      { type: 'table', caption: 'Food handler card rules in six states', columns: [{ key: 'state', label: 'State' }, { key: 'when', label: 'When' }, { key: 'valid', label: 'Good for' }, { key: 'note', label: 'Worth knowing' }], rows: cardStates },
      { type: 'note', entry: cardElsewhere },
      { type: 'text', entry: servsafe },
      { type: 'callout', entry: fakeCourses },
    ],
  },
  {
    id: 'the-work', title: 'What the work is like', summary: 'Hours, time on your feet, burns and cuts',
    blocks: [
      { type: 'checklist', items: work, cols: true },
      { type: 'notes', label: 'What people say', items: [injuryPeopleSay, openingPeopleSay] },
      { type: 'more', title: 'Rules for workers under eighteen', blocks: [{ type: 'checklist', items: youth }] },
    ],
  },
  {
    id: 'getting-hired', title: 'How people get hired', summary: 'Where beginners start, and how to ask',
    blocks: [
      { type: 'text', plain: 'What people who got in say. Several accounts agree on each of these.' },
      { type: 'steps', items: howPeopleGetIn },
      { type: 'text', entry: noExperience },
      { type: 'resumeLink', before: 'Before you apply, you can', label: 'check your résumé against a posting' },
    ],
  },
  {
    id: 'moving-up', title: 'Moving up to lead and manager', summary: 'Shift lead, kitchen manager, paid school',
    blocks: [
      { type: 'text', entry: upIntro },
      { type: 'checklist', items: upSteps, cols: true },
      { type: 'text', entries: [promoted, school] },
      { type: 'text', entry: hoursPeopleSay, lead: 'From people who run kitchens:' },
    ],
  },
  {
    id: 'watch-out', title: 'Watch out', icon: 'caution', summary: 'Your tips, pay deductions, and scams',
    blocks: [
      { type: 'notesGrid', groups: [
        { label: 'Your pay and tips', items: payRights, icon: 'x' },
        { label: 'Scams', items: scams, icon: 'x' },
      ] },
    ],
  },
  { id: 'questions', title: 'Common questions', summary: 'Experience, cards, tips, age, ServSafe', blocks: [{ type: 'faq', items: faq }] },
]

// ── Additional resources: every reference above, as plain grouped links (no numbers, closed by default) ────────────
export const resourcesSummary = 'Tip rules, food handler cards, pay data'
export const resources = [
  { title: 'Tips and wage rules', items: [
    { key: 'dol-tipped', name: 'Tipped minimum wages by state (Labor Department)' },
    { key: 'dol-fs15', name: 'Tipped employees and tip pools (Labor Department fact sheet)' },
    { key: 'dol-fs2a', name: 'Rules for teen workers in restaurants (Labor Department fact sheet)' },
  ] },
  { title: 'Food handler cards', items: [
    { key: 'ca-sonoma', name: 'California food handler card (Sonoma County)' },
    { key: 'ca-la', name: 'California food handler card fact sheet (Los Angeles County)' },
    { key: 'fl-509', name: 'Florida food service employee training law' },
    { key: 'il-idph', name: 'Illinois food handler training' },
    { key: 'or-oha', name: 'Oregon food handler cards' },
    { key: 'tx-dshs', name: 'Texas food handler training questions' },
    { key: 'wa-doh', name: 'Washington food worker card' },
    { key: 'servsafe-fh', name: 'ServSafe Food Handler course' },
    { key: 'servsafe-mgr', name: 'ServSafe Manager courses and exams' },
    { key: 'servsafe-exam', name: 'ServSafe Manager exam with online proctor' },
  ] },
  { title: 'Employers’ postings and pages', items: [
    { key: 'chipotle-arvada', name: 'Chipotle: crew member, Arvada, CO' },
    { key: 'chipotle-nyc', name: 'Chipotle: crew member, New York, NY' },
    { key: 'chipotle-cos', name: 'Chipotle: crew member, Colorado Springs, CO' },
    { key: 'chipotle-crew', name: 'Chipotle: crew, Goodyear, AZ' },
    { key: 'starbucks-leaders', name: 'Starbucks: coffeehouse jobs' },
    { key: 'starbucks-benefits', name: 'Starbucks: benefits' },
    { key: 'sweetgreen-phl', name: 'sweetgreen: assistant manager, Philadelphia, PA' },
  ] },
  { title: 'Pay and jobs data', items: [
    { key: 'bls-cooks', name: 'Cooks (Bureau of Labor Statistics)' },
    { key: 'bls-waiters', name: 'Waiters and waitresses' },
    { key: 'bls-fbs', name: 'Hosts, bussers, fast food and counter workers' },
    { key: 'bls-prep', name: 'Food preparation workers' },
    { key: 'bls-fsm', name: 'Food service managers' },
    { key: 'bls-iag722', name: 'Restaurants and bars: hours, earnings, injuries' },
    { key: 'bls-osh', name: 'Workplace injuries and illnesses, 2024 (Bureau of Labor Statistics)' },
    { key: 'onet-dish', name: 'Dishwashers (O*NET)' },
    { key: 'onet-barista', name: 'Baristas (O*NET)' },
    { key: 'onet-sup', name: 'Food service supervisors (O*NET)' },
  ] },
  { title: 'Job scams', items: [
    { key: 'ftc-scams', name: 'Job scams (Federal Trade Commission)' },
  ] },
  { title: 'Community discussions', items: [
    { key: 'r-kc-start', name: 'How cooks got into kitchens' },
    { key: 'r-chefit-noexp', name: 'A kitchen job with no experience' },
    { key: 'r-chefit-cantget', name: 'Struggling to get a first restaurant job' },
    { key: 'r-chefit-first', name: 'Asking a chef for a trial shift' },
    { key: 'r-server-fine', name: 'Getting hired as a server' },
    { key: 'r-tipout1', name: 'What servers tip out to the bar' },
    { key: 'r-tipout2', name: 'Tip-outs to bartenders and runners' },
    { key: 'r-burns', name: 'Living with small kitchen burns' },
    { key: 'r-cuts1', name: 'How often cooks cut themselves' },
    { key: 'r-cuts2', name: 'Knife cuts over a career' },
    { key: 'r-barista-noexp', name: 'A barista job with no experience' },
    { key: 'r-barista-interview', name: 'A barista interview with no experience' },
    { key: 'r-open1', name: 'Sleeping for early opening shifts' },
    { key: 'r-open2', name: 'Going to bed early before opening' },
    { key: 'r-hours1', name: 'Long weeks for chefs' },
    { key: 'r-hours2', name: 'Long days at a restaurant opening' },
  ] },
]

/** Every fact on the page, in reading order: the hero, then each menu row. */
export function pageEntries() {
  return [guide.answer, ...tiles, ...blockEntries(menu)]
}
