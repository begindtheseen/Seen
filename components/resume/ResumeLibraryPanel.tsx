'use client'

// "Your résumé(s)" on the résumé page: view the résumé on file, download it as a PDF (free) and open it
// in Studio — for everyone. With saved résumés live (lib/server/resumes.js) it lists them, with the cap
// shown honestly, and lets the person add, rename, delete, pick the default and use one for this job.
import { useRef, useState } from 'react'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Dialog from '@/components/ui/Dialog'
import ResumeView from './ResumeView'
import { ResumeLibrary, type ResumeList, type SavedResume } from '@/lib/resumeLibrary'
import { capLine, canAddResume } from '@/lib/resumeChoice.js'
import { downloadResumePdf } from '@/lib/resumeDownload'
import { parseResumeFile } from '@/lib/resumeUploadClient'
import { countWords } from '@/lib/resume/engine-client'
import { formatPacific } from '@/lib/time/pacific.js'
import { MAX_RESUMES_PRO } from '@/lib/creditRules'

type Viewing = { id: string | null; name: string; text: string; fileName: string; isDefault: boolean; usable: boolean; meta: string }

const kick: React.CSSProperties = { fontFamily: 'var(--mono)', fontSize: 'var(--fs-62)', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--dim)' }
const meta: React.CSSProperties = { fontFamily: 'var(--mono)', fontSize: 'var(--fs-62)', color: 'var(--muted)', overflowWrap: 'anywhere' }
const errStyle: React.CSSProperties = { fontFamily: 'var(--mono)', fontSize: 'var(--fs-65)', color: 'var(--red)', marginTop: '.5rem', overflowWrap: 'anywhere' }

const updated = (iso: string | null) => (iso ? `updated ${formatPacific(iso, { month: 'short', day: 'numeric', year: 'numeric' })}` : '')
const words = (n: number | null | undefined) => (n ? `${n} words` : '')

