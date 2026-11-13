// Pure relevance + company-match logic for job search. No I/O → unit-testable.
//
// Two jobs:
//  - relevanceScore/isRelevant: keep only listings GENUINELY related to the query.
//    The bar is a TITLE/role signal — a query token, the query phrase, or a TRUE
//    synonym must appear in the TITLE (or the company, for a company search). A term
//    that appears only in the description, or only via an over-broad expansion token
//    (e.g. the generic word "sales"), is NOT enough. This is the fix for the reported
//    leak: searching "budtender" was returning a "Sales Manager" because expansion
//    terms were tokenized into one loose bag and a description/generic hit cleared the
//    threshold. Now the original query drives relevance and expansion terms only count
//    as SYNONYM PHRASES matched against the title (generic single words are ignored).
//  - looksLikeCompany: detect a company-name search so it returns that company's
//    listings rather than keyword-matched roles.

import { stripTitleLocation } from '../../lib/jobs/groupListings.js';
import { detectRoleFamily } from '../../lib/application-intelligence/roleOntology.js';

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'for', 'in', 'at', 'to', 'jobs', 'job', 'near', 'me', 'remote', 'hiring', 'careers', 'role', 'roles', 'position', 'positions', 'opening', 'openings']);

// Single words that are too generic to establish relevance on their own. A synonym that
// is JUST one of these (e.g. expansion returns the bare word "sales" for "budtender") is
// dropped, so it can never rescue an unrelated title like "Sales Manager". Discriminating
// single-word synonyms (cannabis, dispensary, nurse, welder, barista, …) are NOT in here.
const GENERIC_SYNONYM = new Set([
  'sales', 'manager', 'management', 'associate', 'assistant', 'representative', 'rep',
  'coordinator', 'specialist', 'agent', 'clerk', 'staff', 'professional', 'consultant',
  'officer', 'supervisor', 'administrator', 'executive', 'operator', 'general', 'team',
  'member', 'worker', 'personnel', 'employee', 'senior', 'junior', 'entry', 'level',
  'full', 'part', 'time', 'hybrid', 'onsite', 'trainee', 'apprentice',
]);

// ── Curated role families — DETERMINISTIC query expansion (NO AI) ─────────────────
// The single hardest problem in job search is the gap between what a seeker TYPES and what
// employers TITLE the same job: "theft prevention" → "Asset Protection Specialist",
// "warehouse" → "Material Handler", "budtender" → "Cannabis Dispensary Associate". Seen calls no
// model API (lib/server/expand.js only reads cached rows), so these curated families are the ONLY
// cross-lexical bridge, by design.
//
// Each family is a set of INTERCHANGEABLE role phrases for the SAME work. Any query matching a
// member expands (BIDIRECTIONALLY) to the rest of the family, which we use to (a) recognize a
// title as relevant and (b) widen the DB pool + live pull toward more supply. Members are
// SPECIFIC role words/phrases only — never a bare generic ("sales", "manager", "associate")
// that would pull unrelated jobs; effectiveSynonyms + GENERIC_SYNONYM are the backstop.
const ROLE_FAMILIES = [
  // Retail loss prevention / asset protection / security — the owner's Target-AP beachhead. The
  // real titles almost never contain "theft"/"prevention", which is why a title-only bar returns 0.
  ['loss prevention', 'asset protection', 'theft prevention', 'loss prevention officer', 'loss prevention associate', 'loss prevention detective', 'asset protection specialist', 'asset protection team leader', 'security officer', 'security guard', 'retail security', 'store detective', 'shrink'],
  // Warehouse / fulfillment — titles are "Material Handler", "Order Picker", "Package Handler"…
  // Front-loaded with the most lexically-DISTINCT titles: both the expansion cap and the live-pull
  // cap take from the front, so the terms that surface NEW supply lead.
  ['warehouse', 'material handler', 'package handler', 'fulfillment associate', 'order picker', 'forklift operator', 'warehouse associate', 'warehouse worker', 'order selector', 'picker packer', 'stower', 'sortation associate', 'distribution associate'],
  // Delivery / driving.
  ['delivery driver', 'courier', 'package delivery driver', 'dsp driver', 'cdl driver', 'truck driver', 'route driver', 'delivery associate', 'driver'],
  // Cannabis retail (keeps the discriminating single words cannabis/dispensary/marijuana).
  ['budtender', 'cannabis', 'dispensary', 'marijuana', 'cannabis associate', 'dispensary associate', 'dispensary agent', 'cannabis consultant', 'dispensary technician', 'cannabis retail associate'],
  // Food & beverage.
  ['barista', 'coffee', 'espresso', 'coffee barista', 'cafe associate'],
  ['bartender', 'barback', 'mixologist', 'bar tender'],
  ['server', 'waiter', 'waitress', 'food server', 'banquet server', 'restaurant server'],
  ['line cook', 'cook', 'prep cook', 'grill cook', 'kitchen staff', 'food prep'],
  ['dishwasher', 'kitchen steward', 'dish washer'],
  // Front-line retail.
  ['cashier', 'checkout associate', 'front end associate', 'retail cashier'],
  ['retail associate', 'sales associate', 'store associate', 'retail sales associate', 'merchandiser', 'stock associate'],
  ['customer service representative', 'customer service associate', 'customer support representative', 'call center representative', 'csr', 'customer service specialist', 'customer care specialist', 'customer care representative', 'customer service agent'],
  // Care / clinical support.
  ['caregiver', 'caregiving', 'home care aide', 'personal care aide', 'direct support professional', 'home health aide'],
  ['certified nursing assistant', 'cna', 'nursing assistant', 'patient care technician', 'patient care assistant'],
  ['medical assistant', 'clinical assistant', 'medical office assistant'],
  ['phlebotomist', 'phlebotomy', 'phlebotomy technician', 'blood draw technician'],
  // Facilities.
  ['janitor', 'custodian', 'housekeeper', 'cleaner', 'custodial', 'housekeeping', 'janitorial'],
  // Admin.
  ['administrative assistant', 'office assistant', 'administrative coordinator', 'front desk receptionist', 'office administrator', 'receptionist'],
  // Pharmacy (a "pharmacy technician" search listed "Environmental Services Technician" rows — audit 2026-10-24).
  ['pharmacy technician', 'pharmacy tech', 'certified pharmacy technician', 'cpht'],
  // Retail management ("retail manager · Tucson" opened with "Case Manager (PRN/Pool)").
  ['retail manager', 'store manager', 'assistant store manager', 'retail store manager'],
];

