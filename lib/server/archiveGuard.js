// Decompression-bomb guard for untrusted uploads (DOCX = a zip; PDF = compressed streams).
//
// ONE budget per upload: every byte actually decompressed — every zip entry read, every PDF stream
// inflated — is charged against the same cap, and every step checks the same deadline. Nothing
// trusts a header: zip entries are inflated with Node's `maxOutputLength`, which stops zlib the
// moment the output would pass what is left of the budget, and the real size + CRC are compared
// with what the central directory claimed. The structure is validated BEFORE anything is
// decompressed (entry count, names, encryption, compression method, symlinks, duplicates, ZIP64,
// bounds, declared ratio).
//
// Limits mirror security/zip_guard (the Python reference, README there explains each one):
//   10 MB decompressed per DOCX upload · 1,000 entries · 100:1 ratio past 256 KB · 5 s deadline.
// PDFs get a larger byte budget (pdfMaxBytes) because they legitimately carry fonts and images
// that inflate several MB; see lib/resume/extract/pdf.js for the PDF side (time budget, page cap,
// worker isolation).
//
// Rejections are ArchiveRejected errors: a machine `code`, an honest user-facing message, and an
// internal `detail` for logs. Callers turn them into a 422 (lib/resume/extract/index.js).

import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { crc32 } from './zip.js';

const MiB = 1024 * 1024;

export const ARCHIVE_LIMITS = Object.freeze({
  maxBytes: 10 * MiB,        // actual decompressed bytes per DOCX upload, all entries read
  pdfMaxBytes: 24 * MiB,     // actual inflated stream bytes per PDF upload
  maxEntries: 1000,          // zip entries (a résumé .docx has ~10–40)
  maxRatio: 100,             // per entry, decompressed / compressed …
  ratioFloor: 256 * 1024,    // … once an entry is at least this large
  maxMs: 5000,               // one deadline per upload
  maxNameLength: 1024,
  maxPdfStreams: 5000,
});

const LIMIT_CODES = new Set([
  'uncompressed_size_exceeded', 'compression_ratio_exceeded', 'too_many_entries', 'time_exceeded',
  'nested_archive', 'memory_exceeded',
]);

const MESSAGES = {
  docx_limit: 'This file is too large to read once unpacked — save it again or upload a PDF.',
  docx_encrypted: 'This Word file is password-protected — remove the password and save it again, or upload a PDF.',
  docx_legacy: 'This looks like an older .doc or a password-protected Word file — save it as a .docx (with no password) or upload a PDF.',
  docx_damaged: 'This Word file looks damaged, so we couldn’t open it safely — save it again or upload a PDF.',
  pdf_limit: 'This PDF is too large to read once unpacked — save it again, or paste your résumé text instead.',
  pdf_time: 'This PDF took too long to read — save it again (File → Save as PDF), or paste your résumé text instead.',
};

export class ArchiveRejected extends Error {
  /**
   * @param {string} code    machine reason (uncompressed_size_exceeded, encrypted, unsafe_path, …)
   * @param {{ kind?: 'docx'|'pdf', detail?: string }} [opts]
   */
  constructor(code, { kind = 'docx', detail = '' } = {}) {
    super(`archive rejected: ${code}`);
    this.name = 'ArchiveRejected';
    this.code = code;
    this.kind = kind;
    this.detail = detail;
    this.status = 422;
    this.userMessage = userMessageFor(code, kind);
  }
}

export function userMessageFor(code, kind = 'docx') {
  if (kind === 'pdf') return code === 'time_exceeded' ? MESSAGES.pdf_time : MESSAGES.pdf_limit;
  if (LIMIT_CODES.has(code)) return MESSAGES.docx_limit;
  if (code === 'encrypted') return MESSAGES.docx_encrypted;
  if (code === 'ole_container') return MESSAGES.docx_legacy;
  return MESSAGES.docx_damaged;
}

export function isLimitCode(code) { return LIMIT_CODES.has(code); }

/**
 * One budget + one deadline for one upload. `now` is injectable for tests.
 * @returns {{ total: number, max: number, deadline: number, kind: string, remaining: () => number,
 *            check: () => void, charge: (n: number) => void }}
 */
export function createBudget({ maxBytes = ARCHIVE_LIMITS.maxBytes, maxMs = ARCHIVE_LIMITS.maxMs, kind = 'docx', now = Date.now, deadline } = {}) {
  const b = {
    total: 0, max: maxBytes, kind, now,
    deadline: Number.isFinite(deadline) ? deadline : now() + maxMs,
    remaining() { return Math.max(0, b.max - b.total); },
    check() {
      if (b.now() > b.deadline) throw new ArchiveRejected('time_exceeded', { kind: b.kind, detail: `deadline ${maxMs}ms` });
    },
    charge(n) {
      b.total += n;
      if (b.total > b.max) throw new ArchiveRejected('uncompressed_size_exceeded', { kind: b.kind, detail: `actual ${b.total}` });
    },
  };
  return b;
}

