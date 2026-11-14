// Every fact a start guide's menu prints, found by walking its blocks: any object with a `src` array is a fact
// (lib/start/guides.test.mjs checks each one names a reference the module declares). Pure; no imports.

/** The entries (objects carrying `src: string[]`) anywhere inside `value`, each once, in reading order. */
export function blockEntries(value, out = [], seen = new Set()) {
  if (Array.isArray(value)) { for (const v of value) blockEntries(v, out, seen); return out }
  if (!value || typeof value !== 'object' || seen.has(value)) return out
  seen.add(value)
  if (Array.isArray(value.src)) out.push(value)
  for (const [k, v] of Object.entries(value)) if (k !== 'src') blockEntries(v, out, seen)
  return out
}
