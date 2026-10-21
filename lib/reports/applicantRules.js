// Rule-based detector for FIRST-HAND applicant accounts about ONE company (no model, no cost).
//
// Why strict: the free collectors read thousands of Reddit posts, and the old rule ("first person + a
// word like offer/rejected anywhere") accepted posts that never mention the company ("I quit Taco Bell…"
// filed under Chipotle) and advice ("ask if they're hiring" → offer). Measured 2026-10-20 on 1,251
// archive posts/comments for Home Depot, Chipotle, Sheetz and Amazon: most of its "applicant outcomes"
// were wrong. A wrong report is worse than none — it moves a grade — so this accepts only text where:
//   1. the company is named in the same sentence as the outcome, or the text is the thread's opening
//      post and the thread title names the company (the post is ABOUT that company);
//   2. the speaker is the applicant (first person) and the phrase is an applicant event
//      (applied / interviewed / offered / hired / rejected / ghosted / assessment);
//   3. the sentence is not a question, a hypothetical, advice to someone else, or negated
//      ("never got an offer", "if they offer you");
//   4. the text is not mainly an employee story ("I worked there for 11 years" → employee_review).
// Returns { kind: 'applicant_outcome', outcome, evidence } | { kind: 'employee_review' | 'public_commentary', reason }.
// Tests: lib/reports/applicantRules.test.mjs (with real archive sentences).

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Name variants to look for: "The Home Depot, Inc." → home depot, homedepot, the home depot. */
export function nameVariants(names) {
  const out = new Set();
  for (const raw of [].concat(names || [])) {
    const n = String(raw || '').toLowerCase().replace(/&/g, ' and ').replace(/\b(?:incorporated|inc|llc|corp|corporation|co|company|ltd|plc|holdings?)\b\.?/g, ' ')
      .replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (n.length < 2) continue;
    for (const v of new Set([n, n.replace(/^the /, '')])) { out.add(v); if (v.includes(' ')) out.add(v.replace(/ /g, '')); }
  }
  return [...out].filter((n) => n.length >= 3).sort((a, b) => b.length - a.length);
}
export function namePattern(names) {
  const v = nameVariants(names);
  return v.length ? new RegExp(`(?:^|[^a-z0-9])(?:${v.map(esc).join('|')})(?:'s)?(?=$|[^a-z0-9])`, 'i') : null;
}

