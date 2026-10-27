// What to optimize against when Seen holds only a listing's summary.
//
// Owner 2026-10-27 (phone screenshot of "Seen could not read the full posting" on an Adzuna "Overnight Healthcare Valet
// Attendant"): "Optimizing resume honestly shouldn't even be allowed for adzuna applications if all it's gonna do is
// this". Adzuna's API gives a ~500-character summary, and its pages refuse servers, so the full posting is out of reach
// for every Adzuna row (lib/server/fullPosting.js tries first). Instead of a paste box, Seen now builds the posting it
// optimizes against from what it already holds, and says which:
//   1. twin    — the same job (company + title) from the employer's own board, already in Seen's corpus: the posting;
//   2. similar — the summary plus the requirement sentences most full postings for the same role in Seen's corpus state
//                (real sentences from real postings, kept when at least 30% of them, and two or more, say it);
//   3. role    — the summary plus what that kind of role asks for, from the role ontology, when no similar postings exist.
// Nothing is invented about the employer: the page labels the basis, rows from similar postings are marked, and pasting
// the full posting is always offered for an exact match.
import { extractJobFacts } from '../optimizer/extractJobFacts.js';
import { stripDanglingEllipsis, isDescriptionPreview } from '../jobs/descriptionText.js';
import { detectRoleFamily, ROLE_FAMILIES } from '../application-intelligence/roleOntology.js';
import { canonText } from '../../api/_utils/jobRelevance.js';
import { BUILTIN_TAXONOMY, canonicalText } from '../optimizer/normalizeSkills.js';
import { SOFT_SKILLS } from '../optimizer/hourlyVocabulary.js';
import { REQUIREMENT_CUE_RE } from '../optimizer/postingSections.js';

const MIN_FULL = 700;
// words a title carries that are not the role: the shift, the setting, the contract
const TITLE_FILLER = new Set(['overnight', 'night', 'nights', 'day', 'days', 'evening', 'evenings', 'weekend', 'weekends', 'part', 'full', 'time',
  'parttime', 'fulltime', 'pt', 'ft', 'seasonal', 'temporary', 'temp', 'prn', 'per', 'diem', 'shift', 'shifts', 'flexible', 'hiring', 'immediately',
  'urgent', 'now', 'new', 'entry', 'level', 'i', 'ii', 'iii', 'iv', 'healthcare', 'hospital', 'hotel', 'resort', 'casino', 'airport', 'downtown']);
const GENERIC_HEAD = new Set(['attendant', 'associate', 'technician', 'tech', 'specialist', 'assistant', 'representative', 'rep', 'worker',
  'manager', 'clerk', 'agent', 'operator', 'coordinator', 'parking', 'member', 'staff', 'lead', 'supervisor', 'analyst', 'engineer', 'officer',
  'consultant', 'advisor', 'aide', 'helper', 'professional', 'executive', 'director', 'administrator']);
