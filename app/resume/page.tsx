'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { ResumeStore } from '@/lib/stores/ResumeStore'
import { useAuth } from '@/lib/auth'
import { aiHeaders } from '@/lib/aiHeaders'

type Tool = 'scanner' | 'coach' | 'proposal'

interface ScannerResult {
  match_score: number
  score_summary?: string
  missing_keywords?: string[]
  strong_keywords?: string[]
  specific_fixes?: Array<{ current: string; improved: string }>
  ghost_risk_note?: string
}

interface CoachResult {
  hiring_manager_script?: string
  timing_note?: string
  company_intel?: string
  cover_letter_framework?: string
  referral_strategy?: string
}

interface ProposalResult {
  opening_note?: string
  day_30?: string
  day_60?: string
  day_90?: string
}

const areaStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--surface)',
  border: '1.5px solid var(--line2)',
  borderRadius: 8,
  padding: '.72rem 1rem',
  color: 'var(--white)',
  fontFamily: 'var(--mono)',
  fontSize: '.72rem',
  outline: 'none',
  resize: 'vertical',
  lineHeight: 1.6,
  caretColor: 'var(--blue)',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--surface)',
  border: '1.5px solid var(--line2)',
  borderRadius: 8,
  padding: '.62rem .9rem',
  color: 'var(--white)',
  fontFamily: 'var(--body)',
  fontSize: '.875rem',
  outline: 'none',
  caretColor: 'var(--blue)',
  marginBottom: '.75rem',
}

const btnPrimary: React.CSSProperties = {
  background: 'linear-gradient(135deg,#3b82f6 0%,#8b5cf6 100%)',
  color: '#fff', border: 'none', borderRadius: 8,
  padding: '.75rem 1.25rem',
  fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.85rem',
  cursor: 'pointer', boxShadow: '0 0 20px rgba(59,130,246,0.3)',
  width: '100%',
}

const label = (text: string) => (
  <label style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', textTransform: 'uppercase' as const, letterSpacing: '.08em', color: 'var(--dim)', display: 'block', marginBottom: '.3rem' }}>
    {text}
  </label>
)

function chip(text: string, color: string, bg: string, border: string) {
  return <span style={{ background: bg, border: `1px solid ${border}`, color, borderRadius: 5, padding: '.2rem .6rem', fontFamily: 'var(--mono)', fontSize: '.65rem' }}>{text}</span>
}

function ScannerResultView({ d }: { d: ScannerResult }) {
  const scoreColor = d.match_score >= 75 ? 'var(--green)' : d.match_score >= 50 ? 'var(--amber)' : 'var(--red)'
  return (
    <div style={{ animation: 'fadeUp .3s ease both' }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--line2)', borderRadius: 12, padding: '1.25rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.75rem' }}>
          <div style={{ fontFamily: 'var(--display)', fontSize: '.85rem', fontWeight: 700, color: 'var(--white)' }}>ATS Match Score</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '1.75rem', fontWeight: 500, color: scoreColor }}>{d.match_score}%</div>
        </div>
        <div style={{ height: 6, background: 'var(--line2)', borderRadius: 3, overflow: 'hidden', marginBottom: '.5rem' }}>
          <div style={{ height: '100%', width: `${d.match_score}%`, background: scoreColor, borderRadius: 3, transition: 'width 1s ease' }} />
        </div>
        {d.score_summary && <div style={{ fontSize: '.75rem', color: 'var(--sub)', lineHeight: 1.65 }}>{d.score_summary}</div>}
      </div>
      {d.missing_keywords && d.missing_keywords.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--line2)', borderRadius: 12, padding: '1.25rem', marginBottom: '1rem' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--red)', marginBottom: '.65rem' }}>Missing keywords — add these</div>
          <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap' }}>
            {d.missing_keywords.map(k => <span key={k}>{chip(k, 'var(--red)', 'var(--rdim)', '#ff3b5c20')}</span>)}
          </div>
        </div>
      )}
      {d.strong_keywords && d.strong_keywords.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--line2)', borderRadius: 12, padding: '1.25rem', marginBottom: '1rem' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--green)', marginBottom: '.65rem' }}>Strong matches ✓</div>
          <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap' }}>
            {d.strong_keywords.map(k => <span key={k}>{chip(k, 'var(--green)', 'var(--gdim)', 'var(--gmid)')}</span>)}
          </div>
        </div>
      )}
      {d.specific_fixes && d.specific_fixes.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--line2)', borderRadius: 12, padding: '1.25rem', marginBottom: '1rem' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--amber)', marginBottom: '.75rem' }}>Specific rewrites</div>
          {d.specific_fixes.map((fix, i) => (
            <div key={i} style={{ marginBottom: '.85rem', paddingBottom: '.85rem', borderBottom: i < (d.specific_fixes?.length ?? 0) - 1 ? '1px solid var(--line)' : 'none' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--red)', marginBottom: '.3rem' }}>✗ Current</div>
              <div style={{ fontSize: '.78rem', color: 'var(--sub)', background: 'var(--raised)', padding: '.5rem .75rem', borderRadius: 6, marginBottom: '.4rem', lineHeight: 1.6 }}>{fix.current}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--green)', marginBottom: '.3rem' }}>✓ Rewrite</div>
              <div style={{ fontSize: '.78rem', color: 'var(--white)', background: 'var(--gdim)', padding: '.5rem .75rem', borderRadius: 6, lineHeight: 1.6, border: '1px solid var(--gmid)' }}>{fix.improved}</div>
            </div>
          ))}
        </div>
      )}
      {d.ghost_risk_note && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--line2)', borderRadius: 12, padding: '1.25rem' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--muted)', marginBottom: '.5rem' }}>Ghost risk</div>
          <div style={{ fontSize: '.82rem', color: 'var(--sub)', lineHeight: 1.7 }}>{d.ghost_risk_note}</div>
        </div>
      )}
    </div>
  )
}

