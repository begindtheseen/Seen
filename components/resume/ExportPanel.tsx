'use client'

// Export panel — template picker, format buttons, paper/size options, the download call, and the
// ATS round-trip check (render → extract → parse → compare) that tells the candidate what a parser
// will actually read from the file they are about to upload.

import { useMemo, useState } from 'react'
import s from './studio.module.css'
import { aiHeaders } from '@/lib/aiHeaders'
import type { ResumeDoc, AtsCheck, FormatInfo } from '@/lib/resume/types'
import { listTemplates, renderText, renderMarkdown, formatRange } from '@/lib/resume/engine-client'
import { scoreColor } from './HealthPanel'

const FORMATS: FormatInfo[] = [
  { id: 'pdf', label: 'PDF', extension: 'pdf', templated: true, description: 'What you send. One column, real text, parses everywhere.' },
  { id: 'docx', label: 'Word', extension: 'docx', templated: true, description: 'For portals that want Word, and for editing in Word or Google Docs.' },
  { id: 'txt', label: 'Plain text', extension: 'txt', templated: false, description: 'For paste-into-a-box application forms.' },
  { id: 'md', label: 'Markdown', extension: 'md', templated: false, description: 'GitHub, Notion, email.' },
  { id: 'json', label: 'JSON Resume', extension: 'json', templated: false, description: 'The open schema — portable to any JSON Resume tool.' },
]

type Props = { doc: ResumeDoc; pro: boolean | null; isLoggedIn: boolean; onNeedPro: () => void; role?: string }

