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

// Words too common in titles to make a listing a match on their own when the search has other words too.
const GENERIC_TOKEN = new Set([...GENERIC_SYNONYM, 'worker', 'workers', 'developer', 'engineer', 'support', 'technician', 'tech', 'analyst',
  'data', 'social', 'entry', 'service', 'services', 'customer', 'care', 'health', 'medical', 'office', 'home', 'lead', 'specialist',
  'it', 'hr', 'night', 'shift', 'day', 'remote', 'work', 'from', 'business', 'development', 'design', 'designer', 'systems', 'system',
  'operations', 'product', 'project', 'program', 'account', 'technical', 'travel', 'store', 'retail', 'food', 'driver', 'nurse', 'aide']);

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
  // Acronyms people type for a role, with the titles that spell it out (audit 2026-10-27: "RN · Phoenix" served 59
  // unrelated rows, "SWE" 52, "HR" 10 — the short word matched inside other words and nothing bridged it to the title).
  ['registered nurse', 'rn', 'staff nurse', 'travel nurse', 'charge nurse', 'travel rn'],
  ['licensed practical nurse', 'lpn', 'licensed vocational nurse', 'lvn'],
  ['human resources', 'hr', 'hr generalist', 'hr coordinator', 'hr specialist', 'hr assistant', 'people operations', 'hr business partner'],
  ['software engineer', 'swe', 'software developer', 'sde', 'software development engineer'],
  ['quality assurance', 'qa', 'qa tester', 'qa engineer', 'qa analyst', 'test engineer', 'sdet', 'software tester'],
  ['ux designer', 'ux', 'user experience designer', 'product designer', 'ui/ux designer', 'ux/ui designer', 'interaction designer'],
  ['it support', 'help desk', 'helpdesk', 'desktop support', 'service desk', 'it technician', 'it specialist', 'it support specialist', 'technical support specialist'],
  ['emt', 'emergency medical technician', 'paramedic', 'emt-b', 'ambulance'],
  ['physical therapist', 'pt', 'dpt', 'physical therapy', 'physiotherapist'],
  ['occupational therapist', 'ot', 'otr', 'occupational therapy'],
  ['social worker', 'msw', 'lcsw', 'lmsw', 'medical social worker', 'clinical social worker'],
  ['data entry', 'data entry clerk', 'data entry specialist', 'data clerk', 'typist', 'data entry operator'],
  ['sdr', 'sales development representative', 'bdr', 'business development representative', 'sales development'],
  ['frontend developer', 'front end developer', 'frontend engineer', 'front end engineer', 'ui developer', 'ui engineer', 'react developer'],
  ['full stack developer', 'full stack', 'fullstack', 'full stack engineer', 'fullstack engineer', 'fullstack developer'],
  ['devops', 'devops engineer', 'site reliability engineer', 'sre', 'platform engineer', 'infrastructure engineer'],
  ['data analyst', 'business intelligence analyst', 'bi analyst', 'reporting analyst', 'analytics analyst', 'data analytics'],
  ['medical assistant', 'ma', 'certified medical assistant', 'cma', 'clinical medical assistant'],
  ['accountant', 'staff accountant', 'cpa', 'senior accountant', 'accounting associate', 'tax accountant'],
  ['bookkeeper', 'accounting clerk', 'accounts payable', 'accounts receivable', 'ap clerk', 'ar clerk', 'bookkeeping'],
  ['paralegal', 'legal assistant', 'litigation paralegal', 'legal secretary'],
  ['recruiter', 'talent acquisition', 'technical recruiter', 'sourcer', 'recruiting coordinator', 'talent acquisition specialist'],
  ['teacher', 'educator', 'classroom teacher', 'elementary teacher', 'high school teacher', 'special education teacher', 'substitute teacher'],
  ['electrician', 'journeyman electrician', 'apprentice electrician', 'electrical technician', 'electrical apprentice'],
  ['hvac technician', 'hvac', 'hvac tech', 'hvac installer', 'refrigeration technician', 'hvac service technician'],
  ['truck driver', 'cdl driver', 'cdl a driver', 'class a driver', 'otr driver', 'regional driver', 'local cdl driver', 'cdl'],
  ['front desk', 'front desk agent', 'guest service agent', 'front desk associate', 'hotel front desk', 'guest services agent'],
  ['dental assistant', 'registered dental assistant', 'rda', 'dental assisting'],
  ['stocker', 'overnight stocker', 'stock associate', 'stock clerk', 'replenishment associate', 'night stocker', 'merchandise associate'],
];

