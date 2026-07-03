// Tests: résumé readability is ONE canonical predicate, enforced at every boundary.
// Run: node --test lib/server/resumeReadability.test.mjs
//
// The regression sample reproduces the 2026-07-03 cross-device corruption exactly: a subset
// font with no ToUnicode extracts as glyph codes — every byte of the real résumé shifted by a
// constant (28). That text is full of spaces and letters (so it defeated looksLikeGarbledText
// and carried a plausible word count) but contains essentially no real words.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { isReadableResume } from './resumeReadability.js';
import { looksLikeGarbledText } from './pdfText.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

const REAL_RESUME = `Kyra Regas — Los Angeles, CA — kyraregas@gmail.com
Customer service professional with five years of experience in retail and hospitality.
Managed daily operations for a busy storefront, trained seven new team members, and
handled escalated customer concerns with a 95 percent satisfaction rating. Skilled in
point of sale systems, scheduling, inventory management, and conflict resolution.
Work history includes Towne Park (guest services), Target (team lead), and a family
restaurant where responsibilities covered opening, closing, cash handling, and vendor
orders. Strong communicator, reliable, and comfortable in fast paced environments.`.repeat(3);

// The corruption shape found in prod: subset fonts renumber glyphs to LOW ids, so extracted
// "text" is letters shifted down into the punctuation/control range — whitespace intact. The
// real row was 8,301 chars with 3,729 whitespace tokens but only FOUR runs of 3+ letters.
// (The header font shifted by 28 — "kyraregas@gmail.com" → "O]V EV IKEW$KQEMP GSQ" — while the
// body font landed even lower, e.g. `(...(...)...".(..)`.)
const glyphShift = (s) => [...s].map(c => (/\s/.test(c) ? c : String.fromCharCode(Math.max(0x21, c.charCodeAt(0) - 58)))).join('');
const GLYPH_JUNK = glyphShift(REAL_RESUME);

test('real résumé prose is readable', () => {
  assert.equal(isReadableResume(REAL_RESUME), true);
});

test('glyph-shifted junk (the prod corruption) is UNREADABLE — even though the old heuristic passes it', () => {
  assert.equal(isReadableResume(GLYPH_JUNK), false, 'canonical check must reject glyph codes');
  // Document WHY this module exists: the pre-existing heuristic does NOT catch this shape
  // (glyph soup keeps its spaces). If this assertion ever flips, looksLikeGarbledText got
  // smarter — great — but the canonical gate stays the enforcement point.
  assert.equal(looksLikeGarbledText(GLYPH_JUNK), false, 'old space-ratio heuristic is blind to spaced glyph junk');
});

test('short text passes (length gates live at the callers)', () => {
  assert.equal(isReadableResume('Jane Doe — nurse'), true);
  assert.equal(isReadableResume(''), true);
});

test('long text with a few real words but junk density is unreadable', () => {
  // 8k chars of separators with ~25 real words sprinkled in — beats the absolute floor,
  // fails the density requirement (a real résumé has ~10x more words per char).
  const sparse = ('### 12 // 34 || 56 '.repeat(400)) + ' experience manager customer service team retail skills inventory schedule training resolve communicate reliable operations storefront satisfaction rating point sale systems conflict resolution vendor orders cash';
  assert.equal(isReadableResume(sparse), false);
});

test('résumés heavy with numbers, dates, and abbreviations still pass', () => {
  const technical = `RN, BSN — ICU nurse. 2019–2026. ACLS, BLS, PALS certified. Epic EHR.
  Administered meds to 30+ patients per shift, charted vitals q2h, managed 4:1 ratios.
  Units: MICU, SICU, ER. Awards: Daisy 2023. References available upon request.`.repeat(2);
  assert.equal(isReadableResume(technical), true);
});

// ── Every boundary uses the ONE canonical predicate (source-verified, creditRules-style) ──
test('all four gates import the canonical check', () => {
  const upload = readFileSync(join(ROOT, 'lib', 'server', 'resumeUpload.js'), 'utf8');
  assert.match(upload, /isReadableResume/, 'upload gate must use the canonical check');

  const resumeApi = readFileSync(join(ROOT, 'api', 'resume.js'), 'utf8');
  assert.match(resumeApi, /from '\.\.\/lib\/server\/resumeReadability\.js'/, 'api/resume.js must import canonical check');
  assert.match(resumeApi, /RESUME_CORRUPTED/, 'optimize gate still returns RESUME_CORRUPTED');

  const userSync = readFileSync(join(ROOT, 'api', 'user-sync.js'), 'utf8');
  assert.match(userSync, /isReadableResume\(text\)/, 'save_resume must gate DB writes');
  assert.match(userSync, /RESUME_UNREADABLE/, 'save_resume rejects with a named error');

  const store = readFileSync(join(ROOT, 'lib', 'stores', 'ResumeStore.ts'), 'utf8');
  assert.match(store, /isReadableResume/, 'ResumeStore must use the canonical check');
  assert.match(store, /clear_resume/, 'load path self-heals poisoned DB rows');
});
