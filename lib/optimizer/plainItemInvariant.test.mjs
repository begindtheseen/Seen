// R4 invariant (verdict gold): a plain bullet under a requirements / duties / preferred heading always becomes a
// statement — displayed or hidden — never lost by the reader. (A pay line the section reader re-files as benefits is no
// longer under that heading, so it is outside the invariant.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJobFacts } from './extractJobFacts.js';

const ITEMS = [
  'This role follows a hybrid schedule.',
  'Patient and family education',
  'Interdisciplinary care coordination',
  'Medication administration',
  'Other duties as assigned',
  'Punctual and dependable',
  'Training',
];
const HEADINGS = ['Responsibilities', 'Requirements', 'Preferred Qualifications'];
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

for (const h of HEADINGS) {
  test(`every plain bullet under "${h}" becomes a statement`, () => {
    const text = `Acme Health is hiring a Registered Nurse.\n\n${h}\n${ITEMS.map((i) => `- ${i}`).join('\n')}\n`;
    const { statements = [] } = extractJobFacts(text, { company: 'Acme Health', title: 'Registered Nurse' });
    for (const it of ITEMS) {
      const hit = statements.find((s) => norm(s.source).includes(norm(it)) || norm(it).includes(norm(s.text)) && norm(s.text).length > 4);
      assert.ok(hit, `no statement for "${it}" under ${h}`);
    }
  });
}

test('short noun-phrase duties under a duties heading are displayed as duties; junk items are hidden with a reason', () => {
  const text = `Acme Health is hiring a Registered Nurse.\n\nResponsibilities\n${ITEMS.map((i) => `- ${i}`).join('\n')}\n`;
  const { statements = [] } = extractJobFacts(text, { company: 'Acme Health', title: 'Registered Nurse' });
  const by = (t) => statements.find((s) => norm(s.source).includes(norm(t)));
  for (const t of ['Patient and family education', 'Interdisciplinary care coordination']) {
    const s = by(t);
    assert.equal(s.display, true, t);
    assert.equal(s.shape, 'duty', t);
  }
  const cond = by('This role follows a hybrid schedule');
  assert.equal(cond.display, true);
  assert.equal(cond.shape, 'condition');
  assert.equal(by('Other duties as assigned').display, false);
  assert.match(by('Other duties as assigned').hideReason, /other_duties|not_a_requirement/);
  assert.equal(by('Training').display, false);
});

test('linear time: a 5,000-repetition plain bullet', () => {
  for (const u of ['other ', 'skills and ', 'education ', 'a?']) {
    const t0 = Date.now();
    extractJobFacts(`Acme is hiring.\n\nRequirements\n- ${u.repeat(5000)}\n- Punctual and dependable\n`, { company: 'Acme' });
    assert.ok(Date.now() - t0 < 5000, `"${u}" took ${Date.now() - t0} ms`);
  }
});

test('a trailing level word is the importance, not the text (whole units otherwise)', async () => {
  const { unitText } = await import('./statements.js');
  assert.equal(unitText('Experience with a major ERP system preferred.'), 'Experience with a major ERP system');
  assert.equal(unitText('Strong SQL experience is a plus'), 'Strong SQL experience');
  assert.equal(unitText('Experience with Kafka (preferred)'), 'Experience with Kafka');
  // a predicate is part of the clause; too short a remainder keeps its word
  assert.equal(unitText('For each missing year of college is required'), 'For each missing year of college is required');
  assert.equal(unitText('Travel required'), 'Travel required');
  const t0 = Date.now();
  unitText(`${'a '.repeat(5000)}x`); unitText(`${' -'.repeat(5000)}preferred`); unitText(`${'is '.repeat(5000)}required`);
  assert.ok(Date.now() - t0 < 2000);
  const { statements } = extractJobFacts('Acme is hiring.\n\nRequirements\n- 2+ years of accounting experience\n- Experience with a major ERP system preferred\n- Strong Excel skills\n', { company: 'Acme' });
  const erp = statements.find((s) => /ERP/.test(s.text));
  assert.equal(erp.text, 'Experience with a major ERP system');
  assert.equal(erp.importance, 'preferred');
});

test('a lead-in that says the items are a bonus makes them preferred (flat text, no heading of its own)', () => {
  const text = 'Acme is hiring.\n\nAbout you\n- You have excellent communication skills\n- You demonstrate a strong bias toward action\nIt will be considered a bonus if (not mandatory):\n- You have experience working at a SaaS startup\n- You have past experience in the public transit industry\n';
  const { statements } = extractJobFacts(text, { company: 'Acme' });
  assert.equal(statements.find((s) => /SaaS startup/.test(s.text)).importance, 'preferred');
  assert.equal(statements.find((s) => /public transit/.test(s.text)).importance, 'preferred');
  assert.notEqual(statements.find((s) => /communication skills/.test(s.text)).importance, 'preferred');
});

test('structure: a pay label inside a bullet is that bullet only; sub-headings between bullets are not items', () => {
  const a = extractJobFacts('Acme is hiring.\n\nRequirements:\n• 3+ years of Python experience\n• Experience with SQL. Salary: $90,000 - $120,000 per year\n• Strong communication skills\n', { company: 'Acme' }).statements;
  assert.ok(a.some((s) => s.display !== false && /communication skills/.test(s.text)));
  const b = extractJobFacts('Acme is hiring.\n\nKEY RESPONSIBILITIES\nBuild the materials\n• Build customer-facing decks and proposals for partners\n• Draft term sheets and deal memos\nRun the execution\n• Run the day-to-day commercial process on active accounts\n', { company: 'Acme' }).statements;
  assert.ok(!b.some((s) => s.display !== false && /^(?:Build the materials|Run the execution)$/.test(s.text)));
  assert.equal(b.filter((s) => s.display !== false).length, 3);
});

test('junk the one-count rule would show is hidden', () => {
  const st = extractJobFacts('Acme is hiring.\n\nRequirements:\n• 3+ years of Python experience\n• Actual compensation may vary based on experience\n• Final salary is based on a number of factors including location\n• Training and Development Opportunities\n• Every Acme employee is expected to follow the security standards\n', { company: 'Acme' }).statements;
  for (const re of [/compensation may vary/, /Final salary/, /Development Opportunities/, /Every Acme employee/]) {
    const s = st.find((x) => re.test(x.text));
    assert.ok(!s || s.display === false, String(re));
  }
});
