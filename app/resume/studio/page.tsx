'use client'

// Résumé Studio — structured editor + Health / Tailor / Export panels.
//
// Data flow: ResumeStore (the canonical résumé TEXT, DB-backed for signed-in users) → a structured
// doc (the server's layout-aware parse from the last upload when its text still matches, else a
// browser parse of the text) → edits here → autosaved back as canonical text, so every other
// surface (SeenFit, Apply on Seen, the profile) sees the edited résumé. Tailored variants live on
// the device per user (ResumeDocStore) and never overwrite the base.

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import s from '@/components/resume/studio.module.css'
import DocEditor from '@/components/resume/DocEditor'
import HealthPanel from '@/components/resume/HealthPanel'
import TailorPanel, { type TailorJob } from '@/components/resume/TailorPanel'
import ExportPanel from '@/components/resume/ExportPanel'
import UpgradeModal from '@/components/UpgradeModal'
import { useAuth } from '@/lib/auth'
import { aiHeaders } from '@/lib/aiHeaders'
import { ResumeStore } from '@/lib/stores/ResumeStore'
import { ResumeDocStore, type StoredVariant } from '@/lib/stores/ResumeDocStore'
import { SavedJobsStore } from '@/lib/stores/SavedJobs'
import { parseResumeFile } from '@/lib/resumeUploadClient'
import { parseResume, scoreResume, serializeToText, rewriteDoc, rewriteBullet, emptyDoc, normalizeDoc, docStats, newId } from '@/lib/resume/engine-client'
import type { ResumeDoc, Health } from '@/lib/resume/types'
import type { SavedJob } from '@/lib/types'
import { showToast } from '@/lib/toast'

type Tab = 'edit' | 'health' | 'tailor' | 'export'
const HANDOFF_KEY = 'seen_studio_job'

function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1024px)')
    const on = () => setNarrow(mq.matches)
    on(); mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return narrow
}

function replaceLead(text: string, verb: string, leadToken: string): string {
  const t = text.trim()
  const cap = verb.charAt(0).toUpperCase() + verb.slice(1)
  if (leadToken && t.toLowerCase().startsWith(leadToken.toLowerCase())) {
    const rest = t.slice(leadToken.length).replace(/^[\s,:;-]+/, '')
    return `${cap} ${rest}`.replace(/\s+/g, ' ').trim()
  }
  return `${cap} ${t.charAt(0).toLowerCase()}${t.slice(1)}`
}

