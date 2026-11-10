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

test('v6 (judges 2026-11-10, studio D3): a summary with substance stays in the person\'s words — never a pasted bullet', () => {
  for (const k of ['A', 'alo']) {
    const { plan, variant } = tailor(k);
    const own = doc().basics.summary;
    // the persona's summary is specific (5+ years across sales, membership services and guest operations): kept
    assert.ok(['keep', 'trim'].includes(plan.summaryDecision.mode), `${k}: ${plan.summaryDecision.mode}`);
    assert.ok(own.startsWith(variant.basics.summary.split('. ')[0]), variant.basics.summary);
    assert.ok(!/Strengths in|Looking for|Seeking/i.test(variant.basics.summary), variant.basics.summary);
    for (const e of variant.experience) for (const bl of e.bullets) assert.ok(!variant.basics.summary.includes(bl.text.replace(/[.]$/, '')), `bullet pasted: ${bl.text}`);
  }
});

test('v6: the strongest measured line keeps its place — "ranked top 3 of 12" is never displaced by "Trained 4 new hires"', () => {
  const { variant } = tailor('A');
  const ms = variant.experience.find((e) => e.title === 'Membership Specialist');
  assert.match(ms.bullets[0].text, /^Sold and renewed 40\+ memberships per month; ranked top 3 of 12/);
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
