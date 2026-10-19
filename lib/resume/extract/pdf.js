// Layout-aware PDF extraction (pdf.js) → rich lines.
//
// The old extractor (lib/server/pdfText.js) flattens a PDF's content streams into text and keeps
// NO geometry, so a two-column résumé interleaves its sidebar with its main column, a right-aligned
// date welds onto its title, and "bold 14pt header" is indistinguishable from body text. This
// module reads every positioned text run with pdf.js (Apache-2.0, Mozilla), then rebuilds the page
// the way a human reads it:
//   1. runs  — each text item with x/y/width/font-size/bold/italic (fonts resolved via the
//              operator list so Word/Docs subset fonts still report their weight);
//   2. columns — a vertical gutter that almost no run crosses, with real content on both sides,
//              splits the page into columns; full-width rows (name, section rules) stay full-width
//              and act as band separators, so reading order is band → column → top-to-bottom;
//   3. lines — runs on one baseline (within half a font size) join into a line; a wide horizontal
//              gap inside a line is kept as a segment boundary ("Title ··· Jan 2020 – Present");
//   4. attributes — size, bold/italic (by character share), indent inside the column, a leading
//              bullet glyph, and the vertical gap above in line-heights (paragraph breaks).
// If pdf.js cannot read the file (encrypted, malformed, no fonts) we fall back to the legacy
// stream extractor so NOTHING that used to parse stops parsing. Scanned-image PDFs yield no runs
// either way — the caller returns its honest "paste your text" error.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { extractPdfText } from '../../server/pdfText.js';
import { makeLine, linesToText, median } from './lines.js';

export const PDF_EXTRACTOR_VERSION = 'pdf_layout_v1';
const MAX_PAGES = 12;              // résumés are 1–3 pages; a 40-page PDF is not a résumé
const OPLIST_BUDGET_MS = 2500;     // font resolution (bold/italic) is optional — never let it stall

let _pdfjsPromise = null;
let _assetDirs = null;

function assetDirs() {
  if (_assetDirs) return _assetDirs;
  try {
    const req = createRequire(import.meta.url);
    const pkg = req.resolve('pdfjs-dist/package.json');
    const root = path.dirname(pkg);
    const worker = path.join(root, 'legacy', 'build', 'pdf.worker.mjs');
    const fonts = path.join(root, 'standard_fonts') + path.sep;
    const cmaps = path.join(root, 'cmaps') + path.sep;
    _assetDirs = {
      worker: fs.existsSync(worker) ? pathToFileURL(worker).href : null,
      fonts: fs.existsSync(fonts) ? fonts : null,
      cmaps: fs.existsSync(cmaps) ? cmaps : null,
    };
  } catch { _assetDirs = { worker: null, fonts: null, cmaps: null }; }
  return _assetDirs;
}

async function loadPdfjs() {
  if (!_pdfjsPromise) {
    _pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((mod) => {
      const dirs = assetDirs();
      // Explicit worker path: the bundled lambda keeps node_modules paths, but pdf.js's default
      // "./pdf.worker.mjs" is resolved relative to the importing module — pin it to the real file.
      if (dirs.worker && mod.GlobalWorkerOptions) mod.GlobalWorkerOptions.workerSrc = dirs.worker;
      return mod;
    });
  }
  return _pdfjsPromise;
}

