'use client'

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { _sync } from './sync'
import type { UserProfile } from './types'

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
  // shared device doesn't inherit the previous user's recent searches / job cache.
  'seen_recent_v1', 'seen_job_cache_v1',
]

function clearSessionLocalData() {
  try { SESSION_LOCAL_KEYS.forEach(k => localStorage.removeItem(k)) } catch { /* ignore */ }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [ready, setReady] = useState(false)

  const getToken = useCallback(async (): Promise<string | null> => {
    try {
      const { data } = await supabase.auth.getSession()
      return data?.session?.access_token || null
    } catch { return null }
  }, [])

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
  const accountType = profile?.account_type || profile?.type
  const isEmployer = isLoggedIn && accountType === 'employer'
  const isSeeker = isLoggedIn && accountType !== 'employer'

  return (
    <AuthContext.Provider value={{ user, profile, isLoggedIn, isSeeker, isEmployer, ready, token: getToken, loadProfile }}>
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
