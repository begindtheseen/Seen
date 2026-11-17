// The three questions applicants search about an employer, answered from Seen's own data — the first thing
// on a company page, in the server HTML, and (word for word) its FAQPage JSON-LD:
//
//   1. Does <Company> respond to applicants?
//   2. How long does <Company> take to respond?
//   3. Who hears back from <Company>?
//
// Pure: no I/O, relative imports only, so `node --test lib/company/answers.test.mjs` runs it as is.
//
// THE RULES (owner: "real data first"; CLAUDE.md 2026-10-23 / 10-24 / 11-02):
//   - Every number comes from the score row the page already reads (lib/growth.ts getScore) or from the
//     report rows the grade is built from (the scorable, resolved rows: lib/server/reportCounts.js
//     SCORABLE_REPORTS_FILTER — exactly what fusion counts as first_party_report_count). Nothing is
//     estimated, nothing is filled in.
//   - ONE denominator: "N applicant accounts" is first_party_report_count, the header's count. The outcome
//     breakdown is printed only when the rows on file add up to that same N; when they do not (a stored
//     score older than the rows), the answer says so and prints no breakdown — two unexplained numbers
//     never sit side by side.
//   - A web-research claim (web_report_count) is never an applicant account, and online mentions are named
//     apart ("each counts half").
//   - Percentages follow the page's gate: graded AND at least MIN_REPORTS_FOR_RATES applicant accounts.
//     Raw counts ("2 of 3 say …") are facts and are stated below it, with the reason there is no rate.
//   - Seen's response rate is trust-weighted and includes online mentions, so it can differ from the raw
//     share; whenever both appear, the line says what each one counts.
//   - Held reports never reach a public row; in counts they follow the grade's own rule (isScorableReport).
//   - Copy: whole sentences, no dashes, correct plurals ("1 applicant account"), the company named the way
//     the page names it.

import { GHOST_OUTCOMES, RESPONSE_OUTCOMES, NONTERMINAL_OUTCOMES } from '../../api/_utils/companyIntel.js';
import { firstPartyReportCount, mentionCount, webClaimCount, isScorableReport } from '../server/reportCounts.js';
import { MIN_REPORTS_FOR_RATES, pctOf, responseVerdict, confidenceFrom, capDisplayConfidence } from '../companyPageSummary.ts';
import { isPublicDiscussion, isImportedReview } from '../reportSource.ts';
import { formatPacific } from '../time/pacific.js';

/** A role is shown in the "by role" line only when this many applicant accounts name it. */
export const MIN_ROLE_ACCOUNTS = 3;
/** Without a stored average, a median wait needs this many accounts that named one (lib/replyTiming.ts). */
export const MIN_WAITS_FOR_MEDIAN = 5;
/** A ghost stage is named only when at least this many ghosted accounts name the same one. */
export const MIN_STAGE_ACCOUNTS = 2;
/** Indexing beyond graded pages (see companyIndexDecision). */
export const MIN_POSTINGS_TO_INDEX = 10;

const OFFER = new Set(['hired', 'offer', 'offer_received']);
const INTERVIEW = new Set(['interview', 'interviewing', 'interview_received', 'interview_completed', 'human']);
const REJECTED = new Set(['rejected', 'rejection']);
const AUTO = new Set(['autoreject', 'auto_reject', 'automated_rejection']);
// Stage words that name no stage.
const VAGUE_STAGE = /^(general|unknown|other|n\/?a|none|-)$/i;

const int = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; };
const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const accounts = (n) => plural(n, 'applicant account');
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** "a, b and c" */
function listJoin(parts) {
  const p = parts.filter(Boolean);
  if (p.length <= 1) return p[0] || '';
  return `${p.slice(0, -1).join(', ')} and ${p[p.length - 1]}`;
}

function normalizeOutcome(o) { return String(o ?? '').toLowerCase().trim(); }

/**
 * Counts from the grade's own rows: the scorable rows with a decided outcome. Pure; rows that are not
 * scorable (held anti-gaming submissions, rejected / duplicate rows, employee reviews) or still waiting
 * are dropped first, so the result is the same corpus first_party_report_count counts.
 * @param {Array<object>} rows
 */
