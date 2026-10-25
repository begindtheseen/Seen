// Shared facts for the three legal documents (/terms, /privacy, /content-policy) and the /legal hub.
//
// Every document reads the operator, effective date, governing state and contact from HERE, so they
// can never disagree. If the business is later incorporated (an LLC, for example), change
// LEGAL_OPERATOR and LEGAL_OPERATOR_SHORT once and bump LEGAL_EFFECTIVE; nothing else needs editing.
// The documents were reviewed line by line against the code on 2026-10-24 (each claim cites the file
// that implements it in a comment beside it) — keep them true when the product changes.

export const LEGAL_CONTACT = 'hello@seenjobs.io'
/** Who the agreement is with. A sole-proprietor business today (owner, 2026-10-24). */
export const LEGAL_OPERATOR = 'Seen, an independent business based in California and operated by its founder'
export const LEGAL_OPERATOR_SHORT = 'Seen'
export const LEGAL_STATE = 'California'
/** California date the current versions took effect. */
export const LEGAL_EFFECTIVE = 'October 24, 2026'

const meta = { color: 'var(--sub)', fontSize: '.82rem', margin: '0 0 2rem', lineHeight: 1.7 } as const

/** The line under each document's title: effective date + how to reach us. */
export function LegalMeta({ label = 'Questions?' }: { label?: string }) {
  return (
    <p style={meta}>
      Effective {LEGAL_EFFECTIVE} · {label}{' '}
      <a href={`mailto:${LEGAL_CONTACT}`} style={{ color: 'var(--blue)', textDecoration: 'none' }}>{LEGAL_CONTACT}</a>
    </p>
  )
}

/** The short footer every document ends with. */
export function LegalFooter() {
  return (
    <p style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--dim)', marginTop: '2rem', lineHeight: 1.7 }}>
      Effective {LEGAL_EFFECTIVE}. Questions about this document:{' '}
      <a href={`mailto:${LEGAL_CONTACT}`} style={{ color: 'var(--sub)' }}>{LEGAL_CONTACT}</a>.
    </p>
  )
}
