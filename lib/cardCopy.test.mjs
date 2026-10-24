import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  companySlug, companyUrl, dayCount, inDays, outcomeHeadline, daysLabel, subLine, metaLine,
  contextStrip, outcomeShareText, companyVerdict, companyStatPairs, confidenceLine,
  companyShareText, ogNoDataLines, pageTitle, pageDescription, GHOST_MIN_DAYS,
} from './cardCopy.js'
import { INK, TEXT, ACCENTS, contrast, whiteOnInk, accentKeyForOutcome, accentKeyForRisk } from './cardTheme.js'
import { detectAiSlop } from './humanizer/detectAiSlop.js'
import { BUILTIN_PHRASE_RULES, findPhraseMatches } from './humanizer/phraseRisk.js'

const OUTCOMES = ['ghosted', 'rejected', 'hired', 'offer', 'interview', 'waiting']
const COMPANIES = ['Walmart', 'Chipotle Mexican Grill', 'Ledgent Technology', 'Insight Global', 'H&M', "Lowe's", 'Target']
const DAYS = [null, 0, 1, 2, 5, 9, 12, 23, 47]

// Every sentence any surface can generate, for the voice rules below.
function everyString() {
  const out = []
  for (const outcome of OUTCOMES) for (const company of COMPANIES) for (const days of DAYS) for (const reachedInterview of [false, true]) {
    out.push(outcomeHeadline({ outcome, company, days, reachedInterview }).text)
    out.push(daysLabel({ outcome, days }))
    out.push(outcomeShareText({ outcome, company, days, reachedInterview }))
  }
  for (const [ghostRate, responseRate, avgWaitDays, n] of [[0.13, 0.87, 9, 48], [0.52, 0.48, 0, 7], [0.3, 0.6, 14, 12], [0.62, 0.38, 3, 1]]) {
    out.push(companyVerdict({ ghostRate, responseRate }))
    for (const p of companyStatPairs({ ghostRate, responseRate, avgWaitDays })) out.push(`${p.value} ${p.label}`)
    out.push(confidenceLine(n, 'Oct 19, 2026'), confidenceLine(0, null))
    for (const risk of ['safe', 'warn', 'danger']) for (const company of COMPANIES) {
      out.push(companyShareText({ company, grade: 'B', score: 66, ghostRate, responseRate, risk }))
      out.push(pageTitle({ company, grade: 'B', ghostRate }), pageTitle({ company }))
      out.push(pageDescription({ company, grade: 'B', ghostRate, responseRate, reports: n }), pageDescription({ company }))
      out.push(...ogNoDataLines(company))
    }
  }
  out.push(subLine('Crew Member', 'Indeed'), subLine('', 'Indeed'), subLine('Crew Member', ''), metaLine(Date.UTC(2026, 9, 20, 12), 'Phoenix, AZ'))
  return out
}

test('one slug scheme: lowercase, spaces to hyphens, URI-encoded, punctuation kept', () => {
  assert.equal(companySlug('Chipotle Mexican Grill'), 'chipotle-mexican-grill')
  assert.equal(companySlug('H&M'), 'h%26m')
  assert.equal(companySlug("  Lowe's "), "lowe's")
  assert.equal(companyUrl('Walmart'), 'seenjobs.io/company/walmart')
  assert.equal(companyUrl(''), 'seenjobs.io')
})

test('counts read like a person: the same day, a day, 1 day, 2 days', () => {
  assert.equal(inDays(0), 'the same day')
  assert.equal(inDays(1), 'in a day')
  assert.equal(inDays(9), 'in 9 days')
  assert.equal(dayCount(1), '1 day')
  assert.equal(dayCount(2), '2 days')
  assert.equal(dayCount(0), '0 days')
})

test('headline per outcome, company set apart as the accent part', () => {
  const h = outcomeHeadline({ outcome: 'ghosted', company: 'Walmart', days: 23 })
  assert.equal(h.text, 'Walmart never wrote back.')
  assert.deepEqual(h.parts, [{ text: 'Walmart', accent: true }, { text: ' never wrote back.', accent: false }])
  assert.equal(outcomeHeadline({ outcome: 'ghosted', company: 'Walmart', days: 40, reachedInterview: true }).text, 'Walmart interviewed me, then went silent.')
  assert.equal(outcomeHeadline({ outcome: 'rejected', company: 'Target', days: 9 }).text, 'Target said no in 9 days.')
  assert.equal(outcomeHeadline({ outcome: 'rejected', company: 'Target', days: 0 }).text, 'Target said no the same day.')
  assert.equal(outcomeHeadline({ outcome: 'rejected', company: 'Target', days: 1 }).text, 'Target said no in a day.')
  assert.equal(outcomeHeadline({ outcome: 'rejected', company: 'Target', days: null }).text, 'Target said no.')
  assert.equal(outcomeHeadline({ outcome: 'hired', company: 'Target', days: 12 }).text, 'Target said yes in 12 days.')
  assert.equal(outcomeHeadline({ outcome: 'offer', company: 'Target', days: 12 }).text, 'Target said yes in 12 days.')
  assert.equal(outcomeHeadline({ outcome: 'interview', company: 'Target', days: 5 }).text, 'Target called back in 5 days.')
  assert.equal(outcomeHeadline({ outcome: 'ghosted', company: 'Chipotle Mexican Grill', days: 23 }).text, 'Chipotle Mexican Grill never wrote back.')
})

