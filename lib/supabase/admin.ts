// Service-role Supabase access. This BYPASSES Row Level Security — only use it
// from trusted server code AFTER the caller has been authenticated and authorized.
//
// SECURITY: never import this module from a client component. The service key is
// read lazily from a non-public env var, so it is `undefined` in the browser, but
// the runtime guard below makes accidental client use fail loudly.
//
// This centralizes the `db(path, opts)` PostgREST helper that is currently
// copy-pasted across api/*.js.

import { requireSupabaseServer } from '../config/env'

function assertServer(): void {
  if (typeof window !== 'undefined') {
    throw new Error('lib/supabase/admin.ts must never be imported in the browser')
  }
}

export type ServiceDb = (path: string, opts?: RequestInit) => Promise<Response>

// Build a service-role PostgREST fetch helper.
// `prefer` maps to the PostgREST `Prefer` header (e.g. `return=representation`,
// `return=minimal`).
export function createServiceDb(prefer = 'return=representation'): ServiceDb {
  assertServer()
  const { url, serviceKey } = requireSupabaseServer()
  return (path, opts = {}) =>
    fetch(`${url}/rest/v1/${path}`, {
      ...opts,
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: prefer,
        ...((opts.headers as Record<string, string>) || {}),
      },
    })
}

// Call a Postgres function via PostgREST RPC with the service key.
export async function serviceRpc<T = unknown>(
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  assertServer()
  const { url, serviceKey } = requireSupabaseServer()
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  })
  if (!res.ok) throw new Error(`RPC ${fn} failed: ${res.status}`)
  return res.json() as Promise<T>
}
