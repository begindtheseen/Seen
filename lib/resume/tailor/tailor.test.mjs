// Tailor engine tests — relevance ranking, reorder provenance, own-surface skill additions,
// keyword grouping, gap downgrade, fact-only summary, and the LLM polish contract when no provider
// is configured. Run: node --test lib/resume/tailor/tailor.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseResume } from '../parse/index.js';
import { serializeToText } from '../model.js';
import { tailorResume, scoreBulletRelevance, composeSummary, sentenceCase, pickProofClause } from './tailor.js';
import { extractJobKeywords, keywordIn, keywordCoverage } from './keywords.js';
import { polishBullets } from './polish.js';
import { analyzeApplication } from '../../resume-intelligence/engine.js';

const RESUME = `JORDAN REYES
Phoenix, AZ | 602-555-0142 | jordan.reyes@example.com

SUMMARY
Journeyman electrician with 6 years of commercial and industrial experience. OSHA 30 certified. Skilled in conduit bending, 480V three-phase systems, and troubleshooting motor controls.

EXPERIENCE
Journeyman Electrician — Desert Power Solutions, Phoenix, AZ
Mar 2020 – Present
- Read blueprints and schematics to lay out panel schedules and branch circuits.
- Install and troubleshoot 480V three-phase distribution systems across 14 commercial sites.
- Bend and install EMT and rigid conduit per NEC code; passed 100% of city inspections in 2024.
- Lead a crew of 4 apprentices on lockout/tagout procedures and daily safety briefings.

Apprentice Electrician — Sunbelt Electric, Tempe, AZ
Jun 2018 – Feb 2020
- Assisted with residential rough-in and trim-out for 60+ new builds.
- Pulled wire, terminated devices, and installed lighting fixtures.
- Operated scissor lifts and forklifts to stage material.

SKILLS
Conduit bending, Blueprint reading, Motor controls, PLC basics, Hand and power tools

CERTIFICATIONS
OSHA 30 (2022)
Arizona Journeyman Electrician License

EDUCATION
Electrical Apprenticeship Program — IEC Arizona, 2018
`;
const JD = `Commercial Electrician

Desert Sun Mechanical is hiring a Commercial Electrician for projects across the Phoenix metro.

Requirements:
- 5+ years of commercial electrical experience
- Journeyman license required
- OSHA certification required (OSHA 10 or OSHA 30)
- Experience with 480V three-phase systems, motor controls, and PLCs
- Proficient in conduit bending, blueprint reading, and NEC code
- Lockout/tagout experience
- Forklift operation a plus
- Valid driver's license

Responsibilities:
- Install, maintain and troubleshoot commercial electrical systems
- Lead apprentices and enforce safety procedures
- Read blueprints and schematics
`;
const JOB = { jobTitle: 'Commercial Electrician', company: 'Desert Sun Mechanical', jobDescription: JD };
const doc = () => parseResume({ text: RESUME, source: 'text' });

test('keywords: one entry per concept, aliases are surfaces, plural/stem surfaces match', () => {
  const kws = extractJobKeywords(JD, { jobTitle: JOB.jobTitle, company: JOB.company });
  const displays = kws.map((k) => k.display);
  assert.equal(displays.filter((d) => d === 'Forklift Operation').length, 1, 'forklift concept appears once');
  assert.equal(displays.filter((d) => d === 'OSHA / Workplace Safety').length, 1);
  const fork = kws.find((k) => k.display === 'Forklift Operation');
  assert.ok(fork.surfaces.includes('forklift') && fork.surfaces.includes('pallet jack'));
  assert.equal(keywordIn('Operated scissor lifts and forklifts', fork), 'forklifts');
  const plcs = kws.find((k) => k.display === 'plcs');
  assert.equal(keywordIn('PLC basics', plcs), 'plc');
  // a generic word inside a specific keyword never becomes its own keyword
  assert.ok(!displays.includes('controls') && !displays.includes('certification'));
  // a longer listed phrase absorbs the engine's cut-off fragment
  const v = kws.find((k) => k.surfaces.includes('480v three'));
  assert.equal(v.display, '480v three-phase systems');
  // the company and the boilerplate never appear
  assert.ok(!displays.some((d) => /desert sun|mechanical|hiring/i.test(d) || /\bvalid$/i.test(d)));
});

test('relevance: a bullet that evidences more (and weightier) requirements scores higher; a metric adds', () => {
  const kws = extractJobKeywords(JD, { jobTitle: JOB.jobTitle, company: JOB.company });
  const a = scoreBulletRelevance('Install and troubleshoot 480V three-phase distribution systems across 14 commercial sites.', kws);
  const b = scoreBulletRelevance('Pulled wire, terminated devices, and installed lighting fixtures.', kws);
  assert.ok(a.score > b.score && a.hits.length >= 2);
  assert.equal(b.score, 0);
  const noMetric = scoreBulletRelevance('Install and troubleshoot 480V three-phase distribution systems.', kws);
  assert.ok(a.score > noMetric.score, 'metric bonus');
});

