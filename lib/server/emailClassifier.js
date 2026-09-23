// Email → hiring-event classifier (Gmail auto-capture, Engine: data acquisition — the research's
// "single biggest lever"). Pure and deterministic ("start with keyword rules, no model" — agents 1,2),
// so it's fully unit-testable and cheap. Works on HEADERS ONLY (From / Subject / Date): this lets the
// Gmail sync request the lighter `gmail.metadata` scope instead of the restricted `gmail.readonly`
// body scope — a major OAuth-verification de-risk — and subject lines + sender domains are exactly
// what the ATS-domain and keyword banks key on.
//
// ANTI-GAMING (load-bearing): a classified email is a SUGGESTION for the user's own tracker, never a
// silent write to a company's aggregate score. Only user-CONFIRMED captures flow to scores (via the
// normal report path), so a misclassified marketing email can't poison a named employer's grade.
// `confidence` lets the sync decide what to surface vs. auto-confirm later.

import { createHash } from 'crypto';

// Hiring-platform (ATS) + recruiting sender domains — a real hiring email if the From domain matches.
// (jobseeker-analytics applied_email_filter.yaml + CareerSync, MIT — domain list reimplemented.)
const ATS_DOMAINS = [
  'greenhouse.io', 'greenhouse-mail.io', 'us.greenhouse-mail.io',
  'lever.co', 'hire.lever.co',
  'ashbyhq.com',
  'smartrecruiters.com', 'smartrecruitersmail.com',
  'myworkday.com', 'myworkdayjobs.com', 'workday.com',
  'icims.com',
  'workable.com', 'workablemail.com',
  'bamboohr.com',
  'jobvite.com',
  'taleo.net',
  'successfactors.com', 'sapsf.com',
  'recruitee.com',
  'teamtailor.com', 'teamtailormail.com',
  'breezy.hr',
  'gem.com',
  'ripplematch.com',
  'wellfound.com', 'angel.co',
  'hire.google.com',
];
// Scheduling / signing platforms — hiring-adjacent (an interview or an offer is in motion).
const SCHEDULING_DOMAINS = ['calendly.com', 'goodtime.io', 'x.ai', 'cronofy.com'];
const SIGNING_DOMAINS = ['docusign.net', 'hellosign.com', 'dropboxsign.com'];

// Recruiting-mailbox local-parts (careers@acme.com, recruiting@…) — hiring even off a company domain.
const RECRUITING_LOCALPARTS = /^(careers?|jobs?|recruit(ing|ment)?|talent|hiring|hr|people|noreply-careers|no-reply-jobs)([.+-]|$)/i;

