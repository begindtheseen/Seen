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

function savedAgo(iso?: string): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (!t) return ''
  const days = Math.floor((Date.now() - t) / 86_400_000)
  if (days <= 0) return 'Saved today'
  if (days === 1) return 'Saved yesterday'
  if (days < 30) return `Saved ${days}d ago`
  return `Saved ${new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
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

  function open(s: SavedJob) {
    // Prime the session cache from the snapshot so the detail page loads instantly.
    if (s.snapshot) JobCache.set(s.snapshot)
    router.push(`/jobs/${encodeURIComponent(s.job_id)}`)
  }

  async function remove(e: React.MouseEvent, jobId: string) {
    e.stopPropagation()
    await SavedJobsStore.remove(jobId, isLoggedIn)
    setItems(prev => prev.filter(s => String(s.job_id) !== String(jobId)))
  }

  return (
    <div className="page-full">
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '1.5rem 1rem 7rem', width: '100%', boxSizing: 'border-box' }}>
        <div style={{ marginBottom: '1.25rem' }}>
          <h1 style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: '1.5rem', color: 'var(--white)', letterSpacing: '-.02em', margin: 0 }}>Saved jobs</h1>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--dim)', marginTop: '.35rem' }}>
            {loading ? 'Loading…' : items.length ? `${items.length} listing${items.length === 1 ? '' : 's'} saved` : ''}
          </div>
        </div>

        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh' }}><div className="spinner" /></div>
        ) : items.length === 0 ? (
          <div style={{ background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 12, padding: '2rem 1.5rem', textAlign: 'center' }}>
            <div style={{ fontSize: '1.6rem', marginBottom: '.5rem' }}>♡</div>
            <div style={{ fontFamily: 'var(--display)', fontSize: '1rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.4rem' }}>No saved jobs yet</div>
            <div style={{ fontSize: '.8rem', color: 'var(--sub)', fontWeight: 300, marginBottom: '1.25rem', lineHeight: 1.6 }}>Tap ♡ on any listing to save it here. Saved listings always reopen to the exact role you saved.</div>
            <button onClick={() => router.push('/jobs')} style={{ background: 'var(--green)', color: 'var(--ink)', border: 'none', borderRadius: 8, padding: '.6rem 1.25rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.82rem', cursor: 'pointer' }}>Find jobs →</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
            {items.map(s => {
              const color = typeof s.score === 'number' ? Score.color(Score.risk(s.score)) : 'var(--dim)'
              return (
                <div
                  key={s.job_id}
                  onClick={() => open(s)}
                  style={{ display: 'flex', alignItems: 'center', gap: '.85rem', background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 12, padding: '.85rem 1rem', cursor: 'pointer', transition: 'border-color .15s' }}
                  onMouseOver={e => (e.currentTarget.style.borderColor = 'var(--line3, var(--dim))')}
                  onMouseOut={e => (e.currentTarget.style.borderColor = 'var(--line2)')}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--display)', fontSize: '.9rem', fontWeight: 700, color: 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.role || 'Job'}</div>
                    <div style={{ fontSize: '.72rem', color: 'var(--sub)', marginTop: '.1rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {s.company}{s.location ? ` · ${s.location}` : ''}
                    </div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--dim)', marginTop: '.3rem' }}>{savedAgo(s.saved_at)}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.65rem', flexShrink: 0 }}>
                    {typeof s.score === 'number' && (
                      <div style={{ fontFamily: 'var(--mono)', fontSize: '.85rem', fontWeight: 700, color }}>{s.score}</div>
                    )}
                    {s.apply_url && (
                      <a
                        href={s.apply_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        title="Open original posting"
                        style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--sub)', textDecoration: 'none', border: '1px solid var(--line2)', borderRadius: 6, padding: '.3rem .5rem' }}
                      >Apply ↗</a>
                    )}
                    <button
                      onClick={e => remove(e, s.job_id)}
                      title="Remove from saved"
                      style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '.85rem', padding: '.2rem .35rem', lineHeight: 1 }}
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
