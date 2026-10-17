// Offline tests for scripts/credit/web-reports.mjs — no network, no keys. Fixtures mimic real
// Messages API content arrays: server_tool_use / web_search_tool_result pairs (incl. the nested,
// `caller`-tagged pairs dynamic filtering produces), code-execution blocks, citation-split text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MODEL, buildRequest, agencyTargets, resolveAgency, chooseWriteName, canonicalUrl, extractSearchResults,
  parseFinalJson, readResult, validateAccounts, piiReason, groundUrl, groundingIndex, isOwnDomain,
  dedupeAgainstExisting, buildRow, platformFor, nonRedditWritable, processResults, estimateWebCost,
} from './web-reports.mjs';
import { STAFFING_AGENCIES } from '../../lib/agencies.ts';
import { isRedditSourced } from '../../lib/reportSource.ts';
import { SOURCE_TRUST, classifyPlatform } from '../../api/_utils/companyIntel.js';

const RH = { kind: 'agency', name: 'Robert Half', aliases: ['robert half', 'robert half international'] };

const fence = (obj) => '```json\n' + JSON.stringify(obj) + '\n```';
const searchPair = (id, urls, caller) => [
  { type: 'server_tool_use', id, name: 'web_search', input: { query: 'robert half recruiter ghosted reddit' }, ...(caller ? { caller } : {}) },
  { type: 'web_search_tool_result', tool_use_id: id, ...(caller ? { caller } : {}),
    content: urls.map((url) => ({ type: 'web_search_result', url, title: `t ${url}`, encrypted_content: 'EqgfCioI...', page_age: 'March 3, 2025' })) },
];
const ACC = (over = {}) => ({
  source_url: 'https://www.reddit.com/r/recruitinghell/comments/1abcde/robert_half_ghosted_me_after_3_calls/',
  source_site: 'reddit.com', posted_date: '2025-03', outcome: 'ghosted', role: 'Staff Accountant',
  summary: 'The applicant had three calls with a Robert Half recruiter, was submitted to a client, and then stopped hearing back.',
  first_hand: true, subject: 'target', confidence: 'high', ...over,
});

function message(content, stop_reason = 'end_turn', searches = 2) {
  return { type: 'succeeded', message: { model: MODEL, stop_reason, content, usage: { input_tokens: 38000, output_tokens: 4100, server_tool_use: { web_search_requests: searches } } } };
}

