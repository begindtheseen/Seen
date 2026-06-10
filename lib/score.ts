type RiskLevel = 'safe' | 'warn' | 'danger'

export const Score = {
  calc(responseRate: number, ghostRate: number, waitDays: number, reportCount: number): number {
    return Math.max(0, Math.min(100, Math.round(
      50 + (responseRate * 40) + (ghostRate * -30) + (Math.min(waitDays / 60, 1) * -15) + (Math.log(reportCount + 1) * 5)
    )))
  },
  risk(score: number): RiskLevel {
    return score >= 70 ? 'safe' : score >= 40 ? 'warn' : 'danger'
  },
  label(risk: RiskLevel): string {
    return { safe: 'SAFE', warn: 'CAUTION', danger: 'DANGER' }[risk] || '—'
  },
  color(risk: RiskLevel): string {
    return risk === 'safe' ? 'var(--green)' : risk === 'warn' ? 'var(--amber)' : 'var(--red)'
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
