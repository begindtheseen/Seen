// ── Seen share-card distribution kit ───────────────────────────────────────
// Single source of truth for getting a generated PNG card IN FRONT of people on
// Reddit / X / Threads / LinkedIn — with the IMAGE actually attached, the way big
// sites do it. Used by both CompanyScoreCard and OutcomeCard.
//
// The hard problem: web "share to Reddit/X" intents only carry TEXT + a URL. The
// only ways to attach a real image are (a) the native share sheet on mobile, which
// can hand a File to the Reddit/X apps, and (b) the OS clipboard on desktop, which
// the user pastes into the composer. We do BOTH, with graceful feature detection,
// and we ALWAYS point the intent URL at a page that has a strong OG image so the
// link itself unfurls into an image card as a final fallback.
//
// Order of preference (per platform), all guarded by feature detection:
//   1. navigator.share({ files }) — mobile share sheet → Reddit/X apps attach PNG
//   2. clipboard image write → then open the platform submit URL (desktop)
//   3. open the submit/intent URL whose `url` unfurls the page's OG image
//   4. download the PNG as a last resort so the user can attach it manually
//
// No external services, no keys. Never throws — every API is optional.

export type ShareDest = 'reddit' | 'twitter' | 'threads' | 'linkedin' | 'download'

// How the image actually reached (or will reach) the destination. Drives the
// inline hint/toast the modals show so the user knows what to do next.
export type ShareResult =
  | 'native'           // handed to the OS share sheet with the file attached
  | 'clipboard+open'   // image copied to clipboard, submit page opened — user pastes
  | 'opened'           // submit/intent page opened; image will unfurl from the URL
  | 'downloaded'       // saved the PNG locally so the user can attach it
  | 'cancelled'        // user dismissed the native share sheet
  | 'noop'             // nothing to do (e.g. blob not ready)

export interface ShareCardOptions {
  blob: Blob | null
  dataUrl: string | null
  fileName: string
  // Caption text for the post / tweet.
  text: string
  // A public URL that unfurls into a strong OG image (company page or root).
  url: string
  dest: ShareDest
}

function isMobileLike(): boolean {
  if (typeof navigator === 'undefined') return false
  // Touch-first UAs where the native share sheet routes into installed apps.
  return /android|iphone|ipad|ipod/i.test(navigator.userAgent || '')
    || (navigator.maxTouchPoints || 0) > 1
}

function fileFromBlob(blob: Blob, fileName: string): File {
  return new File([blob], fileName, { type: blob.type || 'image/png' })
}

// True only when the platform can put files on the OS share sheet.
function canNativeFileShare(file: File): boolean {
  try {
    return typeof navigator !== 'undefined'
      && typeof navigator.share === 'function'
      && typeof navigator.canShare === 'function'
      && navigator.canShare({ files: [file] })
  } catch { return false }
}

// Write the PNG to the OS clipboard as an image so the user can paste it into the
// composer. Returns true only on confirmed success. Guarded for the many browsers
// that lack ClipboardItem / image clipboard support (Firefox, older Safari, etc.).
async function copyImageToClipboard(blob: Blob): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined') return false
    const clip = navigator.clipboard
    if (!clip || typeof clip.write !== 'function' || typeof ClipboardItem === 'undefined') return false
    // ClipboardItem only reliably accepts image/png across browsers.
    const png = blob.type === 'image/png' ? blob : new Blob([blob], { type: 'image/png' })
    await clip.write([new ClipboardItem({ 'image/png': png })])
    return true
  } catch {
    return false
  }
}

function submitUrl(dest: ShareDest, text: string, url: string): string | null {
  const t = encodeURIComponent(text)
  const u = encodeURIComponent(url)
  switch (dest) {
    case 'reddit':
      // Pre-fill title + the unfurling URL so even the text-only path renders an image card.
      return `https://www.reddit.com/submit?title=${t}&url=${u}`
    case 'twitter':
      return `https://twitter.com/intent/tweet?text=${t}&url=${u}`
    case 'threads':
      return `https://www.threads.net/intent/post?text=${encodeURIComponent(text + '\n\n' + url)}`
    case 'linkedin':
      // LinkedIn's feed composer can't take a url param reliably; share the URL so it unfurls.
      return `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(text + '\n\n' + url)}`
    default:
      return null
  }
}

function downloadPng(dataUrl: string, fileName: string) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = fileName
  a.click()
}

// Open the destination URL in a way popup-blockers tolerate (it's inside the
// original click handler's async chain, which most browsers still honor).
function openDest(dest: ShareDest, text: string, url: string) {
  const target = submitUrl(dest, text, url)
  if (target) window.open(target, '_blank', 'noopener')
}

/**
 * Distribute a generated card to a social destination with the image attached
 * wherever the platform allows. Never throws. The caller can use the returned
 * ShareResult to show the right inline hint (e.g. "image copied — paste it in").
 */
export async function shareCardImage(opts: ShareCardOptions): Promise<ShareResult> {
  const { blob, dataUrl, fileName, text, url, dest } = opts

  // Explicit "download" button: just save the PNG.
  if (dest === 'download') {
    if (dataUrl) { downloadPng(dataUrl, fileName); return 'downloaded' }
    return 'noop'
  }

  const file = blob ? fileFromBlob(blob, fileName) : null

  // 1. MOBILE FIRST — native share sheet hands the File to the Reddit/X/etc app.
  //    This is the path that actually attaches the image on phones.
  if (file && isMobileLike() && canNativeFileShare(file)) {
    try {
      await navigator.share({ files: [file], text, url })
      return 'native'
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return 'cancelled'
      // Fall through to the desktop/web paths below.
    }
  }

  // 2. DESKTOP — copy the image to the clipboard, THEN open the submit page so the
  //    user can paste the image into the composer. The URL still unfurls as a card.
  let copied = false
  if (blob) copied = await copyImageToClipboard(blob)
  openDest(dest, text, url)

  // 3/4. If we couldn't get the image onto the clipboard and native share wasn't
  //      available, save the PNG so the user can attach it manually. The opened
  //      URL still unfurls the OG image as the baseline image preview.
  if (copied) return 'clipboard+open'
  if (dataUrl) { downloadPng(dataUrl, fileName); return 'opened' }
  return 'opened'
}

// Human-readable hint for the inline toast, keyed off the ShareResult.
export function shareHint(result: ShareResult, dest: ShareDest): string | null {
  const name = dest === 'reddit' ? 'Reddit'
    : dest === 'twitter' ? 'X'
    : dest === 'threads' ? 'Threads'
    : dest === 'linkedin' ? 'LinkedIn'
    : 'the post'
  switch (result) {
    case 'clipboard+open':
      return `Image copied — paste it (⌘/Ctrl+V) into your ${name} post.`
    case 'opened':
      return `${name} opened — your card was also saved so you can attach it.`
    case 'downloaded':
      return 'Image saved to your downloads.'
    case 'native':
    case 'cancelled':
    case 'noop':
    default:
      return null
  }
}
