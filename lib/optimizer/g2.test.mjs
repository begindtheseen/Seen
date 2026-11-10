// G2 (2026-11-10): false proof in gates, the band against the statements, level and kind of job, one story in the
// sentence, and the invariants over the fixture résumés × corpus postings. Every class is pinned on the real case that
// exposed it (the director's hidden pairs, R2's freshC audit, the coordinator's screens run).
// Run: node --test lib/optimizer/g2.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runOptimizer } from './index.js';
import { credentialPending, postingDegreeFields, degreeFieldFits } from './constraints.js';
import { scoreFit, requirementKind } from './scoreFit.js';
import { extractJobFacts } from './extractJobFacts.js';
import { extractResumeFacts } from './extractResumeFacts.js';
import { postingField } from './fieldMatch.js';
import { statementSupport, fitBand, BAND_WORDS, BAND_THRESHOLDS, fitBandKey } from './explainScore.js';
import { loadPostings, resumeText } from '../fixtures/calibration/load.mjs';

const NOW = '2026-11-10';
const P = loadPostings();
const run = (who, job) => runOptimizer({ resumeText: typeof who === 'string' && !who.includes('\n') ? resumeText(who) : who, jobTitle: job.title, company: job.company, jobDescription: job.description, now: NOW });
const post = (title, description) => ({ title, description });

// ── A1: a credential the résumé says is not yet held is never met ─────────────────────────────────────────────
test('A1: "CPA Candidate — FAR and AUD passed; REG in progress" never meets a CPA requirement, in the gate or the match', () => {
  const o = run('staff-accountant', post('Senior Accountant', 'Requirements:\n• CPA required\n• 3+ years of accounting experience\n• Advanced Excel skills\n• Experience with NetSuite'));
  const cpa = o.constraints.find((c) => c.kind === 'certification');
  assert.notEqual(cpa.status, 'met');
  assert.equal(cpa.grade, 'partly');
  assert.match(cpa.message, /you list "CPA Candidate"/);
  assert.ok(!o.matched_requirements.some((m) => /\bcpa\b/i.test(m.surface)), 'no CPA match');
  assert.doesNotMatch(o.verdict.sentence, /you show [^;]*\bCPA\b/);
  // the firm name "Henley & Moss CPAs" in a role header is never a mention
  assert.equal(credentialPending('Accounting Intern — Henley & Moss CPAs, Troy, MI   2022\nCPA Candidate', 'CPA', 'cpa'), 'CPA Candidate');
  // a posting that asks for the candidacy itself is met by it
  const c2 = run('staff-accountant', post('Staff Accountant', 'Requirements:\n• 1-3 years of progressive accounting experience\n• CPA candidacy desirable but not required\n• Excel\n• Journal entries'));
  assert.equal(c2.constraints.find((c) => c.kind === 'certification').status, 'met');
});

