// Does a posting ask the APPLICANT to pay — for training, a starter kit, a certification, a deposit or a "processing
// fee"? And, separately, does it say training is paid back if you leave early?
//
// Basis: the FTC's job-scam guidance ("Job Scams", consumer.ftc.gov, checked 2026-11-14) — an employer or a placement
// firm that asks you to pay for the promise of a job, for training, a certificate or a starter kit is a warning sign;
// honest employers do not charge you to get hired. A repayment clause ("if you leave before 12 months you repay the
// training") is a different, legal arrangement (common in company-paid CDL schools): it is shown as a neutral fact,
// never as the warning.
//
// Precision, each rule pinned by a real-shaped sentence in lib/jobs/beforeYouApply.test.mjs:
//   • the employer paying never triggers: "company-paid training", "tuition reimbursement", "at no cost to you", "we pay
//     for your CDL", "all fees are covered", "free training", "direct deposit";
//   • a scam warning never triggers: "We will never ask you to pay a fee", "Seen never charges applicants";
//   • a fee the posting says is waived, refunded or reimbursed is not an ask;
//   • a repayment clause is not an ask (it is the second reading).
//
// Pure — no imports.

const sentencesOf = (text) => String(text || '')
  .replace(/\r/g, '')
  .split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9"“(•*-])/)
  .map((s) => s.replace(/^[\s•*\-–—]+/, '').trim())
  .filter(Boolean);

// What the applicant would pay for
const THING = String.raw`(?:training|course|class(?:es)?|school(?:ing)?|program|certification|certificate|license|licen[sc]ing|test(?:ing)?|exam|starter\s+kit|kit|materials?|equipment|tools?|uniforms?|background\s+check|drug\s+(?:test|screen)|registration|enrollment|onboarding|placement|tuition)`;
// The asks
const ASK_RES = [
  // "a $150 training fee", "certification fee", "processing fee", "registration fee of $49"
  new RegExp(String.raw`\b(?:${THING}|processing|application|administrative|admin|placement|sign[- ]?up|membership|activation|start[- ]?up|setup|set-up)\s+fees?\b`, 'i'),
  // "you pay for your own training", "pay for your certification", "applicants must pay for the course"
  new RegExp(String.raw`\b(?:you(?:'ll|’ll| will)?|applicants?|candidates?|trainees?|students?|hires?)\s+(?:(?:are|is)\s+)?(?:(?:need|needs|required|expected|responsible)\s+(?:to\s+|for\s+)?|must\s+|have\s+to\s+|will\s+)?(?:pay(?:ing)?|purchas\w*|buy(?:ing)?|cover(?:ing)?)\b(?:\s+(?:for|the\s+cost\s+of|a|an|the|your|their|own|any))*\s+${THING}`, 'i'),
  /\bpay\s+for\s+(?:your|their)\s+own\s+\w+/i,
  /\b(?:at\s+(?:your|the\s+applicant['’]?s|the\s+candidate['’]?s)\s+(?:own\s+)?(?:cost|expense))\b/i,
  // "purchase a starter kit", "starter kit ($99)"
  /\b(?:purchase|buy)\s+(?:a|an|the|your)?\s*(?:starter|business|sales)\s+kit\b|\bstarter\s+kit\b[^.\n]{0,40}\$\s?\d/i,
  // "a refundable deposit of $200", "training deposit", "$99 deposit"
  /\b(?:refundable|non-?refundable|security|training|equipment|uniform|kit|one[- ]time|small|required|upfront|up[- ]front)\s+deposit\b|\bdeposit\s+of\s+\$\s?\d|\$\s?\d[\d,.]*\s+deposit\b/i,
  // "training costs $499", "the course is $300", "$250 for training", "tuition of $3,000"
  new RegExp(String.raw`\b${THING}\s+(?:costs?|is|runs|will\s+cost)\s+(?:only\s+|just\s+)?\$\s?\d|\$\s?\d[\d,.]*\s+(?:for|to\s+cover)\s+(?:the\s+|your\s+)?${THING}|\btuition\s+of\s+\$\s?\d`, 'i'),
];
// The employer pays, the fee is gone, or it is a warning about scams
const NOT_AN_ASK_RE = /\b(?:no|zero|without\s+any)\s+(?:[\w-]+\s+){0,2}(?:cost|costs|fee|fees|charge|charges|tuition|money|expense)\b|\bat\s+no\s+(?:cost|charge)\b|\bfree\s+of\s+charge\b|\bfree\b|\bno[- ]cost\b|\b(?:company|employer|fully|100%)[- ](?:paid|sponsored|funded|covered)\b|\bpaid\s+(?:for\s+)?by\s+(?:the\s+)?(?:company|employer|us)\b|\b(?:we|company|employer)\s+(?:will\s+)?(?:pay|pays|cover|covers|reimburse|reimburses|sponsor|sponsors)\b|\breimburs\w*|\brefund(?:ed|s)?\s+(?:after|upon|once|when|in\s+full)\b|\bwaived?\b|\bcovered\b|\bdirect\s+deposit\b|\bnever\s+(?:ask|charge|require)\w*\b|\b(?:will|do|does)\s+not\s+(?:ask|charge|require)\b|\bdon['’]t\s+(?:ask|charge)\b|\bwon['’]t\s+(?:ask|charge)\b|\bscam\w*\b|\bfraud\w*\b|\bat\s+our\s+(?:cost|expense)\b|\bon\s+us\b|\bagenc(?:y|ies)\b|\bthird[- ]party\b|\bunsolicited\b|\bresumes?\s+submitted\b|\bsearch\s+firms?\b|\bfee\s+will\s+be\s+(?:owed|paid)\b|\b(?:supports?|helps?|assists?)\b[^.]{0,120}\bby\s+(?:paying|covering|reimbursing)\b/i;

