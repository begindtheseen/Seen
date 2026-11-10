// The paid package never throws (round 3: a real RN résumé × RN posting threw inside the format diff). Every persona,
// calibration and T3 résumé × real postings, plus empty / one-line / garbage postings and résumés, must return a package
// with a verdict and a `tailored` result (a failure degrades to "your document kept as written", free).
// Default: every résumé × 12 postings + every garbage case. FUZZ_FULL=1 → × 120 postings.
// Run: node --test lib/resume/tailor/fuzz.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPaidOptimize } from '../../server/optimizePackage.js';

const dirs = ['../../fixtures/personas/', '../../fixtures/calibration/'];
const RESUMES = [];
for (const d of dirs) {
  const url = new URL(d, import.meta.url);
  for (const f of fs.readdirSync(url)) if (f.endsWith('.txt') && !/-jd\.txt$/.test(f)) RESUMES.push([f, fs.readFileSync(new URL(f, url), 'utf8')]);
}
for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(new URL('./fixtures/t3-resumes.json', import.meta.url), 'utf8')))) RESUMES.push([`t3:${k}`, v]);
const REAL = [
  ...JSON.parse(fs.readFileSync(new URL('./fixtures/t3-postings.json', import.meta.url), 'utf8')),
  ...JSON.parse(fs.readFileSync(new URL('../../fixtures/personas/postings-sample.json', import.meta.url), 'utf8')),
].filter((p) => p && p.description);
// halves and quarters of real postings stand in for cut copies and teasers
const CUT = REAL.flatMap((p) => [{ ...p, title: p.title, description: p.description.slice(0, Math.floor(p.description.length / 2)) }, { ...p, description: p.description.slice(Math.floor(p.description.length / 4)) }]);
const POOL = [...REAL, ...CUT];
const GARBAGE_POSTINGS = ['', 'x', 'Requirements:', 'Sales Associate', '<p><strong>Job</strong></p><ul><li></li></ul>', '•••\n\n- \n- \n', 'a'.repeat(5000), 'Requirements:\n- ' + 'Excel, '.repeat(400)];
const GARBAGE_RESUMES = ['', 'hello', '%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%', 'John Doe\njohn@example.com', 'EXPERIENCE\n\n\n- \n- ', 'SUMMARY\n' + 'Hard working. '.repeat(300)];
const N = process.env.FUZZ_FULL ? 120 : 12;

function check(name, r) {
  assert.ok(r && typeof r === 'object', name);
  assert.ok('fit_score' in r, `${name}: verdict missing`);
  assert.ok(r.charge && typeof r.charge.sentence === 'string', `${name}: charge missing`);
  if (r.tailored) { assert.ok(Array.isArray(r.tailored.changes), name); assert.equal(typeof r.tailored.text, 'string', name); }
}

test(`never throws: ${RESUMES.length} résumés × ${N} postings`, () => {
  for (const [rn, text] of RESUMES) for (let i = 0; i < N; i++) {
    const j = POOL[(i * 7 + rn.length) % POOL.length];
    let r;
    assert.doesNotThrow(() => { r = buildPaidOptimize({ resume: text, original: text, jobDescription: j.description, job: j.title, company: j.company }); }, `${rn} × ${j.title}`);
    check(`${rn} × ${j.title}`, r);
  }
});

test('never throws on garbage postings and résumés', () => {
  const someResumes = RESUMES.slice(0, 4).map((x) => x[1]);
  for (const jd of GARBAGE_POSTINGS) for (const text of [...someResumes, ...GARBAGE_RESUMES]) {
    let r;
    assert.doesNotThrow(() => { r = buildPaidOptimize({ resume: text, original: text, jobDescription: jd, job: 'Sales Associate', company: 'Acme' }); });
    check(`garbage ${JSON.stringify(jd.slice(0, 20))}`, r);
  }
  for (const text of GARBAGE_RESUMES) for (const j of REAL.slice(0, 6)) {
    let r;
    assert.doesNotThrow(() => { r = buildPaidOptimize({ resume: text, original: text, jobDescription: j.description, job: j.title, company: j.company }); });
    check(`garbage résumé × ${j.title}`, r);
  }
});
