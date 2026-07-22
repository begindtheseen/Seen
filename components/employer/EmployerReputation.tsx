'use client'

import { useEffect, useRef, useState } from 'react'
import { useEmployerCompany } from './EmployerCompanyContext'
import { useAuth } from '@/lib/auth'

// The employer portal's anchor: an employer looks up their own company and sees EXACTLY what
// candidates see before they apply — their Seen grade, ghost rate, response rate, and how many
// applicants reported. Real data from /api/reports (the same score the public company page shows).
// This is the honest hook: "here's your reputation; candidates check it before applying — fix it."

type Score = {
  overall_score: number | null
  ghost_rate: number | null
  response_rate: number | null
  avg_wait_days: number | null
  report_count: number
  first_party_report_count?: number
  web_report_count?: number
  data_source?: string
}

const gradeOf = (s: number) => (s >= 80 ? 'A' : s >= 65 ? 'B' : s >= 50 ? 'C' : s >= 35 ? 'D' : 'F')
const gradeColor = (s: number) => (s >= 65 ? 'var(--green)' : s >= 50 ? 'var(--amber)' : 'var(--red)')
const pct = (v: number | null | undefined) => (v == null ? null : Math.round(v * 100))

export function EmployerReputation() {
  const { setCompany } = useEmployerCompany()
  const { ready, isEmployer, employerCompany, claimsReady } = useAuth()
  // A logged-in employer with an APPROVED claim is SCOPED to their own company: the portal must
  // show THEIR reputation, auto-loaded and locked — never a free-text lookup of someone else's.
  // (The bug this fixes: a scoped employer could type any company and the whole portal — reputation
  // AND listings — would show that other company's data, e.g. Amazon's grade on the Seen Jobs portal.)
  const scoped = !!(ready && claimsReady && isEmployer && employerCompany)

  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [score, setScore] = useState<Score | null>(null)
  const [checked, setChecked] = useState('')
  const [err, setErr] = useState('')

  async function runLookup(raw: string) {
    const q = raw.trim()
    if (!q) return
    setCompany(q) // carry the company to the portal's surface links (EmployerSurfaces)
    setLoading(true); setErr(''); setScore(null)
    try {
      const res = await fetch('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'company_score', name: q }) })
      const d = await res.json()
      setChecked(q)
      setScore(d?.score || null)
    } catch { setErr('Could not load your reputation — try again.') } finally { setLoading(false) }
  }
  const look = () => runLookup(name)

  // Scoped employers: auto-load their OWN company once, and never accept another name.
  const autoRan = useRef(false)
  useEffect(() => {
    if (scoped && employerCompany && !autoRan.current) {
      autoRan.current = true
      setName(employerCompany)
      runLookup(employerCompany)
    }
  }, [scoped, employerCompany]) // eslint-disable-line react-hooks/exhaustive-deps

  const s = score
  const overall = s?.overall_score ?? null
  const ghost = pct(s?.ghost_rate)
  const reply = pct(s?.response_rate)
  const wait = s?.avg_wait_days != null ? Math.round(s.avg_wait_days) : null
  const hasData = overall != null && (s?.report_count ?? 0) > 0
  // Honest split (migration 063): only first-party rows may render as "applicant reports" —
  // the web-research claimed count is an estimate, not applicants who reported this employer.
  const fpReports = s ? (s.first_party_report_count ?? (s.data_source === 'reports' ? (s.report_count ?? 0) : 0)) : 0

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 18, padding: '2rem', marginBottom: '2.5rem' }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', textTransform: 'uppercase', letterSpacing: '.16em', color: 'var(--blue)', marginBottom: '.5rem' }}>Your reputation</div>
      <h2 style={{ fontFamily: 'var(--display)', fontSize: '1.5rem', fontWeight: 800, color: 'var(--white)', margin: '0 0 .5rem', letterSpacing: '-.02em' }}>See what candidates see before they apply.</h2>
      <p style={{ color: 'var(--sub)', fontSize: '.85rem', lineHeight: 1.7, margin: '0 0 1.4rem', maxWidth: 560 }}>
        Job seekers check Seen before they hit apply. Look up your company and see the exact grade, ghost rate, and response rate they see — the numbers that decide whether your best candidates bother applying.
      </p>

      {scoped ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap', marginBottom: score || loading ? '1.6rem' : 0 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '.5rem', background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 9, padding: '.55rem .9rem' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase', letterSpacing: '.14em', color: 'var(--dim)' }}>Your company</span>
            <span style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.85rem', color: 'var(--white)' }}>{employerCompany}</span>
          </div>
          {loading && <span style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--dim)' }}>Loading…</span>}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', marginBottom: score || loading ? '1.6rem' : 0 }}>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') look() }}
            placeholder="Your company name"
            style={{ flex: 1, minWidth: 220, background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 9, padding: '.7rem .9rem', fontFamily: 'var(--mono)', fontSize: '.75rem', color: 'var(--white)', outline: 'none' }}
          />
          <button onClick={look} disabled={loading || !name.trim()} style={{ background: 'linear-gradient(135deg,#1d4ed8,#7c3aed)', border: 'none', borderRadius: 9, padding: '.7rem 1.4rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.8rem', color: '#fff', cursor: 'pointer', opacity: loading ? .6 : 1 }}>
            {loading ? 'Checking…' : 'Check my reputation →'}
          </button>
        </div>
      )}
      {err && <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--red)' }}>{err}</div>}

      {score !== null && !loading && (
        hasData ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap', paddingTop: '1.4rem', borderTop: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: 96, height: 96, borderRadius: 999, border: `4px solid ${gradeColor(overall!)}`, flexShrink: 0 }}>
                <div style={{ fontFamily: 'var(--display)', fontSize: '2.4rem', fontWeight: 800, color: gradeColor(overall!), lineHeight: 1 }}>{gradeOf(overall!)}</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--dim)', marginTop: 2 }}>{overall}/100</div>
              </div>
              <div style={{ display: 'flex', gap: '1.8rem', flexWrap: 'wrap' }}>
                {ghost != null && <Stat value={`${ghost}%`} label="ghost rate" color="var(--red)" />}
                {reply != null && <Stat value={`${reply}%`} label="response rate" color="var(--green)" />}
                {wait != null && <Stat value={`${wait}d`} label="avg wait" color="var(--amber)" />}
                {fpReports > 0
                  ? <Stat value={fpReports.toLocaleString()} label="applicant reports" color="var(--white)" />
                  : <Stat value="Web est." label="no first-party reports yet" color="var(--dim)" />}
              </div>
            </div>
            <div style={{ marginTop: '1.4rem', padding: '1rem 1.2rem', background: overall! >= 65 ? 'rgba(16,185,129,.06)' : 'rgba(239,68,68,.06)', border: `1px solid ${overall! >= 65 ? 'rgba(16,185,129,.25)' : 'rgba(239,68,68,.25)'}`, borderRadius: 12 }}>
              <div style={{ fontFamily: 'var(--display)', fontSize: '.9rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.3rem' }}>
                {overall! >= 65 ? 'Candidates trust you — now prove it.' : 'This is costing you candidates.'}
              </div>
              <p style={{ color: 'var(--sub)', fontSize: '.78rem', lineHeight: 1.6, margin: '0 0 .8rem' }}>
                {overall! >= 65
                  ? 'You respond better than most. A Transparency Verified badge makes that visible on your profile so more strong candidates apply.'
                  : `${ghost ?? ''}% of applicants reported never hearing back. Candidates see this before applying — the strongest ones self-select out. Commit to responding, get Verified, and win them back.`}
              </p>
              <a href="#promote" style={{ display: 'inline-block', background: 'none', border: '1px solid var(--line2)', borderRadius: 8, padding: '.5rem 1rem', fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--white)', textDecoration: 'none' }}>Get Transparency Verified →</a>
            </div>
          </div>
        ) : (
          <div style={{ paddingTop: '1.4rem', borderTop: '1px solid var(--line)' }}>
            <div style={{ fontFamily: 'var(--display)', fontSize: '.95rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.35rem' }}>No applicant reports for &ldquo;{checked}&rdquo; yet.</div>
            <p style={{ color: 'var(--sub)', fontSize: '.8rem', lineHeight: 1.65, margin: '0 0 .9rem', maxWidth: 520 }}>
              You&apos;re a blank slate — which is an opportunity. Get Transparency Verified now and you signal &ldquo;we respond&rdquo; from day one, before a single ghost report can define you.
            </p>
            <a href="#promote" style={{ display: 'inline-block', background: 'linear-gradient(135deg,#1d4ed8,#7c3aed)', border: 'none', borderRadius: 8, padding: '.55rem 1.1rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.78rem', color: '#fff', textDecoration: 'none' }}>Get Transparency Verified →</a>
          </div>
        )
      )}
    </div>
  )
}

function Stat({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
      <div style={{ fontFamily: 'var(--display)', fontSize: '1.6rem', fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--dim)' }}>{label}</div>
    </div>
  )
}
