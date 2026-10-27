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

import { buildContext } from '../resume/optimize/engine.js';
import { localDiagnosis } from '../resume/optimize/local.js';
import { requirementQuestion, SOFT_SKILL_RE, SCREENING_RE } from '../resume/optimize/engine.js';
import { checkBullet, verbBase } from '../resume/optimize/grammar.js';
import { pastTense, baseFromGerund } from '../resume/rewrite/inflect.js';
import { KNOWN_VERBS } from '../resume/health/verbs.js';
import { guardPack, prepFamily } from './interviewPrep.js';
import { guideFor } from './interviewGuides.js';
import { storyQuestion } from './interviewQuestionBank.js';

const clean = (s, n = 600) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const lcFirst = (s) => (s && !/^[A-Z]{2,}|^[A-Z][a-z]*[A-Z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const capFirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const article = (t) => { const w = String(t || '').trim().split(/\s+/)[0] || ''; return (/^[A-Z]{2,}/.test(w) ? /^[AEFHILMNORSX]/.test(w) : /^[aeiou]/i.test(w)) ? 'an' : 'a'; };
const shortTitle = (t) => String(t || '').replace(/\s*[,(–—].*$/, '').trim();

// Leads that are something done TO the person ("Named Employee of the Month") read "I was named …".
const PASSIVE_LEADS = new Set(['named', 'promoted', 'selected', 'recognized', 'recognised', 'nominated', 'elected', 'chosen', 'honored', 'honoured', 'appointed', 'voted', 'ranked', 'rated', 'commended', 'featured', 'invited', 'entrusted', 'tasked', 'assigned', 'trusted', 'awarded', 'certified', 'licensed', 'cross-trained']);

// Words that are passive only with what follows: "Promoted to Shift Lead" (done to the person) but
// "Promoted seasonal launches at the register" (something the person did) — round 3: "I was promoted
// seasonal launches".
const PASSIVE_IF_FOLLOWED = /^(?:to|as|for|in|into|by|among|from|with|twice|three|two|after|within|#?\d)\b/i;
const ALWAYS_PASSIVE = new Set(['named', 'nominated', 'elected', 'honored', 'honoured', 'appointed', 'voted', 'commended', 'entrusted', 'cross-trained']);
function passiveLead(head) {
  const [w0, w1 = ''] = String(head).split(/\s+/);
  const lw = String(w0).toLowerCase();
  if (!PASSIVE_LEADS.has(lw)) return false;
  return ALWAYS_PASSIVE.has(lw) || PASSIVE_IF_FOLLOWED.test(w1) || /^(?:top|employee|associate|partner|crew|team|student|nurse|rep|agent|teacher|cashier|member|one)\b/i.test(w1) && /^(?:awarded|selected|recognized|recognised|ranked|rated|chosen|featured)$/.test(lw);
}

/** Numbers and shorthand the way people say them: "5–6" → "5 to 6", "900+" → "more than 900", "$4.2M" → "$4.2 million". */
export function spoken(text) {
  return String(text || '')
    .replace(/(\d)\s*[–—]\s*(\d)/g, '$1 to $2')
    .replace(/(?<![\w.])(\d[\d,.]*)\+(?=\s|$)/g, 'more than $1')
    .replace(/\$(\d+(?:\.\d+)?)M\b/g, '$$$1 million')
    .replace(/\s&\s/g, ' and ')
    .replace(/\b([a-z]+)\/([a-z]+)\b/g, (m, a, b) => (verbBase(a) && verbBase(b) ? `${a} and ${b}` : m));
}

/**
 * One résumé line in first person: "I cut shrink …" / "I was named …" / for a current job's ongoing duty
 * "I lead a team of 18 …". Returns { first, rest } — the line's main clause and any sentences after a
 * ";" — or null when the line does not start with something the person did.
 */
export function firstPerson(text, { current = false } = {}) {
  let t = clean(text).replace(/^[\s•●▪◦*·\-–—]+/, '').replace(/[.;\s]+$/, '');
  if (!t) return null;
  // an earlier job's present-tense line is told in the past ("Build schedules" → "I built schedules")
  if (!current) t = checkBullet(t, { current: false }).text.replace(/[.;\s]+$/, '');
  const [head, ...tail] = t.split(/;\s+/);
  const w0 = head.split(/\s+/)[0];
  const lw = w0.toLowerCase();
  let first;
  if (passiveLead(head)) first = `I was ${head.charAt(0).toLowerCase()}${head.slice(1)}`;
  else if (verbBase(w0)) first = `I ${head.charAt(0).toLowerCase()}${head.slice(1)}`;
  else return null;
  // "Serve as charge nurse 2 shifts a week: make assignments, …" → "…, where I make assignments, …"
  first = first.replace(/:\s+(?=[a-z]+\b)/, (m, i) => { const next = first.slice(i + m.length).split(/\s+/)[0]; return verbBase(next) ? ', where I ' : m; });
  const rest = tail.map((p) => {
    const w = p.split(/\s+/)[0];
    if (verbBase(w) && !/^\d/.test(w)) return `I ${p.charAt(0).toLowerCase()}${p.slice(1)}`;
    if (/^\d/.test(p) && /\d/.test(head) && /\b(?:were|are|was|is|still|stayed)\b/.test(p)) return `Of those, ${p}`;
    return capFirst(p);
  });
  return { first: spoken(first), rest: rest.map(spoken) };
}

// "Cut shrink from 2.4% to 1.1% in 12 months by tightening …"
const FROM_TO_RE = /^(cut|reduced|lowered|dropped|brought down|raised|grew|increased|improved|boosted|lifted|moved|took)\s+(.+?)\s+from\s+(\$?[\d.,]+(?:%|[KkMm]\b)?(?:\s+(?:minutes|days|hours|seconds|weeks|percent|points))?)\s+to\s+(\$?[\d.,]+(?:%|[KkMm]\b)?(?:\s+(?:minutes|days|hours|seconds|weeks|percent|points))?)(.*)$/i;
const DOWN_RE = /^(?:cut|reduced|lowered|dropped|brought)/i;

// What to add that the line cannot say, by what the line is about.
const DETAIL = [
  [/\b(?:train\w*|coach\w*|mentor\w*|precept\w*|onboard\w*|taught|teach\w*)\b/i, '[How you trained them: what the first weeks looked like, and how you knew they were ready.]'],
  [/^(?:lead|led|supervis\w*|manag\w*|run|ran|oversee|oversaw|direct\w*)\b[^.]*\b(?:crew|team|staff|associates|people|shift|department|employees|reps)\b/i, '[One week that tested the team: what happened, and what you did.]'],
  [/\b(?:customers?|guests?|patients?|callers?|clients?|residents?|students?|families)\b/i, '[One person you remember: what they needed, and what you did.]'],
  [/^(?:built|build|creat\w*|design\w*|wrote|write|automat\w*|launched|launch|set up|develop\w*|start\w*)\b(?!\s+(?:\w+\s+)?(?:schedules?|rosters?|reports?|flyers?|graphics|captions|displays?|pallets?)\b)/i, '[Why it was needed, and the hardest part of building it.]'],
  [/\b(?:found|caught|noticed|spotted|identified|discovered)\b/i, '[How you spotted it, and what would have happened if no one had.]'],
  [/\b(?:sold|sell|opened|booked|closed|quota|meetings)\b/i, '[What you did differently from others to get there.]'],
];
const detailFor = (text, needSituation = false) => {
  const d = (DETAIL.find(([re]) => re.test(text)) || [null, '[What made it hard, and one thing you did that someone else might not have.]'])[1];
  return needSituation && !/\bwhy it was needed\b/i.test(d) ? d.replace(/^\[/, '[What was going on, ').replace(/^\[What was going on, ([A-Z])/, (m, c) => `[What was going on, ${c.toLowerCase()}`) : d;
};
// A line that is a duty told as a typical day ("Care for 5–6 patients a shift") needs no "situation".
// the field itself ("warehouse", "logistics", "retail") is where the person works, not a thing to tell a story about
const FIELD_LABEL = /^(?:warehouse|logistics|retail|hospitality|customer service|sales|marketing|accounting|software|engineering|nursing|healthcare|education|operations|distribution)$/i;
const STORY_RE = /\b(?:cut|reduc\w*|rais\w*|grew|increas\w*|improv\w*|saved|built|launched|trained|precepted|led|won|named|started|administered|managed)\b/i;
const ONGOING_RE = /^(?:care|handle|answer|serve|run|work|process|support|assist|help|operate|prepare|maintain|teach|manage|lead|keep|own|book|build|write|ring|restock|cook|prep|load|pick|drive|deliver|greet|check|schedule|document)\b/i;

/**
 * A spoken answer built on one résumé line. `job` is the line's job from the fact sheet.
 * Returns { situation, action, result, answer } with at most two [brackets].
 */
export function storyAnswer(text, job, { prompt = '' } = {}) {
  const current = !!job?.current;
  const title = shortTitle(job?.title);
  const company = String(job?.company || '').replace(/\s*\([^)]*\)/g, '').replace(/\.+$/, '').trim();
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
    const example = prompt || (hasResult || restText ? detailFor(line) : '[One time it mattered: what happened, what you did, and how it ended.]');
    return { situation: '', action: `${action} ${example}`, result, answer: [action, example, result].filter(Boolean).join(' ') };
  }
  // one prompt, not two (round 3: three of five answers were mostly brackets); the prompt asks for the
  // situation too when the line gives none
  const detail = prompt || detailFor(line, !restText);
  return { situation: '', action: `${action} ${detail}`, result, answer: [action, detail, result].filter(Boolean).join(' ') };
}

// ── What the posting asks for, and your answer ──────────────────────────────────────────────────
const haveVerb = (label) => {
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
const postingCase = (label, posting) => { const m = String(posting || '').match(new RegExp(String(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')); return m ? m[0] : label; };

/** Each requirement and main duty: what shows it, or the honest answer to give when it is missing. */
export function jobMatch(ctx, diagnosis) {
  const bulletsAll = ctx.sheet.jobs.flatMap((j) => j.bullets.map((b) => ({ ...b, job: j })));
  const fam = prepFamily(ctx.jobTitle);
  const inFieldJob = (j) => prepFamily(j.title) === fam || j.id === ctx.sheet.jobs[0]?.id;
  const rank = (r) => (r.importance === 'required' ? 0 : 1);
  const out = [];
  for (const r of [...(diagnosis.requirements || [])].sort((a, b) => rank(a) - rank(b))) {
    const label = postingCase(clean(r.label, 120), ctx.jobDescription);
    if (!label || /\b\d+\s*\+?\s*(?:years?|yrs?)\b/i.test(label)) continue;
    // a trait or a schedule is shown by how you answer, never denied with "I haven't worked with
    // attention to detail" (round 1: the template put false lines in the candidate's mouth)
    if (SOFT_SKILL_RE.test(label) || SCREENING_RE.test(label)) continue;
    const lang = /\b(?:bilingual|fluent|spanish|french|mandarin|vietnamese|tagalog|arabic|portuguese|korean)\b/i.test(label);
    if (lang) { const c = ctx.constraints.find((x) => x.kind === 'language'); if (c && !out.some((x) => x.lang)) out.push({ label, lang: true, status: c.status === 'met' ? 'shown' : 'stated', say: c.status === 'met' ? 'On your résumé. Expect them to switch languages for a minute — be ready.' : c.message }); continue; }
    // the line that shows it best: cited evidence or a line naming it, recent jobs and doing-lines first
    // (round 1: "HVAC" was proved by a warehouse parts-picking line)
    const words = String(r.label).toLowerCase().split(/[^a-z0-9&+#]+/).filter((w) => w.length > 2 && !/^(?:and|the|for|with|experience|skills?|strong|proven|knowledge)$/.test(w)).map((w) => w.replace(/(?:ing|ion|ions|ed|es|s)$/, '') || w);
    // the word with an ordinary ending ("train" → trained/training, "refrigerat" → refrigerant), never a
    // short word inside a longer one ("sales" is not "Salesforce")
    const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wordRe = (w) => (w.length <= 5 ? new RegExp(`\\b${esc(w)}[a-z]{0,3}\\b`, 'i') : new RegExp(`\\b${esc(w.slice(0, Math.max(5, w.length - 3)))}[a-z]{0,6}\\b`, 'i'));
    // a line counts only when it names the thing as a word ("sales" is not inside "Salesforce")
    // the reader's cited line stands unless the word only appears inside a longer word
    const inside = (x) => words.some((w) => w.length <= 5 && new RegExp(`\\b${esc(w)}[a-z]{4,}`, 'i').test(x.text) && !wordRe(w).test(x.text));
    // a line proves a label only through its specific word ("shipment"), never a generic one alone
    // ("process" — round 3: register transactions "proved" shipment processing)
    const GENERIC_W = /^(?:process|manag|handl|servic|support|operat|skill|abilit|work|team|general|basic|daily|perform|maintain|ensur|assist|duti)/;
    const specific = words.filter((w) => w.length >= 4 && !GENERIC_W.test(w));
    const keyWords = specific.length ? specific : words.filter((w) => w.length >= 4).length ? words.filter((w) => w.length >= 4) : words;
    const cands = bulletsAll.filter((x) => ((r.evidence || []).includes(x.id) && !inside(x) && (!specific.length || specific.some((w) => wordRe(w).test(x.text)) || (Object.entries(SAME_THING).find(([k]) => new RegExp(`\\b${k}`, 'i').test(r.label)) || [null, []])[1].some((a) => new RegExp(`\\b${a}`, 'i').test(x.text)))) || keyWords.some((w) => wordRe(w).test(x.text)));
    const rankLine = (x) => words.filter((w) => wordRe(w).test(x.text)).length * 2 + (/\d/.test(x.text) ? 1 : 0) + (STORY_RE.test(x.text) ? 1 : 0) - ctx.sheet.jobs.findIndex((j) => j.id === x.job.id) * 2 - (inFieldJob(x.job) ? 0 : 4);
    // nothing names it word for word: a line that says it the résumé's way ("balanced the drawer" for cash
    // handling, "62 WPM" for typing, Salesforce for CRM — round 2: strong evidence read as "not shown")
    // a cited line that names none of it (a warehouse parts line for "electrical troubleshooting") is weaker
    // than a line that says it the résumé's way
    const namesIt = (x) => words.some((w) => w.length >= 4 && wordRe(w).test(x.text));
    if (!cands.some(namesIt)) {
      const alias = Object.entries(SAME_THING).find(([k]) => new RegExp(`\\b${k}`, 'i').test(r.label));
      const alts = alias ? alias[1] : words.filter((w) => w.length >= 5 && !GENERIC_W.test(w) && !/^(?:experi|knowle|skills|abilit|strong|excell|proven|manage|suppor|servic|work)/.test(w));
      const viaAlias = bulletsAll.filter((x) => alts.some((w) => new RegExp(`\\b${w}`, 'i').test(x.text)) && !inside(x));
      if (viaAlias.length) cands.splice(0, cands.length, ...viaAlias);
    }
    const best = cands.sort((x, y) => rankLine(y) - rankLine(x))[0];
    const titled = words.length && ctx.sheet.jobs.some((j) => inFieldJob(j) && words.every((w) => wordRe(w).test(String(j.title))));
    if (best && !inFieldJob(best.job) && titled) { out.push({ label, status: 'shown', say: 'Your job title shows it. Have one example from that job ready.' }); continue; }
    const ev = best?.text;
    if (r.credential === 'expired') out.push({ label, status: 'expired', say: `It has lapsed, and they will ask. Say when it will be current: “My ${label.replace(/\s+(?:required|within).*$/i, '')} lapsed; I'll have it renewed by [date].”` });
    else if (r.credential === 'in progress') out.push({ label, status: 'in progress', say: 'Say exactly where you are: what you have completed, and when you will finish.' });
    else if (r.credential === 'not held') out.push({ label, status: 'gap', say: `Not on your résumé. If they ask: “I don't hold it yet. [When you could get it, or the closest credential you have.]”` });
    else if (/\b(?:degree|diploma|GED|bachelor|master|associate|BSN|BA|BS|MBA)\b/i.test(label) && (r.credential === 'held' || r.strength !== 'none')) out.push({ label, status: 'shown', say: 'In your education section.' });
    else if (ev) out.push({ label, status: 'shown', proof: ev, say: 'Your proof is this line — have the story behind it ready.' });
    else if (r.credential === 'held') {
      const certLine = ctx.sheet.certifications.join(' · ');
      const exp = new RegExp(`${String(label).split(/\s+/)[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^·•\n]{0,60}\\bexp`, 'i').test(certLine);
      out.push({ label, status: 'shown', say: exp ? 'On your résumé. Have the number and its expiry date ready.' : 'On your résumé. Have the card or number with you.' });
    }
    else if (r.strength === 'implied' || titled) out.push({ label, status: 'shown', say: 'Your job titles show it. Have one example ready from that work.' });
    // "listed on your résumé" only when the résumé says it (round 3: "merchandising" was "listed" on a résumé
    // that never says it)
    else if ((r.strength === 'stated' || r.strength === 'weak') && listedWhole(keyWords, ctx.resumeText, wordRe)) out.push({ label, status: 'stated', say: 'Listed on your résumé (skills or summary). Have one example ready: when you used it, and what came of it.' });
    // fundamentals every engineer is tested on are shown in the interview, never denied (round 3: "I haven't
    // worked with algorithms yet" scripted for an engineer with 8 years)
    else if (/^(?:software_engineering|data_analytics)$/.test(fam) && /\b(?:algorithms?|data structures?|computer science|cs fundamentals|problem[- ]solving|coding)\b/i.test(label)) out.push({ label, status: 'stated', say: 'Expected of every engineer and tested in the coding round, not on a résumé. Practise two problems out loud before the call.' });
    else {
      // the closest thing the résumé names in the same family (Kronos for Workday, package units for RTUs)
      const fam = TOOL_FAMILY.find((f) => f.some((w) => new RegExp(`\\b${w}`, 'i').test(r.label)));
      const near = fam && fam.find((w) => !new RegExp(`\\b${w}`, 'i').test(r.label) && new RegExp(`\\b${w}`, 'i').test(ctx.resumeText));
      const close = near ? (ctx.resumeText.match(new RegExp(`\\b${near}[\\w-]*`, 'i')) || [near])[0] : '';
      out.push({ label, status: 'gap', say: `Not on your résumé. If they ask, don't stretch it: “I haven't ${haveVerb(label)} yet. The closest I've done is ${close ? close.trim() : '[your closest experience]'}, and I'd get up to speed by [one concrete step].”` });
    }
  }
  // the posting's main duties the résumé does not show (the optimizer asks about the same ones)
  for (const q of diagnosis.questions || []) {
    const m = String(q.ask || '').match(/^Have you done this: “(.+)”\?$/);
    if (!m) continue;
    // a duty a line already does, said its own way ("balance your till" ↔ "Balanced my drawer"), is shown
    const dw = new Set(stemsOf(m[1]));
    let aliased = false;
    for (const [k, alts] of Object.entries(SAME_THING)) if (new RegExp(`\\b${k}`, 'i').test(m[1])) { aliased = true; for (const a of alts) dw.add(stem5(a)); }
    const hit = bulletsAll.map((x) => ({ x, n: stemsOf(x.text).filter((w) => dw.has(w)).length })).sort((p1, p2) => p2.n - p1.n)[0];
    if (hit && hit.n >= (aliased ? 2 : 3)) out.push({ label: m[1], status: 'shown', duty: true, proof: hit.x.text, say: '' });
    else out.push({ label: m[1], status: 'gap', duty: true, say: 'A main duty of this job that your résumé does not show. If you have done it, have the example ready; if not, say what is closest and how you would learn it.' });
  }
  // one entry per proof line ("hiring and team development" and "Proven record hiring…" are one thing)
  // one entry per proof line, and a duty that names a gap already listed is not listed twice
  const words = (t) => new Set(String(t).toLowerCase().split(/[^a-z0-9&+#]+/).filter((w) => w.length > 3));
  return out.filter((x, i) => !x.proof || out.findIndex((y) => y.proof === x.proof) === i)
    .filter((x, i, all) => !x.duty || !all.slice(0, i).some((y) => y.status === 'gap' && [...words(y.label)].every((w) => words(x.label).has(w))))
    .slice(0, 10);
}

// "Google Slides" is listed only when slides is, not because Google Analytics is (round 4, Tasha); the brand
// word alone never proves the tool, and every other word of the phrase has to be there
const BRAND_W = /^(?:google|microsoft|adobe|apple|amazon|meta|ibm|oracle|sap|aws|ms)$/;
function listedWhole(keyWords, resumeText, wordRe) {
  const words = keyWords.filter((w) => !BRAND_W.test(w));
  const need = words.length ? words : keyWords;
  return need.length > 0 && need.every((w) => wordRe(w).test(resumeText));
}
const stem5 = (w) => w.replace(/(?:ing|ed|es|e|s)$/, '').slice(0, 5);
const stemsOf = (t) => [...new Set(String(t).toLowerCase().split(/[^a-z0-9&+#]+/).filter((w) => w.length > 3 && !/^(?:with|from|that|this|your|their|each|every|they|them|then|than|into|over|about|team|work)$/.test(w)).map(stem5))];
// A requirement said the résumé's way.
const SAME_THING = {
  'cash handling': ['cash', 'drawer', 'till', 'register'], 'cash': ['cash', 'drawer', 'till'], 'typing': ['wpm', 'typing'], 'customer service': ['customer', 'guest', 'caller'],
  'social media': ['instagram', 'tiktok', 'facebook', 'reels', 'social'], 'crm': ['salesforce', 'hubspot', 'crm'], 'variance': ['flux', 'variance'],
  'microsoft office': ['excel', 'word', 'outlook', 'powerpoint'], 'point of sale': ['register', 'pos', 'ring up', 'transactions'], 'scheduling': ['schedul', 'kronos', 'labor', 'calendar', 'hootsuite', 'buffer', 'sprout', 'later'],
  'data or reporting': ['dashboard', 'report', 'sql', 'tableau'], 'inside sales': ['inside sales', 'inbound', 'calls'], 'knife': ['portion', 'prep', 'knife'], 'cooking': ['saut', 'grill', 'line cook', 'cook'],
  'warehouse management system': ['wms', 'manhattan', 'blue yonder', 'sap ewm', 'highjump', 'korber'], 'wms': ['wms', 'manhattan'], 'spreadsheet': ['excel', 'google sheets', 'spreadsheet'],
  'computer skills': ['excel', 'word', 'outlook', 'wms', 'rf scan', 'email', 'computer', 'microsoft'], 'powered industrial truck': ['forklift', 'reach truck', 'order picker', 'pit', 'pallet jack'], 'pit': ['forklift', 'reach truck', 'order picker'], 'forklift': ['forklift', 'reach truck', 'order picker', 'pit'],
  'loss prevention': ['shrink', 'loss prevention', 'asset protection', 'theft', 'lp '], 'shrink': ['shrink', 'loss prevention'],
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
const SENIOR_WORDS = /\b(?:manager|director|lead|supervisor|senior|sr|head|principal|chief|charge)\b/i;
const GENERIC_TITLE = /^(?:and|the|of|for|ii|iii|iv|i|grade|unit|team|role|position|associate|assistant|specialist|representative|coordinator|technician|officer)$/i;
export function moveQuestion(cur, role, jobs = [], education = []) {
  if (!cur?.title || !role) return null;
  // "Backend Engineer, Core Technology": what follows a comma names the team, not a new field (round 3:
  // "Why core and technology now?" to a backend engineer)
  const target = String(role).replace(/\s+/g, ' ').trim().replace(/,\s.*$/, '');
  // a degree in the field counts as having it ("Why marketing now?" to a marketing graduate)
  const held = [...jobs.map((j) => String(j.title).toLowerCase()), ...education.map((e) => String(e).toLowerCase())].join(' | ');
  const stepWord = (target.match(SENIOR_WORDS) || [])[0];
  if (stepWord && !new RegExp(`\\b${stepWord}\\b`, 'i').test(held.replace(/\b(?:assistant|associate|deputy|junior|jr)\b[^|]*/gi, ''))) {
    return { q: `What makes you ready to step up from ${shortTitle(cur.title)} to ${shortTitle(target)}?`, why: 'The posting is a step up from your title, and they will test it. Lead with the times you have already done the bigger job, then what you would do in your first months.' };
  }
  // schedule and format words are not a move ("2nd shift", "part-time", "remote", "platform")
  const NOT_A_MOVE = /^(?:shift|\d+(?:st|nd|rd|th)?|part-time|full-time|remote|hybrid|on-site|onsite|front|end|platform|backend|frontend|operations|support|services?|team|level|days?|evenings?|weekends?)$/i;
  const raw = target.replace(/[()–—,&/]/g, ' ').split(/\s+/);
  const words = raw.map((w, i) => (/^\d+(?:st|nd|rd|th)$/i.test(w) && /^grade$/i.test(raw[i + 1] || '') ? `${w} grade` : w))
    .filter((w) => w.length > 2 && !GENERIC_TITLE.test(w) && (!NOT_A_MOVE.test(w) || /grade$/.test(w) || /^nights?$/i.test(w)) && !new RegExp(`\\b${w.split(' ')[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(held));
  if (!words.length || words.length > 3) return null;
  const said = words.map((w) => (/^[A-Z]{2,}$|^\d/.test(w) ? w : w.toLowerCase()));
  const phrase = said.length === 1 && /^(?:executive|commercial|senior|clinical|enterprise|industrial)$/.test(said[0]) ? `${said[0]} work` : said.join(' and ');
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
export function interviewFormat(role, stage = '') { return stage === 'Phone Screen' ? PHONE_FORMAT : FORMAT[prepFamily(role)] || ''; }

export function askThem(role) {
  const fam = prepFamily(role);
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
function recruiterScripts({ ctx, company, role, stage, pay, payText, questions }) {
  const out = [];
  const jobs = ctx.sheet.jobs;
  const hist = ctx.sheet.history || [];
  const co = (c) => String(c || '').replace(/\s*\([^)]*\)/g, '').replace(/\.+$/, '').trim();
  const fam = prepFamily(role);
  const inField = hist.filter((h) => prepFamily(h.title) === fam && fam !== 'general');
  // the latest job leads unless it is in another known field (a barista job beside a marketing internship)
  const f0 = hist[0] ? prepFamily(hist[0].title) : 'general';
  const top = inField[0] && f0 !== fam && f0 !== 'general' ? inField[0] : hist[0];
  const tell = (t) => (/\b(?:cut|reduc\w*|rais\w*|grew|increas\w*|improv\w*|saved|won|resolved|launched|built)\b/i.test(t) ? 2 : 0) + (/\d/.test(t) ? 1 : 0) + (/\bfrom\s+\$?[\d.,]+%?\s+to\s/i.test(t) ? 1 : 0);
  const best = top && [...(top.bullets || [])].sort((a, b) => tell(b) - tell(a))[0];
  const bestFp = best ? firstPerson(best, { current: !!jobs.find((j) => j.title === top.title)?.current }) : null;
  const has = (re) => questions.some((q) => re.test(q.q));
  // why this company: a line that already names it is the best opening there is
  const named = String(company || '').length >= 3 && hist.flatMap((h) => (h.bullets || []).map((b) => ({ b, h }))).find(({ b, h }) => new RegExp(`\\b${String(company).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(b) && !String(h.company || '').toLowerCase().includes(String(company).toLowerCase()));
  if (has(/^Why do you want to work at/)) {
    if (named) {
      const fp = firstPerson(named.b, { current: false });
      if (fp) out.push({ q: `Why do you want to work at ${company}?`, answer: `I've already worked with ${company} from the other side: at ${co(named.h.company)}, ${fp.first}. [What you want to build or learn at ${company} that you couldn't there.]`, resume_fact: named.b });
    } else if (top) out.push({ q: `Why do you want to work at ${company}?`, answer: `[One specific thing about ${company} you have seen yourself: a product, a store, a campaign, a team.] [How that connects to what you did at ${co(top.company)} — one sentence.]`, resume_fact: '' });
  }
  // why now: the latest job, as it stands on the résumé
  const latest = hist[0];
  const cur = jobs.find((j) => j.current);
  if (latest && has(/^Why are you looking/)) {
    const said = (ctx.sheet.education || [])[0] && !cur && latest.endYm && /\b(?:intern|ambassador|assistant|barista|student)\b/i.test(latest.title || '') ? null : latest;
    if (cur) out.push({ q: 'Why are you looking for a new job now?', answer: `I've been at ${co(cur.company)}${hist.find((h) => h.title === cur.title)?.startYm ? ` since ${monthYear(hist.find((h) => h.title === cur.title).startYm).split(' ')[1]}` : ''}, and I'm ready for ${article(shortTitle(role))} ${shortTitle(role)} role. [What this job offers that your current one doesn't, in one sentence. Never a complaint.]`, resume_fact: '' });
    else if (said && said.endYm) out.push({ q: 'Why are you looking for a new job now?', answer: `My role at ${co(said.company)} ended in ${said.approx ? String(Math.floor(said.endYm / 12)) : monthYear(said.endYm)}. [One plain sentence on why: a layoff, a contract ending, a move.] I'm looking for ${article(shortTitle(role))} ${shortTitle(role)} role, and this one fits what I've done most: [the part of the posting that matches you].`, resume_fact: '' });
  }
  // pay: the posting's own figure is the one thing said out loud. Seen's range from OTHER listings (other
  // employers, or the company's other roles) is coaching beside the blank, never the person's words — round 4,
  // Maria: "$40k–$45k a year" drafted into her mouth from storage-unit and check-cashing ASM listings anchored
  // her low; Tasha found the same number useful as a reference. Both are served by a reference, not a script.
  const range = payText ? payText.trim() : pay ? (pay.unit === 'hour' ? `$${pay.low}–$${pay.high} an hour` : `$${Math.round(pay.low / 1000)}k–$${Math.round(pay.high / 1000)}k a year`) : '';
  if (range && has(/^What are your pay expectations/)) {
    if (payText) out.push({ q: 'What are your pay expectations?', answer: `The posting lists ${range}, and that range works for me. [Where in it you fit and why, in one sentence.]`, resume_fact: '' });
    else out.push({ q: 'What are your pay expectations?', answer: `[The range you would accept, said as a range — never one number.] [Where in it you fit and why: your years, this market, the schedule.]`, resume_fact: '', reference: `${pay.scope === 'market' ? `${shortTitle(role)} listings at other employers` : `${company}'s other listings`} on Seen pay about ${range}. A floor to check your range against — not your ask.` });
  }
  // a professional phone screen asks your level and years: the résumé's own years, else the dated in-field jobs
  if (stage === 'Phone Screen' && PROFESSIONAL.test(fam) && top) {
    const stated = (ctx.sheet.statedYears || []).map((x) => (String(x).match(/(\d+)\+?\s*years?/i) || [])[1]).find(Boolean);
    const months = inField.reduce((n, h) => n + (h.months || 0), 0);
    const yrs = stated ? `${stated} years` : months >= 12 ? `${Math.floor(months / 12)} years` : '';
    if (yrs) out.push({ q: 'What level are you at now, and how many years have you worked in this field?', why: 'Recruiters write this down first to place you at a level. Say your title and your years plainly; never a lower level than you hold.', addQuestion: true, answer: `I have ${yrs} as ${/^[aeiou]/i.test(shortTitle(top.title)) ? 'an' : 'a'} ${shortTitle(top.title).replace(/^Senior\s+/i, '').toLowerCase()}, most recently as ${shortTitle(top.title)} at ${co(top.company)}. [The level you were at, if your company used levels.]`, resume_fact: '' });
  }
  return out;
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
const FRAME_BY_QUESTION = [
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
  [/^(?:A |An |The |Your |Sales |Traffic |Two |Three |It's |It is |You (?:notice|see|find|are|have|walk))/i, '[What you would do in the first few minutes, and why.] [What you would do next, and who you would bring in.] [How you would know it worked by the end of the shift.]'],
];
const STAR_FRAME = '[Where you were and what was going on, in one sentence.] [What you did, step by step.] [How it ended — with a number if you have one.]';
export function frameFor(q) {
  const hit = FRAME_BY_QUESTION.find(([re]) => re.test(String(q || '')));
  return hit ? hit[1] : STAR_FRAME;
}

// ── The pack ────────────────────────────────────────────────────────────────────────────────────
/**
 * The whole paid pack with no model: guardPack's questions, staples, intro and résumé check (unchanged),
 * spoken answers built on the right résumé lines (the posting's evidence first), what the job asks for
 * and your answer to each, and questions to ask them.
 */
export function localPack({ company, role, resumeText, jobText = '', pay = null, stage = '', nowMs = Date.now() }) {
  const base = guardPack({}, { company, role, resumeText, pay, stage, nowMs });
  // what Seen knows about how THIS company interviews (lib/server/interviewGuides.js), or null
  const guide = guideFor(company, role);
  const guideQs = guide ? guide.questions.map((q) => ({ q: q.q, why: q.why, company: true, principle: q.principle || null, ...(q.exercise ? { exercise: true } : {}) })) : [];
  const ctx = buildContext({ resumeText, jobTitle: role, company, jobDescription: jobText || role, nowMs });
  const diagnosis = jobText ? localDiagnosis(ctx) : { requirements: [], questions: [], gaps: [] };
  const bullets = ctx.sheet.jobs.flatMap((j) => j.bullets.map((b) => ({ ...b, job: j })));
  const used = new Set();
  const usedQ = new Set();
  const answers = [];
  // 1. the posting's must-haves the résumé proves: "Tell me about your experience with …"
  const shown = (diagnosis.requirements || [])
    // a trait ("attention to detail") is shown by how you answer, never "proved" by a line about serving
    // 200 customers (round 4, Tasha)
    .filter((r) => r.evidence?.length && !r.credential && !/\d|\byears?\b/i.test(r.label) && r.label.split(/\s+/).length <= 5 && !SOFT_SKILL_RE.test(r.label) && !FIELD_LABEL.test(r.label))
    .sort((a, b) => (a.importance === 'required' ? 0 : 1) - (b.importance === 'required' ? 0 : 1));
  for (const r of shown) {
    if (answers.length >= 2) break;
    // the line that tells best: the cited evidence or any line naming the requirement, numbers and
    // outcomes first, recent jobs first, never a documentation line when a doing line exists
    const words = String(r.label).toLowerCase().split(/[^a-z0-9&+#]+/).filter((w) => w.length > 3).map((w) => w.slice(0, 6));
    const cands = bullets.filter((x) => !used.has(x.id) && (r.evidence.includes(x.id) || (words.length && words.every((w) => x.text.toLowerCase().includes(w)))));
    const tell = (x) => (/\d/.test(x.text) ? 2 : 0) + (STORY_RE.test(x.text) ? 2 : 0) - (/^(?:document|maintain|log|keep)\b/i.test(x.text) ? 3 : 0) - ctx.sheet.jobs.findIndex((j) => j.id === x.job.id);
    const b = cands.sort((x, y) => tell(y) - tell(x))[0];
    if (!b) continue;
    const s = storyAnswer(b.text, b.job);
    if (!s) continue;
    const label = postingCase(r.label, jobText);
    // the posting's own casing ("Python", "Instagram"); a common word that only starts a posting line is lowercased
    const lowerInPosting = new RegExp(`(?:^|[^.\\n•\\-]\\s)${label.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(String(jobText));
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
  const GENERIC_Q = new Set(['goal', 'resul', 'perfo', 'work', 'worke', 'thing', 'someo', 'peopl', 'other', 'every', 'chang', 'help', 'impro', 'time', 'day', 'wee', 'week', 'month', 'team', 'shift', 'crew', 'store', 'manag', 'job', 'role', 'compa', 'custo', 'guest', 'hours', 'hour', 'assoc', 'emplo', 'cowor', 'colle', 'frien']);
  const QSYN = { campa: ['campa', 'follo', 'views', 'reel', 'reels', 'engag', 'newsl', 'email', 'promo', 'launc', 'grew'] };
  const qWords = (t) => [...new Set(String(t).toLowerCase().split(/[^a-z0-9&+#]+/).filter((w) => w.length > 3 && !STOPQ.has(w)).map((w) => w.replace(/(?:ing|ed|es|s)$/, '').slice(0, 5)).filter((w) => !GENERIC_Q.has(w)))];
  const qMatch = (qw, lw) => qw.reduce((n, w) => n + ((QSYN[w] || [w]).some((x) => lw.includes(x)) ? 1 : 0), 0) + (qw.includes('campa') && lw.some((w) => (QSYN.campa).includes(w)) && /\d/.test(lw.join(' ')) ? 1 : 0);
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
    const words = topic ? (topic.every((w) => (QSYN[w] || [w]).some((t) => lw.includes(t))) ? topic.length : 0) : qMatch(qw, lw);
    const principle = !!(q.company && BEHAVIORAL.test(q.q) && principleFits(q, x.text));
    return { x, words, principle, n: words + (principle ? 1.5 : 0) + (/\d/.test(x.text) ? 0.5 : 0) - ctx.sheet.jobs.findIndex((j) => j.id === x.job.id) * 0.25 };
  };
  for (const q of [...guideQs, ...bankQs]) {
    if (answers.length >= (guideQs.length ? 7 : 4)) break;
    if (q.exercise || MISTAKE_Q.test(q.q)) continue;
    const qw = qWords(q.q);
    const topicM = q.q.match(SKILL_Q);
    const topic = topicM ? qWords(topicM[1]) : null;
    if (topic && !topic.length) continue;
    const minWords = SCENARIO_Q.test(q.q) ? 2 : 1;
    const pick = (pool, min) => pool.map((x) => score(q, qw, topic, x)).filter((f) => f.words >= minWords && f.n >= min).sort((p1, p2) => p2.n - p1.n)[0];
    const fit = pick(bullets.filter((x) => !used.has(x.id)), 1.5) || (!q.company ? pick(bullets.filter((x) => used.has(x.id)), 2.5) : null);
    if (!fit) continue;
    const st = storyAnswer(fit.x.text, fit.x.job, { prompt: promptForQuestion(q.q) });
    if (!st) continue;
    used.add(fit.x.id); usedQ.add(q.q);
    answers.push({ q: q.q, why: q.why, ...st, resume_fact: fit.x.text, ...(q.company ? { company: true, principle: q.principle } : {}) });
  }
  // 2. the résumé's best stories (outcomes and numbers first, recent first), with the bank's question
  for (const a of base.answers) {
    if (answers.length >= (guideQs.length ? 7 : 5)) break;
    const b = bullets.find((x) => x.text === a.resume_fact);
    if (!b || used.has(b.id)) continue;
    const s = storyAnswer(b.text, b.job);
    if (!s) continue;
    const q = usedQ.has(a.q) ? storyQuestion(b.text, usedQ, base.family, b.job.company) : a.q;
    const s2 = promptForQuestion(q) ? storyAnswer(b.text, b.job, { prompt: promptForQuestion(q) }) : s;
    used.add(b.id); usedQ.add(q);
    answers.push({ q, why: 'A story from your résumé. Tell it in about a minute.', ...s2, resume_fact: b.text });
  }
  const answerQs = new Set(answers.map((a) => a.q));
  // the posting's own pay and hours shape the logistics answers (round 1: "give a range" when the posting
  // states $15/hr; "what hours" for a salaried role)
  // "$166,000 — $225,000 USD", "$18 to $21 an hour": the whole band, whatever dash the posting uses (round 4,
  // Dev: "The posting lists $166,000" for a $166,000 — $225,000 band)
  const payText = (String(jobText).match(/\$\s?\d[\d,.]*(?:\s*(?:k|K))?(?:\s*(?:[–—-]|to)\s*\$?\s?\d[\d,.]*(?:\s*(?:k|K))?)?(?:\s*USD)?\s*(?:\/\s*(?:hr|hour|yr|year)|(?:per|an|a)\s+(?:hour|year)|base salary|base|annually|a year)?/) || [])[0];
  // office and professional work is salaried unless the posting says hourly (round 3: "what hours can you
  // work?" to a backend engineer)
  const SALARIED_FAMILIES = new Set(['software_engineering', 'data_analytics', 'marketing', 'finance_accounting', 'sales', 'education']);
  const salaried = /\b(?:per year|a year|\/\s*yr|annual|salary|base salary)\b/i.test(jobText) || /\bteacher\b/i.test(role) || (SALARIED_FAMILIES.has(prepFamily(role)) && !/\b(?:per hour|an hour|\/\s*hr|hourly)\b/i.test(jobText));
  for (const q of base.questions) {
    if (/^What are your pay expectations/.test(q.q) && payText) q.why = /[–—-]|\bto\b/.test(payText) ? `The posting lists ${payText.trim()}. Say that range works for you, or where in it you fit and why — don't name a number below it.` : `The posting lists ${payText.trim()}. If that works for you, say so plainly; if you need more, say what and why.`;
    if (/^When could you start, and what hours/.test(q.q) && salaried) { q.q = 'When could you start?'; q.why = 'Have a real date: your notice period and the first day you could begin.'; }
  }
  // the question every interview asks: the step up, or the move (round 2: missing almost everywhere)
  const cur = ctx.sheet.jobs.find((j) => j.current) || ctx.sheet.jobs[0];
  const move = moveQuestion(cur, role, ctx.sheet.jobs, ctx.sheet.education || []);
  if (cur?.current) for (const q of base.questions) if (/^Why are you looking for a new job now/.test(q.q)) q.why = 'Keep it short and forward-looking: what this job offers that your current one does not. Never complain about your current employer.';
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
  const head = [...open, ...staples, ...(move ? [move] : [])];
  // the company's own questions come first, story or not — they ARE the interview (round 4, Ray: the
  // Leadership Principles); then the posting's and the field's questions a line answers
  const toldA = answers.map((a) => ({ q: a.q, why: a.why, ...(a.company ? { company: true, principle: a.principle } : {}) }));
  const told = [...toldA.filter((q) => q.company), ...companyQs, ...toldA.filter((q) => !q.company)];
  const pinned = rest.filter((q) => KEEP.test(q.q) && !staples.includes(q));
  // with a company's questions on the card, the generic "one thing you did well at <employer>" is noise
  // (round 4, Maria: "Walk me through one thing you did well at Cox Communications" on a Ross prep)
  const others = rest.filter((q) => !staples.includes(q) && !pinned.includes(q) && !(guideQs.length && /^Walk me through one thing you did well at/.test(q.q)));
  const cap = guideQs.length ? 20 : 15;
  const questions = [...head, ...told, ...pinned, ...others]
    .filter((q, i, all) => all.findIndex((x) => qkey(x.q) === qkey(q.q)) === i)
    .filter((q) => !/^Walk me through one thing you did well at/.test(q.q) || answers.some((a) => a.q === q.q))
    .slice(0, Math.max(cap, head.length + told.length + pinned.length));
  // Drafted answers for the recruiter questions, from résumé facts only, with one [blank] for what only the
  // person knows (round 3: every recruiter question had advice and no answer).
  const scripts = recruiterScripts({ ctx, company, role, stage, pay, payText, questions });
  for (const sc of scripts) {
    if (sc.addQuestion && !questions.some((q) => q.q === sc.q)) questions.splice(Math.min(questions.length, 6), 0, { q: sc.q, why: sc.why });
  }
  const match = jobText ? jobMatch(ctx, diagnosis) : [];
  // the line a requirement's answer tells is the proof shown for it
  for (const m of match) { const a = answers.find((x) => x.q === `Tell me about your experience with ${lcFirst(m.label)}.` || x.q === `Tell me about your experience with ${m.label}.`); if (a && m.status === 'shown') m.proof = a.resume_fact; }
  const intro = base.intro ? base.intro.replace(/;\s+(\d)/g, ', with $1').replace(/;\s+/g, ', and ').replace(/\b(\d+) to (\d+)\b/g, '$1 to $2') : base.intro;
  // every remaining question gets its shape: three blanks to finish on the card (round 3: "9 of 14
  // questions have no answer"); the intro answers "Tell me about yourself"
  const have = new Set([...answers.map((a) => a.q), ...scripts.map((x) => x.q)]);
  const frames = questions.filter((q) => !have.has(q.q) && !/^Tell me about yourself/.test(q.q))
    .map((q) => (q.exercise
      ? { q: q.q, answer: '', resume_fact: '', frame: true, exercise: true, practice: 'This one is done at a keyboard, not answered out loud. Practise it once end to end: say what you are doing as you go, write a test before you call it done, and ask one clarifying question first.', ...(q.company ? { company: true, principle: q.principle } : {}) }
      : { q: q.q, answer: frameFor(q.q), resume_fact: '', frame: true, ...(q.company ? { company: true, principle: q.principle } : {}) }));
  // how this one usually runs: the company's own guide when Seen has it, else the field's; a phone screen
  // is a recruiter call in every company
  const format = guide && guide.format
    ? `${stage === 'Phone Screen' ? 'This is a phone screen, so expect a recruiter: your background in two minutes, why this job, pay, start date. ' : ''}${guide.format}`
    : interviewFormat(role, stage);
  return {
    ...base,
    intro,
    questions,
    answers: [
      ...answers.map(({ why, ...a }) => a),
      ...scripts.map(({ q, answer, resume_fact, reference }) => ({ q, answer, resume_fact, script: true, ...(reference ? { reference } : {}) })),
      ...frames,
    ],
    job_match: match,
    posting_pay: payText ? payText.trim() : null,
    ask_them: [...(guide ? guide.ask_them.map((q) => ({ q, company: true })) : []), ...askThem(role)]
      // two "first 90 days" questions are one question (round 4, Maria)
      .filter((q, i, all) => { const w = (t) => new Set(String(t.q).toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 3 && !/^(?:what|this|that|your|does|look|like|would|with|from|have|will|about|role|store|team)$/.test(x))); const mine = w(q); return !all.slice(0, i).some((o) => [...w(o)].filter((x) => mine.has(x)).length >= 3); })
      .slice(0, 6),
    format,
    guide: guide ? { company: guide.company, confidence: guide.confidence, framework: guide.framework, tips: guide.tips, watch: guide.watch } : null,
    model: false,
  };
}
