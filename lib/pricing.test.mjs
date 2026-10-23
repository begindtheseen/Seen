import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// lib/pricing.ts is TypeScript; read the literal constants and the pricing page's own literals
// and pin them to each other, so Settings can never show a Pro price /pricing doesn't.
const here = path.dirname(fileURLToPath(import.meta.url))
const lib = readFileSync(path.join(here, 'pricing.ts'), 'utf8')
const page = readFileSync(path.join(here, '..', 'app', 'pricing', 'page.tsx'), 'utf8')
const num = (src, name) => Number((src.match(new RegExp(`${name}\\s*=\\s*([0-9.]+)`)) || [])[1])

test('lib/pricing mirrors the constants /pricing renders', () => {
  assert.equal(num(lib, 'PRO_MONTHLY'), num(page, 'MONTHLY_NUM'))
  assert.equal(num(lib, 'PRO_YEARLY_PER_MONTH'), num(page, 'YEARLY_NUM'))
  assert.equal(num(lib, 'PRO_MONTHLY'), 9.99)
  assert.equal(num(lib, 'PRO_YEARLY_PER_MONTH'), 6.99)
})

test('proPriceLine shows month, year total and per-month-yearly together', () => {
  const monthly = num(lib, 'PRO_MONTHLY')
  const perMonth = num(lib, 'PRO_YEARLY_PER_MONTH')
  const total = +(perMonth * 12).toFixed(2)
  const line = `$${monthly.toFixed(2)}/month, or $${total.toFixed(2)}/year ($${perMonth.toFixed(2)}/mo)`
  assert.equal(line, '$9.99/month, or $83.88/year ($6.99/mo)')
  // The template literal in pricing.ts must produce exactly this shape.
  assert.match(lib, /\$\{usd\(PRO_MONTHLY\)\}\/month, or \$\{usd\(PRO_YEARLY_TOTAL\)\}\/year \(\$\{usd\(PRO_YEARLY_PER_MONTH\)\}\/mo\)/)
})
