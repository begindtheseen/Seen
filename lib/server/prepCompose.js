// The answer composer for Interview Prep (P2, 2026-11-10).
//
// The director read a paid pack as the buyer (a support team lead applying to a call-center TRAINER job): the questions
// came from the posting, but every answer was a worksheet — the same three-blank frame on five questions, "0/15
// finished". A person who paid expects a DRAFT they can say out loud, built from their own résumé, that they only have
// to finish. This module turns each question into a spoken draft of 2–4 sentences with AT MOST ONE blank, and the blank
// is a detail only the person knows.
//
// Every word of a draft comes from (a) the person's résumé, turned into first-person speech by lib/text/voice.js,
// (b) the posting's own words for the duty or requirement the question is about, or (c) a closed list of connectives
// (CONNECTIVES below). A draft is validated before it is printed (validateDraft); one that fails falls back to a
// shorter, cleaner draft — never to the old three-blank frame for more than two questions in a pack.
//
// Shapes (the construction varies; no two answers in a pack open with the same words):
//   SHOWN      claim (the résumé line that proves the posting's statement) → proof (a number line from the same job,
//              when one bears on it) → bridge (the posting's own words for the duty) → one blank.
//   PARTLY     "<duty> hasn't been a formal part of my job, but the closest I do is …" → one blank: what to learn first.
//   NOT SHOWN  an honest two-sentence frame naming the real thing, only for a real, specific requirement.
//   STORY      a behavioural question: situation and action from the line → a result from the same job → one blank
//              about THE QUESTION ("the customer you remember: what they needed and how it ended").
//   OPENERS    intro, why this company (the posting's own description of the company), why now (promotion- and
//              tenure-aware), pay (the shared posting-pay reader), start, and the recruiter logistics.

import { firstPerson, resultSentence, aAn, joinList, sentenceCase, agree, gerundPhrase, isPluralNoun, baseVerb, gerund, verbList } from '../text/voice.js';
import { verbBase } from '../resume/optimize/grammar.js';
import { pastTense, baseFromGerund } from '../resume/rewrite/inflect.js';
import { KNOWN_VERBS } from '../resume/health/verbs.js';
import { spokenEmployer, sayTitle } from './prepFacts.js';
import { sectionPosting } from '../optimizer/postingSections.js';
import { escapeRegExp } from '../text/escapeRegExp.js';
import { cleanConfirmations } from '../optimizer/confirmations.js';

export const COMPOSE_VERSION = 'compose-2026-11-10';

const clean = (s, n = 600) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const strip = (s) => clean(s).replace(/^[\s•●▪◦*·\-–—]+/, '').replace(/[.;:\s]+$/, '');
const lcFirst = (s) => (s && /^[A-Z][a-z]+\b/.test(s) && !/^(?:I|I'm|I've|I'd)\b/.test(s) && !/^[A-Z][a-z]+\s+[A-Z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const words = (t) => String(t || '').toLowerCase().replace(/[’‘]/g, "'").split(/[^a-z0-9&+#%']+/).map((w) => w.replace(/^'+|'+$/g, '')).filter(Boolean);
const STOP = new Set('a an the and or of to in on at for with by from as is are be was were this that these those our your their its it we you they them he she his her i me my will would can could should may might must have has had do does did not no into over under about across through per via than then so such also each every all any more most other some new our who what when where which while within without upon onto up out off own same very just only both either neither'.split(' '));
const GENERIC = /^(?:nurs$|car$|nurse|nurses$|nursin|home$|care$|caring$|cared$|time$|times$|day$|days$|week$|weeks$|year$|years$|hour$|hours$|month$|agent|custom|member|client|guest|patien|staff|employ|associ|people|users?$|studen|adults?$|call$|calls$|team$|teams$|work$|pull$|run$|set$|keep$|make$|take$|get$|put$|use$|need$|help$|show$|hold$|start$|serve$|new$|high$|full$|part$|best$|real$|wide$|open$|proce|manag|handl|servi|suppo|opera|skill|abili|work|team|gener|basic|daily|perfo|maint|ensur|assis|dutie|shift|plans|track|repor|other|every|their|syste|provi|inclu|requi|depar|activ|relat|ident|exper|knowl|strong|excel|year|years|role|posit|candi|compa|custo|peopl|staff|emplo|membe|clien|qualit|level|great|good|high|using|based|across|withi|will|must)/;
const stem = (w) => w.replace(/(?:ing|ed|es|s)$/, '').slice(0, 6);
const stemsOf = (t) => [...new Set(words(t).filter((w) => w.length > 2 && !STOP.has(w)).map(stem))];
const specific = (st) => st.filter((w) => w.length >= 4 && !GENERIC.test(w));

// Things that are the same work said two ways (call review ↔ call monitoring ↔ QA; 1:1s ↔ coaching ↔ feedback;
// onboard ↔ train new hires). A line and a posting statement that both name one of these share it.
const CONCEPTS = [
  ['call review', /\b(?:call reviews?|call monitor\w*|monitor\w* (?:live )?calls?|quality assurance|QA\b|quality reviews?|side[- ]by[- ]sides?|call calibrat\w*|scorecards?|listen\w* (?:in|to) calls)/i],
  ['coaching', /\b(?:1:1s?|one[- ]on[- ]ones?|coach\w*|feedback|performance (?:reviews?|plans?|improvement)|development plans?|mentor\w*|precept\w*)/i],
  ['onboarding', /\b(?:onboard\w*|new[- ]hires?|new (?:agents|employees|associates|staff|team members|nurses|reps)|orientation|nesting|ramp\w*)/i],
  ['training', /\b(?:train\w*|taught|teach\w*|instruct\w*|classes|curriculum|workshops?|refresher|upskill\w*|cross-train\w*)/i],
  ['materials', /\b(?:training materials?|job aids?|e-?learning|curricul\w*|playbooks?|help[- ]center|articles|knowledge[- ]base|macros|SOPs?|manuals?|modules?|lesson plans?|runbooks?|documentation|guides?|templates?|exercises|scripts|content)/i],
  ['virtual training', /\b(?:virtual(?:ly)?\s+(?:train\w*|sessions?|classes)|remote train\w*|onboarding calls?|webinars?|video calls?|trained customers)\b/i],
  ['presenting', /\b(?:present\w*|facilitat\w*|workshops?|lectur\w*|demos?|public speaking|speak\w* to groups|town halls?)/i],
  ['metrics', /\b(?:CSAT|NPS|handle time|AHT|first response|response time|resolution time|SLAs?|KPIs?|metrics?|scorecards?|speed-to-proficiency|time to proficiency|speed-to|quality scores?|accuracy|retention|turnover|productivity|on-time)/i],
  ['reporting', /\b(?:report\w*|dashboards?|track\w*|spreadsheets?|excel|analy[sz]\w*|insights?|data)\b/i],
  ['escalations', /\b(?:escalat\w* (?:calls?|billing|customer|guest|member|complaints?|tickets?|disputes?|issues?|cases?)|(?:customer|guest|billing|member) escalations?|escalations|de-?escalat\w*|complaints?|concerns|issues resolved|resolv\w* (?:customer|guest|member|caller|client)|disputes?|refunds?|chargebacks?|angry|upset|(?:difficult|hardest|toughest|irate) (?:customers?|callers?|guests?|patients?|clients?))/i],
  ['hiring', /\b(?:interview\w*|hir(?:e|ed|ing)\b|recruit\w*|screen\w* candidates)/i],
  ['leading', /\b(?:(?:led|lead|managed|ran|run|running) (?:people|(?:a |the )?(?:\w+ )?shifts?\b)|lead(?:ing)? (?:a |the )?(?:team|crew|staff)|led (?:a |the )?(?:team|crew|staff)|team of \d|crew of \d|supervis\w*|manag\w* (?:a |the )?(?:team|staff|crew|associates|agents)|direct reports?|charge nurse|shift lead|foreman)/i],
  ['scheduling', /\b(?:schedul\w*|rosters?|staffing|coverage|labor (?:hours|budget)|shift plans?)/i],
  ['customers', /\b(?:customers?|guests?|callers?|clients?|members?|shoppers?|patrons?)\b/i],
  ['calls', /\b(?:calls?|phone|chats?|tickets?|inbound|outbound|queue|contact cent\w*|call cent\w*)\b/i],
  ['process', /\b(?:improv\w*|streamlin\w*|redesign\w*|rebuil\w*|automat\w*|cut|reduc\w*|standardi[sz]\w*)\b/i],
  ['inventory', /\b(?:inventor\w*|cycle counts?|stock\w*|replenish\w*|shrink|SKUs?|counts?)\b/i],
  ['safety', /\b(?:safety|safely|OSHA|incidents?|injur\w*|hazard\w*|lockout|PPE|5S)\b/i],
  ['warehouse', /\b(?:pick(?:s|ed|ing|er|ers)?|pack(?:s|ed|ing|er|ers)?|ship(?:s|ped|ping|ment|ments)?|load\w*|unload\w*|forklifts?|pallets?|RF scan\w*|WMS|putaway|dock)\b/i],
  ['patient care', /\b(?:patients?|assessments?|vital signs?|medications?|charting|telemetry|bedside|care plans?|discharge|admissions?)\b/i],
  ['clinical education', /\b(?:patient (?:education|teaching)|educat\w* (?:patients|families)|teach-back|discharge teaching)\b/i],
  ['forklift', /\b(?:forklifts?|reach trucks?|powered industrial trucks?|order pickers?|pallet jacks?|PIT)\b/i],
  ['sales', /\b(?:quota|pipeline|closed|deals?|upsell\w*|revenue|prospect\w*|leads|booked|cross-sell\w*)\b/i],
  ['cash', /\b(?:cash\w*|registers?|tills?|drawers?|POS|point of sale|money orders?)\b/i],
  ['compliance', /\b(?:complian\w*|audit\w*|regulat\w*|HIPAA|SOX|GAAP|policy|policies|controls?)\b/i],
  ['accounting', /\b(?:reconcil\w*|month[- ]end|close|journal entr\w*|ledger|GL\b|accruals?|AP\b|AR\b|variance|invoic\w*)\b/i],
  ['software', /\b(?:APIs?|microservices?|deploy\w*|code|tests?|latency|on-?call|incidents?|backend|databases?|PostgreSQL|Go\b|Python|TypeScript|Kafka|Kubernetes)\b/i],
  ['marketing', /\b(?:campaigns?|social media|posts?|content|Instagram|TikTok|followers|engagement|email marketing|newsletters?|brand|SEO)\b/i],
  ['repair', /\b(?:repair\w*|troubleshoot\w*|diagnos\w*|install\w*|maintenance|preventive|wir(?:e|ing)|panels?|conduit|service calls?)\b/i],
  ['food', /\b(?:kitchen|prep|line|food safety|ServSafe|menu|plating|covers|recipes?)\b/i],
  ['teaching', /\b(?:lessons?|students?|classroom|grade|curriculum|IEPs?|parents?)\b/i],
  ['writing', /\b(?:wrote|write|writ\w*|articles?|copy|documentation|playbooks?|macros?)\b/i],
  ['tools', /\b(?:Zendesk|Salesforce|Talkdesk|Five9|Genesys|Excel|LMS|Workday|Kronos|Epic|Cerner|NetSuite|QuickBooks|SAP|Jira|HubSpot|Tableau|Power BI)\b/i],
];
const conceptsOf = (t) => CONCEPTS.filter(([, re]) => re.test(String(t || ''))).map(([k]) => k);
// broad concepts count for less: two lines both about customers are not the same proof
const BROAD = new Set(['customers', 'calls', 'process', 'reporting', 'training', 'writing', 'tools', 'patient care', 'warehouse', 'software', 'food']);
// a condition of the job, not its work (schedule, place, pay, checks): never the "core" a why-now or an intro names
export const CONDITION_RE = /\b(?:schedules?|full[- ]time|part[- ]time|hours|(?:night|day|evening|weekend|overnight|morning|rotating|split|\d+[- ]hour|\d+(?:st|nd|rd|th))\s+shifts?|shifts?\s+(?:per|a|each)\s+week|on-?site|remote|hybrid|location|travel|pay|salary|wages?|weekends?|holidays?|available|availability|overtime|commute|background check|drug (?:test|screen)|lift(?:ing)?|pounds|lbs)\b/i;
/** The posting's core duty: the first duty-led statement that is work, not a condition or a trait. */
export function coreDuty(statements) {
  return (statements || []).find((s) => (s.kind === 'duty' || s.importance === 'duty') && verbOf(s.text) && (s.text.match(/,/g) || []).length < 3 && !LEAD_IN.test(clean(s.text)) && !/\b\d+\s*\+?\s*(?:-\s*\d+\s*)?years?\b/i.test(s.text) && !CONDITION_RE.test(s.text) && !CONDUCT_RE.test(s.text) && realStatement(s.text) && dutySubject(s.text, 9)) || null;
}
// a duty that handles problems ("Resolve guest complaints", "handle escalations"): never the motive for wanting a job
const PROBLEM_DUTY = /^(?:resolve|handle|manage|address|de-?escalate|respond to|deal with)\s+(?:\w+\s+){0,2}(?:complaints?|escalations?|issues?|problems?|disputes?|concerns?|incidents?)\b/i;
// conduct a résumé cannot show (being on time, a positive attitude, following procedures): never a row, never "new to me"
export const CONDUCT_RE = /\b(?:willing\w*|weather|attitude|on time|punctual\w*|productive|energetic|positive|friendly|courteous|reliab\w*|dependab\w*|team player|work ethic|self-starter|motivated|passion\w*|eye contact|smiles?|professional (?:appearance|demeanor)|follows? (?:all )?(?:\w+ )?(?:policies|procedures|guidance|instructions|directions|standards)|treat\w* (?:all )?(?:customers|guests|patients|staff|everyone)|fair and consistent|courtesy|respectful)\b/i;
const TEACH_LINE = /^\s*(?:trained|certified|taught|coached|onboarded|mentored)\b/i;
const TEACH_STMT = /\b(?:train|teach|coach|onboard|mentor|educat|facilitat|instruct|precept|develop (?:agents|staff|people|associates|team))/i;

// ── The évidence pool: every résumé line under its job, with what is known about the job ───────────────────────────
const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function yearOf(ym) { return Number.isFinite(ym) ? Math.floor(ym / 12) : null; }
// a slash title is said as its first title ("Warehouse Associate / Inventory Control" → "Warehouse Associate"); the second
// is spoken only as work ("…where I also handle inventory control")
const roleTitle = (t) => sayTitle(String(t || '').replace(/\s*\([^)]*\)/g, '').replace(/\s*[,–—|].*$/, '').split(/\s*\/\s*/)[0].trim());
const slashWork = (t) => { const p = String(t || '').replace(/\s*\([^)]*\)/g, '').replace(/\s*[,–—|].*$/, '').split(/\s*\/\s*/); return p.length > 1 && p[1].trim() ? p[1].trim().replace(/\b[A-Z][a-z]+\b/g, (w) => w.toLowerCase()) : ''; };
export function evidencePool(ctx) {
  const hist = ctx.sheet.history || [];
  const out = [];
  const curCo = (ctx.sheet.jobs.find((j) => j.current) || {}).company;
  ctx.sheet.jobs.forEach((j, ji) => {
    const h = hist[ji] || {};
    const job = { id: j.id, idx: ji, title: roleTitle(j.title), company: spokenEmployer(j.company), current: !!j.current, start: yearOf(h.startYm), end: h.current || j.current ? null : yearOf(h.endYm), sameAsCurrent: !j.current && !!curCo && spokenEmployer(curCo) === spokenEmployer(j.company) };
    for (const b of j.bullets) {
      if (b.uncertain) continue;
      const text = strip(b.text);
      if (!text) continue;
      const fp = firstPerson(text, { tense: job.current ? 'present' : 'past' });
      const rs = fp ? null : resultSentence(text);
      // a line with a "by …" or "; …" clause is linked by its head; the clause is its own entry below
      const head = text.split(/;\s+/)[0].replace(/\s+by\s+[a-z]+ing\b.*$/i, '');
      out.push({ id: b.id, text: b.text, plain: text, job, stems: stemsOf(head), concepts: conceptsOf(head), num: /\d/.test(text), fp, said: fp ? fp.first : rs, result: !!rs || (fp && /\b(?:cut|reduc\w*|rais\w*|grew|increas\w*|improv\w*|saved|won|hit|beat|exceeded|held|kept|brought|lifted|top|named|ranked|record)\b/i.test(text) && /\d/.test(text)) });
      // a clause of the line can be the proof on its own ("…by splitting the Zendesk queue by issue type and adding
      // macros" is the closest thing to writing job aids; "…; run weekly 1:1s and monthly call reviews" is coaching)
      for (const part of clausesOf(text, job.current)) out.push({ id: `${b.id}#${part.k}`, parent: b.id, text: b.text, plain: part.plain, job, stems: stemsOf(part.plain), concepts: conceptsOf(part.plain), num: /\d/.test(part.plain), fp: null, said: part.said, result: false, clause: true });
    }
  });
  // a skills item names work the person does ("help center writing", "coaching", "de-escalation")
  (ctx.sheet.skills || []).forEach((item, i) => {
    const t = clean(item);
    if (!t || t.length > 40 || !conceptsOf(t).filter((c) => !BROAD.has(c)).length) return;
    out.push({ id: `skill${i}`, text: t, plain: t, job: { id: 'skills', idx: 6, title: '', company: '', current: true }, stems: stemsOf(t), concepts: conceptsOf(t), num: false, fp: null, said: null, skill: true, result: false });
  });
  return out;
}

// "splitting" → "split", "adding" → "add", "making" → "make"
function ingBase(g) {
  const r = g.replace(/ing$/, '');
  if (/([b-df-hj-np-tv-z])\1$/.test(r)) return r.slice(0, -1);
  if (verbBase(r) === r || baseVerb(r) === r) return r;
  if (verbBase(`${r}e`) || baseVerb(`${r}e`)) return `${r}e`;
  return r.length >= 3 ? r : '';
}
// The clauses of one line said as the person's own sentence: what follows "; " when it starts with a verb, and the
// means after " by <verb>ing" ("…by splitting the queue by issue type and adding macros" → "I split the queue by issue
// type and added macros").
function clausesOf(text, current) {
  const out = [];
  const parts = text.split(/;\s+/);
  parts.slice(1).forEach((p, i) => { const fp = firstPerson(p, { tense: current ? 'present' : 'past' }); if (fp && p.split(/\s+/).length >= 3) out.push({ k: `s${i}`, plain: p, said: fp.first }); });
  const by = parts[0].match(/\s+by\s+([a-z]+ing\b.*)$/i);
  if (by) {
    const turned = by[1].replace(/\b([a-z]+ing)\b/gi, (m, g, off) => {
      const prev = by[1].slice(0, off).trim().split(/\s+/).pop() || '';
      if (off !== 0 && !/^(?:and|or)$/i.test(prev)) return m;
      const b = baseFromGerund(g.toLowerCase(), KNOWN_VERBS) || ingBase(g.toLowerCase());
      // the means of a result is told in the past, whatever job it sits under ("…by splitting the queue" → "I split")
      return b ? pastTense(b) : m;
    });
    if (turned !== by[1]) out.push({ k: 'by', plain: by[1], said: `I ${turned}` });
  }
  return out;
}

/** The named link between a posting statement and a résumé line: shared specific words, or a piece of the same work. */
export function linkOf(statement0, line) {
  const statement = String(statement0 || '').replace(/\b(?:picks?|picked) up\b|\bpace\b/gi, ' ').replace(/\btraining\s+(?=(?:outcomes?|materials?|records?|plans?|programs?|content|needs|data|modules?|exercises|calendar|schedule)\b)/gi, '');
  const sp = specific(stemsOf(statement));
  const shared = line.stems.filter((w) => sp.includes(w));
  const narrow = line.concepts.filter((c) => !BROAD.has(c) && conceptsOf(statement).includes(c));
  if (narrow.length) return { kind: 'same work', words: narrow };
  if (shared.length) {
    const ws = words(line.plain).filter((w) => shared.includes(stem(w)));
    return { kind: 'shared words', words: [...new Set(ws)].slice(0, 3) };
  }
  return null;
}

