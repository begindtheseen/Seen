// THE way the admin talks to the server. Every request goes through `createAdminApi` (the shell's one
// instance is `adminApi` in ./client.ts), so token, timeout, a session that ended and a broken answer
// are each handled once, here, and every screen gets the same contract shape back:
//   · success → AdminOk (missing contract fields filled in: changed 0, skipped [], touched [], message '')
//   · anything else → AdminErr with a sentence a person can act on — never "Unexpected token <",
//     never "Failed to fetch", never a silent nothing.
// A 401 asks the session gate for a fresh sign-in and REPLAYS the same request once, so the action the
// owner pressed finishes after he signs in, on the same page, with nothing reloaded.
//
// Pure (fetch + token + gate injected) — unit-tested in core.test.mjs.
import type { AdminErr, AdminOk } from '../contract.ts'

export const ADMIN_ENDPOINT = '/api/admin-stats'
export const DEFAULT_TIMEOUT_MS = 30_000

export type ApiOk<T> = AdminOk & T
export type ApiResult<T = Record<string, unknown>> = ApiOk<T> | AdminErr

export type ApiCallOpts = {
  timeoutMs?: number
  signal?: AbortSignal
  /** Do not ask for a sign-in on 401 (the login call itself, sign-out). */
  noReauth?: boolean
}

export type AdminApiDeps = {
  fetchImpl?: typeof fetch
  getToken: () => string | null
  /** Called on a 401. Resolves true once the owner has signed in again (the call is replayed). */
  reauth?: () => Promise<boolean>
  endpoint?: string
  defaultTimeoutMs?: number
}

export type AdminApi = <T = Record<string, unknown>>(action: string, body?: Record<string, unknown>, opts?: ApiCallOpts) => Promise<ApiResult<T>>

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

export function err(code: string, error: string, retryable: boolean, extra: Partial<AdminErr> = {}): AdminErr {
  return { ok: false, code, error, retryable, ...extra }
}

const CODE_BY_STATUS: Record<number, string> = {
  400: 'bad_request', 401: 'unauthorized', 403: 'forbidden', 404: 'not_found', 409: 'conflict',
  413: 'bad_request', 422: 'bad_request', 429: 'rate_limited', 502: 'upstream', 503: 'upstream', 504: 'timeout',
}

/** A short, human reading of a status the server gave no words for. */
function statusSentence(status: number): string {
  if (status === 401) return 'Your admin session ended. Sign in to continue.'
  if (status === 403) return 'This admin account is not allowed to do that.'
  if (status === 404) return 'The server does not know this request (HTTP 404).'
  if (status === 429) return 'Too many requests in a short time. Wait a minute, then try again.'
  if (status === 503) return "Couldn't reach the server just now (HTTP 503). Try again in a moment."
  if (status === 504) return 'The server ran out of time (HTTP 504). Part of it may have finished — refresh to see what changed.'
  if (status >= 500) return `The server failed (HTTP ${status}). It is not known whether anything was changed — refresh to check.`
  return `The server refused the request (HTTP ${status}).`
}

/**
 * Turn one HTTP answer into the contract. `text` is the raw body (it may be empty or HTML).
 * Exported for the tests: every branch here is a case the owner has seen go wrong.
 */
