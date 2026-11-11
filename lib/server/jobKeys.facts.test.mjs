// Round 6 invariant: every licence, job title and years figure in the keys is traceable to the résumé.
// A credential is stated on a credential line (or implied by a title that cannot be held without it); a role
// title is written on the résumé; a title's years never exceed what its own dated lines span.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildJobKeys, titleYearParts, matchListing } from './jobKeys.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, '..', 'fixtures');
const NOW = new Date('2026-11-10T12:00:00Z');
const files = [
  ...fs.readdirSync(path.join(FIX, 'matching')).filter((f) => f.endsWith('.txt')).map((f) => path.join(FIX, 'matching', f)),
  ...['accountant', 'admin', 'dev', 'electrician', 'maria', 'nurse', 'rn-home-health', 'tasha', 'warehouse'].map((n) => path.join(FIX, 'personas', `${n}.txt`)),
];
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// Every credential id → words that must be on a credential line (or a title) for it to be stated.
const CRED_WORDS = {
  guard_card: /guard|security|bsis|perc/, cdl_a: /class a|cdl a|cdl-a/, cdl: /cdl|commercial driver/, hazmat: /hazmat|hazardous|\bh\b endorsement|h endorsement/,
  tanker: /tanker|n endorsement/, rn: /registered nurse|\brn\b/, lpn: /lpn|lvn|practical|vocational/, cna: /cna|nursing assistant|nurse aide/,
  journeyman_electrician: /journeyman|electric|wireman/, master_electrician: /master electric/, journeyman_plumber: /journeyman|plumb/, master_plumber: /master plumb/,
  epa608: /epa|608/, forklift: /forklift|powered industrial/, pharmacy_tech: /pharmacy|cpht|ptcb/, cpa: /cpa|certified public/, rdh: /hygien|rdh/, pe: /\bpe\b|professional engineer/,
};

for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  const name = path.relative(FIX, f);
  test(`facts traceable: ${name}`, () => {
    const k = buildJobKeys({ resumeText: text, now: NOW });
    const body = norm(text);
    for (const r of k.roles || []) assert.ok(body.includes(norm(r.title)), `${name}: role title "${r.title}" is not on the résumé`);
    const lines = norm([...(k.credential_lines || []), ...(k.roles || []).map((r) => r.title)].join(' \n '));
    for (const c of k.credentials || []) {
      const re = CRED_WORDS[c];
      assert.ok(re, `${name}: credential "${c}" has no traceability rule in this test — add one`);
      assert.ok(re.test(lines), `${name}: credential "${c}" is not stated on a credential line or a title`);
    }
    // Years per title ≤ the span its own dated roles cover (+0.5 for year-only dates read as mid-year).
    (k.roles || []).forEach((r, i) => {
      const part = titleYearParts(k, [i], NOW)[0];
      if (!part || !r.start) return;
      const s = Number(r.start.slice(0, 4)) + (Number(r.start.slice(5, 7) || 1) - 1) / 12;
      const e = r.current ? NOW.getUTCFullYear() + NOW.getUTCMonth() / 12 : Number(String(r.end || r.start).slice(0, 4)) + (Number(String(r.end || '').slice(5, 7) || 12) - 1) / 12;
      assert.ok(part.years <= e - s + 0.5, `${name}: ${r.title} credited ${part.years} y, dates span ${(e - s).toFixed(1)}`);
    });
    // Occupation years never exceed the whole dated career.
    for (const o of k.occupations || []) assert.ok(o.years <= (k.years_total || 0) + 0.5, `${name}: ${o.occupation} ${o.years} y > ${k.years_total} y in all`);
  });
}

test('shared-title years are said per exact title, never summed into the senior title', () => {
  const t = `Ana Ruiz\nBaltimore, MD\nEXPERIENCE\nRegistered Nurse, Medical ICU — Johns Hopkins Hospital, Baltimore MD  2022 – Present\n- 1:2 critically ill patients\nRegistered Nurse, Cardiac Step-Down — MedStar Union Memorial, Baltimore  2020 – 2022\n- Telemetry patients\nLICENSES\nRegistered Nurse — Maryland multistate (compact) license, active`;
  const k = buildJobKeys({ resumeText: t, now: NOW });
  const m = matchListing({ title: 'Registered Nurse - ICU', company: 'X', description: `${'Care for critically ill patients on a busy unit. '.repeat(16)}\nRequirements\n• 2+ years of nursing experience` }, k, { now: NOW });
  assert.equal(m.ok, true, JSON.stringify(m));
  assert.doesNotMatch(m.reason, /about 6 years as a Registered Nurse, Medical ICU/);
  for (const piece of m.reason.matchAll(/about (\d+(?:\.5)?) years? as an? ([^.;]+?)(?: and |\.|$)/g)) {
    if (/Medical ICU/.test(piece[2])) assert.ok(Number(piece[1]) <= 5, piece[0]);
  }
});

// Round 11: a credential in the keys comes ONLY from a résumé line that states it as held — never a job title, an
// MOS, or a degree. Over every fixture and, when present on this machine, every person of the DEV and fresh sets.
import { credentialEvidence } from './jobKeys.js';
test('invariant: every keys credential has a résumé line that names it as held', async () => {
  const texts = files.map((f) => [path.relative(FIX, f), fs.readFileSync(f, 'utf8')]);
  for (const set of ['gold/matched-dev', 'holdout/matched-fresh']) {
    const p = `/tmp/claude-0/-home-user-Seen/b30eccfc-31e3-5e58-94c8-e02565dad614/scratchpad/director/${set}/people.mjs`;
    if (fs.existsSync(p)) { const { PEOPLE } = await import(p); for (const x of PEOPLE) texts.push([`${set}:${x.id}`, x.text]); }
  }
  // a job title is not a licence
  texts.push(['title-only', 'Rosa D\nSacramento, CA\nEXPERIENCE\nRegistered Dental Assistant — Midtown Family Dentistry, Sacramento CA   2013 – 2019\n- Chairside assisting']);
  for (const [name, text] of texts) {
    const k = buildJobKeys({ resumeText: text, now: NOW });
    for (const c of k.credentials || []) assert.ok(credentialEvidence(text, c), `${name}: credential "${c}" has no résumé line stating it as held`);
    if (name === 'title-only') assert.deepEqual(k.credentials, []);
  }
});