// ── Oilfield and skilled-trades families (2026-11-13) ─────────────────────────────────────────────
// What a green hand types ("roustabout", "oilfield", "apprentice electrician", "hvac helper") is rarely what the
// posting is titled ("Floorhand - Oklahoma", "Lease Operator", "Electrician Helper", "HVAC Install Helper"). These
// families are the same deterministic bridge as ROLE_FAMILIES, with three precision rules the rest do not need:
//  1. They are consulted only AFTER ROLE_FAMILIES finds nothing, so every query that already had a family keeps it
//     (and every other query that matches none of them is unchanged — pinned by the equivalence harness).
//  2. A query reaches one by an exact member or `keys` phrase (keys trigger a family, they are never title
//     synonyms: "oil and gas", "rig", "hvac", "equipment operator"), by the same after dropping beginner words
//     ("entry level roustabout", "oilfield jobs no experience", "union apprenticeship"), or by CONTAINING a member
//     ("cdl water hauler" ⊇ "water hauler"). Never the reverse: a short generic query ("apprentice", "helper",
//     "operator", "technician", "mechanic", "electrical") is not widened into a trade because a member contains it
//     — "Apprentice Piercer", "Public Relations Apprentice" and a software "Field Service Technician" are real rows.
//  3. Members are titles the WORK carries: never a bare "production operator" (chemical-plant rows in prod), bare
//     "equipment operator" (warehouse rows), "field service technician" (software/robotics rows), "line worker"
//     (factory lines), bare "fabricator", "pumper" or "swamper" (septic, movers) — those are keys at most.
// Family members also act as title synonyms only on a craft title: a family synonym never makes an instructor /
// engineer / manager / sales title a match (TRADE_NON_CRAFT_RE) — the query's own words still do.
const TRADE_FAMILIES = [
  // Oilfield hauling — listed before the field-hand family so "water hauler" stays with the haulers.
  { id: 'oilfield_hauling', keys: ['oilfield hauling', 'oilfield trucking'], members: [
    'water hauler', 'sand hauler', 'frac sand hauler', 'crude hauler', 'crude oil hauler', 'oilfield truck driver',
    'oilfield driver', 'water hauling driver', 'frac sand driver', 'oilfield cdl driver',
  ] },
  // Oilfield field hands: the entry rungs on drilling, workover, completions, production and compression crews.
  { id: 'oilfield', keys: [
    'oilfield', 'oil field', 'oil and gas', 'oil gas', 'oil rig', 'oil rigs', 'rig', 'rigs', 'drilling rig', 'rig crew',
    'oilfield services', 'oil field services', 'frac', 'fracking', 'wireline', 'workover', 'swamper', 'pumper',
    'green hand', 'green hat', 'oil patch', 'oilpatch', 'oil well', 'pressure pumping',
  ], members: [
    'roustabout', 'floorhand', 'roughneck', 'floor hand', 'frac hand', 'flowback', 'wireline operator', 'lease operator',
    'floorman', 'leasehand', 'lease hand', 'rig hand', 'derrickhand', 'derrick hand', 'derrickman', 'motorhand',
    'motor hand', 'casing floorhand', 'casing hand', 'rack hand', 'rig up hand', 'rig up operator', 'workover rig hand',
    'workover hand', 'well service rig hand', 'frac operator', 'frac equipment operator', 'frac crew',
    'pressure pumping operator', 'pumping operator', 'pumpdown operator', 'flowback hand', 'flowback operator',
    'well testing operator', 'well tester', 'production testing operator', 'wireline helper', 'wireline trainee',
    'coiled tubing', 'coil tubing operator', 'cementing operator', 'cement equipment operator', 'lease pumper',
    'pumper gauger', 'oilfield pumper', 'water transfer operator', 'water management operator',
    'operator assistant trainee', 'entry level oilfield operator', 'oilfield operator', 'oilfield hand',
    'oilfield worker', 'oilfield laborer', 'oilfield trainee', 'compression technician', 'compressor technician',
    'compression mechanic', 'tubular services technician', 'roustabouts', 'floorhands', 'roughnecks',
  ] },
  // Electrical (inside wireman, residential, low voltage) and its apprentice / helper / trainee rungs.
  { id: 'electrical', keys: ['electrical apprenticeship', 'electrician apprenticeship', 'ibew apprenticeship'], members: [
    'electrician', 'electrical apprentice', 'electrician apprentice', 'apprentice electrician', 'electrician helper',
    'electrical helper', 'wireman', 'low voltage technician', 'electrician trainee', 'electrical trainee',
    'inside wireman', 'residential wireman', 'construction wireman', 'journeyman electrician',
    'construction electrician', 'fire alarm technician', 'low voltage installer', 'electricians',
  ] },
  // Plumbing and pipe trades (one UA trade family: plumber, pipefitter, steamfitter, sprinkler fitter).
  { id: 'plumbing', keys: ['plumbing', 'plumbing apprenticeship', 'pipefitting', 'pipe trades'], members: [
    'plumber', 'plumbing apprentice', 'apprentice plumber', 'plumber apprentice', 'plumbers apprentice',
    'plumber helper', 'plumbing helper', 'plumbing installer', 'pipefitter', 'pipe fitter', 'steamfitter',
    'steam fitter', 'sprinkler fitter', 'plumbing technician', 'service plumber', 'journeyman plumber',
    'pipefitter apprentice', 'pipefitter helper', 'plumbers', 'pipefitters',
  ] },
  // HVAC/R.
  { id: 'hvac', keys: ['hvac', 'hvacr', 'hvac r', 'hvac apprenticeship', 'heating and air', 'heating and cooling'], members: [
    'hvac technician', 'hvac installer', 'hvac helper', 'hvac apprentice', 'hvac tech', 'hvac service technician',
    'hvac mechanic', 'hvac trainee', 'hvac install helper', 'hvac technician apprentice', 'hvac/r technician',
    'hvac/r service technician', 'hvacr technician', 'refrigeration technician', 'refrigeration mechanic',
    'duct installer', 'ductwork installer', 'hvac maintenance technician',
  ] },
  // Welding.
  { id: 'welding', keys: ['welding'], members: [
    'welder', 'welder helper', 'welding helper', 'welder fitter', 'fitter welder', 'welder fabricator',
    'structural welder', 'pipe welder', 'mig welder', 'tig welder', 'welder apprentice', 'welding apprentice',
    'welder trainee', 'welding trainee', 'steel fabricator', 'welders',
  ] },
  // Lineworkers (power lines) and their ground crews.
  { id: 'lineworker', keys: ['linework', 'lineman apprenticeship', 'power line', 'powerline'], members: [
    'lineman', 'lineworker', 'apprentice lineman', 'lineman apprentice', 'apprentice lineworker', 'journeyman lineman',
    'groundman', 'groundmen', 'linemen', 'substation technician', 'substation electrician', 'powerline technician',
    'power line technician',
  ] },
  // Heavy equipment operators (construction / IUOE). Bare "equipment operator" is a key: warehouses use the title.
  { id: 'heavy_equipment_operator', keys: ['equipment operator', 'heavy equipment', 'operating engineer'], members: [
    'heavy equipment operator', 'construction equipment operator', 'excavator operator', 'dozer operator',
    'bulldozer operator', 'backhoe operator', 'front end loader operator', 'motor grader operator', 'grader operator',
    'scraper operator', 'operating engineer apprentice', 'heavy equipment operator trainee', 'wheel loader operator',
  ] },
  // Diesel and heavy-equipment mechanics — separate from the operators: different work, different résumé.
  { id: 'diesel_mechanic', keys: ['diesel mechanic apprenticeship'], members: [
    'diesel mechanic', 'diesel technician', 'diesel tech', 'heavy equipment mechanic', 'heavy equipment technician',
    'heavy duty mechanic', 'heavy duty technician', 'diesel apprentice', 'diesel technician apprentice',
    'diesel mechanic apprentice', 'diesel mechanic helper', 'heavy equipment shop technician',
    'heavy equipment field technician', 'diesel fleet technician', 'diesel service technician',
  ] },
  // "apprenticeship" / "trades" / "skilled trades": the beginner rungs of every trade above (and the common union
  // crafts). Last, so a specific trade query ("apprentice electrician") reaches its own family first.
  { id: 'trades_entry', keys: [
    'apprenticeship', 'apprenticeships', 'trades', 'trade', 'skilled trades', 'skilled trade', 'trade apprenticeship',
    'trades apprenticeship', 'construction apprenticeship', 'registered apprenticeship', 'pre apprenticeship',
    'preapprenticeship', 'apprenticeship program', 'apprenticeship programs', 'construction trades', 'building trades',
    'trade school',
  ], members: [
    'electrician apprentice', 'apprentice electrician', 'electrical apprentice', 'electrician helper', 'electrical helper',
    'plumbing apprentice', 'apprentice plumber', 'plumber apprentice', 'plumbers apprentice', 'plumber helper',
    'plumbing helper', 'plumbing installer apprentice', 'hvac apprentice', 'hvac helper', 'hvac technician apprentice', 'pipefitter apprentice', 'pipefitter helper',
    'welder helper', 'welder apprentice', 'welding apprentice', 'apprentice lineman', 'lineman apprentice', 'groundman',
    'diesel technician apprentice', 'diesel apprentice', 'electrician trainee', 'electrical trainee', 'hvac trainee',
    'welder trainee', 'carpenter apprentice', 'apprentice carpenter', 'sheet metal apprentice', 'ironworker apprentice',
    'millwright apprentice', 'operating engineer apprentice', 'elevator apprentice', 'construction apprentice',
  ] },
];
const TRADE_BY_MEMBERS = new Map(TRADE_FAMILIES.map((f) => [f.members, f]));
// Beginner / search-filler words dropped before a trade query is looked up again ("entry level roustabout",
// "oilfield jobs no experience", "apprentice lineman"). Dropping them can only ever reach a family by a REAL trade
// word left over: "apprentice", "helper" or "no experience" alone leave nothing and reach none.
const TRADE_FILLER = new Set(['entry', 'level', 'beginner', 'beginners', 'no', 'experience', 'needed', 'required',
  'necessary', 'hiring', 'now', 'immediately', 'work', 'worker', 'workers', 'jobs', 'job', 'trainee', 'trainees',
  'apprentice', 'apprentices', 'helper', 'helpers', 'union', 'paid', 'training', 'near', 'me', 'local', 'green',
  'opportunity', 'opportunities', 'position', 'positions', 'full', 'time', 'the', 'a', 'an', 'in', 'for']);
