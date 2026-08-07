'use client'

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { _sync } from './sync'
import type { UserProfile } from './types'
import { resolveEmployerCompany, selectActiveClaim } from './server/employerClaims'

/** An employer's request to manage a company (ADMIN-APPROVED CLAIMS model, migration 053).
 *  Only a 'approved' claim grants login-scoped access to that company's employer surfaces. */
export interface EmployerClaim {
  id: string
  company_name: string
  company_display_name?: string | null
  status: 'pending' | 'approved' | 'rejected'
  created_at?: string
  reviewed_at?: string | null
  note?: string | null
}

interface AuthState {
  user: User | null
  profile: UserProfile | null
  isLoggedIn: boolean
  isSeeker: boolean
  isEmployer: boolean
  /** True once the initial getSession() has resolved. Pages MUST wait for this before
   *  redirecting on !isLoggedIn — otherwise a signed-in user deep-linking /tracker gets
   *  bounced to /login (which forwards to /dashboard) while the session is still loading. */
  ready: boolean
  /** The company this employer has an APPROVED claim for (display name), or null. This is the
   *  employer→company link the surfaces scope to when logged in (migration 053). */
  employerCompany: string | null
  /** The employer's single most-relevant claim (approved > pending > rejected) so the portal can
   *  render one honest state. null for seekers / logged-out / employers who haven't claimed. */
  employerClaim: EmployerClaim | null
  /** True once claims have been resolved for the current user (false while an employer's claims
   *  are still loading) — the portal waits on this before showing claim state. */
  claimsReady: boolean
  /** Re-fetch this employer's claims (call after submitting a claim request). */
  reloadClaims: () => Promise<void>
  token: () => Promise<string | null>
  loadProfile: () => Promise<void>
}

const AuthContext = createContext<AuthState>({
  user: null,
  profile: null,
  isLoggedIn: false,
  isSeeker: false,
  isEmployer: false,
  ready: false,
  employerCompany: null,
  employerClaim: null,
  claimsReady: false,
  reloadClaims: async () => {},
  token: async () => null,
  loadProfile: async () => {},
})

// Device-local data written during a signed-in session that must NOT survive into the
// next account/guest on this device. Cleared on sign-out — leaving it caused a previous
// user's applications/saved jobs/check-in history to bleed into whoever used the device
// next (and AppStore's sync loop would even upload them into the next account).
const SESSION_LOCAL_KEYS = [
  'seen_applications_v1', 'seen_saved_v1', 'seen_hevents_v1', 'seen_check_snooze',
  'seen_apply_reminders', 'seen_avoided_apps', 'seen_skip_reasons', 'seen_recent_cos',
  '_seen_survey_done',
  // Device-local search state — must clear on sign-out so the next account on a
  // shared device doesn't inherit the previous user's recent searches / job cache /
  // sticky job-search location.
  'seen_recent_v1', 'seen_job_cache_v1', 'seen_job_location_v1',
]