export function outcomeBreakdown(rows) {
  const out = { total: 0, heardBack: 0, ghosted: 0, offer: 0, interview: 0, rejected: 0, autoRejected: 0, otherResponse: 0, otherOutcome: 0,
    seen: 0, publicPosts: 0, waits: [], rounds: [], stages: {}, ghostedWithStage: 0, roles: {}, withRole: 0 };
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || !isScorableReport(r)) continue;
    const oc = normalizeOutcome(r.outcome);
    if (NONTERMINAL_OUTCOMES.has(oc)) continue;
    out.total += 1;
    if (isPublicDiscussion(r.platform) || isImportedReview(r.platform, r.trust_reason)) out.publicPosts += 1; else out.seen += 1;
    if (GHOST_OUTCOMES.has(oc)) {
      out.ghosted += 1;
      const st = String(r.ghost_stage ?? '').replace(/_/g, ' ').trim();
      if (st && !VAGUE_STAGE.test(st)) {
        const k = st.toLowerCase();
        out.stages[k] = (out.stages[k] || 0) + 1;
        out.ghostedWithStage += 1;
      }
    } else if (RESPONSE_OUTCOMES.has(oc)) {
      out.heardBack += 1;
      if (OFFER.has(oc)) out.offer += 1;
      else if (INTERVIEW.has(oc)) out.interview += 1;
      else if (REJECTED.has(oc)) out.rejected += 1;
      else out.otherResponse += 1;
    } else if (AUTO.has(oc)) {
      out.autoRejected += 1;
    } else {
      out.otherOutcome += 1;
    }
    const w = Number(r.wait_days);
    if (Number.isFinite(w) && w > 0 && w <= 365) out.waits.push(w);
    const rd = Number(r.rounds);
    if (Number.isFinite(rd) && rd > 0 && rd <= 20) out.rounds.push(rd);
    const role = String(r.role ?? '').replace(/\s+/g, ' ').trim();
    if (role && !/^unknown\b/i.test(role) && role.length <= 80) {
      const k = role.toLowerCase();
      const cur = out.roles[k] || { label: role, n: 0, heardBack: 0 };
      cur.n += 1;
      if (RESPONSE_OUTCOMES.has(oc)) cur.heardBack += 1;
      out.roles[k] = cur;
      out.withRole += 1;
    }
  }
  return out;
}

