import { supabase } from '@/lib/supabase'

export const CHRONOS_TOPIC = 'chronos-live'

type ChronosEventKind = string | number

/**
 * Broadcast a Chronos event to the public Supabase Realtime channel.
 * The payload only contains a non‑sensitive `kind` identifier.
 *
 * @param kind - Identifier for the Chronos event (e.g. "job_created", "task_updated")
 */
export async function broadcastChronosEvent(kind: ChronosEventKind): Promise<void> {
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
  if (!SUPABASE_URL || !SERVICE_KEY) return

  try {
    await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          {
            topic: CHRONOS_TOPIC,
            event: 'activity',
            payload: { kind: String(kind), t: Date.now() },
          },
        ],
      }),
      // Ensure the broadcast does not block the caller
      signal: AbortSignal.timeout(2500),
    })
  } catch {
    // Silently ignore – the client will still poll via its own endpoint
  }
}

/**
 * Subscribe to the Chronos live channel. Calls the supplied callback
 * whenever a broadcast is received. Returns a cleanup function to
 * unsubscribe.
 *
 * @param onEvent - Callback invoked with the broadcast payload
 * @returns Unsubscribe function
 */
export function subscribeChronosLive(onEvent: (payload: { kind: string; t: number }) => void) {
  let channel: ReturnType<typeof supabase.channel> | null = null
  try {
    channel = supabase
      .channel(CHRONOS_TOPIC)
      .on('broadcast', { event: 'activity' }, ({ payload }) => {
        if (payload && typeof payload.kind === 'string') {
          onEvent(payload as { kind: string; t: number })
        }
      })
      .subscribe()
  } catch {
    // If the realtime connection fails, the caller can fall back to polling.
    channel = null
  }

  return () => {
    if (channel) {
      try {
        supabase.removeChannel(channel)
      } catch {
        // ignore removal errors
      }
    }
  }
}