function clearSessionLocalData() {
  try { SESSION_LOCAL_KEYS.forEach(k => localStorage.removeItem(k)) } catch { /* ignore */ }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [ready, setReady] = useState(false)
  // The employer→company claim link (migration 053). Empty for seekers / logged-out.
  const [claims, setClaims] = useState<EmployerClaim[]>([])
  const [claimsReady, setClaimsReady] = useState(false)

  const getToken = useCallback(async (): Promise<string | null> => {
    try {
      const { data } = await supabase.auth.getSession()
      return data?.session?.access_token || null
    } catch { return null }
  }, [])

  // Fetch this user's company claims via the service-key endpoint (RLS-scoped defense-in-depth on
  // the table; the endpoint returns only the caller's own rows). Resilient: any failure leaves the
  // user un-scoped (falls back to the public ?company= lookup), never blocks the app.
  const reloadClaims = useCallback(async () => {
    try {
      const authToken = await getToken()
      if (!authToken) { setClaims([]); return }
      const r = await fetch('/api/employer-claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ action: 'mine' }),
      })
      if (!r.ok) { setClaims([]); return }
      const d = await r.json() as { claims?: EmployerClaim[] }
      setClaims(Array.isArray(d?.claims) ? d.claims : [])
    } catch {
      setClaims([])
    } finally {
      setClaimsReady(true)
    }
  }, [getToken])

  const loadProfile = useCallback(async () => {
    const currentUser = user
    if (!currentUser) return
    // The signup name lives on the user's own JWT (user_metadata) — safe, always this user.
    const metaName = currentUser.user_metadata?.name || ''
    try {
      const result = await _sync('load_profile') as { profile?: Record<string, unknown> } | null
      const data = (result?.profile || null) as UserProfile | null
      // DATA ISOLATION: the DB is the source of truth for a signed-in user. Do NOT merge in the
      // device-local cache (it can hold a previously signed-in person's name/city on a shared
      // device) and never push a local cache into this account. Only fall back to metaName.
      const merged: UserProfile = {
        ...(data || {}),
        name: data?.name || metaName,
        city: data?.city || '',
        experience: data?.experience || '',
      }
      if (merged.survey_completed) localStorage.setItem('_seen_survey_done', '1')
      setProfile(merged)

      // Backfill the DB with the user's OWN signup name if the row is missing it — never
      // from a shared local cache. Preserve the row's REAL type — hardcoding 'seeker' here
      // would silently demote an employer whose row happened to be missing a name.
      if (data && !data.name && metaName) {
        _sync('save_profile', { profile: { email: currentUser.email || '', type: data.account_type || data.type || 'seeker', name: metaName } }).catch(() => {})
      }
    } catch {
      setProfile(prev => prev || { name: metaName, city: '', experience: '' })
    }
  }, [user])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user)
      }
      setReady(true)
    }).catch(() => setReady(true))

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        setUser(session.user)
      } else if (event === 'TOKEN_REFRESHED' && session?.user) {
        setUser(session.user)
      } else if (event === 'USER_UPDATED' && session?.user) {
        setUser(session.user)
      } else if (event === 'SIGNED_OUT') {
        setUser(null)
        setProfile(null)
        // Wipe this session's device-local data so it can't bleed into (or be uploaded
        // by) the next account or guest on this device.
        clearSessionLocalData()
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  // Load profile whenever user changes
  useEffect(() => {
    if (user) loadProfile()
  }, [user, loadProfile])

  const isLoggedIn = !!user
  // account_type (migration 050, NOT NULL) is the source of truth for employer vs seeker; fall
  // back to the legacy `type` for any older row. Reading the REAL profile row — not a hardcoded
  // 'seeker' — is what lets an employer be routed to the portal instead of the seeker dashboard.
  const profileType = profile?.account_type || profile?.type || ''
  // DEFENSE IN DEPTH: also honor the employer choice recorded on the user's OWN signup JWT
  // (user_metadata, set by app/login/page.tsx). If the profiles row lags or was mislabeled — e.g.
  // a signup created before migration 052 fixed the trigger, which silently wrote account_type
  // 'seeker' — the metadata still carries the real intent, so a genuine employer is never trapped
  // in the seeker login loop (verify → /employers → "sign in" → seeker dashboard → repeat). The
  // metadata can only UPGRADE to employer (never demote) and reflects this user's own choice.
  const metaType = (user?.user_metadata?.account_type || user?.user_metadata?.role_type || user?.user_metadata?.type || '') as string
  const isEmployer = isLoggedIn && (profileType === 'employer' || metaType === 'employer')
  const isSeeker = isLoggedIn && !isEmployer

  // Load claims only for employers (seekers never have any). Re-runs when employer status resolves
  // (profile loads after login). A seeker / logged-out user is claims-ready immediately with none.
  useEffect(() => {
    if (!isLoggedIn) { setClaims([]); setClaimsReady(true); return }
    if (isEmployer) { setClaimsReady(false); reloadClaims() }
    else { setClaims([]); setClaimsReady(true) }
  }, [isLoggedIn, isEmployer, reloadClaims])

  // Only an APPROVED claim grants scope; the active claim drives the portal's honest state.
  const employerCompany = isEmployer ? resolveEmployerCompany(claims) : null
  const employerClaim = (isEmployer ? selectActiveClaim(claims) : null) as EmployerClaim | null

  return (
    <AuthContext.Provider value={{ user, profile, isLoggedIn, isSeeker, isEmployer, ready, employerCompany, employerClaim, claimsReady, reloadClaims, token: getToken, loadProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  return useContext(AuthContext)
}

export function useSession(): Session | null {
  const [session, setSession] = useState<Session | null>(null)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])
  return session
}
