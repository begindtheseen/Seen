// match2 — the clean-room matcher: unit rules, the invariants through the product's seam, and a fuzz pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchListing, _setFitBudget, textFromKeys } from './index.js';
import { rungOf } from './rung.js';
import { readPerson } from './person.js';
import { scheduleTerms, personWants, listingConditions, limitConflict } from './limits.js';
import { summaryOnly } from './listing.js';
import { judgeEach, setMatcher, activeMatcher, findResumeMatches } from '../resumeMatches.js';
import { buildJobKeys } from '../jobKeys.js';
import { createFakeRest } from '../admin/testing/fakeRest.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, '..', '..', 'fixtures');
const NOW = new Date('2026-11-10T12:00:00Z');
const posting = (title, company, reqs, duties = ['Do the day-to-day work of the role', 'Keep accurate records']) =>
  `${company} is hiring a ${title}.\n\nAbout the position: a regular, posted schedule with a steady team. ${'We value reliability and clear communication with every coworker. '.repeat(6)}\n\nWhat you'll do\n${duties.map((d) => `• ${d}`).join('\n')}\n\nRequirements\n${reqs.map((r) => `• ${r}`).join('\n')}\n\nBenefits\nMedical, dental and vision insurance; paid time off.`;

const HVAC = `Marcus Bell
Sacramento, CA · marcus.bell@example.com

HVAC service technician — 5 years residential and light commercial.

EXPERIENCE
HVAC Service Technician — Comfort Pros Heating & Air, Sacramento CA     2021 – Present
- Diagnose and repair furnaces, heat pumps and split systems; 6–8 calls a day
- Charge and recover refrigerant; EPA 608 Universal
HVAC Installer — Comfort Pros Heating & Air                              2019 – 2021
- Installed condensers, air handlers and duct systems
Lube Technician — Jiffy Lube                                             2017 – 2019

CERTIFICATIONS
EPA Section 608 Universal Certification (2019)
`;

test('rung: levelOf words, grade numerals, school grades and the occupation itself', () => {
  assert.equal(rungOf('HVAC Apprentice').rung, 0);
  assert.equal(rungOf('Phlebotomist').rung, 2);
  assert.equal(rungOf('Phlebotomist').stated, false);
  assert.equal(rungOf('Phlebotomist II').rung, 2.5);
  assert.equal(rungOf('Respiratory Therapist I').rung, 1);
  assert.equal(rungOf('3rd Grade Teacher').rung, 2);
  assert.equal(rungOf('Lead Phlebotomist').rung, 3);
  assert.equal(rungOf('Phlebotomy Supervisor').rung, 4);
  // a first-line supervisor occupation is at least a lead whatever its title says
  assert.equal(rungOf('Process Assistant (PA)', { title: 'First-Line Supervisors of Helpers, Laborers, and Material Movers, Hand' }).rung, 3);
});

test('limits: wants and conditions through one normaliser; unknown is no conflict', () => {
  const w = personWants('Looking for ONE full-time day-shift job (no overnights) — currently working two part-time jobs.');
  assert.deepEqual([...w.type], ['full-time']);
  assert.equal(w.shift.get('night'), false);
  assert.match(String(limitConflict(w, listingConditions('Stocker (Overnight)', []))), /night/);
  assert.match(String(limitConflict(w, listingConditions('Cashier (Part-Time, 15 hrs/wk)', []))), /full-time/);
  assert.equal(limitConflict(w, listingConditions('Cashier', [])), null);
  // breadth is not a limit
  assert.equal(personWants('Open to days, nights and weekends.').shift.size, 0);
  // "5 days a week" is not a day shift
  assert.equal(scheduleTerms('Work 5 days a week').shift.size, 0);
  // the title's own words win over the body's
  assert.deepEqual([...listingConditions('Phlebotomist - Part Time', ['This is a full-time role']).type], ['part-time']);
});

test('person: direction skips side jobs and a field they say they are leaving; a recent degree opens its field', () => {
  const nurse = readPerson(`Chloe Nguyen, RN
Philadelphia, PA · chloe@example.com

New graduate registered nurse seeking a full-time hospital residency.

EDUCATION
Drexel University — B.S. Nursing, June 2026

EXPERIENCE
Lifeguard / Swim Instructor — Philadelphia Parks & Recreation     Summers 2021 – 2025
Barista — Saxbys (Drexel campus)                                   2022 – 2024 (part-time)
`, { now: NOW });
  assert.equal(nurse.direction.length, 0);
  assert.equal(nurse.degrees[0]?.occ.title, 'Registered Nurses');
  const chef = readPerson(`Nadia Haddad
Pittsburgh, PA · nadia@example.com

Transitioning from restaurant kitchens into food safety and quality assurance. HACCP and ServSafe certified.

EXPERIENCE
Chef de Cuisine — Casbah, Pittsburgh PA     2019 – Aug 2026
- Ran a 14-cook kitchen; wrote HACCP plans and passed every county health inspection
Sous Chef — Casbah                          2016 – 2019
`, { now: NOW });
  assert.equal(chef.direction.length, 0);
  assert.equal(chef.target?.phrase, 'food safety and quality assurance');
});