function StudioInner() {
  const { isLoggedIn, user, profile, ready } = useAuth() as unknown as { isLoggedIn: boolean; user: { id?: string; email?: string } | null; profile: { city?: string } | null; ready: boolean }
  const router = useRouter()
  const params = useSearchParams()
  const narrow = useIsNarrow()

  const [loaded, setLoaded] = useState(false)
  const [baseDoc, setBaseDoc] = useState<ResumeDoc | null>(null)
  const [baseMeta, setBaseMeta] = useState<{ fileName: string; wordCount: number } | null>(null)
  const [variants, setVariants] = useState<StoredVariant[]>([])
  const [activeId, setActiveId] = useState<string | null>(null) // null = base
  const [variantDoc, setVariantDoc] = useState<ResumeDoc | null>(null)
  const [tab, setTab] = useState<Tab>(() => (params?.get('tab') === 'tailor' ? 'tailor' : params?.get('tab') === 'export' ? 'export' : 'health'))
  const [highlight, setHighlight] = useState<string | null>(null)
  const [mode, setMode] = useState<'editor' | 'paste' | 'empty'>('empty')
  const [pasteText, setPasteText] = useState('')
  const [pro, setPro] = useState<boolean | null>(null)
  const [savedJobs, setSavedJobs] = useState<SavedJob[]>([])
  const [initialJob, setInitialJob] = useState<TailorJob | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [showUpgrade, setShowUpgrade] = useState<null | 'credits' | 'pro' | 'generic'>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const saveTimer = useRef<number | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const doc = activeId ? variantDoc : baseDoc
  const health: Health | null = useMemo(() => (doc ? scoreResume(doc) : null), [doc])
  const fixAll = useMemo(() => (doc ? rewriteDoc(doc) : null), [doc])
  const fixAllCount = fixAll ? fixAll.log.filter((l) => l.changes.some((c) => c.rule !== 'hygiene')).length : 0

  // ── load ──
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    ResumeStore.load(user?.id, isLoggedIn).then((data) => {
      if (cancelled) return
      if (data?.text) {
        const cached = ResumeDocStore.getParsed(user?.id, data.text)
        const d = cached ? normalizeDoc(cached) : parseResume(data.text, data.fileName)
        setBaseDoc(d); setBaseMeta({ fileName: data.fileName, wordCount: data.wordCount }); setMode('editor')
      } else setMode('empty')
      setVariants(ResumeDocStore.listVariants(user?.id))
      setLoaded(true)
    })
    return () => { cancelled = true }
  }, [ready, user?.id, isLoggedIn])

  useEffect(() => { SavedJobsStore.load(isLoggedIn).then(setSavedJobs).catch(() => {}) }, [isLoggedIn])
  useEffect(() => {
    if (!isLoggedIn) { setPro(null); return }
    let cancelled = false
    aiHeaders().then((h) => fetch('/api/user-sync', { method: 'POST', headers: h, body: JSON.stringify({ action: 'get_credits' }) })).then((r) => (r.ok ? r.json() : null)).then((d) => { if (!cancelled && d) setPro(!!d.pro) }).catch(() => {})
    return () => { cancelled = true }
  }, [isLoggedIn, user?.id])
  // Job hand-off from /resume (sessionStorage) or URL params.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(HANDOFF_KEY)
      if (raw) { const j = JSON.parse(raw) as TailorJob; sessionStorage.removeItem(HANDOFF_KEY); setInitialJob(j); setTab('tailor'); return }
    } catch { /* ignore */ }
    const role = params?.get('role') || '', company = params?.get('company') || ''
    if (role || company) { setInitialJob({ title: role, company, description: '', jobId: '' }); if (params?.get('tab') === 'tailor') setTab('tailor') }
  }, [params])

  // ── autosave the BASE as canonical text (variants stay device-local) ──
  const scheduleSave = useCallback((d: ResumeDoc, meta: { fileName: string; wordCount: number } | null) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    setSaveState('saving')
    saveTimer.current = window.setTimeout(async () => {
      const text = serializeToText(d)
      const wc = docStats(d).words
      try { await ResumeStore.save(text, meta?.fileName || 'Résumé Studio', wc, user?.id, isLoggedIn); ResumeDocStore.putParsed(user?.id, text, d); setSaveState('saved') } catch { setSaveState('idle') }
    }, 1200)
  }, [user?.id, isLoggedIn])

  function onChange(next: ResumeDoc) {
    if (activeId) {
      setVariantDoc(next)
      const v = variants.find((x) => x.id === activeId)
      if (v) setVariants(ResumeDocStore.saveVariant(user?.id, { ...v, doc: next }))
    } else {
      setBaseDoc(next)
      const meta = baseMeta || { fileName: 'Résumé Studio', wordCount: docStats(next).words }
      if (!baseMeta) setBaseMeta(meta)
      scheduleSave(next, meta)
    }
  }

  // ── sources ──
  async function uploadFile(file: File) {
    setBusy(true); setError('')
    try {
      const r = await parseResumeFile(file, { location: profile?.city || '' })
      if (r.credits_required) { if (isLoggedIn) setShowUpgrade('credits'); else setError('Sign in to upload a résumé file (1 credit) — or paste the text, which is free.'); setBusy(false); return }
      if (!r.ok || !r.text) { setError(r.error || 'Could not read this file. Paste the text instead.'); setBusy(false); return }
      window.dispatchEvent(new Event('seen:credits-updated'))
      const wc = r.wordCount || r.text.trim().split(/\s+/).length
      const d = r.doc ? normalizeDoc(r.doc) : parseResume(r.text, r.fileName)
      // Keep the extractor's raw text as the canonical store until the first edit (lossless), but
      // cache the structured doc against it so the Studio never re-parses this upload.
      await ResumeStore.save(r.text, r.fileName, wc, user?.id, isLoggedIn)
      ResumeDocStore.putParsed(user?.id, r.text, d)
      setBaseDoc(d); setBaseMeta({ fileName: r.fileName, wordCount: wc }); setActiveId(null); setVariantDoc(null); setMode('editor'); setTab('health')
      if (r.coverage != null && r.coverage < 0.9) showToast(`Structured ${Math.round(r.coverage * 100)}% of the text — check the sections below for anything that landed in the wrong place.`)
    } catch { setError('Upload failed. Try again or paste the text.') }
    setBusy(false)
  }
  function usePasted() {
    const t = pasteText.trim()
    if (t.length < 50) { setError('Paste the whole résumé — that is too short.'); return }
    if (!ResumeStore.isReadable(t)) { setError('That text does not read like a résumé (scrambled characters). Try re-exporting it from Word or Google Docs.'); return }
    const d = parseResume(t, 'Pasted résumé')
    const wc = t.split(/\s+/).length
    ResumeStore.save(t, 'Pasted résumé', wc, user?.id, isLoggedIn).catch(() => {})
    ResumeDocStore.putParsed(user?.id, t, d)
    setBaseDoc(d); setBaseMeta({ fileName: 'Pasted résumé', wordCount: wc }); setActiveId(null); setVariantDoc(null); setMode('editor'); setTab('health'); setError('')
  }
  function startBlank() {
    const d = emptyDoc()
    d.sectionOrder = ['summary', 'experience', 'education', 'skills']
    d.experience.push({ id: newId('x'), title: '', company: '', location: '', employmentType: '', start: '', end: '', dateText: '', summary: '', bullets: [{ id: newId('b'), text: '' }] })
    d.skills.push({ id: newId('s'), label: '', items: [] })
    setBaseDoc(d); setBaseMeta({ fileName: 'Résumé Studio', wordCount: 0 }); setActiveId(null); setVariantDoc(null); setMode('editor'); setTab('edit')
  }
  function clearAll() {
    if (!window.confirm('Remove your résumé from Seen on this device and your account?')) return
    ResumeStore.clear(user?.id, isLoggedIn); ResumeDocStore.clear(user?.id)
    setBaseDoc(null); setBaseMeta(null); setVariants([]); setActiveId(null); setVariantDoc(null); setMode('empty')
  }

  // ── health actions ──
  const jump = (bulletId: string | null) => { setHighlight(bulletId); if (narrow) setTab('edit'); window.setTimeout(() => setHighlight(null), 2500) }
  function applyRewrite(bulletId: string, text: string) { if (!doc) return; onChange(mapBullet(doc, bulletId, () => text)) }
  function applyVerb(bulletId: string, verb: string) {
    if (!doc || !health) return
    const info = health.bullets.find((b) => b.bulletId === bulletId)
    onChange(mapBullet(doc, bulletId, (t) => replaceLead(t, verb, info?.lead.token || '')))
  }
  function fixAllNow() { if (!fixAll || !doc) return; onChange(fixAll.doc); showToast(`Rewrote ${fixAllCount} bullet${fixAllCount === 1 ? '' : 's'} — nothing new was invented.`) }

  // ── variants ──
  function useVariant(v: ResumeDoc, meta: { role: string; company: string; jobId: string; scoreBefore: number; scoreAfter: number }) {
    const label = [meta.role, meta.company].filter(Boolean).join(' @ ') || 'Tailored'
    const rec: StoredVariant = { id: v.id, label, role: meta.role, company: meta.company, jobId: meta.jobId, createdAt: new Date().toISOString(), doc: v, baseHash: '', scoreBefore: meta.scoreBefore, scoreAfter: meta.scoreAfter }
    setVariants(ResumeDocStore.saveVariant(user?.id, rec)); setActiveId(v.id); setVariantDoc(v); setTab('export')
    showToast('Tailored version ready — review it, then export.')
  }
  function switchTo(id: string | null) {
    setActiveId(id)
    if (id) { const v = variants.find((x) => x.id === id); setVariantDoc(v ? normalizeDoc(v.doc) : null) } else setVariantDoc(null)
  }
  function removeVariant(id: string) { setVariants(ResumeDocStore.removeVariant(user?.id, id)); if (activeId === id) switchTo(null) }

  const active = activeId ? variants.find((v) => v.id === activeId) : null
  const panelTab: Exclude<Tab, 'edit'> = tab === 'edit' ? 'health' : tab
  const showEditor = !narrow || tab === 'edit'
  const showPanel = !narrow || tab !== 'edit'

  if (!loaded) return <div className="page-full"><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}><div className="spinner" /></div></div>

  return (
    <div className="page-full">
      {showUpgrade && <UpgradeModal reason={showUpgrade} featureName={showUpgrade === 'pro' ? 'AI polish' : undefined} onClose={() => setShowUpgrade(null)} />}
      <div className={s.wrap}>
        <div className={s.top}>
          <div style={{ minWidth: 0 }}>
            <div className={s.kicker}>Résumé Studio</div>
            <h1 className={s.h1}>{doc ? (doc.basics.name || 'Your résumé') : 'Build a résumé parsers read and recruiters remember'}</h1>
            <p className={s.sub}>Score it, fix every weak bullet without inventing a word, tailor it to a job from your own facts, then export it in a template any ATS can parse.</p>
          </div>
          {doc && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '.45rem', minWidth: 0 }}>
              <div className={s.src}>
                {active ? <strong>Tailored · {active.label}</strong> : <strong>Base résumé</strong>}
                {baseMeta && !active && <span>· {baseMeta.fileName}</span>}
                <span>· {docStats(doc).words} words</span>
                {!active && <span style={{ color: saveState === 'saved' ? 'var(--green)' : 'var(--muted)' }}>· {saveState === 'saving' ? 'saving…' : saveState === 'saved' ? 'saved' : ''}</span>}
              </div>
              <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <button type="button" className={s.btn} onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? 'Reading…' : 'Upload a file'}</button>
                <button type="button" className={s.btn} onClick={() => { setPasteText(''); setMode('paste') }}>Paste text</button>
                <Link href="/resume" className={s.btn} style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>Application Intelligence →</Link>
                <button type="button" className={`${s.btn} ${s.btnDanger}`} onClick={clearAll}>Clear</button>
              </div>
            </div>
          )}
        </div>
        <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.txt,.md,text/plain" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = '' }} />

        {error && <div className={s.err}>{error}</div>}

        {mode === 'empty' && (
          <div className={s.grid} style={{ gridTemplateColumns: '1fr' }}>
            <div className={`${s.drop}${dragging ? ` ${s.dropActive}` : ''}`} onDragOver={(e) => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) uploadFile(f) }}>
              <div style={{ fontSize: '2rem', marginBottom: '.5rem' }}>📄</div>
              <div className={s.cardTitle}>Drop your résumé here</div>
              <div className={s.dim} style={{ marginBottom: '1rem' }}>PDF, Word or text. We read the layout (columns, bold headings, bullets), not just the characters.</div>
              <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                <button type="button" className={s.btnPrimary} onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? 'Reading…' : 'Upload a file'}<span style={{ marginLeft: '.45rem', fontSize: '.55rem', opacity: .7, fontFamily: 'var(--mono)', fontWeight: 400 }}>· 1 credit</span></button>
                <button type="button" className={s.btn} onClick={() => setMode('paste')}>Paste text · free</button>
                <button type="button" className={s.btn} onClick={startBlank}>Start from blank</button>
              </div>
              {!isLoggedIn && <div className={s.muted} style={{ marginTop: '.8rem' }}>Signed out: pasting and editing work on this device only. Sign in to keep your résumé on your account.</div>}
            </div>
          </div>
        )}

        {mode === 'paste' && (
          <div className={s.card}>
            <div className={s.cardTitle}>Paste your résumé</div>
            <div className={s.dim} style={{ marginBottom: '.6rem' }}>Keep the line breaks — section headings on their own lines, one bullet per line.</div>
            <textarea className={s.pasteArea} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder={'JORDAN REYES\nPhoenix, AZ · 602-555-0142 · jordan@example.com\n\nEXPERIENCE\nJourneyman Electrician — Desert Power Solutions | Mar 2020 – Present\n• Install and troubleshoot 480V three-phase systems across 14 sites.\n…'} />
            <div className={s.findingActions} style={{ marginTop: '.6rem' }}>
              <button type="button" className={s.btnPrimary} onClick={usePasted}>Structure it →</button>
              <button type="button" className={s.btn} onClick={() => setMode(baseDoc ? 'editor' : 'empty')}>Cancel</button>
            </div>
          </div>
        )}

        {mode === 'editor' && doc && (
          <>
            {variants.length > 0 && (
              <div className={s.variants} style={{ marginBottom: '.9rem' }}>
                <span className={s.label} style={{ margin: 0 }}>Versions</span>
                <button type="button" className={`${s.vbtn}${!activeId ? ` ${s.vbtnActive}` : ''}`} onClick={() => switchTo(null)}>Base</button>
                {variants.map((v) => (
                  <span key={v.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '.15rem' }}>
                    <button type="button" className={`${s.vbtn}${activeId === v.id ? ` ${s.vbtnActive}` : ''}`} onClick={() => switchTo(v.id)} title={v.label}>{v.label}{v.scoreAfter != null ? ` · ${v.scoreAfter}` : ''}</button>
                    <button type="button" className={s.tiny} onClick={() => removeVariant(v.id)} aria-label={`Remove ${v.label}`}>✕</button>
                  </span>
                ))}
              </div>
            )}
            <div className={`${s.seg} ${s.mobileOnly}`}>
              {(['edit', 'health', 'tailor', 'export'] as Tab[]).map((t) => <button key={t} type="button" className={`${s.segBtn}${tab === t ? ` ${s.segBtnActive}` : ''}`} onClick={() => setTab(t)}>{t === 'edit' ? '📝 Document' : t === 'health' ? `💚 Health${health ? ` ${health.score}` : ''}` : t === 'tailor' ? '🎯 Tailor' : '📤 Export'}</button>)}
            </div>
            <div className={s.grid}>
              {showEditor && <div><DocEditor doc={doc} onChange={onChange} highlightId={highlight} /></div>}
              {showPanel && (
                <div className={s.panel}>
                  <div className={`${s.seg} ${s.hideMobile}`}>
                    {(['health', 'tailor', 'export'] as Tab[]).map((t) => <button key={t} type="button" className={`${s.segBtn}${panelTab === t ? ` ${s.segBtnActive}` : ''}`} onClick={() => setTab(t)}>{t === 'health' ? `💚 Health${health ? ` · ${health.score}` : ''}` : t === 'tailor' ? '🎯 Tailor' : '📤 Export'}</button>)}
                  </div>
                  {panelTab === 'health' && health && <HealthPanel health={health} doc={doc} onJump={jump} onApplyRewrite={applyRewrite} onApplyVerb={applyVerb} onFixAll={fixAllNow} fixAllCount={fixAllCount} />}
                  {panelTab === 'tailor' && <TailorPanel doc={doc} isLoggedIn={isLoggedIn} pro={pro} savedJobs={savedJobs} initialJob={initialJob} onNeed={(r) => { if (r === 'signin') { setError('Sign in to tailor your résumé (1 credit).'); router.push('/login?next=/resume/studio?tab=tailor') } else setShowUpgrade(r) }} onUseVariant={useVariant} />}
                  {panelTab === 'export' && <ExportPanel doc={doc} pro={pro} isLoggedIn={isLoggedIn} onNeedPro={() => setShowUpgrade(isLoggedIn ? 'pro' : 'generic')} role={active?.role} />}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function mapBullet(doc: ResumeDoc, bulletId: string, fn: (t: string) => string): ResumeDoc {
  const d = JSON.parse(JSON.stringify(doc)) as ResumeDoc
  const visit = (list: { id: string; text: string }[]) => { for (const b of list) if (b.id === bulletId) { const to = fn(b.text); if (to !== b.text) { d.meta.provenance.push({ kind: 'rewrite', bulletId, from: b.text, to }); b.text = to } } }
  for (const e of d.experience) visit(e.bullets)
  for (const p of d.projects) visit(p.bullets)
  for (const e of d.education) visit(e.details)
  for (const x of d.extra) visit(x.items)
  return d
}

export default function StudioPage() {
  return (
    <Suspense fallback={<div className="page-full"><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}><div className="spinner" /></div></div>}>
      <StudioInner />
    </Suspense>
  )
}

// keep the single-bullet rewrite available for future inline use without a second import path
export { rewriteBullet as _rewriteBullet }
