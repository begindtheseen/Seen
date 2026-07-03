// Canonical listing scorer — the SINGLE source of truth for a job's transparency score
// and wasted-time (ghost) risk. Both the ingest paths (cron refresh + on-demand search
// top-up in lib/server/jobSources.js, location browse in api/jobs.js) and the DB read
// paths (api/jobs.js response mappers) route through here so the number can never drift.
//
// DESIGN PRINCIPLE (owner directive 2026-07-03): "If we score something it must be for a
// reason or no score." Every point below is earned from a signal that is PRESENT IN THE
// LISTING ITSELF — the posting's source, whether a salary is disclosed, the length and
// language of the job description, red-flag titles. It is a grade of the POSTING's
// transparency, NOT a reputation score for a company we may have zero data on. That is why
// it can honestly apply to every listing: the evidence is the listing. A company's actual
// track record is a SEPARATE, report-backed grade (company_scores) that only exists when
// real applicants have reported on it — and shows "no data" when they haven't.
//
// LEGAL DEFENSIBILITY (owner directive 2026-07-03): every score must be explainable — no
// number without a documented reason. The factor list IS the computation: scoreFactors()
// returns each signal that fired, its point delta, and a plain-English reason, and its
// deltas SUM to the raw score. scoreJob() is just scoreFactors().score. Because the number
// is literally the sum of its stated reasons, a company data export can place every listing
// next to the exact logic that produced its score, and the two can never disagree.

// ── Factor tables ─────────────────────────────────────────────────────────────────────
// Each rule is data: a test over the listing + the points + the human-readable reason it
// contributes. Kept as a table so the score and its explanation are generated together.

const SCORE_BASELINE = 50;
const SCORE_MIN = 18;
const SCORE_MAX = 95;

// Exported so the company data export / legal PDF can document the exact bounds without
// re-hardcoding them.
export const SCORE_RANGE = { min: SCORE_MIN, max: SCORE_MAX, baseline: SCORE_BASELINE };

const KNOWN_GOOD = ['stripe','linear','figma','notion','vercel','anthropic','openai',
  'databricks','retool','ramp','brex','plaid','airtable','coda','loom','pitch',
  'segment','miro','intercom','hubspot','twilio','datadog'];
const KNOWN_BAD  = ['amazon','accenture','cognizant','infosys','wipro','tata consultancy',
  'hcl tech','capgemini','tech mahindra','unison','staffmark','manpower','randstad',
  'robert half','kelly services'];

// Normalize a listing (DB row or freshly-built object) into the fields the rules read.
function fields(job) {
  const salaryMin = typeof job.salary_min === 'number' ? job.salary_min : Number(job.salary_min) || 0;
  return {
    src: (job.source || '').toLowerCase(),
    co: (job.company || '').toLowerCase(),
    title: (job.title || '').toLowerCase(),
    desc: job.description || '',
    salary: job.salary || '',
    salaryMin,
    type: job.type || '',
  };
}

