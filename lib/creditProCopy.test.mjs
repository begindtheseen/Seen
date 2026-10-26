// Credit copy reads the real Pro / charged state (2026-10-25 test users: Pro accounts still saw
// "· 1 credit" on buttons and "1 credit used · 1 free credit resets at midnight PT" after actions the
// API answered charged:false). Pure helpers + a source scan of the price-tagged buttons.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { priceLabel, usageLine, PRO_COST_LABEL, creditCostLabel } from './server/creditRules.js';

test('a Pro account sees "Unlimited with Pro", never a credit price', () => {
  assert.equal(priceLabel(1, true), PRO_COST_LABEL);
  assert.equal(priceLabel(1, false), creditCostLabel(1));
  assert.equal(priceLabel(1, null), creditCostLabel(1), 'unknown status shows what a free account pays');
  assert.match(usageLine({ cost: 1, charged: false, pro: true }), /^Unlimited with Pro/);
  assert.ok(!/credit used ·/.test(usageLine({ cost: 1, charged: true, pro: true })), 'pro wins over a stale charged flag');
  assert.equal(usageLine({ cost: 1, charged: false }), 'No credit used');
  assert.match(usageLine({ cost: 1, charged: true, balance: 3 }), /^1 credit used · 3 left · /);
});

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(f)) out.push(p);
  }
  return out;
}

test('no price-tagged button hard-codes a credit price', () => {
  const root = new URL('..', import.meta.url).pathname;
  const files = [...walk(join(root, 'app')), ...walk(join(root, 'components'))];
  const bad = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    // a rendered "· {OPTIMIZE_PRICE}" / "· 1 credit" / "· {creditCostLabel(…)}" in JSX text is a price
    // that ignores Pro — every button goes through priceLabel(cost, pro)
    for (const re of [/·\s*\{OPTIMIZE_PRICE\}/g, />[^<{]*·\s*1 credit\s*</g, /·\s*\{creditCostLabel\((?:RESUME_OPTIMIZE_COST|insightPrice|JOB_INSIGHTS_COST)\)\}/g, /\{OPTIMIZE_PRICE\.replace\(/g]) {
      for (const m of src.matchAll(re)) bad.push(`${f.replace(root, '')}: ${m[0]}`);
    }
  }
  assert.deepEqual(bad, []);
});
