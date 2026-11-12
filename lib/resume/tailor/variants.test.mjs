// Re-optimize variants, the per-role reasons and the version-change sentence (owner, 2026-11-12).
// Run: node --test lib/resume/tailor/variants.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPaidOptimize } from '../../server/optimizePackage.js';
import { canonicalResumeText } from '../canonical.js';
import { serializeToText } from '../model.js';
import { parseResume } from '../parse/index.js';
import { runOptimizer } from '../../optimizer/index.js';
import { visibility } from './paid.js';
import { MAX_VARIANTS } from './variants.js';
import { roleReasons } from './roleReasons.js';
import { describeVersionChange } from './versionDiff.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const FX = JSON.parse(read('../../optimizer/fixtures/expert-postings.json'));
const CASES = [
  { name: 'shift lead (gold)', resume: read('../../fixtures/crosstool/gold-shift-lead/resume-shift-supervisor.txt'), jd: read('../../fixtures/crosstool/gold-shift-lead/posting-shift-lead.txt'), job: 'Shift Lead', company: 'Copper Kettle Kitchen' },
  { name: 'retail money fixture', resume: FX.resume, jd: FX.postings.A.jd, job: FX.postings.A.title, company: FX.postings.A.company },
];
const flat = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const build = (c, variant) => buildPaidOptimize({ resume: canonicalResumeText(c.resume), resumeIsCanonical: true, original: c.resume, jobDescription: c.jd, job: c.job, company: c.company, variant });

for (const c of CASES) {
  test(`${c.name}: variants are distinct, deterministic, honest and never below the résumé as written`, () => {
    const v0 = build(c, 0);
    assert.ok(v0.tailored && v0.tailored.doc, 'the paid build has a document');
    const base = parseResume({ text: canonicalResumeText(c.resume), source: 'text' });
    const baseLines = new Set(base.experience.flatMap((e) => e.bullets.map((b) => flat(b.text))));
    const roleLine = (e) => flat(`${e.title} ${e.company}`);
    const baseRoles = new Set(base.experience.map(roleLine));
    const read0 = runOptimizer({ resumeText: serializeToText(base), jobTitle: c.job, company: c.company, jobDescription: c.jd });
    const visBase = visibility(base, read0).shown;
    const texts = [serializeToText(v0.tailored.doc)];
    let exhausted = false, made = 0;
    for (let k = 1; k <= MAX_VARIANTS; k++) {
      const r = build(c, k);
      if (r.variant_exhausted) { exhausted = true; assert.match(r.sentence, /no other honest version/i); assert.equal(r.tailored, null); continue; }
      assert.ok(!exhausted, 'candidates are tried in one fixed order: after the first missing index none follows');
      made++;
      const doc = r.tailored.doc;
      const t = serializeToText(doc);
      assert.ok(!texts.includes(t), `variant ${k} differs from every earlier version`);
      texts.push(t);
      // deterministic per index
      assert.equal(serializeToText(build(c, k).tailored.doc), t, `variant ${k} is the same every time`);
      // honest: every experience line is one of the person's own lines (or the same line the paid build carries)
      const v0Lines = new Set(v0.tailored.doc.experience.flatMap((e) => e.bullets.map((b) => flat(b.text))));
      for (const e of doc.experience) for (const b of e.bullets) assert.ok(baseLines.has(flat(b.text)) || v0Lines.has(flat(b.text)), `no invented line: "${b.text}"`);
      for (const e of doc.experience) assert.ok(baseRoles.has(roleLine(e)), 'no invented role');
      // never below the résumé as written: the fit score and what the first read shows
      const after = runOptimizer({ resumeText: t, jobTitle: c.job, company: c.company, jobDescription: c.jd });
      if (read0.fit_score != null && after.fit_score != null) assert.ok(after.fit_score >= read0.fit_score, `variant ${k} fit ${after.fit_score} ≥ ${read0.fit_score}`);
      assert.ok(visibility(doc, read0).shown >= visBase, `variant ${k} shows no less in the first read`);
      assert.equal(r.tailored.variant.index, k);
      assert.ok(r.tailored.roles.length >= 1, 'each variant carries its reasons');
    }
    assert.ok(made >= 1, `${c.name}: at least one honest variant`);
  });
}

