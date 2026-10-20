// Free, deep applicant-report harvester over the Arctic Shift Reddit archive (no model, no spend).
//
// Per company, newest first, until it has found `goal` new first-hand accounts (goal 0 = keep going
// until every source is exhausted) or the time budget runs out:
//   1. the company's own subreddits (r/HomeDepot, r/WalmartEmployees, r/chipotleworkers…), searched for
//      applicant words (interview, hired, applied, offer, ghosted, rejected, orientation…), year by year;
//   2. the job subreddits (r/recruitinghell, r/jobs, r/interviews…), searched for the company's name,
//      year by year;
//   3. every new thread found: its opening post and its whole comment tree, through the strict rules
//      (lib/reports/applicantRules.js). One account per voice per thread (the opening poster once).
// Accounts stream out through onAccounts as they are found, so a long run saves as it goes.
// Requests go through the polite shared fetcher (≥1 s apart, honours rate-limit resets).
// Tests: lib/reports/archiveHarvest.test.mjs (fake archive).

import { storableAccount, nameVariants, oneAccountPerVoice, namePattern } from './applicantRules.js';
import { postToItem, flattenCommentTree, POST_FIELDS } from '../../scripts/credit/lib/arcticShift.mjs';
import { JOB_SUBREDDITS } from '../../scripts/credit/lib/reddit.mjs';

export const APPLICANT_TERMS = ['interview', 'hired', 'applied', 'application', 'offer', 'ghosted', 'rejected', 'orientation', 'recruiter', 'onboarding'];
const YEAR_S = 365 * 86_400;
// Very active subreddits time out on all-time full-text search; they are searched one year at a time.
const ACTIVE = new Set(['recruitinghell', 'jobs', 'antiwork', 'cscareerquestions', 'WorkReform', 'ExperiencedDevs']);
// Subreddits named after the company that are not about working there.
const OFF_TOPIC = /(?:meme|circlejerk|nsfw|deals|coupon|recipe|customer|shopper|seller|stock|invest|cel(?:eb|ebrities)|rp$|skeleton|sucks|rat|fan|people$|ogp$|rx$|canada$|uk$|mexico$|india$|\d{4})/i;
const WORKER = /(?:employee|worker|associate|crew|staff|team|labor|union|careers?|jobs?|hiring|interview|partners?|drivers?)/i;

