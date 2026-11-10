// INVARIANT: no engine key ever reaches a screen.
//
// The engines identify requirements by keys ("constraint:years:5", "seniority:mid", an any-of group
// "terms:3"). On 2026-11-09 a posting-term key ("term:futur leader", "term:CHF") reached paying users in
// Interview Prep ("Tell me about your experience with term:design.") because a consumer printed a
// match's identity instead of its label. This test runs EVERY tool in process, exactly as production
// calls it, over real postings × persona résumés from the fields Seen serves (nursing, warehouse,
// trades, accounting, tech, retail, front desk) and walks every string in every output object:
// none may look like an engine key. Add a tool here when you add one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runOptimizer } from './index.js';
import { extractJobFacts } from './extractJobFacts.js';
import { canonicalResumeText } from '../resume/canonical.js';
import { buildJobInsights } from '../server/jobInsights.js';
import { localPack } from '../server/prepLocal.js';
import { buildPaidOptimize, freeDiagnostic } from '../server/optimizePackage.js';
import { previewFrom, healStoredPack } from '../../api/interview-prep.js';
import { buildContext } from '../resume/optimize/engine.js';
import { localDiagnosis, localRewrite } from '../resume/optimize/local.js';
import { tailorResume } from '../resume/tailor/tailor.js';
import { parseResume } from '../resume/parse/index.js';
import { rankRequirements, runScanner, runAdvantage } from '../server/resumeAnalysis.js';

import { ENGINE_KEY_RE as ENGINE_KEY, hasEngineKey } from './types.js';
const FIX = new URL('../fixtures/personas/', import.meta.url);
const POSTINGS = JSON.parse(fs.readFileSync(new URL('postings-sample.json', FIX), 'utf8'));
const resumeOf = (p) => fs.readFileSync(new URL(`${p}.txt`, FIX), 'utf8');

/** Every string in an object, with its path: [path, value]. */
function strings(o, path = '$', acc = []) {
  if (o == null) return acc;
  if (typeof o === 'string') acc.push([path, o]);
  else if (Array.isArray(o)) o.forEach((x, i) => strings(x, `${path}[${i}]`, acc));
  else if (typeof o === 'object') for (const [k, v] of Object.entries(o)) strings(v, `${path}.${k}`, acc);
  return acc;
}
function leaks(name, out) {
  return strings(out).filter(([, s]) => ENGINE_KEY.test(s)).map(([p, s]) => `${name} ${p}: ${s.slice(0, 160)}`);
}

/** Every tool, as production runs it, for one posting × résumé. */
function runTools(p) {
  const resumeRaw = resumeOf(p.persona);
  const resume = canonicalResumeText(resumeRaw);
  const jd = p.description, title = p.title, company = p.company;
  const remoteOk = /\bremote\b/i.test(jd);
  const out = {};
  // free fit check (api/optimizer.js) and its free diagnostic (api/resume.js, signed out / no credit)
  const jobFacts = extractJobFacts(jd, { jobTitle: title, company });
  out.fit = runOptimizer({ resumeText: resume, jobTitle: title, company, jobDescription: jd, jobFacts, companyProcessScore: null, companyProcessConfidence: null, remoteOk, jobLocation: null, desiredLocation: null });
  out.freeDiagnostic = freeDiagnostic(out.fit);
  // paid Optimize package (api/resume.js tool:optimize)
  out.paid = buildPaidOptimize({ resume, jobDescription: jd, job: title, company, pro: true, jobId: p.id, fit: { companyProcessScore: null, companyProcessConfidence: null, remoteOk, jobLocation: null, desiredLocation: null } });
  // Job Insights (api/job-insights.js)
  out.insights = buildJobInsights({ title, company, description: jd, needsSummary: true });
  // Interview Prep: the card's job_text, the server's job_id read, and the free preview
  out.prep = localPack({ company, role: title, resumeText: resumeRaw, jobText: String(jd).slice(0, 6000), pay: null, stage: 'Interview' });
  out.prepDb = localPack({ company, role: title, resumeText: resumeRaw, jobText: `${title} at ${company}\n${jd}`.replace(/[\u0000-\u001f]/g, ' ').slice(0, 6000), pay: null, stage: 'Phone Screen' });
  out.preview = previewFrom({ company, role: title, resumeText: resumeRaw, stage: 'Interview' });
  // the résumé optimizer ("Make it stronger" questions + the rewrite)
  const ctx = buildContext({ resumeText: resumeRaw, jobTitle: title, company, jobDescription: jd });
  const diagnosis = localDiagnosis(ctx);
  out.diagnosis = diagnosis;
  out.rewrite = localRewrite(ctx, diagnosis, []);
  // Résumé Studio Tailor plan
  const { doc } = parseResume(resumeRaw);
  const tailored = tailorResume(doc, { jobTitle: title, company, jobDescription: jd });
  out.tailorPlan = tailored.plan;
  // Strategy (requirements ranked for the plan)
  out.ranked = rankRequirements(jd, title).ranked;
  out.scanner = runScanner({ resume, jobDescription: jd, job: title, company, intelNote: '' });
  out.strategy = runAdvantage({ job: title, company, resume, jobDescription: jd, background: '', intelNote: '', intelStats: null });
  return out;
}

