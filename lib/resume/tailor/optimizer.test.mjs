// Optimizer tests — the acceptance case is the owner's own résumé shape (automotive technician +
// valet + detailing business + four dateless packed roles) against a GNC Sales Associate posting:
// the engine must understand that "Membership Specialist – UFC Gym" is the most relevant job on
// the page even though it has no bullets, demote the valet and automotive roles, write nothing it
// cannot stand behind, and leave every decision explained and overridable.
// Run: node --test lib/resume/tailor/optimizer.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseResume } from '../parse/index.js';
import { serializeToText } from '../model.js';
import { tailorResume, applyPlan, bulletFromAnswer } from './tailor.js';
import { buildPlan, estimateLines } from './optimizer.js';
import { scoreRoles } from './relevance.js';
import { impliedCompetencies, jobCompetencies, coverage } from './competencies.js';
import { extractJobKeywords } from './keywords.js';
import { buildJobProfile } from '../../resume-intelligence/jobProfile.js';
import { atsCheck } from '../render/atsCheck.js';

const OWNER = fs.readFileSync(new URL('../fixtures/text/brandon_shape.txt', import.meta.url), 'utf8');
const GNC = {
  jobTitle: 'Sales Associate', company: 'GNC',
  jobDescription: 'GNC Sales Associate. Provide outstanding customer service, sell nutrition and wellness products, achieve sales goals, learn product knowledge, operate the POS, handle cash, restock shelves and keep the store merchandised, open and close the store. Retail or customer service experience preferred.',
};
const ELECTRICIAN = fs.readFileSync(new URL('./tailor.test.mjs', import.meta.url), 'utf8').match(/const RESUME = `([\s\S]*?)`;/)[1];
const ELECTRICIAN_JD = fs.readFileSync(new URL('./tailor.test.mjs', import.meta.url), 'utf8').match(/const JD = `([\s\S]*?)`;/)[1];
const NOW = new Date('2026-10-19T00:00:00Z');
const owner = () => parseResume({ text: OWNER, source: 'text' });
const byTitle = (plan, t) => plan.decisions.find((d) => d.title.startsWith(t));

test('competencies: a title says what the job involved even with no bullets', () => {
  const job = jobCompetencies({ jobTitle: GNC.jobTitle, jobDescription: GNC.jobDescription });
  assert.equal(job.family, 'retail');
  const ms = impliedCompetencies('Membership Specialist', 'UFC Gym');
  assert.equal(ms.family, 'sales');
  assert.ok(ms.vector.sales >= 0.8 && ms.vector['customer service'] >= 0.7 && ms.vector['membership sales'] >= 0.8);
  const tm = impliedCompetencies('Team Member', 'Chipotle');
  assert.equal(tm.family, 'food_service', 'the employer names the work when the title is generic');
  const at = impliedCompetencies('Automotive Technician (Self-Directed)', '', 'Performed engine and transmission repairs.');
  assert.equal(at.family, 'skilled_trades');
  assert.ok(coverage(job.vector, ms.vector).score > coverage(job.vector, at.vector).score * 3);
});

test('relevance: ranks roles by job fit, not by which one happens to have bullets', () => {
  const base = owner();
  const { roles } = scoreRoles(base, { ...GNC, now: NOW, keywords: extractJobKeywords(GNC.jobDescription, GNC), requirements: [] });
  const order = roles.map((r) => r.title);
  assert.equal(order[0], 'Membership Specialist');
  assert.ok(order.indexOf('Team Member') < order.indexOf('Valet Attendant'));
  assert.equal(order[order.length - 1], 'Automotive Technician (Self-Directed)');
  const ms = roles[0];
  assert.ok(ms.reasons.some((r) => /implied by the title/.test(r)) && ms.reasons.some((r) => /No bullets/.test(r)));
  assert.ok(ms.shared.some((s) => s.competency === 'sales'));
});

