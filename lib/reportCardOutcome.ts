// What ONE report card on a company page says happened — its outcome chip and, only for a ghosted
// report, the stage where contact stopped. Both come from here so a card can't carry two stories.
//
// Conversion audit 2026-10-24: Amazon's only report submitted to Seen read "Package Handler · ghosted at
// application" next to "✅ Got response" — the role line printed `ghost_stage` for any outcome, while the
// chip printed `outcome`. A stage is part of a ghosted outcome; on any other outcome it is not shown.
//
// Pure; no imports so `node --test lib/reportCardOutcome.test.mjs` runs it as is.

export type CardOutcome = {
  /** The chip text ("👻 Ghosted", "✅ Got response", "💬 Commentary" …). */
  label: string
  /** The chip's colour class (globals.css .vibe v-*). */
  cls: string
  /** "application" etc. — set only when the chip says Ghosted. */
  ghostStage: string
}

const LABEL: Record<string, string> = {
  ghosted: '👻 Ghosted', autoreject: '🤖 Auto-rejected',
  human: '✅ Got response', hired: '🎉 Hired',
  offer: '🎁 Offer', interview: '📞 Interview',
  rejected: '❌ Rejected', waiting: '⏳ Waiting',
}
const CLS: Record<string, string> = {
  ghosted: 'v-r', autoreject: 'v-y', rejected: 'v-y',
  human: 'v-g', hired: 'v-g', offer: 'v-g', interview: 'v-b', waiting: 'v-n',
}

export function reportCardOutcome(
  r: { outcome?: string | null; ghost_stage?: string | null },
  kind: { employee?: boolean; commentary?: boolean } = {},
): CardOutcome {
  if (kind.employee) return { label: '💼 Employee review', cls: 'v-n', ghostStage: '' }
  if (kind.commentary) return { label: '💬 Commentary', cls: 'v-n', ghostStage: '' }
  const oc = String(r.outcome ?? '').toLowerCase().trim()
  const stage = oc === 'ghosted' ? String(r.ghost_stage ?? '').replace(/_/g, ' ').trim() : ''
  return { label: LABEL[oc] || String(r.outcome ?? ''), cls: CLS[oc] || 'v-n', ghostStage: stage }
}