/** Pick a company's own subreddits from an archive prefix search: the exact name, plus worker subs. */
export function pickCompanySubs(company, found = []) {
  const keys = new Set(nameVariants([company]).map((v) => v.replace(/[^a-z0-9]/g, '')));
  const out = [];
  for (const s of found) {
    const name = String(s?.display_name || s?.name || '').replace(/^r\//, '');
    const subs = Number(s?.subscribers ?? s?._meta?.subscribers ?? 0) || 0;
    if (!name) continue;
    const low = name.toLowerCase();
    const exact = keys.has(low);
    const stem = [...keys].find((k) => low.startsWith(k));
    if (!stem && !exact) continue;
    const rest = low.slice(stem ? stem.length : low.length);
    if (exact || (WORKER.test(rest) && !OFF_TOPIC.test(rest) && subs >= 200)) out.push({ name, subscribers: subs, exact });
  }
  return out.sort((a, b) => (b.exact - a.exact) || (b.subscribers - a.subscribers)).slice(0, 4);
}

export async function discoverCompanySubs(company, { fetcher }) {
  const prefix = (nameVariants([company]).find((v) => !v.includes(' ')) || '').replace(/[^a-z0-9]/g, '');
  if (prefix.length < 3) return [];
  const r = await fetcher.get('/api/subreddits/search', { subreddit_prefix: prefix, limit: '25' });
  return r.ok ? pickCompanySubs(company, r.items) : [];
}

/**
 * Every archive search for one company, newest year first. Company-subreddit and job-subreddit searches
 * ALTERNATE: a company's own subreddit is mostly people who got hired, the job subreddits mostly people
 * who were ghosted or rejected, and a run that stops at its goal must not have heard only one side.
 */
export function* searchPlan(company, { companySubs = [], jobSubs = JOB_SUBREDDITS, years = 5, nowSec = Math.floor(Date.now() / 1000) } = {}) {
  const term = nameVariants([company]).find((v) => v.includes(' ')) || nameVariants([company])[0] || company;
  const base = { limit: '100', sort: 'desc', fields: POST_FIELDS };
  const windows = Array.from({ length: years }, (_, w) => ({ after: String(nowSec - (w + 1) * YEAR_S), before: String(nowSec - w * YEAR_S) }));
  for (const [wi, w] of windows.entries()) {
    const own = []; const job = [];
    for (const t of APPLICANT_TERMS) for (const sub of companySubs) own.push({ kind: 'company_sub', sub: sub.name, params: { ...base, subreddit: sub.name, title: t, ...w } });
    for (const sub of jobSubs) {
      if (!ACTIVE.has(sub) && wi > 0) continue; // quiet subreddits: one all-time search, in the first round
      job.push({ kind: 'job_sub', sub, params: { ...base, subreddit: sub, query: term, ...(ACTIVE.has(sub) ? w : {}) } });
    }
    for (let i = 0; i < Math.max(own.length, job.length); i++) { if (job[i]) yield job[i]; if (own[i]) yield own[i]; }
  }
}

/**
 * Harvest one company. Returns { company, found, newReports, threadsRead, searches, failedSearches,
 * companySubs, exhausted, stoppedBy }. onAccounts(accounts) receives each thread's accounts as soon as
 * they are found. When it returns a number (the reports Seen newly accepted from what it was given), the
 * goal counts THOSE — so a re-run that re-finds accounts Seen already holds keeps going to new ones.
 * Otherwise (a dry run) the goal counts accounts found.
 */
export async function harvestCompany(company, {
  fetcher, goal = 10, years = 5, deadlineAt = Infinity, seenThreads = new Set(), onAccounts = async () => {},
  log = () => {}, now = () => Date.now(), jobSubs = JOB_SUBREDDITS, treeLimit = 500,
} = {}) {
  const name = namePattern([company]);
  const out = { company, found: 0, newReports: null, threadsRead: 0, searches: 0, failedSearches: 0, companySubs: [], exhausted: false, stoppedBy: null };
  if (!name) { out.stoppedBy = 'unsearchable_name'; return out; }
  const companySubs = await discoverCompanySubs(company, { fetcher }).catch(() => []);
  out.companySubs = companySubs.map((s) => s.name);
  const subSet = new Set(companySubs.map((s) => s.name.toLowerCase()));
  const done = () => (goal > 0 && (out.newReports ?? out.found) >= goal);
  const seenTexts = new Set();

  for (const q of searchPlan(company, { companySubs, jobSubs, years })) {
    if (done()) { out.stoppedBy = 'goal'; return out; }
    if (now() >= deadlineAt) { out.stoppedBy = 'time'; return out; }
    out.searches++;
    let r = await fetcher.get('/api/posts/search', q.params);
    // Full-text query can time out in big subreddits; the title-only search is the cheaper fallback.
    if (!r.ok && q.params.query) { const { query, ...rest } = q.params; r = await fetcher.get('/api/posts/search', { ...rest, title: query }); }
    if (!r.ok) { out.failedSearches++; continue; }
    for (const p of r.items) {
      const conv = postToItem(p); if (!conv) continue;
      const t = conv.item;
      if (seenThreads.has(t.id)) continue;
      seenThreads.add(t.id);
      const inCompanySub = subSet.has(String(t.subreddit).toLowerCase());
      const opText = `${t.title}. ${t._body || ''}`;
      // A job-subreddit thread must be about the company; a company-subreddit thread must be about applying.
      if (!inCompanySub && !name.test(opText)) continue;
      if (inCompanySub && !new RegExp(`\\b(?:${APPLICANT_TERMS.join('|')}|hire|offer|interview)`, 'i').test(opText)) continue;
      const accounts = [];
      const add = (text, { isOp, url, voice }) => {
        const a = storableAccount(text, { names: [company], title: t.title, isOp, inCompanySub });
        if (a) accounts.push({ ...a, url, voice, isOp, thread: t.id, subreddit: t.subreddit, title: t.title, created: t.created, inCompanySub });
      };
      add(opText, { isOp: true, url: t.permalink, voice: `${t.id}:op` });
      const tree = await fetcher.get('/api/comments/tree', { link_id: `t3_${t.id}`, limit: String(treeLimit) });
      out.threadsRead++;
      if (tree.ok) {
        for (const c of flattenCommentTree(tree.items, { postAuthor: conv.author, maxComments: treeLimit, maxChars: 1500 })) {
          add(c.body, { isOp: c.is_op, url: `${t.permalink.replace(/\/?$/, '/')}${c.id}/`, voice: c.is_op ? `${t.id}:op` : `${t.id}:${c.id}` });
        }
      }
      // A cross-post repeats the same words in another thread: one account.
      const one = oneAccountPerVoice(accounts).filter((x) => { const k = x.excerpt.toLowerCase().replace(/\W+/g, ' ').trim(); if (seenTexts.has(k)) return false; seenTexts.add(k); return true; });
      if (one.length) {
        out.found += one.length;
        const accepted = await onAccounts(one);
        if (typeof accepted === 'number') out.newReports = (out.newReports || 0) + accepted;
        log(`  ${company}: +${one.length} from r/${t.subreddit} (${out.found} found${out.newReports != null ? `, ${out.newReports} new in Seen` : ''})`);
      }
      if (done()) { out.stoppedBy = 'goal'; return out; }
    }
  }
  out.exhausted = true; out.stoppedBy = 'exhausted';
  return out;
}
