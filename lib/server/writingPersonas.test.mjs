// Regression tests for Seen's paid résumé-WRITING tools, built from the real cases the 2026-10-25
// willingness-to-pay test users (Dev, Tasha, Maria) and the Pro-tools harness hit. Each test names
// the screen text it pins. Fixtures: lib/fixtures/personas (the users' own résumés as the upload
// extracts them, and the postings they used). No model, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPaidOptimize } from './optimizePackage.js';
import { runOptimizer } from '../optimizer/index.js';
import { extractResumeFacts } from '../optimizer/extractResumeFacts.js';
import { credentialHeld } from '../optimizer/credentials.js';
import { parseResume } from '../resume/parse/index.js';
import { tailorResume, applyPlan } from '../resume/tailor/tailor.js';
import { rewriteBullet } from '../resume/rewrite/rules.js';
import { supportedYears, statedYears } from '../resume/years.js';

const F = (n) => readFileSync(new URL(`../fixtures/personas/${n}`, import.meta.url), 'utf8');
const DEV = F('dev.txt'), TASHA = F('tasha.txt'), MARIA = F('maria.txt');
const STRIPE = { job: 'Backend Engineer, Core Technology', company: 'Stripe', jobDescription: F('dev-stripe-jd.txt') };
const TOPSTEP = { job: 'CRM & Lifecycle Marketing Coordinator', company: 'topsteptrader', jobDescription: F('tasha-topstep-jd.txt') };
const GROUPON = { job: 'Social Media Specialist', company: 'Groupon', jobDescription: F('tasha-groupon-jd.txt') };
const PLS = { job: 'Assistant Store Manager', company: 'PLS', jobDescription: F('maria-pls-jd.txt') };
const FRYS = { job: 'Assistant Store Leader', company: "Fry's Food Stores", jobDescription: F('maria-frys-jd.txt') };
const NOW = new Date('2026-10-25T12:00:00Z');
const doc = (t) => parseResume({ text: t, source: 'text' });
const yearsClaim = (s) => (String(s || '').match(/(\d+)\+ years of experience/) || [])[1];

// ── Optimize ─────────────────────────────────────────────────────────────────────────────
test('Tasha × Topstep: "3+ years in email marketing operations, CRM…" counts only related roles', () => {
  const p = buildPaidOptimize({ resume: TASHA, ...TOPSTEP, pro: true });
  const years = p.constraints.find((c) => c.kind === 'years');
  assert.equal(years.status, 'unmet', 'barista + campus jobs no longer make "3.2 years (asks 3+)"');
  assert.match(years.message, /related experience; your résumé shows 0\.7 years in related roles/);
  assert.equal(yearsClaim(p.summary && p.summary.text), undefined, `no year count in the summary: ${p.summary && p.summary.text}`);
  const claims = [p.summary && p.summary.text, p.application_message, ...p.optimized_bullets.map((b) => b.optimized)].join(' ');
  assert.ok(!/\d\+ years/.test(claims), `no year claim the résumé does not support: ${claims}`);
});

test('Tasha × Topstep: a strength is never a gap on the same screen; no move for an unrelated role', () => {
  const p = buildPaidOptimize({ resume: TASHA, ...TOPSTEP, pro: true });
  const missing = p.unsupported_requirements.map((m) => m.requirement.toLowerCase());
  assert.ok(missing.includes('scheduling'));
  assert.ok(!/Strengths in[^.]*scheduling/i.test(p.summary ? p.summary.text : ''), 'scheduling is not claimed as a strength');
  assert.ok(!p.reorder.some((r) => /Trained 4 new partners/.test(r.text)), 'no "move to the top" for the barista bullet');
  assert.deepEqual(p.keywords_added, [], 'no keyword is "added" — every bullet is a placeholder');
  assert.ok(!/transferable experience in/i.test(p.application_message));
});

test('Tasha × Groupon: the barista role is not reordered for a social-media posting either', () => {
  const p = buildPaidOptimize({ resume: TASHA, ...GROUPON, pro: true });
  assert.ok(!p.reorder.some((r) => r.role === 'Barista'));
});

