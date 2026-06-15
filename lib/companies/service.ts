// Companies service — business logic extracted from api/user-sync.js. Pure logic:
// receives a service-role DB accessor and the AUTHENTICATED uid; never reads
// identity from a request body.

import type { ServiceDb } from '../supabase/admin.ts'

export interface RecentCompaniesResult {
  recent: unknown[]
}

// Loads the caller's own recently-viewed companies. Ownership enforced by the
// `user_id=eq.<uid>` filter; `uid` MUST come from verified auth. Faithful port of
// the `get_recent_cos` action:
//   db('user_recent_cos?user_id=eq.${uid}&order=viewed_at.desc&limit=6') -> { recent: rows }
export async function getRecentCompanies(
  db: ServiceDb,
  uid: string,
): Promise<RecentCompaniesResult> {
  const r = await db(`user_recent_cos?user_id=eq.${uid}&order=viewed_at.desc&limit=6`)
  const rows = (r.ok ? await r.json() : []) as unknown[]
  return { recent: rows }
}
