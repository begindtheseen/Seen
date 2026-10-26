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
import { requirementQuestion } from '../resume/optimize/engine.js';
import { checkBullet, verbBase } from '../resume/optimize/grammar.js';
import { pastTense, baseFromPast, baseFromGerund } from '../resume/rewrite/inflect.js';
import { KNOWN_VERBS } from '../resume/health/verbs.js';
import { guardPack, prepFamily } from './interviewPrep.js';
import { storyQuestion } from './interviewQuestionBank.js';

const clean = (s, n = 600) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const lcFirst = (s) => (s && !/^[A-Z]{2,}|^[A-Z][a-z]*[A-Z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const capFirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const article = (t) => { const w = String(t || '').trim().split(/\s+/)[0] || ''; return (/^[A-Z]{2,}/.test(w) ? /^[AEFHILMNORSX]/.test(w) : /^[aeiou]/i.test(w)) ? 'an' : 'a'; };
const shortTitle = (t) => String(t || '').replace(/\s*[,(–—].*$/, '').trim();

// Leads that are something done TO the person ("Named Employee of the Month") read "I was named …".
const PASSIVE_LEADS = new Set(['named', 'promoted', 'selected', 'recognized', 'recognised', 'nominated', 'elected', 'chosen', 'honored', 'honoured', 'appointed', 'voted', 'ranked', 'rated', 'commended', 'featured', 'invited', 'entrusted', 'tasked', 'assigned', 'trusted', 'awarded', 'certified', 'licensed', 'cross-trained']);

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
  if (PASSIVE_LEADS.has(lw)) first = `I was ${head.charAt(0).toLowerCase()}${head.slice(1)}`;
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
const FROM_TO_RE = /^(cut|reduced|lowered|dropped|brought down|raised|grew|increased|improved|boosted|lifted|moved|took)\s+(?:the\s+)?(.+?)\s+from\s+(\$?[\d.,]+(?:%|[KkMm]\b)?(?:\s+(?:minutes|days|hours|seconds|weeks|percent|points))?)\s+to\s+(\$?[\d.,]+(?:%|[KkMm]\b)?(?:\s+(?:minutes|days|hours|seconds|weeks|percent|points))?)(.*)$/i;
const DOWN_RE = /^(?:cut|reduced|lowered|dropped|brought)/i;

// What to add that the line cannot say, by what the line is about.
const DETAIL = [
  [/\b(?:train\w*|coach\w*|mentor\w*|precept\w*|onboard\w*|taught|teach\w*)\b/i, '[How you trained them: what the first weeks looked like, and how you knew they were ready.]'],
  [/\b(?:lead|led|supervis\w*|manag\w*|crew|team|staff|associates)\b/i, '[One week that tested the team: what happened, and what you did.]'],
  [/\b(?:customers?|guests?|patients?|callers?|clients?|residents?|students?|families)\b/i, '[One person you remember: what they needed, and what you did.]'],
  [/\b(?:built|build|creat\w*|design\w*|wrote|write|automat\w*|launch\w*|set up)\b/i, '[Why it was needed, and the hardest part of building it.]'],
  [/\b(?:found|caught|noticed|spotted|identified|discovered)\b/i, '[How you spotted it, and what would have happened if no one had.]'],
  [/\b(?:sold|sell|opened|booked|closed|quota|meetings)\b/i, '[What you did differently from others to get there.]'],
];
const detailFor = (text) => (DETAIL.find(([re]) => re.test(text)) || [null, '[What made it hard, and one thing you did that someone else might not have.]'])[1];
// A line that is a duty told as a typical day ("Care for 5–6 patients a shift") needs no "situation".
const STORY_RE = /\b(?:cut|reduc\w*|rais\w*|grew|increas\w*|improv\w*|saved|built|launched|trained|precepted|led|won|named|started|administered|managed)\b/i;
const ONGOING_RE = /^(?:care|handle|answer|serve|run|work|process|support|assist|help|operate|prepare|maintain|teach|manage|lead|keep|own|book|build|write|ring|restock|cook|prep|load|pick|drive|deliver|greet|check|schedule|document)\b/i;

/**
 * A spoken answer built on one résumé line. `job` is the line's job from the fact sheet.
 * Returns { situation, action, result, answer } with at most two [brackets].
 */
export function storyAnswer(text, job) {
  const current = !!job?.current;
  const title = shortTitle(job?.title);
  const company = String(job?.company || '').replace(/\.+$/, '');
  const at = company ? (title ? `At ${company}, where I ${current ? "'m" : 'was'} ${article(title)} ${title}` : `At ${company}`) : '';
  const where = at.replace(/I 'm/, "I'm");
  const line = clean(text).replace(/^[\s•●▪◦*·\-–—]+/, '').replace(/[.;\s]+$/, '');
  const ft = line.split(/;\s+/)[0].match(FROM_TO_RE);
  if (ft) {
    const [, , metricRaw, a, b, tailRaw] = ft;
    const metric = metricRaw.replace(/^(?:the|our|my)\s+/i, '');
    const within = (tailRaw.match(/\b(?:in|within|over)\s+((?:\d+|one|two|three|six|twelve)\s+(?:weeks?|months?|years?|quarters?)|a year|one year)\b/i) || [])[1];
    const by = (tailRaw.match(/\bby\s+([a-z]+ing)\b(.*)$/i) || []);
    const situation = `${where ? `${where}, ` : ''}${lcFirst(metric)} was at ${spoken(a)}.`.replace(/^([a-z])/, (c) => c.toUpperCase());
    let action = '';
    if (by[1]) {
      const base = baseFromGerund(by[1].toLowerCase(), KNOWN_VERBS) || by[1].replace(/ing$/, '');
      action = `I ${pastTense(base)}${spoken(by[2]).replace(/[.;\s]+$/, '')}. [The two or three specific changes you made, and who you got on board.]`;
    } else action = '[What you changed, step by step, and who you got on board.]';
    const result = `${within ? `Within ${within}, ` : 'By the end, '}${lcFirst(metric)} was ${DOWN_RE.test(ft[1]) ? 'down' : 'up'} to ${spoken(b)}.`;
    return { situation, action, result, answer: [situation, action, result].join(' ') };
  }
  const fp = firstPerson(line, { current });
  if (!fp) return null;
  const lead = where ? `${where}, ${fp.first}` : capFirst(fp.first);
  const action = `${lead.replace(/^At [^,]+, where I'm/, (m) => m)}.`;
  const hasResult = /\d/.test(line) && /\b(?:cut|reduc\w*|rais\w*|grew|increas\w*|improv\w*|saved|won|named|award\w*|ranked|top|most|record|kept|hit|beat|exceeded|passed|still on staff|retain\w*|lifted)\b/i.test(line);
  const restText = fp.rest.length ? `${fp.rest.join('. ')}.` : '';
  const result = restText;
  // At most two prompts. A duty told as a typical day needs one example with its ending; a one-off
  // story needs its situation, plus the detail the line cannot give.
  if (ONGOING_RE.test(line) || !hasResult && !restText) {
    const example = hasResult || restText ? detailFor(line) : '[One time it mattered: what happened, what you did, and how it ended.]';
    return { situation: '', action: `${action} ${example}`, result, answer: [action, example, result].filter(Boolean).join(' ') };
  }
  const situation = '[One sentence on the situation: what was going on, and why it mattered.]';
  const detail = detailFor(line);
  return { situation, action: `${action} ${detail}`, result, answer: [situation, action, detail, result].filter(Boolean).join(' ') };
}

// ── What the posting asks for, and your answer ──────────────────────────────────────────────────
const haveVerb = (label) => {
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
  const byId = new Map(ctx.sheet.jobs.flatMap((j) => j.bullets.map((b) => [b.id, b.text])));
  const rank = (r) => (r.importance === 'required' ? 0 : 1);
  const out = [];
  for (const r of [...(diagnosis.requirements || [])].sort((a, b) => rank(a) - rank(b))) {
    const label = postingCase(clean(r.label, 120), ctx.jobDescription);
    if (!label || /\b\d+\s*\+?\s*(?:years?|yrs?)\b/i.test(label)) continue;
    const ev = (r.evidence || []).map((id) => byId.get(id)).find(Boolean);
    if (r.credential === 'expired') out.push({ label, status: 'expired', say: `It has lapsed, and they will ask. Say when it will be current: “My ${label.replace(/\s+(?:required|within).*$/i, '')} lapsed; I'll have it renewed by [date].”` });
    else if (r.credential === 'in progress') out.push({ label, status: 'in progress', say: 'Say exactly where you are: what you have completed, and when you will finish.' });
    else if (r.credential === 'not held') out.push({ label, status: 'gap', say: `Not on your résumé. If they ask: “I don't hold it yet. [When you could get it, or the closest credential you have.]”` });
    else if (ev) out.push({ label, status: 'shown', proof: ev, say: 'Your proof is this line — have the story behind it ready.' });
    else if (/\b(?:degree|diploma|GED|bachelor|master|associate|BSN|BA|BS|MBA)\b/i.test(label) && (r.credential === 'held' || r.strength !== 'none')) out.push({ label, status: 'shown', say: 'In your education section.' });
    else if (r.credential === 'held') out.push({ label, status: 'shown', say: 'On your résumé. Have the card or license number and its expiry date ready.' });
    else if (r.strength === 'stated' || r.strength === 'implied' || r.strength === 'weak') out.push({ label, status: 'stated', say: 'It is on your résumé, but no line shows it in action. Have one example ready: when you did it, and what came of it.' });
    else out.push({ label, status: 'gap', say: `Not on your résumé. If they ask, don't stretch it: “I haven't ${haveVerb(label)} yet. The closest I've done is [your closest experience], and I'd get up to speed by [one concrete step].”` });
  }
  // the posting's main duties the résumé does not show (the optimizer asks about the same ones)
  for (const q of diagnosis.questions || []) {
    const m = String(q.ask || '').match(/^Have you done this: “(.+)”\?$/);
    if (m) out.push({ label: m[1], status: 'gap', duty: true, say: 'A main duty of this job that your résumé does not show. If you have done it, have the example ready; if not, say what is closest and how you would learn it.' });
  }
  // one entry per proof line ("hiring and team development" and "Proven record hiring…" are one thing)
  return out.filter((x, i) => !x.proof || out.findIndex((y) => y.proof === x.proof) === i).slice(0, 10);
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
export function askThem(role) {
  const fam = prepFamily(role);
  const lead = /\b(?:manager|lead|supervisor|director|head)\b/i.test(role);
  const field = (fam === 'retail' && lead ? ASK_THEM.retail_lead : ASK_THEM[fam]) || ASK_THEM.general;
  return [...field, 'What does a great first 90 days look like in this role?', 'What are the next steps, and when should I expect to hear back?']
    .map((q) => ({ q }));
}

// ── The pack ────────────────────────────────────────────────────────────────────────────────────
/**
 * The whole paid pack with no model: guardPack's questions, staples, intro and résumé check (unchanged),
 * spoken answers built on the right résumé lines (the posting's evidence first), what the job asks for
 * and your answer to each, and questions to ask them.
 */
export function localPack({ company, role, resumeText, jobText = '', pay = null, stage = '', nowMs = Date.now() }) {
  const base = guardPack({}, { company, role, resumeText, pay, stage, nowMs });
  const ctx = buildContext({ resumeText, jobTitle: role, company, jobDescription: jobText || role, nowMs });
  const diagnosis = jobText ? localDiagnosis(ctx) : { requirements: [], questions: [], gaps: [] };
  const bullets = ctx.sheet.jobs.flatMap((j) => j.bullets.map((b) => ({ ...b, job: j })));
  const byId = new Map(bullets.map((b) => [b.id, b]));
  const used = new Set();
  const usedQ = new Set();
  const answers = [];
  // 1. the posting's must-haves the résumé proves: "Tell me about your experience with …"
  const shown = (diagnosis.requirements || [])
    .filter((r) => r.evidence?.length && !r.credential && !/\d|\byears?\b/i.test(r.label) && r.label.split(/\s+/).length <= 5)
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
    const q = `Tell me about your experience with ${/^[A-Z][a-z]/.test(label) && !/[A-Z].*[A-Z]/.test(label) ? lcFirst(label) : label}.`;
    used.add(b.id); usedQ.add(q);
    answers.push({ q, why: `The posting asks for ${label}. This line of yours shows it.`, ...s, resume_fact: b.text });
  }
  // 2. the résumé's best stories (outcomes and numbers first, recent first), with the bank's question
  for (const a of base.answers) {
    if (answers.length >= 5) break;
    const b = bullets.find((x) => x.text === a.resume_fact);
    if (!b || used.has(b.id)) continue;
    const s = storyAnswer(b.text, b.job);
    if (!s) continue;
    const q = usedQ.has(a.q) ? storyQuestion(b.text, usedQ, base.family, b.job.company) : a.q;
    used.add(b.id); usedQ.add(q);
    answers.push({ q, why: 'A story from your résumé. Tell it in about a minute.', ...s, resume_fact: b.text });
  }
  const answerQs = new Set(answers.map((a) => a.q));
  const open = base.questions.filter((q) => /^(?:Tell me about yourself|Why do you want to work at)/.test(q.q));
  const rest = base.questions.filter((q) => !open.includes(q) && !answerQs.has(q.q) && !base.answers.some((a) => a.q === q.q));
  const questions = [...open, ...answers.map((a) => ({ q: a.q, why: a.why })), ...rest].slice(0, 15);
  const match = jobText ? jobMatch(ctx, diagnosis) : [];
  // the line a requirement's answer tells is the proof shown for it
  for (const m of match) { const a = answers.find((x) => x.q === `Tell me about your experience with ${lcFirst(m.label)}.` || x.q === `Tell me about your experience with ${m.label}.`); if (a && m.status === 'shown') m.proof = a.resume_fact; }
  return {
    ...base,
    questions,
    answers: answers.map(({ why, ...a }) => a),
    job_match: match,
    ask_them: askThem(role),
    model: false,
  };
}