test('GNC acceptance: the most relevant role leads, valet and automotive are demoted, nothing is invented', () => {
  const base = owner();
  const { plan, variant } = tailorResume(base, { ...GNC, now: NOW });
  assert.equal(plan.version, 'tailor_v2');
  const ms = byTitle(plan, 'Membership Specialist');
  assert.equal(ms.tier, 'core');
  assert.equal(ms.decision, 'keep');
  assert.equal(variant.experience[0].title, 'Membership Specialist', 'leads the page');
  assert.equal(plan.strategy.layout, 'relevance');
  assert.equal(variant.meta.sectionTitles.experience, 'Relevant Experience');
  const valet = byTitle(plan, 'Valet Attendant');
  assert.ok(valet.tier !== 'core' || valet.relevance < ms.relevance, 'valet is not the headline');
  assert.ok(valet.keptBullets.length < valet.bullets, 'valet lost its least relevant bullet');
  const auto = byTitle(plan, 'Automotive Technician');
  assert.equal(auto.decision, 'condense', 'the current but irrelevant role stays on the page as a line');
  assert.ok(!variant.experience.some((e) => e.title.startsWith('Automotive Technician')));
  const extra = variant.extra.find((x) => x.title === 'Additional Experience');
  assert.ok(extra && extra.style === 'lines' && extra.items.some((it) => /Automotive Technician/.test(it.text) && /2020/.test(it.text)));
  // summary targets the posting from facts
  assert.match(plan.summary.text, /Membership Specialist at UFC Gym/);
  assert.ok(!/GNC|nutrition and wellness/.test(plan.summary.text));
  // transferable bullets are flagged, carry no numbers, and name their basis
  assert.ok(plan.added.length >= 2);
  for (const a of plan.added) { assert.equal(a.confirm, true); assert.ok(!/\d/.test(a.text), `no number in ${a.text}`); assert.ok(a.basis); }
  assert.ok(variant.experience[0].bullets.some((b) => /membership/i.test(b.text)));
  // prompts: dates for the dateless lead role, a family metric for it
  assert.ok(plan.prompts.some((p) => p.kind === 'dates' && p.roleTitle === 'Membership Specialist'));
  assert.ok(plan.prompts.some((p) => p.unit === 'quota attainment'));
  // every decision explains itself and the objective did not get worse
  for (const d of plan.decisions) assert.ok(d.reasons.length >= 1 && d.overridable);
  assert.ok(plan.objective.after.total >= plan.objective.before.total - 1e-9);
  assert.ok(plan.objective.evaluations >= 3 && plan.objective.evaluations <= 60);
  assert.ok(estimateLines(variant) <= plan.strategy.linesBudget);
});

test('overrides and answers re-apply locally: keep a role anyway, drop the transferable fill, answer a prompt', () => {
  const base = owner();
  const { plan } = tailorResume(base, { ...GNC, now: NOW });
  const auto = byTitle(plan, 'Automotive Technician');
  const dates = plan.prompts.find((p) => p.kind === 'dates');
  const quota = plan.prompts.find((p) => p.unit === 'quota attainment');
  const v = applyPlan(base, plan, { decisions: { [auto.itemId]: 'trim' }, transferable: false, prompts: plan.prompts, answers: { [dates.id]: 'Jan 2021 – Aug 2022', [quota.id]: '115%' } });
  assert.ok(!v.meta.provenance.some((p) => p.kind === 'transferable_bullet'));
  const ms = v.experience.find((e) => e.title === 'Membership Specialist');
  assert.equal(ms.start, '2021-01'); assert.equal(ms.end, '2022-08');
  assert.equal(ms.bullets[0].text, 'Reached 115% quota attainment.');
  assert.ok(v.meta.provenance.some((p) => p.kind === 'answered_bullet') && v.meta.provenance.some((p) => p.kind === 'answered_dates'));
  // the override is honoured even though the layout would have condensed the role: the user decides
  const layoutOverride = applyPlan(base, plan, { decisions: { [auto.itemId]: 'trim' }, layout: 'chronological' });
  assert.ok(layoutOverride.experience.some((e) => e.title.startsWith('Automotive Technician') && e.bullets.length === 1));
  assert.equal(bulletFromAnswer({ unit: 'vehicles per shift' }, '120'), 'Handled 120 vehicles during a busy shift.');
  assert.equal(bulletFromAnswer({ unit: 'nope', action: 'Delivered' }, '40 orders a night'), 'Delivered 40 orders a night.');
});

test('same-field résumé: nothing is dropped, chronological layout, the core role keeps its bullets', () => {
  const base = parseResume({ text: ELECTRICIAN, source: 'text' });
  const { plan, variant } = tailorResume(base, { jobTitle: 'Commercial Electrician', company: 'Desert Sun Mechanical', jobDescription: ELECTRICIAN_JD, now: NOW });
  assert.equal(plan.strategy.layout, 'chronological');
  assert.ok(plan.decisions.every((d) => d.decision !== 'drop'));
  const j = byTitle(plan, 'Journeyman Electrician');
  assert.equal(j.tier, 'core'); assert.equal(j.decision, 'keep'); assert.equal(j.keptBullets.length, 4);
  assert.equal(variant.experience[0].title, 'Journeyman Electrician');
  assert.equal(plan.added.length, 0, 'a role with real bullets gets no composed ones');
  assert.ok(plan.summary && /Journeyman Electrician at Desert Power Solutions/.test(plan.summary.text));
});

