// Node-side helpers of the career-site collector (scripts/collect-career-site.mjs): where to start when
// no page is given, keyword matching, the one identity a job has (no duplicates across pages, keywords
// and passes), and "the list already says this job is abroad". Tests: lib/server/careerNavigate.test.mjs.
import { locationScope } from '../jobs/usLocation.js';

const slugOf = (name) => String(name || '').toLowerCase().replace(/&/g, ' and ')
  .replace(/\b(?:incorporated|inc|llc|corp|corporation|co|company|ltd|plc|holdings?|group|the)\b\.?/g, ' ')
  .replace(/[^a-z0-9]+/g, '');

/** Pages to try, most likely first: the page given; else the usual career addresses. */
export function careerStartCandidates({ company, url, website }) {
  if (url) return [url];
  const out = [];
  const add = (u) => { if (!out.includes(u)) out.push(u); };
  let host = null;
  if (website) { try { host = new URL(/^https?:/i.test(website) ? website : `https://${website}`).hostname.replace(/^www\./, ''); } catch { /* ignore */ } }
  const d = slugOf(company);
  for (const h of [host, d ? `${d}.com` : null].filter(Boolean)) {
    add(`https://www.${h}/careers`); add(`https://careers.${h}/`); add(`https://jobs.${h}/`); add(`https://www.${h}/jobs`); add(`https://www.${h}/`);
  }
  return out;
}

/** "software engineer, Technician; sales" → ['software engineer', 'technician', 'sales']. */
export function keywordTerms(raw) {
  return [...new Set(String(raw || '').split(/[,;\n|]+/).map((s) => s.replace(/\s+/g, ' ').trim().toLowerCase()).filter((s) => s.length >= 2))].slice(0, 10);
}
/** A title matches a term when every word of the term is in it ("sr. software engineer" ← "software engineer"). */
export function titleMatches(title, terms) {
  if (!terms.length) return true;
  const t = ` ${String(title || '').toLowerCase().replace(/[^a-z0-9+#]+/g, ' ')} `;
  return terms.some((term) => term.split(' ').every((w) => t.includes(` ${w.replace(/[^a-z0-9+#]+/g, '')}`)));
}

const TRACKING = /^(?:utm_|src$|source$|ref$|gh_src$|lever-|trk|from$|cid$|codes?$|mode$|jobpipeline$)/i;
/** One identity per job: its link without tracking/fragment parts (else its id). */
export function jobIdentity(posting, pageUrl, id = null) {
  const raw = (posting && typeof posting.url === 'string' && /^https?:/i.test(posting.url) ? posting.url : null) || pageUrl;
  if (raw) {
    try {
      const u = new URL(raw); u.hash = ''; u.hostname = u.hostname.toLowerCase();
      for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
      u.pathname = u.pathname.replace(/\/+$/, '') || '/';
      return `url:${u.toString()}`;
    } catch { /* fall through */ }
  }
  const pid = posting && (typeof posting.identifier === 'object' ? posting.identifier?.value : posting.identifier);
  return `id:${String(id || pid || '').toLowerCase()}`;
}

/** True only when the list's location is clearly outside the US (unknown/remote stays in). */
export function outsideUs(location) {
  const loc = String(location || '').trim();
  if (!loc) return false;
  return loc.split(/;|\|/).every((part) => locationScope(part.trim()) === 'non_us');
}
