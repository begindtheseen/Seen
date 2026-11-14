// Run: node --test lib/start/listingFilters.test.mjs
// The "Hiring now" filters on the start guides: position → searches, level read from real titles, rows that belong
// to the position and the field, "All trades" dealt out trade by trade with two per employer, the URL state, and
// the honest count / empty lines.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as oil from './oilfield.js'
import * as trades from './trades.js'
import {
  levelOf, queriesFor, positionOf, requestBodies, pickRows, parseFilterState, filterParams, filterQueryString,
  countLine, emptyState, seeAllHref, inField, capPerCompany,
} from './listingFilters.js'

const O = oil.listings
const T = trades.listings
let n = 0
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
const row = (title, company, extra = {}) => ({ id: id(), title, company, location: 'Midland, TX', related: true, in_radius: true, ...extra })

test('oilfield: each position runs its own searches, the same at every level', () => {
  const want = {
    all: ['floorhand', 'roustabout', 'frac equipment operator'],
    floorhand: ['floorhand'],
    roustabout: ['roustabout'],
    frac: ['frac equipment operator', 'pump operator'],
    'equipment-operator': ['equipment operator', 'wireline operator'],
    'cdl-driver': ['hauler', 'oilfield cdl driver', 'truck driver'],
    yard: ['yard operator', 'shop hand', 'warehouse operator'],
    'field-service': ['compressor technician', 'field service technician'],
  }
  assert.deepEqual(O.positions.map((p) => p.id), Object.keys(want))
  assert.deepEqual(O.positions.map((p) => p.label), ['All entry jobs', 'Floorhand', 'Roustabout', 'Frac / pump operator', 'Equipment operator', 'CDL driver', 'Yard / warehouse hand', 'Field service tech'])
  for (const [pid, q] of Object.entries(want)) for (const lvl of ['any', 'entry', 'experienced']) assert.deepEqual(queriesFor(positionOf(O, pid), lvl), q, `${pid} ${lvl}`)
})

test('trades: position × level → the search (Electrician + Apprentice → "apprentice electrician" first)', () => {
  const q = (pos, lvl) => queriesFor(positionOf(T, pos), lvl)
  assert.deepEqual(T.positions.map((p) => p.label), ['All trades', 'Electrician', 'Plumber', 'HVAC', 'Welder', 'Lineworker', 'Pipefitter', 'Diesel / heavy equipment mechanic', 'Carpenter'])
  assert.equal(q('electrician', 'any')[0], 'electrician')
  assert.equal(q('electrician', 'entry')[0], 'apprentice electrician')
  assert.equal(q('electrician', 'experienced')[0], 'journeyman electrician')
  assert.equal(q('plumber', 'entry')[0], 'apprentice plumber')
  assert.equal(q('plumber', 'experienced')[0], 'journeyman plumber')
  assert.deepEqual(q('hvac', 'entry').slice(0, 2), ['hvac apprentice', 'hvac helper'])
  assert.equal(q('pipefitter', 'experienced')[0], 'journeyman pipefitter')
  // Every level of a trade reads the same searches (its own first), so a level only filters: Any ⊇ each level.
  for (const p of T.positions.filter((x) => x.id !== 'all')) {
    const set = (lvl) => [...q(p.id, lvl)].sort().join('|')
    assert.equal(set('entry'), set('any'), p.id)
    assert.equal(set('experienced'), set('any'), p.id)
  }
  assert.equal(q('all', 'entry')[0], 'apprenticeship')
  assert.ok(q('all', 'experienced').every((x) => /journeyman|technician|welder|lineman/.test(x)))
  assert.equal(q('all', 'any').length, 9, 'one search per trade, plus apprenticeships')
})

test('search bodies: nationwide when no place; the place and distance when there is one', () => {
  assert.deepEqual(requestBodies(O, { pos: 'floorhand', loc: '', r: '100', lvl: 'any' }), [{ query: 'floorhand', location: '', radius: '25' }])
  assert.deepEqual(requestBodies(O, { pos: 'floorhand', loc: 'Midland, TX', r: '100', lvl: 'entry' }), [{ query: 'floorhand', location: 'Midland, TX', radius: '100' }])
  assert.deepEqual(requestBodies(T, { pos: 'electrician', loc: 'Houston, TX', r: '50', lvl: 'entry' }).map((b) => b.query), ['apprentice electrician', 'electrician', 'journeyman electrician'])
  assert.ok(requestBodies(T, { pos: 'electrician', loc: 'Houston, TX', r: '50', lvl: 'entry' }).every((b) => b.location === 'Houston, TX' && b.radius === '50'))
})

