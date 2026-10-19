import { createHash } from 'node:crypto';

const PROFANITY = /\b(fuck(?:ing|er|ed|s)?|shit(?:ty)?|bitch(?:es)?|asshole(?:s)?|damn|crap)\b/gi;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE = /(?:\+?1[ .-]?)?(?:\(?\d{3}\)?[ .-]?)\d{3}[ .-]\d{4}\b/g;
const OUTCOMES = new Set(['ghosted', 'responded', 'autoreject', 'rejected', 'interview', 'hired', 'offer', 'assessment']);

export function censorExcerpt(value, max = 500) {
  return String(value || '').replace(EMAIL, '[email removed]').replace(PHONE, '[phone removed]')
    .replace(PROFANITY, m => `${m[0]}${'•'.repeat(Math.max(0, m.length - 1))}`).replace(/\s+/g, ' ').trim().slice(0, max);
}

export function canonicalSourceUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (!/^https:$/.test(url.protocol)) return '';
    url.hash = ''; for (const key of [...url.searchParams.keys()]) if (/^(utm_|ref$|source$)/i.test(key)) url.searchParams.delete(key);
    return url.toString();
  } catch { return ''; }
}

export function normalizeIntelItem(raw) {
  const company = String(raw?.company || '').trim().slice(0, 120);
  const sourceUrl = canonicalSourceUrl(raw?.source_url || raw?.sourceUrl);
  const excerpt = censorExcerpt(raw?.excerpt || raw?.text || raw?.report_text);
  const kind = ['applicant_outcome', 'employee_review', 'public_commentary'].includes(raw?.kind) ? raw.kind : 'public_commentary';
  const source = String(raw?.source || new URL(sourceUrl || 'https://unknown.invalid').hostname).trim().slice(0, 80);
  if (!company || !sourceUrl || excerpt.length < 20) return null;
  const outcome = OUTCOMES.has(String(raw?.outcome || '').toLowerCase()) ? String(raw.outcome).toLowerCase() : null;
  if (kind === 'applicant_outcome' && !outcome) return null;
  const sourceHash = createHash('sha256').update(`${company.toLowerCase()}\n${sourceUrl}\n${excerpt.toLowerCase()}`).digest('hex');
  return { company, source, source_url: sourceUrl, source_hash: sourceHash, excerpt, kind, outcome, role: String(raw?.role || '').trim().slice(0, 200), sentiment: ['positive', 'negative', 'mixed'].includes(raw?.sentiment) ? raw.sentiment : 'mixed', year: /^\d{4}$/.test(String(raw?.year || '')) ? String(raw.year) : '' };
}
