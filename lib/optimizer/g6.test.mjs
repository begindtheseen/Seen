// G6 (2026-11-10): the headline agrees with its own lines; a posting written for new graduates is met by a new graduate;
// years in a named specialty / a setting / one licence in two spellings / a specialty across two titles (matched-jobs round
// 11); a named credential not on the résumé is not shown; met gate rows quote the résumé. Every résumé and posting line here
// is invented. Run: node --test lib/optimizer/g6.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runOptimizer } from './index.js';
import { AGREE_GOOD, AGREE_STRONG, AGREE_PARTIAL, BAND_THRESHOLDS } from './explainScore.js';
import { loadPairs } from '../fixtures/calibration/load.mjs';

const NOW = '2026-11-10';
const run = (resumeText, jobTitle, jobDescription) => runOptimizer({ resumeText, jobTitle, jobDescription, now: NOW });
const row = (o, kind) => o.constraints.find((c) => c.kind === kind);
const R = (lines) => `Pat Doe\nPhoenix, AZ\n\nEXPERIENCE\n${lines}\n\nSKILLS\nCommunication`;

// ── 1. The headline agrees with its own lines ───────────────────────────────────────────────────────────────────────
function agrees(o, where) {
  const c = o.verdict && o.verdict.components;
  if (!c || c.statementCredit == null || c.failedHard) return;
  const S = c.statementCredit;
  const f = o.field_match || {};
  const strongOk = f.level === 'same' && f.leadRole && f.leadRole.current && f.leadRole.same;
  if (S >= AGREE_GOOD) assert.ok(o.fit_score >= BAND_THRESHOLDS.good, `${where}: S ${S} but ${o.fit_score}`);
  if (S >= AGREE_STRONG && strongOk) assert.ok(o.fit_score >= BAND_THRESHOLDS.strong, `${where}: S ${S}, current job in the occupation, but ${o.fit_score}`);
  if (S <= AGREE_PARTIAL) assert.ok(o.fit_score < BAND_THRESHOLDS.good, `${where}: S ${S} but ${o.fit_score}`);
}
test('G6 1: the three numbers are stated once', () => {
  assert.deepEqual([AGREE_GOOD, AGREE_STRONG, AGREE_PARTIAL], [0.70, 0.85, 0.20]);
});
test('G6 1: over every calibration pair, band and S never disagree (no failed hard gate)', () => {
  for (const file of ['fresh2.json', 'pairs.json', 'holdout.json', 'fresh.json']) {
    for (const p of loadPairs(file)) agrees(runOptimizer({ resumeText: p.resume, jobTitle: p.job.title, company: p.job.company, jobDescription: p.job.description, now: NOW }), `${file} ${p.posting}`);
  }
});
const OBV = '/tmp/claude-0/-home-user-Seen/b30eccfc-31e3-5e58-94c8-e02565dad614/scratchpad/director/gold/obvious-dev';
const RANK = { weak: 0, different: 0, 'different field': 0, partial: 1, stretch: 1, good: 2, strong: 3 };
test('G6 1: over the obvious-dev pairs too, and the controls stay at or below their band', { skip: !fs.existsSync(OBV) && 'obvious-dev set not present' }, () => {
  const postings = JSON.parse(fs.readFileSync(path.join(OBV, 'postings.json'), 'utf8'));
  for (const lf of fs.readdirSync(path.join(OBV, 'labels'))) {
    const who = lf.split('-')[0];
    const p = postings.find((x) => x.key === lf.replace(/^[A-Z]\d-/, '').replace('.txt', ''));
    const o = runOptimizer({ resumeText: fs.readFileSync(path.join(OBV, 'resumes', `${who}.txt`), 'utf8'), jobTitle: p.title, company: p.company, jobDescription: p.description, now: NOW });
    agrees(o, who);
    if (/^[JX]/.test(who)) {
      const band = (fs.readFileSync(path.join(OBV, 'labels', lf), 'utf8').match(/^BAND\s+(\w+)/m) || [])[1];
      const got = o.fit_score >= 75 ? 'strong' : o.fit_score >= 60 ? 'good' : o.fit_score >= 40 ? 'partial' : 'weak';
      assert.ok(RANK[got] <= RANK[band], `${who}: control ${band} scored ${o.fit_score}`);
    }
  }
});

