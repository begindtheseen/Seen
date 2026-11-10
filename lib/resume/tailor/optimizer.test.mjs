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
import { serializeToText, normalizeDoc } from '../model.js';
import { tailorResume, applyPlan, bulletFromAnswer } from './tailor.js';
import { estimateLines } from './optimizer.js';
import { scoreRoles } from './relevance.js';
import { impliedCompetencies, jobCompetencies, coverage } from './competencies.js';
import { extractJobKeywords } from './keywords.js';
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

test('GNC acceptance (v6): every role stays in the person\'s order, Membership Specialist is never dropped, nothing is invented, relevance layout on request', () => {
  const base = owner();
  const { plan, variant } = tailorResume(base, { ...GNC, now: NOW });
  assert.equal(plan.version, 'tailor_v2');
  const ms = byTitle(plan, 'Membership Specialist');
  assert.ok(['core', 'supporting'].includes(ms.tier), ms.tier);
  assert.equal(ms.decision, 'keep');
  // director's decision A: the person's role order is kept; nothing is cut inside the page budget
  assert.deepEqual(variant.experience.map((e) => e.id), base.experience.map((e) => e.id));
  for (const e of base.experience) assert.equal(variant.experience.find((x) => x.id === e.id).bullets.length, e.bullets.length, e.title);
  // the optional "Relevant Experience" layout still puts the relevant role first
  const rel = applyPlan(base, plan, { layout: 'relevance' });
  assert.equal(rel.experience[0].title, 'Membership Specialist');
  assert.equal(rel.meta.sectionTitles.experience, 'Relevant Experience');
  // transferable lines are SUGGESTIONS, flagged, numberless, never on the page until added
  assert.ok(plan.added.length >= 1);
  for (const a of plan.added) { assert.equal(a.confirm, true); assert.ok(!/\d/.test(a.text)); assert.equal(a.kind, 'transferable_suggestion'); }
  assert.ok(!variant.experience.some((e) => e.bullets.some((b) => plan.added.some((a) => a.text === b.text))));
  // prompts: dates for the dateless relevant role, its family measure; GNC-specific gap questions name GNC
  assert.ok(plan.prompts.some((p) => p.kind === 'dates' && p.roleTitle === 'Membership Specialist'));
  assert.ok(plan.prompts.some((p) => p.unit === 'quota attainment'));
  assert.ok(plan.prompts.filter((p) => p.kind === 'gap').every((p) => /^GNC (?:asks for|would like) /.test(p.question)));
  for (const d of plan.decisions) assert.ok(d.reasons.length >= 1 && d.overridable);
  assert.ok(estimateLines(variant) <= plan.strategy.linesBudget);
  assert.ok(plan.score.after >= plan.score.before);
  assert.ok(!/GNC|nutrition and wellness/.test(variant.basics.summary || ''));
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
  // a credential question answered yes becomes a certification entry; a count without a number is asked again
  assert.equal(bulletFromAnswer({ unit: 'customers per shift' }, 'yes'), '');
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
  // his own summary is specific (6 years, OSHA 30, conduit bending, 480V): it stays exactly as he wrote it
  assert.equal(plan.summaryDecision.mode, 'keep');
  assert.equal(variant.basics.summary, base.basics.summary);
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
  const base = owner();
  const { plan } = tailorResume(base, { ...GNC, now: NOW });
  const variant = applyPlan(base, plan, { layout: 'relevance' });
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
  const wirePlan = JSON.parse(JSON.stringify(plan));
  const sug = wirePlan.added.find((a) => /memberships/.test(a.text));
  assert.ok(sug, 'the specific competency is the suggestion');
  const again = applyPlan(base, wirePlan, { includeAdded: [sug.key] });
  const ms = again.experience.find((e) => /Membership Specialist/.test(e.title));
  assert.match(ms.bullets[0].text, /memberships/);
});

