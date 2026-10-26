// Run: node --test lib/reports/excludedSources.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { excludedSource } from './excludedSources.js';

test('the owner-excluded sources, under any subdomain or country domain; everything else is allowed', () => {
  for (const u of ['https://news.ycombinator.com/item?id=1', 'https://hn.algolia.com/api/v1/search', 'https://www.glassdoor.com/Interview/x.htm', 'https://clear.glassdoor.nl/x',
    'https://static.glassdoor.com.br/x', 'https://ca.indeed.com/cmp/x/interviews', 'https://www.linkedin.com/posts/x', 'https://m.facebook.com/x', 'https://x.com/a/status/1', 'https://www.tiktok.com/@a'])
    assert.ok(excludedSource(u), u);
  for (const u of ['https://www.reddit.com/r/jobs/1', 'https://forum.example.org/t/1', 'https://www.quora.com/x', 'https://indeedjobs.example.com/x', 'https://notx.com/a', 'not a url'])
    assert.equal(excludedSource(u), null, u);
});

test('live research prompts (api/reports.js) never send the model to an excluded source', async () => {
  const { readFileSync } = await import('node:fs');
  const { EXCLUDED_SEARCH_DOMAINS, excludedSource: ex } = await import('./excludedSources.js');
  const src = readFileSync(new URL('../../api/reports.js', import.meta.url), 'utf8');
  // every web-search tool definition blocks the excluded domains at the search itself
  const tools = src.match(/type: 'web_search_\d+', name: 'web_search'[^}]*\}/g) || [];
  assert.ok(tools.length >= 3, 'the research calls are still found');
  for (const t of tools) assert.match(t, /blocked_domains: EXCLUDED_SEARCH_DOMAINS/);
  for (const d of EXCLUDED_SEARCH_DOMAINS) assert.ok(ex(`https://${d}/x`), d);
  // no prompt asks for Glassdoor / Indeed / LinkedIn as a place to search or quote
  const prompts = src.match(/(system|content): [`'][^`']*/g) || [];
  for (const p of prompts) {
    const asked = p.replace(/Never use [^.]*\./g, '');
    assert.doesNotMatch(asked, /glassdoor|indeed|linkedin/i, asked.slice(0, 120));
  }
});