test('tailor: reorders bullets inside a role so the relevant lead, with provenance, never deleting', () => {
  const base = doc();
  const { plan, variant } = tailorResume(base, JOB);
  const role = variant.experience[0];
  assert.equal(role.bullets.length, 4);
  assert.match(role.bullets[0].text, /480V three-phase|NEC code/);
  assert.ok(!/^Read blueprints/.test(role.bullets[0].text), 'the keyword-poor opener no longer leads');
  const re = plan.provenance.find((p) => p.kind === 'reorder_bullets' && p.itemId === role.id);
  assert.ok(re && re.from.length === 4 && new Set(re.to).size === 4);
  assert.deepEqual([...re.to].sort(), [...re.from].sort(), 'same bullet ids, reordered');
  // base untouched
  assert.equal(base.experience[0].bullets[0].text.slice(0, 15), 'Read blueprints');
  assert.equal(variant.kind, 'variant');
  assert.equal(variant.meta.baseDocId, base.id);
  assert.equal(variant.meta.tailoredFor.role, 'Commercial Electrician');
  assert.equal(plan.roles[0].title, 'Journeyman Electrician', 'most relevant role first');
});

test('tailor: adds only skills the résumé itself already says, deduped by containment, in the list’s casing', () => {
  const { plan, variant } = tailorResume(doc(), JOB);
  const added = plan.skills.added.map((a) => a.term);
  assert.ok(added.includes('OSHA 30'), 'OSHA 30 (summary + certs) surfaces into Skills');
  assert.ok(!added.includes('OSHA'), '"OSHA" is covered by "OSHA 30"');
  assert.ok(added.includes('NEC code'));
  assert.ok(added.includes('Forklifts'), 'shown in the list’s casing — what the Skills section will print');
  assert.ok(!added.some((t) => /forklift operation/i.test(t)), 'never the posting’s phrase');
  const items = variant.skills[0].items;
  assert.ok(items.includes('Forklifts') && items.includes('OSHA 30') && items.includes('NEC code'));
  for (const a of plan.skills.added) assert.ok(a.evidence.toLowerCase().includes(a.term.toLowerCase()), 'every addition cites the line that proves it');
});

test('tailor: gaps are honest, but a requirement the résumé plainly carries is downgraded, not hidden', () => {
  const { plan } = tailorResume(doc(), JOB);
  const by = Object.fromEntries(plan.gaps.map((g) => [g.requirement, g]));
  assert.equal(by["Valid driver's license"].severity, 'fatal');
  assert.equal(by["Valid driver's license"].mustNotInvent, true);
  // "OSHA 30 certified" holds an "OSHA certification" requirement: it is not a gap at all
  // (lib/optimizer/credentials.js — the same answer the fit check gives).
  assert.ok(!by['OSHA certification'], 'a held credential is not listed as a gap');
  assert.ok(!by['Forklift Operation'] || by['Forklift Operation'].severity === 'likely_covered');
  assert.ok(!plan.keywords.missing.some((k) => k.term === 'Forklift Operation'));
  assert.ok(plan.keywords.missing.some((k) => k.term === "Valid driver's license"));
  const terms = plan.keywords.missing.map((k) => k.term);
  assert.equal(new Set(terms).size, terms.length, 'missing keywords are unique');
});

test('summary: composed only from the résumé’s own facts and passes the firewall', () => {
  const base = doc();
  const before = analyzeApplication({ resumeText: serializeToText(base), jobDescription: JD, jobTitle: JOB.jobTitle, company: JOB.company });
  const s = composeSummary(base, before);
  assert.ok(s.firewall.ok, JSON.stringify(s.firewall));
  // His own summary says "6 years"; the dates span 8 (Jun 2018 → today). A summary never claims
  // more than the résumé states (lib/resume/years.js — the harness's invented-years defect).
  assert.match(s.text, /^Journeyman Electrician with 6\+ years of experience at Desert Power Solutions and Sunbelt Electric\./);
  assert.match(s.text, /480V three-phase/);
  assert.match(s.text, /passed 100% of city inspections in 2024/);
  assert.ok(!/Desert Sun|Commercial Electrician/.test(s.text), 'nothing from the posting');
  const { plan, variant } = tailorResume(base, JOB);
  assert.equal(variant.basics.summary, plan.summary.text);
  assert.ok(plan.score.keywordCoverage.after >= plan.score.keywordCoverage.before, 'a tailored variant never loses keyword coverage');
  assert.equal(sentenceCase('Blueprint reading'), 'blueprint reading');
  assert.equal(sentenceCase('OSHA 30'), 'OSHA 30');
  assert.equal(sentenceCase('NEC code'), 'NEC code');
});

