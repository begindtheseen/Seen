// Request-scoped Supabase client that acts AS the authenticated user, so Row
// Level Security policies are enforced. Pass the caller's access token (from the
// `Authorization: Bearer <token>` header).
//
// Use this for user-owned reads/writes wherever RLS policies exist. Reach for the
// service-role admin client (lib/supabase/admin.ts) only when you must bypass RLS
// AND have already authorized the caller.
//
// This module uses the PUBLIC anon key only — it holds no secrets.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { publicEnv } from '../config/env'

export function createServerClient(accessToken?: string): SupabaseClient {
  return createClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: accessToken
      ? { headers: { Authorization: `Bearer ${accessToken}` } }
      : undefined,
  })
}
