// Industry benchmarking for company transparency scores.
//
// WHY THIS EXISTS. An employer who looks themselves up on Seen very often has few or zero
// first-party applicant reports, so the dashboard showed an empty "clean slate" — which reads as
// "you scraped my listings and have nothing real on me." But we DO have a web-researched
// transparency score for ~960 companies AND their industry, so we can ALWAYS answer the question a
// buyer actually cares about: "how does my hiring reputation compare to my industry on Seen?" That
// turns the empty state into a reason to care (and to pay), and it gives every score on the consumer
// side authoritative context ("bottom third of Healthcare for responsiveness") instead of a bare
// number.
//
// SHAPE. The pure computation (computeBenchmark) is separated from the DB fetch
// (fetchIndustryBenchmark) so it is unit-testable with plain fixtures — no network. Everything is
// HONEST: it reports its own scope (this industry vs all employers), its sample size, and withholds a
// ranking when there aren't enough peers to make one meaningful, rather than inventing precision.

export const MIN_INDUSTRY_PEERS = 5; // below this an "industry average" is noise → fall back to all employers
export const MIN_RANK_PEERS = 4;     // below this we don't claim a percentile ranking at all

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const clampRate = (v) => { const n = num(v); return n == null ? null : Math.max(0, Math.min(1, n)); };

