// The 2026-10-24 expert audits' Tailor findings (D6), pinned on the audit persona and postings.
// Run: node --test lib/resume/tailor/expertAudit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseResume } from '../parse/index.js';
import { tailorResume, applyPlan } from './tailor.js';
import { scoreResume } from '../health/score.js';
import { runOptimizer } from '../../optimizer/index.js';

const FX = JSON.parse(readFileSync(new URL('../../optimizer/fixtures/expert-postings.json', import.meta.url), 'utf8'));
const doc = () => parseResume({ text: FX.resume, source: 'text' });
const tailor = (k) => { const p = FX.postings[k]; return tailorResume(doc(), { jobTitle: p.title, company: p.company, jobDescription: p.jd }); };

test('D6: hourly postings stay chronological and the current role with numbers leads', () => {
  for (const k of ['A', 'alo']) {
    const { plan } = tailor(k);
    assert.equal(plan.strategy.layout, 'chronological', k);
    assert.equal(plan.decisions[0].title, 'Membership Specialist', `${k}: ${plan.decisions.map((d) => `${d.title} ${d.relevance}`).join(' / ')}`);
  }
});

test('D6/N3: the summary leads with the current job and quotes its strongest number', () => {
  const alo = tailor('alo').plan.summary.text;
  assert.match(alo, /including Membership Specialist at UFC Gym and Sales Associate at GNC/);
  assert.match(alo, /top 3 of 12/);
  assert.ok(!/nutrition/i.test(alo), alo);
  const a = tailor('A').plan.summary.text;
  assert.match(a, /^Customer service candidate/);
  assert.match(a, /1,200\+ members with a 94% satisfaction score/);
});

test('D4: the Tailor match score is the SeenFit verdict, not a third scale', () => {
  const { plan, variant } = tailor('A');
  const p = FX.postings.A;
  assert.equal(plan.score.before, runOptimizer({ resumeText: FX.resume, jobTitle: p.title, company: p.company, jobDescription: p.jd }).fit_score);
  assert.equal(typeof plan.score.verdict.sentence, 'string');
  assert.ok(plan.score.after != null && plan.score.requirementCount >= 3);
  void variant;
  // a teaser posting has no number — the sentence says why
  const w = FX.postings.walmart;
  const t = tailorResume(doc(), { jobTitle: w.title, company: w.company, jobDescription: w.jd });
  assert.equal(t.plan.score.after, null);
  assert.match(t.plan.score.verdict.sentence, /^No score/);
});

test('D6: a role condensed to an Additional Experience line still covers the timeline', () => {
  const base = doc();
  const p = FX.postings.alo;
  const { plan } = tailorResume(base, { jobTitle: p.title, company: p.company, jobDescription: p.jd });
  // force the relevance layout and condense the valet job — the case the audit hit
  const valet = base.experience.find((e) => e.title === 'Valet Attendant');
  const v = applyPlan(base, plan, { layout: 'relevance', decisions: { [valet.id]: 'condense' } });
  assert.ok(v.extra.some((x) => x.title === 'Additional Experience'), 'condensed role became a line');
  const gaps = scoreResume(v).findings.filter((f) => f.code === 'gap');
  assert.equal(gaps.length, 0, JSON.stringify(gaps.map((g) => g.message)));
});

test('D1: wording proposals ride on the plan, off by default — the variant keeps the person\'s words', () => {
  const { plan, variant } = tailor('A');
  assert.equal(plan.applyRewrites, false);
  const texts = variant.experience.flatMap((e) => e.bullets.map((b) => b.text));
  assert.ok(texts.some((t) => /^Handled billing questions/.test(t)), texts.join(' | '));
  assert.ok(texts.some((t) => /^Sold and renewed/.test(t)));
  assert.ok(!texts.some((t) => /^(?:Bill|Sell|Train)\b/.test(t)), texts.join(' | '));
  for (const r of plan.rewrites) assert.ok(!/^Sell and renewed|^Bill questions/.test(r.to), r.to);
});

test('N2: an hourly one-pager is not told it is too short', () => {
  const h = scoreResume(doc());
  const length = h.findings.filter((f) => f.dimension === 'length');
  assert.ok(!length.some((f) => f.code === 'too_short'), JSON.stringify(length.map((f) => f.message)));
  assert.ok(!length.some((f) => /deserve 3–6/.test(f.message)), JSON.stringify(length.map((f) => f.message)));
});