function _tradeFamilyFor(qn) {
  for (const f of TRADE_FAMILIES) if (f.members.includes(qn) || f.keys.includes(qn)) return f;
  const core = qn.split(' ').filter((w) => !TRADE_FILLER.has(w)).join(' ');
  if (core && core !== qn) for (const f of TRADE_FAMILIES) if (f.members.includes(core) || f.keys.includes(core)) return f;
  if (qn.length >= 4) for (const f of TRADE_FAMILIES) for (const m of f.members) if (_phraseIn(qn, m)) return f;
  return null;
}
// A family synonym never makes one of these titles a match for a trade query (the query's own words still can):
// "Electrical Apprenticeship Instructor", "Journeyman Lineworker Instructor", "Rig Manager", "HSE Advisor".
const TRADE_NON_CRAFT_RE = /(^|[^a-z0-9])(instructor|teacher|trainer|professor|faculty|engineer|engineering|designer|drafter|estimator|inspector|manager|director|superintendent|supervisor|coordinator|dispatcher|scheduler|planner|recruiter|recruiting|sales|account|marketing|analyst|accountant|attorney|counsel|administrator|advisor|consultant|buyer|procurement|executive|president)s?([^a-z0-9]|$)/;
// Whole-word stand-ins a trade title uses for a query word — consulted for trade queries only, so the rest of
// search is unchanged. helper ≈ apprentice ≈ trainee is the beginner rung of a trade, never a match on its own: it
// counts only where EVERY query word must be in the title ("apprentice electrician" ↔ "Electrician Helper").
// No "electrician" ↔ "electrical" / "plumber" ↔ "plumbing": alone they made "Electrical Test Technician" and
// "Electrical Integration Intern" electrician matches; the family's own phrases ("electrical apprentice",
// "plumbing installer") carry those titles instead.
const TRADE_TOKEN_ALIASES = {
  apprentice: ['helper', 'trainee', 'apprentices'],
  apprenticeship: ['apprentice', 'helper', 'trainee'],
  helper: ['apprentice', 'trainee'],
  trainee: ['apprentice', 'helper'],
  pipefitter: ['pipe fitter'],
  steamfitter: ['steam fitter'],
  welder: ['welding'],
  welding: ['welder'],
  lineman: ['lineworker', 'linemen'],
  lineworker: ['lineman', 'linemen'],
  groundman: ['groundmen'],
  floorhand: ['floor hand', 'floorman', 'roughneck'],
  roughneck: ['floorhand', 'floor hand', 'floorman'],
  derrickhand: ['derrick hand', 'derrickman'],
  motorhand: ['motor hand', 'motorman'],
  leasehand: ['lease hand', 'roustabout'],
  roustabout: ['leasehand', 'lease hand'],
  hauler: ['hauling'],
  mechanic: ['technician', 'tech'],
  technician: ['mechanic'],
};
// A search for the beginner rung ("apprentice electrician", "welder helper") does not take a family synonym from a
// title that names a higher rung: "Master Electrician", "TIG Welder - Level 4/5", "Diesel Mechanic Lead" stay under
// "Other openings" (still relevant by the trade word), below every apprentice / helper / plain-trade match.
const TRADE_HIGHER_RUNG_RE = /(^|[^a-z0-9])(journeyman|journeymen|journey[- ]?level|master|senior|sr|lead|foreman|licensed|experienced|ii|iii|iv|level [2-9])([^a-z0-9]|$)/;
const TRADE_LEVEL = new Set(['apprentice', 'apprentices', 'apprenticeship', 'apprenticeships', 'helper', 'helpers', 'trainee', 'trainees']);
// The trade family a query belongs to (null for every other query, including the ROLE_FAMILIES ones).
function _tradeOf(query) {
  const fam = _familyFor(query);
  return fam ? TRADE_BY_MEMBERS.get(fam) || null : null;
}
// Stand-in words apply to a trade query that names a trade word, never to one made only of beginner / filler words
// ("apprenticeship", "union apprenticeship"): there "apprentice" would match every apprentice title (a PR apprentice).
function _tradeAliasesOn(query, tokens) {
  return !!_tradeOf(query) && tokens.some((t) => !TRADE_LEVEL.has(t) && !TRADE_FILLER.has(t));
}
// May a trade query take its family's synonyms from this title? Never from a non-craft title; for a beginner-rung
// query, never from a higher-rung title.
function _tradeSynonymsOk(tokens, title) {
  if (TRADE_NON_CRAFT_RE.test(title)) return false;
  return !(tokens.some((t) => TRADE_LEVEL.has(t)) && TRADE_HIGHER_RUNG_RE.test(title));
}
function _tradeAliasInTitle(title, token) {
  const aliases = TRADE_TOKEN_ALIASES[token];
  return !!aliases && aliases.some((a) => tokenInTitle(title, a));
}

