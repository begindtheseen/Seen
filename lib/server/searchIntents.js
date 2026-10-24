// What a search is ASKING, in the terms Seen can answer from real applicant reports (2026-10-24).
//
// classifyIntent(query) → one of INTENTS. Rules only, no model, ordered so the more specific question wins:
//   other (Seen's own name, "ghost jobs") > is_legit > does_ghost > hiring_process (checks: background check, drug test, onboarding) >
//   how_long_to_hear_back > application_status > interview_process > hiring_process > jobs_at > other.
// Noise words people add ("reddit", "quora", "2026") never change the intent.
//
// matchCompany(query, index) → the company a query names, matched on whole words against the names Seen knows
// (company_scores, the same lowercase names the /company/[slug] pages use), longest name first. A company page
// URL (/company/<slug>) names its company directly (companyFromPageUrl).
//
// Pure: no I/O. Raw queries stay server-side; only intent labels ever reach a public page.

export const INTENTS = ['application_status', 'hiring_process', 'interview_process', 'how_long_to_hear_back', 'is_legit', 'does_ghost', 'jobs_at', 'other'];
/** Intents a company page can answer from its own data (everything but 'other'). */
export const ANSWERABLE_INTENTS = INTENTS.filter((i) => i !== 'other');

const NOISE = /\b(reddit|quora|blind|20\d\d)\b/g;

