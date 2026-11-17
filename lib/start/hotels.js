// /start/hotels — "Getting into hotel work". The page renders from this module only, so every figure on it carries a
// reference and an as-of date (lib/start/guides.test.mjs fails on a figure without one).
//
// THE ONLY SOURCE OF FACTS is the research file compiled 2026-11-17 (session scratchpad guides20/hotels/research.md).
// Rules this module keeps:
//   • only items the research marked VERIFIED: BLS (Industries at a Glance for accommodation, the 2024 injury table, the
//     2025 union table), O*NET OnLine (BLS OEWS 2025 wages and 2025–35 projections), employers' own postings on
//     careers.marriott.com (job IDs in the references), Hilton's and Marriott's own programme pages, city and state
//     labor pages (Washington L&I, Seattle, Los Angeles, New York City), the Culinary Union's own release, the FTC;
//   • bls.gov/ooh answered 403 to the research sandbox, so no Occupational Outlook Handbook wording or figure is used;
//     Hyatt's careers site answered 403, so nothing from Hyatt is printed;
//   • FIRST-HAND items (several threads agreeing) only as `firstHand: true`, said as what people say, never as fact;
//   • nothing from the research's UNVERIFIED list: no Illinois, New Jersey or California statewide panic-button law, no
//     Seattle square-foot figure, no UNITE HERE Local 11 "$35", no Culinary Union "$28 / $37" average, no ski-season bonus,
//     no share of franchise postings, no "night audit leads to management", no housekeeping room counts per shift;
//   • a posting is one hotel's rate on the day it was read; medians are national; averages are never starting pay.
//
// Shape: `sources` (every reference behind the page, kept here and never printed as citations — readers reach the links
// through the grouped "Additional resources" menu, `resources` below), entries `{ text, src, firstHand? }`, the listings
// filter config (`listings`, lib/start/listingFilters.js) and the openable menu rows (`menu`, rendered by
// components/start/Guide.tsx). Pure data; relative imports only so `node --test` runs it as is.

import { blockEntries } from './entries.js'

/** @typedef {{ label: string, url: string, date: string, note?: string }} Source */

const MJ = 'https://careers.marriott.com'