// Normalize a surface for family matching: lowercase, keep alnum/+#., collapse spaces.
function _norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9+#.\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
// Whole-word phrase containment: does `needle` appear as a full token-run inside `hay`?
// The pattern for a needle is built once (a search ranks hundreds of rows with the same few needles; building a
// RegExp per row was most of a search's CPU — profiled 2026-11-12).
const _phraseRe = new Map();
function _phraseIn(hay, needle) {
  if (!hay || !needle) return false;
  let re = _phraseRe.get(needle);
  if (!re) {
    re = new RegExp(`(^|\\s)${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`);
    if (_phraseRe.size > 2000) _phraseRe.clear();
    _phraseRe.set(needle, re);
  }
  return re.test(hay);
}
// The curated family a query belongs to (or null). Exact member match first, then whole-word
// containment either direction for queries ≥4 chars (so "warehouse" hits "warehouse associate"
// and "asset protection specialist" hits "asset protection").
// A pure function of the query over a constant table, asked once per row ranked: remembered per query.
const _familyMemo = new Map();
function _familyFor(query) {
  const key = String(query ?? '');
  if (_familyMemo.has(key)) return _familyMemo.get(key);
  const fam = _familyForUncached(query);
  if (_familyMemo.size > 2000) _familyMemo.clear();
  _familyMemo.set(key, fam);
  return fam;
}
function _familyForUncached(query) {
  const qn = _norm(query);
  if (!qn) return null;
  for (const fam of ROLE_FAMILIES) if (fam.includes(qn)) return fam;
  if (qn.length >= 4) {
    for (const fam of ROLE_FAMILIES) for (const m of fam) {
      if (_phraseIn(m, qn) || _phraseIn(qn, m)) return fam;
    }
  }
  // Only a query no ROLE_FAMILIES row claims can reach a trade family (see TRADE_FAMILIES for the stricter match).
  const trade = _tradeFamilyFor(qn);
  return trade ? trade.members : null;
}

// Deterministic (no-AI) query expansion: the curated family phrases that name the SAME job,
// excluding the query itself. Empty when the query isn't in a known family. Used to widen the
// DB pool + live aggregation AND as relevance synonyms. Capped for latency/cost.
export function expandQueryTerms(query, max = 8) {
  const fam = _familyFor(query);
  if (!fam) return [];
  const qn = _norm(query);
  const out = [];
  for (const m of fam) {
    if (m !== qn && !out.includes(m)) out.push(m);
    if (out.length >= max) break;
  }
  return out;
}