export default function ExportPanel({ doc, pro, isLoggedIn, onNeedPro, role }: Props) {
  const templates = useMemo(() => listTemplates(), [])
  const [template, setTemplate] = useState('classic')
  const [format, setFormat] = useState<FormatInfo['id']>('pdf')
  const [paper, setPaper] = useState<'letter' | 'a4'>('letter')
  const [scale, setScale] = useState<'0.92' | '1' | '1.06'>('1')
  const [busy, setBusy] = useState<'download' | 'ats' | null>(null)
  const [error, setError] = useState('')
  const [ats, setAts] = useState<AtsCheck | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  async function download() {
    setBusy('download'); setError('')
    try {
      const res = await fetch('/api/resume', { method: 'POST', headers: await aiHeaders(), body: JSON.stringify({ action: 'export', doc, format, template, paper, fontScale: Number(scale), role: role || undefined }) })
      if (!res.ok) { const d = (await res.json().catch(() => ({}))) as { error?: string }; setError(d.error || 'Could not build the file. Try again.'); setBusy(null); return }
      const blob = await res.blob()
      const cd = res.headers.get('Content-Disposition') || ''
      const m = cd.match(/filename\*=UTF-8''([^;]+)/)
      const name = m ? decodeURIComponent(m[1]) : `${doc.basics.name || 'Resume'}.${format}`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch { setError('Could not build the file. Please try again.') }
    setBusy(null)
  }

  async function runAts() {
    setBusy('ats'); setError(''); setAts(null)
    try {
      const res = await fetch('/api/resume', { method: 'POST', headers: await aiHeaders(), body: JSON.stringify({ action: 'ats_check', doc, format: format === 'docx' ? 'docx' : format === 'txt' ? 'txt' : 'pdf', template, paper, fontScale: Number(scale) }) })
      const d = (await res.json().catch(() => ({}))) as { check?: AtsCheck; error?: string }
      if (!res.ok || !d.check) { setError(d.error || 'The ATS check failed. Try again.'); setBusy(null); return }
      setAts(d.check)
    } catch { setError('The ATS check failed. Please try again.') }
    setBusy(null)
  }

  async function copy(kind: 'txt' | 'md') {
    try { await navigator.clipboard.writeText(kind === 'txt' ? renderText(doc) : renderMarkdown(doc)); setCopied(kind); setTimeout(() => setCopied(null), 1500) } catch { /* ignore */ }
  }

  const templated = format === 'pdf' || format === 'docx'
  return (
    <div style={{ animation: 'fadeUp .3s ease both' }}>
      <div className={s.card}>
        <div className={s.cardTitle}>Template</div>
        <p className={s.dim} style={{ marginBottom: '.7rem' }}>All three are one column, real text, standard headings — the structure every parser reads. They differ in typography only.</p>
        <div className={s.tpls}>
          {templates.map((t) => (
            <button key={t.id} type="button" className={`${s.tpl}${template === t.id ? ` ${s.tplActive}` : ''}`} onClick={() => setTemplate(t.id)} disabled={!templated}>
              <div className={s.tplName}><span className={s.swatch} style={{ background: t.accent === '#000000' ? '#9ca3af' : t.accent }} />{t.label}</div>
              <div className={s.tplTag}>{t.tagline}</div>
              <div className={s.preview} style={{ fontFamily: t.id === 'classic' ? 'Georgia, serif' : 'Arial, sans-serif', textAlign: t.header === 'center' ? 'center' : 'left' }}>
                <div className={s.pvName} style={{ color: t.id === 'modern' ? t.accent : '#111' }}>{doc.basics.name || 'Your Name'}</div>
                <div style={{ color: '#555' }}>{[doc.basics.location, doc.basics.email].filter(Boolean).join(' · ') || 'city · email'}</div>
                {t.id !== 'modern' && <div className={s.pvRule} />}
                <div className={s.pvHead} style={{ color: t.id === 'modern' ? t.accent : '#111', textAlign: 'left' }}>EXPERIENCE</div>
                <div className={s.pvLine} style={{ textAlign: 'left' }}><span style={{ fontWeight: 700 }}>{t.roleLayout === 'company-first' ? (doc.experience[0]?.company || 'Company') : (doc.experience[0]?.title || 'Title')}</span><span style={{ color: '#666' }}>{t.roleLayout === 'company-first' ? (doc.experience[0]?.location || (doc.experience[0] ? '' : 'City')) : (doc.experience[0] ? (formatRange(doc.experience[0].start, doc.experience[0].end) || doc.experience[0].dateText || '') : 'Dates')}</span></div>
                <div style={{ textAlign: 'left' }}>• {(doc.experience[0]?.bullets[0]?.text || (doc.experience[0] ? '' : 'Your first bullet appears here.')).slice(0, 60)}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className={s.card}>
        <div className={s.cardTitle}>Format</div>
        <div className={s.fmts} style={{ marginBottom: '.6rem' }}>
          {FORMATS.map((f) => <button key={f.id} type="button" className={`${s.segBtn}${format === f.id ? ` ${s.segBtnActive}` : ''}`} onClick={() => setFormat(f.id)}>{f.label}</button>)}
        </div>
        <div className={s.dim} style={{ marginBottom: '.7rem' }}>{FORMATS.find((f) => f.id === format)?.description}</div>
        {templated && (
          <div className={s.opts} style={{ marginBottom: '.75rem' }}>
            <span className={s.label} style={{ margin: 0 }}>Paper</span>
            <button type="button" className={`${s.tiny}${paper === 'letter' ? ` ${s.chipGreen}` : ''}`} onClick={() => setPaper('letter')}>Letter (US)</button>
            <button type="button" className={`${s.tiny}${paper === 'a4' ? ` ${s.chipGreen}` : ''}`} onClick={() => setPaper('a4')}>A4</button>
            <span className={s.label} style={{ margin: '0 0 0 .5rem' }}>Size</span>
            <button type="button" className={`${s.tiny}${scale === '0.92' ? ` ${s.chipGreen}` : ''}`} onClick={() => setScale('0.92')}>Compact</button>
            <button type="button" className={`${s.tiny}${scale === '1' ? ` ${s.chipGreen}` : ''}`} onClick={() => setScale('1')}>Normal</button>
            <button type="button" className={`${s.tiny}${scale === '1.06' ? ` ${s.chipGreen}` : ''}`} onClick={() => setScale('1.06')}>Larger</button>
          </div>
        )}
        <div className={s.findingActions}>
          <button type="button" className={s.btnPrimary} onClick={download} disabled={busy !== null}>{busy === 'download' ? 'Building…' : `⬇ Download ${FORMATS.find((f) => f.id === format)?.label}`}</button>
          {(format === 'pdf' || format === 'docx' || format === 'txt') && <button type="button" className={s.btn} onClick={runAts} disabled={busy !== null}>{busy === 'ats' ? 'Checking…' : '🔍 Check what a parser reads'}</button>}
          {format === 'txt' && <button type="button" className={s.btn} onClick={() => copy('txt')}>{copied === 'txt' ? '✓ Copied' : 'Copy text'}</button>}
          {format === 'md' && <button type="button" className={s.btn} onClick={() => copy('md')}>{copied === 'md' ? '✓ Copied' : 'Copy Markdown'}</button>}
        </div>
        {templated && pro !== true && (
          <div className={s.notice} style={{ marginTop: '.75rem' }}>
            Free exports carry one small “Optimized with Seen · seenjobs.io” line in the footer. <button type="button" onClick={onNeedPro} style={{ background: 'none', border: 'none', color: '#c7d2fe', fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 700, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>{isLoggedIn ? 'Go Pro for unbranded files →' : 'Sign in and go Pro for unbranded files →'}</button>
          </div>
        )}
        {error && <div className={s.err} style={{ marginTop: '.7rem', marginBottom: 0 }}>{error}</div>}
      </div>

      {ats && (
        <div className={s.card}>
          <div className={s.scoreRow}>
            <div className={s.ring} style={{ borderColor: scoreColor(ats.score), width: 60, height: 60 }}><span className={s.ringNum} style={{ color: scoreColor(ats.score), fontSize: '1.2rem' }}>{ats.score}</span></div>
            <div style={{ minWidth: 0 }}>
              <div className={s.grade}>Parser read-back · {ats.grade}</div>
              <div className={s.dim}>{ats.summary} {ats.format.toUpperCase()}{ats.template ? ` · ${ats.template}` : ''}{ats.pages ? ` · ${ats.pages} page${ats.pages === 1 ? '' : 's'}` : ''}{ats.font ? ` · ${ats.font}` : ''} · {ats.ms} ms</div>
            </div>
          </div>
          <div style={{ marginTop: '.7rem' }}>
            {ats.checks.map((c) => (
              <div key={c.code} className={s.check}>
                <span className={c.ok ? s.ok : s.bad}>{c.ok ? '✓' : '✕'}</span>
                <div style={{ minWidth: 0 }}><div style={{ color: c.ok ? 'var(--sub)' : 'var(--white)' }}>{c.label}</div><div className={s.muted}>{c.detail}</div></div>
              </div>
            ))}
          </div>
          {ats.recovered && ats.recovered.roles.some((r) => !r.ok) && (
            <div className={s.muted} style={{ marginTop: '.5rem' }}>
              Roles a parser misread: {ats.recovered.roles.filter((r) => !r.ok).map((r) => `${r.title || r.company}${r.readAs ? ` → ${r.readAs.title || '?'} / ${r.readAs.company || '?'}` : ' (not found)'}`).join('; ')}. Fix the header fields above and check again.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
