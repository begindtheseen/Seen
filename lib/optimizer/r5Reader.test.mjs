// R5 reader classes, each pinned by its general wording (never one posting's line).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJobFacts } from './extractJobFacts.js';
import { cleanPastedPosting } from './pastedText.js';
import { splitRunOnStatement, companySpeaks } from './statementGate.js';
import { unitText } from './statements.js';

const shown = (text, company = 'Acme') => extractJobFacts(text, { company, jobTitle: 'Technician' }).statements.filter((s) => s.display !== false && s.kind !== 'promise');

test('1. the company speaking is never a displayed statement', () => {
  for (const line of ['ACME is seeking an experienced Knowledge Manager to support our customers', 'Acme is Immediately Hiring Experienced CDL-A Truck Drivers!', 'Currently, we stand as a pioneering enterprise in the restaurant SaaS sector', 'As an accredited and licensed provider, Acme complies with all state mandates', 'Our team is building the future of logistics']) {
    assert.ok(companySpeaks(line, 'Acme Corp'), line);
  }
  assert.ok(!companySpeaks('Experience with SQL and Python', 'Acme'));
  assert.ok(!companySpeaks('Must hold an active RN license', 'Acme'));
  const st = shown('Acme Corp\n\nRequirements:\n• Acme Corp is seeking a technician to support our sites\n• 3+ years of HVAC experience\n• Valid driver license\n');
  assert.ok(!st.some((s) => /is seeking/.test(s.text)));
});

test('2. a list of what the employee receives is benefits, whatever its heading', () => {
  const st = shown('Acme\n\nWhat We Are Looking For\n• 3+ years of experience leading a team\n• Strong communication skills\n\nA Commitment to Your Growth\n• Structured onboarding and training from experienced staff\n• Monthly continuing education and ongoing training workshops\n• Transparent paths for advancement and development\n• Tuition savings with partner universities\n');
  assert.ok(st.some((s) => /3\+ years/.test(s.text)));
  assert.ok(!st.some((s) => /onboarding|workshops|advancement|Tuition/.test(s.text)));
});

test('3. catch-all, process and pay lines are hidden', () => {
  const st = shown('Acme\n\nResponsibilities:\n• Inspect and repair equipment on site\n• Maintain accurate service records for every unit\n• Contribute to wider goals and/or activities as assigned\n• Perform additional program support duties as required to support the mission\n• Flexible position level in accordance with qualifications\n• No previous professional experience is required to apply\n• Estimated earnings may vary depending on task volume\n• Additionally, some roles require passing a drug test\n');
  assert.equal(st.length, 2, JSON.stringify(st.map((s) => s.text)));
});