function median(xs) {
  const v = [...xs].sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

const isGraded = (s) => !!s && s.gradeable !== false && typeof s.overall_score === 'number' && Number.isFinite(s.overall_score);

/** "Nov 12, 2026" in California time, or ''. */
function dayLabel(iso) {
  if (!iso) return '';
  return formatPacific(iso, { dateStyle: 'medium' });
}

/** The listing facts Seen holds, said as what they are (job posts, not applicant reports). '' when none. */
export function listingFactsSentence(name, listing) {
  const f = listing && listing.facts;
  const open = int(f && f.open);
  if (!open) return '';
  const head = `What Seen does know comes from ${name}'s own job posts, not applicant reports: ${plural(open, 'open posting')} on Seen`;
  if (!listing.rated || f.payPct == null) return `${head}.`;
  const parts = [`${f.payPct}% state pay`, `${f.directPct}% let you apply with the employer`];
  if (f.longOpenPct != null) parts.push(`${f.longOpenPct}% have been open 30 days or more`);
  return `${head}; ${listJoin(parts)}.`;
}

/**
 * @param {{
 *   name: string,                         // the company as the page shows it ("Walmart")
 *   score?: object|null,                  // the score row/payload (lib/growth.ts GrowthScore shape)
 *   rows?: Array<object>|null,            // the grade's report rows; null = could not be read
 *   listing?: object|null,                // lib/server/listingSignals.js output; null = unknown
 *   employeeReviews?: number|null,        // employee reviews on file (score.employee_review_count)
 * }} input
 */
export function buildCompanyAnswers({ name, score = null, rows = null, listing = null, employeeReviews = null } = {}) {
  const co = String(name || '').trim() || 'this company';
  const s = score || null;
  const graded = isGraded(s);
  const bd = Array.isArray(rows) ? outcomeBreakdown(rows) : null;
  // THE count. With a score row: its first-party count (the header's number). Without one: the rows.
  const N = s ? firstPartyReportCount(s) : (bd ? bd.total : 0);
  const mentions = mentionCount(s);
  const webClaim = webClaimCount(s);
  const empReviews = int(employeeReviews ?? s?.employee_review_count);
  // The breakdown may be printed only when it counts the same rows as N.
  const bdOk = !!bd && N > 0 && bd.total === N;
  const stale = !!bd && N > 0 && bd.total !== N;
  const ratesShown = graded && N >= MIN_REPORTS_FOR_RATES && s.response_rate != null;
  const respPct = ratesShown ? pctOf(s.response_rate) : null;
  const ghostPct = ratesShown ? pctOf(s.ghost_rate) : null;
  const seenUsers = bd ? bd.seen : null;
  const stored = graded && N > 0 ? confidenceFrom(s.data_quality, accounts(N)) : null;
  const confidence = capDisplayConfidence(stored, seenUsers ?? 0);
  const updated = graded ? dayLabel(s.updated_at) : '';
  const listingLine = listingFactsSentence(co, listing);

  // ── 1. Does <Company> respond to applicants? ──────────────────────────────────────────────────
  const q1 = `Does ${co} respond to applicants?`;
  let a1; let d1; let k1 = true;
  const confLine = confidence ? `${confidence.word}${updated ? `, updated ${updated}` : ''}.` : (updated ? `Updated ${updated}.` : '');
  if (N === 0) {
    k1 = false;
    a1 = `Seen does not know yet: there are no applicant accounts for ${co} on Seen.`;
    d1 = [
      webClaim > 0 ? 'Seen holds only a web research estimate for this company, and an estimate is not an applicant account, so no rate is shown.' : '',
      listingLine || `A response rate appears once ${MIN_REPORTS_FOR_RATES} applicant accounts are in.`,
    ].filter(Boolean).join(' ');
  } else if (bdOk) {
    const M = bd.heardBack; const G = bd.ghosted; const A = bd.autoRejected;
    const rawKind = responseVerdict(M / N);
    const word = ratesShown && responseVerdict(s.response_rate) === rawKind
      ? { most_hear_back: 'Mostly yes', mixed: 'About half the time', few_hear_back: 'Mostly no' }[rawKind]
      : '';
    const said = listJoin([
      `${M} of ${accounts(N)} on Seen say ${co} got back to them`,
      A > 0 ? `${A} got only an automated rejection` : '',
      `${G} say they never heard back`,
    ]).replace(/ and (\d+ say they never heard back)$/, A > 0 ? ' and $1' : ', and $1');
    const body = N === 1
      ? (M === 1 ? `the one applicant account on Seen says ${co} got back to them` : G === 1 ? `the one applicant account on Seen says ${co} never got back to them` : `the one applicant account on Seen got only an automated rejection from ${co}`)
      : said;
    a1 = ratesShown
      ? `${word ? `${word}: ` : ''}${cap(body)}.`
      : `Too few accounts to say yet: ${body}.`;
    d1 = [
      'A rejection counts as hearing back.',
      ratesShown
        ? `Seen's response rate for ${co} is ${respPct}%. It weighs each account by its source${mentions > 0 ? ` and also counts ${plural(mentions, 'online mention')} at half weight` : ''}${A > 0 ? '; automated rejections count as neither' : ''}.`
        : `A response rate needs ${MIN_REPORTS_FOR_RATES} applicant accounts${graded ? '' : ' and a grade'} (${N} so far).`,
      confLine,
    ].filter(Boolean).join(' ');
  } else if (ratesShown) {
    const kind = responseVerdict(s.response_rate);
    const word = { most_hear_back: 'Mostly yes', mixed: 'About half the time', few_hear_back: 'Mostly no' }[kind] || '';
    a1 = `${word ? `${word}: ` : ''}Seen's response rate for ${co} is ${respPct}%, from ${accounts(N)}.`;
    d1 = [
      `It weighs each account by its source${mentions > 0 ? ` and also counts ${plural(mentions, 'online mention')} at half weight` : ''}. A rejection counts as hearing back.`,
      stale ? `The grade was built from ${accounts(N)}; ${bd.total} are on file now, so the counts by outcome wait for the next recompute.` : '',
      confLine,
    ].filter(Boolean).join(' ');
  } else {
    a1 = `Too few accounts to say yet: Seen has ${accounts(N)} for ${co}.`;
    d1 = [
      `A response rate needs ${MIN_REPORTS_FOR_RATES} applicant accounts${graded ? '' : ' and a grade'}.`,
      stale ? `${bd.total} are on file now; the count is refreshed on the next recompute.` : '',
      confLine,
    ].filter(Boolean).join(' ');
  }

  // ── 2. How long does <Company> take to respond? ───────────────────────────────────────────────
  const q2 = `How long does ${co} take to respond?`;
  const parts2 = []; const det2 = [];
  let waitDays = null;
  if (bdOk) {
    const K = bd.waits.length;
    const storedWait = graded && s.avg_wait_days != null && Number.isFinite(Number(s.avg_wait_days)) ? Math.round(Number(s.avg_wait_days)) : null;
    if (storedWait != null && storedWait > 0 && K >= 1) {
      waitDays = storedWait;
      parts2.push(`${co} applicants who said how long it took waited about ${plural(storedWait, 'day')} on average to hear back.`);
      det2.push(`From ${K} of ${accounts(N)} that named a wait, weighed by source.`);
    } else if (K >= MIN_WAITS_FOR_MEDIAN) {
      waitDays = Math.round(median(bd.waits));
      parts2.push(`${co} applicants who said how long it took waited a median of ${plural(waitDays, 'day')} to hear back.`);
      det2.push(`From ${K} of ${accounts(N)} that named a wait.`);
    }
    const R = bd.rounds.length;
    const storedRounds = graded && s.avg_rounds != null && Number(s.avg_rounds) > 0 ? Number(s.avg_rounds) : null;
    const rounds = storedRounds != null && R >= 1 ? storedRounds : (R >= 3 ? bd.rounds.reduce((a, b) => a + b, 0) / R : null);
    if (rounds != null) {
      const r1 = Math.round(rounds * 10) / 10;
      parts2.push(`Those who described their interviews report about ${r1 % 1 === 0 ? plural(r1, 'round') : `${r1} rounds`}.`);
      det2.push(`${R} ${R === 1 ? 'account names' : 'accounts name'} the number of rounds.`);
    }
    const top = Object.entries(bd.stages).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0];
    if (top && top[1] >= MIN_STAGE_ACCOUNTS) {
      parts2.push(`Ghosted applicants most often lost contact at the ${top[0]} stage.`);
      det2.push(`${top[1]} of the ${plural(bd.ghostedWithStage, 'ghosted account')} that named a stage say so (${plural(bd.ghosted, 'ghosted account')} in all).`);
    }
  }
  let a2; let d2; let k2 = parts2.length > 0;
  if (k2) {
    a2 = parts2.join(' ');
    if (waitDays == null) det2.unshift(bdOk && bd.waits.length ? `Seen shows a wait once ${MIN_WAITS_FOR_MEDIAN} accounts name one (${bd.waits.length} so far).` : 'No applicant account says how long the reply took yet.');
    d2 = det2.join(' ');
  } else {
    k2 = false;
    if (N === 0) {
      a2 = `Not known yet: Seen has no applicant accounts for ${co}.`;
      d2 = listingLine && N === 0 ? `Open job posts say nothing about reply times, so Seen does not guess one.` : 'Seen never estimates a wait it has not been told.';
    } else if (!bdOk) {
      a2 = `Not known yet: Seen cannot show a reply time for ${co} right now.`;
      d2 = 'Seen never estimates a wait it has not been told.';
    } else {
      a2 = bd.waits.length
        ? `Not known yet: ${bd.waits.length} of ${accounts(N)} for ${co} say how long the reply took.`
        : `Not known yet: none of the ${accounts(N)} for ${co} say how long the reply took.`;
      d2 = `Seen shows a wait once ${MIN_WAITS_FOR_MEDIAN} accounts name one, and never estimates it.`;
    }
  }

  // ── 3. Who hears back from <Company>? ─────────────────────────────────────────────────────────
  const q3 = `Who hears back from ${co}?`;
  let a3; let d3; let k3 = true;
  if (bdOk) {
    const parts = [
      bd.offer ? `${bd.offer} got an offer` : '',
      bd.interview ? `${bd.interview} interviewed or heard from a person` : '',
      bd.rejected ? `${bd.rejected} ${bd.rejected === 1 ? 'was' : 'were'} rejected` : '',
      bd.otherResponse ? `${bd.otherResponse} heard back in another way, such as an assessment` : '',
      bd.autoRejected ? `${bd.autoRejected} got only an automated rejection` : '',
      bd.ghosted ? `${bd.ghosted} never heard back` : '',
      bd.otherOutcome ? `${bd.otherOutcome} reported another outcome` : '',
    ];
    a3 = `Of ${accounts(N)} on Seen, ${listJoin(parts)}.`;
    const src = bd.seen > 0 && bd.publicPosts > 0
      ? `By source: ${bd.publicPosts} from public posts and ${bd.seen} submitted to Seen by applicants.`
      : bd.publicPosts > 0
        ? (N === 1 ? 'By source: it comes from a public post.' : `By source: all ${N} come from public posts.`)
        : (N === 1 ? 'By source: it was submitted to Seen by an applicant.' : `By source: all ${N} were submitted to Seen by applicants.`);
    const extras = listJoin([empReviews > 0 ? plural(empReviews, 'employee review') : '', mentions > 0 ? plural(mentions, 'online mention') : '']);
    const roleRows = Object.values(bd.roles).filter((r) => r.n >= MIN_ROLE_ACCOUNTS).sort((x, y) => y.n - x.n || x.label.localeCompare(y.label)).slice(0, 3);
    const roleLine = roleRows.length
      ? `By role: ${listJoin(roleRows.map((r) => `${r.label}, ${r.heardBack} of ${r.n} heard back`))}.`
      : `Not enough reports by role yet${bd.withRole ? ` (${bd.withRole} of ${N} name a role, none ${MIN_ROLE_ACCOUNTS} times)` : ''}.`;
    d3 = [src, extras ? `${cap(extras)} are also on file; they are not applicant accounts.` : '', roleLine].filter(Boolean).join(' ');
  } else if (N > 0) {
    k3 = false;
    a3 = stale
      ? `Seen is recounting: the grade was built from ${accounts(N)} and ${bd.total} are on file now, so the counts by outcome appear after the next recompute.`
      : `Seen has ${accounts(N)} for ${co}, but the counts by outcome could not be read right now.`;
    d3 = 'Not enough reports by role yet.';
  } else {
    k3 = false;
    a3 = `Not known yet: there are no applicant accounts for ${co} on Seen.`;
    d3 = listingLine ? 'Not enough reports by role yet. Job posts do not say who hears back.' : 'Not enough reports by role yet.';
  }

  const answers = [
    { id: 'respond', question: q1, sentence: a1, detail: d1, known: k1 },
    { id: 'wait', question: q2, sentence: a2, detail: d2, known: k2 },
    { id: 'who', question: q3, sentence: a3, detail: d3, known: k3 },
  ];
  return {
    name: co,
    graded,
    accounts: N,
    breakdown: bdOk ? { total: bd.total, heardBack: bd.heardBack, ghosted: bd.ghosted, offer: bd.offer, interview: bd.interview, rejected: bd.rejected, autoRejected: bd.autoRejected, otherResponse: bd.otherResponse, otherOutcome: bd.otherOutcome, seen: bd.seen, publicPosts: bd.publicPosts } : null,
    seenUserAccounts: seenUsers,
    confidence: confidence ? confidence.word : null,
    ratesShown, respPct, ghostPct,
    waitDays,
    hasData: N > 0 || int(listing?.facts?.open) > 0 || !!s,
    answers,
  };
}

