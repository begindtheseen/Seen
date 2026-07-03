// Tests for the dependency-free ZIP writer.
// Run: node --test lib/server/zip.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';

import { createZip, crc32 } from './zip.js';

// Minimal central-directory reader: returns [{ name, data }] by parsing the archive we wrote.
function readZip(buf) {
  // Find EOCD (last 22 bytes when there's no comment).
  const eocd = buf.length - 22;
  assert.equal(buf.readUInt32LE(eocd), 0x06054b50, 'EOCD signature');
  const count = buf.readUInt16LE(eocd + 10);
  let cd = buf.readUInt32LE(eocd + 16); // central directory offset
  const out = [];
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(cd), 0x02014b50, 'central dir signature');
    const method = buf.readUInt16LE(cd + 10);
    const crcStored = buf.readUInt32LE(cd + 16);
    const compSize = buf.readUInt32LE(cd + 20);
    const nameLen = buf.readUInt16LE(cd + 28);
    const extraLen = buf.readUInt16LE(cd + 32);
    const commentLen = buf.readUInt16LE(cd + 34);
    const lho = buf.readUInt32LE(cd + 42);
    const name = buf.slice(cd + 46, cd + 46 + nameLen).toString('utf8');
    // Local header: 30 bytes fixed + name + extra, then data.
    assert.equal(buf.readUInt32LE(lho), 0x04034b50, 'local header signature');
    const lNameLen = buf.readUInt16LE(lho + 26);
    const lExtraLen = buf.readUInt16LE(lho + 28);
    const dataStart = lho + 30 + lNameLen + lExtraLen;
    const comp = buf.slice(dataStart, dataStart + compSize);
    const data = method === 8 ? inflateRawSync(comp) : comp;
    out.push({ name, data, crcStored });
    cd += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

test('produces a valid ZIP with the PK magic header', () => {
  const zip = createZip([{ name: 'x.txt', data: 'hello' }]);
  assert.equal(zip.subarray(0, 4).toString('latin1'), 'PK\x03\x04');
});

test('round-trips every entry byte-exact and CRC matches', () => {
  const entries = [
    { name: 'a.txt', data: Buffer.from('the quick brown fox '.repeat(50)) },
    { name: 'b.json', data: Buffer.from(JSON.stringify({ n: 42, s: 'café résumé — ✓', arr: [1, 2, 3] })) },
    { name: 'dir/c.bin', data: Buffer.from([0, 1, 2, 253, 254, 255, 0, 0, 0, 128]) },
    { name: 'empty.txt', data: Buffer.alloc(0) },
  ];
  const parsed = readZip(createZip(entries));
  assert.equal(parsed.length, entries.length, 'entry count');
  for (let i = 0; i < entries.length; i++) {
    const want = Buffer.isBuffer(entries[i].data) ? entries[i].data : Buffer.from(entries[i].data);
    assert.equal(parsed[i].name, entries[i].name, `name ${i}`);
    assert.ok(parsed[i].data.equals(want), `bytes round-trip for ${entries[i].name}`);
    assert.equal(parsed[i].crcStored, crc32(want), `stored CRC matches recomputed for ${entries[i].name}`);
  }
});

test('crc32 matches the known IEEE test vector for "123456789"', () => {
  // The canonical CRC-32 check value for the ASCII string "123456789" is 0xCBF43926.
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('central directory records exactly the entries passed', () => {
  const parsed = readZip(createZip([
    { name: 'company-audit.pdf', data: Buffer.from('%PDF-1.3 fake') },
    { name: 'company-audit-source.json', data: Buffer.from('{}') },
    { name: 'manifest.json', data: Buffer.from('{"ok":true}') },
  ]));
  assert.deepEqual(parsed.map(e => e.name), ['company-audit.pdf', 'company-audit-source.json', 'manifest.json']);
});