// A listing carries PROVENANCE for a query when our own aggregation stamped its search_query
// with that query — i.e. Adzuna already fetched it FOR this exact search. This is a high-trust
// relevance signal that recovers the real roles a title-only bar drops ("Asset Protection
// Specialist" cached under search_query="theft prevention"). Keyed to the ORIGINAL query (and
// its canonical) ONLY — never to loose expansion tokens — so it can't reopen the budtender leak.
// Provenance is trustworthy only for a SPECIFIC query. A multi-word query ("theft prevention",
// "customer service") or a known role family ("budtender", "warehouse") stamps a topical
// search_query. A bare single common word ("target", "apple", "overnight") does NOT: sources
// full-text-match it inside unrelated descriptions, so a "target" search stamped a Nurse Manager.
// Those fall back to company/title match only — which keeps the real Target jobs, drops the noise.
function _isSpecificQuery(query) {
  const qn = _norm(query);
  if (!qn) return false;
  if (qn.split(' ').length >= 2) return true;
  return _familyFor(qn) != null;
}
function _provenanceMatch(job, query, canonical) {
  const sq = _norm(job && job.search_query);
  if (!sq) return false;
  if (!_isSpecificQuery(query)) return false; // don't trust a bare company/common-word stamp
  const qn = normalizeCompany(query);
  const cn = normalizeCompany(canonical || '');
  if (qn && (sq === qn || (qn.length >= 4 && _phraseIn(sq, qn)))) return true;
  if (cn && (sq === cn || (cn.length >= 4 && _phraseIn(sq, cn)))) return true;
  return false;
}

export function tokenize(q) {
  return String(q || '')
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !STOP.has(t));
}

export function normalizeCompany(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[\s,]+(inc\.?|llc\.?|corp\.?|ltd\.?|co\.|plc\.?|group|holdings|enterprises|solutions|technologies)\.?$/i, '')
    .trim();
}

// Resolve the effective true-synonym phrases for a query: the built-in curated set for
// the query PLUS any caller-provided expansion terms, cleaned. A single-word synonym is
// kept only if it is discriminating (not in GENERIC_SYNONYM and ≥3 chars); multi-word
// phrases are specific enough to keep as-is. Deduped, lowercased.
export function effectiveSynonyms(query, extra = []) {
  const built = _familyFor(query) || []; // the curated family (bidirectional), one source of truth
  const out = new Set();
  for (const raw of [...built, ...(Array.isArray(extra) ? extra : [])]) {
    const s = String(raw || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!s) continue;
    const words = s.split(' ');
    if (words.length === 1) {
      if (s.length >= 3 && !GENERIC_SYNONYM.has(s)) out.add(s);
    } else {
      out.add(s);
    }
  }
  return [...out];
}

// True iff a synonym appears in the title as a real token/phrase (word-boundary for a
// single word so "cannabis" doesn't match inside another word; substring for a phrase).
const _synRe = new Map();
function titleHasSynonym(title, syn) {
  if (!syn) return false;
  if (syn.includes(' ')) return title.includes(syn);
  let re = _synRe.get(syn);
  if (!re) {
    re = new RegExp(`(^|[^a-z0-9])${syn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`);
    if (_synRe.size > 2000) _synRe.clear();
    _synRe.set(syn, re);
  }
  return re.test(title);
}

// A query TOKEN is in the title only as a whole word (plural / -ing / -er / -ed forms allowed):
// "service" matches "Customer Service" and "Services" but NOT "ServiceNow"; "nurse" matches
// "Nurses"/"Nursing" but not "Nursery". The old substring test let "customer service" accept
// three Deloitte "Cyber ServiceNow" architects as relevant (live audit 2026-10-23).
const _tokenRe = new Map();
export function tokenInTitle(title, token) {
  if (!title || !token) return false;
  let re = _tokenRe.get(token);
  if (!re) {
    re = new RegExp(`(^|[^a-z0-9])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(s|es|ing|er|ers|ed)?([^a-z0-9]|$)`);
    if (_tokenRe.size > 2000) _tokenRe.clear();
    _tokenRe.set(token, re);
  }
  return re.test(title);
}

// Whole-query company match (a company-name search like "stripe").
function isCompanyMatch(company, qNorm) {
  return !!qNorm && (company === qNorm || company.includes(qNorm) || (qNorm.length >= 4 && qNorm.includes(company) && company.length >= 4));
}

// ── Seniority alignment ────────────────────────────────────────────────────────────────────
// A query that names no seniority ("customer service", "cashier", "nurse") is, overwhelmingly,
// someone looking for the front-line role. A Director / VP / Architect / Senior / Manager
// title that happens to share a word with it is a weaker match than the plain role, so it is
// ranked below every plain-role match (never dropped — isRelevant is unchanged). A query that
// DOES name a seniority ("senior nurse", "director of customer service") pays no penalty.
const QUERY_SENIORITY_RE = /(^|[^a-z0-9])(director|vp|vice president|chief|head|principal|architect|senior|sr|lead|manager|supervisor|executive|officer)([^a-z0-9]|$)/;
const TITLE_SENIORITY = [
  [/(^|[^a-z0-9])(director|vp|vice president|chief|head of|c[efot]o|president|partner)([^a-z0-9]|$)/, 40],
  [/(^|[^a-z0-9])(principal|architect|staff)([^a-z0-9]|$)/, 30],
  [/(^|[^a-z0-9])(senior|sr\.?|lead)([^a-z0-9]|$)/, 20],
  [/(^|[^a-z0-9])(manager|supervisor)([^a-z0-9]|$)/, 15],
];
export function seniorityPenalty(title, query) {
  const q = String(query || '').toLowerCase();
  if (QUERY_SENIORITY_RE.test(q)) return 0;
  const t = String(title || '').toLowerCase();
  let pen = 0;
  for (const [re, p] of TITLE_SENIORITY) if (re.test(t)) pen = Math.max(pen, p);
  return pen;
}

