// The full posting behind a teaser row, fetched once and kept for everyone.
//
// Owner 2026-10-27, from a phone screenshot: "This listing only has a summary. Paste the full posting to
// optimize for it." on a saved Marriott job — "This is far too common." It is: every Adzuna row is a ~500-char
// teaser, and 4 of the 7 saved jobs on the site were one. The person was being asked to go find the posting
// that Seen already had a link to. So before any résumé-vs-job tool says "paste it", Seen follows the row's own
// link through the listing importer (lib/server/listingResolve.js: the page, the ATS's JSON API, then the
// reader rungs the employer import already uses) and, when it comes back with the posting, stores it on the
// row and carries on. The paste box is the fallback, not the first answer.
import { resolveListing } from './listingResolve.js';
import { validateListingUrl } from './listingImport.js';
import { cleanDescription } from './jobSources.js';
import { isDescriptionPreview } from '../jobs/descriptionText.js';

/** Shorter than this is not a posting, whatever the fetch returned. */
export const MIN_FULL_POSTING = 700;

/**
 * @param {{ jobId: string, db: (path: string, opts?: object) => Promise<Response>, resolve?: Function, timeoutMs?: number }} args
 * @returns {Promise<{ ok: true, description: string, source: string|null, fetched: boolean } | { ok: false, reason: string, apply_url: string|null, row?: object }>}
 *   A failure after the row was read carries the row, so the caller can build a basis from it (lib/server/postingBasis.js).
 */
export async function fetchFullPosting({ jobId, db, resolve = resolveListing, timeoutMs = 9000 }) {
  const id = String(jobId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  if (!id) return { ok: false, reason: 'no_job', apply_url: null };
  const r = await db(`jobs?id=eq.${encodeURIComponent(id)}&select=id,title,company,source,description,apply_url&limit=1`).catch(() => null);
  const row = r && r.ok ? (await r.json().catch(() => null))?.[0] : null;
  if (!row) return { ok: false, reason: 'no_row', apply_url: null };
  const stored = String(row.description || '');
  // the row already holds the posting (a board row, or a teaser someone upgraded earlier)
  if (stored.length >= MIN_FULL_POSTING && !isDescriptionPreview(row)) return { ok: true, description: stored, source: row.source || null, fetched: false };
  const applyUrl = row.apply_url || null;
  const v = validateListingUrl(applyUrl || '');
  if (!v.ok) return { ok: false, reason: 'no_url', apply_url: applyUrl, row };
  let fields = null;
  try {
    fields = await Promise.race([
      resolve(v),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs)),
    ]);
  } catch {
    return { ok: false, reason: 'unreachable', apply_url: applyUrl, row };
  }
  // the importer's own cleaning (HTML → text, entity decoding, the ingest cap)
  const text = String(cleanDescription(String(fields?.description || '')) || '').trim();
  if (text.length < MIN_FULL_POSTING || isDescriptionPreview({ source: null, description: text })) return { ok: false, reason: 'thin', apply_url: applyUrl, row };
  // keep it for everyone who opens this row next; the source stays (it is still an Adzuna row — one with its posting)
  await db(`jobs?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ description: text }) }).catch(() => null);
  return { ok: true, description: text, source: row.source || null, fetched: true };
}
