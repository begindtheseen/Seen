// Safe PostgREST filter values (security audit 2026-11-01). Every helper returns a string that is
// already URL-encoded and ready to splice after `col=op.`, so a value can never add a parameter
// (`&select=…`), break out of a quoted list, or act as a wildcard.
//
//   eqValue(v)         `col=eq.${eqValue(v)}`            exact
//   ilikeExact(v)      `col=ilike.${ilikeExact(v)}`      case-insensitive exact (no wildcards)
//   ilikePrefix(v)     `col=ilike.${ilikePrefix(v)}`     starts with v
//   ilikeContains(v)   `col=ilike.${ilikeContains(v)}`   contains v
//   ilikeWords(v,{contains}) words of v in order, anything between (`a*b`, or `*a*b*`)
//   inList(values)     `col=in.${inList(values)}`        a quoted list, parentheses included
//
// PostgREST turns `*` into `%` inside like/ilike and has no way to match a literal `*`, so a `*`
// in a value becomes `_` (any one character) — the real name still matches itself. `%`, `_` and
// `\` are escaped with `\` (Postgres LIKE's default escape). Control characters are dropped.

const CTRL = /[\u0000-\u001f\u007f]/g;
const clean = (v) => String(v ?? '').replace(CTRL, '');

/** A value matched literally inside a like/ilike pattern (not encoded). */
export function likeLiteral(v) {
  return clean(v).replace(/[\\%_]/g, '\\$&').replace(/\*/g, '_');
}

/** A value for an ilike pattern INSIDE or=(…) / and=(…): also drops the list's own syntax (, ( ) "). */
export function orLiteral(v) {
  return likeLiteral(v).replace(/[,()"]/g, ' ').replace(/\s+/g, ' ').trim();
}

export const eqValue = (v) => encodeURIComponent(clean(v));
export const ilikeExact = (v) => encodeURIComponent(likeLiteral(v));
export const ilikePrefix = (v) => encodeURIComponent(`${likeLiteral(v)}*`);
export const ilikeContains = (v) => encodeURIComponent(`*${likeLiteral(String(v ?? '').trim())}*`);

/** The words of v (split on spaces/hyphens) in order with anything between; '' when v has none. */
export function ilikeWords(v, { contains = false } = {}) {
  const words = clean(v).split(/[\s-]+/).filter(Boolean).map(likeLiteral);
  if (!words.length) return '';
  const p = words.join('*');
  return encodeURIComponent(contains ? `*${p}*` : p);
}

/** One value for a quoted in.(…) / or=(…) list: double quotes and backslashes are removed. */
export const quoteValue = (v) => `"${clean(v).replace(/["\\]/g, '')}"`;

/** `(…)` for in.(…): each value quoted, the inside URL-encoded. */
export function inList(values) {
  return `(${encodeURIComponent((values || []).map(quoteValue).join(','))})`;
}
