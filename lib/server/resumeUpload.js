// Résumé upload → text extraction (keyless, deterministic).
//
// Extracted from api/resume.js handleParseResume so the file-decoding + quality gates are
// unit-testable. Supports PDF (native best-effort), Word (.docx/.doc), and plain text
// (.txt/.md). Applies the SAME quality gates to every format: a minimum length gate and the
// garbled-glyph check, so downstream (résumé survey, SeenFit) never receives gibberish.
//
// Returns { ok:true, text, fileType, wordCount } or { ok:false, status, error } — the caller
// (api/resume.js) maps that straight onto the HTTP response.

import zlib from 'zlib';
import { promisify } from 'util';
import { extractPdfText, looksLikeGarbledText } from './pdfText.js';

const inflateRaw = promisify(zlib.inflateRaw);

export async function extractUploadText({ base64, fileName, mimeType }) {
  if (!base64) return { ok: false, status: 400, error: 'No file data provided' };
  if (typeof base64 !== 'string' || base64.length > 14_000_000) {
    return { ok: false, status: 400, error: 'File too large. Max 10MB.' };
  }

  const fileBuffer = Buffer.from(base64, 'base64');
  if (fileBuffer.length > 10 * 1024 * 1024) {
    return { ok: false, status: 400, error: 'File too large. Max 10MB.' };
  }

  const nameLower = (fileName || '').toLowerCase();
  const isPDF = nameLower.endsWith('.pdf') || (mimeType || '').includes('pdf');
  const isWord = nameLower.endsWith('.docx') || nameLower.endsWith('.doc') ||
                 (mimeType || '').includes('word') || (mimeType || '').includes('officedocument');
  // Plain-text résumés (.txt / .md). Already selectable text — no extraction, but the SAME
  // quality gates apply (length + garbled check) so downstream never gets gibberish.
  const isText = nameLower.endsWith('.txt') || nameLower.endsWith('.md') ||
                 (mimeType || '').includes('text/plain') || (mimeType || '').includes('markdown');

  if (!isPDF && !isWord && !isText) {
    return { ok: false, status: 400, error: 'Only PDF, Word, and plain-text documents (.pdf, .doc, .docx, .txt, .md) are supported.' };
  }

  let extractedText = '';
  if (isPDF) {
    // Native best-effort PDF text extraction — inflates content streams and pulls
    // text-showing operators. Scanned-image PDFs return nothing → clean 422 below.
    extractedText = await extractPdfText(fileBuffer);
  } else if (isWord) {
    extractedText = await extractDocxText(fileBuffer);
  } else if (isText) {
    // Decode as UTF-8, normalize line endings, strip NUL bytes (Postgres text columns reject
    // them) — the same cleanup pdfText applies to extracted PDF text.
    extractedText = fileBuffer.toString('utf8').replace(/\r\n?/g, '\n').replace(/\x00/g, '').trim();
  }

  if (!extractedText || extractedText.length < 50) {
    return {
      ok: false,
      status: 422,
      error: isPDF
        ? 'Could not read selectable text from this PDF (it may be a scanned image, or use an unusual font encoding). Please copy your résumé text and paste it directly into the box instead.'
        : isText
          ? 'This text file is too short to be a résumé. Paste your full résumé text into the box instead.'
          : 'Could not extract readable text. Make sure the file has selectable text (not a scanned image), or paste your résumé text directly.',
    };
  }

  // A subset font with no usable ToUnicode extracts as scrambled glyph codes — long enough to
  // pass the length gate but useless downstream. The same check guards a binary file renamed
  // to .txt. (Word .docx text is already clean, so we don't garble-gate it.)
  if ((isPDF || isText) && looksLikeGarbledText(extractedText)) {
    return {
      ok: false,
      status: 422,
      error: isText
        ? 'This file doesn’t look like readable résumé text (the characters come out scrambled). Paste your résumé text directly into the box instead.'
        : 'This PDF uses a font we can’t read as text (the extracted characters come out scrambled). Please copy your résumé text and paste it directly into the box, or re-export the PDF from Word/Google Docs/Pages.',
    };
  }

  const wordCount = extractedText.split(/\s+/).filter((w) => w.length > 0).length;
  return { ok: true, text: extractedText, fileType: isPDF ? 'pdf' : isWord ? 'word' : 'text', wordCount };
}

async function extractDocxText(buffer) {
  try {
    const xml = await readZipEntry(buffer, 'word/document.xml');
    if (!xml) return '';
    let result = '';
    const paragraphs = xml.split(/<\/w:p>/);
    for (const para of paragraphs) {
      const tMatches = para.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
      const paraText = tMatches
        .map((m) => m.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&quot;/g, '"'))
        .join('').trim();
      if (paraText) result += paraText + '\n';
    }
    return result.trim();
  } catch (e) { return ''; }
}

async function readZipEntry(buffer, targetName) {
  let offset = 0;
  while (offset < buffer.length - 30) {
    if (buffer[offset] !== 0x50 || buffer[offset + 1] !== 0x4B || buffer[offset + 2] !== 0x03 || buffer[offset + 3] !== 0x04) { offset++; continue; }
    const compression  = buffer.readUInt16LE(offset + 8);
    const compressedSz = buffer.readUInt32LE(offset + 18);
    const nameLen      = buffer.readUInt16LE(offset + 26);
    const extraLen     = buffer.readUInt16LE(offset + 28);
    const entryName    = buffer.slice(offset + 30, offset + 30 + nameLen).toString('utf8');
    const dataStart    = offset + 30 + nameLen + extraLen;
    if (entryName === targetName) {
      const compressed = buffer.slice(dataStart, dataStart + compressedSz);
      if (compression === 0) return compressed.toString('utf8');
      if (compression === 8) return (await inflateRaw(compressed)).toString('utf8');
      return null;
    }
    offset = dataStart + compressedSz;
    if (compressedSz === 0 && nameLen === 0) offset++;
  }
  return null;
}
