// match2 — a clean-room second matcher for "which listings fit this person?", behind matchListing's interface.
//
// ONE principle: decide from KNOWLEDGE (the occupation module: occupationOf / relation / levelOf, the activity
// index) and from the ONE fit engine the product already has (runOptimizer). No table of titles, fields, licences
// or years lives here.
//
//   1. WHO — person.js: roles placed by occupationOf; direction = a stated target, the current / latest regular role,
//      or a recent degree; a rung per role.
//   2. WHAT — listing.js: the listing title placed the same way; its rung; summary-only or not; remote or not.
//   3. FIELD — relation(their title, the listing title): same / ladder → their line of work (the only kind that may
//      headline an email); related → the rail; unknown → the rail only when the listing's duties and their own
//      lines are the same work (relateActivities, exact/close); known-different → never.
//   4. RUNG — not below their current rung on their own ladder (a title they held before, a stated lower level, a
//      job their occupation supervises), never more than one rung above. A stated move opens entry rungs only.
//   5. FIT — the fit engine, once per résumé × listing (≤ FIT_BUDGET per person per request): a failed hard gate,
//      a different field or a weak band → no; the email also needs Good or Strong.
//   6. LIMITS — the person's stated schedule wants against the listing's stated conditions (limits.js).
//   7. TEASERS — rail only, same line of work, never a headline.
//   8. SENTENCES — only from checks that passed, in the résumé's own words and the engine's own sentences.
import { relation } from '../../occupations/index.js';
import { relateActivities } from '../../occupations/activities.js';
import { readPerson, textHash } from './person.js';
import { readListing, dutyLines, handsOn } from './listing.js';
import { fitOf, peekFit, railFit, emailFit } from './fit.js';
import { personWants, listingConditions, limitConflict } from './limits.js';

export const FIT_BUDGET = 40;
const ACTIVITY_LISTING_LINES = 10;
const ACTIVITY_RESUME_LINES = 8;

/** Per-request bookkeeping (a request = one résumé at one `now`): fit-engine runs spent, and timings. */
const BUDGET = new Map();
/** @param {string} key */
function budgetOf(key) {
  let b = BUDGET.get(key);
  if (!b) { if (BUDGET.size > 200) BUDGET.clear(); b = { runs: 0, ms: 0, skippedError: 0 }; BUDGET.set(key, b); }
  return b;
}
/** Diagnostics for one request (tests and the scorer): fit-engine runs and milliseconds. */
export function requestStats(resumeText, now) { return { ...budgetOf(`${textHash(resumeText)}␟${now.getTime()}`) }; }

/** A résumé-shaped text rebuilt from the job keys' plain facts (roles: title, employer, dates, lines) — the fallback
 *  for a caller that holds keys but not the text (the alert path). */
export function textFromKeys(keys) {
  const out = ['EXPERIENCE'];
  for (const r of (keys && keys.roles) || []) {
    const span = `${r.start ? String(r.start).replace(/^(\d{4})-(\d{2})$/, (_, y, m) => `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1]} ${y}`) : ''} – ${r.current ? 'Present' : r.end ? String(r.end).replace(/^(\d{4})-(\d{2})$/, (_, y, m) => `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1]} ${y}`) : ''}`;
    out.push(`${r.title}${r.company ? ` — ${r.company}` : ''}    ${span}`);
    for (const l of r.lines || []) out.push(`- ${l}`);
  }
  return out.length > 1 ? out.join('\n') : '';
}

const article = (/** @type {string} */ w) => (/^[aeiou]/i.test(w) && !/^(uni|eu|one|use)/i.test(w) ? 'an' : 'a');
/** "You're a/an <title> at <employer> (since 2021)." — every part is on the résumé; parts it lacks are left out. */
function roleSentence(r, text) {
  const t = String(r.title || '').trim();
  if (!t || !text.toLowerCase().includes(t.toLowerCase())) return '';
  const at = r.company && text.includes(r.company) ? ` at ${r.company}` : '';
  if (r.current) return `You're ${article(t)} ${t}${at}${r.startYear ? ` (since ${r.startYear})` : ''}.`;
  const span = r.startYear && r.endYear ? ` (${r.startYear}–${r.endYear})` : r.endYear ? ` (until ${r.endYear})` : '';
  return `You were ${article(t)} ${t}${at}${span}.`;
}

/** relation() never throws on bad input in practice; this keeps one odd title from failing a listing. */
function rel(a, b, opts) { try { return relation(a, b, opts); } catch { return null; } }

