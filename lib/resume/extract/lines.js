// Rich lines — the common currency between extraction and parsing.
//
// Every extractor (PDF with geometry, DOCX with styles, plain text) emits an array of RichLine:
//   { text, page, x, y, width, size, bold, italic, column, bullet, bulletChar, indent, gapAbove,
//     segments, source }
// Geometry and typography are OPTIONAL signals: plain text carries none and the parser still
// works; a PDF carries all of them and the parser gets sharper (headers by size/bold, bullets by
// indent, title/date splits by the wide gap). Pure helpers, no I/O.

export const BULLET_CHARS = '•·▪◦‣●■□○◆◇➢➤►▶✓✔→*–—-';
// A leading bullet glyph (or a lone "o"/"-" used as one) followed by whitespace.
// Private-use glyphs (U+F000–U+F0FF) are how Word's Symbol/Wingdings bullets survive extraction
// when the font ships no ToUnicode map — they count as bullets too.
const BULLET_LEAD_RE = new RegExp(`^\\s*(?:[${BULLET_CHARS.replace(/[-\]\\^]/g, '\\$&')}\\uF000-\\uF0FF]|o(?=\\s)|\\d{1,2}[.)](?=\\s))\\s+`, 'u');
// Section decoration résumé exporters wrap around headers: "=== EXPERIENCE ===", "## Skills", "--".
const DECOR_RE = /^[\s=*_~#•·–—-]+|[\s=*_~#•·–—:-]+$/g;

export function makeLine(text, extra = {}) {
  const raw = String(text || '');
  const bm = raw.match(BULLET_LEAD_RE);
  // "* SKILLS *" / "=== EXPERIENCE ===" are decorated headers, not bullets: the decoration
  // closes the line too.
  const decorated = !!bm && /[=*_~#]\s*$/.test(raw.trim()) && /^[=*_~#]/.test(raw.trim());
  const bullet = !!bm && !decorated && raw.trim().length > bm[0].trim().length;
  return {
    text: (bullet ? raw.slice(bm[0].length) : raw).replace(/\s+/g, ' ').trim(),
    rawText: raw.trim(),
    page: 1, x: 0, y: 0, width: 0, size: 0, bold: false, italic: false, column: 0,
    bullet, bulletChar: bullet ? bm[0].trim() : '',
    indent: 0, gapAbove: 0, segments: null, source: 'text',
    ...extra,
  };
}

/** Plain text → rich lines (no geometry). Blank lines become gapAbove on the following line. */
export function textToLines(text) {
  const out = [];
  let pendingGap = 0;
  for (const raw of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    if (!raw.trim()) { pendingGap += 1; continue; }
    const line = makeLine(raw, { gapAbove: out.length ? pendingGap + 1 : 0, source: 'text' });
    // Wide internal gaps (3+ spaces or tabs) are a layout signal: "Title     Jan 2020 – Present".
    const segs = raw.trim().split(/\t+|\s{3,}/).map((s) => s.trim()).filter(Boolean);
    if (segs.length > 1) line.segments = segs;
    out.push(line);
    pendingGap = 0;
  }
  return out;
}

/** Rich lines → plain text with paragraph breaks where the layout had them. */
export function linesToText(lines) {
  const out = [];
  let lastPage = null;
  for (const l of lines) {
    if (out.length && (l.gapAbove >= 2 || (lastPage != null && l.page !== lastPage))) out.push('');
    const t = l.segments && l.segments.length > 1 ? l.segments.join('   ') : l.text;
    out.push(l.bullet ? `• ${t}` : t);
    lastPage = l.page;
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Strip header decoration ("=== SKILLS ===" → "SKILLS"). */
export function undecorate(text) {
  return String(text || '').replace(DECOR_RE, '').trim();
}

/** Median of a numeric array (0 for empty). */
export function median(nums) {
  const a = nums.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return 0;
  const mid = a.length >> 1;
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}
