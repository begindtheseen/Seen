import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  companySlug, companyUrl, dayCount, inDays, outcomeHeadline, daysLabel, subLine, metaLine,
  contextStrip, outcomeShareText, companyVerdict, companyStatPairs, confidenceLine,
  companyShareText, ogNoDataLines, pageTitle, pageDescription, TITLE_MAX, GHOST_MIN_DAYS, timelineLine, eventDays,
} from './cardCopy.js'
import { INK, TEXT, ACCENTS, contrast, whiteOnInk, accentKeyForOutcome, accentKeyForRisk } from './cardTheme.js'
import { detectAiSlop } from './humanizer/detectAiSlop.js'
import { BUILTIN_PHRASE_RULES, findPhraseMatches } from './humanizer/phraseRisk.js'

const OUTCOMES = ['ghosted', 'rejected', 'hired', 'offer', 'interview', 'waiting']
const COMPANIES = ['Walmart', 'Chipotle Mexican Grill', 'Ledgent Technology', 'Insight Global', 'H&M', "Lowe's", 'Target']
const DAYS = [null, 0, 1, 2, 5, 9, 12, 23, 47]
const GRADES = [null, { grade: 'A', ghostRate: 0.13, responseRate: 0.87, avgWaitDays: 9, reports: 48 }, { grade: 'D', ghostRate: 0.41, responseRate: 0.52, avgWaitDays: 24, reports: 7 }, { grade: 'C', ghostRate: 0.22, responseRate: 0.55, avgWaitDays: 0, reports: 3 }]
const T0 = Date.UTC(2026, 9, 3, 16) // Oct 3, 2026 09:00 PT
const DAY = 86400000
const SAMPLE_EVENTS = [
  { type: 'application_submitted', date: T0 },
  { type: 'response_received', date: T0 + 2 * DAY },
  { type: 'interview_received', date: T0 + 4 * DAY },
  { type: 'interview_completed', date: T0 + 8 * DAY },
  { type: 'offer_received', date: T0 + 12 * DAY },
]

