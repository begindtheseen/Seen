// Run: node --test lib/start/guides.test.mjs
// The "getting in" guides (/start/oilfield, /start/trades) print only sourced facts: every figure carries a source
// with a link and an as-of date, first-hand accounts cite the threads they came from, and nothing the research
// marked UNVERIFIED or CONFLICTING (or any hype) reaches the page. Plus the sitemap / llms.txt / footer entries and
// the one quiet line /jobs shows under an oilfield or trades search.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import * as oil from './oilfield.js'
import * as trades from './trades.js'
import { START_GUIDES, formatSourceDate, numberSources } from './guides.js'
import { guideForQuery, GUIDE_LINES } from './guideFor.js'
import { guideListingRows, mergeListingAnswers, GUIDE_MAX_ROWS } from './listingRows.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const GUIDES = [['oilfield', oil], ['trades', trades]]

// Every string a data module can put on the page (deep walk), for the wording checks.
function strings(v, out = []) {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out))
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out))
  return out
}
// The visible text of a page entry: a fact's text, a table row's cells.
function entryText(e) {
  return Object.entries(e).filter(([k, v]) => k !== 'src' && k !== 'firstHand' && k !== 'board' && k !== 'url' && typeof v === 'string').map(([, v]) => v).join(' ')
}

for (const [name, mod] of GUIDES) {
  test(`${name}: every source has a label, an https link and an ISO as-of date`, () => {
    for (const [k, s] of Object.entries(mod.sources)) {
      assert.ok(s.label && s.label.length > 8, `${k}: label`)
      assert.match(s.url, /^https:\/\/[^\s]+$/, `${k}: url`)
      assert.match(s.date, /^\d{4}-\d{2}(-\d{2})?$/, `${k}: date`)
      assert.ok(formatSourceDate(s.date), `${k}: date reads`)
      assert.ok(s.date <= '2026-11-13', `${k}: date is not after the research date`)
    }
  })

  test(`${name}: every entry on the page cites a source that exists, and every figure is cited`, () => {
    const entries = mod.pageEntries()
    assert.ok(entries.length > 20)
    for (const e of entries) {
      assert.ok(Array.isArray(e.src) && e.src.length > 0, `no source: ${entryText(e).slice(0, 80)}`)
      for (const k of e.src) assert.ok(mod.sources[k], `unknown source "${k}" on: ${entryText(e).slice(0, 80)}`)
    }
    // A figure ($, %, or any digit) only ever appears inside a cited entry: every string the module can print that
    // holds a digit must belong to an entry above (its text or a table cell). Source records and the as-of date
    // are the citations themselves.
    const covered = new Set([...strings(entries), ...mod.faq.map((f) => f.q)]) // a question asks; its answer is cited
    const printable = Object.entries(mod).filter(([k]) => k !== 'sources' && typeof mod[k] !== 'function')
    const loose = strings(Object.fromEntries(printable))
      .filter((t) => /\d/.test(t) && !covered.has(t) && t !== mod.guide.asOf)
    assert.deepEqual(loose, [], 'figures printed without a source')
  })

  test(`${name}: every declared source is cited somewhere, and numbering follows first appearance`, () => {
    const { nums, ordered } = numberSources(mod.sources, mod.pageEntries())
    const unused = Object.keys(mod.sources).filter((k) => !nums[k])
    assert.deepEqual(unused, [], 'declared but never cited')
    assert.equal(ordered.length, Object.keys(mod.sources).length)
    ordered.forEach(([k], i) => assert.equal(nums[k], i + 1))
  })

  test(`${name}: first-hand accounts cite only the public threads they came from`, () => {
    const fh = mod.pageEntries().filter((e) => e.firstHand)
    assert.ok(fh.length >= 3)
    for (const e of fh) assert.ok(e.src.some((k) => /reddit\.com\/r\//.test(mod.sources[k].url)), `first-hand without a thread: ${e.text}`)
    // A thread is never the only backing of a plain fact.
    for (const e of mod.pageEntries().filter((x) => !x.firstHand)) {
      assert.ok(e.src.some((k) => !/reddit\.com/.test(mod.sources[k].url)), `a fact backed only by Reddit: ${entryText(e)}`)
    }
  })

  test(`${name}: calm wording — no exclamation marks, hype or guarantees`, () => {
    const all = strings(Object.fromEntries(Object.entries(mod).filter(([k]) => k !== 'sources'))).join('\n')
    assert.doesNotMatch(all, /!/, 'no exclamation marks')
    assert.doesNotMatch(all, /\b(secret|guarantee[sd]?|in demand|in-demand|hot jobs?|booming|act now|don't miss|hurry|easy money|get rich)\b/i)
    // Paying never buys a job: no line suggests a paid résumé or ticket gets anyone hired.
    assert.doesNotMatch(all, /\b(pay|buy)\b[^.]*\b(résumé|resume|ticket|certificat\w*)\b[^.]*\b(get|gets|got) (you )?hired\b/i)
  })

  test(`${name}: the FAQ (visible and JSON-LD) is short and every answer is cited`, () => {
    assert.ok(mod.faq.length >= 4 && mod.faq.length <= 6)
    for (const { q, a } of mod.faq) {
      assert.match(q, /\?$/)
      assert.ok(a.src.length && a.text.split(/(?<=\.)\s/).length <= 3, `answer too long: ${q}`)
    }
  })
}

for (const [name, mod] of GUIDES) {
  test(`${name}: the hero carries one cited answer and three cited readings`, () => {
    assert.ok(mod.guide.answer && mod.guide.answer.text && mod.guide.answer.src.length, 'answer sentence is cited')
    assert.doesNotMatch(mod.guide.answer.text, /\d/, 'the answer sentence states no figure (figures live in the tiles)')
    assert.equal(mod.tiles.length, 3)
    for (const t of mod.tiles) {
      assert.match(t.value, /\d/, `${t.label}: a reading is a figure`)
      assert.ok(t.value.length <= 18, `${t.label}: short enough for one line on a phone`)
      assert.ok(t.src.length && t.src.every((k) => mod.sources[k]), `${t.label}: cited`)
    }
  })

  test(`${name}: the page's parts list every entry once — one "Sources" line per part, nothing uncited`, () => {
    const parts = mod.sectionEntries()
    assert.deepEqual(Object.values(parts).flat(), mod.pageEntries())
    for (const [part, entries] of Object.entries(parts)) {
      assert.ok(entries.length > 0, `${part}: empty`)
      for (const e of entries) assert.ok(e && e.src && e.src.length, `${part}: an entry without a source`)
    }
  })

  test(`${name}: the page renders from the data — FAQ JSON-LD and the visible FAQ are the same list, no bracket clusters`, () => {
    const page = readFileSync(path.join(root, `app/start/${name}/page.tsx`), 'utf8')
    assert.match(page, /faqJsonLd\(faq\)/, 'JSON-LD built from the data FAQ')
    assert.match(page, /<Faq items=\{faq\} \/>/, 'the visible FAQ is the same list')
    assert.equal((page.match(/<h1|<PageHeader/g) || []).length, 1, 'one h1 (PageHeader)')
    assert.match(page, /<Sources ordered=\{ordered\}/, 'the numbered list sits at the bottom')
    assert.doesNotMatch(page, /<Refs\b|<Toc\b/, 'no inline [1, 2, 3] clusters and no "On this page" chip cloud')
    assert.doesNotMatch(page, /ui-btn--primary|variant="primary"/, 'no filled button on a guide')
    // Every part of the page ends with its own sources line (the hero's carries the as-of date).
    const lines = (page.match(/<SrcLine entries=\{parts\.(\w+)\}/g) || []).map((m) => m.match(/parts\.(\w+)/)[1])
    assert.deepEqual([...lines].sort(), Object.keys(mod.sectionEntries()).sort())
  })
}

test('oilfield: nothing the research marked UNVERIFIED or CONFLICTING is printed', () => {
  const all = strings(oil).join('\n')
  for (const bad of [
    'Dallas Fed', 'dallasfed', '25.5', '21.4', '98.70', '$84', '$50', '$80,000', // conflicting survey index / oil price
    '$16.00', '16.50', '$76,000', // Halliburton pay from search snippets
    '$69,960', 'wagedex', 'ziprecruiter', 'recruitee', '$17.50', '$15.25', // aggregator pay
    '$239.99', '$145', '$108', // vendor course prices
    'Field Specialist Trainee', 'Basic Energy', 'Ensign', 'Axis', // unverified hirers / a company that is gone
    'r/Roughnecks', // a football subreddit
    '114,500', // employment figure read from a search snippet
  ]) assert.ok(!all.includes(bad), `forbidden on the oilfield page: ${bad}`)
})

test('trades: nothing the research marked UNVERIFIED or CONFLICTING is printed', () => {
  const all = strings(trades).join('\n')
  for (const bad of [
    '4 of 9', 'stanine', '60%/65%/70%', '65%', // test cutoffs and the 2022 lineman table
    '$9,000', '$4,800', '$10,000', '$7,000', '$6,500', '$2,080', 'CRST', // contract figures not verified
    'Vestas', '$27,048', '$45k', 'Northwest Lineman College', // ended program, school totals
    '$80,000', '$89,260', // the national "after an apprenticeship" claim
    'Werner', 'Swift', // advertiser-guide terms
    '$22/hr', // a stale ARS posting copy
  ]) assert.ok(!all.includes(bad), `forbidden on the trades page: ${bad}`)
  // Job Corps: the 2026 settlement, never the 2025 closure news.
  assert.match(strings(trades.freeHelp).join(' '), /January 31, 2029/)
})

test('oilfield: the candid parts are said — 2025 was a down year; tickets are not needed before hire at the big employers', () => {
  const all = strings(oil).join('\n')
  assert.match(all, /2025 was a down year/)
  assert.match(all, /None of the eight lists SafeLand, H2S, OSHA 10 or first aid/)
  assert.match(all, /OSHA 10/)
  assert.match(all, /is considered a certification/)
})

test('trades: the candid parts are said — competition, local rates, contract payback terms', () => {
  const all = strings(trades).join('\n')
  assert.match(all, /four to six or more applicants per opening/)
  assert.match(all, /single locals' rates/)
  assert.match(all, /does not say what you owe if you leave early/)
  assert.match(all, /independently owned/)
})

test('the guides are in the sitemap, llms.txt and the footer', () => {
  assert.deepEqual(START_GUIDES.map((g) => g.path), ['/start/oilfield', '/start/trades'])
  assert.equal(oil.guide.path, '/start/oilfield')
  assert.equal(trades.guide.path, '/start/trades')
  const sitemap = readFileSync(path.join(root, 'app/sitemap.ts'), 'utf8')
  assert.match(sitemap, /import \{ START_GUIDES \} from '@\/lib\/start\/guides\.js'/)
  assert.match(sitemap, /\.\.\.START_GUIDES\.map\(/)
  const llms = readFileSync(path.join(root, 'lib/llmsText.ts'), 'utf8')
  assert.match(llms, /'## Guides'/)
  assert.match(llms, /START_GUIDES\.map\(/)
  const footer = readFileSync(path.join(root, 'components/Footer.tsx'), 'utf8')
  assert.match(footer, /START_GUIDES\.map\(/)
  // Nothing on the homepage.
  const home = readFileSync(path.join(root, 'app/page.tsx'), 'utf8')
  assert.ok(!home.includes('/start/'), 'the guides are not linked from the homepage')
})

test('/jobs guide line: oilfield and trades searches get it, others do not', () => {
  for (const q of ['oilfield', 'oil field jobs', 'roustabout', 'floorhand', 'water hauler', 'frac', 'oil and gas']) assert.equal(guideForQuery(q), 'oilfield', q)
  for (const q of ['apprenticeship', 'apprentice electrician', 'electrician', 'hvac', 'welder', 'lineman', 'groundman', 'plumber', 'diesel mechanic', 'skilled trades']) assert.equal(guideForQuery(q), 'trades', q)
  for (const q of ['cashier', 'software engineer', 'apprentice piercer', 'nurse', 'warehouse', '', '   ']) assert.equal(guideForQuery(q), null, q)
  assert.equal(GUIDE_LINES.oilfield.href, '/start/oilfield')
  assert.equal(GUIDE_LINES.trades.href, '/start/trades')
  assert.equal(GUIDE_LINES.oilfield.text, 'New to oilfield work? How people get in')
  assert.equal(GUIDE_LINES.trades.text, 'New to the trades? Apprenticeships and paid training')
})

test('live listings: only matches with a listing page, each once, at most 12, never filler', () => {
  const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const jobs = [
    { id: id(1), title: 'Floorhand', related: true, in_radius: true },
    { id: id(1), title: 'Floorhand (dup)', related: true },
    { id: id(2), title: 'Cashier', related: false },
    { id: 'abc', title: 'No page' },
    { id: id(3), title: '  ' },
    ...Array.from({ length: 20 }, (_, i) => ({ id: id(10 + i), title: `Roustabout ${i}`, related: true })),
  ]
  const rows = guideListingRows({ jobs })
  assert.equal(rows.length, GUIDE_MAX_ROWS)
  assert.equal(rows[0].title, 'Floorhand')
  assert.ok(rows.every((r) => r.related !== false && /^[0-9a-f-]{36}$/.test(r.id)))
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length)
  assert.deepEqual(guideListingRows({ jobs, fallback: 'unrelated' }), [])
  assert.deepEqual(guideListingRows({ jobs: [] }), [])
  assert.deepEqual(guideListingRows(null), [])
})

test('live listings from several searches: interleaved, each listing once, the guide\'s roles first, never filler', () => {
  const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const floor = { jobs: [
    { id: id(1), title: 'Casing Floorhand- OKC', company: 'Nabors', related: true },
    { id: id(2), title: 'Casing Floorhand - OKC', company: 'Nabors', related: true }, // the same job written twice
    { id: id(3), title: 'Floorhand', company: 'AKITA Drilling', related: true },
    { id: id(9), title: 'Cashier', company: 'Corner Store', related: false },
  ] }
  const rous = { jobs: [
    { id: id(4), title: 'Pipeline Foreman', company: 'B&G Roustabout Service', related: true }, // a company-name match
    { id: id(1), title: 'Casing Floorhand- OKC', company: 'Nabors', related: true }, // in both answers
    { id: id(5), title: 'Alaska Roustabout', company: 'Nabors', related: true },
  ] }
  const prefer = /floorhand|roustabout/i
  const rows = mergeListingAnswers([floor, rous], { prefer })
  assert.deepEqual(rows.map((r) => r.id), [id(1), id(3), id(5), id(4)])
  assert.equal(mergeListingAnswers([floor, rous], { prefer, max: 2 }).length, 2)
  // One search failing (null) leaves the other; an unrelated-fallback answer contributes nothing.
  assert.deepEqual(mergeListingAnswers([null, rous], { prefer }).map((r) => r.id), [id(1), id(5), id(4)])
  assert.deepEqual(mergeListingAnswers([{ ...floor, fallback: 'unrelated' }, { jobs: [] }]), [])
  assert.deepEqual(mergeListingAnswers([]), [])
  // At most one Nabors row before every other employer's rows are shown.
  assert.deepEqual(mergeListingAnswers([floor, rous], { prefer, perCompany: 1 }).map((r) => r.id), [id(1), id(3), id(4), id(5)])
})

test('the oilfield block reads rig-role searches, never a plain "oilfield" search (company-name matches lead it)', () => {
  assert.ok(Array.isArray(oil.listings.queries) && oil.listings.queries.length >= 1)
  assert.ok(!oil.listings.queries.includes('oilfield'))
  assert.ok(new RegExp(oil.listings.prefer, 'i').test('Floorhand - Oklahoma'))
  assert.deepEqual(trades.listings.queries, ['apprenticeship'])
})
