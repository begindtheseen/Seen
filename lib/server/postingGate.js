// Is there a posting to optimize against? The ONE check every résumé-vs-job endpoint runs BEFORE
// it charges (api/resume.js tool:optimize + action:tailor, api/optimizer.js action:optimize).
//
// 2026-10-24 recruiter audit (D2): the paid optimizer charged a credit to diff a résumé against a
// 500-character Adzuna teaser that ended in "Em…" — a pay disclaimer with no duty or requirement
// in it. A listing that is only a preview (lib/jobs/descriptionText.isDescriptionPreview: every
// Adzuna row, or a ≤520-char text ending in an ellipsis) is answered 422 `preview_only` and never
// charged; the client shows a paste box and re-submits with the full posting (`postingPasted`).
import { isDescriptionPreview } from '../jobs/descriptionText.js';
import { fetchFullPosting } from './fullPosting.js';
import { buildPostingBasis, basisNote } from './postingBasis.js';

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
export async function previewOnlyOrFetch(body = {}, { env = process.env, fetchFull = fetchFullPosting, buildBasis = buildPostingBasis } = {}) {
  const err = previewOnlyError(body);
  if (!err) return null;
  const jobId = String(body.jobId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return err;
  const db = (path, opts = {}) => fetch(`${url}/rest/v1/${path}`, { ...opts, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  let got = null;
  if (jobId) { try { got = await fetchFull({ jobId, db }); } catch { got = null; } }
  if (got && got.ok) {
    body.jobDescription = got.description;
    body.postingPasted = true;
    body.jobSource = null;
    body.postingFetched = true;
    return null;
  }
  // The full posting is out of reach (every Adzuna page refuses servers): build what to optimize against from what Seen
  // holds — the same job from the employer's board, or the requirements similar full postings state — and say so
  // (lib/server/postingBasis.js). The paste box is offered alongside, never instead.
  const row = got?.row || { id: jobId || null, title: body.job || body.jobTitle || '', company: body.company || '', description: body.jobDescription || '', source: body.jobSource || null };
  let basis = null;
  try { basis = row.title ? await buildBasis({ row, db }) : null; } catch { basis = null; }
  if (basis) {
    body.jobDescription = basis.description;
    body.postingPasted = true;
    body.jobSource = null;
    body.postingBasis = { kind: basis.kind, note: basisNote(basis), core: basis.core || null, count: basis.count || null, added: basis.added, apply_url: got?.apply_url || null };
    return null;
  }
  return { status: 422, body: { ...err.body, apply_url: got?.apply_url || null, reason: got?.reason || 'no_job' } };
}

/** What a response says about the posting it used: null for a posting read or pasted in full. */
export function postingBasisField(body) {
  const b = body && body.postingBasis;
  return b ? { kind: b.kind, note: b.note, core: b.core, count: b.count, apply_url: b.apply_url } : null;
}