const RULES = [
  // Navigational searches for Seen itself, and "ghost jobs" (listings with no real opening, a listing question,
  // not a hiring-outcome one): nothing on a company page should be reshaped by these.
  ['other', /\bseen ?jobs\b|\bseenjobs\b|\bghost (?:job|jobs|listing|listings|posting|postings)\b/],
  // "is X legit", "X scam", "X reviews", "X glassdoor", "is X a real company", "X complaints" ("under review" is a
  // status, not a review).
  ['is_legit', /\b(legit|legitimate|scam+(?:s|er|ers|my)?|fake (?:company|recruiter|recruiters|job offer|job offers)|(?<!under |in )reviews?|glassdoor|rating|ratings|complaints?|trustworthy|trusted|reputable|real company|worth (?:it|working))\b/],
  ['does_ghost', /\b(ghost(?:s|ed|ing)?)\b(?!\s*(?:job|jobs|listing|listings|posting|postings))|\b(never|didn'?t|did not|not|no one|haven'?t|have not|never) (?:heard|hear|hearing|got|get|gotten) back\b|\bno (?:response|reply|callback|call back)\b|\bnot (?:responding|hearing)\b/],
  ['hiring_process', /\b(background check|drug (?:test|screen)|onboarding|orientation|offer letter|start date|first day)\b/],
  ['how_long_to_hear_back', /\bhow (?:long|many days|many weeks|soon|quickly)\b|\bhear(?:ing)? back\b|\bcall(?:s|ed)? (?:you )?back\b|\bcallback\b|\bget(?:s|ting)? back to\b|\bresponse time\b|\btime to (?:hear|respond|hire)\b|\b(?:respond|reply)(?:s|ing)? to (?:applicants|applications)\b/],
  ['application_status', /\b(application|app|candidate|applicant) (?:status|portal|under review|in review|received|pending|submitted|tracker|tracking|update|login)\b|\b(?:check|track|view)(?:ing)? (?:on )?(?:my )?(?:[a-z']+ ){0,3}(?:application|app)\b|\bstatus of (?:my )?(?:application|app)\b|\bunder review\b|\bin consideration\b|\bno longer under consideration\b/],
  ['interview_process', /\b(interview(?:s|ed|ing|er)?|phone screen|screening call|assessment|virtual job tryout|hirevue|second round|final round)\b/],
  ['hiring_process', /\b(hiring process|recruiting process|recruitment process|application process|how to get hired|how to get a job|hiring timeline|hiring steps|get hired)\b/],
  ['jobs_at', /\b(jobs?|careers?|hiring|application|applications|openings?|positions?|vacanc(?:y|ies)|now hiring|apply|work (?:at|for)|employment|part time|full time|remote|near me|internships?|seasonal)\b/],
];

/**
 * @param {string} query
 * @returns {typeof INTENTS[number]}
 */
export function classifyIntent(query) {
  const q = ` ${String(query ?? '').toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(NOISE, ' ').replace(/\s+/g, ' ').trim()} `;
  if (!q.trim()) return 'other';
  for (const [intent, re] of RULES) if (re.test(q)) return intent;
  return 'other';
}

// ── Company matching ─────────────────────────────────────────────────────────────────────────────
const SUFFIX = /\s+(inc|llc|corp|corporation|co|ltd|plc|group|holdings|company|companies)$/;
// A "company" called one of these would match every query; never treat it as a name.
const NOT_A_NAME = new Set(['jobs', 'job', 'careers', 'career', 'hiring', 'interview', 'apply', 'work', 'remote', 'seen', 'seen jobs', 'seenjobs',
  'the', 'a', 'an', 'my', 'how', 'does', 'is', 'near me', 'status', 'application', 'reviews', 'legit', 'process']);

/**
 * Lowercase words with apostrophes dropped ("Lowe's" → "lowes", "McDonald's" → "mcdonalds"). With
 * `possessive: true` a possessive 's is dropped instead ("Amazon's" → "amazon"), for the second matching pass.
 */
export function tokens(s, { possessive = false } = {}) {
  let t = String(s ?? '').toLowerCase().replace(/’/g, "'");
  if (possessive) t = t.replace(/'s\b/g, '');
  return t.replace(/['.]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
}

/**
 * Build the matcher from known companies.
 * @param {Array<string | { company_name?: string, company?: string, [k: string]: any }>} companies
 * @returns {{ byKey: Map<string, any>, maxWords: number }}
 */
export function buildCompanyIndex(companies) {
  const byKey = new Map();
  let maxWords = 1;
  for (const c of Array.isArray(companies) ? companies : []) {
    const name = typeof c === 'string' ? c : (c?.company_name ?? c?.company ?? '');
    const entry = typeof c === 'string' ? { company_name: c } : c;
    const base = tokens(name).join(' ');
    if (!base) continue;
    const variants = new Set([base, base.replace(SUFFIX, ''), base.replace(/^the /, ''), base.replace(/^the /, '').replace(SUFFIX, '')]);
    for (const v of variants) {
      if (!v || NOT_A_NAME.has(v) || v.length < 2) continue;
      const prev = byKey.get(v);
      // Two stored names that read the same: keep the one with more evidence behind it.
      if (!prev || (Number(entry.first_party_report_count) || 0) > (Number(prev.first_party_report_count) || 0)) byKey.set(v, entry);
      maxWords = Math.max(maxWords, v.split(' ').length);
    }
  }
  return { byKey, maxWords };
}

/**
 * The known company a query names (longest whole-word match), or null.
 * @param {string} query
 * @param {{ byKey: Map<string, any>, maxWords: number }} index
 */
export function matchCompany(query, index) {
  if (!index?.byKey?.size) return null;
  // Pass 1 keeps "lowe's" as "lowes"; pass 2 reads "amazon's" as "amazon".
  for (const words of [tokens(query), tokens(query, { possessive: true })]) {
    for (let n = Math.min(index.maxWords, words.length); n >= 1; n--) {
      for (let i = 0; i + n <= words.length; i++) {
        const hit = index.byKey.get(words.slice(i, i + n).join(' '));
        if (hit) return hit;
      }
    }
  }
  return null;
}

/** The company name a /company/<slug> URL is for ('coca cola' for /company/coca-cola), or null. */
export function companyFromPageUrl(page) {
  try {
    const m = /^\/company\/([^/?#]+)\/?$/.exec(new URL(String(page)).pathname);
    if (!m) return null;
    const name = decodeURIComponent(m[1]).replace(/-/g, ' ').trim().toLowerCase();
    return name || null;
  } catch { return null; }
}
