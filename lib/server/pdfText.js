// Best-effort, keyless PDF text extraction.
//
// We have no PDF library available (and the project forbids paid/LLM extraction
// services), so this does a native pass over the PDF byte stream:
//   1. Inflate any FlateDecode content streams (most PDFs compress text).
//   2. Parse any /ToUnicode CMaps so subset-font glyph codes map to real Unicode
//      (without this, subset fonts extract as a shifted/scrambled alphabet —
//      e.g. "gmail" comes out as "kqemp").
//   3. Pull text-showing operators from the content streams:
//        (string) Tj      [ (a) (b) ] TJ
//   4. Decode PDF string escapes, remap through ToUnicode, join into readable text.
//
// This handles the common case (résumés exported from Word/Google Docs/Pages,
// which embed real, selectable text) AND the subset-font case (via ToUnicode).
// It will NOT handle scanned-image PDFs or subset fonts that ship no ToUnicode —
// for those the caller returns a clean "paste your text" error rather than
// storing scrambled output (see looksLikeGarbledText).

//
// Every stream is attacker-controlled compressed data (a 51 KB PDF can inflate to gigabytes). All
// inflation goes through the archive guard (lib/server/archiveGuard.js): ONE byte budget for the
// whole file, counted from the REAL output with zlib's maxOutputLength, one deadline, and a cap on
// the number of streams. Hitting a limit throws ArchiveRejected (kind 'pdf') — it is never
// swallowed into the "no text" fallback.

import { ARCHIVE_LIMITS, ArchiveRejected, createBudget, inflateCounted } from './archiveGuard.js';

// Decode a PDF literal string body (the bytes between '(' and ')'), handling
// the standard backslash escapes and balanced parentheses.
function decodePdfString(raw) {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '\\') {
      const n = raw[i + 1];
      if (n === 'n') { out += '\n'; i++; }
      else if (n === 'r') { out += '\r'; i++; }
      else if (n === 't') { out += '\t'; i++; }
      else if (n === 'b') { out += '\b'; i++; }
      else if (n === 'f') { out += '\f'; i++; }
      else if (n === '(' || n === ')' || n === '\\') { out += n; i++; }
      else if (n >= '0' && n <= '7') {
        // octal char code, up to 3 digits
        let oct = '';
        let j = i + 1;
        while (j < raw.length && oct.length < 3 && raw[j] >= '0' && raw[j] <= '7') { oct += raw[j]; j++; }
        out += String.fromCharCode(parseInt(oct, 8));
        i = j - 1;
      } else if (n === '\n') { i++; } // line continuation
      else { out += n; i++; }
    } else {
      out += c;
    }
  }
  return out;
}

// Decode a PDF hex string body (between '<' and '>') to characters. Keeps the raw
// byte codes 1:1 — a ToUnicode map (if present) is applied later by applyToUnicode.
function decodeHexString(hex) {
  let h = hex.replace(/[^0-9a-fA-F]/g, '');
  if (h.length % 2) h += '0';
  let out = '';
  for (let i = 0; i < h.length; i += 2) {
    const code = parseInt(h.substr(i, 2), 16);
    if (code === 0) continue;
    out += String.fromCharCode(code);
  }
  return out;
}

// Read a literal ( ... ) string starting at index i ('(' at i). Returns
// { text, next } where next is the index just past the closing ')'.
function readLiteral(content, i) {
  const len = content.length;
  let depth = 1;
  let j = i + 1;
  let raw = '';
  while (j < len && depth > 0) {
    const cj = content[j];
    if (cj === '\\') { raw += cj + (content[j + 1] || ''); j += 2; continue; }
    if (cj === '(') { depth++; raw += cj; j++; continue; }
    if (cj === ')') { depth--; if (depth === 0) break; raw += cj; j++; continue; }
    raw += cj;
    j++;
  }
  return { text: decodePdfString(raw), next: j + 1 };
}

// Read a hex < ... > string starting at index i ('<' at i). Returns { text, next }.
function readHex(content, i) {
  const end = content.indexOf('>', i + 1);
  if (end === -1) return { text: '', next: i + 1 };
  return { text: decodeHexString(content.slice(i + 1, end)), next: end + 1 };
}

// ── ToUnicode CMap support ───────────────────────────────────────────────────
// A subset font's content-stream strings hold GLYPH CODES, not Unicode. The font's
// /ToUnicode CMap maps those codes to real characters. Parsing it is what turns
// scrambled subset-font text back into readable words.

// Convert a ToUnicode destination hex (UTF-16BE, 4 hex digits per code unit) to a JS string.
function hexToUnicode(hex) {
  const h = String(hex).replace(/[^0-9A-Fa-f]/g, '');
  if (h.length <= 2) return String.fromCharCode(parseInt(h || '0', 16));
  let out = '';
  for (let i = 0; i + 4 <= h.length; i += 4) out += String.fromCharCode(parseInt(h.substr(i, 4), 16));
  return out;
}

