// The ONE run loop every applicant-report collector shares (scripts/collect-archive-reports.mjs — Reddit
// archive + Hacker News; scripts/collect-web-reports.mjs — Google in the owner's Chrome). Per company it
// runs each source in order with ONE goal of NEW reports, streams accounts to Seen in batches, and keeps
// the per-company and run summary that Seen Command reads. Sources only find accounts; this file decides
// when to send, when to stop, and what the run reports.
//
// The goal counts reports Seen newly ACCEPTS (imported_reports), not accounts found, because a re-run
// re-finds accounts Seen already holds: the buffer is sent as soon as it could complete the goal, so Seen
// answers before a source decides whether to keep reading. A dry run sends nothing and counts accounts found.
//
// source = { id, label, harvest(company, { goal, deadlineAt, onAccounts, log }) → { found, stoppedBy,
//   searches, failedSearches, searchErrors, threadsRead|itemsRead|pagesRead, companySubs? },
//   toItem(company, account) → an /api/ingest-local-company-intel item, preview?(account) → string }
// Tests: lib/reports/collectorRun.test.mjs.

const BATCH = 50;

export async function runCollection({
  targets, goal = 10, minutes = 20, runDeadline = Infinity, dryRun = false, postItems, sources,
  log = (m) => console.log(m), warn = (m) => console.warn(m), now = () => Date.now(), meta = {},
}) {
  const totals = { found: 0, imported_reports: 0, published_reports: 0, downgraded: 0, duplicates: 0, rejected: 0 };
  const reasons = []; const companies = []; const notReached = [];
  let ingestDown = null;

  for (const company of targets) {
    if (ingestDown || now() >= runDeadline) { notReached.push(company); continue; }
    const deadlineAt = Math.min(runDeadline, now() + minutes * 60_000);
    const row = { company, found: 0, new_reports: null, sent: 0, imported: 0, published: 0, duplicates: 0, downgraded: 0, rejected: 0,
      threads_read: 0, searches: 0, failed_searches: 0, search_errors: [], company_subs: [], stopped_by: null, outcomes: {}, by_source: {} };
    let buffer = [];
    const counted = () => (dryRun ? row.found : row.imported);
    const flush = async (all = false) => {
      const before = row.imported;
      while (!dryRun && !ingestDown && (buffer.length >= BATCH || (buffer.length && (all || (goal > 0 && row.imported + buffer.length >= goal))))) {
        const batch = buffer.splice(0, BATCH);
        try {
          const b = await postItems(batch);
          row.sent += batch.length;
          row.imported += Number(b.imported_reports) || 0; row.published += Number(b.published_reports) || 0;
          row.duplicates += Number(b.duplicates) || 0; row.downgraded += Number(b.downgraded) || 0; row.rejected += Number(b.rejected) || 0;
          for (const e of b.errors || []) if (reasons.length < 10 && !reasons.includes(String(e))) reasons.push(String(e).slice(0, 160));
        } catch (e) { ingestDown = String(e.message || e).slice(0, 200); warn(`[skip] sending stopped: ${ingestDown}`); }
      }
      return row.imported - before;
    };
    const stops = [];
    for (const src of sources) {
      if (ingestDown) break;
      if (goal > 0 && counted() >= goal) break;
      if (now() >= deadlineAt) { stops.push('time'); break; }
      const stat = row.by_source[src.id] = { found: 0, new_reports: dryRun ? null : 0, stopped_by: null };
      const beforeImported = row.imported;
      try {
        const r = await src.harvest(company, {
          goal: goal > 0 ? goal - counted() : 0, deadlineAt, log: (m) => log(`[harvest]${m}`),
          onAccounts: async (accounts) => {
            row.found += accounts.length; stat.found += accounts.length;
            for (const a of accounts) {
              row.outcomes[a.outcome] = (row.outcomes[a.outcome] || 0) + 1;
              buffer.push(src.toItem(company, a));
              if (dryRun) log(`   [${a.outcome}] ${src.preview ? src.preview(a) : src.label} | ${String(a.excerpt).slice(0, 160)}`);
            }
            const added = await flush();
            if (ingestDown) throw new Error(`sending stopped: ${ingestDown}`);
            return dryRun ? undefined : added;
          },
        });
        await flush(true);
        stat.stopped_by = r.stoppedBy || null;
        if (!dryRun) stat.new_reports = row.imported - beforeImported;
        row.searches += Number(r.searches) || 0; row.failed_searches += Number(r.failedSearches) || 0;
        row.threads_read += Number(r.threadsRead ?? r.itemsRead ?? r.pagesRead) || 0;
        for (const e of r.searchErrors || []) if (row.search_errors.length < 3 && !row.search_errors.includes(e)) row.search_errors.push(`${src.label}: ${e}`.slice(0, 220));
        if (Array.isArray(r.companySubs)) row.company_subs.push(...r.companySubs);
        stops.push(r.stoppedBy || 'exhausted');
      } catch (e) {
        await flush(true).catch(() => {});
        const msg = String(e.message || e).split('\n')[0].slice(0, 200);
        stat.stopped_by = 'error'; stat.error = msg;
        if (!row.error) row.error = `${src.label}: ${msg}`;
        warn(`[skip] ${company} (${src.label}): ${msg}`);
        stops.push('error');
      }
    }
    row.new_reports = dryRun ? null : row.imported;
    // A source-specific stop (google_blocked: Google asked for a CAPTCHA) is named as it is.
    const special = stops.find((x) => !['goal', 'time', 'exhausted', 'error', 'unsearchable_name'].includes(x));
    row.stopped_by = goal > 0 && counted() >= goal ? 'goal'
      : special ? special
      : stops.includes('time') || now() >= deadlineAt ? 'time'
        : stops.length && stops.every((s) => s === 'error') ? 'error'
          : stops.length && stops.every((s) => s === 'unsearchable_name') ? 'unsearchable_name' : 'exhausted';
    log(`[company] ${company}: ${row.found} first-hand accounts (${row.stopped_by})${dryRun ? '' : ` · ${row.imported} new reports (${row.published} published), ${row.duplicates} already in Seen, ${row.downgraded} kept as commentary`}`);
    totals.found += row.found; totals.imported_reports += row.imported; totals.published_reports += row.published;
    totals.duplicates += row.duplicates; totals.downgraded += row.downgraded; totals.rejected += row.rejected;
    companies.push(row);
  }
  return { ok: !ingestDown, dry_run: dryRun, goal, ...meta, sources: sources.map((s) => s.id), targets: targets.length, ...totals, ingest_error: ingestDown,
    stopped_early: ingestDown ? 'ingest_error' : notReached.length ? 'time' : null, not_reached: notReached, rejection_reasons: reasons, companies };
}
