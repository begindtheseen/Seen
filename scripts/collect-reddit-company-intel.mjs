#!/usr/bin/env node
// Mac-local raw Reddit collection. Uses OpenCLI + the real browser; never runs on Vercel.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { classifyRawRedditExcerpt, flattenRedditRead, unwrapOpenCli, opencliFailure } from '../lib/server/redditIntelCollector.js';
import { censorExcerpt } from '../lib/server/companyIntelImport.js';
import { storableAccount, outcomeSentiment, isCompanySubreddit } from '../lib/reports/applicantRules.js';
import { rankAndFilter } from '../api/_utils/companyReddit.js';

const exec = promisify(execFile);
const token = process.env.SEEN_COMPANY_INTEL_INGEST_TOKEN;
const base = (process.env.SEEN_COMPANY_INTEL_INGEST_URL || 'https://seenjobs.io/api/ingest-local-company-intel').replace(/\/api\/ingest-local-company-intel$/, '');
const targetCount = Math.min(100, Math.max(1, Number(process.env.COMPANY_INTEL_COMPANY_LIMIT) || 10));
const postLimit = Math.min(10, Math.max(1, Number(process.env.COMPANY_INTEL_POSTS_PER_COMPANY) || 3));
const dryRun = process.argv.includes('--dry-run');
if (!token) throw new Error('Set SEEN_COMPANY_INTEL_INGEST_TOKEN first.');
// Optional explicit targets (Seen Command's company picker): a JSON array of up to 100 company names.
// Without it, Seen chooses (its most active existing companies). Either way the import sends
// require_existing: true, so a name Seen does not already know is rejected, never created.
const explicitTargets = (() => {
  const raw = process.env.COMPANY_INTEL_COMPANIES_JSON;
  if (!raw) return null;
  let list;
  try { list = JSON.parse(raw); } catch { throw new Error('COMPANY_INTEL_COMPANIES_JSON must be a JSON array of company names.'); }
  if (!Array.isArray(list)) throw new Error('COMPANY_INTEL_COMPANIES_JSON must be a JSON array of company names.');
  const names = [...new Set(list.map(n => String(n || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120)).filter(Boolean))];
  if (!names.length || names.length > 100) throw new Error('COMPANY_INTEL_COMPANIES_JSON must name 1–100 companies.');
  return names;
})();

