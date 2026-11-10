// The admin's runtime: ONE api, ONE session gate, ONE cache, ONE job manager per browser tab, created
// on first use (never on the server). Everything else (hooks, shell, sections) reads them from here
// through the provider, so a test or a second tab never shares state by accident.
import { createAdminApi, createAdminDownload, createReauthGate, saveBlob, type AdminApi, type AdminDownload, type ReauthGate } from './api.ts'
import { QueryCache } from './cache.ts'
import { createUndoBus, type UndoBus } from './action.ts'
import { createResultDock, type ResultDock } from './dock.ts'
import { createJobManager, JOB_STATUS_KIND, JOBS_STORAGE_KEY, type JobManager } from './jobs.ts'
import { TOKEN_KEY, USER_KEY } from './login.ts'

export type AdminRuntime = { api: AdminApi; gate: ReauthGate; cache: QueryCache; jobs: JobManager; download?: AdminDownload; undoBus?: UndoBus; dock?: ResultDock }

function sget(key: string): string | null {
  try { return window.sessionStorage.getItem(key) } catch { return null }
}
function sset(key: string, value: string | null) {
  try {
    if (value == null) window.sessionStorage.removeItem(key)
    else window.sessionStorage.setItem(key, value)
  } catch { /* private window / blocked storage: the session lasts as long as the page */ }
}

let memToken: string | null = null
export const tokenStore = {
  get: (): string | null => sget(TOKEN_KEY) ?? memToken,
  set: (token: string | null, username?: string | null) => {
    memToken = token
    sset(TOKEN_KEY, token)
    if (username !== undefined) sset(USER_KEY, username)
  },
  username: (): string | null => sget(USER_KEY),
}

let runtime: AdminRuntime | null = null

export function getRuntime(): AdminRuntime {
  if (runtime) return runtime
  const gate = createReauthGate()
  // Signed out on purpose (no token): a late 401 is just a failure, not a sign-in sheet.
  const api = createAdminApi({ getToken: tokenStore.get, reauth: () => (tokenStore.get() ? gate.wait() : Promise.resolve(false)) })
  const cache = new QueryCache()
  const undoBus = createUndoBus()
  const jobs = createJobManager({
    api,
    undoBus,
    statusRead: async (job) => {
      // The server's truth for a job a reload interrupted: `job_status { kind }` → { remaining, complete }
      // (SHAPES.md). A job action with no kind keeps the honest "not known" (null).
      const kind = job.status_kind || JOB_STATUS_KIND[job.action]
      if (!kind) return null
      const r = await api<{ remaining?: number | null; complete?: boolean }>('job_status', { kind })
      if (!r.ok) return null
      return { remaining: typeof r.remaining === 'number' ? r.remaining : null, done: null, complete: r.complete === true }
    },
    storage: { get: () => sget(JOBS_STORAGE_KEY), set: (v) => sset(JOBS_STORAGE_KEY, v) },
    invalidate: (touched) => cache.invalidate(touched),
  })
  const download = createAdminDownload({ getToken: tokenStore.get, reauth: () => (tokenStore.get() ? gate.wait() : Promise.resolve(false)), save: saveBlob })
  runtime = { api, gate, cache, jobs, download, undoBus, dock: createResultDock() }
  return runtime
}
