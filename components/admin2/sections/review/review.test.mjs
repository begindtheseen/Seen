// Review's adapter: counts that could not be read stay null ("couldn't count", never 0), the saved
// filters cover exactly the rows they name, a bulk approve's optimistic removal leaves possible
// duplicates in place (the server skips them), the filter line never claims more than is loaded,
// dates are California time, and every request id is a uuid the server accepts.
// Run: node --test components/admin2/sections/review/review.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  KINDS, parseKind, kindCount, waitingLine, matchesHeldView, heldViewCounts, positiveIds, approvableIds, filterNote,
  pruneSelection, moderationFor, patchRows, sourceHref, when, newRequestId, ticketSummary, signalText, heldHasRules,
  parseHeldView, label, snippet, outcomeTone, approvePlan, reviewQueues, nothingToPublishLine, tidyMessage, rulesReadings, outcomeWord, sourceWord,
} from './adapter.ts'

const row = (id, group, flags = [], extra = {}) => ({ id, company_name: 'Acme', outcome: group === 'positive' ? 'interview' : 'ghosted', review: { group, flags }, ...extra })
const ROWS = [
  row('a', 'positive'),
  row('b', 'positive', ['possible_duplicate']),
  row('c', 'needs_eyes', ['no_source_link']),
  row('d', 'needs_eyes', ['anti_gaming_hold']),
  row('e', 'employee_review', ['not_a_hiring_outcome']),
]

test('kinds: every Today queue filter lands on its kind; unknown words fall back to held', () => {
  for (const k of ['held', 'tickets', 'disputes', 'claims', 'replies', 'purchases', 'issues', 'recent', 'dupes']) assert.equal(parseKind(k), k)
  assert.equal(parseKind('listings'), 'tickets')
  assert.equal(parseKind('employers'), 'claims')
  assert.equal(parseKind(''), 'held')
  assert.equal(parseKind('nonsense'), 'held')
  assert.equal(KINDS.length, 9)
  assert.equal(parseKind('clusters'), 'held', 'account clusters are People\'s, not a Review kind')
})

test('kind counts: a number, null when the server could not count it, undefined when not a queue', () => {
  const ov = { queues: [{ key: 'held_reports', count: 13 }, { key: 'data_issues', count: null }, { key: 'listing_tickets', count: 0 }] }
  assert.equal(kindCount('held', ov), 13)
  assert.equal(kindCount('held', ov, 343), 343, 'the held list, once read, is the exact count')
  assert.equal(kindCount('issues', ov), null)
  assert.equal(kindCount('tickets', ov), 0)
  assert.equal(kindCount('recent', ov), undefined)
  assert.equal(kindCount('claims', ov), undefined, 'a queue missing from the answer is unknown, not 0')
  assert.equal(kindCount('claims', undefined), undefined)
})

test('the header line adds up what is waiting and names the counts it could not read', () => {
  assert.equal(waitingLine([{ label: 'Held reports', count: 13 }, { label: 'Listing tickets', count: 4 }]), '17 decisions are waiting.')
  assert.equal(waitingLine([{ label: 'Held reports', count: 0 }]), 'Nothing is waiting for a decision.')
  assert.equal(waitingLine([{ label: 'Held reports', count: 1 }, { label: 'Data issues', count: null }]), "1 decision is waiting. Couldn't count data issues.")
})

test('saved filters cover exactly the rows they name', () => {
  const c = heldViewCounts(ROWS)
  assert.deepEqual([c.all, c.positive, c.needs_eyes, c.duplicates, c.anti_gaming, c.employee, c.no_source], [5, 1, 2, 1, 1, 1, 1], 'Clear positives counts what Approve all positive publishes')
  assert.ok(matchesHeldView(ROWS[1], 'duplicates'))
  assert.ok(!matchesHeldView(ROWS[0], 'duplicates'))
  assert.equal(parseHeldView('bogus'), 'all')
  assert.equal(heldHasRules(ROWS), false, 'the rules filter is offered only when the server sends the result')
  assert.equal(heldHasRules([{ ...ROWS[0], rules: 'fails' }]), true)
  assert.ok(matchesHeldView({ ...ROWS[0], rules: 'fails' }, 'rules_fail'))
})

test('approve all positive sends every positive (duplicates too: the server names them); only the rest leave at once', () => {
  assert.deepEqual(positiveIds(ROWS), ['a', 'b'])
  assert.deepEqual(approvableIds(ROWS, ['a', 'b']), ['a'])
  assert.deepEqual(approvableIds(ROWS, ['a', 'b'], ['b']), ['a', 'b'])
  assert.deepEqual(approvableIds(ROWS, ['b']), ['b'], 'a single id is never filtered')
  assert.deepEqual(approvableIds(ROWS, ['a', 'd']), ['a'], 'anti-gaming holds are skipped too')
})