test('level read from real titles — oilfield (a plain field-hand title is the entry rung)', () => {
  const lv = (t, extra) => levelOf({ title: t, ...extra }, O.levelMode)
  for (const t of ['Floorhand I', 'WTX - Floorhand I', 'Floorhand - Oklahoma', 'Roustabout', 'Alaska On-Call Roustabout', 'Trainee Pump Operator', 'Operator Assistant Trainee - Frac/Acid', 'Frac Equipment Operator - Pearsall, Tx', 'Sand Hauler', 'Warehouse & Yard Operator', 'Field Service Technician, Entry']) assert.equal(lv(t), 'entry', t)
  for (const t of ['Floorhand (Experienced)', 'Experienced Workover Rig Floorhand', 'Derrickhand, Drilling', 'Wtx - Motorhand I', 'Roustabout Pusher', 'Midstream Compressor Technician I/II/III/Sr', 'Field Operator II - Wireline', '77-Operations - Operator-Wireline IV', 'Pump Senior Operator', 'Rig Manager', 'USR - Workover/Pulling Unit - Operator, Relief Operator, Derrickhand, Floorhand']) assert.equal(lv(t), 'experienced', t)
})

test('level read from real titles — trades (entry needs a beginner word, the listing\'s own entry level or paid training)', () => {
  const lv = (t, extra) => levelOf({ title: t, ...extra }, T.levelMode)
  for (const t of ['Electrician Apprentice', 'Apprentice Electrician Tech College Intern - Omaha, NE', 'HVAC Helper', 'Plumber\'s Helper', 'Welder Helper 2nd shift', 'Apprentice Lineman - Substation', 'Diesel Technician Apprentice-Paid Training', 'HVAC Install Apprentice', 'Electrical Trainee']) assert.equal(lv(t), 'entry', t)
  for (const t of ['Journeyman Electrician', 'Master Plumber', 'Licensed Plumber', 'Electrician', 'Pipe Welder', 'HVAC Technician', 'Pipefitter Journeyman', 'Experienced HVAC Technicians & Installers', 'Journeyman Lineman Instructor', 'Lead Carpenter']) assert.equal(lv(t), 'experienced', t)
  assert.equal(lv('Residential Electrician', { level: 'Entry level' }), 'entry', 'the listing says entry level')
  assert.equal(lv('Electrician', { trains_beginners: true }), 'entry', 'the listing says it trains beginners')
  assert.equal(lv('Licensed Plumber', { level: 'Entry level', trains_beginners: true }), 'experienced', 'a title asking for a licence wins')
})

test('a position keeps only its own titles, and the oilfield gate keeps only oilfield rows', () => {
  const ans = { jobs: [
    row('Heavy Equipment Operator', 'Loenbro'),
    row('Equipment Operator', 'ShipBob, Inc.'),
    row('Wireline Equipment Operator', 'Liberty Energy'),
    row('Wireline Field Operator', 'Baker Hughes'),
    row('Casing Floorhand - OKC', 'Nabors'), // the search's family, not this position
  ] }
  const st = { pos: 'equipment-operator', loc: '', r: '100', lvl: 'any' }
  assert.deepEqual(pickRows(O, st, [ans, null]).rows.map((r) => r.title), ['Wireline Equipment Operator', 'Wireline Field Operator'])
  const drivers = { jobs: [row('CDL A Truck Driver', 'Misfits Market'), row('Sand Hauler', 'Liberty Energy'), row('CDL Driver - Water Hauler', 'Select'), row('Truck Driver', 'NOV'), row('Courier Route Driver', 'SPS North America')] }
  assert.deepEqual(pickRows(O, { ...st, pos: 'cdl-driver' }, [drivers]).rows.map((r) => r.title), ['Sand Hauler', 'CDL Driver - Water Hauler', 'Truck Driver'])
  assert.equal(inField(O, row('Pipeline Foreman', 'B&G Roustabout Service')), true)
  assert.equal(inField(O, row('Petroleum Engineer', 'Chevron')), false, 'not an entry field job')
  assert.equal(inField(T, row('Journeyman Lineworker Instructor', 'Cotulla Education')), false)
})

