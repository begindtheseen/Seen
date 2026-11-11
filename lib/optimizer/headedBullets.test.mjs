// R6 invariant (director): in a headed, bulleted posting every bullet under a duties / requirements / preferred heading is
// displayed, or hidden with a NAMED reason — and the reasons are printed so a hiding rule can be seen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractJobFacts } from './extractJobFacts.js';
import { sectionPosting } from './postingSections.js';
import { cleanPastedPosting } from './pastedText.js';
import { isPlainItem, sameSource } from './statements.js';

const POSTINGS = JSON.parse(readFileSync(new URL('./fixtures/headed-bulleted-postings.json', import.meta.url), 'utf8'));
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

test('every plain bullet under a duties / requirements heading is displayed or hidden with a named reason', (t) => {
  const reasons = {};
  let bullets = 0, shown = 0, hidden = 0;
  const lost = [];
  for (const p of POSTINGS) {
    const sts = extractJobFacts(p.description, { jobTitle: p.title, company: p.company }).statements;
    for (const r of sectionPosting(cleanPastedPosting(p.description), { jobTitle: p.title }).filter(isPlainItem)) {
      if (/:\s*$/.test(r.sentence) || !/[A-Za-z]{3}/.test(r.sentence)) continue;
      bullets++;
      const mine = sts.filter((s) => sameSource(s.source, r.sentence) || norm(r.sentence).includes(norm(s.text)) && norm(s.text).length > 8);
      if (!mine.length) { lost.push(`${p.slug}: ${r.sentence.slice(0, 80)}`); continue; }
      if (mine.some((s) => s.display !== false)) { shown++; continue; }
      hidden++;
      for (const s of mine) for (const why of String(s.hideReason || '').split(',').filter(Boolean)) reasons[why] = (reasons[why] || 0) + 1;
      assert.ok(mine.every((s) => s.hideReason), `${p.slug}: hidden with no reason: ${r.sentence}`);
    }
  }
  t.diagnostic(`plain bullets ${bullets}: displayed ${shown}, hidden ${hidden}, lost ${lost.length}`);
  t.diagnostic(`hide reasons: ${JSON.stringify(Object.entries(reasons).sort((a, b) => b[1] - a[1]))}`);
  assert.deepEqual(lost, []);
  assert.equal(bullets, shown + hidden + lost.length);
});

test('the worked shift-lead posting: its real duties and qualifications are all displayed, one of each split', () => {
  const p = POSTINGS.find((x) => x.slug === 'shift-lead-copper-kettle');
  const sts = extractJobFacts(p.description, { jobTitle: p.title, company: p.company }).statements.filter((s) => s.display !== false);
  for (const re of [/^Place the daily food and paper order/, /^Step in on any station/, /^Bilingual English\/Spanish/]) assert.ok(sts.some((s) => re.test(s.text)), String(re));
  assert.equal(sts.find((s) => /^Bilingual/.test(s.text)).importance, 'preferred');
  assert.equal(sts.filter((s) => /^Comfortable with a POS system$/.test(s.text)).length, 1);
  assert.equal(sts.filter((s) => /^Toast experience/.test(s.text)).length, 1);
});
