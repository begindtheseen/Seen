'use client'

import { useEffect, useState } from 'react'

// Renders the derived employer feed. The server component owns the fetch + derivation
// (lib/server/employerNotifications.js); this component owns presentation and two client-only
// enhancements that would cause hydration mismatches if done on the server:
//   • relative "when" (3d ago) — depends on the client clock, so it's applied after mount.
//   • "new since your last visit" — reads/writes localStorage (per company), so it's post-mount too.
// Neither is required for the feed to be correct: without JS the server still renders every item
// with an absolute date. These just make a live feed feel live.

export type FeedItem = {
  id: string
  kind: 'new_applicants' | 'posting_expired' | 'posting_stale' | 'posting_nearing_stale' | 'posting_expiring'
  severity: 'critical' | 'warning' | 'info'
  title: string
  detail: string
  at: string | null
  role?: string | null
  city?: string | null
  count?: number
  daysUntilExpiry?: number
  ageDays?: number | null
  // What the employer can DO about it: 'repost' (their own listing is expiring) or
  // 'post_yourself' (an aggregated listing is decaying — post a first-party copy).
  action?: 'repost' | 'post_yourself' | null
  jobId?: string | null
}

type Summary = {
  total: number
  newApplicants: number
  postingsExpired: number
  postingsStale: number
  postingsNearingStale: number
  newSinceVisit: number | null
}

type Thresholds = { STALE_AFTER_DAYS: number; EXPIRE_AFTER_DAYS: number; NEARING_WINDOW_DAYS: number; APPLICANT_WINDOW_DAYS: number }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Deterministic (UTC) absolute date — identical on server and client, so it hydrates cleanly.
function absDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

// Client-clock relative time — only rendered after mount.
function relTime(iso: string | null, nowMs: number): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const diff = nowMs - t
  if (diff < 0) return 'just now'
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 30) return `${days}d ago`
  const mo = Math.round(days / 30)
  return `${mo}mo ago`
}

const KIND_META: Record<FeedItem['kind'], { icon: string; color: string; ring: string; label: string }> = {
  posting_expired: { icon: '🛑', color: 'var(--red)', ring: 'rgba(239,68,68,.28)', label: 'Dropped off' },
  posting_stale: { icon: '⏳', color: 'var(--amber)', ring: 'rgba(245,158,11,.28)', label: 'Dropping off soon' },
  posting_nearing_stale: { icon: '⏳', color: 'var(--amber)', ring: 'rgba(245,158,11,.22)', label: 'Aging off' },
  posting_expiring: { icon: '📅', color: 'var(--amber)', ring: 'rgba(245,158,11,.25)', label: 'Expiring — repost' },
  new_applicants: { icon: '👥', color: 'var(--blue)', ring: 'rgba(59,130,246,.26)', label: 'New applicants' },
}

const STORAGE_PREFIX = 'seen:employer-notifs:lastvisit:'