test('level filters the rows', () => {
  const ans = { jobs: [row('Floorhand I', 'Nabors'), row('Floorhand (Experienced)', 'Scandrill'), row('Derrickhand, Drilling', 'Savanna'), row('Floorhand', 'AKITA Drilling')] }
  const base = { pos: 'floorhand', loc: '', r: '100' }
  assert.deepEqual(pickRows(O, { ...base, lvl: 'entry' }, [ans]).rows.map((r) => r.title), ['Floorhand I', 'Floorhand'])
  assert.deepEqual(pickRows(O, { ...base, lvl: 'experienced' }, [ans]).rows.map((r) => r.title), ['Floorhand (Experienced)'], 'derrickhand is not a floorhand row')
  assert.equal(pickRows(O, { ...base, lvl: 'any' }, [ans]).total, 3)
})

test('"All entry jobs": the rig searches merged, rig roles first, each listing once', () => {
  const floor = { jobs: [row('Floorhand', 'AKITA Drilling'), row('Casing Floorhand - OKC', 'Nabors')] }
  const rous = { jobs: [row('Pipeline Foreman', 'B&G Roustabout Service'), row('Alaska Roustabout', 'Nabors'), floor.jobs[0]] }
  const frac = { jobs: [row('Frac Equipment Operator - Pearsall, Tx', 'Patterson-UTI')] }
  const { rows } = pickRows(O, { pos: 'all', loc: '', r: '100', lvl: 'any' }, [floor, rous, frac])
  assert.deepEqual(rows.map((r) => r.title), ['Floorhand', 'Frac Equipment Operator - Pearsall, Tx', 'Casing Floorhand - OKC', 'Alaska Roustabout', 'Pipeline Foreman'])
})

test('"All trades": dealt out trade by trade (not twelve electricians), two per employer before a third', () => {
  const elec = { jobs: Array.from({ length: 10 }, (_, i) => row(`Apprentice Electrician ${i}`, i < 6 ? 'Loenbro' : `Shop ${i}`, { level: 'Entry level' })) }
  const hvac = { jobs: [row('HVAC Apprentice (Brazing)', 'Express'), row('Union HVAC Apprentice', 'Siemens')] }
  const weld = { jobs: [row('Apprentice Welder', 'SpaceX'), row('Welder Helper 2nd shift', 'LPC Personnel')] }
  const diesel = { jobs: [row('Diesel Technician Apprentice-Paid Training', 'Republic Services'), row('Technology Operations Coordinator', 'NYC Carpenters Fund')] }
  const { rows, total } = pickRows(T, { pos: 'all', loc: '', r: '50', lvl: 'entry' }, [elec, hvac, weld, diesel])
  assert.equal(rows.length, 12)
  assert.equal(total, 15, 'the coordinator row belongs to no trade')
  const trade = (t) => (/electric/i.test(t) ? 'e' : /hvac/i.test(t) ? 'h' : /weld/i.test(t) ? 'w' : 'd')
  assert.deepEqual(rows.slice(0, 4).map((r) => trade(r.title)), ['e', 'h', 'w', 'd'], 'round-robin by trade')
  assert.ok(rows.filter((r) => trade(r.title) === 'e').length <= 7)
  const firstLoenbro = rows.map((r) => r.company).filter((c) => c === 'Loenbro').length
  assert.ok(firstLoenbro <= 2 || rows.findIndex((r, i) => r.company === 'Loenbro' && rows.slice(0, i).filter((x) => x.company === 'Loenbro').length >= 2) >= rows.length - (firstLoenbro - 2), 'a third Loenbro row waits for every other row')
  assert.deepEqual(capPerCompany([{ company: 'A' }, { company: 'A' }, { company: 'A' }, { company: 'B' }]).map((r) => r.company), ['A', 'A', 'B', 'A'])
})

test('URL state: parse and write round-trip; defaults are never written; junk falls back', () => {
  const s = { pos: 'floorhand', loc: 'Midland, TX', r: '250', lvl: 'entry' }
  const qs = filterQueryString(s, O)
  assert.equal(qs, 'pos=floorhand&loc=Midland%2C+TX&r=250&lvl=entry')
  assert.deepEqual(parseFilterState(qs, O), s)
  assert.deepEqual(parseFilterState('', O), { pos: 'all', loc: '', r: '100', lvl: 'any' })
  assert.deepEqual(parseFilterState('', T), { pos: 'all', loc: '', r: '50', lvl: 'any' })
  assert.deepEqual(parseFilterState('pos=astronaut&r=7&lvl=boss', O), { pos: 'all', loc: '', r: '100', lvl: 'any' })
  assert.deepEqual(filterParams({ pos: 'all', loc: '', r: '100', lvl: 'any' }, O), { pos: null, loc: null, r: null, lvl: null })
  assert.deepEqual(filterParams({ pos: 'all', loc: '', r: '250', lvl: 'any' }, O), { pos: null, loc: null, r: null, lvl: null }, 'a distance without a place is not written')
  for (const st of [{ pos: 'electrician', loc: 'Houston, TX', r: '25', lvl: 'experienced' }, { pos: 'all', loc: 'Texas', r: '50', lvl: 'entry' }]) assert.deepEqual(parseFilterState(filterQueryString(st, T), T), st)
})