/** @type {Record<string, Source>} */
export const sources = {
  'bls-iag721': { label: 'U.S. Bureau of Labor Statistics, Industries at a Glance: Accommodation, NAICS 721 (2025 wages by occupation, 2024 injury rates)', url: 'https://www.bls.gov/iag/tgs/iag721.htm', date: '2026-11-17', note: 'read' },
  'bls-soii': { label: 'BLS, Table 1: incidence rates of nonfatal occupational injuries and illnesses by industry, 2024', url: 'https://www.bls.gov/web/osh/table-1-industry-rates-national.htm', date: '2026-11-17', note: 'read' },
  'bls-union': { label: 'BLS, Union affiliation of employed wage and salary workers by occupation and industry, 2024–2025 (Table 3)', url: 'https://www.bls.gov/news.release/union2.t03.htm', date: '2026-11-17', note: 'read' },
  'onet-desk': { label: 'O*NET OnLine: Hotel, Motel, and Resort Desk Clerks, 43-4081.00 (BLS 2025 wages, 2025–35 projections)', url: 'https://www.onetonline.org/link/summary/43-4081.00', date: '2026-11-17', note: 'read' },
  'onet-desk-ctx': { label: 'O*NET OnLine: Hotel, Motel, and Resort Desk Clerks, details and work context', url: 'https://www.onetonline.org/link/details/43-4081.00', date: '2026-11-17', note: 'read' },
  'onet-maids': { label: 'O*NET OnLine: Maids and Housekeeping Cleaners, 37-2012.00 (BLS 2025 wages, 2025–35 projections)', url: 'https://www.onetonline.org/link/summary/37-2012.00', date: '2026-11-17', note: 'read' },
  'onet-maids-ctx': { label: 'O*NET OnLine: Maids and Housekeeping Cleaners, details and work context', url: 'https://www.onetonline.org/link/details/37-2012.00', date: '2026-11-17', note: 'read' },
  'onet-maint': { label: 'O*NET OnLine: Maintenance and Repair Workers, General, 49-9071.00', url: 'https://www.onetonline.org/link/summary/49-9071.00', date: '2026-11-17', note: 'read' },
  'onet-valet': { label: 'O*NET OnLine: Parking Attendants (valet), 53-6021.00', url: 'https://www.onetonline.org/link/summary/53-6021.00', date: '2026-11-17', note: 'read' },
  'onet-waiters': { label: 'O*NET OnLine: Waiters and Waitresses (banquet servers), 35-3031.00', url: 'https://www.onetonline.org/link/summary/35-3031.00', date: '2026-11-17', note: 'read' },
  'onet-hksup': { label: 'O*NET OnLine: First-Line Supervisors of Housekeeping and Janitorial Workers, 37-1011.00', url: 'https://www.onetonline.org/link/summary/37-1011.00', date: '2026-11-17', note: 'read' },
  'onet-lodging': { label: 'O*NET OnLine: Lodging Managers (front office manager), 11-9081.00', url: 'https://www.onetonline.org/link/summary/11-9081.00', date: '2026-11-17', note: 'read' },
  'mar-irvine': { label: 'Marriott posting, job ID 26137169: Front Desk Agent, Courtyard by Marriott Irvine Spectrum, CA (own careers site)', url: `${MJ}/front-desk-agent/job/P1-7436847-0`, date: '2026-11-17', note: 'read' },
  'mar-basking': { label: 'Marriott posting, job ID 26148290: Front Desk Agent, Courtyard by Marriott Basking Ridge, NJ (own careers site)', url: `${MJ}/front-desk-agent/job/P1-7690078-0`, date: '2026-11-17', note: 'read' },
  'mar-rancho': { label: 'Marriott posting, job ID 26139316: Front Desk Agent, The Ritz-Carlton Rancho Mirage, CA (own careers site)', url: `${MJ}/front-desk-agent/job/P1-7461248-0`, date: '2026-11-17', note: 'read' },
  'mar-opryland': { label: 'Marriott posting, job ID 26134277: Room Attendant, The Inn at Opryland, A Gaylord Hotel, Nashville, TN (own careers site)', url: `${MJ}/room-attendant/job/P1-7379243-0`, date: '2026-11-17', note: 'read' },
  'mar-rockville': { label: 'Marriott posting, job ID 26145055: Night Auditor, Courtyard by Marriott Rockville, MD (own careers site)', url: `${MJ}/night-auditor/job/P1-7638750-0`, date: '2026-11-17', note: 'read' },
  'mar-tysons': { label: 'Marriott posting, job ID 26134835: Banquet Server, The Ritz-Carlton Tysons Corner, VA (own careers site)', url: `${MJ}/banquet-server/job/P1-7383811-0`, date: '2026-11-17', note: 'read' },
  'mar-marina': { label: 'Marriott posting, job ID 26144348: Banquet Server, Marina del Rey Marriott, CA (own careers site)', url: `${MJ}/banquet-server/job/P1-7629157-0`, date: '2026-11-17', note: 'read' },
  'mar-nomad': { label: 'Marriott posting, job ID 26143616: Maintenance Engineer, The Ritz-Carlton New York NoMad (own careers site)', url: `${MJ}/maintenance-engineer/job/P1-7616378-0`, date: '2026-11-17', note: 'read' },
  'mar-sanantonio': { label: 'Marriott posting, job ID 26146298: Maintenance Technician, Courtyard San Antonio Riverwalk, TX (own careers site)', url: `${MJ}/maintenance-technician/job/P1-7659627-0`, date: '2026-11-17', note: 'read' },
  'mar-turtlebay': { label: 'Marriott posting, job ID 26137348: Front Office Supervisor, The Ritz-Carlton Oahu Turtle Bay, HI (own careers site)', url: `${MJ}/front-office-supervisor/job/P1-7436877-0`, date: '2026-11-17', note: 'read' },
  'crescent-tempe': { label: 'Crescent Hotels & Resorts posting on Marriott’s careers site: Houseperson, The Westin Tempe, AZ', url: `${MJ}/houseperson/job/7C11E617168204D76DCB53AA93637164`, date: '2026-11-17', note: 'read' },
  'franchise-austin': { label: 'White Lodging posting on Marriott’s careers site: Night Auditor, Austin, TX (franchise notice)', url: `${MJ}/night-auditor/job/243B6FA1F91D5A68FF96A9C9186D0ED5`, date: '2026-11-17', note: 'read' },
  'mar-early': { label: 'Marriott careers: early career programs (Voyage leadership development program, apprenticeships)', url: `${MJ}/career-paths/apprenticeship/`, date: '2026-11-17', note: 'read' },
  'hilton-early': { label: 'Hilton careers: early talent programs in the United States (Management Development Program)', url: 'https://jobs.hilton.com/early-career-paths/early-career-americas/', date: '2026-11-17', note: 'read' },
  'hilton-benefits': { label: 'Hilton careers: U.S. team member benefits (tuition-free education)', url: 'https://jobs.hilton.com/benefits-us/', date: '2026-11-17', note: 'read' },
  'wa-isolated': { label: 'Washington State Department of Labor & Industries, isolated worker protections (panic buttons, RCW 49.60.515)', url: 'https://lni.wa.gov/workers-rights/industry-specific-requirements/isolated-worker-protections', date: '2026-11-17', note: 'read' },
  'sea-safety': { label: 'Seattle Office of Labor Standards, Hotel Employees Safety Protections Ordinance (SMC 14.26)', url: 'https://www.seattle.gov/laborstandards/ordinances/hotel-employee-protections/hotel-employees-safety-protections-ordinance', date: '2026-11-17', note: 'read' },
  'sea-injury': { label: 'Seattle Office of Labor Standards, Protecting Hotel Employees from Injury Ordinance', url: 'https://www.seattle.gov/laborstandards/ordinances/hotel-employee-protections/protecting-hotel-employees-from-injury-ordinance', date: '2026-11-17', note: 'read' },
  'la-wage': { label: 'City of Los Angeles, Office of Wage Standards: Citywide Hotel Worker Minimum Wage rate chart (rev. May 27, 2026)', url: 'https://wagesla.lacity.gov/sites/g/files/wph1941/files/2026-06/2026%20CHMWO%20Wage%20Chart%20wHB%20Rev05-27-26.pdf', date: '2026-05-27', note: 'revised' },
  'la-hwpo': { label: 'City of Los Angeles, Rules and Procedures implementing the Hotel Worker Protection Ordinance', url: 'https://wagesla.lacity.gov/sites/g/files/wph1941/files/2026-04/HWPO%20Rules%20and%20Procedures%20ADA.pdf', date: '2025-10-20', note: 'published' },
  'la-hwpo-notice': { label: 'City of Los Angeles, Hotel Worker Protection Ordinance official notice (personal security devices)', url: 'https://wagesla.lacity.gov/sites/g/files/wph1941/files/2026-04/Hotel%20Worker%20Protection%20Ordinance%20Official%20Notice%202025%20ENG_ADA.pdf', date: '2026-11-17', note: 'read' },
  'nyc-hotels': { label: 'NYC Department of Consumer and Worker Protection, hotel licensing law protections (press release)', url: 'https://www.nyc.gov/site/dca/news/29-26/dcwp-touts-nation-leading-hotel-consumer-worker-protections-reaffirms-safety-transparency', date: '2026-03-26', note: 'published' },
  'culinary-2023': { label: 'Culinary Union Local 226 (UNITE HERE), members ratify contracts with MGM Resorts, Caesars Entertainment and Wynn Resorts', url: 'https://culinaryunion226.org/news/press/culinary-union-members-vote-to-ratify-union-contracts-for-40000-mgm-resorts-caesars-entertainment-and-wynn-resorts-workers', date: '2023-11-22', note: 'published' },
  'ftc-scams': { label: 'Federal Trade Commission, Job Scams (consumer advice)', url: 'https://consumer.ftc.gov/articles/job-scams', date: '2023-03', note: 'article dated' },
  // First-hand accounts (Reddit threads read through the Arctic Shift archive on 2026-11-17). Used only where several
  // threads agree, and rendered as what people say, never as fact.
  'r-scam-staff': { label: 'r/TalesFromTheFrontDesk, scam callers pretending to be staff or owners', url: 'https://www.reddit.com/r/TalesFromTheFrontDesk/comments/1fitwjp/', date: '2026-11-17', note: 'thread read' },
  'r-scam-fire': { label: 'r/TalesFromTheFrontDesk, the fire marshal scam call', url: 'https://www.reddit.com/r/TalesFromTheFrontDesk/comments/1my8mjn/', date: '2026-11-17', note: 'thread read' },
  'r-scam-pinpad': { label: 'r/TalesFromTheFrontDesk, a night auditor who fell for a scam call', url: 'https://www.reddit.com/r/TalesFromTheFrontDesk/comments/1g25vym/', date: '2026-11-17', note: 'thread read' },
  'r-scam-patel': { label: 'r/TalesFromTheFrontDesk, the "Mr. Patel" call on night audit', url: 'https://www.reddit.com/r/TalesFromTheFrontDesk/comments/1xk3o2s/', date: '2026-11-17', note: 'thread read' },
  'r-na-why': { label: 'r/TalesFromTheFrontDesk, why people choose night audit', url: 'https://www.reddit.com/r/TalesFromTheFrontDesk/comments/1gvfkag/', date: '2026-11-17', note: 'thread read' },
  'r-na-hating': { label: 'r/TalesFromTheFrontDesk, burning out on night audit', url: 'https://www.reddit.com/r/TalesFromTheFrontDesk/comments/1lkvgme/', date: '2026-11-17', note: 'thread read' },
  'r-na-alone': { label: 'r/TalesFromTheFrontDesk, the only employee on the overnight shift', url: 'https://www.reddit.com/r/TalesFromTheFrontDesk/comments/1cuupf2/', date: '2026-11-17', note: 'thread read' },
}

