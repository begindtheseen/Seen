// The 2026-10-24 expert audits, pinned. A retail recruiter and an ATS engineer ran the same
// fictional applicant (Jordan Avery: Membership Specialist / Valet Attendant / Sales Associate,
// Associate of Arts) through six real postings. These tests hold the engine to what a correct
// matcher says about each one. Run: node --test lib/optimizer/expertPostings.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { runOptimizer } from './index.js';
import { extractJobFacts } from './extractJobFacts.js';
import { extractResumeFacts, titleFromHeader, degreeRank } from './extractResumeFacts.js';
import { normalizeSkill, relateSkills, mergeTaxonomy } from './normalizeSkills.js';
import { sectionPosting } from './postingSections.js';

const FX = JSON.parse(readFileSync(new URL('./fixtures/expert-postings.json', import.meta.url), 'utf8'));
const RESUME = FX.resume;
const run = (k) => {
  const p = FX.postings[k];
  return runOptimizer({ resumeText: RESUME, jobTitle: p.title, company: p.company, jobDescription: p.jd });
};
const reqs = (k) => extractJobFacts(FX.postings[k].jd, { jobTitle: FX.postings[k].title }).filter((f) => f.factType === 'skill').map((f) => f.normalizedLabel);

test('E1: near-perfect CSR (A) scores 85–90 and outranks the degree knockout (B) and the director role (C)', () => {
  const a = run('A'), b = run('B'), c = run('C');
  assert.ok(a.fit_score >= 85 && a.fit_score <= 90, `A ${a.fit_score}`);
  assert.ok(b.fit_score <= 35, `B ${b.fit_score}`);
  assert.ok(c.fit_score <= 35, `C ${c.fit_score}`);
  assert.ok(a.fit_score > b.fit_score && a.fit_score > c.fit_score);
});

test('E1: the unmet hard gate is the FIRST words of the verdict and the first risk flag', () => {
  const b = run('B');
  assert.equal(b.hard_gates[0].kind, 'degree');
  assert.match(b.verdict.sentence, /^\d+ — Requires a Bachelor's degree \(GPA 3\.0\+\); your résumé lists an Associate's degree/);
  assert.equal(b.risk_flags[0].code, 'hard_gate');
  const c = run('C');
  assert.ok(c.hard_gates.some((g) => g.kind === 'years') && c.hard_gates.some((g) => g.kind === 'seniority'), JSON.stringify(c.hard_gates));
  assert.match(c.verdict.gate, /management/);
  assert.match(c.verdict.gate, /no supervisory experience/);
});

test('E1: a 500-char teaser gets NO number — it says why instead', () => {
  for (const k of ['walmart', 'doordash']) {
    const o = run(k);
    assert.equal(o.fit_score, null, `${k} scored ${o.fit_score}`);
    assert.equal(o.verdict.withheld, 'too_few_requirements');
    assert.match(o.verdict.sentence, /^No score/);
  }
});

test('E2/R8: requirements come from requirement sections only — never benefits, culture, EEO or a verb', () => {
  // A: "ongoing training" (benefits) and the core-values footer ("Teamwork") are not requirements
  assert.ok(!reqs('A').includes('training'), reqs('A').join());
  assert.ok(!reqs('A').includes('teamwork'), reqs('A').join());
  // B: "how we grow and excel" is a verb; "leadership support" is a perk
  assert.ok(!reqs('B').includes('excel'), reqs('B').join());
  assert.ok(!reqs('B').includes('leadership'), reqs('B').join());
  // Alo: "excel individually", "Store Leadership Team" are not requirements
  assert.ok(!reqs('alo').includes('excel'), reqs('alo').join());
  assert.ok(!reqs('alo').includes('leadership'), reqs('alo').join());
  // a benefits paragraph is sectioned as benefits
  const rows = sectionPosting(FX.postings.A.jd);
  assert.equal(rows.find((r) => /ongoing training/.test(r.sentence)).kind, 'benefits');
});