// ── Step 1: text runs ────────────────────────────────────────────────────────────────────────
async function readRuns(pdf, pageNo, deadline) {
  const page = await pdf.getPage(pageNo);
  const viewport = page.getViewport({ scale: 1 });
  const W = viewport.width, H = viewport.height;
  // Resolve fonts first so commonObjs can answer bold/italic. Optional + time-boxed.
  let fontsResolved = false;
  if (Date.now() < deadline) {
    try { await page.getOperatorList(); fontsResolved = true; } catch { fontsResolved = false; }
  }
  const content = await page.getTextContent({ includeMarkedContent: false, disableNormalization: false });
  // Hyperlinks are often ONLY in link annotations ("LinkedIn" as clickable text) — collect them.
  const links = [];
  try {
    for (const a of await page.getAnnotations()) if (a && a.subtype === 'Link' && typeof a.url === 'string' && /^https?:/i.test(a.url)) links.push(a.url);
  } catch { /* annotations are optional */ }
  const fontInfo = new Map();
  const infoFor = (name) => {
    if (!name) return { bold: false, italic: false };
    if (fontInfo.has(name)) return fontInfo.get(name);
    let info = { bold: false, italic: false };
    if (fontsResolved) {
      try {
        const f = page.commonObjs.has(name) ? page.commonObjs.get(name) : null;
        if (f) {
          const nm = String(f.name || '').toLowerCase();
          info = {
            bold: !!(f.bold || f.black || /bold|black|heavy|semibold|demibold/.test(nm)),
            italic: !!(f.italic || /italic|oblique/.test(nm)),
          };
        }
      } catch { /* unresolved font → regular */ }
    }
    fontInfo.set(name, info);
    return info;
  };
  const runs = [];
  for (const it of content.items) {
    if (!it || typeof it.str !== 'string') continue;
    const str = it.str;
    if (!str.trim()) continue;
    const [a, b, , d, e, f] = it.transform || [1, 0, 0, 1, 0, 0];
    const size = Math.max(Math.abs(it.height || 0), Math.hypot(a, b), Math.abs(d)) || 10;
    const { bold, italic } = infoFor(it.fontName);
    runs.push({ str, x: e, top: H - f, w: it.width || 0, size, bold, italic, page: pageNo });
  }
  page.cleanup();
  return { runs, width: W, height: H, links };
}

// ── Step 2: columns ──────────────────────────────────────────────────────────────────────────
// Returns the gutter x (a vertical band no run crosses) or null for a single-column page.
function detectGutter(runs, pageWidth) {
  if (runs.length < 12) return null;
  const body = runs.filter((r) => r.w > 0);
  const n = body.length;
  const lo = pageWidth * 0.22, hi = pageWidth * 0.78, step = 3;
  const maxCross = Math.max(2, Math.floor(n * 0.08));
  // Mark every x position that could sit inside a gutter, then take the widest contiguous band.
  const valid = [];
  for (let x = lo; x <= hi; x += step) {
    let crossing = 0, left = 0, right = 0;
    for (const r of body) {
      const x1 = r.x, x2 = r.x + r.w;
      if (x1 < x - 2 && x2 > x + 2) crossing++;
      else if (x2 <= x + 2) left++;
      else right++;
    }
    valid.push(crossing <= maxCross && left >= n * 0.2 && right >= n * 0.2 ? x : null);
  }
  let best = null, cur = null;
  for (const x of valid) {
    if (x == null) { cur = null; continue; }
    if (cur && x - cur.end <= step + 0.01) cur.end = x;
    else cur = { start: x, end: x };
    if (!best || (cur.end - cur.start) > (best.end - best.start)) best = cur;
  }
  if (!best) return null;
  const width = best.end - best.start;
  if (width < 9) return null; // a real gutter is at least ~0.13"
  const gx = (best.start + best.end) / 2;
  // A real column is a stack of LEFT-ALIGNED runs: most of its runs start at the same x. Dates and
  // locations flushed right (one-column résumés with "Jan 2022 – Present" at the margin) end at the
  // same x but start wherever their width puts them — they are not a column. Both sides also need
  // enough lines to be columns at all.
  const left = body.filter((r) => r.x + r.w <= gx + 2), right = body.filter((r) => r.x >= gx - 2);
  if (left.length < 6 || right.length < 6) return null;
  const aligned = (rs) => {
    const buckets = new Map();
    for (const r of rs) { const k = Math.round(r.x / 4); buckets.set(k, (buckets.get(k) || 0) + 1); }
    return Math.max(...buckets.values()) / rs.length;
  };
  if (aligned(right) < 0.5 || aligned(left) < 0.5) return null;
  return { x: gx, start: best.start, end: best.end, width };
}

