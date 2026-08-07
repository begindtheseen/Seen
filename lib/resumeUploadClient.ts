'use client'

// Canonical client-side résumé upload. The ONE path every entry point (the Résumé-AI page
// and the Settings/Profile page) uses to turn a picked file into parsed text — so the upload
// logic is never forked. It reads the file, POSTs to the single parse endpoint
// (/api/resume action:'parse'), and returns a normalized result.
//
// Passing `location` lets the SERVER fire its background résumé→jobs match at the user's
// location (non-blocking; it never affects this response). Storing the returned text and
// firing the credits-updated event stay with the caller (they own that UI state).

import { aiHeaders } from './aiHeaders'

export interface ParseResumeResult {
  ok: boolean
  text?: string
  fileName: string
  wordCount?: number
  employment?: unknown[]
  error?: string
  credits_required?: boolean
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = ev => {
      const res = ev.target?.result
      if (typeof res !== 'string') { reject(new Error('read')); return }
      // strip the "data:...;base64," prefix
      resolve(res.split(',')[1] || '')
    }
    reader.onerror = () => reject(new Error('read'))
    reader.readAsDataURL(file)
  })
}

export async function parseResumeFile(
  file: File,
  opts: { location?: string } = {},
): Promise<ParseResumeResult> {
  const base64 = await readFileAsBase64(file)
  const res = await fetch('/api/resume', {
    method: 'POST',
    headers: await aiHeaders(),
    body: JSON.stringify({
      action: 'parse',
      base64,
      fileName: file.name,
      mimeType: file.type,
      // Feeds the server's non-blocking résumé→jobs warm; omitted when unknown.
      ...(opts.location && opts.location.trim() ? { location: opts.location.trim() } : {}),
    }),
  })
  const data = (await res.json().catch(() => ({}))) as {
    text?: string; wordCount?: number; employment?: unknown[]; credits_required?: boolean; error?: string
  }
  if (data.credits_required) {
    return { ok: false, fileName: file.name, credits_required: true, error: data.error }
  }
  if (data.text) {
    const wordCount = typeof data.wordCount === 'number' && data.wordCount > 0
      ? data.wordCount
      : data.text.trim().split(/\s+/).filter(Boolean).length
    return { ok: true, text: data.text, fileName: file.name, wordCount, employment: data.employment }
  }
  return { ok: false, fileName: file.name, error: data.error }
}
