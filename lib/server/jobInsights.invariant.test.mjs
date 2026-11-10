// Job Insights invariants over every fixture posting (judge, 2026-11-10: 77% of postings carried canned
// "hidden requirements"; Insights read the posting differently from the fit check).
//   1. ONE reading: every requirement Insights shows is a fact the fit check's own call reads
//      (extractJobFacts over the same text with the same title + company).
//   2. Every quote is the posting's: each item / condition / pay / tip `source` is in the posting.
//   3. No filler: none of the old canned sentences, ever; a posting with no stated condition says so.
// Run: node --test lib/server/jobInsights.invariant.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildJobInsights, insightReading, postingTextForReader } from './jobInsights.js';
import { extractJobFacts } from '../optimizer/extractJobFacts.js';

const root = new URL('../../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');
const SAMPLE = JSON.parse(read('lib/fixtures/personas/postings-sample.json'));
const PAID = Object.values(JSON.parse(read('lib/optimizer/fixtures/paid-tool-postings.json')).postings);
const PERSONA_JDS = fs.readdirSync(new URL('lib/fixtures/personas/', root)).filter((f) => /-jd\.txt$/.test(f))
  .map((f) => ({ id: f, title: '', company: '', description: read(`lib/fixtures/personas/${f}`) }));
const POSTINGS = [...SAMPLE, ...PAID, ...PERSONA_JDS];
const norm = (s) => String(s || '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();

const CANNED = [
  /Culture fit weighs as much as skills/i, /You don.t need to match every bullet/i, /Speed matters/i,
  /Comfort with ambiguity/i, /Minimal hand-holding/i, /Heavy coordination/i, /proven track record, not potential/i,
  /Communication is graded/i, /Low tolerance for small mistakes/i, /Mirror these exact terms/i, /filters scan for them verbatim/i,
  /Tailor your opening line to this exact role/i, /Lead with measurable impact/i,
];

test('fixture set is not empty', () => { assert.ok(POSTINGS.length >= 15, String(POSTINGS.length)); });

for (const p of POSTINGS) {
  test(`${p.id || p.title}: shown requirements ⊆ the fit check's reading; every quote is in the posting; no filler`, () => {
    const { result: o, labels, postingText } = insightReading({ title: p.title, company: p.company, description: p.description });
    // the fit check's call (api/optimizer.js): the same text, title and company
    const fit = new Set(extractJobFacts(postingTextForReader(p.description), { jobTitle: p.title, company: p.company }).map((f) => f.label));
    for (const ls of labels) for (const l of ls) assert.ok(fit.has(l), `"${l}" is not a requirement the fit check reads`);
    const flat = norm(postingText);
    const quotes = [...o.items.map((i) => i.source), ...o.hidden_items.map((h) => h.source), ...(o.pay ? [o.pay.source] : []), ...(o.tip_source ? [o.tip_source] : [])];
    for (const q of quotes) assert.ok(q && flat.includes(norm(q)), `quote not in the posting: ${q}`);
    const said = [...o.what_they_want, ...o.hidden_requirements, o.insider_tip, ...o.items.map((i) => i.text)].join(' | ');
    for (const re of CANNED) assert.doesNotMatch(said, re);
    assert.doesNotMatch(JSON.stringify(o), /\bterm:/);
    if (o.read) {
      assert.ok(o.items.length && o.what_they_want.length <= 7);
      for (const i of o.items) assert.ok(['licence', 'certification', 'years', 'degree', 'age', 'schedule', 'language', 'experience', 'skill', 'any_of', 'duty', 'trait'].includes(i.kind), i.kind);
      // dealbreakers first: no gate after a non-gate of the same importance
      const req = o.items.filter((i) => i.importance === 'required');
      const firstNonGate = req.findIndex((i) => !i.gate);
      if (firstNonGate >= 0) assert.ok(!req.slice(firstNonGate).some((i) => i.gate), JSON.stringify(req.map((i) => i.kind)));
      // preferred items last
      const firstPref = o.items.findIndex((i) => i.importance === 'preferred');
      if (firstPref >= 0) assert.ok(o.items.slice(firstPref).every((i) => i.importance === 'preferred'));
      // an empty conditions list is said, not hidden
      if (!o.hidden_items.length) assert.match(o.conditions_note, /^This posting states no /);
    }
  });
}

test('a posting with no stated condition answers [] and says so (never a fallback)', () => {
  const o = buildJobInsights({ title: 'Journeyman Electrician', company: 'Volt Co', description: 'Requirements:\n- 4+ years of commercial electrical experience.\n- Experience reading blueprints.\n- Strong troubleshooting skills.' });
  assert.equal(o.read, true);
  assert.deepEqual(o.hidden_requirements, []);
  assert.equal(o.conditions_note, 'This posting states no schedule, physical or screening conditions.');
});

test('a keyword in the company blurb is not a condition; the same keyword in a requirement is, with its sentence', () => {
  const blurb = buildJobInsights({ title: 'Account Executive', company: 'Brightline', description: 'About us: we are a fast-paced company with a 24/7 night shift operations team and a drug-free workplace.\nRequirements:\n- 3+ years of B2B sales experience.\n- Experience with Salesforce.' });
  assert.deepEqual(blurb.hidden_items, [], JSON.stringify(blurb.hidden_items));
  const req = buildJobInsights({ title: 'Warehouse Associate', company: 'Brightline', description: 'Requirements:\n- Must pass a background check and drug screen.\n- Able to lift up to 50 lbs.\n- 1+ year of warehouse experience.' });
  const screen = req.hidden_items.filter((h) => h.kind === 'screening');
  assert.ok(screen.length, JSON.stringify(req.hidden_items));
  for (const h of req.hidden_items) assert.ok(/Must pass a background check|lift up to 50 lbs/.test(h.source), h.source);
});

test('pay is read only from a pay sentence (judge cases: "$2B ARR", a $75 gym stipend, a $2.4 trillion industry)', () => {
  const samsara = buildJobInsights({ title: 'Senior Software Engineer', company: 'Samsara', description: "The nice thing about growing 30%+ at ~$2B ARR is that we need great engineers everywhere.\nRequirements:\n- 8+ years of experience in software design and development." });
  assert.equal(samsara.pay, null);
  const dash = buildJobInsights({ title: 'Shift Lead', company: 'DoorDash', description: 'Requirements:\n- You have a high school diploma or GED equivalent.\n- Experience with inventory management.\nBenefits:\n- Gym membership reimbursement (up to $75/month).' });
  assert.equal(dash.pay, null);
  const rtr = buildJobInsights({ title: 'Staff Accountant', company: 'Rent the Runway', description: 'We are disrupting the $2.4 trillion fashion industry.\nRequirements:\n- 2+ years of accounting experience.\n- Excel skills.\nThe anticipated base salary for this position is $64,397 - $80,496.' });
  assert.equal(rtr.pay.text, '$64,397 – $80,496');
  assert.match(rtr.pay.source, /base salary for this position is \$64,397 - \$80,496/);
  const nurse = buildJobInsights({ title: 'Registered Nurse', company: 'NM', description: 'Qualifications:\n- Current RN license.\n- BLS required.\nThe salary range for this position is $36.50 - $58.40 (Hourly Rate)' });
  assert.equal(nurse.pay.text, '$36.50 – $58.40 an hour');
});

test('the tip is this posting\'s own gate, or absent', () => {
  const lic = buildJobInsights({ title: 'Registered Nurse', company: 'Mercy', description: 'Requirements:\n- Active Arizona RN license required.\n- BLS required.\n- 2+ years of acute care experience.' });
  assert.equal(lic.items[0].text, 'Arizona RN license');
  assert.match(lic.insider_tip, /^The licence is the gate here: "Active Arizona RN license required"\. Say you hold it in your first line\./);
  assert.ok(lic.description_summary === '' || typeof lic.description_summary === 'string');
  assert.ok('Requirements:\n- Active Arizona RN license required.'.includes(lic.tip_source), lic.tip_source);
  const none = buildJobInsights({ title: 'Coordinator', company: 'Acme', description: 'What you will do:\n- Coordinate team meetings and keep notes.\n- Support the events team with logistics planning.' });
  assert.ok(none.insider_tip === '' || !CANNED.some((re) => re.test(none.insider_tip)), none.insider_tip);
});

test('one employer acronym is never a requirement when the company is passed (judge case 10: "OBE")', () => {
  const o = buildJobInsights({ title: 'Material Handler', company: 'Oldcastle BuildingEnvelope', description: 'At OBE, the work of our employees truly matters.\nRequirements:\n- Prior manufacturing experience\n- Punctual and excellent attendance\n- Be available for overtime and emergency work' });
  assert.ok(!o.items.some((i) => /^OBE$/i.test(i.text)), JSON.stringify(o.items));
});