test('E2: seniority comes from the title, not "referring complaints to the Store Manager"', () => {
  const facts = extractJobFacts(FX.postings.A.jd, { jobTitle: FX.postings.A.title });
  assert.equal(facts.find((f) => f.factType === 'seniority').label, 'entry');
  assert.equal(run('A').seniority_alignment, 1);
});

test('D3/R8: the hourly vocabulary reads the real duties; the job title is never a missing skill', () => {
  const a = reqs('A');
  for (const k of ['cash handling', 'point of sale', 'complaint resolution', 'upselling', 'compliance']) assert.ok(a.includes(k), `${k} not read from A: ${a.join()}`);
  const walmart = `Cosmetics Cashier\nWhat you'll do\n• Operate the cash register and process customer transactions\n• Follow company policy for cash handling and returns\nRequirements\n• Cashier or retail experience preferred`;
  const w = extractJobFacts(walmart, { jobTitle: 'Cosmetics Cashier' }).filter((f) => f.factType === 'skill').map((f) => f.normalizedLabel);
  assert.ok(!w.includes('cashier'), w.join());
  assert.ok(w.includes('point of sale') && w.includes('cash handling'), w.join());
});

test('E3/D5: stems match on both sides — "Trained" meets "training"', () => {
  const c = run('C');
  const training = c.matched_requirements.find((m) => m.requirement === 'training');
  assert.ok(training && training.via !== 'related', JSON.stringify(training));
});

test('E3/D5: a job title is not a degree — "Sales Associate" is no Associate of Arts', () => {
  const titleOnly = extractResumeFacts('Pat Lee\nEXPERIENCE\nSales Associate — GNC 2020 – 2022\n• Sold 40 memberships a month');
  assert.equal(titleOnly.filter((f) => f.factType === 'education').length, 0);
  const aa = extractResumeFacts(RESUME).filter((f) => f.factType === 'education');
  assert.equal(Math.max(...aa.map((f) => f.rank)), 2);
  assert.equal(degreeRank("Bachelor's degree"), 3);
});

test('E4: aliases are true synonyms only; cash handling ~ POS is a related edge', () => {
  assert.notEqual(normalizeSkill('cashier'), 'point of sale');
  assert.notEqual(normalizeSkill('cash handling'), 'point of sale');
  assert.equal(normalizeSkill('register'), 'point of sale');
  assert.equal(relateSkills('point of sale', 'cash handling').kind, 'related');
  // the DB-seeded aliases (migration 028) cannot bring the conflation back
  const merged = mergeTaxonomy({ aliases: { cashier: 'point of sale', 'cash handling': 'point of sale' }, relationships: {} });
  assert.notEqual(normalizeSkill('cash handling', merged), 'point of sale');
});

test('E5: a title keeps the whole title segment', () => {
  assert.equal(titleFromHeader('Membership Specialist — UFC Gym, Phoenix, AZ Mar 2024 – Present'), 'Membership Specialist');
  assert.equal(titleFromHeader('Valet Attendant — Ace Parking, Scottsdale, AZ Jun 2022 – Feb 2024'), 'Valet Attendant');
  const titles = extractResumeFacts(RESUME).filter((f) => f.factType === 'title').map((f) => f.label);
  assert.deepEqual(titles, ['Membership Specialist', 'Valet Attendant', 'Sales Associate']);
});

