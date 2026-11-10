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
  ['leading', /\b(?:(?:led|lead|managed|ran|run) (?:people|a shift|the shift|shifts)|lead (?:a |the )?(?:team|crew|staff)|led (?:a |the )?(?:team|crew|staff)|team of \d|crew of \d|supervis\w*|manag\w* (?:a |the )?(?:team|staff|crew|associates|agents)|direct reports?|charge nurse|shift lead|foreman)/i],
  ['scheduling', /\b(?:schedul\w*|rosters?|staffing|coverage|labor (?:hours|budget)|shift plans?)/i],
  ['customers', /\b(?:customers?|guests?|callers?|clients?|members?|shoppers?|patrons?)\b/i],
  ['calls', /\b(?:calls?|phone|chats?|tickets?|inbound|outbound|queue|contact cent\w*|call cent\w*)\b/i],
  ['process', /\b(?:improv\w*|streamlin\w*|redesign\w*|rebuil\w*|automat\w*|cut|reduc\w*|standardi[sz]\w*)\b/i],
  ['inventory', /\b(?:inventor\w*|cycle counts?|stock\w*|replenish\w*|shrink|SKUs?|counts?)\b/i],
  ['safety', /\b(?:safety|OSHA|incidents?|injur\w*|hazard\w*|lockout|PPE)\b/i],
  ['warehouse', /\b(?:pick\w*|pack\w*|ship\w*|load\w*|unload\w*|forklifts?|pallets?|RF scan\w*|WMS|putaway|dock)\b/i],
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
export const CONDITION_RE = /\b(?:schedules?|full[- ]time|part[- ]time|hours|shifts?|on-?site|remote|hybrid|location|travel|pay|salary|wages?|weekends?|holidays?|available|availability|overtime|commute|background check|drug (?:test|screen)|lift(?:ing)?|pounds|lbs)\b/i;
/** The posting's core duty: the first duty-led statement that is work, not a condition or a trait. */
export function coreDuty(statements) {
  return (statements || []).find((s) => (s.kind === 'duty' || s.importance === 'duty') && verbOf(s.text) && (s.text.match(/,/g) || []).length < 3 && !LEAD_IN.test(clean(s.text)) && !/\b\d+\s*\+?\s*(?:-\s*\d+\s*)?years?\b/i.test(s.text) && !CONDITION_RE.test(s.text) && !CONDUCT_RE.test(s.text) && realStatement(s.text) && dutySubject(s.text, 9)) || null;
}
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
    for (const s of fromReader) out.push({ id: s.id, text: labelToDuty(clean(s.text, 200), duties), verdictText: clean(s.text, 240), display: s.display !== false, status: s.status, evidence: (s.evidence || []).map((e) => e.line).filter(Boolean), whys: (s.evidence || []).filter((e) => !e.line && e.why).map((e) => clean(e.why, 240)), missing: s.missing || [], kind: s.kind, importance: s.importance, reader: true });
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
  if (thing) return /^[A-Z][a-z]+\b/.test(out) && !/^[A-Z][a-z]+\s+[A-Z]/.test(out) ? out.charAt(0).toLowerCase() + out.slice(1) : out;
  return gerundPhrase(out);
}
// the thing a duty acts on, said as a noun phrase ("new-hire training", "trainee progress", "the training materials")
export function dutyObject(text) {
  const t = clean(text).replace(/[.;:!]+$/, '').replace(LEAD_IN, '');
  const ws = t.split(/\s+/);
  let i = 0;
  while (i < ws.length && (verbBase(ws[i].replace(/,$/, '').toLowerCase()) && !/(?:ing|ed)$/i.test(ws[i]) || /^(?:and|or|&)$/i.test(ws[i]))) i++;
  if (!i) return '';
  // "Follow up with, execute, and document doctors' orders": the object comes after the last verb of the list
  const lastVerb = ws.reduce((k, w, j) => (j >= i && baseVerb(w.replace(/,$/, '').toLowerCase()) && !/(?:ing|ed|s)$/i.test(w.replace(/,$/, '')) ? j : k), -1);
  if (lastVerb >= i && ws.slice(i, lastVerb).some((w) => /,$/.test(w))) i = lastVerb + 1;
  if (/^(?:up|out|off|in|on|with|to|for|over|through|back)$/i.test(ws[i] || '')) return '';
  const rest = ws.slice(i).join(' ').split(/\s+(?:for|with|through|from|to|across|by|on|at|in|into|so|while|and report|and build|and ensure)\s+|,\s*/i)[0].replace(/^(?:the|a|an|all|any|our|your)\s+/i, '');
  const n = rest.split(/\s+/).length;
  return n >= 1 && n <= 6 && !/^(?:and|or)$/i.test(rest) ? rest : '';
}
const verbOf = (text) => { const w = clean(text).replace(LEAD_IN, '').split(/\s+/)[0] || ''; return verbBase(w.replace(/,$/, '').toLowerCase()) || ''; };

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
  const o = DUTY_OBJECT_BLANK.find(([re]) => re.test(head));
  if (o) return o[1];
  const v = verbOf(text);
  const hit = DUTY_BLANK.find(([re]) => re.test(v));
  return hit ? hit[1] : 'what you would do first here, and why';
}
// What only the person can add to a story, by what the QUESTION asks (never another requirement's words).
const STORY_BLANK = [
  [/\b(?:hardest|difficult|angry|upset|frustrated|rude|demanding)\s+(customer|guest|patient|client|caller|member|parent|student)/i, (m) => `the ${m[1].toLowerCase()} you remember: what they needed, and how it ended`],
  [/\b(?:caught|change in (?:a |the )?(?:patient|client|resident)'?s? condition|deteriorat)/i, () => 'the change you caught: what you noticed first, and who you called'],
  [/\b(?:mistake|got (?:a |something |one )?(?:detail )?wrong|went wrong|failed|failure)\b/i, () => 'what went wrong, how you found it, and what you changed after'],
  [/\b(?:disagree\w*|pushed back|conflict)\b/i, () => 'what the other person wanted, how you made your case, and how it was settled'],
  [/\b(?:system you built|trade-?offs?)\b/i, () => 'the trade-off you made, and what you would change now'],
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
  const t = String(q).match(/\b(?:a time|an example of (?:a time )?when|a situation where|when)\s+(you\s+.+?)[.?]?$/i);
  if (t && t[1].split(/\s+/).length <= 14) return `the time ${t[1].replace(/\?$/, '')}: what was going on, and how it ended`;
  return 'the moment itself: what was going on, what you did, and how it ended';
}

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
function claimVariants(line, { exact = false } = {}) {
  const c = clause(line);
  if (!c) return [];
  const { company: co, title, current } = line.job;
  const body = lower1(c);
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
in-person sounds sound won't stretch fit close fit means mean put myself given related based along puts centre center built around example examples pick show earlier current nearest covers cover lines line fits moment stand ended want next recently come came nearest noticed handled hold certification license licence mind far toward towards pointed started began set carries carry ready step up use problem handle take move result just finished finishing particular draw nearest experience comes closest lean bring add begin role took beyond mentioned building alongside january february march april may june july august september october november december
already directly
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
export function validateDraft(text, vocab = null, { maxBlanks = 1 } = {}) {
  const t = String(text || '');
  const issues = [];
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
  const usedOpeners = new Set();
  const mainUse = new Map(); // line id → times used as the main proof
  const usedProof = new Set();
  const company = opts.company || 'this company';
  const roleSaid = opts.roleSaid || opts.role || 'this';
  // the best line for a statement, honouring "one line is the main proof for at most two questions"
  const bestFor = (st) => {
    // "Tell me about your experience with SQL": a line that names SQL comes first
    const subjWords = st.subject ? stemsOf(st.subject).filter((w) => w.length >= 2 && !GENERIC.test(w)) : [];
    const ranked = pool.filter((l) => !l.skill || st.status !== 'shown').map((l) => { const p = proofScore(st.text, l, { verdictLines: st.evidence || [] }); const hit = !!(subjWords.length && !p.audienceMiss && subjWords.every((w) => l.stems.includes(w))); return { l, ...p, hit, n: p.n + (hit ? 3 : 0), strength: hit ? 'strong' : p.strength, link: p.link || (hit ? { kind: 'shared words', words: [st.subject] } : null) }; }).filter((x) => x.strength).sort((a, b) => (b.hit - a.hit) || (b.strength === 'strong') - (a.strength === 'strong') || ((b.link && b.link.kind === 'same work') - (a.link && a.link.kind === 'same work')) || b.n - a.n);
    // the only line that names the thing asked about is its proof, however often it has been told
    if (ranked[0] && ranked[0].hit) return ranked[0];
    // one line is the main proof for at most two questions — unless no other line speaks to this one at all
    return ranked.find((x) => (mainUse.get(x.l.id) || 0) < 2) || (ranked[0] && ranked[0].strength === 'strong' ? ranked[0] : null);
  };
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
  const valid = (text) => { const iss = validateDraft(text, vocab); if (iss.length && process.env.P2_DEBUG) console.error('INVALID', iss.join(' '), '::', text); return iss.length === 0; };

  // SHOWN: claim → proof → bridge → one blank
  function shownDraft(st, best, { story = false, q = '' } = {}) {
    const line = best.l;
    // "I do this now" only when the line itself names the work (two specific words, or a named piece of it) — never on
    // the verdict's say-so alone
    // (or when it names the duty's own object as the same work: weekly 1:1s ARE one-on-one feedback — coordinator round 3)
    const exact = !story && (best.shared.length >= 2 || (best.shared.length >= 1 && best.concepts.some((c) => !BROAD.has(c))) || coversByClass(st.text, best));
    const claim = pickOpener(claimVariants(line, { exact }));
    if (!claim) return null;
    const proof = proofSentence(st.subject || st.text, line, pool, usedProof);
    const subj = st.subject || dutySubject(st.text, 9);
    let bridge;
    if (story || !(st.kind === 'duty' || verbOf(st.text))) bridge = `[${sentenceCase(storyBlank(q || st.text))}.]`;
    else {
      const blank = dutyBlank(st.text);
      bridge = choose(`${q}|${st.text}`, [(s0, b) => `I'd bring that to ${s0} here, starting with [${b}].`, ...START_WITH])(subj, st.subject ? dutyBlank(st.subject) : blank);
    }
    const draft = finish([claim, proof && proof.text, bridge]);
    if (valid(draft)) { if (proof) usedProof.add(proof.line.id); return { answer: draft, resume_fact: line.text, shape: 'shown', link: best.link }; }
    const short = finish([claim, bridge]);
    if (valid(short)) return { answer: short, resume_fact: line.text, shape: 'shown', link: best.link };
    return null;
  }
  // PARTLY / RELATED: the closest line, said as the closest
  const strongEnoughForClosest = (b) => b && b.link && (b.link.kind === 'same work' || (b.link.words || []).length >= 2 || b.hit);
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
      const d = finish([claim, choose(`${st.text}|s`, [(b) => `Here I'd start with [${b}].`, (b) => `In this job, my first step would be [${b}].`, (b) => `For this role, I'd begin with [${b}].`])(dutyBlank(st.text))]);
      return valid(d) ? { answer: d, resume_fact: line.text, shape: 'partly', link: best.link } : null;
    }
    const c = clause(line, { max: 22 });
    if (!c) return null;
    const subj = st.subject || dutySubject(st.text, 8);
    const S = sentenceCase(subj);
    const co = line.job.company;
    const where = co ? ` at ${co}` : '';
    // part of it is plainly on the résumé: say that part, then where you stand with what is missing
    const miss0 = (st.missing || []).filter((m) => realMissing(ctx, m) && m.split(/\s+/).length <= 4)[0];
    if (st.status === 'partly' && best.strength === 'strong') {
      const claim0 = pickOpener(claimVariants(line));
      const end = miss0 ? `Where I stand with ${miss0}: [said plainly, and what you would do to close the gap].` : `For ${subj} here, I'd start with [${dutyBlank(st.text)}].`;
      const d0 = finish([claim0, end]);
      if (valid(d0)) return { answer: d0, resume_fact: line.text, shape: 'partly', link: best.link };
    }
    // the reader could not judge this duty: the closest line is offered as the closest, never "hasn't been part of my job"
    if (st.status === 'cannot_tell') {
      const d = finish([pickOpener([`The closest example I have is from ${co || 'my work'}, where ${lower1(c)}.`, `The nearest thing I've done is at ${co || 'my last job'}: ${lower1(c)}.`, `My nearest experience is at ${co || 'my last job'}, where ${lower1(c)}.`]), `For ${subj} here, I'd start with [${dutyBlank(st.text)}].`]);
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
    const obj = dutyObject(st.text);
    const blank = miss ? `Where I stand with ${miss}: [said plainly, and what you would do to close the gap].` : choose(`${st.text}|p`, [(b) => `Here I'd start with [${b}].`, (b) => `In this job, my first step would be [${b}].`, (b) => `For this role, I'd begin with [${b}].`])(dutyBlank(st.text));
    for (const d of [finish([claim, blank]), finish([claim, '[What you would still need to learn here, and how you would learn it.]'])]) if (valid(d)) return { answer: d, resume_fact: line.text, shape: 'partly', link: best.link };
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
      const d = finish([choose(st.text, START_WITH)(sj, dutyBlank(st.text))]);
      return sj && valid(d) ? { answer: d, resume_fact: '', shape: 'frame1' } : null;
    }
    const subj = st.subject || dutySubject(st.text, 10);
    if (!subj || !realStatement(subj)) return null;
    const S = sentenceCase(subj);
    const isAre = isPluralNoun(subj) && !/ing\b/.test(subj.split(/\s+/)[0]) ? 'are' : 'is';
    const nearC = near ? clause(near.l, { max: 22 }) : null;
    const vs = nearC
      ? [`${S} ${isAre} new to me, and I won't stretch it. The closest I've done is at ${near.l.job.company || 'my last job'}, where ${lower1(nearC)}, and I'd get up to speed by [the first step you would take, and how long it would take].`]
      : [`${S} ${isAre} new to me, and I won't stretch it: [the closest thing you have done, and the first step you would take to learn it].`];
    const draft = finish([pickOpener(vs)]);
    return valid(draft) ? { answer: draft, resume_fact: near ? near.l.text : '', shape: 'not_shown', ...(near ? { link: near.link } : {}) } : null;
  }
  // a behavioural question told from a line: situation/action → result → one blank about the question
  function storyDraft(q, line) {
    const claim = pickOpener(claimVariants(line));
    if (!claim) return null;
    const proof = proofSentence(q, line, pool, usedProof);
    void 0;
    // the posting's duty this story bears on, so the answer ends on THIS job ("they ask for X; your line shows it")
    // the bridge to a posting statement only on a named link, and never to a schedule or a condition line
    const near = statements.filter((st) => !CONDITION_RE.test(st.text) && st.kind !== 'schedule' && st.kind !== 'physical').map((st) => ({ st, ...proofScore(st.text, line, { verdictLines: st.evidence || [] }) })).filter((x) => x.strength === 'strong' && x.link).sort((a, b) => b.n - a.n)[0];
    const subj = near ? dutySubject(near.st.text, 8) : '';
    const blank = storyBlank(q);
    const end = subj ? choose(q, LINES_UP)(subj, blank) : choose(`${q}|${line.id}`, [(b) => `[${sentenceCase(b)}.]`, (b) => `The moment I'd tell is [${b}].`, (b) => `What I'd add is [${b}].`])(blank);
    // with no bridge, the blank joins the claim's own sentence (a bare prompt sentence reads like a form)
    const joined = !subj ? `${claim.replace(/\.$/, '')}, and the moment I'd tell is [${blank}].` : '';
    for (const d of [finish([claim, proof && proof.text, end]), ...(joined ? [finish([joined])] : []), finish([claim, end]), finish([claim, `[${sentenceCase(blank)}.]`])]) {
      if (valid(d)) { if (proof && d.includes(proof.text)) usedProof.add(proof.line.id); return { answer: d, resume_fact: line.text, shape: 'story', ...(near && d.includes(subj) ? { link: near.link } : {}) }; }
    }
    return null;
  }
  // a question no line answers: one sentence of context from the latest job + one blank about the question
  function contextFrame(q, blank) {
    const job = (ctx.sheet.jobs.find((j) => j.current) || ctx.sheet.jobs[0]);
    const title = job ? roleTitle(job.title) : '';
    const co = job ? spokenEmployer(job.company) : '';
    const vs = title && co ? [
      `One that comes to mind is from my time as ${aAn(title)} ${title} at ${co}: [${blank}].`,
      `The example I'd use is from ${co}, where I ${job.current ? "work" : 'worked'} as ${aAn(title)} ${title}: [${blank}].`,
    ] : [`[${sentenceCase(blank)}.]`];
    return { answer: finish([pickOpener(vs)]), resume_fact: '', shape: 'frame1' };
  }

  // the line of this person's that sits closest to a question with no statement (company/bank questions)
  const nearestForQuestion = (q) => {
    const r = pool.filter((l) => l.said).map((l) => ({ l, n: nearScore(q, l) })).filter((x) => x.n >= 2).sort((a, b) => b.n - a.n);
    return r.find((x) => (mainUse.get(x.l.id) || 0) < 2) || null;
  };
  const use = (l) => mainUse.set(l.id, (mainUse.get(l.id) || 0) + 1);

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
  for (const q of questions) {
    if (/^Tell me about yourself/.test(q.q)) continue;
    const a = byQ.get(q.origQ);
    if (a && a.exercise) { answers.push(a); continue; }
    let out = null;
    const qt = q.q;
    try {
      if (/^Why are you looking/.test(qt)) out = whyNow(ctx, { role: roleSaid, statements, pickOpener, finish, valid });
      if (!out && /\b(?:pay expectations?|pay range|salary|compensation|lowest you would accept|desired pay)\b/i.test(qt)) out = payDraft(ctx, { payText: opts.payText, statements, pool, bestFor, finish, valid, years: opts.years, a });
      if (!out && a && a.script && !/\[[^\]]*\][^[]*\[/.test(a.answer)) out = { ...a, answer: a.answer };
      if (!out && /^Why do you want to work at/.test(qt)) out = whyCompany(ctx, { company, statements, pool, bestFor, pickOpener, finish, valid, jobText: opts.jobText });
      if (!out && /^Why are you looking/.test(qt)) out = whyNow(ctx, { role: roleSaid, statements, pickOpener, finish, valid });
      if (!out && /^What do you know about/.test(qt)) out = knowCompany(ctx, { company, role: roleSaid, finish, valid, jobText: opts.jobText, statements });
      if (!out && (/\b(?:pay expectations?|pay range|salary|compensation|lowest you would accept|desired pay)\b/i.test(qt))) out = payDraft(ctx, { payText: opts.payText, statements, pool, bestFor, finish, valid, years: opts.years, a });
      if (!out && /\b(?:when (?:could|can) you start|how soon (?:could|can) you start|start date|notice period)\b/i.test(qt)) out = startDraft(ctx, { finish, schedule: opts.schedule, qt });
      if (!out && /\b(?:commute|how far|get (?:here|to work)|relocat\w*)\b/i.test(qt)) out = { answer: finish([`I'm based in ${opts.home || '[your town]'}, and [how you would get here, and how long it takes].`]).replace(/^I'm based in \[your town\], and \[/, "[Where you're based, "), resume_fact: '', shape: 'logistics' };
      if (!out && /\b(?:your availability|what hours|which (?:days|shifts)|open availability|can you work (?:weekends|nights|holidays|overtime)|are you available)\b/i.test(qt)) out = { answer: finish([opts.schedule ? `The posting lists ${opts.schedule}. [Whether that works for you, and any fixed limits like school or a second job.]` : `I can work [the days and hours you can work, and any fixed limits like school or a second job].`]), resume_fact: '', shape: 'logistics' };
      if (!out && /\b(?:interviewing (?:anywhere|elsewhere|with)|other (?:interviews|offers|companies|roles))\b/i.test(qt)) out = othersDraft({ statements, finish, company });
      if (!out && /\b(?:walk me through your (?:résumé|resume|background|career)|why you left|why did you leave)\b/i.test(qt)) out = resumeWalk(ctx, { pool, finish, valid });
      if (!out && /^What questions do you have/i.test(qt)) out = { answer: finish(['Two, if that\'s all right.', ...(pack.ask_them || []).slice(0, 2).map((x) => x.q)]), resume_fact: '', shape: 'ask' };
      if (!out && /^Why .+ now\?$/i.test(qt)) out = moveDraft(ctx, qt, { statements, bestFor, pickOpener, finish, valid, pool });
      if (!out && a && a.stepUp) out = { ...a, answer: tidyStepUp(a.answer) };
      // "What makes you ready to step up from X to Y?" with no drafted answer: the person's lead or training line, then
      // the step itself (never a generic prompt)
      const su = !out && qt.match(/^What makes you ready to step up from (.+) to (.+)\?$/);
      if (su) {
        const leadLine = pool.find((l) => l.said && !l.skill && l.job.idx === 0 && l.concepts.some((c) => ['leading', 'coaching', 'onboarding', 'scheduling'].includes(c) || c === 'training'));
        const c = leadLine ? clause(leadLine, { max: 22 }) : null;
        const blank = `[What you would take on first as ${aAn(su[2])} ${su[2]}, and why.]`;
        const d = c ? finish([pickOpener([`As ${aAn(leadLine.job.title)} ${leadLine.job.title} at ${leadLine.job.company}, ${lower1(c)}.`, `At ${leadLine.job.company}, ${lower1(c)}.`]), blank]) : finish([`My work as ${aAn(su[1])} ${su[1]} is where this starts: ${blank.replace(/^\[W/, '[w')}`]);
        if (valid(d)) out = { answer: d, resume_fact: leadLine && c ? leadLine.text : '', shape: 'step_up', ...(leadLine && c ? { link: { kind: 'same work', words: leadLine.concepts.filter((x) => ['leading', 'coaching', 'onboarding', 'scheduling', 'training'].includes(x)) } } : {}) };
      }
      if (!out && (q.changer || a?.changer)) out = changerDraft(ctx, q, { statements, bestFor, pickOpener, finish, valid, pool, fieldLabel: opts.postingFieldLabel, roleSaid });
      if (!out && (q.scenario || a?.scenario)) out = scenarioDraft(q, a, { pool, pickOpener, finish, valid });
      if (!out) {
        const st = statementFor(q, a);
        const story = BEHAVIORAL.test(qt) && !/^Tell me about your experience with/i.test(qt);
        if (st && !MISTAKE_Q.test(qt)) {
          const best = bestFor(st);
          // a second question on work an earlier answer already proved builds on it instead of repeating the proof
          // ("Beyond the 120 help-center articles I mentioned, for the sales exercises I'd start with […]")
          const prior = best && best.link && best.link.kind === 'same work' ? best.link.words.map((w) => groupProof.get(w)).find((g) => g && g.lineId === best.l.id) : null;
          // (only on a "how would you…" duty question: an "experience with" or story question tells its own line)
          if (prior && !story && !st.subject) {
            const subj = st.subject || dutySubject(st.text, 9);
            const b0 = dutyBlank(st.text);
            const d = finish([pickOpener([`Beyond the ${prior.phrase} I mentioned, for ${subj} I'd start with [${b0}].`, `Building on the ${prior.phrase}, for ${subj} my first step would be [${b0}].`, `Alongside the ${prior.phrase}, for ${subj} I'd begin with [${b0}].`])]);
            if (valid(d)) out = { answer: d, resume_fact: best.l.text, shape: 'builds_on', link: best.link };
          }
          const shownByVerdict = st.status === 'shown';
          const dutyUnjudged = st.status === 'cannot_tell';
          // a line that plainly does the work is SHOWN, whatever word the reader stopped at ("provide one-on-one
          // performance feedback" ← her weekly 1:1s and call reviews) — unless the reader names a real requirement missing
          // a "missing" item the line itself names as the same work ("one-on-one" ← "1:1s") is not missing
          const stillMissing = (st.missing || []).filter((m) => realMissing(ctx, m) && !(best && conceptsOf(m).some((c) => !BROAD.has(c) && best.l.concepts.includes(c))));
          // a line that names the very thing asked about ("experience with SQL" ← "Wrote SQL queries…") plainly does it
          const plainlyDoes = best && !best.l.skill && ((best.hit && !best.audienceMiss) || (!best.audienceMiss && covers(st.text, best) && best.link && best.link.kind === 'same work' && !stillMissing.length));
          // the reader's "shown" with only a close link of mine is told as the closest, never as the thing itself
          if (!out && best && shownByVerdict && best.strength !== 'strong' && !plainlyDoes && !story) out = partlyDraft({ ...st, status: 'partly', missing: [] }, best);
          if (!out && best && (shownByVerdict || ((dutyUnjudged || st.status === 'partly' || st.status === 'not_shown') && plainlyDoes) || (dutyUnjudged && best.strength === 'strong' && covers(st.text, best)))) out = shownDraft(st, best, { story, q: qt });
          // a change of field: a merely close line is not offered as "the closest" (an electrician's "pull wire" is not
          // "pull requests")
          else if (!out && best && (st.status === 'partly' || st.status === 'not_shown' || dutyUnjudged) && !(opts.fieldMatch === 'different' && best.strength !== 'strong')) out = partlyDraft(st, best);
          else if (!out && !best && (st.status === 'not_shown' || st.status === 'partly') && !CONDUCT_RE.test(st.text)) out = notShownDraft(st, null);
          if (out && best) use(best.l);
          if (out && best && best.link && best.link.kind === 'same work' && out.shape !== 'builds_on' && out.resume_fact) for (const w of best.link.words) if (!groupProof.has(w)) groupProof.set(w, { lineId: best.l.id, phrase: objectPhrase(best.l) });
        }
        if (!out && a && a.resume_fact && !MISTAKE_Q.test(qt)) {
          let line = pool.find((l) => sameLine(l.text, a.resume_fact));
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
            const d = c ? finish([pickOpener([`The closest example I have is from ${line.job.company || 'my work'}, where ${lower1(c)}.`, `What comes to mind is ${line.job.company || 'my last job'}, where ${lower1(c)}.`, `At ${line.job.company || 'my last job'}, ${lower1(c)}.`]), `[${sentenceCase(hypoBlank(qt))}.]`]) : '';
            if (d && valid(d)) { out = { answer: d, resume_fact: line.text, shape: 'near' }; use(line); }
          }
          if (!out && line && line.said) { out = storyDraft(qt, line); if (out) use(line); }
        }
        if (!out && !MISTAKE_Q.test(qt) && (BEHAVIORAL.test(qt) || q.company)) {
          const near = nearestForQuestion(qt);
          if (near) { out = storyDraft(qt, near.l); if (out) use(near.l); }
        }
        if (!out && HYPOTHETICAL.test(qt) && !MISTAKE_Q.test(qt)) {
          const near = nearestForQuestion(qt);
          const st2 = st || null;
          void st2;
          const nl = near ? linkOf(qt, near.l) : null;
          if (near && near.l.said && nl && (nl.kind === 'same work' || nl.words.length >= 2) && (!st2 || linkOf(dutySubject(st2.text, 8), near.l))) {
            const c = clause(near.l, { max: 22 });
            const blank = st2 ? dutyBlank(st2.text) : 'what you would do first, and who you would bring in';
            const d = finish([pickOpener([`The closest I've handled is at ${near.l.job.company}, where ${lower1(c)}.`, `The nearest example I have is from ${near.l.job.company}, where ${lower1(c)}.`, `What comes to mind is ${near.l.job.company}, where ${lower1(c)}.`]), `Here I'd start with [${blank}].`]);
            if (valid(d)) { out = { answer: d, resume_fact: near.l.text, shape: 'near', link: linkOf(qt, near.l) }; use(near.l); }
          }
          // a duty the reader cannot judge and no line shows is never "new to me": it is asked as what you would do
          if (!out && st2 && (st2.status === 'not_shown' || st2.status === 'partly') && !CONDUCT_RE.test(st2.text)) out = notShownDraft(st2, null);
          if (!out && st2) { const sj = dutySubject(st2.text, 8); const d = finish([`For ${sj} here, I'd start with [${dutyBlank(st2.text)}].`]); if (sj && valid(d)) out = { answer: d, resume_fact: '', shape: 'frame1' }; }
        }
        // a duty question with no line to tell is asked as the duty itself (never a story frame)
        if (!out && /^How would you /.test(q.origQ || '') && st) { const sj = st.subject || dutySubject(st.text, 9); const d = finish([choose(qt, START_WITH)(sj, dutyBlank(st.text))]); if (sj && valid(d)) out = { answer: d, resume_fact: '', shape: 'frame1' }; }
        if (!out) out = openerFallback(ctx, qt, { company, statements, finish, roleSaid });
        if (!out && HYPOTHETICAL.test(qt) && !MISTAKE_Q.test(qt) && !BEHAVIORAL.test(qt)) out = hypoFrame(ctx, qt, { finish, pickOpener });
        if (!out) out = contextFrame(qt, MISTAKE_Q.test(qt) || BEHAVIORAL.test(qt) ? storyBlank(qt) : st ? dutyBlank(st.text) : hypoBlank(qt));
      }
    } catch { out = null; }
    if (!out) out = a ? { ...a } : { q: qt, answer: '', resume_fact: '' };
    out.answer = String(out.answer || '');
    // no two answers in a pack say the same thing: a repeat ends on what THIS question asks instead
    if (out.answer && answers.some((x) => x.answer === out.answer)) {
      const body = out.answer.replace(/\s*[^.]*\[[^\]]*\][^.]*\.?\s*$/, '').trim();
      out = { ...out, answer: finish([body, `[${sentenceCase(storyBlank(qt))}.]`]) };
    }
    if ((out.answer.match(/\[[^\]]*\]/g) || []).length >= 3) drafts.three++;
    commit(out.answer);
    const row = { ...(a || {}), ...out, q: qt, ...(q.source ? { source: q.source } : {}), ...(q.origQ !== qt ? { asked_as: q.origQ } : {}) };
    // the closest line is a hint only while the answer does not already tell a line
    if (out.resume_fact) delete row.hint;
    // a drafted answer is no longer a frame
    if ((row.answer.match(/\[[^\]]*\]/g) || []).length <= 1 && row.frame) delete row.frame;
    // a draft built from the dates, the role and the posting (no single résumé line) is labelled as such on the card
    if (!row.resume_fact && !row.exercise && !row.frame) row.script = true;
    if (row.resume_fact) delete row.script;
    answers.push(row);
  }
  // the intro is not one of the questions: it may use the strongest line again
  const bestAny = (st) => pool.map((l) => ({ l, ...proofScore(st.text, l, { verdictLines: st.evidence || [] }) })).filter((x) => x.strength).sort((a, b) => (b.strength === 'strong') - (a.strength === 'strong') || b.n - a.n)[0] || null;
  const intro = composeIntro(ctx, { role: roleSaid, company, statements, pool, bestFor: bestAny, finish, valid, base: pack.intro });
  const askThem = composeAskThem(pack.ask_them || [], statements, opts);
  return {
    questions: questions.map(({ origQ, ...q }) => q),
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
  [/\bquality up|queue is long|busy|rush|peak|behind/i, 'how you keep the pace without cutting corners'],
  [/\bsolved before you close|follow[- ]through|follow up/i, 'how you check it is really solved before you close it'],
  [/\bprospects?\b|\b(?:sales|new|qualified) leads\b|outreach|cold call/i, 'where you find them, and what your first message says'],
  [/\bdifferent from|closing that gap|how are you (?:closing|getting ready)/i, 'what you already know, what is new to you, and how you are closing the gap'],
];
function hypoBlank(q) { const h = HYPO_BLANK.find(([re]) => re.test(String(q))); return h ? h[1] : 'what you would do first, who you would bring in, and how you would know it worked'; }
function hypoFrame(ctx, q, { finish, pickOpener }) {
  const job = ctx.sheet.jobs.find((j) => j.current) || ctx.sheet.jobs[0];
  const blank = hypoBlank(q);
  if (!job) return { answer: `My first move would be [${blank}].`, resume_fact: '', shape: 'frame1' };
  const t = roleTitle(job.title), co = spokenEmployer(job.company);
  return { answer: finish([pickOpener([`I'd draw on my time as ${aAn(t)} ${t} at ${co}: [${blank}].`, `In my work at ${co}, my first move would be [${blank}].`, `I'd take this the way I would at ${co}: [${blank}].`])]), resume_fact: '', shape: 'frame1' };
}
// The openers never fall to a generic frame: each has a draft built from the résumé and the posting, one blank.
function openerFallback(ctx, qt, { company, statements, finish, roleSaid = '' }) {
  const hist = ctx.sheet.history || [];
  const job = hist[0];
  const t = job ? roleTitle(job.title) : '', co = job ? spokenEmployer(job.company) : '';
  const top = coreDuty(statements);
  const subj = top ? dutySubject(top.text, 8) : '';
  const coSaid = company === 'this company' ? 'this company' : company;
  if (/^Why do you want to work at/.test(qt)) {
    // the core of the role is its first DUTY; with none, the job title ("This is a trainer role")
    const lead = subj ? `This role is built around ${subj}` : roleSaid ? `This is ${aAn(roleSaid)} ${roleSaid} role` : job ? `I'd bring my work as ${aAn(t)} ${t} at ${co}` : `I've read the posting closely`;
    return { answer: `${lead}, and [the personal reason ${coSaid} stands out to you — something you have seen or heard yourself].`, resume_fact: '', shape: 'why_company' };
  }
  if (/^Why are you looking/.test(qt) && job) {
    const ended = !job.current && Number.isFinite(job.endYm) ? ` ended in ${yearOf(job.endYm)}` : '';
    const s1 = job.current ? `I've been ${aAn(t)} ${t} at ${co}${job.startYm ? ` since ${yearOf(job.startYm)}` : ''}` : `My role as ${aAn(t)} ${t} at ${co}${ended}`;
    return { answer: `${s1}, and [${job.current ? "what this job offers you that your current one doesn't — never a complaint" : 'why, in one plain sentence: a layoff, a contract ending, a move'}].${subj ? ` What I want next is a job built around ${subj}.` : ''}`, resume_fact: '', shape: 'why_now' };
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
    forms.push(['how', `How would you ${vp} here?`], ['approach', `Walk me through how you'd approach ${g}.`], ['done', `Have you done ${g} before? Tell me about it.`], ['month', `What would ${g} look like in your first month here?`]);
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
  const c = String(line.said || '').replace(/^I\s+\w+\s+/, '').split(/\s+(?:for|across|with|in|on|to|by|at|during|per)\s+|,\s*|;\s*/)[0].trim();
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
    else if (/^At\s+/i.test(t) && co && new RegExp(escapeRegExp(co), 'i').test(t)) t = t;
    else continue;
    t = t.replace(/\bour\b/gi, 'its').replace(/\bwe\b/gi, 'they').replace(/\bus\b/g, 'them');
    if (/\bwe\b|\bour\b/i.test(t)) continue;
    return t;
  }
  return '';
}
function topShown(statements, bestFor) {
  for (const st of statements) {
    if (!(st.status === 'shown' || st.status === 'cannot_tell') || CONDITION_RE.test(st.text) || CONDUCT_RE.test(st.text) || !verbOf(st.text)) continue;
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
function whyNow(ctx, { role, statements, pickOpener, finish, valid }) {
  const hist = ctx.sheet.history || [];
  const cur = hist.find((h) => h.current) || null;
  const top = coreDuty(statements);
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
    const s2 = want ? `This role is built around ${want}, and [what that offers you that your current job doesn't — never a complaint].` : role ? `This is ${aAn(role)} ${role} role, and [what that offers you that your current job doesn't — never a complaint].` : `[What this job offers you that your current one doesn't — never a complaint.]`;
    // one sentence when it fits: the tenure and THIS job's focus together
    const merged = want ? `${s1.replace(/\.$/, '')}, and this role is built around ${want}, so [what that offers you that your current job doesn't — never a complaint].` : '';
    void merged;
    for (const d of [merged, finish([s1, s2])]) if (d && valid(d)) return { answer: d, resume_fact: '', shape: 'why_now' };
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
function knowCompany(ctx, { company, role, finish, valid, jobText, statements }) {
  // what the posting says the company does, in a normal sentence — or the honest blank only (never "X is hiring a Y for …")
  const about = aboutSentence(jobText, company);
  if (!about) return null;
  for (const d of [`${sentenceCase(about)}, and [one thing you have read or heard about them yourself, and why it matters for this job].`, finish([`${sentenceCase(about)}.`, '[One thing you have read or heard about them yourself, and why it matters for this job.]'])]) if (valid(d)) return { answer: d, resume_fact: '', shape: 'know' };
  return null;
}
function payDraft(ctx, { payText, statements, finish, valid, years, a }) {
  const st = statements.find((s) => s.status === 'shown' && dutySubject(s.text, 8));
  const job = (ctx.sheet.jobs.find((j) => j.current) || ctx.sheet.jobs[0]);
  const why = [years ? `my ${years} years of related experience` : job ? `my work as ${aAn(roleTitle(job.title))} ${roleTitle(job.title)}` : ''].filter(Boolean);
  if (payText) {
    const range = /\d\s*(?:[–—-]|to)\s*\$?\s?\d/.test(payText);
    const d = finish([range ? `The posting lists ${payText}, and that range works for me.` : `The posting lists ${payText}.`, why.length ? `I'd put myself [where in it you fit] given ${joinList(why)}.` : '[Where in it you fit and why, in one sentence.]']);
    if (valid(d)) return { answer: d, resume_fact: '', shape: 'pay', script: true, ...(a?.reference ? { reference: a.reference } : {}) };
  }
  const d = finish([`I'm looking for [the range you would accept, said as a range]${why.length ? `, based on ${joinList(why)}` : ''}.`]);
  if (valid(d) && d.replace(/\[[^\]]*\]/, '').split(/\s+/).length >= 8) return { answer: d, resume_fact: '', shape: 'pay', ...(a?.reference ? { reference: a.reference } : {}) };
  return { answer: `I'm looking for [the range you would accept, said as a range], and I'm happy to talk about where in it I'd fit.`, resume_fact: '', shape: 'pay', ...(a?.reference ? { reference: a.reference } : {}) };
}
function startDraft(ctx, { finish, schedule, qt }) {
  const cur = (ctx.sheet.history || []).find((h) => h.current);
  const co = cur ? spokenEmployer(cur.company) : '';
  const hours = /\bhours?\b/i.test(qt);
  const last = (ctx.sheet.history || [])[0];
  const ended = !cur && last && Number.isFinite(last.endYm) ? `My last role, at ${spokenEmployer(last.company)}, ended in ${yearOf(last.endYm)}, so I` : 'I';
  const s1 = co ? `I could start [your first possible day, after the notice you owe ${co}].` : `${ended} could start [your first possible day — a date, not "soon"].`;
  const s2 = schedule && schedule.split(/\s+/).length >= 3 ? `The posting lists ${schedule}${hours ? ", and I'll say plainly if any of that is a problem" : ''}.` : '';
  return { answer: finish([s1, s2]), resume_fact: '', shape: 'logistics' };
}
function othersDraft({ statements, finish, company }) {
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
function changerDraft(ctx, q, { statements, bestFor, pickOpener, finish, valid, pool, fieldLabel, roleSaid }) {
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
  const lead = [...lines].filter((l) => l.fp).sort((a, b) => relevance(b) + (b.concepts.includes('leading') ? 1 : 0) - relevance(a) - (a.concepts.includes('leading') ? 1 : 0))[0];
  const num = lines.filter((l) => l !== lead && l.num && l.result).sort((a, b) => relevance(b) - relevance(a))[0];
  const now = featured.current;
  const parts = [];
  const grad = String(base || '').match(/^(I (?:just finished|'m finishing) .*?\.)\s+(?=[A-Z][a-z]|I\s)/);
  if (grad) parts.push(grad[1]);
  const leadC = lead ? clause(lead, { max: 20 }) : null;
  const also = slashWork(featured.title);
  parts.push(`${now ? "I'm" : 'Most recently I was'} ${aAn(t)} ${t}${co ? ` at ${co}` : ''}${leadC ? `, where ${lower1(leadC)}` : ''}${also ? `${leadC ? ', and' : ', where'} I ${now ? '' : 'also '}${now ? 'also handle' : 'handled'} ${also}` : ''}.`.replace(/I also handled/, 'I also handled'));
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
  for (const st of [...statements.filter((x) => x.kind === 'duty'), ...statements.filter((x) => x.kind !== 'duty')]) {
    if (!(st.kind === 'duty' || st.status === 'shown' || st.status === 'cannot_tell') || CONDITION_RE.test(st.text) || CONDUCT_RE.test(st.text) || !verbOf(st.text.replace(LEAD_IN, ''))) continue;
    const b = bestFor(st);
    if (!b || b.strength !== 'strong') continue;
    const vp = verbPhrase(b.l, 9);
    const subj = dutySubject(st.text, 8);
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
function composeAskThem(existing, statements, opts) {
  const out = [];
  const seen = new Set();
  for (const st of statements.filter((s) => s.kind === 'duty' || s.importance === 'duty')) {
    if (out.length >= 2) break;
    const v = verbOf(st.text);
    const o = dutyObject(st.text);
    if (!v || !o || o.split(/\s+/).length > 5 || /\d/.test(o) || /^(?:new )?(?:associates?|team(?: members?)?|staff|employees?|agents?|people|students?|patients?|customers?|members?|hires?)$/i.test(o)) continue;
    const hit = ASK_BY_VERB.find(([re]) => re.test(v));
    if (!hit) continue;
    const q = hit[1](o.replace(/^(?:the|a|an)\s+/i, ''));
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
const SKILLS_HEAD = /^(?:skills|technical skills|tools|core competencies)\b/i;
/**
 * One row per posting statement (the unit every tool prints), in the card's status words: shown → 'shown', partly →
 * 'related', not shown → 'gap'; a duty the reader cannot judge is 'shown' only when a résumé line plainly does it
 * (two specific words or one named piece of the same work), 'related' when a line comes close, else a duty gap. A
 * trait, a schedule or a lifting line is never a row. `statement_status` carries the reader's own word.
 */
export function statementRows(ctx, statements, oldRows = []) {
  // ONE verdict (coordinator round 4): the rows are runOptimizer's DISPLAYED statements with the verdict's own status,
  // evidence line and missing words — nothing else decides a status, and no loosely related line is ever borrowed.
  const pool = evidencePool(ctx);
  const rows = [];
  const ask = [];
  const CRED = /\b(?:diploma|GED|degree|bachelor'?s?|baccalaureate|master'?s|associate'?s? degree|licen[cs]e|certif\w*|BLS|ACLS|CPR|PALS|CDL|OSHA|ServSafe|BSN|ADN|RN)\b/i;
  const LANG = /\b(?:bilingual|fluent|spanish|french|mandarin|vietnamese|tagalog|arabic|portuguese|korean|english|read(?:ing)? and writ(?:e|ing))\b/i;
  for (const st of statements) {
    if (!st.reader || st.display === false || st.kind === 'promise') continue;
    const base = { label: st.verdictText || st.text, source: 'statement', statement_status: st.status, ...(st.kind === 'duty' ? { duty: true } : {}) };
    const evLine = (st.evidence || []).find(Boolean) || '';
    const bullet = evLine && pool.find((l) => !l.clause && !l.skill && sameLine(l.text, evLine));
    const why = (st.whys || [])[0] || '';
    const quote = (t) => { const c = clean(t, 400).replace(/^[\s•●▪◦*·\-–—]+/, '').replace(/[.\s]+$/, ''); return `“${c.length <= 150 ? c : `${c.slice(0, 147).replace(/\s+\S*$/, '')}…`}”`; };
    // a lapsed or unfinished credential is a fact of the résumé's own dates (expired line): said honestly
    const cred = oldRows.find((r) => (r.status === 'expired' || r.status === 'in progress') && new RegExp(`\\b${escapeRegExp(String(r.label).split(/\s+/)[0])}\\b`, 'i').test(st.text));
    if (cred) { rows.push({ ...base, status: cred.status, say: cred.say }); continue; }
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
      const miss = [...new Set((st.missing || []).filter(Boolean).map((m) => String(m).replace(/\b(\S+)\s+\1\b/gi, '$1')))];
      if (yearsMsg) { rows.push({ ...base, status: 'partly', say: `${yearsMsg}${miss.length ? ` Not shown: ${joinList(miss)}.` : ''}` }); continue; }
      rows.push({ ...base, status: 'partly', ...(bullet ? { proof: bullet.text } : {}), say: `${!bullet && evLine ? `On your résumé: ${quote(evLine)}. ` : ''}${miss.length ? `Not shown: ${joinList(miss)} — if they ask, say plainly where you stand.` : why || 'Part of it is on your résumé — say what you have done and what is new.'}` });
      continue;
    }
    if (st.status === 'not_shown') {
      // a diploma or a degree is asked, never asserted
      if (/\b(?:diploma|GED|degree|bachelor'?s?|baccalaureate|master'?s|associate'?s? degree)\b/i.test(st.text)) { rows.push({ ...base, status: 'gap', kind: 'credential', say: 'Not shown on your résumé. If you have it, add it to your education section before the interview. If they ask: “[Your highest diploma or degree, where, and the year.]”' }); continue; }
      if (yearsMsg) { rows.push({ ...base, status: 'gap', say: `${yearsMsg} Don't round up — say what you have and what you did with it.` }); continue; }
      // a licence or certification asked for: the closest one the résumé holds (the older credential script)
      const credRow = oldRows.find((r) => r.status === 'gap' && (r.kind === 'credential' || /\b(?:licen[cs]e|certif\w*)/i.test(r.label)) && (st.text.toLowerCase().includes(String(r.label).toLowerCase()) || overlap(st.text, r.label) >= 0.6));
      if (credRow) { rows.push({ ...base, status: 'gap', kind: 'credential', say: credRow.say }); continue; }
      const subj = dutySubject(st.text, 10);
      const specificReq = subj && realStatement(subj) && !CONDUCT_RE.test(st.text) && !CONDITION_RE.test(st.text) && st.kind !== 'physical' && st.kind !== 'schedule';
      if (!specificReq) { ask.push(st.text); continue; }
      const isAre = isPluralNoun(subj) && !/ing$/.test(subj.split(/\s+/)[0]) ? 'are' : 'is';
      void isAre;
      // honest without denying: the résumé may simply not say it in these words
      rows.push({ ...base, status: 'gap', say: `Your résumé does not show this in its own words. If they ask, say plainly what you have and have not done: “[What you have done that comes closest to ${subj}, and what would be new to you.]”` });
      continue;
    }
    // cannot_tell: lifting, stairs, hours, "reliable" — only the person can say
    ask.push(st.text);
  }
  if (ask.length) rows.push({ label: ask.join(' · '), source: 'statement', status: 'only you can say', ask: true, items: ask, say: 'Your résumé cannot show these. Have a yes or no and one example ready for each.' });
  if (!statements.some((s) => s.reader)) return oldRows;
  return rows;
}
