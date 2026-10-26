// What ONE report card on a company page says happened — its outcome chip and, only for a ghosted
// report, the stage where contact stopped. Both come from here so a card can't carry two stories.
//
// Conversion audit 2026-10-24: Amazon's only report submitted to Seen read "Package Handler · ghosted at
// application" next to "✅ Got response" — the role line printed `ghost_stage` for any outcome, while the
// chip printed `outcome`. A stage is part of a ghosted outcome; on any other outcome it is not shown.
//
// Site-quality pass 2026-10-26: the chip is a Badge (components/ui/Badge) — a plain word, a tone from
// what the outcome says about how the company treats applicants (ghosted = bad, a reply / interview /
// offer = good, an automatic or human rejection = caution), and an icon from the shared set. No emoji.
//
// Pure; no imports so `node --test lib/reportCardOutcome.test.mjs` runs it as is.

export type OutcomeTone = 'good' | 'caution' | 'bad' | 'neutral'

export type CardOutcome = {
  /** The chip text ("Ghosted", "Got a response", "Commentary" …). */
  label: string
  tone: OutcomeTone
  /** Icon name in components/ui/icons.ts. */
  icon: string
  /** "application" etc. — set only when the chip says Ghosted. */
  ghostStage: string
}

const OUTCOMES: Record<string, { label: string; tone: OutcomeTone; icon: string }> = {
  ghosted: { label: 'Ghosted', tone: 'bad', icon: 'ghost' },
  autoreject: { label: 'Auto-rejected', tone: 'caution', icon: 'bot' },
  rejected: { label: 'Rejected', tone: 'caution', icon: 'circle-x' },
  human: { label: 'Got a response', tone: 'good', icon: 'message-square' },
  interview: { label: 'Interview', tone: 'good', icon: 'phone' },
  offer: { label: 'Offer', tone: 'good', icon: 'award' },
  hired: { label: 'Hired', tone: 'good', icon: 'trophy' },
  waiting: { label: 'Waiting', tone: 'neutral', icon: 'hourglass' },
}

export function reportCardOutcome(
  r: { outcome?: string | null; ghost_stage?: string | null },
  kind: { employee?: boolean; commentary?: boolean } = {},
): CardOutcome {
  if (kind.employee) return { label: 'Employee review', tone: 'neutral', icon: 'briefcase', ghostStage: '' }
  if (kind.commentary) return { label: 'Commentary', tone: 'neutral', icon: 'message-square', ghostStage: '' }
  const oc = String(r.outcome ?? '').toLowerCase().trim()
  const stage = oc === 'ghosted' ? String(r.ghost_stage ?? '').replace(/_/g, ' ').trim() : ''
  const o = OUTCOMES[oc]
  return o ? { ...o, ghostStage: stage } : { label: String(r.outcome ?? ''), tone: 'neutral', icon: 'circle', ghostStage: stage }
}