test('decision: their own job matches; their earlier rung, an apprentice posting, another trade and two rungs up do not', () => {
  const keys = buildJobKeys({ resumeText: HVAC, now: NOW });
  const m = (title, reqs) => matchListing({ id: title, title, company: 'Sac Valley Air', location: 'Sacramento, CA', description: posting(title, 'Sac Valley Air', reqs) }, keys, { now: NOW, resumeText: HVAC });
  const own = m('HVAC Service Technician', ['3+ years of HVAC service experience', 'EPA 608 certification required']);
  assert.equal(own.ok, true, JSON.stringify(own));
  assert.equal(own.noHeadline, false);
  assert.match(own.reason, /^You're an HVAC Service Technician at Comfort Pros Heating & Air \(since 2021\)\./);
  assert.equal(m('HVAC Installer', ['1+ year installing']).why, 'own_earlier_rung');
  assert.equal(m('HVAC Apprentice', ['No experience required']).why, 'below_rung');
  assert.equal(m('HVAC Service Manager', ['5+ years managing technicians']).why, 'over_level');
  assert.equal(m('Electrician', ['Journeyman electrician license required']).ok, false);
});

test('decision: a remote listing of in-person work is not that work; a teaser rides only as a non-headline summary', () => {
  const keys = buildJobKeys({ resumeText: HVAC, now: NOW });
  const remote = matchListing({ id: 'r', title: 'HVAC Service Technician (Remote dispatch)', company: 'X', location: 'Remote', description: posting('HVAC Service Technician', 'X', ['3+ years of HVAC service']) }, keys, { now: NOW, resumeText: HVAC });
  assert.equal(remote.why, 'not_remote_work');
  const teaser = matchListing({ id: 't', title: 'HVAC Service Technician', company: 'Y', location: 'Sacramento, CA', source: 'adzuna', description: 'Y is hiring an HVAC Service Technician to repair residential systems. Competitive pay…' }, keys, { now: NOW, resumeText: HVAC });
  assert.equal(summaryOnly({ source: 'adzuna', description: 'short…' }), true);
  assert.equal(teaser.ok, true);
  assert.equal(teaser.summaryOnly, true);
  assert.equal(teaser.noHeadline, true);
});

test('textFromKeys rebuilds a readable résumé from the keys\' plain facts (the alert path)', () => {
  const keys = buildJobKeys({ resumeText: HVAC, now: NOW });
  const t = textFromKeys(keys);
  assert.match(t, /HVAC Service Technician — Comfort Pros Heating & Air/);
  assert.ok(readPerson(t, { now: NOW }).direction.some((r) => r.title === 'HVAC Service Technician'));
});

test('a listing that makes a helper throw is skipped and counted; the others still judge', () => {
  const text = fs.readFileSync(path.join(FIX, 'matching', 'cashier.txt'), 'utf8');
  const keys = buildJobKeys({ resumeText: text, now: NOW });
  const boom = { id: 'x', get title() { throw new Error('helper threw'); }, description: 'x' };
  const fine = { id: 'y', title: 'Cashier', company: 'Safeway', location: 'Phoenix, AZ', description: posting('Cashier', 'Safeway', ['No experience required']) };
  const r = judgeEach([boom, fine], (j) => matchListing(j, keys, { now: NOW, resumeText: text }));
  assert.equal(r.skippedError, 1);
  assert.equal(r.out.length, 1);
});

// ── through the seam: the real rail (findResumeMatches) with this matcher injected, against a fake PostgREST ──────
test('seam: the injected matcher decides the rail; every role, employer, year and credential in a reason is on the résumé', async () => {
  const UID = '22222222-3333-4444-8555-666666666666';
  const FUTURE = new Date(Date.now() + 20 * 86400e3).toISOString();
  const listings = [
    ['HVAC Service Technician', ['3+ years of HVAC service experience', 'EPA 608 certification required']],
    ['Lead HVAC Technician', ['5+ years of HVAC service', 'EPA 608 certification']],
    ['Facilities HVAC Mechanic', ['3+ years of HVAC experience']],
    ['HVAC Installer', ['1+ year installing']],
    ['Electrician', ['Journeyman electrician license required']],
    ['Plumber', ['Plumbing license required']],
    ['Registered Nurse', ['Active RN license required']],
  ];
  const rows = listings.map(([t, reqs], i) => ({ id: `00000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`, title: t, company: `Employer ${i}`, location: 'Sacramento, CA', description: posting(t, `Employer ${i}`, reqs), source: 'greenhouse', apply_url: `https://jobs.example/${i}`, salary: null, type: 'Full-time', level: null, score: 60, waste_score: 20, expires_at: FUTURE, lat: null, lng: null, created_at: new Date(Date.now() - i * 3600e3).toISOString(), availability_status: 'active', is_employer_posted: false, ats_tenant: null }));
  const fake = createFakeRest({ tables: { profiles: [{ id: UID, resume_text: HVAC, city: 'Sacramento, CA', resume_updated_at: '2026-11-01T00:00:00Z', job_keys: null }], applications: [], jobs: rows, geocode_cache: [] } });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => { const href = typeof input === 'string' ? input : input.url; if (new URL(href).hostname === 'db.example') return fake.fetch(href, init); throw new Error('network blocked'); };
  setMatcher(matchListing);
  try {
    assert.equal(activeMatcher(), matchListing);
    const out = await findResumeMatches({ supabaseUrl: 'https://db.example', serviceKey: 'svc', userId: UID, persist: false, now: NOW, geo: null });
    const titles = out.ranked.map((j) => j.title);
    assert.ok(titles.includes('HVAC Service Technician'), JSON.stringify(titles));
    for (const t of ['HVAC Installer', 'Electrician', 'Plumber', 'Registered Nurse']) assert.ok(!titles.includes(t), `${t} must not match`);
    const lower = HVAC.toLowerCase();
    for (const j of out.ranked) {
      const r = String(j._reason);
      for (const m of r.matchAll(/You(?:'re| were) an? (.+?) at (.+?) \((?:since )?(\d{4})/g)) {
        assert.ok(lower.includes(m[1].toLowerCase()), `title "${m[1]}" is on the résumé`);
        assert.ok(HVAC.includes(m[2]), `employer "${m[2]}" is on the résumé`);
        assert.ok(HVAC.includes(m[3]), `year ${m[3]} is on the résumé`);
      }
      for (const m of r.matchAll(/Your résumé lists (.+?)\.(?:\s|$)/g)) assert.ok(lower.includes(m[1].toLowerCase().slice(0, 20)), `credential "${m[1]}" is on the résumé`);
      assert.doesNotMatch(r, /\b\d+(\.\d+)?\+? years?\b/, 'no year count is stated');
    }
  } finally { setMatcher(null); globalThis.fetch = realFetch; }
  assert.equal(activeMatcher(), null);
});

test('no posting or résumé text reaches new RegExp: every dynamic pattern in match2 comes from a literal', () => {
  for (const f of fs.readdirSync(HERE).filter((x) => x.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(HERE, f), 'utf8');
    for (const m of src.matchAll(/new RegExp\(([^,)]+)/g)) assert.match(m[1].trim(), /^(escapeRegExp\(|[A-Z_]+_RE\.source$)/, `${f}: new RegExp(${m[1]})`);
  }
});

// ── fuzz: every résumé fixture × 200 corpus listings, rail and email, no exception ─────────────────────────────────
const CORPUS_PATH = process.env.SEEN_MATCH_CORPUS || '/tmp/claude-0/-home-user-Seen/b30eccfc-31e3-5e58-94c8-e02565dad614/scratchpad/corpus/all.json';
const corpus = (fs.existsSync(CORPUS_PATH) ? JSON.parse(fs.readFileSync(CORPUS_PATH, 'utf8')) : JSON.parse(fs.readFileSync(path.join(FIX, 'personas', 'postings-sample.json'), 'utf8')).map((p) => ({ title: p.title || p.jobTitle || '', company: p.company || '', description: p.description || p.text || p.jd || '' })))
  .filter((_, i) => i % 3 === 0).slice(0, 200);
const resumes = [];
const walk = (dir) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); if (f.isDirectory()) walk(p); else if (f.name.endsWith('.txt') && !/-jd\.txt$/.test(f.name)) resumes.push([path.relative(FIX, p), fs.readFileSync(p, 'utf8')]); } };
walk(FIX);

test(`fuzz: ${resumes.length} résumé fixtures × ${corpus.length} listings (rail and email) without an exception`, () => {
  _setFitBudget(3); // stage 1 on every listing; the fit engine on the first three survivors per résumé
  let calls = 0;
  try {
    for (const [name, text] of resumes) {
      const keys = buildJobKeys({ resumeText: text, now: NOW });
      for (const j of corpus) for (const mode of ['rail', 'email']) {
        try { matchListing(j, keys, { now: NOW, mode, resumeText: text }); calls++; } catch (e) { assert.fail(`${name} × "${j.title}" (${mode}): ${e.message}`); }
      }
    }
  } finally { _setFitBudget(40); }
  assert.ok(calls > 0);
});
