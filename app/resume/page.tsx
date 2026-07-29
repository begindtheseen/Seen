'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { ResumeStore } from '@/lib/stores/ResumeStore'
import { SavedJobsStore } from '@/lib/stores/SavedJobs'
import { useAuth } from '@/lib/auth'
import { aiHeaders } from '@/lib/aiHeaders'
import type { SavedJob } from '@/lib/types'
import UpgradeModal from '@/components/UpgradeModal'
import { FREE_DAILY_CREDITS } from '@/lib/creditRules'
import dynamic from 'next/dynamic'
import ApplicationIntelligencePanel, { type ApplicationIntelligence, type ConfirmedAnswer } from '@/components/optimizer/ApplicationIntelligencePanel'

const ResumeSurveyModal = dynamic(() => import('@/components/ResumeSurveyModal'), { ssr: false })

const CREDIT_WORD = FREE_DAILY_CREDITS === 1 ? 'credit' : 'credits'

type Tab = 'fit' | 'intel' | 'rewrite' | 'humanproof' | 'strategy' | 'export'

// ── SeenFit optimizer output (canonical, from /api/optimizer action:'optimize') ──
interface Contribution { factor: string; weight: number; raw: number; points: number; reason: string }
interface RiskFlag { code: string; severity: 'low' | 'medium' | 'high'; message: string }
interface RequirementMatch { requirement: string; surface: string; importance: string; matched: boolean; via: string; evidence: string | null }
interface SafeBullet { text: string; evidenceUsed: string[]; template: string }
interface ConfirmItem { text: string; reason: string; placeholder: string }
interface OptimizerOutput {
  run_id?: string | null
  fit_score: number
  confidence: number
  confidence_label: 'low' | 'medium' | 'high'
  required_match: number
  preferred_match: number
  ats_coverage: number
  evidence_strength: number
  seniority_alignment: number
  company_process_score: number
  risk_flags: RiskFlag[]
  missing_keywords: string[]
  matched_requirements: RequirementMatch[]
  unsupported_requirements: RequirementMatch[]
  safe_bullets: SafeBullet[]
  confirm_before_using: ConfirmItem[]
  application_message: string
  explanation: { summary: string; contributions: Contribution[]; notes: string[] }
  engine_version?: string
  // Application Intelligence V2 — additive, may be null (falls back to the legacy UI).
  application_intelligence?: ApplicationIntelligence | null
}

// ── HumanProof package-mode output ──
interface HpConfirm { text: string; reason: string; placeholder: string }
interface HpItem { original: string; humanized_text: string; human_signal: number; confirm_before_using?: HpConfirm[]; interview_risk_warnings?: { phrase: string; warning: string }[] }
interface HpPackage { bullets: HpItem[]; application_message: HpItem | null; carried_warnings: { phrase: string; warning: string }[] }
interface HumanProofResult { package: HpPackage; humanproof_score: number; before_score: number; after_score: number; ai_slop_risk: 'low' | 'medium' | 'high'; run_id?: string | null }

interface Insights {
  what_they_want: string[]
  hidden_requirements: string[]
  insider_tip: string
  description_summary: string
}

interface CoachResult {
  hiring_manager_script?: string
  timing_note?: string
  company_intel?: string
  cover_letter_framework?: string
  referral_strategy?: string
}
interface ProposalResult { opening_note?: string; day_30?: string; day_60?: string; day_90?: string }
type CombinedResult = CoachResult & ProposalResult

interface CompanyIntel {
  ghost_rate?: number | null
  response_rate?: number | null
  avg_wait_days?: number | null
  overall_score?: number | null
  report_count?: number | null
}

const areaStyle: React.CSSProperties = {
  width: '100%', background: 'var(--surface)', border: '1.5px solid var(--line2)', borderRadius: 8,
  padding: '.72rem 1rem', color: 'var(--white)', fontFamily: 'var(--mono)', fontSize: '.72rem',
  outline: 'none', resize: 'vertical', lineHeight: 1.6, caretColor: 'var(--blue)',
}
const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--surface)', border: '1.5px solid var(--line2)', borderRadius: 8,
  padding: '.62rem .9rem', color: 'var(--white)', fontFamily: 'var(--body)', fontSize: '.875rem',
  outline: 'none', caretColor: 'var(--blue)', marginBottom: '.75rem', boxSizing: 'border-box',
}
const btnPrimary: React.CSSProperties = {
  background: 'linear-gradient(135deg,#3b82f6 0%,#8b5cf6 100%)', color: '#fff', border: 'none', borderRadius: 8,
  padding: '.75rem 1.25rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.85rem',
  cursor: 'pointer', boxShadow: '0 0 20px rgba(59,130,246,0.3)', width: '100%',
}

const label = (text: string) => (
  <label style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', textTransform: 'uppercase' as const, letterSpacing: '.08em', color: 'var(--dim)', display: 'block', marginBottom: '.3rem' }}>
    {text}
  </label>
)

const kicker = (text: string, color = 'var(--dim)') => (
  <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', textTransform: 'uppercase', letterSpacing: '.08em', color, marginBottom: '.6rem' }}>{text}</div>
)

function chip(text: string, color: string, bg: string, border: string) {
  return <span style={{ background: bg, border: `1px solid ${border}`, color, borderRadius: 5, padding: '.2rem .6rem', fontFamily: 'var(--mono)', fontSize: '.65rem', maxWidth: '100%', overflowWrap: 'anywhere' }}>{text}</span>
}

function scoreColor(s: number): string {
  return s >= 70 ? 'var(--green)' : s >= 45 ? 'var(--amber)' : 'var(--red)'
}
function pct(n: number): string { return `${Math.round((n || 0) * 100)}%` }

// ── Card wrapper ──
function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div className="ai-card" style={{ marginBottom: '1rem', ...style }}>{children}</div>
}

