'use client'

import { useState, useEffect } from 'react'
import { Card, CardHeader } from './primitives'
import { STAFFING_AGENCIES } from '@/lib/agencies'
import { assembleGhostReport, pickHeadline, buildCaption } from '@/lib/server/ghostReport'

// The weekly "grab and post" tool (playbook/CONTENT_ENGINE.md § Weekly Ghost Report). Reads the
// public leaderboard, assembles the SAME honest report the /ghost-report page renders, and hands
// the owner a ready-to-paste caption + the share links. The panel never invents a number — it only
// reflects what assembleGhostReport computes from real applicant reports.

const SITE = 'https://seenjobs.io'
const AGENCY_NAMES = STAFFING_AGENCIES.flatMap((a) => a.aliases).map((a) => a.toLowerCase())

type LbRow = { name: string; industry?: string; verified?: boolean; score: { overall_score: number; ghost_rate: number; response_rate: number; avg_wait_days: number; report_count: number; risk_level: 'safe' | 'warn' | 'danger'; waste: number } }

export function GhostReportPanel() {
  const [rows, setRows] = useState<LbRow[] | null>(null)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await fetch('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'leaderboard' }) })
        const j = await r.json()
        if (!alive) return
        setRows(Array.isArray(j.companies) ? j.companies : [])
      } catch {
        if (alive) setErr('Could not load leaderboard data')
      }
    })()
    return () => { alive = false }
  }, [])

  const report = rows ? assembleGhostReport(rows, { agencyNames: AGENCY_NAMES, topN: 5 }) : null
  const caption = report ? buildCaption(report, SITE) : ''

  async function copy() {
    try {
      await navigator.clipboard.writeText(caption)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      setErr('Clipboard blocked — select the text below and copy manually')
    }
  }

  return (
    <Card style={{ marginBottom: '1.25rem', border: '1px solid rgba(239,68,68,.22)' }}>
      <CardHeader
        title="Weekly Ghost Report"
        action={
          <div style={{ display: 'flex', gap: '.4rem' }}>
            <a href="/ghost-report" target="_blank" rel="noopener noreferrer" style={linkBtn}>View page ↗</a>
            <a href="/ghost-report/opengraph-image" target="_blank" rel="noopener noreferrer" style={linkBtn}>Share image ↗</a>
          </div>
        }
      />

      {err && <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--red)', marginBottom: '.6rem' }}>{err}</div>}

      {!rows && !err && <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)' }}>Loading this week&apos;s numbers…</div>}

      {report && (
        <>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--sub)', lineHeight: 1.6, marginBottom: '.8rem' }}>
            {report.hasReported ? (
              <>
                <span style={{ color: 'var(--white)' }}>{report.headline.reportsTotal.toLocaleString()}</span> reports · {report.headline.companiesTracked} companies
                {report.headline.avgGhostRatePct != null && <> · <span style={{ color: 'var(--red)' }}>{report.headline.avgGhostRatePct}% avg ghost</span></>}
                {report.headline.thin && <span style={{ color: 'var(--amber)' }}> · thin data — honest-small framing in use</span>}
              </>
            ) : (
              <span style={{ color: 'var(--amber)' }}>No substantial reported data yet — caption uses the honest &ldquo;index is filling&rdquo; framing.</span>
            )}
          </div>

          <div style={{ fontFamily: 'var(--display)', fontSize: '.82rem', fontWeight: 700, color: 'var(--white)', lineHeight: 1.4, marginBottom: '.7rem' }}>
            {pickHeadline(report)}
          </div>

          {report.worstOffenders.length > 0 && (
            <div style={{ marginBottom: '.8rem' }}>
              {report.worstOffenders.slice(0, 3).map((r, i) => (
                <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)', marginBottom: '.2rem' }}>
                  <span style={{ width: 12 }}>{i + 1}</span>
                  <span style={{ color: 'var(--white)', textTransform: 'capitalize', flex: 1 }}>{r.name}</span>
                  <span style={{ color: 'var(--red)' }}>{r.ghostPct}% ghost</span>
                  <span style={{ color: 'var(--dim)' }}>({r.reportCount})</span>
                </div>
              ))}
            </div>
          )}

          <textarea
            readOnly
            value={caption}
            onFocus={(e) => e.currentTarget.select()}
            style={{ width: '100%', minHeight: 140, background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 7, padding: '.6rem .7rem', fontFamily: 'var(--mono)', fontSize: '.56rem', color: 'var(--sub)', lineHeight: 1.6, resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', marginTop: '.6rem', flexWrap: 'wrap' }}>
            <button onClick={copy} style={{ background: 'rgba(239,68,68,.14)', border: '1px solid rgba(239,68,68,.35)', borderRadius: 7, padding: '.42rem .9rem', fontFamily: 'var(--mono)', fontSize: '.6rem', color: '#fca5a5', cursor: 'pointer' }}>
              {copied ? '✓ Copied' : 'Copy post caption'}
            </button>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--dim)' }}>Post to r/recruitinghell · LinkedIn · X — image first, reply to comments for 2h.</span>
          </div>
        </>
      )}
    </Card>
  )
}

const linkBtn: React.CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: '.52rem', padding: '.25rem .6rem', borderRadius: 5,
  border: '1px solid var(--line2)', background: 'transparent', color: 'var(--dim)', textDecoration: 'none',
}