// Repayment if you leave early
const REPAY_RE = /\b(?:repay\w*|repaid|pay\s+(?:it\s+|us\s+|this\s+|the\s+(?:cost|amount)\s+)?back|paid\s+back|reimburse\s+(?:the\s+)?(?:company|us|employer)|(?:training|tuition)\s+(?:repayment|reimbursement)\s+agreement|repayment\s+(?:agreement|obligation|clause)|claw\s*-?\s*back|pro-?rat\w*)\b/i;
const LEAVE_RE = /\b(?:leave|leaves|leaving|quit|quits|resign\w*|terminat\w*|separat\w*|depart\w*|before\s+(?:completing|the\s+end)|fail\s+to\s+(?:complete|fulfill)|do\s+not\s+(?:complete|stay)|within\s+(?:the\s+first\s+)?\d|commitment)\b/i;
const NUMS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, eighteen: 18, twenty: 20, 'twenty-four': 24, thirty: 30, 'thirty-six': 36 };
const toNum = (s) => (/^\d/.test(s) ? Number(s) : NUMS[String(s).toLowerCase()] ?? null);
const SPAN_RE = /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|eighteen|twenty-four|thirty-six)\s*(?:\(\d{1,2}\)\s*)?[- ]?(months?|years?|yrs?)\b/i;

/**
 * The sentence in which the posting asks the applicant to pay, or null.
 * @param {string} text the posting
 * @returns {{ sentence: string } | null}
 */
export function payToTrain(text) {
  for (const s of sentencesOf(text)) {
    if (s.length > 600) continue;
    if (!ASK_RES.some((re) => re.test(s))) continue;
    if (NOT_AN_ASK_RE.test(s)) continue;
    if (REPAY_RE.test(s) && LEAVE_RE.test(s)) continue; // a repayment clause, read below
    return { sentence: s };
  }
  return null;
}

/**
 * The posting says company-paid training is paid back if you leave early: { months|null, sentence }, or null.
 * `months` is the span the posting states (a year span in months); null when it states none.
 * @param {string} text the posting
 */
export function trainingRepayment(text) {
  for (const s of sentencesOf(text)) {
    if (s.length > 600) continue;
    if (!REPAY_RE.test(s) || !LEAVE_RE.test(s)) continue;
    if (!/\b(?:training|tuition|school|course|CDL|program|academy|certification|sign[- ]?on|bonus|relocation)\b/i.test(s)) continue;
    // a sign-on bonus or relocation repaid is not training
    if (!/\b(?:training|tuition|school|course|CDL|program|academy|certification)\b/i.test(s)) continue;
    const m = s.match(SPAN_RE);
    let months = null;
    if (m) { const n = toNum(m[1]); if (n) months = /^y/i.test(m[2]) ? n * 12 : n; }
    return { months, sentence: s };
  }
  return null;
}
