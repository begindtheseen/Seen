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

  // Helper to broadcast an activity from the client side if needed
  const broadcast = async (kind: string) => {
    const serviceKey = process.env.NEXT_PUBLIC_SUPABASE_SERVICE_KEY ?? '';
    if (!serviceKey) return;
    try {
      await fetch(`${supabaseUrl}/realtime/v1/api/broadcast`, {
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [
            {
              topic: LIVE_TOPIC,
              event: 'activity',
              payload: { kind: String(kind || 'event'), t: Date.now() },
            },
          ],
        }),
      });
    } catch {
      // swallow errors – fallback polling will still work
    }
  };

  return { broadcast };
}
