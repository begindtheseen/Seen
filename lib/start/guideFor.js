// Which "getting in" guide (if any) a job search belongs to — the one quiet line under the results on /jobs
// ("New to oilfield work? How people get in →"). Read-only use of search's own curated families
// (api/_utils/jobRelevance.js expandQueryTerms): a query belongs to a guide when its family holds that guide's
// roles, so the line follows search exactly — "roustabout", "oilfield jobs", "water hauler" reach the oilfield
// guide; "apprentice electrician", "hvac", "groundman" reach the trades guide; "cashier", "software engineer" and
// "apprentice piercer" (no trade family) reach none.
//
// expandQueryTerms leaves out the query itself, so each guide names several roles of each family: a query equal
// to one of them still finds another.

import { expandQueryTerms } from '../../api/_utils/jobRelevance.js'

const OILFIELD_ROLES = [
  'roustabout', 'floorhand', 'roughneck', 'frac hand', // oilfield field hands
  'water hauler', 'sand hauler', 'crude hauler', // oilfield hauling
]
const TRADES_ROLES = [
  'electrician', 'electrical apprentice', 'wireman', // electrical
  'plumber', 'pipefitter', 'steamfitter', // plumbing and pipe trades
  'hvac technician', 'hvac installer', 'refrigeration technician', // HVAC/R
  'welder', 'pipe welder', 'welder fitter', // welding
  'lineman', 'lineworker', 'groundman', // line work
  'heavy equipment operator', 'excavator operator', 'dozer operator', // heavy equipment
  'diesel mechanic', 'diesel technician', 'heavy duty mechanic', // diesel
  'carpenter apprentice', 'sheet metal apprentice', 'ironworker apprentice', // apprenticeship / trades
]

export const GUIDE_LINES = {
  oilfield: { href: '/start/oilfield', text: 'New to oilfield work? How people get in' },
  trades: { href: '/start/trades', text: 'New to the trades? Apprenticeships and paid training' },
}

/** @returns {'oilfield' | 'trades' | null} */
export function guideForQuery(query) {
  const q = String(query || '').trim()
  if (!q) return null
  const terms = new Set(expandQueryTerms(q, 500))
  if (!terms.size) return null
  if (OILFIELD_ROLES.some((r) => terms.has(r))) return 'oilfield'
  if (TRADES_ROLES.some((r) => terms.has(r))) return 'trades'
  return null
}
