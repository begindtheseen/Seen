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
      'williston', 'pipeline', 'oilfield driver', 'oil field driver', 'oilfield cdl', 'oilfield cdl driver', 'oilfield truck driver',
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
    keywords: [
      'cdl', 'cdl a', 'cdl b', 'cdl driver', 'class a', 'class b', 'class a driver', 'class b driver', 'truck driver', 'truck driving',
      'trucker', 'trucking', 'otr', 'otr driver', 'over the road', 'regional driver', 'local truck driver', 'long haul', 'linehaul',
      'team driver', 'flatbed driver', 'reefer driver', 'dry van driver', 'tractor trailer', 'tractor trailer driver', 'semi',
      'semi truck', 'semi truck driver', '18 wheeler', 'box truck driver', 'straight truck driver', 'dump truck driver', 'hazmat',
      'hazmat driver', 'tanker', 'tanker driver', 'yard jockey', 'yard hostler', 'hostler', 'spotter driver', 'ltl driver',
      'cdl trainee', 'student truck driver', 'cdl student', 'truck driver trainee', 'cdl apprentice', 'cdl school', 'cdl training',
      'paid cdl training', 'company sponsored cdl', 'cdl permit', 'eldt', 'dot physical', 'hazmat endorsement',
    ],
    strip: ['non cdl', 'cdl not required', 'no cdl'],
    veto: ['courier', 'rideshare', 'uber', 'doordash', 'pizza', 'amazon flex', 'bus aide'],
  },
  healthcare: {
    keywords: [
      'cna', 'certified nursing assistant', 'nursing assistant', 'nurse aide', 'nurses aide', 'nurse s aide', 'nursing aide',
      'certified nurse aide', 'stna', 'lna', 'gna', 'cna class', 'cna training', 'cna trainee', 'nurse aide trainee', 'natcep',
      'phlebotomy', 'phlebotomist', 'phleb', 'phlebotomy technician', 'phlebotomy tech', 'mobile phlebotomist',
      'patient service technician', 'medical assistant', 'clinical medical assistant', 'certified medical assistant',
      'registered medical assistant', 'rma', 'ccma', 'pharmacy tech', 'pharmacy technician', 'pharm tech', 'cpht',
      'pharmacy technician trainee', 'emt', 'emt b', 'emtb', 'emt basic', 'aemt', 'advanced emt', 'emergency medical technician',
      'paramedic', 'patient care tech', 'patient care technician', 'patient care assistant', 'patient care associate', 'caregiver',
      'home health aide', 'hha', 'chha', 'home care aide', 'hospice aide', 'personal care aide', 'in home caregiver',
      'sterile processing', 'sterile processing technician', 'sterile tech', 'central sterile', 'central service technician',
      'crcst', 'spd tech',
    ],
    strip: ['cna financial', 'cna insurance', 'cma accountant'],
    veto: ['accountant', 'accounting', 'underwriter', 'insurance', 'patent', 'paralegal', 'attorney', 'veterinary', 'vet tech', 'animal', 'dental', 'billing', 'coder', 'coding', 'scribe', 'instructor'],
  },
  warehouse: {
    keywords: [
      'warehouse', 'warehouse associate', 'warehouse worker', 'forklift', 'forklift operator', 'forklift driver', 'reach truck',
      'pallet jack', 'picker', 'packer', 'order picker', 'order selector', 'order filler', 'orderfiller', 'material handler',
      'package handler', 'freight handler', 'stower', 'sorter', 'fulfillment', 'fulfillment associate', 'shipping', 'receiving',
      'shipping and receiving', 'loader', 'unloader', 'dock worker', 'inventory associate', 'inventory clerk', 'cycle counter',
      'logistics', 'distribution center', 'amazon warehouse', 'sort center', 'delivery station', 'preload', 'warehouse lead',
      'warehouse supervisor',
    ],
    strip: ['wheel loader', 'front end loader', 'loader operator', 'skid steer loader', 'logistics engineer', 'logistics analyst', 'logistics manager'],
    veto: ['pharmacy', 'meat', 'mover', 'movers', 'moving', 'farm', 'harvest', 'fruit', 'excavator', 'software', 'wms', 'cdl'],
  },
  it: {
    keywords: [
      'help desk', 'helpdesk', 'help desk technician', 'help desk analyst', 'service desk', 'service desk analyst', 'it support',
      'it support specialist', 'it specialist', 'tech support', 'technical support', 'desktop support', 'desktop technician',
      'deskside support', 'end user support', 'tier 1 support', 'level 1 support', 'comptia', 'a+', 'network+', 'google it support',
      'it technician', 'computer technician', 'entry level it', 'junior systems administrator',
    ],
    strip: ['benefits help desk', 'hr help desk', 'patient help desk', 'member services help desk', 'front desk'],
    veto: ['pharmacy', 'hvac', 'automotive', 'maintenance', 'cable', 'software engineer', 'sales'],
  },
  spacex: {
    keywords: [
      'spacex', 'space x', 'space exploration technologies', 'starbase', 'boca chica', 'starlink', 'starshield', 'starship',
      'super heavy', 'falcon 9', 'raptor engine', 'starlink factory', 'akoustis',
    ],
    strip: ['spacexsi', 'space kinetic'],
  },
  tesla: {
    keywords: [
      'tesla', 'tesla motors', 'tesla inc', 'gigafactory', 'giga texas', 'giga nevada', 'giga new york', 'tesla fremont',
      'fremont factory', 'tesla buffalo', 'megafactory', 'lathrop megafactory', 'megapack', 'powerwall', 'tesla start',
      'tesla service technician', 'tesla production associate', 'tesla material handler', 'tesla advisor', 'cybercab',
      'tesla optimus', 'tesla semi',
    ],
  },
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