const SENIOR_RE = /\b(?:senior|sr\.?|lead|principal|staff|manager|director|head|vp|vice president|chief|supervisor)\b/i;
// a sentence about what the employer gives, not what it asks for
const OFFER_RE = /\b(?:we offer|benefits?|401\s?\(?k\)?|pto|paid time off|discount|training program|accreditation|perks?|bonus|tuition|insurance|equal opportunity)\b/i;
// What hourly roles of a family commonly state, beyond the skills the ontology lists — the licence, the physical
// demands, the schedule screen. Shown as "what these roles usually ask for", never as the employer's words.
const ROLE_COMMON = {
  valet_parking: ["Valid driver's license and a clean driving record required.", 'Must be able to drive manual and automatic transmission vehicles.', 'Ability to stand, walk and run for long periods outdoors in all weather.', 'Customer service experience preferred.', 'Cash handling experience preferred.'],
  retail: ['Customer service experience preferred.', 'Cash handling and point of sale experience preferred.', 'Ability to stand for long periods and lift up to 25 pounds.', 'Must be available to work evenings, weekends and holidays.'],
  food_service: ['Food safety knowledge required.', 'Customer service experience preferred.', 'Ability to stand for long periods and lift up to 25 pounds.', 'Must be able to work in a fast-paced environment.'],
  warehouse: ['Ability to lift up to 50 pounds and stand for long periods.', 'Order picking and packing experience preferred.', 'Forklift certification a plus.', 'RF scanner experience preferred.', 'Inventory management experience preferred.'],
  delivery_logistics: ["Valid driver's license and a clean driving record required.", 'Ability to lift up to 50 pounds.', 'Route planning and time management skills required.', 'Customer service experience preferred.'],
  security: ['Guard card or security license required.', 'Ability to stand and walk for long periods.', 'Report writing skills required.', 'Customer service experience preferred.'],
  customer_service: ['Customer service experience required.', 'Data entry and computer skills required.', 'Phone support experience preferred.', 'Complaint resolution experience preferred.'],
  hospitality: ['Customer service experience required.', 'Guest relations experience preferred.', 'Ability to stand for long periods.', 'Must be available to work weekends and holidays.'],
  healthcare_support: ['Patient care experience preferred.', 'CPR certification required.', 'Documentation and data entry skills required.', 'Ability to lift up to 50 pounds.'],
};
// constraint kinds that belong to one posting (its pay, its schedule, its place) — never borrowed from another
const OWN_POSTING_ONLY = new Set(['schedule', 'location', 'pay', 'travel', 'relocation', 'years']);

/** The role words of a title, most specific first: "Overnight Healthcare Valet Attendant" → ["valet attendant", "attendant"]. */
export function coreTitles(title) {
  const words = canonText(String(title || '').replace(/\(.*?\)|\[.*?\]/g, ' ').split(/\s[-–—|,]\s|\s@\s/)[0]).split(' ').filter((w) => w && !TITLE_FILLER.has(w) && !/^\d+$/.test(w));
  const out = [];
  for (let k = Math.min(3, words.length); k >= 1; k--) {
    const tail = words.slice(-k).join(' ');
    // one word that names no particular job ("attendant" is a flight attendant too) is not a role to borrow from
    if (k === 1 && GENERIC_HEAD.has(tail)) continue;
    if (tail.length >= 4 && !out.includes(tail)) out.push(tail);
  }
  return out;
}

/**
 * Requirement sentences most of these full postings share, with the facts they carry.
 * @param {Array<{ title: string, description: string }>} postings
 * @returns {{ sentences: string[], labels: string[], used: number }}
 */
export function sharedRequirements(postings, { jobTitle = '', minShare = 0.3, max = 12 } = {}) {
  const full = (postings || []).filter((p) => String(p.description || '').length >= MIN_FULL).slice(0, 40);
  const seen = new Map(); // label → { n, sentences: [] }
  for (const p of full) {
    const facts = extractJobFacts(p.description, { jobTitle: jobTitle || p.title });
    const labels = new Set();
    for (const f of facts) {
      if (f.factType === 'constraint' && OWN_POSTING_ONLY.has(f.kind)) continue;
      if (!f.evidence || f.evidence.length > 220) continue;
      // a real requirement sentence: four words or more, not a question or a heading, not a benefit
      const ev = f.evidence.trim();
      if (ev.split(/\s+/).length < 4 || /\?\s*$|:\s*\.?$/.test(ev) || OFFER_RE.test(ev)) continue;
      if (!REQUIREMENT_CUE_RE.test(ev) && !['requirements', 'preferred', 'physical'].includes(f.section)) continue;
      const key = f.normalizedLabel || f.label;
      if (!key || labels.has(key)) continue;
      labels.add(key);
      const s = seen.get(key) || { n: 0, sentences: [], label: f.label };
      s.n++;
      s.sentences.push(f.evidence.trim());
      seen.set(key, s);
    }
  }
  const need = Math.max(2, Math.ceil(full.length * minShare));
  const kept = [...seen.values()].filter((s) => s.n >= need).sort((a, b) => b.n - a.n).slice(0, max);
  const sentences = [];
  for (const s of kept) {
    // the shortest sentence that says it — one per requirement, never the same sentence twice
    const pick = [...s.sentences].sort((a, b) => a.length - b.length).find((x) => !sentences.includes(x));
    if (pick) sentences.push(/[.!?]$/.test(pick) ? pick : `${pick}.`);
  }
  return { sentences, labels: kept.map((s) => s.label), used: full.length };
}

