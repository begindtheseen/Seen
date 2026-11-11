// The new admin's own guardrails (stricter than lib/ui/designRules.test.mjs, which also scans these files).
// Each rule names the audit defect it keeps out (director/reports/admin-audit.md, Deliverable 2).
// Run: node --test components/admin2/admin2.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..', '..')
function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(tsx?|css)$/.test(n) && !/\.test\./.test(n)) out.push(p)
  }
  return out
}
const files = [...walk(here), path.join(root, 'app/admin/page.tsx')]
const rel = (f) => path.relative(root, f)
const code = (line) => !/^\s*(\/\/|\/\*|\*|\{\/\*)/.test(line)
function hits(re, filter = () => true) {
  const out = []
  for (const f of files.filter(filter)) readFileSync(f, 'utf8').split('\n').forEach((l, i) => { if (code(l) && re.test(l)) out.push(`${rel(f)}:${i + 1}`) })
  return out
}

test('no raw colour (hex, rgb, hsl) anywhere in the admin — tokens only (defects 17, 21)', () => {
  assert.deepEqual(hits(/#[0-9a-f]{3,8}\b(?![\w-])|rgba?\(\s*\d|hsla?\(\s*\d/i, (f) => !/README/.test(f)), [])
})

test('no legacy --fs-NN alias and no Syne outside headings', () => {
  assert.deepEqual(hits(/--fs-\d{2}\b/), [])
  const display = []
  for (const f of files.filter((p) => p.endsWith('.css'))) {
    for (const block of readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('}')) {
      const [sel, body = ''] = block.split('{')
      if (/var\(--display\)/.test(body) && !/^\s*\.(h1|title|loginH1|brandWord|loginWord)\s*$/.test(sel.trim().split('\n').pop())) display.push(`${rel(f)}: ${sel.trim().slice(0, 40)}`)
    }
  }
  assert.deepEqual(display, [], 'Syne is for headings and the wordmark only')
})

test('no native dialogs, no reloads, no whole-page refresh (defects 3, 20)', () => {
  assert.deepEqual(hits(/\bwindow\.(confirm|alert|prompt)\(|(?<![.\w])(confirm|alert|prompt)\(/), [])
  assert.deepEqual(hits(/location\.reload|router\.refresh\(|location\.href\s*=/), [])
})

test('no second overlay: only the shell renders a Sheet; nobody uses Dialog or ModalPortal directly', () => {
  const sheetUsers = hits(/<Sheet\b/).map((h) => h.split(':')[0])
  assert.deepEqual([...new Set(sheetUsers)], ['components/admin2/core/SheetHost.tsx'])
  assert.deepEqual(hits(/from '@\/components\/ui\/Dialog'|<Dialog\b/), [])
  assert.deepEqual(hits(/ModalPortal/).map((h) => h.split(':')[0]).filter((f) => f !== 'components/admin2/ui/Sheet.tsx'), [])
})

test('inline style objects only for a progress transform (no layout in style={{}})', () => {
  const out = []
  for (const f of files.filter((p) => p.endsWith('.tsx'))) {
    readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      if (!code(l)) return
      for (const m of l.matchAll(/style=\{([^}]*\}?)\}/g)) if (!/transform: `scaleX/.test(m[1]) && !/undefined : \{ transform/.test(m[1])) out.push(`${rel(f)}:${i + 1}`)
    })
  }
  assert.deepEqual(out, [])
})

test('every admin request goes through the core api (one place for token, 401 replay and error sentences)', () => {
  assert.deepEqual(hits(/(?<![.\w]|async )fetch\(/, (f) => !/core\/api\.ts$/.test(f)), [])
})

test('the lab is compiled only behind NEXT_PUBLIC_ADMIN_LAB', () => {
  const imports = hits(/devlab\//, (f) => !/core\/devlab\//.test(f))
  for (const h of imports) {
    const [f, line] = h.split(':')
    const src = readFileSync(path.join(root, f), 'utf8').split('\n')
    const guarded = src.slice(Math.max(0, +line - 4), +line).some((l) => /NEXT_PUBLIC_ADMIN_LAB === '1'/.test(l))
    assert.ok(guarded, `${h} imports the lab without the build flag guard`)
  }
})
