'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { ResumeStore } from '@/lib/stores/ResumeStore'
import { SavedJobsStore } from '@/lib/stores/SavedJobs'
import { useAuth } from '@/lib/auth'
import { aiHeaders } from '@/lib/aiHeaders'
import type { SavedJob } from '@/lib/types'
import UpgradeModal from '@/components/UpgradeModal'
import dynamic from 'next/dynamic'

const ResumeSurveyModal = dynamic(() => import('@/components/ResumeSurveyModal'), { ssr: false })

type Tool = 'scanner' | 'advantage'

interface ScannerResult {
  match_score: number
  score_summary?: string
  missing_keywords?: string[]
  strong_keywords?: string[]
  specific_fixes?: Array<{ current: string; improved: string; note?: string; unchanged?: boolean }>
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

// The merged "Advantage" tool returns the playbook + the 30/60/90 plan together.
type CombinedResult = CoachResult & ProposalResult

// Read-only company intel (from our scores) folded into the AI prompts — the thing
// only Seen has: how this company actually treats applicants.
interface CompanyIntel {
  ghost_rate?: number | null
  response_rate?: number | null
  avg_wait_days?: number | null
  overall_score?: number | null
  report_count?: number | null
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
  // maxWidth + overflowWrap keep a single very long keyword from forcing the row
  // wider than the mobile viewport.
  return <span style={{ background: bg, border: `1px solid ${border}`, color, borderRadius: 5, padding: '.2rem .6rem', fontFamily: 'var(--mono)', fontSize: '.65rem', maxWidth: '100%', overflowWrap: 'anywhere' }}>{text}</span>
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
              <div style={{ fontSize: '.78rem', color: 'var(--sub)', background: 'var(--raised)', padding: '.5rem .75rem', borderRadius: 6, marginBottom: '.4rem', lineHeight: 1.6, overflowWrap: 'anywhere' }}>{fix.current}</div>
              {fix.unchanged ? (
                // No safe automatic change available — don't show two identical
                // boxes. Mark it honestly as already strong.
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: '.35rem' }}>
                  ✓ Already strong — no rewrite needed
                </div>
              ) : (
                <>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--green)', marginBottom: '.3rem' }}>✓ Rewrite</div>
                  <div style={{ fontSize: '.78rem', color: 'var(--white)', background: 'var(--gdim)', padding: '.5rem .75rem', borderRadius: 6, lineHeight: 1.6, border: '1px solid var(--gmid)', overflowWrap: 'anywhere' }}>{fix.improved}</div>
                </>
              )}
              {fix.note && (
                <div style={{ fontSize: '.72rem', color: 'var(--amber)', marginTop: '.4rem', lineHeight: 1.55, fontStyle: 'italic' }}>💡 {fix.note}</div>
              )}
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
          <div style={{ fontSize: '.8rem', color: 'var(--sub)', lineHeight: 1.75, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{s.content}</div>
        </div>
      ))}
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
          <div style={{ fontSize: '.82rem', color: 'var(--sub)', lineHeight: 1.75, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{p.content}</div>
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

// Map a scanner result's rewrites into the {original, optimized, addresses}
// shape the PDF/email builder expects. Scanner returns `specific_fixes` with
// {current, improved, note?}; we translate that here so the exported doc is
// never blank. Skips the additive "(No bullet…)" placeholders that have no real
// original line to show as a before/after.
function fixesToBullets(scan: ScannerResult): Array<{ original: string; optimized: string; addresses: string; note: string }> {
  const fixes = scan.specific_fixes ?? []
  return fixes
    // Skip placeholder rows and no-op "already strong" bullets — a before/after
    // only makes sense when the rewrite actually changed the line.
    .filter(f => f.current && !/^\(/.test(f.current.trim()) && !f.unchanged)
    .map(f => ({
      original: f.current,
      optimized: f.improved,
      addresses: 'Stronger lead verb',
      note: f.note || '',
    }))
}

function EmailCTA({ company, role, scan, resumeText, jobJD, user }: { company: string; role: string; scan: ScannerResult; resumeText: string; jobJD: string; user: { email?: string } | null }) {
  const [email, setEmail] = useState(user?.email ?? '')
  const [sent, setSent] = useState(false)
  const [sending, setSending] = useState(false)
  const [open, setOpen] = useState(false)

  async function send() {
    if (!email.trim()) return
    setSending(true)
    try {
      const bullets = fixesToBullets(scan)
      const keywords = (scan.missing_keywords ?? []).slice(0, 12)
      await fetch('/api/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'email_analysis',
          email: email.trim(),
          co: company,
          role,
          matchScore: scan.match_score,
          summary: scan.score_summary ?? '',
          bullets,
          keywords,
          ghostNote: scan.ghost_risk_note ?? '',
          // Send the résumé + JD so the attached PDF is a complete, submittable
          // résumé built from the user's own text (not just a tips sheet).
          resume: resumeText,
          jobDescription: jobJD,
        }),
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

  // ONE shared job context feeds BOTH the Résumé-Fit scan and the Advantage tool —
  // pre-filled from query params when arriving from a job page.
  const [jobTitle, setJobTitle] = useState(params?.get('role') ?? '')
  const [jobCompany, setJobCompany] = useState(params?.get('company') ?? '')
  const [jobJD, setJobJD] = useState('')
  const [background, setBackground] = useState('')
  const [companyIntel, setCompanyIntel] = useState<CompanyIntel | null>(null)
  const [scanResult, setScanResult] = useState<ScannerResult | null>(null)
  const [advResult, setAdvResult] = useState<CombinedResult | null>(null)

  // Job source: choose from saved jobs (default) or reveal manual entry
  const [savedJobs, setSavedJobs] = useState<SavedJob[]>([])
  const [savedId, setSavedId] = useState('')
  const [showManual, setShowManual] = useState(false)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showUpgrade, setShowUpgrade] = useState(false)
  const [showSurvey, setShowSurvey] = useState(false)

  useEffect(() => {
    ResumeStore.load(user?.id, isLoggedIn).then(data => {
      if (data) {
        setResumeMeta({ fileName: data.fileName, wordCount: data.wordCount })
        setResumeText(data.text)
      }
    })
  }, [user?.id, isLoggedIn])

  // Saved jobs power the "choose a saved job" picker so users don't have to paste.
  useEffect(() => {
    SavedJobsStore.load(isLoggedIn).then(setSavedJobs).catch(() => {})
  }, [isLoggedIn])

  // Pull Seen intel once if the company was pre-filled (arriving from a job page).
  useEffect(() => { if (jobCompany.trim()) fetchIntel(jobCompany) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Read-only company intel (ghost/response from our scores) — no web research,
  // so it's cheap and only returns when we actually have data on the company.
  async function fetchIntel(company: string) {
    setCompanyIntel(null)
    if (!company.trim()) return
    try {
      const r = await fetch(`/api/reports?type=company&name=${encodeURIComponent(company.trim())}`)
      const d = await r.json().catch(() => ({})) as { stats?: CompanyIntel }
      if (d.stats && (d.stats.report_count || 0) > 0) setCompanyIntel(d.stats)
    } catch { /* no intel — the tools still run, just without Seen data */ }
  }

  // Pick a saved job → fill job title / company / description from its snapshot,
  // and pull this company's Seen intel to fold into the advice.
  function pickSavedJob(jobId: string) {
    setSavedId(jobId)
    if (!jobId) return
    const s = savedJobs.find(j => String(j.job_id) === jobId)
    if (!s) return
    const snap = s.snapshot
    const co = s.company || snap?.company || ''
    setJobTitle(s.role || snap?.title || '')
    setJobCompany(co)
    setJobJD(snap?.description || '')
    setShowManual(false)
    setError('')
    fetchIntel(co)
  }

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
          if (isLoggedIn) setShowUpgrade(true)
          else setError('Sign in to use AI resume features.')
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

  // Download a complete, submittable résumé PDF built deterministically from the
  // user's own résumé text. Posts to /api/resume (action: download_resume) and
  // saves the returned PDF with a clean, professional filename.
  const [downloading, setDownloading] = useState(false)
  async function downloadResume() {
    if (!resumeText.trim()) { setError('Add your résumé first.'); return }
    setDownloading(true); setError('')
    try {
      const res = await fetch('/api/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'download_resume', resume: resumeText, job: jobTitle, company: jobCompany, jobDescription: jobJD }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string }
        setError(d.error || 'Could not build your résumé PDF. Try pasting the full résumé text.')
        return
      }
      const blob = await res.blob()
      // Derive a clean filename: "First Last — Role Resume.pdf" → fallbacks.
      const cleanName = (resumeText.split(/\r?\n/).map(l => l.trim()).find(Boolean) || '').replace(/[^\w .'-]/g, '').trim()
      const cleanRole = jobTitle.replace(/[^\w .,'/&-]/g, '').trim()
      const looksLikeName = /^[A-Z][\w.'-]*(\s+[A-Z][\w.'-]*){1,3}$/.test(cleanName)
      const fileName = looksLikeName && cleanRole ? `${cleanName} — ${cleanRole} Resume.pdf`
        : looksLikeName ? `${cleanName} — Resume.pdf`
        : cleanRole ? `${cleanRole} Resume.pdf`
        : 'Seen Resume.pdf'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = fileName
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
    } catch {
      setError('Could not build your résumé PDF. Please try again.')
    }
    setDownloading(false)
  }

  // Thrown when the AI endpoint reports no credits / not signed in — callers show a friendly
  // message and, for signed-in users who are out of credits, surface the upgrade modal.
  class CreditsError extends Error {
    outOfCredits: boolean
    constructor(message: string, outOfCredits = false) { super(message); this.outOfCredits = outOfCredits }
  }

  async function callApi<T>(payload: Record<string, unknown>): Promise<T> {
    const res = await fetch('/api/resume', {
      method: 'POST',
      headers: await aiHeaders(),
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({})) as { credits_required?: boolean; error?: string } & T
    if (data.credits_required) {
      throw new CreditsError(
        isLoggedIn ? "You're out of AI credits today." : 'Sign in to use AI resume features.',
        isLoggedIn,
      )
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return data as T
  }

  // Centralized handling for the no-credits wall: signed-in users see the upgrade modal
  // (credits context, which keeps the "earn free credits" option visible); guests get a
  // sign-in prompt inline.
  function handleCreditWall(e: unknown, fallback: string) {
    if (e instanceof CreditsError) {
      if (e.outOfCredits) { setShowUpgrade(true); return }
      setError(e.message); return
    }
    setError(fallback)
  }

  async function runScanner() {
    if (!resumeText.trim()) { setError('Add your résumé first.'); return }
    if (!jobTitle.trim()) { setError('Pick a saved job, or enter the job title.'); return }
    setLoading(true); setError(''); setScanResult(null)
    try {
      const out = await callApi<ScannerResult>({ tool: 'scanner', resume: resumeText, job: jobTitle, company: jobCompany, jobDescription: jobJD, companyIntel })
      setScanResult(out)
    } catch (e) { handleCreditWall(e, 'Analysis failed. Please try again.') }
    setLoading(false)
  }

  async function runAdvantage() {
    if (!resumeText.trim()) { setError('Add your résumé first.'); return }
    if (!jobTitle.trim() || !jobCompany.trim()) { setError('Pick a saved job, or enter the job title + company.'); setShowManual(true); return }
    if (!jobJD.trim()) { setError('A job description is needed — pick a saved job or paste one (Enter manually).'); setShowManual(true); return }
    setLoading(true); setError(''); setAdvResult(null)
    try {
      const out = await callApi<CombinedResult>({ tool: 'advantage', resume: resumeText, job: jobTitle, company: jobCompany, jobDescription: jobJD, background, companyIntel })
      setAdvResult(out)
    } catch (e) { handleCreditWall(e, 'Generation failed. Please try again.') }
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
      {showUpgrade && <UpgradeModal reason="credits" onClose={() => setShowUpgrade(false)} />}
      {showSurvey && <ResumeSurveyModal onClose={() => setShowSurvey(false)} />}
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
            One job, one résumé — get your ATS fit plus a full advantage playbook + 30/60/90 plan, sharpened with Seen&apos;s data on how the company actually treats applicants.
          </p>
        </div>

        {error && (
          <div style={{ background: 'var(--rdim)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, padding: '.72rem 1rem', fontFamily: 'var(--mono)', fontSize: '.72rem', color: 'var(--red)', marginBottom: '1rem' }}>
            {error}
          </div>
        )}

        {/* Résumé intel survey — earn AI credits by sharing what it was like applying to
            companies from your work history. Only shown to signed-in users with a résumé. */}
        {isLoggedIn && resumeText && (
          <div
            onClick={() => setShowSurvey(true)}
            style={{ background: 'linear-gradient(90deg, rgba(99,102,241,.1), rgba(124,58,237,.06))', border: '1px solid rgba(99,102,241,.22)', borderRadius: 10, padding: '.65rem 1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.75rem', cursor: 'pointer' }}
          >
            <div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--indigo)', fontWeight: 600, marginBottom: '.12rem', display: 'flex', alignItems: 'center', gap: '.35rem' }}>
                <span style={{ fontSize: '.7rem' }}>✦</span>
                Earn AI credits — answer a few questions
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--sub)' }}>
                Share what it was like applying to a company from your résumé — 60 sec, +2 credits
              </div>
            </div>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--indigo)', flexShrink: 0 }}>Start →</span>
          </div>
        )}

        <div className="resume-layout">
          {/* Left: shared inputs — one résumé, one job, two outputs */}
          <div>
            {sharedResume}

            <div style={{ marginTop: '1rem' }}>
              {label('Which job?')}
              {savedJobs.length > 0 ? (
                <select value={savedId} onChange={e => pickSavedJob(e.target.value)} style={{ ...inputStyle, fontFamily: 'var(--body)', cursor: 'pointer' }}>
                  <option value="">📌 Choose a saved job…</option>
                  {savedJobs.map(s => (
                    <option key={String(s.job_id)} value={String(s.job_id)}>
                      {(s.role || 'Role')}{s.company ? ' — ' + s.company : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--muted)', marginBottom: '.6rem', lineHeight: 1.6 }}>
                  No saved jobs yet — save jobs from search, or enter the details below.
                </div>
              )}

              {savedId && !showManual && (
                <div style={{ background: 'var(--gdim)', border: '1px solid var(--gmid)', borderRadius: 8, padding: '.6rem .85rem', fontFamily: 'var(--mono)', fontSize: '.66rem', color: 'var(--green)', marginBottom: '.6rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>✓ {jobTitle}{jobCompany ? ' · ' + jobCompany : ''}</span>
                  <button onClick={() => setShowManual(true)} style={{ background: 'none', border: 'none', color: 'var(--green)', fontFamily: 'var(--mono)', fontSize: '.6rem', cursor: 'pointer', textDecoration: 'underline', flexShrink: 0 }}>edit</button>
                </div>
              )}

              {companyIntel && (
                <div style={{ background: 'rgba(59,130,246,0.07)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: 8, padding: '.55rem .8rem', fontFamily: 'var(--mono)', fontSize: '.6rem', color: '#7cb3ff', marginBottom: '.6rem', lineHeight: 1.6 }}>
                  📊 Seen data on {jobCompany}: {Math.round((companyIntel.ghost_rate || 0) * 100)}% ghost · {Math.round((companyIntel.response_rate || 0) * 100)}% respond{companyIntel.overall_score != null ? ` · grade ${Math.round(companyIntel.overall_score)}/100` : ''} — folded into the advice below.
                </div>
              )}

              <button
                onClick={() => setShowManual(v => !v)}
                style={{ background: 'none', border: '1px solid var(--line2)', color: 'var(--dim)', borderRadius: 6, padding: '.4rem .8rem', fontFamily: 'var(--mono)', fontSize: '.62rem', cursor: 'pointer', marginBottom: (showManual || savedJobs.length === 0) ? '.75rem' : '1rem' }}
              >
                {showManual ? '▲ Hide manual entry' : '✎ Enter job info manually'}
              </button>

              {(showManual || savedJobs.length === 0) && (
                <div>
                  {label('Job title')}
                  <input type="text" placeholder="e.g. Engineering Manager" value={jobTitle} onChange={e => setJobTitle(e.target.value)} style={inputStyle} />
                  {label('Company')}
                  <input type="text" placeholder="e.g. Notion" value={jobCompany} onChange={e => setJobCompany(e.target.value)} onBlur={() => fetchIntel(jobCompany)} style={inputStyle} />
                  {label('Job description')}
                  <textarea placeholder="Paste the job description..." value={jobJD} onChange={e => setJobJD(e.target.value)} rows={4} style={{ ...areaStyle, marginBottom: '.75rem' }} />
                </div>
              )}

              {/* Sub-tabs: which output */}
              {label('What do you want?')}
              <div style={{ display: 'flex', gap: '.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                {toolBtn('scanner', '🎯 Résumé Fit')}
                {toolBtn('advantage', '🧠 Advantage + Plan')}
              </div>

              {tool === 'advantage' && (
                <>
                  {label('Your background (why you want this role) — optional')}
                  <textarea placeholder="What draws you to this role? Any unique experience?" value={background} onChange={e => setBackground(e.target.value)} rows={3} style={{ ...areaStyle, marginBottom: '.75rem' }} />
                </>
              )}

              {tool === 'scanner' ? (
                <button style={{ ...btnPrimary, opacity: loading ? 0.6 : 1, cursor: loading ? 'not-allowed' : 'pointer' }} onClick={runScanner} disabled={loading}>
                  {loading ? 'Analyzing...' : 'Scan résumé fit →'}
                  <span style={{ marginLeft: '.5rem', fontSize: '.55rem', opacity: .65, fontFamily: 'var(--mono)', fontWeight: 400 }}>· 1 credit</span>
                </button>
              ) : (
                <button style={{ ...btnPrimary, opacity: loading ? 0.6 : 1, cursor: loading ? 'not-allowed' : 'pointer' }} onClick={runAdvantage} disabled={loading}>
                  {loading ? 'Building your advantage...' : 'Get advantage + 30/60/90 plan →'}
                  <span style={{ marginLeft: '.5rem', fontSize: '.55rem', opacity: .65, fontFamily: 'var(--mono)', fontWeight: 400 }}>· 1 credit</span>
                </button>
              )}
            </div>
          </div>

          {/* Right: the active output */}
          <div>
            {tool === 'scanner' ? (
              scanResult ? (
                <>
                  <ScannerResultView d={scanResult} />
                  <button
                    onClick={downloadResume}
                    disabled={downloading}
                    style={{
                      width: '100%', marginTop: '1rem', boxSizing: 'border-box',
                      background: 'var(--surface)', border: '1.5px solid var(--blue)',
                      color: 'var(--blue)', borderRadius: 8, padding: '.7rem 1rem',
                      fontFamily: 'var(--display)', fontWeight: 700, fontSize: '.8rem',
                      cursor: downloading ? 'not-allowed' : 'pointer', opacity: downloading ? 0.6 : 1,
                    }}
                  >
                    {downloading ? 'Building your résumé…' : '⬇ Download clean résumé (PDF)'}
                    <span style={{ display: 'block', marginTop: '.2rem', fontSize: '.58rem', opacity: .7, fontFamily: 'var(--mono)', fontWeight: 400 }}>
                      A complete, ATS-ready résumé built from your own text · free
                    </span>
                  </button>
                  <EmailCTA company={jobCompany} role={jobTitle} scan={scanResult} resumeText={resumeText} jobJD={jobJD} user={user} />
                </>
              ) : (
                <ResultEmpty icon="🎯" text={"ATS fit score, missing keywords, line-by-line\nrewrites — plus this company's ghost risk."} />
              )
            ) : (
              advResult ? (
                <>
                  <CoachResultView d={advResult} />
                  <div style={{ height: '.75rem' }} />
                  <ProposalResultView d={advResult} />
                </>
              ) : (
                <ResultEmpty icon="🧠" text={'Hiring-manager script, timing, referral tactics\n+ a 30/60/90-day plan appear here.'} />
              )
            )}
          </div>
        </div>
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
