// Every "1 credit" price tag in the UI must sit on an action the server actually charges through
// gateAI (lib/server/credits.js). The 2026-10-23 audit found "Upload a file · 1 credit" on a free
// action and "Apply → 1 credit" on a plain external link. This test is the map: a new price tag
// anywhere else fails until it is added here WITH the gate that charges it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { RESUME_PARSE_COST, RESUME_OPTIMIZE_COST, JOB_INSIGHTS_COST } from './server/creditRules.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(path.join(root, p), 'utf8')

// file → { tags: how many "1 credit" strings may appear in UI copy, gate: the gateAI reason that
// charges the action the tag sits on (api/*.js) }
const PRICE_TAGS = {
  // the advantage button renders priceLabel(RESUME_OPTIMIZE_COST, pro) — no hand-typed literal
  'app/resume/page.tsx': { tags: 0, gate: "gateAI(req, `resume_${tool || 'tool'}`)", api: 'api/resume.js', why: 'Build my advantage → tool:advantage' },
  'app/resume/studio/page.tsx': { tags: 1, gate: "gateAI(req, 'resume_tailor')", api: 'api/resume.js', why: 'TailorPanel onNeed sign-in message (tailor = 1 credit)' },
  // the button renders its price from creditCostLabel(RESUME_OPTIMIZE_COST) — no hand-typed literal
  'components/resume/TailorPanel.tsx': { tags: 0, gate: "gateAI(req, 'resume_tailor')", api: 'api/resume.js', why: 'Optimize for this job → action:tailor' },
  'components/CreditsPopover.tsx': { tags: 1, gate: 'gateAI(', api: 'lib/server/credits.js', why: 'explains that every AI action costs 1 credit' },
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) { if (name !== 'node_modules') walk(p, out) } else if (/\.(tsx?|jsx?)$/.test(name) && !/\.test\./.test(name)) out.push(p)
  }
  return out
}
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

test('the parse/upload path is free and the optimizer/insights paths cost exactly one credit', () => {
  assert.equal(RESUME_PARSE_COST, 0)
  assert.equal(RESUME_OPTIMIZE_COST, 1)
  assert.equal(JOB_INSIGHTS_COST, 1)
  const api = read('api/resume.js')
  const parse = api.slice(api.indexOf("body.action === 'parse'"), api.indexOf('return handleParseResume'))
  assert.ok(!/gateAI/.test(parse), 'the parse route must never be credit-gated')
})

test('every "1 credit" string in app/ and components/ sits on a gated action listed in PRICE_TAGS', () => {
  const files = [...walk(path.join(root, 'app')), ...walk(path.join(root, 'components'))]
  for (const f of files) {
    const rel = path.relative(root, f)
    const code = stripComments(read(rel))
    const n = (code.match(/1 credit\b/g) || []).length
    const expected = PRICE_TAGS[rel]
    if (!expected) { assert.equal(n, 0, `${rel} shows "1 credit" (${n}×) but is not in the price-tag map — which gateAI call charges it?`); continue }
    assert.equal(n, expected.tags, `${rel}: expected ${expected.tags} price tag(s), found ${n}`)
    assert.ok(read(expected.api).includes(expected.gate), `${rel}: its gate ${expected.gate} is not in ${expected.api}`)
  }
})

test('the two audit defects stay fixed: Studio upload reads free; the company-page Apply link carries no price', () => {
  const studio = read('app/resume/studio/page.tsx')
  assert.ok(/creditCostLabel\(RESUME_PARSE_COST\)/.test(studio), 'Studio upload button renders its price from RESUME_PARSE_COST')
  assert.ok(!/Upload a file[^\n]*1 credit/.test(studio))
  const company = read('app/company/[slug]/page.tsx')
  assert.ok(!/Apply → 1 credit/.test(company))
})
