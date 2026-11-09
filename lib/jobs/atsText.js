// The whole posting from an ATS API answer — never just its first field.
//
// 2026-11-08 corpus run (scripts/optimizer-corpus.mjs over 324 live postings): 35 of 40 Lever rows were
// refused by the résumé optimizer as "no requirements". Lever's Postings API keeps a posting in four
// parts — `description` (the intro), `lists` (one per section: "Responsibilities", "Required Skills and
// Qualifications"…, each an HTML <li> run), `additional` (benefits, pay, EEO) — and ingest stored
// `descriptionPlain`, the intro alone. Every Lever row on the site was the company blurb with the job cut
// off. SmartRecruiters' sections were joined with a space, so headings ran into the sentence before them.
// These helpers return HTML with the section headings kept, so cleanDescription (jobSources.js) turns it
// into text with one block per section and one line per bullet — what the optimizer's section reader needs.

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const isHtml = (s) => /<\s*(?:p|div|br|li|ul|ol|h[1-6]|strong|b|span)\b/i.test(String(s || ''));
const asBlock = (s) => (isHtml(s) ? String(s) : `<p>${esc(s).replace(/\n+/g, '<br>')}</p>`);

/**
 * Lever posting (api.lever.co/v0/postings/<tenant>[/<id>]) → one HTML document: intro, every list with
 * its heading, then the closing section.
 * @param {{ description?: string, descriptionPlain?: string, lists?: Array<{ text?: string, content?: string }>, additional?: string, additionalPlain?: string }} j
 */
export function leverPostingHtml(j = {}) {
  const parts = [];
  const intro = j.description || j.descriptionPlain || '';
  if (intro) parts.push(asBlock(intro));
  for (const l of Array.isArray(j.lists) ? j.lists : []) {
    const body = String(l?.content || '').trim();
    if (!body) continue;
    const items = /<\s*li\b/i.test(body) ? body : body.split(/\n+/).map((x) => `<li>${esc(x)}</li>`).join('');
    parts.push(`${l.text ? `<h3>${esc(l.text)}</h3>` : ''}<ul>${items}</ul>`);
  }
  const extra = j.additional || j.additionalPlain || '';
  if (extra) parts.push(asBlock(extra));
  return parts.join('\n');
}

/**
 * SmartRecruiters jobAd.sections → HTML, each section under its own title.
 * @param {Record<string, { title?: string, text?: string }>} sections
 * @param {string[]} keys which sections, in order
 */
export function smartRecruitersHtml(sections = {}, keys = ['jobDescription', 'qualifications', 'additionalInformation']) {
  return keys
    .map((k) => sections?.[k])
    .filter((s) => s && String(s.text || '').trim())
    .map((s) => `${s.title ? `<h3>${esc(s.title)}</h3>` : ''}${asBlock(s.text)}`)
    .join('\n');
}