test('Dev × Stripe: B.S. is a degree; the summary says 6 years (his number), never 8', () => {
  const facts = extractResumeFacts(DEV);
  assert.ok(facts.some((f) => f.factType === 'education' && f.rank === 3), '"B.S. Computer Science" is a Bachelor\'s');
  const p = buildPaidOptimize({ resume: DEV, ...STRIPE, pro: true });
  assert.ok(!/lists no degree/.test(JSON.stringify(p.constraints)));
  assert.equal(yearsClaim(p.summary.text), '6');
  assert.ok(!/8\+ years/.test(p.summary.text));
  assert.ok(!/customer service/i.test(p.summary.text), `no "customer service" for a backend engineer: ${p.summary.text}`);
});

test('Maria × PLS: "bilingual English/Spanish" is met; no wording note for a word her résumé uses', () => {
  const p = buildPaidOptimize({ resume: MARIA, ...PLS, pro: true });
  const lang = p.constraints.find((c) => /bilingual/i.test(c.label));
  assert.equal(lang.status, 'met');
  assert.ok(!p.wording_notes.some((n) => /“customer service”/.test(n)), 'her résumé says customer service three times');
  const comm = p.matched_requirements.find((m) => m.requirement === 'communication');
  assert.ok(!comm || !/Cox Communications/.test(comm.evidence), 'an employer name is not a skill');
});

