import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildJudgeRequests, summarize } from './qa-judge.mjs';

const items = Array.from({ length: 20 }, (_, i) => ({
  company: 'insight global',
  source: `I applied through Insight Global and never heard back ${i}`,
  extraction: { outcome: 'ghosted', summary: 'Applicant reports no response after applying.' },
}));

test('judge requests use the Opus judge, fence the source, and have valid unique ids', () => {
  const reqs = buildJudgeRequests(items);
  assert.equal(reqs.length, 20);
  const ids = new Set(reqs.map((r) => r.custom_id));
  assert.equal(ids.size, 20);
  for (const r of reqs) {
    assert.match(r.custom_id, /^[a-zA-Z0-9_-]{1,64}$/);
    assert.equal(r.params.model, 'claude-opus-5-5');
    assert.equal(r.params.output_config.format.type, 'json_schema');
    assert.equal(r.params.thinking, undefined); // Opus 5.5 rejects disabled thinking
    assert.match(r.params.messages[0].content, /UNTRUSTED/);
  }
});

function verdict(over = {}) {
  return {
    type: 'succeeded',
    message: { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({
      right_subject: true, supported_by_source: true, outcome_correct: true, first_hand: true,
      pii_leak: false, fabricated_detail: false, overall_correct: true, note: 'ok', ...over,
    }) }] },
  };
}

test('gate passes at ≥90% correct with no PII, fails on any PII leak', () => {
  const reqs = buildJudgeRequests(items);
  const results = new Map(reqs.map((r, i) => [r.custom_id, verdict(i === 0 ? { overall_correct: false, outcome_correct: false } : {})]));
  const ok = summarize(items, reqs, results);
  assert.equal(ok.accuracy, 0.95);
  assert.equal(ok.pass, true);
  assert.equal(ok.failures_by_check.outcome_correct, 1);

  results.set(reqs[1].custom_id, verdict({ pii_leak: true, overall_correct: false }));
  const bad = summarize(items, reqs, results);
  assert.equal(bad.pii_leaks, 1);
  assert.equal(bad.pass, false);
});

test('unparseable or refused verdicts are counted as errors, not as passes', () => {
  const reqs = buildJudgeRequests(items);
  const results = new Map(reqs.map((r) => [r.custom_id, { type: 'succeeded', message: { stop_reason: 'refusal', content: [] } }]));
  const s = summarize(items, reqs, results);
  assert.equal(s.graded, 0);
  assert.equal(s.errors, 20);
  assert.equal(s.pass, false);
});
