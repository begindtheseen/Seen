// Interview Prep with no model API (owner decision 2026-10-26: "We are not relying on api").
//
// The pack is built by Seen's own code from three things it already reads well:
//   - the résumé, every line numbered (prepFacts) — the only source of facts about the person;
//   - the posting, read by the same reader the résumé optimizer uses (requirements, the résumé line
//     that shows each one, gaps, the main duties the résumé does not show);
//   - the field's question bank (interviewQuestionBank) and Seen's applicant reports.
//
// Answers are the person's own résumé lines told out loud: first person, the right tense, numbers
// said the way people say them, in a situation → action → result order when the line has that shape
// ("Cut shrink from 2.4% to 1.1% in 12 months by …" → shrink was at 2.4% · I tightened … · within 12
// months it was down to 1.1%). What the line does not say is left as a short [bracket] for the person
// to fill in — never made up.

import { levelOf } from '../occupations/index.js';
import { confirmationsKey } from '../optimizer/confirmations.js';
import { buildContext } from '../resume/optimize/engine.js';
import { localDiagnosis, bulletOfEvidence, NOT_A_REQUIREMENT_RE } from '../resume/optimize/local.js';
import { requirementQuestion, SOFT_SKILL_RE, SCREENING_RE, TOOL_RE } from '../resume/optimize/engine.js';
import { escapeRegExp } from '../text/escapeRegExp.js';
import { firstPerson as voiceFirstPerson, spokenNumber } from '../text/voice.js';
import { spokenEmployer, sayTitle, employerOrNull } from './prepFacts.js';
import { cleanPostingText } from './prepPosting.js';
import { sectionPosting } from '../optimizer/postingSections.js';
import { readPostingPay } from '../jobs/postingPay.js';
import { failedGates } from '../optimizer/constraints.js';
import { verbBase } from '../resume/optimize/grammar.js';
import { pastTense, baseFromGerund } from '../resume/rewrite/inflect.js';
import { KNOWN_VERBS } from '../resume/health/verbs.js';
import { guardPack, prepFamily, prepFamilyFor } from './interviewPrep.js';
import { guideFor } from './interviewGuides.js';
import { storyQuestion, bankQuestions } from './interviewQuestionBank.js';
import { composePack, statementRows, realStatement, COMPOSE_VERSION } from './prepCompose.js';

/**
 * The engine that built a pack. A saved pack from an older engine is rebuilt on read (api/interview-prep.js
 * healStoredPack), keeping what the person typed. Bump it whenever what a pack SAYS changes.
 * prep-2026-11-10: job-match from the fit check's verdict on the full posting; pay only from a pay sentence; logistics
 * questions get their own frames; the step-up answer from the résumé; posting scenario questions; one years figure.
 * prep-2026-11-10c: every answer a spoken draft with at most one blank (lib/server/prepCompose.js); job-match rows are the
 * reader's statements; the register from the posting's occupation; whole ask-them questions; emails name a duty.
 * prep-2026-11-10e: the question's form picks the answer's shape and blank; drafts follow the verdict's status and line;
 * one line proves at most two answers; no duplicate skill questions; missing parts said from the statement's words.
 */
export const PREP_ENGINE = 'prep-2026-11-10e';

