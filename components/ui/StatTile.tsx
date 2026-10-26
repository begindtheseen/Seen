// THE stat tile: eyebrow label · figure · one-line note. Replaces .co-m, .jd-s, .dpill, .tracker-stat,
// .hstat and the WorkspacePreview tiles (audit 2026-10-25). Numeric figures roll with the shared
// <Odometer>; strings render as given. A tone colours the figure AND puts its word in the note's icon
// line — colour alone never carries the meaning.
import type { ReactNode } from 'react'
import Odometer from '@/components/motion/Odometer'
import Icon from './Icon'
import { TONE_ICON, type Tone } from '@/lib/ui/tone.js'
import type { IconName } from './icons'

export type StatTileProps = {
  label: ReactNode
  value: number | string | null | undefined
  prefix?: string
  suffix?: string
  /** Shown when value is null/undefined. */
  empty?: ReactNode
  tone?: Tone | null
  /** The word that goes with the tone ("Low", "High", "Mixed"). Required for a toned tile. */
  toneWord?: string
  note?: ReactNode
  /** Roll from the server value instead of from 0 (for the page's answer). */
  instant?: boolean
  quiet?: boolean
  className?: string
}

export default function StatTile({ label, value, prefix, suffix, empty = '—', tone, toneWord, note, instant, quiet, className }: StatTileProps) {
  const has = value !== null && value !== undefined && value !== ''
  const valueCls = ['ui-stat__value', tone ? `ui-stat__value--${tone}` : ''].filter(Boolean).join(' ')
  return (
    <div className={['ui-stat', quiet ? 'ui-stat--quiet' : '', className || ''].filter(Boolean).join(' ')}>
      <div className="ui-stat__label">{label}</div>
      <div className={valueCls}>
        {!has ? empty : typeof value === 'number' ? <Odometer value={value} prefix={prefix} suffix={suffix} instant={instant} /> : <>{prefix}{value}{suffix}</>}
      </div>
      {(tone && toneWord) || note ? (
        <div className="ui-stat__note">
          {tone && toneWord ? <><Icon name={TONE_ICON[tone] as IconName} size={12} strokeWidth={2.4} /><span>{toneWord}</span>{note ? <span aria-hidden="true">·</span> : null}</> : null}
          {note}
        </div>
      ) : null}
    </div>
  )
}