// Parse every ToUnicode CMap found across the inflated streams into one merged
// code→string map. Returns { map, width } where width is the source code byte-width
// (1 for most subset latin fonts, 2 for CID fonts).
function parseToUnicode(cmapStreams) {
  const map = new Map();
  let width = 1;
  for (const s of cmapStreams) {
    // bfchar: <src> <dst> pairs
    let block;
    const charRe = /beginbfchar([\s\S]*?)endbfchar/g;
    while ((block = charRe.exec(s))) {
      const pairRe = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
      let p;
      while ((p = pairRe.exec(block[1]))) {
        if (p[1].length > 2) width = 2;
        map.set(parseInt(p[1], 16), hexToUnicode(p[2]));
      }
    }
    // bfrange: <lo> <hi> <dstBase>   OR   <lo> <hi> [ <d0> <d1> ... ]
    const rangeRe = /beginbfrange([\s\S]*?)endbfrange/g;
    while ((block = rangeRe.exec(s))) {
      const lineRe = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(\[[\s\S]*?\]|<[0-9A-Fa-f]+>)/g;
      let r;
      while ((r = lineRe.exec(block[1]))) {
        if (r[1].length > 2) width = 2;
        const lo = parseInt(r[1], 16), hi = parseInt(r[2], 16);
        if (hi - lo > 65535 || hi < lo) continue;
        if (r[3][0] === '[') {
          const items = r[3].match(/<([0-9A-Fa-f]+)>/g) || [];
          for (let k = 0; k <= hi - lo && k < items.length; k++) {
            map.set(lo + k, hexToUnicode(items[k].replace(/[<>]/g, '')));
          }
        } else {
          const baseHex = r[3].replace(/[<>]/g, '');
          const base = parseInt(baseHex.slice(-4), 16);
          const prefix = baseHex.length > 4 ? hexToUnicode(baseHex.slice(0, -4)) : '';
          for (let k = 0; lo + k <= hi; k++) map.set(lo + k, prefix + String.fromCharCode(base + k));
        }
      }
    }
  }
  return { map, width };
}

// Remap a decoded string's raw glyph codes through a ToUnicode map. Unmapped codes
// pass through unchanged (so mixed/standard fonts degrade to their original bytes).
function applyToUnicode(str, toUni) {
  const { map, width } = toUni;
  if (!map || !map.size) return str;
  let out = '';
  if (width === 2) {
    for (let k = 0; k + 1 < str.length; k += 2) {
      const code = (str.charCodeAt(k) << 8) | str.charCodeAt(k + 1);
      const u = map.get(code);
      out += (u != null) ? u : (str[k] + (str[k + 1] || ''));
    }
  } else {
    for (let k = 0; k < str.length; k++) {
      const u = map.get(str.charCodeAt(k));
      out += (u != null) ? u : str[k];
    }
  }
  return out;
}

// Extract text from a single decoded content-stream string. Handles literal
// (...) strings, hex <...> strings, and TJ arrays containing either. When a
// ToUnicode map is supplied, every string piece is remapped through it.
function textFromContentStream(content, toUni) {
  const remap = (t) => (toUni && toUni.map && toUni.map.size ? applyToUnicode(t, toUni) : t);
  let result = '';
  let i = 0;
  const len = content.length;

  while (i < len) {
    const ch = content[i];

    if (ch === '(') {
      const r = readLiteral(content, i);
      result += remap(r.text);
      i = r.next;
      continue;
    }

    // Hex string — but skip '<<' dict markers.
    if (ch === '<' && content[i + 1] !== '<') {
      const r = readHex(content, i);
      result += remap(r.text);
      i = r.next;
      continue;
    }

    // Array for TJ: [ (a) -250 <62> ] — pull every string piece (literal or hex).
    if (ch === '[') {
      let j = i + 1;
      while (j < len && content[j] !== ']') {
        if (content[j] === '(') { const r = readLiteral(content, j); result += remap(r.text); j = r.next; }
        else if (content[j] === '<' && content[j + 1] !== '<') { const r = readHex(content, j); result += remap(r.text); j = r.next; }
        else j++;
      }
      i = j + 1;
      continue;
    }

    // Line/paragraph breaks from text-positioning operators. Tm/Td/TD/T*
    // each start a new text line in most generators, so emit a newline.
    if (ch === 'T') {
      const op = content.slice(i, i + 2);
      if (op === 'Td' || op === 'TD' || op === 'Tm' || op === 'T*') {
        if (result && !result.endsWith('\n')) result += '\n';
      }
      i += 2;
      continue;
    }

    i++;
  }
  return result;
}

