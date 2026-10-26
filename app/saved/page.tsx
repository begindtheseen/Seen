'use client'

// Saved jobs — parity port of the old SPA dashboard "Saved jobs" list
// (origin/main:index.html `_refreshDashSaved`), expanded into a full page.
// Reliability fix: each row carries the listing snapshot captured at save time,
// so opening it always resolves to the exact saved listing via /jobs/[id].

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { SavedJobsStore } from '@/lib/stores/SavedJobs'
import { JobCache } from '@/lib/stores/JobCache'
import { Score } from '@/lib/score'
import type { SavedJob } from '@/lib/types'
import PageHeader from '@/components/shell/PageHeader'
import Link from 'next/link'
import { pathSegment, httpHref } from '@/lib/safeHref.js'
import { displayCompanyName } from '@/lib/companyDisplay'

function savedAgo(iso?: string): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (!t) return ''
  const days = Math.floor((Date.now() - t) / 86_400_000)
  if (days <= 0) return 'Saved today'
  if (days === 1) return 'Saved yesterday'
  if (days < 30) return `Saved ${days}d ago`
  return `Saved ${new Date(t).toLocaleDateString(undefined, { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric' })}`
}

export default function SavedPage() {
  const router = useRouter()
  const { isLoggedIn } = useAuth()
  const [items, setItems] = useState<SavedJob[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try { setItems(await SavedJobsStore.load(isLoggedIn)) }
    catch { setItems(SavedJobsStore.loadSync()) }
    finally { setLoading(false) }
  }, [isLoggedIn])

  useEffect(() => { refresh() }, [refresh])

  // Prime the session cache from the snapshot so the detail page loads instantly.
  function prime(s: SavedJob) {
    if (s.snapshot) JobCache.set(s.snapshot)
  }

  async function remove(e: React.MouseEvent, jobId: string) {
    e.stopPropagation()
    await SavedJobsStore.remove(jobId, isLoggedIn)
    setItems(prev => prev.filter(s => String(s.job_id) !== String(jobId)))
  }

  return (
    <div className="page-full">
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '1.5rem 1rem 7rem', width: '100%', boxSizing: 'border-box' }}>
        <PageHeader
          eyebrow="Bookmarks"
          title="Saved jobs"
          sub={loading ? 'Loading…' : items.length ? `${items.length} listing${items.length === 1 ? '' : 's'} saved — each reopens to the exact role you saved.` : 'Tap ♡ on any listing to keep it here.'}
        />

        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh' }}><div className="spinner" /></div>
        ) : items.length === 0 ? (
          <div style={{ background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 12, padding: '2rem 1.5rem', textAlign: 'center' }}>
            <div style={{ fontSize: 'var(--fs-xl)', marginBottom: '.5rem' }}>♡</div>
            <div style={{ fontFamily: 'var(--display)', fontSize: 'var(--fs-lead)', fontWeight: 700, color: 'var(--white)', marginBottom: '.4rem' }}>No saved jobs yet</div>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--sub)', fontWeight: 400, marginBottom: '1.25rem', lineHeight: 1.6 }}>Tap ♡ on any listing to save it here. Saved listings always reopen to the exact role you saved.</div>
            <button onClick={() => router.push('/jobs')} style={{ background: 'var(--green)', color: 'var(--ink)', border: 'none', borderRadius: 8, padding: '.6rem 1.25rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: 'var(--fs-sm)', cursor: 'pointer' }}>Find jobs →</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
            {items.map(s => {
              const color = typeof s.score === 'number' ? Score.color(Score.risk(s.score)) : 'var(--dim)'
              // The card IS a link to the role inside Seen (it was plain text with only the external
              // "Apply ↗" as a link — audit 2026-10-24, M10). The id comes from device storage, so it
              // goes in the path through pathSegment; the posting link only as a parsed http(s) URL.
              const href = `/jobs/${pathSegment(s.job_id)}`
              const applyHref = httpHref(s.apply_url)
              const company = displayCompanyName(s.company) || s.company
              return (
                <div
                  key={s.job_id}
                  style={{ display: 'flex', alignItems: 'center', gap: '.85rem', background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 12, padding: '.35rem .5rem .35rem 1rem', transition: 'border-color .15s' }}
                  onMouseOver={e => (e.currentTarget.style.borderColor = 'var(--line3, var(--dim))')}
                  onMouseOut={e => (e.currentTarget.style.borderColor = 'var(--line2)')}
                >
                  <Link href={href} prefetch={false} onClick={() => prime(s)} data-testid="saved-open" style={{ flex: 1, minWidth: 0, minHeight: 44, padding: '.5rem 0', textDecoration: 'none', color: 'inherit', display: 'block' }}>
                    <div style={{ fontFamily: 'var(--display)', fontSize: 'var(--fs-ui)', fontWeight: 700, color: 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.role || 'Job'}</div>
                    <div style={{ fontSize: 'var(--fs-meta)', color: 'var(--sub)', marginTop: '.1rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {company}{s.location ? ` · ${s.location}` : ''}
                    </div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--dim)', marginTop: '.3rem' }}>{savedAgo(s.saved_at)} · <span style={{ color: 'var(--green)' }}>Open in Seen →</span></div>
                  </Link>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', flexShrink: 0 }}>
                    {typeof s.score === 'number' && (
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-ui)', fontWeight: 500, color }}>{s.score}</div>
                    )}
                    {applyHref && (
                      <a
                        href={applyHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open the original posting"
                        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: 44, minWidth: 44, fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--sub)', textDecoration: 'none', border: '1px solid var(--line2)', borderRadius: 6, padding: '0 .55rem' }}
                      >Apply ↗</a>
                    )}
                    <button
                      onClick={e => remove(e, s.job_id)}
                      title="Remove from saved"
                      aria-label={`Remove ${s.role || 'this job'} from saved`}
                      style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 'var(--fs-ui)', minHeight: 44, minWidth: 44, lineHeight: 1 }}
                    >✕</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