// Every sentence any surface can generate, for the voice rules below.
function everyString() {
  const out = []
  for (const outcome of OUTCOMES) for (const company of COMPANIES) for (const days of DAYS) for (const reachedInterview of [false, true]) {
    out.push(outcomeHeadline({ outcome, company, days, reachedInterview }).text)
    out.push(daysLabel({ outcome, days }))
    for (const grade of GRADES) {
      out.push(outcomeShareText({ outcome, company, days, reachedInterview, grade }))
      out.push(outcomeShareText({ outcome, company, days, reachedInterview, grade, others: ['C', 'D'] }))
      const strip = contextStrip(company, grade, { outcome, days })
      if (strip) out.push(`${strip.letter} ${strip.text} ${strip.based}`.trim())
    }
    out.push(timelineLine(SAMPLE_EVENTS, { outcome }), timelineLine([], { outcome, appliedMs: T0 }))
  }
  for (const [ghostRate, responseRate, avgWaitDays, n] of [[0.13, 0.87, 9, 48], [0.52, 0.48, 0, 7], [0.3, 0.6, 14, 12], [0.62, 0.38, 3, 1]]) {
    out.push(companyVerdict({ ghostRate, responseRate }))
    for (const p of companyStatPairs({ ghostRate, responseRate, avgWaitDays })) out.push(`${p.value} ${p.label}`)
    out.push(confidenceLine(n, 'Oct 19, 2026'), confidenceLine(0, null))
    for (const risk of ['safe', 'warn', 'danger']) for (const company of COMPANIES) {
      out.push(companyShareText({ company, grade: 'B', score: 66, ghostRate, responseRate, risk }))
      out.push(pageTitle({ company, reports: n, graded: true }), pageTitle({ company, reports: n, graded: false }), pageTitle({ company }))
      const base = { company, grade: 'B', score: 66, basis: `${n} applicant reports and 3 online mentions`, reports: n, minReports: 5 }
      for (const updated of ['Oct 2026', '']) {
        out.push(pageDescription({ ...base, graded: true, ratesShown: true, responsePct: Math.round(responseRate * 100), ghostPct: Math.round(ghostRate * 100), waitDays: avgWaitDays, updated }))
        out.push(pageDescription({ ...base, graded: true, ratesShown: false, updated }))
        out.push(pageDescription({ ...base, graded: false, ratesShown: false, updated }))
      }
      out.push(...ogNoDataLines(company), ...ogNoDataLines(company, 1), ...ogNoDataLines(company, 3))
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
  // Hired: the person's number first, the company rides in the sub-line (no mad-lib slot).
  assert.equal(outcomeHeadline({ outcome: 'hired', company: 'Target', days: 12 }).text, 'Offer in 12 days.')
  assert.deepEqual(outcomeHeadline({ outcome: 'hired', company: 'Target', days: 12 }).parts, [{ text: 'Offer in 12 days.', accent: false }])
  assert.equal(outcomeHeadline({ outcome: 'offer', company: 'Target', days: 0 }).text, 'Offer the same day.')
  assert.equal(outcomeHeadline({ outcome: 'hired', company: 'Target', days: null }).text, 'Got the offer.')
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

test('sub-line: role · platform, never "applied via", never the brand as a platform', () => {
  assert.equal(subLine('Cosmetics Cashier', 'Indeed'), 'Cosmetics Cashier · Indeed')
  assert.equal(subLine('Cosmetics Cashier', ''), 'Cosmetics Cashier')
  assert.equal(subLine('', 'Indeed'), 'Indeed')
  assert.equal(subLine('', ''), '')
  assert.equal(subLine('Produce Clerk', 'Seen', 'Sprouts'), 'Sprouts · Produce Clerk')
  assert.equal(subLine('Produce Clerk', 'seenjobs.io'), 'Produce Clerk')
  assert.equal(subLine('Produce Clerk', 'Indeed', 'Sprouts'), 'Sprouts · Produce Clerk · Indeed')
  assert.equal(metaLine(Date.UTC(2026, 9, 20, 12), 'Phoenix, AZ'), 'OCT 2026 · PHOENIX, AZ')
  assert.equal(metaLine(Date.UTC(2026, 9, 20, 12), ''), 'OCT 2026')
  // 2026-11-01 03:00 UTC is still Oct 31 in California.
  assert.equal(metaLine(Date.UTC(2026, 10, 1, 3), ''), 'OCT 2026')
  assert.equal(metaLine(NaN, 'Austin, TX'), 'AUSTIN, TX')
})

test('context line explains the story, never argues with it; omitted when the data does neither', () => {
  const A = { grade: 'A', ghostRate: 0.13, responseRate: 0.87, avgWaitDays: 9, reports: 48 }
  const D = { grade: 'D', ghostRate: 0.41, responseRate: 0.52, avgWaitDays: 24, reports: 7 }
  const mid = { grade: 'C', ghostRate: 0.22, responseRate: 0.55, avgWaitDays: 0, reports: 3 }
  assert.equal(contextStrip('Walmart', null, { outcome: 'ghosted', days: 23 }), null)
  // ghosted at a high-reply company: own it
  assert.deepEqual(contextStrip('Walmart', A, { outcome: 'ghosted', days: 23 }),
    { letter: 'A', text: 'Walmart replies to 87% of applicants. Not this time.', based: 'based on 48 reports' })
  // ghosted at a low-reply company: company, not the person
  assert.deepEqual(contextStrip('Insight Global', D, { outcome: 'ghosted', days: 40 }),
    { letter: 'D', text: 'Insight Global ghosts 41% of applicants. Not the only one.', based: 'based on 7 reports' })
  assert.equal(contextStrip('Insight Global', D, { outcome: 'ghosted', days: 40, name: 'Jordan' }).text, 'Insight Global ghosts 41% of applicants. Jordan is not alone.')
  // hired fast at a slow company
  assert.equal(contextStrip('Target', D, { outcome: 'hired', days: 12 }).text, 'Most applicants wait 3+ weeks here.')
  assert.equal(contextStrip('Target', A, { outcome: 'hired', days: 12 }).text, 'Target replies to 87% of applicants.')
  // rejected
  assert.equal(contextStrip('Target', A, { outcome: 'rejected', days: 9 }).text, 'Target replies to 87% of applicants.')
  assert.equal(contextStrip('Target', D, { outcome: 'rejected', days: 9 }).text, 'Target ghosts 41% of applicants. At least this was an answer.')
  // a long company name becomes "They" so the line never needs an ellipsis
  assert.equal(contextStrip('Chipotle Mexican Grill', D, { outcome: 'rejected', days: 9 }).text, 'They ghost 41% of applicants. At least this was an answer.')
  assert.equal(contextStrip('United Wholesale Mortgage', A, { outcome: 'ghosted', days: 23 }).text, 'They reply to 87% of applicants. Not this time.')
  // neither supports nor explains → no line; under 5 reports → no denominator
  assert.equal(contextStrip('Target', mid, { outcome: 'ghosted', days: 23 }), null)
  assert.equal(contextStrip('Target', { ...mid, responseRate: 0.7 }, { outcome: 'ghosted', days: 23 }).based, '')
  for (const s of [contextStrip('Walmart', A, { outcome: 'ghosted', days: 23 }), contextStrip('Target', D, { outcome: 'hired', days: 12 })]) assert.ok(!/\bSeen\b/.test(s.text), s.text)
})

test('timeline: one line of what happened, ≤ 3 stops, California dates, never "…"', () => {
  assert.equal(timelineLine(SAMPLE_EVENTS, { outcome: 'hired' }), 'Applied Oct 3 · Interviewed Oct 11 · Offer Oct 15')
  assert.equal(timelineLine(SAMPLE_EVENTS.slice(0, 1), { outcome: 'ghosted' }), 'Applied Oct 3 · no reply since')
  assert.equal(timelineLine(SAMPLE_EVENTS.slice(0, 3), { outcome: 'ghosted' }), 'Applied Oct 3 · Interview Oct 7 · silent since')
  assert.equal(timelineLine([{ type: 'application_submitted', date: T0 }, { type: 'rejected', date: T0 + 9 * DAY }], { outcome: 'rejected' }), 'Applied Oct 3 · Rejected Oct 12')
  assert.equal(timelineLine([], { outcome: 'ghosted', appliedMs: T0 }), 'Applied Oct 3 · no reply since')
  assert.equal(timelineLine([], { outcome: 'waiting', appliedMs: T0 }), 'Applied Oct 3 · waiting')
  assert.equal(timelineLine([], { outcome: 'hired' }), '')
  // 2026-10-04 03:00 UTC is still Oct 3 in California
  assert.equal(timelineLine([{ type: 'application_submitted', date: Date.UTC(2026, 9, 4, 3) }], { outcome: 'waiting' }), 'Applied Oct 3 · waiting')
  assert.deepEqual(eventDays(SAMPLE_EVENTS, T0), [{ day: 2, kind: 'reply' }, { day: 4, kind: 'interview' }, { day: 8, kind: 'interview' }])
  assert.deepEqual(eventDays([], T0), [])
  for (const s of everyString()) assert.ok(!s.includes('…'), s)
})

test('share text: the person\'s fact, then the data, the product once as the bare URL, under 240 characters', () => {
  for (const outcome of OUTCOMES) for (const company of COMPANIES) for (const days of DAYS) for (const reachedInterview of [false, true]) for (const grade of GRADES) for (const others of [undefined, ['C', 'D'], ['A']]) {
    const s = outcomeShareText({ outcome, company, days, reachedInterview, grade, others })
    assert.ok(s.length <= 240, `${s.length}: ${s}`)
    assert.ok(s.endsWith(companyUrl(company)) || s.endsWith(' on seenjobs.io'), s)
    assert.ok(!/[.!?,:]$/.test(s), s)
    assert.ok(s.includes(company), s)
    // the product appears exactly once, and only as the URL / domain — no sentence about Seen
    assert.equal((s.match(/seenjobs\.io/g) || []).length, 1, s)
    assert.ok(!/\bSeen\b/.test(s), s)
    if (grade && outcome !== 'hired' && outcome !== 'offer') assert.ok(/\d+%/.test(s), `no data observation in: ${s}`)
    if (days != null && outcome !== 'waiting') assert.ok(/\d|same day|a day/.test(s), s)
  }
  assert.equal(outcomeShareText({ outcome: 'rejected', company: 'Target', days: 1 }).includes('1 days'), false)
  const A = { grade: 'A', ghostRate: 0.13, responseRate: 0.87 }
  assert.equal(outcomeShareText({ outcome: 'ghosted', company: 'Walmart', days: 23, grade: A }),
    'Applied to Walmart 23 days ago, nothing. Apparently 13% of people get ghosted there: seenjobs.io/company/walmart')
  assert.equal(outcomeShareText({ outcome: 'hired', company: 'Sprouts', days: 12, grade: A }), '12 days, offer, Sprouts. Sprouts was an A: seenjobs.io/company/sprouts')
  assert.equal(outcomeShareText({ outcome: 'hired', company: 'Sprouts', days: 12, grade: A, others: ['C', 'C', 'D'] }), '12 days, offer, Sprouts. The other 3 places I applied were a D or worse on seenjobs.io')
  assert.equal(outcomeShareText({ outcome: 'hired', company: 'Sprouts', days: 12, grade: A, others: ['C'] }), '12 days, offer, Sprouts. The other place I applied was a C on seenjobs.io')
  // one application always posts the same sentence; outcomes do not share a template
  const texts = new Set(OUTCOMES.map(o => outcomeShareText({ outcome: o, company: 'Walmart', days: 9, grade: A })))
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
  assert.equal(t, 'Insight Global ghosts 52% of applicants. Grade D, 38/100. Look before you apply: seenjobs.io/company/insight-global')
  const w = companyShareText({ company: 'Walmart', grade: 'A', score: 91, ghostRate: 0.13, responseRate: 0.87, risk: 'safe' })
  assert.ok(w.endsWith('seenjobs.io/company/walmart') && w.includes('87%') && w.includes('grade A') && !/\bSeen\b/.test(w), w)
})

test('unfurl + page metadata: honest when no grade exists, specific when one does', () => {
  // Never claims anyone tracked an application here — only what the row proves.
  assert.deepEqual(ogNoDataLines('Ledgent Technology'), ['Nobody has graded how Ledgent Technology treats applicants yet.', 'Be the first.'])
  assert.deepEqual(ogNoDataLines('Ledgent Technology', 0), ['Nobody has graded how Ledgent Technology treats applicants yet.', 'Be the first.'])
  assert.equal(ogNoDataLines('Ledgent Technology', 1)[1], '1 applicant report so far, not enough for a grade.')
  assert.equal(ogNoDataLines('Ledgent Technology', 3)[1], '3 applicant reports so far, not enough for a grade.')
  for (const n of [0, 1, 3]) for (const l of ogNoDataLines('X', n)) assert.ok(!/tracked an application/.test(l), l)
  // Search plan 2026-10-24: titles answer "<employer> application status", the longest form under TITLE_MAX.
  assert.equal(pageTitle({ company: 'Walmart', reports: 48, graded: true }), 'Walmart application status: who hears back (48 reports)')
  assert.equal(pageTitle({ company: 'Target', reports: 7, graded: true }), 'Target application status: who hears back (7 reports)')
  assert.equal(pageTitle({ company: 'Aaa', reports: 1, graded: true }), 'Aaa application status: who hears back (1 applicant report)')
  assert.equal(pageTitle({ company: 'Robert Half', reports: 1234, graded: true }), 'Robert Half application status (1,234 applicant reports)')
  // long names step down, never past the plain fallback
  assert.equal(pageTitle({ company: 'Integrity Staffing Solutions', reports: 12, graded: true }), 'Integrity Staffing Solutions application status (12 reports)')
  assert.equal(pageTitle({ company: 'Express Employment Professionals', reports: 12, graded: true }), 'Express Employment Professionals application status')
  const longName = 'Chipotle Mexican Grill Restaurant Holdings International'
  assert.equal(pageTitle({ company: longName, reports: 12, graded: true }), `${longName} application status`)
  assert.equal(pageTitle({ company: 'Ledgent Technology', reports: 3, graded: false }), 'Ledgent Technology application status on Seen')
  for (const company of COMPANIES) for (const reports of [1, 9, 48, 12000]) {
    const t = pageTitle({ company, reports, graded: true })
    assert.ok(t.length <= TITLE_MAX, t)
    assert.ok(t.startsWith(`${company} application status`), t)
  }
  // Description: the answer first, from the same facts, updated month, no invented wait.
  const walmart = { company: 'Walmart', graded: true, ratesShown: true, responsePct: 87, ghostPct: 13, grade: 'A', score: 91, basis: '48 applicant reports and 32 online mentions', reports: 48, minReports: 5, updated: 'Oct 2026' }
  assert.equal(pageDescription({ ...walmart, waitDays: null }),
    '87% of applicants hear back from Walmart; 13% never do. From 48 applicant reports and 32 online mentions, updated Oct 2026. Seen Grade A (91/100). Applicants\' own accounts, not verified facts.')
  assert.match(pageDescription({ ...walmart, waitDays: 9 }), /Average wait to hear back: 9 days\./)
  for (const waitDays of [null, undefined, 0]) assert.doesNotMatch(pageDescription({ ...walmart, waitDays }), /wait/i)
  assert.equal(pageDescription({ ...walmart, ratesShown: false, responsePct: null, ghostPct: null, basis: '2 applicant reports and 6 online mentions', updated: '' }),
    'Walmart has a Seen Grade of A (91/100) from 2 applicant reports and 6 online mentions. Too few applicant reports for a response rate yet (5 needed). Applicants\' own accounts, not verified facts.')
  assert.ok(pageDescription({ company: 'Ledgent Technology', graded: false, reports: 1, minReports: 5 }).startsWith('Ledgent Technology is not graded on Seen yet (1 applicant report so far; a grade needs 5 pieces of evidence).'))
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