// Returns { score, raw, clamped, factors:[{signal, points, reason}] }. The factors' points
// (including the baseline) sum to `raw`; `score` is `raw` clamped to [18,95] and rounded.
export function scoreFactors(job) {
  const f = fields(job);
  const factors = [{ signal: 'baseline', points: SCORE_BASELINE, reason: 'Neutral starting score — a listing earns points up or down only from signals it actually carries.' }];
  const add = (points, signal, reason) => { if (points) factors.push({ signal, points, reason }); };

  // ── ATS source quality (biggest single signal) ────────────────────────────
  if (/greenhouse|lever|workday|ashby|rippling|bamboo/.test(f.src)) add(18, 'ats_direct', `Posted through a first-party applicant tracking system (${job.source}) — applications reach the employer directly.`);
  else if (/linkedin/.test(f.src)) add(8, 'ats_linkedin', 'Sourced from LinkedIn — a named, verifiable posting surface.');
  else if (/indeed|glassdoor|ziprecruiter/.test(f.src)) add(4, 'ats_aggregator', `Sourced from a major job aggregator (${job.source}).`);
  // Adzuna/unknown = 0 bonus — neutral, no factor recorded.

  // ── Salary transparency ───────────────────────────────────────────────────
  if (f.salary || f.salaryMin > 0) add(12, 'salary_disclosed', 'Compensation is disclosed in the listing — a strong transparency signal.');
  if (f.salaryMin > 120000) add(6, 'salary_high', 'Disclosed base above $120k indicates a serious, funded role.');

  // ── Description quality ───────────────────────────────────────────────────
  if (f.desc.length > 1200) add(8, 'desc_detailed', 'Long, detailed job description (>1200 chars).');
  else if (f.desc.length > 500) add(4, 'desc_moderate', 'Reasonably detailed job description (>500 chars).');
  else if (f.desc.length < 120) add(-8, 'desc_thin', 'Suspiciously thin description (<120 chars) — little for an applicant to evaluate.');

  // Description green flags
  if (/\$\d+|\bsalary\b|\bcompensation\b|\bota\b|\bbase pay\b/i.test(f.desc)) add(5, 'desc_pay_language', 'Description names pay/compensation explicitly.');
  if (/interview process|hiring process|rounds?:|technical screen/i.test(f.desc)) add(6, 'desc_process', 'Description explains the interview/hiring process.');
  if (/\bremote\b|\bhybrid\b|\bwork from home\b/i.test(f.desc)) add(3, 'desc_work_mode', 'Description states the work mode (remote/hybrid).');
  if (/401k|equity|pto|parental leave/i.test(f.desc)) add(4, 'desc_benefits', 'Description lists concrete benefits (401k / equity / PTO / leave).');

  // Description red flags
  if (/staffing agency|on behalf of our client|recruiting firm/i.test(f.desc)) add(-10, 'flag_staffing', 'Listing is posted by a staffing/recruiting intermediary, not the employer.');
  if (/must be a team player|fast[- ]paced|wear many hats|self[- ]starter/i.test(f.desc)) add(-4, 'flag_filler', 'Relies on vague filler phrases ("wear many hats", "fast-paced") instead of specifics.');
  if (/unpaid|volunteer|commission only|1099 only/i.test(f.desc)) add(-20, 'flag_unpaid', 'Describes unpaid, volunteer, or commission-only / 1099-only terms.');
  if (/\$10.{0,5}hour|\$12.{0,5}hour|\$15.{0,5}hour/i.test(f.desc)) add(-8, 'flag_low_wage', 'Advertises a wage at/near poverty level.');

  // ── Company reputation (small nudge, layered on the listing signals above) ─
  if (KNOWN_GOOD.some(g => f.co.includes(g))) add(15, 'reputation_good', 'Employer is on our list of companies with consistently transparent hiring.');
  if (KNOWN_BAD.some(g => f.co.includes(g))) add(-14, 'reputation_bad', 'Employer/agency is on our list associated with high-volume or opaque hiring.');

  // ── Title red flags ───────────────────────────────────────────────────────
  if (/\b(rockstar|ninja|guru|wizard|superhero|unicorn)\b/i.test(f.title)) add(-6, 'title_hype', 'Title uses hype words ("rockstar", "ninja") in place of a real role.');
  if (/commission|insurance agent|real estate agent|door.to.door/i.test(f.title)) add(-12, 'title_commission', 'Title indicates a commission / door-to-door sales role.');

  // ── Job type penalty ──────────────────────────────────────────────────────
  if (/contract|temp|freelance|gig/i.test(f.type)) add(-6, 'type_contingent', `Contingent engagement (${job.type}) rather than a permanent role.`);

  const raw = factors.reduce((sum, x) => sum + x.points, 0);
  const score = Math.min(SCORE_MAX, Math.max(SCORE_MIN, Math.round(raw)));
  return { score, raw, clamped: score !== raw, factors };
}