test('deterministic and fast', () => {
  const base = owner();
  const t0 = Date.now();
  const a = tailorResume(base, { ...GNC, now: NOW });
  const b = tailorResume(base, { ...GNC, now: NOW });
  assert.ok(Date.now() - t0 < 3000);
  assert.deepEqual(a.plan.decisions.map((d) => [d.title, d.decision, d.keptBullets.length]), b.plan.decisions.map((d) => [d.title, d.decision, d.keptBullets.length]));
  assert.equal(a.plan.summary.text, b.plan.summary.text);
});

test('the tailored variant survives the ATS round trip (roles, dates, bullets read back)', async () => {
  const { variant } = tailorResume(owner(), { ...GNC, now: NOW });
  const r = await atsCheck(variant, { format: 'pdf', template: 'engineering' });
  assert.ok(r.score >= 90, JSON.stringify(r.checks.filter((c) => !c.ok)));
  const txt = serializeToText(variant);
  assert.match(txt, /\nRELEVANT EXPERIENCE\n/);
  assert.match(txt, /\nADDITIONAL EXPERIENCE\nAutomotive Technician/);
  const back = parseResume({ text: txt, source: 'text' });
  assert.equal(back.experience[0].title, 'Membership Specialist');
});

test('no experience at all → no decisions, no invented summary', () => {
  const base = parseResume({ text: 'PAT LEE\npat@example.com\n\nSKILLS\nExcel, Word, Customer service', source: 'text' });
  const { plan } = tailorResume(base, { jobTitle: 'Cashier', jobDescription: 'Cashier needed. POS, cash handling, customer service.' });
  assert.equal(plan.decisions.length, 0);
  assert.equal(plan.summary, null);
  assert.equal(plan.added.length, 0);
});

test('wire contract: the JSON plan re-applied in the browser reproduces the server variant exactly', () => {
  const elec = (text = ELECTRICIAN) => parseResume({ text, source: 'text' });
  const cases = [
    { name: 'owner vs GNC (fill + relevance layout)', base: owner(), job: GNC },
    { name: 'electrician (skills reorder + additions, chronological)', base: elec(), job: { jobTitle: 'Commercial Electrician', jobDescription: ELECTRICIAN_JD } },
    { name: 'old summary alone carries a keyword → its sentence is kept on both sides', base: elec(ELECTRICIAN.replace('Skilled in conduit bending, 480V three-phase systems, and troubleshooting motor controls.', 'Certified on Epic and Cerner charting.')), job: { jobTitle: 'Commercial Electrician', jobDescription: `${ELECTRICIAN_JD}\n- Charting experience; daily charting of work orders` } },
    { name: 'terminology applied when asked', base: elec(ELECTRICIAN.replace('Operated scissor lifts and forklifts to stage material.', 'Operated scissor lifts and a pallet jack to stage material.')), job: { jobTitle: 'Commercial Electrician', jobDescription: ELECTRICIAN_JD.replace('Forklift operation a plus', 'Forklift operation required'), applyTerminology: true } },
    { name: 'keep my own summary', base: elec(), job: { jobTitle: 'Commercial Electrician', jobDescription: ELECTRICIAN_JD, replaceSummary: false } },
  ];
  for (const { name, base, job } of cases) {
    const { plan, variant } = tailorResume(base, { ...job, now: NOW });
    const wire = JSON.parse(JSON.stringify(plan));
    assert.ok(wire.rankedById == null, `${name}: no Map on the wire`);
    assert.ok(wire.decisions.every((d) => Array.isArray(d.ranked) && Array.isArray(d.implied)), `${name}: decisions are self-sufficient`);
    const again = applyPlan(base, wire, {});
    assert.equal(serializeToText(again), serializeToText(variant), `${name}: same page`);
    const kinds = (v) => v.meta.provenance.map((p) => p.kind).sort().join(',');
    assert.equal(kinds(again), kinds(variant), `${name}: same provenance`);
    if (job.replaceSummary === false) { assert.equal(again.basics.summary, base.basics.summary); assert.equal(plan.summary, null); }
  }
  // the owner case specifically: the specific competency the title implies ("membership sales") is
  // what fills the thin role on the client too — not the generic "sales" line
  const base = owner();
  const { plan } = tailorResume(base, { ...GNC, now: NOW });
  const again = applyPlan(base, JSON.parse(JSON.stringify(plan)), {});
  const ms = again.experience.find((e) => /Membership Specialist/.test(e.title));
  assert.match(ms.bullets[0].text, /memberships/);
});
