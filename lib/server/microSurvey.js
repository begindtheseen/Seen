// lib/server/microSurvey.js
//
// Pure, dependency-free core for the Micro-Survey — the low-friction, NO-incentive
// single-question pop (see components/MicroSurveyModal.tsx + api/micro-survey.js). ONE
// multiple-choice question, one tap, dismissible, no reward. Because nothing is rewarded there
// is nothing to farm, so the raw signal is cleaner than the incented multi-question SurveyModal
// — but for exactly that reason every response is still a CLAIM, not a fact.
//
// ANTI-GAMING / TRUST TIER: micro-survey responses are our LOWEST-trust first-party signal.
// They are stored on their own (micro_survey_responses) and are DELIBERATELY NOT wired into
// company scoring in this PR. Scoring integration is a separate, explicit follow-up so we never
// half-wire the scoring path; when it happens, weight this BELOW direct/survey/ingest tiers.
//
// This module is imported by BOTH the client (to render the exact same question keys the server
// validates) and the server (api/micro-survey.js). Keep it PURE: no env, no node built-ins, no
// secrets — that is what makes it safe to ship in the browser bundle and trivial to unit-test.

/** The fixed general pool — broad hiring-transparency, one-tap, no PII. Order is not meaningful;
 *  the host picks one at random. Each has 2–4 fixed choices (an enum the server enforces). */
export const GENERAL_QUESTIONS = [
  {
    key: 'search_status',
    text: 'Where are you in your job search right now?',
    choices: ['Actively applying', 'Casually looking', 'Just browsing', 'Not looking'],
  },
  {
    key: 'ghost_rate',
    text: 'Of the jobs you applied to recently, how many ghosted you?',
    choices: ['Almost all', 'About half', 'A few', 'None'],
  },
  {
    key: 'response_speed',
    text: 'When a company last replied to you, how fast was it?',
    choices: ['A few days', '1–2 weeks', 'Over a month', 'Never heard back'],
  },
  {
    key: 'worst_channel',
    text: 'Where do your applications vanish most often?',
    choices: ['Company site', 'LinkedIn', 'Indeed', 'Staffing agency'],
  },
  {
    key: 'interview_recent',
    text: 'Landed an interview in the last month?',
    choices: ['Yes', 'No', 'Ghosted before one', 'Not applying'],
  },
]

/** The contextual question — asked about a company the user recently viewed. Its choices are a
 *  fixed enum the server validates just like the general pool. */
export const CONTEXTUAL_QUESTION_KEY = 'company_response'
export const CONTEXTUAL_CHOICES = ['Yes', 'No', 'Still waiting', "Didn't apply"]

const MAX_COMPANY_LEN = 120

/**
 * Normalize a company string: turn every control char (incl. tabs/newlines) into a space, collapse
 * whitespace, trim, and cap length. Returns '' for empty/junk/non-string so callers can reject.
 * A char-code pass (not a control-char regex) keeps this readable and free of literal control
 * bytes in source. Pure — safe on client + server.
 */
export function normalizeCompany(input) {
  if (typeof input !== 'string') return ''
  let out = ''
  for (const ch of input) {
    const code = ch.charCodeAt(0)
    out += code < 32 || code === 127 ? ' ' : ch // control char / DEL → space (collapsed below)
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, MAX_COMPANY_LEN)
}

/** Build the contextual question for a company, or null if the company name is unusable. */
export function buildContextualQuestion(company) {
  const name = normalizeCompany(company)
  if (!name) return null
  return {
    key: CONTEXTUAL_QUESTION_KEY,
    company: name,
    text: `Did ${name} ever get back to you?`,
    choices: [...CONTEXTUAL_CHOICES],
  }
}

const GENERAL_BY_KEY = new Map(GENERAL_QUESTIONS.map((q) => [q.key, q]))

/** Every question key the server will accept (general pool + the contextual key). */
export const KNOWN_QUESTION_KEYS = new Set([
  ...GENERAL_QUESTIONS.map((q) => q.key),
  CONTEXTUAL_QUESTION_KEY,
])

export function isKnownQuestionKey(key) {
  return KNOWN_QUESTION_KEYS.has(key)
}

/** The valid choice set for a given question key (contextual or general); [] for unknown keys. */
export function choicesForKey(key) {
  if (key === CONTEXTUAL_QUESTION_KEY) return CONTEXTUAL_CHOICES
  const q = GENERAL_BY_KEY.get(key)
  return q ? q.choices : []
}

export function isValidChoice(key, choice) {
  return typeof choice === 'string' && choicesForKey(key).includes(choice)
}

/**
 * Validate an incoming submission against the known pool. Returns a normalized record on success,
 * or { ok:false, error } on junk. Everything is treated as untrusted: an unknown key, a choice
 * that is not in the fixed enum, or a contextual question missing its company are all rejected
 * (junk is ignored, never stored).
 *
 * For GENERAL questions the company is forced to null — those questions are not about a specific
 * employer, so an attached company would be meaningless noise.
 */
export function validateSubmission(input) {
  const body = input && typeof input === 'object' ? input : {}
  const question_key = typeof body.question_key === 'string' ? body.question_key : ''
  const choice = typeof body.choice === 'string' ? body.choice : ''

  if (!isKnownQuestionKey(question_key)) return { ok: false, error: 'unknown_question' }
  if (!isValidChoice(question_key, choice)) return { ok: false, error: 'invalid_choice' }

  let company = null
  if (question_key === CONTEXTUAL_QUESTION_KEY) {
    company = normalizeCompany(body.company)
    if (!company) return { ok: false, error: 'company_required' }
  }

  return { ok: true, record: { question_key, choice, company } }
}
