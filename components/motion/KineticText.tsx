'use client'

// Kinetic text: each word rises from behind its own clip, one after another (the
// `.kt-*` rules in app/motion.css). Strings are split into words; element children
// (a gradient <span>, a <br/>) are kept whole and treated as one word, so markup
// inside the headline survives. Splitting is deterministic, so the server and
// client render the same tree — no hydration mismatch.
//
//   <KineticText as="h1" in={ready} delay={120}>
//     See who actually <span className={styles.grad}>responds</span> before you apply.
//   </KineticText>

import { Children, isValidElement, type CSSProperties, type ElementType, type ReactNode } from 'react'

type Props = {
  children: ReactNode
  as?: ElementType
  className?: string
  /** Start the reveal (gate it on the intro splash, a scroll reveal, data arriving…). */
  in?: boolean
  /** ms before the first word moves. */
  delay?: number
  /** ms between words. */
  stagger?: number
  style?: CSSProperties
}

export default function KineticText({ children, as: Tag = 'span', className = '', in: active = true, delay = 0, stagger = 42, style }: Props) {
  const out: ReactNode[] = []
  let i = 0
  const word = (node: ReactNode) => {
    out.push(
      <span key={`w${i}`} className="kt-w">
        <span className="kt-i" style={{ '--i': i } as CSSProperties}>{node}</span>
      </span>,
    )
    i++
  }
  Children.forEach(children, (child) => {
    if (typeof child === 'string' || typeof child === 'number') {
      for (const part of String(child).split(/(\s+)/)) {
        if (!part) continue
        if (/^\s+$/.test(part)) out.push(' ')
        else word(part)
      }
    } else if (isValidElement(child)) {
      if (child.type === 'br') out.push(child)
      else word(child)
    }
  })

  const vars = { ...style, '--kt-d': `${delay}ms`, '--kt-s': `${stagger}ms` } as CSSProperties
  return (
    <Tag className={`kt${active ? ' kt-in' : ''}${className ? ' ' + className : ''}`} style={vars}>
      {out}
    </Tag>
  )
}
