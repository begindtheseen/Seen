// The Weekly Ghost Report — pure, testable assembly of the shareable data story from cached
// company_scores rows. This is the amplifier engine's flagship content unit (see
// playbook/CONTENT_ENGINE.md): one auto-generated data snapshot per week that the owner posts.
//
// HONESTY RULES (load-bearing — the whole thesis dies on one fabricated stat):
// - Percentages and rankings are computed ONLY from rows with real applicant reports
//   (report_count >= minReports). Rows scored on web priors with zero reports are excluded
//   from every ranked list and from avgGhostRate — they contribute no number here.
// - We never invent a "this week" delta we can't compute. The report is an honest CURRENT
//   snapshot of the cumulative record; the "week" label is provenance, not a fabricated trend.
// - pickHeadline() falls back to the honest-small framing while N is low instead of dressing a
//   thin dataset as authoritative.
//
// Input rows are LeaderboardRow-shaped (see lib/growth.ts): { name, industry?, verified?,
//   score: { overall_score, ghost_rate, response_rate, avg_wait_days, report_count, risk_level } }.
//   ghost_rate / response_rate are 0–1 fractions (matching company_scores).
// This module is dependency-free and does no I/O so it can be unit-tested and imported by both
// the server component page and the admin panel data path.

const DEFAULTS = { minReports: 3, topN: 5, thinReports: 10, smallTotal: 25 };
// A ghosting FRAMING (headline or agency spotlight) only fires at/above this reported ghost rate,
// so a company with a 0%/low reported rate is never dressed as a "ghoster" just because it has the
// most reports (the "robert half — 0% ghost rate" headline bug).
const MIN_HEADLINE_GHOST_PCT = 20;

const toPct = (v) => (v == null ? null : Math.round(v * 100));
const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
const titleCase = (s) => String(s || '').replace(/\b\w/g, (c) => c.toUpperCase());

// Monday-anchored week provenance: the "week of …" label + a stable rotation seed. PURE (date in,
// no internal clock read) so it stays unit-testable AND the admin panel, public page, and OG card
// all resolve the SAME week — hence the same rotated headline in a given week.
export function weekProvenance(date) {
  const monday = new Date(date);
  const day = (monday.getUTCDay() + 6) % 7; // 0 = Monday
  monday.setUTCDate(monday.getUTCDate() - day);
  const weekLabel = `week of ${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`;
  const start = Date.UTC(monday.getUTCFullYear(), 0, 1);
  const weekNumber = Math.floor((monday.getTime() - start) / (7 * 24 * 60 * 60 * 1000)) + 1;
  return { weekLabel, weekNumber };
}

// Normalize one input row into the flat shape the report + renderers consume. Returns null when
// the row carries no usable score object.
function normalizeRow(row, agencyNameSet) {
  const s = row && row.score;
  if (!s) return null;
  const name = String(row.name || '').trim();
  if (!name) return null;
  const reportCount = Number(s.report_count) || 0;
  return {
    name,
    industry: row.industry || null,
    reportCount,
    ghostPct: toPct(s.ghost_rate),
    replyPct: toPct(s.response_rate),
    avgWaitDays: s.avg_wait_days == null ? null : Math.round(s.avg_wait_days),
    overallScore: Math.round(Number(s.overall_score) || 0),
    riskLevel: s.risk_level || 'warn',
    isAgency: agencyNameSet.has(name.toLowerCase()),
    thin: reportCount > 0 && reportCount < DEFAULTS.thinReports,
  };
}

/**
 * Assemble the Weekly Ghost Report from cached score rows.
 *
 * @param {Array} rows - LeaderboardRow-shaped cached score rows.
 * @param {Object} [opts]
 * @param {string[]} [opts.agencyNames] - lowercased stored names to flag as staffing agencies.
 * @param {number}   [opts.minReports]  - min applicant reports for a row to be ranked (default 3).
 * @param {number}   [opts.topN]        - list length for offenders / leaders (default 5).
 * @param {number}   [opts.weekNumber]  - ISO-ish week ordinal, for the provenance label (optional).
 * @param {string}   [opts.weekLabel]   - human date label like "week of Jul 4, 2026" (optional).
 * @returns {Object} the structured report — never throws, never fabricates.
 */
