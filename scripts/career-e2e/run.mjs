#!/usr/bin/env node
// End-to-end test of the career-site collector (scripts/collect-career-site.mjs) in a REAL Chromium:
// fixture career sites (sites.mjs, one per real-world pattern) → the real collector and in-page agent
// (lib/server/careerAgent.js) → a stand-in `opencli` (browserd.mjs drives Chromium) → a stand-in Seen
// ingest that runs Seen's REAL posting checks (lib/jobs/careerSite.js rowFromPosting) and records every
// job it is sent, so a duplicate or a job abroad is caught.
//
// usage: node scripts/career-e2e/run.mjs [case …]   (needs openssl + Chromium at /opt/pw-browsers/chromium)
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { startSites, usCount, usMatching } from './sites.mjs';
import { rowFromPosting } from '../../lib/jobs/careerSite.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const tmp = mkdtempSync(join(tmpdir(), 'career-e2e-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=fixture', '-keyout', join(tmp, 'k.pem'), '-out', join(tmp, 'c.pem')], { stdio: 'ignore' });
const BASE = 20000 + Math.floor(Math.random() * 20000); // fresh ports every run (a stale run can never hold them)
const SITE_PORT = BASE, BROWSER_PORT = BASE + 1, INGEST_PORT = BASE + 2;
const sites = await startSites({ port: SITE_PORT, key: readFileSync(join(tmp, 'k.pem')), cert: readFileSync(join(tmp, 'c.pem')) });

// Stand-in Seen: real checks, a record of every job sent.
const received = new Map(); // company → { keys: Map(key → count), saved, skipped }
const ingest = http.createServer(async (req, res) => {
  let b = ''; for await (const c of req) b += c;
  const body = JSON.parse(b || '{}');
  const rec = received.get(body.company) || { keys: new Map(), saved: 0, skipped: {}, abroad: 0 };
  received.set(body.company, rec);
  let saved = 0; const skipped = {};
  for (const it of body.items || []) {
    const key = it.posting?.url || it.page_url;
    rec.keys.set(key, (rec.keys.get(key) || 0) + 1);
    const u = new URL(it.page_url);
    const r = rowFromPosting(it.posting, { company: body.company, pageUrl: u.toString(), host: u.hostname });
    if (r.skip) { skipped[r.skip] = (skipped[r.skip] || 0) + 1; if (/market|us|country|abroad/i.test(r.skip)) rec.abroad++; continue; }
    saved++;
  }
  rec.saved += saved; for (const [k, n] of Object.entries(skipped)) rec.skipped[k] = (rec.skipped[k] || 0) + n;
  res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, saved, skipped }));
}).listen(INGEST_PORT, '127.0.0.1');

