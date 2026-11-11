// Section detection and segmentation.
//
// A section header is recognised by VOCABULARY first ("Professional Experience", "Core Competencies",
// "Licenses & Certifications" …) and STRUCTURE second (short, standalone, ALL CAPS / bold / larger
// than body / decorated / followed by a gap). A line that is only structurally header-like but not
// in the vocabulary becomes a CUSTOM section (e.g. "MILITARY SERVICE") — but only with strong
// typographic evidence, so a shouting company name never splits a work history in two. Inline
// headers ("Skills: Python, SQL") keep their remainder as the section's first content line.

import { HEADER_VOCAB, TITLE_WORD_RE } from './lexicon.js';
import { looksLikeName } from './contact.js';
import { findDateRange } from './dates.js';
import { undecorate } from '../extract/lines.js';
import { recognizeHeading } from './headings.js';
import { looksLikeTitle, looksLikeCompany } from './experience.js';
import { isLocationText, SCHOOL_RE, COMPANY_SUFFIX_RE } from './lexicon.js';
import { contentKind } from './content.js';

const HEADER_MAX_WORDS = 6;

function normHeader(s) {
  return undecorate(s)
    .toLowerCase()
    .replace(/[“”"']/g, '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')   // "Experience (5 years)" → "experience"
    .replace(/\s*[:：]\s*$/, '')
    .replace(/[&+]/g, 'and')
    .replace(/\s+and\s+/g, ' and ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function vocabLookup(norm) {
  if (!norm) return null;
  if (HEADER_VOCAB.has(norm)) return HEADER_VOCAB.get(norm);
  // "and"-variants: the map stores both "x and y" and "x & y" normalized to "x and y" already.
  const alt = norm.replace(/\s+and\s+/g, ' & ');
  if (HEADER_VOCAB.has(alt)) return HEADER_VOCAB.get(alt);
  // Leading "my " / trailing " section" / "s"
  const stripped = norm.replace(/^my\s+/, '').replace(/\s+section$/, '');
  if (HEADER_VOCAB.has(stripped)) return HEADER_VOCAB.get(stripped);
  if (stripped.endsWith('s') && HEADER_VOCAB.has(stripped.slice(0, -1))) return HEADER_VOCAB.get(stripped.slice(0, -1));
  return null;
}

function isAllCaps(text) {
  const letters = text.replace(/[^A-Za-z]/g, '');
  return letters.length >= 3 && letters === letters.toUpperCase();
}

/**
 * Classify a line as a section header.
 * @returns {{ kind: string, title: string, inlineRest: string, custom: boolean } | null}
 */
export function classifyHeader(line, stats, { prevLine = null, nextLine = null, nextLine2 = null, allowCustom = true, currentKind = null } = {}) {
  const raw = line.text.trim();
  if (!raw || line.bullet) return null;
  if (findDateRange(raw)) return null;
  if (/@|https?:\/\/|www\./i.test(raw)) return null;
  const words = raw.split(/\s+/).length;
  const larger = stats.bodySize > 0 && line.size > stats.bodySize * 1.08;
  const structural = isAllCaps(raw) || line.bold || larger || !!line.heading || /^[\s=*_~#•·–—-]{2,}/.test(raw) || line.gapAbove >= 1.6;

  // Inline header: "SKILLS: a, b, c" / "Education – B.S. …". Inside a SKILLS section a "Label:
  // items" line is a skill GROUP ("Languages: English, Tamil" is not a Languages section).
  // a table row "CERTIFICATIONS<TAB>ServSafe …": the first cell is the heading, the rest its first line
  if (line.segments && line.segments.length >= 2 && line.segments[0].split(/\s+/).length <= HEADER_MAX_WORDS) {
    const cell = undecorate(line.segments[0]);
    const k = vocabLookup(normHeader(cell)) || ((h) => (h && !['contact', 'references'].includes(h.kind) ? h.kind : null))(recognizeHeading(cell, { structural: isAllCaps(cell) }));
    if (k && (isAllCaps(cell) || line.bold) && !(currentKind === 'skills' && k === 'skills')) return { kind: k, title: cell, inlineRest: line.segments.slice(1).join(' | '), custom: k === 'custom' };
  }
  const inline = raw.match(/^([A-Za-z&+/ ]{3,40}?)\s*[:：]\s*(.+)$/);
  if (inline) {
    // the token reading only for a standard section, never inside education ("Relevant coursework:
    // Typography…" is a detail of the degree above it) and never for a free-form kind
    const tok = vocabLookup(normHeader(inline[1])) || currentKind === 'education' ? null : recognizeHeading(inline[1], { structural: false });
    const kind = vocabLookup(normHeader(inline[1])) || (tok && !['contact', 'custom', 'references'].includes(tok.kind) ? tok.kind : null);
    if (kind && inline[1].trim().split(/\s+/).length <= HEADER_MAX_WORDS) {
      if (currentKind === 'skills' && (kind === 'skills' || kind === 'languages' || kind === 'publications' || kind === 'custom')) return null;
      return { kind, title: inline[1].trim(), inlineRest: inline[2].trim(), custom: false };
    }
  }

  if (words <= HEADER_MAX_WORDS) {
    const kind = vocabLookup(normHeader(raw));
    if (kind) {
      // A bare vocabulary word that is actually a title ("Lead", "Support") inside a work
      // history needs structure to count as a header; multi-word matches or decorated/caps lines
      // stand on their own.
      const weak = ['work', 'service', 'support', 'training', 'software', 'tools', 'equipment', 'research', 'leadership', 'community', 'other', 'details', 'personal', 'statement', 'introduction'].includes(normHeader(raw));
      if (!weak || structural || line.heading) return { kind, title: undecorate(raw).replace(/[:：]\s*$/, ''), inlineRest: '', custom: false };
    }
  }

  // Token reading: "LICENSES / CERTS", "Licences & Certs", "Nursing Licenses", "Career Break",
  // "Notes", "Additional Info" — every spelling the exact table does not list (headings.js).
  if (words <= HEADER_MAX_WORDS + 2) {
    const nextHasDate = !!(nextLine && findDateRange(nextLine.text));
    const h = recognizeHeading(undecorate(raw), { structural: structural || !!line.heading, nextHasDate });
    if (h && !(currentKind === 'skills' && h.kind === 'skills')) {
      const title = undecorate(raw).replace(/[:：]\s*$/, '');
      return { kind: h.kind, title, inlineRest: '', custom: h.kind === 'custom' };
    }
  }

  // An unknown heading: a short standalone line (blank line above, content below) that is not a job
  // title, an employer, a place or a name ("Tickets and training", "Stuff I've picked up"). It opens a
  // section of its own — its lines are then filed by what they say (content.js) — and is never absorbed
  // as a role's title or employer ("Tickets and training" became an employer, coordinator 2026-11-10).
  const employerLine = currentKind === 'experience' && [nextLine, nextLine2].some((l) => l && findDateRange(l.text));
  // (a CAPITALISED heading may have bullets under it — that is how every custom section is saved, and
  // "AVAILABILITY" became a bullet on the second save; coordinator round 4)
  if (allowCustom && !employerLine && currentKind !== 'summary' && currentKind !== 'references' && line.gapAbove >= 1.6 && nextLine && (!nextLine.bullet || isAllCaps(raw)) && words <= 5 && raw.length <= 40
    && /^[A-Z]/.test(raw) && !/[\d|,;@—–]|\s-\s/.test(raw) && !/[.!?:]$/.test(raw)
    && !looksLikeTitle(raw) && !(isAllCaps(raw) ? COMPANY_SUFFIX_RE.test(raw) : looksLikeCompany(raw)) && !isLocationText(raw)
    && !findDateRange(nextLine.text) && !(looksLikeTitle(nextLine.text) && nextLine.text.split(/\s+/).length <= 6)
    // in a laid-out file a heading also LOOKS like one (bold / larger / capitals); a school or a credential
    // line is content ("College of DuPage" under Education read as a heading in the PDF round trip)
    && (!stats.hasGeometry || line.bold || larger || isAllCaps(raw)) && !SCHOOL_RE.test(raw) && !contentKind(raw)
    && !(currentKind && ['education', 'certifications', 'skills', 'languages'].includes(currentKind) && !isAllCaps(raw) && !line.bold)
    && (isAllCaps(raw) || raw.split(/\s+/).filter((w) => /^[A-Z]/.test(w)).length <= Math.max(1, Math.ceil(words / 2) + (words <= 2 ? 1 : 0)))) {
    return { kind: 'custom', title: undecorate(raw), inlineRest: '', custom: true, candidate: true };
  }

  const exp = qualifiedExperienceHeader(raw, { strong: isAllCaps(raw) || line.bold || larger || !!line.heading || /^[\s=*_~#•·–—-]{2,}/.test(raw), nextLine, currentKind });
  if (exp) return exp;

  // Custom header: strong typographic evidence only, never before the first real section, and
  // never a line that reads like the candidate's name.
  // a bold acronym inside a list section ("BLS" under Certifications) is an item, not a new heading —
  // the PDF render's bold certification names were read back as empty custom sections (2026-11-10)
  const listItem = ['certifications', 'skills', 'languages'].includes(currentKind) && words <= 2 && raw.replace(/[^A-Za-z]/g, '').length <= 8;
  // a bold capitalised EMPLOYER inside a work history ("TARGET" / "Southpark location" / "Guest Advocate
  // Jun 2022 – Present") is the employer of the roles under it, not a new section
  const employerAbove = currentKind === 'experience' && [nextLine, nextLine2].some((l) => l && findDateRange(l.text));
  if (allowCustom && !listItem && !employerAbove && words >= 1 && words <= 4 && !/\d/.test(raw) && isAllCaps(raw) && !looksLikeName(raw) && (line.bold || larger || line.heading || /^[\s=*_~#•·–—-]{2,}/.test(raw))) {
    // Never when it reads like a job title followed by a date line (a shouting role header).
    const nextHasDate = nextLine && findDateRange(nextLine.text);
    if (!TITLE_WORD_RE.test(raw) || !nextHasDate) {
      if (!(nextLine && nextLine.bullet && TITLE_WORD_RE.test(raw))) {
        return { kind: 'custom', title: titleCase(undecorate(raw)), inlineRest: '', custom: true };
      }
    }
  }
  return null;
}

// "RELEVANT AUTOMOTIVE AND EV EXPERIENCE", "Additional Professional Experience", "Other Work History":
// a short heading that ENDS in an experience noun is an experience section whatever qualifies it.
// (The owner's two experience headings were missed and every role was read as a skill, 2026-11-01.)
const EXPERIENCE_TAIL_RE = /(?:^|\s)(?:experience|employment|employment history|work history|career history|job history)$/;
const EXPERIENCE_LEAD_RE = /^(?:experience|employment)\s+(?:in|with|at)\s/;
// headings that name another section along with experience stay with the vocabulary's reading
const OTHER_SECTION_RE = /\b(?:skills?|qualifications?|summary|profile|education|certif\w*|training|projects?|volunteer\w*|awards?|languages?)\b/;
// "Customer Experience" above a date line is a department or role, not a section
const DOMAIN_RE = /^(?:customer|guest|member|patient|user|client|employee|candidate|visitor|shopper|student|brand|digital|product|player|fan)\s/;

function qualifiedExperienceHeader(raw, { strong = false, nextLine = null, currentKind = null } = {}) {
  const text = undecorate(raw).replace(/[:：]\s*$/, '');
  const norm = normHeader(text);
  const words = norm.split(' ').filter(Boolean);
  if (words.length < 2 || words.length > 7 || /\d/.test(norm) || /[.!?]$/.test(text)) return null;
  if (!EXPERIENCE_TAIL_RE.test(norm) && !EXPERIENCE_LEAD_RE.test(norm)) return null;
  if (OTHER_SECTION_RE.test(norm)) return null;
  const nextHasDate = !!(nextLine && findDateRange(nextLine.text));
  if (words.length === 2 && DOMAIN_RE.test(norm) && nextHasDate) return null;
  // Title Case needs context: outside a list section, or right above a role header line.
  const titled = text.split(/\s+/).every((w) => w.length < 4 || /^[A-Z(]/.test(w));
  if (!strong && !(titled && (currentKind !== 'skills' || nextHasDate))) return null;
  return { kind: 'experience', title: text, inlineRest: '', custom: false };
}

const SMALL_WORDS = new Set(['and', 'of', 'the', 'for', 'in', 'at', 'to', 'a', 'an', 'on', 'with', 'or']);
const PLAIN_SHORT = new Set(['my', 'by', 'as', 'is', 'up', 'so', 'no', 'us', 'we']);
const ACRONYM_RE = /^(?:[A-Z]{2}|CNC|POS|EMS|EMT|CAD|ERP|CRM|SQL|AWS|IOT|ATM|CDL|RN|LPN|CNA|HVAC|STEM)$/;
/** A heading as people read it: "RELEVANT AUTOMOTIVE AND EV EXPERIENCE" → "Relevant Automotive and EV
 *  Experience" (short non-small words stay capitals); mixed-case headings are kept as written. */
export function displayHeading(title) {
  const t = undecorate(String(title || '')).replace(/[:：]\s*$/, '').replace(/\s*\((?:cont(?:inued|'d|\.)?)\)\s*$/i, '').replace(/\s+/g, ' ').trim();
  if (!isAllCaps(t)) return t;
  return t.split(' ').map((w, i) => {
    const lw = w.toLowerCase();
    if (i > 0 && SMALL_WORDS.has(lw)) return lw;
    if (ACRONYM_RE.test(w) && !SMALL_WORDS.has(lw) && !PLAIN_SHORT.has(lw)) return w;
    return lw.replace(/(^|[-/])([a-z])/g, (m, p, c) => p + c.toUpperCase());
  }).join(' ');
}
export { normHeader };

function titleCase(s) {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bAnd\b/g, 'and').replace(/\bOf\b/g, 'of').replace(/\bAnd\b/g, 'and');
}

/**
 * Split lines into the pre-header block and an ordered list of sections.
 * @returns {{ header: object[], sections: Array<{ kind, title, lines, column, custom }> }}
 */
export function segmentSections(lines, stats) {
  const header = [];
  const sections = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = classifyHeader(line, stats, { prevLine: lines[i - 1] || null, nextLine: lines[i + 1] || null, nextLine2: lines[i + 2] || null, allowCustom: sections.length > 0, currentKind: cur ? cur.kind : null });
    if (h) {
      cur = { kind: h.kind, title: h.title, lines: [], column: line.column, custom: h.custom, headerLine: line, candidate: !!h.candidate };
      sections.push(cur);
      if (h.inlineRest) cur.lines.push({ ...line, text: h.inlineRest, bullet: false, segments: null, inlineFromHeader: true });
      continue;
    }
    if (cur) cur.lines.push(line);
    else header.push(line);
  }
  return { header, sections };
}