function mean(nums) {
  const v = nums.filter((n) => typeof n === 'number' && Number.isFinite(n));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

// Percentile of `value` within `peerValues`, 0..100. `higherIsBetter=false` for metrics where a
// LOWER value is better (ghost rate, wait days). Ties count as half — the standard midpoint rule —
// so a company exactly at the peer median lands at ~50, not 0 or 100. Returns null with no peers.
export function percentile(value, peerValues, higherIsBetter = true) {
  const v = num(value);
  const vals = (peerValues || []).map(num).filter((x) => x != null);
  if (v == null || vals.length === 0) return null;
  const better = vals.filter((x) => (higherIsBetter ? v > x : v < x)).length;
  const tied = vals.filter((x) => x === v).length;
  return Math.round(((better + tied / 2) / vals.length) * 100);
}

// The single headline line. Responsiveness (response rate) is the axis candidates care about most —
// "will I hear back" — so it drives the verdict; overall score is the fallback when response-rate
// peers are too thin to rank. Phrasing avoids the ambiguous "bottom X%" and always states the
// comparison set + whether it stings or affirms.
function buildVerdict({ pctResponse, pctOverall, scope, industryLabel, nPeers }) {
  const where = scope === 'industry' && industryLabel ? industryLabel : 'employers on Seen';
  const p = pctResponse != null ? pctResponse : pctOverall;
  const axis = pctResponse != null ? 'responsiveness' : 'transparency';
  if (p == null || nPeers < MIN_RANK_PEERS) {
    return { tone: 'neutral', headline: `Not enough peers to rank yet`, detail: `Fewer than ${MIN_RANK_PEERS} comparable ${where} have been scored so far — your grade still stands on its own.` };
  }
  if (p >= 75) return { tone: 'good', headline: `Ahead of ${p}% of ${where} on ${axis}`, detail: `Strong candidates screen for this before they apply — you're on the right side of it.` };
  if (p >= 45) return { tone: 'warn', headline: `About average for ${where}`, detail: `Middle of the pack on ${axis}. Pulling ahead of your industry is what gets the strongest applicants to choose you.` };
  return { tone: 'bad', headline: `Behind ${100 - p}% of ${where} on ${axis}`, detail: `Most ${where} respond to applicants more often than you do — the strongest candidates notice, and quietly apply elsewhere.` };
}

// Estimate how much reputation gap is costing in applicant flow, HONESTLY framed as a range, only
// when we can ground it. If the company's response rate trails the peer average, the shortfall
// (peerAvg − company) is the fraction of interested candidates who'd sooner hear back elsewhere;
// expressed per 100 applicants so it reads as a real, checkable number, never a fabricated dollar figure.
function buildCostOfGap({ companyResponse, avgResponse, scope, industryLabel }) {
  const c = clampRate(companyResponse);
  const a = clampRate(avgResponse);
  if (c == null || a == null) return null;
  const gapPts = Math.round((a - c) * 100);
  if (gapPts <= 2) return null; // at or above the peer bar — no honest "cost" to claim
  const where = scope === 'industry' && industryLabel ? `the ${industryLabel} average` : 'the Seen average';
  return {
    gapPoints: gapPts,
    per100: gapPts, // ≈ candidates per 100 who'd hear back at a typical peer but not from you
    headline: `~${gapPts} in every 100 applicants would hear back at ${where} — but not from you`,
  };
}

// company: { ghost_rate, response_rate, avg_wait_days, overall_score }
// peers:   array of the SAME shape (must EXCLUDE the company itself)
// opts:    { scope: 'industry'|'all', industryLabel }
export function computeBenchmark(company, peers, { scope = 'industry', industryLabel = null } = {}) {
  const usable = (peers || []).filter((p) => p && num(p.overall_score) != null);
  const effScope = scope === 'industry' && usable.length >= MIN_INDUSTRY_PEERS ? 'industry' : 'all';

  const average = {
    ghost: mean(usable.map((p) => clampRate(p.ghost_rate))),
    response: mean(usable.map((p) => clampRate(p.response_rate))),
    wait: mean(usable.map((p) => num(p.avg_wait_days))),
    score: mean(usable.map((p) => num(p.overall_score))),
  };

  const co = {
    ghost: clampRate(company?.ghost_rate),
    response: clampRate(company?.response_rate),
    wait: num(company?.avg_wait_days),
    score: num(company?.overall_score),
  };

  const pct = {
    response: percentile(co.response, usable.map((p) => clampRate(p.response_rate)), true),
    ghostAvoidance: percentile(co.ghost, usable.map((p) => clampRate(p.ghost_rate)), false),
    overall: percentile(co.score, usable.map((p) => num(p.overall_score)), true),
  };

  const label = effScope === 'industry' ? industryLabel : null;
  const verdict = buildVerdict({ pctResponse: pct.response, pctOverall: pct.overall, scope: effScope, industryLabel: label, nPeers: usable.length });
  const cost = buildCostOfGap({ companyResponse: co.response, avgResponse: average.response, scope: effScope, industryLabel: label });

  return { scope: effScope, industry: label, nPeers: usable.length, company: co, average, percentile: pct, verdict, cost };
}

// ── DB fetch layer ────────────────────────────────────────────────────────────────────────────
// Self-contained: give it the company name + Supabase creds; it resolves the company row, pulls its
// industry peers (or a global sample when the industry is too thin), and returns computeBenchmark's
// result — or null when the company itself isn't scored yet (nothing to benchmark against).

const SELECT = 'company_name,industry,overall_score,ghost_rate,response_rate,avg_wait_days';
const enc = (s) => encodeURIComponent(String(s || '').trim());

// The `industry` column is inconsistent free-text from the research pipeline: "Healthcare",
// "Healthcare staffing (travel nursing)", "Healthcare Staffing" all coexist. Exact-match would give
// almost every company <5 peers and collapse to the global average. So we bucket by the FIRST word,
// prefix-matched — grouping the whole Healthcare / Retail / Banking / SaaS sector together — which is
// both statistically sturdier and what a buyer means by "my industry." Prefix (`token*`), never
// contains, so a short token like "it" can't match "Insurance".
export function industryToken(industry) {
  const first = String(industry || '').trim().toLowerCase().replace(/[^a-z0-9 ].*/s, '').split(/\s+/)[0] || '';
  return first.length >= 2 ? first : '';
}

// Human-facing label: strip any parenthetical, keep up to the first two words, title-case them, cap
// length. "Healthcare staffing (travel nursing)" → "Healthcare Staffing"; "retail" → "Retail".
export function industryLabelOf(industry) {
  const clean = String(industry || '').replace(/\(.*?\)/g, '').replace(/[/,–—-].*$/s, '').trim();
  const words = clean.split(/\s+/).filter(Boolean).slice(0, 2);
  const label = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return label.length > 28 ? label.slice(0, 28).trim() : label;
}

export async function fetchIndustryBenchmark(companyName, { SUPABASE_URL, SERVICE_KEY, fetchImpl = fetch } = {}) {
  if (!companyName || !SUPABASE_URL || !SERVICE_KEY) return null;
  const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
  const get = async (qs) => {
    try { const r = await fetchImpl(`${SUPABASE_URL}/rest/v1/company_scores?${qs}`, { headers }); return r.ok ? await r.json() : []; }
    catch { return []; }
  };
  const notSelf = (self) => (p) => p && p.company_name && p.company_name.toLowerCase() !== String(self.company_name).toLowerCase();

  const self = (await get(`company_name=ilike.${enc(companyName)}&select=${SELECT}&order=report_count.desc&limit=1`))[0];
  if (!self || num(self.overall_score) == null) return null; // not scored → no honest benchmark

  const token = industryToken(self.industry);
  let scope = 'industry';
  let peers = [];
  let label = null;
  if (token) {
    peers = (await get(`industry=ilike.${enc(token)}*&select=${SELECT}&limit=400`)).filter(notSelf(self));
    label = industryLabelOf(self.industry);
  }
  if (peers.length < MIN_INDUSTRY_PEERS) {
    // Too few sector peers — benchmark against a broad sample of all scored employers instead.
    scope = 'all';
    peers = (await get(`select=${SELECT}&order=report_count.desc&limit=400`)).filter(notSelf(self));
    label = null;
  }

  return computeBenchmark(self, peers, { scope, industryLabel: label });
}
