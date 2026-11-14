// Run: node --test lib/start/guideFor.test.mjs
// The /jobs prompt card: which start guide a search belongs to. High keyword sensitivity (titles, slang,
// certifications, places, company names, at word boundaries), the most specific guide wins, never more than one,
// and only live guides answer.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { GUIDE_KEYWORDS, matchGuide, guideForQuery, normalizeQuery } from './guideFor.js'
import { GUIDES, START_GUIDES } from './guides.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const ALL = Object.keys(GUIDE_KEYWORDS)

test('every guide in the registry has a keyword table, and nothing else does', () => {
  assert.deepEqual(ALL, GUIDES.map((g) => g.field))
})

test('oilfield: titles, slang, basins and towns', () => {
  for (const q of ['oil', 'oilfield', 'Oil Field jobs', 'oil & gas', 'oil and gas operator', 'rig', 'rigs', 'roughneck', 'roustabout', 'floorhand', 'floor hand', 'Floorhands', 'derrick', 'derrickhand', 'motorhand', 'frac', 'fracking', 'flowback', 'pumper', 'lease operator', 'wireline', 'coiled tubing', 'workover rig', 'swamper', 'water hauler', 'sand hauler', 'crude hauler', 'Permian', 'bakken', 'eagle ford', 'Midland', 'odessa tx', 'williston', 'pipeline', 'gas plant operator']) assert.equal(matchGuide(q), 'oilfield', q)
})

test('trades: titles, union words, apprenticeships', () => {
  for (const q of ['electrician', 'Electricians', 'electrical apprentice', 'plumber', 'plumbing', 'HVAC', 'hvac technician', 'welder', 'welding', 'pipefitter', 'steamfitter', 'lineman', 'lineworker', 'groundman', 'apprentice', 'apprenticeship', 'journeyman', 'carpenter', 'ironworker', 'sheet metal', 'millwright', 'elevator mechanic', 'union', 'skilled trades', 'diesel mechanic', 'heavy equipment operator']) assert.equal(matchGuide(q), 'trades', q)
})

test('the six guides waiting for content: their keywords are in place', () => {
  const cases = {
    cdl: ['cdl', 'CDL-A', 'truck driver', 'trucker', 'trucking', 'otr', 'class a', 'class b', 'tractor trailer', 'semi', 'box truck driver', 'hazmat', 'tanker', 'cdl trainee', 'otr driver', '18 wheeler'],
    healthcare: ['cna', 'nursing assistant', 'nurse aide', 'phlebotomy', 'phlebotomist', 'medical assistant', 'pharmacy tech', 'pharmacy technician', 'emt', 'paramedic', 'patient care tech', 'caregiver', 'home health aide', 'hha', 'sterile processing', 'stna', 'emt-b', 'crcst', 'pharm tech'],
    warehouse: ['warehouse', 'forklift', 'picker', 'packer', 'order picker', 'material handler', 'fulfillment', 'shipping', 'receiving', 'loader', 'unloader', 'dock worker', 'inventory clerk', 'logistics', 'distribution center', 'amazon warehouse'],
    it: ['help desk', 'helpdesk', 'it support', 'tech support', 'technical support', 'desktop support', 'service desk', 'comptia', 'CompTIA A+', 'it technician', 'computer technician', 'entry level it', 'tier 1 support', 'service desk analyst'],
    spacex: ['spacex', 'SpaceX', 'space x', 'starbase', 'starlink', 'boca chica', 'falcon 9'],
    tesla: ['tesla', 'Tesla', 'gigafactory', 'giga texas', 'tesla technician', 'tesla semi', 'megapack'],
  }
  for (const [g, qs] of Object.entries(cases)) for (const q of qs) assert.equal(matchGuide(q), g, q)
})

test('look-alikes never open a guide (a word that belongs to another kind of job or a purchase)', () => {
  for (const q of ['pct', 'patent pct specialist', 'cna financial analyst', 'cna insurance underwriter', 'medical receptionist',
    'benefits help desk', 'front desk', 'wheel loader operator', 'inventory analyst', 'rocket mortgage', 'model y', 'spacexsi',
    'pharmacy help desk', 'non cdl delivery driver', 'amazon flex driver']) assert.equal(matchGuide(q), null, q)
  assert.equal(matchGuide('hvac technician'), 'trades', 'a technician of another trade is not IT')
  assert.equal(matchGuide('semi truck driver'), 'cdl')
})

test('the most specific guide wins: a company over a field, then the longest keyword', () => {
  assert.equal(matchGuide('spacex welder'), 'spacex')
  assert.equal(matchGuide('tesla technician'), 'tesla')
  assert.equal(matchGuide('starbase electrician'), 'spacex')
  assert.equal(matchGuide('oilfield cdl driver'), 'oilfield', '"oilfield" is longer than "cdl"')
  assert.equal(matchGuide('pipeline welder'), 'oilfield')
  assert.equal(matchGuide('forklift'), 'warehouse')
})

test('not these: other jobs, look-alike words, and nursing licences', () => {
  for (const q of ['cashier', 'software engineer', 'barista', 'nurse', 'registered nurse', 'RN', 'LPN', 'accountant', 'teacher', 'apprentice piercer', 'tattoo apprentice', 'hair stylist apprentice', 'oil change technician', 'gas station attendant', 'credit union teller', 'data pipeline engineer', 'sales pipeline manager', 'semiconductor technician', 'rigging engineer', 'item support', '', '   ']) assert.equal(matchGuide(q), null, q)
})

test('only live guides answer on /jobs (a guide without content shows no card)', () => {
  assert.deepEqual(START_GUIDES.map((g) => g.field), ['oilfield', 'trades'])
  assert.equal(guideForQuery('roustabout').path, '/start/oilfield')
  assert.equal(guideForQuery('apprentice electrician').path, '/start/trades')
  for (const q of ['cna', 'forklift', 'help desk', 'cdl', 'tesla']) assert.equal(guideForQuery(q), null, `${q}: its guide is not live`)
  assert.equal(guideForQuery('spacex welder').field, 'trades', 'the company guide is not live, so the next best live guide answers')
  assert.equal(normalizeQuery(' Oil & Gas / Floor-hand '), ' oil and gas floor hand ')
})

test('/jobs shows the card right above the results, and the old quiet line is gone', () => {
  const page = readFileSync(path.join(root, 'app/jobs/page.tsx'), 'utf8')
  assert.match(page, /import GuidePrompt from '@\/components\/start\/GuidePrompt'/)
  assert.ok(!/GuideLine/.test(page))
  const i = page.indexOf('<GuidePrompt')
  const j = page.indexOf('{/* Results — swipe deck or list */}')
  assert.ok(i > 0 && j > i, 'the card renders before the results')
  const card = readFileSync(path.join(root, 'components/start/GuidePrompt.tsx'), 'utf8')
  assert.match(card, /Open the guide/)
  assert.doesNotMatch(card, /ui-btn--primary|variant="primary"/, 'no filled button')
})
