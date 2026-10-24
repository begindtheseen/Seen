// ONE spelling for a Reddit platform / source label: "Reddit r/<subreddit>".
//
// The first OpenCLI collector's subreddit already carried "r/", so its labels were written as
// "Reddit r/r/walmart" (audit 2026-10-23 saw it on the company page; prod 2026-10-24: 0 `reports`
// rows, but 200+ `company_scores.web_reviews` quotes still carry it). Every writer builds the label
// through redditPlatform(); every renderer passes a STORED string through displayPlatform(), so an old
// row reads correctly without a data migration. Pure, dependency-free — shared by api/*.js, lib/ and
// the client bundle (lib/companyDisplay.ts re-exports displayPlatform).

const DOUBLED_PREFIX = /^reddit\s*(?:\/?r\/\s*)+/i;

/** "walmart" | "r/walmart" | "/r/walmart" → "Reddit r/walmart"; an empty subreddit → "Reddit". */
export function redditPlatform(subreddit) {
  const s = String(subreddit ?? '').trim().replace(/^(?:\/?r\/\s*)+/i, '').trim();
  return s ? `Reddit r/${s}` : 'Reddit';
}

/** A stored platform / source label as it is shown: "Reddit r/r/walmart" → "Reddit r/walmart". Anything else unchanged. */
export function displayPlatform(platform) {
  const p = String(platform ?? '').trim();
  if (!DOUBLED_PREFIX.test(p)) return p;
  return redditPlatform(p.replace(DOUBLED_PREFIX, ''));
}

/** "Reddit r/Albertsons" (or the doubled form) → "Albertsons"; null for any other platform. */
export function redditSubredditOf(platform) {
  const m = /reddit\s*(?:\/?r\/\s*)+([a-z0-9_]+)/i.exec(String(platform ?? ''));
  return m ? m[1] : null;
}
