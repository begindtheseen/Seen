// What was read, said once for every tool (T3, 2026-11-10). A pasted link's own title and employer win over the ones
// the page sent: the sheet for one job could otherwise label a different posting with that job's name (screens report
// s-screens-a §3.2). Wraps postingGate.previewOnlyOrFetch; returns its refusal (or null) and `posting`.
import { previewOnlyOrFetch } from './postingGate.js';
import { postingLink } from './fullPosting.js';

export async function readPosting(body, gate = previewOnlyOrFetch) {
  const link = postingLink(body.jobDescription);
  const sent = { job: body.job, jobTitle: body.jobTitle, company: body.company };
  if (link) { body.job = ''; body.jobTitle = ''; body.company = ''; }
  const preview = await gate(body);
  if (link) for (const k of Object.keys(sent)) if (!body[k] && sent[k]) body[k] = sent[k];
  let host = null;
  try { host = link ? new URL(link).hostname.replace(/^www\./, '') : null; } catch { host = null; }
  const source = link && body.postingFetched ? 'link' : body.postingFetched ? 'fetched' : body.postingPasted ? 'pasted' : 'listing';
  return { preview, posting: { title: body.job || body.jobTitle || null, company: body.company || null, source, host } };
}