test('Maria × Fry\'s: years from her résumé (9), questions it already answers are not asked, no invented claims', () => {
  const p = buildPaidOptimize({ resume: MARIA, ...FRYS, pro: true });
  // her own summary stays when it scores higher than a rewrite (round 5) — either way the years are hers
  if (p.summary.kept) assert.match(p.summary.text, /9 years at Target/, p.summary.text);
  else assert.equal(yearsClaim(p.summary.text), '9', p.summary.text);
  assert.ok(!/hospitality/i.test(p.summary.text), 'she never worked in hospitality');
  assert.ok(!p.questions.some((q) => /transactions/.test(q.question)), '"200+ transactions per shift" is on her résumé');
  assert.ok(!/merchandising/i.test(p.application_message), p.application_message);
  assert.ok(p.keywords_added.every((k) => p.optimized_bullets.some((b) => !/^\(/.test(b.optimized) && b.optimized.toLowerCase().includes(k))));
});

test('one fit score: the free check, the paid package and the Studio print the same number', () => {
  const free = runOptimizer({ resumeText: MARIA, jobTitle: FRYS.job, company: FRYS.company, jobDescription: FRYS.jobDescription });
  const paid = buildPaidOptimize({ resume: MARIA, ...FRYS, pro: true });
  const { plan } = tailorResume(doc(MARIA), { jobTitle: FRYS.job, company: FRYS.company, jobDescription: FRYS.jobDescription });
  assert.equal(paid.fit_score, free.fit_score);
  assert.equal(paid._seenfit_score, free.fit_score);
  assert.equal(plan.score.before, free.fit_score);
});

// ── Studio tailor ────────────────────────────────────────────────────────────────────────
test('Dev × Stripe tailor: the senior Go/payments role is core, leads, and keeps all 5 bullets', () => {
  const base = doc(DEV);
  const { plan, variant } = tailorResume(base, { jobTitle: STRIPE.job, company: STRIPE.company, jobDescription: STRIPE.jobDescription, now: NOW });
  const led = plan.decisions.find((d) => /Ledgerline/.test(d.company));
  assert.equal(led.tier, 'core', 'was "Supporting · 42%"');
  assert.equal(plan.decisions[0].itemId, led.itemId, 'leads the decisions');
  assert.equal(variant.experience[0].company, led.company);
  assert.equal(variant.experience[0].bullets.length, 5, 'the plan\'s "Keep in full" is what the page carries');
  assert.ok(variant.experience[0].bullets.some((b) => /Stripe, Adyen/.test(b.text)) && variant.experience[0].bullets.some((b) => /Mentored 3 engineers/.test(b.text)));
  assert.ok(!/8\+ years/.test(plan.summary.text) && /6\+ years/.test(plan.summary.text), plan.summary.text);
  assert.ok(!/customer service/i.test(plan.summary.text));
  assert.ok(!plan.gaps.some((g) => /teamwork/i.test(g.requirement)), 'a soft skill is not a REQUIRED gap');
  assert.ok(!plan.strengths.some((s) => /machine learning/i.test(s.requirement)), 'Python is not proof of machine learning');
});

test('Tasha × Groupon tailor: an unrelated current role never reads "Kept in full — relevant"', () => {
  const { plan } = tailorResume(doc(TASHA), { jobTitle: GROUPON.job, company: GROUPON.company, jobDescription: GROUPON.jobDescription, now: NOW });
  for (const d of plan.decisions) {
    if (d.tier === 'core' || d.tier === 'supporting') continue;
    assert.ok(!d.reasons.some((r) => /relevant supporting experience|most relevant/.test(r)), `${d.title}: ${d.reasons[0]}`);
  }
  assert.equal(yearsClaim(plan.summary && plan.summary.text), undefined);
});

test('suggested lines are never on the page until added (no unconfirmed line exports)', () => {
  const base = doc(DEV);
  const { plan, variant } = tailorResume(base, { jobTitle: STRIPE.job, company: STRIPE.company, jobDescription: STRIPE.jobDescription, now: NOW });
  const all = variant.experience.flatMap((e) => e.bullets.map((b) => b.text));
  for (const a of plan.added) assert.ok(!all.includes(a.text), a.text);
  assert.ok(!variant.meta.provenance.some((p) => p.kind === 'transferable_bullet'));
  const again = applyPlan(base, JSON.parse(JSON.stringify(plan)), {});
  assert.ok(!again.meta.provenance.some((p) => p.kind === 'transferable_bullet'));
});

// ── Harness defects in the writing tools ────────────────────────────────────────────────
test('"every" is not a filler: "balanced the drawer e shift" never again', () => {
  for (const tense of ['past', 'present']) {
    const r = rewriteBullet('Balanced my drawer to within $1 every shift.', { tense });
    assert.match(r.text, /every shift/);
  }
  assert.match(rewriteBullet('Was very helpful to every guest.', { tense: 'past' }).text, /to every guest/);
});

test('degree and licence holders are not told they lack them', () => {
  const edu = (t) => extractResumeFacts(`Name\nEDUCATION\n${t}`).filter((f) => f.factType === 'education').map((f) => f.rank);
  assert.deepEqual(edu('B.A., Communication, SDSU 2024'), [3]);
  assert.deepEqual(edu('B.B.A., Accounting — University of Houston'), [3]);
  assert.deepEqual(edu('Rebecca Thornton, BSN, RN'), [3]);
  assert.deepEqual(edu('Phoenix College — Coursework toward A.A.S. Business Management (2014–2016)'), []);
  assert.deepEqual(edu('Skills: MS Excel, MS Word'), []);
  assert.ok(credentialHeld('Rebecca Thornton, BSN, RN\nRegistered Nurse, Colorado (multistate compact)', 'RN license'));
  assert.ok(credentialHeld('CERTIFICATIONS\nEPA Section 608 Universal', 'EPA 608 certification'));
  assert.ok(!credentialHeld('Drove a forklift on second shift', 'Forklift certification'), 'driving one is not a certification');
  assert.ok(credentialHeld('Forklift / Reach Truck certification (2021)', 'Forklift certification'));
});

test('a finished, dated result keeps its past tense in a current role', () => {
  const base = doc(`Danielle Brooks\nPhoenix, AZ | danielle@example.com\nEXPERIENCE\nAssistant Store Manager — Desert Sun Apparel, Phoenix, AZ Apr 2021 – Present\n• Grew store sales 9% year over year in 2023 by rebuilding the floor plan.\n• Coach 18 associates on the sales floor.\nSKILLS\nRetail, scheduling`);
  const { plan } = tailorResume(base, { jobTitle: 'Store Manager', company: 'Harborline', jobDescription: 'Store Manager. Requirements: 3+ years of retail management, sales growth, scheduling, coaching associates.', now: NOW });
  assert.ok(!plan.rewrites.some((r) => /^Grow store sales/.test(r.to)), JSON.stringify(plan.rewrites));
});

test('years: one calendar month counts once; the résumé\'s own number is the ceiling', () => {
  assert.equal(statedYears('Backend engineer with 6 years building payment systems'), 6);
  assert.equal(statedYears('two years of customer-facing work'), 2);
  const d = doc(DEV);
  const all = supportedYears(d, { now: NOW });
  assert.equal(all.computed, 8);
  assert.equal(all.years, 6, 'never more than the résumé says');
  const t = doc(TASHA);
  const intern = t.experience.find((e) => /Intern/.test(e.title));
  assert.equal(supportedYears(t, { relevantIds: [intern.id], now: NOW }), null, 'an 8-month internship states no year count');
});

// ── round 6 (2026-10-27) ──
test('round 6, Ray: "Led 2nd shift team of 15" IS leadership — never a bullet to write', () => {
  const ray = `Ray Johnson\nSUMMARY\nWarehouse lead with 12 years in distribution centers.\nEXPERIENCE\nWarehouse Lead — Midwest Grocers Distribution, Groveport, OH 2017 – 2026\n• Led 2nd shift team of 15 in receiving, putaway and outbound loading for 400,000 sq ft DC.\n• Ran weekly cycle counts in WMS (Manhattan); held inventory accuracy at 99.6%.\n• Operated sit-down and reach forklifts; picked and staged 250+ pallets per shift.\nSKILLS\nForklift, WMS, inventory`;
  const facts = extractResumeFacts(ray);
  const lead = facts.find((f) => f.normalizedLabel === 'leadership');
  assert.ok(lead, 'a leadership fact from the line that led');
  assert.match(lead.evidenceText, /Led 2nd shift team of 15/);
  const out = runOptimizer({ resumeText: ray, jobTitle: 'Warehouse Team Leader', company: 'Bluegrass', jobDescription: 'Warehouse Team Leader\nRequirements\n- Strong leadership skills.\n- Forklift experience.\n- Experience with a WMS.' });
  const m = out.matched_requirements.find((x) => x.requirement === 'leadership');
  assert.ok(m && m.matched, JSON.stringify(out.unsupported_requirements.map((x) => x.requirement)));
  const paid = buildPaidOptimize({ resume: ray, job: 'Warehouse Team Leader', company: 'Bluegrass', jobDescription: 'Warehouse Team Leader\nRequirements\n- Strong leadership skills.\n- Forklift experience.\n- Experience with a WMS.\n- Pick and pack orders per shift.', pro: true });
  assert.ok(!paid.questions.some((q) => /orders per shift|pallets/i.test(q.question)), '250+ pallets per shift already states the rate: ' + paid.questions.map((q) => q.question).join(' | '));
});

test('round 6, Tasha: a minor or a certification line is never shown as proof of hands-on work', () => {
  const out = runOptimizer({ resumeText: TASHA, jobTitle: TOPSTEP.job, company: TOPSTEP.company, jobDescription: TOPSTEP.jobDescription });
  for (const m of out.matched_requirements.filter((x) => x.matched && /minor in|certification|academy/i.test(String(x.evidence || '')))) {
    assert.equal(m.inferred, true, `${m.requirement} shown as proof by "${m.evidence}"`);
  }
  const { plan } = tailorResume(doc(TASHA), { jobTitle: TOPSTEP.job, company: TOPSTEP.company, jobDescription: TOPSTEP.jobDescription });
  for (const g of plan.gaps) {
    assert.ok(!/^(?:collaborate cross|among other factors|operations)$/i.test(g.requirement), `fragment gap: ${g.requirement}`);
    assert.ok(g.requirement.split(/\s+/).length <= 10, `sentence as a gap: ${g.requirement}`);
  }
});

test('round 6, Maria: Optimize never asks for a number the résumé already states', () => {
  const p = buildPaidOptimize({ resume: MARIA, ...FRYS, pro: true });
  assert.ok(!p.questions.some((q) => /customers or calls|per shift/i.test(q.question)), p.questions.map((q) => q.question).join(' | '));
  assert.ok(!p.questions.some((q) => /satisfaction or QA score/i.test(q.question)), p.questions.map((q) => q.question).join(' | '));
});

test('round 6, Dev: the senior payments role leads the Studio plan; no backend role is credited with "sales"', () => {
  const { plan } = tailorResume(doc(DEV), { jobTitle: 'Backend Engineer, Core Technology', company: 'Stripe', jobDescription: F('dev-stripe-jd.txt') });
  assert.equal(plan.decisions[0].title, 'Senior Backend Engineer', plan.decisions.map((d) => `${d.title} ${d.relevance}`).join(' / '));
  for (const d of plan.decisions) assert.ok(!d.reasons.some((r) => /\b(?:sales|point of sale|cash handling)\b/i.test(r)), `${d.title}: ${d.reasons.join(' | ')}`);
});
