'use client'

import Link from 'next/link'

export default function Footer() {
  return (
    <footer style={{ background: 'var(--void)', borderTop: '1px solid var(--line)', padding: '1rem 1.5rem' }}>
      <div style={{ maxWidth: 1300, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexShrink: 0 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--blue)', display: 'inline-block', flexShrink: 0 }} />
          <span style={{ fontFamily: 'var(--display)', fontSize: '.88rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.02em' }}>Seen</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--muted)', paddingLeft: '.35rem' }}>© 2025</span>
        </div>
        <div style={{ display: 'flex', gap: '.1rem', flexWrap: 'wrap', alignItems: 'center', flex: 1, justifyContent: 'center' }}>
          {[
            { href: '/jobs', label: 'Jobs' },
            { href: '/demand', label: 'Demand' },
            { href: '/resume', label: 'Resume AI' },
            { href: '/employers', label: 'Employers' },
            { href: '/pricing', label: 'Pricing' },
            { href: '/faq', label: 'FAQ' },
            { href: '/legal', label: 'Legal' },
          ].map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              style={{ background: 'none', border: 'none', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.6rem', cursor: 'pointer', padding: '.25rem .55rem', borderRadius: 5, textDecoration: 'none', transition: 'color .15s' }}
              onMouseOver={e => (e.currentTarget.style.color = 'var(--sub)')}
              onMouseOut={e => (e.currentTarget.style.color = 'var(--muted)')}
            >
              {label}
            </Link>
          ))}
          <a
            href="mailto:hello@tryseen.io"
            style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.6rem', textDecoration: 'none', padding: '.25rem .55rem', transition: 'color .15s' }}
            onMouseOver={e => (e.currentTarget.style.color = 'var(--sub)')}
            onMouseOut={e => (e.currentTarget.style.color = 'var(--muted)')}
          >
            Contact
          </a>
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--muted)', flexShrink: 0 }}>Built by someone who lived this.</div>
      </div>
    </footer>
  )
}
