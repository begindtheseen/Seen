// Tests for lib/occupations (O*NET 31.0 data, CC BY 4.0) — data shape and budgets, the titles the matched-jobs
// engine failed on (director brief "Why"), relation and level rules, determinism of the build, and the rule
// that nothing under lib/ imports the build-only WordNet package.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { occupationOf, relation, levelOf, militaryOccupation, tasksOf, impliedDuties, occupation } from './index.js';
import { normTitle, titleVariants, stripLevel } from './normalize.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const MB = 1024 * 1024;

test('data files: shape, licence header, size budgets', () => {
  const files = ['occupations.json', 'titles.json', 'military.json'].map((f) => join(HERE, 'data', f));
  files.push(join(ROOT, 'lib', 'text', 'data', 'synonyms.json'));
  let total = 0;
  for (const f of files) {
    const size = statSync(f).size;
    total += size;
    assert.ok(size <= 2.5 * MB, `${f} is ${size} bytes (budget 2.5 MB)`);
    const d = JSON.parse(readFileSync(f, 'utf8'));
    assert.ok(d.h && d.h.licence && d.h.source && d.h.format && d.h.retrieved, `${f} header`);
  }
  assert.ok(total <= 6 * MB, `total ${total} bytes (budget 6 MB)`);
  const o = JSON.parse(readFileSync(files[0], 'utf8'));
  assert.ok(o.o.length >= 900);
  assert.match(o.h.attribution, /O\*NET 31\.0 Database by the U\.S\. Department of Labor, Employment and Training Administration \(USDOL\/ETA\)/);
  for (const r of o.o) {
    assert.match(r[0], /^\d\d-\d{4}\.\d\d$/);
    assert.ok(r[4].length <= 15 && r[5].length <= 10);
  }
});

