// THE button (audit 2026-10-25: 68 button-like classes and six "primary" looks).
//   variant  primary   — the one CTA gradient; use it ONCE per view
//            secondary — solid surface + border, for the second action
//            ghost     — quiet, for tertiary actions and toolbars
//            danger    — destructive (delete, remove, sign out of all devices)
//   size     sm | md | lg (every size is ≥44px tall on phones)
// Renders a Next <Link> when `href` is internal, a plain <a> when it is external, else a <button>.
// Green is never a button colour — success is a Badge/Toast tone.
import Link from 'next/link'
import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode, type Ref } from 'react'
import Icon, { type IconName } from './Icon'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

type Common = {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Stretch to the container's width. */
  full?: boolean
  icon?: IconName
  iconRight?: IconName
  /** Shows a spinner, sets aria-busy and blocks clicks. */
  loading?: boolean
  className?: string
  children?: ReactNode
}
type AsButton = Common & Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof Common> & { href?: undefined }
type AsLink = Common & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof Common> & {
  href: string
  /** Next.js prefetch for internal links (default: Next's own default). */
  prefetch?: boolean
  disabled?: boolean
}
export type ButtonProps = AsButton | AsLink

export function buttonClass({ variant = 'secondary', size = 'md', full, className }: Pick<Common, 'variant' | 'size' | 'full' | 'className'>): string {
  return ['ui-btn', `ui-btn--${variant}`, size !== 'md' ? `ui-btn--${size}` : '', full ? 'ui-btn--full' : '', className || '']
    .filter(Boolean).join(' ')
}

const isExternal = (href: string) => /^(https?:)?\/\//i.test(href) || href.startsWith('mailto:') || href.startsWith('tel:')

const Button = forwardRef<HTMLButtonElement | HTMLAnchorElement, ButtonProps>(function Button(props, ref) {
  const { variant = 'secondary', size = 'md', full, icon, iconRight, loading, className, children, ...rest } = props
  const cls = buttonClass({ variant, size, full, className })
  const inner = (
    <>
      {loading ? <span className="ui-btn__spin" aria-hidden="true" /> : icon ? <Icon name={icon} size={size === 'lg' ? 18 : 16} /> : null}
      {children}
      {iconRight && !loading ? <Icon name={iconRight} size={size === 'lg' ? 18 : 16} /> : null}
    </>
  )
  if ('href' in rest && typeof rest.href === 'string') {
    const { href, prefetch, disabled, onClick, ...a } = rest as AsLink
    if (disabled) {
      // A disabled link is not a link: no href, announced as disabled, not focusable by Tab.
      return <a ref={ref as Ref<HTMLAnchorElement>} className={cls} aria-disabled="true" role="link" {...a}>{inner}</a>
    }
    if (isExternal(href)) {
      return <a ref={ref as Ref<HTMLAnchorElement>} href={href} className={cls} onClick={onClick} {...a}>{inner}</a>
    }
    return (
      <Link ref={ref as Ref<HTMLAnchorElement>} href={href} prefetch={prefetch} className={cls} onClick={onClick} {...a}>
        {inner}
      </Link>
    )
  }
  const { type = 'button', disabled, ...b } = rest as AsButton
  return (
    <button
      ref={ref as Ref<HTMLButtonElement>}
      type={type}
      className={cls}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...b}
    >
      {inner}
    </button>
  )
})

export default Button
