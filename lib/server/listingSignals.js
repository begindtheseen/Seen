// "Listing signals" — a company-level rating built ONLY from the company's own open job posts on Seen.
// Owner decision 2026-10-20: every company with listings gets one, labelled separately; the applicant
// grade (company_scores, report-backed) stays report-only and is never touched by this.
//
// Same principle as lib/server/jobScore.js (owner directive 2026-07-03): no number without a stated
// reason. The score IS the weighted sum of its factors, each computed from fields the posts carry:
//   pay      30% — share of posts that state pay (an Adzuna salary ESTIMATE is not stored as pay:
//                  lib/server/jobSources.js adzunaPay);
//   quality  30% — the posts' average transparency score (jobScore.js, 18–95) rescaled to 0–1;
//   direct   25% — share you apply to with the employer itself (its ATS board, its career site, posted
//                  on Seen by the employer) rather than through an aggregator redirect;
//   fresh    15% — share NOT still open after 30 days on Seen (a post re-seen for a month+ is a common
//                  ghost-job / evergreen sign; Seen sweeps posts that disappear, so age here means open).
// Fewer than MIN_LISTINGS posts → no rating (too little to say). Tests: lib/server/listingSignals.test.mjs.

import { SCORE_RANGE } from './jobScore.js';

export const MIN_LISTINGS = 3;
export const WEIGHTS = { pay: 0.30, quality: 0.30, direct: 0.25, fresh: 0.15 };
const DAY = 86_400_000;
const LONG_OPEN_DAYS = 30;
const DIRECT_TYPES = new Set(['EMPLOYER_DIRECT', 'ATS_DIRECT', 'EMPLOYER_SITE']);
const ATS_SOURCE = /greenhouse|lever|ashby|workday|smartrecruiters|workable|recruitee|rippling|bamboo|career site|company site/i;

export const hasPay = (r) => (Number(r?.salary_min) > 0) || /\$\s?\d|\d+\s?k\b|per hour|\/hr|an hour/i.test(String(r?.salary || ''));
export const isDirect = (r) => DIRECT_TYPES.has(String(r?.source_type || '').toUpperCase()) || !!r?.ats_provider || r?.is_employer_posted === true || ATS_SOURCE.test(String(r?.source || ''));
const pct = (x) => Math.round(x * 100);

export function listingSignals(rows, { now = Date.now() } = {}) {
  const list = (Array.isArray(rows) ? rows : []).filter(Boolean);
  const n = list.length;
  if (n < MIN_LISTINGS) return { rated: false, listings: n, reason: n ? `only ${n} open job post${n === 1 ? '' : 's'} — a rating needs ${MIN_LISTINGS}` : 'no open job posts on Seen', ...(n ? { facts: { open: n } } : {}) };
  const pay = list.filter(hasPay).length / n;
  const scores = list.map((r) => Number(r.score)).filter(Number.isFinite);
  const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const quality = avgScore == null ? null : Math.min(1, Math.max(0, (avgScore - SCORE_RANGE.min) / (SCORE_RANGE.max - SCORE_RANGE.min)));
  const direct = list.filter(isDirect).length / n;
  const dated = list.map((r) => Date.parse(r.created_at)).filter(Number.isFinite);
  const longOpen = dated.length ? dated.filter((t) => now - t > LONG_OPEN_DAYS * DAY).length / dated.length : null;
  const fresh = longOpen == null ? null : 1 - longOpen;

  // Missing parts drop out and the remaining weights are rescaled, never guessed.
  const parts = { pay, quality, direct, fresh };
  const used = Object.entries(parts).filter(([, v]) => v != null);
  const wsum = used.reduce((a, [k]) => a + WEIGHTS[k], 0);
  const score = Math.round(100 * used.reduce((a, [k, v]) => a + WEIGHTS[k] * v, 0) / wsum);
  const payCount = list.filter(hasPay).length; const directCount = list.filter(isDirect).length;
  const factors = [
    { key: 'pay', label: 'Pay shown', value: pct(pay), weight: WEIGHTS.pay, detail: `${payCount} of ${n} posts state pay` },
    quality == null ? null : { key: 'quality', label: 'Posting quality', value: pct(quality), weight: WEIGHTS.quality, detail: `average transparency score ${Math.round(avgScore)} (posts score ${SCORE_RANGE.min}–${SCORE_RANGE.max})` },
    { key: 'direct', label: 'Apply with the employer', value: pct(direct), weight: WEIGHTS.direct, detail: `${directCount} of ${n} go straight to the employer’s own board or site` },
    // The value is the share of posts that are FRESH, so the label names fresh posts: "Not open for
    // months · 100%" over "0 of 99 have been open 30+ days" read as inverted (audit 2026-10-23).
    fresh == null ? null : { key: 'fresh', label: 'Fresh postings', value: pct(fresh), weight: WEIGHTS.fresh, detail: `${dated.length - Math.round(longOpen * dated.length)} of ${dated.length} were added to Seen in the last ${LONG_OPEN_DAYS} days` },
  ].filter(Boolean);
  const band = score >= 70 ? 'clear' : score >= 50 ? 'mixed' : 'thin';
  // The four facts the company page shows first (open posts, pay shown, apply direct, open 30+ days), each a
  // plain share of the posts — the same numbers as the factors above, named the way a reader asks them.
  const facts = { open: n, payPct: pct(pay), directPct: pct(direct), longOpenPct: longOpen == null ? null : pct(longOpen), datedPosts: dated.length };
  return {
    rated: true, listings: n, score, band, facts,
    label: { clear: 'Clear postings', mixed: 'Mixed postings', thin: 'Thin postings' }[band],
    factors,
    basis: `From ${n.toLocaleString('en-US')} open job post${n === 1 ? '' : 's'} on Seen — the posts themselves, not applicant reports. It is not the company’s grade.`,
  };
}

