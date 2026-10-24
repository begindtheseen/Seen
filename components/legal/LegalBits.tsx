// Shared pieces of the three legal documents (/terms, /privacy, /content-policy) and the /legal hub.
//
// The documents are drafts awaiting attorney review. Two rules, kept here so every document renders
// them the same way:
//   • The draft status is ONE calm sentence (DraftNote), not a warning banner — the audit of
//     2026-10-24 found the amber "⚠ Draft — do not rely on it" box on a page a paying customer is
//     sent to from checkout.
//   • Every item the owner / counsel still has to decide renders through <Placeholder> as
//     "[to be completed: …]" — one consistent style, and a grep for `[PLACEHOLDER` stays empty. The
//     decisions themselves (legal entity, governing law, venue, liability caps, effective date,
//     retention periods) are the owner's and are never invented here.

export const LEGAL_CONTACT = 'hello@seenjobs.io'

const noteStyle = {
  fontFamily: 'var(--mono)',
  fontSize: '.62rem',
  color: 'var(--muted)',
  lineHeight: 1.7,
  margin: '0 0 2rem',
} as const

/** The one-sentence draft status shown under the title of each document. */
export function DraftNote() {
  return (
    <p style={noteStyle} role="note">
      This document is a draft awaiting attorney review; items marked &ldquo;to be completed&rdquo; are
      still being finalized, and nothing here is legal advice.
    </p>
  )
}

/** An item counsel or the owner must still decide — rendered "[to be completed: …]" everywhere. */
export function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{ fontFamily: 'var(--mono)', fontSize: '.92em', color: 'var(--amber)', background: 'var(--adim)', borderRadius: 4, padding: '0 .3em' }}
      data-placeholder=""
    >
      [to be completed: {children}]
    </span>
  )
}

/** The short footer every document ends with. */
export function LegalFooter() {
  return (
    <p style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--dim)', marginTop: '2rem', lineHeight: 1.7 }}>
      Seen is not a law firm and nothing here is legal advice. Questions:{' '}
      <a href={`mailto:${LEGAL_CONTACT}`} style={{ color: 'var(--sub)' }}>{LEGAL_CONTACT}</a>.
    </p>
  )
}