// The dictionary text just before a `stream` keyword (bounded look-back), for cheap sniffing.
function streamDict(buffer, start) {
  const from = Math.max(0, start - 1024);
  const head = buffer.subarray(from, start).toString('latin1');
  const obj = head.lastIndexOf(' obj');
  return obj >= 0 ? head.slice(obj) : head;
}

// Streams that never hold text operators or CMaps: image data, font programs, xref/object
// streams, XML metadata. The text extractor skips them (they only cost budget). The pre-scan
// below does NOT skip them — a dictionary can lie about what a stream is used for.
const NON_TEXT_STREAM_RE = /\/Subtype\s*\/(?:Image|Type1C|CIDFontType0C|OpenType|XML)\b|\/Length[123]\b|\/Type\s*\/(?:XRef|ObjStm|Metadata)\b/;

// ASCIIHex / ASCII85 wrappers in front of Flate are decoded so their payload is measured too.
function decodeAsciiHex(buf) {
  const hex = buf.toString('latin1').replace(/>[\s\S]*$/, '').replace(/[^0-9a-fA-F]/g, '');
  return Buffer.from(hex.length % 2 ? hex + '0' : hex, 'hex');
}
function decodeAscii85(buf) {
  const src = buf.toString('latin1').replace(/^\s*<~/, '').replace(/~>[\s\S]*$/, '').replace(/\s+/g, '');
  const out = [];
  let group = [];
  for (const ch of src) {
    if (ch === 'z' && group.length === 0) { out.push(0, 0, 0, 0); continue; }
    const c = ch.charCodeAt(0) - 33;
    if (c < 0 || c > 84) return Buffer.alloc(0);
    group.push(c);
    if (group.length === 5) {
      let v = 0; for (const g of group) v = v * 85 + g;
      out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
      group = [];
    }
  }
  if (group.length > 1) {
    const n = group.length;
    while (group.length < 5) group.push(84);
    let v = 0; for (const g of group) v = v * 85 + g;
    out.push(...[(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].slice(0, n - 1));
  }
  return Buffer.from(out);
}

// Inflate one stream body against the budget: zlib-wrapped first, then raw deflate, then (when the
// dictionary names one) an ASCII wrapper in front of Flate. Returns null when it is not Flate data.
function inflateOne(chunk, dict, budget, { partial }) {
  const attempt = (data) => {
    try { return inflateCounted(data, budget, { raw: false, partial }); }
    catch (e) { if (e instanceof ArchiveRejected) throw e; }
    try { return inflateCounted(data, budget, { raw: true, partial }); }
    catch (e) { if (e instanceof ArchiveRejected) throw e; }
    return null;
  };
  const direct = attempt(chunk);
  if (direct || !dict) return direct;
  if (/\/(?:ASCIIHexDecode|AHx)\b/.test(dict) && /\/(?:FlateDecode|Fl)\b/.test(dict)) return attempt(decodeAsciiHex(chunk));
  if (/\/(?:ASCII85Decode|A85)\b/.test(dict) && /\/(?:FlateDecode|Fl)\b/.test(dict)) return attempt(decodeAscii85(chunk));
  return null;
}

// Walk every stream...endstream block. `fn(chunk, dict)` per stream; bounded by the stream cap and
// the budget's deadline.
function forEachStream(buffer, budget, fn) {
  let pos = 0, count = 0;
  const needle = Buffer.from('stream');
  const endNeedle = Buffer.from('endstream');
  while (pos < buffer.length) {
    const start = buffer.indexOf(needle, pos);
    if (start === -1) break;
    // 'stream' keyword is followed by CRLF or LF
    let dataStart = start + needle.length;
    if (buffer[dataStart] === 0x0d) dataStart++;
    if (buffer[dataStart] === 0x0a) dataStart++;
    const end = buffer.indexOf(endNeedle, dataStart);
    if (end === -1) break;
    let dataEnd = end;
    // trim trailing EOL before endstream
    if (buffer[dataEnd - 1] === 0x0a) dataEnd--;
    if (buffer[dataEnd - 1] === 0x0d) dataEnd--;
    if (++count > ARCHIVE_LIMITS.maxPdfStreams) throw new ArchiveRejected('too_many_entries', { kind: 'pdf', detail: 'streams' });
    budget.check();
    fn(buffer.subarray(dataStart, Math.max(dataStart, dataEnd)), () => streamDict(buffer, start));
    pos = end + endNeedle.length;
  }
}

/**
 * Pre-scan: inflate EVERY Flate stream (images and fonts included) against `budget`, keeping
 * nothing. Run before pdf.js sees the file so a decompression bomb is refused while it is still
 * cheap. Throws ArchiveRejected (kind 'pdf') past the budget, the deadline or the stream cap.
 * @returns {{ inflatedBytes: number, streams: number }}
 */
export function measurePdfStreams(buffer, budget = createBudget({ kind: 'pdf', maxBytes: ARCHIVE_LIMITS.pdfMaxBytes })) {
  let streams = 0;
  forEachStream(buffer, budget, (chunk, dict) => {
    streams++;
    inflateOne(chunk, null, budget, { partial: true }) || inflateOne(chunk, dict(), budget, { partial: true });
  });
  return { inflatedBytes: budget.total, streams };
}

// Find and inflate every text-bearing stream, returning the decoded strings.
function inflateStreams(buffer, budget) {
  const streams = [];
  forEachStream(buffer, budget, (chunk, dictOf) => {
    const dict = dictOf();
    if (NON_TEXT_STREAM_RE.test(dict)) return;
    const decoded = inflateOne(chunk, dict, budget, { partial: false });
    if (decoded) streams.push(decoded.toString('latin1'));
    else {
      // Maybe an uncompressed content or CMap stream — keep if it looks useful.
      const asText = chunk.toString('latin1');
      if (/\bTj\b|\bTJ\b|\bBT\b|beginbfchar|beginbfrange/.test(asText)) streams.push(asText);
    }
  });
  return streams;
}

// Public: extract plain text from a PDF buffer. Returns '' if nothing readable.
// Pass `{ deadline }` (ms since epoch) to share an upload's deadline; throws ArchiveRejected when
// the file passes the byte budget, the stream cap or the deadline.
export async function extractPdfText(buffer, { deadline, maxBytes = ARCHIVE_LIMITS.pdfMaxBytes } = {}) {
  let text = '';
  const budget = createBudget({ kind: 'pdf', maxBytes, deadline });
  try {
    const streams = inflateStreams(buffer, budget);
    const cmapStreams = streams.filter(s => /beginbfchar|beginbfrange/.test(s));
    const contentStreams = streams.filter(s => /\bTj\b|\bTJ\b/.test(s));
    const toUni = parseToUnicode(cmapStreams);

    // Extract once raw and — when a ToUnicode map exists — once remapped, then keep
    // whichever reads more like real prose. This fixes subset-font scrambling without
    // regressing standard fonts (where the raw pass already wins or ties).
    const rawText = contentStreams.map(s => textFromContentStream(s, null)).join('\n');
    if (toUni.map.size) {
      const mappedText = contentStreams.map(s => textFromContentStream(s, toUni)).join('\n');
      text = readabilityScore(mappedText) >= readabilityScore(rawText) ? mappedText : rawText;
    } else {
      text = rawText;
    }
  } catch (e) {
    if (e instanceof ArchiveRejected) throw e; // a limit is a rejection, never "try the fallback"
    /* otherwise fall through to fallback */
  }

  // Fallback: scan the raw buffer for parenthesised literals if streams gave
  // us little (handles uncompressed PDFs we missed above).
  if (text.replace(/\s/g, '').length < 40) {
    try {
      const raw = buffer.toString('latin1');
      const matches = raw.match(/\(((?:\\.|[^()\\])*)\)/g);
      if (matches) {
        text = matches.map(m => decodePdfString(m.slice(1, -1))).join(' ');
      }
    } catch { /* give up gracefully */ }
  }

  return cleanupText(text);
}

// Words that appear in almost any English résumé — used both to pick the better
// extraction pass and to flag scrambled output the caller should reject.
const COMMON_WORDS_RE = /\b(the|and|for|with|from|that|this|will|have|are|was|work|team|experience|management|manager|project|skills|education|company|customer|service|years|university|college|developed|managed|support|responsible|including|business|communication|email|phone|present|current|january|february|march|april|june|july|august|september|october|november|december)\b/gi;

// How much a string reads like real prose — count of common-word hits. Used to
// choose between the raw and ToUnicode-remapped extraction passes.
function readabilityScore(t) {
  if (!t) return 0;
  return (t.match(COMMON_WORDS_RE) || []).length;
}

// True when text is substantial yet reads as scrambled glyph output (a subset font
// with no usable ToUnicode). The caller uses this to return a clean "paste your
// text" error instead of storing gibberish that silently breaks downstream parsing.
export function looksLikeGarbledText(text) {
  const s = String(text || '');
  if (s.length < 200) return false; // too short to judge — length gate handles it
  const commonWords = (s.match(COMMON_WORDS_RE) || []).length;
  const spaces = (s.match(/\s/g) || []).length;
  const spaceRatio = spaces / s.length;
  // Real résumé prose hits common words and breaks into words (~1 space / 5–8 chars).
  // Scrambled subset-font output has neither: no recognizable words and almost no spaces.
  return commonWords === 0 && spaceRatio < 0.06;
}

function cleanupText(text) {
  return String(text || '')
    .replace(/ /g, '')   // strip NULs — Postgres text columns reject them outright
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .trim();
}
