// ONE place that decides whether a number is good, mixed or bad — so a 2% "waste risk" can never be
// painted red and a 25% ghost rate green again (audit 2026-10-25 #18). Plain JS: client components,
// server components and tests import the same thresholds. A tone is always shown with its icon and
// word (components/ui/Badge.tsx), never by colour alone.
//
// Company grades are NOT decided here: their tone comes from the letter (lib/gradeScale.js gradeRisk /
// gradeBase), and gradeTone() below only translates that answer.
import { gradeRisk, gradeBase } from '../gradeScale.js'

/** @typedef {'good'|'caution'|'bad'} Tone */

export const TONE_ICON = Object.freeze({ good: 'circle-check', caution: 'triangle-alert', bad: 'circle-x' })

/** Share of applicants never answered (0–1). Lower is better. The cut-offs most surfaces already used. */
export const GHOST_RATE_CUTS = Object.freeze({ good: 0.3, caution: 0.5 })
/** Share of applicants who heard back (0–1). Higher is better. */
export const RESPONSE_RATE_CUTS = Object.freeze({ good: 0.6, caution: 0.4 })

/** @param {number|null|undefined} rate @returns {Tone|null} */
export function ghostRateTone(rate) {
  if (rate == null || !Number.isFinite(Number(rate))) return null
  const r = Number(rate)
  return r <= GHOST_RATE_CUTS.good ? 'good' : r <= GHOST_RATE_CUTS.caution ? 'caution' : 'bad'
}

/** @param {number|null|undefined} rate @returns {Tone|null} */
export function responseRateTone(rate) {
  if (rate == null || !Number.isFinite(Number(rate))) return null
  const r = Number(rate)
  return r >= RESPONSE_RATE_CUTS.good ? 'good' : r >= RESPONSE_RATE_CUTS.caution ? 'caution' : 'bad'
}

/** Plain words for a rate's tone: "Low ghost rate" reads better than a colour. */
export function ghostRateWord(tone) {
  return tone === 'good' ? 'Low' : tone === 'caution' ? 'Moderate' : tone === 'bad' ? 'High' : ''
}
export function responseRateWord(tone) {
  return tone === 'good' ? 'High' : tone === 'caution' ? 'Moderate' : tone === 'bad' ? 'Low' : ''
}

/**
 * A company grade's tone, from its score — A/B good, C caution, D/F bad. Delegates to gradeRisk so
 * the leaderboard, company page, agencies index and job cards share one map.
 * @param {number|null|undefined} score @returns {Tone|null}
 */
export function gradeTone(score) {
  const risk = gradeRisk(score)
  return risk === 'safe' ? 'good' : risk === 'warn' ? 'caution' : risk === 'danger' ? 'bad' : null
}

/** The same, from a letter that is already known ("B+" → good). */
export function gradeToneFromLetter(letter) {
  const b = gradeBase(letter)
  if (!b || b === '—') return null
  return b === 'A' || b === 'B' ? 'good' : b === 'C' ? 'caution' : 'bad'
}

/** CSS colour token for a tone's TEXT (readable on every surface). */
export function toneText(tone) {
  return tone === 'good' ? 'var(--good-text)' : tone === 'caution' ? 'var(--caution-text)' : tone === 'bad' ? 'var(--bad-text)' : 'var(--text-2)'
}
/** CSS colour token for a tone's FILL (bars, rings, dots). */
export function toneFill(tone) {
  return tone === 'good' ? 'var(--good)' : tone === 'caution' ? 'var(--caution)' : tone === 'bad' ? 'var(--bad)' : 'var(--text-4)'
}
