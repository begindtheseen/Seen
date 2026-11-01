'use client'

// Download one of your own résumés as a PDF — the free export path (/api/resume action
// 'download_resume': no credit, the Seen footer for free accounts, none with Pro).
import { aiHeaders } from './aiHeaders'

/** → null when the download started, else the message to show. */
export async function downloadResumePdf(text: string, label = ''): Promise<string | null> {
  if (!text || text.trim().length < 30) return 'There is no résumé text to download.'
  try {
    const res = await fetch('/api/resume', {
      method: 'POST', headers: await aiHeaders(),
      body: JSON.stringify({ action: 'download_resume', resume: text, template: 'classic' }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({})) as { error?: string }
      return d.error || 'Could not build the PDF — try again.'
    }
    const blob = await res.blob()
    const fromHeader = /filename\*=UTF-8''([^;]+)/i.exec(res.headers.get('Content-Disposition') || '')
    let name = 'Resume.pdf'
    try { if (fromHeader) name = decodeURIComponent(fromHeader[1]) } catch { /* keep the default */ }
    const clean = label.replace(/[^\w .'-]/g, '').trim()
    if (!fromHeader && clean) name = `${clean}.pdf`
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
    return null
  } catch {
    return 'Could not build the PDF — try again.'
  }
}
