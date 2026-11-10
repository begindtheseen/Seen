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
import { decodeEntities } from '../jobs/postingPay.js';

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
    const flat = norm(decodeEntities(postingText));
    const quotes = [...o.items.map((i) => i.source), ...o.hidden_items.map((h) => h.source), ...(o.pay ? [o.pay.source] : []), ...(o.tip_source ? [o.tip_source] : [])];
    // a cut quote carries "…" where words were left out; the rest is the posting's own text
    for (const q of quotes) assert.ok(q && flat.includes(norm(String(q).replace(/^…|…$/g, ''))), `quote not in the posting: ${q}`);
    const said = [...o.what_they_want, ...o.hidden_requirements, o.insider_tip, ...o.items.map((i) => i.text)].join(' | ');
    for (const re of CANNED) assert.doesNotMatch(said, re);
    assert.doesNotMatch(JSON.stringify(o), /\bterm:/);
    if (o.read) {
      assert.ok(o.items.length && o.what_they_want.length <= 7);
      for (const i of o.items) assert.ok(['licence', 'certification', 'years', 'degree', 'age', 'schedule', 'language', 'experience', 'skill', 'any_of', 'duty', 'trait', 'requirement'].includes(i.kind), i.kind);
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
  assert.equal(o.conditions_note, 'This posting states no schedule, location, contract, physical or screening conditions.');
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
  // Track B: the item is the reader's statement; the tip names the licence by its short name
  assert.match(lic.items[0].text, /Arizona RN license/);
  assert.equal(lic.items[0].kind, 'licence');
  assert.match(lic.insider_tip, /^The licence is the gate here: "Active Arizona RN license required"\. Put your Arizona RN license in your first line, with its number if you have one\./);
  assert.ok(lic.description_summary === '' || typeof lic.description_summary === 'string');
  assert.ok('Requirements:\n- Active Arizona RN license required.'.includes(lic.tip_source), lic.tip_source);
  const none = buildJobInsights({ title: 'Coordinator', company: 'Acme', description: 'What you will do:\n- Coordinate team meetings and keep notes.\n- Support the events team with logistics planning.' });
  assert.ok(none.insider_tip === '' || !CANNED.some((re) => re.test(none.insider_tip)), none.insider_tip);
});

test('one employer acronym is never a requirement when the company is passed (judge case 10: "OBE")', () => {
  const o = buildJobInsights({ title: 'Material Handler', company: 'Oldcastle BuildingEnvelope', description: 'At OBE, the work of our employees truly matters.\nRequirements:\n- Prior manufacturing experience\n- Punctual and excellent attendance\n- Be available for overtime and emergency work' });
  assert.ok(!o.items.some((i) => /^OBE$/i.test(i.text)), JSON.stringify(o.items));
});

// ── Round 2 (director's read of unseen postings, 2026-11-10) — each fixture quotes a corpus posting ──
const all2 = (o) => JSON.stringify(o);

test('pay: a template placeholder is no pay; an HTML entity range reads as a range and no entity reaches the output', () => {
  const tpg = buildJobInsights({ title: 'Investment Operations Analyst', company: 'TPG', description: 'Qualifications:\n- Minimum of 2 years of relevant experience in Investment Operations or Fund Accounting.\n- Strong Excel skills.\nIt is expected that the annual base salary for this role will range from $000,000 – $000,00. Base salary is one component of total rewards.' });
  assert.equal(tpg.pay, null, JSON.stringify(tpg.pay));
  assert.doesNotMatch(tpg.description_summary, /\$000/);
  const akido = buildJobInsights({ title: 'Medical Scribe', company: 'Akido Labs', description: 'Requirements:\n- 1+ year of experience in a clinical setting.\n- Typing speed of 60 WPM.\nHourly pay range $21 &mdash; $23 USD &amp; benefits.' });
  assert.equal(akido.pay.text, '$21 – $23 an hour');
  assert.match(akido.pay.source, /\$21 — \$23 USD/);
  assert.doesNotMatch(all2(akido), /&(?:mdash|amp|ndash|nbsp);/);
});

