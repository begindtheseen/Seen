// "What Seen read" — the confirmation row every paste box shows before anything is scored (UX audit F8).
//
// A Saxbys link pasted into the Petco sheet was scored as "79 · Sales Associate · Petco": nothing said the
// sheet was now about another posting. These helpers turn what the person pasted, plus what the server
// answered, into the facts the row prints. Nothing here invents a field: a title, an employer or a
// requirement count is shown only when the server returned it (or, for a pasted text inside a job's own
// sheet, when it is that job's own listing).

const LINK_RE = /^\s*(?:https?:\/\/|www\.)\S+\s*$|^\s*[a-z0-9-]+(?:\.[a-z0-9-]+)+\.[a-z]{2,}\/\S+\s*$/i

/** The pasted text is a single link. */
export function isLinkPaste(text) {
  return LINK_RE.test(String(text || ''))
}

/** Host of a pasted link, without "www." — or null when the paste is not a link. */
export function linkHost(text) {
  const t = String(text || '').trim()
  if (!isLinkPaste(t)) return null
  try {
    const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`)
    return u.hostname.replace(/^www\./i, '').toLowerCase() || null
  } catch { return null }
}

/** Same site? (a pasted link to the listing's own page is the same posting; another host is not). */
export function sameHost(a, b) {
  const h = (x) => { try { return new URL(String(x)).hostname.replace(/^www\./i, '').toLowerCase() } catch { return linkHost(x) } }
  const x = h(a), y = h(b)
  return !!x && !!y && x === y
}

/**
 * The read row's facts.
 * @param {{ pasted: string, server?: { title?: string, company?: string } | null, job?: { title?: string, company?: string } | null, requirements?: number | null }} p
 *   `server` — what the endpoint said it read (title/company from a link); `job` — the listing the sheet is for,
 *   used only for a pasted TEXT (the person pasted this job's own posting).
 */
export function readFacts({ pasted, server = null, job = null, requirements = null }) {
  const host = linkHost(pasted)
  const fromLink = !!host
  const title = String((server && server.title) || (!fromLink && job ? job.title : '') || '').trim()
  const company = String((server && server.company) || (!fromLink && job ? job.company : '') || '').trim()
  const source = fromLink ? `read from ${host}` : 'the text you pasted'
  const n = typeof requirements === 'number' && requirements >= 0 ? requirements : null
  return { fromLink, host, title, company, source, requirements: n }
}

/** One line: "Area Operations Manager · Saxbys · read from jobs.lever.co · 14 requirements". */
export function readLine(f) {
  const parts = []
  const who = [f.title, f.company].filter(Boolean).join(' · ')
  if (who) parts.push(who)
  parts.push(f.source)
  if (f.requirements != null) parts.push(`${f.requirements} requirement${f.requirements === 1 ? '' : 's'} read`)
  return parts.join(' · ')
}