function CoachResultView({ d }: { d: CoachResult }) {
  const steps = [
    { icon: '🔍', title: 'Find the hiring manager', content: d.hiring_manager_script, label: 'LinkedIn message template' },
    { icon: '⏰', title: 'Apply in the first 24–48 hours', content: d.timing_note, label: 'Why timing matters' },
    { icon: '🏢', title: 'Company research intel', content: d.company_intel, label: 'What to know before you apply' },
    { icon: '📄', title: 'Cover letter framework', content: d.cover_letter_framework, label: 'The cover letter that works' },
    { icon: '🤝', title: 'Referral strategy', content: d.referral_strategy, label: 'How to get a referral' },
  ]
  return (
    <div style={{ animation: 'fadeUp .3s ease both' }}>
      {steps.filter(s => s.content).map(s => (
        <div key={s.title} style={{ background: 'var(--surface)', border: '1px solid var(--line2)', borderRadius: 12, padding: '1.1rem', marginBottom: '.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.65rem', marginBottom: '.65rem' }}>
            <div style={{ width: 28, height: 28, borderRadius: 7, background: 'var(--gdim)', border: '1px solid var(--gmid)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.85rem', flexShrink: 0 }}>{s.icon}</div>
            <div>
              <div style={{ fontFamily: 'var(--display)', fontSize: '.82rem', fontWeight: 700, color: 'var(--white)' }}>{s.title}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--muted)' }}>{s.label}</div>
            </div>
          </div>
          <div style={{ fontSize: '.8rem', color: 'var(--sub)', lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>{s.content}</div>
        </div>
      ))}
      <div style={{ background: 'var(--gdim)', border: '1px solid var(--gmid)', borderRadius: 8, padding: '.85rem', fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--green)', lineHeight: 1.65 }}>
        → Use the Pre-Proposal tool to generate a 30/60/90 day plan to attach with your application.
      </div>
    </div>
  )
}

function ProposalResultView({ d }: { d: ProposalResult }) {
  const phases = [
    { label: 'First 30 days', content: d.day_30, color: 'var(--blue)' },
    { label: 'Days 31–60', content: d.day_60, color: 'var(--amber)' },
    { label: 'Days 61–90', content: d.day_90, color: 'var(--green)' },
  ]
  return (
    <div style={{ animation: 'fadeUp .3s ease both' }}>
      {d.opening_note && <div style={{ fontFamily: 'var(--mono)', fontSize: '.72rem', color: 'var(--sub)', marginBottom: '1rem', padding: '.75rem 1rem', background: 'var(--raised)', borderRadius: 8 }}>{d.opening_note}</div>}
      {phases.filter(p => p.content).map(p => (
        <div key={p.label} style={{ background: 'var(--surface)', border: '1px solid var(--line2)', borderRadius: 12, padding: '1.1rem', marginBottom: '.75rem' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', textTransform: 'uppercase', letterSpacing: '.08em', color: p.color, marginBottom: '.65rem' }}>{p.label}</div>
          <div style={{ fontSize: '.82rem', color: 'var(--sub)', lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>{p.content}</div>
        </div>
      ))}
    </div>
  )
}

function ResultEmpty({ icon, text }: { icon: string; text: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 300, color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.72rem', textAlign: 'center', gap: '.75rem' }}>
      <div style={{ fontSize: '2.5rem' }}>{icon}</div>
      <div>{text}</div>
    </div>
  )
}

function ResumeInput({
  resumeText,
  setResumeText,
  resumeMeta,
  onUpload,
  onClear,
  onFileDrop,
}: {
  resumeText: string
  setResumeText: (t: string) => void
  resumeMeta: { fileName: string; wordCount: number } | null
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
  onClear: () => void
  onFileDrop: (file: File) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.4rem' }}>
        {label('Your resume')}
        <div style={{ display: 'flex', gap: '.5rem' }}>
          <button onClick={() => fileRef.current?.click()} style={{ background: 'none', border: '1px solid var(--line2)', color: 'var(--dim)', borderRadius: 6, padding: '.25rem .65rem', fontFamily: 'var(--mono)', fontSize: '.6rem', cursor: 'pointer' }}>
            Upload PDF/Word
          </button>
          {resumeText && (
            <button onClick={onClear} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.6rem', cursor: 'pointer' }}>
              Clear
            </button>
          )}
        </div>
        <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.txt" onChange={onUpload} style={{ display: 'none' }} />
      </div>

      {resumeMeta ? (
        <div style={{ background: 'var(--gdim)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 8, padding: '.72rem 1rem', fontFamily: 'var(--mono)', fontSize: '.68rem', color: 'var(--green)', marginBottom: '.75rem' }}>
          ✓ {resumeMeta.fileName} · {resumeMeta.wordCount} words saved
        </div>
      ) : (
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setIsDragging(false)
            const file = e.dataTransfer.files[0]
            if (file) onFileDrop(file)
          }}
          style={{
            border: isDragging ? '2px dashed var(--blue)' : '2px dashed var(--line2)',
            background: isDragging ? 'rgba(59,130,246,0.05)' : 'transparent',
            borderRadius: 8,
            transition: 'all .15s',
          }}
        >
          <textarea
            placeholder="Paste your resume text here, or drag & drop a PDF/Word file..."
            value={resumeText}
            onChange={e => setResumeText(e.target.value)}
            rows={8}
            style={{ ...areaStyle, border: 'none', background: 'transparent' }}
          />
        </div>
      )}
    </div>
  )
}

function EmailCTA({ company, role, matchScore, summary, user }: { company: string; role: string; matchScore: number | null; summary: string; user: { email?: string } | null }) {
  const [email, setEmail] = useState(user?.email ?? '')
  const [sent, setSent] = useState(false)
  const [sending, setSending] = useState(false)
  const [open, setOpen] = useState(false)

  async function send() {
    if (!email.trim()) return
    setSending(true)
    try {
      await fetch('/api/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'email_analysis', email: email.trim(), co: company, role, matchScore, summary }),
      })
      setSent(true)
    } catch { /* fail silently */ }
    setSending(false)
  }

  if (!company || !role) return null

  return (
    <div style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 12, padding: '1rem 1.1rem', marginTop: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        <div>
          <div style={{ fontFamily: 'var(--display)', fontSize: '.82rem', fontWeight: 700, color: 'var(--green)' }}>📧 Email this analysis + apply reminder</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'rgba(52,211,153,0.6)', marginTop: '.15rem' }}>Get a link to track your application after you apply</div>
        </div>
        <span style={{ color: 'var(--green)', fontSize: '.75rem' }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && !sent && (
        <div style={{ marginTop: '.85rem', display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="your@email.com"
            style={{ flex: 1, minWidth: 180, background: 'var(--surface)', border: '1.5px solid rgba(16,185,129,0.3)', borderRadius: 8, padding: '.5rem .75rem', color: 'var(--white)', fontFamily: 'var(--mono)', fontSize: '.72rem', outline: 'none', caretColor: 'var(--green)' }}
          />
          <button
            onClick={send}
            disabled={sending || !email.trim()}
            style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.4)', color: 'var(--green)', fontFamily: 'var(--mono)', fontSize: '.72rem', fontWeight: 600, padding: '.5rem .9rem', borderRadius: 8, cursor: sending ? 'not-allowed' : 'pointer', opacity: sending ? 0.7 : 1 }}
          >
            {sending ? 'Sending…' : 'Send →'}
          </button>
        </div>
      )}
      {open && sent && (
        <div style={{ marginTop: '.75rem', fontFamily: 'var(--mono)', fontSize: '.7rem', color: 'var(--green)' }}>
          ✓ Sent! Check your email — click the link after you apply to start tracking.
        </div>
      )}
    </div>
  )
}

function ResumePageInner() {
  const { isLoggedIn, user } = useAuth()
  const params = useSearchParams()
  const [tool, setTool] = useState<Tool>('scanner')
  const [resumeText, setResumeText] = useState('')
  const [resumeMeta, setResumeMeta] = useState<{ fileName: string; wordCount: number } | null>(null)

  // Scanner fields — pre-filled from query params when coming from jobs page
  const [scanJob, setScanJob] = useState(params?.get('role') ?? '')
  const [scanCompany, setScanCompany] = useState(params?.get('company') ?? '')
  const [scanJD, setScanJD] = useState('')
  const [scanResult, setScanResult] = useState<ScannerResult | null>(null)

  // Coach fields
  const [coachJob, setCoachJob] = useState('')
  const [coachCompany, setCoachCompany] = useState('')
  const [coachJD, setCoachJD] = useState('')
  const [coachBackground, setCoachBackground] = useState('')
  const [coachResult, setCoachResult] = useState<CoachResult | null>(null)

  // Proposal fields
  const [propJob, setPropJob] = useState('')
  const [propCompany, setPropCompany] = useState('')
  const [propJD, setPropJD] = useState('')
  const [propBackground, setPropBackground] = useState('')
  const [propResult, setPropResult] = useState<ProposalResult | null>(null)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    ResumeStore.load(user?.id, isLoggedIn).then(data => {
      if (data) {
        setResumeMeta({ fileName: data.fileName, wordCount: data.wordCount })
        setResumeText(data.text)
      }
    })
  }, [user?.id, isLoggedIn])

  async function uploadFile(file: File) {
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const b64 = (ev.target?.result as string).split(',')[1]
      try {
        const res = await fetch('/api/resume', {
          method: 'POST',
          headers: await aiHeaders(),
          body: JSON.stringify({ action: 'parse', base64: b64, fileName: file.name, mimeType: file.type }),
        })
        const data = await res.json() as { text?: string; credits_required?: boolean; error?: string }
        if (data.credits_required) {
          setError(isLoggedIn ? "You're out of AI credits — try again later." : 'Sign in to use AI resume features.')
          return
        }
        if (data.text) {
          const wc = data.text.trim().split(/\s+/).length
          await ResumeStore.save(data.text, file.name, wc, user?.id, isLoggedIn)
          setResumeText(data.text)
          setResumeMeta({ fileName: file.name, wordCount: wc })
        }
      } catch {
        setError('Failed to parse file. Try pasting text instead.')
      }
    }
    reader.readAsDataURL(file)
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    await uploadFile(file)
  }

  function clearResume() {
    ResumeStore.clear(user?.id, isLoggedIn)
    setResumeText('')
    setResumeMeta(null)
  }

  // Thrown when the AI endpoint reports no credits / not signed in — callers show a friendly message.
  class CreditsError extends Error {}

  async function callApi<T>(payload: Record<string, unknown>): Promise<T> {
    const res = await fetch('/api/resume', {
      method: 'POST',
      headers: await aiHeaders(),
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({})) as { credits_required?: boolean; error?: string } & T
    if (data.credits_required) throw new CreditsError(isLoggedIn ? "You're out of AI credits — try again later." : 'Sign in to use AI resume features.')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return data as T
  }

  async function runScanner() {
    const text = resumeText
    if (!text.trim()) { setError('Paste your resume first.'); return }
    if (!scanJob.trim()) { setError('Enter the job title.'); return }
    setLoading(true); setError(''); setScanResult(null)
    try {
      const out = await callApi<ScannerResult>({ tool: 'scanner', resume: text, job: scanJob, company: scanCompany, jobDescription: scanJD })
      setScanResult(out)
    } catch (e) { setError(e instanceof CreditsError ? e.message : 'Analysis failed. Please try again.') }
    setLoading(false)
  }

  async function runCoach() {
    const text = resumeText
    if (!text.trim()) { setError('Paste your resume first.'); return }
    if (!coachJob.trim()) { setError('Enter the job title.'); return }
    setLoading(true); setError(''); setCoachResult(null)
    try {
      const out = await callApi<CoachResult>({ tool: 'coach', resume: text, job: coachJob, company: coachCompany, jobDescription: coachJD, background: coachBackground })
      setCoachResult(out)
    } catch (e) { setError(e instanceof CreditsError ? e.message : 'Coach failed. Please try again.') }
    setLoading(false)
  }

  async function runProposal() {
    const text = resumeText
    if (!text.trim()) { setError('Paste your resume first.'); return }
    if (!propJob.trim()) { setError('Enter the job title.'); return }
    setLoading(true); setError(''); setPropResult(null)
    try {
      const out = await callApi<ProposalResult>({ tool: 'proposal', resume: text, job: propJob, company: propCompany, jobDescription: propJD, background: propBackground })
      setPropResult(out)
    } catch (e) { setError(e instanceof CreditsError ? e.message : 'Proposal failed. Please try again.') }
    setLoading(false)
  }

  function toolBtn(t: Tool, label: string) {
    const active = tool === t
    return (
      <button
        onClick={() => { setTool(t); setError('') }}
        style={{
          background: active ? 'linear-gradient(135deg,rgba(16,185,129,0.15) 0%,rgba(59,130,246,0.15) 100%)' : 'none',
          border: `1.5px solid ${active ? 'var(--green)' : 'var(--line2)'}`,
          color: active ? 'var(--green)' : 'var(--sub)',
          borderRadius: 8, padding: '.55rem 1.1rem',
          fontFamily: 'var(--mono)', fontSize: '.7rem', fontWeight: active ? 600 : 400,
          cursor: 'pointer', transition: 'all .2s',
        }}
      >
        {label}
      </button>
    )
  }

  const sharedResume = (
    <ResumeInput
      resumeText={resumeText}
      setResumeText={setResumeText}
      resumeMeta={resumeMeta}
      onUpload={handleUpload}
      onFileDrop={uploadFile}
      onClear={clearResume}
    />
  )

  return (
    <div className="page-full">
      <div className="resume-page">
        <div className="resume-hdr">
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase', letterSpacing: '.22em', color: 'var(--blue)', marginBottom: '.6rem', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 22, height: 1, background: 'var(--blue)', display: 'inline-block' }} />
            AI Resume Advisor
          </div>
          <h1 style={{ fontFamily: 'var(--display)', fontSize: '2rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.03em', marginBottom: '.3rem' }}>
            Maximize every application
          </h1>
          <p style={{ color: 'var(--sub)', fontSize: '.85rem', fontWeight: 300 }}>
            ATS scanner, advantage coach, and 30/60/90-day proposal generator — all from your resume.
          </p>
        </div>

        {/* Tool tabs */}
        <div style={{ display: 'flex', gap: '.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
          {toolBtn('scanner', '🎯 Resume Scanner')}
          {toolBtn('coach', '🧠 Advantage Coach')}
          {toolBtn('proposal', '📋 Pre-Proposal')}
        </div>

        {error && (
          <div style={{ background: 'var(--rdim)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, padding: '.72rem 1rem', fontFamily: 'var(--mono)', fontSize: '.72rem', color: 'var(--red)', marginBottom: '1rem' }}>
            {error}
          </div>
        )}

        {/* Scanner */}
        {tool === 'scanner' && (
          <div className="resume-layout">
            <div>
              {sharedResume}
              <div style={{ marginTop: '1rem' }}>
                {label('Job title')}
                <input type="text" placeholder="e.g. Senior Product Manager" value={scanJob} onChange={e => setScanJob(e.target.value)} style={inputStyle} />
                {label('Company (optional)')}
                <input type="text" placeholder="e.g. Stripe" value={scanCompany} onChange={e => setScanCompany(e.target.value)} style={inputStyle} />
                {label('Job description (optional but recommended)')}
                <textarea placeholder="Paste the job description..." value={scanJD} onChange={e => setScanJD(e.target.value)} rows={5} style={{ ...areaStyle, marginBottom: '.75rem' }} />
                <button style={{ ...btnPrimary, opacity: loading ? 0.6 : 1, cursor: loading ? 'not-allowed' : 'pointer' }} onClick={runScanner} disabled={loading}>
                  {loading && tool === 'scanner' ? 'Analyzing...' : 'Scan resume →'}
                  <span style={{ marginLeft: '.5rem', fontSize: '.55rem', opacity: .65, fontFamily: 'var(--mono)', fontWeight: 400 }}>· 1 credit</span>
                </button>
              </div>
            </div>
            <div>
              {scanResult ? (
                <>
                  <ScannerResultView d={scanResult} />
                  <EmailCTA
                    company={scanCompany}
                    role={scanJob}
                    matchScore={scanResult.match_score}
                    summary={scanResult.score_summary ?? ''}
                    user={user}
                  />
                </>
              ) : (
                <ResultEmpty icon="🎯" text={'ATS match score, missing keywords,\nand line-by-line rewrites appear here.'} />
              )}
            </div>
          </div>
        )}

        {/* Coach */}
        {tool === 'coach' && (
          <div className="resume-layout">
            <div>
              {sharedResume}
              <div style={{ marginTop: '1rem' }}>
                {label('Job title')}
                <input type="text" placeholder="e.g. Engineering Manager" value={coachJob} onChange={e => setCoachJob(e.target.value)} style={inputStyle} />
                {label('Company')}
                <input type="text" placeholder="e.g. Notion" value={coachCompany} onChange={e => setCoachCompany(e.target.value)} style={inputStyle} />
                {label('Job description')}
                <textarea placeholder="Paste the job description..." value={coachJD} onChange={e => setCoachJD(e.target.value)} rows={4} style={{ ...areaStyle, marginBottom: '.75rem' }} />
                {label('Your background (why you want this role)')}
                <textarea placeholder="What draws you to this role? Any unique experience?" value={coachBackground} onChange={e => setCoachBackground(e.target.value)} rows={3} style={{ ...areaStyle, marginBottom: '.75rem' }} />
                <button style={{ ...btnPrimary, opacity: loading ? 0.6 : 1, cursor: loading ? 'not-allowed' : 'pointer' }} onClick={runCoach} disabled={loading}>
                  {loading && tool === 'coach' ? 'Building playbook...' : 'Get advantage playbook →'}
                  <span style={{ marginLeft: '.5rem', fontSize: '.55rem', opacity: .65, fontFamily: 'var(--mono)', fontWeight: 400 }}>· 1 credit</span>
                </button>
              </div>
            </div>
            <div>
              {coachResult ? (
                <CoachResultView d={coachResult} />
              ) : (
                <ResultEmpty icon="🧠" text={'Hiring manager script, timing notes,\ncompany intel, and referral tactics appear here.'} />
              )}
            </div>
          </div>
        )}

        {/* Proposal */}
        {tool === 'proposal' && (
          <div className="resume-layout">
            <div>
              {sharedResume}
              <div style={{ marginTop: '1rem' }}>
                {label('Job title')}
                <input type="text" placeholder="e.g. Head of Growth" value={propJob} onChange={e => setPropJob(e.target.value)} style={inputStyle} />
                {label('Company')}
                <input type="text" placeholder="e.g. Linear" value={propCompany} onChange={e => setPropCompany(e.target.value)} style={inputStyle} />
                {label('Job description')}
                <textarea placeholder="Paste the job description..." value={propJD} onChange={e => setPropJD(e.target.value)} rows={4} style={{ ...areaStyle, marginBottom: '.75rem' }} />
                {label('Your relevant experience')}
                <textarea placeholder="Briefly describe your most relevant experience for this role..." value={propBackground} onChange={e => setPropBackground(e.target.value)} rows={3} style={{ ...areaStyle, marginBottom: '.75rem' }} />
                <button style={{ ...btnPrimary, opacity: loading ? 0.6 : 1, cursor: loading ? 'not-allowed' : 'pointer' }} onClick={runProposal} disabled={loading}>
                  {loading && tool === 'proposal' ? 'Generating proposal...' : 'Generate 30/60/90-day plan →'}
                  <span style={{ marginLeft: '.5rem', fontSize: '.55rem', opacity: .65, fontFamily: 'var(--mono)', fontWeight: 400 }}>· 1 credit</span>
                </button>
              </div>
            </div>
            <div>
              {propResult ? (
                <ProposalResultView d={propResult} />
              ) : (
                <ResultEmpty icon="📋" text={'Your 30/60/90-day onboarding plan\nready to attach to your application.'} />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function ResumePage() {
  return (
    <Suspense fallback={<div className="page-full"><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}><div className="spinner" /></div></div>}>
      <ResumePageInner />
    </Suspense>
  )
}