/** What that kind of role asks for: the requirements hourly roles of its family commonly state, plus its ontology skills. */
export function roleRequirements(title, summary = '') {
  const fam = detectRoleFamily(title, summary);
  if (!fam || fam.family === 'general' || fam.confidence < 0.4) return null;
  const d = ROLE_FAMILIES[fam.family];
  if (!d) return null;
  // only words the skill taxonomy reads as skills ("guest service", "safety"), never descriptors ("time-sensitive")
  const known = (k) => { const v = BUILTIN_TAXONOMY.aliases[canonicalText(k)] || null; return v && !SOFT_SKILLS.has(v) && v !== 'attendance' ? v : null; };
  const skills = [...new Set([...(d.keywords || []), ...(d.provides || [])].map(known).filter(Boolean))].slice(0, 8);
  const sentences = [...(ROLE_COMMON[fam.family] || []), ...skills.map((k) => `Experience with ${k} required.`)];
  // worth using only when the requirement reader finds at least three requirements in it
  const facts = extractJobFacts(`REQUIREMENTS\n${sentences.join('\n')}`, { jobTitle: title });
  if (facts.length < 3) return null;
  return { family: fam.family, label: d.label, sentences };
}

/**
 * Build the posting to optimize against for a summary-only listing row.
 * @param {{ row: { id?: string, title?: string, company?: string, description?: string, source?: string },
 *   db: (path: string) => Promise<Response> }} args
 * @returns {Promise<null | { kind: 'twin'|'similar'|'role', description: string, added: string[], core?: string, count?: number, label?: string }>}
 */
export async function buildPostingBasis({ row, db }) {
  if (!row || !row.title) return null;
  const summary = stripDanglingEllipsis(String(row.description || '')).trim();
  const read = async (path) => {
    try { const r = await db(path); return r && r.ok ? (await r.json()) || [] : []; } catch (_e) { return []; }
  };
  const now = encodeURIComponent(new Date().toISOString());
  const cols = 'id,title,company,description,source';

  // 1. the same job from the employer's own board
  if (row.company) {
    const title = String(row.title).replace(/[*,()]/g, ' ').trim();
    const company = canonText(row.company).split(' ').filter(Boolean).join('*');
    if (title && company) {
      const twins = await read(`jobs?title=ilike.${encodeURIComponent(title)}&company=ilike.${encodeURIComponent(`${company}*`)}&source=neq.Adzuna&expires_at=gt.${now}&select=${cols}&limit=5`);
      const twin = twins.find((t) => t.id !== row.id && String(t.description || '').length >= MIN_FULL && !isDescriptionPreview(t));
      if (twin) return { kind: 'twin', description: twin.description, added: [], label: twin.company };
    }
  }

  // 2. requirements most full postings for the same role state
  for (const core of coreTitles(row.title)) {
    // the role as whole words ("cashier" is not "Director of Cashiering"), at the listing's own level
    const re = `\\m${core.replace(/[^a-z0-9 ]/g, '')}\\M`;
    const postings = await read(`jobs?title=imatch.${encodeURIComponent(re)}&source=neq.Adzuna&expires_at=gt.${now}&select=${cols}&order=created_at.desc&limit=40`);
    const senior = SENIOR_RE.test(row.title);
    const peers = postings.filter((p) => p.id !== row.id && (senior || !SENIOR_RE.test(p.title || '')));
    const shared = sharedRequirements(peers, { jobTitle: row.title });
    // enough to measure against: three or more requirements (one sentence can carry two: a licence and a driving record)
    if (shared.used >= 3 && shared.labels.length >= 3 && shared.sentences.length >= 2) {
      return { kind: 'similar', description: `${summary}\n\nREQUIREMENTS\n${shared.sentences.join('\n')}`, added: shared.sentences, core, count: shared.used };
    }
  }

  // 3. what that kind of role asks for
  const role = roleRequirements(row.title, summary);
  if (role) {
    return { kind: 'role', description: `${summary}\n\nREQUIREMENTS\n${role.sentences.join('\n')}`, added: role.sentences, label: role.label };
  }
  return null;
}