// Subject keyword banks (case-insensitive). Order of the OUTCOME check below encodes precedence.
const KW = {
  offer: [/\boffer\b/i, /pleased to offer/i, /job offer/i, /offer letter/i, /excited to offer/i, /welcome to the team/i, /we'?d like to (?:extend|offer)/i],
  rejected: [/unfortunately/i, /not moving forward/i, /not (?:be )?(?:selected|proceeding|progressing)/i, /other (?:candidates|applicants)/i, /move forward with other/i, /will not be proceeding/i, /unable to offer/i, /position has been filled/i, /no longer under consideration/i, /decided not to (?:move|proceed)/i, /regret to inform/i, /we'?ve decided to/i, /pursue other candidates/i],
  assessment: [/\bassessment\b/i, /coding challenge/i, /hackerrank/i, /codility/i, /take[- ]home/i, /technical screen/i, /online test/i, /skills? test/i, /coderpad/i, /codesignal/i],
  interview: [/\binterview\b/i, /would like to (?:invite|schedule|set up)/i, /invitation to interview/i, /schedule (?:a|your|some)/i, /your availability/i, /next steps?/i, /phone screen/i, /(?:meet|chat|speak|connect) with (?:the|our|us)/i, /book a time/i, /set up a (?:call|time|chat)/i],
  // NB: no bare "your application to X" here — that phrasing also appears in rejections/updates, so
  // it's used for company EXTRACTION, not outcome. Applied = explicit submission-confirmation wording.
  applied: [/application received/i, /we(?:'ve| have)? received your application/i, /thank(?:s| you) for applying/i, /thank you for your application/i, /application (?:submitted|confirmation|complete)/i, /successfully applied/i, /applied to/i],
  response: [/regarding your application/i, /update on your application/i, /your application status/i, /following up/i], // generic engagement
};

// Map an internal outcome to Seen's event taxonomy + a reports.outcome value.
const EVENT_MAP = {
  offer:      { event: 'offer_received',        outcome: 'offer',             terminal: true },
  rejected:   { event: 'rejected',              outcome: 'rejected',          terminal: true },
  assessment: { event: 'assessment_received',   outcome: 'assessment',        terminal: false },
  interview:  { event: 'interview_received',    outcome: 'interview',         terminal: false },
  response:   { event: 'response_received',     outcome: 'response_received', terminal: false },
  applied:    { event: 'application_submitted', outcome: 'applied',           terminal: false },
};

function parseFrom(from) {
  const raw = String(from || '').trim();
  // Pull the address token (the thing containing '@') directly, and take any display name from
  // before a '<'. Robust to "Name <a@b>", bare "a@b", and quoted names — a single regex split
  // mis-assigns the first character to the display group.
  const emailMatch = raw.match(/[^\s<>"]+@[^\s<>"]+/);
  const email = (emailMatch ? emailMatch[0] : raw).toLowerCase().trim();
  const lt = raw.indexOf('<');
  const display = lt > 0 ? raw.slice(0, lt).replace(/"/g, '').trim() : '';
  const at = email.lastIndexOf('@');
  const local = at > 0 ? email.slice(0, at) : '';
  const domain = at > 0 ? email.slice(at + 1) : '';
  return { display, email, local, domain };
}

const domainMatches = (domain, list) => list.some((d) => domain === d || domain.endsWith('.' + d));

// Registrable-ish org from a plain company domain (careers@stripe.com → "Stripe"), skipping ATS hosts.
function orgFromDomain(domain) {
  if (!domain) return null;
  const parts = domain.split('.');
  // drop common TLDs / second-level (co.uk) — take the label before the public suffix
  const label = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  if (!label || /^(mail|email|notifications?|noreply|no-reply|smtp|mailer|hi|info|jobs|careers)$/i.test(label)) return null;
  return titleCase(label.replace(/[-_]/g, ' '));
}

function titleCase(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

// Clean a candidate company string pulled from a subject/display name.
function cleanCompany(raw) {
  let c = String(raw || '').trim();
  if (!c) return null;
  c = c.replace(/[|•\-–—:]+.*$/, '').trim();                 // drop "Acme — Software Engineer"
  c = c.replace(/\b(careers?|recruit(ing|ment)?|talent|hiring|team|hr|people ops?|no[- ]?reply)\b/gi, '').trim();
  c = c.replace(/^(the|at|to|with|from|for)\s+/i, '').trim();
  c = c.replace(/[.,!?"'`]+$/, '').trim();
  // Deliberately NOT stripping Inc/LLC/Corp/Co suffixes — that fragments company identity
  // ("Acme Corp" vs "Acme") and the rest of the codebase matches on the full stored name.
  if (c.length < 2 || c.length > 60) return null;
  if (/^(your|our|this|application|interview|offer|update|re|fwd)$/i.test(c)) return null;
  return titleCase(c);
}

// Try to pull the employer from the subject (strongest signal), then display name, then domain.
function extractCompany(subject, { display, domain }) {
  const subj = String(subject || '');
  const patterns = [
    /your application (?:to|at|with|for)\s+(.+?)(?:\s+(?:has|is|was|for the)\b|[.!?]|$)/i,
    /thank(?:s| you) for (?:applying|your application)(?:\s+(?:to|at|with|for))?\s+(.+?)(?:[.!?]|$)/i,
    /application (?:to|for|at)\s+(.+?)(?:\s+(?:has|is|was|—|-)\b|[.!?]|$)/i,
    /interview (?:with|at|for)\s+(.+?)(?:[.!?]|$)/i,
    /(?:offer|position|role|opportunity) (?:from|at|with)\s+(.+?)(?:[.!?]|$)/i,
    /(?:challenge|assessment|test|role|position|opportunity) (?:for|with|at)\s+(.+?)(?:[.!?]|$)/i,
  ];
  for (const p of patterns) {
    const m = subj.match(p);
    if (m && m[1]) { const c = cleanCompany(m[1]); if (c) return c; }
  }
  // Display name if it isn't an ATS's own brand.
  if (display && !/greenhouse|lever|ashby|workday|smartrecruiters|icims|workable|no[- ]?reply|notifications?|team|talent|recruit/i.test(display)) {
    const c = cleanCompany(display);
    if (c) return c;
  }
  // Non-ATS company domain → org from domain.
  if (domain && !domainMatches(domain, ATS_DOMAINS) && !domainMatches(domain, SCHEDULING_DOMAINS) && !domainMatches(domain, SIGNING_DOMAINS)) {
    return orgFromDomain(domain);
  }
  return null;
}

function classifyOutcome(subject) {
  const s = String(subject || '');
  // Precedence: offer > rejected > assessment > interview > applied > generic response.
  for (const key of ['offer', 'rejected', 'assessment', 'interview', 'applied', 'response']) {
    if (KW[key].some((re) => re.test(s))) return key;
  }
  return null;
}

// Stable idempotency signature (fallback when a Gmail message-id isn't available). The sync should
// prefer the message-id; this dedupes identical re-sent content per user.
export function emailSignature({ uid = '', from = '', subject = '', date = '' } = {}) {
  const { domain } = parseFrom(from);
  const day = String(date || '').slice(0, 10);
  const norm = `${uid}|${domain}|${String(subject).toLowerCase().replace(/\s+/g, ' ').trim()}|${day}`;
  return createHash('sha256').update(norm).digest('hex').slice(0, 32);
}

/**
 * Classify a single email from its headers.
 * @param {{from?:string, subject?:string, date?:string, uid?:string}} email
 * @returns {{
 *   isHiring:boolean, company:string|null, event:string|null, outcome:string|null,
 *   terminal:boolean, confidence:'high'|'medium'|'low'|null, source:'gmail', signature:string,
 *   senderDomain:string, ats:boolean
 * }}
 */
export function classifyEmail(email = {}) {
  const { from, subject, date, uid } = email;
  const parsed = parseFrom(from);
  const ats = domainMatches(parsed.domain, ATS_DOMAINS);
  const scheduling = domainMatches(parsed.domain, SCHEDULING_DOMAINS);
  const signing = domainMatches(parsed.domain, SIGNING_DOMAINS);
  const recruitingMailbox = RECRUITING_LOCALPARTS.test(parsed.local);

  const outcomeKey = classifyOutcome(subject);
  const signature = emailSignature({ uid, from, subject, date });

  // Is this a hiring email at all? Either a known ATS/recruiting sender, a scheduling/signing
  // platform, or a clear hiring keyword in the subject.
  const isHiring = ats || recruitingMailbox || scheduling || signing || outcomeKey != null;
  if (!isHiring) {
    return { isHiring: false, company: null, event: null, outcome: null, terminal: false, confidence: null, source: 'gmail', signature, senderDomain: parsed.domain, ats: false };
  }

  const company = extractCompany(subject, parsed);

  // Scheduling/signing sender with no explicit keyword → infer the stage.
  let key = outcomeKey;
  if (!key && signing) key = 'offer';       // an offer letter to sign
  if (!key && scheduling) key = 'interview';// scheduling a conversation
  if (!key && (ats || recruitingMailbox)) key = 'response'; // engaged, stage unclear

  const mapped = key ? EVENT_MAP[key] : null;

  // Confidence: HIGH needs a trustworthy sender AND a concrete outcome AND an extracted company —
  // only these are safe to (later) auto-confirm into aggregate scores. Everything else is a
  // user-confirmed suggestion.
  let confidence = 'low';
  if ((ats || recruitingMailbox) && outcomeKey && company) confidence = 'high';
  else if (outcomeKey && (company || ats || recruitingMailbox)) confidence = 'medium';
  else if (ats || recruitingMailbox || scheduling || signing) confidence = 'medium';

  return {
    isHiring: true,
    company,
    event: mapped ? mapped.event : 'response_received',
    outcome: mapped ? mapped.outcome : 'response_received',
    terminal: mapped ? mapped.terminal : false,
    confidence,
    source: 'gmail',
    signature,
    senderDomain: parsed.domain,
    ats,
  };
}
