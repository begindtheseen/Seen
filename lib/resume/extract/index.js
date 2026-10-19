// ONE entry point for turning an uploaded résumé file into text + rich lines.
//
// Routes by file type to the layout-aware PDF extractor, the structured DOCX extractor, or the
// plain-text reader, then applies the SAME quality gates every format has always had (size cap,
// minimum length, garbled-glyph check, the canonical readability predicate) so downstream never
// receives gibberish. lib/server/resumeUpload.js's extractUploadText() is now a thin wrapper over
// this, keeping its {ok,text,fileType,wordCount}/{ok:false,status,error} contract for every caller.

import { extractPdfLayout } from './pdf.js';
import { extractDocxLayout } from './docx.js';
import { textToLines } from './lines.js';
import { looksLikeGarbledText } from '../../server/pdfText.js';
import { isReadableResume } from '../../server/resumeReadability.js';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export function detectFileType({ fileName, mimeType }) {
  const nameLower = String(fileName || '').toLowerCase();
  const mime = String(mimeType || '').toLowerCase();
  if (nameLower.endsWith('.pdf') || mime.includes('pdf')) return 'pdf';
  if (nameLower.endsWith('.docx') || nameLower.endsWith('.doc') || mime.includes('word') || mime.includes('officedocument')) return 'word';
  if (nameLower.endsWith('.txt') || nameLower.endsWith('.md') || mime.includes('text/plain') || mime.includes('markdown')) return 'text';
  return null;
}

/**
 * @param {{ buffer: Buffer, fileName?: string, mimeType?: string }} input
 * @returns {Promise<{ ok: true, text: string, lines: object[], fileType: string, wordCount: number, layout: object, warnings: string[] }
 *                 | { ok: false, status: number, error: string }>}
 */
export async function extractResumeFile({ buffer, fileName, mimeType }) {
  if (!buffer || !buffer.length) return { ok: false, status: 400, error: 'No file data provided' };
  if (buffer.length > MAX_UPLOAD_BYTES) return { ok: false, status: 400, error: 'File too large. Max 10MB.' };
  const fileType = detectFileType({ fileName, mimeType });
  if (!fileType) {
    return { ok: false, status: 400, error: 'Only PDF, Word, and plain-text documents (.pdf, .doc, .docx, .txt, .md) are supported.' };
  }

  let text = '', lines = [], layout = { method: fileType, columns: 1 }, warnings = [];
  if (fileType === 'pdf') {
    const r = await extractPdfLayout(buffer);
    text = r.text; lines = r.lines; layout = r.layout; warnings = r.warnings;
  } else if (fileType === 'word') {
    const r = await extractDocxLayout(buffer);
    text = r.text; lines = r.lines; layout = r.layout; warnings = r.warnings;
  } else {
    // Decode as UTF-8, normalize line endings, strip NUL bytes (Postgres text columns reject them).
    text = buffer.toString('utf8').replace(/\r\n?/g, '\n').replace(/\x00/g, '').trim();
    lines = textToLines(text);
  }
  text = cleanText(text);

  if (!text || text.length < 50) {
    return {
      ok: false, status: 422,
      error: fileType === 'pdf'
        ? 'Could not read selectable text from this PDF (it may be a scanned image, or use an unusual font encoding). Please copy your résumé text and paste it directly into the box instead.'
        : fileType === 'text'
          ? 'This text file is too short to be a résumé. Paste your full résumé text into the box instead.'
          : 'Could not extract readable text. Make sure the file has selectable text (not a scanned image), or paste your résumé text directly.',
    };
  }
  if ((fileType === 'pdf' || fileType === 'text') && looksLikeGarbledText(text)) {
    return {
      ok: false, status: 422,
      error: fileType === 'text'
        ? 'This file doesn’t look like readable résumé text (the characters come out scrambled). Paste your résumé text directly into the box instead.'
        : 'This PDF uses a font we can’t read as text (the extracted characters come out scrambled). Please copy your résumé text and paste it directly into the box, or re-export the PDF from Word/Google Docs/Pages.',
    };
  }
  if (!isReadableResume(text)) {
    return {
      ok: false, status: 422,
      error: 'We couldn’t read this résumé as text — too few real words came through (common with scanned or phone-exported PDFs). Paste your résumé text directly into the box, or re-export the PDF from Word / Google Docs / Pages.',
    };
  }
  const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;
  return { ok: true, text, lines, fileType, wordCount, layout, warnings };
}

// The same cleanup every extractor output has always received (pdfText.cleanupText), applied once.
function cleanText(text) {
  return String(text || '')
    .replace(/\x00/g, '')
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .trim();
}