export const guide = {
  path: '/start/hotels',
  title: 'Getting into hotel work',
  crumbLabel: 'Hotel work',
  eyebrow: 'Guide',
  // The one-sentence answer under the h1 (the page's first screen).
  answer: { text: 'Front desk, housekeeping and banquet jobs take people with little or no experience and train them on the job; the pay is modest, and evenings, nights and weekends are normal. Here is what each job pays, what it asks of you, and who is hiring now.', src: ['onet-desk', 'onet-maids', 'onet-waiters', 'mar-irvine'] },
  metaDescription: 'How to get a hotel job with no experience: front desk, housekeeping, night audit, banquets and maintenance — what each pays, what the work is like, panic-button and workload laws, live hotel listings near you, and scams to avoid.',
  asOf: '2026-11-17',
}

// The three readings in the hero: each restates a fact below, with the same references.
export const tiles = [
  { label: 'Median pay in hotels', value: '$16.78–$16.82', text: 'an hour for housekeepers and front desk clerks in the accommodation industry, May 2025', src: ['bls-iag721'] },
  { label: 'Front desk, posted', value: '$17.50–$23.00', text: 'an hour on five Marriott front desk and night audit postings read in November 2026 (New Jersey to California)', src: ['mar-basking', 'mar-rockville', 'mar-irvine', 'mar-rancho'] },
  { label: 'Injury rate', value: '3.9 vs 2.3', text: 'recordable injury and illness cases per 100 full-time workers in 2024: hotels and motels against all private industry', src: ['bls-soii'] },
]

