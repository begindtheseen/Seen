// Free, deep applicant-report harvester over the Arctic Shift Reddit archive (no model, no spend).
//
// Per company, newest first, until it has found `goal` new first-hand accounts (goal 0 = keep going
// until every source is exhausted) or the time budget runs out:
//   1. the company's own subreddits (r/HomeDepot, r/WalmartEmployees, r/chipotleworkers…), read page by page
//      back in time — a plain listing, the archive's cheapest request — and matched HERE for applicant words
//      (interview, hired, applied, offer, ghosted, rejected, orientation…) in the title or the body;
//   2. the job subreddits (r/recruitinghell, r/jobs, r/interviews…), full-text searched for the company's
//      name, year by year;
//   3. every new thread found: its opening post and its whole comment tree, through the strict rules
//      (lib/reports/applicantRules.js). One account per voice per thread (the opening poster once).
// Accounts stream out through onAccounts as they are found, so a long run saves as it goes.
// Requests go through the polite shared fetcher (≥1 s apart, honours rate-limit resets, never past the
// deadline it is given).
// Tests: lib/reports/archiveHarvest.test.mjs (fake archive).

import { storableAccount, nameVariants, oneAccountPerVoice, namePattern } from './applicantRules.js';
import { postToItem, flattenCommentTree, POST_FIELDS } from '../../scripts/credit/lib/arcticShift.mjs';
import { JOB_SUBREDDITS } from '../../scripts/credit/lib/reddit.mjs';

export const APPLICANT_TERMS = ['interview', 'hired', 'applied', 'application', 'offer', 'ghosted', 'rejected', 'orientation', 'recruiter', 'onboarding'];
const APPLYING = new RegExp(`\\b(?:${APPLICANT_TERMS.join('|')}|hire|offer|interview)`, 'i');
// A company subreddit is listed, not searched, so a post qualifies on its TITLE (any applicant word, as the old
// title searches did) or on its BODY — but only on words that mean applying there: in a product subreddit
// (r/gitlab, r/Zscaler) "application" is software and "we offer" is a feature, and each thread read costs a
// comment-tree request.
const APPLYING_BODY = /\b(?:interview(?:ed|ing|s)?|hired|applied|job offer|offer letter|ghosted|rejected|rejection|orientation|onboarding|recruiters?|got the job)\b/i;
// …and it must be about a JOB. A subreddit named after the company is often its customers' (r/Affirm, r/verizon):
// "Affirm rejected me" there is a declined loan (seen live 2026-10-21), not a declined applicant.
const JOB_CONTEXT = /\b(?:jobs?|positions?|roles?|hiring|hired|interview\w*|recruiters?|onboarding|orientation|applicants?|application (?:for|to)|applied (?:for|to|at|here|there)|work(?:ing|ed)? (?:at|for|here|there)|employees?|employment|new hire|job offer|offer letter|background check|drug test|start date|first day|first shift|career)\b/i;
const YEAR_S = 365 * 86_400;
// Very active subreddits time out on all-time full-text search; they are searched one year at a time.
const ACTIVE = new Set(['recruitinghell', 'jobs', 'antiwork', 'cscareerquestions', 'WorkReform', 'ExperiencedDevs']);
// Subreddits named after the company that are not about working there.
const OFF_TOPIC = /(?:meme|circlejerk|nsfw|deals|coupon|recipe|customer|shopper|seller|stock|invest|cel(?:eb|ebrities)|rp$|skeleton|sucks|rat|fan|people$|ogp$|rx$|canada$|uk$|mexico$|india$|\d{4})/i;
const WORKER = /(?:employee|worker|associate|crew|staff|team|labor|union|careers?|jobs?|hiring|interview|partners?|drivers?)/i;
// One company-subreddit page (the archive's maximum).
const PAGE = 100;
// Consecutive refused job-subreddit searches before the archive counts as busy for this company: the rest of
// its full-text searches are skipped (the company-subreddit listing goes on), so a time-boxed run moves on to
// the next company instead of spending its minutes collecting refusals.
export const BUSY_AFTER = 4;

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

// The prefix the archive's subreddit search is asked for — also the exact-name subreddit tried when that
// search is refused.
const subPrefix = (company) => (nameVariants([company]).find((v) => !v.includes(' ')) || '').replace(/[^a-z0-9]/g, '');