export function NotificationsFeed({
  company,
  items,
  summary,
  thresholds,
}: {
  company: string
  items: FeedItem[]
  summary: Summary
  thresholds: Thresholds
}) {
  const [mounted, setMounted] = useState(false)
  const [nowMs, setNowMs] = useState(0)
  const [lastVisit, setLastVisit] = useState<number | null>(null)

  useEffect(() => {
    setMounted(true)
    setNowMs(Date.now())
    // Read this company's last-visit marker, then stamp the current visit.
    try {
      const key = STORAGE_PREFIX + company.toLowerCase()
      const prev = window.localStorage.getItem(key)
      setLastVisit(prev ? parseInt(prev, 10) : null)
      window.localStorage.setItem(key, String(Date.now()))
    } catch {
      // localStorage blocked (private mode / SSR) — the feed still works, just without the NEW marker.
    }
  }, [company])

  const isNew = (it: FeedItem) => mounted && lastVisit != null && it.at != null && Date.parse(it.at) > lastVisit
  const newCount = mounted && lastVisit != null ? items.filter(isNew).length : 0

  return (
    <div>
      {/* Summary strip */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', marginBottom: '1.4rem', alignItems: 'center' }}>
        <SummaryPill n={summary.postingsExpired} label="dropped off" color="var(--red)" />
        <SummaryPill n={summary.postingsStale} label="dropping off soon" color="var(--amber)" />
        <SummaryPill n={summary.postingsNearingStale} label="aging off" color="var(--amber)" />
        <SummaryPill n={summary.newApplicants} label={`new applicant${summary.newApplicants === 1 ? '' : 's'}`} color="var(--blue)" />
        {mounted && lastVisit != null && newCount > 0 && (
          <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--green)', border: '1px solid rgba(16,185,129,.3)', borderRadius: 999, padding: '.28rem .7rem' }}>
            {newCount} new since your last visit
          </span>
        )}
      </div>

      {/* Feed */}
      <div style={{ display: 'grid', gap: '.7rem' }}>
        {items.map((it) => {
          const meta = KIND_META[it.kind]
          const fresh = isNew(it)
          const rel = mounted ? relTime(it.at, nowMs) : ''
          return (
            <div
              key={it.id}
              style={{
                display: 'flex',
                gap: '.9rem',
                alignItems: 'flex-start',
                background: 'var(--card)',
                border: `1px solid ${fresh ? meta.ring : 'var(--line)'}`,
                borderLeft: `3px solid ${meta.color}`,
                borderRadius: 12,
                padding: '1rem 1.15rem',
              }}
            >
              <span style={{ fontSize: '1.15rem', lineHeight: 1.2, flexShrink: 0 }} aria-hidden>{meta.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '.6rem', flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'var(--display)', fontSize: '.88rem', fontWeight: 700, color: 'var(--white)' }}>{it.title}</span>
                  {fresh && (
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--green)', border: '1px solid rgba(16,185,129,.35)', borderRadius: 4, padding: '.1rem .35rem' }}>New</span>
                  )}
                </div>
                <p style={{ color: 'var(--sub)', fontSize: '.78rem', lineHeight: 1.6, margin: '.3rem 0 0' }}>{it.detail}</p>
                {/* Actionable, not just informational: reposting/first-party posting is the one
                    thing an employer can actually DO about listing decay. Deep-links to the
                    dashboard's add-a-listing form prefilled from this listing. */}
                {it.action && it.jobId && (
                  <a
                    href={`/employers/dashboard?prefill=${encodeURIComponent(it.jobId)}`}
                    style={{ display: 'inline-block', marginTop: '.55rem', fontFamily: 'var(--mono)', fontSize: '.6rem', fontWeight: 700, color: 'var(--white)', border: '1px solid var(--line2)', borderRadius: 6, padding: '.3rem .7rem', textDecoration: 'none' }}
                  >
                    {it.action === 'repost' ? '↻ Repost this listing →' : '＋ Post this role yourself →'}
                  </a>
                )}
                <div style={{ display: 'flex', gap: '.7rem', marginTop: '.5rem', flexWrap: 'wrap' }}>
                  <span
                    style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', textTransform: 'uppercase', letterSpacing: '.08em', color: meta.color }}
                  >
                    {meta.label}
                  </span>
                  {it.at && (
                    <span title={absDate(it.at)} style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--dim)' }}>
                      {rel ? rel : absDate(it.at)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Honest footnote on the mechanism + the delivery follow-up */}
      <p style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--muted)', lineHeight: 1.7, marginTop: '1.6rem' }}>
        Computed live from your listings on Seen. Postings go stale after {thresholds.STALE_AFTER_DAYS} days without being seen on their source and expire after {thresholds.EXPIRE_AFTER_DAYS}; applicant counts cover the last {thresholds.APPLICANT_WINDOW_DAYS} days. Email and push delivery of these updates are coming next.
      </p>
    </div>
  )
}

function SummaryPill({ n, label, color }: { n: number; label: string; color: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: '.35rem', fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--sub)', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 999, padding: '.3rem .75rem' }}>
      <b style={{ color, fontFamily: 'var(--display)', fontSize: '.8rem' }}>{n}</b> {label}
    </span>
  )
}