const WASTE_BASELINE = 20;
const WASTE_MIN = 5;
const WASTE_MAX = 90;

export const WASTE_RANGE = { min: WASTE_MIN, max: WASTE_MAX, baseline: WASTE_BASELINE };

// Returns { score, raw, clamped, factors } for wasted-time / ghost risk. Same contract:
// the factor deltas (incl. baseline) sum to `raw`; `score` is clamped to [5,90].
export function wasteFactors(job) {
  const f = fields(job);
  const factors = [{ signal: 'baseline', points: WASTE_BASELINE, reason: 'Neutral baseline ghost-risk before listing-specific signals.' }];
  const add = (points, signal, reason) => { if (points) factors.push({ signal, points, reason }); };

  if (/amazon|accenture|cognizant|infosys|wipro|tata|hcl/.test(f.co)) add(35, 'waste_high_volume_employer', 'Employer/agency is associated with very high-volume hiring where applicants are frequently ghosted.');
  if (/staffing agency|on behalf of our client/.test(f.desc)) add(20, 'waste_staffing', 'Posted by a staffing intermediary — reduces the odds of a direct response.');
  if (/unpaid|volunteer|commission only/.test(f.desc)) add(40, 'waste_unpaid', 'Unpaid / commission-only terms correlate with high applicant drop-off and non-response.');
  if (/greenhouse|lever|workday|ashby/.test(f.src)) add(-10, 'waste_direct_ats', 'Direct first-party ATS — applications are more likely to be seen and answered.');
  if (f.salary || f.salaryMin > 0) add(-8, 'waste_salary_disclosed', 'Disclosed compensation correlates with a more serious, responsive employer.');

  const raw = factors.reduce((sum, x) => sum + x.points, 0);
  const score = Math.min(WASTE_MAX, Math.max(WASTE_MIN, Math.round(raw)));
  return { score, raw, clamped: score !== raw, factors };
}

// Score a listing purely from signals carried in the posting. 18–95, neutral baseline 50.
export function scoreJob(job) { return scoreFactors(job).score; }

// Wasted-time / ghost risk for a listing, from the same listing-carried signals. 5–90.
export function wasteScore(job) { return wasteFactors(job).score; }

// Read-time resolver: prefer the real score already stored on the row; if a row somehow
// carries no stored score (legacy/partial data), DERIVE one from its listing signals here
// rather than fabricating a constant. Both branches are earned from real evidence — never a
// magic default. Returns { score, waste_score } as finite numbers.
export function scoreRow(job) {
  const rawScore = Number(job.score);
  const score = Number.isFinite(rawScore) && rawScore > 0 ? Math.round(rawScore) : scoreJob(job);

  const rawWasteVal = job.waste_score ?? job.waste;
  const rawWaste = Number(rawWasteVal);
  const waste_score = (rawWasteVal !== null && rawWasteVal !== undefined && Number.isFinite(rawWaste) && rawWaste > 0)
    ? Math.round(rawWaste)
    : wasteScore(job);

  return { score, waste_score };
}

// One-shot explanation for a listing, for the legal/company data export. Recomputes the
// score AND its factor breakdown from the listing's own current signals so the two always
// agree. `stored_score`/`stored_waste_score` are carried through for reference so a reader
// can see whether the persisted number matches the live recomputation.
export function explainListingScore(job) {
  const s = scoreFactors(job);
  const w = wasteFactors(job);
  return {
    transparency_score: s.score,
    transparency_raw: s.raw,
    transparency_clamped: s.clamped,
    score_factors: s.factors,
    waste_score: w.score,
    waste_raw: w.raw,
    waste_clamped: w.clamped,
    waste_factors: w.factors,
    stored_score: Number.isFinite(Number(job.score)) ? Number(job.score) : null,
    stored_waste_score: Number.isFinite(Number(job.waste_score)) ? Number(job.waste_score) : null,
  };
}