/** { subs, ok, error }. ok:false means the archive refused the subreddit search — not "this company has none". */
export async function discoverCompanySubs(company, { fetcher, deadlineAt = Infinity }) {
  const prefix = subPrefix(company);
  if (prefix.length < 3) return { subs: [], ok: true, error: null };
  const r = await fetcher.get('/api/subreddits/search', { subreddit_prefix: prefix, limit: '25' }, { deadlineAt });
  return r.ok ? { subs: pickCompanySubs(company, r.items), ok: true, error: null } : { subs: [], ok: false, error: String(r.error || `http_${r.status || 0}`) };
}

/**
 * The job-subreddit searches for one company, newest year first: the company's name, full text — one
 * all-time search per quiet subreddit, one per year in the very active ones.
 */
export function* searchPlan(company, { jobSubs = JOB_SUBREDDITS, years = 5, nowSec = Math.floor(Date.now() / 1000) } = {}) {
  const term = nameVariants([company]).find((v) => v.includes(' ')) || nameVariants([company])[0] || company;
  const base = { limit: '100', sort: 'desc', fields: POST_FIELDS };
  for (let wi = 0; wi < years; wi++) {
    const w = { after: String(nowSec - (wi + 1) * YEAR_S), before: String(nowSec - wi * YEAR_S) };
    for (const sub of jobSubs) {
      if (!ACTIVE.has(sub) && wi > 0) continue; // quiet subreddits: one all-time search, in the first round
      yield { kind: 'job_sub', sub, params: { ...base, subreddit: sub, query: term, ...(ACTIVE.has(sub) ? w : {}) } };
    }
  }
}

// One page of a company subreddit, newest first, with NO text filter. Measured on the live archive 2026-10-21
// while it refused 35 of 52 full-text searches (HTTP 422 "Timeout. Maybe slow down a bit"): a plain listing
// answered every time in 0.9–2.5 s, and one page held r/natera's whole history (5 posts) and all 24 of
// r/Brex's — where the old plan spent 10 applicant-word title searches per subreddit per year window
// (a 6 s full-text search even on 5-post r/natera, when it answered at all).
export const companySubPage = (sub, { before, after }) => ({ subreddit: sub, limit: String(PAGE), sort: 'desc', fields: POST_FIELDS, after: String(after), before: String(before) });

/**
 * Harvest one company. Returns { company, found, newReports, threadsRead, searches, failedSearches,
 * searchErrors, companySubs, archiveBusy, exhausted, stoppedBy }.
 * Job-subreddit searches and company-subreddit pages ALTERNATE: a company's own subreddit is mostly people
 * who got hired, the job subreddits mostly people who were ghosted or rejected, and a run that stops at its
 * goal must not have heard only one side.
 * stoppedBy: goal | time | exhausted | archive_busy (BUSY_AFTER full-text searches in a row were refused, so
 * the rest were skipped; every company-subreddit page was still read) | unsearchable_name.
 * onAccounts(accounts) receives each thread's accounts as soon as they are found. When it returns a number
 * (the reports Seen newly accepted from what it was given), the goal counts THOSE — so a re-run that re-finds
 * accounts Seen already holds keeps going to new ones. Otherwise (a dry run) the goal counts accounts found.
 * Every archive call carries the deadline, so no back-off or retry runs past it.
 */
