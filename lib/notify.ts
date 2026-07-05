// App-wide notification bus. Any client code can call notify(...) to pop a toast; ToastHost
// (mounted once in app/layout.tsx) listens for the 'seen:notify' window event and renders it.
// This extends the existing seen:* CustomEvent pattern (seen:credits-updated, seen:open-survey).

export type NotifySeverity = 'info' | 'success' | 'money' | 'warn' | 'error'

export type NotifyPayload = {
  title: string
  sub?: string
  severity?: NotifySeverity
  /** Stable key to de-dupe repeat fires within a short window. */
  key?: string
  /** ms before auto-dismiss; 0 = sticky. Default 5000. */
  duration?: number
}

export const NOTIFY_EVENT = 'seen:notify'

export function notify(payload: NotifyPayload) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(NOTIFY_EVENT, { detail: payload }))
}
