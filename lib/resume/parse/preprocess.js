// Pre-parse normalization of rich lines: drop page noise, compute typography stats, and merge
// hard-wrapped continuation lines back into their logical line.
//
// Why wrapped-line merging matters: a PDF stores a bullet as 2–3 physical lines. Without merging,
// "Reduced medication documentation errors on the unit by 30% through a barcode" and "double-check
// habit." become two bullets — the second a fragment — and every downstream count (bullets, metrics,
// length) is wrong. The signals that a physical line is a continuation are structural, not textual:
// it sits in the same column, within ~1.4 line-heights, at the same or deeper indent (hanging
// indents push continuations right), carries no bullet glyph, keeps the same font size/weight, and
// the line above it ran (almost) the full width of its column — a line only wraps when it is full.

import { findDateRange } from './dates.js';
import { PAGE_NOISE_RE, DEGREE_RE, EMAIL_RE, URL_RE, PHONE_RE } from './lexicon.js';
import { median } from '../extract/lines.js';
import { tailKind, endsOpen, endsOnJoiner, joinWrapped, isDanglingRange } from './wrap.js';

const TERMINAL_RE = /[.!?;:]["')\]]?$/;

export function typographyStats(lines) {
  const sized = lines.filter((l) => l.size > 0);
  const bodyLines = sized.filter((l) => l.text.split(/\s+/).length >= 4);
  const bodySize = median((bodyLines.length ? bodyLines : sized).map((l) => l.size));
  const widths = sized.filter((l) => l.width > 0).map((l) => l.width);
  const lengths = lines.map((l) => l.text.length);
  const p90 = (arr) => { const a = [...arr].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * 0.9))] : 0; };
  return {
    hasGeometry: sized.length > lines.length * 0.5,
    bodySize,
    maxWidth: widths.length ? Math.max(...widths) : 0,
    p90Width: p90(widths),
    p90Length: p90(lengths),
  };
}

function isNoise(line) {
  const t = line.text.trim();
  if (!t) return true;
  if (PAGE_NOISE_RE.test(t)) return true;
  // Stray punctuation-only lines (table rules, "|", "—") from extraction.
  if (!/[A-Za-z0-9]/.test(t)) return true;
  return false;
}

// Would `next` plausibly be the wrapped tail of `cur`?
function isContinuation(cur, next, stats, maxWidthForColumn) {
  if (next.bullet) return false;
  if (next.column !== cur.column) return false;
  if (next.page !== cur.page && !(next.page === cur.page + 1 && next.gapAbove === 0)) return false;
  const geo = stats.hasGeometry && cur.size > 0 && next.size > 0;
  // A role header whose date range wrapped after its dash: "… Chicago, IL Jan 2025 –" / "Aug 2025".
  if (isDanglingRange(cur.text, next.text) && !findDateRange(next.text) && next.text.split(/\s+/).length <= 4
    && (geo ? next.gapAbove <= 1.5 : next.gapAbove <= 1)) return true;
  if (cur.segments && cur.segments.length > 1) return false; // a title/date line never wraps
  if (next.segments && next.segments.length > 1) return false;
  if (findDateRange(next.text)) return false;
  // Contact facts never continue a sentence (an email starts lowercase — that is not a wrap).
  if (EMAIL_RE.test(next.text) || URL_RE.test(next.text) || PHONE_RE.test(next.text)) return false;
  const curWords = cur.text.split(/\s+/).length;
  const nextWords = next.text.split(/\s+/).length;
  // A bullet's wrapped tail. Many layouts wrap bullet text back to the left margin (under the
  // glyph, at the header indent), so indent cannot tell a tail from the next role's header; the
  // tail's own shape can ("calendar.", "(1,800 subscribers).", "p99 latency 180ms to 70ms."),
  // together with the bullet above it running full width or stopping mid-phrase.
  if (cur.bullet && curWords >= 3) {
    const tail = tailKind(next.text);
    if (tail) {
      const sameStyle = geo
        ? Math.abs(cur.size - next.size) <= 0.75 && !(next.bold && !cur.bold) && next.gapAbove <= 1.5
        : next.gapAbove <= 1;
      const full = geo
        ? maxWidthForColumn > 0 && cur.width >= 0.68 * maxWidthForColumn
        : cur.text.length >= 0.7 * (stats.p90Length || 80) && curWords >= 8;
      if (sameStyle) {
        if (tail === 'strong' && (endsOpen(cur.text) || /^[a-z]/.test(next.text))) return true;
        if (tail === 'weak' && endsOpen(cur.text) && (full || endsOnJoiner(cur.text))) return true;
      }
    }
  }
  // A short all-capitalized line (a name, a title) is a fact, not a wrapped sentence start.
  if (curWords <= 4 && cur.text.split(/\s+/).every((w) => /^[A-Z]/.test(w))) return false;
  if (stats.hasGeometry && cur.size > 0 && next.size > 0) {
    if (Math.abs(cur.size - next.size) > 0.75) return false;
    if (next.bold !== cur.bold && next.text.length > 24) return false;
    if (next.gapAbove > 1.5) return false;
    if (next.indent < cur.indent - 1.5) return false;
    const full = maxWidthForColumn > 0 && cur.width >= 0.68 * maxWidthForColumn;
    const startsLower = /^[a-z]/.test(next.text);
    const midSentence = !TERMINAL_RE.test(cur.text);
    // List items (skills sidebars, one-line facts) are short and each starts with a capital —
    // a genuine wrap of a short line almost always continues in lowercase.
    if (!startsLower && curWords <= 6) return false;
    // A line that ends in a year (a dated fact) followed by a capitalized line is two facts.
    if (!startsLower && /\b(?:19|20)\d{2}\)?\.?$/.test(cur.text)) return false;
    // A capitalized line opening with a degree ("B.A. Economics…") is a new education entry.
    if (!startsLower && DEGREE_RE.test(next.text.slice(0, 24))) return false;
    if (/^[A-Za-z][A-Za-z &/]{1,30}:\s/.test(cur.text) || /^[A-Za-z][A-Za-z &/]{1,30}:\s/.test(next.text)) return false;
    // A short first line that ends mid-sentence with a lowercase continuation is a wrap even when
    // the width test fails (narrow columns, trailing long words).
    if (startsLower && midSentence && curWords >= 3) return true;
    if (!full) return false;
    if (next.bold && !cur.bold) return false;
    // Full-width line followed by text at the same indent: continuation unless the next line
    // reads as its own sentence start AND the current line ended a sentence.
    if (TERMINAL_RE.test(cur.text) && /^[A-Z]/.test(next.text) && nextWords >= 4) return false;
    return true;
  }
  // No geometry (pasted text / legacy extraction): only merge an obvious mid-sentence wrap.
  if (next.gapAbove > 1) return false;
  const startsLower = /^[a-z]/.test(next.text);
  const midSentence = !TERMINAL_RE.test(cur.text) && !/[,:;]$/.test(cur.text) === false ? true : !TERMINAL_RE.test(cur.text);
  const longEnough = cur.text.length >= 0.8 * (stats.p90Length || 80) && curWords >= 8;
  return startsLower && midSentence && longEnough;
}

