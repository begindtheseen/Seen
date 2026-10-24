// Company names that are really ATS board slugs — and how to recover something readable.
//
// Prod, 2026-10-24 (read-only SQL): 4,705 of 4,736 `company_sources` rows are named by their tenant
// slug (Common Crawl discovery registers a board before anyone knows the employer's name), and
// 62,219 of 81,918 active job rows carry that slug as `company` — "plscareers", "aloyoga",
// "karllagerfeld", "jpmorganchase" on cards, in the drawer, on /jobs/[id] and on company pages
// (live audits 2026-10-23). Two fixes share this module:
//   • at INGEST, `pickCompanyName` prefers the name the board's own feed states (Greenhouse board
//     metadata, Workable `name`, Recruitee `company_name`, SmartRecruiters `company.name`) over a
//     registered name that is just the slug;
//   • at DISPLAY, `splitSlugWords` turns a slug that has no better name into readable words
//     ("tactilemedical" → "tactile medical", "plscareers" → "pls") for lib/companyDisplay.ts to case.
// Nothing here guesses a brand: unknown letters stay together ("karllagerfeld" → "karllagerfeld",
// then Title Case upstream — never the raw lowercase slug in a user-facing string).

// Board noise that is not part of the employer's name. Stripped from the END of a slug, repeatedly
// ("morganmorganjobsapplynow" → "morganmorgan").
const BOARD_NOISE = ['applynow', 'careers', 'career', 'hiring', 'recruiting', 'recruitment', 'talent', 'joinus', 'jobs', 'job', 'apply', 'corporation', 'incorporated', 'limited', 'company', 'inc', 'llc', 'ltd', 'corp', 'plc', 'llp', 'hq'];

// Generic corporate-category words a slug can be segmented on. Deliberately ≥5 letters (plus a few
// safe 4-letter ones) so a real one-word brand never splits: "data" would turn databricks into
// "Data Bricks", "cart" instacart into "Insta Cart". A word earns its place by being a category
// noun that ends or joins a company name, not by appearing inside brands.
const VOCAB = new Set([
  'industries', 'industry', 'medical', 'health', 'healthcare', 'financial', 'finance', 'services', 'service',
  'solutions', 'systems', 'software', 'technologies', 'technology', 'group', 'holdings', 'partners', 'capital',
  'energy', 'foods', 'motors', 'fitness', 'federal', 'construction', 'engineering', 'environmental',
  'veterinary', 'emergency', 'practice', 'wound', 'skilled', 'wellness', 'dental', 'pharmacy', 'pharma',
  'therapeutics', 'clinic', 'clinics', 'hospital', 'hospitals', 'university', 'college', 'school', 'schools',
  'academy', 'church', 'foundation', 'hotels', 'hotel', 'resorts', 'restaurants', 'restaurant', 'airlines',
  'aerospace', 'automotive', 'electric', 'wireless', 'cannabis', 'brands', 'apparel', 'cosmetics', 'beauty',
  'coffee', 'kitchen', 'market', 'markets', 'stores', 'retail', 'supply', 'trucking', 'freight', 'logistics',
  'consulting', 'staffing', 'agency', 'agents', 'legal', 'management', 'properties', 'property', 'homes', 'house',
  'builders', 'buyers', 'america', 'american', 'national', 'international', 'global', 'digital', 'media',
  'networks', 'network', 'security', 'insurance', 'mortgage', 'realty', 'robotics', 'studios', 'gaming',
  'analytics', 'ventures', 'advisors', 'connections', 'warehouse', 'distribution', 'manufacturing', 'packaging',
  'plumbing', 'roofing', 'landscaping', 'cleaning', 'communications', 'entertainment', 'publishing',
  'learning', 'education', 'nursing', 'living', 'senior', 'surgery', 'surgical', 'physicians', 'radiology',
  'orthopedics', 'behavioral', 'rehabilitation', 'therapy', 'diagnostics', 'imaging', 'laboratories',
  'yoga', 'bank', 'labs', 'care', 'chase', 'space',
]);
// Joiners count only BETWEEN two vocabulary words ("engineering and environmental", "buyers of
// america") — never at the start of an unknown run, or "anduril" would read "and uril".
const JOINERS = new Set(['and', 'of', 'the']);
const MAX_WORD = 16;