// 1. The jobs: a name, one line, and the figures as chips.
export const jobs = [
  {
    role: 'Front desk agent', aka: 'Also guest service agent, desk clerk',
    what: { text: 'Checks guests in and out, takes reservations and payments, and handles complaints. Most new hires need a high school diploma or GED, and training runs from a few days to a year on the job.', src: ['onet-desk'] },
    chips: [{ text: '$16.82/hr median in hotels', src: ['bls-iag721'] }],
  },
  {
    role: 'Room attendant', aka: 'Also housekeeper, guest room attendant',
    what: { text: 'Cleans guest rooms and restocks them. It is the job with the fewest requirements: 45% of new hires need no high school diploma.', src: ['onet-maids'] },
    chips: [{ text: '$16.78/hr median in hotels', src: ['bls-iag721'] }],
  },
  {
    role: 'Houseperson', aka: 'Also houseman, public area attendant',
    what: { text: 'Keeps corridors and public areas clean, hauls linen and trash, and moves furniture for the room attendants. A Westin posting asks you to lift up to 100 lb.', src: ['crescent-tempe'] },
    chips: [{ text: 'Westin Tempe posting: $18.75/hr', src: ['crescent-tempe'] }],
  },
  {
    role: 'Night auditor', aka: 'The overnight front desk',
    what: { text: 'Runs the front desk overnight and closes the day’s books: posting charges to accounts, running the night audit and rolling the date.', src: ['mar-rockville'] },
    chips: [{ text: 'Courtyard Rockville posting: $20.53/hr', src: ['mar-rockville'] }],
  },
  {
    role: 'Banquet server', aka: 'Also banquet houseperson, captain',
    what: { text: 'Sets up and serves weddings, meetings and conferences. Shifts follow the events, and some postings are on call.', src: ['onet-waiters', 'mar-tysons'] },
    chips: [{ text: '$17.06/hr median for servers in hotels', src: ['bls-iag721'] }],
  },
  {
    role: 'Maintenance technician', aka: 'Also hotel engineer',
    what: { text: 'Fixes rooms, equipment and the building. Unlike the jobs above, it usually asks for some experience first.', src: ['onet-maint', 'mar-sanantonio', 'mar-nomad'] },
    chips: [{ text: '$23.84/hr median, all industries', src: ['onet-maint'] }],
  },
  {
    role: 'Valet attendant', aka: 'Also valet parker',
    what: { text: 'Parks and returns guests’ cars and checks them for damage. Training runs from a few days to a year on the job.', src: ['onet-valet'] },
    chips: [{ text: '$16.90/hr median, all industries', src: ['onet-valet'] }],
  },
]

// The same occupations in the accommodation industry and across every industry (BLS, 2025 medians, hourly).
export const payTable = [
  { occupation: 'Front desk clerks', hotels: '$16.82', all: '$16.86', src: ['bls-iag721', 'onet-desk'] },
  { occupation: 'Housekeepers (maids and housekeeping cleaners)', hotels: '$16.78', all: '$17.07', src: ['bls-iag721', 'onet-maids'] },
  { occupation: 'Servers (waiters and waitresses)', hotels: '$17.06', all: '$16.94', src: ['bls-iag721', 'onet-waiters'] },
  { occupation: 'Housekeeping supervisors', hotels: '$21.94', all: '$23.61', src: ['bls-iag721', 'onet-hksup'] },
  { occupation: 'Lodging managers (front office manager, hotel manager)', hotels: '$32.27', all: '$33.29', src: ['bls-iag721', 'onet-lodging'] },
]
export const payTableNote = { text: '"In hotels" is the accommodation industry; "every industry" also counts hospitals, offices and restaurants. Medians are national, 2025; local pay varies a lot.', src: ['bls-iag721', 'onet-desk'] }
export const outlook = [
  { text: 'BLS projects about 35,500 front desk clerk openings a year from 2025 to 2035 and about 175,500 for housekeepers in every industry, with both jobs growing more slowly than average, 1% to 2%.', src: ['onet-desk', 'onet-maids'] },
]

// 2. Pay on employers' own postings (careers.marriott.com, read November 2026).
export const postedPay = [
  { employer: 'Courtyard, Basking Ridge, NJ', role: 'Front desk agent', pay: '$17.50–$18.00/hr', src: ['mar-basking'] },
  { employer: 'Courtyard, Irvine, CA', role: 'Front desk agent', pay: '$22.75/hr', src: ['mar-irvine'] },
  { employer: 'Ritz-Carlton, Rancho Mirage, CA', role: 'Front desk agent', pay: '$23.00/hr', src: ['mar-rancho'] },
  { employer: 'Courtyard, Rockville, MD', role: 'Night auditor', pay: '$20.53/hr', src: ['mar-rockville'] },
  { employer: 'Gaylord Inn at Opryland, Nashville, TN', role: 'Room attendant', pay: '$18.50/hr', src: ['mar-opryland'] },
  { employer: 'Westin, Tempe, AZ (Crescent Hotels)', role: 'Houseperson', pay: '$18.75/hr', src: ['crescent-tempe'] },
  { employer: 'Marriott, Marina del Rey, CA', role: 'Banquet server', pay: '$18.47/hr', src: ['mar-marina'] },
  { employer: 'Ritz-Carlton, Tysons Corner, VA', role: 'Banquet server (tipped)', pay: '$9.55–$10.16/hr plus tips and service charge', src: ['mar-tysons'] },
]
export const postedPayIntro = { text: 'Pay stated on hotel postings on Marriott’s own careers site, read in November 2026. A posting is one hotel’s rate on that date, not what every hotel pays.', src: ['mar-basking', 'mar-irvine', 'mar-opryland', 'mar-rockville'] }

// What pays more.
export const paysMore = [
  { name: 'Tipped jobs', text: 'A tipped banquet job can carry a low hourly rate: the Ritz-Carlton Tysons Corner posting lists $9.55 to $10.16 an hour, plus tips and a share of the staff service charge.', src: ['mar-tysons'] },
  { name: 'Experience', text: 'A front office supervisor posting in Hawaii asks for a year of supervising and pays $29.26 to $36.57 an hour; a New York maintenance engineer posting asks for two years and pays $36.01 to $48.01.', src: ['mar-turtlebay', 'mar-nomad'] },
  { name: 'A city hotel wage', text: 'Los Angeles sets a hotel worker minimum wage for hotels with 60 or more rooms: $25.00 an hour from July 1, 2026 to June 30, 2027, plus $4.25 an hour toward health care (paid as wages if the hotel gives no health benefits).', src: ['la-wage'] },
  { name: 'A union contract', text: 'In Las Vegas, the Culinary Union, a UNITE HERE local, won a 10% raise in the first year and 32% over five years in its 2023 contracts with MGM Resorts, Caesars and Wynn.', src: ['culinary-2023'] },
]
export const unionLine = { text: 'Unions are more common in hotels than in most private work: 7.6% of accommodation workers were union members in 2025, against 5.9% across the private sector.', src: ['bls-union'] }

