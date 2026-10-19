// Structured DOCX extraction → rich lines.
//
// A .docx is a zip of XML; word/document.xml holds paragraphs (<w:p>) made of runs (<w:r>) with
// text (<w:t>), tabs (<w:tab/>), breaks (<w:br/>), and paragraph/run properties that carry exactly
// the signals a résumé parser wants: heading styles (<w:pStyle w:val="Heading1"/>), bullets
// (<w:numPr>), bold (<w:b/>), italics (<w:i/>), font size (<w:sz w:val="24"/> = 12pt), and
// indentation (<w:ind w:left="720"/> twips). Tables (<w:tbl>) — the classic two-column résumé in
// Word — are read cell by cell, row by row, each cell's paragraphs kept in order, so a sidebar
// never interleaves with the main column. No external parser: the zip reader lives in
// lib/server/resumeUpload.js and this is a few hundred lines of deliberate regex over a known
// schema (OOXML WordprocessingML), which is both faster and smaller than a DOM.

import { readZipEntry } from '../../server/resumeUpload.js';
import { makeLine } from './lines.js';

export const DOCX_EXTRACTOR_VERSION = 'docx_struct_v1';

const XML_ENTITY = { amp: '&', lt: '<', gt: '>', apos: "'", quot: '"' };
// One pass, so "&amp;lt;" decodes to "&lt;" (never double-unescaped to "<").
export function decodeXml(s) {
  return String(s || '').replace(/&(amp|lt|gt|apos|quot|#x[0-9a-f]+|#\d+);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (XML_ENTITY[k]) return XML_ENTITY[k];
    const cp = k[1] === 'x' ? parseInt(k.slice(2), 16) : Number(k.slice(1));
    return Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
  });
}

// Text of one paragraph with run-level formatting. Tabs become " | " separators (Word résumés
// use a tab to push dates right), breaks become "\n" (a soft line inside the paragraph).
function readParagraph(pXml) {
  const pPr = (pXml.match(/<w:pPr>([\s\S]*?)<\/w:pPr>/) || [])[1] || '';
  const style = (pPr.match(/<w:pStyle\s+w:val="([^"]+)"/) || [])[1] || '';
  const outline = (pPr.match(/<w:outlineLvl\s+w:val="(\d)"/) || [])[1];
  const numbered = /<w:numPr>/.test(pPr);
  const indLeft = Number((pPr.match(/<w:ind\b[^>]*\bw:left="(\d+)"/) || [])[1] || 0);
  const indHanging = Number((pPr.match(/<w:ind\b[^>]*\bw:hanging="(\d+)"/) || [])[1] || 0);
  const align = (pPr.match(/<w:jc\s+w:val="([^"]+)"/) || [])[1] || '';
  const spacingBefore = Number((pPr.match(/<w:spacing\b[^>]*\bw:before="(\d+)"/) || [])[1] || 0);
  // Paragraph-level run defaults (bold for the whole paragraph is common in headings).
  const pRunPr = (pPr.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/) || [])[1] || '';
  const pBold = /<w:b\b(?![^>]*w:val="(?:0|false)")/.test(pRunPr);
  const pItalic = /<w:i\b(?![^>]*w:val="(?:0|false)")/.test(pRunPr);
  const pSize = Number((pRunPr.match(/<w:sz\s+w:val="(\d+)"/) || [])[1] || 0) / 2;

  let text = '';
  let boldChars = 0, italicChars = 0, chars = 0, maxSize = pSize;
  const body = pXml.replace(/<w:pPr>[\s\S]*?<\/w:pPr>/, '');
  const runRe = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>|<w:tab\/>|<w:br\/>|<w:cr\/>/g;
  let m;
  while ((m = runRe.exec(body)) !== null) {
    if (m[0] === '<w:tab/>') { text += '\t'; continue; }
    if (m[0] === '<w:br/>' || m[0] === '<w:cr/>') { text += '\n'; continue; }
    const run = m[1];
    const rPr = (run.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/) || [])[1] || '';
    const bold = pBold || /<w:b\b(?![^>]*w:val="(?:0|false)")/.test(rPr);
    const italic = pItalic || /<w:i\b(?![^>]*w:val="(?:0|false)")/.test(rPr);
    const size = Number((rPr.match(/<w:sz\s+w:val="(\d+)"/) || [])[1] || 0) / 2 || pSize;
    if (size > maxSize) maxSize = size;
    let runText = '';
    const partRe = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>|<w:sym\b[^>]*w:char="([0-9A-Fa-f]{4})"[^>]*\/>/g;
    let pm;
    while ((pm = partRe.exec(run)) !== null) {
      if (pm[0] === '<w:tab/>') runText += '\t';
      else if (pm[0] === '<w:br/>') runText += '\n';
      else if (pm[2]) runText += '•'; // a symbol-font glyph (Wingdings/Symbol bullet) → bullet
      else runText += decodeXml(pm[1]);
    }
    text += runText;
    const len = runText.replace(/\s/g, '').length;
    chars += len; if (bold) boldChars += len; if (italic) italicChars += len;
  }
  return {
    text, style: outline != null && outline !== '9' ? (style || `Heading${Number(outline) + 1}`) : style,
    numbered, indLeft, indHanging, align, spacingBefore,
    bold: chars > 0 && boldChars / chars >= 0.6,
    italic: chars > 0 && italicChars / chars >= 0.6,
    size: maxSize,
  };
}