export function toResult<T = Record<string, unknown>>(status: number, text: string): ApiResult<T> {
  const trimmed = (text || '').trim()
  let json: Record<string, unknown> | null = null
  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed)
      json = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : { data: parsed }
    } catch { json = null }
  }

  const okStatus = status >= 200 && status < 300
  if (!json) {
    if (okStatus) {
      return err('upstream', trimmed
        ? `The server's answer could not be read (HTTP ${status}). It is not known whether this went through — refresh to check.`
        : `The server's answer was empty (HTTP ${status}). It is not known whether this went through — refresh to check.`, true)
    }
    if (status === 401 || status === 403) return err(CODE_BY_STATUS[status], statusSentence(status), false)
    return err(CODE_BY_STATUS[status] || (status >= 500 ? 'upstream' : 'bad_request'), statusSentence(status), status >= 500 || status === 429)
  }

  if (!okStatus || json.ok === false) {
    const code = typeof json.code === 'string' && json.code ? json.code
      : CODE_BY_STATUS[status] || (status >= 500 ? 'upstream' : okStatus ? 'bad_request' : 'bad_request')
    const words = [json.error, json.message, json.detail].find((v) => typeof v === 'string' && v.trim()) as string | undefined
    const retryable = typeof json.retryable === 'boolean' ? json.retryable : (status >= 500 || status === 429 || code === 'timeout')
    const out = err(code, words ? words.trim() : statusSentence(status), retryable)
    if (typeof json.changed === 'number') out.changed = json.changed
    if (typeof json.remaining === 'number') out.remaining = json.remaining
    // Extra facts the server attached (e.g. retry_after / locked_until on a lockout) ride along.
    for (const k of ['retry_after', 'locked_until']) if (json[k] != null) (out as Record<string, unknown>)[k] = json[k]
    return out
  }

  return {
    ...(json as object),
    ok: true,
    changed: num(json.changed),
    skipped: Array.isArray(json.skipped) ? json.skipped as AdminOk['skipped'] : [],
    touched: Array.isArray(json.touched) ? (json.touched as unknown[]).filter((t) => typeof t === 'string') as string[] : [],
    message: typeof json.message === 'string' ? json.message : '',
  } as ApiOk<T>
}

export function createAdminApi(deps: AdminApiDeps): AdminApi {
  const endpoint = deps.endpoint || ADMIN_ENDPOINT
  const fetchImpl = deps.fetchImpl || ((...a: Parameters<typeof fetch>) => fetch(...a))
  const defaultTimeout = deps.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS

  async function once<T>(action: string, body: Record<string, unknown>, opts: ApiCallOpts): Promise<ApiResult<T>> {
    const token = deps.getToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['X-Admin-Token'] = token
    const ctl = new AbortController()
    const timeoutMs = opts.timeoutMs ?? defaultTimeout
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; ctl.abort() }, timeoutMs)
    const onOuterAbort = () => ctl.abort()
    opts.signal?.addEventListener('abort', onOuterAbort)
    try {
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...body, action }),
        cache: 'no-store',
        signal: ctl.signal,
      })
      let text = ''
      try { text = await res.text() } catch { text = '' }
      return toResult<T>(res.status, text)
    } catch (e) {
      if (timedOut) {
        const secs = Math.round(timeoutMs / 1000)
        return err('timeout', `No answer from the server after ${secs} seconds. It may still finish — refresh to see what changed before trying again.`, true)
      }
      if (opts.signal?.aborted) return err('cancelled', 'Cancelled.', false)
      void e
      return err('network', "Couldn't reach the server. Check the connection, then try again.", true)
    } finally {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onOuterAbort)
    }
  }

  return async function adminApi<T = Record<string, unknown>>(action: string, body: Record<string, unknown> = {}, opts: ApiCallOpts = {}) {
    const first = await once<T>(action, body, opts)
    if (first.ok || first.code !== 'unauthorized' || opts.noReauth || !deps.reauth) return first
    // The session ended mid-work: ask for a sign-in (one sheet for every waiting call) and replay once.
    const signedIn = await deps.reauth().catch(() => false)
    if (!signedIn) return err('unauthorized', 'Not done — you are signed out. Sign in and try again.', false)
    return once<T>(action, body, opts)
  }
}

// ── The session gate: many calls may hit a 401 at once; the owner signs in ONCE and all of them replay.

export type ReauthGate = {
  /** A promise shared by every caller until the sign-in sheet is answered. */
  wait: () => Promise<boolean>
  /** Answer the sheet: true = signed in (replay), false = cancelled. */
  settle: (signedIn: boolean) => void
  isWaiting: () => boolean
  subscribe: (fn: () => void) => () => void
}

export function createReauthGate(): ReauthGate {
  let pending: { promise: Promise<boolean>; resolve: (v: boolean) => void } | null = null
  const subs = new Set<() => void>()
  const emit = () => subs.forEach((f) => { try { f() } catch { /* ignore */ } })
  return {
    wait() {
      if (!pending) {
        let resolve!: (v: boolean) => void
        const promise = new Promise<boolean>((r) => { resolve = r })
        pending = { promise, resolve }
        emit()
      }
      return pending.promise
    },
    settle(signedIn) {
      const p = pending
      pending = null
      if (p) p.resolve(signedIn)
      emit()
    },
    isWaiting: () => !!pending,
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn) } },
  }
}

