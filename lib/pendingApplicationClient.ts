'use client'

// The browser half of "the application rides with the sign-up" (lib/trackCapture.ts).
//
// A guest who tracks an application and then signs up carries it in user_metadata.pending_applications
// (company, role, applied_at and the tracker's own client id). On the account's first sign-in, on ANY
// device, this creates the ones the account does not have yet, then clears the metadata. The same
// browser's device-local copy is uploaded by AppStore.loadBundle first (it sends the same client id,
// which the server dedupes on), so the application is never created twice.

import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { AppStore } from './stores/AppStore'
import { applicationFromPending, pendingFromGuestApps, pendingToCreate, type PendingApplication } from './trackCapture.ts'

export const PENDING_META_KEY = 'pending_applications'

/** What a seeker sign-up carries: this device's guest applications (none for an empty device). */
export function pendingApplicationsForSignup(): PendingApplication[] {
  try { return pendingFromGuestApps(AppStore.loadSync()) } catch { return [] }
}

const done = new Set<string>()

/** Create the sign-up's pending applications on this account, once per account per tab. */
export async function importPendingApplications(user: User | null | undefined): Promise<number> {
  if (!user?.id || done.has(user.id)) return 0
  const meta = (user.user_metadata || {}) as Record<string, unknown>
  const pending = meta[PENDING_META_KEY]
  if (!Array.isArray(pending) || pending.length === 0) return 0
  if (meta.account_type === 'employer' || meta.role_type === 'employer') return 0
  done.add(user.id)
  try {
    // Uploads this browser's own guest copies first (same client ids) and returns the account's rows.
    const bundle = await AppStore.loadBundle(true)
    if (!bundle) { done.delete(user.id); return 0 } // the account could not be read: try on the next load
    let created = 0
    let allSaved = true
    for (const p of pendingToCreate(pending, bundle.applications)) {
      const r = await AppStore.add(applicationFromPending(p), true)
      if (r.ok && r.synced && !r.duplicate) created++
      else if (!r.synced) allSaved = false
    }
    // Every pending application is on the account now (or already was): the metadata has done its job.
    // One that did not reach the account keeps the metadata, so the next sign-in tries again.
    if (allSaved) await supabase.auth.updateUser({ data: { [PENDING_META_KEY]: null } }).catch(() => undefined)
    else done.delete(user.id)
    if (created) window.dispatchEvent(new CustomEvent('seen:applications-imported', { detail: { created } }))
    return created
  } catch {
    done.delete(user.id)
    return 0
  }
}