test('the filter line never claims more than is loaded', () => {
  assert.match(filterNote(5, 5, { total: 5, filtered: false, noun: 'held reports' }), /^5 held reports, all loaded\.$/)
  assert.match(filterNote(2, 5, { total: 5, filtered: true, noun: 'held reports' }), /^2 of 5 held reports match/)
  const capped = filterNote(10, 20000, { total: 20000, truncated: true, filtered: true, noun: 'held reports' })
  assert.match(capped, /Filtering the 20,000 loaded held reports: 10 match\. More exist/)
})

test('selection drops rows that left the list, and keeps its identity when nothing changed', () => {
  const s = new Set(['a', 'z'])
  assert.deepEqual([...pruneSelection(s, ROWS)], ['a'])
  const t = new Set(['a'])
  assert.equal(pruneSelection(t, ROWS), t)
})

test('moderation offers only what does something in each state', () => {
  assert.deepEqual(moderationFor('held'), ['approve', 'reject'])
  assert.deepEqual(moderationFor('live'), ['hold', 'reject'])
  assert.deepEqual(moderationFor('rejected'), ['restore'])
  assert.deepEqual(moderationFor('duplicate'), ['reject'])
  assert.deepEqual(moderationFor(undefined), [])
})

test('a moderation patches the row in place and leaves other rows (and the page object) alone', () => {
  const page = { rows: [{ id: '1', state: 'held' }, { id: '2', state: 'live' }], next: 'x' }
  const out = patchRows(page, [{ id: '1', state: 'live', counted: true }])
  assert.deepEqual(out.rows[0], { id: '1', state: 'live', counted: true })
  assert.equal(out.rows[1], page.rows[1])
  assert.equal(out.next, 'x')
  assert.equal(patchRows(page, [{ id: '9', state: 'live' }]), page)
})

test('source links: only http(s), through the safe-href helper', () => {
  assert.equal(sourceHref({ review: { sourceUrl: 'https://reddit.com/r/x/comments/1' } }), 'https://reddit.com/r/x/comments/1')
  assert.equal(sourceHref({ report_text: 'see https://example.com/a) for more' }), 'https://example.com/a')
  assert.equal(sourceHref({ review: { sourceUrl: 'javascript:alert(1)' }, report_text: 'no link' }), null)
  assert.equal(sourceHref(null), null)
})

test('dates are California time, and a missing date is empty, never "Invalid Date"', () => {
  assert.equal(when('2026-11-10T17:02:00Z'), 'Nov 10, 9:02 AM PT')
  assert.equal(when('2026-07-01T06:30:00Z'), 'Jun 30, 11:30 PM PT', 'daylight time, and the California day')
  assert.equal(when(null), '')
  assert.equal(when('not a date'), '')
})

test('every press gets a fresh uuid request id (the server ignores anything else)', () => {
  const a = newRequestId(), b = newRequestId()
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  assert.notEqual(a, b)
})

test('words: tickets, signals, labels, snippets, tones', () => {
  assert.equal(ticketSummary({ job_id: 'j', reports: { count: 3, expired: 2, unknown: 1 }, dispute: { id: 1, kind: 'still_active', status: 'open' } }), "3 seeker reports (2 say it's closed) · employer dispute: still active")
  assert.equal(ticketSummary({ job_id: 'j' }), 'No reports left')
  assert.equal(signalText({ shared_ip: '203.0.113.4', accounts: 3 }), 'shared ip 203.0.113.4 · accounts 3')
  assert.equal(label('interview_received'), 'Interview received')
  assert.equal(snippet('a'.repeat(200), 20).length, 20)
  assert.equal(snippet('Text [Source: https://x.y]'), 'Text')
  assert.equal(outcomeTone('offer'), 'good')
  assert.equal(outcomeTone('ghosted'), 'bad')
  assert.equal(outcomeTone('assessment'), 'neutral')
})