// ── Step 3: lines ────────────────────────────────────────────────────────────────────────────
function groupLines(runs) {
  const sorted = [...runs].sort((p, q) => (p.top - q.top) || (p.x - q.x));
  const lines = [];
  for (const r of sorted) {
    const last = lines[lines.length - 1];
    const tol = Math.max(2, 0.5 * Math.max(r.size, last ? last.size : 0));
    if (last && Math.abs(last.top - r.top) <= tol) { last.runs.push(r); last.size = Math.max(last.size, r.size); }
    else lines.push({ top: r.top, size: r.size, runs: [r] });
  }
  for (const l of lines) l.runs.sort((p, q) => p.x - q.x);
  return lines;
}

function finishLine(l, colLeft, prev, page) {
  const runs = l.runs;
  let text = '';
  const segments = [];
  let seg = '';
  let cursorEnd = null;
  let boldChars = 0, italicChars = 0, chars = 0;
  for (const r of runs) {
    const s = r.str;
    if (cursorEnd != null) {
      const gap = r.x - cursorEnd;
      if (gap > 2.2 * r.size && seg.trim()) { segments.push(seg.trim()); seg = ''; text += '   '; }
      else if (gap > 0.12 * r.size && !/\s$/.test(text) && !/^\s/.test(s)) { text += ' '; seg += ' '; }
    }
    text += s; seg += s;
    cursorEnd = r.x + r.w;
    const len = s.replace(/\s/g, '').length;
    chars += len; if (r.bold) boldChars += len; if (r.italic) italicChars += len;
  }
  if (seg.trim()) segments.push(seg.trim());
  const x = runs[0].x;
  const width = cursorEnd - x;
  const line = makeLine(text, {
    page, x, y: l.top, width, size: l.size,
    bold: chars > 0 && boldChars / chars >= 0.6,
    italic: chars > 0 && italicChars / chars >= 0.6,
    indent: Math.max(0, x - colLeft),
    gapAbove: prev ? Math.max(0, (l.top - prev.top) / Math.max(prev.size, 6)) : 0,
    segments: segments.length > 1 ? segments : null,
    source: 'pdf',
  });
  // A bullet glyph often lives in its own run with a hanging indent; the text already had it
  // stripped by makeLine — record the glyph's x as the line's x so indent reflects the text.
  return line;
}

function layoutPage(runs, pageWidth, pageNo) {
  const gutter = detectGutter(runs, pageWidth);
  const out = [];
  if (!gutter) {
    const lines = groupLines(runs);
    const colLeft = Math.min(...lines.map((l) => l.runs[0].x));
    let prev = null;
    for (const l of lines) { out.push(finishLine(l, colLeft, prev, pageNo)); prev = l; }
    return { lines: out, columns: 1 };
  }
  // Classify runs: left / right / crossing (full width).
  const left = [], right = [], full = [];
  for (const r of runs) {
    const x1 = r.x, x2 = r.x + r.w;
    if (x1 < gutter.x - 2 && x2 > gutter.x + 2) full.push(r);
    else if (x2 <= gutter.x + 2) left.push(r);
    else right.push(r);
  }
  const fullLines = groupLines(full);
  const leftLines = groupLines(left);
  const rightLines = groupLines(right);
  // Bands: full-width lines split the page vertically; within a band read left column, then right.
  const cuts = [...fullLines.map((l) => l.top), Infinity];
  const leftMin = leftLines.length ? Math.min(...leftLines.map((l) => l.runs[0].x)) : 0;
  const rightMin = rightLines.length ? Math.min(...rightLines.map((l) => l.runs[0].x)) : gutter.x;
  let li = 0, ri = 0, fi = 0;
  let prev = null;
  for (const cut of cuts) {
    const bandLeft = [], bandRight = [];
    while (li < leftLines.length && leftLines[li].top < cut) bandLeft.push(leftLines[li++]);
    while (ri < rightLines.length && rightLines[ri].top < cut) bandRight.push(rightLines[ri++]);
    // Emit the band's columns (left then right), each with its own vertical rhythm.
    let p = prev;
    for (const l of bandLeft) { const line = finishLine(l, leftMin, p, pageNo); line.column = 0; out.push(line); p = l; }
    p = prev;
    for (const l of bandRight) { const line = finishLine(l, rightMin, p, pageNo); line.column = 1; out.push(line); p = l; }
    if (fi < fullLines.length && cut !== Infinity) {
      const fl = fullLines[fi++];
      const line = finishLine(fl, Math.min(leftMin, fl.runs[0].x), prev, pageNo);
      line.column = -1; // full width
      out.push(line);
      prev = fl;
    }
  }
  return { lines: out, columns: 2 };
}