test('conditions: kilograms, time on board, the place and office days, relocation, visa, shift length, on-call', () => {
  const chef = buildJobInsights({ title: 'Chef de Partie', company: 'csmcy', description: 'Responsibilities:\n• Prepare and cook dishes according to standard recipes.\nRequirements:\n• Proven experience as a Chef de Partie.\n• Ability to lift up to 25 kilograms\n• Willingness to work on board for 4 to 10 months at a time' });
  const kinds = chef.hidden_items.map((h) => h.kind);
  assert.ok(kinds.includes('physical') && kinds.includes('contract'), JSON.stringify(chef.hidden_items));
  assert.match(chef.hidden_items.find((h) => h.kind === 'contract').text, /"Willingness to work on board for 4 to 10 months at a time"/);
  assert.match(chef.hidden_items.find((h) => h.kind === 'physical').text, /25 kilograms/);
  assert.equal(chef.conditions_note, '', 'the no-conditions note never prints beside a condition');
  const lagos = buildJobInsights({ title: 'Product Manager', company: 'Acme', description: 'Requirements:\n- 4+ years of product management experience.\n- Experience with SQL.\nThis role is based in Lagos, Nigeria. You will work from our Lagos office at least 3 days per week.' });
  const lk = lagos.hidden_items.map((h) => h.kind);
  assert.ok(lk.includes('location') && lk.includes('onsite'), JSON.stringify(lagos.hidden_items));
  assert.match(lagos.hidden_items.find((h) => h.kind === 'location').text, /based in Lagos, Nigeria/);
  const samsara = buildJobInsights({ title: 'Senior Software Engineer', company: 'Samsara', description: 'Minimum requirements:\n- 8+ years of experience in software design and development.\nThis role is remote and open to candidates residing in the US. Relocation assistance will not be provided for this role.' });
  assert.ok(samsara.hidden_items.some((h) => h.kind === 'location' && /residing in the US/.test(h.text)));
  assert.ok(samsara.hidden_items.some((h) => h.kind === 'relocation' && /will not be provided/.test(h.text)));
  const focused = buildJobInsights({ title: 'Lead Engineer', company: 'Focused', description: 'Requirements:\n- 5+ years of software engineering experience.\nFocused is unable to sponsor or take over sponsorship of the employment Visa process at this time.' });
  assert.ok(focused.hidden_items.some((h) => h.kind === 'work_authorization' && /unable to sponsor/.test(h.text)));
  const er = buildJobInsights({ title: 'Registered Nurse', company: 'Mercy', description: 'Requirements:\n- Active RN license required.\n- Must be able to work 12-hour shifts, including on-call rotation.' });
  assert.ok(er.hidden_items.some((h) => h.kind === 'schedule' && /12/.test(h.text)), JSON.stringify(er.hidden_items));
  assert.ok(er.hidden_items.some((h) => /on-call/.test(h.text)), JSON.stringify(er.hidden_items));
});

test('a schedule is said once, as a condition — never also an item', () => {
  const o = buildJobInsights({ title: 'Delivery Driver', company: 'Acme', description: "Requirements:\n- Valid driver's license required.\n- Weekends required.\n- Must be available for overtime." });
  assert.ok(!o.items.some((i) => i.kind === 'schedule' || /^Availability:/.test(i.text)), JSON.stringify(o.items));
  assert.ok(o.hidden_items.some((h) => h.kind === 'schedule' && /weekend/i.test(h.text)), JSON.stringify(o.hidden_items));
});

