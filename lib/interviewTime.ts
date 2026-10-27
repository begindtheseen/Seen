// The interview's date and time on the person's own clock, shared by the tracker card and the dashboard.
//
// A date with no time yet is stored at noon local with a 500 ms marker, so the day never shifts in any US
// timezone and the time field stays empty until the person sets it. A time the person typed carries a 1 ms
// marker. Anything else is a date saved before the time field existed (noon in whatever browser saved it): it
// is a DAY, and no time is shown — never "02:00 PM" nobody entered (round 4: all four personas). Prod had only
// test-account rows of that kind on 2026-10-27.
export const NO_TIME_MS = 500
export const TIMED_MS = 1
const pad = (n: number) => String(n).padStart(2, '0')
export function localDay(iso: string): string { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
export function localTime(iso: string): string { const d = new Date(iso); return Number.isNaN(d.getTime()) || d.getMilliseconds() !== TIMED_MS ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}` }
export function isoFrom(dayStr: string, timeStr: string): string {
  const [y, m, d] = dayStr.split('-').map(Number)
  const [hh, mm] = (timeStr || '12:00').split(':').map(Number)
  return new Date(y, m - 1, d, hh, mm, 0, timeStr ? TIMED_MS : NO_TIME_MS).toISOString()
}
/** "Thu, Oct 29" or "Thu, Oct 29 at 3:00 PM" — the time only when the person typed one. */
export function whenLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  return localTime(iso) ? `${day} at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : day
}
