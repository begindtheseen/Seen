import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findCompanyDuplicates, strictKey, broadKey } from './companyDupes.js';

test('prod 2026-10-20 groups: legal-suffix pairs auto-merge, "Compass Group" vs "Compass" is listed only', () => {
  const rows = [
    { id: '1', name: 'Bimbo Bakeries USA, Inc', report_count: 6 },
    { id: '2', name: 'Bimbo Bakeries USA', report_count: 1 },
    { id: '3', name: 'ShiftKey', report_count: 3 },
    { id: '4', name: 'ShiftKey, LLC', report_count: 4 },
    { id: '5', name: 'Compass Group', report_count: 0 },
    { id: '6', name: 'Compass', report_count: 0 },
    { id: '7', name: 'Amazon', report_count: 900 },
  ];
  const g = findCompanyDuplicates(rows);
  const by = Object.fromEntries(g.map((x) => [x.key, x]));
  assert.equal(g.length, 3);
  assert.equal(by['bimbo bakeries usa'].auto, true);
  assert.equal(by['bimbo bakeries usa'].companies[0].name, 'Bimbo Bakeries USA, Inc', 'biggest first = merge target');
  assert.equal(by.shiftkey.auto, true);
  assert.equal(by.shiftkey.companies[0].name, 'ShiftKey, LLC');
  assert.equal(by.compass.auto, false);
});

test('strict key ignores case, spacing, punctuation and stacked legal suffixes only', () => {
  assert.equal(strictKey('Acme Co., Ltd.'), strictKey('ACME'));
  assert.equal(strictKey('Acme Corporation'), 'acme');
  assert.notEqual(strictKey('Acme Holdings'), strictKey('Acme'));
  assert.equal(broadKey('Acme Holdings'), 'acme');
  assert.deepEqual(findCompanyDuplicates([{ id: 'a', name: '' }, { id: 'b', name: '' }]), []);
});
