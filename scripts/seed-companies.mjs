#!/usr/bin/env node
// Pre-warm the company_scores cache so launch-day pages are instant and non-empty.
//
// WHY: per-visitor scoring is now LLM-free — it serves cached rows or aggregates real reports,
// and shows "be the first to report" when there's no data. This script fills the cache AHEAD of
// launch for the companies real traffic will search, so those pages are rich and instant ($0 per
// visit thereafter). It just calls the live /api/reports endpoint per company; the server decides
// the data source:
//   • company already cached            -> skipped (fast)
//   • company has reports               -> aggregated grade, cached (no LLM)
//   • no reports + `anthropic_enabled` ON -> web-researched grade, cached (one-time bounded cost)
//   • no reports + flag OFF             -> stays "no data" (re-run after enabling the flag)
//
// To richly seed companies that have no reports yet, an admin flips the `anthropic_enabled`
// feature flag ON, runs this once, then flips it OFF — Anthropic as a bounded launch-prep tool,
// never a per-visitor dependency.
//
// Usage:
//   SEED_BASE_URL=https://seenjobs.io node scripts/seed-companies.mjs
//   SEED_CONCURRENCY=3 node scripts/seed-companies.mjs
//
// Audience note: this product serves ALL job seekers, so the list leans HARD into everyday
// employers (retail, fast food, healthcare, logistics, call centers, gig) — not just big tech.

const BASE = (process.env.SEED_BASE_URL || 'https://seenjobs.io').replace(/\/$/, '');
const CONCURRENCY = Math.max(1, Math.min(6, parseInt(process.env.SEED_CONCURRENCY || '3', 10)));
const DELAY_MS = parseInt(process.env.SEED_DELAY_MS || '400', 10);

const COMPANIES = [
  // ── Retail / grocery / big-box (highest everyday volume) ──
  'Walmart', 'Target', 'Costco', 'Kroger', 'Albertsons', 'Safeway', 'Publix', 'Aldi', 'Trader Joe\'s',
  'Whole Foods', 'Sam\'s Club', 'Home Depot', 'Lowe\'s', 'Best Buy', 'Macy\'s', 'Nordstrom', 'Kohl\'s',
  'TJ Maxx', 'Ross Stores', 'Dollar General', 'Dollar Tree', 'Family Dollar', 'CVS', 'Walgreens',
  'Rite Aid', 'Ulta Beauty', 'Sephora', 'IKEA', 'Wayfair', 'Gap', 'Old Navy', 'Nike', 'Lululemon',
  // ── Fast food / restaurants ──
  'McDonald\'s', 'Starbucks', 'Chick-fil-A', 'Chipotle', 'Taco Bell', 'Wendy\'s', 'Burger King',
  'Subway', 'Dunkin', 'Domino\'s', 'Pizza Hut', 'Panera Bread', 'Olive Garden', 'Texas Roadmouse',
  'In-N-Out', 'Raising Cane\'s', 'Panda Express', 'Sonic', 'Popeyes', 'KFC', 'Five Guys', 'Cheesecake Factory',
  // ── Logistics / warehouse / delivery / gig ──
  'Amazon', 'UPS', 'FedEx', 'USPS', 'DHL', 'XPO Logistics', 'Uber', 'Lyft', 'DoorDash', 'Instacart',
  'Grubhub', 'Uber Eats', 'Shipt', 'Aramark', 'Sysco',
  // ── Healthcare / pharmacy / senior care ──
  'Kaiser Permanente', 'HCA Healthcare', 'CVS Health', 'UnitedHealth Group', 'Cigna', 'Humana',
  'Anthem', 'Elevance Health', 'Tenet Healthcare', 'Encompass Health', 'DaVita', 'Fresenius',
  'Brookdale Senior Living', 'Concentra', 'LabCorp', 'Quest Diagnostics',
  // ── Call center / BPO / staffing ──
  'Concentrix', 'Teleperformance', 'TTEC', 'Alorica', 'Sitel', 'Robert Half', 'Adecco', 'Randstad',
  'Kelly Services', 'ManpowerGroup', 'Aerotek', 'Insight Global',
  // ── Hospitality / travel ──
  'Marriott', 'Hilton', 'Hyatt', 'Disney', 'Delta Air Lines', 'United Airlines', 'American Airlines',
  'Southwest Airlines', 'Enterprise Rent-A-Car',
  // ── Banks / finance / insurance ──
  'JPMorgan Chase', 'Bank of America', 'Wells Fargo', 'Citi', 'Capital One', 'American Express',
  'USAA', 'State Farm', 'Geico', 'Progressive', 'Allstate', 'Fidelity', 'Charles Schwab',
  // ── Telecom / utilities ──
  'AT&T', 'Verizon', 'T-Mobile', 'Comcast', 'Spectrum', 'Cox Communications',
  // ── Manufacturing / auto / industrial ──
  'Tesla', 'Ford', 'General Motors', 'Toyota', 'Boeing', 'Lockheed Martin', 'Caterpillar', 'John Deere',
  'General Electric', '3M', 'Honeywell', 'Procter & Gamble', 'PepsiCo', 'Coca-Cola', 'Nestle',
  // ── Consulting / professional services (high ghost-rate searches) ──
  'Deloitte', 'PwC', 'EY', 'KPMG', 'Accenture', 'McKinsey', 'Boston Consulting Group', 'Bain',
  'Booz Allen Hamilton', 'Cognizant', 'Infosys', 'TCS', 'Capgemini', 'Wipro',
  // ── Big tech / software (still searched a lot) ──
  'Google', 'Microsoft', 'Apple', 'Meta', 'Netflix', 'Amazon Web Services', 'Oracle', 'IBM', 'Intel',
  'Salesforce', 'Adobe', 'SAP', 'Cisco', 'Dell', 'HP', 'Nvidia', 'Qualcomm', 'PayPal', 'Stripe',
  'Shopify', 'Snowflake', 'Palantir', 'Uber', 'Airbnb', 'Coinbase', 'Robinhood', 'Snap', 'Pinterest',
  'Reddit', 'Spotify', 'Zoom', 'Slack', 'Atlassian', 'ServiceNow', 'Workday', 'Intuit', 'Block',
  // ── Job boards / staffing platforms (meta — people search these too) ──
  'Indeed', 'LinkedIn', 'ZipRecruiter', 'Glassdoor',
];

