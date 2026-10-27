// The company interview guides are shown to people walking into real interviews, so every guide is checked
// for shape and for the hedged, fact-only wording the brief demands — no pay figures, no statistics, no
// guarantees, no assumptions about the person.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findGuide, guideFor, guidedCompanies, normalizeCompany, audienceFor } from './interviewGuides.js';
import retail from './guides/retail.js';
import services from './guides/services.js';
import tech from './guides/tech.js';

const ALL = [...retail.guides, ...services.guides, ...tech.guides];
const text = (g) => [...Object.values(g.format || {}), g.framework?.note || '', ...(g.questions || []).map((q) => `${q.q} ${q.why}`), ...(g.tips || []), ...(g.ask_them || []), g.watch || ''].join(' ');

test('every guide has the shape the card needs', () => {
  assert.ok(ALL.length >= 60, `${ALL.length} guides`);
  for (const g of ALL) {
    assert.ok(Array.isArray(g.names) && g.names.length >= 1, JSON.stringify(g.names));
    assert.match(g.confidence, /^(?:high|medium)$/, g.names[0]);
    assert.ok(g.format && g.format.default && g.format.default.length >= 60, `${g.names[0]}: format.default`);
    assert.ok(g.questions.length >= 4 && g.questions.length <= 8, `${g.names[0]}: ${g.questions.length} questions`);
    for (const q of g.questions) {
      assert.ok(q.q.length >= 12 && /[?.]$/.test(q.q), `${g.names[0]}: ${q.q}`);
      assert.ok(q.why && q.why.length >= 20, `${g.names[0]}: why for ${q.q}`);
      if (q.principle) assert.ok(g.framework && g.framework.name, `${g.names[0]}: a principle needs a framework`);
    }
    assert.ok(g.tips.length >= 3 && g.tips.length <= 8, `${g.names[0]}: ${g.tips.length} tips`);
  }
});

test('no guide states a pay figure, a percentage, a date, a guarantee or a fact about the person', () => {
  for (const g of ALL) {
    const t = text(g);
    assert.doesNotMatch(t, /\$\s?\d|\d+\s?%|\b(?:19|20)\d{2}\b/, `${g.names[0]}: a figure`);
    assert.doesNotMatch(t, /\b(?:guaranteed|never fails|will definitely|always (?:asks?|gets?|hires?|happens|includes?|the same))\b/i, `${g.names[0]}: a guarantee`);
    for (const q of g.questions) assert.doesNotMatch(q.q, /\b(?:your team of \d|your \d+ years|when you managed|as a manager you)\b/i, `${g.names[0]}: a premise about the person: ${q.q}`);
    // process claims are hedged somewhere in the guide
    assert.match(t, /\b(?:usually|often|typically|many applicants|some applicants|expect|commonly|tend to|generally|most)\b/i, `${g.names[0]}: no hedge`);
  }
});

test('names people type find their guide; sub-brands and site words do not break it', () => {
  assert.equal(normalizeCompany('The Home Depot, Inc.'), 'home depot');
  assert.equal(normalizeCompany('Amazon Fulfillment Center'), 'amazon');
  assert.equal(findGuide('walmart supercenter')?.names[0], 'Walmart');
  assert.equal(findGuide('Target')?.names[0], 'Target');
  assert.equal(findGuide('Ross Stores')?.names[0], 'Ross Stores');
  assert.equal(findGuide("Fry's Food Stores")?.names[0], 'Kroger');
  assert.equal(findGuide('Google LLC')?.names[0], 'Google');
  assert.equal(findGuide('Stripe')?.names[0], 'Stripe');
  assert.equal(findGuide('Some Unknown Local Shop'), null);
  // "Target Hospitality" is not Target
  assert.equal(findGuide('Target Hospitality'), null);
  // one name, two guides: the store associate gets the store guide, the engineer the corporate one
  const storeApple = guideFor('Apple', 'Retail Specialist');
  const techApple = guideFor('Apple', 'Software Engineer');
  assert.ok(storeApple && techApple && storeApple.format !== techApple.format, 'Apple resolves by track');
});

test('the track follows the role', () => {
  assert.equal(audienceFor('Warehouse Lead'), 'hourly');
  assert.equal(audienceFor('Backend Engineer, Core Technology'), 'tech');
  assert.equal(audienceFor('Marketing Coordinator'), 'corporate');
  const w = guideFor('Walmart', 'Assistant Store Manager');
  assert.ok(w && w.format.length > 80 && w.questions.length >= 4 && w.tips.length >= 3);
  assert.ok(w.questions.every((q) => /[?.]$/.test(q.q)));
  assert.ok(guidedCompanies().includes('Walmart'));
});
