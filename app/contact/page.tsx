import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import Link from 'next/link'
import PageHeader from '@/components/shell/PageHeader'
import styles from './contact.module.css'

export const metadata: Metadata = pageMetadata({
  title: 'Contact',
  description: 'Email hello@seenjobs.io — a person answers within two business days.',
  path: '/contact',
  ogTitle: 'Contact Seen',
})

const EMAIL = 'hello@seenjobs.io'

export default function ContactPage() {
  return (
    <div className="page-full">
      <div className={styles.wrap}>
        <PageHeader
          eyebrow="Contact"
          title="Talk to a person"
          crumbLabel="Contact"
          sub="One inbox, read by the founder. No ticket numbers, no bots."
        />

        <div className={styles.card}>
          <div className={styles.label}>Email</div>
          <a href={`mailto:${EMAIL}`} className={styles.mail}>{EMAIL}</a>
          <p className={styles.p}>
            We answer within <b>2 business days</b> (California time). Replies come from a real address you can
            write back to.
          </p>
        </div>

        <div className={styles.grid}>
          <div className={styles.tile}>
            <div className={styles.tileT}>Something on the site is wrong</div>
            <p className={styles.p}>Tell us the page, what you expected and what happened. A screenshot helps; the phone or browser you used helps more than you&apos;d think.</p>
          </div>
          <div className={styles.tile}>
            <div className={styles.tileT}>A report about you or your company</div>
            <p className={styles.p}>Send the exact text, why it breaks our <Link href="/content-policy">content policy</Link> (inaccuracy, personal information, fabrication) and anything that supports it. Disputes are reviewed within 14 business days; negative experiences on their own are never removed.</p>
          </div>
          <div className={styles.tile}>
            <div className={styles.tileT}>Your data or your account</div>
            <p className={styles.p}>You can delete your account yourself in <Link href="/profile">Settings</Link>. For anything else about what we store, see the <Link href="/privacy">privacy policy</Link> or email us from the address on the account.</p>
          </div>
          <div className={styles.tile}>
            <div className={styles.tileT}>Press, partnerships, employers</div>
            <p className={styles.p}>Same inbox. Employers can also claim their page from the <Link href="/employers">employer portal</Link>. Money never changes a score, so please don&apos;t ask.</p>
          </div>
        </div>

        <div className={styles.links}>
          <span className={styles.label}>Before you write</span>
          <Link href="/faq" className={styles.link}>Read the FAQ</Link>
          <Link href="/report" className={styles.link}>Report a hiring outcome</Link>
          <Link href="/privacy" className={styles.link}>Privacy policy</Link>
          <Link href="/terms" className={styles.link}>Terms</Link>
        </div>
      </div>
    </div>
  )
}
