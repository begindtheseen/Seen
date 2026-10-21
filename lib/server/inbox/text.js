// Email → plain text for the classifier. Pure, no I/O. The output is only ever matched against rules,
// never rendered, stored or sent anywhere.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…', middot: '·', bull: '•' };
const BLOCK = new Set(['p', 'div', 'br', 'tr', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'td', 'th', 'blockquote', 'section', 'article', 'header', 'footer', 'ul', 'ol', 'hr']);
const SKIP = new Set(['style', 'script', 'head', 'title']);

/** One pass over the HTML: tags become line breaks (block) or nothing (inline); style/script dropped. */
export function htmlToText(html) {
  const s = String(html || '');
  let out = '';
  let i = 0;
  let skipping = null;
  while (i < s.length) {
    const c = s[i];
    if (c === '<') {
      const end = s.indexOf('>', i + 1);
      if (end < 0) break; // an unclosed tag: the rest is markup, not text
      const inner = s.slice(i + 1, end).trim();
      i = end + 1;
      if (inner.startsWith('!--')) { // comment: jump past its real end
        const close = s.indexOf('-->', i - 1);
        i = close < 0 ? s.length : close + 3;
        continue;
      }
      const closing = inner.startsWith('/');
      const name = (closing ? inner.slice(1) : inner).split(/[\s/>]/)[0].toLowerCase();
      if (skipping) { if (closing && name === skipping) skipping = null; continue; }
      if (!closing && SKIP.has(name)) { skipping = name; continue; }
      if (BLOCK.has(name)) out += '\n';
      continue;
    }
    if (skipping) { i++; continue; }
    if (c === '&') {
      // Look at most 10 characters ahead (bounded — no rescan of the rest of the document).
      const rel = s.slice(i + 1, i + 11).indexOf(';');
      const semi = rel >= 0 ? i + 1 + rel : -1;
      if (semi > i) {
        const ent = s.slice(i + 1, semi);
        const decoded = decodeEntity(ent);
        if (decoded != null) { out += decoded; i = semi + 1; continue; }
      }
    }
    out += c;
    i++;
  }
  return tidy(out);
}

function decodeEntity(ent) {
  if (ent[0] === '#') {
    const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : null;
  }
  return Object.prototype.hasOwnProperty.call(ENTITIES, ent.toLowerCase()) ? ENTITIES[ent.toLowerCase()] : null;
}

/** Collapse whitespace per line, drop blank-line runs, normalize curly quotes for matching. */
export function tidy(t) {
  return String(t || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/ /g, ' ')
    .split('\n').map((l) => l.replace(/[ \t\f\v]+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The readable body of a received email: the text part when present, else the HTML flattened. */
export function bodyText(email) {
  const text = email && typeof email.text === 'string' && email.text.trim() ? tidy(email.text) : '';
  if (text) return text;
  return email && typeof email.html === 'string' ? htmlToText(email.html) : '';
}

/**
 * A manually forwarded email ("---------- Forwarded message ---------" in Gmail, "From: … Sent: …" in
 * Outlook) carries the employer's email inside the body. Returns { from, subject, body } of the inner
 * email, or null when there is none. A filter auto-forward keeps the original headers, so it has none.
 */
export function unwrapForward(body) {
  const b = String(body || '');
  const marker = b.search(/-{3,}\s*(?:forwarded message|original message)\s*-{3,}|^begin forwarded message:/im);
  const outlook = marker < 0 ? b.search(/^from:.*\n(?:sent|date):.*\n(?:to:.*\n)?(?:cc:.*\n)?subject:/im) : -1;
  const start = marker >= 0 ? marker : outlook;
  if (start < 0) return null;
  const block = b.slice(start);
  const lines = block.split('\n');
  let from = '', subject = '', i = marker >= 0 ? 1 : 0;
  for (; i < Math.min(lines.length, 14); i++) {
    const l = lines[i];
    const m = l.match(/^(from|subject|date|sent|to|cc)\s*:\s*(.*)$/i);
    if (!m) { if (l.trim() === '' && (from || subject)) { i++; break; } continue; }
    if (m[1].toLowerCase() === 'from') from = m[2].trim();
    if (m[1].toLowerCase() === 'subject') subject = m[2].trim();
  }
  if (!from && !subject) return null;
  return { from, subject, body: lines.slice(i).join('\n').trim() };
}

/** "Stripe Recruiting <no-reply@greenhouse.io>" → { name, address, domain }. */
export function parseSender(from) {
  const s = String(from || '').trim();
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  const address = (m ? m[2] : s).trim().toLowerCase();
  const name = m ? m[1].trim() : '';
  const at = address.lastIndexOf('@');
  return { name, address, local: at > 0 ? address.slice(0, at) : '', domain: at > 0 ? address.slice(at + 1) : '' };
}
