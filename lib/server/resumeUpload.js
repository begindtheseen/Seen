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
import { isReadableResume } from './resumeReadability.js';

const inflateRaw = promisify(zlib.inflateRaw);

export async function extractUploadText({ base64, fileName, mimeType }) {
  if (!base64) return { ok: false, status: 400, error: 'No file data provided' };
  if (typeof base64 !== 'string' || base64.length > 14_000_000) {
    return { ok: false, status: 400, error: 'File too large. Max 10MB.' };
  }
  const fileBuffer = Buffer.from(base64, 'base64');
  // Layout-aware extraction (lib/resume/extract): PDF geometry → columns/lines, DOCX styles/bullets,
  // plain text. Same quality gates as before (length, garbled, readability) live in there now.
  const { extractResumeFile } = await import('../resume/extract/index.js');
  return extractResumeFile({ buffer: fileBuffer, fileName, mimeType });
}

// Legacy plain-text .docx reader — kept for callers that only need text (and as the structured
// extractor's reference behaviour in tests).
async function extractDocxText(buffer) {
  try {
    const xml = await readZipEntry(buffer, 'word/document.xml');
    if (!xml) return '';
    let result = '';
    const paragraphs = xml.split(/<\/w:p>/);
    for (const para of paragraphs) {
      // The text of each <w:t> run is its captured content — no tag stripping, no HTML semantics.
      const paraText = Array.from(para.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g), (m) => decodeEntities(m[1]))
        .join('').trim();
      if (paraText) result += paraText + '\n';
    }
    return result.trim();
  } catch (e) { return ''; }
}

// Read a single ZIP entry's decompressed bytes. Prefer the CENTRAL DIRECTORY (authoritative for
// every entry's compressed size + local offset) so entries written with a streaming DATA
// DESCRIPTOR — local header flag bit 3 set, sizes left 0, which is how Microsoft Word writes
// .docx — are read correctly. A local-header-only walk reads compressedSize=0 for those, slices
// zero bytes, and extracts nothing (the "couldn't read this résumé" 422). Fall back to the local
// walk only when the central directory can't be used (unusual layouts / leading bytes).
export async function readZipEntry(buffer, targetName) {
  try {
    const viaCd = await readZipEntryViaCentralDir(buffer, targetName);
    if (viaCd != null) return viaCd;
  } catch { /* fall through to the local-header walk */ }
  return readZipEntryLocalWalk(buffer, targetName);
}

function findEocdOffset(buffer) {
  // End-of-central-directory signature 0x06054b50, in the last 22 bytes + up to a 65535B comment.
  const min = Math.max(0, buffer.length - 22 - 0xffff);
  for (let i = buffer.length - 22; i >= min; i--) {
    if (i >= 0 && i + 4 <= buffer.length && buffer.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

async function readZipEntryViaCentralDir(buffer, targetName) {
  const eocd = findEocdOffset(buffer);
  if (eocd < 0) return null;
  let p = buffer.readUInt32LE(eocd + 16);                                   // CD start offset
  const cdEnd = Math.min(buffer.length - 4, p + buffer.readUInt32LE(eocd + 12));
  while (p >= 0 && p <= cdEnd && buffer.readUInt32LE(p) === 0x02014b50) {   // central-dir header
    const method   = buffer.readUInt16LE(p + 10);
    const compSize = buffer.readUInt32LE(p + 20);
    const nameLen  = buffer.readUInt16LE(p + 28);
    const extraLen = buffer.readUInt16LE(p + 30);
    const cmtLen   = buffer.readUInt16LE(p + 32);
    const localOff = buffer.readUInt32LE(p + 42);
    const name     = buffer.slice(p + 46, p + 46 + nameLen).toString('utf8');
    if (name === targetName) {
      // Locate the data via the LOCAL header (its name/extra lengths can differ from the CD's).
      if (localOff + 30 > buffer.length || buffer.readUInt32LE(localOff) !== 0x04034b50) return null;
      const dataStart = localOff + 30 + buffer.readUInt16LE(localOff + 26) + buffer.readUInt16LE(localOff + 28);
      const compressed = buffer.slice(dataStart, dataStart + compSize);
      if (method === 0) return compressed.toString('utf8');
      if (method === 8) return (await inflateRaw(compressed)).toString('utf8');
      return null;
    }
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return null;
}

async function readZipEntryLocalWalk(buffer, targetName) {
  let offset = 0;
  while (offset < buffer.length - 30) {
    if (buffer[offset] !== 0x50 || buffer[offset + 1] !== 0x4B || buffer[offset + 2] !== 0x03 || buffer[offset + 3] !== 0x04) { offset++; continue; }
    const compression  = buffer.readUInt16LE(offset + 8);
    const compressedSz = buffer.readUInt32LE(offset + 18);
    const nameLen      = buffer.readUInt16LE(offset + 26);
    const extraLen     = buffer.readUInt16LE(offset + 28);
    const entryName    = buffer.slice(offset + 30, offset + 30 + nameLen).toString('utf8');
    const dataStart    = offset + 30 + nameLen + extraLen;
    if (entryName === targetName && compressedSz > 0) {
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

// One-pass XML entity decode ("&amp;lt;" → "&lt;", never double-unescaped).
const ENTITY = { amp: '&', lt: '<', gt: '>', apos: "'", quot: '"' };
function decodeEntities(s) {
  return String(s || '').replace(/&(amp|lt|gt|apos|quot);/g, (_, e) => ENTITY[e]);
}
