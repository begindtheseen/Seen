// Score explanation — every SeenFit Score explains itself (no black box).
//
// Given the weighted sub-scores, this produces the per-factor contribution breakdown
// (weight, raw sub-score, points contributed, and a plain-English reason) plus a
// one-line summary. The UI's "Why your score is X" panel renders this directly.
import { SEENFIT_WEIGHTS } from './types.js';
import { SKILL_DISPLAY } from './professionalVocabulary.js';
import { tokenize } from './lemma.js';
const REASONS = {
    required_match: (r) => `You match ${pct(r)} of the role's required skills (weighted by importance).`,
    preferred_match: (r) => `You match ${pct(r)} of the role's preferred / nice-to-have skills.`,
    evidence_strength: (r) => `Your résumé backs its claims at ${pct(r)} strength — matched skills appearing inside real accomplishment lines and metrics score higher.`,
    seniority_alignment: (r) => `Your seniority aligns with the role at ${pct(r)} (gaps in level reduce this).`,
    company_process_score: (_r, b) => b.company_process_known === false
        ? `This company isn't graded yet (not enough applicant reports), so this factor is scored neutral (${Math.round(b.company_process_score)}/100).`
        : `The company's hiring process scores ${Math.round(b.company_process_score)}/100 from real applicant outcomes (response/ghost rates).`,
    ats_coverage: (r) => `${pct(r)} of the job's keywords literally appear in your résumé — important for ATS keyword filters.`,
    location_pay_alignment: (r) => `Location / pay alignment is ${pct(r)}.`,
    risk_penalty: (r) => r >= 0.99
        ? `No risk penalty applied.`
        : `A risk penalty reduced the score to ${pct(r)} of full credit (see risk flags).`,
};
function pct(n) {
    return `${Math.round(n * 100)}%`;
}
// Each factor's raw 0–1 value. company_process_score is 0–100, so normalize to 0–1
// for the points math while reporting the 0–100 figure in the reason.
function rawValues(b) {
    return {
        required_match: b.required_match,
        preferred_match: b.preferred_match,
        evidence_strength: b.evidence_strength,
        seniority_alignment: b.seniority_alignment,
        company_process_score: (b.company_process_score ?? 50) / 100,
        ats_coverage: b.ats_coverage,
        location_pay_alignment: b.location_pay_alignment,
        risk_penalty: b.risk_penalty,
    };
}
// A factor we could not measure is NOT scored (2026-10-24 audits: a neutral 50 for an ungraded
// company and a 0.7 for an unknown location quietly cost every applicant ~8.5 points). The
// measured factors' weights are re-scaled to sum to 1; the unmeasured ones are listed with
// `scored: false` and 0 points so the explanation stays complete.
function scoredFactors(b) {
    return Object.keys(SEENFIT_WEIGHTS).filter((k) => !(k === 'company_process_score' && b.company_process_known === false)
        && !(k === 'location_pay_alignment' && b.location_pay_known === false)
        // a posting with no preferred list has nothing to measure there (it used to score 100%)
        && !(k === 'preferred_match' && b.preferred_known === false));
}
export function computeFitScore(b) {
    const raw = rawValues(b);
    const keys = scoredFactors(b);
    const total = keys.reduce((t, k) => t + SEENFIT_WEIGHTS[k], 0) || 1;
    let score = 0;
    for (const k of keys) score += (SEENFIT_WEIGHTS[k] / total) * raw[k];
    return Math.max(0, Math.min(100, Math.round(score * 100)));
}
export function explainScore(b) {
    const raw = rawValues(b);
    const keys = new Set(scoredFactors(b));
    const total = [...keys].reduce((t, k) => t + SEENFIT_WEIGHTS[k], 0) || 1;
    const contributions = Object.keys(SEENFIT_WEIGHTS).map((k) => {
        const scored = keys.has(k);
        const weight = scored ? Number((SEENFIT_WEIGHTS[k] / total).toFixed(3)) : 0;
        const r = raw[k];
        return {
            factor: k,
            weight,
            raw: Number(r.toFixed(3)),
            points: scored ? Number(((SEENFIT_WEIGHTS[k] / total) * r * 100).toFixed(1)) : 0,
            scored,
            reason: scored ? REASONS[k](r, b) : (k === 'location_pay_alignment' ? 'No location to compare — not scored.' : k === 'preferred_match' ? 'The posting lists no preferred skills — not scored.' : REASONS[k](r, b).replace(/, so this factor is scored neutral \(\d+\/100\)\./, ' — not scored.')),
        };
    });
    const fit_score = Math.max(0, Math.min(100, Math.round(contributions.reduce((s, c) => s + c.points, 0))));
    // Sort by points to lead with the biggest drivers.
    const sorted = [...contributions].sort((a, c) => c.points - a.points);
    const topDriver = sorted[0];
    const biggestGap = [...contributions].filter((c) => c.scored).sort((a, c) => a.points / a.weight - c.points / c.weight)[0] || topDriver;
    const summary = `SeenFit Score ${fit_score}/100. Biggest driver: ${labelOf(topDriver.factor)} (${topDriver.points} pts). ` +
        `Biggest opportunity: improve ${labelOf(biggestGap.factor)}.`;
    const notes = [];
    if (b.required_match < 0.5)
        notes.push('You are missing several required skills — see "Missing keywords".');
    if (b.ats_coverage < 0.5)
        notes.push('Many job keywords are absent from your résumé text — add the real ones you have.');
    if (b.company_process_known !== false && (b.company_process_score ?? 50) < 40)
        notes.push('This company has a poor hiring-process track record (ghosting/no response).');
    if (b.risk_penalty < 0.99)
        notes.push('A risk penalty was applied — review the risk flags before relying on this score.');
    return { fit_score, summary, contributions, notes };
}
function labelOf(factor) {
    return {
        required_match: 'required-skill match',
        preferred_match: 'preferred-skill match',
        evidence_strength: 'evidence strength',
        seniority_alignment: 'seniority alignment',
        company_process_score: 'company hiring process',
        ats_coverage: 'ATS keyword coverage',
        location_pay_alignment: 'location/pay alignment',
        risk_penalty: 'risk adjustment',
    }[factor] || factor;
}

