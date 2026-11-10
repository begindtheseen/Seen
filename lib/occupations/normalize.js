// Job-title normalisation shared by the data build (scripts/occupations/build-occupations.mjs) and the
// runtime lookup (lib/occupations/index.js). Both sides MUST normalise the same way, so this file is the
// only place that decides how a title becomes a lookup key.
//
//   normTitle("Sr. Pharmacy Tech")            → "senior pharmacy technician"
//   titleVariants("Principal, Elementary School") → ["principal elementary school", "elementary school principal", …]
//   stripLevel("senior pharmacy technician ii")  → "pharmacy technician"

import { words } from '../text/morph.js';

// Abbreviations people write in titles → the words O*NET spells out. Context-free ones only; the
// context-dependent ones (tech, admin, vet) are handled in expandTokens.
const ABBR = {
  sr: ['senior'], snr: ['senior'], jr: ['junior'], mgr: ['manager'], mngr: ['manager'], asst: ['assistant'],
  assoc: ['associate'], coord: ['coordinator'], rep: ['representative'], reps: ['representative'],
  spec: ['specialist'], engr: ['engineer'], eng: ['engineer'], dev: ['developer'], devs: ['developer'],
  svc: ['service'], svcs: ['services'], cust: ['customer'], dir: ['director'], vp: ['vice', 'president'],
  svp: ['senior', 'vice', 'president'], evp: ['executive', 'vice', 'president'], avp: ['assistant', 'vice', 'president'],
  ops: ['operations'], mgmt: ['management'], hr: ['human', 'resources'], it: ['information', 'technology'],
  cna: ['certified', 'nursing', 'assistant'], rn: ['registered', 'nurse'], lpn: ['licensed', 'practical', 'nurse'],
  lvn: ['licensed', 'vocational', 'nurse'], emt: ['emergency', 'medical', 'technician'],
  qa: ['quality', 'assurance'], qc: ['quality', 'control'], csr: ['customer', 'service', 'representative'],
  sdr: ['sales', 'development', 'representative'], bdr: ['business', 'development', 'representative'],
  cpa: ['certified', 'public', 'accountant'], np: ['nurse', 'practitioner'], pta: ['physical', 'therapist', 'assistant'],
  cota: ['certified', 'occupational', 'therapy', 'assistant'], mgt: ['management'], acct: ['accounting'],
  dept: ['department'], intl: ['international'], natl: ['national'], gm: ['general', 'manager'],
  agm: ['assistant', 'general', 'manager'], ceo: ['chief', 'executive', 'officer'], cfo: ['chief', 'financial', 'officer'],
  coo: ['chief', 'operating', 'officer'], cto: ['chief', 'technology', 'officer'], cio: ['chief', 'information', 'officer'],
  cmo: ['chief', 'marketing', 'officer'], swe: ['software', 'engineer'], sre: ['site', 'reliability', 'engineer'],
  ml: ['machine', 'learning'], ai: ['artificial', 'intelligence'], ui: ['user', 'interface'], ux: ['user', 'experience'],
  lcsw: ['licensed', 'clinical', 'social', 'worker'], bcba: ['board', 'certified', 'behavior', 'analyst'],
};

// Words that say nothing about the occupation: schedule, contract, place, season, posting noise.
const NOISE = new Set(('part time parttime fulltime full seasonal temporary temp remote hybrid onsite on site contract ' +
  'contractor per diem prn night day overnight evening weekend weekends shift shifts 1st 2nd 3rd 4th summer fall winter ' +
  'spring flexible flex hiring immediately urgent urgently new grad graduate grads opening openings position positions ' +
  'role job req requisition us usa united states nationwide local travel traveling travelling bonus sign signon').split(' '));
// Kept when they ARE the occupation word ("night auditor", "travel agent", "contract specialist").
const NOISE_KEEP_BEFORE = new Set(['auditor', 'agent', 'nurse', 'specialist', 'manager', 'administrator', 'coordinator', 'analyst', 'clerk', 'worker', 'teacher', 'counselor']);

// Seniority / level words: removed only after the exact title has failed (levelOf reads them separately).
const LEVEL = new Set(['senior', 'junior', 'staff', 'entry', 'level', 'mid', 'experienced', 'i', 'ii', 'iii', 'iv', 'v', 'vi',
  '1', '2', '3', '4', '5', 'intern', 'internship', 'trainee', 'apprentice', 'apprenticeship', 'student', 'co', 'op',
  'coop', 'lead', 'principal', 'expert', 'advanced', 'associate', 'certified', 'licensed']);

/**
 * Tokens with abbreviations expanded.
 * @param {string[]} toks
 * @returns {string[]}
 */