/**
 * Inflate `input` (raw deflate when `raw`, zlib-wrapped otherwise) charging the REAL output to
 * `budget`. zlib stops as soon as the output would pass what is left, so a bomb costs at most the
 * remaining budget, never its claimed size. Non-limit errors (bad data) are rethrown as-is.
 */
export function inflateCounted(input, budget, { raw = true, partial = false } = {}) {
  budget.check();
  const left = budget.remaining();
  const opts = { maxOutputLength: Math.max(1, left) };
  if (partial) opts.finishFlush = zlib.constants.Z_SYNC_FLUSH; // truncated streams yield what they have
  let out;
  try {
    out = raw ? zlib.inflateRawSync(input, opts) : zlib.inflateSync(input, opts);
  } catch (e) {
    if (e && (e.code === 'ERR_BUFFER_TOO_LARGE' || e instanceof RangeError)) {
      throw new ArchiveRejected('uncompressed_size_exceeded', { kind: budget.kind, detail: 'inflate cap' });
    }
    throw e;
  }
  budget.charge(out.length);
  budget.check();
  return out;
}

// ── ZIP ──────────────────────────────────────────────────────────────────────────────────────

const SIG_LOCAL = 0x04034b50, SIG_CENTRAL = 0x02014b50, SIG_EOCD = 0x06054b50;
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const S_IFMT = 0o170000, S_IFLNK = 0o120000, S_IFREG = 0o100000, S_IFDIR = 0o040000;

function damaged(detail) { return new ArchiveRejected('corrupt', { kind: 'docx', detail }); }

function findEocd(buf) {
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i--) if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  return -1;
}

// Validate one entry name: relative, no "..", no control characters, bounded.
function checkName(name) {
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(name)) throw new ArchiveRejected('unsafe_path', { detail: 'control character' });
  const norm = name.replace(/\\/g, '/');
  if (norm.startsWith('/') || /^[A-Za-z]:/.test(norm)) throw new ArchiveRejected('absolute_path');
  const parts = norm.split('/');
  if (parts.includes('..')) throw new ArchiveRejected('path_traversal');
  if (!parts.some((p) => p && p !== '.') || norm.length > ARCHIVE_LIMITS.maxNameLength) throw new ArchiveRejected('unsafe_path', { detail: 'empty or too long' });
}

/**
 * Validate a zip's whole structure without decompressing anything, and return a reader whose
 * reads all share `budget`.
 * @param {Buffer} buf
 * @param {{ budget?: ReturnType<typeof createBudget>, limits?: typeof ARCHIVE_LIMITS }} [opts]
 * @returns {{ names: string[], has: (name: string) => boolean, read: (name: string) => Buffer|null, budget: object }}
 */
export function openZip(buf, opts = {}) {
  // Any out-of-bounds read on a malformed file is "damaged", never an unhandled 500.
  const guard = (fn) => (...args) => {
    try { return fn(...args); } catch (e) {
      if (e instanceof ArchiveRejected) throw e;
      throw damaged(`parse: ${e && e.code || (e && e.name) || 'error'}`);
    }
  };
  const zip = guard(parseZip)(buf, opts);
  return { ...zip, read: guard(zip.read) };
}

