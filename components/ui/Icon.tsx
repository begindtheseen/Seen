// The ONE icon component (replaces emoji-as-icon). Decorative by default (aria-hidden); pass `label`
// when the icon is the only thing that says what something means, and it becomes role="img".
import { createElement } from 'react'
import { ICONS, type IconName } from './icons'

export type { IconName }

export type IconProps = {
  name: IconName
  /** px; defaults to 1em so the icon follows the text it sits in. */
  size?: number | string
  /** Accessible name. Omit for decorative icons (the text beside it already says it). */
  label?: string
  strokeWidth?: number
  className?: string
}

export default function Icon({ name, size = '1em', label, strokeWidth = 2, className }: IconProps) {
  const nodes = ICONS[name]
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ? `ui-icon ${className}` : 'ui-icon'}
      focusable="false"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {nodes.map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs }))}
    </svg>
  )
}