// ── Who is searching ──────────────────────────────────────────────────────────────────────────
// The signed-in person's résumé, reduced to what a ranking can use: the role families its titles
// belong to (roleOntology) and ONE industry bucket (the same five the jobs page's industry filter uses).
// "team lead · Phoenix" for a retail lead opened with an insurer's underwriting team lead and a lab's
// patient-services team lead above Walmart's member team lead — every title matched equally and the
// posting score decided (round 3, 2026-11-03). A row in the person's own family or industry now ranks
// above an equal title match elsewhere; it never makes an unrelated row relevant (isRelevant is unchanged).
const INDUSTRY_PATTERNS = {
  tech: /engineer|developer|software|programmer|\bdev\b|devops|\bdata\b|front[- ]?end|back[- ]?end|full[- ]?stack|cloud|cyber|\bqa\b|machine learning|\bml\b|\bai\b|\bsre\b|architect|sysadmin|database|analytics|technolog/gi,
  healthcare: /nurs|\brn\b|\blpn\b|\bcna\b|doctor|physician|health|medical|\bmedic\b|pharmac|clinic|caregiv|therap|dental|patient|hospital|\baide\b|phlebot|radiolog|surgical|behavioral|laborator/gi,
  retail: /retail|\bstores?\b|\bshop\b|cashier|sales assoc|merchandis|stock(?:er|ing| assoc)?|\bfood\b|restaurant|barista|\bserver\b|\bcook\b|kitchen|\bchef\b|\bcrew\b|team member|\bmembers?\b|\bclub\b|host(?:ess)?|bartend|\bdeli\b|grocery|caf[eé]\b|coffee|dishwash|busser|shift (?:lead|superv|manager)|key\s?holder|hospitality|catering|concession|drive[- ]?thru|cafeteria|dietary|line cook|\bguests?\b|\bassociates\b/gi,
  logistics: /driver|warehouse|logistic|supply chain|\bdelivery\b|courier|forklift|\bloader\b|\bpicker\b|\bpacker\b|shipping|receiving|\bfreight\b|dispatch|fulfil?lment|distribution|material handler|\bcdl\b|\btruck\b/gi,
  finance: /financ|accounting|accountant|bookkeep|\banalyst\b|banker|\bbank\b|insurance|insurer|teller|underwrit|actuar|\baudit|\btax\b|payroll|\bcredit\b|investment|\bloan\b|mortgage|controller|billing|brokerage/gi,
};
const FAMILY_INDUSTRY = {
  retail: 'retail', food_service: 'retail', hospitality: 'retail', customer_service: 'retail',
  clinical: 'healthcare', healthcare_support: 'healthcare',
  warehouse: 'logistics', delivery_logistics: 'logistics',
  software_engineering: 'tech', data_analytics: 'tech',
  finance_accounting: 'finance',
};
const FUNCTION_INDUSTRY = { engineering: 'tech', data: 'tech', finance: 'finance' };
export const INDUSTRIES = Object.keys(INDUSTRY_PATTERNS);

/** The industry bucket a listing reads as (title, employer, the first 800 chars of the posting), or null. */
export function industryOf(job) {
  const hay = `${job?.title || ''} ${job?.company || ''} ${String(job?.description || '').slice(0, 800)}`.toLowerCase();
  let best = null, bestN = 0, tie = false;
  for (const [ind, re] of Object.entries(INDUSTRY_PATTERNS)) {
    const n = (hay.match(re) || []).length;
    if (n > bestN) { best = ind; bestN = n; tie = false; } else if (n === bestN && n > 0) tie = true;
  }
  return tie ? null : best;
}

/**
 * The searcher's fit, from the résumé signal Seen already stores (resume_skills: top_titles, function)
 * and the profile's industry: { families: string[], industry: string|null }. Null when nothing is known.
 * @param {{ top_titles?: string[], function?: string|null, industry?: string|null }} signal
 */
export function searchFitFromSignal(signal = {}) {
  const titles = (Array.isArray(signal?.top_titles) ? signal.top_titles : []).map((t) => String(t || '').trim()).filter(Boolean).slice(0, 5);
  const families = [];
  for (const t of titles) {
    const fam = detectRoleFamily(t, '').family;
    if (fam && fam !== 'general' && !families.includes(fam)) families.push(fam);
  }
  let industry = String(signal?.industry || '').toLowerCase().trim();
  if (!INDUSTRY_PATTERNS[industry]) industry = families.map((f) => FAMILY_INDUSTRY[f]).find(Boolean) || FUNCTION_INDUSTRY[String(signal?.function || '').toLowerCase()] || null;
  if (!families.length && !industry) return null;
  return { families, industry };
}

/** +8 when the listing's role family is one of the searcher's; else +6 when its industry is theirs; else 0. */
export function fitBoost(job, fit) {
  if (!fit || !job) return 0;
  if (fit.families && fit.families.length) {
    const fam = detectRoleFamily(String(job.title || ''), String(job.description || '').slice(0, 800)).family;
    if (fam && fam !== 'general' && fit.families.includes(fam)) return 8;
  }
  if (fit.industry && industryOf(job) === fit.industry) return 6;
  return 0;
}

// How much of the title the query IS. "Team Lead" (nothing else) is a tighter match than "IT Operations
// Team Lead (Fulfillment Centres)": +6 for a bare title, one less per extra title word, floor 0. Only
// when every query word is in the title; a title's trailing location clause is not counted.
export function titleTightness(title, tokens) {
  const own = tokenize(stripTitleLocation(title)).length;
  return Math.max(0, 6 - Math.max(0, own - tokens.length));
}

// Relevance score of a listing for a query — used for RANKING. Tiers, highest first:
//   full query phrase in the title (+30) > every query token in the title (+12 each, +10 when all, up to
//   +6 for a title that is little more than the query) > a true-synonym / role-family phrase in the
//   title (+12) > the searcher's own family (+8) or industry (+6) > provenance (+6) > company (+8) >
//   description (+3 per token, a weak tiebreak only). A company-name search adds +60.
// Then the seniority penalty: for a query that names no seniority, Director/Architect/Senior/
// Manager titles rank below plain-role titles (floored at 1 so a relevant row never scores 0).
// Returns 0 when nothing matches. A description-only hit ranks but does NOT make a listing
// relevant (see isRelevant).
export function relevanceScore(job, query, { synonyms = [], canonical = '', fit = null } = {}) {
  const tokens = tokenize(query);
  if (!tokens.length) return 1; // empty query: everything is "related"
  const title = String(job.title || '').toLowerCase();
  const company = normalizeCompany(job.company);
  const desc = String(job.description || '').toLowerCase();
  const qNorm = normalizeCompany(query);

  // A trade query also reads a title's stand-in words ("apprentice" ↔ "Helper", "plumber" ↔ "Plumbing") and never
  // takes a family synonym from an instructor / engineer / manager title. Every other query: trade = null, unchanged.
  const trade = _tradeOf(query);
  const synOk = !trade || _tradeSynonymsOk(tokens, title);
  const aliasOn = synOk && !!trade && _tradeAliasesOn(query, tokens);

  let score = 0;
  if (isCompanyMatch(company, qNorm)) score += 60;
  let titleHits = 0;
  for (const t of tokens) {
    if (tokenInTitle(title, t) || (aliasOn && _tradeAliasInTitle(title, t))) { score += 12; titleHits++; }
    else if (company.includes(t)) score += 8;
    else if (desc.includes(t)) score += 3;
  }
  // Every token in the title (not just some) is a stronger match than a scatter.
  if (tokens.length > 1 && titleHits === tokens.length) score += 10;
  // A title that is little more than the query outranks one that buries it.
  if (titleHits === tokens.length) score += titleTightness(title, tokens);
  // Phrase bonus: the full query appears verbatim in the title.
  if (qNorm && title.includes(qNorm)) score += 30;
  // True-synonym title match (e.g. "budtender" → a "Cannabis Dispensary Associate").
  if (synOk) for (const syn of effectiveSynonyms(query, synonyms)) {
    if (titleHasSynonym(title, syn)) score += 12;
  }
  // The searcher's own family or industry leads among equal title matches.
  if (fit && score > 0) score += fitBoost(job, fit);
  // Provenance: fetched by our own aggregation FOR this query. A moderate boost — below a title
  // hit, so title matches still rank first, but enough to lift a genuine role a title-only bar missed.
  if (_provenanceMatch(job, query, canonical)) score += 6;
  if (score <= 0) return 0;
  return Math.max(1, score - seniorityPenalty(title, query));
}