// ═══ FIT TAB — the diagnosis (scores, coverage, matches, company risk) ═══
function FitView({ out, intel, jobCompany, insights }: { out: OptimizerOutput; intel: CompanyIntel | null; jobCompany: string; insights: Insights | null }) {
  const metrics: Array<{ label: string; raw: number }> = [
    { label: 'ATS keyword coverage', raw: out.ats_coverage },
    { label: 'Required skills matched', raw: out.required_match },
    { label: 'Preferred skills matched', raw: out.preferred_match },
    { label: 'Evidence strength', raw: out.evidence_strength },
    { label: 'Seniority alignment', raw: out.seniority_alignment },
  ]
  return (
    <div style={{ animation: 'fadeUp .3s ease both' }}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ flexShrink: 0, width: 64, height: 64, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `3px solid ${scoreColor(out.fit_score)}` }}>
            <span style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: '1.35rem', color: scoreColor(out.fit_score) }}>{out.fit_score}</span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--display)', fontWeight: 800, color: 'var(--white)', fontSize: '1rem' }}>SeenFit Score</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--dim)', marginTop: '.2rem' }}>{out.confidence_label} confidence ({pct(out.confidence)})</div>
          </div>
        </div>
        <p style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--sub)', lineHeight: 1.6, marginTop: '.85rem' }}>{out.explanation.summary}</p>
      </Card>

      <Card>
        {kicker('Coverage breakdown')}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.65rem' }}>
          {metrics.map((m) => (
            <div key={m.label}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '.25rem' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--sub)' }}>{m.label}</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--white)' }}>{pct(m.raw)}</span>
              </div>
              <div style={{ height: 5, background: 'var(--raised)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, m.raw * 100)}%`, height: '100%', background: scoreColor(m.raw * 100) }} />
              </div>
            </div>
          ))}
        </div>
      </Card>

      {out.matched_requirements.length > 0 && (
        <Card>
          {kicker('Why you match', 'var(--green)')}
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
            {out.matched_requirements.slice(0, 8).map((m, i) => (
              <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '.5rem', fontSize: '.78rem', color: 'var(--sub)', lineHeight: 1.5 }}>
                <span style={{ color: 'var(--green)', fontSize: '.6rem', marginTop: '.2rem', flexShrink: 0 }}>✓</span>
                <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}><strong style={{ color: 'var(--white)' }}>{m.surface}</strong>{m.via === 'related' ? ' (transferable)' : ''}{m.evidence ? ` — ${m.evidence.slice(0, 90)}` : ''}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {out.unsupported_requirements.length > 0 && (
        <Card>
          {kicker('Missing requirements', 'var(--red)')}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.35rem' }}>
            {out.unsupported_requirements.slice(0, 10).map((m, i) => <span key={i}>{chip(m.surface, 'var(--red)', 'var(--rdim)', '#ff3b5c20')}</span>)}
          </div>
        </Card>
      )}

      <Card>
        {kicker('Company hiring risk')}
        <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', marginBottom: out.risk_flags.length ? '.7rem' : 0 }}>
          <span style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: '1.1rem', color: scoreColor(out.company_process_score) }}>{Math.round(out.company_process_score)}<span style={{ fontSize: '.6rem', color: 'var(--muted)' }}>/100</span></span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--muted)' }}>hiring-process score (real applicant outcomes)</span>
        </div>
        {out.risk_flags.length > 0 ? (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
            {out.risk_flags.map((f, i) => (
              <li key={i} style={{ display: 'flex', gap: '.5rem', fontSize: '.72rem', color: f.severity === 'high' ? 'var(--red)' : f.severity === 'medium' ? 'var(--amber)' : 'var(--muted)', lineHeight: 1.5 }}>
                <span style={{ flexShrink: 0 }}>{f.severity === 'high' ? '✕' : '⚠'}</span>{f.message}
              </li>
            ))}
          </ul>
        ) : intel && intel.report_count ? (
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: '#7cb3ff', lineHeight: 1.6 }}>
            📊 Seen data on {jobCompany}: {Math.round((intel.ghost_rate || 0) * 100)}% ghost · {Math.round((intel.response_rate || 0) * 100)}% respond{intel.overall_score != null ? ` · grade ${Math.round(intel.overall_score)}/100` : ''}.
          </div>
        ) : (
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--green)' }}>No risk flags — clean signals for this role.</div>
        )}
      </Card>

      {insights && insights.what_they_want.length > 0 && (
        <Card>
          {kicker(`What ${jobCompany || 'they'} really wants`)}
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
            {insights.what_they_want.slice(0, 6).map((it, i) => (
              <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '.5rem', fontSize: '.78rem', color: 'var(--sub)', lineHeight: 1.5 }}>
                <span style={{ color: 'var(--green)', fontSize: '.55rem', marginTop: '.22rem', flexShrink: 0 }}>▶</span><span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{it}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

// ═══ REWRITE TAB — deliverables (safe bullets, keywords, confirm, message) ═══
function RewriteView({ out, copy, copied }: { out: OptimizerOutput; copy: (t: string, k: string) => void; copied: string | null }) {
  return (
    <div style={{ animation: 'fadeUp .3s ease both' }}>
      {out.missing_keywords.length > 0 && (
        <Card>
          {kicker('Keywords to include (only if genuinely yours)', 'var(--amber)')}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.35rem' }}>
            {out.missing_keywords.map((k, i) => <span key={i}>{chip(k, 'var(--amber)', 'rgba(245,158,11,.08)', 'rgba(245,158,11,.25)')}</span>)}
          </div>
        </Card>
      )}

      {out.safe_bullets.length > 0 ? (
        <Card>
          {kicker('Safe résumé bullets', 'var(--green)')}
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--green)', marginBottom: '.6rem' }}>✓ Fully backed by your résumé — no invented numbers, tools, or claims.</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.55rem' }}>
            {out.safe_bullets.map((b, i) => (
              <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, padding: '.7rem .85rem', display: 'flex', gap: '.6rem', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '.78rem', color: 'var(--sub)', lineHeight: 1.6, flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{b.text}</span>
                <button onClick={() => copy(b.text, `sb${i}`)} style={{ background: 'none', border: '1px solid var(--line2)', borderRadius: 6, padding: '.25rem .5rem', fontFamily: 'var(--mono)', fontSize: '.55rem', color: copied === `sb${i}` ? 'var(--green)' : 'var(--muted)', cursor: 'pointer', flexShrink: 0 }}>{copied === `sb${i}` ? '✓' : 'copy'}</button>
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <Card><div style={{ fontFamily: 'var(--mono)', fontSize: '.7rem', color: 'var(--muted)', lineHeight: 1.6 }}>No safe automatic rewrites for this résumé — add bullets that map to the missing requirements, each with a real number.</div></Card>
      )}

      {out.confirm_before_using.length > 0 && (
        <Card>
          {kicker('⚠ Confirm before using', 'var(--amber)')}
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--amber)', marginBottom: '.6rem', lineHeight: 1.5 }}>These need a real number/detail from you. We will not invent it.</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.55rem' }}>
            {out.confirm_before_using.map((c, i) => (
              <div key={i} style={{ background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.2)', borderRadius: 8, padding: '.7rem .85rem' }}>
                <div style={{ fontSize: '.76rem', color: 'var(--sub)', lineHeight: 1.6, overflowWrap: 'anywhere' }}>{c.text}</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--muted)', marginTop: '.35rem' }}>{c.reason}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {out.application_message && (
        <Card>
          {kicker('Application message')}
          <p style={{ fontSize: '.78rem', color: 'var(--sub)', lineHeight: 1.7, margin: 0, overflowWrap: 'anywhere' }}>{out.application_message}</p>
          <button onClick={() => copy(out.application_message, 'msg')} style={{ marginTop: '.75rem', background: 'var(--green)', color: 'var(--ink)', border: 'none', borderRadius: 7, padding: '.45rem .9rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.7rem', cursor: 'pointer' }}>{copied === 'msg' ? '✓ Copied' : 'Copy message'}</button>
        </Card>
      )}
    </div>
  )
}

// ═══ STRATEGY — playbook views (reused) ═══
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
        <Card key={s.title}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.65rem', marginBottom: '.65rem' }}>
            <div style={{ width: 28, height: 28, borderRadius: 7, background: 'var(--gdim)', border: '1px solid var(--gmid)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.85rem', flexShrink: 0 }}>{s.icon}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--display)', fontSize: '.82rem', fontWeight: 700, color: 'var(--white)' }}>{s.title}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--muted)' }}>{s.label}</div>
            </div>
          </div>
          <div style={{ fontSize: '.8rem', color: 'var(--sub)', lineHeight: 1.75, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{s.content}</div>
        </Card>
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
      {d.opening_note && <div style={{ fontFamily: 'var(--mono)', fontSize: '.72rem', color: 'var(--sub)', marginBottom: '1rem', padding: '.75rem 1rem', background: 'var(--raised)', borderRadius: 8, overflowWrap: 'anywhere' }}>{d.opening_note}</div>}
      {phases.filter(p => p.content).map(p => (
        <Card key={p.label}>
          {kicker(p.label, p.color)}
          <div style={{ fontSize: '.82rem', color: 'var(--sub)', lineHeight: 1.75, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{p.content}</div>
        </Card>
      ))}
    </div>
  )
}

function ResultEmpty({ icon, text }: { icon: string; text: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 220, color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.72rem', textAlign: 'center', gap: '.75rem', whiteSpace: 'pre-line' }}>
      <div style={{ fontSize: '2.5rem' }}>{icon}</div>
      <div>{text}</div>
    </div>
  )
}

function ResumeInput({ resumeText, setResumeText, resumeMeta, onUpload, onClear, onFileDrop }: {
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.4rem', flexWrap: 'wrap', gap: '.4rem' }}>
        {label('Your resume')}
        <div style={{ display: 'flex', gap: '.5rem' }}>
          <button onClick={() => fileRef.current?.click()} style={{ background: 'none', border: '1px solid var(--line2)', color: 'var(--dim)', borderRadius: 6, padding: '.25rem .65rem', fontFamily: 'var(--mono)', fontSize: '.6rem', cursor: 'pointer' }}>Upload PDF/Word/txt</button>
          {resumeText && <button onClick={onClear} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.6rem', cursor: 'pointer' }}>Clear</button>}
        </div>
        <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.txt,.md,text/plain" onChange={onUpload} style={{ display: 'none' }} />
      </div>
      {resumeMeta ? (
        <div style={{ background: 'var(--gdim)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 8, padding: '.72rem 1rem', fontFamily: 'var(--mono)', fontSize: '.68rem', color: 'var(--green)', marginBottom: '.75rem', overflowWrap: 'anywhere' }}>
          ✓ résumé on file — {resumeMeta.fileName} · {resumeMeta.wordCount} words
        </div>
      ) : (
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f) onFileDrop(f) }}
          style={{ border: isDragging ? '2px dashed var(--blue)' : '2px dashed var(--line2)', background: isDragging ? 'rgba(59,130,246,0.05)' : 'transparent', borderRadius: 8, transition: 'all .15s' }}
        >
          <textarea placeholder="Paste your resume text here, or drag & drop a PDF/Word/txt file..." value={resumeText} onChange={e => setResumeText(e.target.value)} rows={8} style={{ ...areaStyle, border: 'none', background: 'transparent' }} />
        </div>
      )}
    </div>
  )
}

function ResumePageInner() {
  const { isLoggedIn, user } = useAuth()
  const params = useSearchParams()

  const [resumeText, setResumeText] = useState('')
  const [resumeMeta, setResumeMeta] = useState<{ fileName: string; wordCount: number } | null>(null)

  const [jobTitle, setJobTitle] = useState(params?.get('role') ?? '')
  const [jobCompany, setJobCompany] = useState(params?.get('company') ?? '')
  const [jobJD, setJobJD] = useState('')
  const [jobUrl, setJobUrl] = useState('')
  const [background, setBackground] = useState('')
  const [companyIntel, setCompanyIntel] = useState<CompanyIntel | null>(null)

  const [savedJobs, setSavedJobs] = useState<SavedJob[]>([])
  const [savedId, setSavedId] = useState('')
  const [showManual, setShowManual] = useState(false)

  const [analyzed, setAnalyzed] = useState(false)
  const [tab, setTab] = useState<Tab>('fit')
  const [error, setError] = useState('')

  // Fit / SeenFit (anchor analysis)
  const [fitOut, setFitOut] = useState<OptimizerOutput | null>(null)
  const [fitState, setFitState] = useState<'idle' | 'loading' | 'done' | 'error' | 'disabled'>('idle')
  const [fitErrRef, setFitErrRef] = useState('') // server error ref for a failed optimize (traceable in api_errors)
  const [v2Rerunning, setV2Rerunning] = useState(false) // "Improve this result" re-score in flight

  // HumanProof
  const [hp, setHp] = useState<HumanProofResult | null>(null)
  const [hpState, setHpState] = useState<'idle' | 'loading' | 'done' | 'locked' | 'error'>('idle')

  // Strategy: job-insights + advantage
  const [insights, setInsights] = useState<Insights | null>(null)
  const [advResult, setAdvResult] = useState<CombinedResult | null>(null)
  const [advState, setAdvState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')

  const [copied, setCopied] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [emailState, setEmailState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [emailAddr, setEmailAddr] = useState('')

  const [showUpgrade, setShowUpgrade] = useState(false)
  const [upgradeReason, setUpgradeReason] = useState<'credits' | 'generic' | 'pro'>('credits')
  const [upgradeFeature, setUpgradeFeature] = useState<string | undefined>(undefined)
  const [showSurvey, setShowSurvey] = useState(false)
  const [pro, setPro] = useState<boolean | null>(null)
  const [upsellDismissed, setUpsellDismissed] = useState(false)

  useEffect(() => { setEmailAddr(user?.email ?? '') }, [user?.email])

  useEffect(() => {
    if (!isLoggedIn) { setPro(null); return }
    let cancelled = false
    aiHeaders()
      .then(h => fetch('/api/user-sync', { method: 'POST', headers: h, body: JSON.stringify({ action: 'get_credits' }) }))
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d) setPro(!!d.pro) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [isLoggedIn, user?.id])

  useEffect(() => {
    ResumeStore.load(user?.id, isLoggedIn).then(data => {
      if (data) { setResumeMeta({ fileName: data.fileName, wordCount: data.wordCount }); setResumeText(data.text) }
    })
  }, [user?.id, isLoggedIn])

  useEffect(() => { SavedJobsStore.load(isLoggedIn).then(setSavedJobs).catch(() => {}) }, [isLoggedIn])
  useEffect(() => { if (jobCompany.trim()) fetchIntel(jobCompany) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Open the survey when the UpgradeModal's "earn credits" link fires.
  useEffect(() => {
    const h = () => setShowSurvey(true)
    window.addEventListener('seen:open-survey', h)
    return () => window.removeEventListener('seen:open-survey', h)
  }, [])

  async function fetchIntel(company: string) {
    setCompanyIntel(null)
    if (!company.trim()) return
    try {
      const r = await fetch(`/api/reports?type=company&name=${encodeURIComponent(company.trim())}`)
      const d = await r.json().catch(() => ({})) as { stats?: CompanyIntel }
      if (d.stats && (d.stats.report_count || 0) > 0) setCompanyIntel(d.stats)
    } catch { /* no intel */ }
  }

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
    setJobUrl(snap?.apply_url || '')
    setShowManual(false)
    setError('')
    fetchIntel(co)
  }

  // Stable jobId for optimizer/job-insights caching (saved id if present, else a manual key).
  function jobIdFor(): string {
    if (savedId) return savedId
    const slug = (s: string) => encodeURIComponent(String(s || '').toLowerCase().trim().replace(/\s+/g, '-')).slice(0, 60)
    return `manual-${slug(jobCompany)}-${slug(jobTitle)}` || 'manual'
  }

  async function uploadFile(file: File) {
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const b64 = (ev.target?.result as string).split(',')[1]
      try {
        const res = await fetch('/api/resume', { method: 'POST', headers: await aiHeaders(), body: JSON.stringify({ action: 'parse', base64: b64, fileName: file.name, mimeType: file.type }) })
        const data = await res.json() as { text?: string; credits_required?: boolean; error?: string }
        if (data.credits_required) {
          if (isLoggedIn) { setUpgradeReason('credits'); setUpgradeFeature(undefined); setShowUpgrade(true) }
          else setError('Sign in to use AI resume features.')
          return
        }
        if (data.text) {
          window.dispatchEvent(new Event('seen:credits-updated'))
          const wc = data.text.trim().split(/\s+/).length
          await ResumeStore.save(data.text, file.name, wc, user?.id, isLoggedIn)
          setResumeText(data.text); setResumeMeta({ fileName: file.name, wordCount: wc }); setError('')
        } else {
          setError(data.error || 'Could not read this file. Paste your résumé text into the box instead.')
        }
      } catch { setError('Failed to parse file. Try pasting text instead.') }
    }
    reader.readAsDataURL(file)
  }
  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) { const f = e.target.files?.[0]; if (f) await uploadFile(f) }
  function clearResume() { ResumeStore.clear(user?.id, isLoggedIn); setResumeText(''); setResumeMeta(null) }

  // ── ANALYZE — the one action. Runs the free deterministic SeenFit engine, then loads
  //    read-only insights. HumanProof + Strategy stay on-demand (credit/Pro-gated). ──
  async function analyze() {
    if (!resumeText.trim() || resumeText.trim().length < 40) { setError('Add your résumé first (paste or upload).'); return }
    if (!jobTitle.trim() && !jobJD.trim()) { setError('Add the job — pick a saved job, or enter a title / paste a description.'); setShowManual(true); return }
    setError('')
    // Persist a pasted résumé so every surface (and future sessions) can reuse it.
    if (!resumeMeta && resumeText.trim().length >= 40) {
      const wc = resumeText.trim().split(/\s+/).length
      ResumeStore.save(resumeText, 'Pasted résumé', wc, user?.id, isLoggedIn).catch(() => {})
      setResumeMeta({ fileName: 'Pasted résumé', wordCount: wc })
    }
    setAnalyzed(true)
    setTab('fit')
    // Reset downstream tabs so they re-run against the new inputs.
    setHp(null); setHpState('idle'); setAdvResult(null); setAdvState('idle')
    await runFit()
    loadInsights()
  }

  async function runFit(confirmedAnswers?: ConfirmedAnswer[]) {
    setFitState('loading'); setFitErrRef('')
    try {
      const res = await fetch('/api/optimizer', {
        method: 'POST', headers: await aiHeaders(),
        body: JSON.stringify({
          action: 'optimize', resumeText, jobId: jobIdFor(), jobTitle, company: jobCompany, jobDescription: jobJD, remoteOk: /remote/i.test(jobJD),
          ...(confirmedAnswers?.length ? { confirmed_answers: confirmedAnswers } : {}),
        }),
      })
      if (res.status === 403) { setFitState('disabled'); return }
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) { setFitErrRef(data?.ref || ''); setFitState('error'); return }
      setFitOut(data as OptimizerOutput); setFitState('done')
    } catch { setFitState('error') }
  }

  // "Improve this result": fold the user's confirmed answers back into the V2 engine and
  // re-score. The optimize action is free (deterministic, no credit) — safe to re-run.
  async function rerunV2WithAnswers(answers: ConfirmedAnswer[]) {
    if (!answers.length) return
    setV2Rerunning(true)
    try {
      const res = await fetch('/api/optimizer', {
        method: 'POST', headers: await aiHeaders(),
        body: JSON.stringify({ action: 'optimize', resumeText, jobId: jobIdFor(), jobTitle, company: jobCompany, jobDescription: jobJD, remoteOk: /remote/i.test(jobJD), confirmed_answers: answers }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && !data.error) setFitOut(data as OptimizerOutput)
    } catch { /* keep the prior result on failure */ }
    setV2Rerunning(false)
  }

  // Read-only insights: DB cache is free; a fresh generation costs 1 credit (surfaced honestly).
  async function loadInsights() {
    if (!jobJD || jobJD.length < 80) { setInsights(null); return }
    try {
      const res = await fetch('/api/job-insights', {
        method: 'POST', headers: await aiHeaders(),
        body: JSON.stringify({ jobId: jobIdFor(), job: jobTitle, company: jobCompany, jobDescription: jobJD, needsSummary: true }),
      })
      const d = await res.json()
      if (d.credits_required) return // silent — insights are a bonus, not a wall here
      if (d._src === 'generated') window.dispatchEvent(new Event('seen:credits-updated'))
      if (d.what_they_want?.length || d.insider_tip) setInsights(d)
    } catch { /* insights are best-effort */ }
  }

  async function runHumanProof() {
    if (!fitOut?.safe_bullets?.length) { setError('Run the fit analysis first — HumanProof works on your safe bullets.'); return }
    setHpState('loading'); setError('')
    try {
      const res = await fetch('/api/optimizer', {
        method: 'POST', headers: await aiHeaders(),
        body: JSON.stringify({
          action: 'humanize',
          bullets: fitOut.safe_bullets.map(b => b.text),
          applicationMessage: fitOut.application_message || undefined,
          warnings: fitOut.confirm_before_using.map(c => ({ phrase: c.placeholder, warning: c.reason || c.text })),
          jobId: jobIdFor(), jobTitle, company: jobCompany, jobDescription: jobJD, resumeText,
        }),
      })
      if (res.status === 403) { setHpState('error'); return }
      const data = await res.json().catch(() => ({}))
      if ((res.status === 402 || data.locked) && (data.pro_required || data.credits_required)) { setHpState('locked'); return }
      if (!res.ok || data.error || !data.package) { setHpState('error'); return }
      window.dispatchEvent(new Event('seen:credits-updated'))
      setHp(data as HumanProofResult); setHpState('done')
    } catch { setHpState('error') }
  }

  async function runAdvantage() {
    if (!jobTitle.trim() || !jobCompany.trim()) { setError('Advantage needs the job title + company.'); setShowManual(true); return }
    if (!jobJD.trim()) { setError('Advantage needs a job description — pick a saved job or paste one.'); setShowManual(true); return }
    setAdvState('loading'); setError('')
    try {
      const res = await fetch('/api/resume', {
        method: 'POST', headers: await aiHeaders(),
        body: JSON.stringify({ tool: 'advantage', resume: resumeText, job: jobTitle, company: jobCompany, jobDescription: jobJD, background, companyIntel }),
      })
      const data = await res.json().catch(() => ({})) as { credits_required?: boolean } & CombinedResult
      if (data.credits_required) {
        if (isLoggedIn) { setUpgradeReason('credits'); setUpgradeFeature(undefined); setShowUpgrade(true); setAdvState('idle') }
        else { setError('Sign in to use AI resume features.'); setAdvState('idle') }
        return
      }
      if (!res.ok) { setAdvState('error'); return }
      window.dispatchEvent(new Event('seen:credits-updated'))
      setAdvResult(data); setAdvState('done')
    } catch { setAdvState('error') }
  }

  async function copy(text: string, key: string) {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(null), 1600) } catch { /* ignore */ }
  }

  // ── Export helpers ──
  function finalBullets(): string[] {
    if (hp?.package?.bullets?.length) return hp.package.bullets.map(b => b.humanized_text)
    return (fitOut?.safe_bullets || []).map(b => b.text)
  }
  function finalMessage(): string { return hp?.package?.application_message?.humanized_text || fitOut?.application_message || '' }
  function confirmList(): string[] {
    if (hp?.package) {
      const carried = (hp.package.carried_warnings || []).map(w => w.warning).filter(Boolean)
      const perItem = hp.package.bullets.flatMap(b => (b.confirm_before_using || []).map(c => c.text))
      return Array.from(new Set([...carried, ...perItem])).filter(Boolean)
    }
    return (fitOut?.confirm_before_using || []).map(c => c.text)
  }
  function packageText(): string {
    const lines: string[] = [`${jobTitle}${jobCompany ? ' — ' + jobCompany : ''}`]
    if (fitOut) lines.push(`SeenFit match: ${fitOut.fit_score}/100`)
    lines.push('', 'OPTIMIZED BULLETS' + (hp ? ' (HumanProof)' : ''))
    for (const b of finalBullets()) lines.push(`• ${b}`)
    const msg = finalMessage()
    if (msg) { lines.push('', 'APPLICATION MESSAGE', msg) }
    const conf = confirmList()
    if (conf.length) { lines.push('', 'CONFIRM BEFORE USING — only include if true, add the real detail first:'); for (const c of conf) lines.push(`⚠ ${c}`) }
    return lines.join('\n')
  }

  async function downloadResume() {
    if (!resumeText.trim()) { setError('Add your résumé first.'); return }
    setDownloading(true); setError('')
    try {
      const res = await fetch('/api/resume', {
        // Auth header lets the server identify Pro users → clean, unwatermarked résumé.
        // Signed-out callers send no token and get the free-tier "seenjobs.io" footer.
        method: 'POST', headers: await aiHeaders(),
        body: JSON.stringify({
          action: 'download_resume', resume: resumeText, job: jobTitle, company: jobCompany, jobDescription: jobJD,
          optimizedBullets: (fitOut?.safe_bullets || []).map(b => b.text),
          humanproofBullets: hp ? hp.package.bullets.map(b => b.humanized_text) : undefined,
          confirmWarnings: confirmList(),
          applicationMessage: finalMessage() || undefined,
          fitScore: fitOut?.fit_score ?? undefined,
          jobTitle,
        }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})) as { error?: string }; setError(d.error || 'Could not build your résumé PDF.'); setDownloading(false); return }
      const blob = await res.blob()
      const cleanName = (resumeText.split(/\r?\n/).map(l => l.trim()).find(Boolean) || '').replace(/[^\w .'-]/g, '').trim()
      const cleanRole = jobTitle.replace(/[^\w .,'/&-]/g, '').trim()
      const looksLikeName = /^[A-Z][\w.'-]*(\s+[A-Z][\w.'-]*){1,3}$/.test(cleanName)
      const fileName = looksLikeName && cleanRole ? `${cleanName} — ${cleanRole} Resume.pdf` : looksLikeName ? `${cleanName} — Resume.pdf` : cleanRole ? `${cleanRole} Resume.pdf` : 'Seen Resume.pdf'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch { setError('Could not build your résumé PDF. Please try again.') }
    setDownloading(false)
  }

  async function emailPackage() {
    if (!emailAddr.trim()) return
    if (!jobCompany.trim() || !jobTitle.trim()) { setError('Add the job title + company to email your package.'); return }
    setEmailState('sending')
    try {
      await fetch('/api/resume', {
        method: 'POST', headers: await aiHeaders(),
        body: JSON.stringify({
          action: 'email_analysis', email: emailAddr.trim(), co: jobCompany, role: jobTitle,
          ...(jobUrl ? { jobUrl } : {}),
          bullets: [], keywords: (fitOut?.missing_keywords || []).slice(0, 12),
          optimizedBullets: (fitOut?.safe_bullets || []).map(b => b.text),
          humanproofBullets: hp ? hp.package.bullets.map(b => b.humanized_text) : undefined,
          confirmWarnings: confirmList(),
          applicationMessage: finalMessage() || undefined,
          fitScore: fitOut?.fit_score ?? undefined,
          jobTitle, company: jobCompany,
          resume: resumeText, jobDescription: jobJD,
        }),
      })
      setEmailState('sent')
    } catch { setEmailState('idle') }
  }

  const trackHref = `/apply?co=${encodeURIComponent(jobCompany)}&role=${encodeURIComponent(jobTitle)}${jobUrl ? `&jobUrl=${encodeURIComponent(jobUrl)}` : ''}`
  const reportHref = `/report?company=${encodeURIComponent(jobCompany)}&role=${encodeURIComponent(jobTitle)}`

  const hasV2 = !!fitOut?.application_intelligence
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'fit', label: '🎯 Fit' },
    ...(hasV2 ? [{ id: 'intel' as Tab, label: '🧬 Deep Dive' }] : []),
    { id: 'rewrite', label: '✍️ Rewrite' },
    { id: 'humanproof', label: '🗣 HumanProof' },
    { id: 'strategy', label: '🧠 Strategy' },
    { id: 'export', label: '📤 Export' },
  ]

  return (
    <div className="page-full">
      {showUpgrade && <UpgradeModal reason={upgradeReason} featureName={upgradeFeature} onClose={() => setShowUpgrade(false)} />}
      {showSurvey && <ResumeSurveyModal onClose={() => setShowSurvey(false)} />}
      <div className="resume-page">
        <div className="resume-hdr">
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase', letterSpacing: '.22em', color: 'var(--blue)', marginBottom: '.6rem', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 22, height: 1, background: 'var(--blue)', display: 'inline-block' }} />
            Application Intelligence
          </div>
          <h1 style={{ fontFamily: 'var(--display)', fontSize: '2rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.03em', marginBottom: '.3rem' }}>Win this application</h1>
          <p style={{ color: 'var(--sub)', fontSize: '.85rem', fontWeight: 300 }}>
            One résumé, one job — your fit score, safe rewrites, a human-sounding pass, and the strategy to get through, sharpened with Seen&apos;s data on how this company actually treats applicants.
          </p>
        </div>

        {error && (
          <div style={{ background: 'var(--rdim)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, padding: '.72rem 1rem', fontFamily: 'var(--mono)', fontSize: '.72rem', color: 'var(--red)', marginBottom: '1rem', overflowWrap: 'anywhere' }}>{error}</div>
        )}

        {isLoggedIn && resumeText && (
          <div onClick={() => setShowSurvey(true)} style={{ background: 'linear-gradient(90deg, rgba(99,102,241,.1), rgba(124,58,237,.06))', border: '1px solid rgba(99,102,241,.22)', borderRadius: 10, padding: '.65rem 1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.75rem', cursor: 'pointer' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--indigo)', fontWeight: 600, marginBottom: '.12rem', display: 'flex', alignItems: 'center', gap: '.35rem' }}><span style={{ fontSize: '.7rem' }}>✦</span>Earn AI credits — 60-second résumé survey</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--sub)', overflowWrap: 'anywhere' }}>Share what it was like applying to a company from your résumé — +2 credits</div>
            </div>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--indigo)', flexShrink: 0 }}>Start →</span>
          </div>
        )}

        <div className="resume-layout">
          {/* Left: inputs */}
          <div>
            <ResumeInput resumeText={resumeText} setResumeText={setResumeText} resumeMeta={resumeMeta} onUpload={handleUpload} onFileDrop={uploadFile} onClear={clearResume} />

            <div style={{ marginTop: '1rem' }}>
              {label('Which job?')}
              {savedJobs.length > 0 ? (
                <select value={savedId} onChange={e => pickSavedJob(e.target.value)} style={{ ...inputStyle, fontFamily: 'var(--body)', cursor: 'pointer' }}>
                  <option value="">📌 Choose a saved job…</option>
                  {savedJobs.map(s => <option key={String(s.job_id)} value={String(s.job_id)}>{(s.role || 'Role')}{s.company ? ' — ' + s.company : ''}</option>)}
                </select>
              ) : (
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--muted)', marginBottom: '.6rem', lineHeight: 1.6 }}>No saved jobs yet — save jobs from search, or enter the details below.</div>
              )}

              {savedId && !showManual && (
                <div style={{ background: 'var(--gdim)', border: '1px solid var(--gmid)', borderRadius: 8, padding: '.6rem .85rem', fontFamily: 'var(--mono)', fontSize: '.66rem', color: 'var(--green)', marginBottom: '.6rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>✓ {jobTitle}{jobCompany ? ' · ' + jobCompany : ''}</span>
                  <button onClick={() => setShowManual(true)} style={{ background: 'none', border: 'none', color: 'var(--green)', fontFamily: 'var(--mono)', fontSize: '.6rem', cursor: 'pointer', textDecoration: 'underline', flexShrink: 0 }}>edit</button>
                </div>
              )}

              {companyIntel && (
                <div style={{ background: 'rgba(59,130,246,0.07)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: 8, padding: '.55rem .8rem', fontFamily: 'var(--mono)', fontSize: '.6rem', color: '#7cb3ff', marginBottom: '.6rem', lineHeight: 1.6, overflowWrap: 'anywhere' }}>
                  📊 Seen data on {jobCompany}: {Math.round((companyIntel.ghost_rate || 0) * 100)}% ghost · {Math.round((companyIntel.response_rate || 0) * 100)}% respond{companyIntel.overall_score != null ? ` · grade ${Math.round(companyIntel.overall_score)}/100` : ''}.
                </div>
              )}

              <button onClick={() => setShowManual(v => !v)} style={{ background: 'none', border: '1px solid var(--line2)', color: 'var(--dim)', borderRadius: 6, padding: '.4rem .8rem', fontFamily: 'var(--mono)', fontSize: '.62rem', cursor: 'pointer', marginBottom: (showManual || savedJobs.length === 0) ? '.75rem' : '1rem' }}>
                {showManual ? '▲ Hide manual entry' : '✎ Enter job info manually'}
              </button>

              {(showManual || savedJobs.length === 0) && (
                <div>
                  {label('Job title')}
                  <input type="text" placeholder="e.g. Engineering Manager" value={jobTitle} onChange={e => setJobTitle(e.target.value)} style={inputStyle} />
                  {label('Company')}
                  <input type="text" placeholder="e.g. Notion" value={jobCompany} onChange={e => setJobCompany(e.target.value)} onBlur={() => fetchIntel(jobCompany)} style={inputStyle} />
                  {label('Job URL (optional)')}
                  <input type="url" placeholder="https://…" value={jobUrl} onChange={e => setJobUrl(e.target.value)} style={inputStyle} />
                  {label('Job description')}
                  <textarea placeholder="Paste the job description..." value={jobJD} onChange={e => setJobJD(e.target.value)} rows={4} style={{ ...areaStyle, marginBottom: '.75rem' }} />
                  {label('Your background (for Strategy) — optional')}
                  <textarea placeholder="What draws you to this role? Any unique experience?" value={background} onChange={e => setBackground(e.target.value)} rows={3} style={{ ...areaStyle, marginBottom: '.75rem' }} />
                </div>
              )}

              <button style={{ ...btnPrimary, opacity: fitState === 'loading' ? 0.6 : 1, cursor: fitState === 'loading' ? 'not-allowed' : 'pointer' }} onClick={analyze} disabled={fitState === 'loading'}>
                {fitState === 'loading' ? 'Analyzing…' : analyzed ? 'Re-analyze →' : 'Analyze my application →'}
                <span style={{ marginLeft: '.5rem', fontSize: '.55rem', opacity: .65, fontFamily: 'var(--mono)', fontWeight: 400 }}>· free</span>
              </button>
            </div>
          </div>

          {/* Right: output */}
          <div>
            {!analyzed ? (
              <ResultEmpty icon="🎯" text={'Your fit score, safe rewrites, a human-sounding pass,\nand the strategy to get through appear here.'} />
            ) : (
              <>
                <div className="ai-tabs" role="tablist">
                  {tabs.map(t => (
                    <button key={t.id} role="tab" aria-selected={tab === t.id} className={`ai-tab${tab === t.id ? ' active' : ''}`} onClick={() => { setTab(t.id); setError('') }}>{t.label}</button>
                  ))}
                </div>

                {/* FIT */}
                {tab === 'fit' && (
                  fitState === 'loading' ? <ResultEmpty icon="⏳" text={'Scoring your fit…'} />
                  : fitState === 'disabled' ? <ResultEmpty icon="🚧" text={'SeenFit is temporarily unavailable.'} />
                  : fitState === 'error' ? <div><ResultEmpty icon="⚠️" text={'Could not score your fit. Try again.'} />{fitErrRef && <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--dim)', marginTop: '.35rem' }}>Error ref: {fitErrRef} — share this if it keeps happening.</div>}<button onClick={() => runFit()} style={{ ...btnPrimary, marginTop: '.5rem' }}>Retry</button></div>
                  : fitOut ? <FitView out={fitOut} intel={companyIntel} jobCompany={jobCompany} insights={insights} /> : null
                )}

                {/* DEEP DIVE — Application Intelligence V2 (only present when the engine returns it) */}
                {tab === 'intel' && (
                  fitState === 'loading' ? <ResultEmpty icon="⏳" text={'Building your deep match analysis…'} />
                  : fitOut?.application_intelligence
                    ? <ApplicationIntelligencePanel pkg={fitOut.application_intelligence} onAnswers={rerunV2WithAnswers} rerunning={v2Rerunning} />
                    : <ResultEmpty icon="🧬" text={'Run the analysis to see the deep match breakdown.'} />
                )}

                {/* REWRITE */}
                {tab === 'rewrite' && (
                  fitState === 'loading' ? <ResultEmpty icon="⏳" text={'Preparing your rewrites…'} />
                  : fitOut ? <RewriteView out={fitOut} copy={copy} copied={copied} /> : <ResultEmpty icon="✍️" text={'Run the analysis to get safe, grounded rewrites.'} />
                )}

                {/* HUMANPROOF */}
                {tab === 'humanproof' && (
                  <div style={{ animation: 'fadeUp .3s ease both' }}>
                    {hpState === 'idle' && (
                      <Card>
                        <div style={{ fontFamily: 'var(--display)', fontWeight: 800, color: 'var(--white)', fontSize: '.95rem', marginBottom: '.3rem' }}>HumanProof</div>
                        <p style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--sub)', lineHeight: 1.6, marginBottom: '.9rem' }}>
                          Make your optimized bullets read real — remove generic AI tone and keep them specific, natural, and interview-defensible. Nothing invented.
                        </p>
                        <button style={{ ...btnPrimary, background: 'linear-gradient(135deg,#10b981 0%,#3b82f6 100%)' }} onClick={runHumanProof}>Run HumanProof →</button>
                      </Card>
                    )}
                    {hpState === 'loading' && <ResultEmpty icon="🗣" text={'Making it sound real…'} />}
                    {hpState === 'error' && <div><ResultEmpty icon="⚠️" text={'Could not run HumanProof.'} /><button onClick={runHumanProof} style={{ ...btnPrimary, marginTop: '.5rem' }}>Retry</button></div>}
                    {hpState === 'locked' && (
                      <Card style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '1.5rem', marginBottom: '.5rem' }}>🔒</div>
                        <div style={{ fontFamily: 'var(--display)', fontWeight: 800, color: 'var(--white)', fontSize: '1rem', marginBottom: '.5rem' }}>Your application is optimized. Now make it sound real.</div>
                        <p style={{ fontFamily: 'var(--mono)', fontSize: '.66rem', color: 'var(--sub)', lineHeight: 1.65, marginBottom: '1.1rem' }}>Unlock HumanProof so it sounds specific &amp; natural, stays interview-defensible, and carries no unsupported claims.</p>
                        <button onClick={() => { setUpgradeReason('pro'); setUpgradeFeature('HumanProof'); setShowUpgrade(true) }} style={{ background: 'linear-gradient(135deg,#10b981 0%,#3b82f6 100%)', color: '#fff', border: 'none', borderRadius: 10, padding: '.75rem 1.5rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.85rem', cursor: 'pointer' }}>Unlock HumanProof</button>
                      </Card>
                    )}
                    {hpState === 'done' && hp && (
                      <>
                        <Card>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '.85rem' }}>
                            <div style={{ flexShrink: 0, width: 56, height: 56, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `3px solid ${scoreColor(hp.humanproof_score)}` }}>
                              <span style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: '1.2rem', color: scoreColor(hp.humanproof_score) }}>{hp.humanproof_score}</span>
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontFamily: 'var(--display)', fontWeight: 800, color: 'var(--white)', fontSize: '.9rem' }}>HumanProof score</div>
                              <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)' }}>{hp.ai_slop_risk} AI-slop risk · Before {hp.before_score} → After {hp.after_score}</div>
                            </div>
                          </div>
                        </Card>
                        <Card>
                          {kicker('Humanized bullets', 'var(--green)')}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '.55rem' }}>
                            {hp.package.bullets.map((b, i) => (
                              <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, padding: '.7rem .85rem', display: 'flex', gap: '.6rem', alignItems: 'flex-start' }}>
                                <span style={{ fontSize: '.78rem', color: 'var(--sub)', lineHeight: 1.6, flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{b.humanized_text}</span>
                                <button onClick={() => copy(b.humanized_text, `hb${i}`)} style={{ background: 'none', border: '1px solid var(--line2)', borderRadius: 6, padding: '.25rem .5rem', fontFamily: 'var(--mono)', fontSize: '.55rem', color: copied === `hb${i}` ? 'var(--green)' : 'var(--muted)', cursor: 'pointer', flexShrink: 0 }}>{copied === `hb${i}` ? '✓' : 'copy'}</button>
                              </div>
                            ))}
                          </div>
                        </Card>
                        {hp.package.application_message && (
                          <Card>
                            {kicker('Humanized application message')}
                            <p style={{ fontSize: '.78rem', color: 'var(--sub)', lineHeight: 1.7, margin: 0, overflowWrap: 'anywhere' }}>{hp.package.application_message.humanized_text}</p>
                            <button onClick={() => copy(hp.package.application_message!.humanized_text, 'hmsg')} style={{ marginTop: '.75rem', background: 'var(--green)', color: 'var(--ink)', border: 'none', borderRadius: 7, padding: '.45rem .9rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.7rem', cursor: 'pointer' }}>{copied === 'hmsg' ? '✓ Copied' : 'Copy message'}</button>
                          </Card>
                        )}
                        {confirmList().length > 0 && (
                          <Card>
                            {kicker('⚠ Confirm before using', 'var(--amber)')}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
                              {confirmList().map((c, i) => <div key={i} style={{ background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.2)', borderRadius: 8, padding: '.55rem .75rem', fontSize: '.72rem', color: 'var(--sub)', lineHeight: 1.5, overflowWrap: 'anywhere' }}>{c}</div>)}
                            </div>
                          </Card>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* STRATEGY */}
                {tab === 'strategy' && (
                  <div style={{ animation: 'fadeUp .3s ease both' }}>
                    {insights && (insights.what_they_want.length > 0 || insights.hidden_requirements.length > 0 || insights.insider_tip) && (
                      <Card>
                        {kicker(`What ${jobCompany || 'this company'} is hiring for`)}
                        {insights.what_they_want.length > 0 && (
                          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 .75rem', display: 'flex', flexDirection: 'column', gap: '.45rem' }}>
                            {insights.what_they_want.map((it, i) => <li key={i} style={{ display: 'flex', gap: '.5rem', fontSize: '.78rem', color: 'var(--sub)', lineHeight: 1.5 }}><span style={{ color: 'var(--green)', fontSize: '.55rem', marginTop: '.22rem', flexShrink: 0 }}>▶</span><span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{it}</span></li>)}
                          </ul>
                        )}
                        {insights.hidden_requirements.length > 0 && (
                          <>
                            {kicker('Unstated expectations', 'var(--red)')}
                            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 .75rem', display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
                              {insights.hidden_requirements.map((r, i) => <li key={i} style={{ display: 'flex', gap: '.5rem', fontSize: '.74rem', color: 'var(--muted)', lineHeight: 1.5 }}><span style={{ color: 'var(--red)', fontSize: '.5rem', marginTop: '.22rem', flexShrink: 0 }}>◆</span><span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{r}</span></li>)}
                            </ul>
                          </>
                        )}
                        {insights.insider_tip && <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 7, padding: '.65rem .9rem', fontSize: '.75rem', color: 'var(--sub)', lineHeight: 1.6, overflowWrap: 'anywhere' }}><span style={{ color: 'var(--green)', fontWeight: 700 }}>Tip: </span>{insights.insider_tip}</div>}
                      </Card>
                    )}

                    {advState === 'idle' && (
                      <Card>
                        <div style={{ fontFamily: 'var(--display)', fontWeight: 800, color: 'var(--white)', fontSize: '.95rem', marginBottom: '.3rem' }}>Advantage playbook + 30/60/90 plan</div>
                        <p style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--sub)', lineHeight: 1.6, marginBottom: '.9rem' }}>Hiring-manager outreach, timing, referral tactics and a 30/60/90-day plan, tuned with Seen&apos;s company data.</p>
                        <button style={btnPrimary} onClick={runAdvantage}>Build my advantage →<span style={{ marginLeft: '.5rem', fontSize: '.55rem', opacity: .65, fontFamily: 'var(--mono)', fontWeight: 400 }}>· 1 credit</span></button>
                      </Card>
                    )}
                    {advState === 'loading' && <ResultEmpty icon="🧠" text={'Building your advantage…'} />}
                    {advState === 'error' && <div><ResultEmpty icon="⚠️" text={'Could not build the advantage playbook.'} /><button onClick={runAdvantage} style={{ ...btnPrimary, marginTop: '.5rem' }}>Retry</button></div>}
                    {advState === 'done' && advResult && (<><CoachResultView d={advResult} /><ProposalResultView d={advResult} /></>)}
                  </div>
                )}

                {/* EXPORT */}
                {tab === 'export' && (
                  <div style={{ animation: 'fadeUp .3s ease both' }}>
                    <Card>
                      {kicker('Your final package')}
                      <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--sub)', lineHeight: 1.6, marginBottom: '.85rem' }}>
                        {finalBullets().length} bullet{finalBullets().length !== 1 ? 's' : ''}{hp ? ' (HumanProof)' : ''}{fitOut ? ` · SeenFit ${fitOut.fit_score}/100` : ''}{confirmList().length ? ` · ${confirmList().length} to confirm` : ''}
                      </div>
                      <div className="ai-btn-row" style={{ marginBottom: '.6rem' }}>
                        <button onClick={() => copy(packageText(), 'pkg')} style={{ padding: '.65rem', background: 'var(--raised)', border: '1px solid var(--line2)', color: copied === 'pkg' ? 'var(--green)' : 'var(--sub)', borderRadius: 9, fontFamily: 'var(--mono)', fontSize: '.68rem', cursor: 'pointer' }}>{copied === 'pkg' ? '✓ Copied' : 'Copy final package'}</button>
                        <button onClick={downloadResume} disabled={downloading} style={{ padding: '.65rem', background: 'var(--surface)', border: '1.5px solid var(--blue)', color: 'var(--blue)', borderRadius: 9, fontFamily: 'var(--mono)', fontSize: '.68rem', fontWeight: 700, cursor: downloading ? 'not-allowed' : 'pointer', opacity: downloading ? 0.6 : 1 }}>{downloading ? 'Building…' : '⬇ Download résumé PDF'}</button>
                      </div>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--muted)', lineHeight: 1.5 }}>The PDF is a complete, ATS-ready résumé built from your own text, with the optimized bullets as a clearly-marked appendix · free.</div>
                    </Card>

                    <Card>
                      {kicker('Email me this package')}
                      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                        <input type="email" value={emailAddr} onChange={e => setEmailAddr(e.target.value)} placeholder="your@email.com" style={{ flex: 1, minWidth: 160, background: 'var(--surface)', border: '1.5px solid rgba(16,185,129,0.3)', borderRadius: 8, padding: '.5rem .75rem', color: 'var(--white)', fontFamily: 'var(--mono)', fontSize: '.72rem', outline: 'none', boxSizing: 'border-box' }} />
                        <button onClick={emailPackage} disabled={emailState === 'sending' || emailState === 'sent' || !emailAddr.trim()} style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.4)', color: 'var(--green)', fontFamily: 'var(--mono)', fontSize: '.72rem', fontWeight: 600, padding: '.5rem .9rem', borderRadius: 8, cursor: 'pointer', opacity: (emailState === 'sending' || !emailAddr.trim()) ? 0.7 : 1 }}>{emailState === 'sent' ? '✓ Sent' : emailState === 'sending' ? 'Sending…' : 'Send →'}</button>
                      </div>
                      {emailState === 'sent' && <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--green)', marginTop: '.5rem' }}>✓ Check your email — the apply-tracking link is inside.</div>}
                    </Card>

                    <Card>
                      {kicker('Now apply — and get Seen')}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                        {jobUrl && <a href={jobUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'block', textAlign: 'center', ...btnPrimary, textDecoration: 'none', boxSizing: 'border-box' } as React.CSSProperties}>Continue to apply →</a>}
                        <a href={trackHref} style={{ display: 'block', textAlign: 'center', background: 'var(--green)', color: 'var(--ink)', borderRadius: 8, padding: '.7rem 1rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.8rem', textDecoration: 'none' }}>📌 Track this application</a>
                        <a href={reportHref} style={{ display: 'block', textAlign: 'center', background: 'none', border: '1px solid var(--line2)', color: 'var(--sub)', borderRadius: 8, padding: '.6rem 1rem', fontFamily: 'var(--mono)', fontSize: '.68rem', textDecoration: 'none' }}>Report what happened →</a>
                      </div>
                    </Card>
                  </div>
                )}

                {/* Post-win upsell */}
                {pro === false && !upsellDismissed && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', background: 'rgba(99,102,241,.08)', border: '1px solid rgba(99,102,241,.25)', borderRadius: 8, padding: '.5rem .6rem .5rem .85rem', marginTop: '.5rem' }}>
                    <button onClick={() => { setUpgradeReason('generic'); setUpgradeFeature(undefined); setShowUpgrade(true) }} style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'var(--body)', fontSize: '.68rem', color: 'var(--sub)', lineHeight: 1.5 }}>
                      Free gives you {FREE_DAILY_CREDITS} AI {CREDIT_WORD}/day · <span style={{ color: '#a5b4fc', fontWeight: 700 }}>Go Pro for unlimited →</span>
                    </button>
                    <button onClick={() => setUpsellDismissed(true)} aria-label="Dismiss" style={{ background: 'none', border: 'none', color: 'var(--dim)', cursor: 'pointer', fontSize: '.85rem', lineHeight: 1, padding: '.1rem .2rem', flexShrink: 0 }}>✕</button>
                  </div>
                )}
              </>
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