/** The page's words for a basis ("…plus what 12 other Valet Attendant postings require"). */
export function basisNote(basis) {
  if (!basis) return null;
  if (basis.kind === 'twin') return `Seen could only read a summary of this listing, so this uses the same job's full posting from ${basis.label || 'the employer'}'s own job board.`;
  if (basis.kind === 'similar') return `Seen could only read a summary of this listing. This check uses that summary plus the requirements ${basis.count} other ${titleWords(basis.core)} postings state. Paste the full posting for an exact match.`;
  return `Seen could only read a summary of this listing. This check uses that summary plus what ${basis.label || 'this kind of'} roles usually ask for. Paste the full posting for an exact match.`;
}
const titleWords = (s) => String(s || '').replace(/\b[a-z]/g, (c) => c.toUpperCase());

/**
 * Mark what came from the basis on an optimizer result: requirement rows read from a borrowed sentence carry
 * `from_similar: true`, and the verdict says "postings like this" instead of "the posting" for them.
 */
export function annotateBasis(out, basis) {
  if (!out || !basis || basis.kind === 'twin' || !Array.isArray(basis.added) || !basis.added.length) return out;
  const added = new Set(basis.added.map((s) => s.trim()));
  const mark = (rows) => (Array.isArray(rows) ? rows.map((r) => (r && r.postingEvidence && added.has(String(r.postingEvidence).trim()) ? { ...r, from_similar: true } : r)) : rows);
  const next = { ...out, matched_requirements: mark(out.matched_requirements), unsupported_requirements: mark(out.unsupported_requirements) };
  // the employer never said these: "Requires a driver's license" becomes "Roles like this usually require a driver's license".
  // Only for rows read from a borrowed sentence — what the listing's own summary says stays the employer's.
  const borrowed = (c) => !!(c && c.evidence && added.has(String(c.evidence).trim()));
  const cons = Array.isArray(out.constraints) ? out.constraints : [];
  const gateBorrowed = cons.some((c) => c && c.gate && c.status === 'unmet' && borrowed(c)) && !cons.some((c) => c && c.gate && c.status === 'unmet' && !borrowed(c));
  // any borrowed ask: "roles like this" is true of the listing's own asks too, "it" is not true of a borrowed one
  const asksBorrowed = cons.some((c) => c && c.status === 'ask' && borrowed(c));
  const soften = (t, { gate = false } = {}) => {
    let x = String(t)
      .replace(/\bthe posting also asks for\b/g, 'postings like this usually also ask for')
      .replace(/\bwhat this posting asks for\b/g, 'what postings like this ask for');
    if (gate || gateBorrowed) x = x.replace(/(^|;\s*|—\s*)Requires\b/g, '$1Roles like this usually require');
    if (asksBorrowed) x = x.replace(/\bit screens on\b/g, 'roles like this screen on');
    return x;
  };
  if (next.verdict) next.verdict = { ...next.verdict,
    sentence: typeof next.verdict.sentence === 'string' ? soften(next.verdict.sentence) : next.verdict.sentence,
    gate: typeof next.verdict.gate === 'string' && gateBorrowed ? soften(next.verdict.gate, { gate: true }) : next.verdict.gate };
  next.constraints = cons.map((c) => (borrowed(c) && typeof c.message === 'string'
    ? { ...c, from_similar: true, message: c.message.replace(/\bThe posting asks for\b/g, 'Roles like this usually ask for').replace(/^Requires\b/, 'Roles like this usually require').replace(/\bThe employer runs\b/, 'Roles like this usually run').replace(/\bThe employer checks for\b/, 'Roles like this usually check for') }
    : c));
  return next;
}
