// Oilfield entry jobs and trade apprenticeships / helper jobs (tradeReading.js, 2026-11-13). Every posting sentence below is
// a real posting's own words (fixtures/trades/postings — README.txt says where each came from); the résumés are first-time
// applicants written for these tests. The last block is the guard that matters most: nothing a tool says is a ticket, a
// license, a year or a line the résumé (or the person's own answer) does not hold.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tradeContext, physicalProof, longestJob } from './tradeReading.js';
import { extractConstraints } from './postingSections.js';
import { runOptimizer } from './index.js';
import { experienceProfile } from '../resume/years.js';
import { tradePlan, applyTradeLayout } from '../resume/tailor/tradeLayout.js';
import { classifyTitle } from '../server/jobKeys.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const R = path.join(HERE, 'fixtures/trades');
const P = path.join(R, 'postings');
const resume = (f) => fs.readFileSync(path.join(R, `${f}.txt`), 'utf8');
const posting = (f) => fs.readFileSync(path.join(P, `${f}.txt`), 'utf8');
const NOW = '2026-11-13';
const run = (r, p, extra = {}) => { const jd = posting(p); return runOptimizer({ resumeText: resume(r), jobTitle: jd.split('\n')[0], jobDescription: jd, now: NOW, ...extra }); };
const cons = (text, title) => extractConstraints(text, { jobTitle: title });

test('tradeContext places oilfield and trade postings, and nothing else', () => {
  assert.ok(tradeContext('Floorhand - South and East Texas', posting('patterson-floorhand')).entry, 'Patterson: "This is an entry-level job"');
  assert.ok(tradeContext('Roustabout Hand', posting('javelina-roustabout')).entry, '"Oilfield experience preferred but not required"');
  const pd = tradeContext('Electrical Trainee', posting('powerdesign-electrical-trainee'));
  assert.ok(pd && pd.rung && !pd.entry && pd.asksTime, '"3+ years of experience as an Electrician/Electrical Apprentice": a trainee title, not a beginner job (R38)');
  assert.ok(!tradeContext('Welder Helper', posting('koch-welder-helper')).entry, '"6 months\' previous experience as a welder helper"');
  assert.ok(tradeContext('Water Hauler', posting('jcv38-water-hauler')).driving);
  assert.ok(tradeContext('Plumbers Apprentice for Service Work', '').rung);
  for (const t of ['Experienced Senior Accountant, Corporate Accounting & Consolidations', 'Software Engineer', 'Warehouse Associate', 'Registered Nurse', 'Pharmacy Technician Trainee', 'Store Manager']) assert.equal(tradeContext(t, 'Paid training. Valid driver\'s license required.'), null, t);
});

test('rotations, travel and long hours are read as the posting states them (R16, R21)', () => {
  const pat = cons('Willing to travel to and work in remote locations on a rotational schedule which consists of 14 days on / 14 days off, working 12.5 hour shifts that can include days or nights and as well as weekends and holidays', 'Floorhand');
  const rot = pat.find((c) => c.trade && c.trade.schedule);
  assert.ok(rot, 'a rotation row');
  assert.match(rot.label, /14 days on \/ 14 days off/);
  assert.match(rot.label, /12\.5-hour days/);
  assert.ok(rot.trade.schedule.travel);
  assert.ok(!pat.some((c) => (c.items || []).some((i) => /^5-hour shift minimum$/.test(i))), '"12.5 hour shifts" is never a 5-hour shift minimum');
  const cudd = cons(posting('cudd-frac-eo'), 'Frac Equipment Operator (EO)').find((c) => c.trade && c.trade.schedule);
  assert.match(cudd.label, /14 days on \/ 7 days off/, 'Two week rotations away from home (14/7)');
  assert.match(cudd.label, /up to 90 hours a week/);
  const yard = cons(posting('etos-shop-yard-hand'), 'Shop Yard Hand').find((c) => c.trade && c.trade.schedule);
  assert.match(yard.label, /10 days on \/ 4 days off/, '"Shift is a 10 on and 4 off schedule."');
});

