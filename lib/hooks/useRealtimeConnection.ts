import { useEffect } from 'react';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { LIVE_TOPIC } from '@/lib/server/realtime';

type Payload = { kind: string; t: number };

export function useRealtimeConnection(onMessage: (payload: Payload) => void) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey);

  useEffect(() => {
    const channel = supabase.channel(LIVE_TOPIC);
    const subscription = channel
      .on('broadcast', { event: 'activity' }, (payload) => {
        // payload.payload contains our custom data
        onMessage?.(payload.payload as Payload);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, onMessage]);
}

// NOTE: broadcasting is a SERVER-ONLY operation. It requires the Supabase
// service_role key, which must never reach the browser. Client code must never
// read a service key — a `NEXT_PUBLIC_*` service key would be inlined into the
// JS bundle and handed to every visitor, giving them full RLS-bypass access to
// the database. Emit live events from a server handler via
// `broadcastActivity()` in `lib/server/realtime.js` (or POST to a token-authed
// API route) instead.