test('the summary ends in one sentence a person would say, never a glued list', () => {
  const o = buildJobInsights({ title: 'Staff Accountant', company: 'Rent the Runway', description: "Requirements:\n- You have a Bachelor's degree in accounting\n- 2+ years of accounting experience\n- You have exceptional Excel skills\n- Experience with a major ERP system preferred\nThe anticipated base salary for this position is $64,397 - $80,496." });
  assert.doesNotMatch(o.description_summary, /What it asks for:|;/);
  assert.match(o.description_summary, /It asks for 2\+ years of accounting experience, a Bachelor's degree in accounting and exceptional Excel skills, and prefers experience with a major ERP system\./);
});

test('the tip names the gate in the posting\'s own words, and its advice differs by what the gate is', () => {
  const mk = (req) => buildJobInsights({ title: 'Role', company: 'Acme', description: `Requirements:\n- ${req}\n- Strong communication skills.` }).insider_tip;
  const tips = [mk('Possession of a Texas Journeyman or Master electrical license.'), mk('Current BLS certification required.'), mk('5+ years of commercial HVAC service experience.'), mk("Bachelor's degree in Finance required.")];
  assert.match(tips[0], /Texas Journeyman or Master/);
  assert.match(tips[1], /"BLS"/);
  assert.match(tips[2], /commercial HVAC service/);
  assert.match(tips[3], /Bachelor's degree in Finance/);
  const closings = tips.map((t) => t.replace(/^[^"]*"[^"]*"\.?\s*/, ''));
  assert.equal(new Set(closings).size, closings.length, JSON.stringify(closings));
});

test('a short or company-heavy posting says what it states and what it leaves out, in one sentence', () => {
  const o = buildJobInsights({ title: 'Team Member', company: 'Sunbelt', description: 'Sunbelt is a family-owned business founded in 1985 and proud of our community roots. We believe in our values and our people. Requirements: reliable and punctual.' });
  assert.match(o.posting_note, /^This posting is short/);
  assert.match(o.posting_note, /the pay/);
  assert.ok(!/\n/.test(o.posting_note));
});

// ── Round 3 (director's spot read: corpus 37 SpaceX, 121 Skilled Wound Care, 305 Integrity) ──
import { negatesCue, spokenStatement } from './jobInsights.js';
const CUE = { schedule: /shift|weekend|night|holiday|overtime|on[- ]call|evening/i, physical: /lift|stand|bend|climb|carry|kneel/i, travel: /travel/i, screening: /background|drug|fingerprint|driving/i, onsite: /office|on[- ]?site|in[- ]person/i };

test('polarity: a promised absence is never shown as a hardship ("No overnight shifts, no weekends…")', () => {
  const er = buildJobInsights({ title: 'Emergency Medicine Physician', company: 'Skilled Wound Care', description: 'Requirements:\n- Medical License: Unrestricted/clear medical license in the state of practice.\n- Medical Degree: MD or DO from an accredited institution.\nSchedule:\n- No overnight shifts, no weekends, no holidays and no pagers' });
  assert.ok(!er.hidden_items.some((h) => !h.absent && h.kind === 'schedule'), JSON.stringify(er.hidden_items));
  assert.ok(er.hidden_items.some((h) => h.absent && /No overnight shifts/.test(h.text)), JSON.stringify(er.hidden_items));
  assert.ok(!er.hidden_requirements.some((t) => /Apply only if you can work/.test(t)));
  const desk = buildJobInsights({ title: 'Receptionist', company: 'Acme', description: 'Requirements:\n- 1+ year of front desk experience.\n- No heavy lifting required.\n- Not required to work weekends.\n- No travel required.' });
  assert.ok(!desk.hidden_items.some((h) => !h.absent && ['physical', 'schedule', 'travel'].includes(h.kind)), JSON.stringify(desk.hidden_items));
  assert.equal(negatesCue('No overnight shifts, no weekends', /weekend/i), true);
  assert.equal(negatesCue('Must work weekends, no exceptions', /weekend/i), false);
});

for (const p of POSTINGS) {
  test(`${p.id || p.title}: no condition quotes a source that negates its own cue`, () => {
    const o = buildJobInsights({ title: p.title, company: p.company, description: p.description });
    for (const h of o.hidden_items) if (!h.absent && CUE[h.kind]) assert.equal(negatesCue(h.source.replace(/^…|…$/g, ''), CUE[h.kind]), false, h.text);
  });
}

test('preferred stays preferred: an item under a flat "PREFERRED SKILLS AND EXPERIENCE:" heading is labelled and never "asked for"', () => {
  const sx = buildJobInsights({ title: 'Equipment Maintenance Technician', company: 'SpaceX', description: "BASIC QUALIFICATIONS: High school diploma or equivalency certificate 3+ years of professional experience in a hands-on manufacturing environment; OR bachelor's degree in an engineering, math or science discipline PREFERRED SKILLS AND EXPERIENCE: Degree in electronics technology, mechanical engineering, or related field 6+ years of direct experience in semiconductor photolithography operations within a fab environment 6+ years experience troubleshooting and optimizing programmable logic controllers (PLC) and variable frequency drives (VFD) ADDITIONAL REQUIREMENTS: Must be able to work all shifts and be willing to work overtime and/or weekends as needed" });
  const six = sx.items.find((i) => /^6\+ years/.test(i.text));
  if (six) assert.equal(six.importance, 'preferred', JSON.stringify(sx.items));
  const firstPref = sx.items.findIndex((i) => i.importance === 'preferred');
  if (firstPref >= 0) assert.ok(sx.items.slice(firstPref).every((i) => i.importance === 'preferred'));
  const asks = (sx.description_summary.match(/It asks for ([^.]*?)(?:, and prefers|\.)/) || [])[1] || '';
  assert.doesNotMatch(asks, /6\+ years|photolithography|PLC/i, sx.description_summary);
  // an either-or bar holds the item it names: shown once
  const texts = sx.items.map((i) => i.text.toLowerCase());
  for (const t of texts) assert.ok(!texts.some((o) => o !== t && /, or /.test(o) && o.includes(t)), JSON.stringify(texts));
});

test('the years tip is composed by what the object is, never "years you\'ve done a … environment"', () => {
  const tip = (req) => buildJobInsights({ title: 'Role', company: 'Acme', description: `Requirements:\n- ${req}\n- Strong attention to detail.` }).insider_tip;
  assert.match(tip('Minimum of 1 year of experience in a warehouse or similar environment'), /Put your years working in a warehouse or similar environment in your first line\./);
  assert.match(tip('5+ years of industrial hygiene experience'), /Put your years in industrial hygiene in your first line\./);
  assert.match(tip('1 year of experience as department manager, service manager, or in an equivalent role'), /Put your years as department manager/);
  for (const r of ['Minimum of 1 year of experience in a warehouse or similar environment', '3+ years of medical device experience']) assert.doesNotMatch(tip(r), /years you've done an? /);
});

test('the summary reads as prose: no space before punctuation, no imperative bullet glued on, no clipped or generic item', () => {
  const o = buildJobInsights({ title: 'Warehouse Associate', company: 'Integrity Staffing Solutions', description: "We’re looking for Warehouse Associates to work in our client's partially climate-controlled facility !\nResponsibilities:\n- Receive and put away inventory\n- Pack and ship orders according to customer specifications\nRequirements:\n- Minimum of 1 year of experience in a warehouse or similar environment\n- High school diploma or a GED\n- We provide comprehensive training" });
  assert.doesNotMatch(o.description_summary, /\s[!?.,;:]/, o.description_summary);
  assert.doesNotMatch(o.description_summary, /facility! Receive/);
  const er = buildJobInsights({ title: 'Physician', company: 'Skilled Wound Care', description: 'Requirements:\n- DEA License: Or eligibility to obtain one\n- No previous wound care experience is required; we provide comprehensive wound care training\n- The award is based entirely on what current employees say about their experience working here.' });
  assert.doesNotMatch(er.description_summary, /employees say about|, training/i, er.description_summary);
  assert.ok(!er.items.some((i) => /^(?:Training|Employees say about)$/.test(i.text)), JSON.stringify(er.items));
});

test('quotes carry the fact in ≤ 120 characters ("…" marks a cut) and a Workday header is never the schedule sentence', () => {
  for (const p of POSTINGS) {
    const o = buildJobInsights({ title: p.title, company: p.company, description: p.description });
    for (const i of o.items) assert.ok(i.source.replace(/^…|…$/g, '').length <= 122, `${i.text}: ${i.source}`);
  }
  const bofa = buildJobInsights({ title: 'Credit Officer II', company: 'Bank of America', description: 'Required Qualifications:\n- 10+ years of solid Commercial Banking experience\n- Strong financial analysis skills\nShift:\n1st shift (United States of America)' });
  assert.ok(!bofa.hidden_items.some((h) => /United States of America/.test(h.text)), JSON.stringify(bofa.hidden_items));
});

// ── Round 4 (director's read of idx 305 Integrity, 398 Flex) ──
test('summary joins each statement by its word class: noun phrase as is, gerund as experience, verb as ability', () => {
  const flex = buildJobInsights({ title: 'Director, Sales Solutions Engineering', company: 'Flex', description: 'What you bring:\n- 10+ years in pre-sales, solutions engineering, or technical sales\n- Track record closing large, multi-stakeholder, technically complex sales cycles\n- Building or scaling an SE or technical pre-sales function\n- Engage and build credibility with C-suite and VP-level technical buyers' });
  assert.doesNotMatch(flex.description_summary, /ability to track|\b(a|an|the) (a|an|the)\b/i, flex.description_summary);
  const asks = (flex.description_summary.match(/It asks for [^.]*\./) || [''])[0];
  assert.ok(asks.length <= 260 && !/…/.test(asks), asks);
  const say = (text) => spokenStatement({ text, kind: 'requirement', importance: 'required', short: '' });
  assert.equal(say('Track record closing large, multi-stakeholder sales cycles'), 'a track record closing large, multi-stakeholder sales cycles');
  assert.equal(say('Building or scaling an SE or technical pre-sales function'), 'experience building or scaling an SE or technical pre-sales function');
  assert.equal(say('Engage and build credibility with C-suite buyers'), 'the ability to engage and build credibility with C-suite buyers');
  assert.equal(say('Enterprise integration patterns'), 'enterprise integration patterns');
  assert.equal(say('Training new hires on safety'), 'training new hires on safety');
});

test('soft-trait lines never crowd out the job: duties before them, at most two', () => {
  const o = buildJobInsights({ title: 'Warehouse Associate', company: 'Integrity Staffing Solutions', description: 'Responsibilities:\n- Receive and put away inventory\n- Pack and ship orders according to customer specifications\n- Load boxes into trucks for shipment\nRequirements:\n- Minimum of 1 year of experience in a warehouse or similar environment\n- High school diploma or a GED\n- Strong organizational and time management skills\n- Ability to work independently and as part of a team\n- Ability to follow instructions and work safely\n- Excellent interpersonal and communication skills' });
  const top = o.what_they_want.join(' | ');
  for (const d of ['Receive and put away inventory', 'Pack and ship orders', 'Load boxes into trucks']) assert.ok(top.includes(d), top);
  const soft = o.items.filter((i) => /organizational|independently|follow instructions|interpersonal/i.test(i.text));
  assert.ok(soft.length <= 2, JSON.stringify(soft));
});

test('a heading word glued to a quoted line is dropped, and "no experience" beside a years minimum is said as one question', () => {
  const flex = buildJobInsights({ title: 'Director', company: 'Flex', description: 'Requirements:\n- 10+ years in technical sales.\nOffices Roles posted in New York, San Francisco, and Salt Lake City are hybrid positions with on-site expectations of three days per week.' });
  assert.ok(!flex.hidden_items.some((h) => /"Offices Roles/.test(h.text)), JSON.stringify(flex.hidden_items));
  const ws = buildJobInsights({ title: 'Warehouse Associate', company: 'Integrity', description: 'No experience required!\nRequirements:\n- Minimum of 1 year of experience in a warehouse or similar environment\n- High school diploma or a GED' });
  const c = ws.hidden_items.filter((h) => h.kind === 'conflict');
  assert.equal(c.length, 1, JSON.stringify(ws.hidden_items));
  assert.match(c[0].text, /says both "No experience required" and "Minimum of 1 year/);
  assert.ok(!ws.hidden_items.some((h) => h.kind === 'promise' && /No experience/.test(h.text)));
});
