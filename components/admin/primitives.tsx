// Presentational primitives + shared helpers for the admin command center
// (extracted verbatim from app/admin/page.tsx — behavior-identical).
import type { Tone, AttnItem } from './types'

export function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="adm-panel" style={{ padding: '0 1rem 1rem', ...style }}>
      {children}
    </div>
  )
}

export function CardHeader({ title, badge, action }: { title: string; badge?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="adm-panel-hdr" style={{ margin: '0 -1rem .85rem' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: '.5rem', overflow: 'hidden', flexShrink: 1, minWidth: 0 }}>
        {title}
        {badge}
      </span>
      {action && <div style={{ flexShrink: 0, display: 'flex', gap: '.35rem', flexWrap: 'wrap' }}>{action}</div>}
    </div>
  )
}

export function Badge({ n, color = 'var(--red)' }: { n: number; color?: string }) {
  if (!n) return null
  return (
    <span style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', background: color + '22', color, border: `1px solid ${color}44`, borderRadius: 100, padding: '.1rem .4rem', flexShrink: 0 }}>{n}</span>
  )
}

export function BarChart({ items, max, green }: { items: { label: string; value: number }[]; max: number; green?: boolean }) {
  return (
    <div>
      {items.map(item => (
        <div key={item.label} className="adm-row">
          <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--sub)', width: '40%', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
          <div className="adm-bar-wrap">
            <div className={green ? 'adm-bar green' : 'adm-bar'} style={{ width: `${max > 0 ? (item.value / max) * 100 : 0}%` }} />
          </div>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)', width: 28, textAlign: 'right', flexShrink: 0 }}>{item.value}</span>
        </div>
      ))}
    </div>
  )
}

export function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function outcomeColor(o: string) {
  if (o === 'ghosted') return 'var(--red)'
  if (o === 'rejected' || o === 'autoreject') return 'var(--amber)'
  if (o === 'interview' || o === 'human') return 'var(--blue)'
  if (o === 'offer' || o === 'hired') return 'var(--green)'
  return 'var(--dim)'
}

export function stageColor(s: string) {
  if (s === 'Applied' || s === 'Screening') return 'var(--blue)'
  if (s === 'Interview') return 'var(--amber)'
  if (s === 'Offer' || s === 'Hired') return 'var(--green)'
  if (s === 'Rejected') return 'var(--red)'
  return 'var(--dim)'
}

export function availColor(a: string) {
  if (a === 'active') return 'var(--green)'
  if (a === 'stale') return 'var(--amber)'
  if (a === 'expired') return 'var(--red)'
  if (a === 'removed') return 'var(--dim)'
  return 'var(--sub)'
}

// ── Command-center presentational primitives (.ac-*) ──────────────────────────
export function Panel({ title, right, hero, children, style }: { title: string; right?: React.ReactNode; hero?: boolean; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <section className={`ac-panel${hero ? ' hero' : ''}`} style={style}>
      <div className="ac-panel-hdr">
        <span className="ac-panel-title">{title}</span>
        {right}
      </div>
      {children}
    </section>
  )
}

// A compact command-center tile: big number + a status PHRASE (never a bare number).
// When onClick is passed the whole tile becomes a button (pointer, hover, a "›" caret,
// aria-label) that opens the matching drill-down / management door.
export function PulseTile({ label, value, phrase, tone = 'white', onClick }: { label: string; value: React.ReactNode; phrase: string; tone?: Tone; onClick?: () => void }) {
  const inner = (
    <>
      <div className="ac-tile-l">{label}{onClick && <span className="ac-tile-caret" aria-hidden>›</span>}</div>
      <div className={`ac-tile-n ac-tone-${tone}`}>{value}</div>
      <div className="ac-tile-p" title={phrase}>{phrase}</div>
    </>
  )
  if (onClick) {
    const vtxt = (typeof value === 'string' || typeof value === 'number') ? String(value) : ''
    return (
      <button type="button" className="ac-tile ac-tile-btn" onClick={onClick} aria-label={`${label} ${vtxt} — ${phrase}. Open details.`}>
        {inner}
      </button>
    )
  }
  return <div className="ac-tile">{inner}</div>
}