/** How well one résumé line proves one posting statement: { n, strength: 'strong'|'close'|null, shared, concepts }. */
export function proofScore(statement0, line, { verdictLines = [] } = {}) {
  // "training outcomes", "training materials": training is the object's modifier, not the work ("trained customers" is
  // not proof of documenting training outcomes — coordinator round 2)
  const statement = String(statement0 || '').replace(/\btraining\s+(?=(?:outcomes?|materials?|records?|plans?|programs?|content|needs|data|modules?|exercises|calendar|schedule)\b)/gi, '');
  const st = stemsOf(statement);
  const sp = specific(st);
  const shared = line.stems.filter((w) => sp.includes(w));
  const sc = conceptsOf(statement);
  const cs = line.concepts.filter((c) => sc.includes(c));
  const narrow = cs.filter((c) => !BROAD.has(c));
  const fromVerdict = verdictLines.some((v) => v && sameLine(v, line.text));
  const teaching = TEACH_LINE.test(line.plain) && !TEACH_STMT.test(statement);
  // a line about customers ("Trained customers on setup") is not proof of training agents
  const audienceMiss = /\btrain\w*\s+customers\b/i.test(line.plain) && /\b(?:agents|staff|employees|associates|new hires|team|adults|reps|representatives)\b/i.test(statement);
  const n = shared.length * 2 + narrow.length * 2.5 + (cs.length - narrow.length) * 0.75 + (fromVerdict ? 2 : 0) + (line.num ? 0.4 : 0) - line.job.idx * 0.3 - (teaching ? 2 : 0) - (audienceMiss ? 1.5 : 0);
  const strong = !audienceMiss && (shared.length >= 2 || (narrow.length >= 1 && shared.length >= 1) || narrow.length >= 2 || (fromVerdict && (shared.length + narrow.length) >= 1));
  // no named link (a shared specific word, or a piece of the same work) → never proof, never "the closest"
  // training customers is the closest thing to training agents (coordinator: virtual training ↔ onboarding calls), never
  // proof of it
  const close = !strong && (shared.length >= 1 || narrow.length >= 1);
  let link = strong || close ? linkOf(statement, line) : null;
  if (line.skill && link && link.kind !== 'same work') link = null;
  return { n, strength: link ? (strong ? 'strong' : 'close') : null, shared, concepts: cs, audienceMiss, link };
}
// a duty the reader could not judge is "shown" by a line only when the line covers most of it: half its specific words,
// or two named pieces of the same work ("Manage payroll and scheduling" is not shown by a scheduling line alone)
const CLASS_CONCEPTS = [
  [/\b(?:feedback|coach\w*|1:1s?|one[- ]on[- ]ones?|mentor\w*)\b/i, ['coaching', 'call review']],
  // (materials ↔ macros or articles, and virtual training ↔ onboarding calls, are the CLOSEST thing — never "plainly does")
  [/\b(?:call (?:review|monitor\w*)|quality assurance|side-by-side)\b/i, ['call review']],
  [/\beducat\w* (?:patients|families)\b/i, ['clinical education']],
  [/\b(?:forklifts?|powered industrial trucks?|reach trucks?)\b/i, ['forklift']],
];
function coversByClass(statement, best) {
  const head = clean(statement).replace(LEAD_IN, '').split(/\s+(?:to|after|so|in order to|while)\s+/)[0];
  const cls = CLASS_CONCEPTS.find(([re]) => re.test(head));
  return !!(cls && best.concepts.filter((c) => !BROAD.has(c)).some((c) => cls[1].includes(c)));
}
function covers(statement, best) {
  const sp = specific(stemsOf(dutySubject(statement, 14) || statement));
  const narrow = best.concepts.filter((c) => !BROAD.has(c));
  // the line names the duty's own object ("one-on-one performance feedback" ← "weekly 1:1s and monthly call reviews")
  const head = clean(statement).replace(LEAD_IN, '').split(/\s+(?:to|after|so|in order to|while)\s+/)[0];
  const cls = CLASS_CONCEPTS.find(([re]) => re.test(head));
  if (cls && narrow.some((c) => cls[1].includes(c))) return true;
  return narrow.length >= 2 || (sp.length > 0 && best.shared.length / sp.length >= 0.5);
}
function sameLine(a, b) {
  const f = (t) => strip(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const x = f(a), y = f(b);
  return !!x && !!y && (x === y || (x.length >= 30 && y.startsWith(x.slice(0, 60))) || (y.length >= 30 && x.startsWith(y.slice(0, 60))));
}

/** The posting's statements: the reader's (`ctx.fit.statements`) when present, else built from duty lines and the verdict. */
export function postingStatements(ctx, duties = []) {
  const fromReader = Array.isArray(ctx.fit?.statements) && ctx.fit.statements.length ? ctx.fit.statements : null;
  const out = [];
  if (fromReader) {
    for (const s of fromReader) out.push({ id: s.id, text: labelToDuty(clean(s.text, 200), duties), verdictText: clean(s.text, 600), display: s.display !== false, status: s.status, evidence: (s.evidence || []).map((e) => e.line).filter(Boolean), evWhys: (s.evidence || []).filter((e) => e.line).map((e) => clean(e.why, 240)), whys: (s.evidence || []).filter((e) => !e.line && e.why).map((e) => clean(e.why, 240)), missing: s.missing || [], kind: s.kind, importance: s.importance, reader: true, ...(s.by ? { by: s.by, youWhy: clean(((s.evidence || []).find((e) => e && e.why) || {}).why, 240) } : {}), ...(s.candidate && s.candidate.line ? { candidate: { line: s.candidate.line, why: s.candidate.why || '' } } : {}) });
  } else {
    for (const r of ctx.requirements || []) {
      if (!r.posting) continue;
      const prev = out.find((x) => x.text === clean(r.posting, 200));
      if (prev) { if (r.matched && !r.inferred) { prev.evidence.push(r.evidence); prev.status = prev.status === 'not_shown' ? 'partly' : prev.status; } else if (!r.matched) { prev.missing.push(r.label); if (prev.status === 'shown') prev.status = 'partly'; } continue; }
      out.push({ id: `r${out.length}`, text: clean(r.posting, 200), status: r.matched && !r.inferred ? 'shown' : r.matched ? 'partly' : 'not_shown', evidence: r.matched && r.evidence ? [r.evidence] : [], missing: r.matched ? [] : [r.label], kind: 'requirement', importance: r.importance, reader: false });
    }
  }
  // duty lines the reader did not turn into a statement still name work the interview will ask about
  for (const d of duties) {
    if (out.some((s) => overlap(s.text, d.text) >= 0.6)) continue;
    out.push({ id: `d${out.length}`, text: clean(d.text, 200), status: 'cannot_tell', evidence: [], missing: [], kind: 'duty', importance: 'duty', reader: false });
  }
  // the verdict's own displayed statements always stand (the job-match section prints them); drafts use real ones
  return out.filter((s) => (s.reader && s.display) || (!s.reader && realStatement(s.text)) || (s.reader && !s.display && false));
}
// a "missing" item worth saying out loud: a requirement the fit check reads as missing, said as a thing (never a duty's
// verb — "reconcile", "educate" — nor who the work is for — "cardiologists", "associates")
function realMissing(ctx, m) {
  const t = String(m || '').trim();
  if (!t || baseVerb(t.split(/\s+/)[0]) || /^(?:associates?|team members?|staff|employees?|customers?|agents?|users?|students?|patients?)\b/i.test(t) || /^(?:associates?|team(?: members?)?|staff|employees?|customers?|guests?|clients?|members?|people|agents?|students?|patients?|users?)$/i.test(t) || /(?:ists?|ians?|ors|ers)$/i.test(t) && t.split(/\s+/).length === 1) return false;
  if (/^one of\b/i.test(t)) return true;
  if (/\b(?:manager|director|supervisor|team|department|vp|officer|president)$/i.test(t)) return false;
  return (ctx.requirements || []).some((r) => !r.matched && !r.soft && r.label.toLowerCase() === t.toLowerCase());
}
// a statement that is only a section label ("Coaching & Development") reads as the duty line it heads, when the posting
// has one ("Coaching & Development: Train and develop the Student Chief Officers …")
function labelToDuty(text, duties) {
  if (text.split(/\s+/).length > 4 || verbOf(text) || !/^[A-Z]/.test(text)) return text;
  const d = duties.find((x) => clean(x.sentence).toLowerCase().startsWith(`${text.toLowerCase()}:`));
  return d ? clean(d.text, 200) : text;
}
function overlap(a, b) {
  const x = specific(stemsOf(a)), y = new Set(specific(stemsOf(b)));
  if (!x.length || !y.size) return 0;
  return x.filter((w) => y.has(w)).length / Math.min(x.length, y.size);
}
/**
 * A statement a person would say: a noun or verb phrase of 2–25 words that ends on a content word. A fragment
 * ("observable behaviors", "less than 1", "Employment is contingent upon") never gets a row, a question or a script.
 */
export function realStatement(text) {
  const t = clean(text);
  const ws = t.split(/\s+/);
  if (ws.length < 2 || ws.length > 28) return false;
  if (/\b(?:and|or|of|in|with|to|for|at|by|on|the|a|an|as|from|such|like|including|than|that|which|who|is|are|be|will|can)$/i.test(t.replace(/[.,;:!)]+$/, ''))) return false;
  if (/^(?:and|or|of|in|with|to|for|at|by|on|as|from|than|that|which|who|is|are|be|will|employment|this|these|those|it|its|they|there|our|we|you|if|when|please|apply|click|equal|eeo|more|most|leveling|an ideal|the ideal|minimum requirements|preferred qualifications|what you|who you|about)\b/i.test(t)) return false;
  // a sentence that describes the job instead of asking for something ("The role of the professional clinical nurse is …")
  if (/^(?:the|a|an)\s+(?:[\w’'-]+\s+){0,5}(?:is|are|demonstrates|will be|has been|plays|serves as)\b/i.test(t)) return false;
  // a company blurb ("Samsara (NYSE: IOT) sits at the center of …", "The fastest-growing divisions at Samsara are …")
  if (/\b(?:sits at|is (?:a|an|the) (?:leading|global|fast-growing|premier)|are tackling|we are|is in full growth|has spent|set us apart|fastest-growing)\b/i.test(t)) return false;
  if (/https?:|@|\$\s?\d|\b(?:benefits?|bonus|retention|sign-on|401\(?k|pto|dental|vision|insurance|equal opportunity|background check|drug (?:test|screen)|reimburse\w*|stipend|paid time off|continuous service|sabbatical|tenure award)\b/i.test(t)) return false;
  return /[a-z]{3,}/i.test(t);
}

// ── Saying a posting statement inside a sentence ────────────────────────────────────────────────────────────────
const LEAD_IN = /^(?:\d+\s*(?:[-–]|to)\s*\d+\+?\s*years?\s+(?:of\s+)?|\d+\+?\s*years?\s+(?:of\s+)?|(?:strong|proven|demonstrated|excellent|solid|hands-on|working|basic|advanced)\s+|(?:experience|proficiency|knowledge|familiarity|expertise|comfort)\s+(?:with|in|of|using|on)\s+(?:an?\s+|the\s+)?|(?:the\s+)?ability\s+to\s+|(?:experience|background)\s+(?=[a-z]+ing\b))+/i;
/** The head clause of a duty line: never a slice across a colon, "using", "including", "on the spot" or "when we …". */
function headClause(text) {
  let t = String(text || '');
  const hc = t.match(/^((?:\S+\s+){0,5}\S+?):\s+\S/);
  if (hc && verbBase(hc[1].split(/\s+/)[0].toLowerCase())) t = hc[1];
  return t.split(/\s+(?:using|including|incl\.?|via|on the spot|when (?:we|you|needed|necessary|the|it|they)\b)(?:\s+|$)/i)[0];
}
/** The duty or requirement as a phrase that can stand as the subject of a sentence ("coaching agents through …"). */
export function dutySubject(text, max = 12) {
  // a requirement line led by "Experience with…" names a thing, never a duty to turn into -ing ("call center platform")
  const thing = LEAD_IN.test(clean(text).replace(/^(?:[A-Z][\w&/-]*\s*){1,4}:\s+/, '')) && !/^(?:the\s+)?ability\s+to\b/i.test(clean(text));
  let t = clean(text).replace(/[.;:!]+$/, '')
    // idioms are one word ("end to end", "day to day")
    .replace(/\b(end to end|day to day|face to face|one on one|side by side|start to finish|step by step)\b/gi, (m) => m.replace(/\s+/g, '-'))
    // "Talent Pipeline: Interview and hire …", "Guest Experience: Conduct …" — the duty is what follows the label
    .replace(/^(?:[A-Z][\w&/-]*\s*){1,4}:\s+(?=\S)/, '')
    .replace(/\s+(?:is|are)\s+(?:a\s+)?(?:strongly\s+)?(?:preferred|required|a plus|desired)$/i, '').replace(/,?\s+(?:preferred|required|a plus|is a plus|a bonus|nice to have)$/i, '')
    .replace(LEAD_IN, '')
    .replace(/^(?:effectively|consistently|regularly|actively|proactively|independently|accurately|efficiently|promptly|safely)\s+/i, '');
  // the HEAD clause only (director round 7): "Run the shift: assign stations, …" → "run the shift"; "Open or close the
  // restaurant using our checklists, including …" → "open or close the restaurant"; "Resolve guest complaints on the spot
  // and remake orders when we get it wrong" → "resolve guest complaints" — never a slice across the punctuation
  t = headClause(t);
  // cut at the first clause break, then at most `max` words, never ending on a joining word
  const verbs0 = /^\S+(?:\s+\S+){0,2},\s+(?:and\s+)?(?:\w+ly\s+)?([a-z]+)\b/.exec(t);
  const isVerbList = !!(verbs0 && baseVerb(verbs0[1]));
  t = t.split(isVerbList ? /;\s+|\s+(?:in order to|to ensure|ensuring|while maintaining|so that)\s+|\s*\(/i : /,\s+(?=(?:and |as well as |including |to |ensuring |while |from |with |such as ))|;\s+|\s+(?:in order to|to ensure|ensuring|while maintaining|so that|so (?=[a-z]+\s))\s*|\s*\(/i)[0];
  // "Partner with team leads and quality assurance to find skill gaps": the duty is what comes before its purpose
  { const m = t.match(/^((?:\S+\s+){3,}?\S+)\s+to\s+([a-z]+)\b/); if (m && baseVerb(m[2]) && !/\b(?:how|what|when|where|whether|why)$/i.test(m[1])) t = m[1]; }
  // a list of examples after "such as" is the posting's, kept short
  t = t.replace(/\s+such as\s+(.+)$/i, (m, list) => { const items = list.split(/,\s*|\s+or\s+|\s+and\s+/).filter(Boolean); return items.length > 2 ? ` such as ${items.slice(0, 2).join(' or ')}` : m; });
  let ws = t.split(/\s+/);
  // a list of verbs sharing one object ("Follow up with, execute, and properly document doctors' orders") is said whole
  const verbList = /,\s+(?:and\s+)?(?:\w+ly\s+)?([a-z]+)\b/.exec(t);
  if (verbList && baseVerb(verbList[1]) && ws.length <= max + 4) max = ws.length;
  if (ws.length > max) {
    // a list after a comma ("training materials, job aids and e-learning modules") is cut to its first item
    const comma = ws.findIndex((w, i) => (i >= 2 || (i === 1 && verbBase(ws[0].toLowerCase()))) && i < max && /,$/.test(w) && !/^(?:with|on|to|for|of|in|at|by|from|up),$/i.test(w));
    // else cut before the first joining word ("delivering new-hire training | for classes of 10-15 …"), never mid-noun
    let cut = -1;
    for (let i = 3; i <= Math.min(max, ws.length - 1); i++) if ((/^(?:for|of|from|with|through|across|against|about|over|under|per|after|before|during|around|in|on|to|at|by|into|including|such|while|using|via|within)$/i.test(ws[i]) || (/^and$/i.test(ws[i]) && baseVerb(ws[i + 1] || ''))) && !/^(?:how|what|when|where|whether|why)$/i.test(ws[i - 1] || '') && !/^(?:how|what|when|where|whether|why)$/i.test(ws[i + 1] || '')) { cut = i; break; }
    ws = comma > 0 ? ws.slice(0, comma + 1) : cut > 0 ? ws.slice(0, cut) : ws.slice(0, max);
    // a cut list never ends on half a pair ("the folder structures and naming")
    if (cut < 0 && comma < 0 && ws.length > 3 && /^(?:and|or|&)$/i.test(ws[ws.length - 2])) ws = ws.slice(0, -2);
    // never end on a clause left open ("…that check whether learners can do")
    const open = ws.findIndex((w, i) => i >= 2 && /^(?:that|which|whether|who|where|when|so|if)$/i.test(w));
    if (cut < 0 && comma < 0 && open > 0) ws = ws.slice(0, open);
    ws[ws.length - 1] = ws[ws.length - 1].replace(/,$/, '');
  }
  while (ws.length > 2 && /^(?:and|or|of|in|with|to|for|at|by|on|the|a|an|as|from|such|like|including|than|that|which|who|is|are|be|will|can|your|our|their|its)$/i.test(ws[ws.length - 1])) ws.pop();
  let out = ws.join(' ').replace(/[,;:]+$/, '').replace(/\s+(?:on|about|in|of)\s+how(?:\s+to(?:\s+\w+)?)?$/i, '');
  // a Title-Case heading said in a sentence reads in lower case ("Coaching & Development" → "coaching and development")
  if (/^(?:[A-Z][a-z]+|&|and|of)(?:\s+(?:[A-Z][a-z]+|&|and|of))+$/.test(out) && /\s(?:&|and)\s/.test(out)) out = out.toLowerCase().replace(/\s&\s/g, ' and ');
  if (thing) return /^[A-Z][a-z]+\b/.test(out) && !/^[A-Z][a-z]+\s+[A-Z]/.test(out) && /\s/.test(out) ? out.charAt(0).toLowerCase() + out.slice(1) : out;
  return gerundPhrase(out);
}
// the thing a duty acts on, said as a noun phrase ("new-hire training", "trainee progress", "the training materials")
export function dutyObject(text) {
  const t = headClause(clean(text).replace(/[.;:!]+$/, '').replace(LEAD_IN, ''));
  const ws = t.split(/\s+/);
  let i = 0;
  // a verb only at the start or after "and" / a comma ("Pack and ship orders": "orders" is the object, not a verb)
  while (i < ws.length && ((verbBase(ws[i].replace(/,$/, '').toLowerCase()) && !/(?:ing|ed)$/i.test(ws[i]) && (i === 0 || /^(?:and|or|&)$/i.test(ws[i - 1]) || /,$/.test(ws[i - 1]))) || /^(?:and|or|&)$/i.test(ws[i]))) i++;
  if (!i) return '';
  // "Follow up with, execute, and document doctors' orders": the object comes after the last verb of the list
  const lastVerb = ws.reduce((k, w, j) => (j >= i && baseVerb(w.replace(/,$/, '').toLowerCase()) && !/(?:ing|ed|s)$/i.test(w.replace(/,$/, '')) ? j : k), -1);
  // (only a list of verbs: every comma-ended word before it is a verb or a particle — "prep lists, inventory and …"
  // is a list of things)
  const commaWs = ws.slice(i, lastVerb).filter((w) => /,$/.test(w)).map((w) => w.replace(/,$/, '').toLowerCase());
  if (lastVerb >= i && commaWs.length && commaWs.every((w) => (baseVerb(w) === w && !/^(?:lists?|inventory|orders?|records?|reports?)$/.test(w)) || /^(?:with|up|on|to|for|out|in)$/.test(w))) i = lastVerb + 1;
  // a particle of the verb ("put away inventory") belongs to the verb when a noun follows it
  if (/^(?:away|down|back|out|off|up)$/i.test(ws[i] || '') && ws[i + 1] && !/^(?:with|to|for|on|in|at|of|from|by)$/i.test(ws[i + 1])) i++;
  if (/^(?:up|out|off|in|on|with|to|for|over|through|back)$/i.test(ws[i] || '')) return '';
  const rest = ws.slice(i).join(' ').split(/\s+(?:for|with|through|from|to|across|by|on|at|in|into|so|while|according|based|per|as needed|as directed|and report|and build|and ensure)\s+|\s+(?:according|as needed|as directed)$|\s+(?:that|which|who|whether)\s+|,\s*/i)[0].replace(/^(?:the|a|an|all|any|our|your)\s+/i, '');
  const n = rest.split(/\s+/).length;
  // "the warehouse clean and organized" is a state to keep, not a thing (never "Where do warehouse clean and organized slip")
  if (STATE_END.test(rest)) return '';
  return n >= 1 && n <= 6 && !/^(?:and|or)$/i.test(rest) ? rest : '';
}
const verbOf = (text) => { const w = clean(text).replace(LEAD_IN, '').split(/\s+/)[0] || ''; return verbBase(w.replace(/,$/, '').toLowerCase()) || ''; };
// a phrase that ends on a state ("clean and organized", "safe", "accurate") names a condition to keep, not an object
const STATE_END = /\b(?:clean|organi[sz]ed|safe|accurate|tidy|neat|current|secure|ready|compliant|available|stocked|up to date|up-to-date|in order)$/i;
/** The duty said in its base form ("keeping the warehouse clean" → "keep the warehouse clean"), for "How do you …?". */
export function dutyBase(text, max = 10) {
  const g = dutySubject(text, max);
  if (!g) return '';
  return g.replace(/(^|\b(?:and|or)\s+|,\s+)([a-z]+ing)\b/g, (m, pre, w) => { const b = baseFromGerund(w, KNOWN_VERBS) || ingBase(w); return b ? `${pre}${b}` : m; });
}
/**
 * The part of a statement the verdict reads as missing, said from the STATEMENT's own words (never the bare fragment
 * the reader stopped at): a verb of the duty with its object as -ing ("put away" → "putting away inventory"), or a noun
 * phrase of the statement with the noun it modifies ("line cook" → "line cook experience"). { text, kind } or null.
 */
export function missingPhrase(st) {
  const text = clean(st.verdictText || st.text).replace(/[.;:!]+$/, '').replace(LEAD_IN, '');
  const obj = dutyObject(text);
  const head = obj && text.toLowerCase().indexOf(obj.toLowerCase()) > 0 ? text.slice(0, text.toLowerCase().indexOf(obj.toLowerCase())) : '';
  // `missing` already written as the duty's actions with their object ("receiving inventory; putting away inventory",
  // the verdict's round-3 wording): each phrase is the statement's own words, so it is said as it stands, joined on one object
  const ingMs = (st.missing || []).flatMap((m) => String(m || '').split(/;\s*/)).map((m) => m.trim()).filter((m) => /^[a-z]+ing\b/i.test(m) && m.split(/\s+/).length >= 2 && m.split(/\s+/).length <= 5 && !/,/.test(m) && ((ws) => new Set(ws).size === ws.length)(m.toLowerCase().split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)).map(stem)) && !/\b(?:your|our)\b/i.test(m) && stemsOf(m.split(/\s+/).map((w) => (/ing$/i.test(w) ? ingBase(w.toLowerCase()) || w : w)).join(' ')).every((w) => stemsOf(text).includes(w)));
  if (ingMs.length && ingMs.length <= 2) {
    const objs = ingMs.map((m) => m.split(/\s+/).pop().toLowerCase());
    const joined = ingMs.length > 1 && objs.every((o) => o === objs[0]) ? `${joinList(ingMs.map((m) => m.split(/\s+/).slice(0, -1).join(' ')))} ${objs[0]}` : joinList(ingMs);
    return { text: joined.toLowerCase(), kind: 'gerund' };
  }
  for (const m0 of st.missing || []) {
    const m = String(m0 || '').trim().replace(/\b(\S+)\s+\1\b/gi, '$1');
    if (m.length < 3 || /^(?:one|two|\d[\d\s+-]*)$/i.test(m)) continue;
    // the duty's own object ("inventory records" of "Maintain accurate inventory records"): the whole duty is missing
    if (obj && head && obj.toLowerCase().includes(m.toLowerCase()) && m.toLowerCase().endsWith(obj.toLowerCase().split(/\s+/).pop())) { const d = dutySubject(text, 10); if (d && d.split(/\s+/).length >= 2) return { text: d, kind: 'gerund' }; }
    // a verb (or verb + particle) from the duty's leading list of verbs
    const inHead = head && new RegExp(`(?:^|\\s)${escapeRegExp(m)}(?:\\s|$)`, 'i').test(` ${head} `);
    const leadsHead = head && new RegExp(`(?:^|\\s)${escapeRegExp(m.split(/\s+/)[0])}(?:\\s|$)`, 'i').test(` ${head} `) && obj && m.toLowerCase().endsWith(obj.toLowerCase().split(/\s+/).pop());
    if ((inHead || leadsHead) && verbBase(m.split(/\s+/)[0].toLowerCase())) {
      const p = gerundPhrase(inHead ? `${m.toLowerCase()} ${obj}` : m.toLowerCase());
      if (p && p.split(/\s+/).length >= 2) return { text: p, kind: 'gerund' };
    }
    // a noun phrase of the statement, with the noun after it
    // ("one-on-one" → "one-on-one performance feedback": the words after it up to a joining word or a comma)
    const hit = text.match(new RegExp(`\\b(${escapeRegExp(m)})((?:\\s+(?!(?:to|for|in|on|at|with|and|or|of|from|by|after|before|during|through|across|as|that|which|such|like|including|preferred|required)\\b)[A-Za-z][\\w'-]*){0,3})`, 'i'));
    // (one abstract word — "adherence" — is no phrase to say; a name — Epic, Toast — is)
    if (hit && !STATE_END.test(m) && (m.split(/\s+/).length >= 2 || /^[A-Z]/.test(m) || hit[2]) && `${hit[1]}${hit[2] || ''}`.split(/\s+/).length <= 4 && !/\b(?:your|our)\b/i.test(`${hit[1]}${hit[2] || ''}`) && ((ws) => new Set(ws).size === ws.length)(m.toLowerCase().split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)).map(stem)) && !(m.split(/\s+/).length === 1 && verbBase(m.toLowerCase())) && !(text.toLowerCase().indexOf(m.toLowerCase()) === 0 && verbBase(m.split(/\s+/)[0].toLowerCase()) && obj && !m.toLowerCase().includes(obj.toLowerCase().split(/\s+/)[0]))) {
      // with the modifier or article just before it in the statement ("weekly food orders", "a visualization tool")
      const pre = (text.slice(0, hit.index).match(/\b(?:(?:a|an|the)\s+)?(?:weekly|daily|monthly|annual|yearly|basic|current)\s+$|\b(?:a|an|the)\s+$/i) || [''])[0];
      const p = `${pre.toLowerCase()}${hit[1]}${hit[2] || ''}`;
      return { text: /^[A-Z][a-z]/.test(p) && !/^[A-Z][a-z]+\s+[A-Z]/.test(p) && !/^[A-Z]{2,}/.test(p) && text.indexOf(p) === 0 ? lcFirst(p) : p, kind: 'noun' };
    }
  }
  return null;
}

// What only the person can add, by the kind of duty (one short prompt, lower case — it sits inside a sentence).
// The object of the duty decides first (one-on-one feedback, materials, a session, what is measured), then its verb.
const DUTY_OBJECT_BLANK = [
  [/\b(?:findings|insights|recommendations)\b/i, 'the one point you would lead with, and how you would check it landed'],
  [/\b(?:feedback|coach\w*|1:1s?|one[- ]on[- ]ones?|mentor\w*|performance (?:reviews?|conversations?))\b/i, 'what you would listen for first, and how you would say it'],
  [/\b(?:document\w*|outcomes?|track\w*|report\w*|measur\w*|metrics?|progress|proficiency|analy[sz]\w*|data)\b/i, 'what you would measure first, and why'],
  [/\b(?:materials?|job aids?|exercises|content|curricul\w*|modules?|guides?|scripts|playbooks?|e-?learning|courses?|lessons?)\b/i, 'the first piece you would build or fix, and why'],
  [/\b(?:training|sessions?|classes|workshops?|onboarding|nesting|orientation)\b/i, 'how you would open the first session, and how you would check it landed'],
];
const DUTY_BLANK = [
  [/^(?:coach|mentor|precept|counsel)$/, 'what you would listen for first, and how you would say it'],
  [/^(?:deliver|train|teach|facilitate|present|instruct|educate|host)$/, 'how you would open the first session, and how you would check it landed'],
  [/^(?:lead|run|conduct)$/, 'how you would set it up, and how you would keep it on track'],
  [/^(?:create|build|design|develop|write|draft|improve|update|revise|produce|make|prepare)$/, 'the first piece you would build or fix, and why'],
  [/^(?:track|report|measure|monitor|analy[sz]e|review|evaluate|assess|audit|document)$/, 'what you would measure first, and why'],
  [/^(?:partner|collaborate|coordinate|work|liaise|communicate|support|assist|help)$/, 'who you would talk to first, and what you would ask them'],
  [/^(?:maintain|ensure|comply|inspect|verify|check|follow|enforce|keep)$/, 'what you would check first, and how often'],
  [/^(?:manage|supervise|oversee|direct|own|plan|schedule|organi[sz]e|prioriti[sz]e)$/, 'what you would set up in your first month'],
  [/^(?:sell|close|prospect|generate|grow|drive|upsell)$/, 'the first accounts or customers you would go after, and why'],
  [/^(?:resolve|handle|answer|respond|troubleshoot|diagnose|repair|fix|investigate)$/, 'the first thing you check, and when you escalate'],
  [/^(?:care|administer|chart)$/, 'what you check first, and when you call for help'],
];
export function dutyBlank(text) {
  const head = clean(text).replace(/\s*\([^)]*\)/g, '').replace(LEAD_IN, '').split(/\s+(?:to|so|in order to|while|that|which|who)\s+/)[0];
  const v = verbOf(text);
  // the duty's own verb decides when it names the work ("Measure course results … learner feedback" is measuring)
  // ("drive" or "grow" is selling only when the duty names sales — "Drive accurate and timely monthly close" is not)
  const salesVerb = /^(?:drive|grow|generate)$/.test(v) && !/\b(?:sales|revenue|leads|accounts|customers|clients|deals|pipeline|bookings)\b/i.test(text);
  const byVerb = v && !salesVerb && !/^(?:provide|give|support|help|do|perform|handle|assist|work|ensure)$/.test(v) ? DUTY_BLANK.find(([re]) => re.test(v)) : null;
  if (byVerb) return byVerb[1];
  const o = DUTY_OBJECT_BLANK.find(([re]) => re.test(head));
  if (o) return o[1];
  const hit = salesVerb ? null : DUTY_BLANK.find(([re]) => re.test(v));
  return hit ? hit[1] : 'what you would do first here, and why';
}
// What only the person can add to a story, by what the QUESTION asks (never another requirement's words).
const STORY_BLANK = [
  [/\b(?:hardest|difficult|angry|upset|frustrated|rude|demanding)\s+(customer|guest|patient|client|caller|member|parent|student)/i, (m) => `the ${m[1].toLowerCase()} you remember: what they needed, and how it ended`],
  [/\b(?:caught|change in (?:a |the )?(?:patient|client|resident)'?s? condition|deteriorat)/i, () => 'the change you caught: what you noticed first, and who you called'],
  [/\b(?:mistake|got (?:a |something |one )?(?:detail )?wrong|went wrong|failed|failure)\b/i, () => 'what went wrong, how you found it, and what you changed after'],
  [/\b(?:disagree\w*|pushed back|conflict)\b/i, () => 'what the other person wanted, how you made your case, and how it was settled'],
  [/\b(?:system you built|trade-?offs?)\b/i, () => 'the trade-off you made, and what you see differently now'],
  [/\b(?:incident|outage|broke|production issue)\b/i, () => 'what broke, how you found the cause, and what you changed so it would not happen again'],
  [/\b(?:behind|deadline|under pressure|short[- ]staffed|rush|peak|busy)\b/i, () => 'what was behind, the moves you made, and where you ended up'],
  [/\b(?:led people|ran a shift|led a team|lead a team|led (?:a|the) (?:crew|team|shift))\b/i, () => 'the week that tested the team: what happened, and what you did'],
  [/\b(?:train|coach|mentor|onboard|teach)/i, () => 'one person you trained: where they started, and how you knew they were ready'],
  [/\bdid well\b/i, () => 'what made it go well, and how you knew it had'],
  [/\b(?:built|set up)\b.*\b(?:others|people)\b.*\bused\b|\bsomething you built\b/i, () => 'why it was needed, who used it, and the hardest part of building it'],
  [/\banalysis\b.*\bdecision\b|from the question to/i, () => 'the question you started with, what the data showed, and the decision it changed'],
  [/\b(?:improv|increas|grew|cut|reduc|result|proud)/i, () => 'what you changed first, and who you had to get on board'],
  [/\b(?:safe|safety)\b/i, () => 'the moment the pace went up, and what you did to keep people safe'],
  [/\b(?:customer|guest|patient|client|caller)\b/i, (m) => `one ${m[0].toLowerCase()} you remember: what they needed, and how it ended`],
];
function storyBlank(q) {
  for (const [re, f] of STORY_BLANK) { const m = String(q).match(re); if (m) return f(m); }
  // the question's own words: "Tell me about a time you went above and beyond for a member" → "the time you went above…"
  const first = String(q).split(/(?<=[.?])\s+(?=[A-Z])/)[0];
  const t = first.match(/\b(?:a time|an example of (?:a time )?when|a situation where|when|something|one thing)\s+(you\s+.+?)[.?]?$/i);
  if (t && t[1].split(/\s+/).length <= 14) return `the time ${t[1].replace(/\?$/, '')}: what was going on, and how it ended`;
  return 'the moment itself: what was going on, what you did, and how it ended';
}

// ── The question's form decides the answer's shape (coordinator round 5) ─────────────────────────────────────────
// experience — "Tell me about a time you…", "Have you done X before? Walk me through a shift.", "Tell me about your
//   experience with X", a behavioural question: told in the past or present about what the person DID; its one blank
//   asks for the moment, never for a plan.
// plan — "How would you X here?", "Walk me through how you'd approach X", "What would X look like in your first
//   month here?": the only form that gets "I'd start with"; its blank never asks for a memory.
// practice — "What do you check before X?", "How do you keep X accurate…": what the person does as a habit.
export function questionForm(q) {
  const t = String(q || '').trim();
  if (/^(?:Tell me about (?:a time|your experience with|the|one|something)|Have you (?:done|ever|worked)|Describe a (?:time|situation)|Give (?:me )?an example|When have you|Talk about a time|Think of a time)\b/i.test(t) || /\bWalk me through a shift\.?$/i.test(t) || BEHAVIORAL.test(t)) return 'experience';
  if (/^(?:How would you|What would you|Walk me through how you'd|What would .+ look like|If you (?:were|took|joined|started)|Imagine)\b/i.test(t) || /\bhere\?$/.test(t)) return 'plan';
  return 'practice';
}
// a blank that asks for a plan, and one that asks for a memory (the validator keeps each out of the other form)
const PLAN_BLANK_RE = /\b(?:you would|you'd|would you)\b/i;
const PLAN_LEAD_RE = /\b(?:I'd (?:start|begin) with|first step would be|starting with|first move would be|I'd begin with)\s*$/i;
const MEMORY_BLANK_RE = /\b(?:remember|the time you|one time you|a time you|the moment|you came closest|you have done .+ yourself)\b/i;

// What only the person can add, per form, by the kind of work. Each kind has more than one wording so one pack never
// repeats a prompt more than twice (coordinator round 5: six of twelve answers ended on the same blank).
const KIND = [
  ['load', /\b(?:load\w*|unload\w*|trucks?|trailers?)\b/i],
  ['receive', /\b(?:receiv\w*|put(?:ting)? away|putaway|restock\w*|replenish\w*|deliver(?:y|ies))\b/i],
  // a supply order (pars, waste, a vendor's cut-off) is not a customer's order
  ['supply', /\b(?:pars?|vendors?|suppl(?:y|ies)|(?:food|paper|supply|stock|truck|weekly|daily) (?:and paper )?orders?|purchas\w*|re-?order\w*|waste)\b/i],
  // ("packages", "relationships", "picky" are not warehouse words)
  ['ship', /\b(?:pick(?:s|ed|ing|er|ers)?|pack(?:s|ed|ing|er|ers)?|ship(?:s|ped|ping|ment|ments)?|orders?)\b/i],
  ['count', /\b(?:inventor\w*|counts?|scan\w*|label\w*|records?|stock)\b/i],
  ['train', /\b(?:onboard\w*|train\w*|teach\w*|taught|new[- ]hires?|instruct\w*|facilitat\w*|classes|sessions?)\b/i],
  ['coach', /\b(?:coach\w*|feedback|1:1s?|one[- ]on[- ]ones?|mentor\w*|precept\w*)\b/i],
  ['case', /\b(?:escalat\w*|complaints?|resolv\w*|disputes?|refunds?|issues?|tickets?)\b/i],
  ['patient', /\b(?:patients?|vital|medicat\w*|assess\w*|chart\w*|care plans?|clinical|acute|nursing|bedside)\b/i],
  ['sale', /\b(?:sell\w*|sales|sold|upsell\w*|quota|deals?|prospect\w*)\b/i],
  ['schedule', /\b(?:schedul\w*|staffing|coverage|rosters?)\b/i],
  ['lead', /\b(?:lead|led|supervis\w*|run (?:a |the )?shift|ran|manag\w* (?:a |the )?(?:team|staff|crew))\b/i],
  ['cook', /\b(?:cook\w*|prep\w*|grill|plat\w*|kitchen|food|menu|recipes?)\b/i],
  ['tidy', /\b(?:clean\w*|organi[sz]\w*|safe\w*|5S|hazard\w*|sanitat\w*)\b/i],
  ['measure', /\b(?:track\w*|report\w*|measur\w*|metrics?|analy[sz]\w*|data|dashboards?|insights?)\b/i],
  ['build', /\b(?:writ\w*|wrote|creat\w*|build\w*|built|design\w*|develop\w*|materials?|content|guides?|articles?|curricul\w*|modules?)\b/i],
  ['fix', /\b(?:repair\w*|troubleshoot\w*|diagnos\w*|install\w*|fix(?:es|ing)?|maintenance)\b/i],
  ['people', /\b(?:customers?|guests?|callers?|clients?|members?|shoppers?)\b/i],
];
const VERB_KIND = [
  [/^(?:create|build|develop|write|draft|improve|update|revise|design|produce|prepare)$/, 'build'],
  [/^(?:track|report|measure|monitor|analy[sz]e|evaluate|assess|audit|document)$/, 'measure'],
  [/^(?:coach|mentor|precept|counsel)$/, 'coach'],
  [/^(?:educate)$/, 'educate'], [/^(?:present)$/, 'present'], [/^(?:check|inspect|verify|taste|test)$/, 'quality'], [/^(?:deliver|train|teach|facilitate|instruct|onboard)$/, 'train'],
  [/^(?:load|unload)$/, 'load'], [/^(?:receive|stock|restock|replenish|store)$/, 'receive'], [/^(?:pick|pack|ship|sort)$/, 'ship'],
  [/^(?:scan|label|count)$/, 'count'], [/^(?:schedule|staff)$/, 'schedule'], [/^(?:lead|supervise|run)$/, 'lead'],
  [/^(?:resolve|handle|answer|respond|troubleshoot)$/, 'case'], [/^(?:sell|close|prospect|upsell)$/, 'sale'],
  [/^(?:partner|collaborate|coordinate|liaise|work)$/, 'partner'], [/^(?:clean|organi[sz]e|sanitize)$/, 'tidy'], [/^(?:repair|install|diagnose|fix)$/, 'fix'], [/^(?:cook|prep|plate|grill)$/, 'cook'],
];
const kindOf = (t) => (KIND.find(([, re]) => re.test(String(t || ''))) || [''])[0];
const MOMENT = {
  load: ['one trailer you remember: how you staged it, and what you checked before it left', 'the busiest truck you loaded: how you planned it, and how it went'],
  receive: ['one delivery you remember: what came in, where it went, and what you checked', 'a delivery that did not match the paperwork: what you noticed, and what you did'],
  ship: ['one order you remember: what it needed, and how you checked it before it went out', 'an order that almost went out wrong: what you caught, and how'],
  count: ["one count that didn't match: how you found the gap, and what you fixed", 'a time the system and the shelf disagreed: what you checked, and what it turned out to be'],
  train: ['one person you trained: where they started, and how you knew they were ready', 'a session that did not land at first: what you noticed, and what you changed'],
  coach: ['one conversation you remember: what you noticed, what you said, and what changed', 'someone you coached who pushed back: what you said, and where it ended up'],
  case: ['one case you remember: what went wrong, and how you settled it', 'the hardest one you handled: what they needed, and how it ended'],
  patient: ['one patient you remember: what you noticed first, and what you did', 'a shift when a patient changed fast: what you saw, and who you called'],
  sale: ['one sale you remember: who it was, and how you closed it', 'a deal that nearly slipped: what was in the way, and what you did'],
  schedule: ['one week you scheduled: what was tight, and how you covered it', 'a call-out you had to cover: who you moved, and what you dropped'],
  lead: ['one shift you ran: what went sideways, and what you did', 'a week that tested the team: what happened, and how you kept it moving'],
  cook: ['one rush you remember: what you were on, and how you kept the line moving', 'a night the kitchen fell behind: what you did first, and how it ended'],
  tidy: ['one time something was out of place or unsafe: what you saw, and what you did', 'the habit you keep on a busy day, and one time it mattered'],
  measure: ['one number you tracked: what it showed, and what you did about it', 'a report that changed a decision: what it showed, and who acted on it'],
  build: ['one piece you built: who it was for, and what changed after', 'what changed once people used it, and what you would build differently now', 'something you rewrote because it was not working: what was wrong, and what you changed'],
  fix: ['one job you remember: what was wrong, how you found it, and how you fixed it', 'a fault that took more than one try: what you checked, and what it was'],
  present: ['one time you presented to people senior to you: what you led with, and what they asked', 'a finding you had to explain to someone outside your field: how you said it, and what they did with it'],
  quality: ['one time you caught something before it went out: what was wrong, and what you did', 'a check that slowed you down but mattered: what you found'],
  educate: ['one patient or family you taught: what they needed to know, and how you checked they understood', 'a time someone did not understand the first time: what you changed in how you explained it'],
  supply: ['one order you placed that came in short or over: what you changed in the pars', 'the week waste ran high: what you noticed, and what you changed in the order'],
  partner: ['one time you worked with another team on a problem: who they were, what each of you brought, and what changed', 'a time you and another team saw the cause differently: how you settled it'],
  people: ['one person you helped who you remember: what they needed, and how it ended', 'someone who was upset when they came to you: what you said, and how it ended'],
};
const SHIFT = {
  load: 'how a loading shift runs for you: what you check first, how you stage, and what you count at the end',
  receive: 'how a receiving shift runs for you: what you check when a truck comes in, and where it all goes',
  ship: 'how a packing shift runs for you: how you start, how you check each order, and what you count at the end',
  count: 'how a counting shift runs for you: where you start, and what you do when a count is off',
  cook: 'how a service runs for you: what you set up first, and how you keep up in the rush',
  tidy: 'how you keep your area in order through a shift: what you do first, and what you check before you leave',
};
const PRACTICE = {
  count: (o) => [`the habit that keeps ${o || 'the counts'} accurate when it's busy, and how you catch a miss`, `what you check twice on ${o || 'a busy day'}, and why`],
  tidy: (o) => [`what you do when the pace goes up: what you slow down, and what you never skip${o ? ` with ${o}` : ''}`, 'the one habit you keep on a busy shift, and one time it mattered'],
};
// the plan prompt, said about the duty's own object (never the same "what you would do first here" on every question)
const PLAN = {
  supply: (o) => [`how you would set the pars for ${o || 'the first order'}, and how you would watch waste`, 'what you would ask about the vendor cut-off and the counts before your first order'],
  present: (o) => [`the one point you would lead with${o ? ` when presenting ${o}` : ''}, and how you would check it landed`, `how you would find out what your audience already knows before presenting${o ? ` ${o}` : ''}`],
  quality: (o) => [`what you would check first${o ? ` on ${o}` : ''}, and what makes you stop something going out`, `how you would set the standard${o ? ` for ${o}` : ''} with the rest of the team`],
  ship: (o) => [`how you would check ${o || 'each order'} against what was asked for before anything goes out`, `what you would want to learn about ${o || 'the orders'} in your first week`],
  load: (o) => [`how you would plan the first trailer${o ? ` of ${o}` : ''}, and what you would check before it leaves`, `what you would ask about how ${o || 'the loads'} are staged here`],
  receive: (o) => ['what you would check when the first delivery comes in, and where it would go', `how you would learn where ${o || 'everything'} is kept here`],
  count: (o) => [`what you would check first to keep ${o || 'the records'} accurate, and how often`, `how you would find out where ${o || 'the counts'} go wrong today`],
  cook: (o) => [`what you would set up first${o ? ` for ${o}` : ''}, and how you would keep up in the rush`, `what you would want to learn about ${o || 'the menu'} before your first service`],
  tidy: (o) => [`what you would set up so ${o || 'the area'} stays in order on a busy shift`, 'the one habit you would keep every shift, and why'],
  fix: (o) => [`the first thing you would check on ${o || 'a new job'}, and how you would keep it safe`, `how you would learn ${o || 'the equipment'} here`],
  coach: (o) => [`what you would listen for first${o ? (/\b(?:feedback|coaching|reviews?)$/i.test(o) ? ` before giving ${o}` : ` with ${o}`) : ''}, and how you would say it`, `how you would open the first conversation${o ? ` about ${o}` : ''}`],
  train: (o) => (o && PEOPLE_O.test(o) ? [`how you would run the first day for ${o.replace(/^the\s+/i, '')}, and how you would know they are ready`, `what ${o.replace(/^the\s+/i, '')} would learn first, and why`] : [`how you would open the first session${o ? ` on ${o}` : ''}, and how you would check it landed`, `what the first week of ${o || 'training'} would cover, and why`]),
  build: (o0) => { const o = String(o0 || '').replace(/^the\s+/i, ''); return [!o ? 'the first piece you would build or fix, and why' : isPluralNoun(o) ? `which ${o} you would build or fix first, and why` : `the part of the ${o} you would build or fix first, and why`, `who you would ask before changing ${o || 'anything'}, and what you would change first`]; },
  measure: (o) => [`what you would measure first in ${o || 'the work'}, and why`, `the number you would watch weekly${o ? ` for ${o}` : ''}, and what would make you act`],
  schedule: (o) => [`what you would set up for ${o || 'the schedule'} in your first month`, `how you would cover a short week${o ? ` on ${o}` : ''}`],
  lead: (o) => [`how you would set up ${o || 'the shift'}, and keep it on track`, `what you would want to see in your first week running ${o || 'it'}`],
  case: (o) => [`the first thing you would check on ${o || 'a new case'}, and when you would escalate`, `how you would decide what to fix first${o ? ` on ${o}` : ''}`],
  patient: (o) => [`what you would check first${o ? ` with ${o}` : ''}, and when you would call for help`, `how you would set up your first shift${o ? ` on ${o}` : ''}`],
  sale: (o) => [`the first customers you would go after${o ? ` for ${o}` : ''}, and why`, `what your first week of outreach${o ? ` on ${o}` : ''} would look like`],
  people: (o) => [`how you would handle ${o || 'the first person'} who needs more than you can give, and what you would offer`, `what you would learn first about ${o || 'the people you serve'}`],
};
const PARTNER_V = /^(?:partner|collaborate|coordinate|work|liaise|communicate|support|assist|help)$/;
const CHECK_V = /^(?:maintain|ensure|comply|inspect|verify|check|follow|enforce|keep)$/;
/** The candidate blanks for one question, in order of preference (the composer takes the least used). */
function blanksFor(form, qt, st) {
  const text = st ? (st.subject || st.text) : '';
  // the duty's own verb decides the kind first ("Create or improve training materials" is building, not training)
  const k = VERB_KIND.find(([re]) => re.test(verbOf(text)))?.[1] || kindOf(text) || kindOf(qt);
  const o = st ? dutyObject(text).replace(/^(?:accurate|correct|daily|all|new|specific|clear|timely|regular|ongoing|effective)\s+/i, '') : '';
  const o1 = o && o.split(/\s+/).length > 4 ? o.split(/\s+(?:and|or)\s+/)[0] : o;
  const o3 = o1 && o1.split(/\s+/).length <= 4 ? o1 : '';
  // with the article the statement gives it ("run the shift" → "the shift", never "set up shift")
  const o2 = o3 && new RegExp(`\\b(?:the|our|your)\\s+${escapeRegExp(o3)}`, 'i').test(text) ? `the ${o3}` : o3;
  if (form === 'experience') {
    if (/\bWalk me through a shift\.?$/i.test(qt)) {
      const g = (qt.match(/^Have you done (.+?) before\?/i) || [])[1] || dutySubject(text, 6) || 'this work';
      return [SHIFT[k] || `how a shift of ${g} runs for you: what you do first, and what you check at the end`, `the last shift you spent ${g}: how it started, and what you checked before you left`];
    }
    if (!st) return [storyBlank(qt)];
    const tm = (qt.match(/^Tell me about a time you (.+?)\.?$/i) || [])[1];
    const own = tm && tm.split(/\s+/).length <= 10 ? `the time you ${tm}: what was going on, and how it ended` : '';
    return [...(MOMENT[k] || []), own, storyBlank(qt)].filter(Boolean);
  }
  if (form === 'practice') {
    const ck = qt.match(/^What do you check before (.+?)\?$/i);
    if (ck) return [`what you check before ${ck[1]}, in the order you check it`, `the check you never skip before ${ck[1]}, and why`];
    const ac = qt.match(/^How do you keep (.+?) accurate\b/i);
    if (ac) return [`the habit that keeps ${ac[1]} accurate when it's busy, and how you catch a miss`, `what you check twice on ${ac[1]}, and why`];
    if (PRACTICE[k]) return PRACTICE[k](o2);
    if (!st) return [hypoBlank(qt, 'practice')];
  }
  if (!st) return [hypoBlank(qt, 'plan')];
  const v = verbOf(text);
  if (PARTNER_V.test(v)) return [`who you would talk to first${o2 ? ` about ${o2}` : ''}, and what you would ask them`, `how you would keep the people on ${o2 || 'it'} in step`];
  if (CHECK_V.test(v)) return [`what you would check first${o2 ? ` on ${o2}` : ''}, and how often`, `how you would spot ${o2 || 'it'} slipping before it becomes a problem`];
  const byKind = PLAN[k] ? PLAN[k](o2) : [];
  const d = dutyBlank(text);
  const fallback = o2 ? [`the first thing you would do on ${o2}, and why`, `what you would want to know about ${o2} in your first week`] : [`your first step on ${dutySubject(text, 6) || 'this'}, and why`];
  return [...byKind, ...(d && !/^what you would do first here/.test(d) ? [d] : []), ...fallback];
}

// what a blank asks that the sentence before it may already say
const STATED = [
  [/\bwho it was for\b|\bwho used it\b/i, /\bused (?:in|by)\b|\bnow used\b|\bfor (?:the |all |\d)/i],
  [/\bhow you closed it\b/i, /\bclosed\b/i],
  [/\bwhat came in\b/i, /\breceiv\w+ \d/i],
];
function asksStated(blank, said) { return STATED.some(([b, t]) => b.test(blank) && t.test(said)); }

// ── Saying a résumé line ─────────────────────────────────────────────────────────────────────────────────────────
const lower1 = (s) => (/^I\b/.test(s) ? s : lcFirst(s));
/** The line said as a clause after "where" / ":" ("I lead a team of 8 …"), or null. */
function clause(line, { max = 30 } = {}) {
  if (!line || !line.said) return null;
  let s = line.said;
  if (line.fp && line.fp.rest.length) {
    const more = line.fp.rest.filter((r) => /^I /.test(r)).map((r) => r.replace(/^I /, ''));
    if (more.length && s.split(/\s+/).length + more.join(' ').split(/\s+/).length <= max) s = `${s}, and ${more.join(', and ')}`;
  }
  if (s.split(/\s+/).length > max) {
    // cut at a clause boundary, never mid-phrase
    const cut = s.split(/,\s+(?:and\s+)?|\s+by\s+|\s+(?:while|through|using)\s+/)[0];
    if (cut.split(/\s+/).length < 5 || cut.split(/\s+/).length > max) return null;
    s = cut;
  }
  return s.replace(/[.\s]+$/, '');
}
/** A short verb phrase from the line for "when I …" ("interview and onboard new agents"). */
function verbPhrase(line, max = 12) {
  const c = clause(line, { max: 40 });
  if (!c || !/^I (?!was\b)/.test(c)) return null;
  let s = c.replace(/^I /, '').split(/;\s+|,\s+and\s+(?=[a-z]+\s)|\s+(?:by|while|through|using|to ensure)\s+/)[0];
  if (s.split(/\s+/).length > max) return null;
  while (/\s(?:and|or|of|in|with|to|for|at|by|on|the|a|an|across|from)$/i.test(s)) s = s.replace(/\s+\S+$/, '');
  return s.split(/\s+/).length >= 3 ? s : null;
}

// ── Claim openers (varied; the pack never opens two answers with the same words) ───────────────────────────────
function claimVariants(line, { exact = false, asSaid = false, full = false } = {}) {
  // a reference back is short ("As I said, I run the afternoon shift"), unless the question asks for the whole of it
  const c = (asSaid && !full ? clause(line, { max: 12 }) : null) || clause(line);
  if (!c) return [];
  const { company: co, title, current } = line.job;
  const body = lower1(c);
  // a line already told in full (twice, or in the answer just before): referred back to, never told a third time as new
  if (asSaid) return [`As I said, ${body}.`, `Like I mentioned, ${body}.`];
  const w1 = (body.match(/^I (\w+)/) || [])[1] || '';
  const present = current && !!w1 && verbBase(w1) === w1.toLowerCase() && w1 !== 'was';
  const v = [];
  if (line.job.sameAsCurrent && !current && co && title) { v.push(`Earlier at ${co}, as ${aAn(title)} ${title}, ${body}.`); v.push(`Before my current role at ${co}, ${body}.`); }
  if (exact && co) v.push(current ? `I do this now at ${co}: ${body}.` : line.job.sameAsCurrent ? `I did this as ${aAn(title)} ${title} at ${co}: ${body}.` : `I did this at ${co}: ${body}.`);
  if (co && title) v.push(`As ${aAn(title)} ${title} at ${co}, ${body}.`);
  if (co) v.push(present ? `Right now at ${co}, ${body}.` : current ? `At ${co}, where I work now, ${body}.` : line.job.sameAsCurrent ? `As ${aAn(title)} ${title} there, ${body}.` : `Back at ${co}, ${body}.`);
  if (co && !line.job.sameAsCurrent) v.push(current ? `In my job at ${co}, ${body}.` : `In my time at ${co}, ${body}.`);
  if (co) v.push(`At ${co}, ${body}.`);
  // when the openers above are spent, the line leads and the employer follows
  if (co && /^I /.test(body)) v.push(`${body}${body.split(/\s+/).length <= 18 ? ` at ${co}` : ''}.`);
  if (co && title) v.push(`One example from my time as ${aAn(title)} ${title}: ${body}.`);
  if (!co) v.push(`${sentenceCase(body)}.`);
  return v;
}
// a deterministic choice among constructions, by the case (the question), so one scaffold never repeats pack-wide
const hashOf = (t) => [...String(t || '')].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) % 9973, 7);
const choose = (key, xs) => xs[hashOf(key) % xs.length];
const START_WITH = [
  (s, b) => `For ${s} here, I'd start with [${b}].`,
  (s, b) => `On ${s} here, my first step would be [${b}].`,
  (s, b) => `If I took on ${s} here, I'd begin with [${b}].`,
];
const LINES_UP = [
  (s, b) => `It lines up with ${s} in this job, and the moment I'd tell is [${b}].`,
  (s, b) => `This job asks for ${s}, and the example I'd use is [${b}].`,
  (s, b) => `That is the part of my work closest to ${s} here, and the moment I'd pick is [${b}].`,
];
const openerKey = (t) => words(String(t).replace(/\[[^\]]*\]/g, ' x ')).slice(0, 2).join(' ');

/** A second sentence: the line from the same job with a number that bears on the statement, or ''. */
function proofSentence(statement, claimLine, pool, usedLines) {
  // a number joins the claim only when its line is linked to the statement too (CSAT with coaching, yes; tickets a day
  // with training, no — coordinator round 2)
  const same = pool.filter((l) => l.job.id === claimLine.job.id && l.id !== claimLine.id && (l.parent || l.id) !== (claimLine.parent || claimLine.id) && !l.clause && !l.skill && l.num && l.said && !usedLines.has(l.id));
  if (!same.length) return null;
  const sc = conceptsOf(statement);
  const coachy = sc.some((c) => ['coaching', 'call review', 'leading'].includes(c));
  const QUALITY = /\b(?:CSAT|NPS|satisfaction|quality scores?|accuracy|retention)\b/i;
  const scored = same.map((l) => { const link0 = linkOf(statement, l); const link = link0 && (link0.kind === 'same work' || link0.words.length >= 2) ? link0 : null; const q = coachy && QUALITY.test(l.plain); return { l, link: link || (q ? { kind: 'result of the same work', words: ['quality'] } : null), n: (link ? 2 : 0) + (q ? 2 : 0) + (l.result ? 1 : 0) }; }).filter((x) => x.link).sort((a, b) => b.n - a.n);
  const pick = scored[0] && scored[0].l;
  if (!pick) return null;
  const c = clause(pick, { max: 24 });
  return c ? { text: `${sentenceCase(c)}.`, line: pick, link: scored[0].link } : null;
}

// ── Validation ──────────────────────────────────────────────────────────────────────────────────────────────────
// The closed list of words a draft may add besides the résumé's and the posting's own (every template word below).
export const CONNECTIVES = new Set(`i i'm i've i'd i'll me my we our us you your it it's its this that these those the a an and or but so because
which where when while who what how why if as at in on to of for from with by into about after before since until than then there here now
right back time job role work worked working do did does done doing have has had haven't hasn't be is are was were been being am
not no never yet still also just only even same closest close closer part formal under name new start started starting moved up
there's that's what's i'd it's i'm don't won't can't isn't aren't wasn't
bring brought bringing apply would could will can should might must
think say said tell told know known see look looking want wanted like
first next last one two each every some any more most less least much many few
way kind sort thing things something nothing everything piece pieces
experience role roles position team teams company organization business place
interested interest drawn draws centres centers centred centered focus focused
posting describes describe described lists listed asks asked mentions named
honest honestly plainly straight straightforward clear clearly
learn learning learned get getting got speed close gap gaps plan
from posting read reading understand understood heard hear
good great well better best really very quite most especially
range works fit fits pay rate notice day days week weeks month months year years hours
interview interviewing elsewhere either way stands out stand
thank thanks taking talk talking talked enjoyed enjoy came away came even interested happy send anything else help
hi hello dear following follow followed update next steps share glad answer conversation
ask asking question questions today change changes like most would most rather
in-person sounds sound won't stretch fit close fit means mean put myself given related based along puts centre center built around example examples pick show earlier current nearest covers cover lines line fits moment stand ended want next recently come came nearest noticed handled hold certification license licence mind far toward towards pointed started began set carries carry ready step up use problem handle take move result just finished finishing particular draw nearest experience comes closest lean bring add begin role took beyond mentioned building alongside remember best give haven't january february march april may june july august september october november december
already directly own such newer come comes skills skill over carries list among background point million billion thousand honest itself
`.split(/\s+/).filter(Boolean));
export function vocabulary(ctx, extra = '') {
  const v = new Set(CONNECTIVES);
  for (const w of words(`${ctx.resumeText} ${ctx.jobDescription} ${ctx.jobTitle} ${ctx.company} ${extra}`)) {
    v.add(w); v.add(stem(w));
    // the posting's own verbs said as -ing ("run daily cycle counts" → "running daily cycle counts")
    const b = baseVerb(w);
    if (b) { const g = gerund(b); v.add(g); v.add(stem(g)); }
    // the résumé's -ing words told as the person's past ("splitting" → "split", "adding" → "added")
    if (/ing$/.test(w)) { const r = ingBase(w); if (r) { v.add(r); v.add(pastTense(r)); } }
  }
  return v;
}
const MAX_SENTENCE_WORDS = 35;
/**
 * Problems with a draft, [] when it can be printed: at most one blank, balanced brackets and quotes, no sentence over
 * 35 words, number agreement, no fragment after a preposition, no doubled word, and every content word from the
 * résumé, the posting, the question or the connective list.
 */
export function validateDraft(text, vocab = null, { maxBlanks = 1, form = null } = {}) {
  const t = String(text || '');
  const issues = [];
  // the question's form: an experience question never ends on a plan blank, a "how would you … here" never on a memory
  if (form) {
    for (const m of t.matchAll(/\[([^\]]*)\]/g)) {
      const before = t.slice(0, m.index).split(/(?<=[.?!])\s+/).pop() || '';
      if (form === 'experience' && (PLAN_BLANK_RE.test(m[1]) || PLAN_LEAD_RE.test(before))) issues.push('plan_in_experience');
      if (form === 'plan' && MEMORY_BLANK_RE.test(m[1])) issues.push('memory_in_plan');
    }
  }
  const blanks = (t.match(/\[[^\]]*\]/g) || []).length;
  if (blanks > maxBlanks) issues.push('blanks');
  if ((t.match(/\[/g) || []).length !== (t.match(/\]/g) || []).length) issues.push('brackets');
  if ((t.match(/“/g) || []).length !== (t.match(/”/g) || []).length || (t.match(/"/g) || []).length % 2) issues.push('quotes');
  const given = t.replace(/\[[^\]]*\]/g, 'X');
  for (const s of given.split(/(?<=[.?!])\s+/)) if (s.split(/\s+/).filter((w) => /[a-z]/i.test(w)).length > MAX_SENTENCE_WORDS) issues.push('long');
  if (/\b(?:the|these|those|our|my|its|their|your)\s+(?:[\w-]+\s+){0,3}(?:materials|aids|modules|agents|people|sessions|plans|systems|records|reports|patients|customers|orders|skills|behaviors|tools|processes|standards|procedures)\s+(?:was|is|has)\b/i.test(given)) issues.push('agreement');
  if (/\b(?:with|on|to|for|of|at|by|from|about|into)\s+(?:on|to|for|of|at|by|from|with|the the)\b/i.test(given)) issues.push('fragment');
  if (/\b(\w{3,})\s+\1\b/i.test(given)) issues.push('doubled');
  if (/\.\s*\./.test(given) || /\s,/.test(given)) issues.push('punctuation');
  if (vocab) {
    const unknown = words(given).filter((w) => w !== 'x' && /[a-z]/.test(w) && !/\d/.test(w) && !vocab.has(w) && !vocab.has(stem(w)) && !vocab.has(w.replace(/(?:'s|’s)$/, '')));
    if (unknown.length) issues.push(`unknown:${[...new Set(unknown)].slice(0, 5).join(',')}`);
  }
  return issues;
}

// ── The composer ────────────────────────────────────────────────────────────────────────────────────────────────
const MISTAKE_Q = /\b(?:mistake|got (?:a |something |one )?(?:detail )?wrong|went wrong|you failed|a failure|regret|weakness|do differently|didn't go (?:well|as planned)|disagree\w*|pushed back|conflict|difficult (?:coworker|colleague|teammate|manager)|feedback you|criticism)\b/i;
const BEHAVIORAL = /^(?:Tell me about (?:a|the|something|one)\b|Describe a (?:time|situation)|Give (?:me )?an example|When have you|Talk about a time|Think of a time|Walk me through (?:one|a time|something|(?:an?|your) (?:analysis|project|system|decision|campaign|change|launch|build|migration|deal|account|unit|lesson)))/i;
const HYPOTHETICAL = /^(?:A |An |The |Your |Sales |Traffic |Two |Three |It's |It is |You (?:notice|see|find|are|have|walk)|Payroll |What would you|How would you|How do you|What do you do|How do you handle)/i;

/**
 * Compose every answer of a pack. `pack` is localPack's output before it is returned; `ctx` its buildContext;
 * `opts` = { role, company, family, jobText, duties, fieldMatch, postingField, payText, salaried }.
 * Returns the pack with drafted answers, intro, ask-them questions, email phrases and job-match rows.
 */
export function composePack(pack, ctx, opts = {}) {
  const pool = evidencePool(ctx);
  const statements = opts.jobText ? postingStatements(ctx, opts.duties || []) : [];
  const vocab = vocabulary(ctx, pack.questions.map((q) => q.q).join(' '));
  const flatResume = String(ctx.resumeText || '').replace(/\s+/g, ' ').toLowerCase();
  // a line the verdict cites is the résumé's own words only when it appears in the résumé as written
  const verbatimLine = (e) => flatResume.includes(clean(e).replace(/^[\s•●▪◦*·\-–—]+/, '').replace(/\s+/g, ' ').toLowerCase());
  // a line with no verb of its own ("Weekly order for milk, cups and syrups, cut waste about 15% …") is said the way
  // the verdict says it ("you place the weekly order …" → "I place the weekly order …"), in every answer that tells it
  for (const st of statements) (st.evidence || []).forEach((e, i) => {
    const w = (st.evWhys || [])[i] || '';
    const l = pool.find((x) => !x.clause && !x.skill && !x.said && sameLine(x.text, e));
    if (l && /^you [a-z]+/i.test(w) && !/^you (?:show|list|have|hold|are|said)\b/i.test(w)) l.said = `I ${w.replace(/^you\s+/i, '').replace(/\byour\b/g, 'my').replace(/[.\s]+$/, '').replace(/,\s+(cut|raised|grew|reduced|saved|brought|kept|lowered|increased)\b/, ', and $1')}`;
  });
  const usedOpeners = new Set();
  const mainUse = new Map(); // line id → times used as the main proof
  const usedProof = new Set();
  const company = opts.company || 'this company';
  const roleSaid = opts.roleSaid || opts.role || 'this';
  // the best line for a statement, honouring "one line is the main proof for at most two questions"
  const rankFor = (st) => {
    // "Tell me about your experience with SQL": a line that names SQL comes first
    const subjWords = st.subject ? stemsOf(st.subject).filter((w) => w.length >= 2 && !GENERIC.test(w)) : [];
    return pool.filter((l) => !l.skill || st.status !== 'shown').map((l) => { const p = proofScore(st.text, l, { verdictLines: st.evidence || [] }); const hit = !!(subjWords.length && !p.audienceMiss && subjWords.every((w) => l.stems.includes(w))); return { l, ...p, hit, n: p.n + (hit ? 3 : 0), strength: hit ? 'strong' : p.strength, link: p.link || (hit ? { kind: 'shared words', words: [st.subject] } : null) }; }).filter((x) => x.strength).sort((a, b) => (b.hit - a.hit) || (b.strength === 'strong') - (a.strength === 'strong') || ((b.link && b.link.kind === 'same work') - (a.link && a.link.kind === 'same work')) || b.n - a.n);
  };
  // the verdict's own line for a statement it reads as shown or partly (coordinator round 5: the draft and the job-match
  // row for one statement tell the same story, so the proof is the verdict's line, not one this module prefers)
  // (the FIRST evidence line, the one the job-match row prints)
  const verdictLineFor = (st) => { const e = (st.reader && (st.status === 'shown' || st.status === 'partly') ? (st.evidence || []).find(Boolean) : '') || ''; return (e && pool.find((l) => !l.clause && !l.skill && sameLine(l.text, e))) || null; };
  // the person's own answers (round 7): a statement they said No to is never told as experience; a candidate line the
  // verdict only offers ("Closest line we found … Does this show it?") is never told as proof — it is the suggestion
  const noIds = new Set(cleanConfirmations(opts.confirmed).filter((e) => e.answer === 'no').map((e) => e.statementId));
  const saidNo = (st) => !!(st && st.reader && ((st.id && noIds.has(st.id) && st.status !== 'shown') || (st.by === 'you' && st.status === 'not_shown')));
  const isCandidate = (st, l) => !!(st && st.candidate && st.by !== 'you' && l && sameLine(l.text, st.candidate.line));
  const bestFor = (st) => {
    if (saidNo(st)) return null;
    const vl = verdictLineFor(st);
    // the verdict cites a line that is not a bullet (the skills line, the summary): the answer is built on THAT line, by
    // the skills drafts — never on another line this module would prefer (round 8)
    if (!vl && st.reader && (st.status === 'shown' || st.status === 'partly') && (st.evidence || []).find(Boolean)) return null;
    if (vl) {
      // one line is the main proof for at most two answers; past that, the answer is told without a line
      // its own line, even when it has proved two answers already: then it is referred back to ("As I said, …")
      const capped = (mainUse.get(vl.id) || 0) >= 2 || vl.id === lastLineId;
      const p = proofScore(st.subject || st.text, vl, { verdictLines: st.evidence || [] });
      const shared = specific(stemsOf(st.subject || st.text)).filter((w) => vl.stems.includes(w));
      const named = shared.length ? words(vl.plain).filter((w) => shared.includes(stem(w))).slice(0, 3) : vl.concepts.slice(0, 2);
      return { l: vl, ...p, hit: false, verdict: true, ...(capped ? { asSaid: true } : {}), strength: st.status === 'shown' ? 'strong' : 'close', link: p.link || { kind: 'the line the fit check cites', words: named.length ? named : [objectPhrase(vl)] } };
    }
    const ranked = rankFor(st).filter((x) => !isCandidate(st, x.l) && !(x.l.parent && st.candidate && st.by !== 'you' && sameLine(x.l.text, st.candidate.line)));
    // one line is the main proof for at most two answers (coordinator round 5: no exceptions)
    const free = ranked.find((x) => (mainUse.get(x.l.id) || 0) < 2 && x.l.id !== lastLineId);
    if (free) return free;
    // the obvious line is spent: refer back to it rather than leave a blank beside it (director round 8)
    return ranked[0] && (ranked[0].strength === 'strong' || (ranked[0].link && ranked[0].link.kind === 'same work')) ? { ...ranked[0], asSaid: true } : null;
  };
  const blankUse = new Map();
  // the candidate used least in this pack, so no prompt is printed more than twice
  const pickBlank = (cands) => { const cs = [...new Set((cands || []).filter(Boolean))]; if (!cs.length) return 'the moment itself: what was going on, and how it ended'; const min = Math.min(...cs.map((c) => blankUse.get(c) || 0)); return cs.find((c) => (blankUse.get(c) || 0) === min); };
  const noteBlanks = (text) => { for (const m of String(text || '').matchAll(/\[([^\]]*)\]/g)) { const k = m[1].replace(/^[A-Z]/, (c) => c.toLowerCase()).replace(/[.\s]+$/, ''); blankUse.set(k, (blankUse.get(k) || 0) + 1); } };
  const statementFor = (q, a) => {
    // "Tell me about your experience with X": the statement is said by X itself, whatever line it sits in
    const sm = String(q.q).match(/^Tell me about your experience with (.+?)\.?$/i);
    const found = statementFor0(q, a);
    return found && sm ? { ...found, subject: sm[1] } : found;
  };
  const statementFor0 = (q, a) => {
    const src = q.source || a?.source || '';
    if (src) { const hit = statements.map((s) => ({ s, o: sameLine(s.text, src) || clean(src).toLowerCase().includes(s.text.toLowerCase().slice(0, 40)) ? 2 : overlap(s.text, src) })).sort((x, y) => y.o - x.o)[0]; if (hit && hit.o >= 0.75) return hit.s; if (realStatement(src)) return { id: 'q', text: clean(src, 200), status: 'cannot_tell', evidence: [], missing: [], kind: 'duty' }; }
    const m = String(q.q).match(/^Tell me about your experience with (.+?)\.?$/i);
    if (m) { const r = (ctx.requirements || []).find((x) => x.label.toLowerCase() === m[1].toLowerCase()); const s0 = r && r.posting ? statements.find((x) => sameLine(x.text, r.posting) || overlap(x.text, r.posting) >= 0.6) : null; const s = s0 ? { ...s0, subject: m[1] } : null; return s || (r ? { id: 'r', text: m[1], status: r.matched && !r.inferred ? 'shown' : r.matched ? 'partly' : 'not_shown', evidence: r.evidence ? [r.evidence] : [], missing: [], kind: 'requirement' } : null); }
    return null;
  };
  const pickOpener = (variants) => {
    const ok = variants.find((v) => !usedOpeners.has(openerKey(v)));
    return ok || variants[variants.length - 1] || '';
  };
  const commit = (text) => { usedOpeners.add(openerKey(text)); return text; };
  const finish = (sentences) => sentences.filter(Boolean).map((s) => s.trim()).join(' ').replace(/\s+/g, ' ').replace(/\s+([.,;?!])/g, '$1').trim();
  let curQ = '';
  let curForm = null; // the form of the question being composed (every draft is checked against it)
  const valid = (text) => { const iss = validateDraft(text, vocab, { form: curForm }); if (iss.length && process.env.P2_DEBUG) console.error('INVALID', iss.join(' '), '::', text); return iss.length === 0; };

  // SHOWN: claim → proof → one blank, the blank in the question's own form
  const endFor = (form, q, b) => (form === 'experience'
    ? (/\bWalk me through a shift\.?$/i.test(q) ? choose(`${q}|e`, [(x) => `A shift for me goes like this: [${x}].`, (x) => `[${sentenceCase(x)}.]`]) : choose(`${q}|e`, [(x) => `The one I'd tell is [${x}].`, (x) => `The example I'd give is [${x}].`, (x) => `[${sentenceCase(x)}.]`]))(b)
    : MEMORY_BLANK_RE.test(b) ? choose(`${q}|m`, [(x) => `The one I'd tell is [${x}].`, (x) => `[${sentenceCase(x)}.]`])(b)
      : choose(`${q}|p`, [(x) => `What I do is [${x}].`, (x) => `[${sentenceCase(x)}.]`, (x) => `Here is how I do it: [${x}].`])(b));
  function shownDraft(st, best, { story = false, q = '' } = {}) {
    const line = best.l;
    const form = questionForm(q);
    // "I do this now" only when the line itself names the work (two specific words, or a named piece of it), or it is
    // the verdict's own line for a statement the verdict reads as shown
    const exact = !story && (best.shared.length >= 2 || (best.shared.length >= 1 && best.concepts.some((c) => !BROAD.has(c))) || coversByClass(st.text, best));
    const claim = pickOpener(claimVariants(line, { exact, asSaid: !!best.asSaid }));
    if (!claim) return null;
    const proof = best.asSaid ? null : proofSentence(st.subject || st.text, line, pool, usedProof);
    const subj = st.subject || dutySubject(st.text, 9);
    let bridge;
    // a blank never asks for what the sentence already states ("used in the weekly risk meeting" → not "who it was for")
    const told = `${claim} ${proof ? proof.text : ''}`;
    const fresh = (cs) => { const ok = cs.filter((b) => !asksStated(b, told)); return ok.length ? ok : cs; };
    if (form === 'plan') {
      // "I'd bring that to X" only on a specific shared object (the same work, or two shared words): the verdict's say-so
      // alone ("train teachers on our LMS" → "managing courses in the LMS") is no bridge
      // (the claim is still the verdict's own line — round 8 — but with no specific shared object it is never bridged as
      // "I'd bring that to X": the plan sentence stands on its own)
      const own = best.l && linkOf(st.subject || st.text, best.l);
      const bridged = !!own && (own.kind === 'same work' || (own.words || []).length >= 2);
      const blank = pickBlank(fresh(blanksFor('plan', q, st)));
      bridge = choose(`${q}|${st.text}`, bridged ? [(s0, b) => `I'd bring that to ${s0} here, starting with [${b}].`, ...START_WITH] : START_WITH)(subj, blank);
    } else {
      const sb = storyBlank(q || st.text);
      // the statement's own kind of moment first (a feedback question asks for a conversation, not "one person you
      // trained" because the posting line ends "after training")
      const cands = [...blanksFor(form, q, st), ...(story && !/^the (?:moment itself|time you)/.test(sb) ? [sb] : [])];
      bridge = endFor(form, q, pickBlank(fresh(cands)));
    }
    const rb = best.asSaid ? { refers_back: true } : {};
    const draft = finish([claim, proof && proof.text, bridge]);
    if (valid(draft)) { if (proof) usedProof.add(proof.line.id); return { answer: draft, resume_fact: line.text, shape: 'shown', link: best.link, ...rb }; }
    const short = finish([claim, bridge]);
    if (valid(short)) return { answer: short, resume_fact: line.text, shape: 'shown', link: best.link, ...rb };
    return null;
  }
  // a candidate offered as the closest thing (never as proof): "The closest I have done is at X, where I …" + one blank
  // that asks how it differs; a skills-line candidate is said as a listed skill
  function candidateClosest(st, q) {
    const cand = st.candidate;
    const form = questionForm(q);
    const subj = st.subject || dutySubject(st.text, 9) || 'this';
    const blank = form === 'experience' ? pickBlank([`what was different from ${subj}, and one time it came up`, `whether that counts as ${subj}, said plainly, and one example`])
      : form === 'plan' ? pickBlank([`what you would learn first about ${subj}, and how`, `how you would get up to speed on ${subj}`])
        : pickBlank([`what you would add for ${subj}, from what you do now`, `how you would handle ${subj}, from what you do now`]);
    const line = pool.find((l) => !l.clause && !l.skill && sameLine(l.text, cand.line));
    const c = line ? clause(line, { max: 22 }) : null;
    let d = '';
    if (c) { const at = line.job.company ? ` at ${line.job.company}` : ''; d = finish([pickOpener([`The closest I have done is${at}, where ${lower1(c)}.`, `What comes closest is my work${at}, where ${lower1(c)}.`]), `[${sentenceCase(blank)}.]`]); }
    else { const item = (String(cand.why || '').match(/\blists\s+(.+?)\s*$/i) || [])[1]; if (item && item.split(/\s+/).length <= 5) d = finish([`I list ${item.replace(/[.\s]+$/, '')} among my skills, and on ${subj} itself the honest answer is [whether you have used it at work, and where].`]); }
    return d && valid(d) ? { answer: d, resume_fact: '', closest_line: cand.line, shape: 'closest' } : null;
  }
  // a statement the person said No to: never told as experience — the honest frame in the question's form
  function saidNoDraft(st, q) {
    const subj = st.subject || dutySubject(st.text, 9) || 'this';
    const form = questionForm(q);
    const S = sentenceCase(subj);
    const d = form === 'plan'
      ? finish([`${S} would be new to me, so I'd start with [${pickBlank([`what you would learn first about ${subj}, and how`, `who you would ask first about ${subj}, and what you would ask`])}].`])
      : finish([`${S} isn't something I've done, and I won't stretch it: [${pickBlank([`the closest thing you have done to ${subj}, and how you would learn the rest`, `what you would do to get ready for ${subj}`])}].`]);
    return valid(d) ? { answer: d, resume_fact: '', shape: 'said_no' } : { answer: finish([`[${sentenceCase(`whether you have done ${subj}, said plainly, and the closest thing you have done`)}.]`]), resume_fact: '', shape: 'said_no' };
  }
  // "yes" to a line only the person can answer (hours, lifting, a trait): their own yes, then one blank in the form
  function saidYesDraft(st, q) {
    const form = questionForm(q);
    const blank = pickBlank(blanksFor(form === 'plan' ? 'plan' : form, q, st));
    const d = finish(['Yes, I can.', form === 'plan' ? `For ${st.subject || dutySubject(st.text, 8)} here, I'd start with [${blank}].` : endFor(form, q, blank)]);
    return valid(d) ? { answer: d, resume_fact: '', shape: 'said_yes' } : null;
  }
  // the verdict's own line, said plainly (or referred back to), then the question's blank in its form
  function verdictLineDraft(st, best, q) {
    const form = questionForm(q);
    const claim = pickOpener(claimVariants(best.l, { asSaid: !!best.asSaid }));
    if (!claim) return null;
    const fresh = (cs) => { const ok = cs.filter((b) => !asksStated(b, claim)); return ok.length ? ok : cs; };
    const end = form === 'plan' ? choose(`${q}|v`, START_WITH)(st.subject || dutySubject(st.text, 9), pickBlank(fresh(blanksFor('plan', q, st)))) : endFor(form, q, pickBlank(fresh(blanksFor(form, q, st))));
    const d = finish([claim, end]);
    return valid(d) ? { answer: d, resume_fact: best.l.text, shape: st.status === 'shown' ? 'shown' : 'partly', link: best.link, ...(best.asSaid ? { refers_back: true } : {}) } : null;
  }
  // the verdict's line is no bullet: a job's header ("Customer Service Representative — Cox Communications | … 2016 – 2017")
  // is said as that job; a certificate or a skills item as held / listed
  function nonBulletDraft(st, q) {
    const e = (st.evidence || []).find(Boolean) || '';
    if (!e) return null;
    const form = questionForm(q);
    const subj = st.subject || dutySubject(st.text, 9) || 'this';
    const job = (ctx.sheet.jobs || []).find((j) => j.company && e.toLowerCase().includes(String(j.company).toLowerCase().slice(0, 12)) && e.toLowerCase().includes(String(roleTitle(j.title)).toLowerCase().slice(0, 10)));
    const name = clean(e).replace(/^[\s•●▪◦*·\-–—]+/, '').split(/\s+[|–—]\s+|\s*\|\s*/).map((x) => x.trim()).filter(Boolean);
    const year = (e.match(/\b(?:19|20)\d{2}\b(?!.*\b(?:19|20)\d{2}\b)/) || [])[0];
    const blank = form === 'plan' ? pickBlank([`what you would bring from it to ${subj} here, and what you would learn first`, `how you would use it for ${subj} here`]) : form === 'experience' ? pickBlank([`one time it came up for ${subj}: what you did, and what was new`, `what you did there that comes closest to ${subj}`]) : pickBlank([`what you do that comes closest to ${subj}`, `how you would handle ${subj}, from what you know`]);
    let d = '';
    if (job) { const t = roleTitle(job.title), co = spokenEmployer(job.company); d = finish([`My time as ${aAn(t)} ${t} at ${co} is the part of my background I'd point to here: [${blank}].`]); }
    else if (/\b(?:certif\w*|licen[cs]e|handler|card|CPR|BLS|ACLS|ServSafe|OSHA)\b/i.test(e) && name[0] && name[0].split(/\s+/).length <= 6) d = finish([`I hold the ${name[0]}${year ? ` (${year})` : ''}, and [${blank}].`]);
    // (resume_fact only when the line is the résumé's own words; `verdict_line` always names the line it stands on)
    return d && valid(d) ? { answer: d, resume_fact: verbatimLine(e) ? e : '', verdict_line: e, shape: st.status === 'shown' ? 'shown' : 'partly' } : null;
  }
  // partly on a line that is not a bullet (the skills line): the listed item said as listed, the work asked plainly
  function skillPartlyDraft(st, q) {
    const e = (st.evidence || []).find(Boolean) || '';
    if (!e) return null;
    const subj = st.subject || dutySubject(st.text, 9) || 'this';
    const stS = specific(stemsOf(st.text));
    const items = e.replace(/^[^:]{0,30}:\s*/, '').split(/,\s*|;\s*/).map((x) => x.trim()).filter(Boolean);
    const why = ((st.evWhys || [])[0] || '').match(/\blists\s+(.+?)\s*$/i);
    const item = (why && why[1].split(/\s+/).length <= 6 ? why[1] : '') || items.find((x) => x.split(/\s+/).length <= 5 && stemsOf(x).some((w) => stS.includes(w)));
    if (!item) return null;
    const form = questionForm(q);
    const blank = form === 'plan' ? pickBlank([`how you would use ${item.replace(/\s*\([^)]*\)/g, '')} for it here, and what you would learn first`, `what you would learn first about it, and how`]) : 'whether you have done it at work, and where';
    const d = finish([`I list ${item.replace(/[.\s]+$/, '')} among my skills, and on ${subj} itself the honest answer is [${blank}].`]);
    return valid(d) ? { answer: d, resume_fact: verbatimLine(e) ? e : '', verdict_line: e, shape: 'partly', link: { kind: 'the line the fit check cites', words: [item] } } : null;
  }
  function skillShownDraft(st, q) {
    const e = (st.evidence || []).find(Boolean) || '';
    if (!e || !/,/.test(e) && e.split(/\s+/).length > 4) return null;
    const stS = specific(stemsOf(st.subject || st.text));
    const item = e.replace(/^[^:]{0,30}:\s*/, '').split(/,\s*|;\s*/).map((x) => x.trim()).find((x) => x && x.split(/\s+/).length <= 4 && stemsOf(x).some((w) => stS.includes(w)));
    if (!item) return null;
    const form = questionForm(q);
    const subj = st.subject || dutySubject(st.text, 8);
    const I = sentenceCase(item);
    const d = form === 'plan'
      ? finish([`${I} is one of the skills I bring, and I'd use it for ${subj} here, starting with [${pickBlank(blanksFor('plan', q, st))}].`])
      : finish([`${I} is one of the skills I bring.`, endFor(form, q, pickBlank(blanksFor(form, q, st)))]);
    return valid(d) ? { answer: d, resume_fact: verbatimLine(e) ? e : '', verdict_line: e, shape: 'shown', link: { kind: 'the line the fit check cites', words: [item] } } : null;
  }
  // PARTLY by the verdict: what the résumé shows, said plainly, and the missing part named from the statement's own
  // words ("Putting away inventory hasn't been its own job for me, but at Midwest I do cycle counts …")
  function partlyHonest(st, best, q) {
    const line = best.l;
    const form = questionForm(q);
    const c = clause(line, { max: 22 });
    if (!c) return null;
    const mp = missingPhrase(st);
    const subj = st.subject || dutySubject(st.text, 8);
    const co = line.job.company;
    const at = co ? ` at ${co}` : '';
    const what = mp ? mp.text : subj;
    // the line was told already (twice, or just before): referred back to, the missing part said plainly, one blank
    if (best.asSaid) {
      const short = clause(line, { max: 12 }) || c;
      const blankA = form === 'plan' ? `what you would learn first about ${what}, and how` : form === 'experience' ? `whether ${what} has been part of your work, and one time it came up` : `what you would add for ${what}, from what you do now`;
      const d = finish([`As I said, ${lower1(short)}.`, mp ? `${sentenceCase(mp.text)} ${mp.kind === 'noun' && isPluralNoun(mp.text) ? "haven't" : "hasn't"} been a set part of my job.` : '', `[${sentenceCase(blankA)}.]`]);
      if (valid(d)) return { answer: d, resume_fact: line.text, shape: 'partly', link: best.link, refers_back: true };
    }
    // the hedge is for a partly whose missing part is the HEAD (director round 7): when the line does the head duty and
    // only a detail is missing ("coach the crew during service"), the line is said plainly, then one blank in the form
    const head = dutySubject(st.text, 9);
    const headObj = dutyObject(st.text);
    const hl = head ? linkOf(head, line) : null;
    const detailOnly = hl && (hl.kind === 'same work' || (hl.words || []).length >= 2) && (!mp || (mp.text !== head && !(headObj && mp.text.toLowerCase().includes(headObj.toLowerCase()))));
    if (detailOnly) {
      const plain = pickOpener(claimVariants(line));
      const d = plain ? finish([plain, form === 'plan' ? `${choose(q, START_WITH)(st.subject || head, pickBlank(blanksFor('plan', q, st)))}` : endFor(form, q, pickBlank(blanksFor(form, q, st)))]) : '';
      if (d && valid(d)) return { answer: d, resume_fact: line.text, shape: 'partly', link: best.link };
    }
    const opens = mp && mp.kind === 'gerund'
      ? [`${sentenceCase(mp.text)} hasn't been its own job for me, but${at} ${lower1(c)}.`, `${sentenceCase(mp.text)} hasn't been a set part of my job; the closest I come is${at}, where ${lower1(c)}.`, `Where I stand on ${mp.text}: it hasn't been a set part of my job, but${at} ${lower1(c)}.`]
      : mp
        ? [/\bexperience$/i.test(mp.text) ? `I don't have ${mp.text} as such; the closest I've done is${at}, where ${lower1(c)}.` : `I haven't worked with ${mp.text} as such; the closest I've done is${at}, where ${lower1(c)}.`, `I haven't had ${mp.text} as a set part of my job; the closest I've done is${at}, where ${lower1(c)}.`, `Where I stand on ${mp.text}: I haven't had that as a set part of my job, but${at} ${lower1(c)}.`]
        : [`Part of ${subj} is what I ${line.job.current ? 'do' : 'did'}${at}: ${lower1(c)}.`, `I've done part of ${subj}${at}, where ${lower1(c)}.`];
    const claim = pickOpener(opens);
    const blank = form === 'experience'
      ? pickBlank([`whether ${what} ${mp && mp.kind === 'noun' && isPluralNoun(what) ? 'have' : 'has'} been part of your work, and one time it came up — or the closest moment you remember`, `one time you came closest to ${what}: what you did, and which part was new`])
      : form === 'plan'
        ? pickBlank([`what you would learn first about ${what}, and how`, `how you would get up to speed on ${what} in your first weeks`])
        : pickBlank([`what you do now that comes closest, and what you would add for ${what}`, `how you would handle ${what}, from what you do now`]);
    for (const d of [finish([claim, `[${sentenceCase(blank)}.]`])]) if (valid(d)) return { answer: d, resume_fact: line.text, shape: 'partly', link: best.link };
    return null;
  }
  // PARTLY / RELATED: the closest line, said as the closest
  const strongEnoughForClosest = (b) => b && b.link && (b.link.kind === 'same work' || (b.link.words || []).length >= 2 || b.hit);
  // the closing sentence of a "closest" draft, in the question's own form
  const tail = (st, k) => (curForm === 'plan'
    ? choose(`${st.text}|${k}`, [(b) => `Here I'd start with [${b}].`, (b) => `In this job, my first step would be [${b}].`, (b) => `For this role, I'd begin with [${b}].`])(pickBlank(blanksFor('plan', curQ, st)))
    : endFor(curForm, curQ, pickBlank(blanksFor(curForm, curQ, st))));
  function partlyDraft(st, best) {
    const line = best.l;
    if (!strongEnoughForClosest(best)) return null;
    // the "closest" must be close to the part of the duty the sentence names (never "closest to interviewing experts is
    // lesson planning" when the link was the "clear lessons" half)
    const subjCheck = st.subject || dutySubject(st.text, 8);
    if (best.link && !linkOf(subjCheck, line) && !st.subject) return null;
    if (line.skill) {
      const subj0 = subjCheck;
      const item = `${line.plain.charAt(0).toLowerCase()}${line.plain.slice(1)}`;
      const claim = pickOpener([`The closest I have to ${subj0} is ${item}, one of the skills I bring.`, `On ${subj0}, the nearest thing I bring is ${item}, from my skills.`, `For ${subj0}, I'd lean on ${item}, one of my skills.`]);
      const d = finish([claim, tail(st, 's')]);
      return valid(d) ? { answer: d, resume_fact: line.text, shape: 'partly', link: best.link } : null;
    }
    const c = clause(line, { max: 22 });
    if (!c) return null;
    // the line was told in the answer just before (or twice already): referred back to, then the question's own blank
    if (best.asSaid) { const d = finish([pickOpener(claimVariants(line, { asSaid: true })), tail(st, 'a')]); return valid(d) ? { answer: d, resume_fact: line.text, shape: 'near', link: best.link, refers_back: true } : null; }
    const subj = st.subject || dutySubject(st.text, 8);
    const co = line.job.company;
    const where = co ? ` at ${co}` : '';
    // part of it is plainly on the résumé: say that part, then where you stand with what is missing
    const miss0 = (st.missing || []).filter((m) => realMissing(ctx, m) && m.split(/\s+/).length <= 4)[0];
    if (st.status === 'partly' && best.strength === 'strong') {
      const claim0 = pickOpener(claimVariants(line));
      const end = miss0 && curForm !== 'experience' ? `Where I stand with ${miss0}: [said plainly, and what you would do to close the gap].` : tail(st, 'k');
      const d0 = finish([claim0, end]);
      if (valid(d0)) return { answer: d0, resume_fact: line.text, shape: 'partly', link: best.link };
    }
    // the reader could not judge this duty: the closest line is offered as the closest, never "hasn't been part of my job"
    if (st.status === 'cannot_tell') {
      const d = finish([pickOpener([`The closest example I have is from ${co || 'my work'}, where ${lower1(c)}.`, `The nearest thing I've done is at ${co || 'my last job'}: ${lower1(c)}.`, `My nearest experience is at ${co || 'my last job'}, where ${lower1(c)}.`]), curForm === 'plan' ? `For ${subj} here, I'd start with [${pickBlank(blanksFor('plan', curQ, st))}].` : tail(st, 'n')]);
      return valid(d) ? { answer: d, resume_fact: line.text, shape: 'near', link: best.link } : null;
    }
    const vs = [
      `The closest I've come to ${subj} is${where}, where ${lower1(c)}.`,
      `For ${subj}, the nearest thing I've done is${where}: ${lower1(c)}.`,
      `My nearest experience to ${subj} is${where}, where ${lower1(c)}.`,
      `What comes closest to ${subj} is my work${where}, where ${lower1(c)}.`,
    ];
    const claim = pickOpener(vs);
    const miss = (st.missing || []).filter((m) => realMissing(ctx, m) && m.split(/\s+/).length <= 4)[0];
    const blank = miss && curForm !== 'experience' ? `Where I stand with ${miss}: [said plainly, and what you would do to close the gap].` : tail(st, 'p');
    for (const d of [finish([claim, blank]), finish([claim, curForm === 'experience' ? `[${sentenceCase(pickBlank(blanksFor('experience', curQ, st)))}.]` : '[What you would still need to learn here, and how you would learn it.]'])]) if (valid(d)) return { answer: d, resume_fact: line.text, shape: 'partly', link: best.link };
    return null;
  }
  // NOT SHOWN: the honest frame, only for a real requirement
  function notShownDraft(st, near) {
    // "new to me" only for a named requirement the fit check reads as missing; a soft or collaborative line is asked
    const named = (st.missing || []).filter((m) => (ctx.requirements || []).some((r) => !r.matched && !r.soft && r.label.toLowerCase() === String(m).toLowerCase()));
    // a duty anyone in the field does with others ("assist the store manager", "work with…") is never "new to me"
    const softDuty = /^(?:assist|help|support|work|partner|collaborate|demonstrate|maintain|follow|communicate|participate|contribute)\b/i.test(clean(st.text).replace(LEAD_IN, ''));
    if (!named.length || softDuty || (st.kind === 'duty' && !st.subject)) {
      const sj = st.subject || dutySubject(st.text, 8);
      const d = curForm === 'plan' ? finish([choose(st.text, START_WITH)(sj, pickBlank(blanksFor('plan', curQ, st)))]) : contextFrame(curQ, pickBlank(blanksFor(curForm, curQ, st)), curForm).answer;
      return sj && valid(d) ? { answer: d, resume_fact: '', shape: 'frame1' } : null;
    }
    const subj = st.subject || dutySubject(st.text, 10);
    if (!subj || !realStatement(subj)) return null;
    const S = sentenceCase(subj);
    const isAre = isPluralNoun(subj) && !/ing\b/.test(subj.split(/\s+/)[0]) ? 'are' : 'is';
    const nearC = near ? clause(near.l, { max: 22 }) : null;
    const vs = nearC
      ? [`${S} ${isAre} new to me, and I won't stretch it. The closest I've done is at ${near.l.job.company || 'my last job'}, where ${lower1(nearC)}, and I'd get up to speed by [the first step you would take, and how long it would take].`]
      : [curForm === 'experience' ? `${S} ${isAre} new to me, and I won't stretch it: [the closest thing you have done to ${subj}, and what would be new to you].` : `${S} ${isAre} new to me, and I won't stretch it: [the closest thing you have done, and the first step you would take to learn it].`];
    const draft = finish([pickOpener(vs)]);
    return valid(draft) ? { answer: draft, resume_fact: near ? near.l.text : '', shape: 'not_shown', ...(near ? { link: near.link } : {}) } : null;
  }
  // a behavioural question told from a line: situation/action → result → one blank about the question
  function storyDraft(q, line, { asSaid = false, blank: blankIn = '' } = {}) {
    asSaid = asSaid || (mainUse.get(line.id) || 0) >= 2 || line.id === lastLineId;
    const claim = pickOpener(claimVariants(line, { asSaid, full: /\b(?:typical|busiest|busy) (?:day|shift)\b/i.test(q) }));
    if (!claim) return null;
    const proof = asSaid ? null : proofSentence(q, line, pool, usedProof);
    void 0;
    // the posting's duty this story bears on, so the answer ends on THIS job ("they ask for X; your line shows it")
    // the bridge to a posting statement only on a named link, and never to a schedule or a condition line
    const near = statements.filter((st) => !CONDITION_RE.test(st.text) && st.kind !== 'schedule' && st.kind !== 'physical').map((st) => ({ st, ...proofScore(st.text, line, { verdictLines: st.evidence || [] }) })).filter((x) => x.strength === 'strong' && x.link).sort((a, b) => b.n - a.n)[0];
    const subj = near ? dutySubject(near.st.text, 8) : '';
    const blank = blankIn || storyBlank(q);
    const end = subj ? choose(q, LINES_UP)(subj, blank) : choose(`${q}|${line.id}`, [(b) => `[${sentenceCase(b)}.]`, (b) => `The moment I'd tell is [${b}].`, (b) => `What I'd add is [${b}].`])(blank);
    // with no bridge, the blank joins the claim's own sentence (a bare prompt sentence reads like a form)
    const joined = !subj ? `${claim.replace(/\.$/, '')}, and the moment I'd tell is [${blank}].` : '';
    for (const d of [finish([claim, proof && proof.text, end]), ...(joined ? [finish([joined])] : []), finish([claim, end]), finish([claim, `[${sentenceCase(blank)}.]`])]) {
      if (valid(d)) { if (proof && d.includes(proof.text)) usedProof.add(proof.line.id); return { answer: d, resume_fact: line.text, shape: 'story', ...(asSaid ? { refers_back: true } : {}), ...(near && d.includes(subj) ? { link: near.link } : {}) }; }
    }
    return null;
  }
  // a question no line answers: one sentence of context from the latest job + one blank, in the question's form
  function contextFrame(q, blank, form = questionForm(q)) {
    const job = (ctx.sheet.jobs.find((j) => j.current) || ctx.sheet.jobs[0]);
    const title = job ? roleTitle(job.title) : '';
    const co = job ? spokenEmployer(job.company) : '';
    const now = job && job.current;
    const vs = !(title && co) ? [`[${sentenceCase(blank)}.]`]
      : form === 'plan' ? [`Coming from my work as ${aAn(title)} ${title} at ${co}, I'd start with [${blank}].`, `From what I ${now ? 'do' : 'did'} as ${aAn(title)} ${title} at ${co}, my first step would be [${blank}].`]
        : form === 'practice' ? [`As ${aAn(title)} ${title} at ${co}, what I ${now ? 'do' : 'did'} is [${blank}].`, `At ${co}, where I ${now ? 'work' : 'worked'} as ${aAn(title)} ${title}, here is how I ${now ? 'do' : 'did'} it: [${blank}].`]
          : [`One that comes to mind is from my time as ${aAn(title)} ${title} at ${co}: [${blank}].`, `The example I'd use is from ${co}, where I ${now ? 'work' : 'worked'} as ${aAn(title)} ${title}: [${blank}].`];
    return { answer: finish([pickOpener(vs)]), resume_fact: '', shape: 'frame1' };
  }

  // the line of this person's that sits closest to a question with no statement (company/bank questions)
  const nearestForQuestion = (q) => {
    const r = pool.filter((l) => l.said).map((l) => ({ l, n: nearScore(q, l) })).filter((x) => x.n >= 2).sort((a, b) => b.n - a.n);
    return r.find((x) => (mainUse.get(x.l.id) || 0) < 2) || (r[0] && r[0].n >= 4 ? r[0] : null);
  };
  let usedNow = false;
  let lastLineId = null; // the line the answer just before was told from
  // a reference back ("As I said, …") is not a new telling: it never counts against the line's two uses
  const use = (l, o = null) => { usedNow = true; if (o && o.refers_back) return; mainUse.set(l.id, (mainUse.get(l.id) || 0) + 1); };

  const answers = [];
  const groupProof = new Map(); // same-work group → the line that proved it, and how to refer back to it
  const byQ = new Map(pack.answers.map((a) => [a.q, a]));
  const drafts = { three: 0 };
  // "Walk me through one thing you did well at <an earlier employer>" told from a line that bears on nothing this
  // posting asks is filler for this job (the director's trainer read: "a typical busy day at BrightPay")
  const relevant = (text) => statements.some((st) => proofScore(st.text, { ...(pool.find((l) => sameLine(l.text, text)) || { stems: stemsOf(text), concepts: conceptsOf(text), num: false, plain: strip(text), job: { idx: 0 } }) }).strength);
  const VOLUME_FIELDS = new Set(['retail', 'warehouse', 'food', 'hospitality', 'support', 'nursing', 'patient_care', 'logistics', 'manufacturing', 'ops']);
  void relevant;
  const filtered = pack.questions.filter((q) => {
    // "a typical busy day at <employer>" belongs to volume or shift work only (a trainer's prep is not a queue)
    if (/\btypical busy (?:day|shift)\b|\bbusiest (?:day|shift)\b/i.test(q.q) && opts.postingField && !VOLUME_FIELDS.has(opts.postingField)) return false;
    return true;
  });
  // "Walk me through one thing you did well at <employer>" at most once, and only when the pack would otherwise have
  // fewer than 8 questions (coordinator round 4)
  const wt = (q) => /^Walk me through one thing you did well at /.test(q.q);
  const others = filtered.filter((q) => !wt(q));
  const firstWt = filtered.find(wt);
  const questions = filtered.filter((q) => !wt(q) || (q === firstWt && others.length < 8)).map((q) => ({ ...q, origQ: q.q }));
  // at most two questions share a construction: the duty questions take forms an interviewer in this occupation uses
  varyDutyQuestions(questions, { warehouse: /^(?:warehouse|logistics|manufacturing|retail|food)$/.test(String(opts.postingField || '')) || /^(?:warehouse|delivery_logistics|retail|food_service)$/.test(String(opts.family || '')) });
  // no duplicate questions (coordinator round 5): a skill question is dropped when a duty question already covers that
  // statement or tells the same proof line ("experience with shipping" beside "…packing and shipping orders")
  {
    const info = questions.map((q) => { const st = /^Tell me about yourself/.test(q.q) ? null : statementFor(q, byQ.get(q.origQ)); const top = st ? (verdictLineFor(st) || (rankFor(st)[0] || {}).l || null) : null; return { q, st, top, skill: /^Tell me about your experience with /i.test(q.q) }; });
    const drop = new Set();
    const lineKey = (l) => (l ? l.parent || l.id : null);
    for (const x of info) {
      if (!x.st) continue;
      if (info.some((y) => y !== x && info.indexOf(y) < info.indexOf(x) && !drop.has(y.q) && y.q.q === x.q.q)) { drop.add(x.q); continue; }
      if (!x.skill) continue;
      const subj = x.st.subject || x.st.text;
      const other = info.find((y) => y !== x && !drop.has(y.q) && y.st && (!y.skill || info.indexOf(y) < info.indexOf(x)) && ((y.st.id && y.st.id === x.st.id && !/^(?:q|r)$/.test(y.st.id)) || overlap(subj, y.st.subject || y.st.text) >= 0.5 || (x.top && lineKey(x.top) === lineKey(y.top))));
      if (other) drop.add(x.q);
    }
    for (let i = questions.length - 1; i >= 0; i--) if (drop.has(questions[i])) questions.splice(i, 1);
  }
  // the blank a question takes when no line tells it, in the question's own form
  const droppedQs = new Set();
  const formBlank = (qt, st) => { const f = questionForm(qt); return pickBlank(f === 'experience' && !st ? [storyBlank(qt)] : MISTAKE_Q.test(qt) ? [storyBlank(qt)] : blanksFor(f, qt, st)); };
  for (const q of questions) {
    if (/^Tell me about yourself/.test(q.q)) continue;
    const a = byQ.get(q.origQ);
    if (a && a.exercise) { answers.push(a); continue; }
    let out = null;
    curForm = questionForm(q.q);
    curQ = q.q;
    usedNow = false;
    const qt = q.q;
    try {
      if (/^Why are you looking/.test(qt)) out = whyNow(ctx, { role: roleSaid, statements, pickOpener, finish, valid, schedule: opts.schedule });
      if (!out && /\b(?:pay expectations?|pay range|salary|compensation|lowest you would accept|desired pay)\b/i.test(qt)) out = payDraft(ctx, { payText: opts.payText, statements, pool, bestFor, finish, valid, years: opts.years, a });
      // (a pre-drafted script never stands in for an answer the verdict has judged — round 8: that answer follows its row)
      if (!out && a && a.script && !/\[[^\]]*\][^[]*\[/.test(a.answer) && !((st0) => st0 && st0.reader && /^(?:shown|partly|not_shown)$/.test(st0.status))(statementFor(q, a))) out = { ...a, answer: a.answer };
      if (!out && /^Why do you want to work at/.test(qt)) out = whyCompany(ctx, { company, statements, pool, bestFor, pickOpener, finish, valid, jobText: opts.jobText });
      if (!out && /^Why are you looking/.test(qt)) out = whyNow(ctx, { role: roleSaid, statements, pickOpener, finish, valid, schedule: opts.schedule });
      if (!out && /^What do you know about/.test(qt)) out = knowCompany(ctx, { company, role: roleSaid, finish, valid, jobText: opts.jobText, statements });
      if (!out && /\b(?:when (?:could|can) you start|how soon (?:could|can) you start|start date|notice period)\b/i.test(qt)) out = startDraft(ctx, { finish, schedule: opts.schedule, qt });
      if (!out && /\b(?:commute|how far|get (?:here|to work)|relocat\w*)\b/i.test(qt)) out = { answer: finish([`I'm based in ${opts.home || '[your town]'}, and [how you would get here, and how long it takes].`]).replace(/^I'm based in \[your town\], and \[/, "[Where you're based, "), resume_fact: '', shape: 'logistics' };
      if (!out && /\b(?:your availability|what hours|which (?:days|shifts)|open availability|can you work (?:weekends|nights|holidays|overtime)|are you available)\b/i.test(qt)) out = { answer: finish([opts.schedule ? `The posting lists ${sayList(opts.schedule)}. [Whether that works for you, and any fixed limits like school or a second job.]` : `I can work [the days and hours you can work, and any fixed limits like school or a second job].`]), resume_fact: '', shape: 'logistics' };
      if (!out && /\b(?:interviewing (?:anywhere|elsewhere|with)|other (?:interviews|offers|companies|roles))\b/i.test(qt)) out = othersDraft({ statements, finish, company });
      if (!out && /\b(?:walk me through your (?:résumé|resume|background|career)|why you left|why did you leave)\b/i.test(qt)) out = resumeWalk(ctx, { pool, finish, valid });
      if (!out && /^What questions do you have/i.test(qt)) out = { answer: finish(['Two, if that\'s all right.', ...(pack.ask_them || []).slice(0, 2).map((x) => x.q)]), resume_fact: '', shape: 'ask' };
      if (!out && /^Why .+ now\?$/i.test(qt)) out = moveDraft(ctx, qt, { statements, bestFor, pickOpener, finish, valid, pool });
      // the same level of job in a new setting (round 7): what carries over, said from the line that does the posting's
      // head duty, then one blank for what is new there
      const sm = !out && qt.match(/^What will change for you going from (.+) to (.+)\?$/);
      if (sm) {
        const head = coreDuty(statements.filter((x) => x.status === 'shown'));
        const hb = head ? bestFor(head) : null;
        const c = hb ? clause(hb.l, { max: 28 }) : null;
        const blank = `[What is new for you at ${sm[2]} — the place, the pace, the product — and how you would learn it.]`;
        const d = c ? finish([`What carries over as it is: ${lower1(c)}.`, blank]) : finish([`The work itself carries over from ${sm[1]}.`, blank]);
        if (valid(d)) out = { answer: d, resume_fact: c ? hb.l.text : '', shape: 'setting', ...(c ? { link: hb.link } : {}) };
      }
      if (!out && a && a.stepUp) out = { ...a, answer: tidyStepUp(a.answer) };
      // "What makes you ready to step up from X to Y?" with no drafted answer: the person's lead or training line, then
      // the step itself (never a generic prompt)
      const su = !out && qt.match(/^What makes you ready to step up from (.+) to (.+)\?$/);
      if (su) {
        const leadLine = pool.find((l) => l.said && !l.skill && l.job.idx === 0 && (mainUse.get(l.id) || 0) < 2 && l.concepts.some((c) => ['leading', 'coaching', 'onboarding', 'scheduling'].includes(c) || c === 'training'));
        const c = leadLine ? clause(leadLine, { max: 22 }) : null;
        const blank = `[What you would take on first as ${aAn(su[2])} ${su[2]}, and why.]`;
        const d = c ? finish([pickOpener([`As ${aAn(leadLine.job.title)} ${leadLine.job.title} at ${leadLine.job.company}, ${lower1(c)}.`, `At ${leadLine.job.company}, ${lower1(c)}.`]), blank]) : finish([`My work as ${aAn(su[1])} ${su[1]} is where this starts: ${blank.replace(/^\[W/, '[w')}`]);
        if (valid(d)) out = { answer: d, resume_fact: leadLine && c ? leadLine.text : '', shape: 'step_up', ...(leadLine && c ? { link: { kind: 'same work', words: leadLine.concepts.filter((x) => ['leading', 'coaching', 'onboarding', 'scheduling', 'training'].includes(x)) } } : {}) };
      }
      if (!out && (q.changer || a?.changer)) out = changerDraft(ctx, q, { statements, bestFor, pickOpener, finish, valid, pool, fieldLabel: opts.postingFieldLabel, roleSaid });
      if (!out && (q.scenario || a?.scenario)) out = scenarioDraft(q, a, { pool, pickOpener, finish, valid });
      if (!out) {
        const st = statementFor(q, a);
        const form = curForm;
        // a duty asked as "Tell me about a time you …" is still the duty: its own blank, and "I do this now" when shown
        const fromDuty = /^How would you /.test(q.origQ || '') && q.origQ !== qt;
        const story = BEHAVIORAL.test(qt) && !/^Tell me about your experience with/i.test(qt) && !fromDuty;
        if (st && !MISTAKE_Q.test(qt)) {
          const best = bestFor(st);
          // a second question on work an earlier answer already proved builds on it instead of repeating the proof
          // ("Beyond the 120 help-center articles I mentioned, for the sales exercises I'd start with […]") — only on a
          // "how would you … here" question: an experience question tells what the person did
          const prior = best && best.link && best.link.kind === 'same work' ? best.link.words.map((w) => groupProof.get(w)).find((g) => g && g.lineId === best.l.id) : null;
          if (prior && prior.phrase !== 'work' && form === 'plan' && !st.subject && st.status !== 'partly') {
            const subj = dutySubject(st.text, 9);
            const b0 = pickBlank(blanksFor('plan', qt, st));
            const d = finish([pickOpener([`Beyond the ${prior.phrase} I mentioned, for ${subj} I'd start with [${b0}].`, `Building on the ${prior.phrase}, for ${subj} my first step would be [${b0}].`, `Alongside the ${prior.phrase}, for ${subj} I'd begin with [${b0}].`])]);
            if (valid(d)) out = { answer: d, resume_fact: best.l.text, shape: 'builds_on', link: best.link };
          }
          // the verdict decides the shape of every statement it judged: the answer and the job-match row agree
          const judged = st.reader && (st.status === 'shown' || st.status === 'partly' || st.status === 'not_shown');
          if (saidNo(st)) out = saidNoDraft(st, qt);
          // "yes" to a line only the person can answer (no résumé line): said as theirs, in their own word
          else if (st.by === 'you' && st.status === 'shown' && !best && !(st.evidence || []).length) out = saidYesDraft(st, qt);
          else if (judged) {
            if (!out && best && st.status === 'shown') out = shownDraft(st, best, { story, q: qt });
            // shown by a skills item the verdict cites ("assessment design"): said as a skill the person brings
            if (!out && !best && st.status === 'shown') out = skillShownDraft(st, qt);
            else if (!out && best && st.status === 'partly') out = partlyHonest(st, best, qt);
            else if (!out && !best && st.status === 'partly') out = skillPartlyDraft(st, qt);
            // whatever happened above, a shown or partly statement is told from ITS line (round 8): the line said plainly
            // with the question's blank, or — for a line that is no bullet (a job header, a certificate) — said as what it is
            if (!out && (st.status === 'shown' || st.status === 'partly')) out = best ? verdictLineDraft(st, best, qt) : nonBulletDraft(st, qt);
            else if (!out && st.status === 'not_shown' && !CONDUCT_RE.test(st.text)) out = notShownDraft(st, null);
          } else {
            const dutyUnjudged = st.status === 'cannot_tell';
            // a "missing" item the line itself names as the same work ("one-on-one" ← "1:1s") is not missing
            const stillMissing = (st.missing || []).filter((m) => realMissing(ctx, m) && !(best && conceptsOf(m).some((c) => !BROAD.has(c) && best.l.concepts.includes(c))));
            // a line that names the very thing asked about ("experience with SQL" ← "Wrote SQL queries…") plainly does it
            const plainlyDoes = best && !best.l.skill && ((best.hit && !best.audienceMiss) || (!best.audienceMiss && covers(st.text, best) && best.link && best.link.kind === 'same work' && !stillMissing.length));
            if (!out && best && st.status === 'shown' && best.strength !== 'strong' && !plainlyDoes && !story) out = partlyDraft({ ...st, status: 'partly', missing: [] }, best);
            if (!out && best && (st.status === 'shown' || ((dutyUnjudged || st.status === 'partly' || st.status === 'not_shown') && plainlyDoes) || (dutyUnjudged && best.strength === 'strong' && covers(st.text, best)))) out = shownDraft(st, best, { story, q: qt });
            // a change of field: a merely close line is not offered as "the closest" (an electrician's "pull wire" is not
            // "pull requests")
            else if (!out && best && (st.status === 'partly' || st.status === 'not_shown' || dutyUnjudged) && !(opts.fieldMatch === 'different' && best.strength !== 'strong')) out = partlyDraft(st, best);
            else if (!out && !best && (st.status === 'not_shown' || st.status === 'partly') && !CONDUCT_RE.test(st.text)) out = notShownDraft(st, null);
          }
          if (out && best && out.resume_fact) use(best.l, out);
          if (out && best && best.link && best.link.kind === 'same work' && out.shape !== 'builds_on' && out.resume_fact) for (const w of best.link.words) if (!groupProof.has(w)) groupProof.set(w, { lineId: best.l.id, phrase: objectPhrase(best.l) });
        }
        // "What is a result you are proud of?": a measured outcome line outranks a promotion line, and the blank fits the
        // line chosen (director round 8: "cut waste about 15% by changing pars" over "Promoted to trainer after 8 months")
        if (!out && /\b(?:result you are proud|proud of|an achievement|accomplishment)\b/i.test(qt)) {
          const res = pool.filter((l) => l.said && !l.skill && !l.clause && l.num && /\d+(?:\.\d+)?\s*%|\$\d|\bfrom \d|\b(?:cut|reduc\w*|rais\w*|grew|increas\w*|improv\w*|saved|lowered)\b/i.test(l.plain) && (mainUse.get(l.id) || 0) < 2).map((l) => ({ l, n: (/%/.test(l.plain) ? 2 : 0) + (/\b(?:cut|reduc\w*|rais\w*|grew|increas\w*|improv\w*|saved|lowered)\b/i.test(l.plain) ? 2 : 0) - l.job.idx * 0.5 })).sort((x, y) => y.n - x.n).map((x) => x.l)[0];
          if (res) { out = storyDraft(qt, res, { blank: /\bby\s+[a-z]+ing\b/i.test(res.plain) ? 'what made you try it, and how you knew it had worked' : 'how you got there, and how you measured it' }); if (out) use(res, out); }
        }
        if (!out && a && a.resume_fact && !MISTAKE_Q.test(qt)) {
          let line = pool.find((l) => sameLine(l.text, a.resume_fact));
          // (a spent line is still the answer: storyDraft refers back to it)
          // the line the question names best wins over the bank's pairing ("hardest customer" ← the escalations line,
          // not the help-center articles line)
          const near = nearestForQuestion(qt);
          // the bank's own pairing keeps a point (it knows "how do you know it worked" ↔ the line that pulled the numbers)
          const qScore = (l) => (l ? nearScore(qt, l) + (l === line ? 1 : 0) : -1);
          const method = !BEHAVIORAL.test(qt) && HYPOTHETICAL.test(qt);
          // a question about a person or a moment is never answered by a line about writing documents
          if (line && (line.concepts.includes('writing') || line.concepts.includes('materials')) && !/\b(?:wr(?:i|o)te|writing|document|built|build|created?|made|set up|materials?|guide)\b/i.test(qt)) line = null;
          if (!method && near && near.l.said && qScore(near.l) > qScore(line)) line = near.l;
          if (line && line.said && method) {
            // "How do you decide what to post, and how do you know it worked?" — the line is the closest example, the
            // blank is the method
            const c = clause(line, { max: 24 });
            const d = c ? finish([pickOpener([`The closest example I have is from ${line.job.company || 'my work'}, where ${lower1(c)}.`, `What comes to mind is ${line.job.company || 'my last job'}, where ${lower1(c)}.`, `At ${line.job.company || 'my last job'}, ${lower1(c)}.`]), `[${sentenceCase(hypoBlank(qt, form))}.]`]) : '';
            if (d && valid(d)) { out = { answer: d, resume_fact: line.text, shape: 'near' }; use(line); }
          }
          if (!out && line && line.said) { out = storyDraft(qt, line); if (out) use(line, out); }
        }
        if (!out && !MISTAKE_Q.test(qt) && (BEHAVIORAL.test(qt) || q.company)) {
          const near = nearestForQuestion(qt);
          if (near) { out = storyDraft(qt, near.l); if (out) use(near.l, out); }
        }
        if (!out && HYPOTHETICAL.test(qt) && !MISTAKE_Q.test(qt)) {
          const near = nearestForQuestion(qt);
          const nl = near ? linkOf(qt, near.l) : null;
          if (near && near.l.said && nl && (nl.kind === 'same work' || nl.words.length >= 2) && (!st || linkOf(dutySubject(st.text, 8), near.l))) {
            const c = clause(near.l, { max: 22 });
            let d = '';
            // "How do you keep working safely when the pace picks up?" with a safety line on the page: the line is the
            // claim, then one blank — never "the closest I've handled" and a three-part worksheet
            if (form === 'practice' && nl.kind === 'same work') {
              const claim = pickOpener(claimVariants(near.l));
              const proof = claim ? proofSentence(qt, near.l, pool, usedProof) : null;
              const end = endFor('practice', qt, pickBlank(st ? blanksFor('practice', qt, st) : [hypoBlank(qt, 'practice')]));
              for (const x of [finish([claim, proof && proof.text, end]), finish([claim, end])]) if (claim && valid(x)) { d = x; if (proof && x.includes(proof.text)) usedProof.add(proof.line.id); break; }
            } else {
              const blank = pickBlank(st ? blanksFor('plan', qt, st) : [hypoBlank(qt, 'plan')]);
              d = finish([pickOpener([`The closest I've handled is at ${near.l.job.company}, where ${lower1(c)}.`, `The nearest example I have is from ${near.l.job.company}, where ${lower1(c)}.`, `What comes to mind is ${near.l.job.company}, where ${lower1(c)}.`]), `Here I'd start with [${blank}].`]);
            }
            if (d && valid(d)) { out = { answer: d, resume_fact: near.l.text, shape: form === 'practice' ? 'shown' : 'near', link: nl }; use(near.l); }
          }
          // a duty the reader cannot judge and no line shows is never "new to me": it is asked as what you would do
          if (!out && st && (st.status === 'not_shown' || st.status === 'partly') && !CONDUCT_RE.test(st.text)) out = notShownDraft(st, null);
          if (!out && st && form === 'plan') { const sj = dutySubject(st.text, 8); const d = finish([`For ${sj} here, I'd start with [${pickBlank(blanksFor('plan', qt, st))}].`]); if (sj && valid(d)) out = { answer: d, resume_fact: '', shape: 'frame1' }; }
        }
        // a duty question with no line to tell is asked as the duty itself, in the question's own form
        if (!out && /^How would you /.test(q.origQ || '') && st) {
          const sj = st.subject || dutySubject(st.text, 9);
          const d = form === 'plan' ? finish([choose(qt, START_WITH)(sj, pickBlank(blanksFor('plan', qt, st)))]) : contextFrame(qt, pickBlank(blanksFor(form, qt, st)), form).answer;
          if (sj && valid(d)) out = { answer: d, resume_fact: '', shape: 'frame1' };
        }
        if (!out) out = openerFallback(ctx, qt, { company, statements, finish, roleSaid });
        if (!out && HYPOTHETICAL.test(qt) && !MISTAKE_Q.test(qt) && !BEHAVIORAL.test(qt)) out = hypoFrame(ctx, qt, { finish, pickOpener, form });
        if (!out) out = contextFrame(qt, formBlank(qt, st), form);
      }
    } catch (e) { if (process.env.P2_DEBUG) console.error(e); out = null; }
    if (!out) out = a ? { ...a } : { q: qt, answer: '', resume_fact: '' };
    out.answer = String(out.answer || '');
    // the shape fits the question's form: an answer that ends on the other form's blank is told again as a frame
    if (out.answer && validateDraft(out.answer, null, { form: curForm, maxBlanks: 9 }).some((x) => /_in_/.test(x))) out = { ...out, ...contextFrame(qt, formBlank(qt, statementFor(q, a)), curForm), resume_fact: '' };
    // the person's answers (round 7): a statement they said No to is never told from a line, whatever path drafted it;
    // a candidate line is never told as proof — the question's frame is drafted and the line offered as the suggestion
    const stQ = /^(?:Why |What are your pay|When could)/.test(qt) ? null : statementFor(q, a);
    let candidateRow = null;
    if (stQ && saidNo(stQ) && out.shape !== 'said_no') out = { ...saidNoDraft(stQ, qt) };
    else if (stQ && stQ.candidate && stQ.by !== 'you') {
      candidateRow = stQ.candidate;
      // not shown, with a candidate (round 8): the candidate is offered as the closest thing, never stated as doing it
      if (stQ.status === 'not_shown' || (out.resume_fact && sameLine(out.resume_fact, stQ.candidate.line) && !(stQ.evidence || []).some((e) => sameLine(e, stQ.candidate.line)))) { const cc = candidateClosest(stQ, qt); out = cc || { ...contextFrame(qt, formBlank(qt, stQ), curForm), resume_fact: '' }; }
    }
    // no two answers in a pack say the same thing: a repeat ends on what THIS question asks instead
    if (out.answer && answers.some((x) => x.answer === out.answer)) {
      const body = out.answer.replace(/\s*[^.]*\[[^\]]*\][^.]*\.?\s*$/, '').trim();
      const fresh = formBlank(qt, statementFor(q, a));
      out = { ...out, answer: body ? finish([body, `[${sentenceCase(fresh)}.]`]) : contextFrame(qt, fresh, curForm).answer };
      // still the same words: the question's own frame instead
      if (answers.some((x) => x.answer === out.answer)) out = { ...out, ...contextFrame(qt, fresh, curForm), resume_fact: out.resume_fact || '' };
    }
    // a skill question told from a line an earlier answer already told asks the same thing twice: it is dropped
    if (/^Tell me about your experience with /i.test(qt) && out.resume_fact && answers.some((x) => x.resume_fact && sameLine(x.resume_fact, out.resume_fact))) { droppedQs.add(q); if (usedNow) { const l = pool.find((x) => !x.clause && !x.skill && sameLine(x.text, out.resume_fact)); if (l) mainUse.set(l.id, Math.max(0, (mainUse.get(l.id) || 1) - 1)); } continue; }
    // …and an earlier skill question told from the line this answer tells is dropped the same way
    if (out.resume_fact) {
      const k = answers.findIndex((x) => /^Tell me about your experience with /i.test(x.q) && x.resume_fact && sameLine(x.resume_fact, out.resume_fact));
      if (k >= 0) { const gone = answers.splice(k, 1)[0]; const gq = questions.find((x) => x.q === gone.q); if (gq) droppedQs.add(gq); }
    }
    if ((out.answer.match(/\[[^\]]*\]/g) || []).length >= 3) drafts.three++;
    // every answer told from a line counts against that line's two uses (openers, step-up and changer answers too)
    if (out.resume_fact && !usedNow) { const l = pool.find((x) => !x.clause && !x.skill && sameLine(x.text, out.resume_fact)); if (l) use(l, out); }
    commit(out.answer);
    noteBlanks(out.answer);
    const row = { ...(a || {}), ...out, q: qt, ...(q.source ? { source: q.source } : {}), ...(q.origQ !== qt ? { asked_as: q.origQ } : {}) };
    // the candidate line rides on the answer as the suggestion (data only: the card asks the same Yes / No)
    if (candidateRow) { row.candidate = candidateRow; if (!out.resume_fact && !out.closest_line) row.hint = candidateRow.line; }
    // which posting statement this answer is about (the card joins it to its job-match row and the person's Yes / No)
    if (stQ && stQ.reader && stQ.id) row.statementId = stQ.id;
    // the closest line is a hint only while the answer does not already tell a line
    if (out.resume_fact) delete row.hint;
    // a drafted answer is no longer a frame
    if ((row.answer.match(/\[[^\]]*\]/g) || []).length <= 1 && row.frame) delete row.frame;
    // a draft built from the dates, the role and the posting (no single résumé line) is labelled as such on the card
    if (!row.resume_fact && !row.exercise && !row.frame) row.script = true;
    if (row.resume_fact) delete row.script;
    answers.push(row);
    { const ll = row.resume_fact ? pool.find((x) => !x.clause && !x.skill && sameLine(x.text, row.resume_fact)) : null; lastLineId = ll ? ll.id : null; }
  }
  // a hint points at a line only when that line is linked to what the question asks, and never at a line that already
  // proves two answers
  for (const row of answers) {
    if (!row.hint || (row.candidate && sameLine(row.hint, row.candidate.line))) continue;
    const hl = pool.find((l) => !l.clause && sameLine(l.text, row.hint));
    // (the same rule as proof: the same work, or two shared specific words — never "check" alone)
    const hk = hl ? linkOf(row.source || row.q, hl) : null;
    if (hl && ((mainUse.get(hl.id) || 0) >= 2 || !hk || (hk.kind !== 'same work' && (hk.words || []).length < 2))) delete row.hint;
  }
  // the intro is not one of the questions: it may use the strongest line again
  const bestAny = (st) => pool.map((l) => ({ l, ...proofScore(st.text, l, { verdictLines: st.evidence || [] }) })).filter((x) => x.strength).sort((a, b) => (b.strength === 'strong') - (a.strength === 'strong') || b.n - a.n)[0] || null;
  const intro = composeIntro(ctx, { role: roleSaid, company, statements, pool, bestFor: bestAny, finish, valid, base: pack.intro });
  const askThem = composeAskThem(pack.ask_them || [], statements, opts);
  return {
    questions: questions.filter((q) => !droppedQs.has(q)).map((q) => { const c = { ...q }; delete c.origQ; return c; }),
    answers: answers.map(({ shape, ...a }) => ({ ...a, ...(shape ? { draft: shape } : {}) })),
    intro: intro || pack.intro,
    ask_them: askThem,
    statements,
    email_focus: emailFocus(statements, pool),
  };
}

// What only the person can add to a "what would you do" question, from the question itself.
const HYPO_BLANK = [
  [/\bhow do you (?:decide|choose)\b.*\b(?:worked|work)\b/i, 'how you decide — the two or three things you look at first — and the number that tells you it worked'],
  [/\bhow do you decide|what to fix first|who comes first|prioriti/i, 'how you decide: the two or three things you look at first, and who you tell'],
  [/\bfind the cause|troubleshoot|diagnos|root cause|not seen before/i, 'the steps you take to find the cause, with one real example'],
  [/\bcheck\b.*\b(?:numbers?|work|data|figures)\b.*\bright\b|double-check|before you share/i, 'the checks you run before anything goes out, and one time a check caught a mistake'],
  [/\bcannot give|can't give|say no\b/i, 'what you say, and what you offer instead'],
  [/\bshort (?:a|one|two|staffed)|call(?:s|ed)? out|no-?show/i, 'how you move people, and what you drop first'],
  [/\bdignity|privacy|confidential/i, 'the two or three things you always do, and why'],
  [/^How do you\b.*\bsafe(?:ly|ty)?\b/i, 'one busy shift you remember: what you slowed down, and what you never skipped'],
  [/\bquality up|queue is long|busy|rush|peak|behind/i, 'how you keep the pace without cutting corners'],
  [/\bsolved before you close|follow[- ]through|follow up/i, 'how you check it is really solved before you close it'],
  [/\bprospects?\b|\b(?:sales|new|qualified) leads\b|outreach|cold call/i, 'where you find them, and what your first message says'],
  [/\bdifferent from|closing that gap|how are you (?:closing|getting ready)/i, 'what you already know, what is new to you, and how you are closing the gap'],
];
function hypoBlank(q, form = 'plan') {
  const h = HYPO_BLANK.find(([re]) => re.test(String(q)));
  if (h) return h[1];
  // the question's own words when it names its subject ("How do you handle X?" → "how you handle X, and one time …")
  const m = String(q).match(/^How do you (.+?)\?$/i);
  if (m && m[1].split(/\s+/).length <= 10) return form === 'practice' ? `how you ${m[1]}, with one time it mattered` : `how you would ${m[1]}, and how you would know it worked`;
  return form === 'practice' ? 'what you do first, and one time it mattered' : 'what you would do first, and how you would know it worked';
}
function hypoFrame(ctx, q, { finish, pickOpener, form = 'plan' }) {
  const job = ctx.sheet.jobs.find((j) => j.current) || ctx.sheet.jobs[0];
  const blank = hypoBlank(q, form === 'practice' ? 'practice' : 'plan');
  if (!job) return { answer: `My first move would be [${blank}].`, resume_fact: '', shape: 'frame1' };
  const t = roleTitle(job.title), co = spokenEmployer(job.company);
  return { answer: finish([pickOpener([`I'd draw on my time as ${aAn(t)} ${t} at ${co}: [${blank}].`, `In my work at ${co}, my first move would be [${blank}].`, `I'd take this the way I would at ${co}: [${blank}].`])]), resume_fact: '', shape: 'frame1' };
}
// The openers never fall to a generic frame: each has a draft built from the résumé and the posting, one blank.
function openerFallback(ctx, qt, { company, statements, roleSaid = '' }) {
  const hist = ctx.sheet.history || [];
  const job = hist[0];
  const t = job ? roleTitle(job.title) : '', co = job ? spokenEmployer(job.company) : '';
  const top = coreDuty(statements);
  const subj = top ? dutySubject(top.text, 8) : '';
  const shownTop = coreDuty(statements.filter((s) => s.status === 'shown'));
  const shownSubj = shownTop ? dutySubject(shownTop.text, 8) : '';
  const coSaid = company === 'this company' ? 'this company' : company;
  if (/^Why do you want to work at/.test(qt)) {
    // the core of the role is its first DUTY; with none, the job title ("This is a trainer role")
    const lead = subj ? `This role is built around ${subj}` : roleSaid ? `This is ${aAn(roleSaid)} ${roleSaid} role` : job ? `I'd bring my work as ${aAn(t)} ${t} at ${co}` : `I've read the posting closely`;
    return { answer: `${lead}, and [the personal reason ${coSaid} stands out to you — something you have seen or heard yourself].`, resume_fact: '', shape: 'why_company' };
  }
  if (/^Why are you looking/.test(qt) && job) {
    const ended = !job.current && Number.isFinite(job.endYm) ? ` ended in ${yearOf(job.endYm)}` : '';
    const s1 = job.current ? `I've been ${aAn(t)} ${t} at ${co}${job.startYm ? ` since ${yearOf(job.startYm)}` : ''}` : `My role as ${aAn(t)} ${t} at ${co}${ended}`;
    return { answer: `${s1}, and [${job.current ? "what this job offers you that your current one doesn't — never a complaint" : 'why, in one plain sentence: a layoff, a contract ending, a move'}].${shownSubj ? ` What I want next is a job built around ${shownSubj}.` : ''}`, resume_fact: '', shape: 'why_now' };
  }
  if (/^What do you know about/.test(qt)) return { answer: `From what I've read about ${coSaid}, [what they do and who they serve, and why it matters for this job].`, resume_fact: '', shape: 'know' };
  const mv = qt.match(/^Why (.+) now\?$/i);
  if (mv && job) return { answer: `My work so far has been as ${aAn(t)} ${t} at ${co}, and [what draws you to ${mv[1]} now, and how you are getting ready].`, resume_fact: '', shape: 'move' };
  if (/^What makes you want to move from/i.test(qt) && job) return { answer: `My work as ${aAn(t)} ${t} at ${co} is where this started: [what in that work pointed you toward ${subj || 'this job'}].`, resume_fact: '', shape: 'changer' };
  const carry = qt.match(/carry over to “(.+?)”/);
  if (/carry over/i.test(qt) && job) return { answer: `From my work as ${aAn(t)} ${t} at ${co}, what carries over most is [the one or two things that carry over to ${carry ? carry[1].toLowerCase() : 'this job'}, named plainly, and what you would still have to learn].`, resume_fact: '', shape: 'changer' };
  return null;
}

// The forms a duty question takes (coordinator round 4: "five questions in a row were 'How would you <duty> here?'").
const HANDLING = /^(?:load|unload|pick|pack|ship|receive|stock|store|stage|wrap|label|scan|sort|move|deliver|put)$/;
const ACCURACY = /\b(?:inventory|counts?|records?|accura\w*|labels?|scann?\w*|cycle)\b/i;
// "Tell me about a time you …": the duty in the past, never cut to a list of bare verbs ("built, documented,")
function timePhrase(vp) { return verbList(vp.replace(/\s+and\s+(\w+)\b.*$/, (m, w) => (baseVerb(w) && vp.split(/\s+/).indexOf(w) > 2 ? '' : m)), 'past'); }
function timeOk(vp) { const t = timePhrase(vp).replace(/[.,;\s]+$/, ''); const last = t.split(/\s+/).pop() || ''; return t.split(/\s+/).length >= 3 && !/,$/.test(timePhrase(vp).trim()) && !/(?:ed|ought)$/i.test(last) && realStatement(t); }
function varyDutyQuestions(questions, { warehouse = false } = {}) {
  const used = new Map();
  const take = (k) => used.set(k, (used.get(k) || 0) + 1);
  for (const q of questions) {
    const m = String(q.q).match(/^How would you (.+) here\?$/);
    if (!m) { if (/^(?:Tell me about your experience with|Tell me about a time|What do you know|Why )/.test(q.q)) take(q.q.split(/\s+/).slice(0, 4).join(' ')); continue; }
    const vp = m[1];
    const g = dutySubject(vp, 9);
    const v = verbOf(vp);
    const obj = dutyObject(vp).replace(/^(?:accurate|correct|daily|all)\s+/i, '');
    const forms = [];
    if (warehouse && HANDLING.test(v)) forms.push(['check', `What do you check before ${g}?`], ['shift', `Have you done ${g} before? Walk me through a shift.`]);
    if (warehouse && ACCURACY.test(vp) && obj) forms.push(['accurate', `How do you keep ${obj} accurate when it's busy?`]);
    forms.push(['how', `How would you ${vp} here?`], ['approach', `Walk me through how you'd approach ${g}.`], ...(timeOk(vp) ? [['time', `Tell me about a time you ${timePhrase(vp)}.`]] : []), ['month', `What would ${g} look like in your first month here?`]);
    // deterministic by the duty, never more than two of one construction
    const start = hashOf(vp) % forms.length;
    const order = [...forms.slice(start), ...forms.slice(0, start)];
    const pick = order.find(([k]) => (used.get(k) || 0) < 2) || order[0];
    take(pick[0]);
    q.q = pick[1];
  }
}

// how to refer back to a line's work: its object ("I wrote 120 help-center articles and the team's guide" → "120
// help-center articles"), else "work"
function objectPhrase(line) {
  const c = String(line.said || '').replace(/^I\s+\w+\s+/, '').split(/\s+(?:for|across|with|in|on|to|by|at|during|per|using)\s+|,\s*|;\s*/)[0].trim();
  // "cycle counts and help with the yearly physical inventory" → "cycle counts" (an "and <verb>" starts a second action)
  const c1 = c.replace(/\s+and\s+(\w+)\b.*$/, (m, w) => (baseVerb(w) ? '' : m));
  const c2 = c1.split(/\s+/).length > 6 ? c1.split(/\s+and\s+/)[0] : c1;
  return c2 && c2.split(/\s+/).length <= 6 && !/^(?:a|an|the)$/i.test(c2) ? c2.replace(/^(?:a|an|the|my|our)\s+/i, '') : 'work';
}

// how well a line answers a question that names no posting statement: shared specific words and named work
function nearScore(q, l) {
  const qs = specific(stemsOf(q));
  const qc = conceptsOf(q).filter((c) => !BROAD.has(c));
  // a line about writing documents is a weak story for a question about a person or a moment
  const docs = (l.concepts.includes('writing') || l.concepts.includes('materials')) && !qc.includes('writing') && !qc.includes('materials') ? 2 : 0;
  return l.stems.filter((w) => qs.includes(w)).length * 2 + l.concepts.filter((c) => qc.includes(c)).length * 2.5 + (l.num ? 0.3 : 0) - l.job.idx * 0.3 - docs;
}

// ── Openers ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** The posting's own sentence about what the company does, the company's name in place of "we"/"our". */
export function aboutSentence(jobText, company) {
  const co = String(company || '').trim();
  const rows = sectionPosting(jobText);
  const cands = rows.filter((r) => r.kind === 'about' || r.kind === 'intro' || r.kind === 'overview' || r.kind === 'company').map((r) => clean(r.sentence, 300));
  const all = cands.length ? cands : clean(jobText, 4000).split(/(?<=[.!?])\s+/).slice(0, 6);
  const verb = /\b(?:is|are|runs|provides|serves|builds|helps|operates|offers|makes|delivers|connects|supports|cares|manages|designs|creates|has been|was founded|exists)\b/i;
  for (const s of all) {
    if (s.split(/\s+/).length < 6 || s.split(/\s+/).length > 34 || /[?!]$/.test(s) || /\b(?:you|your|apply|candidate|role|position|we are looking|we're looking|seeking|hiring|searching for|looking for|join (?:its|our|the) team)\b/i.test(s)) continue;
    if (!verb.test(s)) continue;
    let t = s.replace(/[.\s]+$/, '');
    if (co && new RegExp(`^${escapeRegExp(co)}\\b`, 'i').test(t)) { /* already names it */ }
    else if (/^(?:We|We're|We’re)\b/i.test(t) && co) t = t.replace(/^We(?:'re|’re)\b/i, `${co} is`).replace(/^We\b/i, co);
    // a sentence that opens "At <company>, …" already names it and stands as written
    else if (!(/^At\s+/i.test(t) && co && new RegExp(escapeRegExp(co), 'i').test(t))) continue;
    t = t.replace(/\bour\b/gi, 'its').replace(/\bwe\b/gi, 'they').replace(/\bus\b/g, 'them');
    if (/\bwe\b|\bour\b/i.test(t)) continue;
    return t;
  }
  return '';
}
function topShown(statements, bestFor) {
  for (const st of statements) {
    // a duty, never a years or "experience with" requirement ("2-5 years of call center experience" is not "calling")
    if (!(st.status === 'shown' || st.status === 'cannot_tell') || CONDITION_RE.test(st.text) || CONDUCT_RE.test(st.text) || LEAD_IN.test(clean(st.text)) || /\b\d+\s*\+?\s*(?:-\s*\d+\s*)?years?\b/i.test(st.text) || !verbOf(st.text)) continue;
    const b = bestFor(st);
    if (b && b.strength === 'strong') return { st, b };
  }
  return null;
}
function whyCompany(ctx, { company, statements, bestFor, pickOpener, finish, valid, jobText }) {
  const about = aboutSentence(jobText, company);
  const top = topShown(statements.filter((s) => s.kind === 'duty' || s.status === 'cannot_tell' || s.status === 'shown'), bestFor);
  const startsWithName = about && company && about.toLowerCase().startsWith(String(company).toLowerCase().slice(0, 4));
  const ab = startsWithName ? about : lcFirst(about);
  const s1 = about ? pickOpener([`From what I've read, ${ab}.`, `What I know is that ${ab}.`]) : '';
  // a claim may only assert what its line asserts: "The part of this job I already do is onboarding new agents" (her
  // words, as -ing), never "Delivering call center training is work I already do"
  const vp = top ? verbPhrase(top.b.l, 9) : null;
  const s2 = top && vp ? `The part of this job I ${top.b.l.job.current ? 'already do' : 'have done before'} is ${doingPhrase(vp)}${top.b.l.job.company ? ` at ${top.b.l.job.company}` : ''}.` : '';
  const blank = `[The personal reason ${company === 'this company' ? 'this company' : company} stands out to you — something you have seen or heard yourself.]`;
  const inline = `and [the personal reason ${company === 'this company' ? 'this company' : company} stands out to you — something you have seen or heard yourself]`;
  const fold = (x) => (x ? `${x.replace(/\.$/, '')}, ${inline}.` : '');
  for (const d of [finish([s1, fold(s2)]), finish([fold(s1)]), finish([fold(s2)]), finish([s1, s2, blank]), finish([s1, blank]), finish([s2, blank])]) if ((d.match(/\[/g) || []).length === 1 && d.replace(/\[[^\]]*\]/, '').trim().split(/\s+/).length >= 8 && valid(d)) return { answer: d, resume_fact: top && d.includes('The part of this job') ? top.b.l.text : '', shape: 'why_company', ...(top && d.includes('The part of this job') ? { link: top.b.link } : {}) };
  return null;
}
function whyNow(ctx, { role, statements, finish, valid, schedule = '' }) {
  const hist = ctx.sheet.history || [];
  const cur = hist.find((h) => h.current) || null;
  // the duty the posting leads with AMONG those the verdict reads as shown (coordinator round 5: never a duty the person
  // only partly shows); with none, the plain frame
  const top = coreDuty(statements.filter((s) => s.status === 'shown'));
  const want = top ? dutySubject(top.text, 9) : '';
  if (cur) {
    const co = spokenEmployer(cur.company);
    const t = roleTitle(cur.title);
    const same = hist.filter((h) => spokenEmployer(h.company) === co);
    const first = same[same.length - 1];
    const since = yearOf((first || cur).startYm);
    const promoted = same.length >= 2 && roleTitle(first.title) !== t;
    const s1 = promoted
      ? `I've been at ${co} since ${since}, and I moved up from ${roleTitle(first.title)} to ${shortAfter(roleTitle(first.title), t)} along the way.`
      : `I've been ${aAn(t)} ${t} at ${co}${since ? ` since ${since}` : ''}.`;
    // the duty the posting leads with is already theirs (coordinator round 6): the reason is never the work itself —
    // it is the setting the POSTING states (its schedule), or the plain frame
    // (a schedule is not a reason for looking — director round 7: never "the posting lists nights…, so […]")
    void schedule;
    const s2 = role ? `This is ${aAn(role)} ${role} role, and [what this one offers you that your current job doesn't — the place, the size, the schedule — never a complaint].` : `[What this job offers you that your current one doesn't — never a complaint.]`;
    for (const d of [finish([s1, s2])]) if (d && valid(d)) return { answer: d, resume_fact: '', shape: 'why_now' };
    const d2 = finish([s1, '[What this job offers you that your current one doesn\'t — never a complaint.]']);
    if (valid(d2)) return { answer: d2, resume_fact: '', shape: 'why_now' };
    return null;
  }
  const last = hist[0];
  if (!last) return null;
  const co = spokenEmployer(last.company), t = roleTitle(last.title);
  const ended = Number.isFinite(last.endYm) ? ` ended in ${last.approx ? yearOf(last.endYm) : `${MONTHS_FULL[last.endYm % 12]} ${yearOf(last.endYm)}`}` : '';
  const d = finish([`My role as ${aAn(t)} ${t} at ${co}${ended}, and [why, in one plain sentence: a layoff, a contract ending, a move].`, want ? `What I want next is a job built around ${want}, which this one is.` : '']);
  return valid(d) ? { answer: d, resume_fact: '', shape: 'why_now' } : null;
}
// "trained customers on setup" / "interview and onboard new agents" said as -ing ("training customers on setup")
function doingPhrase(vp) { return verbList(vp, 'gerund'); }
// "Customer Support Specialist" → "Customer Support Team Lead" is said "… to Team Lead"
function shortAfter(a, b) {
  const x = a.split(/\s+/), y = b.split(/\s+/);
  let k = 0; while (k < x.length - 1 && k < y.length - 1 && x[k].toLowerCase() === y[k].toLowerCase()) k++;
  return k >= 2 ? y.slice(k).join(' ') : b;
}
function knowCompany(ctx, { company, finish, valid, jobText }) {
  // what the posting says the company does, in a normal sentence — or the honest blank only (never "X is hiring a Y for …")
  const about = aboutSentence(jobText, company);
  if (!about) return null;
  for (const d of [`${sentenceCase(about)}, and [one thing you have read or heard about them yourself, and why it matters for this job].`, finish([`${sentenceCase(about)}.`, '[One thing you have read or heard about them yourself, and why it matters for this job.]'])]) if (valid(d)) return { answer: d, resume_fact: '', shape: 'know' };
  return null;
}
function payDraft(ctx, { payText, finish, valid, years, a }) {
  const job = (ctx.sheet.jobs.find((j) => j.current) || ctx.sheet.jobs[0]);
  const why = [years ? `my ${years} ${Number(years) === 1 ? 'year' : 'years'} of related experience` : job ? `my work as ${aAn(roleTitle(job.title))} ${roleTitle(job.title)}` : ''].filter(Boolean);
  if (payText) {
    const range = /\d\s*(?:[–—-]|to)\s*\$?\s?\d/.test(payText);
    const d = finish([range ? `The posting lists ${payText}, and that range works for me.` : `The posting lists ${payText}.`, why.length ? `I'd put myself [where in it you fit] given ${joinList(why)}.` : '[Where in it you fit and why, in one sentence.]']);
    if (valid(d)) return { answer: d, resume_fact: '', shape: 'pay', script: true, ...(a?.reference ? { reference: a.reference } : {}) };
  }
  const d = finish([`I'm looking for [the range you would accept, said as a range]${why.length ? `, based on ${joinList(why)}` : ''}.`]);
  if (valid(d) && d.replace(/\[[^\]]*\]/, '').split(/\s+/).length >= 8) return { answer: d, resume_fact: '', shape: 'pay', ...(a?.reference ? { reference: a.reference } : {}) };
  return { answer: `I'm looking for [the range you would accept, said as a range], and I'm happy to talk about where in it I'd fit.`, resume_fact: '', shape: 'pay', ...(a?.reference ? { reference: a.reference } : {}) };
}
// a bare list is said as a list ("nights, weekends, holidays" → "nights, weekends and holidays")
function sayList(t) { const x = String(t || '').trim(); return /^[\w-]+(?:\s*,\s*[\w-]+){2,}$/.test(x) ? joinList(x.split(/\s*,\s*/)) : x; }
function startDraft(ctx, { finish, schedule, qt }) {
  const cur = (ctx.sheet.history || []).find((h) => h.current);
  const co = cur ? spokenEmployer(cur.company) : '';
  const hours = /\bhours?\b/i.test(qt);
  const last = (ctx.sheet.history || [])[0];
  const ended = !cur && last && Number.isFinite(last.endYm) ? `My last role, at ${spokenEmployer(last.company)}, ended in ${yearOf(last.endYm)}, so I` : 'I';
  const s1 = co ? `I could start [your first possible day, after the notice you owe ${co}].` : `${ended} could start [your first possible day — a date, not "soon"].`;
  // a bare list is said as a list ("nights, weekends, holidays" → "nights, weekends and holidays")
  const sch = sayList(schedule);
  const s2 = sch && sch.split(/\s+/).length >= 3 ? `The posting lists ${sch}${hours ? ", and I'll say plainly if any of that is a problem" : ''}.` : '';
  return { answer: finish([s1, s2]), resume_fact: '', shape: 'logistics' };
}
function othersDraft({ statements, finish }) {
  const top = coreDuty(statements);
  return { answer: finish(['[Whether you are interviewing elsewhere — yes or no, no names needed.]', top ? `This one stands out because it centres on ${dutySubject(top.text, 9)}.` : `This one stands out because of the work itself.`]), resume_fact: '', shape: 'logistics' };
}
function resumeWalk(ctx, { pool, finish, valid }) {
  const hist = ctx.sheet.history || [];
  if (!hist.length) return null;
  const cur = hist[0];
  const co = spokenEmployer(cur.company);
  const t = roleTitle(cur.title);
  const best = pool.filter((l) => l.job.idx === 0 && l.said).sort((a, b) => (b.num + b.result) - (a.num + a.result))[0];
  const s1 = `${cur.current ? "I'm" : 'Most recently I was'} ${aAn(t)} ${t} at ${co}${best ? `, where ${lower1(clause(best, { max: 18 }) || '')}` : ''}.`.replace(/, where \./, '.');
  const prev = hist[1];
  const s2 = prev ? (spokenEmployer(prev.company) === co ? `I started there as ${aAn(roleTitle(prev.title))} ${roleTitle(prev.title)} and moved up.` : `Before that, I was ${aAn(roleTitle(prev.title))} ${roleTitle(prev.title)} at ${spokenEmployer(prev.company)}.`) : '';
  const d = finish([s1, s2, '[Why each move happened in a few words, and why this job is the next step — never a complaint.]']);
  return valid(d) ? { answer: d, resume_fact: best ? best.text : '', shape: 'resume' } : null;
}
function moveDraft(ctx, qt, { statements, bestFor, pickOpener, finish, valid }) {
  const top = topShown(statements, bestFor);
  const subj = (qt.match(/^Why (.+) now\?$/i) || [])[1] || 'this';
  if (top && top.b.link && (top.b.link.kind === 'same work' || top.b.link.words.length >= 2) && linkOf(subj, top.b.l)) {
    const c = clause(top.b.l, { max: 20 });
    const d = finish([pickOpener([`The closest I've come is at ${top.b.l.job.company}, where ${lower1(c)}.`, `I've been doing part of this already at ${top.b.l.job.company}: ${lower1(c)}.`]), `[What draws you to ${subj} now, in one sentence.]`]);
    if (valid(d)) return { answer: d, resume_fact: top.b.l.text, shape: 'move', link: top.b.link };
  }
  return null;
}
function tidyStepUp(answer) {
  // the step-up draft from prepLocal is the person's own lines + one blank; keep at most three sentences before it
  const blank = (answer.match(/\[[^\]]*\]\s*$/) || [''])[0];
  const body = answer.slice(0, answer.length - blank.length).trim();
  const sents = body.split(/(?<=\.)\s+(?=[A-Z])/);
  return [sents.slice(0, 3).join(' '), blank].filter(Boolean).join(' ');
}
function changerDraft(ctx, q, { statements, bestFor, pickOpener, finish, valid, pool, roleSaid }) {
  const top0 = topShown(statements, bestFor) || (() => { for (const st of statements) { const b = bestFor(st); if (b && verbOf(st.text)) return { st, b }; } return null; })();
  // only a named link (the same work, or two shared words) makes a line "the part of my work closest to this job"
  const top = top0 && top0.b.link && (top0.b.link.kind === 'same work' || top0.b.link.words.length >= 2) && !top0.b.l.skill ? top0 : null;
  const cur = ctx.sheet.jobs.find((j) => j.current) || ctx.sheet.jobs[0];
  const mine = cur ? roleTitle(cur.title) : '';
  const co = cur ? spokenEmployer(cur.company) : '';
  const qt = q.q;
  if (/^What makes you want to move/i.test(qt) && top) {
    const c = clause(top.b.l, { max: 18 });
    const d = finish([pickOpener([`As ${aAn(mine)} ${mine} at ${co}, the part of my work closest to this job is that ${lower1(c)}.`]), `[What draws you to ${dutySubject(top.st.text, 8)} as the main part of a job.]`]);
    if (valid(d)) return { answer: d, resume_fact: top.b.l.text, shape: 'changer', link: top.b.link };
  }
  if (/carry over/i.test(qt) && top) {
    const c = clause(top.b.l, { max: 18 });
    const d = finish([pickOpener([`What carries over most directly is this: ${lower1(c)}, and what I'd still have to learn is [said plainly, and how you would learn it].`, `The clearest thing that carries over is from ${top.b.l.job.company}: ${lower1(c)}, and what I'd still have to learn is [said plainly, and how you would learn it].`])]);
    if (valid(d)) return { answer: d, resume_fact: top.b.l.text, shape: 'changer', link: top.b.link };
  }
  if (/prepare/i.test(qt)) { const sj = top ? dutySubject(top.st.text, 7) : ''; return { answer: finish([`Here is what I've done to get ready for ${roleSaid} work${sj ? `, and for ${sj} in particular` : ''}: [a course, a certification or a project — only what is real, and what you learned from it].`]), resume_fact: '', shape: 'changer' }; }
  const gap = (qt.match(/^How would you get up to speed on (.+?), which/i) || [])[1];
  // "new to me" only when no line of theirs does the same work (a nurse who precepted is not new to training)
  const gapLine = gap ? pool.filter((l) => l.said && !l.skill).map((l) => ({ l, link: linkOf(gap, l) })).find((x) => x.link && x.link.kind === 'same work') : null;
  if (gap && gapLine) { const c = clause(gapLine.l, { max: 20 }); const d = finish([`The closest I've done to ${gap} is at ${gapLine.l.job.company}, where ${lower1(c)}.`, `[What you would still need to learn about ${gap} for this job, and how long it would take.]`]); if (c && valid(d)) return { answer: d, resume_fact: gapLine.l.text, shape: 'changer', link: gapLine.link }; }
  if (gap) return { answer: finish([`${sentenceCase(gap)} ${isPluralNoun(gap) ? 'are' : 'is'} new to me, and I won't stretch it.`, `[The first step you would take on ${gap}, and how long it would take.]`]), resume_fact: '', shape: 'changer' };
  return null;
}
function scenarioDraft(q, a, { pool, pickOpener, finish, valid }) {
  const what = (q.q.match(/^Walk me through (?:caring for a patient who needs |an? )(.+?)(?: call)? —/) || [])[1] || 'it';
  const hint0 = a && a.hint ? pool.find((l) => sameLine(l.text, a.hint)) : null;
  const ws = specific(stemsOf(what)).filter((w) => !/^(?:nursin|patien|care|cardia?|electr|system)/.test(w));
  const hint = hint0 && ws.some((w) => hint0.stems.includes(w)) && linkOf(what, hint0) ? hint0 : null;
  const clinical = /\bpatient\b/.test(q.q);
  const blank = clinical ? `what you check first with ${what}, what you do next, and when you call the provider` : `how you find the fault on ${aAn(what)} ${what} job, and how you keep it safe`;
  if (hint && hint.said) {
    const c = clause(hint, { max: 20 });
    const d = finish([pickOpener([`The closest I've done is at ${hint.job.company}, where ${lower1(c)}.`, `At ${hint.job.company}, ${lower1(c)}.`]), `[${sentenceCase(blank)}.]`]);
    if (valid(d)) return { answer: d, resume_fact: hint.text, shape: 'scenario', link: linkOf(what, hint) };
  }
  return { answer: finish([`Here is how I'd talk it through, step by step:`, `[${sentenceCase(blank)}.]`]), resume_fact: '', shape: 'scenario' };
}

// ── The intro ──────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * 2–3 sentences: what the person does and their strongest number; a promotion said as a promotion when two roles are
 * at one employer; one specific link to THIS job from the posting, a blank only when nothing on the résumé connects.
 */
export function composeIntro(ctx, { role, company, statements, pool, bestFor, finish, valid, base = '' }) {
  const hist = ctx.sheet.history || [];
  if (!hist.length) return null;
  // the featured job: the latest in the posting's line of work when the latest is not (the base intro's choice)
  const featured = hist.find((h) => base && new RegExp(`\\b${escapeRegExp(roleTitle(h.title))}\\b`).test(base)) || hist[0];
  const fi = hist.indexOf(featured);
  const co = spokenEmployer(featured.company);
  const t = roleTitle(featured.title);
  const lines = pool.filter((l) => l.job.idx === fi && l.said);
  // the line that best shows what this posting asks for, then the strongest number
  const relevance = (l) => statements.reduce((n, st) => { const s = proofScore(st.text, l); return n + (s.strength === 'strong' ? 2 : s.strength === 'close' ? 0.5 : 0); }, 0);
  // the lead line says what the job IS at its widest (director round 7): the line the verdict cites for the posting's
  // HEAD duty when it sits in this job ("Run the afternoon shift, 6 to 8 broistas…"), else the most relevant line
  const headSt = coreDuty(statements.filter((x) => x.status === 'shown'));
  const headLine = headSt ? lines.find((l) => l.fp && (headSt.evidence || []).some((e) => sameLine(e, l.text))) : null;
  const lead = headLine || [...lines].filter((l) => l.fp).sort((a, b) => relevance(b) + (b.concepts.includes('leading') ? 1 : 0) - relevance(a) - (a.concepts.includes('leading') ? 1 : 0))[0];
  const num = lines.filter((l) => l !== lead && l.num && l.result).sort((a, b) => relevance(b) - relevance(a))[0];
  const now = featured.current;
  const parts = [];
  const grad = String(base || '').match(/^(I (?:just finished|'m finishing) .*?\.)\s+(?=[A-Z][a-z]|I\s)/);
  if (grad) parts.push(grad[1]);
  const leadC = lead ? clause(lead, { max: lead === headLine ? 28 : 20 }) : null;
  const also = slashWork(featured.title);
  parts.push(`${now ? "I'm" : 'Most recently I was'} ${aAn(t)} ${t}${co ? ` at ${co}` : ''}${leadC ? `, where ${lower1(leadC)}` : ''}${also ? `${leadC ? ', and' : ', where'} I ${now ? '' : 'also '}${now ? 'also handle' : 'handled'} ${also}` : ''}.`);
  // a promotion at the same employer, said as one
  const same = hist.filter((h) => spokenEmployer(h.company) === co && h !== featured && (h.startYm || 0) < (featured.startYm || Infinity));
  if (same.length && featured.startYm) {
    const first = same[same.length - 1];
    const ft = roleTitle(first.title);
    const ws1 = ft.split(/\s+/), ws2 = t.split(/\s+/);
    let k = 0; while (k < ws1.length - 1 && k < ws2.length - 1 && ws1[k].toLowerCase() === ws2[k].toLowerCase()) k++;
    const shortNow = k >= 2 ? ws2.slice(k).join(' ') : t;
    parts.push(`I started there as ${aAn(ft)} ${ft}${first.startYm ? ` in ${yearOf(first.startYm)}` : ''} and moved up to ${shortNow} in ${yearOf(featured.startYm)}.`);
  } else {
    const prev = hist.find((h, i) => i !== fi && !h.current && (h.endYm || 0) <= (featured.startYm || 0));
    if (prev && !num) parts.push(`Before that, I was ${aAn(roleTitle(prev.title))} ${roleTitle(prev.title)} at ${spokenEmployer(prev.company)}.`);
  }
  // the lead line already carries a number: no second number sentence (2–3 sentences, not four)
  const realNum = (l) => /\d+(?:\.\d+)?%|\$\d|\b\d{2,}\b|\bfrom \d/.test(l.plain.replace(/\b\d:\d+s?\b/g, ''));
  if (num && !(lead && realNum(lead) && parts.length >= 2)) {
    const c = clause(num, { max: 22 });
    // at most three sentences: a number joins the promotion sentence when it is short enough
    if (c && parts.length >= 2 && !grad) { const joined = `${parts[parts.length - 1].replace(/\.$/, '')}, and ${lower1(c).replace(/^My /, 'my ')}.`; if (joined.split(/\s+/).length <= 32) parts[parts.length - 1] = joined; else parts.push(`${sentenceCase(c)}.`); }
    else if (c) parts.push(`${sentenceCase(c)}.`);
  }
  // the link to this job: the duty this person's lines show most strongly
  let link = null;
  // the motive is the posting's HEAD duty first; nobody is drawn to a job by its problem-handling duty (complaints)
  for (const st of [...(headSt ? [headSt] : []), ...statements.filter((x) => x.kind === 'duty' && x !== headSt), ...statements.filter((x) => x.kind !== 'duty' && x !== headSt)]) {
    if (!(st.kind === 'duty' || st.status === 'shown' || st.status === 'cannot_tell') || CONDITION_RE.test(st.text) || CONDUCT_RE.test(st.text) || PROBLEM_DUTY.test(clean(st.text)) || !verbOf(st.text.replace(LEAD_IN, ''))) continue;
    const b = bestFor(st);
    if (!b || b.strength !== 'strong') continue;
    const vp = verbPhrase(b.l, 9);
    const subj = dutySubject(st.text, 8);
    // the lead line already told it: the link names the duty and does not tell the line twice
    if (subj && lead && b.l.id === lead.id) { link = `What draws me to this role is ${subj}, which is ${b.l.job.current ? 'what I do now' : 'what I did there'}.`; break; }
    if (!vp || !subj) continue;
    // a job still held is present tense throughout; never "close to what I did at <the employer just named>"
    const plainly = coversByClass(st.text, b);
    if (b.l.job.current) link = `What draws me to this role is ${subj}, which is ${plainly ? 'what I do now' : 'close to what I do now'}: I ${verbList(vp, 'present')}.`;
    else if (spokenEmployer(b.l.job.company) === co) link = `What draws me to this role is ${subj}, which is close to what I did there when I ${verbList(vp, 'past')}.`;
    else link = `What draws me to this role is ${subj}, which is close to what I did at ${b.l.job.company} when I ${verbList(vp, 'past')}.`;
    break;
  }
  // the certification the posting names, as the older intro said it ("I hold an OSHA forklift certification.")
  const cert = String(base || '').match(/\bI hold (?:a|an) [^.]{3,90}?(?:certification|license|licence)(?: from [^.]+)?\./);
  if (cert && !parts.some((x) => x.includes(cert[0]))) parts.push(cert[0]);
  const roleLc = String(role || 'this').trim();
  const at = company && company !== 'this company' ? ` at ${company}` : '';
  const topDuty = coreDuty(statements);
  // no line connects: a whole clause from the posting's top duty when it is said whole, else a plain blank — never a
  // clipped fragment inside the prompt ("[the one thing about maintaining the folder structures and naming …]")
  const whole = topDuty && dutySubject(topDuty.text, 40) === dutySubject(topDuty.text, 10) ? dutySubject(topDuty.text, 10) : '';
  const plainLink = whole ? `I'm interested in the ${roleLc} role${at} because it centres on ${whole}, and [what about that drew you].` : `I'm interested in the ${roleLc} role${at} because [what drew you to this role].`;
  parts.push(link || plainLink);
  let d = finish(parts);
  if (valid(d)) return d;
  // shorter: without the number sentence, then without the second sentence; the first line, a credential and the link stay
  const numS = num ? parts.find((x) => x.includes(clause(num, { max: 22 }) || '@@')) : null;
  for (const without of [[numS], [numS, parts[1]]]) { const p = parts.filter((x, i) => i === 0 || i === parts.length - 1 || !without.includes(x)); d = finish(p); if (valid(d)) return d; }
  // last: the first sentence with a shorter line, and the plain link with its one blank
  const plain = `I'm interested in the ${roleLc} role${at} because [what drew you to this role].`;
  const first = `${now ? "I'm" : 'Most recently I was'} ${aAn(t)} ${t}${co ? ` at ${co}` : ''}${lead && clause(lead, { max: 12 }) ? `, where ${lower1(clause(lead, { max: 12 }))}` : ''}.`;
  const g = grad ? [grad[1]] : [];
  const cs = cert ? [cert[0]] : [];
  for (const p of [[parts[0], ...(grad ? [parts[1]] : []), ...cs, plain], [...g, first, ...cs, plain], [...g, first, plain], [...g, first]]) { d = finish(p); if (valid(d)) return d; }
  return null;
}

// ── Ask-them questions: whole questions on THIS posting's duties ──────────────────────────────────────────────────
const ASK_BY_VERB = [
  [/^(?:deliver|train|teach|facilitate|run|conduct|lead|onboard|instruct|host)$/, (o) => `How ${agree(o, 'is')} ${o} run today, and what would you most like to change about ${isPluralNoun(o) ? 'them' : 'it'}?`],
  [/^(?:create|build|design|develop|write|improve|update|revise|produce|prepare)$/, (o) => (isPluralNoun(o) ? `Which of the ${o} need the most work right now, and who owns them today?` : `What state is the ${o} in today, and what would you want changed first?`)],
  [/^(?:track|report|measure|monitor|analy[sz]e|review|evaluate|assess|audit)$/, (o) => `How ${agree(o, 'is')} ${o} measured today, and who looks at the numbers?`],
  [/^(?:coach|mentor|precept|develop|support|counsel)$/, (o) => `What does good coaching of ${o} look like on this team, and how would you know it was working?`],
  [/^(?:partner|collaborate|coordinate|work|liaise)$/, (o) => `Who would I work with most closely on ${o}, and how does that work today?`],
  [/^(?:maintain|ensure|inspect|verify|keep|enforce|follow)$/, (o) => `Where ${agree(o, 'does')} ${o} slip most often today, and what has been tried?`],
  [/^(?:manage|oversee|supervise|own|plan|schedule|direct)$/, (o) => `What state ${agree(o, 'is')} ${o} in today, and what would you want fixed first?`],
  [/^(?:care|provide|administer|document|chart)$/, (o) => `What does a typical day of ${o} look like on this team?`],
];
const PEOPLE_O = /\b(?:cooks|agents|associates|staff|hires|employees|nurses|teachers|reps|representatives|members|cashiers|drivers|technicians|crew|students|learners|trainees|team members)$/i;
const VOLUME_ASK = /^(?:retail|warehouse|food|hospitality|support|nursing|patient_care|logistics|manufacturing|ops)$/;
function composeAskThem(existing, statements, opts) {
  const out = [];
  const seen = new Set();
  for (const st of statements.filter((s) => s.kind === 'duty' || s.importance === 'duty')) {
    if (out.length >= 2) break;
    const v = verbOf(st.text);
    const o = dutyObject(st.text);
    // a state to keep ("Keep the warehouse clean and organized") is asked as the whole duty, never as a fragment
    if (v && !o && CHECK_V.test(v) && STATE_END.test(clean(st.text).replace(/[.;:!]+$/, '')) && !seen.has(v)) {
      const base = dutyBase(st.text, 9);
      const q = `How do you ${base} on a busy ${VOLUME_ASK.test(String(opts.postingField || '')) ? 'shift' : 'week'}, and who owns it?`;
      if (base && base.split(/\s+/).length >= 3 && !validateDraft(q).length) { seen.add(v); out.push({ q }); continue; }
    }
    if (!v || !o || o.split(/\s+/).length > 5 || /\d/.test(o) || /^(?:new )?(?:associates?|team(?: members?)?|staff|employees?|agents?|people|students?|patients?|customers?|members?|hires?)$/i.test(o)) continue;
    // training the people themselves ("Train and coach new cooks") is asked about the training, never "How are new cooks run"
    if (/^(?:deliver|train|teach|onboard|instruct)$/.test(v) && PEOPLE_O.test(o) && !seen.has(v)) { seen.add(v); out.push({ q: `How is training for ${o.replace(/^(?:the|a|an)\s+/i, '')} run today, and what would you most like to change about it?` }); continue; }
    const hit = ASK_BY_VERB.find(([re]) => re.test(v));
    if (!hit) continue;
    const o0 = o.replace(/^(?:the|a|an)\s+/i, '');
    // "How is the shift run today", never "How is shift run" (the article the statement gives its object)
    const q = hit[1](hit === ASK_BY_VERB[0] && new RegExp(`\\bthe\\s+${escapeRegExp(o0)}\\b`, 'i').test(st.text) ? `the ${o0}` : o0);
    const k = v;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ q });
  }
  // the rest: what was there, minus any question that quotes a posting fragment; then the field's own
  for (const x of [...existing, ...(opts.askFallback || [])]) {
    if (out.length >= 4) break;
    if (/[“”"]/.test(x.q)) continue;
    if (/^How does the team use (?:.*\b(?:BLS|CPR|ACLS|PALS|forklift|license|licence|certification|pallet|OSHA|CDL)\b)/i.test(x.q)) continue;
    if (out.some((o) => o.q === x.q)) continue;
    out.push(x);
  }
  for (const q of ['What are the next steps, and when should I expect to hear back?', 'What does success look like in the first six months?', 'What is the biggest challenge the team is working on right now?']) if (out.length < 3 && !out.some((x) => x.q === q)) out.push({ q });
  return out;
}
/** The posting duty the emails name: the one this person's lines show most strongly, as an -ing phrase. */
function emailFocus(statements, pool) {
  const duties = statements.filter((s) => (s.kind === 'duty' || s.importance === 'duty') && !CONDITION_RE.test(s.text) && !CONDUCT_RE.test(s.text));
  const ranked = duties.map((st) => ({ st, n: Math.max(0, ...pool.map((l) => proofScore(st.text, l).n)) })).sort((a, b) => b.n - a.n);
  const pick = ranked.map((r) => dutySubject(r.st.text, 9)).filter(Boolean);
  return { focus: pick[0] || '', focus2: pick[1] || '' };
}

// ── "What this job asks for": the reader's statements, each with shown / partly / not shown and the résumé line ──
// the line sits above the first job on the résumé (the summary)
function inSummary(ctx, line) {
  const f = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const text = f(ctx.resumeText);
  const at = text.indexOf(f(line).slice(0, 40));
  const firstJob = (ctx.sheet.jobs || []).map((j) => text.indexOf(f(spokenEmployer(j.company)))).filter((i) => i > 0);
  return at >= 0 && firstJob.length > 0 && at < Math.min(...firstJob);
}
/**
 * One row per posting statement (the unit every tool prints), in the card's status words: shown → 'shown', partly →
 * 'related', not shown → 'gap'; a duty the reader cannot judge is 'shown' only when a résumé line plainly does it
 * (two specific words or one named piece of the same work), 'related' when a line comes close, else a duty gap. A
 * trait, a schedule or a lifting line is never a row. `statement_status` carries the reader's own word.
 */
function yearsMsg0(st) {
  if (!/\b\d+\s*\+?\s*(?:-\s*\d+\s*)?years?\b|\b(?:one|two|three)\s+years?\b|\b\d+\s+year\b/i.test(st.verdictText || st.text)) return '';
  return (st.whys || [])[0] || '';
}
export function statementRows(ctx, statements, oldRows = []) {
  // ONE verdict (coordinator round 4): the rows are runOptimizer's DISPLAYED statements with the verdict's own status,
  // evidence line and missing words — nothing else decides a status, and no loosely related line is ever borrowed.
  const pool = evidencePool(ctx);
  const rows = [];
  const ask = [];
  const askIds = [];
  const CRED = /\b(?:diploma|GED|degree|bachelor'?s?|baccalaureate|master'?s|associate'?s? degree|licen[cs]e|certif\w*|BLS|ACLS|CPR|PALS|CDL|OSHA|ServSafe|BSN|ADN|RN)\b/i;
  const LANG = /\b(?:bilingual|fluent|spanish|french|mandarin|vietnamese|tagalog|arabic|portuguese|korean|english|read(?:ing)? and writ(?:e|ing))\b/i;
  for (const st of statements) {
    if (!st.reader || st.display === false || st.kind === 'promise') continue;
    // statementId + the verdict's candidate let the card send the person's Yes / No back as `confirmed` (round 8);
    // `evidence` is the verdict's own first line for the statement (data — the card prints `proof` / `say`)
    const base = { label: st.verdictText || st.text, source: 'statement', statementId: st.id, statement_status: st.status, ...((st.evidence || [])[0] ? { evidence: st.evidence[0] } : {}), ...(st.kind === 'duty' ? { duty: true } : {}), ...(st.by ? { by: st.by } : {}), ...(st.candidate ? { candidate: st.candidate } : {}) };
    // a line the person answered (round 7): never "your résumé shows" — their own answer, and their line when they named one
    if (st.by === 'you') {
      const yl = (st.evidence || []).find(Boolean) || '';
      const yb = yl && pool.find((l) => !l.clause && !l.skill && sameLine(l.text, yl));
      const why = st.youWhy || (st.status === 'shown' ? 'You said yes.' : 'You said no.');
      if (st.status === 'cannot_tell') { ask.push(st.verdictText || st.text); askIds.push(st.id); continue; }
      const word = st.status === 'shown' ? 'shown' : st.status === 'not_shown' ? 'gap' : 'partly';
      rows.push({ ...base, status: word, ...(yb && st.status === 'shown' ? { proof: yb.text } : {}), say: why });
      continue;
    }
    // a job's header line ("Team Lead — Wagly Pet Insurance | Tampa, FL | Jan 2022 – Present") is never quoted as proof
    const evLine = (st.evidence || []).find((e) => e && !/\b(?:19|20)\d{2}\s*(?:[–—-]|to)\s*(?:(?:19|20)\d{2}|present|now|current)\b/i.test(e) && !/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+(?:19|20)\d{2}\s*[–—-]/i.test(e)) || '';
    const bullet = evLine && pool.find((l) => !l.clause && !l.skill && sameLine(l.text, evLine));
    const why = (st.whys || [])[0] || '';
    // a long skills line is quoted by the items that name the statement ("coaching"), never whole
    const items = (t) => { const its = String(t || '').replace(/^[^:]{0,30}:\s*/, '').split(/,\s*|;\s*/).map((x) => x.trim()).filter(Boolean); const st0 = specific(stemsOf(st.text)); const hit = its.filter((x) => stemsOf(x).some((w) => st0.includes(w)) || conceptsOf(x).some((c) => !BROAD.has(c) && conceptsOf(st.text).includes(c))); return its.length >= 4 && hit.length && hit.length <= 3 ? hit.join(', ') : t; };
    const quote = (t0) => { const t = items(t0); const c = clean(t, 400).replace(/^[\s•●▪◦*·\-–—]+/, '').replace(/[.\s]+$/, ''); return `“${c.length <= 150 ? c : `${c.slice(0, 147).replace(/\s+\S*$/, '')}…`}”`; };
    // a lapsed or unfinished credential is a fact of the résumé's own dates (expired line): said honestly
    const cred = oldRows.find((r) => (r.status === 'expired' || r.status === 'in progress') && new RegExp(`\\b${escapeRegExp(String(r.label).split(/\s+/)[0])}\\b`, 'i').test(st.text));
    if (cred) { rows.push({ ...base, status: cred.status, say: cred.say }); continue; }
    const yShown = yearsMsg0(st) || (/\b\d+\s*\+?\s*(?:-\s*\d+\s*)?years?\b|\b\d+\s+year\b/i.test(st.verdictText || st.text) ? ((ctx.constraints || []).find((x) => x.kind === 'years' && x.status === 'met' && x.message && Number((String(x.label).match(/(\d+)/) || [])[1]) === Number(((st.verdictText || st.text).match(/(\d+)/) || [])[1])) || {}).message || '' : '');
    if (st.status === 'shown' && yShown) { rows.push({ ...base, status: 'shown', say: yShown }); continue; }
    if (st.status === 'shown') {
      // a credential, diploma, licence or language that is met is simply met
      if (CRED.test(st.text) || LANG.test(st.text)) { rows.push({ ...base, status: 'you have it', ...(bullet ? { proof: bullet.text } : {}), say: evLine && !bullet ? quote(evLine) : !evLine && why ? why : '' }); continue; }
      if (bullet) rows.push({ ...base, status: 'shown', proof: bullet.text, say: '' });
      else if (evLine) rows.push({ ...base, status: 'shown', say: `${inSummary(ctx, evLine) ? 'In your summary' : /,/.test(evLine) ? 'In your skills' : 'On your résumé'}: ${quote(evLine)}.` });
      else rows.push({ ...base, status: 'shown', say: why });
      continue;
    }
    const yearsMsg = /\b\d+\s*\+?\s*(?:-\s*\d+\s*)?years?\b/i.test(st.text) ? (why || ((ctx.constraints || []).find((x) => x.kind === 'years' && x.message && Number((String(x.label).match(/(\d+)/) || [])[1]) === Number((st.text.match(/(\d+)/) || [])[1])) || {}).message || '') : '';
    if (st.status === 'partly') {
      // what is missing, in plain words: never a bare verb ("deliver"), a number or "one"
      const miss = [...new Set((st.missing || []).filter(Boolean).map((m) => String(m).replace(/\b(\S+)\s+\1\b/gi, '$1')).filter((m) => !/^(?:one|two|\d[\d\s+-]*)$/i.test(m) && !(m.split(/\s+/).length === 1 && baseVerb(m)) && m.length > 2))];
      if (yearsMsg) { const mpY = missingPhrase(st); rows.push({ ...base, status: 'partly', say: `${yearsMsg}${mpY ? ` Your résumé does not name ${mpY.text}; if they ask, say plainly what you have.` : ''}` }); continue; }
      // a licence or certification read as partly: the credential's own honest script (the one it holds, the one asked)
      if (CRED.test(st.text) && !/\b(?:diploma|GED|degree|bachelor)/i.test(st.text)) {
        const credRow = oldRows.find((r) => r.status === 'gap' && (r.kind === 'credential' || /\b(?:licen[cs]e|certif\w*)/i.test(r.label)) && (st.text.toLowerCase().includes(String(r.label).toLowerCase()) || overlap(st.text, r.label) >= 0.6));
        rows.push({ ...base, status: 'partly', kind: 'credential', ...(bullet ? { proof: bullet.text } : {}), say: credRow ? credRow.say : 'If you hold it, say so plainly and when it expires; if not, say where you are with it.' });
        continue;
      }
      // the missing part is said from the statement's own words, never the reader's fragment ("Not shown: put away")
      const mp = missingPhrase(st);
      // what the line shows, said as -ing and cut before its first preposition ("prepping, cooking and plating dishes")
      const said0 = bullet ? (clause(bullet, { max: 40 }) || '').replace(/^I\s+/, '') : '';
      const vpS = said0 && !/^(?:was|am)\b/.test(said0) ? said0.split(/\s+(?:on|for|across|at|in|with|using|by|to|during|from|while|through)\s+|;\s+|,\s+and\s+(?=[a-z]+\s)/)[0].split(/\s+and\s+(?=[a-z]+ed\b)/)[0].replace(/,?\s+and\s+([a-z]+)$/, (m, w) => (baseVerb(w) ? '' : m)) : '';
      const shownPart = bullet ? (vpS && vpS.split(/\s+/).length >= 2 && vpS.split(/\s+/).length <= 9 ? doingPhrase(vpS) : objectPhrase(bullet)) : '';
      const subjP = dutySubject(st.text, 10);
      const sayMiss = mp && shownPart && shownPart !== 'work'
        ? `Your résumé shows ${shownPart} but not ${mp.text}; if they ask, say plainly whether you have done it.`
        : mp ? `Your résumé does not show ${mp.text}; if they ask, say plainly whether you have done it.`
          : shownPart && shownPart !== 'work' && subjP ? `Your résumé shows ${shownPart}, which covers part of ${subjP}; if they ask, say plainly what you have and have not done.`
            : '';
      rows.push({ ...base, status: 'partly', ...(bullet ? { proof: bullet.text } : {}), say: `${!bullet && evLine ? `On your résumé: ${quote(evLine)}. ` : ''}${sayMiss || (miss.length ? 'Part of it is on your résumé — if they ask, say plainly what you have and have not done.' : why || 'Part of it is on your résumé — say what you have done and what is new.')}` });
      continue;
    }
    if (st.status === 'not_shown') {
      // a diploma or a degree is asked, never asserted
      if (/\b(?:diploma|GED|degree|bachelor'?s?|baccalaureate|master'?s|associate'?s? degree)\b/i.test(st.text)) { rows.push({ ...base, status: 'gap', kind: 'credential', say: 'Not shown on your résumé. If you have it, add it to your education section before the interview. If they ask: “[Your highest diploma or degree, where, and the year.]”' }); continue; }
      if (yearsMsg) { rows.push({ ...base, status: 'gap', say: `${yearsMsg.replace(/[.\s]+$/, '')} — don't round up; say what you have and what you did with it.` }); continue; }
      // a licence or certification asked for: the closest one the résumé holds (the older credential script)
      const credRow = oldRows.find((r) => r.status === 'gap' && (r.kind === 'credential' || /\b(?:licen[cs]e|certif\w*)/i.test(r.label)) && (st.text.toLowerCase().includes(String(r.label).toLowerCase()) || overlap(st.text, r.label) >= 0.6));
      if (credRow) { rows.push({ ...base, status: 'gap', kind: 'credential', say: credRow.say }); continue; }
      const subj = dutySubject(st.text, 10);
      const specificReq = subj && realStatement(subj) && !CONDUCT_RE.test(st.text) && !CONDITION_RE.test(st.text) && st.kind !== 'physical' && st.kind !== 'schedule';
      // a not_shown line is a GAP row whatever it is (coordinator round 6): "only you can say" holds cannot_tell only.
      // A line that is not a specific requirement worth a script is simply listed as not on the résumé.
      if (!specificReq) {
        const cond = st.kind === 'physical' || st.kind === 'schedule' || CONDITION_RE.test(st.text);
        rows.push({ ...base, status: 'gap', say: cond ? `Your résumé cannot show ${subj || 'this'}, so have a plain yes or no ready.` : `Your résumé does not mention ${subj || 'this'}; if it comes up, say plainly what you have done.` });
        continue;
      }
      const isAre = isPluralNoun(subj) && !/ing$/.test(subj.split(/\s+/)[0]) ? 'are' : 'is';
      void isAre;
      // honest without denying: the résumé may simply not say it in these words
      rows.push({ ...base, status: 'gap', say: `Your résumé does not show ${subj} in its own words, so if they ask, say plainly what you have and have not done: “[What you have done that comes closest, and what would be new to you.]”` });
      continue;
    }
    // cannot_tell: lifting, stairs, hours, "reliable" — only the person can say
    ask.push(st.verdictText || st.text); askIds.push(st.id);
  }
  if (ask.length) rows.push({ label: ask.join(' · '), source: 'statement', status: 'only you can say', ask: true, items: ask, statementIds: askIds, say: (() => { const first = dutySubject(ask[0], 6) || ask[0]; return ask.length === 1 ? `A résumé cannot show ${first}, so have a yes or no and one example ready.` : `A résumé cannot show these (${first} and the rest), so have a yes or no and one example ready for each.`; })() });
  if (!statements.some((s) => s.reader)) return oldRows;
  return rows;
}
