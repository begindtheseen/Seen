// Which start guide (if any) a /jobs search belongs to — the one prompt card right above the results
// (components/start/GuidePrompt.tsx). A per-guide keyword table — titles, slang, certifications, places, company
// names — matched on the normalized query at word boundaries (a keyword also matches its plural). Pure; tested in
// lib/start/guideFor.test.mjs.
//
// Rules:
//   • only LIVE guides answer (lib/start/guides.js START_GUIDES); the keywords of a guide whose content has not
//     arrived wait here and never show a card;
//   • `strip` phrases are removed before that guide matches ("oil change", "credit union", "data pipeline");
//     a `veto` word anywhere means the query is about something else ("apprentice barber" is not the trades);
//   • when several guides match, the most specific wins: a company guide over a field guide, then the longest
//     keyword matched, then table order. Never more than one card.
//   • nursing: "nurse", "RN", "LPN" and "registered nurse" do NOT reach the healthcare guide. It covers paths that
//     need no nursing licence (CNA, phlebotomy, medical assistant, pharmacy tech, EMT); a registered nurse needs a
//     degree and the NCLEX, so a "start here without a degree" card would answer a different question. The aide
//     titles ("nurse aide", "nursing assistant") do reach it.

import { START_GUIDES } from './guides.js'

/** @type {Record<string, { keywords: string[], strip?: string[], veto?: string[] }>} */
export const GUIDE_KEYWORDS = {
  oilfield: {
    keywords: [
      'oil', 'gas', 'oilfield', 'oil field', 'oil and gas', 'oil rig', 'rig', 'rig hand', 'drilling rig', 'roughneck', 'roustabout',
      'floorhand', 'floor hand', 'floorman', 'derrick', 'derrickhand', 'motorhand', 'frac', 'fracking', 'frac hand', 'flowback',
      'pumper', 'lease operator', 'wireline', 'coiled tubing', 'workover', 'pulling unit', 'swamper', 'water hauler', 'sand hauler',
      'crude hauler', 'pressure pumping', 'well service', 'wellsite', 'permian', 'bakken', 'eagle ford', 'midland', 'odessa',
      'williston', 'pipeline',
    ],
    strip: [
      'oil change', 'gas station', 'gas attendant', 'olive oil', 'oil painting', 'data pipeline', 'sales pipeline', 'pipeline engineer',
      'ci pipeline', 'midland credit', 'gas utility', 'natural gas utility',
    ],
  },
  trades: {
    keywords: [
      'electrician', 'electrical apprentice', 'electrical helper', 'wireman', 'plumber', 'plumbing', 'hvac', 'hvac technician',
      'refrigeration technician', 'welder', 'welding', 'pipefitter', 'steamfitter', 'lineman', 'lineworker', 'groundman', 'apprentice',
      'apprenticeship', 'journeyman', 'carpenter', 'ironworker', 'sheet metal', 'millwright', 'elevator mechanic', 'elevator installer',
      'boilermaker', 'union', 'skilled trades', 'trade school', 'diesel mechanic', 'diesel technician', 'heavy equipment operator',
      'heavy equipment mechanic',
    ],
    strip: ['credit union', 'union pacific', 'union bank', 'union station', 'student union'],
    veto: ['barber', 'piercer', 'piercing', 'tattoo', 'stylist', 'cosmetology', 'cosmetologist', 'hair', 'nail', 'esthetician', 'chef', 'cook', 'culinary', 'baker', 'bartender', 'software', 'accounting', 'audit'],
  },
  cdl: {
    keywords: ['cdl', 'cdl a', 'cdl b', 'truck driver', 'truck driving', 'trucker', 'trucking', 'otr', 'class a', 'class b', 'tractor trailer', 'semi', 'semi truck', 'box truck driver', 'delivery driver', 'hazmat', 'tanker'],
  },
  healthcare: {
    keywords: [
      'cna', 'certified nursing assistant', 'nursing assistant', 'nurse aide', 'phlebotomy', 'phlebotomist', 'medical assistant',
      'pharmacy tech', 'pharmacy technician', 'emt', 'paramedic', 'patient care tech', 'patient care technician', 'pct', 'caregiver',
      'home health aide', 'hha', 'medical receptionist', 'sterile processing',
    ],
  },
  warehouse: {
    keywords: [
      'warehouse', 'forklift', 'picker', 'packer', 'order picker', 'material handler', 'fulfillment', 'shipping', 'receiving',
      'loader', 'unloader', 'dock worker', 'inventory', 'logistics', 'distribution center', 'amazon warehouse',
    ],
  },
  it: {
    keywords: ['help desk', 'helpdesk', 'it support', 'tech support', 'technical support', 'desktop support', 'service desk', 'comptia', 'a+', 'it technician', 'computer technician', 'entry level it'],
  },
  spacex: { keywords: ['spacex', 'space x', 'starbase', 'starlink', 'rocket'] },
  tesla: { keywords: ['tesla', 'gigafactory', 'giga texas', 'giga nevada', 'model y', 'tesla technician'] },
}

/** Lower case, "&" → "and", every other mark → a space ("a+" keeps its plus); single spaces. */
export function normalizeQuery(q) {
  return ` ${String(q || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9+]+/g, ' ').replace(/\s+/g, ' ').trim()} `
}

const has = (text, phrase) => {
  const p = normalizeQuery(phrase).trim()
  return text.includes(` ${p} `) || text.includes(` ${p}s `) || text.includes(` ${p}es `)
}

/** The longest keyword of one guide the query matches (its length), or 0. */
function bestKeyword(text, table) {
  let t = text
  for (const s of table.strip || []) {
    const p = normalizeQuery(s).trim()
    for (const form of [p, `${p}s`]) while (t.includes(` ${form} `)) t = t.replace(` ${form} `, ' ')
  }
  if ((table.veto || []).some((v) => has(t, v))) return 0
  let best = 0
  for (const k of table.keywords) if (has(t, k)) best = Math.max(best, normalizeQuery(k).trim().length)
  return best
}

/**
 * The most specific guide among `fields` (default: every guide in the table) a query belongs to, or null.
 * @param {string} query
 * @param {string[]} [fields]
 */
export function matchGuide(query, fields = Object.keys(GUIDE_KEYWORDS)) {
  const text = normalizeQuery(query)
  if (!text.trim()) return null
  const kind = (f) => (f === 'spacex' || f === 'tesla' ? 1 : 0)
  let pick = null
  for (const f of fields) {
    const table = GUIDE_KEYWORDS[f]
    if (!table) continue
    const len = bestKeyword(text, table)
    if (!len) continue
    if (!pick || kind(f) > kind(pick.f) || (kind(f) === kind(pick.f) && len > pick.len)) pick = { f, len }
  }
  return pick ? pick.f : null
}

/** The live guide a /jobs search belongs to (its registry entry), or null. */
export function guideForQuery(query) {
  const f = matchGuide(query, START_GUIDES.map((g) => g.field))
  return f ? START_GUIDES.find((g) => g.field === f) || null : null
}