// Is this listing GENUINELY related enough to show? The bar is a TITLE or COMPANY signal:
//  • a company-name match (company search), OR
//  • a query token in the title, OR
//  • the full query phrase in the title, OR
//  • a TRUE synonym (curated or caller-supplied expansion) in the title.
// A match found ONLY in the description, or ONLY via a generic expansion word, is NOT
// enough — that was the "budtender → Sales Manager" leak.
export function isRelevant(job, query, { synonyms = [], canonical = '' } = {}) {
  const tokens = tokenize(query);
  if (!tokens.length) return true; // empty query: everything is "related"
  const title = String(job.title || '').toLowerCase();
  const company = normalizeCompany(job.company);
  const qNorm = normalizeCompany(query);

  if (isCompanyMatch(company, qNorm)) return true;
  for (const t of tokens) { if (tokenInTitle(title, t)) return true; }
  if (qNorm && title.includes(qNorm)) return true;
  const synOk = !_tradeOf(query) || !TRADE_NON_CRAFT_RE.test(title);
  if (synOk) for (const syn of effectiveSynonyms(query, synonyms)) { if (titleHasSynonym(title, syn)) return true; }
  // Fetched by our aggregation FOR this exact query (search_query provenance) — the signal that
  // recovers "Asset Protection Specialist" for a "theft prevention" search. Not description, not a
  // generic expansion word, so the budtender→Sales Manager leak stays closed.
  if (_provenanceMatch(job, query, canonical)) return true;
  return false;
}

// Is the listing a MATCH for the search — the role the person typed, not just a row that shares a
// word with it? Title-family tier or better, judged on the title (or the company for a company search):
//  • a company-name match, OR
//  • the full query phrase in the title, OR
//  • EVERY query token in the title (whole words, plural/-ing forms), OR
//  • a curated role-family phrase (or the canonical form of the query) in the title.
// isRelevant() is looser on purpose (ANY token keeps a row in the pool), which is how "pharmacy
// technician · Phoenix" served "Environmental Services & Facilities Technician" and "call center"
// served "Center-Based Behavior Technician" as if they matched (audit 2026-10-24, H9). The page shows
// rows that are not a match under "Other openings", below every match, whatever the sort.
// Whole-word abbreviations a title uses for a query word. Conservative on purpose: only forms that
// mean exactly the same job word ("Travel Med Surg RN" is a nurse job; "Pharmacy Tech" is a technician).
// Found live 2026-10-24: a "travel nurse" search marked 35 of 60 travel-RN listings as unrelated.
const TOKEN_ALIASES = {
  nurse: ['rn', 'lpn', 'lvn'],
  technician: ['tech'],
  representative: ['rep'],
  manager: ['mgr'],
  assistant: ['asst'],
  associate: ['assoc'],
  administrative: ['admin'],
  administrator: ['admin'],
  developer: ['dev'],
};
function tokenOrAliasInTitle(title, token) {
  if (tokenInTitle(title, token)) return true;
  const aliases = TOKEN_ALIASES[token];
  return !!aliases && aliases.some((a) => tokenInTitle(title, a));
}

export function isTitleRelated(job, query, { canonical = '' } = {}) {
  const tokens = tokenize(query);
  if (!tokens.length) return true;
  const title = String(job.title || '').toLowerCase();
  const company = normalizeCompany(job.company);
  const qNorm = normalizeCompany(query);
  if (isCompanyMatch(company, qNorm)) return true;
  if (qNorm && title.includes(qNorm)) return true;
  if (tokens.every((t) => tokenOrAliasInTitle(title, t))) return true;
  // A trade query: no stand-in word and no family synonym makes an instructor / engineer / manager title a match.
  const trade = _tradeOf(query);
  if (trade && TRADE_NON_CRAFT_RE.test(title)) return false;
  if (trade && _tradeAliasesOn(query, tokens) && tokens.every((t) => tokenOrAliasInTitle(title, t) || _tradeAliasInTitle(title, t))) return true;
  if (trade && !_tradeSynonymsOk(tokens, title)) return false;
  const fam = [...(_familyFor(query) || [])];
  const cn = String(canonical || '').toLowerCase().trim();
  if (cn && cn !== qNorm && cn.split(' ').length > 1) fam.push(cn);
  for (const syn of effectiveSynonyms('', fam)) { if (titleHasSynonym(title, syn)) return true; }
  return false;
}

// Back-compat alias. Older callers used isRelated(job, query[, minScore]); the strict
// title/synonym bar replaces the numeric threshold, so a legacy numeric arg is ignored.
export function isRelated(job, query, opts = {}) {
  return isRelevant(job, query, (opts && typeof opts === 'object') ? opts : {});
}

// Detect a company-name search: the whole query closely matches a known company.
// `knownCompanies` is an optional array/Set of company names (raw or normalized).
export function looksLikeCompany(query, knownCompanies) {
  const qn = normalizeCompany(query);
  if (!qn || qn.split(/\s+/).length > 4) return false;
  if (!knownCompanies) return false;
  const set = (Array.isArray(knownCompanies) ? knownCompanies : [...knownCompanies]).map(normalizeCompany);
  if (set.includes(qn)) return true;
  return set.some((c) => c && c.length >= 4 && (c === qn || c.includes(qn) || qn.includes(c)));
}

