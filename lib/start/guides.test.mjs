// Run: node --test lib/start/guides.test.mjs
// The start guides (/start/<field>), one template over data modules (lib/start/registry.js):
//   • every fact on a page is backed by a reference the module declares (the references are never printed);
//   • the rendered page says nothing about "sources" — no citations, no numbered lists, no "read from…" lines;
//     the links reach readers only through the grouped "Additional resources" row (every reference, once);
//   • the FAQ JSON-LD is the visible FAQ; one h1; no filled button;
//   • the registry, the route, the sitemap and llms.txt agree; the guides are not in the footer.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { loadTsx, render, h } from '../../components/ui/tsxForTest.mjs'
import * as oil from './oilfield.js'
import * as trades from './trades.js'
import { CONTENT } from './registry.js'
import { GUIDES, START_GUIDES, startGuide, formatSourceDate, updatedLine } from './guides.js'
import { guideListingRows, GUIDE_MAX_ROWS } from './listingRows.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
// GUIDE_DRAFT=cdl,it runs every content check on draft modules not yet in the registry (writers test one page alone).
const DRAFTS = String(process.env.GUIDE_DRAFT || '').split(',').map((s) => s.trim()).filter((f) => /^[a-z]+$/.test(f) && !CONTENT[f])
const GUIDE_MODS = [...Object.entries(CONTENT), ...await Promise.all(DRAFTS.map(async (f) => [f, await import(`./${f}.js`)]))]
const { default: GuidePage } = await loadTsx('components/start/GuidePage.tsx')

