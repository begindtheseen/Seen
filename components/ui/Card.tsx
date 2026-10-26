// THE card surface (audit 2026-10-25: 72 card classes). 14px radius, solid --surface-1, one border.
//   tone     default | raised (dialogs-in-page, hero panels) | accent (the one highlighted card)
//   padding  md (20/24) | compact (16) | flush (0, for lists that pad their own rows)
//   href     makes the whole card one link (interactive hover; still one tab stop)
import Link from 'next/link'
import type { ElementType, HTMLAttributes, ReactNode } from 'react'

export type CardProps = HTMLAttributes<HTMLElement> & {
  as?: ElementType
  tone?: 'default' | 'raised' | 'accent'
  padding?: 'md' | 'compact' | 'flush'
  interactive?: boolean
  href?: string
  prefetch?: boolean
  children?: ReactNode
}

export function cardClass({ tone = 'default', padding = 'md', interactive, className }: Pick<CardProps, 'tone' | 'padding' | 'interactive' | 'className'>): string {
  return ['ui-card', tone !== 'default' ? `ui-card--${tone}` : '', padding !== 'md' ? `ui-card--${padding}` : '', interactive ? 'ui-card--interactive' : '', className || '']
    .filter(Boolean).join(' ')
}

export default function Card({ as, tone, padding, interactive, href, prefetch, className, children, ...rest }: CardProps) {
  const cls = cardClass({ tone, padding, interactive: interactive || !!href, className })
  if (href) {
    return <Link href={href} prefetch={prefetch} className={cls} {...(rest as HTMLAttributes<HTMLAnchorElement>)}>{children}</Link>
  }
  const Tag = (as || 'div') as ElementType
  return <Tag className={cls} {...rest}>{children}</Tag>
}

export function CardTitle({ as: Tag = 'h3', className, children, ...rest }: HTMLAttributes<HTMLElement> & { as?: ElementType }) {
  return <Tag className={className ? `ui-card__title ${className}` : 'ui-card__title'} {...rest}>{children}</Tag>
}

export function Eyebrow({ as: Tag = 'p', className, children, ...rest }: HTMLAttributes<HTMLElement> & { as?: ElementType }) {
  return <Tag className={className ? `ui-eyebrow ${className}` : 'ui-eyebrow'} {...rest}>{children}</Tag>
}
