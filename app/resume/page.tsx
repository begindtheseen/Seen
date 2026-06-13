'use client'

import { useState, useEffect, useRef } from 'react'
import { ResumeStore } from '@/lib/stores/ResumeStore'
import { useAuth } from '@/lib/auth'
import { aiHeaders } from '@/lib/aiHeaders'

type Tool = 'scanner' | 'coach' | 'proposal'

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

function ResultBox({ html, onCopy }: { html: string; onCopy?: () => void }) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, padding: '1.25rem', animation: 'fadeUp .3s ease both' }}>
      {onCopy && (
        <button
          onClick={onCopy}
          style={{ float: 'right', background: 'none', border: '1px solid var(--line2)', color: 'var(--dim)', borderRadius: 6, padding: '.25rem .65rem', fontFamily: 'var(--mono)', fontSize: '.6rem', cursor: 'pointer', marginBottom: '.5rem' }}
        >
          Copy
        </button>
      )}
      <div style={{ fontFamily: 'var(--mono)', fontSize: '.72rem', color: 'var(--sub)', lineHeight: 1.85, whiteSpace: 'pre-wrap' }}>
        {html}
      </div>
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

export default function ResumePage() {
  const { isLoggedIn, user } = useAuth()
  const [tool, setTool] = useState<Tool>('scanner')
  const [resumeText, setResumeText] = useState('')
  const [resumeMeta, setResumeMeta] = useState<{ fileName: string; wordCount: number } | null>(null)

  // Scanner fields
  const [scanJob, setScanJob] = useState('')
  const [scanCompany, setScanCompany] = useState('')
  const [scanJD, setScanJD] = useState('')
  const [scanResult, setScanResult] = useState('')

  // Coach fields
  const [coachJob, setCoachJob] = useState('')
  const [coachCompany, setCoachCompany] = useState('')
  const [coachJD, setCoachJD] = useState('')
  const [coachBackground, setCoachBackground] = useState('')
  const [coachResult, setCoachResult] = useState('')

  // Proposal fields
  const [propJob, setPropJob] = useState('')
  const [propCompany, setPropCompany] = useState('')
  const [propJD, setPropJD] = useState('')
  const [propBackground, setPropBackground] = useState('')
  const [propResult, setPropResult] = useState('')

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

  async function callApi(payload: Record<string, unknown>): Promise<string> {
    const res = await fetch('/api/resume', {
      method: 'POST',
      headers: await aiHeaders(),
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({})) as { result?: string; output?: string; text?: string; credits_required?: boolean; error?: string }
    if (data.credits_required) throw new CreditsError(isLoggedIn ? "You're out of AI credits — try again later." : 'Sign in to use AI resume features.')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return data.result || data.output || data.text || ''
  }

  async function runScanner() {
    const text = resumeText
    if (!text.trim()) { setError('Paste your resume first.'); return }
    if (!scanJob.trim()) { setError('Enter the job title.'); return }
    setLoading(true); setError(''); setScanResult('')
    try {
      const out = await callApi({ tool: 'scanner', resume: text, job: scanJob, company: scanCompany, jd: scanJD })
      setScanResult(out)
    } catch (e) { setError(e instanceof CreditsError ? e.message : 'Analysis failed. Please try again.') }
    setLoading(false)
  }

  async function runCoach() {
    const text = resumeText
    if (!text.trim()) { setError('Paste your resume first.'); return }
    if (!coachJob.trim()) { setError('Enter the job title.'); return }
    setLoading(true); setError(''); setCoachResult('')
    try {
      const out = await callApi({ tool: 'coach', resume: text, job: coachJob, company: coachCompany, jd: coachJD, background: coachBackground })
      setCoachResult(out)
    } catch (e) { setError(e instanceof CreditsError ? e.message : 'Coach failed. Please try again.') }
    setLoading(false)
  }

  async function runProposal() {
    const text = resumeText
    if (!text.trim()) { setError('Paste your resume first.'); return }
    if (!propJob.trim()) { setError('Enter the job title.'); return }
    setLoading(true); setError(''); setPropResult('')
    try {
      const out = await callApi({ tool: 'proposal', resume: text, job: propJob, company: propCompany, jd: propJD, background: propBackground })
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
                <ResultBox html={scanResult} onCopy={() => navigator.clipboard.writeText(scanResult)} />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 300, color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.72rem', textAlign: 'center', gap: '.75rem' }}>
                  <div style={{ fontSize: '2.5rem' }}>🎯</div>
                  <div>ATS match score, missing keywords,<br />and line-by-line rewrites appear here.</div>
                </div>
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
                <ResultBox html={coachResult} onCopy={() => navigator.clipboard.writeText(coachResult)} />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 300, color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.72rem', textAlign: 'center', gap: '.75rem' }}>
                  <div style={{ fontSize: '2.5rem' }}>🧠</div>
                  <div>Hiring manager script, timing notes,<br />company intel, and referral tactics appear here.</div>
                </div>
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
                <ResultBox html={propResult} onCopy={() => navigator.clipboard.writeText(propResult)} />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 300, color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.72rem', textAlign: 'center', gap: '.75rem' }}>
                  <div style={{ fontSize: '2.5rem' }}>📋</div>
                  <div>Your 30/60/90-day onboarding plan<br />ready to attach to your application.</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
