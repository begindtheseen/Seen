// Storage that never throws.
//
// Some mobile browsers throw a SecurityError ("The operation is insecure.") the
// moment you even ACCESS `window.sessionStorage` / `window.localStorage` — not
// just on write. This happens in privacy browsers (DuckDuckGo, Brave shields),
// in-app webviews, Safari with "Block All Cookies", and Private/Lockdown modes.
//
// An unguarded `sessionStorage.getItem(...)` in the admin page's mount effect was
// throwing there and crashing the whole route to Next's "Application error" screen
// (mobile only — desktop allows storage). These wrappers swallow the failure and
// degrade to a null read / no-op write so the UI still renders and works for the
// session (just without persistence across reloads on that locked-down browser).

export function safeSessionGet(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key)
  } catch {
    return null
  }
}

export function safeSessionSet(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value)
  } catch {
    /* storage blocked — token lives only in React state for this session */
  }
}

export function safeSessionRemove(key: string): void {
  try {
    window.sessionStorage.removeItem(key)
  } catch {
    /* storage blocked — nothing to remove */
  }
}

export function safeLocalGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function safeLocalSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* storage blocked — value not persisted */
  }
}