test('safety tickets keep their exact names; an OSHA 10 / 30 is a card (R9, R11)', () => {
  const jav = cons(posting('javelina-roustabout'), 'Roustabout Hand').filter((c) => c.trade && c.trade.ticket);
  assert.deepEqual(jav.map((c) => [c.trade.ticket, c.importance]).sort(), [['h2s', 'preferred'], ['safeland', 'preferred']]);
  const pd = cons('OSHA 30 certification preferred', 'Electrical Trainee').find((c) => c.trade && c.trade.ticket === 'osha30');
  assert.equal(pd.label, 'OSHA 30-Hour card');
  const pro = cons(posting('proenrg-workover-rig-hand'), 'Workover Rig Hand - West Texas').filter((c) => c.trade && c.trade.ticket).map((c) => c.trade.ticket).sort();
  for (const k of ['cpr', 'forklift', 'h2s', 'manlift', 'osha10', 'safeland', 'wellcontrol']) assert.ok(pro.includes(k), k);
  // "H2S monitors" in a safety-equipment list is equipment, not a ticket
  assert.ok(!cons('H2S monitors fall protection FR Clothing', 'Roustabout').some((c) => c.trade && c.trade.ticket === 'h2s'));
});

test('licenses: a driver\'s license is asked, a CDL the job requires is a gate, "pursue a license" is not one to hold (R1, R2, R38)', () => {
  const em = cons(posting('emcor-apprentice-lineman'), 'Apprentice Lineman/Groundman');
  const dl = em.find((c) => c.trade && c.trade.licence === 'driver');
  assert.ok(dl && !dl.gate, '"Class C or Class A Driver\'s License" is a driver\'s license, asked');
  assert.ok(em.some((c) => c.trade && c.trade.licence === 'cdl' && c.importance === 'preferred'), '"CDL preferred"');
  const wh = cons(posting('jcv38-water-hauler'), 'Water Hauler').find((c) => c.trade && c.trade.licence === 'cdl');
  assert.ok(wh && wh.gate && wh.label === 'Class A CDL', '"Must have Class A." on a hauling job');
  const go = cons(posting('goettl-hvac-apprentice'), 'HVAC Technician Apprentice (Phoenix)');
  assert.ok(!go.some((c) => c.kind === 'years' && /two years of full-time employment/i.test(c.sentence)), '"Commit to two years of full-time employment with us after training" is the employer\'s terms');
  const out = run('hs-grad-shop-class', 'deans-plumber-apprentice');
  assert.ok(!out.hard_gates.some((g) => /plumb/i.test(g.label || g.message)), '"Willingness to pursue or currently pursuing a plumbing license" never refuses');
});

test('readiness notes: a drug test or a criminal record is shown, never asked, never answerable (R31, R32)', () => {
  const out = run('construction-laborer', 'patterson-floorhand');
  const drug = out.statements.find((s) => /pre-employment testing/i.test(s.text));
  assert.ok(drug && drug.readiness && drug.claimable === false && drug.ask && drug.ask.kind === 'readiness');
  const second = run('construction-laborer', 'proenrg-workover-rig-hand').constraints.find((c) => c.readiness === 'second_chance');
  assert.match(second.message, /criminal record are encouraged to apply/);
  assert.match(second.message, /Nothing about it goes on a résumé/);
  // an answer to a readiness line is ignored (counted, never applied)
  const answered = run('construction-laborer', 'patterson-floorhand', { confirmed: [{ statementId: drug.id, answer: 'yes' }] });
  assert.equal(answered.confirmations.applied, 0);
  assert.equal(answered.statements.find((s) => s.id === drug.id).status, 'cannot_tell');
});

test('steady and related work history are counted from dated jobs; a job title counts for the background line only (R12, R13)', () => {
  const out = run('farm-hand', 'patterson-floorhand');
  const stable = out.statements.find((s) => /^One \(1\) year of stable work history/.test(s.text));
  assert.equal(stable.status, 'shown');
  assert.equal(stable.evidence[0].line, 'Ranch Hand - Wright Family Ranch, El Reno OK    Jan 2021 - Present');
  const related = out.statements.find((s) => /^Six \(6\) months stable related work history/.test(s.text));
  assert.equal(related.status, 'shown');
  assert.match(related.evidence[0].why, /^farming \/ ranching: Ranch Hand/);
  const ff = run('fast-food-mechanic-hobby', 'patterson-floorhand').statements.find((s) => /^Six \(6\) months stable related/.test(s.text));
  assert.notEqual(ff.status, 'shown', 'a fast-food job is no named related background');
  assert.equal(longestJob(experienceProfile(resume('farm-hand'), { now: new Date(NOW) })).title, 'Ranch Hand');
});