/** A stored company name that is just a board slug: lowercase letters/digits, no spaces, ≥ 7 chars ("aloyoga"). */
export function looksLikeSlug(name) {
  const s = String(name ?? '').trim();
  return s.length >= 7 && /^[a-z0-9]+$/.test(s) && /[a-z]/.test(s);
}

function stripNoise(slug) {
  let s = slug;
  let changed = true;
  while (changed) {
    changed = false;
    for (const w of BOARD_NOISE) {
      if (s.length > w.length + 2 && s.endsWith(w)) { s = s.slice(0, -w.length); changed = true; break; }
    }
  }
  return s;
}

// Segment a slug into vocabulary words + unknown runs. Dynamic programme over (position, last
// segment was vocab): a vocabulary word costs 0, an unknown run costs its length + 4 (so fewer,
// longer unknown runs win: "anduril" + "industries" beats "and" + "uril" + "industries"), a joiner
// is free only after a vocabulary word and before one.
function segment(s) {
  const n = s.length;
  const INF = 1e9;
  // best[i][k]: cheapest segmentation of s[0..i) whose last segment is vocab (k=1) or unknown (k=0);
  // 2 = last segment was a joiner that still needs a vocab word after it.
  const best = Array.from({ length: n + 1 }, () => [INF, INF, INF]);
  const back = Array.from({ length: n + 1 }, () => [null, null, null]);
  best[0][1] = 0; // "start" behaves like a vocab boundary so a slug may begin with a vocab word
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      const cost = best[i][k];
      if (cost >= INF) continue;
      for (let j = i + 1; j <= Math.min(n, i + MAX_WORD); j++) {
        const w = s.slice(i, j);
        if (VOCAB.has(w)) {
          if (cost < best[j][1]) { best[j][1] = cost; back[j][1] = [i, k, 'v']; }
        } else if (JOINERS.has(w) && k === 1 && i > 0) {
          if (cost < best[j][2]) { best[j][2] = cost; back[j][2] = [i, k, 'j']; }
        }
        if (k !== 2) {
          // Unknown run (never directly after a joiner; a joiner must be followed by a vocab word).
          const c = cost + (j - i) + 4;
          if (c < best[j][0]) { best[j][0] = c; back[j][0] = [i, k, 'u']; }
        }
      }
    }
  }
  let k = best[n][0] <= best[n][1] ? 0 : 1;
  if (best[n][k] >= INF) return [s];
  const words = [];
  let i = n;
  while (i > 0) {
    const [pi, pk] = back[i][k];
    words.unshift(s.slice(pi, i));
    i = pi; k = pk;
  }
  return words;
}

/**
 * Readable words for a slug-shaped company name, lowercase, board noise removed:
 * "tactilemedical" → ["tactile", "medical"], "plscareers" → ["pls"], "jpmorganchase" →
 * ["jpmorgan", "chase"], "karllagerfeld" → ["karllagerfeld"]. A name that is not slug-shaped is
 * returned as its own single word.
 */
export function splitSlugWords(name) {
  const raw = String(name ?? '').trim();
  if (!looksLikeSlug(raw)) return raw ? [raw] : [];
  const core = stripNoise(raw) || raw;
  return segment(core).filter(Boolean);
}

const normKey = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Is the registered company name nothing more than the board's tenant slug? Only the raw lowercase
 * slug counts: "Target" for tenant `target` (a seed, a person) is a name someone chose and stays.
 */
export function isTenantName(registered, tenant) {
  const reg = String(registered ?? '').trim();
  if (!reg) return true;
  return reg === reg.toLowerCase() && normKey(reg) === normKey(tenant);
}

/**
 * The company name to store on a board's rows: the registered name when a person (or a verified
 * probe) gave one; otherwise the name the board's own feed states; otherwise the tenant slug.
 * A feed name is used only when it is a real name: non-empty after trimming, not the slug itself,
 * and not a job title shaped string (the caller already filters those via buildJob).
 */
export function pickCompanyName({ registered, feed, tenant }) {
  const reg = String(registered ?? '').trim();
  if (reg && !isTenantName(reg, tenant)) return reg;
  const f = String(feed ?? '').replace(/\s+/g, ' ').trim();
  if (f && f.length <= 120 && !isTenantName(f, tenant)) return f;
  return reg || String(tenant ?? '').trim();
}