// Every string a data module can put on the page (deep walk), for the wording checks.
function strings(v, out = []) {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out))
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out))
  return out
}
const entryText = (e) => Object.entries(e).filter(([k, v]) => !['src', 'firstHand', 'board', 'url'].includes(k) && typeof v === 'string').map(([, v]) => v).join(' ')
// The page as a reader gets it: server markup with scripts dropped, tags removed.
const createElement = await h()
async function pageText(mod) {
  const html = await render(createElement(GuidePage, { content: mod, header: null }))
  return { html, text: html.replace(/<script[^]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ') }
}

test('the registry: live guides = registered content modules; the other six wait (no route, no card)', () => {
  assert.deepEqual(START_GUIDES.map((g) => g.field), Object.keys(CONTENT))
  assert.deepEqual(GUIDES.map((g) => g.field), ['oilfield', 'trades', 'cdl', 'healthcare', 'warehouse', 'it', 'spacex', 'tesla'])
  for (const g of GUIDES) {
    assert.equal(g.path, `/start/${g.field}`)
    assert.ok(g.label && g.prompt && g.llms, `${g.field}: label, prompt, llms`)
    assert.equal(g.kind, g.field === 'spacex' || g.field === 'tesla' ? 'company' : 'field')
  }
  assert.equal(startGuide('oilfield').path, '/start/oilfield')
  assert.equal(startGuide('cdl'), null, 'a guide without content is not live')
  for (const [field, mod] of GUIDE_MODS) assert.equal(mod.guide.path, `/start/${field}`)
})

test('one dynamic route renders every live guide; the old per-guide pages are gone; URLs unchanged', () => {
  const page = readFileSync(path.join(root, 'app/start/[field]/page.tsx'), 'utf8')
  assert.match(page, /export const dynamicParams = false/)
  assert.match(page, /START_GUIDES\.map\(\(g\) => \(\{ field: g\.field \}\)\)/)
  assert.match(page, /notFound\(\)/)
  assert.equal((page.match(/<PageHeader/g) || []).length, 1, 'one h1 (PageHeader)')
  assert.ok(!existsSync(path.join(root, 'app/start/oilfield/page.tsx')) && !existsSync(path.join(root, 'app/start/trades/page.tsx')))
})

test('sitemap and llms.txt list the live guides; the footer does not (not a section of the site)', () => {
  const sitemap = readFileSync(path.join(root, 'app/sitemap.ts'), 'utf8')
  assert.match(sitemap, /import \{ START_GUIDES \} from '@\/lib\/start\/guides\.js'/)
  assert.match(sitemap, /\.\.\.START_GUIDES\.map\(/)
  const llms = readFileSync(path.join(root, 'lib/llmsText.ts'), 'utf8')
  assert.match(llms, /START_GUIDES\.map\(/)
  const footer = readFileSync(path.join(root, 'components/Footer.tsx'), 'utf8')
  assert.ok(!/START_GUIDES|\/start\//.test(footer), 'no guide links in the footer')
  const home = readFileSync(path.join(root, 'app/page.tsx'), 'utf8')
  assert.ok(!home.includes('/start/'), 'the guides are not linked from the homepage')
})

test('the hero date reads as one quiet line', () => {
  assert.equal(updatedLine('2026-11-13'), 'Updated November 2026')
  assert.equal(formatSourceDate('2023-03'), 'Mar 2023')
})

for (const [name, mod] of GUIDE_MODS) {
  test(`${name}: every reference has a label, an https link and an ISO date`, () => {
    for (const [k, s] of Object.entries(mod.sources)) {
      assert.ok(s.label && s.label.length > 8, `${k}: label`)
      assert.match(s.url, /^https:\/\/[^\s]+$/, `${k}: url`)
      assert.match(s.date, /^\d{4}-\d{2}(-\d{2})?$/, `${k}: date`)
      assert.ok(s.date <= mod.guide.asOf, `${k}: date is not after the page's date`)
    }
  })

  test(`${name}: every fact on the page names a reference that exists, and every figure is backed`, () => {
    const entries = mod.pageEntries()
    assert.ok(entries.length > 20)
    for (const e of entries) {
      assert.ok(Array.isArray(e.src) && e.src.length > 0, `no reference: ${entryText(e).slice(0, 80)}`)
      for (const k of e.src) assert.ok(mod.sources[k], `unknown reference "${k}" on: ${entryText(e).slice(0, 80)}`)
    }
    // A figure ($, %, any digit) only ever appears inside a backed fact. The references themselves, the
    // listings filter config (radii, patterns) and the resource link names are not facts on the page.
    const covered = new Set([...strings(entries), ...mod.faq.map((f) => f.q)])
    const printable = Object.entries(mod).filter(([k]) => !['sources', 'listings', 'resources'].includes(k) && typeof mod[k] !== 'function')
    const loose = strings(Object.fromEntries(printable)).filter((t) => /\d/.test(t) && !covered.has(t) && t !== mod.guide.asOf)
    assert.deepEqual(loose, [], 'figures printed without a reference')
  })

  test(`${name}: every reference is used, and listed exactly once under Additional resources`, () => {
    const used = new Set(mod.pageEntries().flatMap((e) => e.src))
    assert.deepEqual(Object.keys(mod.sources).filter((k) => !used.has(k)), [], 'declared but never used')
    const listed = mod.resources.flatMap((g) => g.items.map((i) => i.key))
    assert.deepEqual([...listed].sort(), Object.keys(mod.sources).sort(), 'every reference once in a resource group')
    for (const g of mod.resources) {
      assert.ok(g.title && g.items.length, 'a named, non-empty group')
      for (const i of g.items) assert.ok(i.name && !/^\d|\[\d/.test(i.name), `${i.key}: a plain name, no number`)
    }
  })

  test(`${name}: first-hand accounts are backed by the discussions they came from, never a plain fact`, () => {
    const fh = mod.pageEntries().filter((e) => e.firstHand)
    assert.ok(fh.length >= 3)
    for (const e of fh) assert.ok(e.src.some((k) => /reddit\.com\/r\//.test(mod.sources[k].url)), `first-hand without a thread: ${e.text}`)
    for (const e of mod.pageEntries().filter((x) => !x.firstHand)) {
      assert.ok(e.src.some((k) => !/reddit\.com/.test(mod.sources[k].url)), `a fact backed only by a discussion: ${entryText(e)}`)
    }
  })

  test(`${name}: calm wording — no exclamation marks, hype or guarantees`, () => {
    const all = strings(Object.fromEntries(Object.entries(mod).filter(([k]) => k !== 'sources'))).join('\n')
    assert.doesNotMatch(all, /!/, 'no exclamation marks')
    assert.doesNotMatch(all, /\b(secret|guarantee[sd]?|in demand|in-demand|hot jobs?|booming|act now|don't miss|hurry|easy money|get rich)\b/i)
    assert.doesNotMatch(all, /\b(pay|buy)\b[^.]*\b(résumé|resume|ticket|certificat\w*)\b[^.]*\b(get|gets|got) (you )?hired\b/i)
  })

  test(`${name}: the hero carries one answer and three readings`, () => {
    assert.ok(mod.guide.answer.text && mod.guide.answer.src.length)
    assert.doesNotMatch(mod.guide.answer.text, /\d/, 'the answer sentence states no figure (figures live in the tiles)')
    assert.equal(mod.tiles.length, 3)
    for (const t of mod.tiles) {
      assert.match(t.value, /\d/)
      assert.ok(t.value.length <= 18, `${t.label}: one line on a phone`)
      assert.ok(t.src.length && t.src.every((k) => mod.sources[k]))
    }
  })

  test(`${name}: the menu — named rows, a one-line summary each, a FAQ row with the module's own FAQ`, () => {
    assert.ok(mod.menu.length >= 4 && mod.menu.length <= 8)
    const ids = mod.menu.map((r) => r.id)
    assert.equal(new Set(ids).size, ids.length)
    assert.ok(!ids.includes('resources') && !ids.includes('listings'), 'reserved ids')
    for (const r of mod.menu) {
      assert.match(r.id, /^[a-z0-9-]+$/)
      assert.ok(r.title && r.summary && r.summary.length <= 46, `${r.id}: summary fits one line on a phone`)
      assert.ok(r.blocks.length > 0)
    }
    const faqRow = mod.menu.find((r) => r.blocks.some((b) => b.type === 'faq'))
    assert.ok(faqRow, 'a FAQ row')
    assert.equal(faqRow.blocks.find((b) => b.type === 'faq').items, mod.faq, 'the visible FAQ is the module FAQ')
    assert.ok(mod.faq.length >= 4 && mod.faq.length <= 6)
    for (const { q, a } of mod.faq) assert.ok(/\?$/.test(q) && a.src.length && a.text.split(/(?<=\.)\s/).length <= 3, q)
  })

  test(`${name}: the rendered page never says "source", prints no citation numbers, and keeps its FAQ JSON-LD in sync`, async () => {
    const { html, text } = await pageText(mod)
    assert.doesNotMatch(text, /\bsources?\b|\bsourced\b|\bcited?\b|citation/i, 'no "sources" anywhere in the UI')
    assert.doesNotMatch(text, /Read from |Every figure|linked to its/i)
    assert.doesNotMatch(text.split('Additional resources')[0], /reddit|\br\/[a-z]/i, 'no discussion site named in the body (its links sit under Additional resources)')
    assert.doesNotMatch(html, /href="#[a-z]+-src-\d+"/, 'no numbered reference links')
    assert.match(text, /Updated [A-Z][a-z]+ \d{4}/)
    assert.match(text, /Additional resources/)
    assert.equal((html.match(/<h1\b/g) || []).length, 0, 'the template adds no h1 (the header passed in is the one)')
    assert.doesNotMatch(html, /ui-btn--primary/, 'no filled button')
    // Every menu row is a closed native disclosure with its id (a #hash opens it).
    for (const r of mod.menu) assert.match(html, new RegExp(`<details[^>]*id="${r.id}"`))
    assert.doesNotMatch(html, /<details[^>]*\bopen\b/, 'every row starts closed')
    // FAQ JSON-LD = the visible FAQ.
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([^]*?)<\/script>/)[1])
    assert.equal(ld['@type'], 'FAQPage')
    assert.deepEqual(ld.mainEntity.map((x) => [x.name, x.acceptedAnswer.text]), mod.faq.map((f) => [f.q, f.a.text]))
    for (const f of mod.faq) assert.ok(text.includes(f.q), `visible: ${f.q}`)
    // Every reference is reachable as a plain link.
    for (const s of Object.values(mod.sources)) assert.ok(html.includes(`href="${s.url.replace(/&/g, '&amp;')}"`), `link: ${s.url}`)
  })
}

test('oilfield: nothing the research marked UNVERIFIED or CONFLICTING is printed', () => {
  const all = strings(oil).join('\n')
  for (const bad of [
    'Dallas Fed', 'dallasfed', '25.5', '21.4', '98.70', '$84', '$50', '$80,000', '$16.00', '16.50', '$76,000',
    '$69,960', 'wagedex', 'ziprecruiter', 'recruitee', '$17.50', '$15.25', '$239.99', '$145', '$108',
    'Field Specialist Trainee', 'Basic Energy', 'r/Roughnecks', '114,500',
  ]) assert.ok(!all.includes(bad), `forbidden on the oilfield page: ${bad}`)
})

test('trades: nothing the research marked UNVERIFIED or CONFLICTING is printed', () => {
  const all = strings(trades).join('\n')
  for (const bad of [
    '4 of 9', 'stanine', '60%/65%/70%', '65%', '$9,000', '$4,800', '$10,000', '$7,000', '$6,500', '$2,080', 'CRST',
    'Vestas', '$27,048', '$45k', 'Northwest Lineman College', '$80,000', '$89,260', 'Werner', 'Swift', '$22/hr',
  ]) assert.ok(!all.includes(bad), `forbidden on the trades page: ${bad}`)
  assert.match(strings(trades.freeHelp).join(' '), /January 31, 2029/)
})

// Values the research marked unverified / conflicting, or that a fact-check removed: they must never come back.
// (Module strings only — a live listing row may still name, say, a hospital.)
const FORBIDDEN = {
  tesla: [
    '5.75', '5.71', 'All car-assembly plants', '?query=', "customers' homes", '$23.46–$25.76', '0 of 4',
    'Tesla provides the required tools', 'Applicants must have some previous automotive training', 'Selected applicants are notified',
    'away from the plants', 'that carry stock', 'promoted from inside in 2025', 'cleanroom', '60 lbs for service',
    '85%', '2,700', '$2700', '12 weeks', 'drug test', 'BBB', '$70,263', '$73,507', '$75,376', 'Gomez', '$49,650', 'Diaz',
    '$1,533', '$137', '$3.2', '$70k', '$135,000', '$18.88', '$28.32', 'Musk', 'TSLA', 'EEOC', 'WhatsApp',
  ],
  healthcare: [
    '160 hours', '170 hours', '120 hours', '1,200–1,800', '1,200 to 1,800', '$155', '$5,250', 'MA-Phlebotomist', 'MA-Certified',
    'MA-Registered', 'only 4 states', '59 classroom', '30 supervised', 'NH 22-21', 'LeadingAge', 'Gundersen', 'Cleveland Clinic',
    'Intermountain', '53 Job Corps', 'Cabrera', 'COVID', '1,023.8', '2-year RN',
  ],
  spacex: [
    '$135', '$161', 'SPCX', 'Nasdaq', 'IPO', 'valuation', 'xAI', 'merger', 'NLRB', 'Bautista', '$115,850', 'LeBlanc', '60-hour',
    '5 × 12', '4x10', 'tuition assistance', '19 postings', '8569279002', '187 postings', 'Paint Technician',
  ],
  it: [
    '$274', '$548', '$265', '$253', '$399', '$439', '$425', '$550', '$70,000', '70,000+', 'Lightcast', '717,190', 'wagedex',
    '128,500', 'layoffs', '220%', 'MS-900', 'AB-900', '80% placement', '$21/hr', 'LaunchCode', 'Geek Squad', 'AppleCare',
    'Prehired', 'Apprenticeships for Tech', 'ACE credit', '$55K', 'June 11, 2027', 'SY0-701', '$105k', 'Touchstone',
    'people who enrolled', 'independent federal study', 'many employers accept', 'come next', 'of these jobs require',
    'benchmark average', 'almost every account', 'Detroit', 'two different job rates', '80% employed', 'launches on or around',
    'Staffing and outsourcing', 'outside IT companies', 'Austen Allred',
  ],
  warehouse: [
    'rising to $23', 'year five', '151,980', 'DHL', 'GXO', 'Home Depot', "Lowe's", 'Costco', 'Kroger', 'Ocado', '$17.60', '$18.10',
    '$17.25', '$17.75', 'FedEx Ground', 'HB 5567', 'HB 2547', 'S. 2613', 'gvwire',
  ],
  cdl: [
    '$3,900', '$7,995', '12–26 months', 'Swift Academy', '$4–5k', '$15,000', '$250/month', '$200/month', 'Covenant',
    '$600-$850', '$4,200', '$6,500', '10-month', '94.0', 'UPS CDL Apprentice', 'careerhirings', 'careerbit', 'H-2A', 'H-2B',
    'D.C. Circuit', 'English-only', 'Schedule III', 'AB 692', 'stay-or-pay', 'FreightWaves', 'more than 10,000 providers',
    '110 schools', 'hair test', 'Eligible Training Provider List', 'Fortune', 'Western Nevada', 'FAFSA', 'Pell', 'Labatt',
    '$65k–$90k', '$270/day',
  ],
}
for (const [name, mod] of GUIDE_MODS) {
  if (!FORBIDDEN[name]) continue
  test(`${name}: nothing the research or the fact-check ruled out is printed`, () => {
    const all = strings(Object.fromEntries(Object.entries(mod).filter(([k]) => k !== 'sources'))).join('\n')
    for (const bad of FORBIDDEN[name]) assert.ok(!all.includes(bad), `forbidden on the ${name} page: ${bad}`)
  })
}

test('the candid parts are still said', () => {
  const o = strings(oil).join('\n')
  assert.match(o, /2025 was a down year/)
  assert.match(o, /None of the six lists SafeLand, H2S, OSHA 10 or first aid/)
  assert.match(o, /is considered a certification/)
  const t = strings(trades).join('\n')
  assert.match(t, /"four, five, six or more times the number of new apprenticeship openings/)
  assert.match(t, /"Previous knowledge of electrical work is not required\."/)
  assert.match(t, /single locals' rates/)
  assert.match(t, /does not say what you owe if you leave early/)
  assert.match(t, /independently owned/)
})

test('listing rows: only matches with a listing page, each once, at most 12, never filler', () => {
  const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const jobs = [
    { id: id(1), title: 'Floorhand', related: true, in_radius: true },
    { id: id(1), title: 'Floorhand (dup)', related: true },
    { id: id(2), title: 'Cashier', related: false },
    { id: 'abc', title: 'No page' },
    { id: id(3), title: '  ' },
    { id: id(4), title: 'Far away', related: true, in_radius: false },
    ...Array.from({ length: 20 }, (_, i) => ({ id: id(10 + i), title: `Roustabout ${i}`, related: true })),
  ]
  const rows = guideListingRows({ jobs })
  assert.equal(rows.length, GUIDE_MAX_ROWS)
  assert.equal(rows[0].title, 'Floorhand')
  assert.ok(!rows.some((r) => r.title === 'Far away'), 'a fill-in from outside the radius is not shown')
  assert.deepEqual(guideListingRows({ jobs, fallback: 'unrelated' }), [])
  assert.deepEqual(guideListingRows(null), [])
})