const FIRST = /\b(?:i|i'm|im|i've|ive|i'd|i'll|me|my|we|we're|our)\b/i;
// Each outcome: phrases that are ONLY applicant events when spoken in the first person.
const OUTCOME_RULES = [
  // An offer taken back is a rejection — checked before "offer" so it is not counted as one.
  ['rejected', /\b(?:rescind(?:ed)? (?:my|the) offer|offer (?:was |got )?(?:rescinded|pulled|revoked|withdrawn)|(?:pulled|revoked|withdrew) (?:my|the) offer|(?:received|got) (?:an?|the) offer,? then (?:had it|they) (?:given|gave it) to someone else)\b/i, { negatable: false }],
  ['ghosted', /\b(?:ghosted me|they ghosted|got ghosted|been ghosted|was ghosted|(?:completely|totally|basically|just) ghosted|never heard back|haven'?t heard back|didn'?t hear back|no response (?:from|after)|heard nothing|radio silence|never got back to me|never (?:called|texted|emailed|contacted|reached out)(?: (?:or|and) (?:called|texted|emailed|contacted))?(?: me)? back|never responded|stopped responding|went silent)\b/i, { negatable: false }],
  ['autoreject', /\b(?:auto(?:matic(?:ally)?|-)? ?reject(?:ed|ion)?|rejected (?:me )?(?:within|in) (?:minutes|hours|a day)|instant(?:ly)? rejected)\b/i, { negatable: false }],
  ['rejected', /\b(?:rejected me|reject me|got rejected|was rejected|been rejected|rejection (?:email|letter|call)|turned me down|didn'?t get the (?:job|position|role)|not (?:moving|move) forward with (?:me|my)|moved forward with other candidates|decided to go with (?:another|other) candidates?)\b/i, { negatable: false }],
  ['offer', /\b(?:got (?:an?|the|a job|my) offer|got offered|offered me (?:the|a) (?:job|position|role)|received (?:an?|the) offer|accepted (?:an?|the|their) (?:job )?offer|got the job|got a job (?:at|with|offer)|i got hired|i was hired|just got hired|they hired me|hired me)\b/i, { negatable: true }],
  ['interview', /\b(?:i (?:had|have|got) (?:an?|my|the|a second|a final|a phone) (?:interview|phone screen)|my (?:interview|phone screen|onsite)|i interviewed|interviewed (?:with|at|for) |got an interview|scheduled (?:an?|my) interview|interview (?:with|at) )\b/i, { negatable: true }],
  ['assessment', /\b(?:(?:sent|gave) me (?:an?|the) (?:assessment|take.?home|coding challenge|personality test)|i (?:took|did|completed|got) (?:an?|the|their) (?:assessment|take.?home|coding challenge|personality test|hirevue))\b/i, { negatable: true }],
];
const APPLIED = /\b(?:i applied|applied (?:to|at|for) |my application)\b/i;
const NEGATION = /\b(?:never|didn'?t|did not|don'?t|haven'?t|hasn'?t|wasn'?t|won'?t|can'?t|no one|nobody|not|declined to|refused to|decided against|turned down the chance to)\b/i;
// The speaker as the INTERVIEWER, not the applicant: "I interviewed the managers", "I've interviewed
// hundreds of candidates", "when I was interviewing people".
const INTERVIEWER = /\b(?:i(?:'ve| have)? interviewed|i (?:was |am |'m )?interviewing|i (?:used to |would )?interview)\s+(?:the |a |an |some |many |several |dozens of |hundreds of |lots of |a lot of |\d+ |new |potential |prospective )*(?:candidates?|people|managers?|applicants?|him|her|them|someone|engineers?|interns?|folks|guys|devs?|developers?|hires?|new grads?|folks)\b|\bon the (?:other side|hiring side)\b|\bas an interviewer\b|\bwhen i (?:was|became) (?:a )?(?:hiring manager|interviewer)\b/i;
const HYPOTHETICAL = /\b(?:if|unless|whether|would|should|could|might|hope(?:fully)?|wish|in case|try to|trying to|planning to|going to|gonna|want to)\b/i;
const ADVICE = /\b(?:you (?:should|can|could|will|might|need)|your (?:interview|application|offer)|ask (?:them|if)|\bop\b|they'?ll (?:probably|likely))/i;
// "almost all companies rejected me", "every place ghosted me" — about many employers, not this one.
const GENERIC = /\b(?:companies|places|employers|everywhere|every (?:job|company|place|employer)|other (?:jobs|companies|places)|all of them|most of them|lots of|tons of|dozens of|hundreds of|etc\.?|and so on|somewhere else|elsewhere|another (?:job|company|place|store)|a (?:new|different|better) job|(?:my|a) (?:second|other) job)\b/i;
// "I've heard of places that…", "apparently they…" — second-hand.
const HEARSAY = /\b(?:heard|hear|read|apparently|supposedly|i think|i guess|rumou?r|will)\b/i;
// An applicant word in the sentence: without one, "my request was rejected" is about work, not hiring.
const APPLICANT_WORD = /\b(?:interview\w*|appl(?:y|ied|ying|ication)|hired?|hiring|offer(?:ed)?|position|role|job|candidate|recruiter|orientation|onboard\w*|background check|screen(?:ing)?|assessment)\b/i;
// A third person between the speaker and the event: "the person who got the job", "they hired him".
const SECOND_PERSON = /\b(?:you|your|u|ya|yall|y'all)\b/i;
const THIRD_PERSON = /\b(?:the person|people|those|someone|somebody|he|she|him|her|others?|everyone|anyone|nobody|whoever|who)\b/i;
// An employee remembering being hired long ago is not an applicant report (and would skew grades up).
const RETRO = /\b(?:when i (?:got|was|first got) hired|hired (?:\w+ ){0,3}(?:years?|months?) ago|years? ago|back in (?:the )?'?\d{2,4}\w*|in the (?:'?\d0s|nineties|eighties)|been (?:here|there|with (?:them|the company)) for|i'?ve been here|(?:a|one|\d+) years? later|initially|(?:during|in) the (?:\d{4}|'?\d0)['’]?s)\b/i;
// An internal move is not an outside applicant's outcome.
const INTERNAL = /\b(?:promot(?:ed|ion)|internal(?:ly)?|transfer(?:red|ring)?|(?:i'?m|i am) (?:currently )?(?:a|an) (?:ds|asm|sm|cxm|supervisor|manager|department supervisor|lead)\b|as a current (?:employee|associate))\b/i;
const EMPLOYEE = /\b(?:i (?:work|worked|have worked|'ve worked|ve worked) (?:at|for|there)|i'?ve been (?:working|employed) (?:at|there)|my (?:manager|store manager|shift|coworkers?|co-workers?|supervisor|department)|years? (?:at|with) (?:the company|them)|i (?:quit|was fired|got fired|got laid off))\b/i;

// The company's name used as an ordinary word, not the employer: "am I being a snowflake", "such a target".
const PREDICATE_BEFORE = /\b(?:am|is|are|was|were|be|being|been|im|i'm|you're|youre|he's|she's|such)\s+(?:a|an|such a|so)\s+$/i;
function mentions(s, names) {
  const v = nameVariants(names); if (!v.length) return false;
  const rx = new RegExp(`(?:^|[^a-z0-9])(${v.map(esc).join('|')})(?:'s)?(?=$|[^a-z0-9])`, 'gi');
  return [...String(s || '').matchAll(rx)].some((h) => !PREDICATE_BEFORE.test(s.slice(0, h.index + h[0].indexOf(h[1]))));
}
// A mention that does not make the NEXT sentence about the company: the name in a list of tools/places
// ("(Snowflake, etc"), only inside parentheses, or only as an example.
function weakMention(s, names) {
  if (GENERIC.test(s) || isList(s) || onlyAsExample(s, names)) return true;
  const outside = String(s).replace(/\([^)]*\)?/g, ' ');
  return !mentions(outside, names);
}
// The event phrase sits inside quotation marks ('a series called "Have You Been Ghosted By…"').
const insideQuotes = (s, i) => ((s.slice(0, i).match(/["“”]/g) || []).length % 2) === 1;
// A question about the event, not a statement of it. "I got an interview but is this a good sign?" is a
// statement followed by a question; "Is this an interview or…?" / "think im getting a interview…?" are not.
const ASKS = /\b(?:is|are|was|were|do|does|did|can|could|should|would|will|am|have|has|what|why|how|when|where|who|which|any|anyone|think|thoughts|chances?)\b/i;
const ASKS_FIRST = /^\s*(?:is|are|was|were|do|does|did|can|could|should|would|will|am|have|has|what|why|how|when|where|who|which|any|anyone)\b/i;
function askedAbout(s, m) {
  if (!/\?[\s.!]*$/.test(s)) return false;
  if (ASKS_FIRST.test(s)) return true;
  const clause = s.slice(0, m.index).split(/[,;:]|\b(?:but|and|so)\b/i).pop() || '';
  if (ASKS.test(clause)) return true;
  return !/(?:,|\b(?:but|and|so)\b)/i.test(s.slice(m.index + m[0].length));
}

// The employer an outcome phrase is tied to, when the sentence names one ("hired at Taco Bell",
// "rejected from Best Buy"): capitalized words after at/from/with/by/for. Read from the ORIGINAL case.
const TIED_TO = /\b(?:at|from|with|by|join(?:ed|ing)?|appl(?:y|ied|ying) (?:to|at|for|with))\s+(?:a |an |the |my local |our local |local )?((?:[A-Z][\w&'’.-]*)(?:\s+(?:[A-Z][\w&'’.-]*|of|and|&))*)/g;
function namesOtherEmployer(sentence, name) {
  for (const m of sentence.matchAll(TIED_TO)) {
    const org = m[1].replace(/[.'’]+$/, '');
    if (!org || /^(?:I|I'm|Im|AM|PM|HR|USA?|US|The|A|An)$/i.test(org)) continue;
    if (!name.test(` ${org} `)) return true;
  }
  return false;
}
// The place an event phrase is tied to when it is followed by at/with/from + words ("an interview at
// taco bell" — lowercase too): those words must be the company, or a plain place/pronoun/time.
const AFTER_PLACE = /^\s*(?:at|with|from)\s+(?:a |an |the |my local |our local |local |their |this |that )?([a-z0-9][\w&'’.-]*(?:\s+[\w&'’.-]+){0,3})/i;
const PLAIN_PLACE = /^(?:them|there|their|this|that|these|those|it|its|us|you|him|her|his|our|my|someone|anyone|anybody|nobody|either|neither|both|any|each|every|another|other|corporate|hr|human|management|hiring|recruiting|headquarters|hq|store|stores|location|locations|restaurant|place|branch|office|shop|warehouse|site|company|noon|night|morning|afternoon|evening|manager|managers|recruiter|recruiters|gm|interviewer|interviewers|one|two|least|first|last|all|\d[\w:.]*)$/i;
function tiedElsewhere(m, s, name) {
  const prep = /\b(?:at|with|from)\s*$/i.exec(m[0]);
  const tail = (prep ? prep[0] : '') + s.slice(m.index + m[0].length);
  const t = AFTER_PLACE.exec(tail);
  if (!t) return false;
  const first = t[1].split(/\s+/)[0].replace(/[.,'’]+$/, '');
  return !PLAIN_PLACE.test(first) && !name.test(` ${t[1]} `);
}
// "jobs like Chipotle", "places such as Sheetz": the company as an example, not the speaker's employer.
const EXAMPLE_BEFORE = /\b(?:like|such as|including|e\.g\.?)\s+(?:a |an |the )?$/i;
function onlyAsExample(s, names) {
  const v = nameVariants(names); if (!v.length) return false;
  const rx = new RegExp(`(?:^|[^a-z0-9])(${v.map(esc).join('|')})(?:'s)?(?=$|[^a-z0-9])`, 'gi');
  const hits = [...s.matchAll(rx)];
  return hits.length > 0 && hits.every((h) => EXAMPLE_BEFORE.test(s.slice(0, h.index + h[0].indexOf(h[1]))));
}
// Another employer named between the company's last mention and the event ("at chipotle … I did try to
// join Taco Bell, but … my interview"): the event is that employer's.
function otherEmployerBetween(s, eventIndex, name) {
  const g = new RegExp(name.source, 'gi'); let last = -1; let mm;
  while ((mm = g.exec(s)) && mm.index < eventIndex) { last = mm.index + mm[0].length; if (mm[0].length === 0) g.lastIndex++; }
  return last >= 0 && namesOtherEmployer(s.slice(last, eventIndex), name);
}

// A sentence that lists names ("my blacklist: Sheetz, Marathon, Kroger…", with or without commas), or an
// example/template ("Ex: TEXT MESSAGE 'I have received an offer…'").
const NAME_ITEM = /^\s*(?:and |or |the )?[A-Z][\w'’&.-]*(?:\s+[A-Z][\w'’&.-]*){0,3}\s*$/;
const isList = (s) => s.split(/,|;/).filter((x) => NAME_ITEM.test(x)).length >= 3
  || (s.slice(1).match(/\b[A-Z][a-z'’]+/g) || []).length >= 8
  || /^(?:ex|e\.g|example|for example|template)\b/i.test(s.trim());

function sentences(text) {
  return String(text || '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

// The excerpt Seen stores for an account: the sentence that names the company (when it is the one before)
// plus the outcome sentence, so the stored text alone still passes these rules.
function excerptFor(ss, i, named, aboutContext) {
  const start = !aboutContext && !named[i] && i > 0 && named[i - 1] ? i - 1 : i;
  return ss.slice(start, i + 1).join(' ').slice(0, 500);
}

// inCompanySub: the text is in the company's own subreddit (r/HomeDepot, r/WalmartEmployees), so the
// company is the context even when unnamed — but a sentence tied to ANOTHER named employer, or to an
// unnamed "new job somewhere else", still does not count.
export function classifyApplicantAccount(text, { names, title = '', isOp = false, inCompanySub = false } = {}) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (value.length < 30) return { kind: 'public_commentary', reason: 'too_short' };
  const name = namePattern(names);
  if (!name) return { kind: 'public_commentary', reason: 'no_name' };
  const aboutThread = inCompanySub || (isOp && mentions(String(title || ''), names) && !weakMention(String(title || ''), names));
  const ss = sentences(value);
  const named = ss.map((s) => mentions(s, names));
  if (!aboutThread && !named.some(Boolean)) return { kind: 'public_commentary', reason: 'company_not_named' };
  // Sentences that may carry the outcome: ones naming the company and the one right after it
  // ("I applied to Sheetz. They ghosted me."), or every sentence of an opening post about the company.
  const inScope = ss.map((s, i) => i).filter((i) => aboutThread || named[i] || (i > 0 && named[i - 1] && !weakMention(ss[i - 1], names)));
  const employee = EMPLOYEE.test(value);
  for (const [outcome, rx, { negatable }] of OUTCOME_RULES) {
    for (const i of inScope) {
      const s = ss[i];
      const m = rx.exec(s);
      if (!m) continue;
      const before = s.slice(0, m.index);
      // "Just got hired, orientation Monday!" — no stated subject: the speaker is the applicant.
      const implicitSubject = /^(?:just|finally|so|today|yesterday|update:?|edit:?)?\s*$/i.test(before.trim());
      // The speaker must be the one the event happened to: a first-person word close before the event (or
      // in the phrase itself, "ghosted me"), with no third person in between.
      const near = before.slice(-60);
      const lastFirst = Math.max(...[...near.matchAll(/\b(?:i|i'm|im|i've|ive|i'd|me|my|we|we're|our)\b/gi)].map((x) => x.index), -1);
      const speaker = FIRST.test(m[0]) || implicitSubject || (lastFirst >= 0 && !THIRD_PERSON.test(near.slice(lastFirst + 1)) && !SECOND_PERSON.test(near.slice(lastFirst + 1)));
      if (!speaker) continue;
      if (RETRO.test(s) || INTERNAL.test(s) || INTERVIEWER.test(s)) continue;
      // Without the company's name in the sentence, the sentence itself must be about applying.
      if (!named[i] && !APPLICANT_WORD.test(s) && !(isOp && i === 0 && APPLICANT_WORD.test(title))) continue;
      if (askedAbout(s, m) || insideQuotes(s, m.index)) continue;
      if (HYPOTHETICAL.test(before.split(/[,;:]/).pop() || '')) continue;
      // Hearsay is judged on the clause that leads into the event ("I've heard places will reject…"), not
      // on an earlier clause ("she will let me know… then never called back" is still first-hand).
      if (ADVICE.test(s) || GENERIC.test(s) || HEARSAY.test(before.split(/[,;:]|\b(?:but|then|and then|so)\b/i).pop() || '') || isList(s)) continue;
      if (!name.test(s) && namesOtherEmployer(s, name)) continue; // tied to another employer
      if (name.test(s) && namesOtherEmployer(s.slice(m.index), name) && !name.test(s.slice(m.index))) continue;
      if (tiedElsewhere(m, s, name) || otherEmployerBetween(s, m.index, name)) continue;
      if (named[i] && onlyAsExample(s, names)) continue;
      // Negation is judged on the clause that leads into the event: "I've never worked at Home Depot but I have
      // an interview" is an interview.
      if (negatable && NEGATION.test(before.split(/[,;:]|\bbut\b/i).pop() || '')) continue;
      // An employee story that merely mentions being hired years ago is not an applicant account.
      if (employee && (outcome === 'offer' || outcome === 'interview') && !APPLIED.test(value)) return { kind: 'employee_review', reason: 'employee_story' };
      return { kind: 'applicant_outcome', outcome, evidence: s.slice(0, 300), excerpt: excerptFor(ss, i, named, aboutThread) };
    }
  }
  if (employee) return { kind: 'employee_review', reason: 'employee_story' };
  return { kind: 'public_commentary', reason: 'no_applicant_event' };
}

// Several sentences by the same person in one thread are ONE account: keep the most final outcome.
const FINALITY = { offer: 6, hired: 6, rejected: 5, autoreject: 5, ghosted: 4, assessment: 3, interview: 2, responded: 1 };
export function oneAccountPerVoice(accounts) {
  const best = new Map();
  for (const a of accounts) {
    const key = a.voice || `${a.thread}|${a.url}`;
    const cur = best.get(key);
    if (!cur || (FINALITY[a.outcome] || 0) > (FINALITY[cur.outcome] || 0)) best.set(key, a);
  }
  return [...best.values()];
}

// Seen's reports table accepts ghosted | rejected | autoreject | hired | offer | interview | interviewing |
// human | waiting (reports_outcome_check). An assessment means the applicant is mid-process.
export const REPORT_OUTCOME = { ghosted: 'ghosted', rejected: 'rejected', autoreject: 'autoreject', offer: 'offer', hired: 'hired', interview: 'interview', assessment: 'interviewing', responded: 'human' };

/**
 * The text Seen will store for a first-hand account, chosen so it passes Seen's server-side re-check on
 * its own: the classifier's short excerpt when it does (and is ≥40 chars), else the whole text (≤500
 * chars), else null. Returns { ...classification, excerpt, outcome } or null. Every collector uses this.
 */
export function storableAccount(text, ctx) {
  const c = classifyApplicantAccount(text, ctx);
  if (c.kind !== 'applicant_outcome') return null;
  const whole = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  for (const excerpt of [c.excerpt, whole]) {
    if (String(excerpt || '').length < 40) continue;
    const again = classifyApplicantAccount(excerpt, ctx);
    if (again.kind === 'applicant_outcome') return { ...c, excerpt, outcome: again.outcome };
  }
  return null;
}

/** Sentiment of an applicant outcome, for the intel ingest payload. */
export const outcomeSentiment = (outcome) => (['offer', 'hired'].includes(outcome) ? 'positive' : ['interview', 'assessment', 'responded'].includes(outcome) ? 'mixed' : 'negative');

/** True when a subreddit is the company's own (r/HomeDepot for "The Home Depot"). */
export const isCompanySubreddit = (subreddit, names) => {
  const s = String(subreddit || '').replace(/^r\//i, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return !!s && nameVariants(names).some((v) => v.replace(/[^a-z0-9]/g, '') === s);
};
