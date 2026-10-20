#!/usr/bin/env node
// One command that answers "can the credit jobs run here?" before any money is spent.
//   node scripts/credit/preflight.mjs
// Checks: env vars present (values never printed), Anthropic key works + a 1-request batch is
// accepted (cost ≈ $0.0001), Supabase reachable with the service key, Reddit + Arctic Shift
// reachable, and the current spend ledger.

import { CREDIT_KEY_ENV, MODELS, budgetUsd, client, creditApiKey, readLedger, sb } from './lib/batch.mjs';

const UA = 'SeenJobs/1.0 RSS reader (+https://seenjobs.io)';
const rows = [];
const mark = (name, ok, detail = '') => { rows.push({ name, ok, detail }); };

async function check(name, fn) {
  try { const d = await fn(); mark(name, true, d || ''); }
  catch (e) { mark(name, false, String(e.message || e).slice(0, 160)); }
}

mark(`env ${CREDIT_KEY_ENV} (or ANTHROPIC_API_KEY locally)`, !!creditApiKey(), creditApiKey() ? 'set' : 'MISSING');
for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY']) mark(`env ${k}`, !!process.env[k], process.env[k] ? 'set' : 'MISSING');

await check('anthropic: key valid + Haiku 5.5 answers', async () => {
  const m = await (await client()).messages.create({ model: MODELS.cheap, max_tokens: 16, messages: [{ role: 'user', content: 'Reply with: ok' }] });
  return `stop=${m.stop_reason}, model=${m.model}`;
});
await check('anthropic: batch endpoint accepts a request', async () => {
  const b = await (await client()).messages.batches.create({ requests: [{ custom_id: 'preflight', params: { model: MODELS.cheap, max_tokens: 16, messages: [{ role: 'user', content: 'Reply with: ok' }] } }] });
  return `batch ${b.id} ${b.processing_status} (left to finish; costs a fraction of a cent)`;
});
await check('supabase: service key reads company_scores', async () => {
  const r = await sb('company_scores?select=company_name&limit=1');
  return `${r.length} row`;
});
await check('supabase: jobs readable', async () => {
  const r = await sb('jobs?select=id&limit=1');
  return `${r.length} row`;
});
for (const [name, url] of [
  ['reddit www search rss', 'https://www.reddit.com/r/recruitinghell/search.rss?q=insight+global&restrict_sr=on&sort=relevance&t=all'],
  ['reddit old search rss', 'https://old.reddit.com/r/recruitinghell/search.rss?q=insight+global&restrict_sr=on&sort=relevance&t=all'],
  ['arctic shift api', 'https://arctic-shift.photon-reddit.com/api/posts/search?subreddit=recruitinghell&limit=1'],
]) {
  await check(name, async () => {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    const t = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return `HTTP ${r.status}, ${t.length} bytes`;
  });
}
const l = readLedger();
mark('spend ledger', true, `$${l.spentUsd.toFixed(2)} spent of $${budgetUsd()} budget`);

for (const r of rows) console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
const required = rows.filter((r) => /^env (CREDIT_ANTHROPIC|SUPABASE_URL|SUPABASE_SERVICE)|^anthropic|^supabase/.test(r.name));
const redditOk = rows.some((r) => /reddit/.test(r.name) && r.ok);
console.log(`\nCore (keys + DB): ${required.every((r) => r.ok) ? 'READY' : 'BLOCKED'} · Reddit fetch: ${redditOk ? 'available' : 'BLOCKED — use web-reports.mjs instead'}`);
if (!required.every((r) => r.ok)) process.exitCode = 1;