// 3. The work itself.
export const work = [
  { name: 'Evenings, nights, weekends', text: 'Hotels run around the clock. Postings read like this: "PM and Overnight shifts" for a front desk agent, "Overnight position, Weekend availability preferably" for a night auditor, and evenings "including weekends and holidays" for a houseperson.', src: ['mar-irvine', 'mar-rockville', 'crescent-tempe'] },
  { name: 'Housekeeping is hard on the body', text: 'Of the housekeepers O*NET surveyed, 84% stand and 70% bend or twist almost all shift. A Gaylord room attendant posting asks you to lift up to 50 lb on your own.', src: ['onet-maids-ctx', 'mar-opryland'] },
  { name: 'Guests who are upset', text: '40% of front desk clerks deal with unpleasant or angry people every day, and another 41% at least once a week.', src: ['onet-desk-ctx'] },
  { name: 'More injuries than most work', text: 'Hotels and motels recorded 3.9 injury and illness cases per 100 full-time workers in 2024, against 2.3 across private industry.', src: ['bls-soii'] },
]
export const nightAlone = { text: 'Night auditors describe being alone at the desk most of the night: the audit and a few hours of real work, then quiet. Some say that suits them; others say the solitude wears them down.', src: ['r-na-why', 'r-na-hating', 'r-na-alone'], firstHand: true }
export const nightSleep = { text: 'The hard part, they say, is the schedule: sleeping through the day, fitting in appointments that only happen by day, and keeping the same hours on days off.', src: ['r-na-hating', 'r-na-why'], firstHand: true }

// 4. Safety and workload laws (city and state pages).
export const safetyLaws = [
  { name: 'Washington State', text: 'Hotels and motels must give a panic button to housekeepers and room service attendants who work alone most of the time, adopt a sexual harassment policy and train staff on it.', src: ['wa-isolated'] },
  { name: 'Seattle', text: 'Hotels must give panic buttons, keep you from being sent to a guest’s room after that guest is accused of violent or harassing conduct, and let you move away from that guest. At hotels with 100 or more rooms, a room attendant’s floor space is capped each day, with premium pay above the limit.', src: ['sea-safety', 'sea-injury'] },
  { name: 'Los Angeles', text: 'Every hotel must give a personal security device to a worker alone in a guest room. A room attendant who cleans more than 3,500 square feet in an eight-hour day (4,000 at hotels with 45 to 59 rooms) is paid at least twice the regular rate for the day, and no one works over 10 hours without agreeing in writing.', src: ['la-hwpo-notice', 'la-hwpo'] },
  { name: 'New York City', text: 'Under the hotel license law, hotels must give employees panic buttons, keep a front desk staffed around the clock, train staff to recognize human trafficking, and employ core staff directly.', src: ['nyc-hotels'] },
]
export const safetyUnion = { text: 'Union contracts can add more: the Culinary Union’s 2023 Las Vegas contracts cut housekeeping room quotas, brought back daily room cleaning and put safety buttons in more workers’ hands.', src: ['culinary-2023'] }

// 5. Getting hired and moving up.
export const whoHires = { text: 'Many jobs on a brand’s careers site are posted by the company that owns or runs that hotel. A franchise posting on Marriott’s site says plainly: "If you accept a position at this hotel, you will be employed by a franchisee, not Marriott." Pay, schedules and benefits are that company’s.', src: ['franchise-austin', 'crescent-tempe'] }
export const asks = [
  { name: 'No experience', text: 'A Courtyard front desk posting lists "No related work experience" and no license; a high school diploma or GED is preferred.', src: ['mar-irvine'] },
  { name: 'Open availability', text: 'Postings often prefer it: "Open availability preferred" for a Nashville room attendant, weekends for a night auditor.', src: ['mar-opryland', 'mar-rockville'] },
  { name: 'English', text: 'Some postings ask for it. A Westin houseperson posting: "Must have the ability to communicate in English."', src: ['crescent-tempe'] },
  { name: 'A record is not an automatic no', text: 'Marriott’s own postings say it "considers for employment qualified applicants with criminal histories consistent with applicable federal, state and local law."', src: ['mar-irvine'] },
]
export const movingUp = [
  { step: 'Supervisor', text: 'Housekeeping and front office supervisors are the first step up; supervisor postings ask for a year or more of experience. In hotels, housekeeping supervisors earn a median $21.94 an hour.', src: ['mar-turtlebay', 'bls-iag721'] },
  { step: 'Front office manager', text: 'Front office and hotel managers are counted as lodging managers: a median $32.27 an hour in hotels, and 72% of employers surveyed ask for a bachelor’s degree.', src: ['bls-iag721', 'onet-lodging'] },
  { step: 'School while you work', text: 'Hilton offers eligible U.S. team members tuition-free education through Guild, from high school completion and certificates to college degrees.', src: ['hilton-benefits'] },
]
export const programmes = { text: 'Brand management programmes are mostly for students and graduates. Hilton’s Management Development Program is a twelve-month rotation through hotel departments that prepares trainees for a first manager job; Marriott’s Voyage is a paid post-graduate programme of 12 to 18 months.', src: ['hilton-early', 'mar-early'] }

