import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { ONE_TIME_SKUS, SELLABLE_SKUS, ONE_TIME_NOTE, skuPrice, balanceExplanation, WELCOME_CREDITS, FREE_DAILY_CREDITS, CREDIT_RESET_LABEL } from './server/creditRules.js'

// What Seen sells (owner decisions 2026-10-25): Free forever · Interview Prep $9.99 for one interview ·
// the 30-day Job Search Pass $19.99. Both one-time, never renewing; no subscription, no trial, no Credit
// Pack. Every price on the site renders from creditRules ONE_TIME_SKUS (the cents api/stripe.js charges)
// through skuPrice / lib/pricing.ts. These checks fail the suite if any surface grows its own literal again.
const here = path.dirname(fileURLToPath(import.meta.url))
const read = (...p) => readFileSync(path.join(here, ...p), 'utf8')
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1') // comments may quote a price

// Every surface that prints a price or names a paid product.
const SURFACES = [
  ['pricing.ts'], ['signupIntent.js'], ['useCheckout.ts'],
  ['..', 'app', 'pricing', 'page.tsx'], ['..', 'app', 'pricing', 'layout.tsx'], ['..', 'components', 'UpgradeModal.tsx'],
  ['..', 'app', 'profile', 'page.tsx'], ['..', 'app', 'faq', 'page.tsx'], ['..', 'app', 'legal', 'page.tsx'], ['..', 'app', 'terms', 'page.tsx'],
  ['..', 'components', 'tracker', 'InterviewPrep.tsx'], ['..', 'components', 'home', 'PriceLine.tsx'], ['..', 'components', 'company', 'InterviewPrepLine.tsx'],
  ['..', 'components', 'home', 'WorkspacePreview.tsx'], ['..', 'components', 'HumanProofPanel.tsx'], ['..', 'components', 'ApplyOptimizeModal.tsx'],
  ['..', 'app', 'resume', 'page.tsx'], ['..', 'components', 'resume', 'ExportPanel.tsx'], ['..', 'components', 'resume', 'TailorPanel.tsx'],
]

test('the products are the one source: Interview Prep 999¢ / 14 Pro days, the pass 1999¢ / 30 days, nothing else sold', () => {
  assert.deepEqual(SELLABLE_SKUS, ['interview', 'pass30'])
  assert.equal(ONE_TIME_SKUS.interview.amount_cents, 999)
  assert.equal(ONE_TIME_SKUS.interview.pro_days, 14)
  assert.equal(ONE_TIME_SKUS.pass30.amount_cents, 1999)
  assert.equal(ONE_TIME_SKUS.pass30.pro_days, 30)
  assert.equal(skuPrice('interview'), '$9.99')
  assert.equal(skuPrice('pass30'), '$19.99')
  const lib = read('pricing.ts')
  assert.match(lib, /PREP_PRICE: string = skuPrice\('interview'\)/)
  assert.match(lib, /PASS_PRICE: string = skuPrice\('pass30'\)/)
})

test('no surface carries a hand-typed price', () => {
  for (const f of SURFACES) {
    const c = code(read(...f))
    const literal = c.match(/(?<![\w.])\$?(9\.99|19\.99|4\.99|6\.99|83\.88|14\.99)(?![\w])/g)
    assert.equal(literal, null, `${f.join('/')} carries a hand-typed price: ${literal}`)
  }
})