// Optionally merge in names from a file (one per line) — e.g. companies pulled from the DB.
// The curated list goes FIRST so the best-known brands are seeded before the long tail.
import { readFileSync } from 'node:fs';
let FILE_NAMES = [];
if (process.env.SEED_NAMES_FILE) {
  try { FILE_NAMES = readFileSync(process.env.SEED_NAMES_FILE, 'utf8').split('\n').map(s => s.trim()).filter(Boolean); }
  catch (e) { console.error('Could not read SEED_NAMES_FILE:', e.message); }
}

// De-dupe (case-insensitive) while preserving order.
const SEEN = new Set();
const LIST = [...COMPANIES, ...FILE_NAMES].filter(c => {
  const k = c.toLowerCase().trim();
  if (SEEN.has(k)) return false;
  SEEN.add(k);
  return true;
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function seedOne(name) {
  try {
    const res = await fetch(`${BASE}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
      signal: AbortSignal.timeout(40000),
    });
    const data = await res.json().catch(() => ({}));
    if (data.no_data) return { name, status: 'no_data' };
    if (data.score) return { name, status: data._src || 'ok', score: data.score.overall_score, src: data._src };
    return { name, status: `http_${res.status}` };
  } catch (e) {
    return { name, status: 'error', error: e.message };
  }
}

// Normalize a name for dedupe (matches the server's lowercase + legal-suffix strip).
const norm = s => String(s || '').trim().toLowerCase()
  .replace(/[\s,]+(inc|llc|corp|ltd|co|plc|group|holdings|enterprises|solutions|technologies)\.?$/i, '').trim();

// Pull the companies we ALREADY have scored (public leaderboard) so we never spend a cent
// re-researching data we already hold. Returns a Set of normalized names.
async function fetchExisting() {
  try {
    const res = await fetch(`${BASE}/api/reports`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'leaderboard' }), signal: AbortSignal.timeout(30000),
    });
    const data = await res.json().catch(() => ({}));
    return new Set((data.companies || []).map(c => norm(c.name)).filter(Boolean));
  } catch { return new Set(); }
}

async function main() {
  const have = await fetchExisting();
  const todo = LIST.filter(c => !have.has(norm(c)));
  const skipped = LIST.length - todo.length;
  console.log(`${LIST.length} targets · ${skipped} already cached → SKIPPED ($0) · ${todo.length} to check via ${BASE}\n`);

  if (process.env.SEED_DRY_RUN === '1') {
    console.log('DRY RUN — companies that would be checked (only ones with NO reports cost an AI call):');
    console.log(todo.join(', '));
    console.log(`\nMax possible AI calls: ${todo.length} (fewer in practice — any with reports aggregate for free).`);
    return;
  }

  const results = [];
  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    const batch = todo.slice(i, i + CONCURRENCY);
    const batchRes = await Promise.all(batch.map(seedOne));
    for (const r of batchRes) {
      results.push(r);
      const tag = r.score != null ? `grade ${r.score} (${r.src})` : r.status;
      console.log(`  ${r.name.padEnd(28)} ${tag}`);
    }
    if (i + CONCURRENCY < todo.length) await sleep(DELAY_MS);
  }

  // The ONLY spend is companies that were actually web-researched (src not cache/reports).
  const paid   = results.filter(r => r.src && r.src !== 'cache' && r.src !== 'reports').length;
  const free   = results.filter(r => r.src === 'cache' || r.src === 'reports').length;
  const noData = results.filter(r => r.status === 'no_data').length;
  const errors = results.filter(r => r.status === 'error' || (r.status || '').startsWith('http_')).length;
  console.log(`\nDone. ${skipped} already had ($0) · ${free} free aggregate/cache · ${paid} newly web-researched (the ONLY $) · ${noData} no-data · ${errors} errors`);
}

main();
