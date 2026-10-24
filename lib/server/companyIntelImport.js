import { createHash } from 'node:crypto';
import { pacificParts } from '../time/pacific.js';
import { trimToSentence } from '../reports/excerptText.js';
import { displayPlatform } from '../reports/platformLabel.js';

const PROFANITY = /\b(fuck(?:ing|er|ed|s)?|shit(?:ty)?|bitch(?:es)?|asshole(?:s)?|damn|crap)\b/gi;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE = /(?:\+?1[ .-]?)?(?:\(?\d{3}\)?[ .-]?)\d{3}[ .-]\d{4}\b/g;
const OUTCOMES = new Set(['ghosted', 'responded', 'autoreject', 'rejected', 'interview', 'hired', 'offer', 'assessment']);

// The cap cuts at a sentence end, else a word boundary — a stored quote never ends mid-word ("…an onsite
// interview. Perhaps", owner screenshot 2026-10-24; lib/reports/excerptText.js).
export function censorExcerpt(value, max = 500) {
  return trimToSentence(String(value || '').replace(EMAIL, '[email removed]').replace(PHONE, '[phone removed]')
    .replace(PROFANITY, m => `${m[0]}${'•'.repeat(Math.max(0, m.length - 1))}`), max);
}

// A Reddit post or comment has one identity whatever link form a collector saw: the OpenCLI collector
// sends /r/Sub/comments/<post>/<title_slug>/[<comment>/], the archive collector /r/Sub/comments/<post>/
// [<comment>/]. Both reached Seen for the same Quantinuum post on 2026-10-20 and became two reports.
// A comment id is base36 with a digit (pc2miz8); a slug is words (interview_prep, help).
const REDDIT_HOST = /(?:^|\.)reddit\.com$/i;
const COMMENT_ID = /^(?=[a-z0-9]*\d)[a-z0-9]{5,9}$/;
export function redditPermalinkKey(value) {
  let u; try { u = new URL(String(value || '')); } catch { return null; }
  if (!REDDIT_HOST.test(u.hostname)) return null;
  const m = /^\/r\/([^/]+)\/comments\/([a-z0-9]+)(?:\/([^/?#]+))?(?:\/([^/?#]+))?/i.exec(u.pathname);
  if (!m) return null;
  const [, sub, post, a, b] = m;
  const comment = b ? b.toLowerCase() : (a && COMMENT_ID.test(a.toLowerCase()) ? a.toLowerCase() : null);
  return { sub, post: post.toLowerCase(), comment, key: comment ? `${post.toLowerCase()}/${comment}` : post.toLowerCase() };
}

export function canonicalSourceUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (!/^https:$/.test(url.protocol)) return '';
    const r = redditPermalinkKey(url.toString());
    if (r) return `https://www.reddit.com/r/${r.sub}/comments/${r.key}/`;
    url.hash = ''; for (const key of [...url.searchParams.keys()]) if (/^(utm_|ref$|source$)/i.test(key)) url.searchParams.delete(key);
    return url.toString();
  } catch { return ''; }
}

export function normalizeIntelItem(raw) {
  const company = String(raw?.company || '').trim().slice(0, 120);
  const sourceUrl = canonicalSourceUrl(raw?.source_url || raw?.sourceUrl);
  const excerpt = censorExcerpt(raw?.excerpt || raw?.text || raw?.report_text);
  const kind = ['applicant_outcome', 'employee_review', 'public_commentary'].includes(raw?.kind) ? raw.kind : 'public_commentary';
  // "Reddit r/r/Quantinuum" (the OpenCLI collector's subreddit already carries "r/") → "Reddit r/Quantinuum".
  const source = displayPlatform(String(raw?.source || new URL(sourceUrl || 'https://unknown.invalid').hostname)).slice(0, 80);
  if (!company || !sourceUrl || excerpt.length < 20) return null;
  const outcome = OUTCOMES.has(String(raw?.outcome || '').toLowerCase()) ? String(raw.outcome).toLowerCase() : null;
  if (kind === 'applicant_outcome' && !outcome) return null;
  const sourceHash = createHash('sha256').update(`${company.toLowerCase()}\n${sourceUrl}\n${excerpt.toLowerCase()}`).digest('hex');
  // The thread a Reddit excerpt came from, so Seen can re-check the account itself (lib/reports/applicantRules.js):
  // the thread title, whether the speaker opened the thread, and whether it is the company's own subreddit.
  const c = raw?.context && typeof raw.context === 'object' ? raw.context : null;
  const context = c ? { title: String(c.title || '').slice(0, 300), is_op: c.is_op === true, company_sub: c.company_sub === true } : null;
  const posted = Date.parse(String(raw?.posted || ''));
  const year = /^\d{4}$/.test(String(raw?.year || '')) ? String(raw.year) : (Number.isFinite(posted) ? String(pacificParts(new Date(posted)).year) : '');
  return { company, source, source_url: sourceUrl, source_hash: sourceHash, excerpt, kind, outcome, role: String(raw?.role || '').trim().slice(0, 200), sentiment: ['positive', 'negative', 'mixed'].includes(raw?.sentiment) ? raw.sentiment : 'mixed', year, context };
}
