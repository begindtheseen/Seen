// The admin's runtime: ONE api, ONE session gate, ONE cache, ONE job manager per browser tab, created
// on first use (never on the server). Everything else (hooks, shell, sections) reads them from here
// through the provider, so a test or a second tab never shares state by accident.
import { createAdminApi, createAdminDownload, createReauthGate, saveBlob, type AdminApi, type AdminDownload, type ReauthGate } from './api.ts'
import { QueryCache } from './cache.ts'
import { createJobManager, JOBS_STORAGE_KEY, type JobManager } from './jobs.ts'
import { TOKEN_KEY, USER_KEY } from './login.ts'

export type AdminRuntime = { api: AdminApi; gate: ReauthGate; cache: QueryCache; jobs: JobManager; download?: AdminDownload }

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
  const jobs = createJobManager({
    api,
    storage: { get: () => sget(JOBS_STORAGE_KEY), set: (v) => sset(JOBS_STORAGE_KEY, v) },
    invalidate: (touched) => cache.invalidate(touched),
  })
  const download = createAdminDownload({ getToken: tokenStore.get, reauth: () => (tokenStore.get() ? gate.wait() : Promise.resolve(false)), save: saveBlob })
  runtime = { api, gate, cache, jobs, download }
  return runtime
}
