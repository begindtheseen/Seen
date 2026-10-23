import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { PRO_PRICING } from './server/creditRules.js'

// Every Pro price on the site renders from creditRules PRO_PRICING (itself pinned to api/stripe.js).
// These checks fail the suite if any surface grows its own literal again.
const here = path.dirname(fileURLToPath(import.meta.url))
const read = (...p) => readFileSync(path.join(here, ...p), 'utf8')

test('PRO_PRICING is the one source: 9.99 / 6.99 per month yearly / 83.88 total', () => {
  assert.equal(PRO_PRICING.monthly, 9.99)
  assert.equal(PRO_PRICING.yearly_per_month, 6.99)
  assert.equal(PRO_PRICING.yearly_total, 83.88)
})

test('lib/pricing, /pricing, the upgrade modal and Settings all read PRO_PRICING — no local price literals', () => {
  for (const f of [['pricing.ts'], ['..', 'app', 'pricing', 'page.tsx'], ['..', 'components', 'UpgradeModal.tsx'], ['..', 'app', 'profile', 'page.tsx']]) {
    const src = read(...f)
    const usesSource = /PRO_PRICING|proPriceLine|PRO_MONTHLY|PRO_YEARLY/.test(src)
    assert.ok(usesSource, `${f.join('/')} must import the shared price`)
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '') // comments may quote a price
    const literal = code.match(/(?<![\w.])(9\.99|6\.99|83\.88)(?![\w])/g)
    assert.equal(literal, null, `${f.join('/')} carries a hand-typed price: ${literal}`)
  }
})

test('proPriceLine shows month, year total and per-month-yearly together', () => {
  const lib = read('pricing.ts')
  assert.match(lib, /\$\{usd\(PRO_MONTHLY\)\}\/month, or \$\{usd\(PRO_YEARLY_TOTAL\)\}\/year \(\$\{usd\(PRO_YEARLY_PER_MONTH\)\}\/mo\)/)
})
