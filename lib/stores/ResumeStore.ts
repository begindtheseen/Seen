'use client'

import { _sync } from '../sync'
import type { ResumeData } from '../types'
import { isReadableResume } from '../resumeReadability'

function getKey(userId?: string): string {
  return `seen_resume_${userId || 'guest'}`
}

function getMetaKey(userId?: string): string {
  return `seen_resume_meta_${userId || 'guest'}`
}

// Canonical readability (lib/server/resumeReadability.js via the isomorphic re-export) — the
// SAME predicate the server's upload / optimize / save_resume gates enforce, so the client can
// never accept text the server would reject (or vice versa). Length floor kept from before.
function isReadable(text: string): boolean {
  if (!text || text.length < 50) return false
  return isReadableResume(text)
}

export const ResumeStore = {
  isReadable,

  async save(text: string, fileName: string, wordCount: number, userId?: string, loggedIn = false): Promise<void> {
    const key = getKey(userId)
    const metaKey = getMetaKey(userId)
    localStorage.setItem(key, text)
    localStorage.setItem(metaKey, JSON.stringify({ fileName, wordCount }))
    if (loggedIn) {
      _sync('save_resume', { text, fileName, wordCount }).catch(e =>
        console.warn('Resume DB save (non-fatal):', e)
      )
    }
  },

  async load(userId?: string, loggedIn = false): Promise<ResumeData | null> {
    // SECURITY / DATA ISOLATION: for a signed-in user the DATABASE is the only source of
    // truth for their résumé. We must NEVER resurrect a device-local (localStorage) résumé
    // into their account — on a shared device that cache can belong to a previously
    // signed-in person, which would leak their résumé (and survey data) into this account.
    if (loggedIn) {
      try {
        const result = await _sync('load_profile') as { profile?: Record<string, unknown> } | null
        const data = result?.profile
        // SELF-HEALING: a legacy row saved before the readability gates can hold glyph-code
        // junk (the cross-device corruption incident). Treat it as no résumé, purge the DB
        // copy so every device converges to a clean re-upload prompt, and drop the local cache.
        if (data?.resume_text && !isReadable(data.resume_text as string)) {
          _sync('clear_resume').catch(() => { /* best-effort purge; load still heals locally */ })
          localStorage.removeItem(getKey(userId))
          localStorage.removeItem(getMetaKey(userId))
          return null
        }
        if (data?.resume_text) {
          const key = getKey(userId)
          const metaKey = getMetaKey(userId)
          localStorage.setItem(key, data.resume_text as string)
          localStorage.setItem(metaKey, JSON.stringify({
            fileName: data.resume_file_name || 'Resume',
            wordCount: data.resume_word_count || 0,
          }))
          return {
            text: data.resume_text as string,
            fileName: (data.resume_file_name as string) || 'Resume',
            wordCount: (data.resume_word_count as number) || 0,
          }
        }
      } catch {
        // On a load error, fail closed (no résumé) rather than falling back to a device cache.
        return null
      }
      // Signed in but DB has no résumé → they have none. Clear any stale device cache and
      // do NOT auto-import localStorage (that was the cross-user bleed vector).
      localStorage.removeItem(getKey(userId))
      localStorage.removeItem(getMetaKey(userId))
      return null
    }

    // Guest (not signed in): device-local cache only, never written to any account.
    const key = getKey(userId)
    const text = localStorage.getItem(key)
    if (text) {
      const meta = JSON.parse(localStorage.getItem(getMetaKey(userId)) || '{}')
      return { text, fileName: meta.fileName || 'Resume', wordCount: meta.wordCount || 0 }
    }
    return null
  },

  clear(userId?: string, loggedIn = false): void {
    localStorage.removeItem(getKey(userId))
    localStorage.removeItem(getMetaKey(userId))
    if (loggedIn) {
      _sync('clear_resume').catch(e => console.warn('ResumeStore.clear:', e))
    }
  },
}
