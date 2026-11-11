// Score explanation — every SeenFit Score explains itself (no black box).
//
// Given the weighted sub-scores, this produces the per-factor contribution breakdown
// (weight, raw sub-score, points contributed, and a plain-English reason) plus a
// one-line summary. The UI's "Why your score is X" panel renders this directly.
import { SEENFIT_WEIGHTS } from './types.js';
import { displaySkill } from './displaySkill.js';
import { SKILL_DISPLAY } from './professionalVocabulary.js';
import { tokenize } from './lemma.js';
import { displayedRequirements } from './statements.js';
import { gerundPhrase } from '../text/voice.js';
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
// display spelling lives in ./displaySkill.js (browser-safe; the screens import it from there)
export { displaySkill } from './displaySkill.js';
// ONE band function (owner decision 2026-11-10, calibrated by G): ≥ 75 Strong, 60–74 Good, 40–59 Partial, < 40 Weak;
// a posting in a different field (field_match known + different) is "Different field" whatever the number.
// The ONE source for every surface (the screens import these; no client-side threshold anywhere): the words, the
// thresholds, and fitBandKey for a tone / colour lookup.
export const BAND_THRESHOLDS = Object.freeze({ strong: 75, good: 60, partial: 40 });
export const BAND_WORDS = Object.freeze({ strong: 'Strong fit', good: 'Good fit', partial: 'Partial fit', weak: 'Weak fit', different: 'Different field' });
export function fitBandKey(score, field = null) {
    if (score == null) return null;
    if (field && field.known && field.level === 'different') return 'different';
    return score >= BAND_THRESHOLDS.strong ? 'strong' : score >= BAND_THRESHOLDS.good ? 'good' : score >= BAND_THRESHOLDS.partial ? 'partial' : 'weak';
}
export function fitBand(score, field = null) {
    const k = fitBandKey(score, field);
    return k ? BAND_WORDS[k] : null;
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
export function buildVerdict({ score, withheld, gates = [], constraints = [], matches = [], requirementCount = 0, field = null, drivers = null, components = null, statements = null }) {
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
        // work") is dropped, a license gate stays
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
        // ONE story from the statements (G2, D): who you are against this job, how many of the things they ask for your
        // résumé shows, and the two most important things it does not — in the posting's own words
        const story = !different ? statementStory({ statements, constraints, gates, field, components, matches }) : null;
        if (story) { parts.length = 0; parts.push(...story); if (conflict) parts.splice(1, 0, conflict.short || 'this job is part-time and your résumé asks for full-time work'); }
        const body = parts.length ? parts.join('; ') : 'your résumé lines up with what this posting asks for';
        // every surface strips the number and shows the body as a sentence of its own — it starts with a
        // capital ("you show…" sat under the score as a lowercase line, Tasha, round 3)
        sentence = `${score} — ${body.charAt(0).toUpperCase()}${body.slice(1)}.`;
    }
    return { score: score ?? null, band, sentence, gate, withheld: withheld || null, requirement_count: requirementCount, display: score == null ? 'none' : 'number',
        field_match: field || null, drivers: drivers || null, components: components || null,
        gates_graded: constraints.filter((c) => c.grade && ['years', 'management', 'seniority', 'degree', 'certification', 'language'].includes(c.kind)).map((c) => ({ kind: c.kind, grade: c.grade, caps: !!c.caps, computed: c.computed ?? null, needed: c.needed ?? null, counted: c.counted || [], sentence: c.sentence || c.message })) };
}
// ── The statement story (G2, D) ─────────────────────────────────────────────────────────────────────────────
// A missing statement is named only when it reads as a thing a recruiter would say: not a soft trait, not a lone generic
// word, not an acronym the posting never spells out, not a clipped run-on.
const SOFT_STATEMENT_RE = /^(?:perform\s+high|interpersonal|verbal|written|oral|excellent|strong\s+(?:communication|interpersonal|work\s+ethic|attention)|ability\b|able\b|willing|self[- ]|detail|attention\s+to|organized|organi[sz]ational|team\s*(?:work|player)|collaborat|communication|positive|professional\s+(?:demeanor|attitude)|work\s+(?:closely|independently|well)|must\s+be|comfortable|passion|motivated|flexib|adaptab|reliable|dependable|punctual|customer[- ]focused|problem[- ]solving|critical\s+thinking|time\s+management|multitask)/i;
const LEAD_VERB_RE = /^(?:graduate|hold|possess|interpret|explain|address|provide|maintain|perform|manage|support|ensure|assist|handle|work|communicate|coordinate|prepare|develop|lead|build|create|review|use|operate|follow|complete|process|respond|answer|help|serve|deliver|drive|own|partner|collaborate|participate|conduct|monitor|track|identify|analy[sz]e|design|implement|write|test|deploy|resolve|train|greet|clean|stock|lift|stand|keep|make|take|bring|act|be|have|do|get|set|run|plan|organi[sz]e|oversee|supervise|direct|negotiate|sell|close|prospect|schedule|document|record|report|enter|verify|assess|evaluate|educate|teach|administer|apply|attend|contribute|establish|facilitate|foster|generate|guide|improve|increase|influence|inspect|install|investigate|learn|listen|maximi[sz]e|mentor|motivate|navigate|obtain|optimi[sz]e|perform|present|prioriti[sz]e|promote|protect|provide|recommend|recruit|reduce|represent|research|retain|secure|share|solve|stay|strengthen|translate|understand|update|utili[sz]e|validate)\b/i;
const SOFT_ANYWHERE_RE = /\b(?:judgment|attention\s+to|mindset|attitude|work\s+ethic|curiosity|passion|enthusias\w*|eagerness|willingness|desire\s+to)\b/i;
function displayStatement(s) {
  let t = String(s.text || '').replace(/\s+(?:is|are)\s+(?:beneficial|a\s+plus|preferred|desired|helpful|nice\s+to\s+have)\.?$/i, '').replace(/\s+and\s+similar$/i, '').replace(/[.;:,\s]+$/, '').trim();
  // never the least important line of a posting as the thing missing most: a "help with / assist with" duty (G5)
  if (!t || SOFT_STATEMENT_RE.test(t) || /^(?:help(?:ing)?|assist(?:ing)?|support(?:ing)?|participat\w*|contribut\w*)\b/i.test(t)) return null;
  // a condition (lifting, standing, hours, travel) is a question, never "missing"; a degree the posting lets experience or
  // training replace is not the gap (the degree gate says it) — G5
  if (s.kind === 'physical' || s.kind === 'schedule' || /\b(?:lift|lifting|stand|standing|walk|bend|stoop|pounds|lbs|weekends?|nights?|holidays|travel|on-call|shifts?)\b/i.test(t)) return null;
  if (/\b(?:degree|diploma|bachelor|associate|master|AA|AS|BA|BS)\b/.test(t) && /\bor\s+(?:equivalent|qualifying|comparable)|\bin\s+lieu\b|\bor\s+\d+\+?\s+years\b/i.test(String(s.source || s.text || ''))) return null;
  const words = t.split(/\s+/);
  if (words.length === 1 && !/[A-Z].*[A-Z]|\d|[+#]/.test(t.slice(1))) return null;
  if (/^[A-Z]{2,5}s?$/.test(t) && !/\(/.test(String(s.source || ''))) return null;
  // a long line is left out rather than clipped; so is a line about people or a trait
  // a clause ("duty hours are scheduled…") or a bare instruction ("interpret and explain…") is not a thing to name
  if (BOILER_RE.test(t) || /\b(?:is|are|was|were|will|must|should|can|may)\b/i.test(t) || /^[a-z]+ly\s/i.test(t)) return null;
  // a duty or an instruction said in a sentence is a gerund phrase ("demonstrating, loading and unloading equipment"),
  // never a bare imperative dropped mid-sentence (voice.js handles coordinated verbs)
  let turned = false;
  if (LEAD_VERB_RE.test(t) || s.kind === 'duty') {
    const g = gerundPhrase(t);
    if (!g || g.toLowerCase() === t.toLowerCase() && LEAD_VERB_RE.test(t)) return null;
    turned = g.toLowerCase() !== t.toLowerCase();
    t = g;
  }
  if (t.length > 64 || SOFT_ANYWHERE_RE.test(t) || /^(?:engineers?|people|candidates?|someone|individuals?|you|we|team\s+members?|members?|associates?)\b/i.test(t)) return null;
  // sentence case comes from the reader: a first word the posting itself capitalises mid-line ("Salesforce") keeps it
  const first = t.split(/\s+/)[0];
  const bare = first.replace(/[^A-Za-z0-9]/g, '');
  const src = String(s.source || s.text || '');
  if (turned) return t;
  const capInSource = /[.\d+#]/.test(first.slice(1)) || /[A-Z]/.test(first.slice(1)) || (bare && new RegExp(`[A-Za-z,(/]\\s*${bare}\\b`).test(src.slice(1)));
  return capInSource ? t : t.charAt(0).toLowerCase() + t.slice(1);
}
function yearsWords(y) { const r = Math.round((Number(y) || 0) * 10) / 10; if (r < 1) return 'under a year'; const f = r % 1; return f >= 0.3 && f <= 0.7 && r < 10 ? `${r}` : `about ${Math.round(r)}`; }
/** The short form of a gate that is not met, for the "what's missing" list (null when it has none). */
function gateShort(c) {
  // the headline names as missing only what its own row calls not shown (G6)
  if (!c || c.grade !== 'not_shown' || (c.importance && c.importance !== 'required')) return null;
  if (c.kind === 'years' && c.needed && ['generic', 'field'].includes(c.scope)) return `the ${c.needed}+ years they ask for (you have ${yearsWords(c.computed)})`;
  if (c.kind === 'certification' && c.pending) return `${/^[AEFHILMNORSX][A-Z]/.test(String(c.label)) ? 'an' : 'a'} ${String(c.label).replace(/^an?\s+/i, '')} (you list "${c.pending}")`;
  if (c.kind === 'degree' && c.fieldAsked && c.fieldAsked.length) return `a degree in ${c.fieldAsked.slice(0, 2).join(' or ')}${c.fieldHave ? ` (yours is in ${c.fieldHave})` : ''}`;
  return null;
}
const LEVEL_WORD = { 2: 'mid-level', 3: 'senior', 4: 'lead or manager-level', 5: 'director-level', 6: 'executive' };
/** The requirement and duty lines a person reads (displayed, not a promise). */
export function displayedLines(statements) {
  return (statements || []).filter((s) => s && s.display !== false && s.kind !== 'promise' && (s.importance === 'required' || s.importance === 'duty'));
}
export const TOP_CEIL = 89;
// A required statement a résumé can prove: not a promise, not hidden, not a trait / schedule / physical line, not one the
// judge could not tell
function provable(s) {
  if (!s || s.importance !== 'required' || s.kind === 'promise' || s.kind === 'schedule' || s.kind === 'physical' || s.display === false || s.status === 'cannot_tell') return false;
  const t = String(s.text || '');
  return !(SOFT_STATEMENT_RE.test(t) || SOFT_ANYWHERE_RE.test(t));
}
function newGradWords(ng) {
  const d = String(ng.degree || '');
  const when = (d.match(/,?\s*\(?((?:expected|anticipated)\s+[^,()]+)\)?\s*$/i) || [])[1];
  const name = d.replace(/,?\s*\(?(?:expected|anticipated)\s+[^,()]+\)?\s*$/i, '').replace(/,?\s*(?:19|20)\d\d\s*$/, '').trim();
  const deg = name ? (when ? `you're finishing ${/^[AEFHILMNORSX]\./.test(name) || /^[aeiou]/i.test(name) ? 'an' : 'a'} ${name} (${when})` : `you have ${/^[AEFHILMNORSX]\./.test(name) || /^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}`) : '';
  const ints = (ng.internships || []).map((r) => `${/^[aeiou]/i.test(r.title) ? 'an' : 'a'} ${cleanTitle(r.title)}${r.span ? ` (${r.span})` : ''}`);
  const intText = ints.length ? `internships as ${joinWords(ints)}` : '';
  return deg && intText ? `${deg}, with ${intText}` : deg || `you have ${intText}`;
}
function statementStory({ statements, constraints = [], gates = [], field = null, components = null, matches = [] }) {
  if (!Array.isArray(statements)) return null;
  // the counts are over the lines the person will READ (displayed requirement and duty lines), so the sentence never
  // says "3 of the 3" beside a list of 25 (coordinator, warehouse × 305); lines only the person can answer are said apart
  const all = withGateStatus(statements, constraints);
  // the SAME lines the screen counts (statements.js displayedRequirements = requirement_count), so the sentence's
  // numbers add up to the count on screen (coordinator G3: "2 of the 10 … 6 more" beside "12 requirements")
  const seen = displayedRequirements(all);
  // the person's own answers are counted apart from what the résumé shows (G5): "you said yes to 5"
  const saidYes = seen.filter((s) => s.by === 'you' && s.status === 'shown');
  const saidNo = seen.filter((s) => s.by === 'you' && s.status !== 'shown');
  const judged = seen.filter((s) => s.status !== 'cannot_tell' && s.by !== 'you');
  if (judged.length < 3) return null;
  const req = judged.filter((s) => provable(s) && !BOILER_RE.test(String(s.text || '')));
  const shown = judged.filter((s) => s.status === 'shown').length;
  const partly = judged.filter((s) => s.status === 'partly').length;
  const askOnly = seen.length - judged.length;
  const parts = [];
  // who you are against this job (the capping gate first — it decides everything else)
  const gate = gates.length ? gates[0].message.split(/(?<=\.)\s+(?=[A-Z])/)[0].replace(/\.$/, '') : null;
  const sameRole = field && field.level === 'same' && field.sameRoles && field.sameRoles[0];
  const anyRole = field && field.adjacentRoles && field.adjacentRoles[0];
  const art = (t) => (/^[aeiou]/i.test(t) ? 'an' : 'a');
  const roleWords = (r) => `${cleanTitle(r.title)}${r.span ? ` (${r.span})` : ''}`;
  if (gate) parts.push(gate);
  // a posting written for new graduates: who you are is the degree and the internships (G6)
  else if (field && field.entryLevel && field.newGrad && (field.newGrad.degree || field.newGrad.internships.length)) parts.push(newGradWords(field.newGrad));
  else if (field && field.kindGap && anyRole && anyRole.title) parts.push(`this is ${art(field.kindGap.posting)} ${field.kindGap.posting} ${field.postingField || ''} role and your experience is ${field.kindGap.resume} work as ${art(anyRole.title)} ${roleWords(anyRole)}`.replace(/\s+/g, ' '));
  else if (components && (components.depthCapped || components.levelReason === 'depth') && field) parts.push(`the posting asks for depth (${depthWords(field)}) and your résumé shows ${field.fieldYears >= 1 ? `${field.fieldYears} year${field.fieldYears === 1 ? '' : 's'}` : 'under a year'} in ${field.postingField || 'this field'}`);
  else if (components && components.levelReason === 'title' && field && field.level === 'same' && LEVEL_WORD[field.postingLevel]) parts.push(`this is a ${LEVEL_WORD[field.postingLevel]} role and you have ${field.fieldYears >= 1 ? `${field.fieldYears} years` : 'under a year'} in ${field.postingField || 'this field'}${sameRole && sameRole.title ? ` as ${art(sameRole.title)} ${cleanTitle(sameRole.title)}` : ''}`);
  // the role named is the one closest to the posting by occupation and level (fieldMatch leadRole), the current on a tie
  else if (field && field.leadRole && field.leadRole.title && !field.leadRole.same && sameRole) parts.push(`your closest experience is as ${art(field.leadRole.title)} ${roleWords(field.leadRole)}`);
  else if (sameRole && sameRole.title) parts.push(`${(Number(field.titleMatch) || 0) >= 0.9 ? "you've done this job" : 'you have done this kind of work'} as ${art(sameRole.title)} ${roleWords(sameRole)}`);
  else if (field && field.level === 'adjacent' && anyRole && anyRole.title) parts.push(`your closest experience is as ${art(anyRole.title)} ${roleWords(anyRole)}, next to this field`);
  const q = matches.find((m) => m.qualified && m.qualifier);
  if (q) parts.push(`${displaySkill(q.surface)} is marked "${q.qualifier}" on your résumé, so it counts only partly`);
  // how much of the list the résumé shows
  const n = seen.length;
  // the band can rest on the title / field / years while most lines go uncredited: say that plainly (G5, item 10)
  const thin = field && field.level === 'same' && sameRole && judged.length >= 4 && (shown + partly) / judged.length < 0.5;
  const askLeft = askOnly - saidYes.length - saidNo.length;
  const noText = (x) => { const g = gerundPhrase(String(x.text || '').replace(/\s*\([^)]*\)/g, '').trim()); return g ? g.charAt(0).toLowerCase() + g.slice(1) : ''; };
  // a No on the line a gate already speaks for is said by the gate; any other No is said once, as what the person said
  const gateIds = new Set((gates || []).map((g) => g.statementId).filter(Boolean));
  const noNamed = saidNo.filter((x) => !gateIds.has(x.id)).map(noText).filter(Boolean).slice(0, 2);
  const answered = saidYes.length || saidNo.length
    ? `; you said yes to ${saidYes.length}${saidNo.length ? `${noNamed.length ? ` and no to ${joinWords(noNamed)}` : ` and no to ${saidNo.length}`}` : ''}`.replace('you said yes to 0 and no to', 'you said no to')
    : '';
  const only = (askLeft > 0 ? `; ${askLeft} ${saidYes.length || saidNo.length ? 'more ' : ''}${askLeft === 1 ? 'is something' : 'are things'} only you can say` : '');
  const count = `of the ${n} things they list, ` + (shown === 0 && partly === 0 ? "your résumé doesn't clearly show any"
    : shown === 0 ? `your résumé shows part of ${partly}`
      : `your résumé shows ${shown}${partly ? ` and part of ${partly}` : ''}`);
  // what is missing: the two most important unshown things, gates' short forms included, never a junk label
  const gateRows = constraints.filter((c) => !c.caps).map((c) => ({ c, t: gateShort(c) })).filter((x) => x.t);
  // a line a gate already judged (degree, license, years) is said through the gate, never again as a statement
  const used = new Set(constraints.map((c) => c.statementId).filter(Boolean));
  const missing = [];
  const pool = [...req, ...judged.filter((x) => x.importance === 'duty' && !req.includes(x))];
  for (const s of pool.filter((x) => x.status === 'not_shown' && !used.has(x.id) && !/^\d+\s*(?:[-–]\s*\d+\s*)?\+?\s*years?\b/i.test(String(x.text || '')) && !(gate && /\b(?:degree|diploma|licen[sc]e|certif\w*|bachelor|master)\b/i.test(String(x.text || ''))))) {
    const t = displayStatement(s);
    if (t && !missing.some((m) => m.toLowerCase() === t.toLowerCase())) missing.push(t);
    if (missing.length >= (gateRows.length ? 1 : 2)) break;
  }
  if (gateRows.length) missing.push(gateRows[0].t);
  const m2 = missing.slice(0, 2);
  const list = m2.length === 2 && m2.some((x) => /\sand\s/.test(x)) ? `${m2[0]}, and ${m2[1]}` : joinWords(m2);
  // nothing required missing: the one thing they would like that the résumé does not list (a preferred credential)
  const wish = !m2.length ? constraints.find((c) => c.kind === 'certification' && c.importance && c.importance !== 'required' && c.grade === 'not_shown' && !c.by) : null;
  const tail = m2.length ? `; what's missing most is ${list}` : wish ? `; the one thing they'd like that you don't list is ${/^[AEFHILMNORSX][A-Z]/.test(String(wish.label)) || /^[aeiou]/i.test(String(wish.label)) ? 'an' : 'a'} ${String(wish.label).replace(/^an?\s+/i, '')}${/certif|licen|card|permit/i.test(String(wish.label)) ? '' : ' certification'}` : shown + partly === judged.length ? '; nothing they list is missing' : '';
  // a credential they require that the résumé lists as in progress is partly shown, never named as missing: it is said as
  // what the person lists (G6 — the headline names as missing only rows that are not shown)
  const pend = !gate ? constraints.find((c) => c.kind === 'certification' && c.pending && c.grade === 'partly' && !(c.importance && c.importance !== 'required')) : null;
  const pendText = pend ? `; for the ${String(pend.label).replace(/^an?\s+/i, '')} they require you list "${pend.pending}"` : '';
  parts.push(`${count}${thin ? " — your résumé just doesn't spell out most of what they list" : ''}${answered}${only}${pendText}${tail}`);
  return parts;
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
  // a preferred years row lowers the score through its (30%-strength) factor only, never the years component (G4)
  const rows = (constraints || []).filter((c) => (c.kind === 'years' || c.kind === 'management' || c.kind === 'seniority') && c.grade && !(c.importance && c.importance !== 'required') && !(c.grade === 'cannot_tell' && c.factor === 1));
  // no years asked: the level, and how long the person has worked in this field
  const fy = field && field.level === 'same' && Number.isFinite(field.fieldYears) ? (field.fieldYears >= 2 ? 1 : field.fieldYears >= 1 ? 0.8 : 0.5) : 1;
  // same field and no years asked: time in the field decides; level is judged by the title-level rule (levelShortfall),
  // never twice through the old rank guess (G5 — a records clerk × "Health Information Specialist I" had years 0.15)
  if (!rows.length) return field && field.level === 'same' ? fy : Math.min(seniorityYears(seniority), fy);
  return Math.min(fy, yearsFromRows(rows));
}
function yearsFromRows(rows) {
  let v = 1;
  for (const c of rows) {
    // a row the résumé can neither show nor rule out says nothing about years (its factor already lowers the score)
    if (c.grade === 'met' || c.grade === 'cannot_tell') continue;
    const r = c.needed ? Math.max(0, Math.min(1, (Number(c.computed) || 0) / c.needed)) : c.grade === 'partly' ? 0.6 : 0.3;
    v = Math.min(v, c.grade === 'partly' ? Math.max(r, 0.5) : r);
  }
  return v;
}
/**
 * @returns {{ score: number, components: object, drivers: { key: string, label: string, points: number, direction: 'up'|'down' }[] }}
 */
export function calibratedFit({ matches = [], breakdown = {}, constraints = [], field = null, effect = null, scheduleConflict = false, statements = null, promises = null }) {
  // a posting that says no experience is needed (and never contradicts it) does not hold a different background against
  // anyone next to the field
  const noExp = Array.isArray(promises) && promises.some((p) => !p.contradicted_by && NO_EXPERIENCE_RE.test(String(p.text || p.source || '')));
  const F0 = !field ? 0.6 : !field.known ? 0.6 : field.level === 'same' ? 1 : field.level === 'adjacent' ? 0.5 : 0;
  const T0 = field ? Number(field.titleMatch) || 0 : 0.4;
  const near = noExp && field && field.level !== 'different';
  const F = near ? Math.max(F0, 0.85) : F0;
  const T = near ? Math.max(T0, 0.7) : T0;
  // a posting written for new graduates has no years expectation (G6): a years-shaped line never lowers the score, only a
  // row above a year (the constraint reader already drops 0–1-year rows for such a posting)
  const entry = !!(field && field.entryLevel);
  const Y = entry ? yearsFromRows((constraints || []).filter((c) => c.kind === 'years' && c.grade && !(c.importance && c.importance !== 'required') && (Number(c.needed) || 0) > 1)) : yearsComponent(constraints, breakdown.seniority_alignment, field);
  const core = coreCoverage(matches);
  // having held this very job implies its core duties: a posting whose list the reader could not make sense of (a
  // "Restaurant Operations Manager" read as "supply base, ambiguity, CK") does not sink someone who has done it
  const doneIt = field && field.level === 'same' ? 0.6 * T : 0;
  // what a recruiter credits: the share of the posting's provable lines the résumé shows (shown 1, partly ½) — when the
  // reader judged enough of them, the core follows it (G5: a same-field person whose lines show 92% of the posting scored
  // 13 on keyword overlap). Answered lines (by: 'you') never count here.
  const st0 = statementSupport(statements, constraints);
  const credit = st0 && st0.n >= 4 ? st0.credit : null;
  const C = Math.max(core == null ? (breakdown.required_match ?? 0.5) : core, doneIt, credit == null ? 0 : credit);
  const P = breakdown.preferred_known === false ? C : (breakdown.preferred_match ?? C);
  const E = breakdown.evidence_strength ?? 0.5;
  const W = CALIBRATED_WEIGHTS;
  const parts = { field: W.field * F, title: W.title * T, years: W.years * Y, core: W.core * C, preferred: W.preferred * P, evidence: W.evidence * E };
  let raw = Object.values(parts).reduce((s, x) => s + x, 0) * 100;
  // the job next to yours is a stretch by default: never a long shot on keyword gaps alone (only a gate or a factor
  // takes it lower), and not "good" until the overlap is real
  if (field && field.known && field.level === 'adjacent') raw = Math.max(ADJACENT_FLOOR, near ? raw : Math.min(ADJACENT_CEIL, raw));
  const factor = effect ? effect.factor : 1;
  // a company with a poor hiring record (ghosting) is a risk, not a gap in the person: a light touch only
  const sa = Number(breakdown.seniority_alignment);
  const company = breakdown.company_process_known && Number(breakdown.company_process_score) < 40 ? 0.95 : 1;
  // under the level the posting hires for (a junior developer for a senior role): seniorityAlignment 0.5 = two levels
  // under, 0.25 = three, 0 = four
  // — only for someone genuinely early in the field (under 3 years in it); a long-serving team lead applying up a level is
  // judged by the years and management gates instead
  const early = !field || !Number.isFinite(field.fieldYears) || field.fieldYears < 3;
  const under = !early || entry ? 1 : sa === 0.5 ? 0.85 : sa === 0.25 ? 0.72 : sa === 0 ? 0.6 : 1;
  let score = raw * factor * company * under * (scheduleConflict ? 0.92 : 1);
  if (effect && effect.cap != null) score = Math.min(score, effect.cap);
  if (field && field.known && field.level === 'different') score = Math.min(score, DIFFERENT_FIELD_CAP);
  // depth language ("strong production experience", "architecture", "ownership", "at scale") with under 2 years in the
  // field: a stretch at best, however many of the posting's words the résumé repeats (coordinator round 2, B)
  const depthCapped = !!(field && !entry && field.level === 'same' && (field.postingDepth || 0) >= 2 && Number.isFinite(field.fieldYears) && field.fieldYears < 2);
  if (depthCapped && score > DEPTH_CAP) score = DEPTH_CAP;
  // B ii — level and years: one level under the posting (its title, or depth language in a professional field) or short
  // of the years it states → Good at best; two levels under, under half the years, or both at once → Partial at best
  const lv = levelShortfall(field, constraints);
  let levelCap = null;
  if (lv.under >= 2) levelCap = PARTIAL_CEIL; else if (lv.under >= 1) levelCap = GOOD_CEIL;
  if (levelCap != null && score > levelCap && !(field && field.known && field.level === 'different')) score = levelCap; else levelCap = null;
  // B iii — the same field but a different kind of job: Good at best (the adjacent clamp above already holds it there)
  // B i — Strong only when the statements agree: at least half the required statements shown or partly shown, and the
  // posting's first required statements not missing
  const st = statementSupport(statements, constraints);
  let statementCap = null;
  if (st && !st.strongOk && score > GOOD_CEIL) { score = GOOD_CEIL; statementCap = GOOD_CEIL; }
  // B iv — someone who has done this very job, for the years asked, is not dragged under Good by a tail of unshown
  // nice-to-haves (never over a positively failed gate, a level gap, or a different kind of job)
  // 90+ says "nothing to add": only when no line the person reads is unshown and at most one is partly shown
  let topCap = null;
  if (Array.isArray(statements) && score > TOP_CEIL) {
    const lines = displayedLines(withGateStatus(statements, constraints)).filter((x) => x.status !== 'cannot_tell' && x.by !== 'you');
    if (lines.length >= 3 && (lines.some((x) => x.status === 'not_shown') || lines.filter((x) => x.status === 'partly').length > 1)) { score = TOP_CEIL; topCap = TOP_CEIL; }
  }
  let floored = false;
  if (field && field.level === 'same' && (Number(field.titleMatch) || 0) >= 0.9 && lv.under === 0 && !(effect && effect.cap != null) && factor >= 0.85 && score < BAND_THRESHOLDS.good && (!st || st.share >= 0.34)) { score = BAND_THRESHOLDS.good; floored = true; }
  // G6 — the headline agrees with its own lines: with no failed hard gate, the share S of the lines the person reads that
  // the résumé shows (partly = ½) sets a floor and a ceiling on the band (agreeingBand)
  const S = st ? st.credit : null;
  const failedHard = hardGateFailed(constraints, effect);
  let agreed = null;
  if (S != null && !failedHard) {
    const strongOk = field && field.level === 'same' && field.leadRole && field.leadRole.current && field.leadRole.same;
    const lo = S >= AGREE_STRONG && strongOk ? BAND_THRESHOLDS.strong : S >= AGREE_GOOD ? BAND_THRESHOLDS.good : 0;
    const hi = S <= AGREE_PARTIAL ? PARTIAL_CEIL : 100;
    if (score < lo) { score = lo; agreed = 'floor'; }
    if (score > hi) { score = hi; agreed = 'ceiling'; }
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  // drivers: what lifted the score most and what held it back most, in points out of 100
  const lost = { field: W.field * (1 - F), title: W.title * (1 - T), years: W.years * (1 - Y), core: W.core * (1 - C) };
  const ups = Object.entries(parts).filter(([k]) => k in lost).map(([k, v]) => ({ key: k, points: Math.round(v * 100), direction: 'up' }));
  const downs = Object.entries(lost).map(([k, v]) => ({ key: k, points: Math.round(v * 100), direction: 'down' }));
  if (effect && (effect.cap != null || factor < 0.97)) downs.push({ key: 'gates', points: Math.round(raw - Math.min(raw * factor, effect.cap ?? 100)), direction: 'down' });
  const drivers = [ups.sort((a, b) => b.points - a.points)[0], downs.sort((a, b) => b.points - a.points)[0]].filter(Boolean);
  return { score, components: { field: F, title: T, years: Number(Y.toFixed(3)), core: Number(C.toFixed(3)), preferred: Number(P.toFixed(3)), evidence: Number(E.toFixed(3)), factor: Number(factor.toFixed(3)), cap: effect ? effect.cap : null, raw: Math.round(raw), depthCapped,
    levelUnder: lv.under, levelCap, levelReason: lv.reason, statementCap, topCap, statementShare: st ? Number(st.share.toFixed(2)) : null, statementCredit: S == null ? null : Number(S.toFixed(2)), failedHard, agreed, floored }, drivers };
}
// G6 — the three numbers of the headline-agrees rule, set once on the shared calibration sets (fresh2 / pairs / holdout /
// fresh) and frozen: S ≥ AGREE_GOOD is Good or better, S ≥ AGREE_STRONG with the current job in the posting's occupation is
// Strong, S ≤ AGREE_PARTIAL is never above Partial (S = the share of the lines the person reads, traits and "only you can
// say" set aside, partly ½). 0.25 put three expert-Strong pairs two bands low (the reader under-credits their lines);
// 0.20 is the largest ceiling at which within-one-band does not fall on any set.
export const AGREE_GOOD = 0.70;
export const AGREE_STRONG = 0.85;
export const AGREE_PARTIAL = 0.20;
const HARD_KINDS = new Set(['degree', 'license', 'clearance', 'years']);
/** A failed hard gate: a capping gate, or a required degree / license / clearance / stated years (or a must-have
 *  certification) the gate says is not shown. */
export function hardGateFailed(constraints = [], effect = null) {
  if (effect && effect.cap != null) return true;
  return (constraints || []).some((c) => c && c.grade === 'not_shown' && !(c.importance && c.importance !== 'required')
    && (HARD_KINDS.has(c.kind) || (c.kind === 'certification' && (c.gate || c.caps))));
}
const NO_EXPERIENCE_RE = /\b(?:no\s+(?:prior\s+|previous\s+)?experience\s+(?:is\s+)?(?:needed|necessary|required)|experience\s+(?:is\s+)?not\s+required|no\s+experience\s*[!?.]|we(?:'|’)ll\s+train\s+(?:you|the\s+right))\b/i;
export const GOOD_CEIL = 74;
export const PARTIAL_CEIL = 59;
/** How far under the posting's level the person is: 0, 1 (one level or short of the years) or 2 (two levels, under half
 *  the years, or both at once), with the reason in words for the sentence. */
export function levelShortfall(field, constraints = []) {
  const gap = field && Number.isFinite(field.levelGap) ? field.levelGap : 0;
  const byLevel = gap >= 2 ? 2 : gap >= 1 ? 1 : 0;
  let byYears = 0, row = null;
  for (const c of constraints || []) {
    // years in the job's field, any work, or managing people (a stated number of years leading others)
    if (c.kind !== 'years' || (c.importance && c.importance !== 'required') || !c.needed || !(['generic', 'field', 'management'].includes(c.scope))) continue;
    if (c.grade === 'met' || c.grade === 'cannot_tell') continue;
    // the nearest work (a field next to it) counts at half, as the years grader's own reach does
    // a specialty the résumé never names, held inside years in its field: the level is the field's (G6 addendum a)
    const have = c.specialtyOnly ? Number(c.fieldYears) || 0 : (Number(c.computed) || 0) + 0.5 * (Number(c.nearest && c.nearest.years) || 0);
    const u = have < c.needed * 0.5 ? 2 : have + 0.25 < c.needed ? 1 : 0;
    if (u > byYears) { byYears = u; row = c; }
  }
  const under = Math.min(2, Math.max(byLevel, byYears) + (byLevel >= 1 && byYears >= 1 ? 1 : 0));
  return { under, byLevel, byYears, row, reason: under ? (byYears && row ? 'years' : field && field.levelFrom === 'depth' ? 'depth' : 'title') : null };
}
/** The required statements' support: share shown or partly, and whether the band may be Strong. */
// a constraint's own grade wins for the statement it was read from (a years / degree / license line the gates judged)
export function withGateStatus(statements, constraints = []) {
  if (!Array.isArray(statements)) return statements;
  const byId = new Map((constraints || []).filter((c) => c.statementId && c.statementStatus).map((c) => [c.statementId, c.statementStatus]));
  return statements.map((s) => (byId.has(s.id) && byId.get(s.id) !== s.status ? { ...s, status: byId.get(s.id), gateStatus: true } : s));
}
// boilerplate a reader can mistake for a requirement (pay, legal, "may change", "not limited to")
const BOILER_RE = /\bother\s+duties\b|\bas\s+(?:assigned|instructed|needed|directed|required)\b|\b(?:may|might|could|dependent\s+upon|depends\s+on|not\s+limited|eligib\w*|employees?\s+must|job\s+description|base\s+pay|equal\s+opportunity|ccpa|privacy|duties\s+and\s+responsibilities|include,?\s+but)\b/i;
export function statementSupport(statements, constraints = []) {
  if (!Array.isArray(statements)) return null;
  // the lines the person reads (the screen's own count), judged ones only; traits / boilerplate set aside when enough
  // remain — "Strong" beside "your résumé shows 1 and part of 2 of the 8 things they list" was the G3 contradiction
  // a line the person answered (by: 'you') was a question before the answer: it never moves the statement rules — the
  // score moves through the constraint the answer changed, and only there (G5)
  const judged = displayedRequirements(withGateStatus(statements, constraints)).filter((s) => s.status !== 'cannot_tell' && s.by !== 'you');
  const real = judged.filter((s) => !(SOFT_STATEMENT_RE.test(String(s.text || '')) || SOFT_ANYWHERE_RE.test(String(s.text || ''))) && !BOILER_RE.test(String(s.text || '')));
  const req = real.length >= 3 ? real : judged;
  if (req.length < 3) return null;
  const ok = (s) => s.status === 'shown' || s.status === 'partly';
  const share = req.filter(ok).length / req.length;
  // the posting's first two requirement lines a recruiter would name
  const named = req.filter((s) => s.kind === 'requirement' && (s.status !== 'not_shown' || displayStatement(s)));
  const firsts = named.slice(0, 2);
  const topMissing = firsts.filter((s) => s.status === 'not_shown');
  const credit = req.reduce((a, s) => a + (s.status === 'shown' ? 1 : s.status === 'partly' ? 0.5 : 0), 0) / req.length;
  return { share, credit, n: req.length, shown: req.filter(ok).length, topMissing, strongOk: share >= 0.5 && !(topMissing.length >= 2 || (topMissing.length === 1 && share < 0.75)) };
}
