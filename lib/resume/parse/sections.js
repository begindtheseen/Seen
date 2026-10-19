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
export function classifyHeader(line, stats, { prevLine = null, nextLine = null, allowCustom = true, currentKind = null } = {}) {
  const raw = line.text.trim();
  if (!raw || line.bullet) return null;
  if (findDateRange(raw)) return null;
  if (/@|https?:\/\/|www\./i.test(raw)) return null;
  const words = raw.split(/\s+/).length;
  const larger = stats.bodySize > 0 && line.size > stats.bodySize * 1.08;
  const structural = isAllCaps(raw) || line.bold || larger || !!line.heading || /^[\s=*_~#•·–—-]{2,}/.test(raw) || line.gapAbove >= 1.6;

  // Inline header: "SKILLS: a, b, c" / "Education – B.S. …". Inside a SKILLS section a "Label:
  // items" line is a skill GROUP ("Languages: English, Tamil" is not a Languages section).
  const inline = raw.match(/^([A-Za-z&+ ]{3,40}?)\s*[:：]\s*(.+)$/);
  if (inline) {
    const kind = vocabLookup(normHeader(inline[1]));
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

  // Custom header: strong typographic evidence only, never before the first real section, and
  // never a line that reads like the candidate's name.
  if (allowCustom && words >= 1 && words <= 4 && !/\d/.test(raw) && isAllCaps(raw) && !looksLikeName(raw) && (line.bold || larger || line.heading || /^[\s=*_~#•·–—-]{2,}/.test(raw))) {
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
    const h = classifyHeader(line, stats, { prevLine: lines[i - 1] || null, nextLine: lines[i + 1] || null, allowCustom: sections.length > 0, currentKind: cur ? cur.kind : null });
    if (h) {
      cur = { kind: h.kind, title: h.title, lines: [], column: line.column, custom: h.custom, headerLine: line };
      sections.push(cur);
      if (h.inlineRest) cur.lines.push({ ...line, text: h.inlineRest, bullet: false, segments: null, inlineFromHeader: true });
      continue;
    }
    if (cur) cur.lines.push(line);
    else header.push(line);
  }
  return { header, sections };
}