// 6. Watch out.
export const scams = [
  { text: 'Never pay for a job. The FTC: "Don’t pay for the promise of a job," and if a placement firm asks for a fee, "especially one you have to pay in advance — walk away."', src: ['ftc-scams'] },
  { text: 'Marriott’s postings say it "maintains a ‘no fees’ recruitment policy" and does not ask applicants for money.', src: ['mar-irvine'] },
  { text: '"No honest potential employer will ever send you a check to deposit and then tell you to send on part of the money," the FTC says.', src: ['ftc-scams'] },
  { text: 'Apply through the hotel or the brand’s own careers site, and report a scam at ReportFraud.ftc.gov.', src: ['ftc-scams', 'mar-irvine'] },
]
export const deskScams = { text: 'Front desk and night staff describe scam calls late at night from people posing as the owner, a manager, the fire marshal or a card-machine technician, who ask for cash from the drawer, gift cards or a change to the card machine. Their rule: no money leaves the desk on a phone call; check with your manager on a number you already have.', src: ['r-scam-staff', 'r-scam-fire', 'r-scam-pinpad', 'r-scam-patel'], firstHand: true }

// FAQ — visible on the page and mirrored in FAQPage JSON-LD (only Q&As shown on the page).
export const faq = [
  {
    q: 'Can I get a hotel job with no experience?',
    a: { text: 'Usually, yes. Front desk, housekeeping and banquet jobs need little or no experience and train you on the job, and a Courtyard front desk posting lists "No related work experience." Maintenance is the exception: it usually asks for experience first.', src: ['onet-desk', 'onet-maids', 'onet-waiters', 'mar-irvine', 'onet-maint'] },
  },
  {
    q: 'How much do hotel jobs pay?',
    a: { text: 'In the accommodation industry, the 2025 median was $16.78 an hour for housekeepers and $16.82 for front desk clerks. On Marriott postings read in November 2026, front desk and night audit jobs paid $17.50 to $23.00 an hour and a Nashville room attendant job $18.50.', src: ['bls-iag721', 'mar-basking', 'mar-rancho', 'mar-opryland'] },
  },
  {
    q: 'What does a night auditor do?',
    a: { text: 'Runs the front desk overnight and closes the day’s accounts: posting charges, running the night audit and rolling the date. A Courtyard posting in Maryland calls it an overnight position, prefers weekend availability and pays $20.53 an hour.', src: ['mar-rockville'] },
  },
  {
    q: 'If I apply on Marriott’s or Hilton’s site, do I work for them?',
    a: { text: 'Not always. Many hotels are run by a franchisee or a management company, and the posting says so: "you will be employed by a franchisee, not Marriott." Read the employer name on the posting before you apply.', src: ['franchise-austin', 'crescent-tempe'] },
  },
  {
    q: 'Do hotels have to give housekeepers panic buttons?',
    a: { text: 'In some places, yes: Washington State, Seattle, Los Angeles and New York City require them for workers alone in guest rooms or for hotel employees. Elsewhere it depends on the hotel or a union contract.', src: ['wa-isolated', 'sea-safety', 'la-hwpo-notice', 'nyc-hotels', 'culinary-2023'] },
  },
  {
    q: 'Is hotel work dangerous?',
    a: { text: 'Hotels and motels recorded 3.9 injury and illness cases per 100 full-time workers in 2024, against 2.3 across private industry. Housekeeping is the most physical job: most housekeepers stand and bend almost all shift.', src: ['bls-soii', 'onet-maids-ctx'] },
  },
]

