// Is there a posting to optimize against? The ONE check every résumé-vs-job endpoint runs BEFORE
// it charges (api/resume.js tool:optimize + action:tailor, api/optimizer.js action:optimize).
//
// 2026-10-24 recruiter audit (D2): the paid optimizer charged a credit to diff a résumé against a
// 500-character Adzuna teaser that ended in "Em…" — a pay disclaimer with no duty or requirement
// in it. A listing that is only a preview (lib/jobs/descriptionText.isDescriptionPreview: every
// Adzuna row, or a ≤520-char text ending in an ellipsis) is answered 422 `preview_only` and never
// charged; the client shows a paste box and re-submits with the full posting (`postingPasted`).
import { isDescriptionPreview } from '../jobs/descriptionText.js';

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
