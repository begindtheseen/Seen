// The content behind each LIVE start guide (server side: the dynamic route app/start/[field]/page.tsx reads it).
// Adding a guide = add its module here AND set `ready: true` on its entry in lib/start/guides.js
// (lib/start/guides.test.mjs fails when the two disagree, and runs every content check on every module listed here).
//
// A content module exports (see lib/start/oilfield.js for the reference):
//   guide     { path, title, crumbLabel, eyebrow, answer: entry, metaDescription, asOf }
//   tiles     three { label, value, text, src } readings for the hero
//   listings  the "Hiring now" filter config (lib/start/listingFilters.js): positions → queries, levels, radii;
//             a company guide also sets `employer` (a pattern the row's company must match)
//   menu      the openable rows: { id, title, summary, icon?, blocks } (block types: components/start/Blocks.tsx)
//   faq       [{ q, a: entry }] — rendered by a { type: 'faq' } block and mirrored in FAQPage JSON-LD
//   sources   every reference behind the facts (never printed as citations)
//   resources [{ title, items: [{ key, name }] }] — the grouped "Additional resources" links (every source once)
//   pageEntries()  every fact on the page (each carries `src`)

import * as oilfield from './oilfield.js'
import * as trades from './trades.js'
import * as cdl from './cdl.js'
import * as healthcare from './healthcare.js'
import * as warehouse from './warehouse.js'
import * as it from './it.js'
import * as spacex from './spacex.js'
import * as tesla from './tesla.js'
import * as amazon from './amazon.js'
import * as delivery from './delivery.js'
import * as usps from './usps.js'
import * as costco from './costco.js'
import * as lowes from './lowes.js'
import * as federal from './federal.js'
import * as security from './security.js'
import * as callcenter from './callcenter.js'
import * as retail from './retail.js'
import * as energy from './energy.js'
import * as ups from './ups.js'
import * as target from './target.js'
import * as walmart from './walmart.js'
import * as dental from './dental.js'
import * as secondchance from './secondchance.js'

export const CONTENT = { oilfield, trades, cdl, healthcare, warehouse, it, spacex, tesla, secondchance, dental, walmart, target, ups, energy, retail, callcenter, security, federal, lowes, costco, usps, delivery, amazon }

/** A live guide's content module, or null. */
export function guideContent(field) {
  return Object.prototype.hasOwnProperty.call(CONTENT, field) ? CONTENT[field] : null
}
