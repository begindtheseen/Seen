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

// ── DESIGN.md §3: exactly two font families ship ─────────────────────────────────────────────────
test('exactly two font families are loaded (Syne + Instrument Sans), no third face anywhere', () => {
  const layout = readFileSync(path.join(root, 'app/layout.tsx'), 'utf8')
  const loaders = (layout.match(/localFont\(/g) || []).length
  assert.equal(loaders, 2, `app/layout.tsx must call localFont() exactly twice (found ${loaders})`)
  assert.ok(!/from ['"]next\/font\/google['"]/.test(layout), 'fonts ship with the site (next/font/local), never a build-time Google download')
  const families = new Set(readdirSync(path.join(root, 'app/fonts')).filter((f) => f.endsWith('.woff2')).map((f) => f.replace(/-\d+\.woff2$/, '')))
  assert.deepEqual([...families].sort(), ['instrument-sans', 'syne'], `app/fonts holds ${[...families].join(', ')}`)
  const thirdFace = offenders(/--font-dm-mono|DM Mono|font-family:\s*(?:ui-)?monospace|font-family:\s*['"]?(?:Inter|Roboto|Menlo|Courier)/)
  assert.deepEqual(thirdFace, [], `a third typeface is referenced:\n  ${thirdFace.join('\n  ')}`)
})

// ── DESIGN.md §4: spacing sits on the 4/8px grid ─────────────────────────────────────────────────
// px and rem values of padding / margin / gap / inset offsets: 1px and 2px (hairlines), multiples of 4
// below 32px, multiples of 8 from 32px up. em values scale with the font and are not layout spacing.
const SPACING_DECL = /(?:^|[;{\s])(?:padding|margin|gap|row-gap|column-gap|inset|top|right|bottom|left|scroll-margin|scroll-padding)(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?\s*:\s*([^;}!]+)/g
const onGrid = (px) => { const a = Math.abs(px); return a === 0 || a === 1 || a === 2 || (Number.isInteger(+(a / 4).toFixed(6)) && (a < 32 || Number.isInteger(+(a / 8).toFixed(6)))) }
test('spacing values are on the 8px grid (4px steps inside components, 1–2px hairlines)', () => {
  const hits = []
  for (const f of files.filter((p) => p.endsWith('.css'))) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      for (const m of line.matchAll(SPACING_DECL)) {
        for (const tok of m[1].trim().split(/\s+/)) {
          const v = tok.match(/^(-?[\d.]+)(px|rem)$/); if (!v) continue
          const px = v[2] === 'px' ? parseFloat(v[1]) : parseFloat(v[1]) * 16
          if (!onGrid(px)) { hits.push(`${rel(f)}:${i + 1}  ${tok} (${px}px)`); break }
        }
      }
    })
  }
  assert.deepEqual(hits, [], `off-grid spacing — use a --sp-* token or a multiple of 4 (8 above 32px):\n  ${hits.join('\n  ')}`)
})

// ── DESIGN.md §2: no raw colour outside the token file ───────────────────────────────────────────
// Only app/globals.css (the tokens), renderers that paint to canvas / satori (they cannot read a CSS
// variable) and SVG assets may hold a literal colour.
const LITERAL_OK = /app\/globals\.css$|opengraph-image\.tsx$|twitter-image\.tsx$|\/icon\.tsx$|apple-icon\.tsx$|components\/ListingCard\.tsx$|components\/CardShareModal\.tsx$|lib\/cardKit\.ts$|\.svg$|lib\/ui\/tone\.js$/
test('no raw hex colour in a component, page or module stylesheet (tokens only)', () => {
  const hits = []
  for (const f of files) {
    if (LITERAL_OK.test(f)) continue
    if (!/\.(module\.css|tsx)$/.test(f)) continue
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\/\*|\*|\{\/\*)|\{\/\*|mask-image|^\s*mask:/.test(line)) return
      // `// colour-literal: <why>` on a line marks a value that is compared or passed to a renderer, never painted by CSS.
      if (/colour-literal:/.test(line)) return
      const m = line.match(/#[0-9a-f]{3,8}\b/i)
      if (!m) return
      if (/^#\d{2,4}$/.test(m[0]) && /[(#]\d{2,4}\)/.test(line)) return // an issue / PR number in prose
      if (!/url\(|data:|href=|#[0-9a-f]{3,8}\w*-/i.test(line.slice(Math.max(0, m.index - 6), m.index + 12))) hits.push(`${rel(f)}:${i + 1}  ${m[0]}`)
    })
  }
  assert.deepEqual(hits, [], `raw colour — use a token from app/globals.css:\n  ${hits.join('\n  ')}`)
})

// ── DESIGN.md §3/§4 for inline styles in .tsx: sizes from the scale, spacing on the grid ───────────
// A `style={{ fontSize: '.55rem' }}` is a 9px label; the old fix was a 40-selector [style*=…] hack in
// globals.css that floored them at runtime. Now the source itself names a --fs-* token.
const TSX_FILES = files.filter((f) => /\.tsx$/.test(f) && !LITERAL_OK.test(f))
test('inline font sizes are --fs-* tokens (never a raw rem/px/number)', () => {
  const hits = []
  for (const f of TSX_FILES) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      const m = line.match(/\bfontSize:\s*(?:'[\d.]+(?:rem|px)'|\d)|\bmono\('[\d.]+rem'/)
      if (m) hits.push(`${rel(f)}:${i + 1}  ${m[0]}`)
    })
  }
  assert.deepEqual(hits, [], `inline text size off the scale — use fontSize: 'var(--fs-…)' (12px floor):\n  ${hits.join('\n  ')}`)
  const g = readFileSync(path.join(root, 'app/globals.css'), 'utf8')
  assert.ok(!/\[style\*="font-size/.test(g), 'the [style*="font-size…"] runtime floor hack must stay deleted — fix the source instead')
})
const SP_PROP = '(?:padding|margin|gap|rowGap|columnGap|inset|top|right|bottom|left|scrollMargin|scrollPadding)(?:Top|Right|Bottom|Left|Inline|Block)?(?:Start|End)?'
const SP_RE = new RegExp(`\\b(${SP_PROP}):\\s*(?:'([^']*)'|(-?\\d+(?:\\.\\d+)?)(?=\\s*[,}]))`, 'g')
test('inline spacing in .tsx sits on the 8px grid (4px steps inside components)', () => {
  const hits = []
  for (const f of TSX_FILES) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      for (const m of line.matchAll(SP_RE)) {
        if (m[3] != null) { if (!onGrid(parseFloat(m[3]))) hits.push(`${rel(f)}:${i + 1}  ${m[1]}: ${m[3]}`); continue }
        for (const tok of m[2].split(/\s+/)) {
          const v = tok.match(/^(-?[\d.]+)(px|rem)$/); if (!v) continue
          const px = v[2] === 'px' ? parseFloat(v[1]) : parseFloat(v[1]) * 16
          if (!onGrid(px)) { hits.push(`${rel(f)}:${i + 1}  ${m[1]}: ${tok}`); break }
        }
      }
    })
  }
  assert.deepEqual(hits, [], `off-grid inline spacing — a multiple of 4 (8 above 32px) or a --sp-* token:\n  ${hits.join('\n  ')}`)
})

// ── DESIGN.md §3: the display face is for H1–H3 only — never a button, link, price or figure ─────
test('no button or link is set in the display font', () => {
  const hits = []
  for (const f of TSX_FILES) {
    const s = readFileSync(f, 'utf8')
    for (const m of s.matchAll(/<(?:button|a|Link)\b[^>]*?>/gs)) if (/var\(--display\)/.test(m[0])) hits.push(`${rel(f)}:${s.slice(0, m.index).split('\n').length}`)
  }
  for (const f of files.filter((p) => p.endsWith('.css'))) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (/font-family:\s*var\(--display\)/.test(line) && /^\s*\.[^{]*\b(btn|button|cta)\w*[^{]*\{/i.test(line)) hits.push(`${rel(f)}:${i + 1}`)
    })
  }
  assert.deepEqual(hits, [], `Syne on a control — buttons use var(--body) 600:\n  ${hits.join('\n  ')}`)
})

// ── DESIGN.md §1/§2: one stroke icon set — no emoji used as an icon ───────────────────────────────
// An emoji is painted by the OS in its own colour font (Apple Color Emoji, Noto Color Emoji), so a 🎉
// or a 👻 reads as a different product dropped into the page. Icons are <Icon name=… /> from
// components/ui/Icon.tsx. What counts as an emoji here: a code point the OS renders as emoji by
// default (Emoji_Presentation — 🎉 👻 📞 📄 🎯 📌 👋 🔥 ⏳ ✅ ❌ ⚡), any pictograph outside the BMP
// (🗣 🌡 render as emoji on every phone even though their default is "text"), and any pictograph
// forced into emoji form with U+FE0F (⚠️ ✍️ 🌡️ ✉️). Typographic glyphs that live in the page font or
// a monochrome symbol face — ☰ ✕ ♡ ▾ ✓ → ↗ © ⚠ ✉ ⚙ ▶ ⬇ — are text, not icons, and pass.
const EMOJI_RE = /\p{Emoji_Presentation}|\p{Extended_Pictographic}️|[\u{1F000}-\u{1FFFF}]/gu
// Emoji that are CONTENT, not an icon: a line that is ABOUT the glyph (quoting a third-party UI's own
// emoji, a user's verbatim text). One entry = one file + the exact glyph + why. Empty today: every emoji
// in shipped .tsx stood in for an icon or a word, and the Gmail "⚙" the inbox help line quotes is a
// text-presentation glyph the rule already allows.
const EMOJI_CONTENT_OK = [
  // { file: 'components/x.tsx', glyph: '🎉', why: '…' },
]
test('no emoji used as an icon in .tsx (one stroke icon set: components/ui/Icon.tsx)', () => {
  const hits = []
  for (const f of TSX_FILES) {
    const file = rel(f)
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\/\*|\*|\{\/\*)/.test(line)) return // a comment describing the old glyph is not rendered
      const found = [...new Set((line.match(EMOJI_RE) || []).filter((g) => !EMOJI_CONTENT_OK.some((a) => a.file === file && a.glyph === g)))]
      if (found.length) hits.push(`${file}:${i + 1}  ${found.join(' ')}`)
    })
  }
  assert.deepEqual(hits, [], `emoji as an icon — use <Icon name=… /> (components/ui/icons.ts) or the word alone:\n  ${hits.join('\n  ')}`)
})

// ── DESIGN.md §2: eyebrows, kickers and section labels are ink — colour is for actions and states ──
// An inline uppercase 12–13px label coloured with the accent or a semantic hue, with no chip background
// or border, is a coloured label. (Status chips carry a tint background or a border and are allowed.)
test('inline uppercase labels are ink, not the accent or a semantic hue', () => {
  const hits = []
  const HUE = /color:\s*'var\(--(?:accent|blue|info|info-text|green|good|good-text|amber|caution|caution-text|cta)\)'/
  for (const f of TSX_FILES) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (!/textTransform:\s*'uppercase'/.test(line) || !HUE.test(line)) return
      if (/background:\s*'(?!none|transparent)/.test(line) || /border(?:Color)?:\s*'/.test(line)) return
      hits.push(`${rel(f)}:${i + 1}`)
    })
  }
  assert.deepEqual(hits, [], `coloured label — use color: 'var(--text-3)' (DESIGN.md §2):\n  ${hits.join('\n  ')}`)
})
