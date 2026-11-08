// Is there a posting to optimize against? The ONE check every résumé-vs-job endpoint runs BEFORE
// it charges (api/resume.js tool:optimize + action:tailor, api/optimizer.js action:optimize).
//
// 2026-10-24 recruiter audit (D2): the paid optimizer charged a credit to diff a résumé against a
// 500-character Adzuna teaser that ended in "Em…" — a pay disclaimer with no duty or requirement
// in it. A listing that is only a preview (lib/jobs/descriptionText.isDescriptionPreview: every
// Adzuna row, or a ≤520-char text ending in an ellipsis) is answered 422 `preview_only` and never
// charged; the client shows a paste box and re-submits with the full posting (`postingPasted`).
import { isDescriptionPreview } from '../jobs/descriptionText.js';
import { fetchFullPosting, postingLink, readPostingLink } from './fullPosting.js';
import { unoptimizableListing } from './optimizePackage.js';

export const PREVIEW_ONLY_MESSAGE = 'This listing only has a summary. Paste the full posting to optimize for it.';

/**
 * @param {{ jobDescription?: string, jobSource?: string|null, postingPasted?: boolean }} body
 * @returns {null | { status: 422, body: { error: 'preview_only', message: string } }}
 */
export function previewOnlyError(body = {}) {
  const description = String(body.jobDescription || '').trim();
  // A posting the person pasted is the full text by definition — the listing's source no longer
  // describes it (an Adzuna listing whose posting was pasted is not a teaser any more).
  const source = body.postingPasted ? null : (body.jobSource || null);
  if (!description || isDescriptionPreview({ source, description })) {
    return { status: 422, body: { error: 'preview_only', message: PREVIEW_ONLY_MESSAGE } };
  }
  return null;
}

/**
 * The gate every résumé-vs-job tool runs, with the fetch in front of the paste box: when the posting is only a
 * teaser and the request names the saved job, Seen follows the job's own link (lib/server/fullPosting.js) and,
 * when the posting comes back, puts it on the request and lets the tool run. Only when that fails does the
 * caller get 422 `preview_only` — now with `apply_url`, so the client can say "open the listing, paste it".
 * Mutates `body` on success (jobDescription, postingPasted) so the tool reads the posting as pasted.
 */
export async function previewOnlyOrFetch(body = {}, { env = process.env, fetchFull = fetchFullPosting, readLink = readPostingLink } = {}) {
  // A pasted link is read like a saved job's link (any career site, any board): its posting becomes the paste.
  const link = postingLink(body.jobDescription);
  if (link) {
    let got = null;
    try { got = await readLink(link); } catch { got = null; }
    if (got && got.ok) {
      body.jobDescription = got.description;
      body.postingPasted = true;
      body.jobSource = null;
      body.postingFetched = true;
      body.postingLink = link;
      if (!body.job && !body.jobTitle && got.title) { body.job = got.title; body.jobTitle = got.title; }
      if (!body.company && got.company) body.company = got.company;
      return null;
    }
    const reason = got?.reason || 'unreachable';
    return { status: 422, body: { error: 'preview_only', from_link: true, reason, apply_url: link, message: reason === 'gone' ? 'That link says the job was taken down, so there is no posting left to read.' : 'Seen could not read the posting at that link. Open it, select all of its text, and paste the text instead.' } };
  }
  const err = previewOnlyError(body);
  const jobId = String(body.jobId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  const db = (path, opts = {}) => fetch(`${url}/rest/v1/${path}`, { ...opts, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  if (!err) {
    // A full-length saved posting that still reads as no requirements is often a cut copy (Lever rows were
    // stored as their intro alone until 2026-11-08): read the job's page once more before the tool refuses.
    if (jobId && url && key && !body.postingPasted && postingReadsEmpty(body) && !recentlyRefreshed(jobId)) {
      let got = null;
      try { got = await fetchFull({ jobId, db, refresh: true }); } catch { got = null; }
      if (got && got.ok && got.fetched) {
        body.jobDescription = got.description;
        body.jobSource = null;
        body.postingFetched = true;
      }
    }
    return null;
  }
  if (!jobId || !url || !key) return err;
  let got = null;
  try { got = await fetchFull({ jobId, db }); } catch { got = null; }
  if (got && got.ok) {
    body.jobDescription = got.description;
    body.postingPasted = true;
    body.jobSource = null;
    body.postingFetched = true;
    return null;
  }
  return { status: 422, body: { ...err.body, apply_url: got?.apply_url || null, reason: got?.reason || 'no_job' } };
}

/** Too few requirements read to optimize against — the same rule the tools refuse on. */
export function postingReadsEmpty(body = {}) {
  try {
    return !!unoptimizableListing({ resume: String(body.resume || body.resumeText || ''), jobDescription: String(body.jobDescription || ''), job: body.job || body.jobTitle || '', company: body.company || '' });
  } catch { return false; }
}

// One re-read per job per instance every 6 hours: a posting that truly lists nothing is not fetched on every tap.
const REFRESH_TTL_MS = 6 * 3600 * 1000;
const refreshed = new Map();
function recentlyRefreshed(jobId) {
  const now = Date.now();
  const at = refreshed.get(jobId);
  if (at && now - at < REFRESH_TTL_MS) return true;
  refreshed.set(jobId, now);
  if (refreshed.size > 2000) refreshed.delete(refreshed.keys().next().value);
  return false;
}