// Role nouns that name no particular job: a shared one says nothing about the line of work.
const GENERIC_NOUN = /^(technician|technologist|specialist|assistant|associate|worker|manager|analyst|coordinator|representative|rep|officer|clerk|agent|lead|leader|supervisor|director|operator|engineer|administrator|consultant|advisor|adviser|member|professional|expert|head|chief|aide|helper|attendant|partner|generalist|executive|staff|trainee|apprentice|intern|instructor|educator|planner|controller|inspector|designer|developer|owner|crew|team|person)$/;
const LEVEL_WORD = /^(senior|sr|junior|jr|lead|head|chief|staff|principal|entry|level|i|ii|iii|iv|1|2|3|licensed|certified|registered|experienced|the|of|and|a|an|for|to|in|at|with)$/;
/** @param {string} s */
const titleWords = (s) => String(s || '').toLowerCase().replace(/\([^)]*\)/g, ' ').split(/\s+[-–—|]\s+|,/)[0].split(/[^a-z0-9&+]+/).filter((x) => x && !LEVEL_WORD.test(x));
/**
 * Two titles naming the same job by their own words: the same specific job noun at the end, or every word of the
 * listing's title inside the person's. Returns the plain why, or ''.
 * @param {string} personTitle @param {string} listingTitle
 */
function titleWordsMatch(personTitle, listingTitle) {
  const a = titleWords(personTitle); const b = titleWords(listingTitle);
  if (!a.length || !b.length) return '';
  const headA = a[a.length - 1]; const headB = b[b.length - 1];
  if (headA === headB && !GENERIC_NOUN.test(headA) && headA.length > 3) return `both titles name the job "${headB}"`;
  if (b.length >= 2 && b.every((x) => a.includes(x))) return `every word of the listing title is in your title`;
  return '';
}

/** Do the listing title's field words all sit inside the person's stated target ("food safety and quality assurance")? */
function insideTarget(phrase, title) {
  const ROLE = /^(technician|specialist|assistant|associate|coordinator|representative|officer|clerk|agent|lead|supervisor|manager|director|analyst|worker|senior|junior|staff|ii|iii|i|entry|level|trainee|apprentice|intern|generalist|partner|consultant|administrator)$/;
  const words = (/** @type {string} */ s) => String(s || '').toLowerCase().replace(/\([^)]*\)/g, ' ').split(/[^a-z]+/).filter((w) => w.length > 2 && !['and', 'the', 'for', 'with'].includes(w));
  const tw = new Set(words(phrase).map((w) => w.slice(0, 6)));
  const lw = words(title).filter((w) => !ROLE.test(w)).map((w) => w.slice(0, 6));
  return lw.length > 0 && lw.every((w) => tw.has(w));
}

/**
 * The decision for one listing. Same output shape as jobKeys.matchListing.
 * @param {any} job { title, company, description, location, source, id }
 * @param {any} keys the person's job keys (only their plain facts are read, as a fallback for the résumé text)
 * @param {{ now?: Date, alert?: boolean, mode?: 'rail'|'email', resumeText?: string }} [opts]
 */
