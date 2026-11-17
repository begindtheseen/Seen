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

import { GUIDES, START_GUIDES } from './guides.js'

const COMPANY = new Set(GUIDES.filter((g) => g.kind === 'company').map((g) => g.field))

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
    veto: ['non cdl', 'cdl not required', 'no cdl', 'courier', 'rideshare', 'uber', 'doordash', 'pizza', 'amazon flex', 'bus aide'],
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
  security: {
    keywords: ['security guard', 'security officer', 'unarmed security', 'unarmed security officer', 'armed security', 'armed security officer', 'armed guard', 'guard card', 'security license', 'mobile patrol', 'patrol officer', 'loss prevention', 'loss prevention officer', 'asset protection', 'assets protection', 'event security', 'security supervisor', 'perc card', 'class d license', 'class g license', 'level ii security', 'level iii security', 'commissioned security officer', 'non commissioned security officer', 'bsis guard card'],
    strip: ['data loss prevention', 'social security', 'security deposit', 'security clearance'],
    veto: ['information security', 'cybersecurity', 'cyber', 'isso', 'ciso', 'information systems security', 'facility security officer', 'fso', 'security analyst', 'security engineer', 'security architect', 'securities', 'national guard', 'coast guard', 'lifeguard', 'crossing guard', 'safeguard', 'police', 'sheriff', 'deputy', 'border patrol', 'corrections'],
  },
  retail: {
    keywords: ['cashier', 'retail', 'retail associate', 'retail sales', 'retail sales associate', 'sales associate', 'store associate', 'stocker', 'overnight stocker', 'stock associate', 'stock clerk', 'key holder', 'keyholder', 'assistant store manager', 'shift supervisor retail', 'front end cashier', 'guest services', 'merchandiser'],
    strip: ['cashier s check', 'retail banker', 'retail pharmacist', 'vault cashier', 'stock trading', 'stock administrator', 'stock plan', 'front end engineer', 'front end developer'],
    veto: ['medical device', 'inside sales', 'outside sales', 'software', 'stockton', 'restaurant', 'fast food'],
  },
  restaurants: {
    keywords: ['restaurant', 'restaurants', 'cook', 'line cook', 'prep cook', 'dishwasher', 'server', 'waiter', 'waitress', 'host', 'hostess', 'busser', 'food runner', 'barista', 'crew member', 'fast food', 'fast food cashier', 'restaurant cashier', 'kitchen', 'kitchen staff', 'kitchen manager', 'shift lead restaurant', 'food handler', 'servsafe', 'bartender', 'fry cook', 'grill cook', 'food prep'],
    strip: ['sql server', 'server engineer', 'server administrator', 'process server', 'windows server', 'linux server', 'web server', 'server technician', 'host based', 'web host'],
    veto: ['software', 'network', 'data center', 'flight', 'airline', 'cabin', 'film', 'hospital', 'correctional'],
  },
  hotels: {
    keywords: ['hotel', 'hotels', 'front desk agent', 'hotel front desk', 'guest service agent', 'room attendant', 'housekeeper', 'housekeeping', 'houseman', 'house person', 'night auditor', 'night audit', 'banquet server', 'banquet', 'valet', 'bellhop', 'bellman', 'bell attendant', 'concierge', 'resort', 'hospitality'],
    strip: ['environmental services', 'evs housekeeping'],
    veto: ['hospital', 'medical', 'dental', 'software'],
  },
  delivery: {
    keywords: ['delivery driver', 'delivery', 'courier', 'route driver', 'non cdl', 'non cdl driver', 'no cdl driver', 'non cdl box truck', 'box truck non cdl', 'van driver', 'cargo van driver', 'package delivery driver', 'dsp driver', 'amazon dsp', 'delivery associate', 'driver helper', 'delivery helper', 'pharmacy delivery driver', 'parts driver', 'auto parts driver', 'last mile', 'doordash', 'uber eats', 'instacart', 'gig driver', 'food delivery', 'spark driver', 'amazon flex', 'flex driver', 'route sales', 'route sales driver', 'driver sales', 'medical courier', 'lab courier', 'pharmacy courier', 'courier driver', 'parcel delivery driver', 'seasonal driver helper', 'sprinter van driver', 'non cdl delivery driver'],
    strip: ['delivery manager', 'software delivery', 'service delivery', 'delivery lead', 'continuous delivery', 'labor and delivery', 'delivery room', 'delivery nurse', 'delivery consultant', 'route sales manager'],
    veto: ['drone', 'software', 'cdl a', 'class a', 'class b', 'cdl b', 'tractor', 'tanker', 'hazmat', 'otr', 'engineer', 'manager', 'junk removal', 'bus driver', 'nurse'],
  },
  callcenter: {
    keywords: ['customer service representative', 'customer service rep', 'csr', 'call center', 'call centre', 'contact center', 'call center agent', 'customer care', 'customer care representative', 'customer support specialist', 'customer support', 'chat support', 'email support', 'bilingual customer service', 'collections representative', 'collections specialist', 'debt collector', 'inside sales representative', 'member services representative', 'work from home customer service', 'remote customer service'],
    strip: ['csr manager', 'corporate social responsibility', 'customer success'],
    veto: ['manager', 'director', 'support engineer', 'help desk', 'helpdesk', 'cashier', 'teller', 'veterinary', 'data collector', 'collectibles', 'toll collector', 'curator', 'account executive', 'sustainability'],
  },
  dental: {
    keywords: ['dental assistant', 'registered dental assistant', 'rda', 'efda', 'expanded function dental assistant', 'chairside assistant', 'dental sterilization', 'dental sterilizer', 'dental receptionist', 'dental front desk', 'dental office', 'dental treatment coordinator', 'dental lab technician', 'dental technician', 'dental', 'danb'],
    strip: ['medical dental and vision', 'dental and vision', 'dental insurance', 'dental benefits'],
    veto: ['hygienist', 'rdh', 'dentist', 'dental sales', 'veterinary', 'sterile processing', 'central sterile'],
  },
  energy: {
    keywords: ['solar', 'solar installer', 'solar panel installer', 'pv installer', 'solar technician', 'solar field technician', 'solar laborer', 'solar groundman', 'solar helper', 'solar electrician', 'solar foreman', 'lead solar installer', 'bess technician', 'battery storage technician', 'energy storage technician', 'wind technician', 'wind turbine technician', 'windtech', 'wind tech', 'renewable energy', 'renewable energy technician', 'nabcep', 'gwo'],
    strip: ['solar cell', 'space solar', 'solar array engineer', 'wind tunnel', 'windshield'],
    veto: ['starlink', 'spacecraft', 'satellite', 'solar sales', 'solar consultant', 'solar energy consultant', 'battery engineer', 'battery test technician', 'ev battery', 'tire and battery', 'battery cell', 'window installer', 'pv sonographer', 'fpv', 'pharmacovigilance', 'gas turbine', 'turbine generator'],
  },
  secondchance: {
    keywords: ['felon', 'felons', 'felony', 'felon friendly', 'felony friendly', 'second chance', 'second chance jobs', 'second chance hiring', 'second chance employer', 'fair chance', 'fair chance hiring', 'fair chance employer', 'criminal record', 'with a record', 'reentry', 're entry', 'ex offender', 'returning citizen', 'justice involved', 'jobs after prison', 'ban the box', 'background check friendly'],
    veto: ['reentry specialist', 'reentry coordinator', 're entry case manager', 'reentry case manager', 'background investigator', 'background screening', 'criminal justice', 'criminal defense', 'corrections officer', 'records clerk', 'medical records', 'prosecutor'],
  },
  federal: {
    keywords: ['federal job', 'federal jobs', 'federal government', 'government job', 'government jobs', 'usajobs', 'gs 4', 'gs 5', 'gs 7', 'gs 9', 'general schedule', 'tsa', 'tsa officer', 'transportation security officer', 'tso', 'wildland firefighter', 'forestry technician fire', 'housekeeping aid', 'federal internship', 'pathways program', 'recent graduates program', 'schedule a', 'veterans preference', 'veteran preference'],
    strip: ['federal account executive', 'federal sales', 'federal credit union', 'federal reserve', 'federal tax', 'federal compliance'],
    veto: ['fedex', 'federal express', 'state trooper', 'contractor'],
  },
  amazon: {
    keywords: ['amazon', 'amazon warehouse', 'amazon fulfillment', 'fulfillment center associate', 'amazon fulfillment center', 'sortation center', 'amazon sort center', 'delivery station associate', 'amazon delivery station', 'amazon seasonal', 'amazon process assistant', 'area manager amazon', 'amazon area manager', 'amazon rme', 'mechatronics and robotics', 'amazon career choice', 'amazon jobs', 'amazon hiring'],
    strip: ['sell on amazon', 'amazon seller'],
    veto: ['amazon flex', 'flex', 'dsp', 'delivery service partner', 'delivery driver', 'freight partner', 'aws', 'kuiper', 'leo', 'amazon pharmacy', 'whole foods', 'software'],
  },
  walmart: {
    keywords: ['walmart', 'wal mart', 'walmart supercenter', 'walmart distribution center', 'walmart dc', 'walmart fulfillment', 'walmart truck driver', 'walmart overnight stocker', 'walmart cashier', 'walmart online order filler', 'walmart team lead', 'walmart coach', 'sam s club', 'sams club', 'live better u'],
    strip: ['walmart marketplace', 'walmart seller', 'walmart plus', 'walmart gift card', 'sam s club membership'],
    veto: ['spark', 'walmart labs', 'software engineer'],
  },
  target: {
    keywords: ['target store', 'target team member', 'target guest advocate', 'target cashier', 'target starbucks barista', 'target fulfillment', 'target drive up', 'target inbound', 'target distribution center', 'target warehouse', 'target seasonal', 'target executive team leader', 'target etl', 'target team leader', 'working at target', 'jobs at target', 'target jobs', 'target corporation', 'target hiring'],
    veto: ['target temporaries', 'targetcw', 'target hospitality', 'target logistics', 'target recruitment', 'target audience', 'target market', 'target marketing', 'targeted', 'targeting', 'target date', 'target range', 'target practice', 'target shooting', 'target account', 'on target'],
  },
  ups: {
    keywords: ['ups', 'united parcel service', 'ups package handler', 'ups driver helper', 'ups seasonal support driver', 'ups feeder driver', 'ups preload', 'upsjobs', 'ups jobs', 'ups driver'],
    strip: ['the ups store', 'ups battery', 'ups technician', 'ups systems'],
    veto: ['upstart', 'upshop', 'startups', 'pickups', 'vertiv', 'eaton', 'schneider'],
  },
  fedex: {
    keywords: ['fedex', 'fed ex', 'federal express', 'fedex ground', 'fedex express', 'fedex freight', 'fedex package handler', 'fedex driver', 'fedex courier', 'fedex jobs', 'fedex contractor', 'fedex isp', 'fedex office'],
    veto: ['fedex tracking', 'fedex drop off', 'print at fedex', 'kinkos', 'dhl'],
  },
  costco: {
    keywords: ['costco', 'costco wholesale', 'costco warehouse', 'costco cashier', 'costco stocker', 'costco food court', 'costco member service', 'costco pharmacy technician', 'costco optician', 'costco depot', 'costco logistics', 'costco forklift', 'costco seasonal', 'costco jobs'],
    veto: ['costco partnership', 'category analyst', 'account manager', 'director of sales', 'dedicated', 'reefer', 'cds', 'club demonstration services', 'product demonstrator'],
  },
  starbucks: {
    keywords: ['starbucks', 'starbucks barista', 'starbucks shift supervisor', 'starbucks store manager', 'starbucks jobs', 'starbucks careers', 'starbucks hiring', 'starbucks roasting plant', 'starbucks distribution center'],
    strip: ['target starbucks barista'],
    veto: ['starbucks card', 'starbucks gift', 'starbucks menu', 'starbucks rewards', 'starbucks stock', 'starbucks coupon', 'starbucks nutrition'],
  },
  homedepot: {
    keywords: ['home depot', 'the home depot', 'homedepot', 'home depot cashier', 'home depot freight', 'home depot overnight', 'home depot lot associate', 'home depot sales associate', 'home depot distribution center', 'home depot driver', 'path to pro', 'home depot jobs', 'thd jobs', 'home depot pro desk', 'home depot tool rental', 'home depot warehouse', 'home depot department supervisor'],
    veto: ['hd supply', 'home depot credit card', 'office depot', 'restaurant depot', 'jetro', 'home depot supplier', 'national account manager', 'account manager'],
  },
  usps: {
    keywords: ['usps', 'postal service', 'us postal service', 'post office', 'postal', 'postal worker', 'mail carrier', 'letter carrier', 'city carrier assistant', 'rural carrier', 'rural carrier associate', 'assistant rural carrier', 'mail handler', 'mail handler assistant', 'postal support employee', 'postal clerk', 'usps cca', 'usps rca', 'usps pse', 'usps mha', 'virtual entry assessment', 'postal exam', 'postal jobs', 'pse clerk', 'mail processing clerk'],
    veto: ['ups', 'fedex', 'post office box', 'postal code', 'postal inspector', 'postmates', 'postdoc', 'mailroom'],
  },
  lowes: {
    keywords: ['lowes', 'lowe s', 'lowe s home improvement', 'lowes home improvement', 'lowes home centers', 'lowes cashier', 'lowes stocker', 'lowes loader', 'lowes delivery driver', 'lowes jobs', 'track to the trades'],
    veto: ['lowes foods', 'lowe s foods', 'lowe s market', 'loews', 'lowell', 'flowers foods', 'bellflower', 'rob lowe'],
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
  const kind = (f) => (COMPANY.has(f) ? 1 : 0)
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