const browserd = spawn(process.execPath, [join(HERE, 'browserd.mjs'), String(BROWSER_PORT), String(SITE_PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve, reject) => { browserd.stdout.on('data', (d) => { if (/ready/.test(String(d))) resolve(); }); browserd.on('exit', (c) => reject(new Error(`browserd exited (${c})`))); });
process.on('exit', () => { try { browserd.kill(); } catch { /* gone */ } });

const CASES = {
  volt: { t: { company: 'Volt Motors', website: 'voltmotors.com' }, want: usCount('volt'), why: 'landing → Search jobs → JS list paged by a Next button (feed replay)' },
  paged: { t: { company: 'Paged Works', url: 'https://www.pagedworks.com/jobs/' }, want: usCount('paged'), why: 'server pages ?page=N with rel=next; a failed read recovered by pass 2' },
  more: { t: { company: 'More Button Co', url: 'https://www.morebuttonco.com/careers/openings' }, want: usCount('more'), why: '"Load more" + job text rendered in JS' },
  scroll: { t: { company: 'Scroll Co', url: 'https://www.scrollco.com/careers/jobs' }, want: usCount('scroll'), why: 'infinite scroll' },
  acme: { t: { company: 'Acme Robotics', website: 'acmerobotics.com' }, want: usCount('acme'), why: 'landing links out to Workday' },
  spa: { t: { company: 'Spa Works', url: 'https://www.spaworks.com/careers' }, want: usCount('spa'), why: 'SPA: Country dropdown + Search button, POST API replayed page by page' },
  spa_kw: { t: { company: 'Spa Works', url: 'https://www.spaworks.com/careers', keywords: 'engineer' }, want: usMatching('spa', 'engineer'), why: 'SPA: keywords typed into a form-less search box' },
  facet: { t: { company: 'Facet Co', url: 'https://www.facetco.com/jobs' }, want: usCount('facet'), why: 'collapsed Location filter → "United States (n)" checkbox; numbered pages' },
  facet_kw: { t: { company: 'Facet Co', url: 'https://www.facetco.com/jobs', keywords: 'technician' }, want: usMatching('facet', 'technician'), why: 'Enter-to-search box (no form) + checkbox filter' },
  ahead: { t: { company: 'Ahead Co', url: 'https://www.aheadco.com/careers' }, want: usCount('ahead'), why: 'location type-ahead suggestion + Find jobs + Load more' },
  ahead_kw: { t: { company: 'Ahead Co', url: 'https://www.aheadco.com/careers', keywords: 'analyst' }, want: usMatching('ahead', 'analyst'), why: 'keywords + type-ahead location together' },
};
const pick = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(CASES);

function collect(target) {
  return new Promise((resolve) => {
    const env = { ...process.env, PATH: `${HERE}:${process.env.PATH}`, E2E_BROWSERD_PORT: String(BROWSER_PORT), SEEN_LOCAL_INGEST_TOKEN: 'e2e',
      SEEN_LOCAL_INGEST_URL: `http://127.0.0.1:${INGEST_PORT}/api/ingest-local-indeed`, CAREER_SITE_TARGETS_JSON: JSON.stringify([target]),
      CAREER_SITE_POLL_MS: '300', CAREER_SITE_RENDER_MS: '700', CAREER_SITE_MINUTES: process.env.E2E_MINUTES || '15' };
    const p = spawn(process.execPath, [join(ROOT, 'scripts', 'collect-career-site.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; if (process.env.E2E_VERBOSE) process.stdout.write(d); }); p.stderr.on('data', (d) => { err += d; if (process.env.E2E_VERBOSE) process.stderr.write(d); });
    p.on('close', (code) => { const i = out.lastIndexOf('\n{'); let summary = null; try { summary = JSON.parse(out.slice(i + 1)); } catch { /* ignore */ } resolve({ code, summary, log: out.slice(0, i), err }); });
  });
}

let failures = 0;
for (const name of pick) {
  const c = CASES[name]; received.delete(c.t.company);
  const t0 = Date.now();
  const r = await collect(c.t);
  const rec = received.get(c.t.company) || { keys: new Map(), saved: 0, skipped: {}, abroad: 0 };
  const dupes = [...rec.keys.values()].filter((n) => n > 1).length;
  const site = r.summary?.sites?.[0] || {};
  const ok = rec.saved === c.want && dupes === 0 && rec.abroad === 0 && site.complete === true;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name.padEnd(9)} saved ${rec.saved}/${c.want} · dupes ${dupes} · abroad sent ${rec.abroad} · complete ${site.complete} · ${site.method || '-'} · ${Math.round((Date.now() - t0) / 1000)}s — ${c.why}`);
  if (site.filters?.length) console.log(`          filters: ${JSON.stringify(site.filters)}`);
  if (!ok) console.log(`          missing: ${JSON.stringify(site.missing)} errors: ${JSON.stringify(site.errors)} notes: ${JSON.stringify(site.notes)} skipped: ${JSON.stringify(rec.skipped)} listed ${site.listed} of site ${site.site_total}\n${r.err.slice(-600)}`);
}
browserd.kill(); ingest.close(); sites.close();
console.log(failures ? `${failures} case(s) failed` : 'all cases passed');
process.exit(failures ? 1 : 0);