function parseZip(buf, { budget = createBudget(), limits = ARCHIVE_LIMITS } = {}) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  budget.check();
  if (buf.length >= 8 && buf.subarray(0, 8).equals(OLE_MAGIC)) throw new ArchiveRejected('ole_container');
  if (buf.length < 22 || buf.readUInt32LE(0) !== SIG_LOCAL) throw new ArchiveRejected('not_a_zip');
  const eocd = findEocd(buf);
  if (eocd < 0) throw new ArchiveRejected('not_a_zip', { detail: 'no end of central directory' });
  const diskNo = buf.readUInt16LE(eocd + 4), cdDisk = buf.readUInt16LE(eocd + 6);
  const declaredCount = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12), cdOff = buf.readUInt32LE(eocd + 16);
  if (diskNo !== 0 || cdDisk !== 0) throw damaged('multi-disk');
  if (declaredCount === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) throw damaged('zip64');
  if (declaredCount > limits.maxEntries) throw new ArchiveRejected('too_many_entries', { detail: `${declaredCount} declared` });
  if (cdOff + cdSize > eocd) throw damaged('central directory out of bounds');

  const entries = new Map();
  const folded = new Set();
  let p = cdOff;
  const cdEnd = cdOff + cdSize;
  while (p < cdEnd) {
    if (entries.size >= limits.maxEntries) throw new ArchiveRejected('too_many_entries', { detail: 'central directory' });
    if (p + 46 > cdEnd || buf.readUInt32LE(p) !== SIG_CENTRAL) throw damaged('central directory record');
    const madeBy = buf.readUInt16LE(p + 4);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), cmtLen = buf.readUInt16LE(p + 32);
    const extAttr = buf.readUInt32LE(p + 38);
    const localOff = buf.readUInt32LE(p + 42);
    if (p + 46 + nameLen + extraLen + cmtLen > cdEnd) throw damaged('central directory name');
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    checkName(name);
    if (flags & 0x0041) throw new ArchiveRejected('encrypted');                  // bit 0 / bit 6
    if (method !== 0 && method !== 8) throw new ArchiveRejected('unsupported_compression', { detail: `method ${method}` });
    if (compSize === 0xffffffff || size === 0xffffffff || localOff === 0xffffffff) throw damaged('zip64 entry');
    const mode = (extAttr >>> 16) & 0xffff;
    if ((madeBy >> 8) === 3) {                                                    // unix attributes
      const kind = mode & S_IFMT;
      if (kind === S_IFLNK) throw new ArchiveRejected('symlink');
      if (kind && kind !== S_IFREG && kind !== S_IFDIR) throw new ArchiveRejected('special_file');
    }
    if (size >= limits.ratioFloor && size > limits.maxRatio * Math.max(compSize, 1)) {
      throw new ArchiveRejected('compression_ratio_exceeded', { detail: 'declared' });
    }
    const key = name.replace(/\\/g, '/').toLowerCase();
    if (folded.has(key)) throw new ArchiveRejected('duplicate_name');
    folded.add(key);
    if (localOff + 30 > cdOff) throw damaged('local header out of bounds');
    entries.set(name, { name, flags, method, crc, compSize, size, localOff });
    p += 46 + nameLen + extraLen + cmtLen;
  }
  if (entries.size !== declaredCount) throw damaged('entry count mismatch');

  function read(name) {
    const e = entries.get(name);
    if (!e) return null;
    budget.check();
    if (budget.total + e.size > budget.max) {                                     // fast pre-check
      throw new ArchiveRejected('uncompressed_size_exceeded', { detail: 'declared' });
    }
    const lo = e.localOff;
    if (buf.readUInt32LE(lo) !== SIG_LOCAL) throw damaged('local header');
    const lNameLen = buf.readUInt16LE(lo + 26), lExtraLen = buf.readUInt16LE(lo + 28);
    if (buf.subarray(lo + 30, lo + 30 + lNameLen).toString('utf8') !== e.name) throw damaged('local name differs');
    if (buf.readUInt16LE(lo + 6) & 0x0041) throw new ArchiveRejected('encrypted');
    const start = lo + 30 + lNameLen + lExtraLen;
    if (start + e.compSize > cdOff) throw damaged('entry data out of bounds');
    const comp = buf.subarray(start, start + e.compSize);
    let out;
    if (e.method === 0) {
      out = comp;
      budget.charge(out.length);
    } else {
      try { out = inflateCounted(comp, budget, { raw: true }); }
      catch (err) { if (err instanceof ArchiveRejected) throw err; throw damaged(`inflate: ${err && err.code || 'error'}`); }
    }
    if (out.length !== e.size) throw new ArchiveRejected('header_mismatch', { detail: `declared ${e.size} actual ${out.length}` });
    if ((crc32(out) >>> 0) !== (e.crc >>> 0)) throw damaged('crc mismatch');
    if (out.length >= limits.ratioFloor && out.length > limits.maxRatio * Math.max(e.compSize, 1)) {
      throw new ArchiveRejected('compression_ratio_exceeded', { detail: 'actual' });
    }
    // A zip inside a part we read is never opened — a DOCX part is XML, not an archive.
    if (out.length >= 4 && out.readUInt32LE(0) === SIG_LOCAL) throw new ArchiveRejected('nested_archive');
    budget.check();
    return out;
  }

  return { names: [...entries.keys()], has: (n) => entries.has(n), read, budget };
}

// ── Monitoring ───────────────────────────────────────────────────────────────────────────────

// Printable, single line, truncated: safe inside a log line.
export function logSafeValue(v, max = 120) {
  // eslint-disable-next-line no-control-regex
  const s = String(v == null ? '' : v).replace(/\n|\r/g, ' ').replace(/[\x00-\x1f\x7f\u2028\u2029]/g, '?');
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/** One structured line per rejected upload. Never the file's contents; the name is sanitized. */
export function logArchiveRejection({ err, buffer, fileName, fileType, ms }) {
  const record = {
    event: 'upload_rejected',
    code: logSafeValue(err && err.code, 40),
    kind: logSafeValue(err && err.kind, 10),
    detail: logSafeValue(err && err.detail, 120),
    file_type: logSafeValue(fileType, 10),
    file_ext: logSafeValue((String(fileName || '').match(/\.[A-Za-z0-9]{1,8}$/) || [''])[0], 10),
    bytes: buffer ? buffer.length : 0,
    sha256: buffer ? createHash('sha256').update(buffer).digest('hex').slice(0, 16) : null,
    ms: Number.isFinite(ms) ? Math.round(ms) : null,
  };
  console.warn('[archive-guard] %s', JSON.stringify(record).replace(/\n|\r/g, ''));
}
