// The start guides (/start/<field>): ONE registry every surface reads — the dynamic route's static params
// (app/start/[field]/page.tsx), the sitemap, llms.txt and the /jobs prompt card (lib/start/guideFor.js). Pure; no
// imports, so any surface (server page, client card, node --test) can use it without pulling a guide's content.
//
// A guide is LIVE only once its content module exists and is registered in lib/start/registry.js (`ready: true`
// here; lib/start/guides.test.mjs fails when the two lists disagree). A guide that is not live has no route, no
// sitemap entry and never shows a card — its keywords may sit in guideFor.js ahead of time.
//
// The guides are NOT a section of the site (owner 2026-11-14): no footer or nav links; search engines find them
// through the sitemap and llms.txt, and job seekers through the card above matching /jobs results.

/**
 * @typedef {{
 *   field: string, kind: 'field' | 'company', path: string, label: string,
 *   prompt: string, llms: string, ready: boolean,
 * }} GuideMeta
 */

/** @type {ReadonlyArray<GuideMeta>} */
export const GUIDES = [
  {
    field: 'oilfield', kind: 'field', path: '/start/oilfield', label: 'Getting into oilfield work', ready: true,
    prompt: 'What the big drillers ask for, what they pay, and who’s hiring beginners now.',
    llms: 'entry jobs, what drillers and service companies ask for, starting pay, tickets, and live entry listings by position, place and level',
  },
  {
    field: 'trades', kind: 'field', path: '/start/trades', label: 'Getting into the trades', ready: true,
    prompt: 'How paid apprenticeships work, what they pay from day one, and who’s hiring apprentices now.',
    llms: 'paid apprenticeships, the aptitude test, employers that train, free programs, and live apprentice and journeyman listings by trade, place and level',
  },
  { field: 'cdl', kind: 'field', path: '/start/cdl', label: 'Getting into CDL trucking', ready: true, prompt: 'How to get a CDL, who pays for training, what the contracts ask, and who hires new drivers now.', llms: 'the steps to a CDL, who can drive, paying for school, carrier-paid training terms, the first year, and live CDL listings by kind of driving, place and level' },
  { field: 'healthcare', kind: 'field', path: '/start/healthcare', label: 'Getting into healthcare without a degree', ready: true, prompt: 'CNA, phlebotomy, medical assistant, pharmacy tech, EMT and more: what each takes, who pays for training, and who’s hiring.', llms: 'CNA, phlebotomy, medical assistant, pharmacy technician and EMT paths' },
  { field: 'warehouse', kind: 'field', path: '/start/warehouse', label: 'Getting into warehouse and logistics work', ready: true, prompt: 'What warehouse jobs pay, what the work asks of you, and who’s hiring near you now.', llms: 'warehouse and logistics jobs, shifts, pay and certifications' },
  { field: 'it', kind: 'field', path: '/start/it', label: 'Getting into IT help desk work', ready: true, prompt: 'The certifications that matter, what help desk jobs pay, and who hires beginners.', llms: 'IT help desk and support jobs, certifications and entry roles' },
  { field: 'spacex', kind: 'company', path: '/start/spacex', label: 'Getting hired at SpaceX', ready: true, prompt: 'What SpaceX asks for by role, how its hiring works, and its open roles now.', llms: 'how SpaceX hires, by role family, with its open roles' },
  { field: 'tesla', kind: 'company', path: '/start/tesla', label: 'Getting hired at Tesla', ready: true, prompt: 'What Tesla asks for by role, what it pays, and how to find its open roles.', llms: 'how Tesla hires, by role family: what its postings ask for, stated pay, paid training, and where to find its open roles' },
  { field: 'security', kind: 'field', path: '/start/security', label: 'Getting into security guard work', ready: false, prompt: 'Guard cards by state, armed vs unarmed, what guards are paid, and who trains new officers.', llms: 'security guard work: state guard cards and licences, armed and unarmed roles, pay, and live guard listings by role, place and level' },
  { field: 'retail', kind: 'field', path: '/start/retail', label: 'Getting into retail work', ready: true, prompt: 'Cashier, sales and overnight stocking: what stores pay to start, how they hire, and your schedule rights.', llms: 'retail jobs: cashier, sales associate and stocking roles, starting pay, how stores hire, scheduling laws, and live retail listings' },
  { field: 'restaurants', kind: 'field', path: '/start/restaurants', label: 'Getting into restaurant work', ready: false, prompt: 'Food handler cards, tipped pay rules, what kitchens and counters pay, and who’s hiring.', llms: 'restaurant jobs: food handler cards, tipped minimum wage and tip pooling, pay by role, and live restaurant listings' },
  { field: 'hotels', kind: 'field', path: '/start/hotels', label: 'Getting into hotel work', ready: false, prompt: 'Front desk, housekeeping and maintenance: what each pays, the work, and who’s hiring.', llms: 'hotel jobs: front desk, housekeeping, maintenance, night audit and banquets, pay, and live hotel listings' },
  { field: 'delivery', kind: 'field', path: '/start/delivery', label: 'Getting into delivery driving (no CDL)', ready: false, prompt: 'Route, courier and box-truck jobs that need no CDL, what they pay, and app gig work explained honestly.', llms: 'delivery driving without a CDL: route and courier jobs, driving-record checks, gig app costs, pay, and live delivery listings' },
  { field: 'callcenter', kind: 'field', path: '/start/callcenter', label: 'Getting into call center and customer service work', ready: true, prompt: 'What customer service jobs pay, remote setups, the screening, and work-from-home scams to avoid.', llms: 'call center and customer service jobs: remote and on-site roles, screening, pay, scams to avoid, and live listings' },
  { field: 'dental', kind: 'field', path: '/start/dental', label: 'Getting into dental work without a degree', ready: true, prompt: 'Dental assistant, sterilization and front desk: state x-ray rules, DANB exams, pay, and who’s hiring.', llms: 'dental assistant, sterilization, front office and lab jobs: state rules, DANB certification, pay, and live dental listings' },
  { field: 'energy', kind: 'field', path: '/start/energy', label: 'Getting into solar and wind work', ready: true, prompt: 'Solar installer and wind technician jobs: what they pay, the climbing and travel, and who trains beginners.', llms: 'solar installer, battery storage and wind technician jobs: pay, NABCEP and GWO, heights and travel, and live renewable-energy listings' },
  { field: 'secondchance', kind: 'field', path: '/start/secondchance', label: 'Getting hired with a record', ready: true, prompt: 'Your rights in a background check, when employers can ask, record clearing, and free bonding.', llms: 'getting hired with a criminal record: fair-chance rules, background-check rights, record clearing, the Federal Bonding Program, and licences' },
  { field: 'federal', kind: 'field', path: '/start/federal', label: 'Getting a federal job', ready: false, prompt: 'How USAJOBS works, GS pay by city, jobs without a degree, and paths for students and veterans.', llms: 'federal jobs: USAJOBS applications, GS pay and locality, entry jobs without a degree, Pathways, veterans’ preference and Schedule A' },
  { field: 'amazon', kind: 'company', path: '/start/amazon', label: 'Getting hired at Amazon', ready: false, prompt: 'How Amazon hires for its buildings, what it pays, Career Choice, and how Flex and delivery partners differ.', llms: 'how Amazon hires for fulfillment, sort and delivery-station jobs: stated pay, shifts, Career Choice, safety data, and corporate hiring' },
  { field: 'walmart', kind: 'company', path: '/start/walmart', label: 'Getting hired at Walmart', ready: true, prompt: 'Store, distribution and driver jobs: what Walmart pays, how it hires, and Live Better U.', llms: 'how Walmart hires for store, distribution center and driver jobs: stated pay, Live Better U, Walmart Academy, and moving up' },
  { field: 'target', kind: 'company', path: '/start/target', label: 'Getting hired at Target', ready: true, prompt: 'Store and warehouse jobs: Target’s posted pay, how it hires, seasonal work and Dream to Be.', llms: 'how Target hires for store and warehouse jobs: posted pay, the hiring steps, seasonal work, Dream to Be, and moving up' },
  { field: 'ups', kind: 'company', path: '/start/ups', label: 'Getting hired at UPS', ready: true, prompt: 'Package handler, helper and driver jobs: posted pay, the Teamsters contract, and part-time to full-time.', llms: 'how UPS hires package handlers, driver helpers and drivers: posted pay, the Teamsters contract scale, seasonal work, and the path to full time' },
  { field: 'fedex', kind: 'company', path: '/start/fedex', label: 'Getting hired at FedEx', ready: false, prompt: 'Handler, courier and driver jobs, and why many FedEx Ground drivers work for contractors.', llms: 'how FedEx hires package handlers, couriers and freight drivers, and how FedEx Ground contractor jobs differ' },
  { field: 'costco', kind: 'company', path: '/start/costco', label: 'Getting hired at Costco', ready: false, prompt: 'How Costco hires, what it pays from day one, and how part-time turns into more.', llms: 'how Costco hires for warehouse, depot and call center jobs: stated pay, applying and re-applying, and moving up' },
  { field: 'starbucks', kind: 'company', path: '/start/starbucks', label: 'Getting hired at Starbucks', ready: false, prompt: 'Barista and shift jobs: posted pay, benefits at 20 hours, the ASU college plan, and licensed stores.', llms: 'how Starbucks hires baristas and shift supervisors: posted pay, benefits, the ASU college plan, licensed stores, and the union' },
  { field: 'homedepot', kind: 'company', path: '/start/homedepot', label: 'Getting hired at The Home Depot', ready: false, prompt: 'Store, freight and supply chain jobs: posted pay, how it hires, and its trades programs.', llms: 'how The Home Depot hires for store, freight, supply chain and driver jobs: posted pay, hiring steps, and Path to Pro' },
  { field: 'usps', kind: 'company', path: '/start/usps', label: 'Getting hired at the Postal Service', ready: false, prompt: 'Carrier, clerk and mail handler jobs: the entry assessment, union pay, and the path to a career job.', llms: 'how the Postal Service hires carriers, clerks and mail handlers: the Virtual Entry Assessment, contract pay, and non-career to career' },
  { field: 'lowes', kind: 'company', path: '/start/lowes', label: 'Getting hired at Lowe’s', ready: false, prompt: 'Store, warehouse and driver jobs: posted pay, how Lowe’s hires, and Track to the Trades.', llms: 'how Lowe’s hires for store, distribution center and driver jobs: posted pay, hiring steps, and Track to the Trades' },
]

/** The live guides (content registered): the route's params, the sitemap and llms.txt read this. */
export const START_GUIDES = GUIDES.filter((g) => g.ready)

/** A live guide by its field (the route segment), or null. */
export function startGuide(field) {
  return START_GUIDES.find((g) => g.field === field) || null
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "2026-11-13" → "Nov 13, 2026"; "2023-03" → "Mar 2023". Read from the string itself: no time zone can move it. */
export function formatSourceDate(iso) {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(String(iso || ''))
  if (!m) return ''
  return m[3] ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : `${MONTHS[Number(m[2]) - 1]} ${m[1]}`
}

/** "2026-11-13" → "Updated November 2026" — the one quiet date line in a guide's hero. */
export function updatedLine(iso) {
  const m = /^(\d{4})-(\d{2})/.exec(String(iso || ''))
  return m ? `Updated ${MONTHS_LONG[Number(m[2]) - 1]} ${m[1]}` : ''
}

/** The host a link points to ("bls.gov"), shown beside a resource link. */
export function sourceHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}
