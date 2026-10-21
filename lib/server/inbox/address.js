// Inbox Autopilot addresses: track-<token>@seenjobs.io. Pure helpers, no I/O.
//
// Resend receives mail for EVERY address at seenjobs.io (receiving is enabled on the domain), so a new
// address needs no DNS or provider setup — it exists the moment its token is stored.

export const INBOX_DOMAIN = 'seenjobs.io';
const PREFIX = 'track-';
// No 0/1 so a token read aloud or retyped can't be confused with o/l.
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz23456789';
export const TOKEN_LENGTH = 12;

/** A new random token (platform CSPRNG; ~62 bits). */
export function newToken(random = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n))) {
  // 256 % 34 != 0, so bytes at the top of the range are skipped to keep every letter equally likely.
  const limit = 256 - (256 % ALPHABET.length);
  let out = '';
  while (out.length < TOKEN_LENGTH) {
    for (const b of random(TOKEN_LENGTH)) {
      if (b < limit && out.length < TOKEN_LENGTH) out += ALPHABET[b % ALPHABET.length];
    }
  }
  return out;
}

export function isToken(t) {
  return typeof t === 'string' && t.length === TOKEN_LENGTH && [...t].every((c) => ALPHABET.includes(c));
}

export function addressFor(token) {
  return `${PREFIX}${token}@${INBOX_DOMAIN}`;
}

/** The token in one address string ("Name <track-abc…@seenjobs.io>" or bare), or null. */
export function tokenFromAddress(addr) {
  const s = String(addr || '').toLowerCase();
  const at = s.lastIndexOf('@' + INBOX_DOMAIN);
  if (at < 0) return null;
  const local = s.slice(0, at).split(/[\s<"',;:]/).pop() || '';
  if (!local.startsWith(PREFIX)) return null;
  const token = local.slice(PREFIX.length).split('+')[0];
  return isToken(token) ? token : null;
}

/**
 * Every distinct token an email was addressed to. A Gmail filter-forward keeps the ORIGINAL To:
 * header (the user's own address), so the envelope recipient — Resend's `received_for`, and the
 * Delivered-To / X-Forwarded-To / X-Original-To headers — is checked as well as to/cc/bcc.
 */
export function tokensFromEmail(email) {
  const e = email || {};
  const h = lowerKeys(e.headers);
  const candidates = [
    ...asList(e.received_for), ...asList(e.to), ...asList(e.cc), ...asList(e.bcc),
    ...asList(h['delivered-to']), ...asList(h['x-forwarded-to']), ...asList(h['x-original-to']),
    ...asList(h['envelope-to']), ...asList(h['x-forwarded-for']),
  ];
  const out = [];
  for (const c of candidates) {
    for (const piece of String(c).split(/[,\s]+/)) {
      const t = tokenFromAddress(piece);
      if (t && !out.includes(t)) out.push(t);
    }
  }
  return out;
}

function asList(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v.filter((x) => x != null).map(String) : [String(v)];
}

function lowerKeys(o) {
  const out = {};
  if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) out[String(k).toLowerCase()] = v;
  return out;
}
