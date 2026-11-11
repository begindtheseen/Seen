// R7 reader: lists the reader never produced (lead-ins, unknown headings, numbered / lettered markers), flat one-paragraph
// postings ("Part I:" sub-headings, number-bearing duties, noun-phrase duties, self-negating preferences, a credential with its
// own level word), requirements in the header or intro, and Title Case inside a duties list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJobFacts } from './extractJobFacts.js';
import { splitRunOnStatement } from './statementGate.js';

const shown = (text, company = 'Acme') => extractJobFacts(text, { company, jobTitle: 'Lead' }).statements.filter((s) => s.display !== false && s.kind !== 'promise');
const ITEMS = ['Perform preventive maintenance on HVAC units', 'Respond to work orders on time', 'Repair plumbing fixtures and drains', 'Keep accurate logs of parts used', 'Inspect fire safety equipment monthly', 'Coordinate with vendors on repairs'];

test('A. a lead-in line opens a duties list whatever heading sits above it; blank lines and list markers never end it', () => {
  for (const head of ['Scope of Work\n\nKey responsibilities include:', 'Overview\n\nResponsibilities include but are not limited to the following:', 'Position Scope\nDuties include:', 'Scope of Work\nThe contractor shall:']) {
    const st = shown(`Acme Facilities is hiring a technician.\n\n${head}\n\n${ITEMS.map((x) => `• ${x}`).join('\n\n')}\n\nRequirements\n• 2+ years of maintenance experience\n`);
    assert.equal(st.filter((s) => s.importance === 'duty').length, 6, head);
  }
  for (const mark of [(i) => `${i + 1}) `, (i) => `${i + 1}. `, (i) => `(${String.fromCharCode(97 + i)}) `]) {
    const st = shown(`Acme is hiring.\n\nResponsibilities\n${ITEMS.map((x, i) => mark(i) + x).join('\n')}\n`);
    assert.deepEqual(st.map((s) => s.text), ITEMS);
  }
  const req = shown(`Acme is hiring.\n\nAbout You\n\nThe ideal candidate will have:\n\n• 3+ years of maintenance experience\n• Valid driver license\n• EPA 608 certification\n`);
  assert.ok(req.every((s) => s.importance === 'required') && req.length === 3);
});

test('B. flat one-paragraph postings are cut into their sections and items', () => {
  const B = "Bright Start Academy is hiring a Campus Operations Lead. What You Will Do: Part I: Business Operations (Primary Focus) Own and drive enrollment operations across the campus Coordinate vendor contracts and facility maintenance Support the Campus Principal with budgeting Act as a key execution partner to the Campus Principal on daily operations Timely and accurate completion of daily work reports. Part II: Teaching (Secondary Focus) Teach 2–3 math classes per week (PreK–Elementary level) Prepare lesson plans aligned to the curriculum Qualifications: Bachelor's degree in Education or Business 3+ years of school operations experience Teaching experience is a plus, but not required BS/BA degree in Finance/Accounting CPA preferred Strong communication skills.";
  const st = shown(B, 'Bright Start Academy');
  const has = (re, imp) => { const s = st.find((x) => re.test(x.text)); assert.ok(s, String(re)); if (imp) assert.equal(s.importance, imp, String(re)); };
  has(/^Own and drive enrollment operations/, 'duty');
  has(/^Act as a key execution partner to the Campus Principal on daily operations$/, 'duty');
  // (R8: a posting that arrives as one block shows only lines with their own cue — the noun-phrase duty stays in the reading,
  // hidden; the reading says why)
  const flatRead = extractJobFacts(B, { company: 'Bright Start Academy', jobTitle: 'Lead' });
  assert.equal(flatRead.structure, 'flat');
  assert.ok(flatRead.statements.some((s) => /^Timely and accurate completion of daily work reports$/.test(s.text) && s.display === false));
  has(/^Teach 2–3 math classes per week/, 'duty');
  has(/^Teaching experience is a plus, but not required$/, 'preferred');
  has(/^CPA preferred$/, 'preferred');
  has(/^BS\/BA degree in Finance\/Accounting$/);
  assert.ok(!st.some((s) => /Part I|Primary Focus|Secondary Focus/.test(s.text)));
});

test('C. a requirement in the header or intro: the clearance level is kept, residence is a condition', () => {
  const st = shown('**Secret Security Clearance**\n\nAcme Defense is hiring a Systems Analyst. Candidates should reside within 60 miles of Huntsville, AL.\n\nResponsibilities\n• Analyze system logs and produce weekly reports\n• Maintain network documentation\n\nRequirements\n• 3+ years of systems analysis experience\n');
  assert.ok(st.some((s) => /^Secret Security Clearance$/.test(s.text)));
  assert.ok(st.some((s) => /reside within 60 miles/.test(s.text) && s.shape === 'condition'));
});

test('Title Case inside a duties list is an item; a trailing question is split off and never shown', () => {
  const st = shown('Acme is hiring.\n\nResponsibilities\n• Inventory Control And Cycle Counts\n• Patient Intake And Scheduling\n• Maintain accurate records for every shift\n');
  assert.ok(st.some((s) => /^Inventory Control And Cycle Counts$/.test(s.text)));
  assert.deepEqual(splitRunOnStatement('Knowledge of CommerceTools is a plus What’s our tech stack?'), ['Knowledge of CommerceTools is a plus', 'What’s our tech stack?']);
  const q = shown('Acme is hiring.\n\nPreferred:\n• Prior experience building e-commerce portals\n• Knowledge of CommerceTools is a plus What’s our tech stack?\n• Experience with React\n');
  assert.ok(q.some((s) => /^Knowledge of CommerceTools/.test(s.text) && s.importance === 'preferred'));
  assert.ok(!q.some((s) => /tech stack/.test(s.text)));
});

test('linear time: R7 patterns on 5,000 repetitions', () => {
  for (const u of ['Part I: Business ', 'CPA preferred ', 'What is ', 'Responsibilities include ']) {
    const t0 = Date.now();
    extractJobFacts(`Acme is hiring. ${u.repeat(2000)}`, { company: 'Acme' });
    splitRunOnStatement(u.repeat(5000));
    assert.ok(Date.now() - t0 < 8000, `"${u}" took ${Date.now() - t0} ms`);
  }
});
