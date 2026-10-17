// Offline tests for scripts/credit/lib/targets.mjs (demand-ranked company targets) and the
// data/major-employers.json seed list. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { countJobCompanies, isSlugLike, parseTargetsFile, rankCompanyTargets, loadJobCompanyRows, selectCompanyTargets } from './lib/targets.mjs';
import { normKey } from './lib/reddit.mjs';
import { STAFFING_AGENCIES } from '../../lib/agencies.ts';
import { isValidCompanyName } from '../../api/_utils/reportWrite.js';

const here = dirname(fileURLToPath(import.meta.url));
const jobs = (spec) => Object.entries(spec).flatMap(([company, n]) => Array.from({ length: n }, () => ({ company })));
const AGENCY_KEYS = new Set(STAFFING_AGENCIES.flatMap((a) => [a.name, ...a.aliases]).map(normKey));

test('countJobCompanies folds spellings that normalize the same', () => {
  const m = countJobCompanies([...jobs({ AutoZone: 3, 'AutoZone, Inc.': 2, 'autozone': 1, Target: 2 }), { company: null }, { company: '  ' }]);
  assert.equal(m.size, 2);
  assert.equal(m.get(normKey('AutoZone')).count, 6);
  assert.equal(m.get(normKey('AutoZone')).spellings.get('AutoZone'), 3);
});

test('rankCompanyTargets: file first, then demand (most current listings), then company_scores; deduped', () => {
  const jobCounts = countJobCompanies(jobs({ 'Dollar General': 50, AutoZone: 30, 'AutoZone, Inc.': 5, Walmart: 20, 'Insight Global': 99, Confidential: 80, Chipotle: 3 }));
  const scoreRows = [
    { company_name: 'amazon', first_party_report_count: 23, report_count: 23 },
    { company_name: 'chipotle', first_party_report_count: 1, report_count: 1 },
    { company_name: 'aaa', first_party_report_count: 11, report_count: 11 },
    { company_name: 'towne park', first_party_report_count: 3, report_count: 40 },
  ];
  const fileTargets = parseTargetsFile([{ name: 'Walmart', aliases: ['walmart inc', 'wal-mart'] }, { name: 'Amazon' }, { name: 'Kroger' }]);
  const { targets, skipped } = rankCompanyTargets({ fileTargets, jobCounts, scoreRows, excludeKeys: AGENCY_KEYS, skipIfReports: 15 });
  assert.deepEqual(targets.map((t) => [t.writeName, t.origin]), [
    ['walmart', 'file'], ['kroger', 'file'],                       // amazon: 23 first-party reports ≥ 15 → skipped
    ['dollar general', 'jobs'], ['autozone', 'jobs'], ['chipotle', 'jobs'], // Insight Global = agency, Confidential = placeholder
    ['towne park', 'company_scores'], ['aaa', 'company_scores'],   // by report_count desc
  ]);
  assert.equal(targets.find((t) => t.writeName === 'walmart').jobs, 20, 'file entry carries its demand count');
  assert.equal(targets.find((t) => t.writeName === 'autozone').jobs, 35);
  assert.deepEqual(targets.find((t) => t.writeName === 'autozone').aliases, ['autozone', 'autozone, inc.']);
  assert.deepEqual(skipped, { has_reports: 1, agency: 1, invalid_name: 1, duplicate: 3 }); // walmart (jobs), amazon + chipotle (scores)
  assert.equal(rankCompanyTargets({ fileTargets, jobCounts, scoreRows, excludeKeys: AGENCY_KEYS, n: 3 }).targets.length, 3);
  assert.ok(rankCompanyTargets({ fileTargets, jobCounts, scoreRows, skipIfReports: 0 }).targets.some((t) => t.writeName === 'amazon'), '0 disables the skip');
  assert.ok(rankCompanyTargets({ fileTargets, jobCounts, scoreRows, skipIfReports: 11 }).targets.every((t) => t.writeName !== 'aaa'));
});

test('ATS-slug names (one lowercase token) rank after display names, then by count', () => {
  const jobCounts = countJobCompanies(jobs({ ivcevidensia: 500, gongio: 90, 'Dollar General': 12, Intuit: 40, mobileye: 200 }));
  assert.equal(isSlugLike(jobCounts.get(normKey('gongio'))), true);
  assert.equal(isSlugLike(jobCounts.get(normKey('Intuit'))), false);
  const { targets } = rankCompanyTargets({ jobCounts });
  assert.deepEqual(targets.map((t) => t.writeName), ['intuit', 'dollar general', 'ivcevidensia', 'mobileye', 'gongio']);
});