// Lowercase words only — the form every phrase and company comparison uses, so "Chick-fil-A" and "chick fil a",
// "In-N-Out" and "in n out", "Front-End" and "front end" are the same text.
export function canonText(s) {
  return String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9+#]+/g, ' ').replace(/\s+/g, ' ').trim();
}
// Is `phrase` a whole run of words inside `text`? (Both canonText'ed.) The old `title.includes(query)` let "server"
// match "Visual Observer", "intern" match "International", and "rn" match half the titles in the corpus.
export function phraseIn(text, phrase) {
  if (!text || !phrase) return false;
  return (` ${text} `).includes(` ${phrase} `);
}

// Normalize a surface for family matching: lowercase, keep alnum/+#., collapse spaces.
function _norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9+#.\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
// Whole-word phrase containment: does `needle` appear as a full token-run inside `hay`?
function _phraseIn(hay, needle) {
  if (!hay || !needle) return false;
  return new RegExp(`(^|\\s)${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(hay);
}
// The curated family a query belongs to (or null). Exact member match first, then whole-word
// containment either direction for queries ≥4 chars (so "warehouse" hits "warehouse associate"
// and "asset protection specialist" hits "asset protection").
function _familyFor(query) {
  const qn = _norm(query);
  if (!qn) return null;
  for (const fam of ROLE_FAMILIES) if (fam.includes(qn)) return fam;
  // containment only for a word that names one kind of work: "warehouse" → the warehouse family, but "engineer",
  // "support", "data", "manager" sit inside many families' phrases and would pull a stranger's synonyms in
  // ("engineer" → software developers; "support" → help desk)
  if (qn.length >= 4 && !GENERIC_TOKEN.has(qn)) {
    for (const fam of ROLE_FAMILIES) for (const m of fam) {
      if (_phraseIn(m, qn) || _phraseIn(qn, m)) return fam;
    }
  }
  return null;
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
// Only a search of two or more words: a one-word role search already has its family's titles as synonyms, and the
// live pull's full-text match stamped it on ads that only mention the word ("bookkeeper" → a surrogacy ad, "cashier" →
// "Flight Checker" — audit 2026-10-27).
function _isSpecificQuery(query) {
  const qn = _norm(query);
  if (!qn) return false;
  return qn.split(' ').length >= 2;
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
function titleHasSynonym(title, syn) {
  if (!syn) return false;
  if (syn.includes(' ')) return title.includes(syn);
  return new RegExp(`(^|[^a-z0-9])${syn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(title);
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

// Words that end a job title. A search ending in one is a role search, never a search for a company that happens to
// start with the same word ("recruiter" is not "Recruiter.com", "nurse" is not "Nurse Staffing LLC").
const ROLE_NOUNS = new Set(['recruiter', 'recruiters', 'nurse', 'nurses', 'driver', 'drivers', 'manager', 'engineer', 'developer', 'technician',
  'tech', 'assistant', 'associate', 'specialist', 'representative', 'rep', 'analyst', 'coordinator', 'cashier', 'server', 'cook', 'clerk',
  'agent', 'officer', 'worker', 'teacher', 'therapist', 'designer', 'consultant', 'operator', 'mechanic', 'electrician', 'plumber', 'cleaner',
  'guard', 'attendant', 'aide', 'barista', 'bartender', 'stocker', 'handler', 'picker', 'packer', 'installer', 'writer', 'editor', 'jobs', 'job']);
// Legal and filler words a company name carries that nobody types.
const COMPANY_FILLER = new Set(['inc', 'incorporated', 'llc', 'llp', 'lp', 'ltd', 'limited', 'corp', 'corporation', 'co', 'company', 'plc', 'the', 'pllc', 'pc']);
function companyCore(company) {
  return canonText(company).split(' ').filter((w) => w && !COMPANY_FILLER.has(w));
}

// Does the search name this company? Whole words only. The old test was `company.includes(query)`, so "RN" named
// "Western Veterinary Partners" and "Marketech International", "SWE" named "Home Sweet Home Health" and "Newsweek",
// "HR" named "Thrivent", and "ups" named every "… Groups" — each ranked +60 above the real matches (audit 2026-10-27).
//  • the same name ("stripe", "chick fil a" = "Chick-fil-A", "innout" = "In-N-Out");
//  • the search contains the company's whole name ("target cashier", "amazon warehouse");
//  • the search is the start of the company's name ("in n out" → "In-N-Out Burger", "banner" → "Banner Health"),
//    when it is at least 4 letters and does not end in a job word.
export function isCompanyMatch(company, query) {
  const c = companyCore(company);
  const q = canonText(query).split(' ').filter(Boolean);
  if (!c.length || !q.length) return false;
  const cj = c.join(' '), qj = q.join(' ');
  if (cj === qj || c.join('') === q.join('')) return true;
  if (cj.replace(/ /g, '').length >= 3 && phraseIn(qj, cj)) return true;
  if (qj.replace(/ /g, '').length >= 4 && cj.startsWith(`${qj} `) && !ROLE_NOUNS.has(q[q.length - 1])) return true;
  return false;
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

// Relevance score of a listing for a query — used for RANKING. Tiers, highest first:
//   full query phrase in the title (+30) > every query token in the title (+12 each) >
//   a true-synonym / role-family phrase in the title (+12) > provenance (+6) > company (+8) >
//   description (+3 per token, a weak tiebreak only). A company-name search adds +60.
// Then the seniority penalty: for a query that names no seniority, Director/Architect/Senior/
// Manager titles rank below plain-role titles (floored at 1 so a relevant row never scores 0).
// Returns 0 when nothing matches. A description-only hit ranks but does NOT make a listing
// relevant (see isRelevant).
export function relevanceScore(job, query, { synonyms = [], canonical = '' } = {}) {
  const tokens = tokenize(query);
  if (!tokens.length) return 1; // empty query: everything is "related"
  const title = String(job.title || '').toLowerCase();
  const titleC = canonText(job.title);
  const companyC = canonText(job.company);
  const desc = String(job.description || '').toLowerCase();
  const qC = canonText(query);

  let score = 0;
  if (isCompanyMatch(job.company, query)) score += 60;
  let titleHits = 0;
  for (const t of tokens) {
    if (tokenOrAliasInTitle(title, t)) { score += 12; titleHits++; }
    else if (phraseIn(companyC, canonText(t))) score += 8;
    else if (t.length >= 4 && desc.includes(t)) score += 3;
  }
  // Every token in the title (not just some) is a stronger match than a scatter.
  if (tokens.length > 1 && titleHits === tokens.length) score += 10;
  // Phrase bonus: the full query appears in the title as whole words.
  if (qC && phraseIn(titleC, qC)) score += 30;
  // True-synonym title match (e.g. "budtender" → a "Cannabis Dispensary Associate").
  for (const syn of effectiveSynonyms(query, synonyms)) {
    if (titleHasSynonym(title, syn)) score += 12;
  }
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
  const qC = canonText(query);

  if (isCompanyMatch(job.company, query)) return true;
  if (qC && phraseIn(canonText(job.title), qC)) return true;
  // One word of a longer search is enough only when it says something on its own: "phlebotomy", "hygienist",
  // "therapist" — never "worker", "developer", "support", "data" (audit 2026-10-27: "social worker" listed "Yard Worker"
  // and "Paid Social"; "IT support" listed "Customer Support Lead"; "work from home data entry" listed data engineers).
  const hits = tokens.filter((t) => tokenOrAliasInTitle(title, t));
  if (hits.length && (tokens.length === 1 || hits.length === tokens.length || hits.some((t) => !GENERIC_TOKEN.has(t)))) return true;
  for (const syn of effectiveSynonyms(query, synonyms)) { if (titleHasSynonym(title, syn)) return true; }
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
  frontend: ['front end'],
  fullstack: ['full stack'],
  'front-end': ['front end', 'frontend'],
  'full-stack': ['full stack', 'fullstack'],
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
  const qNorm = normalizeCompany(query);
  if (isCompanyMatch(job.company, query)) return true;
  if (phraseIn(canonText(job.title), canonText(query))) return true;
  if (tokens.every((t) => tokenOrAliasInTitle(title, t))) return true;
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
export function filterAndRank(jobs, query, { synonyms = [], canonical = '' } = {}) {
  const hasQuery = tokenize(query).length > 0;
  const scored = (jobs || [])
    .map((j) => ({ j, r: relevanceScore(j, query, { synonyms, canonical }) }))
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
