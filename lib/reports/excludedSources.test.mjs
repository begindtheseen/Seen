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