/** The FAQPage entries: exactly the visible question and its visible text, only for answered questions. */
export function answersFaq(built) {
  return (built?.answers || []).filter((a) => a.known).map((a) => ({ question: a.question, answer: `${a.sentence} ${a.detail}`.trim() }));
}

/**
 * Should a company page be indexed? Graded pages are (search plan 2026-10-24). An ungraded page is indexed
 * only when it carries real applicant evidence AND substantive listing data: at least one applicant account
 * and at least MIN_POSTINGS_TO_INDEX open postings with rated listing signals. A listings-only page answers
 * none of the three questions the page exists for, so it stays out (thin / doorway). A failed score read
 * decides nothing (never noindex a page that may be graded).
 * @returns {{ index: boolean, reason: string }}
 */
export function companyIndexDecision({ gradeable, readOk, accounts: n = 0, listing = null } = {}) {
  if (!readOk) return { index: true, reason: 'score read failed: decide nothing' };
  if (gradeable) return { index: true, reason: 'graded' };
  const open = int(listing?.facts?.open ?? listing?.listings);
  if (int(n) >= 1 && listing?.rated && open >= MIN_POSTINGS_TO_INDEX) return { index: true, reason: 'applicant accounts + listing signals' };
  return { index: false, reason: int(n) >= 1 ? 'too few open postings' : 'no applicant accounts' };
}
