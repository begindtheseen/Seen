'use client'

import type { Tone, AttnItem } from './types'

export type HealthStatus = 'Healthy' | 'Attention needed' | 'Critical'

// Hero band: product title, a computed health pill, one plain-English summary
// sentence, and the primary session actions (refresh / CSV / sign out) + build stamp.
export function AdminHero({ status, summary, onRefresh, onDownloadCsv, downloading, onLogout }: {
  status: HealthStatus
  summary: string
  onRefresh: () => void
  onDownloadCsv: () => void
  downloading: boolean
  onLogout: () => void
}) {
  const pillClass = status === 'Critical' ? 'crit' : status === 'Attention needed' ? 'warn' : 'ok'
  const build = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local'
  const msg = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_MESSAGE?.slice(0, 32) ?? 'dev'
  return (
    <header className="a2-hero">
      <div className="a2-hero-main">
        <div className="a2-hero-top">
          <span className="a2-eyebrow">SeenJobs</span>
          <span className={`a2-pill ${pillClass}`}><span className="a2-pill-dot" />{status}</span>
        </div>
        <h1 className="a2-title">Command Center</h1>
        <p className="a2-summary">{summary}</p>
        <div className="a2-build">build {build} · {msg}</div>
      </div>
      <div className="a2-hero-actions">
        <button onClick={onRefresh} className="adm-btn">↻ Refresh</button>
        <button onClick={onDownloadCsv} disabled={downloading} className="adm-btn" style={{ borderColor: 'rgba(16,185,129,.4)', color: 'var(--green)' }}>{downloading ? 'Exporting…' : '⬇ CSV'}</button>
        <button onClick={onLogout} className="adm-btn-danger">Sign out</button>
      </div>
    </header>
  )
}

// Grid wrapper for the 5 core operating cards. Children are <AdminMetricCard>s.
export function AdminCommandCenter({ children }: { children: React.ReactNode }) {
  return <div className="a2-cards">{children}</div>
}

// One big operating card: big number + short label + status phrase + one secondary line.
// The whole card is a primary door (keyboard-activatable). The secondary line may contain
// its own sub-link buttons for a second drill-down (they stopPropagation).
export function AdminMetricCard({ label, value, phrase, tone = 'white', secondary, onClick }: {
  label: string
  value: React.ReactNode
  phrase: string
  tone?: Tone
  secondary?: React.ReactNode
  onClick?: () => void
}) {
  const clickable = !!onClick
  return (
    <div
      className={`a2-card${clickable ? ' a2-card-btn' : ''}`}
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick!() } } : undefined}
    >
      <div className="a2-card-l">{label}{clickable && <span className="a2-card-caret" aria-hidden>›</span>}</div>
      <div className={`a2-card-n ac-tone-${tone}`}>{value}</div>
      <div className="a2-card-p" title={phrase}>{phrase}</div>
      {secondary != null && <div className="a2-card-sec">{secondary}</div>}
    </div>
  )
}

// A small inline door inside a card's secondary line. Stops propagation so it opens
// its own modal without also firing the card's primary onClick.
export function CardSubLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className="a2-sublink" onClick={e => { e.stopPropagation(); onClick() }}>{children}</button>
  )
}

const SEV_META: Record<AttnItem['sev'], { label: string; color: string }> = {
  red: { label: 'Critical', color: 'var(--red)' },
  amber: { label: 'Warning', color: 'var(--amber)' },
  blue: { label: 'Watch', color: 'var(--blue)' },
  green: { label: 'Good', color: 'var(--green)' },
}
const SEV_RANK: Record<AttnItem['sev'], number> = { red: 0, amber: 1, blue: 2, green: 3 }

// The Attention Queue — actionable signals only, Critical → Warning → Watch → Good.
// Empty state when nothing is wrong.
export function AdminAttentionQueue({ items, emgMsg }: {
  items: AttnItem[]
  emgMsg: { ok: boolean; text: string } | null
}) {
  const sorted = items.slice().sort((a, b) => SEV_RANK[a.sev] - SEV_RANK[b.sev])
  return (
    <section className="a2-queue">
      <div className="a2-queue-hdr">
        <span className="a2-queue-ttl">Attention Queue</span>
        {sorted.length > 0 && <span className="a2-queue-count">{sorted.length}</span>}
      </div>
      {emgMsg && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', marginBottom: '.6rem', color: emgMsg.ok ? 'var(--green)' : 'var(--red)' }}>
          {emgMsg.ok ? '✓ ' : '✗ '}{emgMsg.text}
        </div>
      )}
      {sorted.length === 0
        ? <div className="a2-queue-empty">✓ Nothing urgent. SeenJobs is operating normally.</div>
        : sorted.map(item => {
          const meta = SEV_META[item.sev]
          return (
            <div key={item.key} className="a2-attn">
              <span className="a2-attn-sev" style={{ color: meta.color, background: meta.color + '18', borderColor: meta.color + '44' }}>{meta.label}</span>
              <div className="a2-attn-body">
                <div className="a2-attn-t">{item.title}</div>
                <div className="a2-attn-d">{item.detail}</div>
              </div>
              {item.action && <button className="a2-attn-act" onClick={item.action.onClick} disabled={item.action.busy}>{item.action.busy ? '…' : item.action.label}</button>}
            </div>
          )
        })}
    </section>
  )
}
