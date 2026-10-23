// Hrefs built from browser-stored data (localStorage / sessionStorage caches, the tracker's own
// store, "recently checked" companies). Storage is writable by any script on the origin, so a stored
// string is never placed in a link as it is: an internal path segment is rebuilt by percent-encoding
// it, and an outside link must parse as an http(s) URL and is re-serialized from the parsed URL.
// Pure, no I/O — shared by pages and tests (CodeQL js/xss-through-dom, PR #351).

/** One path segment (an id, a slug) for an internal href: encoded, never raw. */
export function pathSegment(v) {
  return encodeURIComponent(String(v == null ? '' : v));
}

/** A stored, already-encoded slug re-encoded canonically (no double encoding; malformed input is encoded as is). */
export function slugSegment(v) {
  const s = String(v == null ? '' : v);
  let decoded = s;
  try { decoded = decodeURIComponent(s); } catch { decoded = s; }
  return encodeURIComponent(decoded);
}

/** The http(s) URL a stored string parses to, serialized from the parsed parts, else null. */
export function httpHref(v) {
  const s = String(v == null ? '' : v).trim();
  if (!/^https?:\/\//i.test(s)) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return u.href;
}