export function matchListing(job, keys, { now = new Date(), alert = false, mode = 'rail', resumeText = undefined } = {}) {
  if (!job) return { ok: false, why: 'no_input' };
  const title = String(job.title || '').trim();
  if (!title) return { ok: false, why: 'no_title' };
  const text = typeof resumeText === 'string' && resumeText.trim() ? resumeText : textFromKeys(keys);
  if (!text) return { ok: false, why: 'no_input' };
  const person = readPerson(text, { now });
  const L = readListing(job);
  const req = budgetOf(`${textHash(text)}␟${now.getTime()}`);

  // ── 3. FIELD ────────────────────────────────────────────────────────────────────────────────────────────────
  /** @type {any} */
  let best = null;
  const consider = (/** @type {any} */ c) => { if (!best || c.strength > best.strength) best = c; };
  for (const r of person.direction) {
    // a role whose occupation was read from another of their roles (a military-specific title) is compared by code
    const x = r.occFrom && L.occ ? rel(r.occ.code, L.occ.code) : rel(r.title, title, { lines: r.lines });
    if (!x) continue;
    // relation's "could not place" is unknown, never "different"
    const unknown = x.relation === 'different' && /^could not place/.test(String(x.why || ''));
    // a ladder between two DIFFERENT occupations (a supervisor occupation over the listing's, a helper of it) is a
    // neighbouring line of work, not theirs: the rail at most, and a known step down when it points down
    const cross = !!(x.a && x.b && x.a.code !== x.b.code) && !/same title|same line of work/.test(String(x.why || ''));
    const crossDown = x.relation === 'ladder' && x.direction === 'down' && cross;
    if ((x.relation === 'same' || x.relation === 'ladder') && !cross) {
      consider({ kind: 'same', strength: 5, role: r, rel: x, crossDown, sure: (!!r.occ && !!L.occ) || /same title|same line of work/.test(String(x.why || '')) });
    } else if (x.relation === 'ladder' || x.relation === 'same') {
      consider({ kind: 'close', strength: 3, role: r, rel: x, crossDown });
    } else if (x.relation === 'related') {
      // O*NET's "related" list alone is not proof (measured on the working sets: 16 right, 23 wrong on the rail —
      // other trades, other licences, a lower rung). It counts when the work itself relates (below), or when the fit
      // engine reads the posting as a Good or Strong fit for this résumé (step 5).
      consider({ kind: 'related', strength: 0.5, role: r, rel: x });
    } else if (unknown) {
      // a listing title nothing places, read by its own words against theirs: the same specific job noun
      // ("Personal Lines Producer" / "Licensed Insurance Producer", "Trial Paralegal" / "Litigation Paralegal"), or
      // all its words inside their title ("Research Assistant" / "Undergraduate Research Assistant")
      const w = titleWordsMatch(r.title, title);
      if (w && !L.occ) consider({ kind: 'same', strength: 4.5, role: r, rel: { relation: 'same', why: w }, crossDown: false, sure: false });
      else consider({ kind: 'unknown', strength: 0, role: r, rel: x });
    }
  }
  for (const d of person.degrees) {
    if (!L.occ) continue;
    const x = rel(d.occ.code, L.occ.code);
    if (x && (x.relation === 'same' || (x.relation === 'ladder' && x.a?.code === x.b?.code))) consider({ kind: 'education', strength: 4, degree: d, rel: x });
  }
  if (person.target) {
    const t = person.target;
    let hit = false;
    if (t.occ && L.occ) { const x = rel(t.occ.code, L.occ.code); hit = !!x && (x.relation === 'same' || x.relation === 'ladder'); }
    if (!hit) hit = insideTarget(t.phrase, title);
    if (hit) consider({ kind: 'move', strength: 2, target: t });
  }
  // the work itself: for a listing the knowledge base cannot place against them, the same work activity between
  // the listing's duty lines and their current lines (exact / close only — precise by design)
  if ((!best || best.kind === 'unknown' || best.kind === 'related') && person.direction.length && !L.teaser) {
    const duties = dutyLines(job.description, ACTIVITY_LISTING_LINES);
    outer: for (const r of person.direction) {
      for (const line of r.lines.slice(0, ACTIVITY_RESUME_LINES)) {
        for (const d of duties) {
          let a = null;
          try { a = relateActivities(line, d); } catch { a = null; }
          if (a && a.relation === 'same' && (a.confidence === 'exact' || a.confidence === 'close')) {
            const was = best && best.kind === 'related' && best.role === r ? best : null;
            consider({ kind: was ? 'close' : 'activity', strength: was ? 3 : 1, role: r, rel: was?.rel, line, activity: a.via });
            break outer;
          }
        }
      }
    }
  }
  const relatedOnly = !!best && best.kind === 'related';
  if (relatedOnly) best = { ...best, kind: 'close', strength: 3, needsGoodFit: true };
  if (!best || best.kind === 'unknown') return { ok: false, why: person.direction.length || person.target || person.degrees.length ? 'field_unknown' : 'no_direction' };

  // their own earlier title ("HVAC Installer" for an HVAC Service Technician who was one in 2019): below their rung
  const dirSet = new Set(person.direction.map((r) => r.index));
  for (const old of person.roles) {
    if (dirSet.has(old.index)) continue;
    const x = rel(old.title, title);
    // …unless their current title is that same title with a seniority word added ("Litigation Paralegal" →
    // "Senior Litigation Paralegal"): a senior holds the plain job; a lead, supervisor or manager has moved past it
    const holdsIt = (/** @type {any} */ r) => { const y = rel(r.title, title); return !!y && ((y.relation === 'same' && /^the same title/.test(String(y.why || ''))) || (y.relation === 'ladder' && /^the same line of work/.test(String(y.why || '')) && r.rung - L.rung <= 0.5 && L.rung >= 2)); };
    if (x && x.relation === 'same' && /^the same title/.test(String(x.why || '')) && !person.direction.some(holdsIt)) {
      return { ok: false, why: 'own_earlier_rung' };
    }
  }

  // ── 4. RUNG ─────────────────────────────────────────────────────────────────────────────────────────────────
  if (best.kind === 'same' || best.kind === 'close' || best.kind === 'activity') {
    const pr = best.role.rung;
    const gap = L.rung - pr;
    if (gap > 1) return { ok: false, why: 'over_level' };
    // below their rung: a stated lower level, a job their occupation supervises, or — in a NEIGHBOURING occupation,
    // where a plain title is not "their job at an unstated level" — a title a full rung under theirs (Payroll Manager →
    // Bookkeeper; a grade numeral's half rung is not enough: Respiratory Therapist II → Pulmonary Function Technologist)
    // A person whose own title states no level is not placed above a junior / associate / grade-I posting of the work
    // (their level is unknown); an apprentice, trainee or helper posting is below anyone who already does the work.
    const unknownLevel = !best.role.rungStated && L.rung >= 1;
    if (!unknownLevel && ((gap < 0 && (L.rungStated || best.crossDown)) || (gap <= -1 && best.kind !== 'same'))) return { ok: false, why: 'below_rung' };
    // a neighbouring occupation that needs less preparation (a lower O*NET job zone) is a step down
    if (best.kind === 'close' && best.role.occ && L.occ && Number(L.occ.zone) && Number(best.role.occ.zone)) {
      if (Number(L.occ.zone) < Number(best.role.occ.zone)) return { ok: false, why: 'below_zone' };
      // …and one that needs two or more job zones more preparation is not a next step (LPN → nurse anesthetist)
      if (Number(L.occ.zone) - Number(best.role.occ.zone) >= 2) return { ok: false, why: 'over_zone' };
    }
  } else if (best.kind === 'education' || best.kind === 'move') {
    // a degree or a stated move opens the entry rungs: nothing above a plain title
    if (L.rung > 2) return { ok: false, why: best.kind === 'move' ? 'move_not_entry' : 'over_level' };
  }

  // an internship / co-op posting is for enrolled students
  if (L.marker === 'intern' && !person.studying) return { ok: false, why: 'internship_not_student' };
  // remote: an occupation whose work is done in person is not done from home, whatever the listing's location says
  if (L.remote && L.occ && handsOn(L.occ.code) === true) return { ok: false, why: 'not_remote_work' };

  const headlineKind = best.kind === 'same' && best.sure && !(best.rel && best.rel.relation === 'ladder' && best.rel.direction === 'down');
  // ── 7. TEASERS ──────────────────────────────────────────────────────────────────────────────────────────────
  if (L.teaser) {
    const edu = best.kind === 'education' && best.degree;
    if (!edu && (best.kind !== 'same' || !best.sure)) return { ok: false, why: 'teaser' };
    const reason = edu ? (text.includes(edu.field) ? `Entry level in your field: your ${[edu.degree, edu.field].filter(Boolean).join(' in ')}.` : '') : roleSentence(best.role, text);
    if (!reason) return { ok: false, why: 'no_reason' };
    return finish({ basis: edu ? 'education' : 'held', reason, rank: 240 + (!edu && best.role.current ? 40 : 0), summaryOnly: true, noHeadline: true, checks: [{ check: 'field', pass: true, basis: edu ? 'education' : 'held', occupation: L.occ?.code || null }, { check: 'level', pass: true, level: L.rung }] });
  }

  // ── 5. FIT ──────────────────────────────────────────────────────────────────────────────────────────────────
  const resumeKey = textHash(text);
  /** @type {import('./fit.js').Fit} */
  let fit;
  try {
    const peek = fitOfCached(text, job, now, resumeKey, req);
    if (!peek) return { ok: false, why: 'fit_budget' };
    fit = peek;
  } catch { req.skippedError++; return { ok: false, why: 'fit_error' }; }
  if (fit.gates.length) return { ok: false, why: `gate:${fit.gates[0].kind}`, gate: fit.gates[0] };
  if (!railFit(fit)) return { ok: false, why: `fit:${fit.bandKey || fit.fieldLevel}` };
  if (mode === 'email' && !alert && !emailFit(fit)) return { ok: false, why: `fit_email:${fit.bandKey || 'unscored'}` };
  if (best.needsGoodFit && !emailFit(fit)) return { ok: false, why: `related_unproven:${fit.bandKey || 'unscored'}` };

  // ── 6. LIMITS ───────────────────────────────────────────────────────────────────────────────────────────────
  if (fit.scheduleConflict) return { ok: false, why: 'limit:schedule', limit: fit.scheduleConflict };
  const conflict = limitConflict(personWants(person.head), listingConditions(title, fit.scheduleSentences));
  if (conflict) return { ok: false, why: 'limit', limit: conflict };

  // ── 8. SENTENCE ─────────────────────────────────────────────────────────────────────────────────────────────
  let reason = ''; let basis = 'held'; let rank = 0;
  if (best.kind === 'same') {
    reason = roleSentence(best.role, text);
    const up = best.rel.relation === 'ladder' && best.rel.direction === 'up' && L.rung > best.role.rung;
    if (up && reason) reason += ' This is one step up in the same line of work.';
    basis = up ? 'held' : 'title';
    rank = 300 + (best.role.current ? 60 : 0) - (up ? 10 : 0);
  } else if (best.kind === 'close') {
    const rs = roleSentence(best.role, text);
    const tl = String(best.role.title || '');
    const line = best.line && text.toLowerCase().includes(String(best.line).toLowerCase()) ? String(best.line).replace(/^./, (c) => c.toUpperCase()) : '';
    reason = rs ? `Close to your ${tl} job${best.role.company && text.includes(best.role.company) ? ` at ${best.role.company}` : ''}${line ? `, which shows the same work: "${line}".` : ': a neighbouring line of work.'}` : '';
    basis = 'close';
    rank = 220 + (best.role.current ? 30 : 0);
  } else if (best.kind === 'activity') {
    const line = String(best.line).replace(/^./, (c) => c.toUpperCase());
    reason = text.includes(best.line) || text.toLowerCase().includes(best.line.toLowerCase())
      ? `Your ${best.role.title} job${best.role.company && text.includes(best.role.company) ? ` at ${best.role.company}` : ''} shows this work: "${line}".` : '';
    basis = 'activity';
    rank = 160;
  } else if (best.kind === 'education') {
    const d = best.degree;
    reason = text.includes(d.field) ? `Entry level in your field: your ${[d.degree, d.field].filter(Boolean).join(' in ')}${d.year && text.includes(d.year) ? ` (${d.year})` : ''}.` : '';
    basis = 'education';
    rank = 260;
  } else if (best.kind === 'move') {
    const phrase = best.target.phrase;
    reason = text.includes(phrase) || text.toLowerCase().includes(phrase.toLowerCase()) ? `Your summary says you're moving into ${phrase}, and this is not above an entry-level title.` : '';
    basis = 'intent';
    rank = 200;
  }
  if (!reason) return { ok: false, why: 'no_reason' };
  if (fit.held.length) reason += ` ${fit.held[0]}`;
  rank += Math.round((fit.score ?? 50) / 5);
  const checks = [
    { check: 'field', pass: true, basis, occupation: L.occ?.code || null, relation: best.rel?.relation || best.kind },
    { check: 'level', pass: true, level: L.rung },
    { check: 'fit', pass: true, band: fit.bandKey, score: fit.score },
    { check: 'limits', pass: true },
  ];
  return finish({ basis, reason, rank, summaryOnly: false, noHeadline: !headlineKind || basis === 'intent', checks, fit });

  /** @param {any} r */
  function finish(r) {
    return { ok: true, occupation: L.occ?.code || `title:${title.toLowerCase()}`, basis: r.basis, reason: r.reason.replace(/\s+/g, ' ').trim(), rank: r.rank, need: null, have: null, haveFrom: null, level: L.rung, summaryOnly: !!r.summaryOnly, sameRung: false, side: false, checked: [], checks: r.checks, noHeadline: !!r.noHeadline, via: best.kind, fit: r.fit ? { band: r.fit.bandKey, score: r.fit.score } : null };
  }
}

/** The fit engine for this listing, from the cache or a new run inside the request's budget; null when spent. */
function fitOfCached(text, job, now, resumeKey, req) {
  // a cached answer costs nothing: only a new run is budgeted
  if (req.runs >= FIT_BUDGET) return peekFit(job, { resumeKey });
  const f = fitOf(text, job, { now, resumeKey });
  if (!f.cached) { req.runs++; req.ms += f.ms; }
  return f;
}

// the seam's marker: this matcher runs the fit engine itself, so the caller's shared gate is not applied again
matchListing.selfGated = true;