export function assembleGhostReport(rows, opts = {}) {
  const minReports = opts.minReports ?? DEFAULTS.minReports;
  const topN = opts.topN ?? DEFAULTS.topN;
  const agencyNameSet = new Set((opts.agencyNames || []).map((n) => String(n).trim().toLowerCase()));

  const all = (Array.isArray(rows) ? rows : [])
    .map((r) => normalizeRow(r, agencyNameSet))
    .filter(Boolean);

  // Only rows with real applicant reports feed any ranking or percentage.
  const reported = all.filter((r) => r.reportCount >= minReports && r.ghostPct != null);

  const worstOffenders = [...reported]
    .sort((a, b) => b.ghostPct - a.ghostPct || b.reportCount - a.reportCount || a.name.localeCompare(b.name))
    .slice(0, topN);

  // Response leaders: highest reply rate, then fastest reported wait as the tiebreak.
  const responseLeaders = [...reported]
    .filter((r) => r.replyPct != null)
    .sort((a, b) => b.replyPct - a.replyPct || (a.avgWaitDays ?? 1e9) - (b.avgWaitDays ?? 1e9) || a.name.localeCompare(b.name))
    .slice(0, topN);

  const agenciesReported = reported.filter((r) => r.isAgency);
  const topAgency = agenciesReported.length
    ? [...agenciesReported].sort((a, b) => b.ghostPct - a.ghostPct || b.reportCount - a.reportCount)[0]
    : null;
  // Spotlight an agency ONLY if it is actually ghosting — a 0%/low-ghost agency with many reports
  // must never be surfaced (or headlined) as "the most-reported ghosting agency".
  const agencySpotlight = topAgency && topAgency.ghostPct >= MIN_HEADLINE_GHOST_PCT ? topAgency : null;

  const companiesTracked = all.filter((r) => r.reportCount > 0).length;
  const agenciesTracked = all.filter((r) => r.isAgency && r.reportCount > 0).length;
  const reportsTotal = all.reduce((n, r) => n + r.reportCount, 0);

  const avgGhostRatePct = reported.length
    ? Math.round(reported.reduce((n, r) => n + r.ghostPct, 0) / reported.length)
    : null;
  const waitSamples = reported.filter((r) => r.avgWaitDays != null);
  const avgWaitDays = waitSamples.length
    ? round1(waitSamples.reduce((n, r) => n + r.avgWaitDays, 0) / waitSamples.length)
    : null;

  const headline = {
    companiesTracked,
    agenciesTracked,
    reportsTotal,
    avgGhostRatePct,
    avgWaitDays,
    reportedCount: reported.length,
    thin: reportsTotal < DEFAULTS.smallTotal,
  };

  return {
    weekNumber: opts.weekNumber ?? null,
    weekLabel: opts.weekLabel ?? null,
    generatedAt: opts.generatedAt ?? null,
    headline,
    worstOffenders,
    responseLeaders,
    agencySpotlight,
    hasReported: reported.length > 0,
  };
}

/**
 * Pick an honest post title for the snapshot, following playbook/CONTENT_ENGINE.md title formulas.
 * Chooses the honest-small framing while N is low so a thin dataset is never dressed as
 * authoritative. Pure and deterministic.
 */