test('the sample spans the fields and carries posting terms (the thing that leaked)', () => {
  assert.ok(new Set(POSTINGS.map((p) => p.field)).size >= 6);
  const withTerms = POSTINGS.filter((p) => extractJobFacts(p.description, { jobTitle: p.title, company: p.company }).some((f) => f.term));
  assert.ok(withTerms.length >= 6, `only ${withTerms.length} postings read posting terms`);
});

for (const p of POSTINGS) {
  test(`no engine key on any screen — ${p.field}: ${p.title} (${p.persona})`, () => {
    const out = runTools(p);
    const found = Object.entries(out).flatMap(([name, o]) => leaks(name, o));
    assert.deepEqual(found, []);
  });
}

test('a posting term is identified by its own words, and term-ness rides on `term` only', () => {
  for (const p of POSTINGS) {
    const facts = extractJobFacts(p.description, { jobTitle: p.title, company: p.company });
    const keys = facts.filter((f) => f.factType === 'skill').map((f) => f.normalizedLabel);
    assert.equal(new Set(keys).size, keys.length, `duplicate requirement key in ${p.title}`);
    for (const f of facts.filter((x) => x.term)) {
      assert.equal(f.normalizedLabel, f.label.replace(/\s+/g, ' ').trim().toLowerCase());
      assert.ok(f.term.stems && f.extractor);
    }
  }
});

test('BAYADA × home-health RN: "CHF" is matched by "CHF patients" in every tool', () => {
  const p = POSTINGS.find((x) => /BAYADA/.test(x.company));
  const out = runTools(p);
  const fitRow = out.fit.matched_requirements.find((m) => m.term && /\bCHF\b/.test(m.surface));
  assert.ok(fitRow, 'fit check matches CHF');
  assert.match(fitRow.evidence, /CHF patients/);
  const row = out.prep.job_match.find((m) => /\bCHF\b/i.test(m.label));
  assert.ok(row, 'prep has a CHF row');
  assert.notEqual(row.status, 'gap');
  assert.match(`${row.proof || ''} ${row.say || ''}`, /CHF patients/);
  assert.ok(!out.prep.answers.some((a) => /haven't[^.]*\bCHF\b/i.test(`${a.q} ${a.answer}`)), 'no "I haven\'t worked with CHF" script');
});

test('hasEngineKey finds a key anywhere in a stored output', () => {
  assert.equal(hasEngineKey({ job_match: [{ label: 'term:futur leader' }] }), true);
  assert.equal(hasEngineKey({ answers: [{ q: 'Tell me about your experience with CHF.' }] }), false);
});

test('a prep pack stored with an engine key (built 2026-11-09) is rebuilt on read, keeping what the person typed', async () => {
  const p = POSTINGS.find((x) => /BAYADA/.test(x.company));
  const resumeText = resumeOf(p.persona);
  const fresh = localPack({ company: p.company, role: p.title, resumeText, jobText: p.description.slice(0, 6000), pay: null, stage: 'Interview' });
  const typedQ = fresh.answers.find((a) => /\[/.test(a.answer || ''))?.q;
  const stored = { ...fresh, job_text: p.description.slice(0, 6000), job_match: [{ label: 'term:CHF', status: 'gap', say: "I haven't worked with term:CHF yet." }], fills: typedQ ? { [typedQ]: ['my words'] } : {}, notes: {} };
  let saved = null;
  const healed = await healStoredPack(stored, { company: p.company, role: p.title, resumeText, save: async (full) => { saved = full; } });
  assert.equal(hasEngineKey(healed), false);
  assert.ok(saved && !hasEngineKey(saved), 'the healed pack is written back');
  // (job-match rows are the posting's statements since P2: the CHF line, not a bare 'CHF' label — coordinator-approved edit)
  assert.ok(healed.job_match.some((m) => m.label.includes('CHF') && m.status !== 'gap'));
  if (typedQ) assert.deepEqual(healed.fills[typedQ], ['my words']);
  // a clean pack is served as stored, never rewritten
  let wrote = false;
  const same = await healStoredPack(fresh, { company: p.company, role: p.title, resumeText, save: async () => { wrote = true; } });
  assert.equal(same, fresh); assert.equal(wrote, false);
});
