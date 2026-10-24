// The same vacancy from two sources: keep the one with the full posting.
//
// Adzuna's search API returns a ~500-char teaser of a posting, never its text; when Seen also holds
// the posting from the employer's own board (Greenhouse, Lever, Ashby …) under the same company and
// title, the teaser is a worse copy of a row already on the page. Prod 2026-10-24: 10,675 active
// Adzuna rows, 269 with such a twin — small, so this is a post-filter over the rows a request already
// holds (no extra read), applied where results are shaped (api/jobs.js serve(), company_jobs).

import { isDescriptionPreview } from './descriptionText.js';

const key = (j) => `${String(j?.company || '').toLowerCase().trim()}|${String(j?.title || '').toLowerCase().trim()}`;

/**
 * Drop preview rows (Adzuna teasers) whose company + title also appears as a non-preview row in the
 * same list. Order and every other row are unchanged.
 * @template T
 * @param {T[]} rows
 * @returns {T[]}
 */
export function preferFullText(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const full = new Set();
  for (const j of list) if (j && !isDescriptionPreview(j)) full.add(key(j));
  if (!full.size) return list;
  return list.filter((j) => !(j && isDescriptionPreview(j) && full.has(key(j))));
}