test(`a ghosted outcome under ${GHOST_MIN_DAYS} days is "no reply yet", never ghosting`, () => {
  for (const days of [0, 1, 3, 6]) {
    assert.equal(outcomeHeadline({ outcome: 'ghosted', company: 'Ledgent Technology', days }).text, "Ledgent Technology hasn't written back yet.")
    const share = outcomeShareText({ outcome: 'ghosted', company: 'Ledgent Technology', days })
    assert.ok(!/ghost(ed)? /i.test(share.replace(/who ghosts/g, '')), share)
    assert.ok(!/never wrote back/.test(share), share)
  }
  assert.equal(outcomeHeadline({ outcome: 'ghosted', company: 'Ledgent Technology', days: 7 }).text, 'Ledgent Technology never wrote back.')
})

test('labels under the number follow the outcome and the plural', () => {
  assert.equal(daysLabel({ outcome: 'ghosted', days: 23 }), 'days without a reply')
  assert.equal(daysLabel({ outcome: 'ghosted', days: 1 }), 'day without a reply')
  assert.equal(daysLabel({ outcome: 'rejected', days: 9 }), 'days to a decision')
  assert.equal(daysLabel({ outcome: 'hired', days: 12 }), 'days to a decision')
  assert.equal(daysLabel({ outcome: 'interview', days: 5 }), 'days to an interview')
})

test('sub-line and meta omit missing parts cleanly', () => {
  assert.equal(subLine('Cosmetics Cashier', 'Indeed'), 'Cosmetics Cashier · applied via Indeed')
  assert.equal(subLine('Cosmetics Cashier', ''), 'Cosmetics Cashier')
  assert.equal(subLine('', 'Indeed'), 'applied via Indeed')
  assert.equal(subLine('', ''), '')
  assert.equal(metaLine(Date.UTC(2026, 9, 20, 12), 'Phoenix, AZ'), 'OCT 2026 · PHOENIX, AZ')
  assert.equal(metaLine(Date.UTC(2026, 9, 20, 12), ''), 'OCT 2026')
  // 2026-11-01 03:00 UTC is still Oct 31 in California.
  assert.equal(metaLine(Date.UTC(2026, 10, 1, 3), ''), 'OCT 2026')
  assert.equal(metaLine(NaN, 'Austin, TX'), 'AUSTIN, TX')
})

test('context strip only when a grade exists; never invented', () => {
  assert.equal(contextStrip('Walmart', null), null)
  assert.equal(contextStrip('Walmart', undefined), null)
  assert.deepEqual(contextStrip('Walmart', { grade: 'A', score: 91, ghostRate: 0.13, responseRate: 0.87 }),
    { before: 'Walmart · Seen grade ', letter: 'A', after: ' · 13% of applicants get ghosted' })
})

test('share text: specific, first person, the bare URL last, under 240 characters', () => {
  for (const outcome of OUTCOMES) for (const company of COMPANIES) for (const days of DAYS) for (const reachedInterview of [false, true]) {
    const s = outcomeShareText({ outcome, company, days, reachedInterview })
    assert.ok(s.length <= 240, `${s.length}: ${s}`)
    assert.ok(s.endsWith(companyUrl(company)), s)
    assert.ok(!/[.!?,:]$/.test(s), s)
    assert.ok(s.includes(company), s)
    if (days != null && outcome !== 'waiting') assert.ok(/\d|same day|a day/.test(s), s)
  }
  assert.equal(outcomeShareText({ outcome: 'rejected', company: 'Target', days: 1 }).includes('1 days'), false)
  // The owner's examples are matched or beaten, never templated across outcomes.
  const texts = new Set(OUTCOMES.map(o => outcomeShareText({ outcome: o, company: 'Walmart', days: 9 })))
  assert.equal(texts.size, OUTCOMES.length - 1) // hired and offer are the same story
})

