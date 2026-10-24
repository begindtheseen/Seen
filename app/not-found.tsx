import Link from 'next/link'
import styles from './not-found.module.css'
import NotFoundMarker from '@/components/NotFoundMarker'

// Branded 404 on the dark shell (the default was Next's white page — the only unbranded screen
// on the site). Two ways out that match what people come here for.
export default function NotFound() {
  return (
    <div className="page-full">
      <NotFoundMarker />
      <div className={styles.wrap}>
        <div className={styles.code}>404</div>
        <h1 className={styles.title}>This page got ghosted.</h1>
        <p className={styles.sub}>The link is broken or the page moved. Everything that matters is one tap away.</p>
        <div className={styles.actions}>
          <Link href="/companies" className={styles.primary}>Check a company →</Link>
          <Link href="/dashboard" className={styles.ghost}>Dashboard</Link>
          <Link href="/" className={styles.ghost}>Home</Link>
        </div>
        <p className={styles.fine}>Think this is our fault? <Link href="/contact">Tell us</Link> — include the link you followed.</p>
      </div>
    </div>
  )
}