test('no surface offers a subscription, a trial, the Credit Pack, a yearly plan or unlimited credits', () => {
  const ui = SURFACES.filter((f) => !['terms', 'legal'].includes(f[f.length - 2]) && f[f.length - 1] !== 'pricing.ts')
  for (const f of ui) {
    const c = code(read(...f))
    assert.doesNotMatch(c, /free trial|day trial|trialSignupHref|Start (your )?\d+-day|PRO_TRIAL_DAYS|PRO_PRICING|proPriceLine/i, `${f.join('/')} still offers the trial or a monthly price`)
    assert.doesNotMatch(c, /billed (monthly|yearly)|BEST VALUE|SAVE \d+%|setYearly/, `${f.join('/')} still sells a recurring plan`)
    assert.doesNotMatch(c, /handleOneTime\('credits20'\)|Get \$\{CREDITS20|Credit Pack ·|top up/i, `${f.join('/')} still sells the Credit Pack`)
    assert.doesNotMatch(c, /unlimited AI credits|Pro removes the cap|Go Pro for unlimited|MOST POPULAR/i, `${f.join('/')} sells credits or an unsupported claim`)
  }
})

test('every paid button on /pricing, the upgrade sheet and the tracker card says it is once and never renews', () => {
  assert.equal(ONE_TIME_NOTE, 'One-time · never renews')
  const page = code(read('..', 'app', 'pricing', 'page.tsx'))
  assert.match(page, /const buyBtn = [\s\S]*?\{ONE_TIME_NOTE\}/, '/pricing buy buttons carry the note')
  assert.equal((page.match(/buyBtn\('(interview|pass30)'/g) || []).length, 2, 'two products on /pricing, each through buyBtn')
  const modal = code(read('..', 'components', 'UpgradeModal.tsx'))
  assert.equal((modal.match(/\{ONE_TIME_NOTE\}/g) || []).length, 2, 'both buttons in the sheet carry the note')
  const card = code(read('..', 'components', 'tracker', 'InterviewPrep.tsx'))
  assert.equal((card.match(/\{ONE_TIME_NOTE\}/g) || []).length, 2, 'the prep and the pass on the card both carry the note')
})

test('the pass is sold by outcome, not by credits; Interview Prep leads /pricing on a phone', () => {
  const lib = read('pricing.ts')
  const block = (name) => { const at = lib.indexOf('= [', lib.indexOf(`export const ${name}`)); return lib.slice(at, lib.indexOf(']', at)) }
  for (const name of ['PASS_INCLUDES', 'PREP_INCLUDES', 'FREE_FOREVER']) {
    const items = [...block(name).matchAll(/'([^']+)'/g)].map(m => m[1])
    assert.ok(items.length >= 4, name)
    for (const i of items) assert.doesNotMatch(i, /\bcredits?\b|unlimited/i, `${name}: "${i}" sells credits`)
  }
  assert.match(block('PASS_INCLUDES'), /Interview Prep for every interview/)
  const css = read('..', 'app', 'pricing', 'pricing.module.css')
  assert.match(css, /@media \(max-width: 860px\)[\s\S]*\.cards \.lead \{ order: 1; \}/, 'Interview Prep is the first card on a phone')
  // Names are consistent: the lock cards, the sheet and the menu all say HumanProof.
  for (const f of [['pricing.ts'], ['..', 'components', 'UpgradeModal.tsx'], ['..', 'app', 'pricing', 'page.tsx'], ['..', 'components', 'ApplyOptimizeModal.tsx']]) {
    assert.doesNotMatch(code(read(...f)), /Human Voice/, `${f.join('/')} uses the old name`)
  }
})

test('never pitched next to a rejection or ghosting', () => {
  // The dashboard's signals card lists ghost surges and quiet companies: no paid link in it.
  const dash = code(read('..', 'app', 'dashboard', 'page.tsx'))
  assert.doesNotMatch(dash, /href="\/pricing"/)
  // The tracker card's Interview Prep renders only on an ACTIVE application at an interview stage.
  const tracker = read('..', 'app', 'tracker', 'page.tsx')
  assert.match(tracker, /\{isActive && PREP_STAGES\.includes\(app\.stage\) && \(\s*<InterviewPrep/)
  const guest = read('..', 'components', 'tracker', 'GuestTracker.tsx')
  assert.match(guest, /a\.status === 'active' && \['Phone Screen', 'Interview', 'Final Round'\]\.includes\(a\.stage\) && \(/)
  // Check-in and outcome emails carry no offer.
  const emails = code(read('..', 'api', 'outcome-followups.js'))
  assert.doesNotMatch(emails, /pricing|Job Search Pass|Interview Prep|\$\{?skuPrice/)
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

test('the "Get Pro free" answer on /pricing renders the reward days from the constants', () => {
  const c = code(read('..', 'app', 'pricing', 'page.tsx'))
  assert.match(c, /id: 'get-pro-free'/)
  assert.match(c, /\$\{proDaysLabel\(REPORT_REWARD_PRO_DAYS\)\}[\s\S]*\$\{proDaysLabel\(REFERRAL_REWARD_PRO_DAYS\)\}/)
  assert.doesNotMatch(c, /\b(3|7) days of (Seen )?Pro\b/, 'reward days must come from the constants')
})

// Owner launch check 2026-10-25: Pro was sold with "ghost risk alerts when companies change behavior"
// and an "AI company deep-dive", neither of which exists in the code — no surface may promise more than
// Pro access grants.
test('no surface sells Pro features that do not exist', () => {
  const surfaces = [...SURFACES, ['..', 'app', 'dashboard', 'page.tsx']]
  for (const f of surfaces) {
    const src = read(...f)
    assert.doesNotMatch(src, /ghost[- ](risk[- ])?alerts?\b/i, `${f.join('/')} promises ghost alerts`)
    assert.doesNotMatch(src, /company (deep-dive|analysis)|deep(er)? company/i, `${f.join('/')} promises AI company analysis`)
  }
})
