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
  { field: 'cdl', kind: 'field', path: '/start/cdl', label: 'Getting into CDL trucking', ready: false, prompt: 'How to get a CDL, who pays for training, and who hires new drivers now.', llms: 'CDL training, company-paid schools, and new-driver jobs' },
  { field: 'healthcare', kind: 'field', path: '/start/healthcare', label: 'Getting into healthcare without a degree', ready: true, prompt: 'CNA, phlebotomy, medical assistant, pharmacy tech, EMT and more: what each takes, who pays for training, and who’s hiring.', llms: 'CNA, phlebotomy, medical assistant, pharmacy technician and EMT paths' },
  { field: 'warehouse', kind: 'field', path: '/start/warehouse', label: 'Getting into warehouse and logistics work', ready: true, prompt: 'What warehouse jobs pay, what the work asks of you, and who’s hiring near you now.', llms: 'warehouse and logistics jobs, shifts, pay and certifications' },
  { field: 'it', kind: 'field', path: '/start/it', label: 'Getting into IT help desk work', ready: true, prompt: 'The certifications that matter, what help desk jobs pay, and who hires beginners.', llms: 'IT help desk and support jobs, certifications and entry roles' },
  { field: 'spacex', kind: 'company', path: '/start/spacex', label: 'Getting hired at SpaceX', ready: true, prompt: 'What SpaceX asks for by role, how its hiring works, and its open roles now.', llms: 'how SpaceX hires, by role family, with its open roles' },
  { field: 'tesla', kind: 'company', path: '/start/tesla', label: 'Getting hired at Tesla', ready: true, prompt: 'What Tesla asks for by role, what it pays, and how to find its open roles.', llms: 'how Tesla hires, by role family: what its postings ask for, stated pay, paid training, and where to find its open roles' },
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
