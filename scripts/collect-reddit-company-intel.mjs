#!/usr/bin/env node
// Mac-local raw Reddit collection. Uses OpenCLI + the real browser; never runs on Vercel.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { classifyRawRedditExcerpt, flattenRedditRead, unwrapOpenCli } from '../lib/server/redditIntelCollector.js';
import { censorExcerpt } from '../lib/server/companyIntelImport.js';

const exec = promisify(execFile);
const token = process.env.SEEN_COMPANY_INTEL_INGEST_TOKEN;
const base = (process.env.SEEN_COMPANY_INTEL_INGEST_URL || 'https://seenjobs.io/api/ingest-local-company-intel').replace(/\/api\/ingest-local-company-intel$/, '');
const targetCount = Math.min(100, Math.max(1, Number(process.env.COMPANY_INTEL_COMPANY_LIMIT) || 10));
const postLimit = Math.min(10, Math.max(1, Number(process.env.COMPANY_INTEL_POSTS_PER_COMPANY) || 3));
const dryRun = process.argv.includes('--dry-run');
if (!token) throw new Error('Set SEEN_COMPANY_INTEL_INGEST_TOKEN first.');

async function opencli(args) {
  const { stdout } = await exec('opencli', args, { maxBuffer: 10 * 1024 * 1024, timeout: 90000 });
  const parsed = JSON.parse(stdout);
  if (parsed?.ok === false) throw new Error(parsed?.error?.message || 'OpenCLI command failed');
  return unwrapOpenCli(parsed);
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
const targets = await getJson(`/api/local-company-intel-targets?limit=${targetCount}`);
for (const target of targets.companies || []) {
  let posts = [];
  try { posts = await opencli(['reddit', 'search', jobQuery(target.company), '--sort', 'relevance', '--time', 'year', '--limit', String(postLimit), '-f', 'json']); }
  catch (error) { console.warn(`[skip] ${target.company}: search failed: ${error.message}`); continue; }
  for (const post of Array.isArray(posts) ? posts : []) {
    const id = post.id || String(post.url || '').match(/comments\/([a-z0-9]+)/i)?.[1];
    const sourceUrl = String(post.url || post.permalink || '');
    if (!id || !sourceUrl) continue;
    try {
      const read = await opencli(['reddit', 'read', id, '--limit', '12', '--depth', '1', '--max-length', '700', '-f', 'json']);
      for (const entry of flattenRedditRead(read)) {
        const excerpt = censorExcerpt(entry.text);
        if (excerpt.length < 40) continue;
        const url = entry.url || sourceUrl;
        const key = `${target.company.toLowerCase()}\n${url}\n${excerpt.toLowerCase()}`;
        if (sourceSeen.has(key)) continue;
        sourceSeen.add(key);
        rawItems.push({ company: target.company, source: `Reddit r/${post.subreddit || 'unknown'}`, source_url: url, excerpt, ...classifyRawRedditExcerpt(excerpt), year: String(new Date().getFullYear()) });
      }
    } catch (error) { console.warn(`[skip] ${target.company} post ${id}: ${error.message}`); }
  }
  console.log(`[collect] ${target.company}: ${rawItems.filter(i => i.company === target.company).length} raw excerpts`);
}
const summary = { ok: true, targets: (targets.companies || []).length, collected: rawItems.length, dry_run: dryRun, imported_reports: 0, commentary: 0, duplicates: 0, rejected: 0 };
if (!dryRun) for (let i = 0; i < rawItems.length; i += 50) {
  const result = await postJson(rawItems.slice(i, i + 50));
  for (const key of ['imported_reports', 'commentary', 'duplicates', 'rejected']) summary[key] += Number(result[key] || 0);
}
console.log(JSON.stringify(summary, null, 2));