test('physical demands are shown only by a concrete line — a named load, outdoor work, long days (R20, R21)', () => {
  const p = physicalProof(['lift 50 lbs', 'lift 100 lbs', 'outdoor work in all weather', '12-hour days'], resume('warehouse-forklift'));
  assert.deepEqual(p.shown.map((x) => x.item), ['lift 50 lbs'], '"Repeatedly lifted boxes of fittings up to 60 lbs" covers 50, not 100');
  assert.match(p.partly[0].why, /you show 60 lbs; they ask up to 100/);
  assert.deepEqual(p.open, ['outdoor work in all weather', '12-hour days']);
  // an adjective is no proof: "Hard working and motivated young man" proves nothing physical
  assert.deepEqual(physicalProof(['lift 50 lbs', 'outdoor work in all weather'], 'SUMMARY\nHard working, physically fit and motivated.').shown, []);
  const lineman = run('construction-laborer', 'emcor-apprentice-lineman');
  const lift = lineman.constraints.find((c) => c.kind === 'physical' && /lift 100 lbs/.test(c.label));
  assert.notEqual(lift.status, 'met', 'bundles up to 80 lbs is not 100');
});

test('equipment: "operated" is shown, "worked around" is partly; mechanical aptitude needs a repair line (R22, R24)', () => {
  const yard = 'Use a forklift, skid steer, and telehandler frequently.';
  const mk = (resumeText) => runOptimizer({ resumeText, jobTitle: 'Shop Yard Hand', jobDescription: `Shop Yard Hand\nRequirements\n* ${yard}\n* Must have a valid Driver's License\n* Mechanical aptitude with the ability to troubleshoot equipment issues\n* Lift up to 50 lbs`, now: NOW });
  const around = mk('Sam Lee\nEXPERIENCE\nLaborer - ABC Construction, Odessa TX    Jan 2024 - Present\n- Worked around a skid steer and forklifts on site\n- Swept and cleaned the yard');
  const st = around.statements.find((s) => /skid steer/.test(s.text));
  assert.equal(st.status, 'partly');
  assert.match(st.evidence[0].why, /worked around a/);
  const mech = around.statements.find((s) => /Mechanical aptitude/.test(s.text));
  assert.equal(mech.status, 'not_shown');
  assert.match(mech.question, /repaired or maintained engines/);
  const ran = mk('Sam Lee\nEXPERIENCE\nLaborer - ABC Construction, Odessa TX    Jan 2024 - Present\n- Operated a skid steer and a forklift to move pipe\n- Replaced hydraulic hoses on the skid steer');
  assert.notEqual(ran.statements.find((s) => /skid steer/.test(s.text)).status, 'not_shown');
  assert.equal(ran.statements.find((s) => /Mechanical aptitude/.test(s.text)).status, 'shown');
});