test('4. markup is never text (five kinds of leaked HTML)', () => {
  const raw = 'Responsibilities:\n• <div><label for="pf-f19d88d8-7c79-41b9-a503-2abb45e2116e-richTextParagraph-54" id="x"></label></div>\n• data-testid="field-container" data-node-type="extension">\n• <span class="x">Build things for customers</span>\n• <!-- tracking -->Own the roadmap\n• </div>\n• Repair the units &amp; fixtures\n';
  const c = cleanPastedPosting(raw);
  assert.doesNotMatch(c, /<|>|="|pf-f19d|data-testid/);
  assert.match(c, /Build things for customers/);
  assert.match(c, /Own the roadmap/);
  const st = shown(raw);
  assert.ok(st.every((s) => !/[<>="]|richText/.test(s.text)), JSON.stringify(st.map((s) => s.text)));
});

test('5. a unit is never cut by length or after a word that needs a noun', () => {
  assert.deepEqual(splitRunOnStatement('Collect, organize, analyze, and maintain information from multiple Government organizations, program offices, and mission partners'), ['Collect, organize, analyze, and maintain information from multiple Government organizations, program offices, and mission partners']);
  assert.equal(splitRunOnStatement('Ph.D. or Masters in Optics, Applied Physics, or a related field').length, 1);
  assert.equal(unitText('Experience with CAD software a plus'), 'Experience with CAD software');
  const st = shown('Acme\n\nResponsibilities:\n• Ensure all AI solutions are explainable and meet corporate Model Risk Management (MRM) and data privacy standards\n• Interact with sites, investigators and coordinators as appropriate\n');
  assert.equal(st.length, 2, JSON.stringify(st.map((s) => s.text)));
});

test('6. run-ons: literal \\n breaks, labelled sub-items of a lead-in, a repeated item shape', () => {
  const st = shown('Acme\n\nRequirements:\n• Valid CDL-A and 3 months of current experience required \\n This lane is not suitable for students \\n Home time varies by route\n• Clean driving record for the past 3 years\n');
  assert.ok(st.some((s) => /^Valid CDL-A and 3 months of current experience/.test(s.text) && !/lane/.test(s.text)));
  assert.equal(splitRunOnStatement('Experience working with LLMs and prompt engineering Introductory knowledge of Python or another scripting language').length, 2);
  const lead = shown('Acme\n\nResponsibilities:\n• Build and deploy AI-assisted workflows using Copilot Studio to automate:\n• Control Mapping: Automatically mapping business processes to NIST frameworks.\n• Automated Walkthroughs: Using AI to summarize meeting transcripts.\n• Library Management: Develop and maintain a prompt registry for the team.\n');
  assert.ok(lead.some((s) => /to automate: Control Mapping/.test(s.source || s.text)));
  assert.ok(!lead.some((s) => /^Using AI/.test(s.text)));
  assert.ok(lead.some((s) => /prompt registry/.test(s.text)));
});

test('8. importance: the item cue wins; preferred headings in any wording', () => {
  const imp = (text, re) => (extractJobFacts(text, { company: 'Acme' }).statements.find((s) => re.test(s.text)) || {}).importance;
  assert.equal(imp('Acme\n\nRequirements:\n• 3+ years as a BCBA\n• Ideally has some experience mentoring other BCBAs\n• Strong documentation skills\n', /Ideally/), 'preferred');
  assert.equal(imp('Acme\n\nWhat you will do:\n• Keep kids engaged and safe with activities\n• Assist with basic routines like meals and naps\n• (CPR/First Aid certification is a plus!)\n', /CPR/), 'preferred');
  for (const head of ['⭐ Bonus Points', 'Qualifications We Prefer', 'What Will Set You Apart', "It's a plus if you have", "You'd be a great fit with:"]) {
    assert.equal(imp(`Acme\n\nRequirements:\n• 3+ years of SQL experience\n• Strong communication skills\n\n${head}\n• Experience working within DoD programs\n• Knowledge of strategic systems programs\n`, /DoD programs/), 'preferred', head);
  }
  assert.equal(imp('Acme\n\nRequirements:\n• 3+ years of machining experience\n• Availability to start soon. PREFERRED\n• TIG welding and general fabrication ability\n• CAD proficiency for fixture design\n', /Availability/), 'required');
});

test('7. a bare degree level is a fragment, never shown; the sentence it came from is not cut there', () => {
  const s = "Our global team includes many leading scientists, with more than 70% of our technology team holding advanced degrees at the Master's or PhD level";
  assert.ok(!splitRunOnStatement(s).some((p) => /^Master's or PhD level$/.test(p)));
  const st = shown("Acme\n\nPreferred Qualifications\n• Experience with optical modeling software\n• Master's or PhD level\n• Experience with CAD software\n");
  assert.ok(!st.some((x) => /^Master's or PhD level$/.test(x.text)));
});

test('R5+: "preferred" modifying a noun is no level word; a tail or predicate is', () => {
  const imp = (line) => (extractJobFacts(`Acme\n\nRequirements:\n• ${line}\n• Experience with Kafka\n• SQL skills\n`, { company: 'Acme' }).statements.find((s) => line.toLowerCase().includes(s.text.toLowerCase().slice(0, 10))) || {}).importance;
  assert.equal(imp('5+ years of backend engineering experience, with Go as your primary/preferred language'), 'required');
  assert.equal(imp('Experience managing preferred vendors and suppliers'), 'required');
  assert.equal(imp('Experience with Terraform preferred'), 'preferred');
  assert.equal(imp('Familiarity with AWS (preferred)'), 'preferred');
  assert.equal(imp('Docker experience is a plus'), 'preferred');
  assert.equal(imp('A CPA is preferred but not required'), 'preferred');
});

test('R5+: a requirement-named "Label: value" is its own requirement wherever it sits', () => {
  const st = extractJobFacts('Acme\n\nResponsibilities:\n• Build services\n\nWhy Acme\n• We grow together and support each other\n• Minimum Degree Required: Bachelor\'s Degree in Computer Science or a related field\n• Flexible PTO and paid holidays\n', { company: 'Acme' }).statements;
  const d = st.find((s) => /Bachelor/.test(s.text));
  assert.ok(d && d.display !== false && d.kind === 'requirement', JSON.stringify(d));
});

test('R5+: a statement that a requirement does not exist stays a PROMISE with its text, never a requirement', () => {
  const st = extractJobFacts('Acme\n\nRequirements:\n• No experience required!\n• Minimum of 1 year of customer service experience\n• Reliable transportation\n', { company: 'Acme' }).statements;
  const p = st.find((s) => /No experience required/.test(s.text));
  assert.equal(p.kind, 'promise');
  assert.ok(!st.some((s) => s.kind !== 'promise' && /No experience required/.test(s.text)));
});