// ── Downloads (binary endpoints: legal-audit PDF / package, exports) ─────────────────────────────

/** The file name from a Content-Disposition header (RFC 5987 `filename*` first), or null. Pure for the test. */
export function filenameFrom(header: string | null | undefined): string | null {
  if (!header) return null
  const star = header.match(/filename\*\s*=\s*(?:UTF-8|utf-8)?''([^;]+)/)
  if (star) { try { return decodeURIComponent(star[1].trim().replace(/^"|"$/g, '')) } catch { /* fall through */ } }
  const plain = header.match(/filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;]+)/)
  const name = plain ? (plain[1] || plain[2] || '').trim() : ''
  return name ? name.replace(/[\\/]/g, '_') : null
}

export type DownloadOk = { ok: true; filename: string; bytes: number; message: string }
export type AdminDownload = (endpoint: string, body?: Record<string, unknown>, opts?: ApiCallOpts & { fallbackName?: string }) => Promise<DownloadOk | AdminErr>

/**
 * POST `body` to a binary endpoint with the admin token and hand the answer to `save(blob, filename)`.
 * Same failure sentences as adminApi (a JSON or HTML error body becomes an AdminErr; an empty file is an
 * error, never a 0-byte download), and a 401 asks for a sign-in and replays the request.
 */
export function createAdminDownload(deps: AdminApiDeps & { save: (blob: Blob, filename: string) => void }): AdminDownload {
  const fetchImpl = deps.fetchImpl || ((...a: Parameters<typeof fetch>) => fetch(...a))
  async function once(endpoint: string, body: Record<string, unknown>, opts: ApiCallOpts & { fallbackName?: string }): Promise<DownloadOk | AdminErr> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const token = deps.getToken()
    if (token) headers['X-Admin-Token'] = token
    const ctl = new AbortController()
    const timeoutMs = opts.timeoutMs ?? 120_000
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; ctl.abort() }, timeoutMs)
    try {
      const res = await fetchImpl(endpoint, { method: 'POST', headers, body: JSON.stringify(body), cache: 'no-store', signal: ctl.signal })
      if (res.status < 200 || res.status >= 300) {
        let text = ''
        try { text = await res.text() } catch { /* ignore */ }
        const r = toResult(res.status, text)
        return r.ok ? err('upstream', `The download failed (HTTP ${res.status}).`, true) : r
      }
      const type = res.headers.get('content-type') || ''
      // A JSON success here means the endpoint answered data, not a file: never save it as one silently.
      if (/application\/json/.test(type) && !/attachment/.test(res.headers.get('content-disposition') || '')) {
        const r = toResult(res.status, await res.text())
        return r.ok ? err('upstream', 'The server answered with data instead of a file. Nothing was downloaded.', false) : r
      }
      const blob = await res.blob()
      if (!blob.size) return err('upstream', 'The server sent an empty file. Nothing was downloaded — try again.', true)
      const filename = filenameFrom(res.headers.get('content-disposition')) || opts.fallbackName || 'download'
      deps.save(blob, filename)
      const kb = Math.max(1, Math.round(blob.size / 1024))
      return { ok: true, filename, bytes: blob.size, message: `Downloaded ${filename} (${kb.toLocaleString('en-US')} KB).` }
    } catch {
      if (timedOut) return err('timeout', `No file from the server after ${Math.round(timeoutMs / 1000)} seconds. Try again; a large package can take a minute.`, true)
      return err('network', "Couldn't reach the server. Check the connection, then try again.", true)
    } finally { clearTimeout(timer) }
  }
  return async (endpoint, body = {}, opts = {}) => {
    const first = await once(endpoint, body, opts)
    if (first.ok || first.code !== 'unauthorized' || opts.noReauth || !deps.reauth) return first
    const signedIn = await deps.reauth().catch(() => false)
    if (!signedIn) return err('unauthorized', 'Not downloaded — you are signed out. Sign in and try again.', false)
    return once(endpoint, body, opts)
  }
}

/** Hand a file to the browser (one save per call; the object URL is released afterwards). */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

/** Save text the server returned inside JSON (`export_csv` → { csv, filename }). */
export function saveText(text: string, filename: string, type = 'text/plain;charset=utf-8') {
  saveBlob(new Blob([text], { type }), filename)
}
