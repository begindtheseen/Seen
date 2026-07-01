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
  token: () => Promise<string | null>
  loadProfile: () => Promise<void>
}

const AuthContext = createContext<AuthState>({
  user: null,
  profile: null,
  isLoggedIn: false,
  isSeeker: false,
  isEmployer: false,
  token: async () => null,
  loadProfile: async () => {},
})

function loadProfileLocal(): Partial<UserProfile> {
  try { return JSON.parse(localStorage.getItem('seen_profile_local') || '{}') } catch { return {} }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)

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
      // from a shared local cache.
      if (data && !data.name && metaName) {
        _sync('save_profile', { profile: { email: currentUser.email || '', type: 'seeker', name: metaName } }).catch(() => {})
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
    })

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
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  // Load profile whenever user changes
  useEffect(() => {
    if (user) loadProfile()
  }, [user, loadProfile])

  const isLoggedIn = !!user
  const isSeeker = isLoggedIn && profile?.type !== 'employer'
  const isEmployer = isLoggedIn && profile?.type === 'employer'

  return (
    <AuthContext.Provider value={{ user, profile, isLoggedIn, isSeeker, isEmployer, token: getToken, loadProfile }}>
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