// ── 2. A posting written for new graduates is met by a new graduate ─────────────────────────────────────────────────
const grad = fs.readFileSync(new URL('../fixtures/calibration/new-grad-analyst.txt', import.meta.url), 'utf8');
const ENTRY = 'Data Analyst — New Grad (Class of 2027)\nThis role is for recent or upcoming graduates (graduating by June 2027).\nResponsibilities:\n• Write SQL queries to answer business questions\n• Build dashboards in Tableau or Power BI\n• Clean and document datasets in Python\nRequirements:\n• Bachelor\'s degree in a quantitative field (pursuing, graduating by June 2027)\n• 0–1 years of experience; internships count\n• Experience with SQL and Excel\n• Strong communication skills';
test('G6 2: a new grad meets a new-grad posting — no years drag, the degree in progress meets it, the headline names both', () => {
  const o = run(grad, 'Data Analyst, New Grad 2027', ENTRY);
  assert.ok(o.fit_score >= BAND_THRESHOLDS.good, `${o.fit_score}`);
  assert.equal(o.verdict.components.years, 1);
  assert.ok(!o.constraints.some((c) => c.kind === 'years'), 'a 0–1 year line is no years ask');
  const d = row(o, 'degree');
  assert.equal(d.grade, 'met');
  assert.match(d.message, /You're finishing a B\.S\. in Data Analytics \(expected May 2027\); they accept a degree in progress/);
  assert.match(o.verdict.sentence, /You're finishing a B\.S\. Data Analytics \(expected May 2027\), with internships as a Data Analytics Intern \(2026\) and a Business Intelligence Intern \(2025\)/);
});
test('G6 2 mirror: the same new grad against a posting asking 3+ years stays where it was', () => {
  const senior = ENTRY.replace(/^Data Analyst — New Grad.*\nThis role.*\n/, '').replace('• 0–1 years of experience; internships count', '• 3+ years of experience as a data analyst').replace(' (pursuing, graduating by June 2027)', '');
  const o = run(grad, 'Data Analyst', senior);
  assert.ok(o.fit_score <= 40, `${o.fit_score}`);
  assert.equal(row(o, 'years').grade, 'not_shown');
  assert.equal(row(o, 'degree').grade, 'not_shown');
  assert.doesNotMatch(o.verdict.sentence, /internships as/);
});

// ── Addendum (a): years in a named specialty are not total years in the field ───────────────────────────────────────
test('G6 a: a specialty narrower than the occupation counts only from roles that name it (partly, with the field figure)', () => {
  const rn = run(R('Registered Nurse — Banner Health, Phoenix, AZ   Jan 2016 – Present\n• Med-surg unit, 5 patients per shift\n• Administered medications and charted in Epic'), 'Registered Nurse', 'Requirements:\n• 3+ years of NICU nursing experience\n• Active RN license');
  const y = row(rn, 'years');
  assert.equal(y.grade, 'partly'); assert.equal(y.computed, 0); assert.ok(y.fieldYears > 10);
  assert.match(y.message, /about 11 years in nursing \(Registered Nurse, 2016–now\), but no job on it names NICU/);
  const para = row(run(R('Paralegal — Smith & Lee LLP, Phoenix, AZ   2015 – Present\n• Drafted discovery responses and trial binders for litigation\n• Managed case calendars'), 'Corporate Paralegal', 'Requirements:\n• 4+ years of corporate/M&A paralegal experience\n• Strong organization'), 'years');
  assert.equal(para.grade, 'partly'); assert.equal(para.computed, 0);
  assert.match(para.message, /no job on it names corporate or M&A/);
});
test('G6 a mirror: a role that names the specialty (or its trade-talk equal) counts in full', () => {
  const nicu = row(run(R('Registered Nurse, NICU — Banner Health, Phoenix, AZ   Jan 2016 – Present\n• Cared for premature infants in a level III NICU'), 'Registered Nurse', 'Requirements:\n• 3+ years of NICU nursing experience'), 'years');
  assert.equal(nicu.grade, 'met');
  const tt = row(run(R('Registered Nurse — Banner Health, Phoenix, AZ   Jan 2016 – Present\n• Cared for premature infants in the neonatal intensive care unit'), 'Registered Nurse', 'Requirements:\n• 3+ years of NICU nursing experience'), 'years');
  assert.equal(tt.grade, 'met');
  const ma = row(run(R('Paralegal — Smith & Lee LLP, Phoenix, AZ   2015 – Present\n• Prepared closing sets and disclosure schedules for M&A deals'), 'Corporate Paralegal', 'Requirements:\n• 4+ years of corporate/M&A paralegal experience'), 'years');
  assert.equal(ma.grade, 'met');
});

// ── Addendum (b): never zero for a subject whose head is the person's occupation ────────────────────────────────────
test('G6 b: a setting in front of the occupation counts the occupation\'s years and says the setting is not stated', () => {
  const hvac = row(run(R('HVAC Service Technician — Cool Air Co, Phoenix, AZ   2018 – Present\n• Diagnosed and repaired furnaces and AC units\n• Charged refrigerant and replaced compressors'), 'HVAC Service Technician', 'Requirements:\n• 3+ years of residential HVAC service'), 'years');
  assert.equal(hvac.grade, 'met'); assert.ok(hvac.computed > 8);
  assert.match(hvac.message, /Your résumé doesn't say residential\./);
  const principal = row(run(R('Principal — Lincoln Elementary School, Phoenix, AZ   2017 – Present\n• Led 40 teachers and 600 students\n• Built the master schedule and budget'), 'Assistant Principal', 'Requirements:\n• 5+ years of school administration'), 'years');
  assert.equal(principal.grade, 'met');
  assert.match(principal.message, /school administration \(Principal, 2017–now\)/);
});
test('G6 b mirror: another occupation stays unmet', () => {
  assert.equal(row(run(R('Line Cook — Olive Garden, Phoenix, AZ   2018 – Present\n• Prepped and cooked 200 covers a night'), 'HVAC Service Technician', 'Requirements:\n• 3+ years of residential HVAC service'), 'years').grade, 'not_shown');
  assert.notEqual(row(run(R('Teacher — Lincoln Elementary School, Phoenix, AZ   2017 – Present\n• Taught 4th grade math and reading'), 'Assistant Principal', 'Requirements:\n• 5+ years of school administration'), 'years').grade, 'met');
});

// ── Addendum (c): one licence, two spellings ────────────────────────────────────────────────────────────────────────
test('G6 c: practitioner noun = practice noun, state code = state name', () => {
  const cos = row(run(R('Hair Stylist — Great Clips, Minneapolis, MN   2018 – Present\n• Cut and colored hair for 20 clients a day\n\nLICENSES\nMinnesota Cosmetologist License'), 'Hair Stylist', 'Requirements:\n• Active Minnesota cosmetology license'), 'certification');
  assert.equal(cos.grade, 'met');
  assert.match(cos.message, /Your résumé lists Minnesota Cosmetologist License/);
  const abbr = row(run(R('Hair Stylist — Shear Joy, St. Paul, MN   2019 – Present\n• Served 12 clients a day\n\nLICENSES\nMN Cosmetologist License #48213'), 'Hair Stylist', 'Requirements:\n• Active Minnesota cosmetology license'), 'certification');
  assert.equal(abbr.grade, 'met');
  assert.match(abbr.message, /Your résumé lists MN Cosmetologist License #48213/);
});
test('G6 c mirror: a licence from another state is not the one asked for', () => {
  assert.notEqual(row(run(R('Hair Stylist — Great Clips, Hudson, WI   2018 – Present\n• Cut and colored hair\n\nLICENSES\nWisconsin Cosmetologist License'), 'Hair Stylist', 'Requirements:\n• Active Minnesota cosmetology license'), 'certification').grade, 'met');
  assert.notEqual(row(run(R('Hair Stylist — Great Clips, Minneapolis, MN   2018 – Present\n• Cut and colored hair\n\nLICENSES\nMinnesota Barber License'), 'Hair Stylist', 'Requirements:\n• Active Minnesota cosmetology license'), 'certification').grade, 'met');
});

// ── Addendum (d): a specialty held across two titles at one employer ────────────────────────────────────────────────
test('G6 d: both titles count when both name the work', () => {
  const two = row(run(R('Senior Stylist / Color Specialist — Aveda Salon, Minneapolis, MN   Jun 2022 – Present\n• Balayage and color corrections for 15 clients a week\nStylist — Aveda Salon, Minneapolis, MN   Jan 2017 – May 2022\n• Haircuts, highlights and color services'), 'Color Specialist', 'Requirements:\n• 7+ years of color services experience'), 'years');
  assert.equal(two.grade, 'met'); assert.ok(two.computed > 9);
  assert.match(two.message, /Stylist, 2017–2022/);
  const barber = row(run(R('Master Barber — Fade Co, Phoenix, AZ   2023 – Present\n• Skin fades and beard design\nBarber — Fade Co, Phoenix, AZ   2018 – 2023\n• Fades, tapers and beard trims for 15 clients a day'), 'Barber', 'Requirements:\n• 6+ years of fades and beard work'), 'years');
  assert.equal(barber.grade, 'met');
});
test('G6 d mirror: the earlier title counts only when its lines name the work', () => {
  const one = row(run(R('Senior Stylist / Color Specialist — Aveda Salon, Minneapolis, MN   Jun 2022 – Present\n• Balayage and color corrections for 15 clients a week\nStylist — Aveda Salon, Minneapolis, MN   Jan 2017 – May 2022\n• Haircuts and blowouts'), 'Color Specialist', 'Requirements:\n• 7+ years of color services experience'), 'years');
  assert.notEqual(one.grade, 'met');
  assert.ok(one.computed < 5);
});

// ── A named credential not on the résumé is not shown; the headline names only not-shown rows ───────────────────────
const LEAD = R('Shift Supervisor — Desert Bean Coffee, Mesa, AZ   2022 – Present\n• Run the afternoon shift of 6 baristas\n• Count drawers and make the nightly deposit\n• Train new hires on the register (Toast)\n\nSKILLS\nToast POS, cash handling, Spanish (fluent), food handlers card (Maricopa County)');
const LEAD_POST = 'Responsibilities:\n• Run the shift and assign stations\n• Train new team members\n• Count the safe and make the bank deposit\nRequirements:\n• 1+ year leading a shift in a coffee shop or restaurant\n• Food handler card (or ability to get one within 30 days)\n• ServSafe Manager certification is a plus\n• Cash handling experience\n• Bilingual English/Spanish is a plus';
test('G6 gate rows: a preferred named credential the résumé does not name is not shown, and the headline says it from that row', () => {
  const o = run(LEAD, 'Shift Lead', LEAD_POST);
  const ss = o.constraints.find((c) => c.kind === 'certification' && /ServSafe/i.test(c.label));
  assert.equal(ss.grade, 'not_shown');
  assert.equal(ss.message, 'Not on your résumé. It is a plus, not a requirement.');
  const st = o.statements.find((s) => /ServSafe/i.test(s.text));
  assert.equal(st.status, 'not_shown');
  // invariant: whatever the headline names as missing, its own row is not shown
  const m = o.verdict.sentence.match(/(?:what's missing most is|the one thing they'd like that you don't list is) (.*)$/);
  if (m) for (const c of o.constraints) if (new RegExp(String(c.label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(m[1])) assert.equal(c.grade, 'not_shown', c.label);
  // mirror: a credential the résumé leaves open by nature ("within 30 days") is not called missing
  const ob = run(R('Barista — Desert Bean Coffee, Mesa, AZ   2022 – Present\n• Made drinks'), 'Barista', 'Requirements:\n• Must obtain a food handler card within 30 days of hire\n• Customer service');
  const fh = ob.constraints.find((c) => c.kind === 'certification');
  if (fh) assert.notEqual(fh.grade, 'not_shown');
});
test('G6 gate rows: a met language / credential row quotes the résumé\'s item, linking the posting\'s name only when needed', () => {
  const o = run(LEAD, 'Shift Lead', LEAD_POST);
  assert.equal(o.constraints.find((c) => c.kind === 'certification' && /food/i.test(c.label)).message, 'Your résumé lists food handlers card (Maricopa County).');
  assert.equal(row(o, 'language').message, 'Your résumé lists Spanish (fluent) — the bilingual English/Spanish they ask for.');
});
