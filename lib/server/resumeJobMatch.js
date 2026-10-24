// Résumé → jobs floor. The "no one is ever allowed to not find jobs they want" guarantee.
//
// A parsed résumé is the strongest possible job-seeking signal. When we have one we want the
// /jobs "Matched to your résumé" rail to be ALWAYS full — even for a niche résumé whose role
// isn't in our corpus yet. Rather than build a parallel matcher, we derive a plain SEARCH
// QUERY from the parsed résumé (the person's real role/title) and route it through the SAME
// on-demand aggregation the fixed job search uses. That inherits the whole floor for free:
// relevance is judged upstream, the live top-up fills a thin corpus, and — critically — the
// 3h per-(query,location) cooldown + the global aggregation budget keep it scale-safe.
//
// Pure derivation lives here (unit-tested); the pull is a thin, guarded wrapper over
// jobSources.aggregateForQuery — no new Adzuna path, no second uncapped pull.

import { aggregateForQuery, wasRecentlyPulled, recordPull } from './jobSources.js';
import { rateLimitGlobal } from './ratelimit.js';
import { extractEmployment, extractCareerSignal } from './resumeAnalysis.js';
import { detectRoleFamily } from '../application-intelligence/roleOntology.js';
import { parseLocation, locationScore } from '../../api/_utils/jobRelevance.js';
import { haversineMiles, hasUsableCoords } from './geo.js';
import { isRemoteListing } from './jobPriority.js';
import { parseResume } from '../resume/parse/index.js';
import { LOCATION_INLINE_RE } from '../resume/parse/lexicon.js';
import { locationScope } from '../jobs/usLocation.js';

// ── The rail's match bar: same ROLE FAMILY as a résumé title, AND near the person ─────────────
// The live audit (2026-10-23) showed a Phoenix gym-membership / valet / GNC sales-associate résumé
// a "Matched to your résumé · sales" deck of a Dallas hotel Account Executive and a SpaceX
// Commercial Sales Manager in Hawthorne: the word "sales" alone matched, and nothing checked
// where the person lives. A match now needs BOTH a title-family match (roleOntology families:
// a sales associate is `retail`, an account executive is `sales`) and a location match (the
// profile city, or a remote listing).

// Seniority / employment-type words that never identify the role itself.
const ROLE_NOISE_RE = /\b(senior|sr\.?|junior|jr\.?|lead|principal|staff|entry[-\s]?level|intern|internship|trainee|apprentice|contract|contractor|temporary|temp|part[-\s]?time|full[-\s]?time|remote|hybrid|onsite|on[-\s]?site|seasonal|i{1,3}|iv|v|\d+)\b/gi;
const normRole = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(ROLE_NOISE_RE, ' ').replace(/\s+/g, ' ').trim();

/**
 * The role families a résumé's titles belong to (roleOntology.detectRoleFamily, title only;
 * 'general' = unknown and never counts), plus the noise-stripped title phrases themselves.
 * @param {{ top_titles?: string[], function?: string }} signal
 * @returns {{ families: string[], phrases: string[] }}
 */
export function resumeRoleFamilies(signal = {}) {
  const titles = (Array.isArray(signal?.top_titles) ? signal.top_titles : []).map((t) => String(t || '').trim()).filter(Boolean).slice(0, 5);
  const families = new Set();
  const phrases = new Set();
  for (const t of titles) {
    const fam = detectRoleFamily(t, '').family;
    if (fam && fam !== 'general') families.add(fam);
    const p = normRole(t);
    if (p.length >= 3 && /[a-z]{3,}/.test(p)) phrases.add(p);
  }
  return { families: [...families], phrases: [...phrases] };
}

/**
 * Does a listing's TITLE belong to one of the résumé's role families, or carry one of its role
 * phrases whole? The word "sales" is not a family; "Sales Associate" (retail) and "Account
 * Executive" (sales) are different families, so a GNC associate never gets a hotel AE.
 * @param {{ title?: string }} job
 * @param {{ families: string[], phrases: string[] }} resume from resumeRoleFamilies
 */