test('no em dashes, en dashes, filler or AI-slop phrases in any generated copy', () => {
  const FILLER = /\b(leverag\w*|journey|unlock\w*|game.?changer|utiliz\w*|seamless\w*|empower\w*|elevate\w*|delve)\b/i
  const all = everyString()
  assert.ok(all.length > 500)
  for (const s of all) {
    assert.ok(!/[—–]/.test(s), `dash in: ${s}`)
    assert.ok(!FILLER.test(s), `filler in: ${s}`)
    assert.deepEqual(detectAiSlop(s, BUILTIN_PHRASE_RULES), [], `slop in: ${s}`)
    assert.deepEqual(findPhraseMatches(s, BUILTIN_PHRASE_RULES), [], `phrase risk in: ${s}`)
    assert.ok(!/\s{2,}/.test(s), `double space in: ${s}`)
  }
})

test('company card copy: the page verdict (dash-free), stat pairs without a 0 wait, confidence line', () => {
  assert.equal(companyVerdict({ ghostRate: 0.13, responseRate: 0.87 }), 'Most applicants hear back. 87% get a response.')
  assert.equal(companyVerdict({ ghostRate: 0.52, responseRate: 0.48 }), 'Most applicants never hear back. 5 in 10 are ghosted.')
  assert.equal(companyVerdict({ ghostRate: 0.3, responseRate: 0.6 }), 'Mixed: about 60% of applicants hear back, 30% are ghosted.')
  assert.deepEqual(companyStatPairs({ ghostRate: 0.13, responseRate: 0.87, avgWaitDays: 9 }),
    [{ value: '13%', label: 'ghost rate' }, { value: '87%', label: 'hear back' }, { value: '9-day', label: 'typical wait' }])
  assert.equal(companyStatPairs({ ghostRate: 0.52, responseRate: 0.48, avgWaitDays: 0 }).length, 2)
  assert.equal(companyStatPairs({ ghostRate: 0.52, responseRate: 0.48 }).length, 2)
  assert.equal(confidenceLine(48, 'Oct 19, 2026'), 'Based on 48 applicant reports · updated Oct 19, 2026')
  assert.equal(confidenceLine(48, 'Last updated Oct 19, 2026'), 'Based on 48 applicant reports · updated Oct 19, 2026')
  assert.equal(confidenceLine(1, null), 'Based on 1 applicant report')
  assert.equal(confidenceLine(0, null), 'Baseline estimate. Share your experience to sharpen it.')
})

test('company share text ends with the URL and names the real numbers', () => {
  const t = companyShareText({ company: 'Insight Global', grade: 'D', score: 38, ghostRate: 0.52, responseRate: 0.48, risk: 'danger' })
  assert.equal(t, 'Insight Global ghosts 52% of applicants. Seen grade D, 38/100. Look before you apply: seenjobs.io/company/insight-global')
  const w = companyShareText({ company: 'Walmart', grade: 'A', score: 91, ghostRate: 0.13, responseRate: 0.87, risk: 'safe' })
  assert.ok(w.endsWith('seenjobs.io/company/walmart') && w.includes('87%') && w.includes('grade A'), w)
})

test('unfurl + page metadata: honest when no grade exists, specific when one does', () => {
  assert.deepEqual(ogNoDataLines('Ledgent Technology'), [
    'Nobody has rated how Ledgent Technology treats applicants yet.',
    'Someone just tracked an application here. Be the first to grade them.',
  ])
  assert.equal(pageTitle({ company: 'Walmart', grade: 'A', ghostRate: 0.13 }), 'Walmart: Seen grade A, 13% ghost rate')
  assert.equal(pageTitle({ company: 'Ledgent Technology' }), 'Ledgent Technology on Seen: who replies, who ghosts')
  assert.equal(pageDescription({ company: 'Walmart', grade: 'A', ghostRate: 0.13, responseRate: 0.87, reports: 48 }),
    'Walmart replies to 87% of applicants and ghosts 13%, from 48 applicant reports on Seen. See the grade, the typical wait and real outcomes before you apply.')
  assert.ok(pageDescription({ company: 'Ledgent Technology' }).startsWith('Nobody has graded how Ledgent Technology treats applicants yet.'))
  for (const s of everyString()) assert.ok(!/transparency score/i.test(s), s)
})

test('theme: every text tier and every accent clears 4.5:1 on the ink', () => {
  for (const [name, alpha] of Object.entries(TEXT)) {
    const ratio = contrast(whiteOnInk(alpha), INK)
    assert.ok(ratio >= 4.5, `${name} (${alpha}) = ${ratio.toFixed(2)}`)
  }
  for (const [name, a] of Object.entries(ACCENTS)) {
    const ratio = contrast(a.hex, INK)
    assert.ok(ratio >= 4.5, `${name} ${a.hex} = ${ratio.toFixed(2)}`)
  }
  assert.equal(accentKeyForOutcome('offer'), 'hired')
  assert.equal(accentKeyForOutcome('autoreject'), 'rejected')
  assert.equal(accentKeyForRisk('danger'), 'ghosted')
  assert.equal(accentKeyForRisk('warn'), 'rejected')
})