test('the gold shift lead: variant 1 condenses the cashier job, and the sentence says so', () => {
  const v0 = build(CASES[0], 0), v1 = build(CASES[0], 1);
  assert.deepEqual(v1.tailored.variant.moves.map((m) => m.split(':')[0]), ['condense']);
  const s = describeVersionChange(v0.tailored.doc, v1.tailored.doc);
  assert.equal(s, "This one condenses Fry's Food Stores to one line.");
  assert.equal(describeVersionChange(v1.tailored.doc, v0.tailored.doc), "This one keeps Fry's Food Stores in full.");
  const cashier = v1.tailored.roles.find((r) => /Fry/.test(r.company));
  assert.equal(cashier.decision, 'condensed');
  assert.match(cashier.sentence, /^Condensed to one line under Additional Experience: it shares little with this job/);
  assert.match(cashier.sentence, /covers 2018 – 2020/);
});

test('describeVersionChange names a new lead line, a summary change and a layout change', () => {
  const doc = (o = {}) => ({ basics: { summary: o.summary ?? 'Shift lead.' }, meta: { sectionTitles: o.rel ? { experience: 'Relevant Experience' } : {} }, experience: [{ title: 'Shift Supervisor', company: 'Dutch Bros', bullets: (o.lead ? [o.lead] : ['Run the shift']).map((text) => ({ text })) }], extra: [] });
  assert.equal(describeVersionChange(doc(), doc({ lead: 'Train every new hire' })), 'This one opens Dutch Bros with “Train every new hire”.');
  assert.equal(describeVersionChange(doc(), doc({ summary: '' })), 'This one leaves the summary off.');
  assert.equal(describeVersionChange(doc(), doc({ rel: true })), 'This one puts your most relevant jobs first under Relevant Experience.');
  assert.equal(describeVersionChange(doc(), doc()), 'This one orders a few lines differently.');
});

test('roleReasons: one sentence per role; a named thing is only ever a shown statement proved by that role\'s own line', () => {
  for (const c of CASES) {
    const v0 = build(c, 0);
    const base = parseResume({ text: canonicalResumeText(c.resume), source: 'text' });
    const out = runOptimizer({ resumeText: serializeToText(base), jobTitle: c.job, company: c.company, jobDescription: c.jd });
    const rows = v0.tailored.roles;
    assert.equal(rows.length, base.experience.length, 'a reason for every job');
    for (const r of rows) {
      assert.ok(/^(Kept in full|Kept \d+ of its \d+ lines|Condensed to one line|Left off this version)/.test(r.sentence), r.sentence);
      assert.ok(/[.]$/.test(r.sentence) && !/undefined|null|NaN/.test(r.sentence), r.sentence);
      const e = base.experience.find((x) => flat(x.company) === flat(r.company) && flat(x.title) === flat(r.title));
      const lines = e.bullets.map((b) => flat(b.text));
      // every label printed in the parenthesis belongs to a SHOWN statement whose evidence is one of this role's lines
      const header = flat(`${e.title} ${e.company}`);
      const shownHere = (out.statements || []).filter((st) => st.status === 'shown' && (st.evidence || []).some((ev) => flat(ev.line).includes(header) || lines.some((l) => l && (l === flat(ev.line) || (flat(ev.line).length >= 16 && (l.includes(flat(ev.line)) || flat(ev.line).includes(l)))))));
      assert.ok(r.shown <= shownHere.length, `${r.company}: counts only what its lines show`);
      if (!r.shown) assert.ok(!r.labels.length, 'nothing named when nothing is shown');
      for (const l of r.labels) assert.ok(r.sentence.includes(l), 'the label is in the sentence');
    }
  }
  // direct: a role whose line proves nothing names nothing; a statement only partly shown is never named
  const base = { experience: [{ id: 'a', title: 'Cook', company: 'Diner', start: '2020', end: 'present', bullets: [{ id: 'b1', text: 'Prepped the line every morning' }] }, { id: 'c', title: 'Valet', company: 'Towne Park', start: '2016', end: '2019', bullets: [{ id: 'b2', text: 'Parked cars' }] }] };
  const out = { requirement_count: 4, statements: [
    { id: 's1', text: 'Food prep', status: 'shown', display: true, evidence: [{ line: 'Prepped the line every morning' }] },
    { id: 's2', text: 'Inventory control', status: 'partly', display: true, evidence: [{ line: 'Prepped the line every morning' }] },
    { id: 's3', text: 'Forklift', status: 'not_shown', display: true, evidence: [] },
  ], matched_requirements: [] };
  const rows = roleReasons({ base, variant: base, out, employer: 'Copper Kettle', now: new Date('2026-11-12') });
  assert.equal(rows[0].sentence, 'Kept in full: your Cook work at Diner shows 1 of the 4 things Copper Kettle lists (food prep), and part of 1 more.');
  assert.ok(!/inventory|forklift/i.test(rows[0].sentence));
  assert.equal(rows[1].sentence, 'Kept in full: none of its lines shows what Copper Kettle lists; there is room on the page, so it stays as part of your work history.');
});
