// An answer that did not arrive (timeout, dropped connection, empty or unreadable body) means the write may
// have happened. Never offer Retry on it — re-read the state instead (judge F3: a Retry after "It may still
// finish" granted credits twice). Pure: used by every section's result lines.
import type { AdminErr } from '../../contract.ts'

export function isUnknownAnswer(err: AdminErr | undefined): boolean {
  if (!err) return false
  if (err.code === 'timeout' || err.code === 'network' || err.code === 'unknown_outcome' || err.code === 'in_progress') return true
  return /not known whether|may still finish|could not be read \(HTTP 2/i.test(err.error || '')
}