export function jobMatchesResume(job, resume) {
  const title = String(job?.title || '');
  if (!title.trim() || !resume) return false;
  const fam = detectRoleFamily(title, '').family;
  if (fam && fam !== 'general' && (resume.families || []).includes(fam)) return true;
  const t = normRole(title);
  for (const p of resume.phrases || []) {
    if (p && new RegExp(`(^|\\s)${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(t)) return true;
  }
  return false;
}

/** Ranking strength of a match: a family match with a shared role phrase ranks first. */
export function resumeMatchStrength(job, resume) {
  if (!jobMatchesResume(job, resume)) return 0;
  const t = normRole(job?.title);
  let s = 10;
  for (const p of resume.phrases || []) if (p && t.includes(p)) { s += 10; break; }
  const fam = detectRoleFamily(String(job?.title || ''), '').family;
  if (fam && fam !== 'general' && (resume.families || []).includes(fam)) s += 5;
  return s;
}

/**
 * The résumé role phrase a listing's title carries whole ("cashier" in "Cashier - Store 123"), or
 * null when the match is by role family only. Used to say WHY a listing matches.
 * @param {{ title?: string }} job
 * @param {{ phrases: string[] }} resume from resumeRoleFamilies
 */
export function matchedRolePhrase(job, resume) {
  const t = normRole(job?.title);
  if (!t) return null;
  for (const p of resume?.phrases || []) {
    if (p && new RegExp(`(^|\\s)${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(t)) return p;
  }
  return null;
}

/**
 * Is a listing near the person: within `miles` of the profile city's coordinates when both are
 * known, else when its own location text names that city; remote listings always qualify.
 * @param {{ location?: string, lat?: number|null, lng?: number|null }} job
 * @param {{ city: string, center?: { lat: number, lng: number }|null, miles?: number }} home
 */
export function jobNearCity(job, home) {
  if (!job) return false;
  if (isRemoteListing(job)) return true;
  const city = String(home?.city || '').trim();
  if (!city) return false;
  const parsed = parseLocation(city);
  if (home?.center && hasUsableCoords(home.center) && hasUsableCoords(job)) {
    return haversineMiles(home.center, job) <= (Number(home.miles) > 0 ? Number(home.miles) : 30) + 1;
  }
  return !!(parsed && parsed.city) && locationScore(job.location, parsed) === 3;
}

/**
 * The résumé signal the /jobs "Matched to your résumé" rail needs, derived from the CANONICAL
 * résumé text (profiles.resume_text) with the SAME extraction the upload path persists — so a
 * résumé saved by any route (upload, Studio, profile) yields the same rail. Never throws. A résumé
 * with no dictionary skills still yields its titles, the strongest signal for non-tech roles.
 *
 * @param {string} resumeText
 * @returns {{ skills: string[], seniority: string|null, function: string|null, years_exp: number|null, top_titles: string[] }}
 */
export function deriveResumeSignal(resumeText) {
  const text = String(resumeText || '');
  let employment = [];
  try { employment = extractEmployment(text) || []; } catch { employment = []; }
  let signal = null;
  try { signal = extractCareerSignal(text, employment); } catch { signal = null; }
  const top_titles = employment.map((e) => e && e.title).filter(Boolean).slice(0, 3);
  const years = Number(signal?.years_exp);
  return {
    skills: Array.isArray(signal?.skills) ? signal.skills : [],
    seniority: signal?.seniority || null,
    function: signal?.function || null,
    years_exp: Number.isFinite(years) ? years : null,
    top_titles,
  };
}

/**
 * The city a résumé states about its owner — the contact-block location ("Phoenix, AZ 85004" →
 * "Phoenix, AZ"), read by the same parser Résumé Studio uses (lib/resume/parse, basics.location),
 * with the header's inline "City, ST" as the fallback. Used by the /jobs rail when the profile has
 * no city (live audit 2026-10-23: the résumé began "Phoenix, AZ 85004" and the rail still asked
 * for a city). US places only — a remote/hybrid label or a foreign city yields '' so the rail
 * never searches "near Remote". Never throws.
 * @param {string} resumeText
 * @returns {string} "City, ST" or ''
 */
export function deriveResumeCity(resumeText) {
  const text = String(resumeText || '');
  if (!text.trim()) return '';
  let loc = '';
  try { loc = String(parseResume({ text }).basics?.location || ''); } catch { loc = ''; }
  if (!loc) {
    // The parser needs a few lines of structure; a bare header still carries "City, ST" inline.
    const head = text.split(/\r?\n/).slice(0, 8).join('\n');
    const m = head.match(LOCATION_INLINE_RE);
    if (m) loc = m[1] || m[0];
  }
  return cleanResumeCity(loc);
}

/** "Phoenix, AZ 85004" → "Phoenix, AZ"; remote labels, foreign and unplaceable text → ''. */
export function cleanResumeCity(loc) {
  let s = String(loc || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (/^(?:remote|hybrid|on-?site|work from home|wfh)\b/i.test(s)) return '';
  s = s.replace(/\s*\(?(?:remote|hybrid|on-?site)\)?\.?$/i, '').replace(/\.$/, '').trim();
  s = s.replace(/\s+\d{5}(?:-\d{4})?(?=,|$)/, ''); // ZIP after the state
  s = s.replace(/,\s*(?:usa|united states(?: of america)?|u\.s\.a?\.?)$/i, '').trim();
  const parsed = parseLocation(s);
  if (!parsed || !parsed.city) return '';
  if (locationScope(s) !== 'us') return '';
  return s.slice(0, 80);
}

/**
 * Is the cached resume_skills row unusable for the résumé on file — missing, carrying no signal
 * (no skills AND no titles), or older than the résumé it describes?
 * @param {{ skills?: string[], top_titles?: string[], updated_at?: string }|null} row
 * @param {string|null|undefined} resumeUpdatedAt profiles.resume_updated_at
 */
export function resumeSkillsStale(row, resumeUpdatedAt) {
  if (!row) return true;
  const hasSignal = (Array.isArray(row.skills) && row.skills.length > 0) || (Array.isArray(row.top_titles) && row.top_titles.length > 0);
  if (!hasSignal) return true;
  const resAt = Date.parse(resumeUpdatedAt || '');
  if (!Number.isFinite(resAt)) return false;
  const rowAt = Date.parse(row.updated_at || '');
  return !Number.isFinite(rowAt) || rowAt < resAt;
}

// A résumé "function" (from resumeAnalysis.extractCareerSignal FUNCTION_MAP) → a concrete,
// searchable role title. Only used as a fallback when the résumé carried no usable job title.
const FUNCTION_ROLE = {
  engineering: 'software engineer',
  design: 'designer',
  product: 'product manager',
  marketing: 'marketing',
  sales: 'sales representative',
  data: 'data analyst',
  finance: 'accountant',
  legal: 'legal',
  ops: 'operations',
};

// Words that describe seniority/employment-type, not the role itself. Stripped from a title so
// "Senior Software Engineer (Contract)" derives the searchable role "software engineer" — a
// broader, higher-recall query than the person's exact stamped title.
const TITLE_NOISE_RE = /\b(senior|sr\.?|junior|jr\.?|lead|principal|staff|entry[-\s]?level|intern|internship|trainee|apprentice|contract|contractor|temporary|temp|part[-\s]?time|full[-\s]?time|remote|hybrid|onsite|on[-\s]?site|i{1,3}|iv|v|\d+)\b/gi;

function cleanQuery(s) {
  return String(s || '')
    .replace(/[<>`\\|()[\]{}]/g, ' ')      // strip characters that abuse filters / injection
    .replace(/[•·–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

// A candidate query is usable if it has real letters and isn't a bare number / single char.
function usableQuery(s) {
  const c = cleanQuery(s);
  return c.length >= 2 && /[a-z]{2,}/i.test(c) ? c.toLowerCase() : '';
}

/**
 * Derive a single, high-recall SEARCH QUERY from a parsed-résumé signal.
 * Priority: the person's real job title (top_titles) → their function mapped to a role →
 * their strongest skill. Returns '' when the résumé yielded nothing searchable (caller skips).
 *
 * @param {{ top_titles?: string[], function?: string, skills?: string[] }} signal
 * @returns {string}
 */
export function deriveResumeJobQuery(signal = {}) {
  const titles = Array.isArray(signal?.top_titles) ? signal.top_titles : [];
  for (const t of titles) {
    // Prefer the role stripped of seniority/type noise (higher recall); fall back to the
    // raw title when stripping leaves nothing (e.g. a title that was only "Lead").
    const stripped = usableQuery(cleanQuery(t).replace(TITLE_NOISE_RE, ' '));
    if (stripped) return stripped;
    const raw = usableQuery(t);
    if (raw) return raw;
  }

  const fn = String(signal?.function || '').toLowerCase().trim();
  if (FUNCTION_ROLE[fn]) return FUNCTION_ROLE[fn];

  const skills = Array.isArray(signal?.skills) ? signal.skills : [];
  for (const s of skills) {
    const q = usableQuery(s);
    if (q) return q;
  }
  return '';
}

/**
 * Fill the corpus for a résumé-derived query by routing it through the SAME live aggregation
 * the fixed job search uses — inheriting its scale guards. Fire-and-forget safe.
 *
 * Scale safety (identical to api/jobs.js search top-up):
 *  1. cooldown — skip if this (query, location) was pulled within the window (corpus is fresh).
 *  2. global budget — skip if the platform-wide aggregation budget is spent (never overspend).
 * Only after both pass does it call aggregateForQuery (Adzuna pull + upsert) and record the pull.
 *
 * @returns {Promise<{ jobs: any[], pulled: boolean, reason: string }>}
 */
export async function pullResumeJobFloor({
  query,
  location = '',
  supabaseUrl,
  serviceKey,
  adzunaAppId,
  adzunaAppKey,
}) {
  const q = String(query || '').trim();
  if (!q || !supabaseUrl || !serviceKey || !adzunaAppId || !adzunaAppKey) {
    return { jobs: [], pulled: false, reason: 'noop' };
  }

  // 1) Cooldown — the last pull for this (query, location) already stored everything it found
  //    (fresh ~14 days). Fail-open on a missing table / DB blip (global budget is the backstop).
  if (await wasRecentlyPulled(q, location, supabaseUrl, serviceKey)) {
    return { jobs: [], pulled: false, reason: 'cooldown' };
  }

  // 2) Global aggregation budget — the platform-wide cap shared with search, so a flood of
  //    résumé uploads can never stampede external spend. Out of budget → serve nothing new.
  const budget = await rateLimitGlobal('agg-global');
  if (!budget.allowed) return { jobs: [], pulled: false, reason: 'budget' };

  try {
    const agg = await aggregateForQuery({
      query: q,
      location,
      relatedTerms: [],       // single-term pull — cheapest, one Adzuna call
      supabaseUrl,
      serviceKey,
      adzunaAppId,
      adzunaAppKey,
    });
    // Record only after a real pull ran, so a failure never locks out retries.
    recordPull(q, location, agg.jobs?.length || 0, supabaseUrl, serviceKey);
    return { jobs: Array.isArray(agg.jobs) ? agg.jobs : [], pulled: true, reason: 'aggregated' };
  } catch {
    return { jobs: [], pulled: false, reason: 'error' };
  }
}
