import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, safeHref } from './escapeHtml.js';

test('escapeHtml escapes every character that can leave text or a quoted attribute', () => {
  assert.equal(escapeHtml(`<a href="x" onclick='y'>&</a>`), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(0), '0');
});

test('safeHref keeps http(s) links only, escaped', () => {
  assert.equal(safeHref('javascript:alert(1)'), '');
  assert.equal(safeHref('data:text/html,<b>'), '');
  assert.equal(safeHref('/relative'), '');
  assert.equal(safeHref('https://x.com/a?b=1&c="2"'), 'https://x.com/a?b=1&amp;c=%222%22');
  assert.equal(safeHref(' http://x.com/" onmouseover="y '), 'http://x.com/%22%20onmouseover=%22y');
});