/**
 * Extract rich lines (+ joined text) from a PDF buffer.
 * @returns {Promise<{ ok: boolean, text: string, lines: object[], layout: object, warnings: string[] }>}
 */
export async function extractPdfLayout(buffer, { maxPages = MAX_PAGES } = {}) {
  const warnings = [];
  const started = Date.now();
  try {
    const pdfjs = await loadPdfjs();
    const dirs = assetDirs();
    const task = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: false, disableFontFace: true, isEvalSupported: false, verbosity: 0,
      fontExtraProperties: true, // exposes font.name so subset fonts ("ABCDEF+Arial-BoldMT") report weight
      standardFontDataUrl: dirs.fonts || undefined,
      cMapUrl: dirs.cmaps || undefined, cMapPacked: true,
      stopAtErrors: false,
    });
    const pdf = await task.promise;
    const pages = Math.min(pdf.numPages, maxPages);
    if (pdf.numPages > maxPages) warnings.push(`pdf_pages_truncated:${pdf.numPages}`);
    const allLines = [];
    let columns = 1;
    const sizes = [];
    const links = [];
    const deadline = started + OPLIST_BUDGET_MS;
    for (let p = 1; p <= pages; p++) {
      const { runs, width, links: pageLinks } = await readRuns(pdf, p, deadline);
      links.push(...pageLinks);
      if (!runs.length) continue;
      const { lines, columns: cols } = layoutPage(runs, width, p);
      if (cols > columns) columns = cols;
      for (const l of lines) { allLines.push(l); if (l.size) sizes.push(l.size); }
    }
    try { await task.destroy(); } catch { /* ignore */ }
    // Append annotation-only URLs (linkedin/github/portfolio) that the visible text does not carry.
    const visible = allLines.map((l) => l.text).join('\n').toLowerCase();
    const extraLinks = [...new Set(links)].filter((u) => {
      const key = u.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '').toLowerCase();
      return key && !visible.includes(key) && !/^mailto:/i.test(u) && /linkedin\.com|github\.com|behance|dribbble|portfolio|\.me\b|\.dev\b|\.io\b/i.test(u) === true;
    }).slice(0, 4);
    if (extraLinks.length) {
      const first = allLines[0];
      allLines.splice(Math.min(allLines.length, 2), 0, makeLine(extraLinks.join(' | '), { page: first ? first.page : 1, source: 'pdf', gapAbove: 0, column: first ? first.column : 0, size: 0 }));
    }
    const text = linesToText(allLines);
    if (text.replace(/\s/g, '').length < 40) {
      // Nothing readable (scanned image, or fonts with no usable encoding). Try the legacy path
      // before giving up — it occasionally recovers text pdf.js refuses.
      return legacyFallback(buffer, warnings.concat('pdfjs_no_text'));
    }
    const bodySize = median(sizes);
    return {
      ok: true, text, lines: allLines,
      layout: { method: 'pdfjs', version: PDF_EXTRACTOR_VERSION, pages: pdf.numPages, columns, bodySize, ms: Date.now() - started },
      warnings,
    };
  } catch (e) {
    return legacyFallback(buffer, warnings.concat(`pdfjs_failed:${String(e && e.message || e).slice(0, 80)}`));
  }
}

async function legacyFallback(buffer, warnings) {
  const text = await extractPdfText(buffer);
  const { textToLines } = await import('./lines.js');
  return {
    ok: !!text, text, lines: textToLines(text),
    layout: { method: 'legacy', version: PDF_EXTRACTOR_VERSION, pages: null, columns: 1, bodySize: 0 },
    warnings,
  };
}
