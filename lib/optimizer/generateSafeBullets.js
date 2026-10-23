// Deterministic résumé bullet generation from EXISTING evidence only. NO external AI.
//
// CORE ANTI-HALLUCINATION RULE: a bullet may only use skills/tools/metrics that came
// from the résumé itself (the ResumeFact evidence). We NEVER invent a skill, number,
// tool, title, degree, or certification. Templates are pure string assembly over real
// evidence. If a number would strengthen a bullet, we emit a `confirm_before_using`
// entry with a placeholder instead of fabricating one.
//
// Templates (per spec):
//   1. action + context + process/tool + result
//   2. customer/service + volume/pace + reliability
//   3. operations/logistics + accuracy + time-sensitivity
function cap(s) {
    return s ? s[0].toUpperCase() + s.slice(1) : s;
}
// Surface label for a normalized skill — strip namespace prefixes, keep it readable.
function pretty(skill) {
    return skill.replace(/^(metric:|seniority:|cert:|education:)/, '');
}
// Whole-token, case-insensitive presence of a phrase in a bullet.
function bulletHas(text, phrase) {
    const hay = ` ${String(text || '').toLowerCase()} `;
    const needle = String(phrase || '').toLowerCase().trim();
    if (!needle) return false;
    let from = 0;
    while (true) {
        const idx = hay.indexOf(needle, from);
        if (idx === -1) return false;
        const before = hay[idx - 1] || ' ';
        const after = hay[idx + needle.length] || ' ';
        if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
        from = idx + 1;
    }
}
const DUTY_LEAD_RE = /^(responsible for|duties included|worked on|helped with|in charge of|tasked with)\s+/i;
// Conservative, grounded improvement of a real résumé bullet (see generateSafeBullets).
function improveBullet(original, label, aliasPhrase) {
    let text = String(original || '').replace(/^\s*[•\-*▪◦·‣–—]\s*/, '').trim();
    const m = DUTY_LEAD_RE.exec(text);
    if (m) text = `Handled ${text.slice(m[0].length)}`;
    text = cap(text);
    if (label && !bulletHas(text, label)) {
        // Surface the literal keyword next to the alias the résumé used, once.
        const alias = aliasPhrase && aliasPhrase.toLowerCase() !== label.toLowerCase() ? aliasPhrase : null;
        if (alias && bulletHas(text, alias)) {
            const re = new RegExp(`(^|[^a-z0-9])(${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![a-z0-9])`, 'i');
            text = text.replace(re, (_, pre, found) => `${pre}${found} (${label})`);
        }
    }
    if (!/[.!?]$/.test(text)) text += '.';
    return text;
}
export function generateSafeBullets(resumeFacts, matches) {
    const safe = [];
    const confirm = [];
    // Build the allowed evidence set — only normalized skills that exist in the résumé, with
    // WHERE they were found (extractResumeFacts.evidenceKind: 'bullet' | 'summary' | 'skills' …).
    const evidenceBySkill = new Map();
    for (const f of resumeFacts) {
        if ((f.factType === 'skill' || f.factType === 'tool') && !evidenceBySkill.has(f.normalizedLabel)) {
            evidenceBySkill.set(f.normalizedLabel, { text: f.evidenceText, kind: f.evidenceKind || 'other', phrase: f.label });
        }
    }
    const hasMetric = resumeFacts.some((f) => f.factType === 'metric');
    // Generate one bullet per MATCHED requirement that is grounded in résumé evidence.
    // (matched + has evidence guarantees the skill is in the résumé — no invention.)
    //
    // A rewrite ("before → after") is only honest when (a) the skill is DIRECTLY in the résumé
    // (a related-skill match is a transferable claim, not the résumé's own words) and (b) the
    // evidence span is a real experience bullet. A skill that only appears in the summary or
    // skills list has no bullet to rewrite — it becomes a confirm-before-using prompt so the UI
    // asks for a real bullet instead of showing a summary fragment as "before".
    const used = new Set();
    const usedEvidence = new Set();
    for (const m of matches) {
        if (!m.matched || !m.evidence)
            continue;
        const skill = m.requirement;
        if (used.has(skill))
            continue;
        used.add(skill);
        const ev = evidenceBySkill.get(skill);
        const evidence = (ev && ev.text) || m.evidence;
        const evidenceKind = ev ? ev.kind : 'other';
        const label = pretty(m.surface);
        const direct = m.via === 'exact' || m.via === 'alias';
        if (!direct || evidenceKind !== 'bullet' || usedEvidence.has(evidence)) {
            confirm.push({
                text: `(New bullet to add) Describe real work where you used ${label}, and attach a number you can defend.`,
                reason: direct
                    ? `"${label}" appears in your résumé but not in an experience bullet, so there is nothing safe to rewrite — write the bullet yourself, only if it reflects real work.`
                    : `"${label}" is related to something in your résumé, not stated in it — add it only if it is true.`,
                placeholder: label,
                requirement: skill,
            });
            continue;
        }
        usedEvidence.add(evidence);
        // The "after" is the person's OWN bullet, conservatively improved — never a template
        // sentence that throws the bullet's facts away. Two edits only: lead with a verb instead
        // of a duty phrase, and make the job's literal keyword visible next to the alias the
        // résumé used ("POS" → "POS (point of sale)") so ATS keyword matching sees it. If the
        // bullet already carries the literal keyword, it is returned cleaned and unchanged.
        const text = improveBullet(evidence, label, ev && ev.phrase);
        const template = text.toLowerCase().includes(label.toLowerCase()) && !bulletHas(evidence, label) ? 'keyword_surfaced' : 'kept';
        safe.push({ text, evidenceUsed: [evidence], template });
        // Offer a quantified variant the user must confirm — never fabricate the number.
        if (!hasMetric) {
            confirm.push({
                text: `${text.replace(/\.$/, '')} — handling [X] per day/week.`,
                reason: 'Add the real number from your experience to make this measurable. We will not invent it.',
                placeholder: '[X]',
            });
        }
    }
    // If the résumé has real metrics, suggest pairing one with a matched skill — but
    // since we cannot be certain the metric belongs to that exact skill, it goes under
    // confirm_before_using, not safe_bullets.
    const metricFacts = resumeFacts.filter((f) => f.factType === 'metric').slice(0, 2);
    for (const mf of metricFacts) {
        const anchorSkill = [...used][0];
        if (!anchorSkill)
            break;
        confirm.push({
            text: `${cap(pretty(anchorSkill))} work that produced ${pretty(mf.label)} — confirm this figure applies here before using.`,
            reason: 'This number is from your résumé but may belong to a different role/skill. Confirm it fits this bullet.',
            placeholder: pretty(mf.label),
        });
    }
    return { safe_bullets: safe.slice(0, 6), confirm_before_using: confirm.slice(0, 6) };
}
// Hard guarantee used by tests: every skill referenced in safe_bullets must be a
// normalized skill/tool present in the résumé facts (output skills ⊆ résumé evidence).
export function bulletSkillsSubsetOf(result, resumeFacts) {
    const evidenceTexts = new Set(resumeFacts.filter((f) => f.factType === 'skill' || f.factType === 'tool').map((f) => f.evidenceText));
    for (const b of result.safe_bullets) {
        for (const e of b.evidenceUsed) {
            if (!evidenceTexts.has(e))
                return false;
        }
    }
    return true;
}