export async function harvestCompany(company, {
  fetcher, goal = 10, years = 5, deadlineAt = Infinity, seenThreads = new Set(), onAccounts = async () => {},
  log = () => {}, now = () => Date.now(), jobSubs = JOB_SUBREDDITS, treeLimit = 500, busyAfter = BUSY_AFTER,
  nowSec = Math.floor(now() / 1000),
} = {}) {
  const name = namePattern([company]);
  const out = { company, found: 0, newReports: null, threadsRead: 0, searches: 0, failedSearches: 0, searchErrors: [], companySubs: [], archiveBusy: false, exhausted: false, stoppedBy: null };
  if (!name) { out.stoppedBy = 'unsearchable_name'; return out; }
  const get = (path, params) => fetcher.get(path, params, { deadlineAt });
  const timeUp = (r) => !!r && !r.ok && r.error === 'deadline';
  const failed = (r) => {
    out.failedSearches++;
    // Why it failed, so a run that fails every search says so (a certificate, a refused connection, an overload…).
    const why = String(r.error || `http_${r.status || 0}`).slice(0, 200);
    if (out.searchErrors.length < 3 && !out.searchErrors.includes(why)) out.searchErrors.push(why);
  };
  const stop = (why) => { out.stoppedBy = why; return out; };

  out.searches++;
  const disc = await discoverCompanySubs(company, { fetcher, deadlineAt }).catch((e) => ({ subs: [], ok: false, error: String(e?.message || e) }));
  if (timeUp(disc)) { out.searches--; return stop('time'); }
  let companySubs = disc.subs;
  if (!disc.ok) {
    failed(disc);
    // Refused is not "none": the exact-name subreddit (the one discovery always keeps) costs one cheap
    // listing to check, and a subreddit that does not exist answers an empty page.
    const guess = subPrefix(company);
    if (guess.length >= 3) companySubs = [{ name: guess, subscribers: 0, exact: true }];
  }
  out.companySubs = companySubs.map((s) => s.name);
  const subSet = new Set(companySubs.map((s) => s.name.toLowerCase()));
  const horizon = nowSec - years * YEAR_S;
  const subs = companySubs.map((s) => ({ name: s.name, before: nowSec, done: false, fails: 0 }));
  const jobs = searchPlan(company, { jobSubs, years, nowSec });
  let jobsDone = false, busyStreak = 0, turn = 0, subTurn = 0;
  const done = () => (goal > 0 && (out.newReports ?? out.found) >= goal);
  const seenTexts = new Set();

  const nextJob = () => { if (jobsDone) return null; const n = jobs.next(); if (n.done) { jobsDone = true; return null; } return n.value; };
  const nextSub = () => { const open = subs.filter((x) => !x.done); return open.length ? { kind: 'company_sub', sub: open[subTurn++ % open.length] } : null; };
  const nextStep = () => (turn++ % 2 === 0 ? nextJob() || nextSub() : nextSub() || nextJob());

  // Every new thread in `items`: its opening post and its comment tree, through the strict rules. true = goal met.
  async function readThreads(items) {
    for (const p of items) {
      const conv = postToItem(p); if (!conv) continue;
      const t = conv.item;
      if (seenThreads.has(t.id)) continue;
      seenThreads.add(t.id);
      const inCompanySub = subSet.has(String(t.subreddit).toLowerCase());
      const opText = `${t.title}. ${t._body || ''}`;
      // A job-subreddit thread must be about the company; a company-subreddit thread must be about applying.
      if (!inCompanySub && !name.test(opText)) continue;
      if (inCompanySub && ((!APPLYING.test(t.title) && !APPLYING_BODY.test(t._body || '')) || !JOB_CONTEXT.test(opText))) continue;
      const accounts = [];
      const add = (text, { isOp, url, voice }) => {
        const a = storableAccount(text, { names: [company], title: t.title, isOp, inCompanySub });
        if (a) accounts.push({ ...a, url, voice, isOp, thread: t.id, subreddit: t.subreddit, title: t.title, created: t.created, inCompanySub });
      };
      add(opText, { isOp: true, url: t.permalink, voice: `${t.id}:op` });
      // A thread the archive says has no comments costs no tree request.
      const noComments = Number(p.num_comments) === 0;
      const tree = noComments ? { ok: false } : await get('/api/comments/tree', { link_id: `t3_${t.id}`, limit: String(treeLimit) });
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
      if (done()) return true;
      if (now() >= deadlineAt) return false;
    }
    return false;
  }

  for (let step = nextStep(); step; step = nextStep()) {
    if (done()) return stop('goal');
    if (now() >= deadlineAt) return stop('time');
    out.searches++;
    let r;
    if (step.kind === 'company_sub') {
      const s = step.sub;
      r = await get('/api/posts/search', companySubPage(s.name, { before: s.before, after: horizon }));
      if (timeUp(r)) { out.searches--; return stop('time'); }
      if (!r.ok) { failed(r); if (++s.fails >= 2) s.done = true; continue; }
      const times = r.items.map((p) => Number(p?.created_utc)).filter((x) => Number.isFinite(x) && x > 0);
      const oldest = times.length ? Math.min(...times) : null;
      // A short page is the last one; a page that does not move back in time would repeat forever.
      if (r.items.length < PAGE || oldest == null || oldest >= s.before) s.done = true; else s.before = oldest;
    } else {
      r = await get('/api/posts/search', step.params);
      // Full-text query can time out in big subreddits; the title-only search is the cheaper fallback.
      if (!r.ok && !timeUp(r) && step.params.query) { const { query, ...rest } = step.params; r = await get('/api/posts/search', { ...rest, title: query }); }
      if (timeUp(r)) { out.searches--; return stop('time'); }
      if (!r.ok) {
        failed(r);
        if (++busyStreak >= busyAfter) { jobsDone = true; out.archiveBusy = true; }
        continue;
      }
      busyStreak = 0;
    }
    if (await readThreads(r.items)) return stop('goal');
  }
  if (done()) return stop('goal');
  if (now() >= deadlineAt) return stop('time');
  if (out.archiveBusy) return stop('archive_busy');
  out.exhausted = true;
  return stop('exhausted');
}
