// The user-facing text inside a TS/TSX/JS source file: string literals, template-literal text and JSX
// text — not identifiers, imports, comments or className values. Approximate by design (no parser),
// tuned so a component NAME like HumanProofPanel never counts while its visible label does. Used by
// lib/glossary.test.mjs to keep retired terms out of copy.

const blank = (m) => m.replace(/[^\n]/g, ' ')

function stripComments(src) {
  // Walk the source so a "//" inside a string or a URL is not taken for a comment.
  let out = ''
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i], d = src[i + 1]
    if (c === '/' && d === '*') { const j = src.indexOf('*/', i + 2); const end = j < 0 ? n : j + 2; out += blank(src.slice(i, end)); i = end; continue }
    if (c === '/' && d === '/') { const j = src.indexOf('\n', i); const end = j < 0 ? n : j; out += blank(src.slice(i, end)); i = end; continue }
    if (c === '\'' || c === '"' || c === '`') {
      let j = i + 1
      while (j < n && src[j] !== c) { if (src[j] === '\\') j++; else if (c !== '`' && src[j] === '\n') break; j++ }
      out += src.slice(i, j + 1); i = j + 1; continue
    }
    out += c; i++
  }
  return out
}

/** @returns {{ line: number, text: string }[]} */
export function copyStrings(src) {
  const code = stripComments(String(src))
  const out = []
  const lineAt = (i) => code.slice(0, i).split('\n').length
  // import / export-from lines carry module paths, not copy
  const masked = code.replace(/^\s*(import|export)\b[^\n]*from\s*['"][^'"]+['"][^\n]*$/gm, blank)
  const strRe = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g
  let m
  while ((m = strRe.exec(masked))) {
    const before = masked.slice(Math.max(0, m.index - 12), m.index)
    if (/className=\s*\{?\s*$|class=\s*$/.test(before)) continue
    if (/[!=]==?\s*$|\bcase\s*$/.test(before)) continue // a comparison key, not copy
    const text = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^}]*\}/g, ' ')
    if (/[A-Za-zé]{2,}\s+[A-Za-zé]/.test(text) || /^[A-Z][\wé]+$/.test(text)) out.push({ line: lineAt(m.index), text })
  }
  // JSX text between tags
  const jsxRe = />([^<>{}`]*[A-Za-z][^<>{}`]*)</g
  while ((m = jsxRe.exec(masked))) {
    const t = m[1].trim()
    if (t && !/=>/.test(t) && !/[;=]\s*$/.test(t)) out.push({ line: lineAt(m.index), text: t })
  }
  return out
}