test('summary: replacing the candidate’s own summary never loses a keyword only it carried', () => {
  const text = RESUME.replace('Skilled in conduit bending, 480V three-phase systems, and troubleshooting motor controls.', 'Certified on Epic and Cerner charting.');
  const base = parseResume({ text, source: 'text' });
  // a weighty keyword (taxonomy concept) is surfaced into Skills in the résumé's own words …
  const r1 = tailorResume(base, { ...JOB, jobDescription: `${JD}\n- Experience with Epic or Cerner` });
  assert.ok(r1.variant.skills[0].items.includes('Cerner') || r1.variant.skills[0].items.includes('Epic'));
  assert.ok(r1.plan.score.keywordCoverage.after >= r1.plan.score.keywordCoverage.before);
  // … and a low-weight posting term that only the old summary carried keeps its sentence verbatim
  const r2 = tailorResume(base, { ...JOB, jobDescription: `${JD}\n- Charting experience; daily charting of work orders` });
  assert.match(r2.plan.summary.text, /Certified on Epic and Cerner charting\./);
  assert.ok(r2.plan.summary.sources.keptSentences.includes('Certified on Epic and Cerner charting.'), 'the keyword sentence is kept (facts like "OSHA 30 certified." are kept too)');
  assert.ok(r2.plan.score.keywordCoverage.after >= r2.plan.score.keywordCoverage.before);
});

test('summary: nothing to say → no summary, no provenance', () => {
  const base = parseResume({ text: 'PAT LEE\npat@example.com\n\nSKILLS\nExcel, Word', source: 'text' });
  const { plan } = tailorResume(base, { jobTitle: 'Clerk', jobDescription: 'Clerk needed. Excel required.' });
  assert.equal(plan.summary, null);
  assert.ok(!plan.provenance.some((p) => p.kind === 'summary'));
});

test('proof clause: prefers a percentage/dollar result and takes just that clause', () => {
  const p = pickProofClause(doc());
  assert.equal(p.clause, 'passed 100% of city inspections in 2024');
});

test('terminology: proposals only, applied when asked, with provenance', () => {
  const text = RESUME.replace('Operated scissor lifts and forklifts to stage material.', 'Operated scissor lifts and a pallet jack to stage material.');
  const base = parseResume({ text, source: 'text' });
  const jd = `${JD.replace('Forklift operation a plus', 'Forklift operation required')}`;
  const r1 = tailorResume(base, { ...JOB, jobDescription: jd });
  const t = r1.plan.terminology.find((x) => x.alias === 'pallet jack');
  assert.ok(t, 'alias → posting phrase proposal');
  assert.ok(!r1.variant.experience[1].bullets.some((b) => /Forklift Operation/.test(b.text)), 'not applied by default');
  const r2 = tailorResume(base, { ...JOB, jobDescription: jd, applyTerminology: true });
  assert.ok(r2.variant.experience[1].bullets.some((b) => /Forklift Operation/.test(b.text)));
  assert.ok(r2.plan.provenance.some((p) => p.kind === 'terminology'));
});

test('coverage ratio is weighted per keyword group, within [0,1]', () => {
  const kws = extractJobKeywords(JD, { jobTitle: JOB.jobTitle, company: JOB.company });
  const c = keywordCoverage(RESUME, kws);
  assert.ok(c.ratio > 0.6 && c.ratio <= 1);
  assert.equal(c.matched.length + c.missing.length, kws.length);
});

test('mismatched résumé: low score, honest gaps, no invented skills', () => {
  const designer = parseResume({ text: `SAM OKAFOR\nsam@example.com\n\nEXPERIENCE\nGraphic Designer — Bright Studio\n2019 – Present\n- Designed brand identities and social campaigns for 30+ clients in Figma.\n- Grew studio Instagram following 40% in one year.\n\nSKILLS\nFigma, Illustrator, Photoshop, Typography`, source: 'text' });
  const { plan } = tailorResume(designer, JOB);
  assert.ok(plan.score.before < 50);
  assert.equal(plan.skills.added.length, 0);
  assert.ok(plan.gaps.some((g) => g.severity === 'fatal'));
  assert.ok(plan.gaps.every((g) => g.severity !== 'likely_covered' || g.evidence));
});

test('polish: no provider configured → { available:false } and nothing changes', async () => {
  const saved = { OPENAI_API_KEY: process.env.OPENAI_API_KEY, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, LLM_API_KEY: process.env.LLM_API_KEY, LLM_BASE_URL: process.env.LLM_BASE_URL };
  for (const k of Object.keys(saved)) delete process.env[k];
  try {
    const r = await polishBullets([{ id: 'b1', text: 'Responsible for pulling wire.' }], { allowedKeywords: ['conduit bending'] });
    assert.equal(r.available, false);
    assert.deepEqual(r.changes, []);
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
  }
});
