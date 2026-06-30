// Deterministic résumé-survey question bank + answer→report mapping.
//
// NO external AI. Given a past employment position {company, title}, this generates a
// fixed set of generic hiring/application-experience questions about THAT company+role,
// and maps the user's chosen answers into our reports/event schema (outcome, rounds,
// wait_days, unpaid_work). Same shape the SeenJobs report corpus already uses, so the
// resulting report feeds company_scores exactly like a `submit` / `create_from_tracker`.

// Question keys are stable so a (user, position) can't be re-farmed: the resume_surveys
// table tracks completed (user, company, role) tuples.

// Build the survey for one position. Returns { questions: [...] } where each question has
// { key, text, options }. Keys are namespaced by question type so the answer mapper can
// route them deterministically.
export function buildResumeSurvey(company, role) {
  const co = String(company || '').trim();
  const roleStr = role ? `${role} role` : 'role';
  return {
    questions: [
      {
        key: 'outcome',
        text: `When you applied for your ${roleStr} at ${co}, what was the final outcome?`,
        options: [
          'I was hired',
          'Got an offer (declined or N/A)',
          'Interviewed but rejected',
          'Rejected before any interview',
          'Ghosted — never heard back',
        ],
      },
      {
        key: 'response',
        text: `After you applied to ${co}, did you hear back?`,
        options: [
          'Yes — a real person responded',
          'Only an automated acknowledgement',
          'No response at all',
        ],
      },
      {
        key: 'wait',
        text: `How long until ${co} gave you a first response?`,
        options: [
          'Same day',
          'Within a week',
          '1–2 weeks',
          '2–4 weeks',
          'Over a month',
          'Never responded',
        ],
      },
      {
        key: 'rounds',
        text: `How many interview rounds did ${co} put you through?`,
        options: [
          'None — auto-rejected or ghosted',
          '1 round',
          '2 rounds',
          '3 rounds',
          '4+ rounds',
        ],
      },
      {
        key: 'unpaid',
        text: `Did ${co} ask for an assessment or unpaid take-home work?`,
        options: [
          'No assessment',
          'A short timed assessment',
          'A take-home project (reasonable)',
          'Excessive unpaid work',
        ],
      },
      {
        key: 'again',
        text: `Knowing what you know now, would you apply to ${co} again?`,
        options: [
          'Definitely yes',
          'Probably yes',
          'Probably not',
          'Never again',
        ],
      },
    ],
  };
}

// The set of valid question keys, for server-side validation of submitted answers.
export const RESUME_SURVEY_KEYS = ['outcome', 'response', 'wait', 'rounds', 'unpaid', 'again'];

// Map a completed survey's answers (object keyed by question key → chosen option string)
// into the reports schema. Returns { outcome, rounds, wait_days, unpaid_work, ghost_stage }.
// `outcome` matches the reports.outcome vocabulary used by create_from_tracker/submit.
export function mapAnswersToReport(answers) {
  const a = answers || {};
  const has = (k, sub) => typeof a[k] === 'string' && a[k].toLowerCase().includes(sub);

  // ── outcome ──────────────────────────────────────────────────────────────────
  let outcome = 'waiting';
  if (has('outcome', 'hired')) outcome = 'hired';
  else if (has('outcome', 'offer')) outcome = 'offer';
  else if (has('outcome', 'interviewed but rejected')) outcome = 'rejected';
  else if (has('outcome', 'rejected before')) outcome = 'autoreject';
  else if (has('outcome', 'ghost')) outcome = 'ghosted';
  else if (has('response', 'no response')) outcome = 'ghosted';
  else if (has('response', 'real person')) outcome = 'human';

  // ── rounds ───────────────────────────────────────────────────────────────────
  let rounds = 0;
  if (has('rounds', '1 round')) rounds = 1;
  else if (has('rounds', '2 rounds')) rounds = 2;
  else if (has('rounds', '3 rounds')) rounds = 3;
  else if (has('rounds', '4+')) rounds = 4;

  // ── wait_days (representative midpoint of the chosen bucket) ──────────────────
  let wait_days = null;
  if (has('wait', 'same day')) wait_days = 0;
  else if (has('wait', 'within a week')) wait_days = 4;
  else if (has('wait', '1–2 weeks') || has('wait', '1-2 weeks')) wait_days = 10;
  else if (has('wait', '2–4 weeks') || has('wait', '2-4 weeks')) wait_days = 21;
  else if (has('wait', 'over a month')) wait_days = 45;
  else if (has('wait', 'never')) wait_days = null;

  // ── unpaid_work — reports uses 'na' | 'yes' | 'no' style values ───────────────
  let unpaid_work = 'na';
  if (has('unpaid', 'no assessment')) unpaid_work = 'no';
  else if (has('unpaid', 'excessive')) unpaid_work = 'yes';
  else if (has('unpaid', 'take-home') || has('unpaid', 'assessment')) unpaid_work = 'yes';

  // ── ghost_stage — only meaningful when ghosted ────────────────────────────────
  let ghost_stage = null;
  if (outcome === 'ghosted') ghost_stage = rounds > 0 ? 'after_interview' : 'after_apply';

  return { outcome, rounds, wait_days, unpaid_work, ghost_stage };
}
