import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { PRO_PRICING, balanceExplanation, WELCOME_CREDITS, FREE_DAILY_CREDITS, CREDIT_RESET_LABEL } from './server/creditRules.js'

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

// ── Credit copy: the popover's balance sentence renders from the constants, never hand-typed ──
test('balanceExplanation states the welcome arithmetic the server implements', () => {
  const w = balanceExplanation({ balance: WELCOME_CREDITS, welcome: true })
  assert.match(w, new RegExp(`^${WELCOME_CREDITS} available = your ${WELCOME_CREDITS}-credit welcome bonus`))
  assert.ok(w.includes(`${FREE_DAILY_CREDITS} credit a day is not added on top`), w)
  assert.ok(w.includes(CREDIT_RESET_LABEL), w)
})

test('balanceExplanation adds daily + purchased to the total and names the reset', () => {
  const s = balanceExplanation({ balance: 23, daily: 3, purchased: 20, earned: 2 })
  assert.equal(s, `23 available = 3 for today (your ${FREE_DAILY_CREDITS} credit free plus 2 earned, less what you have used) + 20 purchased (never reset). Today's credits reset to ${FREE_DAILY_CREDITS} at ${CREDIT_RESET_LABEL}; purchased credits never reset.`)
  const plain = balanceExplanation({ balance: 1, daily: 1, purchased: 0, earned: 0 })
  assert.ok(!/purchased \(never reset\)/.test(plain) && /^1 available = 1 for today/.test(plain), plain)
  // no `daily` from an older API → derived from balance − purchased, never shown as 0 by accident
  assert.match(balanceExplanation({ balance: 8, purchased: 5 }), /^8 available = 3 for today/)
})

test('CreditsPopover renders every number from the credit constants — no hand-typed credit figures', () => {
  const src = read('..', 'components', 'CreditsPopover.tsx')
  assert.ok(/balanceExplanation\(/.test(src), 'popover must render the balance sentence from balanceExplanation')
  assert.ok(/FREE_DAILY_CREDITS|WELCOME_CREDITS|MAX_DAILY_EARN/.test(src))
  const jsxText = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{[^{}]*\}/g, '') // drop expressions; leaves literal copy
  const figures = jsxText.match(/\b(10|5)\s+credits?\b|\bbonus\s+10\b|\b(1|3)\s+free credit/g)
  assert.equal(figures, null, `hand-typed credit figure in popover copy: ${figures}`)
})

// ── /pricing for a cold visitor (conversion audit 2026-10-24) ──
test('/pricing opens on MONTHLY, computes its yearly saving, and shows "Get Pro free" from the reward constants', () => {
  const src = read('..', 'app', 'pricing', 'page.tsx')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  assert.match(code, /const \[yearly, setYearly\] = useState\(false\)/, 'the billing toggle must default to monthly')
  assert.doesNotMatch(code, /SAVE\s+\d+%/, 'the yearly saving percentage must be computed, not typed')
  assert.match(code, /ANNUAL_SAVE_PCT = Math\.round\(\(1 - YEARLY_TOTAL \/ \(MONTHLY_NUM \* 12\)\) \* 100\)/)
  assert.match(code, /FREE_PRO_LINE = `[^`]*\$\{proDaysLabel\(REPORT_REWARD_PRO_DAYS\)\}[^`]*\$\{proDaysLabel\(REFERRAL_REWARD_PRO_DAYS\)\}/)
  const line = code.indexOf('data-testid="free-pro-line"')
  assert.ok(line > -1 && line < code.indexOf('Not ready for a membership?'), 'the free-Pro line sits in the Pro card, above the one-time SKUs')
  assert.doesNotMatch(code, /\b(3|7) days of (Seen )?Pro\b/, 'reward days must come from the constants')
})

test('the Pro list leads with what a job seeker gets, not credits or Human Voice', () => {
  const src = read('..', 'app', 'pricing', 'page.tsx')
  const list = src.slice(src.indexOf('const PRO_FEATURES = ['), src.indexOf(']', src.indexOf('const PRO_FEATURES = [')))
  const items = [...list.matchAll(/'([^']+)'/g)].map(m => m[1])
  assert.ok(items.length >= 5)
  assert.doesNotMatch(items[0], /credit|Human Voice/i)
  assert.ok(items.findIndex(i => /Human Voice/.test(i)) > 1)
})

// Owner launch check 2026-10-25: Pro was sold with "ghost risk alerts when companies change behavior"
// and an "AI company deep-dive", neither of which exists in the code. Pro grants unlimited AI credits,
// Human Voice and unbranded résumé downloads — no surface may promise more.
test('no surface sells Pro features that do not exist', () => {
  const surfaces = [
    ['..', 'app', 'pricing', 'page.tsx'], ['..', 'app', 'pricing', 'layout.tsx'], ['..', 'components', 'UpgradeModal.tsx'],
    ['..', 'app', 'profile', 'page.tsx'], ['..', 'app', 'dashboard', 'page.tsx'], ['..', 'app', 'faq', 'page.tsx'],
    ['..', 'components', 'home', 'WorkspacePreview.tsx'], ['signupIntent.js'],
  ]
  for (const f of surfaces) {
    const src = read(...f)
    assert.doesNotMatch(src, /ghost[- ](risk[- ])?alerts?\b/i, `${f.join('/')} promises ghost alerts`)
    assert.doesNotMatch(src, /company (deep-dive|analysis)|deep(er)? company/i, `${f.join('/')} promises AI company analysis`)
  }
})