// ── Listings: the filters on the "Hiring now" block (lib/start/listingFilters.js) ──────────────────────────────────
// Front desk, room attendant, houseperson and banquet titles ARE the entry jobs (little or no experience, trained on the
// job), so the level reads 'entryUnlessMarked': a title is experienced only when it says lead / supervisor / manager /
// senior, or the listing's own level says so. Generic titles ("Front Desk Agent", "Server", "Maintenance Technician")
// are shared with clinics, dental offices, gyms and apartment buildings — Seen's own rows read 2026-11-17 showed "front
// desk" was mostly medical and dental receptionists — so a row must carry a hotel word in its title (gateTitle) or be
// posted by a hotel employer (gateCompany). Restaurant chains' banquet rows (Maggiano's) and private-home housekeepers
// are dropped by `exclude`. Supervisor sits first so "Lead Houseman" or "Housekeeping Manager" in "All hotel jobs" is
// dealt to Supervisor; Night audit sits before Front desk so "Night Audit / Front Desk" is dealt to Night audit.
const HOTEL_TITLE = '\\b(hotels?|resorts?|motels?|inn|suites|lodge|marriott|courtyard|residence inn|springhill|fairfield|hilton|hampton|embassy suites|doubletree|homewood|hyatt|wyndham|holiday inn|crowne plaza|sheraton|westin|kimpton|roost|room attendants?|guest room attendants?|housem[ae]n|house ?persons?|night audit\\w*|bell ?(?:man|men|person|attendant|staff)|banquets?)\\b'
const HOTEL_COMPANY = '\\b(hotels?|hospitality|resorts?|motels?|inns?|suites|lodging|marriott|hilton|hyatt|ihg|kimpton|sheraton|westin|wyndham|aimbridge|hersha|highgate|sonesta|staypineapple|crescent|white lodging|hei hotels|concord hospitality|davidson|azul hospitality|stonebridge|palette hotels|method co|methodco|first chair destinations|global ambassador|crowne plaza|embassy suites)\\b'
export const listings = {
  defaultRadius: '25',
  radii: ['10', '25', '50', '100'],
  levelMode: 'entryUnlessMarked',
  levelLabels: { any: 'Any level', entry: 'Entry / no experience', experienced: 'Experienced / supervisor' },
  levelWords: { entry: 'entry-level', experienced: 'experienced' },
  gateTitle: HOTEL_TITLE,
  gateCompany: HOTEL_COMPANY,
  exclude: '\\b(sales|marketing|director|vice president|analyst|account (?:executive|manager)|recruit\\w*|talent|product manager|implementation|consultant|software|developer|programmer|accountant|attorney|nurse|lvn|patient|dental|medical|clinic\\w*|phlebotom\\w*|chiropract\\w*|dermatolog\\w*|surgery|maggiano\\w*|residential|private residence|household|home care|senior home|intern|internship|liaison|booking hotels|ticket|box office|usher|general manager|chef|sous chef|cook|dishwasher|steward)\\b',
  positions: [
    {
      id: 'all', label: 'All hotel jobs', noun: 'hotel', mix: 'positions',
      queries: ['front desk agent', 'room attendant', 'housekeeper', 'night auditor', 'houseman', 'banquet server', 'hotel maintenance', 'housekeeping supervisor'],
      seeAll: 'front desk agent',
    },
    {
      id: 'supervisor', label: 'Supervisor (experienced)', noun: 'hotel supervisor',
      queries: ['housekeeping supervisor', 'front desk supervisor', 'front office manager', 'housekeeping manager', 'guest services supervisor'],
      match: '(?:housekeeping|front office|front desk|rooms|rooms operations|guest services?|night|banquets?|laundry|engineering|maintenance|welcome desk) (?:manager|supervisor|lead)|executive housekeeper|(?:assistant )?chief engineer|lead (?:housekeeper|housem[ae]n|house ?person|room attendant)',
    },
    {
      id: 'night', label: 'Night audit', noun: 'night audit',
      queries: ['night auditor', 'night audit'],
      match: 'night audit\\w*|auditor/a de turno nocturno|overnight front desk|front desk (?:agent )?(?:overnight|night)',
    },
    {
      id: 'front-desk', label: 'Front desk', noun: 'front desk',
      queries: ['front desk agent', 'guest service agent', 'front desk', 'guest services representative'],
      match: 'front desk|front office (?:agent|associate|clerk)|guest services? (?:agent|representative|associate|specialist)|desk clerk|agente de recepcion|concierge|pbx operator',
    },
    {
      id: 'housekeeping', label: 'Housekeeping', noun: 'housekeeping',
      queries: ['room attendant', 'housekeeper', 'houseman', 'houseperson'],
      match: 'housekeep\\w*|room attendants?|guest room attendants?|housem[ae]n|house ?persons?|public areas? attendant|laundry attendant|turndown|minibar attendant',
    },
    {
      id: 'banquets', label: 'Banquets & food service', noun: 'banquet and hotel restaurant',
      queries: ['banquet server', 'banquet', 'hotel server', 'hotel bartender'],
      match: 'banquets?|\\bservers?\\b|bartenders?|barista|\\bhost\\b|bussers?|server assistant|room service|in-room dining|bar ?back',
    },
    {
      id: 'maintenance', label: 'Maintenance', noun: 'hotel maintenance',
      queries: ['hotel maintenance', 'maintenance technician', 'hotel engineer', 'maintenance engineer'],
      match: 'maintenance|engineer(?:ing)? (?:technician|tech)|\\bengineer\\b|building (?:engineer|mechanic)|painter|electrician',
    },
  ],
}

// ── The page's openable rows (components/start/Guide.tsx `Blocks` renders each block type) ──────────────────────────
export const menu = [
  {
    id: 'the-jobs', title: 'The jobs', summary: 'Seven hotel jobs, and what each pays',
    blocks: [
      { type: 'cards', items: jobs.map((j) => ({ name: j.role, aka: j.aka, body: j.what, chips: j.chips })) },
      { type: 'more', title: 'Pay in hotels and everywhere else', blocks: [
        { type: 'table', caption: 'Median hourly pay, in hotels and across every industry', columns: [{ key: 'occupation', label: 'Occupation' }, { key: 'hotels', label: 'In hotels', num: true }, { key: 'all', label: 'Every industry', num: true }], rows: payTable },
        { type: 'note', entry: payTableNote },
        { type: 'text', entries: outlook },
      ] },
    ],
  },
  {
    id: 'what-it-pays', title: 'What it pays to start', summary: 'Hotels’ own postings, and what pays more',
    blocks: [
      { type: 'text', entry: postedPayIntro },
      { type: 'table', caption: 'Pay stated on hotel postings', columns: [{ key: 'employer', label: 'Hotel' }, { key: 'role', label: 'Job' }, { key: 'pay', label: 'Stated pay', num: true }], rows: postedPay },
      { type: 'heading', text: 'What pays more' },
      { type: 'checklist', items: paysMore, cols: true },
      { type: 'text', entry: unionLine },
    ],
  },
  {
    id: 'the-work', title: 'What the work is like', summary: 'Shifts, the body, guests, injuries',
    blocks: [
      { type: 'checklist', items: work, cols: true },
      { type: 'heading', text: 'Working nights' },
      { type: 'text', entry: nightAlone, lead: 'From people who work night audit:' },
      { type: 'text', entry: nightSleep },
    ],
  },
  {
    id: 'safety', title: 'Panic buttons and workload laws', summary: 'Where the law protects housekeepers',
    blocks: [
      { type: 'checklist', items: safetyLaws },
      { type: 'text', entry: safetyUnion },
    ],
  },
  {
    id: 'getting-hired', title: 'How people get hired', summary: 'Who hires, what they ask, moving up',
    blocks: [
      { type: 'callout', entry: whoHires },
      { type: 'heading', text: 'What postings ask for' },
      { type: 'checklist', items: asks, cols: true },
      { type: 'heading', text: 'Moving up' },
      { type: 'steps', items: movingUp },
      { type: 'more', title: 'Brand management programmes', blocks: [{ type: 'text', entry: programmes }] },
      { type: 'resumeLink', before: 'Before you apply, you can', label: 'check your résumé against a posting' },
    ],
  },
  {
    id: 'watch-out', title: 'Watch out', icon: 'caution', summary: 'Job scams, and scam calls to the desk',
    blocks: [
      { type: 'notes', label: 'Job scams', items: scams, icon: 'x' },
      { type: 'text', entry: deskScams, lead: 'From people who work the front desk:' },
    ],
  },
  { id: 'questions', title: 'Common questions', summary: 'Experience, pay, nights, who you work for', blocks: [{ type: 'faq', items: faq }] },
]