// A realistic dynamic-filtering response: code execution calls web_search; final answer split into
// several text blocks by citations.
function fixtureContent(accounts) {
  const answer = fence({ accounts });
  const mid = Math.floor(answer.length / 2);
  return [
    { type: 'text', text: 'I will search for first-hand accounts.' },
    { type: 'server_tool_use', id: 'srvtoolu_code1', name: 'code_execution', input: { code: 'r = web_search("robert half ghosted")' } },
    ...searchPair('srvtoolu_ws1', [
      'https://www.reddit.com/r/recruitinghell/comments/1abcde/robert_half_ghosted_me_after_3_calls/',
      'https://www.glassdoor.com/Interview/Robert-Half-Interview-Questions-E1124.htm?utm_source=x',
    ], { type: 'code_execution_20260120', tool_id: 'srvtoolu_code1' }),
    { type: 'code_execution_tool_result', tool_use_id: 'srvtoolu_code1', content: { type: 'code_execution_result', stdout: 'filtered 2 results', stderr: '', return_code: 0 } },
    ...searchPair('srvtoolu_ws2', ['https://www.roberthalf.com/us/en/insights/career-development/ghosting']),
    { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_ws3', content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } },
    { type: 'text', text: 'Found one account. ', citations: [{ type: 'web_search_result_location', url: 'https://www.reddit.com/r/recruitinghell/comments/1abcde/x/', title: 't', encrypted_index: 'Eo8', cited_text: 'ghosted me' }] },
    { type: 'text', text: answer.slice(0, mid) },
    { type: 'text', text: answer.slice(mid) },
  ];
}

// ---------- request shape ----------

test('request shape: sonnet 5.5, web_search_20260209 only, no thinking, no format, medium effort', () => {
  const r = buildRequest(RH);
  assert.match(r.custom_id, /^[a-zA-Z0-9_-]{1,64}$/);
  assert.equal(r.params.model, 'claude-sonnet-5-5');
  assert.deepEqual(r.params.tools, [{ type: 'web_search_20260209', name: 'web_search', max_uses: 6 }]);
  assert.equal(r.params.tools.some((t) => /code_execution/.test(t.type)), false);
  assert.equal('thinking' in r.params, false);
  assert.deepEqual(r.params.output_config, { effort: 'medium' });
  assert.equal('format' in r.params.output_config, false, 'structured outputs are incompatible with web-search citations');
  assert.ok(r.params.max_tokens >= 8000);
  assert.match(r.params.system, /UNTRUSTED/);
  const prompt = r.params.messages[0].content;
  assert.match(prompt, /Robert Half/);
  assert.match(prompt, /robert half international/);
  assert.match(prompt, /client/i);
  assert.match(prompt, /```json/);
  assert.match(r.params.system, /Never estimate or state rates/);
});

test('all 26 agencies produce unique, valid custom_ids', () => {
  const ts = agencyTargets();
  assert.equal(ts.length, 26);
  const ids = ts.map((t) => buildRequest(t).custom_id);
  assert.equal(new Set(ids).size, 26);
  for (const id of ids) assert.match(id, /^[a-zA-Z0-9_-]{1,64}$/);
});

test('max_uses override flows into tool + prompt; estimate includes searches', () => {
  const r = buildRequest(RH, { maxUses: 4 });
  assert.equal(r.params.tools[0].max_uses, 4);
  assert.match(r.params.messages[0].content, /at most 4 searches/);
  const e = estimateWebCost(26);
  assert.ok(e.perRequest > 0.1 && e.perRequest < 0.2, `per request ${e.perRequest}`);
  assert.ok(Math.abs(e.total - 26 * e.perRequest) < 1e-9);
});

// ---------- agency-name normalization ----------

test('resolveAgency: case-insensitive exact name/alias only, never fuzzy', () => {
  assert.equal(resolveAgency('ROBERT HALF')?.name, 'Robert Half');
  assert.equal(resolveAgency('robert half international')?.name, 'Robert Half');
  assert.equal(resolveAgency('TEK Systems')?.name, 'TEKsystems');
  assert.equal(resolveAgency('robert half inc'), null);
  assert.equal(resolveAgency('hays*'), null);
  assert.equal(resolveAgency('haystack'), null);
  assert.throws(() => agencyTargets(['not an agency']), /unknown agency/);
  assert.deepEqual(agencyTargets(['aerotek', 'Aerotek']).map((t) => t.name), ['Aerotek']);
  assert.equal(agencyTargets(null, 3).length, 3);
});

test('chooseWriteName always returns an exact lowercase alias from lib/agencies.ts', () => {
  assert.equal(chooseWriteName(RH, []), 'robert half');
  assert.equal(chooseWriteName(RH, [{ company_name: 'Robert Half International' }, { company_name: 'robert half international' }, { company_name: 'robert half' }]), 'robert half international');
  const tek = agencyTargets(['teksystems'])[0];
  assert.equal(chooseWriteName(tek, [{ company_name: 'TEKsystems c/o Allegis Group' }]), 'teksystems c/o allegis group');
  for (const a of STAFFING_AGENCIES) {
    const t = agencyTargets([a.name])[0];
    const w = chooseWriteName(t, [{ company_name: 'something else' }]);
    assert.ok(a.aliases.includes(w), `${a.name} → ${w}`);
    assert.equal(w, w.toLowerCase().trim());
  }
});

// ---------- parsing ----------

test('extractSearchResults finds nested (dynamic-filtering) and top-level results + errors', () => {
  const { results, errors } = extractSearchResults(fixtureContent([]));
  assert.deepEqual(results.map((r) => r.url), [
    'https://www.reddit.com/r/recruitinghell/comments/1abcde/robert_half_ghosted_me_after_3_calls/',
    'https://www.glassdoor.com/Interview/Robert-Half-Interview-Questions-E1124.htm?utm_source=x',
    'https://www.roberthalf.com/us/en/insights/career-development/ghosting',
  ]);
  assert.deepEqual(errors, ['max_uses_exceeded']);
});

test('citation URLs in text blocks are NOT treated as retrieved results', () => {
  const content = [{ type: 'text', text: 'x', citations: [{ type: 'web_search_result_location', url: 'https://www.reddit.com/r/a/comments/zzz/' }] }];
  assert.equal(extractSearchResults(content).results.length, 0);
});

test('parseFinalJson: last fence wins, text split across citation blocks is rejoined', () => {
  const content = fixtureContent([ACC()]);
  const p = parseFinalJson(content);
  assert.equal(p.json.accounts.length, 1);
  const two = [{ type: 'text', text: 'draft ```json\n{"accounts":[{"x":1},{"x":2}]}\n``` final:\n' + fence({ accounts: [] }) }];
  assert.deepEqual(parseFinalJson(two).json.accounts, []);
  assert.equal(parseFinalJson([{ type: 'text', text: 'no json here' }]).error, 'bad_json');
  assert.equal(parseFinalJson([{ type: 'text', text: '```json\n{"accounts": [ {"a":1}, \n```' }]).error, 'bad_json');
  assert.equal(parseFinalJson([{ type: 'text', text: fence({ items: [] }) }]).error, 'bad_json', 'accounts array required');
});

test('readResult: pause_turn and max_tokens are incomplete and never parsed', () => {
  const content = fixtureContent([ACC()]);
  assert.equal(readResult(message(content, 'pause_turn')).status, 'incomplete_pause_turn');
  assert.equal(readResult(message(content, 'pause_turn')).accounts, undefined);
  assert.equal(readResult(message(content, 'max_tokens')).status, 'incomplete_max_tokens');
  assert.equal(readResult(message(content, 'refusal')).status, 'refusal');
  assert.equal(readResult({ type: 'errored', error: {} }).status, 'request_errored');
  assert.equal(readResult(undefined).status, 'missing');
  const ok = readResult(message(content));
  assert.equal(ok.status, 'ok');
  assert.equal(ok.searches, 2);
  assert.equal(ok.accounts.length, 1);
});

// ---------- URL grounding (anti-hallucination) ----------

test('canonicalUrl: reddit by post id across hosts/slugs/comment permalinks; tracking params dropped', () => {
  const a = canonicalUrl('https://old.reddit.com/r/recruitinghell/comments/1ABCDE/some_slug/');
  const b = canonicalUrl('https://www.reddit.com/r/recruitinghell/comments/1abcde/other/k9x8y7/?utm_source=share');
  const c = canonicalUrl('https://redd.it/1abcde');
  assert.equal(a.key, 'reddit:1abcde');
  assert.equal(b.key, 'reddit:1abcde');
  assert.equal(c.key, 'reddit:1abcde');
  assert.equal(a.reddit.subreddit, 'recruitinghell');
  assert.equal(a.display, 'https://www.reddit.com/r/recruitinghell/comments/1abcde/');
  assert.equal(canonicalUrl('https://www.glassdoor.com/x.htm?utm_source=a&id=5').key, 'glassdoor.com/x.htm?id=5');
  assert.equal(canonicalUrl('javascript:alert(1)'), null);
  assert.equal(canonicalUrl('ftp://x.com/a'), null);
  assert.equal(canonicalUrl('not a url'), null);
  assert.equal(canonicalUrl('https://www.reddit.com/user/someone/').reddit, null);
});

test('groundUrl: exact match only counts; same-host invented page is host_only', () => {
  const idx = groundingIndex([{ url: 'https://www.reddit.com/r/jobs/comments/aaa111/x/' }, { url: 'https://www.teamblind.com/post/Robert-Half-abc' }]);
  assert.equal(groundUrl('https://reddit.com/r/jobs/comments/aaa111/', idx), 'exact');
  assert.equal(groundUrl('https://www.reddit.com/r/jobs/comments/bbb222/made_up/', idx), 'host_only');
  assert.equal(groundUrl('https://www.teamblind.com/post/Robert-Half-abc/', idx), 'exact');
  assert.equal(groundUrl('https://www.indeed.com/cmp/Robert-Half/reviews', idx), 'none');
  assert.equal(groundUrl('mailto:a@b.com', idx), 'invalid');
});

test('validateAccounts drops hallucinated, own-domain, non-first-hand, client, low-confidence, unknown, stale, dup', () => {
  const content = fixtureContent([]);
  const { results } = extractSearchResults(content);
  const now = Date.UTC(2026, 9, 17);
  const accounts = [
    'garbage',
    ACC(),                                                                                     // kept
    ACC({ summary: 'Duplicate of the same thread with different words entirely here.' }),      // duplicate_url
    ACC({ source_url: 'https://www.reddit.com/r/recruitinghell/comments/zzz999/invented/' }),  // host_only
    ACC({ source_url: 'https://www.indeed.com/cmp/Robert-Half/reviews?fcountry=US' }),          // none
    ACC({ source_url: 'https://www.roberthalf.com/us/en/insights/career-development/ghosting' }), // own_domain
    ACC({ source_url: 'https://www.glassdoor.com/Interview/Robert-Half-Interview-Questions-E1124.htm', first_hand: false }),
    ACC({ source_url: 'https://www.glassdoor.com/Interview/Robert-Half-Interview-Questions-E1124.htm', subject: 'other_employer' }),
    ACC({ source_url: 'https://www.glassdoor.com/Interview/Robert-Half-Interview-Questions-E1124.htm', confidence: 'low' }),
    ACC({ source_url: 'https://www.glassdoor.com/Interview/Robert-Half-Interview-Questions-E1124.htm', outcome: 'unknown' }),
    ACC({ source_url: 'https://www.glassdoor.com/Interview/Robert-Half-Interview-Questions-E1124.htm', outcome: 'scammed' }),
    ACC({ source_url: 'https://www.glassdoor.com/Interview/Robert-Half-Interview-Questions-E1124.htm', posted_date: '2016-02' }),
  ];
  const { kept, dropped } = validateAccounts(accounts, results, RH, { now });
  assert.equal(kept.length, 1);
  assert.equal(kept[0].url, 'https://www.reddit.com/r/recruitinghell/comments/1abcde/');
  assert.equal(kept[0].reddit.postId, '1abcde');
  assert.equal(validateAccounts([ACC({ source_url: 'javascript:void(0)' })], results, RH).dropped[0].reason, 'invalid_url');
  assert.equal(validateAccounts(Array(20).fill(ACC()), results, RH, { now }).dropped.length, 11, 'capped at 12 accounts per target');
  const reasons = dropped.map((d) => d.reason).sort();
  assert.deepEqual(reasons, [
    'bad_outcome', 'duplicate_url', 'low_confidence', 'malformed', 'not_first_hand', 'outcome_unknown',
    'own_domain', 'subject_other_employer', 'too_old', 'url_not_retrieved', 'url_not_retrieved_host_only',
  ].sort());
});

test('grounding is per message: a URL retrieved for another target does not count', () => {
  const { kept, dropped } = validateAccounts([ACC()], [{ url: 'https://www.reddit.com/r/jobs/comments/other1/x/' }], RH);
  assert.equal(kept.length, 0);
  assert.equal(dropped[0].reason, 'url_not_retrieved_host_only');
});

test('structural URL rejects: reddit user pages, listings, linkedin profiles, job postings', () => {
  const urls = [
    'https://www.reddit.com/user/someone/', 'https://www.reddit.com/r/recruitinghell/', 'https://www.linkedin.com/in/jane-doe-123/',
    'https://www.indeed.com/viewjob?jk=abc', 'https://www.linkedin.com/jobs/view/123',
  ];
  const { kept, dropped } = validateAccounts(urls.map((u) => ACC({ source_url: u })), urls.map((url) => ({ url })), RH);
  assert.equal(kept.length, 0);
  assert.deepEqual(dropped.map((d) => d.reason), ['reddit_not_a_thread', 'reddit_not_a_thread', 'personal_profile', 'job_listing', 'job_listing']);
});

test('isOwnDomain catches agency subdomains / regional sites, not third-party sites', () => {
  assert.equal(isOwnDomain('jobs.roberthalf.com', RH), true);
  assert.equal(isOwnDomain('randstadusa.com', agencyTargets(['randstad'])[0]), true);
  assert.equal(isOwnDomain('teksystems.com', agencyTargets(['teksystems'])[0]), true);
  assert.equal(isOwnDomain('reddit.com', RH), false);
  assert.equal(isOwnDomain('glassdoor.com', RH), false);
});

// ---------- PII filter ----------

test('piiReason flags names, handles, contact info, URLs; allows the target name', () => {
  assert.equal(piiReason('The applicant emailed jane.doe@roberthalf.com and got no reply.', RH), 'email');
  assert.equal(piiReason('The recruiter called from 555-123-4567 then went silent.', RH), 'phone');
  assert.equal(piiReason('Posted by u/throwaway_2024 about being ghosted.', RH), 'handle');
  assert.equal(piiReason('The applicant tagged @rh_recruiter and never heard back.', RH), 'handle');
  assert.equal(piiReason('See https://example.com for the thread.', RH), 'url');
  assert.equal(piiReason('Their recruiter Sarah stopped replying after the submission.', RH), 'person_name');
  assert.equal(piiReason('A manager named Kevin rejected the applicant.', RH), 'person_name');
  assert.equal(piiReason('Ms. Lopez scheduled two interviews, then nothing.', RH), 'person_name');
  assert.equal(piiReason('Mike from the agency promised a call that never came.', RH), 'person_name');
  assert.equal(piiReason('Recruiter Robert stopped answering after the client interview.', RH), 'person_name', 'first name that only LOOKS like the target');
  assert.equal(piiReason('A recruiter Robert Half assigned stopped replying after two weeks.', RH), null);
  assert.equal(piiReason('The applicant had three calls with a Robert Half recruiter and then heard nothing.', RH), null);
  assert.equal(piiReason('Someone from the agency said the role was filled; the applicant was rejected.', RH), null);
  assert.equal(piiReason('The applicant applied for a Senior Accountant role on Indeed and was ghosted.', RH), null);
});

test('validateAccounts drops PII in summary or role', () => {
  const results = [{ url: 'https://www.reddit.com/r/jobs/comments/aaa111/x/' }, { url: 'https://www.reddit.com/r/jobs/comments/bbb222/x/' }];
  const { kept, dropped } = validateAccounts([
    ACC({ source_url: results[0].url, summary: 'Their recruiter Sarah stopped replying after the client interview.' }),
    ACC({ source_url: results[1].url, role: 'Analyst (contact me: a@b.co)' }),
  ], results, RH);
  assert.equal(kept.length, 0);
  assert.deepEqual(dropped.map((d) => d.reason), ['pii_person_name', 'pii_email']);
});

// ---------- dedupe + rows ----------

test('dedupeAgainstExisting: by embedded URL, normalized summary, and reddit_imports for the same company', () => {
  const results = [
    { url: 'https://www.reddit.com/r/jobs/comments/aaa111/x/' }, { url: 'https://www.reddit.com/r/jobs/comments/bbb222/x/' },
    { url: 'https://www.reddit.com/r/jobs/comments/ccc333/x/' }, { url: 'https://www.reddit.com/r/jobs/comments/ddd444/x/' },
    { url: 'https://www.reddit.com/r/jobs/comments/eee555/x/' },
  ];
  const s = (n) => `The applicant number ${n} interviewed twice with the agency and then was rejected by email.`;
  const { kept } = validateAccounts(results.map((r, i) => ACC({ source_url: r.url, summary: s(i), outcome: 'rejected' })), results, RH);
  assert.equal(kept.length, 5);
  const existing = [
    { company_name: 'robert half', report_text: `old [Public reddit.com post: ${kept[0].url}]` },
    { company_name: 'robert half', report_text: s(1).toUpperCase() + '!!' },
  ];
  const imports = [
    { reddit_post_id: 't3_ccc333', company_name: 'robert half international', skipped: false },
    { reddit_post_id: 'ddd444', company_name: 'some other company', skipped: false },  // other company → not a dup
    { reddit_post_id: 't3_eee555', company_name: 'robert half', skipped: true },       // skipped → not a dup
  ];
  const { fresh, dupes } = dedupeAgainstExisting(kept, RH, existing, imports);
  assert.deepEqual(dupes.map((d) => d.reason), ['existing_url', 'existing_text', 'existing_reddit_import']);
  assert.deepEqual(fresh.map((f) => f.reddit.postId), ['ddd444', 'eee555']);
});

test('buildRow: reddit tier (0.3 trust, public-discussion label), attribution URL, never first-party', () => {
  const results = [{ url: 'https://old.reddit.com/r/recruitinghell/comments/1abcde/slug/' }];
  const { kept } = validateAccounts([ACC()], results, RH);
  const row = buildRow(kept[0], 'robert half');
  assert.equal(row.company_name, 'robert half');
  assert.equal(row.platform, 'Reddit r/recruitinghell');
  assert.equal(classifyPlatform(row.platform), 'reddit');
  assert.equal(SOURCE_TRUST[classifyPlatform(row.platform)], 0.3);
  assert.equal(isRedditSourced(row.platform), true, 'UI shows "Sourced from public discussion"');
  assert.equal(row.source, 'reddit');
  assert.equal(row.outcome_weight, 0.3);
  assert.equal(row.trust_reason, 'web_search_public_discussion');
  assert.equal(row.needs_review, false);
  assert.equal(buildRow(kept[0], 'robert half', { needsReview: true }).needs_review, true);
  assert.match(row.report_text, /\[Public reddit\.com post, posted 2025-03: https:\/\/www\.reddit\.com\/r\/recruitinghell\/comments\/1abcde\/\]$/);
  assert.ok(row.report_text.length <= 2000);
  assert.equal('user_id' in row, false);
});

test('non-reddit sources stay held: no honest label + low-trust tier exists for them today', () => {
  assert.equal(platformFor({ host: 'teamblind.com' }), 'Public web · teamblind.com');
  // classifyPlatform would score these as ingest (0.55) or direct (1.0) with no badge — the guard refuses.
  assert.equal(nonRedditWritable('glassdoor.com'), false);
  assert.equal(nonRedditWritable('someforum.com'), false);
});

test('processResults end-to-end over a fixture batch', () => {
  const targets = [RH, agencyTargets(['aerotek'])[0], agencyTargets(['kforce'])[0]];
  const requests = targets.map((t) => buildRequest(t));
  const results = new Map([
    [requests[0].custom_id, message(fixtureContent([ACC(), ACC({ source_url: 'https://www.reddit.com/r/jobs/comments/fake00/x/' })]))],
    [requests[1].custom_id, message(fixtureContent([ACC()]), 'pause_turn', 6)],
    [requests[2].custom_id, message([{ type: 'text', text: 'I could not find anything.' }], 'end_turn', 3)],
  ]);
  const { stats, perTarget } = processResults(targets, requests, results);
  assert.equal(stats.ok, 1);
  assert.equal(stats.incomplete, 1);
  assert.equal(stats.bad_json, 1);
  assert.equal(stats.searches, 11);
  assert.equal(stats.kept, 1);
  assert.equal(stats.dropped.url_not_retrieved_host_only, 1);
  assert.equal(perTarget[1].kept.length, 0, 'paused output is never harvested');
});
