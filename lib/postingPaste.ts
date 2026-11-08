// What the posting paste boxes accept: the posting's text, or its link (the server reads the link —
// lib/server/postingGate.js → lib/server/fullPosting.js readPostingLink).

const LINK_RE = /^\s*(?:https?:\/\/|www\.)\S+\s*$|^\s*[a-z0-9-]+(?:\.[a-z0-9-]+)+\.[a-z]{2,}\/\S+\s*$/i

/** The text is a single link to a posting. */
export function isPostingLink(text: string): boolean {
  return LINK_RE.test(String(text || ''))
}

/** Enough to check: a link, or text long enough to be a posting. */
export function postingPasteReady(text: string): boolean {
  const t = String(text || '').trim()
  return isPostingLink(t) || t.length >= 200
}
