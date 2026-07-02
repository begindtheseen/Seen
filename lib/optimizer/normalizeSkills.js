// Deterministic skill normalization — the heart of the keyless matcher.
//
// We never call an external model to decide whether two skills are "the same". We use
// a built-in starter taxonomy (aliases + relationships) that mirrors what migration
// 028 seeds into skill_aliases / skill_relationships. The server can pass a richer
// taxonomy loaded from those tables (extraTaxonomy), but the engine is fully usable
// with the built-in defaults alone — so unit tests run with no DB.
//
// Pure functions. No I/O.
// ── Built-in starter taxonomy ────────────────────────────────────────────────
// Keep this in sync with the seed in supabase/migrations/028_seenfit_engine.sql.
// Keys/values are lowercased canonical forms.
const ALIASES = {
    // customer service family (non-tech, high-volume roles)
    'customer support': 'customer service',
    'guest service': 'customer service',
    'guest services': 'customer service',
    'client service': 'customer service',
    'client services': 'customer service',
    'customer care': 'customer service',
    'customer success': 'customer service',
    'help desk': 'customer service',
    'service desk': 'customer service',
    // intake family
    'intake': 'customer intake',
    'applicant intake': 'customer intake',
    'case intake': 'customer intake',
    'patient intake': 'customer intake',
    'client intake': 'customer intake',
    // logistics / routing
    'delivery route': 'route planning',
    'route completion': 'route planning',
    'route optimization': 'route planning',
    'dispatch': 'route planning',
    // retail / POS
    'pos': 'point of sale',
    'cash register': 'point of sale',
    'register': 'point of sale',
    'cashier': 'point of sale',
    'cash handling': 'point of sale',
    // tech aliases
    'js': 'javascript',
    'node': 'node.js',
    'nodejs': 'node.js',
    'reactjs': 'react',
    'react.js': 'react',
    'postgres': 'postgresql',
    'pg': 'postgresql',
    'k8s': 'kubernetes',
    'gcp': 'google cloud',
    'aws cloud': 'aws',
    'amazon web services': 'aws',
    'ts': 'typescript',
    'py': 'python',
    'c sharp': 'c#',
    'csharp': 'c#',
    'golang': 'go',
    'ml': 'machine learning',
    'ci cd': 'ci/cd',
    'cicd': 'ci/cd',
    'rest api': 'rest',
    'restful': 'rest',
    // office / general
    'ms excel': 'excel',
    'microsoft excel': 'excel',
    'spreadsheets': 'excel',
    'ms word': 'microsoft word',
    'powerpoint': 'microsoft powerpoint',
    'g suite': 'google workspace',
    'gsuite': 'google workspace',
    'crm software': 'crm',
    'salesforce crm': 'salesforce',
    // soft skills / ops
    'team work': 'teamwork',
    'time-management': 'time management',
    'problem-solving': 'problem solving',
    'people management': 'team management',
    'staff management': 'team management',
    'inventory control': 'inventory management',
    'stock management': 'inventory management',
    'scheduling shifts': 'scheduling',
    'shift scheduling': 'scheduling',
    'data analysis': 'data analytics',
    'bookkeeping': 'accounting',
};
const RELATIONSHIPS = {
    'customer service': [
        { to: 'customer intake', weight: 0.6 },
        { to: 'point of sale', weight: 0.4 },
        { to: 'conflict resolution', weight: 0.5 },
        { to: 'communication', weight: 0.5 },
    ],
    'point of sale': [
        { to: 'customer service', weight: 0.4 },
        { to: 'cash handling', weight: 0.7 },
    ],
    'route planning': [
        { to: 'logistics', weight: 0.7 },
        { to: 'time management', weight: 0.5 },
    ],
    'inventory management': [
        { to: 'logistics', weight: 0.6 },
        { to: 'data analytics', weight: 0.3 },
    ],
    'react': [
        { to: 'javascript', weight: 0.8 },
        { to: 'typescript', weight: 0.6 },
        { to: 'frontend', weight: 0.7 },
    ],
    'node.js': [
        { to: 'javascript', weight: 0.8 },
        { to: 'backend', weight: 0.7 },
        { to: 'rest', weight: 0.5 },
    ],
    'typescript': [{ to: 'javascript', weight: 0.9 }],
    'kubernetes': [
        { to: 'docker', weight: 0.7 },
        { to: 'devops', weight: 0.7 },
    ],
    'docker': [{ to: 'devops', weight: 0.6 }],
    'postgresql': [{ to: 'sql', weight: 0.9 }],
    'aws': [{ to: 'cloud', weight: 0.8 }, { to: 'devops', weight: 0.4 }],
    'google cloud': [{ to: 'cloud', weight: 0.8 }],
    'machine learning': [{ to: 'python', weight: 0.6 }, { to: 'data analytics', weight: 0.6 }],
    'data analytics': [{ to: 'excel', weight: 0.4 }, { to: 'sql', weight: 0.5 }],
    'team management': [{ to: 'leadership', weight: 0.7 }, { to: 'scheduling', weight: 0.4 }],
    'leadership': [{ to: 'team management', weight: 0.7 }],
    'communication': [{ to: 'customer service', weight: 0.4 }],
    'salesforce': [{ to: 'crm', weight: 0.9 }],
};
export const BUILTIN_TAXONOMY = {
    aliases: ALIASES,
    relationships: RELATIONSHIPS,
};
// Lowercase, collapse whitespace, strip surrounding punctuation. Deterministic.
export function canonicalText(s) {
    return String(s || '')
        .toLowerCase()
        .replace(/[‘’]/g, "'")
        .replace(/[^a-z0-9+#./ -]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
// Merge an optional DB-loaded taxonomy on top of the built-in one (DB wins).
export function mergeTaxonomy(extra) {
    if (!extra)
        return BUILTIN_TAXONOMY;
    return {
        aliases: { ...BUILTIN_TAXONOMY.aliases, ...(extra.aliases || {}) },
        relationships: { ...BUILTIN_TAXONOMY.relationships, ...(extra.relationships || {}) },
    };
}
// Normalize a raw skill string to its canonical taxonomy label.
export function normalizeSkill(raw, taxonomy = BUILTIN_TAXONOMY) {
    const c = canonicalText(raw);
    if (!c)
        return '';
    // direct alias hit
    if (taxonomy.aliases[c])
        return taxonomy.aliases[c];
    // trailing plurals / common suffixes
    const singular = c.replace(/(skills?|abilities|experience)$/i, '').trim();
    if (singular && taxonomy.aliases[singular])
        return taxonomy.aliases[singular];
    return singular || c;
}
// Decide how a résumé skill relates to a job requirement, returning a 0–1 strength.
// exact = same canonical skill (or alias of it). related = connected in the taxonomy
// graph (1 hop) with the edge weight. none = unrelated.
export function relateSkills(resumeSkill, jobSkill, taxonomy = BUILTIN_TAXONOMY) {
    const a = normalizeSkill(resumeSkill, taxonomy);
    const b = normalizeSkill(jobSkill, taxonomy);
    if (!a || !b)
        return { kind: 'none', strength: 0 };
    if (a === b)
        return { kind: 'exact', strength: 1 };
    // substring containment (e.g. "customer service rep" vs "customer service")
    if (a.includes(b) || b.includes(a))
        return { kind: 'exact', strength: 0.92 };
    // 1-hop relationship in either direction
    const fwd = (taxonomy.relationships[a] || []).find((r) => r.to === b);
    if (fwd)
        return { kind: 'related', strength: fwd.weight };
    const bwd = (taxonomy.relationships[b] || []).find((r) => r.to === a);
    if (bwd)
        return { kind: 'related', strength: bwd.weight };
    return { kind: 'none', strength: 0 };
}
// Best match for a job skill against a set of résumé skills.
export function bestMatch(jobSkill, resumeSkills, taxonomy = BUILTIN_TAXONOMY) {
    let best = {
        kind: 'none',
        strength: 0,
        via: null,
    };
    for (const rs of resumeSkills) {
        const r = relateSkills(rs, jobSkill, taxonomy);
        if (r.strength > best.strength)
            best = { kind: r.kind, strength: r.strength, via: rs };
    }
    return best;
}
