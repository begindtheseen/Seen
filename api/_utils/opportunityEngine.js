// Opportunity Engine — the behind-the-scenes data/conversion layer.
//
// Given a user's footprint (applications + hiring events, profile, resume signals,
// already-answered questions, credit state), it returns a ranked, deduplicated list
// of "opportunities" — survey-shaped questions, each tagged with the data point it
// captures. These feed the earn-credit survey: answer = insight (data) + 1 credit.
//
// Pure and side-effect free, so it is fully unit-testable. See OPPORTUNITY_ENGINE.md.

function companyKey(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function hasEvent(app, type) {
  return Array.isArray(app.events) && app.events.some((e) => e && e.type === type);
}

function opp(o) {
  return {
    key: o.key,
    company: o.company || '',
    prompt: o.prompt || '',
    text: o.text,
    options: o.options,
    credit_value: 1,
    source: 'engine',
    data_point: o.dataPoint,
    category: o.category,
    tier: o.tier,
    feeds_reports: !!o.feedsReports,
  };
}

/**
 * Build the ranked opportunity queue for a user.
 *
 * @param {Object} input
 * @param {Array}  input.apps          - [{ company, role, status, stage, appliedAt, events:[{type,date}] }]
 * @param {Object} input.profile       - { experience, city, ... }
 * @param {Object} input.resumeSignals - { skills:[], seniority, function, years_exp } | null
 * @param {Array|Set} input.answeredKeys - question keys already answered (for dedup)
 * @param {number} input.dailyEarned   - credits earned today
 * @param {number} input.dailyCap      - daily earn cap (default 5)
 * @param {number} input.maxQuestions  - max questions to return (default 8)
 * @returns {Array} ranked, deduped opportunities (survey question shape)
 */
export function buildOpportunities(input = {}) {
  const {
    apps = [], profile = {}, resumeSignals = null,
    answeredKeys = [], dailyEarned = 0, dailyCap = 5, maxQuestions = 8,
  } = input;

  const answered = new Set(answeredKeys);
  const now = Date.now();
  const out = [];
  const seen = new Set();
  const push = (o) => {
    if (answered.has(o.key) || seen.has(o.key)) return;
    seen.add(o.key);
    out.push(o);
  };

  for (const app of apps) {
    const ck = companyKey(app.company);
    if (!ck) continue;
    const co = app.company;
    const role = app.role || '';
    const prompt = `${co}${role ? ' · ' + role : ''}`;
    const status = app.status || 'active';
    const appliedAt = app.appliedAt || app.applied_at || now;
    const daysSince = Math.max(0, Math.floor((now - appliedAt) / 86400000));
    const gotResponse = hasEvent(app, 'response_received') || hasEvent(app, 'interview_received') || status === 'hired' || status === 'rejected';
    const gotInterview = hasEvent(app, 'interview_received') || hasEvent(app, 'interview_completed');

    // Tier 1 — apply channel (referrals shift outcomes 10–40%)
    if (daysSince >= 1) push(opp({
      key: `opp_apply_channel|${ck}`, company: co, prompt, tier: 1,
      dataPoint: 'apply_channel', category: 'application_outcome',
      text: `How did you apply to ${co}?`,
      options: ['Referral', 'Recruiter reached out', 'Direct on company site', 'Job board (LinkedIn/Indeed/etc.)'],
    }));

    // Tier 1 — interview type / count once there's a response
    if (gotResponse) push(opp({
      key: `opp_interview_type|${ck}`, company: co, prompt, tier: 1,
      dataPoint: 'interview_type', category: 'company_experience', feedsReports: true,
      text: `What kind of interview did ${co} run?`,
      options: ['Phone screen', 'Video interview', 'Technical / take-home', 'On-site', 'No interview yet'],
    }));
    if (gotInterview) push(opp({
      key: `opp_interview_count|${ck}`, company: co, prompt, tier: 1,
      dataPoint: 'interview_count', category: 'company_experience', feedsReports: true,
      text: `How many interview rounds with ${co} so far?`,
      options: ['1', '2', '3', '4', '5+'],
    }));

    // Tier 2 — terminal-outcome detail
    if (status === 'rejected') {
      push(opp({
        key: `opp_rejection_stage|${ck}`, company: co, prompt, tier: 2,
        dataPoint: 'rejection_stage', category: 'company_experience', feedsReports: true,
        text: `At what stage did ${co} reject you?`,
        options: ['After applying (no response)', 'After a screen', 'After phone', 'After on-site', 'After final round'],
      }));
      push(opp({
        key: `opp_would_reapply|${ck}`, company: co, prompt, tier: 2,
        dataPoint: 'would_reapply', category: 'company_experience',
        text: `Would you apply to ${co} again?`, options: ['Yes', 'Maybe', 'No'],
      }));
    }
    if (status === 'ghosted') {
      push(opp({
        key: `opp_ghost_expectation|${ck}`, company: co, prompt, tier: 2,
        dataPoint: 'ghost_expectation', category: 'company_experience', feedsReports: true,
        text: `When did ${co} say you'd hear back?`,
        options: ['They gave a date and missed it', 'Vague "we\'ll be in touch"', 'No timeline given', 'Never any contact'],
      }));
      push(opp({
        key: `opp_would_reapply|${ck}`, company: co, prompt, tier: 2,
        dataPoint: 'would_reapply', category: 'company_experience',
        text: `Would you apply to ${co} again?`, options: ['Yes', 'Maybe', 'No'],
      }));
    }
    if (status === 'hired') {
      push(opp({
        key: `opp_offer_accepted|${ck}`, company: co, prompt, tier: 2,
        dataPoint: 'offer_accepted', category: 'application_outcome',
        text: `Did you accept the offer from ${co}?`, options: ['Accepted', 'Declined', 'Still deciding'],
      }));
      push(opp({
        key: `opp_offer_salary|${ck}`, company: co, prompt, tier: 2,
        dataPoint: 'offer_salary_band', category: 'application_outcome',
        text: `Base salary band for the ${co} offer?`,
        options: ['< $60k', '$60–100k', '$100–150k', '$150–200k', '$200k+', 'Prefer not to say'],
      }));
    }
  }

  // Global profile gaps (about the user, not a company)
  push(opp({ key: 'opp_employment_status', prompt: 'Your search', tier: 1, dataPoint: 'employment_status', category: 'profile',
    text: 'Where are you in your search right now?', options: ['Employed, casually looking', 'Employed, actively looking', 'Unemployed, searching', 'Just exploring'] }));
  push(opp({ key: 'opp_visa', prompt: 'Your search', tier: 3, dataPoint: 'visa_sponsorship', category: 'profile',
    text: 'Will you need visa sponsorship?', options: ['No', 'Yes', 'Not sure'] }));
  push(opp({ key: 'opp_salary_target', prompt: 'Your search', tier: 3, dataPoint: 'salary_target', category: 'profile',
    text: 'What base salary are you targeting?', options: ['< $60k', '$60–100k', '$100–150k', '$150–200k', '$200k+'] }));
  push(opp({ key: 'opp_urgency', prompt: 'Your search', tier: 3, dataPoint: 'search_urgency', category: 'profile',
    text: 'How soon do you want a new role?', options: ['ASAP', 'Within 3 months', 'No rush', 'Just browsing'] }));
  push(opp({ key: 'opp_company_size', prompt: 'Your search', tier: 3, dataPoint: 'company_size_pref', category: 'profile',
    text: 'Company size you prefer?', options: ['Startup', 'Scale-up', 'Large company', 'No preference'] }));

  // Resume-derived (only if we have parsed signals)
  if (resumeSignals && Array.isArray(resumeSignals.skills) && resumeSignals.skills.length) {
    const skill = resumeSignals.skills[0];
    push(opp({ key: 'opp_skill_depth', prompt: 'Your resume', tier: 3, dataPoint: 'skill_depth', category: 'resume',
      text: `How deep is your ${skill} experience?`, options: ['Familiar', 'Proficient', 'Expert'] }));
  }

  // Rank by tier (lower = sooner). Terminal-outcome apps already surface their
  // tier-2 questions; within a tier, original insertion order (app order) holds.
  out.sort((a, b) => a.tier - b.tier);

  const cap = Math.max(1, maxQuestions);
  return out.slice(0, cap);
}

export const _internal = { companyKey, hasEvent };