// ── A2: degree sentences name the person's own degree, the alternative met, and the subject ──────────────────
test('A2: the education sentence names the degree on the résumé, the alternative they accept, and checks the subject', () => {
  // an RN-to-BSN still in progress is not a Bachelor's: the nurse holds an Associate Degree in Nursing
  const nurse = run('nurse', post('Process Technician', 'Qualifications:\n• High school diploma\n• Experience with SPC\n• Cleanroom protocols\n• 12-hour shifts'));
  assert.match(nurse.constraints.find((c) => c.kind === 'degree').message, /Associate degree in Nursing/);
  assert.ok(!extractResumeFacts(resumeText('nurse')).some((f) => f.factType === 'education' && f.rank >= 3));
  const years = run('admin', post('Operations Coordinator', "Requirements:\n• Bachelor's degree or 8 years of equivalent experience\n• Excellent communication\n• Microsoft Office"));
  const d = years.constraints.find((c) => c.kind === 'degree');
  assert.equal(d.status, 'met');
  assert.match(d.message, /They accept 8 years of experience in place of the degree; your résumé shows/);
  assert.ok(!years.constraints.some((c) => c.kind === 'years' && c.needed === 8), 'the years are judged once, through the degree');
  const college = run('nurse', post('Patient Access Rep', "Requirements:\n• Bachelor's degree or 2 years of college coursework\n• Customer service experience\n• Epic"));
  assert.match(college.constraints.find((c) => c.kind === 'degree').message, /They accept 2 years of college in place of a Bachelor's degree; your Associate degree in Nursing covers that/);
  const field = run('accountant', post('Data Analyst', "Requirements:\n• Bachelor's degree in Information Systems, Computer Science or Life Sciences\n• 3+ years of experience with SQL\n• Tableau\n• Python"));
  const f = field.constraints.find((c) => c.kind === 'degree');
  assert.equal(f.grade, 'partly');
  assert.match(f.message, /They ask for a degree in Information Systems, Computer Science or Life Sciences; you list a B\.S\. in Accountancy/);
  assert.equal(degreeFieldFits('Accountancy', postingDegreeFields("Bachelor's degree in Accounting, Finance, or related field required")), 'same');
  assert.equal(degreeFieldFits('Marketing', postingDegreeFields("Bachelor's degree in physics, computer science, electrical engineering, or a related field")), 'other');
  // a résumé with coursework only is never said to hold "a high school diploma"
  const none = run('admin', post('People Ops', "Requirements:\n• Master's degree in Human Resources\n• HRIS experience\n• Excel\n• Payroll"));
  assert.match(none.constraints.find((c) => c.kind === 'degree').message, /college coursework but no degree/);
});

// ── A3: years with a named subject count only roles that name it ─────────────────────────────────────────────
test('A3: "1–3 years in loan processing" and "1+ year working with children" never count a nurse\'s whole career', () => {
  const loan = run('nurse', post('Loan Processor', 'Requirements:\n• 1–3 years in loan processing or mortgage operations\n• Strong attention to detail\n• Microsoft Excel and Encompass\n• Excellent written communication'));
  const y = loan.constraints.find((c) => c.kind === 'years');
  assert.notEqual(y.grade, 'met');
  assert.match(y.message, /1\+ year in loan processing or mortgage operations/);
  assert.deepEqual(y.counted, []);
  const kids = run('nurse', post('Behavioral Health Nurse', 'Requirements:\n• Active RN license\n• 1+ year working with children and adolescent patients\n• BLS certification\n• Experience with Epic charting'));
  const k = kids.constraints.find((c) => c.kind === 'years');
  assert.equal(k.grade, 'cannot_tell');
  assert.match(k.message, /1\+ year working with children and adolescent patients/);
  assert.deepEqual(k.counted, []);
  const semi = run('nurse', post('Process Technician', 'Qualifications:\n• 6+ years in semiconductor photolithography operations\n• SPC\n• Cleanroom protocols\n• High school diploma'));
  assert.notEqual(semi.constraints.find((c) => c.kind === 'years').grade, 'met');
});

test('coordinator item 1: a years figure is the sum of exactly the roles it lists, year-only dates said as "about N"', () => {
  const o = run('warehouse', P[305]);
  const y = o.constraints.find((c) => c.kind === 'years');
  assert.match(y.message, /^You show about 6 years working in a warehouse or similar environment \(Warehouse Associate \/ Inventory Control, 2021–now; Material Handler, 2019–2020\)/);
});

// ── B: band against the statements, level, kind of job ───────────────────────────────────────────────────────
test('B: the director\'s hidden-pair classes land in the expert\'s band or one under the cap', () => {
  const band = (who, idx) => run(who, P[idx]);
  // staff accountant, 3.5 years, against Senior Accountant (4–7+ years): one level under AND short of the years → Partial
  assert.ok(band('staff-accountant', 89).fit_score <= 59, String(band('staff-accountant', 89).fit_score));
  // a one-year bootcamp developer against a frontend posting full of depth language → Partial at best
  assert.ok(band('bootcamp-dev', 490).fit_score <= 59);
  // a bedside ICU nurse against a care-navigator role: a different kind of nursing job → adjacent, Good at best
  const icu = band('icu-nurse', 11);
  assert.equal(icu.field_match.level, 'adjacent');
  assert.ok(icu.field_match.kindGap && icu.field_match.kindGap.posting === 'care-coordination');
  assert.ok(icu.fit_score <= 74);
  // a retail lead against an insurance CSR posting whose statements are mostly not shown: never Strong
  assert.notEqual(band('maria', 278).fit_band, 'Strong fit');
  // a backend engineer against a frontend posting: a different kind of software job
  assert.equal(band('dev', 180).field_match.level, 'adjacent');
  // a marketing coordinator against a brand-marketing role ("2–4 years in brand management" is not people management)
  const mkt = band('marketing-coordinator', 54);
  assert.ok(mkt.fit_score >= 60, String(mkt.fit_score));
  assert.ok(!mkt.constraints.some((c) => /managed people/.test(c.message || '')));
});

test('B iv: someone who has done this exact job, for the years asked, is not dragged below Good', () => {
  for (const [who, idx] of [['warehouse', 305], ['dev', 495], ['account-executive', 415]]) assert.ok(run(who, P[idx]).fit_score >= 60, `${who} × ${idx}`);
});

// ── C: a fact read from a duties line is a duty ──────────────────────────────────────────────────────────────
test('C: "Forklift" read from an equipment-duty sentence is kind duty, not a standalone tool requirement', () => {
  const facts = extractJobFacts('Responsibilities:\n• Operate a forklift to move pallets to the dock\n• Load and unload trucks\nRequirements:\n• High school diploma\n• 1+ year of warehouse experience', { jobTitle: 'Warehouse Associate' });
  const fit = scoreFit(facts, extractResumeFacts(resumeText('cashier')), undefined, resumeText('cashier'));
  const fk = fit.matches.find((m) => /forklift/i.test(m.surface));
  if (fk && fk.section === 'responsibilities') assert.equal(requirementKind(fk), 'duty');
});

// ── D: one story in the sentence ─────────────────────────────────────────────────────────────────────────────
test('D: the sentence says how many of the things they ask for are shown and names missing statements, never junk', () => {
  assert.match(run('icu-nurse', P[11]).verdict.sentence, /you show \d+ of the \d+ things they list/);
  const cpa = run('staff-accountant', post('Senior Accountant', 'Requirements:\n• CPA required\n• 3+ years of accounting experience\n• Advanced Excel skills\n• Experience with NetSuite\n• Experience with month-end close'));
  assert.match(cpa.verdict.sentence, /"CPA Candidate"/);
  for (const [who, idx] of [['bootcamp-dev', 490], ['icu-nurse', 11], ['maria', 278], ['dev', 180], ['support-lead', 405]]) {
    const s = run(who, P[idx]).verdict.sentence;
    assert.doesNotMatch(s, /what's missing is (?:one|essential|record|improvements|high-quality)\b/i, s);
    assert.doesNotMatch(s, /\b(?:is|are) scheduled\b|which your résumé doesn't show; .* which your résumé doesn't show/, s);
  }
});

// ── coordinator item 2: posting fields, and unknown is known:false ───────────────────────────────────────────
test('coordinator item 2: 280+ hand-labelled titles place ≥ 95% right; an unplaceable lab posting is never "driving and delivery"', () => {
  const L = [...JSON.parse(readFileSync(new URL('../fixtures/calibration/posting-fields.json', import.meta.url), 'utf8')), ...JSON.parse(readFileSync(new URL('../fixtures/calibration/posting-fields-2.json', import.meta.url), 'utf8'))];
  assert.ok(L.length >= 250);
  const ok = L.filter((x) => x.accept.includes(postingField(x.title, ''))).length;
  assert.ok(ok / L.length >= 0.95, `${ok}/${L.length}`);
  const bio = 'Sr Manager, Bioconjugation Development\nWe are a CDMO. Lead conjugation chemistry development, ADC process design, analytical characterization and tech transfer. Deliver results to clients on schedule.';
  assert.notEqual(postingField('Sr Manager, Bioconjugation Development', bio), 'logistics');
});

test('coordinator item 3: one band module — words, thresholds and key', () => {
  assert.deepEqual({ ...BAND_THRESHOLDS }, { strong: 75, good: 60, partial: 40 });
  assert.equal(fitBand(80), BAND_WORDS.strong);
  assert.equal(fitBandKey(59), 'partial');
  assert.equal(fitBand(10, { known: true, level: 'different' }), 'Different field');
});

// ── F: invariants over every fixture résumé × 40 corpus postings ─────────────────────────────────────────────
const PEOPLE = ['dev', 'maria', 'tasha', 'warehouse', 'nurse', 'accountant', 'admin', 'electrician', 'staff-accountant', 'icu-nurse', 'marketing-coordinator', 'bootcamp-dev', 'hvac-tech', 'cna', 'cashier', 'teacher'];
const IDS = Object.keys(P).slice(0, 40);
const ROWS = [];
for (const who of PEOPLE) for (const id of IDS) ROWS.push({ who, id, text: resumeText(who), o: run(who, P[id]) });

test('F: no gate is met on a not-yet-held credential', () => {
  for (const { who, id, text, o } of ROWS) for (const c of o.constraints.filter((x) => x.kind === 'certification' && x.status === 'met' && !x.pending)) {
    assert.equal(credentialPending(text, c.label, c.value), null, `${who} × ${P[id].title}: ${c.message}`);
  }
});

test('F: a degree sentence names a degree that appears on the résumé', () => {
  for (const { who, id, text, o } of ROWS) for (const c of o.constraints.filter((x) => x.kind === 'degree')) {
    const m = String(c.message).match(/^Your (.+?) meets\b/) || String(c.message).match(/you list (?:an? )?(.+?)(?: without| but|\.|;|$)/);
    if (!m) continue;
    const words = m[1].replace(/\b(?:degree|in|of|the|an?)\b/gi, ' ').split(/\s+/).filter((w) => w.length > 1).slice(0, 2);
    for (const w of words) assert.ok(text.toLowerCase().includes(w.toLowerCase().replace(/'s$/, '')), `${who} × ${P[id].title}: "${c.message}" (${w})`);
  }
});

test('F: a years sentence lists only roles whose title or bullets name the subject, and its figure is their sum', () => {
  for (const { who, id, o } of ROWS) for (const c of o.constraints.filter((x) => x.kind === 'years' && x.scope)) {
    if (c.grade === 'cannot_tell' || (c.grade === 'not_shown' && c.scope !== 'generic')) assert.deepEqual(c.counted, [], `${who} × ${P[id].title}: ${c.message}`);
    const m = String(c.message).match(/^You show (?:about )?(\d+(?:\.\d)?) years? /);
    if (m && c.scope !== 'generic' && c.counted && c.counted.length && c.counted.length <= 4) {
      const sum = c.counted.reduce((s, r) => s + (Number(r.years) || 0), 0);
      assert.ok(Math.abs(Number(m[1]) - Math.min(sum, c.computed + 0.05)) <= 1, `${who} × ${P[id].title}: ${c.message} (roles sum ${sum})`);
    }
  }
});

test('F: Strong ⇒ the statements agree (half the required statements shown or partly, first ones not missing)', () => {
  for (const { who, id, o } of ROWS) {
    if (o.fit_band !== 'Strong fit') continue;
    const st = statementSupport(o.statements, o.constraints);
    assert.ok(!st || st.strongOk, `${who} × ${P[id].title}: ${o.fit_score} with ${st && st.shown}/${st && st.n}`);
  }
});

test('F: a known different field scores under 20', () => {
  for (const { who, id, o } of ROWS) if (o.field_match.known && o.field_match.level === 'different' && o.fit_score != null) assert.ok(o.fit_score < 20, `${who} × ${P[id].title}: ${o.fit_score}`);
});
