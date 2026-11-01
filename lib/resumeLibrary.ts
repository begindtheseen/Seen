'use client'

// Saved résumés — the client side of the résumé actions in api/user-sync.js (lib/server/resumes.js).
// Signed-in only. `ready: false` means the table is not live yet: callers keep the single résumé
// (ResumeStore) and hide every multi-résumé control.
import { useCallback, useEffect, useState } from 'react'
import { _syncRaw } from './sync'

export interface SavedResume {
  id: string
  name: string
  file_name: string | null
  word_count: number | null
  is_default: boolean
  created_at: string | null
  updated_at: string | null
  /** false = saved and viewable, but only the default can be used without Pro */
  usable: boolean
}
export interface ResumeList {
  ready: boolean
  pro: boolean
  max: number
  max_free?: number
  max_pro?: number
  count?: number
  resumes: SavedResume[]
}
export interface ResumeWriteResult { ok: boolean; list: ResumeList | null; error?: string; reason?: string; id?: string }

function asList(body: unknown): ResumeList | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Partial<ResumeList>
  if (typeof b.ready !== 'boolean') return null
  return { ready: b.ready, pro: b.pro === true, max: Number(b.max) || 0, max_free: b.max_free, max_pro: b.max_pro, count: b.count, resumes: Array.isArray(b.resumes) ? b.resumes : [] }
}

async function write(action: string, payload: Record<string, unknown>): Promise<ResumeWriteResult> {
  const r = await _syncRaw(action, payload)
  const b = (r.body || {}) as { error?: string; reason?: string; id?: string }
  if (!r.ok) return { ok: false, list: null, error: b.error || (r.status === 0 ? 'You look offline — try again.' : 'Something went wrong — try again.'), reason: b.reason }
  return { ok: true, list: asList(r.body), id: b.id }
}

export const ResumeLibrary = {
  async list(): Promise<ResumeList | null> {
    const r = await _syncRaw('resumes_list')
    return r.ok ? asList(r.body) : null
  },
  async text(id: string): Promise<string | null> {
    const r = await _syncRaw('resume_get', { id })
    const b = r.body as { resume?: { text?: string } } | null
    return r.ok && typeof b?.resume?.text === 'string' ? b.resume.text : null
  },
  create(p: { name?: string; text: string; fileName?: string; wordCount?: number }) {
    return write('resume_create', { name: p.name || '', text: p.text, file_name: p.fileName || '', word_count: p.wordCount || 0 })
  },
  rename(id: string, name: string) { return write('resume_rename', { id, name }) },
  remove(id: string) { return write('resume_delete', { id }) },
  setDefault(id: string) { return write('resume_set_default', { id }) },
}

/** The account's saved résumés (null while loading or when signed out / unreachable). */
export function useResumeList(isLoggedIn: boolean, userId?: string) {
  const [list, setList] = useState<ResumeList | null>(null)
  const reload = useCallback(async () => {
    if (!isLoggedIn) { setList(null); return null }
    const l = await ResumeLibrary.list()
    setList(l)
    return l
  }, [isLoggedIn])
  useEffect(() => { void reload() }, [reload, userId])
  return { list, setList, reload }
}
