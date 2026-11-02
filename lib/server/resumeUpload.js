// Résumé upload → text extraction (keyless, deterministic).
//
// Extracted from api/resume.js handleParseResume so the file-decoding + quality gates are
// unit-testable. Supports PDF (native best-effort), Word (.docx/.doc), and plain text
// (.txt/.md). Applies the SAME quality gates to every format: a minimum length gate and the
// garbled-glyph check, so downstream (résumé survey, SeenFit) never receives gibberish.
//
// Returns { ok:true, text, fileType, wordCount } or { ok:false, status, error } — the caller
// (api/resume.js) maps that straight onto the HTTP response.

import { openZip, ArchiveRejected } from './archiveGuard.js';

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


// Read a single ZIP entry's decompressed bytes as UTF-8, through the archive guard
// (lib/server/archiveGuard.js): the CENTRAL DIRECTORY is authoritative for every entry's sizes and
// offset (Word writes entries with a streaming data descriptor — local sizes left 0), the whole
// structure is validated before anything is inflated, and inflation is capped by the upload's
// shared budget (pass the same `budget` for every entry of one upload). Returns null when the
// entry is absent or the buffer is not a zip at all; throws ArchiveRejected for anything unsafe
// (bomb, encryption, traversal, damage). There is deliberately no local-header-walk fallback: it
// is the path that ignores the central directory, and with it the only size table that is checked.
export async function readZipEntry(buffer, targetName, { budget } = {}) {
  let zip;
  try {
    zip = openZip(buffer, budget ? { budget } : {});
  } catch (e) {
    if (e instanceof ArchiveRejected && e.code === 'not_a_zip') return null;
    throw e;
  }
  const out = zip.read(targetName);
  return out == null ? null : out.toString('utf8');
}