// ── 2026-10-24 audits: wording changes are PROPOSALS on the plan, never applied silently ──
test('tense/lead rewrites ride on the plan as proposals; the variant keeps the original wording until accepted', () => {
  const base = normalizeDoc(parseResume({ text: `Jordan Avery
Phoenix, AZ · jordan@example.com

EXPERIENCE
Membership Specialist — UFC Gym | Mar 2024 – Present
• Sold and renewed 40+ memberships per month; ranked top 3 of 12 on the sales floor for 6 straight months
• Handled billing questions, freezes and cancellations for 1,200+ members with a 94% satisfaction score
• Trained 4 new front-desk hires on the POS system and the daily opening and closing checklist
Valet Attendant — Ace Parking | Jun 2022 – Feb 2024
• Parked and retrieved 150+ vehicles per shift at a resort with zero damage claims in 20 months
• Greeted guests, managed keys and tickets, and resolved wait-time complaints on the spot
Sales Associate — GNC | Aug 2020 – May 2022
• Advised customers on supplements and hit monthly sales goals 18 of 22 months
• Managed inventory counts, restocking and the weekly promo resets

SKILLS
Customer service · POS systems (Square, Clover) · Cash handling · Upselling`, source: 'text' }));
  const job = { jobTitle: 'Seasonal Sales Associate (Part-Time)', company: 'Alo Yoga', jobDescription: 'Requirements: 1+ years in a client-centric sales environment. Lift up to 50 pounds. Responsibilities: build the client relationship daily, process shipment and replenishment, maintain merchandising standards, point of sale transactions and cash handling.', now: new Date('2026-10-24') };
  const { plan, variant } = tailorResume(base, job);
  const texts = variant.experience.flatMap((e) => e.bullets.map((b) => b.text));
  assert.ok(texts.includes('Sold and renewed 40+ memberships per month; ranked top 3 of 12 on the sales floor for 6 straight months'), 'original wording kept');
  assert.ok(!texts.some((t) => /^Sell and|^Bill |^Train 4/.test(t)), 'no silent tense rewrite in the variant');
  assert.equal(variant.meta.provenance.filter((p) => p.kind === 'rewrite').length, 0);
  // v6: a CURRENT role's lines are never re-tensed (its present tense is right; "Sell and renew…" read worse); an
  // ended role written in the present gets a needs-your-OK proposal, and accepting one applies exactly that one
  assert.ok(!plan.rewrites.some((r) => /^Sold and renewed/.test(r.from)));
  const ended = normalizeDoc(parseResume({ text: `Jordan Avery\njordan@example.com\n\nEXPERIENCE\nSales Associate — GNC | Aug 2020 – May 2022\n• Advise customers on supplements and hit monthly sales goals 18 of 22 months\n• Manage inventory counts, restocking and the weekly promo resets`, source: 'text' }));
  const t2plan = tailorResume(ended, job).plan;
  const prop = t2plan.rewrites.find((r) => r.default === 'needs_ok');
  assert.ok(prop && /^Advised customers on supplements and hit monthly/.test(prop.to), JSON.stringify(t2plan.rewrites));
  const wire = JSON.parse(JSON.stringify(t2plan));
  const untouched = applyPlan(ended, wire);
  assert.ok(untouched.experience[0].bullets.some((b) => b.text === prop.from), 'a needs-OK proposal is not in the document by default');
  const v2 = applyPlan(ended, wire, { rewrites: [prop.bulletId] });
  const t2 = v2.experience.flatMap((e) => e.bullets.map((b) => b.text));
  assert.ok(t2.includes(prop.to) && !t2.includes(prop.from));
  assert.equal(v2.meta.provenance.filter((p) => p.kind === 'rewrite').length, 1);
  // hourly posting, every role in the same cluster → chronological: the current job leads
  assert.equal(plan.strategy.layout, 'chronological');
  assert.equal(variant.experience[0].title, 'Membership Specialist');
  // nothing was extracted → the plan says so instead of claiming 100% coverage
  const empty = tailorResume(base, { jobTitle: 'Cashier', company: 'X', jobDescription: 'Hourly Wage: $16 - $29 per/hour. Premiums may apply…', now: new Date('2026-10-24') });
  if (empty.plan.job.requirementCount === 0) assert.equal(empty.plan.score.criticalCoverage, null);
});

test('v6 (Dev, judges 2026-11-10): a strong summary stays in his words — only "Looking for…" leaves; one years figure', () => {
  const resume = fs.readFileSync(new URL('../../fixtures/personas/dev.txt', import.meta.url), 'utf8');
  const jd = fs.readFileSync(new URL('../../fixtures/personas/dev-stripe-jd.txt', import.meta.url), 'utf8');
  const doc = parseResume({ text: resume, source: 'text' });
  for (const job of [{ jobTitle: 'Backend Engineer, Developer Experience', company: 'Stripe', jobDescription: jd }, { jobTitle: '', company: '', jobDescription: jd }]) {
    const { plan, variant } = tailorResume(doc, job);
    const summary = variant.basics.summary;
    assert.equal(plan.summaryDecision.mode, 'trim', summary);
    assert.ok(summary.startsWith('Backend engineer with 6 years building payment and ledger systems'), summary);
    assert.match(summary, /\$1\.2B\/year/);
    assert.ok(!/Looking for/.test(summary), summary);
    assert.ok(!/Strengths in/.test(summary));
    assert.equal((summary.match(/\b\d+\+?\s+years\b/g) || []).length, 1, summary);
  }
});

