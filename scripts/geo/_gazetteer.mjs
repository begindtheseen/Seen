// Shared by the lib/geo/data builders: fetch a Census file into memory (never written to disk as received),
// and strict validators for every field read from it. A builder writes only values these validators passed.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const CENSUS = /^https:\/\/www2\.census\.gov\//;

/** The text of a Census download (a single-file .zip is unpacked in memory with funzip), or of a local --from copy. */
export async function censusText(url, localPath = null, encoding = 'utf8') {
  if (localPath) return readFileSync(localPath, encoding);
  if (!CENSUS.test(url)) throw new Error(`not a Census URL: ${url}`);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 50 * 1024 * 1024) throw new Error(`${url}: ${buf.length} bytes — larger than any Census file this expects`);
  const raw = url.endsWith('.zip') ? execFileSync('funzip', [], { input: buf, maxBuffer: 200 * 1024 * 1024 }) : buf;
  return raw.toString(encoding);
}

export const STATE_RE = /^[A-Z]{2}$/;
export const NAME_RE = /^[\p{L}\p{M}0-9 .,&'’()/-]{1,100}$/u;
export const FIPS_RE = /^\d{2,5}$/;
const NUM_RE = /^[-+]?\d{1,3}(?:\.\d{1,8})?$/;

/** A US latitude/longitude pair (50 states, DC, PR, territories' longitudes), else null. */
export function usPoint(lat, lng) {
  if (!NUM_RE.test(String(lat)) || !NUM_RE.test(String(lng))) return null;
  const a = Number(lat), b = Number(lng);
  if (!(a >= 13 && a <= 72) || !((b >= -180 && b <= -64) || (b >= 140 && b <= 180))) return null;
  return [Math.round(a * 1000) / 1000, Math.round(b * 1000) / 1000];
}

/** Throws unless `n` is within [min, max] — a file of an unexpected size is not written. */
export function expectCount(label, n, min, max) {
  if (!(n >= min && n <= max)) throw new Error(`${label}: ${n} rows, expected ${min}–${max} — refusing to write`);
}

/** A name with stray control bytes removed (the Census CSV carries one for "Utqiaġvik"), then validated. */
export function cleanName(raw) {
  const s = String(raw || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return NAME_RE.test(s) ? s : null;
}