const HEADING_STYLE_RE = /^(heading\d*|title|subtitle|h\d)$/i;

// Turn one paragraph into rich lines (a paragraph with soft breaks yields several).
function paragraphLines(p, acc, { column = 0, gapHint = 0 } = {}) {
  const parts = p.text.split('\n');
  let first = true;
  for (const part of parts) {
    const raw = part.replace(/\t+/g, '   ').trim();
    if (!raw) { acc.pendingGap += 1; continue; }
    const segments = part.split(/\t+|\s{3,}/).map((s) => s.trim()).filter(Boolean);
    const line = makeLine((p.numbered && first ? '• ' : '') + raw, {
      size: p.size || 0, bold: p.bold, italic: p.italic, column,
      indent: Math.round((p.indLeft - p.indHanging) / 20), // twips → points
      gapAbove: acc.lines.length ? (acc.pendingGap + 1 + (p.spacingBefore >= 160 ? 1 : 0) + gapHint) : 0,
      segments: segments.length > 1 ? segments : null,
      source: 'docx',
    });
    if (HEADING_STYLE_RE.test(p.style)) line.heading = true;
    if (p.numbered && first) line.bullet = true;
    acc.lines.push(line);
    acc.pendingGap = 0;
    first = false;
  }
}

/**
 * Extract rich lines (+ text) from a .docx buffer.
 * @returns {Promise<{ ok: boolean, text: string, lines: object[], layout: object, warnings: string[] }>}
 */
export async function extractDocxLayout(buffer) {
  const warnings = [];
  const xmlRaw = await readZipEntry(buffer, 'word/document.xml');
  if (!xmlRaw) return { ok: false, text: '', lines: [], layout: { method: 'docx', version: DOCX_EXTRACTOR_VERSION, columns: 1 }, warnings: ['docx_no_document_xml'] };
  // Text boxes / shapes are written twice (mc:Choice for new Word, mc:Fallback for old) — keep ONE.
  const dedupeAlt = (x) => String(x).replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, '');
  const xml = dedupeAlt(xmlRaw);
  const acc = { lines: [], pendingGap: 0 };
  let tables = 0, maxCols = 1;
  // Word résumé templates often put the name + contact block in the page HEADER part.
  for (const part of ['word/header1.xml', 'word/header2.xml', 'word/header3.xml']) {
    const hx = await readZipEntry(buffer, part).catch(() => null);
    if (!hx) continue;
    const paras = dedupeAlt(hx).match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g) || [];
    for (const pXml of paras) paragraphLines(readParagraph(pXml), acc);
    if (paras.length) { warnings.push(`docx_header_part:${part}`); acc.pendingGap += 1; }
  }
  const bodyXml = (xml.match(/<w:body>([\s\S]*?)<\/w:body>/) || [null, xml])[1];

  // Walk top-level block elements in order: paragraphs and tables (and sdt wrappers).
  const blockRe = /<w:tbl>[\s\S]*?<\/w:tbl>|<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  let m;
  while ((m = blockRe.exec(bodyXml)) !== null) {
    const block = m[0];
    if (block.startsWith('<w:tbl>')) {
      tables++;
      // Rows → cells. A single-row, multi-cell table is the two-column résumé; a multi-row table
      // with 2 cells per row is a "dates | description" layout. We keep each cell's paragraphs
      // together and tag the column index so the parser can treat sidebars separately.
      const rows = block.match(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g) || [];
      for (const row of rows) {
        const cells = row.match(/<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g) || [];
        if (cells.length > maxCols) maxCols = cells.length;
        cells.forEach((cell, ci) => {
          const paras = cell.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g) || [];
          paras.forEach((pXml, pi) => {
            const p = readParagraph(pXml);
            paragraphLines(p, acc, { column: cells.length > 1 ? ci : 0, gapHint: pi === 0 ? 1 : 0 });
          });
        });
      }
      acc.pendingGap += 1;
      continue;
    }
    if (block.endsWith('/>')) { acc.pendingGap += 1; continue; } // empty paragraph
    const p = readParagraph(block);
    paragraphLines(p, acc);
  }
  if (tables) warnings.push(`docx_tables:${tables}`);
  const lines = acc.lines;
  const text = lines.map((l) => (l.gapAbove >= 2 ? '\n' : '') + (l.bullet ? '• ' : '') + (l.segments ? l.segments.join('   ') : l.text)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return {
    ok: text.length > 0, text, lines,
    layout: { method: 'docx', version: DOCX_EXTRACTOR_VERSION, columns: maxCols > 1 ? maxCols : 1, tables },
    warnings,
  };
}
