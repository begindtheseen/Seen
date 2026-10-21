// The Reddit-archive source for the applicant-report run loop (lib/reports/collectorRun.js), shared by the
// Mac collector (scripts/collect-archive-reports.mjs) and the always-on cloud cron (api/cron-archive-reports.js)
// so both send Seen the exact same items.
import { harvestCompany } from './archiveHarvest.js';
import { createArcticFetcher } from '../../scripts/credit/lib/arcticShift.mjs';
import { censorExcerpt } from '../server/companyIntelImport.js';
import { outcomeSentiment } from './applicantRules.js';

export function redditArchiveSource({ years = 5, fetcher = createArcticFetcher({ log: () => {} }) } = {}) {
  return {
    id: 'reddit', label: 'Reddit',
    harvest: (company, o) => harvestCompany(company, { fetcher, years, ...o }),
    toItem: (company, a) => ({ company, source: `Reddit r/${a.subreddit}`, source_url: a.url, excerpt: censorExcerpt(a.excerpt),
      kind: 'applicant_outcome', outcome: a.outcome, sentiment: outcomeSentiment(a.outcome), posted: a.created,
      context: { title: a.title, is_op: a.isOp, company_sub: a.inCompanySub } }),
    preview: (a) => `r/${a.subreddit}${a.isOp ? ' OP' : ''}`,
  };
}