const clean = (s, n = 600) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const lcFirst = (s) => (s && !/^[A-Z]{2,}|^[A-Z][a-z]*[A-Z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const capFirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const article = (t) => { const w = String(t || '').trim().split(/\s+/)[0] || ''; return (/^[A-Z]{2,}/.test(w) ? /^[AEFHILMNORSX]/.test(w) : /^[aeiou]/i.test(w)) ? 'an' : 'a'; };
const shortTitle = (t) => sayTitle(String(t || '').replace(/\s*[,(–—].*$/, '').trim());

// The person's voice (first person, tense, numbers said aloud) lives in ONE shared module, lib/text/voice.js.
/** Numbers and shorthand the way people say them: "5–6" → "5 to 6", "900+" → "more than 900", "$4.2M" → "$4.2 million". */
export const spoken = spokenNumber;
/** One résumé line in first person (lib/text/voice.js firstPerson); `current` keeps a held job's present tense. */
export function firstPerson(text, { current = false } = {}) { return voiceFirstPerson(text, { tense: current ? 'present' : 'past' }); }

// "Cut shrink from 2.4% to 1.1% in 12 months by tightening …"
const FROM_TO_RE = /^(cut|reduced|lowered|dropped|brought down|raised|grew|increased|improved|boosted|lifted|moved|took)\s+(.+?)\s+from\s+(\$?[\d.,]+(?:%|[KkMm]\b)?(?:\s+(?:minutes|days|hours|seconds|weeks|percent|points))?)\s+to\s+(\$?[\d.,]+(?:%|[KkMm]\b)?(?:\s+(?:minutes|days|hours|seconds|weeks|percent|points))?)(.*)$/i;
const DOWN_RE = /^(?:cut|reduced|lowered|dropped|brought)/i;

// What to add that the line cannot say, by what the line is about.
const DETAIL = [
  [/\b(?:train\w*|coach\w*|mentor\w*|precept\w*|onboard\w*|taught|teach\w*)\b/i, '[How you trained them: what the first weeks looked like, and how you knew they were ready.]'],
  [/^(?:lead|led|supervis\w*|manag\w*|run|ran|oversee|oversaw|direct\w*)\b[^.]*\b(?:crew|team|staff|associates|people|shift|department|employees|reps)\b/i, '[A week that tested the team: what happened, and what you did.]'],
  [/\b(?:customers?|guests?|patients?|callers?|clients?|residents?|students?|families)\b/i, '[One person you remember: what they needed, and what you did.]'],
  [/^(?:built|build|creat\w*|design\w*|wrote|write|automat\w*|launched|launch|set up|develop\w*|start\w*)\b(?!\s+(?:\w+\s+)?(?:schedules?|rosters?|reports?|flyers?|graphics|captions|displays?|pallets?)\b)/i, '[Why it was needed, and the hardest part of building it.]'],
  [/\b(?:found|caught|noticed|spotted|identified|discovered)\b/i, '[How you spotted it, and what would have happened if no one had.]'],
  [/\b(?:sold|sell|opened|booked|closed|quota|meetings)\b/i, '[What you did differently from others to get there.]'],
];
const detailFor = (text, needSituation = false, fallback = '[What made it hard, and one thing you did that someone else might not have.]') => {
  const d = (DETAIL.find(([re]) => re.test(text)) || [null, fallback])[1];
  return needSituation && !/\bwhy it was needed\b/i.test(d) ? d.replace(/^\[/, '[What was going on, ').replace(/^\[What was going on, ([A-Z])/, (m, c) => `[What was going on, ${c.toLowerCase()}`) : d;
};
// A line that is a duty told as a typical day ("Care for 5–6 patients a shift") needs no "situation".
// the field itself ("warehouse", "logistics", "retail") is where the person works, not a thing to tell a story about
const FIELD_LABEL = /^(?:warehouse|logistics|retail|hospitality|customer service|sales|marketing|accounting|software|engineering|nursing|healthcare|education|operations|distribution)$/i;
const STORY_RE = /\b(?:cut|reduc\w*|rais\w*|grew|increas\w*|improv\w*|saved|built|launched|trained|precepted|led|won|named|started|administered|managed|resolved|fixed|shipped|designed|owned|migrated|automated|delivered)\b/i;
const ONGOING_RE = /^(?:care|handle|answer|serve|run|work|process|support|assist|help|operate|prepare|maintain|teach|manage|lead|keep|own|book|build|write|ring|restock|cook|prep|load|pick|drive|deliver|greet|check|schedule|document)\b/i;

/**
 * A spoken answer built on one résumé line. `job` is the line's job from the fact sheet.
 * Returns { situation, action, result, answer } with at most two [brackets].
 */
export function storyAnswer(text, job, { prompt = '' } = {}) {
  const current = !!job?.current;
  const title = shortTitle(job?.title);
  const company = spokenEmployer(job?.company);
  const at = company ? (title ? `At ${company}, where I ${current ? "'m" : 'was'} ${article(title)} ${title}` : `At ${company}`) : '';
  const where = at.replace(/I 'm/, "I'm");
  const line = clean(text).replace(/^[\s•●▪◦*·\-–—]+/, '').replace(/[.;\s]+$/, '');
  const ft = line.split(/;\s+/)[0].match(FROM_TO_RE);
  if (ft) {
    const [, , metricRaw, a, b, tailRaw] = ft;
    // "the brand's Instagram", "the share of students…" keep their article; "our"/"my" become "the"
    const metric = metricRaw.replace(/^(?:our|my)\s+/i, 'the ');
    // the résumé's own casing mid-line is the person's ("Instagram followers"), and a plural takes "were"
    const said = metric;
    const head = (said.match(/([A-Za-z-]+)\s*$/) || [])[1] || '';
    const plural = /[^s']s$/i.test(head) && !/(?:ness|ics|news|sales|status|process|bus|gas|plus|campus|analysis)$/i.test(head);
    const was = plural ? 'were' : 'was';
    // what the line says after ";" is part of the result ("best Reel reached 48,000 views")
    const after = line.split(/;\s+/).slice(1).map((p) => spoken(p).replace(/[.;\s]+$/, '')).filter(Boolean)
      .map((p) => capFirst(/^(?:best|top|biggest|highest|most)\b/i.test(p) ? `my ${p}` : p));
    const within = (tailRaw.match(/\b(?:in|within|over)\s+((?:\d+|one|two|three|six|twelve)\s+(?:weeks?|months?|years?|quarters?)|a year|one year)\b/i) || [])[1];
    const by = (tailRaw.match(/\b(?:by|through)\s+([a-z-]+ing)\b(.*)$/i) || []);
    const using = !by[1] && (tailRaw.match(/\b(?:using|with)\s+(.+)$/i) || [])[1];
    const unit = (b.match(/^\$?[\d.,]+%?[KkMm]?\s+(\w+)/) || [])[1] || (tailRaw.match(/^\s+([a-z]+)\b/) || [])[1] || '';
    const unitWord = /^(?:in|within|over|by|through|using|with|on|per|a|from|for|and)$/i.test(unit) ? '' : unit;
    const level = /%$/.test(a) ? `${was} ${spoken(a)}` : `stood at ${spoken(a)}${unitWord && !/\s/.test(a) ? ` ${unitWord}` : ''}`;
    const situation = `${where ? `${where}, ` : ''}${said} ${level}.`.replace(/^([a-z])/, (c) => c.toUpperCase());
    let action = '';
    if (by[1]) {
      const base = baseFromGerund(by[1].toLowerCase(), KNOWN_VERBS) || by[1].replace(/ing$/, '');
      const more = spoken(by[2]).replace(/[.;\s]+$/, '').replace(/\band\s+([a-z-]+ing)\b/g, (m, g) => { const b2 = baseFromGerund(g.toLowerCase(), KNOWN_VERBS); return b2 ? `and ${pastTense(b2)}` : m; });
      action = `I ${pastTense(base)}${more}. [The two or three specific changes you made, and who you got on board.]`;
    } else if (using) action = `I used ${spoken(using).replace(/[.;\s]+$/, '')}. [How you used it, step by step.]`;
    else action = '[What you changed, step by step, and who you got on board.]';
    const result = `${within ? `Within ${within}, ` : 'By the end, '}${said} ${was} ${DOWN_RE.test(ft[1]) ? 'down' : 'up'} to ${spoken(b)}${unitWord && !/\s/.test(b) && !/%$/.test(b) ? ` ${unitWord}` : ''}.${after.length ? ` ${after.join('. ')}.` : ''}`;
    return { situation, action, result, answer: [situation, action, result].join(' ') };
  }
  const fp = firstPerson(line, { current });
  if (!fp) return null;
  // what follows ";" is either more of what the person did ("I wrote captions …" → "I also wrote …",
  // told before the prompt) or the result ("store hit its goals …" → "The store hit …")
  const RESULT_WORDS = /\b(?:cut|reduc\w*|rais\w*|grew|increas\w*|improv\w*|saved|won|hit|beat|exceeded|reached|passed|still on staff|retain\w*|lifted|up|down|record|ranked|top|goals?|quota|target|resolved|kept|maintained|scored|zero|no)\b|\d%|\d\/\d/i;
  const moreDone = fp.rest.filter((r) => /^I /.test(r) && !RESULT_WORDS.test(r)).map((r) => r.replace(/^I /, 'I also '));
  const results = fp.rest.filter((r) => !moreDone.some((m) => m === r.replace(/^I /, 'I also ')))
    .map((r) => r.replace(/^(Store|Team|Unit|Shop|Department|Location|Branch|Office|Site|Crew|Program|Event|Campaign)\b/, (m) => `The ${m.toLowerCase()}`));
  const restText = results.length ? `${results.join('. ')}.` : '';
  const result = restText;
  const lead = where ? `${where}, ${fp.first}` : capFirst(fp.first);
  const action = `${lead}.${moreDone.length ? ` ${moreDone.join('. ')}.` : ''}`;
  const hasResult = /\d/.test(line) && /\b(?:cut|reduc\w*|rais\w*|grew|increas\w*|improv\w*|saved|won|named|award\w*|ranked|top|most|record|kept|hit|beat|exceeded|passed|still on staff|retain\w*|lifted)\b/i.test(line);
  // At most two prompts. A duty told as a typical day needs one example with its ending; a one-off
  // story needs its situation, plus the detail the line cannot give.
  if (ONGOING_RE.test(line) || !hasResult && !restText) {
    // the blank asks for what THIS line leaves out (a person helped, a trainee, a hard build); the generic one only when
    // nothing about the line says more (every answer ending in the same bracket reads like a form)
    const example = prompt || (hasResult || restText ? detailFor(line) : detailFor(line, false, '[One time it mattered: what happened, what you did, and how it ended.]'));
    return { situation: '', action: `${action} ${example}`, result, answer: [action, example, result].filter(Boolean).join(' ') };
  }
  // one prompt, not two (round 3: three of five answers were mostly brackets); the prompt asks for the
  // situation too when the line gives none
  const detail = prompt || detailFor(line, !restText);
  return { situation: '', action: `${action} ${detail}`, result, answer: [action, detail, result].filter(Boolean).join(' ') };
}

// ── What the posting asks for, and your answer ──────────────────────────────────────────────────
const haveVerb = (label) => {
  // "product knowledge" is had, not "worked with product" (an unseen retail posting)
  if (/\bknowledge$/i.test(String(label).trim())) return `built up ${String(label).trim().replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase())} for this work`;
  // "Google Slides" stays "Google Slides" in the person's mouth (round 5, Tasha: "I haven't worked with slides yet")
  const brand = (String(label).match(/^(google|microsoft|adobe|apple|amazon|meta|ibm|oracle|sap|aws)\b/i) || [])[1];
  if (brand) return `used ${label}`;
  const q = requirementQuestion(label);
  let m;
  if ((m = q.match(/^Have you used (.+)\?$/))) return `used ${m[1]}`;
  if ((m = q.match(/^Have you worked (in|with|on) (.+)\?$/))) return `worked ${m[1]} ${m[2]}`;
  if ((m = q.match(/^Does your work include (.+)\?$/))) return `done ${m[1]}`;
  return `worked with ${label}`;
};
// the label as the posting spells it — as a whole word ("UI" is not the "ui" inside "build")
const postingCase = (label, posting) => { const m = String(posting || '').match(new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(String(label))}(?![A-Za-z0-9])`, 'i')); return m ? m[0] : label; };

/**
 * Each requirement and main duty: what shows it, or the honest answer to give when it is missing.
 *
 * The fit check's verdict is the floor (director's architecture, 2026-11-10; judge's D2 / D11): every requirement row
 * comes from `runOptimizer` on the same full posting the fit check reads (ctx.requirements). A match is "shown" with
 * the verdict's own bullet, "stated" when the verdict's line is the summary or skills ("In your skills: NetSuite,
 * QuickBooks…"), "related" for a related-experience match, and a gap only when the verdict says missing. Prep may add
 * a story line; it never turns a match into a gap, nor a gap into "shown" with its own looser reading. Rows that are
 * not the verdict's are limited to credentials the posting names (a licence, a degree, a diploma), the posting's main
 * duties, the years the dates answer, and a certification the résumé holds that the posting names.
 */
export function jobMatch(ctx, diagnosis) {
  // a line the parser was unsure about is never shown as proof under an employer
  const bulletsAll = ctx.sheet.jobs.flatMap((j) => j.bullets.filter((b) => !b.uncertain).map((b) => ({ ...b, job: j })));
  const rank = (r) => (r.importance === 'required' ? 0 : 1);
  const out = [];
  const key = (t) => String(t || '').toLowerCase().replace(/\s*\((?:required|preferred)\)\s*$/, '').replace(/[^a-z0-9+#&]+/g, ' ').trim();
  const diagOf = (label) => (diagnosis.requirements || []).find((d) => key(d.label) === key(label)) || null;
  const verdict = [...(ctx.requirements || [])].map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map((x) => x.r);
  for (const r of verdict) {
    const label = postingCase(clean(r.label, 120), ctx.jobDescription);
    if (!label || /\b\d+\s*\+?\s*(?:years?|yrs?)\b/i.test(label)) continue;
    // a trait or a schedule is shown by how you answer, never denied with "I haven't worked with attention to
    // detail" (round 1); a benefit, a link or a note is not a requirement (D5 — a reader bug when the verdict has one)
    if (r.soft || r.kind === 'trait' || r.kind === 'schedule' || SOFT_SKILL_RE.test(label) || SCREENING_RE.test(label) || NOT_A_REQUIREMENT_RE.test(label)) continue;
    const lang = /\b(?:bilingual|fluent|spanish|french|mandarin|vietnamese|tagalog|arabic|portuguese|korean)\b/i.test(label);
    if (lang) { const c = ctx.constraints.find((x) => x.kind === 'language'); if (c && !out.some((x) => x.lang)) out.push({ label, lang: true, source: 'language', status: c.status === 'met' ? 'shown' : 'stated', say: c.status === 'met' ? 'On your résumé. Expect them to switch languages for a minute — be ready.' : c.message }); continue; }
    const cred = diagOf(r.label)?.credential || null;
    if (cred === 'expired') { out.push({ label, source: 'verdict', status: 'expired', say: `It has lapsed, and they will ask. Say when it will be current: “My ${label.replace(/\s+(?:required|within).*$/i, '')} lapsed; I'll have it renewed by [date].”` }); continue; }
    if (r.matched && !r.inferred) { out.push(matchedRow(ctx, r, label, bulletsAll)); continue; }
    if (r.matched) {
      // counted by the fit check, never shown as proof (a soft or schooling match): close, said plainly
      const ev = r.evidence ? `: “${clean(r.evidence, 140)}”` : '';
      out.push({ label, source: 'verdict', status: 'related', basis: 'inferred', say: `Your résumé comes close${ev} — but not as hands-on work. If they ask, say what you have done plainly and how it carries over.` });
      continue;
    }
    if (cred === 'in progress') { out.push({ label, source: 'verdict', status: 'in progress', say: 'Say exactly where you are: what you have completed, and when you will finish.' }); continue; }
    // the reader's kind when it gives one (lib/optimizer/scoreFit.js requirementKind), else Prep's own reading of the label
    out.push(gapRow(ctx, label, r.kind ?? kindOf(label, cred)));
  }
  // credentials the posting names that the verdict does not read ("Possession of a Texas Journeyman or Master
  // electrical license" — case 13, found only here): a licence, a certification, a degree or a diploma; nothing else
  // from the raw requirement lines becomes a row (D5)
  for (const d of diagnosis.requirements || []) {
    if (d.fit) continue;
    const label = postingCase(clean(String(d.label).replace(/\s*\((?:required|preferred)\)\s*$/, ''), 120), ctx.jobDescription);
    if (!label || !CREDENTIAL_LABEL_RE.test(label) || NOT_A_REQUIREMENT_RE.test(label) || SCREENING_RE.test(label)) continue;
    if (out.some((x) => key(x.label).includes(key(label)) || key(label).includes(key(x.label)))) continue;
    if (d.credential === 'held') { out.push({ label, source: 'posting', status: 'shown', cert: true, say: /\b(?:degree|diploma|GED|bachelor|master|associate)\b/i.test(label) ? 'In your education section.' : 'On your résumé. Have the card or number with you.' }); continue; }
    if (d.credential === 'expired') { out.push({ label, source: 'posting', status: 'expired', say: `It has lapsed, and they will ask. Say when it will be current: “I'll have it renewed by [date].”` }); continue; }
    if (d.credential === 'in progress') { out.push({ label, source: 'posting', status: 'in progress', say: 'Say exactly where you are: what you have completed, and when you will finish.' }); continue; }
    out.push({ ...gapRow(ctx, label, 'credential'), source: 'posting' });
  }
  // the posting's main duties the résumé does not show (the optimizer asks about the same ones)
  const dutyRows = [];
  for (const q of diagnosis.questions || []) {
    const m = String(q.ask || '').match(/^Have you done this: “(.+)”\?$/);
    if (!m) continue;
    // a duty a line already does, said its own way ("balance your till" ↔ "Balanced my drawer"), is shown
    const dw = new Set(stemsOf(m[1]));
    let aliased = false;
    for (const [k, alts] of Object.entries(SAME_THING)) if (new RegExp(`\\b${escapeRegExp(k)}`, 'i').test(m[1])) { aliased = true; for (const a of alts) dw.add(stem5(a)); }
    const SPECIFIC_STEM = (w) => w.length >= 5 && !/^(?:proce|manag|handl|servi|suppo|opera|skill|abili|work|team|gener|basic|daily|perfo|maint|ensur|assis|dutie|shift|plans|track|repor|remov|barri|path|quali|monit)/.test(w);
    const hit = bulletsAll.map((x) => { const shared = stemsOf(x.text).filter((w) => dw.has(w)); return { x, n: shared.length, specific: shared.filter(SPECIFIC_STEM).length }; }).sort((p1, p2) => (p2.n - p1.n) || (p2.specific - p1.specific))[0];
    // "Monitor rate, quality and inventory accuracy…" is shown by "held inventory accuracy at 99.6%" (round 5, Ray)
    if (hit && (hit.n >= (aliased ? 2 : 3) || hit.specific >= 2)) { dutyRows.push({ label: m[1], source: 'duty', status: 'shown', duty: true, proof: hit.x.text, say: '' }); continue; }
    // a duty whose words the shown rows already cover is shown by those rows (round 7, Maria)
    const dutyStems = [...dw].filter((w) => w.length >= 4 && !/^(?:proce|manag|handl|servi|suppo|opera|skill|abili|work|team|gener|basic|daily|perfo|maint|ensur|assis|dutie|shift|plans|track|repor|remov|barri|path|quali|monit|hold|stand|goal|accou|their|other|every)/.test(w));
    // what the shown rows say, and the lines that show them ("Led a team of 14–18…" covers "lead")
    const shownText = out.filter((x) => x.status === 'shown' && !x.duty).map((x) => `${x.label} ${x.proof || ''}`.replace(/\bled\b/gi, 'lead')).join(' ');
    const shownStems = stemsOf(shownText).concat(stemsOf(shownText).map((w) => w.slice(0, 4)));
    const covered = dutyStems.filter((w) => shownStems.some((s) => s.startsWith(w.slice(0, 4)) || w.startsWith(s.slice(0, 4))));
    // …or by the résumé's lines together: "Lead, train and develop associates" ← "Led a team of 14–18…" + "Trained 30+ new
    // hires…" (round 7, Maria) — half the duty's specific words, each said by a line
    const lineStems = bulletsAll.map((x) => ({ x, st: stemsOf(x.text.replace(/\bled\b/gi, 'lead')) }));
    const byLines = dutyStems.filter((w) => lineStems.some((l) => l.st.some((s2) => s2.startsWith(w.slice(0, 4)))));
    if (dutyStems.length >= 2 && byLines.length >= Math.max(2, Math.ceil(dutyStems.length / 2))) { const first = lineStems.find((l) => l.st.some((s2) => s2.startsWith(byLines[0].slice(0, 4)))); dutyRows.push({ label: m[1], source: 'duty', status: 'shown', duty: true, proof: first ? first.x.text : undefined, say: '' }); continue; }
    if (dutyStems.length && covered.length >= Math.min(2, dutyStems.length)) { const by = out.find((x) => x.status === 'shown' && !x.duty && x.proof && stemsOf(x.label).some((s) => covered.some((w) => s.startsWith(w.slice(0, 4)) || w.startsWith(s.slice(0, 4))))); dutyRows.push({ label: m[1], source: 'duty', status: 'shown', duty: true, proof: by ? by.proof : undefined, say: by ? '' : 'Shown by the rows above.' }); continue; }
    dutyRows.push({ label: m[1], source: 'duty', status: 'gap', duty: true, say: `Your résumé does not show this duty — if you have done it, have the example of “${clean(m[1], 70).replace(/[.,;:]+$/, '')}” ready; if not, say what is closest and how you would learn it.` });
  }
  // the posting's years requirement is a row the dates answer (round 7, Maria)
  for (const c of ctx.constraints || []) {
    if (c.kind !== 'years' || !c.label || out.some((x) => /\b\d+\s*\+?\s*(?:years?|yrs?)\b/i.test(x.label))) continue;
    // a figure no posting means as years of work ("50+ years of compassion" — the company's age) is the reader's misread
    if (Number(c.value || (String(c.label).match(/(\d+)/) || [])[1]) > 30) continue;
    const label = clean(c.label, 120);
    if (c.status === 'met') out.push({ label, source: 'years', status: 'shown', say: c.message ? String(c.message) : 'Your dates show it. Say the years out loud, and which jobs they come from.' });
    else if (c.status === 'unmet') out.push({ label, source: 'years', status: 'gap', say: `${c.message ? String(c.message) + ' ' : ''}Don't round up — say what you have and what you did with it: “I have [your years] in [the work closest to ${label.replace(/^\d+\+?\s*years?\s+of\s+/i, '').replace(/\s+experience$/i, '')}], and in that time I [one result].”` });
  }
  // a certification on the résumé that the posting names is a row of its own when nothing above names it (round 5, Ray)
  const posting = String(ctx.jobDescription || '').toLowerCase();
  for (const c of ctx.sheet.certifications || []) {
    const name = clean(c, 120).split(/\s+[—–-]\s+|\s+\(/)[0].trim();
    const ws = name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !/^(?:certif\w*|licen\w*|card|current|valid|certificate|training|driver|drivers|record|clean)$/.test(w));
    const named = ws.filter((w) => new RegExp(`\\b${escapeRegExp(w)}`, 'i').test(posting));
    if (!named.length || out.some((x) => new RegExp(`\\b${escapeRegExp(named[0])}`, 'i').test(x.label))) continue;
    out.push({ label: name, source: 'cert', status: 'shown', cert: true, say: 'Your certification. Have the card or number with you, and one example of the work it covers.' });
  }
  // a duty that names a gap already listed is not listed twice
  const words = (t) => new Set(String(t).toLowerCase().split(/[^a-z0-9&+#]+/).filter((w) => w.length > 3));
  const duties = dutyRows.filter((x) => !out.some((y) => y.status === 'gap' && words(y.label).size > 0 && [...words(y.label)].every((w) => words(x.label).has(w))));
  // every requirement the verdict reads is a row (the invariant pins it); the cap falls only on the duty rows
  return [...out, ...duties.slice(0, 4)];
}

// A label that names a credential (a licence, a certification, a degree, a diploma) — the only raw posting lines that
// become rows of their own.
const CREDENTIAL_LABEL_RE = /\b(?:licen[cs]e[ds]?|licensure|certif\w*|certificate|registration|diploma|GED|degree|bachelor'?s?|master'?s|associate'?s? degree|BSN|ADN|MSN|MBA|CPA|CMA|PMP|LPN|CNA|BLS|ACLS|PALS|NRP|CPR|CDL|EMT|EPA\s*608|NATE|OSHA\s*\d+|ServSafe|COC|STCW|TWIC|journeyman|master electrician)\b/;
const DEGREE_LABEL_RE = /\b(?:diploma|GED|degree|bachelor'?s?|master'?s|associate'?s? degree|BSN|ADN|MSN|MBA|Ph\.?D)\b/i;
const FIELD_KIND_RE = /\b(?:industry|environment|setting|sector|field|background in)\b|^(?:retail|healthcare|health care|hospital|acute care|home health|hospitality|logistics|manufacturing|construction|food service|restaurants?|saas|b2b|e-?commerce|fintech|payments|banking|insurance|government|nonprofit|warehouse|distribution|call center)$/i;
const REGULATION_RE = /\b(?:sox|gaap|ifrs|pci|hipaa|iso \d+|osha|epa|nate|cdl|bls|acls|cpr|servsafe|forklift)\b/i;
/** What kind of requirement a label is, when the reader does not say: credential · tool · field · skill. */
export function kindOf(label, credential = null) {
  const t = String(label || '');
  if (credential === 'not held' || CREDENTIAL_LABEL_RE.test(t)) return 'credential';
  if (FIELD_KIND_RE.test(t) || FIELD_LABEL.test(t)) return 'field';
  // a tool is a product someone uses: a known one, a CamelCase brand, or "… software / platform / tool" — never a
  // regulation (HIPAA, SOX) or a kind of work ("software development")
  if ((TOOL_RE.test(t) && !REGULATION_RE.test(t)) || /\b(?:software|platform|tools?|app|application)\s*$/i.test(t) || /\b[A-Z][a-z]+[A-Z]\w*/.test(t)) return 'tool';
  return 'skill';
}

/** A row for a requirement the verdict matched (never a gap). */
function matchedRow(ctx, r, label, bulletsAll) {
  if (r.via === 'title') return { label, source: 'verdict', status: 'shown', basis: 'title', say: 'Your job titles show it. Have one example ready from that work.' };
  const ev0 = bulletOfEvidence(r.evidenceFull || r.evidence, bulletsAll);
  // Prep may ADD a better line for a match the verdict made: one that names the thing itself or says it the résumé's
  // way more plainly (customer service ← "Handled escalated guest complaints, refunds and exchanges" over the team-size
  // line), never a line that trained others on it when a line did it
  const b = ev0 ? betterProof(label, ev0, bulletsAll) : null;
  const related = r.via === 'related';
  if (b) return { label, source: 'verdict', status: related ? 'related' : 'shown', basis: related ? 'related' : 'line', proof: b.text, say: related ? `Related experience, not the same thing — say how this work carries over to ${label}.` : '' };
  // the verdict's line is a job header, the summary, the skills line or a certification: said where it is
  const evRaw = String(r.evidenceFull || r.evidence || '').replace(/^[\s•●▪◦*·\-–—]+/, '').trim();
  const where = whereOnResume(ctx, evRaw);
  // the line is a job's own header ("Receptionist — Midland Logistics Inc. | Oak Brook, IL | 2011 – 2013"): the title
  // is the proof, said as the title
  if (where === 'title') { const j = headerJob(ctx, evRaw); return { label, source: 'verdict', status: related ? 'related' : 'shown', basis: 'title', say: `${related ? 'Related, not the same thing: your' : 'Your'} job title shows it${j ? ` (${shortTitle(j.title)} at ${spokenEmployer(j.company)})` : ''}. Have one example ready from that work.` }; }
  // a long skills or summary line is quoted by the part that names it ("NetSuite, QuickBooks"), not whole on every row
  const lw = String(label).toLowerCase().split(/[^a-z0-9+#&]+/).filter((w) => w.length > 2 && !/^(?:and|the|for|with|experience|skills?|systems?|management)$/.test(w));
  const items = evRaw.replace(/^[^:]{0,30}:\s*/, '').split(/,\s*|;\s*|\s+·\s+/).filter((x) => lw.some((w) => x.toLowerCase().includes(w.slice(0, Math.max(4, w.length - 2)))));
  const ev = items.length && items.length <= 4 && evRaw.length > 70 ? items.join(', ') : clip160(evRaw);
  const story = storyLineFor(label, bulletsAll);
  const head = `${where === 'skills' ? 'In your skills' : where === 'summary' ? 'In your summary' : where === 'certifications' ? 'In your certifications' : where === 'education' ? 'In your education' : 'On your résumé'}${ev ? `: “${ev}”` : ''}`;
  const credential = kindOf(label) === 'credential';
  // Prep may ADD a story: a bullet that names the requirement as whole words
  const latest = ctx.sheet.jobs[0];
  const at = latest && latest.company ? ` at ${spokenEmployer(latest.company)}` : '';
  const tail = credential ? ' Have the card or number with you.' : story ? ` Your story: “${story.text}” — have what you did there ready.` : ` No line of your work shows it yet, so expect “how have you used ${label}?” — have one time${at} ready.`;
  return { label, source: 'verdict', status: related ? 'related' : 'stated', basis: related ? 'related' : where, ...(story && !credential ? { story: story.text } : {}), say: `${related ? 'Related, not the same thing. ' : ''}${head}.${tail}` };
}
function betterProof(label, ev, bulletsAll) {
  const alias = Object.entries(SAME_THING).find(([k]) => new RegExp(`\\b${escapeRegExp(k)}`, 'i').test(label));
  const ws = String(label).toLowerCase().split(/[^a-z0-9&+#]+/).filter((w) => w.length > 3 && !/^(?:experience|skills?|knowledge|management|systems?|strong|proven|working|ability)$/.test(w));
  const TEACH = /^\s*(?:trained|certified|taught|coached|onboarded|mentored)\b/i;
  const score = (x) => ws.filter((w) => new RegExp(`\\b${escapeRegExp(w.slice(0, Math.max(4, w.length - 2)))}`, 'i').test(x.text)).length * 2
    + (alias ? alias[1].filter((a) => new RegExp(`\\b${escapeRegExp(a)}`, 'i').test(x.text)).length : 0)
    - (TEACH.test(x.text) && !/\b(?:train|teach|coach|onboard|mentor)/i.test(label) ? 3 : 0);
  const base = score(ev);
  const best = bulletsAll.filter((x) => x.job.id === ev.job.id || x.job.id === bulletsAll[0]?.job.id).map((x) => ({ x, n: score(x) })).sort((a, b2) => b2.n - a.n)[0];
  return best && best.n >= base + 1 && best.n >= 1 ? best.x : ev;
}
// a quoted résumé line, whole when short, cut at a word with "…" when long
const clip160 = (t) => { const c = clean(t, 400).replace(/[\s•●▪◦*·|,;–—-]+$/, ''); if (c.length <= 160) return c.replace(/[.\s]+$/, ''); return `${c.slice(0, 157).replace(/\s+\S*$/, '')}…`; };
// the job whose header line this is (its title and its employer are both on it)
function headerJob(ctx, line) {
  const l = String(line || '').toLowerCase();
  return ctx.sheet.jobs.find((j) => j.title && j.company && l.includes(String(j.title).toLowerCase()) && l.includes(spokenEmployer(j.company).toLowerCase())) || null;
}
function whereOnResume(ctx, line) {
  const f = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const l = f(line);
  if (!l) return 'resume';
  if (headerJob(ctx, line)) return 'title';
  const inList = (xs) => (xs || []).some((x) => { const fx = f(x); return fx.length >= 3 && (l.includes(fx) || fx.includes(l.slice(0, 30))); });
  if (inList(ctx.sheet.certifications)) return 'certifications';
  if (inList(ctx.sheet.education)) return 'education';
  if (inList(ctx.sheet.skills) || /^(?:skills|technical skills|tools|core competencies)\b/.test(l)) return 'skills';
  // the summary sits above the first job
  const text = f(ctx.resumeText);
  const at = text.indexOf(l.slice(0, 40));
  const heads = ctx.sheet.jobs.map((j) => (j.company ? text.indexOf(f(spokenEmployer(j.company))) : -1)).filter((i) => i > 0);
  const first = heads.length ? Math.min(...heads) : -1;
  return at >= 0 && first > 0 && at < first ? 'summary' : 'resume';
}
// a bullet that names the requirement's own words whole ("NetSuite" for ERP is the skills line's business, not ours)
function storyLineFor(label, bulletsAll) {
  const ws = String(label).toLowerCase().split(/[^a-z0-9&+#]+/).filter((w) => w.length > 2 && !/^(?:and|the|for|with|experience|skills?|knowledge|systems?|management|strong|proven|working|ability|one|any|similar)$/.test(w));
  if (!ws.length) return null;
  const has = (t, w) => new RegExp(`(?<![a-z0-9])${escapeRegExp(w)}(?:s|es|ed|ing)?(?![a-z0-9])`, 'i').test(t);
  const TEACH = /^\s*(?:trained|certified|taught|coached|onboarded|mentored)\b/i;
  return bulletsAll.find((x) => ws.every((w) => has(x.text, w)) && !TEACH.test(x.text)) || null;
}

/** The honest answer for a requirement the verdict says is missing, by what kind of thing it is (D5). */
function gapRow(ctx, label, kindIn) {
  let kind = kindIn;
  const bare = label.replace(/\s*\((?:required|preferred)\)\s*$/i, '').replace(/^(?:possession of|must have|must hold|hold|valid|current|active)\s+(?:an?\s+)?/i, '');
  if (kind === 'credential') {
    // a diploma or a degree is asked, never asserted ("I don't hold it yet" to Linda, whose résumé shows college coursework)
    if (DEGREE_LABEL_RE.test(label)) return { label, source: 'verdict', status: 'gap', kind, say: 'Not shown on your résumé. If you have it, add it to your education section before the interview. If they ask: “[Your highest diploma or degree, where, and the year.]”' };
    const close = closestCredential(ctx, label);
    if (close) return { label, source: 'verdict', status: 'gap', kind, closest: close, say: `Not on your résumé as asked. The closest you hold is your ${close}. If they ask: “I hold ${article(close)} ${close}. [Whether you have started on the ${bare}, and when you could have it.]”` };
    return { label, source: 'verdict', status: 'gap', kind, say: 'Not shown on your résumé. If you hold it, add it with its number and expiry. If not, say plainly where you are: “[Whether you hold it or are working toward it, and when you could have it.]”' };
  }
  // fundamentals every engineer is tested on: no résumé line says them, and the coding round is where they are shown —
  // the status stays a gap (the verdict's), the advice is what to do (round 3: "I haven't worked with algorithms yet"
  // scripted for an engineer with 8 years)
  if (/^(?:software_engineering|data_analytics)$/.test(prepFamily(ctx.jobTitle)) && /\b(?:algorithms?|data structures?|computer science|cs fundamentals|problem[- ]solving|coding)\b/i.test(label)) return { label, source: 'verdict', status: 'gap', kind: 'skill', say: 'Not a line on your résumé — it is tested in the coding round. Practise two problems out loud before the call, saying your approach and its cost as you go.' };
  if (kind === 'field') {
    const cur = ctx.sheet.jobs[0];
    const mine = cur ? `${cur.title ? `as ${article(shortTitle(cur.title))} ${shortTitle(cur.title)}` : ''}${cur.company ? ` at ${spokenEmployer(cur.company)}` : ''}`.trim() : '';
    return { label, source: 'verdict', status: 'gap', kind, say: `Not on your résumé — if they ask about ${label}, don't stretch it: “My work has been ${mine || '[where your work has been]'}, and what carries over to ${label} is [the part of your work that does the same job].”` };
  }
  // the closest thing the résumé names in the same family (Kronos for Workday, package units for RTUs)
  const fam = TOOL_FAMILY.find((f) => f.some((w) => new RegExp(`\\b${escapeRegExp(w)}`, 'i').test(label)));
  const near = fam && fam.find((w) => !new RegExp(`\\b${escapeRegExp(w)}`, 'i').test(label) && new RegExp(`\\b${escapeRegExp(w)}`, 'i').test(ctx.resumeText));
  const close = near ? (ctx.resumeText.match(new RegExp(`\\b${escapeRegExp(near)}[\\w-]*`, 'i')) || [near])[0].trim() : '';
  // a duty the posting lists: what to say is the closest work, not "I haven't worked with <a sentence>"
  if (kind === 'duty') return { label, source: 'verdict', status: 'gap', kind, say: 'Part of the job your résumé does not show. If you have done it, have the example ready; if not, say what is closest and how you would learn it.' };
  // a "tool" with three or more plain words is an organisation or a body of rules, not something one "uses"
  // a kind of work is not a product: "I haven't used frontend", "I haven't used UI"
  if (kind === 'tool' && (/^(?:UI|UX|frontend|backend|front[- ]end|back[- ]end|full[- ]stack)$/i.test(label) || (label === label.toLowerCase() && !TOOL_RE.test(label)))) kind = 'skill';
  if (kind === 'tool' && /\b(?:secretary|assistant|manager|nurse|technician|engineer|specialist|coordinator|associate|clerk|officer|representative|analyst)s?$/i.test(label)) kind = 'field';
  if (kind === 'tool' && label.split(/\s+/).length >= 3 && !TOOL_RE.test(label) && !/\b[A-Z][a-z]+[A-Z]|\b(?:software|platform|system|app)\b/i.test(label)) kind = 'skill';
  if (kind === 'tool') return { label, source: 'verdict', status: 'gap', kind, say: `Not on your résumé — if they ask, don't stretch it: “I haven't used ${label}; the closest I've used is ${close || '[the closest tool you have used]'}, and I'd get up to speed on ${label} by [one concrete step].”` };
  return { label, source: 'verdict', status: 'gap', kind, say: `Not on your résumé — if they ask, don't stretch it: “I haven't ${haveVerb(label)} yet; the closest I've done is ${close || '[your closest experience]'}, and I'd get up to speed on ${label} by [one concrete step].”` };
}
// the person's own licence or certification closest to the one asked for: a shared specific word ("Journeyman")
// credentials that stand closest to one another (BLS includes CPR; an RN licence from another state for this state's)
const CRED_NEAR = [
  [/\bCPR\b/, /\b(?:BLS|ACLS)\b/], [/\bBLS\b/, /\b(?:CPR|ACLS)\b/], [/\bACLS\b/, /\bBLS\b/],
  [/\b(?:registered (?:professional )?nurse|RN)\b/i, /\bRN\b|registered nurse/i], [/\b(?:LPN|LVN)\b/, /\b(?:LPN|LVN|RN)\b/],
  [/\b(?:journeyman|master)\b.*\belectric/i, /journeyman|electrician/i], [/\bCDL\b/, /\bCDL\b/],
];
function closestCredential(ctx, label) {
  const GENERIC = /^(?:licen\w*|certif\w*|certificate|valid|current|active|card|state|required|preferred|possession|electrical|master|holder|drivers?|record|clean|training|and|the|or|of|a|an)$/i;
  const want = String(label).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !GENERIC.test(w));
  const lines = [...(ctx.sheet.certifications || [])];
  const near = CRED_NEAR.filter(([asked]) => asked.test(label)).map(([, held]) => held);
  const pick = lines.find((c) => want.some((w) => new RegExp(`\\b${escapeRegExp(w)}`, 'i').test(c))) || lines.find((c) => near.some((re) => re.test(c)));
  if (!pick) return '';
  const name = clean(pick, 120).replace(/\s*\([^)]*\)\s*$/, '').replace(/^[-•\s]+/, '').split(/,\s+/)[0].trim();
  // said as the résumé's section calls it: a line under LICENSES is a licence
  const lic = /\blicen/i.test(name) || licensedSection(ctx.resumeText, pick);
  return /\b(?:licen|certif)/i.test(name) ? name : `${name} ${lic ? 'license' : 'certification'}`;
}
function licensedSection(resumeText, line) {
  const lines = String(resumeText || '').split(/\r?\n/);
  const i = lines.findIndex((l) => l.includes(String(line).slice(0, 24)));
  for (let k = i - 1; k >= 0 && k >= i - 12; k--) if (/^[A-Z][A-Z /&]{3,}$/.test(lines[k].trim())) return /LICEN/.test(lines[k]);
  return false;
}

const stem5 = (w) => w.replace(/(?:ing|ed|es|e|s)$/, '').slice(0, 5);
const stemsOf = (t) => [...new Set(String(t).toLowerCase().split(/[^a-z0-9&+#]+/).filter((w) => w.length > 3 && !/^(?:with|from|that|this|your|their|each|every|they|them|then|than|into|over|about|team|work)$/.test(w)).map(stem5))];
// A requirement said the résumé's way.
const SAME_THING = {
  'cash handling': ['cash', 'drawer', 'till', 'register'], 'cash': ['cash', 'drawer', 'till'], 'typing': ['wpm', 'typing'], 'customer service': ['customer', 'guest', 'caller', 'complaint', 'escalat', 'refund', 'resolv', 'satisfaction'],
  'social media': ['instagram', 'tiktok', 'facebook', 'reels', 'social'], 'crm': ['salesforce', 'hubspot', 'crm'], 'variance': ['flux', 'variance'],
  'microsoft office': ['excel', 'word', 'outlook', 'powerpoint'], 'point of sale': ['register', 'pos', 'ring up', 'transactions'], 'scheduling': ['schedul', 'kronos', 'labor', 'calendar', 'hootsuite', 'buffer', 'sprout', 'later'],
  'data or reporting': ['dashboard', 'report', 'sql', 'tableau'], 'inside sales': ['inside sales', 'inbound', 'calls'], 'knife': ['portion', 'prep', 'knife'], 'cooking': ['saut', 'grill', 'line cook', 'cook'],
  'warehouse management system': ['wms', 'manhattan', 'blue yonder', 'sap ewm', 'highjump', 'korber'], 'wms': ['wms', 'manhattan'], 'spreadsheet': ['excel', 'google sheets', 'spreadsheet'],
  'computer skills': ['excel', 'word', 'outlook', 'wms', 'rf scan', 'email', 'computer', 'microsoft'], 'powered industrial truck': ['forklift', 'reach truck', 'order picker', 'pit', 'pallet jack'], 'pit': ['forklift', 'reach truck', 'order picker'], 'forklift': ['forklift', 'reach truck', 'order picker', 'pit'],
  'loss prevention': ['shrink', 'loss prevention', 'asset protection', 'theft', 'lp '], 'shrink': ['shrink', 'loss prevention'],
  'security': ['security', 'pci', 'soc 2', 'soc2', 'row-level', 'encrypt', 'audit log', 'audit-log', 'iam', 'secrets', 'gdpr', 'hipaa', 'compliance'], 'sensitive data': ['pci', 'soc 2', 'soc2', 'row-level', 'encrypt', 'audit log', 'audit-log', 'gdpr', 'hipaa', 'phi', 'pii'],
  'logistics': ['logistics', 'distribution center', 'dc ', 'warehouse', 'shipping', 'receiving', 'inbound', 'outbound', 'trailer'],
  'p&l': ['p&l', 'profit', 'margin'], 'performance': ['latency', 'p99', 'p95', 'throughput', 'caching', 'cache', 'load time', 'faster', 'speed'], 'safety': ['safety', 'osha', 'recordable', 'injur', 'incident-free', 'safe'], 'leadership': ['led', 'lead ', 'supervis', 'team of', 'crew of', 'managed'], 'distributed systems': ['kafka', 'kubernetes', 'microservice', 'distributed', 'transactions/day', 'queue'], 'ticketing': ['zendesk', 'freshdesk', 'servicenow', 'ticket'], 'electrical': ['electrical', 'capacitor', 'contactor', 'control board', 'wiring'], 'replenish': ['restock', 'replenish', 'stock'], 'phone and email': ['calls', 'chats', 'email', 'phone'], 'upper elementary': ['4th grade', '5th grade', '3rd grade', 'elementary'],
};
// Tools and skills that are the same kind of thing: the closest one the person has.
const TOOL_FAMILY = [
  ['workday', 'kronos', 'ukg', 'adp', 'dayforce', 'paycom', 'paylocity'], ['concur', 'expensify', 'expense report'], ['sox', 'audit', 'pbc', 'internal control'],
  ['rtu', 'rooftop', 'package unit', 'light-commercial'], ['chiller', 'boiler', 'package unit'], ['building automation', 'bas', 'control board', 'thermostat', 'controls'],
  ['esl', 'multilingual', 'english learner', 'ell'], ['seafood', 'shrimp', 'redfish', 'fish', 'oyster'], ['power bi', 'tableau', 'looker'], ['linkedin', 'instagram', 'facebook', 'tiktok'],
  ['servicenow', 'zendesk', 'freshdesk', 'salesforce service'], ['pci', 'payment', 'payout', 'ledger'], ['epic', 'cerner', 'meditech'], ['java', 'go', 'python', 'kotlin'],
];

/** "What makes you ready to step up from Assistant Store Manager to Store Manager?" / "Why telemetry and nights now?" */
const SENIOR_WORDS = /\b(?:manager|director|lead|supervisor|senior|sr|head|principal|chief|charge|president|vp|foreman)\b/i;
const GENERIC_TITLE = /^(?:and|the|of|for|ii|iii|iv|i|grade|unit|team|role|position|associate|assistant|specialist|representative|coordinator|technician|officer)$/i;
// the field a role noun stands for when the move is a change of field, not of level
const FIELD_OF_ROLE = { engineer: 'engineering', engineers: 'engineering', developer: 'development', developers: 'development', manager: 'management', managers: 'management', analyst: 'analysis', analysts: 'analysis', designer: 'design', designers: 'design', scientist: 'science', scientists: 'science', administrator: 'administration', administrators: 'administration', nurse: 'nursing', nurses: 'nursing', architect: 'architecture', architects: 'architecture', consultant: 'consulting', consultants: 'consulting', recruiter: 'recruiting', recruiters: 'recruiting', accountant: 'accounting', accountants: 'accounting', marketer: 'marketing', writer: 'writing', writers: 'writing', editor: 'editing', editors: 'editing', planner: 'planning', planners: 'planning', buyer: 'buying', trainer: 'training', trainers: 'training', teacher: 'teaching', teachers: 'teaching', therapist: 'therapy', therapists: 'therapy', strategist: 'strategy', strategists: 'strategy', operator: 'operations', operators: 'operations', programmer: 'programming', programmers: 'programming' };
// The role named plainly: no place suffix (" - Laurel"), no note in parentheses, no team after a comma, no level or
// schedule word ("II", "1st Shift", "Full-Time Nights") — judge's D6: "Why laurel now?", "Why registered and nurse now?"
const CLINICAL_SPECIALTY_RE = /\b(?:telemetry|icu|ccu|picu|nicu|med[- ]?surg\w*|medical[- ]surgical|emergency|er|ed|oncology|pediatric\w*|home health|hospice|urology|vascular|trauma|cardiac|cardiology|cardiovascular|labor|delivery|l&d|postpartum|mother[- ]baby|psych\w*|behavioral|rehab\w*|ortho\w*|surgical|step[- ]?down|progressive care|dialysis|ambulatory|pacu|perioperative|operating room|float|geriatric|neuro\w*|wound|infusion|endoscopy|radiology|critical care|women's health|transplant|burn|respiratory|pulmonary)\b/i;
const LEVEL_SCHEDULE_RE = /\b(?:i{1,3}|iv|[1-4]|\d+(?:st|nd|rd|th)\s+shift|(?:full|part)[- ]time|nights?|days?|evenings?|weekends?|overnights?|prn|per diem|remote|hybrid|on-?site|temporary|seasonal|contract)\b/gi;
/** The role as said in a sentence: no requisition number, schedule or note ("Retail Sales Associate - Part Time" →
 * "Retail Sales Associate", "Legal Administrative Assistant - Litigation- 3701713" → "Legal Administrative Assistant - Litigation"). */
export function spokenRole(role) {
  return String(role || '').replace(/(?<=[a-z])-(?=(?!Time\b)[A-Z][a-z])/g, ' - ').replace(/^[A-Z]{2,5}\s*[-–—]\s*(?=[A-Z][a-z])/, '').replace(/\s*\([^)]*\)/g, ' ').replace(/[-–—\s]*#?\d{5,}\s*$/, '').replace(LEVEL_SCHEDULE_RE, ' ')
    .replace(/\s*[-–—|]\s*(?=[-–—|]|$)/g, '').replace(/\s*[-–—|]\s*$/, '').replace(/\s+/g, ' ').trim()
    // "Registered Nurses" is one job said in a sentence
    .replace(/\b(nurse|engineer|associate|driver|technician|assistant|representative|specialist|manager|cook|cashier|electrician|accountant|developer|analyst|therapist|teacher|aide|agent)s\b/gi, '$1') || String(role || '').trim();
}
export function plainTitle(role) {
  return String(role || '').replace(/\s+/g, ' ').trim()
    .replace(/\s*\([^)]*\)/g, ' ')
    .replace(/\s+[-–—|]\s+.*$/, '')
    .replace(/,\s.*$/, '')
    .replace(LEVEL_SCHEDULE_RE, ' ')
    .replace(/[-–—]\s*$/, '')
    .replace(/\s+/g, ' ').trim();
}
export function moveQuestion(cur, role, jobs = [], education = [], { family = null, company = '' } = {}) {
  if (!cur?.title || !role) return null;
  const target = plainTitle(role);
  if (!target) return null;
  // a degree in the field counts as having it ("Why marketing now?" to a marketing graduate)
  const held = [...jobs.map((j) => String(j.title).toLowerCase()), ...education.map((e) => String(e).toLowerCase())].join(' | ');
  const stepWord = (target.match(SENIOR_WORDS) || [])[0];
  // a move at the same level (or down) is never a "step up" (director round 7: Shift Supervisor → Shift Lead): the
  // question is about the change of setting instead — the levels by the occupation module's own rule
  const lvCur = levelOf(cur.title), lvTo = levelOf(target);
  if (stepWord && lvCur.marker && lvTo.marker && lvCur.rank >= lvTo.rank) {
    const from = spokenEmployer(cur.company || '');
    const to = String(company || '').trim();
    if (from && to && from.toLowerCase() !== to.toLowerCase()) return { q: `What will change for you going from ${from} to ${to}?`, why: 'This is the same level of job in a new setting. Say what carries over as it is, and what is new to you there — the place, the pace, the product — and how you would learn it.', setting: true };
    return null;
  }
  if (stepWord && !new RegExp(`\\b${escapeRegExp(stepWord)}\\b`, 'i').test(held.replace(/\b(?:assistant|associate|deputy|junior|jr)\b[^|]*/gi, ''))) {
    return { q: `What makes you ready to step up from ${shortTitle(cur.title)} to ${shortTitle(target)}?`, why: 'The posting is a step up from your title, and they will test it. Lead with the times you have already done the bigger job, then what you would do in your first months.', stepUp: true };
  }
  // the same kind of work the person already does is not a move: the recruiter answer "the same role at a bigger
  // operation" covers it (an RN to a Home Health RN, a journeyman to a service electrician, an administrator to an
  // Administrative Coordinator)
  const fam = family && family !== 'general' ? family : prepFamily(target);
  const sameField = fam !== 'general' && jobs.some((j) => prepFamily(j.title) === fam);
  // a nurse moving unit is a move: the specialty after the title ("Registered Nurse – Telemetry (Nights)", "Registered
  // Nurse-Urology Vascular and Trauma Full-Time Nights") is named, never the title's words ("Why registered and nurse now?")
  if (sameField && (fam === 'healthcare_support' || fam === 'clinical')) {
    // never what follows a comma ("Medical Assistant, Pomona Valley" — a place) and only a unit or specialty name
    const spec0 = String(role).replace(/\s*\([^)]*\)/g, ' ').replace(/,.*$/, '').split(/\s*[-–—|]\s*|(?<=[a-z])-(?=[A-Z])/).slice(1).join(' ');
    const spec = (CLINICAL_SPECIALTY_RE.test(spec0) ? spec0 : '').replace(LEVEL_SCHEDULE_RE, ' ').replace(/\b(?:unit|department|floor|rn|lpn|lvn|nurse|licensed|registered|practical|certified|vocational)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    const sw = spec.split(' ').filter(Boolean);
    if (sw.length && sw.length <= 4 && !sw.filter((w) => w.length > 3 && !/^and$/i.test(w)).every((w) => new RegExp(`\\b${escapeRegExp(w.toLowerCase().slice(0, 5))}`, 'i').test(held))) {
      const words = sw.map((w) => (/^[A-Z]{2,}$/.test(w) ? w : w.toLowerCase()));
      const said = words.length > 2 && !words.includes('and') ? `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}` : words.join(' ').replace(/ and /, words.length > 3 ? ' and ' : ' and ').replace(/^(\w+) (\w+) and/, '$1, $2 and');
      return { q: `Why ${said} now?`, why: 'Every interviewer asks about the move. Say what you have already done that is closest, what draws you to it, and how you are getting ready.' };
    }
    return null;
  }
  // a setting word the person's titles do not have ("Commercial HVAC Service Technician" to an HVAC Service Technician)
  const SETTING = target.match(/\b(?:commercial|industrial|executive|enterprise|clinical|residential)\b/i);
  if (sameField && SETTING && !new RegExp(`\\b${escapeRegExp(SETTING[0])}\\b`, 'i').test(held)) return { q: `Why ${SETTING[0].toLowerCase()} work now?`, why: 'Every interviewer asks about the move. Say what you have already done that is closest, what draws you to it, and how you are getting ready.' };
  if (sameField) return null;
  const NOT_A_MOVE = /^(?:shift|front|end|platform|backend|frontend|operations|support|services?|team|level|member|staff|registered|certified|licensed)$/i;
  const plain = target.replace(/[&/]/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !GENERIC_TITLE.test(w) && !NOT_A_MOVE.test(w));
  if (!plain.length) return null;
  const isHeld = (w) => new RegExp(`\\b${escapeRegExp(w.toLowerCase().replace(/s$/, ''))}`, 'i').test(held);
  if (plain.every(isHeld)) return null;
  const said = (w) => (/^[A-Z]{2,}$/.test(w) ? w : w.toLowerCase());
  const noun = plain[plain.length - 1].toLowerCase();
  const field = FIELD_OF_ROLE[noun];
  // the field, with at most two words that qualify it ("site reliability engineering", "occupational therapy");
  // never a list of title words joined by "and"
  // a field noun alone is too wide to be the subject ("Why engineering now?" to an electrician applying for a software
  // job): it needs the word that says which kind, else the role noun itself
  const quals = plain.slice(0, -1).slice(-2).map(said);
  const phrase = field && (quals.length || !/^(?:engineering|management|analysis|development|design|operations|administration|consulting|planning|programming)$/.test(field)) ? [...quals, field].join(' ')
    : field ? `${noun} roles`
    : plain.length === 1 ? said(plain[0])
    : 'this kind of role';
  return { q: `Why ${phrase} now?`, why: 'Every interviewer asks about the move. Say what you have already done that is closest, what draws you to it, and how you are getting ready.' };
}

// ── Questions to ask them ───────────────────────────────────────────────────────────────────────
const ASK_THEM = {
  retail: ['What does a typical shift look like here, and how busy do weekends get?', 'What do your best associates do that others don\'t?'],
  retail_lead: ['What are the store\'s biggest goals this year — sales, shrink, or staffing?', 'How much say does the store leader have over the schedule and hiring?'],
  warehouse: ['How are rate and accuracy measured on this shift?', 'What does peak season look like for staffing?'],
  delivery_logistics: ['How are routes assigned, and what does a normal day\'s volume look like?', 'How is on-time performance measured?'],
  healthcare_support: ['What is the usual patient ratio on this unit, and how is charge assigned?', 'What does orientation look like for a nurse new to this unit?'],
  customer_service: ['How are response time and satisfaction measured, and what does a good week look like?', 'What do new agents find hardest in the first month?'],
  software_engineering: ['How does on-call work, and what does a typical incident look like?', 'How are design decisions written down and reviewed?'],
  data_analytics: ['Who uses the dashboards most, and which decisions do they drive?', 'Where does the data break most often?'],
  marketing: ['How do you decide whether a campaign worked?', 'Which channels matter most this year?'],
  sales: ['What does ramp look like, and what do your top reps do differently?', 'Where do your best leads come from today?'],
  administrative: ['What does a good week look like for the people I would support?', 'Which tools does the team rely on most?'],
  finance_accounting: ['What does the close calendar look like, and where does it usually slip?', 'What is the biggest audit or reporting priority this year?'],
  skilled_trades: ['What is the mix of service, maintenance and install work?', 'How does on-call work, and how are calls dispatched?'],
  food_service: ['How many covers on a busy night, and which station is hardest to staff?', 'How are new cooks trained on the menu?'],
  hospitality: ['What does a busy night look like for the team?', 'What do guests most often praise or complain about?'],
  education: ['How do grade-level teams plan together?', 'How are students who need extra help supported?'],
  general: ['What does success look like in the first six months?', 'What is the biggest challenge the team is working on right now?'],
};
// How interviews in each field usually run, so the person prepares for the format, not only the questions.
const FORMAT = {
  food_service: 'Many kitchens ask for a working interview (a "stage"): a short shift on the line. Bring non-slip shoes and your knives if you have them, ask which station, and show clean, fast mise en place.',
  education: 'Teaching interviews often include a demo lesson. Have a 10–15 minute lesson for the grade ready, with how you would check for understanding and adjust for students who need more help.',
  sales: 'Sales development interviews often include a role-play cold call. Practise a 30-second opener, one discovery question, and asking for the meeting.',
  software_engineering: 'Backend interviews usually include a coding round and a system-design round. Practise explaining one system you built: the data flow, how it fails, and what you would change.',
  data_analytics: 'Analyst interviews often include a SQL screen or a take-home. Practise joins, window functions and explaining a chart to someone non-technical.',
  healthcare_support: 'Nursing interviews are often panel interviews with behavioral and clinical scenarios ("your patient\'s rhythm changes — what do you do?"). Answer with your assessment, your action, and who you call.',
  skilled_trades: 'Expect technical questions on diagnosis and safety, and sometimes a hands-on check. Be ready to walk through a recent call from symptom to fix.',
  retail: 'Store interviews are often with the store and district manager; expect scenario questions about customers, staffing and numbers.',
  warehouse: 'Expect questions on safety, rates and accuracy, and sometimes a walk of the floor. Know your numbers.',
  customer_service: 'Support interviews often include a mock call or a written reply to a customer. Practise calm, clear wording and a clean summary note.',
  administrative: 'Expect questions on calendars, priorities and confidentiality, and sometimes a short skills test (Word, Excel, typing).',
  finance_accounting: 'Expect technical questions on close, reconciliations and journal entries, sometimes an Excel exercise.',
  marketing: 'Bring two or three pieces of your work and the numbers behind them; you may be asked to critique one of their posts.',
};
// A phone screen is a recruiter call in every field (round 3: "bring pieces of your work" for a phone call).
const PHONE_FORMAT = 'A phone screen is usually a 20–30 minute call with a recruiter: your background in two minutes, why this job, your pay range, when you could start and, for some roles, your current level and other interviews in progress. Have those answers ready, sit somewhere quiet, and ask what the next round looks like.';
export function interviewFormat(role, stage = '', family = null) { return stage === 'Phone Screen' ? PHONE_FORMAT : FORMAT[family || prepFamily(role)] || ''; }

export function askThem(role, family = null) {
  const fam = family || prepFamily(role);
  const lead = /\b(?:manager|lead|supervisor|director|head)\b/i.test(role);
  const field = (fam === 'retail' && lead ? ASK_THEM.retail_lead : ASK_THEM[fam]) || ASK_THEM.general;
  return [...field, 'What does a great first 90 days look like in this role?', 'What are the next steps, and when should I expect to hear back?']
    .map((q) => ({ q }));
}

// ── Recruiter answers ───────────────────────────────────────────────────────────────────────────
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// the fact sheet's month index is year × 12 + (month − 1)
const monthYear = (ym) => (Number.isFinite(ym) ? `${MONTHS[ym % 12]} ${Math.floor(ym / 12)}` : '');
const PROFESSIONAL = /^(?:software_engineering|data_analytics|finance_accounting|marketing|sales|project_management)$/;
// what someone in this field has actually seen of an employer (a nurse has seen a unit, not "a campaign")
const WHY_EXAMPLES = {
  healthcare_support: 'a unit or program, how they treat patients, something a nurse there told you', clinical: 'a program, how they treat patients, something a clinician there told you',
  skilled_trades: 'a project they built, how their crews work, the kind of work they take on', warehouse: 'how a site runs, its safety record, something a worker there told you',
  delivery_logistics: 'how their routes run, their safety record, something a driver there told you', retail: 'a store you shop at, how the team treats customers, something new on the floor',
  food_service: 'their menu, a meal you had there, how the kitchen runs', hospitality: 'a stay or a visit, how the staff treat guests', customer_service: 'how they treat customers, a product you use, something an agent there told you',
  software_engineering: 'a product you use, an engineering post they published, a system they run at scale', data_analytics: 'a product you use, a dataset or report they published',
  finance_accounting: 'their industry, a recent filing or announcement, how their finance team is set up', marketing: 'a campaign of theirs you saw, their channels, their brand voice',
  administrative: 'what the office does, who you would support, how the team works', education: 'the school, its students, a program they run', sales: 'a product of theirs, who buys it, a deal or launch you read about',
};
function recruiterScripts({ ctx, company, role: roleIn, stage, pay, payText, questions, family = null }) {
  // the role said plainly ("Shift Lead", never "Shift Lead - Laurel role")
  const role = plainTitle(spokenRole(roleIn)) || roleIn;
  const out = [];
  const jobs = ctx.sheet.jobs;
  const hist = ctx.sheet.history || [];
  const co = (c) => spokenEmployer(c);
  const fam = family || prepFamily(role);
  const inField = hist.filter((h) => prepFamily(h.title) === fam && fam !== 'general');
  // the latest job leads unless it is in another known field (a barista job beside a marketing internship)
  const f0 = hist[0] ? prepFamily(hist[0].title) : 'general';
  const top = inField[0] && f0 !== fam && f0 !== 'general' ? inField[0] : hist[0];
  const has = (re) => questions.some((q) => re.test(q.q));
  // why this company: a line that already names it is the best opening there is
  const named = String(company || '').length >= 3 && hist.flatMap((h) => (h.bullets || []).map((b) => ({ b, h }))).find(({ b, h }) => new RegExp(`\\b${escapeRegExp(String(company))}\\b`, 'i').test(b) && !String(h.company || '').toLowerCase().includes(String(company).toLowerCase()));
  if (has(/^Why do you want to work at/)) {
    if (named) {
      const fp = firstPerson(named.b, { current: false });
      if (fp) out.push({ q: `Why do you want to work at ${company}?`, answer: `I've already worked with ${company} from the other side: at ${co(named.h.company)}, ${fp.first}. [What you want to build or learn at ${company} that you couldn't there.]`, resume_fact: named.b });
    } else if (top) out.push({ q: `Why do you want to work at ${company}?`, answer: `[One specific thing about ${company} you have seen yourself: ${WHY_EXAMPLES[fam] || 'a product, a service, a team, something they announced'}.] [How that connects to what you did at ${co(top.company)} — one sentence.]`, resume_fact: '' });
  }
  // why now: the latest job, as it stands on the résumé
  const latest = hist[0];
  const cur = jobs.find((j) => j.current);
  if (latest && has(/^Why are you looking/)) {
    const said = (ctx.sheet.education || [])[0] && !cur && latest.endYm && /\b(?:intern|ambassador|assistant|barista|student)\b/i.test(latest.title || '') ? null : latest;
    if (cur) {
      const since = hist.find((h) => h.title === cur.title)?.startYm ? ` since ${monthYear(hist.find((h) => h.title === cur.title).startYm).split(' ')[1]}` : '';
      // the title held IS the title applied for: "ready for a Warehouse Lead role" to a Warehouse Lead sounds like not
      // knowing your own job (round 5, Ray)
      const same = shortTitle(cur.title).toLowerCase().replace(/^(?:senior|sr\.?|lead|junior|jr\.?)\s+/, '') === shortTitle(role).toLowerCase().replace(/^(?:senior|sr\.?|lead|junior|jr\.?)\s+/, '');
      out.push({ q: 'Why are you looking for a new job now?', answer: same
        // (never "at a bigger operation" — nothing on the résumé or the posting says the new place is bigger)
        ? `I've been ${article(shortTitle(cur.title))} ${shortTitle(cur.title)} at ${co(cur.company)}${since}, and I'm looking for the same work where [what this job offers that your current one doesn't — never a complaint].`
        : `I've been at ${co(cur.company)}${since}, and I want to move into ${article(shortTitle(role))} ${shortTitle(role)} job because [what this job offers that your current one doesn't — never a complaint].`, resume_fact: '' });
    }
    else if (said && said.endYm) out.push({ q: 'Why are you looking for a new job now?', answer: `My role at ${co(said.company)} ended in ${said.approx ? String(Math.floor(said.endYm / 12)) : monthYear(said.endYm)} [— one plain sentence on why: a layoff, a contract ending, a move], and I'm looking for ${article(shortTitle(role))} ${shortTitle(role)} job: [the part of the posting that matches you].`, resume_fact: '' });
  }
  // pay: the posting's own figure is the one thing said out loud. Seen's range from OTHER listings (other
  // employers, or the company's other roles) is coaching beside the blank, never the person's words — round 4,
  // Maria: "$40k–$45k a year" drafted into her mouth from storage-unit and check-cashing ASM listings anchored
  // her low; Tasha found the same number useful as a reference. Both are served by a reference, not a script.
  const range = payText ? payText.trim() : pay ? (pay.unit === 'hour' ? `$${pay.low}–$${pay.high} an hour` : `$${Math.round(pay.low / 1000)}k–$${Math.round(pay.high / 1000)}k a year`) : '';
  // the pay question on the card: the staple, or the company's own wording of it ("What pay range are you looking for…")
  const payQ = (questions.find((q) => /^What are your pay expectations/.test(q.q)) || questions.find((q) => { const p = purposes(q.q); return p.has('pay') && p.size === 1; }) || {}).q;
  if (range && payQ) {
    // a range is "that range"; "up to $90,000+" or one figure is not a range and is never called one (case 18)
    if (payText) out.push({ q: payQ, answer: isPayRange(payText) ? `The posting lists ${range}, and that range works for me. [Where in it you fit and why, in one sentence.]` : `The posting lists ${range}. [Whether that works for you, and where you fit and why — never a number below it.]`, resume_fact: '' });
    else out.push({ q: payQ, answer: `[The range you would accept, said as a range — never one number.] [Where in it you fit and why: your years, this market, the schedule.]`, resume_fact: '', reference: `${pay.scope === 'market' ? `${shortTitle(role)} listings at other employers` : `${company}'s other listings`} on Seen pay about ${range}. A floor to check your range against — not your ask.` });
  }
  // a professional phone screen asks your level and years: the résumé's own years, else the dated in-field jobs
  if (stage === 'Phone Screen' && PROFESSIONAL.test(fam) && top) {
    // ONE years figure (D12): the dated years the fit check counts, said whole; never the résumé's own "5 years" beside
    // the fit check's 7.9 on the same card (the résumé check says to make them match)
    const dated = datedYears(ctx);
    const months = inField.reduce((n, h) => n + (h.months || 0), 0);
    const yrs = dated != null ? Math.floor(dated) : months >= 12 ? Math.floor(months / 12) : null;
    if (yrs) out.push({ q: 'What level are you at now, and how many years have you worked in this field?', why: 'Recruiters write this down first to place you at a level. Say your title and your years plainly; never a lower level than you hold.', addQuestion: true, answer: `I have ${yrs} ${yrs === 1 ? 'year' : 'years'} of ${dated != null ? 'related ' : ''}experience, most recently as ${article(shortTitle(top.title))} ${shortTitle(top.title)} at ${co(top.company)}. [The level you were at, if your company used levels.]`, resume_fact: '' });
  }
  return out;
}

// The dated years the fit check counts for this posting ("You show 7.9 years of related experience"), or null.
function datedYears(ctx) {
  for (const c of ctx.constraints || []) {
    const m = c.kind === 'years' && String(c.message || '').match(/\bYou show (?:about |around )?(\d+(?:\.\d+)?) years?\b/);
    if (m) return Number(m[1]);
  }
  return null;
}
// The résumé's own stated years when they disagree with its dates by a year or more: one line in the résumé check.
function yearsCheck(ctx) {
  const dated = datedYears(ctx);
  if (dated == null) return null;
  for (const line of ctx.sheet.statedYears || []) {
    const n = Number((String(line).match(/(\d+)\+?\s*years?/i) || [])[1]);
    if (n && Math.abs(Math.floor(dated) - n) >= 1) return { line: clean(line, 160), note: `This says ${n} years; your dates show about ${Math.floor(dated)} years of related experience. Make them say the same number — an interviewer who does the maths will ask.` };
  }
  return null;
}

// ── The step up, told from the résumé ───────────────────────────────────────────────────────────
const LEAD_LINE_RE = /\b(?:led|lead|leads|supervis\w*|manag\w*|team of|crew of|oversaw|oversee|ran|run|hired|scheduled?|schedules|built (?:the |weekly )?schedules?|coached|trained|mentor\w*|charge nurse|foreman|opened|closed|escalat\w*)\b/i;
/**
 * "What makes you ready to step up from X to Y?" answered with up to three of the person's own lines from the job
 * closest to the target — the people they lead, the scale they run, a result — in first person, then one blank:
 * what they would take on first in the new role. null when the résumé has no such line.
 */
export function stepUpAnswer(ctx, role, q) {
  // the job in the target's field with lines about leading (a barista's training line is not the story for a Digital
  // Marketing Manager); none → no draft, the question keeps its honest frame
  const fam = prepFamily(role);
  const jobs = ctx.sheet.jobs.slice(0, 3);
  // front-line work is one ladder (a Guest Experience Team Lead at Target to an Assistant Store Manager)
  const FRONT_LINE = new Set(['retail', 'warehouse', 'customer_service', 'food_service', 'hospitality', 'delivery_logistics']);
  const near = (f) => f === fam || f === 'general' || (FRONT_LINE.has(f) && FRONT_LINE.has(fam));
  const inField = jobs.filter((j) => fam === 'general' || near(prepFamily(j.title)));
  const job = inField.find((j) => j.bullets.some((b) => !b.uncertain && LEAD_LINE_RE.test(b.text))) || null;
  if (!job) return null;
  const score = (t) => (LEAD_LINE_RE.test(t) ? 2 : 0) + (/\d/.test(t) ? 1 : 0) + (STORY_RE.test(t) ? 1 : 0);
  const picks = job.bullets.map((b, i) => ({ b, i, n: b.uncertain ? 0 : score(b.text) })).filter((x) => x.n >= 2).sort((a, b) => b.n - a.n || a.i - b.i).slice(0, 3).sort((a, b) => a.i - b.i);
  if (!picks.length) return null;
  const said = picks.map(({ b }) => {
    const fp = firstPerson(b.text, { current: job.current });
    if (!fp) return '';
    const more = fp.rest.map((r) => (/^I /.test(r) ? r : `${r.charAt(0).toLowerCase()}${r.slice(1)}`)).join(', and ');
    return `${capFirst(fp.first)}${more ? `, and ${more}` : ''}.`;
  }).filter(Boolean);
  if (!said.length) return null;
  const title = shortTitle(job.title);
  const where = job.company ? `At ${spokenEmployer(job.company)}${title ? `, where I${job.current ? "'m" : ' was'} ${article(title)} ${title}` : ''}, ` : '';
  const lead = said[0];
  const target = shortTitle(plainTitle(role) || role);
  const answer = `${where}${lead}${said.length > 1 ? ` ${said.slice(1).join(' ')}` : ''} [What you would take on first as ${article(target)} ${target}, and why.]`;
  return { q, why: 'The posting is a step up from your title. Lead with the bigger job you already do, then what you would do first.', answer, situation: '', action: answer, result: '', resume_fact: picks[0].b.text, stepUp: true };
}

// ── Scenario questions from the posting (clinical and trade roles) ──────────────────────────────
// What a panel asks about the posting's own procedures and equipment ("Walk me through caring for a patient with a chest
// tube"), with the person's closest line as a hint — never inside the answer. Only names that read as a procedure or a
// piece of equipment; a reader's stray phrase ("less than 1", an employer's initials) never becomes a question.
const CLINICAL_RE = /\b(?:therap\w*|wound|tubes?|drains?|catheter\w*|irrigation|doppler\w*|telemetry|iv\b|infusion|ventilat\w*|trach\w*|ostom\w*|dialysis|insulin|drips?|sepsis|stroke|cardiac|rhythm\w*|post-?op\w*|surgical|transfusion\w*|chf|copd|diabet\w*|restraints?|falls?|pain management|medication administration|blood products|central lines?|picc|ekg|ecg|vital signs|assessment)\b/i;
const TRADE_RE = /\b(?:hvac|refrigeration|plumbing|electrical|boilers?|chillers?|rtus?|compressors?|generators?|motors?|controls?|plcs?|panels?|switchgear|conduit|fire alarm|wiring|pumps?|kitchen equipment|walk-?in|ice machines?|ovens?|fryers?|welding|hydraulic\w*|pneumatic\w*|conveyors?|forklifts?|lockout|tagout)\b/i;
function scenarioQuestions(ctx, family, bullets) {
  const clinical = family === 'healthcare_support' || family === 'clinical';
  const trade = family === 'skilled_trades';
  if (!clinical && !trade) return [];
  const names = [];
  for (const r of ctx.requirements || []) {
    const items = r.anyOf && r.anyOf.length ? r.anyOf : String(r.label || '').replace(/^one of\s+/i, '').split(/,\s*|\s+or\s+/);
    for (const raw of items) {
      const x = clean(String(raw).replace(/^(?:and|or)\s+/i, ''), 60);
      if (!x || x.split(/\s+/).length > 5 || /\d/.test(x) || NOT_A_REQUIREMENT_RE.test(x) || CREDENTIAL_LABEL_RE.test(x) || SOFT_SKILL_RE.test(x)) continue;
      if (!(clinical ? CLINICAL_RE : TRADE_RE).test(x)) continue;
      if (!names.some((n) => n.toLowerCase() === x.toLowerCase())) names.push(x);
    }
  }
  const lc0 = (t) => (/^[A-Z]{2,}/.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1));
  return names.slice(0, 2).map((x) => {
    const said = postingCase(lc0(x), ctx.jobDescription);
    const q = clinical
      ? `Walk me through caring for a patient who needs ${said} — what do you check first, and when do you call the provider?`
      : `Walk me through ${/^[aeiou]/i.test(said) && !/^[A-Z]{2,}/.test(said) ? 'an' : /^[AEFHILMNORSX][A-Z]/.test(said) ? 'an' : 'a'} ${said} call — how do you find the fault, and how do you keep it safe?`;
    // the line most likely to hold the story: one that shares a real word with the procedure or equipment
    const ws = stemsOf(x);
    const hint = bullets.map((b) => ({ b, n: stemsOf(b.text).filter((w) => ws.includes(w)).length })).filter((h) => h.n > 0).sort((a, b) => b.n - a.n)[0];
    const frame = clinical
      ? '[What you check first, and why.] [What you do next, and who you call.] [How you know the patient is doing better.]'
      : '[What you check first, and why.] [How you find the fault, step by step, and how you keep it safe.] [How you know it is fixed.]';
    return { q, why: `The posting names ${said}. Panels ask you to talk it through, step by step.`, scenario: true, frame, ...(hint ? { hint: hint.b.text } : {}) };
  });
}

// ── What THIS posting names: its duties, worded as the questions an interviewer asks ──────────────
// The director's hidden set (2026-11-10): a support team lead applying to a Call Center Trainer job got only
// customer-handling questions and none about designing or delivering training; 69% of the pack's sentences recurred
// verbatim across postings. The questions now come from the posting's own duty lines (each carries `source`, the line),
// and every frame and story prompt names a detail of THIS posting.
const DUTY_SKIP_RE = /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\b(?:on-?site|in[- ]office|remote|hybrid)\b|\b(?:benefits?|pay|salary|bonus|401|pto|insurance|equal opportunity|eeo|background check|drug (?:test|screen)|lift(?:ing)?\b|lbs|pounds|stand(?:ing)? for|schedule|shifts?|weekends?|holidays?|travel up to|other duties|as assigned|as needed|reasonable accommodation|authori[sz]ed to work)\b/i;
/** The posting's duty and requirement lines a person can be asked about: { sentence, text, short, verb, kind }. */
export function postingDuties(jobText) {
  const out = [];
  for (const x of sectionPosting(jobText)) {
    if (!['responsibilities', 'requirements', 'preferred'].includes(x.kind)) continue;
    let text = clean(x.sentence, 400).replace(/^[•●▪◦*·\-–—\s]+/, '').replace(/^(?:you will|you'll|will)\s+/i, '').replace(/[.;:!]+$/, '');
    // "Be an Owner: Take ownership of your assigned shifts…" — the duty is what follows the label
    const colon = text.match(/^[^:]{2,40}:\s+(.+)$/);
    if (colon) text = colon[1];
    if (/^(?:be|we|we're|we’re|are|is|have|has|this|that|these|our|join|apply|help us|if|when|while|please|must)\b/i.test(text)) continue;
    // "Experience with a warehouse management system" / "Ability to read blueprints": the thing itself
    text = text.replace(/^(?:\d+\+?\s*years?\s+of\s+)?(?:(?:hands-on|proven|strong|demonstrated)\s+)?(?:experience|knowledge|familiarity|proficiency|expertise)\s+(?:with|in|of|using|on)\s+(?:an?\s+|the\s+)?/i, '').replace(/^(?:the\s+)?ability to\s+/i, '');
    if (!text) continue;
    // "Effectively maintains floor coverage", "Generates maximum sales": the duty is said with its verb's base form
    text = text.replace(/^(?:effectively|consistently|regularly|actively|proactively|independently|accurately|efficiently|promptly|safely)\s+/i, '');
    { const v0 = text.split(/\s+/)[0]; const b0 = verbBase(v0.toLowerCase()); if (b0 && /s$/i.test(v0) && b0 !== v0.toLowerCase()) text = `${b0.charAt(0).toUpperCase()}${b0.slice(1)}${text.slice(v0.length)}`; }
    const n = text.split(/\s+/).length;
    // a link or a sign-up line is not a duty ("Learn more about Saxbys E.L.P. by clicking here")
    if (n < 4 || n > 32 || DUTY_SKIP_RE.test(text) || NOT_A_REQUIREMENT_RE.test(text) || /[?"“”]/.test(text) || /\b(?:click(?:ing)? here|learn more|visit (?:our|the) (?:site|website|page)|apply (?:now|today|here))\b/i.test(text) || /\b(?:driving (?:history|record)|driver'?s licen[cs]e|background check|criminal)\b/i.test(text)) continue;
    const w0 = text.split(/\s+/)[0].replace(/,$/, '');
    const verb = !!verbBase(w0.toLowerCase()) && !/(?:ed|ing)$/i.test(w0) && !/^(?:experience|knowledge|ability|proficiency|strong|excellent|must|minimum|bachelor|degree|high|valid|current|familiarity|understanding|comfort|passion|fluency|exposure|interest)$/i.test(w0);
    // the line said short: up to its first clause break, at most 12 words, "our" → "the"
    // "Follow up with, execute, and properly document doctors' orders": a list of verbs sharing one object is one duty
    const verbList = (() => { const m = /^\S+(?:\s+\S+){0,2},\s+(?:and\s+)?(?:\w+ly\s+)?([a-z]+)\b/.exec(text); return !!(m && verbBase(m[1])); })();
    // the HEAD clause only (director round 7): never across a colon, "using", "including", "such as", "on the spot"
    const hc = text.match(/^((?:\S+\s+){0,5}\S+?):\s+\S/);
    const head0 = (hc && verbBase(hc[1].split(/\s+/)[0].toLowerCase()) ? hc[1] : text).split(/\s+(?:using|including|incl\.?|such as|e\.g\.|like|via|on the spot|when (?:we|you|needed|necessary|it|they)\b)(?:\s+|$)/i)[0];
    const short = head0.split(verbList ? /;\s+|\s+(?:in order to|to ensure|ensuring|while maintaining|so that)\s+/i : /,\s+(?=(?:and |as well as |including |to |ensuring |while ))|;\s+|\s+(?:in order to|to ensure|ensuring|while maintaining|so that)\s+/i)[0]
      .split(/\s+/).slice(0, 12).join(' ').replace(/\bour\b/gi, 'the').replace(/\byour\b/gi, 'the').replace(/[,\s]+(?:and|or|the|a|an|of|to|for|with|in|on)$/i, '').replace(/[,;:]+$/, '');
    // a line cut at 12 words never ends half way through its second duty ("Place the daily food and paper order and keep
    // pars up"): it ends before that duty's "and <verb>"
    const cutShort = head0.split(/\s+/).length > 12 ? (() => { const ws = short.split(/\s+/); for (let i = ws.length - 2; i >= 3; i--) if (/^and$/i.test(ws[i]) && verbBase(ws[i + 1].toLowerCase()) === ws[i + 1].toLowerCase() && !/^(?:paper|order|records?|reports?|inventory|stock|supplies|equipment|safety|quality|service|care)$/i.test(ws[i + 1])) return ws.slice(0, i).join(' '); return short; })() : short;
    // a list cut short ("inventory, equipment") ends before its comma
    const short1 = cutShort.split(/\s*\(/)[0].trim();
    const short2 = /,/.test(short1) && !/,\s.*\band\b/.test(short1) ? short1.split(',')[0].trim() : short1;
    // a heading run into its first line ("Campaign & Lifecycle Execution Support Support lifecycle…") is not a duty
    if (short2.split(/\s+/).length < 3 || /^(?:[A-Z][\w&/-]*\s+(?:&\s+)?){3,}/.test(short2) || /\b(\w{3,})\s+\1\b/i.test(short2)) continue;
    // a duty cut before its noun ("Drive accurate and timely monthly") is a fragment: never asked
    if (/\b(?:monthly|quarterly|annual|annually|weekly|daily|timely|accurate|accurately|efficient|efficiently|high-quality|complex|key|various|multiple|all|any|such)$/i.test(short2)) continue;
    if (!out.some((d) => d.short.toLowerCase() === short2.toLowerCase())) out.push({ sentence: x.sentence, text, short: short2, verb, kind: x.kind });
  }
  return out;
}
// "Design and deliver training for new agents" → "designed and delivered training for new agents"
function pastDuty(short) {
  const t = short.split(/\s+/);
  const out = [];
  let lead = true;
  for (let i = 0; i < t.length; i++) {
    const raw = t[i];
    const word = raw.replace(/,$/, '');
    const base = lead ? verbBase(word.toLowerCase()) : '';
    if (base && !/^(?:and|or)$/i.test(word)) { out.push(`${pastTense(base)}${raw.endsWith(',') ? ',' : ''}`); lead = raw.endsWith(','); if (/^(?:and|or)$/i.test(t[i + 1] || '') && verbBase(String(t[i + 2] || '').toLowerCase())) { out.push(t[i + 1]); i++; lead = true; } continue; }
    lead = false;
    out.push(i === 0 ? raw.toLowerCase() : raw);
  }
  return out.join(' ');
}
// the thing a duty acts on ("design and deliver training for new agents" → "the training for new agents")
function dutyObject(short) {
  const t = short.split(/\s+/);
  let i = 0;
  while (i < t.length && (verbBase(t[i].replace(/,$/, '').toLowerCase()) || /^(?:and|or)$/i.test(t[i]))) i++;
  const rest = t.slice(i).join(' ').replace(/^(?:the|a|an|all|any|our|your)\s+/i, '');
  return rest && rest.split(/\s+/).length <= 8 ? `the ${rest}` : 'it';
}
const lcLead = (t) => (/^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t);
const SPEC_STEM = (w) => w.length >= 5 && !/^(?:proce|manag|handl|servi|suppo|opera|skill|abili|work|team|gener|basic|daily|perfo|maint|ensur|assis|dutie|other|every|their|syste|provi|inclu|requi|depar|activ|relat|ident)/.test(w);

/**
 * Questions from the posting's own duties (at most `max`). A duty a résumé line does (two specific words in common) is
 * asked as "Tell me about a time you …" and told from that line; one it does not is asked as "How would you … here?"
 * with a frame that names the duty. `stories: false` (a career change) never tells a line as the duty.
 */
export function dutyQuestionsFor(ctx, duties, bullets, used, { max = 5, stories = true, promptFor = () => '' } = {}) {
  const qs = [];
  const answers = [];
  for (const d of duties.filter((x) => x.verb).slice(0, max * 2)) {
    if (qs.length >= max) break;
    const ds = stemsOf(d.short).filter(SPEC_STEM);
    const hit = stories && ds.length ? bullets.filter((b) => !used.has(b.id)).map((b) => ({ b, n: stemsOf(b.text).filter((w) => ds.includes(w)).length })).filter((h) => h.n >= 2).sort((a, b) => b.n - a.n)[0] : null;
    const why = `The posting lists it: “${clean(d.text, 140)}”.`;
    if (hit) {
      const q = `Tell me about a time you ${pastDuty(d.short)}.`;
      const st = storyAnswer(hit.b.text, hit.b.job, { prompt: promptFor(q) });
      if (st && !answers.some((a) => a.answer === st.answer)) {
        used.add(hit.b.id);
        qs.push({ q, why, source: d.sentence });
        answers.push({ q, why, ...st, resume_fact: hit.b.text, source: d.sentence });
        continue;
      }
    }
    const q = `How would you ${lcLead(d.short)} here?`;
    const near = bullets.map((b) => ({ b, n: stemsOf(b.text).filter((w) => ds.includes(w)).length })).filter((h) => h.n >= 1).sort((a, b) => b.n - a.n)[0];
    qs.push({ q, why, source: d.sentence, frame: `[What you would do first on “${d.short}”, and why.] [Who you would work with on ${dutyObject(d.short) === 'it' ? `“${d.short.split(/\s+/).slice(0, 5).join(' ')}”` : dutyObject(d.short)}, and what you would ask them.] [How you would know ${dutyObject(d.short) === 'it' ? `“${d.short.split(/\s+/).slice(0, 5).join(' ')}”` : dutyObject(d.short)} was working — the sign you would look for.]`, ...(near ? { hint: near.b.text } : {}) });
  }
  return { questions: qs, answers };
}

/**
 * How close the posting's field is to the person's: 'same' | 'adjacent' | 'different'. The verdict's own `field_match`
 * when the reader provides it; until then derived from the verdict — the role's field against the fields of the titles
 * held, and the share of the posting's requirements the résumé shows. One small function so it can be swapped.
 */
export function fieldMatch(ctx, family) {
  // the reader's field match (lib/optimizer/fieldMatch.js) is an object { level, postingField, … } on the verdict
  const fmv = ctx.fit && (ctx.fit.field_match || (ctx.fit.verdict && ctx.fit.verdict.field_match));
  if (fmv && typeof fmv === 'object' && fmv.level && (fmv.known !== false || fmv.level !== 'different')) return fmv.level;
  if (typeof fmv === 'string') return fmv;
  const reqs = (ctx.requirements || []).filter((r) => !r.soft && r.kind !== 'trait' && r.kind !== 'schedule');
  const share = reqs.length ? reqs.filter((r) => r.matched && !r.inferred).length / reqs.length : 1;
  const held = ctx.sheet.jobs.map((j) => prepFamily(j.title));
  const FRONT = new Set(['retail', 'warehouse', 'customer_service', 'food_service', 'hospitality', 'delivery_logistics']);
  const CARE = new Set(['healthcare_support', 'clinical']);
  if (!family || family === 'general') return reqs.length >= 4 && share < 0.2 ? 'different' : share < 0.45 ? 'adjacent' : 'same';
  if (held.includes(family)) return 'same';
  if ((FRONT.has(family) && held.some((f) => FRONT.has(f))) || (CARE.has(family) && held.some((f) => CARE.has(f)))) return 'adjacent';
  if (held.every((f) => f === 'general')) return share >= 0.4 ? 'adjacent' : share < 0.2 && reqs.length >= 4 ? 'different' : 'adjacent';
  return share >= 0.5 ? 'adjacent' : 'different';
}

/** A detail of this posting for a question or a line: the duty or requirement that shares the most words with it. */
export function detailPicker(duties, requirementLabels) {
  const pool = [...duties.map((d) => d.short), ...requirementLabels].filter((t) => t && t.split(/\s+/).length <= 12);
  const usedN = new Map();
  return (text) => {
    if (!pool.length) return '';
    const ws = stemsOf(text);
    const scored = pool.map((p, i) => ({ p, n: stemsOf(p).filter((w) => ws.includes(w)).length * 3 - (usedN.get(p) || 0) * 2 - i * 0.01 })).sort((a, b) => b.n - a.n);
    const pick = scored[0].p;
    usedN.set(pick, (usedN.get(pick) || 0) + 1);
    return pick;
  };
}
/** The first bracket of an answer, with this posting's detail named inside it. */
export function anchorBracket(answer, detail, mode = 'past') {
  if (!detail || !/\[[^\]]+\]/.test(answer) || answer.includes(`“${detail}”`)) return answer;
  // the detail leads the box, so the whole prompt is about this job ("[For “month-end close”: one time it mattered…]")
  const lead = mode === 'past' ? `Closest to “${detail}” you can get` : `Here, with “${detail}”`;
  let out = answer.replace(/\[([^\]]+?)([.?!]?)\]/, (m, body, end) => `[${lead}: ${body.charAt(0).toLowerCase()}${body.slice(1)}${end || '.'}]`);
  // the frame's other boxes say what they are about, too
  out = out.replace('[What you did, step by step.]', `[What you did about it, step by step — the part that touched ${detail}.]`)
    .replace('[How it ended — with a number if you have one.]', `[How it ended — with a number if you have one, and what it meant for ${detail}.]`)
    .replace('[What you do next, and who you involve.]', `[What you do next on ${detail}, and who you involve.]`)
    .replace('[How you know it worked.]', `[How you know it worked for ${detail}.]`)
    .replace('[What you would do next, and who you would bring in.]', `[What you would do next on ${detail}, and who you would bring in.]`);
  return out;
}

/** The questions an interviewer asks someone changing field, each a frame — never a story the résumé cannot tell. */
// a requirement said inside a sentence: a Title-Case common word reads in lower case ("Training" → "training"); a tool,
// an acronym or a brand keeps its capitals
const sayLabel = (l) => (/^(?:[A-Z][a-z]+)(?:\s+(?:[A-Z][a-z]+|and|of|&))*$/.test(l) && !TOOL_RE.test(l) ? l.toLowerCase() : l);
function careerChangeQuestions(ctx, role, match, duties, bullets) {
  const cur = ctx.sheet.jobs.find((j) => j.current) || ctx.sheet.jobs[0];
  const mine = cur ? shortTitle(cur.title) : '';
  const roleSaid = shortTitle(plainTitle(spokenRole(role)) || role);
  if (!mine || !roleSaid) return [];
  const list = (xs) => xs.join(', ').replace(/, ([^,]+)$/, ' and $1');
  const shown = match.filter((m) => m.source === 'verdict' && ['shown', 'stated', 'related'].includes(m.status)).map((m) => sayLabel(m.label)).slice(0, 2);
  const gaps = match.filter((m) => m.source === 'verdict' && m.status === 'gap' && m.label.split(/\s+/).length <= 6).map((m) => ({ ...m, label: sayLabel(m.label) }));
  const proof = match.find((m) => m.source === 'verdict' && m.proof);
  const lead = duties.find((d) => d.verb);
  const qs = [
    { q: `What makes you want to move from ${mine} work to ${article(roleSaid)} ${roleSaid} job?`, why: 'The first thing they will ask someone changing field. Keep it about what draws you, never about what you are leaving.', changer: true, ...(lead ? { source: lead.sentence } : {}), frame: `[What in your work as ${article(mine)} ${mine} pointed you toward ${roleSaid} work.] [What draws you to ${lead ? `“${lead.short}”` : 'this work'} in particular.] [What you have done so far to get ready for ${roleSaid} work.]` },
    { q: lead ? `What from your work as ${article(mine)} ${mine} would carry over to “${lead.short}”?` : `What from your work as ${article(mine)} ${mine} carries over to this job?`, why: 'They want to hear you name what transfers, plainly, and what you would still have to learn.', changer: true, frame: shown.length ? `[Name it plainly: ${list(shown)} — the posting asks for ${shown.length > 1 ? 'both' : 'it'}.] [One example from your résumé that shows ${shown[0]}.] [What you would still have to learn${gaps[0] ? ` — ${gaps[0].label}, for one` : ''}.]` : `[The one or two things you already do that ${lead ? `“${lead.short}”` : 'this job'} needs, named plainly.] [One example from your work as ${article(mine)} ${mine}${lead ? ` that fits “${lead.short}”` : ''}.] [What you would still have to learn${gaps[0] ? ` — ${gaps[0].label}, for one` : ''}.]`, ...(proof ? { hint: proof.proof } : bullets[0] ? { hint: bullets[0].text } : {}) },
    { q: `What have you done to prepare for ${roleSaid} work?`, why: 'Say only what is real: a course, a certification, a project, time spent with people who do the job.', changer: true, frame: `[A course, a certification or a project toward ${roleSaid} work — only what is real.] [What you learned that you could use in your first week${lead ? ` on “${lead.short}”` : ''}.]` },
  ];
  if (gaps[0]) qs.push({ q: `How would you get up to speed on ${gaps[0].label}, which this posting asks for?`, why: 'An honest plan beats a stretched answer.', changer: true, source: gaps[0].label, frame: `[Where you stand with ${gaps[0].label} today, said plainly.] [The first step you would take on ${gaps[0].label}, and how long it would take.]` });
  return qs;
}

// ── The posting's pay ───────────────────────────────────────────────────────────────────────────
// ONE pay reader for every tool (lib/jobs/postingPay.js — Job Insights reads the same): only a sentence that states
// pay, never "$2B ARR", a gym stipend, a sign-on bonus, a differential or a template placeholder; "up to" and the unit
// kept. No pay stated → null, and the pay answer is the honest frame, never a figure.
export const isPayRange = (t) => /\d\s*(?:[–—-]|to)\s*\$?\s?\d/.test(String(t || ''));
/** The posting's own pay as a person would say it mid-sentence ("$64,397 – $80,496", "up to $90,000+ a year"), or null. */
export function postingPay(jobText) {
  const p = readPostingPay(jobText);
  return p && p.text ? p.text.replace(/^Up to\b/, 'up to').replace(/^Starting at\b/, 'starting at').replace(/^From\b/, 'from') : null;
}

// ── Prompts that fit the question, not only the line ─────────────────────────────────────────────
// Round 3: an incident question carried "[the hardest part of building it]" and a schema story "[One person you
// remember…]". The bracket is the one thing the person must add, so it has to ask for what THIS question wants.
const QUESTION_PROMPTS = [
  [/\bhow do you (?:decide|choose|plan|prioriti[sz]e|measure|know|tell|track|keep track)\b/i, '[How you decide — the two or three things you look at first — and the number that tells you it worked.]'],
  [/\b(?:incident|outage|went wrong|broke|failed|failure|did not work|didn't work|mistake)\b/i, '[What went wrong, how you found the cause, and what you changed so it would not happen again.]'],
  [/\b(?:trade-?offs?|system you built|design(?:ed)?|architect)\b/i, '[The trade-off you made, and what you would change now.]'],
  [/\b(?:disagree|pushed back|conflict|difficult (?:coworker|colleague|teammate))\b/i, '[What the other person wanted, how you made your case, and how it was settled.]'],
  [/\b(?:safe|safety)\b/i, '[The moment the pace or the pressure went up, and what you did to keep people safe.]'],
  [/\b(?:behind|deadline|under pressure|short[- ]staffed|rush|peak)\b/i, '[What was behind, the two or three moves you made, and where you ended the day.]'],
  [/\b(?:customer|guest|patient|client)\b/i, '[One person you remember: what they needed, what you did, and how it ended.]'],
  [/\b(?:train|coach|mentor|onboard)/i, '[How you trained them: what the first weeks looked like, and how you knew they were ready.]'],
  [/\b(?:improv|increas|grew|cut|reduc|result)/i, '[What you changed, step by step, and who you got on board.]'],
];
export function promptForQuestion(q) {
  const hit = QUESTION_PROMPTS.find(([re]) => re.test(String(q || '')));
  return hit ? hit[1] : '';
}
// A company framework's principle, and the résumé lines that show it (Amazon's Leadership Principles and the
// behaviors most frameworks name). A cue finds a story for a company question; it never invents one.
const PRINCIPLE_CUES = [
  [/ownership|accountab|took ownership|owned/i, /\b(?:owned|took over|took on|volunteer|outside my|beyond my|stepped in|covered|on-?call|ran|led)\b/i],
  [/customer obsession|customer|client focus|guest/i, /\b(?:customers?|guests?|patients?|clients?|members?|callers?|residents?|students?|families)\b/i],
  [/deliver(?:s|ing)? results|results|execution|impact/i, /\d/],
  [/highest standards|quality|accuracy|standards|excellence/i, /\b(?:accuracy|quality|standards?|error|defect|audit|zero|99|100%|compliance|clean)\b/i],
  [/bias for action|speed|urgency|move fast/i, /\b(?:same day|within (?:a|one) (?:day|week|hour)|fast|quick|immediately|turnaround|hours)\b/i],
  [/earn trust|trust|integrity|candor|feedback/i, /\b(?:trust|honest|feedback|escalat|reported|flagged|transparen|owned up)\b/i],
  [/learn and be curious|learn|curios|growth/i, /\b(?:learned|taught myself|certif|course|trained on|picked up|new (?:tool|system|skill))\b/i],
  [/hire and develop|develop|coach|mentor|people/i, /\b(?:trained|coached|mentored|onboarded|hired|precepted|developed)\b/i],
  [/frugal|cost|budget|efficien/i, /\b(?:saved|cost|budget|overtime|waste|\$|cut|reduc)\b/i],
  [/think big|vision|strategy|innovat/i, /\b(?:launched|built|created|started|designed|new|first)\b/i],
  [/dive deep|data|root cause|detail|analy/i, /\b(?:root cause|found|discovered|analy|audit|data|report|dashboard|investigat)\b/i],
  [/disagree and commit|disagree|conflict|backbone/i, /\b(?:pushed back|disagree|escalat|proposed|convinced|negotiat)\b/i],
  [/safety|safe/i, /\b(?:safety|osha|injur|recordable|incident|safe)\b/i],
  [/leadership|lead|team/i, /\b(?:led|lead|supervis|team of|crew of|managed|scheduled|coached)\b/i],
  [/problem[- ]solving|solve|fix/i, /\b(?:fixed|solved|resolved|cut|reduc|repair|troublesho)\b/i],
  [/teamwork|collaborat|together/i, /\b(?:team|with|cross-functional|partner|coordinat)\b/i],
];
function principleFits(q, line) {
  const key = `${q.principle || ''} ${q.q}`;
  const cue = PRINCIPLE_CUES.find(([pre]) => pre.test(key));
  return !!(cue && cue[1].test(line));
}
// A question no résumé line answers still gets its shape: the three sentences to say, each a blank the person
// fills in on the card. Never a fact Seen does not have.
// Recruiter and logistics questions are answered with facts about now (a date, a range, a commute, other interviews,
// why you moved), never with a résumé story (D7, case 15: "How soon can you start, and how far will you commute?" ←
// "Reduced no-shows by starting text reminders"). Each purpose has its own frame; a question may have two.
const LOGISTICS = [
  ['start', /\b(?:when (?:could|can) you start|how soon (?:could|can) you start|start date|notice period)\b/i, '[The first day you could start, and the notice you owe where you work now.]'],
  ['commute', /\b(?:commute|how far|get (?:here|to work)|transportation|relocat\w*)\b/i, '[How you would get here and how long it takes.] [Any day that would be a problem, said plainly.]'],
  ['hours', /\b(?:your availability|what is your availability|what hours|which (?:days|shifts)|open availability|can you work (?:weekends|nights|holidays|overtime|truck days)|are you available|set to the minute|schedule adherence)\b/i, '[The days and hours you can work, said plainly.] [Any fixed limits — school, a second job, childcare — and when they change.]'],
  ['pay', /\b(?:pay expectations?|pay range|salary|compensation|what (?:rate|pay)|lowest you would accept|desired pay)\b/i, '[A range you would accept, not one number.] [Where in it you fit and why — your experience, this market.]'],
  ['others', /\b(?:interviewing (?:anywhere|elsewhere|with)|other (?:interviews|offers|companies|roles)|turn (?:a|the) (?:role|job|offer) down)\b/i, '[Whether you are interviewing elsewhere — yes or no; no names needed.] [What would make this job the one you take, said honestly.]'],
  ['resume', /\b(?:walk me through your (?:résumé|resume|background|career)|why you left|why did you leave|reasons? for leaving)\b/i, '[Your current or latest role in two sentences: what you do and one result.] [Each earlier move in one sentence: what you went to — never a complaint about what you left.] [Why this job is the next step.]'],
];
export const isLogistics = (q) => LOGISTICS.some(([, re]) => re.test(String(q || '')));
const purposes = (q) => new Set(LOGISTICS.filter(([, re]) => re.test(String(q || ''))).map(([k]) => k));
function logisticsFrame(q) {
  const parts = LOGISTICS.filter(([, re]) => re.test(String(q || '')));
  // "When could you start, and what hours can you work?" — the start date and the hours, one frame each, no repeats
  return parts.length ? parts.map(([, , f]) => f).join(' ') : '';
}
const FRAME_BY_QUESTION = [
  // the move question ("Why home health now?", "Why this kind of role now?") is about the person, not the employer
  [/^Why .+ now\?$/i, '[What you have already done that comes closest to it.] [What draws you to it now, in one sentence.] [How you are getting ready.]'],
  [/^What do you know about/i, '[What they do and who they serve, in your own words.] [One recent thing you read about them — a launch, a store opening, a result.] [Why that matters for this job.]'],
  [/^When could you start/i, '[The first day you could start.] [Any days or hours you cannot work, said plainly.]'],
  [/\b(?:availability|what hours|which (?:days|shifts)|open availability|weekends?|nights?|holidays?|overtime|truck days?)\b/i, '[The days and hours you can work, said plainly.] [Any fixed limits — school, a second job, childcare — and when they change.] [How much notice you need to change a shift.]'],
  [/^What are your pay expectations/i, '[A range you would accept, not one number.] [Where in it you fit and why — your experience, this market.]'],
  [/^Why are you a good fit/i, '[Two things the posting asks for that you have done, named.] [One result that proves it.]'],
  [/^What questions do you have/i, '[Ask what success looks like in the first 90 days.] [Ask what the next step is and when you will hear.]'],
  [/^Why (?:do you want to work|this|us)/i, '[One specific thing about them you have seen yourself.] [How it fits what you do best, with one example.]'],
  [/\b(?:how do you|how would you|what do you do when|what would you do|what would you say|how do you handle|how would you handle)\b/i, '[What you do first, and why.] [What you do next, and who you involve.] [How you know it worked.]'],
  // a scenario told in the present tense ("A truck arrives with more freight than usual…", "Sales are down…")
  // asks what you WOULD do, not for a past story (round 4, Maria: hypotheticals got past-tense STAR frames)
  [/^(?:A |An |The |Your |Sales |Traffic |Two |Three |It's |It is |You (?:notice|see|find|are|have|walk))/i, '[What you would do in the first few minutes, and why.] [What you would do next, and who you would bring in.] [How you would know it worked.]'],
];
const STAR_FRAME = '[Where you were and what was going on, in one sentence.] [What you did, step by step.] [How it ended — with a number if you have one.]';
export function frameFor(q) {
  const lf = /^What do you know about/i.test(String(q || '')) ? '' : logisticsFrame(q);
  if (lf) return lf;
  const hit = FRAME_BY_QUESTION.find(([re]) => re.test(String(q || '')));
  return hit ? hit[1] : STAR_FRAME;
}

// ── The pack ────────────────────────────────────────────────────────────────────────────────────
/**
 * The whole paid pack with no model: guardPack's questions, staples, intro and résumé check (unchanged),
 * spoken answers built on the right résumé lines (the posting's evidence first), what the job asks for
 * and your answer to each, and questions to ask them.
 */
export function localPack({ company: companyIn, role, resumeText, jobText: jobTextIn = '', pay = null, stage = '', nowMs = Date.now(), taxonomy = null, confirmed = null }) {
  // the employer as people say it ("shinola" → "Shinola"); the posting as every tool reads it (lines kept, 20,000)
  // a system's slug ("akidolabs", "Acme Careers Page") is never said: "this company"
  const company = employerOrNull(companyIn) || 'this company';
  const jobText = cleanPostingText(jobTextIn);
  const base = guardPack({}, { company, role, resumeText, pay, stage, nowMs, jobText });
  // what Seen knows about how THIS company interviews (lib/server/interviewGuides.js), or null
  // the field from the title AND the posting (a "Shift Lead - Laurel" at a DashMart is a warehouse shift — D13)
  const family = prepFamilyFor(role, jobText);
  const guide = guideFor(companyIn, role, { family });
  const guideQs = guide ? guide.questions.map((q) => ({ q: q.q, why: q.why, company: true, principle: q.principle || null, ...(q.exercise ? { exercise: true } : {}) })) : [];
  // the person's own answers (the same `confirmed` array the free check and the paid version take) reach the verdict
  const ctx = buildContext({ resumeText, jobTitle: role, company, jobDescription: jobText || role, nowMs, taxonomy, confirmed });
  const diagnosis = jobText ? localDiagnosis(ctx) : { requirements: [], questions: [], gaps: [] };
  // stories are told only from lines that sit under their role in the parsed document (never an uncertain line)
  const bullets = ctx.sheet.jobs.flatMap((j) => j.bullets.filter((b) => !b.uncertain).map((b) => ({ ...b, job: j })));
  const used = new Set();
  const usedQ = new Set();
  const answers = [];
  // what the job asks for and your answer to each — built from the verdict first, because the stories below tell
  // the verdict's own proof lines (one reading of the posting for every part of the card)
  const match = jobText ? jobMatch(ctx, diagnosis) : [];
  const TEACH_LINE = /^\s*(?:trained|certified|taught|coached|onboarded|mentored)\b/i;
  // 1. the posting's must-haves the résumé proves: "Tell me about your experience with …", told from the line the
  // fit check matched (or the story line Prep added for a skills-line match)
  const shown = match
    .filter((m) => m.source === 'verdict' && (m.proof || m.story) && (m.status === 'shown' || m.status === 'stated') && !/\d|\byears?\b/i.test(m.label) && m.label.split(/\s+/).length <= 5 && !SOFT_SKILL_RE.test(m.label) && !FIELD_LABEL.test(m.label));
  for (const m of shown) {
    if (answers.length >= 2) break;
    const line = m.proof || m.story;
    const b = bullets.find((x) => x.text === line && !used.has(x.id));
    // a line that trained others never stands in for doing the thing (round 6, Ray)
    if (!b || (TEACH_LINE.test(b.text) && !/\b(?:train|teach|coach|onboard|mentor|certif)/i.test(m.label))) continue;
    const s = storyAnswer(b.text, b.job);
    if (!s) continue;
    const label = m.label;
    // the posting's own casing ("Python", "Instagram"); a common word that only starts a posting line is lowercased
    const lowerInPosting = new RegExp(`(?:^|[^.\\n•\\-]\\s)${escapeRegExp(label.toLowerCase())}\\b`).test(String(jobText));
    const q = `Tell me about your experience with ${lowerInPosting ? label.toLowerCase() : label}.`;
    used.add(b.id); usedQ.add(q);
    answers.push({ q, why: `The posting asks for ${label}. This line of yours shows it.`, ...s, resume_fact: b.text });
  }
  // 1b. the field's scenario questions a résumé line answers ("How do you keep shrink down?" ← the
  // shrink line) get that line's story (round 1: good questions had no answer while a line fit them)
  const STOPQ = new Set('what when your have with that this tell time about there they them their would could does into from where which while give example walk through handle make sure first'.split(' '));
  // words every question and many lines share ("goal", "result", "work") never make a line fit (round 3: a
  // register promotion with "goals" answered "Walk me through a campaign"); a field word also counts its
  // everyday forms (a campaign is told as followers, views, a Reel, a launch or an email)
  // workplace nouns in most lines and most questions ("team", "shift", "store") never make a line fit on their
  // own (round 4, Ray: one "led 2nd shift team of 15" line answered three different questions)
  const GENERIC_Q = new Set(['goal', 'resul', 'perfo', 'work', 'worke', 'thing', 'wrote', 'write', 'owned', 'own', 'someo', 'peopl', 'other', 'every', 'chang', 'help', 'impro', 'time', 'day', 'wee', 'week', 'month', 'team', 'shift', 'crew', 'store', 'manag', 'job', 'role', 'compa', 'custo', 'guest', 'hours', 'hour', 'assoc', 'emplo', 'cowor', 'colle', 'frien',
    // a verb two lines share is not the same story ("how soon can you START" ↔ "by STARTING text reminders" — D7)
    'start', 'begin', 'make', 'take', 'give', 'come', 'need', 'want', 'going', 'doing', 'thing', 'somet', 'servi', 'even', 'thoug', 'busy', 'patie']);
  // "how do you know if it worked" is answered by the line that pulled the numbers (round 6, Tasha: the weekly
  // Insights report line sat unused under a three-box frame); "what to post" by the line that posted
  const MEASURE = ['insig', 'analy', 'repor', 'numbe', 'metri', 'dashb', 'kpi', 'track', 'measu', 'resul'];
  const QSYN = { condi: ['rhyth', 'alarm', 'monit', 'vital', 'asses', 'deter', 'escal', 'rapid'], early: ['rhyth', 'alarm', 'monit', 'caugh', 'spott', 'flagg'], campa: ['campa', 'follo', 'views', 'reel', 'reels', 'engag', 'newsl', 'email', 'promo', 'launc', 'grew'], know: MEASURE, measu: MEASURE, track: MEASURE, resul: MEASURE, post: ['post', 'insta', 'reel', 'reels', 'conte', 'tikto', 'faceb', 'linke'], retur: ['retur', 'refun', 'excha'], refun: ['refun', 'retur', 'excha'], send: ['send', 'sent', 'email', 'newsl', 'campa'] };
  const qWords = (t) => [...new Set(String(t).toLowerCase().split(/[^a-z0-9&+#]+/).filter((w) => w.length > 3 && !STOPQ.has(w)).map((w) => w.replace(/(?:ing|ed|es|s)$/, '').slice(0, 5)).filter((w) => !GENERIC_Q.has(w)))];
  // a customer question is answered by a line about a customer problem solved (the complaints line), never by a line
  // that only says "guest service" (case 03: "friendly service even though you were busy" ← the team-size line)
  const CUSTOMER_PROBLEM = ['compl', 'refun', 'escal', 'resol', 'angry', 'upset', 'excha'];
  const qMatch = (qw, lw, q = '') => (/\b(?:customer|guest|client|shopper|caller)s?\b/i.test(q) && !SCENARIO_Q.test(q) && CUSTOMER_PROBLEM.some((c) => lw.includes(c)) ? 1 : 0) + qw.reduce((n, w) => n + ((QSYN[w] || [w]).some((x) => lw.includes(x)) ? 1 : 0), 0) + (qw.includes('campa') && lw.some((w) => (QSYN.campa).includes(w)) && /\d/.test(lw.join(' ')) ? 1 : 0);
  const bankQs = base.questions.filter((q) => !/^(?:Tell me about yourself|Why do you want|What do you know about|What are your pay|When could you start|Why are you looking|What questions do you have)/.test(q.q) && !base.answers.some((a) => a.q === q.q));
  // the company's own questions first (a Leadership Principle finds the line that shows it), then the field's.
  // Round 4 rules, each from a wrong pairing a persona quoted:
  //   - a line fits only when it shares a real word with the question; a principle cue alone ("Dive Deep" ↔ a
  //     line with "audit") never carries a story (Ray: Dive Deep built on a training line; Dev: "ingest large
  //     amounts of data" answered with mentoring);
  //   - "Tell me about your experience with X" needs X itself in the line (Dev: machine learning ← FastAPI);
  //   - a mistake / failure question is never answered from a résumé — résumés do not list mistakes (Dev: "a
  //     detail you got wrong" ← the SOC 2 audit-log line);
  //   - a coding exercise is practised, not matched;
  //   - a line may serve a second, field question when no unused line fits it (Dev: "Walk me through a system
  //     you built" went empty because the payments line was spent on Stripe's design question).
  const BEHAVIORAL = /^(?:Tell me about a time|Describe a (?:time|situation)|Give (?:me )?an example|When have you|Talk about a time|Think of a time|Tell me about (?:a|the) (?:project|problem|moment|situation|decision))/i;
  const SKILL_Q = /^Tell me about your experience with (.+?)\.?$/i;
  // a scenario ("A truck arrives with more freight than usual…", "What would you do if…") asks what you would DO;
  // a past line answers it only when it plainly names the thing — two real words, not one shared noun (round 5,
  // Maria: the freight question built on a scheduling line through "hours")
  const SCENARIO_Q = /^(?:A |An |The |Your |Sales |Traffic |Two |Three |It's |It is |You (?:notice|see|find|are|have|walk)|Payroll |What would you|How would you|How do you|What do you do)/i;
  // a mistake, a disagreement, a conflict, feedback you were given: no résumé line tells these — always the
  // person's own three lines
  const MISTAKE_Q = /\b(?:mistake|got (?:a |something |one )?(?:detail )?wrong|went wrong|you failed|a failure|regret|weakness|do differently|didn't go (?:well|as planned)|did not go (?:well|as planned)|disagree\w*|pushed back|conflict|difficult (?:coworker|colleague|teammate|manager|customer)|feedback you|criticism|let (?:someone|a customer|a guest|the team) down)\b/i;
  const score = (q, qw, topic, x) => {
    const lw = qWords(x.text);
    const words = topic ? (topic.every((w) => (QSYN[w] || [w]).some((t) => lw.includes(t))) ? topic.length : 0) : qMatch(qw, lw, q.q);
    const principle = !!(q.company && BEHAVIORAL.test(q.q) && principleFits(q, x.text));
    // "Trained and certified 40+ associates on forklift" answers a training question; for "your experience with
    // forklift" the line that OPERATED one comes first (round 6, Ray)
    const teaching = /^\s*(?:trained|certified|taught|coached|onboarded|mentored)\b/i.test(x.text) && !/\b(?:train|teach|coach|onboard|mentor|certif)/i.test(q.q);
    const measured = /\b(?:how do you know|how do you measure|how do you track|if it worked|what worked)\b/i.test(q.q) && MEASURE.some((m) => lw.includes(m));
    return { x, words, principle, n: words + (principle ? 1.5 : 0) + (/\d/.test(x.text) ? 0.5 : 0) + (STORY_RE.test(x.text) ? 0.5 : 0) + (measured ? 0.75 : 0) - (teaching ? 0.75 : 0) - ctx.sheet.jobs.findIndex((j) => j.id === x.job.id) * 0.25 };
  };
  // Every (question, line) pair is scored first and the best pairs are taken in order, so a line goes to the
  // question it answers best rather than the first question that could take it (round 5, Dev: "owned a hard
  // problem" took the on-call line and "production incident" — the line's own word — went empty).
  const cap1 = guideQs.length ? 7 : 4;
  const pairs = [];
  [...guideQs, ...bankQs].forEach((q, qi) => {
    // a "why" question is about motives, and a role-play is acted out: neither is a résumé story (an unseen Concentrix
    // prep: "Why this client's product…?" was answered with the complaints line)
    if (q.exercise || MISTAKE_Q.test(q.q) || isLogistics(q.q) || /^Why\b/i.test(q.q) || /\b(?:take the call|role[- ]play|show me how you would)\b/i.test(q.q)) return;
    const qw = qWords(q.q);
    const topicM = q.q.match(SKILL_Q);
    const topic = topicM ? qWords(topicM[1]) : null;
    if (topic && !topic.length) return;
    const minWords = SCENARIO_Q.test(q.q) ? 2 : 1;
    for (const x of bullets) {
      const f = score(q, qw, topic, x);
      if (f.words >= minWords && f.n >= 1.5) pairs.push({ q, qi, f });
    }
  });
  pairs.sort((a, b) => (b.f.n - a.f.n) || (Number(b.q.company) - Number(a.q.company)) || (a.qi - b.qi));
  const taken = new Set();
  const reused = new Set();
  for (const { q, f } of pairs) {
    if (answers.length >= cap1) break;
    if (usedQ.has(q.q) || taken.has(q.q)) continue;
    // a line already telling another question may serve a FIELD question again, once, when it fits well
    const again = used.has(f.x.id);
    if (again && (q.company || f.n < 2 || reused.has(f.x.id))) continue;
    const st = storyAnswer(f.x.text, f.x.job, { prompt: promptForQuestion(q.q) });
    // a line told a second time must say something different, or it is not told (case 01: "Design a system…" and
    // "Walk me through a system…" were word for word the same answer)
    if (!st || answers.some((a) => a.answer === st.answer)) continue;
    if (again) reused.add(f.x.id);
    used.add(f.x.id); usedQ.add(q.q); taken.add(q.q);
    answers.push({ q: q.q, why: q.why, ...st, resume_fact: f.x.text, ...(q.company ? { company: true, principle: q.principle } : {}) });
  }
  // 2. the résumé's best stories (outcomes and numbers first, recent first), with the bank's question
  for (const a of base.answers) {
    if (answers.length >= (guideQs.length ? 7 : 5)) break;
    let b = bullets.find((x) => x.text === a.resume_fact);
    // "your experience with forklift" is told by the line that drove one; the line that trained others on it
    // answers the training question (round 6, Ray)
    const topicM = a.q.match(SKILL_Q);
    if (b && topicM && TEACH_LINE.test(b.text) && !/\b(?:train|teach|coach|onboard|mentor|certif)/i.test(topicM[1])) {
      const tw = qWords(topicM[1]);
      const alt = tw.length ? bullets.find((x) => !used.has(x.id) && !TEACH_LINE.test(x.text) && tw.every((w) => qWords(x.text).includes(w))) : null;
      if (alt) b = alt; else continue; // the training line waits for the training question
    }
    if (!b || used.has(b.id)) continue;
    const s = storyAnswer(b.text, b.job);
    if (!s) continue;
    const q = usedQ.has(a.q) ? storyQuestion(b.text, usedQ, base.family, spokenEmployer(b.job.company)) : a.q;
    const s2 = promptForQuestion(q) ? storyAnswer(b.text, b.job, { prompt: promptForQuestion(q) }) : s;
    if (!s2 || answers.some((a) => a.answer === s2.answer)) continue;
    used.add(b.id); usedQ.add(q);
    answers.push({ q, why: 'A story from your résumé. Tell it in about a minute.', ...s2, resume_fact: b.text });
  }
  const answerQs = new Set(answers.map((a) => a.q));
  // the posting's own pay and hours shape the logistics answers (round 1: "give a range" when the posting
  // states $15/hr; "what hours" for a salaried role)
  // "$166,000 — $225,000 USD", "$18 to $21 an hour": the whole band, whatever dash the posting uses (round 4,
  // Dev: "The posting lists $166,000" for a $166,000 — $225,000 band)
  // the posting's pay, only from a sentence that states pay (D4) — never "$2" from "~$2B ARR", a $75 gym allowance, a
  // sign-on bonus or a shift differential
  const payText = postingPay(jobText);
  // office and professional work is salaried unless the posting says hourly (round 3: "what hours can you
  // work?" to a backend engineer)
  const SALARIED_FAMILIES = new Set(['software_engineering', 'data_analytics', 'marketing', 'finance_accounting', 'sales', 'education']);
  const salaried = /\b(?:per year|a year|\/\s*yr|annual|salary|base salary)\b/i.test(jobText) || /\bteacher\b/i.test(role) || (SALARIED_FAMILIES.has(family) && !/\b(?:per hour|an hour|\/\s*hr|hourly)\b/i.test(jobText));
  for (const q of base.questions) {
    if (/^What are your pay expectations/.test(q.q) && payText) q.why = isPayRange(payText) ? `The posting lists ${payText.trim()}. Say that range works for you, or where in it you fit and why — don't name a number below it.` : `The posting lists ${payText.trim()}. If that works for you, say so plainly; if you need more, say what and why.`;
    if (/^When could you start, and what hours/.test(q.q) && salaried) { q.q = 'When could you start?'; q.why = 'Have a real date: your notice period and the first day you could begin.'; }
  }
  // the question every interview asks: the step up, or the move (round 2: missing almost everywhere)
  const cur = ctx.sheet.jobs.find((j) => j.current) || ctx.sheet.jobs[0];
  const move = moveQuestion(cur, role, ctx.sheet.jobs, ctx.sheet.education || [], { family, company });
  // the step-up question gets an answer drafted from the person's own lead, scale and result lines (upgrade 2): every
  // word is theirs, and one blank for what they would take on first
  const stepUp = move && move.stepUp ? stepUpAnswer(ctx, role, move.q) : null;
  if (stepUp && !answers.some((a) => a.answer === stepUp.answer)) answers.push(stepUp);
  // a clinical or trade posting's named procedures and equipment become the scenario questions a panel asks (upgrade 5)
  const scenarios = jobText ? scenarioQuestions(ctx, family, bullets) : [];
  // THIS posting's duties as questions, and the honest version of the pack for a change of field or a failed gate
  const fm = jobText ? fieldMatch(ctx, family) : 'same';
  const gate = jobText ? failedGates(ctx.fit?.constraints || [])[0] || null : null;
  const duties = jobText ? postingDuties(jobText) : [];
  const duty = dutyQuestionsFor(ctx, duties, bullets, used, { max: fm === 'different' ? 4 : 5, stories: fm !== 'different', promptFor: promptForQuestion });
  for (const a of duty.answers) answers.push(a);
  const changer = fm === 'different' ? careerChangeQuestions(ctx, role, match, duties, bullets) : [];
  // a change of field: no field-bank story stands in for experience the résumé does not show — only the verdict's own
  // matches and the step-up are told; everything else is a frame
  if (fm === 'different') for (let i = answers.length - 1; i >= 0; i--) if (!/^Tell me about your experience with/.test(answers[i].q) && !answers[i].stepUp) answers.splice(i, 1);
  if (cur?.current) for (const q of base.questions) if (/^Why are you looking for a new job now/.test(q.q)) q.why = 'Keep it short and forward-looking: what this job offers that your current one does not. Never complain about your current employer.';
  // with a company's questions on the card, the generic "one thing you did well at <employer>" is noise even
  // when a line answers it (round 5, Maria: "…at Cox Communications" still sat on the Ross prep as a story)
  if (guideQs.length) for (let i = answers.length - 1; i >= 0; i--) if (/^Walk me through one thing you did well at/.test(answers[i].q)) answers.splice(i, 1);
  const open = base.questions.filter((q) => /^(?:Tell me about yourself|Why do you want to work at)/.test(q.q));
  const rest = base.questions.filter((q) => !open.includes(q) && !answerQs.has(q.q) && !base.answers.some((a) => a.q === q.q));
  const qkey = (t) => String(t).toLowerCase().replace(/[^a-z ]/g, '').split(' ').filter((w) => w.length > 3).sort().join(' ');
  // a phone screen is a recruiter call: pay, start date, why now and what you know come right after the openers
  const STAPLE = /^(?:What do you know about|What are your pay|When could you start|Why are you looking)/;
  const staples = stage === 'Phone Screen' ? rest.filter((q) => STAPLE.test(q.q)) : [];
  // the company's known questions come right after the openers and the move (round 3: "nothing about Amazon")
  const companyQs = guideQs.filter((q) => !answers.some((a) => a.q === q.q));
  // the openers, the recruiter staples and the move are never cut by the cap; the posting's and the field's
  // questions fill what is left (round 4, Ray: a rebuild dropped "Why are you looking for a new job now?")
  const KEEP = /^(?:Why are you looking|What are your pay|When could you start|What do you know about)/;
  const head = [...open, ...staples, ...(move && fm !== 'different' ? [move] : []), ...changer, ...scenarios];
  // the company's own questions come first, story or not — they ARE the interview (round 4, Ray: the
  // Leadership Principles); then the posting's and the field's questions a line answers
  const reqSource = (q) => { const m = String(q).match(/^Tell me about your experience with (.+)\.$/); const r = m && (ctx.requirements || []).find((x) => x.label.toLowerCase() === m[1].toLowerCase()); return r && r.posting ? r.posting : null; };
  const toldA = answers.map((a) => ({ q: a.q, why: a.why, ...(a.source || reqSource(a.q) ? { source: a.source || reqSource(a.q) } : {}), ...(a.company ? { company: true, principle: a.principle } : {}) }));
  // a lead or manager interviewing on an hourly track is asked the lead questions first — shrink, labour, the plan, a
  // crew member missing rate — before the associate questions a company's guide carries (D13: a Fry's Assistant Store
  // Manager got the Kroger clerk's "friendly service even though you were busy")
  const leadBank = guide && guide.audience === 'hourly' && guide.lead ? new Set(bankQuestions(family, { role: 'Lead' }).map((q) => q.q).filter((q) => !bankQuestions(family, { role: '' }).some((b) => b.q === q))) : new Set();
  const leadFirst = rest.filter((q) => leadBank.has(q.q));
  const told = leadBank.size
    ? [...toldA.filter((q) => leadBank.has(q.q)), ...leadFirst, ...toldA.filter((q) => q.company && !leadBank.has(q.q)), ...companyQs, ...duty.questions, ...toldA.filter((q) => !q.company && !leadBank.has(q.q))]
    : [...toldA.filter((q) => q.company), ...companyQs, ...duty.questions, ...toldA.filter((q) => !q.company)];
  const pinned = rest.filter((q) => KEEP.test(q.q) && !staples.includes(q));
  // with a company's questions on the card, the generic "one thing you did well at <employer>" is noise
  // (round 4, Maria: "Walk me through one thing you did well at Cox Communications" on a Ross prep)
  const others = rest.filter((q) => !staples.includes(q) && !pinned.includes(q) && !leadFirst.includes(q) && !(guideQs.length && /^Walk me through one thing you did well at/.test(q.q)));
  const cap = guideQs.length ? 20 : 15;
  // a recruiter staple the company's own question already asks is asked once, in the company's words (case 15: two pay
  // questions and two start-date questions on one card)
  const companyPurposes = new Set(guideQs.flatMap((q) => [...purposes(q.q)]));
  const askedByCompany = (q) => !q.company && purposes(q.q).size > 0 && [...purposes(q.q)].some((p) => companyPurposes.has(p));
  const questions = [...head, ...told, ...pinned, ...others]
    .filter((q) => !askedByCompany(q))
    .filter((q, i, all) => all.findIndex((x) => qkey(x.q) === qkey(q.q)) === i)
    .filter((q) => !/^Walk me through one thing you did well at/.test(q.q) || answers.some((a) => a.q === q.q))
    .slice(0, Math.max(cap, head.length + told.length + pinned.length));
  // at least half the questions past the openers come from THIS posting (a duty line, a requirement, a named procedure):
  // the field's bank questions are cut from the end until they do (the hidden set: a trainer's prep with no question about
  // training). A field question a résumé line answers is kept before one that only has a frame.
  {
    const OPENER = /^(?:Tell me about yourself|Why do you want to work at|What do you know about|What are your pay|When could you start|Why are you looking|What questions do you have|What level are you)/;
    const traced = (q) => !!q.source || q.scenario || /^Tell me about your experience with/.test(q.q);
    const counted = () => questions.filter((q) => !OPENER.test(q.q) && !isLogistics(q.q) && !q.exercise);
    const droppable = (q) => !OPENER.test(q.q) && !isLogistics(q.q) && !traced(q) && !q.company && !q.changer && !q.stepUp && q !== move && !leadBank.has(q.q);
    for (const pass of [0, 1]) {
      for (let i = questions.length - 1; i >= 0; i--) {
        const c = counted();
        if (c.filter(traced).length * 2 >= c.length) break;
        const q = questions[i];
        if (!droppable(q)) continue;
        const told = answers.some((a) => a.q === q.q);
        if (pass === 0 && told) continue;
        questions.splice(i, 1);
        if (told) for (let k = answers.length - 1; k >= 0; k--) if (answers[k].q === q.q) answers.splice(k, 1);
      }
    }
  }
  // Drafted answers for the recruiter questions, from résumé facts only, with one [blank] for what only the
  // person knows (round 3: every recruiter question had advice and no answer).
  const scripts = recruiterScripts({ ctx, company, role, stage, pay, payText, questions, family });
  for (const sc of scripts) {
    if (sc.addQuestion && !questions.some((q) => q.q === sc.q)) questions.splice(Math.min(questions.length, 6), 0, { q: sc.q, why: sc.why });
  }
  // the line a requirement's answer tells is the proof shown for it
  for (const m of match) { const a = answers.find((x) => x.q === `Tell me about your experience with ${lcFirst(m.label)}.` || x.q === `Tell me about your experience with ${m.label}.`); if (a && m.status === 'shown' && !(m.proof && TEACH_LINE.test(a.resume_fact || '') && !TEACH_LINE.test(m.proof))) m.proof = a.resume_fact; }
  let intro = base.intro ? spoken(base.intro.replace(/;\s+(\d)/g, ', with $1').replace(/;\s+/g, ', and ')).replace(`the ${role} role`, `the ${spokenRole(role)} role`) : base.intro;
  // (the posting's lead duty is named by the composer's intro link, not here)
  // the intro's "where I …" is the person's line that shows what THIS posting asks for most, when it is from the job
  // the intro names (the verdict's proof), not the same line on every prep
  const introJob = intro ? ctx.sheet.jobs.find((j) => j.company && new RegExp(`\\bat ${escapeRegExp(spokenEmployer(j.company))}, where I `).test(intro)) : null;
  const proofRow = introJob ? match.find((m) => m.source === 'verdict' && m.status === 'shown' && m.proof && introJob.bullets.some((b) => b.text === m.proof)) : null;
  if (intro && proofRow) {
    const owner = ctx.sheet.jobs.find((j) => j.bullets.some((b) => b.text === proofRow.proof));
    const fp = owner && firstPerson(proofRow.proof, { current: owner.current });
    const said = owner && new RegExp(`\\bat ${escapeRegExp(spokenEmployer(owner.company))}, where I `).test(intro);
    const clause = fp ? `${fp.first}${fp.rest.length ? `, and ${fp.rest.map((r) => (/^I /.test(r) ? r.slice(2) : r.charAt(0).toLowerCase() + r.slice(1))).join(', and ')}` : ''}`.replace(/[.\s]+$/, '') : '';
    if (fp && said) intro = intro.replace(new RegExp(`(\\bat ${escapeRegExp(spokenEmployer(owner.company))}, where )I [^.]*?\\.(?= |$)`), (m0, pre) => `${pre}${clause}.`);
  }
  // one sentence for the earlier job, joined to the one before it
  if (intro) intro = intro.replace(/\. Before that, I was /, ', and before that I was ');
  {
  }
  // (the intro's closing blank stays plain — a quoted duty fragment inside it read as a seam; the composer builds the link)
  // a certification the posting names goes into the intro, before the "why this role" sentence (round 5, Ray: the
  // OSHA forklift certification appeared nowhere in the prep)
  const postingLc = String(jobText || '').toLowerCase();
  // the certification's own name, not its issuer: "HubSpot Academy — Social Media Marketing Certification" is a
  // Social Media Marketing certification from HubSpot Academy (round 6, Tasha: "I'm certified: HubSpot Academy.")
  const certParts = (c) => clean(c, 120).split(/\s+[—–|-]\s+|\s*\(|\)\s*|,\s+/).map((x) => x.trim()).filter(Boolean);
  // a driver's licence is a screening item, never the credential an intro leads with ("I hold a Valid AZ driver's license
  // license" — case 14)
  const certPick = (ctx.sheet.certifications || []).filter((c) => !/\bdriver'?s?\b|\bdriving\b/i.test(c)).map((c) => {
    const parts = certParts(c);
    const named = parts.find((x) => /\b(?:certif|licen)/i.test(x)) || parts[0] || '';
    const issuer = parts.find((x) => x !== named && /\b(?:academy|institute|university|college|google|hubspot|microsoft|amazon|aws|cisco|comptia|osha|servsafe|red cross|aha|salesforce|meta|linkedin|coursera|udemy)\b/i.test(x)) || '';
    return { name: named, issuer, all: parts.join(' ') };
  }).map((c) => ({ ...c, n: c.all.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !/^(?:certif\w*|licen\w*|card|current|valid|certificate|training|academy)$/.test(w)).reduce((k, w) => k + Math.min(3, (postingLc.match(new RegExp(`\\b${escapeRegExp(w)}`, 'g')) || []).length), 0) }))
    // the one the posting names most, not the first listed
    .filter((c) => c.n > 0).sort((a, b) => b.n - a.n)[0];
  const certNamed = certPick ? certPick.name : '';
  const bare0 = certNamed.replace(/\s+(?:certif\w*|licen[cs]e)$/i, '').replace(/^(?:a|an|the|valid|current|active)\s+/i, '');
  // the whole name decides whether the intro already says it ("Social Media Marketing" is not "Social Media Intern")
  if (intro && certNamed && !new RegExp(escapeRegExp(bare0).replace(/\s+/g, '\\s+'), 'i').test(intro)) {
    const bare = bare0;
    const from = certPick.issuer && !new RegExp(escapeRegExp(certPick.issuer.split(/\s+/)[0]), 'i').test(bare) ? ` from ${certPick.issuer}` : '';
    // a journeyman card or a line under LICENSES is a licence ("I hold an Arizona Journeyman Electrician license")
    const isLicence = /\blicen/i.test(certNamed) || (!/\bcertif/i.test(certNamed) && (/\b(?:journeyman|master electrician|registered nurse|RN|LPN|LVN|CDL)\b/i.test(certNamed) || licensedSection(ctx.resumeText, certPick.all.split(' ')[0] ? (ctx.sheet.certifications || []).find((c) => c.includes(certNamed)) || certNamed : certNamed)));
    const certSentence = /\b(?:certif|licen)/i.test(certNamed) ? `I hold ${/^[aeiou]/i.test(bare) || /^OSHA/i.test(bare) ? 'an' : 'a'} ${bare} ${/\blicen/i.test(certNamed) ? 'license' : 'certification'}${from}.` : `I hold ${/^[aeiou]/i.test(bare) || /^[AEFHILMNORSX][A-Z]/.test(bare) ? 'an' : 'a'} ${bare} ${isLicence ? 'license' : 'certification'}${from}.`;
    intro = /\sI'm interested in\b/.test(intro) ? intro.replace(/\sI'm interested in\b/, ` ${certSentence} I'm interested in`) : `${intro} ${certSentence}`;
  }
  // every remaining question gets its shape: three blanks to finish on the card (round 3: "9 of 14
  // questions have no answer"); the intro answers "Tell me about yourself"
  const have = new Set([...answers.map((a) => a.q), ...scripts.map((x) => x.q)]);
  // a company question nobody's line answers still points at the line most likely to hold the story — a
  // suggestion under the frame, never stitched into it (round 5, Ray: "0 résumé words on all 7 Amazon questions")
  // a line hints at ONE question (round 6, Ray: the same team line under Ownership and Deliver Results); your own
  // availability is not a story a line holds (Maria: a line about scheduling others under "What is your availability")
  const hintUsed = new Set();
  const hintFor = (q) => {
    if (!q.company || MISTAKE_Q.test(q.q) || isLogistics(q.q) || /^Why\b/i.test(q.q) || /\b(?:take the call|role[- ]play)\b/i.test(q.q) || /\b(?:availability|available|what hours|which days|your schedule)\b/i.test(q.q)) return '';
    const qw = qWords(q.q);
    // a hint needs a shared word, or a principle cue on a line with an outcome and a number (round 7, Ray: a plain
    // cycle-count line under Ownership; Dev's ledger line that "cut reconciliation breaks 92%" under Users first is right)
    const best = bullets.filter((x) => !hintUsed.has(x.text)).map((x) => { const w = qMatch(qw, qWords(x.text), q.q); const pf = principleFits(q, x.text); return { x, w, pf, n: (pf ? 1 : 0) + w + (/\d/.test(x.text) ? 0.25 : 0) - ctx.sheet.jobs.findIndex((j) => j.id === x.job.id) * 0.1 }; }).filter((f) => (f.w >= 1 && f.n >= 1.25) || (f.pf && STORY_RE.test(f.x.text) && /\d/.test(f.x.text))).sort((p1, p2) => p2.n - p1.n)[0];
    if (best) hintUsed.add(best.x.text);
    return best ? best.x.text : '';
  };
  const frames = questions.filter((q) => !have.has(q.q) && !/^Tell me about yourself/.test(q.q))
    .map((q) => (typeof q.frame === 'string'
      // the closest line of theirs is a hint under the boxes, never stitched into the answer
      ? { q: q.q, answer: q.frame, resume_fact: '', frame: true, ...(q.scenario ? { scenario: true } : {}), ...(q.changer ? { changer: true } : {}), ...(q.source ? { source: q.source } : {}), ...(q.hint ? { hint: q.hint } : {}) }
      : q.exercise
      ? { q: q.q, answer: '', resume_fact: '', frame: true, exercise: true, practice: 'This one is done at a keyboard, not answered out loud. Practise it once end to end: say what you are doing as you go, write a test before you call it done, and ask one clarifying question first.', ...(q.company ? { company: true, principle: q.principle } : {}) }
      : { q: q.q, answer: frameFor(q.q), resume_fact: '', frame: true, ...(q.company ? { company: true, principle: q.principle, ...(hintFor(q) ? { hint: hintFor(q) } : {}) } : {}) }));
  // how this one usually runs: the company's own guide when Seen has it, else the field's; a phone screen
  // is a recruiter call in every company
  const format = guide && guide.format
    ? `${stage === 'Phone Screen' ? 'This is a phone screen, so expect a recruiter: your background in two minutes, why this job, pay, start date. ' : ''}${guide.format}`
    : interviewFormat(role, stage, family);
  // every story prompt and every frame names a detail of THIS posting (the hidden set: 69% of sentences recurred
  // across postings); a question that already names one keeps its own
  const reqLabels = match.filter((m) => m.source === 'verdict' && m.label.split(/\s+/).length <= 6).map((m) => m.label);
  const pick = detailPicker(duties, reqLabels);
  const shownLabels = match.filter((m) => m.source === 'verdict' && (m.status === 'shown' || m.status === 'stated')).map((m) => m.label).slice(0, 2);
  const topLead = duties.find((d) => d.verb) || null;
  const yrsDated = datedYears(ctx);
  const yrsSaid = yrsDated != null && yrsDated >= 1 ? `your ${Math.floor(yrsDated)} years of related experience` : '';
  const finalAnswers = [
    ...answers.map((a0) => { const a = { ...a0 }; delete a.why; return a; }).map((a) => (a.answer && a.resume_fact && !a.stepUp ? { ...a, answer: anchorBracket(a.answer, pick(`${a.q} ${a.resume_fact}`), 'past') } : a)),
    ...scripts.map(({ q, answer, resume_fact, reference }) => {
      let text = answer;
      if (/^Why do you want to work at/.test(q) && reqLabels.length) text = text.replace(/\[How that connects to what you did at ([^\]]+?) — one sentence\.\]/, (m0, at) => `[How that connects to “${pick(q)}” in this posting, and to what you did at ${at}.]`);
      if (shownLabels.length) text = text.replace(/ job: \[the part of the posting that matches you\]\./, ` job — this one asks for ${shownLabels.join(' and ')}, which is the work I've done most.`);
      if (reqLabels.length) text = text.replace(/\[what this job offers that your current one doesn't — never a complaint\]/, () => `[what this job offers that your current one doesn't — “${pick(q)}”, for example; never a complaint]`);
      if (purposes(q).has('pay') && (yrsSaid || shownLabels[0])) text = text.replace('[Where in it you fit and why, in one sentence.]', `[Where in it you fit and why — ${[yrsSaid, shownLabels[0] ? `the ${shownLabels[0]} this posting asks for` : ''].filter(Boolean).join(' and ')}.]`);
      return { q, answer: text, resume_fact, script: true, ...(reference ? { reference } : {}) };
    }),
    ...frames.map((f) => {
      const sched = (ctx.constraints || []).find((c) => c.kind === 'schedule' && c.label);
      if (purposes(f.q).has('start') && (sched || topLead)) return { ...f, answer: f.answer.replace('[The first day you could start, and the notice you owe where you work now.]', `[The first day you could start, and the notice you owe where you work now${sched ? ` — the posting asks for ${clean(sched.label, 60)}` : ''}.]`) };
      if (/^What do you know about/.test(f.q) && topLead) return { ...f, answer: f.answer.replace('[What they do and who they serve, in your own words.] [One recent thing you read about them — a launch, a store opening, a result.] [Why that matters for this job.]', `[What they do and who they serve, and where “${lcFirst(topLead.short)}” fits in it.] [One recent thing you read about them that touches “${lcFirst(topLead.short)}”.] [Why that makes you want to “${lcFirst(topLead.short)}” there.]`) };
      if (purposes(f.q).has('pay') && (yrsSaid || shownLabels[0])) return { ...f, answer: f.answer.replace('[Where in it you fit and why — your experience, this market.]', `[Where in it you fit and why — ${[yrsSaid, shownLabels[0] ? `the ${shownLabels[0]} this posting asks for` : ''].filter(Boolean).join(' and ')}.]`) };
      return f.exercise || f.source || f.scenario || f.changer || isLogistics(f.q) || /^What do you know about/.test(f.q) ? f : { ...f, answer: anchorBracket(f.answer, pick(f.q), /^\[Where you were/.test(f.answer) ? 'past' : 'here') };
    }),
  ];
  const topDuties = duties.filter((d) => d.verb).slice(0, 2);
  const tool = match.find((m) => m.source === 'verdict' && (m.kind === 'tool' || TOOL_RE.test(m.label)) && m.label.split(/\s+/).length <= 3);
  const askPosting = [
    ...(topDuties[0] ? [{ q: `What does good look like for “${topDuties[0].short}” in the first 90 days?` }] : []),
    ...(topDuties[1] ? [{ q: `How much of the week goes to “${topDuties[1].short}”, and who would I work with on it?` }] : []),
    ...(tool ? [{ q: `How does the team use ${tool.label} day to day?` }] : []),
  ];
  const named = reqLabels.slice(0, 3);
  const notice = fm === 'different'
    ? { field_match: fm, text: `This job is ${shortTitle(plainTitle(spokenRole(role)) || role)} work${duties.find((d) => d.verb) ? ` (“${duties.find((d) => d.verb).short}”)` : ''} and your résumé is ${ctx.sheet.jobs[0] ? `${shortTitle(ctx.sheet.jobs[0].title)} work` : 'in another field'}, so expect to be asked why the move and what carries over: this prep is built around those questions, and nothing in it claims experience your résumé does not show.` }
    : gate ? { field_match: fm, gate: gate.label, text: `${String(gate.message || `The posting requires ${gate.label}`).replace(/\s*—\s*say so if true\.?$/i, '').replace(/[.\s]+$/, '')}, so expect it to come up first — your honest answer is under “What this job asks for”.` }
    : null;
  const askList = [...askPosting, ...(guide ? guide.ask_them.map((q) => ({ q, company: true })) : []), ...askThem(role, family).slice(0, Math.max(0, 3 - askPosting.length - (guide ? guide.ask_them.length : 0)))]
    // two "first 90 days" questions are one question (round 4, Maria)
    .filter((q, i, all) => { const w = (t) => new Set(String(t.q).toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 3 && !/^(?:what|this|that|your|does|look|like|would|with|from|have|will|about|role|store|team)$/.test(x))); const mine = w(q); return !all.slice(0, i).some((o) => [...w(o)].filter((x) => mine.has(x)).length >= 3 || (/\b90 days\b/i.test(q.q) && /\b90 days\b/i.test(o.q))); })
    .slice(0, 6);
  // Every answer drafted out loud from the résumé (lib/server/prepCompose.js): 2–4 sentences, at most one blank, every
  // word from the résumé, the posting or a closed list of connectives. The register (format, ask-them) comes from the
  // POSTING's occupation, never the résumé's field.
  const fmObj = ctx.fit?.field_match || ctx.fit?.verdict?.field_match || null;
  const postingField = fmObj && typeof fmObj === 'object' ? fmObj.postingFieldKey || null : null;
  const sched = (ctx.constraints || []).find((c) => c.kind === 'schedule' && c.label);
  const composed = composePack({ questions, answers: finalAnswers, intro, ask_them: askList }, ctx, {
    role, company, family, jobText, duties, fieldMatch: fm, payText, years: yrsDated != null && yrsDated >= 1 ? Math.floor(yrsDated) : null,
    roleSaid: shortTitle(plainTitle(spokenRole(role)) || role), schedule: sched ? clean(sched.label, 80) : postingSchedule(jobText),
    postingFieldLabel: fmObj && typeof fmObj === 'object' ? fmObj.postingField || null : null,
    askFallback: askThem(role, family).slice(0, 1),
    postingField,
    confirmed,
  });
  const statementMatch = composed.statements.some((x) => x.reader) ? statementRows(ctx, composed.statements, match) : match.filter((m) => m.source !== 'verdict' || realStatement(m.label) || m.label.split(/\s+/).length === 1 || /^[A-Z]/.test(m.label));
  const register = registerFor(postingField, { stage, guide, duties });
  return {
    ...base,
    ...(notice ? { notice } : {}),
    field_match: fm,
    email_detail: topDuties[0] ? topDuties[0].short : named[0] || '',
    email_detail2: topDuties[1] ? topDuties[1].short : named[0] && topDuties[0] ? named[0] : '',
    role_said: shortTitle(plainTitle(spokenRole(role)) || role),
    email_focus: composed.email_focus.focus,
    email_focus2: composed.email_focus.focus2,
    resume_check: [...(base.resume_check || []), ...(yearsCheck(ctx) ? [yearsCheck(ctx)] : [])],
    intro: composed.intro,
    questions: composed.questions,
    answers: composed.answers,
    job_match: statementMatch,
    posting_pay: payText || null,
    // this posting's own questions first, then the company's, then the field's only to fill
    ask_them: composed.ask_them.slice(0, 6),
    // the posting's own occupation decides how the interview usually runs; then what THIS posting names
    format: [register || format, named.length ? `This posting names ${named.join(', ').replace(/, ([^,]+)$/, ' and $1')} — expect a question on each.` : ''].filter(Boolean).join(' '),
    engine: PREP_ENGINE,
    compose: COMPOSE_VERSION,
    // the person's answers this pack was built with: { applied, ignored } from the fit check, and the same hash the paid
    // cache uses (a stored pack is served only for the same answers)
    ...(ctx.fit && ctx.fit.confirmations ? { confirmations: ctx.fit.confirmations } : {}),
    answers_key: confirmationsKey(confirmed),
    guide: guide ? { company: guide.company, confidence: guide.confidence, framework: guide.framework, tips: guide.tips, watch: guide.watch } : null,
    model: false,
  };
}

// The posting's own schedule line ("Monday-Friday, 8am-5pm, on-site in Denver"), said as written, or ''.
function postingSchedule(jobText) {
  const row = sectionPosting(jobText).find((x) => x.kind === 'schedule' && x.sentence.split(/\s+/).length <= 14);
  return row ? clean(row.sentence, 90).replace(/^schedule:\s*/i, '').replace(/[.\s]+$/, '') : '';
}
// How interviews for the POSTING's occupation usually run, when it differs from the field the title's family names (a
// trainer posting gets a teach-back, never "a mock call"). null → the family's own format.
const REGISTER = {
  training: 'Trainer interviews often include a teach-back: a 10–15 minute sample session on a topic they give you or one you pick. Choose something from this posting, plan how you would open, check understanding and close, and time it once out loud.',
  education: 'Teaching interviews often include a demo lesson. Have a 10–15 minute lesson ready, with how you would check for understanding and adjust for students who need more help.',
  nursing: 'Nursing interviews are often panel interviews with behavioral and clinical scenarios. Answer with your assessment, your action, and who you call.',
  patient_care: 'Patient-care interviews usually mix behavioral questions with a few care scenarios. Answer with what you check, what you do, and who you tell.',
  food: 'Many kitchens ask for a working interview (a "stage"): a short shift on the line. Bring non-slip shoes, ask which station, and keep your station clean as you go.',
  software: 'Engineering interviews usually include a coding round and a system-design round. Practise explaining one system you built: the data flow, how it fails, and what you would change.',
  sales: 'Sales interviews often include a role-play call. Practise a 30-second opener, one discovery question, and asking for the next step.',
  support: 'Support interviews often include a mock call or a written reply to a customer. Practise calm, clear wording and a clean summary note.',
  hr: 'Recruiting and HR interviews often ask you to walk through a hire or a hard conversation from start to finish. Have one of each ready.',
  retail: 'Store interviews are often with the store manager, sometimes the district manager; expect scenario questions about customers, the floor and your availability.',
  warehouse: 'Expect questions on safety, rates and accuracy, and sometimes a walk of the floor. Know your numbers.',
  logistics: 'Driving interviews usually check your record, your routes and how you handle a stop that goes wrong; some include a short road test.',
  accounting: 'Expect technical questions on close, reconciliations and journal entries, sometimes an Excel exercise.',
  front_office: 'Expect questions on calendars, priorities and confidentiality, and sometimes a short skills test (Word, Excel, typing).',
  electrical: 'Expect technical questions on code, diagnosis and safety, and sometimes a hands-on check. Be ready to walk through a recent call from symptom to fix.',
  maintenance: 'Expect technical questions on diagnosis and safety, and sometimes a hands-on check. Be ready to walk through a recent repair from symptom to fix.',
  construction: 'Expect questions on safety, reading plans and the equipment you run; some crews ask for a short working trial.',
  manufacturing: 'Expect questions on safety, quality checks and the machines you run; some plants include a short skills test or a floor walk.',
  marketing: 'Bring two or three pieces of your work and the numbers behind them; you may be asked to critique one of their campaigns.',
  data: 'Analyst interviews often include a SQL screen or a take-home. Practise explaining a chart to someone non-technical.',
  it: 'Support interviews usually include troubleshooting scenarios: say what you check first, what you try next, and when you escalate.',
  clinical: 'Clinical interviews are often panel interviews with case scenarios. Answer with your assessment, your plan, and who you involve.',
  ops: 'Operations interviews usually ask how you run a site by the numbers: staffing, cost, quality and a problem you fixed. Bring your numbers.',
};
function registerFor(postingField, { stage }) {
  if (stage === 'Phone Screen' || !postingField) return null;
  return REGISTER[postingField] || null;
}