function expandTokens(toks) {
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const next = toks[i + 1];
    const last = i === toks.length - 1 || /^(i|ii|iii|iv|1|2|3)$/.test(next || '');
    if (t === 'tech' || t === 'techs') { out.push(last ? 'technician' : 'technical'); continue; }
    if (t === 'admin') { out.push(last ? 'administrator' : 'administrative'); continue; }
    if (t === 'vet' && (next === 'tech' || next === 'technician' || next === 'assistant' || next === 'techs')) { out.push('veterinary'); continue; }
    if ((t === 'ap' || t === 'ar') && /^(clerk|specialist|analyst|coordinator|representative|associate|supervisor|manager|accountant)$/.test(next || '')) {
      out.push('accounts', t === 'ap' ? 'payable' : 'receivable'); continue;
    }
    if (Object.hasOwn(ABBR, t)) { out.push(...ABBR[t]); continue; }
    out.push(t);
  }
  return out;
}

/**
 * The canonical key for a title: lowercase words, abbreviations expanded, "&" → "and", no punctuation.
 * @param {string} title
 */
export function normTitle(title) {
  const s = String(title || '').replace(/&/g, ' and ').replace(/\+/g, ' plus ').replace(/[’']/g, '');
  return expandTokens(words(s).filter((w) => w !== 's')).join(' ');
}

/**
 * Drop schedule/contract/place noise words from a normalised title.
 * @param {string} norm
 */
export function stripNoise(norm) {
  const t = norm.split(' ');
  const keep = t.filter((w, i) => {
    if (/^20\d\d$/.test(w) || /^\d{3,}$/.test(w) || /^#/.test(w)) return false;
    if (!NOISE.has(w)) return true;
    return NOISE_KEEP_BEFORE.has(t[i + 1] || '') && i === t.length - 2;
  });
  return keep.join(' ').trim();
}

/**
 * Remove level / seniority words, keeping at least one word. "assistant principal" keeps "principal"
 * (it is the occupation there), and a title that is ONLY level words is returned unchanged.
 * @param {string} norm
 */
export function stripLevel(norm) {
  const t = norm.split(' ').filter(Boolean);
  const kept = t.filter((w, i) => {
    if (!LEVEL.has(w)) return true;
    if (w === 'principal' && i === t.length - 1) return true;              // a school principal
    if ((w === 'associate' || w === 'intern' || w === 'trainee' || w === 'apprentice' || w === 'lead') && i === t.length - 1 && t.length === 1) return true;
    if (w === 'associate' && i === t.length - 1) return true;               // "sales associate" is the job
    if (w === 'certified' || w === 'licensed') return t.length <= 2 ? true : false;
    return false;
  });
  return (kept.length ? kept : t).join(' ');
}

/**
 * Ordered lookup keys for a messy, real-world title ("Seasonal Sales Associate (part-time)- Perry Ellis",
 * "Principal, Elementary School", "LPN- Licensed Practical Nurse", "Cashier/Stocker").
 * The first entries are the most literal reading.
 * @param {string} raw
 * @returns {{ keys: string[], parens: string[] }}
 */
export function titleVariants(raw) {
  let s = String(raw || '').replace(/\s+/g, ' ').trim();
  /** @type {string[]} */
  const parens = [];
  s = s.replace(/[([{]([^)\]}]*)[)\]}]/g, (_, inner) => { parens.push(inner.trim()); return ' '; });
  s = s.replace(/\s(at|@)\s.*$/i, ' ');
  /** @type {string[]} */
  const keys = [];
  const push = (/** @type {string} */ x) => {
    const k = stripNoise(normTitle(x));
    if (k && !keys.includes(k)) keys.push(k);
  };
  // Segments split by dash / pipe / colon separators ("LPN- Licensed Practical Nurse", "Server - Hiroki San").
  const segs = s.split(/\s+[-–—|:]+\s*|\s*[-–—|:]+\s+|\s*[|–—]\s*/).map((x) => x.trim()).filter(Boolean);
  const primary = segs[0] || s;
  /** @param {string} seg */
  const expand = (seg) => {
    push(seg);
    if (seg.includes(',')) {
      const parts = seg.split(',').map((x) => x.trim()).filter(Boolean);
      const [a, ...rest] = parts;
      const b = rest.join(' ');
      if (a && b) { push(`${b} ${a}`); push(`${a} of ${b}`); push(a); push(b); }
    }
    if (seg.includes('/')) {
      const parts = seg.split('/').map((x) => x.trim()).filter(Boolean);
      // "Welder/Fabricator" → both; "Water/Wastewater Project Engineer" → each modifier with the shared tail
      const tail = parts[parts.length - 1].split(' ').slice(1).join(' ');
      for (const p of parts) { push(p); if (tail && !p.includes(' ')) push(`${p} ${tail}`); }
    }
    const of = seg.match(/^(.*?)\s+(?:of|for)\s+(.*)$/i);
    if (of) { push(`${of[2]} ${of[1]}`); push(of[1]); }
  };
  expand(primary);
  for (const seg of segs.slice(1)) expand(seg);
  for (const p of parens) if (p.split(/\s+/).length >= 2 && !/\d{2}[a-z]\b/i.test(p)) push(p);
  return { keys, parens };
}
