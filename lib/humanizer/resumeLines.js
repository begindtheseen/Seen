// Reads a whole résumé (as plain text) into the units a humanizer may and may not rewrite.
//
// 2026-10-25 (Dev's Pro run): HumanProof treated every LINE of a pasted résumé as a bullet. It
// appended a period to the name, the contact line, every heading ("SUMMARY.") and the date line,
// re-capitalized "linkedin.com", and split each wrapped bullet at the PDF's line break, so
// "…; cut\nreconciliation breaks 92%." became two "bullets" ("…; cut." / "Reconciliation…").
//
// A résumé has structure; only two kinds of unit are prose a humanizer may rewrite:
//   • an experience/project bullet (with the lines it wrapped onto), and
//   • the summary paragraph.
// Everything else — the name and contact lines, section headings, role/date lines, skills,
// education and certifications — is returned verbatim, line for line.

const SECTION_WORDS = [
  ['summary', /^(professional\s+|career\s+)?(summary|objective|profile|about(\s+me)?)$/i],
  ['experience', /^((work|professional|relevant|additional|employment)\s+)?(experience|employment|work history|history)$/i],
  ['projects', /^(selected\s+|personal\s+|key\s+)?projects$/i],
  ['skills', /^((technical|core|key)\s+)?(skills|competencies|proficiencies|technologies|tools)(\s*(&|and)\s*\w+)?$/i],
  ['education', /^education(\s*(&|and)\s*\w+)?$/i],
  ['certifications', /^(certifications?|licenses?(\s*(&|and)\s*certifications?)?|certificates?)$/i],
  ['other', /^(awards?|honors?|volunteer(ing)?(\s+experience)?|languages?|interests|activities|leadership|publications|references)$/i],
];

const BULLET_RE = /^(\s*)([•\-*▪‣◦●]|\d+[.)])\s+/;
const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const DATE_RE = new RegExp(`\\b${MONTH}\\s*\\d{4}\\b|\\b(?:19|20)\\d{2}\\s*[–—-]\\s*(?:(?:19|20)\\d{2}|present|current|now)\\b|\\b\\d{1,2}\\/(?:19|20)\\d{2}\\b|[–—-]\\s*(?:present|current)\\b`, 'i');
const CONTACT_RE = /[\w.+-]+@[\w-]+\.[\w.-]+|\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}\b|\blinkedin\.com\b|\bgithub\.com\b|https?:\/\//i;

/** The section a heading line opens, or null when the line is not a heading. */
export function headingKind(line) {
  const t = String(line || '').trim().replace(/[:\s]+$/, '');
  if (!t || t.length > 48) return null;
  for (const [kind, re] of SECTION_WORDS) if (re.test(t)) return kind;
  // An all-caps short line with no sentence punctuation is a heading of an unknown section.
  if (/^[A-Z][A-Z &/+-]{2,}$/.test(t) && !/[.!?]$/.test(t)) return 'other';
  return null;
}

/**
 * Units in order. Each: { kind, section, lines: string[], prefix, body }.
 *   kind: 'blank' | 'heading' | 'header' (name/contact) | 'role' | 'bullet' | 'prose' | 'line'
 *   body: the unit's text with its wrapped lines joined (bullets and prose only).
 * Only 'bullet' units outside skills/education/certifications and 'prose' units in the summary
 * are rewritable (`rewritable(unit)`).
 */
export function segmentResume(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const units = [];
  let section = null;
  let sawHeading = false;
  let open = null; // the bullet/prose unit wrapped lines may join
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) { units.push({ kind: 'blank', section, lines: [raw] }); open = null; continue; }
    const hk = headingKind(t);
    if (hk) { section = hk; sawHeading = true; units.push({ kind: 'heading', section, lines: [raw] }); open = null; continue; }
    if (!sawHeading) { units.push({ kind: 'header', section, lines: [raw] }); open = null; continue; }
    const bm = raw.match(BULLET_RE);
    if (bm) {
      open = { kind: 'bullet', section, lines: [raw], prefix: raw.slice(0, bm[0].length), body: raw.slice(bm[0].length).trim() };
      units.push(open);
      continue;
    }
    const looksRole = DATE_RE.test(t) || /^(present|current)$/i.test(t);
    const continues = open && !looksRole && !CONTACT_RE.test(t)
      && (!/[.!?]$/.test(open.body) || /^[a-z(]/.test(t));
    if (continues) { open.lines.push(raw); open.body = `${open.body} ${t}`; continue; }
    if (looksRole) { units.push({ kind: 'role', section, lines: [raw] }); open = null; continue; }
    if (section === 'summary') {
      open = { kind: 'prose', section, lines: [raw], prefix: raw.match(/^\s*/)[0], body: t };
      units.push(open);
      continue;
    }
    // A line in experience that is neither a bullet nor a date line is a role/company line.
    units.push({ kind: section === 'experience' || section === 'projects' ? 'role' : 'line', section, lines: [raw] });
    open = null;
  }
  return { units, structured: sawHeading };
}

const FROZEN_SECTIONS = new Set(['skills', 'education', 'certifications']);

/** True when a humanizer may rewrite this unit. */
export function rewritable(unit) {
  if (!unit) return false;
  if (unit.kind === 'prose') return unit.section === 'summary';
  if (unit.kind === 'bullet') return !FROZEN_SECTIONS.has(unit.section);
  return false;
}