// ── ONE verdict (2026-10-24 audits, D4) ─────────────────────────────────────────────────────
// Every surface shows the same thing: a score (or none), a band, and ONE sentence of why that
// names what the résumé shows and what the posting screens on that it does not. An unmet hard
// gate is the first words of the sentence.
// Display spelling of a canonical skill: proper nouns capitalised ("bilingual Spanish", "Excel").
const PROPER = { spanish: 'Spanish', english: 'English', excel: 'Excel', salesforce: 'Salesforce', quickbooks: 'QuickBooks', 'microsoft office': 'Microsoft Office', 'microsoft word': 'Microsoft Word', 'microsoft powerpoint': 'Microsoft PowerPoint', 'google workspace': 'Google Workspace', crm: 'CRM', sql: 'SQL', aws: 'AWS', 'rf scanner': 'RF scanner', 'point of sale': 'point of sale (POS)', go: 'Go', postgresql: 'PostgreSQL', kubernetes: 'Kubernetes', javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python', java: 'Java', react: 'React', 'node.js': 'Node.js', docker: 'Docker', terraform: 'Terraform', graphql: 'GraphQL', mysql: 'MySQL', mongodb: 'MongoDB', tableau: 'Tableau', 'power bi': 'Power BI', sap: 'SAP', rest: 'REST', 'google cloud': 'Google Cloud', azure: 'Azure', git: 'Git', ...SKILL_DISPLAY };
export function displaySkill(label) {
    const l = String(label || '');
    if (PROPER[l]) return PROPER[l];
    return l.replace(/\b(spanish|english|excel|salesforce)\b/g, (w) => PROPER[w] || w);
}
// ONE band function (owner decision 2026-11-10, calibrated by G): ≥ 75 Strong, 60–74 Good, 40–59 Partial, < 40 Weak;
// a posting in a different field (field_match known + different) is "Different field" whatever the number.
export const BAND_THRESHOLDS = { strong: 75, good: 60, partial: 40 };
export function fitBand(score, field = null) {
    if (score == null) return null;
    if (field && field.known && field.level === 'different') return 'Different field';
    return score >= BAND_THRESHOLDS.strong ? 'Strong fit' : score >= BAND_THRESHOLDS.good ? 'Good fit' : score >= BAND_THRESHOLDS.partial ? 'Partial fit' : 'Weak fit';
}
function joinWords(items) {
    if (items.length <= 1) return items.join('');
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
// "lifting 50 lbs" and "lifting 35 lbs" are one physical line: the heavier figure
function heaviestLift(items) {
    const lifts = items.filter((x) => /^lifting\s+\d+/i.test(x));
    if (lifts.length < 2) return items;
    const max = lifts.reduce((m, x) => (Number(x.match(/\d+/)[0]) > Number(m.match(/\d+/)[0]) ? x : m));
    return items.filter((x) => !/^lifting\s+\d+/i.test(x) || x === max);
}
// the kinds of depth a posting asks for, in its own register
function depthWords(field) {
    const cues = (field && field.depthCues) || [];
    return cues.length ? joinWords(cues.slice(0, 3).map((c) => `"${c}"`)) : 'a senior level';
}
const cleanTitle = (t) => String(t || '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
export function buildVerdict({ score, withheld, gates = [], constraints = [], matches = [], requirementCount = 0, field = null, drivers = null, components = null }) {
    const band = fitBand(score, field);
    const gate = gates.length ? gates[0].message : null;
    const imp = (m) => (m.importance === 'required' ? 1 : 0);
    // a gate row that is not met names its own domain: an item in the same words is never also "shown" in the same
    // sentence (the judge read "your résumé shows none in inventory control … you do show inventory management")
    const openRows = constraints.filter((c) => c.grade && c.grade !== 'met' && Array.isArray(c.domain) && c.domain.length);
    const clashes = (label) => { const st = tokenize(String(label || '')).map((t) => t.stem); return openRows.some((c) => c.domain.some((d) => st.includes(d))); };
    const haveAll = [...new Set(matches.filter((m) => m.matched && m.via !== 'related' && !m.soft && !m.inferred).sort((a, b) => (imp(b) - imp(a)) || (b.weight - a.weight)).map((m) => displaySkill(m.surface)))].filter((x) => !/^one of\b/i.test(x));
    const have = haveAll.filter((x) => !clashes(x)).slice(0, 3);
    // "CRM (Salesforce, Zendesk)": a class shown through its instance names the instance
    const byLabel = new Map(matches.filter((m) => m.matched).map((m) => [displaySkill(m.surface), m]));
    const showHave = (x) => { const m = byLabel.get(x); return m && m.instances && m.instances.length ? `${x} (${m.instances.join(', ')})` : x; };
    const skillsOnly = have.filter((x) => { const m = byLabel.get(x); return m && m.skillsOnly; });
    const lack = [...new Set(matches.filter((m) => !m.matched && m.importance === 'required' && !m.soft).sort((a, b) => (b.hard - a.hard) || (b.weight - a.weight)).map((m) => displaySkill(m.surface)))].slice(0, 2);
    const conflict = constraints.find((c) => c.conflict);
    const askLabel = (c) => c.kind === 'schedule' ? `availability (${c.label})` : c.kind === 'physical' ? c.label.split(', ')[0].replace(/^lift /, 'lifting ').replace(/^stand /, 'standing ') : c.label;
    const askRows = constraints.filter((c) => c.status === 'ask' && !c.conflict && ['schedule', 'physical', 'certification', 'age'].includes(c.kind))
        .sort((a, b) => ({ age: 0, certification: 1, schedule: 2, physical: 3 }[a.kind] - { age: 0, certification: 1, schedule: 2, physical: 3 }[b.kind]));
    // every schedule ask is ONE availability item ("availability (weekends, holiday blackout …)")
    const sched = [...new Set(askRows.filter((c) => c.kind === 'schedule').flatMap((c) => c.items && c.items.length ? c.items : [c.label]))].filter((i) => !/^(?:part|full)-time$/.test(i));
    const asks = [
        ...askRows.filter((c) => c.kind === 'age' || (c.kind === 'certification' && c.grade !== 'partly')).map(askLabel),
        ...(sched.length ? [`availability (${sched.slice(0, 3).join(', ')})`] : []),
        ...heaviestLift(askRows.filter((c) => c.kind === 'physical').map(askLabel)),
    ].filter((v, i, arr) => arr.indexOf(v) === i).slice(0, 2);
    // the weakest graded gate that is not met and does not cap (its sentence already says what was counted)
    const soft = constraints.filter((c) => c.grade && c.grade !== 'met' && !c.caps && ['years', 'management', 'seniority', 'degree', 'certification', 'language'].includes(c.kind) && (c.factor ?? 1) < (c.kind === 'language' ? 0.7 : 0.9))
        .sort((a, b) => (a.factor ?? 1) - (b.factor ?? 1))[0] || null;
    const lower = (t) => String(t || '').replace(/\.$/, '').replace(/^([A-Z])(?=[a-z])/, (c) => c.toLowerCase());
    let sentence;
    if (withheld) {
        sentence = requirementCount === 0
            ? 'No score: this listing does not state its requirements, so there is nothing to measure your résumé against.'
            : `No score: only ${requirementCount} requirement${requirementCount === 1 ? '' : 's'} could be read from this listing — too few to measure a fit.`;
    } else {
        const parts = [];
        const used = new Set();
        const different = field && field.known && field.level === 'different';
        const sameRole = field && field.level === 'same' && field.sameRoles && field.sameRoles[0];
        const adjRole = field && field.level === 'adjacent' && field.adjacentRoles && field.adjacentRoles[0];
        const up = drivers && drivers.find((d) => d.direction === 'up');
        const down = drivers && drivers.find((d) => d.direction === 'down');
        const add = (key, text) => { if (!text || used.has(key)) return; used.add(key); parts.push(text); };
        const clause = {
            field: () => different
                ? `this is ${field.postingRole || 'a different kind of role'} and your experience is in ${field.resumeField || 'other work'}${field.transferable && field.transferable.length ? ` — what carries over is ${joinWords(field.transferable.slice(0, 3))}` : ''}`
                : sameRole ? `you have done this work${sameRole.title ? ` as ${/^[aeiou]/i.test(sameRole.title) ? 'an' : 'a'} ${cleanTitle(sameRole.title)}${sameRole.span ? ` (${sameRole.span})` : ''}` : ' before'}`
                : adjRole && adjRole.title ? `your closest experience is as ${/^[aeiou]/i.test(adjRole.title) ? 'an' : 'a'} ${cleanTitle(adjRole.title)}${adjRole.span ? ` (${adjRole.span})` : ''}, next to this field`
                : null,
            // a different field already named what carries over: the same things are never listed twice
            // what a job line shows, then (said apart) what only the skills list names
            have: () => {
                if (!have.length || (different && field.transferable && field.transferable.length)) return null;
                const onJob = have.filter((x) => !skillsOnly.includes(x));
                const verb = gate || different ? 'you do show' : 'you show';
                if (!onJob.length) return `you list ${joinWords(skillsOnly.map(showHave))} in your skills, though no job line shows ${skillsOnly.length === 1 ? 'it' : 'them'}`;
                return `${verb} ${joinWords(onJob.map(showHave))}${skillsOnly.length ? `, and list ${joinWords(skillsOnly.map(showHave))} in your skills (not shown in a job)` : ''}`;
            },
            lack: () => (lack.length ? `the posting also asks for ${joinWords(lack)}, which your résumé doesn't show` : null),
            // the weakest open gate — never a second sentence that repeats the capping gate's evidence
            gate: () => { if (!soft) return null; const t = lower(soft.sentence).split(/(?<=\.)\s+/)[0].replace(/\.$/, ''); const head = (x) => String(x || '').toLowerCase().slice(0, 40); return gate && head(t) === head(lower(gate)) ? null : t; },
        };
        const keyOf = (d) => (!d ? null : d.key === 'title' ? 'field' : d.key === 'core' ? (d.direction === 'up' ? 'have' : 'lack') : d.key === 'years' || d.key === 'gates' ? 'gate' : d.key === 'field' ? 'field' : null);
        // a different field leads with the field; a years gate that only restates it ("your 12 years are in electrical
        // work") is dropped, a licence gate stays
        if (different) add('field', clause.field());
        // the posting wants depth and the person is early in the field: say so first, in numbers
        if (components && components.depthCapped && field) add('depth', `the posting asks for depth (${depthWords(field)}) and your résumé shows ${field.fieldYears >= 1 ? `${field.fieldYears} year${field.fieldYears === 1 ? '' : 's'}` : 'under a year'} in ${field.postingField || 'this field'}`);
        // a skill the person qualifies ("TypeScript (learning)") counts only partly — said once
        const q = matches.find((m) => m.qualified && m.qualifier);
        if (q) add('qualified', `${displaySkill(q.surface)} is marked "${q.qualifier}" on your résumé, so it counts only partly`);
        // the gate's first sentence (its follow-up — "If you supervised anyone, say how many…" — is for the checklist)
        const gateText = gate ? gate.split(/(?<=\.)\s+(?=[A-Z])/)[0].replace(/\.$/, '') : null;
        if (gateText && !(different && gates[0].kind === 'years')) add('cap', parts.length ? lower(gateText) : gateText);
        const upKey = keyOf(up);
        if (upKey && upKey !== 'lack' && upKey !== 'gate') add(upKey, clause[upKey]());
        else if (upKey === 'gate' && !soft) add('field', clause.field());
        const downKey = keyOf(down);
        if (downKey && !(downKey === 'field' && !different)) add(downKey, clause[downKey]());
        if (parts.length < 3) add('have', clause.have());
        if (parts.length < 3) add('gate', clause.gate());
        if (parts.length < 3) add('lack', clause.lack());
        if (conflict) add('conflict', conflict.short || 'this job is part-time and your résumé asks for full-time work');
        if (asks.length && parts.length < 4) add('asks', `it screens on ${joinWords(asks)} — say so if true`);
        const body = parts.length ? parts.join('; ') : 'your résumé lines up with what this posting asks for';
        // every surface strips the number and shows the body as a sentence of its own — it starts with a
        // capital ("you show…" sat under the score as a lowercase line, Tasha, round 3)
        sentence = `${score} — ${body.charAt(0).toUpperCase()}${body.slice(1)}.`;
    }
    return { score: score ?? null, band, sentence, gate, withheld: withheld || null, requirement_count: requirementCount, display: score == null ? 'none' : 'number',
        field_match: field || null, drivers: drivers || null, components: components || null,
        gates_graded: constraints.filter((c) => c.grade && ['years', 'management', 'seniority', 'degree', 'certification', 'language'].includes(c.kind)).map((c) => ({ kind: c.kind, grade: c.grade, caps: !!c.caps, computed: c.computed ?? null, needed: c.needed ?? null, counted: c.counted || [], sentence: c.sentence || c.message })) };
}
// ── Calibrated fit (G, 2026-11-10) ─────────────────────────────────────────────────────────────────────────────
// The hidden acceptance set found the score order upside down: 7 of 8 pairs an expert called a STRONG fit scored 35–57,
// a one-job junior scored 65 against a senior posting, and 16 of 40 pairs sat at exactly 35 (the gate cap). Keyword
// share was the whole score. A recruiter weighs, in order: the credential the job turns on, having done this job (or the
// one next to it), the years in that work, and the core named requirements — and a long tail of nice-to-haves and
// boilerplate cannot sink someone who has done the job. Calibrated against lib/fixtures/calibration (labelled before
// tuning; see lib/optimizer/calibration.test.mjs).
//
//   field  (same 1 · adjacent .5 · different 0 · unplaced .6)          — have you worked in this field?
//   title  (titleMatch from fieldMatch.js)                               — have you done this job?
//   years  (the years gates' ratio, else seniority alignment)            — for long enough?
//   core   (required, non-soft requirements; the denominator is capped at the 10 heaviest, so a long tail cannot sink it)
//   pref   (preferred match) · evidence (evidence strength)
// then × each graded constraint's factor, capped at GATE_CAP by a positively failed gate, and kept under 20 for a
// different field.
export const CALIBRATED_WEIGHTS = { field: 0.20, title: 0.22, years: 0.14, core: 0.32, preferred: 0.05, evidence: 0.07 };
export const DIFFERENT_FIELD_CAP = 18;
export const DEPTH_CAP = 59;
export const ADJACENT_FLOOR = 44;
export const ADJACENT_CEIL = 66;
export const CORE_TOP_N = 10;
/** Coverage of the required, non-soft requirements, the denominator capped at the CORE_TOP_N heaviest. */
export function coreCoverage(matches = []) {
  const req = (matches || []).filter((m) => m.importance === 'required' && !m.soft && m.kind !== 'trait' && !m.fundamental);
  if (!req.length) return null;
  // a requirement read from the posting's own words (not a recognised skill) is less certain to be a real screen
  const w = (m) => (Number(m.weight) || 1) * (m.term && !m.matched ? 0.7 : 1);
  // a class met through a named instance counts in full; a skill the person qualifies ("learning", "basic") counts little;
  // one only in the skills list counts less than one shown in a job
  const credit = (m) => (!m.matched ? 0 : m.qualified ? 0.35 : m.instances && m.instances.length ? (m.skillsOnly ? 0.85 : 1) : m.via === 'related' ? 0.7 : m.inferred ? 0.6 : m.skillsOnly ? 0.75 : 1);
  const got = req.reduce((s, m) => s + w(m) * credit(m), 0);
  const weights = req.map(w).sort((a, b) => b - a);
  const denom = weights.slice(0, CORE_TOP_N).reduce((s, x) => s + x, 0) || 1;
  return Math.max(0, Math.min(1, got / denom));
}
/** The years component: the weakest graded years / management gate's ratio, else seniority alignment. */
// seniorityAlignment's 0.6 means "unknown on either side"; being under the level costs, being over it barely does
function seniorityYears(a) {
  if (a == null || a === 0.6) return 0.85;
  const table = [[1, 1], [0.85, 0.95], [0.75, 0.7], [0.7, 0.9], [0.55, 0.9], [0.5, 0.4], [0.25, 0.15], [0, 0]];
  const hit = table.find(([k]) => Math.abs(k - a) < 0.01);
  return hit ? hit[1] : a;
}
function yearsComponent(constraints, seniority, field) {
  const rows = (constraints || []).filter((c) => (c.kind === 'years' || c.kind === 'management' || c.kind === 'seniority') && c.grade && !(c.grade === 'cannot_tell' && c.factor === 1));
  // no years asked: the level, and how long the person has worked in this field
  const fy = field && field.level === 'same' && Number.isFinite(field.fieldYears) ? (field.fieldYears >= 2 ? 1 : field.fieldYears >= 1 ? 0.8 : 0.5) : 1;
  if (!rows.length) return Math.min(seniorityYears(seniority), fy);
  return Math.min(fy, yearsFromRows(rows));
}
function yearsFromRows(rows) {
  let v = 1;
  for (const c of rows) {
    if (c.grade === 'met') continue;
    const r = c.needed ? Math.max(0, Math.min(1, (Number(c.computed) || 0) / c.needed)) : c.grade === 'partly' ? 0.6 : 0.3;
    v = Math.min(v, c.grade === 'partly' ? Math.max(r, 0.5) : r);
  }
  return v;
}
/**
 * @returns {{ score: number, components: object, drivers: { key: string, label: string, points: number, direction: 'up'|'down' }[] }}
 */
export function calibratedFit({ matches = [], breakdown = {}, constraints = [], field = null, effect = null, scheduleConflict = false }) {
  const F = !field ? 0.6 : !field.known ? 0.6 : field.level === 'same' ? 1 : field.level === 'adjacent' ? 0.5 : 0;
  const T = field ? Number(field.titleMatch) || 0 : 0.4;
  const Y = yearsComponent(constraints, breakdown.seniority_alignment, field);
  const core = coreCoverage(matches);
  // having held this very job implies its core duties: a posting whose list the reader could not make sense of (a
  // "Restaurant Operations Manager" read as "supply base, ambiguity, CK") does not sink someone who has done it
  const doneIt = field && field.level === 'same' ? 0.6 * T : 0;
  const C = Math.max(core == null ? (breakdown.required_match ?? 0.5) : core, doneIt);
  const P = breakdown.preferred_known === false ? C : (breakdown.preferred_match ?? C);
  const E = breakdown.evidence_strength ?? 0.5;
  const W = CALIBRATED_WEIGHTS;
  const parts = { field: W.field * F, title: W.title * T, years: W.years * Y, core: W.core * C, preferred: W.preferred * P, evidence: W.evidence * E };
  let raw = Object.values(parts).reduce((s, x) => s + x, 0) * 100;
  // the job next to yours is a stretch by default: never a long shot on keyword gaps alone (only a gate or a factor
  // takes it lower), and not "good" until the overlap is real
  if (field && field.known && field.level === 'adjacent') raw = Math.max(ADJACENT_FLOOR, Math.min(ADJACENT_CEIL, raw));
  const factor = effect ? effect.factor : 1;
  // a company with a poor hiring record (ghosting) is a risk, not a gap in the person: a light touch only
  const sa = Number(breakdown.seniority_alignment);
  const company = breakdown.company_process_known && Number(breakdown.company_process_score) < 40 ? 0.95 : 1;
  // under the level the posting hires for (a junior developer for a senior role): seniorityAlignment 0.5 = two levels
  // under, 0.25 = three, 0 = four
  // — only for someone genuinely early in the field (under 3 years in it); a long-serving team lead applying up a level is
  // judged by the years and management gates instead
  const early = !field || !Number.isFinite(field.fieldYears) || field.fieldYears < 3;
  const under = !early ? 1 : sa === 0.5 ? 0.85 : sa === 0.25 ? 0.72 : sa === 0 ? 0.6 : 1;
  let score = raw * factor * company * under * (scheduleConflict ? 0.92 : 1);
  if (effect && effect.cap != null) score = Math.min(score, effect.cap);
  if (field && field.known && field.level === 'different') score = Math.min(score, DIFFERENT_FIELD_CAP);
  // depth language ("strong production experience", "architecture", "ownership", "at scale") with under 2 years in the
  // field: a stretch at best, however many of the posting's words the résumé repeats (coordinator round 2, B)
  const depthCapped = !!(field && field.level === 'same' && (field.postingDepth || 0) >= 2 && Number.isFinite(field.fieldYears) && field.fieldYears < 2);
  if (depthCapped && score > DEPTH_CAP) score = DEPTH_CAP;
  score = Math.max(0, Math.min(100, Math.round(score)));
  // drivers: what lifted the score most and what held it back most, in points out of 100
  const lost = { field: W.field * (1 - F), title: W.title * (1 - T), years: W.years * (1 - Y), core: W.core * (1 - C) };
  const ups = Object.entries(parts).filter(([k]) => k in lost).map(([k, v]) => ({ key: k, points: Math.round(v * 100), direction: 'up' }));
  const downs = Object.entries(lost).map(([k, v]) => ({ key: k, points: Math.round(v * 100), direction: 'down' }));
  if (effect && (effect.cap != null || factor < 0.97)) downs.push({ key: 'gates', points: Math.round(raw - Math.min(raw * factor, effect.cap ?? 100)), direction: 'down' });
  const drivers = [ups.sort((a, b) => b.points - a.points)[0], downs.sort((a, b) => b.points - a.points)[0]].filter(Boolean);
  return { score, components: { field: F, title: T, years: Number(Y.toFixed(3)), core: Number(C.toFixed(3)), preferred: Number(P.toFixed(3)), evidence: Number(E.toFixed(3)), factor: Number(factor.toFixed(3)), cap: effect ? effect.cap : null, raw: Math.round(raw), depthCapped }, drivers };
}
