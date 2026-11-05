// The earn-a-credit questions (api/user-sync.js get_question / submit_answer), in ONE place so the
// server only accepts an answer to a question it could have asked, with one of that question's own
// options (security audit 2026-11-01: submit_answer took any `question_key` + any text, and a
// "ghost|<any company>" key wrote a full-weight report against that company, as often as you liked).
// Pure — shared by the handler and its test.

export const QUESTION_TYPES = [
  { type: 'ghost', text: (co) => `Did ${co} respond to your application?`, options: ['Yes, they responded', 'No, was ghosted', 'Haven\'t applied there'] },
  { type: 'timeline', text: (co) => `How long did ${co} take to first contact you?`, options: ['Same day', '1–3 days', '4–7 days', '1–2 weeks', '2–4 weeks', 'Never heard back'] },
  { type: 'rounds', text: (co) => `How many interview rounds did ${co} put you through?`, options: ['None / auto-rejected', '1 round', '2 rounds', '3 rounds', '4+ rounds'] },
  { type: 'return', text: (co) => `Would you apply to ${co} again?`, options: ['Definitely yes', 'Probably yes', 'Probably not', 'Never again'] },
];
export const TRACKER_OUTCOME_OPTIONS = ['Hired 🎉', 'Got an interview', 'Rejected', 'Ghosted', 'Still waiting'];
export const VERIFY_OPTIONS = ['Yes, they responded', 'No, was ghosted', 'I haven\'t applied there'];
export const GENERIC_QUESTIONS = [
  { key: 'generic|response_time', text: 'On average, how long do companies take to respond to you?', options: ['Under a week', '1–2 weeks', '2–4 weeks', 'Over a month', 'They rarely respond'] },
  { key: 'generic|ghosting_stage', text: 'At what stage are you ghosted most often?', options: ['After applying', 'After phone screen', 'After interview', 'After final round', 'Rarely get ghosted'] },
  { key: 'generic|apps_per_week', text: 'How many applications do you send per week?', options: ['1–5', '6–10', '11–20', '20+', 'I\'m between searches'] },
];

const RESUME_TYPES = new Set(QUESTION_TYPES.map((q) => q.type));

/**
 * Read a submitted answer. Returns
 *   { ok:true, qtype, company, needs:'resume'|'tracker'|'low_confidence'|null }
 * where `needs` names the check the handler must still make (the company is on this user's résumé,
 * in this user's tracker, or a company the verification tier asks about), or { ok:false, error }.
 */
export function readAnswer(questionKey, answer) {
  const key = String(questionKey || '');
  const ans = String(answer || '');
  if (!key || !ans || key.length > 200 || ans.length > 80) return { ok: false, error: 'bad_answer' };
  const generic = GENERIC_QUESTIONS.find((g) => g.key === key);
  if (generic) return generic.options.includes(ans) ? { ok: true, qtype: 'generic', company: null, needs: null } : { ok: false, error: 'bad_answer' };
  const bar = key.indexOf('|');
  if (bar <= 0) return { ok: false, error: 'unknown_question' };
  const qtype = key.slice(0, bar);
  const company = key.slice(bar + 1).trim();
  if (!company || company.length > 120 || company !== company.toLowerCase()) return { ok: false, error: 'unknown_question' };
  if (RESUME_TYPES.has(qtype)) {
    const opts = QUESTION_TYPES.find((q) => q.type === qtype).options;
    return opts.includes(ans) ? { ok: true, qtype, company, needs: 'resume' } : { ok: false, error: 'bad_answer' };
  }
  if (qtype === 'tracker_outcome') return TRACKER_OUTCOME_OPTIONS.includes(ans) ? { ok: true, qtype, company, needs: 'tracker' } : { ok: false, error: 'bad_answer' };
  if (qtype === 'verify_ghost') return VERIFY_OPTIONS.includes(ans) ? { ok: true, qtype, company, needs: 'low_confidence' } : { ok: false, error: 'bad_answer' };
  return { ok: false, error: 'unknown_question' };
}

/** The hiring outcome an answer reports ('ghosted' | 'human'), or null when it reports none. */
export function answerOutcome(qtype, answer) {
  if (!['ghost', 'verify_ghost', 'tracker_outcome'].includes(qtype)) return null;
  const a = String(answer).toLowerCase();
  if (a.includes('ghost') && !a.startsWith('yes')) return 'ghosted';
  if (a.startsWith('yes') || a.includes('interview') || a.includes('hired') || a.includes('rejected')) return 'human';
  return null;
}