test('entry path: a beginner job never refuses on years it does not state, and its duties are taught (R38 keeps a stated minimum)', () => {
  const farm = run('farm-hand', 'patterson-floorhand');
  assert.equal(farm.hard_gates.length, 0);
  assert.notEqual(farm.fit_band, 'Different field');
  assert.match(farm.verdict.sentence, /This job trains beginners: it screens on the 14 days on \/ 14 days off rotation — say so if true/);
  assert.ok(farm.statements.some((s) => s.trained && s.kind === 'duty'));
  const ff = run('fast-food-mechanic-hobby', 'javelina-roustabout');
  assert.notEqual(ff.field_match.level, 'different', 'another field is the usual way into a beginner job');
  assert.notEqual(ff.fit_band, 'Different field');
  const wh = run('warehouse-forklift', 'emcor-apprentice-lineman');
  assert.equal(wh.field_match.beginnerPath, true, 'warehouse work → apprentice lineman: a way in, never "a different field"');
  assert.notEqual(wh.fit_band, 'Different field');
  // R38: an "Electrical Trainee" asking for 3+ years says so first, and teaches nothing
  const pd = run('military', 'powerdesign-electrical-trainee');
  assert.match(pd.verdict.sentence, /^\d+ — This “Electrical Trainee” posting asks for 3\+ years of experience as Electrician\/Electrical Apprentice — it is not written for someone with no experience\./);
  assert.ok(!pd.statements.some((s) => s.trained));
  const koch = run('farm-hand', 'koch-welder-helper');
  assert.match(koch.verdict.sentence, /posting asks for 6 months' previous experience as a welder helper/);
});

test('questions are plain words, and each answer is a claim, never a résumé line (R1, R2, R16)', () => {
  const out = run('hs-grad-shop-class', 'javelina-roustabout');
  const dl = out.constraints.find((c) => c.trade && c.trade.licence === 'driver');
  assert.equal(dl.question, "Do you hold a valid driver's license? Which state?");
  const pat = run('construction-laborer', 'patterson-floorhand').constraints.find((c) => c.trade && c.trade.schedule);
  assert.equal(pat.question, 'Can you work a 14-days-on / 14-days-off rotation, away from home?');
  const h2s = out.constraints.find((c) => c.trade && c.trade.ticket === 'h2s');
  assert.equal(h2s.question, 'Do you hold an H2S training card?');
  // a yes on the driver's license reaches the paid build as the posting's own label — and only then
  const st = out.statements.find((s) => s.id === dl.statementId);
  const yes = run('hs-grad-shop-class', 'javelina-roustabout', { confirmed: [{ statementId: st.id, answer: 'yes' }] });
  const base = { basics: { name: 'Ethan Cole', summary: '' }, experience: [], education: [], skills: [], certifications: [], projects: [], languages: [], extra: [], sectionOrder: ['experience', 'education'], meta: {} };
  const plan = tradePlan({ jobTitle: 'Roustabout Hand', jobText: posting('javelina-roustabout'), base, variant: base, fit: yes, now: new Date(NOW) });
  assert.deepEqual(plan.addCerts.map((a) => a.name), ["Valid driver's license"]);
  const v = applyTradeLayout(JSON.parse(JSON.stringify(base)), plan);
  assert.deepEqual(v.sectionOrder, ['certifications', 'experience', 'education']);
  assert.equal(v.meta.sectionTitles.certifications, 'Licenses & Certifications');
  const none = tradePlan({ jobTitle: 'Roustabout Hand', jobText: posting('javelina-roustabout'), base, variant: base, fit: out, now: new Date(NOW) });
  assert.ok(!none || !none.addCerts.length, 'no answer → nothing added');
});

test('the paid build\'s notes: summary of facts, no drug-test line, OSHA as a card, CDL dates (R28, R32, R9, R37)', () => {
  const base = { basics: { name: 'T', summary: 'Hard working and motivated young man eager to learn a trade. Drug free.' }, experience: [{ id: 'e1', title: 'Driver', company: 'X', start: '2024', end: 'Present', bullets: [] }], education: [], skills: [{ id: 's', label: '', items: ['Shovel', 'Forklift'] }], certifications: [{ id: 'c', name: 'OSHA 10 certified', text: 'OSHA 10 certified' }], projects: [], languages: [], extra: [], sectionOrder: ['summary', 'experience', 'skills', 'certifications'], meta: {} };
  const plan = tradePlan({ jobTitle: 'Water Hauler', jobText: posting('jcv38-water-hauler'), base, variant: base, fit: { constraints: [] }, now: new Date(NOW) });
  const rules = plan.notes.map((n) => n.rule);
  for (const r of ['summary', 'never_on_resume', 'osha_card', 'universal_skills', 'cdl_dates']) assert.ok(rules.includes(r), r);
  const v = applyTradeLayout(JSON.parse(JSON.stringify(base)), plan);
  assert.deepEqual(v.sectionOrder, ['summary', 'certifications', 'experience', 'skills']);
  assert.equal(v.basics.summary, base.basics.summary, 'the person\'s words are never edited silently');
});

test('matched jobs see oilfield work: farm / ranch and Army driving carry into a beginner listing, never one asking for time in the job', () => {
  assert.equal(classifyTitle('Floorhand - South and East Texas').id, 'oilfield_hand');
  assert.equal(classifyTitle('Roustabout Hand').id, 'oilfield_hand');
  assert.equal(classifyTitle('Seasonal Harvest Hand').id, 'farm_hand');
});

// ── The guard: nothing false ──────────────────────────────────────────────────────────────────────────────────────
const RESUMES = fs.readdirSync(R).filter((f) => f.endsWith('.txt') && f !== 'README.txt').map((f) => f.replace(/\.txt$/, ''));
const POSTINGS = fs.readdirSync(P).filter((f) => f.endsWith('.txt')).map((f) => f.replace(/\.txt$/, ''));
const TICKET_HELD = { safeland: /safe\s*-?\s*land|\bPEC\b/i, h2s: /\bH2S\b/i, osha10: /OSHA[\s-]*10/i, osha30: /OSHA[\s-]*30/i, cpr: /\bCPR\b|first\s+aid/i, rigpass: /rig\s*pass/i, wellcontrol: /well\s*sharp|well\s+control/i, twic: /\bTWIC\b/, epa608: /\bEPA\b/i, forklift: /forklift[^\n]{0,30}(?:certif|card|licen)|certif[^\n]{0,20}forklift/i, manlift: /(?:man\s*lift|aerial|telehandler)[^\n]{0,30}(?:certif|card)/i, dot_medical: /DOT\s+(?:medical|physical)|medical\s+card/i };

test('nothing false, over every résumé × posting: evidence lines are résumé lines, no ticket / license / CDL the résumé lacks, OSHA never "certified" in our words', () => {
  for (const r of RESUMES) {
    const text = resume(r);
    const lines = new Set(text.split('\n').map((l) => l.trim()).filter(Boolean));
    for (const p of POSTINGS) {
      const out = run(r, p);
      const where = `${r} × ${p}`;
      for (const s of out.statements) {
        for (const e of s.evidence || []) if (e.line) assert.ok(lines.has(String(e.line).trim()), `${where}: evidence "${e.line}" is not a line of the résumé`);
        if (s.status === 'shown' && s.by !== 'you') assert.ok((s.evidence || []).some((e) => e.line) || /You said/.test(JSON.stringify(s.evidence)) || s.kind === 'promise' || (s.evidence || []).length, `${where}: shown with nothing behind it: ${s.text}`);
      }
      for (const c of out.constraints) {
        if (c.line) assert.ok(lines.has(String(c.line).trim()), `${where}: constraint line "${c.line}" is not a résumé line`);
        if (!c.trade || c.status !== 'met') continue;
        if (c.trade.ticket) assert.ok(TICKET_HELD[c.trade.ticket].test(text), `${where}: ${c.label} met without the résumé naming it`);
        if (c.trade.licence === 'cdl') assert.ok(/\bCDL\b/.test(text) && !/no\s+CDL/i.test(text), `${where}: CDL met without one`);
        if (c.trade.licence === 'driver') assert.ok(/driver'?s?\s+licen/i.test(text), `${where}: driver's license met without one`);
        if (c.trade.history) assert.ok(c.line && lines.has(c.line), `${where}: history met without a dated job line`);
      }
      // our own words never call an OSHA 10 / 30 a certification, and never put a test or record on a résumé
      for (const c of out.constraints.filter((x) => x.trade)) assert.doesNotMatch(String(c.message), /OSHA[\s-]*(?:10|30)[^.]{0,20}certif/i, `${where}: ${c.message}`);
      // every quoted phrase in the verdict is the résumé's or the posting's own words
      for (const m of String(out.verdict.sentence).matchAll(/"([^"]{6,})"/g)) assert.ok(text.includes(m[1]) || posting(p).includes(m[1]), `${where}: verdict quotes "${m[1]}"`);
      // a years ask is never shown from a claim and never from words alone
      for (const c of out.constraints.filter((x) => x.kind === 'years' && x.status === 'met')) assert.notEqual(c.by, 'you');
    }
  }
});

test('a work-conditions line that mentions tools is not credited by a résumé line (R25 asks the applicant to use tools)', () => {
  // Dean's plumber apprentice: "Exposure to smells associated with sewer and water, sounds associated with power tools."
  // was "shown" by the high-school grad's "Loaded and unloaded mowers and trimmers from the trailer".
  const r = run('hs-grad-shop-class', 'deans-plumber-apprentice');
  const cond = r.statements.find((s) => /exposure to smells/i.test(s.text));
  assert.ok(cond, 'the conditions line is read');
  assert.notEqual(cond.status, 'shown');
  assert.ok(!(cond.evidence || []).some((e) => /mowers and trimmers/i.test(e.line)));
});