test('Review sends every request through the core api and never reloads or navigates', () => {
  const here = path.dirname(fileURLToPath(import.meta.url))
  for (const f of readdirSync(here).filter((n) => /\.tsx?$/.test(n))) {
    const src = readFileSync(path.join(here, f), 'utf8')
    assert.ok(!/(?<![.\w]|async )fetch\(/.test(src), `${f} calls fetch directly`)
    assert.ok(!/location\.(reload|href\s*=|assign)|router\.(refresh|push)/.test(src), `${f} reloads or navigates`)
    assert.ok(!/window\.(confirm|alert|prompt)/.test(src), `${f} uses a native dialog`)
    assert.ok(!/id=in\./.test(src), `${f} builds an id list into a URL`)
  }
})

test('bulk approve never publishes anti-gaming holds or possible duplicates unless the owner ticked that row', () => {
  const rows = [
    row('p1', 'positive'), row('p2', 'positive'), row('pd', 'positive', ['possible_duplicate']),
    row('n1', 'needs_eyes'), row('ag', 'needs_eyes', ['anti_gaming_hold']), row('e1', 'employee_review', ['not_a_hiring_outcome']),
  ]
  const pos = approvePlan(rows, 'positive')
  assert.deepEqual(pos.ids, ['p1', 'p2'])
  assert.deepEqual(pos.includeIds, [])
  assert.deepEqual(pos.sendIds, ['p1', 'p2'])
  assert.equal(pos.sentence, '2 clear positives will be published · 1 possible duplicate, 1 anti-gaming hold, 1 that needs your eyes and 1 employee review stay for you to read.')
  const all = new Set(rows.map((r) => r.id))
  const sel = approvePlan(rows, 'selection', all)
  assert.deepEqual(sel.ids, ['p1', 'p2', 'n1', 'e1'], 'select-all leaves holds and duplicates out')
  assert.match(sel.sentence, /^4 reports will be published · 1 possible duplicate and 1 anti-gaming hold stay for you to read \(tick one yourself to include it\)\.$/)
  const mine = approvePlan(rows, 'selection', all, new Set(['ag', 'pd']))
  assert.deepEqual(mine.ids.sort(), ['ag', 'e1', 'n1', 'p1', 'p2', 'pd'])
  assert.deepEqual(mine.includeIds.sort(), ['ag', 'pd'])
  assert.equal(mine.sendIds.length, 6)
  assert.equal(approvePlan(rows, 'selection', new Set(['ag'])).sentence, 'Nothing here can be published in bulk · 1 anti-gaming hold stays for you to read (tick one yourself to include it).')
})

test('the header sentence adds up exactly what the shell badge adds up (queues whose section is review)', () => {
  const ov = { queues: [
    { key: 'held_reports', label: 'Held reports', count: 343, section: 'review' },
    { key: 'listing_tickets', label: 'Listing tickets', count: 24, section: 'review' },
    { key: 'data_issues', label: 'Data issues', count: 22, section: 'review' },
    { key: 'account_clusters', label: 'Account clusters', count: 4, section: 'people' },
  ] }
  assert.equal(waitingLine(reviewQueues(ov)), '389 decisions are waiting.')
  assert.deepEqual(reviewQueues(undefined), [])
})

test('when nothing is left to publish, one line says what is left', () => {
  const rows = [row('c', 'positive', ['possible_duplicate'])]
  assert.deepEqual(approvePlan(rows, 'positive').ids, [])
  assert.equal(nothingToPublishLine(approvePlan(rows, 'positive')), 'No clear positives left · 1 possible duplicate')
})

test('a result sentence never repeats the status word beside it', () => {
  assert.equal(tidyMessage('Undid it: 140 reports are back in the review queue.'), '140 reports are back in the review queue.')
  assert.equal(tidyMessage('Approved 140 of 140.'), 'Approved 140 of 140.')
  assert.equal(tidyMessage('Done: cleared 3.'), 'Cleared 3.')
})

test('the rules check is told both ways', () => {
  assert.deepEqual(rulesReadings({ verdict: 'passes', comment: false, post: true }), { comment: 'Read as a comment: fails.', post: 'Read as the post itself (its first sentence as the title): passes.' })
  assert.equal(rulesReadings({ verdict: null, comment: null, post: null }), null)
  assert.equal(rulesReadings(undefined), null)
})

test('a row the server could not yet check for copies is never in a bulk approve', () => {
  const rows = [row('p1', 'positive'), { ...row('p2', 'positive'), review: { group: 'positive', flags: [], duplicate_check: 'pending' } }]
  const plan = approvePlan(rows, 'positive')
  assert.deepEqual(plan.ids, ['p1'])
  assert.equal(plan.sentence, '1 clear positive will be published · 1 not yet checked for copies stays for you to read.')
})

test('outcomes and sources print in the site\'s words, never the raw enum', () => {
  assert.equal(outcomeWord({ outcome: 'human', outcome_label: 'Got a response' }), 'Got a response')
  assert.equal(outcomeWord({ outcome: 'autoreject' }), 'Auto-rejected', 'a row without the server word still never shows the enum')
  assert.equal(outcomeWord({}), 'No outcome')
  assert.equal(sourceWord({ source_label: 'Imported · LinkedIn', platform: 'LinkedIn' }), 'Imported · LinkedIn')
  assert.equal(sourceWord({ platform: 'Indeed' }), 'Indeed')
})
