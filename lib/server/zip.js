// Minimal, dependency-free ZIP writer (deflate, method 8).
//
// The repo has no zip library and the house style favours dependency-light server utils, so this
// hand-rolls the small, well-specified subset of the ZIP format we need: one entry per file,
// DEFLATE-compressed via Node's built-in zlib, a local file header per entry, a central directory,
// and an end-of-central-directory record. Buffer-in / buffer-out — no streams — because the legal
// audit package is a handful of small files assembled once per request.
//
// Format reference: PKWARE APPNOTE.TXT (local file header 0x04034b50, central directory 0x02014b50,
// EOCD 0x06054b50). All multi-byte fields are little-endian. We use version-needed 20 and generic
// bit flags 0 (no encryption, standard deflate, no data descriptor since sizes are known upfront).

import { deflateRawSync } from 'zlib';

// CRC-32 (IEEE 802.3, polynomial 0xEDB88320) — the checksum ZIP stores per entry. Table built once.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Convert a JS Date to the DOS date/time words ZIP uses (2-second resolution). A fixed timestamp
// keeps the archive reproducible; the manifest/PDF carry the authoritative generated_at.
function dosDateTime(date) {
  const y = Math.max(1980, date.getUTCFullYear());
  const dosTime = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1);
  const dosDate = ((y - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  return { dosTime: dosTime & 0xffff, dosDate: dosDate & 0xffff };
}

/**
 * Build a ZIP archive.
 * @param {Array<{name: string, data: Buffer|string}>} entries
 * @param {Date} [date] fixed modification time for every entry (defaults to a stable epoch so the
 *   archive bytes are deterministic; do NOT pass `new Date()` if you want reproducibility).
 * @returns {Buffer}
 */
export function createZip(entries, date = new Date(0)) {
  const { dosTime, dosDate } = dosDateTime(date);
  const chunks = [];        // local headers + data, in order
  const central = [];       // central directory records
  let offset = 0;           // running offset of each local header

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8');
    const crc = crc32(data);
    const compressed = deflateRawSync(data);
    // Never let compression inflate a tiny file past its raw size — but for correctness we keep
    // method 8 regardless (readers handle a deflate stream that happens to be larger). Simplicity
    // over a byte or two.
    const method = 8;
    const body = compressed;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);   // local file header signature
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(0, 6);            // general purpose bit flag
    local.writeUInt16LE(method, 8);       // compression method
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18); // compressed size
    local.writeUInt32LE(data.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);           // extra field length
    chunks.push(local, nameBuf, body);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);      // central directory signature
    cd.writeUInt16LE(20, 4);              // version made by
    cd.writeUInt16LE(20, 6);              // version needed
    cd.writeUInt16LE(0, 8);               // flags
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(dosTime, 12);
    cd.writeUInt16LE(dosDate, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);              // extra length
    cd.writeUInt16LE(0, 32);              // comment length
    cd.writeUInt16LE(0, 34);              // disk number start
    cd.writeUInt16LE(0, 36);              // internal attrs
    cd.writeUInt32LE(0, 38);              // external attrs
    cd.writeUInt32LE(offset, 42);         // local header offset
    central.push(Buffer.concat([cd, nameBuf]));

    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);      // EOCD signature
  eocd.writeUInt16LE(0, 4);               // disk number
  eocd.writeUInt16LE(0, 6);               // disk with central dir
  eocd.writeUInt16LE(entries.length, 8);  // entries on this disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);         // offset of central directory
  eocd.writeUInt16LE(0, 20);              // comment length

  return Buffer.concat([...chunks, centralBuf, eocd]);
}