export default function ResumeLibraryPanel({ isLoggedIn, list, setList, single, selectedId, onUse, onDefaultChanged, onUpsell, location }: {
  isLoggedIn: boolean
  list: ResumeList | null
  setList: (l: ResumeList | null) => void
  /** The résumé on file when saved résumés are not live (or for a guest). */
  single: { text: string; fileName: string; wordCount: number } | null
  selectedId: string | null
  onUse: (r: SavedResume, text: string) => void
  /** The default changed (so the mirrored résumé did): the page reloads the résumé on file. */
  onDefaultChanged: () => void
  onUpsell: () => void
  location?: string
}) {
  const live = !!(isLoggedIn && list && list.ready)
  const [viewing, setViewing] = useState<Viewing | null>(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addName, setAddName] = useState('')
  const [addText, setAddText] = useState('')
  const [addErr, setAddErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  if (!live && !single) return null

  function closeView() { setViewing(null); setRenaming(null); setConfirmDelete(false); setErr('') }

  async function openSaved(r: SavedResume) {
    setErr(''); setBusy(`view:${r.id}`)
    const text = await ResumeLibrary.text(r.id)
    setBusy('')
    if (text == null) { setErr('Could not open that résumé — try again.'); return }
    setViewing({ id: r.id, name: r.name, text, fileName: r.file_name || '', isDefault: r.is_default, usable: r.usable, meta: [r.is_default ? 'Default' : '', words(r.word_count), updated(r.updated_at)].filter(Boolean).join(' · ') })
  }
  function openSingle() {
    if (!single) return
    setViewing({ id: null, name: 'Your résumé', text: single.text, fileName: single.fileName, isDefault: true, usable: true, meta: [single.fileName, words(single.wordCount)].filter(Boolean).join(' · ') })
  }

  async function download() {
    if (!viewing) return
    setBusy('download'); setErr('')
    const e = await downloadResumePdf(viewing.text, viewing.name)
    setBusy('')
    if (e) setErr(e)
  }

  // A write answered with the fresh list (or an honest error).
  async function run(key: string, fn: () => Promise<{ ok: boolean; list: ResumeList | null; error?: string }>, after?: (l: ResumeList) => void) {
    setBusy(key); setErr('')
    const r = await fn()
    setBusy('')
    if (!r.ok || !r.list) { setErr(r.error || 'Something went wrong — try again.'); return false }
    setList(r.list)
    after?.(r.list)
    return true
  }

  async function makeDefault() {
    if (!viewing?.id) return
    const ok = await run('default', () => ResumeLibrary.setDefault(viewing.id as string))
    if (ok) { setViewing(v => v && { ...v, isDefault: true, usable: true }); onDefaultChanged() }
  }
  async function rename() {
    if (!viewing?.id || renaming == null) return
    const name = renaming.trim()
    if (!name) { setErr('Give the résumé a name.'); return }
    const ok = await run('rename', () => ResumeLibrary.rename(viewing.id as string, name))
    if (ok) { setViewing(v => v && { ...v, name }); setRenaming(null) }
  }
  async function remove() {
    if (!viewing?.id) return
    const wasDefault = viewing.isDefault
    const ok = await run('delete', () => ResumeLibrary.remove(viewing.id as string))
    if (ok) { closeView(); if (wasDefault) onDefaultChanged() }
  }
  function use() {
    if (!viewing?.id || !list) return
    const r = list.resumes.find(x => x.id === viewing.id)
    if (r && r.usable) { onUse(r, viewing.text); closeView() }
  }

  async function save(text: string, fileName: string, wordCount: number) {
    setAddErr(''); setBusy('add')
    const r = await ResumeLibrary.create({ name: addName.trim(), text, fileName, wordCount })
    setBusy('')
    if (!r.ok || !r.list) { setAddErr(r.error || 'Could not save that résumé — try again.'); return }
    const wasEmpty = !list || list.resumes.length === 0
    setList(r.list)
    setAdding(false); setAddName(''); setAddText('')
    if (wasEmpty) onDefaultChanged()
  }
  async function addFile(file: File) {
    setAddErr(''); setBusy('add')
    // An extra résumé must not become the job rail's signal (signal:false); the first one is the default.
    const first = !list || list.resumes.length === 0
    const r = await parseResumeFile(file, first ? { location } : { signal: false }).catch(() => null)
    setBusy('')
    if (!r || !r.ok || !r.text) { setAddErr(r?.error || 'Could not read this file. Paste the text instead.'); return }
    await save(r.text, r.fileName, r.wordCount || countWords(r.text))
  }

  const rows = live && list ? list.resumes : []
  const canAdd = live && canAddResume(list)
  const isPro = !!list?.pro

  return (
    <div className="ai-card" style={{ marginBottom: '1rem' }} data-testid="resume-library">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.5rem' }}>
        <div style={kick}>{live && rows.length > 1 ? 'Your résumés' : 'Your résumé on file'}</div>
        {live && <div style={meta} data-testid="resume-cap">{capLine(list)}</div>}
      </div>

      {!live && single && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 12rem', minWidth: 0 }}>
            <div style={{ fontSize: 'var(--fs-ui)', color: 'var(--white)', overflowWrap: 'anywhere' }}>{single.fileName || 'Your résumé'}</div>
            <div style={meta}>{words(single.wordCount)}</div>
          </div>
          <Button size="sm" variant="secondary" icon="eye" onClick={openSingle}>View</Button>
        </div>
      )}

      {live && rows.length === 0 && <div style={{ ...meta, marginBottom: '.5rem' }}>No résumé saved yet — add one below, or paste it into the box on the left.</div>}

      {live && rows.map(r => (
        <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap', padding: '.5rem 0', borderTop: '1px solid var(--line)' }}>
          <div style={{ flex: '1 1 12rem', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 'var(--fs-ui)', color: 'var(--white)', overflowWrap: 'anywhere', minWidth: 0 }}>{r.name}</span>
              {r.is_default && <Badge tone="accent">Default</Badge>}
              {!r.usable && <Badge tone="neutral" icon="lock">Pro</Badge>}
            </div>
            <div style={meta}>{[words(r.word_count), updated(r.updated_at)].filter(Boolean).join(' · ')}</div>
          </div>
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
            {rows.length > 1 && (r.id === selectedId
              ? <span style={{ ...meta, color: 'var(--green)', alignSelf: 'center' }}>In use</span>
              : <Button size="sm" variant="ghost" disabled={!r.usable || !!busy} title={r.usable ? 'Use this résumé for this job' : 'Only your default résumé can be used without Pro'}
                  onClick={async () => { setBusy(`use:${r.id}`); const t = await ResumeLibrary.text(r.id); setBusy(''); if (t == null) setErr('Could not open that résumé — try again.'); else onUse(r, t) }}>Use</Button>)}
            <Button size="sm" variant="secondary" icon="eye" loading={busy === `view:${r.id}`} onClick={() => openSaved(r)}>View</Button>
          </div>
        </div>
      ))}

      {live && !adding && (
        <div style={{ marginTop: '.5rem', display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
          {canAdd
            ? <Button size="sm" variant="secondary" icon="plus" onClick={() => { setAdding(true); setAddErr('') }}>Add a résumé</Button>
            : !isPro
              ? <><span style={meta}>Keep up to {MAX_RESUMES_PRO} résumés with Pro.</span><Button size="sm" variant="ghost" onClick={onUpsell}>See Pro</Button></>
              : <span style={meta}>Delete one to add another.</span>}
        </div>
      )}

      {live && adding && (
        <div style={{ marginTop: '.75rem', borderTop: '1px solid var(--line)', paddingTop: '.75rem' }}>
          <label style={{ ...kick, display: 'block', marginBottom: '.25rem' }} htmlFor="resume-add-name">Name (optional)</label>
          <input id="resume-add-name" className="ui-input" autoComplete="off" maxLength={60} placeholder="e.g. Warehouse roles" value={addName} onChange={e => setAddName(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', marginBottom: '.5rem' }} />
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.5rem' }}>
            <Button size="sm" variant="secondary" icon="file-text" loading={busy === 'add'} onClick={() => fileRef.current?.click()}>Upload PDF / Word / text · free</Button>
            <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.txt,.md,text/plain" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void addFile(f) }} />
          </div>
          <label style={{ ...kick, display: 'block', marginBottom: '.25rem' }} htmlFor="resume-add-text">…or paste the text</label>
          <textarea id="resume-add-text" className="ui-input" autoComplete="off" rows={6} value={addText} onChange={e => setAddText(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', fontSize: 'var(--fs-ui)' }} />
          {addErr && <div role="alert" style={errStyle}>{addErr}</div>}
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginTop: '.5rem' }}>
            <Button size="sm" variant="primary" disabled={addText.trim().length < 50 || !!busy} onClick={() => save(addText.trim(), 'Pasted résumé', countWords(addText))}>Save résumé</Button>
            <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setAddErr('') }}>Cancel</Button>
          </div>
        </div>
      )}

      {err && !viewing && <div role="alert" style={errStyle}>{err}</div>}

      <Dialog
        open={!!viewing}
        onClose={closeView}
        size="lg"
        title={viewing?.name || 'Your résumé'}
        description={viewing?.meta || undefined}
        footer={viewing ? (
          <>
            <Button variant="secondary" icon="download" loading={busy === 'download'} onClick={download}>Download PDF · free</Button>
            {viewing.isDefault
              ? <Button variant="secondary" icon="pencil" href="/resume/studio">Edit in Studio</Button>
              : null}
            {live && viewing.id && viewing.id !== selectedId && viewing.usable && rows.length > 1
              ? <Button variant="primary" onClick={use}>Use for this job</Button>
              : null}
          </>
        ) : null}
      >
        {viewing && (
          <div>
            {live && viewing.id && (
              <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.75rem' }}>
                {!viewing.isDefault && <Button size="sm" variant="ghost" loading={busy === 'default'} onClick={makeDefault}>Make default</Button>}
                <Button size="sm" variant="ghost" icon="pencil" onClick={() => { setRenaming(renaming == null ? viewing.name : null); setConfirmDelete(false) }}>Rename</Button>
                <Button size="sm" variant="ghost" icon="trash-2" onClick={() => { setConfirmDelete(v => !v); setRenaming(null) }}>Delete</Button>
              </div>
            )}
            {renaming != null && (
              <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.75rem' }}>
                <input aria-label="Résumé name" className="ui-input" autoComplete="off" maxLength={60} value={renaming} onChange={e => setRenaming(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void rename() }} style={{ flex: '1 1 12rem', minWidth: 0 }} />
                <Button size="sm" variant="secondary" loading={busy === 'rename'} onClick={rename}>Save name</Button>
              </div>
            )}
            {confirmDelete && (
              <div role="alert" style={{ background: 'var(--rdim)', border: '1px solid rgba(239,68,68,.25)', borderRadius: 8, padding: '.75rem .75rem', marginBottom: '.75rem' }}>
                <div style={{ fontSize: 'var(--fs-ui)', color: 'var(--sub)', lineHeight: 1.5, marginBottom: '.5rem' }}>
                  Delete “{viewing.name}”? This can’t be undone.{viewing.isDefault && rows.length > 1 ? ' Your most recently updated other résumé becomes the default.' : ''}
                </div>
                <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                  <Button size="sm" variant="danger" loading={busy === 'delete'} onClick={remove}>Delete it</Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Keep it</Button>
                </div>
              </div>
            )}
            {!viewing.isDefault && <div style={{ ...meta, marginBottom: '.5rem' }}>Studio edits your default résumé — make this one the default to edit it there.{!viewing.usable ? ' Without Pro only your default can be used to optimize or apply; this one stays saved.' : ''}</div>}
            {err && <div role="alert" style={{ ...errStyle, marginTop: 0, marginBottom: '.5rem' }}>{err}</div>}
            <ResumeView text={viewing.text} fileName={viewing.fileName} />
          </div>
        )}
      </Dialog>
    </div>
  )
}
