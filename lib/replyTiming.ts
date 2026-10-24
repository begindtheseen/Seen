// "How long until they reply?" — the question behind "<company> application status" searches (the page
// title promises it). Answered ONLY from real numbers, never invented (conversion audit 2026-10-24:
// Walmart's "Avg timeline" read "—" with no explanation).
//
//   1. The score's avg_wait_days (the fusion's mean of the wait_days reports carry) when it exists.
//   2. Else, the median of the listed reports' wait_days — only when at least MIN_TIMED_REPORTS carry one.
//   3. Else, say there is not enough timing data and ask for the next report. No estimate, no fallback
//      to an industry figure.
//
// Pure; no imports so `node --test lib/replyTiming.test.mjs` runs it as is.

export const MIN_TIMED_REPORTS = 5
export const REPORT_WHEN_YOU_HEAR = 'Report when you hear back and help the next applicant.'

export type ReplyTiming =
  | { known: true; days: number; basis: 'score' | 'reports'; n: number; line: string; short: string }
  | { known: false; days: null; basis: null; n: number; line: string; short: string }

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

export function replyTiming(avgWaitDays: number | null | undefined, reportWaitDays: Array<number | null | undefined> = []): ReplyTiming {
  const avg = Number(avgWaitDays)
  if (avgWaitDays != null && Number.isFinite(avg) && avg > 0) {
    const d = Math.round(avg)
    return { known: true, days: d, basis: 'score', n: 0, line: `Typical wait to hear back: ${plural(d, 'day')}, from the reports that name a time.`, short: `${d}d typical wait` }
  }
  const waits = reportWaitDays.map(Number).filter(w => Number.isFinite(w) && w > 0 && w <= 365).sort((a, b) => a - b)
  if (waits.length >= MIN_TIMED_REPORTS) {
    const mid = Math.floor(waits.length / 2)
    const med = Math.round(waits.length % 2 ? waits[mid] : (waits[mid - 1] + waits[mid]) / 2)
    return { known: true, days: med, basis: 'reports', n: waits.length, line: `Applicants who named a time heard back in about ${plural(med, 'day')} (middle of ${waits.length} reports).`, short: `~${med}d to hear back` }
  }
  const n = waits.length
  return {
    known: false, days: null, basis: null, n,
    line: `Not enough timing data yet${n > 0 ? ` — ${n} of the ${MIN_TIMED_REPORTS} reports needed name how long the reply took` : ''}.`,
    short: 'reply time: not enough data yet',
  }
}
