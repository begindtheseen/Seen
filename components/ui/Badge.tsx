// Badge = a status label (never clickable). Chip = a toggle/filter control (a real <button>).
// A toned badge ALWAYS carries an icon and a word — colour is never the only signal (audit #18:
// "⚠ 2% waste risk" was red for a good value, "25% ghosted" green). Pick the tone with lib/ui/tone.js.
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'
import Icon, { type IconName } from './Icon'
import { TONE_ICON, type Tone } from '@/lib/ui/tone.js'

export type BadgeTone = Tone | 'neutral' | 'info' | 'accent'

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone
  /** Override the tone's default icon. A good/caution/bad badge always shows one; others only when given. */
  icon?: IconName
  pill?: boolean
  children: ReactNode
}

export function badgeIcon(tone: BadgeTone, icon?: IconName): IconName | null {
  if (tone === 'good' || tone === 'caution' || tone === 'bad') return icon || (TONE_ICON[tone] as IconName)
  return icon || null
}

export default function Badge({ tone = 'neutral', icon, pill, className, children, ...rest }: BadgeProps) {
  const ico = badgeIcon(tone, icon)
  const cls = ['ui-badge', tone !== 'neutral' ? `ui-badge--${tone}` : '', pill ? 'ui-badge--pill' : '', className || ''].filter(Boolean).join(' ')
  return (
    <span className={cls} {...rest}>
      {ico ? <Icon name={ico} size={12} strokeWidth={2.4} /> : null}
      {children}
    </span>
  )
}

export type ChipProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  /** Toggle state → aria-pressed. Leave undefined for a one-shot action chip. */
  selected?: boolean
  icon?: IconName
  children: ReactNode
}

export function Chip({ selected, icon, className, children, type = 'button', ...rest }: ChipProps) {
  return (
    <button type={type} className={className ? `ui-chip ${className}` : 'ui-chip'} aria-pressed={selected === undefined ? undefined : selected} {...rest}>
      {icon ? <Icon name={icon} size={14} /> : null}
      {children}
    </button>
  )
}
