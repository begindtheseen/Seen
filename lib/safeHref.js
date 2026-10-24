// Hrefs built from browser-stored data (localStorage / sessionStorage caches, the tracker's own
// store, "recently checked" companies). Storage is writable by any script on the origin, so a stored
// string is never placed in a link as it is: an internal path segment is rebuilt by percent-encoding
// it, and an outside link must parse as an http(s) URL and is re-serialized from the parsed URL.
// Pure, no I/O — shared by pages and tests (CodeQL js/xss-through-dom, PR #351).
//
// The same module owns the "where to go after sign-in" value (`?return=`): it comes from the URL, so
// it is sanitized the same way before anyone navigates to it (open-redirect guard).

/** One path segment (an id, a slug) for an internal href: encoded, never raw. */
export function pathSegment(v) {
  return encodeURIComponent(String(v == null ? '' : v));
}

/** A stored, already-encoded slug re-encoded canonically (no double encoding; malformed input is encoded as is). */
export function slugSegment(v) {
  const s = String(v == null ? '' : v);
  let decoded;
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

/**
 * An INTERNAL path (with optional query/hash) a URL parameter may name as a destination, or null.
 * Accepts only a single leading slash: `//evil.com`, `/\evil.com`, full URLs, schemes and anything
 * with control characters are refused, and the value is re-serialized from a parsed URL so the result
 * is exactly one origin-relative path. Used by /login (`?return=`), the Stripe portal return_url and
 * every "sign in to continue" redirect.
 */
export function internalPath(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s.startsWith('/') || s.startsWith('//') || s.startsWith('/\\')) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(s)) return null;
  let u;
  try { u = new URL(s, 'https://seen.invalid'); } catch { return null; }
  if (u.origin !== 'https://seen.invalid') return null;
  return `${u.pathname}${u.search}${u.hash}`;
}

/** The sign-in URL that comes back to `path` afterwards; a bare /login when there is nowhere to return to. */
export function loginHref(path) {
  const p = internalPath(path);
  if (!p || p.startsWith('/login') || p.startsWith('/reset')) return '/login';
  return `/login?return=${encodeURIComponent(p)}`;
}
