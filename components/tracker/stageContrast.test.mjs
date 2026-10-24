// WCAG contrast of every stage chip on a tracker card (components/tracker/tracker.module.css):
// the six pipeline cells (default / done / current) and the phone's current-stage chip. The phone
// audit 2026-10-23 measured "APPLIED" white-on-#3b82f6 at 3.68:1; the floor here is 4.5:1 (AA, the
// text is 12px). Colours are read from the stylesheet itself, tokens from globals.css :root, and
// translucent layers are composited over the card surface the way the browser paints them.
// Run: node --test components/tracker/stageContrast.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const globals = readFileSync(here('../../app/globals.css'), 'utf8')
const mod = readFileSync(here('./tracker.module.css'), 'utf8')

// :root tokens — the first :root{} block of globals.css holds the palette.
const tokens = {}
for (const m of globals.matchAll(/--([a-z0-9-]+):\s*([^;}]+)/g)) if (!(m[1] in tokens)) tokens[m[1]] = m[2].trim()

/** A CSS colour → [r, g, b, a]. Resolves var(--x) through the tokens. */
function parse(c) {
  c = c.trim()
  const v = c.match(/^var\(--([a-z0-9-]+)\)$/)
  if (v) { assert.ok(tokens[v[1]], `token --${v[1]} exists`); return parse(tokens[v[1]]) }
  const h = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (h) { let x = h[1]; if (x.length === 3) x = x.split('').map(ch => ch + ch).join(''); return [0, 2, 4].map(i => parseInt(x.slice(i, i + 2), 16)).concat([1]) }
  const r = c.match(/^rgba?\(([^)]+)\)$/)
  if (r) { const p = r[1].split(',').map(Number); return [p[0], p[1], p[2], p[3] ?? 1] }
  throw new Error(`unparsed colour ${c}`)
}
const over = (top, bg) => [0, 1, 2].map(i => top[i] * top[3] + bg[i] * (1 - top[3])).concat([1])
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
export const ratio = (fg, bg) => { const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a); return (hi + 0.05) / (lo + 0.05) }

/** The `prop` declared in the rule whose selector is exactly `sel`. */
function decl(sel, prop) {
  const re = new RegExp(`(?:^|[}\\n])\\s*${sel.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`, 'm')
  const m = mod.match(re)
  assert.ok(m, `rule ${sel} exists`)
  const d = m[1].match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`))
  return d ? d[1].trim() : null
}

// The card is --surface; the pipe paints --raised over it; a cell paints its own background over the pipe.
const card = parse('var(--surface)')
const pipe = over(parse(decl('.pipe', 'background')), card)
const cell = (sel) => { const bg = decl(sel, 'background'); return bg && bg !== 'transparent' ? over(parse(bg), pipe) : pipe }

const pairs = [
  { name: 'pipeline cell (default)', fg: decl('.step', 'color'), bg: cell('.step') },
  { name: 'pipeline cell (done)', fg: decl('.step.done', 'color'), bg: cell('.step.done') },
  { name: 'pipeline cell (current — the "APPLIED" chip)', fg: decl('.step.current', 'color'), bg: cell('.step.current') },
  { name: 'phone current-stage chip', fg: decl('.chip', 'color'), bg: over(parse(decl('.chip', 'background')), card) },
]

for (const p of pairs) {
  test(`${p.name} reads at ≥ 4.5:1`, () => {
    const r = ratio(parse(p.fg), p.bg)
    console.log(`  ${p.name}: ${r.toFixed(2)}:1`)
    assert.ok(r >= 4.5, `${p.name} is ${r.toFixed(2)}:1`)
  })
}

test('the audit’s failing pair is what the old stylesheet had (white on --blue = 3.68:1)', () => {
  assert.equal(ratio(parse('#fff'), parse('var(--blue)')).toFixed(2), '3.68')
})