test('write name: an existing exact company_scores spelling wins; normKey never picks it', () => {
  const jobCounts = countJobCompanies(jobs({ "Macy's, Inc.": 9, "Macy's": 2, 'Compass Group': 4 }));
  const scoreRows = [{ company_name: "macy's", first_party_report_count: 2, report_count: 2 }, { company_name: 'compass', first_party_report_count: 1, report_count: 1 }];
  const { targets } = rankCompanyTargets({ jobCounts, scoreRows });
  assert.equal(targets[0].writeName, "macy's", 'existing company_scores row, not the most common spelling');
  assert.deepEqual(targets[0].aliases, ["macy's", "macy's, inc."]);
  // "compass group" normalizes to "compass" (dedupe key) but is written under its own name.
  assert.equal(targets[1].writeName, 'compass group');
  assert.equal(targets.length, 2, 'company_scores "compass" deduped against it');
});

test('parseTargetsFile accepts arrays of strings / {name, aliases}, rejects bad input', () => {
  assert.deepEqual(parseTargetsFile(['Target', { name: " McDonald's ", aliases: ['McDonalds', "mcdonald's"] }]), [
    { name: 'Target', aliases: ['target'] }, { name: "McDonald's", aliases: ["mcdonald's", 'mcdonalds'] },
  ]);
  assert.deepEqual(parseTargetsFile({ targets: ['X Corp'] }), [{ name: 'X Corp', aliases: ['x corp'] }]);
  assert.throws(() => parseTargetsFile({}), /JSON array/);
  assert.throws(() => parseTargetsFile([{ aliases: ['x'] }]), /no name/);
});

test('demand read selects ONLY the company column of current listings, ordered for exact paging', async () => {
  const paths = [];
  const sbAll = async (path) => { paths.push(path); return path.startsWith('jobs') ? jobs({ AutoZone: 2 }) : [{ company_name: 'amazon', first_party_report_count: 1, report_count: 1 }]; };
  const cachePath = join(mkdtempSync(join(tmpdir(), 'seen-targets-')), 'demand-cache.json'); // never the real .credit-runs cache
  const rows = await loadJobCompanyRows({ sbAll, refresh: true, now: Date.UTC(2026, 9, 17), log: () => {}, cachePath });
  assert.equal(rows.length, 2);
  const p = paths[0];
  assert.match(p, /^jobs\?select=company&/);
  assert.match(p, /availability_status=eq\.active/);
  assert.match(p, /expires_at=gt\.2026-10-17T00%3A00%3A00\.000Z/);
  assert.match(p, /order=company\.asc/);
  const cached = await loadJobCompanyRows({ sbAll: async () => { throw new Error('should use cache'); }, now: Date.UTC(2026, 9, 17, 5), log: () => {}, cachePath });
  assert.equal(cached.length, 2, 'second read within 24h comes from the local cache (egress)');
  const picked = await selectCompanyTargets({ sbAll, n: 5, useDemand: false, log: () => {} });
  assert.deepEqual(picked.map((t) => t.writeName), ['amazon']);
  assert.ok(paths.some((x) => x.startsWith('company_scores?select=company_name,first_party_report_count,report_count')));
});

// ---------- data/major-employers.json ----------

test('major-employers.json parses, ≥800 unique normalized names, no duplicate names or aliases', () => {
  const raw = JSON.parse(readFileSync(join(here, 'data', 'major-employers.json'), 'utf8'));
  const list = Array.isArray(raw) ? raw : raw.targets;
  const parsed = parseTargetsFile(raw);
  assert.equal(parsed.length, list.length);
  const nameKeys = new Map();
  const aliasOwner = new Map();
  for (const e of list) {
    assert.equal(typeof e.name, 'string');
    assert.ok(isValidCompanyName(e.name), e.name);
    const k = normKey(e.name);
    assert.ok(k, e.name);
    assert.ok(!nameKeys.has(k), `duplicate normalized name: "${e.name}" vs "${nameKeys.get(k)}"`);
    nameKeys.set(k, e.name);
    for (const a of e.aliases || []) {
      assert.equal(a, a.trim().toLowerCase(), `alias must be stored lowercase/trimmed: "${a}"`);
      assert.notEqual(a, e.name.trim().toLowerCase(), `alias repeats its own name: "${a}"`);
    }
    for (const a of [e.name.trim().toLowerCase(), ...(e.aliases || [])]) {
      const owner = aliasOwner.get(a);
      assert.ok(!owner || owner === e.name, `spelling "${a}" listed under both "${owner}" and "${e.name}"`);
      aliasOwner.set(a, e.name);
    }
  }
  for (const e of list) for (const a of e.aliases || []) {
    const owner = nameKeys.get(normKey(a));
    assert.ok(!owner || owner === e.name, `alias "${a}" of "${e.name}" normalizes onto another entry "${owner}"`);
  }
  assert.ok(nameKeys.size >= 800, `${nameKeys.size} unique normalized names`);
  // The whole file survives target ranking as distinct companies (agencies aside).
  const { targets } = rankCompanyTargets({ fileTargets: parsed, skipIfReports: 0, excludeKeys: AGENCY_KEYS });
  assert.ok(targets.length >= 780, `${targets.length} targets after dedupe/agency exclusion`);
});
