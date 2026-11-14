// The job-search filters as ONE rule, used by the browser (lib/hooks/useJobSearch.ts, over the rows a titled
// search returned) and by the server (api/jobs.js area search, BEFORE paging, so the count it reports is
// the count of rows a person can page through). Pure — no imports.

// Industry ("niche") matching. Title + company + description across a real-world keyword set per industry;
// "other" is a true negation (jobs in none of the known industries). Short/ambiguous tokens (a bare "it",
// "tech") are deliberately excluded so description text doesn't false-match everything.
export const NICHE_PATTERNS = {
  tech: /engineer|developer|software|programmer|\bdev\b|devops|\bdata\b|front[- ]?end|back[- ]?end|full[- ]?stack|web dev|cloud|cyber|\bqa\b|machine learning|\bml\b|\bai\b|\bsre\b|architect|sysadmin|database|analytics|technolog/i,
  healthcare: /nurs|\brn\b|\blpn\b|\bcna\b|doctor|physician|health|medical|\bmedic\b|pharmac|clinic|caregiv|care\s?giver|therap|dental|patient|hospital|\baide\b|phlebot|radiolog|surgical|behavioral|assisted living|home care/i,
  retail: /retail|\bstore\b|\bshop\b|cashier|sales assoc|merchandis|stock(er|ing| assoc)?|\bfood\b|restaurant|barista|\bserver\b|waiter|waitress|\bcook\b|kitchen|\bchef\b|\bcrew\b|team member|host(ess)?|bartend|\bdeli\b|grocery|fast[- ]?food|caf[eé]\b|coffee|dishwash|busser|shift (lead|superv|manager)|key\s?holder|hospitality|catering|concession|drive[- ]?thru|cafeteria|dietary|fry cook|line cook/i,
  logistics: /driver|warehouse|logistic|supply chain|\bdelivery\b|courier|forklift|\bloader\b|\bpicker\b|\bpacker\b|shipping|receiving|\bfreight\b|dispatch|fulfillment|distribution|material handler|\bcdl\b|\btruck\b|\broute\b|\bmover\b/i,
  finance: /financ|accounting|accountant|bookkeep|\banalyst\b|banker|\bbank\b|insurance|teller|underwrit|actuar|\baudit|\btax\b|payroll|\bcredit\b|investment|\bloan\b|mortgage|controller|billing/i,
};

/** True if a job belongs to the selected industry. '' = any; 'other' = none of the known industries. */
export function matchesNiche(job, niche) {
  if (!niche) return true;
  const hay = `${job.title || ''} ${job.company || ''} ${job.description || ''} ${job.source || ''}`.toLowerCase();
  if (niche === 'other') return !Object.values(NICHE_PATTERNS).some((re) => re.test(hay));
  const re = NICHE_PATTERNS[niche];
  return re ? re.test(hay) : true;
}

/**
 * Every filter at once. `level` is matched against the row's `level` label ("Entry level", "Senior");
 * `posted` keeps rows added to Seen within that many days (`posted_at` = the row's created_at; a row with
 * no date is never "recent"); `pay` keeps rows that show pay; `training` keeps rows whose posting says it trains beginners
 * (`trains_beginners`, lib/jobs/trainsBeginners.js — a titled search's rows carry it; the area search never sends it).
 * @param {{ title?: string, company?: string, description?: string, source?: string, level?: string, type?: string, posted_at?: string|null, salary?: string|null, trains_beginners?: boolean }} job
 * @param {{ niche?: string, level?: string, jobType?: string, posted?: string, pay?: boolean, training?: boolean }} f
 */
export function matchesFilters(job, f = {}, now = Date.now()) {
  if (f.niche && !matchesNiche(job, f.niche)) return false;
  if (f.level && !String(job.level || '').toLowerCase().includes(f.level)) return false;
  if (f.jobType && job.type !== f.jobType) return false;
  if (f.posted) {
    const days = parseInt(f.posted, 10);
    if (Number.isFinite(days) && days > 0) {
      const t = job.posted_at ? Date.parse(job.posted_at) : NaN;
      if (!Number.isFinite(t) || t < now - days * 86400000) return false;
    }
  }
  if (f.pay && !job.salary) return false;
  if (f.training && job.trains_beginners !== true) return false;
  return true;
}
