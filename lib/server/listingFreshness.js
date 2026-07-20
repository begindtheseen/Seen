// Pure, keyless, deterministic listing-freshness descriptor.
//
// LEGAL FRAMING (deliberate — this is the whole point of the file):
// Every value here is a literally-TRUE statement about OUR OWN observation of a listing —
// when we first recorded it, when our aggregation last saw it in a source's results, whether
// the employer posted it directly, and how many job-seekers reported it closed. It makes NO
// claim about the employer's conduct: never "ghost job", "fake", or "fraud". It is NOT fused
// into the company reputation score (that step is a first-party assertion about a named
// company and waits for counsel). It is transparent evidence, phrased as observation, so a
// seeker can judge staleness themselves. Truth is the defense; we stay strictly inside it.
//
// Pure function of the row + a caller-supplied `nowMs` (tests pass a fixed clock). No keys,
// no I/O, no new deps — same convention as lib/server/jobInsights.js.

const DAY = 86400000;

// Whole days from an ISO timestamp to now. null when the timestamp is missing/unparseable.
// Clamped at 0 so clock skew (a created_at slightly in the future) never reads as negative.
function daysSince(iso, nowMs) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = Math.floor((nowMs - t) / DAY);
  return d < 0 ? 0 : d;
}

// A day-count → human fragment ("today" / "1 day ago" / "N days ago").
function ago(days, verb) {
  if (days === 0) return `${verb} today`;
  return `${verb} ${days} day${days === 1 ? '' : 's'} ago`;
}

// Freshness bucket describes how recently WE observed the listing in results — an honest
// statement about our own data-collection cadence, not a verdict on the employer. Used only
// to tint the factual line; the visible text is always the literal facts.
function bucketFor(daysSinceSeen) {
  if (daysSinceSeen == null) return 'unknown';
  if (daysSinceSeen <= 7) return 'fresh';
  if (daysSinceSeen <= 21) return 'aging';
  return 'stale';
}

/**
 * Build a factual freshness descriptor for a jobs row.
 * @param {object} row  a jobs row (created_at, last_seen_at, last_checked_at,
 *                       availability_report_count, is_employer_posted).
 * @param {number} nowMs  epoch ms "now" (injectable for deterministic tests).
 * @returns {{daysListed:number|null, daysSinceSeen:number|null, reportCount:number,
 *            isEmployerPosted:boolean, freshness:string, label:string}}
 */
export function computeListingFreshness(row = {}, nowMs = Date.now()) {
  const daysListed = daysSince(row.created_at, nowMs);
  // For aggregated rows, last_seen_at (else last_checked_at) is when a source feed last
  // surfaced it. For employer-posted rows this isn't meaningful, so we don't use it below.
  const daysSinceSeen = daysSince(row.last_seen_at || row.last_checked_at, nowMs);

  const rawCount = row.availability_report_count;
  const reportCount = Number.isFinite(rawCount)
    ? rawCount
    : (Number.parseInt(rawCount, 10) || 0);

  const isEmployerPosted = row.is_employer_posted === true;

  // Facts — each true, each an observation of OUR data, phrased so it never accuses.
  const facts = [];
  if (isEmployerPosted) {
    // First-party posting: the reassuring, accurate framing is provenance + age.
    facts.push(daysListed == null
      ? 'Posted directly by the employer'
      : ago(daysListed, 'Posted directly by the employer'));
  } else {
    if (daysListed != null) facts.push(ago(daysListed, 'Listed'));
    if (daysSinceSeen != null) facts.push(ago(daysSinceSeen, 'last seen in results'));
  }
  // Seeker reports are attributed to the seekers who filed them — never our conclusion.
  if (reportCount > 0) {
    facts.push(`${reportCount} job-seeker${reportCount === 1 ? '' : 's'} reported it closed`);
  }

  return {
    daysListed,
    daysSinceSeen,
    reportCount,
    isEmployerPosted,
    freshness: isEmployerPosted ? 'employer' : bucketFor(daysSinceSeen),
    // A single factual sentence, safe to render verbatim. '' when we have no facts to state.
    label: facts.length ? facts.join(' · ') : '',
  };
}