test('count and empty lines say exactly what was searched', () => {
  assert.equal(countLine(O, { pos: 'floorhand', loc: 'Midland, TX', r: '100', lvl: 'any' }, 12, 56), '12 of 56 floorhand jobs within 100 mi of Midland, TX')
  assert.equal(countLine(O, { pos: 'all', loc: '', r: '100', lvl: 'entry' }, 12, 40), '12 of 40 entry-level oilfield jobs nationwide')
  assert.equal(countLine(T, { pos: 'electrician', loc: 'Texas', r: '50', lvl: 'entry' }, 3, 3), '3 apprentice and helper electrician jobs in Texas')
  assert.equal(countLine(T, { pos: 'plumber', loc: '', r: '50', lvl: 'experienced' }, 1, 1), '1 journeyman plumber job nationwide')
  const e = emptyState(O, { pos: 'roustabout', loc: 'Hobbs, NM', r: '100', lvl: 'entry' })
  assert.equal(e.line, 'No entry-level roustabout jobs within 100 mi of Hobbs, NM right now — try a wider distance or another position.')
  assert.deepEqual(e.action, { label: 'Search within 250 mi', patch: { r: '250' } })
  assert.deepEqual(emptyState(O, { pos: 'roustabout', loc: 'Hobbs, NM', r: '250', lvl: 'entry' }).action.patch, { pos: 'all' })
  assert.deepEqual(emptyState(O, { pos: 'all', loc: '', r: '100', lvl: 'entry' }).action.patch, { lvl: 'any' })
})

test('"See all in job search" carries the same search, place and distance (job search goes to 100 mi)', () => {
  assert.equal(seeAllHref(O, { pos: 'floorhand', loc: 'Midland, TX', r: '50', lvl: 'any' }), '/jobs?q=floorhand&loc=Midland%2C+TX&r=50')
  assert.equal(seeAllHref(O, { pos: 'floorhand', loc: 'Midland, TX', r: '250', lvl: 'any' }), '/jobs?q=floorhand&loc=Midland%2C+TX&r=100')
  assert.equal(seeAllHref(O, { pos: 'all', loc: '', r: '100', lvl: 'any' }), '/jobs?q=roustabout')
  assert.equal(seeAllHref(T, { pos: 'electrician', loc: 'Houston, TX', r: '25', lvl: 'entry' }), '/jobs?q=apprentice+electrician&loc=Houston%2C+TX')
})

test('a company guide keeps only its employer\'s rows', () => {
  const cfg = { ...T, employer: '^spacex$', positions: [{ id: 'all', label: 'All roles', noun: 'SpaceX', queries: ['spacex'] }] }
  const ans = { jobs: [row('Apprentice Welder', 'SpaceX'), row('Pipe Welder', 'Loenbro')] }
  assert.deepEqual(pickRows(cfg, { pos: 'all', loc: '', r: '50', lvl: 'any' }, [ans]).rows.map((r) => r.company), ['SpaceX'])
})

test('a starting-out position also keeps a row whose posting says it trains beginners, whatever its title', async () => {
  const { pickRows } = await import('./listingFilters.js')
  const config = { positions: [{ id: 'all', label: 'All', queries: ['x'] }, { id: 'trainee', label: 'Trainee', queries: ['x'], orTraining: true, match: 'trainee' }] }
  const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const rows = [
    { id: id(1), title: 'CDL A Driver Trainee', company: 'A' },
    { id: id(2), title: 'CDL-A Truck Driver', company: 'B', trains_beginners: true },
    { id: id(3), title: 'CDL-A Truck Driver', company: 'C' },
  ]
  const out = pickRows(config, { pos: "trainee", lvl: "any" }, [{ jobs: rows }])
  assert.deepEqual(out.rows.map((r) => r.company), ['A', 'B'])
})
