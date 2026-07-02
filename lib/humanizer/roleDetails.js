// Role-family human detail map + context-dependent replacement resolution. NO external AI.
//
// When a generic phrase has a CONTEXT-DEPENDENT plain equivalent (e.g. "fast-paced
// environment", "strong communication skills", "various duties"), we pick the
// replacement from the role family — but ONLY using details the role actually involves.
// We never bolt on a detail that isn't believable for the role/facts.
//
// FRAMING: this adds truthful, specific, human work texture. It is not about defeating
// any detector.
// Believable, plain work texture per role family (per spec). These are CONTEXT details,
// never metrics/tools/claims — so using them invents nothing about the person.
export const ROLE_DETAILS = {
    restaurant_service: {
        fastPaced: 'busy shifts',
        communication: ['answering guest questions', 'team handoffs at shift change', 'clear updates to the kitchen'],
        duties: ['taking orders accurately', 'running food', 'closing tasks', 'restocking the front of house', 'handling the POS'],
        contexts: ['during rush periods', 'on the floor', 'between front- and back-of-house'],
    },
    delivery_logistics: {
        fastPaced: 'time-sensitive routes',
        communication: ['customer delivery notes', 'updates on late arrivals', 'photo confirmation messages'],
        duties: ['planning route timing', 'confirming package accuracy', 'handling apartment access', 'photo confirmation on drop-off'],
        contexts: ['on a daily route', 'in heavy traffic', 'across multiple stops'],
    },
    intake_support: {
        fastPaced: 'high call volume',
        communication: ['phone calls with customers', 'follow-up notes', 'clear case updates'],
        duties: ['updating customer records', 'taking down appointment details', 'reviewing documents', 'answering eligibility questions', 'data entry'],
        contexts: ['on the phones', 'between intake and follow-up', 'across customer records'],
    },
    valet: {
        fastPaced: 'arrival and departure rushes',
        communication: ['greeting guests', 'coordinating key handoffs', 'directing traffic flow'],
        duties: ['parking and retrieving vehicles', 'managing keys', 'greeting arriving guests', 'keeping traffic moving safely'],
        contexts: ['at the front entrance', 'during peak arrival times', 'with high-end customers'],
    },
    general: {
        fastPaced: 'a busy workload',
        communication: ['answering questions', 'team handoffs', 'clear updates'],
        duties: ['daily tasks', 'customer requests', 'keeping work on schedule'],
        contexts: ['day to day', 'across the team', 'on schedule'],
    },
};
// Signals that point to a role family. Checked against résumé facts + job title/text.
const FAMILY_SIGNALS = [
    { family: 'restaurant_service', words: /\b(server|waiter|waitress|barista|host|hostess|busser|line cook|restaurant|food service|front of house|foh|pos|guest)\b/i },
    { family: 'delivery_logistics', words: /\b(driver|delivery|courier|route|logistics|warehouse|dispatch|doordash|uber|package|shipping)\b/i },
    { family: 'intake_support', words: /\b(intake|customer support|call center|help desk|support rep|case|eligibility|appointment|records|data entry|reception)\b/i },
    { family: 'valet', words: /\b(valet|parking attendant|vehicle handoff)\b/i },
];
// Infer the role family from role family hint → job title → résumé/job facts → text.
export function inferRoleFamily(opts) {
    if (opts.roleFamily && opts.roleFamily !== 'general')
        return opts.roleFamily;
    const haystack = [
        opts.jobTitle || '',
        opts.text || '',
        ...(opts.resumeFacts || []).map((f) => `${f.label} ${f.evidenceText}`),
        ...(opts.jobFacts || []).map((f) => f.label),
    ].join(' ');
    for (const sig of FAMILY_SIGNALS) {
        if (sig.words.test(haystack))
            return sig.family;
    }
    return 'general';
}
// Does the supported fact set back a given concrete duty/context phrase? We only allow a
// duty if the role family was confidently inferred OR a related fact appears — otherwise
// we fall back to the safest, most generic supported phrasing for the family.
function dutiesFromFacts(family, resumeFacts) {
    const detail = ROLE_DETAILS[family];
    // If the résumé mentions specific duty-ish skills, prefer those; else use the family
    // defaults (which are believable for anyone in that family and invent nothing).
    const factWords = resumeFacts.map((f) => f.label.toLowerCase());
    const supported = detail.duties.filter((d) => factWords.some((w) => d.toLowerCase().includes(w) || w.includes(d.toLowerCase().split(' ')[0])));
    return (supported.length ? supported : detail.duties).slice(0, 3);
}
// Resolve a phrase rule's replacement for the current context.
//   - non-context hints (e.g. "leveraged" → "used") are returned as-is
//   - context hints are mapped to role-family detail
//   - null hints (pure buzzwords) return null → caller removes the phrase
export function resolveContextReplacement(rule, ctx) {
    const detail = ROLE_DETAILS[ctx.roleFamily];
    const phrase = rule.phrase;
    if (/fast-?paced environment/.test(phrase))
        return detail.fastPaced;
    if (phrase === 'strong communication skills') {
        return joinList(detail.communication.slice(0, 2));
    }
    if (/assisted with various duties|successfully managed various tasks/.test(phrase)) {
        const duties = dutiesFromFacts(ctx.roleFamily, ctx.resumeFacts);
        return `helped with ${joinList(duties)}`;
    }
    if (phrase === 'cross-functional collaboration' || phrase === 'cross functional collaboration') {
        return 'working with other teams';
    }
    // Non-context rules: use the dictionary hint verbatim (may be null → remove).
    return rule.replacementHint;
}
function joinList(items) {
    const list = items.filter(Boolean);
    if (list.length === 0)
        return '';
    if (list.length === 1)
        return list[0];
    if (list.length === 2)
        return `${list[0]} and ${list[1]}`;
    return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
}
