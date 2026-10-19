'use client'

/**
 * Site footer: one structured map of the whole product (the way every major site closes a
 * page), so wherever you land you can see how the pieces fit and get anywhere in one click.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import styles from './Footer.module.css'

const COLS: Array<{ title: string; links: Array<{ href: string; label: string }> }> = [
  { title: 'Product', links: [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/jobs', label: 'Jobs' },
    { href: '/tracker', label: 'Application tracker' },
    { href: '/resume', label: 'Résumé AI' },
    { href: '/pricing', label: 'Pricing' },
  ] },
  { title: 'Intel', links: [
    { href: '/companies', label: 'Company intel' },
    { href: '/agencies', label: 'Agency Ghost Index' },
    { href: '/demand', label: 'Hiring demand' },
    { href: '/feed', label: 'Live feed' },
    { href: '/ghosted', label: 'Been ghosted?' },
  ] },
  { title: 'Company', links: [
    { href: '/employers', label: 'For employers' },
    { href: '/report', label: 'Report an outcome' },
    { href: '/faq', label: 'FAQ' },
    { href: 'mailto:hello@seenjobs.io', label: 'Contact' },
  ] },
  { title: 'Legal', links: [
    { href: '/terms', label: 'Terms' },
    { href: '/privacy', label: 'Privacy' },
    { href: '/content-policy', label: 'Content policy' },
    { href: '/legal', label: 'Legal' },
  ] },
]

export default function Footer() {
  const pathname = usePathname()
  // The employer portal supplies its own footer/chrome — hide the seeker footer there.
  if (pathname?.startsWith('/employers')) return null
  return (
    <footer className={styles.footer}>
      <div className={styles.wrap}>
        <div className={styles.brand}>
          <Link href="/" className={styles.logo} aria-label="Seen — home">
            <span className={styles.dot} />Seen
          </Link>
          <p className={styles.tag}>Know before you apply. Real ghost rates, response times and applicant outcomes — and a tracker that turns your search into data.</p>
          <button type="button" className={styles.cmd} onClick={() => window.dispatchEvent(new Event('seen:palette'))}>
            <kbd>⌘K</kbd> jump anywhere
          </button>
        </div>
        {COLS.map(col => (
          <div key={col.title} className={styles.col}>
            <div className={styles.colT}>{col.title}</div>
            {col.links.map(l => l.href.startsWith('mailto:')
              ? <a key={l.href} href={l.href} className={styles.link}>{l.label}</a>
              : <Link key={l.href} href={l.href} className={styles.link}>{l.label}</Link>)}
          </div>
        ))}
      </div>
      <div className={styles.bottom}>
        <span>© 2026 Seen</span>
        <span className={styles.dim}>Scores never change for money. Submissions are claims, labeled by confidence.</span>
      </div>
    </footer>
  )
}
