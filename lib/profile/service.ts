// Profile service — business logic for user profile reads/writes, extracted from
// api/user-sync.js so it is testable and reusable. Pure logic: it receives a
// service-role DB accessor and the AUTHENTICATED uid, and never reads identity
// from a request body.
//
// NOTE: built but not yet wired into the live api/user-sync.js route — see
// docs/USER_SYNC_AUDIT.md (wiring is gated on the demand Vercel-preview check).

import type { ServiceDb } from '../supabase/admin.ts'

export interface LoadProfileResult {
  profile: Record<string, unknown> | null
}

// Loads the caller's own profile row. Ownership is enforced by the
// `id=eq.<uid>` filter; `uid` MUST come from verified auth (requireUser), never
// from the request body. Faithful port of the `load_profile` action:
//   db('profiles?id=eq.${uid}&limit=1') -> { profile: rows[0] || null }
export async function loadProfile(db: ServiceDb, uid: string): Promise<LoadProfileResult> {
  const r = await db(`profiles?id=eq.${uid}&limit=1`)
  const rows = r.ok ? await r.json() : []
  const profile = Array.isArray(rows) ? (rows[0] ?? null) : null
  return { profile: profile as Record<string, unknown> | null }
}

export interface GetEmploymentResult {
  employment: unknown[]
}

// Loads the caller's own employment history (resume data). Ownership enforced by
// the `user_id=eq.<uid>` filter; `uid` MUST come from verified auth. Faithful port
// of the `get_employment` action:
//   db('resume_employment?user_id=eq.${uid}&order=id.desc&limit=15') -> { employment: rows }
export async function getEmployment(db: ServiceDb, uid: string): Promise<GetEmploymentResult> {
  const r = await db(`resume_employment?user_id=eq.${uid}&order=id.desc&limit=15`)
  const rows = (r.ok ? await r.json() : []) as unknown[]
  return { employment: rows }
}