async function opencli(args) {
  let stdout;
  try { ({ stdout } = await exec('opencli', args, { maxBuffer: 10 * 1024 * 1024, timeout: 90000 })); }
  catch (error) { throw new Error(opencliFailure(error)); }
  const parsed = JSON.parse(stdout);
  if (parsed?.ok === false) throw new Error(parsed?.error?.message || 'OpenCLI command failed');
  return unwrapOpenCli(parsed);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Reddit throttles a browser that searches back to back: on 2026-10-20 a 25-company run had its
// first 5 searches answered and the next 20 fail. Space searches out, and give a failed one a
// single second try after a longer pause. COMPANY_INTEL_SEARCH_GAP_MS tunes the gap (0 in tests).
const SEARCH_GAP_MS = Math.max(0, Number(process.env.COMPANY_INTEL_SEARCH_GAP_MS ?? 4000));
const RETRY_PAUSE_MS = SEARCH_GAP_MS ? Math.max(15000, SEARCH_GAP_MS * 4) : 0;
async function searchWithRetry(args) {
  try { return await opencli(args); }
  catch (first) {
    console.warn(`[retry] search failed once, waiting ${Math.round(RETRY_PAUSE_MS / 1000)}s: ${String(first.message).split('\n')[0].slice(0, 200)}`);
    await sleep(RETRY_PAUSE_MS);
    return await opencli(args);
  }
}
const getJson = async (path) => {
  const response = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} failed (${response.status}): ${body.error || 'unknown error'}`);
  return body;
};
const postJson = async (items) => {
  const response = await fetch(`${base}/api/ingest-local-company-intel`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ items, require_existing: true }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`ingest failed (${response.status}): ${body.error || 'unknown error'}`);
  return body;
};
const jobQuery = company => `"${company}" (interview OR hiring OR recruiter OR ghosted OR workplace)`;
const rawItems = [], sourceSeen = new Set();
const targets = explicitTargets
  ? { companies: explicitTargets.map(company => ({ company })) }
  : await getJson(`/api/local-company-intel-targets?limit=${targetCount}`);
console.log(`[targets] ${explicitTargets ? 'chosen' : 'from Seen'}: ${(targets.companies || []).length}`);
let searched = 0;
for (const target of targets.companies || []) {
  let posts = [];
  if (searched++ > 0 && SEARCH_GAP_MS) await sleep(SEARCH_GAP_MS + Math.floor(Math.random() * 1500));
  try { posts = await searchWithRetry(['reddit', 'search', jobQuery(target.company), '--sort', 'relevance', '--time', 'year', '--limit', String(postLimit), '-f', 'json']); }
  catch (error) { console.warn(`[skip] ${target.company}: search failed: ${error.message}`); continue; }
  // Search engines occasionally return a word collision (for example, a product rather than
  // an employer). Keep only threads that actually name this company in an employment context.
  const relevantPosts = rankAndFilter((Array.isArray(posts) ? posts : []).map(post => ({
    ...post, permalink: post.url || post.permalink || '', _body: post.selftext || '',
  })), target.company, postLimit);
  for (const post of relevantPosts) {
    const id = post.id || String(post.url || '').match(/comments\/([a-z0-9]+)/i)?.[1];
    const sourceUrl = String(post.url || post.permalink || '');
    if (!id || !sourceUrl) continue;
    try {
      const read = await opencli(['reddit', 'read', id, '--limit', '12', '--depth', '1', '--max-length', '700', '-f', 'json']);
      const opBody = String(post.selftext || '').replace(/\s+/g, ' ').trim();
      const context = { title: String(post.title || '').slice(0, 300), company_sub: isCompanySubreddit(post.subreddit, [target.company]) };
      for (const entry of flattenRedditRead(read)) {
        const text = censorExcerpt(entry.text);
        if (text.length < 40) continue;
        const url = entry.url || sourceUrl;
        // The opening post is the post's own text; everything else read is a comment.
        // (The read output may cut the post at --max-length, so compare openings.)
        const isOp = !!opBody && (entry.text === opBody || opBody.startsWith(entry.text.slice(0, 160)) || entry.text.startsWith(opBody.slice(0, 160)));
        // A first-hand applicant account only under Seen's strict rules (lib/reports/applicantRules.js),
        // with the stored words chosen so Seen's server-side re-check passes; anything else is commentary.
        const account = storableAccount(text, { names: [target.company], title: context.title, isOp, inCompanySub: context.company_sub });
        const excerpt = account ? account.excerpt : text;
        const key = `${target.company.toLowerCase()}\n${url}\n${excerpt.toLowerCase()}`;
        if (sourceSeen.has(key)) continue;
        sourceSeen.add(key);
        const raw = classifyRawRedditExcerpt(text);
        const kind = account ? { kind: 'applicant_outcome', outcome: account.outcome, sentiment: outcomeSentiment(account.outcome) }
          : { kind: raw.kind === 'employee_review' ? 'employee_review' : 'public_commentary', sentiment: raw.sentiment };
        rawItems.push({ company: target.company, source: `Reddit r/${String(post.subreddit || 'unknown').replace(/^\/?r\//i, '')}`, source_url: url, excerpt, ...kind,
          ...(post.created_utc ? { posted: new Date(Number(post.created_utc) * 1000).toISOString() } : { year: String(new Date().getFullYear()) }),
          context: { ...context, is_op: isOp } });
      }
    } catch (error) { console.warn(`[skip] ${target.company} post ${id}: ${error.message}`); }
  }
  console.log(`[collect] ${target.company}: ${rawItems.filter(i => i.company === target.company).length} raw excerpts`);
}
const summary = { ok: true, targets: (targets.companies || []).length, collected: rawItems.length, dry_run: dryRun, imported_reports: 0, commentary: 0, duplicates: 0, rejected: 0, rejection_reasons: [] };
if (!dryRun) for (let i = 0; i < rawItems.length; i += 50) {
  const result = await postJson(rawItems.slice(i, i + 50));
  for (const key of ['imported_reports', 'commentary', 'duplicates', 'rejected']) summary[key] += Number(result[key] || 0);
  // Seen says why it rejected items (distinct reasons); keep them so a rejected total is never a mystery.
  for (const reason of Array.isArray(result.errors) ? result.errors : []) {
    if (summary.rejection_reasons.length < 10 && !summary.rejection_reasons.includes(String(reason))) summary.rejection_reasons.push(String(reason).slice(0, 160));
  }
}
console.log(JSON.stringify(summary, null, 2));
