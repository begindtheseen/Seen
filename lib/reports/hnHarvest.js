// Free applicant-report harvester over Hacker News (the official Algolia search API — public, no key, no
// spend). Strong for tech employers, near-empty for retail and restaurants (live 2026-10-20: Amazon and
// Google ~70 first-hand accounts each from ~2,000 comments; Chipotle 0, Home Depot 1).
//
// Per company and applicant term ("Amazon" interview, "Amazon" offer…), newest relevance pages first:
// every comment and Ask-HN post text through the strict rules (lib/reports/applicantRules.js), with the
// story title as context. One account per person per story. Same goal contract as archiveHarvest.js: when
// onAccounts returns a number (reports Seen newly accepted) the goal counts those; otherwise accounts found.
// Tests: lib/reports/hnHarvest.test.mjs (fake API).

import { storableAccount, namePattern } from './applicantRules.js';

export const HN_API = 'https://hn.algolia.com/api/v1/search';
export const HN_TERMS = ['interview', 'interviewed', 'offer', 'recruiter', 'ghosted', 'rejected', 'hired', 'applied', 'onsite', 'phone screen'];

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
// HN's HTML to plain text in ONE pass: tags are skipped by a scanner (not a regex "sanitizer"), and each
// entity is decoded exactly once, so "&amp;lt;" stays "&lt;" (no double unescape).
export function hnText(html) {
  const s = String(html || '');
  let out = ''; let inTag = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inTag) { if (ch === '>') { inTag = false; out += ' '; } continue; }
    if (ch === '<') { inTag = true; continue; }
    out += ch;
  }
  return out.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' '; }
    return Object.prototype.hasOwnProperty.call(ENTITIES, e.toLowerCase()) ? ENTITIES[e.toLowerCase()] : m;
  }).replace(/\s+/g, ' ').trim();
}

export async function harvestHackerNews(company, {
  fetchImpl = (...a) => fetch(...a), goal = 10, deadlineAt = Infinity, onAccounts = async () => {}, log = () => {},
  now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), intervalMs = 400, maxPages = 5, terms = HN_TERMS,
  seenIds = new Set(),
} = {}) {
  const out = { company, source: 'hackernews', found: 0, newReports: null, searches: 0, failedSearches: 0, searchErrors: [], itemsRead: 0, exhausted: false, stoppedBy: null };
  if (!namePattern([company])) { out.stoppedBy = 'unsearchable_name'; return out; }
  const done = () => goal > 0 && (out.newReports ?? out.found) >= goal;
  const voices = new Set();
  for (const term of terms) {
    for (let page = 0; page < maxPages; page++) {
      if (done()) { out.stoppedBy = 'goal'; return out; }
      if (now() >= deadlineAt) { out.stoppedBy = 'time'; return out; }
      out.searches++;
      const url = `${HN_API}?${new URLSearchParams({ query: `"${company}" ${term}`, tags: '(story,comment)', hitsPerPage: '100', page: String(page) })}`;
      let body = null; let why = null;
      try {
        const r = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
        if (r.ok) body = await r.json(); else why = `http_${r.status}`;
      } catch (e) { why = `network: ${e?.message || e}${e?.cause ? ` (${e.cause.code || e.cause.message || e.cause})` : ''}`; }
      await sleep(intervalMs);
      if (!body) { out.failedSearches++; if (out.searchErrors.length < 3 && !out.searchErrors.includes(why)) out.searchErrors.push(String(why).slice(0, 200)); break; }
      const hits = Array.isArray(body.hits) ? body.hits : [];
      const accounts = [];
      for (const h of hits) {
        const id = String(h.objectID || ''); if (!id || seenIds.has(id)) continue;
        seenIds.add(id); out.itemsRead++;
        const story = String(h.story_id || h.objectID);
        const voice = `${story}:${h.author || id}`;
        if (voices.has(voice)) continue;
        const text = hnText(h.comment_text || h.story_text || '');
        const title = hnText(h.story_title || h.title || '');
        const a = storableAccount(text, { names: [company], title });
        if (!a) continue;
        voices.add(voice);
        accounts.push({ ...a, url: `https://news.ycombinator.com/item?id=${id}`, voice, isOp: false, thread: story, title, created: h.created_at || null, source: 'Hacker News' });
      }
      if (accounts.length) {
        out.found += accounts.length;
        const accepted = await onAccounts(accounts);
        if (typeof accepted === 'number') out.newReports = (out.newReports || 0) + accepted;
        log(`  ${company}: +${accounts.length} from Hacker News (“${term}”, page ${page + 1})`);
      }
      if (hits.length < 100 || page + 1 >= Number(body.nbPages || 0)) break;
    }
  }
  out.exhausted = true; out.stoppedBy = done() ? 'goal' : 'exhausted';
  return out;
}