// ── The company page's own read (server-rendered answers, app/company/[slug]/companyData.ts) ──────────
// The SAME rows and the same employer-name rule as the listing_signals action in api/jobs.js
// (handleListingSignals / companyNameKey / companyIlike — that file is not edited from here, so the two
// helpers below mirror it: legal suffixes dropped, hyphens and spaces alike, "Amazon Flex" ≠ "Amazon").
// Request-path rules: ONE ilike pattern, no description column, keyset pages over id, at most 3,000 posts.
export const listingNameKey = (n) => String(n || '').toLowerCase().trim().replace(/[\s,]+(inc\.?|llc\.?|corp\.?|ltd\.?|co\.|plc\.?)\.?$/i, '').replace(/[\s-]+/g, ' ').trim();
const listingIlike = (name) => encodeURIComponent(`*${String(name).toLowerCase().trim().replace(/[\s-]+/g, '*')}*`);
export const LISTING_SELECT = 'id,company,salary,source,source_type,ats_provider,is_employer_posted,score,created_at';
const LISTING_PAGE = 1000;
const LISTING_MAX_PAGES = 3;

/**
 * Every open post of ONE company (≤3,000), filtered to the exact employer key. Throws on a failed read so a
 * caller can tell "no posts" from "could not read".
 * @param {{ url: string, key: string, company: string, fetchImpl?: Function, timeoutMs?: number, now?: number }} o
 * @returns {Promise<Array<object>>}
 */
export async function readCompanyListingRows({ url, key, company, fetchImpl = fetch, timeoutMs = 6000, now = Date.now() }) {
  const name = String(company || '').trim();
  if (!url || !key || !name) throw new Error('listing read: missing input');
  const want = listingNameKey(name);
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const at = encodeURIComponent(new Date(now).toISOString());
  const out = [];
  let last = null;
  for (let page = 0; page < LISTING_MAX_PAGES; page++) {
    const r = await fetchImpl(
      `${url}/rest/v1/jobs?company=ilike.${listingIlike(name)}&expires_at=gt.${at}&availability_status=eq.active&select=${LISTING_SELECT}&order=id.asc&limit=${LISTING_PAGE}${last ? `&id=gt.${encodeURIComponent(last)}` : ''}`,
      { headers, cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) },
    );
    if (!r.ok) throw new Error(`listing read ${r.status}`);
    const batch = await r.json();
    if (!Array.isArray(batch)) throw new Error('listing read: not an array');
    for (const j of batch) if (listingNameKey(j.company) === want) out.push(j);
    if (batch.length < LISTING_PAGE) break;
    last = String(batch[batch.length - 1].id);
  }
  return out;
}
