// Where a tracker card's "View listing" goes (owner request 2026-10-18).
//
// A listing posted on Seen has no outside link: its page IS seenjobs.io/jobs/<id>. Those open
// inside the app (same tab, client navigation). The id is the jobs row's uuid, so an application
// that only stored the id (no job_url) still links back to its listing. Outside links (Adzuna,
// company career pages) keep opening in a new tab.
//
// Pure, no I/O — shared by the tracker page and its test.

import { httpHref } from './safeHref.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEEN_HOST = /^(?:www\.)?seenjobs\.io$/i;

/** Path of a Seen listing page from a seenjobs.io URL or a /jobs/<id> path, else null. */
function seenListingPath(url) {
  const raw = String(url || '').trim();
  if (!raw) return null;
  let path;
  if (raw.startsWith('/')) path = raw;
  else {
    try {
      const u = new URL(raw);
      if (!SEEN_HOST.test(u.hostname)) return null;
      path = u.pathname;
    } catch { return null; }
  }
  const m = path.match(/^\/jobs\/([^/?#]+)\/?$/);
  return m ? `/jobs/${m[1]}` : null;
}

/**
 * @param {{ jobUrl?: string|null, jobId?: string|null }} app
 * @returns {{ href: string, internal: boolean } | null}
 */
export function listingHref(app) {
  if (!app) return null;
  const seenPath = seenListingPath(app.jobUrl);
  if (seenPath) return { href: seenPath, internal: true };
  const outside = httpHref(app.jobUrl);
  if (outside) return { href: outside, internal: false };
  // No usable link stored, but the listing's id is a jobs row: its Seen page is the listing.
  const id = String(app.jobId || '').trim();
  if (UUID.test(id)) return { href: `/jobs/${id}`, internal: true };
  return null;
}
