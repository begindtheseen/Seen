// Plain-words activity titles: O*NET's imperative DWA / IWA titles ("Load or unload materials used in construction.")
// as lower-case gerund phrases that sit inside a sentence ("loading or unloading materials used in construction").
// Rules only (no word list beyond the handful of stress-final verbs English doubles). Isomorphic: no data, no Node.

const DOUBLE = new Set(['admit', 'commit', 'control', 'refer', 'transfer', 'equip', 'occur', 'compel', 'patrol', 'propel', 'submit',
  'permit', 'regret', 'prefer', 'program', 'confer', 'deter', 'expel', 'repel', 'rebel', 'omit', 'emit', 'transmit', 'remit', 'acquit',
  'excel', 'dispel', 'impel', 'outfit', 'unplug', 'format', 'kidnap']);

/**
 * "plan" → "planning", "load" → "loading", "prepare" → "preparing", "tie" → "tying", "monitor" → "monitoring".
 * @param {string} verb
 */
export function gerund(verb) {
  const v = String(verb || '').toLowerCase();
  if (!v) return v;
  if (v.endsWith('ing')) return v;
  if (/ie$/.test(v)) return `${v.slice(0, -2)}ying`;
  if (/(ee|ye|oe)$/.test(v) || v === 'be') return `${v}ing`;
  if (/[^aeiou]e$/.test(v) || /ue$/.test(v)) return `${v.slice(0, -1)}ing`;
  if (/ic$/.test(v)) return `${v}king`;
  if (DOUBLE.has(v) || (/^[^aeiou]*[aeiou][bdfgklmnprstvz]$/.test(v) && v.length <= 4)) return `${v}${v.slice(-1)}ing`;
  return `${v}ing`;
}

/**
 * An O*NET activity title in plain words for copy. Leading imperative verbs ("Load or unload …", "Monitor, test, or
 * adjust …") become gerunds; a title that already starts with a gerund ("Getting Information") is lower-cased. The
 * trailing full stop goes; acronyms keep their case.
 * @param {string} title
 */
export function gerundTitle(title) {
  const t = String(title || '').trim().replace(/\.$/, '');
  if (!t) return '';
  const toks = t.split(/\s+/);
  const lower = (/** @type {string} */ w) => (/^[A-Z0-9]{2,}s?$/.test(w.replace(/[,()]/g, '')) ? w : w.toLowerCase());
  if (/ing$/i.test(toks[0])) return toks.map(lower).join(' ');
  // leading verbs joined by commas / "or" / "and": "Monitor, test, or adjust" → "monitoring, testing, or adjusting"
  const out = [];
  const strip = (/** @type {string} */ w) => w.replace(/,$/, '');
  out.push(gerund(strip(toks[0])) + (toks[0].endsWith(',') ? ',' : ''));
  let verbs = true;
  let expect = false;
  for (let i = 1; i < toks.length; i++) {
    const raw = toks[i];
    const core = strip(raw);
    const comma = raw.endsWith(',') ? ',' : '';
    if (verbs && /^(or|and)$/i.test(core) && i + 1 < toks.length && !expect) { out.push(core.toLowerCase()); expect = true; continue; }
    if (verbs && expect && /^[a-z]+$/i.test(core)) { out.push(gerund(core) + comma); expect = false; verbs = !!comma; continue; }
    if (verbs && toks[i - 1].endsWith(',') && comma && /^[a-z]+$/i.test(core)) { out.push(gerund(core) + comma); continue; }
    verbs = false;
    expect = false;
    out.push(lower(raw));
  }
  return out.join(' ');
}
