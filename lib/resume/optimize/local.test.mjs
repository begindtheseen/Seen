// The zero-API optimizer (owner decision 2026-10-26): the person's answers become résumé language by
// rules, and every line still passes the same checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fromFirstPerson, figureFrom, withoutPronouns, localDiagnosis, localRewrite } from './local.js';
import { buildContext } from './engine.js';

const load = (id) => { const f = JSON.parse(readFileSync(new URL(`../../../scripts/eval/fixtures/${id}.json`, import.meta.url), 'utf8')); return buildContext({ resumeText: f.resume.join('\n'), jobTitle: f.job.title, company: f.job.company, jobDescription: f.job.description.join('\n') }); };

test('answers in first person become résumé lines; a no or a fragment does not', () => {
  assert.equal(fromFirstPerson("Yes, regularly. I run the store on the Store Manager's 2 days off every week", { current: true }), "Run the store on the Store Manager's 2 days off every week");
  assert.equal(fromFirstPerson('I trained my two new cashiers on the register', { current: false }), 'Trained the two new cashiers on the register');
  assert.equal(fromFirstPerson('No, never owned it'), '');
  assert.equal(fromFirstPerson('Not sure'), '');
  assert.equal(figureFrom('About 900–950 hours a week, more in Nov–Dec'), 'about 900–950 hours a week, more in Nov–Dec');
  assert.equal(figureFrom('I think I did it often'), '');
  assert.equal(withoutPronouns('Prep and break down my station and pass every inspection since I started'), 'Prep and break down the station and pass every inspection since starting');
});

test('diagnosis with no model: the posting\'s own nice-to-haves are asked; no verb-led or threshold templates', () => {
  const cook = localDiagnosis(load('13-line-cook'));
  const asks = cook.questions.map((q) => q.ask);
  assert.ok(asks.some((q) => /seafood/i.test(q)), JSON.stringify(asks));
  assert.ok(asks.some((q) => /ServSafe Manager/.test(q)));
  const cs = localDiagnosis(load('04-customer-service'));
  assert.ok(!cs.questions.some((q) => /Type at least|45 WPM/.test(q.ask)), JSON.stringify(cs.questions.map((q) => q.ask)));
});

test('rewrite with no model: pronoun fixes and answer-built lines ship, all checked', () => {
  const ctx = load('13-line-cook');
  const d = localDiagnosis(ctx);
  const sea = d.questions.find((q) => /seafood/i.test(q.ask));
  const r = localRewrite(ctx, d, [{ ...sea, answer: 'Yes. I cook shrimp, redfish and crab cakes on about 40% of my tickets' }]);
  const after = r.proposals.map((p) => p.after);
  assert.ok(after.includes('Keep ticket times under 14 minutes on the stations during the dinner rush'), JSON.stringify(after));
  assert.ok(after.some((t) => /^Cook shrimp, redfish and crab cakes on about 40% of the tickets$/.test(t)), JSON.stringify(after));
});
