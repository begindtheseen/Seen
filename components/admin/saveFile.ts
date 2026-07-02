// Reliable client-side file save that works on iOS Safari too.
//
// The old admin exports built an object-URL anchor and clicked it AFTER an
// awaited fetch — iOS blocks that (the click is no longer inside the user
// gesture, and Safari won't honour `download` on a blob anchor anyway), so the
// file could be *viewed* but never *saved*. Callers must therefore fetch FIRST,
// then call saveFile directly from the button's onClick (no await before it).
//
// iOS path: Web Share with a File → the native share sheet ("Save to Files").
//           A user-cancelled share throws AbortError, which is not an error.
// Desktop path: object URL + a DOM-appended anchor + click + a DEFERRED revoke
//           (revoking synchronously can cancel the download in some browsers).
export async function saveFile(filename: string, mime: string, content: string | Blob): Promise<void> {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime })

  // iOS / mobile share-sheet path.
  try {
    const file = new File([blob], filename, { type: mime })
    const nav = navigator as Navigator & {
      canShare?: (data?: ShareData) => boolean
      share?: (data: ShareData) => Promise<void>
    }
    if (nav.canShare?.({ files: [file] }) && nav.share) {
      try {
        await nav.share({ files: [file], title: filename })
        return
      } catch (e) {
        // User dismissed the share sheet — that's a normal cancel, not a failure.
        if ((e as Error).name === 'AbortError') return
        // Any other share failure → fall through to the desktop download path.
      }
    }
  } catch {
    // File/Share unsupported — fall through to the desktop path.
  }

  // Desktop download path.
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Never revoke synchronously — that can abort the download mid-flight.
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
