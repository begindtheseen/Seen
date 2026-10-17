// Every code path that INSERTs into public.reports must satisfy the prod constraints
// (verified against prod 2026-10-17): `role text NOT NULL`, and reports_outcome_check only
// accepts ghosted / rejected / autoreject / hired / offer / interview / interviewing / human / waiting.
// A row with role null or outcome 'unknown' / 'applied' fails with HTTP 400. That silently dropped
// reports in the self-filling worker (its very first production run, Sheetz), the credit web /
// Reddit writers, and the app's Reddit + external ingest. Run: node --test api/reports.notnull.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REPORT_OUTCOMES, writableOutcome } from './reports.js';
import { buildReportRow as enrichRow } from './_utils/companyEnrichment.js';
import { buildRow as webRow } from '../scripts/credit/web-reports.mjs';
import { buildReportRow as backfillRow } from '../scripts/credit/lib/reddit.mjs';

const PROD_OUTCOMES = ['ghosted', 'rejected', 'autoreject', 'hired', 'offer', 'interview', 'interviewing', 'human', 'waiting'];

test('REPORT_OUTCOMES mirrors reports_outcome_check exactly', () => {
  assert.deepEqual([...REPORT_OUTCOMES].sort(), [...PROD_OUTCOMES].sort());
});

test('writableOutcome: applied → waiting, unknown/junk → null, valid passes through', () => {
  assert.equal(writableOutcome('applied'), 'waiting');
  assert.equal(writableOutcome('Ghosted'), 'ghosted');
  assert.equal(writableOutcome('unknown'), null);
  assert.equal(writableOutcome(''), null);
  assert.equal(writableOutcome(undefined), null);
  assert.equal(writableOutcome('maybe'), null);
});

test('self-filling worker row: no stated role → "" (never null)', () => {
  const row = enrichRow({ outcome: 'ghosted', role: '', summary: 'Applicant reports no response.' }, { companyName: 'Sheetz', subreddit: 'jobs', threadId: 'abc123' });
  assert.equal(row.role, '');
  assert.equal(enrichRow({ outcome: 'ghosted', summary: 'x' }, { companyName: 'a', subreddit: 'jobs', threadId: 'abc123' }).role, '');
  assert.equal(enrichRow({ outcome: 'ghosted', role: ' Cashier ', summary: 'x' }, { companyName: 'a', subreddit: 'jobs', threadId: 'abc123' }).role, 'Cashier');
});

test('credit web-reports row: null role → ""', () => {
  const item = { role: null, outcome: 'ghosted', summary: 'Applicant reports no response.', url: 'https://www.glassdoor.com/x', host: 'www.glassdoor.com', source_site: 'www.glassdoor.com' };
  const row = webRow(item, 'acme');
  assert.equal(row.role, '');
  assert.notEqual(row.role, null);
});

test('credit Reddit backfill row: null role → ""', () => {
  const row = backfillRow({ company: 'acme', subreddit: 'jobs', outcome: 'ghosted', role: null, summary: 'x' });
  assert.equal(row.role, '');
});