// label · optional status text · value, optionally clickable (opens a KPI drill-down).
export function MetricRow({ label, value, status, tone = 'white', onClick }: { label: string; value: React.ReactNode; status?: string; tone?: Tone; onClick?: () => void }) {
  return (
    <div className={`ac-mrow${onClick ? ' ac-mrow-click' : ''}`} onClick={onClick} role={onClick ? 'button' : undefined}>
      <span className="ac-mrow-l">{label}</span>
      <span className="ac-mrow-mid">{status}</span>
      <span className={`ac-mrow-n ac-tone-${tone}`}>{value}</span>
      {onClick && <span className="ac-mrow-arrow">▸</span>}
    </div>
  )
}

export const SEV_COLOR: Record<string, string> = { red: 'var(--red)', amber: 'var(--amber)', blue: 'var(--blue)', green: 'var(--green)' }

// One actionable warning row for the Needs Attention panel.
export function AttnRow({ item }: { item: AttnItem }) {
  return (
    <div className="ac-attn">
      <span className="ac-attn-dot" style={{ background: SEV_COLOR[item.sev] }} />
      <div className="ac-attn-body">
        <div className="ac-attn-t">{item.title}</div>
        <div className="ac-attn-d">{item.detail}</div>
      </div>
      {item.action && <button className="ac-attn-act" onClick={item.action.onClick} disabled={item.action.busy}>{item.action.busy ? '…' : item.action.label}</button>}
    </div>
  )
}

// Shared shell for the read-only Pulse drill-down modals (Revenue, Trials, Cards, API).
// Reuses the .ac-modal chrome (own scroll, safe-area-aware body) — same look as Manage
// Accounts but without the search/filter bar.
export function DetailModal({ title, sub, onClose, children }: { title: string; sub?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="ac-modal" onClick={onClose}>
      <div className="ac-modal-card" onClick={e => e.stopPropagation()}>
        <div className="ac-modal-hdr">
          <div>
            <div className="ac-modal-ttl">{title}</div>
            {sub && <div className="ac-modal-sub">{sub}</div>}
          </div>
          <button className="ac-modal-x" onClick={onClose}>✕</button>
        </div>
        <div className="ac-modal-body">{children}</div>
      </div>
    </div>
  )
}

// A read-only label · status · value row (mirrors MetricRow, no click).
export function DetailStat({ label, value, status, tone = 'white' }: { label: string; value: React.ReactNode; status?: string; tone?: Tone }) {
  return (
    <div className="ac-mrow">
      <span className="ac-mrow-l">{label}</span>
      <span className="ac-mrow-mid">{status}</span>
      <span className={`ac-mrow-n ac-tone-${tone}`}>{value}</span>
    </div>
  )
}

// Shared job-board remediation: (1) backfill fresh ACTIVE listings via refresh-jobs?all=1
// (it validates this admin session token itself), then (2) clear the unconfirmed-stale rows
// the sources couldn't re-confirm so the admin "Stale/expired" count actually drops. Both
// halves are needed for the button's outcome to observably match the number beside it.
export async function runRefreshAndClear(token: string): Promise<{ ok: boolean; added: number | null; cleared: number | null; error?: string }> {
  try {
    const res = await fetch('/api/refresh-jobs?all=1', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token }, body: '{}' })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, added: null, cleared: null, error: d.error || `HTTP ${res.status}` }
    const added = d.upserted ?? d.inserted ?? d.found ?? null
    let cleared: number | null = null
    try {
      const pres = await fetch('/api/admin-stats', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token }, body: JSON.stringify({ action: 'purge_stale_jobs' }) })
      const pd = await pres.json().catch(() => ({}))
      if (pres.ok && pd.ok) cleared = pd.removed ?? 0
    } catch { /* purge is best-effort; the backfill already succeeded */ }
    return { ok: true, added, cleared }
  } catch (e) {
    return { ok: false, added: null, cleared: null, error: (e as Error).message }
  }
}

export function refreshResultMsg(r: { added: number | null; cleared: number | null }): string {
  const parts: string[] = []
  if (r.added != null) parts.push(`+${r.added} fresh`)
  if (r.cleared != null) parts.push(`cleared ${r.cleared} stale`)
  return parts.length ? parts.join(' · ') : 'refresh triggered'
}
