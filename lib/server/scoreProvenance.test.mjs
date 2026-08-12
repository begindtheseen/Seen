import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isEvidencedScore, suppressionReason, servedDataSource, EVIDENCED_SOURCES, UNEVIDENCED_SOURCES,
} from './scoreProvenance.js';

// The exact shape of the 552 live rows this guards against: one bulk run, a numeric accusation,
// zero reports behind it.
const AI_ESTIMATE_ROW = {
  company_name: 'someco', data_source: 'ai_estimate', overall_score: 54, ghost_rate: 61,
  report_count: 0, first_party_report_count: 0, web_report_count: 0, web_reviews: [],
};

test('an ai_estimate row is never servable', () => {
  assert.equal(isEvidencedScore(AI_ESTIMATE_ROW), false);
  assert.equal(suppressionReason(AI_ESTIMATE_ROW), 'unevidenced-source:ai_estimate');
});

test('a high-scoring ai_estimate row is still refused — provenance, not score, decides', () => {
  assert.equal(isEvidencedScore({ ...AI_ESTIMATE_ROW, overall_score: 95, ghost_rate: 2 }), false);
});

test('provenance matching is case- and whitespace-insensitive', () => {
  assert.equal(isEvidencedScore({ ...AI_ESTIMATE_ROW, data_source: '  AI_Estimate ' }), false);
});

test('a report-backed score is servable', () => {
  const row = { data_source: 'reports', report_count: 4, first_party_report_count: 4, web_report_count: 0 };
  assert.equal(isEvidencedScore(row), true);
  assert.equal(suppressionReason(row), null);
});

test('a web-researched score with reviews is servable', () => {
  const row = { data_source: 'web_search', report_count: 0, web_reviews: [{ text: 'x', source: 'Glassdoor' }] };
  assert.equal(isEvidencedScore(row), true);
});

test('an evidenced provenance with nothing actually behind it is refused', () => {
  const row = { data_source: 'web_search', report_count: 0, first_party_report_count: 0, web_report_count: 0, web_reviews: [] };
  assert.equal(isEvidencedScore(row), false);
  assert.equal(suppressionReason(row), 'no-evidence-behind-score');
});

test('an unrecognized provenance is refused, not assumed safe', () => {
  // Default-deny: a future writer inventing a new data_source cannot silently start publishing.
  const row = { data_source: 'some_new_pipeline', report_count: 9 };
  assert.equal(isEvidencedScore(row), false);
  assert.match(suppressionReason(row), /^unrecognized-source:some_new_pipeline$/);
});

test('a null or missing provenance is refused', () => {
  assert.equal(isEvidencedScore({ data_source: null, report_count: 5 }), false);
  assert.equal(isEvidencedScore({ report_count: 5 }), false);
  assert.equal(isEvidencedScore(null), false);
  assert.equal(isEvidencedScore(undefined), false);
  assert.equal(suppressionReason(null), 'no-row');
});

test('servedDataSource never renames an unknown provenance into web_research', () => {
  // The bug: every non-'reports' row was collapsed to 'web_research', so a guess read as research.
  assert.equal(servedDataSource(AI_ESTIMATE_ROW), 'ai_estimate');
  assert.equal(servedDataSource({ data_source: 'mystery' }), 'mystery');
  assert.equal(servedDataSource({}), 'unknown');
});

test('servedDataSource preserves the real categories', () => {
  assert.equal(servedDataSource({ data_source: 'reports' }), 'reports');
  assert.equal(servedDataSource({ data_source: 'web_search' }), 'web_research');
  assert.equal(servedDataSource({ data_source: 'web_research' }), 'web_research');
  assert.equal(servedDataSource({ data_source: 'fused' }), 'fused');
});

test('the two provenance sets never overlap', () => {
  for (const s of UNEVIDENCED_SOURCES) assert.ok(!EVIDENCED_SOURCES.has(s), `${s} in both sets`);
});
