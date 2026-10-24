import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// The legal surfaces (audit 2026-10-24, M-1/M-2/M-3/L-2): /legal is a hub that links the three
// documents and repeats only facts the code implements; the documents render every open item through
// one <Placeholder>, carry a calm one-sentence draft note, and never contradict the code (no card
// trial, prices from constants, résumé stored on the profile, no Glassdoor as a source).
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(path.join(root, p), 'utf8')
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const DOCS = ['app/terms/page.tsx', 'app/privacy/page.tsx', 'app/content-policy/page.tsx']
const PAGES = [...DOCS, 'app/legal/page.tsx']

test('the legal hub links the three documents and states no legal term of its own', () => {
  const hub = stripComments(read('app/legal/page.tsx'))
  for (const href of ['/terms', '/privacy', '/content-policy']) assert.match(hub, new RegExp(`href: '${href}'`))
  for (const banned of ['arbitration', 'AAA', 'first charge occurs at checkout', 'Pro waitlist', 'Billing & Subscription', 'perpetual, irrevocable', 'Liability is capped', 'Governed by California law', 'Third-party processors']) {
    assert.doesNotMatch(hub, new RegExp(banned), `/legal must not state "${banned}" — that belongs to the documents or does not exist`)
  }
  assert.match(hub, /PRO_TRIAL_DAYS/)
  assert.match(hub, /proPriceLine\(\)/)
  assert.match(hub, /ONE_TIME_SKUS/)
})

test('no legal page carries a hand-typed price, trial length or credit grant', () => {
  for (const f of PAGES) {
    const code = stripComments(read(f))
    const literal = code.match(/(?<![\w.$])(9\.99|6\.99|83\.88|14\.99|4\.99|\$79|\$249|\$299)(?![\w])/g)
    assert.equal(literal, null, `${f} carries a hand-typed price: ${literal}`)
    assert.doesNotMatch(code, /\b7-day\b|\bseven-day\b|\b30 AI credits\b|\b20 AI credits\b/, `${f} hand-types a trial length or credit grant`)
  }
})

test('every open legal item renders through <Placeholder>; no raw [PLACEHOLDER] and no warning banner', () => {
  for (const f of PAGES) {
    const src = read(f)
    assert.doesNotMatch(src, /\[PLACEHOLDER/, `${f} still has a raw [PLACEHOLDER] string`)
    assert.doesNotMatch(src, /⚠ Draft/, `${f} still renders the amber draft warning banner`)
  }
  for (const f of DOCS) {
    const src = read(f)
    assert.match(src, /<DraftNote \/>/, `${f} must carry the one-sentence draft note`)
    assert.match(src, /<Placeholder>/, `${f} must render its open items through <Placeholder>`)
    assert.match(src, /<LegalFooter \/>/)
  }
  const bits = read('components/legal/LegalBits.tsx')
  assert.match(bits, /\[to be completed: \{children\}\]/)
})

test('document metadata: no doubled "| Seen" title suffix, no "Draft — pending" description, og:image set', () => {
  for (const f of PAGES) {
    const src = read(f)
    const title = src.match(/^\s*title: '([^']+)'/m)?.[1] || ''
    assert.ok(title, `${f} must declare a metadata title`)
    assert.doesNotMatch(title, /\| Seen$/, `${f} title "${title}" would render as "… | Seen | Seen" under the root template`)
    const description = src.match(/^\s*description:\s*\n?\s*'([^']+)'/m)?.[1] || ''
    assert.ok(description, `${f} must declare a metadata description`)
    assert.doesNotMatch(description, /Draft — pending legal review/, `${f} description ends in the draft notice Google would show`)
    // og:image either set literally or through lib/seo.ts pageMetadata, which always sets it (lib/seo.test.mjs pins that).
    assert.ok(/images: \['\/opengraph-image'\]/.test(src) || /pageMetadata\(\{/.test(src), `${f} must set og:image like the rest of the site`)
  }
})

test('the documents say what the code does: no-card trial, cancellation in Settings, one-time purchases, résumé stored, Google Fonts listed', () => {
  const terms = read('app/terms/page.tsx')
  assert.match(terms, /id="billing"/)
  assert.match(terms, /id="one-time"/)
  assert.match(terms, /requires no payment card/)
  assert.match(terms, /Settings → Plan &amp; billing/)
  assert.match(terms, /EMPLOYER_SKUS/)
  assert.match(terms, /deleting your account removes any remaining purchased credits/)
  assert.doesNotMatch(terms, /first charge occurs at checkout/)
  const privacy = read('app/privacy/page.tsx')
  assert.match(privacy, /stored on your profile until you replace it or delete your account/)
  assert.match(privacy, /Google Fonts/)
  // The pricing FAQ makes the same résumé statement (M-3) — the two can never disagree again.
  const pricing = stripComments(read('app/pricing/page.tsx'))
  assert.doesNotMatch(pricing, /processed in-memory/)
  assert.match(pricing, /stored on your profile/)
})

test('Glassdoor is not named as a data source (owner decision 2026-10-20)', () => {
  for (const f of ['app/layout.tsx', 'app/company/[slug]/layout.tsx']) {
    assert.doesNotMatch(stripComments(read(f)), /Glassdoor/, `${f} names Glassdoor as a source`)
  }
  // llms.txt is generated now (app/llms.txt/route.ts → lib/llmsText.ts); its fixed text lives in lib/llmsText.ts.
  assert.doesNotMatch(stripComments(read('lib/llmsText.ts')), /Glassdoor/)
})

test('/legal is no longer the "Subscription Terms" link target; /terms#billing is', () => {
  for (const f of ['app/profile/page.tsx', 'components/UpgradeModal.tsx']) {
    assert.doesNotMatch(read(f), /href="\/legal"/, `${f} still sends billing questions to the hub instead of the terms`)
  }
})