// ── Additional resources: every reference above, as plain grouped links (no numbers, closed by default) ────────────
export const resourcesSummary = 'Hotels’ postings, city and state laws, pay data'
export const resources = [
  { title: 'Hotels’ postings and programmes', items: [
    { key: 'mar-irvine', name: 'Front desk agent, Courtyard Irvine Spectrum' },
    { key: 'mar-basking', name: 'Front desk agent, Courtyard Basking Ridge' },
    { key: 'mar-rancho', name: 'Front desk agent, The Ritz-Carlton Rancho Mirage' },
    { key: 'mar-rockville', name: 'Night auditor, Courtyard Rockville' },
    { key: 'mar-opryland', name: 'Room attendant, Gaylord Inn at Opryland' },
    { key: 'crescent-tempe', name: 'Houseperson, The Westin Tempe (Crescent Hotels)' },
    { key: 'mar-marina', name: 'Banquet server, Marina del Rey Marriott' },
    { key: 'mar-tysons', name: 'Banquet server, The Ritz-Carlton Tysons Corner' },
    { key: 'mar-sanantonio', name: 'Maintenance technician, Courtyard San Antonio Riverwalk' },
    { key: 'mar-nomad', name: 'Maintenance engineer, The Ritz-Carlton New York NoMad' },
    { key: 'mar-turtlebay', name: 'Front office supervisor, The Ritz-Carlton Oahu Turtle Bay' },
    { key: 'franchise-austin', name: 'Night auditor at a franchised hotel (White Lodging)' },
    { key: 'mar-early', name: 'Marriott early career programs' },
    { key: 'hilton-early', name: 'Hilton early talent programs (United States)' },
    { key: 'hilton-benefits', name: 'Hilton U.S. team member benefits' },
  ] },
  { title: 'Safety and workload laws', items: [
    { key: 'wa-isolated', name: 'Washington: isolated worker protections' },
    { key: 'sea-safety', name: 'Seattle: hotel employees safety protections' },
    { key: 'sea-injury', name: 'Seattle: protecting hotel employees from injury' },
    { key: 'la-hwpo-notice', name: 'Los Angeles: hotel worker protection notice' },
    { key: 'la-hwpo', name: 'Los Angeles: hotel worker protection rules' },
    { key: 'la-wage', name: 'Los Angeles: hotel worker minimum wage' },
    { key: 'nyc-hotels', name: 'New York City: hotel license protections' },
    { key: 'culinary-2023', name: 'Culinary Union: 2023 Las Vegas contracts' },
  ] },
  { title: 'Pay, jobs and safety data', items: [
    { key: 'bls-iag721', name: 'Accommodation industry (Bureau of Labor Statistics)' },
    { key: 'bls-soii', name: 'Injury and illness rates by industry (Bureau of Labor Statistics)' },
    { key: 'bls-union', name: 'Union membership by industry (Bureau of Labor Statistics)' },
    { key: 'onet-desk', name: 'Hotel desk clerks (O*NET)' },
    { key: 'onet-desk-ctx', name: 'Hotel desk clerks: the work in detail (O*NET)' },
    { key: 'onet-maids', name: 'Housekeepers (O*NET)' },
    { key: 'onet-maids-ctx', name: 'Housekeepers: the work in detail (O*NET)' },
    { key: 'onet-waiters', name: 'Servers, including banquet servers (O*NET)' },
    { key: 'onet-maint', name: 'Maintenance and repair workers (O*NET)' },
    { key: 'onet-valet', name: 'Parking and valet attendants (O*NET)' },
    { key: 'onet-hksup', name: 'Housekeeping supervisors (O*NET)' },
    { key: 'onet-lodging', name: 'Lodging managers (O*NET)' },
  ] },
  { title: 'Job scams', items: [
    { key: 'ftc-scams', name: 'Job scams (Federal Trade Commission)' },
  ] },
  { title: 'Community discussions', items: [
    { key: 'r-scam-staff', name: 'Scam callers pretending to be staff or owners' },
    { key: 'r-scam-fire', name: 'The fire marshal scam call' },
    { key: 'r-scam-pinpad', name: 'A night auditor who fell for a scam call' },
    { key: 'r-scam-patel', name: 'The "Mr. Patel" call' },
    { key: 'r-na-why', name: 'Why people choose night audit' },
    { key: 'r-na-hating', name: 'Burning out on night audit' },
    { key: 'r-na-alone', name: 'The only employee overnight' },
  ] },
]

/** Every fact on the page, in reading order: the hero, then each menu row. */
export function pageEntries() {
  return [guide.answer, ...tiles, ...blockEntries(menu)]
}
