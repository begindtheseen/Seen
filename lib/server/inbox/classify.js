// Inbox Autopilot — what happened, from one job email. Rules only (no model, no cost), pure, no I/O.
//
//   classifyEmail({ from, subject, text, html, headers, authentication }) →
//     { kind, company, role, stage, vendor, vendorType, confidence, senderName, senderDomain, forwardingConfirm }
//
// kind: application_received | interview | assessment | rejection | offer | forwarding_confirm | other
//
// Principles (the same bar as lib/reports/applicantRules.js — every rule is pinned by a real-shaped email
// in classify.test.mjs):
//   - A kind needs a STRONG phrase. "Unfortunately we can't reply to every applicant" in a confirmation is
//     not a rejection; "if you are selected we will schedule an interview" is not an interview invite — a
//     sentence that is conditional or hypothetical never counts.
//   - Precedence when one email carries several: rejection > offer > interview > assessment > received.
//     ("Thank you for applying… unfortunately we have decided to move forward with other candidates.")
//   - The company comes from the email's words first, then from the sender. A job board (Indeed, LinkedIn…)
//     is never the company; an ATS (Greenhouse, Workday…) is never the company either.
//   - Job alerts, newsletters and anything without a strong phrase are `other` and change nothing.

import { bodyText, unwrapForward, parseSender, tidy } from './text.js';

// ---- senders ----------------------------------------------------------------------------------------
const VENDORS = [
  // [domain suffix, label, type]  type: ats | board | assessment
  ['greenhouse.io', 'Greenhouse', 'ats'], ['greenhouse-mail.io', 'Greenhouse', 'ats'],
  ['lever.co', 'Lever', 'ats'], ['myworkday.com', 'Workday', 'ats'], ['myworkdayjobs.com', 'Workday', 'ats'], ['workday.com', 'Workday', 'ats'],
  ['icims.com', 'iCIMS', 'ats'], ['smartrecruiters.com', 'SmartRecruiters', 'ats'], ['smartrecruitersmail.com', 'SmartRecruiters', 'ats'],
  ['ashbyhq.com', 'Ashby', 'ats'], ['jobvite.com', 'Jobvite', 'ats'], ['taleo.net', 'Taleo', 'ats'], ['oraclecloud.com', 'Oracle Recruiting', 'ats'],
  ['successfactors.com', 'SuccessFactors', 'ats'], ['successfactors.eu', 'SuccessFactors', 'ats'], ['sapsf.com', 'SuccessFactors', 'ats'],
  ['bamboohr.com', 'BambooHR', 'ats'], ['workablemail.com', 'Workable', 'ats'], ['workable.com', 'Workable', 'ats'],
  ['paylocity.com', 'Paylocity', 'ats'], ['ultipro.com', 'UKG', 'ats'], ['ukg.com', 'UKG', 'ats'], ['ukg.net', 'UKG', 'ats'],
  ['adp.com', 'ADP', 'ats'], ['breezy.hr', 'Breezy', 'ats'], ['breezyhr.com', 'Breezy', 'ats'], ['applytojob.com', 'JazzHR', 'ats'], ['jazzhr.com', 'JazzHR', 'ats'],
  ['rippling.com', 'Rippling', 'ats'], ['dayforcehcm.com', 'Dayforce', 'ats'], ['recruitee.com', 'Recruitee', 'ats'],
  ['teamtailor.com', 'Teamtailor', 'ats'], ['teamtailor-mail.com', 'Teamtailor', 'ats'], ['pinpointhq.com', 'Pinpoint', 'ats'],
  ['phenompeople.com', 'Phenom', 'ats'], ['avature.net', 'Avature', 'ats'], ['eightfold.ai', 'Eightfold', 'ats'], ['paradox.ai', 'Paradox', 'ats'],
  ['indeed.com', 'Indeed', 'board'], ['indeedemail.com', 'Indeed', 'board'], ['linkedin.com', 'LinkedIn', 'board'],
  ['ziprecruiter.com', 'ZipRecruiter', 'board'], ['glassdoor.com', 'Glassdoor', 'board'], ['snagajob.com', 'Snagajob', 'board'],
  ['monster.com', 'Monster', 'board'], ['careerbuilder.com', 'CareerBuilder', 'board'], ['joinhandshake.com', 'Handshake', 'board'],
  ['wellfound.com', 'Wellfound', 'board'], ['dice.com', 'Dice', 'board'], ['usajobs.gov', 'USAJOBS', 'board'], ['seenjobs.io', 'Seen', 'board'],
  ['hirevue.com', 'HireVue', 'assessment'], ['hackerrank.com', 'HackerRank', 'assessment'], ['codility.com', 'Codility', 'assessment'],
  ['codesignal.com', 'CodeSignal', 'assessment'], ['testgorilla.com', 'TestGorilla', 'assessment'], ['shl.com', 'SHL', 'assessment'],
  ['criteriacorp.com', 'Criteria', 'assessment'], ['harver.com', 'Harver', 'assessment'], ['pymetrics.ai', 'pymetrics', 'assessment'],
];
const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'mail.com']);