export function pickHeadline(report) {
  const h = report.headline;
  if (!report.hasReported || h.reportsTotal === 0) {
    return "I'm building a public ghost-rate index for applicants. It's just starting — here's the framework, and why I need your report.";
  }
  if (h.thin) {
    return `I'm building a public ghost-rate index. ${h.reportsTotal} report${h.reportsTotal === 1 ? '' : 's'} in. Here's what it shows so far — and why I need yours.`;
  }

  // Weekly rotation: assemble the angles whose data actually QUALIFIES (a ghosting framing needs a
  // real ghost rate — MIN_HEADLINE_GHOST_PCT), then pick one by the week ordinal so each edition is
  // a fresh, postable line instead of the same deterministic sentence forever. Falls back to an
  // honest aggregate line when no single angle qualifies. Never frames a low/0% company as a ghoster.
  const worst = report.worstOffenders[0];
  const agency = report.agencySpotlight;
  const leader = report.responseLeaders[0];
  const angles = [];

  if (worst && worst.ghostPct >= MIN_HEADLINE_GHOST_PCT) {
    angles.push(`${titleCase(worst.name)} ghosted ${worst.ghostPct}% of its ${worst.reportCount.toLocaleString()} reported applicant${worst.reportCount === 1 ? '' : 's'}. This week's ghost report is live.`);
  }
  if (agency && agency.ghostPct >= MIN_HEADLINE_GHOST_PCT) {
    angles.push(`${titleCase(agency.name)} has now been reported for ghosting by ${agency.reportCount.toLocaleString()} applicant${agency.reportCount === 1 ? '' : 's'} (${agency.ghostPct}% ghost rate). Here's the running staffing-agency ghost index.`);
  }
  if (h.avgWaitDays != null) {
    angles.push(`The average reported wait before a company goes silent: ${h.avgWaitDays} days — across ${h.reportsTotal.toLocaleString()} applicant reports from ${h.companiesTracked} companies.`);
  }
  if (h.avgGhostRatePct != null) {
    angles.push(`Across ${h.reportsTotal.toLocaleString()} applicant reports, the average company ghosts ${h.avgGhostRatePct}% of the people it puts through its process. Here's this week's index.`);
  }
  if (leader && leader.replyPct != null) {
    const contrast = h.avgGhostRatePct != null ? `, while the average company ghosts ${h.avgGhostRatePct}%` : '';
    angles.push(`${titleCase(leader.name)} replied to ${leader.replyPct}% of reported applicants${contrast}. Responding is a choice — here's this week's ghost report.`);
  }

  if (!angles.length) {
    return `We tracked which companies actually respond to applicants: ${h.reportsTotal.toLocaleString()} reports across ${h.companiesTracked} companies. Here's the index.`;
  }
  const seed = Number.isInteger(report.weekNumber) ? report.weekNumber : 0;
  return angles[((seed % angles.length) + angles.length) % angles.length];
}

/**
 * Build the full copy-paste caption an owner posts alongside the image: headline + one plain
 * finding + one-sentence methodology + the ask + founder disclosure (the post anatomy from
 * playbook/CONTENT_ENGINE.md). Pure; site URL is injectable for tests.
 */
export function buildCaption(report, site = 'https://seenjobs.io') {
  const h = report.headline;
  const lines = [pickHeadline(report), ''];

  if (report.hasReported && report.worstOffenders.length) {
    const w = report.worstOffenders[0];
    lines.push(
      `Most-reported ghoster right now: ${w.name} — ${w.ghostPct}% of ${w.reportCount} reported applications got no response at all.`,
    );
    if (report.responseLeaders.length) {
      const r = report.responseLeaders[0];
      lines.push(`Actually replies: ${r.name} — ${r.replyPct}% response rate.`);
    }
    lines.push('');
  }

  lines.push('Methodology: applicant-reported outcomes, trust-weighted; companies with no reports show no number — never a fabricated one.');
  lines.push('');
  lines.push(`Been ghosted? Add it to the record — 2 minutes: ${site}/report?outcome=ghosted`);
  lines.push(`Full living index: ${site}/agencies`);
  lines.push('');
  lines.push("— I'm one person keeping these receipts in public. Every report makes the index sharper.");

  return lines.join('\n');
}
