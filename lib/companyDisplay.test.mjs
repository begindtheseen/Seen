// Run: node --test lib/companyDisplay.test.mjs
// lib/companyDisplay.ts is TypeScript with "@/" imports; this harness transpiles it (no type
// changes) into the scratchpad-free os tmpdir and imports the result, so the display rules every
// surface shares are pinned by plain node tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = resolve(new URL('..', import.meta.url).pathname);
const src = readFileSync(join(root, 'lib/companyDisplay.ts'), 'utf8')
  .replace(/from '@\/(.*?)'/g, (_m, p) => `from '${pathToFileURL(join(root, p)).href}'`);
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const dir = mkdtempSync(join(tmpdir(), 'seen-display-'));
writeFileSync(join(dir, 'companyDisplay.mjs'), js);
const { gradeLetter, displayCompanyName, isResolvedOutcome, lastUpdatedLabel } = await import(pathToFileURL(join(dir, 'companyDisplay.mjs')).href);

test('gradeLetter: one scale (page = card = OG = leaderboard)', () => {
  assert.equal(gradeLetter(91), 'A');   // Walmart: the page said A, the card said A+
  assert.equal(gradeLetter(93), 'A');   // Target
  assert.equal(gradeLetter(80), 'A');
  assert.equal(gradeLetter(79), 'B');
  assert.equal(gradeLetter(65), 'B');
  assert.equal(gradeLetter(50), 'C');
  assert.equal(gradeLetter(35), 'D');
  assert.equal(gradeLetter(34), 'F');
});

test('displayCompanyName: Title Case with brand exceptions, stored data untouched', () => {
  assert.equal(displayCompanyName('walmart'), 'Walmart');
  assert.equal(displayCompanyName('united wholesale mortgage'), 'United Wholesale Mortgage');
  assert.equal(displayCompanyName('aaa'), 'AAA');
  assert.equal(displayCompanyName("mcdonald's"), "McDonald's");
  assert.equal(displayCompanyName('ebay'), 'eBay');
  assert.equal(displayCompanyName('iheartmedia'), 'iHeartMedia');
  assert.equal(displayCompanyName('pwc'), 'PwC');
  assert.equal(displayCompanyName('ups'), 'UPS');
  assert.equal(displayCompanyName('at&t'), 'AT&T');
  assert.equal(displayCompanyName('bank of america'), 'Bank of America');
  assert.equal(displayCompanyName("lowe's"), "Lowe's");
  assert.equal(displayCompanyName('coca-cola'), 'Coca-Cola');
  assert.equal(displayCompanyName('jpmorgan chase'), 'JPMorgan Chase');
  assert.equal(displayCompanyName('DoorDash'), 'DoorDash'); // author's mixed case kept
  assert.equal(displayCompanyName('  albertsons '), 'Albertsons');
  assert.equal(displayCompanyName(''), '');
  assert.equal(displayCompanyName(null), '');
});

test('isResolvedOutcome: the rows a grade is built from', () => {
  for (const o of ['ghosted', 'rejected', 'autoreject', 'interview', 'human', 'offer', 'hired']) assert.equal(isResolvedOutcome(o), true, o);
  for (const o of ['waiting', 'applied', 'pending', 'withdrawn', 'unknown', '', null, undefined]) assert.equal(isResolvedOutcome(o), false, String(o));
});

test('lastUpdatedLabel: California date, never UTC', () => {
  // 2026-10-20 05:48 UTC is still Oct 19 in Los Angeles.
  assert.equal(lastUpdatedLabel('2026-10-20T05:48:31.988Z'), 'Last updated Oct 19, 2026');
  assert.equal(lastUpdatedLabel('2026-10-20T18:00:00.000Z'), 'Last updated Oct 20, 2026');
  assert.equal(lastUpdatedLabel(null), '');
  assert.equal(lastUpdatedLabel('garbage'), '');
});
