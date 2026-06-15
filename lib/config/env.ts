// Centralized environment access.
//
// Rules:
// - Server secrets are read LAZILY (inside functions), never inlined at module
//   load, so this module is safe to import from shared code.
// - Server secrets (SUPABASE_SERVICE_KEY, STRIPE_*, SUPABASE_JWT_SECRET, etc.) are
//   NOT prefixed NEXT_PUBLIC_, so they are `undefined` in the browser bundle.
//   Never reference `serverEnv` from a client component.
// - `publicEnv` holds browser-safe values only (the Supabase URL + anon key are
//   intentionally public, protected by RLS).

function read(name: string): string | undefined {
  const value = process.env[name]
  return value && value.length > 0 ? value : undefined
}

export function requireEnv(name: string): string {
  const value = read(name)
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

export function optionalEnv(name: string): string | undefined {
  return read(name)
}

// ── Public (browser-safe) configuration ──────────────────────────────────────
// Falls back to the known public project values so existing behavior is preserved
// when the NEXT_PUBLIC_* vars are unset. The anon key is public by design.
const FALLBACK_SUPABASE_URL = 'https://tmngmmofrplsldvlobfx.supabase.co'
const FALLBACK_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRtbmdtbW9mcnBsc2xkdmxvYmZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3OTk3ODYsImV4cCI6MjA5MzM3NTc4Nn0.kAL3GbMilYTM3z7Ct4YM2nTh3n-f1UXXqiDHOl3fsRc'

export const publicEnv = {
  supabaseUrl: read('NEXT_PUBLIC_SUPABASE_URL') ?? FALLBACK_SUPABASE_URL,
  supabaseAnonKey: read('NEXT_PUBLIC_SUPABASE_ANON_KEY') ?? FALLBACK_SUPABASE_ANON_KEY,
} as const

// ── Server-only accessors ─────────────────────────────────────────────────────
// Call these INSIDE request handlers, not at module top level.
export const serverEnv = {
  supabaseUrl: () => read('SUPABASE_URL'),
  supabaseServiceKey: () => read('SUPABASE_SERVICE_KEY'),
  supabaseJwtSecret: () => read('SUPABASE_JWT_SECRET'),
  adminEmail: () => read('ADMIN_EMAIL'),
  stripeSecretKey: () => read('STRIPE_SECRET_KEY'),
  stripeWebhookSecret: () => read('STRIPE_WEBHOOK_SECRET'),
  stripePriceMonthly: () => read('STRIPE_PRICE_ID_MONTHLY'),
  stripePriceYearly: () => read('STRIPE_PRICE_ID_YEARLY'),
  anthropicApiKey: () => read('ANTHROPIC_API_KEY'),
} as const

export interface SupabaseServerConfig {
  url: string
  serviceKey: string
}

// Resolve the Supabase service-role configuration or throw. Use at the start of a
// server handler that needs privileged DB access.
export function requireSupabaseServer(): SupabaseServerConfig {
  return {
    url: requireEnv('SUPABASE_URL'),
    serviceKey: requireEnv('SUPABASE_SERVICE_KEY'),
  }
}
