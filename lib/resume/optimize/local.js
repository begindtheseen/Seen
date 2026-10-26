// Seen's résumé optimizer with no model API (owner decision 2026-10-26: "We are not relying on api").
//
// Everything here is Seen's own code: the posting is read by lib/optimizer (requirements, evidence,
// screening constraints), the résumé by lib/server/prepFacts (every fact numbered), lines are restated
// by lib/resume/rewrite (rules that restate and never add), and every line still goes through the same
// checks as before (grammar and tense, claim-by-claim grounding — lib/resume/optimize/claims.js).
//
// The idea that makes it work without a model: Seen writes every question itself, so it knows where
// each answer goes. A question carries a SLOT:
//   - scale   (a bullet with no number) → the answer's figure is added to that bullet;
//   - outcome (a duty with no result)   → the answer's result is joined to that bullet;
//   - stepup / requirement (no bullet)  → a yes-answer with details becomes a new line in the
//     person's own words ("I run the store on the manager's two days off" → "Run the store on the
//     Store Manager's two days off");
//   - credential                        → what to put under Certifications.
// The answer is the person's words; Seen only turns first person into résumé form and fixes tense.

import { rewriteBullet } from '../rewrite/rules.js';
import { findMetrics, analyzeLead } from '../health/bullet.js';
import { checkBullet, verbBase } from './grammar.js';
import { pastTense } from '../rewrite/inflect.js';
import { bulletById } from '../../server/prepFacts.js';
import { spokenLength } from '../../server/prepClaims.js';
import { guardDiagnosis, guardRewrites, affirmative, requirementQuestion, degreeLevel } from './engine.js';
import { norm } from './claims.js';
import { prepFamily } from '../../server/interviewPrep.js';
import { sectionPosting, RULED_OUT_RE } from '../../optimizer/postingSections.js';

const clean = (s, n = 400) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const lcFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const capFirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const short = (t, n = 60) => { const s = clean(t); return s.length <= n ? s : `${s.slice(0, s.lastIndexOf(' ', n - 1))}…`; };

// A result word says the line already has an outcome ("cut", "grew", "raised", "%", "award").
const RESULT_RE = /\b(?:cut|grew|raised|reduced|increased|improved|saved|lifted|boosted|won|earned|ranked|named|recogni[sz]ed|award|top|record|zero|passed|hit|exceeded|beat|achieved|kept|held|retained|promoted)\b|\d+(?:\.\d+)?%|#\d/i;

