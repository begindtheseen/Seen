// Design guardrails (owner decision 2026-11-02: "ditch the purple gradient as a whole").
//
// Seen's look is ONE flat accent on dark surfaces. These rules keep it that way: no indigo / violet /
// purple / fuchsia anywhere, no gradient fills on controls (the "blue → purple button" is the tell), no
// gradient text, no glow. A new colour belongs in app/globals.css as a token; a rule that needs a
// second hue is a design change, not a one-off.
//
// Scans every shipped stylesheet, component, lib file and public SVG (test files excluded) and names
// each offending file:line so the fix is one grep away.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCAN_DIRS = ['app', 'components', 'lib', 'public']
const EXT = /\.(css|tsx?|jsx?|mjs|svg)$/
const SKIP = /\.test\.|\/node_modules\/|\/_reference\//

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) { if (name !== 'node_modules') walk(p, out) }
    else if (EXT.test(name) && !SKIP.test(p)) out.push(p)
  }
  return out
}
const files = SCAN_DIRS.flatMap((d) => walk(path.join(root, d)))
const rel = (f) => path.relative(root, f)

// The retired families: Tailwind indigo-400+, violet, purple, fuchsia, and the bespoke stops the old
// gradients used. Hex (any case) and the rgb triplets of the same colours.
const PURPLE_HEX = [
  '818cf8', '6366f1', '4f46e5', '4338ca', '3730a3', '312e81', 'a5b4fc', 'c7d2fe', // indigo
  '8b5cf6', '7c3aed', '6d28d9', '5b21b6', 'a78bfa', 'c4b5fd', 'ddd6fe', 'ede9fe', // violet
  'a855f7', '9333ea', '7e22ce', '6b21a8', 'c084fc', 'd8b4fe', 'e9d5ff', // purple
  'e879f9', 'd946ef', 'c026d3', 'f0abfc', // fuchsia
  '6d4aea', '5b53ee', '8b4cf0', 'a33bf2', 'e3a3ff', 'a8a6ff', // bespoke gradient stops
]
const PURPLE_RGB = [
  '129,140,248', '99,102,241', '79,70,229', '67,56,202', '165,180,252', '199,210,254',
  '139,92,246', '124,58,237', '109,40,217', '167,139,250', '196,181,253',
  '168,85,247', '147,51,234', '192,132,252', '216,180,254',
  '232,121,249', '217,70,239',
]
const hexRe = new RegExp(`#(?:${PURPLE_HEX.join('|')})\\b`, 'i')
const rgbRe = new RegExp(`rgba?\\(\\s*(?:${PURPLE_RGB.map((t) => t.split(',').join('\\s*,\\s*')).join('|')})\\s*[,)]`)
// Tokens that used to carry the purple. They are gone from globals.css, so any use is a broken var().
const RETIRED_TOKENS = /var\(--(?:g-start|g-mid|g-end|g-text-start|g-text-mid|g-text-end|violet|purple|vdim|vmid|pdim|pmid|idim|imid|cta-gradient(?:-hover)?)\b/
// A gradient FILL: two or more colour stops where at least one is a real colour (hex, rgb, hsl or a
// colour token). Pure white/black-alpha sheens, masks and progress bars are allowed by the second test.
const GRADIENT = /(?:linear|radial|conic)-gradient\(([^;"'`}]*)/g

function offenders(re) {
  const out = []
  for (const f of files) {
    const lines = readFileSync(f, 'utf8').split('\n')
    lines.forEach((line, i) => { if (re.test(line)) out.push(`${rel(f)}:${i + 1}`) })
  }
  return out
}

test('no indigo / violet / purple / fuchsia anywhere in shipped code', () => {
  const hits = [...offenders(hexRe), ...offenders(rgbRe)]
  assert.deepEqual(hits, [], `purple is retired — swap for a token in app/globals.css:\n  ${hits.join('\n  ')}`)
})

test('the retired gradient tokens are gone and nothing references them', () => {
  const hits = offenders(RETIRED_TOKENS)
  assert.deepEqual(hits, [], `retired token(s) still used:\n  ${hits.join('\n  ')}`)
  const tokens = readFileSync(path.join(root, 'app/globals.css'), 'utf8')
  for (const t of ['--g-start', '--g-text-start', '--violet:', '--purple:', '--cta-gradient']) {
    assert.ok(!tokens.includes(t), `${t} must not be defined in app/globals.css`)
  }
})

// Colour stops a gradient may mix: a stop is "a colour" when it is a hex, an rgb()/hsl() or a colour
// token — and not a neutral (near-black / near-white / grey, with any alpha). Two DIFFERENT colours in
// one gradient = a multi-hue fill, which is banned; one colour fading to transparent or to a neutral is
// fine (a tint, a sheen, a mask, a fade into the page).
const STOP = /#[0-9a-f]{3,8}\b|hsla?\([^)]*\)|rgba?\([^)]*\)|var\(--(?:accent|cta|good|caution|bad|info|blue|green|red|amber|cyan|teal|indigo|c)\b[^)]*\)/gi
function channels(stop) {
  const hex = stop.match(/^#([0-9a-f]{3,8})$/i)
  if (hex) {
    let h = hex[1]; if (h.length <= 4) h = h.split('').map((c) => c + c).join('')
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
  }
  const rgb = stop.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
  return rgb ? [+rgb[1], +rgb[2], +rgb[3]] : null
}
const isNeutral = (stop) => { const c = channels(stop); return !!c && Math.max(...c) - Math.min(...c) <= 24 }
function multiHue(body) {
  const stops = (body.match(STOP) || []).map((s) => s.replace(/\s+/g, '').toLowerCase()).filter((s) => !isNeutral(s))
  return new Set(stops).size >= 2
}
// Rows that are data pictures, not fills: a conic ring driven by one colour var, a bar whose hue is a
// score (`scoreHsl`), and gradients that read a single colour against transparent.
const ALLOW = [/scoreHsl\(/, /conic-gradient\(var\(--c,/, /conic-gradient\(\$\{healthColor\}/]

test('no multi-hue gradient fills (buttons, cards, text, backgrounds)', () => {
  const hits = []
  for (const f of files) {
    const lines = readFileSync(f, 'utf8').split('\n')
    lines.forEach((line, i) => {
      if (ALLOW.some((a) => a.test(line))) return
      for (const m of line.matchAll(GRADIENT)) {
        if (multiHue(m[1])) { hits.push(`${rel(f)}:${i + 1}  ${m[0].slice(0, 90)}`); break }
      }
    })
  }
  assert.deepEqual(hits, [], `gradient fills are retired — one flat colour:\n  ${hits.join('\n  ')}`)
})

test('the primary button is a flat fill and gradient text is gone', () => {
  const ui = readFileSync(path.join(root, 'components/ui/ui.css'), 'utf8')
  const primary = ui.split('\n').find((l) => l.startsWith('.ui-btn--primary,') || l.startsWith('.ui-btn--primary{')) || ''
  assert.ok(primary && !/gradient\(/.test(primary), `.ui-btn--primary must be a flat fill: ${primary.slice(0, 120)}`)
  const clipText = offenders(/background-clip:\s*text|WebkitBackgroundClip|backgroundClip:\s*['"]text/)
  assert.deepEqual(clipText, [], `gradient text is retired:\n  ${clipText.join('\n  ')}`)
})