test('E7: evidence is sentence-bounded — never a mid-word line fragment like "time customer service…"', () => {
  for (const k of ['A', 'B', 'C', 'alo']) {
    for (const m of run(k).matched_requirements) {
      if (!m.evidence) continue;
      assert.ok(!/^time\b/.test(m.evidence), `${k}: ${m.evidence}`);
      assert.ok(/^[A-Z•(]/.test(m.evidence.trim()), `${k}: evidence starts mid-sentence: ${m.evidence}`);
    }
  }
});

test('E8: "20 months" is a month count, never "20 m"', () => {
  const metrics = extractResumeFacts(RESUME).filter((f) => f.factType === 'metric').map((f) => f.label);
  assert.ok(metrics.includes('20 months'), metrics.join(' | '));
  assert.ok(!metrics.some((m) => /^\d+ m$/.test(m)), metrics.join(' | '));
});

test('R1: a part-time posting against a "full-time" résumé objective is named as a conflict', () => {
  const alo = run('alo');
  assert.ok(alo.risk_flags.some((f) => f.code === 'schedule_conflict'), JSON.stringify(alo.risk_flags));
  assert.match(alo.verdict.sentence, /part-time and your résumé asks for full-time/);
  const blackout = alo.constraints.find((c) => c.kind === 'schedule' && /blackout/.test(c.label));
  assert.ok(blackout && /Thanksgiving/.test(blackout.label) && /January 22/.test(blackout.label), JSON.stringify(blackout));
  assert.ok(alo.constraints.some((c) => c.kind === 'physical' && /lift 50 lbs/.test(c.label)));
});

test('D4: one verdict — a score, a band, and one sentence that names strengths and gaps', () => {
  const a = run('A');
  assert.equal(a.verdict.score, a.fit_score);
  assert.equal(a.verdict.band, 'Strong fit');
  // 88 since 2026-10-25 (was 85): "industries such as hospitality, financial services, retail or
  // restaurant is preferred" names EXAMPLES — one preferred requirement met by any of them, not two
  // separate misses (lib/optimizer/alternatives.test.mjs).
  assert.match(a.verdict.sentence, /^88 — you show /);
  assert.match(a.verdict.sentence, /compliance/);
  assert.equal(a.explanation.summary, a.verdict.sentence);
});

// ── beyond the audit postings: the same rules on other fields ──
test('other fields: a tech stack reads "Go", a licence gate caps a nurse posting, a barista posting asks for the food handler card', () => {
  const swe = runOptimizer({ resumeText: `Alex Kim\nEXPERIENCE\nSoftware Engineer — Acme, Seattle, WA Jan 2017 – Present\n• Built Go services on Kubernetes serving 2M requests/day\n• Designed PostgreSQL schemas for billing\nEDUCATION\nBachelor of Science, Computer Science — UW, 2016\nSKILLS\nGo, PostgreSQL, Kubernetes, AWS`, jobTitle: 'Senior Software Engineer', jobDescription: `Requirements\n• 5+ years of software engineering experience\n• Strong experience with Go, PostgreSQL and Kubernetes\n• Experience with AWS\nBenefits\n• Health insurance, 401(k) and ongoing training` });
  assert.ok(swe.matched_requirements.some((m) => m.requirement === 'go'), JSON.stringify(swe.matched_requirements.map((m) => m.requirement)));
  assert.ok(!swe.matched_requirements.concat(swe.unsupported_requirements).some((m) => m.requirement === 'training'));
  assert.ok(swe.fit_score >= 80, String(swe.fit_score));
  const rn = runOptimizer({ resumeText: `Jo Park\nEXPERIENCE\nPatient Care Technician — City Hospital, Denver, CO Mar 2021 – Present\n• Supported nurses caring for 6 patients per shift\nSKILLS\nPatient care, BLS`, jobTitle: 'Registered Nurse', jobDescription: `Qualifications\n• Active RN license required\n• BLS certification required\n• 2+ years of acute care experience preferred\n• Must be able to work 12-hour shifts, including nights and weekends` });
  assert.ok(rn.fit_score <= 35);
  assert.match(rn.verdict.gate, /^Requires an RN license/);
  const barista = runOptimizer({ resumeText: `Sam Lee\nEXPERIENCE\nBarista — Bean Co, Austin, TX Jan 2022 – Present\n• Made 200+ espresso drinks per shift\n• Handled cash and balanced the drawer at close\nSKILLS\nCustomer service, cash handling`, jobTitle: 'Barista', jobDescription: `You'll make espresso drinks, handle cash and card payments, and greet every customer. Must be available weekends and early mornings. Food handler card required within 30 days.` });
  assert.ok(barista.constraints.some((c) => c.kind === 'certification' && c.status === 'ask' && /food handler/i.test(c.label)), JSON.stringify(barista.constraints));
  assert.ok(!barista.matched_requirements.concat(barista.unsupported_requirements).some((m) => m.requirement === 'barista'), 'the job title is never a skill');
});