// ── answers → résumé language ───────────────────────────────────────────────────────────────────
const LEAD_NOISE_RE = /^(?:yes|yeah|yep|yup|sure|correct|right|mostly|definitely|absolutely|kind of|sort of|some|sometimes|a little|i think|i'd say|honestly|well)\b[\s,.:;—–-]*/i;

/**
 * The person's answer as a résumé clause: no "I", "my" → "the", tense for the job, a capital first.
 * Returns '' when what is left does not start with something they did (it stays an interview note).
 */
/** "the SM" → "the Store Manager": initials of a title on the résumé or in the posting, written out. */
export function expandInitials(text, titles = []) {
  let t = String(text || '');
  for (const title of titles) {
    const words = String(title || '').split(/[^A-Za-z]+/).filter((w) => w.length > 1 && !/^(?:of|and|the|for|at|ii|iii|iv)$/i.test(w));
    if (words.length < 2) continue;
    const ini = words.map((w) => w[0].toUpperCase()).join('');
    t = t.replace(new RegExp(`\\b${ini}(?=['’]s\\b|\\b)`, 'g'), words.map((w) => capFirst(w)).join(' '));
  }
  return t;
}

export function fromFirstPerson(answer, { current = false, titles = [] } = {}) {
  let t = expandInitials(clean(answer, 300), titles);
  for (let i = 0; i < 3; i++) t = t.replace(LEAD_NOISE_RE, '');
  // the first sentence that states something they did ("Yes, regularly. I run the store on…" → the second)
  // split into clauses — never inside parentheses — and at ", and I …" so each clause is one fact
  const parts = [];
  let depth = 0, cur = '';
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '(') depth += 1;
    if (c === ')') depth = Math.max(0, depth - 1);
    cur += c;
    const rest = t.slice(i + 1);
    if (depth === 0 && (/[.!?;]/.test(c) && /^\s/.test(rest) || /^,?\s+(?:and|but)\s+(?:i|we)\b/i.test(rest) || /^\s+[—–]\s+/.test(rest))) {
      parts.push(cur.trim()); cur = '';
      const m = rest.match(/^,?\s+(?:and|but)\s+(?=(?:i|we)\b)|^\s+[—–]\s+/i);
      if (m) i += m[0].length;
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  for (const part of parts) {
    if (/^(?:not sure|no\b|i don'?t know|skip|n\/a)/i.test(part)) continue;
    // an aside about "we"/"I" in parentheses is context for the interview, not the line
    let p = part.replace(/[.!?;]+$/, '').replace(/\s*\((?:[^)]*\b(?:I|we|my|our|us)\b[^)]*)\)/gi, '');
    // "After a deadline scare in 2020, I added…" → "Added … after a deadline scare in 2020"
    const opener = p.match(/^((?:after|when|during|in|on|before|since|for|with)\b[^,]{3,70}?),?\s+(?:I|we)\s+(?=[a-z])/i);
    if (opener && !/\b(?:I|we)\b/i.test(opener[1])) {
      // the "when" goes right after the main clause, before ", and the firm still uses it"
      const body = p.slice(opener[0].length);
      const cut = body.search(/,?\s+and\s+(?:the|it|they|this|that)\b/i);
      p = cut > 0 ? `${body.slice(0, cut)} ${lcFirst(opener[1])}${body.slice(cut).replace(/^\s+and/, ', and')}` : `${body} ${lcFirst(opener[1])}`;
    }
    // "I helped install 3–4 package units as a helper" → "Installed 3–4 package units as a helper": the
    // helper role stays in the line, so nothing is inflated
    p = p.replace(/^((?:I|we)\s+)?helped(?:\s+to)?\s+([a-z]+)\b(.*\bas (?:a|the) (?:helper|second man|trainee|assistant)\b.*)$/i, (m, i, v, rest) => `${i || 'I '}${pastTense(verbBase(v) || v)}${rest}`);
    // "… when she was out": who else was where is context, not the line
    p = p.replace(/,?\s+(?:when|while|because|since)\s+(?:she|he|they)\b[^,;]*$/i, '');
    p = p.replace(/^(?:i|we)\s+(?:also\s+|usually\s+|normally\s+|typically\s+|mostly\s+)?/i, '').replace(/^(?:i'?ve|we'?ve)\s+/i, '').replace(/^(?:i'?m|we'?re)\s+/i, '');
    p = p.replace(/\b(?:my|our) own\s+/gi, '').replace(/\b(?:my|our)\b/gi, 'the').replace(/\bthe the\b/gi, 'the').replace(/\s{2,}/g, ' ').trim();
    if (p.split(/\s+/).length < 3 || /\b(?:I|me|we|us|she|he|they)\b/.test(p) || (p.match(/\(/g) || []).length !== (p.match(/\)/g) || []).length) continue;
    // the person's own tense stands: "I did the interviews" about 2023 hires stays past in a current job
    const lead = analyzeLead(capFirst(p));
    const g = checkBullet(capFirst(p), { current: current && lead.tense !== 'past' });
    if (g.ok) return g.text;
  }
  return '';
}

/** A figure from an answer ("about 900–950 a week, more in Nov–Dec") as a short phrase, or ''. */
const UNSURE_RE = /\b(?:not sure|don'?t know|no idea|i'?d have to check|unsure|i think|i guess|maybe|probably)\b/i;
export function figureFrom(answer) {
  const t = clean(answer, 200).replace(LEAD_NOISE_RE, '');
  const NUM = '(?:\\$?\\d|(?:one|two|three|four|five|six|a dozen|a couple)\\b)';
  if (!new RegExp(NUM, 'i').test(t) || UNSURE_RE.test(t.split(/(?<=[.!?])\s+/)[0])) return '';
  // only a clean figure: it starts with the number or "about/up to/over/nearly" + the number
  if (!new RegExp(`^(?:about|around|roughly|up to|over|nearly|almost|more than|at least)?\\s*${NUM}`, 'i').test(t)) return '';
  const first = t.split(/(?<=[.!?])\s+/)[0].replace(/[.!?]+$/, '');
  const words = first.split(/\s+/);
  if (words.length > 14) return '';
  if (/^(?:i|we)\b/i.test(first)) return '';
  return lcFirst(first.replace(/^(?:it'?s|its|that'?s|that was|it was|around|roughly)\s+/i, (m) => (/around|roughly/i.test(m) ? 'about ' : '')).trim());
}

// Chat voice that never goes on a résumé as is.
const CHAT_RE = /\b(?:leaned on|kind of|sort of|stuff|a bunch|pretty much|basically|honestly|i guess|gonna|wanna|tons? of|super\b|a lot of|lots of|figured out|picked up|got to|ended up|if that counts|i think|maybe|probably)\b/i;
const CREDENTIAL_LINE_RE = /^(?:passed|earned|hold|got)\b[^.]*\b(?:exam|sections?|FAR|AUD|REG|BEC|license|licen[cs]e|certif\w*|card)\b|^(?:certified|licensed)\b/i;

/**
 * The résumé lines an answer gives: every clause that states something the person did, in résumé form,
 * ranked by what it adds (numbers, the posting's words, named things). Clauses that only repeat a line,
 * hedge, chat, lean on an "it" with nothing before it, or are a credential (those go under
 * Certifications) are left out.
 */
// How people talk about their own work, turned into résumé words before a clause is read.
function tidyAnswer(t) {
  return clean(t, 600)
    .replace(/\s*\((?:about|around|roughly)?\s*\d+%\s+of mine\)/gi, (m) => m.replace(/\s+of mine/i, ' of the assignment'))
    .replace(/\bof mine\b/gi, '')
    .replace(/\bI(?:'ve| have) done\b/g, 'I handled')
    .replace(/:\s+I\s+/g, ', ')
    .replace(/\binformal\s+/gi, '')
    // a qualifier that takes the line back ("…, but it's insurance, not software", "…, not formal minutes")
    .replace(/,?\s+but\s+(?:it'?s|it is|that'?s|i'?ve never|i never|i don'?t|i didn'?t|not)\b[^.;]*/gi, '')
    .replace(/,\s+not\s+[^.;,]*(?=[.;]|$)/gi, '')
    // "…the ESL teacher, who pulls 3–5 of them": a clause about someone else, pointing at nothing
    .replace(/,\s+(?:who|which)\b[^.;,]*\b(?:them|it)\b[^.;]*/gi, '');
}
/** "heart blocks, PVCs, V-tach" → "heart blocks, PVCs and V-tach" (outside parentheses). */
function finishList(line) {
  const open = line.lastIndexOf('(') > line.lastIndexOf(')');
  if (open || (line.match(/,/g) || []).length < 2 || /\band\b[^,]*$/.test(line) || /\)$/.test(line)) return line;
  return line.replace(/,\s+([^,]+)$/, ' and $1');
}
const NEGATION_RE = /\b(?:never|not|no|none|haven'?t|hasn'?t|don'?t|doesn'?t|didn'?t|wasn'?t|isn'?t|aren'?t|can'?t|won'?t|nobody)\b/i;
// "I see the monthly P&L summary … and explain the shrink and labor lines" → the doing verb leads.
const WEAK_SEE_RE = /^(?:see|get|receive|read|look at|sit in on|attend)\s+(the\s.+?)\s+and\s+([a-z]+)\s+(.+)$/i;
/** The duty itself, confirmed by an elliptical yes: "Yes, on monitored overflow patients…" → duty + "on …". */
function dutyLine(duty, answer) {
  const core = clean(duty).replace(/[.;:]+$/, '').replace(/\b(?:engaging|dynamic|exciting|innovative|world-class|fast-paced)\s+/gi, '').replace(/\bour\b/gi, 'the').replace(/\byour\b/gi, 'the');
  const t = tidyAnswer(answer);
  const first = t.split(/(?<=[.!?])\s+/)[0];
  if (!/^(?:yes|yeah|yep|partly|some|sometimes|regularly|daily|often)\b|\byes\b/i.test(first) || /\bI\s+[a-z]+/.test(first)) return '';
  // a part of the duty they said no to ("never LinkedIn", "Building automation, no") stays out
  const denied = t.split(/(?<=[.!?;,])\s+/).filter((x) => NEGATION_RE.test(x) || /\bonly\b/i.test(x)).flatMap(contentOf);
  const keepOut = (line) => !denied.some((w) => contentOf(line).includes(w));
  const spec = first.replace(/^.*?\byes\b[,.:]?\s*/i, '').replace(/^(?:yes|partly|some)\b[,.:]?\s*/i, '').replace(/[.!]+$/, '');
  const list = spec.match(/^(?:daily|often|regularly|every day)?\s*:?\s*([^:]*?:\s*)?(.+)$/i);
  const until = core.replace(/,?\s+including\b.*$/i, '');
  if (/^(?:on|for|with|at|in|across|during)\b/i.test(spec) && !NEGATION_RE.test(spec) && keepOut(`${core} ${spec}`)) return `${core} ${spec}`;
  if (/:/.test(first) && list && !NEGATION_RE.test(list[2]) && keepOut(`${until} ${list[2]}`)) {
    // counts and frequencies ride in parentheses; a list of things follows a colon
    return /\d|\btimes\b/.test(list[2]) ? `${until} (${list[2].replace(/\s+and\s+/, ', ').replace(/\s*\(([^)]*)\)/g, ', $1')})` : `${until}${/daily|every day/i.test(first) ? ' daily' : ''}: ${list[2]}`;
  }
  const fig = figureFrom(t.replace(/^[^.]*\byes\b[.,]?\s*/i, ''));
  if (fig && !NEGATION_RE.test(fig) && keepOut(core)) return `${core} (${fig.replace(/\s+at\s+[A-Z][\w ]+$/, '')})`;
  return '';
}

export function answerLines(answer, { current = false, titles = [], posting = '', avoid = [], duty = '' } = {}) {
  const raw = tidyAnswer(answer);
  const confirmed = duty ? dutyLine(duty, answer) : '';
  const pieces = raw.split(/(?<=[.!?;])\s+|\s+[—–]\s+|,\s+(?:and|but)\s+(?=(?:I|we)\b)/i).map((x) => x.trim()).filter(Boolean);
  const postWords = new Set(norm(posting).split(/[^a-z0-9&+#]+/).filter((w) => w.length > 3).map((w) => w.slice(0, 5)));
  const out = [];
  let lastObject = '';
  if (confirmed) {
    const g = checkBullet(capFirst(finishList(confirmed)), { current });
    if (g.ok && !avoid.some((x) => repeats(x, confirmed))) out.push({ line: g.text.replace(/[.;]\s*$/, ''), score: 5 });
  }
  for (const piece of pieces) {
    if (UNSURE_RE.test(piece) || CHAT_RE.test(piece) || NEGATION_RE.test(piece.replace(/^(?:no|not)\b[^.]*\.\s*/i, ''))) continue;
    let line = fromFirstPerson(piece, { current, titles });
    const weak = line && line.match(WEAK_SEE_RE);
    if (weak) line = `${capFirst(weak[2])} ${weak[3]} of ${weak[1]}`;
    // "ran it alone" after "run the store …" → "ran the store alone"
    if (line && lastObject) line = line.replace(/^(\S+)\s+it\b/i, `$1 ${lastObject}`);
    const obj = line && line.match(/^\S+\s+((?:the|a|an)\s+[\w'’-]+(?:\s+[\w'’-]+)?)(?=\s+(?:on|for|in|at|with|to|from|during|every|each|and)\b|$)/i);
    if (obj) lastObject = obj[1];
    if (!line || line.split(/\s+/).length < 5 || CHAT_RE.test(line) || CREDENTIAL_LINE_RE.test(line)) continue;
    // an "it" / "them" in the first words points at something only the question named
    if (/^\S+(?:\s+\S+){0,3}\s+(?:it|them|this|that|those|these)\b/i.test(line) && line.split(/\s+/).length < 9) continue;
    if (avoid.some((x) => repeats(x, line))) continue;
    const tail = line.match(/,\s+(?:about|around|roughly)\s+[^,]+$/);
    if (tail && sameFigure(line.slice(0, tail.index), tail[0])) {
      const unit = (tail[0].match(/\ba (week|month|day|shift|year)\b/) || [])[1];
      line = `${line.slice(0, tail.index)}${unit && !new RegExp(`\\b(?:each|every|a) ${unit}\\b`).test(line.slice(0, tail.index)) ? ` each ${unit}` : ''}`;
    }
    // "heart blocks, PVCs, V-tach" → "heart blocks, PVCs and V-tach"
    line = finishList(line);
    const words = norm(line).split(/[^a-z0-9&+#]+/).filter((w) => w.length > 3);
    const score = (line.match(/\d/g) ? 3 : 0) + words.filter((w) => postWords.has(w.slice(0, 5))).length + (line.match(/\b[A-Z][a-zA-Z]*[A-Z]\w*|\b[A-Z]{2,}\b/g) || []).length;
    if (!/\d/.test(line) && score < 1) continue;
    out.push({ line: line.replace(/[.;]\s*$/, ''), score });
  }
  // "Second man the first year, lead installer after that" → a promotion line
  const promo = raw.match(/^(?:yes[,.]?\s*)?([A-Za-z][\w\s-]{2,30}?) (?:the|my) first (year|two years|\d+ months?),?\s*(?:then\s+|and\s+)?([A-Za-z][\w\s-]{2,30}?) (?:after that|since|from then on)\b/i);
  if (promo && !out.length) out.push({ line: `Promoted from ${lcFirst(promo[1].trim())} to ${lcFirst(promo[3].trim())} after the first ${promo[2]}`, score: 2 });
  // a numbered fact said as a noun sentence ("About 30% of my assignment are telemetry overflow") rides
  // in parentheses on the answer's own action line
  const fact = pieces.map((x) => x.replace(/[.!?;]+$/, '')).find((x) => /\d/.test(x) && !/^(?:yes|no)\b/i.test(x) && !/^(?:I|we)\b/i.test(x) && /\b(?:my|our|the)\b/i.test(x) && x.split(/\s+/).length <= 16 && !UNSURE_RE.test(x) && !CHAT_RE.test(x));
  if (fact && out.length && !/\d/.test(out[0].line)) {
    const f = withoutPronouns(lcFirst(fact.replace(/\b(?:my|our)\b/gi, 'the')));
    if (f && `${out[0].line} (${f})`.split(/\s+/).length <= 30) out[0] = { ...out[0], line: `${out[0].line} (${f})` };
  }
  return out.sort((x, y) => y.score - x.score).map((x) => x.line).filter((l, i, all) => !all.slice(0, i).some((m) => repeats(m, l)));
}

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, dozen: 12 };
const numbersIn = (t) => [...norm(t).matchAll(/\b(\d[\d,.]*|one|two|three|four|five|six|seven|eight|nine|ten|twelve|dozen)\b/g)].map((m) => NUMBER_WORDS[m[1]] ?? Number(m[1].replace(/,/g, '')));
/** A figure whose numbers the line already has ("two days off" + "about 2 days a week") adds nothing. */
function sameFigure(line, fig) {
  const have = new Set(numbersIn(line));
  const add = numbersIn(fig);
  return norm(line).includes(norm(fig)) || (add.length > 0 && add.every((n) => have.has(n)));
}
/** "Crew's 14, 20–22 in peak with temps" → "20–22 at peak with temps" when the line says 14. */
function peakFigure(answer, line, noun = '') {
  if (!/\b(?:peak|busiest|holiday|season\w*|rush|blitz)\b/i.test(answer)) return '';
  const counted = noun && line.match(new RegExp(`(\\d[\\d,]*)\\+?\\s+(?:[a-z-]+\\s+)?${noun.slice(0, 5)}`, 'i'));
  const have = counted ? Number(counted[1].replace(/,/g, '')) : Math.max(0, ...numbersIn(String(line).replace(/\(?\d{1,2}(?::\d{2})?\s*(?:AM|PM)\s*[–-]\s*\d{1,2}(?::\d{2})?\s*(?:AM|PM)\)?|\b\d{1,2}:\d{2}\b|\b\d+(?:st|nd|rd|th)\b/gi, '')));
  const m = clean(answer).match(/(\d[\d,]*\s*[–-]\s*\d[\d,]*|\d[\d,]*\+?)(?=[^.]*\b(?:peak|busiest|holiday|season|rush|blitz))/i) || clean(answer).match(/(?:peak|busiest|holiday|rush)[^.\d]{0,30}(\d[\d,]*\s*[–-]\s*\d[\d,]*|\d[\d,]*\+?)/i);
  if (!m) return '';
  const top = Math.max(...numbersIn(m[1]));
  if (!(top > have)) return '';
  const own = (clean(answer).match(/\bon ((?:blitz|busy|peak|holiday|launch) days)\b/i) || [])[1];
  const when = own ? `on ${own.toLowerCase()}` : /\bholiday/i.test(answer) ? 'at holiday peak' : 'at peak';
  return `${m[1].replace(/\s*([–-])\s*/, '–')} ${when}${/\btemps?\b/i.test(answer) ? ' with temps' : ''}`;
}

/** The answer's new detail ("with explanations for anything over $25K / 10%") joined to the line it is about. */
function detailMerge(ctx, answer, rewrites) {
  const t = tidyAnswer(answer).replace(/^(?:yes|yeah|yep)\b[.,]?\s*/i, '');
  if (!t || NEGATION_RE.test(t.split(/[.;]/)[0]) || UNSURE_RE.test(t) || /^(?:I|we)\b/i.test(t)) return null;
  const aw = new Set(contentOf(t));
  const all = ctx.sheet.jobs.slice(0, 2).flatMap((j) => j.bullets.map((b) => ({ ...b, job: j })));
  const home = all.map((b) => ({ b, n: contentOf(b.text).filter((w) => aw.has(w)).length })).sort((x, y) => y.n - x.n)[0];
  if (!home || home.n < 3) return null;
  const base = rewrites.find((x) => x.id === home.b.id)?.text || home.b.text;
  const have = new Set(contentOf(base));
  const chunk = t.split(/,\s+|;\s+|\.\s+/).map((x) => x.replace(/[.;]+$/, '').trim())
    .find((x) => /^(?:with|including|for anything|over|across|covering)\b/i.test(x) && contentOf(x).filter((w) => !have.has(w)).length >= 2 && x.split(/\s+/).length <= 12);
  if (!chunk) return null;
  const text = `${base.replace(/[.;]\s*$/, '')}, ${lcFirst(chunk)}`;
  return checkBullet(text, { current: home.b.job.current }).ok && text.length <= 240 ? { id: home.b.id, text } : null;
}

/** The bullet (of this job) one part of which the new line restates and extends, rewritten with it. */
function mergeInto(job, line, rewrites) {
  const lw = new Set(contentOf(line));
  for (const b of job.bullets) {
    const text = rewrites.find((x) => x.id === b.id)?.text || b.text;
    const parts = text.split(/;\s+/);
    for (let i = 0; i < parts.length; i++) {
      const pw = [...new Set(contentOf(parts[i]))];
      if (pw.length < 3) continue;
      const share = pw.filter((w) => lw.has(w)).length / pw.length;
      // the new line covers most of this part and adds to it, and keeps any number the part had
      if (share >= 0.5 && pw.filter((w) => lw.has(w)).length >= 2 && lw.size > pw.length && numbersIn(parts[i]).every((n) => numbersIn(line).includes(n))) {
        const out = [...parts]; out[i] = i === 0 ? line : lcFirst(line);
        const t = out.join('; ');
        if (checkBullet(t, { current: job.current }).ok && t.length <= 240) return { id: b.id, text: checkBullet(t, { current: job.current }).text.replace(/[.;]\s*$/, '') };
      }
    }
  }
  return null;
}

/** The figure goes right after the counted thing it is about ("crew of 14 associates (20–22 at peak)"), not at the end. */
function withFigure(line, fig, noun = '') {
  const nouns = [...line.matchAll(/\b\d[\d,]*\+?\s+(?:[a-z-]+\s+)?([a-z]{4,})\b/gi)];
  const peak = /\bat peak|on \w+ days|at holiday peak/.test(fig);
  const hit = peak ? (nouns.find((m) => noun && m[1].toLowerCase().startsWith(noun.slice(0, 5))) || nouns[0]) : null;
  if (!hit) return `${line} (${fig})`;
  const per = line.slice(hit.index + hit[0].length).match(/^\s+(?:a|an|per|each)\s+(?:day|week|month|shift|quarter)\b/i);
  const at = hit.index + hit[0].length + (per ? per[0].length : 0);
  const rest = line.slice(at);
  if (/^\s*\(/.test(rest)) return `${line.slice(0, at)} (${fig}; ${rest.replace(/^\s*\(/, '')}`;
  return `${line.slice(0, at)} (${fig})${rest}`;
}
/** A line whose number the person says is only the peak: the usual number leads, the peak in parentheses. */
function usualFigure(answer, line) {
  const t = clean(answer);
  const range = (x) => x.replace(/\s*[–-]\s*/, '–');
  for (const m of line.matchAll(/(\d[\d,]*\s*[–-]\s*\d[\d,]*|\d[\d,]*\+?)(\s+[a-z]+)/gi)) {
    const n = range(m[1]);
    const said = t.match(new RegExp(`${n.replace(/[–-]/, '\\s*[–-]\\s*').replace('+', '\\+')}[^.]*\\b(?:was|is|only|at)\\s+(?:the\\s+)?peak|peak[^.]*${n.replace(/[–-]/, '\\s*[–-]\\s*').replace('+', '\\+')}`, 'i'));
    const off = t.match(/\b(?:off-?peak|normally|usually|most (?:days|weeks|shifts)|typical(?:ly)?|normal)\b[^.\d]{0,30}(\d[\d,]*\s*[–-]\s*\d[\d,]*|\d[\d,]*)/i);
    if (said && off) return line.replace(m[0], `${range(off[1])}${m[2]} (${n} at peak)`);
  }
  return '';
}

/** "my station" → "the station", "since I started" → "since starting"; '' when an "I" is left mid-line. */
export function withoutPronouns(text) {
  let t = clean(text).replace(/\b(?:after|when|since|before|once) we (started|began|switched|moved|added|introduced)\b/gi, (m, v) => m.replace(/\bwe\b/i, 'the team')).replace(/\b(?:my|our) own\s+/gi, '').replace(/\bsince (?:i|we) (?:started|joined|began)\b/gi, 'since starting').replace(/\bwhen (?:i|we)\b/gi, 'when')
    .replace(/\b(?:my|our)\b/gi, 'the').replace(/\bthe the\b/gi, 'the');
  return /\b(?:I|me|we|us|myself)\b/.test(t) ? '' : t;
}

// ── questions that unlock a better line ─────────────────────────────────────────────────────────
const COUNT_ASKS = [
  [/^(?:lead|led|supervis\w*|manag\w*|run|ran|oversee|oversaw|direct\w*)\b[^.]*\b(?:team|crew|staff|shift|associates|people|department|employees|agents|techs?|nurses)\b/i, 'how many people do you lead on a normal shift, and at peak?'],
  [/^(?:train\w*|coach\w*|mentor\w*|precept\w*|onboard\w*)\b/i, 'about how many people have you trained?'],
  [/^(?:answer\w*|handl\w*|resolv\w*|serv\w*|help\w*|assist\w*|greet\w*|car(?:e|ed)\b|support\w*)/i, 'about how many a day — customers, calls, tickets or patients?'],
  [/^(?:schedul\w*|build\w* (?:the )?schedule|plan\w*|budget\w*|forecast\w*)/i, 'how big is it — hours, people or dollars?'],
  [/^(?:sell|sold|clos\w*|prospect\w*)\b|^(?:book|set)\w*\b[^.]*\b(?:meetings|appointments|demos|calls)\b/i, 'how many a week or month, and against what goal?'],
  [/^(?:build|built|creat\w*|design\w*|wr(?:ite|ote)|launch\w*|automat\w*|develop\w*)\b/i, 'who uses it, and about how many?'],
];
function countQuestion(text) {
  for (const [re, ask] of COUNT_ASKS) if (re.test(text)) return ask;
  return '';
}
const NOUN_SIZES = /(\d[\d,]*(?:\s*[–-]\s*\d[\d,]*)?\+?)\s+(?:[a-z-]+\s+)?(associates|people|employees|staff|agents|calls|tickets|customers|patients|guests|covers|orders|units|trailers|accounts|meetings|reports|students|direct reports)\b/gi;
/** "The posting says a crew of 15–25; your line says 14 — what's the most you've led, at peak?" */
function scopeQuestions(ctx, pool) {
  const out = [];
  const posting = String(ctx.jobDescription || '');
  for (const m of posting.matchAll(NOUN_SIZES)) {
    const noun = m[2].toLowerCase();
    const want = Number(String(m[1]).replace(/,/g, '').split(/[–-]/).pop().replace(/\+/, ''));
    const line = pool.find((b) => new RegExp(`\\b${noun.slice(0, 5)}`, 'i').test(b.text) && /\d/.test(b.text));
    if (!line || out.some((q) => q.bullet === line.id)) continue;
    const have = [...line.text.matchAll(new RegExp(`(\\d[\\d,]*)\\+?\\s+(?:[a-z-]+\\s+)?${noun.slice(0, 5)}`, 'gi'))].map((x) => Number(x[1].replace(/,/g, '')));
    if (!have.length || Math.max(...have) >= want || want > Math.max(...have) * 4) continue;
    out.push({ bullet: line.id, ask: `The posting mentions ${clean(m[0])}; your line says ${have[0]}. What is the most ${noun} you have handled at once — at peak or on your busiest day?`, why: 'Your real peak may already meet what the posting asks for.', kind: 'scale', choices: [] });
  }
  return out;
}

const SOFT_RE = /\b(?:confidential\w*|discretion|integrity|positive attitude|professional\w*)\b/i;
const DUTY_STOP = new Set('with from that this have will your their they them into over each every other what when also more most such than then about across within using including work team teams company customer customers clear notes plain language per protocol'.split(' '));
const stem5 = (w) => w.replace(/(?:ing|ed|es|e|s)$/, '').replace(/([b-df-hj-np-tv-z])\1$/, '$1').slice(0, 5);
// Words a résumé says another way: the CRM it names, the drawer for the till.
const SAME_AS = [[/\b(?:salesforce|hubspot|pipedrive)\b/i, 'crm'], [/\b(?:drawer|register)\b/i, 'till'], [/\b(?:tableau|power bi|looker)\b/i, 'dashb'], [/\bebt\b/i, 'snap']];
const withSame = (set, raw) => { for (const [re, w] of SAME_AS) if (re.test(raw)) set.add(w); return set; };
const contentOf = (t) => norm(t).split(/[^a-z0-9&+#]+/).filter((w) => w.length > 3 && !DUTY_STOP.has(w) && !/ly$/.test(w)).map(stem5);
/** How much of a posting line the best résumé line already covers (0–1). */
function covered(line, all) {
  const want = [...new Set(contentOf(line))];
  if (!want.length) return 1;
  const text = withSame(new Set(contentOf(all.map((b) => b.text).join(' '))), all.map((b) => b.text).join(' '));
  return want.filter((w) => text.has(w)).length / want.length;
}
// Duties every job of the kind has, which never decide a hire ("Document every interaction", "Meet goals").
const GENERIC_DUTY_RE = /^(?:meet|follow|comply|perform other|other duties|document|maintain a clean|attend|support the team|work (?:closely )?with|work as (?:a|part of)|collaborate|partner with (?:the )?team)\b|\bas assigned\b/i;
/** The posting's main duties the résumé does not show, asked as "Have you done this: …?" (at most 2). */
function dutyQuestions(ctx, all) {
  const out = [];
  for (const x of sectionPosting(ctx.jobDescription)) {
    if (x.kind !== 'responsibilities' || out.length >= 2) continue;
    const duty = clean(x.sentence).replace(/^[•●▪◦*·\-–—\s]+/, '').replace(/[.;:]+$/, '');
    if (duty.split(/\s+/).length < 4 || GENERIC_DUTY_RE.test(duty) || /[?"“”]/.test(duty)) continue;
    if (SOFT_RE.test(duty)) continue;
    // a duty is a list line that starts with what you would do ("Troubleshoot…"), not the posting's
    // summary prose ("The Telemetry RN provides…", "You'll be the person who…")
    const lead = analyzeLead(duty);
    if (lead.kind !== 'strong' && lead.kind !== 'generic' && lead.kind !== 'verb' || lead.tense === 'past' || /^(?:the|a|an|you|we|our|as|this|in|on)\b/i.test(duty)) continue;
    // shown when a line does the same thing (its verb or its object) and covers a third of its words
    const [verb, ...rest] = contentOf(duty);
    const object = rest.find((w) => !/ly$/.test(w));
    const text = withSame(new Set(contentOf(all.map((b) => b.text).join(' '))), all.map((b) => b.text).join(' '));
    const share = covered(duty, all);
    if (share >= 0.5 || ((text.has(verb) || (object && text.has(object))) && share >= 0.3)) continue;
    out.push({ bullet: null, ask: `Have you done this: “${short(duty.replace(/\bour\b/gi, 'the'), 110)}”?`, why: 'It is one of the main duties in the posting, and your résumé does not show it yet.', kind: 'requirement', choices: ['Yes', 'Some', 'No'] });
  }
  return out;
}
/** Named specifics inside a requirement the résumé otherwise meets: "Advanced SQL (joins, window functions, CTEs)", "medications, including cardiac drips". */
function specificQuestions(ctx, all) {
  const out = [];
  const resume = norm(ctx.resumeText);
  for (const x of sectionPosting(ctx.jobDescription)) {
    if (!['requirements', 'responsibilities', 'preferred'].includes(x.kind) || out.length >= 2 || /\b(?:on-?call|rotation|nights?|weekends?|shifts?|travel|schedule|hours)\b/i.test(x.sentence)) continue;
    const m = clean(x.sentence).match(/\((?!required|preferred)([^)]{3,80})\)|\b(?:including|such as)\s+([^,.;]{3,60})/i);
    if (!m) continue;
    const items = (m[1] || m[2]).split(/,\s*|\s+(?:and|or)\s+/).map((t) => t.trim()).filter((t) => t && t.split(/\s+/).length <= 4 && !/\d|\b(?:one|two|three|week|month|year|day)s?\b/i.test(t));
    const missing = items.filter((t) => !new RegExp(`\\b${norm(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/s\b/, 's?')}`).test(resume));
    // only when the line is otherwise on the résumé (the specifics are the open question), and a list
    // of alternatives ("Zendesk, Freshdesk, or ServiceNow") is met by any one of them
    if (!missing.length || missing.length === items.length && /\bor\b/i.test(m[0]) || /\b(?:e\.g|for example|such as)\b/i.test(m[0]) && items.length > missing.length) continue;
    if (covered(x.sentence.replace(m[0], ''), all) < 0.5) continue;
    const ask = requirementQuestion(missing.slice(0, 2).join(' and '));
    if (ask && ask.length <= 120) out.push({ bullet: null, ask, why: `The posting names ${missing.slice(0, 2).join(' and ')}; your résumé does not mention ${missing.length > 1 ? 'them' : 'it'}.`, kind: 'requirement', choices: ['Yes', 'Some', 'No'] });
  }
  return out;
}

// ── 1. Diagnose with no model ───────────────────────────────────────────────────────────────────
/**
 * The same diagnosis shape the model used to return, built from Seen's own readers, then validated by
 * guardDiagnosis exactly as before (evidence repair, credentials, step-up and requirement questions).
 */
export function localDiagnosis(ctx) {
  const all = ctx.sheet.jobs.flatMap((j) => j.bullets.map((b) => ({ ...b, job: j })));
  // Seen's posting reader: requirement → the résumé line it found as evidence
  const requirements = ctx.requirements.map((r) => {
    const ev = r.evidence ? norm(r.evidence).replace(/^[•●▪◦*·\-–—\s]+/, '').slice(0, 40) : '';
    const hit = ev ? all.find((b) => norm(b.text).startsWith(ev)) : null;
    return { label: r.label + (r.importance === 'preferred' ? ' (preferred)' : r.hard || r.importance === 'required' ? ' (required)' : ''), evidence: hit ? [hit.id] : [], strength: hit ? 'strong' : 'none' };
  });
  // The posting's own short requirement and nice-to-have lines ("Seafood experience", "ServSafe Manager
  // certification") are requirements too, even when no skill list knows them.
  const known = (label) => requirements.some((r) => { const a = norm(r.label), b = norm(label); return a.includes(b) || b.includes(a.replace(/\s*\((?:required|preferred)\)$/, '')); });
  // "BLS required; ACLS required within 6 months of hire" is two requirements
  const lines = sectionPosting(ctx.jobDescription).flatMap((x) => clean(x.sentence).split(/;\s+/).map((part) => ({ ...x, sentence: part })));
  for (const x of lines) {
    if (x.kind !== 'requirements' && x.kind !== 'preferred') continue;
    // a note about the list ("The preferred qualifications are a bonus, not a requirement") is not a requirement
    if (RULED_OUT_RE.test(x.sentence) || /\b(?:qualifications?|requirements?)\s+(?:are|is)\b/i.test(x.sentence)) continue;
    let label = clean(x.sentence).replace(/[.;:]+$/, '').replace(/^(?:\d+\+?\s+years?\s+(?:of\s+)?)?experience\s+(?:with|in|on)\s+/i, '').replace(/\s*\((?:a plus|preferred|nice to have)\)$/i, '').replace(/\s+(?:is )?a (?:big )?plus$/i, '').replace(/,?\s+(?:preferred|required|strongly preferred)$/i, '');
    if (!label || label.split(/\s+/).length > 9 || /^(?:what|who|about|you|we|our)\b/i.test(label) || known(label)) continue;
    // a line that tells you to do something ("Type at least 45 WPM", "Meet goals…") or sets a numeric
    // bar is not a named thing to ask about; the posting reader checks those as constraints
    const lead = analyzeLead(label);
    if (lead.kind !== 'noun' && lead.kind !== 'none') continue;
    if (/\d/.test(label) && !/\b(?:EPA|OSHA|ISO|CDL|ACLS|BLS|PALS|NRP|CPR|license|licen[cs]e|certif\w*|ServSafe)\b/i.test(label)) continue;
    requirements.push({ label: `${label}${x.kind === 'preferred' ? ' (preferred)' : ' (required)'}`, evidence: [], strength: 'none' });
  }
  const evidenceIds = new Set(requirements.flatMap((r) => r.evidence));
  // plan: a line the rules can restate or whose grammar needs fixing is a rewrite; posting evidence
  // that is not first in its job moves up
  const bullets = all.map((b) => {
    const lint = ctx.lint[b.id] || [];
    // "rewrite" only for a line Seen will actually change (round 9: every line said "can be said more
    // directly" and none were rewritten)
    const action = lint.length ? 'rewrite' : evidenceIds.has(b.id) && b.job.bullets[0].id !== b.id ? 'move_up' : 'keep';
    const level = RESULT_RE.test(b.text) ? (findMetrics(b.text).length ? 3 : 2) : findMetrics(b.text).length ? 2 : 1;
    return { id: b.id, level, action, why: lint.length ? 'grammar or tense to fix' : evidenceIds.has(b.id) ? 'evidence for what this job asks' : '' };
  });
  // Questions Seen asks about specific lines (round 8: "what numbers go with it" on a 2018 job and on
  // lines that already had their numbers read like a form). Two kinds, both about the posting:
  //   - scope: the posting names a size ("a crew of 15–25", "60+ calls a day") and a line counts the
  //     same thing — ask for the biggest real number, at peak;
  //   - one specific count for a line that is the posting's evidence and has no number, worded for
  //     what the line does (people led, people trained, customers or calls a day).
  const questions = [];
  const recent = new Set(ctx.sheet.jobs.slice(0, 2).map((j) => j.id));
  const pool = all.filter((b) => recent.has(b.job.id));
  for (const q of scopeQuestions(ctx, pool)) if (questions.length < 2) questions.push(q);
  const asked = new Set(questions.map((q) => q.bullet));
  const ranked = pool.filter((b) => evidenceIds.has(b.id) && !asked.has(b.id) && !/\d|\b(?:half|third|quarter|double|twice|triple|dozen)\b/i.test(b.text))
    .sort((x, y) => (y.job.current - x.job.current));
  for (const b of ranked) {
    if (questions.length >= 3) break;
    const lead = analyzeLead(b.text);
    if (lead.kind === 'noun' || lead.kind === 'none' || lead.kind === 'weak') continue;
    const ask = countQuestion(b.text);
    if (ask) questions.push({ bullet: b.id, ask: `For "${short(b.text, 64)}": ${ask}`, why: 'A real number shows the size of the job.', kind: 'scale', choices: [] });
  }
  questions.push(...specificQuestions(ctx, all), ...dutyQuestions(ctx, all));
  // the schedule the posting needs and the résumé does not state (round 9: nights, holidays, open
  // availability were never asked); a yes becomes an availability line in the summary
  const sched = ctx.constraints.filter((c) => c.kind === 'schedule' && c.status !== 'met').flatMap((c) => c.items || String(c.label || '').split(/,\s*/))
    .filter((i) => /^(?:nights?|weekends?|holidays?|evenings?|overnights?|open availability|early mornings?|on-?call)$/i.test(i));
  const list = (xs) => xs.join(', ').replace(/, ([^,]+)$/, ' and $1');
  const uniq = [...new Set(sched.map((x) => x.toLowerCase()))];
  const open = uniq.includes('open availability');
  const rest = uniq.filter((x) => x !== 'open availability' && !/on-?call/.test(x));
  const schedAsk = open ? `Do you have open availability${rest.length ? `, including ${list(rest)}` : ''}?` : rest.length ? `Can you work ${list(rest)}?` : uniq.some((x) => /on-?call/.test(x)) ? 'Can you take on-call shifts?' : '';
  if (schedAsk && /on-?call/i.test(schedAsk)) for (let i = questions.length - 1; i >= 0; i--) if (/on-?call/i.test(questions[i].ask)) questions.splice(i, 1);
  if (schedAsk) questions.unshift({ bullet: null, ask: schedAsk, why: `The posting needs ${[...new Set(sched)].join(', ').replace(/, ([^,]+)$/, ' and $1')}. A yes goes in your summary as an availability line.`, kind: 'availability', choices: [] });
  const gaps = requirements.filter((r) => r.strength === 'none').map((r) => ({ label: r.label, advice: '' }));
  const current = ctx.sheet.jobs.find((j) => j.current) || ctx.sheet.jobs[0];
  const target = current ? `${current.title} applying for ${clean(ctx.jobTitle, 80)}` : '';
  return guardDiagnosis({ target, bullets, requirements, questions, gaps }, ctx);
}

/** Does a clause mostly say what the line already says ("set common assessments" twice)? */
function repeats(line, clause) {
  const lw = new Set(norm(line).split(/[^a-z0-9]+/).filter((w) => w.length > 3));
  const cw = [...new Set(norm(clause).split(/[^a-z0-9]+/).filter((w) => w.length > 3))];
  return cw.length > 0 && cw.filter((w) => lw.has(w)).length / cw.length >= 0.5;
}

// ── 2. Rewrite with no model ────────────────────────────────────────────────────────────────────
/** The draft (same shape the writer model returned), built by rules and the person's answers. */
export function localDraft(ctx, diagnosis, answers = []) {
  const titles = [...ctx.sheet.jobs.map((j) => j.title), ctx.jobTitle].filter(Boolean);
  const rewrites = [];
  const additions = [];
  const byBullet = new Map();
  for (const a of answers || []) if (a.bullet) byBullet.set(a.bullet, [...(byBullet.get(a.bullet) || []), a]);
  for (const plan of diagnosis.bullets) {
    if (plan.action === 'cut') continue;
    const b = bulletById(ctx.sheet, plan.id);
    if (!b) continue;
    let text = withoutPronouns(b.text) || b.text;
    const uses = [plan.id];
    // the rules restate (weak lead, hidden verb, passive, filler) — never add; tense is grammar.js's job
    const rw = rewriteBullet(text, { tense: 'keep' });
    if (!rw.unchanged && rw.firewall?.ok !== false) text = rw.text;
    // keep the résumé's own style: no full stop where its bullets have none
    if (!/[.]\s*$/.test(b.text)) text = text.replace(/\.\s*$/, '');
    // the person's answers about this line: a short figure rides in parentheses ("(20–22 at peak)");
    // anything longer is its own new line right under this one, never glued on with ";" (round 8)
    for (const a of byBullet.get(plan.id) || []) {
      if (!affirmative(a)) continue;
      // "18–22 trailers a shift was peak; off-peak more like 12–15" → the line says the usual number, with
      // the peak beside it (round 9: Seen kept the overstatement)
      const usual = usualFigure(a.answer, text);
      if (usual) { text = usual; uses.push(`a:${a.id}`); continue; }
      const qa = (diagnosis.questions || []).find((x) => x.id === a.id);
      const noun = (String(qa?.ask || '').match(/\bthe most (\w+)/i) || [])[1] || '';
      const fig = peakFigure(a.answer, text, noun) || figureFrom(a.answer);
      const isPeak = /\bat peak|on \w+ days|at holiday peak/.test(fig || '');
      if (fig && fig.split(/\s+/).length <= 7 && (isPeak || !sameFigure(text, fig))) { text = withFigure(text.replace(/[.;]\s*$/, ''), fig, noun); uses.push(`a:${a.id}`); continue; }
      for (const line of answerLines(a.answer, { current: b.job.current, titles, posting: ctx.jobDescription, avoid: [text, ...b.job.bullets.map((x) => x.text)] }).slice(0, 1)) {
        additions.push({ job: b.job.id, after: b.id, text: line, uses: [`a:${a.id}`], why: 'from your answer' });
      }
    }
    // a draft Seen cannot make grammatical is not shown as a suggestion at all
    if (!checkBullet(text, { current: b.job.current }).ok) continue;
    const RULE_WHY = { weak_lead: 'starts with what you did', hidden_verb: 'uses the verb instead of a noun', passive: 'active voice', filler: 'cuts filler words', doublet: 'cuts a repeated word', pronoun: 'résumé lines leave out "I" and "my"', tense: 'tense for this job' };
    const dropsMy = /\b(?:my|our)\b/i.test(b.text) && !/\b(?:my|our)\b/i.test(text);
    const why = uses.length > 1 ? 'adds what you told Seen' : [...new Set([...(dropsMy ? ['pronoun'] : []), ...(rw.changes || []).map((c) => c.rule)].map((r) => RULE_WHY[r]).filter(Boolean))].join('; ') || 'clearer';
    // "my station" → "the station" alone is not worth a change (round 8: "makes it vague — which
    // stations?"); an "I" in a line is
    const bare = (t) => norm(t).replace(/\bour\b/g, 'the').replace(/[.\s]+/g, ' ').trim();
    if (uses.length === 1 && bare(text) === bare(b.text)) continue;
    if (text !== b.text) rewrites.push({ id: plan.id, text, uses, why });
  }
  // answers with no single line (the step-up job, a requirement): a yes with details is a new line in
  // the person's own words, under their current job
  const current = ctx.sheet.jobs.find((j) => j.current) || ctx.sheet.jobs[0];
  for (const a of answers || []) {
    if (a.bullet || !affirmative(a) || !current) continue;
    // the job the answer is about: one it names ("at Crescent Catering"), else the current one
    const named = ctx.sheet.jobs.find((j) => j.company && new RegExp(`\\b${j.company.split(/[\s,(]/)[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(a.answer));
    const job = named || current;
    const q = (diagnosis.questions || []).find((x) => x.id === a.id);
    const duty = (String(q?.ask || '').match(/^Have you done this: “(.+)”\?$/) || [])[1] || '';
    // an answer about something a line already says ("travel coordination" → "Book travel …") adds its
    // figure to that line instead of a second line about the same thing
    const topic = contentOf(`${q?.ask || ''}`).filter((w) => !/^(?:have|worke|used|done|this)$/.test(w));
    const home = topic.length ? ctx.sheet.jobs.flatMap((j) => j.bullets.map((x) => ({ ...x, job: j }))).find((x) => topic.some((w) => contentOf(x.text).includes(w)) && !/\d/.test(x.text)) : null;
    const fig = home && figureFrom(tidyAnswer(a.answer).replace(/^[^.]*?\b(?:yes|yeah)\b[.,]?\s*/i, '').split(/:/)[0]);
    const rw = home && rewrites.find((x) => x.id === home.id);
    const figTrim = fig && fig.replace(/\s+(?:for|on|at|in)\s+([a-z][\w\s-]*)$/i, (m, w) => (norm(home.text).includes(norm(w).split(' ')[0]) ? '' : m));
    if (home && figTrim && !rw && !sameFigure(home.text, figTrim)) {
      const text = `${(withoutPronouns(home.text) || home.text).replace(/[.;]\s*$/, '')} (${figTrim})`;
      if (checkBullet(text, { current: home.job.current }).ok) { rewrites.push({ id: home.id, text, uses: [home.id, `a:${a.id}`], why: 'adds what you told Seen' }); continue; }
    }
    // a yes said as details ("Monthly … flux analysis for the Controller, with explanations for anything
    // over $25K / 10%") adds its new detail to the line it is about (round 10: 11 shipped nothing)
    const detail = detailMerge(ctx, a.answer, rewrites);
    if (detail) { const prev = rewrites.findIndex((x) => x.id === detail.id); const r0 = { id: detail.id, text: detail.text, uses: [detail.id, `a:${a.id}`], why: 'adds what you told Seen' }; if (prev >= 0) rewrites[prev] = r0; else rewrites.push(r0); continue; }
    // a line that already has numbers for the same thing ("Own month-end close for 3 entities") is not
    // contradicted by a second line about it
    const numbered = ctx.sheet.jobs.flatMap((j) => j.bullets.map((x) => x.text)).filter((t) => /\d/.test(t));
    const sentencesOf = tidyAnswer(a.answer).split(/(?<=[.!?;])\s+/);
    for (const line0 of answerLines(a.answer, { current: job.current, titles, posting: ctx.jobDescription, duty, avoid: [...ctx.sheet.jobs.flatMap((j) => j.bullets.map((x) => x.text)), ...additions.map((x) => x.text)] }).slice(0, 2)) {
      // the job THIS sentence names (round 9: a BayShore line landed under SunCoast), in that job's tense
      const lw = contentOf(line0);
      const src = sentencesOf.map((x) => ({ x, n: contentOf(x).filter((w) => lw.includes(w)).length })).sort((p1, p2) => p2.n - p1.n)[0]?.x || '';
      // only the sentence's own employer moves a line off the current job (round 10: SunCoast named in a
      // DIFFERENT sentence still pulled the BayShore line under SunCoast)
      const own = ctx.sheet.jobs.find((j) => j.company && new RegExp(`\\b${j.company.split(/[\s,(]/)[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(src)) || current;
      const line0b = line0.replace(new RegExp(`\\s+at\\s+${String(own.company || '').split(/[\s,(]/)[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\w\\s&.-]*$`, 'i'), '');
      const line = own === job ? line0b : (checkBullet(line0b, { current: own.current }).ok ? checkBullet(line0b, { current: own.current }).text.replace(/[.;]\s*$/, '') : line0b);
      // placed under the line it is about, not at the bottom of the job
      const near = own.bullets.map((x) => ({ x, n: contentOf(x.text).filter((w) => contentOf(line).includes(w)).length })).sort((p1, p2) => p2.n - p1.n)[0];
      // the same counted thing with a different count ("3 entities" vs "two smaller entities and 60% of the main one")
      const counted = (t) => new Set([...norm(t).matchAll(/\b(?:\d[\d,.%]*|one|two|three|four|five|six)\s+(?:[a-z-]+\s+)?([a-z]{4,})/g)].map((m) => stem5(m[1])));
      const mine = counted(line);
      const lead = (t) => stem5(norm(t).split(/\s+/)[0] || '');
      if (numbered.some((t) => lead(t) === lead(line) && [...counted(t)].some((w) => mine.has(w) || contentOf(line).includes(w)) && contentOf(t).filter((w) => contentOf(line).includes(w)).length >= 2)) continue;
      // a new line that says what part of an existing line says, and more, replaces that part in place
      // ("Keep every touch logged in Salesforce; research accounts…" → "Log every touch and update lead and
      // contact status in Salesforce; research accounts…") instead of a near-duplicate line (round 9)
      const merged = mergeInto(own, line, rewrites);
      if (merged) { const prev = rewrites.findIndex((x) => x.id === merged.id); const r0 = { id: merged.id, text: merged.text, uses: [merged.id, `a:${a.id}`], why: 'adds what you told Seen' }; if (prev >= 0) rewrites[prev] = r0; else rewrites.push(r0); continue; }
      additions.push({ job: own.id, after: near && near.n >= 2 ? near.x.id : undefined, text: line, uses: [`a:${a.id}`], why: 'from your answer', step: q?.kind === 'scope' && !q?.bullet });
    }
  }
  // summary: who they are for this job and the strongest proof, from facts only
  const availQ = (diagnosis.questions || []).find((x) => x.kind === 'availability');
  const availA = availQ && (answers || []).find((x) => x.id === availQ.id);
  const items = availQ ? (availQ.ask.match(/\b(?:nights?|weekends?|holidays?|evenings?|overnights?|early mornings?)\b/gi) || []) : [];
  // "Weekends yes, holidays not sure" → "available weekends"
  const yesItems = availA ? items.filter((it) => new RegExp(`\\b${it}\\b[^.;,]{0,20}\\b(?:yes|fine|ok|okay|always|every)\\b|\\b(?:yes|can)\\b[^.;,]{0,20}\\b${it}\\b`, 'i').test(availA.answer) && !new RegExp(`\\b${it}\\b[^.;,]{0,20}\\b(?:no|not|can'?t)\\b`, 'i').test(availA.answer)) : [];
  const partial = availA && !/^(?:yes|yeah|yep|sure|definitely|absolutely)\b/i.test(String(availA.answer || '').trim()) && yesItems.length ? `available ${yesItems.join(', ').replace(/, ([^,]+)$/, ' and $1').toLowerCase()}` : '';
  const avail = partial || (availA && /^(?:yes|yeah|yep|sure|definitely|absolutely)\b/i.test(String(availA.answer || '').trim()) ? (/^Do you have open availability/i.test(availQ.ask) ? `open availability${availQ.ask.replace(/^Do you have open availability/i, '').replace(/\?$/, '')}` : /on-call/i.test(availQ.ask) ? 'available for on-call shifts' : `available ${availQ.ask.replace(/^Can you work\s+/i, '').replace(/\?$/, '')}`) : '');
  const summary = localSummary(ctx, diagnosis, additions.filter((x) => x.step).map((x) => x.text), avail);
  // skills the posting asks for that the résumé shows and the skills line lacks
  // skills worth adding: a named tool or credential the posting asks for and the résumé shows, written
  // the way the posting writes it ("Salesforce", not "salesforce experience")
  const posting = String(ctx.jobDescription || '');
  const skills = (diagnosis.requirements || []).filter((r) => r.strength !== 'none' && r.label.split(/\s+/).length <= 3)
    .map((r) => { const m = posting.match(new RegExp(`\\b${r.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')); return m && /[A-Z]/.test(m[0]) ? { skill: m[0] } : null; })
    .filter(Boolean)
    // never one the résumé already lists ("Bilingual (Spanish)", BLS under Certifications, BSN in
    // Education), and never the field itself ("Accounting" for an accountant, "HVAC" for an HVAC tech)
    .filter(({ skill }) => {
      const listed = norm([...ctx.sheet.skills, ...ctx.sheet.certifications, ...ctx.sheet.education].join(' | '));
      const words = norm(skill).split(/[^a-z0-9&+#]+/).filter((w) => w.length >= 3 && !/^(?:and|the|for|with|in)$/.test(w));
      const titles = norm([ctx.jobTitle, ...ctx.sheet.jobs.map((j) => j.title)].join(' '));
      const stem = (w) => w.slice(0, 6);
      if (words.some((w) => new RegExp(`\\b${stem(w)}`).test(listed))) return false;
      return !(words.length === 1 && new RegExp(`\\b${stem(words[0])}`).test(titles));
    })
    .filter(({ skill }) => !degreeLevel(skill) && !/\b(?:license|licen[cs]e|degree|diploma)\b/i.test(skill) && !/^(?:CRM|ERP|POS|WMS|EHR|EMR|ATS|HRIS)$/i.test(skill))
    .filter((x, i, all) => all.findIndex((y) => norm(y.skill) === norm(x.skill)) === i);
  return { rewrites, additions, summary, skills };
}

// Employers and titles that are the field even when the title alone is generic ("Department Supervisor" at
// a home-goods store is retail).
const shortTitle = (t) => String(t || '').replace(/\s*[,(–—].*$/, '').trim();
const FIELD_EMPLOYER = {
  retail: /\b(?:store|market|mart|grocer\w*|goods|shop|outfitters|apparel|boutique|pharmacy|cashier|sales associate|stock)\b/i,
  warehouse: /\b(?:warehouse|logistics|fulfil\w*|distribution|parcel)\b/i,
  food_service: /\b(?:restaurant|bistro|grill|kitchen|catering|diner|cook)\b/i,
  healthcare_support: /\b(?:hospital|medical|health|clinic|nurs\w*)\b/i,
  education: /\b(?:school|teacher|substitute|elementary)\b/i,
  data_analytics: /\banalyst\b/i,
};
const FIELD_PHRASE = {
  retail: 'in retail', warehouse: 'in warehouse operations', delivery_logistics: 'in logistics', food_service: 'in restaurant kitchens',
  hospitality: 'in hospitality', healthcare_support: 'in patient care', nursing: 'in nursing', administrative: 'in administrative support',
  sales: 'in sales', software_engineering: 'in software engineering', data_analytics: 'in data and reporting', operations: 'in operations',
  finance_accounting: 'in accounting', marketing: 'in marketing', education: 'in the classroom', customer_service: 'in customer support',
  skilled_trades: 'in the trades', security: 'in security', project_management: 'in project management',
};
/** The summary section as written, so the new one replaces it rather than sitting beside it. */
function existingSummary(resumeText) {
  const lines = String(resumeText || '').split(/\r?\n/);
  const h = lines.findIndex((l) => /^\s*(?:summary|professional summary|profile|professional profile|about|about me|objective|career objective)\s*:?\s*$/i.test(l));
  if (h < 0) return '';
  const out = [];
  for (const l of lines.slice(h + 1)) { if (!l.trim()) { if (out.length) break; continue; } if (/^\s*[A-Z][A-Z &/]{3,}\s*:?\s*$/.test(l)) break; out.push(l.trim()); }
  return out.join(' ');
}
/**
 * "Warehouse Lead with about 8 years in warehouse operations; holds OSHA 10 and forklift certification.
 * Lead a 2nd-shift crew of 14 …, and cut mis-ships from 1.4% to 0.6%." — who they are for this job,
 * the credentials the posting asks for, then the two strongest measured results from their field. No
 * employer is named, so a result is never credited to the wrong one (round 8).
 */
export function localSummary(ctx, diagnosis, extra = [], availability = '') {
  const current = ctx.sheet.jobs.find((j) => j.current) || ctx.sheet.jobs[0];
  if (!current) return null;
  const fam = prepFamily(ctx.jobTitle);
  const shop = FIELD_EMPLOYER[fam];
  const inField = (title, company = '') => prepFamily(title) === fam || (shop && (shop.test(company) || shop.test(title)));
  const hist = ctx.sheet.history || [];
  // the unbroken run of jobs in this field, newest first — the same lengths the date check accepts
  let fieldMonths = 0;
  // part-time, temp, student and internship jobs are not counted as years in the field (round 9: "counting
  // gym membership sales", "counting student teaching")
  const minor = (h) => /\b(?:intern|internship|student|substitute|volunteer|part[- ]time|temp|temporary|seasonal)\b/i.test(`${h.title} ${h.company}`);
  // a title word the target names ("nurse", "accountant", "engineer"): when the person has held it, only
  // those jobs count ("11½ years in patient care" counted the CNA years — round 9)
  const core = (shortTitle(ctx.jobTitle).toLowerCase().match(/([a-z]+)\s*$/) || [])[1] || '';
  const coreHeld = core.length > 3 && !/^(?:lead|manager|supervisor|director|head|senior|junior|intern|assistant|associate|coordinator|specialist|ii|iii)$/.test(core) && hist.some((h) => new RegExp(`\\b${core}`, 'i').test(h.title));
  let anyMonths = 0;
  for (const h of hist) { if (!inField(h.title, h.company) || minor(h)) break; anyMonths += Number(h.months) || 0; }
  for (const h of hist) { if (!inField(h.title, h.company) || minor(h) || (coreHeld && !new RegExp(`\\b${core}`, 'i').test(h.title))) break; fieldMonths += Number(h.months) || 0; }
  const companyMonths = hist.filter((h) => h.company && h.company === current.company).reduce((n, h) => n + (Number(h.months) || 0), 0);
  const trade = fam === 'skilled_trades' && (current.title.match(/\b(?:HVAC|HVAC-R|electrical|plumbing|welding|carpentry|roofing)\b/i) || [])[0];
  const field = FIELD_PHRASE[fam] && fieldMonths >= 12 ? (trade ? `in ${trade}` : FIELD_PHRASE[fam]) : '';
  const months = field ? fieldMonths : companyMonths;
  // the person's own count wins when the résumé states one ("Staff accountant with 6 years in …")
  const own = ctx.sheet.statedYears.map((x) => Number((x.match(/(\d+(?:\.\d+)?)\+?\s*years?/i) || [])[1])).find((n) => n > 0);
  const currentMinor = minor(current);
  const length = currentMinor ? '' : own && own * 12 <= Math.max(months, anyMonths) + 12 ? `${own}${/\d\+\s*years?/.test(ctx.sheet.statedYears.join(' ')) ? '+' : ''} years` : months >= 12 ? spokenLength(months) : '';
  const posting = norm(ctx.jobDescription);
  const stale = norm(ctx.sheet.stale.map((x) => x.line).join(' | '));
  const titleWords = norm(current.title);
  const creds = ctx.sheet.certifications.flatMap((c) => clean(c).split(/\s+[·•|]\s+/))
    .map((c) => clean(c).split(/\s+[—–-]\s+|,\s+|\s+\(|\s+\+\s+/)[0].replace(/\s+(?:Core|certification|certified)$/i, '').trim())
    .filter((c) => !titleWords.includes(norm(c)) && !/driver'?s licen[cs]e/i.test(c))
    .filter((c) => c && c.length <= 40 && !stale.includes(norm(c)) && norm(c).split(/[^a-z0-9]+/).some((w) => w.length >= 3 && new RegExp(`\\b${w}\\b`).test(posting)))
    .slice(0, 2);
  const lang = ctx.sheet.skills.find((x) => /\b(?:bilingual|spanish|french|mandarin|vietnamese|tagalog|arabic|portuguese|korean|asl)\b/i.test(x) && /\b(?:bilingual|spanish|french|mandarin|vietnamese|tagalog|arabic|portuguese|korean|asl)\b/i.test(ctx.jobDescription));
  const extras = [creds.length ? `holds ${creds.length > 1 ? `${creds.slice(0, -1).join(', ')} and ${creds[creds.length - 1]}` : creds[0]}` : '', lang ? lang.replace(/^Bilingual\b/, 'bilingual') : ''].filter(Boolean);
  let title = current.title.replace(/\s*[,(–—].*$/, '').trim();
  // a degree the posting names and the education holds ("BSN preferred" → "Registered Nurse (BSN)")
  const degTag = (ctx.jobDescription.match(/\b(BSN|MBA|MSN|CPA)\b/) || [])[1];
  if (degTag && (new RegExp(`\\b${degTag}\\b`).test(ctx.sheet.education.join(' ')) || (degTag === 'BSN' && /Bachelor of Science in Nursing/i.test(ctx.sheet.education.join(' '))))) title = `${title} (${degTag})`;
  // an intern or part-timer who just graduated leads with the degree
  const recentDeg = ctx.sheet.education.map((e) => e.match(/^(?:B\.?A\.?|B\.?S\.?|Bachelor of (?:Arts|Science))\s+(?:in\s+)?([A-Z][A-Za-z&]+(?:\s[A-Z][A-Za-z&]+)?)[^]*?\b(20\d\d)\b/)).find((m) => m && Number(m[2]) >= new Date(ctx.nowMs || Date.now()).getFullYear() - 2);
  if (minor(current) && recentDeg) title = `${recentDeg[1]} graduate (${recentDeg[2]})`;
  const head = `${title}${length ? ` with ${length}${field ? ` ${field}` : ` at ${current.company}`}` : ''}${extras.length ? `; ${extras.join('; ')}` : ''}`;
  const evidence = new Set((diagnosis.requirements || []).flatMap((r) => r.evidence || []));
  const proofs = ctx.sheet.jobs.filter((j) => inField(j.title) || j.id === current.id).slice(0, 3)
    .flatMap((j, ji) => j.bullets.map((b) => ({ ...b, job: j, ji })))
    .filter((b) => (findMetrics(b.text).length || /\b(?:half|third|quarter|double|twice|triple)\b/i.test(b.text)) && withoutPronouns(b.text))
    .map((b) => ({ ...b, score: (evidence.has(b.id) ? 3 : 0) + (RESULT_RE.test(b.text) ? 2 : 0) + findMetrics(b.text).length - b.ji * 3 }))
    .sort((x, y) => y.score - x.score);
  // "…in Go; it handles 4,000 requests/sec" → "…in Go, which handles…"; "…in 2023; 15 were still on staff" →
  // "…in 2023, with 15 still on staff" — one sentence, no splice
  const said = (b) => checkBullet(withoutPronouns(b.text), { current: b.job.current }).text.replace(/[.;]\s*$/, '')
    .replace(/;\s+it\s+(\w+s)\b/i, ', which $1').replace(/;\s+(\d[\d,]*)\s+(?:were|are)\s+/i, ', with $1 ').replace(/;\s+/g, ', ');
  // the strongest new fact from the person's answers leads ("Run the store on the Store Manager's two days
  // off each week" for a Store Manager posting — round 9)
  const lead = (extra || [])[0] || '';
  // a summary's implied subject is the person: "Books 18 qualified meetings a month", never the
  // imperative "Book …" (round 10); two results join only when they share a tense
  const third = (t) => t.replace(/^([A-Za-z-]+)/, (w) => { const b = verbBase(w); if (!b || b !== w.toLowerCase()) return w; const x = /(?:s|sh|ch|x|z)$/.test(b) ? `${b}es` : /[^aeiou]y$/.test(b) ? `${b.slice(0, -1)}ies` : `${b}s`; return capFirst(x); });
  const tenseOf = (t) => { const w = t.split(/\s+/)[0].toLowerCase(); return verbBase(w) === w || /s$/.test(w) && verbBase(w) !== w ? 'now' : 'past'; };
  const said3 = (b) => third(said(b));
  let body = lead ? third(lead) : (proofs[0] ? said3(proofs[0]) : '');
  let second = lead ? (proofs[0] ? said3(proofs[0]) : '') : (proofs[1] ? said3(proofs[1]) : '');
  if (second && tenseOf(second) !== tenseOf(body)) second = '';
  if (second && body.length <= 110 && second.length <= 110 && !/,.*,/.test(body)) body = `${body}, and ${lcFirst(second)}`;
  const uses = [current.id, ...proofs.slice(0, lead ? 1 : 2).map((b) => b.id)];
  // The person's own summary stays (round 9: "deletes better human-written summaries"): Seen adds one
  // sentence of proof when it has no number. An objective ("looking for more hours…") is replaced, and its
  // availability line carried over.
  const old = existingSummary(ctx.resumeText);
  const isObjective = /^\s*(?:objective|career objective)\s*:?\s*$/im.test(ctx.resumeText) && /\blooking for|seeking|to obtain|want(?:ing)? to\b/i.test(old);
  if (old && !isObjective && old.split(/\s+/).length >= 8) {
    const addAvail = availability && !/\bavailab/i.test(old) ? ` ${capFirst(availability)}.` : '';
    if (/\d/.test(old) || !body) return addAvail ? { text: `${old.replace(/\s+$/, '')}${addAvail}`, uses, replaces: old } : null;
    return { text: `${old.replace(/\s+$/, '')} ${capFirst(body)}.${addAvail}`, uses, replaces: old };
  }
  const avail = availability || (isObjective ? (old.match(/\bAvailable [^.]+(?=\.)/i) || [''])[0] : '');
  const headAll = avail ? `${head}; ${lcFirst(avail)}` : head;
  const text = body ? `${headAll}. ${body}.` : `${headAll}.`;
  if (!length && !body) return null; // a bare title is not a summary
  return { text, uses, replaces: old };
}

/** The whole rewrite step, checked line by line exactly as before. */
export function localRewrite(ctx, diagnosis, answers = []) {
  const draft = localDraft(ctx, diagnosis, answers);
  return guardRewrites(ctx, diagnosis, draft, null, answers);
}