export function vendorFor(domain) {
  const d = String(domain || '').toLowerCase();
  for (const [suffix, label, type] of VENDORS) if (d === suffix || d.endsWith('.' + suffix)) return { label, type };
  return null;
}

// ---- kinds ------------------------------------------------------------------------------------------
// A sentence that only describes what MIGHT happen never counts.
const CONDITIONAL = /\b(?:if|should|whether|in the event|once|when we|may|might|could)\b|\bwill (?:be in touch|reach out|contact you|get back)\b|\bwe'll (?:be in touch|reach out|contact you|get back)\b/i;

const RULES = {
  rejection: [
    /\b(?:decided|chosen|elected|opted) (?:to )?(?:move|proceed|go|continue) forward with (?:other|another|different|more qualified) (?:candidate|applicant)s?/i,
    /\b(?:decided|chosen|elected) to (?:pursue|proceed with|move ahead with) (?:other|another) (?:candidate|applicant)s?/i,
    /\b(?:will|would|are|won't) not (?:be )?(?:moving|proceeding|going) forward with your (?:application|candidacy)/i,
    /\bwon't be (?:moving|proceeding) forward with your (?:application|candidacy)/i,
    /\bnot (?:to )?(?:move|moving|proceed|proceeding) forward with your (?:application|candidacy)/i,
    /\b(?:you|your application|your candidacy) (?:were|was|have|has) not (?:been )?(?:selected|chosen|successful)/i,
    /\bno longer (?:under consideration|being considered|in consideration)/i,
    /\bwe regret to (?:inform|let you know|advise)/i,
    /\b(?:unable|not able) to offer you (?:the|a|this) (?:position|role|job)/i,
    /\bdecided not to (?:proceed|move forward|continue|advance) with your/i,
    /\b(?:position|role|requisition|opening) (?:you applied (?:for|to) )?has (?:now )?been (?:filled|closed|cancelled|canceled)/i,
    /\bunfortunately,? (?:we|the hiring team|the team) (?:have|has|will not|won't|are not|aren't)[^.]{0,60}\b(?:move|moving|proceed|proceeding|advance|advancing|forward|selected|offer)/i,
  ],
  offer: [
    // "offer you the Cashier position" — never "offer you an interview / the opportunity to…".
    /\b(?:pleased|delighted|happy|excited|thrilled) to offer you (?:the |a |an )?(?:(?!(?:interview|opportunity|chance|assessment|call|screen|meeting)\b)[\w&/,-]+ ){0,6}?(?:position|role|job|employment)\b/i,
    /\b(?:pleased|delighted|happy|excited|thrilled) to extend (?:you )?(?:an|a|this|the) (?:formal |job |verbal |written |conditional )?offer\b(?! to (?:interview|meet|speak|chat|complete))/i,
    /\bextend(?:ing)? (?:you )?(?:an?|this|the) (?:formal |job |verbal |written |conditional )?offer of employment/i,
    /\b(?:your|the attached|attached is your|attached please find your) (?:formal |job |employment )?offer letter/i,
    /\bcongratulations[^.]{0,80}\b(?:offer|you(?:'ve| have) been selected for the (?:position|role))/i,
  ],
  interview: [
    /\b(?:would|'d) (?:like|love) to (?:invite you to|schedule|set up|arrange|book)[^.]{0,60}\b(?:interview|phone screen|screening call|call|chat|conversation|video call|meeting)/i,
    /\b(?:like|love|want|excited|pleased|happy|delighted) to (?:invite you|move you forward) to (?:an?|the|your|our) (?:[\w-]+ ){0,3}(?:interview|screen|conversation|call)/i,
    /\binvit(?:e|ing) you to (?:an?|the|our)? ?(?:[\w-]+ ){0,3}(?:interview|phone screen|screening|conversation|call)/i,
    /\binterview (?:invitation|invite|request|confirmation|scheduled|details)\b/i,
    /\byour (?:upcoming |scheduled )?(?:[\w-]+ ){0,2}interview (?:with|for|is|on|has been)/i,
    /\b(?:please )?(?:schedule|book|pick|select|choose) (?:a |your )?(?:time|slot|interview time)[^.]{0,60}\b(?:interview|call|screen|chat|conversation)/i,
    /\bnext (?:step|round) (?:is|will be|in the process is) (?:an?|the|your) (?:[\w-]+ ){0,2}(?:interview|screen|call|conversation)/i,
    /\bmove (?:you )?forward to the (?:next|interview) (?:step|round|stage)/i,
  ],
  assessment: [
    /\b(?:complete|take|finish|start) (?:the |an |a |our |this |your )?(?:online |technical |coding |skills? |pre-employment |pre-hire |cognitive |personality |short )?(?:assessment|test|challenge|questionnaire|exercise|evaluation)/i,
    /\b(?:invited|invitation) to (?:complete|take) (?:an?|the|our)? ?(?:[\w-]+ ){0,2}(?:assessment|test|challenge)/i,
    /\btake-?home (?:assignment|exercise|project|challenge)/i,
    /\b(?:your|the) (?:online |coding |technical )?assessment (?:link|invitation|is ready|for)/i,
  ],
  application_received: [
    /\bthank(?:s| you) (?:so much )?for (?:applying|your application|submitting your application|your recent application|your interest (?:in|and) (?:applying|the position|the role|joining|working))/i,
    /\bwe(?:'ve| have)? (?:successfully )?received your (?:job )?application/i,
    /\byour (?:job )?application (?:has been|was|is) (?:successfully )?(?:received|submitted|sent|complete)/i,
    /\bapplication (?:received|confirmation|submitted|was sent)\b/i,
    /\byour application (?:to|for|at|with) [^.\n]{2,80} (?:has been|was) (?:received|submitted|sent)/i,
    /\bthank you for your interest in [^.\n]{2,80}\bwe (?:have )?received/i,
  ],
};
const ORDER = ['rejection', 'offer', 'interview', 'assessment', 'application_received'];

const ALERT = /\b(?:job alert|jobs? (?:you may|you might|for you|matching your|recommended for)|recommended jobs|new jobs? (?:for|near|in|matching)|jobs? similar to|people also (?:viewed|applied)|weekly (?:digest|roundup)|is hiring\b|are hiring\b|viewed your profile|profile views|top job picks|unsubscribe from (?:job )?alerts)/i;

function sentences(text) {
  return String(text || '').split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

/** The kind whose strongest rule hits a non-conditional sentence; null if none. */
export function detectKind(subject, body) {
  const subj = String(subject || '');
  const sents = [subj, ...sentences(body).slice(0, 80)];
  for (const kind of ORDER) {
    for (const s of sents) {
      if (s.length > 600) continue;
      const hit = RULES[kind].some((re) => re.test(s));
      if (!hit) continue;
      // The subject line is never conditional; a body sentence must be a statement of what happened.
      if (s !== subj && CONDITIONAL.test(s.replace(/\bif you have any questions\b.*$/i, ''))) continue;
      return kind;
    }
  }
  return null;
}

/** Interview depth from the words used: a recruiter/phone screen, a final/onsite round, or an interview. */
export function interviewStage(text) {
  const t = String(text || '');
  if (/\b(?:final|onsite|on-site|last) (?:round|interview|stage)|\bpanel interview\b|\bsuper ?day\b/i.test(t)) return 'Final Round';
  if (/\b(?:phone|recruiter|screening|intro(?:ductory)?) (?:screen|call|interview|chat|conversation)\b|\bphone screen\b/i.test(t)) return 'Phone Screen';
  return 'Interview';
}

// ---- company + role ---------------------------------------------------------------------------------
const GENERIC = /^(?:us|our team|the team|our company|the company|you|this position|this role|this job|this opportunity|the position|the role|our organization|the organization|our|your|the|a|an|it|them|this|that|hiring team|recruiting|careers|talent|team|no-?reply|notifications?|indeed|linkedin|ziprecruiter|glassdoor|workday|greenhouse|lever|icims|seen)$/i;
const STOP_AFTER = /\s+(?:for|has|have|is|was|were|we|regarding|about|through|via|today|yesterday|recently|team|careers|recruiting)\b.*$/i;
const BAD_START = /^(?:this|that|the moment|the time|your|our|least|a later|any|some|all|each|these|those)\b/i;

function cleanCompany(raw) {
  let s = tidy(String(raw || '')).split('\n')[0];
  s = s.replace(/\s+[-–—|]\s+.*$/, '').replace(/[.!?,;:()"]+.*$/, '');
  s = s.replace(STOP_AFTER, '');
  s = s.replace(/\s*(?:'s)?\s+(?:recruiting|recruitment|talent acquisition|talent|careers?|hiring team|hiring|jobs|hr|human resources|people(?: team| ops)?|team)$/i, '');
  s = s.replace(/^(?:at|with|to|from)\s+/i, '').trim();
  if (!s || s.length < 2 || s.length > 60 || !/[a-z]/i.test(s) || s.split(/\s+/).length > 6) return '';
  if (GENERIC.test(s) || BAD_START.test(s)) return '';
  return s;
}

function cleanRole(raw) {
  let s = tidy(String(raw || '')).split('\n')[0];
  s = s.replace(/^(?:the|a|an|our)\s+/i, '').replace(/[.!?;:"]+.*$/, '').replace(/\s+[-–—|]\s+.*$/, '').trim();
  s = s.replace(/\s*\((?:job|req|requisition)[^)]*\)\s*$/i, '').replace(/\s*(?:#|req(?:uisition)?\s*#?\s*|job id:?\s*)[\w-]+\s*$/i, '').trim();
  if (!s || s.length < 2 || s.length > 80 || s.split(/\s+/).length > 10 || !/[a-z]/i.test(s)) return '';
  if (/^(?:position|role|job|opportunity|opening|application|interview|this|it)$/i.test(s)) return '';
  return s;
}

// "<role> position at <company>" inside a capture.
const ROLE_AT = /^(?:the |our |a |an )?(.{1,80}?) (?:position|role|job|opening|opportunity|internship)(?: (?:at|with) (.{1,200}))?$/i;

const COMPANY_CUES = [
  /thank(?:s| you) (?:so much )?for (?:applying|your application) (?:to|at|with) (?:the )?(?:(.{1,80}?) (?:position|role|job) (?:at|with) )?([^\n]{1,200})/i,
  /thank(?:s| you) for (?:your )?interest in (?:joining |working (?:at|for|with) )?([^\n]{1,200})/i,
  /your application (?:to|at|with) ([^\n]{1,200})/i,
  /application was sent to ([^\n]{1,200})/i,
  /(?:has been|have been|was|were) (?:submitted|sent) to ([^\n]{1,200})/i,
  /(?:for|of) the (.{1,80}?) (?:position|role|job|opening|opportunity) (?:at|with) ([^\n]{1,200})/i,
  /(?:position|role|job|opening|opportunity) (?:at|with) ([^\n]{1,200})/i,
  /(?:interest in|applying to|applied to|apply to) ([^\n]{1,200})/i,
  /(?:on behalf of|recruiting team at|talent acquisition team at|hiring team at|the team at|everyone at|here at) ([^\n]{1,200})/i,
];
const ROLE_CUES = [
  /(?:for|of) the (?:position|role) of ([^\n]{1,80}?)(?: (?:at|with) |[.,\n]|$)/i,
  /(?:for|in) the (.{1,80}?) (?:position|role|job|opening|opportunity|internship)\b/i,
  /(?:application|applied|applying) for (?:the )?(.{1,80}?)(?: (?:position|role|job))?(?: (?:at|with) |[.,\n]|$)/i,
  /indeed application:\s*([^\n]{1,200})/i,
  /^(?:application (?:received|confirmation|submitted)|your application)\s*[:\-–—]\s*([^\n]{1,200})/i,
];

function firstCompany(text) {
  for (const re of COMPANY_CUES) {
    const m = String(text || '').match(re);
    if (!m) continue;
    // Patterns with two groups carry (role, company); the last group is always the company.
    const groups = m.slice(1).filter((g) => g != null);
    let co = groups[groups.length - 1];
    let role = groups.length > 1 ? groups[0] : '';
    const ra = String(co || '').match(ROLE_AT);
    if (ra && ra[2]) { role = role || ra[1]; co = ra[2]; }
    const company = cleanCompany(co);
    if (company) return { company, role: cleanRole(role) };
  }
  return { company: '', role: '' };
}

function firstRole(text) {
  for (const re of ROLE_CUES) {
    const m = String(text || '').match(re);
    if (m) { const r = cleanRole(m[1]); if (r) return r; }
  }
  return '';
}

function titleCase(s) { return String(s || '').replace(/[-_.]+/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase()).trim(); }

/** The company the SENDER stands for, when it is the employer (never a board or an ATS's own name). */
function companyFromSender(sender, vendor) {
  if (vendor && vendor.type === 'board') return '';
  // "Maria from Ramp Recruiting" / "Sam at Ramp" → Ramp; "Ramp via Greenhouse" → Ramp.
  const fromName = cleanCompany(String(sender.name || '').replace(/^.*?\s(?:from|at)\s+/i, '').replace(/\s+(?:via|through|@)\s+.*$/i, ''));
  if (fromName && !(vendor && fromName.toLowerCase() === vendor.label.toLowerCase())) return fromName;
  if (vendor && vendor.label === 'Workday' && sender.local && !/^(?:no-?reply|donotreply|notifications?|workday)$/i.test(sender.local)) {
    return titleCase(sender.local.replace(/\d+$/, '')); // walmart@myworkday.com → Walmart
  }
  if (!vendor && sender.domain && !FREE_MAIL.has(sender.domain)) {
    const parts = sender.domain.split('.');
    const root = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    if (root && root.length >= 2 && !/^(?:mail|email|e|info|news|jobs|careers|recruiting|hr|notify|notifications)$/i.test(root)) return titleCase(root);
  }
  return '';
}

// ---- Gmail forwarding confirmation -----------------------------------------------------------------
function forwardingConfirm(sender, subject, body) {
  if (!/^(?:forwarding-noreply|mail-noreply)@google\.com$/.test(sender.address) && !/gmail forwarding confirmation/i.test(subject)) return null;
  if (!/forwarding confirmation/i.test(subject) && !/confirmation code/i.test(body)) return null;
  const code = (String(subject).match(/\(#(\d{6,12})\)/) || String(body).match(/confirmation code:?\s*(\d{6,12})/i) || [])[1] || null;
  const url = (String(body).match(/https:\/\/mail(?:-settings)?\.google\.com\/mail\/(?:u\/\d+\/)?vf-[^\s"'<>)\]]+/) || [])[0] || null;
  const forWhom = (String(subject).match(/receive mail from\s+(\S+@\S+)/i) || [])[1] || null;
  return code || url ? { code, url, for: forWhom } : null;
}

// ---- the whole email --------------------------------------------------------------------------------
export function classifyEmail(email) {
  const e = email || {};
  let sender = parseSender(e.from);
  let subject = tidy(e.subject || '');
  let body = bodyText(e);

  const fc = forwardingConfirm(sender, subject, body);
  if (fc) return { kind: 'forwarding_confirm', forwardingConfirm: fc, company: '', role: '', stage: null, vendor: 'Gmail', vendorType: null, confidence: 'high', senderName: sender.name, senderDomain: sender.domain };

  // A hand-forwarded email: read the employer's email inside it, not the user's forward.
  const fwd = unwrapForward(body);
  if (fwd && (fwd.from || fwd.subject)) {
    if (fwd.from) sender = parseSender(fwd.from);
    if (fwd.subject) subject = tidy(fwd.subject);
    body = fwd.body || body;
  }
  subject = subject.replace(/^(?:(?:re|fw|fwd|aw|wg)\s*:\s*)+/i, '');

  const vendor = vendorFor(sender.domain);
  const head = body.slice(0, 6000);
  const out = { kind: 'other', company: '', role: '', stage: null, vendor: vendor ? vendor.label : null, vendorType: vendor ? vendor.type : null, confidence: 'low', senderName: sender.name.slice(0, 80), senderDomain: sender.domain.slice(0, 120), forwardingConfirm: null };

  const kind = detectKind(subject, head);
  if (!kind) return out;
  // An alert or digest that happens to quote a hiring phrase is still an alert.
  if (ALERT.test(subject) || (ALERT.test(head.slice(0, 600)) && kind === 'application_received' && !/thank(?:s| you) for applying/i.test(subject + ' ' + head.slice(0, 400)))) return out;

  const fromSubject = firstCompany(subject);
  const fromBody = firstCompany(head.slice(0, 2500));
  const company = fromSubject.company || fromBody.company || companyFromSender(sender, vendor);
  const role = fromSubject.role || fromBody.role || firstRole(subject) || firstRole(head.slice(0, 2500));

  out.kind = kind;
  out.company = company;
  out.role = role;
  if (kind === 'interview') out.stage = interviewStage(subject + '\n' + head);
  if (kind === 'assessment' && vendor && vendor.label === 'HireVue') { out.kind = 'interview'; out.stage = 'Interview'; }

  let conf = company ? (vendor && vendor.type !== 'assessment' ? 'high' : 'medium') : 'low';
  const dkim = e.authentication && String(e.authentication.dkim || '').toLowerCase();
  if (dkim === 'fail' && conf !== 'low') conf = conf === 'high' ? 'medium' : 'low';
  out.confidence = conf;
  return out;
}