test('data files are byte-stable JSON (sorted keys, minified)', () => {
  for (const f of ['occupations.json', 'titles.json', 'military.json']) {
    const raw = readFileSync(join(HERE, 'data', f), 'utf8');
    const sortKeys = (/** @type {any} */ v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
    assert.equal(JSON.stringify(sortKeys(JSON.parse(raw))), raw, `${f} is not in canonical form`);
  }
});

test('build is deterministic (runs when ONET_SRC points at the unpacked sources)', { skip: !process.env.ONET_SRC }, async () => {
  const { build } = await import('../../scripts/occupations/build-occupations.mjs');
  const a = build(process.env.ONET_SRC).files;
  const b = build(process.env.ONET_SRC).files;
  for (const k of Object.keys(a)) {
    assert.equal(JSON.stringify(a[k]), JSON.stringify(b[k]));
    assert.equal(JSON.stringify(a[k]), readFileSync(join(HERE, 'data', k), 'utf8'), `${k} differs from the shipped file`);
  }
});

// The titles quoted in the director's brief: each must land on an occupation a recruiter accepts.
const WHY = [
  ['Supply Sergeant', ['53-7065', '43-5071', '13-1081', '11-3071', '53-1042', '43-5061']],
  ['Supply Sergeant (92Y)', ['53-7065', '43-5071']],
  ['Assistant Branch Manager', ['11-3031', '43-1011', '41-1012']],
  ['Medical Billing Specialist', ['43-3021', '29-2072', '43-6013']],
  ['Software Engineering Intern', ['15-1252']],
  ['Licensed Insurance Producer', ['41-3021']],
  ['Principal, Elementary School', ['11-9032']],
  ['88M Motor Transport Operator', ['53-3032']],
  ['Phlebotomist', ['31-9097']],
  ['Chef', ['35-1011']],
  ['Hospital Corpsman', ['31-9092', '29-2042', '29-2043']],
];
for (const [title, codes] of WHY) {
  test(`occupationOf: ${title}`, () => {
    const m = occupationOf(title);
    assert.ok(m, `${title} → null`);
    assert.ok(codes.includes(m.code.slice(0, 7)), `${title} → ${m.code} ${m.title}`);
  });
}

test('occupationOf: employer jargon is a guess without the employer, close with it', () => {
  const plain = occupationOf('Process Assistant (PA)');
  assert.equal(plain?.code, '53-1042.00');
  assert.equal(plain?.confidence, 'guess');
  assert.equal(occupationOf('Process Assistant', { employer: 'Amazon' })?.confidence, 'close');
});

test('occupationOf: says nothing rather than guessing', () => {
  assert.equal(occupationOf('Director'), null);                 // a role noun with no field
  assert.equal(occupationOf('Engineer'), null);
  assert.equal(occupationOf('Remote Audio Tasks – English (US) Language'), null);
  assert.equal(occupationOf(''), null);
});

test('occupationOf: messy real titles from the posting corpus', () => {
  assert.equal(occupationOf('Registered Nurse – Navigator')?.code, '29-1141.00');
  assert.equal(occupationOf('LPN- Licensed Practical Nurse')?.code, '29-2061.00');
  assert.equal(occupationOf('Seasonal Sales Associate (part-time)- Perry Ellis')?.code, '41-2031.00');
  assert.equal(occupationOf('Server - Hiroki San')?.code, '35-3031.00');
  assert.equal(occupationOf('Keyholder, Atlanta')?.code, '41-1011.00');
  assert.equal(occupationOf('Medical Assistant, Pomona Valley')?.code, '31-9092.00');
});

test('normalize: abbreviations, noise, variants', () => {
  assert.equal(normTitle('Sr. Pharmacy Tech'), 'senior pharmacy technician');
  assert.equal(normTitle('RN'), 'registered nurse');
  assert.ok(titleVariants('Principal, Elementary School').full.includes('elementary school principal'));
  assert.deepEqual(titleVariants('Full-Stack Developer').full, ['full stack developer']);   // "full" is not "full time"
  assert.equal(stripLevel('assistant store manager'), 'store manager');
  assert.ok(!titleVariants('Installation Specialist - Pittsburgh, PA').keys.some((k) => /pittsburgh|^pa$/.test(k)));
});

test('levelOf: ranks by rule from the words', () => {
  const r = (/** @type {string} */ t) => levelOf(t).rank;
  assert.ok(r('Plumbing Apprentice') < r('Journeyman Plumber'));
  assert.ok(r('Journeyman Plumber') < r('Master Plumber'));
  assert.ok(r('Assistant Branch Manager') < r('Branch Manager'));
  assert.ok(r('Store Manager') < r('District Manager'));
  assert.ok(r('Software Engineering Intern') < r('Software Engineer'));
  assert.ok(r('Software Engineer') < r('Senior Software Engineer'));
  assert.equal(levelOf('Principal, Elementary School').marker, 'director');
  assert.equal(levelOf('Principal Engineer').marker, 'senior');
  assert.equal(levelOf('Medical Assistant').marker, null);         // the job, not a level
  assert.equal(levelOf('Sales Associate').marker, null);
  assert.equal(levelOf('Vice President, Finance').marker, 'executive');
  assert.equal(levelOf('Shift Lead').marker, 'lead');
});

test('relation: ladders, side-steps, different', () => {
  const rel = (/** @type {string} */ a, /** @type {string} */ b, o = {}) => relation(a, b, o);
  assert.deepEqual([rel('Plumbing Apprentice', 'Journeyman Plumber').relation, rel('Plumbing Apprentice', 'Journeyman Plumber').direction], ['ladder', 'up']);
  assert.deepEqual([rel('Master Plumber', 'Plumbing Apprentice').relation, rel('Master Plumber', 'Plumbing Apprentice').direction], ['ladder', 'down']);
  assert.equal(rel('Assistant Branch Manager', 'Branch Manager').direction, 'up');
  assert.equal(rel('Line Cook', 'Sous Chef').direction, 'up');
  assert.equal(rel('Licensed Practical Nurse', 'Registered Nurse').direction, 'up');
  assert.equal(rel('Phlebotomist', 'Medical Laboratory Technician').relation, 'related');
  assert.equal(rel('Registered Nurse', 'Software Engineer').relation, 'different');
  assert.equal(rel('88M Motor Transport Operator', 'CDL-A Truck Driver').relation, 'same');
  // a ladder pair is never "different"
  for (const [a, b] of [['Cashier', 'Store Manager'], ['Electrician Helper', 'Electrician'], ['Staff Accountant', 'Senior Accountant']]) {
    assert.notEqual(rel(a, b).relation, 'different', `${a} → ${b}`);
  }
  // the chef side-step: different on titles alone, related when the chef's own lines name the field
  const chefLines = ['Wrote and ran the HACCP plan; kept temperature logs for every food safety audit'];
  assert.equal(rel('Chef', 'Food Safety QA Technician').relation, 'different');
  const side = rel('Chef', 'Food Safety QA Technician', { lines: chefLines });
  assert.equal(side.relation, 'related');
  assert.match(side.why, /food, safety/);
});

test('militaryOccupation: codes need military context; ranks pick enlisted', () => {
  assert.equal(militaryOccupation('88M Motor Transport Operator')?.occupations[0].code, '53-3032.00');
  assert.equal(militaryOccupation('Unit Supply Specialist (92Y), U.S. Army')?.moc, '92Y');
  assert.equal(militaryOccupation('Hospital Corpsman, US Navy')?.moc, 'HM');
  assert.equal(militaryOccupation('Rifleman (0311), USMC')?.moc, '0311');
  assert.equal(militaryOccupation('Sales Associate 2019 – 2021'), null);   // a year is not a Marine code
  assert.equal(militaryOccupation('IT Support Specialist'), null);           // "IT" is not a Navy rating by itself
  assert.notEqual(militaryOccupation('Supply Sergeant')?.service, 'F');       // a sergeant is not the Air Force supply OFFICER code
});

test('tasks and implied duties come from the occupation', () => {
  assert.ok(tasksOf('29-1141.00').length >= 10);
  assert.deepEqual(tasksOf('00-0000.00'), []);
  const d = impliedDuties('Registered Nurse');
  assert.equal(d?.code, '29-1141.00');
  assert.ok(d?.tasks.some((t) => /patient/i.test(t)));
  assert.equal(impliedDuties('Director'), null);
  assert.equal(occupation('15-1252.00')?.title, 'Software Developers');
});

test('nothing under lib/ imports the build-only wordnet-db package', () => {
  /** @param {string} dir @returns {string[]} */
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === 'data' ? [] : walk(p);
    return /\.(m?js|tsx?)$/.test(e.name) ? [p] : [];
  });
  const offenders = walk(join(ROOT, 'lib')).filter((f) => !f.endsWith('index.test.mjs') && /['"]wordnet-db['"]/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(offenders, []);
  assert.ok(existsSync(join(ROOT, 'scripts', 'text', 'build-synonyms.mjs')));
});

test('"exact" is only a strong, uncontested, whole-title O*NET filing; partial readings are "close"', () => {
  const ae = occupationOf('Account Executive, SMB & Mid-Market');
  assert.equal(ae?.confidence, 'close');
  assert.equal(ae?.ambiguous, true);
  assert.ok([ae?.code, ...(ae?.alternatives || []).map((a) => a.code)].some((c) => /^41-/.test(c || '')));
  const be = occupationOf('Sr. Backend Engineer II');
  assert.equal(be?.code, '15-1252.00');
  assert.equal(occupationOf('Software Engineer, Observability (Supercompute)')?.confidence, 'close');
  assert.equal(occupationOf('88M Motor Transport Operator')?.confidence, 'close');   // a crosswalk mapping, not a title
  assert.equal(occupationOf('Registered Nurse')?.confidence, 'exact');
});

test('a function + lead / supervisor / coordinator title resolves to the function; the role noun gives the level', () => {
  assert.equal(occupationOf('Customer Support Team Lead')?.code, '43-4051.00');
  assert.equal(levelOf('Customer Support Team Lead').marker, 'lead');
  assert.ok(occupationOf('Team Leader, Claims'));
  assert.equal(occupationOf('Shift Lead'), null);        // no field named
});

test('relation: a named credential of the target field is side-step evidence', () => {
  assert.equal(relation('Chef', 'Food Safety QA Technician', { credentials: ['HACCP'] }).relation, 'related');
  assert.equal(relation('Line Cook', 'CDL-A Truck Driver', { credentials: ['CDL Class A'] }).relation, 'related');
  assert.equal(relation('Line Cook', 'CDL-A Truck Driver').relation, 'different');
});

test('bare level titles name no setting: null without evidence, placed from the lines / employer', () => {
  for (const t of ['Shift Manager', 'Shift Supervisor', 'Shift Lead', 'Assistant Manager', 'Team Lead', 'Supervisor', 'Coordinator',
    'Specialist', 'Associate', 'Technician', 'Night Shift Supervisor', 'Shift Manager - Atlanta, GA']) {
    const m = occupationOf(t);
    assert.ok(!m || m.confidence === 'guess', `${t} → ${m?.code} ${m?.confidence}`);
  }
  // cross-industry occupations are not a specific industry's code
  for (const t of ['General Manager', 'Operations Manager']) assert.equal(occupationOf(t)?.code, '11-1021.00');
  const at = (/** @type {string} */ t, /** @type {string[]} */ lines, /** @type {string} */ employer = '') => occupationOf(t, { lines, employer })?.code;
  assert.equal(at('Shift Manager', ['Ran the kitchen and drive-thru during dinner rush', 'Trained new cooks and servers on food safety']), '35-1012.00');
  assert.equal(at('Shift Manager', ['Opened and closed the store and balanced registers', 'Led sales floor associates and reduced shrink']), '41-1011.00');
  assert.equal(at('Shift Supervisor', ['Led 20 pickers and packers on the outbound dock', 'Hit UPH targets']), '53-1042.00');
  assert.equal(at('Team Lead', ['Coached call center agents on CSAT and handle time', 'Handled escalations']), '43-1011.00');
  assert.equal(at('Shift Manager', ['Supervised table games dealers on the casino floor', 'Balanced the cage']), '39-1013.00');
  assert.equal(at('Shift Manager', ['Managed a team of 8']), undefined);           // no setting named: still unknown
  assert.equal(occupationOf('Team Leader, Claims')?.code, '13-1031.00');           // the rest of the title names the function
});
