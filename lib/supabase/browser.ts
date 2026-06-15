// Canonical import path for the browser (anon-key) Supabase client.
//
// It currently re-exports the existing singleton in `lib/supabase.ts` to guarantee
// a single GoTrue auth instance (creating a second client triggers the
// "Multiple GoTrueClient instances" warning and can desync auth state).
//
// Migration target (docs/REFACTOR_PLAN.md, Phase 1): move the singleton here,
// wire it to `publicEnv` from `lib/config/env.ts`, and have `lib/supabase.ts`
// re-export from this module. Done as a follow-up so this PR changes no behavior.

import { supabase } from '../supabase'

export { supabase, supabase as supabaseBrowser }
