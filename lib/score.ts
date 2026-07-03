type RiskLevel = 'safe' | 'warn' | 'danger' | 'unrated'

export const Score = {
  calc(responseRate: number, ghostRate: number, waitDays: number, reportCount: number): number {
    return Math.max(0, Math.min(100, Math.round(
      50 + (responseRate * 40) + (ghostRate * -30) + (Math.min(waitDays / 60, 1) * -15) + (Math.log(reportCount + 1) * 5)
    )))
  },
  // A null/undefined/non-finite score is UNRATED — we never invent a number for it. Callers
  // render an explicit "unrated" state rather than a fabricated default. (Owner directive:
  // "if we score something it must be for a reason or no score.")
  risk(score: number | null | undefined): RiskLevel {
    if (score == null || !Number.isFinite(score)) return 'unrated'
    return score >= 70 ? 'safe' : score >= 40 ? 'warn' : 'danger'
  },
  label(risk: RiskLevel): string {
    return { safe: 'SAFE', warn: 'CAUTION', danger: 'DANGER', unrated: 'UNRATED' }[risk] || '—'
  },
  color(risk: RiskLevel): string {
    return risk === 'safe' ? 'var(--green)' : risk === 'warn' ? 'var(--amber)' : risk === 'danger' ? 'var(--red)' : 'var(--dim)'
  },
  waste(ghostRate: number, roundCount: number, unpaidRate: number): number {
    const base = ghostRate * 60 + unpaidRate * 25 + (roundCount > 4 ? 15 : 0)
    return Math.max(0, Math.min(100, Math.round(base)))
  },
  wasteLabel(w: number): { cls: string; txt: string } {
    return w >= 65
      ? { cls: 'waste-high', txt: `${w}% waste risk` }
      : w >= 35
      ? { cls: 'waste-mid', txt: `${w}% waste risk` }
      : { cls: 'waste-low', txt: `${w}% waste risk` }
  },
}