/**
 * Normalize rich lines: remove noise and compute typography stats. Wrapped-line merging is a
 * separate step (mergeWrappedLines) that the parser applies per section — skills sidebars and
 * language lists must never be merged, experience bullets and summaries must.
 * Returns { lines, stats }.
 */
export function preprocessLines(rawLines) {
  const lines = rawLines.filter((l) => l && !isNoise(l)).map((l) => ({ ...l }));
  const stats = typographyStats(lines);
  return { lines, stats };
}

/** Merge hard-wrapped continuation lines (see isContinuation). */
export function mergeWrappedLines(lines, stats) {
  // Per-column max width (what "full width" means for that column).
  const colMax = new Map();
  for (const l of lines) if (l.width > 0) colMax.set(l.column, Math.max(colMax.get(l.column) || 0, l.width));

  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const cur = { ...lines[i] };
    while (i + 1 < lines.length && isContinuation(cur, lines[i + 1], stats, colMax.get(cur.column) || stats.maxWidth)) {
      const next = lines[i + 1];
      cur.text = joinWrapped(cur.text, next.text);
      // A header's layout segments ("Title — Company" | "Jan 2025 –") are what the role parser
      // reads; the wrapped tail belongs to the last one.
      if (cur.segments && cur.segments.length > 1) cur.segments = [...cur.segments.slice(0, -1), joinWrapped(cur.segments[cur.segments.length - 1], next.text)];
      cur.width = Math.max(cur.width, next.width);
      cur.mergedLines = (cur.mergedLines || 1) + 1;
      i++;
    }
    out.push(cur);
  }
  return out;
}

// ── Wrapped skill lists ──────────────────────────────────────────────────────────────────────
// A comma list that wraps splits the item at the line break: "…, inventory, loss" / "prevention,
// training and onboarding, …" became the skills "loss" and "prevention" (exported as
// "loss · prevention"). List sections are never prose-merged (a sidebar's one-skill-per-line
// layout must stay as it is), so they get this narrower rule: the line above is itself a list
// (2+ separators) that stops on a word, not a separator, and the line below starts lowercase or
// the line above stops on a joiner ("English /", "R&D and") — a new list line starts with a
// capital or a "Label:". A vendor name left alone at the end ("Microsoft" / "Excel, …") is the
// one capitalized wrap that is unambiguous.
const LIST_SEP_RE = /[,;|•·▪]/g;
const LABEL_LINE_RE = /^[A-Za-z][A-Za-z &/+'-]{1,30}[:：]\s/;
const VENDOR_HEAD_RE = /(?:^|[,;|•·]\s*)(?:Microsoft|Google|Adobe|Amazon|Apple|Oracle|Salesforce|SAP|IBM|Meta|Atlassian|Autodesk|Cisco|VMware|Zoho|Intuit|QuickBooks)$/;
function isListContinuation(cur, next, stats) {
  if (next.bullet) return false;
  if (next.column !== cur.column || next.page !== cur.page) return false;
  const geo = stats.hasGeometry && cur.size > 0 && next.size > 0;
  if (geo ? (next.gapAbove > 1.5 || Math.abs(cur.size - next.size) > 0.75 || next.bold !== cur.bold) : next.gapAbove > 1) return false;
  if (LABEL_LINE_RE.test(next.text)) return false;
  if ((cur.text.match(LIST_SEP_RE) || []).length < 2) return false;
  const t = cur.text.trim();
  if (/[,;|•·▪.]$/.test(t)) return false; // the list line closed cleanly
  if (/^[a-z]/.test(next.text) && !/^[a-z]{1,3}[A-Z]/.test(next.text)) return true;
  if (endsOnJoiner(t)) return true;
  return VENDOR_HEAD_RE.test(t) && /^[A-Z]/.test(next.text);
}

/** Merge comma/pipe skill lists that wrapped mid-item (see isListContinuation). */
export function mergeWrappedListLines(lines, stats) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const cur = { ...lines[i] };
    while (i + 1 < lines.length && isListContinuation(cur, lines[i + 1], stats)) {
      cur.text = joinWrapped(cur.text, lines[i + 1].text);
      cur.width = Math.max(cur.width || 0, lines[i + 1].width || 0);
      cur.mergedLines = (cur.mergedLines || 1) + 1;
      i++;
    }
    out.push(cur);
  }
  return out;
}