// Filter to GENUINELY related listings (strict title/synonym bar) and rank by relevance,
// then quality score. `synonyms` are the query's expansion terms (canonical + related)
// used as true-synonym signals — matched as title phrases, never scattered as loose tokens.
export function filterAndRank(jobs, query, { synonyms = [], canonical = '', fit = null } = {}) {
  const hasQuery = tokenize(query).length > 0;
  const scored = (jobs || [])
    .map((j) => ({ j, r: relevanceScore(j, query, { synonyms, canonical, fit }) }))
    .filter((x) => !hasQuery || isRelevant(x.j, query, { synonyms, canonical }));
  scored.sort((a, b) => (b.r - a.r) || ((b.j.score || 0) - (a.j.score || 0)));
  return scored.map((x) => x.j);
}

// ── Location matching ────────────────────────────────────────────────────────
// Job locations are free-form strings ("Austin, Travis County", "Old Sixth Ward,
// Houston", "Dallas, Texas", "US"). The searched city almost always appears in the
// string, so we match on the city name (best signal), then same-state, then
// remote/national. Cross-location listings are dropped.

const US_STATES = {
  al: 'alabama', ak: 'alaska', az: 'arizona', ar: 'arkansas', ca: 'california',
  co: 'colorado', ct: 'connecticut', de: 'delaware', fl: 'florida', ga: 'georgia',
  hi: 'hawaii', id: 'idaho', il: 'illinois', in: 'indiana', ia: 'iowa', ks: 'kansas',
  ky: 'kentucky', la: 'louisiana', me: 'maine', md: 'maryland', ma: 'massachusetts',
  mi: 'michigan', mn: 'minnesota', ms: 'mississippi', mo: 'missouri', mt: 'montana',
  ne: 'nebraska', nv: 'nevada', nh: 'new hampshire', nj: 'new jersey', nm: 'new mexico',
  ny: 'new york', nc: 'north carolina', nd: 'north dakota', oh: 'ohio', ok: 'oklahoma',
  or: 'oregon', pa: 'pennsylvania', ri: 'rhode island', sc: 'south carolina',
  sd: 'south dakota', tn: 'tennessee', tx: 'texas', ut: 'utah', vt: 'vermont',
  va: 'virginia', wa: 'washington', wv: 'west virginia', wi: 'wisconsin', wy: 'wyoming',
  dc: 'district of columbia',
};
const STATE_BY_NAME = Object.fromEntries(Object.entries(US_STATES).map(([a, n]) => [n, a]));

// Parse a free-form location into { city, stateAbbr, stateName, remote }.
export function parseLocation(loc) {
  const s = String(loc || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const remote = /\bremote\b/.test(s);
  const cleaned = s.replace(/\bremote\b/g, ' ').replace(/\s+/g, ' ').replace(/^[,\s]+|[,\s]+$/g, '').trim();
  if (!cleaned) return { city: '', stateAbbr: '', stateName: '', remote };

  const parts = cleaned.split(',').map((p) => p.trim()).filter(Boolean);
  let city = parts[0] || '';
  let stateAbbr = '', stateName = '';
  const setState = (tok) => {
    if (US_STATES[tok]) { stateAbbr = tok; stateName = US_STATES[tok]; return true; }
    if (STATE_BY_NAME[tok]) { stateAbbr = STATE_BY_NAME[tok]; stateName = tok; return true; }
    return false;
  };

  if (parts.length > 1) {
    setState(parts[parts.length - 1]);
  } else if (city.includes(' ')) {
    // "austin tx" — state as the trailing word.
    const w = city.split(' ');
    if (setState(w[w.length - 1])) city = w.slice(0, -1).join(' ');
  }
  // A bare state ("texas" / "tx") with no city.
  if (parts.length === 1 && !city.includes(' ') && !stateAbbr && setState(city)) city = '';

  return { city: city.length >= 2 ? city : '', stateAbbr, stateName, remote };
}

// Higher = better location match. 3 city · 2 same-state · 1 remote/national · 0 none.
export function locationScore(jobLocation, parsed) {
  if (!parsed) return 1;
  const jl = String(jobLocation || '').toLowerCase().trim();
  if (!jl) return 1; // unknown location — don't penalise
  if (parsed.city && parsed.city.length >= 2 && jl.includes(parsed.city)) return 3;
  if (parsed.stateName && jl.includes(parsed.stateName)) return 2;
  if (parsed.stateAbbr && new RegExp(`(^|[^a-z])${parsed.stateAbbr}([^a-z]|$)`).test(jl)) return 2;
  if (jl === 'us' || jl === 'usa' || jl === 'united states' || /\bremote\b/.test(jl)) return 1;
  return 0;
}

// Keep only listings in/near the searched location, ranked city → state → remote,
// preserving the input (relevance) order within each tier. No location → unchanged.
export function filterByLocation(jobs, loc) {
  const p = parseLocation(loc);
  if (!p || (!p.city && !p.stateAbbr && !p.stateName && !p.remote)) return Array.isArray(jobs) ? jobs : [];
  const kept = [];
  (jobs || []).forEach((j, i) => {
    const s = locationScore(j.location, p);
    if (s > 0) kept.push({ j, s, i });
  });
  kept.sort((a, b) => (b.s - a.s) || (a.i - b.i));
  return kept.map((k) => k.j);
}

// Rank by proximity (city → state → remote/national → unknown → far) WITHOUT dropping
// anything. Used as a graceful widen: when strict filterByLocation would return too few,
// we still surface the closest available listings first instead of showing nothing.
export function sortByProximity(jobs, loc) {
  const p = parseLocation(loc);
  if (!p || (!p.city && !p.stateAbbr && !p.stateName && !p.remote)) return Array.isArray(jobs) ? jobs.slice() : [];
  return (jobs || [])
    .map((j, i) => ({ j, s: locationScore(j.location, p), i }))
    .sort((a, b) => (b.s - a.s) || (a.i - b.i))
    .map((x) => x.j);
}

// PostgREST ilike term to pre-filter the DB query to the searched place (city
// preferred, else state name). '' when there's no usable location.
export function locationDbTerm(loc) {
  const p = parseLocation(loc);
  return (p && (p.city || p.stateName)) || '';
}
